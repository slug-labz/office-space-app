/**
 * "Does this match what I typed" — one answer, and the reason it is only one.
 *
 * The command palette and the switcher's filter are two lists a person searches in one app. Two
 * ideas of what counts as a match is the shape this repository keeps finding: the palette would
 * find `pmt` in "payment page" and the switcher would not, from the same three letters, with
 * nothing on screen to explain the difference.
 *
 * So `subsequenceStart` was lifted out of `actions.ts` when the switcher needed it, rather than
 * copied. The behaviour below is what both surfaces inherit.
 *
 * ## The position, not a boolean
 *
 * `subsequenceStart` returns **where the match begins**, and that is the useful part: an exact
 * prefix beats a scattered subsequence, and a caller sorting by it gets that ordering for free
 * rather than inventing a second ranking rule per list.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { matchIn, subsequenceStart } from '../src/shared/match.js'

test('the letters have to appear in order, and not next to each other', () => {
  // The whole point. Typing the shape of a thing rather than its opening letters is what makes a
  // search box worth opening.
  assert.equal(subsequenceStart('payment page', 'pmt'), 0)
  assert.equal(subsequenceStart('privacy', 'phv'), null, 'letters that are not in the string matched')
  assert.equal(subsequenceStart('privacy', 'pvy'), 0)
  assert.equal(subsequenceStart('privacy', 'yvp'), null, 'letters matched out of order')
})

test('it says where the match starts, so a prefix can beat a scatter', () => {
  assert.equal(subsequenceStart('auth refresh', 'auth'), 0, 'a prefix should start at 0')
  assert.equal(subsequenceStart('the auth thing', 'auth'), 4, 'a match inside should report its position')
  // Which is what lets a caller sort: 0 sorts ahead of 4, with no second rule.
  assert.ok((subsequenceStart('auth refresh', 'auth') ?? 9) < (subsequenceStart('the auth thing', 'auth') ?? 9))
})

test('an empty needle matches everything, at the start', () => {
  // The empty query is not "nothing matches" — it is "no filter". A caller that treated `null`
  // and `0` the same would empty its own list the moment somebody cleared the box.
  assert.equal(subsequenceStart('anything', ''), null, 'an empty needle has no position of its own')
  assert.equal(matchIn(['anything'], ''), 0, 'clearing the filter emptied the list instead of restoring it')
  assert.equal(matchIn(['anything'], '   '), 0, 'a query of spaces was treated as a search')
})

test('several names, and the best one wins', () => {
  // A project has a label and a directory id, and somebody who knows it from the filesystem
  // types the hyphen. Both are searched; the earlier match is the one reported.
  assert.equal(matchIn(['auth refresh', 'auth-refresh'], 'auth-'), 0, 'the id was not searched')
  assert.equal(matchIn(['the reviewer', 'reviewer'], 'rev'), 0, 'the later name matched better and was not used')
  assert.equal(matchIn(['payment page', 'payment-page'], 'zzz'), null)
})

test('case does not matter to the person typing', () => {
  assert.equal(matchIn(['Payment Page'], 'payment'), 0)
  assert.equal(matchIn(['payment page'], 'PAYMENT'), 0)
})

test('an empty list of names matches nothing rather than everything', () => {
  // A conversation with no title has `''` for a name. It must not become the row that matches
  // every query — which is what a `''.includes(...)`-shaped matcher would do.
  assert.equal(matchIn([], 'anything'), null)
  assert.equal(matchIn([''], 'a'), null, 'an untitled row matched a query it has no letters for')
  assert.equal(matchIn([''], ''), 0, 'an untitled row disappeared when the filter was empty')
})
