/**
 * Does any floor hug its own bounding box?
 *
 * The stage clips what the floor overflows by, and two comments defend that trade with the same
 * sentence: what is lost is *"the outermost ring of boundary wall, the least informative thing
 * on the floor"*. `projection.ts` says it of `OVERFLOW`, `styles.css` says it of `.stage`.
 *
 * That is a claim about **every plan the app can draw**, made by code that draws one plan at a
 * time. It holds only if nothing is ever placed against the edge of its own bounding box, and a
 * plan that broke it would break it alone — one plan out of however many, which is exactly the
 * kind of thing that ships. So the plans are enumerated and measured rather than reasoned about.
 *
 * The answer is split, and the split is the point: **sideways the claim is true, and upwards it
 * is not.** See the second test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { planFloor } from '../src/shared/floor/floorplan.js'
import { OVERFLOW, TILE_D, TILE_RISE, viewBounds } from '../src/shared/floor/projection.js'
import { drawNoticeBoard, drawPictureFrame, drawWhiteboard, type Surface } from '../src/renderer/props.js'

const staff = (n: number) => Array.from({ length: n }, (_, i) => `agent-${i}`)

/**
 * Rosters that produce a different floor.
 *
 * The plan grows by bench, not by head, so the sizes that matter are the ones either side of a
 * block boundary. Zero is in because an office with no staff is a real first run.
 */
const ROSTERS = [0, 1, 3, 6, 7, 9, 12, 18] as const

/**
 * `floor-view.ts` owns this and does not export it, so it is read rather than copied — a second
 * copy of a number is how `choreography.test.ts` came to re-implement `chooseScale` and agree
 * with itself while disagreeing with the renderer.
 */
function wallHeight(): number {
  const source = readFileSync(new URL('../src/renderer/floor-view.ts', import.meta.url), 'utf8')
  const found = source.match(/const WALL_HEIGHT = (\d+(?:\.\d+)?)/)
  assert.ok(found, 'WALL_HEIGHT has moved — this test can no longer know the headroom it checks')
  return Number(found[1])
}

/** Every tile any part of a plan names, found by walking it rather than by keeping a list. */
function placedTiles(node: unknown, out: { x: number; y: number; from: string }[] = [], path = ''): typeof out {
  if (node === null || typeof node !== 'object') return out
  const o = node as Record<string, unknown>
  if (typeof o['x'] === 'number' && typeof o['y'] === 'number') {
    out.push({ x: o['x'], y: o['y'], from: path || '(root)' })
  }
  if (typeof o['x0'] === 'number' && typeof o['y0'] === 'number') {
    for (let x = o['x0']; x <= (o['x1'] as number); x++) {
      for (let y = o['y0'] as number; y <= (o['y1'] as number); y++) out.push({ x, y, from: path })
    }
  }
  for (const [key, value] of Object.entries(o)) {
    // The grid is a `Uint8Array` behind a class and holds no coordinates of its own; walking it
    // would add every tile on the floor and drown the answer.
    if (key === 'grid') continue
    if (Array.isArray(value)) value.forEach((item, i) => placedTiles(item, out, `${path}.${key}[${i}]`))
    else placedTiles(value, out, `${path}.${key}`)
  }
  return out
}

/** The worst trim `chooseScale` can leave, per side, in floor pixels. */
function worstTrim(extent: number): number {
  return (extent * (1 - 1 / OVERFLOW)) / 2
}

test('no plan places anything in the columns the side trim eats', () => {
  // The horizontal half of the claim, and it holds. Nothing — no desk, no prop, no walkable
  // tile — is ever in the first or last column, so the up-to-16.6 floor pixels the side trim can
  // take really is boundary wall, on every roster size.
  for (const n of ROSTERS) {
    const plan = planFloor('manager', staff(n))

    // The instrument first. A walk that found nothing would pass this test loudly.
    const tiles = placedTiles(plan)
    assert.ok(tiles.length > 20, `only ${tiles.length} tiles found in a ${n}-person plan — the walk moved`)

    const edge = tiles.filter((t) => t.x === 0 || t.x === plan.width - 1)
    assert.deepEqual(edge, [], `a ${n}-person plan puts something in its outermost column`)

    const standing = plan.grid.walkableTiles().filter((t) => t.x === 0 || t.x === plan.width - 1)
    assert.deepEqual(standing, [], `a ${n}-person plan lets somebody stand in its outermost column`)
  }
})

test('the top edge is never the edge that gets trimmed', () => {
  // This test used to record a defect: the back wall has 7 floor pixels of headroom and the top
  // trim reaches 12.44, so what the clip took up there was the top of `pictureFrames[2]` rather
  // than boundary wall. It is fixed — by `place-items: start center`, which sends the vertical
  // overflow to the bottom, where the last tile row is empty.
  //
  // The numbers that made it necessary have **not** changed, and that is why this is still a
  // test rather than a deleted one: `worstTrim(bounds.height)` still exceeds the headroom. The
  // fix is about *where* the trim lands, not how big it is. So what is asserted now is the
  // placement, beside the measurements that make the placement load-bearing.
  const plan = planFloor('manager', staff(3))
  const bounds = viewBounds(plan.width, plan.height, wallHeight())

  class Recorder implements Surface {
    fillStyle = '#000000'
    readonly rects: { y: number }[] = []
    fillRect(_x: number, y: number): void {
      this.rects.push({ y })
    }
  }

  // Measured by drawing, not written down. A table would have gone stale silently when the fix
  // landed; instead this is what says the answer changed.
  const rise = (draw: (c: Surface) => void): number => {
    const ctx = new Recorder()
    draw(ctx)
    assert.ok(ctx.rects.length > 0, 'a wall prop drew nothing — this measurement went blind')
    return -Math.min(...ctx.rects.map((r) => r.y))
  }

  const tallest = Math.max(
    rise((c) => drawPictureFrame(c, { x: 12, y: 0 }, 'south')),
    rise((c) => drawWhiteboard(c, { x: 6, y: 0 }, 'south')),
    rise((c) => drawNoticeBoard(c, { x: 8, y: 0 }, 'south')),
  )
  const headroom = wallHeight() * TILE_RISE - tallest

  assert.equal(tallest, 21, 'the tallest wall prop has changed height — re-measure the headroom')
  assert.equal(headroom, 7, 'the headroom above the back wall has changed')
  assert.ok(
    worstTrim(bounds.height) > headroom,
    'the top trim now fits in the headroom — centring vertically would be safe again, and this test should say so',
  )

  // Which is why the stage must not centre vertically. `place-items` is `<align> <justify>`:
  // block axis first. Anything but `start` there puts trim back on the top edge.
  const css = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8')
  const stage = css.slice(css.indexOf('.stage {'), css.indexOf('}', css.indexOf('.stage {')))
  assert.ok(stage.includes('place-items'), 'the stage no longer sets place-items — this test went blind')
  // Anchored to the start of a line, because the block also *discusses* `place-items: center` in
  // a comment explaining why it was wrong — and matching that would have read the prose as the
  // rule. It did, on the first run of this test.
  const align = stage.match(/\n\s*place-items:\s*([a-z]+)/)?.[1]
  assert.equal(align, 'start', 'the stage centres vertically again, and the back wall cannot afford it')
})

test('the row the trim now lands on is empty, on every roster', () => {
  // What licenses sending all the vertical overflow downwards. The last tile row holds nothing
  // and nobody can stand in it, so the first 22 floor pixels of bottom trim are free.
  //
  // This is the half a CSS test cannot see: it would catch a *plan* that put a desk in its last
  // row, which is the change that would make `start` unsafe without touching the stylesheet.
  for (const n of ROSTERS) {
    const plan = planFloor('manager', staff(n))
    const last = plan.height - 1

    const tiles = placedTiles(plan)
    assert.ok(tiles.length > 20, `only ${tiles.length} tiles found in a ${n}-person plan — the walk moved`)

    assert.deepEqual(
      tiles.filter((t) => t.y === last),
      [],
      `a ${n}-person plan puts something in the last row, which is where the trim now goes`,
    )
    assert.deepEqual(
      plan.grid.walkableTiles().filter((t) => t.y === last),
      [],
      `a ${n}-person plan lets somebody stand in the last row`,
    )
  }
})

test('the bottom trim can still reach past the empty row, and by more on a bigger roster', () => {
  // Recorded, not fixed, and the second half is the part that was not measured when the fix
  // landed. The empty row is 22 floor pixels; the worst overflow the step-up permits is a
  // fraction of `bounds.height`, so it **grows with the roster** while the row does not.
  //
  //     14 x 14 floor    24.9 worst overflow    2.9 past the empty row
  //     14 x 18 floor    31.4                   9.4
  //
  // Below roughly stage 640 this takes a few pixels off the row above, which is what the app did
  // everywhere before the fix. Distributing the trim in proportion to each edge's real margin
  // would close it, at the cost of the renderer having to know how tall the wall props are —
  // the coupling this file avoids by measuring them. Not worth buying for six pixels; worth
  // knowing before somebody adds a deeper floor.
  for (const [n, expected] of [[3, 2.9], [18, 9.4]] as const) {
    const plan = planFloor('manager', staff(n))
    const bounds = viewBounds(plan.width, plan.height, wallHeight())
    const past = bounds.height * (1 - 1 / OVERFLOW) - TILE_D
    assert.ok(past > 0, `a ${n}-person floor no longer overflows its empty row — re-check this note`)
    assert.equal(Number(past.toFixed(1)), expected, `a ${n}-person floor's overshoot has moved`)
  }
})
