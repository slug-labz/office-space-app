/**
 * Searching Spotify, and picking what plays where.
 *
 * `music-panel.dom.test.ts` covers fetching and the transport; `music-switch.dom.test.ts` covers
 * the network switch. The search box and the device list were untouched, and between them they
 * are every control on this panel that carries an argument — which is the class of control that
 * fails by doing the right thing to the wrong subject.
 *
 * ## The redraw that eats what you typed
 *
 * The panel redraws itself wholesale after a search, and the module says what that costs:
 *
 *     Redrawing replaces the input, so focus and text are put back — otherwise every search ends
 *     with the cursor somewhere else and the query gone.
 *
 * That failure is invisible to any test that only asks whether results appeared. Results appear
 * either way; what differs is whether the person can type a second query without clicking back
 * into the box and retyping the first one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { mountMusic } from '../src/renderer/views/music.js'
import type { Device, Player, Track } from '../src/shared/spotify/model.js'

installDom()

const track = (id: string, title: string): Track => ({
  id,
  title,
  artist: 'Japan',
  album: 'Tin Drum',
  durationMs: 190_000,
  artwork: null,
})

const device = (id: string, name: string, active: boolean): Device => ({ id, name, kind: 'Computer', active })

const SETUP = {
  clientId: 'an-id',
  networkAllowed: 'on',
  redirectUri: 'http://127.0.0.1:8888/callback',
  hosts: ['accounts.spotify.com', 'api.spotify.com'],
  scopes: ['user-read-playback-state', 'user-modify-playback-state'],
} as const

interface Rig {
  readonly host: El
  readonly searched: string[]
  readonly played: { uri: string; device: string | undefined }[]
  readonly transferred: string[]
  readonly type: (text: string) => void
  readonly enter: () => void
  readonly input: () => El | undefined
  readonly press: (label: RegExp) => El | undefined
  readonly buttons: () => El[]
  readonly settle: () => Promise<void>
  /** Open the fold. The panel starts collapsed, and search and devices are what folding hides. */
  readonly expand: () => void
}

function rig(options: { player?: Player; results?: readonly Track[] } = {}): Rig {
  const host = document.createElement('div')
  const searched: string[] = []
  const played: { uri: string; device: string | undefined }[] = []
  const transferred: string[] = []

  const bridge = {
    player: () => Promise.resolve(options.player ?? { state: 'disconnected' }),
    connect: () => Promise.resolve({ ok: true } as never),
    disconnect: () => Promise.resolve(),
    command: () => Promise.resolve(null),
    transfer: (id: string) => {
      transferred.push(id)
      return Promise.resolve(null)
    },
    search: (query: string) => {
      searched.push(query)
      return Promise.resolve(options.results ?? [])
    },
    playTrack: (uri: string, deviceId?: string) => {
      played.push({ uri, device: deviceId })
      return Promise.resolve(null)
    },
    setup: () => Promise.resolve(SETUP),
    setClientId: () => Promise.resolve(),
    setNetwork: () => Promise.resolve(),
  }

  mountMusic(host, bridge as never, { changed: () => {}, close: () => {} })

  const hostEl = host as unknown as El
  const walk = (n: El): El[] => [n, ...n.children.flatMap(walk)]
  const input = (): El | undefined => walk(hostEl).find((n) => n.classList.contains('music__input'))
  const buttons = (): El[] => walk(hostEl).filter((n) => n.tag === 'button')

  return {
    host: hostEl,
    searched,
    played,
    transferred,
    input,
    buttons,
    type: (text) => {
      const box = input()
      assert.ok(box, 'no search box to type into')
      box.value = text
    },
    enter: () => input()?.dispatchEvent({ type: 'keydown', bubbles: true, key: 'Enter' }),
    press: (label) => {
      const button = buttons().find((b) => label.test((b.textContent ?? '').trim()))
      button?.dispatchEvent({ type: 'click', bubbles: true })
      return button
    },
    settle: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await new Promise((resolve) => setTimeout(resolve, 5))
    },
    expand: () => {
      // `let collapsed = true` — the panel opens folded, and "you pick a device once and search
      // occasionally; neither earns permanent height next to something you glance at."
      const fold = buttons().find((b) => /Show devices and search/.test(b.getAttribute('aria-label') ?? ''))
      assert.ok(fold, 'no fold control, so the search box and device list are unreachable')
      fold.dispatchEvent({ type: 'click', bubbles: true })
    },
  }
}

const playing = (devices: readonly Device[]): Player => ({
  state: 'playing',
  track: track('t', 'Ghosts'),
  device: devices.find((d) => d.active) ?? devices[0]!,
  devices,
  progressMs: 1_000,
  since: 0,
})

test('a search that returns nothing still leaves you where you were typing', async () => {
  // The redraw replaces the input element. Without the restore, the second query has to be
  // typed into a box you must first click back into, with the first one gone.
  const r = rig({ player: playing([device('d', 'Studio', true)]), results: [] })
  await r.settle()
  r.expand()

  r.type('ghosts')
  r.enter()
  await r.settle()

  assert.deepEqual(r.searched, ['ghosts'], `the search never ran: ${JSON.stringify(r.searched)}`)
  const box = r.input()
  assert.ok(box, 'the search box vanished after searching')
  assert.equal(box.value, 'ghosts', 'the redraw ate the query, so a second search means retyping the first')
  assert.equal(box.focused, true, 'focus was dropped by the redraw, so the next keystroke goes nowhere')
})

test('an empty box asks Spotify nothing', async () => {
  const r = rig({ player: playing([device('d', 'Studio', true)]) })
  await r.settle()
  r.expand()

  r.type('   ')
  r.enter()
  await r.settle()
  assert.deepEqual(r.searched, [], 'a blank search box sent a query')
})

test('results are listed, and pressing one plays that track on the device in use', async () => {
  const r = rig({
    player: playing([device('d1', 'Studio', true)]),
    results: [track('aaa', 'Ghosts'), track('bbb', 'Visions of China')],
  })
  await r.settle()
  r.expand()

  r.type('japan')
  r.enter()
  await r.settle()

  const hits = r.buttons().filter((b) => b.classList.contains('music__hit'))
  assert.equal(hits.length, 2, `expected two results, found ${hits.length}`)
  assert.match(hits[1]?.textContent ?? '', /Visions of China/, 'the second result is not the second track')

  hits[1]?.dispatchEvent({ type: 'click', bubbles: true })
  await r.settle()

  assert.deepEqual(
    r.played,
    [{ uri: 'spotify:track:bbb', device: 'd1' }],
    'pressing the second result played something else, or played it nowhere. Every hit is built ' +
      'in one loop, so a handler closing over the wrong variable plays the last track in the list.',
  )
})

test('the device in use is the one marked, and pressing another moves playback to it', async () => {
  const r = rig({ player: playing([device('d1', 'Studio', false), device('d2', 'Kitchen', true)]) })
  await r.settle()
  r.expand()

  const devices = r.buttons().filter((b) => /Studio|Kitchen/.test(b.textContent ?? ''))
  assert.equal(devices.length, 2, `expected two devices, found ${devices.length}`)
  assert.deepEqual(
    devices.map((b) => b.getAttribute('aria-pressed')),
    ['false', 'true'],
    'the panel marks the wrong device as the one playing, so it disagrees with where the sound is',
  )

  devices[0]?.dispatchEvent({ type: 'click', bubbles: true })
  await r.settle()
  assert.deepEqual(r.transferred, ['d1'], 'the press moved playback to the wrong device, or nowhere')
})

test('a player with no devices does not draw an empty "Playing on"', async () => {
  const r = rig({ player: { state: 'disconnected' } })
  await r.settle()
  assert.equal(
    /Playing on/.test(r.host.textContent ?? ''),
    false,
    'a heading with nothing under it reads as a list that failed to load',
  )
})
