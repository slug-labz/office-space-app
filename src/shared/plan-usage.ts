/**
 * How much of the plan is left — as an interruption, and as an answer.
 *
 * Kept apart from the parser because *when to speak* is a judgement and parsing is not. An
 * office that announces "73% used" on every single run has taught you to ignore it by the third
 * one, and will be ignored on the run that mattered.
 *
 * ## Two different questions, and only one of them was answered
 *
 * `planWarning` decides when to **interrupt**, and its silence below the threshold is right.
 * What it cannot do is answer somebody who *asks*. Until this module gained `planLines`, the
 * office would tell you the allowance was nearly gone and had no way to tell you it was fine —
 * so *"can I start another project right now"*, the question a person actually has on a
 * subscription, had no surface at all.
 *
 * The two are kept in one file because they must not disagree about what the numbers mean, and
 * apart as functions because interrupting and answering have opposite defaults: the first is
 * silent unless it matters, the second always says something.
 *
 * ## Why this is not money
 *
 * `stream.ts` states it: `total_cost_usd` on a Max plan is **notional** — what those tokens
 * would have cost at API rates, with no charge reaching the account. The real constraint is a
 * bucket that empties and refills, so that is what this reports. A dollar figure would be the
 * third standing order broken in the heading.
 *
 * Nothing here assumes which plan anybody is on. The CLI reports its own limits at runtime and
 * this repeats them; a module that hard-coded "Max" would be wrong for the next person and
 * silently wrong for the same person on a different day.
 */

export interface PlanUsage {
  readonly status: string
  readonly window: string
  readonly used: number | null
  readonly resetsAt: number | null
  /** Whether paying past the limit is *happening*. The CLI's own `isUsingOverage`. */
  readonly usingOverage: boolean
  /**
   * Whether paying past the limit is **possible at all** — `rejected` when it is not.
   *
   * Not the same question as `usingOverage`, and the difference is the one this panel exists to
   * answer. `stream.ts` states it where the field arrives: *"The difference between 'you will be
   * slowed' and 'you will stop': with overage rejected there is no way through, and the reset
   * time is the only answer to when can I work again."*
   *
   * At 95% used, *you will be billed past it* and *you will stop dead* are different answers to
   * **can I start another project right now**, which is the question the panel was built for.
   *
   * It was already crossing the bridge and unreachable: `main.ts` stores `usage: event`, so the
   * value has always been on the wire — this interface simply did not declare it. Adding it is
   * one line and no plumbing, which is why its absence was not a scope cut.
   */
  readonly overage: string
}

/**
 * One of the plan's buckets.
 *
 * The CLI reports several — `five_hour` and `seven_day` were both present in the run captured on
 * 2026-09-01 — and until now the app kept only whichever one was *binding*, for the warning
 * string, and dropped the rest on the floor. `stream.ts` parses them all into `RateWindow` and
 * nothing has ever read the field.
 *
 * They answer different questions and a person has both: the short window is *can I start
 * another one right now*, the long one is *will I have room this week*. Reporting only the
 * binding one answers whichever happens to be tighter and leaves the other unasked.
 */
export interface PlanWindow {
  readonly name: string
  readonly used: number | null
  readonly resetsAt: number | null
}

/**
 * What the office knows about the allowance, and how it came to know it.
 *
 * Three states, and the two that are not `measured` are the point.
 *
 * A reading arrives on the **first event of a run** — so the freshest value that can ever exist
 * is the last run's, and this carries `at` rather than pretending to be live. `main.ts` already
 * says as much about the string it kept: *"the most recent measurement, not a live one"*.
 *
 * `never-ran` and `not-reported` are separated because they send a person to different places
 * and only one of them is a fault. An office nobody has used yet has no reading and that is
 * ordinary; an office that has run and was never told its limits is on an API key, or on a CLI
 * that does not send the event, and the honest answer there is that this cannot be shown rather
 * than that the allowance is fine.
 *
 * **Neither may render as 0% used.** That is the whole reason this is a union and not a
 * `PlanUsage | null`: an empty bar tells somebody they have their whole allowance left, which is
 * a claim about their account that nobody has checked.
 */
export type PlanReading =
  /** A run reported the allowance. `at` is when, in epoch milliseconds. */
  | {
      readonly state: 'measured'
      readonly usage: PlanUsage
      /** Every bucket the CLI named, not only the binding one. May be empty on an older CLI. */
      readonly windows: readonly PlanWindow[]
      readonly at: number
    }
  /** No run has happened in this office yet, so there is nothing to have measured. */
  | { readonly state: 'never-ran' }
  /** Runs have happened and none reported an allowance. Not the same as having plenty. */
  | { readonly state: 'not-reported'; readonly runs: number }

/** How the reset time reads to a person. `null` when there is no reset to name. */
export function resetsIn(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null
  const hours = Math.round((resetsAt * 1000 - now) / 3_600_000)
  if (hours <= 0) return 'now'
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `in ${days} day${days === 1 ? '' : 's'}`
}

/**
 * What to say, or `null` for the ordinary case.
 *
 * Silence below the threshold is the point. The two states worth interrupting for are *running
 * out* and *out* — everything below that is a number nobody asked for.
 *
 * `out_of_credits` is the one that must never be swallowed. With overage disabled there is no
 * way to pay past it: the office simply stops working, and an office that stops without saying
 * why is indistinguishable from one that is broken.
 */
export function planWarning(usage: PlanUsage, now: number): string | null {
  const reset = resetsIn(usage.resetsAt, now)
  const when = reset ? ` It resets ${reset}.` : ''

  if (usage.status === 'out_of_credits') {
    // Two different facts, and telling a person the wrong one is telling them the wrong thing
    // about their money. `usingOverage` is the CLI's own `isUsingOverage`: it does not mean
    // overage is *available*, it means it is happening. So "runs will fail" is contradicted by
    // the flag, and this sentence also goes into the context block the manager reads — an office
    // told it is out of credits has a reason not to dispatch anybody.
    return usage.usingOverage
      ? `This plan's ${label(usage.window)} allowance is used up. Runs are continuing, billed as overage.${when}`
      : `This plan's ${label(usage.window)} allowance is used up, so runs will fail until it resets.${when}`
  }

  if (usage.used !== null && usage.used >= 0.9) {
    return `${percent(usage.used)} of this plan's ${label(usage.window)} allowance is used.${when}${billing(usage)}`
  }

  if (usage.status === 'allowed_warning' && usage.used !== null && usage.used >= 0.7) {
    return `${percent(usage.used)} of this plan's ${label(usage.window)} allowance is used.${when}${billing(usage)}`
  }

  return null
}

/**
 * Whether this is already costing money beyond the plan.
 *
 * Only ever states what the flag states. `usingOverage` being false is *not* evidence that
 * overage is unavailable — it means it is not happening — so nothing is said in that case rather
 * than a guess about what crossing the line would do. A warning that speculates about billing is
 * worse than one that stops at the percentage.
 */
function billing(usage: PlanUsage): string {
  return usage.usingOverage ? ' Usage beyond the allowance is being billed as overage.' : ''
}

function percent(used: number): string {
  return `${Math.round(used * 100)}%`
}

/** `seven_day` is not something to put in front of a person. */
function label(window: string): string {
  return window.replace(/_/g, '-')
}

// ─────────────────────────────────────────────────────────────────── answering ──

/**
 * How long ago the reading was taken, for a person.
 *
 * Deliberately coarse. The value moves on a five-hour or seven-day window, so "3 minutes ago"
 * implies a precision the number does not have — and the point of saying it at all is that this
 * is a measurement rather than a live reading, not that it is fresh to the second.
 */
export function measuredAgo(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes <= 0) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** One bucket, as a line. `used` may be unknown, and then it says so rather than showing a bar. */
export interface PlanLine {
  /** `five-hour`, `seven-day` — the CLI's name, made readable. */
  readonly window: string
  /** 0–1, or `null` when the CLI named the window and not its utilisation. */
  readonly used: number | null
  /** `72%`, or `not reported` — never `0%` standing in for an unknown. */
  readonly usedLabel: string
  /** `in 4 hours`, or `null` when there is no reset to name. */
  readonly resetsIn: string | null
  /** True for the bucket the CLI says is binding right now. */
  readonly binding: boolean
}

/**
 * Every bucket, in the order the CLI named them, with the binding one marked.
 *
 * Not sorted by fullness. The order the CLI sends is stable and meaningful — short window first
 * — and re-ordering by percentage would move rows around under somebody between two openings of
 * the same panel.
 *
 * The binding window is *marked* rather than promoted, for the same reason: which bucket is
 * binding changes as they fill and empty, and a list that reorders itself is a list you have to
 * re-read every time.
 */
export function planLines(reading: PlanReading, now: number): readonly PlanLine[] {
  if (reading.state !== 'measured') return []

  // The binding window may not appear in `windows` at all — an older CLI sends a flat
  // `utilization` with no `unifiedWindows`, and `stream.ts` keeps reading that as a fallback. So
  // the binding reading is synthesised as its own row rather than dropped, which is the
  // difference between showing one honest line and showing none.
  const named = reading.windows.map((w) => ({
    window: readable(w.name),
    used: w.used,
    usedLabel: usedLabel(w.used),
    resetsIn: resetsIn(w.resetsAt, now),
    binding: w.name === reading.usage.window,
  }))

  if (named.some((line) => line.binding)) return named
  if (reading.usage.used === null && reading.usage.resetsAt === null && named.length > 0) return named

  return [
    ...named,
    {
      window: readable(reading.usage.window),
      used: reading.usage.used,
      usedLabel: usedLabel(reading.usage.used),
      resetsIn: resetsIn(reading.usage.resetsAt, now),
      binding: true,
    },
  ]
}

/**
 * The sentence above the lines.
 *
 * Says something in every state, which is the whole difference between this and `planWarning`.
 * The three that are not a reading are three different sentences, because "we have not looked",
 * "we looked and were told nothing" and "73% used" send a person to three different places and
 * only the last is an answer.
 */
export function planLede(reading: PlanReading, now: number): string {
  switch (reading.state) {
    case 'never-ran':
      return 'Nothing has run in this office yet, so its allowance has not been measured.'

    case 'not-reported':
      // Stated as a fact about the reporting, not about the account. An API key has no plan
      // allowance to report and that is not a fault; a CLI too old to send the event is not one
      // either. Either way the honest answer is that this cannot be shown.
      return reading.runs === 1
        ? 'One run has happened and it did not report an allowance — this is what an API key, or a CLI that does not send it, looks like.'
        : `${reading.runs} runs have happened and none reported an allowance — this is what an API key, or a CLI that does not send it, looks like.`

    case 'measured': {
      // "Measured", never "currently". The reading arrives on the first event of a run, so the
      // freshest value that can exist is the last run's, and a panel that said "currently" would
      // be claiming a live reading nobody took.
      const when = measuredAgo(reading.at, now)

      /*
       * Spent, and no way to pay past it. Said first, because it is the only one of the three
       * where the office has already stopped.
       *
       * This branch keyed on `usingOverage` alone, so a spent plan with overage **disabled** —
       * runs actively failing — read *"Measured 2 hours ago, on the last run — not a live
       * reading."* The rule it is measured against is 150 lines up in this file: *"`out_of_credits`
       * is the one that must never be swallowed... an office that stops without saying why is
       * indistinguishable from one that is broken."*
       *
       * Not swallowed system-wide — `planWarning` branches on it and the bar shows 100%. What was
       * missing is that a 100% bar looks identical whether billing continues or the office has
       * stopped, and this is the surface built to tell somebody which.
       */
      if (reading.usage.status === 'out_of_credits' && !reading.usage.usingOverage) {
        /*
         * Three arms, not two, and the third is the one this nearly got wrong.
         *
         * `stream.ts` writes `String(info['overageStatus'] ?? 'unknown')`, so a payload that did
         * not carry the field arrives as the literal `'unknown'`. A two-armed version keyed on
         * `=== 'rejected'` sent that to the else branch and said *"nothing has been billed past
         * it yet"* — turning the parser's own word for *we could not tell* into a statement about
         * somebody's bill, on the surface built to say what happens when the allowance runs out,
         * and in the reassuring direction.
         *
         * The permissive sentence is not the absence of a claim. It is a **more** specific claim
         * than the `rejected` one. So the billing clause is earned by `'allowed'` explicitly, and
         * anything else — `unknown`, or a value this CLI does not yet write — gets the part that
         * is true either way and stops.
         */
        if (reading.usage.overage === 'rejected') {
          return `Measured ${when}. The allowance is spent and overage is off, so runs stop until it resets.`
        }
        if (reading.usage.overage === 'allowed') {
          return `Measured ${when}. The allowance is spent, and nothing has been billed past it yet.`
        }
        return `Measured ${when}. The allowance is spent.`
      }

      return reading.usage.usingOverage
        ? `Measured ${when}. Usage beyond the allowance is being billed as overage.`
        : `Measured ${when}, on the last run — not a live reading.`
    }
  }
}

/**
 * `72%`, or what to say instead.
 *
 * `not reported` rather than `0%` or an em dash. A percentage the CLI did not send is a gap in
 * what we were told, and `0%` is the single most misleading thing that could stand in for it —
 * it reads as an empty bucket, which is the opposite of not knowing.
 */
function usedLabel(used: number | null): string {
  return used === null ? 'not reported' : `${Math.round(used * 100)}%`
}

/** `seven_day` → `seven-day`. The same transformation `label` does, exported shape. */
function readable(window: string): string {
  return window.replace(/_/g, '-')
}
