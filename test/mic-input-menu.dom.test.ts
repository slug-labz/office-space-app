/**
 * Choosing which microphone dictation uses — and what the menu says when it cannot find out.
 *
 * `mic.dom.test.ts` covers whether the microphone opens at all; `mic-recording.dom.test.ts`
 * covers what happens once it is open. The chevron beside the button — the list of inputs — was
 * untouched, and it is the control somebody reaches for precisely when dictation is picking up
 * the wrong device.
 *
 * ## Three states that all render as an empty list
 *
 * The module names two of them where the empty case is handled:
 *
 *     Absent is not empty. No inputs at all is a different problem from a menu we failed to
 *     populate, and saying "no microphones" when we simply could not look would send somebody
 *     hunting for a hardware fault that is not there.
 *
 * and, on the rows:
 *
 *     Labels are empty until the microphone has been granted once. Saying so beats a menu of
 *     blank rows that looks like a rendering bug.
 *
 * The third is a menu that never opens, and it is the one the code did not have words for:
 * `enumerateDevices()` can reject, `inputs()` did not catch, and the caller is `void openMenu()`
 * — so the rejection went nowhere and the chevron became a button that does nothing. Standing
 * order 4, on a control whose entire purpose is answering "which microphone is this using?".
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, documentEvent, type El } from './dom.js'
import { wireMic, type MicElements, type MicHandlers } from '../src/renderer/views/mic.js'

installDom()

interface Input {
  readonly kind: string
  readonly deviceId: string
  readonly label: string
}

const input = (deviceId: string, label: string): Input => ({ kind: 'audioinput', deviceId, label })

interface Rig {
  readonly chevron: El
  readonly menu: El
  readonly notices: string[]
  readonly stored: Map<string, string>
  readonly open: () => Promise<void>
  readonly items: () => El[]
  readonly text: () => string
}

function rig(options: {
  devices?: readonly Input[] | (() => Promise<never>)
  remembered?: string
} = {}): Rig {
  const notices: string[] = []
  const stored = new Map<string, string>()
  if (options.remembered) stored.set('office-space.microphone', options.remembered)

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
        typeof options.devices === 'function'
          ? options.devices()
          : Promise.resolve([
              ...(options.devices ?? [input('default', 'Built-in Microphone')]),
              // A camera, so the filter has something to exclude. Without one, "only audio
              // inputs are listed" passes on a list that never had anything else in it.
              { kind: 'videoinput', deviceId: 'cam', label: 'FaceTime HD Camera' },
            ]),
      getUserMedia: () => Promise.reject(new Error('no microphone in this harness')),
    },
  })

  const button = document.createElement('button')
  const chevron = document.createElement('button')
  const menu = document.createElement('div')
  menu.hidden = true
  const els: MicElements = { button, chevron, menu }

  const on: MicHandlers = {
    onText: () => {},
    onNotice: (m) => notices.push(m),
    transcribe: () => Promise.resolve({ ok: true, text: '' } as never),
    ready: () => Promise.resolve({ ready: true }),
  }
  wireMic(els, on)

  const menuEl = menu as unknown as El
  const walk = (n: El): El[] => [n, ...n.children.flatMap(walk)]
  return {
    chevron: chevron as unknown as El,
    menu: menuEl,
    notices,
    stored,
    open: async () => {
      ;(chevron as unknown as El).dispatchEvent({ type: 'click', bubbles: true })
      await new Promise((resolve) => setTimeout(resolve, 5))
    },
    items: () => walk(menuEl).filter((n) => n.getAttribute('role') === 'menuitemradio'),
    text: () => (menuEl.textContent ?? '').replace(/\s+/g, ' '),
  }
}

test('the chevron lists the audio inputs, and only those', async () => {
  const r = rig({ devices: [input('default', 'Built-in Microphone'), input('usb-1', 'Yeti Stereo')] })
  await r.open()

  assert.equal(r.menu.hidden, false, 'the menu never opened')
  assert.deepEqual(
    r.items().map((i) => i.textContent),
    ['Built-in Microphone', 'Yeti Stereo'],
    'the input list is wrong — a camera in a microphone menu is the filter missing',
  )
  assert.equal(r.chevron.getAttribute('aria-expanded'), 'true', 'the chevron does not say the menu is open')
})

test('the input in use is the one marked, not the first one drawn', async () => {
  const r = rig({ devices: [input('default', 'Built-in'), input('usb-1', 'Yeti')], remembered: 'usb-1' })
  await r.open()

  assert.deepEqual(
    r.items().map((i) => i.getAttribute('aria-checked')),
    ['false', 'true'],
    'the menu marks the wrong input as in use, so it disagrees with what dictation will actually ' +
      'record from — which is the one question this menu exists to answer',
  )
})

test('with nothing remembered, the default input is the one marked', async () => {
  const r = rig({ devices: [input('default', 'Built-in'), input('usb-1', 'Yeti')] })
  await r.open()
  assert.deepEqual(r.items().map((i) => i.getAttribute('aria-checked')), ['true', 'false'])
})

test('a machine with no microphones says so', async () => {
  const r = rig({ devices: [] })
  await r.open()
  assert.equal(r.menu.hidden, false, 'the menu did not open, so nothing is said at all')
  assert.match(r.text(), /No microphones were found/i)
})

test('a device list that could not be read is not reported as no microphones', async () => {
  // The third state. `enumerateDevices()` rejects — the permission model refused, or there is no
  // `mediaDevices` on this origin — and `void openMenu()` sends the rejection nowhere, so the
  // chevron is a button that does nothing at all.
  //
  // Both wrong answers are available here and both are worse than the truth: a menu that never
  // opens reads as a broken control, and "No microphones were found" sends somebody looking for
  // a hardware fault that is not there.
  const r = rig({ devices: () => Promise.reject(new Error('NotAllowedError')) })
  await r.open()

  assert.equal(
    r.menu.hidden,
    false,
    'the chevron was pressed and nothing happened. A control that answers a question by staying ' +
      'shut is indistinguishable from one that is not wired up.',
  )
  assert.equal(
    /No microphones were found/i.test(r.text()),
    false,
    'a device list we could not read was reported as an empty one — absent is not empty, and ' +
      'this sends somebody hunting for a hardware fault that is not there',
  )
  assert.match(r.text(), /could not/i, `the menu says ${JSON.stringify(r.text())}, which explains nothing`)
})

test('inputs with no label say why they have none', async () => {
  // Labels are blank until the microphone has been granted once. A menu of blank rows looks like
  // a rendering bug, and somebody stops trusting the control instead of granting the permission.
  const r = rig({ devices: [input('default', '')] })
  await r.open()
  assert.match(r.text(), /allow the microphone once/i, 'a nameless input renders as a blank row')
})

test('choosing an input remembers it, closes the menu, and says what changed', async () => {
  const r = rig({ devices: [input('default', 'Built-in'), input('usb-1', 'Yeti Stereo')] })
  await r.open()

  r.items()[1]?.dispatchEvent({ type: 'click', bubbles: true })

  assert.equal(r.stored.get('office-space.microphone'), 'usb-1', 'the choice was not remembered for next launch')
  assert.equal(r.menu.hidden, true, 'the menu stayed open over whatever is behind it')
  assert.deepEqual(r.notices, ['Dictation will use Yeti Stereo.'], `said ${JSON.stringify(r.notices)}`)
})

test('the menu closes on Escape and on a click elsewhere, like every other menu here', async () => {
  const r = rig()
  await r.open()
  documentEvent({ type: 'keydown', bubbles: true, key: 'Escape' })
  assert.equal(r.menu.hidden, true, 'Escape left the menu up')

  await r.open()
  documentEvent({ type: 'click', bubbles: true, target: document.createElement('div') as unknown as El })
  assert.equal(r.menu.hidden, true, 'clicking away left the menu up over whatever was clicked')
})
