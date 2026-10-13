/**
 * The picker that was dead to a mouse while looking alive, and the test shape that missed it.
 *
 * `views/select.ts` replaced three native `<select>` elements, which means everything the native
 * control did for free had to be put back by hand — arrow keys, Home and End, typeahead, roles,
 * a checkmark. 341 lines of it, and nothing aimed at any of it.
 *
 * Its own comment records the bug and, more usefully, records **why testing it did not catch
 * the bug**:
 *
 *   "It used to call `draw()`, which is `replaceChildren()` — so moving the mouse onto a row
 *    destroyed every row, built new ones, and then scrolled the list. Your `mousedown` landed on
 *    whatever had slid under the pointer… **Every synthetic test passed because dispatching onto
 *    a held reference never fires `mouseenter`, so nothing was ever rebuilt underneath it.**"
 *
 * That last sentence is the whole reason this file is written the way it is. A test that opens
 * the list, holds a row, and clicks it passes with the bug fully present — the held reference is
 * still wired, it is simply no longer the element on screen. It was found by hand, twice.
 *
 * ## So the property is identity, not behaviour
 *
 * Moving the cursor must leave **the same element objects** in the list. Not equal ones — the
 * same ones. That is what a pointer is holding when it presses, and it is the one thing a
 * `replaceChildren()` cannot survive. Everything else here is the reimplemented native
 * behaviour, which had no test at all.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Select } from '../src/renderer/views/select.js'
import { installDom, type El } from './dom.js'
import type { Choice } from '../src/shared/control-copy.js'

installDom()

const CHOICES: readonly Choice[] = [
  { value: 'opus', label: 'opus', detail: 'The strongest, and the slowest.' },
  { value: 'sonnet', label: 'sonnet', detail: 'The default. Fast and good.' },
  { value: 'haiku', label: 'haiku', detail: 'The quickest.' },
]

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

function picker(): { root: El; chosen: string[]; open: () => El[] } {
  const root = document.createElement('div') as unknown as El
  const chosen: string[] = []
  const select = new Select(root as unknown as HTMLElement, {
    label: 'Model',
    choices: CHOICES,
    triggerText: (v) => v || 'model',
    onChange: (v) => chosen.push(v),
  })
  select.set('sonnet', { set: true, unknown: false })

  const open = (): El[] => {
    const trigger = all(root).find((n) => n.tag === 'button')
    assert.ok(trigger, 'the picker has no trigger — this check is blind')
    trigger.dispatchEvent({ type: 'click', bubbles: true })
    const rows = all(root).filter((n) => n.getAttribute('role') === 'option')
    assert.equal(rows.length, CHOICES.length, `expected ${CHOICES.length} rows, found ${rows.length}`)
    return rows
  }

  return { root, chosen, open }
}

test('moving the cursor leaves the same row objects in place', () => {
  // The property that matters, and the one a naive test cannot fail. If `moveTo` rebuilds, these
  // are new objects — equal in content, different in identity — and a pointer holding one of the
  // originals is holding something no longer on screen.
  const { root, open } = picker()
  const before = open()

  const list = all(root).find((n) => n.getAttribute('role') === 'listbox')
  assert.ok(list, 'the list has no listbox role')
  before[2]!.dispatchEvent({ type: 'mouseenter', bubbles: false })

  const after = all(root).filter((n) => n.getAttribute('role') === 'option')
  assert.equal(after.length, before.length)
  for (const [i, row] of after.entries()) {
    assert.equal(
      row,
      before[i],
      `row ${i} is a different object after the cursor moved — the list was rebuilt, so a press ` +
        `lands on whatever slid under the pointer and no row handler runs`,
    )
  }
})

test('the pointer does not scroll the list out from under itself', () => {
  // The same bug wearing a different hat, and the comment says so: scrolling because the pointer
  // arrived somewhere moves the target away from the hand reaching for it. The keyboard asks for
  // scrolling; the mouse must not get it.
  const { open } = picker()
  const rows = open()
  const scrolledBefore = rows.reduce((n, r) => n + r.scrolledIntoView, 0)

  rows[2]!.dispatchEvent({ type: 'mouseenter', bubbles: false })

  const scrolledAfter = rows.reduce((n, r) => n + r.scrolledIntoView, 0)
  assert.equal(scrolledAfter, scrolledBefore, 'hovering scrolled the list')
})

test('pressing a row chooses it', () => {
  // The thing the person was trying to do, and the report: the tick stays where it is and
  // choosing a row changes nothing.
  //
  // `mousedown` rather than `click`, and that is the control's own choice: the list has focus,
  // and a click would blur it first. The first draft of this test used `click` and chose nothing
  // — a test wrong about the app rather than an app wrong about anything, and the same
  // press-versus-click distinction that made the original bug hard to see.
  const { chosen, open } = picker()
  open()[2]!.dispatchEvent({ type: 'mousedown', bubbles: false })
  assert.deepEqual(chosen, ['haiku'], 'pressing a row did not choose it')
})

/** The open list, which is where the keyboard goes once it is showing. */
function listOf(root: El): El {
  const list = all(root).find((n) => n.getAttribute('role') === 'listbox')
  assert.ok(list, 'the open list has no listbox role — this check is blind')
  return list
}

test('the arrow keys move the cursor and Enter takes it', () => {
  // Reimplemented native behaviour, with nothing checking it. Every one of these worked for free
  // before this control existed.
  //
  // Dispatched at the LIST, not the trigger: the trigger's handler is what opens the thing, and
  // once it is open the list has focus and its own keydown. Two handlers, two jobs.
  const { root, chosen, open } = picker()
  open()
  const list = listOf(root)

  list.dispatchEvent({ type: 'keydown', bubbles: false, key: 'ArrowDown' })
  list.dispatchEvent({ type: 'keydown', bubbles: false, key: 'Enter' })

  assert.deepEqual(chosen, ['haiku'], 'ArrowDown from sonnet then Enter did not choose haiku')
})

test('typeahead jumps to a choice by its first letters', () => {
  // "Typing `s` jumps to `sonnet`. It is the one native behaviour people use without knowing
  // they use it." Nothing checked that it survived.
  const { root, chosen, open } = picker()
  open()
  const list = listOf(root)

  list.dispatchEvent({ type: 'keydown', bubbles: false, key: 'h' })
  list.dispatchEvent({ type: 'keydown', bubbles: false, key: 'Enter' })

  assert.deepEqual(chosen, ['haiku'], 'typing `h` did not reach haiku')
})

test('the picker reads as a picker, not as a pile of buttons', () => {
  // The roles are the whole reason a hand-built listbox is defensible at all. Losing them turns
  // an accessible control into three unlabelled buttons, silently.
  const { root, open } = picker()
  open()

  const list = all(root).find((n) => n.getAttribute('role') === 'listbox')
  assert.ok(list, 'no listbox role, so a screen reader hears a pile of buttons')

  const rows = all(root).filter((n) => n.getAttribute('role') === 'option')
  const selected = rows.filter((r) => r.getAttribute('aria-selected') === 'true')
  assert.equal(selected.length, 1, `${selected.length} rows claim to be selected`)
})
