/**
 * Pathfinding across the office floor.
 *
 * Breadth-first search, four-neighbour, no diagonals. On a grid this small with uniform move
 * cost, BFS is optimal and finishes in microseconds — A* would add a heuristic, a priority
 * queue, and a tie-breaking bug, and buy nothing. If floors ever get large enough to matter,
 * this is the file to revisit, and the signature will not have to change.
 */

import { NEIGHBOUR_OFFSETS, tileKey, tilesEqual, type Tile } from './geometry.js'
import type { WalkGrid } from './grid.js'

/**
 * Shortest walkable path from `start` to `goal`.
 *
 * Returns the tiles to walk through, **excluding** `start` and **including** `goal`. An empty
 * array means you are already there. `null` means there is no route — which is a real answer
 * the caller must handle, not an error and not an empty path. Those three outcomes are
 * genuinely different and collapsing them is how a character ends up frozen at a desk while
 * the UI insists it is walking.
 */
export function findPath(grid: WalkGrid, start: Tile, goal: Tile): Tile[] | null {
  if (tilesEqual(start, goal)) return []
  if (!grid.isWalkable(goal.x, goal.y)) return null
  if (!grid.isWalkable(start.x, start.y)) return null

  const visited = new Set<string>([tileKey(start)])
  const cameFrom = new Map<string, Tile>()

  // A plain array with a head index. `Array.shift()` is O(n) and turns BFS quadratic on
  // larger floors; moving a cursor instead keeps it linear.
  const queue: Tile[] = [start]
  let head = 0

  while (head < queue.length) {
    const current = queue[head++]!

    for (const offset of NEIGHBOUR_OFFSETS) {
      const next: Tile = { x: current.x + offset.x, y: current.y + offset.y }
      const key = tileKey(next)

      if (visited.has(key)) continue
      if (!grid.isWalkable(next.x, next.y)) continue

      visited.add(key)
      cameFrom.set(key, current)

      if (tilesEqual(next, goal)) return reconstruct(cameFrom, start, goal)

      queue.push(next)
    }
  }

  return null
}

function reconstruct(cameFrom: Map<string, Tile>, start: Tile, goal: Tile): Tile[] {
  const path: Tile[] = []
  let current = goal

  while (!tilesEqual(current, start)) {
    path.unshift(current)
    const previous = cameFrom.get(tileKey(current))
    // Cannot happen — every tile reached was recorded on the way in. Guard anyway rather than
    // risk an infinite loop if that invariant is ever broken by a future edit.
    if (!previous) return path
    current = previous
  }

  return path
}

/**
 * The reachable tile closest to `goal`, when `goal` itself cannot be stood on.
 *
 * Walking *to* a desk means walking to a tile beside it. Rather than making every caller
 * special-case that, this finds the nearest tile that is both walkable and reachable.
 * Returns `null` if nothing near the goal can be reached at all.
 */
export function findPathAdjacent(grid: WalkGrid, start: Tile, goal: Tile): Tile[] | null {
  const direct = findPath(grid, start, goal)
  if (direct !== null) return direct

  let best: { path: Tile[]; distance: number } | null = null

  for (const offset of NEIGHBOUR_OFFSETS) {
    const candidate: Tile = { x: goal.x + offset.x, y: goal.y + offset.y }
    if (!grid.isWalkable(candidate.x, candidate.y)) continue

    const path = findPath(grid, start, candidate)
    if (path === null) continue

    if (best === null || path.length < best.distance) {
      best = { path, distance: path.length }
    }
  }

  return best?.path ?? null
}
