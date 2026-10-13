/**
 * The sign-in flow, which could not be tested because of a fallback.
 *
 * `spotify/connect.ts` opens a loopback server, sends a browser to Spotify's consent page, and
 * waits for a redirect carrying an authorisation code. It was one of two modules in the whole
 * repository that could not even be *imported* by a test — and the reason was
 * `import { shell } from 'electron'` at the top, used for nothing but the default value of an
 * argument the caller already injects. The OAuth flow was unreachable because of a fallback,
 * not because of anything it does. That import is lazy now.
 *
 * ## What is worth pinning here
 *
 * The state check itself lives in `readCallback` and has its own tests. What did not is
 * everything around it — the parts that are about *this being a server on somebody's machine*:
 *
 * 1. **The listener binds to `127.0.0.1`, never `0.0.0.0`.** It exists for one redirect from
 *    this machine's own browser and has no business being reachable from the network.
 * 2. **The server is always closed** — on success, on refusal, on a thrown error, on a client id
 *    that never opens it. A loopback listener left running is an open door and a held port, and
 *    the next attempt answers `EADDRINUSE`.
 * 3. **A redirect carrying the wrong `state` is not accepted.** That is CSRF on the callback,
 *    and it is the one check where being approximately right is being wrong.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConnection } from 'node:net'

import { connect, REDIRECT_PORT, REDIRECT_URI } from '../src/main/spotify/connect.js'

/** Whether anything is listening on the loopback port right now. */
function portHeld(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port: REDIRECT_PORT, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

const noFetch: typeof globalThis.fetch = () => {
  throw new Error('the flow reached the network when it should not have')
}

test('the redirect stays on the loopback interface', () => {
  // Stated where it is checkable. `0.0.0.0` here would put a listener that accepts an OAuth code
  // on every interface the machine has, for the sake of one redirect from its own browser.
  assert.match(REDIRECT_URI, /^http:\/\/127\.0\.0\.1:/, 'the redirect is no longer loopback-only')
  assert.doesNotMatch(REDIRECT_URI, /0\.0\.0\.0|localhost/, 'the redirect resolves through a name rather than the loopback address')
})

test('an empty client id opens nothing and holds no port', async () => {
  let opened = 0
  const out = await connect('   ', noFetch, async () => {
    opened += 1
  })

  assert.equal(out.ok, false)
  assert.match(out.problem ?? '', /No Spotify client id/)
  assert.equal(opened, 0, 'a browser was sent to a consent page with no client id')
  assert.equal(await portHeld(), false, 'a listener was left running for a sign-in that never started')
})

test('the server is closed when the browser refuses to open', async () => {
  // The path that matters most for the port: something throws *after* `listen` succeeded. The
  // `finally` is what makes this true, and without it every failed attempt holds 8888 until the
  // app quits — so the next one reports "already in use" about itself.
  const out = await connect('client-abc', noFetch, async () => {
    throw new Error('no browser here')
  })

  assert.equal(out.ok, false)
  assert.match(out.problem ?? '', /no browser here/, 'the real reason was swallowed')
  assert.equal(await portHeld(), false, 'the loopback server was left listening after a failure')
})

test('a second attempt after a failure is not blocked by the first', async () => {
  // The observable consequence of the previous test, stated as the thing a person would hit.
  // Two failed sign-ins in a row must both fail for their own reason, not the second for the
  // first's leftovers.
  const first = await connect('client-abc', noFetch, async () => {
    throw new Error('first failure')
  })
  const second = await connect('client-abc', noFetch, async () => {
    throw new Error('second failure')
  })

  assert.match(first.problem ?? '', /first failure/)
  assert.match(
    second.problem ?? '',
    /second failure/,
    'the second attempt failed for the first attempt\'s reason — the port was still held',
  )
  assert.doesNotMatch(second.problem ?? '', /already in use/, 'the flow blocked itself')
})

test('the consent url carries a state and a challenge, and names our redirect', async () => {
  // What the browser is actually sent to. A missing `state` is the CSRF check absent rather than
  // wrong, and a missing `code_challenge` is PKCE absent — both would still sign in.
  let sentTo = ''
  await connect('client-abc', noFetch, async (url) => {
    sentTo = url
    throw new Error('stop here')
  })

  const url = new URL(sentTo)
  assert.equal(url.host, 'accounts.spotify.com', 'the browser was sent somewhere else')
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256', 'PKCE is not being used')
  assert.ok((url.searchParams.get('state') ?? '').length > 10, 'no state, so the callback cannot be checked')
  assert.ok((url.searchParams.get('code_challenge') ?? '').length > 10, 'no challenge, so PKCE is decorative')
})

test('two sign-ins do not share a state or a challenge', async () => {
  // A fixed state is the same as no state: the check passes for anybody who has ever seen one.
  const urls: string[] = []
  for (let i = 0; i < 2; i++) {
    await connect('client-abc', noFetch, async (url) => {
      urls.push(url)
      throw new Error('stop here')
    })
  }

  const [a, b] = urls.map((u) => new URL(u))
  assert.notEqual(a?.searchParams.get('state'), b?.searchParams.get('state'), 'the state is reused between attempts')
  assert.notEqual(
    a?.searchParams.get('code_challenge'),
    b?.searchParams.get('code_challenge'),
    'the PKCE verifier is reused between attempts',
  )
})

test('a sign-in that never completes leaves no timer behind', async () => {
  /*
   * The wait was armed before the browser was opened and cleared only when a redirect arrived, so
   * every other ending left a three-minute timer holding the event loop — and with it this flow's
   * `state` and its `resolve`.
   *
   * It cost three minutes per test file. `oauth-connect.test.ts` ran its six tests in ten
   * milliseconds and then took **181.9 seconds to exit**; with `spotify-connect.test.ts` doing the
   * same, the two of them were the whole suite's critical path — 228s down to 98s once the timer
   * was tied to the server's lifetime. CI was timing out at ten minutes on this.
   *
   * Asserted on the process's own live handles rather than on elapsed time, because a test that
   * waited to find out would be the bug it is checking for. `getActiveResourcesInfo` reports
   * `Timeout` for each armed timer, so the count is the observation.
   */
  const timersNow = (): number =>
    process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length

  const before = timersNow()
  const out = await connect('client-abc', noFetch, async () => {
    throw new Error('the browser would not open')
  })

  assert.equal(out.ok, false, 'the fixture no longer fails, so this proves nothing')
  assert.match(out.problem ?? '', /would not open/)
  assert.equal(
    timersNow(),
    before,
    'a sign-in that ended without a redirect left its three-minute wait armed — the flow is over ' +
      'and something is still holding the loop open',
  )
})
