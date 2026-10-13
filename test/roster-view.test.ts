/**
 * What the roster panel says — the four decisions it makes, and the four ways each goes wrong.
 *
 * The panel itself is DOM and is not tested here; every judgement it makes lives in
 * `shared/roster-view.ts` precisely so that it can be. What is asserted below is not "the
 * function returns a string" but the four properties the panel exists to keep:
 *
 * 1. a benched employee is still visible somewhere,
 * 2. `tools:` absent reads as *more* access rather than less,
 * 3. an unreadable shelf does not read as an empty one,
 * 4. the manager cannot be fired from the UI.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  commonTools,
  commonToolsLine,
  shelfSummary,
  staffCountLine,
  staffRows,
  toolsSentence,
  usesLine,
  skillRows,
} from '../src/shared/roster-view.js'
import type { RosterModel } from '../src/shared/roster-view.js'
import type { ShelfRow, StaffMember } from '../src/shared/ipc.js'

const person = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: 'reviewer',
  name: 'reviewer',
  description: 'Reviews code',
  tools: ['Read', 'Grep'],
  model: 'sonnet',
  isManager: false,
  ...over,
})

/** A roster model with nothing wrong in it. Overridden field by field per test. */
const model = (over: Partial<RosterModel> = {}): RosterModel => ({
  staff: [],
  staffUnreadable: false,
  benched: [],
  shelf: [],
  skills: [],
  dangling: new Map(),
  unreachable: new Map(),
  ...over,
})

const skill = (over: Partial<ShelfRow> = {}): ShelfRow => ({
  id: 'record-progress',
  count: 4,
  lastUsed: '2026-08-20',
  onShelf: true,
  ...over,
})

test('the manager is not offered a fire button, or a bench one', () => {
  // Firing the manager leaves a floor, a transcript and nobody to answer, and the app has no
  // path back from that state. Offering the button and refusing the click teaches nothing.
  const rows = staffRows(model({ staff: [person({ id: 'manager', name: 'manager', isManager: true }), person()], benched: [], shelf: [] }))

  assert.deepEqual(rows[0]?.actions, [])
  assert.deepEqual(rows[1]?.actions, ['bench', 'fire'])
})

test('...including a manager on the bench, whose row is built by different code', () => {
  // The test above passes `benched: []`, so it only ever asked the staff branch — and the staff
  // branch is the one with the check. A benched row is built from an id with no `isManager` to
  // consult, because a `.off` file's frontmatter is not in the snapshot, and it offered *Fire*
  // to everybody on the bench without looking.
  //
  // The id is enough on its own here: `findManager` falls back to "whoever declares the
  // delegation tool" by reading `tools:`, which is exactly what cannot be read through a `.off`,
  // so a benched agent can only be the manager by being called one.
  const rows = staffRows(model({ staff: [], benched: ['manager', 'reviewer'] }))

  assert.deepEqual(rows[0]?.actions, ['unbench'], 'the bench offered to delete the manager')
  assert.deepEqual(rows[1]?.actions, ['unbench', 'fire'], 'and everybody else lost the button with them')
})

test('a benched employee still has a row — the only place they can be found', () => {
  // `disable` renames reviewer.md to reviewer.md.off, which removes them from every reader of
  // `*.md` including discovery. If this row were dropped, "send home" and "fire" would be
  // indistinguishable on screen, and only one of them is reversible.
  const rows = staffRows(model({ staff: [person({ id: 'builder', name: 'builder' })], benched: ['reviewer'] }))

  assert.equal(rows.length, 2)
  const off = rows.find((r) => r.id === 'reviewer')
  assert.ok(off, 'the benched employee vanished from the roster')
  assert.equal(off.atDesk, false)
  assert.deepEqual(off.actions, ['unbench', 'fire'])
  assert.match(off.description, /reviewer\.md\.off/)
})

test('a benched employee is not claimed to have no tools — their file is not read', () => {
  // Discovery cannot see a `.off` file, so the snapshot carries no frontmatter for them. Saying
  // "no tools" would be an answer we do not have.
  const [row] = staffRows(model({ benched: ['reviewer'] }))
  assert.equal(row?.tools.warn, false)
  assert.match(row?.tools.text ?? '', /not read/)
})

test('both numbers are printed once anybody is benched', () => {
  assert.equal(staffCountLine(model({ staff: [person(), person()] })), '2 at a desk')
  assert.equal(
    staffCountLine(model({ staff: [person(), person()], benched: ['a', 'b'] })),
    '2 at a desk · 2 benched',
  )
})

test('tools absent is larger than tools empty, and only absent is worth a colour', () => {
  // The case that matters: an agent with no `tools:` inherits everything the parent has,
  // including the dispatch tool. That is "only the manager delegates" broken by omission, and
  // a blank cell would read as the opposite of what it means.
  const inherited = toolsSentence(null)
  assert.equal(inherited.warn, true)
  assert.match(inherited.text, /dispatches other agents/)

  const none = toolsSentence([])
  assert.equal(none.warn, false)
  assert.match(none.text, /no tools/)

  const named = toolsSentence(['Read', 'Grep'])
  assert.equal(named.warn, false)
  assert.equal(named.text, 'Read · Grep')
})

test('a shelf that could not be read does not read as an empty shelf', () => {
  const unreadable = shelfSummary(null)
  const empty = shelfSummary([])

  assert.equal(unreadable.problem, true)
  assert.equal(empty.problem, false)
  assert.notEqual(unreadable.empty, empty.empty)
  // No count at all when we do not know — "0 on the shelf" would be the invented number.
  assert.equal(unreadable.count, null)
  assert.equal(empty.count, '0 on the shelf')
})

test('a removed skill is counted out of the shelf total but keeps its row', () => {
  // The evidence that the office once relied on it. Editing the row out would edit out the
  // reason somebody removed it.
  const summary = shelfSummary([skill(), skill({ id: 'old-helper', onShelf: false })])
  assert.equal(summary.count, '1 on the shelf')
  assert.equal(summary.empty, null)
})

test('one use is "once", not "1×"', () => {
  assert.equal(usesLine(skill({ count: 1 })), 'used once')
  assert.equal(usesLine(skill({ count: 0 })), 'used 0×')
  assert.equal(usesLine(skill({ count: 4 })), 'used 4×')
})

test('a tool no server can answer is shown on that employee’s row', () => {
  // The capability survey knows this and had nowhere to say it. An agent declaring
  // `mcp__notion__search` in a workspace with no notion server does not fail loudly — it
  // reaches, gets nothing, and reports that it could not do the thing, which from the outside
  // looks exactly like the agent being bad at its job.
  const rows = staffRows(
    model({
      staff: [person({ id: 'memory-keeper', name: 'memory-keeper' })],
      dangling: new Map([['memory-keeper', ['mcp__notion__search']]]),
    }),
  )
  assert.deepEqual(rows[0]?.dangling, ['mcp__notion__search'])
})

test('an employee with nothing dangling says nothing', () => {
  // Which is almost everybody. A row that printed "0 problems" would be noise on every line to
  // carry information on one of them.
  const rows = staffRows(model({ staff: [person()] }))
  assert.deepEqual(rows[0]?.dangling, [])
})

test('a benched employee is not reported as clean, because nobody looked', () => {
  // The survey reads `*.md` and cannot see a `.off` file either. An empty list here means "we
  // did not look", and drawing it as "nothing wrong" would be the same invention as claiming
  // they have no tools.
  const rows = staffRows(model({ benched: ['reviewer'], dangling: new Map([['reviewer', ['mcp__x__y']]]) }))
  assert.deepEqual(rows[0]?.dangling, [])
})


/**
 * The fifth decision, added when the roster was compacted — and a correction to the claim that
 * produced it.
 *
 * The plan said the tool list was *"printed verbatim under every employee"*. Measured against
 * the shipped `.claude/`, it is not: three of seven share `Read · Write · Edit · Glob · Grep ·
 * Bash · WebFetch` — the implementers — and the other four each have their own. The first
 * version of `commonTools` asked for a strict majority, did nothing on the real workspace, and
 * that is how the overstatement was caught: the function was written from the claim and
 * disagreed with the office.
 *
 * So the threshold is three, and the tests below are mostly about the two ways a lower one goes
 * wrong: collapsing on a coincidence, and folding a warning into "the usual".
 */

const withTools = (id: string, tools: readonly string[] | null): StaffMember =>
  person({ id, name: id, tools })

const USUAL = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch']

test('three agents sharing a list is a house style, and is said once', () => {
  const m = model({
    staff: [
      withTools('backend', USUAL),
      withTools('builder', USUAL),
      withTools('frontend', USUAL),
      withTools('tester', ['Read', 'Bash']),
    ],
  })
  assert.deepEqual(commonTools(m), USUAL)
  assert.match(commonToolsLine(m) ?? '', /Read · Write · Edit · Glob · Grep · Bash · WebFetch/)

  const rows = staffRows(m)
  for (const id of ['backend', 'builder', 'frontend']) {
    assert.equal(rows.find((r) => r.id === id)?.toolsAreCommon, true, `${id} should be common`)
  }
  // The one that differs still prints its own, because that is where the line means something.
  assert.equal(rows.find((r) => r.id === 'tester')?.toolsAreCommon, false)
})

test('two agents sharing a list is a coincidence, and is left on both rows', () => {
  // Collapsing here would move a line off the only two rows it distinguishes.
  const m = model({ staff: [withTools('a', USUAL), withTools('b', USUAL), withTools('c', ['Read'])] })
  assert.equal(commonTools(m), null)
  assert.equal(commonToolsLine(m), null)
  assert.equal(staffRows(m).every((r) => !r.toolsAreCommon), true)
})

test('an agent that inherits every tool is never folded into "the usual"', () => {
  // `tools: null` is the case the roster exists to make loud — it inherits the dispatch tool, so
  // an employee can summon a colleague. A surprise that became the majority and got quietly
  // absorbed would be a bigger finding than this is allowed to hide.
  const m = model({
    staff: [withTools('a', null), withTools('b', null), withTools('c', null), withTools('d', USUAL)],
  })
  assert.equal(commonTools(m), null, 'null tools must never form the common list')
  assert.equal(staffRows(m).every((r) => !r.toolsAreCommon), true)
})

test('the manager is never counted, because one of anything is not a house style', () => {
  const m = model({
    staff: [
      person({ id: 'manager', name: 'manager', isManager: true, tools: USUAL }),
      withTools('a', USUAL),
      withTools('b', USUAL),
    ],
  })
  // Two employees plus the manager is still two employees.
  assert.equal(commonTools(m), null)
})

test('a benched employee is never marked common, because their file was not read', () => {
  const m = model({
    staff: [withTools('a', USUAL), withTools('b', USUAL), withTools('c', USUAL)],
    benched: ['gone'],
  })
  assert.deepEqual(commonTools(m), USUAL)
  const off = staffRows(m).find((r) => r.id === 'gone')
  assert.equal(off?.atDesk, false)
  assert.equal(
    off?.toolsAreCommon,
    false,
    'saying a benched employee has the usual tools invents an answer about a file discovery ' +
      'cannot read — the fourth standing order, on the row where it is easiest to miss',
  )
})

// ──────────────────────────────────────── what a skill does, not only how often ──

/*
 * The shelf offered `graphify · used 3×` and no way to find out what that is.
 *
 * The office reads a name and a description out of every skill's frontmatter and ships both on
 * the snapshot; the app used the array's `length` twice and dropped the rest. Meanwhile the
 * staff half of the very same panel has shown a description all along — including a written
 * sentence for a benched employee whose file cannot be read. One panel, two standards.
 */

const described = (id: string, description: string) => ({ id, name: id, description })

test('a skill on the shelf says what it does', () => {
  const rows = skillRows(
    model({
      shelf: [skill({ id: 'write-a-task' })],
      skills: [described('write-a-task', 'Add a task with a VERIFY the office can check.')],
    }),
  )

  assert.equal(rows[0]?.description, 'Add a task with a VERIFY the office can check.')
  assert.equal(rows[0]?.uses, 'used 4×')
})

test('the name comes from the frontmatter, and falls back to what you invoke it by', () => {
  const withName = skillRows(
    model({ shelf: [skill({ id: 'write-a-task' })], skills: [{ id: 'write-a-task', name: 'Write a task', description: 'x' }] }),
  )
  const without = skillRows(model({ shelf: [skill({ id: 'write-a-task' })], skills: [] }))

  assert.equal(withName[0]?.name, 'Write a task')
  assert.equal(without[0]?.name, 'write-a-task', 'the id is what a person types, so it is never nothing')
})

test('on the shelf with nothing written in the file reads exactly like a person with none', () => {
  // Same words as `staffRows` uses, because it is the same situation: the file was read and it
  // says nothing. Matching the sentence is the point — two phrasings for one fact make a reader
  // wonder which of the two states they are looking at.
  const rows = skillRows(model({ shelf: [skill({ id: 'quiet' })], skills: [described('quiet', '')] }))

  assert.equal(rows[0]?.description, 'No description in its file.')
})

test('a removed skill is NOT described as having no description — its file is gone', () => {
  // The distinction this whole repository is built on. "No description in its file" reports an
  // absent file as an empty one. The row exists because deleting it would delete the evidence
  // that the office once relied on this skill, so it has to say which of the two it is.
  const rows = skillRows(model({ shelf: [skill({ id: 'retired', onShelf: false })], skills: [] }))

  assert.equal(
    rows[0]?.description,
    'Its file is gone. What it did is no longer on disk; this row is the record that it was used.',
  )
  assert.equal(rows[0]?.onShelf, false)
})

test('a removed skill offers no "never invoked" line — it was invoked, that is why it is here', () => {
  const removed = skillRows(model({ shelf: [skill({ onShelf: false, lastUsed: null })], skills: [] }))
  const fresh = skillRows(model({ shelf: [skill({ lastUsed: null })], skills: [] }))

  assert.equal(removed[0]?.when, null)
  assert.equal(fresh[0]?.when, 'never invoked in this project')
})

test('a last-used date is carried through as written', () => {
  const rows = skillRows(model({ shelf: [skill({ lastUsed: '2026-08-20' })], skills: [] }))

  assert.equal(rows[0]?.when, 'last used 2026-08-20')
})

test('a shelf that could not be read yields no rows rather than throwing', () => {
  // `null` is "we could not look", and `shelfSummary` already says so in words. This function
  // must not turn it into an exception that takes the staff list down with it.
  assert.deepEqual(skillRows(model({ shelf: null, skills: [] })), [])
})

test('a skill on disk that has never been used does not invent a shelf row', () => {
  // The shelf is the record of use, not the directory listing. A description with no row to
  // attach to is not a row.
  assert.deepEqual(skillRows(model({ shelf: [], skills: [described('unused', 'Never reached for.')] })), [])
})

/*
 * A name the write path will not take.
 *
 * `roster.ts` in main refuses `bench` and `fire` for an id that could not be a filename —
 * correctly, since the id becomes a path. Discovery still admits such an agent: `name: ../escape`
 * in a file's frontmatter puts them on the floor and in this list. So the row offered `Send home`
 * and `Fire`, and both ended in *"A name cannot contain a slash."* — two presses, one of them a
 * confirmed destructive verb, to be told no.
 *
 * The rule was already written one line above the fix, for the manager: **not offered rather than
 * offered and refused.** This is the same case with one difference — the manager needs no
 * explanation and this does, because nobody can infer "you cannot fire this one" from a name they
 * did not choose.
 *
 * Found by putting six kinds of malformed agent file in a workspace and reading the roster.
 */
test('somebody whose name cannot be a filename is not offered controls that would refuse', () => {
  const rows = staffRows(
    model({
      staff: [person({ id: '../escape', name: '../escape' }), person({ id: 'reviewer', name: 'reviewer' })],
      benched: [],
      shelf: [],
    }),
  )

  assert.deepEqual(rows[0]?.actions, [], 'the buttons would both be refused, so they are not drawn')
  assert.match(rows[0]?.unmanageable ?? '', /cannot be a filename/)
  assert.match(rows[0]?.unmanageable ?? '', /remove the file by hand/, 'and what to do instead')

  assert.deepEqual(rows[1]?.actions, ['bench', 'fire'], 'everybody else is unaffected')
  assert.equal(rows[1]?.unmanageable, null)
})

test('...and the same on the bench, which is built by different code', () => {
  // The staff branch and the benched branch each decide their own actions. The manager check had
  // to be added to both; so does this one, and a test that only asked the staff branch would not
  // have noticed.
  const rows = staffRows(model({ staff: [], benched: ['../escape', 'reviewer'] }))

  assert.deepEqual(rows[0]?.actions, ['unbench'], 'no fire, because firing would be refused')
  assert.match(rows[0]?.unmanageable ?? '', /cannot be a filename/)
  assert.deepEqual(rows[1]?.actions, ['unbench', 'fire'])
})

