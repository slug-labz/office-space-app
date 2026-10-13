import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'

import { scanThemes, THEMES_DIR } from '../src/shared/theme/registry.js'
import { proceduralTheme } from '../src/shared/theme/procedural.js'
import { PAINT_DIRECTIONS } from '../src/shared/character/painter.js'

import { tempDir } from './temp-dir.js'

/** Build a throwaway workspace containing the given theme directories. */
async function workspace(t: TestContext, themes: Record<string, Record<string, string>>): Promise<string> {
  const root = await tempDir(t, 'office-theme-')
  for (const [name, files] of Object.entries(themes)) {
    const dir = join(root, THEMES_DIR, name)
    await mkdir(dir, { recursive: true })
    for (const [file, content] of Object.entries(files)) {
      await writeFile(join(dir, file), content)
    }
  }
  return root
}

const validManifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'limezu',
    name: 'LimeZu — Modern Interiors',
    credit: 'Pixel art by LimeZu (limezu.itch.io), used under a purchased licence.',
    frameWidth: 16,
    frameHeight: 32,
    sheets: ['Adam_walk.png'],
    layout: { rows: { down: 0, up: 1, right: 2 }, steps: [0, 1, 2] },
    ...over,
  })

// ───────────────────────────────────────────────────────────── built-in ────

test('the built-in theme needs nothing and always works', () => {
  const frames = proceduralTheme.framesFor('wren-review')
  assert.equal(proceduralTheme.redistributable, true, 'the shipped theme must be shippable')
  for (const d of PAINT_DIRECTIONS) {
    assert.equal(frames.frames[d].length, 3, `${d} needs three steps`)
  }
})

test('the built-in theme is deterministic', () => {
  const a = proceduralTheme.framesFor('reviewer').frames.down[0]!
  const b = proceduralTheme.framesFor('reviewer').frames.down[0]!
  assert.deepEqual(Array.from(a), Array.from(b))
})

// ───────────────────────────────────────────────────────────── discovery ────

test('a fresh clone has no themes and no problems', async (t) => {
  // A missing themes directory is the normal state, not a fault. This distinction is the
  // whole reason discovery reports problems separately from results.
  const root = await tempDir(t, 'office-empty-')
  const scan = await scanThemes(root)
  assert.deepEqual(scan.themes, [])
  assert.deepEqual(scan.problems, [], 'a missing directory must not be reported as broken')
})

test('a valid theme is discovered', async (t) => {
  const root = await workspace(t, {
    limezu: { 'theme.json': validManifest(), 'Adam_walk.png': 'not-really-a-png' },
  })
  const scan = await scanThemes(root)
  assert.equal(scan.problems.length, 0, JSON.stringify(scan.problems))
  assert.equal(scan.themes.length, 1)
  assert.equal(scan.themes[0]!.id, 'limezu')
  assert.equal(scan.themes[0]!.frameWidth, 16)
  assert.deepEqual(scan.themes[0]!.layout.steps, [0, 1, 2])
})

// ─────────────────────────────────────── failures must be visible, always ───

test('a theme with no manifest is reported', async (t) => {
  const root = await workspace(t, { mystery: { 'sheet.png': 'x' } })
  const scan = await scanThemes(root)
  assert.equal(scan.themes.length, 0)
  assert.equal(scan.problems.length, 1)
  assert.match(scan.problems[0]!.reason, /theme\.json/)
})

test('malformed JSON is reported with the parser error', async (t) => {
  const root = await workspace(t, { broken: { 'theme.json': '{ "id": "x", }' } })
  const scan = await scanThemes(root)
  assert.equal(scan.themes.length, 0)
  assert.match(scan.problems[0]!.reason, /invalid JSON/)
})

test('a theme without attribution will not load', async (t) => {
  // Nearly every licence permitting commercial use requires credit. A theme that cannot
  // state its own is refused rather than quietly used.
  const root = await workspace(t, {
    anon: { 'theme.json': validManifest({ credit: '   ' }), 'Adam_walk.png': 'x' },
  })
  const scan = await scanThemes(root)
  assert.equal(scan.themes.length, 0)
  assert.match(scan.problems[0]!.reason, /credit/)
})

test('a manifest promising sheets it does not have is reported', async (t) => {
  // Otherwise this surfaces much later as a blank character, with nothing pointing at the cause.
  const root = await workspace(t, {
    limezu: { 'theme.json': validManifest({ sheets: ['Adam_walk.png', 'Ghost.png'] }), 'Adam_walk.png': 'x' },
  })
  const scan = await scanThemes(root)
  assert.equal(scan.themes.length, 0)
  assert.match(scan.problems[0]!.reason, /Ghost\.png/)
})

test('the built-in id is reserved', async (t) => {
  const root = await workspace(t, {
    fake: { 'theme.json': validManifest({ id: 'procedural' }), 'Adam_walk.png': 'x' },
  })
  const scan = await scanThemes(root)
  assert.equal(scan.themes.length, 0)
  assert.match(scan.problems[0]!.reason, /reserved/)
})

test('a bad layout is reported rather than half-loaded', async (t) => {
  const root = await workspace(t, {
    wonky: { 'theme.json': validManifest({ layout: { rows: { down: 0, up: 1 }, steps: [0, 1, 2] } }), 'Adam_walk.png': 'x' },
  })
  const scan = await scanThemes(root)
  assert.equal(scan.themes.length, 0)
  assert.match(scan.problems[0]!.reason, /right/)
})

test('one broken theme does not hide a working one', async (t) => {
  const root = await workspace(t, {
    good: { 'theme.json': validManifest({ id: 'good' }), 'Adam_walk.png': 'x' },
    bad: { 'theme.json': 'not json at all' },
  })
  const scan = await scanThemes(root)
  assert.equal(scan.themes.length, 1, 'the working theme must still load')
  assert.equal(scan.themes[0]!.id, 'good')
  assert.equal(scan.problems.length, 1, 'and the broken one must still be reported')
})

test('an unreadable themes directory is a problem, not an absence', async (t) => {
  // The distinction that matters: "you have no themes" and "I could not look" are different
  // answers, and only one of them should leave the user wondering.
  const root = await workspace(t, { any: { 'theme.json': validManifest() } })
  const dir = join(root, THEMES_DIR)
  try {
    await chmod(dir, 0o000)
    const scan = await scanThemes(root)
    if (scan.problems.length === 0) {
      // Running as root defeats permission bits. Reported as skipped rather than passed: the
      // check did not run, and a suite that counts it as coverage is claiming something it did
      // not establish.
      t.skip('permissions are not enforced for this user, so an unreadable directory cannot be made')
    } else {
      assert.match(scan.problems[0]!.reason, /cannot read/)
    }
  } finally {
    await chmod(dir, 0o755).catch(() => {})
  }
})
