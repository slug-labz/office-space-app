/**
 * The microphone, and what happens between pressing it and reading what you said.
 *
 * Asked for after Wispr Flow stopped a user mid-sentence at a word limit: a mic,
 * and whatever the user is saying typed into the chat, so they can just send it.
 *
 * **It types; it does not send.** That is the whole design in one sentence. Speech recognition is
 * wrong often enough that a mic which sent for you would be a mic nobody dared press — you would
 * spend every recording bracing for what it was about to say on your behalf. Text in the
 * composer, cursor after it, and the person presses Send exactly as they always did.
 *
 * ## Why there is a device picker, and a level
 *
 * The first version had neither, and it did not work for the person it was built for. Measured on
 * their machine, three seconds of a live microphone:
 *
 * ```
 * device: "Default - External Microphone (Built-in)"
 * peak: 0.00327    silence floor in code: 0.012    → rejected
 * ```
 *
 * The system default input was hearing essentially nothing — one of the seven inputs on that
 * laptop, and not the one anybody would have chosen. The app opened it, recorded silence, threw
 * the recording away, and said *"nothing was said"*, which is the app describing its own reading
 * as if it were the world. Two things follow from that, and both are in this file:
 *
 *   1. **You can see what it hears.** A level that moves while you talk turns a mysterious
 *      failure into an obvious one — the difference between "this is broken" and "wrong input".
 *   2. **You can change it**, from the chevron, without leaving the composer.
 *
 * ## Why the audio graph and not `MediaRecorder`
 *
 * `MediaRecorder` gives WebM/Opus and every local transcriber wants 16 kHz mono PCM, which means
 * depending on ffmpeg to stand between somebody and a sentence. Reading samples straight out of
 * the graph is forty lines (`shared/voice/wav.ts`) and depends on nothing — and the same graph is
 * what the level meter reads, so honesty here costs one extra node.
 */

import { encodeWav, hasSpeech, peak, resample, seconds, SPEECH_FLOOR, TARGET_RATE } from '../../shared/voice/wav.js'
import type { Dictated, DictationSetup } from '../../shared/ipc.js'

export interface MicHandlers {
  /** Put text in the composer at the cursor. Never sends. */
  readonly onText: (text: string) => void
  /** Say something in the transcript. Used for every refusal, so none of them is silent. */
  readonly onNotice: (message: string) => void
  /**
   * One recording as a WAV, transcribed by the main process.
   *
   * `Dictated` and `DictationSetup` by name, rather than the structurally identical shapes that
   * used to be written out here. TypeScript is structural, so the copies compiled and the app
   * worked — and that is the hazard rather than the reassurance. Rename `Dictated.reason` and
   * this file keeps compiling against its own optional `reason?`, reads `undefined` forever, and
   * every refusal loses the sentence that says why. Both halves typecheck the whole time.
   *
   * The local copy also quietly dropped `DictationSetup.missing`, whose comment is that three
   * states exist because "no program" and "no model" have different fixes. Nothing here needed
   * it — `detail` carries the words — but a copy is free to omit a field, and that is exactly
   * how a contract stops being one.
   */
  readonly transcribe: (wav: ArrayBuffer) => Promise<Dictated>
  /** Whether this machine can transcribe yet. Checked before the microphone is ever opened. */
  readonly ready: () => Promise<DictationSetup>
}

export interface MicElements {
  readonly button: HTMLButtonElement
  readonly chevron: HTMLButtonElement
  readonly menu: HTMLElement
}

type State = 'idle' | 'listening' | 'thinking'

/** Where the chosen input is remembered. Per machine, which is where microphones live. */
const CHOSEN = 'office-space.microphone'

/**
 * Wire the microphone controls.
 *
 * Press to start, press to stop — not hold-to-talk, because a person dictating a paragraph
 * should not have to keep a finger down for it, and because a key held down is a key that
 * repeats.
 */
export function wireMic(els: MicElements, on: MicHandlers): void {
  const { button, chevron, menu } = els

  let state: State = 'idle'
  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let collected: Float32Array[] = []
  let total = 0
  let ticking: number | null = null
  let device: string | null = localStorage.getItem(CHOSEN)
  let deviceName = ''

  const draw = (): void => {
    button.dataset['state'] = state
    button.disabled = state === 'thinking'
    button.setAttribute('aria-pressed', String(state === 'listening'))

    if (state === 'listening') {
      const at = Math.floor(seconds(total, context?.sampleRate ?? TARGET_RATE))
      // The elapsed count and the level are not decoration. A microphone with no visible sign of
      // being open is the one control in this app where "nothing on screen may lie" costs
      // somebody their privacy rather than their afternoon — and a level that never moves is how
      // you find out the input is wrong instead of concluding the feature is broken.
      button.title = `Listening to ${deviceName || 'your microphone'} — ${at}s. Press to stop.`
      button.style.setProperty('--level', String(level()))
      return
    }

    button.style.removeProperty('--level')
    button.title =
      state === 'thinking'
        ? 'Working out what you said. This happens on your machine.'
        : `Dictate into the composer${deviceName ? ` — ${deviceName}` : ''}. Runs locally; nothing you say leaves this machine.`
  }

  /** 0..1, from the live graph rather than from the samples already banked. */
  function level(): number {
    if (analyser === null) return 0
    const buf = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(buf)
    // Square-rooted so ordinary speech fills a useful part of the bar. A linear meter spends
    // most of its range on volumes nobody produces, and reads as broken at normal talking level.
    return Math.min(1, Math.sqrt(peak(buf)) * 1.6)
  }

  const stopEverything = (): void => {
    if (ticking !== null) {
      window.clearInterval(ticking)
      ticking = null
    }
    stream?.getTracks().forEach((track) => track.stop())
    void context?.close().catch(() => {})
    stream = null
    context = null
    analyser = null
  }

  // ─────────────────────────────────────────────────────────── choosing an input ──

  /**
   * The audio inputs, or `null` when the list could not be read at all.
   *
   * `null` rather than an empty array, because the caller has to tell them apart and cannot:
   * `enumerateDevices()` rejects when the permission model refuses, and `mediaDevices` is not
   * there at all on an origin that is not secure. Uncaught, that rejection went into the `void`
   * at the call site and the menu simply never opened — so the chevron became a button that does
   * nothing, which is the one outcome that tells somebody nothing at all.
   */
  async function inputs(): Promise<MediaDeviceInfo[] | null> {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      return all.filter((d) => d.kind === 'audioinput')
    } catch {
      return null
    }
  }

  async function openMenu(): Promise<void> {
    const found = await inputs()
    menu.replaceChildren()

    // Absent is not empty. No inputs at all is a different problem from a list we could not
    // read, and saying "no microphones" when we simply could not look would send somebody
    // hunting for a hardware fault that is not there.
    if (found === null) {
      const problem = document.createElement('p')
      problem.className = 'popmenu__empty'
      // The second half of the sentence says which input, which is the only question this menu
      // exists to answer. It said "the system default" whatever was remembered, while `start()`
      // goes on sending the remembered `deviceId` as `{ exact: … }` — the menu naming one
      // microphone and the recording using another. The list being unreadable costs us the *name*
      // of that input, not the fact that it is the one that will open.
      problem.textContent =
        device === null
          ? 'The list of microphones could not be read. Dictation will use the system default.'
          : `The list of microphones could not be read, so this cannot say which is which. Dictation will use the input you chose${deviceName ? ` — ${deviceName}` : ''}.`
      menu.appendChild(problem)
    } else if (found.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'popmenu__empty'
      empty.textContent = 'No microphones were found on this machine.'
      menu.appendChild(empty)
    }

    for (const input of found ?? []) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'popmenu__item'
      item.setAttribute('role', 'menuitemradio')
      const chosen = device === null ? input.deviceId === 'default' : input.deviceId === device
      item.setAttribute('aria-checked', String(chosen))
      // Labels are empty until the microphone has been granted once. Saying so beats a menu of
      // blank rows that looks like a rendering bug.
      item.textContent = input.label || 'Unnamed input — allow the microphone once to see names'
      item.addEventListener('click', () => {
        device = input.deviceId
        deviceName = input.label
        localStorage.setItem(CHOSEN, input.deviceId)
        closeMenu()
        draw()
        on.onNotice(`Dictation will use ${input.label || 'that input'}.`)
      })
      menu.appendChild(item)
    }

    menu.hidden = false
    chevron.setAttribute('aria-expanded', 'true')
  }

  function closeMenu(): void {
    menu.hidden = true
    chevron.setAttribute('aria-expanded', 'false')
  }

  chevron.addEventListener('click', () => {
    if (menu.hidden) void openMenu()
    else closeMenu()
  })

  // Anywhere else, and Escape. The same rule every other menu in this app follows.
  document.addEventListener('click', (event) => {
    if (menu.hidden) return
    if (!(event.target instanceof Node)) return
    if (!menu.contains(event.target) && event.target !== chevron && !chevron.contains(event.target)) closeMenu()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) closeMenu()
  })

  // ────────────────────────────────────────────────────────────────── recording ──

  async function start(): Promise<void> {
    const setup = await on.ready()
    if (!setup.ready) {
      // Refused before the microphone opens, not after. Opening a mic and then discovering there
      // is nothing to transcribe with would take a recording of somebody for no reason at all.
      on.onNotice(
        `${setup.detail ?? 'Dictation is not set up on this machine.'}` +
          (setup.fix ? ` To set it up, run: ${setup.fix}` : ''),
      )
      return
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(device !== null ? { deviceId: { exact: device } } : {}),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
    } catch (err) {
      // Which rejection this is decides both the sentence and whether the remembered choice
      // survives, and `DOMException.name` is where that lives — the message is a browser string.
      //
      // This branch used to read the error not at all: any failure with a device remembered said
      // "that microphone is no longer available" and deleted the choice. But only `NotFoundError`
      // and `OverconstrainedError` mean nothing matched the device we asked for. `NotAllowedError`
      // is the permission being denied or revoked and `NotReadableError` is something else holding
      // the device, and neither is evidence the device stopped existing — so turning the app's
      // microphone permission off in System Settings reported a missing microphone *and* destroyed
      // a preference nothing in this app re-derives. A name we do not know keeps the choice too:
      // deleting it is the irreversible half, and an unrecognised failure is not grounds for it.
      const why = err instanceof Error ? err.name : ''
      if (device !== null && (why === 'NotFoundError' || why === 'OverconstrainedError')) {
        // Clearing is right here, and not retrying on another input is too: falling back silently
        // would record somebody on a microphone they did not choose.
        localStorage.removeItem(CHOSEN)
        device = null
        on.onNotice('That microphone is no longer available, so the choice has been cleared. Press again to use the system default.')
        return
      }
      const kept = device !== null ? ' — the input you chose is still remembered' : ''
      if (why === 'NotAllowedError') {
        on.onNotice(
          `The microphone permission was refused, so nothing was recorded${kept}. Allow this app to ` +
            'use the microphone in your system settings, then press again.',
        )
        return
      }
      // Everything else, quoting what was actually reported rather than naming a cause we do not
      // have: `NotReadableError` says the device could not be read and not why.
      on.onNotice(
        `The microphone could not be opened${kept}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return
    }

    deviceName = stream.getAudioTracks()[0]?.label ?? ''
    collected = []
    total = 0

    // `sampleRate` is a request, not a promise — the hardware may refuse and give 44.1 or 48kHz,
    // so what actually came back is what gets resampled. Reading it back rather than assuming is
    // the difference between a transcript and forty minutes of chipmunk.
    context = new AudioContext({ sampleRate: TARGET_RATE })
    const source = context.createMediaStreamSource(stream)

    analyser = context.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)

    // `ScriptProcessorNode` is deprecated and it is the right call here: an AudioWorklet needs a
    // separate module file fetched at runtime, which a `file://` page in a packaged app cannot
    // reliably do. This node is four lines and works in every Electron this app supports.
    const node = context.createScriptProcessor(4096, 1, 1)
    node.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      collected.push(new Float32Array(input))
      total += input.length
    }
    source.connect(node)
    // Through a silent gain rather than straight to the speakers: a `ScriptProcessorNode` only
    // runs while it is connected to the destination, and connecting it audibly would play the
    // room back into the room.
    const silent = context.createGain()
    silent.gain.value = 0
    node.connect(silent)
    silent.connect(context.destination)

    state = 'listening'
    draw()
    // Fast enough to read as a live level rather than as a progress bar.
    ticking = window.setInterval(draw, 100)
  }

  async function finish(): Promise<void> {
    const rate = context?.sampleRate ?? TARGET_RATE
    const chunks = collected
    const length = total
    const from = deviceName
    stopEverything()

    state = 'thinking'
    draw()

    try {
      const joined = new Float32Array(length)
      let at = 0
      for (const chunk of chunks) {
        joined.set(chunk, at)
        at += chunk.length
      }

      const samples = resample(joined, rate)
      if (!hasSpeech(samples)) {
        // Nothing was heard, which is not a failure and must not become one — a transcriber
        // handed room tone returns its best guess at what the room might have been saying, and
        // that arrives in the composer as a sentence nobody spoke.
        //
        // But **it says which microphone heard nothing, and how little**. The version of this
        // message that just said "nothing was said" is what made a wrong input device look like
        // a broken feature: it reported our reading as though it were the world.

        // The number quoted is the peak of the audio `hasSpeech` just judged, and the threshold is
        // the constant it judged it against. It used to be neither: the figure was `loudest`, the
        // highest of the 1024-sample analyser windows polled every 100 ms, which leaves most of the
        // recording out of the number on screen — and it was compared against 0.05, which no code
        // applies. A recording rejected just under `SPEECH_FLOOR` was reported against a figure
        // about eight times higher.
        //
        // The polled peak is not the same quantity and could not be made into one: it samples the
        // live graph so the meter can move, and a meter that only read whole recordings would be a
        // meter that never moves. So it stays where it belongs, driving the bar, and the refusal —
        // which is about a decision — quotes the decision's own inputs. One extra pass over the
        // samples, on the path that is already throwing the recording away.
        const heard = peak(samples)
        on.onNotice(
          `${from || 'That microphone'} picked up almost nothing — peak ${heard.toFixed(4)} across the ` +
            `whole recording, where dictation needs more than ${SPEECH_FLOOR}. If you were talking, ` +
            `it is the wrong input: use the chevron beside the microphone to pick another one.`,
        )
        return
      }

      const said = await on.transcribe(encodeWav(samples))
      if (!said.ok) {
        on.onNotice(said.reason ?? 'That could not be transcribed.')
        return
      }
      if (said.text === '') {
        on.onNotice(`Nothing recognisable came back from ${from || 'that microphone'}, so nothing was written.`)
        return
      }

      on.onText(said.text)
    } finally {
      state = 'idle'
      draw()
    }
  }

  button.addEventListener('click', () => {
    if (state === 'thinking') return
    if (state === 'listening') {
      void finish()
      return
    }
    void start()
  })

  // The remembered name, before anything is pressed, so the tooltip is right on the first hover.
  void inputs()
    .then((found) => {
      // `null` here is a list we could not read, and the tooltip stays on the remembered name
      // rather than claiming the device has gone.
      const match = (found ?? []).find((d) => (device === null ? d.deviceId === 'default' : d.deviceId === device))
      deviceName = match?.label ?? ''
      draw()
    })
    .catch(() => draw())

  draw()
}
