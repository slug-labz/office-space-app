/**
 * Every interactive vocabulary answers all four states.
 *
 * E4: *"hover, active and disabled on everything interactive — several controls have none."*
 * The way that item was found is the way it should stay found — by counting. Before this,
 * `styles.css` and `panels.css` between them had 32 `:hover` rules, 26 `:disabled` rules,
 * 33 `:focus-visible` rules and **zero** `:active`. Nobody notices a missing pressed state by
 * looking; you notice it by clicking a slow button twice.
 *
 * Checked per *vocabulary* rather than per selector. There are four shared ones — `.btn`,
 * `.pill`, `.control`, `.dial` — and a control that opts into one of them should inherit every
 * state rather than re-declare them. A test that demanded four rules per class would push the
 * codebase the wrong way.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src/renderer/styles.css'), 'utf8') +
  readFileSync(join(root, 'src/renderer/panels.css'), 'utf8')

/**
 * The shared vocabularies. Anything interactive is expected to be one of these.
 *
 * `sel__trigger` rather than `dial`, and the difference is the point: Wave A replaced the native
 * `<select>` with a picker the app owns, so `.dial` is a bare positioning wrapper and the control
 * is the trigger inside it. The first version of this list said `dial`, reported it had no
 * `:hover` either, and that was the clue — a "control" with no hover rule anywhere is usually not
 * a control.
 */
const VOCABULARIES = ['btn', 'pill', 'control', 'sel__trigger']

for (const name of VOCABULARIES) {
  test(`.${name} answers hover, active, focus and disabled`, () => {
    const missing = (['hover', 'active', 'focus-visible', 'disabled'] as const).filter(
      (state) => !new RegExp(`\\.${name}[^{,]*:${state}`).test(css),
    )
    assert.deepEqual(
      missing,
      [],
      `.${name} has no :${missing.join(', :')} rule. A control with no pressed state gives no ` +
        `feedback between the click and the result, and the reasonable response to nothing is ` +
        `to click again.`,
    )
  })
}

test('a pressed state never applies to a control that is refusing the click', () => {
  // `:active` fires on a disabled button in several browsers. Without the guard a control that
  // cannot be used still appears to accept the press, which is exactly the confusion the
  // disabled sweep existed to remove.
  const pressed = [...css.matchAll(/([^{}]*:active[^{}]*)\{/g)].map((m) => m[1]!.trim())
  assert.ok(pressed.length > 0, 'no :active rules found — the sweep has been undone')

  const unguarded = pressed.filter(
    (selector) =>
      // Borderless things have no disabled variant and are never rendered disabled.
      !/:not\(:disabled\)/.test(selector) && !/\.(handoff|mark|music__hit)/.test(selector),
  )
  assert.deepEqual(unguarded, [], `these press without checking disabled: ${unguarded.join(' | ')}`)
})
