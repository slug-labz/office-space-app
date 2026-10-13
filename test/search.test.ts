/**
 * Searching a workspace, and the silence that is the whole point.
 *
 * The matching is arithmetic. What these tests are about is that a search reads several sources,
 * any of which can fail on its own, and that "nothing matched" and "nothing matched in the half I
 * could read" must never be the same sentence — because a person acts on the first one by
 * concluding the thing was never written down.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { byPlace, matchesIn, nothingWasSearched, summarise, type Searched, whatWasNotSearched } from '../src/shared/search.js'

const searched = (over: Partial<Searched> = {}): Searched => ({
  hits: [],
  looked: ['memory', 'project', 'conversation', 'dispatch'],
  blind: [],
  ...over,
})

test('a match reports where it is and where in the line', () => {
  const [hit] = matchesIn('alpha bravo charlie', 'bravo', 'memory', 'memory/notes.md')
  assert.equal(hit?.where, 'memory/notes.md')
  assert.equal(hit?.line, 1)
  assert.equal(hit?.text, 'alpha bravo charlie')
  // The offsets must actually mark the match, or a renderer highlights the wrong characters.
  assert.equal(hit?.text.slice(hit.at.start, hit.at.end), 'bravo')
})

test('matching ignores case, because a person searching their own notes is not being precise', () => {
  assert.equal(matchesIn('The RETRY helper', 'retry', 'project', 'p').length, 1)
})

test('a line matching three times is one place to look, not three rows', () => {
  // Three rows would push other files off the screen while saying nothing new.
  assert.equal(matchesIn('retry retry retry', 'retry', 'project', 'p').length, 1)
})

test('a long line is cut around the match, not from the start', () => {
  /*
   * The failure this prevents: a result that proves a match exists and will not say where. A
   * minified line or a long paragraph shows its first 200 characters and hides the thing being
   * searched for.
   */
  const body = `${'x'.repeat(400)} needle ${'y'.repeat(400)}`
  const [hit] = matchesIn(body, 'needle', 'conversation', 'c')
  assert.ok(hit)
  assert.ok(hit.text.includes('needle'), 'the match itself was cut out of its own result')
  assert.ok(hit.text.length < 250, `kept ${hit.text.length} characters — the cut did not happen`)
  assert.equal(hit.text.slice(hit.at.start, hit.at.end), 'needle', 'offsets do not survive the cut')
})

test('an empty query matches nothing rather than everything', () => {
  // The alternative is that clearing the box returns the whole workspace.
  assert.deepEqual(matchesIn('anything at all', '   ', 'memory', 'm'), [])
})

// ── the part this module exists for ──────────────────────────────────────────────────────────

test('nothing found with everything read is a real answer', () => {
  const said = summarise(searched(), 'retry')
  assert.match(said, /Nothing in this workspace matches/)
})

test('nothing found with a source unread is NOT the same sentence', () => {
  /*
   * The one that matters. Somebody searches for a decision they half-remember, sees "nothing
   * matches", and concludes it was never written down — while the directory holding it could not
   * be opened.
   */
  const said = summarise(searched({ blind: [{ source: 'memory', extent: 'none', why: 'permission denied' }] }), 'retry')
  assert.match(said, /the part of this workspace that could be read/)
  assert.doesNotMatch(said, /Nothing in this workspace matches/)
})

test('what was not searched is named, with the reason', () => {
  const said = whatWasNotSearched(searched({ blind: [{ source: 'memory', extent: 'none', why: 'permission denied' }] }))
  assert.match(said ?? '', /did not search memory \(permission denied\)/)
})

test('several unread sources read as a list, not as one', () => {
  const said = whatWasNotSearched(
    searched({
      blind: [
        { source: 'memory', extent: 'none', why: 'permission denied' },
        { source: 'conversation', extent: 'none', why: 'a transcript would not parse' },
      ],
    }),
  )
  assert.match(said ?? '', /memory \(permission denied\) or conversation/)
})

test('a workspace read completely says nothing about blind spots', () => {
  // A permanent caveat about a thing that is fine is how a real one stops being read.
  assert.equal(whatWasNotSearched(searched()), null)
})

test('a source that holds nothing is not a source that could not be read', () => {
  /*
   * `looked` and `blind` are different lists on purpose. An empty memory directory has been
   * searched; an unreadable one has not, and only the second is a gap in the answer.
   */
  const empty = searched({ looked: ['memory'], blind: [] })
  assert.equal(whatWasNotSearched(empty), null)
  assert.match(summarise(empty, 'retry'), /Nothing in this workspace matches/)
})

// ── presentation ─────────────────────────────────────────────────────────────────────────────

test('the count is of matches and of places, because both are what somebody wants', () => {
  const hits = [
    ...matchesIn('retry\nretry again', 'retry', 'project', 'a.md'),
    ...matchesIn('retry', 'retry', 'memory', 'b.md'),
  ]
  assert.match(summarise(searched({ hits }), 'retry'), /3 matches for "retry", in 2 places/)
})

test('one match does not say "1 matches"', () => {
  const hits = matchesIn('retry', 'retry', 'memory', 'b.md')
  assert.match(summarise(searched({ hits }), 'retry'), /^1 match for "retry", in 1 place\./)
})

test('an empty query asks for one rather than reporting a result', () => {
  assert.match(summarise(searched(), '  '), /Type something to search for/)
})

test('hits group by place, keeping the order places were first seen', () => {
  const hits = [
    ...matchesIn('retry', 'retry', 'project', 'a.md'),
    ...matchesIn('retry', 'retry', 'memory', 'b.md'),
    ...matchesIn('retry\nand retry', 'retry', 'project', 'a.md'),
  ]
  const groups = byPlace(hits)
  assert.deepEqual(groups.map((g) => g.where), ['a.md', 'b.md'])
  assert.equal(groups[0]?.hits.length, 3, 'the two reads of a.md were not grouped together')
})

test('a source read in part is not reported as a source not read', () => {
  /*
   * The sentence that contradicted its own parenthetical, on the machine it was written on:
   *
   *     This did not search conversation (only the 60 most recent of 553 were read).
   *     1 match for "backoff", in 1 place.
   *
   * Sixty conversations were read and a match was found in one of them, above a line asserting
   * that conversations were not searched.
   */
  const partial = whatWasNotSearched({
    hits: [],
    looked: ['conversation'],
    blind: [{ source: 'conversation', extent: 'some', why: 'only the 60 most recent of 553 were read' }],
  })
  assert.match(partial ?? '', /searched only part of conversation/)
  assert.doesNotMatch(partial ?? '', /did not search/)

  const none = whatWasNotSearched({
    hits: [],
    looked: [],
    blind: [{ source: 'memory', extent: 'none', why: 'permission denied' }],
  })
  assert.match(none ?? '', /did not search memory/)
  assert.doesNotMatch(none ?? '', /only part/)
})

test('one source failing twice is named once', () => {
  // `did not search conversation (…) or conversation (…)` — a source cannot be two members of a
  // list of what was missed.
  const said =
    whatWasNotSearched({
      hits: [],
      looked: ['conversation'],
      blind: [
        { source: 'conversation', extent: 'some', why: 'only the 60 most recent of 553 were read' },
        { source: 'conversation', extent: 'some', why: 'the retry thread: 3 records would not parse' },
      ],
    }) ?? ''
  assert.equal((said.match(/conversation/g) ?? []).length, 1, 'the source was listed twice')
  assert.match(said, /60 most recent/)
  assert.match(said, /would not parse/, 'the second cause was dropped when the first was kept')
})

test('a source both wholly and partly unread is reported as wholly unread', () => {
  // The two sentences mean opposite things about the results underneath them, so nothing merges
  // across that line — and "not searched at all" is the one that must win.
  const said =
    whatWasNotSearched({
      hits: [],
      looked: [],
      blind: [
        { source: 'memory', extent: 'some', why: 'one file would not parse' },
        { source: 'memory', extent: 'none', why: 'then the directory would not open' },
      ],
    }) ?? ''
  assert.match(said, /did not search memory/)
  assert.doesNotMatch(said, /only part of memory/)
})

test('a search that failed outright says so about every source, not about memory', () => {
  /*
   * The old shape hardcoded `memory`, so a total failure told the reader memory was the gap and,
   * by omission, that projects, dispatches and conversations had been read and held no match.
   * Blindness was under-reported for three of four sources at the moment it was total.
   */
  const nothing = nothingWasSearched('the search failed — boom')
  assert.deepEqual([...nothing.looked], [], 'a failed search claimed to have read something')
  assert.deepEqual(
    nothing.blind.map((b) => b.source).sort(),
    ['conversation', 'dispatch', 'memory', 'project'],
    'a total failure did not name every source',
  )
  assert.equal(nothing.blind.every((b) => b.extent === 'none'), true)
  assert.match(summarise(nothing, 'backoff'), /could be read/)
})
