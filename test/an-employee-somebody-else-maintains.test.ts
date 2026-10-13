/**
 * A colleague's reviewer is still theirs.
 *
 * VISION.md's fourth section wants employees a colleague maintains in their own repo — they
 * control and edit it there, and it is always available to review our code. The naive
 * build is a download button, and it is wrong in a way that stays invisible for months: the
 * roster ends up printing a real person's name over a snapshot of what they wrote in March.
 *
 * So the thing under test is not the copy. It is whether the office can still answer *"is this
 * still theirs?"* — and, in the one case where the answer is complicated, whether it declines to
 * simplify.
 *
 * The shape of the bug this file exists to prevent is the one this codebase keeps meeting: two
 * different facts flattened into one word that agrees with both until a case pulls them apart.
 * Here the two facts are *has our copy changed* and *has theirs*, and the case that pulls them
 * apart is both.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  whyNotASource,
  standingOf,
  updateIsSafe,
  updateWouldOverwriteLocalWork,
  saidPlainly,
  type Provenance,
  type Standing,
} from '../src/shared/hired-from.js'

const HIRED = 'sha-at-hire'

const wren: Provenance = {
  id: 'wren-review',
  source: { kind: 'git', at: 'https://github.com/company/agents.git', file: 'agents/wren-review.md' },
  hiredHash: HIRED,
  hiredAt: '2026-03-04',
}

test('unchanged on both sides is the same as theirs', () => {
  const s = standingOf(wren, HIRED, { seen: true, hash: HIRED })
  assert.deepEqual(s, { here: 'as-hired', there: 'as-hired' })
  assert.equal(updateIsSafe(s), false, 'nothing to take')
  assert.match(saidPlainly(s), /same as theirs/)
})

test('they changed theirs and we did not: an update, and a safe one', () => {
  const s = standingOf(wren, HIRED, { seen: true, hash: 'sha-wren-rewrote-it' })
  assert.deepEqual(s, { here: 'as-hired', there: 'moved-on' })
  assert.equal(updateIsSafe(s), true)
  assert.equal(updateWouldOverwriteLocalWork(s), false)
})

test('we changed ours and they did not: no update exists to take', () => {
  const s = standingOf(wren, 'sha-we-tuned-it', { seen: true, hash: HIRED })
  assert.deepEqual(s, { here: 'edited', there: 'as-hired' })
  assert.equal(updateIsSafe(s), false)
  assert.match(saidPlainly(s), /Edited here.*[Tt]heirs is unchanged/)
})

/*
 * The case a single status cannot hold.
 *
 * One status word has to pick a side. Call it out-of-date and a one-click update destroys the
 * tuning somebody did here; call it edited-locally and their improvements never arrive. It is
 * the only combination where both a plain update button and a plain nothing-to-do are wrong, so
 * it is the only one that proves the two fields are really two facts.
 */
test('both changed: not offered as a plain update, and named as the reason', () => {
  const s = standingOf(wren, 'sha-we-tuned-it', { seen: true, hash: 'sha-wren-rewrote-it' })
  assert.deepEqual(s, { here: 'edited', there: 'moved-on' })
  assert.equal(updateIsSafe(s), false, 'never a one-click action')
  assert.equal(updateWouldOverwriteLocalWork(s), true, 'and the caller can tell which unsafe this is')
  const said = saidPlainly(s)
  assert.match(said, /changed theirs/, 'their change is stated')
  assert.match(said, /edited here/i, 'ours is too — neither hides the other')
  assert.match(said, /replace those edits/, 'and what taking theirs would cost')
})

/*
 * Three silences, three sentences.
 *
 * Wifi being off must never render as a colleague retiring their reviewer, and neither may render
 * as up to date. `unchecked` is the resting state of every row, because checking costs a clone.
 */
test('not looked, could not reach, and deleted upstream are three different answers', () => {
  const notLooked = standingOf(wren, HIRED, null)
  const noReach = standingOf(wren, HIRED, { seen: false, why: 'unreachable', detail: 'getaddrinfo ENOTFOUND' })
  const deleted = standingOf(wren, HIRED, { seen: false, why: 'withdrawn', detail: 'not in the source' })

  assert.equal(notLooked.there, 'unchecked')
  assert.equal(noReach.there, 'unreachable')
  assert.equal(deleted.there, 'withdrawn')

  const said = [notLooked, noReach, deleted].map(saidPlainly)
  assert.equal(new Set(said).size, 3, 'three distinct sentences')
  for (const s of said) assert.doesNotMatch(s, /same as theirs/, 'and none of them claims agreement')
  assert.match(saidPlainly(deleted), /removed it/, 'a person deleted it: a decision, not a failure')
  assert.match(saidPlainly(noReach), /could not be reached/, 'a failure, which is not a decision')
})

/* Every silence still carries the local half — the two fields never collapse into one. */
test('a local edit is still reported when the source cannot be reached', () => {
  const s = standingOf(wren, 'sha-we-tuned-it', { seen: false, why: 'unreachable', detail: 'offline' })
  assert.deepEqual(s, { here: 'edited', there: 'unreachable' })
  assert.match(saidPlainly(s), /Edited here/)
  assert.match(saidPlainly(s), /nothing is known about it/, 'and no guess about theirs')
})

test('an employee who was fired is missing here, whatever the source says', () => {
  const s = standingOf(wren, null, { seen: true, hash: HIRED })
  assert.deepEqual(s, { here: 'missing', there: 'as-hired' })
  assert.match(saidPlainly(s), /No longer in this office/)
})

/*
 * The independence claim, checked rather than asserted in a comment.
 *
 * If any combination were unreachable or produced a duplicate sentence, one field would be
 * derivable from the other and the pair would be one fact wearing a disguise.
 */
test('every combination of the two facts is reachable and says something of its own', () => {
  const here: Standing['here'][] = ['as-hired', 'edited', 'missing']
  const there: Standing['there'][] = ['as-hired', 'moved-on', 'withdrawn', 'unreachable', 'unchecked']
  const said = new Map<string, string>()
  for (const h of here) {
    for (const t of there) {
      said.set(`${h}/${t}`, saidPlainly({ here: h, there: t }))
    }
  }
  assert.equal(said.size, 15)
  for (const [combination, sentence] of said) {
    assert.ok(sentence.trim().length > 0, `${combination} says nothing`)
  }
  // A fired employee reads the same whatever their source did, except when we could not look —
  // the one distinction worth keeping there is that the comparison did not happen.
  const missing = [...said].filter(([k]) => k.startsWith('missing/')).map(([, v]) => v)
  assert.equal(new Set(missing).size, 2, 'gone, and gone-with-no-comparison')
})

/*
 * The string in the box becomes an argument to `git`.
 *
 * Not shell injection — `execFile` is handed an array and no shell ever sees it. The other kind:
 * git interprets its own argv, and two positions in it name commands to run. A URL starting with
 * a dash lands in the option slot, and `ext::` is a transport whose entire purpose is running one.
 */
test('a source that git would read as an instruction rather than a location is refused', () => {
  assert.equal(whyNotASource('https://github.com/company/agents.git'), null)
  assert.equal(whyNotASource('/Users/somebody/agents'), null)

  assert.match(whyNotASource('--upload-pack=touch /tmp/x') ?? '', /start with a dash/)
  assert.match(whyNotASource('ext::sh -c whoami') ?? '', /run a command of their own/)
  assert.match(whyNotASource('EXT::sh -c whoami') ?? '', /run a command of their own/, 'case does not excuse it')
  assert.match(whyNotASource('   ') ?? '', /repository URL or a directory/)
})
