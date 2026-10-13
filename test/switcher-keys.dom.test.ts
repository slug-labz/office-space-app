/**
 * Walking the switcher by keyboard, which is the only route through it that is not a mouse.
 *
 * `switcher-naming.dom.test.ts` covers naming a project and `switcher.test.ts` covers what each
 * row says. The keys were untouched — and this list is where every project and every conversation
 * in the app is reached from, so a keyboard that cannot walk it is a keyboard that cannot change
 * project.
 *
 * ## It clamps rather than wraps, and that is not an accident
 *
 * The command palette and the slash menu both wrap, each with a comment saying why: *"a list you
 * can walk off the end of makes you look at it to use it."* This one does not — it clamps at both
 * ends. The difference is what the list is: those two are search results you are picking from,
 * where the cursor is a choice among candidates, and this is a place you are navigating, where
 * running off the bottom and reappearing at the top is a way to lose your position in something
 * you were reading.
 *
 * Both behaviours are defensible and they are opposite, so the one that ships is pinned. A future
 * "make the lists consistent" pass would otherwise change it silently and nothing would say which
 * of the two was the considered one.
 *
 * ## And the way out returns you to where you were
 *
 * Escape closes the list and puts focus back on the trigger. Closing without that leaves focus on
 * a row that is no longer on screen, which is the same class of fault as the panels that opened
 * without taking focus at all — three of which were fixed on this branch.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, documentEvent, type El } from './dom.js'
import { mountSwitcher, type SwitcherHandlers, type SwitcherModel } from '../src/renderer/views/switcher.js'

installDom()

const quiet: SwitcherHandlers = {
  onProject: () => {},
  onSession: () => {},
  onNewSession: () => {},
  onNewProject: () => {},
  onCloseSession: () => {},
  onArchiveProject: () => {},
  onDeleteProject: () => {},
}

const MODEL: SwitcherModel = {
  projects: [
    { id: 'the-office', name: 'The office', missing: [], conversations: 1, lastActiveAt: null, running: false },
    { id: 'random', name: 'random', missing: [], conversations: 0, lastActiveAt: null, running: false },
    { id: 'payment-page', name: 'payment page', missing: [], conversations: 0, lastActiveAt: null, running: false },
  ],
  activeProject: 'the-office',
  sessions: [
    {
      id: 's1', agent: 'manager', title: 'a conversation', updatedAt: '2026-08-27T00:00:00Z',
      costUsd: null, current: true, running: false,
    },
  ],
  root: '/w',
  manager: 'manager',
  now: Date.parse('2026-08-27T01:00:00Z'),
}

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

function mounted() {
  const trigger = document.createElement('button') as unknown as El
  const list = document.createElement('div') as unknown as El
  const newOpen = document.createElement('button') as unknown as El
  const newMenu = document.createElement('div') as unknown as El
  newMenu.hidden = true
  list.hidden = true

  const switcher = mountSwitcher(
    trigger as unknown as HTMLButtonElement,
    list as unknown as HTMLElement,
    newOpen as unknown as HTMLButtonElement,
    newMenu as unknown as HTMLElement,
    quiet,
  )
  switcher.render(MODEL)
  // Opened the way a person opens it, so the list is in the state the keys act on.
  trigger.dispatchEvent({ type: 'click', bubbles: true })

  const rows = (): El[] => all(list).filter((n) => n.classList.contains('swrow'))
  const key = (k: string): void =>
    list.dispatchEvent({ type: 'keydown', bubbles: true, key: k, preventDefault: () => {} })

  return { trigger, list, switcher, rows, key, focused: (): El | undefined => rows().find((r) => r.focused) }
}

test('the list has rows to walk, and the keys move between them', () => {
  const s = mounted()
  // The control: everything below is about moving focus between rows, so there must be rows.
  assert.ok(s.rows().length >= 3, `only ${s.rows().length} rows drawn — the keys have nothing to walk`)

  s.rows()[0]?.focus()
  s.key('ArrowDown')
  assert.equal(s.focused(), s.rows()[1], 'ArrowDown did not move to the next row')

  s.key('ArrowUp')
  assert.equal(s.focused(), s.rows()[0], 'ArrowUp did not move back')
})

test('it clamps at both ends rather than wrapping', () => {
  // Opposite to the palette and the slash menu, deliberately: this is a place you navigate, not
  // a set of candidates you pick from, and reappearing at the other end loses your position.
  const s = mounted()
  const rows = s.rows()

  rows[0]?.focus()
  s.key('ArrowUp')
  assert.equal(
    s.focused(),
    rows[0],
    'ArrowUp from the first row wrapped to the bottom. The palette wraps and this does not, and ' +
      'the difference is considered — a list you are reading should not move under you.',
  )

  rows[rows.length - 1]?.focus()
  s.key('ArrowDown')
  assert.equal(s.focused(), rows[rows.length - 1], 'ArrowDown from the last row wrapped to the top')
})

test('Home and End reach the ends without walking there', () => {
  const s = mounted()
  const rows = s.rows()

  rows[1]?.focus()
  s.key('End')
  assert.equal(s.focused(), rows[rows.length - 1], 'End did not reach the last row')

  s.key('Home')
  assert.equal(s.focused(), rows[0], 'Home did not reach the first row')
})

test('Escape closes the list and gives focus back to what opened it', () => {
  // Closing without this leaves focus on a row that is no longer on screen — the same fault as a
  // panel that opens without taking focus, three of which were fixed on this branch.
  const s = mounted()
  assert.equal(s.list.hidden, false, 'the list never opened, so closing it proves nothing')
  s.rows()[1]?.focus()

  s.key('Escape')

  assert.equal(s.list.hidden, true, 'Escape did not close the list')
  assert.equal(s.trigger.focused, true, 'focus was left on a row that is no longer on screen')
})

test('clicking away closes it, and the list is gone before the click lands', () => {
  // `mousedown` rather than `click`, so whatever is behind the panel receives its own event with
  // the panel already down — otherwise picking something behind it opens that thing underneath a
  // panel that is still up.
  const s = mounted()
  assert.equal(s.list.hidden, false)

  const elsewhere = document.createElement('div') as unknown as El
  documentEvent({ type: 'mousedown', bubbles: true, target: elsewhere })

  assert.equal(s.list.hidden, true, 'clicking away left the switcher open over whatever was clicked')
})

test('a click inside the list does not close it', () => {
  const s = mounted()
  const row = s.rows()[0]
  assert.ok(row, 'no row to click')
  documentEvent({ type: 'mousedown', bubbles: true, target: row })
  assert.equal(s.list.hidden, false, 'clicking a row closed the list before the row could be chosen')
})
