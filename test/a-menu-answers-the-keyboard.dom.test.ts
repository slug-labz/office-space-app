/**
 * A button that opens a small menu, and the keyboard that has to come with it.
 *
 * Found by driving the running app rather than by reading it: of the five controls in the status
 * bar, `···` was the one that left `document.activeElement` on `BODY` after being pressed. The
 * dials beside it did the same.
 *
 * Both gaps are worse than they look, because the markup already promises otherwise. `#more-menu`
 * carries `role="menu"` and every item gets `role="menuitem"` — which tells assistive technology
 * that arrow keys move between them. They did not move anything.
 *
 * The switcher's `+` menu had all three behaviours and was the only copy that did.
 * `switcher-keys.dom.test.ts` names the fault about a different control: *"the same class of
 * fault as the panels that opened without taking focus at all — three of which were fixed on this
 * branch."* These were the fourth and fifth, and the fix is that there is now one implementation
 * rather than a complete copy and two incomplete ones.
 *
 * ## Clamped, not wrapped
 *
 * Deliberately opposite to the command palette and the slash menu, which wrap, each with a
 * comment saying why: those are candidates you are picking from, and running off the end is
 * cheap. A short fixed menu is a place, and reappearing at the other end loses your place. Both
 * are defensible and only one can ship, so it is pinned here.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, documentEvent, type El } from './dom.js'
import { mountPopMenu, type PopMenu } from '../src/renderer/views/popmenu.js'

installDom()

interface Rig {
  readonly trigger: El
  readonly menu: El
  readonly items: () => El[]
  readonly menuObj: PopMenu
  readonly key: (k: string) => void
  readonly focused: () => El | undefined
}

function rig(labels = ['Settings', 'Music', 'Privacy']): Rig {
  const trigger = document.createElement('button') as unknown as El
  const menu = document.createElement('div') as unknown as El
  menu.hidden = true

  const menuObj = mountPopMenu(trigger as unknown as HTMLElement, menu as unknown as HTMLElement, {
    fill: () => {
      menu.children.length = 0
      for (const label of labels) {
        const item = document.createElement('button') as unknown as El
        item.className = 'popmenu__item'
        item.textContent = label
        menu.appendChild(item)
      }
    },
  })

  const items = (): El[] => menu.children.filter((c) => c.classList.contains('popmenu__item'))
  return {
    trigger,
    menu,
    items,
    menuObj,
    key: (k) => menu.dispatchEvent({ type: 'keydown', bubbles: true, key: k, preventDefault: () => {} }),
    focused: () => items().find((i) => i.focused),
  }
}

test('opening it puts you in it', () => {
  // The whole finding. A menu that opens without taking focus is reachable only by Tabbing from
  // wherever focus happened to be, which for a status-bar control is the far end of the document.
  const r = rig()
  r.trigger.dispatchEvent({ type: 'click', bubbles: true })

  assert.equal(r.menu.hidden, false, 'the menu did not open at all')
  // The control: three items, or the focus assertion is about an empty menu.
  assert.equal(r.items().length, 3, `expected three items, found ${r.items().length}`)
  assert.equal(
    r.focused(),
    r.items()[0],
    'the menu opened and focus stayed where it was. `role="menu"` in the markup promises arrow ' +
      'keys move between the items; nothing can move between them until one of them has focus.',
  )
  assert.equal(r.trigger.getAttribute('aria-expanded'), 'true')
})

test('arrows walk it, and clamp rather than wrap', () => {
  const r = rig()
  r.trigger.dispatchEvent({ type: 'click', bubbles: true })
  const items = r.items()

  r.key('ArrowDown')
  assert.equal(r.focused(), items[1], 'ArrowDown did not move to the next item')
  r.key('ArrowUp')
  assert.equal(r.focused(), items[0], 'ArrowUp did not move back')

  r.key('ArrowUp')
  assert.equal(
    r.focused(),
    items[0],
    'ArrowUp from the first item wrapped to the bottom. The palette wraps and this does not, and ' +
      'the difference is considered — a short menu is a place, not a list of candidates.',
  )

  items[items.length - 1]?.focus()
  r.key('ArrowDown')
  assert.equal(r.focused(), items[items.length - 1], 'ArrowDown from the last item wrapped to the top')
})

test('Home and End reach the ends without walking there', () => {
  const r = rig()
  r.trigger.dispatchEvent({ type: 'click', bubbles: true })
  const items = r.items()

  items[1]?.focus()
  r.key('End')
  assert.equal(r.focused(), items[items.length - 1], 'End did not reach the last item')
  r.key('Home')
  assert.equal(r.focused(), items[0], 'Home did not reach the first item')
})

test('Escape closes it and gives focus back to what opened it', () => {
  // Closing without this leaves focus on an element that is no longer on screen, so the next Tab
  // starts from the top of the document and the keyboard has landed nowhere.
  const r = rig()
  r.trigger.dispatchEvent({ type: 'click', bubbles: true })
  assert.equal(r.menu.hidden, false, 'the menu never opened, so closing it proves nothing')

  r.key('Escape')

  assert.equal(r.menu.hidden, true, 'Escape did not close the menu')
  assert.equal(r.trigger.focused, true, 'focus was left on an item that is no longer on screen')
  assert.equal(r.trigger.getAttribute('aria-expanded'), 'false')
})

test('Escape from outside the menu closes it too', () => {
  // Focus may be nowhere in particular — on the trigger, or on the body after a click. Escape has
  // to mean *out* regardless of where it was pressed.
  const r = rig()
  r.trigger.dispatchEvent({ type: 'click', bubbles: true })
  documentEvent({ type: 'keydown', bubbles: true, key: 'Escape' })
  assert.equal(r.menu.hidden, true, 'Escape pressed outside the menu left it open')
})

test('pressing the trigger again closes it', () => {
  const r = rig()
  r.trigger.dispatchEvent({ type: 'click', bubbles: true })
  r.trigger.dispatchEvent({ type: 'click', bubbles: true })
  assert.equal(r.menu.hidden, true, 'the trigger only opens, so the mouse has no way to change its mind')
})

test('clicking away closes it, and the menu is gone before the click lands', () => {
  // `mousedown` rather than `click`, so whatever is behind receives its own event with the menu
  // already down — otherwise picking something behind it opens that thing underneath a menu that
  // is still up.
  const r = rig()
  r.trigger.dispatchEvent({ type: 'click', bubbles: true })
  documentEvent({ type: 'mousedown', bubbles: true, target: document.createElement('div') as unknown as El })
  assert.equal(r.menu.hidden, true, 'clicking away left the menu open over whatever was clicked')
})

test('a click inside does not close it', () => {
  const r = rig()
  r.trigger.dispatchEvent({ type: 'click', bubbles: true })
  const item = r.items()[0]
  assert.ok(item, 'no item to click')
  documentEvent({ type: 'mousedown', bubbles: true, target: item })
  assert.equal(r.menu.hidden, false, 'clicking an item closed the menu before the item could be chosen')
})

test('a menu of controls rather than commands still receives focus', () => {
  // The dials menu is a panel of controls, not a list of `.popmenu__item`s. It still has to take
  // focus on open, or it is the same fault wearing different markup.
  const trigger = document.createElement('button') as unknown as El
  const menu = document.createElement('div') as unknown as El
  menu.hidden = true
  const control = document.createElement('button') as unknown as El
  control.textContent = 'opus'
  menu.appendChild(control)

  mountPopMenu(trigger as unknown as HTMLElement, menu as unknown as HTMLElement)
  trigger.dispatchEvent({ type: 'click', bubbles: true })

  assert.equal(menu.hidden, false)
  assert.equal(control.focused, true, 'a menu with no `.popmenu__item` opened without taking focus at all')
})

test('an empty menu opens without throwing', () => {
  // Nothing to focus is a real state — a menu whose entries are all unavailable — and it must not
  // take the renderer down on the way to being empty.
  const trigger = document.createElement('button') as unknown as El
  const menu = document.createElement('div') as unknown as El
  menu.hidden = true
  mountPopMenu(trigger as unknown as HTMLElement, menu as unknown as HTMLElement)

  assert.doesNotThrow(() => trigger.dispatchEvent({ type: 'click', bubbles: true }))
  assert.equal(menu.hidden, false)
})

test('a menu of controls does not eat the arrow keys it cannot use', () => {
  /**
   * The extraction risk, found by `office-space-6c` on the caller I had flagged as the odd one.
   *
   * `go()` called `preventDefault()` **before** it indexed, so a menu with no `.popmenu__item` —
   * the dials, which hold controls rather than commands — prevented every arrow key and then did
   * nothing with it. That is worse than not handling them: a `<select>` or a range input has
   * arrow keys as its native keyboard, and the shared menu was eating the keystroke that operates
   * the control.
   *
   * The `+` menu's behaviour was applied to a menu with no items. The side effect leaked while
   * the effect did not.
   */
  const trigger = document.createElement('button') as unknown as El
  const menu = document.createElement('div') as unknown as El
  menu.hidden = true
  const control = document.createElement('select') as unknown as El
  menu.appendChild(control)

  mountPopMenu(trigger as unknown as HTMLElement, menu as unknown as HTMLElement)
  trigger.dispatchEvent({ type: 'click', bubbles: true })

  let prevented = false
  menu.dispatchEvent({
    type: 'keydown',
    bubbles: true,
    key: 'ArrowDown',
    preventDefault: () => {
      prevented = true
    },
  })

  assert.equal(
    prevented,
    false,
    'ArrowDown was prevented in a menu with nothing to walk. Whatever control is in there just ' +
      'lost the key that operates it, to a handler that then did nothing.',
  )
})

test('but Escape still gets you out of one', () => {
  // The half that must survive the early return: a menu with no items still closes, and still
  // hands focus back. Moving the `items.length === 0` guard above Escape would take the only way
  // out of the dials with the keyboard.
  const trigger = document.createElement('button') as unknown as El
  const menu = document.createElement('div') as unknown as El
  menu.hidden = true
  menu.appendChild(document.createElement('select') as unknown as El)

  mountPopMenu(trigger as unknown as HTMLElement, menu as unknown as HTMLElement)
  trigger.dispatchEvent({ type: 'click', bubbles: true })
  menu.dispatchEvent({ type: 'keydown', bubbles: true, key: 'Escape', preventDefault: () => {} })

  assert.equal(menu.hidden, true, 'Escape did not close a menu that has no items')
  assert.equal(trigger.focused, true, 'focus was not returned to the trigger')
})

test('a menu with items still prevents the arrows it uses', () => {
  // The other direction. Walking a list must keep preventing the page from scrolling under it,
  // which is the whole reason `preventDefault` was there.
  const r = rig()
  r.trigger.dispatchEvent({ type: 'click', bubbles: true })
  let prevented = false
  r.menu.dispatchEvent({
    type: 'keydown',
    bubbles: true,
    key: 'ArrowDown',
    preventDefault: () => {
      prevented = true
    },
  })
  assert.equal(prevented, true, 'walking a menu no longer stops the page scrolling underneath it')
})
