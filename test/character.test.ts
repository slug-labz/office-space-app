import { test } from 'node:test'
import assert from 'node:assert/strict'

import { recipeFor } from '../src/shared/character/recipe.js'
import {
  FRAME_H,
  FRAME_W,
  PAINT_DIRECTIONS,
  paintFrame,
  paintSheet,
} from '../src/shared/character/painter.js'
import { OUTLINE } from '../src/shared/character/recipe.js'

const opaqueCount = (buf: Uint8ClampedArray): number => {
  let n = 0
  for (let i = 3; i < buf.length; i += 4) if (buf[i]! > 0) n++
  return n
}

const pixelAt = (buf: Uint8ClampedArray, x: number, y: number) => {
  const i = (y * FRAME_W + x) * 4
  return { r: buf[i]!, g: buf[i + 1]!, b: buf[i + 2]!, a: buf[i + 3]! }
}

/** The rows the figure actually occupies. `bottom` is where it meets the ground. */
const occupiedRows = (buf: Uint8ClampedArray) => {
  let top = FRAME_H
  let bottom = -1
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      if (buf[(y * FRAME_W + x) * 4 + 3]! === 0) continue
      if (y < top) top = y
      if (y > bottom) bottom = y
      break
    }
  }
  return { top, bottom }
}

// ─────────────────────────────────────────────────────────────────── recipe ──

/** A recipe's appearance, without provenance. `source` deliberately preserves the exact name. */
const look = (name: string) => {
  const { source: _source, ...appearance } = recipeFor(name)
  return appearance
}

test('the same name always produces the same character', () => {
  // The whole scaling story depends on this: an agent looks identical on every machine,
  // forever, with nothing persisted anywhere.
  assert.deepEqual(look('wren-review'), look('wren-review'))
  assert.deepEqual(look('Wren-Review'), look('wren-review'), 'case must not matter')
  assert.deepEqual(look('  manager  '), look('manager'), 'whitespace must not matter')
})

test('provenance survives normalisation', () => {
  // Appearance is normalised, but the recipe still remembers the name it came from so a
  // character on the floor can be traced back to its file.
  assert.equal(recipeFor('  Wren-Review  ').source, '  Wren-Review  ')
})

test('a realistic roster produces visibly different people', () => {
  // Not a hash-collision test — a *look* test. Two employees sharing a hash bucket on one
  // field is fine; sharing every field is what makes a floor look cloned.
  const names = [
    'manager', 'reviewer', 'builder', 'memory-keeper', 'tester', 'frontend', 'backend',
    'designer', 'wren-review', 'security-auditor', 'data-analyst', 'docs-writer',
  ]
  const fingerprints = names.map((n) => {
    const r = recipeFor(n)
    return [r.hairStyle, r.accessory, r.slim, r.skin.r, r.hair.r, r.shirt.r].join('|')
  })
  assert.equal(new Set(fingerprints).size, names.length, 'two employees look identical')
})

test('per-field salting keeps choices independent', () => {
  // Slicing bit ranges out of one 32-bit hash correlates the fields and produces visible
  // clusters (everyone with dark hair also wearing blue). Re-hashing per field avoids it.
  const sample = Array.from({ length: 200 }, (_, i) => recipeFor(`agent-${i}`))
  const styles = new Set(sample.map((r) => r.hairStyle))
  const accessories = new Set(sample.map((r) => r.accessory))
  assert.equal(styles.size, 6, 'every hair style should appear across 200 agents')
  assert.ok(accessories.size >= 4, `expected most accessories, saw ${accessories.size}`)
})

test('most employees wear no accessory', () => {
  // A floor where everyone is wearing something looks costumed. The pool is weighted.
  const sample = Array.from({ length: 300 }, (_, i) => recipeFor(`person-${i}`))
  const plain = sample.filter((r) => r.accessory === 'none').length
  assert.ok(plain / sample.length > 0.35, `only ${plain}/300 plain — accessories over-represented`)
})

// ────────────────────────────────────────────────────────────────── painter ──

test('a frame is the declared size and is actually drawn', () => {
  const frame = paintFrame(recipeFor('manager'), 'down', 0)
  assert.equal(frame.length, FRAME_W * FRAME_H * 4)

  const opaque = opaqueCount(frame)
  assert.ok(opaque > 150, `only ${opaque} opaque pixels — the figure is missing`)
  assert.ok(opaque < FRAME_W * FRAME_H * 0.75, `${opaque} opaque — the figure is a solid block`)
})

test('a full sheet is nine frames', () => {
  const sheet = paintSheet(recipeFor('reviewer'))
  assert.equal(PAINT_DIRECTIONS.length, 3)
  for (const d of PAINT_DIRECTIONS) assert.equal(sheet.frames[d].length, 3, `${d} step count`)
})

test('the silhouette is outlined', () => {
  // The outline pass is what stops characters dissolving into a light floor.
  const frame = paintFrame(recipeFor('builder'), 'down', 0)
  let outlinePixels = 0
  for (let i = 0; i < frame.length; i += 4) {
    if (frame[i] === OUTLINE.r && frame[i + 1] === OUTLINE.g && frame[i + 2] === OUTLINE.b) {
      outlinePixels++
    }
  }
  assert.ok(outlinePixels > 40, `only ${outlinePixels} outline pixels`)
})

test('REGRESSION: long hair must not paint over the eyes', () => {
  // The first cast rendered faceless under long hair, because the hair templates carried
  // skin glyphs that overwrote the eye pixels the body had already drawn. Hair templates
  // contain hair only; a space means "leave what is underneath alone".
  const longHaired = Array.from({ length: 400 }, (_, i) => `n${i}`)
    .map((n) => recipeFor(n))
    .filter((r) => r.hairStyle === 'long' || r.hairStyle === 'bob')

  assert.ok(longHaired.length > 0, 'no long/bob recipes in the sample')

  for (const recipe of longHaired.slice(0, 12)) {
    const frame = paintFrame(recipe, 'down', 0)
    let inkPixels = 0
    for (let i = 0; i < frame.length; i += 4) {
      if (frame[i] === OUTLINE.r && frame[i + 1] === OUTLINE.g && frame[i + 2] === OUTLINE.b) {
        inkPixels++
      }
    }
    // Eyes are ink-coloured and sit inside the silhouette; if hair overwrote them the count
    // drops to the outline alone. Compare against the same character facing away, which
    // legitimately has no eyes.
    const back = paintFrame(recipe, 'up', 0)
    let backInk = 0
    for (let i = 0; i < back.length; i += 4) {
      if (back[i] === OUTLINE.r && back[i + 1] === OUTLINE.g && back[i + 2] === OUTLINE.b) {
        backInk++
      }
    }
    assert.ok(inkPixels > backInk, `${recipe.source ?? 'agent'}: front view has no more ink than the back — eyes are missing`)
  }
})

test('facing away hides the face', () => {
  const recipe = recipeFor('memory-keeper')
  const front = paintFrame(recipe, 'down', 0)
  const back = paintFrame(recipe, 'up', 0)
  assert.notDeepEqual(Array.from(front), Array.from(back), 'front and back are identical')
})

test('the stride actually changes the pixels', () => {
  // A walk cycle whose frames are identical is not a walk cycle. This caught a version where
  // the only difference was a single pixel at the very bottom of the frame.
  const recipe = recipeFor('tester')
  const [a, b, c] = [0, 1, 2].map((s) => paintFrame(recipe, 'down', s))

  const diff = (x: Uint8ClampedArray, y: Uint8ClampedArray) => {
    let n = 0
    for (let i = 3; i < x.length; i += 4) if ((x[i]! > 0) !== (y[i]! > 0)) n++
    return n
  }

  assert.ok(diff(a!, b!) > 8, `step 0→1 differs by only ${diff(a!, b!)} pixels`)
  assert.ok(diff(b!, c!) > 4, `step 1→2 differs by only ${diff(b!, c!)} pixels`)
})

test('every direction and step paints something', () => {
  const sheet = paintSheet(recipeFor('security-auditor'))
  for (const d of PAINT_DIRECTIONS) {
    sheet.frames[d].forEach((frame, step) => {
      assert.ok(opaqueCount(frame) > 120, `${d}/${step} is nearly empty`)
    })
  }
})

test('the standing pose reaches the bottom of the frame', () => {
  // Sprites are anchored at their feet: the renderer puts the frame's bottom edge on the ground
  // and trusts the art to reach it. Empty rows below the shoes are not padding, they are a gap
  // between the character and the floor — and on a 16px isometric diamond, the three this used
  // to leave are a quarter of a tile. The cast hovers, and the contact shadow draws in the
  // daylight underneath their feet rather than under them. It is invisible in a still until you
  // put the shadow next to it, and unmistakable the moment you do.
  for (const name of ['manager', 'reviewer', 'builder', 'wren-review']) {
    for (const direction of PAINT_DIRECTIONS) {
      const { top, bottom } = occupiedRows(paintFrame(recipeFor(name), direction, 0))
      assert.equal(bottom, FRAME_H - 1, `${name}/${direction}: standing pose floats ${FRAME_H - 1 - bottom}px`)
      assert.ok(top > 0, `${name}/${direction}: the head is jammed against the top of the frame`)
    }
  }
})

test('the stride lifts by exactly one row, and that is the bob', () => {
  // The walk frames are *meant* to leave daylight — that is the one-pixel lift the whole cycle
  // is built on. Any more and the character is floating again, this time only while it walks,
  // which reads as a limp.
  for (const step of [1, 2]) {
    const { bottom } = occupiedRows(paintFrame(recipeFor('tester'), 'down', step))
    assert.equal(bottom, FRAME_H - 2, `step ${step} sits ${FRAME_H - 1 - bottom}px off the ground`)
  }
})

test('nothing is drawn outside the frame', () => {
  // A stamp that runs off the edge must clip, not wrap around to the other side.
  for (const name of ['manager', 'frontend', 'wren-review']) {
    const frame = paintFrame(recipeFor(name), 'down', 1)
    for (let y = 0; y < FRAME_H; y++) {
      const left = pixelAt(frame, 0, y)
      const right = pixelAt(frame, FRAME_W - 1, y)
      assert.equal(left.a, 0, `${name}: pixel bled to column 0 at row ${y}`)
      assert.equal(right.a, 0, `${name}: pixel bled to the last column at row ${y}`)
    }
  }
})

// ──────────────────────────────────────────── L2-33: legible as *this* agent ──

test('an agent’s description changes their look, and nothing is derived from its words', () => {
  // The honest half of L2-33. Matching "reviewer" and handing that character a clipboard would
  // be invented meaning — nothing in the workspace says a reviewer holds anything, and a
  // difference nobody can decode is decoration pretending to be information.
  //
  // Folding the description into the hash buys the thing the item is actually for: two agents
  // whose names are close stop looking close, because their jobs differ.
  const a = recipeFor('reviewer', 'Reviews code for correctness.')
  const b = recipeFor('reviewer', 'Runs the test suite and reports failures.')

  assert.notDeepEqual(a, b, 'the same name with a different job produced the same character')
})

test('the same agent is the same character on every machine, always', () => {
  // The promise the whole recipe exists for, re-asserted now that there are two inputs.
  //
  // Compared on **appearance**, not on the whole object: `source` deliberately keeps the string
  // it was given, untrimmed, so a caller can show what it asked for. It is provenance rather
  // than a feature of the character, and the first version of this test failed on it — which was
  // the test being wrong, not the recipe.
  const look = ({ source: _source, ...rest }: ReturnType<typeof recipeFor>) => rest
  const once = recipeFor('builder', 'Writes the code.')
  const again = recipeFor('  Builder  ', '  Writes the code.  ')

  assert.deepEqual(look(once), look(again), 'whitespace and capitalisation are not identity')
})

test('an agent with no description still gets a character', () => {
  // A hand-written agent file may have no description at all, and a blank on the floor would be
  // the theme failing in the one way `onArtFailed` exists to prevent.
  const bare = recipeFor('nomad')
  assert.equal(typeof bare.skin.r, 'number', 'skin is a colour, not a name')
  assert.equal(bare.source, 'nomad')
  // …and it is the same character it was before descriptions existed, so nobody's look changed
  // just because this feature landed.
  assert.deepEqual(bare, recipeFor('nomad', ''))
})

test('two agents cannot collide by splitting the join differently', () => {
  // ("ab", "c") and ("a", "bc") must be different people. Concatenating without a separator
  // that cannot appear in either would make them the same one.
  assert.notDeepEqual(recipeFor('ab', 'c'), recipeFor('a', 'bc'))
})
