/**
 * The record that survives the crash, and the reap that reads it.
 *
 * `shared/orphans.ts` holds the decision and says why it is a decision. This is the half that
 * touches the machine: asking the platform when a process started, keeping the list on disk, and
 * sending the signal.
 *
 * ## Why on disk at all
 *
 * Because the process that knows what it started is the one that died. `children.ts` keeps a
 * `Set` of live children and empties it at `before-quit`, which is exactly the handler a crash
 * skips. Anything held only in memory dies with the office; the record has to outlive it or
 * there is nothing for the next launch to act on.
 *
 * ## Written the way the registry is written, for the same reasons
 *
 * Temp file then rename, because a half-written record is worse than none — a torn file is
 * unparseable, and an unparseable record is a reap that cannot happen. Serialised, because it is
 * read-modify-write on one file and this repository has now paid for that lesson three times:
 * twelve connectors written, six on disk, twelve `ok`.
 *
 * ## An unreadable record is not an empty one
 *
 * The fourth standing order, on the surface where it costs the most. If the file is there and
 * will not parse, this reports that and reaps nothing. Treating it as empty would silently
 * abandon whatever it named — which is the leak this file exists to close, arrived at by way of
 * the code that was supposed to close it.
 */

import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { keepAfterReap, verdictFor, type Observed, type Spawned } from '../shared/orphans.js'
import { serial } from './serial.js'

const run = promisify(execFile)

const STATE_DIR = '.office-space'
const RUNNING_FILE = 'running.json'

const writes = serial()
let saveSeq = 0

function pathOf(root: string): string {
  return join(root, STATE_DIR, RUNNING_FILE)
}

/**
 * When a process started, as the platform says it, or `null` if nothing is running under that
 * number.
 *
 * `lstart` rather than `etime` or a computed age: it is an absolute moment, so comparing two
 * readings taken minutes apart is a string equality and not arithmetic against a clock that
 * moved. The string is never parsed — `shared/orphans.ts` says why.
 *
 * A pid that is not running makes `ps` exit non-zero, which is the `null` here. That is the only
 * failure this treats as an answer; anything else is rethrown as itself rather than becoming a
 * quiet "not running", because a broken `ps` reporting every process as gone would turn this
 * whole mechanism into a no-op that still logs success.
 */
export async function stampOf(pid: number): Promise<Observed> {
  let stdout: string
  try {
    // Absolute, not `ps`. A GUI app launched from the Dock does not inherit a shell's PATH, and
    // `what-the-app-can-start.test.ts` holds every fixed-binary module in this app to naming its
    // path for that reason. `/bin/ps` is where it is on macOS and Linux alike.
    ;({ stdout } = await run('/bin/ps', ['-o', 'lstart=', '-p', String(pid)]))
  } catch (error) {
    // `ps` says "no such process" by exiting 1 with nothing on stdout. A real failure — `ps` not
    // found, killed by a signal — has a different shape and must not be read as an answer.
    const code = (error as { code?: unknown }).code
    if (code === 1 || code === '1') return null
    throw error
  }
  const since = stdout.trim()
  return since === '' ? null : { since }
}

async function load(root: string): Promise<{ ok: true; entries: Spawned[] } | { ok: false; reason: string }> {
  let text: string
  try {
    text = await readFile(pathOf(root), 'utf8')
  } catch (error) {
    // Absent really is empty here: nothing writes this file until a child is spawned.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, entries: [] }
    return { ok: false, reason: `${RUNNING_FILE} could not be read — ${(error as Error).message}` }
  }
  try {
    const parsed = JSON.parse(text) as { entries?: unknown }
    const entries = Array.isArray(parsed.entries) ? (parsed.entries as Spawned[]) : []
    return { ok: true, entries }
  } catch (error) {
    return { ok: false, reason: `${RUNNING_FILE} is here and will not parse — ${(error as Error).message}` }
  }
}

async function store(root: string, entries: readonly Spawned[]): Promise<void> {
  const path = pathOf(root)
  await mkdir(join(root, STATE_DIR), { recursive: true })
  const temp = `${path}.${process.pid}.${++saveSeq}.tmp`
  await writeFile(temp, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

/**
 * What came of trying to write a child down.
 *
 * `recorded: false` with `problem: null` is the ordinary case — the child was already gone
 * before it could be stamped, so there is nothing identifiable to record and nothing wrong.
 * A non-null `problem` is the record file refusing to be read, which is the case that used to
 * be indistinguishable from success.
 */
export interface Remembered {
  readonly recorded: boolean
  readonly problem: string | null
}

/**
 * Record a child this office just started.
 *
 * Both stamps are taken now, while both processes are certainly alive. Taking the owner's stamp
 * later would mean reading it from a process that may already be the crash being recorded.
 */
export function remember(root: string, childPid: number, what: string): Promise<Remembered> {
  return writes(async () => {
    const [child, owner] = await Promise.all([stampOf(childPid), stampOf(process.pid)])
    // No stamp means it is already gone, or we cannot see our own process. Either way there is
    // nothing identifiable to record, and an entry without an identity is one this must not kill.
    if (child === null || owner === null) return { recorded: false, problem: null }
    const existing = await load(root)
    /*
     * Not recorded, and it says so.
     *
     * Refusing is right: `store` writes the whole file, so appending to a record that would not
     * parse would delete the entries it still holds — the fault `hired-from.json` had. What was
     * wrong is that this returned as though it had succeeded, so `rememberHere`'s `.catch()`
     * could never fire and the module reported nothing while quietly becoming a no-op for the
     * rest of the session.
     *
     * The consequence is real: every child spawned after this point goes unwritten, so a crash
     * leaves them running against the user's allowance with nothing left to reap them by. The
     * same `reason` is already raised at startup as an `orphans-unknown` notice — this makes
     * the later, quieter occurrences of it answerable too.
     */
    if (!existing.ok) return { recorded: false, problem: existing.reason }
    const entries = existing.entries.filter((e) => e.child.pid !== childPid)
    entries.push({ child: { pid: childPid, since: child.since }, owner: { pid: process.pid, since: owner.since }, what })
    await store(root, entries)
    return { recorded: true, problem: null }
  })
}

/** Drop a child that has exited. Called on the ordinary path, so the record stays short. */
export function forget(root: string, childPid: number): Promise<void> {
  return writes(async () => {
    const existing = await load(root)
    if (!existing.ok) return
    const entries = existing.entries.filter((e) => e.child.pid !== childPid)
    if (entries.length === existing.entries.length) return
    await store(root, entries)
  })
}

export interface Reaped {
  /** Names of the orphans actually killed. Empty on an ordinary launch. */
  readonly killed: readonly string[]
  /** Why the reap could not happen, when it could not. Never silence. */
  readonly problem: string | null
}

/**
 * Kill anything a previous office left running, and rewrite the record.
 *
 * Runs at startup, before the window is worth looking at. Every entry it reads was written by a
 * process that is probably dead, so the decision for each one is `shared/orphans.ts`'s and not
 * this function's — three of its four answers kill nothing.
 */
export function reapOrphans(root: string): Promise<Reaped> {
  return writes(async () => {
    const existing = await load(root)
    if (!existing.ok) return { killed: [], problem: existing.reason }
    if (existing.entries.length === 0) return { killed: [], problem: null }

    const verdicts = await Promise.all(
      existing.entries.map(async (entry) =>
        verdictFor(entry, await stampOf(entry.owner.pid), await stampOf(entry.child.pid)),
      ),
    )

    const killed: string[] = []
    for (const verdict of verdicts) {
      if (verdict.act !== 'kill') continue
      try {
        // The group, matching how `runClaude` stops one: the child was spawned `detached`, so it
        // leads its own group, and `claude` starts tools of its own inside it. Killing the pid
        // alone would leave those behind — the same leak one level down.
        process.kill(-verdict.pid, 'SIGKILL')
        killed.push(verdict.what)
      } catch {
        try {
          process.kill(verdict.pid, 'SIGKILL')
          killed.push(verdict.what)
        } catch {
          // Exited between the stamp and the signal. Nothing to do and nothing to report.
        }
      }
    }

    await store(root, keepAfterReap(existing.entries, verdicts))
    return { killed, problem: null }
  })
}

/**
 * Where this office keeps its record, set once at startup.
 *
 * Every function above takes its root as an argument, which is what makes them testable against
 * a temporary directory. `runClaude` is the one caller that cannot supply it: it is four call
 * sites down from the only module that knows the workspace, and threading a root through
 * `SessionOptions`, `RunOptions`, asides and the voice digest would put the same string in five
 * signatures to answer a question that has one answer per process.
 *
 * So it is set once, beside the workspace root it comes from, and read by the two wrappers
 * below. Unset — every test, and the CLI — they do nothing, which is the right behaviour rather
 * than a fallback guess at a directory to write into.
 */
let here: string | null = null

export function recordOrphansIn(root: string): void {
  here = root
}

/**
 * Record a child under the configured root, or do nothing if there is not one.
 *
 * Fire and forget, deliberately: spawning happens far from any surface that could show a notice,
 * and a record that could not be written must not take the run down with it. The cost is a child
 * this office cannot reap after a crash — the state we were already in.
 *
 * What changed is upstream of here. `remember` used to return as though it had written the child
 * down when it had not, so this function had no failure to ignore and its `.catch()` could never
 * fire. It now says which of the two happened, and the same `reason` is raised at startup as an
 * `orphans-unknown` notice. Nothing on this path reads the result yet — wiring a mid-session
 * notice is a larger change than the false success was, and is not made here.
 */
export function rememberHere(childPid: number, what: string): void {
  if (here === null) return
  void remember(here, childPid, what).catch(() => {})
}

/** Drop a child that exited. Same contract as `rememberHere`. */
export function forgetHere(childPid: number): void {
  if (here === null) return
  void forget(here, childPid).catch(() => {})
}
