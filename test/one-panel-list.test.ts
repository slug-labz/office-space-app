/**
 * There is one list of panels, and everything that needs one is a view of it.
 *
 * ## What this is for
 *
 * `app.ts` had **three** hard-coded lists that all had to name the same surfaces: `escapables()`
 * decided what Escape considers open, `closeEverything()` decided what it actually closes, and
 * `coveringPanels()` decided what the scrim covers and what the shell goes `inert` for. The
 * comment above the first of them said *"One list, because there were two and they drifted"* —
 * written when a fourth was folded in, and untrue again by the time it was read.
 *
 * Every way of getting it wrong is silent and each is wrong differently:
 *
 *   - In `escapables` and not `closeEverything`: Escape sees the panel, decides something is
 *     open, closes everything *else*, and leaves it there. The hooks panel shipped like this.
 *   - In `closeEverything` and not `escapables`: Escape does not believe anything is open, so it
 *     falls through to *stopping the running turn* instead. The music panel shipped like this.
 *   - Not in `coveringPanels`: no scrim, the shell stays live behind a modal, and the panel does
 *     not take the floor from whatever else was open.
 *
 * None of the three raises an error, and in each case the obvious fix is to add the panel to the
 * one array that was wrong — which leaves the next person to find it the same way.
 *
 * ## What is asserted
 *
 * Two things, and the second is the one that matters:
 *
 *   1. **The three functions hold no list of their own.** They must be derived from `panels()`.
 *      This is what stops the merge being quietly undone by somebody adding "just one" array back.
 *   2. **The table and the markup agree, in both directions.** Every `<aside class="card…" hidden>`
 *      in `index.html` is a covering panel in the table, and every covering panel in the table is
 *      one of those elements. A panel you can build without the app knowing about it is the whole
 *      bug; this is the join that makes that impossible rather than merely unlikely.
 *
 * These read source rather than running it, so they are checks on a shape and not on behaviour.
 * That the merged list *works* is not something a parser can tell you — it was established by
 * opening every panel in the running app and pressing Escape.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(join(root, 'src', 'renderer', 'app.ts'), 'utf8')
const html = readFileSync(join(root, 'src', 'renderer', 'index.html'), 'utf8')

/** The body of a named function, by brace depth — the table spans lines a regex would give up on. */
function bodyOf(name: string): string {
  const at = app.indexOf(`function ${name}(`)
  assert.notEqual(at, -1, `${name}() is gone or renamed — this test can no longer find what it guards`)

  const open = app.indexOf('{', at)
  let depth = 0
  for (let i = open; i < app.length; i++) {
    if (app[i] === '{') depth += 1
    else if (app[i] === '}') {
      depth -= 1
      if (depth === 0) return app.slice(open + 1, i)
    }
  }
  assert.fail(`${name}() has no closing brace, which means this parser is wrong rather than the app`)
}

/** `els` maps a name to an id. Read it, so panels are found the way `app.ts` finds them. */
function elementIds(): Map<string, string> {
  const ids = new Map<string, string>()
  for (const m of app.matchAll(/(\w+):\s*\$(?:<[^>]+>)?\('([\w-]+)'\)/g)) ids.set(m[1]!, m[2]!)
  return ids
}

interface Entry {
  readonly name: string
  readonly close: string
  readonly covering: boolean
}

function table(): readonly Entry[] {
  const body = bodyOf('panels')
  const entries = [
    ...body.matchAll(/\{\s*el:\s*els\.(\w+),\s*close:\s*(\w+),\s*covering:\s*(true|false)\s*\}/g),
  ].map((m) => ({ name: m[1]!, close: m[2]!, covering: m[3] === 'true' }))

  // The control. A parser that finds nothing makes every assertion below pass vacuously, which is
  // the failure this repository has now been caught by four times in its own instruments.
  assert.ok(
    entries.length >= 10,
    `panels() yielded ${entries.length} entries, which is fewer than ship — the parse is wrong, not the app`,
  )
  return entries
}

test('the three views hold no list of their own', () => {
  // Each must go through `panels()`, and none may name a panel element directly. `closeEverything`
  // is allowed `els.composer`, which is where focus goes afterwards and is not a panel.
  for (const name of ['escapables', 'coveringPanels', 'closeEverything']) {
    const body = bodyOf(name)

    assert.match(
      body,
      /panels\(\)/,
      `${name}() no longer reads panels(), so it is a second list again — that is the bug this file exists for`,
    )

    const named = [...body.matchAll(/els\.(\w+)/g)].map((m) => m[1]!).filter((n) => n !== 'composer')
    assert.deepEqual(
      named,
      [],
      `${name}() names ${named.join(', ')} directly. Add it to panels() instead; a surface named here and ` +
        `not there is a surface the other two views do not know about.`,
    )
  }
})

test('every panel is closed by its own function, and no two share one', () => {
  const closers = table().map((e) => e.close)
  assert.deepEqual(
    closers.filter((c, i) => closers.indexOf(c) !== i),
    [],
    'two panels share a close function, so closing one silently does nothing to the other',
  )
})

test('the table and the markup name the same covering panels, in both directions', () => {
  const ids = elementIds()

  const inTable = table()
    .filter((e) => e.covering)
    .map((e) => {
      const id = ids.get(e.name)
      assert.ok(id, `panels() names els.${e.name}, which is not an id lookup in app.ts`)
      return id
    })
    .sort()

  /*
   * Every modal card in the markup.
   *
   * Matched on `<aside class="card…" hidden>` rather than on `role="dialog"`. The role is what
   * `panels-are-dialogs.test.ts` asserts *about the panels in the table*, so keying this off it
   * too would make the pair circular: a panel added with neither the role nor a table entry would
   * satisfy both. The class and the `hidden` attribute are what you cannot leave off and still
   * have something that looks and behaves like a panel.
   */
  const inMarkup = [...html.matchAll(/<aside\b[^>]*\bclass="card[^"]*"[^>]*>/g)]
    .filter((m) => /\bhidden\b/.test(m[0]!))
    .map((m) => /\bid="([\w-]+)"/.exec(m[0]!)?.[1])
    .filter((id): id is string => id !== undefined)
    .sort()

  assert.ok(inMarkup.length >= 10, `found ${inMarkup.length} panels in index.html, which is fewer than ship`)

  assert.deepEqual(
    inTable,
    inMarkup,
    'a modal card exists that panels() does not know about, or the other way round. One of them gets ' +
      'no scrim, is not covered by Escape, and does not take the floor — and nothing reports it at runtime.',
  )
})
