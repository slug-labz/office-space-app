/**
 * The harness.
 *
 * `CLAUDE.md` has said since the first commit that every task carries a VERIFY condition and
 * that the harness checks it. These tests are about the four outcomes — because collapsing
 * "nobody said the office may run this" or "there is nothing runnable here" into pass or fail
 * is a lie in one direction or the other, and both are worse than saying which it was.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { allVerified, checkProject, outcomeOf } from '../src/main/harness.js'
import { OFFICE_PROJECT } from '../src/shared/ipc.js'

import { tempDir } from './temp-dir.js'

/**
 * One level down inside the test's own temp dir, because the climbing test below plants a
 * `TASKS.md` in the workspace's parent. With the workspace at the top of the temp dir, that parent
 * was the shared temp dir itself, and every run left the file there.
 */
async function workspace(t: TestContext, tasks: string | null, allow: string[] = ['Bash(exit:*)', 'Bash(echo:*)'], deny: string[] = []): Promise<string> {
  const root = join(await tempDir(t, 'office-harness-'), 'office')
  await mkdir(join(root, '.claude'), { recursive: true })
  await writeFile(join(root, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow, deny } }))
  if (tasks !== null) {
    await mkdir(join(root, 'projects', 'billing'), { recursive: true })
    await writeFile(join(root, 'projects', 'billing', 'TASKS.md'), tasks)
  }
  return root
}

const table = (rows: string) =>
  `## In progress\n\n| # | Task | Owner | VERIFY |\n|---|---|---|---|\n${rows}\n`

test('a check the workspace allows is run, and passing is exit zero', async (t) => {
  const root = await workspace(t, table('| 1 | Ship it | builder | `exit 0` |'))

  const report = await checkProject(root, 'billing', { run: true, trusted: true })

  assert.equal(outcomeOf(report.checks[0]!), 'passed')
  assert.equal(report.checks[0]?.result?.exitCode, 0)
})

test('a failing check is failed, with its output kept', async (t) => {
  const root = await workspace(t, table('| 1 | Ship it | builder | `ls /definitely-not-here-xyzzy` |'), ['Bash(*)'])

  const report = await checkProject(root, 'billing', { run: true, trusted: true })

  assert.equal(outcomeOf(report.checks[0]!), 'failed')
  assert.match(report.checks[0]?.result?.output ?? '', /not-here-xyzzy/, 'a failure with no output is unactionable')
})

test('a chained VERIFY is never run unattended, even under Bash(*)', async (t) => {
  // The guard that matters. `exit 0 && rm -rf ~` starts with something allowed and is not it.
  // A person can still run it deliberately; the office will not do it on its own.
  const root = await workspace(t, table('| 1 | Ship it | builder | `exit 0 && echo chained` |'), ['Bash(*)'])

  const report = await checkProject(root, 'billing', { run: true, trusted: true })

  assert.equal(outcomeOf(report.checks[0]!), 'not-run')
  assert.equal(report.checks[0]?.verdict.state, 'unlisted')
})

test('a VERIFY with nothing runnable in it is uncheckable, not passing and not failing', async (t) => {
  const root = await workspace(t, table('| 1 | Looks right | frontend | somebody reads it |'))

  const report = await checkProject(root, 'billing', { run: true, trusted: true })

  assert.equal(outcomeOf(report.checks[0]!), 'uncheckable')
  assert.equal(report.checks[0]?.result, null)
})

test('a command nobody authorised is not run, and says so rather than failing', async (t) => {
  const root = await workspace(t, table('| 1 | Ship it | builder | `cargo test` |'))

  const report = await checkProject(root, 'billing', { run: true, trusted: true })

  assert.equal(outcomeOf(report.checks[0]!), 'not-run')
  assert.equal(report.checks[0]?.verdict.state, 'unlisted')
})

test('a person can run an unauthorised command by asking for it specifically', async (t) => {
  const root = await workspace(t, table('| 1 | Ship it | builder | `exit 0` |'), [])

  const listed = await checkProject(root, 'billing', { run: true, trusted: true })
  assert.equal(outcomeOf(listed.checks[0]!), 'not-run', 'not on its own')

  const forced = await checkProject(root, 'billing', { run: true, trusted: true, only: { row: 0, command: 'exit 0' }, force: true })
  assert.equal(outcomeOf(forced.checks[0]!), 'passed', 'but yes when somebody asks for that task')
})

test('a denied command stays denied even when somebody clicks it', async (t) => {
  // A click is not a licence to override what the workspace declared. If it should run, the
  // honest path is changing the rule that says it may not.
  const root = await workspace(t, table('| 1 | Clean up | builder | `rm -rf build` |'), ['Bash(*)'], ['Bash(rm:*)'])

  const report = await checkProject(root, 'billing', { run: true, trusted: true, only: { row: 0, command: 'rm -rf build' }, force: true })

  assert.equal(outcomeOf(report.checks[0]!), 'refused')
  assert.equal(report.checks[0]?.result, null, 'and nothing was run')
})

test('listing without running touches nothing', async (t) => {
  const root = await workspace(t, table('| 1 | Ship it | builder | `exit 0` |'))

  const report = await checkProject(root, 'billing')

  assert.equal(report.checks[0]?.result, null)
  assert.equal(outcomeOf(report.checks[0]!), 'not-run')
})

test('a task already done is reported and not re-run', async (t) => {
  const done = `## Done\n\n| # | Task | Owner | VERIFY | Completed |\n|---|---|---|---|---|\n| 1 | Ship it | builder | \`exit 1\` | 2026-08-19 |\n`
  const root = await workspace(t, done, ['Bash(*)'])

  const report = await checkProject(root, 'billing', { run: true, trusted: true })

  assert.equal(report.checks[0]?.result, null, 'the harness does not re-litigate finished work')
})

test('only the task asked for is run', async (t) => {
  const root = await workspace(t, table('| 1 | One | builder | `exit 0` |\n| 2 | Two | builder | `exit 0` |'))

  const report = await checkProject(root, 'billing', { run: true, trusted: true, only: { row: 1, command: 'exit 0' } })

  assert.equal(report.checks[0]?.result, null)
  assert.equal(report.checks[1]?.result?.passed, true)
})

test('a project with no TASKS.md says so, and says what to do about it', async (t) => {
  const root = await workspace(t, null)

  const report = await checkProject(root, 'billing')

  assert.equal(report.checks.length, 0)
  assert.match(report.problem ?? '', /_TEMPLATE/)
})

test('rows that could not be read are reported alongside the ones that could', async (t) => {
  const root = await workspace(t, `## In progress\n\n| # | Task |\n|---|---|\n| 1 | half a row |\n`)

  const report = await checkProject(root, 'billing')

  assert.equal(report.unreadable, 1)
})

// ────────────────────────────────────── whether the office may claim it is done ──

test('finished means every outstanding task checked and passed', async (t) => {
  const root = await workspace(t, table('| 1 | One | builder | `exit 0` |\n| 2 | Two | builder | `exit 0` |'))

  assert.equal(allVerified(await checkProject(root, 'billing', { run: true, trusted: true })), true)
})

test('one unchecked task leaves the question open, and open is not yes', async (t) => {
  const root = await workspace(t, table('| 1 | One | builder | `exit 0` |\n| 2 | Two | frontend | reviewed by eye |'))

  assert.equal(allVerified(await checkProject(root, 'billing', { run: true, trusted: true })), false)
})

test('a project with nothing outstanding is not "verified" — there was nothing to verify', async (t) => {
  const root = await workspace(t, `## Done\n\n| # | Task | Owner | VERIFY | Completed |\n|---|---|---|---|---|\n| 1 | Ship it | builder | \`exit 0\` | 2026-08-19 |\n`)

  assert.equal(allVerified(await checkProject(root, 'billing', { run: true, trusted: true })), false)
})

// ────────────────────────────────────────────── trust gates the policy, not just the message ──

test("an untrusted workspace's allow list is not in force, whatever its settings say", async (t) => {
  // Without this, the harness would honour an allowlist Claude Code itself is ignoring — and
  // the trust prompt would be a gate with a door beside it. A repository could ship `Bash(*)`
  // and a VERIFY of its choosing and have it run on a machine that never agreed to anything.
  const root = await workspace(t, table('| 1 | Ship it | builder | `exit 0` |'), ['Bash(*)'])

  const report = await checkProject(root, 'billing', { run: true, trusted: false })

  assert.equal(outcomeOf(report.checks[0]!), 'not-run')
  assert.equal(report.checks[0]?.verdict.state, 'unlisted')
})

test('an untrusted workspace still cannot be forced past a deny', async (t) => {
  // The title was a claim the body never tested: it did not force. With the deny list read only
  // from trusted workspaces, a click ran what the workspace refuses. Claude Code enforces a
  // project's deny rules in a folder nobody has trusted (measured against 2.1.266 on
  // 2026-09-16), and its allow rules not. The harness now does the same.
  const root = await workspace(t, table('| 1 | Clean | builder | `echo cleaned` |'), ['Bash(*)'], ['Bash(echo:*)'])

  const listed = await checkProject(root, 'billing', { run: true, trusted: false })
  assert.equal(listed.checks[0]?.result, null, 'it ran unattended')

  const forced = await checkProject(root, 'billing', { run: true, trusted: false, only: { row: 0, command: 'echo cleaned' }, force: true })
  assert.equal(outcomeOf(forced.checks[0]!), 'refused')
  assert.equal(forced.checks[0]?.result, null, 'a click ran what the workspace refuses')
})

// ───────────────────────────────────── rules that could not all be read are not acted on alone ──

/*
 * A settings file that exists and cannot be used leaves the policy incomplete, and
 * `triageAgainst` then uses none of its allow rules. This harness used `.policy` all the same,
 * so the other file's allow rules ran VERIFY commands unattended while the unreadable file's deny
 * rules were missing. Found by reading; the first test below is the measurement.
 */

async function twoFiles(t: TestContext, tasks: string, shared: string, local: object): Promise<string> {
  const root = await workspace(t, tasks)
  await writeFile(join(root, '.claude', 'settings.json'), shared)
  await writeFile(join(root, '.claude', 'settings.local.json'), JSON.stringify(local))
  return root
}

// The trailing comma is what makes the file unreadable. The deny it holds would have refused.
const BROKEN = '{ "permissions": { "deny": ["Bash(echo shipped:*)"], } }'

test('a VERIFY is not run unattended while a settings file cannot be read, though the other allows it', async (t) => {
  const root = await twoFiles(t, table('| 1 | Ship it | builder | `echo shipped` |'), BROKEN, {
    permissions: { allow: ['Bash(echo:*)'] },
  })

  const report = await checkProject(root, 'billing', { run: true, trusted: true })

  assert.equal(report.checks[0]?.result, null, 'it ran on the rules that could be read')
  assert.equal(outcomeOf(report.checks[0]!), 'not-run')
  assert.equal(report.checks[0]?.verdict.state, 'unlisted')
})

test('while the rules are incomplete, a person can still run a check, but not past a deny that was read', async (t) => {
  const tasks = table('| 1 | Ship it | builder | `echo shipped` |\n| 2 | Clean | builder | `echo cleaned` |')
  const root = await twoFiles(t, tasks, BROKEN, {
    permissions: { allow: ['Bash(echo:*)'], deny: ['Bash(echo cleaned:*)'] },
  })

  const shipped = await checkProject(root, 'billing', { run: true, trusted: true, only: { row: 0, command: 'echo shipped' }, force: true })
  assert.equal(outcomeOf(shipped.checks[0]!), 'passed', 'a click is still a way to run it')

  // Treating the whole policy as empty would lose this deny, and a click would run it.
  const cleaned = await checkProject(root, 'billing', { run: true, trusted: true, only: { row: 1, command: 'echo cleaned' }, force: true })
  assert.equal(outcomeOf(cleaned.checks[1]!), 'refused')
  assert.equal(cleaned.checks[1]?.result, null, 'a deny that was read did not hold')
})

test('once the file reads again, what it allows runs unattended again', async (t) => {
  // One workspace throughout, so a hold-back that outlived the broken file would show here. A
  // fresh workspace with a good file, which this test used before, could not tell.
  const root = await twoFiles(t, table('| 1 | Ship it | builder | `echo shipped` |'), BROKEN, {
    permissions: { allow: ['Bash(echo:*)'] },
  })

  const held = await checkProject(root, 'billing', { run: true, trusted: true })
  assert.equal(outcomeOf(held.checks[0]!), 'not-run', 'it ran while the file could not be read')

  const fixed = '{ "permissions": { "deny": ["Bash(rm:*)"] } }'
  await writeFile(join(root, '.claude', 'settings.json'), fixed)
  const report = await checkProject(root, 'billing', { run: true, trusted: true })

  assert.equal(outcomeOf(report.checks[0]!), 'passed')
})

test('a trusted workspace runs what it declared', async (t) => {
  const root = await workspace(t, table('| 1 | Ship it | builder | `exit 0` |'), ['Bash(exit:*)'])

  const report = await checkProject(root, 'billing', { run: true, trusted: true })

  assert.equal(outcomeOf(report.checks[0]!), 'passed')
})

test('THE BUG: a project name that climbs out of the workspace reads nothing', async (t) => {
  // `checkProject(root, '../..')` interpolated the name straight into a path and read a
  // `TASKS.md` from outside the workspace entirely, reporting its rows as this project's work.
  // Demonstrated before the guard: the panel showed "A task from outside the workspace".
  //
  // The read is the smaller half. The harness runs the first backticked command in each VERIFY,
  // so a file nobody in this office wrote could put commands in front of it. The allow-list in
  // `.claude/settings.json` decides whether a command runs; it does not decide whose file it
  // came from, and it was never asked to.
  const root = await workspace(t, table('| 1 | a genuine task | nobody | `echo ok` |'))

  // A TASKS.md two levels above the workspace — reachable only by climbing.
  await writeFile(join(root, '..', `TASKS.md`), table('| 1 | from outside the workspace | nobody | `echo reached` |'))

  const real = await checkProject(root, 'billing')
  assert.equal(real.problem, null, 'a real project still reads its own tasks')
  assert.equal(real.checks.length, 1)
  assert.match(real.checks[0]?.task.title ?? '', /genuine/)

  // `''` is not in this list: it is `OFFICE_PROJECT`, the unscoped conversation, and it has its
  // own answer — see the test below. Lumping it in here is what produced `"" is not a project`.
  for (const climbs of ['../..', '..', '.', 'a/b', 'a\\b', './billing', '.hidden']) {
    const out = await checkProject(root, climbs)
    assert.deepEqual(out.checks, [], `${JSON.stringify(climbs)} was read`)
    assert.match(
      out.problem ?? '',
      /is not a project in this office/,
      `${JSON.stringify(climbs)} produced ${JSON.stringify(out.problem)}`,
    )
  }
})

test('the office conversation is not a project, and is not told it is a bad name', async (t) => {
  // `OFFICE_PROJECT` is the empty string — the unscoped conversation, never a directory. It
  // reached the traversal guard and came back `"" is not a project in this office.`, quoting an
  // empty string at somebody who had opened the task panel without picking a project.
  //
  // Found by opening it in the running app rather than by a test, which is why this one exists.
  // Before the guard, it fell through and offered to copy the template into `projects/TASKS.md`
  // — a file no project can see. Neither answer was true.
  const root = await workspace(t, table('| 1 | a real task | nobody | `echo ok` |'))
  const out = await checkProject(root, OFFICE_PROJECT)

  assert.deepEqual(out.checks, [])
  assert.doesNotMatch(out.problem ?? '', /""/, 'it quoted an empty string at the reader')
  assert.doesNotMatch(out.problem ?? '', /is not a project in this office/, 'that message is for a bad name')
  assert.doesNotMatch(out.problem ?? '', /_TEMPLATE/, 'copying the template there would not help')
  assert.match(out.problem ?? '', /office conversation/, 'it says which state this is')
  assert.match(out.problem ?? '', /Open a project/, 'and what to do about it')

  // A real project is unaffected.
  const real = await checkProject(root, 'billing')
  assert.equal(real.problem, null)
  assert.equal(real.checks.length, 1)
})

test('and a refusal is a problem, not silence', async (t) => {
  // "No tasks" and "that is not a project" are different facts, and a panel showing an empty
  // list for both would be the fourth standing order in the surface that reports work.
  const root = await workspace(t, null)

  const missing = await checkProject(root, 'billing')
  assert.match(missing.problem ?? '', /no TASKS\.md/i, 'a real project with no file says so')

  const refused = await checkProject(root, '../..')
  assert.match(refused.problem ?? '', /is not a project/, 'and a name that is not a project says something else')
  assert.notEqual(missing.problem, refused.problem, 'the two must not read the same')
})

// ─────────────────────────────────── a VERIFY that names a test nobody wrote has not passed ──

test('a VERIFY naming a test file the workspace does not have has failed, though its runner exits 0', async (t) => {
  // `node --test a b` runs `a`, exits 0 and never mentions a missing `b`, and `tsx --test` does the
  // same (measured on 2026-09-17, Node 22.16.0, tsx 4.23.12). The office runs a VERIFY from the
  // workspace root, so that is where its files are looked for — not the project's own folder,
  // which holds a file of the missing name here to show it. `env -u NODE_TEST_CONTEXT` is
  // explained in `verify.test.ts`: a runner started inside a test runs nothing.
  const run = 'env -u NODE_TEST_CONTEXT node --test'
  const root = await workspace(
    t,
    table(
      `| 1 | Named and written | builder | \`${run} checks/passes.test.mjs\` |\n` +
        `| 2 | Named, never written | builder | \`${run} checks/passes.test.mjs checks/never-written.test.mjs\` |`,
    ),
    [`Bash(${run}:*)`],
  )
  const passing = "import { test } from 'node:test'\ntest('passes', () => {})\n"
  await mkdir(join(root, 'checks'))
  await writeFile(join(root, 'checks', 'passes.test.mjs'), passing)
  await mkdir(join(root, 'projects', 'billing', 'checks'))
  await writeFile(join(root, 'projects', 'billing', 'checks', 'never-written.test.mjs'), passing)

  const report = await checkProject(root, 'billing', { run: true, trusted: true })
  const [written, unwritten] = report.checks

  // The controls: the office ran both on its own, and the runner ran a test in each and passed it.
  assert.equal(written?.verdict.state, 'allowed')
  assert.equal(unwritten?.verdict.state, 'allowed')
  assert.equal(written?.result?.exitCode, 0, written?.result?.output)
  assert.equal(unwritten?.result?.exitCode, 0, unwritten?.result?.output)
  assert.match(written?.result?.output ?? '', /pass 1/, 'the runner ran nothing, so this checks nothing')
  assert.match(unwritten?.result?.output ?? '', /pass 1/, 'the runner ran nothing, so this checks nothing')
  assert.equal(outcomeOf(written!), 'passed')

  assert.equal(outcomeOf(unwritten!), 'failed', 'a VERIFY naming a test nobody wrote was reported passed')
  assert.deepEqual(unwritten?.result?.missing, ['checks/never-written.test.mjs'])
})
