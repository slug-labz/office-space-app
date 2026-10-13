/**
 * The palette is declared twice. This is what makes that safe.
 *
 * `src/shared/palette.ts` is the source and `src/renderer/styles.css` carries a static copy of
 * the default theme so the first paint has colour before any script runs. The duplication is
 * deliberate and explained in both files; **this test is the reason it is allowed.**
 *
 * It also catches the failure CSS is worst at reporting: a rule referring to a custom property
 * that nothing declares renders as *nothing at all*, silently, and looks like a styling mistake
 * rather than a missing value. So the second test walks the stylesheet for `var(--…)` uses and
 * insists each one is declared somewhere.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { DEFAULT_PALETTE, EDGE_CONTRAST, PALETTES, TEXT_CONTRAST, contrast, cssVariables, legibleOn, paletteById, semanticVariables } from '../src/shared/palette.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src/renderer/styles.css'), 'utf8')
/**
 * The second stylesheet, and the one that has actually had this bug.
 *
 * `panels.css` declares no colours of its own — every value in it is a token from `styles.css`.
 * Its own header records the time that went wrong: a change used `--accent`, `--ink-dim`,
 * `--warn` and `--frame-bright`, none of which existed then, and an undefined custom property
 * resolves to *nothing*, so the elements rendered unstyled rather than wrong. The check below
 * covered the file where the bug had not happened and not the file where it had.
 */
const panels = readFileSync(join(root, 'src/renderer/panels.css'), 'utf8')

/**
 * Everything `:root` declares across both stylesheets, including the aliases, resolved one level.
 *
 * Both, because both are allowed to declare: `styles.css` owns the palette, and `panels.css`
 * declares the two layout multipliers the settings panel overrides at runtime. Reading only the
 * first would report those two as undeclared, which is how this function was written and how it
 * first failed.
 */
function declared(): Map<string, string> {
  const out = new Map<string, string>()
  for (const sheet of [css, panels]) {
    let at = sheet.indexOf(':root {')
    while (at !== -1) {
      const block = sheet.slice(at, sheet.indexOf('}', at))
      for (const [, name, value] of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        out.set(name!, value!.trim())
      }
      at = sheet.indexOf(':root {', at + 1)
    }
  }
  // One level of alias — `--lamp: var(--accent)` resolves to whatever `--accent` is.
  for (const [name, value] of out) {
    const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value)
    if (alias) out.set(name, out.get(alias[1]!) ?? value)
  }
  return out
}

test('the stylesheets declare exactly the default palette, value for value', () => {
  const inCss = declared()
  for (const [name, value] of Object.entries(cssVariables(DEFAULT_PALETTE))) {
    assert.equal(
      inCss.get(name)?.toLowerCase(),
      value.toLowerCase(),
      `${name}: styles.css and palette.ts disagree. Edit both, or the interface and the room drift apart.`,
    )
  }
})

test('every var(--…) either stylesheet uses is declared somewhere', () => {
  const inCss = declared()
  // Both files, one set. `panels.css` is loaded second and composes what `styles.css` declares,
  // so a token missing from the first is missing for both.
  const used = new Set(
    [...`${css}\n${panels}`.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!),
  )
  const missing = [...used].filter((name) => !inCss.has(name))
  assert.deepEqual(
    missing,
    [],
    `undeclared custom properties render as nothing at all, silently: ${missing.join(', ')}`,
  )
})

test('panels.css invents no colour outside :root', () => {
  // The boundary that lets a second stylesheet exist without the palette drifting: it may
  // *compose* what is declared, never invent. A literal in a component rule survives a theme
  // change looking exactly the same, which is the failure a token system exists to prevent.
  //
  // The exception is the `:root` blocks, and it is the same exception `styles.css` has. Those
  // are the static mirror of the palette — declared so the first paint has colour before any
  // script runs — and the test above already holds them to the palette value for value. So the
  // rule is not "no hex in this file"; it is "no hex in a rule that draws something".
  const withoutRoot = panels.replace(/:root\s*\{[^}]*\}/g, '')
  const literals = [...withoutRoot.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
  assert.deepEqual(
    literals,
    [],
    `panels.css must use tokens outside :root, not literals — found ${literals.join(', ')}`,
  )
})

test('every semantic token is derived from the palette, not authored beside it', () => {
  // The property that keeps a new theme cheap. `semanticVariables` pairs every surface with a
  // foreground — shadcn's idea, and the reason no component in this app picks a text colour —
  // but a pair whose value was *typed* rather than derived is a twenty-third question every
  // future theme has to answer, and the first one somebody gets wrong.
  //
  // So: every semantic value must be a colour the palette declares, **or** that colour after the
  // contrast floor has moved it.
  //
  // The second clause is new and it is a real widening, so it is worth stating what it does not
  // permit. `legibleOn` is a pure function of a palette colour and a set of surfaces from the
  // same palette; it cannot introduce a hue the theme did not choose, and it moves the colour by
  // the least amount that clears the floor. A hex somebody typed still fails, which is the thing
  // this test was written to catch. What it no longer fails is a colour the mapping *computed*
  // from the theme — and refusing those would mean an interface token could never be made
  // legible without hand-editing every palette, which is exactly the maintenance burden the
  // "derived, not authored" rule exists to prevent.
  for (const palette of PALETTES) {
    const declared = [
      ...palette.ground,
      palette.line,
      palette.ink,
      palette.inkDim,
      palette.inkFaint,
      ...Object.values(palette.syntax),
      ...Object.values(palette.roles),
    ]
    const sources = new Set(declared.map((c) => c.toLowerCase()))
    const floored = new Set(
      declared.flatMap((c) =>
        [TEXT_CONTRAST, EDGE_CONTRAST].flatMap((min) => [
          legibleOn(c, palette.ground, min).toLowerCase(),
          legibleOn(c, [palette.ground[1], palette.ground[2], palette.ground[3]], min).toLowerCase(),
        ]),
      ),
    )

    for (const [name, value] of Object.entries(semanticVariables(palette))) {
      assert.ok(
        sources.has(value.toLowerCase()) || floored.has(value.toLowerCase()),
        `${palette.id} ${name} is ${value}, which is neither a colour ${palette.id} declares nor ` +
          `one of them after the contrast floor — it was authored, not derived`,
      )
    }
  }
})

/**
 * Ink that can land on any of the grounds, and is therefore held to 4.5:1 against all of them.
 *
 * A list, and lists go stale. `--lamp-text` was added to the palette and did not appear here,
 * and the test below went on passing while claiming in its own name to cover every text token —
 * a check that could not have failed for the thing it was being trusted for. The guard under
 * this list is what makes it not go stale again.
 */
const INK_ON_ANY_GROUND = ['--ink-faint', '--muted-foreground', '--foreground', '--syn-comment', '--lamp-text'] as const

/**
 * Emitted variables shaped like ink that this test deliberately does not check, and why.
 *
 * The point is that every one of them is a decision somebody made, written down, rather than a
 * name that quietly never reached an assertion.
 */
const NOT_CHECKED_HERE: Readonly<Record<string, string>> = {
  '--ink-dim': 'reaches the screen as --slate and --foreground, both checked',
  '--card-foreground': 'text on --card only, and --card is one of the surfaces --foreground is checked against',
  '--popover-foreground': 'text on --popover only, which is --card in both palettes',
  '--secondary-foreground': 'text on --secondary only, and --foreground is checked against --secondary',
  '--primary-foreground': 'paired: checked against --primary below, not against the grounds',
  '--destructive-foreground': 'paired: checked against --destructive below',
  '--syn-string': 'code, on the literal #0a0d15 and #151b28 of .md-code — not a ground token',
  '--syn-func': 'same, and only ever inside a code block',
  '--syn-keyword': 'declared, and used by nothing — no consumer in either stylesheet',
  '--syn-number': 'declared, and used by nothing',
  '--syn-type': 'declared, and used by nothing',
  '--syn-error': 'declared, and used by nothing',
}

test('no ink-shaped token escapes the contrast check without a reason', () => {
  const emitted = { ...cssVariables(DEFAULT_PALETTE), ...semanticVariables(DEFAULT_PALETTE) }
  const inkShaped = Object.keys(emitted).filter((name) => /^--ink-|^--syn-|-text$|-foreground$/.test(name))

  // The control: if the shape ever stops matching anything, every assertion under it is vacuous.
  assert.ok(inkShaped.length >= 10, `only ${inkShaped.length} ink-shaped tokens found — the pattern no longer matches this palette's names`)

  const escaped = inkShaped.filter((name) => !INK_ON_ANY_GROUND.includes(name as never) && !(name in NOT_CHECKED_HERE))
  assert.deepEqual(
    escaped,
    [],
    'these are emitted, are shaped like text, and no assertion in this file touches them. Add ' +
      'each to INK_ON_ANY_GROUND if it can land on a ground, or to NOT_CHECKED_HERE with the ' +
      `reason it cannot:\n  ${escaped.join('\n  ')}`,
  )

  // And the reverse: an exemption for a token that no longer exists is a note about nothing.
  const stale = Object.keys(NOT_CHECKED_HERE).filter((name) => !(name in emitted))
  assert.deepEqual(stale, [], `NOT_CHECKED_HERE excuses tokens the palette no longer emits: ${stale.join(', ')}`)
})

/**
 * The contrast floor, on every palette at once.
 *
 * This is the point of putting the floor in the mapping rather than in the palettes. Measured on
 * `dev` before it existed, against `night-shift`: `--ink-faint` was **2.41:1** on `--secondary`
 * and **2.98:1** on `--card`, and it sets tool lists, hints, timestamps and code comments at
 * 11px. `--border` was **1.24:1** against the card it outlined, which is why the panels in this
 * app read as floating text rather than as objects.
 *
 * A floor that only holds for the palette somebody happened to look at is not a floor. This one
 * runs against every palette in `PALETTES`, so a theme added next year cannot ship illegible.
 */
test('every text token clears 4.5:1, and every control edge 3:1, in every palette', () => {
  const failures: string[] = []
  for (const palette of PALETTES) {
    const v: Record<string, string> = { ...cssVariables(palette), ...semanticVariables(palette) }
    const surfaces = ['--background', '--card', '--muted', '--secondary'] as const

    // Text that lands on any ground.
    for (const ink of INK_ON_ANY_GROUND) {
      for (const surface of surfaces) {
        const ratio = contrast(v[ink]!, v[surface]!)
        if (ratio < TEXT_CONTRAST) {
          failures.push(`${palette.id}: ${ink} on ${surface} is ${ratio.toFixed(2)}, needs 4.5`)
        }
      }
    }

    // Text on the two coloured surfaces, which name their own foreground.
    for (const [ink, surface] of [
      ['--primary-foreground', '--primary'],
      ['--destructive-foreground', '--destructive'],
    ] as const) {
      const ratio = contrast(v[ink]!, v[surface]!)
      if (ratio < TEXT_CONTRAST) {
        failures.push(`${palette.id}: ${ink} on ${surface} is ${ratio.toFixed(2)}, needs 4.5`)
      }
    }

    // The edge of a control, which is the thing that says it is one. WCAG 1.4.11.
    for (const surface of ['--card', '--muted', '--secondary'] as const) {
      const ratio = contrast(v['--border-strong']!, v[surface]!)
      if (ratio < EDGE_CONTRAST) {
        failures.push(`${palette.id}: --border-strong on ${surface} is ${ratio.toFixed(2)}, needs 3`)
      }
    }
  }
  assert.deepEqual(failures, [], `contrast floor breached:\n${failures.join('\n')}`)
})

/** The floor must move a colour as little as it can, or it is a repaint rather than a floor. */
test('the contrast floor leaves a colour alone when it already clears', () => {
  for (const palette of PALETTES) {
    assert.equal(
      legibleOn(palette.ink, palette.ground, TEXT_CONTRAST),
      palette.ink,
      `${palette.id}: --ink is already 15:1 and the floor moved it anyway`,
    )
  }
})

test('every palette answers every question — a partial theme is a theme with holes in it', () => {
  for (const p of PALETTES) {
    for (const [name, value] of Object.entries(cssVariables(p))) {
      assert.match(value, /^#[0-9a-f]{6}$/i, `${p.id} ${name} is not a hex colour: ${value}`)
    }
  }
})

test('an unknown theme id falls back rather than rendering an office with no colours', () => {
  assert.equal(paletteById('no-such-theme'), DEFAULT_PALETTE)
  assert.equal(paletteById('graphite').id, 'graphite')
})

/**
 * ## Two themes a person can pick have to look different
 *
 * The picker offers `night shift` and `graphite`, and pressing either genuinely rewrites 41
 * variables. Measured in the running app before this was written:
 *
 *     chrome ground   #0b0e17 -> #0d0f11    2, 1 and 6 out of 255
 *     floor mean      (44,43,62) -> (41,45,52)
 *     accent          #e8b25e amber -> #6fb7c9 cyan
 *     floor canvas    14.3% of the window
 *
 * The accent is genuinely opposite and the floor is genuinely cooler, and both are small. The
 * other 86% of the window is the ground, and it moved by almost nothing \u2014 so switching theme
 * looked like nothing had happened, and a control that appears to do nothing is the complaint
 * this whole branch started from.
 *
 * `GRAPHITE`'s docstring says its job is to be "deliberately far from `night-shift` on the axis
 * that is easiest to get wrong ... If a surface only works under one of them, that surface is
 * still holding a literal somewhere." That job is real and worth keeping. It is not an argument
 * for the two grounds being indistinguishable \u2014 a token-layer probe that a person is offered
 * in a menu has to also work as a theme.
 *
 * A ratio rather than a channel distance, because that is what the eye is closer to and the
 * machinery is already here. 1.15 is a small step, well under the 3:1 an edge is held to: the
 * bar is "you can tell which one is on", not "these are unalike".
 */
test('no two palettes the picker offers are the same colour', () => {
  const pairs: string[] = []
  for (let i = 0; i < PALETTES.length; i += 1) {
    for (let j = i + 1; j < PALETTES.length; j += 1) {
      const a = PALETTES[i]!
      const b = PALETTES[j]!
      const ratio = contrast(a.ground[0], b.ground[0])
      if (ratio < 1.15) {
        pairs.push(`${a.id} ${a.ground[0]} vs ${b.id} ${b.ground[0]} — ${ratio.toFixed(3)}`)
      }
    }
  }

  assert.deepEqual(
    pairs,
    [],
    `these themes are offered as a choice and share a ground:\n  ${pairs.join('\n  ')}\n` +
      `The ground is most of the window, so a person switching between them sees a control that ` +
      `did nothing.`,
  )
})

test('and they are still all dark, because that is what this office is', () => {
  // The other half. "Make them differ" is satisfied just as well by a white theme, and that is
  // not the change that was wanted — the office at night is what it has always been.
  const light = PALETTES.filter((p) => contrast(p.ground[0], '#ffffff') < 8).map((p) => p.id)
  assert.deepEqual(light, [], `these grounds are no longer dark: ${light.join(', ')}`)
})
