/**
 * Two claims the music panel made and could not support. TASKS.md rows 87 and 91.
 *
 * Both are the third standing order on the one surface whose entire content is a statement about
 * something outside this machine, and both were already named in the file's own comments.
 *
 * ## Row 87 — the switch said `on` before anything had been read
 *
 * `networkSwitch()` says, four lines above the code that did it: *"the one thing this panel must
 * not do is render it as either of the other two. A person who switched this off and came back to
 * a silent `on` is the failure the third state exists to make impossible."* The next line was
 * `setup?.networkAllowed ?? 'on'`.
 *
 * `setup` is null until `refresh()` resolves, and the first `draw()` runs before it does. So
 * **every startup** painted `network on` and the tooltip *"Office Space may make its own network
 * requests"* — in a workspace whose saved setting is `off` as readily as in one where it is on —
 * and the read is cached, so a main process that never answered left it there for the run. A
 * press inside that window then wrote `!on`, which is a setting derived from the guess.
 *
 * `NetworkSetting` has three members and there are four things to draw: not-read-yet is not one
 * of the three. It is the same shape as `unreadable` itself, one level up — absent is not empty,
 * and a reading nobody has taken is not a reading of `on`.
 *
 * ## Row 91 — two different unknowns drawn as one certainty
 *
 * `nowPlaying()` drew *"Nothing playing"* for `blocked` and `unknown` alike. `model.ts` defines
 * them as two different things — *"we did not ask"* and *"we asked and could not find out"* — and
 * neither of them is "nothing is playing". On a timeout the headline asserted silence two lines
 * above an `advice()` line reading *"Could not reach Spotify"*, so the panel contradicted itself
 * inside one row of pixels. `music.ts`'s own header had named the failure already: *"**we could
 * not find out** is not **signed out**"*.
 *
 * ## Why this is a DOM test
 *
 * For both of them the claim **is** the drawing. A model test would assert that `NetworkSetting`
 * has three members and that `blocked` and `unknown` are separate cases — both of which were true
 * the whole time the panel rendered them as one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mountMusic, type MusicBridge, type MusicHandlers } from '../src/renderer/views/music.js'
import { installDom, click, type El } from './dom.js'
import type { MusicSetup, NetworkSetting } from '../src/shared/ipc.js'
import type { Player } from '../src/shared/spotify/model.js'

installDom()

const quiet: MusicHandlers = { changed: () => {}, close: () => {} }

/** Every field, taken from the declaration. `off` on purpose: it is the setting a guess loses. */
const SETUP: MusicSetup = {
  clientId: 'an-id',
  networkAllowed: 'off',
  redirectUri: 'http://127.0.0.1:8888/callback',
  hosts: ['api.spotify.com'],
  scopes: ['user-read-playback-state'],
}

const host = (): El => document.createElement('div') as unknown as El
const all = (node: El): El[] => [node, ...node.children.flatMap(all)]
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))
const textOf = (node: El): string => all(node).map((n) => n.textContent).join('\n')

interface Rig {
  readonly host: El
  /** Every `setNetwork` the panel asked for, in order. */
  readonly wrote: NetworkSetting[]
  readonly text: () => string
  readonly toggle: () => El
}

function bridgeFor(player: Player, setup: MusicSetup | 'held', wrote: NetworkSetting[]): MusicBridge {
  return {
    player: async () => player,
    connect: async () => ({ ok: false, problem: null }),
    disconnect: async () => {},
    command: async () => null,
    transfer: async () => null,
    search: async () => [],
    playTrack: async () => null,
    // `held` never settles, which is the startup window this file is about rather than a
    // contrivance: the panel is in exactly this state on every launch, for two round trips.
    setup: setup === 'held' ? () => new Promise<MusicSetup>(() => {}) : async () => setup,
    setClientId: async () => {},
    setNetwork: async (allowed) => void wrote.push(allowed ? 'on' : 'off'),
  }
}

async function drawn(player: Player, setup: MusicSetup | 'held'): Promise<Rig> {
  const into = host()
  const wrote: NetworkSetting[] = []
  const music = mountMusic(into as unknown as HTMLElement, bridgeFor(player, setup, wrote), quiet)
  // Awaiting `refresh()` against a held `setup()` would wait forever, which is the point of it.
  if (setup !== 'held') await music.refresh()
  await settle()
  return { host: into, wrote, text: () => textOf(into), toggle: () => toggleIn(into) }
}

function toggleIn(node: El): El {
  const found = all(node).filter((n) => n.tag === 'button' && /^network /.test(n.textContent))
  assert.equal(found.length, 1, `expected one network toggle, found ${found.length}`)
  return found[0]!
}

/** The one line above the transport. */
function headlineIn(node: El): string {
  const found = all(node).filter((n) => n.className === 'music__title')
  assert.equal(found.length, 1, `expected one headline, found ${found.length}`)
  return found[0]!.textContent
}

test('before the setting has been read, the switch does not say which way it is set', async () => {
  // Four things to draw, and this is the fourth. Rounding it to `on` is the failure the third
  // state exists to prevent, arriving by the one route the third state does not cover.
  const label = (await drawn({ state: 'disconnected' }, 'held')).toggle().textContent
  assert.doesNotMatch(label, /\bon\b/, `the switch said "${label}" before anything had been read`)
  assert.doesNotMatch(label, /\boff\b/, `the switch said "${label}" before anything had been read`)
  assert.doesNotMatch(
    label,
    /unreadable/,
    'not-read-yet was drawn as the torn-file state, which is a different thing that main acts on',
  )
  assert.match(label, /not read yet/, `the switch says "${label}", which is not "nobody has looked"`)
})

test('before the setting has been read, nothing claims the app may reach the network', async () => {
  // The tooltip and the line beside the button are the two places this panel says what the switch
  // means. Both were written from the guess, and the tooltip is the one that says it outright.
  const rig = await drawn({ state: 'disconnected' }, 'held')
  assert.doesNotMatch(
    rig.toggle().getAttribute('title') ?? '',
    /may make its own network requests/,
    'the tooltip told a person the app is allowed to reach out, having read nothing',
  )
  assert.doesNotMatch(rig.text(), /Applies to Spotify only/, 'the label beside the switch claims it is on')
  assert.doesNotMatch(rig.text(), /No request can be made/, 'the label beside the switch claims it is off')
})

test('aria-pressed does not report a state nothing has read', async () => {
  // It is a boolean and this is not one of its two values. Absent is the honest spelling: a
  // `false` here is announced as "not pressed", which is the `off` reading with a nicer excuse.
  const pressed = (await drawn({ state: 'disconnected' }, 'held')).toggle().getAttribute('aria-pressed')
  assert.equal(pressed, null, `aria-pressed was "${pressed}" over a setting that had not been read`)
})

test('a press before the setting is read writes nothing', async () => {
  // `!on` over a guess of `on` writes `off`, so the startup window could switch the network off
  // for somebody who had it on — the same bug pointing the other way, and just as silent.
  const rig = await drawn({ state: 'disconnected' }, 'held')
  click(rig.toggle())
  await settle()
  assert.deepEqual(
    rig.wrote,
    [],
    'the press wrote a setting derived from a guess about the one that is saved',
  )
})

test('blocked and unknown are not drawn as nothing playing', async () => {
  // Neither of them knows what is playing. `blocked` did not ask; `unknown` asked and failed.
  for (const player of [{ state: 'blocked' }, { state: 'unknown', why: 'timed out' }] as const) {
    const rig = await drawn(player, SETUP)
    assert.doesNotMatch(
      rig.text(),
      /Nothing playing/,
      `${player.state} was drawn as a fact about a track this app never heard anything about`,
    )
  }
})

test('the two unknowns do not read as each other', async () => {
  // Collapsing them is the smaller version of the same mistake: a person who turned the network
  // off and a person whose network timed out need opposite things done about it.
  const notAsked = headlineIn((await drawn({ state: 'blocked' }, SETUP)).host)
  const couldNot = headlineIn((await drawn({ state: 'unknown', why: 'timed out' }, SETUP)).host)
  assert.notEqual(notAsked, couldNot, `both states draw "${notAsked}", so the panel has one word for two`)
})

test('the headline does not contradict the advice two lines below it', async () => {
  const rig = await drawn({ state: 'unknown', why: 'timed out' }, SETUP)
  const shown = rig.text()
  // Asserted first: without the advice line there is no contradiction to measure, and this test
  // would pass against a panel that had simply stopped explaining itself.
  assert.match(shown, /Could not reach Spotify/, 'the advice line is absent, so nothing here is being compared')
  assert.doesNotMatch(shown, /Nothing playing/, 'the panel asserts silence directly above saying it could not find out')
})

test('the states that do know still say what they know', async () => {
  // The control. A fix that made every headline vague would pass every assertion above it.
  assert.equal(
    headlineIn((await drawn({ state: 'no-device', devices: [] }, SETUP)).host),
    'Nothing playing',
    'no-device is the one state where the silence is a fact — Spotify is open nowhere',
  )
  assert.equal(
    headlineIn((await drawn({ state: 'needs-premium' }, SETUP)).host),
    'Spotify',
    'needs-premium is about the account, and says nothing about playback either way',
  )
})
