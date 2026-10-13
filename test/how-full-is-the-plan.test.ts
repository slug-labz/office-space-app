/**
 * The allowance, answered rather than warned about.
 *
 * `planWarning` decides when to **interrupt** and is deliberately silent below its threshold.
 * `planLines`/`planLede` answer somebody who **asks**, and must therefore say something in every
 * state — including the two where there is no number at all.
 *
 * Those two are what most of this file is about, because they are the ones a careless surface
 * turns into "0% used":
 *
 *   **never-ran** — nothing has run in this office, so nothing has been measured.
 *   **not-reported** — runs happened and none carried an allowance. An API key has none to
 *   report; an older CLI does not send the event. Neither is a fault and neither is good news.
 *
 * An empty bar for either would tell somebody they have their whole allowance left, which is a
 * claim about their account that nobody checked. The assertions below are mostly inequalities
 * for that reason: it is not enough that each state is right, they have to be *distinguishable*.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  measuredAgo,
  planLede,
  planLines,
  planWarning,
  type PlanReading,
  type PlanUsage,
  type PlanWindow,
} from '../src/shared/plan-usage.js'

const NOW = Date.UTC(2026, 8, 3, 12, 0, 0)

function usage(over: Partial<PlanUsage> = {}): PlanUsage {
  return { status: 'allowed', window: 'five_hour', used: 0.4, resetsAt: null, usingOverage: false, overage: 'allowed', ...over }
}

function measured(windows: readonly PlanWindow[], over: Partial<PlanUsage> = {}, at = NOW): PlanReading {
  return { state: 'measured', usage: usage(over), windows, at }
}

// ────────────────────────────────────────────────────────── the three silences ──

test('the three states are three different sentences, and none of them implies plenty', () => {
  const never = planLede({ state: 'never-ran' }, NOW)
  const quiet = planLede({ state: 'not-reported', runs: 4 }, NOW)
  const read = planLede(measured([]), NOW)

  assert.match(never, /has not been measured/)
  assert.match(quiet, /did not report|none reported/)
  assert.match(read, /Measured/)

  // The distinction is the feature. Two of these rendering alike is the bug.
  assert.notEqual(never, quiet)
  assert.notEqual(quiet, read)

  // And none of them may read as an answer about how much is left.
  for (const said of [never, quiet]) {
    assert.doesNotMatch(said, /\d+%/, `"${said}" puts a percentage on a state that has no reading`)
  }
})

test('a state with no reading draws no lines at all', () => {
  assert.deepEqual(planLines({ state: 'never-ran' }, NOW), [])
  assert.deepEqual(planLines({ state: 'not-reported', runs: 2 }, NOW), [])
})

test('"one run" is not "1 runs"', () => {
  assert.match(planLede({ state: 'not-reported', runs: 1 }, NOW), /^One run has happened/)
  assert.match(planLede({ state: 'not-reported', runs: 3 }, NOW), /^3 runs have happened/)
})

// ─────────────────────────────────────────────────────────────── every bucket ──

test('every window the CLI named is reported, not just the binding one', () => {
  // The whole reason `windows` exists. The app kept only the binding bucket for its warning and
  // dropped the rest, so "will I have room this week" could not be asked while "can I start one
  // now" was being answered.
  const lines = planLines(
    measured([
      { name: 'five_hour', used: 0.72, resetsAt: null },
      { name: 'seven_day', used: 0.07, resetsAt: null },
    ]),
    NOW,
  )

  assert.deepEqual(
    lines.map((l) => `${l.window} ${l.usedLabel}${l.binding ? ' *' : ''}`),
    ['five-hour 72% *', 'seven-day 7%'],
  )
})

test('the order the CLI sent is kept, and the binding row is marked rather than promoted', () => {
  // A list that reorders by fullness moves rows under somebody between two openings of the same
  // panel, because which bucket binds changes as they fill.
  const lines = planLines(
    measured(
      [
        { name: 'five_hour', used: 0.05, resetsAt: null },
        { name: 'seven_day', used: 0.91, resetsAt: null },
      ],
      { window: 'seven_day' },
    ),
    NOW,
  )

  assert.deepEqual(lines.map((l) => l.window), ['five-hour', 'seven-day'])
  assert.equal(lines[1]?.binding, true)
  assert.equal(lines[0]?.binding, false)
})

test('an older CLI that sends no windows still gets one honest line', () => {
  // `stream.ts` reads a flat `utilization` as a fallback rather than deleting it, so a workspace
  // on an older CLI reports a binding window and no `unifiedWindows`. Dropping that would show
  // nothing to somebody whose allowance we do know.
  const lines = planLines(measured([], { window: 'seven_day', used: 0.33 }), NOW)

  assert.equal(lines.length, 1)
  assert.equal(lines[0]?.window, 'seven-day')
  assert.equal(lines[0]?.usedLabel, '33%')
  assert.equal(lines[0]?.binding, true)
})

test('a utilisation the CLI did not send says so, and never reads as 0%', () => {
  const lines = planLines(measured([{ name: 'five_hour', used: null, resetsAt: null }]), NOW)

  assert.equal(lines[0]?.usedLabel, 'not reported')
  assert.equal(lines[0]?.used, null)
  // `0%` is the single most misleading substitute — it reads as an empty bucket, which is the
  // opposite of not knowing.
  assert.notEqual(lines[0]?.usedLabel, '0%')
})

test('0% used is still reported as 0%, because that is a reading', () => {
  // The mirror of the case above, and the reason `used` is kept beside the label: an allowance
  // genuinely untouched is a fact, and conflating it with "not reported" would lose it.
  const lines = planLines(measured([{ name: 'seven_day', used: 0, resetsAt: null }]), NOW)
  assert.equal(lines[0]?.usedLabel, '0%')
  assert.equal(lines[0]?.used, 0)
})

test('a reset time is carried per window, not taken from the binding one', () => {
  const lines = planLines(
    measured([
      { name: 'five_hour', used: 0.5, resetsAt: Math.floor((NOW + 4 * 3_600_000) / 1000) },
      { name: 'seven_day', used: 0.1, resetsAt: Math.floor((NOW + 3 * 86_400_000) / 1000) },
    ]),
    NOW,
  )

  assert.equal(lines[0]?.resetsIn, 'in 4 hours')
  assert.equal(lines[1]?.resetsIn, 'in 3 days')
})

// ──────────────────────────────────────────────────────── a measurement, not now ──

test('the lede says when it was measured, and never says it is current', () => {
  const said = planLede(measured([], {}, NOW - 90 * 60_000), NOW)

  assert.match(said, /2 hours ago/)
  assert.match(said, /not a live reading/)
  // The word that would make it a claim nobody took.
  assert.doesNotMatch(said, /currently|right now/i)
})

test('overage is said when it is happening, and not speculated about when it is not', () => {
  const on = planLede(measured([], { usingOverage: true }), NOW)
  const off = planLede(measured([], { usingOverage: false }), NOW)

  assert.match(on, /billed as overage/)
  // `usingOverage: false` means it is not happening — not that it is unavailable. Saying
  // anything about billing here would be a guess about somebody's account.
  assert.doesNotMatch(off, /overage/)
})

test('measuredAgo is coarse on purpose, and does not claim precision the number lacks', () => {
  assert.equal(measuredAgo(NOW, NOW), 'just now')
  assert.equal(measuredAgo(NOW - 60_000, NOW), '1 minute ago')
  assert.equal(measuredAgo(NOW - 25 * 60_000, NOW), '25 minutes ago')
  assert.equal(measuredAgo(NOW - 3 * 3_600_000, NOW), '3 hours ago')
  assert.equal(measuredAgo(NOW - 2 * 86_400_000, NOW), '2 days ago')
})

// ───────────────────────────────────────────────────── the two must not disagree ──

test('the panel answers exactly when the warning stays silent', () => {
  // The pair that makes the feature worth having: an ordinary reading interrupts nobody and is
  // still available to anybody who asks. If `planWarning` ever started speaking here, the panel
  // would be redundant; if `planLede` ever went quiet, the question would be unanswerable again.
  const ordinary = usage({ used: 0.4, status: 'allowed' })

  assert.equal(planWarning(ordinary, NOW), null)
  assert.notEqual(planLede(measured([{ name: 'five_hour', used: 0.4, resetsAt: null }]), NOW), '')
  assert.equal(planLines(measured([{ name: 'five_hour', used: 0.4, resetsAt: null }]), NOW).length, 1)
})

test('both halves agree about what the numbers mean when the allowance is gone', () => {
  const spent = usage({ status: 'out_of_credits', used: 1, window: 'seven_day' })
  const warning = planWarning(spent, NOW)

  assert.ok(warning !== null, 'the warning must still fire; the panel does not replace it')
  assert.match(warning, /used up/)
  assert.equal(planLines({ state: 'measured', usage: spent, windows: [], at: NOW }, NOW)[0]?.usedLabel, '100%')
})

test('a spent plan with no way to pay past it says the office has stopped', () => {
  /*
   * Both of Vish's answers, and they are one gap: the panel knew how full the bucket was and not
   * what happens when it empties.
   *
   * `planLede`'s measured branch keyed on `usingOverage` alone, so a spent plan with overage
   * **disabled** — runs actively failing — read *"Measured 2 hours ago, on the last run — not a
   * live reading."* The rule is 150 lines up in the same module: *"`out_of_credits` is the one
   * that must never be swallowed… an office that stops without saying why is indistinguishable
   * from one that is broken."*
   *
   * Not swallowed system-wide — `planWarning` branches on it and the bar shows 100%. What was
   * missing is that **a 100% bar looks identical whether billing continues or the office has
   * stopped**, and this is the surface built to tell somebody which.
   */
  const stopped = planLede(
    measured([], { status: 'out_of_credits', used: 1, usingOverage: false, overage: 'rejected' }),
    NOW,
  )
  assert.match(stopped ?? '', /runs stop until it resets/)
  assert.doesNotMatch(stopped ?? '', /not a live reading/, 'a stopped office read as an ordinary stale measurement')
})

test('spent but overage still possible is a different sentence, because it is a different fact', () => {
  // The discrimination the field exists for. At the same 100% bar, "you will be billed past it"
  // and "you will stop dead" are different answers to *can I start another project right now*.
  const billable = planLede(
    measured([], { status: 'out_of_credits', used: 1, usingOverage: false, overage: 'allowed' }),
    NOW,
  )
  assert.match(billable ?? '', /nothing has been billed past it yet/)
  assert.doesNotMatch(billable ?? '', /runs stop/, 'an account that can still pay past the limit was told it had stopped')
})

test('overage already happening still reads as overage, whatever the status says', () => {
  // The pre-existing branch, unchanged and asserted so the new one cannot swallow it. `usingOverage`
  // is the CLI's own `isUsingOverage` — it means paying past the limit is *happening*, which is a
  // fact about now rather than about what is permitted.
  const billing = planLede(
    measured([], { status: 'out_of_credits', used: 1, usingOverage: true, overage: 'allowed' }),
    NOW,
  )
  assert.match(billing ?? '', /billed as overage/)
})

test('a payload that did not say is not told it has nothing to pay', () => {
  /*
   * The arm this nearly shipped without, found in review. `stream.ts:493` writes
   * `String(info['overageStatus'] ?? 'unknown')`, so a payload missing the field arrives as the
   * literal `'unknown'` — and a two-armed branch keyed on `=== 'rejected'` sent it to the else
   * path and said *"nothing has been billed past it yet"*.
   *
   * That is the parser's own word for **we could not tell**, converted into a statement about
   * somebody's bill, on the surface built to say what happens when the allowance runs out — and
   * wrong in the reassuring direction, which is the worse way round.
   *
   * The permissive sentence is not the absence of a claim; it is a *more* specific claim than the
   * `rejected` one. So it has to be earned by `'allowed'` explicitly.
   */
  const unsure = planLede(
    measured([], { status: 'out_of_credits', used: 1, usingOverage: false, overage: 'unknown' }),
    NOW,
  )
  assert.match(unsure ?? '', /The allowance is spent\./)
  assert.doesNotMatch(unsure ?? '', /nothing has been billed/, 'a value meaning "we could not tell" became a claim about billing')
  assert.doesNotMatch(unsure ?? '', /runs stop/, 'a value meaning "we could not tell" became a claim that the office had halted')
})

test('and a value this CLI does not write yet gets the same treatment', () => {
  // `overage` is typed `string` on purpose — `status`'s own rule, "reported, never interpreted".
  // The cost of that is here: an unrecognised value must fall to the arm that claims least, not
  // to whichever branch happens to be the else.
  const odd = planLede(
    measured([], { status: 'out_of_credits', used: 1, usingOverage: false, overage: 'throttled' }),
    NOW,
  )
  assert.match(odd ?? '', /The allowance is spent\./)
  assert.doesNotMatch(odd ?? '', /nothing has been billed/)
})
