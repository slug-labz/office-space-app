/**
 * The harness panel — what this project says has to be true, and whether it is.
 *
 * Builds DOM from a `TaskReport` the caller has already fetched. Running a check is the
 * caller's business; this file only offers the button, and only when offering it would be
 * honest.
 */

import { isVerdict, missingTestsLine, outcomeOf, uncheckedTestsLine } from '../../shared/tasks.js'
import type { ClickedTask, TaskReport } from '../../main/harness.js'
import { line } from './work.js'

type Check = TaskReport['checks'][number]

export interface TaskHandlers {
  /**
   * The row pressed, and `force` when the office would not run its command on its own and the
   * user asked anyway.
   *
   * The row's *position* in this report, plus the command its button named — not its number. See
   * `ClickedTask`: a number is shared by every row that writes it down, and sending one ran all of
   * them.
   */
  readonly onRun: (only: ClickedTask, force: boolean) => void
}

/** The summary line under the panel's heading, and whether "check everything" is offerable. */
export function summarise(report: TaskReport): { note: string; canRunAll: boolean } {
  if (report.problem) return { note: report.problem, canRunAll: false }

  const outstanding = report.checks.filter((c) => c.task.state !== 'done').length
  const headings = report.unrecognised.map((h) => `“${h}”`).join(' and ')

  /**
   * The count is a fact only when the file was read whole.
   *
   * `activity.ts` settles this for the strip and the argument is the same here: a bare number is
   * read as settled, and *"0 tasks · none outstanding"* above a file with three hundred rows in
   * it is the worst sentence this panel can produce. So when there are tasks it could not place,
   * the count says **at least** and *"none outstanding"* is dropped — because that half is not a
   * count at all, it is a claim about work being finished.
   */
  const counted = `${report.checks.length} task${report.checks.length === 1 ? '' : 's'}`
  const verdicts = report.checks.filter((c) => isVerdict(c.task.condition)).length
  const note = [
    report.unrecognised.length > 0 ? `at least ${counted}` : counted,
    report.unrecognised.length > 0 ? '' : outstanding === 0 ? 'none outstanding' : `${outstanding} outstanding`,
    report.unreadable > 0 ? `${report.unreadable} row(s) could not be read` : '',
    // In the summary as well as on the row, because the row can be scrolled past and this line
    // is the one that answers whether the list can be believed.
    verdicts > 0 ? `${verdicts} VERIFY written as a verdict, not a check` : '',
    // Named, and with the fix in the sentence. A count would say something is wrong and leave
    // somebody to find out what; the heading is the whole of the answer.
    headings === ''
      ? ''
      : `tasks under ${headings}, which this office does not read — rename to In progress, Queued or Done`,
  ]
    .filter(Boolean)
    .join(' · ')

  return { note, canRunAll: outstanding > 0 }
}

/** Fill `host` with one row per task. */
export function renderTaskList(host: HTMLElement, report: TaskReport, on: TaskHandlers): void {
  host.replaceChildren()
  // Each row is drawn knowing where it sits, because that position is the only thing about it the
  // harness can tell apart from its neighbours.
  for (const [row, check] of report.checks.entries()) {
    host.appendChild(taskRow(check, row, on))
  }
  if (report.checks.length === 0) {
    // "None" and "none we could read" are different facts, and this is the panel that answers
    // *what is left to do*. A file of three hundred rows under `## Backlog` used to read as an
    // empty one here — the fourth standing order, on the surface where it costs most.
    host.appendChild(
      line(
        'work',
        report.unrecognised.length === 0
          ? 'No tasks written down yet.'
          : `No tasks this office can read. There are tasks under ` +
            `${report.unrecognised.map((h) => `“${h}”`).join(' and ')} — rename that heading to ` +
            `In progress, Queued or Done and they will appear here.`,
      ),
    )
  }
}

/** One task, and which of the six outcomes it is in. */
function taskRow(check: Check, row: number, on: TaskHandlers): HTMLElement {
  const { task, verdict } = check
  const outcome = outcomeOf(check)

  const el = document.createElement('div')
  el.className = `task task--${outcome}`

  const top = document.createElement('div')
  top.className = 'task__top'

  const title = document.createElement('span')
  title.className = 'task__title'
  title.textContent = task.title
  top.appendChild(title)

  const state = document.createElement('span')
  state.className = 'task__state'
  state.textContent = outcome === 'not-run' ? 'not checked' : outcome
  top.appendChild(state)
  el.appendChild(top)

  const owner = document.createElement('p')
  owner.className = 'task__owner'
  owner.textContent = task.owner ? `${task.owner} · #${task.ref}` : `#${task.ref}`
  el.appendChild(owner)

  const verify = document.createElement('p')
  verify.className = 'task__verify'
  verify.textContent = task.condition || 'no VERIFY condition'
  el.appendChild(verify)

  // Under the cell it is about, and worded for the state the task is in: a finished task was
  // closed on somebody's word, and an open one will have whatever it quotes run as its check.
  if (isVerdict(task.condition)) {
    const lint = document.createElement('p')
    lint.className = 'task__lint'
    lint.textContent =
      task.state === 'done'
        ? 'This VERIFY is a verdict, not a check — the task was marked done on somebody’s word. ' +
          'Replace it with the command that proves it.'
        : 'This VERIFY is a verdict, not a check. Write the command that settles the task — the ' +
          'office runs the first backticked span, whatever it was quoted as.'
    el.appendChild(lint)
  }

  if (check.result) {
    const result = check.result
    const out = document.createElement('pre')
    out.className = 'task__out'
    // Three different things, and only one of them is about the code.
    //
    // `verify.ts` is explicit that a command which cannot be *started* carries its reason
    // because "we could not run the check" is a different thing from "the check failed", and an
    // office that conflated them would report broken plumbing as broken code. It carried the
    // reason and nothing read it: `error` had no reader anywhere, so a VERIFY naming a command
    // this machine does not have rendered as the literal string `exit null` — the least
    // informative way to say the most fixable thing.
    const said = result.error
      ? `The check could not be run: ${result.error}\n\nThis is about the command in the VERIFY, not about the work.`
      : result.timedOut
        ? `Timed out after ${Math.round(result.durationMs / 1000)}s. A check that never finishes has not passed.

${result.output}`
        : result.output || `exit ${result.exitCode}`
    // A test file the VERIFY names that is not there, and then the test files nothing looked for.
    // Both go first, because what follows is the runner's own output, and a runner that skipped a
    // file prints a pass. Neither after an error: nothing ran, so there is nothing to qualify.
    const missing = result.error ? null : missingTestsLine(result)
    const unread = result.error ? null : uncheckedTestsLine(result.unchecked)
    out.textContent = [missing, unread, said].filter((part) => part !== null).join('\n\n')
    el.appendChild(out)
  }

  // Denied is never offered. The workspace said no, and a button here would imply otherwise.
  if (task.state !== 'done' && task.command !== null && verdict.state !== 'denied') {
    const command = task.command
    const run = document.createElement('button')
    run.type = 'button'
    run.className = 'task__run'
    run.textContent =
      verdict.state === 'allowed'
        ? 'Check it'
        : // Not "nothing has authorised this": an allow rule can cover a command that an
          // untrusted workspace or an unreadable settings file keeps the office from running alone.
          `Run \`${command}\` — the office would not run this on its own`
    // The command the label just quoted, so what is sent is what was read. A button that sent the
    // row's number sent something two buttons on screen could send identically.
    run.addEventListener('click', () => on.onRun({ row, command }, verdict.state !== 'allowed'))
    el.appendChild(run)
  }

  return el
}
