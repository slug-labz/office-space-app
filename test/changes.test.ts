/**
 * Attributing an edit to the dispatch that made it — and admitting the two cases where it cannot.
 *
 * The join itself is free: the CLI tags a subagent's events with the `tool_use` id of the `Task`
 * that started it, and that id is `Dispatch.id`. Captured from a real dispatch in a bare,
 * non-git directory. So none of the tests below are about whether the join works.
 *
 * They are about the two ways a file list can be short while looking complete, which is the only
 * way this feature can lie.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { changesFor, kindFromResult, whatIsNotShown, type ToolCall, ownWriteId } from '../src/shared/changes.js'

/** What the CLI actually says, both captured from a real run. */
const SAID_EDIT = 'The file /w/notes.txt has been updated successfully.'
const SAID_CREATE = 'File created successfully at: /w/made.txt'

const DISPATCH = 'toolu_dispatch_1'
const known = new Set([DISPATCH, 'toolu_dispatch_2'])

const edit = (path: string, parent: string | null, id = 'call_1'): ToolCall => ({
  name: 'Edit',
  input: { file_path: path, old_string: 'bravo', new_string: 'BRAVO' },
  parent,
  id,
})
const said = (id: string, what: string) => new Map([[id, what]])

test('an employee edit is attributed to the dispatch that sent them', () => {
  const out = changesFor([edit('/w/notes.txt', DISPATCH)], DISPATCH, known, said('call_1', SAID_EDIT))
  assert.equal(out.changes.length, 1)
  assert.deepEqual(out.changes[0], {
    path: '/w/notes.txt',
    kind: 'edit',
    before: 'bravo',
    after: 'BRAVO',
  })
  assert.equal(out.unattributed, 0)
})

test('another dispatch\'s edit is not counted here, and is not an orphan either', () => {
  // Two employees run at once — the ledger documents twenty simultaneous dispatches as ordinary.
  // Somebody else's work is not missing; it belongs on their row.
  const out = changesFor([edit('/w/theirs.txt', 'toolu_dispatch_2')], DISPATCH, known)
  assert.deepEqual(out.changes, [])
  assert.equal(out.unattributed, 0, "another dispatch's edit was reported as unattributable")
})

test('a grandchild edit is counted as unattributed, never dropped', () => {
  /*
   * The dangerous case, and the reason this module counts rather than filters.
   *
   * Nothing in this repo prevents depth two: the rule lives in `manager.md` as prompt text, and
   * the tool withholding that enforces it applies to intake, where dispatch is impossible anyway.
   * Whether a subagent receives `Task` is the CLI's decision, inherited and not held here.
   *
   * At depth two the edit carries the *child's* Task id, which resolves to no dispatch. Dropped,
   * it makes a dispatch that touched seven files show three — and look exactly as complete as one
   * that touched three.
   */
  const out = changesFor([edit('/w/deep.txt', 'toolu_grandchild')], DISPATCH, known)
  assert.deepEqual(out.changes, [])
  assert.equal(out.unattributed, 1, 'an edit belonging to no known dispatch vanished')
})

test('a write with no path is counted rather than invented', () => {
  const out = changesFor([{ name: 'Write', input: { content: 'x' }, parent: DISPATCH }], DISPATCH, known)
  assert.deepEqual(out.changes, [])
  assert.equal(out.unattributed, 1)
})

test('what happened is read from the tool, not predicted from its name', () => {
  /*
   * This test used to assert `Write` means created. That was the bug.
   *
   * `Write` overwrites a file that already exists just as happily as it makes one, so an
   * overwrite of somebody's file was labelled `create` and filed under the heading a person is
   * *not* scanning for damage. Worse, an undo of a "create" is a deletion — so the mislabel
   * would have deleted a file whose prior bytes the office never recorded, in exactly the case
   * somebody reached for undo.
   *
   * The CLI says which it was, and both wordings are in a real capture.
   */
  const write = (id: string): ToolCall => ({
    name: 'Write',
    input: { file_path: '/w/f.txt', content: 'hello' },
    parent: DISPATCH,
    id,
  })

  const made = changesFor([write('c1')], DISPATCH, known, said('c1', SAID_CREATE))
  assert.equal(made.changes[0]?.kind, 'create')
  assert.equal(made.changes[0]?.before, null, 'a created file was given something it replaced')
  assert.equal(made.changes[0]?.after, 'hello')

  const over = changesFor([write('c2')], DISPATCH, known, said('c2', SAID_EDIT))
  assert.equal(over.changes[0]?.kind, 'edit', 'a Write over an existing file was called a creation')
})

test('a write whose result never arrived is unknown, and is not guessed either way', () => {
  // Not a shrug. It is what stops an undo deleting a file it believes was created.
  const out = changesFor(
    [{ name: 'Write', input: { file_path: '/w/f.txt', content: 'x' }, parent: DISPATCH, id: 'c3' }],
    DISPATCH,
    known,
  )
  assert.equal(out.changes[0]?.kind, 'unknown')
})

test('an unrecognised result is unknown rather than the nearest guess', () => {
  // The exact sentence is somebody else's payload, which is why this file exists at all.
  assert.equal(kindFromResult('Something new the CLI says now'), 'unknown')
  assert.equal(kindFromResult(undefined), 'unknown')
  assert.equal(kindFromResult(SAID_CREATE), 'create')
  assert.equal(kindFromResult(SAID_EDIT), 'edit')
})

test('shell commands are counted, because their effects are invisible here', () => {
  // Bash carries the command and its output, never a file list. Across 167 real captured tool
  // calls Bash was 63.5% of them — and none of those 106 wrote to disk. A sample, not a
  // guarantee, which is exactly why it is counted rather than assumed away.
  const out = changesFor(
    [{ name: 'Bash', input: { command: 'npm test' }, parent: DISPATCH }, edit('/w/a.txt', DISPATCH)],
    DISPATCH,
    known,
  )
  assert.equal(out.shell, 1)
  assert.equal(out.changes.length, 1)
})

test('a tool that neither writes nor shells is ignored', () => {
  const out = changesFor([{ name: 'Read', input: { file_path: '/w/a.txt' }, parent: DISPATCH }], DISPATCH, known)
  assert.deepEqual(out, { changes: [], shell: 0, unattributed: 0 })
})

// ── what the reader is told is missing ──────────────────────────────────────────────────────

test('a clean dispatch declares nothing, because there is nothing to declare', () => {
  assert.equal(whatIsNotShown({ changes: [], shell: 0, unattributed: 0 }), null)
})

test('both gaps are declared in one sentence, under the list they qualify', () => {
  // Two notices in two places is how one of them stops being read. A person looking at a file
  // list needs to know in the same breath what is not in it.
  const said = whatIsNotShown({ changes: [], shell: 12, unattributed: 4 })
  assert.match(said ?? '', /12 shell commands/)
  assert.match(said ?? '', /4 edits that could not be attributed/)
  assert.equal((said ?? '').split('.').filter(Boolean).length, 1, 'the gaps were split across sentences')
})

test('one of each reads as one of each, not as a plural', () => {
  const said = whatIsNotShown({ changes: [], shell: 1, unattributed: 1 })
  assert.match(said ?? '', /1 shell command,/)
  assert.match(said ?? '', /1 edit that could not be attributed/)
})

// ── the manager's own turn ──────────────────────────────────────────────────────────────────

test('the manager’s own edits are attributed to it, not dropped', () => {
  /*
   * They used to fall through `if (!mine) continue` and vanish — not even counted as
   * unattributed. The manager keeps `Write` and `Edit` (only employees have them withheld), so a
   * panel titled "What the office changed" was omitting the one writer always present.
   *
   * `null` is a positive answer rather than a gap: the CLI tags every subagent call with its
   * dispatch and tags none of the manager's, so `call.parent === dispatch` says it with no
   * special case.
   */
  const calls = [
    { name: 'Edit', input: { file_path: '/w/mine.js', old_string: 'a', new_string: 'A' }, parent: null, id: 't1' },
    { name: 'Edit', input: { file_path: '/w/theirs.js', old_string: 'b', new_string: 'B' }, parent: 'toolu_d', id: 't2' },
    { name: 'Bash', input: { command: 'ls' }, parent: null, id: 't3' },
  ]
  const said = new Map([['t1', 'The file has been updated.'], ['t2', 'The file has been updated.']])

  const mine = changesFor(calls, null, new Set(['toolu_d']), said)
  assert.deepEqual(mine.changes.map((c) => c.path), ['/w/mine.js'])
  assert.equal(mine.shell, 1, 'the manager’s own shell commands are not declared')

  // And the employee's view is unchanged by any of this.
  const theirs = changesFor(calls, 'toolu_d', new Set(['toolu_d']), said)
  assert.deepEqual(theirs.changes.map((c) => c.path), ['/w/theirs.js'])
  assert.equal(theirs.shell, 0)
})

test('a manager turn is keyed by the first thing it wrote', () => {
  /*
   * A dispatch has an id; a turn does not. A `tool_use` id is unique across the CLI and derived
   * from the data, so the key is the same on a re-read — where a timestamp would key one turn
   * differently depending on when the record happened to be written.
   */
  assert.equal(
    ownWriteId([
      { name: 'Read', input: {}, parent: null, id: 'read-first' },
      { name: 'Edit', input: {}, parent: null, id: 'the-key' },
      { name: 'Write', input: {}, parent: null, id: 'later' },
    ]),
    'the-key',
  )
})

test('a turn where the manager wrote nothing has no key, and so no record', () => {
  // Most turns. An empty record for every one of them would be a panel full of rows saying
  // nothing happened, which is noise standing exactly where a real change would go.
  assert.equal(ownWriteId([{ name: 'Read', input: {}, parent: null, id: 'r' }]), null)
  assert.equal(ownWriteId([]), null)
})

test('an employee’s write is never mistaken for the manager’s own', () => {
  // The one that would put somebody else's work on the manager's row.
  assert.equal(ownWriteId([{ name: 'Edit', input: {}, parent: 'toolu_d', id: 'theirs' }]), null)
})
