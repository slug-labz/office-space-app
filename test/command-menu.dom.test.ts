/**
 * The slash menu, and the one key that means two things.
 *
 * `--print` resolves a slash command before the model ever sees it, so this list does not make
 * commands work — they already work. What it fixes is that a *wrong* one is silent: type `/stat`
 * for `/state` and the CLI answers it synthetically, at zero cost, with no error and no reply.
 * Nothing tells you that you misspelled it. Nothing was aimed at this module.
 *
 * ## The invariant
 *
 * `handleKey` returns whether it consumed the key, and the composer is expected to stop if it
 * did. Its own comment names the case:
 *
 *     Arrow keys and Enter mean something different while a menu is open, and Enter especially:
 *     sending the message and choosing an item are both reasonable readings, and only one of
 *     them can happen.
 *
 * Return false for Enter while the menu is open and both happen: the composer picks a command
 * *and* sends the half-written message. Return true while it is closed and Enter stops sending
 * anything at all. Both directions are one boolean, and neither shows up as an error.
 *
 * So the return value is asserted on every branch, not just the behaviour behind it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { CommandMenu } from '../src/renderer/views/command-menu.js'
import type { Invocable } from '../src/shared/ipc.js'

installDom()

const item = (name: string, kind: Invocable['kind'] = 'command'): Invocable => ({
  name,
  description: `does ${name}`,
  argumentHint: null,
  kind,
})

const ITEMS: readonly Invocable[] = [
  item('state'),
  item('status'),
  item('graphify', 'skill'),
  item('review'),
]

interface Rig {
  readonly menu: CommandMenu
  readonly root: El
  readonly chosen: string[]
  readonly dismissed: number[]
  readonly rows: () => string[]
  readonly selected: () => string
}

function rig(): Rig {
  const root = document.createElement('div')
  const chosen: string[] = []
  const dismissed: number[] = []
  const menu = new CommandMenu(root, {
    onChoose: (i) => chosen.push(i.name),
    onDismiss: () => dismissed.push(dismissed.length + 1),
  })
  menu.setItems(ITEMS)

  const all = (n: El): El[] => [n, ...n.children.flatMap(all)]
  const rowsOf = (): El[] => all(root as unknown as El).filter((n) => n.classList.contains('slash__row'))
  return {
    menu,
    root: root as unknown as El,
    chosen,
    dismissed,
    rows: () => rowsOf().map((r) => (r.textContent || '').trim()),
    selected: () => (rowsOf().find((r) => r.classList.contains('slash__row--on'))?.textContent ?? '(none)').trim(),
  }
}

test('a token shows what matches it', () => {
  const r = rig()
  assert.equal(r.menu.open, false, 'it must start closed')

  r.menu.show('stat')
  assert.equal(r.menu.open, true)
  // The control: an empty list would satisfy "no wrong item is shown" without showing anything.
  assert.ok(r.rows().length > 0, 'the menu opened and drew no rows')
  assert.ok(
    r.rows().every((row) => row.includes('stat')),
    `"stat" drew ${JSON.stringify(r.rows())}`,
  )
})

test('a token nothing matches hides, rather than showing an empty box', () => {
  const r = rig()
  r.menu.show('stat')
  assert.equal(r.menu.open, true)

  r.menu.show('zzzznothing')
  assert.equal(
    r.menu.open,
    false,
    'the composer is still perfectly usable for a command this app has never heard of — the CLI ' +
      'decides what exists, so an empty box would be this menu claiming otherwise',
  )
  assert.deepEqual(r.rows(), [], 'hiding must clear the rows, or the next open flashes the old ones')
})

test('Enter while the menu is open is consumed, so the message is not also sent', () => {
  // The invariant this file exists for. If this returns false, the composer picks a command and
  // sends the half-written message in the same keystroke.
  const r = rig()
  r.menu.show('state')

  const handled = r.menu.handleKey('Enter')
  assert.equal(handled, true, 'Enter was not consumed while the menu was open')
  assert.deepEqual(r.chosen, ['state'])
  assert.equal(r.menu.open, false, 'choosing must close the menu')
})

test('Enter while the menu is closed is left alone, so the message can be sent', () => {
  // The other direction, and it is the same boolean. Consuming Enter while closed would make the
  // composer unable to send anything at all.
  const r = rig()
  assert.equal(r.menu.open, false)

  for (const key of ['Enter', 'Escape', 'ArrowDown', 'Tab', 'a']) {
    assert.equal(r.menu.handleKey(key), false, `${key} was consumed while the menu was closed`)
  }
  assert.deepEqual(r.chosen, [])
  assert.deepEqual(r.dismissed, [])
})

test('a key the menu has no use for is handed back even while it is open', () => {
  const r = rig()
  r.menu.show('s')
  assert.equal(r.menu.handleKey('a'), false, 'an ordinary character was swallowed, so typing would stop')
  assert.equal(r.menu.open, true, 'and it must not close on one either')
})

test('the arrows walk the list and wrap', () => {
  const r = rig()
  r.menu.show('s')
  assert.ok(r.rows().length >= 2, `this needs at least two matches; "s" drew ${r.rows().length}`)

  const first = r.selected()
  assert.notEqual(first, '(none)', 'nothing is selected on open, so Enter would choose nothing')

  assert.equal(r.menu.handleKey('ArrowDown'), true)
  assert.notEqual(r.selected(), first, 'ArrowDown did not move the selection')

  for (let i = 1; i < r.rows().length; i += 1) r.menu.handleKey('ArrowDown')
  assert.equal(r.selected(), first, 'the selection did not wrap round to the top')

  r.menu.handleKey('ArrowUp')
  assert.equal(r.selected(), r.rows()[r.rows().length - 1], 'ArrowUp from the top must wrap to the bottom')
})

test('Tab chooses too, and Escape dismisses without choosing', () => {
  const r = rig()
  r.menu.show('state')
  assert.equal(r.menu.handleKey('Tab'), true)
  assert.deepEqual(r.chosen, ['state'], 'Tab did not choose — it is the other key people complete with')

  r.menu.show('state')
  assert.equal(r.menu.handleKey('Escape'), true)
  assert.equal(r.menu.open, false)
  assert.deepEqual(r.chosen, ['state'], 'Escape chose something')
  assert.deepEqual(r.dismissed, [1], 'the caller was not told the menu was dismissed')
})

test('re-showing resets the selection to the top', () => {
  // Otherwise the index survives a filter that made the list shorter, and Enter picks whatever
  // now happens to sit at a position chosen against a different list.
  const r = rig()
  r.menu.show('s')
  r.menu.handleKey('ArrowDown')
  const moved = r.selected()

  r.menu.show('s')
  assert.notEqual(r.selected(), moved, 'the selection survived a re-show')
  assert.equal(r.selected(), r.rows()[0])
})
