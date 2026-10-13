/**
 * The harness.
 *
 * `CLAUDE.md` has said since the first commit that every task carries a VERIFY condition and
 * that the harness checks it. There was no harness. This is it, and it is deliberately small:
 * read what the project says has to be true, run the checks the workspace has already agreed
 * the office may run, and report exactly what happened.
 *
 * ## Four outcomes, not two
 *
 * A task is not pass-or-fail. It is:
 *
 *   **passed** — the command exited zero, and no file it hands `tsx --test` or `node --test` is
 *     missing (`verify.ts`). The only claim the office will make on its own. A run whose files
 *     could not be placed is not looked at, and its result says so.
 *   **failed** — it ran and did not.
 *   **uncheckable** — the VERIFY names nothing runnable. Somebody wrote "reviewed by eye", and
 *     that is a real condition; it is simply not one the office can settle.
 *   **not run** — the command exists and nothing the office may act on alone says it may run
 *     unattended, so a person decides.
 *
 * Collapsing the last two into "failed" would be a lie in one direction, and into "passed" a
 * lie in the other. Both are worse than saying which it was.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { judge, readPolicy, type Policy, type Verdict } from './permissions.js'
import { workspaceTrust } from './trust.js'
import { runVerify, type VerifyResult } from './verify.js'
import { outcomeOf, parseTasks, type Task, type TaskOutcome } from '../shared/tasks.js'
import { isSafeProjectId } from './removal.js'
import { OFFICE_PROJECT } from '../shared/ipc.js'
import { PROJECTS_DIR } from './projects.js'

const TASKS_FILE = 'TASKS.md'

export interface TaskCheck {
  readonly task: Task
  /** Whether the office was allowed to run this on its own. */
  readonly verdict: Verdict
  /** Null when nothing was run — because it could not be, or was not permitted to be. */
  readonly result: VerifyResult | null
}

export interface TaskReport {
  readonly project: string
  readonly checks: readonly TaskCheck[]
  /** Rows in the file that could not be read as tasks. Reported, never dropped. */
  readonly unreadable: number
  /**
   * Headings holding what looks like a task table, that this office does not know.
   *
   * Named rather than counted, because the fix is to rename one and a number cannot say which.
   * See `parseTasks`.
   */
  readonly unrecognised: readonly string[]
  /** Why there is nothing to report, when there is nothing to report. */
  readonly problem: string | null
}

/**
 * This project's task file, and only this project's.
 *
 * The name arrives over IPC and is interpolated into a path, so it is checked before it becomes
 * one. `checkProject(root, '../..')` read a `TASKS.md` from outside the workspace entirely and
 * reported its rows as the project's work — and the harness runs the first backticked command in
 * each VERIFY, so a file nobody in this office wrote could put commands in front of it. The
 * allow-list in `.claude/settings.json` is what decides whether one runs; it is not what decides
 * whose file they came from.
 *
 * `isSafeProjectId` is the check `archiveProject` and `deleteProject` already use, rather than a
 * fourth spelling of the same question.
 */
async function readTasks(root: string, project: string): Promise<{ markdown: string } | { problem: string }> {
  // The unscoped conversation is not a project and never was a directory — `OFFICE_PROJECT` is
  // the empty string and says so where it is declared. It reached the guard below and was told
  // it was not a project in this office, quoting an empty string at somebody who had simply
  // opened the task panel without picking a project. Found by opening it.
  //
  // Before the guard existed this fell through to `join(root, 'projects', '', TASKS_FILE)`, read
  // nothing, and offered to copy the template — which is advice about a file that would sit
  // where no project can see it. Neither message was true; this one is.
  if (project === OFFICE_PROJECT) {
    return {
      problem:
        'This is the office conversation rather than a project, so there is no task list to ' +
        'check. Open a project to see its work.',
    }
  }

  if (!isSafeProjectId(project)) {
    return { problem: `"${project}" is not a project in this office.` }
  }

  const path = join(root, PROJECTS_DIR, project, TASKS_FILE)
  try {
    return { markdown: await readFile(path, 'utf8') }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return {
      problem:
        code === 'ENOENT'
          ? `This project has no ${TASKS_FILE}. Copy it from projects/_TEMPLATE/ and the office can start checking work.`
          : `${TASKS_FILE} could not be read: ${(err as Error).message}`,
    }
  }
}

/**
 * Which one task a person asked to run: the row they pressed, and the command it named.
 *
 * ## Why this is unique, when the number that used to be here was not
 *
 * The number looked unique too, which is the whole reason this type exists. `Task.ref` is "the
 * number in the first column, as written. Not assumed unique" (`shared/tasks.ts`), and `TASKS.md`
 * starts counting again under each heading — so an unfinished row 1 under `## In progress` and
 * another under `## Queued` is ordinary. Matching on it ran *every* row that carried it, and a
 * press on one task executed a command nobody pressed and nothing authorised.
 *
 * **`row` is unique because it is a position, not a name.** It indexes `TaskReport.checks`, which
 * this function builds one entry at a time in the order `parseTasks` returned them, so one index
 * is one row by construction. There is nothing left to assume: two rows cannot share a position
 * the way they can share a number, a title or a command.
 *
 * **`command` is here because a position is only unique inside the list it came from.** `TASKS.md`
 * is hand-edited and agents rewrite it mid-turn, so the file can change between the listing the
 * person read and the press arriving. Requiring the command to still match is what keeps `force`
 * meaning what it says below — *this person saw this command* — instead of forcing whatever has
 * since moved into that position. When it no longer matches, nothing runs.
 */
export interface ClickedTask {
  /** Where the row sat in the list the person was shown: an index into `TaskReport.checks`. */
  readonly row: number
  /** The command that row's button named, verbatim. */
  readonly command: string
}

export interface HarnessOptions {
  /**
   * Run the checks, or only report what would be checked.
   *
   * Listing is free and safe and is what the UI asks for when it opens. Running spends time and
   * touches the machine, so it is always something somebody asked for.
   */
  readonly run?: boolean
  /** Check only this task. Used when a person runs one by hand. */
  readonly only?: ClickedTask
  /**
   * Run a command the office would not run on its own.
   *
   * Only ever true because a person clicked the specific task, having seen the specific
   * command. Never set by anything automatic — that is the entire distinction this flag exists
   * to preserve.
   */
  readonly force?: boolean
  readonly timeoutMs?: number
  /**
   * Override the trust check. Tests only — a fixture workspace is nobody's real machine.
   *
   * Production never sets this, because the whole point is that the answer comes from what the
   * person actually agreed to rather than from what the code would prefer.
   */
  readonly trusted?: boolean
}

/**
 * Read a project's tasks, and check the ones we may.
 *
 * A denied command is never run, `force` or not. The workspace said no, and a click in a UI is
 * not a licence to override what the workspace declared — if somebody wants it run, the honest
 * path is to change the rule that says it may not be.
 */
export async function checkProject(
  root: string,
  project: string,
  options: HarnessOptions = {},
): Promise<TaskReport> {
  const file = await readTasks(root, project)
  if ('problem' in file) {
    return { project, checks: [], unreadable: 0, unrecognised: [], problem: file.problem }
  }

  const { tasks, unreadable, unrecognised } = parseTasks(file.markdown)

  /*
   * What this harness may act on without a person.
   *
   * **Allow rules only from a trusted workspace.** This harness reads `.claude/settings.json`
   * and runs what it permits — which means that without this check it would honour an allowlist
   * Claude Code itself is ignoring, and the trust prompt would be a gate with a door beside it. A
   * repository could ship `Bash(*)` and a VERIFY of its choosing and have it run on a machine
   * whose owner never agreed to anything. Unknown counts as untrusted here, which is the
   * opposite of how `trust.ts` reports it and is right for the same reason: being unable to tell
   * is not permission, and this is the place where the answer runs commands.
   *
   * **And only when the read is complete.** While `readPolicy` calls it `incomplete`, the rules
   * it returns may lack the deny rule that would have refused the command, so what remains is
   * not what was written. `triageAgainst` uses none of the allow rules in that state either. This
   * harness used to run whatever the other file allowed.
   *
   * **Deny rules from whatever could be read, trusted or not.** A deny rule can only stop
   * something, and a click is no licence past one. Claude Code enforces a project's deny rules
   * in a folder nobody has trusted, and not its allow rules (measured against 2.1.266 on
   * 2026-09-16). An empty policy in either state would have let a click run what a readable
   * file refuses.
   */
  const trust = options.trusted === undefined ? await workspaceTrust(root) : null
  const trusted = options.trusted ?? trust?.state === 'trusted'
  const read = await readPolicy(root)
  const policy: Policy = {
    allow: trusted && !read.incomplete ? read.policy.allow : [],
    deny: read.policy.deny,
  }
  const checks: TaskCheck[] = []

  // The index is the row's identity, so it counts every task, including the ones with no command
  // to run — `checks` gets one entry per task either way, and the view numbers what it was given.
  for (const [row, task] of tasks.entries()) {
    // No command to run. A real condition, and not one the office can settle.
    if (task.command === null) {
      checks.push({ task, verdict: { state: 'unlisted' }, result: null })
      continue
    }

    const verdict = judge(task.command, policy)
    const wanted =
      options.only === undefined || (options.only.row === row && options.only.command === task.command)

    const mayRun =
      options.run === true &&
      wanted &&
      task.state !== 'done' &&
      // Denied stays denied. A click is not a licence to override the workspace.
      verdict.state !== 'denied' &&
      (verdict.state === 'allowed' || options.force === true)

    if (!mayRun) {
      checks.push({ task, verdict, result: null })
      continue
    }

    checks.push({
      task,
      verdict,
      result: await runVerify({
        command: task.command,
        cwd: root,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      }),
    })
  }

  return { project, checks, unreadable, unrecognised, problem: null }
}

/**
 * What a press named: one task, everything, or nothing this office can read.
 *
 * Three answers, not two, and the third is the point. See {@link checkPressed}.
 */
function pressed(value: unknown): ClickedTask | 'everything' | 'unreadable' {
  // The "check everything" button sends nothing, and that is a real request rather than a gap.
  if (value === null || value === undefined) return 'everything'
  // Only `null` and `undefined` refuse to destructure, and both are already answered. Anything else
  // that is not a press — a string, a number, an array — yields `undefined` for both fields and is
  // refused by the two checks below. An explicit "must be an object" line sat here first and no
  // mutation of it could be made to fail a test, because nothing that survives a structured clone
  // can carry these two fields and not be an object.
  const { row, command } = value as Record<string, unknown>
  if (typeof row !== 'number' || !Number.isInteger(row) || row < 0) return 'unreadable'
  if (typeof command !== 'string') return 'unreadable'
  return { row, command }
}

/**
 * Run the checks a press asked for, reading the press itself first.
 *
 * This is the whole of what the `tasks:verify` handler does, and it lives here rather than in
 * `main.ts` so that it can be exercised without Electron — the failure direction below is the one
 * thing in this change that reinstates the bug silently if it is ever got wrong.
 *
 * ## An unreadable press runs nothing, and says why
 *
 * `null` means *everything the workspace already permits* — the "check everything" button — and a
 * readable press means one row. A payload that **cannot be read** is neither, and the fourth
 * standing order applies to arguments exactly as it does to files: absent is not empty, and
 * unreadable is not "no preference".
 *
 * **Which way this fails, deliberately.** Dropping the filter for an unreadable press would undo
 * the whole of `ClickedTask`, because the filter is the thing that stops one press running its
 * neighbours — and `force` would still be honoured, so `{ row: "1", command: "x" }` from a buggy
 * renderer would force every unfinished row in the project. So it runs **nothing** and returns the
 * reason in `problem`, the way an unreadable `TASKS.md` does. `readPolicy` fails toward asking and
 * `triageAgainst` toward `ask` for every call; this fails toward not running.
 *
 * Do not "simplify" the refusal into a missing `only`. That is not a tidier spelling of this — it
 * is the defect, and `test/a-run-button-runs-only-its-own-task.dom.test.ts` fails when it returns.
 *
 * ## And `force` needs a task to be about
 *
 * `HarnessOptions.force` is *"only ever true because a person clicked the specific task, having
 * seen the specific command"*. A press that names no task cannot have seen one, so the pair is
 * self-contradictory — and measured, it ran every unfinished row in the project, unauthorised ones
 * included, because omitting `only` and forcing are the two halves of exactly that. The "check
 * everything" button sends `false` and is unaffected. This is refused rather than quietly
 * downgraded, for the same reason as above: a renderer sending it has a bug, and a silent
 * downgrade is how the bug stays.
 */
export async function checkPressed(
  root: string,
  project: string,
  only: unknown,
  force: unknown,
): Promise<TaskReport> {
  const refused = (problem: string): TaskReport => ({
    project,
    checks: [],
    unreadable: 0,
    unrecognised: [],
    problem,
  })

  const named = pressed(only)
  if (named === 'unreadable') {
    return refused(
      'That press did not name a task this office could read, so nothing was run. This is a fault ' +
        'in the app rather than in your task list — reopen the panel and press Run again.',
    )
  }
  if (named === 'everything' && force === true) {
    return refused(
      'That press asked to run commands this office would not run on its own, without naming the ' +
        'task it was on, so nothing was run. Run one task at a time, from its own button.',
    )
  }

  return checkProject(root, project, {
    run: true,
    ...(named === 'everything' ? {} : { only: named }),
    // Anything that is not exactly `true` is not somebody asking, which is the same direction.
    force: force === true,
  })
}

// The outcome rules live in `shared/tasks.ts` so the renderer can reach the same answer without
// reaching into this half, which touches the disk.
export { outcomeOf, type TaskOutcome }

/**
 * Whether the office may claim this project's work is finished.
 *
 * Only when every task that is not already done has been checked and passed. Anything
 * unchecked leaves the question open, and an open question is not a yes — which is the whole
 * of the second standing order in one function.
 *
 * **No caller in `src/`.** Nothing in the app claims a project is finished, so the rule is not
 * being applied anywhere — and that is the safe direction rather than a gap: the failure this
 * guards against is the office saying *done* when it has not checked, and an office that never
 * says *done* cannot make that mistake. `views/tasks.ts` renders each check's own outcome
 * through `outcomeOf`, which is the per-task half and is live.
 *
 * Kept because it is the rule written down correctly and the place to call it if anything ever
 * does claim completion. Named as uncalled because a doc that says *this is the whole of the
 * second standing order* reads as an enforcement, and it is not one yet.
 */
export function allVerified(report: TaskReport): boolean {
  const outstanding = report.checks.filter((c) => c.task.state !== 'done')
  if (outstanding.length === 0) return false
  return outstanding.every((c) => outcomeOf(c) === 'passed')
}
