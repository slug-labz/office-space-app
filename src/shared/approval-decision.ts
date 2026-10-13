/**
 * What follows from a decision about a tool call — after the write, never before it.
 *
 * The rule is one line and it was broken by ordering rather than by logic. `app.ts` wrote *"you
 * allowed: <command>"* into the activity log, then called `office.decide`, then said so. The
 * middle step can reject — `approvals.ts` throws on an id containing a slash and on a request
 * addressed to another workspace — and when it does, the card has already gone, the log already
 * says you allowed it, nothing has reached disk, and four minutes later the gate times out and
 * **denies** the call.
 *
 * So the record said the user allowed something that was refused, on the one surface in this app
 * whose whole job is being the receipt. It was invisible because a rejected `invoke` had nowhere
 * to go at all; see `mishaps.ts`.
 *
 * Extracted here rather than left as ordering inside an `async` function, because ordering is
 * what went wrong and ordering is what a test cannot see. This makes it a value: **`note` is
 * `null` unless the write succeeded**, and there is no arrangement of the calling code that can
 * produce a note out of a failure.
 */

import type { PendingApproval } from './ipc.js'

export interface Decision {
  /** Whether the verdict reached disk. Everything else follows from this. */
  readonly recorded: boolean
  /** What to append to the activity log, or `null` — which is what a failure produces. */
  readonly note: string | null
  /** What to say in the transcript, and in which tone. */
  readonly said: string
  readonly tone: 'done' | 'failed'
  /**
   * Whether the card goes back on the strip.
   *
   * It does, on failure, and this is not merely tidiness: the request is still live until the
   * gate gives up on it, and the card is the only way to try again. A decision that failed and
   * took its own control away leaves a call that can only ever time out.
   *
   * "Goes back" means it may: `afterDecision` puts it back only while main still lists the call.
   */
  readonly restore: boolean
}

export function decided(options: {
  /** The tool the call was for — `Bash`, `Write`. What the sentence names. */
  readonly tool: string
  /** The command or path, already summarised for the card. What the log names. */
  readonly line: string
  readonly allow: boolean
  /** Why the write failed, already unwrapped into a sentence. `null` when it did not. */
  readonly failure: string | null
}): Decision {
  const { tool, line, allow, failure } = options
  const verb = allow ? 'allowed' : 'refused'

  if (failure !== null) {
    // A rejection can carry no message at all, and "was not allowed — ." is a sentence with a
    // hole in it. Saying the reason is missing is still more than saying nothing.
    const why = failure.trim() === '' ? 'the reason was not reported' : failure
    return {
      recorded: false,
      // The whole point. A log entry here is a record of something that did not happen.
      note: null,
      said:
        `${tool} was not ${verb} — ${why}. ` +
        `Nothing was recorded, so the office will deny this call when it stops waiting.`,
      tone: 'failed',
      restore: true,
    }
  }

  return {
    recorded: true,
    // The command, not the tool. This read `allowed Bash`, forty-one times in a row, and could
    // not answer the only question anybody would put to a log: *what did I allow?*
    note: `${verb}: ${line}`,
    said: `${tool} ${allow ? 'allowed, once' : 'refused'}.`,
    // A refusal is a decision that worked. The tone follows what was decided, not whether the
    // write succeeded — those are two different questions and `recorded` answers the other one.
    tone: allow ? 'done' : 'failed',
    restore: false,
  }
}

/**
 * The held calls this window draws cards for: what main last pushed, and what this window has
 * done about them since.
 *
 * ## Why the strip cannot draw main's list as it comes
 *
 * Main lists every call whose request file is on disk, and a request stays on disk until the gate
 * reads its verdict. So a call somebody has just answered is still listed while its verdict is
 * being written, and after that until the gate's next poll deletes the request. `app.ts` took the
 * card off at the press and then assigned each push whole, so a push in either window put the
 * answered card back up, where it could be pressed again.
 *
 * Measured in the dev harness on 2026-09-16, on dev at `cc63256`:
 * - A push during the write put the card back, and it stayed up after the write succeeded.
 * - A push after the write, before cleanup, put it back beside the call that had just arrived.
 *
 * The same assignment ran the other way on a failure: the list saved at the press went back, so a
 * call that arrived during the write was dropped, and one the gate let go of meanwhile came back.
 * Main pushes only when the set of held calls changes, so nothing put either right.
 *
 * ## The rule
 *
 * The cards are main's last list, less two sets of `sessionId.toolUseId`, the gate's own name for
 * a call:
 * - **`writing`**: pressed, and not settled yet. Never pruned by a push. Every press settles, in
 *   a `finally` in `app.ts`, and until it does the card stays down whatever main says, even when
 *   pushes arrive out of order.
 * - **`written`**: settled with the verdict on disk. Pruned by the first push that leaves the call
 *   out, which is main saying the gate has let go of it.
 *
 * A decision that did not reach disk leaves both sets. Its card is back exactly when main still
 * lists the call, and every push that landed during the write stands.
 *
 * ## What this assumes: main's pushes arrive in order
 *
 * `written`, and the card a failed decision puts back, both read the latest push as the truth. An
 * older list arriving after a newer one breaks that, found in review:
 * - a call is answered, a newer list drops it, and an older list that still names it brings its
 *   card back;
 * - the gate lets go of a call while its write is failing, and an older list that still names it
 *   brings back a card nobody can answer.
 *
 * Neither is new: dev showed the card in both. Sending main's lists in order is main's half, a
 * separate change. `writing` does not depend on the order.
 */
export interface Held {
  /** Main's last list, as pushed. */
  readonly reported: readonly PendingApproval[]
  readonly writing: ReadonlySet<string>
  readonly written: ReadonlySet<string>
}

export const NOTHING_HELD: Held = { reported: [], writing: new Set(), written: new Set() }

/** A call as the gate names its files, and as the watcher keys them. */
const keyOf = (approval: PendingApproval): string => `${approval.sessionId}.${approval.toolUseId}`

/** Main pushed a list. It is all that is held now: an answered call it leaves out is forgotten. */
export function afterPush(held: Held, reported: readonly PendingApproval[]): Held {
  const listed = new Set(reported.map(keyOf))
  return { ...held, reported, written: new Set([...held.written].filter((key) => listed.has(key))) }
}

/** A card was pressed, and its decision is being written. */
export function afterPress(held: Held, request: PendingApproval): Held {
  return { ...held, writing: new Set([...held.writing, keyOf(request)]) }
}

/**
 * A decision settled. `restore` is `decided`'s: true when the verdict did not reach disk.
 *
 * A written call is remembered even if main has already stopped listing it. That costs one key
 * until the next push, and it keeps the card down if an older list arrives after a newer one.
 */
export function afterDecision(
  held: Held,
  request: PendingApproval,
  outcome: Pick<Decision, 'restore'>,
): Held {
  const key = keyOf(request)
  const writing = new Set([...held.writing].filter((k) => k !== key))
  if (outcome.restore) return { ...held, writing }
  return { ...held, writing, written: new Set([...held.written, key]) }
}

/** The cards to draw: main's list, less every call this window is writing or has written. */
export function cardsFrom(held: Held): readonly PendingApproval[] {
  return held.reported.filter((approval) => {
    const key = keyOf(approval)
    return !held.writing.has(key) && !held.written.has(key)
  })
}
