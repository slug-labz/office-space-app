/**
 * How much of the plan is left.
 *
 * This exists because the signal was arriving on the first event of every run and nothing read
 * it — and because on a subscription it is the only figure that means anything. The dollar
 * amounts the CLI reports are notional: what the tokens would have cost at API rates, for a
 * charge that never appears on the account. This is the real currency.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planWarning, resetsIn } from '../src/shared/plan-usage.js'
import { StreamParser } from '../src/main/claude/stream.js'
import type { PlanUsage } from '../src/shared/plan-usage.js'

const NOW = 1_787_213_000_000
// `overage: 'allowed'` on the base, so a fixture that says nothing about it is the ordinary
// account rather than the stopped one. The tests that care set it explicitly.
const base = { status: 'allowed', window: 'seven_day', used: 0.1, resetsAt: null, usingOverage: false, overage: 'allowed' }

test('the ordinary case says nothing', () => {
  // The whole discipline. An office that reports 10% used on every run has taught you to ignore
  // it long before the run where it mattered.
  assert.equal(planWarning(base, NOW), null)
  assert.equal(planWarning({ ...base, used: 0.5 }, NOW), null)
  assert.equal(planWarning({ ...base, used: 0.69 }, NOW), null)
})

test('a warning from the CLI at 70% or more is passed on', () => {
  const msg = planWarning({ ...base, status: 'allowed_warning', used: 0.73 }, NOW)
  assert.match(msg ?? '', /73%/)
  assert.match(msg ?? '', /seven-day/)
})

test('a warning status below the threshold is still quiet', () => {
  // The CLI may warn earlier than is useful to say out loud. Two conditions, not one.
  assert.equal(planWarning({ ...base, status: 'allowed_warning', used: 0.2 }, NOW), null)
})

test('90% speaks even without a warning status', () => {
  assert.match(planWarning({ ...base, used: 0.94 }, NOW) ?? '', /94%/)
})

test('out of credits is never swallowed', () => {
  // The one that must always be said. With overage disabled there is no way to pay past it —
  // the office simply stops, and one that stops without saying why looks broken.
  const msg = planWarning({ ...base, status: 'out_of_credits', used: 1 }, NOW)
  assert.match(msg ?? '', /used up/)
  assert.match(msg ?? '', /runs will fail/)
})

test('the reset time is said the way a person would say it', () => {
  assert.equal(resetsIn(null, NOW), null)
  assert.equal(resetsIn(Math.floor(NOW / 1000) + 3600, NOW), 'in 1 hour')
  assert.equal(resetsIn(Math.floor(NOW / 1000) + 7200, NOW), 'in 2 hours')
  assert.equal(resetsIn(Math.floor(NOW / 1000) + 3600 * 115, NOW), 'in 5 days')
  assert.equal(resetsIn(Math.floor(NOW / 1000) - 10, NOW), 'now')
})

test('the real numbers from this machine produce the sentence we expect', () => {
  // Captured live rather than invented: 73% of a seven-day window, resetting 115 hours out.
  const msg = planWarning(
    { status: 'allowed_warning', window: 'seven_day', used: 0.73, resetsAt: 1_787_626_800, usingOverage: false, overage: 'allowed' },
    1_787_213_000_000,
  )
  assert.equal(msg, "73% of this plan's seven-day allowance is used. It resets in 5 days.")
})

// ───────────────────────────────────────── whether this is costing money past the plan ──

/*
 * `usingOverage` is the CLI's own `isUsingOverage`. It does not mean overage is *available* — it
 * means it is happening. The field was parsed off the stream and read by nothing, so the
 * out-of-credits sentence said "runs will fail until it resets" while the CLI was reporting that
 * runs were continuing and being billed.
 *
 * That sentence is not only on screen. `main.ts` puts it in the context block the manager reads,
 * so an office told it is out of credits has a reason not to dispatch anybody.
 */

const used = (over: Partial<PlanUsage> = {}): PlanUsage => ({
  status: 'out_of_credits',
  window: 'seven_day',
  used: 1,
  resetsAt: null,
  overage: 'allowed',
  usingOverage: false,
  ...over,
})

test('out of credits with no overage says runs will fail', () => {
  const said = planWarning(used(), NOW)

  assert.match(said ?? '', /runs will fail until it resets/)
})

test('out of credits WHILE billing overage must not say runs will fail', () => {
  // The CLI is reporting that runs are happening. Saying they will fail is a wrong statement
  // about the user's money, in the one message that exists to be right about it.
  const said = planWarning(used({ usingOverage: true }), NOW)

  assert.doesNotMatch(said ?? '', /will fail/)
  assert.match(said ?? '', /billed as overage/)
})

test('a percentage warning says when the excess is being billed', () => {
  const said = planWarning(used({ status: 'allowed_warning', used: 0.92, usingOverage: true }), NOW)

  assert.match(said ?? '', /92%/)
  assert.match(said ?? '', /billed as overage/)
})

test('and says nothing about billing when it is not happening', () => {
  // `usingOverage: false` is not evidence that overage is unavailable — only that it is not
  // happening. Speculating about what crossing the line would do is worse than stopping at the
  // percentage.
  const said = planWarning(used({ status: 'allowed_warning', used: 0.92, usingOverage: false }), NOW)

  assert.match(said ?? '', /92%/)
  assert.doesNotMatch(said ?? '', /overage/)
})

test('the ordinary case is still silent, overage or not', () => {
  // An office that announces the number on every run has taught you to ignore it by the third.
  assert.equal(planWarning(used({ status: 'allowed', used: 0.2, usingOverage: true }), NOW), null)
})


test('the warning fires on a real payload, which it did not for as long as it existed', () => {
  /*
   * **This whole module was dead code and nothing said so.**
   *
   * `planWarning` gates on `usage.used >= 0.9`, and `used` came from a parser that read
   * `info['utilization']` — a key the CLI does not send. The number is nested per window under
   * `unifiedWindows`, so `used` was `null` on every run, every branch that depends on it was
   * unreachable, and the office never once said the plan was running out. The `out_of_credits`
   * branch still fired because it keys on `status`, which is why nobody noticed.
   *
   * Measured with the payload captured verbatim from a real run on 2026-09-01: with the old
   * parser this returned `null`; with the fixed one, *"93% of this plan's five-hour allowance is
   * used. It resets in 1 hour."*
   *
   * So this test does not go through `planWarning` alone — it goes through the **parser first**,
   * because the parser is where it broke and a fixture typed by hand here would pass either way.
   * That is the mistake the old `stream.test.ts` fixture made: it carried a flat `utilization`
   * and agreed with the code while both disagreed with the CLI.
   */
  const [event] = new StreamParser().push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed_warning',
        resetsAt: 1788253800,
        rateLimitType: 'five_hour',
        overageStatus: 'rejected',
        isUsingOverage: false,
        unifiedWindows: {
          five_hour: { utilization: 0.93, resetsAt: 1788253800 },
          seven_day: { utilization: 0.07 },
        },
      },
    }) + '\n',
  )
  assert.equal(event?.kind, 'rate-limit')
  if (event?.kind !== 'rate-limit') return

  const said = planWarning(event, 1788253800_000 - 3_600_000)
  assert.ok(said, 'a 93%-used plan said nothing — the warning is unreachable again')
  assert.match(said, /93%/)
  assert.match(said, /five-hour/)
  assert.match(said, /resets/)
})
