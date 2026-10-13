/**
 * The coffee break, which now happens.
 *
 * `the-office-never-drifts.test.ts` characterised the office standing perfectly still and said
 * which way to rewrite it once somebody chose. Vish delegated the choice; it is made, and this
 * is the other side of it.
 *
 * ## Why a timer and not a check
 *
 * `FrameGate` parks the loop when a frame changes nothing, and `Choreographer.ambient` only
 * accumulates idle time when it is called \u2014 so the loop that earns a break is switched off by
 * the office becoming idle. Two correct designs; the feature died in the join.
 *
 * Polling would fix it and spend the charter's first budget, *zero draw calls while nothing
 * changes*, which is what makes a campus of idle offices affordable. So the parked floor sleeps
 * for exactly the interval `msUntilNextBreak` reports and wakes once.
 *
 * ## How this is driven
 *
 * Mocked timers, and `performance.now` moved with them. Both, because the timer hands `ambient`
 * the time actually spent parked rather than the interval it asked for \u2014 a clock that did not
 * move would report zero, `ambient` would stage nothing, and the test would watch it re-arm
 * forever while passing every assertion about frames.
 */

import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { FloorView, type FloorCallbacks } from '../src/renderer/floor-view.js'
import type { SpriteSheet, StaffMember } from '../src/shared/ipc.js'

installDom()

const FRAME_W = 16
const FRAME_H = 24
const SHEET: Extract<SpriteSheet, { kind: 'painted' }> = {
  kind: 'painted',
  width: FRAME_W,
  height: FRAME_H,
  frames: {
    down: [new Uint8ClampedArray(FRAME_W * FRAME_H * 4)],
    up: [new Uint8ClampedArray(FRAME_W * FRAME_H * 4)],
    right: [new Uint8ClampedArray(FRAME_W * FRAME_H * 4)],
  },
}

const person = (id: string, isManager = false): StaffMember => ({
  id,
  name: id,
  description: `the ${id}`,
  tools: [],
  model: null,
  isManager,
})

const pending = (): number => (globalThis as unknown as Record<string, () => number>)['__pendingFrames']!()
const runFrame = (now = 0): number =>
  (globalThis as unknown as Record<string, (n?: number) => number>)['__runFrame']!(now)

interface Rig {
  readonly view: FloorView
  /** Put the real clock back, so a failure here does not follow the next test around. */
  readonly restore: () => void
  readonly park: () => void
  readonly advance: (ms: number) => void
  /** One animation frame, with the clock moved on and handed to it. */
  readonly frame: (ms?: number) => void
}

async function floor(): Promise<Rig> {
  const canvas = document.createElement('canvas')
  const stage = document.createElement('div') as unknown as El
  stage.clientWidth = 800
  stage.clientHeight = 600

  const callbacks: FloorCallbacks = {
    onPick: () => {},
    onUnstaged: () => {},
    onDetails: () => {},
    onArtFailed: () => {},
    onStale: () => {},
    onPickProject: () => {},
  }
  const view = new FloorView(canvas as never, stage as never, callbacks)
  await view.setCast([person('manager', true), person('builder'), person('reviewer')], async () => SHEET, 'a-theme')

  let clock = 0
  const perf = globalThis.performance as { now: () => number }
  const realNow = perf.now.bind(perf)
  perf.now = () => clock

  const park = (): void => {
    view.start()
    let ran = 0
    while (pending() > 0 && ran < 400) {
      clock += 16
      runFrame(clock)
      ran += 1
    }
    assert.ok(ran < 400, 'the loop never parked, so there is no timer to arm')
  }

  return {
    view,
    park,
    advance: (ms) => {
      clock += ms
      mock.timers.tick(ms)
    },
    // The timestamp matters: the loop computes `dt` from it, and a frame handed a constant `now`
    // makes every step zero-length — the office animates forever and never settles, which is how
    // the first version of the second test read a working re-arm as a broken one.
    frame: (ms = 16) => {
      clock += ms
      runFrame(clock)
    },
    // Kept so a failing test does not leave a fake clock behind for the next one.
    restore: () => {
      perf.now = realNow
    },
  }
}

test('a parked office wakes itself for a break, and does not poll to do it', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const rig = await floor()
  try {
    rig.park()
    assert.equal(pending(), 0, 'precondition: the floor must be parked')

    // Nothing for the better part of a minute. If this were a poll, frames would appear here.
    rig.advance(30_000)
    assert.equal(pending(), 0, 'the floor woke before anybody could have earned a break')

    // Past the longest threshold.
    rig.advance(50_000)
    assert.ok(
      pending() > 0,
      'the office sat idle past the point a break is earned and never woke. That is the bug this ' +
        'was written to fix, and the timer is not firing.',
    )
  } finally {
    // The pending-frame count is global to the harness, so a floor left running here makes the
    // next test's park never finish. That is what the first version of this file did, and it
    // failed the *second* test at its first assertion for a reason created by the first.
    rig.view.stop()
    rig.restore()
    mock.timers.reset()
  }
})

test('a break is earned again after one has been taken', () => {
  // A design that fires exactly once would satisfy the first test in this file and be useless by
  // the second minute. Raised in review before any of it was written: the verify as originally
  // stated observed one break and a return to stillness, which a fire-once timer passes.
  //
  // What is *not* asserted here is the cancel-on-change. A floor that is woken re-parks and arms
  // a fresh timer, so "did a frame appear" cannot tell a stale timer from a new one, and a test
  // that claimed to check it would be reading its own re-arm. The cancel is held by the stop
  // test below, which exercises the same `disarmBreak` from the one place where nothing re-arms
  // afterwards.
  return (async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    const rig = await floor()
    try {
      rig.park()
      rig.advance(80_000)
      assert.ok(pending() > 0, 'the first break never came, so there is no second to wait for')

      // Let the break animate through and the floor settle again.
      let ran = 0
      while (pending() > 0 && ran < 2_000) {
        rig.frame()
        ran += 1
      }
      assert.ok(ran < 2_000, 'the office never settled after its break — the loop is not parking again')

      // In steps, not one jump. The timer hands `ambient` the time actually spent parked, and a
      // single leap past the discontinuity bound is correctly discarded as a machine that was
      // away rather than an office that was idle — so waiting out a cooldown means waiting, the
      // way the app does. Written this way it does not care what the cooldown is set to, which
      // the first version did: it advanced a fixed hundred seconds and started failing the
      // moment that number was tuned.
      let waited = 0
      while (pending() === 0 && waited < 900_000) {
        rig.advance(120_000)
        waited += 120_000
      }

      assert.ok(
        pending() > 0,
        'the office took one break and then stood still forever. The timer fires once and is ' +
          'never re-armed, which passes a verify that only watches for a single break.',
      )
    } finally {
      rig.view.stop()
      rig.restore()
      mock.timers.reset()
    }
  })()
})

test('stopping the floor takes the pending break with it', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const rig = await floor()
  try {
    rig.park()
    rig.view.stop()

    mock.timers.tick(200_000)
    assert.equal(pending(), 0, 'a stopped floor woke itself up for a coffee break')
  } finally {
    // The pending-frame count is global to the harness, so a floor left running here makes the
    // next test's park never finish. That is what the first version of this file did, and it
    // failed the *second* test at its first assertion for a reason created by the first.
    rig.view.stop()
    rig.restore()
    mock.timers.reset()
  }
})

test('the campus takes no breaks, and the office takes them again once it is back', async () => {
  // Since the campus paints each card from its own conversation, the open floor is also the
  // focused card's picture. A break taken while the campus is up would make that card the one
  // whose people move, and on a wall of pictures movement reads as work.
  mock.timers.enable({ apis: ['setTimeout'] })
  const rig = await floor()
  try {
    rig.view.setCampus([
      { id: '', name: 'The office', staff: 3, busy: false, waiting: 0, focused: true, session: null },
    ])
    rig.view.setView('campus')

    // Parked, past the longest threshold: nothing wakes it.
    rig.park()
    rig.advance(80_000)
    assert.equal(pending(), 0, 'the campus woke itself up for a coffee break')

    // Kept awake by other changes, for longer than any break takes to earn: still none staged.
    // Nobody's line changes from what it was, and the loop parks as soon as it is left alone. A
    // woken gate draws one more frame than it was asked for, so parking takes a frame or two; a
    // staged break is a walk, which keeps it drawing for far longer than that.
    const staff = ['manager', 'builder', 'reviewer']
    const before = staff.map((who) => rig.view.reasonFor(who).text)
    for (let i = 0; i < 600; i += 1) {
      rig.view.invalidate()
      rig.frame(250)
    }
    assert.deepEqual(staff.map((who) => rig.view.reasonFor(who).text), before, 'somebody was sent on a break while the campus was up')
    let settling = 0
    while (pending() > 0 && settling < 20) {
      rig.frame(16)
      settling += 1
    }
    assert.ok(settling < 20, 'the campus kept drawing after it was left alone, so somebody is walking')

    // The control: the office drifts again once it is on screen.
    rig.view.setView('office')
    rig.park()
    let waited = 0
    while (pending() === 0 && waited < 900_000) {
      rig.advance(40_000)
      waited += 40_000
    }
    assert.ok(pending() > 0, 'the office never took a break after the campus closed')
  } finally {
    rig.view.stop()
    rig.restore()
    mock.timers.reset()
  }
})

test('a break the office armed does not fire once the campus is up', async () => {
  // The test above opens the campus before any timer is armed. This one parks in the office first,
  // so a break is pending when the campus opens. Two things stop it: `setView` disarms it on the
  // way through `invalidate`, and the timer's callback checks for the campus itself. Review took
  // the first away with nothing in its place, and the builder went to the pantry on the campus.
  //
  // The clock passes every threshold before the campus draws its first frame. A campus that parks
  // disarms any pending break itself, because `armBreak` starts with `disarmBreak`. So this is the
  // window a campus stays in while other floors' movement keeps it drawing without ever parking.
  mock.timers.enable({ apis: ['setTimeout'] })
  const rig = await floor()
  try {
    rig.view.setCampus([
      { id: '', name: 'The office', staff: 3, busy: false, waiting: 0, focused: true, session: null },
    ])
    rig.park()
    assert.equal(pending(), 0, 'precondition: the office must be parked, which is what arms a break')
    const staff = ['manager', 'builder', 'reviewer']
    const before = staff.map((who) => rig.view.reasonFor(who).text)

    rig.view.setView('campus')
    assert.ok(pending() > 0, 'opening the campus did not wake the loop')
    // Past the longest threshold here, the manager's 70,080 ms, and well inside the 150,000 ms
    // `ambient` spends as idle time rather than discarding as a gap.
    rig.advance(80_000)
    assert.deepEqual(
      staff.map((who) => rig.view.reasonFor(who).text),
      before,
      'the break the office armed sent somebody on a break while the campus was up',
    )

    // The control: back in the office, the breaks come again.
    rig.view.setView('office')
    rig.park()
    let waited = 0
    while (pending() === 0 && waited < 900_000) {
      rig.advance(40_000)
      waited += 40_000
    }
    assert.ok(pending() > 0, 'the office never took a break after the campus closed')
  } finally {
    rig.view.stop()
    rig.restore()
    mock.timers.reset()
  }
})
