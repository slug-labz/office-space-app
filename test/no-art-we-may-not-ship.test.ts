/**
 * The one line of VISION.md §8 that is a fact rather than a description.
 *
 *     ⚠️ **Licence:** munder-difflin's code is MIT (reusable with attribution). Its **pixel art is
 *     non-commercial only** (LimeZu). Original or properly-licensed art if this ever ships
 *     commercially.
 *
 * `theme.ts` and `docs/themes.md` handle this in the design, and thoroughly — the shipped theme is
 * drawn in code, a loaded pack is always `redistributable: false`, and `assets/themes/**` is in
 * `.gitignore` with a paragraph explaining that *"every pack we looked at permits commercial use
 * and forbids redistribution, so committing one would breach the licence you just paid for."*
 *
 * None of that stops a file being committed. `.gitignore` is advice — `git add -f` walks straight
 * past it — and art dropped anywhere other than `assets/themes/` was never covered in the first
 * place. This is the check that the design holds in the repository, which is the only place the
 * question is ever actually decided.
 *
 * It is deliberately about **what is tracked**, not about what is on disk. A purchased pack in
 * your working copy is exactly what the feature is for; the same pack in a commit is a licence
 * breach that ships to everyone who clones.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Extensions art and audio arrive in.
 *
 * `.svg` is not here on purpose: it is markup somebody can read and review in a diff, and this
 * app writes its own. The list is the formats you cannot tell apart by looking at the file.
 */
const NOT_OURS_TO_SHIP =
  /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|aseprite|ase|pyxel|ogg|mp3|wav|flac|m4a|ttf|otf|woff2?|eot)$/i

/**
 * Art this repository drew itself, and may therefore ship.
 *
 * VISION.md §8 asks for *"original or properly-licensed art"*, not for no art — and the rule
 * above is broader than its own reason, which is that you cannot review a binary in a diff.
 * That reason is already why `.svg` is absent from the list. A binary whose **source and
 * renderer are committed beside it** can be reviewed in a diff: you read the markup, and you
 * can rebuild the binary and compare.
 *
 * So this is a map rather than an allowlist, and the value is the thing that earns the
 * exemption. `assets/build/icon.png` is the app icon, and it is allowed only because
 * `assets/build/icon.svg` is the art in reviewable markup and `scripts/render-icon.mjs` turns
 * the second into the first. The test below asserts those are tracked rather than trusting this
 * comment, so deleting either stops the exemption applying instead of leaving a hole somebody
 * can post a purchased sheet through.
 *
 * Adding a row is a licence decision. The question it has to answer is not "is this ours?" but
 * "can somebody reviewing this commit tell?"
 *
 * **This is the second exemption in this file, and they are deliberately not merged.**
 * `A_SCREENSHOT_THE_README_SHOWS` below covers pictures *of* this app, which have no source to
 * rebuild them from and are held instead by where they live, what the README displays and how
 * many bytes they take. This one covers a binary that *does* have a source, and is held by that
 * source being committed. One mechanism stretched over both would be held by whichever test is
 * weaker, so each keeps its own.
 */
const OURS_AND_REBUILDABLE: Readonly<Record<string, readonly string[]>> = {
  'assets/build/icon.png': ['assets/build/icon.svg', 'scripts/render-icon.mjs'],
}

const tracked = (): string[] =>
  execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean)

/**
 * The one exemption: screenshots of the app the README shows.
 *
 * Opened 2026-10-01, when `README.md` gained its first picture. The rule above is about a licence
 * — a purchased pack reaching everyone who clones — and a photograph of this app's own procedurally
 * drawn theme is not somebody else's art. But the check cannot tell the two apart by looking at a
 * PNG, so the hole is cut as narrowly as it can be and a second test below holds it open no wider:
 * one flat directory, one extension, a name shape with no room to hide a path in, every file
 * displayed by the README, and a size no sprite sheet fits through.
 *
 * **What no test here can see**, and so is written down instead: a screenshot taken while a
 * purchased pack is loaded contains that pack's art, and would breach the same licence this file
 * exists to protect. Screenshots are taken against the code-drawn theme. `docs/themes.md` carries
 * the same rule next to the promise that packs never leave your machine.
 */
const A_SCREENSHOT_THE_README_SHOWS = /^assets\/screenshots\/[a-z0-9-]+\.png$/

test('the scan is reading the repository, or every result below is a clean bill on nothing', () => {
  const files = tracked()
  assert.ok(files.length > 100, `git ls-files returned ${files.length} — this is not reading the repo`)
  assert.ok(files.includes('VISION.md'), 'the file this check quotes is not tracked, so the paths are wrong')
})

test('no image, sprite sheet, sound or font is committed', () => {
  const art = tracked()
    .filter((f) => NOT_OURS_TO_SHIP.test(f))
    .filter((f) => !A_SCREENSHOT_THE_README_SHOWS.test(f))
    .filter((f) => !Object.hasOwn(OURS_AND_REBUILDABLE, f))
  assert.deepEqual(
    art,
    [],
    'these are tracked, and this repository ships no art it did not draw. Every pixel pack the ' +
      'project looked at permits commercial use and forbids redistribution, so committing one ' +
      'breaches the licence somebody paid for — and it reaches everyone who clones. Keep it in ' +
      'assets/themes/, which is ignored, and let the office load it at runtime.',
  )
})

test('the screenshot exemption stays the size of a screenshot', async () => {
  // The exemption above removes files from the licence check, so this is what keeps it honest.
  //
  // It asks git, not the disk, for the same reason the rest of this file does: the rule is about
  // what is **tracked**. A screenshot sitting in a working copy is nobody's licence problem, and
  // a first draft of this test read the directory instead — which both failed typecheck for an
  // unused binding and would have been asking the wrong question.
  //
  // Nothing tracked there means nothing is exempted, and the check above is then guarding every
  // image in the repository by itself. That is a real pass, not a vacuous one: there is no state
  // in which this test goes quiet while something is being let through.
  const readme = await readFile(join(repo, 'README.md'), 'utf8')
  const shipped = tracked().filter((f) => f.startsWith('assets/screenshots/'))

  // Every tracked file there is a .png with a plain name — no subdirectory, no second extension,
  // nothing that reads as a path.
  assert.deepEqual(
    shipped.filter((f) => !A_SCREENSHOT_THE_README_SHOWS.test(f)),
    [],
    'a tracked file under assets/screenshots/ is not a plainly-named .png, so it is exempt from ' +
      'the licence check while being something other than a screenshot',
  )

  // And each one is on screen in the README. That is the whole justification for the exemption:
  // these are the pictures the front page shows. One nobody displays is just art in the repo.
  assert.deepEqual(
    shipped.filter((f) => !readme.includes(f)),
    [],
    'tracked under assets/screenshots/ but not shown in README.md — the exemption is for images ' +
      'the README displays, so an undisplayed one has no reason to be exempt',
  )

  // A cap a screenshot fits through and a sprite sheet does not. Measured 2026-10-01: two files,
  // 390,637 and 376,304 bytes, 749 KB together.
  const sizes = await Promise.all(
    shipped.map(async (f) => ({ f, size: (await stat(join(repo, f))).size })),
  )
  assert.deepEqual(
    sizes.filter(({ size }) => size > 1_048_576).map(({ f }) => f),
    [],
    'a screenshot over 1MB; that is the size of an asset, not of a picture of the app',
  )
  const total = sizes.reduce((n, { size }) => n + size, 0)
  assert.ok(
    total <= 3 * 1_048_576,
    `assets/screenshots/ holds ${(total / 1048576).toFixed(1)}MB; it held 0.7MB when the ` +
      `exemption was opened. A clone pays for every byte of this, so it stays small or it stops ` +
      `being an exemption and becomes a pack.`,
  )
})

test('the binaries this repo does ship can be rebuilt from what is beside them', () => {
  // The exemption above is a claim; this is the part that makes it true. It fails in both
  // directions on purpose — a row whose source went missing is a hole, and a row whose binary
  // went missing is a stale permission nobody will notice until something is dropped into it.
  const files = new Set(tracked())

  for (const [binary, sources] of Object.entries(OURS_AND_REBUILDABLE)) {
    assert.ok(
      files.has(binary),
      `${binary} is exempted from the art rule and is not tracked — drop the exemption with it`,
    )
    for (const source of sources) {
      assert.ok(
        files.has(source),
        `${binary} ships only because ${source} is committed beside it, and ${source} is not ` +
          'tracked. Either commit it or stop shipping the binary: without it nobody reviewing ' +
          'this repository can tell what that file is.',
      )
    }
  }
})

test('a theme pack dropped in the right place stays out of the repository', () => {
  // Asserted against the real `.gitignore` rather than a copy of its rules here, for the same
  // reason `sharing.ts` asks git rather than tabulating: two definitions of one fact drift.
  const ignored = (path: string): boolean => {
    try {
      execFileSync('git', ['check-ignore', '--no-index', '--quiet', '--', path], { cwd: repo, stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
  assert.equal(ignored('assets/themes/limezu/characters.png'), true, 'a purchased pack is not ignored')
  assert.equal(ignored('assets/themes/limezu/theme.json'), true, 'its manifest is not ignored either')
  assert.equal(ignored('assets/themes/README.md'), false, 'the note explaining the directory must still ship')
})

/*
 * The flag that decides whether art may travel with the project, checked at the source rather
 * than through behaviour.
 *
 * `theme-view.ts` and `theme.test.ts` already cover what the flag *does*. This covers who is
 * allowed to set it true, which is a different question and the one a new theme would get wrong.
 */
test('only the theme drawn in code claims it may be redistributed', async () => {
  const files: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(join(repo, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(`${dir}/${entry.name}`)
      else if (entry.name.endsWith('.ts')) files.push(`${dir}/${entry.name}`)
    }
  }
  await walk('src')
  assert.ok(files.length > 40, `only ${files.length} source files — this scan is reading nothing`)

  const claims: string[] = []
  for (const file of files) {
    const source = await readFile(join(repo, file), 'utf8')
    for (const _ of source.matchAll(/redistributable:\s*true/g)) claims.push(file)
  }

  // `procedural.ts` is the theme this app draws itself, and `mock.ts` is the harness standing in
  // for it. Anything else setting this true is a pack claiming a permission its licence does not
  // grant — and `main.ts` is careful to hard-code `false` for every pack it loads.
  assert.deepEqual(
    [...new Set(claims)].sort(),
    ['src/renderer/mock.ts', 'src/shared/theme/procedural.ts'],
    'something other than the theme drawn in code claims its art may be redistributed',
  )
})
