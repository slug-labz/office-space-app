/**
 * The two checks that keep the interface work from decaying, and the third that nearly wasn't.
 *
 * `type-scale.test.ts` holds the type and radius systems, and `palette.test.ts` holds the
 * contrast floor across every theme. This file holds the other two things measured on `dev`
 * before any of it: **seventeen of thirty controls under the WCAG 2.2 AA target floor**, and a
 * stylesheet carrying rules for components that no longer existed.
 *
 * Both are decay a diff cannot catch, because every individual addition looks reasonable. A
 * control with no `min-height` looks like every other control until you measure it; a class whose
 * last caller was deleted looks exactly like one whose caller is in the next file.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHEETS = ['src/renderer/styles.css', 'src/renderer/panels.css'] as const

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, ' ')
const css = (): string => SHEETS.map((f) => stripComments(readFileSync(join(root, f), 'utf8'))).join('\n')

/**
 * Every class the app can actually put on an element.
 *
 * Read from source rather than from a list, because a list is a second thing to keep in step.
 * Includes the pieces of names built by concatenation — `md-h${n}`, `logline--${kind}` — which
 * is the trap the first two attempts at this fell into: matching whole class names reported
 * every BEM modifier in the app as dead, twice, because nothing ever writes them whole.
 */
function applied(): string {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (/\.(ts|html)$/.test(entry.name)) files.push(path)
    }
  }
  walk('src')
  return files.map((f) => readFileSync(join(root, f), 'utf8')).join('\n')
}

/** Every bare class declared anywhere in the two sheets, including inside selector lists. */
function declaredClasses(): readonly string[] {
  return [...new Set([...css().matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!))]
}

/**
 * Is this class name reachable from source?
 *
 * Exact match, or any prefix of it that stops at a BEM separator — `logline--done` counts as
 * used when the source contains `logline--`, because that is how the name is built.
 */
function isApplied(name: string, source: string): boolean {
  if (source.includes(name)) return true
  for (const separator of ['--', '__']) {
    const cut = name.lastIndexOf(separator)
    if (cut > 0 && source.includes(name.slice(0, cut + separator.length))) return true
  }
  // A trailing number is the other way a name gets built: `md-h1` through `md-h4` are one
  // template, `md-h${heading.length}`. Without this the check calls all four dead and is right
  // about none of them — which is the third version of the mistake this function's comment is
  // about, and it was caught the same way as the first two: by reading what it accused.
  const stem = name.replace(/\d+$/, '')
  return stem !== name && source.includes(stem)
}

/**
 * The controls, and the floor each one has to clear.
 *
 * WCAG 2.2 AA (2.5.8) asks 24 × 24 CSS pixels. `--h-sm` is 28 and `--h-md` is 32, so every
 * control clears it with room — and a control that declares neither is one whose height comes
 * from whatever its text happens to be, which is how the conversation switcher ended up **12.5px
 * tall** and the whole floor footer 22.5.
 */
const CONTROL_CLASSES = [
  'btn',
  'pill',
  'viewtoggle',
  'ghost',
  'control',
  'sel__trigger',
  'swrow',
  'fact',
  'mark',
  'music__key',
  'music__icon',
  'card__close',
  'mode__go',
  // The two the switcher is made of. `.switcher` was the 12.5px control this file's comment
  // names, and it has had `--h-md` since — but it was never on this list, so nothing was holding
  // it there. `.switcher__new` is the segment welded beside it, and a `+` is one character wide:
  // it is precisely the shape of control that gets its size from its own text unless told not to.
  'switcher',
  'switcher__new',
  // The microphone and its device chevron, added the night dictation got a device picker and
  // never added here — so this guard existed and that control was not reachable from it.
  // Measured in the running app at **20×28**, under the 24px floor, by the same driven pass that
  // was checking whether tonight's merges had broken anything. Nothing had; this had been there
  // all along, in a file that has a test for precisely this.
  //
  // A list of controls is only a guard for the controls on the list — which is this repository's
  // recurring bug wearing a test's clothes.
  'mic__btn',
  'mic__pick',
]

test('every control declares a height, so none of them is sized by its own text', () => {
  const sheets = css()
  const missing = CONTROL_CLASSES.filter((name) => {
    // The declaration may be on the class itself or on a selector list containing it; either way
    // the class name and a height must appear inside one rule.
    const rules = [...sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    return !rules.some(
      (m) =>
        m[1]!.split(',').some((part) => part.trim() === `.${name}` || part.trim() === `#${name}`) &&
        /(min-height|height)\s*:/.test(m[2]!),
    )
  })

  assert.deepEqual(
    missing,
    [],
    `these are controls and declare no height, so their target size is whatever their label ` +
      `happens to be. Measured on dev before the heights existed: 17 of 30 controls were under ` +
      `the 24x24 WCAG 2.2 AA floor. Give them var(--h-sm) or var(--h-md): ${missing.join(', ')}`,
  )
})

test('every control height comes from the scale rather than a literal', () => {
  const sheets = css()
  const offenders: string[] = []
  for (const m of sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const isControl = m[1]!
      .split(',')
      .some((part) => CONTROL_CLASSES.some((name) => part.trim() === `.${name}`))
    if (!isControl) continue
    for (const h of m[2]!.matchAll(/min-height\s*:\s*([^;]+);/g)) {
      const value = h[1]!.trim()
      if (value !== 'var(--h-sm)' && value !== 'var(--h-md)' && !/^4[4-9]px$|^[5-9]\dpx$/.test(value)) {
        offenders.push(`${m[1]!.trim().split('\n')[0]} → ${value}`)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `control heights are two tokens, --h-sm and --h-md, or a deliberate larger literal for a ` +
      `list row. A third size is a third decision nobody made: ${offenders.join(', ')}`,
  )
})

/**
 * Classes the stylesheet dresses that nothing wears.
 *
 * This is the renderer half of laptop 2's reachability check — theirs asserts a declared
 * capability is reachable from the running app, this asserts a declared *style* is. Same disease,
 * two organs: something declared on one side and connected on neither.
 *
 * It has a short and slightly humiliating history. The first version matched class names against
 * a token list and reported 37 selectors dead, almost all of them BEM modifiers built by
 * concatenation. The second shelled out with an unquoted file list that `ugrep` silently mangled
 * and reported *everything* dead, including selectors that were rendering on screen at the time.
 * The number below is only trustworthy because the third pass disagreed with the first two.
 */
test('every class the stylesheet dresses is one something can wear', () => {
  const source = applied()
  const dead = declaredClasses()
    .filter((name) => !isApplied(name, source))
    .sort()

  assert.deepEqual(
    dead,
    [],
    `declared in CSS and applied by nothing in src/ — dead weight that reads as a component ` +
      `somebody might still be using: ${dead.join(', ')}`,
  )
})

/**
 * A declared width below the floor, which the height check cannot see.
 *
 * The sibling test above asks whether a control declares a *height*, because the bug it was
 * written for was a control sized by its own label. It never asked about width — and a control
 * can satisfy it completely and still be too small to hit.
 *
 * Found by pointing a ruler at the running app rather than by the suite: `.mic__pick`, the
 * device chevron beside the microphone, measured **20×28**. It declares `min-height: var(--h-sm)`
 * like everything else, so the height check passed it every run since the night it shipped. The
 * 24px floor was only ever enforced by somebody measuring, which means it was not enforced.
 *
 * Narrow on purpose: this can only judge widths a stylesheet states outright. A control whose
 * width comes from padding, flex or its own text is beyond a static read, and pretending
 * otherwise would be a check that looks stronger than it is.
 */
test('a control that states its own width states at least the 24px floor', () => {
  const sheets = css()
  const rules = [...sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const tooNarrow: string[] = []

  for (const name of CONTROL_CLASSES) {
    for (const rule of rules) {
      const selects = rule[1]!
        .split(',')
        .some((part) => part.trim() === `.${name}` || part.trim() === `#${name}`)
      if (!selects) continue

      // `width: 24px` and `min-width: 24px` both answer the question; anything in another unit
      // is not something this check can judge, and it says so by ignoring it.
      const stated = /(?:^|;|\s)(?:min-)?width\s*:\s*(\d+(?:\.\d+)?)px/.exec(rule[2]!)
      if (stated && Number(stated[1]) < 24) tooNarrow.push(`${name} (${stated[1]}px)`)
    }
  }

  assert.deepEqual(
    tooNarrow,
    [],
    `these controls state a width under the 24px WCAG 2.5.8 floor. A small glyph does not earn a ` +
      `small target — the icon may be 15px, the thing a finger lands on may not: ${tooNarrow.join(', ')}`,
  )
})
