/**
 * What a dispatch actually changed.
 *
 * ## Where this comes from, and why not git
 *
 * The parent stream already carries every subagent `Edit` and `Write`, with the full input,
 * tagged `parent_tool_use_id` — and that id **is** `Dispatch.id`, which `ledger.ts` records when
 * the manager sends the brief. So the join is exact and costs nothing; the bytes are already
 * crossing the pipe into the parser.
 *
 * Git was the obvious alternative and does not survive contact with this app:
 *
 * - **Concurrent dispatches share one working tree.** `ledger.ts` documents twenty simultaneous
 *   appends as ordinary, and `git diff` cannot split one tree between two employees. That alone
 *   disqualifies it, independently of everything below.
 * - An installed office **is not a repository**. The app creates `<userData>/workspace` and never
 *   initialises one, so a git-only feature would work for people running from a clone and nobody
 *   who installed the app — the exact shape of the seeding defects this repo has just spent a day
 *   fixing.
 * - Unrelated dirty files, a commit made mid-dispatch, or a hand edit during the run all become
 *   the employee's work.
 *
 * ## The two things it cannot see, both of which it says
 *
 * **Shell.** A `Bash` event carries the command and its output, never a file list. A `sed -i`, a
 * formatter, or a build writing `dist/` is invisible here. Measured across 167 real captured tool
 * calls: `Bash` is 63.5% of them, and **none of those 106 commands wrote to disk** — every one was
 * a read, a check, or a test run. That is a sample and not a guarantee, so the count is reported
 * rather than assumed away.
 *
 * **Grandchildren.** Nothing in this repo *prevents* an employee dispatching somebody. The rule
 * lives in `manager.md` as prompt text, and the tool withholding that enforces it applies to
 * intake — the mode where dispatch is impossible anyway. Whether a subagent receives `Task` is
 * the CLI's decision, inherited and not held here. At depth two a grandchild's edit carries the
 * *child's* `Task` id, which resolves to no dispatch.
 *
 * That second one is the dangerous shape, and the reason this module counts rather than filters.
 * An edit silently dropped makes a dispatch that touched seven files show three — and look
 * exactly as complete as one that touched three. A declared gap can be read; a short list cannot.
 */

/** The tools that write. `MultiEdit` is not among them — it does not exist in the installed CLI. */
const WRITES = new Set(['Edit', 'Write', 'NotebookEdit'])

export interface Change {
  readonly path: string
  /**
   * What actually happened, read from the tool's own result rather than predicted from its name.
   *
   * It used to be `name === 'Write' ? 'create' : 'edit'`, and that is wrong in the case that
   * matters: **`Write` overwrites a file that already exists**. So an overwrite of somebody's
   * file was labelled `create` and filed under the heading a person is *not* scanning for damage.
   *
   * The CLI says which it was — *"File created successfully at: …"* against *"The file … has
   * been updated"* — and both wordings are in a real capture. Asking is the same move
   * `restoreFocus` makes: what happened, not what was going to.
   *
   * `unknown` when the result is missing or worded in a way this does not recognise. It is not a
   * shrug — it is what stops an undo deleting a file it believes was created, whose prior bytes
   * the office never recorded.
   */
  readonly kind: 'edit' | 'create' | 'unknown'
  /** The text replaced, when the tool said. `null` for a creation, or when it did not. */
  readonly before: string | null
  readonly after: string | null
}

/** One tool call as the stream reported it, reduced to what this module reads. */
export interface ToolCall {
  readonly name: string
  readonly input: Record<string, unknown>
  /** The dispatch it belongs to, or `null` for the manager's own turn. */
  readonly parent: string | null
  /** The block's own id, which its `tool_result` comes back against. */
  readonly id?: string
}

/**
 * What the tool said it did, keyed by the call's id.
 *
 * Absent for a call whose result never arrived — a run that was interrupted, or a write still in
 * flight when the turn ended. That absence is why `kind` has a third value.
 */
export type ToolResults = ReadonlyMap<string, string>

/**
 * Which of the two it was, from the CLI's own words.
 *
 * Matched loosely on purpose: the exact sentence is somebody else's payload and this file exists
 * because that is true. What it will not do is guess — an unrecognised result is `unknown`, and
 * everything downstream treats that as *we do not know* rather than as either answer.
 */
export function kindFromResult(said: string | undefined): 'edit' | 'create' | 'unknown' {
  if (said === undefined) return 'unknown'
  if (/\bcreated successfully\b/i.test(said)) return 'create'
  if (/\bhas been updated\b|\bupdated successfully\b/i.test(said)) return 'edit'
  return 'unknown'
}

export interface Changes {
  readonly changes: readonly Change[]
  /** Shell commands seen. Their file effects are not captured — see the header. */
  readonly shell: number
  /**
   * Writes whose dispatch could not be resolved.
   *
   * Counted, never discarded. This is the number that stops a short list reading as a complete
   * one.
   */
  readonly unattributed: number
}

function text(input: Record<string, unknown>, key: string): string | null {
  const v = input[key]
  return typeof v === 'string' ? v : null
}

/**
 * Fold a run's tool calls into what one dispatch changed.
 *
 * `dispatch` is the id being asked about; `known` is every dispatch this run started, and is what
 * separates *"belongs to somebody else"* from *"belongs to nobody"*. Without it a grandchild's
 * edit and another employee's edit are indistinguishable, and the honest answer differs.
 */
export function changesFor(
  calls: readonly ToolCall[],
  /**
   * The dispatch being asked about, or `null` for **the manager's own turn**.
   *
   * `null` is a positive answer and not a gap, and it is the same fact the approval card already
   * relies on: the CLI tags every subagent tool call with its dispatch and tags none of the
   * manager's. So a call whose parent is `null` was made by the manager, and `call.parent ===
   * dispatch` says so without a branch.
   *
   * Until this was allowed, those calls fell through `if (!mine) continue` and were dropped
   * entirely — not even counted. The manager keeps `Write` and `Edit` (only employees have them
   * withheld), so a panel titled "What the office changed" was silently omitting the one writer
   * that is always present.
   */
  dispatch: string | null,
  known: ReadonlySet<string>,
  results: ToolResults = new Map(),
): Changes {
  const changes: Change[] = []
  let shell = 0
  let unattributed = 0

  for (const call of calls) {
    const mine = call.parent === dispatch
    // A parent that names no dispatch we started. Depth two, or a CLI that changed its mind.
    const orphan = call.parent !== null && !known.has(call.parent)

    if (call.name === 'Bash') {
      if (mine) shell += 1
      continue
    }
    if (!WRITES.has(call.name)) continue

    if (orphan) {
      unattributed += 1
      continue
    }
    if (!mine) continue

    const path = text(call.input, 'file_path') ?? text(call.input, 'notebook_path')
    // A write with no path is not a write we can name. Counted as unattributed rather than
    // invented as one — the same reason the roster reports an agent it could not read.
    if (path === null) {
      unattributed += 1
      continue
    }

    const before = text(call.input, 'old_string')
    changes.push({
      path,
      // Asked, not predicted. `Write` onto an existing file is an overwrite, and calling that a
      // creation is the one mislabel that makes an undo destructive.
      kind: kindFromResult(call.id === undefined ? undefined : results.get(call.id)),
      before,
      after: text(call.input, 'new_string') ?? text(call.input, 'content'),
    })
  }

  return { changes, shell, unattributed }
}

/**
 * The sentence that goes under the list, or `null` when there is nothing to declare.
 *
 * Both gaps in one place on purpose. A person reading a file list needs to know in the same
 * breath what is *not* in it, and two separate notices in two places is how one of them stops
 * being read.
 */
export function whatIsNotShown(changes: Changes): string | null {
  const parts: string[] = []
  if (changes.shell > 0) {
    parts.push(
      changes.shell === 1
        ? 'ran 1 shell command, whose file effects are not captured'
        : `ran ${changes.shell} shell commands, whose file effects are not captured`,
    )
  }
  if (changes.unattributed > 0) {
    parts.push(
      changes.unattributed === 1
        ? 'made 1 edit that could not be attributed to it'
        : `made ${changes.unattributed} edits that could not be attributed to it`,
    )
  }
  if (parts.length === 0) return null
  return `This dispatch also ${parts.join(', and ')}.`
}

/**
 * A stable id for the manager's own changes in one run.
 *
 * A dispatch has an id — the `Task` call that started it — and the manager's turn does not. So
 * the record is keyed by the first write the manager made in it, which is a `tool_use` id: unique
 * across the CLI, derived from the data rather than from a clock, and therefore the same on a
 * re-read. Using a timestamp would key one turn differently depending on when it was written.
 *
 * `null` when the manager wrote nothing, which is most turns — and then there is no record,
 * which is correct rather than an empty one.
 */
export function ownWriteId(calls: readonly ToolCall[]): string | null {
  for (const call of calls) {
    if (call.parent === null && WRITES.has(call.name) && call.id !== undefined) return call.id
  }
  return null
}
