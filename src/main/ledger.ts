/**
 * The dispatch ledger — what the office asked for, and whether it ever heard back.
 *
 * A dispatch is the one thing this app does that outlives the turn that started it. The manager
 * calls `Task`, the CLI launches an agent in the background, and the answer arrives minutes
 * later as a `task_notification`. Everything in between lived in memory only: `shared/activity.ts`
 * kept an `inFlight` map, and when a turn ended with entries still in it, `settle()` wrote *"the
 * turn ended before they reported back"* into the log and that was the end of it.
 *
 * That is a true sentence and a useless one. It happened twice for real during one long build —
 * the app died mid-dispatch, and on restart the office had no idea anything had been asked for,
 * let alone what. Nothing offered to resume, retry, or re-attach; the work was simply gone, and
 * the only record of what had been asked was in a transcript nobody was going to read.
 *
 * So: every dispatch is written down *before* it can be lost, and its ending is written down
 * when it arrives. What is on disk with no ending is **unfinished work**, and unfinished work is
 * something the office can offer you back.
 *
 * ## Why it is a log and not a table
 *
 * A dispatch and its outcome are two events minutes apart, and the second one may never happen.
 * Appending the outcome as its own line rather than mutating the dispatch row means the file is
 * only ever added to — so the record of *what was asked* cannot be damaged by whatever happens
 * to the record of *what came back*. Reading it is a fold; nothing is ever edited in place.
 *
 * ## Why every append still rewrites the whole file
 *
 * `registry.ts` writes a temp file and renames it over the old one, because a half-written
 * registry loses conversations that still exist on disk. The stakes here are the same and so is
 * the mechanism: read, append, write to a temp file, rename. `rename(2)` is atomic, so a
 * crash leaves either the whole old file or the whole new one and **never a torn line of our own
 * making**. That is not free — it is O(n) bytes per dispatch — but the file this buys safety for
 * grows by two lines per dispatched task, and the crash it is defending against is the exact
 * event the whole module exists for. If it ever grows past what is sensible to rewrite, the
 * answer is to roll the file over, not to append in place and hope.
 *
 * ## And every append waits for the one before it
 *
 * The mechanism above is safe against a *crash* and was not safe against a *second append*. The
 * temp file was `<path>.<pid>.tmp` — one name for every call in the process — and this is a
 * read-modify-write, so two overlapping appends both read the same `existing`, both wrote it plus
 * their own line to the same scratch file, and both renamed it.
 *
 * Measured, twenty at once: **nineteen refused with `ENOENT … rename`, one landed, and the file
 * came back with a torn line** — the exact outcome the paragraph above promises cannot happen. It
 * could not happen from a crash. It happened from an office dispatching more than one employee,
 * which is the ordinary way this file is used.
 *
 * `serial()` closes both faults at once, because one append in flight at a time has neither an
 * overlap nor a stale read. The counter on the temp name below is belt and braces and **is not
 * exercised by any test**, which is worth saying rather than implying otherwise: with the queue
 * in place nothing can produce two appends at once, so removing it breaks nothing that runs. It
 * is kept for a caller that reaches `appendOne` around the queue. In `registry.ts` the same
 * counter *is* load-bearing — `saveRegistry` is exported and called directly, and a test fails
 * without it.
 *
 * One thing follows from that and is not optional: **a ledger that cannot be read is never
 * written**. Rewriting a file we could not parse would replace a record we do not understand
 * with one we invented, which is how the registry's ordering bug deleted a week of
 * conversations. `append` refuses instead, and says why.
 *
 * ## Absent is not empty, on every line
 *
 * A line that will not parse is **reported**, never skipped. Nothing this file writes can leave
 * one — that is what the rename is for — but the ledger is plain text inside the user's own
 * workspace: an editor, a disk fault, a stray `>>` from a script, or a build that appends in
 * place can all leave a line we cannot read. Dropping it would turn *"we cannot read this
 * dispatch"* into *"that dispatch never happened"*, and then the office would confidently offer
 * you nothing to resume. That is standing order 4, and it is the whole reason this file counts
 * its failures instead of filtering them out.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ClaudeEvent } from './claude/stream.js'
import { isDelegationTool } from '../shared/delegation.js'
import { STATE_DIR } from './registry.js'
import { serial } from './serial.js'

/** Beside `sessions.json`, under the same gitignored state directory. */
const LEDGER_FILE = 'dispatches.jsonl'

/**
 * How much of a torn line to keep for the report.
 *
 * Enough to recognise which dispatch it was, short enough that a file corrupted into one
 * enormous line does not become the whole error message.
 */
const TORN_EXCERPT = 200

/** One dispatch, written down before the answer can be lost. */
export interface Dispatch {
  /** The `tool_use` id. The only thing that ties a dispatch to the result that arrives later. */
  readonly id: string
  /** Which conversation sent it, so resuming re-opens the right one. */
  readonly sessionId: string
  /** Which project's work this is. The empty string is the office itself, as in the registry. */
  readonly project: string
  /** Who was asked. The `subagent_type` from the call, not a guess. */
  readonly employee: string
  /** What they were asked for, as the manager wrote it. */
  readonly brief: string
  /** The VERIFY condition carried in the brief, or `null` when it carried none. */
  readonly verify: string | null
  readonly sentAt: string
}

/**
 * How a dispatch ended.
 *
 * `reported` and `failed` come from the CLI's own `status`, which is reported rather than
 * interpreted — see `stream.ts`. `dropped` is the only one a person can cause: it means somebody
 * looked at an unfinished dispatch and said nobody is waiting for it any more. It is recorded
 * rather than deleted, because *"we abandoned this"* and *"this never happened"* are different
 * facts and only one of them is true.
 */
export type OutcomeKind = 'reported' | 'failed' | 'dropped'

export interface Outcome {
  /** The dispatch this settles. Same `tool_use` id. */
  readonly id: string
  readonly kind: OutcomeKind
  /** What came back, verbatim. A retry carries this forward rather than paraphrasing it. */
  readonly output: string
  /**
   * When it settled.
   *
   * No reader in the app, and it is not meant to have one: the unfinished cards are about
   * dispatches with *no* outcome, so this never reaches a card. It is here for the person who
   * opens the ledger file — which is a record before it is a data source, and a record with no
   * times in it is most of the way to useless.
   */
  readonly at: string
}

/** A line we could not read. Kept, counted, and shown — never quietly skipped. */
export interface TornLine {
  /** 1-based, so it can be quoted at somebody looking at the file. */
  readonly at: number
  /** The line as it stands, cut to {@link TORN_EXCERPT}. */
  readonly text: string
  readonly cause: string
}

export interface Ledger {
  readonly sent: readonly Dispatch[]
  readonly outcomes: readonly Outcome[]
  readonly torn: readonly TornLine[]
}

export const EMPTY_LEDGER: Ledger = { sent: [], outcomes: [], torn: [] }

/** How the ledger file was read. The three states never collapse into one — see `registry.ts`. */
export type LedgerState =
  | { readonly state: 'ok'; readonly ledger: Ledger }
  /** No file yet. A workspace that has never dispatched anything genuinely has no ledger. */
  | { readonly state: 'missing' }
  /** The file is there and could not be used. **Not** a workspace with nothing outstanding. */
  | { readonly state: 'unreadable'; readonly cause: string }

/** A write either happened or it did not, and the reason is words rather than an exception. */
export type Written = { readonly ok: true } | { readonly ok: false; readonly reason: string }

// ─────────────────────────────────────────────────────────────────────── pure ──

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Pull the VERIFY condition out of a brief.
 *
 * Standing order 2 says every dispatched task carries one, and the office's convention is to
 * write it into the brief as a line beginning `VERIFY`. There is no field on the `Task` tool for
 * it, so this reads what is actually there rather than inventing a place for it to live.
 *
 * `null` when the brief carried none, which is a real state and is shown as one: a re-dispatch
 * that made up a VERIFY would be worse than one that admits the original had no check.
 */
export function verifyFrom(brief: string): string | null {
  for (const raw of brief.split('\n')) {
    // Leading `#`, `*`, `-` and spaces, so a heading or a bullet still counts. The marker has to
    // start the line: a sentence that merely mentions verifying is prose, not a condition.
    const line = raw.replace(/^[\s#*_>-]+/, '')
    // The separators a person actually writes between the word and the condition: a colon, a
    // dash, an em dash, or the `**` closing a bold marker. Trying to be exact here would mean a
    // brief formatted slightly differently silently losing its check.
    const match = /^VERIFY\b[:\s*_\u2013\u2014-]*(.*)$/i.exec(line)
    if (match) {
      const rest = match[1]?.trim() ?? ''
      if (rest.length > 0) return rest
    }
  }
  return null
}

function asDispatch(row: Record<string, unknown>): Dispatch | null {
  const id = asString(row['id'])
  if (!id) return null
  return {
    id,
    sessionId: typeof row['sessionId'] === 'string' ? row['sessionId'] : '',
    project: typeof row['project'] === 'string' ? row['project'] : '',
    employee: typeof row['employee'] === 'string' ? row['employee'] : '',
    brief: typeof row['brief'] === 'string' ? row['brief'] : '',
    verify: typeof row['verify'] === 'string' ? row['verify'] : null,
    sentAt: typeof row['sentAt'] === 'string' ? row['sentAt'] : '',
  }
}

function asOutcome(row: Record<string, unknown>): Outcome | null {
  const id = asString(row['id'])
  if (!id) return null
  const kind = row['kind']
  return {
    id,
    // Anything we do not recognise reads as `failed` rather than as a success. A row from a
    // future build naming an outcome we cannot interpret must not be shown as work that landed.
    kind: kind === 'reported' || kind === 'dropped' ? kind : 'failed',
    output: typeof row['output'] === 'string' ? row['output'] : '',
    at: typeof row['at'] === 'string' ? row['at'] : '',
  }
}

/**
 * Read the ledger's text. Never throws — a line that fails becomes a {@link TornLine}.
 *
 * Every line is one of three things: a dispatch, an outcome, or something we could not read.
 * There is deliberately no fourth bucket for "a line with a `line` field naming a kind we do not
 * know": that is a row from a newer build, we cannot say what it means, and pretending we can is
 * the failure this whole module is about. It is torn, and it is reported.
 */
export function parseLedger(text: string): Ledger {
  const sent: Dispatch[] = []
  const outcomes: Outcome[] = []
  const torn: TornLine[] = []

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    // A trailing newline is not a torn line; it is how a text file ends.
    if (line.trim() === '') continue

    const tear = (cause: string) =>
      torn.push({ at: i + 1, text: line.slice(0, TORN_EXCERPT), cause })

    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch (err) {
      tear(err instanceof Error ? err.message : String(err))
      continue
    }

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      tear('not an object')
      continue
    }

    const row = raw as Record<string, unknown>
    if (row['line'] === 'sent') {
      const dispatch = asDispatch(row)
      if (dispatch) sent.push(dispatch)
      else tear('a dispatch with no id — there is nothing to tie a result to')
      continue
    }
    if (row['line'] === 'outcome') {
      const outcome = asOutcome(row)
      if (outcome) outcomes.push(outcome)
      else tear('an outcome with no id — there is nothing it can settle')
      continue
    }

    tear(`unknown line kind: ${JSON.stringify(row['line'] ?? null)}`)
  }

  return { sent, outcomes, torn }
}

export function serializeDispatch(dispatch: Dispatch): string {
  return `${JSON.stringify({ line: 'sent', ...dispatch })}\n`
}

export function serializeOutcome(outcome: Outcome): string {
  return `${JSON.stringify({ line: 'outcome', ...outcome })}\n`
}

/**
 * Dispatches that were sent and never ended, oldest first.
 *
 * The definition is exactly "no outcome line names this id", and it is deliberately not "no
 * outcome and it looks stale". A dispatch that is still running right now is unfinished too —
 * the difference between *still going* and *lost when the app died* is a question about the
 * clock, which the caller answers with the watchdog in `shared/activity.ts`, not a question this
 * function can answer from the file.
 *
 * A duplicate id keeps the **first** record. Two dispatches cannot share a `tool_use` id, so a
 * second one is a file that has been edited or concatenated; keeping the earlier is the reading
 * that cannot invent a brief nobody sent.
 */
export function unfinished(ledger: Ledger): readonly Dispatch[] {
  const settled = new Set(ledger.outcomes.map((o) => o.id))
  const seen = new Set<string>()
  const open: Dispatch[] = []
  for (const dispatch of ledger.sent) {
    if (settled.has(dispatch.id) || seen.has(dispatch.id)) continue
    seen.add(dispatch.id)
    open.push(dispatch)
  }
  return open
}

/**
 * The brief to send when re-dispatching something that did not come back.
 *
 * **The failure output goes in verbatim.** That is the whole point: before this, retrying meant a
 * person scrolling back through a transcript, finding the error, and pasting it into a new
 * prompt by hand — and the usual result was a re-dispatch that repeated the original instruction
 * with no mention of how it had already failed, so the agent walked into the same wall. Nothing
 * here summarises, trims or reformats what came back; a paraphrased stack trace is not a stack
 * trace.
 *
 * Composes and returns. It sends nothing, which keeps the decision to re-dispatch with whoever
 * is holding the card.
 */
export function retryBrief(entry: Dispatch, failureOutput: string): string {
  const parts = [
    entry.brief,
    '',
    '---',
    '',
    `This is a re-dispatch. The first attempt (${entry.id}, sent ${entry.sentAt}) did not come back.`,
    '',
    'What came back last time, verbatim:',
    '',
    failureOutput,
  ]

  // Only when the original carried one. Writing a VERIFY the first brief never had would be this
  // function inventing the check the second standing order exists to make real.
  if (entry.verify) {
    parts.push('', `The VERIFY condition has not changed: ${entry.verify}`)
  }

  return parts.join('\n')
}

// ────────────────────────────────────────────────────────────── from the stream ──

/** Who sent it, which the event itself does not say. */
export interface Sender {
  readonly sessionId: string
  readonly project: string
}

/**
 * The dispatches in one event.
 *
 * The same reading `choreography.ts` does for the floor, and deliberately the same helpers:
 * `isDelegationTool` rather than a second hard-coded `'Task'`, because a rename that broke one
 * and not the other would leave the floor moving while the ledger recorded nothing.
 *
 * `prompt` is preferred over `description` for the brief. The floor shows `description` because
 * it needs one line for a speech bubble; a re-dispatch needs the whole instruction, and sending
 * back only the summary line would be handing somebody a task with its body removed.
 */
export function dispatchesIn(event: ClaudeEvent, from: Sender, at: string): Dispatch[] {
  if (event.kind !== 'assistant') return []

  const found: Dispatch[] = []
  for (const block of event.blocks) {
    if (block.type !== 'tool_use' || !block.name || !block.id) continue
    if (!isDelegationTool(block.name)) continue

    const employee = asString(block.input?.['subagent_type'])
    if (!employee) continue

    const brief = asString(block.input?.['prompt']) ?? asString(block.input?.['description']) ?? ''
    found.push({
      id: block.id,
      sessionId: from.sessionId,
      project: from.project,
      employee,
      brief,
      verify: verifyFrom(brief),
      sentAt: at,
    })
  }
  return found
}

/**
 * The ending in one event, if it carries one.
 *
 * Only `task-finished`, which is the **real** completion. A dispatch's own `tool_result` arrives
 * within milliseconds saying the agent was launched — see `delegation.ts` — and writing an
 * outcome for that receipt would mark every dispatch settled the instant it was sent, which is
 * precisely the crash this module is meant to survive.
 *
 * `status` is the CLI's word, not ours. Anything other than `completed` is recorded as `failed`
 * rather than being read charitably: a task that stopped for a reason we do not model is not a
 * task that reported back.
 */
export function outcomeIn(event: ClaudeEvent, at: string): Outcome | null {
  if (event.kind !== 'task-finished') return null
  return {
    id: event.toolUseId,
    kind: event.status === 'completed' ? 'reported' : 'failed',
    output: event.summary ?? `the task ended with status "${event.status}" and said nothing`,
    at,
  }
}

// ───────────────────────────────────────────────────────────────────────── io ──

export function ledgerPath(root: string): string {
  return join(root, STATE_DIR, LEDGER_FILE)
}

/** Read the ledger. Never throws; the failure is the return value. */
export async function loadLedger(root: string): Promise<LedgerState> {
  const path = ledgerPath(root)

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
    return { state: 'unreadable', cause: (err as Error).message }
  }

  return { state: 'ok', ledger: parseLedger(text) }
}

/**
 * Appends are serialised, and the counter is the other half.
 *
 * This is a read-modify-write. Two overlapping calls both read the same `existing` and both wrote
 * it plus their own line, so one line was lost even before the shared temp name made them collide
 * outright. The queue removes the overlap; the counter means a queue that is ever bypassed still
 * cannot have two writers on one scratch file.
 */
let appendSeq = 0
const appends = serial()

/**
 * Add one line, atomically.
 *
 * Read, append, temp file, rename — see the note at the top for why the whole file is rewritten
 * rather than opened for append. **A ledger that could not be read is not written to**: replacing
 * a file whose bytes we never saw with one we composed from what happens to be in memory is how
 * the session registry once deleted a week of conversations, and this is the same file shape
 * with the same stakes. A read failure is a refusal, not a fresh start.
 *
 * A file that *reads* but holds a line we cannot parse is a different case and is appended to
 * quite happily: the existing text is carried across byte for byte, so a line we do not
 * understand survives us untouched and is still reported to whoever reads the ledger next.
 */
function append(root: string, line: string): Promise<Written> {
  return appends(() => appendOne(root, line))
}

async function appendOne(root: string, line: string): Promise<Written> {
  const path = ledgerPath(root)

  let existing: string
  try {
    existing = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return {
        ok: false,
        reason:
          `the dispatch ledger at ${path} could not be read (${(err as Error).message}), so it ` +
          'was not written to — rewriting it would replace a record of outstanding work with ' +
          'whatever happens to be in memory',
      }
    }
    // Genuinely no file yet. A workspace that has never dispatched anything starts one here.
    existing = ''
  }

  try {
    await mkdir(dirname(path), { recursive: true })
    // A file whose last line has no newline would otherwise gain a torn line of our own making.
    const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
    const temp = `${path}.${process.pid}.${++appendSeq}.tmp`
    await writeFile(temp, `${existing}${separator}${line}`, 'utf8')
    await rename(temp, path)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}

/** Write down a dispatch. Called before anything can come back, which is the entire point. */
export function recordDispatch(root: string, dispatch: Dispatch): Promise<Written> {
  return append(root, serializeDispatch(dispatch))
}

/** Write down an ending. A dispatch with one of these is finished and offers nothing. */
export function recordOutcome(root: string, outcome: Outcome): Promise<Written> {
  return append(root, serializeOutcome(outcome))
}

/**
 * Fold one stream event into the ledger.
 *
 * The single call the composition root makes. Everything it needs to know about which events
 * matter lives here rather than in `main.ts`, so the ledger can be changed without touching the
 * file three streams are editing at once.
 *
 * Failures are returned, never thrown. A ledger write that fails must not take down the run it
 * is describing — but it must not be invisible either, so the caller gets the reason and says so
 * where somebody will see it.
 */
export async function record(
  root: string,
  from: Sender,
  event: ClaudeEvent,
  at = new Date().toISOString(),
): Promise<readonly Written[]> {
  const written: Written[] = []

  for (const dispatch of dispatchesIn(event, from, at)) {
    written.push(await recordDispatch(root, dispatch))
  }

  const outcome = outcomeIn(event, at)
  if (outcome) written.push(await recordOutcome(root, outcome))

  return written
}
