/**
 * Clicking somebody on the floor, which is how you open a person at all.
 *
 * The floor is the app's front door: *"the way in is clicking somebody on the floor, which is
 * where you are already looking at them."* The switcher says that about its own people list, and
 * it is only true if this works. A character nobody can hit is a character with no card.
 *
 * ## Why the hit test is not "which tile did you click"
 *
 *     Tested against each character's projected box rather than by inverting the click to a
 *     tile: a character is taller than a tile is deep and stands *in front of* the tile its feet
 *     are on, so the tile under the pointer is frequently not the tile of the person being
 *     pointed at.
 *
 * and, on the transform:
 *
 *     Into the same space the canvas draws in: undo the scale, then the offset `fit` baked into
 *     the transform. Miss the offset and every click lands half a floor away.
 *
 * Both are off-by-a-transform faults, and both are silent: the office looks exactly right and
 * clicking people either opens the wrong one or opens nobody.
 *
 * ## How this is asked without re-deriving the layout
 *
 * By sweeping the canvas and recording who each point picks. Computing where somebody *should*
 * be would mean re-implementing `planFloor`, `assignSeats` and the projection in the test — and
 * a test that recomputes the thing under test agrees with it however wrong both are. The sweep
 * asks the only question that matters to somebody using the app: can this person be clicked on?
 */

import { test } from 'node:test'
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

const STAFF = [person('manager', true), person('builder'), person('reviewer'), person('tester')]

interface Rig {
  readonly view: FloorView
  /** Every call the draw loop made to the canvas — the painting side of the transform. */
  readonly calls: () => { method: string; args: unknown[] }[]
  readonly paintAFrame: () => void
  readonly picked: string[]
  readonly music: number[]
  readonly click: (x: number, y: number) => void
  readonly size: { width: number; height: number }
}

async function floor(options: { onPickMusic?: boolean } = {}): Promise<Rig> {
  const canvas = document.createElement('canvas')
  const stage = document.createElement('div') as unknown as El
  // The premise, stated here rather than invented by the shim: this floor has a stage of this
  // size. Without one, `chooseScale` divides by an absent `clientWidth`, the scale is `NaN` and
  // the canvas has no pixels for anybody to click.
  stage.clientWidth = 800
  stage.clientHeight = 600
  const picked: string[] = []
  const music: number[] = []

  const callbacks: FloorCallbacks = {
    onPick: (who) => picked.push(who),
    onUnstaged: () => {},
    onDetails: () => {},
    onArtFailed: () => {},
    onStale: () => {},
    onPickProject: () => {},
    ...(options.onPickMusic ? { onPickMusic: () => music.push(1) } : {}),
  }

  const view = new FloorView(canvas as never, stage as never, callbacks)
  await view.setCast(STAFF, async () => SHEET, 'a-theme')

  const el = canvas as unknown as {
    width: number
    height: number
    dispatchEvent: (e: unknown) => void
    getContext: (k: string) => { calls: { method: string; args: unknown[] }[] }
  }
  const runFrame = (globalThis as unknown as Record<string, (n?: number) => number>)['__runFrame']!
  const pending = (globalThis as unknown as Record<string, () => number>)['__pendingFrames']!
  return {
    view,
    picked,
    music,
    calls: () => el.getContext('2d').calls,
    paintAFrame: () => {
      view.start()
      let ran = 0
      while (pending() > 0 && ran < 50) {
        runFrame(ran * 16)
        ran += 1
      }
      view.stop()
    },
    size: { width: el.width, height: el.height },
    click: (x, y) => el.dispatchEvent({ type: 'click', bubbles: true, clientX: x, clientY: y }),
  }
}

/** Every distinct person a click anywhere on the canvas can reach, on a grid of `step` pixels. */
function sweep(rig: Rig, step = 4): Map<string, { x: number; y: number }> {
  const found = new Map<string, { x: number; y: number }>()
  for (let y = 0; y <= rig.size.height; y += step) {
    for (let x = 0; x <= rig.size.width; x += step) {
      const before = rig.picked.length
      rig.click(x, y)
      const who = rig.picked[before]
      if (who !== undefined && !found.has(who)) found.set(who, { x, y })
    }
  }
  return found
}

test('everybody drawn on the floor can be clicked on', async () => {
  // The property, stated the way somebody using the app would: a person you cannot click is a
  // person whose card you cannot open, and the floor gives no sign of it.
  const rig = await floor()

  // The control: there has to be a canvas with area, or the sweep below examines nothing.
  assert.ok(rig.size.width > 0 && rig.size.height > 0, `the canvas is ${rig.size.width}x${rig.size.height}`)

  const reachable = sweep(rig)
  const missing = STAFF.map((s) => s.id).filter((id) => !reachable.has(id))

  assert.deepEqual(
    missing,
    [],
    `these people are drawn on the floor and no click anywhere on it reaches them: ` +
      `${missing.join(', ')}. Reachable: ${[...reachable.keys()].join(', ') || 'nobody'}. ` +
      `Getting the transform wrong lands every click half a floor away and looks like nothing ` +
      `at all is wired up.`,
  )
})

test('a click picks one person, not several', async () => {
  // "Nearest hit wins, front to back, so an overlapping pair picks the one in front." Desks are
  // close enough that sprite boxes overlap; a hit test returning every match would open a stack
  // of cards from one click.
  const rig = await floor()
  const reachable = sweep(rig)
  const spot = [...reachable.values()][0]
  assert.ok(spot, 'nobody was reachable, so this proves nothing')

  rig.picked.length = 0
  rig.click(spot.x, spot.y)
  assert.equal(rig.picked.length, 1, `one click opened ${rig.picked.length} people: ${rig.picked.join(', ')}`)
})

test('clicking the empty floor takes a bubble down rather than opening somebody', async () => {
  // "A bubble nobody dismissed sits there claiming to be current until the situation changes,
  // which may be a while on a quiet office." Clicking the floor is how you stop asking.
  const rig = await floor()
  const reachable = sweep(rig)

  // A point that reaches nobody. Found by sweeping rather than assumed, because "empty floor"
  // is a fact about this layout and not about the corner of the canvas.
  let empty: { x: number; y: number } | null = null
  for (let y = 0; y <= rig.size.height && !empty; y += 4) {
    for (let x = 0; x <= rig.size.width; x += 4) {
      const before = rig.picked.length
      rig.click(x, y)
      if (rig.picked.length === before) {
        empty = { x, y }
        break
      }
    }
  }
  assert.ok(empty, 'every point on the canvas opens somebody, so there is no floor left to click')
  assert.ok(reachable.size > 0, 'nobody is reachable at all')

  const about = rig.view.askOver('builder')
  rig.picked.length = 0
  rig.click(empty.x, empty.y)

  assert.deepEqual(rig.picked, [], 'a click on empty floor opened a card')
  assert.equal(
    rig.view.settle('builder', about, 'an answer', false),
    false,
    'the bubble survived a click on the floor, so it goes on claiming to be current with no way ' +
      'to put it away',
  )
})

test('the floor is not clickable into somebody from outside the canvas', async () => {
  const rig = await floor()
  rig.picked.length = 0
  rig.click(-50, -50)
  rig.click(rig.size.width + 200, rig.size.height + 200)
  assert.deepEqual(rig.picked, [], 'a click outside the canvas opened somebody')
})

test('the point where somebody is painted is the point that opens them', () => {
  // The sweep above asks whether each person is reachable *somewhere*, and a transform that is
  // uniformly wrong still satisfies that — everybody stays clickable, just not where they are
  // drawn. Dropping `bounds.offset` from the hit test does exactly that, and the sweep passed
  // on it.
  //
  // The property that actually matters is that the two sides agree: the click arithmetic and
  // the paint arithmetic are written separately, and "miss the offset and every click lands
  // half a floor away" is what happens when they drift. So this reads the transform the module
  // handed the canvas — the painting side — works out where each sprite landed, and clicks
  // there.
  return (async () => {
    const rig = await floor()
    rig.paintAFrame()

    const calls = rig.calls()
    const transform = [...calls].reverse().find((c) => c.method === 'setTransform')
    const translate = calls[calls.indexOf(transform!) + 1]
    assert.ok(transform, 'the floor never set a transform, so it never drew')
    assert.equal(translate?.method, 'translate', 'the transform was not followed by the offset translate')

    const a = transform.args[0] as number
    const [tx, ty] = translate.args as [number, number]
    const dpr = (globalThis as unknown as { window: { devicePixelRatio: number } }).window.devicePixelRatio || 1

    // Characters are drawn as `drawImage(bitmap, x, y)` in floor space. The mirrored path draws
    // at 0,0 under its own translate, so those are skipped rather than mis-read.
    const sprites = calls.filter(
      (c) => c.method === 'drawImage' && c.args.length === 3 && !(c.args[1] === 0 && c.args[2] === 0),
    )
    assert.ok(sprites.length > 0, `no character sprites were painted: ${calls.filter((c) => c.method === 'drawImage').length} drawImage calls in total`)

    const missed: string[] = []
    for (const sprite of sprites) {
      const [, x, y] = sprite.args as [unknown, number, number]
      // The middle of the painted sprite, in the same client pixels a mouse reports.
      const clientX = ((x + FRAME_W / 2) + tx) * a / dpr
      const clientY = ((y + FRAME_H / 2) + ty) * a / dpr

      const before = rig.picked.length
      rig.click(clientX, clientY)
      if (rig.picked.length === before) missed.push(`(${Math.round(clientX)},${Math.round(clientY)})`)
    }

    assert.deepEqual(
      missed,
      [],
      `a character was painted at these points and clicking them opened nobody: ${missed.join(' ')}. ` +
        `The hit test and the paint are using different transforms, so every click lands away ` +
        `from the person it looks like it is on.`,
    )
  })()
})
