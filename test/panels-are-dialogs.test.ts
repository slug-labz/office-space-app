/**
 * Every panel the app makes the rest of the world `inert` for must say it is a modal dialog.
 *
 * `watchPanels` sets `inert` on the whole app shell while one of `coveringPanels()` is open, so
 * the panel really is modal: nothing behind it is in the tab order or the hit test. A screen
 * reader is told none of that by `<aside hidden>` — it needs `role="dialog"`, `aria-modal`, and
 * a name — and without them the panel arrives as an unnamed region while the app it is covering
 * silently stops responding.
 *
 * This is a join, and the join is what this repository keeps being caught by. `coveringPanels()`
 * lives in `app.ts`; the roles live in `index.html`. Add a seventh panel to that array — which is
 * exactly what you do when you add a panel, because that is the array that makes the scrim
 * appear — and the app will make everything inert for a panel that never announces itself. There
 * is no error and nothing to see; it is only wrong for the people who cannot see it anyway.
 *
 * ## What the name has to be
 *
 * The accessible name must be the panel's own visible title. The roster and privacy panels each
 * carry an `<h3>` holding an absolute filesystem path — `/Users/…/office-space/.claude` — and
 * naming the panel by it was the first thing this test caught, in the commit that added it. That
 * is a name that is technically present, passes every "does it have a label" check, and is
 * useless to read aloud. So the labelling ids are pinned rather than merely required to exist.
 *
 * ## What this cannot check
 *
 * That the name is *good*. Only that it comes from the elements chosen here, and that those
 * elements exist. Whether "Verified, not believed — The office" is the right thing to hear when a
 * task list opens is a judgement, and a test that claimed to have made it would be lying.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(root, 'src', 'renderer', 'index.html'), 'utf8')
const app = readFileSync(join(root, 'src', 'renderer', 'app.ts'), 'utf8')

/** `els` maps a name to an id. Read it, so the panels below are found the way `app.ts` finds them. */
function elementIds(): Map<string, string> {
  const ids = new Map<string, string>()
  for (const m of app.matchAll(/(\w+):\s*\$(?:<[^>]+>)?\('([\w-]+)'\)/g)) ids.set(m[1]!, m[2]!)
  return ids
}

/**
 * The table that decides what the scrim covers and what the shell goes inert for.
 *
 * Was `coveringPanels()`, a literal array. It is now derived from `panels()` — the single
 * declaration that `escapables()`, `coveringPanels()` and `closeEverything()` are all views of —
 * so this reads the entries marked `covering: true`. The assertion below is the same guard the
 * old parser had, and it fired correctly when the array became a table: a test that silently
 * finds nothing is a test that passes vacuously, which is the failure mode of every check that
 * has to locate the thing it checks.
 */
function coveringPanelIds(): string[] {
  const body = /function panels\(\)[\s\S]*?return \[([\s\S]*?)\n  \]/.exec(app)?.[1]
  assert.ok(body, 'panels() has been renamed or restructured — this test can no longer find what it guards')
  const ids = elementIds()
  const found: string[] = []

  for (const entry of body.matchAll(/\{\s*el:\s*els\.(\w+),[^}]*covering:\s*(true|false)\s*\}/g)) {
    if (entry[2] !== 'true') continue
    const name = entry[1]!
    const id = ids.get(name)
    assert.ok(id, `panels() names els.${name}, which is not an id lookup in app.ts`)
    found.push(id)
  }
  return found
}

function openingTagOf(id: string): string {
  const tag = new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0]
  assert.ok(tag, `#${id} is in coveringPanels() and not in index.html`)
  return tag
}

const attr = (tag: string, name: string): string | null =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null

test('every covering panel declares itself a modal dialog', () => {
  const panels = coveringPanelIds()

  // The control. If this list ever comes back empty the assertions below all pass vacuously,
  // which is the failure mode of every check that iterates something it also has to find.
  assert.ok(panels.length >= 6, `coveringPanels() yielded ${panels.length} panels, which is fewer than ship — the parse is wrong, not the app`)

  const wrong: string[] = []
  for (const id of panels) {
    const tag = openingTagOf(id)
    if (attr(tag, 'role') !== 'dialog') wrong.push(`#${id} has no role="dialog"`)
    if (attr(tag, 'aria-modal') !== 'true') wrong.push(`#${id} has no aria-modal="true" — the shell goes inert for it, so this is a fact rather than a claim`)
    const labelledBy = attr(tag, 'aria-labelledby')
    if (labelledBy === null || labelledBy.trim() === '') wrong.push(`#${id} has no aria-labelledby, so it opens as an unnamed dialog`)
  }

  assert.deepEqual(
    wrong,
    [],
    'these panels make the whole app inert and do not announce themselves:\n  ' + wrong.join('\n  '),
  )
})

test('every panel is named by elements that exist, and not by a filesystem path', () => {
  // Pinned, not merely required to exist. `roster-root` and `privacy-root` hold an absolute path
  // at runtime; naming a dialog by one passes any check that only asks whether a label is
  // present, and reads the whole path aloud.
  const EXPECTED: Record<string, string> = {
    'task-panel': 'task-label task-project',
    'roster-panel': 'roster-label',
    'privacy-panel': 'privacy-label',
    // Its heading alone. Everything else on this panel is a percentage or a window name, and a
    // dialog that announced "72%" on open would be reading a number to somebody who asked what
    // the panel was.
    'plan-panel': 'plan-label',
    // Its own heading and nothing else. Added when `changed-panel` joined `panels()` — it had
    // never been in any of the three panel lists, so this test had never iterated it and had no
    // pin for it. The absence was invisible for the same reason the panel's other faults were:
    // every check here starts from a list the panel was missing from.
    'changed-panel': 'changed-label',
    // Named by its label alone, deliberately. The roster and privacy panels have a second element
    // holding an absolute filesystem path, and this one has none — `memory/` is one directory and
    // saying so is the label's job.
    'memory-panel': 'memory-label',
    // Same reasoning as memory's: its own heading and nothing else. The record lives under one
    // directory this panel never prints a path to, so there is no second element for the name to
    // reach into and read an absolute path aloud.
    'decided-panel': 'decided-label',
    // Same reasoning: its own heading and nothing else. The source a person types goes in an
    // input, not into the dialog's name — a panel that announced the last URL somebody pasted
    // would be reading their clipboard back at them on every open.
    'maintained-panel': 'maintained-label',
    // Its heading alone. Every other candidate on this panel is a path or a command line — a
    // dialog that announced `node "$CLAUDE_PROJECT_DIR/.claude/hooks/..."` on open would be
    // reading a shell command aloud to somebody who asked what runs here.
    'hooks-panel': 'hooks-label',
    // Its heading and nothing else, for the same reason. What is in the form is a service name
    // and a variable name, and neither belongs in what a screen reader announces on open.
    'connect-panel': 'connect-label',
    // Its heading alone. The obvious second candidate is the query field, and naming the dialog
    // by it would mean the panel announces itself differently on every open — and announces the
    // last thing somebody searched for. The input carries its own name; the dialog carries this.
    'search-panel': 'search-label',
    'settings-panel': 'settings-label settings-head',
    'firstrun-panel': 'firstrun-label firstrun-head',
    card: 'card-role card-name',
  }

  for (const id of coveringPanelIds()) {
    const labelledBy = attr(openingTagOf(id), 'aria-labelledby')
    assert.equal(
      labelledBy,
      EXPECTED[id],
      `#${id} is named by ${JSON.stringify(labelledBy)}. If that is deliberate, read it aloud first — ` +
        `#roster-root and #privacy-root hold an absolute filesystem path, and a dialog named by one ` +
        `announces "/Users/…/office-space/.claude" every time it opens.`,
    )

    for (const target of (labelledBy ?? '').split(/\s+/).filter(Boolean)) {
      assert.match(
        html,
        new RegExp(`\\bid="${target}"`),
        `#${id} is labelled by #${target}, which is not in the markup — an aria-labelledby ` +
          `pointing at nothing produces no name at all, silently`,
      )
    }
  }
})

test('no panel is nested inside another', async () => {
  /*
   * `#changed-panel` lost its `</aside>` when `#hooks-panel` was inserted after `changed-body`,
   * so every element that followed — nine panels and **the command palette** — became a child of
   * a panel that ships `hidden`.
   *
   * What a person saw: pressing ⌘K or clicking the button did nothing at all. Nothing was broken
   * in the palette. It opened correctly every time, and rendered 24 rows, at 0 x 0 — because
   * `position: fixed` does not escape a `display: none` ancestor. There was no exception, so the
   * fault reporter had nothing to report, and every one of 2423 tests passed.
   *
   * Nothing here could see it. `escape.test.ts`, `no-panel-is-a-trap.test.ts` and the roles check
   * all read panels *by id* — `getElementById` finds a nested element exactly as well as a
   * top-level one. The markup-vs-list join added for `changed-panel` finds panels the lists
   * forgot; it does not care where they sit.
   *
   * So this checks the one thing none of them do: that a panel's parent is not another panel. Tag
   * balance alone would not catch it either — the file has eleven `<aside>` and eleven
   * `</aside>` while nested.
   */
  const html = await readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8')

  /*
   * Depth-counted rather than parsed, because the failure is precisely a missing close tag and a
   * forgiving parser is what hid it in the browser. Every `<aside` increments, every `</aside>`
   * decrements; a panel opening at depth > 0 is inside another one.
   */
  const nested: string[] = []
  let depth = 0
  for (const m of html.matchAll(/<aside\b[^>]*?(?:id="([^"]+)")?[^>]*>|<\/aside>/g)) {
    if (m[0] === '</aside>') { depth -= 1; continue }
    if (depth > 0) nested.push(m[1] ?? '(unnamed)')
    depth += 1
  }

  assert.deepEqual(
    nested,
    [],
    'these panels are nested inside another panel, so they inherit its `hidden` and can never be ' +
      'shown — and neither can anything after them, including the command palette',
  )
  assert.equal(depth, 0, `unbalanced <aside> tags: ${depth} left open at end of file`)
})
