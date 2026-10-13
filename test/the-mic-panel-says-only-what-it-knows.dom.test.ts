/**
 * Three sentences the microphone panel said that its own code contradicted.
 *
 * `mic.dom.test.ts` covers whether the microphone opens, `mic-recording.dom.test.ts` what happens
 * once it is, `mic-input-menu.dom.test.ts` the chevron. All three pass on the version this file
 * was written against, because each of these defects is a *true-shaped* sentence sitting on the
 * happy side of an assertion nobody thought to make.
 *
 * ## A denied permission is not a missing device
 *
 * The `catch` around `getUserMedia` inspected the error not at all — it branched on
 * `device !== null` alone — and its one branch said *"That microphone is no longer available, so
 * the choice has been cleared"* and called `localStorage.removeItem`. But `getUserMedia` rejects
 * with `NotAllowedError` when the permission is denied or revoked and `NotReadableError` when
 * something else holds the device, and neither says anything about the device existing. So turning
 * the app's microphone permission off reported the microphone as gone **and deleted a stored
 * preference this app never re-derives**. A false sentence and data loss in the same four lines.
 *
 * ## A threshold quoted that no code applies
 *
 * The rejection said *"peak X, where speech is usually above 0.05"*. The floor actually applied is
 * `SPEECH_FLOOR = 0.006`, over the whole recording; `X` was `loudest`, the highest of the
 * 1024-sample analyser windows polled every 100 ms, so most of the audio never reached the number
 * shown. Two different quantities, and a threshold from neither.
 *
 * ## The menu naming one input while the recording uses another
 *
 * With the device list unreadable the menu said *"Dictation will use the system default"* while
 * the remembered `deviceId` was still sent as `{ exact: … }`. The one question this menu exists to
 * answer, answered wrong.
 *
 * What is **not** covered here: a real revoked permission. No test can turn the microphone off in
 * System Settings, so `NotAllowedError` arrives from a fabricated rejection carrying that name —
 * measured against the harness, inferred about the OS.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { wireMic, type MicElements, type MicHandlers } from '../src/renderer/views/mic.js'
import { SPEECH_FLOOR, TARGET_RATE } from '../src/shared/voice/wav.js'

installDom()

/** What the browser rejects with: a `DOMException`, whose `name` is the whole of the information. */
const refusal = (name: string, message: string): DOMException => new DOMException(message, name)

/** One buffer of samples, as a `ScriptProcessorNode` hands it over. Peaks at exactly `amplitude`. */
const buffer = (amplitude: number, length = 4096): Float32Array => {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) out[i] = Math.sin((i / 40) * Math.PI * 2) * amplitude
  return out
}

interface Rig {
  readonly press: () => void
  readonly hear: (samples: Float32Array) => void
  readonly openMenu: () => Promise<void>
  /** The constraints every `getUserMedia` call was made with. */
  readonly opened: unknown[]
  readonly notices: string[]
  readonly stored: Map<string, string>
  readonly menuText: () => string
  readonly settle: () => Promise<void>
}

function rig(
  options: {
    remembered?: string
    /** Reject `getUserMedia` with this. Omitted: it succeeds and a recording can be fed in. */
    denied?: DOMException
    /** Reject `enumerateDevices` with this, the way an origin with no `mediaDevices` does. */
    unreadableList?: Error
  } = {},
): Rig {
  const opened: unknown[] = []
  const notices: string[] = []
  const stored = new Map<string, string>()
  if (options.remembered) stored.set('office-space.microphone', options.remembered)
  let feed: ((samples: Float32Array) => void) | null = null

  // `defineProperty`, not assignment: Node 22 ships `navigator` as a getter-only property.
  const define = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  define('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => stored.set(k, v),
    removeItem: (k: string) => stored.delete(k),
  })
  define('navigator', {
    platform: 'MacIntel',
    mediaDevices: {
      enumerateDevices: () =>
        options.unreadableList
          ? Promise.reject(options.unreadableList)
          : Promise.resolve([{ kind: 'audioinput', deviceId: 'default', label: 'Built-in Microphone' }]),
      getUserMedia: (constraints: unknown) => {
        opened.push(constraints)
        if (options.denied) return Promise.reject(options.denied)
        return Promise.resolve({
          getTracks: () => [{ stop: () => {} }],
          getAudioTracks: () => [{ label: 'Built-in Microphone' }],
        })
      },
    },
  })

  const node = (): Record<string, unknown> => ({
    connect: () => {},
    disconnect: () => {},
    gain: { value: 0 },
    fftSize: 0,
    // The level meter reads this. Zero is a quiet room — and it is also the whole point of the
    // second defect: what the meter polled and what the floor judged are not the same audio.
    getFloatTimeDomainData: (into: Float32Array) => into.fill(0),
  })

  class FakeContext {
    // `TARGET_RATE`, so `resample` is the identity and the peak in the message is exactly the
    // peak that was fed in. At 48kHz linear interpolation moves it by a hair and the assertion
    // would have to be a range, which is a weaker thing to pin.
    readonly sampleRate = TARGET_RATE
    readonly destination = {}
    createMediaStreamSource(): unknown {
      return node()
    }
    createAnalyser(): unknown {
      return node()
    }
    createGain(): unknown {
      return node()
    }
    createScriptProcessor(): unknown {
      const n = node() as Record<string, unknown> & { onaudioprocess?: (e: unknown) => void }
      feed = (samples) => n.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } })
      return n
    }
    close(): Promise<void> {
      return Promise.resolve()
    }
  }
  define('AudioContext', FakeContext)

  const button = document.createElement('button')
  const chevron = document.createElement('button')
  const menu = document.createElement('div')
  menu.hidden = true
  const els: MicElements = { button, chevron, menu }

  const on: MicHandlers = {
    onText: () => {},
    onNotice: (m) => notices.push(m),
    transcribe: () => Promise.resolve({ ok: true, text: 'what was said out loud' } as never),
    ready: () => Promise.resolve({ ready: true }),
  }
  wireMic(els, on)

  const menuEl = menu as unknown as El
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))
  return {
    press: () => (button as unknown as El).dispatchEvent({ type: 'click', bubbles: true }),
    hear: (samples) => feed?.(samples),
    openMenu: async () => {
      ;(chevron as unknown as El).dispatchEvent({ type: 'click', bubbles: true })
      await settle()
    },
    opened,
    notices,
    stored,
    menuText: () => (menuEl.textContent ?? '').replace(/\s+/g, ' '),
    settle,
  }
}

// ──────────────────────────────── row 88: a denied permission is not a missing device ──

test('a revoked microphone permission keeps the input the person chose', async () => {
  // The data loss. `NotAllowedError` is what a denied or revoked permission rejects with, and it
  // says nothing about the device: clearing the choice on it deletes a preference the app never
  // re-derives, so the input somebody picked is gone by the time the permission comes back.
  const r = rig({ remembered: 'the-usb-one', denied: refusal('NotAllowedError', 'Permission denied') })

  r.press()
  await r.settle()

  // The control: it really did try the remembered device, or the rest of this is about nothing.
  assert.equal(r.opened.length, 1, `expected exactly one attempt, got ${r.opened.length}`)
  assert.equal(
    r.stored.get('office-space.microphone'),
    'the-usb-one',
    'a denied permission deleted the remembered input. The permission comes back; the choice does ' +
      'not — nothing in this app re-derives it.',
  )
})

test('and does not report the microphone as gone', async () => {
  // The false sentence. "No longer available" is a claim about the hardware, and a permission
  // denial is not evidence for it — it sends somebody looking for an unplugged cable.
  const r = rig({ remembered: 'the-usb-one', denied: refusal('NotAllowedError', 'Permission denied') })

  r.press()
  await r.settle()

  const said = r.notices.join(' ')
  assert.ok(said.length > 0, 'a refused microphone said nothing at all')
  assert.equal(
    /no longer available|has been cleared/i.test(said),
    false,
    `a denied permission was reported as a missing device: ${JSON.stringify(said)}`,
  )
  assert.match(said, /permission/i, `the refusal does not say a permission is what stopped it: ${JSON.stringify(said)}`)
})

test('a device that really is gone still clears the choice, and reads differently', async () => {
  // The other half. `NotFoundError` is nothing matching the `exact` deviceId — the unplugged case
  // the old comment was written for — and clearing is right there, because every press from now
  // on would fail the same way. The two cases must not produce the same sentence.
  const gone = rig({ remembered: 'the-usb-one', denied: refusal('NotFoundError', 'Requested device not found') })
  gone.press()
  await gone.settle()

  assert.equal(
    gone.stored.has('office-space.microphone'),
    false,
    'an unplugged device is still remembered, so every press from now on fails the same way',
  )
  assert.match(gone.notices.join(' '), /no longer available/i, 'a device that is gone did not say so')

  const denied = rig({ remembered: 'the-usb-one', denied: refusal('NotAllowedError', 'Permission denied') })
  denied.press()
  await denied.settle()

  assert.notDeepEqual(
    denied.notices,
    gone.notices,
    'a denied permission and a missing device produce the same sentence, so the screen cannot tell ' +
      'somebody which of the two fixes to reach for',
  )
})

test('a microphone something else is holding is neither gone nor refused', async () => {
  // `NotReadableError`: the hardware, OS or browser could not read the device. The app knows only
  // that, so it must not upgrade it to "unplugged" or to "you denied it" — and must not delete
  // the choice on the strength of a guess.
  const r = rig({ remembered: 'the-usb-one', denied: refusal('NotReadableError', 'Could not start audio source') })

  r.press()
  await r.settle()

  assert.equal(
    r.stored.get('office-space.microphone'),
    'the-usb-one',
    'a device that could not be read deleted the remembered input',
  )
  const said = r.notices.join(' ')
  assert.equal(/no longer available/i.test(said), false, `a busy device was reported as gone: ${JSON.stringify(said)}`)
  assert.match(
    said,
    /Could not start audio source/,
    `the refusal drops what was actually reported, so there is nothing to act on: ${JSON.stringify(said)}`,
  )
})

// ─────────────────────────────── row 90: the threshold quoted is the one applied ──

test('a rejected recording quotes the floor that rejected it', async () => {
  // "Where speech is usually above 0.05" is a figure no code applies. The floor is SPEECH_FLOOR,
  // and a recording rejected just under it was reported against a number eight times higher.
  const r = rig()

  r.press()
  await r.settle()
  r.hear(buffer(0.004)) // under SPEECH_FLOOR (0.006), so it is rejected
  r.press()
  await r.settle()
  await r.settle()

  const said = r.notices.join(' ')
  assert.match(said, /picked up almost nothing/, `the recording was not rejected at all: ${JSON.stringify(said)}`)
  assert.equal(
    said.includes('0.05'),
    false,
    `the refusal quotes 0.05, which no code applies: ${JSON.stringify(said)}`,
  )
  assert.ok(
    said.includes(String(SPEECH_FLOOR)),
    `the refusal does not quote ${SPEECH_FLOOR}, the floor that actually rejected this: ${JSON.stringify(said)}`,
  )
})

test('and quotes the peak of the audio the floor was applied to', async () => {
  // `loudest` was the highest of the 1024-sample analyser windows polled every 100 ms. The floor
  // runs over the whole recording. Here the polled windows read 0.0000 and the recording peaks at
  // 0.0040, so a message built from the first reports a number the decision never saw.
  const r = rig()

  r.press()
  await r.settle()
  r.hear(buffer(0.004))
  r.press()
  await r.settle()
  await r.settle()

  const said = r.notices.join(' ')
  assert.match(
    said,
    /peak 0\.0040/,
    `the refusal quotes a peak that is not the recording's. The audio peaks at 0.0040 and the ` +
      `analyser windows polled 0.0000: ${JSON.stringify(said)}`,
  )
})

// ──────────────────── row 92: the menu names the input the recording will use ──

test('with the list unreadable, the menu does not promise the default over a remembered input', async () => {
  // The list could not be read, so no row can be drawn — but the remembered deviceId is untouched
  // and is still sent as `{ exact: … }`. Saying "the system default" here names one microphone
  // while the recording uses another.
  const r = rig({ remembered: 'the-usb-one', unreadableList: new Error('NotAllowedError') })

  await r.openMenu()

  // The control, and the contradiction: this is what dictation will actually ask the OS for.
  r.press()
  await r.settle()
  assert.deepEqual(
    (r.opened[0] as { audio?: { deviceId?: unknown } } | undefined)?.audio?.deviceId,
    { exact: 'the-usb-one' },
    `dictation asked for ${JSON.stringify(r.opened[0])}, so this test is no longer about anything`,
  )

  const text = r.menuText()
  assert.match(text, /could not/i, `the menu stopped saying the list was unreadable: ${JSON.stringify(text)}`)
  assert.equal(
    /system default/i.test(text),
    false,
    `the menu says the system default will be used while the recording asks for the remembered ` +
      `input: ${JSON.stringify(text)}`,
  )
  assert.match(
    text,
    /chose|chosen/i,
    `the menu does not say which input dictation will use, which is the one question it exists to ` +
      `answer: ${JSON.stringify(text)}`,
  )
})

test('and still says the system default when that is what will be used', async () => {
  // The over-correction this guards: with nothing remembered, `getUserMedia` is called without a
  // deviceId and the system default really is what opens. That sentence was never wrong.
  const r = rig({ unreadableList: new Error('NotAllowedError') })

  await r.openMenu()

  r.press()
  await r.settle()
  assert.equal(
    (r.opened[0] as { audio?: { deviceId?: unknown } } | undefined)?.audio?.deviceId,
    undefined,
    'no input is remembered and dictation asked for one anyway',
  )
  assert.match(r.menuText(), /system default/i, `the menu no longer says what will actually be used: ${JSON.stringify(r.menuText())}`)
})
