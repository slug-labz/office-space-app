/**
 * The microphone, which is the one control here where being wrong costs somebody their privacy.
 *
 * `wireMic` had the lowest function coverage in the repository — 33% — and it opens a live
 * microphone. Its two sharpest rules are both about *not recording somebody*, and both are stated
 * in the source rather than left to be inferred.
 *
 * **Refused before the microphone opens, not after.**
 *
 *     Opening a mic and then discovering there is nothing to transcribe with would take a
 *     recording of somebody for no reason at all.
 *
 * So `ready()` is asked first, and a machine that cannot transcribe never reaches
 * `getUserMedia`. The failure this prevents is silent and invisible: the recording happens, is
 * thrown away, and the person is told dictation is not set up — after the fact.
 *
 * **A device that is gone is not swapped for another one.**
 *
 *     falling back silently to a different microphone would record somebody on an input they did
 *     not choose.
 *
 * The remembered choice is cleared and the press is refused. The tempting behaviour — retry on
 * the default — is the one that records you on a microphone you never picked.
 *
 * ## And the whole design in one sentence
 *
 * *"It types; it does not send."* Speech recognition is wrong often enough that a mic which sent
 * for you would be a mic nobody dared press. A test that only checked the text arrived would pass
 * on a version that also sent it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { wireMic, type MicElements, type MicHandlers } from '../src/renderer/views/mic.js'
import type { DictationSetup } from '../src/shared/ipc.js'

installDom()

interface Rig {
  readonly els: MicElements
  readonly button: El
  /** Every time the microphone was actually opened, with the constraints asked for. */
  readonly opened: unknown[]
  readonly typed: string[]
  readonly notices: string[]
  readonly stored: Map<string, string>
  readonly press: () => void
  readonly settle: () => Promise<void>
}

function rig(options: {
  setup?: DictationSetup
  remembered?: string | null
  getUserMedia?: (constraints: unknown) => Promise<unknown>
}): Rig {
  const opened: unknown[] = []
  const typed: string[] = []
  const notices: string[] = []
  const stored = new Map<string, string>()
  if (options.remembered) stored.set('office-space.microphone', options.remembered)

  // `defineProperty`, not assignment. Node 22 ships a real `navigator` as a getter-only
  // property, so `globalThis.navigator = …` throws — which reads as "the module is untestable"
  // and is really "the global is not writable".
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
      enumerateDevices: () => Promise.resolve([]),
      getUserMedia: (constraints: unknown) => {
        opened.push(constraints)
        return options.getUserMedia
          ? options.getUserMedia(constraints)
          : Promise.reject(new Error('no microphone in this harness'))
      },
    },
  })

  const button = document.createElement('button')
  const chevron = document.createElement('button')
  const menu = document.createElement('div')
  menu.hidden = true
  const els: MicElements = { button, chevron, menu }

  const on: MicHandlers = {
    onText: (t) => typed.push(t),
    onNotice: (m) => notices.push(m),
    transcribe: () => Promise.resolve({ ok: true, text: 'whatever was said' } as never),
    ready: () => Promise.resolve(options.setup ?? { ready: true }),
  }
  wireMic(els, on)

  return {
    els,
    button: button as unknown as El,
    opened,
    typed,
    notices,
    stored,
    press: () => (button as unknown as El).dispatchEvent({ type: 'click', bubbles: true }),
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  }
}

test('a machine that cannot transcribe never opens the microphone', async () => {
  // The rule, and the reason: opening a mic and then discovering there is nothing to transcribe
  // with takes a recording of somebody for no reason at all.
  const r = rig({ setup: { ready: false, missing: 'binary', detail: 'whisper is not installed.', fix: 'brew install whisper-cpp' } })

  r.press()
  await r.settle()

  assert.deepEqual(
    r.opened,
    [],
    'the microphone was opened on a machine that cannot transcribe. The recording is taken, ' +
      'thrown away, and the person is told afterwards — which is a recording made for no reason.',
  )
})

test('and says why, rather than doing nothing', async () => {
  // `onNotice` is used "for every refusal, so none of them is silent". A mic that refuses in
  // silence is indistinguishable from a mic that is broken.
  const r = rig({ setup: { ready: false, missing: 'binary', detail: 'whisper is not installed.', fix: 'brew install whisper-cpp' } })

  r.press()
  await r.settle()

  assert.equal(r.notices.length, 1, `expected one notice, got ${r.notices.length}`)
  assert.match(r.notices[0] ?? '', /whisper is not installed/, 'the refusal does not say what is missing')
  assert.match(r.notices[0] ?? '', /brew install whisper-cpp/, 'the refusal does not say how to fix it')
})

test('a remembered microphone that is gone clears the choice instead of using another one', async () => {
  // `exact` fails when the device is unplugged, and that is the right failure. Retrying on the
  // default would record somebody on an input they did not choose.
  //
  // A `DOMException` carrying that name, not `new Error('OverconstrainedError')`, which is what
  // this used to reject with: `.name` on that is `'Error'` and the string was only a message. It
  // passed while the `catch` read the error not at all, and the same fabrication would have hidden
  // the defect that `catch` had — every rejection, including a denied permission, took this
  // branch. See `the-mic-panel-says-only-what-it-knows.dom.test.ts`.
  const r = rig({
    remembered: 'the-usb-one',
    getUserMedia: () => Promise.reject(new DOMException('Constraints could not be satisfied', 'OverconstrainedError')),
  })

  r.press()
  await r.settle()

  // The control: it really did try the remembered device, or the rest of this is about nothing.
  assert.equal(r.opened.length, 1, `expected exactly one attempt, got ${r.opened.length}`)

  assert.equal(
    r.stored.has('office-space.microphone'),
    false,
    'the unavailable device is still remembered, so every press from now on fails the same way',
  )
  assert.equal(
    r.opened.length,
    1,
    'it retried on another microphone after the chosen one failed — which records somebody on ' +
      'an input they never picked',
  )
  assert.match(r.notices.join(' '), /no longer available/i, 'nothing said why the press did nothing')
})

test('a microphone that is refused outright is reported, not retried', async () => {
  // No remembered device: a plain permission denial. One attempt, one sentence.
  const r = rig({ getUserMedia: () => Promise.reject(new Error('Permission denied')) })

  r.press()
  await r.settle()

  assert.equal(r.opened.length, 1, 'it tried more than once after being refused')
  assert.match(r.notices.join(' '), /not available|Permission denied/i, 'a refused microphone said nothing')
})

test('nothing is typed and nothing is sent when a press is refused', async () => {
  // "It types; it does not send" — and when it does neither, it must still do neither quietly.
  const r = rig({ setup: { ready: false, detail: 'not set up' } })
  r.press()
  await r.settle()
  assert.deepEqual(r.typed, [], 'text reached the composer from a recording that never happened')
})

test('the button says whether the microphone is open', async () => {
  // The one control where "nothing on screen may lie" costs somebody their privacy rather than
  // their afternoon. At rest it must not claim to be listening.
  const r = rig({ setup: { ready: false, detail: 'not set up' } })
  await r.settle()

  assert.equal(r.button.dataset['state'], 'idle', `the button reads ${JSON.stringify(r.button.dataset['state'])} before anything was pressed`)
  assert.equal(r.button.getAttribute('aria-pressed'), 'false', 'the button claims to be recording before it has been pressed')

  r.press()
  await r.settle()
  assert.equal(
    r.button.dataset['state'],
    'idle',
    'the button still shows a state other than idle after a press that was refused — a mic that ' +
      'looks open and is not is the same lie as one that is open and looks shut',
  )
})
