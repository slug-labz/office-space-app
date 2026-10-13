/**
 * The session registry — what the office was doing when you closed it.
 *
 * A session id is generated before the first message is sent, which is what lets a project own
 * its conversation rather than discover it afterwards. That id lived in memory only, so closing
 * the window threw away the one thing needed to pick the conversation back up. This is where it
 * is written down.
 *
 * Two rules shape the whole file.
 *
 * **Absent is not empty.** A registry that could not be read is not a workspace with no history.
 * Reading returns three distinguishable states, and the caller is told which — a fresh clone
 * has genuinely never had a session, and that is a different fact from "the file is there and
 * we could not parse it". Collapsing them would quietly offer someone a blank slate over the
 * top of a week's work.
 *
 * **Match the atomicity to the stakes.** This file is the only record of what to resume, so it
 * is written to a temporary file and renamed over the old one. A half-written registry is worse
 * than no registry, because it loses history that still exists on disk and cannot be found
 * again without it.
 *
 * What is *not* here, deliberately: anything about sessions Office Space did not create. The
 * transcripts of every Claude Code session on the machine sit in the same place, and the office
 * has no business reading them. The registry only ever names its own.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { LEGACY_MODE, isMode, type Mode } from '../shared/session/mode.js'
import { newestFirst } from '../shared/time-order.js'
import type { Problem } from './workspace.js'

/** Where runtime state lives, inside the workspace and gitignored. */
export const STATE_DIR = '.office-space'
const REGISTRY_FILE = 'sessions.json'

/** Bumped only if the shape changes in a way an older file cannot be read as. */
const VERSION = 1

export interface SessionRecord {
  /** The id passed to `--session-id`, and later to `--resume`. */
  readonly id: string
  /**
   * Which project this conversation belongs to. The empty string is the office itself.
   *
   * A registry written before projects existed has no such field, and those rows read as the
   * office — which is what they were.
   */
  readonly project: string
  /** Working directory the session was started in. Scopes it to a project. */
  readonly cwd: string
  /** Which agent answers. The manager, by definition. */
  readonly agent: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly costUsd: number | null
  /** The first thing you said, trimmed. What the session is *called*, in practice. */
  readonly title: string | null
  /**
   * Which mode this conversation is in, so resuming does not silently change what it may do.
   *
   * A row written before modes existed has none, and reads as `building` — not `intake`. That
   * session could already dispatch and edit, and resuming it into a mode that takes tools away
   * would be the app changing something nobody asked it to change. Absent is a specific past
   * here, not a gap.
   */
  readonly mode: Mode
  /**
   * Whether Claude has confirmed this session exists.
   *
   * False until an `init` event arrives. An id we generated but never got confirmed names no
   * conversation on disk, and offering to resume it would produce an error rather than a
   * conversation — so only an opened session is ever resumable.
   */
  readonly opened: boolean
  /**
   * Hidden from the list, and nothing else.
   *
   * **The transcript is Claude Code's, not ours** — it lives under `~/.claude/projects/` and it
   * is the record of what somebody actually said. Deleting it because they tidied a list is not
   * a trade this app gets to make on their behalf, so closing writes one boolean here and
   * touches nothing on disk that we did not create.
   *
   * Absent reads as open, which is the only safe direction: a registry written before this
   * existed described sessions nobody had closed.
   */
  readonly closed?: boolean
}

/** How the registry file was read. The three states never collapse into one. */
export type RegistryState =
  | {
      readonly state: 'ok'
      readonly sessions: readonly SessionRecord[]
      /**
       * Rows `parseRegistry` could not use.
       *
       * Carried rather than discarded, for the reason its own comment gives: the count exists so
       * a shortfall can be *"reported rather than assumed away"*. It was computed and dropped one
       * line later, so a malformed row was a conversation nothing searched, nothing listed and
       * nothing counted.
       */
      readonly skipped: number
      /**
       * Those rows themselves, as the JSON they were, in file order.
       *
       * Carried so `saveRegistry` can put them back. It writes the whole file, and while it wrote
       * only `sessions`, one save deleted every row this version could not read.
       */
      readonly unread: readonly unknown[]
    }
  /** No file yet. A fresh workspace genuinely has no history. */
  | { readonly state: 'missing' }
  /** The file is there and could not be used. **Not** an empty history. */
  | { readonly state: 'unreadable'; readonly cause: string }

// ─────────────────────────────────────────────────────────────────────── pure ──

function isRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return typeof r['id'] === 'string' && r['id'].length > 0 && typeof r['cwd'] === 'string'
}

/**
 * Read the registry's text.
 *
 * A file that parses but holds entries we cannot understand keeps the entries we can. Losing
 * every session because one row was written by a newer build would be a worse failure than
 * skipping that row — but the skipping is counted, so it can be reported rather than assumed
 * away. The skipped rows are returned as well, so a save can write them back.
 */
export function parseRegistry(
  text: string,
):
  | { readonly sessions: SessionRecord[]; readonly skipped: number; readonly unread: unknown[] }
  | { readonly error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  if (typeof raw !== 'object' || raw === null) return { error: 'registry is not an object' }
  const entries = (raw as Record<string, unknown>)['sessions']
  if (!Array.isArray(entries)) return { error: 'registry has no "sessions" array' }

  const sessions = entries.filter(isRecord).map((r) => ({
    id: r.id,
    project: typeof r.project === 'string' ? r.project : '',
    cwd: r.cwd,
    agent: typeof r.agent === 'string' ? r.agent : 'manager',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
    costUsd: typeof r.costUsd === 'number' ? r.costUsd : null,
    title: typeof r.title === 'string' ? r.title : null,
    // Anything that is not a mode we recognise — a row from a future version, a hand edit —
    // reads as the legacy mode rather than falling through to something permissive.
    mode: isMode(r.mode) ? r.mode : LEGACY_MODE,
    opened: r.opened === true,
    // Only `true` closes. Absent, `false`, or whatever a hand edit left — `"false"` included —
    // reads as open, the direction `closed` itself calls safe. Left off rather than written as
    // `false`, so a record nobody closed reads back exactly as it was written.
    //
    // This line was missing for as long as `closed` existed. Closing wrote the flag and the next
    // read dropped it, so a restart would put a closed conversation back in the list and the save
    // after it would take the flag off the disk. Measured against these functions in the registry
    // tests; nobody has watched it happen in the running app.
    ...(r.closed === true ? { closed: true } : {}),
  }))

  const unread = entries.filter((entry) => !isRecord(entry))
  return { sessions, skipped: unread.length, unread }
}

/** `unread` goes after the rows being written, as it was read. See `saveRegistry`. */
export function serializeRegistry(
  sessions: readonly SessionRecord[],
  unread: readonly unknown[] = [],
): string {
  return `${JSON.stringify({ version: VERSION, sessions: [...sessions, ...unread] }, null, 2)}\n`
}

/** Insert or replace a session, newest last. Pure, so the ordering rule is testable. */
export function upsert(
  sessions: readonly SessionRecord[],
  record: SessionRecord,
): SessionRecord[] {
  return [...sessions.filter((s) => s.id !== record.id), record]
}

/**
 * Merge a copy held in memory over one read from disk, per record, newest wins.
 *
 * `upsert` on its own is the wrong tool for two windows on one workspace. A second office starts
 * by reading the registry, so its memory holds **the first office's records as they were at that
 * moment** — and writing all of its records back puts those stale copies over whatever the first
 * office has written since.
 *
 * Measured with two real instances: both had a conversation, both answered, and both showed
 * `$0.0488` on screen. On disk one of them had `costUsd: null`, because the other office had
 * saved its startup snapshot of that record over the newer one. The screen was right and the
 * durable record was wrong, which is the direction that matters.
 *
 * `updatedAt` decides it. An ISO timestamp compares lexicographically, and a record nobody in
 * this process has touched keeps whatever the office that *did* touch it wrote. This is what
 * "last-writer-wins by design" was reaching for: last writer **per conversation**, rather than
 * whichever office happened to save last winning the whole file.
 *
 * **A close on disk survives a tie.** Closing is the one write that leaves `updatedAt` alone: the
 * close handler in `main.ts` sets `closed` on the record it found and changes nothing else. So a
 * second office that read the registry before the close holds the same record, open, at the same
 * time, and while a tie went wholly to the office doing the saving, that office's next save put
 * the conversation back in the list. Found in review of #240; measured against this function.
 *
 * The close does not stamp `updatedAt` instead, because a close is not activity. `search.ts` reads
 * the most recent conversations by that field, closed ones included, and the restore notice prints
 * it as the moment you left off. And the close is kept *only* on a tie: nothing un-closes a record
 * on purpose, so a closed conversation opened again comes back through `remember`, as a newer
 * record with no `closed`, and that has to keep winning whichever office holds it.
 */
export function mergeNewest(
  onDisk: readonly SessionRecord[],
  inMemory: readonly SessionRecord[],
): SessionRecord[] {
  let merged = [...onDisk]
  for (const ours of inMemory) {
    const theirs = merged.find((s) => s.id === ours.id)
    // Absent on disk: ours is the only copy. Equal timestamps: ours, because a write we are in
    // the middle of is the more likely reason for a tie than a foreign write in the same
    // millisecond.
    if (theirs && theirs.updatedAt > ours.updatedAt) continue
    // Except the close. An equal time is exactly what another office's close of a record we both
    // last saw looks like from here, so the flag is kept and the rest is still ours.
    const closedThere = theirs?.closed === true && theirs.updatedAt === ours.updatedAt
    merged = upsert(merged, closedThere ? { ...ours, closed: true } : ours)
  }
  return merged
}

/**
 * The session to offer when the office opens.
 *
 * The most recently touched **opened** session for this working directory. Unopened ids name
 * no conversation, and another project's session belongs to another floor.
 *
 * A closed one is skipped for a third reason: the app reopens what it offers, and reopening the
 * conversation somebody just closed is the app arguing with them.
 */
export function resumable(sessions: readonly SessionRecord[], cwd: string): SessionRecord | null {
  const mine = sessions.filter((s) => s.opened && s.closed !== true && s.cwd === cwd)
  if (mine.length === 0) return null
  return mine.reduce((best, s) => (s.updatedAt > best.updatedAt ? s : best))
}

/**
 * Which project a session belongs to, or `null` when the registry has not recorded it.
 *
 * The gate writes a session id and nothing else — `ApprovalRequest` carries no project — so a
 * held tool call can only be attributed here, against the registry the whole workspace shares.
 *
 * The renderer used to reconstruct this from a map it fills while opening projects, and that map
 * only ever holds the office you are looking at: `watchSessions` returns early on
 * `list.project !== active`. A call held in an office nobody had opened was therefore attributed
 * to nothing, which is exactly the office a campus exists to point at.
 *
 * `null` rather than a fallback. A session started by a plain `claude` in this workspace is one
 * the office genuinely cannot place, and answering with the open project would put somebody
 * else's held call on your card.
 *
 * **Unopened rows count.** `resumable` and `sessionsFor` either side of this both filter on
 * `opened`, and this deliberately does not: they answer *"which conversation can I reopen"*,
 * where an unopened id names nothing on disk and offering it would offer an error. This answers
 * *"whose office is this call blocking"*, and a call held in a session nobody has opened is
 * still held in a project. Filtering here would draw no mark for it.
 *
 * Called from `pendingFrom` in `approvals.ts` rather than from `main.ts`. Extracting this lookup
 * alone was not enough — the call site stayed in a file the suite cannot reach, and
 * `projectOfSession(...) ?? ''` passed 2583 tests green — so the whole mapping moved.
 *
 * That narrowed the gap rather than closing it: `main.ts` still chooses *which* sessions reach
 * `pendingFrom`, and a filter added there is as invisible as the one this paragraph warns
 * against was inside here.
 */
export function projectOfSession(
  sessions: readonly SessionRecord[],
  id: string,
): string | null {
  return sessions.find((s) => s.id === id)?.project ?? null
}

/**
 * Every conversation a project has had, newest first.
 *
 * The vision's framing is that a project is not a session but *a group* of them, and this is
 * the group. Unopened ids are left out for the same reason `resumable` leaves them out: they
 * name no conversation on disk, so offering one would offer an error.
 *
 * Newest by instant, not by text. A conversation whose time will not parse goes last: under
 * `localeCompare`, `'not a date'` sorted above every real time. `shownSessions` keeps this order
 * after any unrecorded live conversation, and `rowFor` takes the first entry that has a time, so the
 * head of this list is what a project's last-active line shows. See `time-order.ts`.
 *
 * `held` is what this process still holds, and a close does not hide those; `shownSessions` says
 * why. Left out, nothing is held.
 */
export function sessionsFor(
  sessions: readonly SessionRecord[],
  project: string,
  cwd: string,
  held: { has(id: string): boolean } = new Set<string>(),
): SessionRecord[] {
  return sessions
    .filter((s) => s.opened && (s.closed !== true || held.has(s.id)) && s.project === project && s.cwd === cwd)
    .sort((a, b) => newestFirst(a.updatedAt, b.updatedAt))
}

/**
 * The conversation to resume with one employee in one project, or `null` when they have none.
 *
 * Their newest in `sessionsFor`'s list, so it leaves out what that list leaves out and orders by
 * instant for the same reason. Under `localeCompare`, a conversation whose `updatedAt` read
 * `'not a date'` was resumed over a newer real one. One whose time will not parse is still resumed
 * when it is the only one they have.
 *
 * Here rather than inline in `main.ts`'s `openAgentSession` handler, because `main.ts` imports
 * `electron` at module scope and no test can load it, so the choice had no test.
 */
export function conversationWith(
  sessions: readonly SessionRecord[],
  project: string,
  cwd: string,
  agent: string,
): SessionRecord | null {
  return sessionsFor(sessions, project, cwd).find((s) => s.agent === agent) ?? null
}

/**
 * One entry per conversation a project should show. The live one first, then the recorded ones.
 *
 * `record` is `null` for a conversation started this run and not written down yet. It is still
 * one of the group — you are sitting in it — and the caller fills its details from memory.
 *
 * ## Why this is a function and not two loops
 *
 * It used to be two. `sessionListOf` prepended the unrecorded live conversation; `rowFor`, which
 * writes the line *directly above that list*, counted only `sessionsFor`. So on first run the
 * project row read
 *
 *     The office — no conversations yet · never
 *
 * with the conversation you were sitting in listed eight lines below it, under the heading
 * "conversations in the office". Both were rendered from the same snapshot, in the same panel,
 * at the same moment. The comment on `pushSessions` had already noticed the shape of this —
 * *"a registry change that pushed only the session list would leave the row above it stating a
 * count that had just stopped being true"* — and made them refresh together, which made them
 * wrong together instead of apart.
 *
 * Two definitions of "the conversations this project has" cannot be kept in agreement by being
 * called at the same time. So there is one, and it is here rather than in `main.ts`, where no
 * test can reach it.
 *
 * `closed` is checked against the live conversation specifically: without it, closing the
 * conversation you are *in* put the row straight back, because it is the live one and this
 * branch re-added it on every redraw. That was while a close left the conversation running. The
 * close handler now takes it out of `managers` as well, so `main.ts` no longer passes a
 * conversation this office closed as `live`.
 *
 * ## A close from another office
 *
 * `held` is what this process still holds (`managers`, in `main.ts`), and a close does not hide any
 * of it that Claude has confirmed (`opened`, which `known` requires whatever `held` says).
 * Two offices on one workspace share the registry, and `mergeNewest` puts a close made in one into
 * the other's memory at the other's next save. While that close hid everything, a conversation
 * somebody in the other office was sitting in, perhaps mid-turn, dropped out of that office's
 * list, and the project row above the list stopped counting it and stopped saying it was working.
 *
 * This office's own close takes the conversation out of `managers` before it pushes the list, so
 * what this office closes still goes. Another office's close applies here once nothing here holds
 * the conversation. Only a close releases one, so unless it is closed here too, that is the next
 * launch.
 */
export interface ShownSession {
  readonly id: string
  /** The record, or `null` when this run started it and nothing has written it down yet. */
  readonly record: SessionRecord | null
}

export function shownSessions(
  sessions: readonly SessionRecord[],
  project: string,
  cwd: string,
  live: { readonly id: string } | null | undefined,
  held: { has(id: string): boolean } = new Set<string>(),
): ShownSession[] {
  const known = sessionsFor(sessions, project, cwd, held)
  const closed = live != null && sessions.some((s) => s.id === live.id && s.closed === true)
  const unrecorded = live != null && !closed && !known.some((s) => s.id === live.id)

  return [
    ...(unrecorded ? [{ id: live.id, record: null }] : []),
    ...known.map((record) => ({ id: record.id, record })),
  ]
}

/** The first thing you said, cut to something that fits a tab. */
export function titleFrom(message: string): string {
  const line = message.trim().split('\n')[0]?.trim() ?? ''
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

// ───────────────────────────────────────────────────────────────────────── io ──

export function registryPath(root: string): string {
  return join(root, STATE_DIR, REGISTRY_FILE)
}

/**
 * Whether it is safe to write the registry back, given how reading it went.
 *
 * A pure function and exported, because the answer is the difference between keeping and
 * destroying every conversation a workspace remembers, and the caller lives in `main.ts` where
 * no test can reach it.
 *
 * `ok` is obvious. **`missing` is also yes** — there is no history to lose and the first write
 * creates the file, which is how a new workspace gets one at all.
 *
 * `unreadable` is no, and this is the case that cost something. A registry that will not parse
 * is usually a registry a person could repair by hand: a truncated write leaves every record but
 * the last one intact and wants a closing brace. Writing over it replaces all of that with
 * whatever this process happens to hold, which after a failed read is nothing. `main.ts` already
 * had a guard whose message says precisely this — "that would replace every conversation this
 * workspace remembers with whatever happens to be in memory" — and it only covered writing
 * *before* the read, not writing after one that failed.
 */
export function mayWriteRegistry(state: RegistryState['state']): boolean {
  return state === 'ok' || state === 'missing'
}

/**
 * What to say about the rows a read could not use, or `null` when there were none.
 *
 * `parseRegistry` keeps the rows it can read and counts the rest. `openRegistry` took the rows
 * and dropped the count, so a registry whose every row failed to parse opened as a workspace with
 * no history, and only search said otherwise. Pure and exported for the reason
 * `mayWriteRegistry` is: the caller lives in `main.ts`, where no test can reach it.
 *
 * `lint` rather than `unreadable-file`, because the file was read. The first-run panel shows an
 * `unreadable-file` problem as a sentence of its own, built from the path — "exists and could not
 * be read" — which would be false here, and the count would not be shown at all.
 *
 * Only `ok` has rows to count. A file that will not open is already `openRegistry`'s
 * `unreadable-file` problem, and is not reported a second time here.
 */
export function skippedRowsProblem(root: string, loaded: RegistryState): Problem | null {
  if (loaded.state !== 'ok' || loaded.skipped === 0) return null

  const path = registryPath(root)
  const rows = loaded.skipped === 1 ? '1 row' : `${loaded.skipped} rows`
  return {
    kind: 'lint',
    path,
    rule: 'registry-rows-unreadable',
    detail: `${rows} in ${path} could not be read, so the list of previous conversations may be incomplete.`,
  }
}

/** Read the registry. Never throws; the failure is the return value. */
export async function loadRegistry(root: string): Promise<RegistryState> {
  const path = registryPath(root)

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
    return { state: 'unreadable', cause: (err as Error).message }
  }

  const parsed = parseRegistry(text)
  if ('error' in parsed) return { state: 'unreadable', cause: parsed.error }
  return { state: 'ok', sessions: parsed.sessions, skipped: parsed.skipped, unread: parsed.unread }
}

/**
 * One writer at a time would be the caller's job; one *temp file* at a time was not.
 *
 * The name was `${path}.${pid}.tmp` — unique per process and shared by every call inside it. Two
 * overlapping saves therefore wrote to the same scratch file and then both renamed it, and the
 * second rename found nothing there. Reproduced: 400 records written, 400 lost, and an
 * `ENOENT: no such file or directory, rename` thrown at whichever caller lost the race.
 *
 * The pid was doing the right thing about the wrong axis. Two Office Spaces on one workspace
 * cannot collide; two handlers in one Office Space could, and that is the common case rather
 * than the exotic one — closing a conversation while a turn finishes writes twice.
 *
 * A counter fixes the collision. It does not decide *which* save wins, because that is a
 * question about the caller's state rather than about files; `writeRegistry` serialises for
 * that reason.
 */
let saveSeq = 0

/**
 * A registry appeared while this office believed there was none.
 *
 * Its own class rather than a message, because the caller has something to **do** about it and
 * matching on prose to decide is how a recovery path stops working the day somebody rewords an
 * error. See the recovery in `main.ts`: the honest answer is not to give up, it is to adopt the
 * file — after which this office is in exactly the state it would have been in had it started a
 * second later, which is the ordinary one.
 */
export class RegistryAppeared extends Error {
  constructor() {
    super(
      'refusing to create the session registry: one appeared while this office was running, so ' +
        'another copy is recording to it. Writing would replace whatever it has remembered.',
    )
    this.name = 'RegistryAppeared'
  }
}

/**
 * Write the registry, atomically.
 *
 * Temp file then rename, because this is the only record of what to resume and a torn write
 * loses conversations that still exist on disk. Two windows on one workspace is last-writer-
 * wins, which is the right trade here: the alternative is a lock file that can outlive the
 * process holding it and leave the office unable to remember anything at all.
 */
export async function saveRegistry(
  root: string,
  sessions: readonly SessionRecord[],
  options: { readonly create?: boolean; readonly read?: RegistryState } = {},
): Promise<void> {
  const path = registryPath(root)
  await mkdir(dirname(path), { recursive: true })

  // `create` is the first write of a process that read the registry as **missing**.
  //
  // That verdict authorises writing on the grounds that there is no history to lose, and it is
  // the only one of the three that can stop being true in the dangerous direction: `ok` is
  // last-writer-wins by design and `unreadable` refuses either way, but `missing` is a claim
  // about a moment, and if a registry has appeared since, the claim is false and the write
  // destroys exactly what the guard exists to protect.
  //
  // It is also the verdict that is *normal* to hold concurrently. Two copies of the app opening
  // the same fresh workspace both read `missing` — there is no single-instance lock — and both
  // then believe they may create. The first records forty conversations and the second replaces
  // them with two.
  //
  // `wx` moves the question from a remembered fact to the syscall: create only if still absent.
  // The same flag `hire` and `addSkill` write agent and skill files with, for the same reason.
  // An `EEXIST` here is not a failure to handle quietly — somebody else's history is on the
  // other side of it — so it is thrown with a sentence saying what was refused and why.
  if (options.create) {
    try {
      await writeFile(path, serializeRegistry(sessions), { encoding: 'utf8', flag: 'wx' })
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      throw new RegistryAppeared()
    }
  }

  /*
   * Every row of the file that this version could not read goes back into it.
   *
   * This wrote only `sessions`, and `parseRegistry` leaves out what it cannot read, so the first
   * save after a read deleted those rows for good. Measured on dev at e6fe5cb: one load and one
   * save, and the next read counted nothing skipped. Such a row is not always a broken one. Two
   * offices on one workspace share this file, and a newer build can write a row this one does not
   * understand.
   *
   * They are taken from the file being replaced, not from memory, and from **one** read of it:
   * `read`, the read the caller merged `sessions` from, or a read made here when there is none.
   * So a save keeps what the file held when it was read, including rows another office wrote after
   * this one opened, and writes each of them once however many offices save. A row somebody
   * repaired before that read reaches the file once, through `sessions` and `mergeNewest`, and
   * never also as the unreadable copy this office saw when it opened. They go after `sessions`, in
   * file order, JSON-equal rather than byte-equal.
   *
   * One read, because the merge and the rows kept have to describe the same file. `writeRegistry`
   * read for its merge and this read again for the rows to keep, and a review measured two ways
   * that went wrong against these functions: a row repaired between the two reads was in neither
   * and was dropped, and a file torn at the first read and whole at the second was written over
   * with the unmerged list. What changes on disk after the one read is lost when the rename lands,
   * for these rows as for every other; that window is the same as it was before any row was kept.
   *
   * An id the file holds only in a shape this version cannot read is not written again beside it,
   * even from a copy here that looks newer. This version cannot tell which of the two is current,
   * and writing its own shape over the other would delete whatever the other added. A file that
   * holds an id both ways keeps both, and the row this version reads is merged as usual.
   *
   * Leaving such a copy out is not silent. Everything else is written first, and then the save
   * throws `RowsLeftOut`, naming what it left out. It kept quiet at first, and a review measured
   * what that cost: a close of a conversation a newer office had rewritten returned as done with
   * `closed` never written, and a conversation whose row a hand edit broke went on being "saved"
   * while the file kept the broken row, so the next launch listed nothing.
   *
   * A read that found the file there and could not use it is refused: every row in such a file is
   * one this version could not read, and none of them can be told apart to be kept. The comment in
   * `writeRegistry` says such a file is not to be written over, and it was written over. A read
   * handed in is refused the same way, even if the file has become readable since, because the
   * merge that produced `sessions` did not see it.
   */
  const current = options.read ?? (await loadRegistry(root))
  if (current.state === 'unreadable') {
    throw new Error(
      'refusing to write the session registry, because the file there could not be read ' +
        `(${current.cause}), and writing would replace every conversation in it. The file is ` +
        'unchanged.',
    )
  }
  const unread = current.state === 'ok' ? current.unread : []
  const readHere = new Set(current.state === 'ok' ? current.sessions.map((s) => s.id) : [])
  // A row that is a number or a string has no `id`, and reads as `undefined` here.
  const heldUnread = new Set(unread.map((row) => (row as { readonly id?: unknown } | null)?.id))
  const written: SessionRecord[] = []
  const leftOut: SessionRecord[] = []
  for (const s of sessions) (readHere.has(s.id) || !heldUnread.has(s.id) ? written : leftOut).push(s)

  const temp = `${path}.${process.pid}.${++saveSeq}.tmp`
  await writeFile(temp, serializeRegistry(written, unread), 'utf8')
  await rename(temp, path)
  if (leftOut.length > 0) throw new RowsLeftOut(path, leftOut)
}

/**
 * A save left out conversations this office holds, and wrote everything else.
 *
 * The file holds their rows only in a shape this version cannot read, damaged or written by a newer
 * build, and `saveRegistry` does not write its own copy over such a row. Its own class, as
 * `RegistryAppeared` is, because callers act on it rather than only pass it on: `remember` reports
 * it as a problem of its own (`registrySaveProblem`), and the close handler asks whether the
 * conversation it closed is one of `ids` (`writtenDespite`). Declared after `saveRegistry`, which
 * only constructs it when it runs.
 */
export class RowsLeftOut extends Error {
  /** What was left out, in the order the caller held it. */
  readonly ids: readonly string[]

  constructor(path: string, left: readonly SessionRecord[]) {
    const one = left.length === 1
    // Named by title as well, when there is one, because the title is what the list shows. Five at
    // most: a long list of ids is not a sentence anybody reads.
    const names = left.slice(0, 5).map((s) => (s.title ? `"${s.title}" (${s.id})` : s.id))
    const more = left.length > 5 ? `, and ${left.length - 5} more` : ''
    // What happens to the row is said as it happens. The save writes back what it parsed, so the
    // row can move, and its keys and numbers can be written differently; it was "unchanged" until a
    // review measured otherwise. And the advice is not "remove it": a row a newer version wrote is
    // that version's copy of the conversation.
    super(
      `${left.length} conversation${one ? ' was' : 's were'} not saved: ${names.join(', ')}${more}. ` +
        `${one ? 'Its row' : 'Their rows'} in ${path} ${one ? 'is' : 'are'} in a form this version ` +
        `cannot use, so this office did not write its own ${one ? 'copy over it' : 'copies over them'}. ` +
        `${one ? 'That row is' : 'Those rows are'} kept as this version read ${one ? 'it' : 'them'}, and ` +
        'may be reformatted. Everything else was saved. ' +
        `If ${one ? 'the' : 'a'} row is damaged, repair it. If a newer version wrote it, keep it and use ` +
        `that version for ${one ? 'this' : 'that'} conversation.`,
    )
    this.name = 'RowsLeftOut'
    this.ids = left.map((s) => s.id)
  }
}

/**
 * What the office reports when a save throws: `remember` for any failure, and the close handler
 * for a `RowsLeftOut` that did not undo its close.
 *
 * A save that left conversations out wrote everything else, so "could not write the session
 * registry" would be false. It is a `lint` with a rule of its own and the error's own sentence:
 * `describeProblem` shows a `lint`'s `detail` as written. The rule is none of the three that the
 * first-run panel turns into steps of their own (`firstRunState` in `app.ts`), and not the one that
 * counts the rows a read skipped (#269), which is a different fact.
 *
 * Any other failure is what `remember` always reported, in the same words: the registry was not
 * written. Pure and exported for the reason `mayWriteRegistry` is: the callers are in `main.ts`.
 */
export function registrySaveProblem(root: string, err: unknown): Problem {
  const path = registryPath(root)
  if (err instanceof RowsLeftOut) {
    return { kind: 'lint', path, rule: 'registry-rows-left-out', detail: err.message }
  }
  return {
    kind: 'unreadable-file',
    path,
    cause: `could not write the session registry, so this conversation will not be offered next time: ${
      err instanceof Error ? err.message : String(err)
    }`,
  }
}

/**
 * Whether a save that threw `err` still wrote the record `id`.
 *
 * Only a `RowsLeftOut` that does not name `id` did. Every other failure left the registry as it was,
 * or never reached it. The close handler in `main.ts` asks this, so a close that was written is not
 * reported as failed because the same save left out a different conversation, and a close that was
 * left out is not reported as done.
 */
export function writtenDespite(err: unknown, id: string): boolean {
  return err instanceof RowsLeftOut && !err.ids.includes(id)
}
