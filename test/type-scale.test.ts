/**
 * The type scale and the radius scale, enforced.
 *
 * Before this existed the two stylesheets carried **eighteen** distinct `font-size` values —
 * 0.5625, 0.62, 0.625, 0.66, 0.68, 0.6875, 0.7, 0.72, 0.75, 0.8125, 0.875, 0.9375, 1, 1.0625,
 * 1.25rem, plus 14px and 0.9em — and **eleven** distinct `border-radius` values across two
 * competing radius systems, one of which reached 3px by arithmetic while the other reached it
 * by decision.
 *
 * Nobody chose eighteen. Eighteen is what you get when there is nothing to reuse, eighteen
 * times: each surface picks a size that looks right on its own, and the difference between
 * 0.68rem and 0.6875rem is one no reader can see and every author has to re-decide.
 *
 * That is a decay this repository cannot detect by reading a diff, because every individual
 * addition looks reasonable. So it is asserted here instead. A nineteenth size fails the build.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHEETS = ['src/renderer/styles.css', 'src/renderer/panels.css'] as const
const read = (p: string): string => readFileSync(join(root, p), 'utf8')

/** Comments carry prose about sizes we no longer use. Blank them, keeping line count. */
const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

const declarations = (css: string, prop: string): readonly string[] =>
  [...stripComments(css).matchAll(new RegExp(`${prop}:\\s*([^;]+);`, 'g'))].map((m) =>
    (m[1] ?? '').trim(),
  )

/**
 * The six steps. Every one is a notch above what it replaced, which is the whole of the
 * readability fix: 9px and 10px stop existing and the UI default is 13px rather than 11px.
 */
const SCALE = ['--text-2xs', '--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl']

/**
 * Two sizes are allowed to be literals, and both are load-bearing.
 *
 * `0.9em` is inline code inside prose: it must track the text around it rather than the root,
 * which is the one case `rem` gets wrong. `calc(100% * var(--font-scale))` is on `html` and is
 * the multiplier every `rem` in both sheets resolves against — it is the scale, not a use of it.
 */
const SIZE_LITERALS = new Set(['0.9em', 'calc(100% * var(--font-scale))'])

test('every font-size is a scale token, or one of two documented literals', () => {
  const offenders: string[] = []
  for (const sheet of SHEETS) {
    for (const value of declarations(read(sheet), 'font-size')) {
      if (SIZE_LITERALS.has(value)) continue
      const token = /^var\((--text-[a-z0-9]+)\)$/.exec(value)?.[1]
      if (token === undefined || !SCALE.includes(token)) offenders.push(`${sheet}: ${value}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `font-size off the scale. Use one of ${SCALE.join(', ')}, or argue for a seventh step here:\n` +
      offenders.join('\n'),
  )
})

test('the scale has six steps and every one of them is used', () => {
  const css = SHEETS.map(read).join('\n')
  for (const step of SCALE) {
    assert.match(
      css,
      new RegExp(`\\s${step}:\\s`),
      `${step} is on the scale but nothing declares it`,
    )
    assert.match(css, new RegExp(`var\\(${step}\\)`), `${step} is declared and never used`)
  }
})

/**
 * Two radii, and they are named for what they are rather than how big they are.
 *
 * `--radius` is a surface — a panel, a card, a floating list. `--radius-control` is 3px, which
 * is the difference between chrome that looks like an app and chrome that looks like a tool.
 * The retired system derived `sm`/`md`/`lg` from `--radius`, and its `sm` computed to exactly
 * 3px: the same value as `--radius-control`, reached by arithmetic instead of by decision. Two
 * names for one value is how one control ends up rounder than the one beside it for no reason
 * anybody can state.
 */
const RADIUS_LITERALS = new Set([
  '50%', // circles — avatars and the phase dot
  '999px', // the scrollbar thumb, which is genuinely round and is not a control
  '0',
  '0 var(--radius) var(--radius) 0', // one corner-pair, on a rule that meets an edge
])

test('every border-radius is a radius token, or a documented literal', () => {
  const offenders: string[] = []
  for (const sheet of SHEETS) {
    for (const value of declarations(read(sheet), 'border-radius')) {
      if (RADIUS_LITERALS.has(value)) continue
      if (value === 'var(--radius)' || value === 'var(--radius-control)') continue
      offenders.push(`${sheet}: ${value}`)
    }
  }
  assert.deepEqual(offenders, [], `border-radius off the system:\n${offenders.join('\n')}`)
})

test('the retired tokens stay retired', () => {
  // Stripped, so a comment that explains *why* a token was retired may say its name.
  const css = SHEETS.map((s) => stripComments(read(s))).join('\n')
  // `--serif` aliased to `--mono` and had exactly one call site, an italic empty-state message,
  // which is prose and belongs to `--sans`. `--radius-sm/md/lg` were the second radius system.
  for (const dead of ['--serif', '--radius-sm', '--radius-md', '--radius-lg']) {
    assert.equal(
      css.includes(dead),
      false,
      `${dead} was retired and has come back. If it is genuinely needed again, say why here.`,
    )
  }
})

/**
 * The font roles, and the reason this file exists at all.
 *
 * `--sans` used to be declared as `var(--mono)`, so all three type roles pointed at one face and
 * **100% of the rendered interface was monospace** — 11,469 characters, not one proportional.
 * The trouble is not that mono is ugly. It is that when mono is the default it stops carrying
 * information: a file path, a command, a session id and the word "Settings" all looked alike,
 * and the one register this app has for saying *this is a literal, character for character* was
 * being spent on button labels.
 */
test('sans and mono are different faces', () => {
  const css = read('src/renderer/styles.css')
  const sans = /--sans:\s*([^;]+);/.exec(stripComments(css))?.[1]?.trim()
  const mono = /--mono:\s*([^;]+);/.exec(stripComments(css))?.[1]?.trim()
  assert.ok(sans !== undefined && mono !== undefined, 'both font roles must be declared')
  assert.notEqual(sans, mono, '--sans must not be an alias of --mono')
  assert.equal(/mono/i.test(sans), false, `--sans resolves to a monospace stack: ${sans}`)
  assert.match(mono, /mono/i, `--mono must actually be monospace: ${mono}`)
})

/**
 * The root element sets the family, not `body`.
 *
 * It was on `body` alone, so `<html>` resolved to the user-agent default — measured as Times in
 * the running app. Nothing visible inherited it, because everything visible is inside `body`,
 * which is exactly why it would have survived until something did.
 */
test('the root element carries the font family, so nothing can inherit a serif', () => {
  const css = stripComments(read('src/renderer/panels.css'))
  const rule = /(^|\n)html\s*\{([^}]*)\}/.exec(css)?.[2]
  assert.ok(rule !== undefined, 'no html rule found')
  assert.match(rule, /font-family:\s*var\(--sans\)/, 'html must set font-family')
})
