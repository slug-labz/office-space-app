/**
 * Which side the conversation is on, and why that is a DOM question rather than a CSS one.
 *
 * It was `:root[data-side="left"] .pane { order: -1 }`. CSS reordering is defined not to affect
 * sequential navigation, so the column a person sees first was the second one the keyboard
 * reached — and the default is the conversation on the left, so that was everybody.
 *
 * `ade-af` measured what it cost, tabbing from a cold start on a fresh workspace:
 *
 *     stop 1     #view-toggle      top right
 *     stops 2-7  the status bar    bottom
 *     stop 8     #switcher         top left
 *     stop 9     #new-open         top left
 *
 * Focus crossed the window diagonally twice per cycle, and the top bar was visited at stops 1, 8
 * and 9 with the whole bottom of the screen in between. Everything was reachable and visible —
 * this was never a reachability fault. It is the *order* that was unreadable, which is precisely
 * what checking one control at a time cannot see and a sweep can.
 *
 * Moving the node fixes both at once, and the grid places columns in document order so the widths
 * follow without a second rule. Measured after: the conversation column top to bottom, then the
 * floor column top to bottom — one diagonal instead of two, each column contiguous.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { orderColumns } from '../src/renderer/views/settings.js'

installDom()

function building(): { host: El; pane: El; floor: El; order: () => string[] } {
  const host = document.createElement('main') as unknown as El
  const floor = document.createElement('section') as unknown as El
  floor.className = 'floor'
  const pane = document.createElement('section') as unknown as El
  pane.className = 'pane'
  // The order in `index.html`: the floor is written first and the conversation second.
  host.appendChild(floor)
  host.appendChild(pane)
  return { host, pane, floor, order: () => host.children.map((c) => c.className) }
}

test('on the left, the conversation is first in the document', () => {
  const b = building()
  // The control: it starts in the shipped order, or the assertion below is about nothing.
  assert.deepEqual(b.order(), ['floor', 'pane'], 'the fixture is not in the markup order')

  orderColumns(b.host as unknown as Element, b.pane as unknown as Element, 'left')

  assert.deepEqual(
    b.order(),
    ['pane', 'floor'],
    'the conversation is drawn on the left and still comes second in the document, so Tab reaches ' +
      'the far column first — which is what `order: -1` did and what this replaces',
  )
})

test('on the right, it is last', () => {
  const b = building()
  orderColumns(b.host as unknown as Element, b.pane as unknown as Element, 'left')
  orderColumns(b.host as unknown as Element, b.pane as unknown as Element, 'right')
  assert.deepEqual(b.order(), ['floor', 'pane'])
})

test('and it is moved, not copied', () => {
  // `insertBefore` on a node already in the parent moves it. A shim or an implementation that
  // appended instead would leave two conversation columns, one of them empty and both focusable.
  const b = building()
  orderColumns(b.host as unknown as Element, b.pane as unknown as Element, 'left')
  assert.equal(b.host.children.length, 2, `${b.host.children.length} columns after one move`)
})

test('asking twice for the same side changes nothing', () => {
  // `applySettings` runs on every settings change, including ones that have nothing to do with
  // the side. A move that ran unconditionally would detach and re-attach the column somebody is
  // typing in, on every keystroke of the font-size slider.
  const b = building()
  orderColumns(b.host as unknown as Element, b.pane as unknown as Element, 'left')
  const paneAfterFirst = b.host.children[0]

  orderColumns(b.host as unknown as Element, b.pane as unknown as Element, 'left')

  assert.equal(b.host.children[0], paneAfterFirst, 'the column was moved again when it was already there')
  assert.deepEqual(b.order(), ['pane', 'floor'])
})

test('a third column between them does not get in the way', () => {
  // The building holds whatever it holds. The rule is about where the conversation sits relative
  // to everything else, not about there being exactly two children.
  const b = building()
  const extra = document.createElement('div') as unknown as El
  extra.className = 'scrim'
  b.host.appendChild(extra)

  orderColumns(b.host as unknown as Element, b.pane as unknown as Element, 'left')
  assert.deepEqual(b.order(), ['pane', 'floor', 'scrim'])

  orderColumns(b.host as unknown as Element, b.pane as unknown as Element, 'right')
  assert.deepEqual(b.order(), ['floor', 'scrim', 'pane'])
})
