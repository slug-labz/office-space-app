/**
 * Arranging what a dispatch changed for somebody to read.
 *
 * Three states look alike on a screen and mean completely different things: a record that could
 * not be read, no record at all, and a record saying nothing was changed. Only the last one means
 * "this dispatch changed nothing", and rendering the other two as it would be a false sentence
 * about somebody's files.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { rowsFor, summarise, hasRecord, type FoundChanges, type SentDispatch } from '../src/shared/changes-view.js'
import { whatIsNotShown } from '../src/shared/changes.js'

const sent: SentDispatch[] = [
  { id: 'toolu_1', employee: 'builder', brief: 'Write greet.js', sentAt: '2026-09-01T01:00:00Z' },
]
const found = (c: FoundChanges) => () => c
// Defaults here rather than in every fixture: a test that has to restate `undone: null` to say
// nothing about undo is a test that will be wrong the next time a field is added.
const rows = (c: Partial<FoundChanges>) =>
  rowsFor(sent, found({ changes: null, problem: null, undone: null, stillOut: false, ...c }), whatIsNotShown)

test('created and changed are kept apart, because they ask different questions', () => {
  /*
   * "Made this" and "changed something you had" are not the same event to a reader, and the
   * second is the one somebody scanning for damage is looking for. The distinction arrives free
   * in the tool's own input keys; collapsing them into "3 files" throws away the most valuable
   * bit on the surface to save a line.
   */
  const [row] = rows({
    changes: {
      changes: [
        { path: '/w/new.js', kind: 'create' as const, before: null, after: 'x' },
        { path: '/w/existing.js', kind: 'edit' as const, before: 'a', after: 'b' },
      ],
      shell: 0,
      unattributed: 0,
    },
    problem: null,
  })
  assert.deepEqual(row?.created.map((c) => c.path), ['/w/new.js'])
  assert.deepEqual(row?.edited.map((c) => c.path), ['/w/existing.js'])
  assert.match(summarise(row!, true), /1 changed, 1 created/)
})

test('a dispatch that has not finished is not a dispatch that changed nothing', () => {
  const [row] = rows({ changes: null, problem: null, undone: null, stillOut: false })
  assert.match(summarise(row!, false), /Still working, or stopped before it reported/)
  assert.doesNotMatch(summarise(row!, false), /No files changed/)
})

test('a record that could not be read says so, and never reads as empty', () => {
  // The failure this whole feature exists to prevent, arriving through its own surface.
  const [row] = rows({ changes: null, problem: 'the record will not parse — Unexpected end of JSON input' })
  assert.match(summarise(row!, true), /will not parse/)
  assert.doesNotMatch(summarise(row!, true), /No files changed/)
})

test('a dispatch that genuinely changed nothing says so, and still declares what it ran', () => {
  // "No files changed" is only true when a record exists and is empty. Even then the shell
  // commands it ran are unaccounted for, and that belongs in the same breath.
  const [row] = rows({ changes: { changes: [], shell: 4, unattributed: 0 }, problem: null })
  const said = summarise(row!, true)
  assert.match(said, /4 shell commands/)
})

test('unattributed edits ride with the file count, not in a separate notice', () => {
  // Two notices in two places is how one of them stops being read.
  const [row] = rows({
    changes: { changes: [{ path: '/w/a.js', kind: 'edit' as const, before: 'a', after: 'b' }], shell: 0, unattributed: 2 },
    problem: null,
  })
  const said = summarise(row!, true)
  assert.match(said, /1 changed/)
  assert.match(said, /2 edits that could not be attributed/)
})

test('the brief and who did it survive to the row, because a file list alone answers nothing', () => {
  const [row] = rows({ changes: { changes: [], shell: 0, unattributed: 0 }, problem: null })
  assert.equal(row?.employee, 'builder')
  assert.equal(row?.brief, 'Write greet.js')
})

test('a dispatch whose only writes were unclassified has finished, and does not read as still working', () => {
  /*
   * Found on screen: the row said "Still working, or stopped before it reported" with its files
   * listed underneath. `hasRecord` in app.ts counted `edited` and `created` and not `unclear`, so
   * a finished run was described as an unfinished one — by the one line on the card whose whole
   * job is telling those two apart.
   */
  const [r] = rows({
    changes: {
      changes: [{ path: '/w/notes.md', kind: 'unknown' as const, before: null, after: '# Notes' }],
      shell: 0,
      unattributed: 0,
    },
  })
  assert.equal(r?.unclear.length, 1)
  assert.equal(hasRecord(r!), true, 'a finished dispatch reads as one that has not finished')
  const said = summarise(r!, hasRecord(r!))
  assert.match(said, /1 written, unclear which/)
  assert.doesNotMatch(said, /Still working/)
})

test('a dispatch with no record at all still reads as unfinished', () => {
  // The other side of the same line, and the one that must not move: no files, no problem, no
  // declaration means the run has not ended, and saying "No files changed" there would be a
  // claim about somebody's files that nothing supports.
  const [r] = rows({ changes: null })
  assert.equal(hasRecord(r!), false)
  assert.match(summarise(r!, hasRecord(r!)), /Still working/)
})
