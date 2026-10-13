/**
 * The camera.
 *
 * Worth testing hard because every failure here looks like an art problem rather than an
 * arithmetic one. A wrong inverse means clicking a character selects their neighbour and the
 * bug gets filed as "clicks are unreliable". A wrong depth key means a person is painted behind
 * the desk they are sitting at, and the desk gets blamed. A wrong bounds means the back wall is
 * drawn above the canvas, which is indistinguishable from not drawing it at all.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ellipsise, labelWidthFor, LABEL_MARKS } from '../src/shared/floor/labels.js'

import { MAX_SCALE, MIN_SCALE, TILE_D, TILE_RISE, TILE_W, chooseScale, corners, depthAt, depthOf, occludes, toScreen, toScreenAt, toTile, viewBounds } from '../src/shared/floor/projection.js'

test('half tiles land on whole pixels', () => {
  // Both dimensions get halved to find a tile's centre. An odd one puts every centre on a half
  // pixel, and a pixel-art floor drawn on half pixels shimmers.
  assert.equal(TILE_W % 2, 0)
  assert.equal(TILE_D % 2, 0)
})

test('the camera is tilted from above and nowhere else', () => {
  // The whole point of this projection over the isometric one it replaces. Depth foreshortens;
  // width does not. Anything else is a rotation, and a rotation is what was removed.
  assert.ok(TILE_D < TILE_W, 'depth must foreshorten, or the camera is directly overhead')
  assert.ok(TILE_D > 0, 'a zero-depth camera is looking along the floor, not at it')
})

test('x moves straight across and y moves straight down', () => {
  const origin = toScreen({ x: 0, y: 0 })
  const alongX = toScreen({ x: 1, y: 0 })
  const alongY = toScreen({ x: 0, y: 1 })

  // No horizontal tilt: a step in x changes only the screen x, and a step in y only the y.
  assert.equal(alongX.y, origin.y, 'moving along x must not move the drawing up or down')
  assert.equal(alongY.x, origin.x, 'moving along y must not move the drawing left or right')
  assert.equal(alongX.x - origin.x, TILE_W)
  assert.equal(alongY.y - origin.y, TILE_D)
})

test('height lifts on screen without moving on the floor', () => {
  const ground = toScreen({ x: 3, y: 2 }, 0)
  const raised = toScreen({ x: 3, y: 2 }, 1)

  assert.equal(raised.x, ground.x, 'height must not move a thing sideways')
  assert.equal(ground.y - raised.y, TILE_RISE)
})

test('toTile is the inverse of toScreen across a whole floor', () => {
  for (let x = 0; x < 14; x++) {
    for (let y = 0; y < 18; y++) {
      assert.deepEqual(toTile(toScreen({ x, y })), { x, y }, `round trip failed at ${x},${y}`)
    }
  }
})

test('a point anywhere inside a tile resolves to that tile', () => {
  // The centre round-tripping is not enough: the plan-view projection this ultimately descends
  // from mapped tiles to their top-left corner, and an inverse written for that convention
  // passes the centre test and then picks the neighbour for every off-centre click.
  const tile = { x: 5, y: 7 }
  const c = toScreen(tile)

  for (const [dx, dy] of [
    [0, 0],
    [TILE_W / 2 - 1, 0],
    [-TILE_W / 2, 0],
    [0, TILE_D / 2 - 1],
    [0, -TILE_D / 2],
  ] as const) {
    assert.deepEqual(toTile({ x: c.x + dx, y: c.y + dy }), tile, `failed at offset ${dx},${dy}`)
  }
})

test('depth is distance into the room and nothing else', () => {
  // Isometric needed x + y. Removing the rotation removes x from the question entirely, which
  // is the readability win turning up in the arithmetic.
  assert.equal(depthOf({ x: 0, y: 4 }), depthOf({ x: 12, y: 4 }))
  assert.ok(depthOf({ x: 0, y: 5 }) > depthOf({ x: 11, y: 4 }))
})

test('height breaks ties within a row but never reorders two rows', () => {
  const desk = depthOf({ x: 5, y: 5 }, 0)
  assert.ok(depthOf({ x: 5, y: 5 }, 0.5) > desk, 'a thing on a desk paints after the desk')

  // The failure this guards: a tall lamp at the back of the room painting over the person in
  // front of it. No height, however large, may leapfrog a whole row.
  assert.ok(depthOf({ x: 5, y: 5 }, 99) < depthOf({ x: 5, y: 6 }, 0))
})

test('depthAt agrees with depthOf for whole rows', () => {
  assert.equal(depthAt(4), depthOf({ x: 9, y: 4 }))
  assert.equal(depthAt(4, 0.5), depthOf({ x: 2, y: 4 }, 0.5))
})

test('a tile is a rectangle with its corners in the right places', () => {
  // Destructured without a guard, which is the point of the tuple return: under
  // `noUncheckedIndexedAccess` an array would make every named corner `Pixel | undefined`.
  const [backLeft, backRight, frontRight, frontLeft] = corners({ x: 2, y: 3 })

  assert.equal(backLeft.y, backRight.y, 'the back edge must be level')
  assert.equal(frontLeft.y, frontRight.y, 'the front edge must be level')
  assert.equal(backLeft.x, frontLeft.x, 'the left edge must be vertical')
  assert.equal(backRight.x, frontRight.x, 'the right edge must be vertical')
  assert.equal(backRight.x - backLeft.x, TILE_W)
  assert.equal(frontLeft.y - backLeft.y, TILE_D)
})

test('bounds contain every tile of the floor they describe', () => {
  const w = 13
  const h = 16
  const b = viewBounds(w, h, 1)

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const p = toScreen({ x, y })
      const sx = p.x + b.offsetX
      const sy = p.y + b.offsetY
      assert.ok(sx >= 0 && sx <= b.width, `tile ${x},${y} escapes horizontally at ${sx}`)
      assert.ok(sy >= 0 && sy <= b.height, `tile ${x},${y} escapes vertically at ${sy}`)
    }
  }
})

test('depth costs nothing horizontally — the reason this camera replaced the last one', () => {
  // Under isometric, projected width was (w + h) * halfTile, so making the office deeper made
  // it wider on screen and eventually cost a whole integer scale step. This is the property
  // that regression would break, so it is asserted rather than assumed.
  const shallow = viewBounds(13, 4)
  const deep = viewBounds(13, 40)
  assert.equal(shallow.width, deep.width)
  assert.equal(shallow.width, 13 * TILE_W)
})

test('bounds leave headroom for walls when asked', () => {
  const flat = viewBounds(10, 10, 0)
  const walled = viewBounds(10, 10, 2)

  assert.equal(walled.height - flat.height, 2 * TILE_RISE)
  // A wall two units tall at the very back must land on the canvas rather than above it.
  assert.ok(toScreen({ x: 0, y: 0 }, 2).y + walled.offsetY >= 0)
})

test('the continuous projection agrees with the tile one, and is linear between tiles', () => {
  assert.deepEqual(toScreenAt(7, 3), toScreen({ x: 7, y: 3 }))
  assert.deepEqual(toScreenAt(7, 3, 1.5), toScreen({ x: 7, y: 3 }, 1.5))

  // What a walker mid-step relies on.
  const a = toScreenAt(4, 4)
  const b = toScreenAt(5, 4)
  const half = toScreenAt(4.5, 4)
  assert.equal(half.x, (a.x + b.x) / 2)
  assert.equal(half.y, (a.y + b.y) / 2)
})

test('nothing occludes anything at zero height', () => {
  assert.equal(occludes({ x: 6, y: 6 }, { x: 6, y: 5 }, 0), false)
})

test('occlusion only looks forward', () => {
  assert.equal(occludes({ x: 6, y: 4 }, { x: 6, y: 6 }, 3), false)
  assert.equal(occludes({ x: 6, y: 6 }, { x: 6, y: 5 }, 3), true)
})

test('a tall thing reaches further back than a short one', () => {
  const behind = { x: 4, y: 2 }
  const front = { x: 4, y: 7 }
  assert.equal(occludes(front, behind, 0.5), false)
  assert.equal(occludes(front, behind, 5), true)
})

test('occlusion respects the column, and a wide thing covers more of them', () => {
  // Directly behind is hidden; two columns over is not — unless the thing in front is wide.
  assert.equal(occludes({ x: 4, y: 6 }, { x: 4, y: 5 }, 2), true)
  assert.equal(occludes({ x: 8, y: 6 }, { x: 4, y: 5 }, 2), false)
  assert.equal(occludes({ x: 6, y: 6 }, { x: 4, y: 5 }, 2, 5), true)
})

test('a click on a drawn character resolves back to that character', () => {
  // Not a substitute for clicking the real app, but stronger than one click: it covers every
  // tile rather than the one somebody happened to try, and it pins the step that is actually
  // easy to get wrong — the canvas transform bakes in the bounds offset, so a hit test that
  // forgets to undo it misses vertically while still looking plausible on the front row.
  const bounds = viewBounds(13, 16, 1)
  const scale = 2
  const SPRITE_W = 18
  const SPRITE_H = 32

  for (const tile of [
    { x: 0, y: 0 },
    { x: 12, y: 15 },
    { x: 3, y: 9 },
  ]) {
    const foot = toScreen(tile)
    const canvasPx = (foot.x + bounds.offsetX) * scale
    const canvasPy = (foot.y - SPRITE_H / 2 + bounds.offsetY) * scale

    const world = { x: canvasPx / scale - bounds.offsetX, y: canvasPy / scale - bounds.offsetY }
    assert.ok(
      Math.abs(world.x - foot.x) <= SPRITE_W / 2 && world.y <= foot.y && world.y >= foot.y - SPRITE_H,
      `click over ${tile.x},${tile.y} missed the character drawn there`,
    )
  }
})

// ──────────────────────────────────────────────────────────── choosing a scale ──

test('an integer scale, never a fractional one', () => {
  // Pixel art at 1.7× has pixels of two different sizes. This is the rule the whole camera
  // decision rests on, and until now it had no test at all — only a copy of itself in
  // choreography.test.ts, which could agree with itself while disagreeing with the renderer.
  for (const h of [400, 500, 600, 700, 800, 900]) {
    const s = chooseScale({ width: 1000, height: h }, { width: 416, height: 348 })
    assert.equal(s, Math.round(s), `${h}px high gave a fractional ${s}`)
  }
})

test('THE CLIFF: a floor a few pixels too big steps up and is clipped, not halved', () => {
  const bounds = { width: 416, height: 348 }
  // Exactly 2× plus the pad is comfortable.
  assert.equal(chooseScale({ width: 840, height: 704 }, bounds), 2)
  // Twelve pixels short of it must NOT collapse to 1× — that is the isometric bug, where a
  // 432px floor against a 420px budget halved the entire office.
  assert.equal(chooseScale({ width: 828, height: 692 }, bounds), 2)
})

test('…but a floor genuinely too big does drop, rather than spilling without limit', () => {
  // Past the tolerance the step up is refused. Clipping the outer wall is a trade; clipping
  // the desks is not.
  assert.equal(chooseScale({ width: 600, height: 500 }, { width: 416, height: 348 }), 1)
})

test('the scale is clamped at both ends', () => {
  assert.equal(chooseScale({ width: 10, height: 10 }, { width: 416, height: 348 }), MIN_SCALE)
  assert.equal(chooseScale({ width: 99999, height: 99999 }, { width: 416, height: 348 }), MAX_SCALE)
})

test('a floor with no area does not produce Infinity', () => {
  // `fit` runs before the first plan is laid out, so this is a real state and not a hypothetical.
  assert.equal(chooseScale({ width: 800, height: 600 }, { width: 0, height: 0 }), MIN_SCALE)
})

test('a stage smaller than the pad does not produce a negative scale', () => {
  assert.equal(chooseScale({ width: 4, height: 4 }, { width: 416, height: 348 }), MIN_SCALE)
})

// ────────────────────────────────────────────────────────── fitting a name in ──

test('a name that fits is left alone', () => {
  assert.equal(ellipsise('Reviewer', 100, (t) => t.length * 3), 'Reviewer')
})

test('THE COLLISION: a name wider than its desk is cut, not spilled', () => {
  // Six desks across the room puts neighbouring names one desk apart. A name wider than that
  // does not overflow into empty space — it lands on the person at the next desk, which is how
  // packing the desk grid tighter turned every long name into two illegible ones.
  const measure = (t: string) => t.length * 3
  const cut = ellipsise('Memory Keeper', 24, measure)
  assert.ok(measure(cut) <= 24, `"${cut}" is still too wide`)
  assert.ok(cut.endsWith('…'), 'a truncated name must say it was truncated')
  assert.ok(cut.startsWith('Memory'), `"${cut}" should keep the front of the name`)
})

test('two adjacent names can never touch', () => {
  // The guarantee the whole helper exists for, asserted as arithmetic rather than by looking:
  // labels are centred on their desks, so the gap between two of them is at least LABEL_MARKS.
  const pitchPx = 64
  const measure = (t: string) => t.length * 3
  const a = ellipsise('Memory Keeper', labelWidthFor(pitchPx), measure)
  const b = ellipsise('Backend Engineer', labelWidthFor(pitchPx), measure)
  const gap = pitchPx - (measure(a) + measure(b)) / 2
  assert.ok(gap >= LABEL_MARKS / 2, `adjacent labels leave only ${gap}px`)
})

test('a name with no room at all is a mark, not nothing', () => {
  // An unlabelled character reads as one the office does not know the name of, which is a
  // different claim and an untrue one.
  assert.equal(ellipsise('Reviewer', 0, (t) => t.length * 3), '…')
})
