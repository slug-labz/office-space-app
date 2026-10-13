/**
 * The account the office gives of the approvals it was asked for.
 *
 * The gate has always kept a perfect record of its own absences — `missed()` files every request
 * nobody answered and nothing ever removes one — and no record at all of a person's decisions,
 * because `cleanup()` unlinks the verdict the instant it has been read. So this module is the
 * second half arriving, and the tests below are mostly about the ways a second half can lie.
 *
 * ## The one that matters
 *
 * A count is an assertion. The filing that feeds it is **best-effort by construction** — the hook
 * runs it on the way to a decision already made and may not throw, because an exception in a
 * `PreToolUse` hook is not a refusal — so the record has holes on purpose. An account that
 * reported only what it could place in time would be accurate about its window and silent about
 * the rest, which is how a number comes to mean something other than what it says.
 *
 * `search.ts` reached the same shape from the other direction with `Blind.extent`: *"this
 * searched only part of it"* is a third answer, and collapsing it into either of the other two is
 * the fourth standing order landing inside the feature built to serve it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  couldNotLook,
  decided,
  filedAt,
  filedOutcome,
  nightLede,
  tally,
  within,
} from '../src/shared/decisions.js'

/** 2026-09-04T00:00:00Z, as the epoch milliseconds a filename carries. */
const MIDNIGHT = 1_772_582_400_000
const HOUR = 3_600_000

const decision = (at: number | string, outcome: string) => `${at}.${outcome}.sess.tool-1.decision.json`
const missed = (at: number | string) => `${at}.sess.tool-1.request.json`

test('a name written before the office dated them has no time, and that is not zero', () => {
  /*
   * `Number('')` is 0 and `Number('sess')` is NaN, and both would be disasters read as a time:
   * the first dates a record to 1970, which sorts before every window and vanishes from all of
   * them, and the second compares false against everything.
   */
  assert.equal(filedAt(`${MIDNIGHT}.allowed.sess.tool-1.decision.json`), MIDNIGHT)
  assert.equal(filedAt('sess.tool-1.request.json'), null, 'an old undated name was given a time')
  assert.equal(filedAt('.hidden'), null, 'an empty leading field became the epoch')
  assert.equal(filedAt('0.allowed.sess.tool.decision.json'), null, 'zero is not a time anything was filed at')
})

test('an outcome the office did not write is not an outcome', () => {
  assert.equal(filedOutcome(decision(MIDNIGHT, 'allowed')), 'allowed')
  assert.equal(filedOutcome(decision(MIDNIGHT, 'declined')), 'declined')
  assert.equal(filedOutcome(decision(MIDNIGHT, 'unreadable')), 'unreadable')
  assert.equal(filedOutcome(decision(MIDNIGHT, 'approved')), null, 'a word nobody writes was accepted')
  assert.equal(filedOutcome('notes.txt'), null)
})

test('a file nobody filed is not counted as a decision anybody made', () => {
  /*
   * The directory is a directory; anything can end up in it. Counting a stray file as `undated`
   * would be the milder version of the same error — it would put a number on the screen saying
   * somebody answered something, which no click produced.
   */
  const t = tally([decision(MIDNIGHT, 'sideways'), 'README.md', decision(MIDNIGHT, 'allowed')], [], MIDNIGHT)
  assert.equal(t.allowed, 1)
  assert.equal(within(t), 1, 'a file nobody wrote was counted as an approval')
  assert.equal(t.undated, 0, 'an unrecognised name was filed under "cannot place in time"')
})

test('and a stray file in missed/ is not counted as an approval nobody answered', () => {
  /*
   * The same rule for the other half, and it needs its own test because it is a separate `continue`
   * over a separate suffix — the one above would pass on a `tally` that filtered decisions and let
   * anything at all through as unanswered.
   *
   * This assertion used to live against the read itself, which filtered `.request.json` before
   * counting. The read now returns every name and the filter is here, so this is where the claim
   * has to be made: `.DS_Store` is not a tool call that waited four minutes and was refused, and a
   * number on a person's screen saying it was is a number no gate produced.
   */
  const t = tally([], [missed(MIDNIGHT), '.DS_Store', 'notes.txt'], MIDNIGHT)
  assert.equal(t.unanswered, 1, 'something that is not a request was counted as one')
  assert.equal(within(t), 1, 'a file nobody wrote was counted as an unanswered approval')
  assert.equal(t.undated, 0, 'an unrecognised name was filed under "cannot place in time"')
})

test('the window includes and excludes, and the two are told apart', () => {
  const t = tally(
    [
      decision(MIDNIGHT + HOUR, 'allowed'),
      decision(MIDNIGHT + HOUR, 'allowed'),
      decision(MIDNIGHT + HOUR, 'declined'),
      decision(MIDNIGHT - HOUR, 'allowed'),
    ],
    [missed(MIDNIGHT + HOUR), missed(MIDNIGHT - HOUR)],
    MIDNIGHT,
  )
  assert.deepEqual(
    { allowed: t.allowed, declined: t.declined, unanswered: t.unanswered, older: t.older },
    { allowed: 2, declined: 1, unanswered: 1, older: 2 },
  )
  assert.equal(decided(t), 3, 'a decision somebody made was counted as one nobody made, or the reverse')
})

test('a record the office cannot place in time is never folded into a quiet night', () => {
  /*
   * The load-bearing one. An office upgraded mid-week holds records from both versions, and the
   * undated half is exactly the half from before anybody was watching this closely.
   *
   * Reporting "nothing happened" over a directory full of unplaceable records is the fourth
   * standing order broken inside the feature that exists to keep it.
   */
  const t = tally([decision('sess', 'allowed')], [missed('sess')], MIDNIGHT)
  assert.equal(within(t), 0, 'an undated record was counted inside a window it cannot be placed in')
  assert.equal(t.undated, 2)

  const said = nightLede(t, 12) ?? ''
  assert.match(said, /No tool call has needed your approval/)
  assert.match(said, /cannot place in time/, 'the office reported a quiet night over records it could not read')
  assert.match(said, /2/, 'it admitted there were some and would not say how many')
})

test('a workspace where nothing has ever been asked says nothing at all', () => {
  // The other direction, and the one that decides whether this can be ignored. Six zeroes on a
  // fresh workspace is a panel nobody reads by the second day.
  assert.equal(nightLede(tally([], [], MIDNIGHT), 12), null)
})

test('an empty window still speaks when there is something outside it', () => {
  // "None tonight" is only information beside the fact that there were some before. Without this,
  // an office that lost four calls last week and none tonight is indistinguishable from one that
  // has never lost any.
  const said = nightLede(tally([], [missed(MIDNIGHT - HOUR)], MIDNIGHT), 12) ?? ''
  assert.match(said, /No tool call has needed your approval in the last 12 hours/)
  assert.match(said, /1 older/)
})

test('the count clears itself as the window moves, with nothing deleted', () => {
  /*
   * The claim `main.ts` now rests on, so it is pinned here rather than left in a comment.
   *
   * The workspace problem fires on `unanswered > 0`. Before the window that was a lifetime total
   * over a directory nothing prunes — one unattended night put twelve on the status bar and no
   * day of perfect attendance took any of it back, so the only way to clear it was to delete the
   * store.
   *
   * That remedy is worse than the defect and this is what replaces it: a missed request outside
   * the window is `older`, not `unanswered`, so the trigger goes quiet on its own a day after the
   * last one. Nothing is deleted, and the record still says the older ones are there.
   *
   * It matters because the remedy would now destroy this feature's own output — `forget()` empties
   * the store of everything not `shipped` and this store has no `shipped` list, so it takes
   * `decided/` too.
   */
  const stale = tally([], [missed(MIDNIGHT - HOUR), missed(MIDNIGHT - 5 * HOUR)], MIDNIGHT)
  assert.equal(stale.unanswered, 0, 'a request older than the window still trips the problem card')
  assert.equal(stale.older, 2, 'the older ones stopped being counted at all rather than moving bucket')

  // And one inside it still does, or the card has stopped working rather than stopped nagging.
  const fresh = tally([], [missed(MIDNIGHT + HOUR)], MIDNIGHT)
  assert.equal(fresh.unanswered, 1)
})

test('every outcome is named, and the refused ones say they were refused', () => {
  const t = tally(
    [
      decision(MIDNIGHT + HOUR, 'allowed'),
      decision(MIDNIGHT + HOUR, 'declined'),
      decision(MIDNIGHT + HOUR, 'unreadable'),
    ],
    [missed(MIDNIGHT + HOUR), missed(MIDNIGHT + HOUR)],
    MIDNIGHT,
  )
  const said = nightLede(t, 12) ?? ''

  assert.match(said, /1 approved/)
  assert.match(said, /1 declined/)
  // The one a summary would drop. A decision the office failed to carry is not a refusal and not
  // an approval, and it is the class it can least afford to be quiet about.
  assert.match(said, /could not read which way/)
  assert.match(said, /2 that nobody answered in time, so those were refused/)
})

test('one of a thing reads as one of a thing', () => {
  // Singular/plural is not decoration here: "1 that nobody answered in time, so those were
  // refused" is the sentence that makes somebody stop trusting the rest of the panel.
  const said = nightLede(tally([], [missed(MIDNIGHT + HOUR)], MIDNIGHT), 1) ?? ''
  assert.match(said, /In the last hour: 1 that nobody answered in time, so it was refused\./)
})

test('the two halves of the record fail separately, and say which failed', () => {
  /*
   * They can fail apart — one directory unreadable and the other fine — and a single "could not
   * look" would throw away half an answer the office actually has.
   */
  assert.match(couldNotLook('decisions'), /what it approved/)
  assert.match(couldNotLook('missed'), /what went unanswered/)
  assert.match(couldNotLook('both'), /what it approved or what went unanswered/)
  for (const which of ['decisions', 'missed', 'both'] as const) {
    assert.match(couldNotLook(which), /Nothing in it has been changed/, `${which} does not say the record is untouched`)
  }
})
