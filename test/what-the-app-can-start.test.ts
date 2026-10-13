/**
 * Every process this app starts, and what bounds where each one can write.
 *
 * This is the largest surface in the product and the one nothing else covers, because it is not
 * an `fs` call in this repository — it is a child process. By volume it is most of what lands on
 * somebody's disk because they opened Office Space, and a sweep of our own writes comes back
 * clean while saying nothing about it.
 *
 * ## The four, and they are not alike
 *
 * | module | starts | binary from | args | shell |
 * |---|---|---|---|---|
 * | `claude/run.ts` | the user's own `claude` | a resolved path, or `claude` | `buildArgs`, `--`-terminated | no |
 * | `verify.ts` | a VERIFY from `TASKS.md` | **the command string itself** | — | **yes** |
 * | `quarantine.ts` | `/usr/bin/xattr` | an absolute literal | one path | no |
 * | `voice/transcribe.ts` | `brew`, then whisper | absolute literals, fixed list | fixed | no |
 *
 * **Only the first two take a command from a caller.** The other two run a named binary at an
 * absolute path with arguments the module writes itself — `quarantine` reads an extended
 * attribute, `transcribe` installs and runs a speech model. Neither resolves through `PATH`,
 * which is deliberate: `/opt/homebrew/bin` is not in a GUI app's `PATH`, and a lookup that
 * worked in a terminal and failed from the Dock is the classic shape of this bug.
 *
 * That asymmetry is the useful part of this file. A fifth spawn of the third kind is
 * unremarkable; a fifth of the *first* kind is a new place a string becomes a process.
 *
 * ## What bounds them, stated plainly
 *
 * **Not `cwd`.** `cwd` is where a process starts, not where it may write. A child with the
 * user's own permissions writes anywhere the user can, and nothing here confines it.
 *
 * - `run.ts` is bounded by **Claude Code's own permission system** — the `--tools`,
 *   `--disallowedTools` and permission-mode flags, plus the approval hook. Those bound *tool
 *   calls*, not paths: `judge(command, policy)` never sees a path. See
 *   `the-policy-we-ship.test.ts`, which also records that the allow list holds a general-purpose
 *   interpreter, so what it really bounds is legibility.
 * - `verify.ts` runs with `shell: true`, so the string reaches a shell. That is why
 *   `chainsCommands` refuses a chain, why the allow list is a list of leading words, and why a
 *   denied command never runs even on an explicit click.
 *
 * **There is no path confinement anywhere in this product.** Adding one means an OS-level
 * sandbox around the child, not another rule in `settings.json`. Written here rather than left
 * to be discovered.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { buildArgs } from '../src/main/claude/run.js'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Modules that take the command from a caller. A fifth of these is the one worth noticing. */
const RUN_WHAT_THEY_ARE_GIVEN = ['src/main/claude/run.ts', 'src/main/verify.ts']

/** Modules that run a named binary at an absolute path, with arguments they write themselves. */
const RUN_A_FIXED_BINARY = [
  'src/main/quarantine.ts',
  'src/main/voice/transcribe.ts',
  /*
   * `/bin/ps`, asked when a numbered process started.
   *
   * The third kind, and the mildest of them: the only argument that is not a literal is a pid
   * this app wrote down itself, rendered with `String()`. It reads; the killing is done with
   * `process.kill`, which starts nothing.
   *
   * It is here because the answer decides whether this app sends `SIGKILL` to a process it did
   * not start. A pid is not an identity — between a crash and the next launch the number may
   * belong to somebody else — so `stampOf` asks when the process began, and a start time that
   * has changed means leave it alone. See `shared/orphans.ts`.
   */
  'src/main/orphans.ts',
  /*
   * `git clone`, with a remote somebody typed into a box.
   *
   * `execFile` with an array, so no shell sees it — but git interprets its own arguments, which
   * is a second way for a string in the URL position to become a command. `--` stops git looking
   * for options there, and `whyNotASource` refuses a leading dash and the `ext::` transport,
   * whose whole purpose is running a command instead of fetching. See `shared/hired-from.ts`.
   */
  'src/main/hired-from.ts',
  /*
   * `git check-ignore`, and `git rev-parse` to find out whether there is a repository at all.
   *
   * The arguments are fixed and the only variable is a path from `WRITES`, which is a constant in
   * our own source rather than anything a person types. `--` before it regardless.
   */
  'src/main/sharing.ts',
]

async function sources(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(join(repo, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await sources(path)))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

/**
 * Every module that imports a process-starting function.
 *
 * By import rather than by call spelling. The first draft of this grepped `spawn(` and reported
 * **two** modules; there are four. `quarantine.ts` uses `execFile` and `transcribe.ts` calls
 * through an injected `spawnFn`, and neither matched. Import lists cannot be dodged by a
 * different call shape — the same correction `writes-and-symlinks.test.ts` had to make.
 */
async function spawners(): Promise<string[]> {
  const found: string[] = []
  for (const file of await sources('src')) {
    if (/from 'node:child_process'/.test(await readFile(join(repo, file), 'utf8'))) found.push(file)
  }
  return found.sort()
}

test('the modules that can start a process are the ones we think, and the scanner can see them', async () => {
  // The control first: a scanner that walks nothing reports a tree with no spawns in it, which
  // reads exactly like a tree that cannot start anything.
  const files = await sources('src')
  assert.ok(files.length > 50, `the scanner walked ${files.length} files, so it is broken`)

  assert.deepEqual(
    await spawners(),
    [...RUN_WHAT_THEY_ARE_GIVEN, ...RUN_A_FIXED_BINARY].sort(),
    'the set of modules that can start a process has changed. Read the boundary at the top of ' +
      'this file, decide which of the two kinds the new one is, and add it to that list — a ' +
      'module that runs what it is handed is a different thing from one that runs a binary it names.',
  )
})

test('the modules that run what they are handed take an explicit cwd', async () => {
  // Not confinement — `cwd` is where a child starts, not where it may write. Pinned because
  // inheriting Electron's cwd would run a VERIFY somewhere nobody chose, and "somewhere nobody
  // chose" is the shape of every path bug in this repository.
  //
  // Deliberately not asserted of the other two: they hand absolute paths to a binary they named,
  // so there is no relative path for a cwd to resolve, and demanding one would be cargo.
  for (const file of RUN_WHAT_THEY_ARE_GIVEN) {
    const text = await readFile(join(repo, file), 'utf8')
    const call = /spawn\([\s\S]{0,900}?\}\)/.exec(text)
    assert.ok(call, `${file} no longer has a recognisable spawn call — this check is blind`)
    assert.match(call[0], /cwd:\s*\w/, `${file} starts a process without naming a cwd`)
  }
})

test('the fixed-binary modules do not resolve through PATH', async () => {
  // A GUI app launched from the Dock does not inherit a shell's PATH — `/opt/homebrew/bin` is
  // simply not in it. Both of these name absolute paths for that reason, and a regression to a
  // bare name is a feature that works in development and fails for everybody else.
  const quarantine = await readFile(join(repo, 'src/main/quarantine.ts'), 'utf8')
  assert.match(quarantine, /const XATTR = '\/usr\/bin\/xattr'/, 'xattr is no longer an absolute path')

  const transcribe = await readFile(join(repo, 'src/main/voice/transcribe.ts'), 'utf8')
  assert.match(transcribe, /'\/opt\/homebrew\/bin\/brew'/, 'brew is no longer looked for at an absolute path')
  assert.doesNotMatch(transcribe, /spawnFn\(\s*'brew'/, 'brew is being resolved through PATH')
})

test('the prompt is separated from the flags, because several of them are variadic', async () => {
  // The one argument bug that would be silent. `--tools` and `--mcp-config` take any number of
  // values, so a prompt pushed straight after one is eaten as another value — the CLI runs with
  // no prompt and the office reports a turn that said nothing.
  const args = buildArgs({ cwd: '/w', prompt: 'do the thing', tools: ['Read', 'Bash'] })
  assert.equal(args.at(-1), 'do the thing', 'the prompt is not last')
  assert.equal(args.at(-2), '--', 'nothing separates the prompt from a variadic flag')

  const bare = buildArgs({ cwd: '/w', prompt: 'hello' })
  assert.equal(bare.at(-2), '--', 'the terminator is only added when something else adds a flag')
})

test('a prompt that looks like a flag is still a prompt', async () => {
  // What the terminator is actually for. Without it, `--dangerously-skip-permissions` typed into
  // the composer is an argument rather than a sentence.
  for (const prompt of ['--dangerously-skip-permissions', '-p', '--output-format', '--']) {
    const args = buildArgs({ cwd: '/w', prompt })
    assert.equal(args.at(-1), prompt, `${prompt} did not survive as the prompt`)
    assert.equal(args.at(-2), '--', `${prompt} was not protected by the terminator`)
  }
})

/**
 * Every in-app `claude` is on the list that quit reads.
 *
 * `children.ts` describes itself as the one list every child joins — *"the only arrangement
 * where 'did we get them all' is a question with an answer."* It was not that. Of the four
 * modules calling `runClaude`, only `session.ts` registered, so an aside (clicking a person on
 * the floor) and the voice digest were both real `claude` processes that `stopAll()` could not
 * reach at quit and the cap never counted.
 *
 * That is a rule prose cannot hold: registering is one line at a call site, and forgetting it
 * costs nothing visible until somebody closes the window mid-answer. So it is held here, where
 * a fifth caller is refused until it decides.
 */
const NOT_STOPPED_AT_QUIT: readonly string[] = [
  /*
   * `npm run eval`, and the one honest exemption.
   *
   * It is not imported by the app — checked, not assumed — so there is no Electron to quit and
   * no `before-quit` to reach it. Its children are recorded on disk by `runClaude` like every
   * other, which is the half that still applies: kill the CLI and the next office to open that
   * workspace reaps whatever it left behind.
   */
  'src/main/cli/eval.ts',
]

test('every module that starts a claude registers it, so quit can stop it', async () => {
  const callers: string[] = []
  for (const file of await sources('src')) {
    if (file.endsWith('claude/run.ts')) continue // where `runClaude` is defined, not a caller
    if (/\brunClaude\(/.test(await readFile(join(repo, file), 'utf8'))) callers.push(file)
  }

  // The control. A scan that finds no callers would pass the assertion below while checking
  // nothing at all — which is how the rule got into this state in the first place.
  assert.ok(callers.length >= 3, `only ${callers.length} runClaude callers found, so this check is blind`)

  const unregistered: string[] = []
  for (const file of callers) {
    if (NOT_STOPPED_AT_QUIT.includes(file)) continue
    const text = await readFile(join(repo, file), 'utf8')
    if (!/\b(?:track|admit)\(/.test(text)) unregistered.push(file)
  }

  assert.deepEqual(
    unregistered,
    [],
    'these start a real `claude` and never put it on `children.ts`. Nothing stops them at quit: ' +
      'close the window and they keep running, keep talking to Anthropic, and keep spending, ' +
      'with nothing left on screen to show it. Call `track()` — or `admit()` if it should take a ' +
      'seat at the cap — and release it when the run is over.',
  )
})
