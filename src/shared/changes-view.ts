/**
 * What the office changed, as rows somebody can read.
 *
 * `changes.ts` decides what a dispatch changed; this arranges it for a person. The arrangement is
 * the whole content of this file, and two decisions in it are load-bearing.
 *
 * ## Created and edited are separated, deliberately
 *
 * A `Write` that made a file and an `Edit` that altered one are different events to a reader.
 * *"Made this"* and *"changed something you had"* provoke different questions, and the second is
 * the one somebody scanning for damage is actually looking for. The distinction arrives free in
 * the tool's own input keys, so collapsing them into "3 files" would be throwing away the most
 * valuable bit on the surface to save a line.
 *
 * ## The replacement is shown as what it is, not as a diff missing its context
 *
 * `old_string` and `new_string` are the exact bytes the employee replaced and replaced them with.
 * That is not a lossy diff — it is a different and in one way better artefact, because it says
 * precisely what was intended with nothing reconstructed. The hook route offers a
 * `structuredPatch` with surrounding lines, and taking it would mean rendering context the
 * stream never gave us. Prettier, and invented.
 */

import type { Change, Changes } from './changes.js'
import { newestFirst } from './time-order.js'
import type { Undone } from './undo.js'

export interface DispatchRow {
  readonly id: string
  readonly employee: string
  readonly brief: string
  readonly sentAt: string
  /*
   * The changes themselves, not their paths.
   *
   * This carried `readonly string[]` and dropped `before`/`after` on the floor — so the record
   * stored the exact bytes an employee replaced and the surface had no way to show them. The
   * whole argument for taking the stream route rather than `structuredPatch` was that the
   * replacement is exact information; throwing it away here made that argument moot in the one
   * place a person could have read it.
   */
  /** Files it created. */
  readonly created: readonly Change[]
  /** Files it altered — the ones worth looking at first. */
  readonly edited: readonly Change[]
  /**
   * Files it wrote where the tool did not say which it was.
   *
   * Their own group rather than folded into either. `Write` overwrites as well as creates, so
   * guessing here is how an undo comes to delete a file somebody already had.
   */
  readonly unclear: readonly Change[]
  /** What this dispatch could not be shown to have done. `null` when there is nothing to declare. */
  readonly notShown: string | null
  /** Why the record could not be read, when it could not. Never silently an empty change list. */
  readonly problem: string | null
  /**
   * When the office put these back, or `null`.
   *
   * Without this the row goes on listing files as changed after the office itself removed those
   * changes — a panel that reads as current and describes a tree that no longer exists.
   */
  readonly undone: Undone | null
  /**
   * Whether this employee is still out.
   *
   * Carried rather than inferred from a missing record: the two look identical here and mean
   * different things, and only one of them is a reason to refuse an undo.
   */
  readonly stillOut: boolean
}

/** One dispatch as the ledger recorded it. Mirrors `Dispatch` across the bridge. */
export interface SentDispatch {
  readonly id: string
  readonly employee: string
  readonly brief: string
  readonly sentAt: string
}

/**
 * What was found for it: the changes, or why not, or neither because it has not finished.
 *
 * `Changes` rather than a restatement of its shape. A second structural copy of a type is the
 * same fault this repository keeps finding one level up — two definitions of one fact, agreeing
 * until a field is added to one of them.
 */
export interface FoundChanges {
  readonly changes: Changes | null
  readonly problem: string | null
  readonly undone: Undone | null
  readonly stillOut: boolean
}

/**
 * The dispatches a panel lists, most recent first, by instant.
 *
 * A row whose time will not parse goes after every row whose time will. Under `localeCompare`,
 * `'not a date'` headed the panel as the most recent dispatch, while `''`, which the ledger reads
 * a missing `sentAt` as, went last only because it sorts before every digit. See `time-order.ts`.
 *
 * Here rather than inline in `main.ts`'s `changed` handler, because `main.ts` imports `electron`
 * at module scope and no test can load it, so the order had no test.
 */
export function newestSentFirst(sent: readonly SentDispatch[]): SentDispatch[] {
  return [...sent].sort((a, b) => newestFirst(a.sentAt, b.sentAt))
}

export function rowsFor(
  sent: readonly SentDispatch[],
  found: (id: string) => FoundChanges,
  describe: (c: Changes) => string | null,
): readonly DispatchRow[] {
  return sent.map((d) => {
    const got = found(d.id)
    const changes = got.changes
    return {
      id: d.id,
      employee: d.employee,
      brief: d.brief,
      sentAt: d.sentAt,
      created: changes?.changes.filter((c) => c.kind === 'create') ?? [],
      edited: changes?.changes.filter((c) => c.kind === 'edit') ?? [],
      unclear: changes?.changes.filter((c) => c.kind === 'unknown') ?? [],
      notShown: changes ? describe(changes) : null,
      problem: got.problem,
      undone: got.undone,
      stillOut: got.stillOut,
    }
  })
}

/**
 * The line under a row's file list.
 *
 * Three states, and only one of them is "nothing happened":
 *
 * - a record that could not be read — say that, because an unreadable record rendered as an
 *   empty list is a false sentence about somebody's files;
 * - no record at all — the dispatch has not finished, which is not the same as changing nothing;
 * - a record with no files in it — then it genuinely changed nothing, and may still have run
 *   shell commands nobody can account for.
 */
export function summarise(row: DispatchRow, hasRecord: boolean): string {
  if (row.problem !== null) return row.problem
  if (!hasRecord) return 'Still working, or stopped before it reported.'
  /*
   * Ahead of the counts, because it changes what they mean. The list below is still what the
   * employee did — it is just no longer what the tree contains, and a reader who meets the counts
   * first has already drawn the wrong conclusion by the time they reach this.
   */
  if (row.undone !== null) {
    return `The office put this back on ${row.undone.at.slice(0, 10)}. What follows is what the employee had changed.`
  }

  const bits: string[] = []
  if (row.edited.length > 0) bits.push(`${row.edited.length} changed`)
  if (row.created.length > 0) bits.push(`${row.created.length} created`)
  // Named rather than added to either total. A count that folds them in is a count that claims
  // to know.
  if (row.unclear.length > 0) bits.push(`${row.unclear.length} written, unclear which`)
  if (bits.length === 0) return row.notShown ?? 'No files changed.'
  return `${bits.join(', ')}.${row.notShown ? ` ${row.notShown}` : ''}`
}

/**
 * Whether a record exists for this row — the difference between *changed nothing* and *not yet*.
 *
 * Here rather than in the renderer, where it was written as a lambda and was wrong. It counted
 * `edited` and `created` and forgot `unclear`, so a dispatch whose only writes were ones the tool
 * did not classify was described as *"Still working, or stopped before it reported"* — with the
 * files it wrote listed directly underneath, saying otherwise. Two facts on one card disagreeing,
 * which is the shape of every bug this panel exists to prevent.
 *
 * A decision about a row is not a rendering concern, and the boundary is what makes it testable:
 * as a lambda inside `renderChanged`'s caller it could only be checked by drawing the panel and
 * reading it, which is how it survived.
 */
export function hasRecord(row: DispatchRow): boolean {
  return (
    row.problem !== null ||
    row.notShown !== null ||
    row.edited.length + row.created.length + row.unclear.length > 0
  )
}
