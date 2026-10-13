/**
 * The receipt must not say a thing happened that did not.
 *
 * Approving a tool call writes a verdict to disk and appends *"you allowed: <command>"* to the
 * activity log. `app.ts` did the second one **first** — the log entry was written, then
 * `office.decide` was awaited, then the transcript said so.
 *
 * `office.decide` can reject. `approvals.ts` throws on an id containing a slash, because it
 * becomes a filename, and on a request addressed to a different workspace. When it does:
 *
 *   1. the card is already off the strip, so there is no way to try again,
 *   2. the activity log already reads "you allowed: rm -rf …",
 *   3. nothing has reached disk,
 *   4. four minutes later the gate stops waiting and **denies** the call.
 *
 * The record says the user allowed something that was refused, on the surface whose entire job is
 * being the receipt. It was invisible because a rejected `invoke` had nowhere to go at all — the
 * renderer had no rejection handler, which is the fault `mishaps.ts` fixes.
 *
 * Found by `office-space-6c`, which named `decide` as the worst place in the app for an unhandled
 * rejection from reading `approvals.ts` alone, before either of us had looked at this function.
 *
 * ## Why this is a value and not an ordering
 *
 * Ordering is what went wrong, and ordering is the thing a test cannot see: any test of the old
 * code would have had to assert that one line ran after another. So the rule is a return value
 * instead — **`note` is `null` unless the write succeeded** — and there is no arrangement of the
 * calling code that turns a failure into a log entry.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decided } from '../src/shared/approval-decision.js'

const request = { tool: 'Bash', line: 'rm -rf build', allow: true }

test('a write that failed leaves nothing in the log', () => {
  const d = decided({ ...request, failure: 'EACCES: permission denied' })

  assert.equal(
    d.note,
    null,
    'a decision that never reached disk produced a log entry. That entry is a record of ' +
      'something that did not happen, and the gate is about to deny the call it claims was allowed.',
  )
  assert.equal(d.recorded, false)
})

test('and it says what went wrong, and what happens next', () => {
  const d = decided({ ...request, failure: 'EACCES: permission denied' })

  assert.match(d.said, /was not allowed/, `the sentence reads ${JSON.stringify(d.said)}`)
  assert.match(d.said, /EACCES/, 'the reason is not carried, so nobody can act on it')
  assert.match(
    d.said,
    /deny this call/i,
    'the sentence does not say what the office will do. "It failed" without "and so the call will ' +
      'be denied" leaves somebody waiting for a run that is already lost.',
  )
  assert.equal(d.tone, 'failed')
})

test('the card goes back, because the request is still live', () => {
  // Not tidiness. The gate is still waiting; the card is the only control that can answer it. A
  // decision that failed and took its own button away leaves a call that can only time out.
  assert.equal(decided({ ...request, failure: 'nope' }).restore, true)
  assert.equal(decided({ ...request, failure: null }).restore, false, 'a decision that worked put its card back')
})

test('a decision that reached disk is logged by what it was about, not by the tool', () => {
  // This read `allowed Bash`, forty-one times in a row, and could not answer the only question
  // anybody would put to a log: what did I allow?
  const d = decided({ ...request, failure: null })

  assert.equal(d.note, 'allowed: rm -rf build')
  assert.notEqual(d.note, 'allowed: Bash')
  assert.equal(d.recorded, true)
  assert.match(d.said, /Bash allowed, once/, `the transcript line reads ${JSON.stringify(d.said)}`)
})

test('refusing is a decision that worked, and is logged as one', () => {
  const d = decided({ tool: 'Write', line: 'src/main/main.ts', allow: false, failure: null })

  assert.equal(d.note, 'refused: src/main/main.ts', 'a refusal was not written down')
  assert.equal(d.recorded, true, 'a refusal that reached disk was reported as not recorded')
  assert.equal(d.restore, false, 'a refusal put its own card back and can be pressed again')
  // The tone follows what was decided, not whether the write worked — those are two questions
  // and `recorded` answers the other one.
  assert.equal(d.tone, 'failed', 'a refusal was reported in the tone of a success')
})

test('a refusal that failed to write is not a refusal', () => {
  // The case that would be easiest to wave through: both readings end in "failed", so a fault
  // here is invisible in the tone and only visible in the log.
  const d = decided({ tool: 'Write', line: 'src/main/main.ts', allow: false, failure: 'ENOSPC' })

  assert.equal(d.note, null, 'a refusal that never reached disk was written into the log as refused')
  assert.equal(d.restore, true)
  assert.match(d.said, /was not refused/, `the sentence reads ${JSON.stringify(d.said)}`)
})

test('the empty string is a failure like any other', () => {
  // A rejection can carry no message at all. `failure: ''` is still a failure, and a truthiness
  // check on it would record the decision as having succeeded.
  const d = decided({ ...request, failure: '' })
  assert.equal(d.note, null, 'a failure with an empty message was treated as a success')
  assert.equal(d.recorded, false)
  assert.match(
    d.said,
    /the reason was not reported/,
    `the sentence reads ${JSON.stringify(d.said)} — "was not allowed — ." is a sentence with a ` +
      `hole where the reason goes, and a reader cannot tell it from a rendering fault`,
  )
})
