/**
 * The dispatch ledger — the file that turns a crash into an offer.
 *
 * Before this, a run that died mid-dispatch ended at `settle()` in `shared/activity.ts`, which
 * writes *"the turn ended before they reported back"* and stops. True, and the end of it: on the
 * next launch the office had no idea anything had been asked for. It happened twice for real
 * during one long build.
 *
 * So the four things checked hardest here are the four that make the offer possible at all: a
 * dispatch with no outcome **is** reported, a dispatch with one is **not**, a line that cannot be
 * read is **reported rather than dropped**, and a retry carries the previous failure **verbatim**.
 * The third is the office's fourth standing order applied one line at a time — a ledger row we
 * cannot parse may be the record of the very dispatch somebody is looking for, and filtering it
 * out would turn "we cannot read this" into "this never happened", which is the more confident
 * and more wrong of the two.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  EMPTY_LEDGER,
  dispatchesIn,
  ledgerPath,
  loadLedger,
  outcomeIn,
  parseLedger,
  record,
  recordDispatch,
  recordOutcome,
  retryBrief,
  serializeDispatch,
  serializeOutcome,
  unfinished,
  verifyFrom,
  type Dispatch,
  type Outcome,
} from '../src/main/ledger.js'
import { QUIET_AFTER_MS, applyFact, quietFor, quietNotice, EMPTY, type Running } from '../src/shared/activity.js'
import type { ClaudeEvent } from '../src/main/claude/stream.js'

import { tempDir } from './temp-dir.js'

const T0 = '2026-08-25T21:00:00.000Z'
const T1 = '2026-08-25T21:14:00.000Z'

const dispatch = (over: Partial<Dispatch> = {}): Dispatch => ({
  id: 'toolu_01',
  sessionId: 'sess-a',
  project: 'billing',
  employee: 'tester',
  brief: 'run the suite and report what fails',
  verify: '`npm test` exits 0',
  sentAt: T0,
  ...over,
})

const outcome = (over: Partial<Outcome> = {}): Outcome => ({
  id: 'toolu_01',
  kind: 'reported',
  output: 'all 812 tests pass',
  at: T1,
  ...over,
})

const workspace = (t: TestContext) => tempDir(t, 'office-ledger-')

/** A ledger file's text, from records, the way the writer would have left it. */
const written = (...lines: string[]) => lines.join('')

// ──────────────────────────────────────────── (a) sent, and never heard from again ──

test('a dispatch with no outcome is reported unfinished', () => {
  // The whole feature in one assertion. This row is why the file exists: the app died between
  // the dispatch and the result, and the only surviving record of what was asked is this line.
  const ledger = parseLedger(written(serializeDispatch(dispatch())))

  assert.deepEqual(
    unfinished(ledger).map((d) => d.id),
    ['toolu_01'],
  )
  assert.equal(unfinished(ledger)[0]?.brief, 'run the suite and report what fails')
})

test('an unfinished dispatch keeps everything needed to act on it', () => {
  // Not just the id. Resume needs the session, retry needs the brief, and the card needs to say
  // who was asked — a row that came back with only an id would be a card that can offer nothing.
  const ledger = parseLedger(written(serializeDispatch(dispatch())))
  const open = unfinished(ledger)[0]

  assert.equal(open?.sessionId, 'sess-a')
  assert.equal(open?.project, 'billing')
  assert.equal(open?.employee, 'tester')
  assert.equal(open?.verify, '`npm test` exits 0')
})

test('several unfinished dispatches come back oldest first', () => {
  const ledger = parseLedger(
    written(
      serializeDispatch(dispatch({ id: 'a', sentAt: '2026-08-25T20:00:00.000Z' })),
      serializeDispatch(dispatch({ id: 'b', sentAt: '2026-08-25T21:00:00.000Z' })),
    ),
  )

  assert.deepEqual(unfinished(ledger).map((d) => d.id), ['a', 'b'], 'the one that has waited longest is first')
})

test('a workspace that has never dispatched anything has nothing unfinished', () => {
  assert.deepEqual(unfinished(EMPTY_LEDGER), [])
})

// ─────────────────────────────────────────────────── (b) sent, and it came back ──

test('a dispatch with an outcome is not unfinished', () => {
  const ledger = parseLedger(written(serializeDispatch(dispatch()), serializeOutcome(outcome())))

  assert.deepEqual(unfinished(ledger), [], 'it reported back — there is nothing to offer')
})

test('a dispatch that FAILED is settled too — a failure is an ending', () => {
  // The distinction that matters: "it failed" and "we never heard" are different states, and
  // only the second one is unfinished. A failed task has an answer, and it is a bad one.
  const ledger = parseLedger(
    written(serializeDispatch(dispatch()), serializeOutcome(outcome({ kind: 'failed', output: 'exit 1' }))),
  )

  assert.deepEqual(unfinished(ledger), [])
})

test('a dropped dispatch stays dropped across a restart', () => {
  // `drop` writes a line rather than deleting one, so the ledger still says the work was asked
  // for. What it must not do is offer the same card again next launch.
  const ledger = parseLedger(
    written(serializeDispatch(dispatch()), serializeOutcome(outcome({ kind: 'dropped', output: 'nobody is waiting' }))),
  )

  assert.deepEqual(unfinished(ledger), [])
  assert.equal(ledger.sent.length, 1, 'the record of what was asked survives being dropped')
})

test('an outcome for a dispatch nobody wrote down settles nothing and breaks nothing', () => {
  const ledger = parseLedger(written(serializeOutcome(outcome({ id: 'never-sent' }))))

  assert.deepEqual(unfinished(ledger), [])
  assert.deepEqual(ledger.torn, [], 'a stray outcome is a readable line, just an orphaned one')
})

/*
 * A duplicate id.
 *
 * `unfinished` states in a comment that it keeps the **first** of two records sharing an id, and
 * gives the reason: two dispatches cannot share a `tool_use` id, so a second one means the file
 * was edited or two ledgers were concatenated. Keeping the earlier is the reading that cannot
 * invent a brief nobody sent — the later copy is the one whose provenance is unknown.
 *
 * That rule was stated deliberately and had no test, which is the same shape as the four guards
 * this repository has already caught enforcing something weaker than they described. A rule with
 * a reason written next to it and nothing checking it is a comment, not behaviour.
 */

test('a duplicate id keeps the FIRST record — the later copy cannot be trusted to be real', () => {
  // The briefs differ so that "keeps the first" and "keeps the last" are distinguishable. If they
  // matched, an implementation that kept either would pass and the rule would be untested again.
  const ledger = parseLedger(
    written(
      serializeDispatch(dispatch({ brief: 'the brief that was actually sent' })),
      serializeDispatch(dispatch({ brief: 'a brief from a file of unknown provenance' })),
    ),
  )

  const open = unfinished(ledger)

  assert.equal(open.length, 1, 'one id is one dispatch, however many times the file says it')
  assert.equal(
    open[0]?.brief,
    'the brief that was actually sent',
    'offering the later copy would put a brief in front of the user that nobody here dispatched',
  )
})

test('a settled id stays settled even when the outcome sits between the two copies', () => {
  // What a concatenated ledger actually looks like: a whole run, then the head of another. The
  // dedupe has to survive the outcome arriving in the middle, because that is where it lands.
  const ledger = parseLedger(
    written(
      serializeDispatch(dispatch()),
      serializeOutcome(outcome()),
      serializeDispatch(dispatch({ brief: 'the same work, recorded twice' })),
    ),
  )

  assert.deepEqual(unfinished(ledger), [], 'it came back — a second copy of the ask does not un-answer it')
})

test('a duplicate does not swallow the dispatch after it', () => {
  // Guards the loop rather than the rule: an implementation that stopped at the first repeat, or
  // deduped by position instead of by id, would lose real outstanding work and still pass the
  // test above.
  const ledger = parseLedger(
    written(
      serializeDispatch(dispatch({ id: 'toolu_01' })),
      serializeDispatch(dispatch({ id: 'toolu_01', brief: 'the duplicate' })),
      serializeDispatch(dispatch({ id: 'toolu_02', brief: 'a different task nobody has answered' })),
    ),
  )

  assert.deepEqual(
    unfinished(ledger).map((d) => d.id),
    ['toolu_01', 'toolu_02'],
    'oldest first, one row per id, and the row after a duplicate is still outstanding',
  )
})

// ──────────────────────────────────────── (c) a line we could not read is reported ──

test('a torn line is reported, never silently dropped', () => {
  // Absent is not empty, one line at a time. The process died part-way through a write, or
  // something else appended to the file; either way the row that will not parse may be the
  // record of the dispatch somebody is looking for.
  const ledger = parseLedger(
    written(serializeDispatch(dispatch()), '{"line":"sent","id":"toolu_02","emplo\n'),
  )

  assert.equal(ledger.torn.length, 1, 'dropping it would say the dispatch never happened')
  assert.equal(ledger.torn[0]?.at, 2, 'named by line number, so it can be found in the file')
  assert.match(ledger.torn[0]?.text ?? '', /toolu_02/, 'kept verbatim, so it can be read by eye')
  assert.equal(ledger.sent.length, 1, 'the rows that DID parse are still there')
})

test('a torn line does not cost the rows around it', () => {
  const ledger = parseLedger(
    written(
      serializeDispatch(dispatch({ id: 'before' })),
      'not json at all\n',
      serializeDispatch(dispatch({ id: 'after' })),
    ),
  )

  assert.deepEqual(ledger.sent.map((d) => d.id), ['before', 'after'])
  assert.equal(ledger.torn.length, 1)
})

test('a line naming a kind we do not understand is torn, not ignored', () => {
  // A row from a newer build. We cannot say what it means, and a reader that skips it has
  // decided it means nothing — which is a claim, not a reading.
  const ledger = parseLedger('{"line":"reassigned","id":"toolu_09"}\n')

  assert.equal(ledger.torn.length, 1)
  assert.match(ledger.torn[0]?.cause ?? '', /unknown line kind/)
})

test('a row with no id is torn — there is nothing to tie a result to', () => {
  const ledger = parseLedger('{"line":"sent","employee":"tester"}\n')

  assert.equal(ledger.sent.length, 0)
  assert.equal(ledger.torn.length, 1)
})

test('an outcome naming a kind we do not recognise reads as failed, never as reported', () => {
  // The safe direction. A row we cannot interpret must not be shown as work that landed.
  const ledger = parseLedger('{"line":"outcome","id":"toolu_01","kind":"partially-ish","output":"?"}\n')

  assert.equal(ledger.outcomes[0]?.kind, 'failed')
})

test('a trailing newline is how a file ends, not a torn line', () => {
  const ledger = parseLedger(written(serializeDispatch(dispatch())))

  assert.deepEqual(ledger.torn, [])
})

// ──────────────────────────────────── (d) a retry carries the failure with it ──

test('retryBrief includes the failure output verbatim', () => {
  // The point of the whole function. Retrying used to mean a person scrolling back through a
  // transcript to find the error and paste it in, and the usual result was a re-dispatch that
  // repeated the instruction with no mention of how it had already failed.
  //
  // ## Why this fixture is sixty lines and not three
  //
  // It was three — 144 characters — and it could not fail. Found by the second session on the
  // night this landed, by mutating the source rather than reading it:
  //
  //     failureOutput.slice(0, 200)                        -> 40/40 PASS
  //     failureOutput.split('\n').slice(0, 50).join('\n')   -> 40/40 PASS
  //     failureOutput.split('\n').map((l) => l.trim())      -> 1 FAIL
  //
  // The assertion was always right; the fixture was too small to exercise it. It caught
  // REFORMATTING — the leading whitespace means trimming breaks the substring — and never
  // touched TRUNCATION, which is the failure mode a real implementation actually has. Nobody
  // writes `.trim()` on a stack trace. Everybody writes "keep the first N lines" the day a 40KB
  // test failure meets a prompt budget.
  //
  // So: long enough that any plausible cut removes something, and the assertion names the TAIL —
  // because the end is what a summariser drops, and the end is where the assertion that failed
  // is written.
  const lastLine = '      at Object.<anonymous> (/work/office/test/auth.test.ts:512:3)'
  const failure = [
    'FAIL test/auth.test.ts',
    ...Array.from({ length: 58 }, (_, i) => `  at frame ${i} (/work/office/src/main/session.ts:${100 + i}:7)`),
    lastLine,
  ].join('\n')

  const composed = retryBrief(dispatch(), failure)

  assert.ok(composed.includes(failure), 'a paraphrased stack trace is not a stack trace')
  assert.ok(
    composed.includes(lastLine),
    'the end of the failure is the part a summariser drops, and the part that names the assertion',
  )
})

test('a retry carries the original brief and the VERIFY that was set', () => {
  const composed = retryBrief(dispatch(), 'exit 1')

  assert.ok(composed.includes('run the suite and report what fails'), 'the task itself must survive')
  assert.ok(composed.includes('`npm test` exits 0'), 'the check the work is settled by')
  assert.ok(composed.includes('toolu_01'), 'names the attempt it is repeating')
})

test('a retry of a dispatch that had no VERIFY does not invent one', () => {
  // Standing order 2 says the harness checks a real condition. A composed VERIFY would be this
  // function writing the check rather than carrying it.
  const composed = retryBrief(dispatch({ verify: null }), 'exit 1')

  assert.ok(!composed.includes('VERIFY'), 'no check was recorded, so none is claimed')
})

test('a failure with no text at all still composes something honest', () => {
  // The commonest case after a crash: nothing came back, so there is nothing to quote. The
  // brief still has to say that, rather than pretending an error message existed.
  const composed = retryBrief(dispatch(), 'Nothing came back. No result was ever recorded.')

  assert.ok(composed.includes('Nothing came back. No result was ever recorded.'))
})

// ──────────────────────────────────────────────────── reading a brief for its check ──

test('a VERIFY line in a brief is found however it was decorated', () => {
  assert.equal(verifyFrom('do the thing\nVERIFY: `npm test` exits 0'), '`npm test` exits 0')
  assert.equal(verifyFrom('## VERIFY\n'), null, 'a heading with nothing after it states no condition')
  assert.equal(verifyFrom('- **VERIFY** — `npm run build` exits 0'), '`npm run build` exits 0')
})

test('prose that merely mentions verifying is not a VERIFY condition', () => {
  assert.equal(verifyFrom('please verify the output looks right'), null)
})

// ─────────────────────────────────────────────────────────── from the event stream ──

const assistant = (blocks: readonly Record<string, unknown>[]): ClaudeEvent =>
  ({ kind: 'assistant', model: 'opus', blocks }) as unknown as ClaudeEvent

test('a Task call is written down with the whole prompt, not the summary line', () => {
  // The floor shows `description` because it needs one line for a bubble. A re-dispatch needs
  // the instruction, and sending back only the summary would hand somebody a task with its body
  // removed.
  const found = dispatchesIn(
    assistant([
      {
        type: 'tool_use',
        id: 'toolu_77',
        name: 'Task',
        input: {
          subagent_type: 'builder',
          description: 'add the ceiling',
          prompt: 'add the retry ceiling\nVERIFY: `npm test` exits 0',
        },
      },
    ]),
    { sessionId: 'sess-a', project: 'billing' },
    T0,
  )

  assert.equal(found.length, 1)
  assert.equal(found[0]?.employee, 'builder')
  assert.match(found[0]?.brief ?? '', /add the retry ceiling/)
  assert.equal(found[0]?.verify, '`npm test` exits 0', 'read out of the brief, since Task has no field for it')
})

test('an ordinary tool call is not a dispatch', () => {
  const found = dispatchesIn(
    assistant([{ type: 'tool_use', id: 'toolu_78', name: 'Read', input: { file_path: '/x' } }]),
    { sessionId: 'sess-a', project: '' },
    T0,
  )

  assert.deepEqual(found, [])
})

test("the launch receipt is NOT an outcome — that is the bug this ledger must survive", () => {
  // `run_in_background` defaults to true, so a dispatch's own `tool_result` arrives within
  // milliseconds saying the agent was launched. Writing an outcome for it would mark every
  // dispatch settled the instant it was sent, and the ledger would be empty at exactly the
  // moment it was needed.
  const receipt = {
    kind: 'user',
    blocks: [{ type: 'tool_result', tool_use_id: 'toolu_77', content: 'Async agent launched successfully' }],
  } as unknown as ClaudeEvent

  assert.equal(outcomeIn(receipt, T1), null)
})

test('the real completion is an outcome, and its status is reported rather than read charitably', () => {
  const done = {
    kind: 'task-finished',
    toolUseId: 'toolu_77',
    taskId: 't1',
    status: 'completed',
    summary: 'added the ceiling',
    tokens: null,
    durationMs: null,
  } as unknown as ClaudeEvent

  const stopped = { ...(done as object), status: 'cancelled', summary: null } as unknown as ClaudeEvent

  assert.equal(outcomeIn(done, T1)?.kind, 'reported')
  assert.equal(outcomeIn(stopped, T1)?.kind, 'failed', 'a task that stopped is not a task that reported')
  assert.match(outcomeIn(stopped, T1)?.output ?? '', /cancelled/, 'the status survives into the record')
})

// ───────────────────────────────────────────────────────────────────────── io ──

test('a workspace with no ledger reads as missing, not as an error', async (t) => {
  const root = await workspace(t)

  assert.deepEqual(await loadLedger(root), { state: 'missing' })
})

test('a dispatch survives being written and read back', async (t) => {
  const root = await workspace(t)
  const wrote = await recordDispatch(root, dispatch())
  assert.equal(wrote.ok, true)

  const state = await loadLedger(root)

  assert.equal(state.state, 'ok')
  assert.deepEqual(state.state === 'ok' ? unfinished(state.ledger).map((d) => d.id) : [], ['toolu_01'])
})

test('an outcome written after the dispatch settles it', async (t) => {
  const root = await workspace(t)
  await recordDispatch(root, dispatch())
  await recordOutcome(root, outcome())

  const state = await loadLedger(root)

  assert.equal(state.state, 'ok')
  assert.deepEqual(state.state === 'ok' ? unfinished(state.ledger) : [dispatch()], [])
})

test('writing twice leaves two whole lines rather than one torn one', async (t) => {
  // The reason every append rewrites the file and renames it over the old one. `rename(2)` is
  // atomic, so a crash leaves the whole old file or the whole new one — never half a record.
  const root = await workspace(t)
  await recordDispatch(root, dispatch({ id: 'one' }))
  await recordDispatch(root, dispatch({ id: 'two' }))

  const ledger = parseLedger(await readFile(ledgerPath(root), 'utf8'))

  assert.deepEqual(ledger.sent.map((d) => d.id), ['one', 'two'])
  assert.deepEqual(ledger.torn, [])
})

test('appending to a ledger with a torn line in it keeps the torn line', async (t) => {
  // The existing text is carried across byte for byte. A row we cannot understand survives us
  // untouched and is still reported to whoever reads the file next.
  const root = await workspace(t)
  await mkdir(join(root, '.office-space'), { recursive: true })
  await writeFile(ledgerPath(root), '{"line":"sent","id":"half\n')

  await recordDispatch(root, dispatch({ id: 'later' }))
  const state = await loadLedger(root)

  assert.equal(state.state, 'ok')
  assert.equal(state.state === 'ok' ? state.ledger.torn.length : 0, 1, 'still reported after the write')
  assert.deepEqual(state.state === 'ok' ? state.ledger.sent.map((d) => d.id) : [], ['later'])
})

test('a file whose last line has no newline does not gain a torn line when appended to', async (t) => {
  const root = await workspace(t)
  await mkdir(join(root, '.office-space'), { recursive: true })
  // A complete record, saved by something that did not end the file with a newline.
  await writeFile(ledgerPath(root), serializeDispatch(dispatch({ id: 'first' })).trimEnd())

  await recordDispatch(root, dispatch({ id: 'second' }))
  const state = await loadLedger(root)

  assert.deepEqual(state.state === 'ok' ? state.ledger.torn : [{ at: 0, text: '', cause: 'unread' }], [])
  assert.deepEqual(state.state === 'ok' ? state.ledger.sent.map((d) => d.id) : [], ['first', 'second'])
})

test('a ledger that cannot be opened is unreadable — NOT a workspace with nothing outstanding', async (t) => {
  const root = await workspace(t)
  await recordDispatch(root, dispatch())
  await chmod(ledgerPath(root), 0o000)

  try {
    const state = await loadLedger(root)
    if (state.state === 'ok') return // running as root; the permission bit means nothing
    assert.equal(state.state, 'unreadable', 'saying "nothing outstanding" here would bury real work')
  } finally {
    await chmod(ledgerPath(root), 0o644)
  }
})

test('a ledger that could not be read is refused, not overwritten', async (t) => {
  // The registry's lesson, applied here before it can cost anything. Rewriting a file whose
  // bytes we never saw would replace a record of outstanding work with whatever is in memory —
  // which is how `sessions.json` once deleted a week of conversations.
  const root = await workspace(t)
  await recordDispatch(root, dispatch({ id: 'the-one-that-matters' }))
  await chmod(ledgerPath(root), 0o000)

  // Asked, not assumed. Running as root the permission bit means nothing, and a test that
  // treated a successful write as "must be root" would pass just as happily with the guard
  // deleted — which is precisely the mutation it exists to catch.
  const blocked = await readFile(ledgerPath(root), 'utf8').then(
    () => false,
    () => true,
  )

  let wrote
  try {
    wrote = await recordDispatch(root, dispatch({ id: 'the-new-one' }))
  } finally {
    await chmod(ledgerPath(root), 0o644)
  }

  if (!blocked) return // genuinely root: nothing was unreadable, so there was nothing to refuse

  assert.equal(wrote.ok, false, 'an unreadable ledger must never be treated as a fresh start')
  assert.match(wrote.ok === false ? wrote.reason : '', /could not be read/)

  const state = await loadLedger(root)
  assert.deepEqual(
    state.state === 'ok' ? state.ledger.sent.map((d) => d.id) : ['LOST'],
    ['the-one-that-matters'],
    'the refused write left the original record exactly where it was',
  )
})

test('the ledger lives beside the session registry, under the gitignored state directory', async (t) => {
  const root = await workspace(t)

  assert.equal(ledgerPath(root), join(root, '.office-space', 'dispatches.jsonl'))
})

// ────────────────────────────────────────────────────────────── the whole chain ──

test('a dispatch, a crash, and the offer that comes back', async (t) => {
  // The path the app actually walks, joined end to end. Each piece is checked above; this is the
  // join between them, which is where a mismatch in the contract would otherwise hide — and it
  // is the exact sequence that produced nothing but a shrug twice during one long build.
  const root = await workspace(t)

  // 1. The manager dispatches. Written down before anything can come back.
  await record(
    root,
    { sessionId: 'sess-a', project: 'billing' },
    assistant([
      {
        type: 'tool_use',
        id: 'toolu_99',
        name: 'Task',
        input: {
          subagent_type: 'builder',
          description: 'add the ceiling',
          prompt: 'add the retry ceiling to the dispatcher\nVERIFY: `npm test` exits 0',
        },
      },
    ]),
    T0,
  )

  // 2. The launch receipt arrives milliseconds later. It is not an answer, and must settle nothing.
  await record(
    root,
    { sessionId: 'sess-a', project: 'billing' },
    { kind: 'user', blocks: [{ type: 'tool_result', tool_use_id: 'toolu_99' }] } as unknown as ClaudeEvent,
    T0,
  )

  // 3. The app dies. Nothing else is written — which is the whole point of writing step 1 early.

  // 4. Next launch: the office reads the file it left behind.
  const state = await loadLedger(root)
  assert.equal(state.state, 'ok')
  const open = state.state === 'ok' ? unfinished(state.ledger) : []

  assert.equal(open.length, 1, 'the dispatch survived the crash that lost the run')
  assert.equal(open[0]?.employee, 'builder')
  assert.equal(open[0]?.sessionId, 'sess-a', 'resume knows which conversation to re-open')
  assert.equal(open[0]?.verify, '`npm test` exits 0')

  // 5. Retry composes the re-dispatch, carrying what there is to carry — which here is the fact
  //    that nothing came back at all.
  const composed = retryBrief(open[0]!, 'Nothing came back. No result was ever recorded.')
  assert.ok(composed.includes('add the retry ceiling to the dispatcher'))
  assert.ok(composed.includes('Nothing came back. No result was ever recorded.'))

  // 6. Drop settles it, and the offer does not come back on the launch after that.
  await recordOutcome(root, { id: 'toolu_99', kind: 'dropped', output: 'nobody is waiting', at: T1 })
  const after = await loadLedger(root)
  assert.deepEqual(after.state === 'ok' ? unfinished(after.ledger) : ['STILL OFFERED'], [])
})

// ─────────────────────────────────────────────────────────────────── the watchdog ──

const running = (over: Partial<Running> = {}): Running => ({
  who: 'tester',
  brief: 'run the suite',
  doing: 'Bash',
  since: T0,
  lastAt: T0,
  toolUseId: 'toolu_01',
  ...over,
})

test('a dispatch we heard from recently is not quiet', () => {
  const now = Date.parse(T0) + QUIET_AFTER_MS - 1000

  assert.equal(quietFor(running(), now), null, 'firing on healthy dispatches trains people to ignore it')
})

test('a dispatch nothing has arrived for becomes a visible fact', () => {
  const now = Date.parse(T0) + QUIET_AFTER_MS

  assert.equal(quietFor(running(), now), 6)
  assert.equal(quietNotice(6), 'backend has been quiet for 6 minutes')
})

test('the watchdog says quiet, and never says dead', () => {
  // Quiet is a fact: nothing has arrived. Dead is a different claim and the office has not made
  // it — the process may be working perfectly with nothing to say. A word like "stalled" here
  // would be the app asserting a diagnosis it has not made.
  const said = quietNotice(11)

  assert.match(said, /quiet/)
  for (const lie of [/dead/, /stalled/, /hung/, /crashed/, /failed/, /lost/, /stuck/]) {
    assert.ok(!lie.test(said), `the watchdog must not claim more than it knows: ${said}`)
  }
})

test('a tool call from a running employee resets the silence', () => {
  // What makes `lastAt` different from `since`. A four-hour task that is plainly working must
  // not be reported quiet, and a four-minute task nothing has arrived for must be.
  let activity = applyFact(EMPTY, { kind: 'dispatch', toolUseId: 'a', employee: 'tester', brief: null }, T0)
  activity = applyFact(activity, { kind: 'acting', who: 'tester', tool: 'Bash' }, T1)

  const row = activity.state.running[0]!
  assert.equal(row.since, T0, 'still says how long the task has been going')
  assert.equal(row.lastAt, T1, 'and separately, when we last heard anything')
  assert.equal(quietFor(row, Date.parse(T1) + 60_000), null)
})

test('a rebuilt row remembers when it was last heard from', () => {
  // The rebuild trap, and it can go wrong in both directions. `running` rows are recreated
  // whenever anybody is dispatched: a rebuild that stamped `lastAt` with *now* would be the
  // watchdog quietly never firing, and one that reset it to the dispatch time would report a
  // busy employee quiet. Neither is a row anybody could act on.
  let activity = applyFact(EMPTY, { kind: 'dispatch', toolUseId: 'a', employee: 'tester', brief: null }, T0)
  activity = applyFact(activity, { kind: 'acting', who: 'tester', tool: 'Bash' }, T1)

  const later = '2026-08-25T21:30:00.000Z'
  activity = applyFact(activity, { kind: 'dispatch', toolUseId: 'b', employee: 'builder', brief: null }, later)

  const tester = activity.state.running.find((r) => r.who === 'tester')!
  assert.equal(tester.lastAt, T1, 'somebody else being dispatched is not news about this row')
  assert.equal(tester.since, T0, 'and it is still the same task, started when it was started')
})

test('the watchdog is a threshold and nothing else — it removes nobody from the strip', () => {
  // It never kills, retries, or marks anything failed. The row stays exactly where it was; all
  // that changes is that the strip can say how long it has been silent.
  const activity = applyFact(EMPTY, { kind: 'dispatch', toolUseId: 'a', employee: 'tester', brief: null }, T0)
  const hours = Date.parse(T0) + 4 * 60 * 60 * 1000

  assert.equal(activity.state.running.length, 1)
  assert.equal(quietFor(activity.state.running[0]!, hours), 240)
})

test('THE BUG: an office dispatching several employees at once keeps every entry', async (t) => {
  // Measured before the fix, twenty concurrent dispatches: **19 refused with `ENOENT … rename`,
  // one landed, and the file came back with a torn line.** The module's own header promises the
  // opposite — "never a torn line of our own making" — and it was right about the event it was
  // defending against. `rename(2)` is atomic, so a *crash* cannot tear this file. A second
  // *append* could, and an office dispatching more than one employee is the ordinary way this
  // file is used rather than an exotic one.
  //
  // Two faults, and the temp name is only the louder one. `<path>.<pid>.tmp` is one name for
  // every call in the process, so overlapping appends fought over the same scratch file. Under
  // that, this is a read-modify-write: both read the same `existing`, so one line would have
  // been lost even if they had never collided.
  const root = await workspace(t)
  const N = 20

  const results = await Promise.allSettled(
    Array.from({ length: N }, (_, i) => recordDispatch(root, dispatch({ id: `t${i}`, brief: `brief ${i}` }))),
  )

  const refused = results.filter((r) => r.status === 'fulfilled' && !(r.value as { ok: boolean }).ok)
  assert.deepEqual(
    refused.map((r) => (r as PromiseFulfilledResult<{ ok: false; reason: string }>).value.reason.slice(0, 60)),
    [],
    'an append was refused because another was using its temp file',
  )

  const loaded = await loadLedger(root)
  assert.equal(loaded.state, 'ok')
  if (loaded.state !== 'ok') return

  assert.equal(loaded.ledger.torn.length, 0, 'the ledger tore itself')
  assert.equal(loaded.ledger.sent.length, N, 'entries were lost')
  // Every one distinct: a read-modify-write that loses an update drops a line rather than
  // duplicating one, so counting alone would not catch it if two writers wrote the same id.
  assert.equal(new Set(loaded.ledger.sent.map((d) => d.id)).size, N)
})
