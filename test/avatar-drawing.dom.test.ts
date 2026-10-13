/**
 * What an avatar does once the art actually arrives.
 *
 * `avatar.dom.test.ts` covers the cache, and says plainly how it manages that: *"The art never
 * arrives here on purpose: `sprites()` rejects"*, under a heading reading *"How this is checked
 * without a canvas"*. That was true when it was written. The harness has since grown
 * `createImageBitmap` and a recording 2D context, so the other half — the blit itself — is
 * reachable now and this is it.
 *
 * ## The rule that is invisible when it breaks
 *
 *     Fit the frame inside the square without stretching it: character art is taller than it is
 *     wide, and a squashed face is less recognisable than a smaller one.
 *
 * A stretched avatar is not a crash and not a blank; it is the right person, slightly wrong, in
 * every list in the app. Nobody files that — they just stop using the faces to tell people
 * apart, which is the entire reason F5 asked for characters "legible as this agent".
 *
 * The same goes for smoothing. This is 8-bit art at roughly 16x24, and *"scaling that up with
 * the default smoothing turns a face into a smudge"*.
 *
 * ## What this does not claim
 *
 * Nothing about pixels. The context records calls and draws nothing, so a claim about how the
 * face *looks* would be a claim about the fake. What is answerable is the geometry the module
 * chose and the settings it asked for — decisions, not images.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { avatar, forgetFaces, type AvatarSource } from '../src/renderer/views/avatar.js'
import type { SpriteSheet } from '../src/shared/ipc.js'

installDom()

/** Taller than it is wide, like every character in this app — which is what makes fit matter. */
const FRAME_W = 16
const FRAME_H = 24

const sheet = (): SpriteSheet => {
  const pixels = new Uint8ClampedArray(FRAME_W * FRAME_H * 4)
  return { kind: 'painted', width: FRAME_W, height: FRAME_H, frames: { down: [pixels], up: [pixels], right: [pixels] } }
}

function source(over: Partial<AvatarSource> = {}): AvatarSource {
  return {
    sprites: () => Promise.resolve(sheet()),
    themeId: () => 'a-theme',
    manager: () => 'manager',
    describe: () => 'the reviewer',
    ...over,
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]
const canvasIn = (wrap: El): El | undefined => all(wrap).find((n) => n.tag === 'canvas')

interface Call {
  readonly method: string
  readonly args: readonly unknown[]
}
const contextOf = (canvas: El): { calls: Call[] } & Record<string, unknown> =>
  (canvas as unknown as { getContext: (k: string) => { calls: Call[] } & Record<string, unknown> }).getContext('2d')

test('the initial gives way to the art once it arrives', async () => {
  forgetFaces()
  const wrap = avatar('reviewer', 32, source()) as unknown as El
  assert.match(wrap.textContent ?? '', /R/, 'the placeholder initial is missing, so the row lays out around nothing')

  await settle()

  const canvas = canvasIn(wrap)
  assert.ok(canvas, 'the art arrived and was never drawn — the avatar is still a letter')
  assert.equal(
    /R/.test(wrap.textContent ?? ''),
    false,
    'the initial was left behind the canvas rather than replaced, so both are in the same box',
  )
})

test('the face is fitted, not stretched', async () => {
  forgetFaces()
  const wrap = avatar('reviewer', 32, source()) as unknown as El
  await settle()

  const canvas = canvasIn(wrap)
  assert.ok(canvas, 'nothing was drawn')
  const draw = contextOf(canvas).calls.find((c) => c.method === 'drawImage')
  assert.ok(draw, `drawImage was never called: ${JSON.stringify(contextOf(canvas).calls.map((c) => c.method))}`)

  const [, x, y, w, h] = draw.args as [unknown, number, number, number, number]
  assert.ok(w > 0 && h > 0, `the face was drawn at ${w}x${h}`)
  assert.ok(
    Math.abs(w / h - FRAME_W / FRAME_H) < 0.06,
    `the face was drawn at ${w}x${h}, an aspect ratio of ${(w / h).toFixed(3)} against the ` +
      `source's ${(FRAME_W / FRAME_H).toFixed(3)}. A squashed face is the right person slightly ` +
      `wrong in every list in the app, which nobody reports — they just stop telling people apart.`,
  )

  // And it has to *fit*. Asserting `x === floor((width - w) / 2)` was the first version of this
  // and it was the module's own formula copied into the test: `Math.min` swapped for `Math.max`
  // keeps the aspect ratio exactly, overflows the box, and still satisfies that equation — so
  // the check agreed with a mutation that draws the face half outside its square.
  const width = (canvas as unknown as { width: number }).width
  const height = (canvas as unknown as { height: number }).height
  assert.ok(
    w <= width && h <= height,
    `the face was drawn ${w}x${h} into a ${width}x${height} canvas, so part of it is outside the box`,
  )
  assert.ok(x >= 0 && y >= 0, `the face starts at ${x},${y} — above or left of its own canvas`)

  // Centred, expressed as the two margins matching rather than as the formula that produced them.
  assert.ok(Math.abs((width - w - x) - x) <= 1, `left margin ${x}, right margin ${width - w - x}`)
  assert.ok(Math.abs((height - h - y) - y) <= 1, `top margin ${y}, bottom margin ${height - h - y}`)
})

test('smoothing is off, because this is 8-bit art being scaled up', async () => {
  forgetFaces()
  const wrap = avatar('reviewer', 48, source()) as unknown as El
  await settle()

  const canvas = canvasIn(wrap)
  assert.ok(canvas)
  assert.equal(
    contextOf(canvas)['imageSmoothingEnabled'],
    false,
    'the default smoothing is left on, which turns a 16x24 face into a smudge at every size this ' +
      'is drawn at',
  )
})

test('the canvas is backed at the device resolution, and sized in CSS pixels', async () => {
  // Two different numbers on purpose: the layout sees `size`, the pixels are `size × dpr`. One
  // number for both is either a blurry face on a retina screen or an avatar the wrong size.
  forgetFaces()
  // A retina ratio on purpose. The harness reports 1, where `size` and `size * dpr` are the same
  // number and the assertion cannot tell a module that honours the ratio from one that ignores
  // it — the first version of this test passed just as well with `scale` hard-coded to 1.
  const window = (globalThis as unknown as { window: { devicePixelRatio: number } }).window
  const wasDpr = window.devicePixelRatio
  window.devicePixelRatio = 2
  try {
    const wrap = avatar('reviewer', 32, source()) as unknown as El
    await settle()

    const canvas = canvasIn(wrap)
    assert.ok(canvas)
    assert.equal(
      (canvas as unknown as { width: number }).width,
      64,
      'the backing store is 32 pixels on a screen with 2 device pixels per CSS pixel, so the face ' +
        'is drawn at half resolution and scaled up',
    )
    assert.equal(wrap.style.getPropertyValue('width'), '32px', 'the layout box is not the size that was asked for')
  } finally {
    window.devicePixelRatio = wasDpr
  }
})

test('art that never arrives leaves the initial rather than a hole', async () => {
  // Already covered next door, kept here as the control for this file: every assertion above is
  // about a canvas appearing, and would pass just as well on a module that always drew one.
  forgetFaces()
  const wrap = avatar('reviewer', 32, source({ sprites: () => Promise.reject(new Error('no pack')) })) as unknown as El
  await settle()

  assert.equal(canvasIn(wrap), undefined, 'a failed decode drew a canvas anyway')
  assert.match(wrap.textContent ?? '', /R/, 'a failed decode left a blank hole where a person should be')
})

test('forgetting a face releases the bitmap it was holding', async () => {
  // Real bitmaps hold GPU memory, and this cache is dropped wholesale on every theme change.
  forgetFaces()
  const wrap = avatar('reviewer', 32, source()) as unknown as El
  await settle()
  const canvas = canvasIn(wrap)
  assert.ok(canvas, 'no art was decoded, so there is nothing to release')

  const face = (contextOf(canvas).calls.find((c) => c.method === 'drawImage')?.args[0] ?? null) as
    | { closed: boolean }
    | null
  assert.ok(face, 'could not reach the bitmap that was drawn')
  assert.equal(face.closed, false, 'the bitmap was already closed before the cache was dropped')

  forgetFaces()
  await settle()
  assert.equal(face.closed, true, 'dropping the cache left every decoded face holding its memory')
})
