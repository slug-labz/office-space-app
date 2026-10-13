/**
 * The music panel's fetching and acting, which is the half its existing tests do not reach.
 *
 * `music-view.test.ts` covers what collapsing may and may not take away; `music-switch.dom.test.ts`
 * covers the network switch's three states. Between them the panel's *behaviour* — asking Spotify,
 * saying so, and what happens after a button is pressed — was untouched, and it is where the
 * module's own comments are sharpest.
 *
 * ## A spinner for work nobody is doing is its own kind of lie
 *
 * Every panel in this app that fetches says so, because of E4: *"panels pop in with no indication
 * they are fetching"*. But only when there is something to wait for:
 *
 *     Disconnected answers without a request, so saying "checking" there would be a spinner for
 *     work nobody is doing, which is its own kind of lie.
 *
 * Both halves are failures, in opposite directions, and both are silent. A panel that fetches
 * without saying so looks frozen; a panel that says it is fetching when it is not is claiming a
 * network request this app is careful never to make.
 *
 * ## And nothing is reported from memory
 *
 * Every action re-reads the player rather than assuming what it did. A panel that updated itself
 * from what it *asked for* rather than what came back would show a paused track as playing the
 * moment a command silently failed — the third standing order, on a surface whose whole content
 * is a claim about something outside this machine.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { mountMusic, type Music } from '../src/renderer/views/music.js'
import type { Device, Player, Track } from '../src/shared/spotify/model.js'

installDom()

// The real shapes, taken from the declarations rather than guessed. The first version invented
// `name`/`uri`/`isActive`, which typechecked only through an `as` cast and then left `draw()`
// reaching into fields that were not there — a fixture that compiles and does not exist.
const TRACK: Track = {
  id: 't', title: 'Ghosts', artist: 'Japan', album: 'Tin Drum', durationMs: 190_000, artwork: null,
}
const DEVICE: Device = { id: 'd', name: 'Studio', kind: 'Computer', active: true }

const playing = (): Player => ({
  state: 'playing',
  track: TRACK,
  device: DEVICE,
  devices: [DEVICE],
  progressMs: 1_000,
  since: 0,
})

/**
 * A real `MusicSetup`, every field present.
 *
 * The first version was `{ hasClientId: true } as never` — a field that does not exist, and a
 * cast that silenced the compiler for saying so. `signIn()` then read `setup.scopes.length` and
 * threw. Twice in this one file a fixture written from memory and waved through by `as` produced
 * a failure that looked like the module's, and both times the declaration had the answer.
 */
const SETUP = {
  clientId: 'an-id',
  networkAllowed: 'on',
  redirectUri: 'http://127.0.0.1:8888/callback',
  hosts: ['accounts.spotify.com', 'api.spotify.com'],
  scopes: ['user-read-playback-state', 'user-modify-playback-state'],
} as const

interface Rig {
  readonly music: Music
  readonly host: El
  readonly asked: number[]
  readonly commands: string[]
  readonly text: () => string
  readonly press: (label: RegExp) => boolean
}

function rig(options: { player?: Player; commandResult?: string | null } = {}): Rig {
  const host = document.createElement('div')
  const asked: number[] = []
  const commands: string[] = []
  let current: Player = options.player ?? { state: 'disconnected' }

  const bridge = {
    player: () => {
      asked.push(asked.length + 1)
      return Promise.resolve(current)
    },
    connect: () => Promise.resolve({ ok: true } as never),
    disconnect: () => Promise.resolve(),
    command: (what: string) => {
      commands.push(what)
      return Promise.resolve(options.commandResult ?? null)
    },
    transfer: () => Promise.resolve(null),
    search: () => Promise.resolve([]),
    playTrack: () => Promise.resolve(null),
    setup: () => Promise.resolve(SETUP),
    setClientId: () => Promise.resolve(),
    setNetwork: () => Promise.resolve(),
  }

  const music = mountMusic(host, bridge as never, { changed: () => {}, close: () => {} })
  const all = (n: El): El[] => [n, ...n.children.flatMap(all)]
  return {
    music,
    host: host as unknown as El,
    asked,
    commands,
    text: () => ((host as unknown as El).textContent ?? '').replace(/\s+/g, ' '),
    press: (label) => {
      const button = all(host as unknown as El).find(
        (b) => b.tag === 'button' && (label.test(b.textContent ?? '') || label.test(b.getAttribute('aria-label') ?? '')),
      )
      if (!button) return false
      button.dispatchEvent({ type: 'click', bubbles: true })
      return true
    },
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

test('a disconnected panel does not claim to be asking Spotify anything', async () => {
  // The app makes no network request while disconnected, and a "checking…" line would say
  // otherwise on the one surface whose whole subject is what leaves this machine.
  const r = rig({ player: { state: 'disconnected' } })
  const promise = r.music.refresh()
  const during = r.text()
  await promise
  await settle()

  assert.equal(
    /Asking Spotify/i.test(during),
    false,
    `the panel said ${JSON.stringify(during.slice(0, 60))} while disconnected — a spinner for work ` +
      `nobody is doing, on a feature that made no request at all`,
  )
})

test('a connected panel says it is asking, because asking can take a while', async () => {
  // E4: "panels pop in with no indication they are fetching". `player()` can take the client's
  // whole timeout on a slow network or a sleeping Spotify.
  const r = rig({ player: playing() })
  await r.music.refresh()
  await settle()

  // The control: it must be connected, or the assertion below is about the disconnected path.
  assert.match(r.text(), /Ghosts|Studio/, 'the panel never reached a connected state, so this proves nothing')

  const promise = r.music.refresh()
  const during = r.text()
  await promise
  await settle()

  assert.match(
    during,
    /Asking Spotify/i,
    'the panel fetched without saying so. On a slow network it simply looks frozen, which is the ' +
      'complaint E4 was raised about and fixed everywhere except here.',
  )
})

test('what is playing comes from what came back, not from what was asked for', async () => {
  const r = rig({ player: playing() })
  await r.music.refresh()
  await settle()

  assert.equal(r.music.isPlaying(), true, 'a playing player does not read as playing')
  assert.match(r.text(), /Ghosts/, 'the track that came back is not on screen')
})

test('pressing a transport control re-reads the player rather than assuming', async () => {
  // A panel that updated from what it asked for would show a paused track as playing the moment
  // a command silently failed.
  const r = rig({ player: playing() })
  await r.music.refresh()
  await settle()
  const before = r.asked.length

  const pressed = r.press(/pause|play/i)
  assert.ok(pressed, 'no transport control was found to press')
  await settle()
  await settle()

  assert.ok(r.commands.length > 0, 'the press reached no command')
  assert.ok(
    r.asked.length > before,
    'the panel did not ask Spotify what happened after issuing a command. Everything on this ' +
      'surface is a claim about something outside this machine, and reporting one from memory is ' +
      'the third standing order broken where it is hardest to notice.',
  )
})

test('a command that failed says so rather than looking like it worked', async () => {
  const r = rig({ player: playing(), commandResult: 'Spotify says: no active device' })
  await r.music.refresh()
  await settle()

  assert.ok(r.press(/pause|play/i), 'no transport control was found to press')
  await settle()
  await settle()

  assert.match(
    r.text(),
    /no active device/i,
    'a command came back with a problem and the panel said nothing — the press reads as having ' +
      'worked, and the music does not change',
  )
})

test('the panel is drawn before anything is fetched', async () => {
  // Mounted content, immediately: the caller opens this panel in response to a click, and a
  // panel that is empty until a network round-trip finishes is a panel that looks broken.
  const r = rig({ player: playing() })
  assert.ok(r.host.children.length > 0, 'mounting drew nothing at all, so the panel opens empty')
})
