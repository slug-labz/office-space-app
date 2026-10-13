/**
 * Character themes.
 *
 * Office Space ships one theme — characters drawn in code — and it always works, offline, on a
 * fresh clone, with no purchase and no download. That is the default and it is never the
 * fallback-of-shame.
 *
 * But a user who buys a commercial art pack should be able to use it. Most good pixel art
 * (LimeZu's included) permits commercial use and **forbids redistribution**, so we can never
 * ship those files — but nothing stops someone dropping their own licensed copy into their own
 * workspace. This interface is the seam that makes that possible without the rest of the app
 * knowing which theme it is talking to.
 *
 * The rule that keeps this honest: **a theme that fails to load is reported, never silently
 * swapped.** If someone installs an art pack and it does not work, they must be told why —
 * quietly rendering the procedural cast and letting them wonder is the exact "absent read as
 * empty" failure this project refuses to ship.
 */

import type { PaintDirection } from '../character/painter.js'

/** RGBA pixels, row-major, `width × height`. */
export type Pixels = Uint8ClampedArray

export interface CharacterFrames {
  readonly width: number
  readonly height: number
  /** `[direction][step]`. Three steps per direction; the renderer cycles them `[0,1,2,1]`. */
  readonly frames: Readonly<Record<PaintDirection, readonly Pixels[]>>
}

export interface CharacterTheme {
  /** Stable id. `procedural` is reserved for the built-in. */
  readonly id: string
  readonly name: string
  /** Shown in the UI wherever the theme is named. Required by most asset licences. */
  readonly credit: string | null
  /**
   * True when the theme's art may be redistributed with the project. Only ever true for the
   * built-in. Anything a user installs is theirs, stays on their machine, and is never
   * committed — the app surfaces this so nobody has to read a licence to know.
   */
  readonly redistributable: boolean

  /**
   * Paint one agent. Deterministic: the same inputs yield the same character every time.
   *
   * @param description the agent's own description, folded into the look so two agents whose
   *   names are close do not look close. Optional — a sheet-backed theme ignores it, and a
   *   hand-written agent file may not have one.
   */
  framesFor(agentName: string, description?: string): CharacterFrames
}

/** A theme that was found but could not be used. Always surfaced, never swallowed. */
export interface ThemeProblem {
  readonly themeId: string
  readonly path: string
  readonly reason: string
}

// There was a `ThemeSelection` here — `{ active, available, problems }` — referenced by nothing:
// not built, not imported, in no signature. Its docstring made a real promise ("someone who paid
// for art and dropped it in deserves an error, not a silent downgrade"), and that promise is kept
// by a different path: `ThemeRegistry.problems` collects the failures and `main.ts` folds them
// into the snapshot's `problems`, which the diagnosis panel reads.
//
// Deleted rather than left. A dead type carrying a live promise is the most expensive kind of
// dead code — it reads like the thing that keeps the promise, so the next person wires it up
// instead of the one that already works.
