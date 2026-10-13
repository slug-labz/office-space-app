/**
 * Cutting text without cutting a character in half.
 *
 * `slice` counts UTF-16 code units, and everything outside the Basic Multilingual Plane occupies
 * two. A cut between the halves of an emoji leaves a lone surrogate, which is not a character —
 * it renders as **�**, in a transcript whose whole job is to be a record of what was written.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { truncate } from '../src/shared/truncate.js'

/** A lone surrogate: a high one not followed by a low, or a low one not preceded by a high. */
const half = (s: string): boolean => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)

test('THE BUG: a cut that lands inside an emoji does not leave half of one', () => {
  // Both of these produced a lone high surrogate before, at exactly this limit.
  for (const source of ['x'.repeat(39) + '🚀tail', 'z'.repeat(39) + '🇬🇧 tail', 'a'.repeat(39) + '𝄞 tail']) {
    const out = truncate(source, 40)
    assert.equal(half(out), false, `${JSON.stringify(out.slice(-6))} contains half a character`)
  }

  // And `slice` — the thing being replaced — does, which is what makes the test above mean
  // something rather than merely pass.
  assert.equal(half('x'.repeat(39) + '🚀tail'.slice(0)), false, 'the source itself is well formed')
  assert.equal(half(('x'.repeat(39) + '🚀tail').slice(0, 40)), true, 'slice(0, 40) splits it')
})

test('the limit counts characters a person would count, not code units', () => {
  // Ten rockets is ten characters and twenty code units. Cutting at 10 keeps all ten.
  const rockets = '🚀'.repeat(10)
  assert.equal(rockets.length, 20, 'twenty code units')
  assert.equal(truncate(rockets, 10), rockets, 'and ten characters, so nothing is removed')
  assert.equal([...truncate(rockets, 4, '')].length, 4)
})

test('text that fits is returned unchanged, with no mark', () => {
  assert.equal(truncate('short', 40), 'short')
  assert.equal(truncate('', 40), '')
  // Exactly at the limit is not "more than", so it gains no ellipsis.
  assert.equal(truncate('x'.repeat(40), 40), 'x'.repeat(40))
  assert.equal(truncate('x'.repeat(41), 40), 'x'.repeat(40) + '…')
})

test('the suffix is the caller\'s, and is not counted against the limit', () => {
  // Two callers need different marks: the transcript clamps with a newline before the ellipsis so
  // the cut reads as a break in output, and the approval summary draws its own from `truncated`
  // and must not be given a second one here.
  assert.equal(truncate('abcdef', 3), 'abc…')
  assert.equal(truncate('abcdef', 3, '\n…'), 'abc\n…')
  assert.equal(truncate('abcdef', 3, ''), 'abc')
})

test('a grapheme cluster may still be split, and that is the stated limit', () => {
  // `[...text]` iterates code points, not graphemes. A family emoji is four people joined by
  // zero-width joiners, and a cut inside one leaves *valid characters* that render as separate
  // people. That is uglier than intended; it is not a character nobody typed. The difference is
  // the whole reason this stops here rather than reaching for `Intl.Segmenter`.
  const family = '👨‍👩‍👧‍👦'
  const out = truncate('y'.repeat(38) + family + ' tail', 40)
  assert.equal(half(out), false, 'still no half-characters, which is the promise')
})

test('the cost is the limit, not the length of what is thrown away', () => {
  // The first version spread the whole string — `[...text]` — to keep the first `limit` code
  // points of it. Measured, clamping to 2000: 1MB cost 6.9ms and 5MB cost 38ms, all of it
  // building an array that was immediately discarded. This runs on every tool result in the
  // transcript, so the price was set by the size of the part being removed.
  //
  // Calibrated against the machine rather than a wall-clock threshold: the same spread this used
  // to do is timed here, and the truncation has to come in far under it. A fixed number of
  // milliseconds would be a test about how busy the CPU is.
  const big = 'x'.repeat(2_000_000)

  const t0 = process.hrtime.bigint()
  const spread = [...big].length
  const spreadNs = Number(process.hrtime.bigint() - t0)
  assert.equal(spread, 2_000_000)

  const t1 = process.hrtime.bigint()
  const out = truncate(big, 2000)
  const cutNs = Number(process.hrtime.bigint() - t1)

  assert.equal(out.length, 2001)
  assert.ok(
    cutNs * 5 < spreadNs,
    `truncating cost ${(cutNs / 1e6).toFixed(1)}ms against a full spread of ${(spreadNs / 1e6).toFixed(1)}ms — ` +
      'that is the whole input being walked to keep 2000 characters of it',
  )
})
