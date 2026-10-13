/**
 * Which rows in the switcher carry a destructive control, and which must not.
 *
 * `switcher.test.ts` asserts that `projectRows` marks the office `isOffice: true`, and
 * `views/switcher.ts` guards the archive and delete controls behind `if (!p.isOffice)`. Between
 * those two facts there was nothing: a flag that is set correctly does not prove the view reads
 * it, and the view is where somebody would lose their office.
 *
 * The office is not a directory under `projects/`. Archiving it would move nothing and deleting
 * it would delete nothing — so the controls would be refused, and the view's own comment says
 * why they are absent rather than disabled: *"offering a control that would be refused teaches
 * nothing."*
 *
 * Verified by hand in the running app first — the office row had no buttons, a real project had
 * both, and `delete` opened a native confirmation naming the directory before anything moved.
 * This is that walk, kept.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { mountSwitcher, type SwitcherHandlers, type SwitcherModel } from '../src/renderer/views/switcher.js'
import { OFFICE_PROJECT } from '../src/shared/ipc.js'

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
    /*
     * `OFFICE_PROJECT`, not a plausible-looking string.
     *
     * It is `''`, and the three switcher DOM tests that came before this one all say
     * `id: 'the-office'` — a name that reads correctly and is not the office, so none of them has
     * ever rendered the row this file is about. Written the same way here, this test would have
     * asserted that a normal project has no delete button and failed against an app doing exactly
     * the right thing.
     */
    { id: OFFICE_PROJECT, name: 'The office', missing: [], conversations: 1, lastActiveAt: null, running: false },
    { id: 'payment-page', name: 'payment page', missing: [], conversations: 0, lastActiveAt: null, running: false },
  ],
  activeProject: OFFICE_PROJECT,
  sessions: [
    {
      id: 's1',
      agent: 'manager',
      title: 'a conversation',
      updatedAt: '2026-08-27T00:00:00Z',
      costUsd: null,
      current: true,
      running: false,
    },
  ],
  root: '/w',
  manager: 'manager',
  now: Date.parse('2026-08-27T01:00:00Z'),
}

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

function mounted(on: Partial<SwitcherHandlers> = {}): { list: El } {
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
    { ...quiet, ...on },
  )
  switcher.render(MODEL)
  return { list }
}

/** The buttons inside the project row whose own label starts with this name. */
function controlsOn(list: El, name: string): string[] {
  const row = all(list).find(
    (n) => (n.className ?? '').includes('swrow') && (n.textContent ?? '').trim().startsWith(name),
  )
  assert.ok(row, `no row for ${name} — this check is blind`)
  return all(row)
    .filter((n) => n.tag === 'button')
    .map((b) => (b.textContent ?? b.getAttribute?.('aria-label') ?? '').trim())
}

test('a real project offers archive and delete', () => {
  const { list } = mounted()
  const controls = controlsOn(list, 'payment page')
  assert.ok(controls.includes('archive'), `payment page has ${JSON.stringify(controls)}`)
  assert.ok(controls.includes('delete'))
})

/*
 * The one that matters.
 *
 * There is no `projects/the-office/` to archive or remove, so both controls would be refused —
 * and a refused control is worse than an absent one, because it teaches that the button is the
 * way and then does not work.
 */
test('the office offers neither, because there is no directory behind it', () => {
  const { list } = mounted()
  const controls = controlsOn(list, 'The office')
  assert.equal(controls.includes('archive'), false, `the office row has ${JSON.stringify(controls)}`)
  assert.equal(controls.includes('delete'), false, 'the office row offers to delete the office')
})

test('both controls reach their handler with the project they belong to', () => {
  const archived: string[] = []
  const deleted: string[] = []
  const { list } = mounted({
    onArchiveProject: (id) => archived.push(id),
    onDeleteProject: (id) => deleted.push(id),
  })

  const row = all(list).find(
    (n) => (n.className ?? '').includes('swrow') && (n.textContent ?? '').trim().startsWith('payment page'),
  )
  assert.ok(row)
  const press = (label: string): void => {
    const button = all(row)
      .filter((n) => n.tag === 'button')
      .find((b) => (b.textContent ?? '').trim() === label)
    assert.ok(button, `no ${label} button`)
    button.dispatchEvent({ type: 'click', bubbles: true })
  }

  press('archive')
  press('delete')

  // The id, not the display name. `payment page` is what the row shows; `payment-page` is the
  // directory, and handing the label to a handler that takes a path is how the wrong thing gets
  // moved — or nothing does, quietly.
  assert.deepEqual(archived, ['payment-page'])
  assert.deepEqual(deleted, ['payment-page'])
})
