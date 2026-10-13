/**
 * Render a contact sheet of the whole cast, scaled up, so a human can judge it.
 *
 *   npx tsx src/shared/character/cli/contact-sheet.ts out.png [names...]
 */

import { writeFileSync } from 'node:fs'
import { recipeFor } from '../recipe.js'
import { FRAME_H, FRAME_W, PAINT_DIRECTIONS, paintSheet } from '../painter.js'
import { encodePng } from '../png.js'

const out = process.argv[2] ?? 'cast.png'
const names =
  process.argv.slice(3).length > 0
    ? process.argv.slice(3)
    : ['manager', 'reviewer', 'builder', 'memory-keeper', 'tester', 'frontend', 'backend', 'designer']

const SCALE = 5
const PAD = 3
const BG = [0x12, 0x16, 0x1b, 0xff] as const

// One row per employee: 3 directions × 3 steps, laid out left to right.
const cols = PAINT_DIRECTIONS.length * 3
const cellW = FRAME_W + PAD
const cellH = FRAME_H + PAD
const sheetW = cols * cellW + PAD
const sheetH = names.length * cellH + PAD

const canvas = new Uint8ClampedArray(sheetW * sheetH * 4)
for (let i = 0; i < sheetW * sheetH; i++) {
  canvas[i * 4] = BG[0]
  canvas[i * 4 + 1] = BG[1]
  canvas[i * 4 + 2] = BG[2]
  canvas[i * 4 + 3] = BG[3]
}

names.forEach((name, row) => {
  const sheet = paintSheet(recipeFor(name))
  let col = 0
  for (const direction of PAINT_DIRECTIONS) {
    for (const frame of sheet.frames[direction]) {
      const ox = PAD + col * cellW
      const oy = PAD + row * cellH
      for (let y = 0; y < FRAME_H; y++) {
        for (let x = 0; x < FRAME_W; x++) {
          const s = (y * FRAME_W + x) * 4
          if (frame[s + 3] === 0) continue
          const d = ((oy + y) * sheetW + (ox + x)) * 4
          canvas[d] = frame[s]!
          canvas[d + 1] = frame[s + 1]!
          canvas[d + 2] = frame[s + 2]!
          canvas[d + 3] = 255
        }
      }
      col++
    }
  }
})

// Nearest-neighbour upscale — the whole point is to see individual pixels.
const bigW = sheetW * SCALE
const bigH = sheetH * SCALE
const big = new Uint8ClampedArray(bigW * bigH * 4)
for (let y = 0; y < bigH; y++) {
  for (let x = 0; x < bigW; x++) {
    const s = (Math.floor(y / SCALE) * sheetW + Math.floor(x / SCALE)) * 4
    const d = (y * bigW + x) * 4
    big[d] = canvas[s]!
    big[d + 1] = canvas[s + 1]!
    big[d + 2] = canvas[s + 2]!
    big[d + 3] = canvas[s + 3]!
  }
}

writeFileSync(out, encodePng(bigW, bigH, big))
console.log(`${out}  ${bigW}×${bigH}  ${names.length} employees × ${cols} frames`)
for (const n of names) {
  const r = recipeFor(n)
  console.log(`  ${n.padEnd(15)} ${r.hairStyle.padEnd(6)} ${r.accessory.padEnd(11)} ${r.slim ? 'slim' : 'reg'}`)
}
