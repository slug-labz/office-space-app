/**
 * Fitting a name into the space a desk owns.
 *
 * Lives here rather than in the renderer so it can be tested: the root `tsconfig` excludes
 * `src/renderer`, so anything left in `floor-view.ts` cannot be reached by a test at all. This
 * is pure string arithmetic and there is no reason for it to be unreachable.
 *
 * The rule it exists to keep: **a name may never be wider than the desk it belongs to.** Desks
 * sit `DESK_PITCH_X` tiles apart, so a name wider than that does not spill into empty space —
 * it lands on the person standing at the next desk, and two half-legible names are worse than
 * one honestly truncated one.
 */

/** Width of a string in pixels. Supplied by the canvas at runtime, by a stub in tests. */
export type Measure = (text: string) => number

/**
 * The longest prefix of `text` that fits `max` pixels, with an ellipsis when it had to cut.
 *
 * Returns `'…'` rather than an empty string when nothing fits: a character with no label at all
 * reads as a character the office does not know the name of, which is a different and untrue
 * claim.
 */
export function ellipsise(text: string, max: number, measure: Measure): string {
  if (max <= 0) return '…'
  if (measure(text) <= max) return text

  // Linear from the end rather than a bisection: names are short, and a binary search here
  // would be more code than the thing it speeds up.
  for (let n = text.length - 1; n > 0; n--) {
    const cut = `${text.slice(0, n)}…`
    if (measure(cut) <= max) return cut
  }
  return '…'
}

/** Room kept clear on either side of a name for the working dot and the outcome mark. */
export const LABEL_MARKS = 10

/**
 * How wide a name may be drawn, given the tile pitch between desks.
 *
 * The guarantee: two adjacent labels, each centred on its own desk, are left at least
 * `LABEL_MARKS` pixels apart — so they cannot touch, whatever the names are.
 */
export function labelWidthFor(deskPitchPx: number): number {
  return Math.max(0, deskPitchPx - LABEL_MARKS)
}
