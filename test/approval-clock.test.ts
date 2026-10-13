/**
 * How long is left to answer a held call, and the three answers.
 *
 * The gate refuses an unanswered request after four minutes. The card never said so, so somebody
 * could read a held command carefully, decide, and click into a request that had already been
 * refused — the employee still blocked, the missed count up by one, and nothing on screen having
 * mentioned a deadline. `askedAt` was recorded and read only for sort order; it is one half of a
 * clock whose other half nobody had written down.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { timeLeft, aboutTheClock } from '../src/shared/approval-summary.js'

const ASKED = '2026-09-01T03:00:00.000Z'
const at = (seconds: number): number => Date.parse(ASKED) + seconds * 1000
const FOUR_MINUTES = 240_000

test('the office does not invent a deadline it was not told', () => {
  /*
   * The important one. A gate that did not record its wait means the office does not know when
   * this expires — and the default is not a safe guess, because `OFFICE_APPROVAL_WAIT_MS` can
   * lower it. A countdown from a guessed deadline is worse than no countdown: it is believed.
   */
  assert.deepEqual(timeLeft(ASKED, null, at(10)), { state: 'unknown', why: 'no-wait' })
})

test('not knowing is said out loud, because silence already means something else', () => {
  /*
   * The first version returned `null` here and that was wrong. The countdown only appears under
   * a minute, so on most cards there is no clock and that means *plenty of time*. Using the same
   * silence for *the office does not know* makes the two read identically — standing order 4
   * landing inside the feature built to answer it.
   *
   * Teammate 3 caught this: "no clock at all would look exactly like the four minutes not
   * running."
   */
  const said = aboutTheClock({ state: 'unknown', why: 'no-wait' })
  assert.match(said ?? '', /does not know when this expires/)
  // And it must not imply a deadline it cannot name.
  assert.doesNotMatch(said ?? '', /\d+ (second|minute)/)
})

test('a timestamp that will not parse is also not knowing, not a fresh four minutes', () => {
  // Reading it as `now` would start the countdown at the moment somebody happened to look.
  assert.deepEqual(timeLeft('not a date', FOUR_MINUTES, at(10)), { state: 'unknown', why: 'unreadable-time' })
})

test('it is quiet while there is plenty of time', () => {
  // A number that runs for the whole four minutes is one somebody learns to stop seeing.
  assert.equal(aboutTheClock(timeLeft(ASKED, FOUR_MINUTES, at(30))), null)
  assert.equal(aboutTheClock(timeLeft(ASKED, FOUR_MINUTES, at(179))), null)
})

test('it speaks up once the number would change what somebody does', () => {
  const said = aboutTheClock(timeLeft(ASKED, FOUR_MINUTES, at(210)))
  assert.match(said ?? '', /30 seconds left to answer/)
})

test('one second is not "1 seconds"', () => {
  assert.match(aboutTheClock(timeLeft(ASKED, FOUR_MINUTES, at(239))) ?? '', /^1 second left/)
})

test('past the deadline it says the button no longer does what it looks like it does', () => {
  /*
   * Not "expired" — that is a status, and what a person needs is what it means for the thing
   * they are about to click. The request was refused when nobody answered; pressing Allow now
   * writes a verdict no hook is left to read.
   */
  const said = aboutTheClock(timeLeft(ASKED, FOUR_MINUTES, at(241)))
  assert.match(said ?? '', /refused when nobody answered/)
  assert.match(said ?? '', /will not reach them/)
})

test('the boundary second is spent, not remaining', () => {
  // At exactly the deadline the hook has stopped waiting. Showing "0 seconds left" would be an
  // offer to answer something already decided.
  assert.deepEqual(timeLeft(ASKED, FOUR_MINUTES, at(240)), { state: 'expired' })
})

test('a shortened wait is honoured, because the hook is what knows it', () => {
  // `OFFICE_APPROVAL_WAIT_MS` lowers the gate's wait. A constant on this side would disagree with
  // the running hook the first time anybody set it — which is why the number travels with the
  // request rather than being written down twice.
  assert.deepEqual(timeLeft(ASKED, 20_000, at(25)), { state: 'expired' })
  assert.match(aboutTheClock(timeLeft(ASKED, 20_000, at(5))) ?? '', /15 seconds left/)
})
