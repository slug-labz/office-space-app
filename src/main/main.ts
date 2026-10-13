/**
 * The Electron main process — the only part of Office Space with hands.
 *
 * It reads the workspace, paints the cast, spawns `claude`, and forwards what comes back. The
 * renderer does none of those things and cannot: see `src/shared/ipc.ts` for why the boundary
 * is drawn where it is.
 */

import { readControls, type Controls, type PermissionMode } from '../shared/controls.js'

/**
 * Boot phase markers for `scripts/boot-time.mjs`. **Absolute, deliberately.**
 *
 * The first version of this subtracted a `BOOT_STARTED = performance.now()` written between the
 * imports, and called the result "since main's own code started". It was not. **ESM hoists
 * every import above every statement**, so all seventy-odd imports and their whole transitive
 * graph evaluate *before* that line runs. A probe timing `await import()` of the built main under
 * Electron put that at 71 and 87 ms in the #231 review, at load average 11–14, and at 21–24 ms over
 * five runs of the author's own at load 3.5. Both probes ran before #231 was rebased onto
 * `e457bee`, which changed `src/main/claude/run.ts`, a file main loads. On `cb86000`, the
 * independent check of #231 measured 24.4–51.1 ms, median 27.2, at load 4.2–5.2. Why the figures
 * differ, whether load or code, was not measured. A clock placed to look early was starting late,
 * and every phase came out flattering by that much.
 *
 * `performance.now()` is reported unsubtracted instead. Node documents its zero as the start of the
 * process, and the #231 review measured it landing about 30 ms after the Electron binary is spawned,
 * so the module graph and most of Electron's startup are inside the number, and nothing between that
 * zero and the first mark is subtracted away.
 *
 * Gated behind `OFFICE_BOOT_TIMING=1` and silent in every ordinary run.
 */
const TIMING = process.env['OFFICE_BOOT_TIMING'] === '1'

/**
 * True when a tool is driving this app rather than a person.
 *
 * Read in two places, and both are about staying out of somebody's way: the Dock icon at
 * `app.whenReady`, and the window below, which **shows without taking the keyboard**.
 *
 * The Dock note explains why the first exists. The second has the same cause and cost one
 * worse outcome: an instrument booted the app to read a screen, the window came up focused,
 * and the keystrokes the person at the keyboard was typing went into its composer. A
 * development instrument may not be indistinguishable from a bug in the product it is
 * checking -- and it certainly may not eat the input of the person checking it.
 */
const HEADLESS = process.env['OFFICE_HEADLESS'] === '1'
/** One line per phase, on stdout, parsed by the script. Nothing reads these in a normal run. */
function mark(phase: string): void {
  if (TIMING) process.stdout.write(`boot-timing ${phase} ${performance.now().toFixed(2)}\n`)
}
import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  screen,
  shell,
  session as electronSession,
  systemPreferences,
} from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import { discoverWorkspace, findManager, type Problem, type Workspace, watchWorkspace } from './workspace.js'
import { initialControls, ManagerSession } from './session.js'
import { serial } from './serial.js'
import { askAside, statusQuestionFor, STATUS_QUESTION } from './claude/aside.js'
import {
  conversationWith,
  loadRegistry,
  mayWriteRegistry,
  mergeNewest,
  registryPath,
  registrySaveProblem,
  resumable,
  RegistryAppeared,
  saveRegistry,
  shownSessions,
  skippedRowsProblem,
  titleFrom,
  upsert,
  writtenDespite,
  type SessionRecord,
} from './registry.js'
import { readTranscript } from './transcript-store.js'
import { readHooks } from './hooks.js'
import { readDecided } from './decided.js'
import { readMemory } from './memory.js'
import {
  browseSource,
  checkOnThem,
  digest as digestOfAgentFile,
  hireFrom,
  ourCopy,
  readFromSource,
  recordedHires,
  takeTheirs,
} from './hired-from.js'
import { saidPlainly, standingOf, updateIsSafe, type Found } from '../shared/hired-from.js'
import { connect, disconnect, projectServers } from './connectors.js'
import { whatWouldBeShared, type SharingRow } from './sharing.js'
import { couldNotLook, nightLede, tally, type DecisionReport, type Tally } from '../shared/decisions.js'
import type { HooksReport } from '../shared/hooks.js'
import type { MemoryReport } from '../shared/memory.js'
import type { MaintainedRow, OfferedFromSource } from '../shared/ipc.js'
import { untrustedMessage, workspaceTrust } from './trust.js'
import { appQuarantine, quarantineMessage } from './quarantine.js'
import { billingRoute, billingWarning } from './auth.js'
import { policyProblem, readPolicy, shippedAllowRules } from './permissions.js'
import { archiveProject, deleteProject, describeProject } from './removal.js'
import { planWarning, type PlanReading } from '../shared/plan-usage.js'
import { discoverCommands } from './commands.js'
import { missingMessage, resolveClaude } from './claude-path.js'
import { digest } from './voice/digest.js'
import { Recorders } from './voice/recorders.js'
import { DOWNLOAD_SUFFIXES, fetchModel, findWhisper, HOSTS as SPEECH_HOSTS, installWhisper, MODEL_FILE, MODEL_URL, transcribe } from './voice/transcribe.js'
import { createProject, discoverProjects, projectBlock, type Project, type ProjectScan, PROJECTS_DIR, TEMPLATE } from './projects.js'
import { latestFor, scanSubagents } from './subagents.js'
import { checkPressed, checkProject, type TaskReport } from './harness.js'
import { proceduralTheme, PROCEDURAL_THEME_ID } from '../shared/theme/procedural.js'
import { scanThemes, type ThemeDescriptor } from '../shared/theme/registry.js'
import {  sheetIndexFor } from '../shared/theme/slicing.js'
import { parseTranscript, type TimelineEntry } from '../shared/transcript/parse.js'
import { addProjectTemplate, resolveWorkspaceRoot } from './workspace-root.js'
import { readInstructions, readGate } from './instructions.js'
import { searchWorkspace } from './search.js'
import { nothingWasSearched, type Searched } from '../shared/search.js'
import type { GateState } from '../shared/gate.js'
import {
  applyReconcile,
  planReconcile,
  readReceipt,
  reconcileProblems,
  summarise,
  writeReceipt,
  type ShippedManifest,
} from './reconcile.js'
import { route, sessionOf } from './routing.js'
import {
  CHANNEL,
  OFFICE_PROJECT,
  type AsideResult,
  type ProjectContents,
  type CommandList,
  type CapabilityReport,
  type ControlsResult,
  type RosterOutcome,
  type ShelfRow,
  type Invocable,
  type CreatedProject,
  type OfficeSnapshot,
  type ProjectInfo,
  type RestoredSession,
  type SessionInfo, 
  type EmployeeWork,
  type SessionState,
  type SpriteSheet,
  type StaffMember,
  type UnfinishedReport,
  type Utterance, type MusicSetup, type DictationSetup, type Dictated } from '../shared/ipc.js'
import type { ClaudeEvent } from './claude/stream.js'
import { disable, disabled as benched, enable, fire, hire } from './roster.js'
import { addSkill, removeSkill, shelfReport, skillUse } from './skills.js'
import { stopAll } from './children.js'
import { reapOrphans, recordOrphansIn } from './orphans.js'
import { recordChanges, readChanges, listChanges } from './changes.js'
import { undoDispatch } from './undo.js'
import type { UndoResult } from '../shared/undo.js'
import { newestSentFirst, rowsFor, type DispatchRow, type SentDispatch } from '../shared/changes-view.js'
import { changesFor, ownWriteId, whatIsNotShown, type ToolCall } from '../shared/changes.js'
import { isDelegationTool } from '../shared/delegation.js'
import { nudgeFor } from '../shared/nudge.js'
import { reapMessage } from '../shared/orphans.js'
import { mcpToolsWithoutServer, scanCapabilities, toolsWithoutPermission } from './capabilities.js'
import {
  Decided,
  answerFromPolicy,
  decide,
  approvalRecord,
  type ApprovalRecord,
  forwardInOrder,
  pending,
  type ApprovalRequest,
  unwrittenProblem,
  watchApprovals,
  pendingFrom,
} from './approvals.js'

// ── the dispatch ledger (S5) ───────────────────────────────────────────────────────────────
// One import, one call in `onEvent`, one block of handlers in `registerHandlers`. Everything
// this feature knows lives in `ledger.ts`; these three sites are the whole of its footprint
// here, deliberately, because this file has more authors than any other in the repo.
import {
  loadLedger,
  record as recordDispatchEvent,
  recordOutcome,
  retryBrief,
  unfinished,
  type Dispatch,
} from './ledger.js'
// ───────────────────────────────────────────────────────────────────────────────────────────
import { FIRST_MODE, LEGACY_MODE, isMode } from '../shared/session/mode.js'
import { forget, hiringEgress, homebrewEgress, measure, speechEgress, type Egress } from './privacy.js'
import { HOSTS as SPOTIFY_HOSTS, SCOPES as SPOTIFY_SCOPES } from '../shared/spotify/auth.js'
import { Spotify } from './spotify/client.js'
import { connect as spotifyConnect, REDIRECT_URI } from './spotify/connect.js'
import {
  canRemember,
  CANNOT_STORE,
  networkAllowed,
  readClientId as readMusicClientId,
  setNetworkAllowed,
  tokenStore,
  writeClientId as writeMusicClientId,
} from './spotify/store.js'
import { gated } from './spotify/gate.js'
const here = dirname(fileURLToPath(import.meta.url))
/** `dist/main` → the app root, which is where `.claude/` and `assets/` live. */
const APP_ROOT = join(here, '..', '..')

/**
 * Which workspace the office is a window onto.
 *
 * Defaults to the app's own, which is the whole of the "clone it and it works" story — the
 * repo ships an office, so a fresh clone has staff on day one. `OFFICE_WORKSPACE` points it
 * somewhere else.
 *
 * Resolved at startup, because packaged and unpackaged answer differently and the packaged
 * answer involves creating a directory. `let`, and assigned once in `boot()`.
 *
 * The default below is the unpackaged answer, so anything reading this before `boot()` gets the
 * behaviour this app has always had rather than an empty string.
 */
let WORKSPACE_ROOT = process.env['OFFICE_WORKSPACE'] ?? APP_ROOT
/** Set when the workspace could not be created. Surfaced like the other startup problems. */
let workspaceProblem: Problem | null = null

/**
 * Where the shipped `.claude/` actually is.
 *
 * **Not** `APP_ROOT` when packaged — that resolves inside `app.asar`, and the template is
 * copied *beside* the archive by `extraResources`. `workspace-root.ts` carries the full story;
 * the short version is that a build once seeded from `APP_ROOT`, found nothing, and opened the
 * office onto an empty workspace. Anything that copies from the template reads this, so there
 * is one answer rather than two that can disagree.
 */
const TEMPLATE_ROOT = app.isPackaged ? join(process.resourcesPath, 'app') : APP_ROOT

/** Where `scripts/build.mjs` leaves the shipped-file manifest. `dist/main` → `dist/`. */
const MANIFEST_PATH = join(here, '..', 'shipped-hashes.json')

/**
 * What the startup update did, kept for the life of the process.
 *
 * It runs once, but the renderer asks for a snapshot whenever it likes and is handed a fresh one
 * on every workspace change, so the outcome rides along on all of them. Announcing it at the
 * moment it happens would be shouting into a window that does not exist yet.
 */
let updateNotice: string | null = null
/** Anything the update could not do. Re-attached to every snapshot; a rescan rebuilds its own. */
let updateProblems: Problem[] = []

/**
 * What a previous office left running, and that it has been stopped.
 *
 * Its own variable rather than a push into `updateProblems`, which `bringShippedFilesForward`
 * assigns wholesale — appending to that list before it runs writes into something about to be
 * replaced, which is how a notice becomes a line of code nobody ever sees.
 */
let crashNotice: Problem | null = null

/** Where a workspace declares what the office may do without being asked. */
const CLAUDE_SETTINGS = join('.claude', 'settings.json')

/**
 * How much of a long conversation to hand the renderer on restore.
 *
 * A session that ran all day can be thousands of entries, and the whole of it in one structured
 * clone is a stall the moment you open the app. The newest are the ones you want back, and how
 * many were left behind is reported rather than quietly dropped.
 */
const RESTORE_LIMIT = 300

let window: BrowserWindow | null = null
let workspace: Workspace | null = null
/**
 * Every conversation, keyed by its own session id.
 *
 * A project is *a group* of sessions, not one — so a project cannot be the key. Several of a
 * project's conversations may be live at once, and one you are not looking at keeps working,
 * which is the whole reason for tabs in the first place. Nothing here is torn down when the
 * front end switches.
 */
const managers = new Map<string, ManagerSession>()

/** Which conversation each project is currently showing. Project id → session id. */
const current = new Map<string, string>()

/**
 * The dials, per project.
 *
 * Per project rather than per workspace, because that is how the work actually differs: a
 * project you are exploring wants plan mode and a big model, and the one you are grinding
 * through wants neither. Sharing one setting across every tab would mean switching projects
 * silently changed how the one you left was going to behave.
 *
 * Not persisted across launches yet — deliberately. Reopening the office to yesterday's
 * `bypassPermissions` because you set it once for one job would be the app making a safety
 * choice on your behalf, so every launch starts from `initialControls()` and you set it again
 * if you meant it.
 */
const controls = new Map<string, Controls>()

/**
 * The permission mode the conversation this request came from is running under.
 *
 * The gate had no idea. `triage` saw the request and the allow/deny lists and nothing else, so
 * `bypassPermissions` and `dontAsk` — the two modes that are entirely *about* what happens to an
 * unlisted command — did nothing at all. A user selected bypass and answered forty-one cards.
 *
 * Nothing new had to be plumbed: the request carries `sessionId`, the session knows its project,
 * and controls are already kept per project. The value was sitting one lookup away the whole
 * time, which is what makes this the same shape as every other bug this repository keeps
 * finding — declared in one place, never read from another.
 *
 * `default` when the session is unknown, because a request from a conversation we cannot
 * identify is exactly the one to ask a person about.
 */
function modeOf(sessionId: string): PermissionMode {
  const session = managers.get(sessionId)
  if (!session) return 'default'
  return controlsFor(session.project).permissionMode
}

function controlsFor(project: string): Controls {
  return controls.get(project) ?? initialControls()
}
let projects: ProjectScan = { projects: [], problems: [], canCreate: false }

/** Every session this workspace has had, as last written down. */
let sessions: SessionRecord[] = []
/** Set when the registry could not be read or written. Surfaced, never swallowed. */
let registryProblem: Problem | null = null
/**
 * Rows the registry held and could not use, said for as long as the office is open.
 *
 * Its own variable rather than `registryProblem`, because a failed save replaces that one and the
 * next save that works clears it. The rows are still missing from the list after both.
 *
 * The count is the one `openRegistry` read, and nothing updates it: rows another office writes
 * later, rows repaired or removed by hand, and the rows of a file this office adopts are not in it.
 * It stays true only while a save keeps those rows in the file, which is #270's change to
 * `saveRegistry`. A save that writes only what it read deletes them, and this goes on counting
 * rows that are gone.
 */
let registryRowsProblem: Problem | null = null
/**
 * What the gate has filed: decisions somebody made, and requests nobody answered.
 *
 * It answers "the office has been asking and getting no answer", which is the thing somebody
 * needs to know and cannot otherwise find out — each unanswered one was a tool call that did not
 * run, four minutes apart, with nothing on screen at the time. Refreshed on every workspace read
 * rather than watched, because a number that is a few seconds stale is still the difference
 * between noticing and not.
 *
 * Names rather than counts, because the time and the outcome are *in* the names and the counting
 * belongs in `shared/decisions.ts`. Each half is `null` when that directory would not open, and
 * they fail apart: one unreadable while the other is fine is half an answer the office still has.
 */
let approvalsFiled: ApprovalRecord = { decisions: [], missed: [] }

/**
 * How far back the office accounts for, in hours.
 *
 * A day rather than a night. Somebody who leaves at six and comes back at nine has been away
 * fifteen hours, and a twelve-hour window would report their morning as quiet while the evening
 * that emptied it sat outside — which is the shape of wrongness this whole record exists to stop.
 * Anything older is still counted and still said, in its own clause.
 */
const NIGHT_HOURS = 24

/** Which half of the record would not open, or `null` when both did. */
function unreadableHalf(): 'decisions' | 'missed' | 'both' | null {
  const noDecisions = approvalsFiled.decisions === null
  const noMissed = approvalsFiled.missed === null
  if (noDecisions && noMissed) return 'both'
  if (noDecisions) return 'decisions'
  if (noMissed) return 'missed'
  return null
}

/**
 * The account as of this instant.
 *
 * A half that would not open contributes nothing rather than a zero — the sentence about *that*
 * is `couldNotLook`, drawn separately, and letting an unreadable directory quietly read as "none
 * of those happened" is the fourth standing order in the feature written to keep it.
 *
 * Called **once** per snapshot and passed around, not called wherever the answer is wanted. Two
 * calls read `Date.now()` separately, so a record could age out of the window between them — the
 * card would fire on `unanswered > 0` from the first reading and then draw a sentence from the
 * second saying no tool call had needed you all day. Microseconds wide, and precisely the class
 * of contradiction this whole feature exists to remove.
 */
function nightNow(): Tally {
  return tally(
    approvalsFiled.decisions ?? [],
    approvalsFiled.missed ?? [],
    Date.now() - NIGHT_HOURS * 3_600_000,
  )
}
/**
 * Set when the approvals directory itself will not open.
 *
 * Separate from `approvalsFiled`, which records what the gate did with them. This is the worse
 * one: `pending()` is the only source of approval cards, so a directory that exists and will not
 * be read means no card ever appears, the office looks idle, and each held call is refused four
 * minutes later with nothing on screen having mentioned it.
 */
let approvalsUnreadable = false
/**
 * Set while a call the office answered without asking is still held with its verdict unwritten.
 *
 * Every batch replaces it, and an empty batch clears it, which never reaches `answerFromPolicy`.
 * No card is drawn for such a call, because it is not a question for anybody, so this is the only
 * place the office says that it answered and the answer never reached the gate.
 */
let verdictProblem: Problem | null = null
/**
 * Set when this workspace's permission rules are being ignored.
 *
 * Checked once at startup. It cannot change while the app runs without Claude Code being used
 * elsewhere, and re-reading it on every scan would be answering a question nobody asked again.
 */
let trustProblem: Problem | null = null
/**
 * Set when macOS still has this app's bundle marked as downloaded.
 *
 * Checked once at startup, for the same reason as the trust check: the flag cannot change under
 * a running app without somebody moving the bundle out from under it, and re-asking on every
 * scan would be answering a settled question on a timer.
 */
let quarantineProblem: Problem | null = null
/** Watches the approval rendezvous. Closed on quit so it cannot hold the process open. */
let approvalWatcher: { close(): void; resend(): void } | null = null

/**
 * Approvals this window has already mentioned out loud.
 *
 * The watcher ticks about every 400ms, so without this the office notifies four times a second
 * for as long as a request is unanswered — roughly 600 notifications about one command over the
 * four-minute wait. `shared/nudge.ts` owns the decision and prunes this to what is still waiting.
 */
let mentioned: ReadonlySet<string> = new Set()

/**
 * A run's write and shell calls, and the dispatches it started, while it is still running.
 *
 * Held per conversation rather than globally: several of a project's conversations run at once,
 * and a run that folded in another's calls would attribute one employee's edits to a brief they
 * never received.
 *
 * Cleared when the run ends, because the next turn is a different run and the ids do not carry.
 */
const inFlight = new Map<string, { calls: ToolCall[]; dispatches: Set<string>; results: Map<string, string> }>()

/** Requests already answered from policy, so a re-poll before the hook cleans up is not a second decision. */
const autoDecided = new Decided()
/**
 * What the CLI said about each MCP server the last time it started one.
 *
 * The capability survey deliberately will not find out for itself: starting a server to see
 * whether it answers is a side effect a *report* has no business having. So the survey says
 * `configured`, this says `connected` or `failed`, and the two are joined at the point of
 * asking rather than one being quietly upgraded into the other.
 */
const liveMcpStatus = new Map<string, string>()
/**
 * Set when something in the environment is billing an account other than the subscription.
 *
 * Read once at startup, like the trust check and for the same reason — `process.env` is fixed
 * for the life of the process, so re-reading it would be asking a settled question again.
 */
let billingProblem: Problem | null = null
/**
 * Set when a settings file exists and could not be used.
 *
 * Distinct from having no settings, which is ordinary. This one means the user wrote rules that
 * are not in force — and both we and the CLI used to swallow it, so nobody would find out
 * except by wondering why nothing was allowed.
 */
let policyReadProblem: Problem | null = null
/**
 * The last thing the CLI said about how much of the plan is left.
 *
 * Kept because it arrives on the *first event of a run* and is wanted at the *start of the
 * next one* — so the only version available when assembling context is the previous run's. That
 * is honest and worth being explicit about: it is the most recent measurement, not a live one,
 * and on a seven-day window it does not move much between two messages.
 *
 * `null` until a run has happened, so a fresh office says nothing rather than guessing.
 */
let planWarningNow: string | null = null

/**
 * The allowance itself, kept beside the sentence derived from it.
 *
 * `planWarningNow` above is a *string assembled for the manager's context block*, and it is
 * `null` for every ordinary reading because `planWarning` is deliberately silent below its
 * threshold. So the office held the number, turned it into nothing, and threw the number away —
 * which is why *"how full is my plan"* could not be answered while *"you are nearly out"* could.
 *
 * `runsSeen` is what separates the two silences. An office nobody has used has no reading; an
 * office that has run and was never told its limits is on an API key or an older CLI. Both would
 * otherwise be `null`, and only one of them is worth a person's attention.
 *
 * Deliberately not persisted to disk. The reading describes an account at a moment, and a value
 * restored from a previous boot would be presented as a measurement of now — stale in exactly
 * the way `planLede` promises it is not. A fresh process says "nothing has run yet", which is
 * true of that process.
 */
let planReadingNow: PlanReading = { state: 'never-ran' }
let runsSeen = 0
/**
 * The `claude` to spawn, resolved once at startup.
 *
 * An absolute path rather than a bare name, because a GUI app does not get your terminal's
 * PATH and the whole product rests on it finding the same binary your terminal finds.
 */
let claudePath: string | null = null
/** Set when there is nothing to run. The most important thing the office can say. */
let claudeProblem: Problem | null = null

// ─────────────────────────────────────────────────────────────────────── art ──

/** Packs found in `assets/themes/`. Validated, not yet loaded — the renderer decodes. */
let packs: readonly ThemeDescriptor[] = []
/**
 * Which theme is in use. The built-in always works and is the default.
 *
 * `OFFICE_THEME` starts the office in a particular one, the same way `OFFICE_WORKSPACE` and
 * `OFFICE_CLAUDE_PATH` point it at a particular directory or binary. A theme named there that
 * is not installed falls back and says so, rather than starting with no art.
 */
let themeId: string = process.env['OFFICE_THEME'] ?? PROCEDURAL_THEME_ID
/** Packs that are installed and unusable. Reported — never a silent downgrade. */
let themeProblems: Problem[] = []

function activePack(): ThemeDescriptor | null {
  return packs.find((p) => p.id === themeId) ?? null
}

/**
 * Read the themes a user has installed.
 *
 * A pack that is present and broken is a problem, not an absence. Somebody who bought art and
 * dropped it in is owed an error message; quietly rendering the drawn cast and letting them
 * wonder why nothing changed is the "absent read as empty" failure wearing a different coat.
 */
async function findThemes(): Promise<void> {
  const scan = await scanThemes(WORKSPACE_ROOT)
  packs = scan.themes
  themeProblems = scan.problems.map((p) => ({
    kind: 'unreadable-file' as const,
    path: p.path,
    cause: `theme "${p.themeId}" cannot be used: ${p.reason}`,
  }))

  // A theme that was chosen and is no longer installed falls back, and says so.
  if (themeId !== PROCEDURAL_THEME_ID && !activePack()) {
    themeProblems.push({
      kind: 'lint',
      path: WORKSPACE_ROOT,
      rule: 'theme-missing',
      detail: `The theme "${themeId}" is no longer installed, so the office is drawing its own cast again.`,
    })
    themeId = PROCEDURAL_THEME_ID
  }
}

/**
 * Say a theme let us down, once.
 *
 * Sprites are fetched per agent, so a broken pack would otherwise report itself seven times
 * over. Falling back silently is the failure this seam exists to prevent, but saying it seven
 * times is how somebody learns to ignore the message.
 */
function reportThemeFailure(id: string, path: string, cause: string): void {
  if (themeProblems.some((p) => p.path === path)) return
  themeProblems = [
    ...themeProblems,
    { kind: 'unreadable-file', path, cause: `theme "${id}" could not be drawn from: ${cause}` },
  ]
  themeId = PROCEDURAL_THEME_ID
  if (workspace) send(CHANNEL.office, toSnapshot(workspace))
}

function themeInfo() {
  const pack = activePack()
  return pack
    ? { id: pack.id, name: pack.name, credit: pack.credit, redistributable: false }
    : {
        id: proceduralTheme.id,
        name: proceduralTheme.name,
        credit: proceduralTheme.credit,
        redistributable: proceduralTheme.redistributable,
      }
}

// ─────────────────────────────────────────────────────────────────────── voice ──

/**
 * Whether the office may speak.
 *
 * Off until asked, and off costs nothing: deciding whether a turn is worth mentioning is a
 * judgement call that runs on Claude, so a voice nobody switched on would be a charge nobody
 * agreed to.
 */
let voiceOn = false

/**
 * What has happened in each **conversation** since it last had anything to say.
 *
 * Keyed by session, not project — two of a project's conversations running at once are two
 * turns, and digesting them together would summarise work that never happened in one place.
 * That was already true; the lookup was called `recorderFor(project)` and every caller passed a
 * session id, so the only thing here that said otherwise was the names.
 */
const recorders = new Recorders(() => (workspace && findManager(workspace.employees)) || 'manager')

/**
 * Watch a project's events for anything worth saying, and say it when the turn ends.
 *
 * The turn end is the moment to speak, not each event: an office that narrates every tool call
 * is unbearable inside two minutes, and the moments are only worth weighing once there is a
 * whole turn of them. Everything before that is accumulated and never spoken on its own.
 */
async function listen(project: string, sessionId: string, event: ClaudeEvent): Promise<void> {
  if (!voiceOn) return

  // `null` until the turn ends. The turn end is the moment to speak, not each event.
  const moments = recorders.observe(sessionId, event)
  if (moments === null) return

  const spoken = await digest({ moments, cwd: WORKSPACE_ROOT })

  // The digest is a real `claude` run on this project's behalf, so its cost belongs to this
  // project. `free: true` means the local gate answered and nothing was spent.
  managers.get(sessionId)?.spend(spoken.costUsd)

  // The voice was switched off while the digest was thinking. Do not speak into a room that
  // asked for quiet, and do not note that it stayed quiet either — nobody asked.
  if (!voiceOn) return

  // Silence is the common answer and is not a failure. It is still worth one line when the
  // digest *decided* it, or when it broke: from outside, a voice that judged this turn unworthy
  // and a voice whose run died are the same silence, which is the third standing order failing
  // by omission. `quiet` is unset for the gate's own silence, which is not news.
  if (!spoken.speak) {
    if (spoken.quiet) send(CHANNEL.speak, { project, text: '', urgency: 'routine', quiet: spoken.quiet })
    return
  }

  const utterance: Utterance = {
    project,
    text: spoken.text,
    urgency: moments.some((m) => m.kind === 'failed') ? 'urgent' : 'routine',
  }
  send(CHANNEL.speak, utterance)
}

// ─────────────────────────────────────────────────────────────────── the office ──


/**
 * The second line of a project's row: how many conversations, when last, and is one working.
 *
 * Read from the registry rather than from `managers`, because most of a project's conversations
 * are not running and a count taken from memory would only ever see the ones started this run.
 * `sessionsFor` already filters to opened sessions and sorts newest first, so the head of that
 * list is the answer to "when was I last here".
 */
function rowFor(project: string): Pick<ProjectInfo, 'conversations' | 'lastActiveAt' | 'running'> {
  // The same list the panel below this row is about to draw, counted. Not `sessionsFor` — that
  // is the registry alone, and a conversation started this run is not in it yet, so the row read
  // "no conversations yet · never" directly above the conversation the reader was sitting in.
  const listed = sessionListOf(project)
  return {
    conversations: listed.length,
    // The first one that has a time, not the first one. The head of this list is the live
    // conversation, and a live conversation nothing has been said in has no time to report —
    // taking its `null` would hide a project's real history behind the conversation you just
    // opened, and taking a minted "now" would report the render clock as activity.
    lastActiveAt: listed.find((s) => s.updatedAt !== null)?.updatedAt ?? null,
    running: listed.some((s) => s.running),
  }
}

function projectList(): ProjectInfo[] {
  return [
    // The office is always first and always there: a workspace with no `projects/` still needs
    // somewhere to talk, and "set up a project for me" has to be sayable before one exists.
    { id: OFFICE_PROJECT, name: 'The office', missing: [], ...rowFor(OFFICE_PROJECT) },
    ...projects.projects.map((p) => ({
      id: p.id,
      name: p.name,
      missing: Object.entries(p.has)
        .filter(([, present]) => !present)
        .map(([file]) => file),
      ...rowFor(p.id),
    })),
  ]
}

function projectById(id: string): Project | null {
  return projects.projects.find((p) => p.id === id) ?? null
}


/**
 * Whether this build carries a project template to copy in.
 *
 * Stat'ed once at startup rather than assumed. The office shipped once with `extraResources`
 * missing three of its seven seed files, so "we have a template" is a claim about a *bundle*
 * rather than about the source tree — and a button offering to copy something the bundle does
 * not contain fails after the click, which is the one thing the first-run panel refuses to do.
 *
 * Once, because the bundle cannot change while the app runs. A workspace can, which is why
 * `canCreateProject` beside it is re-read on every scan and this is not.
 */
let templateShipped = false

/**
 * Whether this workspace has an instruction file, re-read on every scan.
 *
 * Unlike `templateShipped`, which is a fact about the bundle and settled at startup, this can
 * change while the office is open — somebody who writes a CLAUDE.md should watch the notice go
 * away rather than having to restart the app to find out it worked.
 */
let instructionsState: 'present' | 'absent' | 'unreadable' = 'present'

/**
 * What the approval gate is doing, re-read on every scan like the instruction file.
 *
 * `wired` until the first scan says otherwise, so a panel drawn before anything has been looked
 * at does not announce that commands are unapproved on the strength of not having checked.
 */
let gateNow: GateState = { state: 'wired' }

async function checkTemplateShipped(): Promise<void> {
  try {
    await stat(join(TEMPLATE_ROOT, PROJECTS_DIR, TEMPLATE))
    templateShipped = true
  } catch {
    templateShipped = false
  }
}

function toSnapshot(ws: Workspace): OfficeSnapshot {
  const manager = findManager(ws.employees)
  // One reading of the clock for the whole snapshot. See `nightNow`: two readings can disagree
  // about whether a record is still inside the window, and the card would then fire on one and
  // describe the other.
  const night = nightNow()
  const staff: StaffMember[] = ws.employees.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    tools: e.tools,
    model: e.model,
    isManager: e.id === manager,
  }))

  return {
    root: ws.root,
    staff,
    skills: ws.skills.map((s) => ({ id: s.id, name: s.name, description: s.description })),
    // The registry's own trouble belongs with the workspace's. A history we could not read is
    // a fact about the office, and one an empty-looking chat panel would otherwise explain as
    // "you have not started yet".
    problems: [
      // The office having nothing to run comes first. Everything else is a detail next to it.
      ...(claudeProblem ? [claudeProblem] : []),
      // Then who is paying, because this one costs money for as long as it goes unnoticed and
      // every other problem here costs only time.
      ...(billingProblem ? [billingProblem] : []),
      ...(policyReadProblem ? [policyReadProblem] : []),
      ...(workspaceProblem ? [workspaceProblem] : []),
      // Next to the workspace's own trouble, because that is what these are: a shipped file
      // that could not be brought forward is a fact about this office, and a rescan builds its
      // `problems` from scratch, so it would vanish at the first file change if it were not
      // re-attached here. A problem that disappears on its own is one the reader is entitled to
      // think was solved.
      ...updateProblems,
      ...(crashNotice ? [crashNotice] : []),
      ...ws.problems,
      ...projects.problems,
      // An installed art pack is workspace content, so its trouble sits with the workspace's.
      //
      // This line is the whole of the fix it arrived with. `themeProblems` was declared, built
      // from the scan, pushed to when a pack failed mid-draw, and deduped by path — and read by
      // nothing. `reportThemeFailure` appended to it, set `themeId` back to procedural, and sent
      // a fresh snapshot built right here, which did not carry it: the function whose stated job
      // is "say a theme let us down" performed the silent downgrade and dropped the saying.
      //
      // Four comments described the mechanism. `theme.ts` — *"a theme that fails to load is
      // reported, never silently swapped"*. The declaration — *"Reported — never a silent
      // downgrade."* `findThemes` — *"somebody who bought art and dropped it in is owed an error
      // message"*. And the note explaining why `ThemeSelection` was deleted, which vouches for
      // this fold by name and reasons that the type was safe to remove because the promise was
      // already kept here. It was not kept here. It was kept nowhere.
      ...themeProblems,
      ...(trustProblem ? [trustProblem] : []),
      // Last of the environment warnings, because it is the only one that costs nothing while
      // it goes unfixed: the app in front of the reader is already running.
      ...(quarantineProblem ? [quarantineProblem] : []),
      ...(registryProblem ? [registryProblem] : []),
      ...(registryRowsProblem ? [registryRowsProblem] : []),
      /**
       * Approvals nobody answered.
       *
       * `lint`, **not** `unreadable-file`. The first version used the latter, and the directory
       * reads perfectly — the panel then printed its own standard sentence for that kind,
       * *"exists and could not be read … this is not the same as it being empty"*, which is
       * false, and **threw the real one away**: `unreadable` problems are rendered from their
       * `path` alone. Three expired approvals were reported as a directory that would not open.
       *
       * Borrowing a kind that means something else is not a shortcut. The kind decides which
       * sentence a panel writes, so it is part of the claim.
       */
      ...(approvalsUnreadable
        ? [
            {
              kind: 'lint' as const,
              path: join(WORKSPACE_ROOT, '.office-space', 'approvals'),
              rule: 'approvals-unreadable',
              detail:
                'This office cannot see which tool calls are waiting for you — the directory ' +
                'they arrive in exists and will not open. Any call an employee makes will be ' +
                'held with no card shown, and refused about four minutes later. Check the ' +
                `permissions on ${join(WORKSPACE_ROOT, '.office-space', 'approvals')}.`,
            },
          ]
        : []),
      // Beside it, because both are held calls with no card that the office is not answering.
      ...(verdictProblem ? [verdictProblem] : []),
      ...(unreadableHalf() !== null
        ? [
            {
              // `lint` again, and for the reason the entry below it learned: `unreadable-dir`
              // renders a standard sentence from the path alone — *"so whatever is in it is not
              // on the floor"* — which is both generic and, for approvals, wrong. They were never
              // going to be on the floor.
              kind: 'lint' as const,
              path: join(WORKSPACE_ROOT, '.office-space', 'approvals'),
              rule: 'approvals-record-unreadable',
              detail:
                `${couldNotLook(unreadableHalf() ?? 'both')} Check the permissions on ` +
                `${join(WORKSPACE_ROOT, '.office-space', 'approvals')}.`,
            },
          ]
        : []),
      /*
       * The night, in proportion.
       *
       * This used to be a bare count of `missed/` — which nothing ever prunes, so it was a
       * lifetime total reported in the present tense with present-tense advice: one unattended
       * night put twelve on the status bar and no day of perfect attendance took any of it back.
       * Now that both halves carry a time it is a window, and `nightLede` says separately what
       * sits outside it and what it cannot place at all.
       *
       * Still triggered by refusals rather than by any activity. Somebody who answered everything
       * has nothing to fix, and a card that appeared on a good night is a card nobody reads on a
       * bad one. What changed is that when it does appear, it reports the decisions a person made
       * alongside the ones they were not there to make — because eleven unanswered is a different
       * fact beside six answered than it is alone.
       */
      ...(night.unanswered > 0
        ? [
            {
              kind: 'lint' as const,
              path: join(WORKSPACE_ROOT, '.office-space', 'approvals'),
              rule: 'approvals-missed',
              /*
               * No remedy sentence, and the reason is the whole point of the window.
               *
               * A draft of this said *"Deleting this store in the privacy panel is what clears
               * it."* That was written for the old lifetime count, which nothing could reduce,
               * and it was wrong twice over by the time it was written.
               *
               * It is **unnecessary**: the count is now a window, so it falls to zero on its own
               * a day after the last unanswered call. Nothing needs deleting to clear it.
               *
               * And it is **unsafe**, which is worse than unnecessary. `forget()` empties a store
               * of everything not in its `shipped` list and this store has none, so the delete
               * takes `decided/` with it — the sentence would appear on exactly the nights that
               * produced the most decisions and tell somebody to destroy the answer to "what did
               * I approve last night", in the same paragraph that had just given it to them.
               * Worse still, #209 shows that delete also kills a request in flight: the call
               * stalls the full four minutes and is refused with *"Nobody answered in Office
               * Space"*, leaving no record — and this lint fires precisely when the office is
               * running unattended, which is when a call is most likely to be in flight.
               *
               * So the record needs a door that is not this lint, and it is not this change.
               */
              detail:
                `${nightLede(night, NIGHT_HOURS) ?? ''} If the office is open and ` +
                'unattended, every gated command waits four minutes and is then denied.',
            },
          ]
        : []),
    ],
    projects: projectList(),
    canCreateProject: projects.canCreate,
    // Whether *we* have one, which is a different question from whether this workspace does —
    // and the one that decides between a button and a sentence.
    canAddTemplate: templateShipped,
    instructions: instructionsState,
    gate: gateNow,
    update: updateNotice,
    scannedAt: ws.scannedAt,
    theme: themeInfo(),
    themes: [
      {
        id: proceduralTheme.id,
        name: proceduralTheme.name,
        credit: proceduralTheme.credit,
        redistributable: proceduralTheme.redistributable,
        active: themeId === PROCEDURAL_THEME_ID,
      },
      ...packs.map((p) => ({
        id: p.id,
        name: p.name,
        credit: p.credit,
        // Only the built-in may ever ship with the project. Anything installed is the user's
        // own licensed copy and stays on their machine.
        redistributable: false,
        active: p.id === themeId,
      })),
    ],
  }
}

async function rescan(): Promise<OfficeSnapshot> {
  workspace = await discoverWorkspace(WORKSPACE_ROOT)
  projects = await discoverProjects(WORKSPACE_ROOT)
  // Art installed while the app is running should turn up like everything else does.
  await findThemes()
  // And approvals the gate gave up on. Read here rather than watched: this is a count that only
  // grows, four minutes at a time, and a number a few seconds stale is still the difference
  // between somebody noticing that the office has been asking and getting no answer, and not.
  approvalsFiled = await approvalRecord(WORKSPACE_ROOT)
  instructionsState = (await readInstructions(WORKSPACE_ROOT)).state
  gateNow = await readGate(WORKSPACE_ROOT)
  // The same read the watcher does, for its own answer rather than its list. `null` there means
  // the office cannot see what is waiting, which is a thing to say out loud rather than a floor
  // that quietly looks idle.
  approvalsUnreadable = (await pending(WORKSPACE_ROOT)) === null
  return toSnapshot(workspace)
}

// ─────────────────────────────────────────────────────────────────── the update ──

/**
 * Bring shipped `.claude/` files forward in this workspace. Once, at startup.
 *
 * A workspace is seeded from the template and then never touched again, so that an update can
 * never overwrite an agent somebody tuned. The cost is that a fix shipped after their first
 * launch never reaches them — a skill that is not in their office, a manager running the
 * instructions it had on the day they installed. This puts that right for the files it can
 * *prove* are untouched, and only those. `reconcile.ts` holds the rule and the four ways it
 * could otherwise destroy something.
 *
 * Called from exactly one place, and where it is called is load-bearing:
 *
 *   **After `WORKSPACE_ROOT` is settled.** This function writes files. Reading before the root
 *   was known is what deleted a user's conversations — see the comment at the `resolveWorkspaceRoot`
 *   call below, which is about a read; this is a *write*, aimed at a path built from the same
 *   variable, so the same mistake here would not lose a session list but overwrite a workspace.
 *
 *   **Before `rescan()`.** The floor's first picture should be of the office as it is after the
 *   update, not of the old one followed by a silent correction.
 */
async function bringShippedFilesForward(): Promise<void> {
  // Running from a clone, the workspace *is* the shipped copy — `resolveWorkspaceRoot` says so
  // in as many words. Reconciling it against itself is not an update; it is the app rewriting
  // its own repository, and it would undo a deliberate revert as readily as a stale file.
  if (resolve(WORKSPACE_ROOT) === resolve(TEMPLATE_ROOT)) return

  let manifest: ShippedManifest
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as ShippedManifest
  } catch (err) {
    // Absent is not empty. A manifest we could not read is not "there is nothing to bring
    // forward" — it is "we do not know", and on not knowing the only safe move is to change
    // nothing and say so.
    updateProblems = [
      {
        kind: 'lint',
        path: MANIFEST_PATH,
        rule: 'update-blocked',
        detail:
          `The list of shipped files could not be read (${err instanceof Error ? err.message : String(err)}), ` +
          'so .claude/ was left exactly as it is. Nothing of yours was touched. `npm run build` rebuilds it.',
      },
    ]
    return
  }

  const receipt = await readReceipt(WORKSPACE_ROOT)
  const plan = await planReconcile(manifest, WORKSPACE_ROOT, receipt)
  const outcome = await applyReconcile(plan, manifest, TEMPLATE_ROOT, WORKSPACE_ROOT)

  // After applying, and told what was actually written. This is what makes a fired agent stay
  // fired: next launch, a shipped path that is absent *and* written down here is one this office
  // was given and the user took away, rather than one they never had.
  //
  // `outcome.written` is not optional decoration. Without it the receipt falls back to asking
  // whether a file is *present*, which records somebody's own file at a shipped path as a
  // delivery — and deleting their own file then suppresses ours in that workspace forever.
  const receipted = await writeReceipt(manifest, WORKSPACE_ROOT, receipt, outcome.written)

  updateNotice = summarise(plan, outcome)
  updateProblems = reconcileProblems(plan, outcome)
  if (!receipted.ok) {
    updateProblems.push({
      kind: 'lint',
      path: WORKSPACE_ROOT,
      rule: 'update-blocked',
      detail:
        `Could not record which shipped files this office has (${receipted.cause}). ` +
        'Nothing was lost, but an agent you remove may be offered again on a future update.',
    })
  }
}

// ────────────────────────────────────────────────────────────────── the session ──

/**
 * The conversation a project is currently showing, started if it has none.
 *
 * On first use a project adopts the session it would resume, so opening the app puts you back
 * where you were rather than starting a second conversation beside the one you were having.
 */
function sessionFor(project: string): ManagerSession {
  const live = current.get(project)
  const existing = live ? managers.get(live) : undefined
  if (existing) return existing

  // Nothing live. Pick the conversation back up if there is one to pick up.
  const previous = resumableFor(project)
  return openSession(project, previous?.id ?? null)
}

/**
 * Tools an employee's own conversation never gets, whatever mode it is in.
 *
 * Standing order 1: only the user and the manager may originate work. Asking the tester what it
 * found is not originating work — a tester that starts editing files because you wondered aloud
 * is. Khalid's call, and it is the same mechanism intake already uses, for the same reason:
 * enforced by the app rather than asked for in a prompt, because a prompt that loses an argument
 * with its context has lied about what it may do.
 *
 * `Read`, `Grep` and `Glob` stay, deliberately. The whole point of asking the person rather than
 * the manager is that they can **go and look** — the manager's own aside prompt admits it
 * "cannot see inside a subagent while it runs", and an answer from a fresh reading is worth more
 * than a recollection.
 */
const EMPLOYEE_WITHHOLDS: readonly string[] = ['Task', 'Write', 'Edit']

/**
 * Make a session current, creating it if it is not already in memory.
 *
 * `id` null starts a new conversation. An id we already have running is adopted as it stands —
 * two `ManagerSession`s on one id would interleave in the same transcript.
 */
function openSession(project: string, id: string | null, agentId?: string): ManagerSession {
  if (id) {
    const already = managers.get(id)
    if (already) {
      current.set(project, id)
      return already
    }
  }

  // Whose conversation this is. An employee named here answers for themselves; otherwise it is
  // the manager's, which is every conversation that existed before this.
  const named = agentId && workspace ? (workspace.employees.find((e) => e.id === agentId)?.id ?? null) : null
  if (agentId && !named) throw new Error(`no agent called "${agentId}" in ${WORKSPACE_ROOT}/.claude/agents`)

  const manager = named ?? (workspace ? findManager(workspace.employees) : null)
  if (!manager) throw new Error(`no manager agent found in ${WORKSPACE_ROOT}/.claude/agents`)

  // Every project's session runs in the workspace root. The staff live in
  // `<workspace>/.claude/agents/`, and a session started inside `projects/<name>/` may not find
  // them — the office would arrive on the floor empty, or with somebody else's roster. Which
  // work this is gets carried in what the manager is told instead. See `projects.ts`.
  const session: ManagerSession = new ManagerSession({
    cwd: WORKSPACE_ROOT,
    agent: manager,
    projectBlock: () => projectBlock(projectById(project)),
    // The id, not the prose. `modeOf` looks the conversation's controls up by this.
    project,
    // Read at send time, not now. `watchWorkspace` replaces `workspace` whenever
    // `.claude/agents/` changes, so a manager mid-project is told about someone hired two
    // messages ago rather than about the floor as it stood when the session opened.
    staff: () => (workspace ? toSnapshot(workspace).staff : []),
    // Read at send time too, and for a sharper reason than the roster: these are dials the
    // user can turn *while a message is being composed*. Capturing them when the session was
    // constructed would mean switching to plan mode and then sending took effect next time.
    controls: () => controlsFor(project),
    /**
     * Everything else the office knows and the manager cannot see for itself.
     *
     * Read at send time like the three above, and for the same reason — all of it changes while
     * a conversation is open. The shelf especially: `manager.md` instructs the manager to invoke
     * skills by name, and until now the office never handed over the list. A user adding a
     * fourth skill got it drawn on the shelf and never mentioned to the person who would use it.
     */
    office: () => ({
      // `null` when discovery could not read the directory, which is a different fact from an
      // empty shelf and is said differently. `workspace` being absent means we have not scanned
      // yet — silence, not a failure.
      skills: workspace
        ? workspace.skills.map((sk) => ({ id: sk.id, description: sk.description }))
        : [],
      ...(planWarningNow ? { planWarning: planWarningNow } : {}),
      // Read at send time like everything else here: the person can move the mode while a
      // message is being composed, and a mode captured at construction would tell the manager
      // it is still in intake on the first turn after they let it out.
      mode: session.mode,
    }),
    ...(claudePath ? { claudePath } : {}),
    // An employee answers; it does not go and do. Held for the life of the session rather than
    // per mode, so no mode change hands the tools back.
    ...(named ? { withhold: EMPLOYEE_WITHHOLDS } : {}),
    // Resume into the mode this conversation was left in, not into a fresh intake. A new one
    // has no record and falls through to the session's own default, which is intake.
    ...(id ? { mode: sessions.find((r) => r.id === id)?.mode ?? LEGACY_MODE } : {}),
    // Carry on where you left off. Only ever an id the registry recorded as opened.
    ...(id ? { resume: id } : {}),
    // And carry on owing what you already owed. Without this the session counts from zero and
    // `writeRegistry` puts that count back over the conversation's real total — the one field in
    // that write that did not fall back to `existing`, while `createdAt` and `title` both do.
    ...(id ? { costUsd: sessions.find((r) => r.id === id)?.costUsd ?? null } : {}),
    // Events are addressed to the conversation, not the project. Several of a project's
    // conversations can be running, and a transcript that received another's events would be
    // showing work that never happened in it.
    onEvent: (event: ClaudeEvent) => {
      // Counted on the result, which every run produces exactly one of — so this is runs that
      // *finished*, and a run still in flight does not yet count as one that failed to report.
      if (event.kind === 'result') {
        runsSeen += 1
        // Only when nothing has ever been measured. A reading from an earlier run stays the
        // answer: it is stale, `planLede` says so, and stale is worth more than nothing.
        if (planReadingNow.state !== 'measured') planReadingNow = { state: 'not-reported', runs: runsSeen }
      }

      // Remembered for the *next* turn's context. It arrives on the first event of a run and is
      // wanted when assembling the one after, so the freshest value available is always the
      // previous run's — which on a seven-day window is close enough to be useful and is
      // described as a measurement rather than a live reading.
      if (event.kind === 'rate-limit') {
        planWarningNow = planWarning(event, Date.now())
        // The whole event, not just the sentence. `windows` carries every bucket the CLI named —
        // `five_hour` and `seven_day` were both present in the run `stream.ts` captured — and it
        // has been parsed and read by nothing since it was written.
        planReadingNow = { state: 'measured', usage: event, windows: event.windows, at: Date.now() }
      }

      send(CHANNEL.event, session.id, event)
      void listen(project, session.id, event)

      // ── what each dispatch changed ────────────────────────────────────────────────────
      //
      // Gathered as the run goes and written when it ends. The join is the CLI's own: every
      // event a subagent produces carries the `tool_use` id of the `Task` that started it, and
      // that id is `Dispatch.id`. Nothing is correlated by time and nothing is guessed.
      if (event.kind === 'assistant') {
        const run = inFlight.get(session.id) ?? { calls: [], dispatches: new Set<string>(), results: new Map<string, string>() }
        for (const block of event.blocks) {
          if (block.type !== 'tool_use' || !block.name) continue
          // A dispatch is the manager asking for somebody. `ledger.ts` keys on the same block id.
          if (isDelegationTool(block.name)) {
            if (block.id) run.dispatches.add(block.id)
            continue
          }
          run.calls.push({
            name: block.name,
            input: block.input ?? {},
            parent: event.parentToolUseId,
            // Carried so the tool's own result can be found: it is what says whether a `Write`
            // created a file or overwrote one somebody already had.
            ...(block.id ? { id: block.id } : {}),
          })
        }
        inFlight.set(session.id, run)
      }
      // What each tool said it did, keyed by the call it answers. A `user` turn is either
      // somebody typing or tool results being fed back; only the second carries these.
      if (event.kind === 'user') {
        const run = inFlight.get(session.id)
        if (run) {
          for (const block of event.blocks) {
            if (block.type !== 'tool_result' || !block.tool_use_id) continue
            const said = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')
            run.results.set(block.tool_use_id, said)
          }
        }
      }
      if (event.kind === 'result') {
        const run = inFlight.get(session.id)
        inFlight.delete(session.id)
        if (run) {
          /*
           * The manager's own turn, recorded like anybody else's work.
           *
           * The manager keeps `Write` and `Edit` — only employees have them withheld — so a panel
           * titled "What the office changed" that lists only dispatches is omitting the one
           * writer that is always present. Its calls are the ones whose parent is `null`, which
           * is a positive answer rather than a gap: the CLI tags every subagent call with its
           * dispatch and tags none of the manager's.
           *
           * Keyed by the first write it made, because a turn has no id of its own and a
           * `tool_use` id is unique, derived from the data, and the same on a re-read. No writes
           * means no key and no record, which is correct rather than an empty one.
           */
          const ownId = ownWriteId(run.calls)
          if (ownId !== null) {
            void recordChanges(
              WORKSPACE_ROOT,
              ownId,
              changesFor(run.calls, null, run.dispatches, run.results),
              { who: (workspace && findManager(workspace.employees)) || 'manager', at: new Date().toISOString(), session: session.id },
            ).catch((err: unknown) =>
              console.error(`Office Space: what the manager changed was not recorded: ${String(err)}`),
            )
          }

          for (const dispatch of run.dispatches) {
            void recordChanges(
              WORKSPACE_ROOT,
              dispatch,
              changesFor(run.calls, dispatch, run.dispatches, run.results),
            ).catch(
              // A record that could not be written must not take the turn down with it. What it
              // costs is a dispatch whose changes cannot be looked at — which is where this
              // feature started, so it is a return to the old state rather than a new fault.
              (err: unknown) =>
                console.error(`Office Space: what a dispatch changed was not recorded: ${String(err)}`),
            )
          }
        }
      }
      // ──────────────────────────────────────────────────────────────────────────────────

      // ── the dispatch ledger (S5) ──────────────────────────────────────────────────────
      // Written before the answer can be lost. A crash between here and the result is the
      // whole reason the file exists, so this cannot wait for a turn to end.
      void recordDispatchEvent(WORKSPACE_ROOT, { sessionId: session.id, project }, event).then(
        (written) => {
          // A ledger write that failed silently would be a ledger that lies by omission on the
          // next launch — the screen would say there is nothing outstanding when there is.
          for (const one of written) {
            if (!one.ok) console.error(`Office Space: the dispatch ledger was not written: ${one.reason}`)
          }
        },
      )
      // ──────────────────────────────────────────────────────────────────────────────────
    },
    onState: (state: SessionState) => {
      send(CHANNEL.state, session.id, state)
      void remember(project, session.id)
    },
  })

  managers.set(session.id, session)
  current.set(project, session.id)
  return session
}

/** The registry's record for a conversation, if it has reached the registry. */
function recordFor(id: string): SessionRecord | null {
  return sessions.find((r) => r.id === id) ?? null
}

/** One conversation, described for the strip. Live state wins over what was written down. */
function describeSession(
  id: string,
  // Unread. Kept in the signature because callers pass it positionally, and a session's project
  // is the obvious thing a fuller description would want — renaming rather than removing says
  // "not used" without also saying "not relevant".
  _project: string,
  currentId: string | undefined,
  /**
   * The registry's record, or `null` for a conversation this run started and nothing has written
   * down yet.
   *
   * The record rather than four fields off it, and **no defaults**, both deliberately.
   *
   * `updatedAt` used to default to `new Date().toISOString()`, which is a generated value wearing
   * an observed one: a default parameter is evaluated per call, so an idle conversation reported
   * the moment the payload was built and reported a new one on every snapshot. Two `describe()`
   * calls a second and a half apart came back a second and a half apart. A default is exactly how
   * that comes back, so there is none — a caller with no record has to hand over `null` and say
   * so.
   *
   * And `agent` used to be looked up with `sessions.find` even when the caller was holding the
   * record it was looking for. One scan of the whole registry per described session; `rowFor`
   * describes every session of every project on every snapshot, so the cost was quadratic in a
   * file that only grows and never prunes.
   */
  record: SessionRecord | null,
): SessionInfo {
  const live = managers.get(id)
  return {
    id,
    // Whose conversation it is. From the registry where there is a record, and from the manager
    // otherwise — a session started this run and not yet written down is the manager's, because
    // an employee's is only ever created by asking for one by name.
    // Live first, then the registry, then the manager. A conversation started this run has not
    // reached the registry yet and still knows perfectly well whose it is — reading the registry
    // first reported a brand-new conversation with the tester as the manager's.
    agent:
      live?.agent ?? record?.agent ?? ((workspace && findManager(workspace.employees)) || 'manager'),
    // A conversation started this run has its title in memory before it reaches the registry.
    title: live?.title ? titleFrom(live.title) : (record?.title ?? null),
    updatedAt: record?.updatedAt ?? null,
    costUsd: live?.state.costUsd ?? record?.costUsd ?? null,
    current: id === currentId,
    running: live?.state.phase === 'running',
  }
}

/**
 * Every conversation this project has had.
 *
 * Read from the registry rather than from memory, because most of them are not running — a
 * project's history outlives the process, which is the point of writing it down.
 *
 * Extracted from the `sessions` handler so the push in {@link pushSessions} and the query answer
 * the same question with the same code. Two implementations of "which conversations are there"
 * would be free to disagree, and the control this feeds exists to say which one you are in.
 */
function sessionListOf(key: string): readonly SessionInfo[] {
  const live = current.get(key)
  // Which conversations belong to this project — including one started this run and not written
  // down yet — is `shownSessions`, in registry.ts. It used to be inline here, and `rowFor` had a
  // second copy of the rule that disagreed with it; see the note there. `managers` is what this
  // process holds, which stays listed when another office has closed it.
  return shownSessions(sessions, key, WORKSPACE_ROOT, liveFor(key), managers).map(({ id, record }) =>
    record === null
      ? describeSession(id, key, live, null)
      : describeSession(id, key, live, record),
  )
}

/**
 * Tell the renderer a project's conversation list changed, and refresh the project rows with it.
 *
 * Both, because they moved for the same reason. `ProjectInfo` now carries how many conversations
 * a project holds, when it was last active and whether one is running — all derived from the
 * registry — so a registry change that pushed only the session list would leave the row above it
 * stating a count that had just stopped being true.
 */
function pushSessions(project: string): void {
  send(CHANNEL.sessionList, { project, sessions: sessionListOf(project) })
  if (workspace) send(CHANNEL.office, toSnapshot(workspace))
}

/**
 * A session id off the wire, or `null`.
 *
 * `null` and `''` both mean "I am not naming one" — an empty string arrives from a renderer
 * that has not opened a conversation yet, and treating it as an id would look up a session
 * called `""` and miss.
 */
function asSession(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * The session with this exact id, if it is in memory.
 *
 * The counterpart to {@link sessionFor}, and the distinction is the whole of the routing fix.
 * `sessionFor(project)` answers *"which conversation is this project showing?"* — main's own
 * idea, which is the right question when nobody else has an opinion and the wrong one when the
 * renderer does. A project is a group of sessions, so "the project's session" stopped being
 * enough information the day a project could have two.
 *
 * Traced by laptop 2 from a real report: typing into one project's chat and watching the reply
 * arrive in another. Not a race — a leak by construction, because the transcript was addressed
 * by session while sending was addressed by project, and the two only agree while a project has
 * exactly one conversation.
 */
function byId(session: string): ManagerSession | undefined {
  return managers.get(session)
}

/**
 * The session the renderer named, or the project's current one if it named none.
 *
 * `null` is a real answer rather than a missing argument: a caller that genuinely does not care
 * which conversation — the first send into a project that has never had one — should get the
 * same behaviour as before. A caller that *does* know must be believed.
 */
function addressed(project: string, session: string | null): ManagerSession {
  const chosen = sessionOf(route(session, current.get(project)))
  if (!chosen) return sessionFor(project)

  const exact = byId(chosen)
  if (exact) return exact
  // Named a conversation we do not have in memory. Adopt it rather than silently substituting
  // the project's current one — substituting is precisely the bug being fixed.
  return openSession(project, chosen)
}

/** The conversation a project is showing, if one is running. Does not start one. */
function liveFor(project: string): ManagerSession | undefined {
  const id = current.get(project)
  return id ? managers.get(id) : undefined
}

/** The conversation to pick back up for one project, if there is one. */
function resumableFor(project: string): SessionRecord | null {
  return resumable(sessions.filter((s) => s.project === project), WORKSPACE_ROOT)
}

/**
 * Write down where the conversation got to.
 *
 * Called on every state change, which is the cheapest reliable moment: it covers a turn
 * starting, a turn ending, and a failure, and none of those can happen without passing through
 * here. A save that fails is reported to the floor rather than logged and forgotten — the
 * consequence is that the next launch will not remember this session, and that is worth
 * knowing before you close the window rather than after.
 */
async function remember(project: string, sessionId: string): Promise<void> {
  const session = managers.get(sessionId)
  if (!session) return

  const now = new Date().toISOString()
  const existing = sessions.find((s) => s.id === session.id)
  const title = session.title ? titleFrom(session.title) : (existing?.title ?? null)

  sessions = upsert(sessions, {
    id: session.id,
    project,
    cwd: WORKSPACE_ROOT,
    // Whose conversation this is, from the session itself. It was hardcoded to the manager,
    // which was true while the manager was the only one you could talk to — and became wrong the
    // moment employees got conversations of their own: every one of them was written down as the
    // manager's, so the switcher had no people to list and reopening one resumed it as the
    // manager. The session has always known; nothing was asking it.
    agent: session.agent,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    costUsd: session.state.costUsd,
    title,
    // Recorded so resuming gives back the conversation that was left, not a fresh one wearing
    // its transcript.
    mode: session.mode,
    // Only a session Claude confirmed is one there is any point resuming.
    opened: session.state.sessionId !== null,
  })

  // The list changed, so say so. This is the funnel every registry change goes through —
  // a conversation created, a title landing, a cost updating — which is why the event is
  // emitted here rather than at each of the three call sites that would have to remember to.
  pushSessions(project)

  try {
    await writeRegistry()
    // A save that went through ends what a failed one reported, of either kind below. The problem
    // `openRegistry` sets for a file it could not read is never cleared here: after that,
    // `writeRegistry` refuses every save.
    setRegistryProblem(null)
  } catch (err) {
    // A save that left a conversation out wrote everything else, so it gets its own words rather
    // than "could not write the session registry". See `registrySaveProblem`.
    setRegistryProblem(registrySaveProblem(WORKSPACE_ROOT, err))
  }
}

/** Change the registry's reported trouble and push a fresh snapshot, so the UI hears about it. */
function setRegistryProblem(problem: Problem | null): void {
  if (registryProblem === problem) return
  registryProblem = problem
  if (workspace) send(CHANNEL.office, toSnapshot(workspace))
}

/** The same, for verdicts the rules reached and the office could not write. */
function setVerdictProblem(problem: Problem | null): void {
  if (verdictProblem === problem) return
  verdictProblem = problem
  if (workspace) send(CHANNEL.office, toSnapshot(workspace))
}

/** Push to the renderer, if there is still one to push to. */
function send(channel: string, ...payload: unknown[]): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, ...payload)
}

// ───────────────────────────────────────────────────────────────────────── IPC ──

function registerHandlers(): void {
  // ─────────────────────────────────────────────────────────────────── the music ──
  //
  // One client, constructed at start and inert until an account exists. The client id lives in
  // the same per-machine settings the interface preferences do, and **not in this repository**:
  // under PKCE it is not a secret, but it is not ours to give either — a shipped id would make
  // every install share one app's rate limits and one redirect whitelist.
  let musicClientId = readMusicClientId()
  let musicConnected = false
  let musicNetwork = networkAllowed()
  const spotify = new Spotify({
    get clientId() {
      return musicClientId
    },
    store: tokenStore(),
    // **The switch, and the only place it is honoured.** Every request this feature can make
    // receives this function and there is no other `fetch` in reach, so a new call site inherits
    // the control by construction rather than by somebody remembering. Read per call, so
    // switching it off stops the next request rather than the next restart.
    fetch: gated(() => musicNetwork === 'on', globalThis.fetch),
    now: () => Date.now(),
  })
  // Read once at start so the privacy panel is right before anybody opens the music, and kept
  // in step by the handlers below rather than re-read per request. With no account file this
  // does not reach the keychain (a missing file is "not connected" by itself); with one it
  // decrypts once, here, at start.
  void spotify.connected().then((yes) => {
    musicConnected = yes
  })

  ipcMain.handle(CHANNEL.musicSetNetwork, async (_e, allowed: unknown) => {
    musicNetwork = allowed === true ? 'on' : 'off'
    setNetworkAllowed(musicNetwork === 'on')
  })

  ipcMain.handle(CHANNEL.musicSetup, async (): Promise<MusicSetup> => ({
    clientId: musicClientId,
    networkAllowed: musicNetwork,
    redirectUri: REDIRECT_URI,
    hosts: SPOTIFY_HOSTS,
    scopes: SPOTIFY_SCOPES,
  }))

  ipcMain.handle(CHANNEL.musicSetClientId, async (_e, id: unknown) => {
    musicClientId = String(id ?? '').trim()
    writeMusicClientId(musicClientId)
  })

  ipcMain.handle(CHANNEL.musicConnect, async () => {
    // Checked here as well as inside the gate, because `connect` opens a *browser* before it
    // makes any request — a refusal that arrives after the user has been sent to Spotify's
    // consent screen would be the control working and looking broken.
    if (musicNetwork !== 'on') {
      return {
        ok: false,
        problem:
          musicNetwork === 'off'
            ? 'Office Space is set not to make its own network requests.'
            : 'The saved network setting could not be read, so nothing is being sent. Set the ' +
              'switch again in the music panel.',
      }
    }
    // Same reason as the network check above: a refusal after Spotify's consent screen would be
    // the control working and looking broken. Not asked when there is no client id — that sign-in
    // cannot start, `spotifyConnect` says so in its own sentence, and asking is not free. (The
    // keychain is also asked by `spotify.connected()` above, whenever an account file exists.)
    if (musicClientId.trim() && !canRemember()) return { ok: false, problem: CANNOT_STORE }
    const result = await spotifyConnect(musicClientId, gated(() => musicNetwork === 'on', globalThis.fetch))
    if (result.ok && result.tokens) {
      try {
        await tokenStore().write(result.tokens)
        musicConnected = true
      } catch (error) {
        // The store refused, or the write failed — a keychain that went away after the check
        // above, or a disk that would not take the file. The sign-in genuinely worked; we simply
        // will not write the token down in the clear, and that is a sentence the user gets to
        // read rather than a silent fallback.
        return { ok: false, problem: error instanceof Error ? error.message : String(error) }
      }
    }
    return { ok: result.ok, problem: result.problem }
  })

  ipcMain.handle(CHANNEL.musicDisconnect, async () => {
    await spotify.disconnect()
    musicConnected = false
  })

  ipcMain.handle(CHANNEL.musicPlayer, () => spotify.player())
  ipcMain.handle(CHANNEL.musicCommand, (_e, what: unknown, deviceId: unknown) =>
    spotify.command(what as 'play' | 'pause' | 'next' | 'previous', deviceId ? String(deviceId) : undefined),
  )
  ipcMain.handle(CHANNEL.musicTransfer, (_e, deviceId: unknown, play: unknown) =>
    spotify.transferTo(String(deviceId ?? ''), Boolean(play)),
  )
  ipcMain.handle(CHANNEL.musicSearch, (_e, query: unknown) => spotify.search(String(query ?? '')))
  ipcMain.handle(CHANNEL.musicPlayTrack, (_e, uri: unknown, deviceId: unknown) =>
    spotify.playTrack(String(uri ?? ''), deviceId ? String(deviceId) : undefined),
  )

  ipcMain.handle(CHANNEL.describe, () => rescan())

  /**
   * One agent's art.
   *
   * The drawn cast arrives as pixels; an installed pack arrives as the file plus where to cut
   * it, because decoding a PNG is something the renderer already does and the main process
   * would have to be taught. Both leave the renderer as the same bitmaps.
   *
   * A pack that cannot be read here falls back to the drawn cast **and says so** — the whole
   * point of the theme seam is that somebody who paid for art finds out when it does not work.
   */
  ipcMain.handle(CHANNEL.sprites, async (_event, agentName: unknown): Promise<SpriteSheet> => {
    const who = String(agentName)
    const pack = activePack()

    if (pack) {
      const sheet = pack.sheets[sheetIndexFor(who, pack.sheets.length)]
      if (sheet) {
        try {
          const png = await readFile(join(pack.directory, sheet))
          return {
            kind: 'sheet',
            png: new Uint8Array(png),
            frameWidth: pack.frameWidth,
            frameHeight: pack.frameHeight,
            rows: pack.layout.rows,
            steps: pack.layout.steps,
          }
        } catch (err) {
          reportThemeFailure(pack.id, join(pack.directory, sheet), (err as Error).message)
        }
      }
    }

    // The agent's own description, so the look is a function of their file rather than of their
    // name alone. Absent for a name that is not on the roster — which is a real case while a
    // rescan is in flight — and an empty string is the right answer there rather than a throw.
    const description = workspace?.employees.find((e) => e.id === who)?.description ?? ''
    const frames = proceduralTheme.framesFor(who, description)
    return { kind: 'painted', width: frames.width, height: frames.height, frames: frames.frames }
  })

  ipcMain.handle(CHANNEL.theme, async (_event, id: unknown) => {
    const wanted = String(id ?? PROCEDURAL_THEME_ID)
    themeId = wanted === PROCEDURAL_THEME_ID || packs.some((p) => p.id === wanted) ? wanted : PROCEDURAL_THEME_ID
    if (workspace) send(CHANNEL.office, toSnapshot(workspace))
  })

  ipcMain.handle(
    CHANNEL.send,
    async (_event, project: unknown, session: unknown, text: unknown) => {
      const message = String(text ?? '').trim()
      if (!message) return
      // The renderer names the conversation. It has already rendered your words into that
      // transcript, so main resolving a different one is how the words and the run end up in
      // two different places.
      await addressed(String(project ?? OFFICE_PROJECT), asSession(session)).send(message)
    },
  )

  ipcMain.handle(
    CHANNEL.interrupt,
    (_event, project: unknown, session: unknown): readonly string[] => {
      // The conversation the renderer named, not whichever one this project happens to think
      // is current. Stopping the wrong run is worse than not stopping at all.
      const id = asSession(session)
      const live = id ? byId(id) : liveFor(String(project ?? OFFICE_PROJECT))
      return live?.interrupt() ?? []
    },
  )

  /**
   * What an employee actually did on this project.
   *
   * Read from the employee's own record rather than from the manager's account of it. The
   * manager's account is a report, and the second standing order is that reports are checked.
   */
  ipcMain.handle(CHANNEL.work, async (_event, project: unknown, agent: unknown): Promise<EmployeeWork | null> => {
    const key = String(project ?? OFFICE_PROJECT)
    const who = String(agent ?? '')
    if (!who) return null

    // The live session if there is one, otherwise the one we would resume. Reopening the app
    // and clicking an employee should show what they did yesterday — the record is on disk
    // whether or not anything has been said since launch.
    const live = liveFor(key)
    const sessionId = live?.state.sessionId ?? resumableFor(key)?.id ?? null
    if (!sessionId) return null

    const scan = await scanSubagents(sessionId, WORKSPACE_ROOT)

    // Nobody has been dispatched in this project. Genuinely nothing to show.
    if (scan.state === 'none') return null

    if (scan.state === 'unreadable') {
      return {
        brief: '',
        toolUseId: '',
        entries: [],
        truncated: 0,
        problem: `Their record could not be read: ${scan.cause}`,
      }
    }

    const run = latestFor(scan.runs, who)
    if (!run) return null

    const transcript = parseTranscript(run.jsonl, { includeSidechain: true })
    const entries = transcript.entries.slice(-RESTORE_LIMIT)

    return {
      brief: run.description,
      toolUseId: run.toolUseId,
      entries,
      truncated: transcript.entries.length - entries.length,
      problem: null,
    }
  })

  /**
   * Every conversation this project has had.
   *
   * Read from the registry rather than from memory, because most of them are not running —
   * a project's history outlives the process, which is the point of writing it down.
   */
  ipcMain.handle(CHANNEL.sessions, (_event, project: unknown): readonly SessionInfo[] =>
    sessionListOf(String(project ?? OFFICE_PROJECT)),
  )

  /**
   * Move a conversation to another mode.
   *
   * **The only way a mode changes.** Nothing the manager can say moves it, which is the whole
   * feature: a mode the model could leave when it felt ready is "ask two questions then build"
   * wearing a state machine.
   *
   * Takes effect on the next turn. A turn already in flight was spawned with the tool set of the
   * mode it started in, and no flag can take a tool away from a running process — claiming
   * otherwise would be the app reporting an enforcement it does not have.
   */
  ipcMain.handle(CHANNEL.setMode, async (_event, project: unknown, mode: unknown): Promise<SessionState> => {
    const key = String(project ?? OFFICE_PROJECT)
    if (!isMode(mode)) throw new Error(`not a mode: ${String(mode)}`)

    const session = sessionFor(key) ?? openSession(key, null)
    const from = session.setMode(mode)

    // `null` means it was already there. No event, because nothing moved — a mode change event
    // for a mode that did not change would train every listener to check before trusting it.
    if (from) {
      send(CHANNEL.sessionMode, { project: key, sessionId: session.id, from, to: mode })
      // Written down so resuming gives back the conversation that was left. `remember` is the
      // one funnel the registry changes through, and it also pushes the session list.
      await remember(key, session.id)
    }
    return session.state
  })

  ipcMain.handle(CHANNEL.openSession, (_event, project: unknown, id: unknown): SessionInfo => {
    const key = String(project ?? OFFICE_PROJECT)
    const session = openSession(key, typeof id === 'string' && id ? id : null)
    // `current` just moved, which changes every other row's tag as well as this one's. The
    // caller learns its own answer from the return value; everything else showing the list
    // learns from the event, and without it a second view of the same list keeps a stale tick.
    pushSessions(key)
    // The record if this resumed one, `null` if it is new — the same distinction the list makes,
    // asked the same way rather than assumed either direction.
    return describeSession(session.id, key, session.id, recordFor(session.id))
  })

  /**
   * Open a conversation with one employee, resuming theirs if they have one here.
   *
   * One session per employee per project, found by looking rather than tracked separately — the
   * registry already carries `agent` on every record, so whose conversation it is has been
   * written down since the registry existed and nothing new has to be kept in step.
   */
  ipcMain.handle(CHANNEL.openAgentSession, (_event, project: unknown, agent: unknown): SessionInfo => {
    const key = String(project ?? OFFICE_PROJECT)
    const who = String(agent ?? '')

    const theirs = conversationWith(sessions, key, WORKSPACE_ROOT, who)

    const session = openSession(key, theirs?.id ?? null, who)
    pushSessions(key)
    return describeSession(session.id, key, session.id, recordFor(session.id))
  })

  /** A project's tasks, as they stand. Runs nothing. */
  ipcMain.handle(CHANNEL.tasks, (_event, project: unknown): Promise<TaskReport> =>
    checkProject(WORKSPACE_ROOT, String(project ?? OFFICE_PROJECT)),
  )

  /**
   * Check the work.
   *
   * The office runs, unattended, exactly what this workspace's `permissions.allow` already
   * says it may. Anything else waits for somebody to click that specific task having read that
   * specific command — and a rule that says no is never overridden by either.
   *
   * `checkPressed` reads the press before acting on it, and refuses one it cannot read rather than
   * falling back to running everything. The reasoning is on it, in `harness.ts`, because that is
   * where a test can reach it.
   */
  ipcMain.handle(
    CHANNEL.verify,
    (_event, project: unknown, only: unknown, force: unknown): Promise<TaskReport> =>
      checkPressed(WORKSPACE_ROOT, String(project ?? OFFICE_PROJECT), only, force),
  )

  /**
   * Where the office keeps the program that hears you.
   *
   * `userData`, not the app bundle: a signed bundle is read-only and a model is 148MB, so
   * shipping one inside the app would mean every user downloading it whether or not they ever
   * press the mic.
   */
  const dictationHome = (): string => join(app.getPath('userData'), 'whisper')

  ipcMain.handle(CHANNEL.dictation, async (): Promise<DictationSetup> => {
    const found = await findWhisper({ own: dictationHome(), path: process.env['PATH'] })
    if (found.state === 'ready') return { ready: true }

    // The honest fix, named. A setup screen that says "not configured" and stops has moved the
    // problem rather than solved it.
    return {
      ready: false,
      missing: found.missing,
      detail: found.detail,
      fix:
        found.missing === 'binary'
          ? 'brew install whisper-cpp'
          : `curl -L -o "${join(dictationHome(), MODEL_FILE)}" ${MODEL_URL}`,
    }
  })

  ipcMain.handle(CHANNEL.dictationModel, () =>
    fetchModel(dictationHome(), gated(() => musicNetwork === 'on', globalThis.fetch)),
  )
  ipcMain.handle(CHANNEL.dictationInstall, () => installWhisper(() => musicNetwork === 'on'))

  /**
   * The operating system's permission, which is not the same thing as the browser's.
   *
   * macOS remembers this answer and there is no way to ask again from inside the app — a person
   * who said no once has to go to System Settings. So a denial is reported as *that*, rather than
   * as a generic failure that sends them looking at their microphone cable.
   */
  ipcMain.handle(CHANNEL.micAccess, async (): Promise<{ granted: boolean; reason?: string }> => {
    if (process.platform !== 'darwin') return { granted: true }

    const already = systemPreferences.getMediaAccessStatus('microphone')
    if (already === 'granted') return { granted: true }
    if (already === 'denied' || already === 'restricted') {
      return {
        granted: false,
        reason:
          'macOS is blocking the microphone for this app. Open System Settings → Privacy & ' +
          'Security → Microphone and switch Office Space on. It cannot be re-asked from here.',
      }
    }

    const granted = await systemPreferences.askForMediaAccess('microphone')
    return granted ? { granted: true } : { granted: false, reason: 'The microphone was not allowed.' }
  })

  ipcMain.handle(CHANNEL.transcribe, async (_event, wav: unknown): Promise<Dictated> => {
    if (!(wav instanceof ArrayBuffer) && !ArrayBuffer.isView(wav)) {
      return { ok: false, text: '', reason: 'That recording did not arrive as audio.' }
    }

    const found = await findWhisper({ own: dictationHome(), path: process.env['PATH'] })
    if (found.state !== 'ready') {
      return { ok: false, text: '', reason: found.detail }
    }

    const bytes = wav instanceof ArrayBuffer ? new Uint8Array(wav) : new Uint8Array(wav.buffer)
    const said = await transcribe({ whisper: found.whisper, wav: bytes })
    return said.ok ? { ok: true, text: said.text } : { ok: false, text: '', reason: said.reason ?? 'Transcription failed.' }
  })

  ipcMain.handle(CHANNEL.voice, (_event, on: unknown) => {
    voiceOn = on === true
    // Turning it off drops whatever was building up. Coming back on should not open with a
    // summary of a quarter of an hour you deliberately asked not to hear about.
    if (!voiceOn) recorders.clear()
  })

  /**
   * Everything typeable after a slash.
   *
   * Commands and skills in one list, because from the composer they are the same gesture. Read
   * on demand rather than cached: a command is a file somebody just wrote, and the most likely
   * moment to open this menu is immediately after writing one.
   *
   * The office **expands nothing**. `--print` already resolves a slash command before the model
   * sees it, so this list exists only to *offer* the names. That matters more than it sounds:
   * an unknown command never reaches the model at all — the CLI answers it synthetically, at
   * zero tokens and zero cost — so a typo is **silent** rather than an error. Discovery is what
   * turns a silent nothing into a list you can pick from.
   */
  ipcMain.handle(CHANNEL.commands, async (): Promise<CommandList> => {
    const scan = await discoverCommands(WORKSPACE_ROOT)
    const commandNames = new Set(scan.commands.map((c) => c.name))

    const commands: Invocable[] = scan.commands.map((c) => ({
      name: c.name,
      description: c.description,
      argumentHint: c.argumentHint,
      kind: 'command' as const,
      // A project command shadows a same-named skill — measured against the real CLI. Both are
      // listed, and the shadowed one says so, because they do different things once invoked.
      ...(workspace?.skills.some((s) => s.id === c.name) ? { shadowsSkill: true } : {}),
    }))

    const skills: Invocable[] = (workspace?.skills ?? [])
      .filter((skill) => !commandNames.has(skill.id))
      .map((skill) => ({
        name: skill.id,
        description: skill.description,
        // A skill's arguments are described in its own prose, not in a frontmatter field.
        argumentHint: null,
        kind: 'skill' as const,
      }))

    return {
      items: [...commands, ...skills].sort((a, b) => a.name.localeCompare(b.name)),
      problems: scan.problems,
    }
  })

  /**
   * An outcome, whatever happens — including the thing nobody wrote a branch for.
   *
   * `RosterOutcome` is a union whose whole purpose is carrying a failure, and seven handlers
   * returned one while letting a **throw** escape as a rejected `invoke`. Measured: with
   * `.office-space/` read-only, closing a conversation produced
   *
   *     Something in the office went wrong: EACCES: permission denied, open '…'
   *
   * — the generic renderer-wide notice, on a call that had a field for exactly this and did not
   * use it. Before the mishap surface landed this morning it produced nothing at all.
   *
   * The verb is passed rather than derived, because *"could not close this conversation"* is the
   * half a person can act on and the errno is the half they can report. `rosterOp` is the
   * expected-failure half and this is the unexpected one; both end in the same union, which is
   * the point — a caller should not have to know which kind of failure it was to show it.
   */
  const outcomeOf = async (verb: string, run: () => Promise<RosterOutcome>): Promise<RosterOutcome> => {
    try {
      return await run()
    } catch (err) {
      return { ok: false, reason: `Could not ${verb}: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /**
   * Hiring, firing, and sending somebody home.
   *
   * Each writes a file and then rescans, so the floor updates from **discovery** rather than
   * from what this handler believes it just did. That is the same rule the whole app runs on:
   * the filesystem says who exists, and a hire the write silently failed at must not appear on
   * the floor because we assumed it worked.
   */
  const rosterOp = async (
    run: () => Promise<{ ok: true; path: string } | { ok: false; reason: string }>,
  ): Promise<RosterOutcome> =>
    outcomeOf('finish that', async () => {
    const got = await run()
    if (!got.ok) return { ok: false, reason: got.reason }
    // Rescan before answering, and answer *with* what the rescan found. The renderer used to be
    // left to pick that up from the `office` broadcast, which is a different message on a
    // different channel — so a panel redrawn on this reply could show the office as it was
    // before the write. Handing it back here is the only version of this with nothing to race.
    // `rescan()` ends in `return toSnapshot(workspace)`, so the answer is already built — this
    // used to discard it and call `toSnapshot` a second time on the same state.
      const office = await rescan()
      return { ok: true, office }
    })

  ipcMain.handle(CHANNEL.hire, (_e, request: unknown): Promise<RosterOutcome> => {
    const r = (request ?? {}) as Record<string, unknown>
    return rosterOp(() =>
      hire(WORKSPACE_ROOT, {
        id: String(r['id'] ?? '').trim(),
        description: String(r['description'] ?? ''),
        tools: Array.isArray(r['tools']) ? (r['tools'] as string[]) : null,
        model: typeof r['model'] === 'string' && r['model'] ? r['model'] : null,
        prompt: String(r['prompt'] ?? ''),
      }),
    )
  })

  // The manager the office is actually running on, not the default name. `staffRows` withholds
  // both buttons from whoever `findManager` picked, and passing the same answer down is what
  // makes the check in `roster.ts` the guarantee behind that rather than a narrower rule that
  // happens to agree in the common case. `null` on an empty workspace falls back to the default,
  // which is the right answer for a directory with nobody in it.
  const managerNow = (): string | undefined =>
    (workspace ? findManager(workspace.employees) : null) ?? undefined

  ipcMain.handle(CHANNEL.fireAgent, (_e, id: unknown) =>
    rosterOp(() => fire(WORKSPACE_ROOT, String(id ?? ''), managerNow())),
  )
  ipcMain.handle(CHANNEL.disableAgent, (_e, id: unknown) =>
    rosterOp(() => disable(WORKSPACE_ROOT, String(id ?? ''), managerNow())),
  )
  ipcMain.handle(CHANNEL.enableAgent, (_e, id: unknown) =>
    rosterOp(() => enable(WORKSPACE_ROOT, String(id ?? ''))),
  )
  ipcMain.handle(CHANNEL.benched, (): Promise<readonly string[]> => benched(WORKSPACE_ROOT))

  ipcMain.handle(CHANNEL.addSkill, (_e, skill: unknown): Promise<RosterOutcome> => {
    const r = (skill ?? {}) as Record<string, unknown>
    return rosterOp(() =>
      addSkill(WORKSPACE_ROOT, {
        id: String(r['id'] ?? '').trim(),
        description: String(r['description'] ?? ''),
        body: String(r['body'] ?? ''),
      }),
    )
  })

  ipcMain.handle(CHANNEL.removeSkill, (_e, id: unknown) =>
    rosterOp(() => removeSkill(WORKSPACE_ROOT, String(id ?? ''))),
  )

  /**
   * What the office remembers.
   *
   * Read on every open. `memory/` is written by the memory-keeper between turns, so a value
   * cached at boot would be stale by the time anybody opened the panel — and this is the one
   * surface whose whole subject is whether something is known.
   */
  ipcMain.handle(CHANNEL.memory, (): Promise<MemoryReport> => readMemory(WORKSPACE_ROOT))
  ipcMain.handle(CHANNEL.decided, (): Promise<DecisionReport> => readDecided(WORKSPACE_ROOT))

  /**
   * What each dispatch changed, most recent first.
   *
   * Joins two records that were written separately and on purpose: the ledger's row, which is
   * appended the moment the manager asks for somebody, and the change file, which cannot exist
   * until the run ends. A dispatch with a row and no file has not finished — which is a third
   * thing, distinct from *finished and changed nothing* and from *the record could not be read*,
   * and `summarise` keeps all three apart on screen.
   *
   * A ledger that cannot be read returns nothing rather than an empty list, because "no dispatch
   * has ever changed anything" is a sentence, and it would be a false one.
   */
  ipcMain.handle(CHANNEL.changed, async (): Promise<readonly DispatchRow[]> => {
    const state = await loadLedger(WORKSPACE_ROOT)
    if (state.state !== 'ok') return []

    /*
     * Every record, not only the ones the ledger names.
     *
     * The ledger holds dispatches. The manager's own turns are in no ledger — it was never
     * dispatched — so a panel built from `ledger.sent` alone omits the one writer that is always
     * present. The directory is the list; `about` inside each record carries the little that a
     * row needs and the ledger cannot supply.
     */
    const ids = await listChanges(WORKSPACE_ROOT)
    const dispatchIds = new Set(state.ledger.sent.map((d) => d.id))
    const found = new Map<string, Awaited<ReturnType<typeof readChanges>>>()
    for (const id of ids ?? [...dispatchIds]) found.set(id, await readChanges(WORKSPACE_ROOT, id))
    for (const d of state.ledger.sent) {
      if (!found.has(d.id)) found.set(d.id, await readChanges(WORKSPACE_ROOT, d.id))
    }

    /*
     * A row for each turn the manager changed something in. `about.who` is who it was at the
     * time, not who the manager is now — a record written when `ariel` ran the office should not
     * be relabelled because somebody has since been promoted.
     */
    const ownTurns: SentDispatch[] = []
    for (const [id, got] of found) {
      if (dispatchIds.has(id) || !got.ok || got.about === null) continue
      ownTurns.push({
        id,
        employee: got.about.who,
        // Not a brief. Nobody briefed the manager — this says what the row *is*, which is the
        // question somebody has on meeting a row with no task attached to it.
        brief: 'Changed these in its own turn, rather than dispatching somebody.',
        sentAt: got.about.at,
      })
    }

    // One definition of "still out", the ledger's own — see `unfinished()`.
    const out = new Set(unfinished(state.ledger).map((d) => d.id))

    return rowsFor(
      newestSentFirst([...state.ledger.sent, ...ownTurns]),
      (id) => {
        const got = found.get(id)
        const stillOut = out.has(id)
        if (!got) return { changes: null, problem: null, undone: null, stillOut }
        return got.ok
          ? { changes: got.changes, problem: null, undone: got.undone, stillOut }
          : { changes: null, problem: got.reason, undone: null, stillOut }
      },
      whatIsNotShown,
    )
  })

  /*
   * Put back what one dispatch changed.
   *
   * The only handler in this file that writes over a file the office did not just create, so it
   * is the one place a bug here costs somebody work rather than a stale panel. Every rule it
   * applies is in `shared/undo.ts` and every refusal comes back as text; this hands over the
   * workspace root and returns what happened.
   */
  /*
   * Search the workspace.
   *
   * Read on demand rather than indexed. An index would have to be kept in step with four
   * independent sources, and a stale index answering "nothing found" is precisely the lie this
   * feature is built to avoid — so it reads at the moment somebody asks, and says what it could
   * not read.
   */
  ipcMain.handle(CHANNEL.search, async (_e, query: unknown): Promise<Searched> => {
    if (typeof query !== 'string') return { hits: [], looked: [], blind: [] }
    try {
      return await searchWorkspace(WORKSPACE_ROOT, query)
    } catch (err) {
      // A throw here is itself a blind spot, and saying so beats an empty result that reads as
      // an answer — for *every* source, since nothing was read.
      return nothingWasSearched(`the search failed — ${(err as Error).message}`)
    }
  })

  ipcMain.handle(CHANNEL.undo, async (_e, dispatch: unknown): Promise<UndoResult> => {
    if (typeof dispatch !== 'string' || dispatch === '') {
      return { ok: false, why: ['The office was asked to put back a dispatch it cannot identify.'] }
    }
    try {
      return await undoDispatch(WORKSPACE_ROOT, dispatch)
    } catch (err) {
      /*
       * A throw here means a partial write is possible — the resolve passed and a later write
       * failed. Saying so is the whole point: "could not put everything back" sends somebody to
       * look, and a swallowed error leaves them believing the tree is as it was.
       */
      return { ok: false, why: [`The office could not put everything back — ${(err as Error).message}`] }
    }
  })

  /*
   * Put the project template into a workspace that has none.
   *
   * The only writer in this file that puts files into a directory the *user* named rather than
   * one the office made — so it exists because somebody pressed a button that says what it does,
   * and it copies rather than generating: a scaffold synthesised here would be a second, worse
   * definition of what a project is, next to the one that ships.
   */
  ipcMain.handle(CHANNEL.addTemplate, async (): Promise<{ ok: boolean; reason: string | null }> => {
    const got = await addProjectTemplate(WORKSPACE_ROOT, TEMPLATE_ROOT)
    return got.ok ? { ok: true, reason: null } : { ok: false, reason: got.reason }
  })

  /*
   * What runs on a hook here — VISION.md §2's last unsurfaced item.
   *
   * `homedir()` and the manifest path are passed in rather than reached for inside, so the reader
   * stays testable and so this file remains the only place that decides where either lives.
   *
   * The user's own `~/.claude/settings.json` is consulted because a hook declared there fires on
   * every tool call made in this workspace. That is a read outside the workspace and it is not
   * the privacy panel's subject, which is what the office *writes into* one.
   */
  /*
   * How full the plan is, as last measured.
   *
   * Returns the held value and interprets nothing. Which plan this is, whether the numbers are
   * flattering, and what they mean are all the CLI's to say — this hands over what it said and
   * when, and `plan-usage.ts` turns that into sentences on the other side of the boundary.
   */
  ipcMain.handle(CHANNEL.planUsage, (): PlanReading => planReadingNow)

  ipcMain.handle(
    CHANNEL.hooks,
    (): Promise<HooksReport> => readHooks(WORKSPACE_ROOT, { home: homedir(), manifestPath: MANIFEST_PATH }),
  )

  /*
   * Employees a colleague maintains — VISION.md's fourth section.
   *
   * The four handlers below share one rule: every fact shown is read now, not remembered. The
   * digest a browse found is not the digest hiring records, and the standing the panel drew is not
   * the standing an update is allowed against. Both re-read, because the thing between them is a
   * person deciding, and people take their time.
   */
  const today = (): string => new Date().toISOString().slice(0, 10)

  ipcMain.handle(CHANNEL.maintainedElsewhere, async (_e, look: unknown): Promise<readonly MaintainedRow[]> => {
    const records = await recordedHires(WORKSPACE_ROOT)
    const found = look === true ? await checkOnThem(records, () => musicNetwork === 'on') : new Map<string, Found>()
    return Promise.all(
      records.map(async (record) => {
        const seen = found.get(record.id) ?? null
        return {
          id: record.id,
          source: record.source,
          hiredAt: record.hiredAt,
          standing: standingOf(record, await ourCopy(WORKSPACE_ROOT, record.id), seen),
          detail: seen && !seen.seen ? seen.detail : null,
        }
      }),
    )
  })

  ipcMain.handle(CHANNEL.offeredBy, async (_e, at: unknown, kind: unknown): Promise<OfferedFromSource> => {
    const where = String(at ?? '').trim()
    if (!where) return { problem: 'Give a repository URL or a directory on this machine.' }
    const browsed = await browseSource(where, kind === 'directory' ? 'directory' : 'git', () => musicNetwork === 'on')
    if ('problem' in browsed) return browsed
    // Whether the name is free is decided here, where the roster is, rather than in the panel —
    // and it is shown *before* the click, because "already taken" is a fact about this office and
    // there is no reason to make somebody discover it by being refused.
    const here = new Set((workspace?.employees ?? []).map((e) => e.id))
    return {
      offered: browsed.offered.map((o) => ({
        file: o.file,
        id: o.id,
        description: o.description,
        taken: here.has(o.id),
      })),
    }
  })

  ipcMain.handle(CHANNEL.hireFromSource, (_e, at: unknown, kind: unknown, id: unknown): Promise<RosterOutcome> => {
    const where = String(at ?? '').trim()
    const kindOf = kind === 'directory' ? ('directory' as const) : ('git' as const)
    const who = String(id ?? '').trim()
    return outcomeOf('hire them', async () => {
      const browsed = await browseSource(where, kindOf, () => musicNetwork === 'on')
      if ('problem' in browsed) return { ok: false, reason: browsed.problem }
      const offered = browsed.offered.find((o) => o.id === who)
      if (!offered) {
        return { ok: false, reason: `${who} is not at that source any more. Look again to see who is.` }
      }
      const written = await hireFrom(WORKSPACE_ROOT, { kind: kindOf, at: where, file: offered.file }, offered, today())
      if (!written.ok) return { ok: false, reason: written.reason }
      return { ok: true, office: await rescan() }
    })
  })

  ipcMain.handle(CHANNEL.takeTheirVersion, (_e, id: unknown): Promise<RosterOutcome> => {
    const who = String(id ?? '').trim()
    return outcomeOf('take their version', async () => {
      const record = (await recordedHires(WORKSPACE_ROOT)).find((r) => r.id === who)
      if (!record) return { ok: false, reason: `Nothing recorded about where ${who} came from.` }

      const theirs = await readFromSource(record.source, () => musicNetwork === 'on')
      if ('problem' in theirs) return { ok: false, reason: theirs.problem }

      /*
       * The check the panel already did, done again against this instant.
       *
       * The button is hidden when an update is unsafe — but the panel that hid it was drawn
       * before somebody read the diff and thought about it, and in between they may have edited
       * the file. This is the write that would lose that, so this is where the guarantee belongs.
       * `views/hire.ts` says the same thing about names: a renderer check is a courtesy.
       */
      const standing = standingOf(record, await ourCopy(WORKSPACE_ROOT, who), {
        seen: true,
        hash: digestOfAgentFile(theirs.content),
      })
      if (!updateIsSafe(standing)) return { ok: false, reason: saidPlainly(standing) }

      const took = await takeTheirs(WORKSPACE_ROOT, record, theirs.content, today())
      if (!took.ok) return { ok: false, reason: took.reason }
      return { ok: true, office: await rescan() }
    })
  })


  /*
   * Connectors — VISION.md's sixth section, the half that was missing.
   *
   * `capabilities.ts` could read `.mcp.json` since the workspace shipped. Nothing could add to it,
   * so "how do I connect Slack" ended in *leave the office and edit a JSON file*. These write it.
   */
  ipcMain.handle(CHANNEL.projectServers, (): Promise<readonly string[]> => projectServers(WORKSPACE_ROOT))

  ipcMain.handle(CHANNEL.whatWouldBeShared, (): Promise<readonly SharingRow[]> => whatWouldBeShared(WORKSPACE_ROOT))

  ipcMain.handle(CHANNEL.connectService, (_e, request: unknown): Promise<RosterOutcome> => {
    const r = (request ?? {}) as Record<string, unknown>
    const headers = Array.isArray(r['headers']) ? (r['headers'] as Record<string, unknown>[]) : []
    return outcomeOf('write that connector', async () => {
      const wrote = await connect(WORKSPACE_ROOT, {
        name: String(r['name'] ?? ''),
        transport: r['transport'] === 'http' || r['transport'] === 'sse' ? r['transport'] : 'stdio',
        command: String(r['command'] ?? ''),
        args: Array.isArray(r['args']) ? (r['args'] as unknown[]).map(String) : [],
        url: String(r['url'] ?? ''),
        envKeys: Array.isArray(r['envKeys']) ? (r['envKeys'] as unknown[]).map(String) : [],
        headers: headers.map((h) => ({ header: String(h['header'] ?? ''), from: String(h['from'] ?? '') })),
      })
      if (!wrote.ok) return { ok: false, reason: wrote.reason }
      return { ok: true, office: await rescan() }
    })
  })

  ipcMain.handle(CHANNEL.disconnectService, (_e, name: unknown): Promise<RosterOutcome> =>
    outcomeOf('remove that connector', async () => {
      const gone = await disconnect(WORKSPACE_ROOT, String(name ?? '').trim())
      if (!gone.ok) return { ok: false, reason: gone.reason }
      return { ok: true, office: await rescan() }
    }),
  )

  /**
   * The shelf, joined to what has actually been used.
   *
   * Read out of this project's own conversations rather than a counter, so this number and the
   * animation that walks somebody to the shelf are two readers of one fact.
   */
  ipcMain.handle(CHANNEL.shelf, async (_e, project: unknown): Promise<readonly ShelfRow[]> => {
    const key = String(project ?? OFFICE_PROJECT)
    const entries: TimelineEntry[] = []

    for (const record of sessions.filter((s) => s.project === key)) {
      const read = await readTranscript(record.id, record.cwd)
      // A transcript we cannot read contributes nothing, and that is deliberate: the count is
      // "what we can see happened", and better slightly low than invented.
      if (read.state === 'ok') entries.push(...parseTranscript(read.jsonl).entries)
    }

    return shelfReport(workspace?.skills ?? [], skillUse(entries))
  })
  /**
   * Re-read the two facts about the machine, then rescan.
   *
   * `describe()` deliberately does not do this: it runs on every roster write and every
   * file-watch event, and walking the PATH for a binary on each of those would be waste. But
   * they are the two things a person has just changed when they press "Look again" — they have
   * installed `claude`, or run it once and accepted the trust prompt — and a button that
   * re-reads everything *except* those would report no change while they watched it change.
   */
  ipcMain.handle(CHANNEL.recheck, async (): Promise<OfficeSnapshot> => {
    claudeProblem = null
    trustProblem = null
    await findClaude()
    await checkTrust()
    return rescan()
  })

  /**
   * What is on disk, what can leave the machine, and the exact text of the last prompt sent.
   *
   * The egress list is assembled here rather than in `privacy.ts` because only this process
   * knows what the CLI actually reported. It lists:
   *
   * - **The `claude` binary**, on the user's own login and with their own credentials.
   * - **Each MCP server**, reached by that binary and not by us, carrying whichever status the
   *   CLI last gave it — `configured` is not `connected`, and this panel is the last place
   *   those should be conflated.
   * - **The hosts Office Space fetches from itself**, the Spotify controller's and the speech
   *   model's, each explained where its rows are built below. `main.ts` hands both the `gated`
   *   fetch, which the network switch in the music panel turns off.
   * - **Two programs this app starts that can download without a fetch**, `git clone` of a hiring
   *   source (`hired-from.ts`) and `brew install whisper-cpp` (`installWhisper`). Both ask that
   *   same switch before they start, and `privacy.ts` builds their rows and says why none of them
   *   is ever live.
   *
   * `test/privacy.test.ts` holds the fetch half of that list to the source. It fails on `fetch`,
   * `node:http` and friends in any module under `src/` it does not exempt — the ones named in its
   * `MAY_REACH_THE_NETWORK`, and the dev harness's `mock.ts` — and on a named module that never
   * mentions its `HOSTS`. It cannot see a spawned program. A panel promising "no network" in an
   * app that has quietly grown one is worse than no panel at all.
   */
  ipcMain.handle(CHANNEL.privacy, async (_e, project: unknown) => {
    const key = String(project ?? OFFICE_PROJECT)
    const scan = await scanCapabilities(WORKSPACE_ROOT, { home: homedir() })
    const dictationReady = (await findWhisper({ own: dictationHome(), path: process.env['PATH'] })).state === 'ready'
    const hired = await recordedHires(WORKSPACE_ROOT)

    const egress: Egress[] = [
      {
        what: claudePath ?? 'claude',
        who: 'the claude CLI',
        detail:
          'Spawned as a child process. It talks to Anthropic on the login you already have; this app never sees a credential.',
        active: true,
      },
      ...scan.mcp.servers.map((server): Egress => {
        const status = liveMcpStatus.get(server.name) ?? 'configured'
        return {
          what: server.name,
          who: 'the claude CLI',
          detail: `${server.transport} · ${server.scope} scope · ${status}`,
          // Written down is not reachable. Only a server the CLI said it connected to is live.
          active: status === 'connected',
        }
      }),
      // The music.
      //
      // **Listed whether or not it is connected**, and that is the point of the row rather than
      // an oversight: somebody opening this panel is asking what this app *can* reach, and an
      // entry that appears only once you have already used it answers the wrong question. The
      // `active` flag carries the difference, and while it is false the app has made no request
      // to any of these hosts — `musicPlayer()` answers `disconnected` without asking anybody.
      ...SPOTIFY_HOSTS.map((host): Egress => ({
        what: host,
        who: 'office-space',
        detail:
          musicNetwork === 'off'
            ? 'Spotify controller — switched off. No request to this host can be made while the switch is off.'
            : musicNetwork === 'unreadable'
              ? 'Spotify controller — the saved setting could not be read, so it is being held off. Set the ' +
                'switch again in the music panel.'
              : musicConnected
            ? 'Spotify controller — connected. Only a search you type and a device you pick are ever sent.'
            : 'Spotify controller — not connected. No requests are made to this host until you connect an account.',
        // Off means off: a switched-off destination is not reachable, whatever else is true.
        active: musicNetwork === 'on' && musicConnected,
      })),
      // The speech model.
      //
      // Listed on the same principle as the music: somebody opening this panel is asking what
      // this app *can* reach, and a row that appears only after you have used dictation answers
      // the wrong question. One request, once — the model file — and then never again. **What
      // you say is never sent anywhere**: it is written to a temporary file, read by a program
      // on this machine, and deleted. That is the whole reason the model is downloaded at all.
      //
      // Mapped over `SPEECH_HOSTS`, not written as `MODEL_HOST`, and the difference is the whole
      // point of the row. `transcribe.ts` says "the privacy panel lists this array as the
      // complete set of destinations, so a request built against a host that is not in it would
      // make the panel wrong" — and the panel was listing `HOSTS[0]`, which is the same thing
      // only while the array has one element in it. A second host would have been reachable and
      // unlisted, and the sentence promising otherwise would have stayed exactly as true-looking
      // as it is now. The music rows above already spread their array; this one did not.
      //
      // And the array is still not the whole set, which is the other half of this row. The model
      // URL answers 302 to `us.aws.cdn.hf.co` every time, so a list built from the *request*
      // describes somewhere the connection does not go. A suffix rather than a host because the
      // CDN is regional and rotates; `transcribe.ts` refuses any hop outside it and any hop that
      // drops to plaintext.
      ...speechEgress(SPEECH_HOSTS, DOWNLOAD_SUFFIXES[0]!, dictationReady),
      // Hiring, and dictation's installer. Each starts a program that downloads — `git clone`,
      // `brew install` — so no fetch wrapper sees either, and neither was listed. The switch
      // stops both; `privacy.ts` says why neither row is ever live.
      ...hiringEgress(hired.map((record) => record.source), musicNetwork),
      ...homebrewEgress(musicNetwork),
    ]

    // Only for a conversation that exists. Calling `sessionFor` would *start* one, which is a
    // side effect nobody asked for by opening a privacy panel.
    const live = current.get(key)
    const session = live ? managers.get(live) : undefined

    // The egress rows above are built from the servers this scan *found*. A config that
    // exists and will not parse contributes none, and without this the panel would report a
    // short list as a complete one — which is the reassuring answer, and therefore the one
    // nobody checks. `sources` is where `capabilities.ts` keeps that distinction.
    const unreadSources = scan.mcp.sources.flatMap((source) =>
      source.read.state === 'unreadable' ? [{ path: source.path, cause: source.read.cause }] : [],
    )

    return measure(WORKSPACE_ROOT, session?.lastPrompt ?? null, egress, unreadSources)
  })

  ipcMain.handle(CHANNEL.forget, async (_e, path: unknown): Promise<RosterOutcome> => {
    // A throw here is a failure this call already has a field for. See `outcomeOf`.
    return outcomeOf('forget that', async () => {
      const outcome = await forget(WORKSPACE_ROOT, String(path ?? ''))
      if (!outcome.ok) return outcome
      // Deleting `projects/` changes who is on the tab bar. Rescanning before answering means the
      // renderer's next snapshot is already right rather than one event behind.
      await rescan()
      return { ok: true }
  })
  })

  /**
   * What the staff can reach, and whether it is actually reachable.
   *
   * `capabilities.ts` has been on `dev` with zero callers since it was written — 475 tested
   * lines that read `.mcp.json` and `~/.claude.json`, name every server and report the gap
   * between what an employee declares and what the workspace permits, all thrown away. This is
   * the caller.
   *
   * The live status is joined in from the last `init` event rather than re-derived, because the
   * surveyor deliberately refuses to start a server to find out whether it answers. It reports
   * `configured`; the CLI reports `connected` or `failed`. Both are true and they are different
   * claims, so the report carries whichever is the stronger one we actually have.
   */
  ipcMain.handle(CHANNEL.capabilities, async (): Promise<CapabilityReport> => {
    const scan = await scanCapabilities(WORKSPACE_ROOT, { home: homedir() })
    // Computed once across the whole roster rather than per employee: it needs the full staff
    // list and the server list together, and calling it per member would rescan for each.
    const dangling = mcpToolsWithoutServer(scan.staff, scan.mcp.servers)
    // The same computation for built-in tools. `permissions.allow` is read from the workspace
    // the office is actually pointed at, not from ours — a packaged app seeds its own.
    // `readPolicy` already reads every settings file this workspace has and merges them, which
    // is the same set the CLI honours. A second reader here would be a second answer to "what is
    // allowed" — which is the fault this whole check exists to catch.
    const policy = await readPolicy(WORKSPACE_ROOT)
    const unreachable = toolsWithoutPermission(scan.staff, policy.policy.allow)

    return {
      staff: scan.staff.map((member) => ({
        id: member.id,
        access: member.tools.state,
        tools: member.tools.state === 'declared' ? member.tools.tools : [],
        // Tools named `mcp__<server>__<tool>` where no such server is configured. An employee
        // that will reach for something that cannot answer, which reads as the agent failing.
        danglingMcpTools: dangling.filter((d) => d.employee === member.id).map((d) => d.tool),
        unreachableTools: unreachable.filter((u) => u.employee === member.id).map((u) => u.tool),
      })),
      servers: scan.mcp.servers.map((server) => ({
        name: server.name,
        transport: server.transport,
        scope: server.scope,
        // What the CLI last said, if it said anything. `configured` otherwise — never upgraded
        // to `connected` on the strength of a file existing.
        status: liveMcpStatus.get(server.name) ?? 'configured',
      })),
      sources: scan.mcp.sources.map((src) => ({ path: src.path, state: src.read.state })),
      permissions: {
        allow: scan.permissions.allow,
        deny: scan.permissions.deny,
        inForce: scan.permissions.inForce,
      },
      problems: scan.problems,
      scannedAt: scan.scannedAt,
    }
  })
   /**
   * Answer a held tool call.
   *
   * Only ever writes a verdict. It cannot *cause* an allowance on its own — the hook denies on
   * its own timeout without consulting anything here, so a decision that never arrives is a
   * refusal by construction rather than by our remembering to make it one.
   */
  ipcMain.handle(
    CHANNEL.decide,
    async (_e, sessionId: unknown, toolUseId: unknown, allow: unknown, reason: unknown) => {
      await decide(
        WORKSPACE_ROOT,
        String(sessionId ?? ''),
        String(toolUseId ?? ''),
        allow === true,
        typeof reason === 'string' && reason ? reason : undefined,
      )
    },
  )
  // A window that has just subscribed to held calls, asking for the ones already held. The
  // watcher's first push went out before there was a window to receive it — see `resend`.
  ipcMain.handle(CHANNEL.approvalsResend, () => {
    approvalWatcher?.resend()
  })
  // ── the dispatch ledger (S5) ─────────────────────────────────────────────────────────────
  //
  // Three verbs and no fourth. None of them starts a run: `resume` is the renderer re-opening a
  // conversation through `openSession`, `retry` composes a brief and hands it back, and `drop`
  // writes one line. A card nobody answered stays a card.
  ipcMain.handle(CHANNEL.unfinished, async (): Promise<UnfinishedReport> => {
    const state = await loadLedger(WORKSPACE_ROOT)
    // A workspace that has never dispatched anything genuinely has nothing outstanding. A ledger
    // that would not open does not, and the two must not answer with the same empty list.
    if (state.state === 'missing') return { entries: [], torn: [], problem: null }
    if (state.state === 'unreadable') {
      return {
        entries: [],
        torn: [],
        problem: `${state.cause} — outstanding dispatches cannot be listed, and this is not the same as there being none`,
      }
    }
    return { entries: unfinished(state.ledger), torn: state.ledger.torn, problem: null }
  })

  ipcMain.handle(CHANNEL.dropDispatch, async (_e, id: unknown): Promise<RosterOutcome> => {
    // A throw here is a failure this call already has a field for. See `outcomeOf`.
    return outcomeOf('drop that dispatch', async () => {
      const written = await recordOutcome(WORKSPACE_ROOT, {
        id: String(id ?? ''),
        kind: 'dropped',
        // Said in the record, not inferred from it later. "Dropped" on its own would read as an
        // outcome the agent produced rather than a decision a person made about it.
        output: 'Dropped from the office floor: nobody is waiting for this dispatch any more.',
        at: new Date().toISOString(),
      })
      return written.ok ? { ok: true } : { ok: false, reason: written.reason }
  })
  })

  ipcMain.handle(
    CHANNEL.retryDispatch,
    async (_e, id: unknown): Promise<{ brief: string } | { problem: string }> => {
      const wanted = String(id ?? '')
      const state = await loadLedger(WORKSPACE_ROOT)
      if (state.state !== 'ok') {
        return {
          problem:
            state.state === 'missing'
              ? 'there is no dispatch ledger in this workspace, so there is nothing to re-send'
              : `the dispatch ledger could not be read: ${state.cause}`,
        }
      }

      const entry: Dispatch | undefined = state.ledger.sent.find((d) => d.id === wanted)
      if (!entry) return { problem: `no dispatch called ${wanted} is written down in this workspace` }

      // What the previous attempt actually produced. An entry with no outcome at all produced
      // *nothing*, and saying so plainly is the honest input to a retry — a made-up error
      // message would be worse than none, because the agent would try to work around it.
      const failure = state.ledger.outcomes.find((o) => o.id === wanted)
      return {
        brief: retryBrief(
          entry,
          failure?.output ??
            'Nothing came back. No result was ever recorded for this dispatch — the app or the ' +
              'CLI stopped before the agent reported, so there is no error text to work from.',
        ),
      }
    },
  )
  // ─────────────────────────────────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNEL.controlsOf, (_event, project: unknown): Controls =>
    controlsFor(String(project ?? OFFICE_PROJECT)),
  )

  /**
   * Turn a dial.
   *
   * Validated here rather than trusted, because what arrives has crossed a process boundary and
   * ends up as an argument to somebody else's binary. An unrecognised value is dropped and
   * named rather than passed on: the failure it would otherwise cause is a `claude` that exits
   * immediately complaining about a choice, which the office would report as the manager being
   * unreachable — a true statement that points at entirely the wrong thing.
   */
  ipcMain.handle(CHANNEL.setControls, (_event, project: unknown, value: unknown): ControlsResult => {
    const key = String(project ?? OFFICE_PROJECT)
    const read = readControls(value)
    controls.set(key, read.controls)
    return { controls: read.controls, unknown: read.unknown, ignored: read.ignored }
  })

  ipcMain.handle(CHANNEL.createProject, async (_event, name: unknown): Promise<CreatedProject> => {
    const created = await createProject(WORKSPACE_ROOT, String(name ?? ''))

    if (created.state === 'created') {
      // The tab bar is a function of the filesystem, like the floor. Rescan rather than
      // splicing the new project into a list the renderer already has — one source of truth.
      projects = await discoverProjects(WORKSPACE_ROOT)
      if (workspace) send(CHANNEL.office, toSnapshot(workspace))
      return { state: 'created', id: created.project.id }
    }

    return created.state === 'exists'
      ? { state: 'exists', id: created.id }
      : { state: 'failed', cause: created.cause }
  })

  ipcMain.handle(CHANNEL.describeProject, async (_event, id: unknown): Promise<ProjectContents> =>
    describeProject(WORKSPACE_ROOT, String(id ?? '')),
  )

  /**
   * Hide a conversation. Nothing on disk that we did not create is touched.
   *
   * The registry is ours; the transcript is Claude Code's. Closing writes one boolean into the
   * first and leaves the second exactly where it is, which is what makes this reversible by
   * definition rather than by a recovery path somebody has to build.
   */
  ipcMain.handle(CHANNEL.closeSession, async (_event, projectId: unknown, id: unknown): Promise<RosterOutcome> => {
    // A throw here is a failure this call already has a field for. See `outcomeOf`.
    return outcomeOf('close this conversation', async () => {
      const key = String(id ?? '')
      const project = String(projectId ?? OFFICE_PROJECT)
      const record = sessions.find((entry) => entry.id === key)

      // A conversation started this run and not yet written down is still one of the group —
      // `sessionListOf` says so, and puts it in the list. So it can be closed like any other, and
      // the first version of this refused it: the row was on screen and the button said no.
      //
      // `opened: false` is the honest record for one Claude never confirmed. It names no
      // conversation on disk, so it was never resumable; `closed` is what keeps it out of a list
      // it would otherwise rejoin the moment the id got confirmed.
      const now = new Date().toISOString()
      const base: SessionRecord = record ?? {
        id: key,
        project,
        cwd: WORKSPACE_ROOT,
        agent: (workspace && findManager(workspace.employees)) || 'manager',
        createdAt: now,
        updatedAt: now,
        costUsd: null,
        title: null,
        mode: FIRST_MODE,
        opened: false,
      }

      /*
       * Stop it, then forget it.
       *
       * Closing marked the registry and pushed the list, and left the conversation running. The
       * row went, the child `claude` did not — so a turn nobody could see any more went on
       * spending, and the app had just said "Conversation closed."
       *
       * `interrupt()` is the same call the stop control makes: it clears the queue and stops the
       * running turn, and returns what it dropped so the caller can say so rather than discarding
       * messages the person typed. The renderer reports those before it calls this.
       *
       * The entry goes from `managers` as well. It is keyed by session and nothing removed from
       * it, so every conversation ever opened stayed — each holding its last prompt in full, and
       * a handle on a process that may still have been alive. `byId` returning nothing for a
       * closed conversation is the right answer; a late event from a stopped run has nowhere to
       * go, which is what it deserves.
       */
      managers.get(key)?.interrupt()
      managers.delete(key)
      // Same reasoning, the other two maps it missed. `recorders` and `pending` were keyed by
      // session and nothing removed from them either, so every conversation ever opened kept a
      // recorder and a moment list for the lifetime of the process. Small each, unbounded in
      // total, and in the subsystem whose failure mode is already silence.
      recorders.forget(key)

      // `updatedAt` stays as it was. A close is not activity, and search and the restore notice
      // both read that field as when the conversation was last used. Another office still holding
      // this record open, at that same time, is answered by the tie rule in `mergeNewest`.
      sessions = upsert(sessions, { ...base, closed: true })
      // A save that failed, or left this conversation out, fails the close: the throw is the answer,
      // through `outcomeOf`. A save that left out only other conversations wrote this close, so the
      // close stands, and what it left out is reported as `remember` reports it.
      //
      // Done does not always mean `closed` reached the file. When another office has saved a newer
      // copy of this conversation, one this version can read, the merge in `writeRegistry` keeps
      // that copy, because a close leaves `updatedAt` as it was. `closed` is dropped, nothing
      // throws, and the list pushed below shows the conversation again. `dev` does the same. That
      // case is filed separately and is not fixed here.
      try {
        await writeRegistry()
        setRegistryProblem(null)
      } catch (err) {
        if (!writtenDespite(err, key)) throw err
        setRegistryProblem(registrySaveProblem(WORKSPACE_ROOT, err))
      }
      // `pushSessions` is the funnel every registry change goes through — it re-derives the
      // project row's conversation count as well as the list, which would otherwise state a
      // number that had just stopped being true.
      pushSessions(project)
      return { ok: true }
  })
  })

  ipcMain.handle(CHANNEL.archiveProject, async (_event, id: unknown): Promise<RosterOutcome> => {
    // A throw here is a failure this call already has a field for. See `outcomeOf`.
    return outcomeOf('archive that project', async () => {
      const done = await archiveProject(WORKSPACE_ROOT, String(id ?? ''))
      // The project list is a function of the filesystem, like the floor. Rescan rather than
      // splicing — one source of truth, the same as createProject.
      if (done.ok) {
        projects = await discoverProjects(WORKSPACE_ROOT)
        if (workspace) send(CHANNEL.office, toSnapshot(workspace))
      }
      return done.ok ? { ok: true } : { ok: false, reason: done.reason ?? 'Could not archive.' }
  })
  })

  ipcMain.handle(CHANNEL.deleteProject, async (_event, id: unknown): Promise<RosterOutcome> => {
    // A throw here is a failure this call already has a field for. See `outcomeOf`.
    return outcomeOf('move that project to the Trash', async () => {
      // `shell.trashItem` rather than a delete of our own: Finder is the recovery path, and this
      // app does not grow an undo for the one operation where an undo has to work.
      const done = await deleteProject(WORKSPACE_ROOT, String(id ?? ''), (path) => shell.trashItem(path))
      if (done.ok) {
        projects = await discoverProjects(WORKSPACE_ROOT)
        if (workspace) send(CHANNEL.office, toSnapshot(workspace))
      }
      return done.ok ? { ok: true } : { ok: false, reason: done.reason ?? 'Could not delete.' }
  })
  })

  /**
   * The conversation to pick back up.
   *
   * Returns null only when there is genuinely nothing to resume. A session whose transcript
   * could not be read comes back as a restore carrying the reason — the conversation is real
   * and the manager will remember it even though we cannot show it, and saying so is the only
   * honest way to render that.
   */
  ipcMain.handle(
    CHANNEL.restore,
    async (_event, project: unknown, session: unknown): Promise<RestoredSession | null> => {
    const key = String(project ?? OFFICE_PROJECT)
    // The conversation the renderer named, falling back to the one this project is *showing* —
    // which is not always the newest, since you may have opened an older one from the strip.
    //
    // The named id is what closes the leak. The renderer opens a transcript per conversation
    // and then asked for "this project's" saved session, so a project's second conversation was
    // filled with the first one's words. Not a race: it could not have done anything else,
    // because the argument it needed was not in the signature.
    const showing = asSession(session) ?? current.get(key)

    // A conversation this project is showing but has no record of is one that was started just
    // now and has never been written down. There is nothing to restore — and falling back to
    // the newest recorded one would open a fresh conversation with somebody else's words
    // already in it.
    if (showing) {
      const recorded = sessions.find((s) => s.id === showing)
      if (!recorded) return null
      var target: SessionRecord | null = recorded
    } else {
      target = resumableFor(key)
    }
    if (!target) return null

    const read = await readTranscript(target.id, target.cwd)

    if (read.state !== 'ok') {
      return {
        sessionId: target.id,
        title: target.title,
        updatedAt: target.updatedAt,
        entries: [],
        truncated: 0,
        problem:
          read.state === 'missing'
            ? 'Claude has no transcript on disk for this session.'
            : `The transcript could not be read: ${read.cause}`,
      }
    }

    const transcript = parseTranscript(read.jsonl)
    const entries = transcript.entries.slice(-RESTORE_LIMIT)

    return {
      sessionId: target.id,
      title: target.title,
      updatedAt: target.updatedAt,
      entries,
      truncated: transcript.entries.length - entries.length,
      // A line the parser could not read is already an entry in the timeline; it is not a
      // failure of the restore.
      problem: null,
    }
  })

  ipcMain.handle(
    CHANNEL.aside,
    async (_event, project: unknown, agent: unknown, question: unknown): Promise<AsideResult> => {
      const key = String(project ?? OFFICE_PROJECT)
      const live = liveFor(key)
      // The live session, or the one we would resume. Reopening the app and asking somebody
      // what they were doing should fork yesterday's conversation rather than claim nothing
      // has been asked — the conversation is right there on disk.
      const previous = resumableFor(key)
      const sessionId = live?.state.sessionId ?? previous?.id ?? null

      // Genuinely nothing to ask about. Saying so is the only honest answer available —
      // anything else would be the office inventing a status.
      if (!sessionId) {
        return { text: 'Nothing has been asked of the office yet.', isError: false, costUsd: null }
      }

      const name = typeof agent === 'string' ? agent : null
      const asked =
        typeof question === 'string' && question.trim()
          ? question.trim()
          : name
            ? statusQuestionFor(name)
            : STATUS_QUESTION

      const answer = await askAside({
        cwd: WORKSPACE_ROOT,
        sessionId,
        question: asked,
        ...(claudePath ? { claudePath } : {}),
      })
      // An aside is a real run and costs real money. It is spent asking about this project, so
      // it belongs on this project's total rather than nowhere at all.
      live?.spend(answer.costUsd)
      return { text: answer.text, isError: answer.isError, costUsd: answer.costUsd }
    },
  )
}

// ────────────────────────────────────────────────────────────────────── window ──

/**
 * Say a call is waiting, to somebody who is not looking at the office.
 *
 * Measured before this existed: an employee stopped on a gated command and the floor read
 * *"1 call needs you · 1 mid-task"* for 350 seconds, to an empty chair. Decision #1 covers the
 * office going away mid-wait; this covers it being open while you are not.
 *
 * Everything worth arguing about is in `nudgeFor` — what is new, who is blocked, and the rule
 * that a notification is for somebody who is *not* reading the card while the badge is the dock
 * agreeing with the floor either way. This half only performs it.
 */
function nudge(requests: readonly ApprovalRequest[]): void {
  const focused = window?.isFocused() ?? false
  const { announce, badge, seen } = nudgeFor(
    mentioned,
    requests.map((r) => ({ sessionId: r.sessionId, toolUseId: r.toolUseId, tool: r.tool, agent: r.agent ?? null }))
      .map((r) => ({ key: `${r.sessionId}.${r.toolUseId}`, tool: r.tool, agent: r.agent })),
    focused,
  )
  mentioned = seen

  // macOS only, and asked rather than assumed — `app.dock` is undefined everywhere else.
  app.dock?.setBadge(badge)

  if (!announce) return
  // A notification the platform cannot show must not take the turn down with it.
  if (!Notification.isSupported()) return
  const note = new Notification({ title: announce.title, body: announce.body })
  // Clicking it brings you to the thing it is about. Anything less is a notification that tells
  // you something is wrong and then makes you go and find it.
  note.on('click', () => {
    window?.show()
    window?.focus()
  })
  note.show()
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0e17',
    title: 'Office Space',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    // A driven run may not be given the keyboard. `focusable` has to be decided here, at
    // construction -- `showInactive()` alone still lets a click hand the window focus later.
    focusable: !HEADLESS,
    webPreferences: {
      preload: join(here, '..', 'preload', 'preload.cjs'),
      // The renderer displays model output and tool results — untrusted text — inside an app
      // that can start processes with your credentials. All three of these matter.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Nothing here is served over http, and nothing should try.
      webSecurity: true,
    },
  })

  /**
   * Put the window somewhere it can actually be seen, before showing it.
   *
   * The size above is a *request*. macOS restores an app's window frame between launches, so a
   * window that was last used on a 2560×1600 laptop display opens at that size on a 1920×1080
   * monitor — larger than the screen, and positioned partly off the left edge of it. Found by
   * running the app: the conversation panel was cut in half by the edge of the display and the
   * text in it was clipped mid-word, which reads as a broken layout rather than as a window in
   * the wrong place.
   *
   * Clamped to the **work area** rather than the display, so the menu bar and the Dock are not
   * counted as space the window may occupy.
   */
  window.once('ready-to-show', () => {
    mark('ready-to-show')
    if (!window) return
    fitToScreen(window)
    // `showInactive` rather than `show`, so a driven boot does not front itself over whatever
    // the person is actually working in.
    if (HEADLESS) window.showInactive()
    else window.show()
  })
  window.on('closed', () => {
    window = null
  })

  // A link in a transcript opens in the real browser. Navigating the app window to a page an
  // agent chose would hand a preload-privileged frame to whatever was at the other end.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  void window.loadFile(join(here, '..', 'renderer', 'index.html'))
}

/**
 * Read what this workspace remembers.
 *
 * **Only ever called after `WORKSPACE_ROOT` is settled.** It was called before, once, and the
 * app deleted every conversation a user had — see the note at the call site. `registryOpened`
 * exists so that mistake cannot be made silently a second time: nothing may be written back
 * until something has been read, because writing replaces the whole file.
 */
let registryOpened = false

/**
 * True while this process still believes the registry does not exist.
 *
 * Held from the read that said `missing` until we have created one ourselves. The verdict
 * authorises writing because there is nothing to lose, and that is a claim about the moment it
 * was made — so the first write is an exclusive create rather than a replace, and this is what
 * remembers to ask for one. Cleared as soon as the file is ours.
 */
let registryIsOurs = false

/**
 * Writes are serialised, and the reason is not the file — it is `sessions`.
 *
 * `saveRegistry` writes the whole registry from whatever `sessions` holds when it reads it. Two
 * overlapping calls therefore raced on *content*: each captured its own snapshot, and whichever
 * finished last won, so a conversation updated by the slower caller was silently replaced by a
 * state that predated it. Unique temp files stop the two writers destroying each other's scratch
 * file; they do not stop the older answer landing second.
 *
 * The task is a closure rather than a value for exactly that reason: it reads `sessions` when its
 * turn comes, not when it was queued. `serial()` carries the rest of the argument.
 */
const writeRegistryQueue = serial()

/**
 * Replace the registry on disk with what is in memory.
 *
 * `saveRegistry` writes the *whole file*, so writing before reading does not add a record — it
 * throws away every record that was already there. That is precisely how the ordering bug
 * destroyed conversations rather than merely failing to show them, and it is why this refuses
 * rather than trusting the caller. A save that cannot happen is a conversation not offered next
 * time; a save that happens too early is every conversation gone.
 */
async function writeRegistry(): Promise<void> {
  if (!registryOpened) {
    throw new Error(
      'refusing to write the session registry, because reading it did not succeed — that would ' +
        'replace every conversation this workspace remembers with whatever happens to be in ' +
        'memory. The file is unchanged; a registry that will not parse can usually be repaired ' +
        'by hand',
    )
  }

  await writeRegistryQueue(async () => {
    // The first write of a process that found no registry creates it, and fails rather than
    // replaces if one has appeared meanwhile. After that the file is ours and an ordinary
    // temp-and-rename is right.
    const creating = registryIsOurs

    /*
     * Read, merge, write — every time, not only when adopting.
     *
     * This used to write `sessions` straight out once the file was ours, on the reasoning that
     * *"two windows on one workspace is last-writer-wins."* That is the right trade and it was
     * being applied to the wrong unit: the whole **file**, rather than each conversation. A
     * second office never learns about a conversation the first one starts afterwards, so
     * whichever of them saved last replaced the file with a list the other's work was not in.
     *
     * Measured with two real instances on one workspace. Both had a conversation, both answered,
     * both showed `$0.0487` — and the registry held **one row**. On a second run with the saves
     * landing the other way round it held two, one of them missing its cost. Same bug, and the
     * ordering decided how much of it you saw.
     *
     * `mergeNewest` makes last-writer-wins mean *per conversation*, decided by `updatedAt`, which
     * is what a record carries a timestamp for. The cost is one extra read per save, and saves
     * happen when a conversation changes state rather than continuously.
     */
    const onDisk = creating ? null : await loadRegistry(WORKSPACE_ROOT)
    if (onDisk?.state === 'ok') sessions = mergeNewest(onDisk.sessions, sessions)

    try {
      // The same read goes to `saveRegistry`, so the rows it keeps come from the file this merged
      // from. A registry that stopped being readable between opening and now is not something to
      // write over, and `saveRegistry` refuses a read that could not be used. `registryOpened`
      // guards the same thing at the top; this is the window in between.
      await saveRegistry(WORKSPACE_ROOT, sessions, onDisk === null ? { create: true } : { read: onDisk })
      if (creating) registryIsOurs = false
      return
    } catch (err) {
      if (!(err instanceof RegistryAppeared)) throw err
    }

    /**
     * Another copy created it first. **Adopt it rather than give up.**
     *
     * Refusing to overwrite is right and it was, on its own, terminal: `registryIsOurs` stays
     * true, so every write for the rest of the run is refused the same way, and the second office
     * can never record anything again. Measured with two real instances on one fresh workspace —
     * the first created the file, the second was correctly refused, and then could not close a
     * conversation for as long as it was open.
     *
     * Adopting is not a concession. Once the file exists this office's situation is *exactly* the
     * one it would have been in had it started a second later, and that state has a settled
     * answer: `ok` is last-writer-wins by design. So it re-reads, merges what it has on top, and
     * carries on as an ordinary writer.
     *
     * `upsert` per record rather than a concatenation, because the two offices can hold the same
     * conversation — the same id, opened in both — and two rows for one conversation is the
     * duplicate the registry has no way to resolve later.
     */
    const theirs = await loadRegistry(WORKSPACE_ROOT)
    if (theirs.state !== 'ok') throw new RegistryAppeared()

    // Per record, newest wins — not every record this office happens to be holding. See
    // `mergeNewest`: writing all of ours back put our startup snapshot of the *other* office's
    // conversations over the newer rows it had written since, and a cost went with them.
    sessions = mergeNewest(theirs.sessions, sessions)
    registryIsOurs = false

    await saveRegistry(WORKSPACE_ROOT, sessions, { read: theirs })
  })
}

/**
 * Read what the office remembers, and work out what to offer.
 *
 * The three states are kept apart on purpose. A workspace that has never had a session offers
 * nothing, which is correct. A registry that exists and cannot be read offers nothing *and
 * says so* — treating it as an empty history would hand somebody a blank slate over the top of
 * work that is still on disk, which is exactly the failure this project refuses to ship.
 */
async function openRegistry(): Promise<void> {
  const loaded = await loadRegistry(WORKSPACE_ROOT)
  // Only when reading it went somewhere we can safely write back to. `missing` counts: there is
  // no history to lose and the first write is what creates the file. `unreadable` does not, and
  // that is the whole point — see `mayWriteRegistry`.
  registryOpened = mayWriteRegistry(loaded.state)
  // Only `missing` needs the exclusive create; `ok` already has a file we read.
  registryIsOurs = loaded.state === 'missing'
  // The rows it could not use. This function used to drop their count, so a registry whose every
  // row failed to parse opened as no history at all. See `skippedRowsProblem`.
  registryRowsProblem = skippedRowsProblem(WORKSPACE_ROOT, loaded)

  if (loaded.state === 'ok') {
    sessions = [...loaded.sessions]
    return
  }

  if (loaded.state === 'unreadable') {
    registryProblem = {
      kind: 'unreadable-file',
      path: registryPath(WORKSPACE_ROOT),
      cause: `${loaded.cause} — previous sessions cannot be listed, and this is not the same as there being none`,
    }
  }
}

/**
 * Move and resize a window so it is entirely on one screen.
 *
 * Only ever shrinks and nudges — a window smaller than the screen and already inside it is left
 * exactly as it is, so this cannot undo somebody's own placement. `getDisplayMatching` picks the
 * screen the window most overlaps, which is the one it should stay on rather than being dragged
 * to the primary.
 */
function fitToScreen(win: BrowserWindow): void {
  const bounds = win.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea

  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  // Clamped after the size, because the far edge depends on the width we just settled on.
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)

  if (width === bounds.width && height === bounds.height && x === bounds.x && y === bounds.y) return
  win.setBounds({ x, y, width, height })
}

/**
 * Find the `claude` to run, before anything else needs it.
 *
 * Resolved to an absolute path so that spawning does not depend on the environment a second
 * time. An app launched from the Dock inherits `launchd`'s PATH — no nvm, no shims, nothing
 * `.zshrc` set up — so a bare `claude` finds nothing and the office arrives full of people who
 * cannot do anything. Not finding it is the single most important thing the office can say,
 * which is why it goes to the front of the problem list.
 */
async function findClaude(): Promise<void> {
  const found = await resolveClaude({
    override: process.env['OFFICE_CLAUDE_PATH'],
    path: process.env['PATH'],
    home: homedir(),
  })

  if (found.state === 'found') {
    claudePath = found.path
    return
  }

  claudeProblem = {
    kind: 'lint',
    path: WORKSPACE_ROOT,
    rule: 'no-claude-on-path',
    detail: missingMessage(found.looked),
  }
}

/**
 * Whether anything in the environment is quietly billing somebody else.
 *
 * Checked once, at startup, before a single request is spent — the whole point is to say so
 * *rather than letting it run*, which is what `VISION.md` §7.1 requires and what `docs/auth.md`
 * had been claiming happened for some time before it did.
 *
 * Reported through the same channel as the trust warning, so an office with a problem looks
 * like an office with a problem regardless of which problem it is.
 */
function checkBilling(): void {
  const warning = billingWarning(billingRoute(process.env))
  if (!warning) return

  billingProblem = {
    kind: 'lint',
    path: 'environment',
    rule: 'billing-redirected',
    detail: warning,
  }
}

/**
 * Whether the rules we are working from are the rules that were written.
 *
 * A settings file that exists and will not parse produces zero rules and no complaint — from
 * the CLI, which ignores it silently under `--print`, and until now from us as well.
 */
async function checkPolicy(): Promise<void> {
  const detail = policyProblem(await readPolicy(WORKSPACE_ROOT))
  if (!detail) return

  policyReadProblem = {
    kind: 'lint',
    path: join(WORKSPACE_ROOT, CLAUDE_SETTINGS),
    rule: 'settings-unreadable',
    detail,
  }
}

/**
 * Say so if the office's own permission rules are being ignored.
 *
 * An untrusted workspace has its `permissions.allow` dropped on the floor by Claude Code, which
 * means the staff can write files and cannot run anything — including the commands every task's
 * VERIFY condition is made of. From inside the app that is indistinguishable from an allowlist
 * that does not work, so the office has to name it.
 *
 * Only ever a warning. Accepting the trust prompt is the user's to do, and an app that did it
 * for them would be defeating the one control between a cloned repo and their shell.
 */
async function checkTrust(): Promise<void> {
  const allowed = await allowRuleCount()
  // Nothing to be ignored, so nothing to warn about.
  if (allowed === 0) return

  const trust = await workspaceTrust(WORKSPACE_ROOT)

  /*
   * Two silences, and only one of them was a guess.
   *
   * This used to warn on `untrusted` alone, because *"telling somebody their workspace is
   * untrusted because we could not read a file would be inventing a fact about their machine."*
   * That is right about the file it names and wrong about the other half of `unknown`: a config
   * that opened cleanly and holds **no record for this directory** is not a failure to know. The
   * prompt has not been answered, so Claude Code ignores the allowlist — the decision is missing,
   * the consequence is certain.
   *
   * `harness.ts` has always treated it that way for running — *"being unable to tell is not
   * permission"* — so the office refused every VERIFY on a fresh workspace with *"nothing has
   * authorised this"*, about commands `settings.json` plainly permits, and said nothing about
   * why. That is verbatim the confusion this module's header exists to prevent, in the case it
   * names as landing hardest: *"A fresh clone has never been trusted, so a brand new office ships
   * an allowlist that does nothing, and the first thing its staff try to do is the thing they are
   * refused."*
   *
   * Found by putting an allowlist in a workspace Claude Code had never opened and watching every
   * check come back not-allowed with nothing on screen to explain it.
   */
  const silent = trust.state === 'trusted' || (trust.state === 'unknown' && trust.why === 'unreadable')
  if (silent) return

  trustProblem = {
    kind: 'lint',
    path: join(WORKSPACE_ROOT, CLAUDE_SETTINGS),
    rule: 'workspace-not-trusted',
    detail: untrustedMessage(WORKSPACE_ROOT, allowed, trust.state === 'untrusted'),
  }
}

/**
 * Say so if macOS still has our own bundle marked as downloaded.
 *
 * Only the `quarantined` answer produces anything. Off macOS there is no such flag, from a
 * clone there is no bundle of ours, and a check that could not run is not a finding — telling
 * somebody their app is quarantined because `xattr` would not start would be inventing a fact
 * about their machine, the same failure as an empty floor standing in for an unreadable
 * directory. See `quarantine.ts`.
 */
async function checkQuarantine(): Promise<void> {
  const found = await appQuarantine(process.execPath)
  if (found.state !== 'quarantined') return

  quarantineProblem = {
    kind: 'lint',
    path: found.appPath,
    rule: 'app-quarantined',
    detail: quarantineMessage(found.appPath),
  }
}

/**
 * How many allow rules this workspace ships. Zero if it has none, or none that could be read.
 *
 * Counted the way `readPolicy` reads them. This used to parse the file itself, and counted entries
 * that are not rules, and the allow list of a file Claude Code sets aside (found in review).
 */
async function allowRuleCount(): Promise<number> {
  return shippedAllowRules(await readPolicy(WORKSPACE_ROOT))
}

// ──────────────────────────────────────────────────────────────────── lifecycle ──

void app.whenReady().then(async () => {
  mark('ready')
  /*
   * Stay out of the Dock when a tool is driving this, not a person.
   *
   * `scripts/look.mjs` boots the app to read what is on screen and kills it seconds later. Run
   * from a clone that is a **separate application** from an installed Office Space — Electron's
   * own bundle, so macOS shows it as "Electron" with the default icon — and there is no
   * single-instance lock, so each run is its own Dock entry appearing and vanishing.
   *
   * Which is exactly what it looked like: somebody using their real office watched another
   * Electron app open and close, repeatedly, and reasonably read it as their clicks doing it.
   * A development instrument may not be indistinguishable from a bug in the product it is
   * checking.
   *
   * macOS only — `app.dock` does not exist elsewhere — and behind an env var, so a person
   * launching the app normally is unaffected.
   */
  if (HEADLESS) app.dock?.hide()

  // Belt and braces with the meta tag in index.html: no remote anything, no inline script, no
  // eval. If a tool result ever contains markup, this is what makes it inert.
  electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; img-src 'self' data:; style-src 'self'"],
      },
    })
  })

  /**
   * Who may open the microphone, which is this app and nothing else.
   *
   * Electron's default is to grant permission requests, and a renderer that only ever loads
   * `file://` from inside the bundle makes that survivable — but "survivable by accident" is not
   * a security posture. Named explicitly: **media, from our own page, and nothing else.**
   *
   * Without this the mic works in development and fails in the packaged app, which is the worst
   * of the two possible bugs: it passes every test somebody runs on their own machine.
   */
  electronSession.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    const ours = contents.getURL().startsWith('file://')
    callback(ours && permission === 'media')
  })

  // The synchronous sibling, asked by Chromium before it even raises a request. Returning true
  // for everything here would undo the handler above.
  //
  // **It asks a narrower question than its sibling, and that asymmetry is deliberate rather than
  // finished.** The request handler above tests the origin — `contents.getURL()` must be
  // `file://` — and this one tests only the permission. So a non-`file://` context would pass
  // this check and fail the request that follows it.
  //
  // Nothing can be that context today. `will-navigate` is prevented, `setWindowOpenHandler`
  // denies every url, `webSecurity` is on, and the CSP is `default-src 'self'` — which covers
  // frames too, so there is no remote page and no remote iframe to do the asking. The gap is
  // defence in depth, not a hole.
  //
  // It is left rather than closed because closing it means asserting what `requestingOrigin`
  // holds for a page loaded from a file, and that is `"file://"` on some platforms and the
  // string `"null"` on others. Guessing wrong denies `media` to our own page — and the comment
  // directly above records why that class of mistake is the worst one available here: the
  // microphone would keep working in development and fail in the packaged app, passing every
  // test anybody runs on their own machine.
  //
  // To close it, measure `requestingOrigin` in a packaged build on each platform first.
  electronSession.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'media')

  registerHandlers()
  await findClaude()
  await findThemes()
  // Before anything reads the workspace. A packaged app has no writable workspace until this
  // has run, and every scan below would otherwise be pointed inside a read-only bundle.
  //
  // `openRegistry()` used to be the line above this comment, which is exactly the mistake the
  // comment warns about — and it cost a user every conversation they had had. Packaged,
  // `WORKSPACE_ROOT` is still `APP_ROOT` at that point: inside `app.asar`, read-only, with no
  // registry in it. `loadRegistry` answered `missing`, which raises no problem because only
  // `unreadable` does, so the office started with an empty session list and said nothing. The
  // root was then corrected and never re-read — and the first `remember()` wrote that empty
  // list over the real registry, because `saveRegistry` replaces the whole file.
  //
  // Not "the chat did not come back". The chat was **deleted**, by the app, on every launch.
  // In a clone the two paths are the same directory, so it worked perfectly for both of us.
  const resolved = await resolveWorkspaceRoot({
    packaged: app.isPackaged,
    appRoot: APP_ROOT,
    // Packaged, APP_ROOT is inside `app.asar` and the template is beside it under
    // `Contents/Resources/app/` — see RootOptions.templateRoot. In a clone they are the same.
    templateRoot: TEMPLATE_ROOT,
    userData: app.getPath('userData'),
    env: process.env,
  })
  WORKSPACE_ROOT = resolved.root
  // Settled here, beside the root, because both are facts about where this build keeps things
  // and neither changes afterwards.
  await checkTemplateShipped()
  // Where the crash record lives, settled with the root it sits under and before anything can
  // start a child that needs recording.
  recordOrphansIn(WORKSPACE_ROOT)
  // Now, and not a line earlier. Everything this reads lives under the root that was just
  // settled; reading it before is reading a different machine's answer.
  await openRegistry()
  // Same rule, and this one *writes*. A workspace seeded on an older build is missing every
  // `.claude/` fix shipped since; this brings forward the files it can prove nobody has edited
  // and leaves the rest alone. Aimed at `WORKSPACE_ROOT`, so it cannot run a line earlier than
  // this either — the difference being that the bug above lost a session list and this one
  // would write into whichever directory happened to be there instead.
  await bringShippedFilesForward()
  /*
   * Anything the last office left behind, stopped before this one starts anything of its own.
   *
   * `children.ts` stops every child on a clean quit. A crash skips `before-quit` entirely, and
   * `runClaude` spawns `detached` — needed so a kill reaches claude's own tools — which also
   * means the kernel does not take the child down with its parent. Measured, mid-answer:
   * `SIGKILL` the Electron main and the child is alive twenty seconds later, ppid 1, still
   * spending. Three of its four answers kill nothing; `shared/orphans.ts` says why each.
   */
  const reaped = await reapOrphans(WORKSPACE_ROOT)
  const said = reapMessage(reaped.killed)
  if (reaped.problem !== null) {
    // Unreadable is not empty. A record that will not parse named children this cannot now
    // account for, and saying nothing would be the leak wearing the fix's clothes.
    crashNotice = { kind: 'lint', path: WORKSPACE_ROOT, rule: 'orphans-unknown', detail: reaped.problem }
  } else if (said !== null) {
    crashNotice = { kind: 'lint', path: WORKSPACE_ROOT, rule: 'orphans-stopped', detail: said }
  }
  if (resolved.problem) {
    workspaceProblem = {
      kind: 'lint',
      path: resolved.root,
      rule: 'workspace-unavailable',
      detail: resolved.problem,
    }
  }
  // The gate's other half. Started before any session, so a request that arrives on the very
  // first turn is seen rather than waited out.
  // Through `forwardInOrder`, so a batch still being answered cannot land after a newer one and
  // put back a card for a call nothing is waiting on. The empty-batch shortcut lives there too.
  const answer = forwardInOrder(
    (requests) =>
      answerFromPolicy(requests, {
        policy: () => readPolicy(WORKSPACE_ROOT),
        modeOf,
        answered: autoDecided,
        write: (request, allow, reason) =>
          decide(WORKSPACE_ROOT, request.sessionId, request.toolUseId, allow, reason),
        wrote: (unwritten) => {
          const dir = join(WORKSPACE_ROOT, '.office-space', 'approvals')
          setVerdictProblem(unwrittenProblem(unwritten, dir))
        },
      }),
    (rs) => send(CHANNEL.approvals, pendingFrom(rs, sessions)),
  )
  approvalWatcher = watchApprovals(WORKSPACE_ROOT, (requests) => {
    nudge(requests)
    if (requests.length === 0) {
      // Nothing is held, so no answer is waiting to be written either. No `return`: the `[]`
      // goes out through `answer`, in turn with every batch before it.
      setVerdictProblem(null)
    }
    answer(requests)
  })
  checkBilling()
  await checkPolicy()
  await checkTrust()
  await checkQuarantine()
  await rescan()
  mark('checks-done')
  createWindow()
  mark('window-created')

  // The live roster. Add a file to `.claude/agents/` and a desk appears, because there is no
  // second list anywhere to keep in step with this one.
  /*
   * The whole office, not only the staff.
   *
   * This used to assign `workspace` and push a snapshot, and nothing else. But `toSnapshot` reads
   * the module-level `projects`, which is refreshed only inside `rescan()` — and `rescan()` is
   * called by the IPC handlers, never by this watcher. So a change on disk repainted the floor
   * with a project list from whenever an IPC call last happened.
   *
   * The visible half was that a project created the way `CLAUDE.md` documents — *"Copy
   * `projects/_TEMPLATE/` to start a new one"* — never appeared. Watching `projects/` was
   * necessary and not sufficient: the watch fired, the workspace was rescanned, and the list it
   * was rendered against had not been.
   *
   * `discoverProjects` rather than `rescan()`, because `watchWorkspace` has already done the
   * workspace scan and handed it in; calling `rescan()` here would do that work a second time on
   * every file change under `.claude/`.
   */
  watchWorkspace(WORKSPACE_ROOT, (ws) => {
    workspace = ws
    void (async () => {
      // Awaited, then sent — in that order and visibly so. Written first as a `.then().finally()`
      // chain, which reads as sequential and measured as one change behind: every snapshot
      // carried the project list from the change before it, so a new project appeared only when
      // the *next* thing happened. Two projects added in a row looked like a one-project delay
      // rather than a bug, which is how it survived the first test of it.
      //
      // A failed scan keeps the last good list rather than emptying it — the fourth standing
      // order, on the list the tab bar is drawn from.
      projects = await discoverProjects(WORKSPACE_ROOT).catch(() => projects)
      send(CHANNEL.office, toSnapshot(ws))
    })()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Nothing this app started outlives it.
 *
 * Before this, closing the window with two projects mid-turn left both `claude` processes
 * running: still talking to Anthropic, still spending the allowance, with nothing on screen to
 * show it or stop it. On a plan with no overage that is not an abstract leak — it is minutes of
 * a seven-day window going somewhere nobody can see.
 *
 * `before-quit` rather than `will-quit`, so this runs while the app can still be told to wait.
 */
app.on('before-quit', () => {
  const stopped = stopAll()
  // A line in the terminal, because a quit that killed four children silently and a quit that
  // killed none look identical from outside.
  if (stopped.length > 0) {
    console.log(`Office Space: stopped ${stopped.length} running process(es): ${stopped.join(', ')}`)
  }

  // And the approval watcher, which `approvalWatcher`'s own comment has always said is "closed on
  // quit so it cannot hold the process open" — while nothing called `close()` anywhere. It holds
  // an `FSWatcher` and a 400ms timer that writes the `.watching` marker every tick, so leaving it
  // open means the office keeps announcing it is watching a rendezvous it has walked away from.
  approvalWatcher?.close()
  approvalWatcher = null
})
