/**
 * The contract between the office and the window onto it.
 *
 * Everything the renderer can do is on {@link OfficeApi} and nowhere else. The renderer has no
 * Node, no filesystem, no ability to spawn anything — it draws what it is told and asks for
 * what it wants. That is not ceremony: this app renders **model output and tool results**,
 * which is to say untrusted text, inside a desktop application that can start processes with
 * your credentials. The narrow surface is the security boundary.
 *
 * A rule that follows from the same fact, and lives in the renderer: model output is written
 * with `textContent`, never `innerHTML`. An agent that prints a `<script>` tag should render
 * as the characters of a script tag.
 */

/**
 * The privacy report's shape is defined where it is measured, not restated here.
 *
 * Type-only, so nothing from `main/` reaches the renderer at runtime — the same arrangement
 * `views/tasks.ts` already uses for `TaskReport`. A second declaration of this shape would be
 * a second thing to keep in step with `persistence.ts`, which is the file the whole report
 * exists to be honest about.
 */
import type { PrivacyReport } from '../main/privacy.js'
import type { Dispatch, TornLine } from '../main/ledger.js'
import type { Player, Track } from './spotify/model.js'
export type { PrivacyReport, MeasuredStore, Egress } from '../main/privacy.js'
export type { Dispatch, TornLine } from '../main/ledger.js'

import type { Controls } from './controls.js'
import type { ClaudeEvent } from '../main/claude/stream.js'
import type { Problem } from '../main/workspace.js'
import type { HooksReport } from './hooks.js'
import type { DecisionReport } from './decisions.js'
import type { PlanReading } from './plan-usage.js'
import type { MemoryReport } from './memory.js'
import type { DispatchRow } from './changes-view.js'
import type { Searched } from './search.js'
import type { GateState } from './gate.js'
import type { UndoResult } from './undo.js'
import type { Source, Standing } from './hired-from.js'
import type { ConnectRequest } from './connector.js'
import type { SharingRow } from '../main/sharing.js'
export type { SharingRow } from '../main/sharing.js'
import type { PaintDirection } from './character/painter.js'
import type { TimelineEntry } from './transcript/parse.js'
import type { ClickedTask, TaskReport } from '../main/harness.js'

/** One member of staff, as the floor needs to know them. */
export interface StaffMember {
  readonly id: string
  readonly name: string
  readonly description: string
  /**
   * Declared tools, or `null` when the agent's frontmatter omits the key.
   *
   * Absent is not empty: an agent with no `tools:` inherits everything the parent has,
   * including the ability to delegate, which is exactly the misconfiguration that breaks the
   * rule that only the manager dispatches. `null` here is what lets the UI say so.
   */
  readonly tools: readonly string[] | null
  readonly model: string | null
  readonly isManager: boolean
}

/**
 * One project, as a row in a list needs to know it.
 *
 * The empty id is **the office itself** — a conversation not scoped to any project directory.
 * It is always there, because a workspace with no `projects/` still needs somewhere to talk,
 * and because "set up a project for me" has to be sayable before any project exists.
 *
 * ## Why this is not the tab bar's shape any more
 *
 * It used to read *"one project, as the tab bar needs to know it"*, and it carried exactly what
 * a tab needs: an id, a name, and whether its files are missing. The tabs were asked to go — a
 * tab strip for projects is hard to control — and a vertical list of two-line rows was chosen
 * instead, from a mock.
 *
 * The three fields below are the second line. They are the entire difference between a list you
 * can manage and a taller tab strip, which is why they are here rather than fetched per row: a
 * row that has to ask before it can describe itself renders empty first and then jumps.
 */
export interface ProjectInfo {
  readonly id: string
  readonly name: string
  /** Which of PLAN.md, PROGRESS.md and TASKS.md are actually present. */
  readonly missing: readonly string[]
  /**
   * How many conversations this project holds.
   *
   * Opened ones only. An id we generated and never got confirmed names no conversation on disk,
   * so counting it would promise a row that cannot be opened.
   */
  readonly conversations: number
  /**
   * When this project was last talked to. `null` when it has never been.
   *
   * Not the directory's mtime — the conversation's. A project whose files somebody edited in an
   * editor has not been *worked on here*, and the row is answering "where was I".
   */
  readonly lastActiveAt: string | null
  /** True while any of its conversations is working. Several can be at once. */
  readonly running: boolean
}

/** The unscoped conversation. Always present, never a directory. */
export const OFFICE_PROJECT = ''

export interface ThemeInfo {
  readonly id: string
  readonly name: string
  /** Required by most asset licences wherever the theme is named. */
  readonly credit: string | null
  readonly redistributable: boolean
}

/** A theme you could switch to. The built-in is always first and always available. */
export interface ThemeChoice extends ThemeInfo {
  readonly active: boolean
}

/** The office as it is right now. Always a whole snapshot, never a diff. */
export interface OfficeSnapshot {
  readonly root: string
  readonly staff: readonly StaffMember[]
  readonly skills: readonly SkillInfo[]
  /** Never hidden. A workspace that cannot be read is a fact about the office. */
  readonly problems: readonly Problem[]
  /** Every theme available, built-in first. Includes packs installed into `assets/themes/`. */
  readonly themes: readonly ThemeChoice[]
  /**
   * When the office last read itself.
   *
   * No reader, and said here so the next person to run `scripts/unread-fields.mjs` spends a
   * minute on it rather than an afternoon — which is the whole difference between this field and
   * the two `costUsd` ones above, where the comments claimed readers that did not exist.
   *
   * The only `scannedAt` anything reads is `Workspace.scannedAt`, in `cli/discover.ts`, and that
   * is a different declaration on the main side of the bridge. This one crosses and stops.
   *
   * ## Why this may stay when a `Problem` may not
   *
   * `test/problems-reach-the-snapshot.test.ts` states the opposite rule for its own subject —
   * *spread it, or delete it; a list that is filled and never read is worse than no list* — and
   * the two are not in conflict. A `Problem` that reaches nobody is a thing the office knows and
   * the user is not told: the collection exists **in order to** be shown, so one that is not
   * shown is a lie by omission. A field on a payload is weight. Nobody is worse off for
   * `scannedAt` crossing the bridge unread; somebody is worse off for a theme that failed
   * silently. Delete a `Problem` list or wire it up; a field only has to say which it is.
   */
  readonly scannedAt: string
  readonly theme: ThemeInfo
  /** The office first, then one per directory under `projects/`. */
  readonly projects: readonly ProjectInfo[]
  /** False when there is no `projects/_TEMPLATE/` to copy, so the UI can say why. */
  readonly canCreateProject: boolean
  /**
   * Whether the office has a project template of its own to copy into this workspace.
   *
   * Not the same question as `canCreateProject`, which is about this workspace. A workspace
   * somebody pointed the office at with `OFFICE_WORKSPACE` has no template and the office has
   * one to give; a broken build has neither. Only the first is worth a button.
   */
  readonly canAddTemplate: boolean
  /**
   * Whether this workspace has a `CLAUDE.md` at its root.
   *
   * Every agent Claude Code starts here reads it first, and it was the one item on VISION's list
   * of what a `.claude/` workspace holds that the office showed nothing about. Three states,
   * because "there and unreadable" is fixed differently from "never written".
   */
  readonly instructions: 'present' | 'absent' | 'unreadable'
  /**
   * What state the approval gate is in — see `shared/gate.ts`.
   *
   * Carried whole rather than as a boolean: four of the six states mean "no gate" and each is
   * fixed differently, and one means the office could not tell, which must never draw as any of
   * them.
   */
  readonly gate: GateState
  /**
   * What startup brought forward into `.claude/`, in one sentence, or null when nothing moved.
   *
   * Rides on every snapshot rather than being pushed once, because the update happens before
   * there is a window to push to. The renderer says it once. `src/main/reconcile.ts` holds the
   * rule that decides which files may move and which are the user's.
   */
  readonly update: string | null
}

/**
 * Character art, over the wire.
 *
 * Two shapes, because the two kinds of theme are genuinely different and pretending otherwise
 * would mean writing a PNG decoder in the main process. The drawn cast is already pixels; an
 * installed pack is a file, and the renderer is a browser that decodes files for a living.
 *
 * Both arrive by the same call and leave as the same bitmaps, which is what keeps the rest of
 * the floor from knowing which theme it is drawing.
 */
export type SpriteSheet =
  /** Painted in code. Plain arrays so it survives structured cloning. */
  | {
      readonly kind: 'painted'
      readonly width: number
      readonly height: number
      readonly frames: Readonly<Record<PaintDirection, readonly Uint8ClampedArray[]>>
    }
  /** One agent's sheet from an installed pack, with where to cut it. */
  | {
      readonly kind: 'sheet'
      readonly png: Uint8Array
      readonly frameWidth: number
      readonly frameHeight: number
      readonly rows: Readonly<Record<PaintDirection, number>>
      readonly steps: readonly [number, number, number]
    }

export type { Mode } from './session/mode.js'
import type { Mode } from './session/mode.js'

export type SessionPhase = 'idle' | 'running' | 'failed'

export interface SessionState {
  readonly phase: SessionPhase
  /** Null until the first run reports one. */
  readonly sessionId: string | null
  readonly costUsd: number | null
  /** Populated when `phase` is `failed`. Shown verbatim — never a friendlier paraphrase. */
  readonly error: string | null
  /**
   * Messages typed while a turn was in flight, waiting their turn.
   *
   * Carried so the composer can say so. A message that has been accepted and is not visible
   * anywhere is the fourth standing order broken in the place the user is most likely to
   * notice — they typed it, pressed send, and nothing happened.
   */
  readonly queued: readonly string[]
  /**
   * What this conversation may do right now.
   *
   * The field answers *what is it*; {@link OfficeApi.onSessionMode} answers *it just changed*.
   * Both, because they are different questions: a pane that opens mid-conversation needs the
   * former, and a control that must go from live to spent in the same frame as the mode moves
   * needs the latter.
   */
  readonly mode: Mode
}

export interface AsideResult {
  readonly text: string
  readonly isError: boolean
  /**
   * What this question cost.
   *
   * No reader, deliberately: an aside's cost is folded into the session that paid for it, and
   * a display here would price the same spend twice.
   *
   * This used to say *"cost belongs to one surface, and a second display here would put two
   * formats for one number on screen, written by two people"*. There are two surfaces now — the
   * header's live figure from `SessionState.costUsd`, and the per-conversation figure on the
   * switcher's rows from `SessionInfo.costUsd`. What that sentence was actually protecting was
   * the *format*, not the count of surfaces, and it is now kept by both calling `money()` in
   * `src/shared/cost.ts` rather than by there being nowhere else to look. This comment used to name S6, the Work Feed, and say it *already reads*
   * `SessionInfo.costUsd`. S6 has not landed, in this tree or in the branch carrying it, and
   * nothing reads `SessionInfo.costUsd` at all; the sentence had borrowed the header's string
   * and attributed it to a surface that does not exist.
   *
   * Which would be a small thing, except `SessionInfo.costUsd` carried the matching half —
   * *"Read by S6, the Work Feed — see `AsideResult.costUsd`"* — so each field cited the other
   * as evidence of a reader, and neither had one. That is the shape that cost this repository
   * `themeProblems`: a promise kept, on inspection, by a different path, which on inspection
   * was keeping it by way of the first.
   */
  readonly costUsd: number | null
}

/**
 * A conversation the office was already having when it was last closed.
 *
 * `entries` may be empty while `problem` is set — the transcript exists and we could not read
 * it. That is a different thing from an empty conversation and the UI must not render it as
 * one, which is why the two fields are separate rather than an empty list standing in for
 * both.
 */
export interface RestoredSession {
  /**
   * Which conversation this is.
   *
   * No reader, and unlike most of the others that is not a gap: the renderer names the session in
   * the request, so the answer cannot be a surprise. It stays because a reply that does not say
   * what it is a reply to is the shape of the leak this handler already carries a comment about —
   * *"a project's second conversation was filled with the first one's words"* — and the cost of
   * carrying it is one string.
   */
  readonly sessionId: string
  /** No reader: the session strip already has the title, from the session list. */
  readonly title: string | null
  readonly updatedAt: string
  readonly entries: readonly TimelineEntry[]
  /** How many entries were dropped from the front to keep the payload sane. */
  readonly truncated: number
  /** Why the transcript could not be shown, when it could not. */
  readonly problem: string | null
}

/**
 * Why the office is not saying anything.
 *
 * A feature designed to say nothing has to be able to say that it said nothing, or it is
 * indistinguishable from a feature that is broken — and the two silences below are genuinely
 * different things that looked identical from outside.
 *
 * `nothing-notable` is not here on purpose: the local gate answers that way on almost every
 * turn, and a line each time would drown the strip in the app working correctly.
 */
export type Quiet =
  /** The digest read the turn and judged none of it worth interrupting a person for. */
  | 'judged'
  /** The digest run itself failed. This silence is a fault, not a judgement. */
  | 'failed'

/**
 * Something the office wants said out loud.
 *
 * Carries its project because more than one can be running, and the one that has something
 * worth saying is often not the one you are looking at — which is precisely when being told is
 * worth anything. The renderer names the project when it is not the active tab.
 */
export interface Utterance {
  readonly project: string
  readonly text: string
  /** Urgent news may interrupt a leisurely sentence. A failure that needs you is that news. */
  readonly urgency: 'routine' | 'urgent'
  /**
   * Set exactly when `text` is empty and nothing will be spoken.
   *
   * The renderer notes it in the strip rather than speaking it — the point is a record that the
   * voice considered this turn, not a voice announcing its own restraint.
   */
  readonly quiet?: Quiet
}

/**
 * What an employee actually did, as opposed to what they reported.
 *
 * `entries` empty with `problem` set means the run exists and could not be read — which is a
 * different thing from an employee who did nothing, and the UI must not render it as one.
 */
export interface EmployeeWork {
  // There is deliberately no `agent` field. Main answers `workOf(project, agent)` by echoing the
  // caller's own argument straight back, so a renderer that "checked" it would be comparing a
  // string to itself — a guard that cannot fail, which is the shape this repository keeps
  // finding and deleting. Whose record this is, is whose record you asked for.
  /** The brief the manager gave them. */
  readonly brief: string
  /** The dispatch this traces back to, so a claim can be checked against the transcript. */
  readonly toolUseId: string
  readonly entries: readonly TimelineEntry[]
  /** How many entries were dropped from the front. */
  readonly truncated: number
  readonly problem: string | null
}

/**
 * One conversation in a project, as the session strip needs to know it.
 *
 * The vision's framing: a project is not a session but *a group* of them. This is one of the
 * group.
 */
export interface SessionInfo {
  readonly id: string
  /**
   * Who answers in this conversation.
   *
   * The manager for every conversation that existed before employees got their own. Carried so
   * a list can group them and a header can say whose conversation you are in — a transcript that
   * does not name its speaker is one you have to infer from the writing.
   */
  readonly agent: string
  /** The first thing you said in it. What it is called, in practice. */
  readonly title: string | null
  /**
   * When something last happened in it. **`null` when nothing has.**
   *
   * A conversation opened this run and not yet written down has no such moment, and this used to
   * be filled in with `new Date()` at the moment the payload was built. That is a generated
   * value wearing an observed one: the row read *"now"* and went on reading *"now"* for as long
   * as the conversation sat idle, because every snapshot minted it again. Two `describe()` calls
   * a second and a half apart came back with timestamps a second and a half apart, on a workspace
   * nobody had touched.
   *
   * So it is nullable, and the caller says what to print. `never` is for a project with no
   * conversations; a conversation that exists and has done nothing is a third thing.
   */
  readonly updatedAt: string | null
  /**
   * What this conversation has cost.
   *
   * Read by `sessionRows` in `src/shared/switcher.ts`, and shown on the conversation's row in
   * the switcher. The live cost line in the header is a different field
   * (`SessionState.costUsd`) answering a different question — what the conversation you are
   * looking at has cost so far.
   *
   * This comment said *"No reader"* until the reader existed, and before that it said *"Read by
   * S6, the Work Feed"* in the present tense of a surface that has not landed. The second was
   * the expensive one: `AsideResult.costUsd` carried the matching half and pointed back here,
   * so each field cited the other as evidence of a reader and neither had one. The rule that
   * followed is that a comment naming a reader names the module, and `test/ipc-readers.test.ts`
   * now checks the claim rather than trusting it.
   */
  readonly costUsd: number | null
  /** True for the one this project is showing. */
  readonly current: boolean
  /** True while its manager is working. Several of a project's sessions can be. */
  readonly running: boolean
}

/**
 * A project's conversation list, after something changed it.
 *
 * Sent rather than signalled. A bare "something changed, go and ask" leaves a window where the
 * control is showing the old list and the app knows the new one, and the one control this is for
 * exists entirely to answer *which conversation am I in*. That is the surface least able to
 * afford being briefly wrong.
 */
export interface SessionList {
  readonly project: string
  readonly sessions: readonly SessionInfo[]
}

/**
 * A conversation moving between modes.
 *
 * Carries `from` as well as `to`, because *"intake just ended"* and *"a new conversation opened
 * in planning"* are different facts and a bare `to` cannot tell them apart.
 */
export interface ModeChange {
  readonly project: string
  readonly sessionId: string
  readonly from: Mode
  readonly to: Mode
}

export type Unsubscribe = () => void

export interface OfficeApi {
  /** The office as discovered. */
  describe(): Promise<OfficeSnapshot>
  /**
   * Fires whenever `.claude/agents/` or `.claude/skills/` changes on disk.
   *
   * This is the whole of the promise that adding an agent to the workspace adds them to the
   * floor. There is no second list to update, because the renderer holds no list of its own.
   */
  onOffice(callback: (snapshot: OfficeSnapshot) => void): Unsubscribe

  /**
   * Character art for one agent.
   *
   * Painted in the main process even though the code is shared, so that a theme loaded from
   * files on disk and the built-in drawn-in-code theme reach the renderer by the same path.
   */
  sprites(agentName: string): Promise<SpriteSheet>

  /**
   * Send a message to a project's manager. Resolves when the run finishes.
   *
   * Every session-shaped call names its project, because more than one can be running at once
   * and an event that arrives without saying whose it is would have to be guessed at — which
   * is how a tab ends up showing another tab's work.
   */
  /**
   * Send into a **named conversation**.
   *
   * `session` is the id the renderer is showing. A project is a group of sessions, so naming
   * only the project stopped being enough the day a project could have two — main would resolve
   * its own idea of "current", and the words could be rendered into one transcript while the
   * run happened in another. `null` means "whichever this project is on", which is still the
   * right answer for a project that has never had a conversation.
   */
  send(project: string, session: string | null, text: string): Promise<void>
  /** Resolves with anything that was queued and has now been dropped. */
  interrupt(project: string, session: string | null): Promise<readonly string[]>
  /**
   * Every event of a run, as it arrives, tagged with the **session** it belongs to.
   *
   * Not the project: main sends `session.id` on this channel. This comment said "project", and the
   * campus read it that way, painting each card from a scene keyed by project that no event reached.
   */
  onEvent(callback: (session: string, event: ClaudeEvent) => void): Unsubscribe
  /** A session's phase whenever it changes, tagged with the session, as `onEvent` is. */
  onSessionState(callback: (session: string, state: SessionState) => void): Unsubscribe

  /**
   * Ask about an agent without disturbing the work.
   *
   * Forks the session, so the question never becomes part of the conversation it is asking
   * about. `question: null` asks the standard status question behind a speech bubble.
   */
  askAbout(project: string, agent: string | null, question: string | null): Promise<AsideResult>

  /**
   * The conversation to pick back up, or null if this workspace has none.
   *
   * Null means genuinely nothing to resume. A session that exists but whose transcript could
   * not be read comes back as a `RestoredSession` carrying the reason — never as null, which
   * would offer a blank slate over the top of work that is still there.
   */
  restore(project: string, session: string | null): Promise<RestoredSession | null>

  /**
   * Start a project from `projects/_TEMPLATE/`.
   *
   * Never overwrites: a name that collides opens the project that is already there. Copying the
   * template over an existing plan and progress log would destroy the record the convention
   * exists to keep.
   */
  createProject(name: string): Promise<CreatedProject>

  /**
   * What deleting a project would remove, so a confirmation can name it.
   *
   * Asked *before* anything moves. A confirmation that cannot say what it is about to destroy is
   * a speed bump rather than a safeguard — it trains people to click through it, which is worse
   * than not having one.
   */
  describeProject(id: string): Promise<ProjectContents>

  /**
   * Hide a conversation from the list. Reversible, and it deletes nothing.
   *
   * The transcript belongs to Claude Code, not to this app. Removing somebody's record of what
   * they said because they tidied a list is not a trade we get to make for them.
   */
  closeSession(project: string, id: string): Promise<RosterOutcome>

  /** Move a project out of `projects/` and into `projects/.archived/`. Nothing leaves the workspace. */
  archiveProject(id: string): Promise<RosterOutcome>

  /**
   * Move a project to the OS Trash.
   *
   * The one destructive verb in the app, and it delegates the destruction: `shell.trashItem` is
   * what Finder does, so the recovery path is the one every Mac user already knows and this app
   * grows no undo of its own for the operation where an undo would have to work.
   */
  deleteProject(id: string): Promise<RosterOutcome>

  /**
   * Use a different theme.
   *
   * A pack that fails to load is **reported, never silently swapped** — somebody who installed
   * art and dropped it in is owed an error rather than the drawn cast and a puzzle.
   */
  setTheme(id: string): Promise<void>

  /** Everything typeable after a slash in this workspace: commands and skills. */
  commandsOf(): Promise<CommandList>
  /**
   * Hiring, firing, and sending somebody home.
   *
   * All four write the same files a person writes by hand — there is no parallel list, and
   * `describe()` remains the only thing that says who exists. A rejection comes back as a
   * reason in words, not a thrown error: "there is already an agent called wren" is something
   * to show somebody, and an exception is something to swallow.
   */
  hire(request: HireRequest): Promise<RosterOutcome>
  fireAgent(id: string): Promise<RosterOutcome>
  disableAgent(id: string): Promise<RosterOutcome>
  enableAgent(id: string): Promise<RosterOutcome>
  /** Who is on the bench: disabled, and re-enablable. */
  benched(): Promise<readonly string[]>
  /** Put a skill on the shelf, or take one off. Writes the files a person would write. */
  addSkill(skill: SkillRequest): Promise<RosterOutcome>
  removeSkill(id: string): Promise<RosterOutcome>
  /**
   * What is on the shelf, and how often each has actually been used.
   *
   * Counted from the conversations' own records rather than a counter kept beside them — a
   * counter can disagree with the transcripts, and then the number stops describing anything.
   */
  shelf(project: string): Promise<readonly ShelfRow[]>
  /**
   * What the office remembers.
   *
   * Read on open rather than pushed: `memory/` is written by an agent between turns, so a
   * snapshot taken at boot would be stale by the time anybody looked, and a watcher would be a
   * second thing to keep in step with a directory nothing else reads.
   */
  memory(): Promise<MemoryReport>
  /**
   * What the office decided while you were out.
   *
   * Read on open for `memory`'s reason and one of its own: the gate writes this directory from a
   * *separate process* — the hook, spawned by the CLI — so there is nothing in this process to
   * push from, and a watcher would be a second thing to keep in step with a directory written by
   * something the app does not own.
   */
  decided(): Promise<DecisionReport>
  /**
   * What each dispatch changed, most recent first.
   *
   * Read on open like `memory`, and for a sharper reason: the record is written when a run ends,
   * so anything pushed live would be a list that is complete for finished work and silently
   * short for work still going. Read at the moment somebody asks, and each row says which of the
   * three it is — finished, still going, or a record that could not be read.
   */
  changed(): Promise<readonly DispatchRow[]>
  /**
   * Find something across this workspace — memory, projects, the dispatch ledger, conversations.
   *
   * Returns `Searched` whole rather than a list of hits, because `blind` is not decoration: a
   * source that could not be opened has to reach the screen, or "nothing found" is a claim about
   * text nobody read.
   */
  search(query: string): Promise<Searched>
  /**
   * Put back what one dispatch changed.
   *
   * Returns what happened rather than a boolean, and the failure carries a **list** of reasons:
   * an undo is all-or-nothing, so somebody who fixes the first refusal and clicks again should
   * not then discover the second. Nothing is written unless every file resolves.
   */
  undo(dispatch: string): Promise<UndoResult>
  /**
   * Copy the project template into this workspace, when it has none.
   *
   * Only reachable from the first-run panel, and only when the template is absent — the office
   * does not write into a directory somebody chose with `OFFICE_WORKSPACE` unless asked. This is
   * the asking.
   */
  addProjectTemplate(): Promise<{ readonly ok: boolean; readonly reason: string | null }>
  /**
   * What runs on a hook in this workspace, and whether it is actually there to run.
   *
   * Read on open, like `memory`, and for a stronger reason: the two halves of the answer are a
   * settings file and a directory, both of which a person edits in another window while this app
   * is running. A value taken at boot would be a claim about a workspace that has since changed,
   * on the surface whose subject is whether something is running.
   */
  hooks(): Promise<HooksReport>
  /**
   * How full the plan's allowance is.
   *
   * Read on open rather than pushed, and the reading it returns is explicitly **not live**: it
   * arrives on the first event of a run, so the freshest value that can exist is the last run's.
   * Pushing it would suggest otherwise. `PlanReading` carries when it was taken and says so.
   *
   * Answers in every state, including the two where there is no number — which is the difference
   * between this and `planWarning`, whose silence below its threshold is the right behaviour for
   * an interruption and useless to somebody asking.
   */
  planUsage(): Promise<PlanReading>
  /**
   * Employees a colleague maintains, and whether our copy is still theirs.
   *
   * `look` decides whether the sources are actually opened. Off, every row reads *not checked*,
   * which is the honest resting state — checking clones repositories, and a panel that did that
   * on every open would be a panel nobody leaves open. On, it is one clone per distinct source.
   */
  maintainedElsewhere(look: boolean): Promise<readonly MaintainedRow[]>
  /** What a source is offering, without hiring anybody. */
  offeredBy(at: string, kind: SourceKind): Promise<OfferedFromSource>
  /** Hire one of them. The content is re-read now, so the recorded digest is of what was written. */
  hireFromSource(at: string, kind: SourceKind, id: string): Promise<RosterOutcome>
  /**
   * Replace our copy with theirs.
   *
   * Refuses unless it is still safe *at this moment*. The panel hides the button when it is not,
   * but a panel drawn ninety seconds ago is a courtesy and never a guarantee — somebody may have
   * edited the file since, and this is the write that would lose it.
   */
  takeTheirVersion(id: string): Promise<RosterOutcome>
  /**
   * Add a server to this workspace's `.mcp.json`.
   *
   * Writes configuration and nothing else. It is not a login, it starts nothing, and the reply
   * says so — see `whatWritingDoes` in `shared/connector.ts`.
   */
  connectService(request: ConnectRequest): Promise<RosterOutcome>
  /** Remove one this workspace declares. A server from the machine-wide config is not ours to touch. */
  disconnectService(name: string): Promise<RosterOutcome>
  /** The names in this workspace's own `.mcp.json`, so the panel can tell them from inherited ones. */
  projectServers(): Promise<readonly string[]>
   /**
   * What the staff can actually reach, and whether it is actually reachable.
   *
   * Three files nobody reads together — each employee's `tools:`, the MCP servers this machine
   * declares, and the permission rules deciding whether any of it runs — reported as the gap
   * between them. **Nothing that comes out of here is a credential**: only key *names* are read
   * from env and headers, never a value, and URLs are cut at the first `?`.
   */
  capabilitiesOf(): Promise<CapabilityReport>
  /**
   * Look at the machine again, not just at the workspace.
   *
   * `describe()` rescans the workspace — agents, skills, projects. It does **not** re-read
   * whether `claude` is on the PATH or whether this directory has been trusted, both of which
   * are checked once at boot. Those are exactly the two things somebody has just gone and fixed
   * when they press "Look again", so a button wired to `describe()` would tell them nothing had
   * changed while they watched it change.
   *
   * Separate from `describe()` rather than folded into it because this walks the filesystem
   * looking for a binary, and `describe()` runs on every roster write and every file-watch event.
   */
  recheck(): Promise<OfficeSnapshot>
  /**
   * What is on disk, what can leave the machine, and the exact text of the last prompt sent.
   *
   * `project` decides whose last prompt is reported — the assembled string belongs to a
   * conversation, not to the app.
   */
  privacyOf(project: string): Promise<PrivacyReport>
  /**
   * What a `git push` from this workspace would carry, and what it would leave behind.
   *
   * Asked of git rather than of a list here — see `shared/sharing.ts`. Separate from
   * `privacyOf` because it can fail on its own: a workspace with no git is a perfectly good
   * workspace, and it must not take the disk measurements down with it.
   */
  whatWouldBeShared(): Promise<readonly SharingRow[]>

  /**
   * The music.
   *
   * Every one of these is inert until an account is connected: `musicPlayer()` answers
   * `disconnected` without making a request, and the rest refuse for the same reason. That is
   * the plan's D3 condition 1, expressed as an API rather than as a promise — a renderer cannot
   * cause a network request by calling these before `musicConnect()` has succeeded.
   */
  musicPlayer(): Promise<Player>
  /** Runs the browser sign-in. Resolves when the round trip finishes, or says why it did not. */
  musicConnect(): Promise<MusicConnection>
  /** Forgets the account and deletes the stored token. */
  musicDisconnect(): Promise<void>
  musicCommand(what: MusicCommand, deviceId?: string): Promise<string | null>
  musicTransfer(deviceId: string, play: boolean): Promise<string | null>
  musicSearch(query: string): Promise<readonly Track[]>
  musicPlayTrack(uri: string, deviceId?: string): Promise<string | null>
  /** The client id, network switch, redirect URI, hosts and scopes this machine is set up with. */
  musicSetup(): Promise<MusicSetup>
  musicSetClientId(clientId: string): Promise<void>
  /**
   * The master switch, honoured in main.
   *
   * Not a renderer preference. The main process reads it on every request, so turning it off
   * stops the next call rather than the next restart — a toggle main does not honour would be a
   * claim rather than a control.
   */
  musicSetNetwork(allowed: boolean): Promise<void>
  /** Delete one store. Refuses anything that is part of the office rather than your work. */
  forget(path: string): Promise<RosterOutcome>
  /**
   * Dispatches this workspace sent and never saw the end of.
   *
   * Read from the ledger on disk, so it survives the app dying — which is the only reason it
   * exists. Asked once when the window opens and again after each verb, rather than pushed: a
   * dispatch becomes unfinished by *nothing happening*, and there is no event for that.
   */
  unfinishedWork(): Promise<UnfinishedReport>
  /**
   * Record that nobody is waiting for one any more.
   *
   * Appends an outcome; it deletes nothing and stops nothing. If the agent is somehow still
   * alive out there it carries on — this is the office saying it is no longer holding the card,
   * which is a claim about us and not about the work.
   */
  dropDispatch(id: string): Promise<RosterOutcome>
  /**
   * The brief to re-send, with the previous failure carried in it verbatim.
   *
   * Composes and returns. **It dispatches nothing** — the decision to spend a run stays with
   * whoever is looking at the card, and the composed text lands in the composer so it can be
   * read before it is sent.
   */
  retryDispatch(id: string): Promise<{ readonly brief: string } | { readonly problem: string }>
  /**
   * Tool calls waiting for somebody to say yes. Oldest first — that one is closest to timing out.
   *
   * Subscribing also asks for the set as it stands, so a call held since before this window opened
   * still reaches the callback. See `resend` in `main/approvals.ts`.
   *
   * **Subscribe once per page.** The answer goes to every subscriber, so a second subscription
   * pushes an unchanged set to the first, which rebuilds cards somebody may be reaching for —
   * the failure the watcher's push-only-on-change rule exists to prevent.
   */
  onApprovals(callback: (requests: readonly PendingApproval[]) => void): () => void
  /**
   * Fires when a project's conversations change — one created, a title landing, `current` moving.
   *
   * `onOffice` covers agents, skills and projects; `onSessionState` covers one session's phase.
   * Neither fires for the list itself, so before this the project/session control was the only
   * navigation surface in the app that could silently go stale.
   */
  onSessions(callback: (list: SessionList) => void): () => void
  /** Fires when a conversation changes mode. Never fires for a mode that did not move. */
  onSessionMode(callback: (change: ModeChange) => void): () => void
  /**
   * Move a conversation to another mode.
   *
   * **This is the only way a mode changes.** The manager cannot end its own intake — that is the
   * whole feature, and the reason the mode is held here rather than asked for in a prompt.
   */
  setMode(project: string, mode: Mode): Promise<SessionState>
  /**
   * Answer one.
   *
   * `reason` reaches the **model**, not only the person: a denial an agent can read is one it
   * can work around, and one it cannot read is a wall it walks into again next turn.
   */
  decide(sessionId: string, toolUseId: string, allow: boolean, reason?: string): Promise<void>
  /** The dials on a project's conversation. */
  controlsOf(project: string): Promise<Controls>
  /**
   * Returns what is actually in force, which is not always what was asked for: a value the
   * installed CLI does not recognise is dropped and named in `unknown` rather than being sent
   * to a process that would refuse to start. The UI shows what came back, never what it sent.
   */
  setControls(project: string, controls: Controls): Promise<ControlsResult>
  /** Every conversation this project has had, newest first, with the current one marked. */
  sessionsOf(project: string): Promise<readonly SessionInfo[]>
  /**
   * Show a different conversation, or start one.
   *
   * `id` null starts a new conversation in this project. Returns the session now being shown,
   * so the renderer can key its transcript and its floor to it.
   */
  openSession(project: string, id: string | null): Promise<SessionInfo>

  /**
   * Open a conversation with one employee.
   *
   * Their own resumable session, separate from the manager's, and it never enters it. Until this
   * existed you could not talk to an agent at all — `askAbout` forks the *manager's* session and
   * asks the manager a question, and the prompt it sends says outright: *"You cannot see inside
   * a subagent while it runs."* So the answer to "what did the tester find?" was the manager's
   * recollection of the tester's report.
   *
   * **An employee answers; it does not go and do.** `Task`, `Write` and `Edit` are withheld for
   * the life of the session — the same mechanism intake uses, because standing order 1 says only
   * the user and the manager originate work. `Read`, `Grep` and `Glob` stay, which is the point:
   * they can go and look, and a fresh reading beats a recollection.
   */
  openAgentSession(project: string, agent: string): Promise<SessionInfo>

  /**
   * The last thing this employee actually did, read from their own record.
   *
   * Null means they have not been dispatched in this project — genuinely nothing to show. A run
   * that exists and could not be read comes back as `EmployeeWork` carrying the reason, never
   * as null, because "they did nothing" is a claim about somebody's work.
   */
  workOf(project: string, agent: string): Promise<EmployeeWork | null>

  /**
   * A project's tasks and how they stand. Listing runs nothing and costs nothing.
   */
  tasksOf(project: string): Promise<TaskReport>
  /**
   * Run the checks.
   *
   * `only` runs the one task a person pressed; null runs everything the workspace already permits.
   * `force` is only ever true because a person clicked a specific task having seen its specific
   * command — and it still cannot override a rule that says no. `ClickedTask` carries what makes
   * that true: the row pressed, not a number several rows can share.
   */
  verify(project: string, only: ClickedTask | null, force: boolean): Promise<TaskReport>
  /**
   * Turn the voice on or off.
   *
   * Off by default, and off means **nothing is spent**: deciding whether a turn is worth
   * mentioning is a judgement call that runs on Claude, so a voice nobody asked for would be a
   * charge nobody asked for. Text is always there either way; speech is the optional half.
   */
  setVoice(on: boolean): Promise<void>
  /** Something worth saying happened. Only ever fires while the voice is on. */
  onSpeak(callback: (utterance: Utterance) => void): Unsubscribe

  /** Can this machine turn speech into text yet, and if not, which half is missing? */
  dictation(): Promise<DictationSetup>
  /**
   * One recording, as a complete 16 kHz mono WAV. Returns what was said.
   *
   * The audio never leaves this machine: it is written to a temp file, read by a local program,
   * and deleted. No key, no account, no per-minute cost, and no sentence you spoke travelling
   * anywhere you did not send it.
   */
  transcribe(wav: ArrayBuffer): Promise<Dictated>
  /**
   * Fetch the speech model into the office's own directory.
   *
   * 148MB, once. The app's errand rather than the person's — but the *binary* is not this, and
   * on macOS cannot be: whisper.cpp ships no prebuilt CLI for it, so that half is one Homebrew
   * command the setup screen names rather than pretends to have done.
   */
  fetchDictationModel(): Promise<{ ok: boolean; reason?: string }>
  /**
   * Install the transcriber, from inside the app.
   *
   * A desktop app that answers a button press with "open a terminal and run this" has documented
   * the feature rather than shipped it. Runs the command the setup panel names.
   */
  installDictation(): Promise<{ ok: boolean; reason?: string }>
  /**
   * Ask macOS for the microphone, and report what it said.
   *
   * Separate from `getUserMedia` because the two refusals are different: this one is the
   * operating system, is remembered, and cannot be undone from inside this app — the person has
   * to go to System Settings. Saying "permission denied" without saying *whose* permission sends
   * somebody looking in the wrong place.
   */
  microphoneAccess(): Promise<{ granted: boolean; reason?: string }>
}

/**
 * Whether the office can hear you.
 *
 * Three states rather than a boolean, because "no program" and "no model" are different problems
 * with different fixes — and a setup screen that cannot tell you which one you have is a setup
 * screen that makes you guess.
 */
export interface DictationSetup {
  readonly ready: boolean
  /** Present when it is not ready: which half is missing, in words. */
  readonly missing?: 'binary' | 'model'
  readonly detail?: string
  /** What to run to fix it, when there is a single honest answer. */
  readonly fix?: string
}

export interface Dictated {
  readonly ok: boolean
  /** What you said. Empty when you did not say anything, which is not a failure. */
  readonly text: string
  readonly reason?: string
}

export type CreatedProject =
  | { readonly state: 'created'; readonly id: string }
  /** A project by that name is already here. Open it rather than making a second one. */
  | { readonly state: 'exists'; readonly id: string }
  | { readonly state: 'failed'; readonly cause: string }

/**
 * Something you can type after a slash.
 *
 * Commands and skills together, because from the composer they are the same gesture — the CLI
 * resolves `/record-progress` whether that name belongs to `.claude/commands/` or
 * `.claude/skills/`. Which of the two it is stays visible, because a skill behaves differently
 * once invoked: it becomes a `Skill` tool call the floor can act on, and a command does not.
 */
export interface Invocable {
  /** What you type after the slash. */
  readonly name: string
  readonly description: string
  /** `null` when the author never said what arguments it takes — not the same as "none". */
  readonly argumentHint: string | null
  readonly kind: 'command' | 'skill'
  /**
   * True when a command of this name shadows a skill of the same name.
   *
   * Measured against the real CLI: a project command wins. Surfaced because the two do
   * different things when invoked, so somebody typing the name is getting the one they may not
   * expect.
   */
  readonly shadowsSkill?: boolean
}

export interface CommandList {
  readonly items: readonly Invocable[]
  /**
   * Anything discovery could not read.
   *
   * A commands directory that exists and cannot be opened is **not** a workspace with no
   * commands, and the menu must not present it as one.
   */
  readonly problems: readonly Problem[]
}

/** One skill on the shelf, as the office read it out of the file's own frontmatter. */
export interface SkillInfo {
  readonly id: string
  readonly name: string
  readonly description: string
}

/** What you need to say to put a skill on the shelf. */
export interface SkillRequest {
  readonly id: string
  readonly description: string
  readonly body: string
}

export type SourceKind = Source['kind']

/**
 * One employee a colleague maintains, as the panel shows them.
 *
 * `standing` carries both facts; see `shared/hired-from.ts` for why it is two fields and not one
 * status word. `detail` is the git or errno text behind a `there` that is not a hash — shown, not
 * summarised, because *"could not be reached"* and *"Permission denied (publickey)"* send a person
 * to two different places.
 */
export interface MaintainedRow {
  readonly id: string
  readonly source: Source
  readonly hiredAt: string
  readonly standing: Standing
  readonly detail: string | null
}

/** Somebody a source is offering, and whether this office has room for the name. */
export interface OfferedRow {
  readonly file: string
  readonly id: string
  readonly description: string
  /** True when an employee of that name is already here. Shown before the click, not after. */
  readonly taken: boolean
}

/** Absent is not empty here either: a source that would not open is a problem, not no colleagues. */
export type OfferedFromSource =
  | { readonly offered: readonly OfferedRow[] }
  | { readonly problem: string }

/** What you need to say to hire somebody. */
export interface HireRequest {
  readonly id: string
  readonly description: string
  /** `null` inherits every tool, which is what omitting the field means in an agent file. */
  readonly tools: readonly string[] | null
  readonly model: string | null
  readonly prompt: string
}

/** One row of the shelf report: what it is, how used, and whether it is still there. */
export interface ShelfRow {
  readonly id: string
  readonly count: number
  readonly lastUsed: string | null
  /** False for a skill that was used and has since been removed. Shown, not edited out. */
  readonly onShelf: boolean
}

/** What is in a project, so a confirmation can name it rather than say "are you sure". */
export interface ProjectContents {
  readonly path: string
  readonly files: number
  /** True when it could not be read. **Not** the same as an empty project. */
  readonly unreadable: boolean
}

export type RosterOutcome =
  | {
      readonly ok: true
      /**
       * The office as it is *after* this write, when the handler rescanned before answering.
       *
       * Not a convenience. The renderer also learns about changes from the `office` broadcast,
       * and the reply and the broadcast are two messages on two channels with no ordering
       * between them — so redrawing a panel on the reply could pair a pre-write staff list with
       * a post-write bench list, and draw one person at a desk and on the bench at once.
       *
       * Waiting for a broadcast instead does not fix it: eight places send one, most built from
       * a `workspace` the rescan has not replaced yet, so a cost update landing mid-write
       * satisfies the wait with the stale snapshot. The handler is holding the right answer at
       * the moment it replies; carrying it here means there is nothing to correlate and no
       * timeout to choose.
       */
      readonly office?: OfficeSnapshot
    }
  /** Why not, in words for the person who asked. Never an exception, never a code. */
  | { readonly ok: false; readonly reason: string }
/**
 * The capability survey, flattened for the wire.
 *
 * Deliberately not the raw `Capabilities` — that type carries `Employee` objects and file paths
 * from the main process, and the renderer needs neither. What crosses is what can be shown.
 */
export interface CapabilityReport {
  readonly staff: readonly {
    readonly id: string
    /** `declared`, `inherited` or `none`. Inherited is not none, and the difference matters. */
    readonly access: string
    readonly tools: readonly string[]
    /** Tools named `mcp__x__y` where no server `x` is configured. A dispatch that cannot work. */
    readonly danglingMcpTools: readonly string[]
    /**
     * Built-in tools this workspace will refuse.
     *
     * The same fault one layer down from `danglingMcpTools`, and it shipped: `WebFetch` and
     * `WebSearch` sat in five agents' tool lists and in neither `allow` nor `deny`, so both were
     * unlisted and refused — while the roster printed them under all five names.
     */
    readonly unreachableTools: readonly string[]
  }[]
  readonly servers: readonly {
    readonly name: string
    readonly transport: string
    readonly scope: string
    /**
     * What the CLI reported when it last tried, or `configured` if it has not.
     *
     * `configured` is not `connected` and the UI must not conflate them — a server declared in
     * a file and a server that answered are different claims.
     */
    readonly status: string
  }[]
  /** Where the servers were read from, including files that were not there. */
  readonly sources: readonly { readonly path: string; readonly state: string }[]
  readonly permissions: {
    readonly allow: number
    readonly deny: number
    /** False when the workspace is untrusted, at which point the counts above are decoration. */
    readonly inForce: boolean
  }
  readonly problems: readonly Problem[]
  readonly scannedAt: string
}
/**
 * A dispatch this workspace sent and never saw the end of.
 *
 * Shaped where it is written down rather than restated here, exactly as `PrivacyReport` is —
 * type-only, so nothing from `main/` reaches the renderer at runtime, and there is one
 * definition of a ledger row rather than two that can drift.
 */
export interface UnfinishedReport {
  /** Sent, with no outcome recorded. Oldest first, because that one has waited longest. */
  readonly entries: readonly Dispatch[]
  /**
   * Ledger lines that could not be read.
   *
   * Carried across the wire and shown, never filtered out on the way. A line we cannot parse may
   * be the record of the very dispatch somebody is looking for, and dropping it would turn
   * "we cannot read this" into "this never happened" — standing order 4, on the one screen
   * built to answer "what was I in the middle of?".
   */
  readonly torn: readonly TornLine[]
  /**
   * Set when the ledger itself could not be read.
   *
   * **Not** the same as an empty list, and the card says so in words. A workspace that has never
   * dispatched anything and a workspace whose ledger will not open look identical from a count.
   */
  readonly problem: string | null
}

/**
 * What a person can do about an unfinished dispatch.
 *
 * Three verbs and no fourth. There is deliberately no default and nothing happens on a timer:
 * a card nobody answered must stay a card, because every one of these either re-opens a
 * conversation, spends tokens, or writes off work somebody was waiting for.
 */
export type UnfinishedVerb =
  /** Re-open the conversation that sent it. Reads; starts nothing. */
  | 'resume'
  /** Compose the re-dispatch brief, carrying the failure. Fills the composer; sends nothing. */
  | 'retry'
  /** Record that nobody is waiting for it any more. Writes a line; deletes nothing. */
  | 'drop'

/** A tool call held at the gate. */
export interface PendingApproval {
  readonly sessionId: string
  /**
   * Which project this call is blocking, or `null` when the office cannot say.
   *
   * Filled in main from the session registry, which is the only place that knows: a
   * `SessionRecord` carries its `project`, and the gate's request carries only a session id.
   *
   * The renderer used to reconstruct this from a map it builds while opening projects, and that
   * map only ever holds the project you are looking at — `watchSessions` returns early on
   * `list.project !== active`. So a held call in an office you had not opened was attributed to
   * nothing, which is precisely the office the campus exists to tell you about.
   *
   * `null` rather than a guess. A session the registry has not recorded yet is one the office
   * genuinely cannot place, and counting it against whichever project happens to be open would
   * put somebody else's held call on your card.
   */
  readonly project: string | null
  readonly toolUseId: string
  readonly tool: string
  /** Verbatim from the CLI. What the card shows must be what is about to run. */
  readonly input: Record<string, unknown>
  readonly askedAt: string
  /**
   * How long the gate will hold this before refusing it, in milliseconds — or `null`.
   *
   * The gate writes it, because the gate is the only thing that knows: its wait defaults to four
   * minutes and `OFFICE_APPROVAL_WAIT_MS` may lower it, so a constant on this side would
   * disagree with the running hook the moment anybody set that variable.
   *
   * With `askedAt` it makes a deadline, which is what the card was missing: a person could read
   * a held command carefully and click into a request that had already been refused, with
   * nothing having said a timer was running. `null` means the office does not know, and it then
   * says nothing rather than counting down from a guess.
   */
  readonly waitMs: number | null
  /**
   * Whose command is blocked — an employee's name, or `null` for the manager's own.
   *
   * Absence is a positive answer, not a gap: the CLI puts `agent_type` on every subagent tool
   * call and on none of the manager's. Measured.
   *
   * The approval card names them — *"reviewer is waiting on you"* — because on a floor with
   * seven people on it, "one call is waiting" does not say whose desk is stopped.
   *
   * This comment used to say the floor drew the waiting desk from this field. It did not: the
   * field was built in main, sent across, and read by nothing, on either surface. Two careful
   * notes in two files described a feature neither of them had. Found by
   * `scripts/unread-fields.mjs`, which is what that script is for.
   */
  readonly agent: string | null
}

/**
 * What the office actually took.
 *
 * `unknown` names anything that was refused. Empty on every ordinary set — it is there for the
 * case where a workspace carries a setting from a newer CLI than the one installed, which the
 * office must report rather than silently ignore.
 *
 * `ignored` is the other half, and the distinction is not pedantry. A value the CLI **would**
 * accept and then drops — `manual` and `auto` under `--print` — is not unrecognised, so telling
 * the user "the installed claude does not recognise that" would be a second false statement
 * covering the first. It has to be reported as what it is: understood, and inert here.
 */
export interface ControlsResult {
  readonly controls: Controls
  readonly unknown: readonly string[]
  readonly ignored: readonly string[]
}

/** Transport. A closed set, so a renderer cannot invent a verb main does not implement. */
export type MusicCommand = 'play' | 'pause' | 'next' | 'previous'

/**
 * Whether connecting to Spotify worked, and what stopped it.
 *
 * Named because it was written out inline in two places — here and in `views/music.ts`'s
 * `MusicBridge` — which is two declarations of one contract and nothing to make them agree.
 */
export interface MusicConnection {
  readonly ok: boolean
  readonly problem: string | null
}

/**
 * What the master network switch is set to — and `unreadable` is a real third answer.
 *
 * It was a boolean, and the read fell back to `true` on any failure. That made "never set" and
 * "set to off, but the file is torn or locked" the same answer, and the answer was the permissive
 * one: somebody who switched the network off and then lost power mid-write came back to an app
 * that reached out again, with the panel showing `on` because on is what it now was.
 *
 * `absent is not empty` (CLAUDE.md, standing order 4) is the general form. `ledger.ts` gets this
 * right for the same reason — `ENOENT` means no file yet, and every other error means a file we
 * could not read, which is not the same thing and must not be rounded to it.
 */
export type NetworkSetting = 'on' | 'off' | 'unreadable'

export interface MusicSetup {
  /** Empty until somebody registers a Spotify app and pastes the id. Never shipped in the repo. */
  readonly clientId: string
  /** The master switch. Only `on` permits a request; see {@link NetworkSetting}. */
  readonly networkAllowed: NetworkSetting
  /** Printed in the panel so it can be pasted into Spotify's dashboard exactly. */
  readonly redirectUri: string
  /**
   * Every host the feature can reach.
   *
   * The privacy panel does print every one of them — from `SPOTIFY_HOSTS` in main, not from this
   * field, which has no reader. The comment used to say "the privacy panel prints this", which
   * would have persuaded anyone tidying up that deleting it breaks the panel. It does not; the
   * panel is correct by a different route. Kept because the setup panel is the place this
   * belongs if it is ever shown there.
   */
  readonly hosts: readonly string[]
  /** The scopes asked for, so a person can read what they are agreeing to before they agree. */
  readonly scopes: readonly string[]
}

/** Channel names. Here rather than as string literals, so main and preload cannot drift. */
export const CHANNEL = {
  describe: 'office:describe',
  musicPlayer: 'music:player',
  musicConnect: 'music:connect',
  musicDisconnect: 'music:disconnect',
  musicCommand: 'music:command',
  musicTransfer: 'music:transfer',
  musicSearch: 'music:search',
  musicPlayTrack: 'music:play-track',
  musicSetup: 'music:setup',
  musicSetClientId: 'music:set-client-id',
  musicSetNetwork: 'music:set-network',
  office: 'office:changed',
  sessionList: 'session:list-changed',
  sessionMode: 'session:mode',
  setMode: 'session:set-mode',
  sprites: 'office:sprites',
  send: 'session:send',
  interrupt: 'session:interrupt',
  event: 'session:event',
  state: 'session:state',
  aside: 'agent:aside',
  restore: 'session:restore',
  createProject: 'project:create',
  describeProject: 'project:describe',
  closeSession: 'session:close',
  archiveProject: 'project:archive',
  deleteProject: 'project:delete',
  commands: 'commands:list',
  hire: 'roster:hire',
  fireAgent: 'roster:fire',
  disableAgent: 'roster:disable',
  enableAgent: 'roster:enable',
  benched: 'roster:benched',
  addSkill: 'skills:add',
  removeSkill: 'skills:remove',
  shelf: 'skills:shelf',
  memory: 'memory:read',
  decided: 'approvals:decided',
  changed: 'changes:read',
  search: 'workspace:search',
  undo: 'changes:undo',
  addTemplate: 'projects:add-template',
  hooks: 'hooks:read',
  planUsage: 'plan:usage',
  maintainedElsewhere: 'hired-from:list',
  offeredBy: 'hired-from:browse',
  hireFromSource: 'hired-from:hire',
  takeTheirVersion: 'hired-from:take',
  connectService: 'connector:add',
  disconnectService: 'connector:remove',
  projectServers: 'connector:list',
  whatWouldBeShared: 'sharing:read',
  capabilities: 'office:capabilities',
  recheck: 'office:recheck',
  privacy: 'office:privacy',
  forget: 'office:forget',
  controlsOf: 'controls:read',
  approvals: 'approvals:pending',
  approvalsResend: 'approvals:resend',
  decide: 'approvals:decide',
  unfinished: 'ledger:unfinished',
  dropDispatch: 'ledger:drop',
  retryDispatch: 'ledger:retry',
  setControls: 'controls:set',
  work: 'agent:work',
  theme: 'office:theme',
  sessions: 'session:list',
  openSession: 'session:open',
  openAgentSession: 'session:open-agent',
  tasks: 'tasks:list',
  verify: 'tasks:verify',
  voice: 'voice:set',
  speak: 'voice:speak',
  dictation: 'voice:dictation',
  transcribe: 'voice:transcribe',
  dictationModel: 'voice:dictation-model',
  dictationInstall: 'voice:dictation-install',
  micAccess: 'voice:mic-access',
} as const

/** Exposed on `window` by the preload. */
export const BRIDGE_KEY = 'office'

declare global {
  interface Window {
    readonly office: OfficeApi
  }
}
