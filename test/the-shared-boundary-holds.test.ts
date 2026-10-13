/**
 * `src/shared/` holds pure decisions and must not reach into `src/renderer/`. This checks that,
 * and — the part that matters — it checks that the check can fail.
 *
 * `PLAN.md` §8 proved this boundary with a shell one-liner, and that line was strengthened once
 * already, on 2026-09-06, after somebody tested it instead of trusting it: it had read one quote
 * style and one flat directory. The replacement read both quote styles and recursed, and the note
 * in `PLAN.md` says of it — correctly, at the time — *"what changed is that it can now fail."*
 *
 * On 2026-10-01 it was tested again and it could not. Measured, three ways past it:
 *
 *     import '../renderer/side-effect.js'               was not caught — no `from`
 *     const m = await import('../renderer/draw.js')     was not caught — no `from`
 *     const m = require('../renderer/draw.js')          was not caught — no `from`
 *
 * And worse than any evasion, it passed on nothing at all. `test -z "$(grep -rlE … src/shared/)"`
 * exits 0 when `src/shared/` **does not exist**, because grep's complaint goes to stderr and
 * `test -z ""` is true of the empty stdout. §4b has been restructuring these directories all
 * month. A rename would have left the line ticked and green over a check of nothing.
 *
 * So the outcome moved from a one-liner to this file, which is also the shape nine other §8 lines
 * already use. Three things are asserted, and the third is the one that keeps the other two
 * honest:
 *
 * 1. `src/shared/` exists and still holds the bulk of the codebase's pure decisions. A bare
 *    `test -d` would pass on an empty directory, so this counts files.
 * 2. No file under it reaches into the renderer, in any of the five forms.
 * 3. **The scanner catches all five forms and none of three lookalikes.** Without this, a pattern
 *    that silently stopped matching would pass assertion 2 on every tree forever — which is the
 *    whole family of bug this file exists for.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()

/**
 * The five ways one module can name another, in one pattern: a bare specifier after `from`, after
 * `import` as a statement or a call, or after `require`.
 *
 * `import\(|require\(` on its own would have been wrong — it flags every dynamic import in
 * `src/shared/`, including `await import('./lazy-shared.js')`, which is nobody's boundary
 * violation. The specifier has to be part of the match, not just the keyword.
 */
const REACHES_RENDERER = /(?:from|import|require)\s*\(?\s*['"][^'"]*renderer/

/** Every `.ts` under a directory, recursively, as repo-relative paths. */
async function sources(dir: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) await sources(rel, acc)
    else if (entry.name.endsWith('.ts')) acc.push(rel)
  }
  return acc
}

test('the scanner catches every form of reaching into the renderer, and no lookalike', () => {
  // This runs first on purpose. If it fails, the next test's silence means nothing.
  const caught = [
    `import { draw } from '../renderer/draw.js'`,
    `import "../renderer/side-effect.js"`,
    `const m = await import('../renderer/draw.js')`,
    `const m = require('../renderer/draw.js')`,
    `export * from '../renderer/draw.js'`,
  ]
  const allowed = [
    `import { pure } from './grid.js'`,
    `const dir = join(dist, 'renderer')`,
    `await import('./lazy-shared.js')`,
    `// the renderer draws this; we only decide it`,
  ]

  for (const line of caught) {
    assert.match(line, REACHES_RENDERER, `a boundary violation the scanner would miss: ${line}`)
  }
  for (const line of allowed) {
    assert.doesNotMatch(line, REACHES_RENDERER, `the scanner flags something legitimate: ${line}`)
  }
})

test('src/shared/ is still where the pure decisions live', async () => {
  // A directory that has been renamed or emptied is the case the old shell check could not see:
  // it reported success over nothing. Counting files is what separates "clean" from "absent".
  let files: string[]
  try {
    files = await sources('src/shared')
  } catch (cause) {
    assert.fail(`src/shared/ could not be read, which is not the same as clean: ${cause}`)
  }

  // 79 files on dev at b7957c3, 2026-10-01. The floor is set well under that so ordinary deletion
  // does not fail the suite, and far enough above zero that a restructure moving the boundary
  // elsewhere does — which is the failure this number exists to catch, not a size target.
  assert.ok(
    files.length >= 50,
    `src/shared/ holds ${files.length} .ts files; it held 79 on 2026-10-01. ` +
      `If the pure decisions have moved, this outcome's VERIFY is checking the wrong directory.`,
  )
})

test('nothing in src/shared/ reaches into src/renderer/', async () => {
  const files = await sources('src/shared')
  const offenders: string[] = []

  for (const file of files) {
    const text = await readFile(join(root, file), 'utf8')
    for (const [n, line] of text.split('\n').entries()) {
      if (REACHES_RENDERER.test(line)) offenders.push(`${file}:${n + 1}  ${line.trim()}`)
    }
  }

  assert.deepEqual(
    offenders,
    [] as string[],
    `src/shared/ holds pure decisions and src/renderer/ draws them. These cross that line:\n` +
      offenders.join('\n'),
  )
})
