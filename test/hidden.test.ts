/**
 * `hidden` has to mean hidden.
 *
 * `[hidden] { display: none }` is a **user-agent** rule, which means any author rule that sets
 * `display` on the same element beats it on specificity alone. The result is an element whose
 * attribute says hidden and whose layout says otherwise, and nothing reports the disagreement:
 * `el.hidden` is `true`, the markup reads correctly, and the thing is on screen.
 *
 * Both instances of this shipped. `.music` laid out its whole panel — a third of the strip — and
 * `.slash` laid out a 2px sliver above the composer at all times. Neither was caught by a type,
 * a test or a review; the first was caught by comparing `hidden` against `offsetHeight` in the
 * running app, and the second by looking for the same shape everywhere else.
 *
 * So this checks the shape rather than the two instances: any class the markup can mark `hidden`
 * that also has an author `display` rule needs its own `[hidden]` pair. Cheap, and it fails on
 * the next panel somebody adds rather than after somebody notices a sliver.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

test('every hideable element that sets its own display also un-sets it when hidden', () => {
  const html = read('src/renderer/index.html')
  const css = read('src/renderer/styles.css') + read('src/renderer/panels.css')

  // Classes on an element the markup marks `hidden`, in either attribute order.
  const hideable = new Set<string>()
  for (const m of html.matchAll(/<[^>]*\bclass="([^"]+)"[^>]*\bhidden\b/g)) {
    for (const c of m[1]!.split(/\s+/)) hideable.add(c)
  }
  for (const m of html.matchAll(/<[^>]*\bhidden\b[^>]*\bclass="([^"]+)"/g)) {
    for (const c of m[1]!.split(/\s+/)) hideable.add(c)
  }

  assert.ok(hideable.size > 0, 'no hideable elements found — the markup scan has stopped working')

  // Every rule as (selectors, body). A selector *list* counts: the third instance of this bug
  // set `display` through `.control, .pill, .voice, .ghost, #send { … }`, and the first version
  // of this test looked only for `.ghost {` — so it read the guard as present and the app shipped
  // a Stop button that was `hidden` and on screen. A test that can only see the shape of the two
  // bugs it was written for is a test that finds the third one by not finding it.
  // Comments first. `([^{}]+)` before a `{` swallows everything since the last brace, so a rule
  // preceded by a comment block came out with the comment glued to its selector and matched
  // nothing — which read as "unguarded" for two classes that have been guarded since they were
  // written.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rules = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
    selectors: m[1]!.split(',').map((x) => x.trim()),
    body: m[2]!,
  }))

  const unguarded = [...hideable].filter((cls) => {
    const setsDisplay = rules.some(
      (r) => /(^|[\s;])display:/.test(r.body) && r.selectors.some((sel) => sel === `.${cls}`),
    )
    const guarded = rules.some((r) => r.selectors.some((sel) => sel === `.${cls}[hidden]`))
    return setsDisplay && !guarded
  })

  assert.deepEqual(
    unguarded,
    [],
    `these set display and can be marked hidden, so hidden will not hide them. ` +
      `Add \`.x[hidden] { display: none }\`: ${unguarded.join(', ')}`,
  )
})
