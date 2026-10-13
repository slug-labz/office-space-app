/**
 * The two clocks that tick when nothing has happened, and the budget they have to stay inside.
 *
 * `FrameGate` decides *whether* to draw once something has changed. This decides how often
 * anything changes in an office where nobody is doing anything — which is the other half of the
 * same budget and the half that is easy to blow by accident. A cat that repositions itself every
 * frame is a floor that never parks, and the gate will dutifully draw every one of those frames
 * because it was told something moved.
 *
 * It lives here rather than in `floor-view.ts` for the reason that file's own header gives about
 * `FrameGate`: the root `tsconfig` excludes `src/renderer`, so a constant declared there is a
 * constant no test can reach. The exit condition is *an idle office draws ≤ 2 frames per second*,
 * asserted rather than assumed, and an assertion needs something importable to assert about.
 */

/**
 * How often the cat moves.
 *
 * Quantised on purpose: the pose changes once every seven seconds, so an idle office pays for
 * one frame every seven seconds rather than sixty every second. Long enough to be within budget
 * by two orders of magnitude, short enough that a room with a cat in it is not a photograph.
 */
export const PET_SETTLE_MS = 7_000

/**
 * How long one keystroke is held.
 *
 * An agent that is working should be shown typing. Two things make that
 * safe to draw. It is bound to `pose === 'working'`, which is set by a routine, which is set by
 * a fact — so a character types when and only when there is a live tool call behind them, and
 * an office with nothing happening in it shows nobody typing. And it is quantised, like the
 * cat: at 220 ms a hand moves between two positions about four times a second, which is a
 * legible typing rhythm and four frames rather than sixty.
 */
export const KEYSTROKE_MS = 220

/** The exit condition, as a number. An idle office may not draw more often than this. */
export const IDLE_BUDGET_FPS = 2

export interface Beats {
  /** Which seven-second bucket the cat is in. */
  readonly pet: number
  /** Which half of a keystroke the typing hands are in, or 0 when nobody is typing. */
  readonly key: number
}

/**
 * The beats at a given point on the office clock.
 *
 * Pure and total: given the same clock and the same answer to "is anybody working", it gives
 * the same beats. That is what lets a test run ten simulated seconds and count the changes
 * rather than watch a canvas and hope.
 */
export function beatsAt(clockMs: number, anybodyWorking: boolean): Beats {
  return {
    pet: Math.floor(clockMs / PET_SETTLE_MS),
    key: anybodyWorking ? Math.floor(clockMs / KEYSTROKE_MS) % 2 : 0,
  }
}

/**
 * How many frames an office draws over `seconds`, given nothing happens in it.
 *
 * Counts *changes*, which is what the frame gate turns into draws. Exported because the number
 * is the point: a change to either constant that pushes an idle office over the budget should
 * fail a test rather than be discovered in somebody's fan noise.
 */
export function idleDraws(seconds: number, frameMs = 1000 / 60): number {
  let clock = 0
  let last = beatsAt(0, false)
  let draws = 0

  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += frameMs) {
    clock += frameMs
    const next = beatsAt(clock, false)
    if (next.pet !== last.pet || next.key !== last.key) {
      draws += 1
      last = next
    }
  }

  return draws
}
