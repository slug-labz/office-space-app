import { test } from 'node:test'
import assert from 'node:assert/strict'

import { FrameGate } from '../src/shared/floor/frame-gate.js'

/** Run `n` frames with nothing moving, and report how many were drawn. */
function idle(gate: FrameGate, n: number): number {
  let drawn = 0
  for (let i = 0; i < n; i++) if (gate.frame(false)) drawn++
  return drawn
}

test('a moving office draws every frame', () => {
  const g = new FrameGate()
  for (let i = 0; i < 10; i++) assert.equal(g.frame(true), true)
  assert.equal(g.isParked, false)
})

test('THE BUDGET: a still office draws once and then stops', () => {
  // The charter's first line. One frame to settle the last change, then nothing at all — not a
  // cheaper frame, not a throttled frame. Nothing.
  const g = new FrameGate()
  assert.equal(g.frame(false), true, 'the first frame settles the initial state')
  assert.equal(idle(g, 600), 0, '600 still frames must draw nothing')
  assert.equal(g.isParked, true)
  assert.equal(g.framesDrawn, 1)
})

test('THE DANGER: a parked gate wakes when something is announced', () => {
  // The failure this whole thing risks: park and never come back, leaving the floor frozen on a
  // stale picture. That is worse than the waste it replaces, and invisible until someone
  // notices the office has stopped reacting.
  const g = new FrameGate()
  idle(g, 5)
  assert.equal(g.isParked, true)

  assert.equal(g.invalidate(), true, 'invalidate must tell the caller to restart the loop')
  assert.equal(g.isParked, false)
  assert.equal(g.frame(false), true, 'and the next frame draws even though nothing moved')
})

test('announcing while already running does not ask for a second loop', () => {
  // Two loops requesting frames would double the cost of everything and be very hard to see.
  const g = new FrameGate()
  g.frame(true)
  assert.equal(g.invalidate(), false)
  assert.equal(g.invalidate(), false)
})

test('a change announced mid-flight is still drawn', () => {
  const g = new FrameGate()
  g.frame(true)
  g.invalidate()
  assert.equal(g.frame(false), true, 'nothing moved, but something was announced')
  assert.equal(g.frame(false), false, 'and only once')
})

test('movement alone never parks, however long it lasts', () => {
  const g = new FrameGate()
  for (let i = 0; i < 1000; i++) g.frame(true)
  assert.equal(g.isParked, false)
  assert.equal(g.framesDrawn, 1000)
})

test('a stopped gate is torn down, not resting', () => {
  // stop() is teardown — switching away, closing a project. It must not look like a park that
  // is waiting to be woken.
  const g = new FrameGate()
  idle(g, 3)
  g.stop()
  assert.equal(g.isParked, false)
})
