/**
 * The cap on concurrent `claude` children.
 *
 * The **scalable** exit condition asks for *"a stated cap on concurrent `claude` children with
 * a defined refusal at the cap"* — my own correction in round 18, adopted, and then built by
 * neither of us until laptop 2 found it missing by walking the exit conditions rather than the
 * feature list. It had been an approved requirement with no code behind it for a day.
 *
 * Three properties, and the second is the one a naive implementation gets wrong.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { admit, liveCount, MAX_LIVE, stopAll, track } from '../src/main/children.js'

/** A child that records whether it was asked to stop. Nothing here starts a real process. */
const fake = (what: string) => {
  const state = { stopped: false }
  return { child: { what, stop: () => (state.stopped = true) }, state }
}

/** The registry is module state, so every test starts from empty rather than from the last one. */
function empty(): void {
  stopAll()
}

test('the cap is a number, and it is stated', () => {
  // "Stated" is half the requirement. A cap that exists only as a magic number inside a
  // comparison is one nobody can find, quote, or argue with.
  empty()
  assert.equal(typeof MAX_LIVE, 'number')
  assert.ok(MAX_LIVE > 0)
})

test('admitting up to the cap works, and the next one is refused', () => {
  empty()
  for (let i = 0; i < MAX_LIVE; i++) {
    assert.equal(admit(fake(`child-${i}`).child).ok, true, `child ${i} was refused below the cap`)
  }
  assert.equal(liveCount(), MAX_LIVE)

  const refused = admit(fake('one-too-many').child)
  assert.equal(refused.ok, false)
  empty()
})

test('the refusal says how many, and which — never just "too many"', () => {
  // The requirement is a *defined* refusal. "Too many" is not something anybody can act on;
  // a list is, because it tells you which conversation to stop or that something is looping.
  empty()
  for (let i = 0; i < MAX_LIVE; i++) admit(fake(`claude (proj-${i})`).child)

  const refused = admit(fake('extra').child)
  assert.equal(refused.ok, false)
  const reason = refused.ok === false ? refused.reason : ''

  assert.match(reason, new RegExp(String(MAX_LIVE)), 'the refusal does not say what the cap is')
  assert.match(reason, /claude \(proj-0\)/, 'the refusal does not name what is running')
  assert.match(reason, /Nothing was started/, 'the refusal does not say that nothing happened')
  empty()
})

test('a refused child is NOT registered', () => {
  // The failure a naive version has: checking the count, refusing, and having already added the
  // child. The cap then ratchets — every refusal makes the next one more certain, and the
  // registry fills with processes that never existed.
  empty()
  for (let i = 0; i < MAX_LIVE; i++) admit(fake(`child-${i}`).child)

  admit(fake('refused').child)
  admit(fake('refused-again').child)
  assert.equal(liveCount(), MAX_LIVE, 'a refused child was counted anyway')
  empty()
})

test('releasing a seat lets the next one in', () => {
  // Otherwise the cap is a lifetime quota rather than a concurrency limit, and the app stops
  // working after twelve turns instead of twelve *simultaneous* turns.
  empty()
  const seats = []
  for (let i = 0; i < MAX_LIVE; i++) {
    const got = admit(fake(`child-${i}`).child)
    if (got.ok) seats.push(got.release)
  }
  assert.equal(admit(fake('blocked').child).ok, false)

  seats[0]?.()
  assert.equal(liveCount(), MAX_LIVE - 1)
  assert.equal(admit(fake('now-fits').child).ok, true, 'a freed seat was not reusable')
  empty()
})

test('the check and the registration are one operation', () => {
  // Two projects whose turns begin in the same tick would both read `MAX_LIVE - 1` and both
  // start, and the cap would be exceeded exactly when it was being enforced. `admit` exists
  // instead of `liveCount() < MAX_LIVE` followed by `track()` for this reason, and the shape of
  // the API is what makes the race unwritable rather than merely unlikely.
  empty()
  for (let i = 0; i < MAX_LIVE - 1; i++) admit(fake(`child-${i}`).child)

  // Both "arrive" with one seat left. Exactly one gets it.
  const a = admit(fake('a').child)
  const b = admit(fake('b').child)
  assert.deepEqual([a.ok, b.ok], [true, false])
  assert.equal(liveCount(), MAX_LIVE)
  empty()
})

test('stopAll frees every seat, so quit does not leave the cap held', () => {
  empty()
  const kids = Array.from({ length: MAX_LIVE }, (_, i) => fake(`child-${i}`))
  for (const k of kids) admit(k.child)

  const stopped = stopAll()
  assert.equal(stopped.length, MAX_LIVE)
  assert.equal(liveCount(), 0)
  assert.ok(kids.every((k) => k.state.stopped), 'a child was dropped from the registry without being stopped')
})

test('track still works for anything that is not capped', () => {
  // `track` is deliberately left uncapped. Not every child is a `claude`, and a cap on the
  // registry itself would refuse to *record* a process that had already started — which is the
  // one thing worse than not capping it, because then quit cannot find it.
  empty()
  for (let i = 0; i < MAX_LIVE + 5; i++) track(fake(`other-${i}`).child)
  assert.equal(liveCount(), MAX_LIVE + 5)
  empty()
})
