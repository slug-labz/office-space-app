/**
 * The furniture's arithmetic.
 *
 * Three things are worth pinning here and they are not the same thing.
 *
 * The **corner maths** — where a cuboid's eight corners land once projected — is testable in
 * the ordinary way, and it has to be right or every prop is subtly wrong in the same
 * direction. The contract it is built against lives in `projection.ts`, so the first test
 * asserts against `corners()` rather than against a table of numbers copied out of it.
 *
 * The **rasterisation** is the part that would otherwise only be caught by looking. A prop
 * drawn at a fractional coordinate, or a box whose faces overlap by a pixel, looks like bad
 * art rather than a bad calculation — and the person who notices blames the palette. Since
 * every prop paints through one face filler, a recording surface can check the whole module
 * at once: nothing off the pixel grid, and no pixel painted twice.
 *
 * The **agreement between props** is new, and it is here because its absence shipped. A desk,
 * the chair at it and the monitor on it are handed one facing by the renderer, and every one
 * of the faults reported on the running floor was those three disagreeing about which side of
 * the desk the person was. Those are the tests at the bottom, and they are written in terms of
 * what somebody sitting there would see rather than in terms of the offsets that implement it.
 *
 * `scratch/check-props.mjs` renders the same functions to a PNG for the half of this that
 * genuinely does need eyes on it — including a workstation with a block the size of a
 * character sprite standing in it, which is the only way to see whether the chair is behind
 * the person or on top of them.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DESK_TOP,
  PALETTE,
  SEAT_TOP,
  boxFaces,
  drawBox,
  drawChair,
  drawDesk,
  drawFloorTile,
  drawMonitor,
  drawPictureFrame,
  drawNoticeBoard,
  drawPlant,
  drawRug,
  drawServerRack,
  drawShelfUnit,
  drawSofa,
  drawTable,
  drawWall,
  drawWaterCooler,
  drawWhiteboard,
  foliage,
  footprintOf,
  leafColour,
  mix,
  shadesOf,
  tint,
  type Facing,
  type Surface,
} from '../src/renderer/props.js'
import { TILE_D, TILE_RISE, TILE_W, corners } from '../src/shared/floor/projection.js'

const ORIGIN = { x: 0, y: 0 }
const FACINGS: readonly Facing[] = ['north', 'east', 'south', 'west']

/** A desk's top surface is lit past the shading the rest of the room uses. See props.ts. */
const DESK_LID = tint(PALETTE.desk, 1.45)
const DESK_UNDER = tint(PALETTE.desk, 0.42)

/** How wide a character is. The floor draws them 18×32, and the furniture has to survive that. */
const SPRITE_W = 18

/** Rough brightness, for assertions about which of two colours is the lighter. */
const level = (c: string): number =>
  parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16)

/** A canvas that remembers instead of painting. The whole of what these functions need. */
class Recorder implements Surface {
  fillStyle = '#000000'
  readonly rects: { x: number; y: number; w: number; h: number; colour: string }[] = []

  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h, colour: this.fillStyle })
  }

  /** Every pixel painted, and by how many rectangles. Overlap is a bug, so it is counted. */
  pixels(): Map<string, number> {
    const seen = new Map<string, number>()
    for (const r of this.rects) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const key = `${x},${y}`
          seen.set(key, (seen.get(key) ?? 0) + 1)
        }
      }
    }
    return seen
  }

  colours(): Set<string> {
    return new Set(this.rects.map((r) => r.colour))
  }

  /** The box the prop occupies on screen: left, top, right, bottom. */
  bounds(): { left: number; top: number; right: number; bottom: number } {
    return {
      left: Math.min(...this.rects.map((r) => r.x)),
      top: Math.min(...this.rects.map((r) => r.y)),
      right: Math.max(...this.rects.map((r) => r.x + r.w)),
      bottom: Math.max(...this.rects.map((r) => r.y + r.h)),
    }
  }
}

function record(draw: (ctx: Recorder) => void): Recorder {
  const ctx = new Recorder()
  draw(ctx)
  return ctx
}

/**
 * How much dark understructure a prop shows along the near edge of its tile.
 *
 * The one thing the camera can tell you about what is under a lid, and therefore how a desk
 * with a modesty panel is told from a table without one, or a desk facing the room from one
 * facing away.
 */
function underside(ctx: Recorder): number {
  const floor = record((c) => drawFloorTile(c, ORIGIN)).bounds()
  return ctx.rects
    .filter((r) => r.colour === DESK_UNDER && r.y + r.h > floor.bottom - 5)
    .reduce((total, r) => total + r.w, 0)
}

/** Two colours within `levels` of each other on every channel. */
function near(a: string, b: string, levels: number): boolean {
  for (let i = 1; i < 7; i += 2) {
    if (Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) > levels) return false
  }
  return true
}

// ────────────────────────────────────────────────────────────────── colour ────

test('tint scales every channel and keeps the hue', () => {
  assert.equal(tint('#204080', 0.5), '#102040')
  assert.equal(tint('#102040', 2), '#204080')
})

test('tint clamps rather than wrapping or renormalising', () => {
  // Wrapping would turn an over-bright face black, which reads as a hole in the furniture.
  assert.equal(tint('#f0f0f0', 4), '#ffffff')
  assert.equal(tint('#101010', 0), '#000000')
})

test('the derived shades land on the colours floor-view picked by hand', () => {
  // The whole argument for deriving them. floor-view draws a desk as #3b3348 with a #4a4059
  // lit edge and a #2a2438 shadow; if these factors ever stop reproducing that pair, the drawn
  // room has quietly left the plan-view room's palette.
  const desk = shadesOf(PALETTE.desk)

  assert.equal(desk.front, PALETTE.desk, 'the base colour is the front face, not the top')
  assert.ok(near(desk.top, '#4a4059', 2), `top ${desk.top} is not floor-view's #4a4059`)
  assert.ok(near(desk.side, '#2a2438', 5), `side ${desk.side} is not floor-view's #2a2438`)
})

test('a box is lightest on top and darkest on its shaded edge', () => {
  // Three values is the entire reason the scene reads as solid rather than as a sticker — and
  // under this camera two of them are all the projection gives, so the third has to be added.
  const { top, front, side } = shadesOf(PALETTE.wall)

  assert.ok(level(top) > level(front), 'the lid must be lighter than the front')
  assert.ok(level(front) > level(side), 'the front must be lighter than the shaded edge')
})

test('mix walks from one colour to the other and clamps outside 0..1', () => {
  assert.equal(mix('#000000', '#ffffff', 0), '#000000')
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff')
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080')
  assert.equal(mix('#000000', '#ffffff', -3), '#000000')
  assert.equal(mix('#000000', '#ffffff', 9), '#ffffff')
})

// ──────────────────────────────────────────────────────────────── footprint ────

test('a one-tile part with no offset covers exactly its tile', () => {
  assert.deepEqual(footprintOf({ x: 3, y: 2 }, 'south', { width: 1, depth: 1 }), {
    x0: 2.5,
    y0: 1.5,
    x1: 3.5,
    y1: 2.5,
  })
})

test('turning a part swaps which floor axis carries its width', () => {
  // A desk is wider than it is deep whichever way it is turned, so the extents cannot be
  // assigned to x and y — they follow the facing.
  const facingY = footprintOf(ORIGIN, 'south', { width: 1, depth: 0.5 })
  const facingX = footprintOf(ORIGIN, 'east', { width: 1, depth: 0.5 })

  assert.deepEqual(facingY, { x0: -0.5, y0: -0.25, x1: 0.5, y1: 0.25 })
  assert.deepEqual(facingX, { x0: -0.25, y0: -0.5, x1: 0.25, y1: 0.5 })
})

test('back moves a part away from whatever it faces, for all four facings', () => {
  const centre = (facing: Facing): readonly [number, number] => {
    const f = footprintOf(ORIGIN, facing, { width: 0.5, depth: 0.5, back: 0.25 })
    return [(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2]
  }

  assert.deepEqual(centre('south'), [0, -0.25], 'facing +y, so back is −y')
  assert.deepEqual(centre('north'), [0, 0.25])
  assert.deepEqual(centre('east'), [-0.25, 0], 'facing +x, so back is −x')
  assert.deepEqual(centre('west'), [0.25, 0])
})

test('across runs along the front, and the same sign is the same side under rotation', () => {
  // What lets a desk's two legs be `across: ±0.42` once rather than four times.
  const left = (facing: Facing): readonly [number, number] => {
    const f = footprintOf(ORIGIN, facing, { width: 0.5, depth: 0.5, across: -0.5 })
    return [(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2]
  }

  assert.deepEqual(left('south'), [0.5, 0])
  assert.deepEqual(left('west'), [0, 0.5])
  assert.deepEqual(left('north'), [-0.5, 0])
  assert.deepEqual(left('east'), [0, -0.5])
})

// ───────────────────────────────────────────────────────── the cuboid maths ────

test('a flat box on one tile projects to that tile’s own rectangle', () => {
  // The contract test. `projection.ts` owns the camera; if these two ever disagree, the floor
  // and the furniture standing on it have stopped being drawn by the same one.
  const tile = { x: 4, y: 3 }
  const faces = boxFaces(footprintOf(tile, 'south', { width: 1, depth: 1 }), 0, 0)
  const [backLeft, , frontRight] = corners(tile)

  assert.deepEqual(faces.top, { x0: backLeft.x, y0: backLeft.y, x1: frontRight.x, y1: frontRight.y })
  assert.equal(faces.top.x1 - faces.top.x0, TILE_W, 'a tile is not a tile wide')
  assert.equal(faces.top.y1 - faces.top.y0, TILE_D, 'a tile is not a tile deep')
})

test('a box rises by TILE_RISE per unit of height, and by nothing else', () => {
  const flat = boxFaces(footprintOf(ORIGIN, 'south', { width: 1, depth: 1 }), 0, 0)
  const tall = boxFaces(footprintOf(ORIGIN, 'south', { width: 1, depth: 1 }), 0, 0.5)

  assert.equal(flat.top.y0 - tall.top.y0, 0.5 * TILE_RISE)
  // The lid moves up; the footprint stays exactly where it was on the floor.
  assert.equal(flat.top.x0, tall.top.x0)
  assert.equal(tall.front.y1, flat.front.y1, 'the box still stands on the same tile')
})

test('the two visible faces share their edge rather than merely meeting', () => {
  // Two faces that only nearly touch leave a seam that shimmers when the floor scrolls.
  const faces = boxFaces(footprintOf(ORIGIN, 'south', { width: 0.7, depth: 0.4 }), 0.25, 0.5)

  assert.equal(faces.front.y0, faces.top.y1, 'the front hangs off the lid’s near edge')
  assert.equal(faces.front.x0, faces.top.x0, '…and is the same span of x')
  assert.equal(faces.front.x1, faces.top.x1)
})

test('a box with no height has no front', () => {
  // What a floor tile and every flat inset are: a lid and nothing else.
  const faces = boxFaces(footprintOf(ORIGIN, 'south', { width: 1, depth: 1 }), 0, 0)

  assert.equal(faces.front.y0, faces.front.y1)
})

// ───────────────────────────────────────────────────────────── rasterisation ────

test('every prop paints on the pixel grid and nowhere else', () => {
  // Half-pixel coordinates are how pixel art gets anti-aliased edges no matter what the
  // renderer sets `imageSmoothingEnabled` to.
  const ctx = record((c) => {
    for (const facing of FACINGS) {
      drawFloorTile(c, { x: 1, y: 2 })
      drawBox(c, ORIGIN, { width: 0.33, depth: 0.47, height: 0.61, z: 0.13, facing, colour: PALETTE.desk })
      drawWall(c, ORIGIN, facing)
      drawDesk(c, ORIGIN, facing)
      drawTable(c, ORIGIN, { length: 3, along: facing === 'east' || facing === 'west' ? 'y' : 'x' })
      drawChair(c, ORIGIN, facing, { pushedIn: true })
      drawSofa(c, ORIGIN, facing, { length: 2 })
      drawMonitor(c, ORIGIN, facing, { screen: 'lit' })
      drawWhiteboard(c, ORIGIN, facing)
      drawPictureFrame(c, ORIGIN, facing)
      drawWaterCooler(c, ORIGIN, facing)
      drawServerRack(c, ORIGIN, facing, { state: 'busy' })
      drawRug(c, ORIGIN, { width: 3, height: 2 })
      drawPlant(c, ORIGIN, { health: 0.42 })
      drawShelfUnit(c, ORIGIN, facing)
    }
  })

  assert.ok(ctx.rects.length > 0, 'nothing was drawn at all')
  for (const r of ctx.rects) {
    assert.ok(
      Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.w) && Number.isInteger(r.h),
      `fillRect(${r.x}, ${r.y}, ${r.w}, ${r.h}) is off the pixel grid`,
    )
    assert.ok(r.w > 0 && r.h > 0, 'an empty rectangle is a wasted call')
  }
})

test('a floor tile is exactly the 640 pixels of a 32×20 rectangle', () => {
  // A room reads as a rectangle because a tile is one. Under the camera this replaced, the
  // same call painted a 256-pixel diamond and a room was a lozenge with empty corners.
  const painted = record((c) => drawFloorTile(c, ORIGIN)).pixels()

  assert.equal(painted.size, TILE_W * TILE_D)
  assert.ok([...painted.values()].every((n) => n === 1), 'a tile painted over itself')
})

test('neighbouring floor tiles tile: no gap, no double-paint', () => {
  // The seam test. A gap flickers the backdrop through the carpet; an overlap is invisible
  // until something translucent is drawn over it, and then it is a stripe.
  const ctx = record((c) => {
    for (const tile of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]) {
      drawFloorTile(c, tile)
    }
  })
  const painted = ctx.pixels()

  assert.equal(painted.size, 4 * TILE_W * TILE_D, 'four tiles did not paint four tiles’ worth of pixels')
  assert.ok([...painted.values()].every((n) => n === 1), 'two tiles claimed the same pixel')

  // Four tiles in a block make one larger rectangle, so every row of it is a solid run.
  const rows = new Map<number, number[]>()
  for (const key of painted.keys()) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    rows.set(y, [...(rows.get(y) ?? []), x])
  }
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b)
    assert.equal(xs.at(-1)! - xs[0]! + 1, xs.length, `row ${y} has a hole in it`)
  }
})

test('a box paints three values, and none of them over another', () => {
  const ctx = record((c) => drawBox(c, ORIGIN, { width: 1, depth: 1, height: 0.5, colour: PALETTE.desk }))
  const painted = ctx.pixels()

  assert.equal(ctx.colours().size, 3, 'a box drawn in fewer than three tones reads flat')
  assert.ok([...painted.values()].every((n) => n === 1), 'two faces of one box overlap')
})

test('a box that tiles against a copy of itself can drop its shaded edge', () => {
  // A run of wall beveled once per tile comes out striped exactly one tile apart, which reads
  // as the tiling being broken rather than as shading.
  const plain = record((c) =>
    drawBox(c, ORIGIN, { width: 1, depth: 1, height: 0.5, colour: PALETTE.wall, edge: false }),
  )

  assert.equal(plain.colours().size, 2)
  assert.ok([...plain.pixels().values()].every((n) => n === 1))
})

test('the carpet alternates two tones, and the second is floor-view’s own', () => {
  const one = record((c) => drawFloorTile(c, { x: 0, y: 0 })).colours()
  const other = record((c) => drawFloorTile(c, { x: 1, y: 0 })).colours()

  assert.deepEqual([...one], [PALETTE.floor])
  assert.deepEqual([...other], ['#2b2739'], 'the weave has drifted off floor-view’s pair')
})

// ──────────────────────────────────────────────────────────────── behaviour ────

test('a monitor turns its screen to whoever sits at the desk, not to the camera', () => {
  // The reported fault, in the form somebody looking at the floor would describe it. A desk
  // facing `north` puts its user between it and the camera, so the screen they are reading
  // faces us too; a desk facing `south` has its user behind it looking our way, and their
  // screen is turned away. Handing both the same facing as the desk is what makes that work.
  const shown = (facing: Facing, screen: 'dark' | 'lit' | 'alert'): Set<string> =>
    record((c) => drawMonitor(c, ORIGIN, facing, { screen })).colours()

  assert.ok(shown('north', 'lit').has(PALETTE.screenLit), 'the sitter faces us and cannot see their screen')
  assert.ok(shown('north', 'alert').has(PALETTE.screenAlert))
  assert.ok(shown('north', 'dark').has(PALETTE.screenDark))
  assert.ok(!shown('north', 'dark').has(PALETTE.screenLit), 'a dark screen must not glow')

  // Turned away there is no screen to see, and inventing one would be the floor claiming to
  // know something the camera cannot show.
  for (const away of ['south', 'east', 'west'] as const) {
    assert.ok(!shown(away, 'lit').has(PALETTE.screenLit), `a monitor at a ${away} desk showed its screen`)
    assert.ok(!shown(away, 'alert').has(PALETTE.screenAlert))
  }
})

test('a screen turned away still says whether it is on, by the light over its own bezel', () => {
  // Every station in the floorplan seats its occupant facing the camera, so this is the only
  // way the screen state reaches the person watching. Light spilling over the top bezel is
  // real light; the panel's lid carries it, and a dark screen spills nothing.
  const lid = (screen: 'dark' | 'lit' | 'alert'): Set<string> =>
    record((c) => drawMonitor(c, ORIGIN, 'south', { screen })).colours()

  const dark = lid('dark')
  for (const on of ['lit', 'alert'] as const) {
    const glow = [...lid(on)].filter((c) => !dark.has(c))
    assert.equal(glow.length, 1, `a ${on} screen behind its own panel is indistinguishable from a dark one`)
    assert.ok(level(glow[0]!) > level(PALETTE.monitor), 'the spill is darker than the chassis it lands on')
  }
})

test('a monitor stands on the desk it is given, not on the floor', () => {
  const onDesk = record((c) => drawMonitor(c, ORIGIN, 'south', { screen: 'lit' }))
  const onFloor = record((c) => drawMonitor(c, ORIGIN, 'south', { screen: 'lit', z: 0 }))

  assert.equal(onFloor.bounds().top - onDesk.bounds().top, DESK_TOP * TILE_RISE)
})

test('a monitor stands clear of the person at the desk, or its state is unreadable', () => {
  // Dead centre it hides entirely behind the eighteen pixels of a seated character, and a
  // state nobody can see is not a state. This is the margin that keeps it visible.
  const panel = record((c) => drawMonitor(c, ORIGIN, 'south', { screen: 'lit' })).bounds()
  const sprite = { left: TILE_W / 2 - SPRITE_W / 2, right: TILE_W / 2 + SPRITE_W / 2 }

  const clear = Math.max(sprite.left - panel.left, panel.right - sprite.right)
  assert.ok(clear >= 4, `only ${clear}px of monitor clears the person sitting at it`)
  assert.ok(panel.left >= 0 && panel.right <= TILE_W, 'the monitor hangs off the edge of its own desk')
})

test('a chair pushed in moves towards the desk it faces, and nowhere else', () => {
  const out = record((c) => drawChair(c, ORIGIN, 'south'))
  const inn = record((c) => drawChair(c, ORIGIN, 'south', { pushedIn: true }))

  // `south` is +y, which is straight down the screen now that the floor does not rotate: the
  // tucked chair must move down and not sideways, shrink or turn.
  assert.ok(inn.bounds().bottom > out.bounds().bottom, 'a tucked chair did not move towards its desk')
  assert.equal(inn.bounds().left, out.bounds().left, 'it slid sideways')

  const span = (r: Recorder): readonly [number, number] => [
    r.bounds().right - r.bounds().left,
    r.bounds().bottom - r.bounds().top,
  ]
  assert.ok(Math.abs(span(inn)[0] - span(out)[0]) <= 1, 'it changed width when it was tucked in')
  assert.ok(Math.abs(span(inn)[1] - span(out)[1]) <= 1, 'it changed height when it was tucked in')
})

test('a chair is painted from the floor up, whichever way it faces', () => {
  // The part-ordering rule, in the case it exists for: a seat stands on a post that stands on
  // a base. Sorting those by nearness instead would paint the base over the foot of its own
  // post, and the chair would look sunk into the carpet.
  //
  // The base is picked out by being the widest thing in the frame's colour, because the arms
  // are that colour too and they are *above* the seat — so "the last dark part comes before
  // the first upholstered one" is no longer the question. "The thing everything stands on is
  // painted first" is.
  for (const facing of FACINGS) {
    const ctx = record((c) => drawChair(c, ORIGIN, facing))
    const frame = new Set(Object.values(shadesOf(PALETTE.chairFrame)))
    const upholstery = new Set(Object.values(shadesOf(PALETTE.chairSeat)))

    const base = ctx.rects.reduce(
      (widest, r, i) => (frame.has(r.colour) && r.w > (ctx.rects[widest]?.w ?? -1) ? i : widest),
      -1,
    )
    const firstSeat = ctx.rects.findIndex((r) => upholstery.has(r.colour))

    assert.ok(base >= 0 && firstSeat >= 0, `a chair facing ${facing} is missing a part`)
    assert.ok(base < firstSeat, `a chair facing ${facing} painted its base after its seat`)
  }
})

test('a chair’s seat reads as a surface, not as an edge under the back', () => {
  // The regression this exists for: a seat narrow enough to hide behind its own back leaves a
  // chair looking like a sign on a pole. The seat's lit top face is the widest run of
  // upholstery in the prop, and it has to stay that way.
  for (const facing of FACINGS) {
    const ctx = record((c) => drawChair(c, ORIGIN, facing))
    const seatTop = shadesOf(PALETTE.chairSeat).top
    const widest = Math.max(...ctx.rects.filter((r) => r.colour === seatTop).map((r) => r.w))

    // Over half a tile across. The back's own top face is a good deal less than that.
    assert.ok(widest >= 16, `a chair facing ${facing} shows only ${widest}px of seat`)
  }
})

test('a chair stands on the floor, well below the desk it is pulled up to', () => {
  // The reported fault: a chair behind a desk is a row further from the camera, and one row
  // back lifts a thing 20 pixels up the screen — so unless its seat is genuinely low it reads
  // as standing *on* the table. A real chair is a little over half the height of a real desk,
  // and that ratio is the only thing that sells it.
  assert.ok(SEAT_TOP < DESK_TOP * 0.7, `a seat at ${SEAT_TOP} is desk height, not chair height`)

  // And the lowest thing it paints is on the ground plane rather than lifted off it. A chair
  // whose nearest pixel is its seat is a chair with nothing touching the carpet, which is the
  // other half of what "floating" looked like.
  const chair = record((c) => drawChair(c, ORIGIN, 'south')).bounds()
  const ground = record((c) =>
    drawBox(c, ORIGIN, { width: 0.5, depth: 0.44, height: 0, colour: PALETTE.floor }),
  ).bounds()

  assert.equal(chair.bottom, ground.bottom, 'nothing the chair paints reaches the floor')
})

test('a chair is wider than the person sitting in it', () => {
  // The other half of the fault the renderer's draw order caused. Even in the right order, a
  // chair narrower than the sprite is completely hidden the moment somebody sits down, and
  // then they read as sitting on the floor. The arms and the back have to show past them.
  for (const facing of ['north', 'south'] as const) {
    const chair = record((c) => drawChair(c, ORIGIN, facing)).bounds()
    assert.ok(
      chair.right - chair.left >= SPRITE_W + 4,
      `a ${facing} chair is ${chair.right - chair.left}px wide and vanishes behind an ${SPRITE_W}px person`,
    )
  }
})

test('a shelf shows its books, and shows its back when turned away', () => {
  const books = new Set(PALETTE.books)
  const shown = (facing: Facing, count?: number): number => {
    const options = count === undefined ? {} : { books: count }
    const colours = record((c) => drawShelfUnit(c, ORIGIN, facing, options)).colours()
    return [...colours].filter((c) => books.has(c as (typeof PALETTE.books)[number])).length
  }

  assert.ok(shown('south') >= 3, 'a full shelf drew almost nothing on it')
  assert.equal(shown('south', 0), 0, 'an empty shelf is an empty shelf')
  assert.equal(shown('south', 3), 3, 'three skills, three books')
  assert.equal(shown('north'), 0, 'the back of a bookshelf is the back of a bookshelf')
})

test('a plant sheds leaves, droops and yellows as its health falls', () => {
  const healthy = foliage(1)
  const dying = foliage(0.5)
  const dead = foliage(0)

  assert.ok(healthy.length > dying.length && dying.length > dead.length, 'it never sheds a leaf')
  assert.ok(dead.length > 0, 'a dead plant is still a plant, not an empty pot')

  const reach = (leaves: readonly { dx: number; dy: number }[]): number =>
    Math.max(...leaves.map((l) => Math.abs(l.dx) + Math.abs(l.dy)))

  assert.ok(healthy[0]!.z > dead[0]!.z, 'the foliage never drops')
  assert.ok(reach(dead) > reach(healthy), 'the foliage never splays out')
})

test('foliage clamps rather than growing a plant healthier than alive', () => {
  assert.deepEqual(foliage(4), foliage(1))
  assert.deepEqual(foliage(-1), foliage(0))
})

test('leaf colour runs from the office’s green to the office’s amber', () => {
  assert.equal(leafColour(1), PALETTE.leafHealthy)
  assert.equal(leafColour(0), PALETTE.leafDying)
  assert.ok(leafColour(0.5) !== PALETTE.leafHealthy && leafColour(0.5) !== PALETTE.leafDying)
})

test('a desk paints its top above its legs, whichever way it is turned', () => {
  for (const facing of FACINGS) {
    const ctx = record((c) => drawDesk(c, ORIGIN, facing))
    const lidRects = ctx.rects.filter((r) => r.colour === DESK_LID)

    assert.ok(lidRects.length > 0, `a desk facing ${facing} has no visible top surface`)
    // The lid is painted last, so nothing can be drawn over the surface things stand on.
    assert.equal(ctx.rects.at(-1)?.colour, DESK_LID, `a desk facing ${facing} painted over its own lid`)
  }
})

test('a desk is not a box: its lid is brighter and its legs darker than any box of its colour', () => {
  // The regression this exists for is a real one. A desk shaded like every other box — lid one
  // step up, legs one step down — reads as a crate at this size, because its legs then carry
  // exactly the value of the lid's own shaded edge and the two merge into one silhouette. What
  // separates furniture from freight is this value gap, not the geometry.
  const box = record((c) => drawBox(c, ORIGIN, { width: 1, depth: 1, height: 0.5, colour: PALETTE.desk }))
  const desk = record((c) => drawDesk(c, ORIGIN, 'south'))

  const lightest = (r: Recorder): number => Math.max(...[...r.colours()].map(level))
  const darkest = (r: Recorder): number => Math.min(...[...r.colours()].map(level))

  assert.ok(lightest(desk) > lightest(box), 'a desk lid no brighter than a box top is a box top')
  assert.ok(
    darkest(desk) < level(shadesOf(PALETTE.desk).side),
    'the understructure is not darker than the lid’s own shaded edge, so the two will merge',
  )
  // And the gap has to be wide enough to survive a dark room, not merely non-zero.
  assert.ok(lightest(desk) - darkest(desk) > 2 * (lightest(box) - darkest(box)))
})

test('a desk opens towards its user and closes towards the room', () => {
  // The other half of the facing flip. Whoever works here sits opposite the way the desk
  // faces, so the knee hole is on their side and the modesty panel on the room's — which
  // means a desk facing the camera shows you a board and one facing away shows you daylight
  // between its legs.
  const shut = underside(record((c) => drawDesk(c, ORIGIN, 'south')))
  const open = underside(record((c) => drawDesk(c, ORIGIN, 'north')))

  assert.ok(shut > 3 * open, 'the modesty panel is not on the room’s side of the desk')
})

test('a desk covers the tile it stands on, because nothing else will', () => {
  // The renderer does not carpet an unwalkable tile, and a desk's tile is unwalkable. Any
  // pixel of it the desk leaves bare is the app's backdrop showing through the floor.
  const desk = record((c) => drawDesk(c, ORIGIN, 'south')).pixels()
  const floor = record((c) => drawFloorTile(c, ORIGIN)).pixels()

  for (const key of floor.keys()) assert.ok(desk.has(key), `the desk leaves ${key} of its own tile bare`)
})

test('a wall stands on the far edge of its tile, leaving the tile in front of it clear', () => {
  // The floor a wall sits on stays walkable; the wall is on the boundary, not in the room.
  const tile = { x: 2, y: 2 }
  const floor = record((c) => drawFloorTile(c, tile)).pixels()
  const wall = record((c) => drawWall(c, tile, 'south'))

  const covered = new Set<string>()
  for (const r of wall.rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) if (floor.has(`${x},${y}`)) covered.add(`${x},${y}`)
    }
  }
  assert.ok(covered.size > 0, 'the wall does not touch the floor at all')
  assert.ok(covered.size < floor.size / 2, `the wall covered ${covered.size} of the tile's ${floor.size} pixels`)
})

test('a run of wall meets itself without a seam or a stripe', () => {
  // Both failures are the same arithmetic. A gap shows the backdrop through the room; a bevel
  // repeated per tile shows as stripes exactly one tile apart.
  const ctx = record((c) => {
    for (let x = 0; x < 3; x++) drawWall(c, { x, y: 1 }, 'south')
  })
  const painted = ctx.pixels()

  assert.ok([...painted.values()].every((n) => n === 1), 'two wall segments claimed the same pixel')
  assert.equal(ctx.colours().size, 2, 'a wall run is beveled and will come out striped')

  const rows = new Map<number, number>()
  for (const key of painted.keys()) {
    const y = Number(key.split(',')[1])
    rows.set(y, (rows.get(y) ?? 0) + 1)
  }
  const widest = Math.max(...rows.values())
  assert.equal(widest, 3 * TILE_W, 'three tiles of wall are not three tiles wide')
})

// ───────────────────────────────────────────────────────── the new furniture ────

test('a table spans the tiles it is given, in either direction', () => {
  // Measured on the lid rather than on the whole prop, because the whole prop includes the
  // rise of the top off the floor and that is not a distance in tiles.
  const lid = (options: { length: number; along?: 'x' | 'y' }): { w: number; h: number; left: number } => {
    const rects = record((c) => drawTable(c, ORIGIN, options)).rects.filter((r) => r.colour === DESK_LID)
    const left = Math.min(...rects.map((r) => r.x))
    return {
      w: Math.max(...rects.map((r) => r.x + r.w)) - left,
      h: Math.max(...rects.map((r) => r.y + r.h)) - Math.min(...rects.map((r) => r.y)),
      left,
    }
  }

  const alongX = lid({ length: 3 })
  const alongY = lid({ length: 3, along: 'y' })

  assert.ok(alongX.w > 2.8 * TILE_W && alongX.w <= 3 * TILE_W, `a three-tile table is ${alongX.w}px across`)
  assert.ok(alongY.h > 2.8 * TILE_D, `a three-tile table down the screen is ${alongY.h}px deep`)
  // Placed by its first tile, so a layout can name the run of tiles it occupies and get it.
  assert.ok(Math.abs(alongX.left - ORIGIN.x * TILE_W) <= 2, 'a table is not placed by its first tile')
})

test('a table is a desk without the modesty panel, because people sit all round it', () => {
  const table = record((c) => drawTable(c, ORIGIN, { length: 2 }))
  const desk = record((c) => drawDesk(c, ORIGIN, 'south'))

  assert.ok(table.colours().has(DESK_LID), 'a table top is not lit like a desk top')
  assert.ok(underside(table) > 0, 'a table has no legs at all')
  assert.ok(underside(table) < underside(desk) / 2, 'a table is boarded up like a desk')
})

test('a sofa grows along its front, whichever way it faces', () => {
  const wide = record((c) => drawSofa(c, ORIGIN, 'south', { length: 3 })).bounds()
  const deep = record((c) => drawSofa(c, ORIGIN, 'east', { length: 3 })).bounds()

  assert.ok(wide.right - wide.left > 2.5 * TILE_W, 'a three-tile sofa is not three tiles across')
  assert.ok(deep.bottom - deep.top > 2.5 * TILE_D, 'a sideways sofa did not grow down the screen')
  assert.ok(
    record((c) => drawSofa(c, ORIGIN, 'south')).colours().has(shadesOf(PALETTE.chairSeat).top),
    'a sofa is not upholstered in the same fabric as the chairs',
  )
})

test('the wall-mounted things hang above the floor and only face one way', () => {
  const floor = record((c) => drawFloorTile(c, ORIGIN)).bounds()

  for (const draw of [drawWhiteboard, drawPictureFrame]) {
    const hung = record((c) => draw(c, ORIGIN, 'south'))
    assert.ok(hung.bounds().bottom < floor.top, 'it is resting on the carpet rather than hanging on the wall')

    // Turned away it is a slab: the surface and everything written on it are on the far side.
    const face = record((c) => draw(c, ORIGIN, 'north')).colours()
    const front = record((c) => draw(c, ORIGIN, 'south')).colours()
    assert.ok(face.size < front.size, 'the back of a picture shows what is on the front of it')
  }
})

test('a whiteboard shows what has been written on it, and nothing when nothing has', () => {
  const marks = (lines?: number): number => {
    const options = lines === undefined ? {} : { lines }
    return record((c) => drawWhiteboard(c, ORIGIN, 'south', options)).colours().size
  }

  assert.ok(marks() > marks(0), 'writing on the board changed nothing')
  assert.ok(marks(1) < marks(), 'a board with one line on it looks as used as a full one')
})

test('a water cooler’s bottle is the brightest thing about it', () => {
  // The whole of what makes it readable at a glance. A cabinet with nothing on top is a
  // filing cabinet.
  const ctx = record((c) => drawWaterCooler(c, ORIGIN, 'south'))
  const bottle = tint(PALETTE.chairSeat, 1.5)

  assert.ok(ctx.colours().has(shadesOf(bottle).top), 'there is no bottle on it')
  assert.equal(Math.max(...[...ctx.colours()].map(level)), level(shadesOf(bottle).top))
})

test('a server rack’s lights say which of the three states it is in', () => {
  const lit = (state: 'idle' | 'busy' | 'fault'): Set<string> =>
    record((c) => drawServerRack(c, ORIGIN, 'south', { state })).colours()

  assert.ok(lit('fault').has(PALETTE.screenAlert), 'a faulty rack shows no fault')
  assert.ok(!lit('idle').has(PALETTE.screenAlert), 'an idle rack claims a fault')
  assert.ok(!lit('busy').has(PALETTE.screenAlert), 'a busy rack claims a fault')

  // Colour alone is two pixels of hue at this size, so the count carries it too.
  assert.ok(lit('busy').size > lit('idle').size, 'a busy rack is no more lit up than an idle one')
  assert.ok(!lit('fault').has(PALETTE.leafHealthy), 'a faulty rack is still showing green')

  // And a rack turned away is a cabinet, not a wall of lights nobody could see.
  const back = record((c) => drawServerRack(c, ORIGIN, 'north', { state: 'fault' })).colours()
  assert.ok(!back.has(PALETTE.screenAlert), 'the back of a rack is showing its front panel')
})

test('a rug covers the block of tiles it is given and lies flat on them', () => {
  const rug = record((c) => drawRug(c, ORIGIN, { width: 3, height: 2 }))
  const floor = record((c) => {
    for (let x = 0; x < 3; x++) for (let y = 0; y < 2; y++) drawFloorTile(c, { x, y })
  })

  assert.deepEqual(rug.bounds(), floor.bounds())
  // Flat: no height, so no front face and nothing to sort against. Two tones, so it is a rug
  // and not a patch of differently coloured carpet.
  assert.equal(rug.colours().size, 2)
})

// ──────────────────────────────────────────── a prop with nothing to report ────

/**
 * The three reporting props, and the one thing they must never do.
 *
 * Each of these draws a *measured zero* and an *unmeasured nothing* and asserts the two
 * pictures differ. That is the whole contract: the room may say "no work outstanding" and it
 * may say "I could not read the list", and a person looking at the wall has to be able to tell
 * which. They were the same picture until `src/shared/floor/room.ts` existed, which is how a
 * plant came to be drawn at full health for a workspace nothing had measured.
 *
 * Asserted as inequality between two renders rather than against a colour table, so the palette
 * can be retuned without rewriting these — the property is the distinction, not the shade.
 */
test('an unread whiteboard does not look like a board nobody has written on', () => {
  const unread = record((c) => drawWhiteboard(c, ORIGIN, 'south', { lines: null }))
  const blank = record((c) => drawWhiteboard(c, ORIGIN, 'south', { lines: 0 }))
  const full = record((c) => drawWhiteboard(c, ORIGIN, 'south', { lines: 3 }))

  assert.notDeepEqual(unread.rects, blank.rects, 'unmeasured and empty drew the same board')
  assert.notDeepEqual(unread.rects, full.rects)

  // And the difference is the surface, not just the strokes: a dim board reads as "not
  // reporting", where a lit one with no marks reads as "nothing written yet".
  const surfaceOf = (r: Recorder) => Math.max(...r.rects.map((x) => level(x.colour)))
  assert.ok(
    surfaceOf(unread) < surfaceOf(blank),
    'the unread board should be dimmed, not merely stroke-free',
  )
})

test('an unread notice board does not look like a board with nothing pinned to it', () => {
  const unread = record((c) => drawNoticeBoard(c, ORIGIN, 'south', { notes: null }))
  const empty = record((c) => drawNoticeBoard(c, ORIGIN, 'south', { notes: 0 }))

  assert.notDeepEqual(unread.rects, empty.rects, 'this pair is the bug this module exists for')
  assert.deepEqual(
    unread.rects.length,
    empty.rects.length,
    'both are a bare board — the difference should be its colour, not extra furniture',
  )
})

test('a notice board draws the count it was given and not a default', () => {
  const counts = [0, 1, 4, 6].map(
    (notes) => record((c) => drawNoticeBoard(c, ORIGIN, 'south', { notes })).rects.length,
  )
  assert.deepEqual(
    [...counts].sort((a, b) => a - b),
    counts,
    'more outstanding work must not draw fewer notes',
  )
  assert.ok(counts[3]! > counts[0]!, 'six notes and none drew the same board')
})

test('a plant with nothing to report is off the health scale, not partway along it', () => {
  // Halfway between dying and healthy is still a health reading. The one thing this colour must
  // not do is land on the scale, because every point on it is a claim about the project.
  const unread = leafColour(null)
  for (let t = 0; t <= 1.0001; t += 0.05) {
    assert.notEqual(unread, leafColour(t), `the unread colour collides with health ${t.toFixed(2)}`)
  }
})

test('an unmeasured plant is not drawn as a thriving one', () => {
  const unread = record((c) => drawPlant(c, ORIGIN, { health: null }))
  const thriving = record((c) => drawPlant(c, ORIGIN, { health: 1 }))
  const dead = record((c) => drawPlant(c, ORIGIN, { health: 0 }))

  assert.notDeepEqual(unread.rects, thriving.rects, 'never-opened drew as tended')
  assert.notDeepEqual(unread.rects, dead.rects, 'and it must not draw as abandoned either')

  // The posture is deliberately the upright one — the colour carries the reading, and a slumped
  // ashen plant would state a health it does not have twice over.
  assert.deepEqual(
    unread.rects.map((r) => [r.x, r.y, r.w, r.h]),
    thriving.rects.map((r) => [r.x, r.y, r.w, r.h]),
    'the unread plant should differ from a healthy one in colour alone',
  )
})
