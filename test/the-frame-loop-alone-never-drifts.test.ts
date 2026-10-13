/**
 * The frame loop alone can never produce a break, which is why there is a timer.
 *
 * This file used to be called `the-office-never-drifts` and it recorded a defect: a documented
 * feature — after `BREAK_AFTER_MS` of idleness somebody gets up and walks — that had never once
 * happened. Measured then in the running app: eighty-five seconds still, not one pixel.
 *
 * The office drifts now. What is preserved here is the finding underneath it, because it is the
 * whole justification for how the fix works.
 *
 * ## The join
 *
 * `FrameGate` parks the loop the moment a frame changes nothing — *"zero draw calls while
 * nothing changes"*, which is what makes a campus of idle offices affordable. And
 * `Choreographer.ambient(dtMs)` accumulates idle time only from the `dtMs` it is handed, so it
 * only advances when it is called. The loop that would earn a break is switched off by the
 * office becoming idle.
 *
 * Both designs are right. Driven the way `FloorView.start()` drives it, and *only* that way, a
 * break is unreachable — and that is still true and asserted below. It is the reason the fix is
 * a sleeping timer armed at the moment the loop parks, rather than a check inside the loop:
 * a check would spend exactly the budget the gate exists to protect.
 *
 * The unit tests never saw it because they drive `ambient` directly — `for (let t = 0; t <
 * 300_000; t += 1000) c.ambient(1000, …)` — which is the loop the app stops running. Every one
 * of them passed, and the behaviour they described did not reach a screen.
 *
 * ## Where the other half lives
 *
 * `the-office-drifts.dom.test.ts` holds the behaviour: a real `FloorView`, parked, waking itself
 * once and taking a break. This file holds the constraint that shapes it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Choreographer } from '../src/shared/floor/choreography.js'
import { FrameGate } from '../src/shared/floor/frame-gate.js'

const ROSTER = ['Manager', 'builder', 'tester', 'reviewer']

/** A minute and a half of frames at 60fps — well past every threshold in the break system. */
const FRAMES = 60 * 90
const FRAME_MS = 1000 / 60

/**
 * `FloorView.start()`, with the canvas taken out.
 *
 * The shape is the load-bearing part: `ambient` is called, its answer feeds the gate, and the
 * loop ends the moment the gate parks — exactly as `raf = 0` ends it in the renderer.
 */
function runLikeTheApp(): { breaks: number; parkedAfter: number | null } {
  const chore = new Choreographer({ manager: 'Manager', roster: ROSTER })
  const gate = new FrameGate()
  let breaks = 0

  for (let frame = 0; frame < FRAMES; frame += 1) {
    const drifted = chore.ambient(FRAME_MS, { pick: () => 0 }).routines.length > 0
    if (drifted) breaks += 1
    // `drifted` is the whole of it, and `step()` cannot rescue this.
    //
    // `step()` does have a clock of its own — the cat's pose changes every `PET_SETTLE_MS` — and
    // on the face of it that would keep waking the loop. It cannot, for the same reason: once
    // the gate parks, `floor-view.ts` sets `raf = 0` and `step()` stops being called too. The
    // cat's clock and the choreographer's idle counter are both advanced only by the loop that
    // has stopped. That is why the live sampling saw zero pixels change in 85 seconds rather
    // than a cat twitching every few seconds, which is what it would have seen otherwise.
    if (!gate.frame(drifted)) return { breaks, parkedAfter: frame + 1 }
  }
  return { breaks, parkedAfter: null }
}

/** The same choreography, driven the way the unit tests drive it: forever, unconditionally. */
function runLikeTheTests(): number {
  const chore = new Choreographer({ manager: 'Manager', roster: ROSTER })
  let breaks = 0
  for (let frame = 0; frame < FRAMES; frame += 1) {
    breaks += chore.ambient(FRAME_MS, { pick: () => 0 }).routines.length
  }
  return breaks
}

test('the choreography does stage breaks when something keeps calling it', () => {
  // The control. If this is zero the composition below proves nothing — it would be measuring a
  // choreographer that never breaks, rather than a loop that stops asking.
  const breaks = runLikeTheTests()
  assert.ok(
    breaks > 0,
    `driving ambient() unconditionally for 90 seconds staged ${breaks} routines. The break ` +
      `system is supposed to fire after ${45}s, so either the thresholds changed or this test ` +
      `is no longer driving it correctly — fix that before reading anything into the test below.`,
  )
})

test('but the loop that would call it stops the moment the office goes idle', () => {
  const { breaks, parkedAfter } = runLikeTheApp()

  assert.notEqual(
    parkedAfter,
    null,
    'the frame gate never parked across 90 seconds of idle frames, which is the opposite of the ' +
      'behaviour it exists for — if this is now true, the finding this file records has been ' +
      'fixed from the other end and the assertions below should be rewritten',
  )

  assert.ok(
    parkedAfter !== null && parkedAfter < 60,
    `the gate parked after ${parkedAfter} frames — under a second, as designed`,
  )

  assert.equal(
    breaks,
    0,
    `driven the way FloorView.start() drives it, ${breaks} breaks were staged in 90 seconds. ` +
      `Zero is correct and is the point: the frame loop alone cannot earn one, which is why the ` +
      `floor arms a timer when it parks instead of checking while it runs. If this is ever ` +
      `above zero, something has started spending frames on an idle office — look at what is ` +
      `keeping the gate awake before celebrating.`,
  )
})
