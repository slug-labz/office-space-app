/**
 * Nothing moves without asking.
 *
 * `prefers-reduced-motion` is a preference somebody sets because movement makes them ill. These
 * stylesheets honoured it in three places out of four, and the one that did not was the worst
 * candidate to miss:
 *
 *     #mic[data-state='listening']::before { animation: mic-live 1.4s ease-in-out infinite; }
 *
 * A red dot pulsing for as long as the microphone is open — indefinite, repeating, and in the
 * corner of your eye while you are trying to speak. Every other moving thing was already
 * accounted for: `.bubble` animates only under `no-preference`, `.dot` and `.flier` stop under
 * `reduce`. Three careful decisions and one omission, which is the ratio this repository keeps
 * finding and the reason the rule is checked rather than remembered.
 *
 * Verified in the running app with the media feature emulated, before and after:
 *
 *     no-preference   mic ::before = mic-live (infinite)
 *     reduce          mic ::before = none     (1)
 *
 * ## The two shapes that count as asking
 *
 * Either is fine and both are in use here:
 *
 *   - **opt in** — the whole rule lives inside `@media (prefers-reduced-motion: no-preference)`,
 *     so it never applies to somebody who asked for less. `.bubble` does this.
 *   - **opt out** — the rule is unconditional and a `@media (prefers-reduced-motion: reduce)`
 *     block later in the file switches it off for the same selector. `.dot` and `.flier` do this,
 *     and now `#mic` does.
 *
 * ## What this cannot check
 *
 * That the reduce rule actually *wins*. It compares selector text, not cascade order or
 * specificity — a `reduce` block placed above the rule it is meant to cancel would satisfy this
 * and change nothing. `css-applied.test.ts` carries the same limitation for the same reason:
 * there is no cascade in this harness to ask. The CDP reading above is the receipt that it wins
 * today; this is the tripwire for the next animation somebody adds.
 *
 * It also only sees CSS. An animation driven from JavaScript — a `requestAnimationFrame` loop,
 * a canvas redraw — is invisible here, and `floor-view.ts` is full of them.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

interface Rule {
  readonly file: string
  readonly selector: string
  readonly declaration: string
  /** The `prefers-reduced-motion` value this rule sits under, if any. */
  readonly under: string | null
  readonly stops: boolean
}

/** Every rule that mentions `animation` or `transition`, and the media context it sits in. */
function movingRules(): Rule[] {
  const found: Rule[] = []
  for (const file of ['src/renderer/styles.css', 'src/renderer/panels.css']) {
    const css = strip(readFileSync(join(root, file), 'utf8'))
    const media: (string | null)[] = []
    for (const m of css.matchAll(/@media([^{]*)\{|([^{}@]+)\{([^{}]*)\}|\}/g)) {
      if (m[1] !== undefined) {
        const q = m[1]
        media.push(/prefers-reduced-motion\s*:\s*([\w-]+)/.exec(q)?.[1] ?? null)
        continue
      }
      if (m[2] === undefined) {
        media.pop()
        continue
      }
      const body = m[3] ?? ''
      const decl = /\b(animation|transition)\s*:\s*([^;]+)/.exec(body)
      if (!decl) continue
      found.push({
        file,
        selector: m[2].trim().split('\n').pop()!.trim(),
        declaration: decl[0].replace(/\s+/g, ' ').trim(),
        under: media.length ? (media[media.length - 1] ?? null) : null,
        stops: /:\s*none\b/.test(decl[0]),
      })
    }
  }
  return found
}

test('every moving thing either asks first or can be switched off', () => {
  const rules = movingRules()

  // The control. A parse that finds nothing passes every assertion below it while the app is
  // full of animation — which is the failure this whole file exists to catch, one level up.
  assert.ok(
    rules.length >= 5,
    `only ${rules.length} animation or transition rules found across both stylesheets. The app ` +
      `has more than that, so the parse is wrong and every check below it is vacuous.`,
  )
  assert.ok(
    rules.some((r) => r.under === 'reduce' && r.stops),
    'no `reduce` block switches anything off — the parse is not seeing media context',
  )

  // Selectors that a `reduce` block turns off. Text comparison, deliberately: see the header.
  const switchedOff = new Set(rules.filter((r) => r.under === 'reduce' && r.stops).map((r) => r.selector))

  const unguarded = rules
    .filter((r) => !r.stops)
    .filter((r) => r.under !== 'no-preference')
    .filter((r) => !switchedOff.has(r.selector))
    .map((r) => `${r.file.split('/').pop()}  ${r.selector}  { ${r.declaration} }`)

  assert.deepEqual(
    unguarded,
    [],
    'these move whatever the reader asked for. Either put the rule inside ' +
      '`@media (prefers-reduced-motion: no-preference)`, or add the selector to a ' +
      `\`reduce\` block that sets it to none:\n  ${unguarded.join('\n  ')}`,
  )
})

test('an infinite animation is never the one left unguarded', () => {
  // Stated separately because it is the case that matters most and the case that was wrong. A
  // 140ms fade nobody guards is a small fault; something that repeats forever is the thing the
  // preference exists for.
  const forever = movingRules().filter((r) => /\binfinite\b/.test(r.declaration))
  assert.ok(forever.length > 0, 'no infinite animations found at all — the parse is not reading declarations')

  const switchedOff = new Set(
    movingRules().filter((r) => r.under === 'reduce' && r.stops).map((r) => r.selector),
  )
  const loose = forever
    .filter((r) => r.under !== 'no-preference' && !switchedOff.has(r.selector))
    .map((r) => `${r.selector} { ${r.declaration} }`)

  assert.deepEqual(
    loose,
    [],
    `these repeat forever and cannot be switched off:\n  ${loose.join('\n  ')}`,
  )
})
