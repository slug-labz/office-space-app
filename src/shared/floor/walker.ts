/**
 * Locomotion.
 *
 * A `Walker` knows where it is, where it is going, and which way it is facing. It knows
 * nothing about sprites, Pixi, agents, or why it was asked to go somewhere — that separation
 * is the point. Movement is arithmetic, and arithmetic can be tested without a GPU.
 *
 * The renderer reads `position` and `facing` each frame and draws whatever art it has. The
 * floor controller decides what happens on arrival. Neither concern leaks in here.
 */

import {
  directionFromDelta,
  distance,
  tileToPixel,
  type Direction,
  type Pixel,
  type Tile,
} from './geometry.js'

/** Default walking pace. 48 px/sec against 16px tiles is three tiles a second. */
export const DEFAULT_SPEED = 48

/** How close counts as arrived, in pixels. Below this we snap, to avoid an asymptotic crawl. */
const ARRIVAL_EPSILON = 0.5

export interface WalkerOptions {
  readonly tileSize: number
  /** Pixels per second. */
  readonly speed?: number
  readonly facing?: Direction
}

/** What happened during one update. */
export interface WalkerUpdate {
  /** True on the single frame the walker finishes its path. */
  readonly arrived: boolean
  /** True if the walker moved at all this frame. */
  readonly moved: boolean
}

export class Walker {
  position: Pixel
  facing: Direction

  private readonly tileSize: number
  private readonly speed: number
  private path: Tile[] = []

  constructor(start: Tile, options: WalkerOptions) {
    this.tileSize = options.tileSize
    this.speed = options.speed ?? DEFAULT_SPEED
    this.facing = options.facing ?? 'down'
    this.position = tileToPixel(start, options.tileSize)
  }

  get isMoving(): boolean {
    return this.path.length > 0
  }

  /** Tiles still to be walked, in order. */
  get remainingPath(): readonly Tile[] {
    return this.path
  }

  /**
   * Send the walker along a path.
   *
   * Replaces any path in progress — a character redirected mid-stride abandons where it was
   * going, which is what you want when work arrives while it is wandering to the coffee
   * machine. An empty path means "you are already there" and completes on the next update.
   */
  setPath(path: readonly Tile[]): void {
    this.path = [...path]
  }

  /** Stop where you are. Does not fire an arrival. */
  stop(): void {
    this.path = []
  }

  /** Place the walker directly, cancelling any path. Used for spawning. */
  teleport(tile: Tile): void {
    this.position = tileToPixel(tile, this.tileSize)
    this.path = []
  }

  /**
   * Advance by `dt` seconds.
   *
   * The movement budget is consumed across as many waypoints as it reaches, rather than one
   * waypoint per frame. That matters whenever `dt` spikes — a backgrounded window, a slow
   * frame, a debugger pause — where a one-waypoint-per-frame walker visibly stutters and
   * falls behind. Because the budget is spent along the path rather than as a straight line
   * toward the destination, a character can never cut a corner through a wall.
   */
  update(dt: number): WalkerUpdate {
    if (this.path.length === 0) return { arrived: false, moved: false }

    let budget = this.speed * Math.max(0, dt)
    let moved = false

    while (budget > 0 && this.path.length > 0) {
      const target = tileToPixel(this.path[0]!, this.tileSize)
      const remaining = distance(this.position, target)

      if (remaining <= ARRIVAL_EPSILON) {
        this.position = target
        this.path.shift()
        moved = true
        continue
      }

      const step = Math.min(budget, remaining)
      const dx = target.x - this.position.x
      const dy = target.y - this.position.y

      this.position = {
        x: this.position.x + (dx / remaining) * step,
        y: this.position.y + (dy / remaining) * step,
      }

      // Facing is derived, never stored independently — it is always consistent with the
      // direction of travel because it is computed from it.
      const heading = directionFromDelta(dx, dy)
      if (heading) this.facing = heading

      budget -= step
      moved = true

      if (step >= remaining) {
        this.position = target
        this.path.shift()
      }
    }

    return { arrived: moved && this.path.length === 0, moved }
  }
}
