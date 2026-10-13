/**
 * Deciding whether a process left over from a previous run is ours to kill.
 *
 * ## The door `children.ts` could not close
 *
 * That module's header states the failure it exists to prevent: close the office mid-turn and
 * the `claude` children carry on, *"still running, still talking to Anthropic, still spending
 * the allowance — with nothing left on screen to show it or stop it."* It closes that door for
 * a clean quit — `before-quit` calls `stopAll()` — and for a reload.
 *
 * It cannot close it for a crash. `before-quit` does not run when the app is killed, and
 * `runClaude` spawns with `detached: true` precisely so the child leads its own process group,
 * which also means the kernel will not take it down with its parent. Measured, with the agent
 * confirmed mid-answer: `SIGKILL` the Electron main, and the `claude` child is still alive
 * twenty seconds later, reparented to init. It is the exact failure the module was written to
 * stop, reached through the one door it does not cover — and worse than the original, because
 * after a crash there is no window left to notice it from.
 *
 * A force quit, an OOM kill, and `pkill Electron` all arrive here. So the record has to survive
 * the crash: what was spawned goes on disk, and the next office to start reads it.
 *
 * ## Why this is a decision and not a loop over `kill`
 *
 * Because a pid on its own is not an identity. Between the crash and the next launch the
 * operating system is free to hand that number to something else, and `kill -9` on a stale pid
 * is this app killing a stranger's process — a far worse bug than the one being fixed. So an
 * entry records **when** each process started as well as its number, and a pid whose start time
 * has changed is a different process wearing a recycled number. It is left alone.
 *
 * The same reasoning applies upward. Two offices can be open at once, and a child recorded by a
 * *running* office is not an orphan at all — it is somebody's live conversation. So each entry
 * also records the office that spawned it, and only a child whose owner is gone is a candidate.
 * Reaping without that check would make opening a second window kill the first one's work.
 *
 * Four outcomes, and only one of them kills anything. That is the whole reason this is a pure
 * function with a test rather than three lines inside the startup path.
 *
 * ## What this does not cover, stated rather than discovered
 *
 * The reap runs at startup, so an orphan is cleared by *the next office to open*. With two
 * windows on one workspace and only one of them crashing, the survivor does not clear the other's
 * children — it is already running, and nothing asks it to look again. That orphan lives until
 * an office is launched.
 *
 * Left as it is on purpose. A periodic sweep would close it, and the decision above is safe to
 * run as often as you like — a live owner is checked every time — but it buys a rare case at the
 * cost of a timer reading a file forever, and the common shape of this by a wide margin is crash
 * then reopen, which startup already covers. Written down because the alternative is somebody
 * finding the gap later and assuming it was missed.
 */

/** A process, identified by its number *and* the moment it started. */
export interface Stamp {
  readonly pid: number
  /**
   * The start time exactly as the platform reported it, compared as an opaque string.
   *
   * Not parsed into a date on purpose. The only thing ever asked of it is whether it is the same
   * string as last time, and a parser is a second definition of the same fact — which is the
   * shape of bug this repository keeps finding.
   */
  readonly since: string
}

/** One spawned child, and the office that spawned it. */
export interface Spawned {
  readonly child: Stamp
  readonly owner: Stamp
  /** Named for the log line a person reads afterwards, same as `Child.what`. */
  readonly what: string
}

/** What a pid looks like right now: its start time, or nothing running under that number. */
export type Observed = { readonly since: string } | null

export type Verdict =
  /** The owning office is still running. Somebody's live conversation — not ours to touch. */
  | { readonly act: 'owned' }
  /** Nothing is running under that number. The record is stale and can be dropped. */
  | { readonly act: 'gone' }
  /** Alive, but started at a different moment: the number was recycled. Must not be killed. */
  | { readonly act: 'reused' }
  /** The owner is gone and this is the same process we started. An orphan. */
  | { readonly act: 'kill'; readonly pid: number; readonly what: string }

/**
 * Decide what to do about one recorded child.
 *
 * `ownerNow` and `childNow` are what the platform says about those two pids at this moment.
 * Everything else is the record written before the crash.
 */
export function verdictFor(entry: Spawned, ownerNow: Observed, childNow: Observed): Verdict {
  // The owner first, because a live owner settles it whatever the child is doing. An office that
  // is still up owns its children, and this one is not it.
  if (ownerNow !== null && ownerNow.since === entry.owner.since) return { act: 'owned' }

  if (childNow === null) return { act: 'gone' }
  if (childNow.since !== entry.child.since) return { act: 'reused' }
  return { act: 'kill', pid: entry.child.pid, what: entry.what }
}

/**
 * Which entries to keep in the record after a reap.
 *
 * A killed orphan is finished with, and so is a stale or recycled number. Only a child whose
 * owner is still running stays, because that office will clear its own entry when it exits —
 * dropping it here would leave a live process with nothing recording it, which is the state
 * this whole file exists to prevent.
 */
export function keepAfterReap(entries: readonly Spawned[], verdicts: readonly Verdict[]): Spawned[] {
  const kept: Spawned[] = []
  entries.forEach((entry, i) => {
    if (verdicts[i]?.act === 'owned') kept.push(entry)
  })
  return kept
}

/** What to tell the person, or `null` when a launch found nothing to clean up. */
export function reapMessage(killed: readonly string[]): string | null {
  if (killed.length === 0) return null
  const them = killed.length === 1 ? 'one agent was' : `${killed.length} agents were`
  return (
    `The office did not shut down cleanly last time, and ${them} still running: ` +
    `${killed.join(', ')}. They have been stopped.`
  )
}
