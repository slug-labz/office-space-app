/**
 * Where character art comes from, and who gets blamed when it is wrong.
 *
 * Two sources converge here: the cast this app draws in code arrives as raw pixels, and an
 * installed pack arrives as a PNG, *"because decoding a PNG is something a browser does for a
 * living and the main process would have to be taught."* Nothing downstream knows which it got,
 * which is the point — one identity system, two views. Nothing was aimed at the module.
 *
 * ## The invariant with a victim
 *
 * A pack whose manifest points past the edge of its own sheet produces frames that are simply
 * blank. `fromSheet` refuses instead:
 *
 *     A manifest that points past the edge of its own image produces blank frames, and the art
 *     gets the blame. Say which it is.
 *
 * Somebody who has bought a pixel-art pack and installed it does not have the tools to tell
 * "this art is broken" from "this app cut it wrong", and the second is far more likely. Without
 * the check the office renders an empty room and says nothing.
 *
 * ## And a leak with no symptom
 *
 * `fromSheet` decodes the whole sheet once and crops each frame out of it. That whole-sheet
 * bitmap has to be closed on **both** paths — after the crops, and before the throw. A bitmap
 * leaked on the error path is leaked exactly when somebody is retrying with a different pack.
 *
 * ## The fakes
 *
 * `createImageBitmap` and `ImageData` are browser-only; Node has `Blob` and `Uint8ClampedArray`
 * already. The fake bitmap records how it was cropped, which is what makes it possible to assert
 * that the frames are lifted straight out of the sheet rather than through an intermediate
 * canvas — the thing the module says it does and the reason the arithmetic lives elsewhere.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toBitmaps } from '../src/renderer/sprites.js'
import { PAINT_DIRECTIONS, FRAMES_PER_DIRECTION } from '../src/shared/character/painter.js'
import type { SpriteSheet } from '../src/shared/ipc.js'

/** `exactOptionalPropertyTypes` is on, so an absent crop coordinate is spelled out. */
interface Crop {
  readonly from: 'blob' | 'bitmap'
  readonly x: number | undefined
  readonly y: number | undefined
  readonly width: number | undefined
  readonly height: number | undefined
}

interface Bitmaps {
  readonly crops: Crop[]
  readonly closed: string[]
  readonly install: (sheetWidth: number, sheetHeight: number) => void
  readonly restore: () => void
}

function fakeBitmaps(): Bitmaps {
  const crops: Crop[] = []
  const closed: string[] = []
  const g = globalThis as unknown as Record<string, unknown>
  const before = { createImageBitmap: g['createImageBitmap'], ImageData: g['ImageData'] }

  return {
    crops,
    closed,
    install: (sheetWidth, sheetHeight) => {
      g['ImageData'] = class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      }
      g['createImageBitmap'] = (source: unknown, x?: number, y?: number, w?: number, h?: number) => {
        const fromBlob = typeof Blob !== 'undefined' && source instanceof Blob
        crops.push({ from: fromBlob ? 'blob' : 'bitmap', x, y, width: w, height: h })
        const label = fromBlob ? 'whole' : `${x},${y}`
        return Promise.resolve({
          // The whole sheet reports the size the test asked for; a crop reports its own.
          width: w ?? sheetWidth,
          height: h ?? sheetHeight,
          close: () => closed.push(label),
        })
      }
    },
    restore: () => {
      g['createImageBitmap'] = before.createImageBitmap
      g['ImageData'] = before.ImageData
    },
  }
}

const painted = (): SpriteSheet => ({
  kind: 'painted',
  width: 16,
  height: 24,
  frames: Object.fromEntries(
    PAINT_DIRECTIONS.map((d) => [d, Array.from({ length: FRAMES_PER_DIRECTION }, () => new Uint8ClampedArray(16 * 24 * 4))]),
  ) as never,
})

const pack = (over: Partial<Extract<SpriteSheet, { kind: 'sheet' }>> = {}): SpriteSheet => ({
  kind: 'sheet',
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  frameWidth: 16,
  frameHeight: 24,
  rows: Object.fromEntries(PAINT_DIRECTIONS.map((d, i) => [d, i])) as never,
  steps: [0, 1, 2],
  ...over,
})

test('the drawn cast becomes one bitmap per frame, per direction', async () => {
  const fake = fakeBitmaps()
  fake.install(48, 72)
  try {
    const art = await toBitmaps(painted())

    for (const direction of PAINT_DIRECTIONS) {
      assert.equal(
        art[direction].length,
        FRAMES_PER_DIRECTION,
        `${direction} came back with ${art[direction].length} frames instead of ${FRAMES_PER_DIRECTION}`,
      )
    }
    // The control: pixels go through ImageData, never through a Blob — that path is for packs.
    assert.ok(fake.crops.length > 0, 'nothing was decoded at all')
    assert.equal(fake.crops.every((c) => c.from === 'bitmap'), true, 'the painted path decoded a Blob, which is the pack path')
  } finally {
    fake.restore()
  }
})

test('a pack is cropped straight out of one decode, not through a canvas', async () => {
  const fake = fakeBitmaps()
  fake.install(48, 72)
  try {
    await toBitmaps(pack())

    const whole = fake.crops.filter((c) => c.from === 'blob')
    assert.equal(whole.length, 1, `the sheet was decoded ${whole.length} times — it should be decoded once and cropped`)

    const frames = fake.crops.filter((c) => c.from === 'bitmap')
    assert.equal(
      frames.length,
      PAINT_DIRECTIONS.length * FRAMES_PER_DIRECTION,
      'the number of crops does not match the number of frames',
    )
    // Every crop is a real rectangle with a position, which is what "lifted out of the sheet"
    // means. A crop with no coordinates is a full-size copy.
    assert.equal(
      frames.every((c) => c.width === 16 && c.height === 24 && c.x !== undefined && c.y !== undefined),
      true,
      `some crops are not frame-sized rectangles: ${JSON.stringify(frames.slice(0, 3))}`,
    )
  } finally {
    fake.restore()
  }
})

test('a manifest that points past its own sheet says so, rather than drawing blanks', async () => {
  const fake = fakeBitmaps()
  // The sheet is far too small for the frames the manifest describes.
  fake.install(8, 8)
  try {
    await assert.rejects(
      () => toBitmaps(pack()),
      (error: Error) => {
        assert.match(
          error.message,
          /manifest/i,
          `the error does not say the manifest is the problem, so the art takes the blame: ${error.message}`,
        )
        return true
      },
      'a pack whose manifest overruns its sheet was accepted, and every frame it produces is blank',
    )
  } finally {
    fake.restore()
  }
})

test('the whole-sheet bitmap is closed on both paths', async () => {
  const good = fakeBitmaps()
  good.install(48, 72)
  try {
    await toBitmaps(pack())
    assert.ok(good.closed.includes('whole'), 'the decoded sheet was never closed after cropping')
  } finally {
    good.restore()
  }

  const bad = fakeBitmaps()
  bad.install(8, 8)
  try {
    await toBitmaps(pack()).catch(() => {})
    assert.ok(
      bad.closed.includes('whole'),
      'the decoded sheet was leaked on the error path — which is exactly when somebody is ' +
        'retrying with a different pack, so it leaks once per attempt',
    )
  } finally {
    bad.restore()
  }
})
