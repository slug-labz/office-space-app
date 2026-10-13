/**
 * Where am I, and how do I get somewhere else — worked out apart from the DOM that shows it.
 *
 * Settled against a mock of both readings: no tabs for the project, because a tab strip is hard
 * to control. Clicking a project makes it active; its sessions go in a vertical dropdown under
 * it, with the active session tagged.
 *
 * **A tab strip is not a bad list. It is not a list at all.** It has no room for a second line,
 * no room for state, no way to manage anything, and it runs out of horizontal space at about
 * four projects — the screenshot that prompted this had four and was already full. Every
 * reference in the brief solved this the same way years ago: Claude Code's `/resume`, Codex's
 * session list, Cursor's history, Claude.ai's sidebar. All vertical, all two-line rows, all with
 * the active one marked.
 *
 * This replaces three navigation surfaces with one: the tab strip, the 254 × **12.5px** session
 * button in the pane header, and the drawer it opened. The campus stays as the spatial way in —
 * that was never what was being given up.
 *
 * The four decisions below all have a way of being got wrong quietly:
 *
 * - **A running project says so instead of saying when.** "2m ago" on a project that is working
 *   right now is technically true and answers the wrong question.
 * - **A conversation with no title has not been spoken to**, which is not the same as being
 *   untitled. The title *is* the first thing you said.
 * - **The office is always there and is not a directory**, so a count it cannot have is not
 *   printed as zero.
 * - **`ago` never says "0m".** A clock that reads zero looks stopped.
 */

import type { ProjectInfo, SessionInfo } from './ipc.js'
import { OFFICE_PROJECT } from './ipc.js'
import { matchIn } from './match.js'
import { costLabel } from './cost.js'

/**
 * How long ago, in words. `null` is **"never"** — no such moment exists.
 *
 * Under a minute is "now". Then minutes, hours, days — one unit, never "0m".
 *
 * Callers with a third case must not route it through here. A conversation that is open and has
 * had nothing said in it has no last-active moment either, and "never" said about a conversation
 * that is on screen in front of you is the same untruth as "no conversations yet" was, one level
 * down. See `NOTHING_YET`.
 */
export function ago(iso: string | null, now: number): string {
  if (iso === null) return 'never'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'never'

  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * A conversation that exists and has done nothing.
 *
 * Distinct from "never", which is about a project that has had no conversations at all, and
 * distinct from a timestamp, which is about something that happened. This third state used to be
 * printed as `now` because the payload minted `new Date()` for it — so an idle conversation read
 * as active, and re-read as active on every rescan.
 */
const NOTHING_YET = 'nothing said yet'

/** "3 chats" / "1 chat" / "no chats yet". Plural rules stated once. */
function chats(n: number): string {
  if (n === 0) return 'no conversations yet'
  return n === 1 ? '1 conversation' : `${n} conversations`
}

/**
 * The convention files this project does not have.
 *
 * `PLAN.md`, `PROGRESS.md` and `TASKS.md` are not bookkeeping. `CLAUDE.md` is explicit that the
 * floor reads them — *"this is where an agent's status bubble gets its content"* — and the task
 * board is `TASKS.md` and nothing else. A project missing one has a quieter office for a reason
 * nobody can see from the list, and the list is exactly where you decide which project to open.
 *
 * `ProjectInfo.missing` was built in three places to say this and read in none, while the
 * interface's own comment says the three fields under `name` **are** the second line, carried on
 * the payload rather than fetched per row precisely so a row never renders empty and then jumps.
 *
 * Silent when there is nothing to say: an empty list adds nothing to the line, so the common case
 * costs no words. Found by `scripts/unread-fields.mjs`.
 */
function without(missing: readonly string[]): string {
  if (missing.length === 0) return ''
  // Named, never counted. "1 file missing" makes you open the project to find out which, and the
  // whole point of putting this on the row is that you do not have to.
  return ` · no ${missing.join(', no ')}`
}

/**
 * When, and what it cost — as three cases, because the pair describes three rows.
 *
 * | Row | Reads | Why |
 * |---|---|---|
 * | Running | `working now` | `costUsd` arrives with the result event. A running row would say "no cost recorded" for the whole turn and then change its mind. |
 * | Never spoken in | *(nothing)* | Both halves are silent for the same reason: the title already carries the fact. |
 * | Has run | `2m ago · $0.2431` | Now the figure is worth printing, and `costLabel(null)` is "no cost recorded" rather than `$0` — a conversation the registry has no number for did not cost nothing. |
 */
function metaFor(session: SessionInfo, now: number): string {
  if (session.running) return 'working now'
  if (session.updatedAt === null) return ''
  return `${ago(session.updatedAt, now)} · ${costLabel(session.costUsd)}`
}

export interface ProjectRow {
  readonly id: string
  readonly name: string
  /** The second line: how many conversations, and when — or that it is working now. */
  readonly meta: string
  readonly current: boolean
  readonly running: boolean
  /** True for the unscoped conversation, which is always present and has no directory. */
  readonly isOffice: boolean
}

export function projectRows(
  projects: readonly ProjectInfo[],
  active: string,
  now: number,
): readonly ProjectRow[] {
  return projects.map((project) => {
    const isOffice = project.id === OFFICE_PROJECT
    return {
      id: project.id,
      name: project.name,
      // Running beats a timestamp. "2m ago" on something that is working right now is true and
      // answers a question nobody asked; the row is for deciding where to go next.
      // The office is the unscoped conversation and has no directory, so it has no convention
      // files to be missing. Saying "no PLAN.md" about it would be reporting the absence of
      // something that could not exist.
      meta: whenOf(project, now) + (isOffice ? '' : without(project.missing)),
      current: project.id === active,
      running: project.running,
      isOffice,
    }
  })
}

/**
 * The second line of a project row: how many, and when.
 *
 * Three states, not two, and the third is the one that shipped wrong. A project with no
 * conversations has nothing to say after the count, so it says nothing — *"no conversations yet ·
 * never"* was the same fact twice. A project whose only conversation is one you have just opened
 * has a conversation and no activity. Everything else has a time.
 */
function whenOf(project: ProjectInfo, now: number): string {
  const count = chats(project.conversations)
  if (project.running) return `${count} · working now`
  if (project.conversations === 0) return count
  return `${count} · ${project.lastActiveAt === null ? NOTHING_YET : ago(project.lastActiveAt, now)}`
}

export interface SessionRow {
  readonly id: string
  /** Who answers. Carried through so a people row can name them without a second lookup. */
  readonly agent: string
  /** What it is called, in practice: the first thing you said in it. */
  readonly title: string
  readonly meta: string
  readonly current: boolean
  readonly running: boolean
}

/**
 * The two kinds of conversation in a project, split.
 *
 * A conversation with the manager and a conversation with the tester are not the same thing and
 * a single list would make them look it. The manager's are the project's work; an employee's is
 * a side conversation with one person that never enters it.
 *
 * `manager` is passed in rather than assumed, because which agent runs the office is a fact
 * about the workspace — `findManager` takes whoever can delegate when nobody is called manager.
 */
export function splitSessions(
  sessions: readonly SessionInfo[],
  manager: string,
): { readonly office: readonly SessionInfo[]; readonly people: readonly SessionInfo[] } {
  return {
    office: sessions.filter((s) => s.agent === manager),
    people: sessions.filter((s) => s.agent !== manager),
  }
}

export function sessionRows(
  sessions: readonly SessionInfo[],
  now: number,
): readonly SessionRow[] {
  return sessions.map((session) => ({
    id: session.id,
    agent: session.agent,
    // Not "Untitled". The title is the first thing you said, so its absence means nothing has
    // been said — which is a different fact and the one worth printing.
    title: session.title ?? 'Nothing said yet',
    /**
     * When, what it cost, and the row that says neither.
     *
     * Two edits landed on this one line and neither side is right alone. #170 gave it a silent
     * third state: `ago(null)` says "never", which is wrong about a conversation on screen, and
     * the title already reads *"Nothing said yet"*. #173 appends `costLabel(session.costUsd)`,
     * because the figure was computed on every refresh and read by nobody.
     *
     * Taking the cost side whole puts `ago(null)` back. Concatenating blindly prints
     * *" · no cost recorded"* — a separator with nothing in front of it — on exactly the rows the
     * silence was written for. Both resolutions type-check and both are wrong on screen, which is
     * why this is three cases in `metaFor` rather than a choice between two lines.
     */
    meta: metaFor(session, now),
    current: session.current,
    running: session.running,
  }))
}

/**
 * The workspace, when it is worth saying which one.
 *
 * Normally silence: naming the directory you are obviously in is a developer's answer to a
 * question nobody asks twice, and the workspace path was removed from the chrome for exactly
 * that reason.
 *
 * But an app pointed somewhere unexpected and an app with nothing in it look **identical**, and
 * that cost an hour today: conversations that were safely on disk read as lost, because nothing
 * on screen could say which office was open. So: the default is unnamed, and anything else is
 * named. Presence is the signal.
 */
export function workspaceLabel(root: string, defaultRoot: string): string | null {
  const tidy = (p: string): string => p.replace(/\/+$/, '')
  return tidy(root) === tidy(defaultRoot) ? null : (tidy(root).split('/').pop() ?? null)
}

/**
 * What the closed control says: where you are, at both levels.
 *
 * This is the whole reason the control exists, so it never returns an empty string and never
 * returns a bare id. The old header said the session and not the project, which is half of
 * *"where am I"* — and it said it at 12.5px.
 */
export function switcherLabel(
  project: ProjectInfo | undefined,
  session: SessionInfo | undefined,
): { readonly project: string; readonly session: string } {
  return {
    project: project?.name ?? 'The office',
    // A project with no conversation open is a real state — you have just switched to it — and
    // "Nothing said yet" would be a lie about a conversation that does not exist.
    session: session === undefined ? 'No conversation open' : (session.title ?? 'Nothing said yet'),
  }
}


/**
 * The two ways to start something, and the order they go in.
 *
 * Reported after hunting for it and failing: new projects could not be made at all. That was
 * not wrong about the app. `Start a new project` existed only in the ⌘K palette, and
 * `+ new conversation` only *inside* the switcher's list — so both sat behind a control that
 * reads as a window title, and one of them behind a keyboard shortcut as well. A thing you can
 * only reach once you already know where it is has not been made reachable.
 *
 * Here rather than in the view for the reason every other judgement in this file is here: it is
 * the only way a decision in the renderer can be reached by a test.
 *
 * **Conversation first.** It is the one you do several times a day; a new project is a thing you
 * do on a Monday. A menu that puts the rare item under the cursor spends the common one's
 * position on it.
 *
 * The conversation row names the project it would land in, because "new conversation" on its own
 * does not say *where* — and not knowing where you are is the whole complaint this answers.
 * It takes the label rather than the record so that it cannot disagree with the trigger sitting
 * beside it: `switcherLabel` has already resolved the nameless case to "The office".
 */
export type NewAction = 'session' | 'project'

export interface NewActionRow {
  readonly action: NewAction
  readonly label: string
}

export function newActions(projectLabel: string): readonly NewActionRow[] {
  const where = projectLabel.trim() === '' ? 'The office' : projectLabel.trim()
  return [
    { action: 'session', label: `New conversation in ${where}` },
    // The ellipsis is a promise the app keeps: naming a project opens a prompt, and a menu item
    // that asks a question before it does anything should say so. See `onNewProject` in `app.ts`.
    { action: 'project', label: 'New project…' },
  ]
}

/**
 * Narrow the list to what somebody typed.
 *
 * Pure, and here rather than in the view, because *which rows survive a query* is a decision and
 * the view is a place that draws things. It also has to be one decision: the command palette
 * matches by subsequence, and a switcher that matched by prefix would find different things from
 * the same three letters with nothing to explain the difference. Both call `matchIn`.
 *
 * ## What each row is searched by
 *
 * A project by its name **and its id**, because a directory called `auth-refresh` shows as "auth
 * refresh" and somebody who knows it from the filesystem types the hyphen. A conversation by its
 * title and by who answers in it — "reviewer" is how you find the one you had with the reviewer,
 * and it is not in the title.
 *
 * The meta line is deliberately not searched. It holds a relative time and a cost, and matching
 * "2" against "2h ago" would return rows for a reason nobody could see.
 */
export function narrow<T extends { readonly id: string }>(
  rows: readonly T[],
  query: string,
  namesOf: (row: T) => readonly string[],
): readonly T[] {
  if (query.trim() === '') return rows
  return rows
    .map((row, index) => ({ row, at: matchIn(namesOf(row), query), index }))
    .filter((scored): scored is { row: T; at: number; index: number } => scored.at !== null)
    // Where the match starts, then the order they came in — an exact prefix beats a scattered
    // subsequence, and ties keep the order somebody already chose.
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((scored) => scored.row)
}

/** What a project row is searched by. */
export const projectNames = (p: ProjectInfo): readonly string[] => [p.name, p.id]

/** What a conversation row is searched by. */
export const sessionNames = (s: SessionInfo): readonly string[] => [s.title ?? '', s.agent]
