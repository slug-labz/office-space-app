/**
 * Every process this app started, and making sure none outlives it.
 *
 * ## What was happening
 *
 * Nothing killed a running `claude` on quit. Close the window with two projects mid-turn and
 * both children carried on: still running, still talking to Anthropic, still spending the
 * allowance — with nothing left on screen to show it or stop it. On a plan with no overage that
 * is not an abstract leak, it is minutes of a seven-day window going somewhere nobody can see.
 *
 * A reload is the same failure in a smaller costume. The renderer reloads, the main process
 * keeps its children, and the second set is started beside the first.
 *
 * ## Why a registry rather than each caller tidying up
 *
 * Because the caller is not there at quit time. `runClaude` hands back an `interrupt()` and the
 * session that holds it is a member of a map in another module; at `before-quit` nothing is
 * walking that structure. One list that every child is added to, and one thing that empties it,
 * is the only arrangement where "did we get them all" is a question with an answer.
 */

/** Something startable that can be asked to stop. */
export interface Child {
  /** Named for a log line a person has to read at three in the morning. */
  readonly what: string
  stop(): void
}

/**
 * A registered child, and whether it holds a seat at the cap.
 *
 * The two questions this module answers are not the same one, and conflating them was a real
 * regression. *Is it on the list?* decides whether quit can stop it, and everything that starts
 * a `claude` must answer yes. *Does it take a seat?* decides whether it can refuse somebody
 * else's turn, and only a turn should be able to do that.
 *
 * They were one field for as long as `session.ts` was the only caller, because for one caller
 * they agree. The moment asides and the voice digest were put on the list — so that quit could
 * stop them, which it could not — twelve background asides began refusing the user's own
 * conversation, with a message calling them *"conversations already mid-answer"*. The office
 * would have gone unusable while telling the user something untrue about why.
 */
interface Registered extends Child {
  readonly rationed: boolean
}

/**
 * How many `claude` children may run at once.
 *
 * My own correction in round 18, adopted into the **scalable** exit condition and then not
 * built by either of us: *"twenty projects open is twenty-plus real Node children, each with
 * real RSS. That is the limit we will hit first and it is not in the row. Add a number, and a
 * defined behaviour at the cap — refusing to start a 21st session with a reason is fine;
 * discovering the cap by swapping is not."* Laptop 2 found it missing by walking the exit
 * conditions rather than the feature list.
 *
 * Twelve, and the number is derived rather than picked. A child is only live **while a turn is
 * running**, not per open project — so this is a cap on simultaneous *turns*, and twenty open
 * projects cost nothing until you talk to them. Each `claude` is a Node process with a baseline
 * around 50–60 MB resident; twelve is roughly 700 MB on top of Electron's own ~300 MB, which
 * stays under a gigabyte on any machine that can run this app at all.
 *
 * It is deliberately far above real use. Nobody has twelve conversations mid-answer on purpose;
 * a number this high is only ever reached by something looping, which is exactly the case worth
 * stopping. A cap tight enough to inconvenience anybody would be a cap people learn to resent
 * rather than one that catches a runaway.
 */
export const MAX_LIVE = 12

const live = new Set<Registered>()

/** Register a child. Returns a function that unregisters it — call it when the child exits. */
export function track(child: Child): () => void {
  return register(child, false)
}

/**
 * Put a child on the list and hand back the way off it.
 *
 * Rebuilt rather than stored as given, so `rationed` cannot be set by a caller passing an object
 * with an extra field. The closure holds the entry it made, which is what makes releasing exact
 * even when two children share a name.
 */
function register(child: Child, rationed: boolean): () => void {
  const entry: Registered = { what: child.what, stop: () => child.stop(), rationed }
  live.add(entry)
  return () => {
    live.delete(entry)
  }
}

/** How many hold a seat. The cap counts turns, not everything that is running. */
function seatsTaken(): number {
  let taken = 0
  for (const child of live) if (child.rationed) taken += 1
  return taken
}

export type Admission =
  | { readonly ok: true; readonly release: () => void }
  /** Why not, in words for the person who asked. Never a code, never silence. */
  | { readonly ok: false; readonly reason: string }

/**
 * Ask whether another child may start, and register it if so.
 *
 * One call rather than `liveCount() < MAX_LIVE` followed by `track()`, because those two are a
 * race with a real trigger: two projects whose turns begin in the same tick would both read
 * eleven and both start, and the cap would be a number that is exceeded exactly when it is
 * being enforced. The check and the registration have to be the same operation.
 *
 * **Refuses rather than queues.** A queue would make the office silently slow instead of
 * silently over-subscribed, which is the same failure wearing a better hat — the person is
 * still not told, and now they are waiting for something with no stated end. A refusal names
 * what is running and can be acted on.
 */
export function admit(child: Child): Admission {
  if (seatsTaken() >= MAX_LIVE) {
    return {
      ok: false,
      // Names them, because "too many" is not something anybody can act on and this is: the
      // list is what tells you which conversation to stop, or that something is looping.
      reason:
        `${MAX_LIVE} conversations are already mid-answer, which is this app's limit on ` +
        // The ones holding seats, not everything on the list. Naming a background aside in a
        // refusal about conversations would be an accurate list answering the wrong question,
        // and the person reading it is trying to work out which turn to stop.
        `simultaneous claude processes. Nothing was started. Running now: ${seated().join(', ')}.`,
    }
  }

  return { ok: true, release: register(child, true) }
}

/** How many are running. For the quit path to report, and for tests to assert on. */
export function liveCount(): number {
  return live.size
}

export function liveChildren(): readonly string[] {
  return [...live].map((c) => c.what)
}

/** Only the ones holding a seat at the cap — what a refusal about the cap is entitled to name. */
export function seated(): readonly string[] {
  return [...live].filter((c) => c.rationed).map((c) => c.what)
}

/**
 * Stop everything, and say what was stopped.
 *
 * Never throws. A child that fails to stop must not prevent the next one being asked — quitting
 * halfway through the list is how one stuck process keeps four others alive.
 */
export function stopAll(): readonly string[] {
  const stopped: string[] = []
  for (const child of [...live]) {
    try {
      child.stop()
      stopped.push(child.what)
    } catch {
      // Already gone, or refusing. Either way the next one still gets asked.
    }
    live.delete(child)
  }
  return stopped
}
