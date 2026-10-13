/**
 * Running a routine — steps in, movement out.
 *
 * {@link Choreographer} decides *what* should happen and this decides *when it has happened*.
 * Keeping them apart means the interesting rules (a newer fact cancels an older depiction) are
 * testable as data, and the fiddly rules (arrival, pauses, blocked corridors) are testable
 * without a renderer. Neither half needs a GPU to prove.
 */

import { pixelToTile, type Tile } from './geometry.js'
import type { WalkGrid } from './grid.js'
import { findPathAdjacent } from './pathfinding.js'
import type { Walker } from './walker.js'
import type { Pose, Routine, StationRef, Step } from './choreography.js'

/** Turns a station into somewhere to stand. Backed by the floorplan. */
export interface Stations {
  resolve(ref: StationRef): Tile | null
}

export interface RunnerState {
  readonly routine: Routine | null
  readonly pose: Pose
  /**
   * A walk that could not be routed.
   *
   * Set when there is no path to a station — furniture boxed someone in, or the map is wrong.
   * The routine carries on to the next step rather than deadlocking, but the failure is
   * readable here instead of looking like a character that has decided to stand still.
   */
  readonly blocked: StationRef | null
}

export class RoutineRunner {
  private routine: Routine | null = null
  private stepIndex = 0
  private waitMs = 0
  private currentPose: Pose = 'idle'
  private blockedAt: StationRef | null = null

  constructor(
    private readonly walker: Walker,
    private grid: WalkGrid,
    private stations: Stations,
    /** Must match the floorplan the walker was built against. */
    private readonly tileSize: number,
  ) {}

  /**
   * Point at a new floorplan without dropping the routine in progress.
   *
   * The floor is re-laid whenever the workspace changes, and a character mid-walk when that
   * happens must not be abandoned partway across the room. Existing desks never move — the
   * floorplan guarantees that — but the grid object is new and may have tiles the old one did
   * not, so a walk in progress is re-routed from wherever the character actually is now.
   *
   * Only a walk needs re-routing. `pause` is a timer that should keep counting down rather than
   * restart, and `face` and `pose` already took effect when the step began.
   */
  retarget(grid: WalkGrid, stations: Stations): void {
    this.grid = grid
    this.stations = stations
    if (this.routine?.steps[this.stepIndex]?.kind === 'walk') this.beginStep()
  }

  get state(): RunnerState {
    return { routine: this.routine, pose: this.currentPose, blocked: this.blockedAt }
  }

  get isRunning(): boolean {
    return this.routine !== null
  }

  /**
   * Begin a routine, abandoning any in progress.
   *
   * Abandoning is the point, not a side effect. The choreographer only hands over a routine
   * once it has decided the new fact outranks the old one, so by the time it arrives here the
   * previous depiction is already out of date.
   */
  start(routine: Routine): void {
    this.routine = routine
    this.stepIndex = 0
    this.waitMs = 0
    this.blockedAt = null
    this.walker.stop()
    this.beginStep()
  }

  /**
   * Advance time. Returns true on the frame the routine completes.
   *
   * The walker gets ticked whatever the current step is, so a `pause` cannot strand a
   * character halfway between two tiles.
   */
  update(dt: number): boolean {
    const moving = this.walker.update(dt)
    if (!this.routine) return false

    const step = this.routine.steps[this.stepIndex]
    if (!step) return this.complete()

    switch (step.kind) {
      case 'walk':
        // A walk that could not be routed has already been marked blocked and left the walker
        // idle; treat it as done rather than waiting forever for an arrival that cannot come.
        if (this.blockedAt) return this.advance()
        if (moving.arrived || !this.walker.isMoving) return this.advance()
        return false

      case 'pause':
        this.waitMs -= dt * 1000
        return this.waitMs <= 0 ? this.advance() : false

      // `face` and `pose` take effect the instant the step begins, so there is nothing left to
      // wait for by the time we arrive here.
      case 'face':
      case 'pose':
        return this.advance()
    }
  }

  private advance(): boolean {
    this.stepIndex++
    if (this.stepIndex >= (this.routine?.steps.length ?? 0)) return this.complete()
    this.beginStep()
    return false
  }

  private complete(): boolean {
    this.routine = null
    return true
  }

  private beginStep(): void {
    const step: Step | undefined = this.routine?.steps[this.stepIndex]
    if (!step) return

    switch (step.kind) {
      case 'walk': {
        this.blockedAt = null
        const goal = this.stations.resolve(step.to)
        if (!goal) {
          this.blockedAt = step.to
          return
        }
        const from = clampToGrid(pixelToTile(this.walker.position, this.tileSize), this.grid)
        const path = findPathAdjacent(this.grid, from, goal)
        if (path === null) {
          this.blockedAt = step.to
          return
        }
        this.walker.setPath(path)
        return
      }
      case 'face':
        this.walker.facing = step.direction
        return
      case 'pause':
        this.waitMs = step.ms
        return
      case 'pose':
        this.currentPose = step.pose
        return
    }
  }
}

/**
 * Keep a tile inside the floor.
 *
 * A character nudged a fraction of a pixel out of bounds should path from the nearest real
 * tile, rather than have every walk from then on fail to route.
 */
function clampToGrid(tile: Tile, grid: WalkGrid): Tile {
  return {
    x: Math.min(Math.max(tile.x, 0), grid.width - 1),
    y: Math.min(Math.max(tile.y, 0), grid.height - 1),
  }
}
