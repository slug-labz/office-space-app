/**
 * The app icon, and whether the build is actually wired to it.
 *
 * This file exists because the obvious check is a lie. `assets/build` is the configured
 * `buildResources` directory, so it is tempting to commit `icon.png` there and call it done —
 * but electron-builder only picks an icon up by convention for some targets, and a
 * `git ls-files | grep icon` gate passes on a zero-byte file, on a 512x512 file, and on a
 * config that never names the icon at all. Any of those three ships Electron's default and
 * nothing says so until somebody looks at the Dock.
 *
 * So the questions here are the ones that can actually come out wrong:
 *
 *  - does `build` *name* the icon, on every target the config has?
 *  - is the file git tracks the file electron-builder is pointed at?
 *  - is that file a 1024x1024 PNG with its pixels in it, rather than a placeholder?
 *  - can it still be regenerated, or is it a binary nobody can rebuild?
 *
 * What it does not check is what the icon looks like. That is not a thing a test can hold.
 */

import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { join } from 'node:path'

const root = process.cwd()

/**
 * electron-builder 25 generates the whole macOS `.icns` ladder and the Windows `.ico` from one
 * square PNG, and 1024 is what the full ladder needs. Measured on 2026-10-01: the `.icns` this
 * config produces carries a `512x512@2x` entry, which is 1024 pixels square. A smaller source
 * could only be upscaled into that slot. Whether electron-builder refuses one outright is not
 * checked here — the conversion happens inside its `app-builder` binary — so this asserts the
 * size the ladder demands rather than a rejection nobody here has seen.
 */
const REQUIRED = 1024

interface BuildConfig {
  readonly mac?: { readonly icon?: string }
  readonly linux?: { readonly icon?: string }
  readonly win?: { readonly icon?: string }
}

async function buildConfig(): Promise<BuildConfig> {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { build?: BuildConfig }
  assert.ok(pkg.build, 'package.json has no `build` block')
  return pkg.build
}

/** Tracked, as git itself reports it — not "exists on this machine". */
function isTracked(path: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', path], { cwd: root, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

test('every packaging target names the icon', async () => {
  // The defect this replaces: `build.mac` carried `identity`, `category`, `target` and
  // `extendInfo` and no `icon` at all, so the committed PNG was decoration and the Dock showed
  // Electron's default. Naming it explicitly costs one line and removes the convention from
  // the chain of things that have to be true.
  const build = await buildConfig()

  assert.equal(build.mac?.icon, 'assets/build/icon.png', 'build.mac.icon must name the icon')
  assert.equal(build.linux?.icon, 'assets/build/icon.png', 'build.linux.icon must name the icon')

  // There is no Windows target today and this test must not invent one. But a `win` block added
  // later without an icon is the same defect again, so the guard is conditional rather than
  // absent.
  if (build.win !== undefined) {
    assert.ok(build.win.icon, 'build.win exists and does not name an icon')
  }
})

test('the icon the build names is a file git actually carries', async () => {
  // A PNG that is generated but untracked is an icon on this machine and a default icon in
  // every clone. `git check-ignore` is not enough on its own — a file can be un-ignored and
  // still never added.
  const build = await buildConfig()
  const icon = build.mac?.icon
  assert.ok(icon, 'build.mac.icon is unset, so there is nothing to look for')

  assert.ok(isTracked(icon), `${icon} is named by the build config and is not tracked by git`)
  assert.ok(
    isTracked('assets/build/icon.svg'),
    'the source art is untracked, so the PNG could not be regenerated from a clone',
  )
  assert.ok(
    isTracked('scripts/render-icon.mjs'),
    'the renderer is untracked, so the PNG is a binary nobody can rebuild',
  )
})

test('the icon is a 1024x1024 PNG with its pixels in it', async () => {
  const png = await readFile(join(root, 'assets/build/icon.png'))

  assert.equal(
    png.subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a',
    'not a PNG — the first eight bytes are the signature and these are not it',
  )

  // IHDR is always the first chunk, so its fields sit at fixed offsets: 8 bytes of signature,
  // then 4 of length and 4 of type before the data starts at 16.
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR', 'first chunk is not IHDR')
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  assert.equal(width, REQUIRED, `electron-builder needs ${REQUIRED}px square; width is ${width}`)
  assert.equal(height, REQUIRED, `electron-builder needs ${REQUIRED}px square; height is ${height}`)
  assert.equal(png[24], 8, 'bit depth must be 8')
  assert.equal(png[25], 6, 'colour type must be 6 (RGBA) — the margin round the tile is transparent')
  assert.equal(png[28], 0, 'interlaced PNGs are not what the scanline length below assumes')

  // Every IDAT chunk, inflated. This is the check a truncated or empty file cannot survive: a
  // non-interlaced 8-bit RGBA image is exactly one filter byte plus four bytes per pixel, per
  // row, and anything short of that is not a whole image however well-formed its header is.
  const idat: Buffer[] = []
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at)
    const type = png.subarray(at + 4, at + 8).toString('ascii')
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length))
    if (type === 'IEND') break
    at += 12 + length
  }
  assert.ok(idat.length > 0, 'the PNG carries no IDAT chunk, so it has no image data at all')

  const raw = inflateSync(Buffer.concat(idat))
  assert.equal(
    raw.length,
    height * (1 + width * 4),
    'the inflated image is not one filter byte and four channels per pixel for every row',
  )

  // …and it is not a blank canvas. Counting distinct byte values in the filtered stream is a
  // crude measure and a decisive one: a flat fill, transparent or otherwise, filters to a run
  // of zeros. Measured 2026-10-01 — this icon 256, an all-transparent 1024 canvas 1. The floor
  // is set far below the first and far above the second, because the point is to refuse a
  // placeholder rather than to fingerprint one particular drawing.
  const seen = new Set<number>()
  for (const byte of raw) seen.add(byte)
  assert.ok(
    seen.size >= 64,
    `the icon has ${seen.size} distinct byte values, which is a placeholder rather than art`,
  )
})

test('the renderer still points at the files it is supposed to rebuild', async () => {
  // The three pieces drift apart quietly: somebody moves the PNG and the script keeps writing
  // to where it used to be, so `npm run package` picks up a stale icon and the rebuild looks
  // like it worked.
  const script = await readFile(join(root, 'scripts/render-icon.mjs'), 'utf8')
  assert.match(script, /assets\/build\/icon\.svg/, 'render-icon.mjs does not read the source art')
  assert.match(script, /icon\.png/, 'render-icon.mjs does not write icon.png')
})
