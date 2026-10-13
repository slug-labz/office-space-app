/**
 * Character art, decoded once, for everywhere it is shown.
 *
 * Lifted out of `floor-view.ts` because the floor stopped being the only place an agent has a
 * face. F5's aim is *"characters legible as this agent"* and F1c's is *"the same procedural
 * character that is on the floor as the avatar"* — one identity system, two views. Two decoders
 * would be two identity systems that happen to agree today.
 *
 * The decode itself is unchanged and so are its two reasons: the drawn cast arrives as pixels
 * and an installed pack arrives as a file, because decoding a PNG is something a browser does
 * for a living and the main process would have to be taught. They converge in `toBitmaps`, and
 * nothing downstream knows which theme it is drawing.
 */

import { PAINT_DIRECTIONS, type PaintDirection } from '../shared/character/painter.js'
import { fits, frameRects } from '../shared/theme/slicing.js'
import type { SpriteSheet } from '../shared/ipc.js'

/**
 * Whatever the main process sent, as bitmaps the canvas can blit.
 *
 * The drawn cast arrives as pixels and an installed pack arrives as a file, because decoding a
 * PNG is something a browser does for a living and the main process would have to be taught.
 * They converge here, and nothing downstream knows which theme it is drawing.
 */
export async function toBitmaps(sheet: SpriteSheet): Promise<Record<PaintDirection, ImageBitmap[]>> {
  return sheet.kind === 'painted' ? await fromPixels(sheet) : await fromSheet(sheet)
}

async function fromPixels(
  sheet: Extract<SpriteSheet, { kind: 'painted' }>,
): Promise<Record<PaintDirection, ImageBitmap[]>> {
  const out = {} as Record<PaintDirection, ImageBitmap[]>
  for (const [direction, frames] of Object.entries(sheet.frames)) {
    out[direction as PaintDirection] = await Promise.all(
      frames.map((pixels) =>
        // Structured cloning preserves the typed-array kind, but a copy costs nothing and the
        // ImageData constructor is unforgiving about it.
        createImageBitmap(new ImageData(new Uint8ClampedArray(pixels), sheet.width, sheet.height)),
      ),
    )
  }
  return out
}

/**
 * Cut one character out of a pack's sheet.
 *
 * `createImageBitmap` crops as it decodes, so each frame is lifted straight out of the sheet
 * without an intermediate canvas. Where the frames are is arithmetic, and lives in
 * `shared/theme/slicing.ts` where it can be tested.
 */
async function fromSheet(
  sheet: Extract<SpriteSheet, { kind: 'sheet' }>,
): Promise<Record<PaintDirection, ImageBitmap[]>> {
  const whole = await createImageBitmap(new Blob([sheet.png as BlobPart], { type: 'image/png' }))

  const layout = {
    frameWidth: sheet.frameWidth,
    frameHeight: sheet.frameHeight,
    rows: sheet.rows,
    steps: sheet.steps,
  }

  // A manifest that points past the edge of its own image produces blank frames, and the art
  // gets the blame. Say which it is.
  const tooSmall = fits(layout, whole.width, whole.height)
  if (tooSmall) {
    whole.close()
    throw new Error(`this pack's sheet does not match its manifest — ${tooSmall}`)
  }

  const rects = frameRects(layout)
  const out = {} as Record<PaintDirection, ImageBitmap[]>

  for (const direction of PAINT_DIRECTIONS) {
    out[direction] = await Promise.all(
      rects[direction].map((r) => createImageBitmap(whole, r.x, r.y, r.width, r.height)),
    )
  }

  whole.close()
  return out
}
