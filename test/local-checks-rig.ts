/**
 * Local checks say what they ran, and refuse what they cannot vouch for. This is the rig they share.
 *
 * `scripts/ci-local.mjs` stands in for CI while the organisation's GitHub Actions minutes are
 * spent (2026-09-17, about fourteen days). A stand-in for CI is only worth having if a green
 * result means what CI's did, so each of its promises is pinned here:
 *
 * - it runs typecheck, build and the suite in CI's order, on the Node it checked, and stops at the
 *   first failure: an exit code, a timeout, a signal, a step that cannot start, or output held open;
 * - it reports the suite's own counts, fails a run whose counts are missing or report a failure, and
 *   calls one whose only complaint is cancelled tests a timeout rather than either;
 * - it names the dev it was checked against, and posts only a head that contains it;
 * - every run gets its own temp folder, and that folder is gone afterwards, leftovers and all, even
 *   when the run is stopped by a signal, which also stops the step and what it started; a folder
 *   it cannot remove is named and left, and changes neither the lock's release nor the verdict;
 * - one run at a time, but a lock whose owner has died, or cannot be read for longer than a run
 *   lasts, does not block forever, and a run only ever removes its own lock, even when another run
 *   takes the lock over while it is deciding to; a lock taken under other rules is named as such,
 *   and a lock this user may not read is left alone;
 * - it will not describe a commit that did not run, or one that changed under it, or run where a
 *   test would copy gigabytes, or go ahead without a flag npm kept for itself;
 * - it fetches dev whatever the clone's own fetch settings say, and asks about the commit it
 *   reports, wherever HEAD is at that moment;
 * - it checks the checkout it is run from, so a branch cut before it existed can borrow a copy;
 * - every way it ends has its own exit code, and a crash in the middle of a step still stops the
 *   step and releases the lock.
 *
 * Nothing here runs npm, and nothing here reaches GitHub. The script spawns whatever
 * `OFFICE_CHECKS_NPM` names, so each test hands it a shell script that plays the three steps,
 * which is exactly the part of the script under test and none of the real suite. A stand-in `gh`
 * is first on every run's PATH, and git may only use local paths. The one run that must find no
 * `gh` at all gets a PATH this file builds, holding only `git` and `mkdir`, so a `gh` installed
 * in a system directory does not matter. A `git` that is itself a script needing more from PATH
 * (a `#!/usr/bin/env bash` wrapper, say) does: that run then fails.
 *
 * The promises above are pinned across six files, one per group, so that each fits the suite’s
 * minute per file on a loaded machine: `local-checks-*.test.ts`. This module holds only what
 * they share, and runs no test itself.
 */

import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, copyFile, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { accessSync, constants as fsConstants, existsSync, statSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempDir } from './temp-dir.js'

export const SCRIPT = fileURLToPath(new URL('../scripts/ci-local.mjs', import.meta.url))

/** The script refuses anything but Node 22, on purpose, so under another major there is nothing to test. */
export const SKIP = process.platform === 'win32'
  ? 'the stand-in for npm is a POSIX shell script'
  : process.versions.node.split('.')[0] !== '22'
    ? `the script refuses Node ${process.versions.node} by design`
    : false

/**
 * The stand-in for `npm run <step>`. It records the TMPDIR it was given and the directory it ran
 * in (and, when asked, which `node` its PATH finds), plays the suite's closing lines for
 * `coverage` (another set when `SUMMARY` names one, and exits with `COVERAGE_EXIT`), leaves one
 * folder behind the way the real suite does, and fails the step named in `STEP_FAIL`. The steps
 * named in `STEP_COMMIT`, `STEP_EDIT` and `STEP_ADD` commit, edit a tracked file, or add one; the
 * one named in `STEP_KILL` kills itself with SIGKILL at its very end, after any summary.
 *
 * For how a step ends: the step named in `STEP_HANG` never ends, and has a child in its process
 * group; the one named in `STEP_LEAVE` exits at once and leaves such a child behind; the one named
 * in `STEP_HOLD` exits at once, leaving a process in a session of its own that holds its output;
 * the one named in `STEP_HOLD_UNTIL` does the same with a process that lets go once `RELEASE`
 * exists. Each writes the pids it made to `PIDS` (`STEP_HOLD_UNTIL` its own pid first).
 *
 * For the temp folder: the step named in `STEP_LOCK_DIR` leaves a directory in it, with something
 * inside, that nobody but root may read or delete.
 *
 * For the lock: with `OVERLAP` set, every step holds a marker directory for 0.2 s and notes any
 * step that found it already held; the step named in `NESTED` starts the script again and keeps
 * what it said, with the lock's owner record and its own parent's pid; the step named in `STEAL`
 * writes another run's owner into the lock (with `STEAL_OLD`, one from a copy with older lock
 * rules, which wrote no token). With `STARTED` set, each step appends its name there, so that runs
 * sharing a checkout can be told apart; the step named in `STEP_WAIT` waits until `WAIT_FOR`
 * exists (thirty seconds at most).
 */
export const NPM = `#!/bin/sh
step="$2"
echo "$step $TMPDIR $(pwd -P)" >> "$SEEN"
if [ -n "$STARTED" ]; then echo "$step" >> "$STARTED"; fi
if [ "$step" = "$STEP_LOCK_DIR" ]; then
  mkdir -p "$TMPDIR/office-locked/inside"
  chmod 000 "$TMPDIR/office-locked"
fi
if [ "$step" = "$STEP_WAIT" ]; then
  n=0
  while [ ! -e "$WAIT_FOR" ] && [ "$n" -lt 600 ]; do sleep 0.05; n=$((n + 1)); done
fi
if [ -n "$OVERLAP" ]; then
  mkdir "$OVERLAP" 2>/dev/null || echo "$step" >> "$OVERLAP.seen"
  sleep 0.2
  rmdir "$OVERLAP" 2>/dev/null
fi
if [ "$step" = "$NESTED" ] && [ -z "$NESTED_DEPTH" ]; then
  echo "$PPID" > "$NESTED_OUT.parent"
  cp "$OFFICE_CHECKS_LOCK/owner.json" "$NESTED_OUT.owner"
  NESTED_DEPTH=1 "$NODE_BIN" "$SCRIPT" > "$NESTED_OUT" 2>&1
  echo "exit $?" >> "$NESTED_OUT"
fi
if [ "$step" = "$STEAL" ] && [ -n "$STEAL_OLD" ]; then
  printf '{"pid":%s,"sha":"0000000","startedAt":"during the run"}' "$$" > "$OFFICE_CHECKS_LOCK/owner.json"
elif [ "$step" = "$STEAL" ]; then
  printf '{"pid":%s,"sha":"0000000","startedAt":"during the run","token":"someone-else"}' "$$" > "$OFFICE_CHECKS_LOCK/owner.json"
fi
if [ -n "$NODE_SEEN" ]; then echo "$step $(command -v node) $(node --version)" >> "$NODE_SEEN"; fi
if [ "$step" = "$STEP_FAIL" ]; then echo "error in $step" >&2; exit 3; fi
if [ "$step" = "$STEP_COMMIT" ]; then
  git -c core.hooksPath=/dev/null -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit -q --allow-empty -m 'made during the run'
fi
if [ "$step" = "$STEP_EDIT" ]; then echo 'changed during the run' >> README; fi
if [ "$step" = "$STEP_ADD" ]; then echo 'made during the run' > made-during-the-run.txt; fi
if [ "$step" = "$STEP_HANG" ]; then
  sleep 60 &
  echo "$$ $!" > "$PIDS"
  wait
fi
if [ "$step" = "$STEP_LEAVE" ]; then
  sleep 60 &
  echo "$!" > "$PIDS"
fi
if [ "$step" = "$STEP_HOLD" ]; then
  "$NODE_BIN" -e "const c = require('child_process').spawn('/bin/sleep', ['30'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }); require('fs').writeFileSync(process.env.PIDS, String(c.pid)); c.unref()"
fi
if [ "$step" = "$STEP_HOLD_UNTIL" ]; then
  "$NODE_BIN" -e "const c = require('child_process').spawn(process.env.HOLDER, [], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }); require('fs').writeFileSync(process.env.PIDS, process.ppid + ' ' + c.pid); c.unref()"
fi
if [ "$step" = "coverage" ]; then
  mkdir -p "$TMPDIR/office-left-behind-1"
  case "$SUMMARY" in
    huge)
      big=1234567890123456789012345678901234567890
      printf '%s\\n' "# tests $big" "# pass $big" '# fail 0' '# cancelled 0' "# skipped $big" ;;
    fail) printf '%s\\n' 'not ok 1 - a' '# tests 1' '# pass 0' '# fail 1' '# cancelled 0' '# skipped 0' ;;
    cancelled) printf '%s\\n' '# tests 3' '# pass 1' '# fail 0' '# cancelled 2' '# skipped 0' ;;
    fail-and-cancelled) printf '%s\\n' 'not ok 1 - a' '# tests 3' '# pass 1' '# fail 1' '# cancelled 1' '# skipped 0' ;;
    cancelled-incomplete) printf '%s\\n' '# tests 3' '# cancelled 2' ;;
    none) printf '%s\\n' 'ok 1 - a' ;;
    partial) printf '%s\\n' '# tests 3' '# fail 0' ;;
    spoofed)
      printf '%s\\n' '# tests 1' '# pass 1' '# fail 0' '# cancelled 0' '# all files | 0.00 | 0.00 | 0.00 | (printed by a test, early)' \\
        'ok 1 - a' '# tests 3' '# pass 2' '# fail 0' '# cancelled 0' '# skipped 1' '# all files | 81.20 | 70.10 | 79.00 |' ;;
    *)
      printf '%s\\n' 'ok 1 - a' '# tests 3' '# pass 2' '# fail 0' '# cancelled 0' '# skipped 1' \\
        '# all files | 81.20 | 70.10 | 79.00 |' '  # tests 42 (an indented line the summary must not be read from)' ;;
  esac
  [ "$step" = "$STEP_KILL" ] && kill -9 $$
  [ -n "$COVERAGE_EXIT" ] || COVERAGE_EXIT=0
  exit "$COVERAGE_EXIT"
fi
[ "$step" = "$STEP_KILL" ] && kill -9 $$
exit 0
`

/** The stand-in for `gh`: it records what it was asked, one argument a line, and fails when told to. */
export const GH = `#!/bin/sh
printf '%s\\n' "$@" >> "$GH_LOG"
if [ -n "$GH_FAIL" ]; then echo "$GH_FAIL" >&2; exit 1; fi
exit 0
`

/** What `STEP_HOLD_UNTIL` leaves holding a step's output: it lets go once `RELEASE` exists, or after thirty seconds. */
export const HOLDER = `#!/bin/sh
n=0
while [ ! -e "$RELEASE" ] && [ "$n" -lt 600 ]; do sleep 0.05; n=$((n + 1)); done
`

export interface Rig {
  /** Scratch outside the checkout: the lock, the temp base, the reports and the stand-ins. */
  base: string
  /** The checkout under test. */
  root: string
  lock: string
  tmpBase: string
  reports: string
  seen: string
  ghLog: string
  env: Record<string, string>
}

/**
 * Hooks off, and no signing: a machine whose git hooks write files on commit (this one's
 * regenerate a graph) would leave the fixture dirty before the script ever looked at it.
 */
export const FIXTURE_GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false']

export function gitIn(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', [...FIXTURE_GIT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' } })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

export async function stub(path: string, body: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body)
  await chmod(path, 0o755)
}

/**
 * A git repository with a copy of the script, unless it is standing in for a branch cut before
 * the script existed. Everything the run writes lands beside it, not in it.
 */
export async function aRepo(t: TestContext, { script = true } = {}): Promise<Rig> {
  const base = await realpath(await tempDir(t, 'office-local-checks-'))
  const root = join(base, 'repo')
  await mkdir(root)
  if (script) {
    await mkdir(join(root, 'scripts'))
    await copyFile(SCRIPT, join(root, 'scripts', 'ci-local.mjs'))
  }
  await writeFile(join(root, 'README'), 'a fixture\n')
  await stub(join(base, 'bin', 'npm'), NPM)
  await stub(join(base, 'bin', 'hold-until'), HOLDER)
  await stub(join(base, 'gh', 'gh'), GH)
  await mkdir(join(base, 'tmp-base'))
  // No template, so no hooks are copied in either.
  gitIn(root, 'init', '-q', '--template=')
  gitIn(root, 'add', '-A')
  gitIn(root, 'commit', '-qm', 'fixture')
  const rig = {
    base,
    root,
    lock: join(base, 'lock'),
    tmpBase: join(base, 'tmp-base'),
    reports: join(base, 'reports'),
    seen: join(base, 'seen'),
    ghLog: join(base, 'gh.log'),
  }
  return {
    ...rig,
    env: {
      OFFICE_CHECKS_NPM: join(base, 'bin', 'npm'),
      OFFICE_CHECKS_TMP_BASE: rig.tmpBase,
      OFFICE_CHECKS_LOCK: rig.lock,
      OFFICE_CHECKS_REPORTS: rig.reports,
      SEEN: rig.seen,
      GH_LOG: rig.ghLog,
      NODE_BIN: process.execPath,
      HOLDER: join(base, 'bin', 'hold-until'),
      PATH: `${join(base, 'gh')}${delimiter}${process.env['PATH'] ?? ''}`,
      GIT_ALLOW_PROTOCOL: 'file',
    },
  }
}

/**
 * Gives the rig an `origin` that is configured as GitHub's `o/r`, and posted to as that, but that
 * git reaches on disk through `insteadOf`. Its `dev` starts at the fixture's commit.
 */
export async function withOrigin(rig: Rig, url = 'https://github.com/o/r.git'): Promise<void> {
  const origin = join(rig.base, 'origin.git')
  gitIn(rig.base, 'init', '-q', '--bare', '--template=', origin)
  gitIn(rig.root, 'remote', 'add', 'origin', url)
  gitIn(rig.root, 'config', `url.${origin}.insteadOf`, url)
  gitIn(rig.root, 'push', '-q', 'origin', 'HEAD:refs/heads/dev')
}

export function commit(rig: Rig, message: string): string {
  gitIn(rig.root, 'commit', '-q', '--allow-empty', '-m', message)
  return gitIn(rig.root, 'rev-parse', 'HEAD')
}

/** What the stand-in `gh` was asked to post, by field. */
export async function posted(rig: Rig): Promise<{ path: string | undefined; fields: Record<string, string> }> {
  const asked = await lines(rig.ghLog)
  const fields: Record<string, string> = {}
  asked.forEach((arg, i) => {
    if (asked[i - 1] !== '-f') return
    const at = arg.indexOf('=')
    fields[arg.slice(0, at)] = arg.slice(at + 1)
  })
  return { path: asked[3], fields }
}

export function run(
  rig: Rig,
  args: string[] = [],
  env: Record<string, string> = {},
  script = join(rig.root, 'scripts', 'ci-local.mjs'),
): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: rig.root,
    env: { ...process.env, ...rig.env, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

export interface Finished {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

/** A run in the background, killed when the test ends if it has not finished by then. */
export function start(t: TestContext, rig: Rig, args: string[] = [], env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [join(rig.root, 'scripts', 'ci-local.mjs'), ...args], {
    cwd: rig.root,
    env: { ...process.env, ...rig.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => (stdout += chunk))
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const done = new Promise<Finished>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, stdout, stderr })))
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })
  return { child, done }
}

export async function lines(path: string): Promise<string[]> {
  if (!existsSync(path)) return []
  return (await readFile(path, 'utf8')).trim().split('\n')
}

export const seen = (rig: Rig): Promise<string[]> => lines(rig.seen)

/** Whether a process is still there. EPERM means it is, and belongs to someone else. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function until<T>(probe: () => T | undefined | Promise<T | undefined>, what: string, ms = 5_000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const value = await probe()
    if (value !== undefined) return value
    if (Date.now() > end) throw new Error(`gave up after ${ms} ms waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** The executable a shell would run for `name`, from this process's PATH. */
export function onPath(name: string): string {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name)
    try {
      accessSync(candidate, fsConstants.X_OK)
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Not here; the next directory.
    }
  }
  throw new Error(`${name} is not on PATH`)
}

/** Output a background run has written so far, as it arrives. */
export function collect(stream: NodeJS.ReadableStream): () => string {
  let text = ''
  stream.on('data', (chunk) => (text += chunk))
  return () => text
}

export async function pidsIn(path: string): Promise<number[]> {
  return (await readFile(path, 'utf8')).trim().split(/\s+/).map(Number)
}

/** The pids a stand-in wrote, once all `count` of them are there. */
export function pidsWritten(path: string, count: number, what: string): Promise<number[]> {
  return until(async () => {
    const found = await pidsIn(path).catch(() => [])
    return found.length === count && found.every((pid) => pid > 0) ? found : undefined
  }, what, 15_000)
}

/**
 * A file for a stand-in to write the pids it started to. Whatever it names is killed when the
 * test ends, whether or not the script did it. It sits outside the rig, so the rig's own removal
 * cannot take it first.
 */
export function pidFile(t: TestContext): string {
  const path = join(tmpdir(), `olc-pids-${process.pid}-${Math.random().toString(36).slice(2)}`)
  t.after(async () => {
    for (const pid of await pidsIn(path).catch(() => [])) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone, which is the point.
      }
    }
    await rm(path, { force: true })
  })
  return path
}

export async function report(rig: Rig, sha = gitIn(rig.root, 'rev-parse', 'HEAD')): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(rig.reports, `${sha}.json`), 'utf8'))
}
