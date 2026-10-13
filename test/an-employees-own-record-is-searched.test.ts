/**
 * What an employee did can be searched for, or the search says it did not look.
 *
 * `search-a-real-workspace.test.ts` covers employees' turns by writing an `isSidechain` line into
 * the manager's own transcript. Claude Code does not put them there. It files each employee's run
 * beside the session, in the layout `src/main/subagents.ts` describes:
 *
 *     ~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.jsonl
 *     ~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.meta.json
 *
 * Measured by the Honesty Sweep's confirmer on 2026-09-17 across this machine's four office-space
 * project folders, whose runs were written by Claude Code 2.1.231, 2.1.250 and 2.1.258 (repeating
 * their measurement, not re-taking it): none of 21,657 main-transcript lines carries
 * `isSidechain: true`, and all 4,219 lines in the `subagents/` files do. 18 of 105 sessions in the
 * repo's own folder have runs. The app's own workspace registry lists two conversations, and both
 * have a `subagents/` folder, 16 runs between them.
 *
 * So the commands an employee ran, the files they read and the errors they hit are only in their
 * own record; the manager's transcript keeps the brief and the report that came back. If search
 * neither reads the record nor says it did not, the panel answers "Nothing in this workspace
 * matches" about work the office itself dispatched.
 *
 * ## Where this file came from
 *
 * Tests 1–3 descend from the confirmer's, stored on branch `honesty-sweep-evidence-2026-09-17` as
 * `docs/honesty-sweep-2026-09-17/confirm/f43/an-employees-own-record-is-searched.test.ts.txt`
 * (stored as `.txt`, so nothing ran it there). Two changes: its local `temp()` is now `tempDir`,
 * because the guard in `temp-dir.test.ts` holds that helper as the only place under `test/` that
 * makes a temporary directory; and tests 4–6 are new, for the runs `scanSubagents` skips. Reading one level of
 * records and silently dropping the ones inside it that will not open is the same defect one level
 * down, which is what those three pin.
 *
 * The records copy the real ones' shape: `agentId` equal to the file's id, the parent's
 * `sessionId`, and a sidecar with the keys Claude Code writes. Keys only the CLI reads
 * (`requestId`, `promptId`, `toolUseResult` and the like) are left out.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { searchWorkspace } from '../src/main/search.js'
import { scanSubagents } from '../src/main/subagents.js'
import { encodeCwd } from '../src/main/transcript-store.js'
import { summarise } from '../src/shared/search.js'
import { tempDir } from './temp-dir.js'

const SESSION = 'sess-1'
/** Claude Code names a run `agent-<hex>`, and every record in it carries that id as `agentId`. */
const AGENT = 'a'
/** The manager's `Agent` call. The sidecar points back at it. */
const DISPATCH = 'toolu_dispatch_1'
/** The conversation's title, as the registry records it. The label a hit is filed under. */
const TITLE = 'the ledger conversation'

/** The migration the employee ran. It appears once in the whole workspace: in their Bash call. */
const MARKER = 'ledger_backfill_q7x'
/** Words only the manager wrote, in the manager's own transcript. */
const MANAGERS_OWN = 'hand the ledger migration to builder'
/** Words the manager and the employee both used, so a search of both has two places to report. */
const SHARED = 'ledger migration'
/** In a run whose sidecar will not parse, and in one with no sidecar at all. */
const UNREADABLE_MARKER = 'quartz_rollup_z9'
/** In a torn line inside the employee's own record. */
const TORN_MARKER = 'vault_sweep_m4'

type Row = Record<string, unknown>

/** The fields every real record carries, whichever file it sits in. */
function stamp(cwd: string, id: string, i: number, row: Row): Row {
  return {
    parentUuid: i === 0 ? null : `${id}-${i - 1}`,
    uuid: `${id}-${i}`,
    timestamp: new Date(Date.UTC(2026, 8, 17, 9, 0, i)).toISOString(),
    sessionId: SESSION,
    cwd,
    version: '2.1.250',
    entrypoint: 'sdk-cli',
    userType: 'external',
    ...row,
  }
}

const lines = (rows: readonly Row[]): string => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

/** The manager's side: the request, a line of its own, the dispatch, and the report that came back. */
function managerRows(cwd: string): Row[] {
  const rows: Row[] = [
    { type: 'user', message: { role: 'user', content: 'Please run the pending ledger migration.' } },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: `I will ${MANAGERS_OWN}.` }] },
    },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-opus-5',
        content: [
          {
            type: 'tool_use',
            id: DISPATCH,
            name: 'Agent',
            input: {
              description: 'Run the ledger migration',
              prompt: 'Run the pending ledger migration and report back.',
              subagent_type: 'builder',
            },
          },
        ],
      },
    },
    {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: DISPATCH, content: [{ type: 'text', text: 'The migration ran cleanly.' }] }],
      },
    },
  ]
  return rows.map((row, i) => stamp(cwd, 'm', i, { isSidechain: false, ...row }))
}

/** The employee's side: the brief as they got it, the command they ran, what it printed, their report. */
function employeeRows(cwd: string): Row[] {
  const rows: Row[] = [
    { type: 'user', message: { role: 'user', content: 'Run the pending ledger migration and report back.' } },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_emp_1',
            name: 'Bash',
            input: { command: `psql -f migrations/20260917_${MARKER}.sql`, description: 'Apply the migration' },
          },
        ],
      },
    },
    {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_emp_1', content: 'BEGIN\nALTER TABLE\nCOMMIT' }] },
    },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'The migration ran cleanly.' }] },
    },
  ]
  return rows.map((row, i) => stamp(cwd, `e${AGENT}`, i, { isSidechain: true, agentId: AGENT, ...row }))
}

/** Runs the office cannot attach to an employee, and so cannot search. */
interface Unopenable {
  /** A run whose sidecar will not parse: the employee it belongs to is unknown. */
  readonly badSidecar?: boolean
  /** A run file with no sidecar beside it. `scanSubagents` lists sidecars, so it never sees this. */
  readonly noSidecar?: boolean
  /** A sidecar whose run file is not there: a run still being written, or a partial copy. */
  readonly noRecord?: boolean
  /** A torn line inside the employee's own record: readable in part, and only in part. */
  readonly torn?: boolean
}

interface Office {
  readonly root: string
  readonly home: string
  /** The manager's transcript. */
  readonly main: string
  /** Where the employee's records were written. */
  readonly run: string
}

function sidecar(agentType: string): string {
  return JSON.stringify({ agentType, description: 'Run the ledger migration', toolUseId: DISPATCH, spawnDepth: 1, model: 'sonnet' })
}

/**
 * A workspace whose one conversation dispatched `builder`.
 *
 * `where` is the only thing tests 1–3 vary: the employee's records are filed beside the session,
 * as Claude Code files them, or appended to the manager's transcript, as the older test pretends.
 */
async function office(t: TestContext, where: 'subagents' | 'main', broken: Unopenable = {}): Promise<Office> {
  const root = await tempDir(t, 'office-emp-')
  const home = await tempDir(t, 'office-home-')
  await mkdir(join(root, 'memory'), { recursive: true })
  await mkdir(join(root, 'projects', 'greeter'), { recursive: true })
  await mkdir(join(root, '.office-space'), { recursive: true })
  await writeFile(join(root, 'projects', 'greeter', 'PLAN.md'), '# greeter\n\nMove the ledger to the new schema.\n', 'utf8')
  await writeFile(
    join(root, '.office-space', 'dispatches.jsonl'),
    `${JSON.stringify({
      line: 'sent',
      id: DISPATCH,
      sessionId: SESSION,
      project: 'greeter',
      employee: 'builder',
      brief: 'Run the pending ledger migration and report back.',
      verify: null,
      sentAt: '2026-09-17T09:00:02.000Z',
    })}\n`,
    'utf8',
  )

  // The workspace root, as `cwd`: both rows in this machine's own app registry carry it.
  const cwd = root
  await writeFile(
    join(root, '.office-space', 'sessions.json'),
    JSON.stringify({
      version: 1,
      sessions: [
        {
          id: SESSION,
          project: 'greeter',
          cwd,
          agent: 'manager',
          createdAt: '2026-09-17T09:00:00.000Z',
          updatedAt: '2026-09-17T09:05:00.000Z',
          costUsd: null,
          title: TITLE,
          mode: 'building',
        },
      ],
    }),
    'utf8',
  )

  const project = join(home, '.claude', 'projects', encodeCwd(cwd))
  const main = join(project, `${SESSION}.jsonl`)
  await mkdir(project, { recursive: true })

  if (where === 'main') {
    await writeFile(main, lines([...managerRows(cwd), ...employeeRows(cwd)]), 'utf8')
    return { root, home, main, run: main }
  }

  const runs = join(project, SESSION, 'subagents')
  await mkdir(runs, { recursive: true })
  await writeFile(main, lines(managerRows(cwd)), 'utf8')
  const own = lines(employeeRows(cwd))
  await writeFile(
    join(runs, `agent-${AGENT}.jsonl`),
    broken.torn === true ? `${own}{"type":"assistant","isSidechain":true,"message":{"text":"${TORN_MARKER}"\n` : own,
    'utf8',
  )
  await writeFile(join(runs, `agent-${AGENT}.meta.json`), sidecar('builder'), 'utf8')

  if (broken.badSidecar === true) {
    await writeFile(join(runs, 'agent-b.jsonl'), lines([stamp(cwd, 'eb', 0, {
      type: 'assistant',
      isSidechain: true,
      agentId: 'b',
      message: { role: 'assistant', content: [{ type: 'text', text: `I rebuilt ${UNREADABLE_MARKER}.` }] },
    })]), 'utf8')
    await writeFile(join(runs, 'agent-b.meta.json'), '{ "agentType": "test', 'utf8')
  }
  if (broken.noRecord === true) {
    await writeFile(join(runs, 'agent-d.meta.json'), sidecar('tester'), 'utf8')
  }
  if (broken.noSidecar === true) {
    await writeFile(join(runs, 'agent-c.jsonl'), lines([stamp(cwd, 'ec', 0, {
      type: 'assistant',
      isSidechain: true,
      agentId: 'c',
      message: { role: 'assistant', content: [{ type: 'text', text: `I rebuilt ${UNREADABLE_MARKER}.` }] },
    })]), 'utf8')
  }

  return { root, home, main, run: join(runs, `agent-${AGENT}.jsonl`) }
}

test('a command only an employee ran is found, or the search says their record was not read', async (t) => {
  const { root, home, main, run } = await office(t, 'subagents')

  /*
   * Control: this is the layout the office already reads. `scanSubagents` is what the employee
   * card uses, and it finds this run, the dispatch it came from, and the command in it.
   */
  const scan = await scanSubagents(SESSION, root, home)
  assert.equal(scan.state, 'ok', `the employee card's own reader could not see the run: ${JSON.stringify(scan)}`)
  const runs = scan.state === 'ok' ? scan.runs : []
  assert.deepEqual(
    runs.map((r) => [r.agentType, r.toolUseId]),
    [['builder', DISPATCH]],
    'the fixture is not the layout scanSubagents reads, so it says nothing about Claude Code',
  )
  assert.ok(runs[0]?.jsonl.includes(MARKER), 'the run on disk does not hold the marker, so this test would prove nothing')

  /*
   * Control: the marker is nowhere else, the conversation itself was read, and so were the other
   * three sources.
   *
   * Not "nothing is blind": a fix that declares the employees' records unread adds a conversation
   * entry to every search of this workspace, and that is one of the two answers this test accepts.
   */
  assert.equal(
    (await readFile(main, 'utf8')).includes(MARKER),
    false,
    'the marker is in the manager transcript too, so a hit would not show the run was read',
  )
  const own = await searchWorkspace(root, MANAGERS_OWN, home)
  assert.equal(
    own.hits.some((h) => h.source === 'conversation'),
    true,
    `the manager's own words were not found, so the conversation was never read and the harness is broken: ${JSON.stringify(own)}`,
  )
  assert.equal(
    own.blind.some((b) => b.source !== 'conversation'),
    false,
    `memory, projects or the ledger could not be read, so the fixture is broken: ${JSON.stringify(own.blind)}`,
  )

  // The defect.
  const found = await searchWorkspace(root, MARKER, home)
  const hit = found.hits.some((h) => h.source === 'conversation')
  const declared = found.blind.some((b) => b.source === 'conversation')
  assert.ok(
    hit || declared,
    `builder's own record (${run.slice(home.length)}) holds "${MARKER}" in the command it ran, and search ` +
      `returned ${found.hits.length} hits with blind ${JSON.stringify(found.blind)}: it neither read ` +
      `the record nor said it had not, and read ${JSON.stringify(found.looked)} as complete.`,
  )
})

test("the panel does not say nothing matches when the text is in an employee's record", async (t) => {
  const { root, home } = await office(t, 'subagents')

  const found = await searchWorkspace(root, MARKER, home)
  const said = summarise(found, MARKER)
  assert.doesNotMatch(
    said,
    /Nothing in this workspace matches/,
    `The panel said ${JSON.stringify(said)} about a migration builder ran in this workspace's own ` +
      `conversation, whose run Claude Code filed under ${SESSION}/subagents/agent-${AGENT}.jsonl. A ` +
      'person reading it concludes nobody ran that migration.',
  )
})

test('control: the same records inside the manager transcript are found', async (t) => {
  // The older test's layout. The records and the marker are identical; only the file differs.
  const { root, home } = await office(t, 'main')

  const found = await searchWorkspace(root, MARKER, home)
  assert.equal(
    found.hits.some((h) => h.source === 'conversation'),
    true,
    'the employee records were not found even inside the main transcript, so the harness fails, not the layout',
  )
  assert.equal(found.blind.length, 0, `the fixture was not read completely: ${JSON.stringify(found.blind)}`)
  assert.equal(
    summarise(found, MARKER),
    `1 match for "${MARKER}", in 1 place.`,
    'the panel did not report the one match in the conversation',
  )
})

test("a hit in an employee's record is filed under their name, so the count of places still means places", async (t) => {
  const { root, home } = await office(t, 'subagents')

  // Words the manager and the employee both used: two records, and two places to look.
  const found = await searchWorkspace(root, SHARED, home)
  const conversation = found.hits.filter((h) => h.source === 'conversation')
  assert.deepEqual(
    [...new Set(conversation.map((h) => h.where))].sort(),
    [TITLE, `${TITLE} · builder`],
    'a hit in builder\'s own record was filed under the conversation\'s own label, so the panel counts ' +
      'two records as one place and offers to open a view that does not contain the matched line',
  )

  /*
   * `goto: null` — the run has nowhere in this app to open.
   *
   * `main.ts`'s restore handler parses the main transcript with the defaults, which drop every
   * `isSidechain` record, and the employee card shows only the *latest* run for one employee. So a
   * row labelled "open" would close the panel and land on a view that does not contain the line the
   * person clicked. The dispatch rows already take the other branch for the same reason: a control
   * that lands somewhere adjacent is worse than one that copies the reference.
   */
  assert.deepEqual(
    conversation.filter((h) => h.where === `${TITLE} · builder`).map((h) => h.goto),
    [null],
    'a hit inside an employee\'s run offers to open a conversation view that does not show it',
  )
  assert.ok(
    conversation.some((h) => h.where === TITLE && h.goto !== null),
    'the manager\'s own hits lost their destination, so this test broke the thing it is guarding',
  )

  assert.equal(found.blind.length, 0, `the fixture was not read completely: ${JSON.stringify(found.blind)}`)
  assert.equal(
    summarise(found, SHARED),
    `5 matches for "${SHARED}", in 3 places.`,
    'the count above the results changed meaning: the manager\'s transcript, builder\'s own record and ' +
      'the dispatch row are three places, and a run folded into the conversation\'s label makes it two',
  )
})

test('a run the office cannot attach to an employee is declared, not dropped', async (t) => {
  const { root, home } = await office(t, 'subagents', { badSidecar: true, noSidecar: true, noRecord: true })

  /*
   * Control: `scanSubagents` still hands back the run it can read, so this fixture is testing the
   * two it cannot rather than a scan that failed outright.
   */
  const scan = await scanSubagents(SESSION, root, home)
  assert.equal(scan.state, 'ok', `the scan failed outright: ${JSON.stringify(scan)}`)
  assert.deepEqual(
    scan.state === 'ok' ? scan.runs.map((r) => r.agentType) : [],
    ['builder'],
    'one unopenable run took the readable one down with it',
  )

  const found = await searchWorkspace(root, UNREADABLE_MARKER, home)
  const why = found.blind.filter((b) => b.source === 'conversation').map((b) => b.why)
  assert.equal(
    why.some((w) => w.includes('agent-b.jsonl')),
    true,
    `a run whose sidecar will not parse was skipped in silence: blind ${JSON.stringify(found.blind)}`,
  )
  assert.equal(
    why.some((w) => w.includes('agent-c.jsonl')),
    true,
    `a run with no sidecar beside it was never listed, and nothing said so: blind ${JSON.stringify(found.blind)}`,
  )
  assert.equal(
    why.some((w) => w.includes('agent-d.jsonl')),
    true,
    `a sidecar whose run file would not open was passed over in silence: blind ${JSON.stringify(found.blind)}`,
  )
  assert.deepEqual(
    found.blind.filter((b) => b.source === 'conversation').map((b) => b.extent),
    ['some', 'some', 'some'],
    'the conversation was read, and three of its runs were not — reporting that as `none` says the ' +
      'whole conversation went unsearched, above hits found in it',
  )
  assert.equal(
    why.every((w) => w.includes(TITLE)),
    true,
    `a person cannot act on a skipped run without the conversation it belongs to: ${JSON.stringify(why)}`,
  )

  assert.doesNotMatch(
    summarise(found, UNREADABLE_MARKER),
    /Nothing in this workspace matches/,
    'the panel claimed the workspace does not contain text sitting in a run it could not open',
  )
})

test("a torn line in an employee's record is searched and reported, not one or the other", async (t) => {
  const { root, home } = await office(t, 'subagents', { torn: true })

  const found = await searchWorkspace(root, TORN_MARKER, home)
  assert.equal(
    found.hits.some((h) => h.where === `${TITLE} · builder`),
    true,
    'the raw text of a torn line in a run was not searched, so a term inside it is unfindable',
  )
  assert.equal(
    found.blind.some((b) => b.source === 'conversation' && b.why.includes('builder') && b.why.includes('would not parse')),
    true,
    `a run read in part was reported as read in full: blind ${JSON.stringify(found.blind)}`,
  )
})

test('a directory of records this process cannot open is declared against the conversation', async (t) => {
  const { root, home } = await office(t, 'subagents')
  const runs = join(home, '.claude', 'projects', encodeCwd(root), SESSION, 'subagents')

  // The control: the run reads before the permissions change, so what differs below is the
  // permissions and not the fixture. `subagents.test.ts` makes the same distinction one layer down.
  const before = await searchWorkspace(root, MARKER, home)
  assert.equal(before.hits.length > 0, true, `the fixture does not hold the marker: ${JSON.stringify(before)}`)

  await chmod(runs, 0o000)
  try {
    const found = await searchWorkspace(root, MARKER, home)
    assert.equal(
      found.blind.some((b) => b.source === 'conversation' && b.why.includes(TITLE)),
      true,
      'a directory of employees\' records this process could not open was searched as if it held ' +
        `nothing: ${JSON.stringify(found)}`,
    )
    assert.doesNotMatch(
      summarise(found, MARKER),
      /Nothing in this workspace matches/,
      'the panel answered for records it could not open',
    )
  } finally {
    // Before `tempDir`'s removal, which runs after this test and cannot delete a directory at 0o000.
    await chmod(runs, 0o700)
  }
})
