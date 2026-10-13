/**
 * The music feature's vocabulary and its sign-in, tested without a network or an account.
 *
 * Everything here is pure. That is the point of the split: `src/shared/spotify/` decides what
 * the states are and how a URL is built, `src/main/spotify/` is the only place that talks, and
 * the half worth being sure about is the half that can be checked on a laptop with no Premium.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  advice,
  canControl,
  clock,
  progressAt,
  type Device,
  type Player,
  type Track,
} from '../src/shared/spotify/model.js'
import {
  authorizeUrl,
  base64url,
  createVerifier,
  expiryFrom,
  HOSTS,
  isExpired,
  readCallback,
  SCOPES,
} from '../src/shared/spotify/auth.js'
import { gated, NetworkOff } from '../src/main/spotify/gate.js'
import { Spotify } from '../src/main/spotify/client.js'

const track: Track = {
  id: 't', title: 'Ghosts', artist: 'Japan', album: 'Tin Drum', durationMs: 190_000, artwork: null,
}
const device: Device = { id: 'd', name: 'Studio', kind: 'Computer', active: true }

// ───────────────────────────────────────────────────────────── the states ──

test('a remote with nothing to control is not a remote that is paused', () => {
  // The distinction Khalid's decision made load-bearing: Spotify with no active device accepts
  // a play command and silently does nothing, so drawing that as "paused" would be a transport
  // that does not work with no explanation of why.
  const nothing: Player = { state: 'no-device', devices: [] }
  const paused: Player = { state: 'paused', track, device, devices: [device], progressMs: 0, since: 0 }

  assert.equal(canControl(nothing), false)
  assert.equal(canControl(paused), true)
  assert.notEqual(advice(nothing), advice(paused))
  assert.equal(advice(paused), null, 'a working transport needs no explanation')
})

test('not knowing is its own state, and is not "sign in"', () => {
  // A timeout is not an account that was never connected. Drawing them the same way tells
  // somebody to sign in when they already have.
  const unknown: Player = { state: 'unknown', why: 'the request timed out' }
  const off: Player = { state: 'disconnected' }

  assert.notEqual(advice(unknown), advice(off))
  assert.match(advice(unknown) ?? '', /timed out/)
  assert.match(advice(off) ?? '', /no requests/i)
})

test('a free account is told once, and is not a broken one', () => {
  const free: Player = { state: 'needs-premium' }
  assert.equal(canControl(free), false)
  assert.match(advice(free) ?? '', /Premium/)
})

// ─────────────────────────────────────────────────────── the playhead ──

test('progress is arithmetic while playing and frozen while paused', () => {
  const playing: Player = { state: 'playing', track, device, devices: [device], progressMs: 1_000, since: 10_000 }
  const paused: Player = { ...playing, state: 'paused' }

  assert.equal(progressAt(playing, 10_000), 1_000, 'at the instant it was reported')
  assert.equal(progressAt(playing, 13_000), 4_000, 'three seconds later, without asking again')
  assert.equal(progressAt(paused, 13_000), 1_000, 'a paused track has not moved')
})

test('the playhead never runs past the end of the track', () => {
  // A stale `since` across a track change would otherwise report a position beyond the end,
  // which draws as a progress bar overflowing its own container.
  const playing: Player = { state: 'playing', track, device, devices: [device], progressMs: 189_000, since: 0 }
  assert.equal(progressAt(playing, 600_000), track.durationMs)
})

test('the clock rounds down — a track shows the second it is in', () => {
  assert.equal(clock(0), '0:00')
  assert.equal(clock(9_999), '0:09')
  assert.equal(clock(65_000), '1:05')
  assert.equal(clock(190_000), '3:10')
  assert.equal(clock(-5), '0:00', 'a negative position is drawn as the start, not as -0:01')
})

// ────────────────────────────────────────────────────────────── sign-in ──

test('the verifier is the right length, alphabet and source', () => {
  // Bytes from a counted, deterministic source so the mapping is checkable. The real caller
  // passes `getRandomValues`; what matters here is that every byte maps into the unreserved set.
  const verifier = createVerifier((n) => Uint8Array.from({ length: n }, (_, i) => i * 7))
  assert.equal(verifier.length, 64, 'inside the 43–128 the spec allows')
  assert.match(verifier, /^[A-Za-z0-9\-._~]+$/, 'unreserved characters only')
})

test('base64url drops padding and swaps the two characters that are not URL-safe', () => {
  assert.equal(base64url(Uint8Array.from([251, 255, 190])), '-_--')
  assert.equal(base64url(Uint8Array.from([1])), 'AQ', 'no = padding')
})

test('the authorize URL asks for S256, our scopes, and nothing else', () => {
  const url = new URL(authorizeUrl({
    clientId: 'abc', redirectUri: 'http://127.0.0.1:7777/callback', challenge: 'CH', state: 'ST',
  }))

  assert.equal(url.origin + url.pathname, 'https://accounts.spotify.com/authorize')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('scope'), SCOPES.join(' '))
  // No secret is ever in the URL — that is the whole reason for PKCE here.
  assert.equal(url.searchParams.get('client_secret'), null)
})

test('the scopes stay narrow — this list is printed in the privacy panel', () => {
  // If somebody widens this, the panel prints it and this test makes them mean to.
  assert.deepEqual([...SCOPES].sort(), [
    'user-modify-playback-state',
    'user-read-currently-playing',
    'user-read-playback-state',
    'user-read-private',
  ])
  for (const scope of SCOPES) {
    assert.doesNotMatch(scope, /playlist|library|email|follow/, `${scope} is more than a remote needs`)
  }
})

test('a reply whose state does not match is refused, not exchanged', () => {
  // The loopback port is open to anything on the machine while it listens. A code arriving with
  // the wrong state came from something else and must never be spent.
  const forged = readCallback('/callback?code=stolen&state=wrong', 'ours')
  assert.equal(forged.kind, 'denied')

  const real = readCallback('/callback?code=good&state=ours', 'ours')
  assert.deepEqual(real, { kind: 'code', code: 'good' })
})

test('cancelling is an answer, not a failure', () => {
  const cancelled = readCallback('/callback?error=access_denied&state=ours', 'ours')
  assert.deepEqual(cancelled, { kind: 'denied', reason: 'you cancelled' })
})

test('a token is refreshed slightly early, so it never expires mid-request', () => {
  const now = 1_000_000
  const tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: expiryFrom(3600, now) }

  assert.equal(isExpired(tokens, now), false)
  assert.equal(isExpired(tokens, tokens.expiresAt - 60_000), false, 'a minute out, still good')
  assert.equal(isExpired(tokens, tokens.expiresAt - 10_000), true, 'inside the skew, refresh now')
  assert.equal(isExpired(tokens, tokens.expiresAt + 1), true)
})

test('every host this feature can reach is declared in one place', () => {
  // The privacy panel prints `HOSTS`. A request built against a host that is not in it would be
  // egress the panel does not mention, which is the exact thing F8 exists to prevent.
  assert.deepEqual([...HOSTS].sort(), ['accounts.spotify.com', 'api.spotify.com', 'i.scdn.co'])
})

// ─────────────────────────────────────────────────────── the master switch ──

test('the switch refuses the request itself, not a flag somebody might read', async () => {
  // Laptop 1's condition on accepting F4: "a toggle the main process does not honour is a claim,
  // not a control." So the switch wraps `fetch` — the one function every request path receives —
  // rather than being checked at each call site, where the fifth site added next month would
  // silently not have it.
  let allowed = true
  let reached = 0
  const guarded = gated(
    () => allowed,
    (async () => {
      reached++
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch,
  )

  await guarded('https://api.spotify.com/v1/me')
  assert.equal(reached, 1)

  allowed = false
  await assert.rejects(() => guarded('https://api.spotify.com/v1/me'), NetworkOff)
  assert.equal(reached, 1, 'the request must not have been made at all')
})

test('the switch is read per call, so turning it off stops the next request', async () => {
  // Not captured at construction. Somebody switching it off is doing so because they want it off
  // *now*, and "it takes effect after a restart" is a control that does not do what it says.
  let allowed = true
  const guarded = gated(() => allowed, (async () => new Response('{}')) as typeof globalThis.fetch)

  await guarded('https://api.spotify.com/v1/me')
  allowed = false
  await assert.rejects(() => guarded('https://api.spotify.com/v1/me'), NetworkOff)
  allowed = true
  await guarded('https://api.spotify.com/v1/me')
})

test('being told not to ask is not the same as asking and failing', () => {
  // Three states that a lazier union would collapse into one error. `blocked` is the app doing
  // exactly what it was told; drawing that as a failure makes a working control look like a bug,
  // and the first thing somebody does about a bug is switch the control back.
  const blocked: Player = { state: 'blocked' }
  const failed: Player = { state: 'unknown', why: 'it did not answer in time' }
  const off: Player = { state: 'disconnected' }

  assert.equal(canControl(blocked), false)
  assert.match(advice(blocked) ?? '', /privacy panel/)
  assert.notEqual(advice(blocked), advice(failed))
  assert.notEqual(advice(blocked), advice(off))
})

test('THE FUZZ: no callback with the wrong state is ever exchanged', () => {
  // The loopback port is open to anything on the machine for the seconds it is listening, so
  // this is the check that a code arriving there was asked for by us. The test above names one
  // forged callback; this asks the same question of thirty thousand, including the near misses
  // a single-example test cannot cover — a state one character longer, one shorter, the same
  // letters in a different case, and none at all.
  //
  // Deterministic seed, so a failure is a case rather than an anecdote.
  let seed = 13579
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!

  const expected = 'the-real-state-abc123'
  const states = [expected, '', 'wrong', `${expected}x`, expected.slice(0, -1), expected.toUpperCase()]
  const codes = ['goodcode', '', 'a b', '../../etc', '%00', 'x'.repeat(5000)]
  const extras = ['', 'error=access_denied', 'error=server_error', `state=${expected}`, 'code=second']

  let accepted = 0
  const wrong: string[] = []

  for (let n = 0; n < 30_000; n++) {
    const parts: string[] = []
    if (rnd() > 0.15) parts.push(`state=${encodeURIComponent(pick(states))}`)
    if (rnd() > 0.3) parts.push(`code=${encodeURIComponent(pick(codes))}`)
    const extra = pick(extras)
    if (extra) parts.push(extra)
    const url = `/callback?${parts.join('&')}`

    const result = readCallback(url, expected)
    if (result.kind !== 'code') continue
    accepted += 1
    // A duplicated parameter resolves to the first, which is what `URLSearchParams.get` returns
    // and what this must agree with — reading it any other way here would be a second answer to
    // "which state came back".
    if (new URL(url, 'http://127.0.0.1').searchParams.get('state') !== expected) wrong.push(url)
  }

  assert.deepEqual(wrong.slice(0, 3), [], `${wrong.length} callbacks were exchanged despite a state we did not send`)
  // And it accepted something, so the run above was not thirty thousand refusals proving nothing.
  assert.ok(accepted > 1000, `only ${accepted} of 30000 were accepted — the fuzz is refusing everything`)
})

// ─────────────────────────────────────────────── the hops, not just the request ──

/**
 * A client whose every response is scripted, so the hop logic is what is under test.
 *
 * `Deps.fetch` is injected precisely so a test never reaches the network; these use it to answer
 * with redirects, which is the one thing the real Spotify API will not do on demand.
 */
function clientReturning(responses: (url: string) => Response, tokens: {
  accessToken: string
  refreshToken: string
  expiresAt: number
} | null = {
  accessToken: 'live',
  refreshToken: 'r',
  expiresAt: Number.MAX_SAFE_INTEGER,
}): { client: Spotify; reached: string[]; modes: (string | undefined)[]; carried: { host: string; auth: string | null }[] } {
  const reached: string[] = []
  const modes: (string | undefined)[] = []
  const carried: { host: string; auth: string | null }[] = []
  const client = new Spotify({
    clientId: 'id',
    store: { read: async () => tokens, write: async () => {} },
    now: () => 0,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      reached.push(new URL(url).host)
      carried.push({
        host: new URL(url).host,
        auth: (init?.headers as Record<string, string> | undefined)?.['authorization'] ?? null,
      })
      // Recorded because it is the one thing a stubbed `fetch` cannot demonstrate. A real
      // `fetch` with `redirect: 'follow'` resolves the hops itself and hands back the final
      // response, so the loop under test never sees a 3xx and never checks anything; a stub
      // returns whatever it was told to and behaves identically under both settings. The option
      // at the seam is the only observable difference, so it is asserted rather than inferred.
      modes.push(init?.redirect)
      // A synthetic `Response` has `url === ''` — including one from `Response.redirect()` — so
      // every hop would resolve its `Location` against the loop's fallback rather than against
      // the response it came from, which is the branch production never takes. Set here so the
      // path under test is the path that ships.
      const answer = responses(url)
      Object.defineProperty(answer, 'url', { value: url, configurable: true })
      return answer
    }) as typeof globalThis.fetch,
  })
  return { client, reached, modes, carried }
}

test('a request redirected out of the declared list is not followed', async () => {
  // `request()` validated the host and then called `fetch` with no `redirect` option, which is
  // `'follow'` — so it checked the URL this app asks for and connected wherever it was sent.
  // `transcribe.ts` had the identical defect and the identical comment about it, and there the
  // redirect turned out to happen on every single call.
  const { client, reached } = clientReturning((url) =>
    url.includes('api.spotify.com')
      ? new Response(null, { status: 302, headers: { location: 'https://evil.example.com/v1/me/player' } })
      : new Response('{}', { status: 200 }),
  )

  // `player()` catches and reports rather than throwing — *told not to is not failed to* — so
  // the observable answer is the one to assert. It is also the better one: this is what a person
  // would see.
  const out = await client.player()

  assert.equal(out.state, 'unknown', 'the redirect was followed and produced a normal answer')
  assert.match(
    out.state === 'unknown' ? (out.why ?? '') : '',
    /evil\.example\.com is not in the declared egress list/,
    'refused for some other reason than the hop',
  )
  assert.equal(reached.includes('evil.example.com'), false, 'the redirect target was contacted')
})

test('every request asks fetch not to follow redirects on its behalf', async () => {
  // The defect this pair of changes exists to fix is `fetch` resolving hops itself: the host is
  // checked on the URL this app asks for, and the connection goes wherever it is sent. With an
  // injected `fetch` that is invisible — a stub returns what it was told to under either
  // setting — so switching `'manual'` back to `'follow'` passes every other test here. The
  // option is the seam's observable, and this is the assertion that holds it.
  const { client, modes } = clientReturning((url) =>
    url.endsWith('/v1/me')
      ? new Response(JSON.stringify({ product: 'premium' }), { status: 200 })
      : new Response(JSON.stringify({ is_playing: false, item: null, device: null }), { status: 200 }),
  )

  await client.player()

  assert.ok(modes.length > 0, 'no requests were made, so this asserted nothing')
  assert.deepEqual(
    [...new Set(modes)],
    ['manual'],
    'a request let fetch follow redirects for it, which is the whole defect',
  )
})

test('a redirect to plaintext is refused, even to a host that is declared', async () => {
  // The declared set is a set of connections, not of names. `api.spotify.com` over http is a
  // different thing from the same host over https, and every request here carries a bearer
  // token. Without this the host check passes and the token goes out in the clear.
  const { client, reached } = clientReturning((url) =>
    url.startsWith('https://api.spotify.com')
      ? new Response(null, { status: 302, headers: { location: 'http://api.spotify.com/v1/me' } })
      : new Response('{}', { status: 200 }),
  )

  const out = await client.player()

  assert.equal(out.state, 'unknown', 'a plaintext hop was followed')
  assert.match(out.state === 'unknown' ? (out.why ?? '') : '', /not https/, 'refused for some other reason')
  assert.equal(reached.filter((h) => h === 'api.spotify.com').length, 1, 'the plaintext hop was contacted')
})

test('a request redirected within the declared list is followed, so the feature still works', async () => {
  // The other direction, because a guard that refuses everything also passes the test above.
  // `/me` has to answer premium or `player()` returns `needs-premium` and never reaches the
  // request under test — which is how the first version of this passed while testing nothing.
  const { client, reached } = clientReturning((url) => {
    if (url.endsWith('/v1/me')) return new Response(JSON.stringify({ product: 'premium' }), { status: 200 })
    if (url.includes('/v1/me/player') && !url.includes('moved')) {
      return new Response(null, { status: 302, headers: { location: 'https://api.spotify.com/v1/me/player?moved=1' } })
    }
    return new Response(JSON.stringify({ is_playing: false, item: null, device: null }), { status: 200 })
  })

  await client.player()
  const hops = reached.filter((h) => h === 'api.spotify.com').length
  assert.ok(hops >= 3, `only ${hops} requests were made — the hop was not followed`)
})

test('a bearer does not follow a redirect to a different declared host', async () => {
  // `HOSTS` holds three, and both ends of this hop are in it — so the host check says yes and
  // says nothing about what the request may carry. A token minted for `api.spotify.com` arriving
  // at `i.scdn.co` because a redirect said so is a credential somewhere it was never issued for.
  //
  // `fetch` with `redirect: 'follow'` strips `Authorization` across origins on our behalf.
  // Following by hand means doing it by hand, and the first version of the loop reused `init`
  // unchanged: a probe showed `Bearer SECRET-BEARER` arriving at the image CDN.
  const { client, carried } = clientReturning((url) => {
    if (url.endsWith('/v1/me')) return new Response(JSON.stringify({ product: 'premium' }), { status: 200 })
    if (url.includes('api.spotify.com')) {
      return new Response(null, { status: 302, headers: { location: 'https://i.scdn.co/image/abc' } })
    }
    return new Response('{}', { status: 200 })
  })

  await client.player()

  const crossed = carried.filter((c) => c.host === 'i.scdn.co')
  assert.ok(crossed.length > 0, 'the hop was never taken, so this asserted nothing')
  for (const hop of crossed) {
    assert.equal(hop.auth, null, 'the access token was sent to the image CDN')
  }
})

test('...but it does follow a redirect that stays on the same host', async () => {
  // The other direction, because stripping unconditionally would break the hop-following added
  // in the same change: the request would arrive unauthenticated and Spotify would answer 401.
  const { client, carried } = clientReturning((url) => {
    if (url.endsWith('/v1/me')) return new Response(JSON.stringify({ product: 'premium' }), { status: 200 })
    if (url.includes('/v1/me/player') && !url.includes('moved')) {
      return new Response(null, { status: 302, headers: { location: 'https://api.spotify.com/v1/me/player?moved=1' } })
    }
    return new Response(JSON.stringify({ is_playing: false, item: null, device: null }), { status: 200 })
  })

  await client.player()

  const moved = carried.filter((c) => c.host === 'api.spotify.com')
  assert.ok(moved.length >= 3, 'the same-host hop was not followed')
  for (const hop of moved) {
    assert.match(hop.auth ?? '', /^Bearer /, 'a same-host hop arrived without the token, and would be a 401')
  }
})

test('the token exchange refuses to be redirected at all, because the body is a credential', async () => {
  // A 307 or 308 resends the body, and that body carries `refresh_token` and `code_verifier` — a
  // long-lived credential and the secret protecting the exchange. Nothing about a token endpoint
  // should redirect, so a redirect is a reason to stop rather than a hop to validate. It needs a
  // hostile `accounts.spotify.com` to matter, which is exactly the case a declared list is for.
  let bodySentTwice = 0
  const { client } = clientReturning(
    (url) => {
      if (url.includes('accounts.spotify.com')) {
        bodySentTwice++
        return new Response(null, { status: 307, headers: { location: 'https://accounts.spotify.com/api/token?again=1' } })
      }
      return new Response('{}', { status: 200 })
    },
    { accessToken: 'stale', refreshToken: 'r', expiresAt: -1 },
  )

  const out = await client.player()

  assert.equal(out.state, 'unknown', 'the token exchange followed a redirect and carried on')
  assert.match(out.state === 'unknown' ? (out.why ?? '') : '', /must not be redirected/)
  assert.equal(bodySentTwice, 1, 'the credential-bearing body was sent more than once')
})

test('album art goes through the same door, rather than being fetched from wherever the API says', async () => {
  // `art()` took a URL straight out of a Spotify API response and fetched it with no host check
  // at all. The panel happened to be right because `i.scdn.co` is declared — luck, not the rule
  // this module states twenty lines above for `request()`. A missing thumbnail is what every
  // other failure here already produces.
  const { client, reached } = clientReturning((url) =>
    url.endsWith('/v1/me')
      ? new Response(JSON.stringify({ product: 'premium' }), { status: 200 })
      : url.includes('/v1/me/player')
      ? new Response(
          JSON.stringify({
            is_playing: true,
            device: { id: 'd', name: 'Desk', type: 'Computer', is_active: true, volume_percent: 50 },
            item: { name: 'Song', artists: [{ name: 'A' }], uri: 'spotify:track:1', duration_ms: 1, album: { images: [{ url: 'https://images.example.com/cover.jpg' }] } },
          }),
          { status: 200 },
        )
      : new Response('binary', { status: 200 }),
  )

  const playing = await client.player()

  assert.equal(reached.includes('images.example.com'), false, 'an undeclared host was contacted for artwork')
  // A missing thumbnail, not a broken controller: every other failure in `art()` already
  // produces exactly this, which is why routing it through the guard costs nothing.
  assert.equal(playing.state, 'playing', 'the whole controller broke over a picture')
  assert.equal(playing.state === 'playing' ? (playing.track?.artwork ?? null) : 'n/a', null)
})

// ──────────────────────────────────── what a status code is turned into on the way out ──

/**
 * The transport calls return words somebody can act on, not the number Spotify sent.
 *
 * The module says why, on the case that matters most:
 *
 *     404 from a transport call means "no active device" — Spotify's way of saying nobody was
 *     listening. Reported as that rather than as "not found", which would be true and useless.
 *
 * "Not found" is a correct description of the response and a wrong description of the situation.
 * It sends somebody looking for a missing track when what they need to do is open Spotify on a
 * speaker — and this string is rendered verbatim in the music panel, so whatever it says is what
 * the app claims happened. The third standing order, on the one surface whose whole content is a
 * claim about something outside this machine.
 *
 * These were the least-covered branches in the repository, which is what error paths in a
 * network client usually are: every one of them is a sentence a person reads on a bad day.
 */

const answering = (status: number): Spotify =>
  clientReturning(() => new Response(status === 204 ? null : '{}', { status })).client

test('a transport call with nobody listening says to open Spotify, not "not found"', async () => {
  const said = await answering(404).command('play')
  assert.match(
    said ?? '',
    /nothing is listening/i,
    `a 404 was reported as ${JSON.stringify(said)}. That is a true description of the response ` +
      `and a wrong one of the situation: it sends somebody looking for a missing track when what ` +
      `they need is to open Spotify on a device.`,
  )
  assert.equal(/404/.test(said ?? ''), false, 'the raw status code was passed through to the panel')
})

test('a refusal that Premium would fix says so', async () => {
  const said = await answering(403).command('pause')
  assert.match(said ?? '', /Premium/i, `a 403 was reported as ${JSON.stringify(said)} — unactionable`)
})

test('a status nobody has a sentence for still reports the number rather than nothing', async () => {
  // The fallback is not a failure of the design. An unmapped status is genuinely unknown, and
  // saying "Spotify answered 500" beats both silence and a guess about what it meant.
  const said = await answering(500).command('next')
  assert.match(said ?? '', /500/, `an unmapped status came back as ${JSON.stringify(said)}`)
})

test('the success Spotify actually sends is treated as success', async () => {
  // 204 No Content is what a working transport call returns. Reading it as "not ok" would report
  // every successful play, pause and skip as an error.
  for (const status of [200, 204]) {
    assert.equal(
      await answering(status).command('play'),
      null,
      `a ${status} was reported as a failure, so every working press says something went wrong`,
    )
  }
})

test('a client with no tokens says it is not connected rather than guessing', async () => {
  const client = clientReturning(() => new Response('{}', { status: 200 }), null).client
  assert.equal(await client.command('play'), 'not connected')
  assert.equal(await client.playTrack('spotify:track:x'), 'not connected')
})

test('a network that throws is reported in words, not swallowed', async () => {
  const client = new Spotify({
    clientId: 'id',
    store: { read: async () => ({ accessToken: 'live', refreshToken: 'r', expiresAt: Number.MAX_SAFE_INTEGER }), write: async () => {} },
    now: () => 0,
    fetch: (() => Promise.reject(new Error('getaddrinfo ENOTFOUND api.spotify.com'))) as typeof globalThis.fetch,
  })
  const said = await client.command('play')
  assert.match(
    said ?? '',
    /ENOTFOUND/,
    `a failed connection came back as ${JSON.stringify(said)}. A press that reports nothing reads ` +
      `as a press that worked, and the music does not change.`,
  )
})

test('playing a specific track gets the same sentence when nobody is listening', async () => {
  // Same situation, same words. Two transport paths that describe one condition differently is
  // how a person learns that the app's messages do not mean anything in particular.
  const said = await answering(404).playTrack('spotify:track:x')
  assert.match(said ?? '', /nothing is listening/i, `playTrack said ${JSON.stringify(said)} instead`)
})

test('an empty search asks Spotify nothing at all', async () => {
  // "The only user data this feature ever sends, and it is a string somebody typed into a box
  // labelled search." A blank box is not a query, and sending one is a request nobody made.
  const rig = clientReturning(() => new Response('{}', { status: 200 }))
  assert.deepEqual(await rig.client.search('   '), [])
  assert.deepEqual(rig.reached, [], 'a blank search box sent a request to Spotify')
})

test('search asks for tracks and nothing else', async () => {
  // "Tracks only — a controller has no use for the other five result types and asking for them
  // would be asking for more than we need."
  const asked: string[] = []
  const client = new Spotify({
    clientId: 'id',
    store: { read: async () => ({ accessToken: 'live', refreshToken: 'r', expiresAt: Number.MAX_SAFE_INTEGER }), write: async () => {} },
    now: () => 0,
    fetch: (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      asked.push(url)
      const answer = new Response(JSON.stringify({ tracks: { items: [] } }), { status: 200 })
      Object.defineProperty(answer, 'url', { value: url, configurable: true })
      return answer
    }) as typeof globalThis.fetch,
  })

  await client.search('ghosts')
  const search = asked.find((url) => url.includes('/search'))
  assert.ok(search, `no search request was made: ${JSON.stringify(asked)}`)

  const type = new URL(search).searchParams.get('type')
  assert.equal(type, 'track', `the search asked for ${JSON.stringify(type)} — more than a controller needs`)
})

test('moving playback to a device that has gone says so, like every other transport call', async () => {
  // `transferTo` is the answer to "nothing is listening" — it is the call somebody makes
  // *because* the last one told them nothing was. A 404 here means the device they just picked
  // is no longer there, usually because a phone locked or a speaker slept between the list being
  // drawn and the button being pressed.
  //
  // Its two siblings translate that status; this one did not, so the one path a person reaches
  // by following the app's own advice answered with the "true and useless" string the module
  // refuses to send anywhere else.
  const said = await answering(404).transferTo('device-that-slept', true)
  assert.equal(
    /^Spotify answered/.test(said ?? ''),
    false,
    `moving playback to a vanished device said ${JSON.stringify(said)}. Every other transport ` +
      `call turns that status into something a person can act on; this is the one they reach by ` +
      `doing what the app just told them to do.`,
  )
  assert.match(said ?? '', /device/i, `expected the message to mention the device: ${JSON.stringify(said)}`)
})

test('a transfer that works reports nothing wrong', async () => {
  for (const status of [200, 204]) {
    assert.equal(await answering(status).transferTo('d', true), null, `a ${status} transfer was reported as a failure`)
  }
})

test('a transfer with no tokens says it is not connected', async () => {
  const client = clientReturning(() => new Response('{}', { status: 200 }), null).client
  assert.equal(await client.transferTo('d', true), 'not connected')
})
