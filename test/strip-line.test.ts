/**
 * The line the activity strip shows while it is shut, and the word that was doing two jobs.
 *
 * The status bar's indicator reads `Manager running` when a turn is in flight — that is
 * `SessionPhase`, printed as written. This line counts **dispatched employees**, which is zero
 * for most of a turn, because the manager thinks before it delegates and often never delegates.
 *
 * So the screen said `Manager running` and `0 running` at once, six inches apart, and it was
 * read the only way it can be read: the manager is running at the top left, and the bottom says
 * zero running. **Both numbers were right. One word was doing two jobs.**
 *
 * The zone below already had the answer and used it — its empty state reads *"Nobody is
 * mid-task."* These are the same words on the collapsed bar, which is the half most people see.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { stripLine, type StripCounts } from '../src/shared/strip-line.js'

const counts = (over: Partial<StripCounts> = {}): StripCounts => ({
  working: 0,
  logged: 0,
  waiting: 0,
  unfinished: 0,
  open: false,
  ...over,
})

test('an idle office does not say "0 running"', () => {
  // The whole point. `running` is the manager's word for its own turn, and this line is not
  // about the manager.
  const line = stripLine(counts())

  assert.match(line, /nobody mid-task/)
  assert.doesNotMatch(line, /running/)
})

test('one employee working says so, in the same words as the zone below', () => {
  assert.match(stripLine(counts({ working: 1 })), /1 mid-task/)
  assert.match(stripLine(counts({ working: 4 })), /4 mid-task/)
})

test('calls waiting come first, because they are the only part that is about you', () => {
  const line = stripLine(counts({ waiting: 2, working: 1, logged: 9 }))

  assert.ok(line.indexOf('2 calls need you') < line.indexOf('1 mid-task'), line)
})

test('one call is singular', () => {
  assert.match(stripLine(counts({ waiting: 1 })), /1 call needs you/)
})

test('a ledger that would not open is a problem, never a zero', () => {
  // A count we could not take is not a count of none. Printing `0 never reported back` for an
  // unreadable ledger is the fourth standing order broken on the one line somebody glances at.
  const line = stripLine(counts({ unfinished: 'unreadable' }))

  assert.match(line, /ledger unreadable/)
  assert.doesNotMatch(line, /never reported back/)
})

test('dispatches with no result are named while the panel is shut', () => {
  // So the offer survives somebody closing the panel again.
  assert.match(stripLine(counts({ unfinished: 1 })), /1 never reported back/)
  assert.match(stripLine(counts({ unfinished: 3 })), /3 never reported back/)
})

test('nothing outstanding says nothing about it', () => {
  const line = stripLine(counts({ working: 2, logged: 5 }))

  assert.doesNotMatch(line, /never reported back|needs you|unreadable/)
  assert.equal(line, '▸ 2 mid-task · 5 logged')
})

test('an empty log is not mentioned', () => {
  assert.equal(stripLine(counts()), '▸ nobody mid-task')
})

test('the arrow is the only thing open changes', () => {
  assert.equal(stripLine(counts({ open: true })), '▾ nobody mid-task')
  assert.equal(stripLine(counts({ open: false })), '▸ nobody mid-task')
})
