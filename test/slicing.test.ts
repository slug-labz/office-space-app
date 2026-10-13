/**
 * Cutting a character out of an art pack.
 *
 * The arithmetic that says where each frame is. Worth testing because getting it wrong looks
 * like bad art rather than a bad calculation — everybody walks sideways, or half of one
 * character is stitched to half of another, and the pack gets the blame.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fits, frameRects, sheetIndexFor, type SheetLayout } from '../src/shared/theme/slicing.js'

const layout: SheetLayout = {
  frameWidth: 16,
  frameHeight: 32,
  rows: { down: 0, up: 1, right: 2 },
  steps: [0, 1, 2],
}

test('each facing is a row and each step a column', () => {
  const rects = frameRects(layout)

  assert.deepEqual(rects.down[0], { x: 0, y: 0, width: 16, height: 32 })
  assert.deepEqual(rects.down[2], { x: 32, y: 0, width: 16, height: 32 })
  assert.deepEqual(rects.up[0], { x: 0, y: 32, width: 16, height: 32 })
  assert.deepEqual(rects.right[1], { x: 16, y: 64, width: 16, height: 32 })
})

test('a pack whose rows and steps are in an unusual order is followed, not corrected', () => {
  // No two packs agree on this, which is exactly why the manifest says it.
  const odd: SheetLayout = { ...layout, rows: { down: 3, up: 0, right: 5 }, steps: [4, 0, 8] }

  const rects = frameRects(odd)

  assert.deepEqual(rects.down[0], { x: 64, y: 96, width: 16, height: 32 })
  assert.deepEqual(rects.right[2], { x: 128, y: 160, width: 16, height: 32 })
})

test('only the three painted directions are asked for — left is right, mirrored', () => {
  assert.deepEqual(Object.keys(frameRects(layout)).sort(), ['down', 'right', 'up'])
})

// ─────────────────────────────────────────────────────── which sheet is whose ──

test('the same name gets the same sheet, every time', () => {
  assert.equal(sheetIndexFor('reviewer', 4), sheetIndexFor('reviewer', 4))
  assert.equal(sheetIndexFor('Reviewer  ', 4), sheetIndexFor('reviewer', 4), 'and is not fooled by case or spaces')
})

test('different names generally get different sheets', () => {
  const names = ['manager', 'reviewer', 'builder', 'tester', 'frontend', 'backend']
  const chosen = new Set(names.map((n) => sheetIndexFor(n, 6)))

  assert.ok(chosen.size >= 3, `a room of six drew only ${chosen.size} distinct sheets`)
})

test('a pack with one sheet gives everybody the same face, which is the pack’s decision', () => {
  assert.equal(sheetIndexFor('reviewer', 1), 0)
  assert.equal(sheetIndexFor('builder', 1), 0)
})

test('a pack with no sheets does not divide by zero', () => {
  assert.equal(sheetIndexFor('reviewer', 0), 0)
})

// ──────────────────────────────────────────────── a manifest that overreaches ──

test('a sheet big enough for its layout is fine', () => {
  assert.equal(fits(layout, 48, 96), null)
})

test('a manifest pointing past the edge of its own image says so', () => {
  // Otherwise the frames come out blank or partly somebody else, and the art gets the blame.
  const problem = fits(layout, 32, 96)

  assert.match(problem ?? '', /needs at least 48×96/)
  assert.match(problem ?? '', /is 32×96/)
})

test('the check accounts for the highest row and column actually used', () => {
  const sparse: SheetLayout = { ...layout, rows: { down: 0, up: 1, right: 9 }, steps: [0, 1, 2] }

  assert.match(fits(sparse, 48, 96) ?? '', /needs at least 48×320/)
})
