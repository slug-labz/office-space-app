/**
 * The update reconciler.
 *
 * Half of this file is the rule working — an old shipped copy moves, an edited one does not, a
 * file that was never here arrives. The other half is the rule being *attacked*, because the
 * failure that matters here is not the update failing to happen. It is a write landing on a
 * file somebody wrote themselves, or on a path outside their office entirely, and either of
 * those is worse than the stale-agent bug the module exists to fix.
 *
 * So every way found to aim a write somewhere it should not go has a test below: a manifest key
 * that climbs out of the workspace, a symlink standing in for a shipped file, a *dangling*
 * symlink that reads as absent, a file the user fired, a file the user benched, and an edit one
 * byte long. Each one is written to fail loudly if the guard for it is removed.
 *
 * Real files in a real temp directory, not a stubbed filesystem. The thing being prevented is a
 * write reaching disk, and a fake `fs` is exactly what would let one through unnoticed.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  applyReconcile,
  hashOf,
  planReconcile,
  readReceipt,
  reconcileProblems,
  safeRelativePath,
  summarise,
  writeReceipt,
  type ShippedManifest,
} from '../src/main/reconcile.js'
import { DISABLED_SUFFIX } from '../src/main/roster.js'

import { tempDir } from './temp-dir.js'

const MANAGER = '.claude/agents/manager.md'
const SKILL = '.claude/skills/explore-options/SKILL.md'

/** Day one, and today. The whole module turns on being able to tell these two apart. */
const DAY_ONE = '---\nname: manager\n---\n\nYou run this office.\n'
const SHIPPING_NOW = '---\nname: manager\n---\n\nYou run this office. Verify what you are told.\n'
const A_SKILL = '---\nname: explore-options\n---\n\nGenerate genuinely different options.\n'

/** What somebody types into an agent file when they want it to behave differently. */
const THEIRS = `${DAY_ONE}\nAlways dispatch the reviewer before merging.\n`

async function put(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), text)
}

const missing = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return false
  } catch {
    return true
  }
}

/** A shipped tree and a workspace, side by side under one temp directory. */
async function office(t: TestContext): Promise<{ dir: string; shipped: string; workspace: string }> {
  const dir = await tempDir(t, 'office-reconcile-')
  const shipped = join(dir, 'shipped')
  const workspace = join(dir, 'workspace')
  await mkdir(shipped, { recursive: true })
  await mkdir(workspace, { recursive: true })
  return { dir, shipped, workspace }
}

/**
 * The manifest `scripts/build.mjs` would emit for files with this history.
 *
 * Written from content rather than from hex, so a test says what a version *is* — the hashes
 * are how the proof is carried, not what it is about.
 */
function manifest(files: Record<string, { history: readonly string[]; current: string }>): ShippedManifest {
  const out: Record<string, { hashes: string[]; current: string }> = {}
  for (const [path, versions] of Object.entries(files)) {
    const current = hashOf(versions.current)
    out[path] = { hashes: [...versions.history.map(hashOf), current], current }
  }
  return { generatedAt: '2026-08-26T00:00:00.000Z', files: out }
}

const MANAGER_ONLY = manifest({ [MANAGER]: { history: [DAY_ONE], current: SHIPPING_NOW } })

// ───────────────────────────────────────────────────────────── the rule working ──

test('a workspace file still matching an old shipped version is brought forward', async (t) => {
  // The office that has been running day-one instructions since it was seeded. Nobody has typed
  // in this file and history proves it, so replacing it cannot lose anything.
  const { shipped, workspace } = await office(t)
  await put(shipped, MANAGER, SHIPPING_NOW)
  await put(workspace, MANAGER, DAY_ONE)

  const plan = await planReconcile(MANAGER_ONLY, workspace, null)

  assert.deepEqual(plan.updated, [MANAGER])
  assert.deepEqual(plan.keptBecauseEdited, [])
  assert.deepEqual(plan.added, [])
  assert.deepEqual(plan.unreadable, [])

  const outcome = await applyReconcile(plan, MANAGER_ONLY, shipped, workspace)

  assert.deepEqual(outcome.failed, [])
  assert.deepEqual(outcome.written, [MANAGER])
  assert.equal(await readFile(join(workspace, MANAGER), 'utf8'), SHIPPING_NOW)
})

test('a workspace file matching no shipped version is the user\'s, and is left alone', async (t) => {
  // One line added by somebody who wanted their manager to behave differently. No version we
  // ever shipped looks like that, which is the whole proof: they wrote it.
  const { shipped, workspace } = await office(t)
  await put(shipped, MANAGER, SHIPPING_NOW)
  await put(workspace, MANAGER, THEIRS)

  const plan = await planReconcile(MANAGER_ONLY, workspace, null)

  assert.deepEqual(plan.keptBecauseEdited, [MANAGER])
  assert.deepEqual(plan.updated, [])
  assert.deepEqual(plan.added, [])
  assert.deepEqual(plan.unreadable, [])

  const outcome = await applyReconcile(plan, MANAGER_ONLY, shipped, workspace)

  assert.deepEqual(outcome.written, [])
  assert.deepEqual(outcome.failed, [])
  // The point of the whole module: their bytes, byte for byte, after an update ran.
  assert.equal(await readFile(join(workspace, MANAGER), 'utf8'), THEIRS)
})

test('a shipped file the workspace has never had is added', async (t) => {
  // The case that started this. A skill shipped after an office was seeded simply never
  // arrives, and the office runs without it until somebody notices by hand.
  const { shipped, workspace } = await office(t)
  await put(shipped, MANAGER, SHIPPING_NOW)
  await put(shipped, SKILL, A_SKILL)
  await put(workspace, MANAGER, SHIPPING_NOW)

  const both = manifest({
    [MANAGER]: { history: [DAY_ONE], current: SHIPPING_NOW },
    [SKILL]: { history: [], current: A_SKILL },
  })
  const plan = await planReconcile(both, workspace, null)

  assert.deepEqual(plan.added, [SKILL])
  // The manager is already current, so it is on no list at all. Nothing happens to it.
  assert.deepEqual(plan.updated, [])
  assert.deepEqual(plan.keptBecauseEdited, [])
  assert.deepEqual(plan.keptBecauseRemoved, [])

  const outcome = await applyReconcile(plan, both, shipped, workspace)

  assert.deepEqual(outcome.failed, [])
  assert.deepEqual(outcome.written, [SKILL])
  // Including the two directories it lives in, which did not exist a moment ago.
  assert.equal(await readFile(join(workspace, SKILL), 'utf8'), A_SKILL)
})

test('a file we could not read is reported unreadable, and never written over', async (t) => {
  // Standing order 4, at the one place in this app where getting it wrong destroys something.
  // A directory standing where a file should be is the deterministic way to make a read fail on
  // every platform: `readFile` raises EISDIR. What the reconciler keys on is only that the errno
  // is *not* ENOENT — the same branch catches a file whose permissions we lack, or one on a
  // volume that has gone away. All of them mean "something is there and we do not know what",
  // which is not the same fact as "nothing is there".
  const { shipped, workspace } = await office(t)
  await put(shipped, MANAGER, SHIPPING_NOW)
  await mkdir(join(workspace, MANAGER), { recursive: true })

  const plan = await planReconcile(MANAGER_ONLY, workspace, null)

  assert.deepEqual(plan.unreadable, [MANAGER])
  assert.deepEqual(plan.added, [], 'unreadable was reported as missing, which is how it gets overwritten')
  assert.deepEqual(plan.updated, [])
  assert.deepEqual(plan.keptBecauseEdited, [])

  const outcome = await applyReconcile(plan, MANAGER_ONLY, shipped, workspace)

  assert.deepEqual(outcome.written, [])
  assert.ok((await lstat(join(workspace, MANAGER))).isDirectory(), 'we wrote over what we could not read')

  // And it is said out loud, in the shape the rest of the app reports startup facts in.
  const problems = reconcileProblems(plan, outcome)
  assert.equal(problems.length, 1)
  assert.equal(problems[0]?.kind, 'unreadable-file')
  assert.equal(problems[0]?.path, MANAGER)
})

test('the notice counts what was written, and names what was left alone', async (t) => {
  const { shipped, workspace } = await office(t)
  await put(shipped, MANAGER, SHIPPING_NOW)
  await put(shipped, SKILL, A_SKILL)
  await put(workspace, MANAGER, THEIRS)

  const both = manifest({
    [MANAGER]: { history: [DAY_ONE], current: SHIPPING_NOW },
    [SKILL]: { history: [], current: A_SKILL },
  })
  const plan = await planReconcile(both, workspace, null)
  const outcome = await applyReconcile(plan, both, shipped, workspace)

  const said = summarise(plan, outcome)
  assert.ok(said, 'a startup that changed a file said nothing about it')
  assert.match(said, /1 file brought forward/)
  assert.match(said, /1 of yours left alone/)

  // Silent when nothing moved. Told at every launch that we touched nothing, nobody reads the
  // launch where we did.
  assert.equal(summarise(plan, { written: [], failed: [] }), null)
})

// ──────────────────────────────────────────────────── trying to break it instead ──

test('an edit is not overwritten even when the same run is updating its neighbours', async (t) => {
  // The plan is one loop over one manifest, so a decision made for one file must not leak into
  // the next. Two shipped files, one stale and one edited, in the same run.
  const { shipped, workspace } = await office(t)
  await put(shipped, MANAGER, SHIPPING_NOW)
  await put(shipped, SKILL, A_SKILL)
  await put(workspace, MANAGER, DAY_ONE)
  await put(workspace, SKILL, `${A_SKILL}\nAnd always ask me first.\n`)

  const both = manifest({
    [MANAGER]: { history: [DAY_ONE], current: SHIPPING_NOW },
    [SKILL]: { history: [], current: A_SKILL },
  })
  const plan = await planReconcile(both, workspace, null)
  const outcome = await applyReconcile(plan, both, shipped, workspace)

  assert.deepEqual(outcome.written, [MANAGER])
  assert.equal(await readFile(join(workspace, SKILL), 'utf8'), `${A_SKILL}\nAnd always ask me first.\n`)
})

test('a one-byte edit is still an edit', async (t) => {
  // The nearest miss available: a trailing newline. If any part of this ever starts comparing
  // trimmed text, or sizes, or prefixes, this is the test that goes red.
  const { shipped, workspace } = await office(t)
  await put(shipped, MANAGER, SHIPPING_NOW)
  await put(workspace, MANAGER, `${DAY_ONE}\n`)

  const plan = await planReconcile(MANAGER_ONLY, workspace, null)

  assert.deepEqual(plan.keptBecauseEdited, [MANAGER])
  assert.deepEqual(plan.updated, [])
})

test('a manifest key that climbs out of the workspace is refused, not followed', async (t) => {
  // The one failure in this module that would not merely annoy somebody. A key with `..` in it
  // aims a write at whatever is above the office — here, a file in the temp root standing in for
  // anything at all on a real machine.
  const { dir, shipped, workspace } = await office(t)
  const outside = join(dir, 'THEIR-NOTES.md')
  await writeFile(outside, 'do not touch\n')
  await put(shipped, MANAGER, SHIPPING_NOW)

  const escape = '../THEIR-NOTES.md'
  const evil: ShippedManifest = {
    generatedAt: '2026-08-26T00:00:00.000Z',
    files: {
      [escape]: { hashes: [hashOf(SHIPPING_NOW)], current: hashOf(SHIPPING_NOW) },
      '/etc/office-space-probe': { hashes: [hashOf(SHIPPING_NOW)], current: hashOf(SHIPPING_NOW) },
    },
  }

  const plan = await planReconcile(evil, workspace, null)

  assert.deepEqual([...plan.unsafe].sort(), ['../THEIR-NOTES.md', '/etc/office-space-probe'])
  assert.deepEqual(plan.added, [], 'a path outside the workspace was planned as a write')
  assert.deepEqual(plan.updated, [])

  // And apply refuses it a second time, so a plan that arrived from anywhere still cannot land.
  const forced = { ...plan, added: [escape] }
  const outcome = await applyReconcile(forced, evil, shipped, workspace)

  assert.deepEqual(outcome.written, [])
  assert.equal(outcome.failed.length, 1)
  assert.equal(await readFile(outside, 'utf8'), 'do not touch\n')
})

test('a symlink standing in for a shipped file is never written through', async (t) => {
  // Seeding writes real files, so a symlink at a shipped path is something the user arranged —
  // and its target is somewhere we have no business writing. Worse, the target's content is what
  // a read returns, so one pointing at an old shipped copy would otherwise look exactly like the
  // stale file this module is for.
  const { dir, shipped, workspace } = await office(t)
  const target = join(dir, 'their-real-manager.md')
  await writeFile(target, DAY_ONE)
  await put(shipped, MANAGER, SHIPPING_NOW)
  await mkdir(dirname(join(workspace, MANAGER)), { recursive: true })
  await symlink(target, join(workspace, MANAGER))

  const plan = await planReconcile(MANAGER_ONLY, workspace, null)

  assert.deepEqual(plan.keptBecauseEdited, [MANAGER])
  assert.deepEqual(plan.updated, [], 'a symlink was planned for a write, which lands on its target')

  await applyReconcile(plan, MANAGER_ONLY, shipped, workspace)
  assert.equal(await readFile(target, 'utf8'), DAY_ONE)
})

test('a dangling symlink reads as absent and is still not written through', async (t) => {
  // The nastier half of the same vector. A link to nothing raises ENOENT on read, which is the
  // one errno that means "there is nothing of theirs here" — and a write would then *create* the
  // target, outside the office, at a path somebody else chose.
  const { dir, shipped, workspace } = await office(t)
  const target = join(dir, 'not-here-yet.md')
  await put(shipped, SKILL, A_SKILL)
  await mkdir(dirname(join(workspace, SKILL)), { recursive: true })
  await symlink(target, join(workspace, SKILL))

  const skillOnly = manifest({ [SKILL]: { history: [], current: A_SKILL } })
  const plan = await planReconcile(skillOnly, workspace, null)

  assert.deepEqual(plan.added, [], 'a dangling symlink was treated as an empty slot')
  assert.deepEqual(plan.keptBecauseEdited, [SKILL])

  await applyReconcile(plan, skillOnly, shipped, workspace)
  assert.ok(await missing(target), 'the update created a file outside the workspace')
})

test('an agent the office fired is not resurrected by the next update', async (t) => {
  // `roster.ts` unlinks the file when somebody fires an agent, which leaves a shipped path
  // absent — identical, from the path alone, to a skill shipped after this office was seeded.
  // The receipt is what tells them apart: a path we gave this workspace and that is now gone was
  // taken away on purpose.
  const { shipped, workspace } = await office(t)
  await put(shipped, MANAGER, SHIPPING_NOW)

  const plan = await planReconcile(MANAGER_ONLY, workspace, { given: [MANAGER] })

  assert.deepEqual(plan.keptBecauseRemoved, [MANAGER])
  assert.deepEqual(plan.added, [], 'a fired agent was hired back by an update')

  const outcome = await applyReconcile(plan, MANAGER_ONLY, shipped, workspace)
  assert.deepEqual(outcome.written, [])
  assert.ok(await missing(join(workspace, MANAGER)))
})

test('an agent on the bench is not resurrected either', async (t) => {
  // `disable` renames the file rather than deleting it, so the trace is right there beside the
  // gap. That works even on a workspace with no receipt — every office that existed before any
  // of this shipped.
  const { shipped, workspace } = await office(t)
  await put(shipped, MANAGER, SHIPPING_NOW)
  await put(workspace, `${MANAGER}${DISABLED_SUFFIX}`, DAY_ONE)

  const plan = await planReconcile(MANAGER_ONLY, workspace, null)

  assert.deepEqual(plan.keptBecauseRemoved, [MANAGER])
  assert.deepEqual(plan.added, [], 'a benched agent was put back on the floor by an update')
  assert.ok(await missing(join(workspace, MANAGER)))
})

test('the receipt records what is there, so a removal sticks from then on', async (t) => {
  // The two runs that make firing durable. First: an office with no record gets the file, and
  // the receipt is written. Then it is fired. Second: absent *and* written down, so it stays
  // fired for good.
  const { shipped, workspace } = await office(t)
  await put(shipped, MANAGER, SHIPPING_NOW)

  const first = await planReconcile(MANAGER_ONLY, workspace, null)
  assert.deepEqual(first.added, [MANAGER])
  const delivered = await applyReconcile(first, MANAGER_ONLY, shipped, workspace)
  assert.deepEqual(await writeReceipt(MANAGER_ONLY, workspace, null, delivered.written), { ok: true })

  const receipt = await readReceipt(workspace)
  assert.deepEqual(receipt, { given: [MANAGER] })

  // They fire them. `roster.ts` unlinks the file and nothing else.
  await rm(join(workspace, MANAGER))

  const second = await planReconcile(MANAGER_ONLY, workspace, receipt)
  assert.deepEqual(second.added, [], 'the second launch put a fired agent back')
  assert.deepEqual(second.keptBecauseRemoved, [MANAGER])

  // And a file that was never delivered is not recorded as delivered, so it is tried again.
  // Nothing was written on this pass, which is the whole point: the receipt keeps what it
  // already knew and invents nothing from what happens to be on disk.
  const withSkill = manifest({
    [MANAGER]: { history: [DAY_ONE], current: SHIPPING_NOW },
    [SKILL]: { history: [], current: A_SKILL },
  })
  await writeReceipt(withSkill, workspace, receipt, [])
  assert.deepEqual((await readReceipt(workspace))?.given, [MANAGER])
})

test('a shipped copy that does not match the manifest is refused', async (t) => {
  // A half-finished build, or somebody editing the app's own `.claude/` after building it. The
  // plan was reasoned from the manifest, so a source that disagrees with it is not the file the
  // plan is about — copying it would push a stray local edit out as an update.
  const { shipped, workspace } = await office(t)
  await put(shipped, MANAGER, `${SHIPPING_NOW}\nlocal experiment\n`)
  await put(workspace, MANAGER, DAY_ONE)

  const plan = await planReconcile(MANAGER_ONLY, workspace, null)
  assert.deepEqual(plan.updated, [MANAGER])

  const outcome = await applyReconcile(plan, MANAGER_ONLY, shipped, workspace)

  assert.deepEqual(outcome.written, [])
  assert.equal(outcome.failed.length, 1)
  assert.equal(await readFile(join(workspace, MANAGER), 'utf8'), DAY_ONE)
  // And it is a reported problem rather than a silent no-op.
  assert.equal(reconcileProblems(plan, outcome).length, 1)
})

test('safeRelativePath refuses everything that is not a file under the root', async () => {
  const root = '/tmp/office'
  for (const bad of ['..', '../x', 'a/../../x', '/etc/passwd', '', '.', 'a\\b', 'a\0b']) {
    assert.equal(safeRelativePath(root, bad), null, `accepted ${JSON.stringify(bad)}`)
  }
  assert.equal(safeRelativePath(root, '.claude/agents/manager.md'), '/tmp/office/.claude/agents/manager.md')
  // A `..` that cancels out inside the root is fine — it names a file under it.
  assert.equal(safeRelativePath(root, '.claude/x/../agents/manager.md'), '/tmp/office/.claude/agents/manager.md')
})

test('KNOWN LIMIT: a file edited back to an exact old shipped version is brought forward', async (t) => {
  // Pinned deliberately, because it is the one false positive the hash rule cannot see. Somebody
  // who reverts their manager.md to the day-one text by hand has produced a file byte-identical
  // to something we shipped, and nothing on disk distinguishes that from never having touched
  // it. It is brought forward, and their revert is undone.
  //
  // Left as it is rather than patched around: the alternatives are mtime, which every checkout
  // and copy rewrites, or refusing to update anything, which is the bug. Nothing is *lost* — the
  // content they reverted to is a version we ship and can be reverted to again — and the notice
  // names the file. If this test ever fails, someone has changed the rule, and this comment is
  // where they should argue with it.
  const { shipped, workspace } = await office(t)
  await put(shipped, MANAGER, SHIPPING_NOW)
  await put(workspace, MANAGER, DAY_ONE)

  const plan = await planReconcile(MANAGER_ONLY, workspace, { given: [MANAGER] })
  assert.deepEqual(plan.updated, [MANAGER])
})

/**
 * The window between deciding and writing.
 *
 * `planReconcile` decides a file is safe to replace by reading it; `applyReconcile` writes it
 * later. Between the two, anything may save over that file — an editor on a timer, a second
 * instance starting, the office's own hire flow writing an agent, a sync client. Apply
 * re-verified the *shipped source* against the manifest from the beginning, and never looked at
 * the destination again.
 *
 * Found by attacking the merged code rather than reading it. The stream that wrote this module
 * looked for exactly this class of bug and reported "I could not construct a case where an
 * edited file is overwritten" — which was true of everything it tried, and not true of this.
 * The loss it produces is the precise loss the module exists to prevent.
 */
test('a file that changes between the plan and the write is not ours to replace', async (t) => {
  const shipped = await tempDir(t, 'office-shipped-')
  const workspace = await tempDir(t, 'office-ws-')
  const rel = join('.claude', 'agents', 'manager.md')

  const OLD = 'the day-one manager\n'
  const NEW = 'the current shipped manager\n'
  const EDIT = 'hours of somebody’s work\n'

  await mkdir(join(shipped, '.claude', 'agents'), { recursive: true })
  await writeFile(join(shipped, rel), NEW)
  await mkdir(join(workspace, '.claude', 'agents'), { recursive: true })
  await writeFile(join(workspace, rel), OLD)

  const shipping = manifest({ [rel]: { history: [OLD], current: NEW } })

  const plan = await planReconcile(shipping, workspace, null)
  assert.deepEqual(plan.updated, [rel], 'an untouched old copy is what this test needs to start from')

  // The save that lands in the window.
  await writeFile(join(workspace, rel), EDIT)

  const outcome = await applyReconcile(plan, shipping, shipped, workspace)

  assert.deepEqual(outcome.written, [], 'nothing may be written over a file that moved')
  assert.equal(await readFile(join(workspace, rel), 'utf8'), EDIT, 'the edit survives byte for byte')
  assert.match(
    outcome.failed[0]?.cause ?? '',
    /changed after the plan/,
    'and it says why, rather than failing silently',
  )
})

test('a file removed inside the same window is also left alone', async (t) => {
  // The other half: the plan read it, so something deleted it since. Re-creating it would be the
  // resurrection bug this module already guards against, arriving through the write instead.
  const shipped = await tempDir(t, 'office-shipped-')
  const workspace = await tempDir(t, 'office-ws-')
  const rel = join('.claude', 'agents', 'manager.md')
  const OLD = 'the day-one manager\n'
  const NEW = 'the current shipped manager\n'

  await mkdir(join(shipped, '.claude', 'agents'), { recursive: true })
  await writeFile(join(shipped, rel), NEW)
  await mkdir(join(workspace, '.claude', 'agents'), { recursive: true })
  await writeFile(join(workspace, rel), OLD)

  const shipping = manifest({ [rel]: { history: [OLD], current: NEW } })
  const plan = await planReconcile(shipping, workspace, null)
  await rm(join(workspace, rel))

  const outcome = await applyReconcile(plan, shipping, shipped, workspace)
  assert.deepEqual(outcome.written, [], 'a file deleted since the plan is not re-created by it')
})

/**
 * The two files whose contents are a security decision.
 *
 * `.claude/settings.json` holds `permissions.allow` — the commands this app runs without asking
 * anybody — and `.claude/hooks/approval-gate.mjs` is what refuses everything else. Both are
 * shipped, so an office that never edited them correctly gets them brought forward. That is the
 * reconciler working, and skipping them would strand the workspaces most in need of the fix.
 *
 * What was wrong was the sentence. The notice names four paths and folds the rest into "and N
 * more", the manifest is sorted by path, `.claude/agents/` sorts first, and this repo ships seven
 * agents — so on any office more than a few versions behind, these two were **structurally
 * guaranteed** to be inside the unnamed remainder. Found from both ends on the same night: by
 * attacking the reconciler, and by reading which paths are shipped.
 */
test('a change to what may run without asking is always named, however long the list', () => {
  const written = [
    join('.claude', 'agents', 'backend.md'),
    join('.claude', 'agents', 'builder.md'),
    join('.claude', 'agents', 'frontend.md'),
    join('.claude', 'agents', 'manager.md'),
    join('.claude', 'agents', 'reviewer.md'),
    join('.claude', 'hooks', 'approval-gate.mjs'),
    join('.claude', 'settings.json'),
  ]
  const notice = summarise(
    { updated: written, keptBecauseEdited: [], added: [], keptBecauseRemoved: [], unreadable: [], unsafe: [], sawInWorkspace: {} },
    { written, failed: [] },
  )

  assert.ok(notice, 'seven files were written, so there is something to say')
  assert.match(notice, /settings\.json/, 'the permission list must be named, not folded away')
  assert.match(notice, /approval-gate\.mjs/, 'and so must the thing that refuses what it does not allow')
  assert.match(
    notice,
    /may run without asking you has changed/,
    'a filename is not the point — what may now happen without them is',
  )
})

test('an ordinary update says nothing about permissions, because nothing about them changed', () => {
  // The other half: the sentence must not appear when it is not true, or it becomes noise people
  // learn to skip — and then it is not there on the run that matters.
  const written = [join('.claude', 'agents', 'manager.md')]
  const notice = summarise(
    { updated: written, keptBecauseEdited: [], added: [], keptBecauseRemoved: [], unreadable: [], unsafe: [], sawInWorkspace: {} },
    { written, failed: [] },
  )

  assert.ok(notice)
  assert.doesNotMatch(notice, /may run without asking/, 'no permission file was written, so say nothing about them')
})

/**
 * Present is not the same question as delivered.
 *
 * The receipt exists so a fired agent stays fired: absent *and* recorded as given means this
 * office took it away on purpose. It recorded a path whenever a file existed there — which is
 * the same set for a workspace this app seeded, and a different one the moment somebody's own
 * file sits at a path we also ship.
 *
 * Found by the second session while hunting for a receipt that suppresses a later legitimate
 * update. Three steps, each correct alone: their file is correctly kept as theirs, then recorded
 * as ours, then deleting it reads as a deliberate removal — and the shipped file can never
 * arrive again. Nothing is overwritten, so it is not the dangerous class; it is permanently and
 * silently missing, indistinguishable from the rule working.
 *
 * Not hypothetical: the roster's own "write a skill" form creates skills by name, and the shipped
 * names are `handoff`, `plan`, `state`, `verify`, `meet` — ordinary enough to collide without
 * anybody hand-editing anything.
 */
test('a file of the user’s at a shipped path is never recorded as something we gave them', async (t) => {
  const shipped = await tempDir(t, 'office-shipped-')
  const workspace = await tempDir(t, 'office-ws-')
  const rel = join('.claude', 'skills', 'handoff', 'SKILL.md')
  const OURS = 'the shipped handoff skill\n'
  const THEIRS = 'my own handoff skill\n'

  await mkdir(dirname(join(shipped, rel)), { recursive: true })
  await writeFile(join(shipped, rel), OURS)
  await mkdir(dirname(join(workspace, rel)), { recursive: true })
  await writeFile(join(workspace, rel), THEIRS)

  const shipping = manifest({ [rel]: { history: [], current: OURS } })

  const first = await planReconcile(shipping, workspace, null)
  assert.deepEqual(first.keptBecauseEdited, [rel], 'their file is theirs')
  const applied = await applyReconcile(first, shipping, shipped, workspace)
  await writeReceipt(shipping, workspace, null, applied.written)

  const receipt = await readReceipt(workspace)
  assert.deepEqual(receipt?.given ?? [], [], 'we gave them nothing, so the receipt says nothing')

  // They delete their own skill. Ours must still be able to arrive.
  await rm(join(workspace, rel))
  const second = await planReconcile(shipping, workspace, receipt)
  assert.deepEqual(second.added, [rel], 'the shipped skill is not suppressed by their own deletion')
  assert.deepEqual(second.keptBecauseRemoved, [])
})

test('a file we really did deliver stays gone once they remove it', async (t) => {
  // The direction the receipt exists for, pinned so the fix above cannot quietly undo it.
  const shipped = await tempDir(t, 'office-shipped-')
  const workspace = await tempDir(t, 'office-ws-')
  const rel = join('.claude', 'agents', 'tester.md')
  const OURS = 'the shipped tester\n'

  await mkdir(dirname(join(shipped, rel)), { recursive: true })
  await writeFile(join(shipped, rel), OURS)
  await mkdir(dirname(join(workspace, rel)), { recursive: true })

  const shipping = manifest({ [rel]: { history: [], current: OURS } })
  const first = await planReconcile(shipping, workspace, null)
  const applied = await applyReconcile(first, shipping, shipped, workspace)
  assert.deepEqual(applied.written, [rel], 'it was genuinely delivered')
  await writeReceipt(shipping, workspace, null, applied.written)

  const receipt = await readReceipt(workspace)
  await rm(join(workspace, rel))
  const second = await planReconcile(shipping, workspace, receipt)
  assert.deepEqual(second.added, [], 'a fired agent stays fired')
  assert.deepEqual(second.keptBecauseRemoved, [rel])
})
