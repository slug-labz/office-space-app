/**
 * Reading a project's task list.
 *
 * `CLAUDE.md` says a task is done when its VERIFY passes, not when somebody says it is. This is
 * the half that reads what has to be checked — and the things that matter are the ones that
 * would let a task look finished when it is not: a row that could not be read, and a condition
 * with nothing runnable in it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

import {
  checkable,
  commandIn,
  flagKind,
  isVerdict,
  missingTestsLine,
  parseTasks,
  testRuns,
  uncheckedTestsLine,
  type TestRun,
  type Unchecked,
} from '../src/shared/tasks.js'

const TASKS = `# Tasks — billing

Live task list.

## In progress

| # | Task | Owner | VERIFY |
|---|------|-------|--------|
| 1 | Fix the refresh token path | builder | \`npm test\` exits 0 |
| 2 | Check the contrast | frontend | reviewed by eye |

## Queued

| # | Task | Owner | VERIFY |
|---|------|-------|--------|
| 3 | Rate-limit the retry | backend | \`npm run typecheck\` is clean |

## Done

| # | Task | Owner | VERIFY | Completed |
|---|------|-------|--------|-----------|
| 0 | Scaffold the project | manager | \`ls projects/billing\` | 2026-08-19 |
`

test('tasks are read with their owner, condition and state', () => {
  const { tasks } = parseTasks(TASKS)

  assert.deepEqual(
    tasks.map((t) => `${t.ref}:${t.owner}:${t.state}`),
    ['1:builder:in-progress', '2:frontend:in-progress', '3:backend:queued', '0:manager:done'],
  )
})

test('the runnable command is pulled out, and the condition is kept as written', () => {
  const task = parseTasks(TASKS).tasks[0]

  assert.equal(task?.command, 'npm test')
  assert.equal(task?.condition, '`npm test` exits 0', 'what a person wrote, kept whole')
})

test('a condition with nothing runnable in it has no command — and does not read as passing', () => {
  const task = parseTasks(TASKS).tasks[1]

  assert.equal(task?.command, null)
  assert.equal(task?.condition, 'reviewed by eye')
})

test('only tasks that can be checked and are not done are offered to the harness', () => {
  const { tasks } = parseTasks(TASKS)

  assert.deepEqual(checkable(tasks).map((t) => t.ref), ['1', '3'])
})

test('the template ships a placeholder row, and it is not a task', () => {
  const template = `## In progress\n\n| # | Task | Owner | VERIFY |\n|---|------|-------|--------|\n| 1 | ... | builder | \`npm test\` exits 0 |\n`

  // The `...` row is the convention showing you the shape, not work anybody planned.
  const { tasks } = parseTasks(template)
  assert.equal(tasks.length, 1, 'a row with a real command is still a row')
  assert.equal(tasks[0]?.title, '...')
})

test('a wholly empty placeholder row is skipped', () => {
  const { tasks, unreadable } = parseTasks(`## Queued\n\n| # | Task | Owner | VERIFY |\n|---|---|---|---|\n| | ... | | |\n`)

  assert.deepEqual(tasks, [])
  assert.equal(unreadable, 0, 'the template showing its own shape is not a broken row')
})

test('a row that cannot be read is counted, never dropped', () => {
  // A task list that quietly loses a row says work is finished when it is not.
  const broken = `## In progress\n\n| # | Task |\n|---|---|\n| 1 | half a row |\n`

  const { tasks, unreadable } = parseTasks(broken)

  assert.deepEqual(tasks, [])
  assert.equal(unreadable, 1)
})

test('tables outside the three known sections are not ours to read', () => {
  const other = `## Notes\n\n| a | b | c | d |\n|---|---|---|---|\n| 1 | not a task | x | y |\n`

  assert.deepEqual(parseTasks(other), { tasks: [], unreadable: 0, unrecognised: [] })
})

test('a project with no tasks written down is empty, not broken', () => {
  assert.deepEqual(parseTasks('# Tasks — billing\n\nNothing yet.\n'), { tasks: [], unreadable: 0, unrecognised: [] })
})

test('the header row of a table is not a task', () => {
  const { tasks } = parseTasks(TASKS)

  assert.equal(tasks.some((t) => t.title.toLowerCase() === 'task'), false)
})

// ────────────────────────────────────────────────────────── pulling the command ──

test('the command is the first backticked span', () => {
  assert.equal(commandIn('`npm test` exits 0'), 'npm test')
  assert.equal(commandIn('run `npm run build` and then `npm test`'), 'npm run build')
})

test('a condition with no backticks has no command', () => {
  assert.equal(commandIn('somebody reads it and agrees'), null)
  assert.equal(commandIn(''), null)
  assert.equal(commandIn('``'), null, 'empty backticks are not a command')
})

/*
 * A verdict in the VERIFY column.
 *
 * The cells below are real, from the 2026-09-24 measurement in `PLAN.md` §4c, and the misses are
 * pinned on purpose: widening the rule to catch *"The tests pass"* is a decision about false
 * flags, and it should have to change this file to be made.
 */

test('a VERIFY written as an outcome is recognised as a verdict', () => {
  const verdicts = [
    // The real one, from `projects/random/TASKS.md` — the case the session log records finding by hand.
    "PASS — file exists (3,267 bytes, 145 lines); `grep -ci 'coming soon'` = 2; external refs = 0",
    'PASS — I read the file and it looks right',
    'Done — implemented in the previous commit',
    'Verified by the builder; output matched what we expected',
    'Confirmed working end to end, see transcript',
    '**PASS** — reviewed',
    'ok — matches the spec',
  ]
  const missed = verdicts.filter((c) => !isVerdict(c))
  assert.deepEqual(missed, [], `these verdicts were read as checks:\n  ${missed.join('\n  ')}`)
})

test('honest cells, including the ones a model called verdicts, are not flagged', () => {
  // Every one of these is from a real TASKS.md. The first six are the cells a hosted model flagged
  // across two runs; a lint that fires on them is one somebody stops reading.
  const honest = [
    '`npm test` exits 0',
    'Vishrut records it',
    'Vishrut approves the push',
    'the PR shows as merged on GitHub',
    'reviewed by eye in a browser, and test_no_client_formatting still passes',
    '*measurement in a published probe artifact*',
    '`reviewed by eye` — uncheckable by command',
    'Visual confirmation — no automated substitute available in this environment',
    'not yet specified — the check needs designing before it can be written',
    '*opening the file in PowerPoint — uncheckable by command*',
    '`git rev-parse --verify dev` exits 0',
    '`node tools/attack-provenance.mjs` exits 0 with attacks blocked',
  ]
  const flagged = honest.filter(isVerdict)
  assert.deepEqual(flagged, [], `honest cells flagged as verdicts:\n  ${flagged.join('\n  ')}`)
})

test('a verdict with no verdict word is missed, and that is the chosen cost', () => {
  for (const cell of ['The tests pass', 'No issues found when I looked', 'Checked by hand — all 14 rows render']) {
    assert.equal(isVerdict(cell), false, `${JSON.stringify(cell)} is now caught — re-measure the false flags before keeping that`)
  }
})

test('a verdict word inside a longer word is not a verdict', () => {
  assert.equal(isVerdict('passwd --status shows the account locked, per `id -u`'), false)
  assert.equal(isVerdict('Completed-by column filled in, `grep -c done TASKS.md` > 0'), false)
})

// ──────────────────────────────────────────── how a task stands, in one word ──

import { outcomeOf, outcomesByOwner, worse, type Checked } from '../src/shared/tasks.js'

const check = (
  over: Partial<Checked['task']> & {
    verdict?: Checked['verdict']['state']
    passed?: boolean | null
    /** Set when the command could not be *started*, which is not the same as failing. */
    error?: string
  } = {},
): Checked => ({
  task: { owner: over.owner ?? 'builder', command: over.command === undefined ? 'npm test' : over.command, state: over.state ?? 'in-progress' },
  verdict: { state: over.verdict ?? 'allowed' },
  result:
    over.passed === undefined || over.passed === null
      ? null
      : { passed: over.passed, ...(over.error === undefined ? {} : { error: over.error }) },
})

test('the six outcomes are distinguished', () => {
  assert.equal(outcomeOf(check({ passed: true })), 'passed')
  assert.equal(outcomeOf(check({ passed: false })), 'failed')
  assert.equal(outcomeOf(check({ command: null })), 'uncheckable')
  assert.equal(outcomeOf(check({ verdict: 'denied' })), 'refused')
  assert.equal(outcomeOf(check({})), 'not-run')
  assert.equal(outcomeOf(check({ state: 'done', passed: true })), 'done')
})
/*
 * A command that could not be *started* is not a task that failed.
 *
 * A failed spawn leaves `passed: false` like any other bad exit, so a VERIFY naming a command
 * this machine does not have — a typo in TASKS.md, a tool nobody installed — was reported as the
 * task's *work* being wrong. `verify.ts` says why that matters in its own words: "an office that
 * conflated them would report broken plumbing as broken code."
 *
 * No seventh outcome was needed, which is the part worth noticing. `not-run` already means
 * *nothing was run — because it could not be, or was not permitted to be*, and a spawn that never
 * started is the first of those exactly. The union was right; the routing into it was not.
 */

test('a command that could not be started is not-run, not failed', () => {
  assert.equal(outcomeOf(check({ passed: false, error: 'spawn cargo ENOENT' })), 'not-run')
})

test('a command that ran and exited non-zero is still failed', () => {
  // The distinction only earns its place if the ordinary case is untouched. This is the one the
  // board is mostly about: the check ran, and it said no.
  assert.equal(outcomeOf(check({ passed: false })), 'failed')
  assert.equal(outcomeOf(check({ passed: false, error: null as unknown as string })), 'failed')
})

test('an error does not override a check that somehow passed', () => {
  // Defensive rather than expected: if a result is both passed and carrying an error, the run
  // plainly happened, so `not-run` would be the false half of the pair.
  assert.equal(outcomeOf(check({ passed: true })), 'passed')
})

test('the states that come before it still win', () => {
  // `done`, `uncheckable` and `refused` are decided before the result is looked at, and a spawn
  // error must not reorder them — a task nobody authorised is refused whether or not the command
  // would have started.
  assert.equal(outcomeOf(check({ state: 'done', passed: false, error: 'ENOENT' })), 'done')
  assert.equal(outcomeOf(check({ command: null, passed: false, error: 'ENOENT' })), 'uncheckable')
  assert.equal(outcomeOf(check({ verdict: 'denied', passed: false, error: 'ENOENT' })), 'refused')
})


test('a failure is the thing a person should be told about first', () => {
  assert.equal(worse('passed', 'failed'), 'failed')
  assert.equal(worse('failed', 'refused'), 'failed')
})

test('"we do not know" is not swallowed by "some of it is fine"', () => {
  // An employee with one green task and one nobody has run is not verified.
  assert.equal(worse('passed', 'not-run'), 'not-run')
  assert.equal(worse('passed', 'uncheckable'), 'uncheckable')
})

test('each employee is summarised by their worst outstanding task', () => {
  const byOwner = outcomesByOwner([
    check({ owner: 'builder', passed: true }),
    check({ owner: 'builder', passed: false }),
    check({ owner: 'tester', passed: true }),
    check({ owner: 'frontend', command: null }),
  ])

  assert.equal(byOwner.get('builder'), 'failed')
  assert.equal(byOwner.get('tester'), 'passed')
  assert.equal(byOwner.get('frontend'), 'uncheckable')
})

test('finished work is not what somebody is carrying', () => {
  // The floor is about what is outstanding. A person whose only remaining task passed reads as
  // passed, not as whatever they did last week.
  const byOwner = outcomesByOwner([
    check({ owner: 'builder', state: 'done', passed: false }),
    check({ owner: 'builder', passed: true }),
  ])

  assert.equal(byOwner.get('builder'), 'passed')
})

test('a task with no owner belongs to nobody on the floor', () => {
  assert.equal(outcomesByOwner([check({ owner: '  ' })]).size, 0)
})

test('an owner who is not staff is still listed — the floor simply will not find them', () => {
  // A task owned by `user` is real work; nobody on the floor is doing it.
  assert.equal(outcomesByOwner([check({ owner: 'user', passed: false })]).get('user'), 'failed')
})

test('a bare path in a VERIFY is uncheckable, not unauthorised', () => {
  // Found by running the harness against a real project for the first time. `coming-soon` task 1
  // reads: `site/index.html` exists; `grep …` returns no matches.
  //
  // The office took the first backticked span — a *file* — as the command, the policy declined
  // it (nothing authorises running an HTML file), and the task reported `not-run`, which reads
  // as "the workspace would not let us". The truth is "that was never a command". Two different
  // facts, and the fourth standing order is that they must not be merged.
  assert.equal(commandIn('`site/index.html` exists; `grep -q x site/index.html`'), null)
  assert.equal(commandIn('`dist/app.js` is produced'), null)
})

test('an invocation that happens to name a file is still a command', () => {
  // The narrowness is the point. Refusing anything with a slash or a dot would swallow most of
  // the real VERIFY conditions in this repo.
  assert.equal(commandIn('`./build.sh` exits 0'), './build.sh')
  assert.equal(commandIn('`/usr/bin/true` exits 0'), '/usr/bin/true')
  assert.equal(commandIn('`npm test --prefix projects/x` exits 0'), 'npm test --prefix projects/x')
  assert.equal(commandIn('`node smoke.mjs` exits 0'), 'node smoke.mjs')
  assert.equal(commandIn('`grep -q foo site/index.html` matches'), 'grep -q foo site/index.html')
})

test('a task whose VERIFY names no command reports uncheckable, never passing', () => {
  // The outcome that must never be reachable by accident: a task nobody can check must not read
  // as one that passed.
  const uncheckable = outcomeOf({
    task: { state: 'in-progress', command: null } as never,
    verdict: { state: 'unlisted' },
    result: null,
  })
  assert.equal(uncheckable, 'uncheckable')
})

// ───────────────────────────── a task list under a heading we do not read ────

/**
 * Rows outside `## In progress`, `## Queued` and `## Done` are skipped, and that is right:
 * `TASKS.md` holds prose and other tables, and counting every table row in the document as a lost
 * task would be noise — and a warning that is noise is one somebody turns off.
 *
 * The gap is between *a row in some other table* and **somebody's task list under a heading we do
 * not know**. Measured in the running app: three hundred rows under `## Backlog` produced
 * *"0 tasks · none outstanding"* and *"No tasks written down yet."*
 *
 * So the narrow case is named. Four cells and a numeric ref, under an unrecognised `##` heading.
 */

test('a task table under an unrecognised heading is named, not silently dropped', () => {
  const { tasks, unrecognised } = parseTasks(`# Tasks

## Backlog

| # | Task | Owner | VERIFY |
|---|------|-------|--------|
| 1 | Cap the retry | builder | \`npm test\` exits 0 |
| 2 | Fix the 401 | tester | \`npm test\` exits 0 |
`)

  assert.deepEqual(tasks, [], 'rows under a heading we do not read were guessed at rather than reported')
  assert.deepEqual(
    unrecognised,
    ['Backlog'],
    'a file with two tasks in it reported as a file with none, and said nothing about why',
  )
})

test('the heading is reported once however many rows are under it', () => {
  const rows = Array.from({ length: 40 }, (_, i) => `| ${i + 1} | Task | builder | \`npm test\` exits 0 |`).join('\n')
  const { unrecognised } = parseTasks(`## To do\n\n| # | Task | Owner | VERIFY |\n|---|---|---|---|\n${rows}\n`)
  assert.deepEqual(unrecognised, ['To do'])
})

test('two unrecognised headings are two answers', () => {
  const { unrecognised } = parseTasks(`## Backlog

| 1 | a | builder | \`x\` |

## Someday

| 2 | b | builder | \`x\` |
`)
  assert.deepEqual(unrecognised, ['Backlog', 'Someday'])
})

test('a table that is not a task table does not trip it', () => {
  // The false positive worth avoiding, and the reason the rule needs the backticks. A settings
  // table has four cells, and one with a numbered first column has a numeric ref too — the only
  // thing that separates it from a task row is the VERIFY the convention is built on.
  const settings = parseTasks(`## Settings

| Option | Type | Default | Notes |
|---|---|---|---|
| density | string | comfortable | spacing only |
`)
  assert.deepEqual(settings.unrecognised, [], 'a settings table was reported as a task list')

  const numbered = parseTasks(`## Notes

| 1 | not a task | x | y |
`)
  assert.deepEqual(
    numbered.unrecognised,
    [],
    'a numbered four-column table with no command in it was called a task list — the shape is ' +
      'identical to a task row and the backticked VERIFY is the whole of the difference',
  )
})

test('prose under an unrecognised heading is not a task table either', () => {
  const { unrecognised } = parseTasks(`## Notes

The retry cap is the thing to do next. See \`src/main/retry.ts\`.
`)
  assert.deepEqual(unrecognised, [])
})

test('a proper file reports nothing unrecognised', () => {
  // The control. This warning appearing on a correct file is worse than the bug it replaces.
  const { tasks, unrecognised } = parseTasks(`## Queued

| # | Task | Owner | VERIFY |
|---|------|-------|--------|
| 1 | Cap the retry | builder | \`npm test\` exits 0 |
`)
  assert.equal(tasks.length, 1)
  assert.deepEqual(unrecognised, [])
})

test('a row before any heading at all is not attributed to one', () => {
  // `heading` starts empty, and an empty string is not a heading somebody can rename.
  const { unrecognised } = parseTasks(`| 1 | a | builder | \`x\` |\n`)
  assert.deepEqual(unrecognised, [])
})

// ────────────────────────────────────────── the test files a VERIFY hands to its runner ──

/**
 * `tsx --test a b` with `b` missing runs `a`, exits 0 and never mentions `b`; it fails only when
 * none of the files it is given exist, and `node --test` does the same (measured on 2026-09-17,
 * Node 22.16.0, tsx 4.23.12). So the harness has to know which files a VERIFY names in order to
 * notice one is not there. And a word it calls a file that is not one fails a task that passed, so
 * it also has to know which words it cannot place, and leave those runs unread.
 */

const run = (runner: TestRun['runner'], ...files: string[]): TestRun => ({ runner, files, unchecked: null })
const unread = (runner: TestRun['runner'], reason: Unchecked['reason'], word: string): TestRun => ({
  runner,
  files: [],
  unchecked: { runner, reason, word },
})
/** The note for `--test` in `word`, which no run read. */
const note = (word: string): TestRun => unread(null, 'unread', word)

test('a test run names every file after --test, not only the first', () => {
  assert.deepEqual(testRuns('npx tsx --test test/a.test.ts test/b.test.ts test/c.test.ts'), [
    run('tsx', 'test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts'),
  ])
})

test('tsx and node are both runners: bare, through npx, by path, by version, or after env', () => {
  const cases: Record<string, TestRun[]> = {
    'tsx --test a.test.ts': [run('tsx', 'a.test.ts')],
    'npx tsx --test a.test.ts': [run('tsx', 'a.test.ts')],
    'npx tsx@4.23.12 --test a.test.ts': [run('tsx', 'a.test.ts')],
    './node_modules/.bin/tsx --test a.test.ts': [run('tsx', 'a.test.ts')],
    'node_modules/.bin/tsx --test a.test.ts': [run('tsx', 'a.test.ts')],
    'node --test a.test.mjs': [run('node', 'a.test.mjs')],
    'env -u NODE_TEST_CONTEXT node --test a.test.mjs': [run('node', 'a.test.mjs')],
    'node --test -- a.test.mjs': [run('node', 'a.test.mjs')],
    // A package called `tsx` is not the runner; the word after it is.
    'npx -p tsx tsx --test a.test.ts': [run('tsx', 'a.test.ts')],
  }
  for (const [command, runs] of Object.entries(cases)) {
    assert.deepEqual(testRuns(command), runs, command)
  }
})

test('a flag before the files is not a file, and a glob is left for whatever expands it', () => {
  assert.deepEqual(testRuns('tsx --test --test-timeout=60000 --test-only test/*.test.ts test/a.test.ts'), [
    run('tsx', 'test/a.test.ts'),
  ])
  // `npm test` in this repository names nothing but a glob, so it is not checked at all.
  assert.deepEqual(testRuns('tsx --test --test-timeout=60000 test/*.test.ts'), [run('tsx')])
  assert.deepEqual(testRuns('node --test test/?.test.mjs test/[ab].test.mjs'), [run('node')])
  // In quotes it reaches the runner as a glob, and Node expands it itself.
  assert.deepEqual(testRuns(`node --test 'test/*.test.mjs' a.test.mjs`), [run('node', 'a.test.mjs')])
  // Extended ones too: `node --test 'x+(y).test.mjs'` ran no test though a file of that name was
  // there (measured), so looking for that name would pass a run that never ran it.
  assert.deepEqual(testRuns(`node --test 'x+(y).test.mjs' '@(a).test.mjs' '!(a).test.mjs' a@b.test.mjs`), [
    run('node', 'a@b.test.mjs'),
  ])
})

test('after the first file, every word is a file to the runner, a flag and a -- too', () => {
  // Measured on Node 22.16.0: `node --test none.test.mjs --test-reporter=spec` could not find
  // `none.test.mjs, --test-reporter=spec`; `node --test x.test.mjs --test-reporter spec` printed TAP
  // and ran a test file called `spec`; `node --test none.mjs -- none2.mjs` could not find
  // `none.mjs, --, none2.mjs`; tsx hands them on the same way. So each of these words is a test file
  // the runner skips without a word when it is not there.
  const cases: Record<string, TestRun[]> = {
    'node --test a.test.mjs --test-reporter spec': [run('node', 'a.test.mjs', '--test-reporter', 'spec')],
    'node --test a.test.mjs --test-reporter=spec --foo': [run('node', 'a.test.mjs', '--test-reporter=spec', '--foo')],
    'tsx --test a.test.ts --test-only': [run('tsx', 'a.test.ts', '--test-only')],
    'tsx --test a.test.ts --tsconfig tsconfig.test.json': [run('tsx', 'a.test.ts', '--tsconfig', 'tsconfig.test.json')],
    'node --test a.test.mjs -- b.test.mjs': [run('node', 'a.test.mjs', '--', 'b.test.mjs')],
    'node --test -- a.test.mjs -- b.test.mjs': [run('node', 'a.test.mjs', '--', 'b.test.mjs')],
    'node --test test/*.test.mjs --test-only': [run('node', '--test-only')],
  }
  for (const [command, runs] of Object.entries(cases)) {
    assert.deepEqual(testRuns(command), runs, command)
  }
})

test('an option that takes a value takes the next word, and one that takes none leaves it', () => {
  const cases: Record<string, TestRun[]> = {
    // Each of these four ran and passed with its file there (verify.test.ts), and each value was
    // once read as a missing file: `tsx`, `passes`, `1`, `spec`.
    'node --test --import tsx passes.test.ts': [run('node', 'passes.test.ts')],
    'node --test --test-name-pattern passes passes.test.mjs': [run('node', 'passes.test.mjs')],
    'node --test --test-concurrency 1 passes.test.mjs': [run('node', 'passes.test.mjs')],
    'node --test --test-reporter spec passes.test.mjs': [run('node', 'passes.test.mjs')],
    'node -r ts-node/register --test a.test.ts': [run('node', 'a.test.ts')],
    'node --test --test-timeout 60000 a.test.mjs': [run('node', 'a.test.mjs')],
    'node --test --test-shard 1/3 a.test.mjs': [run('node', 'a.test.mjs')],
    'node --conditions development --test a.test.mjs': [run('node', 'a.test.mjs')],
    'node -C development --test a.test.mjs': [run('node', 'a.test.mjs')],
    'node --test --test_reporter spec a.test.mjs': [run('node', 'a.test.mjs')],
    'tsx --tsconfig tsconfig.test.json --test a.test.ts': [run('tsx', 'a.test.ts')],
    'tsx --test --tsconfig tsconfig.test.json a.test.ts': [run('tsx', 'a.test.ts')],
    // The other kind leaves the next word a file.
    'node --test --test-only a.test.mjs': [run('node', 'a.test.mjs')],
    'node --test --no-test-only --no-warnings a.test.mjs': [run('node', 'a.test.mjs')],
    'node --test --inspect a.test.mjs': [run('node', 'a.test.mjs')],
    'tsx --no-cache --test a.test.ts': [run('tsx', 'a.test.ts')],
  }
  for (const [command, runs] of Object.entries(cases)) {
    assert.deepEqual(testRuns(command), runs, command)
  }
})

test('after an option this does not know, the run is not checked, and nothing in it is called missing', () => {
  // `--foo` may take a value in the Node that runs the VERIFY, if not in this one, and then
  // `a.test.mjs` is that value rather than a file.
  assert.deepEqual(testRuns('node --test --foo a.test.mjs b.test.mjs'), [unread('node', 'flag', '--foo')])
  assert.deepEqual(testRuns('node --allow-natives-syntax --test a.test.mjs'), [
    unread('node', 'flag', '--allow-natives-syntax'),
  ])
  // The word after it might be its value rather than a script, so this might still be a test run.
  assert.deepEqual(testRuns('node --foo scripts/x.mjs --test a.test.mjs'), [unread('node', 'flag', '--foo')])
  // With `=`, or with nothing after it, there is no word to misread.
  assert.deepEqual(testRuns('node --test --foo=1 a.test.mjs'), [run('node', 'a.test.mjs')])
  assert.deepEqual(testRuns('node --test --foo'), [run('node')])
})

test('a word before --test is a script, and the words after it are its own, and only said to be there', () => {
  // No run is read, so no word here is looked for. The `--test` is said as text no run read: the
  // script may hand it to a runner of its own, and nothing here knows.
  for (const command of [
    'node scripts/check.mjs --test unit',
    'tsx scripts/check.ts --test unit.test.ts',
    'node --import tsx scripts/check.ts --test unit',
    // `--` ends the runner's options, so `--test` after it is the script (measured: exit 1,
    // "Cannot find module '--test'"), and `npx` hands a `--` after the runner on to it (measured).
    'node -- --test a.test.mjs',
    'npx tsx -- --test a.test.ts',
  ]) {
    assert.deepEqual(testRuns(command), [note('--test')], command)
  }
})

test('npm exec takes the first -- for itself, so a run after it is read', () => {
  // Measured with npm 10.9.2: each ran the file that was there under the test runner, skipped the
  // missing one, and exited 0.
  assert.deepEqual(testRuns('npm exec tsx -- --test a.test.ts b.test.ts'), [run('tsx', 'a.test.ts', 'b.test.ts')])
  assert.deepEqual(testRuns('npm x tsx -- --test a.test.ts'), [run('tsx', 'a.test.ts')])
  assert.deepEqual(testRuns('npm exec -- tsx --test a.test.ts'), [run('tsx', 'a.test.ts')])
  // Only the first: after it npm takes nothing, and the runner gets the next `--` as a file
  // (measured: `npm exec -- tsx --test none.test.ts -- none2.test.ts` could not find
  // `none.test.ts, --, none2.test.ts`).
  assert.deepEqual(testRuns('npm exec -- tsx --test a.test.ts -- b.test.ts'), [
    run('tsx', 'a.test.ts', '--', 'b.test.ts'),
  ])
  assert.deepEqual(testRuns('npm exec tsx -- --test a.test.ts -- b.test.ts'), [
    run('tsx', 'a.test.ts', '--', 'b.test.ts'),
  ])
})

test('npm exec takes the options after the runner for itself until a --, and those runs are not read', () => {
  // Measured with npm 10.9.2: `npm exec tsx --test a b` ran `a` as a plain script, with `b` as its
  // argument, and exited 0; `npm exec node --test-reporter=tap -- --test a` ran `a` under the test
  // runner without the option. `npx` does not do this: it hands on everything after the runner.
  assert.deepEqual(testRuns('npm exec tsx --test a.test.ts b.test.ts'), [unread('tsx', 'taken', '--test')])
  assert.deepEqual(testRuns('npm x node --test a.test.mjs -- b.test.mjs'), [unread('node', 'taken', '--test')])
  assert.deepEqual(testRuns('npm exec node --test-reporter=tap -- --test a.test.mjs'), [
    unread('node', 'taken', '--test-reporter=tap'),
  ])
  assert.deepEqual(testRuns('npm exec node $OPTS -- --test a.test.mjs'), [unread('node', 'rewritten', '$OPTS')])
  assert.deepEqual(testRuns('npx tsx --test a.test.ts b.test.ts'), [run('tsx', 'a.test.ts', 'b.test.ts')])
  // A command that is not a test run as written is not one after npm either.
  assert.deepEqual(testRuns('npm exec node --version'), [])
})

test('a command that is not a tsx or node test run names no test files', () => {
  for (const command of [
    'npm test',
    'npx vitest run test/a.test.ts',
    'node scripts/build.mjs',
    'tsx test/a.test.ts',
    'echo --test a.test.ts',
    'cargo test',
  ]) {
    assert.deepEqual(testRuns(command), [], command)
  }
})

test('a run ends at shell syntax, and a redirection goes with what it points at', () => {
  assert.deepEqual(testRuns('npx tsx --test a.test.ts 2>&1'), [run('tsx', 'a.test.ts')])
  assert.deepEqual(testRuns('npx tsx --test a.test.ts > out.txt'), [run('tsx', 'a.test.ts')])
  assert.deepEqual(testRuns('npx tsx --test a.test.ts | tail -5'), [run('tsx', 'a.test.ts')])
  assert.deepEqual(testRuns('npm run build && node --test dist/a.test.js'), [run('node', 'dist/a.test.js')])
  assert.deepEqual(testRuns('tsx --test a.test.ts; node --test b.test.mjs'), [
    run('tsx', 'a.test.ts'),
    run('node', 'b.test.mjs'),
  ])
  // The shell goes on after a redirection, and so does the run.
  assert.deepEqual(testRuns('node --test a.test.mjs 2>/dev/null b.test.mjs'), [
    run('node', 'a.test.mjs', 'b.test.mjs'),
  ])
  // `>|` is one redirection, not `>` and a pipe (measured: this ran both files).
  assert.deepEqual(testRuns('node --test a.test.mjs >| out.txt b.test.mjs'), [
    run('node', 'a.test.mjs', 'b.test.mjs'),
  ])
  // A number is a descriptor only when it is written against the redirection. Apart, it is a file.
  assert.deepEqual(testRuns('node --test a.test.mjs 2 >out.txt'), [run('node', 'a.test.mjs', '2')])
  assert.deepEqual(testRuns('node --test a.test.mjs 2>out.txt'), [run('node', 'a.test.mjs')])
})

test('a parenthesis starts a command, and a # that starts a word starts a comment', () => {
  assert.deepEqual(testRuns('(node --test a.test.mjs b.test.mjs)'), [run('node', 'a.test.mjs', 'b.test.mjs')])
  assert.deepEqual(testRuns('npm run build && (tsx --test a.test.ts)'), [run('tsx', 'a.test.ts')])
  assert.deepEqual(testRuns('node --test a.test.mjs # and b.test.mjs, once it is written'), [
    run('node', 'a.test.mjs'),
  ])
  assert.deepEqual(testRuns('node --test a#b.test.mjs'), [run('node', 'a#b.test.mjs')])
})

test('a newline ends a command, and a comment ends at the newline', () => {
  // `/bin/sh -c` runs each line as its own command (measured), so the second runner is not a file
  // of the first.
  assert.deepEqual(testRuns('node --test a.test.mjs\nnode --test b.test.mjs'), [
    run('node', 'a.test.mjs'),
    run('node', 'b.test.mjs'),
  ])
  assert.deepEqual(testRuns('node --test a.test.mjs # b.test.mjs\ntsx --test c.test.ts'), [
    run('node', 'a.test.mjs'),
    run('tsx', 'c.test.ts'),
  ])
  // Inside quotes a newline is part of the word.
  assert.deepEqual(testRuns(`node --test 'a\nb.test.mjs'`), [run('node', 'a\nb.test.mjs')])
})

test('a quote that never closes leaves a line with no runs, and only the note that nothing was read', () => {
  // Measured: `/bin/sh` refused each of these with "unexpected EOF while looking for matching" and
  // exit 2, and the `echo` before the quote printed nothing. Nothing ran, so there is nothing to
  // look for. A line this cannot split may still be one the shell can, so `--test` in it is said;
  // `runVerify` keeps that note only after an exit 0, which these cannot give (verify.test.ts).
  for (const command of [
    'node --test a.test.mjs "b.test.mjs',
    `node --test a.test.mjs 'b.test.mjs`,
    `echo before; node --test a.test.mjs "b.test.mjs`,
    `sh -c "node --test a.test.mjs 'b.test.mjs"`,
  ]) {
    assert.deepEqual(testRuns(command), [note('--test')], command)
  }
})

test('a word in plain quotes is read without them, and a word the shell rewrites leaves its run unread', () => {
  assert.deepEqual(testRuns(`npx tsx --test "test/never.test.ts" 'test/a.test.ts' "e f.test.ts"`), [
    run('tsx', 'test/never.test.ts', 'test/a.test.ts', 'e f.test.ts'),
  ])
  assert.deepEqual(testRuns(`node --test 'a'.test.mjs`), [run('node', 'a.test.mjs')])
  // Inside single quotes nothing is expanded: `'$HOME'` reached `printf` as `$HOME` (measured), and
  // the runner looked for a file of that name.
  assert.deepEqual(testRuns(`node --test a.test.mjs '$HOME' "~/b.test.mjs"`), [
    run('node', 'a.test.mjs', '$HOME', '~/b.test.mjs'),
  ])
  // What these become, or how many words, is not written down, and one could be an option that
  // takes the word after it.
  for (const word of ['"$FILE"', '$FILE', '~/b.test.mjs', 'c\\ d.test.mjs', '"$(ls)"', '"a\\"b"', '`ls`']) {
    assert.deepEqual(testRuns(`node --test a.test.mjs ${word} h.test.mjs`), [unread('node', 'rewritten', word)], word)
  }
  // The shell leaves these as written, but the runner reads a backslash in a file as `/`
  // (measured: `node --test 'a\b.test.mjs'` ran `a/b.test.mjs`), so the word is not where it looks.
  for (const word of [`'a\\b.test.mjs'`, '"a\\b.test.mjs"']) {
    assert.deepEqual(testRuns(`node --test a.test.mjs ${word}`), [unread('node', 'rewritten', word)], word)
  }
  // An option's value too: a variable can become no word at all, and hand the option the next one.
  assert.deepEqual(testRuns('node --test --test-name-pattern $P a.test.mjs'), [unread('node', 'rewritten', '$P')])
})

test('a command that changes directory is not checked, because its runner may look somewhere else', () => {
  assert.deepEqual(testRuns('cd packages/app && npx tsx --test test/a.test.ts'), [unread('tsx', 'moves', 'cd')])
  assert.deepEqual(testRuns('(cd packages/app; node --test a.test.mjs)'), [unread('node', 'moves', 'cd')])
  assert.deepEqual(testRuns('pushd packages/app && tsx --test a.test.ts'), [unread('tsx', 'moves', 'pushd')])
  // Even a `cd` that is only an argument, which can cost a check and never fail one.
  assert.deepEqual(testRuns('grep -q cd notes.txt && node --test a.test.mjs'), [unread('node', 'moves', 'cd')])
  // GNU env's `-C` moves its command. The env macOS ships has no such option (measured).
  assert.deepEqual(testRuns('env -C packages/app node --test a.test.mjs'), [unread('node', 'moves', '-C')])
  assert.deepEqual(testRuns('env --chdir=packages/app node --test a.test.mjs'), [
    unread('node', 'moves', '--chdir=packages/app'),
  ])
  // A run's own reason is said rather than the `cd`: it names what is in that run.
  assert.deepEqual(testRuns('cd packages/app && node --test --foo a.test.mjs'), [unread('node', 'flag', '--foo')])
  assert.deepEqual(testRuns('cd packages/app && pnpm exec node --test a.test.mjs'), [
    unread('node', 'prefix', 'pnpm'),
  ])
})

test('npx and npm exec in an npm workspace are not checked, and plain npx and --prefix are', () => {
  // Measured with npm 10.9.2: `npx <flag> -c pwd` printed the workspace's folder after each of these,
  for (const flag of ['-w app', '-w=app', '--workspace app', '--workspace=app', '-ws', '--workspaces', '--workspaces=true']) {
    const word = flag.split(' ')[0]!
    assert.deepEqual(testRuns(`npx ${flag} tsx --test a.test.ts`), [unread('tsx', 'workspace', word)], flag)
  }
  assert.deepEqual(testRuns('npm -w app exec tsx --test a.test.ts'), [unread('tsx', 'workspace', '-w')])
  assert.deepEqual(testRuns('npm exec --workspace=app -- tsx --test a.test.ts'), [
    unread('tsx', 'workspace', '--workspace=app'),
  ])
  // and the folder it started in after these.
  for (const flag of ['--workspaces=false', '--prefix sub', '-C sub']) {
    assert.deepEqual(testRuns(`npx ${flag} tsx --test a.test.ts`), [run('tsx', 'a.test.ts')], flag)
  }
  // A workspace called `tsx` is not the runner.
  assert.deepEqual(testRuns('npx -w tsx tsx --test a.test.ts'), [unread('tsx', 'workspace', '-w')])
  // `-w=` names no workspace, and npm stopped with "No workspaces found" (measured): nothing here
  // says where that would run.
  assert.deepEqual(testRuns('npx -w= tsx --test a.test.ts'), [unread('tsx', 'prefix', '-w=')])
})

test('npm told to use a workspace by a variable is not checked either, and only when npm starts the runner', () => {
  // Measured with npm 10.9.2: `npx -c pwd` printed the workspace's folder after each of these,
  for (const variable of [
    'npm_config_workspace=app',
    'NPM_CONFIG_WORKSPACE=app',
    'npm_config_workspaces=true',
    `npm_config_workspace='app'`,
  ]) {
    const name = variable.split('=')[0]!
    assert.deepEqual(testRuns(`${variable} npx tsx --test a.test.ts`), [unread('tsx', 'workspace', name)], variable)
  }
  assert.deepEqual(testRuns('env npm_config_workspace=app npx tsx --test a.test.ts'), [
    unread('tsx', 'workspace', 'npm_config_workspace'),
  ])
  // and the folder it started in after these.
  for (const variable of ['npm_config_workspace=', 'npm_config_workspaces=false', 'npm_config_yes=true']) {
    assert.deepEqual(testRuns(`${variable} npx tsx --test a.test.ts`), [run('tsx', 'a.test.ts')], variable)
  }
  // Node does not read it, so a runner npm does not start is read as it is.
  assert.deepEqual(testRuns('npm_config_workspace=app node --test a.test.mjs'), [run('node', 'a.test.mjs')])
  // Whatever the value looks like: a variable's value is not followed here.
  assert.deepEqual(testRuns('npm_config_workspace=$W npx tsx --test a.test.ts'), [
    unread('tsx', 'workspace', 'npm_config_workspace'),
  ])
})

test('a runner inside quoted text is not read, and says so', () => {
  assert.deepEqual(testRuns('sh -c "node --test a.test.mjs missing.test.mjs"'), [
    unread('node', 'quoted', '"node --test a.test.mjs missing.test.mjs"'),
  ])
  assert.deepEqual(testRuns(`bash -c 'cd app && tsx --test a.test.ts'`), [
    unread('tsx', 'quoted', `'cd app && tsx --test a.test.ts'`),
  ])
  assert.deepEqual(testRuns(`npx -c 'tsx --test a.test.ts b.test.ts'`), [
    unread('tsx', 'quoted', `'tsx --test a.test.ts b.test.ts'`),
  ])
  // Quoted text that runs no test says nothing, and a runner's own quoted words are its own.
  assert.deepEqual(testRuns(`sh -c 'echo node'`), [])
  assert.deepEqual(testRuns('node --test --test-name-pattern "node --test" a.test.mjs'), [run('node', 'a.test.mjs')])
})

test('text a shell runs is read as a command, however deep', () => {
  // Each of these ran `node --test` on the files in its text and exited 0 (measured with `/bin/sh`).
  const cases: [string, string][] = [
    ['sh -c "sh -c \\"node --test x.test.mjs missing.test.mjs\\""', '"sh -c \\"node --test x.test.mjs missing.test.mjs\\""'],
    [`bash -c 'bash -c "node --test a.test.mjs"'`, `'bash -c "node --test a.test.mjs"'`],
    ['eval "node --test a.test.mjs missing.test.mjs"', '"node --test a.test.mjs missing.test.mjs"'],
    ['bash -lc "node --test a.test.mjs"', '"node --test a.test.mjs"'],
    ['bash -o pipefail -c "node --test a.test.mjs"', '"node --test a.test.mjs"'],
    ['env -u X zsh -c "node --test a.test.mjs"', '"node --test a.test.mjs"'],
    [`npm exec --call='tsx --test a.test.ts'`, `'tsx --test a.test.ts'`],
  ]
  for (const [command, word] of cases) {
    assert.deepEqual(testRuns(command), [unread(command.includes('tsx') ? 'tsx' : 'node', 'quoted', word)], command)
  }
  // Quoted text nothing is known to run is not a run, and says only where `--test` is.
  for (const [command, word] of [
    ['echo "node --test done"', '"node --test done"'],
    [`printf '%s' 'node --test a.test.mjs'`, `'node --test a.test.mjs'`],
    ['sh script.sh "node --test a"', '"node --test a"'],
  ] as const) {
    assert.deepEqual(testRuns(command), [note(word)], command)
  }
})

test('a runner another program starts is not read, whatever that program is', () => {
  // Measured on 2026-09-17: pnpm 11.22.0 ran both files in `app/` and exited 0 after each pnpm form,
  // and `find` and `xargs` each ran the file they found and exited 0. Read as written, these named
  // files that are not in the folder the command starts in, or `{}` and `+`.
  const cases: [string, string][] = [
    ['pnpm --filter app exec node --test test/a.test.mjs test/b.test.mjs', 'pnpm'],
    ['pnpm -r exec node --test test/a.test.mjs', 'pnpm'],
    ['pnpm -C app exec node --test test/a.test.mjs', 'pnpm'],
    ['pnpm --dir app exec tsx --test test/a.test.ts', 'pnpm'],
    ['yarn workspace app node --test test/a.test.mjs', 'yarn'],
    ['find test -name a.test.mjs -exec node --test {} +', 'find'],
    ['find test -name a.test.mjs -exec node --test {} \\;', 'find'],
    ['echo test/a.test.mjs | xargs node --test', 'xargs'],
    ['docker run --rm img node --test a.test.mjs', 'docker'],
    ['docker compose run app sh -c "node --test a.test.mjs"', 'docker'],
    ['ssh host node --test a.test.mjs', 'ssh'],
    ['sudo -D app node --test a.test.mjs', 'sudo'],
    ['timeout 60 node --test a.test.mjs', 'timeout'],
    ['some-tool node --test a.test.mjs', 'some-tool'],
    // A program that never runs it is not known here either, and the note says only that.
    ['echo node --test a.test.mjs', 'echo'],
    ['npm run test -- node --test a.test.mjs', 'run'],
    ['npx vitest node --test a.test.mjs', 'vitest'],
    // npm runs a program from its own bins or installs a package of that name, so this `sh` is not
    // known to be the shell: `npx sh -c '…'` asked the registry for a package named `sh`, and
    // `npm exec sh -c '…'` stopped with EUSAGE, having taken `-c` for itself (both measured).
    ['npx sh -c "node --test a.test.mjs"', 'sh'],
    ['npm exec sh -c "node --test a.test.mjs"', 'sh'],
    ['$WRAP node --test a.test.mjs', '$WRAP'],
  ]
  for (const [command, word] of cases) {
    const runner = command.includes('tsx') ? 'tsx' : 'node'
    const reason = word.startsWith('$') ? 'rewritten' : 'prefix'
    assert.deepEqual(testRuns(command), [unread(runner, reason, word)], command)
  }
})

test('the words known to start the runner where it is, with its words, leave its files read', () => {
  // Each measured on 2026-09-17 to print the folder it started in and every word after the script.
  for (const command of [
    'FOO=1 BAR="b c" node --test a.test.mjs',
    'env node --test a.test.mjs',
    '/usr/bin/env -i PATH=/bin -u HOME -uTMP - FOO=1 -- node --test a.test.mjs',
    'time node --test a.test.mjs',
    'time -p node --test a.test.mjs',
    '/usr/bin/time -p node --test a.test.mjs',
    'nice node --test a.test.mjs',
    'nice -n 5 node --test a.test.mjs',
    'nice -n5 node --test a.test.mjs',
    'nice -5 node --test a.test.mjs',
    // Measured the same way: `nice -15` ran the runner, and `-15` is not the program.
    'nice -15 node --test a.test.mjs',
    'command node --test a.test.mjs',
    'exec node --test a.test.mjs',
    'FOO=1 env -u X time -p nice -n 5 exec node --test a.test.mjs',
  ]) {
    assert.deepEqual(testRuns(command), [run('node', 'a.test.mjs')], command)
  }
  // And npm's, measured to hand the runner `--test` and the files after it.
  for (const command of [
    'npx --yes tsx --test a.test.ts',
    'npx -y --no-install --offline --prefer-offline --ignore-scripts -q --quiet tsx --test a.test.ts',
    'npx --cache x --prefix sub -C sub --package tsx -p tsx tsx --test a.test.ts',
    'npx --loglevel=warn -- tsx --test a.test.ts',
    'npm exec --yes --package=tsx -- tsx --test a.test.ts',
    'npm --prefix sub exec -- tsx --test a.test.ts',
    'env -u X time npx --yes tsx --test a.test.ts',
  ]) {
    assert.deepEqual(testRuns(command), [run('tsx', 'a.test.ts')], command)
  }
})

test('an option of those programs that is not listed leaves the run unread, and says which', () => {
  const cases: [string, Unchecked['reason'], string][] = [
    // `env -S` split its text into new words (measured), and macOS's env refused `--unset=`.
    ['env -S "node --test a.test.mjs b.test.mjs"', 'prefix', '-S'],
    ['env --unset=HOME node --test a.test.mjs', 'prefix', '--unset=HOME'],
    ['env -P /opt/bin node --test a.test.mjs', 'prefix', '-P'],
    ['time -l node --test a.test.mjs', 'prefix', '-l'],
    ['command -v node --test a.test.mjs', 'prefix', '-v'],
    ['exec -a x node --test a.test.mjs', 'prefix', '-a'],
    ['nice -n $N node --test a.test.mjs', 'rewritten', '$N'],
    ['env -u $X node --test a.test.mjs', 'rewritten', '$X'],
    // `npx --foo node --test a b` and `npx --no node --test a b` ran `a` as a script (measured).
    ['npx --foo node --test a.test.mjs b.test.mjs', 'flag', '--foo'],
    ['npx --no node --test a.test.mjs b.test.mjs', 'flag', '--no'],
    // In `npm`, `-p` is `--parseable`, not the package.
    ['npm exec -p tsx -- tsx --test a.test.ts', 'flag', '-p'],
    ['npx --cache $C tsx --test a.test.ts', 'rewritten', '$C'],
  ]
  for (const [command, reason, word] of cases) {
    const runner = command.includes('tsx') ? 'tsx' : 'node'
    assert.deepEqual(testRuns(command), [unread(runner, reason, word)], command)
  }
})

test('a file named twice is named once', () => {
  assert.deepEqual(testRuns('tsx --test a.test.ts a.test.ts'), [run('tsx', 'a.test.ts')])
})

// ─────────────────────────── text holding --test that no run read is never passed in silence ──

/**
 * The rules above read the runs they know how to read, and each spelling a review found so far was
 * one they did not. So any word that holds `--test` and that no run read is said too, whenever
 * `node` or `tsx` is in the command. A command naming a file nobody wrote then either reads that
 * file, and fails on it, or says that something was not looked at.
 */
const failsOrSays = (command: string): boolean => {
  const runs = testRuns(command)
  return runs.some((run) => run.files.includes('never.test.mjs')) || runs.some((run) => run.unchecked !== null)
}

test('no command naming a file nobody wrote passes with nothing said', () => {
  // The third review's findings 1 and 3, and the backtick forms, each with one file that is there
  // and one that is not. Measured through `runVerify`, each ran `a.test.mjs`, skipped
  // `never.test.mjs` and exited 0; at 47ac339 each came back passed with no note.
  const text = `'node --test a.test.mjs never.test.mjs'`
  for (const command of [
    `npm exec --workspace=app --call ${text}`,
    `npx -w app -c ${text}`,
    `npm_config_workspace=app npx -c ${text}`,
    `NPM_CONFIG_WORKSPACES=true npx -c ${text}`,
    `npx --cache $X -c ${text}`,
    `nohup npx -c ${text}`,
    `npx --c=${text}`,
    `[ "$(node --test a.test.mjs never.test.mjs 2>&1 | grep -c '^not ok')" = 0 ]`,
    'echo "$(node --test a.test.mjs never.test.mjs)"',
    'node --test a.test.mjs never.test.mjs; echo $\'it\\\'s\'',
    'Node --test a.test.mjs never.test.mjs',
    'echo `node --test a.test.mjs never.test.mjs`',
    'x=`node --test a.test.mjs never.test.mjs`',
    'echo "`node --test a.test.mjs never.test.mjs`"',
    '`node --test a.test.mjs never.test.mjs`',
    'eval node --test a.test.mjs never.test.mjs',
    // And a runner in a redirection's target or an assignment, which the shell runs too.
    'node --test a.test.mjs > "$(node --test b.test.mjs never.test.mjs)"',
    'X="$(node --test b.test.mjs never.test.mjs)" node --test a.test.mjs',
    // A line this cannot split, which bash can: a here-document (measured: exit 0).
    "node --test a.test.mjs never.test.mjs; cat <<EOF\nit's\nEOF",
    // The fourth review's, and those found beside them. Each ran `a.test.mjs`, skipped
    // `never.test.mjs` and exited 0 (measured with `/bin/sh`); at 3aacd2c each passed with no note.
    'echo "$(echo "a #")"; node --test a.test.mjs never.test.mjs',
    '[ "$(printf "%s #" x)" = "x #" ] && node --test a.test.mjs never.test.mjs',
    '[ `printf 1 #count` -gt 0 ] && node --test a.test.mjs never.test.mjs',
    'echo "$(echo "a" && echo "b #")"; node --test a.test.mjs never.test.mjs',
    'echo "`echo "a #"`"; node --test a.test.mjs never.test.mjs',
    'echo "${HOME:+"a #"}"; node --test a.test.mjs never.test.mjs',
    'echo ${HOME:+a #}; node --test a.test.mjs never.test.mjs',
    String.raw`echo $$'\'; echo ' #'; node --test a.test.mjs never.test.mjs`,
    'node --test {a,never}.test.mjs',
    'node --test a.test.mjs {never,nope}.test.mjs',
    "node --test 'a.test.mjs' '{a,never}.test.mjs'",
    'node --tes{t,t} a.test.mjs never.test.mjs',
    'nodejs --test a.test.mjs never.test.mjs',
    'node22 --test a.test.mjs never.test.mjs',
    'node-22 --test a.test.mjs never.test.mjs',
    '${NODE_BIN} --test a.test.mjs never.test.mjs',
    '$NODE_BIN --test a.test.mjs never.test.mjs',
    '"$NODE_BIN" --test a.test.mjs never.test.mjs',
    'ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test a.test.mjs never.test.mjs',
    String.raw`node $'--te\x73t' a.test.mjs never.test.mjs`,
    String.raw`node $'--te\163t' a.test.mjs never.test.mjs`,
    String.raw`sh -c $'node --te\x73t a.test.mjs never.test.mjs'`,
    String.raw`sh -c $'node --test\cIa.test.mjs never.test.mjs'`,
    // And a file the runner leaves out, which is there (measured: `# tests 1`, exit 0).
    'node --test a.test.mjs node_modules/never.test.mjs',
  ]) {
    assert.ok(failsOrSays(command), `passes with nothing said: ${command}`)
  }
})

test('what those commands say, where it is not a failure', () => {
  const text = `'node --test a.test.mjs never.test.mjs'`
  const cases: [string, TestRun[]][] = [
    [`npx -w app -c ${text}`, [note(text)]],
    [`nohup npx -c ${text}`, [note(text)]],
    [`npx --c=${text}`, [unread('node', 'quoted', text)]],
    ['echo "$(node --test a.test.mjs never.test.mjs)"', [note('"$(node --test a.test.mjs never.test.mjs)"')]],
    ['echo `node --test a.test.mjs never.test.mjs`', [note('--test')]],
    ['echo "`node --test a.test.mjs never.test.mjs`"', [note('"`node --test a.test.mjs never.test.mjs`"')]],
    // An unquoted `eval` runs all its words as one command, not its first word alone.
    ['eval node --test a.test.mjs never.test.mjs', [unread('node', 'quoted', 'node --test a.test.mjs never.test.mjs')]],
    [
      'X="$(node --test b.test.mjs never.test.mjs)" node --test a.test.mjs',
      [run('node', 'a.test.mjs'), note('X="$(node --test b.test.mjs never.test.mjs)"')],
    ],
    ["node --test a.test.mjs never.test.mjs; cat <<EOF\nit's\nEOF", [note('--test')]],
    // A `$(…)` in double quotes keeps its own quotes, as the shell's does, so this line splits now.
    ['node --test a.test.mjs never.test.mjs; echo "$(echo \'x"y\')"', [run('node', 'a.test.mjs', 'never.test.mjs')]],
  ]
  for (const [command, runs] of cases) {
    assert.deepEqual(testRuns(command), runs, command)
  }
})

test('without node or tsx anywhere in the command, --test is some other runner\'s, and nothing is said', () => {
  // `cargo test --test <name>` names a Rust integration test, and is no runner this reads.
  for (const command of [
    'cargo test --test integration',
    `sh -c 'cargo test --test integration'`,
    'npm test -- --test',
    'cargo test --test x # no runner here',
    'N=nod; ${N}e --test a.test.mjs never.test.mjs',
  ]) {
    assert.deepEqual(testRuns(command), [], command)
  }
})

test('node or tsx anywhere in the command, even inside a longer word, in any case, has its --test said', () => {
  // Measured on 2026-09-17: `nodejs`, `node22` and `node-22` (links to Node 22.16.0), `$NODE_BIN`,
  // `"${NODE_BIN}"` and the repository's Electron run as Node each ran `a` and skipped `never`, and
  // exited 0. Whether the word names the runner is not a question this asks: holding back a task by
  // mistake is the cheap direction. So `nodemon`, `node_modules` and `addon.node` count too.
  for (const command of [
    'node --version && cargo test --test integration',
    'cargo test --test integration && TSX --version',
    '$NODE --test a.test.mjs never.test.mjs',
    'nodejs --test a.test.mjs never.test.mjs',
    'node22 --test a.test.mjs never.test.mjs',
    'node-22 --test a.test.mjs never.test.mjs',
    'NodeJS --test a.test.mjs never.test.mjs',
    '${NODE_BIN} --test a.test.mjs never.test.mjs',
    '$NODE_BIN --test a.test.mjs never.test.mjs',
    '"$NODE_BIN" --test a.test.mjs never.test.mjs',
    'ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test a.test.mjs never.test.mjs',
    'nodemon --test a',
    'ts-node --test a',
    'node_modules/x --test a',
    'tsx2 --test a',
    'cargo test --test x && cp build/addon.node dist/',
    'cargo test --test x && npm ls @types/node',
    // Spelled with an escape, in octal, or in a brace list, as the shell reads them.
    String.raw`$'\x6eode' --test a.test.mjs never.test.mjs`,
    String.raw`$(printf '\156\157\144\145') --test a.test.mjs never.test.mjs`,
    '{nod,x}e --test a.test.mjs never.test.mjs',
  ]) {
    assert.deepEqual(testRuns(command), [note('--test')], command)
  }
})

test('--test counts only as a word of its own', () => {
  // Nothing but a letter, a digit, `_` or `-` beside it makes it part of another word, once quotes
  // and backslashes are off: a quote, `=`, `$(`, a backtick or a blank is a word's edge.
  for (const word of ['"--test"', `'--test'`, '--te""st', '-\\-test', 'x=--test', '"$(--test)"', '`--test`', '--test=x']) {
    assert.deepEqual(testRuns(`echo node; echo ${word}`), [note(word)], word)
  }
  for (const word of ['--test-name-pattern', '--tests', '--testing', '--test_only', 'x--test', '---test']) {
    assert.deepEqual(testRuns(`echo node; echo ${word}`), [], word)
  }
})

test('--test with a value is not a run that is read', () => {
  // Measured on Node 22.16.0: `node --test=true fails.test.mjs` printed `# pass 1` and exited 0 for
  // a file whose one test throws. The runner started, and the process it ran the file in skipped it.
  assert.deepEqual(testRuns('node --test=true a.test.mjs'), [note('--test=true')])
  assert.deepEqual(testRuns('node --test= a.test.mjs'), [note('--test=')])
  assert.deepEqual(testRuns('node --test --test=true a.test.mjs'), [unread('node', 'flag', '--test=true')])
})

test('a cd written with quotes or backslashes, or in text a shell runs, is still a cd', () => {
  // Measured on 2026-09-17: each of these, before `&& node --test test/a.test.mjs test/b.test.mjs`,
  // ran both files in `app/` and exited 0. Read as written, both files were "not there".
  for (const [cd, word] of [
    ['\\cd app', '\\cd'],
    [`'cd' app`, `'cd'`],
    ['"cd" app', '"cd"'],
    ['c\\d app', 'c\\d'],
    [`$'cd' app`, `$'cd'`],
    ['eval "cd app"', '"cd app"'],
    ['eval cd app', 'cd'],
    [`sh -c 'cd app'`, `'cd app'`],
    [`npx -c 'cd app && pwd'`, `'cd app && pwd'`],
    ['X="$(cd app; pwd)"', 'X="$(cd app; pwd)"'],
    // Spelled with an escape, or as a brace list (both measured the same way).
    [String.raw`$'\x63d' app`, String.raw`$'\x63d'`],
    ['{cd,app}', '{cd,app}'],
  ] as const) {
    const command = `${cd} && node --test test/a.test.mjs test/b.test.mjs`
    assert.deepEqual(testRuns(command), [unread('node', 'moves', word)], command)
  }
  // A word that only holds the letters is not one.
  assert.deepEqual(testRuns('abcd app && node --test a.test.mjs'), [run('node', 'a.test.mjs')])
  assert.deepEqual(testRuns('./cd app && node --test a.test.mjs'), [run('node', 'a.test.mjs')])
})

test('a word anywhere that names npm\'s workspace setting leaves the runs npm starts unread', () => {
  // Measured with npm 10.9.2: after the first two, `npx node --test test/a.test.mjs test/b.test.mjs`
  // ran both of `app`'s files; the rest are the same setting written other ways.
  for (const [before, name] of [
    ['export npm_config_workspace=app;', 'npm_config_workspace'],
    ['npm_config_workspace=$(echo app)', 'npm_config_workspace'],
    ['NPM_CONFIG_WORKSPACE="$W"', 'NPM_CONFIG_WORKSPACE'],
    ['export Npm_Config_Workspaces=true &&', 'Npm_Config_Workspaces'],
    ['export npm_config_workspace; ', 'npm_config_workspace'],
    ['declare -x "npm_config_workspace=app";', 'npm_config_workspace'],
    ['npm_config_workspaces=yes', 'npm_config_workspaces'],
    ['eval "export npm_config_workspace=app";', 'npm_config_workspace'],
    // Spelled with an escape, or in a brace list; each ran both of `app`'s files (measured).
    [String.raw`export $'npm_config_workspac\x65'=app;`, 'npm_config_workspace'],
    ['export npm_config_{workspace,x}=app;', 'npm_config_workspace'],
  ] as const) {
    const command = `${before} npx node --test test/a.test.mjs test/b.test.mjs`
    assert.deepEqual(testRuns(command), [unread('node', 'workspace', name)], command)
  }
  // Measured to leave npm in the folder it started in.
  for (const before of ['export npm_config_workspaces=false;', 'npm_config_workspace=', `export npm_config_workspace='';`]) {
    const command = `${before} npx node --test test/a.test.mjs`
    assert.deepEqual(testRuns(command), [run('node', 'test/a.test.mjs')], command)
  }
  // A runner npm does not start does not read it, and neither does a longer name.
  assert.deepEqual(testRuns('export npm_config_workspace=app; node --test a.test.mjs'), [run('node', 'a.test.mjs')])
  assert.deepEqual(testRuns('npm_config_workspace_x=app npx node --test a.test.mjs'), [run('node', 'a.test.mjs')])
})

test('npm reads an option by its name, so dashes and short names do not hide one', () => {
  // Measured with npm 10.9.2: `--w=app` and `---w=app` before `node --test` ran `app`'s files, as
  // `npm --w=app exec --` did, and `npx --c='…'` ran its text.
  const cases: [string, TestRun[]][] = [
    ['npx --w=app node --test test/a.test.mjs', [unread('node', 'workspace', '--w=app')]],
    ['npx ---w=app node --test test/a.test.mjs', [unread('node', 'workspace', '---w=app')]],
    ['npm --w=app exec -- node --test test/a.test.mjs', [unread('node', 'workspace', '--w=app')]],
    ['npx --ws node --test test/a.test.mjs', [unread('node', 'workspace', '--ws')]],
    ['npx ---workspace app node --test test/a.test.mjs', [unread('node', 'workspace', '---workspace')]],
    [`npx --c='node --test a.test.mjs'`, [unread('node', 'quoted', `'node --test a.test.mjs'`)]],
    [`npm exec ---call 'node --test a.test.mjs'`, [unread('node', 'quoted', `'node --test a.test.mjs'`)]],
    // The ones npm passes over, spelled as npm reads them.
    ['npx --y --C=sub ---prefix=sub --p=tsx tsx --test a.test.ts', [run('tsx', 'a.test.ts')]],
    ['npx --yes=true --offline=false tsx --test a.test.ts', [run('tsx', 'a.test.ts')]],
  ]
  for (const [command, runs] of cases) {
    assert.deepEqual(testRuns(command), runs, command)
  }
})

test('an npm option not known to be passed over leaves the run unread, whatever it looks like', () => {
  // Measured with npm 10.9.2: after `-yq` and `--offl` (which nopt reads as `-y -q` and
  // `--offline`, and `npx` does not), `npx` ran `a.test.mjs` as a plain script.
  for (const [option, word] of [
    ['-yq', '-yq'],
    ['--offl', '--offl'],
    ['--workspac=app', '--workspac=app'],
    ['--offline=foo', '--offline=foo'],
    ['--quiet=x', '--quiet=x'],
    ['--no-install=x', '--no-install=x'],
    ['--foo=bar', '--foo=bar'],
    ['---', '---'],
    ['--=x', '--=x'],
    ['--prefix --yes', '--prefix'],
    ['--loglevel -q', '--loglevel'],
    ['-p tsx', '-p'],
  ] as const) {
    assert.deepEqual(testRuns(`npm ${option} exec -- node --test a.test.mjs b.test.mjs`), [unread('node', 'flag', word)], option)
  }
})

test('$\'…\' is read as bash reads it, backslashes and all', () => {
  // Measured: `node --test a missing; echo $'it\'s'` ran `a` and exited 0. Read as a quote that
  // never closes, it had no runs, and passed with nothing said.
  assert.deepEqual(testRuns(`node --test a.test.mjs never.test.mjs; echo $'it\\'s'`), [
    run('node', 'a.test.mjs', 'never.test.mjs'),
  ])
  assert.deepEqual(testRuns(`echo $'a\\\\'; node --test a.test.mjs`), [run('node', 'a.test.mjs')])
  // Anywhere else a backslash before a single quote does not escape it.
  assert.deepEqual(testRuns(`echo 'a\\'; node --test a.test.mjs`), [run('node', 'a.test.mjs')])
  assert.deepEqual(testRuns(`echo \\$'a'; node --test a.test.mjs`), [run('node', 'a.test.mjs')])
  assert.deepEqual(testRuns(`echo "$"'a\\'; node --test a.test.mjs`), [run('node', 'a.test.mjs')])
  // A file in one is a word the shell rewrites; text in one is read as its shell reads it.
  assert.deepEqual(testRuns(`node --test a.test.mjs $'b.test.mjs'`), [unread('node', 'rewritten', `$'b.test.mjs'`)])
  const text = `$'node --test a.test.mjs\\nnode --test \\'b.test.mjs\\''`
  assert.deepEqual(testRuns(`sh -c ${text}`), [unread('node', 'quoted', text), unread('node', 'quoted', text)])
})

test('a comment is read for --test too, as text the split takes for one may be text the shell runs', () => {
  // Measured with `/bin/sh`: the `#` in the first is inside backticks, and its run ran `a.test.mjs`,
  // skipped `never.test.mjs` and exited 0. Nothing here tells such a `#` from a real comment, so a
  // real one holding `--test` is said too, which costs a note.
  const cases: [string, TestRun[]][] = [
    [
      '[ `printf 1 #count` -gt 0 ] && node --test a.test.mjs never.test.mjs',
      [note('#count` -gt 0 ] && node --test a.test.mjs never.test.mjs')],
    ],
    ['echo x #; node --test a.test.mjs never.test.mjs', [note('#; node --test a.test.mjs never.test.mjs')]],
    ['node --test a.test.mjs b.test.mjs # --test', [run('node', 'a.test.mjs', 'b.test.mjs'), note('# --test')]],
    // Each comment ends at its newline, and a `#` after `>` starts one (measured: exit 2).
    [
      'node --test a.test.mjs # --test b\ntsx --test c.test.ts # tsx --test d',
      [run('node', 'a.test.mjs'), run('tsx', 'c.test.ts'), note('# --test b'), note('# tsx --test d')],
    ],
    ['node --test a.test.mjs >#--test', [run('node', 'a.test.mjs'), note('#--test')]],
    // A comment with no `--test` in it says nothing, and one in a command naming neither runner neither.
    ['node --test a.test.mjs # b.test.mjs is next', [run('node', 'a.test.mjs')]],
    ['cargo test # --test', []],
  ]
  for (const [command, runs] of cases) {
    assert.deepEqual(testRuns(command), runs, command)
  }
})

test('a $(…), ${…} or backtick in double quotes has quotes of its own, as the shell reads it', () => {
  // Measured with `/bin/sh` on 2026-09-17: each ran `a.test.mjs`, skipped `never.test.mjs` and
  // exited 0. The split once closed the outer quote at the inner one, took the rest for a comment,
  // and read no run.
  for (const command of [
    'echo "$(echo "a #")"; node --test a.test.mjs never.test.mjs',
    '[ "$(printf "%s #" x)" = "x #" ] && node --test a.test.mjs never.test.mjs',
    'echo "$(echo "a" && echo "b #")"; node --test a.test.mjs never.test.mjs',
    'echo "`echo "a #"`"; node --test a.test.mjs never.test.mjs',
    'echo "${HOME:+"a #"}"; node --test a.test.mjs never.test.mjs',
    // Outside quotes too, a `${…}` is one word, `#` and blanks and all.
    'echo ${HOME:+a #}; node --test a.test.mjs never.test.mjs',
  ]) {
    assert.deepEqual(testRuns(command), [run('node', 'a.test.mjs', 'never.test.mjs')], command)
  }
  // What such text only prints is not a run: this printed its text and ran nothing (measured), where
  // the split once read a run of `never.test.mjs)` and failed the check.
  const echoed = '"$(echo "a; node --test never.test.mjs")"'
  assert.deepEqual(testRuns(`echo ${echoed}`), [note(echoed)])
  // Nested ones, and `$((…))`, close where the shell closes them (measured: `a; b 3 {a}`).
  assert.deepEqual(testRuns('echo "$(echo "$(echo "a; b")")" "$((1+(2)))" "${x:-{a}}"; node --test a.test.mjs'), [
    run('node', 'a.test.mjs'),
  ])
  // A `(` inside `$(…)` is closed before it: this printed `a` and its text, and ran one run.
  const subshell = '"$( (echo a); echo "b; node --test never.test.mjs; c" )"'
  assert.deepEqual(testRuns(`echo ${subshell}; node --test a.test.mjs`), [run('node', 'a.test.mjs'), note(subshell)])
  // But bash 3.2 closes `${…}` at its first `}`, with a `{` before it or not: this ran
  // `node --test never.test.mjs` (measured: "Could not find").
  assert.deepEqual(testRuns('echo "${HOME:+{a} "b; node --test never.test.mjs; c"}"; node --test a.test.mjs'), [
    run('node', 'never.test.mjs'),
    run('node', 'a.test.mjs'),
  ])
  // A backslash keeps a backtick inside a backtick: this printed nothing of its text, and ran one run.
  const escapedTick = '"`echo x\\`y "b; node --test never.test.mjs; c"`"'
  assert.deepEqual(testRuns(`echo ${escapedTick}; node --test a.test.mjs`), [run('node', 'a.test.mjs'), note(escapedTick)])
  // In double quotes the second `$` of a pair opens one too: this was one word (measured).
  const paired = '"$$(echo "; node --test never.test.mjs; ")"'
  assert.deepEqual(testRuns(`echo ${paired}`), [note(paired)])
  // Inside one, a `$` before a quote opens `$'…'`, the second of a pair too (measured: `a'b`).
  assert.deepEqual(testRuns(String.raw`echo "$(echo $$'a\'b')"; node --test a.test.mjs`), [run('node', 'a.test.mjs')])
  // A quote that never closes inside one leaves the line unsplit (measured: exit 2).
  assert.deepEqual(testRuns(`echo "\${x:-'a}"; node --test a.test.mjs`), [note('--test')])
  assert.deepEqual(testRuns('echo "$(echo a; node --test a.test.mjs'), [note('--test')])
  assert.deepEqual(testRuns('echo "`node --test a.test.mjs"'), [note('--test')])
})

test('$$ is the shell\'s process id where a command is read, so the quote after it is a plain one', () => {
  // Measured with `/bin/sh` on 2026-09-17: `$$'\'` printed the process id and a backslash. So the
  // first ran `a.test.mjs`, skipped `never.test.mjs` and exited 0, and the second only echoed its
  // first run's text, ran `a.test.mjs` and passed. At 3aacd2c the first passed with nothing said,
  // and the second failed, calling `never.test.mjs` missing.
  assert.deepEqual(testRuns(String.raw`echo $$'\'; echo ' #'; node --test a.test.mjs never.test.mjs`), [
    run('node', 'a.test.mjs', 'never.test.mjs'),
  ])
  assert.deepEqual(testRuns(String.raw`echo $$'\'; echo '; node --test never.test.mjs; #'; node --test a.test.mjs`), [
    run('node', 'a.test.mjs'),
    note(`'; node --test never.test.mjs; #'`),
  ])
  // A third opens `$'…'`, and so does one after an escaped `$` (measured: `$$$'\'; echo '` and
  // `\$$'\'; echo '` each printed one word, and the run after it ran).
  for (const before of ['$$$', '\\$$']) {
    assert.deepEqual(testRuns(`echo ${before}'\\'; echo '; node --test a.test.mjs`), [run('node', 'a.test.mjs')], before)
  }
  // Outside quotes a pair before `(` is no substitution (measured: a syntax error) and one before
  // `{` is none either, while a third `$` opens `${…}` (measured: `$$${x:-a b}` printed two words).
  assert.deepEqual(testRuns('echo $$${x:-a #}; node --test a.test.mjs'), [run('node', 'a.test.mjs')])
  // Text a shell runs is read the same way: here `sh` was handed the process id and `\x20node`, and
  // ran no runner (measured: exit 127), so nothing in it is a run.
  assert.deepEqual(testRuns(String.raw`sh -c $$'\x20node --test a.test.mjs'`), [note('--test')])
  // And `$"…"` is a double quote whose `$` is not text: this ran its run (measured).
  const localized = '$"node --test a.test.mjs never.test.mjs"'
  assert.deepEqual(testRuns(`sh -c ${localized}`), [unread('node', 'quoted', localized)])
})

test('a brace list is its files, each looked for, and a brace that is not one leaves the run unread', () => {
  // Measured on 2026-09-17: `node --test test/{a,never}.test.mjs` ran `a` and exited 0, and so did
  // `node --test 'test/{a,never}.test.mjs'`, whose list the runner spreads itself.
  const cases: [string, TestRun[]][] = [
    ['node --test test/{a,never}.test.mjs', [run('node', 'test/a.test.mjs', 'test/never.test.mjs')]],
    [`node --test 'test/{a,never}.test.mjs'`, [run('node', 'test/a.test.mjs', 'test/never.test.mjs')]],
    [
      'node --test test/a.test.mjs test/{never,nope}.test.mjs',
      [run('node', 'test/a.test.mjs', 'test/never.test.mjs', 'test/nope.test.mjs')],
    ],
    ['tsx --test {a,b}/{c,d}.test.ts', [run('tsx', 'a/c.test.ts', 'a/d.test.ts', 'b/c.test.ts', 'b/d.test.ts')]],
    [`node --test {a,'b c'}.test.mjs`, [run('node', 'a.test.mjs', 'b c.test.mjs')]],
    [`node --test {'a,b'}.test.mjs`, [run('node', 'a.test.mjs', 'b.test.mjs')]],
    ['node --test {a,b..c}.test.mjs {..,x}/d.test.mjs', [run('node', 'a.test.mjs', 'b..c.test.mjs', '../d.test.mjs', 'x/d.test.mjs')]],
    // A choice that is a glob is left to whatever expands it, as any glob is.
    ['node --test test/{a,*}.test.mjs', [run('node', 'test/a.test.mjs')]],
    // The same file twice is looked for once.
    ['node --test {a,a}.test.mjs', [run('node', 'a.test.mjs')]],
  ]
  for (const [command, runs] of cases) {
    assert.deepEqual(testRuns(command), runs, command)
  }
  // Not a plain list, and each is spread, or left as written, in a way this does not follow
  // (measured: `{a..c}` was three words, `{a}`, `{}` and `{a,b` were as written, `x{a,}` was `xa x`).
  for (const word of [
    'test/{a..c}.test.mjs',
    'test/{a}.test.mjs',
    'test/{}.test.mjs',
    '{a,{b,c}}.test.mjs',
    'x{a,}.test.mjs',
    '{,a}.test.mjs',
    '{a,b.test.mjs',
    'a,b}.test.mjs',
    '{a,b}}.test.mjs',
    '{a,b}'.repeat(7) + '.test.mjs',
  ]) {
    assert.deepEqual(testRuns(`node --test a.test.mjs ${word}`), [unread('node', 'rewritten', word)], word)
  }
  // Before the files the shell spreads one into more words, one of which may be a file (measured:
  // `--test-name-pattern {a,b} a.test.mjs` ran `a.test.mjs` and passed over a file `b`). In quotes the
  // shell leaves it alone, and the runner does not spread an option.
  assert.deepEqual(testRuns('node --test --test-name-pattern {a,b} a.test.mjs'), [unread('node', 'rewritten', '{a,b}')])
  assert.deepEqual(testRuns('node --test --test-reporter={spec,tap} a.test.mjs'), [
    unread('node', 'rewritten', '--test-reporter={spec,tap}'),
  ])
  assert.deepEqual(testRuns('node --import=x{a,b} --test a.test.mjs'), [unread('node', 'rewritten', '--import=x{a,b}')])
  assert.deepEqual(testRuns(`node --test --test-name-pattern "{a,b}" --test-reporter='{x}' a.test.mjs`), [
    run('node', 'a.test.mjs'),
  ])
  // And a `--test` that a list makes is said (measured: `--tes{t,t}` was `--test --test`, and the run
  // ran `a` and passed over `never`).
  assert.deepEqual(testRuns('node --tes{t,t} a.test.mjs never.test.mjs'), [note('--tes{t,t}')])
  assert.deepEqual(testRuns('echo node; echo {x,--test}'), [note('{x,--test}')])
})

test('$\'…\' is read with every escape bash knows, so --test or a runner behind one is said', () => {
  // Measured with `/bin/sh` on 2026-09-17: each of these ran `a.test.mjs`, skipped `never.test.mjs`
  // and exited 0.
  for (const word of [String.raw`$'--te\x73t'`, String.raw`$'--te\163t'`]) {
    assert.deepEqual(testRuns(`node ${word} a.test.mjs never.test.mjs`), [note(word)], word)
  }
  for (const text of [
    String.raw`$'node --te\x73t a.test.mjs never.test.mjs'`,
    String.raw`$'node --test\cIa.test.mjs never.test.mjs'`,
    String.raw`$'node --test\ta.test.mjs never.test.mjs'`,
  ]) {
    assert.deepEqual(testRuns(`sh -c ${text}`), [unread('node', 'quoted', text)], text)
  }
  // Each escape that stands for a character: the letters, `\\`, a quote, `?`, octal, `\x`, and `\u`
  // and `\U`, which bash 3.2 leaves as written (measured) and a later bash reads. Here each stands
  // right after `--test`, where a character that is not part of a word ends it.
  const u = '\\' + 'u'
  for (const escape of [
    ...['\\a', '\\b', '\\e', '\\E', '\\f', '\\n', '\\r', '\\t', '\\v', '\\?'],
    ...['\\1', '\\041', '\\x2', '\\x21', `${u}21`, `${u}0021`, '\\U00000021', '\\cA'],
  ]) {
    const word = `$'--test${escape}'`
    assert.deepEqual(testRuns(`node a.test.mjs ${word}`), [note(word)], escape)
  }
  // An escape that stands for a letter makes a longer word, and one with nothing after it is as written.
  for (const escape of ['\\x41', '\\101', `${u}0041`, '\\U00000041', '\\q', '\\x', `${u}`]) {
    const word = `$'--test${escape}'`
    assert.deepEqual(testRuns(`node a.test.mjs ${word}`), [], escape)
  }
  // A code past the last character is left as written.
  assert.deepEqual(testRuns(String.raw`node a.test.mjs $'--test\UFFFFFFFF'`), [])
  // A `\c` does not take the quote that closes the text, and at the end it is a backslash (measured:
  // `$'a\c'x` printed `a\x`), which is taken off like any other.
  assert.deepEqual(testRuns(String.raw`node a.test.mjs $'--test\c'x`), [])
  assert.deepEqual(testRuns(String.raw`node a.test.mjs $'--test\c'`), [note(String.raw`$'--test\c'`)])
})

test('a file in node_modules is left out by the runner, so its run is not read, and says why', () => {
  // Measured on 2026-09-17 with Node 22.16.0 and 24.3.0, and tsx 4.23.12: after `node --test
  // pass.test.mjs`, each of these files, there and failing, was left out, and the run exited 0.
  for (const file of [
    'node_modules/fails.test.mjs',
    './node_modules/fails.test.mjs',
    'node_modules/pkg/test/x.test.mjs',
    './/node_modules/fails.test.mjs',
    '././node_modules/fails.test.mjs',
    'node_modules//fails.test.mjs',
    'a/../node_modules/fails.test.mjs',
    'a/b/../../node_modules/fails.test.mjs',
    'test/../node_modules/fails.test.mjs',
    'x/./../node_modules/fails.test.mjs',
    'node_modules/pkg/../fails.test.mjs',
    'node_modules/pkg/test/../../fails.test.mjs',
    'node_modules/./fails.test.mjs',
    'node_modules/',
    'node_modules/.',
    'node_modules/./',
    './node_modules/.',
    'node_modules/pkg/',
    'node_modules/pkg/../',
    `'node_modules'/fails.test.mjs`,
    'node_modules/*.test.mjs',
    `'node_modules/{fails,x}.test.mjs'`,
  ]) {
    assert.deepEqual(testRuns(`node --test pass.test.mjs ${file}`), [unread('node', 'excluded', file)], file)
  }
  // And these ran, and failed.
  for (const file of [
    'sub/node_modules/fails.test.mjs',
    '/tmp/ws/node_modules/fails.test.mjs',
    'NODE_MODULES/fails.test.mjs',
    'Node_Modules/fails.test.mjs',
    '../ws/node_modules/fails.test.mjs',
    '../node_modules/fails.test.mjs',
    './../node_modules/fails.test.mjs',
    '../ws/test/../node_modules/fails.test.mjs',
    'a/../../ws/node_modules/fails.test.mjs',
    'node_modules/../test/fails.test.mjs',
    'node_modules/./../test/fails.test.mjs',
    'node_modules//../test/fails.test.mjs',
    'node_modules/pkg/..',
    'node_modules',
    './node_modules',
  ]) {
    assert.deepEqual(testRuns(`node --test pass.test.mjs ${file}`), [run('node', 'pass.test.mjs', file)], file)
  }
  // tsx and npm hand the runner the same words, and the first word the run cannot place is said.
  assert.deepEqual(testRuns('npx tsx --test a.test.ts node_modules/x.test.ts'), [
    unread('tsx', 'excluded', 'node_modules/x.test.ts'),
  ])
  assert.deepEqual(testRuns('node --test node_modules/x.test.mjs $F'), [unread('node', 'excluded', 'node_modules/x.test.mjs')])
  assert.deepEqual(testRuns('node --test $F node_modules/x.test.mjs'), [unread('node', 'rewritten', '$F')])
})

test('a runner, npx and npm, and a shell are found whatever case they are written in', () => {
  // Measured on macOS, whose disk finds a program in any case: `Node --test a missing`,
  // `TSX --test a missing` and `NPX node --test a missing` each ran `a` and exited 0.
  const cases: [string, TestRun[]][] = [
    ['Node --test a.test.mjs never.test.mjs', [run('node', 'a.test.mjs', 'never.test.mjs')]],
    ['TSX --test a.test.ts', [run('tsx', 'a.test.ts')]],
    ['/usr/local/bin/NODE --test a.test.mjs', [run('node', 'a.test.mjs')]],
    ['NPX Tsx@4.23.12 --test a.test.ts', [run('tsx', 'a.test.ts')]],
    ['Npm exec -- node --test a.test.mjs', [run('node', 'a.test.mjs')]],
    ['NPX -w app node --test a.test.mjs', [unread('node', 'workspace', '-w')]],
    ['SH -c "node --test a.test.mjs"', [unread('node', 'quoted', '"node --test a.test.mjs"')]],
  ]
  for (const [command, runs] of cases) {
    assert.deepEqual(testRuns(command), runs, command)
  }
})

test('the shells and shell options that run -c text are known', () => {
  // Measured on 2026-09-17: each ran `node --test a missing` given as its `-c` text, and exited 0.
  for (const command of [
    'dash -c "node --test a.test.mjs"',
    'ksh -c "node --test a.test.mjs"',
    'bash +o posix -c "node --test a.test.mjs"',
    'bash --norc -c "node --test a.test.mjs"',
    'bash --norc --noprofile -o pipefail -c "node --test a.test.mjs"',
    '/bin/zsh -c "node --test a.test.mjs"',
  ]) {
    assert.deepEqual(testRuns(command), [unread('node', 'quoted', '"node --test a.test.mjs"')], command)
  }
})

test('npx and npm are known by their name, wherever they are', () => {
  assert.deepEqual(testRuns('/opt/homebrew/bin/npx -w app node --test a.test.mjs'), [unread('node', 'workspace', '-w')])
  assert.deepEqual(testRuns('/usr/local/bin/npx --yes tsx --test a.test.ts'), [run('tsx', 'a.test.ts')])
  assert.deepEqual(testRuns('./node_modules/.bin/npm exec tsx --test a.test.ts'), [unread('tsx', 'taken', '--test')])
})

test('a backslash before a newline', () => {
  // The shell drops the pair (measured: each of these ran `a.test.mjs`).
  // In text a shell runs, it is dropped before the text is read, and the runner is found.
  assert.deepEqual(testRuns('sh -c "no\\\nde --test a.test.mjs"'), [unread('node', 'quoted', '"no\\\nde --test a.test.mjs"')])
  // A word holding one is a word the shell rewrites, in double quotes too, and so is one standing
  // alone: what the run is given is not read further. That costs a check, and fails none.
  assert.deepEqual(testRuns('node --test --test-name-pattern "pa\\\nsses" a.test.mjs'), [
    unread('node', 'rewritten', '"pa\\\nsses"'),
  ])
  assert.deepEqual(testRuns('node --test a.test.mjs \\\n b.test.mjs'), [unread('node', 'rewritten', '\\\n')])
  // In single quotes it is as written, and a file with a backslash is not looked for.
  assert.deepEqual(testRuns(`node --test 'a\\\nb.test.mjs'`), [unread('node', 'rewritten', `'a\\\nb.test.mjs'`)])
})

test('a bare - is a file to the runner, and a program to npm', () => {
  // Measured: `node --test - a.test.mjs` and `node --test a.test.mjs -` each ran `a` and exited 0,
  // so the runner skipped `-` as it skips a file that is not there.
  assert.deepEqual(testRuns('node --test - a.test.mjs'), [run('node', '-', 'a.test.mjs')])
  assert.deepEqual(testRuns('node --test a.test.mjs -'), [run('node', 'a.test.mjs', '-')])
  // Measured: `npx - node --test …` and `npm exec - node --test …` each asked the registry for a
  // package named `-`, and ran nothing.
  assert.deepEqual(testRuns('npx - node --test a.test.mjs'), [unread('node', 'prefix', '-')])
  assert.deepEqual(testRuns('npm exec - node --test a.test.mjs'), [unread('node', 'prefix', '-')])
})

test('a second -- before the runner is npm\'s program, and the run is not read', () => {
  // Measured: `npx -- -- node --test a missing` and `npm exec -- -- node --test a missing` each
  // exited 1, and no test ran.
  assert.deepEqual(testRuns('npx -- -- node --test a.test.mjs never.test.mjs'), [unread('node', 'prefix', '--')])
  assert.deepEqual(testRuns('npm exec -- -- node --test a.test.mjs'), [unread('node', 'prefix', '--')])
})

test('when two reasons apply, the first in the run is said', () => {
  const cases: [string, TestRun[]][] = [
    // In the runner's own words, the first word it cannot place.
    ['node --test --foo $X a.test.mjs', [unread('node', 'flag', '--foo')]],
    ['node --test $X --foo a.test.mjs', [unread('node', 'rewritten', '$X')]],
    ['node --test --test-reporter $R --foo a.test.mjs', [unread('node', 'rewritten', '$R')]],
    // What `npm exec` takes, before what the runner would make of the rest.
    ['npm exec node --foo -- --test $X a.test.mjs', [unread('node', 'taken', '--foo')]],
    ['npm exec node $X --foo -- --test a.test.mjs', [unread('node', 'rewritten', '$X')]],
    // Before the runner, the first word walked; a workspace setting before npm's own options.
    ['npx --foo -w app node --test a.test.mjs', [unread('node', 'flag', '--foo')]],
    ['npx -w app --foo node --test a.test.mjs', [unread('node', 'workspace', '-w')]],
    ['npm_config_workspace=app npx --foo node --test a.test.mjs', [unread('node', 'workspace', 'npm_config_workspace')]],
    ['env -u $X -C app node --test a.test.mjs', [unread('node', 'rewritten', '$X')]],
    // A run's own reason before a `cd` anywhere; and text no run read is said beside both.
    ['cd app && npx -w app node --test a.test.mjs', [unread('node', 'workspace', '-w')]],
    ['cd app && node --test a.test.mjs; echo "node --test"', [unread('node', 'moves', 'cd'), note('"node --test"')]],
  ]
  for (const [command, runs] of cases) {
    assert.deepEqual(testRuns(command), runs, command)
  }
})

test('the options known here agree with the node running this', () => {
  // `node --help` prints an option that takes a value with `=...` or ` [...]` after it, one that
  // takes one only after `=` with `[=...]`, and one that takes none bare. A later Node may print
  // options not known here, which leave their runs unread; none may be known here as the other kind.
  const help = execFileSync(process.execPath, ['--help'], { encoding: 'utf8' })
  const listed = new Map<string, 'value' | 'boolean'>()
  for (const line of help.slice(0, help.indexOf('Environment variables:')).split('\n')) {
    const found = /^ {2}(-\S.*?)(?: {2,}|$)/.exec(line)?.[1]
    if (found === undefined) continue
    // A long name the description follows after a single space.
    const spec = /^--?[\w.-]+ [a-z]/i.test(found) ? found.split(' ')[0]! : found
    const names = spec.split(', ')
    const last = names[names.length - 1]!
    const kind = !last.includes('[=') && (last.includes('=') || last.endsWith(' [...]')) ? 'value' : 'boolean'
    for (const name of names) {
      const bare = name.replace(/\[?=.*$/, '').replace(/ \[\.\.\.\]$/, '')
      if (bare !== '--') listed.set(bare, kind)
    }
  }

  // The controls: a reading that found nothing, or read these two wrong, would make the rest vacuous.
  assert.ok(listed.size > 150, `read ${listed.size} options from node --help, so the pattern no longer fits it`)
  assert.equal(listed.get('--test-reporter'), 'value')
  assert.equal(listed.get('--test-only'), 'boolean')

  const wrong = [...listed].filter(([name, kind]) => flagKind(name) !== kind && flagKind(name) !== null)
  assert.deepEqual(wrong, [], `known here as the other kind than Node ${process.version} prints them`)
  if (process.version === 'v22.16.0') {
    const unknown = [...listed.keys()].filter((name) => flagKind(name) === null)
    assert.deepEqual(unknown, [], 'Node 22.16.0 prints these, and they are not known here')
  }
})

// ────────────────────────────────────────── what a person reads when one is not there ──

const ran = (over: Partial<Parameters<typeof missingTestsLine>[0]> = {}): Parameters<typeof missingTestsLine>[0] => ({
  command: 'npx tsx --test test/exists.test.ts test/never-written.test.ts',
  missing: ['test/never-written.test.ts'],
  exitCode: 0,
  timedOut: false,
  ...over,
})

test('the reason names the file, where it was looked for, and what the exit 0 does not show', () => {
  // "cannot count it as tested", not "did not test it": the files are looked for after the run, and
  // a VERIFY that writes a test, runs it and deletes it has tested a file that is not there now. And
  // the runner's rule, not what it did this time: the exit 0 may be another program's.
  const line = missingTestsLine(ran())
  assert.equal(
    line,
    '`test/never-written.test.ts` is not in the workspace folder, where VERIFY commands run, so this ' +
      'check cannot count it as tested. `tsx --test` exits 0 when some of the files it is given are ' +
      "missing and the others pass, so the command's exit 0 does not show that this file was tested.",
  )
  assert.doesNotMatch(line ?? '', /skip/i, 'nothing here knows whether the runner skipped the file')
})

test('several files, and node, are named as such', () => {
  assert.equal(
    missingTestsLine(
      ran({ command: 'node --test a.test.mjs b.test.mjs c.test.mjs d.test.mjs', missing: ['b.test.mjs', 'c.test.mjs', 'd.test.mjs'] }),
    ),
    '`b.test.mjs`, `c.test.mjs` and `d.test.mjs` are not in the workspace folder, where VERIFY commands ' +
      'run, so this check cannot count them as tested. `node --test` exits 0 when some of the files it ' +
      "is given are missing and the others pass, so the command's exit 0 does not show that these files " +
      'were tested.',
  )
})

test('only the runners that were given a missing file are named', () => {
  const both = missingTestsLine(
    ran({ command: 'tsx --test a.test.ts; node --test b.test.mjs', missing: ['a.test.ts', 'b.test.mjs'] }),
  )
  assert.match(both ?? '', /`tsx --test` and `node --test` exit 0 when some of the files they are given are missing/)

  const one = missingTestsLine(ran({ command: 'tsx --test a.test.ts; node --test b.test.mjs', missing: ['b.test.mjs'] }))
  assert.match(one ?? '', /`node --test` exits 0/)
  assert.doesNotMatch(one ?? '', /tsx/)
})

test('a run that failed or timed out anyway is not told its exit 0 hid anything', () => {
  for (const over of [{ exitCode: 1 }, { exitCode: null, timedOut: true }, { exitCode: 0, timedOut: true }]) {
    const line = missingTestsLine(ran(over)) ?? ''
    assert.match(line, /`test\/never-written\.test\.ts` is not in the workspace folder/, JSON.stringify(over))
    assert.doesNotMatch(line, /exit 0/, JSON.stringify(over))
  }
})

test('with nothing missing there is nothing to say', () => {
  assert.equal(missingTestsLine(ran({ missing: [] })), null)
})

// ────────────────────────────── what a person reads when a run's files were not looked for ──

test('a run whose files were not looked for says so and why, and never that a file was skipped', () => {
  // The files are named by where the command writes them, after the runner, not as files the runner
  // was given: for some of these reasons it may never see them.
  const lead = (runner: string): string => `The office did not look for the files this command names after \`${runner} --test\`: `
  const cases: [Unchecked, string][] = [
    [
      // True of a `cd` that is only an argument too, `--test-name-pattern cd`, which moves nothing.
      { runner: 'node', reason: 'moves', word: 'cd' },
      lead('node') +
        'the command has `cd` in it, and the office does not work out which folder that leaves the runner in.',
    ],
    [
      // True of a setting that leaves npm where it is too, which the office does not work out either.
      { runner: 'tsx', reason: 'workspace', word: '-w' },
      lead('tsx') +
        "`-w` names an npm workspace setting, which can start the runner in an npm workspace's own folder " +
        'rather than the workspace folder, where the office looks for them.',
    ],
    [
      { runner: 'node', reason: 'prefix', word: 'pnpm' },
      lead('node') +
        '`pnpm` comes before the runner, and the office does not know whether that starts the runner in the ' +
        'workspace folder with the words written after it.',
    ],
    [
      { runner: 'tsx', reason: 'taken', word: '--test' },
      lead('tsx') +
        '`npm exec` takes `--test` for itself, as it takes every option before a `--`, so the runner is not ' +
        'given it.',
    ],
    [
      { runner: 'node', reason: 'quoted', word: '"node --test a.test.mjs"' },
      lead('node') +
        'the runner is inside `"node --test a.test.mjs"`, which a shell runs as a command, and the office ' +
        'does not read inside it.',
    ],
    [
      { runner: 'node', reason: 'rewritten', word: '"$FILE"' },
      lead('node') +
        'the shell or the runner may read `"$FILE"` as something other than what is written, and the office ' +
        'does not work out what.',
    ],
    [
      // True of `--yes=foo` and `--test=true` too, which have a value and are still not read.
      { runner: 'tsx', reason: 'flag', word: '--foo' },
      lead('tsx') + 'the office does not know how `--foo` is read, so it cannot tell what the words after it are.',
    ],
    [
      // The runner's rule as measured, with the versions it was measured on, and not what it did: the
      // Node that ran the check is not known here. True after a `cd` too, which moves the folder.
      { runner: 'node', reason: 'excluded', word: 'node_modules/x.test.mjs' },
      lead('node') +
        '`node_modules/x.test.mjs` names a file in the `node_modules` folder of the folder the runner starts in, ' +
        'and the test runner in Node 22.16.0 and 24.3.0 leaves out every file there without a word.',
    ],
  ]
  for (const [unchecked, said] of cases) {
    assert.equal(uncheckedTestsLine([unchecked]), said, unchecked.reason)
    assert.doesNotMatch(said, /skip/i, unchecked.reason)
  }
})

test('text holding --test that no run read is said to be there, and nothing more', () => {
  // Nothing may have run there at all, `echo "node --test done"`, so the sentence says neither that
  // anything ran nor that anything was skipped, nor names a runner.
  const cases: [string, string][] = [
    [
      '"node --test done"',
      '`--test` appears in `"node --test done"`, which the office did not read as a test run, so it did not ' +
        'look for any test files that go with it.',
    ],
    ['--test', '`--test` appears where the office did not read a test run, so it did not look for any test files that go with it.'],
    [
      '--test=true',
      '`--test=true` appears where the office did not read a test run, so it did not look for any test files that go ' +
        'with it.',
    ],
  ]
  for (const [word, said] of cases) {
    assert.equal(uncheckedTestsLine([{ runner: null, reason: 'unread', word }]), said, word)
    assert.doesNotMatch(said, /skip|\bran\b|node --test`/i, word)
  }
})

test('the same reason twice is said once, two are both said, and none is nothing to say', () => {
  const cd: Unchecked = { runner: 'node', reason: 'moves', word: 'cd' }
  const flag: Unchecked = { runner: 'tsx', reason: 'flag', word: '--foo' }
  assert.equal(uncheckedTestsLine([cd, cd]), uncheckedTestsLine([cd]))
  assert.equal(uncheckedTestsLine([cd, flag]), `${uncheckedTestsLine([cd])} ${uncheckedTestsLine([flag])}`)
  assert.equal(uncheckedTestsLine([]), null)
})
