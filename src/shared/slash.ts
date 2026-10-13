/**
 * When the slash menu should appear, and what it should show.
 *
 * Separate from the menu itself, and the separation is the repo's existing rule rather than a
 * preference: renderer code that touches `document` cannot be tested from the node config, so
 * the parts worth testing are the parts that do not. `props.ts` is the precedent — a thousand
 * lines of drawing with no DOM reference in it.
 *
 * Both functions here are decisions that look obviously right until somebody types something
 * ordinary.
 */

import type { Invocable } from './ipc.js'

/**
 * The command name being typed, or `null` if the composer is not on one.
 *
 * The menu appears only when a message **starts** with a slash, because that is the only case
 * the CLI treats as a command. `the binary is in /usr/local/bin` is prose, and a menu opening
 * under the cursor there is the office interrupting somebody to offer something they did not
 * ask for.
 */
export function slashToken(text: string, caret: number): string | null {
  if (!text.startsWith('/')) return null

  // Only while the caret is still inside the first token. Past the space you are typing
  // arguments, the choice is already made, and a list of commands is no longer what you need in
  // front of you — but going back to fix a typo in the name should bring it back.
  const firstSpace = text.indexOf(' ')
  if (firstSpace !== -1 && caret > firstSpace) return null

  return (firstSpace === -1 ? text : text.slice(0, firstSpace)).slice(1)
}

/**
 * What matches, best first.
 *
 * A prefix match outranks a match in the middle, because typing `re` means "the thing starting
 * with re" — and ranking by position is what makes the first Enter press land on what somebody
 * meant rather than on whatever sorted first alphabetically.
 */
export function filterItems(items: readonly Invocable[], token: string): readonly Invocable[] {
  if (token === '') return items
  const needle = token.toLowerCase()

  return items
    .filter((i) => i.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(needle)
      const bp = b.name.toLowerCase().startsWith(needle)
      if (ap !== bp) return ap ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}
