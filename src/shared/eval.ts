/**
 * What the delegation eval concluded, separated from the run that produced it.
 *
 * `src/main/cli/eval.ts` spends real money on real `claude` runs, and ends in `await main()` at
 * module scope — so importing it *runs* it, and no test could reach a line of it. That is the
 * same barrier `main.ts` has, and the same answer applies: move the decision rather than build a
 * harness around the module. What is left there is argv, I/O and printing.
 *
 * ## Why this one matters more than its size
 *
 * The eval is second-standing-order machinery. Its whole job is to answer *"did the manager
 * actually delegate"* with something better than a claim, and everything downstream of it —
 * including the sentence in `manager.md` that forty lines of prompt rest on — is only as good as
 * its verdict. **A harness that can report a pass it did not observe is worse than no harness**,
 * because the absence of one is at least visible.
 *
 * It could. See {@link verdict} on the roster.
 */

/** What a scenario expected the manager to do. */
export type Expectation = 'dispatch' | 'answer'

/** What actually happened in one run, reduced to what the verdict needs. */
export interface Observed {
  /** Who work was handed to, in order. Empty means the manager answered it itself. */
  readonly dispatched: readonly string[]
  /** Whether the run reported an error. A run we stopped ourselves reports one too. */
  readonly isError: boolean
  /** True when *we* interrupted it, having already seen what we came to see. */
  readonly stoppedOnPurpose: boolean
}

export interface Verdict {
  readonly failed: boolean
  /** Why it failed, in words, or `null`. Never a restatement of `failed`. */
  readonly note: string | null
}

/**
 * Did this scenario do what was asked of it?
 *
 * Three ways to fail, and the third is new.
 *
 * 1. **The run itself failed** — but only if we did not stop it. A run we interrupted reports
 *    `isError`, and reading that as a failed scenario would mark every correct dispatch as a
 *    failure. That is why `stoppedOnPurpose` exists.
 * 2. **It did the other thing** — dispatched when it should have answered, or answered when it
 *    should have dispatched.
 * 3. **It dispatched to somebody who is not on the roster.** This was not counted before. The
 *    off-roster check existed and printed `!! <name> is not on this roster — no desk, nothing
 *    moves` beside the result, while `failed` had already been decided without it — so the
 *    scenario was reported `ok`, counted in the tally, and left the exit code at zero.
 *
 *    The comment beside that warning said it exactly: *"a dispatch to somebody with no desk
 *    looks, from the floor, exactly like no dispatch at all."* If it looks like no dispatch,
 *    then a scenario expecting a dispatch did not get one, and the eval was reporting a pass it
 *    had not observed — about delegation, which is the one thing it exists to measure.
 *
 * `roster` is passed rather than reached for, so this stays pure and a test can hand it an
 * empty one.
 */
export function verdict(
  expect: Expectation,
  observed: Observed,
  roster: ReadonlySet<string>,
): Verdict {
  if (observed.isError && !observed.stoppedOnPurpose) {
    return { failed: true, note: 'the run itself failed' }
  }

  const strangers = offRoster(observed.dispatched, roster)
  if (strangers.length > 0) {
    return {
      failed: true,
      note: `dispatched to ${strangers.join(', ')} — not on this roster, so no desk and nothing moves`,
    }
  }

  const dispatched = observed.dispatched.length > 0
  if ((expect === 'dispatch') !== dispatched) {
    return { failed: true, note: null }
  }
  return { failed: false, note: null }
}

/**
 * Names work was handed to that nobody on the floor answers to.
 *
 * Order-preserving and duplicate-free: a manager that dispatched to the same absent name three
 * times has made one mistake, and printing it three times reads as three.
 */
export function offRoster(
  dispatched: readonly string[],
  roster: ReadonlySet<string>,
): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const who of dispatched) {
    if (roster.has(who) || seen.has(who)) continue
    seen.add(who)
    out.push(who)
  }
  return out
}

export interface Tally {
  readonly passed: number
  readonly total: number
  readonly spentUsd: number
}

/**
 * The line at the bottom.
 *
 * `costUsd` is nullable — a run that never reported one contributes nothing rather than
 * poisoning the sum with `NaN`, which is what `sum + undefined` would have done. The total is
 * therefore a floor, not a receipt, and the caller says so.
 */
export function tally(
  outcomes: readonly { readonly failed: boolean; readonly costUsd: number | null }[],
): Tally {
  return {
    passed: outcomes.filter((o) => !o.failed).length,
    total: outcomes.length,
    spentUsd: outcomes.reduce((sum, o) => sum + (o.costUsd ?? 0), 0),
  }
}
