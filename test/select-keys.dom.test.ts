/**
 * The rest of the keyboard on the picker every dial is built from.
 *
 * `select.dom.test.ts` covers the pointer, the arrows and Enter, and the identity rule that a
 * cursor move must not rebuild the rows. What it does not reach is the half of `listKey` that
 * exists for people who never touch the mouse: Escape, Home, End, Tab, and opening the list from
 * the trigger without clicking it.
 *
 * This matters more than a dropdown usually would, because one of these dials is the permission
 * mode. A control where Escape commits instead of cancelling is a control that changes what the
 * office is allowed to do on this machine because somebody pressed the key that means "no".
 *
 * ## Escape means the same thing here as everywhere else
 *
 *     Closes without choosing. The value is unchanged, which is what Escape means everywhere
 *     else in this app.
 *
 * ## And Tab lets you go, without leaving the menu behind
 *
 *     Let focus leave, but do not leave a menu open behind it.
 *
 * A list left standing over the app after focus has moved on is the two-lists fault the
 * switcher's `escapables()` exists to prevent, one control further down.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { Select } from '../src/renderer/views/select.js'

installDom()

const CHOICES = [
  { value: 'opus', label: 'opus', detail: 'The careful one.' },
  { value: 'sonnet', label: 'sonnet', detail: 'The usual one.' },
  { value: 'haiku', label: 'haiku', detail: 'The quickest.' },
]

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

interface Picker {
  readonly root: El
  readonly chosen: string[]
  readonly trigger: El
  readonly open: () => El[]
  readonly rows: () => El[]
  readonly isOpen: () => boolean
  readonly key: (k: string) => void
  readonly cursorAt: () => number
  readonly announcedAt: () => number
}

function picker(): Picker {
  const root = document.createElement('div') as unknown as El
  const chosen: string[] = []
  const select = new Select(root as unknown as HTMLElement, {
    label: 'Model',
    choices: CHOICES,
    triggerText: (v) => v || 'model',
    onChange: (v) => chosen.push(v),
  })
  select.set('sonnet', { set: true, unknown: false })

  const trigger = all(root).find((n) => n.tag === 'button')
  assert.ok(trigger, 'the picker has no trigger, so nothing below can be driven')
  const rows = (): El[] => all(root).filter((n) => n.getAttribute('role') === 'option')
  const list = (): El | undefined => all(root).find((n) => n.getAttribute('role') === 'listbox')

  return {
    root,
    chosen,
    trigger,
    rows,
    isOpen: () => trigger.getAttribute('aria-expanded') === 'true',
    open: () => {
      trigger.dispatchEvent({ type: 'click', bubbles: true })
      const found = rows()
      assert.equal(found.length, CHOICES.length, `expected ${CHOICES.length} rows, found ${found.length}`)
      return found
    },
    key: (k) => {
      const target = list() ?? trigger
      target.dispatchEvent({ type: 'keydown', bubbles: true, key: k, preventDefault: () => {} })
    },
    // The cursor is `sel__row--on`. `aria-selected` is a different fact — which value is
    // *chosen* — and reading that instead finds the row the picker already had set, which is
    // why the first version of this helper reported a cursor that never moved.
    cursorAt: () => rows().findIndex((r) => r.classList.contains('sel__row--on')),
    // What a screen reader is told the cursor is. It has to be the same row.
    announcedAt: () => {
      const id = list()?.getAttribute('aria-activedescendant') ?? ''
      return rows().findIndex((r) => r.getAttribute('id') === id)
    },
  }
}

test('the trigger opens the list from the keyboard, without a click', () => {
  // Somebody who never touches the mouse has to be able to open this at all.
  for (const k of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
    const p = picker()
    assert.equal(p.isOpen(), false, 'the list is already open before anything was pressed')
    p.trigger.dispatchEvent({ type: 'keydown', bubbles: true, key: k, preventDefault: () => {} })
    assert.equal(p.isOpen(), true, `${JSON.stringify(k)} on the trigger did not open the list`)
  }
})

test('Escape closes without changing the value', () => {
  // One of these dials is the permission mode. A control where the key meaning "no" commits a
  // change is a control that alters what the office may do because somebody backed out of it.
  const p = picker()
  p.open()
  p.key('ArrowDown')

  p.key('Escape')

  assert.equal(p.isOpen(), false, 'Escape left the list open')
  assert.deepEqual(p.chosen, [], 'Escape committed the row the cursor happened to be on')
})

test('Home and End reach the ends, and the arrows clamp there', () => {
  const p = picker()
  p.open()

  p.key('End')
  assert.equal(p.cursorAt(), CHOICES.length - 1, 'End did not reach the last choice')
  p.key('ArrowDown')
  assert.equal(p.cursorAt(), CHOICES.length - 1, 'ArrowDown ran off the end of the list')

  p.key('Home')
  assert.equal(p.cursorAt(), 0, 'Home did not reach the first choice')
  p.key('ArrowUp')
  assert.equal(p.cursorAt(), 0, 'ArrowUp ran off the top of the list')

  // The row that looks like the cursor and the row a screen reader is told is the cursor are
  // the same row, or the control means two different things depending on how you are using it.
  assert.equal(p.announcedAt(), p.cursorAt(), 'the highlighted row and the announced row differ')
})

test('Enter takes the row the cursor is on, and only that row', () => {
  const p = picker()
  p.open()
  p.key('Home')
  p.key('Enter')

  assert.deepEqual(p.chosen, ['opus'], `Enter chose ${JSON.stringify(p.chosen)}`)
  assert.equal(p.isOpen(), false, 'the list stayed open after a choice was taken')
})

test('Tab lets focus go and does not leave the list standing', () => {
  const p = picker()
  p.open()
  assert.equal(p.isOpen(), true)

  p.key('Tab')

  assert.equal(
    p.isOpen(),
    false,
    'Tab moved focus on and left the menu open over the app — the same two-lists fault the ' +
      'switcher guards against, one control further down',
  )
  assert.deepEqual(p.chosen, [], 'tabbing away committed a choice nobody made')
})

test('typeahead starts over once you stop typing', async () => {
  // Accumulated while you keep going, restarted after a pause. Without the reset, a second
  // search minutes later is appended to the first and matches nothing at all — the list simply
  // stops responding to letters, with no sign of why.
  const p = picker()
  p.open()

  p.key('h')
  assert.equal(p.cursorAt(), 2, 'typing "h" did not reach haiku')

  await new Promise((resolve) => setTimeout(resolve, 520))

  p.key('o')
  assert.equal(
    p.cursorAt(),
    0,
    'after a pause, "o" was appended to the earlier "h" rather than starting a new search, so ' +
      'the list stopped answering the keyboard with nothing on screen to say why',
  )
})

test('a letter that matches nothing leaves the cursor where it was', () => {
  const p = picker()
  p.open()
  p.key('End')
  const before = p.cursorAt()

  p.key('z')
  assert.equal(p.cursorAt(), before, 'a letter matching no choice moved the cursor somewhere arbitrary')
})
