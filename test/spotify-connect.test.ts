/**
 * The sign-in round trip, driven end to end over a real loopback socket.
 *
 * Nothing aimed at this module. It is the one place in the app that opens a listening socket and
 * the one that handles an OAuth callback, which makes the properties below the two most
 * load-bearing lines in the repository — and both fail to a single token.
 *
 * ## The listener is for this machine's own browser
 *
 *     `127.0.0.1`, never `0.0.0.0`: this listener exists for one redirect from this machine's
 *     own browser and has no business being reachable from the network.
 *
 * `'127.0.0.1'` -> `'0.0.0.0'` is a seven-character edit that puts an OAuth callback handler on
 * every interface of the machine, and nothing about the app looks or behaves differently
 * afterwards. It is checked here by trying to bind the same port on a real non-loopback address
 * while the flow is listening: that succeeds only if the flow left that address alone.
 *
 * ## And the callback has to be ours
 *
 * `readCallback(url, state)` is the CSRF check — a browser can be sent to this port by any page
 * on this machine, and the `state` is the only thing distinguishing Spotify's redirect from
 * somebody else's. Its unit is elsewhere; what was never checked is that `connect` passes the
 * state it generated rather than, say, the one in the request.
 *
 * ## What this never does
 *
 * It never reaches Spotify. `fetchImpl` and `openBrowser` are both injected — "a control that
 * only covers the places somebody remembered is not a control" — so the only socket this file
 * opens is the loopback one under test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'

import { connect, REDIRECT_PORT, REDIRECT_URI } from '../src/main/spotify/connect.js'

/** A local address that is not the loopback, or null when this machine has none. */
function offLoopback(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return null
}

interface Run {
  readonly opened: string[]
  readonly posted: { url: string; body: string }[]
  readonly result: Promise<Awaited<ReturnType<typeof connect>>>
}

/**
 * Start a sign-in and hand back the consent URL the moment the browser is "opened".
 *
 * The flow blocks on the callback, so the test drives it the way a browser does: read the state
 * out of the URL the app tried to open, then make a real request to the loopback listener.
 */
function start(options: { token?: () => Response; clientId?: string } = {}): Run & { url: Promise<string> } {
  const opened: string[] = []
  const posted: { url: string; body: string }[] = []
  let announce: (url: string) => void = () => {}
  const url = new Promise<string>((resolve) => (announce = resolve))

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    posted.push({ url: target, body: String(init?.body ?? '') })
    return options.token
      ? options.token()
      : new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }), { status: 200 })
  }) as typeof globalThis.fetch

  const result = connect(options.clientId ?? 'a-client-id', fetchImpl, async (consent) => {
    opened.push(consent)
    announce(consent)
  })

  return { opened, posted, result, url }
}

/** What the browser does after consent: come back to the loopback with a code. */
const callback = async (query: string): Promise<{ status: number; type: string; body: string }> => {
  const response = await fetch(`http://127.0.0.1:${REDIRECT_PORT}/callback?${query}`)
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    body: await response.text(),
  }
}

const stateOf = (consentUrl: string): string => new URL(consentUrl).searchParams.get('state') ?? ''

test('no client id refuses without opening a browser or a socket', async () => {
  // Starting a flow that cannot finish opens a consent page for an app Spotify does not know,
  // and holds a port for the three-minute timeout to do it.
  const run = start({ clientId: '   ' })
  const result = await run.result

  assert.equal(result.ok, false)
  assert.match(result.problem ?? '', /client id/i)
  assert.deepEqual(run.opened, [], 'a browser was opened for a sign-in that could not complete')
})

test('the whole round trip: consent, callback, exchange, tokens', async () => {
  const run = start()
  const consent = await run.url

  // The control: the consent URL must be Spotify's own, or every assertion below is about a
  // page this app made up.
  assert.equal(new URL(consent).host, 'accounts.spotify.com', `consent went to ${new URL(consent).host}`)
  assert.equal(new URL(consent).searchParams.get('redirect_uri'), REDIRECT_URI)
  assert.equal(
    new URL(consent).searchParams.get('code_challenge_method'),
    'S256',
    'the challenge method is not S256, so this is not PKCE',
  )

  const page = await callback(`code=the-code&state=${encodeURIComponent(stateOf(consent))}`)
  const result = await run.result

  assert.equal(result.ok, true, `the sign-in failed: ${result.problem}`)
  assert.deepEqual(result.tokens?.accessToken, 'a')
  assert.ok((result.tokens?.expiresAt ?? 0) > Date.now(), 'the token expiry is already in the past')

  // The browser is answered with a page, not a redirect: "there is nowhere honest to redirect
  // to", and plain text means nothing here can be a link somebody clicks by accident.
  assert.equal(page.status, 200)
  assert.match(page.type, /text\/plain/, `the callback answered ${page.type}`)
  assert.match(page.body, /close this tab/i)
})

test('the code is spent with the verifier and no client secret', async () => {
  // The whole of PKCE. A secret in this body would mean the repository ships one, or the user
  // pastes one into a desktop app that cannot keep it.
  const run = start()
  const consent = await run.url
  await callback(`code=the-code&state=${encodeURIComponent(stateOf(consent))}`)
  await run.result

  const exchange = run.posted.find((p) => p.url.includes('token'))
  assert.ok(exchange, `no token request was made: ${JSON.stringify(run.posted.map((p) => p.url))}`)

  const body = new URLSearchParams(exchange.body)
  assert.equal(body.get('grant_type'), 'authorization_code')
  assert.equal(body.get('code'), 'the-code')
  assert.ok(body.get('code_verifier'), 'no verifier was sent, so nothing proves this is the app that started the flow')
  assert.equal(body.get('client_secret'), null, 'a client secret was sent from a desktop app that cannot hold one')

  // The verifier, not the challenge. Sending the challenge would make the exchange fail against
  // real Spotify and pass against any stub that only checks the field is present.
  assert.notEqual(
    body.get('code_verifier'),
    new URL(consent).searchParams.get('code_challenge'),
    'the challenge was sent where the verifier belongs — these are the two halves of PKCE and ' +
      'swapping them makes the proof meaningless',
  )
})

test('a callback carrying the wrong state is refused', async () => {
  // Any page on this machine can send a browser to this port. The state is the only thing that
  // makes Spotify's redirect different from theirs.
  const run = start()
  await run.url

  const page = await callback('code=injected&state=not-the-one-we-issued')
  const result = await run.result

  assert.equal(result.ok, false, 'a callback with somebody else’s state completed the sign-in')
  assert.deepEqual(run.posted, [], 'a code from an unverified callback was spent at the token endpoint')
  assert.match(page.body, /Not connected/i, 'the browser was told the sign-in worked')
})

test('a user who declines is reported as declining, not as a fault', async () => {
  const run = start()
  const consent = await run.url

  await callback(`error=access_denied&state=${encodeURIComponent(stateOf(consent))}`)
  const result = await run.result

  assert.equal(result.ok, false)
  assert.match(result.problem ?? '', /did not complete/i, `said ${JSON.stringify(result.problem)}`)
  assert.deepEqual(run.posted, [], 'a refused sign-in still called the token endpoint')
})

test('Spotify refusing the exchange says which two things to check', async () => {
  // 400 here is nearly always one of two dashboard mistakes, and `invalid_grant` alone costs
  // somebody an hour.
  const run = start({ token: () => new Response('{"error":"invalid_grant"}', { status: 400 }) })
  const consent = await run.url
  await callback(`code=c&state=${encodeURIComponent(stateOf(consent))}`)
  const result = await run.result

  assert.equal(result.ok, false)
  assert.match(result.problem ?? '', /client id/i, `said ${JSON.stringify(result.problem)}`)
  assert.match(result.problem ?? '', new RegExp(REDIRECT_URI.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('the listener is not reachable from the network', async (t) => {
  // The seven-character edit. Bound to `0.0.0.0`, this same port answers an OAuth callback from
  // anything that can route to this machine.
  const address = offLoopback()
  const run = start()
  const consent = await run.url

  if (address === null) {
    /*
     * Absent is not empty, and this is the reporting half of that.
     *
     * `assert.ok(true)` with a `console.log` beside it made this count as a **pass** — a bind
     * check that never ran, reported identically to one that ran and held. `t.skip` puts it under
     * `# skipped` in the summary with its reason attached, which is the difference between a
     * suite that says it covered this and a suite that says it could not.
     */
    t.skip('no non-loopback IPv4 address on this machine, so the bind check cannot run here')
  } else {
    const decoy = createServer()
    await new Promise<void>((resolve, reject) => {
      decoy.once('error', reject)
      decoy.listen(REDIRECT_PORT, address, () => resolve())
    }).then(
      () => decoy.close(),
      (error: Error) => {
        assert.fail(
          `binding ${address}:${REDIRECT_PORT} was refused (${error.message}), which means the ` +
            `sign-in listener is already holding that address. It is meant to be on 127.0.0.1 ` +
            `only — an OAuth callback handler on every interface answers anything that can ` +
            `route to this machine.`,
        )
      },
    )
  }

  await callback(`code=c&state=${encodeURIComponent(stateOf(consent))}`)
  await run.result
})

test('the port is given back afterwards, so a second sign-in can start', async () => {
  // Closed in a `finally`. Left open, the first failed sign-in of a session makes every later
  // one report the port as in use.
  const first = start()
  const consent = await first.url
  await callback(`code=c&state=${encodeURIComponent(stateOf(consent))}`)
  await first.result

  const second = start()
  const again = await second.url
  await callback(`code=c2&state=${encodeURIComponent(stateOf(again))}`)
  const result = await second.result
  assert.equal(result.ok, true, `the second sign-in failed: ${result.problem}`)
})

test('a port somebody else owns is named, not passed through raw', async () => {
  const squatter = createServer()
  await new Promise<void>((resolve) => squatter.listen(REDIRECT_PORT, '127.0.0.1', () => resolve()))
  try {
    const result = await start().result
    // Not `/already in use/` — Node's own message is "listen EADDRINUSE: address already in
    // use 127.0.0.1:8888", so that pattern passes on the raw error too and the assertion cannot
    // tell the two apart. Mutation testing is what surfaced that: replacing the sentence with
    // the raw error left this test green. Match on what only the written sentence says.
    assert.match(
      result.problem ?? '',
      /nowhere to land/i,
      `an occupied port reported ${JSON.stringify(result.problem)} — "EADDRINUSE" names the ` +
        `syscall and tells somebody nothing about why the browser came back to a door with ` +
        `nobody behind it`,
    )
    assert.equal(
      /EADDRINUSE/.test(result.problem ?? ''),
      false,
      'the raw error text reached the panel, which shows `problem` verbatim',
    )
  } finally {
    squatter.close()
  }
})
