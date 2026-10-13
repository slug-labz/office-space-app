/**
 * Everything the app itself can do, as a list.
 *
 * Two different things are called a command in this workspace and keeping them apart is the
 * point of this file. A **slash command** is something you send to Claude — `/state`, `/verify`
 * — and it lives in `.claude/commands/`, is discovered from the filesystem, and goes into the
 * composer. An **action** is something *Office Space* does: open the roster, hire somebody, put
 * the pane on the left. It never reaches the CLI and never appears in a transcript.
 *
 * `shared/slash.ts` is the first; this is the second. Merging them into one menu was tempting
 * and would have been wrong — the two lists have different consequences, and a person picking
 * from a menu should not have to know which half of it costs money.
 *
 * The exit condition this serves: *every shipped capability is reachable with a mouse or the
 * keyboard.* An action registered here is reachable by typing three letters, which makes the
 * keyboard half true for anything that gets added later without anybody having to remember to
 * add a shortcut.
 */

import { subsequenceStart } from './match.js'

/** What an action is, apart from the function it runs. */
export interface Action {
  readonly id: string
  /** What it says in the list. Imperative: "Open the roster", not "Roster". */
  readonly label: string
  /** Where it belongs, for grouping and for searching by category. */
  readonly group: 'Office' | 'Project' | 'View' | 'Session'
  /** The accelerator, if it has one. Shown right-aligned; never invented for the display. */
  readonly keys?: string
  /** Extra words to match on that are not in the label — what somebody would actually type. */
  readonly also?: readonly string[]
}

/**
 * Filter by what has been typed.
 *
 * Subsequence matching on the label, the group and the `also` words: typing `phv` finds
 * "Privacy". That is what makes a palette worth opening rather than a menu with a search box —
 * you type the shape of the thing, not its prefix.
 *
 * Ordering is by where the match starts, so an exact prefix beats a scattered subsequence. Ties
 * keep the declared order, which is the order somebody chose deliberately.
 */
export function filterActions(actions: readonly Action[], query: string): readonly Action[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return actions

  const scored: { action: Action; score: number }[] = []

  for (const [index, action] of actions.entries()) {
    const haystacks = [action.label, action.group, ...(action.also ?? [])]
    let best: number | null = null

    for (const hay of haystacks) {
      const at = subsequenceStart(hay.toLowerCase(), needle)
      if (at !== null && (best === null || at < best)) best = at
    }

    // The declared order breaks ties, scaled so it can never outweigh a genuinely better match.
    if (best !== null) scored.push({ action, score: best * 1000 + index })
  }

  return scored.sort((a, b) => a.score - b.score).map((s) => s.action)
}

/** Grouped for display, in the order the groups first appear. */
export function byGroup(actions: readonly Action[]): readonly { group: string; actions: readonly Action[] }[] {
  const groups = new Map<string, Action[]>()
  for (const action of actions) {
    const list = groups.get(action.group)
    if (list) list.push(action)
    else groups.set(action.group, [action])
  }
  return [...groups.entries()].map(([group, list]) => ({ group, actions: list }))
}
