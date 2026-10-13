/**
 * How full the plan is, drawn.
 *
 * The office could tell you the allowance was nearly gone and had no way to tell you it was
 * fine. `planWarning` interrupts at 70% with a warning status, at 90%, and when it is spent —
 * and returns `null` for every ordinary reading, which is right for an interruption and useless
 * to somebody asking *"can I start another project right now"*. On a subscription that is the
 * question, because the bucket is the constraint.
 *
 * ## Why there is no dollar figure on this panel
 *
 * `stream.ts` states it: `total_cost_usd` on a Max plan is **notional** — what those tokens
 * would have cost at API rates, with no charge reaching the account. A panel headed "spend"
 * showing that number would be money stated wrongly on screen, which is the third standing order
 * broken in the heading. So this reports the thing that is real: a bucket that empties, and when
 * it refills.
 *
 * ## Three states and only one of them has a number
 *
 * A bar at zero is the failure this panel is shaped to avoid. *Nothing has run yet* and *runs
 * happened and none reported an allowance* both have no reading, and both would draw as an empty
 * bar — telling somebody they have their whole allowance left, which is a claim about their
 * account that nobody checked. Neither draws a bar at all.
 */

import {
  planLede,
  planLines,
  type PlanLine,
  type PlanReading,
} from '../../shared/plan-usage.js'
import { line } from './work.js'

export function renderPlan(host: HTMLElement, reading: PlanReading, now: number): void {
  host.replaceChildren()
  host.appendChild(line('plan__lede', planLede(reading, now)))

  const lines = planLines(reading, now)
  for (const bucket of lines) host.appendChild(row(bucket))

  if (lines.length === 0) host.appendChild(nothingMeasured(reading))

  /*
   * The notional figure, explained rather than shown — and **only where we know it is notional**.
   *
   * The status bar shows `$X this session` from `total_cost_usd`. On a subscription that is not
   * money anybody is charged, and saying so is the smallest honest fix available from here: it
   * does not change what the status bar does — somebody else's decision, not a thing to alter
   * quietly from a new surface — but it gives the number one place that says what it is.
   *
   * Said only in the `measured` state, and the first draft got this wrong. It rendered under
   * `not-reported` too, which is the state an **API key** produces — and on an API key that
   * figure is real money leaving a real account. Telling somebody their actual charges were
   * notional is a worse error than saying nothing, and in the opposite direction to the one
   * this panel was built to prevent.
   *
   * What licenses it here is evidence rather than inference: a reading exists, so the CLI
   * reported a plan allowance, so there is a plan. Where no allowance was ever reported, how
   * this office is billed is not something this panel knows, and it does not guess.
   */
  if (reading.state === 'measured') {
    host.appendChild(
      line(
        'plan__note',
        'The figure in the status bar is what these tokens would have cost at API rates. This ' +
          'office reports a plan allowance, so no such charge reaches the account — the buckets ' +
          'above are the real limit.',
      ),
    )
  }
}

/** One bucket. The bar is drawn only when there is a number for it to mean. */
function row(bucket: PlanLine): HTMLElement {
  const el = document.createElement('article')
  el.className = bucket.binding ? 'planrow planrow--binding' : 'planrow'

  const head = document.createElement('p')
  head.className = 'planrow__head'

  const name = document.createElement('span')
  name.className = 'planrow__window mono'
  name.textContent = bucket.window
  head.appendChild(name)

  const used = document.createElement('span')
  used.className = bucket.used === null ? 'planrow__used planrow__used--unknown' : 'planrow__used'
  used.textContent = bucket.usedLabel
  head.appendChild(used)

  el.appendChild(head)

  /*
   * No bar without a number.
   *
   * A `null` utilisation is the CLI not having told us, and a bar is a shape that always means
   * a quantity — there is no way to draw "unknown" as a fill. The label already says "not
   * reported"; drawing an empty track beside it would contradict the words next to it.
   */
  if (bucket.used !== null) {
    const track = document.createElement('div')
    track.className = 'planrow__track'
    const fill = document.createElement('div')
    fill.className = 'planrow__fill'
    fill.style.width = `${Math.min(100, Math.max(0, Math.round(bucket.used * 100)))}%`
    track.appendChild(fill)
    el.appendChild(track)

    // The bar is decoration; the number above it is the fact. Screen readers get the sentence.
    track.setAttribute('role', 'presentation')
  }

  const meta: string[] = []
  if (bucket.binding) meta.push('the limit in force right now')
  if (bucket.resetsIn !== null) meta.push(`resets ${bucket.resetsIn}`)
  if (meta.length > 0) el.appendChild(line('planrow__meta', meta.join(' · ')))

  return el
}

/**
 * What to say where the bars would be.
 *
 * Two sentences, because the two states are fixed differently: one waits for a run, the other
 * says this office will never be able to show it. Sending somebody to wait for a number that
 * cannot arrive is its own small failure by a panel trying to help.
 */
function nothingMeasured(reading: PlanReading): HTMLElement {
  if (reading.state === 'not-reported') {
    return line(
      'plan__empty',
      'Nothing to show until a run reports one. If this office runs on an API key there is no ' +
        'plan allowance to report, and this panel will stay empty — that is not a fault.',
    )
  }

  return line('plan__empty', 'Send the manager something, and the first run will report where the allowance stands.')
}
