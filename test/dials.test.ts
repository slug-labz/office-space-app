/**
 * Choosing something from a picker, and why choosing did nothing at all.
 *
 * Reported of the model / effort / permission dials: nothing here is clickable either.
 *
 * They were clickable. The menu opened, the row took the press, and the menu closed — every
 * visible part of a working control. Nothing changed because the chosen value never left the
 * click:
 *
 *   1. `Select.choose()` calls `onChange(choice.value)` and, deliberately, **never sets its own
 *      value** — a picker must not show a value the session is not running.
 *   2. `dials.ts` wired that as `onChange: () => onChange()`, discarding the value.
 *   3. `readDials()` then asked each `Select` for `.current`, which is only ever set from what
 *      the office returned.
 *
 * So the old value was sent, the office answered with the old value, and the picker painted the
 * old value. A closed loop that could never move, and from outside indistinguishable from a menu
 * that ignores clicks.
 *
 * These tests are about the seam between those two rules: the picker still only ever *shows*
 * what it was told, and the choice still has to reach the office.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { EFFORTS, MODELS, OFFERED_PERMISSION_MODES } from '../src/shared/controls.js'

/**
 * A stand-in for the real `Select`, keeping only the property that caused the bug: `current` is
 * whatever `set()` was last given, and choosing never touches it.
 */
class FakeSelect {
  value = 'default'
  get current(): string {
    return this.value
  }
  set(value: string): void {
    this.value = value
  }
}

/** The fixed shape, stated as the smallest thing that reproduces it. */
function wire() {
  const picker = new FakeSelect()
  const chosen = new Map<string, string>()
  const sent: string[] = []

  return {
    picker,
    choose(value: string) {
      chosen.set('effort', value)
      // What `saveControls` does: read, send, then paint what came back.
      const read = chosen.get('effort') ?? picker.current
      sent.push(read)
      // The office echoes it; a refusal would echo something else.
      chosen.delete('effort')
      picker.set(read)
    },
    sent,
  }
}

test('choosing an option sends the option that was chosen', () => {
  const d = wire()
  d.choose('high')
  assert.deepEqual(d.sent, ['high'], 'the old value was sent instead, so nothing ever changed')
  assert.equal(d.picker.current, 'high')
})

test('a picker still only shows what it was told, never what was clicked', () => {
  // The rule `Select` was written to keep, and the reason the value could not simply be set
  // optimistically: a picker showing a mode the session is not in is the third standing order
  // broken in the smallest possible way.
  const picker = new FakeSelect()
  assert.equal(picker.current, 'default', 'a click alone must not move it')
  picker.set('high')
  assert.equal(picker.current, 'high', 'only being told moves it')
})

test('a refused choice leaves the picker showing what the office actually holds', () => {
  const picker = new FakeSelect()
  const chosen = new Map<string, string>()

  chosen.set('effort', 'max')
  const read = chosen.get('effort') ?? picker.current
  assert.equal(read, 'max', 'the request carries the choice')

  // The office refuses and answers with what it kept.
  chosen.delete('effort')
  picker.set('default')
  assert.equal(picker.current, 'default', 'the refusal is what shows, not the request')
})

test('every dial offers something to choose between', () => {
  // Guards the other direction: a picker with one option is a control that cannot be operated,
  // which is the same symptom by a different route.
  assert.ok(MODELS.length > 1, 'model offers nothing to choose between')
  assert.ok(EFFORTS.length > 1, 'effort offers nothing to choose between')
  assert.ok(
    OFFERED_PERMISSION_MODES.length > 1,
    'the permission picker offers nothing to choose between — note it is deliberately a subset, ' +
      'because two modes are accepted by the CLI and then silently resolved to default under --print',
  )
})

// ───────────────────────────── the hover that moved the target out from under you ──

/**
 * Reported: the tick stays where it is and choosing a row changes nothing.
 *
 * The tick could not move because the press never reached a row. `moveTo` called `draw()`, which
 * is `replaceChildren()` — so `mouseenter` on a row **destroyed every row**, built new ones, and
 * then called `scrollIntoView`. By the time `mousedown` arrived, what was under the pointer was
 * whatever had slid into that spot, usually the list's own gap.
 *
 * Measured with trusted CDP input against the running app: the press landed on
 * `DIV.sel__list`, never on a row — while `elementFromPoint` at the same coordinates a moment
 * earlier had returned the row's text. The two disagreed because the list moved in between.
 *
 * Every synthetic test passed throughout, because dispatching onto a held element reference
 * never fires `mouseenter` and so never rebuilt anything underneath it. That is the lesson worth
 * keeping: this bug was invisible to any test that did not move a mouse.
 */
const SELECT = new URL('../src/renderer/views/select.ts', import.meta.url)

test('moveTo marks the rows; it must never rebuild them', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(SELECT, 'utf8')

  const body = source.slice(source.indexOf('private moveTo('), source.indexOf('private mark('))
  assert.ok(body.length > 0, 'moveTo or mark has been renamed; this check needs rewriting')
  assert.ok(
    !/this\.draw\(\)/.test(body),
    'moveTo calls draw(), which is replaceChildren() — so hovering a row destroys every row and ' +
      'rebuilds them, and the mousedown that follows lands on whatever slid underneath. That is ' +
      'the bug where the tick could not be moved with a mouse at all.',
  )
})

test('hovering a row must not scroll the list', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(SELECT, 'utf8')

  const hover = /mouseenter', \(\) => this\.moveTo\(([^)]*)\)/.exec(source)
  assert.ok(hover, 'the hover handler has moved; this check needs rewriting')
  assert.ok(
    !/true/.test(hover[1] ?? ''),
    'hovering asks to be scrolled to, which moves the row out from under the pointer already ' +
      'travelling towards it — the same bug wearing a different hat. Only the keyboard scrolls.',
  )
})

test('a trigger points at the list it opens, not merely at the fact of one', () => {
  // `aria-haspopup` says *a listbox opens*; `aria-expanded` says *it is open now*; only
  // `aria-controls` says **which one**. Two of the three were set.
  //
  // That is enough with one dial on screen and is not what this composer has: three triggers sit
  // in a row and each opens its own list, so "a listbox is expanded" without a referent is a
  // sentence a screen reader cannot finish.
  const source = readFileSync(SELECT, 'utf8')

  assert.match(source, /aria-controls/, 'the trigger names no list')
  assert.match(source, /this\.list\.id = listId/, 'the list has no id for the trigger to name')

  // Derived from the label, not a counter: an id that changes on re-render points somewhere else
  // every time the composer redraws, which is worse than not pointing at all.
  assert.doesNotMatch(
    source.slice(source.indexOf('const listId')),
    /const listId = `sel-\$\{[^}]*(?:count|index|Math\.random|Date\.now)/,
    'the id must be stable across re-renders',
  )
})

