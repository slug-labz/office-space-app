/**
 * A held call whose request time will not read has no deadline the office can count to.
 *
 * `timeLeft` read `askedAt` with a bare `Date.parse`, which answers for text that is not a time
 * at all. Measured on Node 22.16.0: `'1'` and `'Sep 16'` parse as days in 2001 and `'32'` as 2032;
 * a time with no zone parses as the machine's local time; `'2026-02-30T00:00:00Z'` rolls over to
 * 2 March. So a request carrying `'1'` was a request asked 25 years ago, and the card said it
 * had been refused when nobody answered (measured on dev at e6fe5cb, in the `.dom` test named
 * below). The gate holding it was still waiting: its deadline is `Date.now() + WAIT_MS`, taken
 * when it wrote the request, and it never reads `askedAt` back (read, `approval-gate.mjs:242`). So
 * an answer on that card still reaches the gate within its wait, although the card said it
 * would not (inferred from that line; not run against a live gate).
 *
 * `time-order.ts` already had the reader for this, `instantOf`, which takes only the ISO shape
 * this app writes and reads a value back at its own offset. The clock now uses it.
 *
 * **Only a hand edit reaches this.** The gate writes `askedAt` with `toISOString()`
 * (`.claude/hooks/approval-gate.mjs`), which always has that shape. This is a guard, not a
 * repair: a request file is JSON on disk, and somebody can edit it.
 *
 * And the sentence had to change with it. `unknown` said *"the gate that asked did not say how
 * long it would wait"*, which is false for a request whose wait was recorded and whose time was
 * not. The two now have their own words.
 *
 * The card that draws the sentence is checked in
 * `a-request-time-that-will-not-read-is-not-a-deadline.dom.test.ts`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { timeLeft, aboutTheClock } from '../src/shared/approval-summary.js'

const NOW = Date.parse('2026-08-26T21:00:05Z')
const FOUR_MINUTES = 240_000

test('text that is not a time in the shape the gate writes starts no clock and ends none', () => {
  // Each of these is a real date to `Date.parse`, which is the whole problem.
  for (const unreadable of ['1', 'Sep 16', '32', '2026-08-26T21:00:00', '2026-02-30T00:00:00Z', '']) {
    assert.deepEqual(
      timeLeft(unreadable, FOUR_MINUTES, NOW),
      { state: 'unknown', why: 'unreadable-time' },
      `${JSON.stringify(unreadable)} was read as a time the request was made`,
    )
  }
})

test('a time with no zone is unreadable in every zone, including the one where it would read true', () => {
  // With no zone, `Date.parse` reads the machine's local time. Where that is UTC, the read-back
  // alone cannot tell, so only the shape's zone rule refuses it. Node reads `process.env.TZ` again
  // when it is assigned, so each zone is tried here rather than whichever one the machine is in.
  const was = process.env['TZ']
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata']) {
      process.env['TZ'] = zone
      assert.deepEqual(
        timeLeft('2026-08-26T21:00:00', FOUR_MINUTES, NOW),
        { state: 'unknown', why: 'unreadable-time' },
        `a time with no zone was read as a time in ${zone}`,
      )
    }
  } finally {
    if (was === undefined) delete process.env['TZ']
    else process.env['TZ'] = was
  }
})

test('a well-formed time with a zone still counts down, at its own offset', () => {
  // The control: the strict reader takes the shape `toISOString()` writes, and an offset.
  assert.deepEqual(timeLeft('2026-08-26T21:00:00.000Z', FOUR_MINUTES, NOW), { state: 'waiting', seconds: 235 })
  assert.deepEqual(timeLeft('2026-08-26T23:00:00+02:00', FOUR_MINUTES, NOW), { state: 'waiting', seconds: 235 })
  assert.deepEqual(timeLeft('2026-08-26T20:00:00Z', FOUR_MINUTES, NOW), { state: 'expired' })
})

test('an unreadable time is said as that, not as a gate that gave no wait', () => {
  const said = aboutTheClock(timeLeft('1', FOUR_MINUTES, NOW)) ?? ''
  assert.match(said, /does not know when this expires/)
  assert.match(said, /time this request was made could not be read/, 'the reason is not the one that happened')
  assert.doesNotMatch(
    said,
    /did not say how long it would wait/,
    'the card blamed the gate for a wait it did record',
  )
  assert.doesNotMatch(said, /refused/, 'a request the gate may still be holding was called refused')
  assert.doesNotMatch(said, /will not reach/, 'the card told somebody an answer would not reach a gate that may still be waiting')
})

test('a gate that gave no wait is still said as that, whatever the time says', () => {
  // The wait is checked first. When the time will not read either, the sentence names the wait
  // only: true, though not the whole of what is missing.
  for (const asked of ['2026-08-26T21:00:00Z', '1']) {
    assert.deepEqual(timeLeft(asked, null, NOW), { state: 'unknown', why: 'no-wait' })
    assert.match(aboutTheClock(timeLeft(asked, null, NOW)) ?? '', /did not say how long it would wait/)
  }
})
