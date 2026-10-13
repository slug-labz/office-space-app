/**
 * Keeping what a dispatch changed, and the two ways reading it back can lie.
 *
 * `shared/changes.ts` decides what changed; this is the file it lands in. The interesting part is
 * not the round trip — it is that a record which is *absent* and a record which is *unreadable*
 * are different answers, and only one of them means "this dispatch changed nothing".
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { readChanges, recordChanges } from '../src/main/changes.js'
import type { Changes } from '../src/shared/changes.js'

import { tempDir } from './temp-dir.js'

async function workspace(t: TestContext): Promise<string> {
  return tempDir(t, 'office-changes-')
}

const some: Changes = {
  changes: [{ path: '/w/notes.txt', kind: 'edit', before: 'bravo', after: 'BRAVO' }],
  shell: 2,
  unattributed: 1,
}

test('what a dispatch changed survives a round trip', async (t) => {
  const root = await workspace(t)
  await recordChanges(root, 'toolu_abc', some)
  const back = await readChanges(root, 'toolu_abc')
  assert.equal(back.ok, true)
  assert.deepEqual(back.ok ? back.changes : null, some)
})

test('it is not written into the ledger, which is rewritten whole on every append', async (t) => {
  /*
   * `dispatches.jsonl` is read, written to a temp file and renamed on *every* dispatch, and its
   * own header justifies that only because the file grows by two lines each time. Patch bodies
   * are not two lines: putting them there makes every later dispatch pay a rewrite proportional
   * to every earlier dispatch's diff, and it arrives quietly, as an office that got slow.
   */
  const root = await workspace(t)
  await recordChanges(root, 'toolu_abc', some)
  const at = join(root, '.office-space', 'changes', 'toolu_abc.json')
  assert.ok((await readFile(at, 'utf8')).length > 0, 'the record is not in its own file')
})

test('a dispatch nobody has finished has no record, and that is not a failure', async (t) => {
  const back = await readChanges(await workspace(t), 'toolu_never')
  assert.deepEqual(back, { ok: true, changes: null, undone: null, about: null })
})

test('a record that will not parse says so, rather than becoming an empty change list', async (t) => {
  /*
   * The failure this whole feature exists to prevent, arriving through its own storage. A
   * corrupt record read as `{ changes: [] }` renders as *"this dispatch changed nothing"* — which
   * is a sentence about somebody's files, and it would be false.
   */
  const root = await workspace(t)
  await mkdir(join(root, '.office-space', 'changes'), { recursive: true })
  await writeFile(join(root, '.office-space', 'changes', 'toolu_bad.json'), '{ "changes": [ truncated', 'utf8')

  const back = await readChanges(root, 'toolu_bad')
  assert.equal(back.ok, false, 'an unreadable record was reported as a readable empty one')
  assert.match(back.ok ? '' : back.reason, /will not parse/)
})
