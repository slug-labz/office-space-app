/**
 * A Run button runs the task it is on, and no other.
 *
 * A task's number is "not assumed unique" (`shared/tasks.ts`), and nothing makes it so: each table
 * in `TASKS.md` starts counting again, so an unfinished row numbered 1 under `## In progress` and
 * another under `## Queued` is ordinary rather than exotic. The panel's Run button used to send
 * that number and nothing else (`views/tasks.ts`), `main.ts` handed it to `checkProject` as
 * `only`, and the harness ran every unfinished row that carried it.
 *
 * The button that reads "Run `…` — the office would not run this on its own" also sends `force`.
 * So a click on one row ran a second row's command, which nobody clicked and nothing authorised,
 * and the panel then showed that second row as checked.
 *
 * ## This drives the real button, and never names the identity
 *
 * The whole defect was that the payload the button sends does not pick out one row, so a test that
 * built the payload itself would be testing its own arithmetic. Instead the real `renderTaskList`
 * draws a real `TaskReport`, a real click is dispatched, and whatever the handler was handed goes
 * straight back into `checkProject` as `only` — `Parameters<TaskHandlers['onRun']>`, so this file
 * compiles against any identity the view chooses and asserts only that it is enough to name one
 * task.
 *
 * Each row's VERIFY touches a file of its own, by absolute path, so what ran is read off the disk
 * rather than off the report the harness writes about itself.
 *
 * Descended from the Honesty Sweep's F4.7 confirmation
 * (`docs/honesty-sweep-2026-09-17/confirm/f47/`, on `honesty-sweep-evidence-2026-09-17`): the
 * fixture and both assertions are that test's, the button half was a scratch script there, and
 * the temp folder now comes from `tempDir`.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { click, installDom, El } from './dom.js'
import { tempDir } from './temp-dir.js'
import { checkPressed, checkProject, outcomeOf, type TaskReport } from '../src/main/harness.js'
import { renderTaskList, type TaskHandlers } from '../src/renderer/views/tasks.js'

installDom()

/** Everything a press of one Run button hands the caller, whatever shape that is. */
type Click = Parameters<TaskHandlers['onRun']>

/**
 * A workspace with no settings file at all, so no command is authorised and only a click that
 * sends `force` runs one.
 */
async function workspace(t: TestContext): Promise<string> {
  const root = await tempDir(t, 'office-one-click-')
  await mkdir(join(root, 'projects', 'billing'), { recursive: true })
  return root
}

/** One task under `## In progress` and one under `## Queued`, each touching a file of its own. */
async function twoTables(
  root: string,
  refs: { readonly inProgress: string; readonly queued: string },
): Promise<{ clicked: string; other: string }> {
  const clicked = join(root, 'in-progress-ran')
  const other = join(root, 'queued-ran')
  await writeFile(
    join(root, 'projects', 'billing', 'TASKS.md'),
    `## In progress\n\n| # | Task | Owner | VERIFY |\n|---|---|---|---|\n` +
      `| ${refs.inProgress} | Lint the code | builder | \`touch '${clicked}'\` exits 0 |\n\n` +
      `## Queued\n\n| # | Task | Owner | VERIFY |\n|---|---|---|---|\n` +
      `| ${refs.queued} | Reset the database | builder | \`touch '${other}'\` exits 0 |\n`,
  )
  return { clicked, other }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Draw the panel the way the app does, and press the Run button belonging to the row at `row`.
 *
 * By row and not by button: a row with no command draws no button, so the nth button is not the
 * nth task. Getting that wrong is this defect in miniature, and it got it wrong once here.
 */
function pressRunOn(report: TaskReport, row: number): { sent: Click[]; label: string } {
  const host = new El('div')
  const sent: Click[] = []
  const on: TaskHandlers = { onRun: (...args) => void sent.push(args) }
  renderTaskList(host as unknown as HTMLElement, report, on)

  const all = (n: El): El[] => [n, ...n.children.flatMap(all)]
  const rows = all(host).filter((n) => n.className.split(' ').includes('task'))
  assert.equal(rows.length, report.checks.length, 'the panel drew a different number of rows than the report holds')
  const drawn = rows[row]
  assert.ok(drawn, `the panel drew ${rows.length} rows, so row ${row} is not on screen at all`)
  const button = all(drawn).find((n) => n.tag === 'button')
  assert.ok(button, `row ${row} offers no way to run it at all`)
  click(button)
  return { sent, label: button.textContent ?? '' }
}

/** What `main.ts` does with a press: run, that task only, forcing when the button said it would. */
const asMainDoes = (click: Click) => ({ run: true, only: click[0], force: click[1], trusted: true }) as const

test('control: a task with a number of its own is the only one a click runs', async (t) => {
  const root = await workspace(t)
  const { clicked, other } = await twoTables(root, { inProgress: '1', queued: '2' })

  const listed = await checkProject(root, 'billing', { trusted: true })
  const { sent } = pressRunOn(listed, 0)
  const press = sent[0]
  assert.ok(press, 'the In progress row\'s button told nobody it was pressed')

  const report = await checkProject(root, 'billing', asMainDoes(press))
  const inProgress = report.checks.find((c) => c.task.state === 'in-progress')
  const queued = report.checks.find((c) => c.task.state === 'queued')

  assert.equal(report.problem, null, `the task file was not read, so nothing below is about a click: ${report.problem}`)
  assert.equal(
    await exists(clicked),
    true,
    'the clicked task\'s `touch` left no file, so this test cannot tell from the disk what a click runs',
  )
  assert.equal(
    inProgress ? outcomeOf(inProgress) : 'missing',
    'passed',
    'the clicked task\'s command ran, and the panel does not show that task as passed',
  )
  assert.equal(await exists(other), false, 'a task with a different number ran on a click that was not on it')
  assert.equal(queued?.result, null, 'a task with a different number is shown with a result nobody asked for')
})

test('a click on one task numbered 1 runs no other task numbered 1', async (t) => {
  const root = await workspace(t)
  const { clicked, other } = await twoTables(root, { inProgress: '1', queued: '1' })

  // Control: the file holds two unfinished tasks numbered 1, one in each table, and nothing
  // authorises either command. So each row offers "Run `…` — the office would not run this on its
  // own", and each press carries `force`.
  const listed = await checkProject(root, 'billing', { trusted: true })
  assert.deepEqual(
    listed.checks.map((c) => [c.task.ref, c.task.state, c.verdict.state, c.task.command, c.result]),
    [
      ['1', 'in-progress', 'unlisted', `touch '${clicked}'`, null],
      ['1', 'queued', 'unlisted', `touch '${other}'`, null],
    ],
    'the task file does not hold the two unauthorised, unfinished tasks numbered 1 this test is about',
  )
  assert.deepEqual(
    [await exists(clicked), await exists(other)],
    [false, false],
    'a file was already there before anything was clicked, so the disk cannot say what the click ran',
  )

  // The person presses the In progress row's button, which names `touch '…/in-progress-ran'` and
  // no other command.
  const { sent, label } = pressRunOn(listed, 0)
  const press = sent[0]
  assert.ok(press, 'the In progress row\'s button told nobody it was pressed')
  assert.ok(
    label.includes(`touch '${clicked}'`) && !label.includes(`touch '${other}'`),
    `the button pressed reads ${JSON.stringify(label)}, so this test is not about a press that ` +
      `names one command`,
  )
  assert.equal(press[1], true, 'nothing authorised this command and the press did not say so, so no run is forced')

  const report = await checkProject(root, 'billing', asMainDoes(press))
  const queued = report.checks.find((c) => c.task.state === 'queued')

  assert.equal(
    await exists(other),
    false,
    'the Queued task\'s `touch` ran, although the button pressed was the In progress task\'s, and ' +
      'that button names only its own command. A forced Run on a task numbered 1 runs every ' +
      'unfinished task numbered 1, so a command that nobody clicked and nothing authorised ran.',
  )
  assert.equal(
    queued?.result ?? null,
    null,
    `the panel now shows the Queued task as "${queued ? outcomeOf(queued) : 'missing'}", with the ` +
      `output of a check nobody asked for`,
  )
  const ran = report.checks.filter((c) => c.result !== null).map((c) => c.task.state)
  assert.deepEqual(
    ran,
    ['in-progress'],
    `one press ran ${ran.length} tasks (${ran.join(', ')}). It may run the task it was on and nothing else.`,
  )
})

test('the second of two rows numbered 1 can be run, and runs alone', async (t) => {
  const root = await workspace(t)
  const { clicked, other } = await twoTables(root, { inProgress: '1', queued: '1' })

  // The other half of the same defect: with the number as the whole of the address there was no
  // way to press the Queued row *specifically*, because both buttons sent the same thing.
  const listed = await checkProject(root, 'billing', { trusted: true })
  const { sent, label } = pressRunOn(listed, 1)
  const press = sent[0]
  assert.ok(press, 'the Queued row\'s button told nobody it was pressed')
  assert.ok(label.includes(`touch '${other}'`), `the second row's button reads ${JSON.stringify(label)}`)

  const report = await checkProject(root, 'billing', asMainDoes(press))
  assert.deepEqual(
    [await exists(other), await exists(clicked)],
    [true, false],
    'pressing the second row either ran the first row\'s command, or ran nothing of its own — ' +
      'the two buttons are not telling the harness apart',
  )
  assert.deepEqual(
    report.checks.filter((c) => c.result !== null).map((c) => c.task.state),
    ['queued'],
    'the press on the Queued row did not settle exactly that row',
  )
})

test('two rows with the same number and the same command still run one at a time', async (t) => {
  const root = await workspace(t)
  const ran = join(root, 'ran')
  await writeFile(
    join(root, 'projects', 'billing', 'TASKS.md'),
    `## In progress\n\n| # | Task | Owner | VERIFY |\n|---|---|---|---|\n` +
      `| 1 | Run the suite | builder | \`touch '${ran}'\` exits 0 |\n\n` +
      `## Queued\n\n| # | Task | Owner | VERIFY |\n|---|---|---|---|\n` +
      `| 1 | Run the suite again | reviewer | \`touch '${ran}'\` exits 0 |\n`,
    )

  // The command alone is no more unique than the number: two rows can quote the same one, and
  // *"`npm test` exits 0"* twice in a file is ordinary. Here the disk cannot say what ran, because
  // both rows touch the same path — the report can, and a press the person made on one row that
  // settles two is the third standing order on the surface that says what was checked.
  const listed = await checkProject(root, 'billing', { trusted: true })
  const { sent } = pressRunOn(listed, 0)
  const press = sent[0]
  assert.ok(press, 'the In progress row\'s button told nobody it was pressed')

  const report = await checkProject(root, 'billing', asMainDoes(press))
  assert.deepEqual(
    report.checks.filter((c) => c.result !== null).map((c) => c.task.owner),
    ['builder'],
    'one press ran both rows, so the command ran twice and the panel shows a row nobody pressed ' +
      'as checked — the number and the command are each shareable, and only the row is not',
  )
})

test('a row the office cannot check still holds its place in the count', async (t) => {
  const root = await workspace(t)
  const clicked = join(root, 'in-progress-ran')
  const other = join(root, 'queued-ran')
  await writeFile(
    join(root, 'projects', 'billing', 'TASKS.md'),
    `## In progress\n\n| # | Task | Owner | VERIFY |\n|---|---|---|---|\n` +
      `| 1 | Read it over | reviewer | reviewed by eye |\n` +
      `| 2 | Lint the code | builder | \`touch '${clicked}'\` exits 0 |\n\n` +
      `## Queued\n\n| # | Task | Owner | VERIFY |\n|---|---|---|---|\n` +
      `| 2 | Reset the database | builder | \`touch '${other}'\` exits 0 |\n`,
  )

  // The view counts rows in `TaskReport.checks` and the harness counts them in the list it parsed.
  // Those are the same count only because an uncheckable row — a VERIFY naming nothing runnable —
  // gets a check of its own rather than being skipped. If one side ever stopped counting it, every
  // press below it would name its neighbour, which is the defect this fix is about wearing a
  // different hat.
  const listed = await checkProject(root, 'billing', { trusted: true })
  assert.equal(listed.checks.length, 3, 'the uncheckable row is not in the list the view numbers')
  assert.equal(listed.checks[0]?.task.command, null, 'the first row is not the uncheckable one')

  const { sent } = pressRunOn(listed, 2)
  const press = sent[0]
  assert.ok(press, 'the Queued row\'s button told nobody it was pressed')

  const report = await checkProject(root, 'billing', asMainDoes(press))
  assert.deepEqual(
    [await exists(other), await exists(clicked)],
    [true, false],
    'a press below an uncheckable row ran the wrong row\'s command, or none at all',
  )
  assert.deepEqual(
    report.checks.filter((c) => c.result !== null).map((c) => c.task.state),
    ['queued'],
    'the two sides are not numbering the same rows',
  )
})

test('a list that changed under the person runs nothing', async (t) => {
  const root = await workspace(t)
  const { clicked, other } = await twoTables(root, { inProgress: '1', queued: '1' })

  // A press carries an identity read off the list on screen, and `TASKS.md` is hand-edited —
  // agents rewrite it mid-turn. So the row a press names may not be the row that was drawn by the
  // time it arrives, and a forced run of a command nobody saw is the same defect with a different
  // cause. Whatever the identity is, it has to notice.
  const listed = await checkProject(root, 'billing', { trusted: true })
  const { sent } = pressRunOn(listed, 0)
  const press = sent[0]
  assert.ok(press, 'the In progress row\'s button told nobody it was pressed')

  const swapped = join(root, 'rewritten-ran')
  await writeFile(
    join(root, 'projects', 'billing', 'TASKS.md'),
    `## In progress\n\n| # | Task | Owner | VERIFY |\n|---|---|---|---|\n` +
      `| 1 | Something else entirely | builder | \`touch '${swapped}'\` exits 0 |\n`,
  )

  const report = await checkProject(root, 'billing', asMainDoes(press))
  assert.deepEqual(
    [await exists(swapped), await exists(clicked), await exists(other)],
    [false, false, false],
    'the task file was rewritten between the listing and the press, and a command the person ' +
      'never saw was forced anyway',
  )
  assert.equal(
    report.checks.filter((c) => c.result !== null).length,
    0,
    'something ran on a press whose row is no longer the row that was drawn',
  )
})

// ───────────────────────────────────────── the press as it arrives, before anything has read it ──

/*
 * `checkPressed` is the whole of the `tasks:verify` handler, and the arguments it gets have crossed
 * from the renderer, which draws model output and tool results. So they arrive as `unknown` and are
 * read rather than trusted.
 *
 * The direction of that reading is the subject here, not its return value. A payload this office
 * cannot read used to leave `only` off the options it built, and a `checkProject` with no `only`
 * runs *every* unfinished task — with `force` still honoured. That is the defect at the top of this
 * file, reachable from any malformed payload, so the tests below assert what the handler **does**:
 * nothing on the disk, no results in the report, and a reason given.
 */

/** A project whose two rows are unauthorised and each touch a file of their own. */
async function pressable(t: TestContext): Promise<{ root: string; clicked: string; other: string }> {
  const root = await workspace(t)
  const { clicked, other } = await twoTables(root, { inProgress: '1', queued: '1' })
  return { root, clicked, other }
}

/** Every payload that is not a press this office can read, and how each one is malformed. */
const UNREADABLE: readonly (readonly [string, unknown])[] = [
  ['a bare string', '1'],
  ['a number', 1],
  ['a boolean', true],
  ['an array', [0, "touch '/tmp/x'"]],
  ['a row that is a string', { row: '0', command: "touch '/tmp/x'" }],
  ['a negative row', { row: -1, command: "touch '/tmp/x'" }],
  ['a row that is not whole', { row: 0.5, command: "touch '/tmp/x'" }],
  ['a row that is NaN', { row: Number.NaN, command: "touch '/tmp/x'" }],
  ['no command at all', { row: 0 }],
  ['a command that is not a string', { row: 0, command: 42 }],
  ['a command that is null', { row: 0, command: null }],
  ['an empty object', {}],
]

for (const [how, payload] of UNREADABLE) {
  test(`a press the office cannot read runs nothing: ${how}`, async (t) => {
    const { root, clicked, other } = await pressable(t)

    // Both values of `force`, and that is not thoroughness for its own sake. With `force: true`
    // alone these tests were also satisfied by the *other* guard below — the one that refuses a
    // force with no task named — so a mutation that dropped this guard entirely left them green
    // (measured). `false` is the value that pins this guard on its own.
    for (const force of [true, false]) {
      const report = await checkPressed(root, 'billing', payload, force)

      assert.deepEqual(
        [await exists(clicked), await exists(other)],
        [false, false],
        `a press the office could not read (${how}, force=${force}) ran a command anyway — an ` +
          `unreadable argument must not fall back to running everything`,
      )
      assert.deepEqual(
        report.checks.filter((c) => c.result !== null).map((c) => c.task.title),
        [],
        `a press the office could not read (${how}, force=${force}) settled a task, so the panel ` +
          `claims a check nobody asked for`,
      )
      assert.notEqual(
        report.problem,
        null,
        `a press the office could not read (${how}, force=${force}) was refused silently — the ` +
          `panel shows no reason, so a renderer bug looks like a task list with nothing in it`,
      )
    }
  })
}

test('a press the office can read runs that one task and no other', async (t) => {
  const { root, clicked, other } = await pressable(t)

  // The same entry point, with a payload shaped the way the view sends it. Without this the tests
  // above would all pass against a handler that refuses everything.
  const report = await checkPressed(root, 'billing', { row: 0, command: `touch '${clicked}'` }, true)

  assert.equal(report.problem, null, `a readable press was refused: ${report.problem}`)
  assert.deepEqual(
    [await exists(clicked), await exists(other)],
    [true, false],
    'a readable press did not run its own task, or ran its neighbour as well',
  )
  assert.deepEqual(
    report.checks.filter((c) => c.result !== null).map((c) => c.task.state),
    ['in-progress'],
    'a readable press settled something other than exactly the row it named',
  )
})

test('a press that names nothing is a request, not something unreadable', async (t) => {
  const { root, clicked, other } = await pressable(t)

  // `null` is the "check everything" button. Refusing it alongside the payloads above would be the
  // opposite mistake and would make every one of those tests pass for the wrong reason, so this is
  // the control for them: the list comes back whole, with a reason for nothing.
  const report = await checkPressed(root, 'billing', null, false)

  assert.equal(report.problem, null, `the "check everything" press was refused: ${report.problem}`)
  assert.deepEqual(
    report.checks.map((c) => c.task.title),
    ['Lint the code', 'Reset the database'],
    'a press that named no task came back without the tasks it was asked about',
  )
  // Nothing ran here because this fixture has no settings file and is nobody's trusted workspace,
  // which is `checkProject`'s business and is covered in `harness.test.ts`. What matters at this
  // boundary is that the press was *read* rather than refused.
  assert.deepEqual(
    [await exists(clicked), await exists(other)],
    [false, false],
    'an unauthorised command ran unattended on a press that forced nothing',
  )
})

test('a press that names no task cannot force anything', async (t) => {
  const { root, clicked, other } = await pressable(t)

  // Measured on this branch before the guard existed: `null` with `force` ran both rows and left
  // both files, because omitting `only` and forcing are the two halves of the defect at the top of
  // this file. `force` means a person saw a specific command, so it needs a task to be about.
  const report = await checkPressed(root, 'billing', null, true)

  assert.notEqual(
    report.problem,
    null,
    'a press that named no task was allowed to force, so one press can still force every ' +
      'unfinished row in the project',
  )
  assert.deepEqual(
    [await exists(clicked), await exists(other)],
    [false, false],
    'a press that named no task forced a command the workspace had not authorised',
  )
  assert.deepEqual(
    report.checks.filter((c) => c.result !== null).map((c) => c.task.title),
    [],
    'a press that named no task settled tasks nobody pressed',
  )
})

test('only an exact `true` asks to force, and an unreadable press is refused regardless', async (t) => {
  const { root, clicked, other } = await pressable(t)

  // `force` crosses as `unknown` too. Anything that is not exactly `true` is nobody asking, which
  // is the same direction as everything above.
  for (const force of [true, false, 'true', 1, null, undefined, {}]) {
    const report = await checkPressed(root, 'billing', { row: '0', command: `touch '${clicked}'` }, force)
    assert.notEqual(report.problem, null, `an unreadable press with force=${String(force)} was not refused`)
    assert.deepEqual(
      [await exists(clicked), await exists(other)],
      [false, false],
      `an unreadable press with force=${String(force)} ran a command`,
    )
  }

  // And a readable press whose force is merely truthy does not get to force: the row is unlisted
  // here, so a run would mean the string `'true'` was taken for somebody asking.
  const truthy = await checkPressed(root, 'billing', { row: 0, command: `touch '${clicked}'` }, 'true')
  assert.equal(truthy.problem, null, `a readable press was refused: ${truthy.problem}`)
  assert.equal(
    await exists(clicked),
    false,
    'a force that was not exactly `true` ran a command the workspace had not authorised',
  )
})
