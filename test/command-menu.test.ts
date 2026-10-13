/**
 * The slash menu's two decisions.
 *
 * Both are pure and both are the kind of thing that is obviously right until somebody types
 * something ordinary and it misbehaves — so they are tested against the ordinary thing rather
 * than against the happy path.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { filterItems, slashToken } from '../src/shared/slash.js'
import type { Invocable } from '../src/shared/ipc.js'

const items: readonly Invocable[] = [
  { name: 'state', description: '', argumentHint: null, kind: 'command' },
  { name: 'verify', description: '', argumentHint: '<ref>', kind: 'command' },
  { name: 'meet', description: '', argumentHint: 'reviewer', kind: 'skill' },
  { name: 'record-progress', description: '', argumentHint: null, kind: 'skill' },
  { name: 'reset', description: '', argumentHint: null, kind: 'command' },
]

test('a leading slash opens the menu', () => {
  assert.equal(slashToken('/', 1), '')
  assert.equal(slashToken('/me', 3), 'me')
  assert.equal(slashToken('/meet', 5), 'meet')
})

test('a path mid-sentence does NOT open the menu', () => {
  // The case that makes this a function rather than `text.includes('/')`. Somebody writing
  // "the binary is in /usr/local/bin" is writing prose, and a menu opening under their cursor
  // is the office interrupting them to offer something they did not ask for.
  assert.equal(slashToken('the binary is in /usr/local/bin', 31), null)
  assert.equal(slashToken('look at src/main/session.ts', 27), null)
  assert.equal(slashToken('what about a/b testing', 22), null)
})

test('once you are past the command name, the menu closes', () => {
  // You have chosen. What you are typing now is arguments, and a list of commands is no longer
  // what you need in front of you.
  assert.equal(slashToken('/meet reviewer', 14), null)
  assert.equal(slashToken('/meet ', 6), null)
  // …but a caret still inside the name keeps it open, so going back to fix a typo works.
  assert.equal(slashToken('/meet reviewer', 3), 'meet')
})

test('an empty token offers everything', () => {
  assert.equal(filterItems(items, '').length, items.length)
})

test('a prefix match beats a match in the middle', () => {
  // Typing "s" means "the thing starting with s". `state` starts with it; `reset` and
  // `record-progress` merely contain it. Ranking by position is what makes the first Enter
  // press land on what somebody meant rather than on whatever sorted first alphabetically —
  // without it, `record-progress` would win on the alphabet alone.
  const names = filterItems(items, 's').map((i) => i.name)
  assert.equal(names[0], 'state', 'the prefix match must come first')
  assert.deepEqual(names.slice(1), ['record-progress', 'reset'], 'mid matches follow, alphabetically')
})

test('filtering is case-insensitive, because typing is', () => {
  assert.deepEqual(filterItems(items, 'MEET').map((i) => i.name), ['meet'])
})

test('nothing matching returns nothing, rather than everything', () => {
  // The menu hides on an empty result. Falling back to the full list would put a list of five
  // things under somebody typing a sixth, which reads as the office not listening.
  assert.deepEqual(filterItems(items, 'zzz'), [])
})
