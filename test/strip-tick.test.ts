/**
 * When the activity strip redraws itself, and the held call it forgot.
 *
 * The approval card's clock is silent above a minute and speaks under it, and it relied on the
 * strip's 1 Hz redraw to get from one to the other. That redraw ran only while an employee was
 * mid-task. A call held with nobody mid-task — the manager's own, or one from a project you are
 * not looking at — was drawn once, with plenty of time left, and never again: the card said
 * nothing about the clock for the whole wait, and the gate refused the call without the warning
 * ever appearing.
 *
 * `drawStrip` cannot be imported — `app.ts` is the renderer entry, and importing it starts the
 * application — so the decision lives in `shared/strip-tick.ts`, and the last test here checks
 * that `drawStrip` still asks it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { stripTicks, type StripClock } from '../src/shared/strip-tick.js'

const ASKED = '2026-09-01T03:00:00.000Z'
const at = (seconds: number): number => Date.parse(ASKED) + seconds * 1000
const FOUR_MINUTES = 240_000

const held = (waitMs: number | null = FOUR_MINUTES, askedAt = ASKED) => ({ askedAt, waitMs })

const clock = (over: Partial<StripClock> = {}): StripClock => ({
  open: true,
  working: 0,
  approvals: [],
  nowMs: at(10),
  ...over,
})

test('a held call keeps the strip ticking with nobody mid-task', () => {
  // The defect. `working` counts dispatched employees, never the manager's own turn, so the
  // manager's held call leaves it at zero — and so does a call held in another project while this
  // one is idle. Drawn with more than a minute left, the card says nothing about the clock, and
  // without a tick it never gets another chance to.
  assert.equal(stripTicks(clock({ approvals: [held()] })), true)
})

test('an idle office draws nothing', () => {
  assert.equal(stripTicks(clock()), false)
})

test('somebody mid-task still ticks, with or without a held call', () => {
  // Their ages are the other thing on the strip that moves without an event.
  assert.equal(stripTicks(clock({ working: 1 })), true)
  assert.equal(stripTicks(clock({ working: 1, approvals: [held()] })), true)
})

test('a shut strip never ticks', () => {
  // Nothing is drawn while it is shut, so a tick would redraw nothing.
  assert.equal(stripTicks(clock({ open: false, working: 2, approvals: [held()] })), false)
})

test('it ticks through the quiet minutes, or the warning could never appear', () => {
  // The trap in the obvious saving. Above a minute the card has no clock line, and a tick that ran
  // only while there was a line to update would never reach the minute that puts one there.
  assert.equal(stripTicks(clock({ approvals: [held()], nowMs: at(30) })), true)
  assert.equal(stripTicks(clock({ approvals: [held()], nowMs: at(179) })), true)
})

test('a wait nobody can count down gives the tick nothing to do', () => {
  // The card says the office does not know when this expires, and says it the same way every
  // second — whether the gate left out its wait or wrote a time that will not parse.
  assert.equal(stripTicks(clock({ approvals: [held(null)] })), false)
  assert.equal(stripTicks(clock({ approvals: [held(FOUR_MINUTES, 'not a date')] })), false)
})

test('past the deadline the clock has stopped, and so does the tick', () => {
  /*
   * The last waiting second still ticks, and the redraw after it is the one that draws the
   * refusal: `drawStrip` decides with the same `nowMs` it draws with. After that the line cannot
   * change. The gate normally takes the request away within a poll, but one whose gate was killed
   * stays on disk, and ticking for it would redraw a finished card once a second for good.
   */
  assert.equal(stripTicks(clock({ approvals: [held()], nowMs: at(239) })), true)
  assert.equal(stripTicks(clock({ approvals: [held()], nowMs: at(240) })), false)
})

test('one call still counting among several is enough', () => {
  const expired = held(FOUR_MINUTES, '2026-09-01T02:00:00.000Z')
  assert.equal(stripTicks(clock({ approvals: [held(null), expired, held()] })), true)
  assert.equal(stripTicks(clock({ approvals: [held(null), expired] })), false)
})

test('drawStrip asks, rather than deciding on its own', () => {
  // A source check, for the reason `strip-key.test.ts` gives: the property is one line, and a
  // check that names it is worth more than none. The old rule is the second pattern.
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src/renderer/app.ts'),
    'utf8',
  )

  assert.match(source, /stripTicks\(\{/, 'drawStrip must ask stripTicks whether to keep ticking')
  assert.doesNotMatch(
    source,
    /running\.length > 0\) startTicking\(\)/,
    'ticking only for somebody mid-task is the rule that froze the held-call clock',
  )
})
