/**
 * The floor's loop: when it stops asking for frames, and what starts it again.
 *
 * `floor-view.ts` was the last renderer module parked in the census — *"loads fine; the largest
 * single surface nothing aims at"* — and the thing standing between it and this harness turned
 * out to be two methods. It constructs and then calls `getContext('2d')`, and it observes its
 * stage. A recording context and an inert `ResizeObserver` are all it wanted.
 *
 * ## The transition the codebase says cannot be tested
 *
 * `frame-gate.ts` states it plainly:
 *
 *     The dangerous half of parking a loop is **failing to restart it** — a floor frozen on a
 *     stale picture is a worse failure than the waste it replaced, and it is invisible until
 *     somebody notices the office has stopped reacting. That transition has to be tested, and it
 *     cannot be: the root `tsconfig` excludes `src/renderer`, and the preview harness cannot help
 *     either, because a hidden page throttles `requestAnimationFrame` to nothing — an attempt to
 *     measure this through the browser reported a perfect result while actually measuring the
 *     throttle.
 *
 * Both reasons are true and neither applies here. Frames only happen when this file asks for
 * one, so *"is anything still asking for a frame"* has an exact answer, and that is the whole of
 * parking and waking. The gate's own unit tests cover the state machine; what was missing is
 * whether the renderer **obeys** it — `raf = 0` on a park, and a mutator that reaches
 * `invalidate` on a wake.
 *
 * The failure this guards is silent by construction. A floor that stops reacting looks exactly
 * like a floor with nothing to react to, which is what an idle office looks like anyway.
 *
 * ## What this does not do
 *
 * It asserts nothing about pixels, and it should not. The context here records calls and draws
 * nothing, so any claim about what the office *looks* like would be a claim about the fake. The
 * question a canvas module can be asked in a harness is when it decides to paint, not what it
 * paints.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom } from './dom.js'
import { FloorView } from '../src/renderer/floor-view.js'

installDom()

const runFrame = (now = 0): number => (globalThis as unknown as Record<string, (n?: number) => number>)['__runFrame']!(now)
const pending = (): number => (globalThis as unknown as Record<string, () => number>)['__pendingFrames']!()

function floor(): FloorView {
  const canvas = document.createElement('canvas')
  const stage = document.createElement('div')
  return new FloorView(canvas as never, stage as never, {} as never)
}

/**
 * Run frames until nothing asks for another, or give up.
 *
 * Returns how many ran. The cap is a failure rather than a result: a loop that never parks is
 * the waste the gate exists to prevent, and reporting "it ran 200 frames" as success would be
 * this test agreeing with a bug.
 */
function settle(cap = 200): number {
  let ran = 0
  while (pending() > 0 && ran < cap) {
    runFrame(ran * 16)
    ran += 1
  }
  assert.ok(ran < cap, `the loop was still asking for frames after ${cap} of them — an idle office must park`)
  return ran
}

test('an idle floor stops asking for frames', () => {
  const view = floor()
  view.start()
  assert.ok(pending() > 0, 'start() asked for no frame at all, so nothing will ever be drawn')

  const ran = settle()
  assert.ok(ran > 0, 'the loop parked without running a single frame')
  assert.equal(pending(), 0, 'the floor is still asking for frames with nothing happening — this is the waste the gate exists to prevent')
  view.stop()
})

test('a change wakes the parked loop — the half that cannot be tested', () => {
  const view = floor()
  view.start()
  settle()
  assert.equal(pending(), 0, 'precondition: the loop must be parked before waking it means anything')

  view.invalidate()
  assert.ok(
    pending() > 0,
    'the floor was parked and a change did not restart it. This is the failure frame-gate.ts ' +
      'names: a floor frozen on a stale picture, invisible until somebody notices the office has ' +
      'stopped reacting — and an office that has stopped reacting looks exactly like an idle one.',
  )

  // And it settles again rather than spinning from then on.
  settle()
  assert.equal(pending(), 0)
  view.stop()
})

test('every mutator wakes it, not just the one named invalidate', () => {
  // The gate's own comment: "**Every mutator calls this.** One that does not is a change nobody
  // draws." A mutator that forgets is a change that lands in the model and never reaches a
  // frame — and nothing about it throws.
  const mutators: { name: string; run: (v: FloorView) => void }[] = [
    { name: 'setSkills', run: (v) => v.setSkills(5) },
    { name: 'setProject', run: (v) => v.setProject('a-project') },
    { name: 'setMusicPlaying', run: (v) => v.setMusicPlaying(true) },
    { name: 'setOutcomes', run: (v) => v.setOutcomes(new Map()) },
    { name: 'setView', run: (v) => v.setView('campus') },
    { name: 'repaint', run: (v) => v.repaint() },
  ]

  const asleep: string[] = []
  for (const { name, run } of mutators) {
    const view = floor()
    view.start()
    settle()
    assert.equal(pending(), 0, `precondition for ${name}: the loop must be parked first`)

    run(view)
    if (pending() === 0) asleep.push(name)

    settle()
    view.stop()
  }

  assert.deepEqual(
    asleep,
    [],
    `these changed the floor and did not ask for a frame, so the change is in the model and not ` +
      `on the screen: ${asleep.join(', ')}`,
  )
})

test('stopping means stopped — a stopped floor is not woken by a change', () => {
  // `stop()` is teardown rather than rest: "A stopped gate is not woken by `invalidate`."
  // Getting this wrong leaks a loop that runs after the view is gone.
  const view = floor()
  view.start()
  settle()
  view.stop()

  view.invalidate()
  assert.equal(
    pending(),
    0,
    'a stopped floor asked for a frame. A view that has been torn down and still animates is a ' +
      'loop nothing owns and nothing will stop.',
  )
})

test('starting twice does not run two loops', () => {
  const view = floor()
  view.start()
  const first = pending()
  view.start()
  assert.equal(
    pending(),
    first,
    'a second start() queued a second frame, so every frame from now on is drawn twice and the ' +
      'office animates at double speed',
  )
  settle()
  view.stop()
})
