/**
 * The character painter.
 *
 * Draws an employee from a {@link Recipe} into raw RGBA pixels — nine frames, three
 * directions, three steps each. No files, no atlas, no artist.
 *
 * ## Why this is tractable
 *
 * A frame is 18×32 and only ~250 of those pixels are opaque. At that scale a walk cycle is a
 * one-pixel foot lift and a one-pixel body bob, not articulated limbs. Once you see it that
 * way, drawing a person in code stops being a heroic act and becomes arithmetic.
 *
 * ## Why templates rather than rectangles
 *
 * The first version of this file composed the figure from filled rectangles and produced
 * featureless blocks — a head is not a square, and shoulders are not a box. At eighteen pixels
 * wide, *silhouette is the only thing the eye can read*, so the art has to be authored as
 * shape. These templates put the shape directly in the source, where it can be seen and
 * adjusted by looking at it:
 *
 *     '  ▓▓▓▓  '
 *     ' ▓░░░░▓ '
 *     ' ▓░██░▓ '
 *
 * Legend — `░` skin · `▓` hair · `▒` hair shadow · `█` shirt · `▌` shirt shadow ·
 * `▄` trousers · `▀` shoes · `●` ink (eyes) · `·`/space transparent.
 *
 * Parts are painted back-to-front, then one pass adds a 1px outline wherever an opaque pixel
 * touches a transparent one. Outlining the finished silhouette rather than each part is what
 * prevents seams where the arms meet the torso.
 */

import { OUTLINE, type Recipe, type RGB } from './recipe.js'

export const FRAME_W = 18
export const FRAME_H = 32

/** Frames are painted for three directions; `left` is `right` mirrored at draw time. */
export type PaintDirection = 'down' | 'up' | 'right'

export const PAINT_DIRECTIONS: readonly PaintDirection[] = ['down', 'up', 'right']

/** Steps per direction. The renderer cycles them `[0, 1, 2, 1]`. */
export const FRAMES_PER_DIRECTION = 3

// ──────────────────────────────────────────────────────────────── templates ──

type Ink = 'skin' | 'hair' | 'hairShade' | 'shirt' | 'shirtShade' | 'trousers' | 'shoes' | 'ink' | 'lens' | 'glint'

const GLYPHS: Readonly<Record<string, Ink>> = {
  '░': 'skin',
  '▓': 'hair',
  '▒': 'hairShade',
  '█': 'shirt',
  '▌': 'shirtShade',
  '▄': 'trousers',
  '▀': 'shoes',
  '●': 'ink',
  '◆': 'lens',
  '○': 'glint',
}

/**
 * Head and torso, front view. Twelve columns wide, drawn at x = 3.
 *
 * The head is eight wide with its corners cut — that single detail is the difference between
 * reading as a person and reading as a nail. Shoulders sit one pixel proud of the torso and
 * the waist tucks in by one, which is all the tapering that survives at this size.
 */
const BODY_DOWN = [
  '            ', // 0  (hair sits above, drawn by the hair overlay)
  '            ', // 1
  '            ', // 2
  '   ░░░░░░   ', // 3  brow line
  '  ░░░░░░░░  ', // 4
  '  ░░░░░░░░  ', // 5
  '  ░░●░░●░░  ', // 6  eyes
  '  ░░░░░░░░  ', // 7
  '   ░░░░░░   ', // 8  jaw
  '    ░░░░    ', // 9  chin
  '     ░░     ', // 10 neck
  '  ████████  ', // 11 shoulders
  ' ██████████ ', // 12 arms out
  ' ██████████ ', // 13
  ' ██████████ ', // 14
  ' ██████████ ', // 15
  ' ██████████ ', // 16
  ' ░████████░ ', // 17 hands
  '  ██████░░  ', // 18
  '  ████████  ', // 19 waist
] as const

/** Back view: no face, and the hair overlay covers more of the skull. */
const BODY_UP = [
  '            ',
  '            ',
  '            ',
  '   ░░░░░░   ',
  '  ░░░░░░░░  ',
  '  ░░░░░░░░  ',
  '  ░░░░░░░░  ',
  '  ░░░░░░░░  ',
  '   ░░░░░░   ',
  '    ░░░░    ',
  '     ░░     ',
  '  ████████  ',
  ' ██████████ ',
  ' ██████████ ',
  ' ██████████ ',
  ' ██████████ ',
  ' ██████████ ',
  ' ░████████░ ',
  '  ████████  ',
  '  ████████  ',
] as const

/**
 * Profile. Genuinely narrower — six wide rather than eight — with a nose notch and one eye.
 * The far arm is shaded so the figure has depth instead of reading as a cut-out.
 */
const BODY_RIGHT = [
  '            ',
  '            ',
  '            ',
  '   ░░░░░    ',
  '   ░░░░░░   ',
  '   ░░░░░░   ',
  '   ░░●░░░░  ', // eye, and the column right of it is the nose bridge
  '   ░░░░░░   ',
  '   ░░░░░    ',
  '    ░░░░    ',
  '     ░░     ',
  '   ██████   ',
  '   ███████  ',
  '  ▌███████  ',
  '  ▌███████  ',
  '  ▌███████  ',
  '  ▌███████  ',
  '  ▌██████░  ',
  '   ██████   ',
  '   ██████   ',
] as const

/**
 * Hair. These are the identity signal — at eighteen pixels, silhouette carries far more than
 * colour, so every style is a genuinely different outline rather than a different-sized cap.
 */
const HAIR_TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  // Hair templates contain ONLY hair. A space means "leave whatever is underneath alone".
  // Painting skin here instead would overwrite the eyes the body template already drew —
  // which is precisely how the first cast ended up faceless under long hair.
  bald: [],
  crop: [
    '            ',
    '   ▓▓▓▓▓▓   ',
    '  ▓▓▓▓▓▓▓▓  ',
    '  ▓▓▓▓▓▓▓▓  ',
  ],
  short: [
    '            ',
    '   ▓▓▓▓▓▓   ',
    '  ▓▓▓▓▓▓▓▓  ',
    '  ▓▓▓▓▓▓▓▓  ',
    '  ▒      ▒  ',
    '  ▒      ▒  ',
  ],
  bob: [
    '            ',
    '   ▓▓▓▓▓▓   ',
    '  ▓▓▓▓▓▓▓▓  ',
    '  ▓▓▓▓▓▓▓▓  ',
    ' ▓▒      ▒▓ ',
    ' ▓▒      ▒▓ ',
    ' ▓        ▓ ',
    ' ▓        ▓ ',
    '  ▓      ▓  ',
  ],
  long: [
    '            ',
    '   ▓▓▓▓▓▓   ',
    '  ▓▓▓▓▓▓▓▓  ',
    '  ▓▓▓▓▓▓▓▓  ',
    ' ▓▒      ▒▓ ',
    ' ▓▒      ▒▓ ',
    ' ▓        ▓ ',
    ' ▓        ▓ ',
    ' ▓        ▓ ',
    ' ▓        ▓ ',
    ' ▓▓      ▓▓ ',
    ' ▒▓      ▓▒ ',
  ],
  bun: [
    '     ▓▓▓    ',
    '    ▓▓▓▓▓   ',
    '   ▓▓▓▓▓▓   ',
    '  ▓▓▓▓▓▓▓▓  ',
    '  ▓▓▓▓▓▓▓▓  ',
    '  ▒      ▒  ',
  ],
}

/**
 * Legs, three steps.
 *
 * Step 0 is the passing pose — legs together, both feet planted. Steps 1 and 2 open the
 * stance by a pixel *and* lift the trailing heel, and those two changes have to happen
 * together: a lift alone is a single pixel at the very bottom of the frame and reads as
 * nothing at all, which is exactly how the first attempt failed.
 */
const LEGS: readonly (readonly string[])[] = [
  // 0 — passing: feet together, level
  [
    '  ▄▄▄  ▄▄▄  ',
    '  ▄▄▄  ▄▄▄  ',
    '  ▄▄▄  ▄▄▄  ',
    '  ▄▄▄  ▄▄▄  ',
    '  ▄▄▄  ▄▄▄  ',
    '  ▀▀▀  ▀▀▀  ',
    '  ▀▀▀  ▀▀▀  ',
  ],
  // 1 — stance open, right heel up
  [
    '  ▄▄▄  ▄▄▄  ',
    '  ▄▄▄  ▄▄▄  ',
    ' ▄▄▄    ▄▄▄ ',
    ' ▄▄▄    ▄▄▄ ',
    ' ▄▄▄    ▄▄▄ ',
    ' ▀▀▀    ▀▀▀ ',
    ' ▀▀▀        ',
  ],
  // 2 — stance open, left heel up
  [
    '  ▄▄▄  ▄▄▄  ',
    '  ▄▄▄  ▄▄▄  ',
    ' ▄▄▄    ▄▄▄ ',
    ' ▄▄▄    ▄▄▄ ',
    ' ▄▄▄    ▄▄▄ ',
    ' ▀▀▀    ▀▀▀ ',
    '        ▀▀▀ ',
  ],
] as const

// ─────────────────────────────────────────────────────────────── the canvas ──

class Buffer {
  readonly data = new Uint8ClampedArray(FRAME_W * FRAME_H * 4)

  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= FRAME_W || y >= FRAME_H) return
    const i = (y * FRAME_W + x) * 4
    this.data[i] = c.r
    this.data[i + 1] = c.g
    this.data[i + 2] = c.b
    this.data[i + 3] = 255
  }

  opaque(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= FRAME_W || y >= FRAME_H) return false
    return this.data[(y * FRAME_W + x) * 4 + 3]! > 0
  }

  /** Stamp a template at (ox, oy) using the supplied ink map. */
  stamp(template: readonly string[], ox: number, oy: number, inks: Record<Ink, RGB>): void {
    for (let row = 0; row < template.length; row++) {
      const line = template[row]!
      for (let col = 0; col < line.length; col++) {
        const ink = GLYPHS[line[col]!]
        if (!ink) continue
        this.set(ox + col, oy + row, inks[ink])
      }
    }
  }

  /** Read a pixel back, or null where nothing has been painted. */
  get(x: number, y: number): RGB | null {
    if (!this.opaque(x, y)) return null
    const i = (y * FRAME_W + x) * 4
    return { r: this.data[i]!, g: this.data[i + 1]!, b: this.data[i + 2]! }
  }

  /**
   * Light the silhouette from the upper left, and sink its feet into shadow.
   *
   * The cast used to be stamped flat while the furniture around it had three shaded faces, and
   * that mismatch is the whole of why the characters read as placeholder art next to their own
   * desks. They had not got worse — the room got better, in a way they were not drawn to match.
   *
   * Two passes, both cheap, both per-frame at paint time rather than per-draw:
   *
   *   **A rim.** The first opaque pixel in each row is lifted and the last is dropped, so every
   *   limb and shoulder gains a lit edge and a shaded one. On an 18px-wide figure that single
   *   pixel either side is most of the available volume.
   *
   *   **Contact.** The bottom rows darken toward the floor, which is what stops a character
   *   looking pasted onto the tile rather than standing on it.
   *
   * The outline is left alone: it is the silhouette, and lighting it would soften the one edge
   * that has to stay hard at this size.
   */
  light(): void {
    const isOutline = (c: RGB) => c.r === OUTLINE.r && c.g === OUTLINE.g && c.b === OUTLINE.b

    for (let y = 0; y < FRAME_H; y++) {
      let first = -1
      let last = -1
      for (let x = 0; x < FRAME_W; x++) {
        const c = this.get(x, y)
        if (!c || isOutline(c)) continue
        if (first < 0) first = x
        last = x
      }
      if (first < 0) continue

      const lit = this.get(first, y)
      if (lit) this.set(first, y, scale(lit, RIM_LIGHT))
      // Only when there is a body between them, or a one-pixel-wide row gets lit and shaded at
      // once and comes out muddy.
      if (last > first + 1) {
        const dim = this.get(last, y)
        if (dim) this.set(last, y, scale(dim, RIM_SHADE))
      }
    }

    for (let y = FRAME_H - CONTACT_ROWS; y < FRAME_H; y++) {
      const depth = (y - (FRAME_H - CONTACT_ROWS) + 1) / CONTACT_ROWS
      for (let x = 0; x < FRAME_W; x++) {
        const c = this.get(x, y)
        if (!c || isOutline(c)) continue
        this.set(x, y, scale(c, 1 - depth * CONTACT_SINK))
      }
    }
  }

  /** One-pixel outline around the whole silhouette. Run last, exactly once. */
  outline(): void {
    const edges: Array<[number, number]> = []
    for (let y = 0; y < FRAME_H; y++) {
      for (let x = 0; x < FRAME_W; x++) {
        if (this.opaque(x, y)) continue
        if (this.opaque(x - 1, y) || this.opaque(x + 1, y) || this.opaque(x, y - 1) || this.opaque(x, y + 1)) {
          edges.push([x, y])
        }
      }
    }
    for (const [x, y] of edges) this.set(x, y, OUTLINE)
  }
}

/** Lift on the lit edge and drop on the shaded one — the furniture's own light, at body scale. */
const RIM_LIGHT = 1.22
const RIM_SHADE = 0.78

/** How many rows at the foot sink toward the floor, and how far. */
const CONTACT_ROWS = 4
const CONTACT_SINK = 0.3

/** Multiply a colour, clamped. `shade` takes an amount to remove; this takes a factor. */
function scale(c: RGB, factor: number): RGB {
  return {
    r: Math.max(0, Math.min(255, Math.round(c.r * factor))),
    g: Math.max(0, Math.min(255, Math.round(c.g * factor))),
    b: Math.max(0, Math.min(255, Math.round(c.b * factor))),
  }
}

function shade(c: RGB, amount: number): RGB {
  return {
    r: Math.max(0, Math.round(c.r * (1 - amount))),
    g: Math.max(0, Math.round(c.g * (1 - amount))),
    b: Math.max(0, Math.round(c.b * (1 - amount))),
  }
}

// ────────────────────────────────────────────────────────────────── layout ───

const BODY_X = 3

/**
 * Where the figure starts, vertically.
 *
 * Set so the last row of the *standing* pose — the outline under the shoes — is the last row of
 * the frame. Sprites are anchored at their feet: the renderer puts the frame's bottom edge on
 * the ground and trusts the art to reach it. Empty rows below the shoes are therefore not
 * padding, they are a gap between the character and the floor.
 *
 * This sat at 1 while the floor was drawn in plan, which left three such rows and nobody
 * counted them. On a 16px-tall isometric diamond three pixels is a quarter of the tile: the
 * whole cast hovers, and the contact shadow — drawn on the ground, where it belongs — lands in
 * the daylight underneath their feet instead of under them. Floating is the single most
 * reliable way to make an isometric character look wrong, and it is invisible in a still until
 * you put the shadow next to it.
 *
 * The stride frames lift by one row and are *meant* to leave daylight; see {@link bobFor}.
 * That is the bob, not the gap.
 */
const BODY_Y = 4
const LEGS_Y = BODY_Y + 20 // directly under the torso template
const HAIR_Y = BODY_Y + 1

const BODY_FOR: Readonly<Record<PaintDirection, readonly string[]>> = {
  down: BODY_DOWN,
  up: BODY_UP,
  right: BODY_RIGHT,
}

/** One pixel of lift on the stride frames. More would read as bouncing. */
const bobFor = (step: number): number => (step === 0 ? 0 : -1)

function paintAccessory(b: Buffer, recipe: Recipe, dy: number, direction: PaintDirection, inks: Record<Ink, RGB>): void {
  const eyeRow = BODY_Y + dy + 6

  switch (recipe.accessory) {
    case 'glasses': {
      if (direction === 'up') break
      // Lens rims with a bright glint inside, so it reads as glass rather than a blindfold —
      // which is exactly how a solid dark bar came out on the first attempt.
      if (direction === 'down') {
        b.stamp(['◆◆◆'], BODY_X + 4, eyeRow - 1, inks)
        b.stamp(['◆◆◆'], BODY_X + 7, eyeRow - 1, inks)
        b.set(BODY_X + 5, eyeRow, inks.glint)
        b.set(BODY_X + 8, eyeRow, inks.glint)
        b.set(BODY_X + 6, eyeRow - 1, inks.lens)
      } else {
        b.stamp(['◆◆◆'], BODY_X + 4, eyeRow - 1, inks)
        b.set(BODY_X + 5, eyeRow, inks.glint)
      }
      break
    }
    case 'tie': {
      if (direction === 'up') break
      const tie = shade(recipe.trousers, -0.3)
      b.stamp([' ▄ ', '▄▄▄', ' ▄ ', ' ▄ '], BODY_X + 4, BODY_Y + dy + 11, { ...inks, trousers: tie })
      break
    }
    case 'headphones': {
      const band: RGB = { r: 0x22, g: 0x26, b: 0x2c }
      const cup = { ...inks, hair: band, hairShade: band }
      b.stamp(['  ▓▓▓▓▓▓  '], BODY_X + 1, BODY_Y + dy + 1, cup)
      b.stamp(['▓', '▓', '▓'], BODY_X + 1, BODY_Y + dy + 4, cup)
      b.stamp(['▓', '▓', '▓'], BODY_X + 10, BODY_Y + dy + 4, cup)
      break
    }
    case 'lanyard': {
      if (direction === 'up') break
      const cord: RGB = { r: 0x9c, g: 0x3d, b: 0x3d }
      b.set(BODY_X + 4, BODY_Y + dy + 11, cord)
      b.set(BODY_X + 7, BODY_Y + dy + 11, cord)
      b.set(BODY_X + 5, BODY_Y + dy + 12, cord)
      b.set(BODY_X + 6, BODY_Y + dy + 12, cord)
      const card: RGB = { r: 0xe6, g: 0xe2, b: 0xd6 }
      b.set(BODY_X + 5, BODY_Y + dy + 13, card)
      b.set(BODY_X + 6, BODY_Y + dy + 13, card)
      b.set(BODY_X + 5, BODY_Y + dy + 14, card)
      b.set(BODY_X + 6, BODY_Y + dy + 14, card)
      break
    }
    case 'none':
      break
  }
}

/** Paint one frame. Returns RGBA, row-major, `FRAME_W × FRAME_H`. */
export function paintFrame(recipe: Recipe, direction: PaintDirection, step: number): Uint8ClampedArray {
  const b = new Buffer()
  const dy = bobFor(step)

  const inks: Record<Ink, RGB> = {
    skin: recipe.skin,
    hair: recipe.hair,
    hairShade: shade(recipe.hair, 0.3),
    shirt: recipe.shirt,
    shirtShade: shade(recipe.shirt, 0.25),
    trousers: recipe.trousers,
    shoes: recipe.shoes,
    ink: OUTLINE,
    lens: { r: 0x2b, g: 0x30, b: 0x38 },
    glint: { r: 0xcf, g: 0xdd, b: 0xea },
  }

  // Legs first so the torso overlaps them at the waist.
  b.stamp(LEGS[step] ?? LEGS[0]!, BODY_X, LEGS_Y + dy, inks)
  b.stamp(BODY_FOR[direction], BODY_X, BODY_Y + dy, inks)
  b.stamp(HAIR_TEMPLATES[recipe.hairStyle] ?? HAIR_TEMPLATES['crop']!, BODY_X, HAIR_Y + dy, inks)
  paintAccessory(b, recipe, dy, direction, inks)
  // Light before outlining: the outline is the silhouette and must stay the hardest edge in
  // the sprite. Lighting it would round off the one boundary that carries the figure at 18px.
  b.light()
  b.outline()

  return b.data
}

export interface CharacterSheet {
  readonly recipe: Recipe
  readonly width: number
  readonly height: number
  /** `frames[direction][step]`, RGBA buffers. */
  readonly frames: Readonly<Record<PaintDirection, readonly Uint8ClampedArray[]>>
}

/** Paint the whole nine-frame sheet for one employee. */
export function paintSheet(recipe: Recipe): CharacterSheet {
  const frames = {} as Record<PaintDirection, Uint8ClampedArray[]>

  for (const direction of PAINT_DIRECTIONS) {
    frames[direction] = []
    for (let step = 0; step < FRAMES_PER_DIRECTION; step++) {
      frames[direction]!.push(paintFrame(recipe, direction, step))
    }
  }

  return { recipe, width: FRAME_W, height: FRAME_H, frames }
}
