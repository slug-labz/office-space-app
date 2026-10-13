/**
 * Cutting a character out of an art pack.
 *
 * A pack is a grid: one row per facing, one column per walk step. The manifest says which row
 * is which and which columns are the steps, because no two packs agree on that and guessing
 * would mean everybody walks sideways.
 *
 * This module works out *where* each frame is. It does not decode anything — the renderer does
 * that, because a browser decodes PNG natively and writing a decoder in the main process would
 * be inventing work. Keeping the arithmetic here means the part that can be wrong is the part
 * that can be tested.
 */

import { hash } from '../character/recipe.js'
import { PAINT_DIRECTIONS, type PaintDirection } from '../character/painter.js'

/** A rectangle in a sheet, in pixels. */
export interface FrameRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface SheetLayout {
  readonly frameWidth: number
  readonly frameHeight: number
  readonly rows: Readonly<Record<PaintDirection, number>>
  readonly steps: readonly [number, number, number]
}

/**
 * Which sheet an agent gets.
 *
 * The same hash the drawn cast uses, so the property that makes that cast work holds here too:
 * the same name is the same person on every machine, forever, with nobody keeping a list. A
 * pack with one sheet gives everybody the same face, which is the pack's decision and not ours
 * to correct.
 */
export function sheetIndexFor(agentName: string, sheets: number): number {
  if (sheets <= 0) return 0
  return hash(agentName.trim().toLowerCase()) % sheets
}

/**
 * Where every frame sits in the sheet.
 *
 * Three directions, three steps each; `left` is `right` mirrored at draw time, which is why no
 * pack needs to supply it and why asking for it here would be asking for something that is not
 * there.
 */
export function frameRects(layout: SheetLayout): Record<PaintDirection, FrameRect[]> {
  const rects = {} as Record<PaintDirection, FrameRect[]>

  for (const direction of PAINT_DIRECTIONS) {
    const row = layout.rows[direction]
    rects[direction] = layout.steps.map((column) => ({
      x: column * layout.frameWidth,
      y: row * layout.frameHeight,
      width: layout.frameWidth,
      height: layout.frameHeight,
    }))
  }

  return rects
}

/**
 * Whether a sheet is big enough for the layout it claims.
 *
 * A manifest that points past the edge of its own image produces frames that are blank or
 * partly somebody else, and the failure looks like bad art rather than a bad manifest. Checking
 * turns a mystery into a sentence.
 */
export function fits(layout: SheetLayout, sheetWidth: number, sheetHeight: number): string | null {
  const columns = Math.max(...layout.steps) + 1
  const rows = Math.max(layout.rows.down, layout.rows.up, layout.rows.right) + 1

  const needWidth = columns * layout.frameWidth
  const needHeight = rows * layout.frameHeight

  if (sheetWidth < needWidth || sheetHeight < needHeight) {
    return `the layout needs at least ${needWidth}×${needHeight} and the sheet is ${sheetWidth}×${sheetHeight}`
  }
  return null
}
