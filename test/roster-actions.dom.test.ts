/**
 * The two clicks that remove somebody, driven the way a person drives them.
 *
 * `views/roster.ts` was on the parked list — 283 lines carrying the only destructive controls in
 * the app: `Fire`, which deletes an agent's file, and `Send home`, which renames it to `.off`.
 * `roster.ts` in main is well covered and `roster-view.ts` is well covered; the buttons between
 * them were not.
 *
 * ## The arming, which is the reason this file exists
 *
 * `Fire` does **not** fire on a click. The first click arms it and relabels it *"Delete their
 * file — click again"*; the second does the work; a `blur` disarms it. That is a real safety
 * property with real cost if it silently stops holding — and nothing was checking it, so a
 * refactor that made the button ordinary would have looked like a simplification and passed
 * every test in the repository.
 *
 * ## And the manager
 *
 * `staffRows` gives the manager no actions at all: `member.isManager ? [] : ['bench', 'fire']`.
 * That is the *renderer's* half of a rule the writing layer also holds — `fire()` and `disable()`
 * in `main/roster.ts` refuse the manager by id. Both halves are deliberate, and the comment in
 * `main/roster.ts` is explicit that a renderer check is a courtesy and never a guarantee. This
 * pins the courtesy; the guarantee has its own tests.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderRoster, type RosterHandlers } from '../src/renderer/views/roster.js'
import type { RosterModel } from '../src/shared/roster-view.js'
import { installDom, click, type El } from './dom.js'
import type { StaffMember } from '../src/shared/ipc.js'

installDom()

const person = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: 'builder',
  name: 'builder',
  description: 'Implements features and fixes.',
  tools: ['Read', 'Write'],
  model: 'sonnet',
  isManager: false,
  ...over,
})

const quiet: RosterHandlers = {
  onHire: () => {},
  onFire: () => {},
  onBench: () => {},
  onUnbench: () => {},
  onAddSkill: () => {},
  onRemoveSkill: () => {},
}

const host = (): El => document.createElement('div') as unknown as El

function all(node: El): El[] {
  return [node, ...node.children.flatMap((child) => all(child))]
}

function draw(staff: readonly StaffMember[], on: RosterHandlers = quiet): El {
  const into = host()
  const model: RosterModel = { staff, staffUnreadable: false, benched: [], shelf: [], skills: [], dangling: new Map(), unreachable: new Map() }
  renderRoster(into as unknown as HTMLElement, model, on)
  return into
}

function buttons(node: El, label: RegExp): El[] {
  return all(node).filter((n) => n.tag === 'button' && label.test(n.textContent))
}

test('one click on Fire does not fire — it asks again', () => {
  // The property with the most cost if it quietly stops holding. A refactor that made this an
  // ordinary button would read as a simplification and pass everything else here.
  const fired: string[] = []
  const into = draw([person()], { ...quiet, onFire: (id) => fired.push(id) })

  const fire = buttons(into, /^Fire$/)
  assert.equal(fire.length, 1, 'expected exactly one Fire button')

  click(fire[0]!)
  assert.deepEqual(fired, [], 'a single click deleted somebody')
  assert.equal(
    fire[0]!.textContent,
    'Delete their file — click again',
    'the button did not say that it is now armed, so the second click would be a surprise',
  )
})

test('the second click fires, and names the person it was drawn for', () => {
  const fired: string[] = []
  const into = draw([person({ id: 'builder' }), person({ id: 'tester', name: 'tester' })], {
    ...quiet,
    onFire: (id) => fired.push(id),
  })

  // Two rows, so a shared closure shows up as the wrong id rather than as no id.
  const fire = buttons(into, /^Fire$/)
  assert.equal(fire.length, 2)

  click(fire[1]!)
  click(fire[1]!)
  assert.deepEqual(fired, ['tester'], 'the wrong row was fired, or none was')
})

test('looking away disarms it', () => {
  // `blur` resets the button. Without it, arming a row and then going to do something else
  // leaves a live delete on screen, and the next click anywhere near it is destructive.
  const fired: string[] = []
  const into = draw([person()], { ...quiet, onFire: (id) => fired.push(id) })
  const fire = buttons(into, /^Fire$/)[0]!

  click(fire)
  fire.dispatchEvent({ type: 'blur', bubbles: false })
  assert.equal(fire.textContent, 'Fire', 'the button stayed armed after focus left it')

  click(fire)
  assert.deepEqual(fired, [], 'a click after looking away deleted somebody')
})

test('the manager is offered neither button', () => {
  // The renderer's half of the rule. `main/roster.ts` refuses the manager by id as well, and its
  // own comment is explicit that this half is a courtesy and never the guarantee.
  const into = draw([person({ id: 'manager', name: 'manager', isManager: true }), person()])

  const rows = all(into)
  const managerRow = rows.find((n) => n.textContent === 'manager' && n.tag !== 'button')
  assert.ok(managerRow, 'the manager is not on the roster at all')

  // One person on this roster may be fired and it is not the manager.
  assert.equal(buttons(into, /^Fire$/).length, 1, 'the manager was offered a Fire button')
  assert.equal(buttons(into, /Send home/).length, 1, 'the manager was offered a Send home button')
})

test('Send home is not armed, because it takes nothing away', () => {
  // The asymmetry is the point: benching renames a file and is undone by `Bring back`, so making
  // it two-click would be ceremony. Deleting is not undoable, so it is.
  const benched: string[] = []
  const into = draw([person()], { ...quiet, onBench: (id) => benched.push(id) })

  click(buttons(into, /Send home/)[0]!)
  assert.deepEqual(benched, ['builder'], 'Send home needed two clicks, or sent the wrong person')
})
