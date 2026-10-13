/**
 * The undo, doing it — the one place the office writes over a file it did not just create.
 *
 * `shared/undo.ts` holds every rule and is tested against strings. This is the half that touches
 * the disk, and the three things worth proving here cannot be proved in memory: that a refusal
 * leaves **every** file untouched, that a creation is really removed, and that the record of the
 * undo is written so a second one is refused.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'

import { undoDispatch } from '../src/main/undo.js'
import { recordChanges, readChanges } from '../src/main/changes.js'
import { serializeDispatch, serializeOutcome, ledgerPath } from '../src/main/ledger.js'
import type { Changes } from '../src/shared/changes.js'

import { tempDir } from './temp-dir.js'

/**
 * A workspace with dispatches in the ledger, back or still out as asked.
 *
 * `also` adds a second dispatch sent *after* the first, which is what makes the hybrid-state
 * sentence testable: a file put back that somebody else's dispatch has changed since.
 */
async function office(t: TestContext, opts: { readonly back?: boolean; readonly also?: boolean } = {}): Promise<string> {
  const root = await tempDir(t, 'office-undo-')
  await mkdir(join(root, '.office-space'), { recursive: true })
  const one = (id: string, sentAt: string) =>
    serializeDispatch({ id, sessionId: 's', project: '', employee: 'builder', brief: 'do a thing', verify: null, sentAt })
  const done = (id: string, at: string) => serializeOutcome({ id, kind: 'reported', output: 'done', at })

  let text = one('toolu_a', '2026-09-01T01:00:00.000Z')
  if (opts.back !== false) text += done('toolu_a', '2026-09-01T01:10:00.000Z')
  if (opts.also === true) {
    text += one('toolu_b', '2026-09-01T02:00:00.000Z') + done('toolu_b', '2026-09-01T02:10:00.000Z')
  }
  await writeFile(ledgerPath(root), text, 'utf8')
  return root
}

const exists = async (path: string): Promise<boolean> =>
  access(path).then(() => true).catch(() => false)

test('an edit is put back, and the undo is recorded so a second one is refused', async (t) => {
  const root = await office(t)
  const file = join(root, 'a.js')
  await writeFile(file, 'alpha BRAVO charlie', 'utf8')
  await recordChanges(root, 'toolu_a', {
    changes: [{ path: file, kind: 'edit', before: 'bravo', after: 'BRAVO' }],
    shell: 0,
    unattributed: 0,
  } satisfies Changes)

  const got = await undoDispatch(root, 'toolu_a')
  assert.equal(got.ok, true, got.ok ? '' : got.why.join(' '))
  assert.equal(await readFile(file, 'utf8'), 'alpha bravo charlie')

  // Recorded, or the panel goes on claiming the tree holds a change the office removed.
  const record = await readChanges(root, 'toolu_a')
  assert.equal(record.ok ? record.undone?.restored : null, 1)

  const again = await undoDispatch(root, 'toolu_a')
  assert.equal(again.ok, false)
  assert.match(again.ok ? '' : again.why.join(' '), /already put back/)
  assert.equal(await readFile(file, 'utf8'), 'alpha bravo charlie', 'the second undo wrote something')
})

test('one refusal leaves every other file untouched', async (t) => {
  /*
   * The one that would ship broken. Two edits where the second cannot resolve: undoing the first
   * anyway leaves a tree in a state nobody ever authored, produced by the office while trying to
   * put things back.
   */
  const root = await office(t)
  const ok = join(root, 'ok.js')
  const moved = join(root, 'moved.js')
  await writeFile(ok, 'ONE', 'utf8')
  await writeFile(moved, 'somebody rewrote this', 'utf8')
  await recordChanges(root, 'toolu_a', {
    changes: [
      { path: ok, kind: 'edit', before: 'one', after: 'ONE' },
      { path: moved, kind: 'edit', before: 'two', after: 'TWO' },
    ],
    shell: 0,
    unattributed: 0,
  } satisfies Changes)

  const got = await undoDispatch(root, 'toolu_a')
  assert.equal(got.ok, false)
  assert.equal(await readFile(ok, 'utf8'), 'ONE', 'a file was put back despite the undo refusing')
  assert.equal(await readFile(moved, 'utf8'), 'somebody rewrote this')
  // Nothing happened, so nothing is recorded as having happened.
  const record = await readChanges(root, 'toolu_a')
  assert.equal(record.ok ? record.undone : 'unreadable', null)
})

test('undoing a creation removes the file, and only while it is still what was written', async (t) => {
  const root = await office(t)
  const made1 = join(root, 'new.js')
  await writeFile(made1, 'hello\n', 'utf8')
  await recordChanges(root, 'toolu_a', {
    changes: [{ path: made1, kind: 'create', before: null, after: 'hello\n' }],
    shell: 0,
    unattributed: 0,
  } satisfies Changes)

  assert.equal((await undoDispatch(root, 'toolu_a')).ok, true)
  assert.equal(await exists(made1), false, 'the created file is still there')
})

test('a created file somebody has since edited is not deleted', async (t) => {
  const root = await office(t)
  const mine = join(root, 'new.js')
  await writeFile(mine, 'hello\nand my own line\n', 'utf8')
  await recordChanges(root, 'toolu_a', {
    changes: [{ path: mine, kind: 'create', before: null, after: 'hello\n' }],
    shell: 0,
    unattributed: 0,
  } satisfies Changes)

  const got = await undoDispatch(root, 'toolu_a')
  assert.equal(got.ok, false)
  assert.match(got.ok ? '' : got.why.join(' '), /destroy somebody's changes/)
  assert.equal(await exists(mine), true, 'somebody’s work was deleted')
})

test('nothing is put back while the employee is still out', async (t) => {
  const root = await office(t, { back: false })
  const file = join(root, 'a.js')
  await writeFile(file, 'ONE', 'utf8')
  await recordChanges(root, 'toolu_a', {
    changes: [{ path: file, kind: 'edit', before: 'one', after: 'ONE' }],
    shell: 0,
    unattributed: 0,
  } satisfies Changes)

  const got = await undoDispatch(root, 'toolu_a')
  assert.equal(got.ok, false)
  assert.match(got.ok ? '' : got.why.join(' '), /has not reported back/)
  assert.equal(await readFile(file, 'utf8'), 'ONE')
})

test('a change naming a file outside the workspace is refused, not quietly skipped', async (t) => {
  /*
   * These paths arrived over a pipe from an employee's own tool call. A record naming
   * `/etc/hosts` is not a file the office declines to touch quietly — it is a record that should
   * not exist, and the refusal is how anybody finds out.
   */
  const root = await office(t)
  await recordChanges(root, 'toolu_a', {
    changes: [{ path: '/etc/hosts', kind: 'edit', before: 'a', after: 'b' }],
    shell: 0,
    unattributed: 0,
  } satisfies Changes)

  const got = await undoDispatch(root, 'toolu_a')
  assert.equal(got.ok, false)
  assert.match(got.ok ? '' : got.why.join(' '), /not inside this workspace/)
})

test('a dispatch with no record is not a dispatch that changed nothing', async (t) => {
  const root = await office(t)
  const got = await undoDispatch(root, 'toolu_a')
  assert.equal(got.ok, false)
  assert.match(got.ok ? '' : got.why.join(' '), /no record/)
})

test('an undo that also had shell commands says it did not undo everything', async (t) => {
  const root = await office(t)
  const file = join(root, 'a.js')
  await writeFile(file, 'ONE', 'utf8')
  await recordChanges(root, 'toolu_a', {
    changes: [{ path: file, kind: 'edit', before: 'one', after: 'ONE' }],
    shell: 6,
    unattributed: 0,
  } satisfies Changes)

  const got = await undoDispatch(root, 'toolu_a')
  assert.equal(got.ok, true)
  assert.match(got.ok ? got.said : '', /6 shell commands/)
})

test('a file another dispatch has since edited is named as such, and is still put back', async (t) => {
  /*
   * Undoing A after B edited a different region of the same file succeeds — A's text is still
   * unique — and leaves the file in a state neither dispatch produced. "1 file was put back" is
   * true about the operation and false about the file, so a second sentence says which.
   */
  const root = await office(t, { also: true })
  const file = join(root, 'a.js')
  await writeFile(file, 'ONE middle TWO', 'utf8')
  await recordChanges(root, 'toolu_a', {
    changes: [{ path: file, kind: 'edit', before: 'one', after: 'ONE' }],
    shell: 0,
    unattributed: 0,
  } satisfies Changes)
  // The later dispatch touched the same file, at a different place.
  await recordChanges(root, 'toolu_b', {
    changes: [{ path: file, kind: 'edit', before: 'two', after: 'TWO' }],
    shell: 0,
    unattributed: 0,
  } satisfies Changes)

  const got = await undoDispatch(root, 'toolu_a')
  assert.equal(got.ok, true, got.ok ? '' : got.why.join(' '))
  assert.equal(await readFile(file, 'utf8'), 'one middle TWO', 'the restore itself did not happen')
  assert.match(got.ok ? got.said : '', /not as it was before/)
})

test('a file no later dispatch touched gets no such sentence', async (t) => {
  const root = await office(t, { also: true })
  const mine = join(root, 'a.js')
  const theirs = join(root, 'b.js')
  await writeFile(mine, 'ONE', 'utf8')
  await writeFile(theirs, 'anything', 'utf8')
  await recordChanges(root, 'toolu_a', {
    changes: [{ path: mine, kind: 'edit', before: 'one', after: 'ONE' }],
    shell: 0,
    unattributed: 0,
  } satisfies Changes)
  await recordChanges(root, 'toolu_b', {
    changes: [{ path: theirs, kind: 'edit', before: 'x', after: 'y' }],
    shell: 0,
    unattributed: 0,
  } satisfies Changes)

  const got = await undoDispatch(root, 'toolu_a')
  assert.equal(got.ok, true)
  assert.doesNotMatch(got.ok ? got.said : 'x', /not as it was before/)
})

test('a dispatch sent EARLIER does not count as having edited it since', async (t) => {
  // Ordering is the whole of it. `toolu_b` is sent after `toolu_a`, so undoing *b* must not be
  // told that *a* — which ran first — has edited the file since.
  const root = await office(t, { also: true })
  const file = join(root, 'a.js')
  await writeFile(file, 'TWO', 'utf8')
  await recordChanges(root, 'toolu_a', {
    changes: [{ path: file, kind: 'edit', before: 'zero', after: 'ONE' }],
    shell: 0,
    unattributed: 0,
  } satisfies Changes)
  await recordChanges(root, 'toolu_b', {
    changes: [{ path: file, kind: 'edit', before: 'two', after: 'TWO' }],
    shell: 0,
    unattributed: 0,
  } satisfies Changes)

  const got = await undoDispatch(root, 'toolu_b')
  assert.equal(got.ok, true, got.ok ? '' : got.why.join(' '))
  assert.doesNotMatch(got.ok ? got.said : 'x', /not as it was before/)
})

test('the manager’s own turn gets a record, a row, and an undo', async (t) => {
  /*
   * The panel is titled "What the office changed" and listed only dispatches. The manager keeps
   * `Write` and `Edit` — only employees have them withheld — so it was omitting the one writer
   * that is always present, and saying so only in the empty state nobody with work sees.
   *
   * A manager turn has no dispatch id, so its record is keyed by the first write it made: a
   * `tool_use` id, unique, derived from the data rather than a clock.
   */
  const root = await office(t)
  const file = join(root, 'manager-wrote.js')
  await writeFile(file, 'AFTER', 'utf8')
  await recordChanges(
    root,
    'toolu_ownwrite',
    { changes: [{ path: file, kind: 'edit', before: 'before', after: 'AFTER' }], shell: 0, unattributed: 0 },
    { who: 'manager', at: '2026-09-01T04:00:00.000Z', session: 's' },
  )

  // The record knows who and when, which is what a row needs and the ledger cannot supply.
  const back = await readChanges(root, 'toolu_ownwrite')
  assert.equal(back.ok ? back.about?.who : null, 'manager')

  // And it can be put back, though no ledger line names it.
  const got = await undoDispatch(root, 'toolu_ownwrite')
  assert.equal(got.ok, true, got.ok ? '' : got.why.join(' '))
  assert.equal(await readFile(file, 'utf8'), 'before')
})

test('a manager turn is told when a later dispatch touched the same file', async (t) => {
  /*
   * The ordering for this comes from the ledger, which does not name a manager turn — so it fell
   * through to `[]` and the sentence could never appear. Silence that reads as "nothing else has
   * changed", which is the one thing this sentence exists to stop.
   */
  const root = await office(t, { also: true })
  const file = join(root, 'shared.js')
  await writeFile(file, 'MINE middle THEIRS', 'utf8')
  await recordChanges(
    root,
    'toolu_ownwrite',
    { changes: [{ path: file, kind: 'edit', before: 'mine', after: 'MINE' }], shell: 0, unattributed: 0 },
    // Before toolu_b, which is sent at 02:00.
    { who: 'manager', at: '2026-09-01T01:30:00.000Z', session: 's' },
  )
  await recordChanges(root, 'toolu_b', {
    changes: [{ path: file, kind: 'edit', before: 'theirs', after: 'THEIRS' }],
    shell: 0,
    unattributed: 0,
  })

  const got = await undoDispatch(root, 'toolu_ownwrite')
  assert.equal(got.ok, true, got.ok ? '' : got.why.join(' '))
  assert.match(got.ok ? got.said : '', /not as it was before/)
})
