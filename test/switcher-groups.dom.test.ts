/**
 * What the switcher list says when a level of it is empty, and the way out of both menus.
 *
 * `switcher-keys.dom.test.ts` walks the rows; `switcher-naming.dom.test.ts` covers naming a
 * project; `switcher.test.ts` covers what each row says. What none of them ask is what the list
 * does with the two groups that can be empty, and those are the two places its own comments say
 * are easiest to get wrong in opposite directions.
 *
 * ## An empty project is a fact; an empty gap is not a way of saying it
 *
 *     The fourth standing order on the surface where it is easiest to break: a project with no
 *     conversations is a fact, and an empty gap under a heading is not a way of saying it.
 *
 * ## But a heading over nobody is advertising, not listing
 *
 *     Only shown once somebody has actually talked to one. A heading over an empty group would
 *     be the app advertising a feature rather than listing what is there — the way in is
 *     clicking somebody on the floor, which is where you are already looking at them.
 *
 * The two rules point opposite ways and that is the point: one absence gets a sentence and the
 * other gets nothing, because one is a fact about your project and the other is a feature you
 * have not used. A change that made them consistent would break one of them.
 *
 * ## And Escape has to mean out of everything
 *
 *     A `close` that left the `+` menu standing would be the two-lists bug that `escapables()`
 *     exists to prevent, reintroduced one level down.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
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

type Session = SwitcherModel['sessions'][number]

const session = (id: string, agent: string): Session => ({
  id,
  agent,
  title: `a talk with ${agent}`,
  updatedAt: '2026-08-27T00:00:00Z',
  costUsd: null,
  current: false,
  running: false,
})

const model = (sessions: readonly Session[]): SwitcherModel => ({
  projects: [{ id: 'the-office', name: 'The office', missing: [], conversations: sessions.length, lastActiveAt: null, running: false }],
  activeProject: 'the-office',
  sessions,
  root: '/w',
  manager: 'manager',
  now: Date.parse('2026-08-27T01:00:00Z'),
})

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

function mounted(sessions: readonly Session[]) {
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
  switcher.render(model(sessions))
  trigger.dispatchEvent({ type: 'click', bubbles: true })

  return {
    trigger,
    list,
    newOpen,
    newMenu,
    switcher,
    text: () => (list.textContent ?? '').replace(/\s+/g, ' '),
    items: () => all(newMenu).filter((n) => n.classList.contains('popmenu__item')),
    openNew: () => newOpen.dispatchEvent({ type: 'click', bubbles: true }),
    key: (target: El, k: string) => target.dispatchEvent({ type: 'keydown', bubbles: true, key: k, preventDefault: () => {} }),
  }
}

test('a project with no conversations says so rather than leaving a gap', () => {
  const s = mounted([])
  assert.match(
    s.text(),
    /No conversations in this project yet/i,
    'an empty project renders as a heading with nothing under it, which reads as a list that ' +
      'failed to load rather than a project nobody has talked in',
  )
})

test('nobody you have talked to means no heading at all', () => {
  // The opposite rule to the one above, deliberately. A heading over an empty group advertises
  // a feature; the way in is clicking somebody on the floor.
  const s = mounted([session('s1', 'manager')])
  assert.equal(
    /People you have talked to/i.test(s.text()),
    false,
    'the people heading is drawn over nobody, which advertises a feature instead of listing what ' +
      'is there',
  )
})

test('somebody you have talked to appears under their own heading', () => {
  const s = mounted([session('s1', 'manager'), session('s2', 'reviewer')])
  const text = s.text()
  assert.match(text, /People you have talked to/i, 'a conversation with an employee is filed under the office’s own list')
  assert.match(text, /reviewer/, 'the employee is not named anywhere')
})

test('the “+” menu walks by arrow key and clamps at both ends', () => {
  const s = mounted([])
  s.openNew()
  const items = s.items()
  assert.ok(items.length >= 2, `only ${items.length} item(s) in the + menu — nothing to walk`)

  items[0]?.focus()
  s.key(s.newMenu, 'ArrowDown')
  assert.equal(items[1]?.focused, true, 'ArrowDown did not move to the next item')

  s.key(s.newMenu, 'ArrowUp')
  assert.equal(items[0]?.focused, true, 'ArrowUp did not move back')

  s.key(s.newMenu, 'ArrowUp')
  assert.equal(items[0]?.focused, true, 'ArrowUp from the first item wrapped instead of clamping')
})

test('Escape leaves the “+” menu and puts focus back on what opened it', () => {
  const s = mounted([])
  s.openNew()
  assert.equal(s.newMenu.hidden, false, 'the + menu never opened, so closing it proves nothing')
  s.items()[0]?.focus()

  s.key(s.newMenu, 'Escape')
  assert.equal(s.newMenu.hidden, true, 'Escape left the + menu up')
  assert.equal(s.newOpen.focused, true, 'focus was left on an item that is no longer on screen')
})

test('closing the switcher closes the “+” menu with it', () => {
  // The regression this guards: `escapables()` exists because two lists were left standing at
  // once. A `close` that only took the outer one down reintroduces it a level further in.
  const s = mounted([])
  s.openNew()
  assert.equal(s.newMenu.hidden, false)

  s.switcher.close()

  assert.equal(s.list.hidden, true, 'the switcher stayed open')
  assert.equal(
    s.newMenu.hidden,
    true,
    'the + menu was left standing over the app after the switcher closed — Escape has to mean out',
  )
})
