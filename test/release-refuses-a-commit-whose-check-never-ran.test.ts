/**
 * `scripts/release.mjs` refuses, rather than guesses — and this is where each refusal is held to it.
 *
 * The script's own header names the cases and the reasoning; the `EXIT` object maps each to a code,
 * and every test below asserts that code, the sentence the script says, and that nothing was tagged,
 * released or uploaded. A release script that merely *claims* to refuse is worse than none, because
 * the claim is what people trust instead of looking.
 *
 * ## Why a stand-in `gh`, and why that is the only honest way
 *
 * The one case the script exists for is a workflow run with `conclusion: success` and **zero
 * completed steps** — green because every job in it was skipped, so nobody checked anything. No
 * commit in this repository has such a run, and one cannot be manufactured on GitHub without
 * committing a deliberately skipped workflow and waiting for it. So the gate's central case can only
 * be exercised against a stand-in, and a stand-in is therefore not a shortcut here: it is the only
 * instrument that reaches the behaviour at all.
 *
 * Nothing here reaches GitHub and nothing here runs a build. The script shells out to `gh`, `git` and
 * `npm run dist` by name, so a `bin/` of stand-ins first on PATH is enough, and the script needed no
 * change to be testable. The stand-in `gh` answers the two API shapes the gate asks for out of
 * `GH_RUNS` and `GH_JOBS`, and **refuses `gh release create` while recording that it was asked** — so
 * a dry run that ever reached an upload fails here loudly rather than passing quietly.
 *
 * The accept path is always a `--dry-run`, which stops before the tag, the release and the upload.
 * Checked while writing these tests: in `release.mjs` the dry run's `process.exit(0)` is the last
 * statement before `git tag`, so no argument combination can reach a tag or an upload through it.
 *
 * ## The bug this found
 *
 * `execFileSync` returns **null**, not a string, when the child inherits our streams — so the
 * build's `run()` call threw a TypeError on `null.trim()`, `tryRun` caught it, and `npm run dist`
 * *succeeding* was reported as `failed (exit undefined)`. The script could not finish a release or
 * a dry run at all. Fixed in `run()`; the accept path below is what keeps it fixed.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, copyFile, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { closeSync, existsSync, ftruncateSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempDir } from './temp-dir.js'

const SCRIPT = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url))
const VERSION = '0.1.0'
const TAG = `v${VERSION}`
const SUMS = 'SHA256SUMS.txt'

/** The script refuses anything but Node 22 on purpose, so under another major there is nothing to test. */
const SKIP = process.platform === 'win32'
  ? 'the stand-in for npm is a POSIX shell script'
  : process.versions.node.split('.')[0] !== '22'
    ? `the script refuses Node ${process.versions.node} by design`
    : false

/**
 * The stand-in for `gh`. It answers the gate's two requests from `GH_RUNS` and `GH_JOBS`, already in
 * the shape the script's own `--jq` would have produced, records every call, and refuses anything
 * else by name rather than returning something plausible. `release` is recorded in `GH_RELEASED` as
 * well: no test here may reach an upload, and a mark on disk is how a test proves one did not happen.
 */
const GH = `#!${process.execPath}
'use strict'
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(process.env.GH_LOG, args.join(' ') + '\\n')
if (args[0] === 'release') {
  appendFileSync(process.env.GH_RELEASED, args.join(' ') + '\\n')
  process.stderr.write('stand-in gh: asked to ' + args.join(' ') + ', which no test here may reach\\n')
  process.exit(1)
}
const url = args[1] || ''
const jobs = url.match(/actions\\/runs\\/([^/?]+)\\/jobs/)
if (args[0] === 'api' && /actions\\/runs\\?/.test(url)) {
  process.stdout.write((process.env.GH_RUNS || '[]') + '\\n')
} else if (args[0] === 'api' && jobs) {
  process.stdout.write(JSON.stringify(JSON.parse(process.env.GH_JOBS || '{}')[jobs[1]] || []) + '\\n')
} else {
  process.stderr.write('stand-in gh: nothing here answers ' + args.join(' ') + '\\n')
  process.exit(1)
}
`

/** The stand-in for `npm run dist`: it records that it was asked, and builds nothing. */
const NPM = `#!/bin/sh
printf '%s\\n' "$*" >> "$NPM_LOG"
echo "stand-in npm: $*"
exit 0
`

/** Hooks off and no signing: this machine's hooks rewrite a graph on commit and would dirty the fixture. */
const FIXTURE_GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false']

function gitIn(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', [...FIXTURE_GIT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' } })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

async function stub(path: string, body: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body)
  await chmod(path, 0o755)
}

interface Rig {
  /** Scratch outside the checkout: the stand-ins, their logs, and the origin. */
  base: string
  /** The checkout under test, holding a copy of the script. */
  root: string
  releaseDir: string
  ghLog: string
  npmLog: string
  /** Written only if `gh release create` was reached, which no test here allows. */
  released: string
  env: Record<string, string>
}

interface Run {
  id: number
  name: string
  status: string
  conclusion: string
  started: string
  updated: string
}

/** A run as the gate's `--jq` hands it over: the fields the script asks for, and nothing else. */
function aRun(over: Partial<Run> = {}): Run {
  return { id: 7, name: 'checks', status: 'completed', conclusion: 'success', started: '2026-10-01T02:11:40Z', updated: '2026-10-01T02:15:55Z', ...over }
}

function withRuns(runs: Run[], jobs: Record<number, { name: string; conclusion: string; steps: number }[]>): Record<string, string> {
  return { GH_RUNS: JSON.stringify(runs), GH_JOBS: JSON.stringify(jobs) }
}

/**
 * What the gate is meant to let through: one run, green, two jobs, 35 steps, 255 seconds — the shape
 * of a real run here, where the refusals of September took 3 to 5 seconds and no steps at all. It is
 * the rig's default, so that in every other test the thing under test is the only thing refusing.
 */
const A_RUN_THAT_RAN = withRuns([aRun()], {
  7: [{ name: 'typecheck, build, tests', conclusion: 'success', steps: 23 }, { name: 'dist', conclusion: 'success', steps: 12 }],
})
const TABLE_LINE = '  checks: completed/success · 2 job(s) · 35 step(s) · 255s'

async function aRepo(t: TestContext, { version = VERSION } = {}): Promise<Rig> {
  const base = await realpath(await tempDir(t, 'office-release-'))
  const root = join(base, 'repo')
  await mkdir(join(root, 'scripts'), { recursive: true })
  await copyFile(SCRIPT, join(root, 'scripts', 'release.mjs'))
  await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: 'office-space', version }, null, 2)}\n`)
  await writeFile(join(root, 'README'), 'a fixture\n')
  // Where electron-builder writes, and not committed — so the notes and sums a run leaves there do
  // not make the tree dirty for the next run in the same fixture.
  await writeFile(join(root, '.gitignore'), 'release/\n')
  await mkdir(join(root, 'release'))
  await stub(join(base, 'bin', 'gh'), GH)
  await stub(join(base, 'bin', 'npm'), NPM)
  // The stand-in `gh` is CommonJS whatever sits above the temp directory, rather than whatever a
  // stray package.json up there would make it.
  await writeFile(join(base, 'bin', 'package.json'), '{ "type": "commonjs" }\n')
  gitIn(root, 'init', '-q', '--template=', '-b', 'main')
  gitIn(root, 'add', '-A')
  gitIn(root, 'commit', '-qm', 'fixture')
  const rig: Rig = {
    base,
    root,
    releaseDir: join(root, 'release'),
    ghLog: join(base, 'gh.log'),
    npmLog: join(base, 'npm.log'),
    released: join(base, 'released'),
    env: {},
  }
  rig.env = {
    PATH: `${join(base, 'bin')}${delimiter}${process.env['PATH'] ?? ''}`,
    GH_LOG: rig.ghLog,
    GH_RELEASED: rig.released,
    NPM_LOG: rig.npmLog,
    GIT_ALLOW_PROTOCOL: 'file',
    ...A_RUN_THAT_RAN,
  }
  return rig
}

/** An `origin` configured as GitHub's `o/r` that git reaches on disk, so `ls-remote` is answered locally. */
async function withOrigin(rig: Rig, url = 'https://github.com/o/r.git'): Promise<void> {
  const origin = join(rig.base, 'origin.git')
  gitIn(rig.base, 'init', '-q', '--bare', '--template=', origin)
  gitIn(rig.root, 'remote', 'add', 'origin', url)
  gitIn(rig.root, 'config', `url.${origin}.insteadOf`, url)
  gitIn(rig.root, 'push', '-q', 'origin', 'HEAD:refs/heads/main')
}

/**
 * A dmg the size electron-builder writes, without the 55 MB on disk: the file is sparse, so it costs
 * nothing to make and still hashes as 55 MB. `payload` is its name by default, so two artifacts never
 * share a hash and a notes file cannot satisfy both with one constant.
 */
function anArtifact(rig: Rig, name: string, { mb = 55 } = {}): { name: string; served: string; mb: string; sha256: string } {
  const path = join(rig.releaseDir, name)
  const fd = openSync(path, 'w')
  try {
    writeSync(fd, `payload for ${name}`)
    ftruncateSync(fd, Math.round(mb * 1048576))
  } finally {
    closeSync(fd)
  }
  return {
    name,
    served: name.replace(/ /g, '.'),
    mb: (statSync(path).size / 1048576).toFixed(1),
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  }
}

interface Ran {
  code: number | null
  stdout: string
  stderr: string
  /** Both streams, for a message that could come from either. */
  all: string
}

function run(rig: Rig, args: string[] = [], env: Record<string, string> = {}, node = process.execPath): Ran {
  // Each run gets its own logs, so `the build did not run` is answered by the run just made rather
  // than by an accepting one earlier in the same fixture. `released` is left to accumulate: an upload
  // anywhere in a test should fail every assertion after it, not just the next one.
  rmSync(rig.ghLog, { force: true })
  rmSync(rig.npmLog, { force: true })
  const r = spawnSync(node, [join(rig.root, 'scripts', 'release.mjs'), ...args], {
    cwd: rig.root,
    env: { ...process.env, ...rig.env, ...env },
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: `${r.stdout}\n${r.stderr}` }
}

async function lines(path: string): Promise<string[]> {
  if (!existsSync(path)) return []
  return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean)
}

/**
 * What a refusal must not have done. The tags are read from the checkout and from the origin, because
 * a release pushes the tag it makes; `tags` is what the test itself planted, so a test about an
 * existing tag can still say that no *new* one was cut.
 */
async function nothingWasReleased(rig: Rig, what: string, { tags = [] as string[], onOrigin = [] as string[] } = {}): Promise<void> {
  assert.deepEqual(gitIn(rig.root, 'tag', '-l').split('\n').filter(Boolean), tags, `${what}: the tags in the checkout are not the ones the test planted`)
  if (existsSync(join(rig.base, 'origin.git'))) {
    const remote = gitIn(rig.root, 'ls-remote', '--tags', 'origin').split('\n').filter(Boolean).map((l) => l.split('\t')[1] ?? l)
    assert.deepEqual(remote, onOrigin.map((tag) => `refs/tags/${tag}`), `${what}: a tag reached origin`)
  }
  assert.equal(existsSync(rig.released), false, `${what}: gh was asked to create a release`)
  const asked = await lines(rig.ghLog)
  assert.deepEqual(asked.filter((line) => !line.startsWith('api ')), [], `${what}: gh was asked for more than the gate`)
}

function nodeVersionOf(bin: string): string | null {
  const r = spawnSync(bin, ['-v'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

/**
 * A `node` that is not 22, for the one refusal that can only be made from outside Node 22. The majors
 * on this machine are 18 (the shell's default), 22 (pinned) and 24 (Homebrew); the siblings of the
 * node running this test cover an nvm-style layout, and `OFFICE_RELEASE_OTHER_NODE` covers the rest.
 */
function anotherNodeMajor(): { path: string; version: string } | null {
  const candidates: string[] = []
  const add = (p: string | undefined): void => {
    if (p !== undefined && !candidates.includes(p)) candidates.push(p)
  }
  add(process.env['OFFICE_RELEASE_OTHER_NODE'])
  const versions = join(process.execPath, '..', '..', '..')
  try {
    for (const entry of readdirSync(versions)) add(join(versions, entry, 'bin', 'node'))
  } catch {
    // Not a versioned layout; the absolute paths below are what is left.
  }
  add('/opt/homebrew/bin/node')
  add('/usr/local/bin/node')
  for (const path of candidates) {
    const version = nodeVersionOf(path)
    if (version !== null && !version.startsWith('v22.')) return { path, version }
  }
  return null
}

/* ------------------------------------------------------------ the argument errors */

test('an argument error is named as one, wherever you are standing', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  // A feature branch, because the two interesting cases are ones the branch check used to answer
  // first — "releases are cut from main" is true and is not what was wrong with what you typed.
  gitIn(rig.root, 'checkout', '-q', '-b', 'scripts/one-command-cuts-a-release')
  const head = gitIn(rig.root, 'rev-parse', 'HEAD')

  const cases = [
    { what: 'a flag it does not take', args: ['--version', VERSION, '--dry-rum'], says: /^release\.mjs: unknown argument "--dry-rum"\.$/m },
    { what: 'no --version at all', args: ['--dry-run'], says: /^release\.mjs: --version is required\.$/m },
    { what: '--version with nothing after it', args: ['--dry-run', '--version'], says: /^release\.mjs: --version needs a value, e\.g\. --version 0\.1\.0$/m },
    { what: 'a value that is not a version', args: ['--version', 'banana'], says: /^release\.mjs: banana is not a version\. Expected 1\.2\.3 or 1\.2\.3-rc\.1\.$/m },
    { what: '--sha outside a dry run', args: ['--version', VERSION, '--sha', head], says: /^release\.mjs: --sha is for --dry-run only\.$/m },
  ]
  for (const c of cases) {
    const r = run(rig, c.args)
    assert.equal(r.code, 2, `${c.what}: ${r.all}`)
    assert.match(r.stderr, c.says, c.what)
    // The branch is wrong too, and saying so instead would answer a question nobody asked.
    assert.doesNotMatch(r.all, /releases are cut from main/, `${c.what}: answered about the branch rather than the argument`)
    await nothingWasReleased(rig, c.what)
  }
  // Nothing in an argument error asks GitHub anything, so the gate never ran either.
  assert.deepEqual(await lines(rig.ghLog), [], 'an argument error reached the gate')
  assert.deepEqual(await lines(rig.npmLog), [], 'an argument error reached the build')
})

/* ----------------------------------------------------------------------- Node 22 */

test('another Node major is refused before anything is measured', { skip: SKIP }, async (t) => {
  const other = anotherNodeMajor()
  if (other === null) {
    t.skip('no node of another major on this machine, so the refusal cannot be exercised')
    return
  }
  const rig = await aRepo(t)
  await withOrigin(rig)
  anArtifact(rig, `Office Space-${VERSION}.dmg`)

  const r = run(rig, ['--version', VERSION, '--dry-run'], {}, other.path)
  assert.equal(r.code, 3, `on ${other.version}: ${r.all}`)
  assert.match(r.stderr, new RegExp(`^release\\.mjs: running on Node ${other.version.slice(1).replace(/\./g, '\\.')}; this build is pinned to 22\\.$`, 'm'))
  assert.deepEqual(await lines(rig.ghLog), [], 'a run on the wrong Node major asked GitHub about the commit')
  assert.deepEqual(await lines(rig.npmLog), [], 'a run on the wrong Node major started a build')
  await nothingWasReleased(rig, `on ${other.version}`)

  // The same command on Node 22 goes through, so the major was the only thing in the way.
  assert.equal(run(rig, ['--version', VERSION, '--dry-run']).code, 0)
})

/* ------------------------------------------------------------------- a dirty tree */

test('a dirty tree is refused even for a dry run, and graphify-out alone is not dirty', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  anArtifact(rig, `Office Space-${VERSION}.dmg`)
  assert.equal(run(rig, ['--version', VERSION, '--dry-run']).code, 0, 'the clean fixture does not pass on its own')

  await writeFile(join(rig.root, 'not-committed.txt'), 'written after the commit\n')
  const dirty = run(rig, ['--version', VERSION, '--dry-run'])
  assert.equal(dirty.code, 4, dirty.all)
  assert.match(dirty.stderr, /^release\.mjs: 1 uncommitted change\(s\)\. A release has to describe a commit\.$/m)
  assert.match(dirty.stderr, /^ {2}\?\? not-committed\.txt$/m, 'the refusal does not name what was uncommitted')
  assert.deepEqual(await lines(rig.npmLog), [], 'a dirty tree was built')
  await nothingWasReleased(rig, 'a dirty tree')

  // Asked for, it goes through: the dirty tree was the only thing in the way.
  const allowed = run(rig, ['--version', VERSION, '--dry-run', '--allow-dirty'])
  assert.equal(allowed.code, 0, allowed.all)

  await rm(join(rig.root, 'not-committed.txt'))
  await mkdir(join(rig.root, 'graphify-out'))
  await writeFile(join(rig.root, 'graphify-out', 'GRAPH_REPORT.md'), 'regenerated by a hook\n')
  const graph = run(rig, ['--version', VERSION, '--dry-run'])
  assert.equal(graph.code, 0, `graphify-out/ alone counted as dirty: ${graph.all}`)
  await nothingWasReleased(rig, 'graphify-out alone')
})

/* ----------------------------------------------------------------------- the branch */

test('a release is cut from main, and a dry run from anywhere', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  anArtifact(rig, `Office Space-${VERSION}.dmg`)
  gitIn(rig.root, 'checkout', '-q', '-b', 'scripts/one-command-cuts-a-release')

  const r = run(rig, ['--version', VERSION])
  assert.equal(r.code, 5, r.all)
  assert.match(r.stderr, /^release\.mjs: on scripts\/one-command-cuts-a-release, and releases are cut from main\.$/m)
  assert.deepEqual(await lines(rig.npmLog), [], 'a release was built off main')
  await nothingWasReleased(rig, 'off main')

  const dry = run(rig, ['--version', VERSION, '--dry-run'])
  assert.equal(dry.code, 0, `--dry-run does not work off main: ${dry.all}`)
  assert.match(dry.stdout, /^Office Space v0\.1\.0 — [0-9a-f]{7} on scripts\/one-command-cuts-a-release \(dry run\)$/m)
  await nothingWasReleased(rig, 'a dry run off main')
})

/* ---------------------------------------------------------------------- the version */

test('a version package.json does not agree with is refused, before the branch it is standing on', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  gitIn(rig.root, 'checkout', '-q', '-b', 'scripts/one-command-cuts-a-release')

  const r = run(rig, ['--version', '9.9.9'])
  assert.equal(r.code, 6, r.all)
  assert.match(r.stderr, /^release\.mjs: package\.json says 0\.1\.0, you asked for 9\.9\.9\.$/m)
  // Off main and asking for a version nobody has: the version is the one it answers about.
  assert.doesNotMatch(r.all, /releases are cut from main/, 'answered about the branch rather than the version')
  await nothingWasReleased(rig, 'a version package.json does not have')
})

/* -------------------------------------------------------------------------- the tag */

test('a tag that already exists is refused, locally or on origin', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  anArtifact(rig, `Office Space-${VERSION}.dmg`)

  gitIn(rig.root, 'tag', TAG)
  const local = run(rig, ['--version', VERSION])
  assert.equal(local.code, 7, local.all)
  assert.match(local.stderr, /^release\.mjs: v0\.1\.0 already exists \(locally\)\.$/m)
  assert.deepEqual(await lines(rig.npmLog), [], 'a release over an existing tag was built')
  await nothingWasReleased(rig, 'a tag that exists locally', { tags: [TAG] })

  // On origin and not here: the question has to be asked of the remote, not just of the checkout.
  gitIn(rig.root, 'push', '-q', 'origin', TAG)
  gitIn(rig.root, 'tag', '-d', TAG)
  const remote = run(rig, ['--version', VERSION])
  assert.equal(remote.code, 7, remote.all)
  assert.match(remote.stderr, /^release\.mjs: v0\.1\.0 already exists \(on origin\)\.$/m)
  assert.deepEqual(await lines(rig.npmLog), [], 'a release over a tag on origin was built')
  await nothingWasReleased(rig, 'a tag that exists on origin', { onOrigin: [TAG] })
})

/* ------------------------------------------------- the gate: what the stand-in is for */

test('a commit with no workflow run at all is refused', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  anArtifact(rig, `Office Space-${VERSION}.dmg`)

  const r = run(rig, ['--version', VERSION, '--dry-run'], withRuns([], {}))
  assert.equal(r.code, 8, r.all)
  assert.match(r.stderr, /^release\.mjs: no workflow run exists for [0-9a-f]{7}\.$/m)
  assert.deepEqual(await lines(rig.npmLog), [], 'a commit with no run was built')
  await nothingWasReleased(rig, 'no run at all')
})

test('a run that succeeded with zero completed steps is a refusal wearing green, and is refused', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  anArtifact(rig, `Office Space-${VERSION}.dmg`)

  // Green, and nobody checked anything: every job in it was skipped, so no step ever completed.
  // This shape exists on no commit in this repository, which is the whole reason for the stand-in.
  const skipped = withRuns([aRun({ started: '2026-10-01T02:11:40Z', updated: '2026-10-01T02:11:44Z' })], {
    7: [{ name: 'typecheck, build, tests', conclusion: 'skipped', steps: 0 }],
  })
  const r = run(rig, ['--version', VERSION, '--dry-run'], skipped)
  assert.equal(r.code, 8, r.all)
  assert.match(r.stderr, /^release\.mjs: nothing on [0-9a-f]{7} is a passing run that actually ran steps\.$/m)
  assert.match(r.stderr, /^A run that succeeded with 0 steps is a refusal wearing green/m)
  // The step count and the duration are both printed, because 4 seconds is the other free signal.
  assert.ok(r.stderr.split('\n').includes('  checks: completed/success · 1 job(s) · 0 step(s) · 4s'), `the table does not name 0 steps and 4s:\n${r.stderr}`)
  assert.deepEqual(await lines(rig.npmLog), [], 'a commit whose green check never ran was built')
  await nothingWasReleased(rig, 'green with no steps')

  // The same run, with steps, goes through: the step count is the whole difference.
  const withSteps = withRuns([aRun({ started: '2026-10-01T02:11:40Z', updated: '2026-10-01T02:11:44Z' })], {
    7: [{ name: 'typecheck, build, tests', conclusion: 'success', steps: 1 }],
  })
  assert.equal(run(rig, ['--version', VERSION, '--dry-run'], withSteps).code, 0, 'one completed step was not enough')
})

test('a failed run is refused even when another run on the same commit is green with no steps', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  anArtifact(rig, `Office Space-${VERSION}.dmg`)

  // What 2026-10-01 looked like: the real workflow refused in seconds, and something else went green
  // without running anything. Neither is a check, and the pair must not add up to one.
  const mixed = withRuns(
    [
      aRun({ id: 7, name: 'checks', conclusion: 'failure', started: '2026-10-01T02:11:40Z', updated: '2026-10-01T02:11:45Z' }),
      aRun({ id: 8, name: 'graph', conclusion: 'success', started: '2026-10-01T02:11:40Z', updated: '2026-10-01T02:11:43Z' }),
    ],
    {
      7: [{ name: 'typecheck, build, tests', conclusion: 'failure', steps: 4 }],
      8: [{ name: 'graph', conclusion: 'skipped', steps: 0 }],
    },
  )
  const r = run(rig, ['--version', VERSION, '--dry-run'], mixed)
  assert.equal(r.code, 8, r.all)
  assert.match(r.stderr, /^release\.mjs: nothing on [0-9a-f]{7} is a passing run that actually ran steps\.$/m)
  const table = r.stderr.split('\n')
  assert.ok(table.includes('  checks: completed/failure · 1 job(s) · 4 step(s) · 5s'), `the failed run is not in the table:\n${r.stderr}`)
  assert.ok(table.includes('  graph: completed/success · 1 job(s) · 0 step(s) · 3s'), `the green run with no steps is not in the table:\n${r.stderr}`)
  assert.deepEqual(await lines(rig.npmLog), [], 'a commit whose only green run ran nothing was built')
  await nothingWasReleased(rig, 'a failure beside a green with no steps')
})

test('a successful run with steps is accepted, and the table names the jobs, the steps and the duration', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  const dmg = anArtifact(rig, `Office Space-${VERSION}.dmg`)

  const r = run(rig, ['--version', VERSION, '--dry-run'])
  assert.equal(r.code, 0, r.all)
  assert.match(r.stdout, /^Checks on [0-9a-f]{7} — measured, not assumed:$/m)
  assert.ok(r.stdout.split('\n').includes(TABLE_LINE), `the table does not name the jobs, the steps and the duration:\n${r.stdout}`)
  assert.match(r.stdout, /^Building \(npm run dist\) …$/m)
  assert.deepEqual(await lines(rig.npmLog), ['run dist'], 'the accept path did not run the build')
  assert.match(r.stdout, /^Dry run: no tag, no release, no upload\. v0\.1\.0 was not created\.$/m)
  await nothingWasReleased(rig, 'the accept path')

  // What ran is in the notes too, from the same measurement rather than from a second guess.
  const notes = await readFile(join(rig.releaseDir, `notes-${TAG}.md`), 'utf8')
  assert.match(notes, /^`checks` passed in 255 s over 35 steps, on `[0-9a-f]{7}`\.$/m)
  assert.ok(notes.includes(`| \`${dmg.served}\` | ${dmg.mb} MB | \`${dmg.sha256}\` |`), `the notes table is not what is on disk:\n${notes}`)
})

/* ---------------------------------------------------------------------- the artifacts */

test('nothing to release, and an artifact too small to be the build, are both refused', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)

  const none = run(rig, ['--version', VERSION, '--dry-run'])
  assert.equal(none.code, 9, none.all)
  assert.match(none.stderr, /^release\.mjs: no artifacts in .*[/\\]release\. Nothing to release\.$/m)
  await nothingWasReleased(rig, 'no artifacts')

  const half = anArtifact(rig, `Office Space-${VERSION}.dmg`, { mb: 12 })
  const small = run(rig, ['--version', VERSION, '--dry-run'])
  assert.equal(small.code, 9, small.all)
  assert.match(small.stderr, /^release\.mjs: 1 artifact\(s\) under 50MB — the build half-finished\.$/m)
  assert.ok(small.stderr.split('\n').includes(`  ${half.name}  12.0 MB`), `the refusal does not name the artifact and its size:\n${small.stderr}`)
  assert.equal(existsSync(join(rig.releaseDir, SUMS)), false, 'a half-finished build was given a checksums file')
  await nothingWasReleased(rig, 'an artifact under 50MB')

  // The same artifact at the size a build really is goes through: the size was the only thing wrong.
  await rm(join(rig.releaseDir, half.name))
  anArtifact(rig, `Office Space-${VERSION}.dmg`)
  assert.equal(run(rig, ['--version', VERSION, '--dry-run']).code, 0)
})

/* -------------------------------------------------- the names and hashes in the notes */

test('the notes name the files GitHub serves, and carry the hash of each file on disk', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  // `v0.0.1`'s notes named files with spaces in them, which GitHub does not serve. Two artifacts, so
  // that no single constant can stand in for both hashes.
  const arm = anArtifact(rig, `Office Space-${VERSION}-arm64.dmg`)
  const dmg = anArtifact(rig, `Office Space-${VERSION}.dmg`)
  assert.notEqual(arm.sha256, dmg.sha256, 'the two artifacts hash the same, so the test cannot tell a real hash from a constant')

  const r = run(rig, ['--version', VERSION, '--dry-run'])
  assert.equal(r.code, 0, r.all)
  assert.equal(arm.served, `Office.Space-${VERSION}-arm64.dmg`)
  assert.equal(dmg.served, `Office.Space-${VERSION}.dmg`)

  const sums = await readFile(join(rig.releaseDir, SUMS), 'utf8')
  assert.deepEqual(sums.trimEnd().split('\n'), [`${arm.sha256}  ${arm.served}`, `${dmg.sha256}  ${dmg.served}`])

  const notes = await readFile(join(rig.releaseDir, `notes-${TAG}.md`), 'utf8')
  for (const a of [arm, dmg]) {
    assert.ok(notes.includes(`| \`${a.served}\` | ${a.mb} MB | \`${a.sha256}\` |`), `the notes do not carry ${a.served} and its hash:\n${notes}`)
  }
  assert.doesNotMatch(notes, /Office Space-0\.1\.0/, 'the notes name a file with a space in it, which GitHub does not serve')
  assert.ok(notes.includes(`shasum -a 256 -c ${SUMS}`), 'the notes do not say how to check the hashes')
  await nothingWasReleased(rig, 'the notes')
})
