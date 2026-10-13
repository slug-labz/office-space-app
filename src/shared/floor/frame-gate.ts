/**
 * When to draw, and when to stop drawing.
 *
 * An office at rest is a still picture, and repainting it sixty times a second for as long as
 * the app is open is the charter's first budget broken — *zero draw calls while nothing
 * changes*. It is also what decides whether a campus of N offices is affordable, because N idle
 * offices have to cost nothing rather than N times something.
 *
 * This lives outside the renderer for a reason that is not tidiness. The dangerous half of
 * parking a loop is **failing to restart it** — a floor frozen on a stale picture is a worse
 * failure than the waste it replaced, and it is invisible until somebody notices the office has
 * stopped reacting. That transition has to be tested, and it cannot be: the root `tsconfig`
 * excludes `src/renderer`, and the preview harness cannot help either, because a hidden page
 * throttles `requestAnimationFrame` to nothing — an attempt to measure this through the browser
 * reported a perfect result while actually measuring the throttle.
 *
 * So the decision is a state machine here, with the canvas nowhere near it.
 */
export class FrameGate {
  private dirty = true
  private parked = false
  private drawn = 0

  /**
   * One frame has come round. `moved` is whether anything on screen actually changed.
   *
   * Returns whether to draw. When it returns false the gate has **parked**: the caller must
   * stop requesting frames, and {@link invalidate} is the only thing that will start it again.
   */
  frame(moved: boolean): boolean {
    if (moved || this.dirty) {
      this.dirty = false
      this.drawn++
      return true
    }
    this.parked = true
    return false
  }

  /**
   * Something changed that a frame cannot see for itself — new facts, a new roster, a resize.
   *
   * Returns true when the loop was parked and the caller must start requesting frames again.
   * **Every mutator calls this.** One that does not is a change nobody draws.
   */
  invalidate(): boolean {
    this.dirty = true
    if (!this.parked) return false
    this.parked = false
    return true
  }

  /** Torn down, rather than resting. A stopped gate is not woken by `invalidate`. */
  stop(): void {
    this.parked = false
    this.dirty = true
  }

  get isParked(): boolean {
    return this.parked
  }

  /** Frames actually drawn, so the idle budget can be asserted rather than asserted at. */
  get framesDrawn(): number {
    return this.drawn
  }
}
