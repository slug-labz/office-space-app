/**
 * A test's temp directory goes when the test does.
 *
 * Two halves, and they are different kinds of check.
 *
 * The first two run the helper: a directory from `tempDir` is gone once the test that made it has
 * ended, through the hook node:test runs rather than through anything this file does; and a call
 * that has no test to hang that hook on fails before it has made anything.
 *
 * The second is a word search, and is labelled as one. PLAN.md takes searches over source text
 * out of its VERIFY lines, because a word being present or absent is not a behaviour, and this is
 * not offered as one. It is a guard in the suite, and what it establishes is narrow: no file under
 * `test/` spells `mkdtemp` except `temp-dir.ts`. That is how every leaking directory here was made,
 * and it is what somebody writing the next test reaches for. It does **not** establish that no test
 * leaks, and these get past it:
 *
 * - a directory made some other way: `mkdir(join(tmpdir(), name))`, a fixed path, a child process
 *   writing into `$TMPDIR`;
 * - a fixture that climbs out of its own directory, as `harness.test.ts` and `roster.test.ts` did
 *   with `join(root, '..')` while their workspace sat directly in the shared temp dir;
 * - code under `src/` that makes temp directories of its own, which is not scanned here;
 * - a name the source builds at run time, such as ``fsp[`mk${'d'}temp`]``, which never spells the
 *   word;
 * - a file or directory under `test/` that is a symlink, which the walk below neither reads nor
 *   enters;
 * - a directory the helper made and could not remove. That one is not silent, though: the hook
 *   throws, and the test that made it fails.
 *
 * A count of what a run leaves behind is the check that sees all of those. It is not a test here
 * because the temp dir is shared: other suites run in it at the same time, on this machine, as a
 * matter of course.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { tempDir } from './temp-dir.js'

const gone = (path: string): Promise<boolean> => lstat(path).then(() => false, () => true)

test('a directory from tempDir is gone once the test that made it has ended', async (t) => {
  let made = ''
  await t.test('a test that makes one and fills it', async (inner) => {
    made = await tempDir(inner, 'office-temp-dir-')
    await mkdir(join(made, 'nested', 'deeper'), { recursive: true })
    await writeFile(join(made, 'nested', 'deeper', 'work.txt'), 'something a test wrote\n')
    assert.equal(await gone(made), false, 'the directory was not there for the test to use')
  })

  // `await t.test` settles after the inner test's own `after` hooks, so by here it has been removed
  // or it never will be.
  assert.notEqual(made, '', 'the inner test never ran, so this checked nothing')
  assert.equal(await gone(made), true, `${made} outlived the test that made it`)
})

test('a call with no test to hang the removal on makes nothing', async () => {
  // Measured on this branch merged with #238, whose new tests still called `workspace()`: tsx ran
  // them without typechecking, `mkdtemp` made the directory, `t.after` then threw on `undefined`,
  // and the directory stayed behind with nothing left to remove it.
  const prefix = `office-temp-dir-no-test-${process.pid}-`
  await assert.rejects(tempDir(undefined as unknown as TestContext, prefix), TypeError)
  const left = (await readdir(tmpdir())).filter((name) => name.startsWith(prefix))
  assert.deepEqual(left, [], 'the directory was made before the call failed, and nothing will remove it')
})

const here = dirname(fileURLToPath(import.meta.url))

/** Every file under `test/`, whatever its extension: a helper in `.mjs` makes directories too. */
async function everyFile(dir: string, into: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await everyFile(path, into)
    else if (entry.isFile()) into.push(path)
  }
  return into
}

test('nothing under test/ makes a temp directory except temp-dir.ts', async () => {
  const helper = join(here, 'temp-dir.ts')
  const self = fileURLToPath(import.meta.url)
  // As a word, so `mkdtempSync`, `mkdtemp as make` and `fs.mkdtemp(` are all found, and so is a
  // comment that names it: this errs towards a false alarm rather than a quiet miss.
  const word = /\bmkdtemp\w*/

  const files = await everyFile(here)

  // The controls. A walk that saw nothing, or a pattern that matches nothing, would pass the
  // assertion at the bottom having checked nothing — the failure every scanner in this repo has to
  // rule out first.
  assert.ok(files.length > 200, `the walk found ${files.length} files under test/, so it is not seeing the directory`)
  assert.ok(files.includes(self), 'the walk does not see this file, so it is not walking test/')
  assert.match(await readFile(helper, 'utf8'), word, 'the pattern misses the one call it allows, so it would miss the rest')
  const users: string[] = []
  for (const file of files) {
    if ((await readFile(file, 'utf8')).includes("from './temp-dir.js'")) users.push(file)
  }
  assert.ok(users.length > 30, `only ${users.length} files import the helper, so the tests are getting directories elsewhere`)

  const offenders: string[] = []
  for (const file of files) {
    if (file === helper || file === self) continue
    const lines = (await readFile(file, 'utf8')).split('\n')
    lines.forEach((line, i) => {
      if (word.test(line)) offenders.push(`${relative(here, file)}:${i + 1}: ${line.trim()}`)
    })
  }

  assert.deepEqual(
    offenders,
    [],
    'a test made a temp directory without `tempDir(t, prefix)`, which is the one call that also ' +
      'removes it. Every run of the suite leaves such a directory behind in the shared temp dir. ' +
      'Use the helper; a directory a whole file shares belongs in temp-dir.ts as a variant, not ' +
      `here.\n  ${offenders.join('\n  ')}`,
  )
})
