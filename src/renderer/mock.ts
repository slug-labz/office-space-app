/**
 * The dev harness — the office, without an office.
 *
 * Loads the real renderer against a fake bridge, so the floor, the choreography and the
 * transcript can be worked on in a browser with no Electron, no workspace, and no spending.
 * Every real Claude call costs money and takes seconds; iterating on how a walk cycle reads at
 * 2× against that loop would be miserable and expensive.
 *
 * It fakes the *bridge*, and nothing else. The floorplan, the choreographer, the walker, the
 * character painter and the transcript are all the shipping code, driven by a plausible event
 * stream in the shape the CLI actually emits — which is the point: if the animation looks right
 * here it looks right in the app.
 *
 * **`npm run harness`**, and open the URL it prints. Never loaded by the app itself.
 *
 * Not `open dist/renderer/dev.html`, which is what this line used to say and what
 * `docs/running.md` said too. It does not work: this file imports `../shared/ipc.js`, which
 * resolves above the document's root when the page is opened directly, so every import 404s, the
 * module never runs, and you get the chrome with an empty office. Nothing reports it, because the
 * script that would have reported it is the script that did not load.
 *
 * Measured in headless Chrome — `window.office` undefined, zero switcher rows — after the wrong
 * instruction had been repeated as a fact by two sessions in one day.
 */

import { DEFAULT_CONTROLS, readControls, type Controls } from '../shared/controls.js'
import { proceduralTheme } from '../shared/theme/procedural.js'
import type { ClaudeEvent } from '../main/claude/stream.js'
import {
  BRIDGE_KEY,
  OFFICE_PROJECT,
  type OfficeApi,
  type OfficeSnapshot,
  type SessionState,
  type Utterance,
} from '../shared/ipc.js'

const STAFF = [
  { id: 'manager', name: 'Manager', description: 'Runs the floor. The only agent that may delegate.', tools: ['Task', 'Read', 'Bash'], model: 'opus', isManager: true },
  { id: 'reviewer', name: 'Reviewer', description: 'Reads changes and says what is wrong with them.', tools: ['Read', 'Grep'], model: 'sonnet', isManager: false },
  { id: 'builder', name: 'Builder', description: 'Writes the code.', tools: ['Read', 'Write', 'Edit', 'Bash'], model: 'sonnet', isManager: false },
  { id: 'tester', name: 'Tester', description: 'Breaks it before anyone else can.', tools: ['Bash', 'Read'], model: 'sonnet', isManager: false },
  { id: 'frontend', name: 'Frontend', description: 'Everything you can see.', tools: ['Read', 'Edit'], model: 'sonnet', isManager: false },
  { id: 'backend', name: 'Backend', description: 'Everything you cannot.', tools: ['Read', 'Edit', 'Bash'], model: 'sonnet', isManager: false },
  { id: 'memory-keeper', name: 'Memory Keeper', description: 'Remembers what the rest of us forget.', tools: null, model: null, isManager: false },
]

const SNAPSHOT: OfficeSnapshot = {
  root: '/Users/you/Projects/office-space (mock)',
  staff: STAFF,
  skills: [
    { id: 'write-a-task', name: 'write-a-task', description: 'Add a task with a VERIFY the office can check.' },
    { id: 'record-progress', name: 'record-progress', description: 'Append what happened, and the evidence.' },
    { id: 'capture-session', name: 'capture-session', description: 'Write the session down.' },
  ],
  problems: [],
  scannedAt: new Date().toISOString(),
  theme: { id: 'procedural', name: 'Drawn in code', credit: null, redistributable: true },
  themes: [
    { id: 'procedural', name: 'Drawn in code', credit: null, redistributable: true, active: true },
    {
      id: 'limezu',
      name: 'LimeZu — Modern Interiors',
      credit: 'Pixel art by LimeZu (limezu.itch.io), used under a purchased commercial licence.',
      redistributable: false,
      active: false,
    },
  ],
  projects: [
    // One of each row state, so the project list can be designed without a workspace: a busy
    // project, one that is running, and one that has never been opened.
    { id: OFFICE_PROJECT, name: 'The office', missing: [], conversations: 3, lastActiveAt: '2026-08-20T22:14:00.000Z', running: false },
    { id: 'auth-refresh', name: 'auth refresh', missing: [], conversations: 7, lastActiveAt: '2026-08-20T23:02:00.000Z', running: true },
    { id: 'billing', name: 'billing', missing: ['TASKS.md'], conversations: 0, lastActiveAt: null, running: false },
  ],
  canCreateProject: true,
  canAddTemplate: true,
  instructions: 'present' as const,
  gate: { state: 'wired' as const },
  // The harness starts from a workspace that is already current, which is what every launch
  // after the first looks like. Put a sentence here to see how the update notice reads.
  update: null,
}

/**
 * Which office the harness is showing.
 *
 * `?empty` and `?unreadable` on `dev.html`, because the states the panels get wrong are the ones
 * a populated workspace cannot reach — and this file could only ever draw a populated one.
 *
 * That is not a hypothetical. Three surfaces were found saying "The manager is listening", "Say
 * something to the manager and watch the floor", and offering a live "That's the whole vision"
 * button on a workspace with nobody in it, directly around a composer correctly disabled for
 * having no manager. All three were invisible here, because here there are always seven people
 * on the floor. Seeing it at all took a hand-patched copy of `dist/`.
 *
 * The changed panel's own mock says it: *"A harness that only draws the happy one is how the
 * other three ship looking like each other."* That was true of one panel's rows and not of the
 * office around them.
 */
function shown(): OfficeSnapshot {
  const asked = new URLSearchParams(globalThis.location?.search ?? '')
  if (asked.has('empty')) {
    // A workspace nobody has set up. Not a workspace whose staff could not be read — see below;
    // they look identical here and the whole point is that they must not read identically.
    return { ...SNAPSHOT, staff: [], skills: [], projects: [], canCreateProject: false }
  }
  if (asked.has('unreadable')) {
    return {
      ...SNAPSHOT,
      staff: [],
      skills: [],
      problems: [{ kind: 'unreadable-dir', path: '.claude/agents', cause: 'EACCES: permission denied' }],
    }
  }
  return SNAPSHOT
}

/** One of each outcome, so the panel can be worked on without a workspace. */
const MOCK_TASKS = (project: string) => ({
  project,
  unreadable: 1,
  // The harness shows the loud case: a heading holding tasks this office does not read.
  // The panel distinguishes that from "no tasks", and a harness that only ever shows the
  // quiet state is how the loud one ships wrong.
  unrecognised: ['Backlog'],
  problem: null,
  checks: [
    {
      task: { ref: '1', title: 'Cap the retry', owner: 'builder', condition: '`npm test` exits 0', command: 'npm test', state: 'in-progress' as const },
      verdict: { state: 'allowed' as const, rule: 'Bash(npm test:*)' },
      result: null,
    },
    {
      task: { ref: '2', title: 'Report expiry as a failure', owner: 'tester', condition: '`npm test` exits 0', command: 'npm test', state: 'in-progress' as const },
      verdict: { state: 'allowed' as const, rule: 'Bash(npm test:*)' },
      result: null,
    },
    {
      task: { ref: '3', title: 'Contrast passes AA', owner: 'frontend', condition: 'somebody reads it and agrees', command: null, state: 'queued' as const },
      verdict: { state: 'unlisted' as const },
      result: null,
    },
    {
      task: { ref: '4', title: 'Benchmark the parser', owner: 'backend', condition: '`cargo bench` runs clean', command: 'cargo bench', state: 'queued' as const },
      verdict: { state: 'unlisted' as const },
      result: null,
    },
    {
      task: { ref: '5', title: 'Clear the build directory', owner: 'builder', condition: '`rm -rf dist` succeeds', command: 'rm -rf dist', state: 'queued' as const },
      verdict: { state: 'denied' as const, rule: 'Bash(rm:*)' },
      result: null,
    },
    {
      task: { ref: '0', title: 'Scaffold the project', owner: 'manager', condition: '`ls projects/billing`', command: 'ls projects/billing', state: 'done' as const },
      verdict: { state: 'allowed' as const, rule: 'Bash(ls:*)' },
      result: null,
    },
  ],
})

const listeners = {
  event: [] as ((project: string, e: ClaudeEvent) => void)[],
  state: [] as ((project: string, s: SessionState) => void)[],
  speak: [] as ((u: Utterance) => void)[],
}

/** Mirrors the real thing: off until asked, and silent while off. */
let voiceOn = false

/** Which conversation the scripted turn is running in. Set by `send`. */
let scriptedProject = OFFICE_PROJECT
let scriptedSession = 'mock-session'

/**
 * A group of conversations per project, so the strip has something to be.
 *
 * The office has two — one from this morning and one from yesterday — which is the case the
 * strip exists for. The other projects have one each, where a strip would be a choice between
 * one thing and is therefore not shown.
 */
const SESSIONS: Record<string, { id: string; agent: string; title: string | null; updatedAt: string }[]> = {
  [OFFICE_PROJECT]: [
    { id: 'mock-session', agent: 'manager', title: 'look at the refresh token path', updatedAt: new Date().toISOString() },
    // An employee's own conversation, so the third level of the switcher has something to draw
    // without a real workspace. The state that shipped had no way to be looked at here.
    { id: 'mock-tester', agent: 'tester', title: 'what did you actually run?', updatedAt: new Date(Date.now() - 600_000).toISOString() },
    { id: 'mock-yesterday', agent: 'manager', title: 'set the office up', updatedAt: new Date(Date.now() - 86_400_000).toISOString() },
  ],
  'auth-refresh': [{ id: 'mock-auth', agent: 'manager', title: null, updatedAt: new Date().toISOString() }],
  billing: [{ id: 'mock-billing', agent: 'manager', title: 'rate limits', updatedAt: new Date().toISOString() }],
}
const currentSession: Record<string, string> = {}

const emit = (event: ClaudeEvent) => listeners.event.forEach((fn) => fn(scriptedSession, event))
const state = (s: SessionState) => listeners.state.forEach((fn) => fn(scriptedSession, s))
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const assistantText = (text: string): ClaudeEvent => ({ kind: 'assistant', parentToolUseId: null, model: 'opus', blocks: [{ type: 'text', text }] })
const toolUse = (id: string, name: string, input: Record<string, unknown>): ClaudeEvent => ({
  kind: 'assistant', parentToolUseId: null,
  model: 'opus',
  blocks: [{ type: 'tool_use', id, name, input }],
})
const toolResult = (id: string, content: string): ClaudeEvent => ({
  kind: 'user',
  blocks: [{ type: 'tool_result', tool_use_id: id, content }],
})

/**
 * One plausible turn: the manager thinks, delegates twice, gets both back, and reports.
 *
 * Timed to be watchable rather than to be fast — the walks are the thing being checked.
 */
async function scripted(): Promise<void> {
  state({ phase: 'running', mode: 'building', sessionId: 'mock-session', costUsd: null, error: null, queued: [] })

  await wait(500)
  emit(assistantText('Right — I will put the reviewer on the auth change and have the tester reproduce the failure.'))

  await wait(900)
  emit(toolUse('t1', 'Task', { subagent_type: 'reviewer', description: 'Review the auth change' }))
  await wait(1400)
  emit(toolUse('t2', 'Task', { subagent_type: 'tester', description: 'Reproduce the 401 on refresh' }))

  await wait(1500)
  // A skill: the reviewer walks to the shelf, takes it down, and carries it back.
  emit(toolUse('t5', 'Skill', { skill: 'write-a-task', args: 'cap the retry' }))

  await wait(1800)
  emit(toolUse('t3', 'Read', { file_path: 'src/main/claude/run.ts' }))
  await wait(700)
  emit(toolResult('t3', '194 lines'))

  await wait(2600)
  emit(toolResult('t1', 'Two problems with the token refresh: the retry has no ceiling, and an expired token is reported as a successful run.'))

  await wait(3000)
  emit(toolResult('t2', 'Reproduced. It only happens when the token expires mid-request.'))

  await wait(1600)
  emit(assistantText('Both back. The reviewer found an unbounded retry and a mis-reported failure; the tester pinned it to a token expiring mid-request.'))
  emit({
    kind: 'result',
    isError: false,
    text: 'done',
    costUsd: 0.2431,
    turns: 4,
    durationMs: 12_000,
    // A run of refusals, so the collapsed block can be seen in the harness without needing a
    // workspace whose rules actually block something. Deliberately the awkward shape rather
    // than the easy one: a repeat, two causes, and a command long enough to be cut — the three
    // things U6's wall of nineteen paragraphs was made of, and the three the block has to
    // survive. One refusal is the *other* case worth looking at, and it is in the tests.
    denials: [
      { tool: 'Bash', toolUseId: 'toolu_d1', detail: 'rm -rf dist', cause: 'denied' },
      { tool: 'Bash', toolUseId: 'toolu_d2', detail: 'rm -rf dist', cause: 'denied' },
      { tool: 'Bash', toolUseId: 'toolu_d3', detail: 'npm publish --access public', cause: 'unlisted' },
      { tool: 'Write', toolUseId: 'toolu_d4', detail: '/etc/hosts', cause: 'unknown' },
    ],
  })
  state({ phase: 'idle', mode: 'building', sessionId: 'mock-session', costUsd: 0.2431, error: null, queued: [] })

  // What the digest would have decided, without spending anything to decide it.
  //
  // Cycles through all three answers rather than always speaking, because two of them are
  // silences and silence is what this feature mostly does. A harness that only ever demonstrates
  // the loud case is how the strip's quiet note went unbuilt in the first place: there was
  // nothing to look at, so there was nothing to notice missing.
  if (voiceOn) {
    const said: Utterance =
      digestTurn % 3 === 0
        ? {
            project: scriptedProject,
            text: 'The reviewer found an unbounded retry, and the tester reproduced the 401. Both are waiting on you.',
            urgency: 'routine',
          }
        : { project: scriptedProject, text: '', urgency: 'routine', quiet: digestTurn % 3 === 1 ? 'judged' : 'failed' }
    digestTurn += 1
    listeners.speak.forEach((fn) => fn(said))
  }
}

/** Which of the digest's three answers the next scripted turn demonstrates. */
let digestTurn = 0

const api: OfficeApi = {

  describe: async () => shown(),
  onOffice: () => () => {},
  // The mock has no live registry, so nothing ever changes a list here. Returning an
  // unsubscribe that does nothing is honest; firing a fabricated change would not be.
  onSessions: () => () => {},
  onSessionMode: () => () => {},
  // The mock has no session to move. Reporting the mode it is already in is honest; pretending
  // the move happened would put the panel in a state the mock cannot actually be in.
  setMode: async () => ({ phase: 'idle' as const, mode: 'building' as const, sessionId: null, costUsd: null, error: null, queued: [] }),
  sprites: async (name) => {
    const frames = proceduralTheme.framesFor(name)
    return { kind: 'painted', width: frames.width, height: frames.height, frames: frames.frames }
  },
  setTheme: async () => {},
  // The two the office ships, plus a command with an argument hint and one without, so the
  // menu's two states can both be seen without a real workspace.
  commandsOf: async () => ({
    items: [
      { name: 'record-progress', description: "Append to a project's PROGRESS.md.", argumentHint: null, kind: 'skill' as const },
      { name: 'meet', description: 'Call named colleagues into the meeting room.', argumentHint: 'reviewer builder', kind: 'skill' as const },
      { name: 'state', description: 'What is true right now, read from the files.', argumentHint: null, kind: 'command' as const },
      { name: 'verify', description: 'Run a task\'s VERIFY condition and report it.', argumentHint: '<task ref>', kind: 'command' as const },
      { name: 'write-a-task', description: 'Add a task with a VERIFY the harness can run.', argumentHint: null, kind: 'command' as const, shadowsSkill: true },
    ],
    problems: [],
  }),
  // Hiring in the harness answers without writing anything: the point of the mock is that the
  // renderer can be worked on with no workspace and no cost, and a hire that touched disk would
  // leave a real agent file behind after a browser refresh.
  hire: async () => ({ ok: true as const }),
  fireAgent: async () => ({ ok: true as const }),
  disableAgent: async () => ({ ok: true as const }),
  enableAgent: async () => ({ ok: true as const }),
  benched: async () => ['contractor'],
  addSkill: async () => ({ ok: true as const }),
  removeSkill: async () => ({ ok: true as const }),
  // One used, one on the shelf nobody has picked, one used and since removed — the three states
  // the report exists to tell apart.
  /**
   * What the office remembers, in every state the panel has to draw.
   *
   * Four recorded, one unreadable, and one written as prose with no frontmatter — because the
   * three quiet states are the ones that ship wrong, and a harness that only demonstrates the
   * happy case is how the empty state goes unbuilt.
   */
  /*
   * Every standing at once, because most of them are hard to reach in a real office.
   *
   * Both-changed in particular needs a colleague to edit their repo *and* somebody to edit the
   * copy here, and it is the row whose control is deliberately absent — so it is the row most
   * worth being able to look at. The harness could not draw it otherwise.
   */
  maintainedElsewhere: async (look) => {
    const at = 'https://github.com/company/agents.git'
    const source = (file: string) => ({ kind: 'git' as const, at, file })
    if (!look) {
      return [
        { id: 'ariel-review', source: source('agents/ariel-review.md'), hiredAt: '2026-03-04',
          standing: { here: 'as-hired' as const, there: 'unchecked' as const }, detail: null },
        { id: 'ariel-release', source: source('agents/ariel-release.md'), hiredAt: '2026-05-19',
          standing: { here: 'edited' as const, there: 'unchecked' as const }, detail: null },
      ]
    }
    return [
      { id: 'ariel-review', source: source('agents/ariel-review.md'), hiredAt: '2026-03-04',
        standing: { here: 'as-hired' as const, there: 'moved-on' as const }, detail: null },
      { id: 'ariel-release', source: source('agents/ariel-release.md'), hiredAt: '2026-05-19',
        standing: { here: 'edited' as const, there: 'moved-on' as const }, detail: null },
      { id: 'ariel-migrate', source: source('agents/ariel-migrate.md'), hiredAt: '2026-06-02',
        standing: { here: 'as-hired' as const, there: 'as-hired' as const }, detail: null },
      { id: 'ariel-perf', source: source('agents/ariel-perf.md'), hiredAt: '2026-07-11',
        standing: { here: 'as-hired' as const, there: 'withdrawn' as const },
        detail: 'ENOENT: no such file or directory' },
      { id: 'dana-security', source: { kind: 'git' as const, at: 'git@github.com:dana/agents.git', file: 'security.md' },
        hiredAt: '2026-08-01', standing: { here: 'edited' as const, there: 'unreachable' as const },
        detail: 'Permission denied (publickey).' },
    ]
  },
  offeredBy: async (at) =>
    at.includes('nowhere')
      ? { problem: 'repository not found' }
      : {
          offered: [
            { file: 'agents/ariel-review.md', id: 'ariel-review', description: 'Reviews PRs the way a senior engineer would.', taken: true },
            { file: 'agents/dana-security.md', id: 'dana-security', description: 'Looks for the mistakes that get shipped.', taken: false },
          ],
        },
  hireFromSource: async () => ({ ok: true as const }),
  // The three server states, and both sides of the remove control: `graphiti-memory` is
  // machine-wide and `postgres` is this workspace's, so the harness can see a list where only
  // some rows have a button and the rest say why.
  projectServers: async () => ['postgres'],
  // The leak is here deliberately: it is the row the whole feature exists for and the hardest
  // one to produce in a real workspace, since it needs a .gitignore that is wrong.
  whatWouldBeShared: async () => [
    { path: '.claude/agents', what: 'The employees.', side: 'shipped' as const, verdict: 'shared' as const, detail: null },
    { path: '.mcp.json', what: 'Connectors, written as ${VARIABLE} references.', side: 'shipped' as const, verdict: 'shared' as const, detail: null },
    { path: 'memory', what: 'What the office remembers about you and your work.', side: 'yours' as const, verdict: 'leaking' as const, detail: null },
    { path: 'projects', what: 'Your projects.', side: 'yours' as const, verdict: 'kept' as const, detail: null },
    { path: '.office-space', what: 'Which conversations exist.', side: 'yours' as const, verdict: 'unknown' as const, detail: 'fatal: not a git repository' },
  ],
  connectService: async () => ({ ok: true as const }),
  disconnectService: async () => ({ ok: true as const }),
  takeTheirVersion: async () => ({ ok: true as const }),
  /**
   * A night the office worked through, as the harness should show it.
   *
   * Every state the panel draws is here on purpose: an approval, a decline with the office's own
   * words, a decision it could not read back, one undated record from before the gate wrote times
   * into names, and a file in the directory that is not a record at all. A fixture that only
   * carried the happy path would let all four failure renderings rot unseen.
   */
  decided: async () => ({
    decisions: [
      {
        id: '1772614800000.allowed.sess-a.t-91',
        at: 1_772_614_800_000,
        outcome: 'allowed' as const,
        request: {
          sessionId: 'sess-a',
          project: null,
          toolUseId: 't-91',
          tool: 'Bash',
          input: { command: 'npm test -- --run src/shared' },
          askedAt: '2026-09-04T02:20:00.000Z',
          waitMs: null,
          agent: 'tester',
        },
        reason: null,
        decidedAt: '2026-09-04T02:20:11.000Z',
      },
      {
        id: '1772613300000.declined.sess-a.t-88',
        at: 1_772_613_300_000,
        outcome: 'declined' as const,
        request: {
          sessionId: 'sess-a',
          project: null,
          toolUseId: 't-88',
          tool: 'Bash',
          input: { command: 'curl -X POST https://api.example.com/deploy' },
          askedAt: '2026-09-04T01:55:00.000Z',
          waitMs: null,
          agent: null,
        },
        reason: 'Not to that host.',
        decidedAt: '2026-09-04T01:55:20.000Z',
      },
      {
        id: '1772610000000.unreadable.sess-a.t-72',
        at: 1_772_610_000_000,
        outcome: 'unreadable' as const,
        request: {
          sessionId: 'sess-a',
          project: null,
          toolUseId: 't-72',
          tool: 'Write',
          input: { file_path: 'src/shared/gate.ts' },
          askedAt: '2026-09-04T01:00:00.000Z',
          waitMs: null,
          agent: 'builder',
        },
        reason: null,
        decidedAt: '2026-09-04T01:00:04.000Z',
      },
      {
        id: 'undated.allowed.sess-old.t-3',
        at: null,
        outcome: 'allowed' as const,
        request: {
          sessionId: 'sess-old',
          project: null,
          toolUseId: 't-3',
          tool: 'Bash',
          input: { command: 'git status --porcelain' },
          askedAt: '2026-08-30T22:14:00.000Z',
          waitMs: null,
          agent: null,
        },
        reason: null,
        decidedAt: '2026-08-30T22:14:02.000Z',
      },
    ],
    unread: [{ id: '1772612000000.allowed.sess-a.t-80', cause: 'the record could not be read as a decision' }],
    problem: null,
    // Non-zero on purpose. The edge of the window is a sentence the panel has to draw, and a
    // fixture that never exercised it would let that wording rot unseen.
    beyond: 412,
  }),
  memory: async () => ({
    memories: [
      {
        id: 'pkce-not-a-client-secret',
        title: 'Spotify auth is PKCE, and the client id is not a secret',
        kind: 'decision' as const,
        created: '2026-08-21',
        updated: '2026-08-21',
        body:
          'Under PKCE the client id is public by design. It is still not ours to ship: a shipped id ' +
          'makes every install share one app\'s rate limits and one redirect whitelist.\n\n' +
          '**Why it matters:** it looks like a secret and is not, so the reasoning gets re-derived.',
        unstructured: false,
      },
      {
        id: 'prefers-showing-over-telling',
        title: 'Better seen than read about',
        kind: 'person' as const,
        created: '2026-08-19',
        updated: '2026-08-26',
        body: 'Screenshots and running builds land; design documents do not.\n\n**Why it matters:** ship the demo first.',
        unstructured: false,
      },
      {
        id: 'the-registry-is-the-only-record',
        title: 'The session registry is the only record of a conversation',
        kind: 'fact' as const,
        created: '2026-08-27',
        updated: null,
        body: 'Nothing else on disk lists them. Overwriting it loses them, and nothing can reconstruct it.',
        unstructured: false,
      },
      {
        id: 'a-note-somebody-left',
        title: 'a-note-somebody-left',
        kind: 'unlabelled' as const,
        created: null,
        updated: null,
        body: 'The retry cap is the thing to look at next. No frontmatter on this one — it is a note, not a record.',
        unstructured: true,
      },
    ],
    unread: [{ id: 'half-written', cause: "EACCES: permission denied, open 'memory/half-written.md'" }],
    problem: null,
  }),

  /*
   * What runs on a hook — and every state of it, not just the reassuring one.
   *
   * The default is the mixed workspace, because a harness that only draws the happy state is how
   * the other three ship looking like each other. It carries, on purpose: a gate that is wired
   * and unedited, a registration naming a file that is **not there**, one running something
   * outside `.claude/hooks/`, a user-level hook from `~/.claude/settings.json`, an event this
   * build does not recognise, two files nothing runs, and a `settings.local.json` that will not
   * parse.
   *
   * `?hooks=unreadable` is the fourth wiring. It has to be its own fixture rather than another
   * row in the first, because it is only reachable when the hooks directory could not be listed
   * — and then the file list is unknown and `inert` is necessarily empty. A fixture showing both
   * at once would be a state `readHooks` cannot produce, which would make the harness the thing
   * lying about the screen.
   *
   * `?hooks=empty` is the good empty: every source read, nothing registered, nothing waiting.
   */
  hooks: async () => {
    const want = new URLSearchParams(location.search).get('hooks')

    const project = '.claude/settings.json'
    const local = '.claude/settings.local.json'
    const user = '~/.claude/settings.json'

    const gate = {
      event: 'PreToolUse',
      matcher: 'Bash',
      command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/approval-gate.mjs"',
      timeoutSeconds: 300,
      unknownType: null,
      scope: 'project' as const,
      path: project,
    }

    if (want === 'unreadable') {
      return {
        hooks: [{ registration: gate, wiring: { state: 'unknown' as const, cause: 'EACCES: permission denied' } }],
        inert: [],
        sources: [
          { path: project, scope: 'project' as const, state: 'ok' as const, cause: null, registrations: 1 },
          { path: local, scope: 'local' as const, state: 'missing' as const, cause: null, registrations: 0 },
          { path: user, scope: 'user' as const, state: 'missing' as const, cause: null, registrations: 0 },
        ],
        directoryProblem: ".claude/hooks exists and could not be opened: EACCES: permission denied, scandir '.claude/hooks'",
        incomplete: false,
      }
    }

    if (want === 'empty') {
      return {
        hooks: [],
        inert: [],
        sources: [
          { path: project, scope: 'project' as const, state: 'ok' as const, cause: null, registrations: 0 },
          { path: local, scope: 'local' as const, state: 'missing' as const, cause: null, registrations: 0 },
          { path: user, scope: 'user' as const, state: 'missing' as const, cause: null, registrations: 0 },
        ],
        directoryProblem: null,
        incomplete: false,
      }
    }

    return {
      hooks: [
        {
          registration: gate,
          wiring: { state: 'wired' as const, file: { name: 'approval-gate.mjs', origin: 'shipped' as const } },
        },
        {
          registration: {
            event: 'PreToolUse',
            matcher: 'Edit|Write',
            command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-protected-paths.mjs"',
            timeoutSeconds: null,
            unknownType: null,
            // The project file, not the local one. The local file in this fixture will not parse,
            // and a registration attributed to a file the same fixture says was never read is the
            // harness telling the panel a story the reader could not produce.
            scope: 'project' as const,
            path: project,
          },
          wiring: { state: 'file-missing' as const, name: 'guard-protected-paths.mjs' },
        },
        {
          registration: {
            event: 'PostToolUse',
            matcher: null,
            command: 'npx prettier --write "$CLAUDE_FILE_PATHS"',
            timeoutSeconds: 30,
            unknownType: null,
            scope: 'project' as const,
            path: project,
          },
          wiring: { state: 'elsewhere' as const },
        },
        {
          registration: {
            event: 'SessionStart',
            matcher: null,
            command: '~/bin/log-session-start',
            timeoutSeconds: null,
            unknownType: null,
            scope: 'user' as const,
            path: user,
          },
          wiring: { state: 'elsewhere' as const },
        },
        {
          registration: {
            event: 'PreflightCheck',
            matcher: null,
            command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/preflight.mjs"',
            timeoutSeconds: 10,
            unknownType: null,
            scope: 'project' as const,
            path: project,
          },
          wiring: { state: 'wired' as const, file: { name: 'preflight.mjs', origin: 'yours' as const } },
        },
      ],
      inert: [
        { name: 'format-on-save.mjs', origin: 'yours' as const },
        { name: 'approval-gate.old.mjs', origin: 'shipped-edited' as const },
      ],
      sources: [
        { path: project, scope: 'project' as const, state: 'ok' as const, cause: null, registrations: 4 },
        {
          path: local,
          scope: 'local' as const,
          state: 'unparsable' as const,
          cause: 'Unexpected token } in JSON at position 412',
          registrations: 0,
        },
        { path: user, scope: 'user' as const, state: 'ok' as const, cause: null, registrations: 1 },
      ],
      directoryProblem: null,
      incomplete: true,
    }
  },

  /*
   * How full the plan is — and the two states that have no number, which are the ones this
   * panel is shaped around.
   *
   * The default is a real reading with **both** buckets, because that is the case the feature
   * exists for: the short window answers "can I start another one now" and the long one answers
   * "will I have room this week", and the app used to keep only whichever was binding.
   *
   * `?plan=never` and `?plan=quiet` are the two silences. They need their own fixtures rather
   * than a flag on the first, because a reading and the absence of one are different shapes —
   * and a harness that could only draw the happy state is how the other two ship looking like
   * an empty bar.
   */
  planUsage: async () => {
    const want = new URLSearchParams(location.search).get('plan')
    const now = Date.now()

    if (want === 'never') return { state: 'never-ran' as const }
    if (want === 'quiet') return { state: 'not-reported' as const, runs: 6 }

    if (want === 'spent') {
      return {
        state: 'measured' as const,
        // `rejected`, not `allowed`. This fixture is the spent-plan demo, and the state worth
        // showing is the one where the office has actually stopped — a fixture that only carried
        // the benign half would let the sentence for the other half rot unseen.
        usage: { status: 'out_of_credits', window: 'seven_day', used: 1, resetsAt: Math.floor((now + 2 * 86_400_000) / 1000), usingOverage: false, overage: 'rejected' },
        windows: [
          { name: 'five_hour', used: 0.4, resetsAt: Math.floor((now + 2 * 3_600_000) / 1000) },
          { name: 'seven_day', used: 1, resetsAt: Math.floor((now + 2 * 86_400_000) / 1000) },
        ],
        at: now - 12 * 60_000,
      }
    }

    return {
      state: 'measured' as const,
      usage: { status: 'allowed', window: 'five_hour', used: 0.72, resetsAt: Math.floor((now + 4 * 3_600_000) / 1000), usingOverage: false, overage: 'allowed' },
      windows: [
        { name: 'five_hour', used: 0.72, resetsAt: Math.floor((now + 4 * 3_600_000) / 1000) },
        { name: 'seven_day', used: 0.07, resetsAt: Math.floor((now + 5 * 86_400_000) / 1000) },
        // A window the CLI named without a utilisation. It draws no bar and says "not reported",
        // which is the one thing that must never render as an empty one.
        { name: 'opus_weekly', used: null, resetsAt: null },
      ],
      at: now - 90 * 60_000,
    }
  },

  shelf: async () => [
    { id: 'record-progress', count: 4, lastUsed: '2026-08-20T09:10:00Z', onShelf: true },
    { id: 'meet', count: 0, lastUsed: null, onShelf: true },
    { id: 'old-helper', count: 2, lastUsed: '2026-08-18T11:00:00Z', onShelf: false },
  ],
  // Deliberately shows the three states that are easy to conflate: a server that answered, one
  // that is written down and never tried, and one that was tried and failed.
  capabilitiesOf: async () => ({
    staff: [
      { id: 'manager', access: 'declared', tools: ['Read', 'Bash', 'Task'], danglingMcpTools: [], unreachableTools: [] },
      { id: 'memory-keeper', access: 'inherited', tools: [], danglingMcpTools: ['mcp__notion__search'], unreachableTools: [] },
      // The harness could draw a dangling MCP tool and not the other kind, so the state that
      // shipped in the real app had no way to be looked at here. It does now.
      { id: 'reviewer', access: 'declared', tools: ['Read', 'Grep', 'WebFetch'], danglingMcpTools: [], unreachableTools: ['WebFetch'] },
    ],
    servers: [
      { name: 'graphiti-memory', transport: 'http', scope: 'user', status: 'connected' },
      { name: 'postgres', transport: 'stdio', scope: 'project', status: 'configured' },
      { name: 'slack', transport: 'sse', scope: 'user', status: 'failed' },
    ],
    sources: [
      { path: '.mcp.json', state: 'ok' },
      { path: '~/.claude.json', state: 'ok' },
    ],
    permissions: { allow: 27, deny: 10, inForce: false },
    problems: [],
    scannedAt: new Date().toISOString(),
  }),
  // The three states the panel must keep apart: a store you have used, one you never have,
  // and one that could not be read. `absent` and `unreadable` look identical in a naive panel
  // and only one of them is fine.
  // The harness has nothing to re-read, and saying so by returning the same snapshot is
  // honest: pressing "Look again" against a fake bridge genuinely changes nothing.
  recheck: async () => SNAPSHOT,
  privacyOf: async () => ({
    root: '/Users/you/office-space',
    stores: [
      {
        path: 'projects',
        what: 'Your work: plans, progress, task lists.',
        kind: 'yours' as const,
        precious: true,
        state: 'present' as const,
        bytes: 48_120,
        files: 9,
        unreadable: 0,
    unrecognised: [],
        where: '/Users/you/office-space/projects',
      },
      {
        path: 'memory',
        what: 'What the office remembers about you and your work.',
        kind: 'yours' as const,
        precious: true,
        state: 'absent' as const,
        bytes: 0,
        files: 0,
        unreadable: 0,
    unrecognised: [],
        where: '/Users/you/office-space/memory',
      },
      {
        path: '.claude/agents',
        what: 'The staff. One file per employee.',
        kind: 'template' as const,
        precious: false,
        state: 'present' as const,
        bytes: 31_004,
        files: 7,
        unreadable: 0,
    unrecognised: [],
        where: '/Users/you/office-space/.claude/agents',
      },
    ],
    egress: [
      {
        what: 'The claude CLI',
        who: 'the claude CLI' as const,
        detail: 'Spawned as a child process. Talks to Anthropic on your own login.',
        active: true,
      },
      {
        what: 'graphiti-memory',
        who: 'the claude CLI' as const,
        detail: 'http · user scope · connected',
        active: true,
      },
    ],
    lastPrompt: '## CURRENT PROJECT\n\npayment-page\n\n## THE MESSAGE\n\nwhat is left on the checkout flow?',
    // The harness carries one, because the state it describes is invisible by construction: a
    // config that will not parse simply produces one fewer row above, and a panel that says
    // nothing about it reads as a clean answer. Somebody changing this section should be
    // looking at the sentence it produces.
    unreadSources: [{ path: '~/.claude/mcp.json', cause: 'not readable JSON: Unexpected token } in JSON at position 214' }],
  }),
  forget: async () => ({ ok: true as const }),
  // Nothing outstanding in the harness, and nothing torn. The dispatch ledger is a file in a
  // real workspace; the harness has no workspace, and inventing an unfinished dispatch here
  // would put a card on screen offering to resume work that was never sent.
  unfinishedWork: async () => ({ entries: [], torn: [], problem: null }),
  dropDispatch: async () => ({ ok: true as const }),
  retryDispatch: async () => ({ problem: 'the harness has no dispatch ledger to re-send from' }),
  // Nothing held in the harness by default: the card is a real interruption and having one
  // permanently on screen would misrepresent what using the office feels like.
  onApprovals: () => () => {},
  decide: async () => {},
  controlsOf: async () => DEFAULT_CONTROLS,
  // Through the real reader, not a pass-through. The harness fakes the *bridge* and nothing
  // else, and a pass-through would hide the one behaviour worth seeing here: a mode the CLI
  // accepts and ignores comes back reset, with a reason.
  setControls: async (_project: string, controls: Controls) => readControls(controls),
  send: async (project) => {
    scriptedProject = project
    scriptedSession = currentSession[project] ?? SESSIONS[project]?.[0]?.id ?? `mock-${project}`
    await scripted()
  },

  sessionsOf: async (project) => {
    const list = SESSIONS[project] ?? []
    const showing = currentSession[project] ?? list[0]?.id
    return list.map((s) => ({ ...s, costUsd: null, current: s.id === showing, running: false }))
  },

  openSession: async (project, id) => {
    const list = (SESSIONS[project] ??= [])
    if (id === null) {
      const fresh = { id: `mock-new-${list.length + 1}`, agent: 'manager', title: null, updatedAt: new Date().toISOString() }
      list.unshift(fresh)
      currentSession[project] = fresh.id
      return { ...fresh, costUsd: null, current: true, running: false }
    }
    currentSession[project] = id
    const found = list.find((s) => s.id === id) ?? { id, agent: 'manager', title: null, updatedAt: new Date().toISOString() }
    return { ...found, costUsd: null, current: true, running: false }
  },

  openAgentSession: async (project, agent) => {
    const list = (SESSIONS[project] ??= [])
    const theirs = list.find((s) => s.agent === agent)
    if (theirs) {
      currentSession[project] = theirs.id
      return { ...theirs, costUsd: null, current: true, running: false }
    }
    const fresh = { id: `mock-${agent}`, agent, title: null, updatedAt: new Date().toISOString() }
    list.unshift(fresh)
    currentSession[project] = fresh.id
    return { ...fresh, costUsd: null, current: true, running: false }
  },
  interrupt: async () => {
    state({ phase: 'idle', mode: 'building', sessionId: 'mock-session', costUsd: null, error: null, queued: [] })
    return []
  },
  createProject: async (name) => ({ state: 'created', id: name.trim().toLowerCase().replace(/\W+/g, '-') }),

  // The three removal verbs. The harness answers them so the confirmation and the outcomes can
  // be looked at without a real workspace to destroy — which is the whole point of a harness,
  // and the reason the packaged app's first artifact leaked art is that nobody had one.
  describeProject: async (id) => ({ path: `projects/${id}`, files: 7, unreadable: false }),
  closeSession: async () => ({ ok: true }) as const,
  archiveProject: async () => ({ ok: true }) as const,
  // Refuses, on purpose. A harness where every destructive call succeeds cannot show what a
  // refusal looks like, and the refusal is the state worth being able to see.
  deleteProject: async (id) => ({ ok: false, reason: `The dev harness will not delete "${id}".` }) as const,

  /** A plausible record for one employee, so the card's newest half can be worked on for free. */
  workOf: async (_project, agent) =>
    agent !== 'reviewer'
      ? null
      : {
          brief: 'Review the auth change',
          toolUseId: 't1',
          truncated: 4,
          problem: null,
          entries: [
            { kind: 'assistant', parentToolUseId: null, uuid: 'w1', timestamp: null, model: 'opus', text: 'Reading the token refresh path.' },
            {
              kind: 'tool', uuid: 'w2', timestamp: null, toolUseId: 'r1', name: 'Read',
              input: { file_path: 'src/main/claude/run.ts' }, result: '194 lines', isError: false, settled: true,
            },
            {
              kind: 'tool', uuid: 'w3', timestamp: null, toolUseId: 'r2', name: 'Grep',
              input: { pattern: 'is_error' }, result: '3 matches', isError: false, settled: true,
            },
            { kind: 'assistant', parentToolUseId: null, uuid: 'w4', timestamp: null, model: 'opus', text: 'The retry has no ceiling.' },
            {
              kind: 'tool', uuid: 'w5', timestamp: null, toolUseId: 'r3', name: 'Bash',
              input: { command: 'npm test' }, result: null, isError: false, settled: false,
            },
          ],
        },

  /** A plausible task list, showing all four outcomes at once. Runs nothing. */
  tasksOf: async (project) => MOCK_TASKS(project),
  verify: async (project, only) => {
    const report = MOCK_TASKS(project)
    return {
      ...report,
      checks: report.checks.map((c, row) =>
        // Mirrors the real harness: done work is not re-litigated, only what the workspace already
        // permits runs unattended, and a press names the row it was on rather than a number two
        // rows can share.
        //
        // `null` means "everything permitted" here as it does there, and that is safe in this file
        // for reasons worth keeping if anyone mirrors more of `checkPressed` into it: this harness
        // has no untrusted sender — its only callers are the app's own typed `runOne` and `runAll` —
        // it fabricates every result rather than running anything, and the `allowed` gate below
        // holds whichever branch got here. So there is no unreadable press to refuse. What must not
        // be copied in is the shape `checkPressed` refuses: a press nobody could read, or a `force`
        // with no task named, falling through to a match on everything.
        (only === null || (only.row === row && only.command === c.task.command)) &&
        c.task.state !== 'done' &&
        c.task.command !== null &&
        c.verdict.state === 'allowed'
          ? { ...c, result: { command: c.task.command, passed: c.task.ref !== '2', exitCode: c.task.ref === '2' ? 1 : 0, output: c.task.ref === '2' ? '1 failing:\n  the retry has no ceiling' : '42 tests, 0 failures', durationMs: 1200, timedOut: false, error: null, missing: [], unchecked: [] } }
          : c,
      ),
    }
  },

  setVoice: async (on) => {
    voiceOn = on
  },
  // Ready in the harness, so the mic can be worked on without a model on disk. What comes back
  // is obviously a stand-in — a harness that returned plausible speech would be a harness you
  // could mistake for the real thing.
  dictation: async () => ({ ready: true }),
  transcribe: async (wav) => ({
    ok: true,
    text: `(the harness heard ${Math.round(wav.byteLength / 32_000)}s of audio)`,
  }),
  fetchDictationModel: async () => ({ ok: true }),
  installDictation: async () => ({ ok: true }),
  microphoneAccess: async () => ({ granted: true }),
  onSpeak: (cb) => {
    listeners.speak.push(cb)
    return () => listeners.speak.splice(listeners.speak.indexOf(cb), 1)
  },
  onEvent: (cb) => {
    listeners.event.push(cb)
    return () => listeners.event.splice(listeners.event.indexOf(cb), 1)
  },
  onSessionState: (cb) => {
    listeners.state.push(cb)
    return () => listeners.state.splice(listeners.state.indexOf(cb), 1)
  },
  /**
   * A short saved conversation, so the restore path is exercised without an Electron process
   * or a real session on disk. Deliberately includes a tool call that never settled — the app
   * was closed mid-run, which is the case most likely to be rendered as a lie.
   */
  // Mirrors the real thing twice over: only the office has anything saved, and only a
  // conversation that has been written down has anything to restore. A new one starts empty
  // rather than inheriting the last one's transcript.
  restore: async (project) => (
    project !== OFFICE_PROJECT || (currentSession[project] ?? 'mock-session') !== 'mock-session'
      ? null
      : {
    sessionId: 'mock-session-yesterday',
    title: 'look at the refresh token path',
    updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
    truncated: 12,
    problem: null,
    entries: [
      { kind: 'user', uuid: 'u1', timestamp: null, text: 'look at the refresh token path' },
      { kind: 'assistant', parentToolUseId: null, uuid: 'a1', timestamp: null, model: 'opus', text: 'I put the reviewer on it.' },
      {
        kind: 'tool', uuid: 'a2', timestamp: null, toolUseId: 'y1', name: 'Task',
        input: { subagent_type: 'reviewer', description: 'Review the refresh token path' },
        result: 'The retry has no ceiling.', isError: false, settled: true,
      },
      {
        kind: 'tool', uuid: 'a3', timestamp: null, toolUseId: 'y2', name: 'Bash',
        input: { command: 'npm test' }, result: null, isError: false, settled: false,
      },
    ],
  }
  ),

  // The music, faked far enough to draw every state without an account. `disconnected` is the

  // honest default: the harness has no Spotify app registered, and pretending otherwise would

  // mean the one screen a developer sees most is the one state a real machine rarely starts in.

  //
  // Every other state is reachable with `?music=<state>` — `playing`, `paused`, `no-device`,
  // `needs-premium`, `blocked`. Without it the harness could draw exactly one of the seven, so
  // the panel's transport, its fold and its device picker had no way to be looked at at all
  // short of registering a Spotify app. A default that is honest and a harness that can only
  // show the default are two different things, and the comment above claimed the second.
  musicPlayer: async () => {
    const want = new URLSearchParams(location.search).get('music')
    const track = {
      id: 'mock-track',
      title: 'Bridge over the Kanal',
      artist: 'Slow Meadow',
      album: 'Costero',
      artwork: null,
      durationMs: 225_000,
    }
    const device = { id: 'mock-device', name: "Vish's MacBook Pro", kind: 'Computer', active: true }
    switch (want) {
      case 'playing':
      case 'paused':
        return { state: want, track, device, devices: [device], progressMs: 83_000, since: Date.now() } as const
      case 'no-device':
        return { state: 'no-device', devices: [] } as const
      case 'needs-premium':
        return { state: 'needs-premium' } as const
      case 'blocked':
        return { state: 'blocked' } as const
      default:
        return { state: 'disconnected' } as const
    }
  },

  musicConnect: async () => ({ ok: false, problem: 'The dev harness cannot sign in to Spotify.' }),

  musicDisconnect: async () => {},

  musicCommand: async () => 'the dev harness has no Spotify to control',

  musicTransfer: async () => 'the dev harness has no Spotify to control',

  musicSearch: async () => [],

  musicPlayTrack: async () => 'the dev harness has no Spotify to control',

  musicSetup: async () => ({

    clientId: '',
    networkAllowed: 'on',

    redirectUri: 'http://127.0.0.1:8888/callback',

    hosts: ['accounts.spotify.com', 'api.spotify.com', 'i.scdn.co'],

    scopes: ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'user-read-private'],

  }),

  musicSetClientId: async () => {},
  musicSetNetwork: async () => {},

  /**
   * What the office changed, in the states the panel has to draw.
   *
   * All three of the ones that look alike and are not: finished with files, finished having
   * changed nothing but run shell commands nobody can account for, still going, and a record
   * that could not be read. A harness that only draws the happy one is how the other three ship
   * looking like each other.
   */
  changed: () =>
    Promise.resolve([
      {
        id: 'toolu_a',
        employee: 'builder',
        brief: 'Add retry-with-backoff to the fetch helper, and cover it with a test.',
        sentAt: '2026-09-01T01:20:00.000Z',
        edited: [
          {
            path: 'projects/greeter/src/fetch.js',
            kind: 'edit' as const,
            before: 'const res = await fetch(url)',
            after: 'const res = await withRetry(() => fetch(url))',
          },
        ],
        created: [
          {
            path: 'projects/greeter/test/retry.test.js',
            kind: 'create' as const,
            before: null,
            after: "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n",
          },
        ],
        unclear: [],
        notShown: 'This dispatch also ran 7 shell commands, whose file effects are not captured.',
        problem: null,
        undone: null,
        stillOut: false,
      },
      {
        id: 'toolu_b',
        employee: 'reviewer',
        brief: 'Read the plan and say whether the shape holds.',
        sentAt: '2026-09-01T01:05:00.000Z',
        edited: [],
        created: [],
        unclear: [],
        notShown: 'This dispatch also ran 3 shell commands, whose file effects are not captured.',
        problem: null,
        undone: null,
        // Still working. The panel must not offer to put back files somebody may be editing now.
        stillOut: true,
      },
      {
        id: 'toolu_c',
        employee: 'tester',
        brief: 'Run the suite and report what failed.',
        sentAt: '2026-09-01T00:58:00.000Z',
        edited: [],
        created: [],
        // A `Write` whose result the office never saw. Drawn so the harness shows the state that
        // stops an undo deleting a file somebody already had.
        unclear: [
          { path: 'projects/greeter/notes.md', kind: 'unknown' as const, before: null, after: '# Notes\n' },
        ],
        notShown: null,
        problem: null,
        undone: null,
        stillOut: false,
      },
      {
        id: 'toolu_d',
        employee: 'frontend',
        brief: 'Restyle the switcher rows.',
        sentAt: '2026-09-01T00:40:00.000Z',
        edited: [],
        created: [],
        unclear: [],
        notShown: null,
        problem: 'the record of what this dispatch changed will not parse — Unexpected end of JSON input',
        undone: null,
        stillOut: false,
      },
      {
        /*
         * The manager's own turn. Not a dispatch — nobody briefed it — so its row says what it
         * *is* rather than pretending to a task, and it has to sit in the same list, because a
         * panel that separated them would invite the reading that one of them is not really the
         * office changing your files.
         */
        id: 'toolu_ownwrite',
        employee: 'manager',
        brief: 'Changed these in its own turn, rather than dispatching somebody.',
        sentAt: '2026-09-01T01:32:00.000Z',
        edited: [
          {
            path: 'CLAUDE.md',
            kind: 'edit' as const,
            before: '## Standing orders',
            after: '## Standing orders\n\nFour, not three.',
          },
        ],
        created: [],
        unclear: [],
        notShown: null,
        problem: null,
        undone: null,
        stillOut: false,
      },
      {
        // The fifth state, and the one that was invisible before it was recorded: the office
        // already put this back. The file list below it is still true about what the employee
        // did and no longer true about the tree, and the panel has to say so before the counts.
        id: 'toolu_e',
        employee: 'builder',
        brief: 'Swap the date helper for the new one.',
        sentAt: '2026-08-31T23:10:00.000Z',
        edited: [
          {
            path: 'projects/greeter/src/when.js',
            kind: 'edit' as const,
            before: 'formatDate(d)',
            after: 'when(d)',
          },
        ],
        created: [],
        unclear: [],
        notShown: null,
        problem: null,
        undone: { at: '2026-09-01T01:44:00.000Z', restored: 1, removed: 0 },
        stillOut: false,
      },
    ]),
  /*
   * Nothing on disk to copy in the harness, and the refusal names that rather than a permission
   * problem the person would then go looking for.
   */
  addProjectTemplate: async () => ({
    ok: false,
    reason: 'This is the harness. There is no workspace to add a project template to.',
  }),

  /*
   * The harness never writes anything, so this reports the refusal a real undo of an unfinished
   * dispatch would give. A mock that returned success would draw the one screen this feature
   * must never draw wrongly: "put back" over files that were not.
   */
  undo: async () => ({
    ok: false as const,
    why: ['This is the harness. Nothing on disk was changed, and nothing was put back.'],
  }),

  /*
   * The harness draws the states that matter, including the one the feature exists for: a source
   * that could not be read. A mock that only ever returns clean results cannot show the screen
   * this panel was written to get right.
   */
  search: async (query) => {
    if (query.trim() === '') return { hits: [], looked: [], blind: [] }
    if (query === 'blind') {
      return {
        hits: [],
        looked: ['project', 'dispatch', 'conversation'] as const,
        blind: [
          { source: 'memory' as const, extent: 'none' as const, why: 'memory/ exists and could not be opened' },
        ],
      }
    }
    if (query === 'partial') {
      /*
       * Read, and not read in full — the state that produced a sentence contradicting its own
       * parenthetical. Drawn here because the harness only shows what it hardcodes, and this is
       * the one where a *found* result sits under a caveat about the very source it was found in.
       *
       * Two entries for one source as well, since collapsing them is the other half of the fix.
       */
      return {
        hits: [
          {
            source: 'conversation' as const,
            goto: { kind: 'conversation' as const, sessionId: 'mock-session', project: 'greeter' },
            where: 'the auth refresh conversation',
            line: 112,
            text: 'the retry helper needs a ceiling or it will hammer the endpoint',
            at: { start: 4, end: 9 },
          },
        ],
        looked: ['memory', 'project', 'conversation', 'dispatch'] as const,
        blind: [
          {
            source: 'conversation' as const,
            extent: 'some' as const,
            why: 'only the 60 most recent of 553 were read',
          },
          {
            source: 'conversation' as const,
            extent: 'some' as const,
            why: 'the retry thread: 3 records would not parse',
          },
        ],
      }
    }
    return {
      hits: [
        {
          source: 'memory' as const,
          goto: { kind: 'memory' as const, id: 'why-backoff' },
          where: 'memory/why-backoff.md',
          line: 5,
          text: 'We chose retry-with-backoff over a fixed delay.',
          // `'We chose '` is nine characters. This said 10, so the harness drew its own mark over
          // `etry-` — quietly demonstrating the off-by-one it exists to make visible.
          at: { start: 9, end: 14 },
        },
        {
          source: 'conversation' as const,
          goto: { kind: 'conversation' as const, sessionId: 'mock-session', project: 'greeter' },
          where: 'the auth refresh conversation',
          line: 112,
          text: 'the retry helper needs a ceiling or it will hammer the endpoint',
          at: { start: 4, end: 9 },
        },
        {
          // The row with nowhere to go, kept deliberately: it is the one whose label reads
          // "copy" rather than "open", and a fixture without it cannot show that difference.
          source: 'dispatch' as const,
          goto: null,
          where: 'builder · 2026-09-03',
          line: null,
          text: 'Add retry-with-backoff to the fetch helper, and cover it with a test.',
          at: { start: 4, end: 9 },
        },
      ],
      looked: ['memory', 'project', 'conversation', 'dispatch'] as const,
      blind: [],
    }
  },

  askAbout: async (agent) => {
    await wait(600)
    return {
      text: agent
        ? `I asked ${agent} to look at the auth change. They have not reported back yet.`
        : 'I am waiting on the reviewer and the tester. Nothing needs you right now.',
      isError: false,
      costUsd: 0.0421,
    }
  },
}

/**
 * Install the fake bridge — and refuse, legibly, when a real one is already there.
 *
 * `contextBridge.exposeInMainWorld` defines its property **non-configurable**, so inside Electron
 * this line throws `TypeError: Cannot redefine property: office` before `app.js` is ever
 * imported. What you get is the chrome with no office in it: a half-drawn shell that looks
 * exactly like the app being broken, with the actual reason only in a console nobody has open.
 * That happened, somebody walked past the window, and asked whether something had gone wrong.
 *
 * The header above already says this file is for a browser and is never loaded by the app. This
 * makes the file say it too, on the screen, at the moment somebody does it anyway.
 */
if (BRIDGE_KEY in window) {
  const said =
    'The dev harness cannot run inside Office Space itself. It replaces the bridge to the main ' +
    'process with a fake one, and the real bridge is already installed here — Electron makes ' +
    'that property permanent, so there is nothing to replace it with. Run `npm run harness` and ' +
    'open the URL it prints; that is what this file is for.'
  document.body.textContent = said
  document.body.setAttribute('style', 'padding:2rem;font:14px/1.6 system-ui;max-width:44rem')
  throw new Error(said)
}

Object.defineProperty(window, BRIDGE_KEY, { value: api })

await import('./app.js')
