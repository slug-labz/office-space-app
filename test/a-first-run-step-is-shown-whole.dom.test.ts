/**
 * A first-run step is shown whole.
 *
 * Step details were drawn with `.roster__desc`, the roster's description class, which clamps to
 * three lines. That suits a roster row, whose description comes from somebody's frontmatter and
 * can run on. It does not suit a step: this app writes the detail, and its last sentence is
 * usually the fix. Measured in the dev harness, with the panel's steps 434px wide, dev's own
 * `hook-missing` detail needed 117px and showed 59. Its "The gate is two files…" sentence was cut
 * after its first words, and nothing could bring the rest into view.
 *
 * So step details, and the all-clear sentence drawn the same way, get `.firstrun__detail`: the
 * roster description's type without its clamp. The roster keeps the clamp. The panel body already
 * scrolls, so a long detail costs a scroll rather than the page.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { installDom, type El } from './dom.js'
import { renderFirstRun } from '../src/renderer/views/first-run.js'
import type { Step } from '../src/shared/first-run.js'

installDom()

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** One step of each severity, with and without a command, since the card is built from both. */
const steps: readonly Step[] = (['blocked', 'warning', 'empty'] as const).flatMap((severity) =>
  [null, 'npm install -g @anthropic-ai/claude-code'].map(
    (command): Step => ({
      id: `fixture-${severity}-${command === null ? 'plain' : 'command'}`,
      title: 'A step',
      detail: `A detail long enough to run past three lines at the width of the panel, for a ${severity} step, whose last sentence says what to do.`,
      severity,
      command,
      action: null,
    }),
  ),
)

/** The paragraphs the panel draws whose text matches `said`. */
function paragraphsSaying(drawn: readonly Step[], said: RegExp): El[] {
  const host = document.createElement('div')
  renderFirstRun(host, drawn, { onAction: () => {}, onRecheck: () => {} })
  const walk = (n: El): El[] => [n, ...n.children.flatMap(walk)]
  return walk(host as unknown as El).filter((n) => n.tag === 'p' && said.test(n.textContent))
}

/** The declarations of the first top-level block whose selector is exactly `selector`. */
function block(css: string, selector: string): string {
  // Comments first: these blocks carry prose that names the very properties asserted below.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const at = bare.indexOf(`\n${selector} {`)
  if (at === -1) return ''
  const open = bare.indexOf('{', at)
  const close = bare.indexOf('}', open)
  return close === -1 ? '' : bare.slice(open + 1, close)
}

/** What `property` is set to in a block, or null. `margin` does not match `margin-top`. */
function declared(body: string, property: string): string | null {
  return new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? null
}

/**
 * Every rule in the two stylesheets whose selector mentions `firstrun`, as `[where, declarations]`.
 *
 * This reads stylesheet text, not computed style. A later `.firstrun__detail` rule, or one that
 * reaches the paragraph through the panel (`.firstrun__step p`), is caught. A rule that reaches it
 * without naming the panel (`.card p`, say) still escapes.
 */
function firstrunRules(): [string, string][] {
  const found: [string, string][] = []
  for (const file of ['panels.css', 'styles.css']) {
    const bare = readFileSync(join(root, 'src', 'renderer', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const rule of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1]!.trim()
      if (selector.includes('firstrun')) found.push([`${file}: ${selector}`, rule[2]!])
    }
  }
  return found
}

for (const step of steps) {
  test(`a ${step.severity} step's detail ${step.command === null ? '' : 'with a command '}gets the first-run class`, () => {
    const found = paragraphsSaying([step], /^A detail long enough/)
    assert.equal(found.length, 1, 'the detail was not drawn as one paragraph')
    assert.equal(found[0]!.className, 'firstrun__detail')
  })
}

test('the all-clear sentence gets it too', () => {
  // It says what was checked. At the panel's width it fits in three lines today (measured: it
  // needs 59px and shows 59), but it is the same kind of sentence, and one more check would cut it.
  const found = paragraphsSaying([], /^Nothing needs attention/)
  assert.equal(found.length, 1, 'the all-clear sentence was not drawn as one paragraph')
  assert.equal(found[0]!.className, 'firstrun__detail')
})

test('the first-run class sets the roster’s type without its clamp, and the roster keeps the clamp', () => {
  const css = readFileSync(join(root, 'src', 'renderer', 'panels.css'), 'utf8')
  const detail = block(css, '.firstrun__detail')
  const roster = block(css, '.roster__desc')
  assert.notEqual(detail, '', '.firstrun__detail was not found in panels.css, so nothing below reads it')
  assert.match(roster, /-webkit-line-clamp:\s*3;/, 'the roster lost its clamp, and its rows still want it')
  for (const property of ['margin', 'color', 'font-size', 'line-height']) {
    assert.notEqual(declared(roster, property), null, `the roster description no longer sets ${property}`)
    assert.equal(declared(detail, property), declared(roster, property), `${property} differs from the roster description's`)
  }
  // A long unbroken token, such as an absolute path in a cause, wraps rather than pushing the
  // panel sideways.
  assert.equal(declared(detail, 'overflow-wrap'), 'anywhere')
})

test('no rule that names the panel clamps, clips or caps a step detail', () => {
  const rules = firstrunRules()
  assert.ok(rules.some(([where]) => where.endsWith(': .firstrun__detail')), 'no .firstrun__detail rule was found, so this reads nothing')
  // Widened after review. `max-height` with `overflow-y`, a second `.firstrun__detail` rule and a
  // `.firstrun__step p` rule all clamped the detail while the shorthand-only check passed.
  const clamps = /line-clamp|overflow(?:-(?:x|y|block|inline))?\s*:|max-height|(?:^|[;\s])height\s*:/
  for (const [where, body] of rules) assert.doesNotMatch(body, clamps, `${where} clamps, clips or caps`)
})
