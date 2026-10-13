/**
 * The field that replaced a dialog Electron does not have.
 *
 * `+ new project` used to call `window.prompt`, which Electron does not implement — it returned
 * `null`, the guard discarded it, and the button did nothing at all. Found by pressing it, not by
 * reading anything, and fixed by giving the row a text field of its own.
 *
 * **That replacement had only a source-level test.** `dialogs-electron-has.test.ts` asserts
 * nothing calls `window.prompt` and that the switcher builds an input — which would still pass if
 * the field were drawn and inert, which is precisely the failure it was written about. This
 * drives it.
 *
 * ## What is pinned
 *
 * 1. Pressing the row reveals the field and hides the button. Both, because `all: unset` on the
 *    new label took `display: none` off `[hidden]` with it — the button sat beside the field it
 *    had just been replaced by, visible in the app and invisible to the DOM.
 * 2. A name plus Enter reaches the handler. An empty name is a **cancel**, not a failure.
 * 3. Escape and blur put the row back, and neither creates anything.
 * 4. The `+` menu's project entry lands in the **same field**, so there are not two ways to name
 *    a project that can drift apart. That one was wired and checked only by a regex.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mountSwitcher, type SwitcherHandlers, type SwitcherModel } from '../src/renderer/views/switcher.js'
import { installDom, click, type El } from './dom.js'

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

function mounted(on: Partial<SwitcherHandlers> = {}) {
  const trigger = document.createElement('button') as unknown as El
  const list = document.createElement('div') as unknown as El
  const newOpen = document.createElement('button') as unknown as El
  const newMenu = document.createElement('div') as unknown as El
  // The `+` menu ships hidden in `index.html`, and its toggle reads `newMenu.hidden` to decide
  // which way to go. A fresh element here defaults to visible, so without this the first press
  // *closes* a menu that was never open — a difference between the harness's starting state and
  // the app's, rather than anything about the code.
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

  const row = (): El => {
    const found = all(list).find((n) => n.className.includes('swrow--add'))
    assert.ok(found, 'the new-project row is not drawn — this check is blind')
    return found
  }
  const label = (): El => all(row()).find((n) => n.tag === 'button')!
  const field = (): El => all(row()).find((n) => n.tag === 'input')!

  return { trigger, list, newOpen, newMenu, switcher, row, label, field }
}

test('pressing the row shows a field and hides the button', () => {
  // Both halves. `all: unset` on the label took `display: none` off `[hidden]` with it, so the
  // button sat beside the field that had just replaced it — visible in the app, invisible here.
  // The CSS carries the fix; this carries the intent.
  const s = mounted()
  assert.equal(s.field().hidden, true, 'the field is showing before anybody asked')
  assert.equal(s.label().hidden, false)

  click(s.label())

  assert.equal(s.field().hidden, false, 'pressing the row did not reveal the field')
  assert.equal(s.label().hidden, true, 'the button is still there beside the field that replaced it')
})

test('a name and Enter starts a project', () => {
  const started: string[] = []
  const s = mounted({ onNewProject: (name) => started.push(name) })

  click(s.label())
  s.field().value = '  invoice reminders  '
  s.field().dispatchEvent({ type: 'keydown', bubbles: false, key: 'Enter' })

  assert.deepEqual(started, ['invoice reminders'], 'the name did not reach the handler, or arrived untrimmed')
})

test('an empty name is a cancel, not a failure', () => {
  // Somebody opened the field and thought better of it. `createProject` would refuse it anyway,
  // with a message nobody asked for.
  const started: string[] = []
  const s = mounted({ onNewProject: (name) => started.push(name) })

  click(s.label())
  s.field().value = '   '
  s.field().dispatchEvent({ type: 'keydown', bubbles: false, key: 'Enter' })

  assert.deepEqual(started, [], 'an empty name started a project')
  assert.equal(s.label().hidden, false, 'the row did not go back to being a button')
})

test('Escape and looking away both put the row back, and neither creates anything', () => {
  const started: string[] = []
  const s = mounted({ onNewProject: (name) => started.push(name) })

  click(s.label())
  s.field().value = 'not this one'
  s.field().dispatchEvent({ type: 'keydown', bubbles: false, key: 'Escape' })
  assert.equal(s.label().hidden, false, 'Escape left the field open')
  assert.equal(s.field().value, '', 'Escape kept what had been typed')

  click(s.label())
  s.field().value = 'nor this'
  s.field().dispatchEvent({ type: 'blur', bubbles: false })
  assert.equal(s.label().hidden, false, 'looking away left the field open')

  assert.deepEqual(started, [], 'cancelling started a project')
})

test('the + menu lands in the same field, rather than being a second way to name a project', () => {
  // Wired when the prompt was replaced and checked only by a regex until now. Two ways to name a
  // project is two things that can drift, which is the shape `agent-id.ts` exists to prevent one
  // layer down.
  const s = mounted()
  click(s.newOpen)

  const project = all(s.newMenu).find((n) => n.dataset['action'] === 'project')
  assert.ok(project, 'the + menu has no project entry — this check is blind')
  click(project)

  assert.equal(s.field().hidden, false, 'the + menu did not open the naming field')
  assert.equal(s.label().hidden, true, 'the + menu opened the field but left the button beside it')
})

test('the other + entry still starts a conversation', () => {
  // The menu has two jobs and only one of them changed. A test covering the changed half would
  // pass against a menu whose other half had stopped working.
  let sessions = 0
  const s = mounted({ onNewSession: () => (sessions += 1) })
  click(s.newOpen)

  const session = all(s.newMenu).find((n) => n.dataset['action'] === 'session')
  assert.ok(session, 'the + menu has no session entry')
  click(session)

  assert.equal(sessions, 1, 'the + menu stopped starting conversations')
})

/*
 * The third route, which had drifted into doing nothing.
 *
 * The `+` menu's own comment says why this test exists: *"The `+` menu and the list row are the
 * same act, so they end in the same field rather than in two ways of naming a project that can
 * drift apart."* `⌘K → "Start a new project"` was a third way and did not go through here at all
 * — it reached into the closed list for `.swrow--add` and called `.click()` on it. That element
 * is a `div`; the handler is on a button inside it. So the command did nothing whatever, and
 * would have opened a field inside a hidden list even if the element had answered.
 *
 * Found by operating the app rather than by testing it, which is the sixth time this repository
 * has written that sentence.
 */
test('the palette route opens the list and lands in the same field as the + menu', () => {
  const s = mounted()
  assert.equal(s.list.hidden, true, 'the list starts closed, or this proves nothing')

  s.switcher.startNewProject()

  assert.equal(s.list.hidden, false, 'the list is still closed, so the field is in something nobody can see')
  assert.equal(s.field().hidden, false, 'the naming field never opened')
  assert.equal(s.label().hidden, true, 'the button is still beside the field that replaced it')
})

test('the palette route commits through the same handler as every other route', () => {
  const named: string[] = []
  const s = mounted({ onNewProject: (name) => named.push(name) })

  s.switcher.startNewProject()
  const field = s.field()
  field.value = 'payment-page'
  field.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true, preventDefault: () => {} })

  assert.deepEqual(named, ['payment-page'], 'a project named through the palette route never reached the handler')
})
