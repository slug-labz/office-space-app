/**
 * A standing condition, said when it changes rather than every time it is noticed.
 *
 * `loadCommands` runs at boot and on **every workspace rescan** — `.claude/` is watched, so a
 * rescan is also the signal that somebody has just written a command, which is the point of
 * re-reading. It then said every problem it found, every time.
 *
 * Measured in the running app with `.claude/commands/` unreadable: **three notices at boot, and
 * three more from three file touches.** An unreadable directory is true until somebody fixes it,
 * and reporting it as a fresh event on every scan fills the transcript with one fact — the same
 * failure the mishap repeat-gate exists to prevent, arriving somewhere else entirely.
 *
 * ## Changed, not once
 *
 * *Once* would be wrong in the other direction. A directory that becomes unreadable, is fixed,
 * and breaks again has failed twice, and the second time is news. What is not news is the same
 * condition observed a fourth time in ninety seconds.
 *
 * That also covers the case nobody writes a guard for — the problem going away — because `null`
 * is a value like any other and the change back through it is a change.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SaidOnce } from '../src/shared/said-once.js'

test('the first time is worth saying', () => {
  const said = new SaidOnce()
  assert.equal(said.changed('EACCES on commands/'), true)
})

test('the same thing again is not', () => {
  const said = new SaidOnce()
  said.changed('EACCES on commands/')
  assert.equal(said.changed('EACCES on commands/'), false)
  assert.equal(said.changed('EACCES on commands/'), false, 'it started repeating again after two')
})

test('a different problem is news', () => {
  // Two different faults are two facts. A gate keyed on "have I said anything" rather than "have
  // I said this" would swallow the second one entirely.
  const said = new SaidOnce()
  said.changed('EACCES on commands/')
  assert.equal(said.changed('ENOENT on commands/'), true)
})

test('the problem going away is a change, and so is it coming back', () => {
  // The case a `hasSaid` boolean cannot express. A directory that breaks, is fixed, and breaks
  // again has failed twice, and the second failure is news.
  const said = new SaidOnce()
  said.changed('EACCES on commands/')
  assert.equal(said.changed(null), true, 'clearing was not registered, so the next break is silent')
  assert.equal(said.changed('EACCES on commands/'), true, 'the second failure was swallowed')
})

test('nothing, repeatedly, stays nothing', () => {
  // The common case by far: a healthy workspace rescanning all day. It must not report the
  // absence of a problem as a change on every scan.
  const said = new SaidOnce()
  assert.equal(said.changed(null), false, 'the first "nothing to report" was reported')
  assert.equal(said.changed(null), false)
})

test('what was last said can be asked without changing it', () => {
  const said = new SaidOnce()
  said.changed('EACCES')
  assert.equal(said.current, 'EACCES')
  assert.equal(said.changed('EACCES'), false, 'reading it counted as saying it')
})
