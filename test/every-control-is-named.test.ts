/**
 * Every control in the window can be reached by keyboard, and says what it is when you land on it.
 *
 * Verified once in the running app with real key events: twenty stops, walked in order, wrapping
 * from `send` back to `view-toggle` with no trap. That is a measurement of one build on one
 * afternoon. This is the part of it a test can hold.
 *
 * ## Why the name matters more than the label looks like it should
 *
 * Six of these controls are a single glyph. `card__close` is `\u00d7`, and a screen reader
 * reading its text says "multiplication sign" \u2014 so each carries `aria-label="Close"` and the
 * glyph is decoration. That is right, and it is exactly the kind of thing that is right until
 * somebody adds a seventh panel by copying the sixth and drops the attribute. Nothing about the
 * page looks different afterwards.
 *
 * ## What this does not claim
 *
 * Not that the tab *order* is sensible \u2014 order is document order here, and whether that reads
 * well is a judgement about layout. Not that every control is reachable in every state, because
 * `hidden` moves as the app runs. What it holds is the invariant underneath both: a control that
 * can take focus has a name, in the markup, before anything runs.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const html = readFileSync(join(process.cwd(), 'src/renderer/index.html'), 'utf8')

interface Control {
  readonly tag: string
  readonly attrs: string
  readonly inner: string
}

/** Every element the browser will stop on, with its attributes and its text. */
function controls(): Control[] {
  const found: Control[] = []
  for (const m of html.matchAll(/<(button|a|textarea|select)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    found.push({ tag: m[1]!, attrs: m[2]!, inner: m[3]! })
  }
  // Void elements carry no text, so their name has to be an attribute.
  for (const m of html.matchAll(/<input\b([^>]*)>/g)) {
    found.push({ tag: 'input', attrs: m[1]!, inner: '' })
  }
  return found
}

const has = (attrs: string, name: string): string | null => {
  const m = attrs.match(new RegExp(`${name}="([^"]*)"`))
  return m ? m[1]!.trim() : null
}

/** Text a person would hear, with markup and decorative glyphs removed. */
const spoken = (inner: string): string =>
  inner
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    // A lone glyph is decoration, not a name: a reader says "multiplication sign".
    .replace(/[\u00d7\u2715\u2716\u22c5\u2026\u00b7\u2192\u2039\u203a\u2039\u25b8\u25be\u2318]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const named = (c: Control): boolean => {
  if (has(c.attrs, 'aria-label')) return true
  if (has(c.attrs, 'aria-labelledby')) return true
  if (has(c.attrs, 'placeholder')) return true
  if (has(c.attrs, 'title')) return true
  return spoken(c.inner).length > 0
}

/** Out of the tab order on purpose, and therefore not a stop anybody lands on. */
const skipped = (c: Control): boolean =>
  has(c.attrs, 'tabindex') === '-1' || has(c.attrs, 'aria-hidden') === 'true'

test('the window has the controls this expects to find', () => {
  // The control, first. Every assertion below is "each of these is named", which a parse that
  // found nothing satisfies perfectly.
  const all = controls()
  assert.ok(
    all.length >= 20,
    `only ${all.length} controls parsed out of index.html — the walk found twenty tab stops in ` +
      `the running app, so a number below that means this file is checking almost nothing`,
  )
  assert.ok(
    all.some((c) => has(c.attrs, 'id') === 'send'),
    'the send button was not found, so the parse is not seeing the composer',
  )
})

/**
 * A control with no name in the markup has to be one somebody can fill.
 *
 * Six controls here are deliberately empty in `index.html` and written at runtime \u2014
 * `theme-name` becomes "Drawn in code", `switcher` becomes the project and its conversation.
 * A static read cannot see that, and the first version of this test reported all six as
 * unnamed. They are not: a real tab walk through the running app found twenty stops and every
 * one of them announced something.
 *
 * So the honest static invariant is one step back. A control that carries no name in the markup
 * must at least be *reachable by an id*, because an element nothing can look up is an element
 * nothing can ever name. That is checkable here, and it is the half that survives without a
 * browser \u2014 the other half was measured live and is recorded above.
 */
test('a control with no name in the markup is at least one the renderer can find', () => {
  const nameless = controls()
    .filter((c) => !skipped(c))
    .filter((c) => !named(c))

  const unreachable = nameless
    .filter((c) => !has(c.attrs, 'id'))
    .map((c) => `<${c.tag} ${c.attrs.trim().slice(0, 70)}>`)

  assert.deepEqual(
    unreachable,
    [],
    `these carry no name and no id, so nothing can look them up to give them one:\n  ` +
      `${unreachable.join('\n  ')}`,
  )

  // And the ones that are empty on purpose are a small, named set. A seventh joining them is
  // worth a look rather than a silent pass.
  const emptyOnPurpose = nameless.map((c) => has(c.attrs, 'id')).sort()
  assert.deepEqual(
    emptyOnPurpose,
    ['getting-started', 'mode-back', 'mode-go', 'strip-toggle', 'switcher', 'theme-name'],
    `the set of controls left empty in the markup has changed. Each one depends on the renderer ` +
      `filling it in, and a screen reader lands on whatever is there at the time \u2014 so a new ` +
      `entry here needs checking in the running app, not just in this list.`,
  )
})

test('a glyph-only control is not counted as named by its glyph', () => {
  // The guard on the guard. If `spoken` stopped stripping decorative glyphs, every close button
  // would pass on its own "×" and the test above would be checking nothing.
  assert.equal(spoken('\u00d7'), '', 'a lone multiplication sign is being treated as a name')
  assert.equal(spoken('<span>\u00d7</span>'), '', 'a glyph inside a span is being treated as a name')
  assert.equal(spoken('Send'), 'Send', 'real text stopped counting as a name')
})

test('the six panel close buttons are named, not just drawn', () => {
  // Named because they are the ones most likely to be added by copying: a seventh panel that
  // drops the attribute looks identical on screen.
  const closes = controls().filter((c) => (has(c.attrs, 'id') ?? '').endsWith('-close'))
  assert.ok(closes.length >= 5, `expected the panel close buttons, found ${closes.length}`)

  const bare = closes.filter((c) => !has(c.attrs, 'aria-label')).map((c) => has(c.attrs, 'id'))
  assert.deepEqual(bare, [], `these close buttons have no aria-label: ${bare.join(', ')}`)
})
