/**
 * Escape gets you out of everything, and there is one list saying what "everything" is.
 *
 * There were two. The key handler asked a hard-coded array whether anything was open, and only
 * then called `closeEverything()`, which closed a *different* set. Adding a surface to one and
 * not the other makes Escape silently stop working for it — which is exactly what happened to
 * the music panel: it opened, Escape looked at its array, saw nothing open, and did nothing. No
 * error, and the obvious fix is to add it to the array, which leaves the next surface to be
 * found the same way.
 *
 * Found by clicking every entry point in order in the running app rather than by testing one of
 * them, which is the only way a disagreement between two lists shows up.
 *
 * This checks the source rather than the DOM, for the reason the scale tests give: the
 * alternative is a full renderer harness for an invariant that is two lines of reading.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(join(root, 'src/renderer/app.ts'), 'utf8')

test('the Escape handler asks the shared list rather than one of its own', () => {
  assert.match(
    app,
    /escapables\(\)\.some\(\(panel\) => !panel\.hidden\)/,
    'Escape is deciding whether anything is open from an inline array again. Two lists that ' +
      'must agree will stop agreeing; ask escapables().',
  )
})

test('every surface Escape reports as open is one closeEverything actually closes', () => {
  /*
   * The invariant is the same; what keeps it changed.
   *
   * This used to read `escapables()` and `closeEverything()` as two literal lists and match a
   * panel to its closer by **stem substring** — `hooksPanel` → `hooks`, then
   * `closeEverything().includes('hooks')`. That worked, and it caught the real thing: the hooks
   * panel was added to `escapables()` and not to `closeEverything()`, and this assertion named it.
   *
   * It was doing the hardest possible job, though: proving two hand-written lists agree. A
   * substring match is the giveaway — it is what you reach for when the two sides have no
   * structural relation and only their names connect them, and it can be satisfied by a closer
   * that merely *contains* the stem. So the lists were merged into `panels()`, where each entry
   * carries its own element and its own closer and the two cannot be separated.
   *
   * What is asserted now is that construction, because it is what makes the invariant hold. If a
   * future entry ever gains an `el` without a `close`, the type would reject it — and if
   * `closeEverything` ever stops walking the table, this fails.
   */
  const closeBody = /function closeEverything\(\): void \{([\s\S]*?)\n\}/.exec(app)
  assert.ok(closeBody, 'closeEverything() has been renamed')

  assert.match(
    closeBody![1]!,
    /for \(const panel of panels\(\)\) panel\.close\(\)/,
    'closeEverything() no longer closes every panel in the shared table. If it has gone back to ' +
      'naming closers one by one, it is a second list again and Escape will stop closing whatever ' +
      'is missing from it.',
  )

  const table = /function panels\(\)[\s\S]*?return \[([\s\S]*?)\n  \]/.exec(app)
  assert.ok(table, 'panels() has been renamed or restructured — this test can no longer find what it guards')

  const entries = [...table![1]!.matchAll(/\{\s*el:\s*els\.(\w+),\s*close:\s*(\w+),/g)]
  assert.ok(entries.length >= 10, `only found ${entries.length} panels; the parse has drifted`)

  // Every surface Escape reports as open names a closer. The type says so too; this says it in
  // the file that cares, so a change to the shape of the table cannot quietly drop one.
  const withoutCloser = entries.filter((m) => !new RegExp(`function ${m[2]}\\(`).test(app)).map((m) => m[1])
  assert.deepEqual(
    withoutCloser,
    [],
    `these name a close function that does not exist in app.ts: ${withoutCloser.join(', ')}`,
  )
})
