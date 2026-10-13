/**
 * The verdict the delegation eval reaches, and the one it used to miss.
 *
 * `src/main/cli/eval.ts` ends in `await main()` at module scope, so importing it runs it — real
 * `claude` calls, real money. No test could reach a line of it, and it is the machinery that
 * answers *"did the manager actually delegate"*, which is the largest behavioural claim in the
 * product. So the decisions moved to `src/shared/eval.ts` and this aims at those.
 *
 * The pair worth reading first is the two off-roster tests. The check existed; it printed a
 * warning beside a scenario it had already called `ok`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { offRoster, tally, verdict } from '../src/shared/eval.js'
import type { Observed } from '../src/shared/eval.js'

const STAFF = new Set(['builder', 'reviewer', 'tester'])

const ran = (over: Partial<Observed> = {}): Observed => ({
  dispatched: [],
  isError: false,
  stoppedOnPurpose: false,
  ...over,
})

// ────────────────────────────────────────────────────── did it do the thing ────

test('dispatching when a dispatch was wanted passes', () => {
  const v = verdict('dispatch', ran({ dispatched: ['builder'], isError: true, stoppedOnPurpose: true }), STAFF)
  assert.equal(v.failed, false)
  assert.equal(v.note, null)
})

test('a run we stopped ourselves is not a failed run', () => {
  // The reason `stoppedOnPurpose` exists. Every correct dispatch is interrupted the moment it is
  // seen, and an interrupted run reports `isError` — so without this every pass is a failure.
  const stopped = verdict('dispatch', ran({ dispatched: ['builder'], isError: true, stoppedOnPurpose: true }), STAFF)
  const died = verdict('dispatch', ran({ dispatched: ['builder'], isError: true, stoppedOnPurpose: false }), STAFF)

  assert.equal(stopped.failed, false)
  assert.equal(died.failed, true, 'a run that died on its own is a failed run, dispatch or not')
  assert.equal(died.note, 'the run itself failed')
})

test('answering when a dispatch was wanted fails, and says nothing it cannot support', () => {
  const v = verdict('dispatch', ran({ dispatched: [] }), STAFF)
  assert.equal(v.failed, true)
  assert.equal(v.note, null, 'the note is for what the scenario line cannot already say')
})

test('dispatching when the answer was the point fails', () => {
  const v = verdict('answer', ran({ dispatched: ['builder'] }), STAFF)
  assert.equal(v.failed, true)
})

test('answering when the answer was the point passes', () => {
  assert.equal(verdict('answer', ran(), STAFF).failed, false)
})

// ─────────────────────────────────────────── the pass it had not observed ────

test('a dispatch to somebody with no desk is not a dispatch', () => {
  // What this file exists for. The check was there and printed `!! ghost is not on this roster`
  // beside a scenario `failed` had already been decided for — so it was reported `ok`, counted
  // in the tally, and left the exit code at zero. The eval's own comment says why that is wrong:
  // such a dispatch "looks, from the floor, exactly like no dispatch at all".
  const v = verdict('dispatch', ran({ dispatched: ['ghost'] }), STAFF)

  assert.equal(v.failed, true, 'a dispatch nobody can receive was being counted as a dispatch')
  assert.match(v.note ?? '', /ghost/)
  assert.match(v.note ?? '', /not on this roster/)
})

test('one absent name dispatched to three times is one mistake', () => {
  const v = verdict('dispatch', ran({ dispatched: ['ghost', 'ghost', 'ghost'] }), STAFF)
  assert.equal((v.note ?? '').match(/ghost/g)?.length, 1, 'printed three times it reads as three')
})

test('a real dispatch alongside an absent one still fails', () => {
  // The half that would slip through a check written as "did anybody real get it".
  const v = verdict('dispatch', ran({ dispatched: ['builder', 'ghost'] }), STAFF)
  assert.equal(v.failed, true)
  assert.match(v.note ?? '', /ghost/)
  assert.doesNotMatch(v.note ?? '', /builder/, 'builder has a desk; naming it would read as blame')
})

test('an empty roster fails every dispatch rather than passing them all', () => {
  // A workspace the eval could not read gives an empty set, and the difference between "nobody
  // is on the roster" and "everybody is" decides whether this reports a clean sweep or a total
  // failure. Absent is not empty: it fails.
  const v = verdict('dispatch', ran({ dispatched: ['builder'] }), new Set())
  assert.equal(v.failed, true)
})

test('a failed run outranks an off-roster name', () => {
  // Order matters in the report, not in the outcome: if the run died, that is what a person
  // needs told first, and the dispatch list from a dead run is not evidence of anything.
  const v = verdict('dispatch', ran({ dispatched: ['ghost'], isError: true }), STAFF)
  assert.equal(v.note, 'the run itself failed')
})

// ──────────────────────────────────────────────────────────────── off-roster ────

test('offRoster keeps order and drops what is on the roster', () => {
  assert.deepEqual(offRoster(['builder', 'ghost', 'reviewer', 'wraith'], STAFF), ['ghost', 'wraith'])
  assert.deepEqual(offRoster(['builder', 'reviewer'], STAFF), [])
  assert.deepEqual(offRoster([], STAFF), [])
})

// ─────────────────────────────────────────────────────── the line at the bottom ────

test('the tally counts passes and adds up what was spent', () => {
  const t = tally([
    { failed: false, costUsd: 0.5 },
    { failed: true, costUsd: 0.25 },
    { failed: false, costUsd: 1 },
  ])
  assert.deepEqual(t, { passed: 2, total: 3, spentUsd: 1.75 })
})

test('a run that never reported a cost does not poison the total', () => {
  // `sum + undefined` is `NaN`, and a bill that reads `$NaN` is the one number nobody can act
  // on. The total is a floor rather than a receipt, which is a different claim and a true one.
  const t = tally([
    { failed: false, costUsd: null },
    { failed: false, costUsd: 0.25 },
  ])
  assert.equal(t.spentUsd, 0.25)
  assert.equal(Number.isNaN(t.spentUsd), false)
})

test('an empty run spends nothing and passes nothing', () => {
  assert.deepEqual(tally([]), { passed: 0, total: 0, spentUsd: 0 })
})
