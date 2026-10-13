/**
 * The network switch, on screen, in all three of its states.
 *
 * `views/music.ts` was parked, and this is the part of it that matters: the one control in the
 * app whose whole job is to stop it reaching the network. Its **main-process** half is well
 * covered — a torn or unreadable setting reads as `unreadable` rather than `on`, so a crash
 * mid-flip cannot silently re-permit. Its rendering was not covered at all.
 *
 * That gap was mine. The three-state rendering was added in the same change as the three-state
 * reading, and the suite went green because nothing aimed at this file. **The `unreadable`
 * branch had never been drawn.** A panel that renders that state as `on` puts the whole fix back
 * where it started, because what a person acts on is the label.
 *
 * ## What is pinned
 *
 * 1. Each state draws its own label, and `unreadable` is not rounded to either neighbour.
 * 2. `unreadable` says the network is being **held off** — not that it is on, and not silence.
 * 3. Clicking from `unreadable` asks for `on`, because off is already what is happening, and it
 *    is the click that heals the file.
 * 4. `aria-pressed` is a boolean and cannot carry three states, so the third is in the name.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mountMusic, type MusicBridge, type MusicHandlers } from '../src/renderer/views/music.js'
import { installDom, click, type El } from './dom.js'
import type { MusicSetup, NetworkSetting } from '../src/shared/ipc.js'
import type { Player } from '../src/shared/spotify/model.js'

installDom()

const quiet: MusicHandlers = { changed: () => {}, close: () => {} }

function bridgeWith(networkAllowed: NetworkSetting, asked: NetworkSetting[] = []): MusicBridge {
  const setup: MusicSetup = {
    clientId: 'abc',
    networkAllowed,
    redirectUri: 'http://127.0.0.1:8888/callback',
    hosts: ['api.spotify.com'],
    scopes: ['user-read-playback-state'],
  }
  return {
    player: async (): Promise<Player> => ({ state: 'disconnected' }),
    connect: async () => ({ ok: false, problem: null }),
    disconnect: async () => {},
    command: async () => null,
    transfer: async () => null,
    search: async () => [],
    playTrack: async () => null,
    setup: async () => setup,
    setClientId: async () => {},
    setNetwork: async (allowed) => void asked.push(allowed ? 'on' : 'off'),
  }
}

const host = (): El => document.createElement('div') as unknown as El
const all = (n: El): El[] => [n, ...n.children.flatMap(all)]
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

async function draw(state: NetworkSetting, asked: NetworkSetting[] = []): Promise<El> {
  const into = host()
  const music = mountMusic(into as unknown as HTMLElement, bridgeWith(state, asked), quiet)
  await music.refresh()
  await settle()
  return into
}

const textOf = (node: El): string => all(node).map((n) => n.textContent).join('\n')

function toggle(node: El): El {
  const found = all(node).filter((n) => n.tag === 'button' && /^network /.test(n.textContent))
  assert.equal(found.length, 1, `expected one network toggle, found ${found.length}`)
  return found[0]!
}

test('each state draws its own label, and none is rounded to another', async () => {
  assert.equal(toggle(await draw('on')).textContent, 'network on')
  assert.equal(toggle(await draw('off')).textContent, 'network off')
  assert.equal(
    toggle(await draw('unreadable')).textContent,
    'network setting unreadable',
    'the third state was drawn as one of the other two, which puts the whole fix back',
  )
})

test('unreadable says the network is held off, not that it is on', async () => {
  // What a person acts on is the label. `unreadable` means the main process is refusing every
  // request, so a panel implying otherwise is the panel lying about the one thing it is for.
  const shown = textOf(await draw('unreadable'))
  assert.match(shown, /Held off|held off/, 'the panel does not say the network is being held off')
  assert.doesNotMatch(shown, /may make its own network requests/, 'the panel says it is allowed to reach out')
})

test('clicking from unreadable asks for on, because off is already what is happening', async () => {
  // And the write is what heals the torn file. Asking for `off` here would leave the setting
  // unreadable forever, with a button that appears to do nothing.
  const asked: NetworkSetting[] = []
  click(toggle(await draw('unreadable', asked)))
  await settle()
  assert.deepEqual(asked, ['on'], 'the click did not ask for the state a person could be wanting')
})

test('clicking from on asks for off, and from off asks for on', async () => {
  // The control still works in the two ordinary directions — a test that only covered the third
  // state would pass against a toggle that had stopped toggling.
  const fromOn: NetworkSetting[] = []
  click(toggle(await draw('on', fromOn)))
  await settle()
  assert.deepEqual(fromOn, ['off'])

  const fromOff: NetworkSetting[] = []
  click(toggle(await draw('off', fromOff)))
  await settle()
  assert.deepEqual(fromOff, ['on'])
})

test('aria-pressed carries the two states it can, and the third is in the name', async () => {
  // `aria-pressed` is a boolean attribute. Rather than round the third state to one of them
  // silently, the label carries it — so a screen reader hears "network setting unreadable".
  assert.equal(toggle(await draw('on')).getAttribute('aria-pressed'), 'true')
  assert.equal(toggle(await draw('off')).getAttribute('aria-pressed'), 'false')

  const unknown = toggle(await draw('unreadable'))
  assert.equal(unknown.getAttribute('aria-pressed'), 'false', 'unreadable must not read as pressed')
  assert.match(unknown.textContent, /unreadable/, 'the state a boolean cannot carry is not in the name either')
})
