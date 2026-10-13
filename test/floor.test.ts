import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DIRECTIONS,
  directionFromDelta,
  pixelToTile,
  tileToPixel,
  tilesEqual,
  type Direction,
  type Tile,
} from '../src/shared/floor/geometry.js'
import { toScreen } from '../src/shared/floor/projection.js'
import { WalkGrid } from '../src/shared/floor/grid.js'
import { findPath, findPathAdjacent } from '../src/shared/floor/pathfinding.js'
import { Walker } from '../src/shared/floor/walker.js'
import { RoutineRunner, type Stations } from '../src/shared/floor/routine.js'

const TS = 16

// ─────────────────────────────────────────────────────────────── geometry ────

test('a tile maps to its floor line, not its centre', () => {
  // Feet on the ground: x centred, y at the tile's bottom edge. Anchoring to the centre
  // instead makes every character hover half a tile above the floor.
  assert.deepEqual(tileToPixel({ x: 0, y: 0 }, TS), { x: 8, y: 16 })
  assert.deepEqual(tileToPixel({ x: 3, y: 2 }, TS), { x: 56, y: 48 })
})

test('pixelToTile inverts tileToPixel, including on the boundary', () => {
  for (const tile of [{ x: 0, y: 0 }, { x: 3, y: 2 }, { x: 9, y: 7 }]) {
    assert.ok(tilesEqual(pixelToTile(tileToPixel(tile, TS), TS), tile), `round trip ${tile.x},${tile.y}`)
  }
})

test('facing takes the dominant axis, and a stationary walker keeps its own', () => {
  assert.equal(directionFromDelta(5, 1), 'right')
  assert.equal(directionFromDelta(-5, 1), 'left')
  assert.equal(directionFromDelta(1, 5), 'down')
  assert.equal(directionFromDelta(1, -5), 'up')
  // Ties go to the vertical axis — arbitrary, but it must be deterministic.
  assert.equal(directionFromDelta(3, 3), 'down')
  // No movement means no opinion; the caller keeps the previous facing.
  assert.equal(directionFromDelta(0, 0), null)
})

test('a facing is a floor axis, and the camera keeps the two aligned', () => {
  // The four painted frames are the four axes of the room. Under the isometric camera those
  // stopped being the same thing as the four edges of the window — tile +x was down-RIGHT — and
  // the tempting fix was to answer in screen space instead, which collapses: every cardinal step
  // projected twice as wide as it was tall, so a screen-space rule took the horizontal every
  // time and the front and back views were never drawn again.
  //
  // Removing the rotation makes them the same thing again, which is the readability the axis
  // alignment was for. This test now pins THAT — because the property it guards is no longer
  // "don't confuse two spaces" but "these two spaces must stay the same space", and a camera
  // change that quietly reintroduced a horizontal tilt would break the floor in the same way
  // while every facing still looked individually reasonable.
  const axes: ReadonlyArray<{ step: Tile; facing: Direction; screen: [number, number] }> = [
    { step: { x: 1, y: 0 }, facing: 'right', screen: [+1, 0] },
    { step: { x: -1, y: 0 }, facing: 'left', screen: [-1, 0] },
    { step: { x: 0, y: 1 }, facing: 'down', screen: [0, +1] },
    { step: { x: 0, y: -1 }, facing: 'up', screen: [0, -1] },
  ]
  assert.equal(axes.length, DIRECTIONS.length, 'every facing must have an axis')

  const from: Tile = { x: 4, y: 4 }
  for (const { step, facing, screen } of axes) {
    assert.equal(directionFromDelta(step.x, step.y), facing, `tile ${step.x},${step.y}`)

    const a = toScreen(from)
    const b = toScreen({ x: from.x + step.x, y: from.y + step.y })
    assert.deepEqual(
      [Math.sign(b.x - a.x), Math.sign(b.y - a.y)],
      screen,
      `facing ${facing} should project to screen ${screen[0]},${screen[1]}`,
    )
    // The no-horizontal-tilt property, stated as arithmetic: each floor axis moves the drawing
    // along exactly one screen axis and leaves the other alone. Any rotation breaks this.
    const moved = [b.x - a.x, b.y - a.y].filter((d) => d !== 0)
    assert.equal(moved.length, 1, `facing ${facing} moves on both screen axes — the floor is tilted`)
  }
})

// ─────────────────────────────────────────────────────────────────── grid ────

test('out of bounds is not walkable', () => {
  const grid = WalkGrid.open(4, 4)
  assert.equal(grid.isWalkable(0, 0), true)
  assert.equal(grid.isWalkable(-1, 0), false)
  assert.equal(grid.isWalkable(4, 0), false)
  assert.equal(grid.isWalkable(0, 4), false)
})

test('a collision layer blocks on any non-zero tile id', () => {
  // Tiled exports 0 for empty; anything else is furniture or wall.
  const grid = WalkGrid.fromCollisionLayer(3, 2, [0, 7, 0, 0, 0, 12])
  assert.equal(grid.isWalkable(0, 0), true)
  assert.equal(grid.isWalkable(1, 0), false)
  assert.equal(grid.isWalkable(2, 1), false)
  assert.equal(grid.walkableCount, 4)
})

test('a seat can be carved back out of the collision layer', () => {
  // A chair is drawn as furniture, so it lands in the collision layer — but a character has
  // to path onto it to sit down. The floor loader carves seats out after building the grid.
  const grid = WalkGrid.fromCollisionLayer(2, 1, [0, 5])
  assert.equal(grid.isWalkable(1, 0), false)
  grid.setWalkable(1, 0, true)
  assert.equal(grid.isWalkable(1, 0), true)
})

// ──────────────────────────────────────────────────────────── pathfinding ────

test('an open floor gives a shortest path excluding the start', () => {
  const path = findPath(WalkGrid.open(5, 5), { x: 0, y: 0 }, { x: 3, y: 0 })
  assert.deepEqual(path, [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }])
})

test('already there is an empty path, not null', () => {
  // Distinct from "no route". A caller that conflates them freezes a character that was
  // simply asked to stay put.
  assert.deepEqual(findPath(WalkGrid.open(3, 3), { x: 1, y: 1 }, { x: 1, y: 1 }), [])
})

test('a walled-off goal is null, not an empty path', () => {
  const grid = WalkGrid.fromRows([
    [true, false, true],
    [true, false, true],
    [true, false, true],
  ])
  assert.equal(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 }), null)
})

test('an unwalkable goal is null', () => {
  const grid = WalkGrid.fromRows([[true, false]])
  assert.equal(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 0 }), null)
})

test('the path routes around an obstacle rather than through it', () => {
  const grid = WalkGrid.fromRows([
    [true, true, true],
    [true, false, true],
    [true, true, true],
  ])
  const path = findPath(grid, { x: 0, y: 1 }, { x: 2, y: 1 })
  assert.notEqual(path, null)
  assert.ok(!path!.some((t) => t.x === 1 && t.y === 1), 'must not cross the blocked centre')
  assert.deepEqual(path![path!.length - 1], { x: 2, y: 1 })
})

test('walking to a desk means walking beside it', () => {
  // The desk itself is blocked; findPathAdjacent lands on the nearest tile that is not.
  const grid = WalkGrid.fromRows([
    [true, true, true],
    [true, false, true],
    [true, true, true],
  ])
  const path = findPathAdjacent(grid, { x: 0, y: 0 }, { x: 1, y: 1 })
  assert.notEqual(path, null)
  const end = path![path!.length - 1]!
  const adjacent = Math.abs(end.x - 1) + Math.abs(end.y - 1) === 1
  assert.ok(adjacent, `ended at ${end.x},${end.y}, which is not beside the desk`)
})

// ───────────────────────────────────────────────────────────────── walker ────

test('a walker with no path reports neither movement nor arrival', () => {
  const w = new Walker({ x: 0, y: 0 }, { tileSize: TS })
  assert.deepEqual(w.update(1), { arrived: false, moved: false })
})

test('a walker reaches its destination and reports arrival exactly once', () => {
  const w = new Walker({ x: 0, y: 0 }, { tileSize: TS, speed: 48 })
  w.setPath([{ x: 1, y: 0 }, { x: 2, y: 0 }])

  let arrivals = 0
  for (let i = 0; i < 100; i++) {
    if (w.update(1 / 60).arrived) arrivals++
  }

  assert.equal(arrivals, 1, 'arrival must fire on exactly one frame')
  assert.deepEqual(w.position, tileToPixel({ x: 2, y: 0 }, TS))
  assert.equal(w.isMoving, false)
})

test('facing follows the direction of travel', () => {
  const w = new Walker({ x: 2, y: 2 }, { tileSize: TS })

  w.setPath([{ x: 3, y: 2 }])
  w.update(0.05)
  assert.equal(w.facing, 'right')

  w.teleport({ x: 2, y: 2 })
  w.setPath([{ x: 2, y: 1 }])
  w.update(0.05)
  assert.equal(w.facing, 'up')
})

test('a frame spike is absorbed, not stuttered through', () => {
  // The reference implementation clamps movement to the next waypoint, so one huge frame
  // advances a single tile and the character visibly falls behind. We spend the whole budget
  // along the path instead.
  const w = new Walker({ x: 0, y: 0 }, { tileSize: TS, speed: 48 })
  const path = Array.from({ length: 8 }, (_, i) => ({ x: i + 1, y: 0 }))
  w.setPath(path)

  // One second at 48px/s covers 48px = three tiles. Not one.
  w.update(1)
  assert.deepEqual(w.position, tileToPixel({ x: 3, y: 0 }, TS))
  assert.equal(w.remainingPath.length, 5)
})

test('a huge frame cannot cut a corner through a wall', () => {
  // Budget is spent *along the path*, never as a straight line toward the destination, so an
  // enormous dt still traces the L-shape rather than crossing the blocked diagonal.
  const w = new Walker({ x: 0, y: 0 }, { tileSize: TS, speed: 48 })
  w.setPath([{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }])

  const seen: string[] = []
  for (let i = 0; i < 10; i++) {
    w.update(10) // absurd frame time
    seen.push(`${Math.round(w.position.x)},${Math.round(w.position.y)}`)
  }

  assert.deepEqual(w.position, tileToPixel({ x: 2, y: 2 }, TS))
  // Never appeared at the diagonal shortcut (1,1) → pixel (24, 32).
  assert.ok(!seen.includes('24,32'), 'must not cut the corner')
})

test('a redirected walker abandons its previous path', () => {
  const w = new Walker({ x: 0, y: 0 }, { tileSize: TS })
  w.setPath([{ x: 5, y: 0 }])
  w.update(0.1)
  w.setPath([{ x: 0, y: 1 }])
  assert.deepEqual([...w.remainingPath], [{ x: 0, y: 1 }])
})

test('negative or zero dt is inert', () => {
  const w = new Walker({ x: 0, y: 0 }, { tileSize: TS })
  w.setPath([{ x: 4, y: 0 }])
  const before = { ...w.position }
  w.update(0)
  w.update(-5)
  assert.deepEqual(w.position, before)
})

// ───────────────────────────────────────────────── re-laying the floor mid-walk ──
//
// The floorplan is rebuilt whenever the workspace changes. A character crossing the room when
// that happens must not be abandoned halfway.

const stationsAt = (tile: { x: number; y: number }): Stations => ({ resolve: () => tile })

test('a walk in progress survives the floor being re-laid', () => {
  const walker = new Walker({ x: 0, y: 0 }, { tileSize: TS, speed: 48 })
  const runner = new RoutineRunner(walker, WalkGrid.open(8, 8), stationsAt({ x: 6, y: 0 }), TS)

  runner.start({
    who: 'reviewer',
    name: 'briefing',
    priority: 1,
    reason: { summary: 'taking a brief', cause: 'dispatch' },
    steps: [{ kind: 'walk', to: { at: 'briefing' } }],
  })

  runner.update(1) // three tiles along, still walking
  assert.ok(walker.isMoving)
  const partway = walker.position.x

  runner.retarget(WalkGrid.open(8, 12), stationsAt({ x: 6, y: 0 }))

  assert.ok(runner.isRunning, 'the routine is still running')
  assert.ok(walker.isMoving, 'and the walk was re-routed rather than dropped')
  assert.equal(walker.position.x, partway, 're-routed from where they actually are')

  for (let i = 0; i < 20; i++) runner.update(0.1)
  assert.equal(runner.isRunning, false, 'the arrival still happens')
})

test('re-laying the floor does not restart a pause', () => {
  const walker = new Walker({ x: 0, y: 0 }, { tileSize: TS })
  const runner = new RoutineRunner(walker, WalkGrid.open(4, 4), stationsAt({ x: 1, y: 0 }), TS)

  runner.start({
    who: 'reviewer',
    name: 'briefing',
    priority: 1,
    reason: { summary: 'handing over', cause: 'dispatch' },
    steps: [{ kind: 'pause', ms: 1000 }],
  })

  runner.update(0.8)
  runner.retarget(WalkGrid.open(4, 6), stationsAt({ x: 1, y: 0 }))
  // 200ms of the beat were left. If retarget restarted the timer this would still be running.
  assert.equal(runner.update(0.3), true, 'the beat finishes on schedule')
})

test('a walk that cannot be routed on the new floor is marked blocked, not left hanging', () => {
  const walker = new Walker({ x: 0, y: 0 }, { tileSize: TS, speed: 48 })
  const runner = new RoutineRunner(walker, WalkGrid.open(8, 8), stationsAt({ x: 6, y: 0 }), TS)

  runner.start({
    who: 'reviewer',
    name: 'briefing',
    priority: 1,
    reason: { summary: 'taking a brief', cause: 'dispatch' },
    steps: [{ kind: 'walk', to: { at: 'briefing' } }],
  })
  runner.update(0.2)

  // The new floor walls off the destination entirely.
  const walled = WalkGrid.fromRows(Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => x < 2 && y < 2)))
  runner.retarget(walled, stationsAt({ x: 6, y: 0 }))

  assert.deepEqual(runner.state.blocked, { at: 'briefing' }, 'readable as blocked rather than as standing still')
  assert.equal(runner.update(0.1), true, 'and the routine completes instead of deadlocking')
})
