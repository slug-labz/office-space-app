/**
 * The harness panel, which is the second standing order with a button on it.
 *
 * *"Claims are verified, not believed."* A task carries a VERIFY condition, the harness runs it,
 * and this panel shows which of six things is true of each one. `every-button.dom.test.ts` checks
 * that its buttons reach handlers; nothing has asked what any of it renders.
 *
 * ## The distinction the whole outcome union exists for
 *
 * A command that could not be *started* is `not-run`, not `failed`. It used to be `failed`,
 * because a failed spawn leaves `passed: false` like any other bad exit — so a VERIFY naming a
 * command this machine does not have was reported as the task's work being wrong.
 *
 *     an office that conflated them would report broken plumbing as broken code
 *
 * That is the second standing order failing in the direction that costs most: a red task nobody
 * can fix, because the thing that is broken is not the thing being blamed.
 *
 * ## And the button is only offered when offering it would be honest
 *
 * The module says so in its header. A task already done, a task with no command, and a command
 * the workspace has refused are three different reasons not to offer a Run — and the fourth case,
 * a command the office would not run on its own, *is* offered, with `force` set and a label that
 * says what it is about to do. Offering it silently would be the office running something on
 * somebody's machine that its rules did not let it run alone.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { renderTaskList, summarise, type TaskHandlers } from '../src/renderer/views/tasks.js'
import type { ClickedTask, TaskReport } from '../src/main/harness.js'

installDom()

type Check = TaskReport['checks'][number]

const check = (over: Partial<{
  ref: string
  title: string
  state: string
  condition: string
  command: string | null
  verdict: unknown
  result: unknown
}> = {}): Check =>
  ({
    task: {
      ref: over.ref ?? '1',
      title: over.title ?? 'Build the thing',
      owner: 'builder',
      state: over.state ?? 'queued',
      condition: over.condition ?? '`npm test` exits 0',
      command: over.command === undefined ? 'npm test' : over.command,
    },
    verdict: over.verdict ?? { state: 'allowed', rule: 'Bash(npm test:*)' },
    result: over.result ?? null,
  }) as unknown as Check

const report = (checks: Check[], over: Partial<TaskReport> = {}): TaskReport =>
  ({ project: 'a-project', unreadable: 0, unrecognised: [], problem: null, checks, ...over }) as TaskReport

interface Panel {
  readonly host: El
  readonly rows: () => El[]
  readonly classesOf: (index: number) => string
  readonly buttons: () => El[]
  readonly ran: { only: ClickedTask; force: boolean }[]
  readonly text: () => string
}

function render(r: TaskReport): Panel {
  const host = document.createElement('div')
  const ran: { only: ClickedTask; force: boolean }[] = []
  const on: TaskHandlers = { onRun: (only, force) => ran.push({ only, force }) }
  renderTaskList(host, r, on)

  const all = (n: El): El[] => [n, ...n.children.flatMap(all)]
  return {
    host: host as unknown as El,
    ran,
    rows: () => all(host as unknown as El).filter((n) => n.classList.contains('task')),
    classesOf: (i) => String((all(host as unknown as El).filter((n) => n.classList.contains('task'))[i] as El | undefined)?.className ?? ''),
    buttons: () => all(host as unknown as El).filter((n) => n.tag === 'button'),
    text: () => ((host as unknown as El).textContent ?? '').replace(/\s+/g, ' '),
  }
}

test('a command that could not be started is not reported as the task failing', () => {
  // The distinction the union exists for. A failed spawn leaves `passed: false` like any other
  // bad exit, and calling that a failure blames the work for the plumbing.
  const brokenPlumbing = render(
    report([check({ result: { passed: false, error: 'spawn npm ENOENT', output: '' } })]),
  )
  const realFailure = render(
    report([check({ result: { passed: false, error: null, output: 'Expected 3, got 4', missing: [], unchecked: [] } })]),
  )

  // The control: both drew a row, so the classes below are about two rendered outcomes.
  assert.equal(brokenPlumbing.rows().length, 1, 'the unstartable command drew no row at all')
  assert.equal(realFailure.rows().length, 1, 'the failing command drew no row at all')

  assert.equal(
    brokenPlumbing.classesOf(0).includes('task--failed'),
    false,
    'a command this machine could not start is drawn as a failed task. The work is not wrong; ' +
      'the plumbing is — and a red task nobody can fix is worse than an honest "not run".',
  )
  assert.match(brokenPlumbing.classesOf(0), /task--not-run/, 'an unstartable command is not marked not-run')
  assert.match(realFailure.classesOf(0), /task--failed/, 'a genuinely failing check is not marked failed')
})

test('each of the six outcomes is drawn as itself', () => {
  const cases: { name: string; check: Check; expect: string }[] = [
    { name: 'done', check: check({ state: 'done' }), expect: 'task--done' },
    { name: 'uncheckable', check: check({ command: null }), expect: 'task--uncheckable' },
    { name: 'refused', check: check({ verdict: { state: 'denied', rule: 'Bash(rm:*)' } }), expect: 'task--refused' },
    { name: 'not run', check: check({}), expect: 'task--not-run' },
    { name: 'passed', check: check({ result: { passed: true, error: null, output: 'ok', missing: [], unchecked: [] } }), expect: 'task--passed' },
    { name: 'failed', check: check({ result: { passed: false, error: null, output: 'no', missing: [], unchecked: [] } }), expect: 'task--failed' },
  ]

  const wrong: string[] = []
  for (const c of cases) {
    const p = render(report([c.check]))
    if (!p.classesOf(0).includes(c.expect)) wrong.push(`${c.name}: expected ${c.expect}, got ${JSON.stringify(p.classesOf(0))}`)
  }
  assert.deepEqual(
    wrong,
    [],
    `these outcomes are indistinguishable on screen, so "we do not know" reads as one of the ` +
      `answers:\n  ${wrong.join('\n  ')}`,
  )
})

test('a Run button is offered only when offering it would be honest', () => {
  const offered = (c: Check): boolean => render(report([c])).buttons().length > 0

  assert.equal(offered(check({})), true, 'a queued, allowed, checkable task offers no way to check it')
  assert.equal(offered(check({ state: 'done' })), false, 'a task already done offers to run again as though it were outstanding')
  assert.equal(offered(check({ command: null })), false, 'a task with no command offers a button that could not run anything')
  assert.equal(
    offered(check({ verdict: { state: 'denied', rule: 'Bash(rm:*)' } })),
    false,
    'a command the workspace has denied offers a button — pressing it can only be refused, so it ' +
      'is a control whose whole purpose is to fail',
  )
})

test('a command the office would not run on its own is offered, and says so', () => {
  // Not hidden — a person may still want it — but never silently. `force` is how the caller
  // knows the rules did not let the office run this alone, and the label is how the person does.
  const p = render(report([check({ verdict: { state: 'unlisted' } })]))
  const button = p.buttons()[0]
  assert.ok(button, 'an unlisted command offers no way to run it at all')

  assert.match(
    button.textContent ?? '',
    /the office would not run this on its own/i,
    `the button reads ${JSON.stringify(button.textContent)}, so pressing it runs something the ` +
      `office would not run alone, and nothing said so`,
  )

  // Unlisted is not always "nothing allowed it". An allow rule can cover a command that an
  // unreadable settings file, or an untrusted workspace, keeps the office from running alone,
  // and the label is shown for all of them.
  assert.doesNotMatch(button.textContent ?? '', /nothing has authorised/i)

  button.dispatchEvent({ type: 'click', bubbles: true })
  // The row pressed and the command it named, not the number — `ClickedTask` says why.
  assert.deepEqual(
    p.ran,
    [{ only: { row: 0, command: 'npm test' }, force: true }],
    'the caller was not told to force this, or not told which row was pressed',
  )
})

test('an allowed command runs without force', () => {
  const p = render(report([check({})]))
  p.buttons()[0]?.dispatchEvent({ type: 'click', bubbles: true })
  assert.deepEqual(
    p.ran,
    [{ only: { row: 0, command: 'npm test' }, force: false }],
    'an allowed check was escalated as though nothing permitted it',
  )
})

test('no tasks says so, rather than drawing nothing', () => {
  const p = render(report([]))
  assert.match(
    p.text(),
    /No tasks written down yet/i,
    'an empty task list renders blank, which reads as a panel that failed to load rather than a ' +
      'project nobody has written tasks for',
  )
})

test('rows that could not be read are counted out loud', () => {
  // Reported, never dropped. A row the parser could not understand is not a row that is not
  // there — the fourth standing order, in the file that holds the project's own claims.
  const { note } = summarise(report([check({})], { unreadable: 2 }))
  assert.match(note, /2 row/i, `the summary does not mention unreadable rows: ${JSON.stringify(note)}`)
})

test('the summary counts what is outstanding, and refuses to offer a run when it cannot', () => {
  const outstanding = summarise(report([check({}), check({ ref: '2', state: 'done' })]))
  assert.match(outstanding.note, /2 tasks/, `expected a count of two: ${JSON.stringify(outstanding.note)}`)
  assert.match(outstanding.note, /1 outstanding/, 'the outstanding count is wrong or missing')

  const broken = summarise(report([], { problem: 'TASKS.md could not be read' }))
  assert.equal(broken.note, 'TASKS.md could not be read', 'a problem was replaced by a count of nothing')
  assert.equal(
    broken.canRunAll,
    false,
    'the panel offers to check everything in a project whose task file it could not read — there ' +
      'is nothing to check, and offering says otherwise',
  )
})

/**
 * A file full of tasks under a heading this office does not read.
 *
 * `parseTasks` skips rows outside `## In progress`, `## Queued` and `## Done`, and the reason is
 * good: `TASKS.md` holds prose and other tables, and counting every table row as a lost task
 * would be noise.
 *
 * The gap is between *a row in some other table* and **somebody's task list under a heading we do
 * not know**. Measured in the running app: three hundred `| 1 | … | … | … |` rows under
 * `## Backlog` produced
 *
 *     0 tasks · none outstanding
 *     No tasks written down yet.
 *
 * on a project with a three-hundred-line task file. That is the fourth standing order on the one
 * panel that answers *what is left to do*.
 */

test('a task list under a heading we do not read is not an absence of tasks', () => {
  const p = render(report([], { unrecognised: ['Backlog'] }))

  assert.doesNotMatch(
    p.text(),
    /No tasks written down yet/,
    'the panel said the project has no tasks about a file that has a table of them — it is the ' +
      'heading this office cannot read, not the work that is missing',
  )
  assert.match(p.text(), /Backlog/, 'the heading is not named, so nobody can tell which one to rename')
  assert.match(p.text(), /rename/i, 'the panel says something is wrong and not what to do about it')
})

test('and the summary says it too, because that is the line you see first', () => {
  const { note } = summarise(report([check({})], { unrecognised: ['To do', 'Backlog'] }))
  assert.match(note, /To do.*Backlog|Backlog.*To do/, `both headings should be named: ${JSON.stringify(note)}`)
  assert.match(note, /In progress, Queued or Done/, 'the fix is not in the sentence')
})

test('an empty project still reads as an empty project', () => {
  // The control, and the one that matters most: this warning must not appear on the common case.
  // A panel that says "there are tasks somewhere you cannot see" about a project with none is
  // worse than the bug it replaces.
  const p = render(report([]))
  assert.match(p.text(), /No tasks written down yet/)
  assert.doesNotMatch(p.text(), /rename/i, 'a project with no tasks was told to rename a heading')
})

test('tasks that were read are still the story, whatever else is in the file', () => {
  // A file can have both — a proper `## Queued` section and a stray `## Backlog`. The tasks that
  // were read come first, and the note is beside them rather than instead of them.
  const p = render(report([check({})], { unrecognised: ['Backlog'] }))
  assert.equal(p.rows().length, 1, 'the task that was read stopped being drawn')
  assert.match(summarise(report([check({})], { unrecognised: ['Backlog'] })).note, /1 task/)
})

test('the count does not present itself as a fact when the file was not read whole', () => {
  /**
   * `activity.ts` settles this for the strip: *"a bare number reads as a fact. It is only a fact
   * when the ledger opened and every line in it parsed."* Same panel-shaped problem here, and
   * the worst sentence this one can produce is
   *
   *     0 tasks · none outstanding
   *
   * above a file with three hundred rows in it. "None outstanding" is not a count at all — it is
   * a claim that the work is finished.
   */
  const { note } = summarise(report([], { unrecognised: ['Backlog'] }))

  assert.doesNotMatch(
    note,
    /none outstanding/,
    `the summary reads ${JSON.stringify(note)} — it claims the work is finished about a file it ` +
      `could not read`,
  )
  assert.match(note, /at least/, 'a count taken from a file that was not read whole is stated as settled')
})

test('and it is a plain count when the file was read whole', () => {
  // The control. "At least 4 tasks" on a file with nothing wrong would be hedging where there is
  // nothing to hedge, which is its own way of being untrustworthy.
  const { note } = summarise(report([check({}), check({ ref: '2' })]))
  assert.doesNotMatch(note, /at least/, `a clean read hedged: ${JSON.stringify(note)}`)
  assert.match(note, /2 tasks/)
  assert.match(note, /2 outstanding/)
})

/*
 * A verdict in the VERIFY column is named on the row it is in, worded for the task's state.
 *
 * A finished task closed on a verdict was closed on somebody's word; an open one will have
 * whatever the verdict quotes run as its check. Those are different warnings, and one sentence
 * for both would be wrong about one of them.
 */

const REAL_VERDICT = "PASS — file exists (3,267 bytes, 145 lines); `grep -ci 'coming soon'` = 2"

test('a done task whose VERIFY is a verdict says it was closed on somebody’s word', () => {
  const p = render(report([check({ state: 'done', condition: REAL_VERDICT, command: "grep -ci 'coming soon'" })]))
  assert.match(p.text(), /verdict, not a check/, `no warning on a task closed by a verdict: ${p.text()}`)
  assert.match(p.text(), /marked done on somebody/)
})

test('an open task whose VERIFY is a verdict says what will be run', () => {
  const p = render(report([check({ condition: 'PASS — `npm test` passed when I ran it earlier' })]))
  assert.match(p.text(), /verdict, not a check/)
  assert.match(p.text(), /runs the first backticked span/)
  assert.doesNotMatch(p.text(), /marked done/, 'an open task was described as closed')
})

test('an honest VERIFY carries no warning', () => {
  // The control. A warning on `npm test` exits 0 — the template's own example — would be noise
  // on the most common row there is.
  const p = render(report([check({}), check({ ref: '2', condition: 'reviewed by eye', command: null })]))
  assert.doesNotMatch(p.text(), /verdict/, `an honest cell was flagged: ${p.text()}`)
})

test('the summary counts verdicts, so a scrolled-past row is still said', () => {
  const { note } = summarise(
    report([check({}), check({ ref: '2', state: 'done', condition: REAL_VERDICT }), check({ ref: '3', condition: 'Done — see transcript', command: null })]),
  )
  assert.match(note, /2 VERIFY written as a verdict/, `the summary reads ${JSON.stringify(note)}`)

  const clean = summarise(report([check({})])).note
  assert.doesNotMatch(clean, /verdict/, `a clean list mentions verdicts: ${JSON.stringify(clean)}`)
})
