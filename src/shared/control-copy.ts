/**
 * What the dials actually mean, in words, for the person choosing.
 *
 * Reported of the three pickers above the composer: clicking them gives a really bad default
 * option, with no UI and no UX to it. That is right twice over, and the
 * second half is this file.
 *
 * The first half is that they were native `<select>` elements — drawn by the operating system,
 * unstyleable, and unable to show anything but a single line of text per option. The second half
 * is that the line of text was `acceptEdits`. That is a flag name. It tells somebody who already
 * knows what it does that it is still selected, and it tells everybody else nothing at all —
 * while being the control that decides whether an agent may write to their repository without
 * stopping to ask.
 *
 * Every explanation below already existed in this codebase, in the doc comments of
 * `controls.ts`, written carefully and read by nobody. Moving them where the choice is made is
 * most of the work; the rest is a listbox that has room for them.
 *
 * Pure data with no DOM, so the wording can be tested — and it is, because the failure mode of a
 * file like this is an option that quietly loses its description and shows a bare flag name
 * again.
 */

/** One option, as the picker shows it. */
export interface Choice {
  /** The value passed to the CLI. Never rewritten for display — this is what will run. */
  readonly value: string
  /** What it says in the list. The CLI's own word, unless that word is a lie about the default. */
  readonly label: string
  /** One line, in the second person. Says what happens, not what it is called. */
  readonly detail: string
}

/**
 * Which model answers.
 *
 * Aliases rather than pinned names, which is `controls.ts`'s decision and worth restating where
 * somebody is choosing: an alias resolves to the newest model in its family, so an office left
 * on a shelf for six months still reaches for something current.
 */
export const MODEL_CHOICES: readonly Choice[] = [
  { value: 'default', label: 'default', detail: 'Whatever your CLI is already configured to use.' },
  { value: 'opus', label: 'opus', detail: 'The most capable. For work where being confidently wrong is expensive.' },
  { value: 'sonnet', label: 'sonnet', detail: 'Ordinary engineering — implement, test, review a small diff.' },
  { value: 'haiku', label: 'haiku', detail: 'Fast and cheap. For work that is mechanical and already specified.' },
  { value: 'fable', label: 'fable', detail: 'Chosen when you have a specific reason to prefer it.' },
]

/**
 * How hard it thinks before answering.
 *
 * The distinction worth putting in front of somebody, and it is not "more is better": **effort
 * is for work that fails by not looking hard enough** — skipping a file, not checking a claim.
 * A bigger *model* is for work that fails by being confidently wrong with everything already in
 * front of it. Raising effort on a model that understood the problem buys latency and nothing
 * else.
 */
export const EFFORT_CHOICES: readonly Choice[] = [
  { value: 'default', label: 'default', detail: 'The CLI decides how long to think.' },
  { value: 'low', label: 'low', detail: 'Answer quickly. For work that needs no deliberation.' },
  { value: 'medium', label: 'medium', detail: 'A moderate amount of thinking before answering.' },
  { value: 'high', label: 'high', detail: 'Think it through. For work that fails by not looking hard enough.' },
  { value: 'xhigh', label: 'xhigh', detail: 'Longer still. Slower, and rarely the difference on its own.' },
  { value: 'max', label: 'max', detail: 'As long as it takes. Expensive, and seldom what a stuck task needs.' },
]

/**
 * What the office may do without stopping to ask.
 *
 * The one that matters, and the one whose bare flag names are least legible. Two are worth
 * knowing apart from the rest: `plan` changes nothing at all, and `bypassPermissions` asks for
 * nothing at all. Both are offered because the CLI offers them and hiding either would not make
 * it less available — but the copy says plainly which is which.
 */
export const PERMISSION_CHOICES: readonly Choice[] = [
  {
    value: 'default',
    label: 'default',
    detail: 'Follows the allow and deny rules in .claude/settings.json.',
  },
  {
    value: 'plan',
    label: 'plan',
    detail: 'Reads and proposes. Changes nothing on disk — the mode to use before a large piece of work.',
  },
  {
    value: 'acceptEdits',
    label: 'accept edits',
    detail: 'Writes and edits files without asking. Commands still follow the rules.',
  },
  {
    value: 'dontAsk',
    label: "don't ask",
    detail: 'Stops asking, and refuses anything the rules do not already allow.',
  },
  {
    value: 'bypassPermissions',
    label: 'bypass permissions',
    // Was: "Asks for nothing and checks nothing. Everything this office starts may run."
    //
    // Two things were wrong with that. It did not ask for nothing — the office's own approval
    // gate had never been told the mode existed, so it asked for everything anyway. And now that
    // the gate honours the mode, the sentence would be wrong in the other direction: the deny
    // list still holds, on purpose. A deny is a standing instruction; a mode is an afternoon.
    //
    // Then: "Runs anything the rules have not explicitly denied, without asking. The deny list
    // still holds." Too much again. Claude Code keeps ask rules in bypass mode: under `--print`
    // an ask rule refused the call, even with a PreToolUse hook answering `allow` as the office's
    // gate does (measured against 2.1.266 on 2026-09-16). A deny rule refuses in bypass there
    // too, so the deny half is Claude Code's rule as much as the office's.
    //
    // And then: "Runs anything the rules neither deny nor ask about, without asking. Anything
    // they deny or ask about is refused." Still too much. Even in bypass mode, Claude Code asks
    // before a few actions no rule denies, removing a critical path among them, and under
    // `--print` asking is refusing (its docs, repeated; not measured here).
    detail:
      'Runs without asking anything the rules neither deny nor ask about, except a few actions ' +
      'Claude Code always asks about. Everything else is refused.',
  },
]

/**
 * Whether a choice deserves to be marked as carrying consequences.
 *
 * Exactly one does. `bypassPermissions` removes the question that stands between an agent and
 * almost any command its rules do not mention. Claude Code still asks about a few, removing a
 * critical path among them, and under `--print` refuses those. A picker that presents it in the
 * same weight as `plan` is presenting a decision as a preference. Nothing here refuses it — the
 * CLI offers it and so do we — it is marked.
 */
export function isGrave(value: string): boolean {
  return value === 'bypassPermissions'
}

/** The choices for a dial, by the key `Controls` uses. */
export function choicesFor(key: 'model' | 'effort' | 'permissionMode'): readonly Choice[] {
  if (key === 'model') return MODEL_CHOICES
  if (key === 'effort') return EFFORT_CHOICES
  return PERMISSION_CHOICES
}

/**
 * What the closed picker reads as.
 *
 * `default` is the value that needs help. Shown as itself it says nothing — three pickers all
 * reading "default" is three words of chrome telling you nothing about the turn you are about to
 * send. Shown as the dial's *name* it says which dial it is and that it is unset, which is the
 * whole of what a closed control has room to say.
 */
export function triggerLabel(key: 'model' | 'effort' | 'permissionMode', value: string): string {
  if (value !== 'default') {
    return choicesFor(key).find((c) => c.value === value)?.label ?? value
  }
  return key === 'model' ? 'model' : key === 'effort' ? 'effort' : 'permissions'
}
