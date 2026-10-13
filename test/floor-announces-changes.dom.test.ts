/**
 * Every public mutator wakes the loop — the invariant the whole parked-loop design rests on.
 *
 * `floor-view.dom.test.ts` covers the transition itself: a parked floor, `invalidate()`, a frame.
 * This asks the question that actually ships broken, which is whether the *callers* of that
 * invariant hold it. `start()` states it:
 *
 *     Every public mutator calls that, which is the invariant the whole thing rests on: **a
 *     change nobody announces is a frame nobody draws.** Miss one and the floor freezes holding a
 *     stale picture, which is a worse failure than the waste it replaced — so the mutators are
 *     listed in one place and each one calls it as its first act.
 *
 * "Listed in one place" is a convention, and a convention is what a new method quietly fails to
 * follow. The cost is specific and silent: the office keeps *showing* the last thing that was
 * true. Not a blank screen, not an error — a picture, confidently wrong, of work that has moved
 * on. That is the third standing order failing in the only way it can on a canvas.
 *
 * A parked floor is indistinguishable from an idle one by looking at it, which is why this is
 * checked by enumeration rather than noticed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom } from './dom.js'
import { FloorView, type FloorCallbacks } from '../src/renderer/floor-view.js'
import type { CampusOffice } from '../src/shared/floor/campus.js'
import type { Fact, Unstaged } from '../src/shared/floor/choreography.js'
import type { TaskOutcome } from '../src/shared/tasks.js'

installDom()

const runFrame = (now = 0): number => (globalThis as unknown as Record<string, (n?: number) => number>)['__runFrame']!(now)
const pending = (): number => (globalThis as unknown as Record<string, () => number>)['__pendingFrames']!()

/**
 * Real callbacks, every one of them.
 *
 * `floor-view.dom.test.ts` gets away with `{}` because it never feeds the floor a fact. The
 * moment one arrives for somebody with no desk, `apply` reports it through `onUnstaged` — and a
 * missing callback then throws inside the module, which reads exactly like the module being
 * broken rather than the fixture being short.
 */
function floor(): { view: FloorView; unstaged: Unstaged[] } {
  const canvas = document.createElement('canvas')
  const stage = document.createElement('div')
  const unstaged: Unstaged[] = []
  const callbacks: FloorCallbacks = {
    onPick: () => {},
    onUnstaged: (missing) => unstaged.push(missing),
    onDetails: () => {},
    onArtFailed: () => {},
    onStale: () => {},
    onPickProject: () => {},
  }
  return { view: new FloorView(canvas as never, stage as never, callbacks), unstaged }
}

/** Run the floor to a standstill. A loop that will not park is a failure, not a slow result. */
function park(view: FloorView, cap = 200): void {
  let ran = 0
  while (pending() > 0 && ran < cap) {
    runFrame(ran * 16)
    ran += 1
  }
  assert.ok(ran < cap, `the loop was still asking for frames after ${cap} of them`)
  assert.equal(view.isParked, true, 'the floor did not park, so waking it proves nothing')
}

const OFFICE: CampusOffice = { id: 'other', name: 'Other', staff: 2, busy: true, waiting: 0, focused: false, session: null }
const FACT: Fact = { kind: 'dispatch', toolUseId: 't1', employee: 'builder', brief: 'do the thing' }
const OUTCOMES: ReadonlyMap<string, TaskOutcome> = new Map([['builder', 'failed' as TaskOutcome]])

/**
 * Each entry is a change a person can cause, paired with an argument that genuinely represents
 * one. Passing a no-op — `setMusicPlaying(false)` on a silent floor — would test the guard
 * rather than the announcement, and those guards are correct: no change, no frame.
 */
const MUTATORS: readonly { readonly name: string; readonly change: (v: FloorView) => void }[] = [
  { name: 'setCampus', change: (v) => v.setCampus([OFFICE]) },
  { name: 'setView', change: (v) => v.setView('campus') },
  { name: 'setProject', change: (v) => v.setProject('another-project') },
  { name: 'setSkills', change: (v) => v.setSkills(3) },
  { name: 'apply', change: (v) => v.apply('a-project', [FACT]) },
  { name: 'setOutcomes', change: (v) => v.setOutcomes(OUTCOMES) },
  { name: 'settle', change: (v) => v.settle('builder', 'about', 'an answer', false) },
  { name: 'dismiss', change: (v) => v.dismiss() },
  { name: 'setMusicPlaying', change: (v) => v.setMusicPlaying(true) },
  { name: 'repaint', change: (v) => v.repaint() },
]

test('every public mutator wakes a parked floor', () => {
  const stale: string[] = []

  for (const mutator of MUTATORS) {
    const { view } = floor()
    view.start()
    park(view)

    mutator.change(view)

    if (view.isParked || pending() === 0) stale.push(mutator.name)
    view.stop()
  }

  assert.deepEqual(
    stale,
    [],
    `these change the picture and never ask for a frame, so on an idle office the floor keeps ` +
      `showing what was true before the call:\n  ${stale.join('\n  ')}\n` +
      `It is invisible in use — a frozen floor looks exactly like a floor with nothing happening.`,
  )
})

test('a mutator that changes nothing does not wake the floor', () => {
  // The other half, and the reason the guards exist. "Zero draw calls while nothing changes" is
  // the charter's first budget, and a mutator that woke on every call — including the ones that
  // set a value to what it already was — would spend it without changing a pixel.
  const { view } = floor()
  view.setMusicPlaying(true)
  view.start()
  park(view)

  view.setMusicPlaying(true)
  assert.equal(view.isParked, true, 'setting the music to what it already was repainted the office')

  view.setView('office')
  assert.equal(view.isParked, true, 'switching to the view already showing repainted the office')
  view.stop()
})

test('waking draws a frame and then parks again', () => {
  // A wake that never parks is the runaway the gate exists to stop; a wake that draws nothing is
  // the freeze. Both look fine from outside and they are opposite faults.
  const { view } = floor()
  view.start()
  park(view)
  const before = view.framesDrawn

  view.setSkills(4)
  let ran = 0
  while (pending() > 0 && ran < 200) {
    runFrame(1_000 + ran * 16)
    ran += 1
  }

  assert.ok(view.framesDrawn > before, 'the floor woke and then drew nothing, which leaves the stale picture up')
  assert.equal(view.isParked, true, 'the floor never went back to sleep after one change')
  view.stop()
})
