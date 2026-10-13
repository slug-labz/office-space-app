/**
 * The three ways something stops being in your way.
 *
 * Until this existed the whole removal surface of a 48-method API was `forget(path)`, which
 * deletes a stored file from the privacy panel. Projects, conversations and offices were
 * create-only, so the switcher grew forever and a project started by mistake was permanent.
 *
 * One verb would have been wrong. The three things being removed are not the same kind of thing,
 * and the tests below are mostly about the boundaries between them.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { ARCHIVE_DIR, archiveProject, deleteProject, describeProject, isSafeProjectId } from '../src/main/removal.js'

import { tempDir } from './temp-dir.js'

async function workspace(t: TestContext, projects: Record<string, readonly string[]>): Promise<string> {
  const root = await tempDir(t, 'office-removal-')
  for (const [name, files] of Object.entries(projects)) {
    await mkdir(join(root, 'projects', name), { recursive: true })
    for (const file of files) await writeFile(join(root, 'projects', name, file), 'x')
  }
  return root
}

test('an id that could escape projects/ is refused before anything moves', async (t) => {
  // Ids come from directory listings today, so this is belt and braces — but `archiveProject`
  // renames and `deleteProject` trashes whatever they are handed, and a `..` reaching either
  // would be the worst bug in that file.
  for (const bad of ['..', '.', '', '../../etc', 'a/b', 'a\\b', '.hidden']) {
    assert.equal(isSafeProjectId(bad), false, `${JSON.stringify(bad)} should be refused`)
  }
  assert.equal(isSafeProjectId('payments'), true)

  const root = await workspace(t, { real: ['PLAN.md'] })
  const escaped = await archiveProject(root, '../real')
  assert.equal(escaped.ok, false)
  // And the real one is untouched.
  assert.ok(await stat(join(root, 'projects', 'real')))
})

test('a confirmation can name the directory and count what is in it', async (t) => {
  const root = await workspace(t, { doomed: ['PLAN.md', 'PROGRESS.md', 'TASKS.md'] })
  const found = await describeProject(root, 'doomed')
  assert.equal(found.files, 3)
  assert.equal(found.unreadable, false)
  assert.match(found.path, /projects\/doomed$/)
})

test('a project it could not read is unreadable, never "0 files"', async (t) => {
  // The fourth standing order on the one screen where it would cost somebody their work: a
  // dialog that says "0 files" about a directory it failed to open invites a person to delete
  // something it never looked at.
  const root = await workspace(t, {})
  const missing = await describeProject(root, 'never-existed')
  assert.equal(missing.unreadable, true)
  assert.equal(missing.files, 0, 'the count is 0 and the flag is what stops it being read as empty')
})

test('archiving moves a project inside the workspace and nothing leaves', async (t) => {
  const root = await workspace(t, { finished: ['PLAN.md'] })
  assert.equal((await archiveProject(root, 'finished')).ok, true)

  assert.deepEqual(await readdir(join(root, 'projects')), [ARCHIVE_DIR])
  assert.deepEqual(await readdir(join(root, 'projects', ARCHIVE_DIR)), ['finished'])
  // The file is still there, which is the whole difference between archive and delete.
  assert.deepEqual(await readdir(join(root, 'projects', ARCHIVE_DIR, 'finished')), ['PLAN.md'])
})

test('archiving over an existing archive refuses rather than overwriting it', async (t) => {
  const root = await workspace(t, { twice: ['PLAN.md'] })
  await archiveProject(root, 'twice')
  await mkdir(join(root, 'projects', 'twice'), { recursive: true })
  await writeFile(join(root, 'projects', 'twice', 'PLAN.md'), 'the second one')

  const second = await archiveProject(root, 'twice')
  assert.equal(second.ok, false)
  assert.match(second.reason ?? '', /already archived/)
  // Both still exist. Silently replacing the first would destroy a project the person archived
  // precisely because they wanted to keep it.
  assert.ok(await stat(join(root, 'projects', 'twice', 'PLAN.md')))
  assert.ok(await stat(join(root, 'projects', ARCHIVE_DIR, 'twice', 'PLAN.md')))
})

test('archiving something that is not there says so rather than succeeding quietly', async (t) => {
  const root = await workspace(t, {})
  const done = await archiveProject(root, 'ghost')
  assert.equal(done.ok, false)
  assert.match(done.reason ?? '', /no project called "ghost"/)
})

test('deleting delegates the destruction, and reports a refusal rather than swallowing it', async (t) => {
  const root = await workspace(t, { doomed: ['PLAN.md'] })

  const trashed: string[] = []
  const ok = await deleteProject(root, 'doomed', async (path) => { trashed.push(path) })
  assert.equal(ok.ok, true)
  assert.equal(trashed.length, 1)
  assert.match(trashed[0]!, /projects\/doomed$/)

  // Trash can fail for real reasons — a network volume, a permission. A silent no-op on the one
  // call where somebody expects something to have happened is the worst available answer.
  const root2 = await workspace(t, { stuck: ['PLAN.md'] })
  const bad = await deleteProject(root2, 'stuck', async () => { throw new Error('volume is read-only') })
  assert.equal(bad.ok, false)
  assert.match(bad.reason ?? '', /volume is read-only/)
  assert.ok(await stat(join(root2, 'projects', 'stuck')), 'a failed delete leaves the project alone')
})
