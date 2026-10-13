/**
 * Turning a recording into text, locally.
 *
 * The same premise as the rest of this app: **it runs a program you have, on your machine, and
 * sends nothing anywhere.** Office Space does not bundle Claude either — it spawns the `claude`
 * you already installed. Dictation works the same way, for the same reasons: no key, no account,
 * no per-minute cost, and no sentence you spoke leaving the laptop you spoke it on.
 *
 * ## Finding the program
 *
 * Three places, in this order, and the order is the point:
 *
 *   1. **The office's own copy**, under `userData/whisper/`. Where the setup step puts it, so a
 *      person who pressed the button once never thinks about this again.
 *   2. **A copy on `PATH`**, under any of the names the project has shipped under. `whisper-cli`
 *      is current; `whisper-cpp` is Homebrew's; `main` is what the binary was called for years
 *      and is still what an older build leaves behind.
 *   3. **Nowhere**, which is a real answer and is reported as one. A dictation button that fails
 *      silently is worse than no dictation button, because the person concludes their microphone
 *      is broken.
 *
 * ## Why not the browser's speech API
 *
 * Because it does not work here, and this was measured rather than assumed — in the running app,
 * `SpeechRecognition` gave `ERROR:network` after `start > audiostart > audioend`. The microphone
 * opens; Chromium cannot reach the backend, because Electron ships without the key it needs.
 */

import { spawn } from 'node:child_process'
import { access, constants, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The names whisper.cpp's CLI has shipped under. Newest first. */
export const WHISPER_NAMES: readonly string[] = ['whisper-cli', 'whisper-cpp', 'whisper', 'main']

export interface Whisper {
  /** The program to run. */
  readonly binary: string
  /** The model file it needs. Whisper cannot do anything without one. */
  readonly model: string
}

export type Setup =
  | { readonly state: 'ready'; readonly whisper: Whisper }
  /** A program was found and a model was not, or the other way round. Says which. */
  | { readonly state: 'incomplete'; readonly missing: 'binary' | 'model'; readonly detail: string }

export interface Transcript {
  readonly ok: boolean
  /** What was said. Empty when nothing was, which is not a failure. */
  readonly text: string
  /** Why not, in words for the person who pressed the button. Never a code. */
  readonly reason?: string
}

const there = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const readable = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Where a program on `PATH` actually is.
 *
 * `PATH` rather than a shell, because a login shell is a different environment from the one an
 * Electron app inherits from Finder — the classic version of this bug is a feature that works
 * when the app is launched from a terminal and does not when it is launched by double-clicking.
 */
async function onPath(name: string, path: string | undefined): Promise<string | null> {
  for (const dir of (path ?? '').split(':')) {
    if (dir === '') continue
    const candidate = join(dir, name)
    if (await there(candidate)) return candidate
  }
  return null
}

export interface FindOptions {
  /** The office's own directory, searched first. */
  readonly own: string
  readonly path?: string | undefined
  /** Names to look for. Injected so the search itself is testable. */
  readonly names?: readonly string[]
}

/**
 * Is dictation ready, and if not, which half is missing?
 *
 * Two states rather than a boolean, because "no program" and "no model" are different problems
 * with different fixes, and a setup screen that cannot tell you which one you have is a setup
 * screen that makes you guess.
 */
export async function findWhisper(options: FindOptions): Promise<Setup> {
  const names = options.names ?? WHISPER_NAMES

  let binary: string | null = null
  for (const name of names) {
    const own = join(options.own, name)
    if (await there(own)) {
      binary = own
      break
    }
  }
  if (binary === null) {
    for (const name of names) {
      const found = await onPath(name, options.path)
      if (found !== null) {
        binary = found
        break
      }
    }
  }

  if (binary === null) {
    return {
      state: 'incomplete',
      missing: 'binary',
      detail: `Looked for ${names.join(', ')} in the office's own directory and on PATH.`,
    }
  }

  const model = join(options.own, MODEL_FILE)
  if (!(await readable(model))) {
    return {
      state: 'incomplete',
      missing: 'model',
      detail: `${binary} is here, but it has no model to run. Expected ${model}.`,
    }
  }

  return { state: 'ready', whisper: { binary, model } }
}

/**
 * The model the office downloads.
 *
 * `base.en` rather than something larger: 148MB, English, and fast enough on a laptop CPU that a
 * spoken sentence comes back before the person has finished deciding whether it worked. The
 * bigger models are better at proper nouns and worse at being pressed on impulse, and this is a
 * button somebody presses mid-thought.
 */
export const MODEL_FILE = 'ggml-base.en.bin'

/**
 * Everywhere this module can reach, which is one place.
 *
 * The privacy panel lists this array as the complete set of destinations, so a request built
 * against a host that is not in it would make the panel wrong. Checked below rather than merely
 * written down — a declared list nothing enforces is a comment.
 *
 * `spotify/client.ts` states the same rule in the same words and does **not** yet keep it: it
 * validates the host and calls `fetch` without a `redirect` option, which is `'follow'`, so it
 * checks the request and connects wherever it is sent — the exact defect this module had. This
 * comment used to cite it as the contract being kept. It is not fixed here, because that is a
 * different module with a different token in flight, and it is named here so the next person
 * needing this pattern copies the one that works.
 *
 * **What you say is not in here and never will be.** The recording is written to a temporary
 * file, read by a program on this machine, and deleted. Downloading the model once is exactly
 * what buys that.
 */
export const HOSTS: readonly string[] = ['huggingface.co']

/**
 * The hosts a model download actually reaches, which is not the host it asks.
 *
 * `HOSTS` was enforced against the URL and the fetch then ran with `redirect: 'follow'`, so the
 * check validated the request and the connections went wherever they were sent. They are sent
 * elsewhere: the model URL answers 302 to `us.aws.cdn.hf.co`, Hugging Face's CDN, every time.
 *
 *     $ curl -sI .../resolve/main/ggml-base.en.bin
 *     status: 302
 *     redirected to: https://us.aws.cdn.hf.co/xet-bridge-us/…
 *
 * So the panel's *complete set of destinations* was wrong for anybody who had ever pressed the
 * microphone, and the check that was supposed to keep it right could not see it. The comment
 * above is the one that says a declared list nothing enforces is a comment; this is the same
 * fault one layer in, a declared list enforcing the wrong thing.
 *
 * A suffix rather than a name because the CDN host is regional and rotates — `us.aws.cdn.hf.co`
 * today. The leading dot is what makes it a suffix rule and not a substring one: `evil-hf.co`
 * does not end with `.hf.co`, and `hf.co` itself is listed separately rather than by stripping
 * the dot, which would have let it through.
 */
export const DOWNLOAD_SUFFIXES: readonly string[] = ['.hf.co', '.huggingface.co']
const DOWNLOAD_HOSTS: readonly string[] = ['huggingface.co', 'hf.co']

/** Whether a host is one this app has declared it can reach while fetching the model. */
export function isDeclaredDownloadHost(host: string): boolean {
  return DOWNLOAD_HOSTS.includes(host) || DOWNLOAD_SUFFIXES.some((s) => host.endsWith(s))
}

/** How many hops to follow. Hugging Face uses one; more than a handful is a loop. */
const MAX_REDIRECTS = 5
export const MODEL_HOST = HOSTS[0]!
export const MODEL_URL =
  `https://${MODEL_HOST}/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`

/**
 * Where a download may go, injected so a test can steer it.
 *
 * The same reason `claude-path.ts` takes its `system` locations as a parameter: a check whose
 * inputs are read off the real world is a check a test cannot aim. Without this the only way to
 * exercise the redirect logic is to point `fetchModel` at a local server — which the *first*
 * host check refuses before any of it runs, so the test passes on the wrong refusal and reports
 * a hop guard it never reached. That is exactly what the first version of the test for this did,
 * with a comment claiming a stub that did not exist.
 */
export interface DownloadPolicy {
  /** Whether the initial URL may be requested at all. */
  readonly startsAt: (host: string) => boolean
  /** Whether a redirect may be followed to this host. */
  readonly follows: (host: string) => boolean
  /**
   * Whether the *first* request may be plaintext. False in production.
   *
   * Two knobs rather than one, and the reason is that a test cannot supply a certificate. The
   * loop can only be exercised against local servers, which are `http:` — so a single flag
   * would have to permit the initial request and the hops together, and the case worth testing
   * is exactly the one where the start is permitted and the hop is not. Named separately so
   * each test says which rule it is exercising.
   */
  readonly startsInsecure?: boolean
  /** Whether a hop may be plaintext. False in production. */
  readonly followsInsecure?: boolean
}

const REAL_POLICY: DownloadPolicy = {
  startsAt: (host) => HOSTS.includes(host),
  follows: isDeclaredDownloadHost,
}

/**
 * Fetch the model into the office's own directory.
 *
 * The app's job rather than the person's: it is 148MB from a known URL to a known path, which is
 * exactly the kind of errand software should run for you. The binary is the other half and is
 * not this — on macOS there is no prebuilt whisper CLI to fetch (the project ships Windows and
 * Linux binaries and an xcframework), so that half is one Homebrew command and the app says so
 * rather than pretending.
 *
 * Downloads to a temporary name and renames on success. A half-written model at the real path
 * would be found by {@link findWhisper}, reported as ready, and fail on every recording after —
 * absent is not empty, and neither is half-there.
 *
 * `net` is required, and has no default, deliberately.
 *
 * `spotify/gate.ts` argues that the master network switch "cannot be bypassed by writing new
 * code — a new call site inherits it by construction, because there is no other `fetch` in
 * reach." That was not true of this function: it called the global `fetch` directly, so with the
 * switch off, pressing the microphone still opened a connection to huggingface.co and followed a
 * redirect to a CDN for a 148 MB download.
 *
 * The switch's own label makes no exception for it — *"Office Space may make its own network
 * requests. Click to stop it."* — so a person who has clicked it has been told this does not
 * happen.
 *
 * A default of `globalThis.fetch` would put the bypass straight back, one call site at a time, so
 * there is no default. The caller has to hand in a fetch, and `main.ts` hands in the gated one.
 */
export async function fetchModel(
  home: string,
  net: typeof globalThis.fetch,
  url: string = MODEL_URL,
  policy: DownloadPolicy = REAL_POLICY,
): Promise<RemovalLike> {
  const { mkdir, rename, rm: remove } = await import('node:fs/promises')
  const { writeFile: write } = await import('node:fs/promises')
  const partial = join(home, `${MODEL_FILE}.partial`)

  try {
    // The declared list, enforced. A URL is the one argument here that could point anywhere, and
    // checking it is the difference between the privacy panel describing this app and hoping.
    // Scheme as well as host, and on this request too. Every hop below is checked for both, and
    // this one was checked for neither until review pointed out that the *first* request — the
    // one the comment above is about — was the least checked thing in the function. `MODEL_URL`
    // is https, but `url` is a parameter, and `spotify/client.ts` checks the scheme on its
    // initial request; two modules disagreeing about their own rule is how one of them ends up
    // wrong later.
    const start = new URL(url)
    if (!policy.startsInsecure && start.protocol !== 'https:') {
      return { ok: false, reason: `${start.protocol}//${start.hostname} is not https, and the model is not fetched in the clear.` }
    }
    if (!policy.startsAt(start.hostname)) {
      return { ok: false, reason: `${start.hostname} is not in this app's declared egress list.` }
    }

    await mkdir(home, { recursive: true })

    /*
     * Every hop checked, not just the first.
     *
     * `redirect: 'follow'` made the check above cosmetic: it validated the URL this app asks for
     * and then connected to whatever came back, which for this file is always a CDN host that
     * was not in any list. Following by hand is the only way the declared set describes the
     * connections rather than the intention.
     */
    let response = await net(url, { redirect: 'manual' })
    for (let hop = 0; response.status >= 300 && response.status < 400; hop++) {
      const next = response.headers.get('location')
      if (next === null) {
        return { ok: false, reason: `The download was redirected with no destination (${response.status}).` }
      }
      if (hop >= MAX_REDIRECTS) {
        return { ok: false, reason: `The download redirected more than ${MAX_REDIRECTS} times.` }
      }
      /*
       * Resolved against the response the `Location` came from, with no fallback.
       *
       * A relative `Location` means "relative to where you just were". The fallback here was
       * `url` — the *original* request, never reassigned in this loop — so it would resolve hop
       * 2 against hop 0's address. In production it is dead: `fetch` populates `response.url`
       * under `redirect: 'manual'`. Under test it was the only branch, because a synthetic
       * `Response` has `url === ''`, so every assertion about hops landed on the path that ships
       * to nobody.
       *
       * Gone rather than corrected: a missing `response.url` is being wrong about the platform,
       * and an explicit throw is a better answer than quietly choosing a base.
       *
       * This is the second time this module and `spotify/client.ts` diverged on the same rule in
       * the same direction — the scheme check was the first — so the divergence is now a test
       * rather than a resolution to remember. See `test/redirect-loops-agree.test.ts`.
       */
      if (!response.url) {
        return { ok: false, reason: 'A redirect arrived with no address to resolve against.' }
      }
      const target = new URL(next, response.url)
      // A declared host over plaintext is a different connection than the panel implies, and the
      // whole claim of this loop is that the declared set describes the connections. The first
      // request is https; without this a hostile first hop could walk the rest down to http.
      if (target.protocol !== 'https:' && target.protocol !== 'http:') {
        return { ok: false, reason: `The download was redirected to ${target.protocol}, which is not a web address.` }
      }
      if (!policy.followsInsecure && target.protocol !== 'https:') {
        return { ok: false, reason: `The download was redirected to plaintext ${target.protocol}//${target.hostname}, and was not followed.` }
      }
      if (!policy.follows(target.hostname)) {
        return {
          ok: false,
          reason:
            `The download was redirected to ${target.hostname}, which is not in this app's ` +
            'declared egress list. Nothing was fetched from it.',
        }
      }
      response = await net(target, { redirect: 'manual' })
    }

    if (!response.ok) {
      return { ok: false, reason: `The model could not be downloaded: ${response.status} ${response.statusText}` }
    }

    const body = new Uint8Array(await response.arrayBuffer())
    // A model this small is a failed download wearing the right filename — an error page, a
    // redirect that returned HTML, a truncated stream.
    if (body.byteLength < 10_000_000) {
      await remove(partial, { force: true })
      return { ok: false, reason: `That download was only ${body.byteLength} bytes, so it is not the model.` }
    }

    await write(partial, body)
    await rename(partial, join(home, MODEL_FILE))
    return { ok: true }
  } catch (err) {
    await remove(partial, { force: true }).catch(() => {})
    return { ok: false, reason: `The model could not be downloaded: ${(err as Error).message}` }
  }
}

export interface RemovalLike {
  readonly ok: boolean
  readonly reason?: string
}

/**
 * Where Homebrew lives, without asking a shell.
 *
 * An Electron app launched from Finder inherits a `PATH` that has never seen a login shell, so
 * `/opt/homebrew/bin` is simply not in it — the classic shape of a feature that works when a
 * developer runs it from a terminal and fails for everybody else.
 */
const BREW_PATHS: readonly string[] = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']

export async function findBrew(): Promise<string | null> {
  for (const path of BREW_PATHS) if (await there(path)) return path
  return null
}

/**
 * Install the transcriber, from inside the app.
 *
 * A user pressed Speak and nothing happened, because the answer was a line of chat text telling
 * them to open a terminal. **A desktop app that asks you to run a command has not shipped the
 * feature** — it has documented it. So this runs the command, after the person presses a button
 * that says exactly what it is about to run.
 *
 * Homebrew because macOS is the one platform whisper.cpp publishes no prebuilt CLI for: the
 * project ships Windows and Linux binaries and an xcframework, and the xcframework is for Swift
 * apps rather than for anything a Node process can spawn. Homebrew's build *is* the macOS
 * prebuilt binary, bottled, which makes this a download rather than a compile.
 */
export async function installWhisper(
  allowed: () => boolean,
  spawnFn: typeof spawn = spawn,
): Promise<RemovalLike> {
  /*
   * The switch, checked here rather than around a `fetch`.
   *
   * `gated()` wraps a fetch, and this reaches the network by spawning `brew`, which downloads a
   * bottle. Wrapping cannot see it, so the check is explicit — but the promise it is keeping is
   * the same one, and the wording is the switch's own: this app does not make its own network
   * requests while it is off.
   *
   * Read per call, not captured, for the reason `gated()` gives: somebody switching it off wants
   * it off now, not at the next restart.
   */
  if (!allowed()) {
    return {
      ok: false,
      reason:
        'Office Space is set not to make its own network requests, and installing whisper ' +
        'downloads one. Turn the network back on in the music panel, then press this again.',
    }
  }

  const brew = await findBrew()
  if (brew === null) {
    return {
      ok: false,
      reason:
        'Homebrew is not installed, and it is how macOS gets whisper — the project publishes no ' +
        'prebuilt Mac binary of its own. Install Homebrew from brew.sh, then press this again.',
    }
  }

  return new Promise((resolve) => {
    const child = spawnFn(brew, ['install', 'whisper-cpp'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Non-interactive, so it can never sit waiting for a prompt nobody can see.
      env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', NONINTERACTIVE: '1' },
    })

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', (err: Error) => resolve({ ok: false, reason: `Could not run brew: ${err.message}` }))
    child.on('close', (code: number | null) => {
      if (code === 0) return resolve({ ok: true })
      const last = stderr.trim().split('\n').filter(Boolean).at(-1) ?? ''
      resolve({ ok: false, reason: last === '' ? `brew exited ${code}` : last })
    })
  })
}

export interface RunOptions {
  readonly whisper: Whisper
  /** A complete WAV file: 16 kHz, mono, 16-bit. See `shared/voice/wav.ts`. */
  readonly wav: Uint8Array
  /** Injected so the transcriber is testable against a stand-in program. */
  readonly spawnFn?: typeof spawn
}

/**
 * Run whisper over one recording and return what it heard.
 *
 * Writes the audio to a temporary file rather than piping it, because whisper.cpp seeks the WAV
 * header and a pipe cannot be seeked. Removed afterwards whatever happens — a directory of every
 * sentence somebody has ever dictated is not a thing this app is going to quietly accumulate.
 */
export async function transcribe(options: RunOptions): Promise<Transcript> {
  const spawnIt = options.spawnFn ?? spawn
  let dir: string | null = null

  try {
    dir = await mkdtemp(join(tmpdir(), 'office-dictation-'))
    const wavPath = join(dir, 'speech.wav')
    await writeFile(wavPath, options.wav)

    const args = [
      '--model', options.whisper.model,
      '--file', wavPath,
      // Read from stdout, so no `--output-txt`: that writes a file beside the wav which nothing
      // reads and which would have to be cleaned up as well.
      '--no-timestamps',
      // One thread short of the machine, so a laptop stays usable while it thinks.
      '--threads', String(Math.max(1, (await cores()) - 1)),
    ]

    const out = await run(spawnIt, options.whisper.binary, args)
    if (!out.ok) return { ok: false, text: '', reason: out.reason ?? 'Transcription failed.' }

    return { ok: true, text: clean(out.stdout) }
  } catch (err) {
    return { ok: false, text: '', reason: `Could not transcribe: ${(err as Error).message}` }
  } finally {
    if (dir !== null) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function cores(): Promise<number> {
  const os = await import('node:os')
  return os.cpus().length
}

interface Ran {
  readonly ok: boolean
  readonly stdout: string
  readonly reason?: string
}

function run(spawnIt: typeof spawn, binary: string, args: readonly string[]): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawnIt(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))

    // A spawn that fails is not an exit code — it never runs at all. Reported rather than
    // rejected, because the caller's job is to put a sentence on screen either way.
    child.on('error', (err: Error) => {
      resolve({ ok: false, stdout: '', reason: `Could not run ${binary}: ${err.message}` })
    })

    child.on('close', (code: number | null) => {
      if (code === 0) return resolve({ ok: true, stdout })
      // whisper writes its progress to stderr, so the last line of it is the actual complaint.
      const last = stderr.trim().split('\n').at(-1) ?? ''
      resolve({ ok: false, stdout: '', reason: last === '' ? `${binary} exited ${code}` : last })
    })
  })
}

/**
 * What whisper heard, without what whisper says about itself.
 *
 * The CLI interleaves timing and system information with the transcript, and it brackets
 * non-speech with markers a person never said — `[BLANK_AUDIO]`, `(silence)`, `[MUSIC]`. Those
 * are the program describing the recording, not quoting it, and putting one in the composer as
 * though it were spoken is exactly the kind of small lie the third standing order is about.
 */
export function clean(stdout: string): string {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('whisper_') && !line.startsWith('['))
    .join(' ')
    .replace(/\[(?:BLANK_AUDIO|MUSIC|SOUND|NOISE|INAUDIBLE)\]/gi, '')
    .replace(/\((?:silence|blank audio|no speech)\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}
