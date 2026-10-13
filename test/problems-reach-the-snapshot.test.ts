/**
 * Every problem the main process collects has to reach the snapshot, because the snapshot is
 * the only way one gets on screen.
 *
 * `themeProblems` did not, and had not since it was written. It was declared, filled from the
 * theme scan, pushed to when a pack failed mid-draw, and deduped by path — and read by nothing.
 * `reportThemeFailure` appended to it, set the theme back to procedural, and sent a fresh
 * snapshot that did not carry it, so the function whose stated job was to *say a theme let us
 * down* performed the silent downgrade and dropped the saying. Somebody who bought an art pack,
 * dropped it in and had it fail got the drawn cast and no explanation.
 *
 * Nothing was individually wrong. The scan collected correctly, the mapping to `Problem` was
 * right, the dedupe was right, and the snapshot correctly folded in the eight other sources.
 * One spread was missing, and no test could see it because the promise was kept in prose:
 * `theme.ts`, the declaration, `findThemes` and the note explaining why `ThemeSelection` was
 * deleted all describe this fold, and the last one reasons that the type was safe to remove
 * *because* the fold already worked.
 *
 * So the check is not "themeProblems is spread" — that is the bug, not the rule. The rule is
 * that a `Problem` collection at module scope exists to be shown, and one that nothing shows is
 * either a missing spread or a variable that should not exist.
 *
 * ## What this cannot see
 *
 * It reads source rather than running the app, so it checks that the name appears inside the
 * array, not that the value is correct when it does. A spread of the wrong variable, or one
 * behind a condition that is never true, passes here. That is the honest limit of a scanner,
 * and it is worth having anyway: the failure it catches is the one that actually happened, and
 * the two it cannot catch have never happened.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const main = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'main.ts')

/**
 * The `problems: [ … ]` array *inside `toSnapshot`*, by bracket matching rather than by regex.
 *
 * Both halves of that sentence are scars.
 *
 * A regex would have to stop at the first `]`, and the entries contain `[trustProblem]` and
 * friends — so it would read about a fifth of the array and call the rest missing.
 *
 * And searching the file from the top finds `problems: []` on the `ProjectScan` initialiser
 * two hundred lines earlier, which bracket-matches to an empty array containing none of the
 * names. The first draft of this test did exactly that and reported all nine collections as
 * unread — failing, correctly, for a reason that had nothing to do with the bug, and pointing
 * at eight variables that were fine. A test that fails for the wrong reason buys as little as
 * one that passes for the wrong reason, and costs the next person the same afternoon.
 */
function problemsArray(source: string): string {
  const fn = source.indexOf('function toSnapshot')
  assert.notEqual(fn, -1, '`toSnapshot` is gone from main.ts — this test is looking for the wrong thing')

  const start = source.indexOf('problems: [', fn)
  assert.notEqual(start, -1, 'no `problems: [` inside `toSnapshot` — the snapshot no longer carries problems')

  let depth = 0
  for (let i = source.indexOf('[', start); i < source.length; i++) {
    if (source[i] === '[') depth++
    else if (source[i] === ']' && --depth === 0) return withoutComments(source.slice(start, i + 1))
  }
  assert.fail('the `problems: [` array is never closed — main.ts does not parse')
}

/**
 * Comments removed, because a comment naming a variable is not that variable being read.
 *
 * This was not caution. The fix that came with this test carries a comment explaining what the
 * missing spread cost, and that comment names `themeProblems` — so deleting the spread and
 * leaving the comment kept the test green. The check written to catch a promise made in prose
 * was, for one draft, satisfied by prose.
 *
 * The array holds no string containing `//`, so this is exact on the input it has; it is not a
 * general TypeScript comment stripper and would not survive being pointed at one that did.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

test('every Problem the main process collects reaches the snapshot', async () => {
  const source = await readFile(main, 'utf8')
  const array = problemsArray(source)

  // Module scope only. A `Problem` built inside a function is a local on its way to one of
  // these, and requiring it here would be requiring the wrong thing.
  //
  // `const` as well as `let`, and digits and underscores in the name. Both were `let` and
  // `[A-Za-z]+` when this was written, which matched every collection that existed and would
  // have silently skipped the next one: `const soundProblems: Problem[] = []` never spread was
  // invisible, and so was `let soundProblems2`. The floor below catches a collection that stops
  // being counted; it cannot catch one that was never counted, so the pattern has to be right
  // rather than merely sufficient today.
  const declared = [
    ...source.matchAll(/^(?:let|const) ([A-Za-z_][A-Za-z0-9_]*): Problem(?:\[\]| \| null)/gm),
  ].map((m) => m[1]!)

  assert.ok(
    declared.length >= 9,
    `found only ${declared.length} problem collections in main.ts — the declaration spelling has ` +
      'changed and this test is now checking almost nothing, which is worse than failing',
  )

  // Whole word. `array.includes(name)` is a substring test, and `...themeProblemsSeen,` contains
  // `themeProblems` — so renaming the spread to a companion collection while leaving the
  // original collected and shown nowhere passed this test. That is not a contrived rename:
  // main.ts already dedupes with `themeProblems.some((p) => p.path === path)`, and a
  // `themeProblemsSeen` beside it is the obvious refactor of that line.
  const spread = (name: string): boolean => new RegExp(`\\b${name}\\b`).test(array)
  const unread = declared.filter((name) => !spread(name))

  assert.deepEqual(
    unread,
    [],
    `collected and never shown: ${unread.join(', ')}. A Problem list at module scope exists to ` +
      'reach the reader, and the only route is the snapshot. Either spread it into `problems: [ ' +
      '… ]` in `toSnapshot`, or delete it — a list that is filled and never read is worse than ' +
      'no list, because the code around it reads as if somebody is being told.',
  )
})
