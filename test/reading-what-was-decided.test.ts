/**
 * Reading `decided/` off a real filesystem, and the three failures it has to keep apart.
 *
 * `memory.ts` settled this shape and this is deliberately its walk with one directory swapped —
 * absent, unreadable-directory and unreadable-file are three different answers, and the whole
 * value of the panel above it is that they never collapse into each other.
 *
 * Driven against real files rather than a stubbed `readdir`, because two of the three cases *are*
 * errnos and a stub is a place to encode the belief being tested.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { DECIDED_DIR, readDecided } from '../src/main/decided.js'

import { tempDir } from './temp-dir.js'

/** A record shaped the way the gate writes one. */
const record = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    sessionId: 'sess-a',
    toolUseId: 't-1',
    tool: 'Bash',
    input: { command: 'npm test' },
    cwd: '/w',
    agent: 'tester',
    agentId: 'a-1',
    askedAt: '2026-09-04T02:20:00.000Z',
    waitMs: 240_000,
    outcome: 'allowed',
    decidedAt: '2026-09-04T02:20:11.000Z',
    reason: null,
    ...over,
  })

async function workspace(t: TestContext, files: Record<string, string> = {}): Promise<string> {
  const root = await tempDir(t, 'office-decided-')
  await mkdir(join(root, DECIDED_DIR), { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(root, DECIDED_DIR, name), body, 'utf8')
  }
  return root
}

test('a workspace where nothing has been decided is empty, not a problem', async (t) => {
  // The gate creates the directory the first time it files something, so absence really is none —
  // and reporting it as a fault would be the office complaining about the ordinary case.
  const root = await tempDir(t, 'office-decided-')
  assert.deepEqual(await readDecided(root), { decisions: [], unread: [], problem: null, beyond: 0 })
})

test('a directory that will not open is a problem, not an office that decided nothing', async (t) => {
  const root = await workspace(t, { '1.allowed.s.t.decision.json': record() })

  // The control. Without it every assertion here could pass on a reader that always fails.
  assert.equal((await readDecided(root)).decisions.length, 1)

  await chmod(join(root, DECIDED_DIR), 0o000)
  try {
    const report = await readDecided(root)
    assert.equal(report.decisions.length, 0)
    assert.ok(report.problem !== null, 'an unreadable directory came back as an office with no decisions')
    assert.match(report.problem, /could not be opened/)
  } finally {
    // Restored whatever the assertions did, so a failure here does not leave an unreadable
    // directory behind for whatever runs next.
    await chmod(join(root, DECIDED_DIR), 0o755)
  }
})

test('one unreadable record is a named gap, not a failed read', async (t) => {
  // Nine decisions and one unreadable is nine decisions and a named gap. Treating it as a failed
  // read loses the nine; treating it as nothing loses the one.
  const root = await workspace(t, {
    '2.allowed.s.t2.decision.json': record({ toolUseId: 't2' }),
    '1.allowed.s.t1.decision.json': record({ toolUseId: 't1' }),
  })
  await chmod(join(root, DECIDED_DIR, '1.allowed.s.t1.decision.json'), 0o000)
  try {
    const report = await readDecided(root)
    assert.equal(report.decisions.length, 1, 'one unreadable file sank the whole read')
    assert.equal(report.unread.length, 1)
    assert.equal(report.unread[0]?.id, '1.allowed.s.t1')
    assert.equal(report.problem, null, 'a per-file failure was reported as the directory failing')
  } finally {
    await chmod(join(root, DECIDED_DIR, '1.allowed.s.t1.decision.json'), 0o644)
  }
})

test('a file that reads fine and is not one of ours is reported, never dropped', async (t) => {
  /*
   * The deliberate half, and it differs from `tally`'s rule on purpose. Counting names, an
   * unrecognised one must be *skipped* — counting it would claim somebody answered something.
   * Here the file is on disk in the office's own record directory and the panel's subject is what
   * the office can and cannot tell you, so a silently dropped record is the fourth standing order
   * failing on the surface built to serve it.
   */
  const root = await workspace(t, {
    '1.allowed.s.t1.decision.json': 'this is not json',
    '2.sideways.s.t2.decision.json': record(),
    'notes.txt': 'not a record at all',
  })
  const report = await readDecided(root)

  assert.equal(report.decisions.length, 0)
  assert.deepEqual(
    report.unread.map((u) => u.id).sort(),
    ['1.allowed.s.t1', '2.sideways.s.t2'],
    'a broken record or an outcome nobody writes was dropped in silence',
  )
  // And a file that never claimed to be a record is not reported as a broken one — `notes.txt`
  // does not end `.decision.json`, so it was never this directory's business.
  assert.equal(report.unread.some((u) => u.id.includes('notes')), false)
})

test('newest first, and a record with no time cannot claim to be recent', async (t) => {
  // These are events and the question is what happened while you were out, so the most recent is
  // the one somebody is looking for. An undated record sorts last rather than first, because its
  // name makes no claim about when it happened.
  const root = await workspace(t, {
    '1000.allowed.s.a.decision.json': record({ toolUseId: 'a' }),
    '3000.allowed.s.c.decision.json': record({ toolUseId: 'c' }),
    '2000.allowed.s.b.decision.json': record({ toolUseId: 'b' }),
  })
  const report = await readDecided(root)
  assert.deepEqual(report.decisions.map((d) => d.at), [3000, 2000, 1000])
})

test('the record is carried through in the shape the live card reads', async (t) => {
  /*
   * `summarise()` draws both the live approval card and this panel, so what is parsed here has to
   * be what that function expects. A field quietly lost in parsing would show as an empty card
   * rather than an error.
   */
  const root = await workspace(t, { '1.declined.s.t.decision.json': record({ outcome: 'declined', reason: 'Not to that host.' }) })
  const [only] = (await readDecided(root)).decisions

  assert.equal(only?.outcome, 'declined')
  assert.equal(only?.reason, 'Not to that host.')
  assert.equal(only?.request.tool, 'Bash')
  assert.deepEqual(only?.request.input, { command: 'npm test' })
  assert.equal(only?.request.agent, 'tester')
  // Meaningless on a decision already made — the clock it fed has stopped. Carried as `null` so
  // nothing can draw a countdown from a record of something already decided.
  assert.equal(only?.request.waitMs, null)
})

test('only the newest are opened, and the panel is told how many were not', async (t) => {
  /*
   * The finding this cap exists for. The first version of this reader `readdir`'d and then opened
   * every record ever filed — which is exactly what `approval-gate.mjs` argues against at the
   * point of writing: *"a count that had to open every file to bucket it would get slower every
   * night the office ran unattended, which is the night this record exists for."*
   *
   * It degrades in proportion to the usage the feature is for. More unattended nights means more
   * records, so the panel answering "what did I approve last night" would be slowest on the
   * machine that had used it most, on the night with the most to show.
   *
   * 250 records against a cap of 200: the newest 200 open, and `beyond` says 50 so the panel can
   * state its own edge. A window that says how much it is not showing is not a truncation.
   */
  const files: Record<string, string> = {}
  for (let i = 1; i <= 250; i += 1) {
    files[`${1_000_000 + i}.allowed.s.t${i}.decision.json`] = record({ toolUseId: `t${i}` })
  }
  const root = await workspace(t, files)

  const report = await readDecided(root)

  assert.equal(report.decisions.length, 200, 'the reader opened a different number than the cap')
  assert.equal(report.beyond, 50, 'the panel was not told how many records it is not showing')
  // The newest, not an arbitrary 200. `readdir` order is not sorted order, so this is the half
  // that would silently pass on a reader that sliced before sorting.
  assert.equal(report.decisions[0]?.at, 1_000_250)
  assert.equal(report.decisions[199]?.at, 1_000_051)
})

test('a record whose name carries no readable time sorts last, and is not called recent', async (t) => {
  /*
   * Written with a *damaged* name rather than an old-format one, and the first version of this
   * test got that wrong in a way worth keeping.
   *
   * `decided/` did not exist before the gate wrote times into names, so there is no legacy shape
   * here — unlike `missed/`, which has both. The only way a decision record carries no readable
   * time is a name somebody or something damaged: a corrupted prefix, a hand edit, a truncated
   * write. `undated.allowed.…` is that — the outcome still parses, the time does not.
   *
   * The first fixture used `sess-old.t-9.decision.json`, which fails **outcome** parsing too, so
   * it was correctly filed as unreadable and the test failed for the right reason. Kept as a
   * damaged-time case because that one is reachable and the old-format case is not.
   */
  const root = await workspace(t, {
    'undated.allowed.s.t-9.decision.json': record({ toolUseId: 't-9' }),
    '5000.allowed.s.a.decision.json': record({ toolUseId: 'a' }),
  })
  const report = await readDecided(root)

  assert.equal(report.decisions.length, 2)
  assert.equal(report.decisions[0]?.at, 5000)
  assert.equal(report.decisions[1]?.at, null)
  assert.equal(report.beyond, 0)
})
