/**
 * What the office did with the approvals it was asked for, and over what stretch of time.
 *
 * ## The half that was never written down
 *
 * The approval gate keeps a record of every decision **nobody made** — `missed()` renames an
 * unanswered request into `missed/`, where nothing ever removes it — and deletes every decision
 * somebody **did** make, because `cleanup()` unlinks the verdict the instant it has been read.
 *
 * So the one durable approval-shaped record in this app was a record of absences. *"What did I
 * approve last night"* had no answer at all, and *"how much of the night did the office lose to
 * nobody being there"* had one that could only ever grow.
 *
 * This module decides what the two halves add up to, and what one of them says. It reads no
 * files — `approvals.ts` hands it names for counting and text for parsing.
 *
 * ## Why the facts are in the filenames
 *
 * Both directories are unbounded — nothing prunes either — so anything that had to open each
 * file to count it would get slower every night the office ran unattended, which is exactly the
 * night this feature exists for. `approvalRecord` already avoids that: it takes the names from
 * one `readdir` per directory and opens nothing. This keeps the same **per-file** cost — the
 * time and the outcome travel in the name.
 *
 *     <epochMs>.<outcome>.<sessionId>.<toolUseId>.decision.json
 *     <epochMs>.<sessionId>.<toolUseId>.request.json          (under missed/)
 *
 * Splitting on `.` is safe past the second field because everything after it is opaque here —
 * a session id may contain dots and never needs to be read back out.
 *
 * **The same cost per file is not the same cost.** `missed/` only grows when something goes
 * wrong — twelve in a night of total absence is the figure this feature was argued from — while
 * `decided/` grows every time something goes *right*, once per approval, and `rescan()` reads
 * both on every workspace change. Fifty approvals a day is on the order of eighteen thousand
 * files in one directory in a year.
 *
 * That is not a reason to prune, and nothing here does: what may be deleted from a record of
 * decisions is its own argument, and the panel's only delete currently takes the whole store
 * (see `main.ts` on why the lint no longer recommends it). It is written down because "the same
 * cost as one `readdir`" is the sentence somebody will cite when they later ask whether this
 * needs bounding, and unqualified it would answer a question it never addressed.
 *
 * ## Undated is not zero, and not excluded either
 *
 * Records filed before the office dated them carry no time in their names. They cannot be put
 * inside a window and they cannot be ruled out of one, so they are neither: counted in the
 * total, reported separately, and never quietly folded into "nothing happened tonight".
 *
 * This is `Blind.extent` from `search.ts` in a second place — *"this searched only part of it"*
 * being a different answer from both *"it found nothing"* and *"it could not look"*.
 */

import type { PendingApproval } from './ipc.js'

/** What a person's answer was, when the office managed to read it. */
export type Outcome = 'allowed' | 'declined' | 'unreadable'

const OUTCOMES: readonly Outcome[] = ['allowed', 'declined', 'unreadable']

/**
 * The time in a filed record's name, or `null` when its name carries none.
 *
 * `null` is not an error and not a zero. It means this record was filed before the office wrote
 * times into names, which is a real state on any machine that ran an earlier version, and the
 * only honest thing to do with it is say how many there are.
 */
export function filedAt(name: string): number | null {
  const first = name.slice(0, name.indexOf('.'))
  if (first === '') return null
  // `Number` on a non-numeric leading field gives `NaN`, which is the undated case — an old name
  // begins with the session id. Guarded rather than trusted, because `Number('')` is 0 and a
  // record dated to the epoch would sort before every window and silently vanish from all of them.
  const ms = Number(first)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

/**
 * The outcome in a decision record's name, or `null` when the name is not one this office wrote.
 *
 * Anything unrecognised is `null` rather than a guess. A file somebody dropped in this directory
 * is not a decision a person made, and counting it as one would put a number on the screen that
 * no click produced.
 */
export function filedOutcome(name: string): Outcome | null {
  const parts = name.split('.')
  const found = parts[1]
  return OUTCOMES.find((o) => o === found) ?? null
}

/** What the office found, once. */
export interface Tally {
  readonly allowed: number
  readonly declined: number
  /** Answered, and the office could not read which way. */
  readonly unreadable: number
  /** Asked for, and nobody answered before the gate gave up. */
  readonly unanswered: number
  /**
   * Records outside the window, or old enough to carry no time at all.
   *
   * Split because they are different kinds of not-counted: `older` is a fact the window
   * deliberately excludes, `undated` is one it *cannot* place. Reporting them as one number would
   * make an office that had been running for months look the same as one whose records predate
   * the feature.
   */
  readonly older: number
  readonly undated: number
}

const NOTHING: Tally = { allowed: 0, declined: 0, unreadable: 0, unanswered: 0, older: 0, undated: 0 }

/** How many of these are decisions somebody actually made. */
export function decided(t: Tally): number {
  return t.allowed + t.declined + t.unreadable
}

/** Everything the window covers, whichever way it went. */
export function within(t: Tally): number {
  return decided(t) + t.unanswered
}

/**
 * Bucket the two directories' filenames into one account of a stretch of time.
 *
 * `since` is a moment, not a duration, so the caller owns "tonight" and this owns the counting.
 */
export function tally(
  decisions: readonly string[],
  missed: readonly string[],
  since: number,
): Tally {
  const t = { ...NOTHING }

  for (const name of decisions) {
    if (!name.endsWith('.decision.json')) continue
    const outcome = filedOutcome(name)
    // A name we do not recognise is not a decision. Skipped entirely rather than counted as
    // `undated`, which would claim somebody answered something.
    if (outcome === null) continue
    const at = filedAt(name)
    if (at === null) t.undated += 1
    else if (at < since) t.older += 1
    else t[outcome] += 1
  }

  for (const name of missed) {
    if (!name.endsWith('.request.json')) continue
    const at = filedAt(name)
    if (at === null) t.undated += 1
    else if (at < since) t.older += 1
    else t.unanswered += 1
  }

  return t
}

/**
 * What the office says about a stretch it can account for, or `null` when it has nothing to say.
 *
 * `null` when the window is empty **and** nothing sits outside it — a workspace where no approval
 * has ever been asked for should say nothing rather than report six zeroes. An empty window with
 * records outside it is different and does speak, because "none tonight" is only meaningful
 * beside the fact that there were some before.
 */
export function nightLede(t: Tally, hours: number): string | null {
  const span = hours === 1 ? 'the last hour' : `the last ${hours} hours`

  if (within(t) === 0) {
    if (t.older === 0 && t.undated === 0) return null
    return `No tool call has needed your approval in ${span}.${trailer(t)}`
  }

  const parts: string[] = []
  if (t.allowed > 0) parts.push(`${t.allowed} approved`)
  if (t.declined > 0) parts.push(`${t.declined} declined`)
  if (t.unreadable > 0) {
    parts.push(`${t.unreadable} answered and the office could not read which way`)
  }
  if (t.unanswered > 0) {
    parts.push(
      t.unanswered === 1
        ? '1 that nobody answered in time, so it was refused'
        : `${t.unanswered} that nobody answered in time, so those were refused`,
    )
  }

  return `In ${span}: ${list(parts)}.${trailer(t)}`
}

/**
 * The part of the record this sentence is not speaking for.
 *
 * Always said when there is any, and said as two separate facts. An office that reported only its
 * window would be accurate about the window and silent about the rest, which is how a count comes
 * to mean something other than what it says.
 */
function trailer(t: Tally): string {
  const said: string[] = []
  if (t.older > 0) said.push(`${t.older} older`)
  if (t.undated > 0) {
    said.push(
      t.undated === 1
        ? '1 the office cannot place in time'
        : `${t.undated} the office cannot place in time`,
    )
  }
  if (said.length === 0) return ''
  return ` The record also holds ${list(said)}.`
}

/** `a`, `a and b`, `a, b and c` — the office writes sentences, not arrays. */
function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * What to say when the office could not read one of the two directories.
 *
 * A separate sentence rather than a missing number, because the failure this whole module exists
 * to prevent is a count that reads as *nothing happened* when it means *we did not look*.
 * `filedIn` in `approvals.ts` draws this line and argues it; this is the same line said out loud,
 * with both directories behind it.
 */
export function couldNotLook(which: 'decisions' | 'missed' | 'both'): string {
  const what =
    which === 'both'
      ? 'what it approved or what went unanswered'
      : which === 'decisions'
        ? 'what it approved'
        : 'what went unanswered'
  return (
    `This office cannot tell ${what} — the record exists and will not open. ` +
    'Nothing in it has been changed.'
  )
}


// ─────────────────────────────────────────────────────── one record, read ──

/**
 * One decision the office carried, as its own record states it.
 *
 * The record is the request **verbatim** plus what came of it, so `summarise()` in
 * `approval-summary.ts` reads it unchanged — the same function that draws the live card draws the
 * remembered one. That is deliberate and it is the point: a second "what was this call going to
 * do" would drift from the first, and the two would eventually disagree about the same command
 * on two surfaces in the same app.
 */
export interface Decision {
  /** The filename without `.decision.json` — unique, and what a focus is addressed by. */
  readonly id: string
  /** From the name. `null` for a record filed before the office dated them. */
  readonly at: number | null
  readonly outcome: Outcome
  /**
   * The request as the gate wrote it, for `summarise()`.
   *
   * Typed as the live card's own shape rather than a copy of it, so a field added to one is a
   * field the other has to account for instead of silently lacking.
   */
  readonly request: PendingApproval
  /** The office's own words, on a decline. `null` when there were none or it was not one. */
  readonly reason: string | null
  readonly decidedAt: string | null
}

/**
 * A record in `decided/` that could not be read.
 *
 * **Not the same as `Outcome`'s `'unreadable'`, and they are one letter apart.** That one is a
 * decision the office carried and could not read the *verdict* for — somebody answered, the
 * office lost which way, and the record says so. This one is a *file* the panel could not read
 * at all, or read and could not recognise.
 *
 * Renaming either was considered and neither can move: `'unreadable'` is written into filenames
 * on disk, so changing it orphans every record already filed; and `unread`/`UnreadDecision` is
 * `memory.ts`'s own naming for exactly this, which is the pattern this module was told not to
 * diverge from. So they stay close and the difference is stated here instead — the on-screen
 * wording keeps them apart, which is where it matters.
 *
 * Named one by one rather than counted, which is `memory.ts`'s decision and its reason holds
 * exactly: a file that will not open may be the very record somebody is looking for, and a count
 * cannot be searched for later.
 */
export interface UnreadDecision {
  readonly id: string
  readonly cause: string
}

export interface DecisionReport {
  readonly decisions: readonly Decision[]
  readonly unread: readonly UnreadDecision[]
  /**
   * Why the directory itself could not be listed, or `null`.
   *
   * Separate from an empty `decisions`, for the reason the whole feature exists: an office that
   * has approved nothing and one whose record will not open are different facts, and only the
   * first is good news.
   */
  readonly problem: string | null
  /**
   * Records on disk the reader did not open, because the panel shows the newest.
   *
   * A window that states its own edges is not a truncation, and this is the field that lets it
   * say so. Without it the panel would draw the newest two hundred and read as the whole record —
   * quiet wrongness of exactly the kind the record exists to remove.
   */
  readonly beyond: number
}

/**
 * One record, parsed, or `null` when the file is not one of ours.
 *
 * `null` rather than a partial record with holes. A file somebody dropped in this directory is
 * not a decision anybody made, and drawing it as one with blank fields would put a card on screen
 * for a click that never happened — the same argument `tally` makes for skipping unrecognised
 * names instead of counting them as `undated`.
 */
export function parseDecision(name: string, text: string): Decision | null {
  const outcome = filedOutcome(name)
  if (outcome === null) return null

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // Unparseable is *unread*, and the caller files it there. Returning a shell of a record would
    // claim the office knows what was decided when what it has is a broken file.
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null

  const r = raw as Record<string, unknown>
  const str = (k: string): string | null => (typeof r[k] === 'string' && r[k] !== '' ? (r[k] as string) : null)

  return {
    id: name.replace(/\.decision\.json$/, ''),
    at: filedAt(name),
    outcome,
    request: {
      sessionId: str('sessionId') ?? '',
      // A decision already made. The card that reads this is historical, and the record carries
      // no project — attributing one here would be inventing it. `null` is the honest answer and
      // the type's own meaning for "the office cannot say".
      project: null,
      toolUseId: str('toolUseId') ?? '',
      // The tool is the one field a card cannot do without, and a record missing it is still a
      // record — `summarise` renders the name it is given, so an honest placeholder beats a drop.
      tool: str('tool') ?? 'unknown',
      input: typeof r['input'] === 'object' && r['input'] !== null ? (r['input'] as Record<string, unknown>) : {},
      askedAt: str('askedAt') ?? '',
      // Meaningless on a decision already made — the clock it fed has stopped. Carried as `null`
      // rather than as the number the gate wrote, so nothing can draw a countdown from a record.
      waitMs: null,
      // `agentId` is in the record and not in this shape. Dropped rather than added to
      // `PendingApproval`, which is the live card's contract — a field the card has no use for
      // would be one more thing two surfaces could come to disagree about.
      agent: str('agent'),
    },
    reason: str('reason'),
    decidedAt: str('decidedAt'),
  }
}

/**
 * What the panel says above the list.
 *
 * Three states, and they are not interchangeable: nothing recorded, some could not be read, and
 * the record could not be looked at. `memoryLede` settled this wording for the same three cases
 * and this follows it deliberately rather than inventing a fourth phrasing for the same idea.
 */
export function decisionsLede(report: DecisionReport): string {
  if (report.problem !== null) {
    return `The office cannot tell you what it approved — ${report.problem}`
  }

  const n = report.decisions.length
  const kept =
    n === 0 ? 'Nothing decided yet' : n === 1 ? '1 decision recorded' : `${n} decisions recorded`

  /*
   * The edge of the window, said whenever there is one.
   *
   * Appended to whichever sentence follows rather than replacing it, because "and 400 older" is a
   * fact *about* the count above it — a reader who is told only the older number learns nothing
   * about what they are looking at, and one told only the shown number is looking at a partial
   * record that does not say so.
   */
  const edge =
    report.beyond === 0
      ? ''
      : report.beyond === 1
        ? ' \u00b7 1 older is not shown'
        : ` \u00b7 ${report.beyond} older are not shown`

  if (report.unread.length === 0) return kept + edge

  const bad = report.unread.length
  const more = bad === 1 ? '1 more exists and could not be read' : `${bad} more exist and could not be read`

  // "Nothing readable recorded · N more" rather than "Nothing recorded · N more", because more
  // than nothing is a contradiction. `memoryLede` shipped that contradiction and had it caught in
  // the running app; there is no reason to rediscover it here.
  if (n === 0) return `Nothing readable recorded \u00b7 ${more}${edge}`
  return `${kept} \u00b7 ${more}${edge}`
}
