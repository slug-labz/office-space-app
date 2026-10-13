/**
 * Every id the renderer looks up has to exist in the markup.
 *
 * `$` throws — `` throw new Error(`missing element: ${id}`) `` — and `els` is a module-level
 * const, so it runs the moment `app.ts` is imported. **One typo'd string and the entire renderer
 * fails to load**: no floor, no composer, no error anybody can read, a blank window.
 *
 * That is the worst failure mode in this codebase and it had nothing checking it. It is also the
 * easiest to introduce: adding a row to `els` and adding the element to `index.html` are two
 * edits in two files, and only the second one is visible from the first.
 *
 * ## Why this is a test and not a script
 *
 * Both sides are literal strings — `$('card-doing')` and `id="card-doing"`. Nothing is inferred,
 * nothing is resolved through a type, and there is no dynamic form to be blind to. The one
 * limitation is stated rather than hidden: an id built at runtime cannot be checked here, and
 * `assert` on the count below is what stops the walk silently finding nothing.
 *
 * The reverse direction is checked too, and is a different complaint. An element in the markup
 * that nothing ever looks up is not a crash — it is a row that was left behind when its feature
 * went, and the only way anybody finds out is by reading the HTML.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8')

function renderer(dir = 'src/renderer', acc: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) renderer(path, acc)
    else if (entry.name.endsWith('.ts')) acc.push(path)
  }
  return acc
}

/** `id="..."` in the markup. */
const inMarkup = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!))

/** `$('...')`, `$<T>('...')` and `getElementById('...')` in the renderer. */
const lookedUp = new Map<string, string>()
for (const file of renderer()) {
  const code = readFileSync(join(root, file), 'utf8')
  for (const m of code.matchAll(/(?:\$(?:<[^>]+>)?|getElementById)\(\s*'([^']+)'\s*\)/g)) {
    if (!lookedUp.has(m[1]!)) lookedUp.set(m[1]!, file.replace('src/renderer/', ''))
  }
}

/**
 * The other ways an id is legitimately pointed at, so the reverse check cannot over-report.
 *
 * A `<label for>` and an `aria-labelledby` are references a person relies on and script never
 * touches; a `#id` rule is one the stylesheet relies on. None of them look like a lookup, and a
 * guard that called those elements dead would be wrong in the direction that gets guards deleted.
 *
 * There are none of any kind today — `mic-group` was the only unreferenced id and its styling was
 * on `class="mic"` all along — so this is written to keep the check honest later rather than to
 * excuse anything now.
 */
const referenced = new Set<string>()
for (const m of html.matchAll(/\b(?:for|aria-labelledby|aria-describedby|aria-controls|aria-owns|form|list|headers)="([^"]+)"/g)) {
  for (const id of m[1]!.split(/\s+/).filter(Boolean)) referenced.add(id)
}
for (const sheet of ['src/renderer/styles.css', 'src/renderer/panels.css']) {
  const css = readFileSync(join(root, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of css.matchAll(/#(-?[_a-zA-Z][\w-]*)/g)) referenced.add(m[1]!)
}

test('every element the renderer looks up exists in index.html', () => {
  assert.ok(lookedUp.size > 60, `found only ${lookedUp.size} lookups — the walk or the pattern moved`)
  assert.ok(inMarkup.size > 60, `found only ${inMarkup.size} ids in the markup — the pattern moved`)

  const absent = [...lookedUp]
    .filter(([id]) => !inMarkup.has(id))
    .map(([id, where]) => `${id} (${where})`)

  assert.deepEqual(
    absent,
    [],
    '`$` throws on a missing id and `els` runs at import — one of these is a blank window, not a broken feature',
  )
})

test('every id in the markup is looked up by something', () => {
  // A different complaint, and a much quieter one: an element nothing reaches is a row left
  // behind when its feature went. Not a crash — just markup that outlived its reason, which
  // nobody discovers except by reading the file.
  const unused = [...inMarkup].filter((id) => !lookedUp.has(id) && !referenced.has(id))

  assert.deepEqual(unused, [], 'in the markup and reached by nothing — delete the element, or wire it')
})
