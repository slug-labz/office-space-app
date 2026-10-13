/**
 * The walkability grid.
 *
 * A tile is walkable or it is not. Everything about the office layout that movement cares
 * about reduces to this one question, which is why pathfinding takes a `WalkGrid` rather than
 * a map, a tileset, or a renderer.
 */

import type { Tile } from './geometry.js'

export class WalkGrid {
  readonly width: number
  readonly height: number
  /** Row-major, `width * height`. True means a character may stand here. */
  private readonly cells: Uint8Array

  private constructor(width: number, height: number, cells: Uint8Array) {
    this.width = width
    this.height = height
    this.cells = cells
  }

  /** An empty floor — every tile walkable. Useful for tests and for a floor with no walls yet. */
  static open(width: number, height: number): WalkGrid {
    return new WalkGrid(width, height, new Uint8Array(width * height).fill(1))
  }

  /**
   * Build from a collision layer, where a non-zero tile id means "blocked".
   *
   * This is the shape Tiled exports: a flat array of tile ids, row-major, `0` for an empty
   * cell. Anything non-zero is furniture, a wall, or scenery, and cannot be stood on.
   */
  static fromCollisionLayer(width: number, height: number, data: readonly number[]): WalkGrid {
    const cells = new Uint8Array(width * height)
    for (let i = 0; i < cells.length; i++) {
      cells[i] = data[i] ? 0 : 1
    }
    return new WalkGrid(width, height, cells)
  }

  /** Build from an explicit boolean grid, `rows[y][x]`. */
  static fromRows(rows: readonly (readonly boolean[])[]): WalkGrid {
    const height = rows.length
    const width = height > 0 ? (rows[0]?.length ?? 0) : 0
    const cells = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      const row = rows[y]
      for (let x = 0; x < width; x++) {
        cells[y * width + x] = row?.[x] ? 1 : 0
      }
    }
    return new WalkGrid(width, height, cells)
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  isWalkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false
    return this.cells[y * this.width + x] === 1
  }

  /**
   * Force a tile walkable.
   *
   * Seats are the reason this exists. A chair is drawn as furniture and so lands in the
   * collision layer, but a character has to be able to path *onto* it to sit down. The floor
   * loader carves out every seat tile after building the grid.
   */
  setWalkable(x: number, y: number, walkable: boolean): void {
    if (!this.inBounds(x, y)) return
    this.cells[y * this.width + x] = walkable ? 1 : 0
  }

  /** Every walkable tile. Used to pick wander targets. */
  walkableTiles(): Tile[] {
    const out: Tile[] = []
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells[y * this.width + x] === 1) out.push({ x, y })
      }
    }
    return out
  }

  /** Count of walkable tiles — cheap sanity check that a loaded map isn't entirely blocked. */
  get walkableCount(): number {
    let n = 0
    for (const c of this.cells) if (c === 1) n++
    return n
  }
}
