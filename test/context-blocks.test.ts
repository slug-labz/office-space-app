/**
 * What the office tells the manager.
 *
 * The rule these hold to is the one that makes the feature affordable: **a block appears only
 * when it would change what the manager should do.** This text rides on every message, so a
 * block that dutifully reports nothing is paid for on every turn, buries the sentence the person
 * typed, and trains the model to skim the preamble — after which the blocks that matter stop
 * being read either.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { officeBlocks, type OfficeState } from '../src/shared/context/blocks.js'

const base: OfficeState = {
  project: 'office-space',
  staff: [
    { id: 'manager', description: 'Runs the floor.', tools: ['Task'], isManager: true },
    { id: 'reviewer', description: 'Reads changes.', tools: ['Read', 'Grep'], isManager: false },
  ],
  skills: [{ id: 'meet', description: 'Call colleagues into the meeting room.' }],
}

const joined = (s: OfficeState) => officeBlocks(s).join('\n\n')

test('the two the manager cannot act without are always there, and come first', () => {
  const blocks = officeBlocks(base)
  assert.match(blocks[0] ?? '', /^## CURRENT PROJECT/)
  assert.match(blocks[1] ?? '', /^## CURRENT STAFF/)
})

test('the skill list is handed over — the gap this feature exists to close', () => {
  // `manager.md` instructs the manager to use the `meet` skill, and the office never handed over
  // the list. Add a fourth skill and the floor draws it on the shelf while the manager never
  // learns it exists: the customisability promise breaking in the quietest possible way.
  assert.match(joined(base), /## SKILLS ON THE SHELF/)
  assert.match(joined(base), /`meet`/)
})

test('a skill list that could not be read says so, rather than reading as none', () => {
  // Absent is not empty, in the block where it costs most: "there are no skills" and "we could
  // not read the skills" lead to different behaviour, and only one is a reason to carry on.
  const text = joined({ ...base, skills: null })
  assert.match(text, /could not be read/)
  assert.match(text, /Do not assume there are none/)
})

test('a workspace with no skills gets no skills block at all', () => {
  // Nothing to say, so nothing said. Not a heading over an empty list.
  assert.ok(!joined({ ...base, skills: [] }).includes('## SKILLS ON THE SHELF'))
})

test('THE RULE: blocks with nothing to report are absent, not present-and-empty', () => {
  const quiet = joined(base)
  for (const heading of ['## THE ROOM', '## OUTSTANDING', '## CONNECTORS', '## NOW PLAYING', '## THIS PLAN']) {
    assert.ok(!quiet.includes(heading), `${heading} appeared with nothing to report`)
  }
})

test('…and appear the moment they have something to say', () => {
  const busy = joined({
    ...base,
    room: [{ who: 'reviewer', where: 'in the meeting room' }],
    outstanding: [{ ref: '3', title: 'Cap the retry', owner: 'builder', outcome: 'failed' }],
    connectors: [{ name: 'graphiti', status: 'connected' }],
    nowPlaying: 'Miles Davis — So What',
    planWarning: '91% of this plan\'s allowance is used.',
  })
  assert.match(busy, /## THE ROOM[\s\S]*in the meeting room/)
  assert.match(busy, /## OUTSTANDING[\s\S]*#3 Cap the retry \(builder\) — failed/)
  assert.match(busy, /## CONNECTORS[\s\S]*graphiti — connected/)
  assert.match(busy, /## NOW PLAYING[\s\S]*Miles Davis/)
  assert.match(busy, /## THIS PLAN[\s\S]*91%/)
})

test('an empty task list is silence; an unreadable one is a sentence', () => {
  assert.ok(!joined({ ...base, outstanding: [] }).includes('## OUTSTANDING'))
  assert.match(joined({ ...base, outstanding: null }), /could not be read/)
})

test('inherited tools are described as inherited, never as none', () => {
  // The mistake that tells the manager an employee can do nothing, when it means the opposite.
  const text = joined({
    ...base,
    staff: [
      { id: 'manager', description: 'Runs it.', tools: ['Task'], isManager: true },
      { id: 'memory-keeper', description: 'Remembers.', tools: null, isManager: false },
    ],
  })
  assert.match(text, /memory-keeper .*\(tools: inherits all tools\)/)
  assert.ok(!/memory-keeper .*\(tools: none\)/.test(text))
})

test('an empty floor is stated outright, not sent as a bare heading', () => {
  const text = joined({ ...base, staff: [base.staff[0]!] })
  assert.match(text, /nobody to dispatch to/)
})

test('a description the agent file has reaches the manager, which is what it dispatches on', () => {
  /*
   * The assertion that went missing, and the reason it did.
   *
   * `staffBlock` was deleted in the same change that moved the blank-description case here. Its
   * first test carried **three** assertions — the heading, a present description reaching the
   * block, and the manager left off its own roster. Two had live equivalents. The middle one did
   * not, and I audited the deletion by asking which *tests* were duplicated rather than which
   * *assertions* were.
   *
   * Proven rather than assumed: mutating `staffBody` so a present description renders as `''`,
   * leaving the blank-description branch alone, passes the entire suite. Every employee's line
   * reads `- reviewer —  (tools: Read)` and the manager dispatches on nothing.
   *
   * The general form is worth more than this test: **a deletion audited at test granularity is
   * too coarse when a test carries several assertions.** What survived was "three of four tests
   * were duplicates"; what mattered was "one of six assertions was not".
   */
  assert.match(joined(base), /- reviewer — Reads changes\./)
})

test('a missing description is labelled, so the manager is not choosing from a blank', () => {
  // Moved here from `session.test.ts`, which had it against a second `staffBlock` that produced
  // byte-identical output and was called by nothing. Three of that function's four behaviours
  // were already covered on this, the live path; this was the fourth, and deleting the duplicate
  // without moving it would have taken the only assertion with it.
  const text = joined({
    ...base,
    staff: [base.staff[0]!, { id: 'nameless', description: '   ', tools: ['Read'], isManager: false }],
  })

  assert.match(text, /nameless — no description in the agent file/)
})

test('the manager is not on its own roster', () => {
  assert.ok(!/- manager —/.test(joined(base)))
})

test('the quiet case stays small enough to ride on every message', () => {
  // The cost check. This is prepended to every turn, so its floor is paid for constantly. If
  // this assertion starts failing, the answer is to cut a block rather than to raise the number.
  const chars = joined(base).length
  assert.ok(chars < 700, `the ordinary context is ${chars} characters, which is too much to send every turn`)
})

test('the difference between "no skills" and "we did not look" is not a detail', () => {
  // Caught while wiring this into the session: I defaulted the caller's `skills` to `null`,
  // which is the *scan failed* value. Every caller that supplied nothing — an aside, a test —
  // would have told the manager the shelf could not be read. A false statement, generated by a
  // default, on every message.
  //
  // `[]` produces no block: silence, which is honest about a question nobody asked.
  assert.ok(!officeBlocks({ ...base, skills: [] }).join('').includes('SKILLS'))
  assert.match(officeBlocks({ ...base, skills: null }).join(''), /could not be read/)
})

test('the mode block comes before the shelf, not after it', () => {
  // Order is the point. What the manager may do bounds everything it could plan to do with what
  // comes after — a skills list read by a manager that does not yet know it cannot dispatch is a
  // list of things it is about to try and fail at.
  const blocks = officeBlocks({
    project: 'p',
    staff: [],
    skills: [{ id: 'meet', description: 'call people in' }],
    mode: 'intake',
  })
  const mode = blocks.findIndex((b) => b.startsWith('## MODE'))
  const shelf = blocks.findIndex((b) => b.startsWith('## SKILLS ON THE SHELF'))
  assert.ok(mode >= 0, 'no mode block')
  assert.ok(shelf >= 0, 'no shelf block')
  assert.ok(mode < shelf, 'the manager reads the shelf before it learns what it may do')
})

test('the mode block is sent in every mode, including the permissive one', () => {
  // Deliberately breaks this file's own "silence is the default" rule. A manager told about its
  // mode only when something is withheld learns the block means bad news, and stops reading the
  // one that says "you may now build".
  for (const mode of ['intake', 'planning', 'building'] as const) {
    const blocks = officeBlocks({ project: 'p', staff: [], skills: [], mode })
    assert.ok(
      blocks.some((b) => b.startsWith('## MODE')),
      `${mode} sends no mode block`,
    )
  }
})

test('a caller with nothing to say about mode sends no mode block', () => {
  // The aside path and the tests. Omitted is not `building` — saying "nothing is withheld" to a
  // caller that never had a mode would be inventing a fact.
  const blocks = officeBlocks({ project: 'p', staff: [], skills: [] })
  assert.ok(!blocks.some((b) => b.startsWith('## MODE')))
})

test('intake tells the manager what is withheld, by name', () => {
  // An agent that discovers a missing tool by reaching for it spends the turn confused and often
  // apologises for a failure that is not one. Naming it up front turns a wall into a rule.
  const [block] = officeBlocks({ project: 'p', staff: [], skills: [], mode: 'intake' }).filter((b) =>
    b.startsWith('## MODE'),
  )
  for (const tool of ['Task', 'Write', 'Edit']) assert.ok(block?.includes(tool), `${tool} unnamed`)
})
