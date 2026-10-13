/**
 * The fold, and the one rule it is easiest to break by trying to help.
 *
 * Three faults were named in the player and all three were real: no minimize, no close, and
 * "no way to pause music". The third was the interesting one — pause *existed*, correctly
 * labelled, and was unreachable, because the transport only rendered once Spotify connected and
 * measured 32 x 23.2 when it did.
 *
 * Folding a panel has an obvious wrong version: hide whatever takes height. Most of a music
 * panel's height is its controls, so the obvious version produces a minimised player you cannot
 * pause — which is a picture of a player. That failure would look completely reasonable in a
 * diff, so it is asserted here instead.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { musicChrome, type MusicState } from '../src/shared/music-view.js'

const STATES: readonly MusicState[] = [
  'disconnected',
  'needs-premium',
  'no-device',
  'playing',
  'paused',
  'blocked',
  'unknown',
]

test('collapsing never takes away the transport', () => {
  for (const state of STATES) {
    const open = musicChrome(state, false)
    const shut = musicChrome(state, true)
    assert.equal(
      shut.showsTransport,
      open.showsTransport,
      `${state}: the fold changed whether the transport is shown. Collapsed is a request for ` +
        `less furniture, not for a player you cannot pause.`,
    )
  }
})

test('collapsing never takes away the network switch', () => {
  // It is a control over what the app may do, not a setting belonging to a feature you have
  // already switched on. Somebody who wants to be sure it reaches nowhere must find it in the
  // same place before and after connecting, and open or folded.
  for (const state of STATES) {
    for (const collapsed of [true, false]) {
      assert.equal(
        musicChrome(state, collapsed).showsNetworkSwitch,
        true,
        `${state} (collapsed: ${collapsed}) hid the network switch`,
      )
    }
  }
})

test('collapsing takes away devices and search, which is what it is for', () => {
  for (const state of ['no-device', 'playing', 'paused'] as const) {
    const open = musicChrome(state, false)
    assert.equal(open.showsDevices, true, `${state}: devices should be shown when expanded`)
    assert.equal(open.showsSearch, true, `${state}: search should be shown when expanded`)

    const shut = musicChrome(state, true)
    assert.equal(shut.showsDevices, false, `${state}: devices survived the fold`)
    assert.equal(shut.showsSearch, false, `${state}: search survived the fold`)
  }
})

test('there is no fold control while signing in, because there is nothing to fold to', () => {
  assert.equal(musicChrome('disconnected', false).canFold, false)
  // Folding a sign-in form leaves a heading and a switch, which is not a smaller version of
  // anything — it is a panel that has stopped saying what it is for.
  assert.equal(musicChrome('disconnected', true).showsTransport, false)

  for (const state of STATES.filter((s) => s !== 'disconnected')) {
    assert.equal(musicChrome(state, false).canFold, true, `${state} should offer the fold`)
  }
})

test('a state with no player still shows a transport, and the buttons say why they are dead', () => {
  // `needs-premium`, `blocked` and `unknown` are connected states with nothing to drive. The
  // transport stays and its buttons are disabled — drawn, and visibly unavailable.
  //
  // Removing it instead would make three different problems look like the same absence, which is
  // the fault `shared/spotify/model.ts` exists to prevent: nothing-is-listening is not paused,
  // and we-could-not-find-out is not signed-out.
  for (const state of ['needs-premium', 'blocked', 'unknown'] as const) {
    assert.equal(musicChrome(state, true).showsTransport, true, `${state} dropped the transport`)
    assert.equal(musicChrome(state, false).showsDevices, false, `${state} offered a device picker`)
  }
})
