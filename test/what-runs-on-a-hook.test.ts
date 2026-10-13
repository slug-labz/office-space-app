/**
 * The hooks surface, driven against real files.
 *
 * The distinctions this feature exists to keep are all *disagreements* — between what a settings
 * file registers and what is on disk — and every one of them collapses into "no hooks" if
 * something is wrong. So the tests below are mostly about the states that are **not** the happy
 * one: a directory that will not open, a settings file that will not parse, a registration whose
 * file has been deleted, and a file nothing registers.
 *
 * Two rules govern what is asserted:
 *
 *   **Absent is not empty.** `CLAUDE.md`'s fourth standing order. A hooks directory that would
 *   not open must never produce the same report as a workspace with no hooks, and a registration
 *   whose file could not be checked must never be reported as missing. Those are asserted as
 *   inequalities as well as equalities — it is not enough that `unknown` is right, it has to be
 *   *distinguishable*, because the bug this prevents is two states rendering alike.
 *
 *   **A fixture is not a filesystem.** Everything here writes real files into a real temporary
 *   directory and reads them back. The dedupe test below exists because of a fault that no mock
 *   could have produced: a workspace whose root is the home directory reads one file twice.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { hashOf } from '../src/main/reconcile.js'
import { readHooks } from '../src/main/hooks.js'
import {
  buildReport,
  describeEvent,
  describeMatcher,
  fileNamedBy,
  hooksLede,
  registrationsIn,
  type HookFile,
  type HookSource,
} from '../src/shared/hooks.js'

import { tempDir } from './temp-dir.js'

/**
 * A manifest the test writes, rather than the one the build leaves in `dist/`.
 *
 * The first version of this file read `dist/shipped-hashes.json` directly and **passed here and
 * failed in CI**: `.github/workflows/checks.yml` runs the tests *before* it builds, so `dist/`
 * does not exist yet, the manifest is unreadable, and provenance correctly falls to `unknown`.
 * The code was right and the test was asserting against a file that had not been created.
 *
 * That ordering is deliberate — it is what stops a test depending on build output — and it caught
 * this repository twice in one day, in `5a6ca0c` and here. So the fix is not to reorder CI. It is
 * for the test to own the input it is making claims about: the workspace is a real directory with
 * real files in it, and the manifest is constructed beside them, which is the only part of this
 * that a build would otherwise have to provide.
 *
 * `hashOf` is the app's own, so what is written here is a hash by the same definition
 * `reconcile.ts` and `scripts/build.mjs` use. A manifest written with a different hash function
 * would make every one of these tests pass while proving nothing.
 */
async function manifestNaming(root: string, files: Record<string, readonly string[]>): Promise<string> {
  const entries = Object.entries(files).map(([name, versions]) => [
    `.claude/hooks/${name}`,
    { hashes: versions.map(hashOf), current: hashOf(versions[versions.length - 1] ?? '') },
  ])
  const path = join(root, 'manifest.json')
  await writeFile(path, JSON.stringify({ generatedAt: '2026-09-02', files: Object.fromEntries(entries) }))
  return path
}

/**
 * The manifest for a test that is not about provenance.
 *
 * Names nothing, so every hook file reads as `yours` — a definite answer rather than the
 * `unknown` an absent manifest would give. These tests are about wiring, and a deterministic
 * input is what keeps a provenance change from failing them for the wrong reason.
 */
async function plainManifest(root: string): Promise<string> {
  return manifestNaming(root, {})
}

const GATE = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/approval-gate.mjs"'

/** A workspace, and nothing of anybody's in it. Removed when `t` ends. */
async function workspace(t: TestContext): Promise<string> {
  return tempDir(t, 'hooks-test-')
}

async function withSettings(root: string, settings: unknown, file = 'settings.json'): Promise<void> {
  await mkdir(join(root, '.claude'), { recursive: true })
  await writeFile(join(root, '.claude', file), typeof settings === 'string' ? settings : JSON.stringify(settings))
}

async function withHookFile(root: string, name: string, body = '#!/usr/bin/env node\n'): Promise<void> {
  await mkdir(join(root, '.claude', 'hooks'), { recursive: true })
  await writeFile(join(root, '.claude', 'hooks', name), body)
}

const gateSettings = {
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: GATE, timeout: 300 }] }] },
}

// ─────────────────────────────────────────────────────────────────── the four wirings ──

test('a registered hook whose file is there is wired', async (t) => {
  const root = await workspace(t)
  await withSettings(root, gateSettings)
  await withHookFile(root, 'approval-gate.mjs')

  const report = await readHooks(root, { home: '/nonexistent-home', manifestPath: await plainManifest(root) })

  assert.equal(report.hooks.length, 1)
  assert.equal(report.hooks[0]?.wiring.state, 'wired')
  assert.equal(report.inert.length, 0)
  assert.equal(report.directoryProblem, null)
})

test('a registration naming a file that is not there is file-missing, not inert and not unknown', async (t) => {
  // The dangerous one. Settings promise a `PreToolUse` gate and there is nothing to run, so every
  // Bash call goes through unapproved while the workspace looks gated to anybody reading settings.
  const root = await workspace(t)
  await withSettings(root, gateSettings)

  const report = await readHooks(root, { home: '/nonexistent-home', manifestPath: await plainManifest(root) })

  assert.equal(report.hooks[0]?.wiring.state, 'file-missing')
  assert.match(hooksLede(report), /will fail when it fires/)
})

test('a hook file nothing registers is inert — the bug this repo shipped for weeks', async (t) => {
  // `approval-gate.mjs` sat in `.claude/hooks/` beside 133 lines of `approvals.ts` waiting on it
  // and a panel built to answer it, while settings shipped `"hooks": {}`. Nothing fired and the
  // suite was green throughout. `repo-health.test.ts` now catches it for this repo at build time;
  // this is the check that a *user's* workspace can be told the same thing at runtime.
  const root = await workspace(t)
  await withSettings(root, { hooks: {} })
  await withHookFile(root, 'approval-gate.mjs')

  const report = await readHooks(root, { home: '/nonexistent-home', manifestPath: await plainManifest(root) })

  assert.equal(report.hooks.length, 0)
  assert.deepEqual(
    report.inert.map((f) => f.name),
    ['approval-gate.mjs'],
  )
  assert.match(hooksLede(report), /1 file in \.claude\/hooks\/ is never run/)
})

test('a hooks directory that will not open is unknown, and never reads as an absent file', async (t) => {
  const root = await workspace(t)
  await withSettings(root, gateSettings)
  await withHookFile(root, 'approval-gate.mjs')
  await chmod(join(root, '.claude', 'hooks'), 0o000)

  try {
    const report = await readHooks(root, { home: '/nonexistent-home', manifestPath: await plainManifest(root) })

    assert.equal(report.hooks[0]?.wiring.state, 'unknown')
    // The whole point: not the answer a deleted file would have produced.
    assert.notEqual(report.hooks[0]?.wiring.state, 'file-missing')
    assert.notEqual(report.directoryProblem, null)
    // And nothing claims the directory is empty, because we could not look in it.
    assert.equal(report.inert.length, 0)
    assert.doesNotMatch(hooksLede(report), /never run/)
  } finally {
    // Restored whatever the assertions did: the temp dir's removal cannot empty a directory it
    // cannot read.
    await chmod(join(root, '.claude', 'hooks'), 0o755)
  }
})

test('a command outside .claude/hooks/ is elsewhere, and is not reported as a fault', async (t) => {
  const root = await workspace(t)
  await withSettings(root, {
    hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'npx prettier --write .' }] }] },
  })

  const report = await readHooks(root, { home: '/nonexistent-home', manifestPath: await plainManifest(root) })

  assert.equal(report.hooks[0]?.wiring.state, 'elsewhere')
  assert.doesNotMatch(hooksLede(report), /will fail/)
})

// ──────────────────────────────────────────────────────────── settings that fail ──

test('settings that will not parse is not settings with no hooks', async (t) => {
  // Claude Code ignores a settings file that fails validation *silently* — its own `--help` says
  // so for `--print`. A trailing comma therefore turns off every hook in the file and nothing
  // anywhere mentions it. Reporting that as "no hooks" would make this panel the second thing
  // keeping the secret.
  const root = await workspace(t)
  await withSettings(root, '{ "hooks": { "PreToolUse": [ } }')

  const report = await readHooks(root, { home: '/nonexistent-home', manifestPath: await plainManifest(root) })

  assert.equal(report.sources[0]?.state, 'unparsable')
  assert.equal(report.incomplete, true)
  assert.match(hooksLede(report), /Nothing could be read that registers a hook/)
  // Never the sentence a genuinely clean workspace gets.
  assert.doesNotMatch(hooksLede(report), /^Nothing here runs on a hook$/)
})

test('a workspace with nothing at all says so, and only when every source was read', async (t) => {
  const root = await workspace(t)
  const report = await readHooks(root, { home: '/nonexistent-home', manifestPath: await plainManifest(root) })

  assert.equal(report.incomplete, false)
  assert.equal(hooksLede(report), 'Nothing here runs on a hook')
})

test('a settings file that exists and cannot be read is not a settings file with no hooks', async (t) => {
  const root = await workspace(t)
  await withSettings(root, gateSettings)
  await chmod(join(root, '.claude', 'settings.json'), 0o000)

  const report = await readHooks(root, { home: '/nonexistent-home', manifestPath: await plainManifest(root) })

  assert.equal(report.sources[0]?.state, 'unreadable')
  assert.equal(report.incomplete, true)

  await chmod(join(root, '.claude', 'settings.json'), 0o644)
})

// ───────────────────────────────────────────────────────────────────── the scopes ──

test('a hook in settings.local.json is listed, with the file it came from', async (t) => {
  const root = await workspace(t)
  await withSettings(root, { hooks: {} })
  await withSettings(root, gateSettings, 'settings.local.json')
  await withHookFile(root, 'approval-gate.mjs')

  const report = await readHooks(root, { home: '/nonexistent-home', manifestPath: await plainManifest(root) })

  assert.equal(report.hooks.length, 1)
  assert.equal(report.hooks[0]?.registration.scope, 'local')
  assert.match(report.hooks[0]?.registration.path ?? '', /settings\.local\.json$/)
})

test('a workspace whose root is the home directory reads one file once, not twice', async (t) => {
  /*
   * Found against a real directory, not a fixture.
   *
   * Somebody who opens the office on `~` makes `.claude/settings.json` both the project file and
   * the user file. Read once per role, the panel listed every hook in it twice and said "2 hooks
   * are registered here" about one. No mock produces this, because a mock is written by somebody
   * who already knows the three paths are different.
   */
  const root = await workspace(t)
  await withSettings(root, gateSettings)
  await withHookFile(root, 'approval-gate.mjs')

  const report = await readHooks(root, { home: root, manifestPath: await plainManifest(root) })

  assert.equal(report.hooks.length, 1)
  assert.equal(report.sources.filter((s) => s.path.endsWith('settings.json')).length, 1)
})

test('the user path is shown with the home abbreviated, so a screenshot carries no account name', async (t) => {
  const root = await workspace(t)
  const home = await workspace(t)
  await withSettings(home, gateSettings)

  const report = await readHooks(root, { home, manifestPath: await plainManifest(root) })

  const user = report.sources.find((s) => s.scope === 'user')
  assert.equal(user?.path, '~/.claude/settings.json')
  assert.ok(!user?.path.includes(home), 'the real home path must not reach the surface')
  // And the same substitution inside the command, which is where a home path also turns up.
  assert.ok(!report.hooks.some((h) => h.registration.command.includes(home)))
})

// ──────────────────────────────────────────────────────────────────── provenance ──

test('a hook we shipped reads as ours, and one byte of somebody’s edit does not', async (t) => {
  const root = await workspace(t)
  await withSettings(root, gateSettings)

  const originOf = async (manifestPath: string) => {
    const report = await readHooks(root, { home: '/nonexistent-home', manifestPath })
    const only = report.hooks[0]
    assert.equal(only?.wiring.state, 'wired', 'the join is wrong, so the provenance below is about nothing')
    return only?.wiring.state === 'wired' ? only.wiring.file.origin : null
  }

  const first = '#!/usr/bin/env node\n// v1\n'
  const second = '#!/usr/bin/env node\n// v2\n'

  // Matches the version this build ships.
  await withHookFile(root, 'approval-gate.mjs', second)
  assert.equal(await originOf(await manifestNaming(root, { 'approval-gate.mjs': [first, second] })), 'shipped')

  /*
   * Matches an *older* version we shipped, and is still ours.
   *
   * An office seeded from an earlier build holds a copy nobody has touched, and calling that
   * "edited" accuses somebody of a change they did not make. `reconcile.ts` uses the same rule to
   * decide what is safe to replace, which is why `hashes` is a list and not one value — and why
   * a test that only ever wrote a single-version manifest would pass without touching the reason
   * the field is shaped that way.
   */
  await withHookFile(root, 'approval-gate.mjs', first)
  assert.equal(await originOf(await manifestNaming(root, { 'approval-gate.mjs': [first, second] })), 'shipped')

  // One byte different from every version we ever shipped is somebody's edit.
  await withHookFile(root, 'approval-gate.mjs', second + '// changed\n')
  assert.equal(await originOf(await manifestNaming(root, { 'approval-gate.mjs': [first, second] })), 'shipped-edited')

  // A path no version of which has ever shipped. Answerable without reading the file at all.
  assert.equal(await originOf(await manifestNaming(root, { 'something-else.mjs': [first] })), 'yours')
})

test('a manifest that cannot be read costs provenance and nothing else', async (t) => {
  const root = await workspace(t)
  await withSettings(root, gateSettings)
  await withHookFile(root, 'approval-gate.mjs')

  const report = await readHooks(root, { home: '/nonexistent-home', manifestPath: '/nonexistent-manifest.json' })

  // Still listed, still wired. Only the question of who put it there goes unanswered — and it is
  // `unknown`, never `yours`: claiming somebody wrote a file we could not check against anything
  // is the same mistake as calling an unreadable directory empty.
  assert.equal(report.hooks.length, 1)
  const only = report.hooks[0]
  assert.equal(only?.wiring.state, 'wired')
  assert.equal(only?.wiring.state === 'wired' ? only.wiring.file.origin : null, 'unknown')
})

test('a markdown file in .claude/hooks/ is documentation, not an unregistered hook', async (t) => {
  const root = await workspace(t)
  await withSettings(root, { hooks: {} })
  await withHookFile(root, 'README.md', '# what lives here\n')

  const report = await readHooks(root, { home: '/nonexistent-home', manifestPath: await plainManifest(root) })

  assert.equal(report.inert.length, 0)
})

// ─────────────────────────────────────────────────────────────── the pure parsing ──

test('a malformed stanza costs its own row and not the rows beside it', () => {
  const registrations = registrationsIn(
    {
      hooks: {
        PreToolUse: [
          'not an object',
          { matcher: 'Bash', hooks: 'not an array' },
          { matcher: 'Bash', hooks: [{ type: 'command' }] },
          { matcher: 'Bash', hooks: [{ type: 'command', command: GATE }] },
        ],
      },
    },
    'project',
    '.claude/settings.json',
  )

  assert.equal(registrations.length, 1)
  assert.equal(registrations[0]?.command, GATE)
})

test('a matcher that is absent and a matcher that is empty both mean no matcher', () => {
  const from = (stanza: unknown) =>
    registrationsIn({ hooks: { PreToolUse: [stanza] } }, 'project', 'p')[0]?.matcher

  assert.equal(from({ hooks: [{ command: 'x' }] }), null)
  assert.equal(from({ matcher: '', hooks: [{ command: 'x' }] }), null)
  assert.equal(from({ matcher: '  ', hooks: [{ command: 'x' }] }), null)
  assert.equal(from({ matcher: 'Bash', hooks: [{ command: 'x' }] }), 'Bash')
})

test('a timeout that is a string is not a timeout, because the CLI reads a number', () => {
  const from = (timeout: unknown) =>
    registrationsIn({ hooks: { PreToolUse: [{ hooks: [{ command: 'x', timeout }] }] } }, 'project', 'p')[0]
      ?.timeoutSeconds

  assert.equal(from(300), 300)
  // Showing "300s" for a value the CLI ignores would hide a setting that is not in force.
  assert.equal(from('300'), null)
  assert.equal(from(undefined), null)
})

test('an unrecognised event is carried through rather than dropped', () => {
  const registrations = registrationsIn(
    { hooks: { SomethingNewInTheCli: [{ hooks: [{ command: 'x' }] }] } },
    'project',
    'p',
  )

  assert.equal(registrations.length, 1)
  assert.equal(registrations[0]?.event, 'SomethingNewInTheCli')
  assert.equal(describeEvent('SomethingNewInTheCli'), null)
  // And nothing is claimed about a matcher on an event we have just said we do not know.
  assert.equal(describeMatcher('SomethingNewInTheCli', null), 'declares no matcher')
})

test('a hook is found by its path, and a longer name is not matched by a shorter one', () => {
  assert.equal(fileNamedBy(GATE, []), 'approval-gate.mjs')
  // Names it by path while it is absent — which is the only way `file-missing` is reachable.
  assert.equal(fileNamedBy('node .claude/hooks/gone.mjs', ['other.mjs']), 'gone.mjs')
  assert.equal(fileNamedBy('bash run.sh', ['run.sh']), 'run.sh')
  assert.equal(fileNamedBy('node gate-v2.mjs', ['gate.mjs', 'gate-v2.mjs']), 'gate-v2.mjs')
  assert.equal(fileNamedBy('npx prettier --write .', ['gate.mjs']), null)
})

test('the empty lede is never said about a workspace that was not fully read', () => {
  const source = (state: HookSource['state']): HookSource => ({
    path: 'p',
    scope: 'project',
    state,
    cause: state === 'ok' || state === 'missing' ? null : 'because',
    registrations: 0,
  })

  assert.equal(hooksLede(buildReport([], [], null, [source('ok')])), 'Nothing here runs on a hook')
  // A file that would not parse means we have not established that nothing runs — only that we
  // could not find out. The two must not share a sentence.
  assert.match(hooksLede(buildReport([], [], null, [source('unparsable')])), /Nothing could be read/)
  assert.match(hooksLede(buildReport([], [], null, [source('unreadable')])), /Nothing could be read/)
})

test('an unreadable directory and an empty one do not produce the same report', () => {
  const files: HookFile[] = []
  const empty = buildReport([], files, null, [])
  const unreadable = buildReport([], null, 'it would not open', [])

  assert.notDeepEqual(empty, unreadable)
  assert.equal(empty.directoryProblem, null)
  assert.notEqual(unreadable.directoryProblem, null)
})

test('a stanza with no command is not drawn as a hook', () => {
  /*
   * The skip carries a comment saying why — *"a row with an empty command would be this panel
   * inventing a hook the file did not declare"* — and nothing held it. Found by mutating it away
   * while moving this walk: the empty-command check could be deleted and the whole suite stayed
   * green, including the gate's own differential test, because a blank command cannot contain a
   * filename and so the gate never notices either way.
   *
   * The panel does notice. It would draw a row for a hook that runs nothing.
   */
  const empty = registrationsIn({ hooks: { PreToolUse: [{ hooks: [{ command: '' }] }] } }, 'project', 'p')
  assert.deepEqual(empty, [], 'a stanza whose command is empty was drawn as a registration')

  const blank = registrationsIn({ hooks: { PreToolUse: [{ hooks: [{ command: '   ' }] }] } }, 'project', 'p')
  assert.deepEqual(blank, [], 'a stanza whose command is only whitespace was drawn as a registration')

  // And the one beside it still is. The skip must lose the empty stanza, not the file.
  const beside = registrationsIn(
    { hooks: { PreToolUse: [{ hooks: [{ command: '  ' }, { command: 'node real.mjs' }] }] } },
    'project',
    'p',
  )
  assert.deepEqual(
    beside.map((r) => r.command),
    ['node real.mjs'],
    'one blank command cost the reader the real hook beside it',
  )
})
