/**
 * Which directory the office is a window onto.
 *
 * This module exists because of a problem that does not exist in a clone and would not have
 * shown until the last day of packaging: `dist/` goes inside `app.asar`, which is read-only, and
 * the workspace is not a read-only thing. Adding an agent writes a file. An office you cannot
 * hire into is not an office.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addProjectTemplate, resolveWorkspaceRoot, WORKSPACE_DIR } from '../src/main/workspace-root.js'
import { createProject } from '../src/main/projects.js'

import { tempDir } from './temp-dir.js'

async function shipped(t: TestContext): Promise<string> {
  const root = await tempDir(t, 'office-app-')
  await mkdir(join(root, '.claude', 'agents'), { recursive: true })
  await mkdir(join(root, 'projects', '_TEMPLATE'), { recursive: true })
  await writeFile(join(root, 'projects', '_TEMPLATE', 'PLAN.md'), '# Plan')
  await writeFile(join(root, '.claude', 'agents', 'manager.md'), '---\nname: manager\n---\nShipped.')
  return root
}

const box = (t: TestContext) => tempDir(t, 'office-user-')

test('a clone is its own office', async (t) => {
  // The path every developer and every test takes, and the whole "clone it and it works" story.
  const appRoot = await shipped(t)
  const got = await resolveWorkspaceRoot({ packaged: false, appRoot, templateRoot: appRoot, userData: await box(t), env: {} })

  assert.deepEqual(got, { root: appRoot, why: 'clone' })
})

test('OFFICE_WORKSPACE wins, packaged or not', async (t) => {
  // Somebody who has said where has said where.
  const shippedRoot = await shipped(t)
  for (const packaged of [true, false]) {
    const got = await resolveWorkspaceRoot({
      packaged,
      appRoot: shippedRoot,
      templateRoot: shippedRoot,
      userData: await box(t),
      env: { OFFICE_WORKSPACE: '/somewhere/they/chose' },
    })
    assert.deepEqual(got, { root: '/somewhere/they/chose', why: 'env' })
  }
})

test('a packaged first run seeds a workspace the user can write to', async (t) => {
  const appRoot = await shipped(t)
  const userData = await box(t)

  const got = await resolveWorkspaceRoot({ packaged: true, appRoot, templateRoot: appRoot, userData, env: {} })

  assert.equal(got.why, 'seeded')
  assert.equal(got.root, join(userData, WORKSPACE_DIR))
  assert.equal(got.problem, undefined)
  // And it actually contains what shipped, rather than being an empty directory with a name.
  assert.match(await readFile(join(got.root, '.claude', 'agents', 'manager.md'), 'utf8'), /Shipped\./)
  assert.ok((await readdir(got.root)).includes('projects'))
  // The scaffold, and only the scaffold. Seeding `projects` wholesale would copy the work of
  // whoever built the app into the user's own workspace.
  assert.ok((await readdir(join(got.root, 'projects'))).includes('_TEMPLATE'))
})

test('THE ONE THAT MATTERS: a second run never re-seeds over the user\'s edits', async (t) => {
  // An update that restored our version of somebody's agent file would be the worst bug this
  // module could have — silent, destructive, and indistinguishable from the app "resetting".
  const appRoot = await shipped(t)
  const userData = await box(t)

  const first = await resolveWorkspaceRoot({ packaged: true, appRoot, templateRoot: appRoot, userData, env: {} })
  const edited = join(first.root, '.claude', 'agents', 'manager.md')
  await writeFile(edited, 'Mine now. Do not touch.')
  // …and they hired somebody.
  await writeFile(join(first.root, '.claude', 'agents', 'wren.md'), '---\nname: wren\n---\nA reviewer.')

  const second = await resolveWorkspaceRoot({ packaged: true, appRoot, templateRoot: appRoot, userData, env: {} })

  assert.equal(second.why, 'existing', 'a second run re-seeded, which would overwrite their work')
  assert.equal(await readFile(edited, 'utf8'), 'Mine now. Do not touch.')
  assert.ok((await readdir(join(second.root, '.claude', 'agents'))).includes('wren.md'))
})

test('a seeding failure is reported, and the office still opens', async (t) => {
  // Absent is not empty, applied to a directory we could not create. An office that opens onto
  // an empty workspace and says why is more useful than one that refuses to open — and far more
  // useful than one that opens empty and says nothing.
  const got = await resolveWorkspaceRoot({
    packaged: true,
    appRoot: '/nonexistent/never/shipped',
    templateRoot: '/nonexistent/never/shipped',
    userData: await box(t),
    env: {},
  })

  assert.ok(got.root.length > 0, 'it still answers with a usable path')
  assert.match(got.problem ?? '', /could not set up its workspace/)
  assert.match(got.problem ?? '', /OFFICE_WORKSPACE/, 'and names the way out')
})

test('a packaged app seeds from where the template actually shipped, not from its own directory', async (t) => {
  // The bug that made the first artifact ever built unusable on its first run.
  //
  // Packaged, `appRoot` resolves **inside `app.asar`** — that is where `dist/main/main.js` runs
  // from. The template is not in there: `files` puts only `dist/` and `package.json` in the
  // archive, and `extraResources` copies `.claude/` and `projects/_TEMPLATE` to
  // `Contents/Resources/app/`, *beside* it. Seeding from `appRoot` looked in a directory that
  // has never held a template, and the office opened onto an empty workspace.
  //
  // Every other test in this file passes one directory for both, because in a clone they *are*
  // the same directory. That is exactly why nothing caught this: every developer and every test
  // takes the path where the bug cannot appear. This is the only case that separates them.
  const templateRoot = await shipped(t)
  const appRoot = await tempDir(t, 'office-asar-') // has no template in it, like an asar
  const userData = await box(t)

  const got = await resolveWorkspaceRoot({ packaged: true, appRoot, templateRoot, userData, env: {} })

  assert.equal(got.why, 'seeded')
  assert.equal(got.problem, undefined, 'seeding failed, so the office would open empty')
  assert.match(
    await readFile(join(got.root, '.claude', 'agents', 'manager.md'), 'utf8'),
    /Shipped\./,
    'the workspace was created and the template never reached it',
  )
})

test('a workspace we could not look into is not re-seeded over', async (t) => {
  // The hole beside THE ONE THAT MATTERS, and the same consequence by a different route.
  //
  // `hasContents` returned false on *any* readdir failure, so an unreadable workspace read as
  // an empty one and fell through to the seeding path. Its own docstring said "A directory we
  // cannot read is not empty" — the comment vouched for a rule the body broke, which is worse
  // than no comment, because the next person reads the guarantee and stops looking.
  //
  // The damage is not an overwrite: `cp` runs with `force: false`. It is restoration. A file the
  // person deleted on purpose — a shipped agent they did not want — comes back, because from
  // inside a directory we cannot list, missing and deleted look the same.
  const appRoot = await shipped(t)
  const userData = await box(t)

  const first = await resolveWorkspaceRoot({ packaged: true, appRoot, templateRoot: appRoot, userData, env: {} })
  // They fired somebody the app shipped with.
  const fired = join(first.root, '.claude', 'agents', 'manager.md')
  await rm(fired)

  // Now the workspace cannot be listed. Write and traverse still work, which is the combination
  // that makes this reachable at all: `readdir` fails, `cp` into it does not.
  await chmod(first.root, 0o300)
  try {
    const second = await resolveWorkspaceRoot({ packaged: true, appRoot, templateRoot: appRoot, userData, env: {} })

    assert.equal(second.why, 'existing', 'an unreadable workspace was treated as a first run')
    assert.match(second.problem ?? '', /could not read its workspace/, 'and it said nothing about why')
    assert.match(second.problem ?? '', /OFFICE_WORKSPACE/, 'and named no way out')
  } finally {
    // Readable again, so the assertion below can look and so the temp dir can be cleaned up.
    await chmod(first.root, 0o700)
  }

  assert.equal(
    await stat(fired).then(() => 'back', () => 'still gone'),
    'still gone',
    'the office put back an agent the person had deleted',
  )
})

test('a workspace somebody pointed the office at can be given a project template', async (t) => {
  /*
   * `OFFICE_WORKSPACE` returns without seeding, deliberately — that directory is somebody's own
   * and the office does not scatter files through a repository unbidden. The consequence was a
   * dead end: `createProject` hard-requires `projects/_TEMPLATE`, so the supported way to point
   * the office at a repository you already have could not start a project, and the panel said
   * "Create the directory by hand, or re-clone." Re-clone what? It is their repository.
   *
   * The office has the template. It just has to be asked.
   */
  const mine = await tempDir(t, 'office-mine-')
  const shipped = await tempDir(t, 'office-shipped-')
  await mkdir(join(shipped, 'projects', '_TEMPLATE'), { recursive: true })
  await writeFile(join(shipped, 'projects', '_TEMPLATE', 'PLAN.md'), '# <Project Name>\n', 'utf8')

  // Before: the office cannot start a project here.
  assert.equal((await createProject(mine, 'thing')).state, 'failed')

  const added = await addProjectTemplate(mine, shipped)
  assert.equal(added.ok, true, added.ok ? '' : added.reason)

  // After: it can, and what it made is a real project rather than an empty directory.
  const made = await createProject(mine, 'thing')
  assert.equal(made.state, 'created', JSON.stringify(made))
  // Not just copied — scaffolded. `<Project Name>` is substituted, which is proof the added
  // template went through the same path every other project does rather than landing as bytes.
  assert.equal(await readFile(join(mine, 'projects', 'thing', 'PLAN.md'), 'utf8'), '# thing\n')
})

test('adding the template twice does not overwrite an edited one', async (t) => {
  // `force: false`, like the seed. Somebody who customised their template and pressed the button
  // again must not get ours back — that is the failure the seeding path exists to avoid, and it
  // would be worse here, where the person is looking at the button when it happens.
  const mine = await tempDir(t, 'office-twice-')
  const shipped = await tempDir(t, 'office-shipped2-')
  await mkdir(join(shipped, 'projects', '_TEMPLATE'), { recursive: true })
  await writeFile(join(shipped, 'projects', '_TEMPLATE', 'PLAN.md'), 'ours\n', 'utf8')

  assert.equal((await addProjectTemplate(mine, shipped)).ok, true)
  await writeFile(join(mine, 'projects', '_TEMPLATE', 'PLAN.md'), 'mine, edited\n', 'utf8')
  assert.equal((await addProjectTemplate(mine, shipped)).ok, true)
  assert.equal(await readFile(join(mine, 'projects', '_TEMPLATE', 'PLAN.md'), 'utf8'), 'mine, edited\n')
})

test('a build with no template says where it looked', async (t) => {
  // The interesting failure is not permissions — it is a bundle whose extraResources does not
  // carry the template, which this repository shipped once and which presents as an ENOENT on a
  // path nobody can see from the panel.
  const mine = await tempDir(t, 'office-noshipped-')
  const got = await addProjectTemplate(mine, join(tmpdir(), 'does-not-exist-anywhere'))
  assert.equal(got.ok, false)
  assert.match(got.ok ? '' : got.reason, /could not copy its project template from .*does-not-exist-anywhere/)
})
