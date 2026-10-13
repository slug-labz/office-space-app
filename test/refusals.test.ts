/**
 * The wall of refusals, and the two ways of getting rid of it wrongly.
 *
 * U6 was nineteen red paragraphs in one turn, each repeating the same two sentences around a
 * different command string. Everything below is written against the two failures that shape it:
 *
 * 1. **The wall.** The shape of the problem stated nineteen times is the shape of the problem
 *    not stated at all.
 * 2. **The over-correction.** Collapsing to "19 commands were refused" removes the one fact a
 *    person can act on. The distinct commands have to survive, or the fix is worse than the bug.
 *
 * And the third thing, which is the reason the old copy was useless even when there was only
 * one refusal: it never said what to do. Denied and unlisted need opposite actions, and the
 * office can tell them apart for a `Bash` call because it can read the same rules the CLI read.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_COMMAND, summariseRefusals, type Refusal } from '../src/shared/refusals.js'
import { refusalCause } from '../src/main/session.js'

const refusal = (detail: string, cause: Refusal['cause'] = 'unlisted', tool = 'Bash'): Refusal => ({
  tool,
  detail,
  cause,
})

/** The shape of the run that started this: a batch of `Bash` calls, all refused, all different. */
function nineteen(): Refusal[] {
  return Array.from({ length: 19 }, (_, i) => refusal(`npm run build:package-${i}`))
}

// ───────────────────────────────────────────────── one block, and the commands survive it ──

test('nineteen refusals are one block that still names every distinct command', () => {
  const notice = summariseRefusals(nineteen())

  assert.ok(notice)
  // One headline, said once, carrying no command — that is what makes it a shape rather than a
  // nineteenth copy of the same sentence.
  assert.equal(notice.headline, '19 tool calls were refused, so none of them ran.')
  assert.match(notice.headline, /^[^\n]*$/, 'the headline is one line')

  // …and every command is still there. This is the assertion that fails if somebody "improves"
  // the block into a count.
  assert.equal(notice.calls.length, 19)
  for (let i = 0; i < 19; i++) {
    assert.ok(
      notice.calls.some((c) => c.detail === `npm run build:package-${i}`),
      `command ${i} was dropped by the summary`,
    )
  }
})

test('the same command refused eleven times is one line that says eleven', () => {
  // The distinction the wall could not draw: an agent looping on one command looked exactly
  // like an agent working through eleven different ones.
  const notice = summariseRefusals(Array.from({ length: 11 }, () => refusal('git push')))

  assert.ok(notice)
  assert.equal(notice.calls.length, 1)
  assert.equal(notice.calls[0]?.times, 11)
  assert.equal(
    notice.headline,
    '11 tool calls were refused, so none of them ran — 1 distinct command.',
  )
})

test('the order the turn tried things in is kept', () => {
  // Sorting would separate the three commands an agent tried in a row while retrying, which is
  // the sequence somebody reading this is trying to reconstruct.
  const notice = summariseRefusals([refusal('zzz'), refusal('aaa'), refusal('mmm')])
  assert.deepEqual(notice?.calls.map((c) => c.detail), ['zzz', 'aaa', 'mmm'])
})

// ─────────────────────────────────────────────────────────── the single refusal still reads ──

test('one refusal reads like a sentence, with no count in it', () => {
  const notice = summariseRefusals([refusal('rm -rf dist', 'denied')])

  assert.ok(notice)
  assert.equal(
    notice.headline,
    "Refused — this workspace's rules do not permit it, so it did not run.",
  )
  // The tell of a summary written for the many case and applied to the one.
  assert.doesNotMatch(notice.headline, /\b1\b|\bone\b/i, 'a single refusal is not counted at you')
  assert.doesNotMatch(notice.headline, /commands\b/, 'and it is not pluralised at you either')

  // The advice is singular too — "add them to permissions.allow" for one command is a sentence
  // about the wrong thing.
  assert.equal(notice.advice.length, 1)
  assert.match(notice.advice[0] ?? '', /\bit\b/)
  assert.doesNotMatch(notice.advice[0] ?? '', /\bthem\b/)

  // And the command is still shown, which is the whole point of the block.
  assert.equal(notice.calls[0]?.detail, 'rm -rf dist')
})

test('one command tried twice is still advised in the singular', () => {
  // Two refusals, one thing to fix. Advice counts calls to act on, not attempts.
  const notice = summariseRefusals([refusal('git push'), refusal('git push')])
  assert.equal(notice?.advice.length, 1)
  assert.doesNotMatch(notice?.advice[0] ?? '', /\bthem\b/)
})

test('nothing refused is no block at all', () => {
  assert.equal(summariseRefusals([]), null)
})

// ─────────────────────────────────────────────── denied and unlisted are different problems ──

test('denied and unlisted give different advice, and neither is the other', () => {
  const denied = summariseRefusals([refusal('rm -rf /', 'denied')])
  const unlisted = summariseRefusals([refusal('npm publish', 'unlisted')])

  assert.ok(denied)
  assert.ok(unlisted)
  assert.notEqual(denied.advice[0], unlisted.advice[0])

  // Denied: the rule has to change. Telling somebody to add an allow rule here sends them to
  // write a rule that will not work, because deny wins.
  assert.match(denied.advice[0] ?? '', /deny rule/)
  assert.match(denied.advice[0] ?? '', /Change or remove/)
  assert.doesNotMatch(denied.advice[0] ?? '', /permissions\.allow/)

  // Unlisted: nobody decided, so deciding is the action.
  assert.match(unlisted.advice[0] ?? '', /permissions\.allow/)
  assert.doesNotMatch(unlisted.advice[0] ?? '', /deny rule/)
})

test('a turn that hit both causes says both, and tags which line is which', () => {
  const notice = summariseRefusals([refusal('rm -rf /', 'denied'), refusal('npm publish', 'unlisted')])

  assert.ok(notice)
  assert.equal(notice.advice.length, 2, 'one line per cause, not one vague line for both')
  assert.equal(notice.mixed, true)

  // `mixed` is what tells the renderer to tag each line with its cause, so the two pieces of
  // advice can be matched to the commands they are about. Drawn in `transcript.dom.test.ts`.
})

test('one cause means nothing to disambiguate', () => {
  const notice = summariseRefusals([refusal('a'), refusal('b')])
  assert.equal(notice?.mixed, false, 'a column of identical tags is the noise this removes')
})

test('a cause the office cannot establish gets advice that is true either way', () => {
  // `Write` to a path: `ruleCovers` only understands `Bash(...)` rules, so the office does not
  // know which of the two this was — and says the thing that holds for both rather than
  // guessing at one.
  const notice = summariseRefusals([{ tool: 'Write', detail: '/etc/hosts', cause: 'unknown' }])
  assert.match(notice?.advice[0] ?? '', /\.claude\/settings\.json/)
  assert.doesNotMatch(notice?.advice[0] ?? '', /deny rule/)
})

test('a denial the CLI gave no argument for is still a line', () => {
  // Absent is not empty. The tool name on its own is the honest answer to "what was refused".
  const notice = summariseRefusals([{ tool: 'WebFetch', detail: null, cause: 'unknown' }])
  assert.equal(notice?.calls.length, 1)
  assert.equal(notice?.calls[0]?.detail, null)
  assert.equal(notice?.calls[0]?.tool, 'WebFetch')
})

// ─────────────────────────────────────────────────────────────────── a very long command ──

test('a command too long to show says it was cut', () => {
  // `approval-summary.ts` settled this rule for the approval cards: a value cut silently can
  // hide the dangerous half after an `&&`. Same rule here.
  const long = `echo ${'x'.repeat(400)}`
  const notice = summariseRefusals([refusal(long)])

  assert.equal(notice?.calls[0]?.truncated, true)
  assert.equal(notice?.calls[0]?.detail?.length, MAX_COMMAND)
})

// ─────────────────────────────────────────── the classification, against the real rules ──

test('the cause comes from judging the command against the workspace\'s own deny rules', () => {
  // The CLI's denial payload carries no reason — `tool_name`, `tool_use_id`, `tool_input` and
  // nothing else. So the office establishes the cause itself, with `judge`, against the same
  // `.claude/settings.json` the CLI just used. This is that step.
  const policy = { allow: ['Bash(npm test:*)'], deny: ['Bash(rm:*)'] }
  const denial = (detail: string | null, tool = 'Bash') => ({ tool, toolUseId: null, detail, cause: 'unknown' as const })

  assert.equal(refusalCause(denial('rm -rf dist'), policy), 'denied')
  assert.equal(refusalCause(denial('npm publish'), policy), 'unlisted')

  // Only `Bash`, and only with a command. `ruleCovers` understands `Bash(...)` rules and nothing
  // else, so answering for a `Write` would report "unlisted" for a path a deny rule names — the
  // shape of lie the third standing order is about.
  assert.equal(refusalCause(denial('/etc/hosts', 'Write'), policy), 'unknown')
  assert.equal(refusalCause(denial(null), policy), 'unknown')
})

test('an allow rule cannot turn a refusal into a permission', () => {
  // The call was refused; whether some allow rule looks like it covers it is a question whose
  // answer is evidently no. Reporting `allowed` here would have the transcript contradict the
  // thing that just happened.
  const policy = { allow: ['Bash(*)'], deny: [] }
  const cause = refusalCause({ tool: 'Bash', toolUseId: null, detail: 'anything', cause: 'unknown' }, policy)
  assert.equal(cause, 'unlisted')
})
