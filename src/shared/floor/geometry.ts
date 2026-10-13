/**
 * Floor geometry — tiles, pixels, and facing.
 *
 * Two coordinate systems live side by side and confusing them is the classic bug in a tile
 * engine, so they are distinct types rather than two interchangeable `{x, y}` shapes.
 *
 *   Tile  — integer grid coordinates. What pathfinding speaks.
 *   Pixel — continuous world coordinates. What a character's position is.
 */

/** Integer grid coordinate. */
export interface Tile {
  readonly x: number
  readonly y: number
}

/** Continuous world coordinate, in pixels. */
export interface Pixel {
  readonly x: number
  readonly y: number
}

/**
 * Which way a character faces.
 *
 * These name **floor axes, not directions on screen**, and since the floor went isometric those
 * are no longer the same thing: `down` is tile +y, which projects to down-*left*; `right` is
 * tile +x, which projects to down-*right*. Every facing is a screen diagonal now, and the four
 * painted frames are read as the four axes of the room rather than the four edges of the
 * window. See {@link directionFromDelta} for why that bargain is the right one.
 */
export type Direction = 'down' | 'up' | 'left' | 'right'

export const DIRECTIONS: readonly Direction[] = ['down', 'up', 'left', 'right'] as const

/** The four orthogonal steps. No diagonals — the floor is a grid of desks, not open ground. */
export const NEIGHBOUR_OFFSETS: readonly Tile[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
] as const

export function tilesEqual(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.y === b.y
}

/** Stable string key for a tile. Used by pathfinding's visited set. */
export function tileKey(t: Tile): string {
  return `${t.x},${t.y}`
}

/**
 * The pixel a character stands on when occupying a tile.
 *
 * Horizontally centred, but vertically at the tile's **bottom edge** rather than its middle.
 * That is deliberate and load-bearing: character sprites are anchored at their feet (0.5, 1),
 * so a character "at" a tile has its feet on the tile's floor line. Anchoring to the tile
 * centre instead makes everyone appear to hover half a tile above the ground, and makes
 * depth-sorting against furniture wrong.
 */
export function tileToPixel(tile: Tile, tileSize: number): Pixel {
  return {
    x: tile.x * tileSize + tileSize / 2,
    y: tile.y * tileSize + tileSize,
  }
}

/** The tile containing a pixel position. Inverse of {@link tileToPixel}. */
export function pixelToTile(p: Pixel, tileSize: number): Tile {
  return {
    x: Math.floor(p.x / tileSize),
    // Subtract a hair before flooring: a character standing exactly on a tile's bottom edge
    // belongs to that tile, not the one below it.
    y: Math.floor((p.y - 0.0001) / tileSize),
  }
}

/**
 * Which way a character faces while moving along a vector.
 *
 * Nobody stores facing — it falls out of the movement itself, taking whichever axis dominates.
 * A stationary character keeps whatever it was facing, so this returns `null` for a zero
 * vector rather than inventing a direction.
 *
 * The vector is in **tile space**, or in anything proportional to it — which is what a walker's
 * position is. Not screen space, and under the isometric camera that distinction is the whole
 * question, because the obvious reading of `iso.ts` says this function is now wrong: a step
 * along tile +x lands down-*right* on screen, so surely +y should answer `left` rather than
 * `down`?
 *
 * It should not, and the reason is worth keeping. Project a cardinal step and it comes out
 * twice as wide as it is tall — that is what 2:1 means — so a screen-space rule takes the
 * horizontal every single time and all four axes collapse onto `left` and `right`. The
 * painter's front and back views would never be drawn again; you could no longer tell somebody
 * walking to the shelf from somebody walking to the manager's office, because both would be the
 * same profile; and the seated cast, who all face their desks, would turn side-on to a camera
 * they currently look straight into. So the four frames are read as the four floor axes instead
 * — 3/4-view characters standing on an isometric floor, which is what the genre does and what
 * makes the existing nine frames enough. Un-squash the floor and every axis sits exactly
 * halfway between two of the four frames, so which one names it is a convention and not a
 * measurement — and at eighteen pixels wide, where a front view and a 3/4 view differ by about
 * two pixels, it is not a convention the eye can catch us in.
 *
 * `test/floor.test.ts` pins the mapping against the projection, because the tempting fix is a
 * one-line change that looks more correct than it is.
 */
export function directionFromDelta(dx: number, dy: number): Direction | null {
  if (dx === 0 && dy === 0) return null
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

export function distance(a: Pixel, b: Pixel): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}
