/**
 * What the office knows about the music, and what it is allowed to say about it.
 *
 * The decision: use the Spotify app for the music, with a UI controller in the office — and the
 * user needs Premium. That decides the architecture, and it happens to
 * be the only architecture available — see `docs/` and the plan's F4 for the Widevine finding.
 * **Office Space is a remote control, not a player.** The user's own Spotify app is what makes
 * sound; this drives it over the Web API.
 *
 * Two consequences follow from being a remote rather than a player, and both are states this
 * module exists to keep separate:
 *
 *   **A remote with nothing to control is not a remote that is paused.** Spotify with no active
 *   device accepts a play command and silently does nothing. If the office drew that as
 *   "paused" it would be showing a transport that does not work and blaming the user's taste
 *   in silence. `no-device` is its own state and it says what to do about it.
 *
 *   **A free account is not a broken one.** Playback control needs Premium; Khalid has made
 *   that a stated requirement rather than a degraded mode, which deletes an entire tier of
 *   half-working UI. `needs-premium` is reached once, at connect, and says so plainly.
 *
 * Nothing here touches the network. This is the vocabulary; `src/main/spotify/` is the only
 * place in the app that speaks it to Spotify, and it is listed in the privacy panel because of
 * it.
 */

/** A track, reduced to what a controller needs to draw. */
export interface Track {
  readonly id: string
  readonly title: string
  /** Joined by the caller — Spotify returns a list and a controller shows one line. */
  readonly artist: string
  readonly album: string
  /** Milliseconds. */
  readonly durationMs: number
  /**
   * The album image, already fetched and inlined by main.
   *
   * A `data:` URI rather than a URL, and that is the CSP: `img-src 'self' data:` already allows
   * this, where pointing at `i.scdn.co` would mean widening the policy for every image in the
   * app to buy one. Main pays a few KB per track; the renderer never learns that Spotify has a
   * CDN.
   */
  readonly artwork: string | null
}

/** Where the sound would come out. */
export interface Device {
  readonly id: string
  readonly name: string
  /** `Computer`, `Smartphone`, `Speaker` — Spotify's own word, shown rather than mapped. */
  readonly kind: string
  readonly active: boolean
}

/**
 * Everything the controller can be showing, as a closed set.
 *
 * A union rather than an object with optional fields, for the reason the office keeps
 * rediscovering: optional fields let a caller forget a case, and the case they forget is always
 * the one where we do not know something.
 */
export type Player =
  /** No account connected. The feature is inert and the app has made no network request. */
  | { readonly state: 'disconnected' }
  /** Connected, but the account cannot drive playback. Said once, plainly, not per button. */
  | { readonly state: 'needs-premium' }
  /** Connected and Premium, but Spotify is not open anywhere. Nothing would hear a play command. */
  | { readonly state: 'no-device'; readonly devices: readonly Device[] }
  | {
      readonly state: 'paused' | 'playing'
      readonly track: Track
      readonly device: Device
      readonly devices: readonly Device[]
      /** Milliseconds into the track at `since`. Not a live counter — see `progressAt`. */
      readonly progressMs: number
      /** When `progressMs` was true, in epoch ms. */
      readonly since: number
    }
  /**
   * We did not ask, because you told us not to.
   *
   * Distinct from `unknown`, which means we asked and failed, and from `disconnected`, which
   * means there is no account. This one is the app doing exactly what it was told and saying so
   * — the master network switch in the privacy panel is off. Drawing it as a failure would make
   * a working control look like a bug.
   */
  | { readonly state: 'blocked' }
  /**
   * We asked and could not find out.
   *
   * Distinct from every state above, including `disconnected`. A network that timed out is not
   * an account that was never connected, and a controller that drew them the same way would be
   * telling somebody to sign in when they already had.
   */
  | { readonly state: 'unknown'; readonly why: string }

/** Whether the transport can do anything right now. */
export function canControl(player: Player): boolean {
  return player.state === 'playing' || player.state === 'paused'
}

/**
 * Where the playhead is now, without polling for it.
 *
 * Spotify reports progress at the moment it answered. Between answers a paused track has not
 * moved and a playing one has moved by exactly the wall clock, so the honest reading is
 * arithmetic rather than another request. Clamped to the track, because a stale `since` across
 * a track change would otherwise report a position past the end.
 */
export function progressAt(player: Player, now: number): number {
  if (player.state !== 'playing' && player.state !== 'paused') return 0
  const elapsed = player.state === 'playing' ? Math.max(0, now - player.since) : 0
  return Math.min(player.track.durationMs, player.progressMs + elapsed)
}

/** `3:07`. Rounded down, because a track shows the second it is in, not the one it is near. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * One sentence saying what is wrong and what to do, or null when nothing is.
 *
 * Written here rather than in the view so it is testable and so the two places that need it —
 * the controller and the activity strip — cannot word it differently.
 */
export function advice(player: Player): string | null {
  switch (player.state) {
    case 'disconnected':
      return 'Not connected. Office Space will make no requests to Spotify until you connect an account.'
    case 'needs-premium':
      return 'Spotify Premium is required to control playback. Search and what is playing still work.'
    case 'no-device':
      return player.devices.length
        ? 'Spotify is not playing on any device. Pick one below, or start it on the device you want.'
        : 'Open Spotify on a phone, desktop or speaker — Office Space drives a device, it does not play audio itself.'
    case 'blocked':
      return 'Office Space is set not to make its own network requests. Turn that back on in the privacy panel to use Spotify.'
    case 'unknown':
      return `Could not reach Spotify: ${player.why}`
    default:
      return null
  }
}
