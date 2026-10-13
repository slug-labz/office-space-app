/**
 * The camera.
 *
 * This module exists to keep one promise: **the office's geometry does not know how it is being
 * drawn.** Pathfinding, walkers, routines, choreography and the floorplan all speak tiles and go
 * on speaking tiles. This is the only place that turns a tile into a place on the screen, so
 * changing the camera is changing this file rather than changing the office.
 *
 * That separation is measured rather than hoped for: seven of the eight modules under `floor/`
 * contain no pixel arithmetic at all. It has now survived two camera changes without any of them
 * being touched, which is the strongest evidence it is real.
 *
 * ## The projection: axis-aligned oblique, seen from above
 *
 * ```
 *   x ────────────────▶            x runs across the screen
 *   │  ┌───────────┐               y runs down it, foreshortened
 *   │  │           │               z lifts, straight up
 *   y  │   floor   │
 *   │  │           │               A room is a RECTANGLE.
 *   ▼  └───────────┘
 * ```
 *
 * Not isometric, and the difference is the whole point. Isometric rotates the floor 45°, so a
 * room is a diamond: its corners are empty, its walls run diagonally, and — the part that
 * actually bites — its projected width is `(w + h) * halfTile`, meaning **the room's depth
 * pushes on the screen's width**. A floor laid out to be wide and shallow is then the worst
 * possible shape, and this office was exactly that: converting the camera without
 * re-proportioning the room dropped it a whole integer scale step and halved it.
 *
 * Here the width is `w * TILE_W`. Depth costs nothing horizontally, a room reads as a room, and
 * walls are parallel to the edges of the screen — which is most of what "readable" means.
 *
 * ## The tilt
 *
 * One tilt, about the horizontal axis, and none about the vertical. `TILE_D < TILE_W` is that
 * tilt and its only expression: the camera is raised, so a tile that is square on the floor is
 * squashed vertically on the screen. At `TILE_D === TILE_W` the camera is directly overhead and
 * nothing has height; the smaller `TILE_D` gets, the lower the camera and the more of each
 * wall you see at the cost of floor. 32 x 20 is a high camera — you are looking into the room
 * from above rather than across it.
 */

import type { Pixel, Tile } from './geometry.js'

/** A tile's width on screen. Also its true width — nothing is foreshortened horizontally. */
export const TILE_W = 32

/**
 * A tile's depth on screen.
 *
 * Raised from 20 to 22 because too little of the office was visible: every tile is a
 * tenth taller on screen, so you see correspondingly further in.
 *
 * **It stops here for a measured reason, not a cautious one.** The office draws at an integer
 * scale, so this trades directly against the 2× threshold. 24 needs a stage 683px tall; the
 * stage at a 1200×800 window is **680**, and the office silently halves — which is the exact
 * complaint the raise exists to fix. 22 needs 631, leaving ~50px of margin, which is what a
 * wrapped tab row or a problem pill costs. A raise that survives only until the chrome grows by
 * one line is not a raise.
 *
 * The foreshortening, and therefore the camera angle: the ratio `TILE_D / TILE_W` is the cosine
 * of the tilt. Must divide evenly by two so half-tiles land on whole pixels.
 */
export const TILE_D = 22

/**
 * How far one unit of `z` lifts a thing, in pixels.
 *
 * Slightly more than a tile's depth, so a one-unit wall is a shade taller than the floor tile
 * it stands on and reads as vertical rather than as more floor.
 */
export const TILE_RISE = 28

/**
 * Where a tile lands on screen.
 *
 * The **centre of the tile's floor**, because that is where something standing on the tile
 * actually stands. Sprites are anchored at their feet, so the anchor has to be a point on the
 * ground rather than a corner of the cell.
 */
export function toScreen(tile: Tile, z = 0): Pixel {
  return toScreenAt(tile.x, tile.y, z)
}

/**
 * The same projection, on continuous coordinates.
 *
 * {@link toScreen} takes a `Tile`, documented as an *integer* grid coordinate — and the two
 * callers that most need this do not have integers. A walker mid-step is between tiles, and a
 * prop's geometry is built from fractions of one: the near edge of a desk lid is at `y + 0.4`,
 * not at `y`. The projection is linear so passing fractions through would be arithmetically
 * fine and still the wrong shape, because a type nobody can trust stops being checked.
 */
export function toScreenAt(x: number, y: number, z = 0): Pixel {
  return {
    x: x * TILE_W + TILE_W / 2,
    y: y * TILE_D + TILE_D / 2 - z * TILE_RISE,
  }
}

/**
 * Which tile a screen point is over, on the ground plane.
 *
 * Deliberately ignores height. A click that lands visually on a raised object is still a click
 * on the floor tile beneath it — working out *which* raised thing was hit is the renderer's job,
 * because only the renderer knows what it drew.
 */
export function toTile(p: Pixel): Tile {
  return {
    x: Math.floor(p.x / TILE_W),
    y: Math.floor(p.y / TILE_D),
  }
}

/**
 * The painter's-algorithm sort key. Lower draws first.
 *
 * Only `y` matters now — with no rotation, distance from the camera is depth into the room and
 * nothing else. (Isometric needed `x + y`; that is the other thing rotating the floor costs
 * you.)
 *
 * The `z` term is scaled below one so it can never reorder two things on *different* tiles. A
 * tall thing one row back must still be drawn behind a short thing one row forward — without
 * the scaling, a lamp at the back of the room paints over the person in front of it.
 */
export function depthOf(tile: Tile, z = 0): number {
  return depthAt(tile.y, z)
}

/** The same key for something between tiles — a walker mid-step, or part of a prop. */
export function depthAt(y: number, z = 0): number {
  return y + Math.min(z, 0.999) * 0.999
}

export interface ViewBounds {
  /** Width of the drawn floor, in pixels. */
  readonly width: number
  /** Height of the drawn floor, in pixels. */
  readonly height: number
  /** Add this to every projected point to bring the floor's left edge to zero. */
  readonly offsetX: number
  /** Add this to every projected point to bring the floor's top edge to zero. */
  readonly offsetY: number
}

/**
 * The box a `w x h` tile floor occupies once projected, and the offset that puts it at 0,0.
 *
 * `extraRise` is how many `z` units of headroom to leave above the floor. Without it a wall at
 * the back of the room is drawn above the canvas and simply disappears — a bug that looks
 * exactly like the wall never being drawn.
 *
 * Unlike the isometric version this replaces, `offsetX` is always zero: an axis-aligned floor
 * starts at the origin and grows right and down, so nothing is ever off the left edge. The
 * field stays because callers should not have to know that, and because it is one line here
 * versus a conditional at every call site.
 */
export function viewBounds(w: number, h: number, extraRise = 0): ViewBounds {
  const rise = extraRise * TILE_RISE
  return {
    width: w * TILE_W,
    height: h * TILE_D + rise,
    offsetX: 0,
    offsetY: rise,
  }
}

/** Smallest and largest integer scale the floor is ever drawn at. */
export const MIN_SCALE = 1
export const MAX_SCALE = 4

/**
 * How far past the available box a step up is allowed to spill.
 *
 * `Math.floor` alone is a cliff: a floor twelve pixels too wide is not drawn slightly smaller,
 * it is drawn at **half** the size. That happened converting this floor to isometric — 432px
 * against a 420px budget — and halved the whole office. So a step up is taken when it overflows
 * by a little and the stage clips it; what gets clipped is the outermost ring of boundary wall,
 * the least informative thing on the floor, and what is bought is every character being twice
 * the size.
 */
export const OVERFLOW = 1.08

/** Margin held back from the stage before fitting. */
export const FIT_PAD = 8

export interface Box {
  readonly width: number
  readonly height: number
}

/**
 * The integer scale to draw at, given the room the stage has and the size of the projected floor.
 *
 * Pure, and extracted from the renderer for two reasons. The rule is the difference between an
 * office that fills the window and one that draws at a quarter of it, and it had **no test** —
 * `choreography.test.ts` re-implemented it, constants and all, which means the copy could agree
 * with itself while disagreeing with the renderer. And a caller cannot get it right by accident:
 * `available` must be a box the canvas does **not** influence. A `1fr` grid track whose minimum
 * is `auto` grows to fit an oversized canvas, so measuring it after drawing feeds the output back
 * into the input. See the note on `.floor` in `styles.css`.
 */
export function chooseScale(available: Box, bounds: Box): number {
  const w = available.width - FIT_PAD
  const h = available.height - FIT_PAD
  if (bounds.width <= 0 || bounds.height <= 0) return MIN_SCALE

  const fitted = Math.min(w / bounds.width, h / bounds.height)
  let scale = Math.floor(fitted)
  const up = scale + 1
  if (bounds.width * up <= w * OVERFLOW && bounds.height * up <= h * OVERFLOW) scale = up
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}

/** The four corners of a tile's floor, clockwise from the top-left. */
export type Corners = readonly [Pixel, Pixel, Pixel, Pixel]

/**
 * A tile's floor rectangle, as corners.
 *
 * Returns a **fixed-length tuple** rather than an array, which is not a stylistic preference:
 * under `noUncheckedIndexedAccess` — which this project has on — indexing an array yields
 * `Pixel | undefined`, so every caller wanting a named corner writes a guard for a case that
 * cannot happen, or reaches for `!` and gives up the check everywhere.
 */
export function corners(tile: Tile, z = 0): Corners {
  const c = toScreen(tile, z)
  const hw = TILE_W / 2
  const hd = TILE_D / 2
  return [
    { x: c.x - hw, y: c.y - hd }, // back-left
    { x: c.x + hw, y: c.y - hd }, // back-right
    { x: c.x + hw, y: c.y + hd }, // front-right
    { x: c.x - hw, y: c.y + hd }, // front-left
  ]
}

/**
 * Whether something at `front` could hide something standing at `behind`.
 *
 * A user who cannot see their staff blames the camera, so the renderer uses this to decide what
 * to *fade* rather than what to skip — vanishing furniture is more alarming than translucent
 * furniture.
 *
 * Simpler than the isometric case in both axes, which is the readability win showing up in the
 * arithmetic: a thing hides what is directly behind it in the same columns, and only for as
 * many rows back as its height reaches.
 */
export function occludes(front: Tile, behind: Tile, frontHeight: number, frontWidth = 1): boolean {
  if (frontHeight <= 0) return false
  if (front.y <= behind.y) return false

  // A wall of height h rises `h * TILE_RISE` pixels, and each row back is `TILE_D` further up
  // the screen — so it covers that many rows behind it.
  const reach = Math.ceil((frontHeight * TILE_RISE) / TILE_D)
  if (front.y - behind.y > reach) return false

  return Math.abs(front.x - behind.x) < (frontWidth + 1) / 2
}
