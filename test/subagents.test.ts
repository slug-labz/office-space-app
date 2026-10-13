/**
 * What an employee actually did.
 *
 * The manager's transcript records that work was handed over and what came back. Everything in
 * between happens in the employee's own record, and until this existed the office could only
 * report the summary its employee chose to give — which is taking their word for it, and the
 * second standing order says not to.
 *
 * The rule that shapes the module: **a record we could not read is not an employee who did
 * nothing.** "They did nothing" is a claim about somebody's work, and the office does not get
 * to make it up because a directory would not open.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { latestFor, scanSubagents, type SubagentRun } from '../src/main/subagents.js'
import { encodeCwd } from '../src/main/transcript-store.js'

import { tempDir } from './temp-dir.js'

const CWD = '/work/office'
const SESSION = 'sess-1'

/** Build the layout Claude Code actually writes: a session file, and runs in a folder beside it. */
async function workspace(
  t: TestContext,
  runs: { id: string; meta: unknown; jsonl?: string }[],
  { withSession = true } = {},
): Promise<string> {
  const home = await tempDir(t, 'office-sub-')
  const project = join(home, '.claude', 'projects', encodeCwd(CWD))
  await mkdir(project, { recursive: true })
  if (withSession) await writeFile(join(project, `${SESSION}.jsonl`), '{}\n')

  if (runs.length > 0) {
    const dir = join(project, SESSION, 'subagents')
    await mkdir(dir, { recursive: true })
    for (const run of runs) {
      await writeFile(join(dir, `${run.id}.meta.json`), JSON.stringify(run.meta))
      await writeFile(join(dir, `${run.id}.jsonl`), run.jsonl ?? '{"type":"user"}\n')
    }
  }
  return home
}

const meta = (agentType: string, toolUseId: string, description = 'do the thing') => ({
  agentType,
  description,
  toolUseId,
  spawnDepth: 1,
})

test('a dispatched employee has a record, with the brief and the dispatch it came from', async (t) => {
  const home = await workspace(t, [
    { id: 'agent-aaa', meta: meta('frontend', 'toolu_1', 'Build coming soon page') },
  ])

  const scan = await scanSubagents(SESSION, CWD, home)

  assert.equal(scan.state, 'ok')
  const run = scan.state === 'ok' ? scan.runs[0] : null
  assert.equal(run?.agentType, 'frontend')
  assert.equal(run?.description, 'Build coming soon page')
  assert.equal(run?.toolUseId, 'toolu_1', 'the same id the floor walks them to the office with')
})

test('a session that has dispatched nobody has no runs, and that is not a problem', async (t) => {
  const home = await workspace(t, [])

  assert.deepEqual(await scanSubagents(SESSION, CWD, home), { state: 'none' })
})

test('a session with no transcript at all reports none rather than failing', async (t) => {
  const home = await workspace(t, [], { withSession: false })

  assert.deepEqual(await scanSubagents(SESSION, CWD, home), { state: 'none' })
})

test('a sidecar with no agent or no dispatch is skipped, not guessed at', async (t) => {
  const home = await workspace(t, [
    { id: 'agent-bad', meta: { description: 'orphan' } },
    { id: 'agent-ok', meta: meta('reviewer', 'toolu_2') },
  ])

  const scan = await scanSubagents(SESSION, CWD, home)

  assert.equal(scan.state === 'ok' ? scan.runs.length : -1, 1)
  assert.equal(scan.state === 'ok' ? scan.runs[0]?.agentType : '', 'reviewer')
})

test('one unreadable sidecar does not hide everybody else', async (t) => {
  const home = await workspace(t, [
    { id: 'agent-broken', meta: 'not an object at all' },
    { id: 'agent-fine', meta: meta('tester', 'toolu_3') },
  ])

  const scan = await scanSubagents(SESSION, CWD, home)

  assert.equal(scan.state === 'ok' ? scan.runs.map((r) => r.agentType).join() : '', 'tester')
})

test('the record carries the whole run, not a summary of it', async (t) => {
  const jsonl = '{"type":"user"}\n{"type":"assistant"}\n{"type":"assistant"}\n'
  const home = await workspace(t, [{ id: 'agent-aaa', meta: meta('frontend', 'toolu_1'), jsonl }])

  const scan = await scanSubagents(SESSION, CWD, home)

  assert.equal(scan.state === 'ok' ? scan.runs[0]?.jsonl : '', jsonl)
})

// ─────────────────────────────────────────────────────────── picking the run ──

const run = (agentType: string, at: number): SubagentRun => ({
  agentType,
  description: '',
  toolUseId: `t-${at}`,
  jsonl: '',
  at,
})

test('the newest run for that employee is the one shown', async () => {
  const runs = [run('frontend', 100), run('frontend', 300), run('reviewer', 200)]

  assert.equal(latestFor(runs, 'frontend')?.toolUseId, 't-300')
})

test('an employee who has not been dispatched has nothing, and says so with null', () => {
  assert.equal(latestFor([run('frontend', 1)], 'tester'), null)
})

test('nobody dispatched at all is null rather than an empty run', () => {
  assert.equal(latestFor([], 'frontend'), null)
})

/**
 * ## A directory we could not read is not an employee who did nothing
 *
 * The module states it once, at the top, and every branch below is meant to obey it:
 *
 *     A run we could not read is **not** an employee who did nothing. Every failure below is
 *     reported as a failure, because "they did nothing" is a claim about somebody's work and we
 *     would be making it up.
 *
 * `scanSubagents` distinguishes two reasons `readdir` can fail: `ENOENT`, which genuinely means
 * nobody was dispatched, and everything else, which means we could not look. They differ by one
 * `if`, they return values that render as "no runs" and "could not be read", and only one of
 * them is a statement about what somebody did.
 *
 * The card that shows this is the one somebody opens instead of reading a raw session, so
 * "nothing here" from a directory that was never opened is the second standing order broken by
 * a missing branch.
 */

test('a subagents directory that cannot be read is reported, not read as nobody dispatched', async (t) => {
  const home = await workspace(t, [{ id: 'agent-1', meta: meta('frontend', 't1') }])
  const dir = join(home, '.claude', 'projects', encodeCwd(CWD), SESSION, 'subagents')

  // The control: it reads as runs before the permissions change, so the difference below is the
  // permissions and not the fixture.
  const before = await scanSubagents(SESSION, CWD, home)
  assert.equal(before.state, 'ok', `expected ok before chmod, got ${before.state}`)

  await chmod(dir, 0o000)
  try {
    const after = await scanSubagents(SESSION, CWD, home)

    assert.notEqual(
      after.state,
      'none',
      'a directory this process could not open was reported as an employee who was never ' +
        'dispatched. That is a claim about somebody work, made up out of an EACCES.',
    )
    assert.equal(after.state, 'unreadable', `expected unreadable, got ${after.state}`)
    if (after.state === 'unreadable') {
      assert.ok(after.cause.length > 0, 'the failure was reported with no cause, so it names a symptom and not a reason')
    }
  } finally {
    // Restore, or the temp directory cannot be cleaned up by anything afterwards.
    await chmod(dir, 0o700)
  }
})

test('a sidecar whose run file is missing is skipped, and the others survive', async (t) => {
  // The `.jsonl` is read separately from the `.meta.json`, so one can exist without the other —
  // a run still being written, or a partial copy. One missing file must not take the rest down.
  const home = await workspace(t, [
    { id: 'agent-1', meta: meta('frontend', 't1') },
    { id: 'agent-2', meta: meta('reviewer', 't2') },
  ])
  await rm(join(home, '.claude', 'projects', encodeCwd(CWD), SESSION, 'subagents', 'agent-1.jsonl'))

  const scan = await scanSubagents(SESSION, CWD, home)
  assert.equal(scan.state, 'ok', `expected ok, got ${scan.state}`)
  if (scan.state === 'ok') {
    assert.deepEqual(
      scan.runs.map((r: SubagentRun) => r.agentType),
      ['reviewer'],
      'a sidecar with no run file beside it either took the whole scan down or was reported as a ' +
        'run with nothing in it',
    )
  }
})
