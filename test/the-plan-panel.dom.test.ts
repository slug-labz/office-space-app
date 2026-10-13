/**
 * What the plan panel draws, and the two things it must never draw.
 *
 * **A bar where there is no reading.** A track at zero is a shape that means *nothing used*, and
 * two of the three states have no number at all — nothing has run, or runs happened and none
 * reported an allowance. Borrowing an empty bar for either tells somebody they have their whole
 * allowance left, which is a claim about their account nobody checked. Neither state draws a
 * row.
 *
 * **A billing claim where billing is unknown.** The panel explains that the status bar's dollar
 * figure is notional — and the first draft said that in *every* state, including the one an API
 * key produces, where the figure is real money leaving a real account. Saying so is licensed by
 * evidence and nothing else: a reading exists, therefore the CLI reported a plan allowance,
 * therefore there is a plan. Where no allowance was ever reported, the panel says nothing about
 * how anybody is billed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { renderPlan } from '../src/renderer/views/plan.js'
import type { PlanReading, PlanWindow } from '../src/shared/plan-usage.js'

installDom()

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0)

function drawn(reading: PlanReading): { text: string; bars: number; rows: number; widths: string[] } {
  const host = document.createElement('div') as unknown as El
  renderPlan(host as unknown as HTMLElement, reading, NOW)
  const nodes = all(host)
  return {
    text: nodes.map((n) => n.textContent ?? '').join(' '),
    bars: nodes.filter((n) => (n.className ?? '').includes('planrow__fill')).length,
    rows: nodes.filter((n) => (n.className ?? '').split(' ').includes('planrow')).length,
    widths: nodes
      .filter((n) => (n.className ?? '').includes('planrow__fill'))
      .map((n) => (n as unknown as { style?: { width?: string } }).style?.width ?? ''),
  }
}

function measured(windows: readonly PlanWindow[], over: Record<string, unknown> = {}): PlanReading {
  return {
    state: 'measured',
    usage: { status: 'allowed', window: 'five_hour', used: 0.72, resetsAt: null, usingOverage: false, overage: 'allowed', ...over },
    windows,
    at: NOW - 60 * 60_000,
  }
}

test('every bucket the CLI named gets a row, not just the binding one', () => {
  const { text, rows, bars } = drawn(
    measured([
      { name: 'five_hour', used: 0.72, resetsAt: null },
      { name: 'seven_day', used: 0.07, resetsAt: null },
    ]),
  )

  assert.equal(rows, 2)
  assert.equal(bars, 2)
  assert.match(text, /five-hour/)
  assert.match(text, /seven-day/)
  // The one in force is said in words, not left to a colour.
  assert.match(text, /the limit in force right now/)
})

test('a window with no utilisation gets no bar, and says so', () => {
  const { text, rows, bars } = drawn(
    measured([
      { name: 'five_hour', used: 0.72, resetsAt: null },
      { name: 'opus_weekly', used: null, resetsAt: null },
    ]),
  )

  assert.equal(rows, 2, 'the window is still listed — we know it exists')
  assert.equal(bars, 1, 'and it has no bar, because there is no quantity to draw')
  assert.match(text, /not reported/)
})

test('neither state without a reading draws a row or a bar', () => {
  for (const reading of [{ state: 'never-ran' } as const, { state: 'not-reported', runs: 5 } as const]) {
    const { rows, bars, text } = drawn(reading)
    assert.equal(rows, 0, `${reading.state} drew a row`)
    assert.equal(bars, 0, `${reading.state} drew a bar — an empty track reads as "nothing used"`)
    assert.doesNotMatch(text, /\d+%/, `${reading.state} put a percentage on screen`)
  }
})

test('the two states without a reading do not render alike', () => {
  const never = drawn({ state: 'never-ran' })
  const quiet = drawn({ state: 'not-reported', runs: 5 })

  assert.notEqual(never.text, quiet.text)
  // One waits for a run; the other says the number will never come. Sending somebody to wait for
  // a reading that cannot arrive is its own small failure by a panel trying to help.
  assert.match(never.text, /Send the manager something/)
  assert.match(quiet.text, /will stay empty — that is not a fault/)
})

test('the notional-cost note appears only where a plan allowance was actually reported', () => {
  assert.match(drawn(measured([{ name: 'five_hour', used: 0.5, resetsAt: null }])).text, /no such charge reaches the account/)

  // The regression this test exists for. `not-reported` is what an API key looks like, and there
  // the status bar's figure is real money.
  assert.doesNotMatch(drawn({ state: 'not-reported', runs: 3 }).text, /no such charge/)
  assert.doesNotMatch(drawn({ state: 'never-ran' }).text, /no such charge/)
})

test('the bar is clamped, so a utilisation over 1 cannot draw past the track', () => {
  // `used` comes off the wire. `stream.ts` guarantees it is finite and nothing more.
  //
  // The binding window is named to match, which the first draft of this test did not do — it
  // left the default `five_hour` binding while supplying only `seven_day`, so `planLines`
  // correctly synthesised a second row and the assertion caught its own fixture rather than the
  // clamp. A test whose setup disagrees with itself fails for the wrong reason.
  const { widths } = drawn(measured([{ name: 'seven_day', used: 1.4, resetsAt: null }], { window: 'seven_day' }))
  assert.deepEqual(widths, ['100%'])
})

test('the lede says when it was measured and never claims to be live', () => {
  const { text } = drawn(measured([{ name: 'five_hour', used: 0.2, resetsAt: null }]))
  assert.match(text, /1 hour ago/)
  assert.match(text, /not a live reading/)
  assert.doesNotMatch(text, /currently/i)
})
