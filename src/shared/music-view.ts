/**
 * What the music panel shows, as a decision rather than as a shape of `if`s in a draw function.
 *
 * The player was missing a minimize button and a close button, and there was no way to pause
 * music. All three were true. The panel had **one state, 277px tall**, no way out of it except
 * to go back and find the pill that opened it, and a transport that only existed once Spotify
 * connected — which is the honest reading of "no way to pause": there was no way to *reach* a
 * transport.
 *
 * Folding a panel is easy to get subtly wrong, and the wrong version is the common one: hide the
 * things that take space, which is most of them, including the controls. So the four rules below
 * are stated here, where they can be asserted, rather than left to the order of appends in
 * `views/music.ts` — this repo has no DOM in its tests, and a decision that only exists inside a
 * draw call is a decision nothing can check.
 */

import type { Player } from './spotify/model.js'

export type MusicState = Player['state']

export interface MusicChrome {
  /** Is there a fold control at all? There is nothing to fold to while signing in. */
  readonly canFold: boolean
  /** Transport, device picker, search: the things that are only meaningful over a real player. */
  readonly showsTransport: boolean
  readonly showsDevices: boolean
  readonly showsSearch: boolean
  /** The master network switch. */
  readonly showsNetworkSwitch: boolean
}

/** The states where there is a player concrete enough to point a transport at. */
const CONTROLLABLE: readonly MusicState[] = ['no-device', 'playing', 'paused']

export function musicChrome(state: MusicState, collapsed: boolean): MusicChrome {
  const controllable = CONTROLLABLE.includes(state)
  const signedIn = state !== 'disconnected'
  return {
    // Folding a sign-in form leaves a heading and a switch, which is not a smaller version of
    // anything — it is a panel that has stopped saying what it is for.
    canFold: signedIn,

    // **On both sides of the fold.** A minimised player you cannot pause is a picture of a
    // player, and "one click from anywhere the strip is visible" is the actual fix for the
    // complaint. This is the rule most likely to be broken by a later change that is trying to
    // make the collapsed state shorter, which is why it is the first thing the tests assert.
    showsTransport: signedIn,

    // These two are what folding is *for*. You pick a device once and search occasionally;
    // neither earns permanent height next to something you glance at.
    showsDevices: controllable && !collapsed,
    showsSearch: controllable && !collapsed,

    // Every state, including `disconnected`, and on both sides of the fold.
    //
    // It is a control over what this app may do, not a setting belonging to a feature you have
    // already switched on — somebody who wants to be sure it reaches nowhere must be able to say
    // so *before* connecting anything, and find it in the same place afterwards. Collapsing is a
    // request for less furniture, not a reason to hide the one control that is about consent.
    showsNetworkSwitch: true,
  }
}
