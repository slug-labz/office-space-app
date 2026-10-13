/**
 * The disk-and-network half of hiring somebody a colleague maintains.
 *
 * `an-employee-somebody-else-maintains.test.ts` pins the decisions. This one runs them against
 * real directories and a real `git clone`, because the decisions are only worth anything if the
 * digests they compare come from the files a person would actually be looking at.
 *
 * The check that matters most is the last one: after taking their version, the copy must read as
 * *the same as theirs*. Updating the file and leaving the recorded hash where it was would make
 * every freshly-updated employee report *edited here* forever, and the report would be wrong
 * about the one thing it exists to be right about.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  browseSource,
  readFromSource,
  checkOnThem,
  digest,
  groupBySource,
  hireFrom,
  ourCopy,
  recordedHires,
  takeTheirs,
  whatFailureMeans,
} from '../src/main/hired-from.js'
import { standingOf, updateIsSafe, type Provenance } from '../src/shared/hired-from.js'

import { tempDir } from './temp-dir.js'

const TODAY = '2026-08-28'

/**
 * The network switch, on.
 *
 * Every call here is about what a source holds, so the switch is left on and the git cases still
 * clone. What the switch does is `every-way-out-is-switched-and-listed.test.ts`.
 */
const on = (): boolean => true

const REVIEW = `---
name: wren-review
description: Reviews PRs the way a senior engineer would.
tools: Read, Grep, Glob
---

Read the diff. Say what you would say in the review.
`

const RELEASE = `---
name: wren-release
description: Checks a release is ready.
---

Look at the changelog.
`

async function aSourceDirectory(t: TestContext): Promise<string> {
  const dir = await tempDir(t, 'office-test-source-')
  await mkdir(join(dir, 'agents'), { recursive: true })
  await writeFile(join(dir, 'agents', 'wren-review.md'), REVIEW)
  await writeFile(join(dir, 'agents', 'wren-release.md'), RELEASE)
  // The things a repo of agents also contains, and which are not colleagues.
  await writeFile(join(dir, 'README.md'), '# A colleague\'s agents\n\nClone this.\n')
  await writeFile(join(dir, 'LICENSE'), 'MIT\n')
  return dir
}

async function anOffice(t: TestContext): Promise<string> {
  const dir = await tempDir(t, 'office-test-root-')
  await mkdir(join(dir, '.claude', 'agents'), { recursive: true })
  return dir
}

test('a source offers its agents and not its README', async (t) => {
  const source = await aSourceDirectory(t)

  const result = await browseSource(source, 'directory', on)
  assert.ok('offered' in result, 'the directory opened')
  const ids = result.offered.map((o) => o.id).sort()
  assert.deepEqual(ids, ['wren-release', 'wren-review'])
  assert.equal(result.offered.find((o) => o.id === 'wren-review')?.file, 'agents/wren-review.md')
  assert.match(result.offered[0]!.description, /release is ready/)
})

test('a source that will not open is a problem, not an empty list of colleagues', async () => {
  const result = await browseSource(join(tmpdir(), 'office-test-nothing-here-at-all'), 'directory', on)
  assert.ok('problem' in result, 'absent is not empty')
  assert.match(result.problem, /ENOENT/)
})

test('hiring writes the file byte-for-byte and records where it came from', async (t) => {
  const source = await aSourceDirectory(t)
  const root = await anOffice(t)

  const browsed = await browseSource(source, 'directory', on)
  assert.ok('offered' in browsed)
  const review = browsed.offered.find((o) => o.id === 'wren-review')!
  const hired = await hireFrom(root, { kind: 'directory', at: source, file: review.file }, review, TODAY)
  assert.equal(hired.ok, true)

  const written = await readFile(join(root, '.claude', 'agents', 'wren-review.md'), 'utf8')
  assert.equal(written, REVIEW, 'the file is theirs, unaltered')
  assert.doesNotMatch(written, /hired-from|hiredAt|office-space/, 'nothing of ours is written into it')

  const records = await recordedHires(root)
  assert.equal(records.length, 1)
  assert.equal(records[0]!.hiredHash, digest(REVIEW))
  assert.equal(records[0]!.hiredAt, TODAY)
})

test('hiring somebody whose name is taken is refused, not resolved', async (t) => {
  const source = await aSourceDirectory(t)
  const root = await anOffice(t)
  await writeFile(join(root, '.claude', 'agents', 'wren-review.md'), 'our own, entirely different\n')

  const browsed = await browseSource(source, 'directory', on)
  assert.ok('offered' in browsed)
  const review = browsed.offered.find((o) => o.id === 'wren-review')!
  const hired = await hireFrom(root, { kind: 'directory', at: source, file: review.file }, review, TODAY)

  assert.equal(hired.ok, false)
  assert.match((hired as { reason: string }).reason, /already has somebody called wren-review/)
  assert.equal(
    await readFile(join(root, '.claude', 'agents', 'wren-review.md'), 'utf8'),
    'our own, entirely different\n',
    'and the agent that was already here is untouched',
  )
})

/*
 * The four states, driven by actually editing the files.
 *
 * Each half is moved independently, which is the only way to show the two fields are reading two
 * different things rather than one thing twice.
 */
test('editing either copy moves exactly one of the two facts', async (t) => {
  const source = await aSourceDirectory(t)
  const root = await anOffice(t)

  const browsed = await browseSource(source, 'directory', on)
  assert.ok('offered' in browsed)
  const review = browsed.offered.find((o) => o.id === 'wren-review')!
  const where = { kind: 'directory' as const, at: source, file: review.file }
  await hireFrom(root, where, review, TODAY)
  const record = (await recordedHires(root))[0]!

  const standing = async () =>
    standingOf(record, await ourCopy(root, 'wren-review'), (await checkOnThem([record], on)).get('wren-review') ?? null)

  assert.deepEqual(await standing(), { here: 'as-hired', there: 'as-hired' }, 'fresh from the source')

  await writeFile(join(source, 'agents', 'wren-review.md'), `${REVIEW}\nAnd check the tests.\n`)
  assert.deepEqual(await standing(), { here: 'as-hired', there: 'moved-on' }, 'the colleague edited theirs')
  assert.equal(updateIsSafe(await standing()), true)

  await writeFile(join(root, '.claude', 'agents', 'wren-review.md'), `${REVIEW}\nAnd our house style.\n`)
  assert.deepEqual(await standing(), { here: 'edited', there: 'moved-on' }, 'and now both have')
  assert.equal(updateIsSafe(await standing()), false, 'so it is not a one-click action')
})

test('a file deleted at the source is withdrawn; a source that will not open is unreachable', async (t) => {
  const source = await aSourceDirectory(t)
  const root = await anOffice(t)

  const browsed = await browseSource(source, 'directory', on)
  assert.ok('offered' in browsed)
  const review = browsed.offered.find((o) => o.id === 'wren-review')!
  await hireFrom(root, { kind: 'directory', at: source, file: review.file }, review, TODAY)
  const record = (await recordedHires(root))[0]!

  await rm(join(source, 'agents', 'wren-review.md'))
  assert.equal((await checkOnThem([record], on)).get('wren-review')?.seen, false)
  assert.equal(
    standingOf(record, await ourCopy(root, 'wren-review'), (await checkOnThem([record], on)).get('wren-review')!).there,
    'withdrawn',
    'the source opened and the file was not in it',
  )

  const gone: Provenance = { ...record, source: { ...record.source, at: join(tmpdir(), 'office-test-vanished') } }
  assert.equal(
    standingOf(gone, await ourCopy(root, 'wren-review'), (await checkOnThem([gone], on)).get('wren-review')!).there,
    'unreachable',
    'and the source that never opened says nothing about the file',
  )
})

/*
 * The write that is easy to forget.
 *
 * Taking their version has to move the recorded hash with it. Leave it behind and the employee
 * that was *just* brought level reads as edited-here from then on — a false claim about local
 * work, made by the feature whose whole job is telling the truth about that.
 */
test('taking their version leaves the copy reading as the same as theirs', async (t) => {
  const source = await aSourceDirectory(t)
  const root = await anOffice(t)

  const browsed = await browseSource(source, 'directory', on)
  assert.ok('offered' in browsed)
  const review = browsed.offered.find((o) => o.id === 'wren-review')!
  await hireFrom(root, { kind: 'directory', at: source, file: review.file }, review, TODAY)

  const theirNewVersion = `${REVIEW}\nAlso check the migration is reversible.\n`
  await writeFile(join(source, 'agents', 'wren-review.md'), theirNewVersion)

  const before = (await recordedHires(root))[0]!
  const standingBefore = standingOf(before, await ourCopy(root, 'wren-review'), (await checkOnThem([before], on)).get('wren-review')!)
  assert.equal(updateIsSafe(standingBefore), true)

  const took = await takeTheirs(root, before, theirNewVersion, '2026-09-01')
  assert.equal(took.ok, true)

  const after = (await recordedHires(root))[0]!
  const standingAfter = standingOf(after, await ourCopy(root, 'wren-review'), (await checkOnThem([after], on)).get('wren-review')!)
  assert.deepEqual(standingAfter, { here: 'as-hired', there: 'as-hired' }, 'level, and not reported as edited here')
  assert.equal(after.hiredAt, '2026-09-01', 'and the fixed point moved with it')
})

/* A real clone, so the git path is exercised by something other than its own type signature. */
test('a git source is cloned and read', async (t) => {
  const source = await aSourceDirectory(t)
  const root = await anOffice(t)
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: source, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } })
  git('init', '--quiet', '-b', 'main')
  git('-c', 'user.email=t@t', '-c', 'user.name=T', 'add', '-A')
  git('-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '--quiet', '-m', 'agents')

  const browsed = await browseSource(source, 'git', on)
  assert.ok('offered' in browsed, 'the clone succeeded')
  assert.deepEqual(browsed.offered.map((o) => o.id).sort(), ['wren-release', 'wren-review'])

  const review = browsed.offered.find((o) => o.id === 'wren-review')!
  assert.equal(review.hash, digest(REVIEW), 'the digest survives the clone')
  await hireFrom(root, { kind: 'git', at: source, file: review.file }, review, TODAY)
  const record = (await recordedHires(root))[0]!
  assert.deepEqual(
    standingOf(record, await ourCopy(root, 'wren-review'), (await checkOnThem([record], on)).get('wren-review')!),
    { here: 'as-hired', there: 'as-hired' },
  )
})

test('a git remote that does not exist fails instead of waiting for a password', async () => {
  const result = await browseSource('https://example.invalid/nobody/nothing.git', 'git', on)
  assert.ok('problem' in result, 'it gave up rather than prompting')
  assert.ok(result.problem.length > 0, 'and said why')
})

test('five employees from one repo is one clone', () => {
  const from = (id: string, at: string): Provenance => ({
    id,
    source: { kind: 'git', at, file: `agents/${id}.md` },
    hiredHash: 'x',
    hiredAt: TODAY,
  })
  const grouped = groupBySource([
    from('a', 'git@github.com:company/agents.git'),
    from('b', 'git@github.com:company/agents.git'),
    from('c', 'git@github.com:other/agents.git'),
    from('d', 'git@github.com:company/agents.git'),
  ])
  assert.equal(grouped.length, 2)
  assert.equal(grouped[0]!.wanted.length, 3)
  assert.equal(grouped[1]!.wanted.length, 1)
})

test('the two failures are decided by whether the source opened, not by which catch ran', () => {
  assert.equal(whatFailureMeans(true, 'ENOENT').why, 'withdrawn')
  assert.equal(whatFailureMeans(false, 'ENOENT').why, 'unreachable')
})

test('an unreadable record file loses the comparison, not the employee', async (t) => {
  const root = await anOffice(t)
  await mkdir(join(root, '.office-space'), { recursive: true })
  await writeFile(join(root, '.office-space', 'hired-from.json'), '{ not json at all')
  await chmod(join(root, '.office-space', 'hired-from.json'), 0o644)
  assert.deepEqual(await recordedHires(root), [], 'no records, and no throw into the roster')
})

/*
 * The other half of that, and the expensive one.
 *
 * Shrugging at a broken record file is right for the *roster*, which only loses a comparison.
 * It is wrong for a *write*, because both writers rebuild the whole file from that same read —
 * so "no records" answered about a file nobody could parse turns one bad byte into the deletion
 * of every record in it, and reports `ok: true` while doing it.
 *
 * Hire eight from colleagues, have the file go bad, hire a ninth: the ninth used to be the only
 * one left. Checked with the whole file's bytes rather than with `recordedHires`, because the
 * point is what is on disk, not what the reader is willing to say about it.
 */
test('a record file that will not parse refuses the write instead of replacing it', async (t) => {
  const source = await aSourceDirectory(t)
  const root = await anOffice(t)

  const browsed = await browseSource(source, 'directory', on)
  assert.ok('offered' in browsed)
  const review = browsed.offered.find((o) => o.id === 'wren-review')!
  const release = browsed.offered.find((o) => o.id === 'wren-release')!

  const first = await hireFrom(root, { kind: 'directory', at: source, file: review.file }, review, TODAY)
  assert.equal(first.ok, true, 'the setup hire failed, so this test proves nothing')

  const recordPath = join(root, '.office-space', 'hired-from.json')
  const intact = await readFile(recordPath, 'utf8')
  await writeFile(recordPath, `${intact.slice(0, 40)}`, 'utf8') // truncated mid-write, as a crash leaves it

  const second = await hireFrom(root, { kind: 'directory', at: source, file: release.file }, release, TODAY)
  assert.equal(second.ok, false, 'the write went ahead against a file it could not read')
  assert.match(
    second.ok === false ? second.reason : '',
    /hired-from\.json/,
    'the refusal has to name the file a person is being asked to fix',
  )

  assert.equal(
    await readFile(recordPath, 'utf8'),
    `${intact.slice(0, 40)}`,
    'the record file was rewritten, so whatever it still held is gone',
  )

  // And nothing half-done: the refusal happens before the agent file, not after it, or the office
  // gains an employee it has no record of.
  await assert.rejects(
    () => readFile(join(root, '.claude', 'agents', 'wren-release.md'), 'utf8'),
    /ENOENT/,
    'the agent file was written even though the hire was refused',
  )
})

/*
 * The read behind "take their version", and its two ways of failing.
 *
 * `checkOnThem` hands back a digest; the write needs the bytes, and reads them again at the
 * moment it writes so the digest recorded afterwards is of what actually went to disk. Both
 * failures land in front of a person as a refusal, so both have to arrive as a `problem` rather
 * than as an exception through a handler built for a union.
 */
test('reading their file gives the bytes, and says why when it cannot', async (t) => {
  const source = await aSourceDirectory(t)
  const where = { kind: 'directory' as const, at: source, file: 'agents/wren-review.md' }

  const got = await readFromSource(where, on)
  assert.ok('content' in got, 'the file did not come back')
  assert.equal(got.content, REVIEW, 'and it is theirs, unaltered')

  // The file is gone from a source that still opens.
  await rm(join(source, 'agents', 'wren-review.md'))
  const missing = await readFromSource(where, on)
  assert.ok('problem' in missing)
  assert.match(missing.problem, /ENOENT/)

  // The source itself will not open. A different failure, and it must not throw either.
  const nowhere = await readFromSource({ ...where, at: join(tmpdir(), 'office-test-not-here-at-all') }, on)
  assert.ok('problem' in nowhere, 'an unopenable source threw instead of answering')
  assert.match(nowhere.problem, /ENOENT/)
})

test('a git source that cannot be cloned is a problem, not a hang and not a throw', async () => {
  const got = await readFromSource({ kind: 'git', at: 'https://example.invalid/none.git', file: 'a.md' }, on)
  assert.ok('problem' in got)
  assert.ok(got.problem.length > 0, 'and it says something')
})

/*
 * The sidecar, when several people are hired at once.
 *
 * The agent file is created with `wx`, so two hires can never both write one employee. The
 * provenance record is different: read, change one entry, write the whole file — the same shape
 * that lost six of twelve connectors when the calls overlapped, and both of them reported success.
 *
 * Losing an entry here does not lose the employee. It loses where they came from, which is the
 * whole feature: they stay on the floor and the office can no longer say whether the copy is still
 * theirs.
 */
test('hiring several at once records where every one of them came from', async (t) => {
  const source = await aSourceDirectory(t)
  const root = await anOffice(t)

  // Six from one source, hired together.
  const extra = ['a', 'b', 'c', 'd'].map((n) => `wren-${n}`)
  for (const id of extra) {
    await writeFile(join(source, 'agents', `${id}.md`), `---\nname: ${id}\ndescription: One of several.\n---\nBody.\n`)
  }
  const browsed = await browseSource(source, 'directory', on)
  assert.ok('offered' in browsed)
  assert.equal(browsed.offered.length, 6)

  const results = await Promise.all(
    browsed.offered.map((o) => hireFrom(root, { kind: 'directory', at: source, file: o.file }, o, TODAY)),
  )
  assert.deepEqual(results.filter((r) => !r.ok), [], 'every hire reported success')

  const recorded = await recordedHires(root)
  assert.deepEqual(
    recorded.map((r) => r.id).sort(),
    browsed.offered.map((o) => o.id).sort(),
    'so every hire must be in the record — an employee whose origin was lost is one the office can no longer check',
  )
})
