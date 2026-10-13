/**
 * The rule that keeps taking tool calls out of the transcript honest.
 *
 * Taking the mechanism out of the conversation was asked for four times, and the naive way to
 * do that is to stop rendering it. That makes the panel calmer and the office **unfalsifiable**,
 * which is the one thing this project has refused to ship since its first standing order.
 *
 * So the mechanism is relocated, and these are the tests that say so:
 *
 *   **Nothing is lost.** Every tool call and every result is in the ledger, in order.
 *   **A result nobody asked for is still kept.** An orphan in the record beats a gap in it.
 *   **An empty result is not a missing one.** A command that printed nothing succeeded.
 *   **An unsettled step is not an open one.** A turn that ended while a step was in flight
 *     records a failure, because a mark that waits forever is a spinner with no end.
 *
 * The `Ledger` is tested rather than the DOM because the DOM is the part `styles.css` can
 * change and the ledger is the part the honesty rests on.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Ledger } from '../src/renderer/views/steps.js'

test('every step is kept, in the order it happened', () => {
  const ledger = new Ledger()
  ledger.add('a', 'Read', 'src/main.ts')
  ledger.add('b', 'Bash', 'npm test')
  ledger.settle('a', 'ok', 'file contents')
  ledger.settle('b', 'ok', '731 passing')

  assert.equal(ledger.length, 2)
  assert.deepEqual(
    ledger.all.map((s) => [s.tool, s.outcome]),
    [
      ['Read', 'ok'],
      ['Bash', 'ok'],
    ],
  )
})

test('a result whose call was never seen is recorded, not dropped', () => {
  // The transcript used to render these standalone, on the grounds that an orphan is better
  // than a gap. Moving the mechanism must not quietly change that answer.
  const ledger = new Ledger()
  ledger.settle('never-seen', 'failed', 'exit 1')

  assert.equal(ledger.length, 1)
  assert.equal(ledger.all[0]?.outcome, 'failed')
  assert.equal(ledger.all[0]?.detail, 'exit 1')
})

test('an empty result is a real answer, and different from no result at all', () => {
  const ledger = new Ledger()
  ledger.add('a', 'Bash', 'true')
  ledger.add('b', 'Bash', 'still running')
  ledger.settle('a', 'ok', '')

  // Settled with nothing to say.
  assert.equal(ledger.all[0]?.detail, '')
  assert.equal(ledger.all[0]?.outcome, 'ok')
  // Never settled at all. `null` for both, and the record draws no detail block rather than an
  // empty one — "(no output)" is a claim about a command that has not finished.
  assert.equal(ledger.all[1]?.detail, null)
  assert.equal(ledger.all[1]?.outcome, null)
})

test('one failure anywhere marks the whole turn, and success does not clear it', () => {
  const ledger = new Ledger()
  ledger.add('a', 'Bash', 'npm test')
  ledger.add('b', 'Read', 'README.md')
  assert.equal(ledger.failed, false, 'nothing has come back yet')

  ledger.settle('a', 'failed', 'exit 1')
  assert.equal(ledger.failed, true)

  // A later success must not paint over an earlier failure: the mark says whether anything in
  // this turn went wrong, not whether the last thing did.
  ledger.settle('b', 'ok', 'ok')
  assert.equal(ledger.failed, true)
})

test('a step with no id can still be recorded — replay has no tool_use ids', () => {
  // Restoring a conversation from disk gives entries without the live stream's ids. They still
  // have to reach the record, or a reopened conversation loses its mechanism entirely.
  const ledger = new Ledger()
  ledger.add(undefined, 'Bash', 'npm run build')
  ledger.settle(undefined, 'ok', 'built')

  assert.equal(ledger.length, 1)
  assert.equal(ledger.all[0]?.outcome, 'ok')
})

test('a step nobody saw finish is unknown, not failed', () => {
  // Reopening yesterday's conversation must not turn a turn red for a command that may well
  // have succeeded after the window went away. "It broke" and "nobody was there to see" are
  // different claims, and the more alarming one may not be invented.
  const ledger = new Ledger()
  ledger.add(undefined, 'Bash', 'npm test')
  ledger.settle(undefined, 'unknown', 'still running when the office was closed')

  assert.equal(ledger.all[0]?.outcome, 'unknown')
  assert.equal(ledger.failed, false, 'an interrupted turn is not a failed one')
})
