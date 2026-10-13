/**
 * Every class the stylesheets style must be a class the app actually puts on an element.
 *
 * `css-collisions.test.ts` already asks the forward question — is every applied class styled?
 * That direction catches a control that renders unstyled. It cannot catch the opposite, and the
 * opposite is what shipped: a rule whose selector names an element that no longer exists.
 *
 * ## What this missed
 *
 * The tab strip and the session drawer were replaced by the switcher. The markup went; nine rule
 * blocks stayed. Dead CSS is usually harmless — it is bytes, and the browser ignores it — so this
 * would be tidying and not a test, except for one of the nine:
 *
 *     :root[data-side="left"] .tabs { padding-left: 5.5rem; }
 *
 * macOS draws its three window buttons over the top-left of the window, and `.floor__chrome`
 * reserves `5.5rem` for them. When the conversation became the left-hand column — which is the
 * **default** — the floor gave that reservation back and handed it to `.tabs`. `.tabs` had
 * already stopped existing, so nobody held the clearance and the buttons landed on the switcher.
 *
 * Read one at a time every rule was right. The give-back was right. The reservation was right.
 * The join between them addressed a corpse. That is the failure this repository keeps finding,
 * and the only reason it survived is that nothing ever asked whether `.tabs` was still worn.
 *
 * ## Why an allowlist rather than a cleverer matcher
 *
 * Some classes are assembled at runtime — `` `task task--${outcome}` `` — so the literal
 * `task--passed` appears in no source file. The obvious fix is to harvest prefixes from template
 * literals automatically, and it is wrong: `` `roster__badge${atDesk ? '' : ' roster__badge--off'}` ``
 * yields the prefix `roster__badge`, which would then vouch for every `.roster__badge--*` rule in
 * the file — including the two dead ones this test found on its first run.
 *
 * A heuristic that silently excuses dead code is worse than no test. So the computed prefixes are
 * written down, and each one is itself checked: if the code that builds it stops building it, the
 * entry fails rather than quietly covering for whatever is left behind.
 *
 * ## Why only string literals count as wearing a class
 *
 * The first draft of this test searched the sources as plain text, and passed while the bug was
 * present. `app.ts` holds `const tabs = new Map<string, Tab>()` — an unrelated local variable —
 * and a substring search accepted that as proof the class was worn. A class only ever reaches an
 * element as a **string**: `el('div', 'x')`, `className`, `classList`, or `class="…"` in the
 * markup. Reading anything else is how a test agrees with the code for a reason that has nothing
 * to do with the question it was asked.
 *
 * The second draft then went too far the other way. It cut `${…}` spans out of template literals
 * before splitting them, which threw away the strings *inside* those spans — and
 * `` `swrow${current ? ' swrow--current' : ''}` `` keeps a real class exactly there. A regex
 * cannot see that nesting, so the strings are found by a scanner that tracks the state a parser
 * would: inside a template's literal text, or inside an expression where a nested string can
 * start. Both directions of error were the same mistake — measuring something adjacent to the
 * question because it was easier to reach.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const renderer = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer')

/**
 * Class names assembled at runtime, with the expression that assembles them.
 *
 * `builtBy` is matched against the sources, so an entry cannot outlive the code it describes.
 */
const COMPUTED: readonly { readonly prefix: string; readonly builtBy: string }[] = [
  { prefix: 'approval--', builtBy: 'approval approval--${' },
  { prefix: 'firstrun__step--', builtBy: 'firstrun__step firstrun__step--${' },
  { prefix: 'logline--', builtBy: 'logline logline--${' },
  { prefix: 'md-h', builtBy: 'md-h md-h${' },
  { prefix: 'task--', builtBy: 'task task--${' },
]

/** Block comments in both languages, and line comments that are not the `//` of a URL. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(?<!:)\/\/.*$/gm, ' ')
}

async function filesUnder(dir: string, keep: RegExp): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await filesUnder(path, keep)))
    else if (keep.test(entry.name)) out.push(path)
  }
  return out
}

test('every class the stylesheets style is a class the app applies', async () => {
  // What the stylesheets style. Selectors only — a class name inside a declaration value or a
  // comment is prose, and prose is what let `.tabs` look alive for two releases.
  const styled = new Map<string, string>()
  for (const file of await filesUnder(renderer, /\.css$/)) {
    const body = stripComments(await readFile(file, 'utf8'))
    for (const [, selector] of body.matchAll(/(?:^|\})([^{}]*)\{/g)) {
      for (const [, name] of (selector ?? '').matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
        if (name !== undefined && !styled.has(name)) styled.set(name, file)
      }
    }
  }

  const sources = await filesUnder(renderer, /\.(ts|html)$/)
  const code = stripComments((await Promise.all(sources.map((f) => readFile(f, 'utf8')))).join('\n'))

  // Every class token the app can actually put on an element: the text of every string literal,
  // plus `class="…"` from the markup. Templates contribute their literal segments *and* whatever
  // strings appear inside their `${…}` expressions, which is where conditional classes live.
  const worn = new Set<string>()
  const add = (text: string): void => {
    for (const token of text.split(/\s+/)) if (token) worn.add(token)
  }

  // `prev` is the last significant character, which is the only way to tell a regex literal from
  // a division. It matters more than it sounds: `markdown.ts` contains ``/^\\s*```/`` — three
  // backticks inside a regex — and reading the first as a template start swallowed the rest of
  // the file, `p.className = 'md-p'` included. The test then reported a live class as dead.
  let prev = ''
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    if (ch === undefined) continue

    if (ch === '/' && (prev === '' || '(,=:[!&|?{};+-*%~^'.includes(prev))) {
      for (i++; i < code.length && code[i] !== '/'; i++) {
        if (code[i] === '\\') i++
        else if (code[i] === '\n') break
        else if (code[i] === '[') for (i++; i < code.length && code[i] !== ']'; i++) if (code[i] === '\\') i++
      }
      prev = 'x'
      continue
    }

    if (ch === "'" || ch === '"') {
      let out = ''
      for (i++; i < code.length && code[i] !== ch; i++) {
        if (code[i] === '\\') i++
        else if (code[i] === '\n') break
        else out += code[i]
      }
      add(out)
      prev = 'x'
      continue
    }

    if (ch === '`') {
      let segment = ''
      for (i++; i < code.length && code[i] !== '`'; i++) {
        if (code[i] === '\\') { i++; continue }
        if (code[i] === '$' && code[i + 1] === '{') {
          add(segment)
          segment = ''
          // Fall back to ordinary scanning inside the expression: that is where a conditional
          // class such as `' swrow--current'` lives, and deleting the span would lose it.
          let depth = 1
          for (i += 2; i < code.length && depth > 0; i++) {
            if (code[i] === '{') depth++
            else if (code[i] === '}') depth--
            else if (code[i] === "'" || code[i] === '"') {
              const quote = code[i]
              let nested = ''
              for (i++; i < code.length && code[i] !== quote; i++) {
                if (code[i] === '\\') i++
                else nested += code[i]
              }
              add(nested)
            }
          }
          i--
          continue
        }
        segment += code[i]
      }
      add(segment)
      prev = 'x'
      continue
    }

    if (!/\s/.test(ch)) prev = ch
  }

  for (const [, value] of code.matchAll(/class="([^"]*)"/g)) add(value ?? '')

  // An entry that no longer describes real code would vouch for anything sharing its prefix.
  for (const { prefix, builtBy } of COMPUTED) {
    assert.ok(
      code.includes(builtBy),
      `COMPUTED lists '${prefix}' as built by \`${builtBy}\`, which is no longer in src/renderer. ` +
        'Update the entry or drop it — as written it excuses every rule starting with that prefix.',
    )
  }

  const orphans: string[] = []
  for (const [name, file] of [...styled].sort()) {
    const computed = COMPUTED.some(({ prefix }) => name.startsWith(prefix) && name.length > prefix.length)
    if (!worn.has(name) && !computed) orphans.push(`${file.slice(file.indexOf('src'))}: .${name}`)
  }

  assert.deepEqual(
    orphans,
    [],
    'These classes are styled and nothing wears them. Usually that is dead bytes; once it was the ' +
      'macOS traffic-light clearance being handed to an element that had been deleted, and the ' +
      'window buttons sat on top of the switcher in the default layout.\n  ' +
      orphans.join('\n  '),
  )
})

/**
 * The four pseudo-elements CSS still lets you write with one colon.
 *
 * `:before` and `::before` are the same thing and both weigh (0,0,1) — a **pseudo-element**, not
 * a pseudo-class. A counter that classifies by "one colon means pseudo-class" scores them
 * (0,1,0) instead, which is an error of exactly one class-column unit. That is the granularity
 * the equality assertion below turns on, so it is the error that makes two unequal selectors
 * compare equal and lets the guard pass over a guard that means nothing.
 */
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter'])

/**
 * Count a selector's specificity, refusing anything this cannot classify.
 *
 * A counter that scores an unrecognised token as zero would under-report, agree with whatever it
 * was asked, and be worse than no counter at all — which is the failure the test below exists to
 * prevent, so it must not be the failure of the tool that checks it. Unknown tokens throw.
 *
 * ## Why this is more careful than it looks like it needs to be
 *
 * It guards an equality assertion, so **the counter is the load-bearing part**: mis-score either
 * selector by one class-column unit and two unequal selectors compare equal, the order assertion
 * underneath it passes, and the clearance it was all protecting has silently lost. Moving risk is
 * not the same as removing it. `office-space-6c` made that point and then sent ten cases; four of
 * them were wrong here, and every one of the four is pinned in the test below.
 *
 * `:is()`, `:where()`, `:not()` and `:has()` take their weight from their arguments, and reading
 * those means a real selector parser. None appear in these stylesheets, so this throws rather
 * than guessing — `:where()` in particular is specificity **zero**, and scoring it as a
 * pseudo-class would be wrong in the direction that makes things look equal.
 */
function specificity(selector: string): readonly [number, number, number] {
  let ids = 0
  let classes = 0
  let elements = 0
  let rest = selector.trim()

  // Identifiers may hold escapes — `.md\:flex` is one class, and the escaped colon must not read
  // as a pseudo-class. Functional pseudo-classes carry their argument list along with them so
  // that `(2n+1)` is never met on its own and mistaken for something unclassifiable.
  const TOKEN =
    /^(#(?:[\w-]|\\.)+|\.(?:[\w-]|\\.)+|\[[^\]]*\]|::?[\w-]+(?:\([^()]*\))?|(?:[\w-]|\\.)+|\*|\s*[>+~]\s*|\s+)/

  while (rest !== '') {
    const [, token] = TOKEN.exec(rest) ?? []
    if (token === undefined) throw new Error(`specificity(): cannot classify ${JSON.stringify(rest)} in ${JSON.stringify(selector)}`)
    rest = rest.slice(token.length)

    // Combinators and the universal selector contribute nothing. `.a > .b` is (0,2,0).
    if (/^\s|^\s*[>+~]/.test(token) || token === '*') continue

    if (token.startsWith('#')) {
      ids += 1
    } else if (token.startsWith('.') || token.startsWith('[')) {
      classes += 1
    } else if (token.startsWith('::')) {
      elements += 1
    } else if (token.startsWith(':')) {
      const name = token.slice(1).replace(/\(.*$/, '')
      if (/^(is|where|not|has)$/.test(name)) {
        throw new Error(`specificity(): :${name}() takes its weight from its arguments; this counter does not read them`)
      }
      if (LEGACY_PSEUDO_ELEMENTS.has(name)) elements += 1
      else classes += 1
    } else {
      elements += 1
    }
  }
  return [ids, classes, elements]
}

/**
 * The window buttons' clearance must outrank density, and must not be expressed as a multiple of it.
 *
 * macOS draws its three window buttons over the top-left of the window. Measured in the running
 * app they occupy x 13-65, y 13-25, and `.pane__head` — the header the switcher lives in — has
 * to stay out of that box. It used to do so horizontally, with `padding-left: 5.5rem`, which
 * worked and left an 88px hole in the corner while every other row in that column started at the
 * pane's own 1.25rem. It now does so vertically instead, with `padding-top: 2.25rem`.
 *
 * That swap moved the clearance onto an axis another rule already owns:
 *
 *     :root[data-density="compact"] .pane__head { padding-top: calc(0.5rem * var(--density)); }
 *
 * At `--density: 0.75` that asks for 6px of room for a 25px obstacle.
 *
 * ## This asserts a proxy, and the proxy has a precondition
 *
 * The claim worth making is about the **computed** `padding-top` of a `.pane__head` under
 * `:root[data-density="compact"]`. That needs a cascade, and the DOM shim in `test/dom.ts` is a
 * hand-rolled object graph that does not implement one — there is no engine here to ask. So this
 * asserts source order instead, which decides the winner *only while the two selectors weigh the
 * same*, and that condition is checked first rather than assumed. Add a component to either
 * selector and the equality assertion fails, which is the signal that the order assertion below
 * it has stopped meaning anything — rather than a green suite over a clearance that silently lost.
 *
 * What the proxy still cannot see, and a browser could: an `!important` on either side, either
 * rule moving into an `@layer` (where layer order beats specificity outright), or a third rule
 * arriving at (0,2,0) or above. `office-space-6c` raised exactly this, and it is right: order is
 * one input to the cascade and the outcome is the thing that matters.
 *
 * The outcome *was* checked, once, by hand, in the running app over CDP — comfortable and
 * compact both compute to 36px on the left, and the switcher lands at x=22, y=37, clear of the
 * box. That measurement is a receipt for the day this was written, not a check that runs, and
 * the difference between those two is most of what this repository is about.
 */
test('the traffic-light clearance outranks density, and does not scale with it', async () => {
  const css = await readFile(join(renderer, 'panels.css'), 'utf8')

  const DENSITY = ':root[data-density="compact"] .pane__head'
  const CLEARANCE = ':root[data-side="left"] .pane__head'

  const densityAt = css.indexOf(DENSITY)
  const clearanceAt = css.indexOf(CLEARANCE)

  assert.notEqual(densityAt, -1, `${DENSITY} is gone — if density no longer touches padding-top, this test has nothing to guard and should go with it`)
  assert.notEqual(clearanceAt, -1, `${CLEARANCE} is gone — the switcher is back under the window buttons`)

  // The precondition. Order decides nothing unless these tie.
  assert.deepEqual(
    specificity(CLEARANCE),
    specificity(DENSITY),
    `these two selectors no longer weigh the same, so the source-order assertion below has ` +
      `stopped deciding anything: ${CLEARANCE} is ${specificity(CLEARANCE).join(',')} and ` +
      `${DENSITY} is ${specificity(DENSITY).join(',')}. Whichever is heavier wins wherever it ` +
      `sits in the file. Re-check what the header actually computes to at --density 0.75 before ` +
      `changing this test to match.`,
  )

  assert.ok(
    clearanceAt > densityAt,
    'the traffic-light clearance must come AFTER the compact-density rule in panels.css. They ' +
      `weigh the same, so source order is the only thing making the clearance win. As written, ` +
      `density is at ${densityAt} and the clearance at ${clearanceAt}: at --density 0.75 the ` +
      'header reserves 6px for a 25px obstacle and the window buttons land on the switcher.',
  )

  const body = css.slice(clearanceAt, css.indexOf('}', clearanceAt))
  assert.match(body, /padding-top:/, 'the clearance is no longer vertical — if it moved back to padding-left, this test is guarding the wrong axis')
  assert.doesNotMatch(
    body,
    /var\(--density\)/,
    'the clearance must be a fixed length. macOS draws those buttons at a fixed size at a fixed ' +
      'offset; they do not shrink because somebody chose a compact layout, so a clearance ' +
      'expressed as a multiple of --density is wrong at every setting except the one it was written at.',
  )
})

/**
 * The counter's own test, because it is what the equality assertion rests on.
 *
 * Ten cases, sent by `office-space-6c` as hypotheses with the reasoning attached rather than as
 * assertions — which is the only reason they were useful, since that session's approval gate had
 * stopped answering and it could not run a line of this. Four were wrong:
 *
 *   - the `:before` and `:first-line` **tokens** were counted in the class column instead of the
 *     element column — the classic hand-rolled counter bug, and an error of exactly the size
 *     that makes unequal things compare equal. Whole selectors: `p:before` scored (0,1,1) and
 *     should be (0,0,2). Stated as tokens *and* as selectors because saying only the first led
 *     both of us to write the second down wrong.
 *   - `:nth-child(2n+1)` threw, because the argument list was met on its own
 *   - `.md\:flex` threw, because the escape was met on its own
 *
 * One of the ten was wrong in the *other* direction: `p::before` is (0,0,2) — the element and
 * the pseudo-element — and the counter already had it right. Worth saying, because a review that
 * is only ever right is a review nobody checked.
 */
test('the specificity counter is right about the cases that make unequal selectors look equal', () => {
  // Pseudo-elements weigh as elements whichever colon count you write them with.
  assert.deepEqual(specificity('p:before'), [0, 0, 2], ':before is a pseudo-ELEMENT')
  assert.deepEqual(specificity('p::before'), [0, 0, 2], 'and ::before is the same thing')
  assert.deepEqual(specificity('p:first-line'), [0, 0, 2])
  assert.deepEqual(specificity('p:first-letter'), [0, 0, 2])
  assert.deepEqual(specificity('p:after'), [0, 0, 2])

  // The invariant, which needs nobody to be right about the number.
  //
  // `:before` and `::before` are one pseudo-element with two spellings — CSS2.1 and CSS3 — so
  // whatever they weigh, they must weigh it *identically*. Pinning the absolute triple is what
  // put the error into two people's heads at once: it is easy to state a token's contribution
  // and read it back as a whole selector's score. This assertion cannot be got wrong that way,
  // because it only asks the counter to agree with itself, and it fails the moment one spelling
  // is classified as a pseudo-class. `office-space-6c` proposed it after we made the same
  // mistake in the same direction within an hour of each other.
  //
  // The list is closed and total: these four are the only pseudo-elements with a legacy
  // single-colon spelling. Every other single colon is a pseudo-class.
  for (const name of ['before', 'after', 'first-line', 'first-letter']) {
    assert.deepEqual(
      specificity(`p:${name}`),
      specificity(`p::${name}`),
      `:${name} and ::${name} are one pseudo-element written two ways and must weigh the same`,
    )
  }
  // And the counterpart: a pseudo-class must NOT be moved into the element column just because
  // somebody extended the list above. `:hover` has no single-colon-only meaning to protect.
  assert.deepEqual(specificity('a:hover'), [0, 1, 1], ':hover is a pseudo-class, not an element')

  // A pseudo-CLASS that happens to be spelled like one of them is still a pseudo-class.
  assert.deepEqual(specificity('a:hover'), [0, 1, 1])
  assert.deepEqual(specificity('li:nth-child(2n+1)'), [0, 1, 1], 'the argument list is not a component')
  assert.deepEqual(specificity('li:nth-of-type(  3 )'), [0, 1, 1])

  // Nothing-weight tokens.
  assert.deepEqual(specificity('*'), [0, 0, 0], 'the universal selector adds nothing')
  assert.deepEqual(specificity('.a > .b'), [0, 2, 0], 'combinators add nothing')
  assert.deepEqual(specificity('.a + .b ~ .c d'), [0, 3, 1])

  // Compounds, attributes, ids, escapes.
  assert.deepEqual(specificity('.a.b'), [0, 2, 0], 'two classes on one element are two components')
  assert.deepEqual(specificity('[x="y" i]'), [0, 1, 0], 'the case-insensitivity flag is inside the brackets')
  assert.deepEqual(specificity('[x^="y"][z~="w"]'), [0, 2, 0])
  assert.deepEqual(specificity('#foo'), [1, 0, 0])
  assert.deepEqual(specificity('#a #b .c d'), [2, 1, 1])
  assert.deepEqual(specificity('.md\\:flex'), [0, 1, 0], 'an escaped colon is part of the class name, not a pseudo-class')

  // The two the clearance test actually compares.
  assert.deepEqual(specificity(':root[data-side="left"] .pane__head'), [0, 3, 0])
  assert.deepEqual(specificity(':root[data-density="compact"] .pane__head'), [0, 3, 0])
  assert.deepEqual(specificity('.pane__head'), [0, 1, 0], 'the case office-space-6c asked about: it would NOT tie')
})

test('the counter refuses what it cannot weigh, rather than scoring it low', () => {
  // These four take their weight from their arguments. Scoring `:where()` as a pseudo-class
  // would be wrong by one class-column unit in the direction that makes things look equal —
  // it is specificity zero — so none of them may be guessed at.
  for (const fn of [':is(.a, .b)', ':where(.a)', ':not(.a)', ':has(> .a)']) {
    assert.throws(() => specificity(fn), /takes its weight from its arguments/, `${fn} must refuse rather than guess`)
  }
  // And anything genuinely unreadable stops the test instead of quietly scoring zero, which is
  // how a counter ends up agreeing that two different selectors are both nothing.
  assert.throws(() => specificity('.a @ .b'), /cannot classify/)
  assert.throws(() => specificity('.a %% .b'), /cannot classify/)
})
