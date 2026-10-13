/**
 * Running a VERIFY condition.
 *
 * `CLAUDE.md`: *"An agent saying 'done' does not make a task done. Every dispatched task
 * carries a VERIFY condition, and the harness checks it. If the check fails, the task is not
 * complete, regardless of what the transcript says."* This is the part that checks it.
 *
 * ## What counts as passing
 *
 * Exit zero, and nothing else the command says. Not the output looking right, not the absence of
 * the word "error" — the exit code, which is the one thing a command says about itself that cannot
 * be phrased persuasively. Everything else it wrote is kept and shown, because a failure with no
 * output is a failure nobody can act on.
 *
 * One condition comes from outside the command: **every test file a `tsx --test` or `node --test`
 * run names is there.** Those runners skip a missing file without a word and exit 0 whenever
 * another file they were given exists, so exit zero alone passed a VERIFY naming a test nobody
 * wrote. See `testRuns` in `shared/tasks.ts` for which words count as files, and `runVerify` for
 * why such a check still runs. A run whose files cannot be placed is not looked at, and the
 * result says so in `unchecked` rather than passing quietly as if it had been.
 *
 * ## A check that never finishes has not passed
 *
 * A hung command is the failure mode that would quietly take the office with it, so every run
 * has a deadline. Timing out is reported as its own outcome rather than as a failure — "your
 * test suite takes longer than the harness waits" and "your test suite fails" are different
 * problems with different fixes.
 *
 * The deadline is on the command, not on what the command leaves running. A check settles within
 * its deadline plus `DRAIN_GRACE_MS` whatever is still holding its output — see the note on
 * `'exit'` in `runVerify`.
 *
 * ## Why this uses a shell
 *
 * VERIFY conditions are written by people, in the shell they think in — `npm test -- --grep
 * "the thing"` has quoting in it that a naive split would destroy. So the command runs through
 * a shell, and the gate on *which* commands run unattended lives in `permissions.ts`, where
 * the workspace's own declared policy decides. Splitting the two is the point: this module
 * runs what it is given, and something else decides what it may be given.
 */

import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import type { Socket } from 'node:net'
import { resolve as resolvePath } from 'node:path'

import { testRuns, type TestRun, type Unchecked } from '../shared/tasks.js'

/** How long a check may take before it has failed to answer. */
export const DEFAULT_TIMEOUT_MS = 120_000

/** Keep enough output to act on, not so much that it is a wall. */
const OUTPUT_LIMIT = 4_000

/**
 * How long a check waits for its pipes to close after its command has exited, or after the
 * deadline killed it.
 *
 * Only spent when something is still holding the command's stdout or stderr, because otherwise
 * `'close'` has already settled the check: for five ordinary commands, twenty runs each, it
 * followed `'exit'` by at most 0.07ms, measured on macOS on 2026-09-15. So this is not sized to
 * them. It is how long a process the command left behind gets to finish writing before the check
 * answers without it — the same two seconds `run.ts` gives `claude`.
 */
const DRAIN_GRACE_MS = 2_000

export interface VerifyRequest {
  readonly command: string
  readonly cwd: string
  readonly timeoutMs?: number
}

export interface VerifyResult {
  readonly command: string
  /** Exit zero, with nothing in `missing`. */
  readonly passed: boolean
  /** Null when the command was killed rather than exiting. */
  readonly exitCode: number | null
  /** stdout and stderr as they interleaved, clamped. Kept even when it passed. */
  readonly output: string
  readonly durationMs: number
  /** True when the deadline killed it. Not the same as failing, and reported separately. */
  readonly timedOut: boolean
  /** Set when the command could not be started at all. */
  readonly error: string | null
  /**
   * Test files the command hands `tsx --test` or `node --test` that are not in `cwd`, as written.
   *
   * Empty when every one is there, and when the command names none this can read — a glob, a
   * runner it does not know, or a run in `unchecked`. Never a reason to call a check passed: only
   * to call one not.
   */
  readonly missing: readonly string[]
  /**
   * Test runs whose files were not looked for, and why: the command may move its runner or change
   * its words (a `cd`, an npm workspace, a program before it that is not known to leave both
   * alone), the runner is inside text a shell runs, a word is one the shell may change, an option
   * is one `testRuns` does not know, or a file is in `node_modules`, which the runner leaves out. None
   * of their files is in `missing`, and the outcome does not change for them. What this says is that
   * a pass did not look.
   *
   * After an exit 0, this also holds an `unread` entry for each word, redirection target or comment
   * holding `--test` that no run read, so that such text never passes with nothing said.
   */
  readonly unchecked: readonly Unchecked[]
}

function clamp(text: string): string {
  const trimmed = text.trimEnd()
  return trimmed.length > OUTPUT_LIMIT ? `…${trimmed.slice(-OUTPUT_LIMIT)}` : trimmed
}

/**
 * Kill the command, and everything it started.
 *
 * `shell: true` means the child is `/bin/sh -c "<command>"`, and `child.kill()` kills only the
 * shell. Whether that is enough depends on the platform — exactly the kind of difference that
 * hides until somebody else runs the tests:
 *
 * - **macOS** often `exec`s a single simple command, so the shell *is* the process and killing
 *   it works. Every local run passed.
 * - **Linux** forks, so `sleep 5` outlives the shell and holds the pipe open — `close` does not
 *   arrive until the command finishes on its own. A five-second command with a 300 ms deadline
 *   took the full five seconds, and CI caught it on its first run.
 *
 * That is worse than a slow test. The harness reported `timedOut: true` while the process it
 * claimed to have killed was still running: a check saying it stopped something that it had not.
 *
 * `detached: true` puts the child in its own process group; a negative pid signals the group.
 * `ESRCH` means it exited between the deadline firing and the signal — a race we win either way.
 */
function killTree(child: { pid?: number | undefined; kill: (s: NodeJS.Signals) => boolean }): void {
  const pid = child.pid
  if (pid === undefined) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // Nothing left to kill.
    }
  }
}

/**
 * Run one check.
 *
 * Never throws. A command that cannot be started is a result carrying the reason, because
 * "we could not run the check" is a different thing from "the check failed" and an office that
 * conflated them would report broken plumbing as broken code.
 */
export function runVerify(request: VerifyRequest): Promise<VerifyResult> {
  const started = Date.now()
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const ran = new Promise<Omit<VerifyResult, 'missing' | 'unchecked'>>((resolve) => {
    let output = ''
    let timedOut = false
    let settled = false
    let drain: NodeJS.Timeout | undefined

    const finish = (
      result: Omit<VerifyResult, 'command' | 'durationMs' | 'output' | 'timedOut' | 'missing' | 'unchecked'>,
    ) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearTimeout(drain)
      resolve({
        command: request.command,
        output: clamp(output),
        durationMs: Date.now() - started,
        timedOut,
        ...result,
      })
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(request.command, {
        cwd: request.cwd,
        shell: true,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Its own process group, so the deadline can kill the whole tree rather than just the
        // shell. See `killTree` — without this a timeout does not actually stop anything on
        // Linux.
        detached: true,
      })
    } catch (err) {
      resolve({
        command: request.command,
        passed: false,
        exitCode: null,
        output: '',
        durationMs: Date.now() - started,
        timedOut: false,
        error: err instanceof Error ? err.message : String(err),
      })
      return
    }

    /**
     * Read for up to `DRAIN_GRACE_MS` more in case the pipes close, then settle with what arrived.
     * Started once, by whichever comes first: the command exiting, or the deadline.
     */
    const drainThenFinish = () => {
      if (drain) return
      drain = setTimeout(() => {
        finish({ passed: !timedOut && child.exitCode === 0, exitCode: child.exitCode, error: null })
        /*
         * Something still holds these pipes. Not `destroy()`, which closes them on it: measured on
         * macOS on 2026-09-15 against a draft of this code that did, a `/bin/sh` loop and a Node
         * process writing to them, each in a session of its own, were both gone 1.5s later, where
         * one that wrote nothing was still running. So go on reading and keep none of it — and
         * `unref()`, or a process that ran such a check cannot exit until the writer does: without
         * it, a script whose check had settled was still running twelve seconds later, measured
         * the same day.
         */
        for (const stream of [child.stdout, child.stderr] as (Socket | null)[]) {
          stream?.removeAllListeners('data').resume().unref()
        }
      }, DRAIN_GRACE_MS)
    }

    const deadline = setTimeout(() => {
      timedOut = true
      // The command has not exited: `'exit'` clears this timer, and Node emits `'exit'` from the
      // callback that tells it the command is gone — read in Node 22's `onexit`; that libuv has
      // reaped the command by then is inferred, not checked. So the command's pid, which is also
      // its group's id, cannot yet belong to anybody else.
      killTree(child)
      drainThenFinish()
    }, timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      output += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      output += chunk
    })

    child.on('error', (err) => {
      finish({ passed: false, exitCode: null, error: err.message })
    })

    /*
     * `'close'` stays the answer the check prefers: it is the moment the pipes are drained, so
     * settling there keeps the last of the output. But it is not "the command exited". Node fires
     * it once the process has ended *and* its stdout and stderr have closed, and what the command
     * starts inherits those pipes, so it can hold them open after the command is gone.
     *
     * Until 2026-09-15 nothing else settled a check, and the deadline did not bound that. Measured
     * that day on macOS against this file as it was, with a one-second deadline:
     *
     * - A leftover in the command's own process group was killed by the deadline, and only then
     *   did `'close'` fire. The check settled at 1,007ms with `timedOut`, `passed: false` and
     *   `exitCode: 0`: a command that had exited 0 at once, reported as failed.
     * - A leftover that had taken a session of its own is beyond a signal to the group. The check
     *   was still pending twelve seconds in, and settled, the same way, only once the leftover was
     *   killed by hand.
     *
     * So an exit is an answer. It clears the deadline, which is for a command that has not given
     * one, and the check reads for up to `DRAIN_GRACE_MS` more in case the pipes close, then
     * reports the exit code with the output it has. A deadline that fires first kills the group
     * and waits the same grace. Either way the check settles within `timeoutMs` plus
     * `DRAIN_GRACE_MS`.
     *
     * Nothing is signalled once the command has exited. The group's id is the command's pid; after
     * the command is reaped, that number stays reserved only while something is still in the
     * group — POSIX's reuse rule, repeated here, not measured — and when the pipes are held from
     * outside the group there may be nothing in it. A signal then could reach a process the check
     * never started. So what the command leaves running is left running, as it already was
     * whenever it did not hold the pipes: `sleep 60 >/dev/null 2>&1 &` was still alive after the
     * deadline, measured the same day against the same file. Nor are the pipes closed on it — see
     * `drainThenFinish`.
     */
    child.on('exit', () => {
      clearTimeout(deadline)
      drainThenFinish()
    })

    child.on('close', (code) => {
      // A check killed by the deadline never answered. It did not pass.
      finish({ passed: !timedOut && code === 0, exitCode: code, error: null })
    })
  })

  /*
   * Then hold it to the test files it names. Run first, and judged after, rather than refused.
   *
   * Refusing to run it would leave a verdict with nothing behind it, and the outcome model has no
   * true word for that. `outcomeOf` reads a check with no result as `not-run`, "Not checked yet",
   * about a VERIFY that can never pass as written; and a `failed` with no run behind it would
   * empty the floor's bin, which is full exactly when nothing ran (`nothingRan`). Running it keeps
   * every word true: `failed` is a check that ran and said no, the exit code is the runner's own,
   * and the output shows what it did run. It costs one run of a command that was going to run.
   *
   * Looked for from `request.cwd`, which `spawn` was given, so the files are the ones the command
   * could see. That holds only for a run nothing before it could move, which is why `testRuns`
   * reads a run only after words it knows to leave the runner where it started. Plain `npx` does
   * not move: measured on 2026-09-17 with npm 10.9.2, a local bin started through it from a
   * package's subfolder printed the subfolder, and `npx --prefix sub -c pwd` printed the folder it
   * started in. **Except in a subfolder of an npm workspace's package**, where npm finds the
   * workspace by the folder (`exec` sets `ignoreImplicitWorkspace = false`, read in
   * `lib/commands/exec.js`) and starts the runner in the package's own folder: measured the same
   * day, `npx node` started in `app/test`, under a root whose `package.json` lists the workspace
   * `app`, ran in `app`. That matters only when the folder the office runs VERIFY commands from
   * is such a subfolder, and nothing here looks for that.
   *
   * `npx -w app` does move, as `cd` does, and so does `pnpm --filter app exec`: the same day,
   * `npx -w app -c pwd` printed the workspace's folder, and pnpm 11.22.0 ran a test that is only in
   * `app/`. `testRuns` leaves every run like that in `unchecked`, and nothing of it is looked for.
   *
   * And after the run, not before, because a VERIFY can build what it then tests:
   * `npm run build && node --test dist/a.test.js`, or `cp` a test into place and run it. The cost is
   * the other order: a VERIFY that writes a test file, runs it and deletes it has run that file,
   * and this still finds it missing. `verify.test.ts` pins both.
   */
  return ran.then(async (result) => {
    const runs = testRuns(request.command)
    const missing = await notThere(runs, request.cwd)
    // An `unread` note is about text holding `--test` that no run read, and says what a pass did not
    // look at. A command that did not exit 0 has said no by itself, and one whose line the shell
    // refused, a quote that never closes, ran none of that text; so the note is kept for an exit 0
    // alone. The other reasons are about a run the office found, and stay.
    const clean = result.exitCode === 0 && !result.timedOut
    const unchecked = runs.flatMap(({ unchecked: why }) =>
      why === null || (why.reason === 'unread' && !clean) ? [] : [why],
    )
    return missing.length === 0
      ? { ...result, missing, unchecked }
      : { ...result, passed: false, missing, unchecked }
  })
}

/**
 * The test files `runs` hand their runners that `cwd` does not have, in the order they name them.
 *
 * A file is missing when `access` says the path names nothing: ENOENT, or ENOTDIR when a part of it
 * is a file. Any other failure is not taken to mean nothing is there. EACCES comes from a folder
 * this process may not search, which can hold the file, and ELOOP from a link that is there; to
 * call either "not in the workspace folder" could be untrue. Nor is it needed: measured on
 * 2026-09-17 with Node 22.16.0 and 24.3.0, `node --test a.test.mjs <path>` exited 7 for a path
 * under a folder with mode 000 and for a name too long, and 1 for a link to itself, so a run
 * given such a path has failed on its own.
 *
 * A file written with `/` at its end has to be a folder. `resolvePath` drops that slash, and the
 * runner does not: measured on 2026-09-17 with Node 22.16.0, `node --test a.test.mjs a.test.mjs/`
 * and `node --test a.test.mjs missing.test.mjs/` each ran `a` and exited 0, and `node --test
 * a.test.mjs d/` for a folder `d` failed, as the runner tried to load the folder. So the slash is
 * put back, and `access` then fails with ENOTDIR for a file. `..` is left to `resolvePath`, which
 * reads it as the runner does: `node --test nodir/../a.test.mjs` ran `a` though `nodir` is not
 * there (measured). A word that names the folder the command runs in, `.` or `./`, is there, and
 * is not called missing, though the runner passed over it too (measured: `node --test a.test.mjs .`
 * ran `a` and exited 0).
 */
async function notThere(runs: readonly TestRun[], cwd: string): Promise<string[]> {
  const files = [...new Set(runs.flatMap((run) => run.files))]
  const gone = await Promise.all(
    files.map((file) =>
      access(resolvePath(cwd, file) + (file.endsWith('/') ? '/' : '')).then(
        () => false,
        (err: NodeJS.ErrnoException) => err.code === 'ENOENT' || err.code === 'ENOTDIR',
      ),
    ),
  )
  return files.filter((_, i) => gone[i])
}
