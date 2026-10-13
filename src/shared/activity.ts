/**
 * The activity strip's model: what is happening now, and what happened.
 *
 * ## State before history
 *
 * The strip has three zones and the order is the whole design. **What needs you** comes first,
 * because a held tool call and a finished task are not the same kind of news and a feed that
 * mixes them buries the one you have to answer. **What is running** comes second, as current
 * state you read in a glance. **What happened** comes last, as a log you read on purpose.
 *
 * A single reverse-chronological feed — the obvious shape — fails all three: the thing needing
 * an answer scrolls away under the things that do not, and "who is working" has to be inferred
 * by reading backwards until you find an unmatched start.
 *
 * ## The one rule that is easy to get wrong
 *
 * `run_in_background` defaults to **true**, so a dispatch's `tool_result` arrives within
 * milliseconds and is a *launch receipt*, not an answer. Treating it as an ending is the bug
 * that made an employee walk to their desk and immediately walk back to report while the agent
 * was still working. `Choreographer` learned this the hard way and keeps a `background` set;
 * this file keeps the same rule, deliberately identical, so the strip and the floor cannot
 * disagree about who is busy.
 *
 * Pure and immutable: every function takes a state and returns a new one, so the strip can be
 * tested without a DOM and replayed from a transcript.
 */

import type { Fact } from './floor/choreography.js'
import type { Quiet } from './ipc.js'

/** Somebody the office believes is working right now. */
export interface Running {
  readonly who: string
  /** What they were asked for, when the dispatch carried a brief. */
  readonly brief: string | null
  /** What they are doing this instant: a tool name, a skill, or plain work. */
  readonly doing: string
  /** ISO timestamp of the dispatch, for "how long has this been going". */
  readonly since: string
  /**
   * When anything was last heard about this row.
   *
   * Not the same as `since`, and the difference is the whole of the watchdog. `since` says how
   * long the task has been going, which is a fine thing to know and says nothing at all about
   * whether it is still going. This says when the office last received *any* event for it — so
   * a long task that is plainly working and a task whose backend went away are two different
   * numbers instead of one.
   *
   * Starts at the dispatch, because a dispatch is itself the most recent thing we have heard.
   */
  readonly lastAt: string
  readonly toolUseId: string
}

/**
 * How long a running dispatch may go without a single event before the strip says so.
 *
 * **Six minutes.** The number has to clear a healthy silence, and a healthy silence here is
 * longer than it looks: with `run_in_background` on, the parent stream hears `task_started` when
 * a subagent begins and `task_notification` when it finishes, and in between it can hear nothing
 * whatsoever while the agent reads twenty files and runs a test suite. Two- and three-minute gaps
 * are ordinary. Six is comfortably past the longest routine gap seen in this repo's own builds,
 * and comfortably short of the point where somebody watching gives up and starts guessing.
 *
 * The asymmetry is deliberate and it is why the number is not tighter. This threshold never
 * *does* anything — it never kills a process, never retries, never marks anything failed. It
 * only makes a fact visible. A threshold that fires late costs a few minutes of not knowing; a
 * threshold that fires on every healthy dispatch trains people to ignore the one time it matters,
 * and a warning nobody reads is worse than no warning because it looks like coverage.
 */
export const QUIET_AFTER_MS = 6 * 60 * 1000

export type EntryKind = 'dispatch' | 'done' | 'skill' | 'meeting' | 'refused' | 'failed' | 'note'

/** One line of history. Past tense, one clause, and always attributable. */
export interface Entry {
  readonly kind: EntryKind
  readonly who: string
  readonly text: string
  readonly at: string
  /**
   * Set when this line was rebuilt from a transcript rather than watched happen.
   *
   * F2: this state lives in memory only, so a relaunch left the strip saying *"Nothing yet this
   * session"* beside a transcript full of dispatches. Both sentences were true and together
   * they read as a lie — standing order three broken by omission rather than by claim.
   *
   * Rebuilding the log fixes that, but a rebuilt line is **not the same claim** as a watched
   * one. The office was not running when it happened; it is reading a file afterwards and can
   * vouch for nothing the file does not record. Marked here so the strip can say which is
   * which, rather than passing hearsay off as observation.
   *
   * Only ever `true` or absent. There is no such thing as a line that is emphatically live.
   */
  readonly restored?: true
}

export interface ActivityState {
  readonly running: readonly Running[]
  /** Newest first, capped. History is a log you read on purpose, not a thing that grows forever. */
  readonly history: readonly Entry[]
}

export const EMPTY_ACTIVITY: ActivityState = { running: [], history: [] }

/**
 * How many lines of history to keep.
 *
 * The strip is not the transcript and must not become a second one — the record of what an
 * employee did lives on their card, read from their own session, and that is the thing to open
 * when you want more than this. Capping here is what stops a long session paying a growing
 * per-event cost to render a list nobody scrolls to the bottom of.
 */
export const HISTORY_LIMIT = 60

interface Pending {
  readonly who: string
  readonly brief: string | null
  readonly since: string
  /** Set once a `running` fact says this id is a background task. */
  readonly background: boolean
}

/** Dispatches in flight, keyed by tool use id. Carried alongside the state, never rebuilt. */
export type InFlight = ReadonlyMap<string, Pending>

export interface Activity {
  readonly state: ActivityState
  readonly inFlight: InFlight
}

export const EMPTY: Activity = { state: EMPTY_ACTIVITY, inFlight: new Map() }

/**
 * Fold one fact in.
 *
 * `at` is passed rather than read from a clock so a replay produces the same strip every time,
 * and so a test does not have to freeze time to assert on an ordering.
 */
export function applyFact(activity: Activity, fact: Fact, at: string): Activity {
  const inFlight = new Map(activity.inFlight)

  switch (fact.kind) {
    case 'dispatch': {
      inFlight.set(fact.toolUseId, {
        who: fact.employee,
        brief: fact.brief,
        since: at,
        background: false,
      })
      return {
        inFlight,
        state: {
          running: runningFrom(inFlight, activity.state),
          history: push(activity.state.history, {
            kind: 'dispatch',
            who: fact.employee,
            text: fact.brief ? `picked up: ${fact.brief}` : 'picked up a task',
            at,
          }),
        },
      }
    }

    case 'running': {
      // Not an ending and not a start — a note that the `tool_result` about to arrive for this
      // id is a receipt. Nothing is added to history: the dispatch line already said this.
      const pending = inFlight.get(fact.toolUseId)
      if (!pending) return activity
      inFlight.set(fact.toolUseId, { ...pending, background: true })
      return { inFlight, state: activity.state }
    }

    case 'delivered': {
      const pending = inFlight.get(fact.toolUseId)
      // Most tool results are not subagent results. An id nobody dispatched is a `Read` or a
      // `Bash` coming home and belongs to nobody's row.
      if (!pending) return activity

      if (pending.background) {
        // The launch receipt. Clear the flag so the real completion — same id — is the ending.
        inFlight.set(fact.toolUseId, { ...pending, background: false })
        return { inFlight, state: activity.state }
      }

      inFlight.delete(fact.toolUseId)
      return {
        inFlight,
        state: {
          running: runningFrom(inFlight, activity.state),
          history: push(activity.state.history, {
            kind: 'done',
            who: pending.who,
            text: pending.brief ? `handed back: ${pending.brief}` : 'handed the result back',
            at,
          }),
        },
      }
    }

    case 'acting':
      // A tool call refines what somebody is doing; it does not start or end anything, and it
      // is far too frequent to be history. Ten `Read`s in a row are one person working.
      return { inFlight, state: { ...activity.state, running: withDoing(activity.state.running, fact.who, fact.tool, at) } }

    case 'fetching':
      return {
        inFlight,
        state: {
          running: withDoing(activity.state.running, fact.who, `/${fact.skill}`, at),
          history: push(activity.state.history, {
            kind: 'skill',
            who: fact.who,
            text: `used the ${fact.skill} skill`,
            at,
          }),
        },
      }

    case 'meeting':
      return {
        inFlight,
        state: {
          ...activity.state,
          history: push(activity.state.history, {
            kind: 'meeting',
            who: fact.convener,
            text:
              fact.attendees.length > 0
                ? `called a meeting with ${fact.attendees.join(', ')}`
                : 'called a meeting with nobody',
            at,
          }),
        },
      }

    case 'settled':
    case 'composing':
    case 'conversing':
      // All three are about the floor's motion, not about work changing hands.
      return activity
  }
}

/**
 * What the strip says when the voice considered a turn and stayed quiet.
 *
 * Wording matters more here than it looks. `judged` has to read as the feature working — the
 * digest's whole job is restraint, and a line that reads like an apology would train someone to
 * switch off the thing that is protecting them. `failed` has to read as a fault, because it is
 * one, and because before this it produced *the same silence* as a good judgement.
 *
 * Neither says "voice", which is the toggle's old name and no longer anything the person sees.
 */
export function quietNote(quiet: Quiet, who: string, at: string): Entry {
  return quiet === 'failed'
    ? { kind: 'failed', who, text: 'Nothing was read aloud — the summary could not be written.', at }
    : { kind: 'note', who, text: 'Nothing worth reading aloud this turn.', at }
}

/** A run of adjacent entries that say the same thing, shown as one line. */
export interface Run {
  readonly entry: Entry
  /** How many entries this stands for. 1 for an ordinary line. */
  readonly count: number
}

/**
 * Collapse adjacent identical entries.
 *
 * Reported against forty-one consecutive `you · allowed Bash` lines: the strip logs everything,
 * and that is a lot of clutter. The cap is sixty entries and forty-one of them said the
 * same six characters, so the log had spent two thirds of its room saying one thing.
 *
 * Adjacent only, and identical only — same author, same kind, same text. Two different commands
 * never merge, because the fix for "I cannot tell what I allowed" must not become "I can see one
 * of the things I allowed". The timestamp shown is the **most recent** of the run, since that is
 * the one somebody is looking for when they scan a log from the top.
 */
export function collapse(history: readonly Entry[]): Run[] {
  const runs: Run[] = []
  for (const entry of history) {
    const last = runs[runs.length - 1]
    if (
      last &&
      last.entry.kind === entry.kind &&
      last.entry.who === entry.who &&
      last.entry.text === entry.text &&
      // A restored line and a live one are different claims even when they read identically,
      // and the boundary between the two is exactly where they sit next to each other. Folding
      // across it would put this session's count on a previous session's line — the strip
      // claiming to have watched something it only read.
      (last.entry.restored ?? false) === (entry.restored ?? false)
    ) {
      // Newest first is how history is stored, so the entry already held is the later one.
      runs[runs.length - 1] = { entry: last.entry, count: last.count + 1 }
      continue
    }
    runs.push({ entry, count: 1 })
  }
  return runs
}

/** Record something that is not a fact about the stream: a refusal, a failure, a note. */
export function applyNote(activity: Activity, entry: Entry): Activity {
  return { inFlight: activity.inFlight, state: { ...activity.state, history: push(activity.state.history, entry) } }
}

/**
 * A turn ended, so nobody is running any more.
 *
 * Called when the session goes idle. Without it, a dispatch whose result never arrived — the
 * process was killed, the turn was interrupted — leaves somebody shown as working forever,
 * which is the third standing order broken by omission rather than by claim.
 */
export function settle(activity: Activity, at: string): Activity {
  if (activity.inFlight.size === 0) return activity

  const abandoned = [...activity.inFlight.values()]
  return {
    inFlight: new Map(),
    state: {
      running: [],
      history: abandoned.reduce(
        (history, pending) =>
          push(history, {
            kind: 'note',
            who: pending.who,
            text: 'the turn ended before they reported back',
            at,
          }),
        activity.state.history,
      ),
    },
  }
}

function runningFrom(inFlight: InFlight, previous: ActivityState): readonly Running[] {
  return [...inFlight.entries()].map(([toolUseId, pending]) => {
    const before = previous.running.find((r) => r.toolUseId === toolUseId)
    return {
      toolUseId,
      who: pending.who,
      brief: pending.brief,
      since: pending.since,
      // Keep whatever they were last seen doing, so a redraw does not reset every row to
      // "working" the moment anybody else is dispatched.
      doing: before?.doing ?? 'working',
      // Carried for the same reason, and it matters more: a row rebuilt with `lastAt` reset to
      // now would make a silent dispatch look freshly heard from every time anybody else was
      // dispatched, which is the watchdog quietly never firing.
      lastAt: before?.lastAt ?? pending.since,
    }
  })
}

function withDoing(running: readonly Running[], who: string, doing: string, at: string): readonly Running[] {
  // Only ever refines a row that exists. A tool call by somebody nobody dispatched is the
  // manager working in the chat, and inventing a row for them would put a person on the strip
  // who is not on the floor.
  if (!running.some((r) => r.who === who)) return running
  // `lastAt` moves with `doing`, because this *is* the event arriving: something was heard about
  // this row, and the watchdog's only question is when that last happened.
  return running.map((r) => (r.who === who ? { ...r, doing, lastAt: at } : r))
}

/**
 * How long the office has heard nothing about a running dispatch, in whole minutes.
 *
 * `null` when it has not been quiet long enough to be worth saying, which is almost always.
 *
 * Whole minutes down, never up: a row quiet for 5 minutes 59 seconds says five, because the
 * number goes into a sentence somebody may act on and one that rounds up is a sentence that
 * overstates. Same rule as `elapsed`, for the same reason.
 */
export function quietFor(row: Running, nowMs: number): number | null {
  const heard = Date.parse(row.lastAt)
  if (Number.isNaN(heard)) return null
  const silence = nowMs - heard
  if (silence < QUIET_AFTER_MS) return null
  return Math.floor(silence / 60000)
}

/**
 * What the strip says about a quiet dispatch.
 *
 * **Quiet is a fact; dead is a different claim.** This sentence is only ever allowed to report
 * the first. The office does not know that the agent has stopped, that the process has gone, or
 * that the work has failed — it knows that nothing has arrived, and that is precisely and only
 * what it says. Wording like "stalled", "hung" or "lost" would be the app asserting a diagnosis
 * it has not made, which is the third standing order broken by a word.
 */
export function quietNotice(minutes: number): string {
  return `backend has been quiet for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

function push(history: readonly Entry[], entry: Entry): readonly Entry[] {
  return [entry, ...history].slice(0, HISTORY_LIMIT)
}

/**
 * How long something has been going, in words.
 *
 * Seconds up to a minute, then minutes. Nothing here rounds *up* to the next unit early: a
 * dispatch 59 seconds old says `59s`, because the strip's job is to let somebody notice that a
 * task has been running for eleven minutes, and a scale that reaches "1m" at 45 seconds makes
 * the number in that sentence untrustworthy.
 */
export function elapsed(sinceIso: string, nowMs: number): string {
  const started = Date.parse(sinceIso)
  if (Number.isNaN(started)) return ''
  const seconds = Math.max(0, Math.floor((nowMs - started) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}
