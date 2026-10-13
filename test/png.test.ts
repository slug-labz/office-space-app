/**
 * The PNG encoder, checked by taking the picture back apart.
 *
 * It was parked as *"loads fine; a dev tool, not on any runtime path"* — which is a reason not
 * to ship it, and not a reason not to test it. It is a pure function from pixels to bytes, which
 * makes it one of the most testable things in this repository, and it exists for a purpose that
 * fails quietly: rendering a contact sheet so a person can look at the cast, because *"pixel art
 * you have not looked at is pixel art you cannot claim works."*
 *
 * A broken encoder does not throw. It writes a file, the viewer refuses it or draws garbage, and
 * the natural conclusion is that the *painter* is wrong — so the tool built to judge the art
 * ends up accusing it. That is the same shape as the pack manifest in `sprites.ts`: when a
 * pipeline has one step that inspects another, a fault in the inspector is attributed to the
 * thing inspected.
 *
 * ## Round trip, not resemblance
 *
 * The strong assertion here is that the pixels come back. `zlib` inflates the IDAT, the filter
 * byte is stripped from each scanline, and the result must equal what went in — byte for byte.
 * Nothing about the framing can be right by accident if that holds.
 *
 * ## And the CRCs, computed a second way
 *
 * Every chunk carries a CRC32 and every real decoder refuses a chunk whose CRC is wrong. A test
 * that only checked structure would pass on a file no viewer will open. So the CRCs are
 * recomputed here **without a lookup table** — the same algorithm, deliberately not the same
 * code, so a fault in the table cannot verify itself.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'

import { encodePng } from '../src/shared/character/png.js'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * CRC32, bit by bit.
 *
 * The encoder builds a 256-entry table once and indexes it. This does the same arithmetic the
 * long way round, so the two agreeing means the checksum is right rather than that one
 * implementation is consistent with itself.
 */
function crc32Slowly(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

interface Chunk {
  readonly type: string
  readonly data: Buffer
  readonly declaredCrc: number
  readonly actualCrc: number
}

/** Walk a PNG's chunks, checking nothing — the assertions are the tests' job. */
function chunksOf(png: Buffer): Chunk[] {
  const out: Chunk[] = []
  let at = SIGNATURE.length
  while (at < png.length) {
    const length = png.readUInt32BE(at)
    const type = png.subarray(at + 4, at + 8).toString('ascii')
    const data = png.subarray(at + 8, at + 8 + length)
    out.push({
      type,
      data,
      declaredCrc: png.readUInt32BE(at + 8 + length),
      // The CRC covers the type and the data, not the length.
      actualCrc: crc32Slowly(png.subarray(at + 4, at + 8 + length)),
    })
    at += 12 + length
  }
  return out
}

/** A small picture with every channel varying, so a transposition cannot hide. */
function pixels(width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      out[at] = (x * 37) & 0xff
      out[at + 1] = (y * 59) & 0xff
      out[at + 2] = (x * y * 13) & 0xff
      out[at + 3] = x === y ? 0 : 255
    }
  }
  return out
}

test('it writes a PNG signature and the three chunks a viewer needs, in order', () => {
  const png = encodePng(4, 3, pixels(4, 3))

  assert.deepEqual(
    [...png.subarray(0, 8)],
    [...SIGNATURE],
    'the first eight bytes are not the PNG signature, so nothing will open it at all',
  )

  const chunks = chunksOf(png)
  // The control: a walk that finds nothing would satisfy every "no bad chunk" assertion below.
  assert.ok(chunks.length >= 3, `only ${chunks.length} chunks found — the walk is wrong, not the encoder`)
  assert.deepEqual(
    chunks.map((c) => c.type),
    ['IHDR', 'IDAT', 'IEND'],
    'IHDR must come first and IEND last; a decoder reads them in order and stops at IEND',
  )
})

test('the header declares the picture that was actually passed in', () => {
  const png = encodePng(7, 5, pixels(7, 5))
  const ihdr = chunksOf(png).find((c) => c.type === 'IHDR')
  assert.ok(ihdr)

  assert.equal(ihdr.data.readUInt32BE(0), 7, 'the width in the header is not the width encoded')
  assert.equal(ihdr.data.readUInt32BE(4), 5, 'the height in the header is not the height encoded')
  assert.equal(ihdr.data[8], 8, 'bit depth must be 8')
  assert.equal(ihdr.data[9], 6, 'colour type must be 6 (RGBA) — the painter produces an alpha channel and it has to survive')
  assert.equal(ihdr.data[12], 0, 'interlacing must be off')
})

test('every chunk checksum is right, computed a second way', () => {
  const png = encodePng(4, 3, pixels(4, 3))

  const wrong = chunksOf(png)
    .filter((c) => c.declaredCrc !== c.actualCrc)
    .map((c) => `${c.type}: declared ${c.declaredCrc.toString(16)}, actual ${c.actualCrc.toString(16)}`)

  assert.deepEqual(
    wrong,
    [],
    'a chunk carries the wrong CRC. Every real decoder refuses the chunk, so the file looks ' +
      `like a PNG to anything that does not check and opens in nothing that does:\n  ${wrong.join('\n  ')}`,
  )
})

test('the pixels come back', () => {
  // The assertion the rest of this file is scaffolding for. Nothing about the framing can be
  // accidentally right if the picture survives a round trip.
  const width = 9
  const height = 6
  const original = pixels(width, height)

  const idat = chunksOf(encodePng(width, height, original)).find((c) => c.type === 'IDAT')
  assert.ok(idat, 'there is no image data chunk at all')

  const raw = inflateSync(idat.data)
  assert.equal(
    raw.length,
    height * (width * 4 + 1),
    'the decompressed data is not one filter byte plus one row of RGBA per scanline',
  )

  const back = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1)
    assert.equal(raw[rowStart], 0, `scanline ${y} claims a filter this encoder does not apply`)
    for (let i = 0; i < width * 4; i++) back[y * width * 4 + i] = raw[rowStart + 1 + i]!
  }

  assert.deepEqual(
    [...back],
    [...original],
    'the pixels that came out are not the pixels that went in — a contact sheet drawn from this ' +
      'would make the painter look wrong',
  )
})

test('a single pixel and a single row both survive', () => {
  // The sizes where an off-by-one in the scanline arithmetic hides.
  for (const [w, h] of [
    [1, 1],
    [1, 8],
    [8, 1],
  ] as const) {
    const original = pixels(w, h)
    const idat = chunksOf(encodePng(w, h, original)).find((c) => c.type === 'IDAT')
    assert.ok(idat)
    const raw = inflateSync(idat.data)
    const back = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let i = 0; i < w * 4; i++) back[y * w * 4 + i] = raw[y * (w * 4 + 1) + 1 + i]!
    }
    assert.deepEqual([...back], [...original], `${w}x${h} did not survive the round trip`)
  }
})

test('the end chunk is empty, which is what tells a decoder to stop', () => {
  const iend = chunksOf(encodePng(2, 2, pixels(2, 2))).find((c) => c.type === 'IEND')
  assert.ok(iend)
  assert.equal(iend.data.length, 0, 'IEND carries data, and a decoder reading it will read past the end of the image')
})
