/**
 * The shelf.
 *
 * Two halves with two different disciplines. Adding and removing follow the same rule as hiring
 * — the filesystem is the source of truth and we write the files a person writes. Counting
 * follows a sharper one: it is **derived from the transcripts**, not recorded alongside them,
 * because a counter beside the record can disagree with the record and then the number on screen
 * slowly stops describing anything.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { addSkill, removeSkill, shelfReport, skillFile, skillUse, whySkillInvalid } from '../src/main/skills.js'
import { discoverWorkspace } from '../src/main/workspace.js'
import type { TimelineEntry } from '../src/shared/transcript/parse.js'

import { tempDir } from './temp-dir.js'

async function workspace(t: TestContext): Promise<string> {
  const root = await tempDir(t, 'office-skills-')
  await mkdir(join(root, '.claude', 'skills'), { recursive: true })
  return root
}

const brief = {
  id: 'write-a-brief',
  description: 'Turn a request into a dispatchable brief with a VERIFY condition.',
  body: '# Writing a brief\n\nObjective, output, tools, boundaries.',
}

type ToolEntry = Extract<TimelineEntry, { kind: 'tool' }>

const tool = (
  skill: string,
  timestamp: string,
  over: Partial<ToolEntry> = {},
): ToolEntry => ({
  kind: 'tool',
  uuid: `u-${skill}-${timestamp}`,
  timestamp,
  toolUseId: `t-${skill}-${timestamp}`,
  name: 'Skill',
  input: { skill },
  result: 'done',
  isError: false,
  settled: true,
  ...over,
})

test('a skill we add is discovered exactly as a hand-written one is', async (t) => {
  const root = await workspace(t)
  assert.equal((await addSkill(root, brief)).ok, true)

  const found = await discoverWorkspace(root)
  const skill = found.skills.find((s) => s.id === 'write-a-brief')

  assert.ok(skill, 'discovery did not see the skill we just wrote')
  assert.match(skill.description, /dispatchable brief/)
  assert.deepEqual(found.problems, [])
})

test('adding never overwrites, and says which name collided', async (t) => {
  const root = await workspace(t)
  await addSkill(root, brief)
  const second = await addSkill(root, { ...brief, body: 'Something else.' })

  assert.equal(second.ok, false)
  assert.match(second.ok === false ? second.reason : '', /already a skill called write-a-brief/)
  assert.match(await readFile(join(root, '.claude', 'skills', 'write-a-brief', 'SKILL.md'), 'utf8'), /Objective, output/)
})

test('a skill with no description is refused, because a description is how it gets chosen', async (t) => {
  const root = await workspace(t)
  const got = await addSkill(root, { ...brief, description: '  ' })
  assert.equal(got.ok, false)
  assert.match(got.ok === false ? got.reason : '', /how anybody decides to use this skill/)
})

test('names that cannot be a directory are refused with a reason', () => {
  assert.match(whySkillInvalid('../escape') ?? '', /slash or a dot/)
  assert.match(whySkillInvalid('Write A Brief') ?? '', /lowercase/)
  assert.equal(whySkillInvalid('record-progress'), null)
})

test('removing takes the whole directory, assets and all', async (t) => {
  // A skill is a directory and some ship files beside SKILL.md. Leaving those behind leaves a
  // directory discovery correctly ignores and a person correctly finds confusing.
  const root = await workspace(t)
  await addSkill(root, brief)
  await writeFile(join(root, '.claude', 'skills', 'write-a-brief', 'template.md'), 'a template')

  assert.equal((await removeSkill(root, 'write-a-brief')).ok, true)
  assert.equal((await discoverWorkspace(root)).skills.length, 0)

  const again = await removeSkill(root, 'write-a-brief')
  assert.equal(again.ok, false)
  assert.match(again.ok === false ? again.reason : '', /no skill called write-a-brief/)
})

test('the frontmatter we write is the frontmatter discovery expects', () => {
  const text = skillFile(brief)
  assert.match(text, /^---\nname: write-a-brief\ndescription: Turn a request/)
})

// ─────────────────────────────────────────────────────── counting, from the record ──

test('use is counted from the same event the floor walks somebody to the shelf on', () => {
  // One truth, two readers. A `Skill` tool call carrying `input.skill` is what the floor reads
  // and what this counts — so the number and the animation can never disagree.
  const uses = skillUse([
    tool('meet', '2026-08-20T09:00:00Z'),
    tool('record-progress', '2026-08-20T09:05:00Z'),
    tool('meet', '2026-08-20T09:10:00Z'),
  ])

  assert.deepEqual(uses, [
    { id: 'meet', count: 2, lastUsed: '2026-08-20T09:10:00Z' },
    { id: 'record-progress', count: 1, lastUsed: '2026-08-20T09:05:00Z' },
  ])
})

test('an invocation that never settled still counts', () => {
  // It happened. Whether it *finished* is a different question from whether it was used, and
  // counting only settled calls would under-count exactly the ones most worth looking at.
  const unsettled = tool('meet', '2026-08-20T09:00:00Z', { settled: false, result: null })
  assert.equal(skillUse([unsettled])[0]?.count, 1)
})

test('other tool calls are not skills', () => {
  const read = tool('meet', '2026-08-20T09:00:00Z', { name: 'Read', input: { file_path: 'x' } })
  assert.deepEqual(skillUse([read]), [])
})

test('a skill on the shelf that nobody has used is shown with zero, not hidden', () => {
  // The one somebody wrote and the manager never picks. Usually a description problem rather
  // than a skill problem, and invisible if the report only lists what ran.
  const report = shelfReport([{ id: 'meet' }, { id: 'never-used' }], [{ id: 'meet', count: 3, lastUsed: 't' }])

  assert.deepEqual(report, [
    { id: 'meet', count: 3, lastUsed: 't', onShelf: true },
    { id: 'never-used', count: 0, lastUsed: null, onShelf: true },
  ])
})

test('a skill that was used and then removed is still shown, marked as gone', () => {
  // Editing it out of the report would be editing the record. It happened; the shelf changed
  // afterwards; both are true and the second does not unmake the first.
  const report = shelfReport([{ id: 'meet' }], [
    { id: 'meet', count: 1, lastUsed: 't' },
    { id: 'deleted-one', count: 4, lastUsed: 't' },
  ])

  const gone = report.find((r) => r.id === 'deleted-one')
  assert.ok(gone, 'a use of a removed skill vanished from the report')
  assert.equal(gone.onShelf, false)
})

test('a skill whose directory differs from its declared name can be removed', async (t) => {
  /*
   * The `ariel` fault one entity over. `removeSkill` rebuilt the path as `skills/<id>/`, and the
   * id comes from `name:` inside the SKILL.md — two definitions of one fact, agreeing only while
   * every directory happens to be named after the skill inside it.
   *
   * Measured before the fix: a directory `dirname-here/` declaring `name: frontmatter-name` put
   * **frontmatter-name** on the shelf, and removing it answered "There is no skill called
   * frontmatter-name." The office showed something and then denied it existed.
   *
   * Both names really are live — Claude Code answers to the directory name *and* the frontmatter
   * name, measured against the installed CLI — so this is a skill somebody can invoke and could
   * not delete.
   */
  const root = await tempDir(t, 'office-skillname-')
  await mkdir(join(root, '.claude', 'skills', 'dirname-here'), { recursive: true })
  await writeFile(
    join(root, '.claude', 'skills', 'dirname-here', 'SKILL.md'),
    '---\nname: frontmatter-name\ndescription: Declares a different name than its folder.\n---\n\nDo the thing.\n',
    'utf8',
  )

  const shelf = await discoverWorkspace(root)
  assert.deepEqual(shelf.skills.map((s) => s.id), ['frontmatter-name'])

  const gone = await removeSkill(root, 'frontmatter-name')
  assert.equal(gone.ok, true, gone.ok ? '' : gone.reason)
  assert.match(gone.ok ? gone.path : '', /dirname-here$/, 'removed a path built from the shown name')
  assert.deepEqual((await discoverWorkspace(root)).skills, [])
})

test('removing a skill that is genuinely not there still says so', async (t) => {
  // The other side of the line. "There is no skill called X" has to stay true when it is true.
  const root = await tempDir(t, 'office-noskill-')
  const got = await removeSkill(root, 'nothing-here')
  assert.equal(got.ok, false)
  assert.match(got.ok ? '' : got.reason, /no skill called nothing-here/)
})
