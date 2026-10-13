/**
 * Signing in: a browser, a loopback listener, and one exchange.
 *
 * The user's browser is where the sign-in happens, and that is not a limitation to work around
 * — it is the point. Spotify's password is typed into Spotify's page in the user's own browser,
 * with their own password manager and their own second factor. **Office Space never sees a
 * Spotify credential**, and cannot, because nothing it draws is ever the login form. An embedded
 * webview would technically work and would be exactly the thing a phishing page imitates.
 *
 * ## The fixed port, which is a constraint rather than a preference
 *
 * Spotify only redirects to a URI registered in the developer dashboard beforehand, so the port
 * cannot be chosen at runtime — an ephemeral port would produce a redirect URI nobody had
 * registered and the sign-in would fail at the last step. It is bound to `127.0.0.1` and not
 * `0.0.0.0`, so it is reachable from this machine and not from the network, and it is open for
 * the seconds the round trip takes and closed in a `finally`.
 *
 * ## Why the user brings their own client id
 *
 * There is no client id in this repository. A shipped one would be a shared identity: every
 * install's requests would count against one app's rate limits, and the redirect URI whitelist
 * would be ours to hold on everybody's behalf. Under PKCE the id is not a secret, so shipping
 * one is *safe* — it is simply not *ours to give*. Somebody who wants the feature registers a
 * two-field app and pastes the id; the panel says so in those words.
 */

import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'

import {
  authorizeUrl,
  base64url,
  createVerifier,
  expiryFrom,
  HOSTS,
  readCallback,
  TOKEN_URL,
  type Tokens,
} from '../../shared/spotify/auth.js'

/**
 * The port, and the path.
 *
 * Registered by the user in their Spotify dashboard exactly as printed here. Changing either of
 * these breaks every existing install's sign-in, which is why they are constants with this
 * comment rather than options.
 */
export const REDIRECT_PORT = 8888
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`

/** Long enough to find the browser window and read the consent screen; short enough to end. */
const WAIT_MS = 180_000

export interface ConnectResult {
  readonly ok: boolean
  readonly tokens: Tokens | null
  /** Shown verbatim. Never a friendlier paraphrase — the same rule as `SessionState.error`. */
  readonly problem: string | null
}

/**
 * Run the whole round trip.
 *
 * One function rather than a start/finish pair because the listener, the verifier and the state
 * all have exactly this lifetime — splitting it would mean holding a half-finished sign-in
 * somewhere, and a stale verifier sitting in memory is the thing PKCE exists to avoid.
 */
export async function connect(
  clientId: string,
  /**
   * Passed in rather than reached for, so the master switch reaches this module too.
   *
   * The caller hands over a gated fetch. There is no `globalThis.fetch` in this file for the
   * same reason there is none in `client.ts`: a control that only covers the places somebody
   * remembered is not a control.
   *
   * Required, with no default. It had one — the real `globalThis.fetch` — which made the sentence
   * above false and put the bypass back for any caller that left the argument out: `main.ts`
   * passed the gated one, and nothing else had to. `fetchModel` in `voice/transcribe.ts` refuses a
   * default for the same reason, and `test/every-way-out-is-switched-and-listed.test.ts` fails if
   * either comes back.
   */
  fetchImpl: typeof globalThis.fetch,
  /**
   * How the consent page is opened. Injected, with Electron's shell as the default.
   *
   * The import is **lazy** and that is the whole reason this module can be tested. It was
   * `import { shell } from 'electron'` at the top, used for nothing but this one default — and a
   * top-level electron import means no `node:test` file can load the module at all, whatever it
   * wants to check. The OAuth flow was untestable because of a fallback, not because of anything
   * it does.
   *
   * Same barrier as `spotify/store.ts` and `main.ts`; see `every-module-is-aimed-at.test.ts`,
   * which measured that 23 of the 25 modules nothing aimed at load fine in plain `node` and this
   * was one of the two that did not.
   */
  openBrowser: (url: string) => Promise<void> = async (url) => {
    const { shell } = await import('electron')
    await shell.openExternal(url)
  },
): Promise<ConnectResult> {
  if (!clientId.trim()) {
    return { ok: false, tokens: null, problem: 'No Spotify client id. Add one in the privacy panel.' }
  }

  const verifier = createVerifier((n) => new Uint8Array(randomBytes(n)))
  const challenge = base64url(new Uint8Array(createHash('sha256').update(verifier).digest()))
  const state = base64url(new Uint8Array(randomBytes(16)))

  const server = createServer()
  try {
    const waiting = waitForCode(server, state)
    await listen(server)
    await openBrowser(authorizeUrl({ clientId, redirectUri: REDIRECT_URI, challenge, state }))

    const callback = await waiting
    if (callback.kind === 'denied') {
      return { ok: false, tokens: null, problem: `Spotify sign-in did not complete — ${callback.reason}.` }
    }

    return await exchange(clientId, verifier, callback.code, fetchImpl)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    // The specific failure worth naming: something else already owns the port, so the browser
    // would come back to a door nobody is behind.
    const detail = why.includes('EADDRINUSE')
      ? `Port ${REDIRECT_PORT} is already in use, so Spotify's reply had nowhere to land.`
      : why
    return { ok: false, tokens: null, problem: detail }
  } finally {
    server.close()
  }
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    // `127.0.0.1`, never `0.0.0.0`: this listener exists for one redirect from this machine's
    // own browser and has no business being reachable from the network.
    server.listen(REDIRECT_PORT, '127.0.0.1', () => resolve())
  })
}

/** Resolve on the first request that carries our state, and tell the browser it can close. */
function waitForCode(
  server: ReturnType<typeof createServer>,
  state: string,
): Promise<ReturnType<typeof readCallback>> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ kind: 'denied', reason: 'nothing came back in three minutes' }),
      WAIT_MS,
    )

    /*
     * The wait belongs to the server's lifetime, not to the callback's.
     *
     * `clearTimeout` below runs only when a redirect actually arrives. Every other ending — the
     * browser refusing to open, the port already held, an error mid-flow — left this armed for the
     * full three minutes, holding the event loop and this closure's `state` and `resolve` with it.
     * `connect` closes the server in a `finally`, so every path passes through here.
     */
    server.once('close', () => clearTimeout(timer))

    server.on('request', (request, response) => {
      const result = readCallback(request.url ?? '', state)
      // A page rather than a redirect, because there is nowhere honest to redirect *to*: the app
      // is already open behind the browser. Plain text, so nothing here can be a link somebody
      // clicks by accident.
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(
        result.kind === 'code'
          ? 'Connected. You can close this tab and go back to Office Space.'
          : `Not connected — ${result.reason}. You can close this tab.`,
      )
      clearTimeout(timer)
      resolve(result)
    })
  })
}

/**
 * Spend the code.
 *
 * No client secret in the body — that is the whole of PKCE: the verifier proves this is the same
 * app that started the flow, and it never left this process.
 */
async function exchange(
  clientId: string,
  verifier: string,
  code: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<ConnectResult> {
  if (!HOSTS.includes(new URL(TOKEN_URL).host)) {
    throw new Error('the token endpoint is not in the declared egress list')
  }

  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    // 400 here is nearly always one of two mistakes in the dashboard, and saying which two saves
    // somebody an hour of reading Spotify's docs for a message that says `invalid_grant`.
    const hint =
      response.status === 400
        ? ` Check that the client id is right and that ${REDIRECT_URI} is listed as a redirect URI.`
        : ''
    return { ok: false, tokens: null, problem: `Spotify refused the sign-in (${response.status}).${hint} ${body}`.trim() }
  }

  const json = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number }
  return {
    ok: true,
    problem: null,
    tokens: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: expiryFrom(json.expires_in, Date.now()),
    },
  }
}
