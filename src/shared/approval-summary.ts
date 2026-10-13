/**
 * Saying what a held tool call is about to do, in one line.
 *
 * F18 built the rendezvous: a `PreToolUse` hook parks a tool call and waits for a verdict. This
 * is what the person deciding actually reads, and it is the whole safety property — a card that
 * summarises loosely is worse than no card, because it invites a confident yes to something the
 * reader did not see.
 *
 * So three rules, and they are not stylistic:
 *
 * 1. **Never paraphrase the payload.** The command is shown as the command. `rm -rf build` does
 *    not become "removes some files"; the point of stopping is to show the string.
 * 2. **An unrecognised tool is not a safe tool.** The default branch names the tool and lists
 *    what it was given, rather than falling back to a reassuring "will run a tool".
 * 3. **A truncated value says it was truncated.** A long command cut silently at 200 characters
 *    can hide the dangerous half after an `&&`.
 */

import type { PendingApproval } from './ipc.js'
import { truncate } from './truncate.js'
import { instantOf, oldestFirst } from './time-order.js'

/** Where a value is cut. Long enough for a real command, short enough to stay one line of card. */
export const MAX_DETAIL = 240

export interface ApprovalSummary {
  /** The tool, as the CLI named it. `mcp__x__y` is shown as written — it says where it goes. */
  readonly tool: string
  /** The one thing this call is about: a command, a path, a URL. Empty when there isn't one. */
  readonly detail: string
  /** True when `detail` was cut. The card must say so rather than imply the string ended. */
  readonly truncated: boolean
  /** Everything else it was given, as `key=value`, so an unrecognised tool is still legible. */
  readonly rest: readonly string[]
  /**
   * Whether this call reaches outside the workspace or changes it.
   *
   * Advice for ordering, never a verdict — nothing here decides anything, and a call not marked
   * is not thereby approved. The hook denies on timeout regardless of what this field says.
   */
  readonly weight: 'writes' | 'reads' | 'network' | 'unknown'
  /**
   * Whose command is stopped, in the words the card should use.
   *
   * `PendingApproval.agent` was measured in main, sent across, and read by nothing — while both
   * the field's own comment ("the floor draws the waiting desk from this") and main's comment at
   * the point it is built ("`null` is the manager, not 'we could not tell'") described a
   * behaviour that did not exist. Two careful notes about a feature nobody had written.
   *
   * It matters on a floor with seven people on it. "One call is waiting" does not say whose desk
   * is stopped, and the whole premise of this app is that you can see who is doing what.
   */
  readonly blockedBy: string
}

/**
 * Who is stopped, from the agent field.
 *
 * `null` is a positive answer and not a gap: the CLI puts `agent_type` on every subagent tool
 * call and on none of the manager's, which is measured rather than assumed. So `null` is the
 * manager, and it is named rather than left blank — a card with no name on it reads as one the
 * app could not attribute, which is the more worrying of the two and the wrong one.
 */
export function blockedBy(agent: string | null): string {
  return agent ?? 'the manager'
}

/** The field that *is* the call, per tool. Anything else is context. */
const HEADLINE: Readonly<Record<string, string>> = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  NotebookEdit: 'notebook_path',
  Glob: 'pattern',
  Grep: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
  Task: 'description',
}

const WRITES = new Set(['Bash', 'Write', 'Edit', 'NotebookEdit'])
const READS = new Set(['Read', 'Glob', 'Grep'])
const NETWORK = new Set(['WebFetch', 'WebSearch'])

export function summarise(request: PendingApproval): ApprovalSummary {
  const who = blockedBy(request.agent)
  const key = HEADLINE[request.tool]
  const raw = key === undefined ? undefined : request.input[key]
  const detail = raw === undefined ? '' : stringify(raw)

  const rest = Object.entries(request.input)
    .filter(([k]) => k !== key)
    .map(([k, v]) => `${k}=${cut(stringify(v), 80).text}`)

  const { text, truncated } = cut(detail, MAX_DETAIL)

  return { tool: request.tool, detail: text, truncated, rest, weight: weigh(request.tool), blockedBy: who }
}

function weigh(tool: string): ApprovalSummary['weight'] {
  if (WRITES.has(tool)) return 'writes'
  if (READS.has(tool)) return 'reads'
  if (NETWORK.has(tool)) return 'network'
  // An MCP tool goes wherever that server goes, and we cannot know what it does from its name.
  // "unknown" is the honest answer and it sorts to the top, which is where a thing nobody can
  // classify belongs.
  return 'unknown'
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    // A cyclic or exotic value. Saying so beats an empty string that reads as "no argument".
    return '[a value that could not be shown]'
  }
}

function cut(text: string, limit: number): { text: string; truncated: boolean } {
  // No suffix: the caller draws its own mark from `truncated`, so appending one here would
  // show two.
  const cut = truncate(text, limit, '')
  return cut === text ? { text, truncated: false } : { text: cut, truncated: true }
}

/**
 * Oldest first.
 *
 * The hook has a deadline. The request closest to running out is the one a person should answer
 * first, and it is the one that has been on screen longest — so sorting by age is both the
 * urgent order and the stable one, which stops cards moving under a cursor as new ones arrive.
 *
 * By instant, not by text. A call whose time will not parse goes after every call whose time
 * will, rather than first: under `localeCompare` an empty `askedAt` would rank as the oldest call
 * on screen. The hook always writes `toISOString()`, so this guards a hand-edited request file
 * rather than anything the office writes. See `time-order.ts`.
 */
export function inAnswerOrder(requests: readonly PendingApproval[]): readonly PendingApproval[] {
  return [...requests].sort((a, b) => oldestFirst(a.askedAt, b.askedAt))
}

/**
 * How long is left to answer, and whether answering still does anything.
 *
 * ## Why the card needs a clock at all
 *
 * The gate holds a tool call and **refuses it after four minutes** — *"an unanswered request is a
 * denial"*, which is correct and is the safe direction. What the card never said is that a timer
 * was running. Somebody could open the office, read a held command carefully, decide, and click
 * into a request that had already been refused: the employee stayed blocked, the count of missed
 * requests went up by one, and nothing on screen had ever mentioned a deadline.
 *
 * `askedAt` was recorded, sent across the bridge, and read only for sort order. It is the other
 * half of a clock whose first half nobody had written down.
 *
 * ## Three states, and the first one is the important one
 *
 * `unknown` is a request whose gate did not record its wait — an older hook, or one whose file
 * was written by something else. The office then does not know when it expires, and it says
 * nothing rather than assuming the default. A countdown drawn from a guessed deadline is worse
 * than no countdown, because a countdown is believed. Absent is not four minutes.
 *
 * It is also a request whose wait was recorded and whose time will not read. `why` keeps the two
 * apart, because the card says which half is missing, and naming the wrong half is a sentence
 * that is not true.
 */
export type TimeLeft =
  | { readonly state: 'unknown'; readonly why: 'no-wait' | 'unreadable-time' }
  | { readonly state: 'waiting'; readonly seconds: number }
  | { readonly state: 'expired' }

export function timeLeft(askedAt: string, waitMs: number | null, nowMs: number): TimeLeft {
  if (waitMs === null) return { state: 'unknown', why: 'no-wait' }
  // `instantOf`, not `Date.parse`, which reads `'1'` as a day in 2001: the card then said a request
  // the gate was still holding had been refused. A time that will not read is not-knowing, and
  // inventing `now` for it would start a four-minute countdown at the moment somebody looked.
  // The gate writes `toISOString()`, so only a hand-edited request file gets here.
  const asked = instantOf(askedAt)
  if (asked === null) return { state: 'unknown', why: 'unreadable-time' }

  const left = asked + waitMs - nowMs
  if (left <= 0) return { state: 'expired' }
  return { state: 'waiting', seconds: Math.ceil(left / 1000) }
}

/**
 * What the card says about the clock, or `null` when it has nothing to say.
 *
 * Quiet while there is plenty of time. A countdown that runs for the whole four minutes trains
 * somebody to ignore it, and the number only becomes information when it is small enough to
 * change what they do — so it appears at one minute, which is long enough to read a held command
 * and answer it.
 */
export function aboutTheClock(left: TimeLeft): string | null {
  /*
   * Not silent, and this was wrong at first.
   *
   * The countdown only appears under a minute, so on most cards there is no clock and that means
   * *plenty of time*. Absence therefore already has a meaning — and using the same absence for
   * *the office does not know* makes the two indistinguishable, which is standing order 4 landing
   * in the feature built to answer it.
   *
   * Reachable rather than theoretical: the gate writes `waitMs`, `reconcile.ts` only replaces a
   * shipped file whose hash matches a version we shipped, and somebody who has edited their hook
   * keeps the old one for good.
   */
  if (left.state === 'unknown') {
    return left.why === 'no-wait'
      ? 'The office does not know when this expires — the gate that asked did not say how long it would wait.'
      : 'The office does not know when this expires — the time this request was made could not be read.'
  }
  if (left.state === 'expired') {
    // Not "expired". What matters is that the button no longer does what it looks like it does.
    return 'This was refused when nobody answered in time. Answering now will not reach them.'
  }
  if (left.seconds > 60) return null
  return left.seconds === 1
    ? '1 second left to answer'
    : `${left.seconds} seconds left to answer`
}
