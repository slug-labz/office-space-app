/**
 * Wiring.
 *
 * One event stream reaches two places that must never disagree: the transcript, which shows
 * what was said, and the floor, which shows who is doing it. Both read the *same* events, and
 * the floor's are derived by `factsFromEvent` rather than by a second code path that could
 * drift from the first.
 */

import type { Controls } from '../shared/controls.js'
import { ChatView } from './chat-view.js'
import { FloorView } from './floor-view.js'
import { factsFromEvent, type Fact } from '../shared/floor/choreography.js'
import { SpeechDirector, systemSpeaker } from '../shared/voice/speech.js'
import {  outcomesByOwner } from '../shared/tasks.js'
import { readRoom, type RoomSources } from '../shared/floor/room.js'
import type { ClaudeEvent } from '../main/claude/stream.js'
import { OFFICE_PROJECT, type OfficeSnapshot, type ProjectInfo, type SessionInfo, type SessionState } from '../shared/ipc.js'
import { themeLabel, themeTitle } from '../shared/theme-view.js'
import type { Mode } from '../shared/session/mode.js'
import { changeIsForHere, modeAnnouncement, modeChrome } from '../shared/mode-view.js'
import { mountSwitcher } from './views/switcher.js'
import { mountRecord } from './views/record.js'
import { mountMusic } from './views/music.js'
import { fillDials as buildDials, readDials, showControls as paintControls } from './views/dials.js'
import {  renderWorkLog } from './views/work.js'
import { describeProblem } from '../shared/problem-view.js'
import { SaidOnce } from '../shared/said-once.js'
import type { Problem } from '../main/workspace.js'
import { renderTaskList, summarise as summariseTasks } from './views/tasks.js'
import type { ClickedTask } from '../main/harness.js'
import { CommandMenu, slashToken } from './views/command-menu.js'
import { applySettings, readSettings, renderSettings } from './views/settings.js'
import { AppPalette, accelerator } from './views/app-palette.js'
import type { Action } from '../shared/actions.js'
import { renderFirstRun } from './views/first-run.js'
import { avatar, forgetFaces, type AvatarSource } from './views/avatar.js'
import { diagnose, firstRunVerdict, isBlocked, summarise as summariseFirstRun, type FirstRunState } from '../shared/first-run.js'
import { composerInvite, nobodyListening, statusLine, unreadableUnder } from '../shared/status-line.js'
import { watchForMishaps } from './mishaps.js'
import { mountPopMenu } from './views/popmenu.js'
import { restoreFocus } from './views/focus-return.js'
import { renderHooks } from './views/hooks.js'
import { renderDecided } from './views/decided.js'
import { renderPlan } from './views/plan.js'
import type { PlanReading } from '../shared/plan-usage.js'
import { campusFrom, following, runKnown, waitingByProject, type RunNews } from '../shared/floor/campus.js'
import { renderMemory } from './views/memory.js'
import { renderChanged } from './views/changed.js'
import { renderSearch } from './views/search.js'
import { hasRecord } from '../shared/changes-view.js'
import { kindFrom, renderMaintained, renderOffered, renderRefusal } from './views/maintained.js'
import { whyNotASource } from '../shared/hired-from.js'
import { afterWriting, fieldsFor, renderConnectors } from './views/connect.js'
import { parseHeaders, parseNames, variablesToSet } from '../shared/connector.js'
import type { SourceKind } from '../shared/ipc.js'
import { unwrap } from '../shared/mishap.js'
import {
  NOTHING_HELD,
  afterDecision,
  afterPress,
  afterPush,
  cardsFrom,
  decided,
  type Decision,
  type Held,
} from '../shared/approval-decision.js'
import { firstFocusable } from '../shared/focus.js'
import { renderRoster } from './views/roster.js'
import { hireForm, skillForm } from './views/hire.js'
import { STAFF_AT_FULL_SCALE } from '../shared/floor/floorplan.js'
import { renderStrip, unfinishedShows } from './views/activity.js'
import { summarise as summariseApproval } from '../shared/approval-summary.js'
import { wireMic } from './views/mic.js'
import { renderPrivacy } from './views/privacy.js'
import {
  applyFact,
  applyNote,
  quietNote,
  settle,
  EMPTY as EMPTY_ACTIVITY,
  HISTORY_LIMIT,
  type Activity,
} from '../shared/activity.js'
import { restoreActivity } from '../shared/activity-restore.js'
import { stripLine } from '../shared/strip-line.js'
import { stripTicks } from '../shared/strip-tick.js'
import type { Dispatch, PendingApproval, UnfinishedReport, UnfinishedVerb } from '../shared/ipc.js'
import { truncate } from '../shared/truncate.js'
import { money } from '../shared/cost.js'
import { nothingWasSearched, type Hit } from '../shared/search.js'

const office = window.office

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing element: ${id}`)
  return el as T
}

const els = {
  scrim: $('scrim'),
  switcher: $<HTMLButtonElement>('switcher'),
  switcherList: $('switcher-list'),
  // S1: the `+` segment welded to the switcher, and the two-item menu it opens. Both belong to
  // the switcher, so both are mounted by `views/switcher.ts` rather than wired here.
  newOpen: $<HTMLButtonElement>('new-open'),
  newMenu: $('new-menu'),
  mode: $('mode'),
  modeLede: $('mode-lede'),
  modeDetail: $('mode-detail'),
  modeGo: $<HTMLButtonElement>('mode-go'),
  modeBack: $<HTMLButtonElement>('mode-back'),
  mic: $<HTMLButtonElement>('mic'),
  micPick: $<HTMLButtonElement>('mic-pick'),
  micMenu: $('mic-menu'),
  dialsOpen: $<HTMLButtonElement>('dials-open'),
  dialsMenu: $('dials-menu'),
  dials: $('dials'),
  moreOpen: $<HTMLButtonElement>('more-open'),
  moreMenu: $('more-menu'),
  more: $('more'),
  viewToggle: $<HTMLButtonElement>('view-toggle'),
  transcripts: $('transcripts'),
  pane: document.querySelector<HTMLElement>('.pane')!,
  musicPanel: $('music'),
  stage: $('stage'),
  model: $('model'),
  effort: $('effort'),
  permission: $('permission'),
  canvas: $<HTMLCanvasElement>('floor-canvas'),
  staffCount: $<HTMLButtonElement>('staff-count'),
  themeName: $<HTMLButtonElement>('theme-name'),
  managerName: $('manager-name'),
  phaseDot: $('phase-dot'),
  phaseText: $('phase-text'),
  composer: $<HTMLTextAreaElement>('composer'),
  send: $<HTMLButtonElement>('send'),
  stop: $<HTMLButtonElement>('stop'),
  cost: $('cost'),
  queued: $('queued'),
  slash: $('slash'),
  gettingStarted: $<HTMLButtonElement>('getting-started'),
  said: $('said'),
  firstRunPanel: $('firstrun-panel'),
  firstRunClose: $<HTMLButtonElement>('firstrun-close'),
  firstRunHead: $('firstrun-head'),
  firstRunBody: $('firstrun-body'),
  paletteOpen: $<HTMLButtonElement>('palette-open'),
  settingsPanel: $('settings-panel'),
  settingsClose: $<HTMLButtonElement>('settings-close'),
  settingsBody: $('settings-body'),
  appPalette: $('app-palette'),
  appPaletteInput: $<HTMLInputElement>('app-palette-input'),
  appPaletteList: $('app-palette-list'),
  card: $('card'),
  cardClose: $<HTMLButtonElement>('card-close'),
  cardRole: $('card-role'),
  cardName: $('card-name'),
  cardDesc: $('card-desc'),
  cardDoing: $('card-doing'),
  cardDoingTrace: $('card-doing-trace'),
  cardBubble: $('card-bubble'),
  cardInput: $<HTMLInputElement>('card-input'),
  cardSend: $<HTMLButtonElement>('card-send'),
  cardTalk: $<HTMLButtonElement>('card-talk'),
  tasksButton: $<HTMLButtonElement>('tasks'),
  building: $('building'),
  taskPanel: $('task-panel'),
  taskClose: $<HTMLButtonElement>('task-close'),
  taskProject: $('task-project'),
  taskNote: $('task-note'),
  taskList: $('task-list'),
  taskRunAll: $<HTMLButtonElement>('task-run-all'),
  strip: $('strip'),
  stripToggle: $<HTMLButtonElement>('strip-toggle'),
  stripSummary: $('strip-summary'),
  stripZones: $('strip-zones'),
  privacyPanel: $('privacy-panel'),
  privacyClose: $<HTMLButtonElement>('privacy-close'),
  privacyRoot: $('privacy-root'),
  memoryPanel: $('memory-panel'),
  memoryClose: $('memory-close'),
  memoryBody: $('memory-body'),
  decidedPanel: $('decided-panel'),
  decidedClose: $('decided-close'),
  decidedBody: $('decided-body'),
  searchPanel: $('search-panel'),
  searchClose: $<HTMLButtonElement>('search-close'),
  searchInput: $<HTMLInputElement>('search-input'),
  searchBody: $('search-body'),
  changedPanel: $('changed-panel'),
  changedClose: $<HTMLButtonElement>('changed-close'),
  changedBody: $('changed-body'),
  hooksPanel: $('hooks-panel'),
  hooksClose: $('hooks-close'),
  hooksBody: $('hooks-body'),
  planPanel: $('plan-panel'),
  planClose: $('plan-close'),
  planBody: $('plan-body'),
  connectPanel: $('connect-panel'),
  connectClose: $('connect-close'),
  connectBody: $('connect-body'),
  connectForm: $('connect-form') as HTMLFormElement,
  connectName: $('connect-name') as HTMLInputElement,
  connectTransport: $('connect-transport') as HTMLSelectElement,
  connectCommandField: $('connect-command-field'),
  connectCommand: $('connect-command') as HTMLInputElement,
  connectUrlField: $('connect-url-field'),
  connectUrl: $('connect-url') as HTMLInputElement,
  connectEnv: $('connect-env') as HTMLInputElement,
  connectHeaders: $('connect-headers') as HTMLInputElement,
  connectAdd: $('connect-add'),
  maintainedPanel: $('maintained-panel'),
  maintainedClose: $('maintained-close'),
  maintainedFind: $('maintained-find'),
  maintainedAt: $('maintained-at') as HTMLInputElement,
  maintainedKind: $('maintained-kind') as HTMLSelectElement,
  maintainedLook: $('maintained-look'),
  maintainedCheck: $('maintained-check'),
  maintainedOffered: $('maintained-offered'),
  maintainedBody: $('maintained-body'),
  privacyProblem: $('privacy-problem'),
  privacyBody: $('privacy-body'),
  rosterPanel: $('roster-panel'),
  rosterClose: $<HTMLButtonElement>('roster-close'),
  rosterRoot: $('roster-root'),
  rosterProblem: $('roster-problem'),
  rosterBody: $('roster-body'),
  cardWork: $('card-work'),
  cardWorkHead: $('card-work-head'),
  cardBrief: $('card-brief'),
  cardLog: $('card-log'),
}

/**
 * One conversation per project, kept rather than re-rendered.
 *
 * Switching tabs must not re-read a session from disk, and a transcript you have scrolled back
 * through should still be where you left it when you come back. The DOM is the state.
 */
interface Tab {
  /** The conversation this transcript belongs to. */
  readonly session: string
  readonly element: HTMLElement
  readonly chat: ChatView
  /** True while this conversation's manager is working. Drives the dot on its project's tab. */
  busy: boolean
  /** Whether a saved conversation has already been asked for. Asked once, not on every switch. */
  restored: boolean
  state: SessionState
}

/**
 * One transcript per **conversation**, not per project.
 *
 * A project is a group of sessions, so a project cannot be the key: two of its conversations
 * would share a transcript and each would show work that never happened in it.
 */
const tabs = new Map<string, Tab>()
let active = OFFICE_PROJECT
/** The conversation on screen. Empty until the first one is opened. */
let activeSession = ''
/** Which conversation each project was last showing, so switching back returns to it. */
const lastSession = new Map<string, string>()
/**
 * The conversations whose current run this window has watched from its start.
 *
 * A card can only show the work of a run whose facts all reached the floor. `restore` puts the
 * transcript back and no facts, and an employee is drawn working only through the `dispatch` fact,
 * so a run this window joined halfway is drawn with nobody working. `campusFrom` gives a busy
 * project's card its conversation only while that conversation is in here.
 *
 * `following` in `campus.ts` says when a conversation goes in and comes out, and `hear` applies it:
 *
 * - **In when this window sends a message while no run is going** (`send`). That starts a run, so
 *   the window is following it before main reports `running`. Not for a message queued behind a
 *   run, which may have begun before this window was watching.
 * - **In on `init`** (`feed`), for a run this window did not start with a send: a queued
 *   message's. A turn is one `claude -p` process (`session.ts`). The CLI's headless docs say `init`
 *   is the first event of a process unless startup records come first (plugin installs, and the
 *   output of `SessionStart` and `Setup` hooks). Those parse as `system` events, which carry no
 *   fact.
 * - **Out whenever main reports a phase other than `running`** (`setPhase`), and when a send that
 *   was to start a run fails.
 *   A `result` changes nothing: main reports `idle` after every one.
 *
 * So a window that missed a run's start, like one re-created from the Dock mid-run, never adds
 * it. A queued message's run is not in here from main's `running` until its `init`, and a busy
 * card showing that conversation has no picture for that long.
 */
const followedRuns = new Set<string>()

/** Apply some news about one conversation's run to `followedRuns`. True when that changed it. */
function hear(session: string, news: RunNews): boolean {
  const was = followedRuns.has(session)
  const now = following(was, news)
  if (now === was) return false
  if (now) followedRuns.add(session)
  else followedRuns.delete(session)
  return true
}

let snapshot: OfficeSnapshot | null = null
let managerLabel = 'the manager'
/**
 * Why nobody can answer, or `null` when somebody can.
 *
 * ## A function, and that is the entire point
 *
 * This was a variable, assigned inside the snapshot render and read by three surfaces rendered
 * elsewhere. It passed every test and its own harness and **did not work in the running app**:
 * the mode banner, the transcript and `showPhase` all draw before the first snapshot arrives, so
 * each read the initial `null`, each concluded somebody was listening, and none of them ever ran
 * again. Measured in a real Electron boot against an empty workspace — the composer correctly
 * said "Nobody works here yet" while the banner beside it said "The manager is listening", which
 * is the exact screen this was written to stop.
 *
 * A value that is only correct if its readers happen to run after its writer is not a fixed bug,
 * it is a race that agreed with me once. Derived from `snapshot` at read time, the order stops
 * mattering: a reader that runs early gets the honest answer for "nothing is known yet", and the
 * next paint gets the real one.
 *
 * Kept as the sentence rather than a boolean, so "could not read the staff" cannot flatten into
 * "there is nobody" on the way to a second surface.
 */
function nobodyHere(): string | null {
  // Before the first snapshot the office knows nothing, and claiming there is nobody would be a
  // statement about a workspace it has not looked at yet.
  if (snapshot === null) return null
  const manager = snapshot.staff.find((s) => s.isManager)
  const label = manager?.name ?? manager?.id ?? 'the manager'
  const addressed = /^(the )?manager$/i.test(label) ? 'the manager' : label
  return nobodyListening(manager ? addressed : null, snapshot.problems)
}
/** The update sentence is on every snapshot, and belongs in the transcript exactly once. */
let toldAboutUpdate = false

/**
 * ## Why these two blocks are first
 *
 * Everything below this point is one long run of top-level setup, and a throw anywhere in it
 * stops the rest of the file. That is survivable for most of what follows — a panel that never
 * wires is a panel that does not work. It was **not** survivable for these two, and they were
 * the last two things in the file.
 *
 * Measured on a real complaint: `⌘K` did nothing in a running office, and neither did several
 * other controls. The window was alive, the main process was polling, the workspace was
 * healthy and the build was current — but the shortcut was registered at line 3165 of 3465 and
 * the fault reporter at 3411, so **an exception earlier than either killed the shortcut and
 * the only thing that would have said why.** An uncaught renderer error does not stop Electron,
 * so the app sat there looking finished.
 *
 * The reporter goes first of the two deliberately: if registering the shortcuts throws, that
 * is exactly the kind of fault nobody could see before.
 *
 * Both are safe here. Every helper they call is a hoisted `function`, and the bindings they
 * close over — `palette`, `els`, `snapshot` — are read when a key is pressed or a fault fires,
 * never at registration. Top-level setup is synchronous, so no key can arrive part-way through
 * it. If setup *does* die before `palette` exists, `⌘K` now throws a nameable error into the
 * transcript instead of silently doing nothing, which is the whole point.
 */

/**
 * Faults this window has seen more than once.
 *
 * Renderer-held and never cleared, which is the point. `toSnapshot` rebuilds `problems` from
 * main's own state on every scan, so anything put there vanishes at the next file change — and
 * *"a problem that disappears on its own is one the reader is entitled to think was solved"*.
 * A renderer fault has nothing on disk to be re-derived from; it happened here, in this window.
 *
 * It does not clear either. A fault does not resolve, it stops happening, and "it stopped
 * happening" is not something a window can observe about itself. Reloading is what clears it,
 * which is honest: the condition really is *this window has been failing at X*.
 */
const seenTwice: Problem[] = []

/**
 * Reporting must not become the second fault.
 *
 * Now that this is registered before the tabs exist, a fault during early setup reaches a
 * `current()` that has no transcript to write into — and a reporter that throws while reporting
 * turns one silent failure into two. So the transcript is *tried*, and the console is what
 * catches it when there is nothing to write into yet. The console is not a surface anybody
 * watches, which is exactly why it is the fallback and not the destination.
 */
const sayQuietly = (sentence: string): void => {
  try {
    current().chat.notice(sentence)
  } catch {
    console.error('[office] before the transcript existed:', sentence)
  }
}

/**
 * Anything that goes wrong from here is said out loud.
 *
 * Before `describe()`, because a boot that throws is exactly the case worth catching and the
 * `.catch` below only covers the chain — a listener that throws, or an `invoke` that rejects
 * three frames later, reaches neither.
 *
 * Nothing is caught here. The rejection still rejects and the throw still escapes; the only
 * change is that the window stops keeping it to itself. A catch that swallowed it would turn a
 * call that failed into a call that returned nothing, and the renderer draws nothing perfectly
 * well — a task file that would not open would render as a project with no tasks.
 *
 * Into the transcript, because that is where the reader is and where every other "we could not
 * read this" already goes. `MishapLog` decides what a repeat is worth, so a draw that throws
 * every frame costs four lines rather than sixty a second.
 */
watchForMishaps(
  window,
  sayQuietly,
  // The second time, and only then. One is an event and belongs in the transcript; twice is a
  // condition and belongs where somebody who was not watching will still find it. `office-space-6c`
  // made the case, and the case is sharpest for an office left open unattended, which is the
  // state the approval gate already shows is the normal one.
  (sentence) => {
    seenTwice.push({ kind: 'lint', path: 'the office window', rule: 'renderer-fault', detail: sentence })
    // Guarded for the same reason: a redraw during early setup can reach a view that is not
    // built yet, and a fault reported twice must not become a third.
    try {
      if (snapshot) void render(snapshot)
    } catch {
      console.error('[office] could not redraw after a repeated fault:', sentence)
    }
  },
)

/**
 * The two keys the whole app answers to.
 *
 * On `window` in the capture phase, so it works wherever focus is — including inside the
 * composer, which is where focus spends most of its life and which would otherwise swallow
 * both of them.
 */
window.addEventListener(
  'keydown',
  (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      palette.toggle()
      return
    }

    // Two more, and only two.
    //
    // The palette has carried a `keys` field since it was written — "the accelerator, if it has
    // one; never invented for the display" — and fourteen actions had between them exactly one
    // accelerator plus Escape. The display was never the problem. There was nothing to display.
    //
    // Both of these are conventions rather than inventions, which is the whole bar: `⌘,` opens
    // preferences in every Mac app, and `⌘L` goes to the address bar in every browser — which is
    // what the switcher is, for an office. A third would need a reason somebody could guess.
    if ((event.metaKey || event.ctrlKey) && event.key === ',') {
      event.preventDefault()
      showSettings()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault()
      els.switcher.click()
      return
    }
    // Escape closes what is open, innermost first, and only then gets out of the composer.
    // One key that means "back" rather than five that each mean "close this particular thing".
    if (event.key === 'Escape' && !palette.isOpen) {
      const open = escapables().some((panel) => !panel.hidden)
      if (open) {
        event.preventDefault()
        closeEverything()
        return
      }
      // Nothing is open, so Escape means the other thing it means everywhere else: stop what is
      // running. Last in the chain rather than first — a panel over a running turn is answered
      // by closing the panel, and a key that reached past it to kill the work would be a key
      // nobody could press with confidence.
      if (running) {
        event.preventDefault()
        void stop()
      }
    }
  },
  true,
)

/**
 * Where every face outside the floor comes from.
 *
 * One object, passed to the transcript and used by the card, so there is exactly one path from
 * an agent's name to their picture. Two would be two identity systems that happen to agree
 * today — which is the whole thing F5 and F1c are asking us not to build.
 */
const art: AvatarSource = {
  sprites: (agent) => office.sprites(agent),
  themeId: () => snapshot?.theme.id ?? '',
  manager: () => snapshot?.staff.find((s) => s.isManager)?.id ?? 'manager',
  // The art depends on the description, so the face cache has to key on it. Read from the
  // snapshot this file already holds rather than fetched again — a second lookup would be a
  // second idea of who is on staff.
  describe: (agent) => snapshot?.staff.find((s) => s.id === agent)?.description ?? '',
}
let openAgent: string | null = null

/** The conversation on screen. */
function current(): Tab {
  return tabFor(activeSession)
}

/** Projects with at least one conversation running. Rebuilt whenever a session changes state. */
const busyProjects = new Set<string>()
/** Which project each conversation belongs to, so a busy session marks the right tab. */
const sessionProject = new Map<string, string>()

function recomputeBusy(): void {
  busyProjects.clear()
  for (const [session, tab] of tabs) {
    const project = sessionProject.get(session)
    if (tab.busy && project !== undefined) busyProjects.add(project)
  }
}

/** A conversation's transcript, created the first time it is mentioned. */
function tabFor(session: string): Tab {
  const existing = tabs.get(session)
  if (existing) return existing

  const element = document.createElement('div')
  element.className = 'transcript'
  element.setAttribute('role', 'log')
  element.setAttribute('aria-live', 'polite')
  element.hidden = session !== activeSession

  const empty = document.createElement('p')
  empty.className = 'empty'
  /*
   * This invited somebody to "say something to the manager and watch the floor" on a workspace
   * whose composer was disabled for having no manager. It now says what is true of the
   * transcript, and leaves *why* to the status pill and the first-run panel, which both already
   * say it — a third copy of one sentence is not more honest, only louder.
   */
  empty.textContent =
    nobodyHere() !== null
      ? 'Nothing said here yet.'
      : active === OFFICE_PROJECT
        ? 'The office is waiting. Say something to the manager and watch the floor.'
        : 'Nothing said in this conversation yet. Say something and the office gets to work.'
  element.appendChild(empty)

  els.transcripts.appendChild(element)

  const tab: Tab = {
    session,
    element,
    chat: new ChatView(element, empty, art, (ledger) => record.open(ledger), (who) => void openCard(who)),
    busy: false,
    restored: false,
    // A tab before its first state arrives. New conversations open in intake, so that is the
    // truth at this moment rather than a placeholder.
    state: { phase: 'idle', mode: 'intake', sessionId: null, costUsd: null, error: null, queued: [] },
  }
  tabs.set(session, tab)
  return tab
}

let running = false

// ─────────────────────────────────────────────────────────────────────── voice ──

/**
 * The office's voice, and the rather more important business of when it shuts up.
 *
 * `systemSpeaker` returns null where there is no synthesiser, and then the toggle is disabled
 * with the reason on it rather than offered as a button that does nothing.
 */
const speaker = systemSpeaker(() => director?.finished())
const director = speaker ? new SpeechDirector(speaker) : null

/**
 * True when this machine can speak at all.
 *
 * `systemSpeaker` returns null where there is no synthesiser. That used to disable a button in
 * the composer with the reason on it; the toggle now lives in settings, so the reason travels
 * there instead — a setting that cannot be turned on has to say why, wherever it is.
 */
const canSpeak = director !== null

/**
 * Whether the office reads aloud.
 *
 * Held here rather than read off a button's `aria-pressed`, because the button has moved into
 * the settings panel and that panel does not exist until somebody opens it. State that lives in
 * the DOM of a surface that may not be mounted is state that reads as `false` for reasons that
 * have nothing to do with the setting.
 */
let voiceOn = false

function setVoice(on: boolean): void {
  if (!director) return
  voiceOn = on
  director.setMuted(!on)
  void office.setVoice(on)
}
/**
 * The last status answer per agent, so opening the card after reading the bubble does not
 * spend a second aside asking the same question. Cleared when a bubble goes stale, because at
 * that point the answer is about a moment that has passed.
 */
const lastAnswers = new Map<string, string>()

/**
 * Where the mechanism went.
 *
 * Mounted on the pane rather than on the transcript, so it covers the conversation *and* its
 * composer — you are reading a record, not part-way through writing a reply to it. Constructed
 * once and reused, because a drawer per tab would be several surfaces holding the same shape.
 */
const record = mountRecord(els.pane)

/**
 * The music.
 *
 * Mounted once, next to the strip, and only ever *refreshed* — never polled. A controller that
 * asked Spotify every few seconds would be egress at rest, which is the fifth condition in the
 * plan's D3 and the one easiest to break without noticing. It reads the player when you open it,
 * when you press something, and not otherwise.
 */
const music = mountMusic(els.musicPanel, {
  player: () => office.musicPlayer(),
  // E1 applies to these too, and I had missed it: connecting writes a token to the keychain,
  // disconnecting deletes it, and the switch writes a file. All three succeeded in silence —
  // the panel redrew and nothing said the write had landed, which is exactly the fault E1 is
  // about. Announced here rather than inside the view, so the view stays a drawing module and
  // there is one place that decides what a write sounds like.
  connect: async () => {
    const result = await office.musicConnect()
    say(result.ok ? 'Spotify connected.' : (result.problem ?? 'Spotify did not connect.'), result.ok ? 'done' : 'failed')
    return result
  },
  disconnect: async () => {
    await office.musicDisconnect()
    say('Spotify disconnected. The stored token has been deleted.')
  },
  command: (what, deviceId) => office.musicCommand(what, deviceId),
  transfer: (deviceId, play) => office.musicTransfer(deviceId, play),
  search: (query) => office.musicSearch(query),
  playTrack: (uri, deviceId) => office.musicPlayTrack(uri, deviceId),
  setup: () => office.musicSetup(),
  setClientId: (id) => office.musicSetClientId(id),
  setNetwork: async (allowed) => {
    await office.musicSetNetwork(allowed)
    say(
      allowed
        ? 'Office Space may make its own network requests again.'
        : 'Office Space will make no network requests of its own.',
    )
  },
}, {
  // The room follows the real player rather than a local flag, so the carpet warming is a
  // *report* about a device that is actually making sound rather than a decoration.
  changed: () => floor.setMusicPlaying(music.isPlaying()),
  // The panel asks; the app closes. The pill's pressed state lives here, so if the panel hid
  // itself the pill would go on claiming the panel was open.
  close: () => closeMusic(),
})

/** Where focus was before the music took it. Restored on close, like every other panel. */
let musicReturnFocus: HTMLElement | null = null

/**
 * Close the music.
 *
 * Deliberately **not** part of `onlyPanel`, and the reason is where it lives: the cards float
 * over the office and compete for the same space, so opening one has to close the others. The
 * music is in the activity strip, under the floor — it overlaps nothing, and closing it because
 * somebody opened the roster would be taking away a thing they can still see.
 *
 * `closeEverything` is different. Escape is the universal way out and it has to mean *out*, so
 * this belongs there. That it did not is a bug found by clicking through every surface in order
 * rather than by testing one.
 */
function closeMusic(): void {
  const wasOpen = els.musicPanel.hidden === false
  els.musicPanel.hidden = true
  if (!wasOpen) return
  const back = musicReturnFocus
  musicReturnFocus = null
  restoreFocus(back, els.composer)
}

/**
 * Open the music, and put the keyboard in it.
 *
 * The music panel is **not** one of `coveringPanels()` — it sits in the strip under the floor
 * rather than over the app, so it gets no scrim and `watchPanels` does not manage its focus.
 * That is right for what it is and it left it as the one surface in the app that opened without
 * taking focus at all: chosen from ⌘K, `document.activeElement` stayed on `<body>`, so the panel
 * was on screen and the keyboard was nowhere near it.
 *
 * Non-modal does not mean unfocused. Every way in here is somebody asking for it by name — the
 * palette entry, the `···` menu, a click on the lounge — and a surface you asked for is one you
 * want to use.
 */
function openMusic(): void {
  const show = els.musicPanel.hidden
  els.musicPanel.hidden = !show
  if (!show) {
    closeMusic()
    return
  }
  els.stripZones.hidden = false
  els.stripToggle.setAttribute('aria-expanded', 'true')
  musicReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null

  // The first thing that can be acted on, and the close button as a floor. `firstFocusable`
  // rather than a bare `querySelector`, for the reason `watchPanels` gives: a disabled control
  // matches the selector, accepts `.focus()`, and does nothing with it — which is how a panel
  // opens with the keyboard still behind it and nothing says so.
  const aim = (): void => {
    const candidates = Array.from(
      els.musicPanel.querySelectorAll<HTMLElement>('input, textarea, [href], button:not(.card__close)'),
    )
    firstFocusable(candidates, els.musicPanel.querySelector<HTMLElement>('.card__close'))?.focus()
  }
  aim()

  // And again once the panel has drawn what it fetched.
  //
  // `refresh` replaces the panel's contents, which detaches whatever `aim` just focused and
  // drops the keyboard on `<body>` — measured: the panel opened, `document.activeElement` was
  // `BODY`, and the first aim had worked a moment earlier. Aiming twice rather than only after
  // the fetch, because a disconnected panel answers without a request and should not wait for a
  // promise to be usable.
  //
  // Only when focus really did fall through. A person who clicked into the composer while the
  // panel was fetching must not be yanked back into it.
  //
  // And it defers to the person. `document.body` is what `activeElement` reports for three
  // different reasons — nothing ever claimed focus, the focused element was just removed, **and
  // the user clicked on anything non-focusable**, which is the most ordinary thing a mouse does
  // between actions. The first two want the aim and the third is theft, and the DOM cannot tell
  // them apart afterwards. So the difference is recorded while it happens: any press during the
  // fetch means the person is somewhere of their own choosing, and the redraw does not get to
  // move them. `office-space-6c`.
  let moved = false
  const noticeThePerson = (): void => {
    moved = true
  }
  document.addEventListener('mousedown', noticeThePerson)
  document.addEventListener('keydown', noticeThePerson)

  void music.refresh().finally(() => {
    document.removeEventListener('mousedown', noticeThePerson)
    document.removeEventListener('keydown', noticeThePerson)
    if (!moved && document.activeElement === document.body) aim()
  })
}

const floor = new FloorView(els.canvas, els.stage, {
  // Clicking someone asks them, on the floor, where you are looking. The card is the full
  // detail behind that — reached from the bubble, not instead of it.
  onPick: (who) => void askOnFloor(who),
  onDetails: (who) => void openCard(who),
  onStale: (who) => lastAnswers.delete(who),
  // The sofa opens the controller rather than toggling a drone. Discoverable *and* keeps the
  // shortcut that was already there; see floor-view's own note on why it is no longer the
  // only door.
  onPickMusic: () => openMusic(),
  onArtFailed: (who, cause) =>
    current().chat.notice(
      `The theme could not be drawn from for ${who}, so their desk is empty — ${cause}`,
    ),
  // Campus: clicking an office focuses that project. Added by laptop 2 — see 03-LOG.
  onPickProject: (id) => {
    showCampus(false)
    void switchTo(id)
  },
  onUnstaged: (missing) =>
    current().chat.notice(
      `${missing.employee} was dispatched but has no desk on this floor — there is no agent by that name in .claude/agents/. ` +
        `The work is real; the office just cannot show it. The dispatch is ${missing.toolUseId} in the transcript.`,
    ),
})

// ────────────────────────────────────────────────────────────────────── the office ──

/**
 * Who is speaking in a conversation.
 *
 * The manager, unless the conversation belongs to somebody else. Read from the session list
 * rather than tracked separately: `SessionInfo.agent` is already the answer and a second copy
 * would be a second thing to keep in step.
 */
function speakerFor(sessionId: string): string {
  const mine = knownSessions.find((s) => s.id === sessionId)
  if (!mine || mine.agent === (snapshot?.staff.find((m) => m.isManager)?.id ?? 'manager')) return managerLabel
  return snapshot?.staff.find((m) => m.id === mine.agent)?.name ?? mine.agent
}

/** Staff and shelf as the roster last drew them, so a repaint costs nothing when nothing moved. */
let rosterShowing = ''

async function render(next: OfficeSnapshot): Promise<void> {
  snapshot = next
  const manager = next.staff.find((s) => s.isManager)
  /**
   * `'the manager'` is a fallback, not a fact — and it was being printed as one.
   *
   * An empty workspace has no manager: `openSession` throws rather than starting one. The header
   * said `the manager · idle` anyway, beside a composer inviting a stranger to ask it something.
   * Idle is a thing a person does; nobody was there to do it.
   *
   * An em dash is what this element already holds before the first snapshot arrives, and it is
   * the right answer for the same reason: there is no name to give, and inventing one is the
   * third standing order broken on somebody's first screen.
   */
  managerLabel = manager?.name ?? manager?.id ?? 'the manager'

  els.managerName.textContent = manager ? managerLabel : '—'
  // And the field stops inviting a conversation with somebody who is not there. Same rule as the
  // header above it, applied to the element a stranger's eye actually lands on first.
  // "Ask manager for something" — the article goes missing when the manager's name *is*
  // "manager", which is the default and so the common case. A name gets no article; a role does.
  const addressed = /^(the )?manager$/i.test(managerLabel) ? 'the manager' : managerLabel
  // The window's own faults alongside the workspace's. A fault this window has hit twice is a
  // thing wrong with the office, and both the composer and the status line below read it.
  const allProblems = seenTwice.length === 0 ? next.problems : [...next.problems, ...seenTwice]

  // Three states, not two — `manager` is null both when there is nobody and when `.claude/agents/`
  // could not be opened, and those are different facts. `composerInvite` uses the same predicate
  // `staffPart` does, two lines down, so the composer and the status line cannot disagree about
  // whether the staff were readable.
  els.composer.placeholder = composerInvite(manager ? addressed : null, allProblems)
  // Not stored. `nobodyHere()` reads the snapshot, and this render is what set it — so calling it
  // here and calling it from a surface that drew ten seconds ago give the same answer.
  els.send.disabled = nobodyHere() !== null
  /*
   * And the surfaces painted elsewhere are repainted, because the snapshot is what they were
   * missing.
   *
   * `showMode` and the transcript both draw before the first snapshot arrives — measured in a
   * real boot — so without this they keep whatever they concluded from an office nothing had
   * looked at yet. Making `nobodyHere` a function stopped them reading a stale *variable*; this
   * is what stops them showing a stale *paint*.
   */
  showMode(currentMode)
  els.composer.disabled = !manager
  // Both halves in `shared/status-line.ts`, and out here rather than inline because this module
  // imports electron at load and no test can reach it. The singular was already handled -- `1
  // skills` is reachable and this line is permanent; what was not is that a count of zero from a
  // directory nothing could open reads exactly like a count of zero from an empty one.
  // The window's own faults alongside the workspace's. A fault this window has hit twice is a
  // thing wrong with the office, and the status line is where the office says what is wrong.
  els.staffCount.textContent = statusLine(next.staff.length, next.skills.length, allProblems)
  els.themeName.textContent = themeLabel(next.theme)
  // One theme is not a choice, so the pill is only a control when there is something to choose.
  els.themeName.disabled = next.themes.length < 2
  els.themeName.title = themeTitle(next.theme, next.themes)

  // Problems are shown, always. A workspace that cannot be read is a fact about the office,
  // and one an empty-looking floor would otherwise explain as "no agents yet".
  // One line, and one surface behind it.
  //
  // There used to be two: this, which printed the whole of the first problem across the bottom
  // of the floor, and the getting-started pill beside it. They overlapped — the untrusted
  // warning appeared in both, in different words — and neither was complete. Now the diagnosis
  // owns every condition and this is the way in.
  const started = summariseFirstRun(diagnose(firstRunState()))
  els.gettingStarted.hidden = started === null
  els.gettingStarted.textContent = started ?? ''
  els.gettingStarted.dataset['tone'] = toneOf(allProblems.length)
  // The panel this badge counts, if somebody has it open. Same diagnosis, same moment — the two
  // disagreeing is the defect `refreshFirstRun` exists to stop.
  refreshFirstRun()

  /*
   * And the roster, for the same reason one level along.
   *
   * Both panels were painted once, when they opened, while the counts beside them kept being
   * rebuilt from the same data on every snapshot. That is one fact drawn twice with only one of
   * the two re-read, which is the shape this repository keeps finding. Keyed on what the roster
   * actually shows, because painting it costs three IPC round-trips and two disk reads and a
   * snapshot arrives whenever anything in the workspace moves.
   */
  const showing = `${next.staff.map((m) => m.id).join(',')}|${next.skills.map((k) => k.id).join(',')}`
  if (showing !== rosterShowing) {
    rosterShowing = showing
    refreshRoster()
  }

  // No notice here. `diagnose()` raises `no-staff` for exactly this, the panel opens itself for
  // it now that it is a blocker, and saying it in the transcript as well meant a stranger's
  // first screen carried the same fact twice — once as prose and once as a stack trace.

  // The update, said once, on whichever snapshot arrives first. Main puts the same sentence on
  // every one of them because reconciliation happens before there is a window to tell — and a
  // line repeated at every roster change is a line nobody reads. It goes in the transcript
  // rather than the diagnosis, because nothing is wrong: files of ours moved, files of theirs
  // did not, and an office that rewrote either without saying so would be doing it *to* them.
  if (next.update && !toldAboutUpdate) {
    toldAboutUpdate = true
    current().chat.notice(next.update)
  }
  

  // The tab bar is a function of the snapshot, so it is redrawn whenever the snapshot is —
  // including when a project appears on disk while the app is running.
  renderSwitcher()

  // A project directory that has been deleted takes its tab with it. Anything being said in it
  // has nowhere to go, so the office falls back to itself rather than leaving the pane pointed
  // at a tab that no longer exists.
  if (!next.projects.some((p) => p.id === active)) {
    active = OFFICE_PROJECT
    renderSwitcher()
    const seen = lastSession.get(OFFICE_PROJECT)
    if (seen) await openSession(seen)
    else await openCurrent(OFFICE_PROJECT)
  }

  floor.setSkills(next.skills.length)
  await floor.setCast(next.staff, (name) => office.sprites(name), next.theme.id)
  floor.start()
}


// ─────────────────────────────────────────────────────────────────── the session ──

/**
 * One event, into the project it belongs to.
 *
 * Events arrive for projects you are not looking at, and both the transcript and the floor for
 * those projects have to stay correct — otherwise coming back to a tab shows a conversation
 * with a hole in it and a floor that never moved.
 */
function feed(session: string, event: ClaudeEvent): void {
  // Whose voice this is, not whose office it is.
  //
  // Every turn was labelled with the manager regardless — which was true while the manager was
  // the only one you could talk to, and became a lie the moment employees got conversations of
  // their own. The tester's first answer arrived under the manager's name, which is standing
  // order 3 broken on the feature built to let somebody speak for themselves.
  tabFor(session).chat.event(event, speakerFor(session))

  const manager = snapshot?.staff.find((s) => s.isManager)?.id ?? 'manager'
  const facts: Fact[] = factsFromEvent(event, manager)
  if (event.kind === 'result') facts.push({ kind: 'settled', who: manager })
  floor.apply(session, facts)

  // Whether this window is watching the run from its start, which is what lets a busy card be a
  // picture of it. See `followedRuns`. The campus is told now rather than at its next redraw, which
  // nothing guarantees before the run ends.
  if (hear(session, { kind: 'event', event: event.kind })) renderSwitcher()

  // The strip reads the same facts the floor does. Not a second derivation from the raw event:
  // two code paths reading one stream is how a strip and a floor come to disagree about who is
  // busy, and the whole point of `factsFromEvent` is that there is one.
  const at = new Date().toISOString()
  let activity = activityFor(session)
  for (const fact of facts) activity = applyFact(activity, fact, at)

  // A turn that ended with somebody still dispatched is a dispatch whose result never arrived.
  // Clearing it here is what stops a killed run leaving somebody shown as working forever.
  if (event.kind === 'result') {
    activity = settle(activity, at)
    if (event.isError && event.text) {
      activity = applyNote(activity, { kind: 'failed', who: manager, text: firstLine(event.text), at })
    }
    for (const denial of event.denials ?? []) {
      activity = applyNote(activity, {
        kind: 'refused',
        who: manager,
        // The detail verbatim, never a paraphrase — it is the answer to "why did nothing
        // happen", and a summary of a refused command is not that answer.
        text: denial.detail ? `${denial.tool} refused: ${denial.detail}` : `${denial.tool} refused`,
        at,
      })
    }
  }

  activityBySession.set(session, activity)
  // `activeSession`, not `active`. This compared a session id to a project id, so it was false
  // on every event and the strip never redrew from the stream at all.
  if (session === activeSession) drawStrip()
}

/** Amber once the office has reported anything, so the way in is visible without being loud. */
function toneOf(problems: number): string {
  return problems > 0 ? 'warn' : 'quiet'
}

/** The first line of a failure, which is the part that says what went wrong. */
function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? text
}

function setPhase(session: string, state: SessionState): void {
  const tab = tabFor(session)
  tab.state = state
  tab.busy = state.phase === 'running'
  if (state.error) tab.chat.notice(state.error)
  // A run that is over is not being watched any more. The redraw below tells the campus.
  hear(session, { kind: 'phase', phase: state.phase })

  recomputeBusy()
  renderSwitcher()
  void renderSessions()
  if (session === activeSession) showPhase(state)
}









/**
 * The switcher, and the campus that reads from the same list.
 *
 * Was `renderTabs`. The tab strip, the 12.5px session button and its drawer were three surfaces
 * answering one question; this is the one. `naming` went with the strip — naming a new project
 * is a prompt now rather than an inline input in a row of tabs.
 *
 * This note used to say `busyProjects` went too. It did not: it is written in `renderSwitcher`'s
 * neighbour and read on the row it builds. And `naming` had not gone either — the variable was
 * still declared, and dead, for as long as this comment claimed it was deleted. Two names, one
 * sentence, both wrong in opposite directions. `noUnusedLocals` is on now, which is what makes
 * the second kind impossible to leave lying around.
 */
function renderSwitcher(): void {
  // Before the first snapshot arrives. Never talked to yet, so the row says so rather
  // than guessing: zero conversations and no last-active is the truth at this moment.
  //
  // Declared once, because the campus below reads it too. It used to build its own copy with
  // three of the six fields, which typechecked precisely because nothing read the other three —
  // and that is why `busy` could not be taken from `running` here. The note under `setCampus`
  // says the campus "reads from the same list the tabs do"; before this it read from the same
  // list except when there was no snapshot, which is the case the fallback exists for.
  const projects: readonly ProjectInfo[] = snapshot?.projects ?? [
    { id: OFFICE_PROJECT, name: 'The office', missing: [], conversations: 0, lastActiveAt: null, running: false },
  ]

  switcher.render({
    projects,
    activeProject: active,
    sessions: knownSessions,
    root: snapshot?.root ?? '',
    // Which agent runs the office. From the roster rather than assumed to be called "manager" —
    // `findManager` takes whoever can delegate when nobody is.
    manager: snapshot?.staff.find((m) => m.isManager)?.id ?? 'manager',
    now: Date.now(),
  })

  // The campus reads from the same list the tabs do, so an office appears out there the moment
  // its tab appears here. Cheap — it lays out cards, not floors.
  // Counted in `shared/floor/campus.ts` so it can be tested — nothing in the suite reaches this
  // file. `project` arrives from main off the session registry rather than being reconstructed
  // here: the renderer's own session map only ever holds the project you have opened.
  const heldPerProject = waitingByProject(approvals)

  // `staff` is the workspace's roster, and the same for every office by construction: agents
  // live in `.claude/agents/` at the root, not per project. So it drives the lights and cannot
  // tell two offices apart — which is why it is not what a card is read for.
  //
  // `lastSession` says which conversation each card is a picture of. The floor keeps a scene per
  // conversation, so that — not the project id — is the scene a project's facts actually reach.
  // `followedRuns` says which of those pictures can show a run: a busy project's card gets its
  // conversation only when this window watched the run from its start.
  floor.setCampus(
    campusFrom(
      projects,
      snapshot?.staff.length ?? 0,
      heldPerProject,
      active,
      busyProjects,
      lastSession,
      followedRuns,
    ),
  )
}

/**
 * The conversations in this project, held so the switcher can draw both levels at once.
 *
 * Kept rather than fetched on open, because the trigger says which conversation you are in even
 * when the list is shut — and a label that has to await an IPC round trip is a label that is
 * briefly wrong. `onSessions` keeps it true; see `watchSessions`.
 */
let knownSessions: readonly SessionInfo[] = []

/**
 * Draw the conversations in the current project.
 *
 * Read from the main process rather than from what the renderer happens to have in memory,
 * because most of a project's conversations are not running — the history outlives the process,
 * which is the point of writing it down.
 */
async function renderSessions(): Promise<void> {
  knownSessions = await office.sessionsOf(active)
  // Which project each conversation belongs to, so a busy session marks the right row. Kept
  // here rather than in the view, because it is state the wiring owns.
  for (const info of knownSessions) sessionProject.set(info.id, active)
  dropStrandedTabs()
  renderSwitcher()
}

/**
 * Panes for conversations that never happened.
 *
 * `office.openSession(project, null)` mints a session every time it is asked, because that is
 * what *new conversation* means — and a conversation nobody has said anything in never gets a
 * record, so the office does not list it. Both halves are right. Together they left a pane per
 * press of `+ new conversation`, keyed by an id the switcher would never show again: measured at
 * one pane per click, sessions staying at one, growing for the life of the window.
 *
 * Three conditions, and the third is the one that makes this safe rather than a guess:
 *
 * - **not the one on screen** — the active pane is never a candidate, whatever the list says
 * - **not in the office's own list** — its decision, not a heuristic of ours about staleness
 * - **`state.sessionId === null`** — no Claude session has come back for it yet
 * - **the pane is still showing nothing but its empty state**
 *
 * The last one is not belt-and-braces; it is the condition that actually holds. The first version
 * of this stopped at `sessionId`, on the reasoning that a conversation which had run would have an
 * id, and a record, and therefore a listing. **That reasoning is wrong, and it was caught by
 * running it:** `sessionId` arrives on a *stream event*, after the send. Between pressing Send and
 * the first event there is a window where a conversation has been sent to, has the person's own
 * words on screen, and has no id — and the first version deleted exactly that pane, losing a
 * message somebody had just typed.
 *
 * A send appends the outgoing message immediately, which is why the pane is the honest witness:
 * anything that has been sent to has content, whatever its bookkeeping says yet.
 */
function dropStrandedTabs(): void {
  const listed = new Set(knownSessions.map((s) => s.id))
  for (const [id, tab] of tabs) {
    if (id === activeSession || listed.has(id)) continue
    if (tab.busy || tab.state.sessionId !== null) continue
    // Nothing but the empty-state paragraph it was built with. See the note above: this is the
    // condition that survived being run, and the three above it are the ones that did not.
    if (tab.element.childElementCount > 1) continue
    tab.element.remove()
    tabs.delete(id)
    sessionProject.delete(id)
  }
}

/**
 * The list follows the office rather than being re-fetched by whoever remembers.
 *
 * Laptop 2 built this event for exactly this control (§16.4 of the finalisation plan): `onOffice`
 * covers agents, skills and projects, `onSessionState` covers one session's phase, and neither
 * fires for the list itself. Without it the one surface whose whole job is saying *which
 * conversation you are in* would be the one that goes stale.
 */
function watchSessions(): void {
  office.onSessions((list) => {
    if (list.project !== active) return
    knownSessions = list.sessions
    for (const info of list.sessions) sessionProject.set(info.id, active)
    renderSwitcher()
  })
}

/** Named for the surface it closes, so `escapables()` and this cannot drift apart. */
function closeSwitcher(): void {
  switcher.close()
}

/**
 * Show whichever conversation this project is already having.
 *
 * Distinct from starting one, and the distinction matters on launch: opening the app must put
 * you back in the conversation you were having, not open a second one beside it and replay the
 * first one's transcript into it. A project with no conversations at all gets its first.
 */
async function openCurrent(project: string): Promise<void> {
  const list = await office.sessionsOf(project)
  const target = list.find((s) => s.current) ?? list[0]
  await openSession(target?.id ?? null)
}

/**
 * Show a conversation, or start one.
 *
 * The transcript and the floor are both keyed to it: two conversations in one project are two
 * different pieces of work, and sharing either would show work that never happened.
 */
async function openSession(id: string | null): Promise<void> {
  closeCard()
  const info = await office.openSession(active, id)

  // Bound before the early return, not after it. These two say which project a conversation
  // belongs to and which conversation a project was last on — facts about the answer we just
  // got, true whether or not it happens to be the one already on screen. Setting them only on
  // a *change* left them stale for any path that resolved to the same id, so a later send or
  // restore could be routed by a binding that no longer matched.
  lastSession.set(active, info.id)
  sessionProject.set(info.id, active)

  if (info.id === activeSession) return

  /*
   * `tabs.has`, not truthiness — `''` is a real key here.
   *
   * `activeSession` starts as the empty string, and `current()` is `tabFor(activeSession)`. So
   * anything that writes to the pane before a conversation is opened — the *"your office was
   * updated"* notice at startup is the one that does it — creates a genuine tab under `''`.
   * Guarded on truthiness, that tab is never hidden: it keeps painting in the same grid cell as
   * the conversation, and `styles.css` describes the result exactly, having been written for it
   * once already — *"It looks like one transcript with two conversations printed on top of each
   * other, and `element.hidden` reads perfectly true the whole time."*
   *
   * Found by sending one message to the manager and looking at the screen. Both panes reported
   * `grid-area: 1 / 1`, identical geometry, `opacity: 1`. The empty string being both a falsy
   * value and a real identifier is the same trap `OFFICE_PROJECT` sets one file over.
   */
  if (tabs.has(activeSession)) tabFor(activeSession).element.hidden = true
  activeSession = info.id

  const tab = tabFor(info.id)
  tab.element.hidden = false
  floor.setProject(info.id)
  showPhase(tab.state)
  // The strip is keyed by conversation, and the line above is the one that changed which
  // conversation this is. Drawing here is what makes the panel follow it, in the same frame as
  // the transcript. Without this the strip kept the *previous* conversation's work beside the new
  // transcript until something else happened to redraw — measured in the dev harness as a
  // conversation with nothing in it reading "2 logged", which was the other one's count.
  drawStrip()
  await renderSessions()
  await restore(info.id)
  // Tasks belong to the project, and the floor you are now looking at is one of its
  // conversations — so the marks have to be the marks for this project.
  void refreshOutcomes()
}

/** Show a project: its conversation, its floor, its status. */


function fillDials(): void {
  buildDials(els, () => void saveControls())
}

async function loadControls(): Promise<void> {
  showControls(await office.controlsOf(active), [], [])
  labelDials()
}

async function saveControls(): Promise<void> {
  const result = await office.setControls(active, readDials(els))
  // Painted from what came back, never from what was sent. If the office refused a value, the
  // picker has to show the refusal rather than the request.
  showControls(result.controls, result.unknown, result.ignored)
  labelDials()
}

/**
 * Paint the dials, and say what was dropped.
 *
 * The view paints; naming the dropped values is a sentence in the conversation, which the view
 * has no access to and should not have.
 */
function showControls(
  controls: Controls,
  unknown: readonly string[],
  ignored: readonly string[],
): void {
  paintControls(els, controls, unknown)

  if (unknown.length > 0) {
    // Named rather than swallowed. A user who set something the office ignored is owed the
    // reason, not left wondering why nothing changed.
    current().chat.notice(
      `The office ignored ${unknown.join(', ')} — the installed claude does not recognise ` +
        `${unknown.length === 1 ? 'that value' : 'those values'}. Everything else was applied.`,
    )
  }

  if (ignored.length > 0) {
    // A different sentence, deliberately. These values *are* recognised — the CLI takes them
    // and then drops them because the office runs `--print`, which has nobody to answer a
    // prompt. Saying "not recognised" here would be a second false statement covering the
    // first, which is how the original fault got past a green test suite.
    current().chat.notice(
      `${ignored.join(', ')} is understood by claude but has no effect here: the office runs ` +
        `--print, and that mode needs someone to answer a prompt. Left at default.`,
    )
  }
}


async function switchTo(project: string, session?: string): Promise<void> {
  /*
   * `session` is which conversation to land in, for callers that already know.
   *
   * Without it this function *always* opens one — the last one seen here, or `openCurrent`, whose
   * `null` argument means **start a new conversation**. A caller that switches project and then
   * opens a particular conversation therefore opened two, and if the project had no last-seen
   * session the first of those was a stray empty conversation created on the way past. Search
   * results are exactly that caller.
   *
   * `active` is assigned below before the first `await`, so a conversation opened from here is
   * already bound to the right project — the binding is what makes it safe, not the awaiting.
   */
  const arriving = project !== active

  if (!arriving && session === undefined) return

  closeCard()
  active = project
  renderSwitcher()
  // The bar, in the same frame as the tab changing. It cannot be the new project's work yet: the
  // strip is keyed by conversation, and which conversation this project lands in is not known
  // until `openSession` below, which draws it again once it is. What this draw keeps current is
  // the part that is not per conversation — the held calls waiting on you.
  drawStrip()
  await loadControls()

  // The conversation the caller named, when there is one. Nothing else is opened on the way:
  // the point of passing it is that the office lands in one conversation rather than two.
  if (session !== undefined) {
    await openSession(session)
    return
  }

  // Back to the conversation you were last having here, or whichever one this project is
  // showing. Landing somewhere else would lose your place for no reason.
  const seen = lastSession.get(project)
  if (seen) await openSession(seen)
  else await openCurrent(project)
}

/**
 * Start a project, and go to it.
 *
 * A name that is already taken opens the project that is there rather than making a second
 * one — `createProject` refuses to copy the template over an existing plan.
 */
async function startProject(name: string): Promise<void> {
  const created = await office.createProject(name)

  if (created.state === 'failed') {
    current().chat.notice(`Could not start that project: ${created.cause}`)
    return
  }

  if (created.state === 'exists') {
    current().chat.notice(`There is already a project called "${created.id}". Opening it.`)
  }

  await switchTo(created.id)
}

/** The status line, for whichever project is on screen. */
function showPhase(state: SessionState): void {
  running = state.phase === 'running'
  els.phaseDot.dataset['phase'] = state.phase
  els.phaseText.textContent = state.phase
  // Sending stays available while a turn runs. Typing ahead is queued, in order, one run at a
  // time — the composer no longer has to refuse you because the office is busy.
  //
  // Busy is not the same as nobody being here. This was `false` unconditionally, so an office
  // with no manager drew a live Send beside a composer disabled for having nobody to send to.
  els.send.disabled = nobodyHere() !== null
  els.stop.hidden = !running
  els.queued.hidden = state.queued.length === 0
  els.queued.textContent =
    state.queued.length === 0
      ? ''
      : `${state.queued.length} waiting: ${state.queued.map((q) => shorten(q)).join(' · ')}`
  els.cost.textContent = state.costUsd === null ? '' : `${money(state.costUsd)} this session`
  showMode(state.mode)
}

/** What mode the conversation on screen is in, so the palette can offer the way out of it. */
let currentMode: Mode = 'intake'

/**
 * What this conversation may do right now, and the control that moves it on.
 *
 * Drawn from `SessionState.mode`, which every phase update carries, so a pane opened mid
 * conversation is right without waiting for anything to change.
 */
function showMode(mode: Mode): void {
  currentMode = mode
  // The floor is told what kind of state this is, not just the panel. `intake` and `planning`
  // are the modes where you and the manager are deciding something together and nobody has been
  // sent to build it — so the manager stays with you rather than walking back to a desk the
  // moment you stop typing. See the `conversing` fact in choreography.ts.
  floor.apply(activeSession, [{ kind: 'conversing', conversing: mode === 'intake' || mode === 'planning' }])

  const chrome = modeChrome(mode)
  /*
   * Not shown at all when nobody can answer.
   *
   * It said "The manager is listening" unconditionally, with a live "That's the whole vision"
   * button, directly above a composer correctly disabled for having no manager. The first fix
   * here replaced the lede with the reason — and put a sentence on screen that the status pill
   * and the first-run panel were already both showing, three times in one view.
   *
   * The banner describes a conversation with a manager. There is no manager, so there is no
   * conversation for it to describe, and the fact belongs where it already lives rather than
   * echoed into every surface that would otherwise have said something false.
   */
  els.mode.hidden = !chrome.shown || nobodyHere() !== null
  if (els.mode.hidden) return

  els.modeLede.textContent = chrome.lede
  els.modeDetail.textContent = ` ${chrome.detail}`
  els.modeGo.textContent = chrome.action ?? ''
  els.modeGo.hidden = chrome.action === null
  els.modeGo.disabled = false
  els.modeGo.dataset['next'] = chrome.next ?? ''

  els.modeBack.textContent = chrome.back ?? ''
  els.modeBack.hidden = chrome.previous === null
  els.modeBack.disabled = false
  els.modeBack.dataset['next'] = chrome.previous ?? ''
}

els.modeBack.addEventListener('click', () => moveMode(els.modeBack))
els.modeGo.addEventListener('click', () => moveMode(els.modeGo))

/**
 * Move this conversation to another mode, forwards or back.
 *
 * One function for both directions on purpose. Going back is not a different kind of event from
 * going on — it is the same decision, made by the same person, and a separate path for it would
 * be a second place to get the spent-button handling wrong.
 */
function moveMode(button: HTMLButtonElement): void {
  const next = button.dataset['next']
  if (next === undefined || next === '') return
  // Spent the moment it is pressed, and not re-enabled here. `onSessionMode` re-enables it by
  // redrawing, which is the difference between a button that reports the mode and one that
  // merely started a request: if the move fails, the banner still says intake and the control
  // comes back, rather than the row claiming a transition nobody made.
  button.disabled = true
  void office
    .setMode(active, next as Mode)
    .then(showPhase)
    .catch((error: unknown) => {
      button.disabled = false
      current().chat.notice(
        `Could not change mode: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
}

/**
 * The mode as an event, which is the half a field cannot do.
 *
 * Laptop 2 built both deliberately (§16.2 of the finalisation plan): the field answers *what is
 * it*, this answers *it just changed*. The control has to go from live to spent in the same
 * frame the mode moves, and a poll leaves a window where the button is still live and the mode
 * is already gone.
 */
office.onSessionMode((change) => {
  // Both halves, not just the project. See `changeIsForHere` — the project check alone let one
  // conversation's mode change repaint another's, including its floor.
  if (!changeIsForHere(change, active, activeSession)) return
  showMode(change.to)
  const announcement = modeAnnouncement(change.from, change.to)
  if (announcement !== null) say(announcement)
})

/**
 * Everything typeable after a slash.
 *
 * The office expands nothing — `--print` already resolves a command before the model sees it —
 * so choosing here only writes the name into the composer. What makes the menu worth having is
 * that an unknown command is *silent*: the CLI answers it synthetically at zero cost and says
 * nothing, so a typo produces no error and no reply.
 */
const slash = new CommandMenu(els.slash, {
  onChoose: (item) => {
    // The name, and a space when the command declares it takes arguments. `null` is not `''`:
    // it means the author never said what it takes, so we do not imply there is more to type.
    els.composer.value = item.argumentHint ? `/${item.name} ` : `/${item.name}`
    els.composer.focus()
    resize()
  },
  onDismiss: () => els.composer.focus(),
})

/**
 * What was last said about reading the commands directory.
 *
 * This function runs at boot **and on every rescan** — `.claude/` is watched, so a rescan is also
 * the signal that somebody has just written a command, which is why it re-reads. It used to say
 * every problem every time: measured with the directory unreadable, three notices at boot and
 * three more from three file touches, unbounded.
 *
 * An unreadable directory is a **condition**, and reporting a condition as a fresh event on every
 * scan fills the transcript with one fact. See `SaidOnce` — and note it is *changed*, not *once*,
 * so a directory that breaks, is fixed, and breaks again is news the second time.
 */
const commandsProblem = new SaidOnce()

async function loadCommands(): Promise<void> {
  const list = await office.commandsOf()
  slash.setItems(list.items)

  // A commands directory that exists and cannot be read is not a workspace with no commands,
  // and a menu that quietly showed a shorter list would be saying it was.
  const said = list.problems.length === 0 ? null : list.problems.map(describeProblem).join(' · ')
  if (!commandsProblem.changed(said) || said === null) return
  current().chat.notice(`Reading commands: ${said}`)
}

/** Enough of a queued message to recognise it by. */
function shorten(text: string): string {
  const line = text.split('\n')[0] ?? ''
  return truncate(line, 40)
}

/**
 * Send a message.
 *
 * `words` is supplied when the message did not come from the composer — an option clicked in
 * one of the manager's questions. It takes the same path as anything typed, deliberately: the
 * answer is rendered into the transcript, counts as a turn, and is the thing the session
 * resumes from. A click that reached the CLI without appearing in the conversation would be a
 * decision the record does not have.
 */
async function send(words?: string): Promise<void> {
  const text = (words ?? els.composer.value).trim()
  if (!text) return

  // Captured now: you may switch conversations while this turn runs, and the words belong to
  // the one you typed them into.
  const project = active
  const session = activeSession

  // Only the composer is cleared, and only when it was the composer that was sent. Clearing it
  // on a clicked answer would throw away something half-typed beside the question.
  if (words === undefined) {
    els.composer.value = ''
    resize()
  }
  tabFor(session).chat.you(text)
  // Composing is over the moment it is sent, whatever the focus does next.
  floor.apply(session, [{ kind: 'composing', composing: false }])

  // Sent while no run is going, this starts one, and this window will see all of it. See
  // `followedRuns`. `''` names no conversation, and main picks one then, so there is nothing to
  // say which run this starts. No redraw: main reports `running` next, and that redraws the campus.
  const running = session !== '' && runKnown(session, tabFor(session).busy, knownSessions)
  if (session !== '') hear(session, { kind: 'sent', running })

  try {
    // `session`, not just `project`. The words were rendered into this conversation's
    // transcript above; naming only the project would let main resolve a different one, and
    // the reply would arrive in a tab you were not looking at.
    await office.send(project, session, text)
  } catch (error) {
    tabFor(session).chat.notice(error instanceof Error ? error.message : String(error))
    // A send that was to start a run ends following. Either its run never started, and main may
    // report no phase for it, or that run is over already. One that was to be queued leaves the run
    // it was behind as it was. See `following`.
    if (session !== '' && hear(session, { kind: 'unsent', running })) renderSwitcher()
  }
  void renderSessions()
}

function resize(): void {
  els.composer.style.height = 'auto'
  els.composer.style.height = `${Math.min(els.composer.scrollHeight, 176)}px`
}

// ────────────────────────────────────────────────────────────────── the agent card ──

/**
 * Ask somebody what they are doing, over their head.
 *
 * The answer is checked against the situation it was a question about before it is shown —
 * see `shared/floor/bubbles.ts`. An aside takes a second or two and the floor does not wait,
 * so being overtaken is ordinary; showing the stale answer anyway would not be.
 */
async function askOnFloor(who: string): Promise<void> {
  const member = snapshot?.staff.find((s) => s.id === who)
  if (!member) return

  const about = floor.askOver(who)
  const answer = await office.askAbout(active, member.isManager ? null : who, null)

  if (!floor.settle(who, about, answer.text, answer.isError)) return
  lastAnswers.set(who, answer.text)
}

async function openCard(who: string): Promise<void> {
  const member = snapshot?.staff.find((s) => s.id === who)
  if (!member) return

  openAgent = who
  onlyPanel(els.card)
  els.card.hidden = false
  els.cardRole.textContent = member.isManager ? 'Manager' : 'On the floor'
  // The manager already has the pane — the conversation you are looking at *is* theirs — so
  // offering to open one would be a second way to be where you already are.
  els.cardTalk.hidden = member.isManager
  // The same character that is at their desk, at the size a portrait wants. F5's "legible as
  // *this* agent": the card and the floor stop being two pictures of a name.
  els.cardName.replaceChildren(avatar(who, 28, art), document.createTextNode(member.name || member.id))
  els.cardDesc.textContent = member.description || 'No description in the agent file.'

  // Two different claims, kept apart on purpose. This one the app knows for itself, and it
  // names the event that caused it.
  const doing = floor.reasonFor(who)
  els.cardDoing.textContent = doing.text
  // The tool call behind it, when there is one. Same evidence the work log ends with, on the
  // half of the card that describes right now rather than what already happened.
  els.cardDoingTrace.textContent = doing.trace ?? ''
  els.cardDoingTrace.hidden = doing.trace === null

  els.cardInput.value = ''
  els.cardBubble.hidden = false

  // …and this, which is neither of those: what they actually did, from their own record.
  void showWork(who)

  // …and this one comes from the session itself, on a fork, so asking never disturbs the work.
  // If the bubble on the floor already asked, show that rather than paying for it twice.
  const said = lastAnswers.get(who)
  if (said !== undefined) {
    els.cardBubble.dataset['thinking'] = 'false'
    els.cardBubble.textContent = said
    return
  }

  els.cardBubble.dataset['thinking'] = 'true'
  els.cardBubble.textContent = 'asking…'

  const answer = await office.askAbout(active, member.isManager ? null : who, null)
  if (openAgent !== who) return
  els.cardBubble.dataset['thinking'] = 'false'
  els.cardBubble.textContent = answer.text || 'No answer came back.'
  lastAnswers.set(who, answer.text)
}

async function askFollowUp(): Promise<void> {
  const question = els.cardInput.value.trim()
  if (!question || !openAgent) return

  const member = snapshot?.staff.find((s) => s.id === openAgent)
  els.cardInput.value = ''
  els.cardBubble.dataset['thinking'] = 'true'
  els.cardBubble.textContent = 'asking…'

  const asked = openAgent
  const answer = await office.askAbout(active, member?.isManager ? null : asked, question)
  if (openAgent !== asked) return
  els.cardBubble.dataset['thinking'] = 'false'
  els.cardBubble.textContent = answer.text || 'No answer came back.'
  // A follow-up is a different question, so it does not become the standing status answer.
}

/**
 * Show what an employee actually did.
 *
 * Read from their own record, not from the manager's account of it — the manager's account is a
 * report, and the office's second standing order is that reports are checked rather than
 * believed. A record that could not be read says so; it never renders as an employee who did
 * nothing, because that is a claim about somebody's work.
 */
async function showWork(who: string): Promise<void> {
  els.cardWork.hidden = true
  els.cardLog.replaceChildren()
  els.cardBrief.textContent = ''

  const work = await office.workOf(active, who)
  // Still the same card? Otherwise this belongs to somebody you already closed.
  if (openAgent !== who || !work) return

  els.cardWork.hidden = false
  els.cardWorkHead.textContent = work.problem ? 'What they did — unavailable' : 'What they did'
  els.cardBrief.textContent = work.brief ? `Brief: ${work.brief}` : ''

  renderWorkLog(els.cardLog, work)
}



// ─────────────────────────────────────────────────────────────── the activity strip ──

/**
 * One activity model per project, alongside the transcript and the scene.
 *
 * Kept per project for the same reason those are: events arrive for projects you are not
 * looking at, and coming back to a tab whose strip started empty would be the office forgetting
 * work it watched happen.
 */
const activityBySession = new Map<string, Activity>()

/**
 * One conversation's activity.
 *
 * Keyed by **session**, not by project — the same key the floor uses, because the strip and the
 * floor are supposed to be two views of one set of facts. The parameter used to be called
 * `project`, and three of the five call sites believed it: `feed` wrote under the session id and
 * `drawStrip` read under the project, so everything the event stream recorded went into a key
 * nothing looked at.
 *
 * What that looked like from outside: the Running zone never showed anybody. A turn that
 * dispatched the reviewer and the tester drew two people onto the floor and left the strip
 * reading *nobody mid-task* for its whole length.
 */
function activityFor(session: string): Activity {
  return activityBySession.get(session) ?? EMPTY_ACTIVITY
}

/**
 * Tool calls the hook has parked, across every session.
 *
 * Not per project: the approval file is workspace-wide and a call held in a project you are not
 * looking at still stops that project dead. Hiding it behind a tab switch would make the office
 * look idle while it is in fact waiting on you.
 *
 * Drawn from `held` and set only by `hold`, never from a push directly: a push still lists a call
 * this window is answering, until the gate has read the verdict. See `Held`.
 */
let approvals: readonly PendingApproval[] = []

/** What main last pushed, and what this window has done about it since. */
let held: Held = NOTHING_HELD

/** Move what is held on, and the cards drawn from it with it. Drawing is the caller's. */
function hold(next: Held): void {
  held = next
  approvals = cardsFrom(next)
}

/**
 * What the ledger says was dispatched and never came back.
 *
 * `null` until the first answer arrives, and that is not the same as an empty report — a strip
 * drawn before the question has been asked must not say there is nothing outstanding. Read from
 * disk rather than pushed, because a dispatch becomes unfinished by *nothing happening* and
 * there is no event for that.
 */
let unfinishedWork: UnfinishedReport | null = null

/** Set once the user opens it, and forced open whenever something needs an answer. */
let stripOpen = false

/**
 * Ask the ledger again.
 *
 * At boot, and after anything that could change the answer. Never on a timer: the file only
 * changes when this app writes to it, so polling would be a disk read a second for a number that
 * cannot have moved.
 */
async function refreshUnfinished(): Promise<void> {
  try {
    unfinishedWork = await office.unfinishedWork()
  } catch (error) {
    // The bridge itself failed. That is not "nothing is outstanding", and the strip is told so
    // in the same shape main would have used — the one path where silence would be a lie.
    unfinishedWork = { entries: [], torn: [], problem: error instanceof Error ? error.message : String(error) }
  }
  drawStrip()
}

/**
 * Resume, retry, or drop one dispatch that never reported back.
 *
 * None of the three sends anything on its own. `retry` composes the brief and puts it in the
 * composer for somebody to read and press send on; `resume` re-opens the conversation; `drop`
 * writes one line. The office does not spend a run because a card was clicked.
 */
async function actOnUnfinished(entry: Dispatch, verb: UnfinishedVerb): Promise<void> {
  if (verb === 'drop') {
    const outcome = await office.dropDispatch(entry.id)
    if (!outcome.ok) {
      say(`Not dropped: ${outcome.reason}`, 'failed')
      return
    }
    say(`Dropped ${entry.employee}'s unfinished task.`)
    await refreshUnfinished()
    return
  }

  if (verb === 'retry') {
    const composed = await office.retryDispatch(entry.id)
    if ('problem' in composed) {
      say(`Nothing to re-send: ${composed.problem}`, 'failed')
      return
    }
    // Into the composer, not down the wire. The re-dispatch carries the previous failure
    // verbatim and is several hundred characters of it — somebody should read that before it is
    // sent, and a click that silently spent a run would be the card acting on its own.
    els.composer.value = composed.brief
    resize()
    els.composer.focus()
    say('The re-dispatch is in the composer, with the previous failure in it. Nothing sent yet.')
    return
  }

  // Resume: back to the conversation that sent it. Reads; starts nothing.
  try {
    if (entry.project !== active) await switchTo(entry.project)
    await openSession(entry.sessionId)
    say(`Back in the conversation that dispatched ${entry.employee}.`)
  } catch (error) {
    say(`That conversation could not be re-opened: ${error instanceof Error ? error.message : String(error)}`, 'failed')
  }
}

function drawStrip(): void {
  const activity = activityFor(activeSession).state
  const needed = approvals.length > 0
  const outstanding = unfinishedShows(unfinishedWork)
  // One clock for the drawing and for the decision to draw again, so the tick that crosses a
  // held call's deadline is the one that draws the refusal.
  const nowMs = Date.now()

  // The strip opens itself for an approval and never closes itself. Auto-collapsing would take
  // the panel away from under somebody who was reading it.
  //
  // Unfinished work opens it too, and for a blunter reason: an offer to resume work that was
  // lost is worth nothing behind a collapsed panel. It does *not* turn the bar amber — that
  // colour means the office is stopped waiting on you this second, and a dispatch that died an
  // hour ago is not that. Visible, without borrowing an urgency it does not have.
  if (needed || outstanding) stripOpen = true

  els.strip.classList.toggle('strip--attention', needed)
  els.stripToggle.setAttribute('aria-expanded', String(stripOpen))
  els.stripSummary.textContent = stripLine({
    working: activity.running.length,
    logged: activity.history.length,
    waiting: approvals.length,
    unfinished: unfinishedWork?.problem ? 'unreadable' : (unfinishedWork?.entries.length ?? 0),
    open: stripOpen,
  })
  els.stripZones.hidden = !stripOpen

  // Two things on the strip change without an event: how long somebody has been mid-task, and
  // how long a held call has left. The second has to count on its own — the manager's held call
  // leaves nobody mid-task. A shut strip and an idle office still draw nothing; see `stripTicks`.
  const ticks = stripTicks({ open: stripOpen, working: activity.running.length, approvals, nowMs })
  if (ticks) startTicking()
  else stopTicking()

  if (!stripOpen) {
    // Nothing to draw while it is shut, and building it anyway is the per-event cost that makes
    // a long session slow for a panel nobody has open.
    els.stripZones.replaceChildren()
    return
  }

  renderStrip(
    els.stripZones,
    { activity, approvals, unfinished: unfinishedWork, nowMs },
    {
      art,
      onDecide: (request, allow) => void decide(request, allow),
      onOpen: (who) => void openCard(who),
      onUnfinished: (entry, verb) => void actOnUnfinished(entry, verb),
    },
  )
}


/**
 * One line naming what a decision was about.
 *
 * Falls back to the tool's own name when there is no headline argument to show — `Read` with no
 * path is still a real decision, and a blank line in the log would be worse than a vague one.
 */
function decisionLine(request: PendingApproval): string {
  const summary = summariseApproval(request)
  const detail = summary.detail.trim()
  if (detail === '') return summary.tool
  const line = detail.split('\n')[0] ?? detail
  return truncate(line, 72)
}

/**
 * Record a decision about a tool call, and do not say it happened until it has.
 *
 * The card comes off the strip first, because it is what stops a second press landing while the
 * first is in flight. **Everything else waits for the write.** It did not: the log entry was
 * written before the `await`, and `office.decide` can reject — `approvals.ts` throws on an id
 * containing a slash and on a request addressed to another workspace.
 *
 * So the failure was: the card disappears, the log reads *"you allowed: rm -rf …"*, nothing is
 * written to disk, and four minutes later the gate times out and **denies** the call. The record
 * says you allowed something that was refused, on the one surface in this app whose whole job is
 * being the receipt. That is the third standing order broken as hard as it can be broken, and it
 * was invisible because a rejected `invoke` had nowhere to go — see `mishaps.ts`.
 *
 * Found by `office-space-6c`, which named `decide` as the worst place in the app for an
 * unhandled rejection before either of us had read this function.
 *
 * The card stays off after the press, too. Main keeps listing the call until the gate has read the
 * verdict, and a failed write is not a reason for it to push again: it pushes when the set of held
 * calls changes. So which cards are up is `afterPress` and `afterDecision`'s to say, not a list
 * saved here before the `await`. See `Held` for what that assumes about the order of main's pushes.
 */
async function decide(request: PendingApproval, allow: boolean): Promise<void> {
  // Off the strip immediately, so a second press cannot land on a decision already in flight.
  hold(afterPress(held, request))

  /*
   * And settled whatever happens next. A press that never settles leaves its key in `writing`,
   * and that card stays down for good. So a throw on the way, from drawing the strip or naming the
   * call, settles it as not written: the card comes back while main still lists the call.
   */
  let outcome: Decision | undefined
  try {
    drawStrip()

    let failure: string | null = null
    try {
      await office.decide(request.sessionId, request.toolUseId, allow)
    } catch (error: unknown) {
      failure = unwrap(error).message
    }

    // `decided` holds the rule that ordering used to hold: no note unless the write succeeded.
    outcome = decided({ tool: request.tool, line: decisionLine(request), allow, failure })
  } finally {
    hold(afterDecision(held, request, outcome ?? { restore: true }))
  }

  if (outcome.note !== null) {
    // The conversation the call came from, which the request carries. Writing it under `active`
    // put it on a project key nothing reads.
    activityBySession.set(
      request.sessionId,
      applyNote(activityFor(request.sessionId), {
        kind: allow ? 'note' : 'refused',
        who: 'you',
        text: outcome.note,
        // Stamped after the write, so the time in the log is when the decision was recorded
        // rather than when the button was pressed. They differ by a disk write, and only one of
        // them is a moment anything actually happened.
        at: new Date().toISOString(),
      }),
    )
  }

  say(outcome.said, outcome.tone)
  drawStrip()
  /*
   * The campus last, after the receipt.
   *
   * Answering a call clears its mark and `drawStrip` does not reach `setCampus`, so without this
   * a card kept its outline for a decision already made. Placed here rather than beside the
   * `approvals` write above it: if `renderSwitcher` ever throws, `decide` rejects, and everything
   * after the throw is skipped — which up there would have meant losing the activity note and
   * `say`, the receipt this function's own doc comment exists to protect.
   *
   * `approvals` is in its final state either way: this function moves it only through `hold`, at
   * the press and when the decision settled, both long since done.
   */
  renderSwitcher()
}

/**
 * Re-render once a second, and only while something on the strip moves without an event — the
 * ages of work in flight, or a held call's clock. `stripTicks` decides which.
 *
 * `setInterval` rather than a frame loop: this changes at 1 Hz, and the office's own idle budget
 * is measured in frames it does *not* draw. A `requestAnimationFrame` here would spend sixty
 * frames a second to move one digit.
 */
let ticker: number | null = null

function startTicking(): void {
  if (ticker !== null) return
  ticker = window.setInterval(() => {
    if (!els.stripZones.hidden) drawStrip()
  }, 1000)
}

function stopTicking(): void {
  if (ticker === null) return
  window.clearInterval(ticker)
  ticker = null
}


// ────────────────────────────────────────────────────────────────── the roster ──

/**
 * Who works here, and what they know.
 *
 * Every write here goes through main and then re-reads. Nothing in this file keeps a list of
 * staff — `hire` and `fire` return only whether they worked, and the next `describe()` is what
 * says who exists. That is the same rule `roster.ts` follows on the other side of the wire: the
 * filesystem is the roster, and anything holding a second copy of it eventually draws a desk
 * for somebody who is not there.
 */
async function showRoster(): Promise<void> {
  onlyPanel(els.rosterPanel)
  els.rosterPanel.hidden = false
  await paintRoster(true)
}

/**
 * Keep an open roster current, and only an open one.
 *
 * This panel's own header says the filesystem is the roster, and that *"anything holding a second
 * copy of it eventually draws a desk for somebody who is not there"*. A panel painted once when it
 * opened is that second copy. Measured, roster open throughout: write a new agent file and the
 * floor's status bar goes from *"7 on the floor"* to *"8 on the floor"* while the roster beside it
 * still lists seven. Both are on screen at once, so the office contradicts itself in a single
 * glance — and the stale list is the one carrying `Send home` and `Fire`.
 *
 * Called from `render` only when the staff or the shelf actually changed, rather than on every
 * snapshot: painting costs three IPC round-trips and two disk reads, and a snapshot arrives every
 * time anything in the workspace moves.
 *
 * Silent, unlike `showRoster`. The reading notice belongs to an empty panel somebody just opened;
 * flashing it over a list already on screen would be a panel that appears to reload itself
 * whenever a file changes anywhere.
 */
function refreshRoster(): void {
  if (els.rosterPanel.hidden) return
  void paintRoster(false)
}

async function paintRoster(announce: boolean): Promise<void> {
  els.rosterRoot.textContent = snapshot ? `${snapshot.root}/.claude` : ''
  // Two disk reads happen below. On a slow disk — or a large workspace — the panel would
  // otherwise open as an empty box, which is indistinguishable from an office with nobody in
  // it. Saying which it is costs one line.
  if (announce) loading(els.rosterBody, 'Reading the roster and the shelf…')

  // Three reads that can fail independently, so they are settled independently. A shelf that
  // could not be read must not take the staff list down with it — the panel would then show
  // nothing at all and imply the office is empty.
  const [benchList, shelfRows, survey] = await Promise.all([
    office.benched().catch(() => [] as readonly string[]),
    office.shelf(active).then(
      (rows) => rows,
      () => null,
    ),
    // The capability survey — 475 tested lines that had a caller in main and none in the
    // renderer, which is the exact fault the completion plan opened with about this module.
    // Wiring it into `privacyOf` gave the *servers* a home and left the per-agent half orphaned
    // a second time; found by auditing for IPC methods nothing calls.
    office.capabilitiesOf().then(
      (report) => report,
      () => null,
    ),
  ])

  // A config file the survey could not read is not a workspace with no MCP servers.
  //
  // `capabilities.ts` takes real care over exactly this distinction — its own tests insist that
  // a `.mcp.json` which exists and will not open is reported as unreadable and *never* as zero
  // servers, and that every place looked is named so an empty answer can show its work. All of
  // that stopped at the IPC boundary: `CapabilityReport.problems` crossed the bridge and no
  // surface read it. `Workspace.problems` says in its own comment that a non-empty list "must
  // be surfaced in the UI"; this is the half of that contract the survey never got.
  //
  // In the panel rather than the transcript, because the roster reopens often and a chat notice
  // per open would bury the conversation in a fact that has not changed.
  const surveyProblems = (survey?.problems ?? []).map(describeProblem)
  els.rosterProblem.hidden = surveyProblems.length === 0
  els.rosterProblem.textContent = surveyProblems.length
    ? `Could not read everything the staff can reach: ${surveyProblems.join('; ')}`
    : ''

  renderRoster(
    els.rosterBody,
    {
      staff: snapshot?.staff ?? [],
      // The same predicate the composer and the mode banner use, so the three cannot disagree
      // about whether the staff were readable — see `nobodyListening`.
      staffUnreadable: unreadableUnder(snapshot?.problems ?? [], '.claude/agents'),
      benched: benchList,
      shelf: shelfRows,
      // Already on the snapshot and, until now, counted and discarded. The shelf joins it by id
      // so a row can say what the skill does instead of only how often it was reached for.
      skills: snapshot?.skills ?? [],
      dangling: new Map((survey?.staff ?? []).map((m) => [m.id, m.danglingMcpTools])),
      unreachable: new Map((survey?.staff ?? []).map((m) => [m.id, m.unreachableTools])),
    },
    {
      art,
      onHire: () => openForm('hire'),
      onAddSkill: () => openForm('skill'),
      // Not `${id}.md`: firing somebody on the bench removes `${id}.md.off`, and `RosterOutcome`
      // deliberately does not carry the path back — the renderer is not given file paths from
      // main. Naming the directory is true either way; naming the wrong file would be a small
      // lie told at the exact moment somebody may need to go and find it in git.
      onFire: (id) => void rosterWrite(() => office.fireAgent(id), `${id} was let go — their file in .claude/agents is gone.`),
      onBench: (id) => void rosterWrite(() => office.disableAgent(id), `${id} went home — their file is now ${id}.md.off.`),
      onUnbench: (id) => void rosterWrite(() => office.enableAgent(id), `${id} is back at their desk.`),
      onRemoveSkill: (id) => void rosterWrite(() => office.removeSkill(id), `${id} came off the shelf.`),
    },
  )
}

/**
 * Do one roster write, then redraw from what the office says afterwards.
 *
 * A refusal is shown and the panel stays open. `hire()` refuses for reasons a person can act
 * on — the name is taken, the name is not a filename — and closing the form on a refusal would
 * throw away what they typed along with the explanation.
 */
async function rosterWrite(
  run: () => Promise<{ ok: boolean; reason?: string; office?: OfficeSnapshot }>,
  done: string,
): Promise<boolean> {
  const outcome = await run()
  if (!outcome.ok) {
    const reason = outcome.reason ?? 'That did not work, and the office did not say why.'
    els.rosterProblem.hidden = false
    els.rosterProblem.textContent = reason
    say(reason, 'failed')
    return false
  }
  say(done)

  /*
   * Redraw from what the write answered with, not from what happened to arrive.
   *
   * `rosterOp` rescans before it replies and now hands the result back, so this is the office
   * *after* this write by construction. Reading the module-level `snapshot` here instead drew
   * the staff list as it was **before** the write beside a bench list read fresh from disk —
   * one person at a desk and on the bench, and it stayed until something else redrew the panel.
   *
   * The first attempt at this waited for the next `office` broadcast. It did not work, and the
   * reason is worth keeping: eight places send that message and most build it from a `workspace`
   * the rescan has not replaced, so a cost update landing while the write was in flight
   * satisfied the wait with exactly the stale snapshot the wait existed to avoid — and the
   * protection was weakest when the office was busiest, which is its normal state. There is
   * nothing to wait for. The answer is in the reply.
   *
   * What remains, named because somebody will see it before they read this: one of those seven
   * other broadcasts can still be in flight and land *after* this, moving the module `snapshot`
   * backwards for as long as it takes the watcher's 200ms debounce to rescan. The roster panel
   * is unaffected — `showRoster()` has already drawn from the reply — but the floor can show
   * pre-write staff for that moment. It corrects itself, which is the difference between it and
   * what this replaced, and it is a flicker rather than a state the office sits in.
   */
  if (outcome.office) await render(outcome.office)
  await showRoster()
  return true
}

/**
 * The clause the confirmation of a hire carries when that hire crosses the drawing limit.
 *
 * Said at the hire and nowhere else, because this is the only moment it is actionable: the
 * office is about to get one desk bigger and the reader is the person choosing to make it so.
 *
 * Once, not every time. `STAFF_AT_FULL_SCALE` is the last roster the floor draws at 2x — the
 * scale is a whole number, so the room does not taper as the company grows, it steps down all at
 * once when a new row of desks opens. That makes the thirteenth hire the only one worth
 * mentioning; saying it again at the fourteenth would be reporting a change that already
 * happened. The count is taken *before* this hire lands, so `=== STAFF_AT_FULL_SCALE` is the
 * one about to cross.
 */
function crowding(): string {
  if ((snapshot?.staff.length ?? 0) !== STAFF_AT_FULL_SCALE) return ''
  return (
    ` That is more than ${STAFF_AT_FULL_SCALE} on the floor, so the office needs another row of` +
    ' desks and will be drawn smaller from here — everything still works, there is just more of it.'
  )
}

/** Swap the list for a form. One panel, two modes — a second modal over a modal is worse. */
function openForm(kind: 'hire' | 'skill'): void {
  els.rosterProblem.hidden = true
  const back = () => void showRoster()

  els.rosterBody.replaceChildren(
    kind === 'hire'
      ? hireForm({
          onCancel: back,
          onSubmit: (draft) =>
            void rosterWrite(
              () => office.hire(draft),
              `${draft.id} was hired — .claude/agents/${draft.id}.md is written, and there is a desk for them.${crowding()}`,
            ),
        })
      : skillForm({
          onCancel: back,
          onSubmit: (draft) => void rosterWrite(() => office.addSkill(draft), `${draft.id} is on the shelf — .claude/skills/${draft.id}/SKILL.md is written.`),
        }),
  )
  els.rosterBody.querySelector('input')?.focus()
}

function closeRoster(): void {
  els.rosterPanel.hidden = true
}


// ────────────────────────────────────────────────────────────── what just happened ──

/**
 * Fill a panel with a line saying it is working.
 *
 * Every panel in this app opens on a disk read, and until now each opened as an empty box while
 * it waited. An empty roster and a roster that has not arrived look identical, which is the
 * fourth standing order in the place a person is most likely to draw the wrong conclusion —
 * they are looking at the panel *because* they want to know what is there.
 *
 * Text rather than a spinner, deliberately: a spinner says "wait" and this says what is being
 * waited for, which is the difference between a slow panel and a broken one.
 */
function loading(host: HTMLElement, what: string): void {
  const line = document.createElement('p')
  line.className = 'loading'
  line.textContent = what
  host.replaceChildren(line)
}

/**
 * Say that something worked.
 *
 * Hiring somebody, writing a skill, taking one off the shelf and deleting a store all succeeded
 * in silence: the panel redrew and nothing told you the write had landed. Inferring it from a
 * list that is one row shorter is not the same as being told, and it is a poor answer to a
 * button whose label was "Delete their file".
 *
 * A live region, so a screen reader announces it rather than leaving it to be noticed. Cleared
 * on a timer rather than left standing, because a message about something that happened four
 * minutes ago reads as a message about something that just happened.
 *
 * No animation, per instruction — it appears and it goes.
 */
let sayTimer: number | null = null

function say(text: string, tone: 'done' | 'failed' = 'done'): void {
  els.said.textContent = text
  els.said.dataset['tone'] = tone
  // `data-shown`, not `hidden`. The element is an `aria-live` region and must stay in the
  // accessibility tree whether or not it is on screen — see the note on `.said` in panels.css.
  // Setting text into a `hidden` region announces nothing, which is what this used to do.
  els.said.dataset['shown'] = 'true'

  if (sayTimer !== null) window.clearTimeout(sayTimer)
  // A failure stays longer. It is the one somebody may want to re-read, and it is the one that
  // may need copying into a message to somebody else.
  sayTimer = window.setTimeout(() => {
    els.said.dataset['shown'] = 'false'
    // Cleared as well as faded, so the next announcement is a change rather than a repeat — a
    // live region asked to say the same string twice says it once.
    els.said.textContent = ''
    sayTimer = null
  }, tone === 'failed' ? 9000 : 4000)
}


// ───────────────────────────────────────────────────────────────────── first run ──

/**
 * What is wrong, or merely not started yet, derived from the snapshot we already have.
 *
 * No new IPC and no second scan: every fact the diagnosis needs is already in `problems`, under
 * a named rule. `no-claude-on-path` and `workspace-not-trusted` are put there by main with those
 * exact strings, and `unreadable-dir` carries its own path. Re-asking the main process for
 * things it has already told us is how two answers to one question start disagreeing.
 */
function firstRunState(): FirstRunState {
  // The window's own faults with the workspace's, so the panel the amber tone points at can
  // actually say what turned it amber. Without this the status bar went to `warn` on a fault
  // that happened twice and the only surface it leads to said nothing was wrong — a colour with
  // no words, which is a signal a reader cannot act on and half of standing order 3.
  //
  // `seenTwice` entries are `lint` with a rule of their own, so the filter below drops them into
  // `problems` — the field that exists for "everything the office reported that the diagnosis
  // does not already have a proper step for", which is exactly what they are.
  const problems = [...(snapshot?.problems ?? []), ...seenTwice]
  const rule = (name: string) =>
    problems.find((p) => p.kind === 'lint' && p.rule === name) as
      | { path: string; detail: string }
      | undefined

  const noClaude = rule('no-claude-on-path')
  // The bundle main actually found the flag on, rather than the /Applications path the install
  // card assumes — so the command the panel offers is the one that will work here.
  const quarantined = rule('app-quarantined')

  return {
    claudePath: noClaude ? null : (snapshot ? 'found' : null),
    claudeProblem: noClaude?.detail ?? null,
    staffCount: snapshot?.staff.length ?? 0,
    // The office itself is always a tab and is not a project directory, so it does not count as
    // having started anything.
    projectCount: (snapshot?.projects ?? []).filter((p) => p.id !== OFFICE_PROJECT).length,
    canCreateProject: snapshot?.canCreateProject ?? false,
    // `false` when there is no snapshot, so a panel drawn before the first describe offers
    // nothing rather than a button whose precondition is unknown.
    canAddTemplate: snapshot?.canAddTemplate ?? false,
    // `present` before the first snapshot, so a panel drawn early does not announce a missing
    // instruction file for a workspace nothing has looked at yet.
    instructions: snapshot?.instructions ?? 'present',
    // `wired` before the first snapshot, for the same reason: a panel drawn before anything was
    // checked must not announce that commands are unapproved.
    gate: snapshot?.gate ?? { state: 'wired' },
    permissionsInForce: rule('workspace-not-trusted') === undefined,
    quarantinedApp: quarantined?.path ?? null,
    unreadable: problems
      .filter((p) => p.kind === 'unreadable-dir' || p.kind === 'unreadable-file')
      .map((p) => (p as { path: string }).path),
    // Everything the office reported that the diagnosis does not already have a proper step for.
    // Four rules are turned into steps with a next action above; anything else would otherwise
    // have no home now the banner along the bottom of the floor is gone.
    problems: problems
      .filter(
        (p) =>
          p.kind !== 'unreadable-dir' &&
          p.kind !== 'unreadable-file' &&
          !(
            p.kind === 'lint' &&
            (p.rule === 'no-claude-on-path' ||
              p.rule === 'workspace-not-trusted' ||
              // Already a step of its own, with the command on it. Left in here it would say
              // the same thing twice in one panel, once without the fix.
              p.rule === 'app-quarantined')
          ),
      )
      .map(describeProblem),
  }
}

/** True once the panel has been dismissed, so a rescan does not put it back on top of somebody. */
let firstRunDismissed = false

/**
 * Add the project template, then re-read rather than assume it worked.
 *
 * `describe()` is what the panel is drawn from, and `canCreateProject` is computed in main from
 * the directory actually being there. Flipping a flag here on the strength of an `ok` would be
 * the panel deciding it succeeded, which is the one thing this app's whole design refuses.
 */
async function addTemplate(): Promise<void> {
  const got = await office.addProjectTemplate().catch(() => null)
  if (got === null || !got.ok) {
    say(got?.reason ?? 'The office could not add the project template.', 'failed')
    return
  }
  say('The project template is in place. You can start a project now.')
  // The same idiom the recheck button uses. `describe()` rescans the workspace — which is
  // exactly what changed — and the panel is redrawn from what it finds rather than from the
  // fact that a copy did not throw.
  await office.describe().then(render)
  showFirstRun(true)
}

function showFirstRun(force = false): void {
  const steps = diagnose(firstRunState())

  // Whether to be on screen is `firstRunVerdict`'s call, in `shared/first-run.ts`, because this
  // function cannot be loaded by a test and the decision was wrong here for exactly that long.
  //
  // `force` is the palette's route in. "What this workspace still needs" is in the static action
  // list, so it is offered on every open and matched by `setup`, `help` and `broken` — and on a
  // healthy workspace it used to land here and return without drawing anything.
  const verdict = firstRunVerdict({ steps, force, dismissed: firstRunDismissed })
  if (verdict === 'shut') {
    els.firstRunPanel.hidden = true
    return
  }
  if (verdict === 'leave') return

  onlyPanel(els.firstRunPanel)
  els.firstRunPanel.hidden = false
  paintFirstRun(steps)
}

/**
 * Fill the panel from a diagnosis. Says nothing about whether it should be open.
 *
 * Split out so an open panel can be repainted without going near `firstRunVerdict`, which owns
 * that decision and is the only thing entitled to make it.
 */
function paintFirstRun(steps: ReturnType<typeof diagnose>): void {
  els.firstRunHead.textContent = isBlocked(steps)
    ? 'The office cannot work yet'
    : steps.length === 0
      ? 'This workspace is ready'
      : 'A few things about this workspace'

  renderFirstRun(els.firstRunBody, steps, {
    onAction: (id) => {
      els.firstRunPanel.hidden = true
      runAction(id)
    },
    // `recheck`, not `describe`. The reason somebody presses this is that they have just gone
    // and installed `claude`, or run it once and accepted the trust prompt — and neither of
    // those is re-read by a workspace rescan. Wired to `describe()` this button reported no
    // change while they watched it change, which is worse than not offering it.
    onRecheck: () => void office.recheck().then(render).then(() => showFirstRun(true)),
  })
}

/**
 * Keep an open panel current, and only an open one.
 *
 * The badge beside it is rebuilt on every render from the same diagnosis this reads. The panel
 * body was not: it was painted when the panel opened and then left, so a problem arriving while
 * somebody had it open moved the count and not the list.
 *
 * Measured, panel open throughout: make an agent file unreadable and the badge goes from "1 thing
 * to know" to "2 things to know" while the panel underneath still lists the same two items. The
 * office states a number it cannot account for, and the reader has nowhere to go to find the
 * second thing — which is the third standing order failing on the surface whose entire job is
 * telling somebody what is wrong.
 *
 * Deliberately does **not** open a closed panel. Whether to be on screen is `firstRunVerdict`'s
 * call; this only refuses to let an open one go stale.
 */
function refreshFirstRun(): void {
  if (els.firstRunPanel.hidden) return
  paintFirstRun(diagnose(firstRunState()))
}

function closeFirstRun(): void {
  firstRunDismissed = true
  els.firstRunPanel.hidden = true
}


// ───────────────────────────────────────────────── settings, and the command palette ──

function showSettings(): void {
  onlyPanel(els.settingsPanel)
  els.settingsPanel.hidden = false
  renderSettings(els.settingsBody, {
    // The floor parks when nothing is happening, so a palette change on an idle office would
    // sit unpainted until the next event. Density and side change the stage's size, which the
    // ResizeObserver already catches — but the palette does not, and this is what it is for.
    onChange: () => floor.repaint(),
    // The office's own state, not localStorage's. `setVoice` already owns the whole transition —
    // the director, the aria state and the write to main — so this hands it the decision rather
    // than reimplementing any of it.
    readAloud: () => voiceOn,
    setReadAloud: (on) => setVoice(on),
    canReadAloud: canSpeak,
  })
}

function closeSettings(): void {
  els.settingsPanel.hidden = true
}

/**
 * Everything the app can do, for the palette.
 *
 * Rebuilt on each open rather than declared once, because two of these depend on state: the
 * campus toggle says which way it will go, and "close everything" is only worth offering when
 * something is open. A stale label in a palette is a small lie, and it is the kind that makes
 * somebody stop trusting the list.
 */
function appActions(): readonly Action[] {
  // The same list Escape asks, for the same reason: this was a third hard-coded copy, and three
  // lists that must agree is worse than two. It already disagreed — the music panel was missing
  // from it, so "close everything" did not offer itself when the only open thing was the music.
  const open = escapables().filter((panel) => !panel.hidden).length

  const actions: Action[] = [
    { id: 'roster', label: 'Open the roster — who works here', group: 'Office', also: ['staff', 'agents', 'hire', 'fire'] },
    { id: 'hire', label: 'Hire somebody', group: 'Office', also: ['agent', 'new', 'add'] },
    { id: 'skill', label: 'Write a skill', group: 'Office', also: ['shelf', 'add'] },
    { id: 'privacy', label: 'What leaves this machine, and what is kept', group: 'Office', also: ['privacy', 'data', 'delete', 'prompt'] },
    // Registered rather than given a shortcut, which is what makes "every shipped capability is
    // reachable with the keyboard" true by construction instead of by an audit somebody repeats.
    {
      id: 'memory',
      label: 'What the office remembers',
      group: 'Office',
      also: ['memory', 'notes', 'decisions', 'facts', 'recall', 'know'],
    },
    {
      // Named for the question rather than the store. "Approvals log" is a filename; this is what
      // somebody actually types when they sit down after being away, which is the whole occasion
      // the record exists for.
      id: 'decided',
      label: 'What the office did while you were out',
      group: 'Office',
      also: ['approved', 'approvals', 'declined', 'overnight', 'away', 'while I was out', 'permission'],
    },
    {
      id: 'search',
      label: 'Find anything in this workspace',
      group: 'Office',
      also: ['search', 'find', 'grep', 'look for', 'where', 'recall', 'lookup'],
    },
    {
      id: 'changed',
      label: 'What the office changed',
      group: 'Office',
      also: ['changed', 'changes', 'diff', 'edits', 'files', 'wrote', 'did'],
    },
    {
      id: 'plan',
      label: 'How full the plan is, and when it resets',
      group: 'Office',
      also: ['plan', 'allowance', 'limit', 'quota', 'usage', 'cost', 'spend', 'budget', 'rate'],
    },
    {
      id: 'hooks',
      label: 'What runs on a hook, and whether it is there to run',
      group: 'Office',
      also: ['hooks', 'gate', 'approval', 'pretooluse', 'fires', 'trigger', 'blocked'],
    },
    {
      id: 'connect',
      label: 'Services the office can reach',
      group: 'Office',
      also: ['connect', 'connector', 'mcp', 'slack', 'integration', 'service', 'server'],
    },
    {
      id: 'maintained',
      label: 'Employees somebody else maintains',
      group: 'Office',
      also: ['hire', 'shared', 'repo', 'colleague', 'upstream', 'update', 'agents'],
    },
    // Laptop 1's review: the controller had one door and it was the sofa. A pill in the status
    // bar fixed discoverability by mouse and left it with **no keyboard route at all**, which
    // F10 made a promise rather than a nicety.
    { id: 'music', label: 'Music — what is playing, and the Spotify controller', group: 'View', also: ['spotify', 'play', 'pause', 'song', 'track'] },
    { id: 'settings', label: 'Settings — theme, density, layout, text size', group: 'View', keys: '⌘,', also: ['preferences', 'appearance'] },
    { id: 'switch', label: 'Switch project or conversation', group: 'Session', keys: '⌘L', also: ['go to', 'where', 'project', 'session', 'jump'] },
    { id: 'first-run', label: 'What this workspace still needs', group: 'Office', also: ['start', 'setup', 'help', 'broken'] },
    { id: 'tasks', label: 'Open the task list for this project', group: 'Project', also: ['verify', 'harness', 'checks'] },
    { id: 'verify', label: 'Check everything the workspace allows', group: 'Project', also: ['run', 'tests'] },
    { id: 'new-project', label: 'Start a new project', group: 'Project', also: ['create'] },
    {
      id: 'campus',
      label: floor.isCampus ? 'Back into this office' : 'Zoom out to the campus — every project at once',
      group: 'View',
      also: ['projects', 'offices', 'zoom'],
    },
    { id: 'strip', label: stripOpen ? 'Hide the activity strip' : 'Show the activity strip', group: 'View', also: ['running', 'approvals', 'log'] },
    { id: 'compose', label: 'Write a message to the manager', group: 'Session', keys: 'Esc', also: ['chat', 'type', 'ask'] },
    { id: 'stop', label: 'Stop what the office is doing', group: 'Session', also: ['interrupt', 'cancel'] },
  ]

  // The way back, for the mode whose banner is hidden.
  //
  // `building` deliberately shows no banner — a permanent bar saying "nothing is withheld" is
  // chrome that earns nothing — which left `Back to planning` declared in `mode-view.ts` and
  // reachable from nowhere. That is the shape of bug this repository keeps finding, and finding
  // it in my own change an hour after writing it is not a reason to leave it there.
  const back = modeChrome(currentMode)
  if (back.previous !== null && back.back !== null) {
    actions.push({ id: 'mode-back', label: back.back, group: 'Session', also: ['mode', 'undo', 'planning', 'intake'] })
  }

  if (open > 0) actions.push({ id: 'close', label: 'Close every open panel', group: 'View', keys: 'Esc' })

  /**
   * Every project and every conversation, by name.
   *
   * The thesis of this app is that nobody can *"run several projects properly at once"*, and
   * until now the only way to reach one was to open the switcher and read a flat list. Measured
   * on a workspace with 620 projects: 620 rows, no filter, and ⌘K could not reach a project at
   * all — it offered *"Switch project or conversation"*, which opens the list you were going to
   * have to read anyway.
   *
   * So the palette reaches them directly. It already has the machinery this needs and nothing
   * else does: subsequence matching, so `pmt` finds "payment page"; grouping; a keyboard; and an
   * empty state that quotes what you typed.
   *
   * Declared **after** the fixed actions, which is load-bearing rather than tidy: the palette
   * caps what it draws, the cap keeps the first N, and a fixed command being pushed off the list
   * by the four hundredth project would be a capability becoming unreachable as a workspace grows.
   *
   * The id carries the target rather than an index, because an index into a list that is rebuilt
   * on every open is a reference to whatever happens to be in that slot next time.
   */
  for (const project of snapshot?.projects ?? []) {
    actions.push({
      id: `go:${project.id}`,
      label: `Go to ${project.name}`,
      group: 'Project',
      // The id as well as the name: a directory called `auth-refresh` shows as "auth refresh",
      // and somebody who knows it from the filesystem types the hyphen.
      also: [project.id, 'switch', 'jump', 'open'],
    })
  }

  for (const session of knownSessions) {
    actions.push({
      id: `open:${session.id}`,
      // The title is the first thing you said in it, and its absence is a fact rather than a
      // gap — the same words the switcher uses, so one conversation is not two names.
      label: `Open “${session.title ?? 'Nothing said yet'}”`,
      group: 'Session',
      also: [session.agent, 'conversation', 'chat', 'resume'],
    })
  }

  return actions
}

const palette = new AppPalette(els.appPalette, els.appPaletteInput, els.appPaletteList, {
  actions: appActions,
  run: (id) => runAction(id),
})

function runAction(id: string): void {
  // The two that carry a target. Prefix rather than a lookup table, because the table would be a
  // second list of projects to keep in step with the first.
  if (id.startsWith('go:')) {
    void switchTo(id.slice('go:'.length))
    return
  }
  if (id.startsWith('open:')) {
    void openSession(id.slice('open:'.length))
    return
  }

  switch (id) {
    case 'roster':
      void showRoster()
      return
    case 'hire':
      void showRoster().then(() => openForm('hire'))
      return
    case 'skill':
      void showRoster().then(() => openForm('skill'))
      return
    case 'connect':
      void showConnectors()
      return
    case 'maintained':
      void showMaintained()
      return
    case 'memory':
      void showMemory()
      return
    case 'decided':
      void showDecided()
      return
    case 'search':
      showSearch()
      return
    case 'changed':
      void showChanged()
      return
    case 'hooks':
      void showHooks()
      return
    case 'plan':
      void showPlan()
      return
    case 'privacy':
      void showPrivacy()
      return
    case 'music':
      openMusic()
      return
    case 'settings':
      showSettings()
      return
    case 'switch':
      els.switcher.click()
      return
    case 'first-run':
      showFirstRun(true)
      return
    case 'mode-back': {
      const previous = modeChrome(currentMode).previous
      if (previous !== null) {
        void office.setMode(active, previous).then(showPhase).catch((error: unknown) => {
          current().chat.notice(
            `Could not change mode: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
      }
      return
    }
    case 'tasks':
      void showTasks()
      return
    case 'verify':
      void runAll()
      return
    case 'add-template':
      void addTemplate()
      return
    case 'new-project':
      // The switcher owns naming a project, so this opens the same control rather than
      // inventing a second way to do it. It has to go through the switcher's own entry point to
      // manage that: reaching into the closed list for `.swrow--add` and clicking it did nothing
      // at all — that element is a `div`, the handler is on a button inside it, and the field
      // would have opened inside a hidden list even so.
      switcher.startNewProject()
      return
    case 'campus':
      showCampus(!floor.isCampus)
      return
    case 'strip':
      stripOpen = !stripOpen
      drawStrip()
      return
    case 'compose':
      els.composer.focus()
      return
    case 'stop':
      void stop()
      return
    case 'close':
      closeEverything()
      return
  }
}

/** Stop the current turn, and say which queued messages died with it. */
async function stop(): Promise<void> {
  const dropped = await office.interrupt(active, activeSession)
  // Never silently. The user typed these and the office accepted them; which ones never ran is
  // exactly the thing they cannot work out for themselves.
  if (dropped.length > 0) {
    current().chat.notice(
      `Stopped. ${dropped.length} queued message${dropped.length === 1 ? '' : 's'} did not run: ` +
        dropped.map((d) => `"${shorten(d)}"`).join(', '),
    )
  }
}

/** One surface a person can open over the office. */
interface Panel {
  /** The element whose `hidden` says whether it is open. */
  readonly el: HTMLElement
  /**
   * What closing it means.
   *
   * Not `el.hidden = true`. Several of these do more and the extra is not optional: the card
   * drops the agent it was showing and empties its log, the music restores the focus it took,
   * the maintained panel clears the list it rendered, the first-run panel records that it was
   * dismissed, and the switcher is a component that closes itself. A list of elements cannot
   * express any of that, which is why the two lists were separate in the first place — and why
   * merging them means carrying the closer, not dropping it.
   */
  readonly close: () => void
  /**
   * Whether it covers the office.
   *
   * A covering panel is modal: the scrim goes behind it, the shell goes `inert`, and it takes
   * the floor from whatever else was open. The music strip and the switcher list are neither —
   * they sit in the chrome and the app behind them stays live.
   */
  readonly covering: boolean
}

/**
 * Every panel, once.
 *
 * **There were three lists, and the comment here claimed there was one.** Escape asked
 * `escapables()` whether anything was open and then called `closeEverything()`, which closed a
 * different set; `coveringPanels()` decided the scrim and the `inert` shell and was a third.
 * Adding a surface to some but not all of them fails silently and differently each way, and the
 * repository has paid for it twice: the music panel opened and Escape did nothing, and the hooks
 * panel was seen as open by Escape and then not closed by it. Both times the obvious fix was to
 * add the panel to the one array that was wrong, which leaves the next one to find the same way.
 *
 * So the three are now views of this. `escapables` is every `el`, `coveringPanels` is the
 * covering ones, and `closeEverything` calls every `close` — none of them can name a panel the
 * others do not, because none of them has a list of its own to be wrong.
 *
 * The order is the order they are closed in, which is the only one where order could matter.
 *
 * A function rather than a constant so `els` is read at call time, as the array it replaces was.
 */
function panels(): readonly Panel[] {
  return [
    { el: els.musicPanel, close: closeMusic, covering: false },
    { el: els.card, close: closeCard, covering: true },
    { el: els.taskPanel, close: closeTasks, covering: true },
    { el: els.rosterPanel, close: closeRoster, covering: true },
    { el: els.privacyPanel, close: closePrivacy, covering: true },
    { el: els.memoryPanel, close: closeMemory, covering: true },
    { el: els.decidedPanel, close: closeDecided, covering: true },
    /*
     * Not part of merging the lists — a panel that was in none of the three.
     *
     * `changed-panel` shipped on `dev` as a `role="dialog" aria-modal="true"` card with its own
     * opener, its own closer and an × button, and it was named by `escapables()`,
     * `coveringPanels()` and `closeEverything()` **nowhere**. Measured in the running app rather
     * than reasoned about: Escape did not close it, the shell did not go `inert` behind it, and
     * once open it stayed open *underneath* the next four panels, because `onlyPanel` only hides
     * what `coveringPanels()` lists.
     *
     * Reading the Escape handler, there is a worse consequence this harness could not reproduce:
     * with only this panel open, `escapables().some(...)` is false, so Escape falls through to
     * `if (running) stop()`. Nothing was running in the harness, so that path was **not**
     * observed — it is read from the code and stated as such.
     *
     * None of the three existing tests could see it, and for one reason: each iterates a list
     * this panel was absent from, so absence was invisible to all of them. That is what the
     * markup-to-table join in `one-panel-list.test.ts` exists for, and it is what found this.
     */
    { el: els.searchPanel, close: closeSearch, covering: true },
    { el: els.changedPanel, close: closeChanged, covering: true },
    { el: els.hooksPanel, close: closeHooks, covering: true },
    { el: els.planPanel, close: closePlan, covering: true },
    { el: els.maintainedPanel, close: closeMaintained, covering: true },
    { el: els.connectPanel, close: closeConnectors, covering: true },
    { el: els.settingsPanel, close: closeSettings, covering: true },
    { el: els.firstRunPanel, close: closeFirstRun, covering: true },
    { el: els.switcherList, close: closeSwitcher, covering: false },
  ]
}

/** Everything Escape is expected to get you out of. */
function escapables(): readonly HTMLElement[] {
  return panels().map((panel) => panel.el)
}

/** The panels that cover the app. The music is not one — it sits under the floor. */
function coveringPanels(): readonly HTMLElement[] {
  return panels().filter((panel) => panel.covering).map((panel) => panel.el)
}

/**
 * Every other panel down.
 *
 * The panels are modal cards in the middle of the window, and opening a second one on top of
 * the first left both there — a roster half-covered by a privacy panel, with two close buttons
 * and no way to tell which Escape would answer. One at a time is what a modal means.
 */
function onlyPanel(keep: HTMLElement | null): void {
  for (const panel of coveringPanels()) {
    if (panel !== keep) panel.hidden = true
  }
}

/**
 * The scrim follows the panels, rather than being told about them.
 *
 * There are seven ways a panel opens and eight ways one closes — a pill, the palette, a click on
 * the floor, Escape, a card's own ×, another panel taking its place. Threading `showScrim()`
 * through all of them is fifteen call sites and one of them is always the one somebody forgets,
 * and the failure is silent: a wash over an app with no panel on it, or a panel with nothing
 * behind it. That is standing order 3 with a very small blast radius and no way to notice.
 *
 * An observer cannot forget. It watches the one attribute that decides, so whatever opens a
 * panel — including something written next week that nobody told about this — the scrim agrees.
 */
function watchPanels(): void {
  // Where focus was before a panel took it. Restored on close, because a panel that hands focus
  // back to the top of the document makes the next Tab start over — and the person who opened it
  // was somewhere.
  let returnFocusTo: HTMLElement | null = null

  const sync = (): void => {
    const open = coveringPanels().find((panel) => !panel.hidden) ?? null
    els.scrim.hidden = open === null

    // The other half of the scrim.
    //
    // The scrim stops the mouse and nothing stopped the keyboard: measured with real Tab keys,
    // one press from the open task list moved focus out of the panel and walked the whole app
    // behind it — `all offices`, `tasks`, `···`, `⌘K`, the switcher, the composer. Every one of
    // those is covered, most are invisible, and all of them were reachable and pressable.
    //
    // `inert` is the whole fix: it takes the subtree out of the tab order and out of the hit
    // test at once, which is exactly what "there is a panel over this" already means to a person
    // looking at the screen. Set before the restore below runs, because `returnFocusTo` is
    // almost always inside this subtree and focusing into an inert tree does nothing.
    els.building.inert = open !== null

    if (open !== null) {
      // Only on the way in. `sync` runs on every attribute change, and re-focusing a panel that
      // was already open would fight whatever the person is typing in it.
      if (returnFocusTo === null) {
        returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      }
      if (!open.contains(document.activeElement)) {
        // The first thing you can act on, and the close button as a floor. A panel that opens
        // with focus still behind it is one where Tab walks the app underneath.
        //
        // `firstFocusable` rather than `querySelector(...) ?? close`, because those are not the
        // same question. The task list on the office conversation holds `×` and a *disabled*
        // "Check everything allowed" — there is no project, so there is nothing to check. The
        // selector matched the disabled button, so the `??` never reached the close button,
        // `.focus()` did nothing, and focus stayed on the composer behind the panel. Silently.
        // `Array.from`, not a spread: `dom.iterable` is deliberately not in this tsconfig's lib.
        const candidates = Array.from(
          open.querySelectorAll<HTMLElement>('input, textarea, [href], button:not(.card__close)'),
        )
        firstFocusable(candidates, open.querySelector<HTMLElement>('.card__close'))?.focus()
      }
      return
    }

    // Back where it was — or where typing goes, when where it was cannot take focus any more.
    //
    // The palette is the case that made this necessary: choosing an entry from ⌘K remembers the
    // palette's own input, which is still in the document and inside a hidden subtree by the
    // time the panel closes. `.focus()` on it does nothing and the keyboard lands on `<body>`.
    // See `restoreFocus`, which asks whether focus moved rather than predicting that it will.
    const back = returnFocusTo
    returnFocusTo = null

    // The composer is the fallback, and **the composer can be disabled**: `render` sets
    // `els.composer.disabled = !manager`, so a workspace with staff and no delegator — the state
    // the `no-manager` lint exists for — has no composer to fall back to. A disabled element
    // cannot take focus, so both rungs fail and the keyboard is on `<body>`, at the worst
    // possible moment: the reader is in a broken workspace and has just closed the panel that
    // might have explained it.
    //
    // So there is a third rung, and it is here rather than inside `restoreFocus` — that module's
    // argument is that it asks the DOM rather than enumerating reasons, and a hardcoded target
    // would be the start of the enumeration it refuses. `#building` carries `tabindex="-1"`: not
    // in the tab order, always focusable, and focusing it means the keyboard is in the app rather
    // than at the top of the document. `office-space-6c`.
    if (restoreFocus(back, els.composer) === null) els.building.focus()
  }

  const observer = new MutationObserver(sync)
  for (const panel of coveringPanels()) {
    // `childList`/`subtree` as well as `hidden`, because half these panels are filled after they
    // are opened. `showTasks` unhides the panel and *then* awaits `office.tasksOf`, so watching
    // only `hidden` runs this against whatever the body held from last time — focus lands on an
    // element that `renderTaskList` then replaces, and ends up on `document.body`. Measured:
    // opening the task list left focus outside the panel both before and after the `??` fix,
    // for two different reasons.
    //
    // It cannot fight anybody, because the guard above only moves focus when it is *not* already
    // inside the open panel — so a person typing in a panel that redraws keeps their cursor.
    observer.observe(panel, {
      attributes: true,
      attributeFilter: ['hidden'],
      childList: true,
      subtree: true,
    })
  }
  // Clicking away is what everybody tries first, and it was the one exit these panels did not
  // have. Escape already works and always did; this makes the obvious gesture true as well.
  els.scrim.addEventListener('click', () => closeEverything())
  sync()
}

/** Every panel down, and focus back where typing goes. */
function closeEverything(): void {
  for (const panel of panels()) panel.close()
  // The palette is not a panel: it is not escapable in its own right — Escape inside it is
  // handled by the palette, before this is ever reached — and nothing goes inert for it.
  palette.close()
  els.composer.focus()
}


// ───────────────────────────────────────────────────────────────── the privacy panel ──

/**
 * What the office remembers.
 *
 * Read on every open rather than cached: `memory/` is written by the memory-keeper between
 * turns, so a value taken at boot would be stale by the time anybody looked — and this is the
 * one surface whose whole subject is whether something is known.
 *
 * The rejection is caught here rather than left to the renderer-wide mishap surface.
 * `readMemory` already answers a directory that will not open with a `problem` **inside** the
 * report, so the only way this can reject is something worse than that — and a panel that opened
 * onto a generic "something went wrong" would say nothing about memory at all.
 */
async function showMemory(focus?: string): Promise<void> {
  onlyPanel(els.memoryPanel)
  els.memoryPanel.hidden = false

  const report = await office.memory().catch((err: unknown) => ({
    memories: [],
    unread: [],
    problem: `the office could not be asked what it remembers — ${unwrap(err).message}`,
  }))
  renderMemory(els.memoryBody, report, focus)
}

/**
 * What the office decided while you were out.
 *
 * Read on open, like `showMemory`, and for a sharper reason: this directory is written by the
 * approval gate — a **separate process**, spawned by the CLI — so there is nothing in this
 * process to push from, and anything cached at boot would be stale by exactly the interval that
 * matters, which is the time you were not here.
 *
 * The rejection is caught here rather than left to the renderer-wide mishap surface. `readDecided`
 * already answers a directory that will not open with a `problem` **inside** the report, so the
 * only way this can reject is something worse — and a panel that opened onto a generic "something
 * went wrong" would say nothing about the record at all.
 */
async function showDecided(focus?: string): Promise<void> {
  onlyPanel(els.decidedPanel)
  els.decidedPanel.hidden = false

  const report = await office.decided().catch((err: unknown) => ({
    decisions: [],
    unread: [],
    problem: `the office could not be asked what it decided — ${unwrap(err).message}`,
    beyond: 0,
  }))
  renderDecided(els.decidedBody, report, focus)
}

/**
 * Put a dispatch's changes back, and say what happened either way.
 *
 * Re-reads the panel afterwards rather than editing the row in place. The undo has just written
 * over files, and the honest thing to draw next is what the office finds on disk now — a row
 * patched from what the click intended would be a claim about the tree made by the code that
 * changed it.
 */
async function putBack(dispatch: string): Promise<void> {
  const got = await office.undo(dispatch).catch(() => null)
  if (got === null) {
    say('The office could not be asked to put this back.', 'failed')
    return
  }
  // Refusals are listed, not summarised. Each one names a file and what is wrong with it, and a
  // count would send somebody looking for the rest.
  say(got.ok ? got.said : got.why.join(' '), got.ok ? 'done' : 'failed')
  await showChanged()
}

/**
 * What the office changed, per dispatch.
 *
 * Read on open rather than pushed. The record for a dispatch cannot exist until its run ends, so
 * a live feed would be complete for finished work and silently short for work still going — and
 * a short list that looks complete is the one failure this whole surface exists to prevent.
 *
 * `hasRecord` is what separates *changed nothing* from *has not finished*. A row with no files
 * and no record is a dispatch still working; a row with no files and a record is one that
 * genuinely touched nothing. They are one line apart on screen and completely different facts.
 */
async function showChanged(): Promise<void> {
  onlyPanel(els.changedPanel)
  els.changedPanel.hidden = false
  loading(els.changedBody, 'Reading what each dispatch changed…')

  const rows = await office.changed().catch(() => null)
  if (rows === null) {
    els.changedBody.textContent = ''
    const said = document.createElement('p')
    said.className = 'roster__empty'
    // Not an empty list. "Nothing has changed" would be a claim about somebody's files.
    said.textContent = 'The office could not be asked what it changed.'
    els.changedBody.appendChild(said)
    return
  }

  renderChanged(els.changedBody, rows, {
    // A record exists when the dispatch reported something — files, a shell count, or an
    // unattributed edit. All three mean the run ended; only their absence means it has not.
    hasRecord,
    onUndo: (id) => void putBack(id),
  })
}

function closeChanged(): void {
  els.changedPanel.hidden = true
}

function closeSearch(): void {
  els.searchPanel.hidden = true
}

/**
 * Open the search, and draw the state before anything has been asked.
 *
 * `null` rather than an empty `Searched`, and the difference is the panel's own rule: the office
 * has not looked yet, and an empty box reporting "nothing found" would be answering a question
 * nobody has put.
 */
function showSearch(): void {
  onlyPanel(els.searchPanel)
  els.searchPanel.hidden = false
  renderSearch(els.searchBody, null, '', { onOpen: openHit })
  els.searchInput.focus()
  els.searchInput.select()
}

/** What a query returned last, so a slow answer for an old query cannot overwrite a newer one. */
let searchAsked = ''

async function runSearch(): Promise<void> {
  const query = els.searchInput.value
  searchAsked = query

  if (query.trim() === '') {
    renderSearch(els.searchBody, null, '', { onOpen: openHit })
    return
  }

  /*
   * The failure becomes an answer here, not a `null`.
   *
   * `null` already means *nobody has asked yet* to `renderSearch`, and catching into the same
   * value gave one variable two meanings four lines apart — the exact confusion this panel exists
   * to prevent, inside the function that draws it. `nothingWasSearched` says what is true: the
   * office could not be asked, so none of the four sources was read.
   */
  const found = await office.search(query).catch(() => nothingWasSearched('the office could not be asked'))
  /*
   * A reply for a query the person has already typed past is discarded, never drawn.
   *
   * Typing is faster than reading four sources, so answers arrive out of order — and a stale one
   * painted over a newer one is the floor stating something about the workspace that is no longer
   * what was asked. Same rule as the speech bubbles: an answer is about a moment, and the moment
   * passes.
   */
  if (searchAsked !== query) return

  renderSearch(els.searchBody, found, query, { onOpen: (hit) => void openHit(hit) })
}

/**
 * Somebody chose a result, and the office goes there.
 *
 * This used to copy the location, with a comment saying that opening a transcript was a feature
 * it did not have. It does now — `openSession`, `switchTo` and `showMemory` were all already
 * here, and a search that can only tell you where something is makes you do the last step by
 * hand every time.
 *
 * **A hit with nowhere to go still copies, and its row says "copy" rather than "open".** The
 * ledger has no viewer to open, and the original comment's fear is the right one: a control that
 * looks like a link and does nothing is worse than one that hands over the location. What changed
 * is that this is now true of one row instead of all of them.
 *
 * The panel closes first. Navigating with a modal still up leaves the destination behind an
 * overlay that trapped focus for the panel you have already left.
 */
async function openHit(hit: Hit): Promise<void> {
  if (hit.goto === null) {
    const at = hit.line === null ? hit.where : `${hit.where}:${hit.line}`
    void navigator.clipboard?.writeText(at).then(
      () => say(`Copied ${at}`),
      () => say(`Could not copy ${at}`, 'failed'),
    )
    return
  }

  closeSearch()

  /*
   * One catch, naming the hit that failed.
   *
   * A conversation can be gone from the registry between the search and the click, and a project
   * can be renamed under it. Both are ordinary, and without this either would surface as a click
   * that did nothing — which is the state this whole change exists to remove. What matters is
   * that the sentence says *which* result would not open, since the panel has just closed and the
   * list is no longer on screen to point at.
   */
  try {
    if (hit.goto.kind === 'conversation') {
      /*
       * Project and conversation together, in one call.
       *
       * `openSession(project, id)` in the main process does `current.set(project, id)` — it binds
       * the conversation to whatever project is active — so the project has to move first. Doing
       * that as two calls meant `switchTo` opened *a* conversation and then this opened the right
       * one, which is two loads, a visible flash, and a stray empty conversation created whenever
       * the destination project had none to go back to.
       */
      await switchTo(hit.goto.project, hit.goto.sessionId)
    } else if (hit.goto.kind === 'project') {
      await switchTo(hit.goto.id)
    } else {
      await showMemory(hit.goto.id)
    }
  } catch (err) {
    say(`Could not open ${hit.where}: ${(err as Error).message}`, 'failed')
  }
}


function closeMemory(): void {
  els.memoryPanel.hidden = true
}

function closeDecided(): void {
  els.decidedPanel.hidden = true
}

/**
 * What runs on a hook.
 *
 * Read on every open, and for a stronger reason than the memory panel's. The answer is a join of
 * a settings file and a directory, and both are things a person edits in another window while
 * this app is running — registering a hook is exactly the change somebody makes *because* they
 * just looked at this panel. A value taken at boot would describe the workspace they had before.
 *
 * The rejection is caught here rather than left to the renderer-wide mishap surface, the same way
 * `showMemory` does it: `readHooks` already answers an unreadable settings file and an unreadable
 * directory *inside* the report, so the only way this can reject is something worse — and the one
 * sentence a person must never read on this panel is a generic failure, which is indistinguishable
 * from "you have no hooks" to anybody not reading carefully.
 */
async function showHooks(): Promise<void> {
  onlyPanel(els.hooksPanel)
  els.hooksPanel.hidden = false

  const report = await office.hooks().catch((err: unknown) => ({
    hooks: [],
    inert: [],
    sources: [],
    directoryProblem: `the office could not be asked what runs on a hook — ${unwrap(err).message}`,
    // `incomplete`, so the empty state says it could not look rather than that nothing is
    // registered. Nothing here has been established, and the panel must not imply it has.
    incomplete: true,
  }))
  renderHooks(els.hooksBody, report)
}

function closeHooks(): void {
  els.hooksPanel.hidden = true
}

/**
 * How full the plan is.
 *
 * Read on every open. The value is a measurement taken on the first event of the last run, so
 * it changes whenever the office does anything — and this is the one surface whose subject is
 * *when* it was taken, which a value cached at boot would misreport by however long the app has
 * been open.
 *
 * `now` is passed in rather than read inside the view, so what "measured 2 hours ago" means is
 * decided once at the call and a test can put a clock in front of it.
 *
 * The rejection is caught here, like the panels above. `planUsage` answers every state it knows
 * about *inside* the reading, so the only way this rejects is something worse — and a generic
 * failure on this panel would be indistinguishable from "your allowance is fine", which is the
 * one thing it must never imply.
 */
async function showPlan(): Promise<void> {
  onlyPanel(els.planPanel)
  els.planPanel.hidden = false

  const reading = await office.planUsage().catch((): PlanReading => ({ state: 'never-ran' }))
  renderPlan(els.planBody, reading, Date.now())
}

function closePlan(): void {
  els.planPanel.hidden = true
}

/**
 * Employees a colleague maintains, and whether our copy is still theirs.
 *
 * Opens **unchecked**. Every row says so, because checking clones repositories and a panel that
 * did that on every open is a panel nobody leaves open — and *not checked* is a real answer,
 * where a silently stale one is not. "Check every source" is the deliberate act, and it is one
 * clone per source rather than one per employee.
 */
async function showMaintained(look = false): Promise<void> {
  onlyPanel(els.maintainedPanel)
  els.maintainedPanel.hidden = false
  const rows = await office.maintainedElsewhere(look).catch((err: unknown) => {
    say(`Could not read who is maintained elsewhere — ${unwrap(err).message}`)
    return []
  })
  renderMaintained(els.maintainedBody, rows, (id) => void takeTheirs(id))
}

/**
 * Services the office can reach, and a form that adds one.
 *
 * Two reads that can fail apart: the survey, which names every server on this machine, and this
 * workspace's own `.mcp.json`, which decides which of them have a remove control. A survey that
 * fails is drawn as a survey that failed — never as an office with no connectors.
 */
async function showConnectors(): Promise<void> {
  onlyPanel(els.connectPanel)
  els.connectPanel.hidden = false
  const [report, ours] = await Promise.all([
    office.capabilitiesOf().then(
      (r) => r,
      () => null,
    ),
    office.projectServers().catch(() => [] as readonly string[]),
  ])
  renderConnectors(els.connectBody, report, ours, (name) => void removeConnector(name))
}

function closeConnectors(): void {
  els.connectPanel.hidden = true
}

async function removeConnector(name: string): Promise<void> {
  const outcome = await office.disconnectService(name).catch((err: unknown) => ({
    ok: false as const,
    reason: unwrap(err).message,
  }))
  say(outcome.ok ? `${name} is out of .mcp.json.` : `${name} was left where it is — ${outcome.reason}`)
  await showConnectors()
}

function closeMaintained(): void {
  els.maintainedPanel.hidden = true
  renderOffered(els.maintainedOffered, null, () => {})
}

/**
 * Take their version.
 *
 * The refusal is shown as a sentence rather than swallowed. Main re-checks that the update is
 * still safe at the instant of the write — the hidden button was a courtesy, and if the file
 * changed while somebody was reading the row, this is the reply that says so.
 */
async function takeTheirs(id: string): Promise<void> {
  const outcome = await office.takeTheirVersion(id).catch((err: unknown) => ({
    ok: false as const,
    reason: unwrap(err).message,
  }))
  if (!outcome.ok) {
    say(`${id} was left as it is — ${outcome.reason}`)
  } else {
    say(`${id} is now the version at its source.`)
  }
  // Redraw with a fresh look either way: a refusal means the standing on screen was already out
  // of date, which is exactly the moment not to leave it there.
  await showMaintained(true)
}

/**
 * What leaves, what is kept, and the exact words that were sent.
 *
 * Re-measured every time it opens rather than cached. The numbers are about a filesystem the
 * user also edits, and a size read once at launch is a number that is wrong by the time anybody
 * reads it — which in this panel specifically is worse than showing nothing.
 */
async function showPrivacy(): Promise<void> {
  onlyPanel(els.privacyPanel)
  els.privacyPanel.hidden = false
  els.privacyProblem.hidden = true
  els.privacyRoot.textContent = snapshot?.root ?? ''

  // This one walks the whole workspace measuring directories, so it is the slowest panel in
  // the app and the one most likely to be looked at while it is still counting.
  loading(els.privacyBody, 'Measuring what is on disk…')

  try {
    // Two reads that fail apart. A workspace with no git is a perfectly good workspace, and its
    // answer to "what would a push carry" must not take the disk measurements down with it.
    const [report, sharing] = await Promise.all([
      office.privacyOf(active),
      office.whatWouldBeShared().then(
        (rows) => rows,
        () => null,
      ),
    ])
    renderPrivacy(els.privacyBody, report, { onForget: (path) => void forgetStore(path) }, sharing)
  } catch (error: unknown) {
    // Said out loud. A privacy panel that fails silently is the one panel where an empty body
    // reads as "there is nothing here", which is the opposite of what happened.
    els.privacyBody.replaceChildren()
    els.privacyProblem.hidden = false
    els.privacyProblem.textContent = `Could not read what is on disk: ${
      error instanceof Error ? error.message : String(error)
    }`
  }
}

async function forgetStore(path: string): Promise<void> {
  const outcome = await office.forget(path)
  if (!outcome.ok) {
    els.privacyProblem.hidden = false
    els.privacyProblem.textContent = outcome.reason
    say(outcome.reason, 'failed')
    return
  }
  say(`${path} is deleted.`)
  // Re-measure rather than assume it worked. The panel's whole claim is that its numbers are
  // measured, and a row that shows "deleted" because we asked for a delete is the claim broken
  // at the moment it matters most.
  await showPrivacy()
}

function closePrivacy(): void {
  els.privacyPanel.hidden = true
}


// ───────────────────────────────────────────────────────────────── the harness ──

/**
 * What this project says has to be true, and whether it is.
 *
 * Opening the panel runs nothing — listing is free, and checking touches the machine, so
 * checking is always something somebody asked for.
 */
async function showTasks(report?: Awaited<ReturnType<typeof office.tasksOf>>): Promise<void> {
  onlyPanel(els.taskPanel)
  els.taskPanel.hidden = false
  const name = snapshot?.projects.find((p) => p.id === active)?.name ?? 'the office'
  els.taskProject.textContent = name
  if (!report) loading(els.taskList, 'Reading TASKS.md…')

  const result = report ?? (await office.tasksOf(active))

  // The floor is the point. A panel somebody has to open is not the office showing them
  // anything, so the outcomes go onto the people carrying them as well.
  floor.setOutcomes(outcomesByOwner(result.checks))

  const { note, canRunAll } = summariseTasks(result)
  els.taskNote.textContent = note
  els.taskRunAll.disabled = !canRunAll

  if (result.problem) {
    els.taskList.replaceChildren()
    return
  }

  renderTaskList(els.taskList, result, { onRun: (only, force) => void runOne(only, force) })
}

/**
 * Put the current project's task outcomes on the floor, without opening the panel.
 *
 * Listing runs nothing and costs nothing, so this is safe to do on every switch. It is only
 * what the harness already knows — no check is run by looking.
 */
async function refreshOutcomes(): Promise<void> {
  // The props read this too, so the project row is fetched whether or not the task list can be.
  // `missing` and `lastActiveAt` are facts about the project itself and survive a task file the
  // harness cannot open — which is exactly the case where the room must still say something
  // true rather than go blank everywhere at once.
  const project = snapshot?.projects.find((p) => p.id === active) ?? null
  const about = (tasks: RoomSources['tasks']): RoomSources | null =>
    project && { missing: project.missing, lastActiveAt: project.lastActiveAt, tasks }

  try {
    const report = await office.tasksOf(active)
    floor.setOutcomes(outcomesByOwner(report.checks))
    floor.setRoom(
      readRoom(
        about({
          // The task's own declared state, not its VERIFY outcome. A note on the board is work
          // somebody still has to do; whether the harness could check it is a different
          // question, and it is the one the name-tag marks already answer.
          outstanding: report.checks.filter((c) => c.task.state !== 'done').length,
          unreadable: report.unreadable,
          problem: report.problem,
        }),
        Date.now(),
      ),
    )
  } catch {
    // A project with no task list is not an error, and an office that cannot read one should
    // not start colouring people on a guess.
    floor.setOutcomes(new Map())
    // `tasks: null` is the point rather than a fallback: the board dims instead of hanging
    // empty, and the plant still reads a recency this failure says nothing about.
    floor.setRoom(readRoom(about(null), Date.now()))
  }
}


async function runOne(only: ClickedTask, force: boolean): Promise<void> {
  els.taskNote.textContent = 'checking…'
  await showTasks(await office.verify(active, only, force))
}

async function runAll(): Promise<void> {
  els.taskRunAll.disabled = true
  els.taskNote.textContent = 'checking…'
  await showTasks(await office.verify(active, null, false))
}

function closeTasks(): void {
  els.taskPanel.hidden = true
}

function closeCard(): void {
  openAgent = null
  els.card.hidden = true
  els.cardWork.hidden = true
  els.cardLog.replaceChildren()
}

// ───────────────────────────────────────────────────────────────────────── events ──

/** Zoom the floor out to every project, or back into one. */
function showCampus(on: boolean): void {
  floor.setView(on ? 'campus' : 'office')
  els.viewToggle.setAttribute('aria-pressed', String(on))
  els.viewToggle.textContent = on ? 'this office' : 'all offices'
}

els.viewToggle.addEventListener('click', () => showCampus(!floor.isCampus))
els.send.addEventListener('click', () => void send())
els.stop.addEventListener('click', () => void stop())

/**
 * Speaking into the composer.
 *
 * Inserted at the cursor and never sent. Dictating half a sentence, typing a name, then
 * dictating the rest is an ordinary way to use this, and a mic that replaced the field would
 * punish it. Every refusal goes to the transcript rather than to the console — a mic button
 * that does nothing when pressed reads as a broken app, not as a missing model.
 */
wireMic({ button: els.mic, chevron: els.micPick, menu: els.micMenu }, {
  onText: (text) => {
    const box = els.composer
    const before = box.value.slice(0, box.selectionStart ?? box.value.length)
    const after = box.value.slice(box.selectionEnd ?? box.value.length)
    const gap = before !== '' && !before.endsWith(' ') ? ' ' : ''
    box.value = `${before}${gap}${text}${after}`
    const caret = before.length + gap.length + text.length
    box.setSelectionRange(caret, caret)
    // The same event typing fires, so the box grows and the send hint clears exactly as it does
    // for a keyboard. Dictation that skipped this left a one-line box holding four lines.
    box.dispatchEvent(new Event('input', { bubbles: true }))
    box.focus()
  },
  onNotice: (message) => current().chat.notice(message),
  transcribe: (wav) => office.transcribe(wav),
  /**
   * Ready, or made ready.
   *
   * A user pressed Speak and nothing happened. The button was working exactly as written — it
   * refused before opening the microphone because nothing on the machine could transcribe — and
   * it said so **in the chat transcript**, which is not where somebody is looking a tenth of a
   * second after pressing a button. From outside, the microphone simply never opened, which is
   * the correct reading of what that looked like.
   *
   * So the refusal is a decision now, not a notice. It says what is missing, in one sentence,
   * and offers to fix it — because a desktop app that answers a button press with *"open a
   * terminal and run this"* has documented the feature rather than shipped it.
   */
  ready: async () => {
    // The operating system first, and separately, because its refusal is a different thing from
    // the browser's: macOS remembers it and it cannot be re-asked from in here.
    const access = await office.microphoneAccess()
    if (!access.granted) return { ready: false, detail: access.reason ?? 'The microphone was not allowed.' }

    let setup = await office.dictation()
    if (setup.ready) return setup

    if (setup.missing === 'binary') {
      const go = window.confirm(
        'Set up dictation?\n\n' +
          'Office Space needs a speech program to turn what you say into text. It runs on this ' +
          'Mac and nothing you say is ever sent anywhere.\n\n' +
          'This runs: brew install whisper-cpp\n\n' +
          'It takes a minute or two, once.',
      )
      if (!go) return { ready: false, detail: 'Dictation is not set up, so the microphone was not opened.' }

      current().chat.notice('Installing the speech program. This takes a minute or two, once.')
      const installed = await office.installDictation()
      if (!installed.ok) return { ready: false, detail: installed.reason ?? 'The speech program could not be installed.' }
      setup = await office.dictation()
      if (setup.ready) return setup
    }

    if (setup.missing === 'model') {
      current().chat.notice('Getting the speech model — 148MB, once. Nothing leaves this machine after this.')
      const got = await office.fetchDictationModel()
      if (!got.ok) return { ready: false, detail: got.reason ?? 'The model could not be downloaded.' }
      setup = await office.dictation()
    }

    if (setup.ready) current().chat.notice('The office can hear you now.')
    return setup
  },
})
els.cardClose.addEventListener('click', closeCard)
els.cardSend.addEventListener('click', () => void askFollowUp())

/**
 * Open a conversation with the person whose card is showing.
 *
 * The card's other control asks the *manager* about them. This asks *them*, which until now the
 * app could not do at all — and the pane becomes their conversation, so a follow-up is a
 * follow-up rather than a second isolated question.
 */
els.cardTalk.addEventListener('click', () => {
  const who = openAgent
  if (!who) return
  closeCard()
  void office
    .openAgentSession(active, who)
    .then(async (info) => {
      /*
       * `openSession` does the switch. Assigning `activeSession` first stopped it.
       *
       * Its first act is `if (info.id === activeSession) return` — so setting the id here made
       * that true and skipped everything after it: hiding the outgoing pane, showing the new one,
       * pointing the floor at it, and restoring its transcript. `renderSessions()` was redundant
       * too; `openSession` calls it.
       *
       * What shipped was worse than a pane that did not change. `activeSession` *had* moved, so
       * `current()` resolved to the new tab while the old one was still the one on screen — the
       * app said "Talking to backend", the header still read "The office", and anything typed
       * went into a conversation nobody could see. Found by pressing the button and reading the
       * header rather than the notice.
       */
      await openSession(info.id)
      say(`Talking to ${who}. This conversation is theirs and does not enter the office's.`)
    })
    .catch((error: unknown) => {
      current().chat.notice(
        `Could not open a conversation with ${who}: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
})
els.cardInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void askFollowUp()
})

els.composer.addEventListener('input', resize)
els.composer.addEventListener('keydown', (e) => {
  // The menu gets first refusal, because while it is open Enter, Tab and the arrows mean
  // something different. Enter especially: choosing an item and sending the message are both
  // reasonable readings and only one can happen.
  if (slash.handleKey(e.key)) {
    e.preventDefault()
    return
  }

  // Enter sends; Shift+Enter is a newline. Dictation inserts text without a keydown, so this
  // cannot fire mid-sentence when someone is talking.
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
})

/**
 * Offer the slash menu, or take it away.
 *
 * On `input` rather than `keydown`, so it also fires for dictation and for paste — the same
 * reason the composer is a real textarea. Someone who dictates "slash meet reviewer" should get
 * the same help as someone who typed it.
 */
els.composer.addEventListener('input', () => {
  const token = slashToken(els.composer.value, els.composer.selectionStart ?? 0)
  if (token === null) slash.hide()
  else slash.show(token)
})

// Clicking away closes it. The menu's own rows use mousedown and cancel the default, so
// choosing one does not go through here first.
els.composer.addEventListener('blur', () => slash.hide())

// Focus is the signal that you have the floor: the manager comes over to listen, and — once
// the voice layer is wired in — the office stops talking. One gesture, both behaviours, and it
// covers dictation as well as typing because dictation types into the focused field.
// Focus is the signal that you have the floor. The manager comes to the window, and the office
// falls quiet — dictation opens a microphone, and a microphone hears the speakers, so anything
// said now would land in your own transcript as though you had said it.
els.composer.addEventListener('focus', () => {
  floor.apply(activeSession, [{ kind: 'composing', composing: true }])
  director?.setListening(true)
})
els.composer.addEventListener('blur', () => {
  floor.apply(activeSession, [{ kind: 'composing', composing: false }])
  director?.setListening(false)
})

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  closeCard()
  closeTasks()
  floor.dismiss()
})

/**
 * Put yesterday's conversation back before anything else is drawn.
 *
 * Resuming a session without showing what is in it would leave the panel looking like a fresh
 * start over a conversation the manager fully remembers — an empty screen standing in for a
 * conversation that exists. So the transcript goes up first, and where it could not be read
 * the office says so rather than showing nothing and letting you assume.
 */
async function restore(session: string): Promise<void> {
  const tab = tabFor(session)
  // Asked once per project. Switching back and forth must not replay the same conversation on
  // top of itself, and must not spend a disk read every time you glance at a tab.
  if (tab.restored) return
  tab.restored = true

  // `session`, not `active`. This function is *given* the conversation to restore and used to
  // ask for the project's instead — so a project's second conversation was filled with the
  // first one's transcript. The argument was always here; it was simply not passed on.
  const previous = await office.restore(active, session)
  if (!previous) return

  const when = new Date(previous.updatedAt)
  const stamp = Number.isNaN(when.getTime()) ? previous.updatedAt : when.toLocaleString()

  if (previous.problem) {
    tab.chat.notice(
      `Picking up where you left off (${stamp}). The manager remembers this conversation, but it cannot be shown here — ${previous.problem}`,
    )
    return
  }

  if (previous.truncated > 0) {
    tab.chat.notice(
      previous.truncated === 1
        ? 'An earlier entry of this conversation is not shown.'
        : `Earlier ${previous.truncated} entries of this conversation are not shown.`,
    )
  }
  // The same speaker rule as a live event: a restored conversation with the tester is still
  // the tester speaking, and labelling the whole transcript with the manager would rewrite who
  // said what every time the app reopened.
  tab.chat.replay(previous.entries, speakerFor(session))
  tab.chat.notice(`Picked up where you left off — ${stamp}.`)

  // ── F2: the strip remembers this conversation too ──────────────────────────────────────
  //
  // Everything above put the transcript back and nothing put the strip back, so a relaunch
  // showed a dispatch to an employee in the chat and "Nothing yet this session" in the panel
  // beside it. Two true sentences that read as a lie.
  //
  // Only the **log** is rebuilt, and that is not a shortcut. `restoreActivity` returns history
  // and nothing else because the processes those dispatches started died with the last run:
  // repopulating "Running" from a file would be the office claiming to watch work that is not
  // happening, which is the failure this whole panel exists to avoid. Restored lines are marked
  // and the strip draws them as read rather than as watched.
  //
  // Appended *after* whatever this tab has seen live — history is newest first, and anything
  // watched since launch is newer than anything in the file.
  const remembered = restoreActivity(previous.entries, speakerFor(session))
  if (remembered.history.length > 0) {
    const live = activityFor(session)
    activityBySession.set(session, {
      inFlight: live.inFlight,
      state: {
        running: live.state.running,
        history: [...live.state.history, ...remembered.history].slice(0, HISTORY_LIMIT),
      },
    })
    // `activeSession`, not `active` — the same pair `feed` had wrong, one function away. A
    // conversation id is never equal to a project id, so this redraw never fired: the rebuilt log
    // reached the model and stopped there. The draw in `openSession` happens before this history
    // exists, which is why this line is still needed once it does.
    if (session === activeSession) drawStrip()
  }
  // ── end F2 ─────────────────────────────────────────────────────────────────────────────
}

/**
 * Move to the next installed theme.
 *
 * Cycling rather than a menu: with the built-in and however many packs somebody has bought,
 * the list is short, and a menu for two items is more chrome than choice.
 */
els.themeName.addEventListener('click', () => {
  const themes = snapshot?.themes ?? []
  if (themes.length < 2) return
  const at = themes.findIndex((t) => t.active)
  // Every cached face is the old art the moment the sprite theme changes. Dropping them here
  // is the difference between a theme switch and a theme switch that leaves everybody in the
  // conversation wearing yesterday's clothes — the exact bug `floor-view.ts` records against
  // its own art cache, in a second cache that would have repeated it.
  forgetFaces()
  void office.setTheme(themes[(at + 1) % themes.length]!.id)
})

els.tasksButton.addEventListener('click', () => {
  if (els.taskPanel.hidden) void showTasks()
  else closeTasks()
})
els.taskClose.addEventListener('click', closeTasks)
els.staffCount.addEventListener('click', () => {
  if (els.rosterPanel.hidden) void showRoster()
  else closeRoster()
})
els.rosterClose.addEventListener('click', closeRoster)
els.privacyClose.addEventListener('click', closePrivacy)

/**
 * The three things that are about the app rather than about the work.
 *
 * They were three permanent pills, and all three are also in the palette — five buttons
 * duplicating a menu that already held them. An app's own settings do not deserve standing room
 * on a floor whose subject is somebody else's project.
 *
 * Built here rather than in markup because the labels and the panels belong together, and
 * because the next one added should cost a line rather than a `<button>`, an id, an `els` entry
 * and a listener four hundred lines apart.
 */
const MORE: readonly { label: string; open: () => void }[] = [
  { label: 'Settings — theme, density, layout, text size', open: () => (els.settingsPanel.hidden ? showSettings() : closeSettings()) },
  { label: 'Music — what is playing, and the Spotify controller', open: openMusic },
  { label: 'Privacy — what leaves this machine, and what is kept', open: () => (els.privacyPanel.hidden ? void showPrivacy() : closePrivacy()) },
]

/**
 * What the collapsed pair is set to, said on the button that hides them.
 *
 * Collapsing a control and losing it are different things, and the difference is whether you can
 * still see its value without opening anything. `model` when both are default, `sonnet` when one
 * is, `sonnet · high` when both — the same sentence the dials themselves would have shown, in a
 * third of the width.
 */
function labelDials(): void {
  const now = readDials(els)
  const parts = [now.model, now.effort].filter((v) => v !== 'default')
  els.dialsOpen.textContent = parts.length === 0 ? 'model' : parts.join(' · ')
  els.dialsOpen.dataset['set'] = String(parts.length > 0)
}

/**
 * The two menus in the status bar, and the keyboard they did not have.
 *
 * Both opened without taking focus, neither answered an arrow key, and Escape closed them
 * without putting focus back on the trigger — so a keyboard user pressing `···` got a menu they
 * could only reach by Tabbing from wherever focus happened to be. `···` is worse than that: it
 * carries `role="menu"` in the markup and gives every item `role="menuitem"`, which promises
 * assistive technology that arrows move between them.
 *
 * `mountPopMenu` is the switcher's `+` menu, which had all three and was the only copy that did.
 * Found by driving the running app: of the five controls in the status bar, this was the one
 * that left `document.activeElement` on `BODY`.
 */
mountPopMenu(els.dialsOpen, els.dialsMenu)

const moreMenu = mountPopMenu(els.moreOpen, els.moreMenu, {
  // Rebuilt on every open, because each entry closes the menu and opens a panel — the handlers
  // belong to the items, and the items are made here.
  fill: () => {
    els.moreMenu.replaceChildren()
    for (const entry of MORE) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'popmenu__item'
      item.setAttribute('role', 'menuitem')
      item.textContent = entry.label
      item.addEventListener('click', () => {
        moreMenu.close()
        entry.open()
      })
      els.moreMenu.appendChild(item)
    }
  },
})
els.memoryClose.addEventListener('click', closeMemory)
els.decidedClose.addEventListener('click', closeDecided)
els.changedClose.addEventListener('click', closeChanged)
els.hooksClose.addEventListener('click', closeHooks)
els.planClose.addEventListener('click', closePlan)
els.maintainedClose.addEventListener('click', closeMaintained)
els.connectClose.addEventListener('click', closeConnectors)

/** One transport at a time. A form asking for both a command and a URL is asking which one to guess. */
function showTransportFields(): void {
  const which = fieldsFor(els.connectTransport.value === 'http' || els.connectTransport.value === 'sse'
    ? (els.connectTransport.value as 'http' | 'sse')
    : 'stdio')
  els.connectCommandField.hidden = !which.stdio
  els.connectUrlField.hidden = !which.url
}
els.connectTransport.addEventListener('change', showTransportFields)
showTransportFields()

els.connectForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const words = els.connectCommand.value.trim().split(/\s+/).filter(Boolean)
  const transport =
    els.connectTransport.value === 'http' || els.connectTransport.value === 'sse'
      ? (els.connectTransport.value as 'http' | 'sse')
      : ('stdio' as const)
  const request = {
    name: els.connectName.value.trim(),
    transport,
    command: words[0] ?? '',
    args: words.slice(1),
    url: els.connectUrl.value.trim(),
    envKeys: parseNames(els.connectEnv.value),
    headers: parseHeaders(els.connectHeaders.value),
  }
  void office
    .connectService(request)
    .catch((err: unknown) => ({ ok: false as const, reason: unwrap(err).message }))
    .then(async (outcome) => {
      if (!outcome.ok) {
        say(`${request.name || 'That service'} was not written — ${outcome.reason}`)
        return
      }
      // Never "connected". `capabilities.ts` is explicit that a written server is inert until a
      // person approves it, and a past-tense verb here would be the third standing order broken
      // by one word.
      say(afterWriting(request.name, '.mcp.json', variablesToSet(request)))
      els.connectForm.reset()
      showTransportFields()
      await showConnectors()
    })
})
els.maintainedCheck.addEventListener('click', () => void showMaintained(true))
els.maintainedFind.addEventListener('submit', (event) => {
  event.preventDefault()
  const at = els.maintainedAt.value.trim()

  /*
   * Say why, rather than returning quietly.
   *
   * `if (!at) return` made Look a button that did nothing and gave no reason — found by pressing
   * every button in every panel. The connect form two panels over gets this right, and the
   * sentence for this one was already written and already tested: `whyNotASource('')` is *"Give a
   * repository URL or a directory on this machine."*
   *
   * A courtesy, not a guarantee — `offeredBy` refuses an empty source in main with the same
   * words, and would have answered here too. This only spares a round trip for a field somebody
   * has not filled in yet.
   */
  const unusable = whyNotASource(at)
  if (unusable) {
    renderRefusal(els.maintainedOffered, unusable)
    return
  }
  const kind = kindFrom(els.maintainedKind.value)
  void office
    .offeredBy(at, kind)
    .catch((err: unknown) => ({ problem: unwrap(err).message }))
    .then((result) => {
      renderOffered(els.maintainedOffered, result, (id) => void hireFromThere(at, kind, id))
    })
})

/** Hire one of the people a source offers, then redraw the list they have just joined. */
async function hireFromThere(at: string, kind: SourceKind, id: string): Promise<void> {
  const outcome = await office.hireFromSource(at, kind, id).catch((err: unknown) => ({
    ok: false as const,
    reason: unwrap(err).message,
  }))
  if (!outcome.ok) {
    say(`${id} was not hired — ${outcome.reason}`)
    return
  }
  say(`${id} works here now, and is still maintained at ${at}.`)
  await showMaintained(false)
  // The offer list is redrawn so the name it just took reads as taken, rather than still
  // offering a button that would now be refused.
  const again = await office.offeredBy(at, kind).catch((err: unknown) => ({ problem: unwrap(err).message }))
  renderOffered(els.maintainedOffered, again, (who) => void hireFromThere(at, kind, who))
}
els.settingsClose.addEventListener('click', closeSettings)
els.firstRunClose.addEventListener('click', closeFirstRun)
els.gettingStarted.addEventListener('click', () => {
  if (els.firstRunPanel.hidden) showFirstRun(true)
  else closeFirstRun()
})

// Written the way this platform writes it: ⌘K on a Mac, Ctrl K everywhere else. A label
// saying ⌘ on Linux is a label nobody can follow.
els.paletteOpen.textContent = accelerator(navigator.platform, 'k')
els.paletteOpen.addEventListener('click', () => palette.toggle())
els.searchClose.addEventListener('click', closeSearch)
els.searchInput.addEventListener('input', () => void runSearch())

els.stripToggle.addEventListener('click', () => {
  stripOpen = !stripOpen
  drawStrip()
})

// Every held call in the workspace, pushed. The watcher polls *and* watches, because
// `fs.watch` misses events — see `approvals.ts`.
office.onApprovals((pending) => {
  hold(afterPush(held, pending))
  drawStrip()
  /*
   * And the campus, which `drawStrip` does not touch.
   *
   * `setCampus` has one call site and it is inside `renderSwitcher`, so before this line the
   * `waiting` mark appeared only when something else happened to redraw the switcher — a
   * workspace rescan, a session change, a project switch. An approval arriving, or being
   * decided, moved nothing. The mark existed and was reachable by coincidence.
   *
   * `renderSwitcher` is the right call rather than a narrower one: it is the only thing that
   * knows the project list the campus is drawn from, and its own comment says the cost is laying
   * out cards rather than floors.
   */
  renderSwitcher()
})
els.taskRunAll.addEventListener('click', () => void runAll())

office.onSpeak((utterance) => {
  // A turn the digest considered and did not speak for. It goes in the strip, never through the
  // director — a voice that reads out its own restraint has misunderstood the assignment. The
  // note lands on the project it belongs to, whether or not that floor is the one on screen.
  if (utterance.quiet) {
    const who = snapshot?.projects.find((p) => p.id === utterance.project)?.name ?? 'the office'
    const at = new Date().toISOString()

    // An utterance carries its project, deliberately — more than one can be running and the one
    // worth hearing is often not the one on screen. The activity model is keyed by conversation,
    // so the note lands on the conversation that project is showing.
    //
    // A project with none open has nowhere to put it. Skipping is honest: there is no transcript
    // for it to be beside, and writing it under a project key was how it used to disappear
    // anyway — silently, into a key nothing read.
    const where = lastSession.get(utterance.project)
    if (where) {
      activityBySession.set(where, applyNote(activityFor(where), quietNote(utterance.quiet, who, at)))
      if (where === activeSession) drawStrip()
    }
    return
  }

  if (!director) return
  // Say which project when it is not the one on screen. "The reviewer found two problems" is
  // useless if you are looking at a different floor and cannot tell whose reviewer.
  const name = snapshot?.projects.find((p) => p.id === utterance.project)?.name
  const text =
    utterance.project === active || !name ? utterance.text : `In ${name}: ${utterance.text}`
  director.offer({ text, urgency: utterance.urgency })
})

/**
 * An option clicked in one of the manager's questions.
 *
 * Sent as an ordinary message, which is the whole design. The answer belongs in the
 * conversation that asked — a decision recorded anywhere else is a decision the transcript
 * does not have, and the transcript is the record this app exists to show.
 */
els.transcripts.addEventListener('office:answer', (event) => {
  const answer = (event as CustomEvent<string>).detail
  if (typeof answer === 'string' && answer.trim() !== '') void send(answer)
})

office.onEvent(feed)
office.onSessionState(setPhase)
office.onOffice((next) => {
  void render(next)
  // `.claude/commands/` is watched, so a rescan is also the signal that somebody has just
  // written a command. Re-reading here is what makes it appear without a restart — which
  // matters because the likeliest moment to open this menu is right after writing one.
  void loadCommands()
})

// Before anything asks the main process a question: these are local preferences, they need no
// IPC, and applying them first means the window is never briefly the wrong colour *or the wrong
// shape*. The palette half of this was laptop 2's — see 03-LOG; F9 gave it three companions and
// a home to live in.
applySettings(readSettings())

/**
 * The switcher, mounted once.
 *
 * Its four handlers already existed — they were the tab strip's `onSelect`, the drawer's
 * `onOpen` and `onNew`, and the inline naming input's `onCreate`. What changed is that they are
 * reachable from one control instead of three surfaces.
 */
const switcher = mountSwitcher(els.switcher, els.switcherList, els.newOpen, els.newMenu, {
  onProject: (id) => void switchTo(id),
  onSession: (id) => void openSession(id),
  onNewSession: () => void openSession(null),
  // The switcher collects the name in a field of its own, because **Electron does not implement
  // `window.prompt`** — it returns `null`, so the guard that used to be here was false every
  // time and the button did nothing at all, silently. Reproduced by pressing it: three projects
  // before, three after, nothing in the console.
  onNewProject: (name) => void startProject(name),

  onCloseSession: (id) => {
    // No confirmation, deliberately. Closing hides a row and deletes nothing — the transcript
    // belongs to Claude Code and is untouched — so asking would train somebody to click through
    // a dialog, which is exactly what makes the one real confirmation below stop working.
    const wasCurrent = knownSessions.some((s) => s.id === id && s.current)
    // Stop it here rather than only in main, because this is the side that can say what died
    // with it. Closing a conversation mid-turn used to leave the run going: the row went, the
    // child `claude` did not, and the queue went with neither. `interrupt` returns the messages
    // it dropped for exactly this — the user typed them and the office accepted them, and which
    // ones never ran is the thing they cannot work out for themselves.
    void (async () => {
      // The interrupt must not be able to prevent the close. It is a synchronous handler in main
      // and can throw, and the first version of this had `closeSession` inside its `.then` — so a
      // failed stop left the conversation open, silently, with an unhandled rejection and a row
      // still on screen after the click that was meant to remove it.
      //
      // Main interrupts on its own for the same reason in the other direction: neither side
      // relies on the other having done it. What this call is *for* is the answer it returns —
      // main cannot say which queued messages died, because the sentence belongs on this side.
      const dropped = await office.interrupt(active, id).catch(() => [] as readonly string[])
      if (dropped.length > 0) {
        current().chat.notice(
          `Closed while running. ${dropped.length} queued message${dropped.length === 1 ? '' : 's'} did not run: ` +
            dropped.map((d) => `"${shorten(d)}"`).join(', '),
        )
      }
      const outcome = await office.closeSession(active, id)
      say(outcome.ok ? 'Conversation closed. Its transcript is untouched.' : outcome.reason, outcome.ok ? 'done' : 'failed')
      if (!outcome.ok) return
      // Closing the one you are *in* leaves the pane pointed at a conversation that is no longer
      // in the list. A fresh one is what closing a tab does, and it is the only answer that does
      // not leave the app showing something it has just said is gone.
      if (wasCurrent) await openSession(null)
      else await renderSessions()
    })()
  },

  onArchiveProject: (id) => {
    void office.archiveProject(id).then((outcome) => {
      say(outcome.ok ? `Archived. ${id} is in projects/.archived/ and nothing has left the workspace.` : outcome.reason, outcome.ok ? 'done' : 'failed')
    })
  },

  onDeleteProject: (id) => void confirmDelete(id),
})

/**
 * The one destructive action in the app, and the only one that asks.
 *
 * It asks *with the answer already in hand*: `describeProject` counts what is there before
 * anything moves, so the dialog names the directory and the number of files rather than saying
 * "are you sure". A confirmation that cannot say what it is about to destroy is a speed bump,
 * and a speed bump trains people to click through — which is how the confirmations that matter
 * stop working.
 *
 * And "could not read it" is its own answer. A dialog that says *0 files* about a directory it
 * failed to open is the fourth standing order broken on the one screen where it would cost
 * somebody their work.
 */
async function confirmDelete(id: string): Promise<void> {
  const found = await office.describeProject(id)

  const what = found.unreadable
    ? `Office Space could not read ${found.path}, so it cannot tell you what is in there.`
    : `${found.path} — ${found.files} ${found.files === 1 ? 'file' : 'files'}`

  const go = window.confirm(
    `Move "${id}" to the Trash?\n\n${what}\n\nIt leaves the workspace and goes to the Trash, so you can put it back from there.`,
  )
  if (!go) return

  const outcome = await office.deleteProject(id)
  say(outcome.ok ? `"${id}" is in the Trash. Recover it from there if you need it.` : outcome.reason, outcome.ok ? 'done' : 'failed')
}

watchSessions()


// Before the first describe(), so the scrim is right on the first frame rather than after it.
watchPanels()

void office
  .describe()
  // The roster first, so the manager's name is known before the transcript is labelled with it.
  .then(render)
  .then(() => openCurrent(active))
  // The dials last: they are per project, and `active` is only settled once a project is open.
  .then(fillDials)
  .then(loadControls)
  .then(loadCommands)
  // The strip's own first paint. Nothing has happened yet, and that is what it should say —
  // an empty bar is how somebody learns the panel is there before there is anything in it.
  .then(drawStrip)
  // What the last run left behind. Asked at boot and nowhere near a timer: this is the whole of
  // the promise that a crash mid-dispatch is offered back rather than shrugged at.
  .then(refreshUnfinished)
  // After the roster and the projects are known, so the diagnosis is about the real
  // workspace rather than about an app that has not read one yet.
  .then(() => showFirstRun())
  .catch((error: unknown) => {
    /**
     * Boot failed. Say one thing a person can act on, and let the panel do the explaining.
     *
     * This printed the exception verbatim, so a stranger's first screen carried
     *
     *   Could not read the workspace: Error invoking remote method 'session:open':
     *   Error: no manager agent found in /private/tmp/…/-Users-somebody-ADE/
     *   …/scratchpad/fresh-workspace/.claude/agents
     *
     * Three faults in one line. It is an IPC frame, not a sentence. The absolute path is the
     * app's business rather than the reader's. And "could not read the workspace" is the wrong
     * diagnosis — the workspace read perfectly, it just has nobody in it.
     *
     * `diagnose()` already knows the difference and says it in prose. So the catch opens that
     * panel rather than competing with it, and the exception goes to the console where somebody
     * debugging this can still find it.
     */
    console.error('office failed to start', error)
    showFirstRun(true)
  })
