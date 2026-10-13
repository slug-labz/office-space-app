/**
 * Speech bubbles.
 *
 * Almost every test here is the same rule seen from a different angle: **an answer is about a
 * moment, and the moment passes.** An aside takes a second or two, and in that time the
 * character it is about may have finished, been handed something else, or walked away. A
 * bubble that shows the answer anyway is the floor stating something about the session that is
 * no longer true — in words, which is the least deniable form of it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { doingLine, BubbleBoard, NO_ANSWER, situationKey } from '../src/shared/floor/bubbles.js'
import type { Reason, Routine } from '../src/shared/floor/choreography.js'

test('asking puts a bubble up before there is anything to say', () => {
  const board = new BubbleBoard()
  board.ask('reviewer', 'idle')

  assert.equal(board.get('reviewer')?.state, 'asking')
  assert.equal(board.get('reviewer')?.text, '')
})

test('an answer about the situation asked about is shown', () => {
  const board = new BubbleBoard()
  board.ask('reviewer', 'briefing:t1')

  assert.equal(board.answer('reviewer', 'briefing:t1', 'Reading the token refresh.', false), true)
  assert.equal(board.get('reviewer')?.state, 'answered')
  assert.equal(board.get('reviewer')?.text, 'Reading the token refresh.')
})

test('an answer that arrives after the situation moved on is discarded, not shown', () => {
  const board = new BubbleBoard()
  board.ask('reviewer', 'briefing:t1')

  // The subagent came back while the aside was still running; the reviewer is now delivering.
  board.reconcile(() => 'delivering:t1')

  assert.equal(board.answer('reviewer', 'briefing:t1', 'Still reading the auth module.', false), false)
  assert.equal(board.get('reviewer'), null, 'an answer to a question about a past moment is not a bubble')
})

test('an answer that arrives after the bubble was dismissed is discarded', () => {
  const board = new BubbleBoard()
  board.ask('reviewer', 'idle')
  board.clear('reviewer')

  assert.equal(board.answer('reviewer', 'idle', 'Between tasks.', false), false)
  assert.equal(board.get('reviewer'), null)
})

test('asking again replaces the bubble, and the first answer no longer lands', () => {
  const board = new BubbleBoard()
  board.ask('reviewer', 'idle')
  board.ask('reviewer', 'settling')

  assert.equal(board.answer('reviewer', 'idle', 'the old answer', false), false)
  assert.equal(board.answer('reviewer', 'settling', 'the new answer', false), true)
  assert.equal(board.get('reviewer')?.text, 'the new answer')
})

test('a second answer to the same question does not overwrite the first', () => {
  const board = new BubbleBoard()
  board.ask('reviewer', 'idle')
  board.answer('reviewer', 'idle', 'first', false)

  assert.equal(board.answer('reviewer', 'idle', 'second', false), false)
  assert.equal(board.get('reviewer')?.text, 'first')
})

test('a failed aside is shown as failed rather than hidden', () => {
  const board = new BubbleBoard()
  board.ask('manager', 'idle')
  board.answer('manager', 'idle', 'Credit balance too low', true)

  assert.equal(board.get('manager')?.state, 'failed')
  assert.equal(board.get('manager')?.text, 'Credit balance too low', 'shown verbatim, not paraphrased')
})

test('an empty answer says so rather than showing an empty bubble', () => {
  const board = new BubbleBoard()
  board.ask('manager', 'idle')
  board.answer('manager', 'idle', '   ', false)

  assert.equal(board.get('manager')?.state, 'failed')
  assert.equal(board.get('manager')?.text, NO_ANSWER)
})

test('reconcile drops a bubble once its situation has changed', () => {
  const board = new BubbleBoard()
  board.ask('reviewer', 'idle')
  board.answer('reviewer', 'idle', 'Between tasks.', false)

  assert.deepEqual(board.reconcile(() => 'idle'), [], 'nothing changed, so nothing is stale')
  assert.equal(board.get('reviewer')?.text, 'Between tasks.')

  assert.deepEqual(board.reconcile(() => 'briefing:t9'), ['reviewer'])
  assert.equal(board.get('reviewer'), null)
})

test('a bubble still waiting on an answer is dropped when the situation changes', () => {
  const board = new BubbleBoard()
  board.ask('reviewer', 'idle')

  assert.deepEqual(board.reconcile(() => 'settling'), ['reviewer'], 'the question is already out of date')
})

// The board supports several; the floor asks for one at a time because desks are three tiles
// apart and two bubbles would overlap. Keeping the board general is what lets that be the
// view's decision rather than a rule baked in here.
test('several people can have bubbles, and they go stale independently', () => {
  const board = new BubbleBoard()
  board.ask('reviewer', 'briefing:t1')
  board.ask('tester', 'idle')
  board.answer('reviewer', 'briefing:t1', 'Taking a brief.', false)
  board.answer('tester', 'idle', 'Between tasks.', false)

  const dropped = board.reconcile((who) => (who === 'reviewer' ? 'delivering:t1' : 'idle'))

  assert.deepEqual(dropped, ['reviewer'])
  assert.equal(board.get('tester')?.text, 'Between tasks.')
  assert.equal(board.all().length, 1)
})

test('clearAll empties the floor', () => {
  const board = new BubbleBoard()
  board.ask('reviewer', 'idle')
  board.ask('tester', 'idle')
  board.clearAll()

  assert.deepEqual(board.all(), [])
})

// ─────────────────────────────────────────────────────────────── the situation ──

test('an idle character has a stable situation', () => {
  assert.equal(situationKey(null), 'idle')
})

test('two consecutive briefings are different situations', () => {
  const first = situationKey({ name: 'briefing', reason: reason({ toolUseId: 't1' }) })
  const second = situationKey({ name: 'briefing', reason: reason({ toolUseId: 't2' }) })

  assert.notEqual(first, second, 'same routine, different dispatch — the answer does not carry over')
})

test('a routine with no tool call still has a situation', () => {
  assert.equal(situationKey({ name: 'attending', reason: reason() }), 'attending')
})

// ───────────────────────────── what backs the claim that somebody is doing something ──

/*
 * `Reason` says in its own comment that it is carried "so the floor can be audited. Click
 * someone mid-walk and the popup can say *taking a brief from the manager* **and point at the
 * tool call that caused it** — a claim backed by an id in the transcript rather than by the
 * animation looking plausible." `floor-view.ts` said the same in fewer words: *"Never invented —
 * it names the cause."*
 *
 * It returned the summary alone. `Reason.cause` was built in thirteen places and read in none,
 * and the id that makes the claim checkable never reached a surface — on the one screen whose
 * whole premise is that what you are watching actually happened.
 */

/**
 * A routine, as much of one as these two functions look at.
 *
 * `Pick<Routine, …>` rather than a shape written out here. Both functions used to take an inline
 * copy, which is why `Reason.cause` read as unwired even after `doingLine` started using it — the
 * read resolved to the copy. Binding it also caught that `cause` is a union of fact kinds and the
 * copy had widened it to `string`, so `cause: 'nonsense'` would have compiled.
 */
const reason = (over: Partial<Reason> = {}): Reason => ({ summary: 'taking a brief', cause: 'dispatch', ...over })

const routine = (over: Partial<Reason> = {}): Pick<Routine, 'reason'> => ({ reason: reason(over) })

test('the card names the tool call behind what somebody is doing', () => {
  const line = doingLine(routine({ summary: 'taking a brief', cause: 'dispatch', toolUseId: 'toolu_01H' }))

  assert.equal(line.text, 'taking a brief')
  assert.equal(line.trace, 'dispatch · toolu_01H')
})

test('a routine with nothing behind it offers no trace, rather than an empty one', () => {
  // Resting, or a break. There was never a tool call, so an empty trace line would say we lost
  // the evidence instead of that there was none — the fourth standing order, inverted.
  const line = doingLine(routine({ summary: 'at the window', cause: 'idle' }))

  assert.equal(line.text, 'at the window')
  assert.equal(line.trace, null)
})

test('nobody doing anything is at their desk, and claims nothing', () => {
  const line = doingLine(null)

  assert.equal(line.text, 'at their desk')
  assert.equal(line.trace, null)
})

test('the cause is carried, so two summaries that read alike stay distinguishable', () => {
  // `cause` is the kind of the fact — `acting`, `dispatch`, `delivered`. It is not printed on its
  // own because it means nothing to a reader; it earns its place by sitting next to the id, so
  // "which of these three identical-looking walks was the dispatch" has an answer.
  const acting = doingLine(routine({ summary: 'working — Bash', cause: 'acting', toolUseId: 't1' }))
  const dispatch = doingLine(routine({ summary: 'working — Bash', cause: 'dispatch', toolUseId: 't1' }))

  assert.notEqual(acting.trace, dispatch.trace)
})

test('the summary is passed through exactly, never re-worded', () => {
  // The choreographer wrote it from a fact. Paraphrasing here would be the floor describing
  // itself rather than reporting what happened.
  const line = doingLine(routine({ summary: 'back from the meeting', cause: 'delivered', toolUseId: 'm4' }))

  assert.equal(line.text, 'back from the meeting')
})

