/**
 * Signing in to Spotify without shipping a secret.
 *
 * A desktop app cannot keep one. Anything compiled into the bundle is published, so the
 * Authorization Code flow with a client secret is not available to us at any level of care —
 * it is available to a server, and we are not one. **PKCE** exists for exactly this: the app
 * invents a random verifier, sends only its hash, and proves possession later by sending the
 * original. Nothing worth stealing is ever at rest in the binary.
 *
 * The redirect is a loopback address on a port the app opens for the seconds the browser needs
 * to come back. A custom URL scheme would work too and is worse here: a scheme is registered
 * with the OS and any other app can register the same one, where a loopback listener is bound
 * to a socket only this process holds.
 *
 * ## The scopes, which are the privacy decision
 *
 * Four, and each one is the narrowest that does the job. Notably absent: playlists, saved
 * library, email, profile, follows — Spotify offers all of them and a controller needs none.
 *
 * **The music panel prints this list**, above the sign-in button: *"It asks for: … Not your
 * playlists, library, email or follows."* So it has to stay something a person would agree to
 * after reading it — the sentence is shown before they agree, which is the only moment it is
 * worth anything.
 *
 * This said *the privacy panel*, which does not print it. That is the same mistake `MusicSetup`
 * already carries a correction for, one field over: `hosts` claimed the privacy panel printed
 * *it* when the panel prints `SPOTIFY_HOSTS` by another route. A comment naming the wrong
 * surface sends whoever checks it to a panel where the list is not, and the two conclusions
 * available there — "the comment is stale" and "the scopes are shown nowhere" — are both wrong.
 *
 * Nothing in this file makes a request. It builds the URL the browser is sent to and reads the
 * one it comes back with; `src/main/spotify/` does the talking.
 */

/** The narrowest set that lets a remote be a remote. */
export const SCOPES: readonly string[] = [
  // What is playing, and on what.
  'user-read-playback-state',
  // Play, pause, skip, and move playback to a chosen device.
  'user-modify-playback-state',
  // The currently playing item, which `playback-state` does not always carry.
  'user-read-currently-playing',
  // Which devices exist to pick between.
  'user-read-private',
]

export const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
export const TOKEN_URL = 'https://accounts.spotify.com/api/token'
export const API_BASE = 'https://api.spotify.com/v1'

/**
 * Every host this feature can reach, for the privacy panel.
 *
 * Exported so the panel and the code cannot disagree: the list a person reads is the list the
 * requests are built from. `i.scdn.co` is on it because main fetches album art — the renderer
 * never sees that host, but the machine does, and the panel is about the machine.
 */
export const HOSTS: readonly string[] = ['accounts.spotify.com', 'api.spotify.com', 'i.scdn.co']

/** The unreserved characters PKCE allows in a verifier. */
const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

/**
 * A code verifier.
 *
 * 64 characters from the unreserved set. The spec permits 43–128; 64 is comfortably inside it
 * and gives 384 bits of entropy from `getRandomValues`, which is the only source used —
 * `Math.random` is not a secret generator and the mistake is invisible once made.
 *
 * The modulo is unbiased because the alphabet is exactly 64 long and the source is bytes: every
 * byte maps to exactly four characters. Change the alphabet and this stops being true.
 */
export function createVerifier(random: (n: number) => Uint8Array): string {
  const bytes = random(64)
  let out = ''
  for (const byte of bytes) out += VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length]
  return out
}

/** base64url: the alphabet swapped and the padding dropped, per RFC 7636. */
export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The URL the browser is sent to. `state` is the caller's; it is checked on the way back. */
export function authorizeUrl(options: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    response_type: 'code',
    redirect_uri: options.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: options.challenge,
    state: options.state,
    scope: SCOPES.join(' '),
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

/** What came back on the loopback listener. */
export type Callback =
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'denied'; readonly reason: string }

/**
 * Read the redirect.
 *
 * **The `state` check is not a formality.** The loopback port is open to anything on the
 * machine for the seconds it is listening, so a request arriving with a code we did not ask for
 * is a request from something else. Mismatched state is refused rather than exchanged.
 *
 * A user who clicks *Cancel* comes back with `error=access_denied`, which is not a failure of
 * ours and is reported as the answer it is.
 */
export function readCallback(url: string, expectedState: string): Callback {
  let params: URLSearchParams
  try {
    params = new URL(url, 'http://127.0.0.1').searchParams
  } catch {
    return { kind: 'denied', reason: 'the redirect could not be read' }
  }

  const state = params.get('state')
  if (state !== expectedState) {
    return { kind: 'denied', reason: 'the reply did not match the request this app started' }
  }

  const error = params.get('error')
  if (error) return { kind: 'denied', reason: error === 'access_denied' ? 'you cancelled' : error }

  const code = params.get('code')
  if (!code) return { kind: 'denied', reason: 'no authorisation code came back' }
  return { kind: 'code', code }
}

/** A token set, as this app stores it. The refresh token is the only long-lived secret. */
export interface Tokens {
  readonly accessToken: string
  readonly refreshToken: string
  /** Epoch ms. */
  readonly expiresAt: number
}

/**
 * Half a minute of slack, and it is not superstition.
 *
 * A token that expires while a request is in flight fails as a 401 the user sees. Refreshing
 * marginally early costs one extra exchange a session and removes the whole class.
 */
const SKEW_MS = 30_000

export function isExpired(tokens: Tokens, now: number): boolean {
  return tokens.expiresAt - SKEW_MS <= now
}

/**
 * When a token obtained now runs out.
 *
 * Spotify returns `expires_in` in seconds. Stored as an absolute instant because a duration is
 * only meaningful next to the moment it was measured, and the two get separated the first time
 * anything is persisted.
 */
export function expiryFrom(expiresInSeconds: number, now: number): number {
  return now + expiresInSeconds * 1000
}
