/**
 * Does the manager actually delegate?
 *
 *   npm run eval
 *
 * ## Why this exists
 *
 * `manager.md` spends forty lines arguing that dispatch is the default, and every test in this
 * repo checks that the *prompt says so*. None checks that the manager *does so*. Laptop 1 named
 * it in the round-18 review and it stayed true for a fortnight: **the largest behavioural claim
 * in the product is currently believed.**
 *
 * A test suite cannot hold this. Every scenario below is a real `claude` run against the real
 * roster, it costs real money on the user's own subscription, and it is not deterministic — the
 * same request can be answered two defensible ways. So it is a **command a person runs on
 * purpose**, never part of `npm test`, and never part of CI.
 *
 * ## What it can and cannot tell you
 *
 * It measures **what the manager did**, not why. A scenario passed for a bad reason still passes
 * here, and that is the honest limit of a behavioural eval: the floor cannot see reasoning
 * either, so what this checks is exactly what the user would have seen.
 *
 * A single failure is not a regression. Two runs disagreeing on one scenario is the model being
 * a model. **A scenario that fails the same way twice is a prompt that stopped working.**
 */

import { runClaude } from '../claude/run.js'
import { tally, verdict } from '../../shared/eval.js'
import { discoverWorkspace, findManager } from '../workspace.js'
import { officeBlocks } from '../../shared/context/blocks.js'
import type { ClaudeEvent } from '../claude/stream.js'

interface Scenario {
  readonly name: string
  readonly request: string
  /** `dispatch` — this belongs to somebody. `answer` — dispatching it would be theatre. */
  readonly expect: 'dispatch' | 'answer'
  /** Why, in the prompt's own terms, so a failure says which rule stopped working. */
  readonly because: string
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'a feature is dispatched',
    request: 'Add retry-with-backoff to the fetch helper, and cover it with a test.',
    expect: 'dispatch',
    because: 'two or more steps, and a judgement about how — the prompt sends this to somebody',
  },
  {
    name: 'a code question is still work',
    request: 'How does session resumption work in this codebase?',
    expect: 'dispatch',
    because: '"a question about the codebase is still work" — the one the prompt calls out by name',
  },
  {
    name: 'one file read is not a dispatch',
    request: 'What version is this package at? Just the number.',
    expect: 'answer',
    because: 'the bar for doing it yourself is one tool call, and this is one tool call',
  },
  {
    name: 'a greeting is not work',
    request: 'hi',
    expect: 'answer',
    because: 'there is nothing to dispatch; a dispatch here would be inventing work',
  },
  {
    name: 'a review is a dispatch, not a self-check',
    request: 'Review src/main/approvals.ts for bugs that would break in production.',
    expect: 'dispatch',
    because: '"reviewing your employee’s output is a dispatch too" — reviewer reads the code',
  },
]

interface Outcome {
  readonly scenario: Scenario
  readonly dispatched: readonly string[]
  readonly costUsd: number | null
  readonly failed: boolean
  readonly note: string | null
}

async function runOne(
  root: string,
  prefix: string,
  scenario: Scenario,
  roster: ReadonlySet<string>,
): Promise<Outcome> {
  const dispatched: string[] = []
  // Set when we stop a run ourselves. A run we killed reports `isError`, and reading that as a
  // failed scenario would mark every correct dispatch as a failure.
  let stoppedOnPurpose = false

  const handle = runClaude(
    {
      cwd: root,
      agent: 'manager',
      prompt: `${prefix}\n\n---\n\n${scenario.request}`,
    },
    (event: ClaudeEvent) => {
      // The parser already models delegation, so this counts facts rather than guessing from
      // prose. `agent` is who it went to — a dispatch to somebody with no desk is its own
      // failure and shows up here as a name that is not on the roster.
      if (event.kind !== 'task-started') return
      dispatched.push(event.agent ?? '(unnamed)')

      // The question is answered. Letting the dispatched agent finish would spend real money to
      // learn something already known — and for the expensive scenarios that is most of the
      // bill. Only safe in this direction: *did not dispatch* cannot be concluded early,
      // because the dispatch might be the next thing it does.
      if (scenario.expect === 'dispatch') {
        stoppedOnPurpose = true
        handle.interrupt()
      }
    },
  )

  const summary = await handle.done

  // The verdict is `src/shared/eval.ts`'s, which is the only part of this file a test can reach.
  // It also now counts an off-roster dispatch as a failure, which this file used to print beside
  // a scenario it had already called `ok`.
  const { failed, note } = verdict(
    scenario.expect,
    { dispatched, isError: summary.isError, stoppedOnPurpose },
    roster,
  )

  return { scenario, dispatched, costUsd: summary.costUsd, failed, note }
}

async function main(): Promise<void> {
  const root = process.argv[2] ?? process.cwd()
  const ws = await discoverWorkspace(root)
  const roster = new Set(ws.employees.map((e) => e.id))

  // The same blocks the app sends, so this measures the manager the user has rather than a
  // manager with a prompt nobody ships.
  //
  // `findManager`, not `e.id === 'manager'`. #128 deleted that comparison from `lintEmployee`,
  // where it decided *who the manager is* by name while `main.ts` used the delegation fallback —
  // so the office flagged its own manager. This file kept a copy, and it is the worst place for
  // one: in a workspace whose manager is called anything else, the eval builds a `## CURRENT
  // STAFF` block with **nobody marked as manager**, hands it to the model, and then judges
  // whether the model delegated correctly. Every verdict is derived from a block that
  // mis-describes the thing being measured.
  //
  // Found by `office-space-6c`. The comment above already said this measures "the manager the
  // user has"; the line under it said otherwise.
  const manager = findManager(ws.employees)
  const prefix = officeBlocks({
    project: 'The office',
    mode: 'building',
    staff: ws.employees.map((e) => ({
      id: e.id,
      description: e.description,
      tools: e.tools,
      isManager: e.id === manager,
    })),
    skills: ws.skills.map((s) => ({ id: s.id, description: s.description })),
  }).join('\n\n')

  console.log('\nDelegation eval — real runs, real money, not deterministic.')
  console.log(`Workspace: ${root}`)
  console.log(`Roster:    ${[...roster].join(', ')}\n`)

  const outcomes: Outcome[] = []
  for (const scenario of SCENARIOS) {
    process.stdout.write(`  ${scenario.name.padEnd(44)}`)
    const outcome = await runOne(root, prefix, scenario, roster)
    outcomes.push(outcome)

    const did = outcome.dispatched.length > 0 ? `dispatched → ${outcome.dispatched.join(', ')}` : 'answered itself'
    console.log(`${outcome.failed ? 'FAIL' : 'ok  '}  ${did}`)
    if (outcome.failed) console.log(`${''.padEnd(46)}expected to ${outcome.scenario.expect}: ${outcome.scenario.because}`)
    if (outcome.note) console.log(`${''.padEnd(46)}${outcome.note}`)
  }

  const { passed, total, spentUsd } = tally(outcomes)
  const failed = outcomes.filter((o) => o.failed)

  console.log(`\n${passed}/${total} as expected · $${spentUsd.toFixed(4)} spent\n`)
  if (failed.length) {
    console.log('A single failure is the model being a model. The same failure twice is a prompt')
    console.log('that stopped working — read the rule named beside it before changing anything.\n')
  }
  process.exitCode = failed.length ? 1 : 0
}

await main()
