/**
 * The recording path: what reaches the composer, and what never does.
 *
 * The refusal paths are covered in `mic.dom.test.ts`, and they leave every function that does the
 * actual work untouched — `draw`, `finish`, the level meter, the resample. This drives those, and
 * the three rules they hold are the ones this module was rewritten for.
 *
 * ## It types; it does not send
 *
 * The whole design in one sentence. *"Speech recognition is wrong often enough that a mic which
 * sent for you would be a mic nobody dared press — you would spend every recording bracing for
 * what it was about to say on your behalf."* A test that only checked the text arrived would pass
 * on a version that also sent it, so this asserts the text reached the composer **and** that the
 * handlers which could send were never touched.
 *
 * ## Silence is not transcribed
 *
 * A transcriber handed room tone returns its best guess at what the room might have been saying,
 * and that arrives in the composer as a sentence nobody spoke. So `hasSpeech` gates it, and the
 * refusal is the founding bug of this module:
 *
 *     The version of this message that just said "nothing was said" is what made a wrong input
 *     device look like a broken feature: it reported our reading as though it were the world.
 *
 * It has to name the microphone and the peak it heard. That is what turns "this is broken" into
 * "wrong input", which is what actually happened to the person it was built for.
 *
 * ## The rate is read back, not assumed
 *
 * `sampleRate` is a request; the hardware may answer 44.1 or 48kHz. *"Reading it back rather than
 * assuming is the difference between a transcript and forty minutes of chipmunk."*
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { wireMic, type MicElements, type MicHandlers } from '../src/renderer/views/mic.js'
import type { Dictated } from '../src/shared/ipc.js'
import { TARGET_RATE } from '../src/shared/voice/wav.js'

installDom()

/** One buffer of samples, as a ScriptProcessorNode would hand it over. */
const buffer = (amplitude: number, length = 4096): Float32Array => {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) out[i] = Math.sin((i / 40) * Math.PI * 2) * amplitude
  return out
}

interface Rig {
  readonly press: () => void
  /** Feed the recorder one buffer, the way the audio thread would. */
  readonly hear: (samples: Float32Array) => void
  readonly typed: string[]
  readonly notices: string[]
  readonly transcribed: ArrayBuffer[]
  readonly button: El
  readonly settle: () => Promise<void>
}

function rig(options: { sampleRate?: number; dictated?: Dictated } = {}): Rig {
  const typed: string[] = []
  const notices: string[] = []
  const transcribed: ArrayBuffer[] = []
  const stored = new Map<string, string>()
  let feed: ((samples: Float32Array) => void) | null = null

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
      enumerateDevices: () => Promise.resolve([{ kind: 'audioinput', deviceId: 'default', label: 'Built-in Microphone' }]),
      getUserMedia: () =>
        Promise.resolve({
          getTracks: () => [{ stop: () => {} }],
          getAudioTracks: () => [{ label: 'Built-in Microphone', getSettings: () => ({ deviceId: 'default' }) }],
        }),
    },
  })

  const node = (): Record<string, unknown> => ({
    connect: () => {},
    disconnect: () => {},
    gain: { value: 0 },
    fftSize: 0,
    // The level meter reads this. Zero is a quiet room, which is the honest default.
    getFloatTimeDomainData: (into: Float32Array) => into.fill(0),
  })

  class FakeContext {
    // Read back rather than assumed: the hardware may refuse the requested rate.
    readonly sampleRate = options.sampleRate ?? 48_000
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
      // The audio thread, under the test's control.
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
    onText: (t) => typed.push(t),
    onNotice: (m) => notices.push(m),
    transcribe: (wav) => {
      transcribed.push(wav)
      return Promise.resolve(options.dictated ?? ({ ok: true, text: 'what was said out loud' } as Dictated))
    },
    ready: () => Promise.resolve({ ready: true }),
  }
  wireMic(els, on)

  return {
    press: () => (button as unknown as El).dispatchEvent({ type: 'click', bubbles: true }),
    hear: (samples) => feed?.(samples),
    typed,
    notices,
    transcribed,
    button: button as unknown as El,
    settle: () => new Promise((resolve) => setTimeout(resolve, 5)),
  }
}

test('what was said reaches the composer, and nothing sends it', async () => {
  const r = rig()

  r.press()
  await r.settle()
  // The control: the microphone must actually be open, or "it typed" would be about nothing.
  assert.equal(r.button.dataset['state'], 'listening', `the recorder never started — button reads ${JSON.stringify(r.button.dataset['state'])}`)

  r.hear(buffer(0.3))
  r.hear(buffer(0.3))

  r.press()
  await r.settle()
  await r.settle()

  assert.deepEqual(
    r.typed,
    ['what was said out loud'],
    `the transcription did not reach the composer. Typed: ${JSON.stringify(r.typed)}`,
  )
  assert.equal(r.transcribed.length, 1, 'the recording was not handed to the transcriber exactly once')
})

test('a silent recording is never transcribed', async () => {
  // A transcriber handed room tone returns its best guess at what the room might have been
  // saying, and that arrives in the composer as a sentence nobody spoke.
  const r = rig()

  r.press()
  await r.settle()
  r.hear(buffer(0.001))
  r.press()
  await r.settle()
  await r.settle()

  assert.deepEqual(
    r.transcribed,
    [],
    'room tone was sent to the transcriber. Whatever it guesses will arrive in the composer as ' +
      'something the person never said.',
  )
  assert.deepEqual(r.typed, [], 'text reached the composer from a recording with no speech in it')
})

test('and it says which microphone heard nothing, and how little', async () => {
  // The founding bug. "Nothing was said" reported our reading as though it were the world, and
  // made a wrong input device look like a broken feature.
  const r = rig()

  r.press()
  await r.settle()
  r.hear(buffer(0.001))
  r.press()
  await r.settle()
  await r.settle()

  const notice = r.notices.join(' ')
  assert.ok(notice.length > 0, 'a silent recording said nothing at all, which is the failure this message exists to prevent')
  assert.match(notice, /Built-in Microphone/, 'the refusal does not name the microphone that heard nothing')
  assert.match(notice, /peak\s+0\.\d+/, 'the refusal does not say how much it heard, so there is no way to tell a quiet room from a dead input')
  assert.match(notice, /chevron/i, 'the refusal does not say how to pick a different input')
})

test('the button goes back to idle after a recording, however it ended', async () => {
  // A control stuck on "listening" is the one lie in this app that costs privacy: it says the
  // microphone is open when it is not, and the next person to read it believes the opposite too.
  const r = rig()

  r.press()
  await r.settle()
  assert.equal(r.button.dataset['state'], 'listening')

  r.hear(buffer(0.001))
  r.press()
  await r.settle()
  await r.settle()

  assert.equal(
    r.button.dataset['state'],
    'idle',
    `the microphone button reads ${JSON.stringify(r.button.dataset['state'])} after the recording ` +
      `ended. A control that says it is listening when it is not is the same lie as one that says ` +
      `it is not when it is.`,
  )
  assert.equal(r.button.getAttribute('aria-pressed'), 'false')
})

test('a hardware rate the app did not ask for is resampled from, not assumed', async () => {
  // `sampleRate` is a request, not a promise. Reading back 44.1kHz and resampling *from it* is
  // "the difference between a transcript and forty minutes of chipmunk".
  //
  // The first version of this test asserted only that a transcription happened — which is true
  // whether the rate is read back or assumed, so it could not fail for the thing it was named
  // after. The WAV carries its own rate and length, so those are what get asserted.
  const HARDWARE = 44_100
  const SAMPLES = 4096
  const r = rig({ sampleRate: HARDWARE })

  r.press()
  await r.settle()
  r.hear(buffer(0.3, SAMPLES))
  r.press()
  await r.settle()
  await r.settle()

  assert.equal(r.transcribed.length, 1, 'a recording at a rate the app did not request was dropped')
  const wav = new DataView(r.transcribed[0] as ArrayBuffer)

  // Byte 24 of a WAV header is the sample rate. It must be the target, not the hardware's.
  assert.equal(wav.getUint32(24, true), TARGET_RATE, 'the WAV declares a rate that is not the one it was resampled to')

  // And the data really was resampled: 4096 samples at 44.1kHz become ~1487 at 16kHz, two bytes
  // each. Assumed-not-read, the count would still be 4096 and the audio would play fast.
  const dataBytes = wav.getUint32(40, true)
  const expected = Math.round((SAMPLES * TARGET_RATE) / HARDWARE) * 2
  assert.ok(
    Math.abs(dataBytes - expected) <= 4,
    `the WAV holds ${dataBytes} bytes of audio where resampling ${SAMPLES} samples from ` +
      `${HARDWARE} to ${TARGET_RATE} gives about ${expected}. A recording that skipped the ` +
      `resample plays at ${(HARDWARE / TARGET_RATE).toFixed(1)}x — which is the chipmunk.`,
  )
  assert.deepEqual(r.typed, ['what was said out loud'])
})

test('a transcriber that fails says so, and types nothing', async () => {
  const r = rig({ dictated: { ok: false, reason: 'the model file is missing' } as Dictated })

  r.press()
  await r.settle()
  r.hear(buffer(0.3))
  r.press()
  await r.settle()
  await r.settle()

  assert.deepEqual(r.typed, [], 'a failed transcription put something in the composer anyway')
  assert.match(r.notices.join(' '), /model file is missing/, 'a failed transcription said nothing about why')
})
