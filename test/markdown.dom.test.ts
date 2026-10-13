/**
 * What the transcript actually renders, for every block the manager can send.
 *
 * `markdown.ts` had one construct under test — the paragraph — and every other one was reached
 * only by running the app and looking. Code fences, headings, quotes, lists and inline spans
 * were all untested, which is the whole of what a person reads in this app.
 *
 * ## Why it looked covered
 *
 * `markdown.ts` reported 82% of lines. This repository is 39% comment by line and the coverage
 * runner counts prose alongside statements, so a file can report a comfortable number while the
 * part that decides what appears on screen is untouched. Counting only *executable* uncovered
 * lines put the real gap at about 49, and they were not spread thin: they were six contiguous
 * runs, one per construct.
 *
 * ## Why these are DOM tests, when the repo's rule says models
 *
 * The rule — judgement in `shared/`, drawing untested — is right where the judgement can be
 * lifted out. Here it cannot: `renderMarkdown` *is* the judgement, and it expresses its result
 * as elements. There is no model to assert against, so the claim has to be about the tree.
 * `test/dom.ts` implements exactly the three factories this file uses.
 *
 * The assertions are about **structure and text**, never about styling, which is the part
 * `styles.css` is allowed to change without breaking anything.
 *
 * The `.dom.` in the filename is load-bearing. `tsconfig.json` excludes `src/renderer/**` and
 * `test/**\/*.dom.test.ts` because the main program has no DOM lib, so a test outside that
 * pattern importing a renderer module drags the whole file into a compile that cannot type it.
 * Named `markdown.test.ts`, this file produced forty errors in a module it had not touched.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, El } from './dom.js'

installDom()

const { renderMarkdown } = await import('../src/renderer/markdown.js')

/** The fragment's element children, as the fake DOM's own type. */
function blocks(source: string): El[] {
  const host = new El('div')
  host.appendChild(renderMarkdown(source) as unknown as El)
  return host.children
}

/** Element children only — the fake DOM keeps text nodes as children, exactly as a real one does. */
const spans = (node: El): El[] => node.children.filter((c) => c.tag !== '#text')

const one = (source: string): El => {
  const out = blocks(source)
  assert.equal(out.length, 1, `expected one block from ${JSON.stringify(source)}, got ${out.length}`)
  return out[0]!
}

test('a fenced block is code, and its language is carried rather than guessed', () => {
  const pre = one('```ts\nconst a = 1\nconst b = 2\n```')
  assert.equal(pre.tag, 'pre')
  assert.equal(pre.className, 'md-code')
  assert.equal(pre.dataset['lang'], 'ts')
  assert.equal(pre.children[0]?.tag, 'code')
  // Both lines, in order, with the newline intact. A code block that loses its line breaks is
  // a code block nobody can copy out of.
  assert.equal(pre.children[0]?.textContent, 'const a = 1\nconst b = 2')
})

test('a fence with no language says nothing rather than claiming one', () => {
  const pre = one('```\nplain\n```')
  assert.equal(pre.dataset['lang'], undefined)
  assert.equal(pre.children[0]?.textContent, 'plain')
})

test('nothing inside a fence is interpreted', () => {
  // The commonest way a renderer lies: `**` inside a code sample becoming bold, so the text on
  // screen is not the text that was sent. Markers and a `#` that would otherwise be a heading.
  const pre = one('```\n**not bold** and `not code`\n# not a heading\n```')
  assert.equal(pre.children.length, 1, 'one <code> child and no parsed spans')
  assert.equal(pre.children[0]?.textContent, '**not bold** and `not code`\n# not a heading')
})

test('headings are levelled, and stop at four', () => {
  for (const [source, level] of [['# a', 1], ['## a', 2], ['### a', 3], ['#### a', 4]] as const) {
    const h = one(source)
    assert.equal(h.className, `md-h md-h${level}`, source)
    assert.equal(h.textContent, 'a')
  }
  // Five hashes is not a heading — it falls through to a paragraph rather than becoming an
  // `md-h5` that no stylesheet has a rule for.
  assert.equal(one('##### a').className, 'md-p')
  // And a hash with no space is a sentence that starts with a hash.
  assert.equal(one('#notaheading').className, 'md-p')
})

test('a heading still reads its inline spans', () => {
  const h = one('## the `retry` path')
  assert.equal(h.textContent, 'the retry path')
  assert.equal(spans(h).find((c) => c.tag === 'code')?.textContent, 'retry')
})

test('consecutive quoted lines are one quote, not one each', () => {
  const q = one('> first\n> second')
  assert.equal(q.tag, 'div')
  assert.equal(q.className, 'md-quote')
  // Nested render: the two lines are a paragraph inside the quote, because that is what they
  // are — a quote of a paragraph, not a quote of two unrelated lines.
  assert.equal(q.textContent, 'first\nsecond')
})

test('a quote can hold the blocks a document can', () => {
  const q = one('> # heading\n> - one\n> - two')
  const inner = q.children
  assert.equal(inner[0]?.className, 'md-h md-h1')
  assert.equal(inner[1]?.tag, 'ul')
  assert.equal(inner[1]?.children.length, 2)
})

test('a dash list is unordered and a numbered list is ordered', () => {
  const ul = one('- one\n- two\n- three')
  assert.equal(ul.tag, 'ul')
  assert.equal(ul.className, 'md-list')
  assert.deepEqual(ul.children.map((li) => li.textContent), ['one', 'two', 'three'])

  const ol = one('1. one\n2. two')
  assert.equal(ol.tag, 'ol')
  assert.deepEqual(ol.children.map((li) => li.textContent), ['one', 'two'])

  // `*` and `+` are bullets too, and `1)` is as ordered as `1.`.
  assert.equal(one('* a\n+ b').tag, 'ul')
  assert.equal(one('1) a').tag, 'ol')
})

test('a list ends where the list ends', () => {
  // A run of items followed by prose must not swallow the prose into the last item.
  const out = blocks('- one\n- two\n\nafter')
  assert.equal(out.length, 2)
  assert.equal(out[0]?.tag, 'ul')
  assert.equal(out[0]?.children.length, 2)
  assert.equal(out[1]?.className, 'md-p')
  assert.equal(out[1]?.textContent, 'after')
})

test('inline spans: code, bold, italic — longest marker first', () => {
  const p = one('a `c` b **strong** c *em* d _also_ e')
  // The text survives exactly, markers removed and nothing reordered.
  assert.equal(p.textContent, 'a c b strong c em d also e')
  assert.deepEqual(
    spans(p).map((c) => `${c.tag}:${c.textContent}`),
    ['code:c', 'strong:strong', 'em:em', 'em:also'],
  )
  assert.equal(spans(p)[0]?.className, 'md-inline-code')
  // The prose between the spans survives as text, in place — the spans are not the whole line.
  assert.deepEqual(
    p.children.filter((c) => c.tag === '#text').map((c) => c.textContent),
    ['a ', ' b ', ' c ', ' d ', ' e'],
  )
})

test('an unpaired marker is a character, not the start of a guess', () => {
  // The comment on `inline` promises this, and it is the difference between rendering what was
  // written and rendering what the parser hoped was meant.
  for (const source of ['2 * 3 * 4', 'a ** b', 'snake_case_name', 'an `unclosed span']) {
    const p = one(source)
    assert.equal(p.textContent, source, source)
    assert.equal(spans(p).length, 0, `${source} produced ${spans(p).length} spans`)
  }
})

test('bold wins over italic, so **a** is not two italics', () => {
  const p = one('**a**')
  assert.deepEqual(spans(p).map((c) => c.tag), ['strong'])
  assert.equal(p.textContent, 'a')
})

test('an empty document is no blocks rather than one empty paragraph', () => {
  assert.deepEqual(blocks(''), [])
  assert.deepEqual(blocks('\n\n\n'), [])
})

test('THE BUG: code-shaped text is not emphasis, in a tool whose subject is code', () => {
  // `\*[^*\n]+\*` called any two asterisks on a line a pair, and `_[^_\n]+_` any two
  // underscores. In this app that is arithmetic, glob patterns and every snake_case identifier
  // anybody types — rendered as text nobody sent, at the surface a person reads most.
  //
  //   2 * 3 * 4                →  2  3  4
  //   files: *.ts and *.css    →  files: .ts and .css
  //   snake_case_name          →  snakecasename
  //   __dirname and __filename →  _dirname and _filename
  const untouched = [
    '2 * 3 * 4',
    'a * b * c * d',
    'multiply a * b together',
    'files: *.ts and *.css',
    'snake_case_name',
    'MAX_INT and MIN_INT',
    'run test_helper_a and test_helper_b',
    '__dirname and __filename',
    'a ** b',
    'a *b',
    '5*6',
    'x_y',
    // Markers with nothing between them are not an empty span.
    '**',
    '****',
    '*',
    '_',
  ]

  for (const source of untouched) {
    const p = one(source)
    assert.equal(p.textContent, source, source)
    assert.equal(spans(p).length, 0, `${source} produced ${spans(p).length} spans`)
  }
})

test('and emphasis still emphasises', () => {
  // The other half of the same change: a fix that made the renderer literal everywhere would
  // pass the test above and be a different bug.
  const cases: [string, string, string][] = [
    ['**bold**', 'bold', 'strong'],
    ['*it*', 'it', 'em'],
    ['_it_', 'it', 'em'],
    ['*multi word span*', 'multi word span', 'em'],
    ['`code`', 'code', 'code'],
  ]
  for (const [source, text, tag] of cases) {
    const p = one(source)
    assert.equal(p.textContent, text, source)
    assert.deepEqual(spans(p).map((c) => c.tag), [tag], source)
  }

  // Mixed, in one line, in order.
  const mixed = one('**a** and *b* and _c_ and `d`')
  assert.equal(mixed.textContent, 'a and b and c and d')
  assert.deepEqual(spans(mixed).map((c) => c.tag), ['strong', 'em', 'em', 'code'])
})

test('THE HANG: a fence this parser cannot open must not stop it moving', () => {
  // `` ```` `` and ``` ```js extra ``` are both ordinary fences and neither matched the old
  // opener, which wanted exactly three backticks and a single word. Not matching was not the
  // bug — it was the trigger.
  //
  // The paragraph branch breaks on ``/^\s*```/``, three backticks *anywhere at the start*, so a
  // line the opener rejected was consumed by nothing and `i` never advanced. The outer loop ran
  // again on the same line, appending an empty paragraph each time, **until the heap gave out**.
  // Ten backticks killed the renderer. Model output is exactly where a stray run of them comes
  // from, and this parser renders model output.
  //
  // Each case here hung before. A test that takes forever is a failing test, so the assertion is
  // simply that these return.
  for (const source of ['````', '``````````', '`'.repeat(200), '``` js', '```js extra stuff', '``` \t']) {
    const out = blocks(source)
    assert.ok(out.length <= 2, `${JSON.stringify(source.slice(0, 14))} produced ${out.length} blocks`)
  }
})

test('and a line that still is not a fence must not stop it either', () => {
  // Widening the opener removed today's way in. It did not remove the *shape* — an info string
  // with a backtick in it is still not a fence, and still breaks the paragraph branch, so the
  // line is still one nothing consumes.
  //
  // These cases exist because the first version of this test did not have them: with the opener
  // widened, every shape it checked was handled, and removing the forward-progress guarantee
  // broke nothing. A guard nothing exercises is a claim. These exercise it.
  for (const source of ['```js`x', '```a`', '``` a `b', '`````x`']) {
    const out = blocks(source)
    assert.ok(out.length <= 2, `${JSON.stringify(source)} produced ${out.length} blocks`)
    // And the line is rendered rather than skipped: somebody wrote it.
    assert.match(out.map((b) => b.textContent).join(''), /x|a|b/, JSON.stringify(source))
  }
})

test('a fence is three or more backticks, and its info string may be a sentence', () => {
  // CommonMark allows both, and a model writes both.
  const four = one('````\nkept\n````')
  assert.equal(four.tag, 'pre')
  assert.equal(four.children[0]?.textContent, 'kept')

  const info = one('```js extra stuff\nconst a = 1\n```')
  assert.equal(info.tag, 'pre')
  assert.equal(info.dataset['lang'], 'js', 'the first word of the info string is the language')
  assert.equal(info.children[0]?.textContent, 'const a = 1')

  const spaced = one('``` ts\ncode\n```')
  assert.equal(spaced.dataset['lang'], 'ts')

  // A closing fence is backticks and nothing else — an info string only opens.
  const closed = one('```\na\n``` not-a-closer\nb\n```')
  assert.equal(closed.children[0]?.textContent, 'a\n``` not-a-closer\nb')
})

test('a line no branch claims is still rendered, not skipped', () => {
  // The forward-progress guarantee doubles as an honesty one: a line the parser cannot classify
  // is still something somebody wrote, and dropping it would be the fourth standing order in the
  // surface that shows what was said.
  const out = blocks('````')
  assert.equal(out.length, 1)
})
