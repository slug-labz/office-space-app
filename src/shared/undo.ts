/**
 * Putting back what a dispatch changed.
 *
 * ## Why this is not a diff apply, and why there are no offsets
 *
 * The office never held the whole file. It holds, per change, the exact bytes an employee
 * replaced and the exact bytes it replaced them with — so an undo is the inverse edit: find
 * `after`, put `before` back.
 *
 * The obvious worry is that finding text is ambiguous. It is, and **the ambiguity is the answer
 * rather than a problem to engineer around.** The CLI's own `Edit` requires `old_string` to
 * appear exactly once; that requirement *is* the safety property, and the inverse inherits it.
 * Three matches, three honest outcomes, and two of them are a refusal.
 *
 * Offsets were the alternative and are worse than merely cheap: any earlier edit shifts every
 * later one, so a byte offset is wrong **specifically** in the multi-edit case, and silently.
 *
 * ## Refusing is the feature
 *
 * `hired-from` refuses to take a colleague's update over local work rather than deciding for
 * somebody. This is the same shape with more at stake: the thing being overwritten is a file
 * somebody may have edited by hand since, and the office cannot see that they did.
 *
 * ## All of it, or none of it
 *
 * A dispatch with five edits where the third refuses would leave one and two put back and three
 * to five in place — a file in a state **nobody ever authored**, produced by the office while
 * trying to undo. So resolving and writing are two steps: every change is checked against the
 * file as it is now, and nothing is written unless all of them resolve. The check is the whole
 * of the work anyway, so doing it first costs a pass over strings already in memory.
 *
 * ## Undoing dispatch A after dispatch B touched the same file
 *
 * If B changed a different region, putting A back succeeds and leaves a state neither dispatch
 * produced. That is correct and is what the person asked for. If B changed the *same* region,
 * A's text is no longer there and the restore refuses — the uniqueness rule handles the
 * colliding case without needing a rule of its own.
 *
 * ## The one that would destroy something
 *
 * Undoing a creation is a deletion. `Write` overwrites an existing file as happily as it makes
 * one, so a change recorded as `create` on a guess would delete a file the office never held the
 * prior bytes of — unrecoverable, in exactly the case somebody reached for undo. `kind` is read
 * from the tool's own result now, and `unknown` refuses here rather than picking the destructive
 * reading.
 */

import type { Change, Changes } from './changes.js'

export type UndoStep =
  /** Put `put` back where `find` is, if `find` appears exactly once. */
  | { readonly act: 'restore'; readonly path: string; readonly find: string; readonly put: string }
  /**
   * The dispatch made this file. Undoing that is removing it.
   *
   * `wrote` is the whole content the office recorded writing, and deleting is guarded on the
   * file still being exactly that. Anything else means somebody has edited it since, and a
   * deletion would destroy work the office never held a copy of.
   */
  | { readonly act: 'delete'; readonly path: string; readonly wrote: string }
  /** Not safe to touch, and why in words a person can act on. */
  | { readonly act: 'refuse'; readonly path: string; readonly why: string }

export interface UndoPlan {
  /** In the order they must be applied. */
  readonly steps: readonly UndoStep[]
  /**
   * What this undo cannot put back, or `null`.
   *
   * Never omitted when it applies: an undo of a dispatch that also ran shell commands is partial
   * by construction, and saying "undone" without saying that hands somebody a false all-clear.
   */
  readonly partial: string | null
}

function stepFor(change: Change): UndoStep {
  if (change.kind === 'unknown') {
    return {
      act: 'refuse',
      path: change.path,
      why: 'the office does not know whether this file existed before — undoing it could delete something it never recorded',
    }
  }
  if (change.kind === 'create') {
    if (change.after === null) {
      return { act: 'refuse', path: change.path, why: 'the office did not record what it wrote here' }
    }
    return { act: 'delete', path: change.path, wrote: change.after }
  }
  if (change.before === null || change.after === null || change.after === '') {
    // An edit the office cannot invert. Recorded, so it is named rather than quietly skipped.
    return { act: 'refuse', path: change.path, why: 'the office did not record what this replaced' }
  }
  return { act: 'restore', path: change.path, find: change.after, put: change.before }
}

export function planUndo(changes: Changes): UndoPlan {
  /*
   * Reverse order, and this is not tidiness.
   *
   * Two edits to one file: the second was made against the text the first produced. Undo them
   * forwards and the first undo destroys the context the second one needs to find itself — so
   * the second refuses, having been made impossible by the step before it.
   */
  const steps = [...changes.changes].reverse().map(stepFor)

  const gaps: string[] = []
  if (changes.shell > 0) {
    gaps.push(
      changes.shell === 1
        ? 'it also ran 1 shell command, and anything that changed is not recorded'
        : `it also ran ${changes.shell} shell commands, and anything they changed is not recorded`,
    )
  }
  if (changes.unattributed > 0) {
    gaps.push(
      changes.unattributed === 1
        ? 'and 1 edit could not be attributed to it'
        : `and ${changes.unattributed} edits could not be attributed to it`,
    )
  }

  return {
    steps,
    partial: gaps.length === 0 ? null : `This will not undo everything: ${gaps.join(' ')}.`,
  }
}

/** A step resolved against the file as it is now: safe to do, or refused with a reason. */
export type Resolved =
  | { readonly ok: true; readonly step: UndoStep; readonly write: string | null; readonly path: string }
  | { readonly ok: false; readonly path: string; readonly why: string }

/**
 * Resolve every step against the tree, and refuse the whole undo if any one of them refuses.
 *
 * `read` returns the file's current bytes, or `null` if it is not there. Nothing is written here —
 * the caller applies `write` only when every entry came back `ok`, which is what stops a partial
 * undo leaving a file in a state nobody authored.
 */
export function resolveUndo(plan: UndoPlan, read: (path: string) => string | null): readonly Resolved[] {
  return plan.steps.map((step): Resolved => {
    if (step.act === 'refuse') return { ok: false, path: step.path, why: step.why }

    const current = read(step.path)
    if (current === null) {
      return { ok: false, path: step.path, why: `${step.path} is not there any more.` }
    }

    if (step.act === 'delete') {
      // Whole-file equality, because the whole file is what the office wrote. Anything else and
      // somebody has edited it since — and deleting would take their work with it.
      return current === step.wrote
        ? { ok: true, step, write: null, path: step.path }
        : {
            ok: false,
            path: step.path,
            why: `${step.path} is not what the employee wrote any more, so removing it would destroy somebody's changes.`,
          }
    }

    const found = wouldRestore(current, step.find)
    if (found !== 'once') return { ok: false, path: step.path, why: whyNotRestored(found, step.path) }
    // A function, not the string: a replacement string reads `$$`, `$&`, `` $` `` and `$'` as patterns,
    // so `echo $$` was put back as `echo $`.
    return { ok: true, step, write: current.replace(step.find, () => step.put), path: step.path }
  })
}

/**
 * What putting one thing back would do, given the file as it is now.
 *
 * The whole of the safety check, and it is a count. `Edit` guarantees its `old_string` was unique
 * when it ran; if `after` is no longer unique now, something has happened to the file since and
 * the office is not entitled to guess which occurrence was its own.
 */
export function wouldRestore(current: string, find: string): 'once' | 'missing' | 'ambiguous' {
  if (find === '') return 'missing'
  const first = current.indexOf(find)
  if (first === -1) return 'missing'
  return current.indexOf(find, first + find.length) === -1 ? 'once' : 'ambiguous'
}

/** Why a restore was refused, in words somebody can act on. */
export function whyNotRestored(what: 'missing' | 'ambiguous', path: string): string {
  return what === 'missing'
    ? `${path} no longer contains what the employee wrote, so there is nothing here to put back.`
    : `${path} contains what the employee wrote in more than one place, and the office cannot tell which was theirs.`
}

/**
 * What the office did to put a dispatch's work back.
 *
 * Recorded on the dispatch's own change record, because without it the record goes on claiming the
 * tree contains changes the office itself removed — a panel that reads as current and is describing
 * a state that no longer exists. Standing order 3, in the one place the office edits somebody's
 * files on its own initiative.
 */
export interface Undone {
  readonly at: string
  /** Files whose earlier text was put back. */
  readonly restored: number
  /** Files the dispatch created and this deleted. */
  readonly removed: number
}

/**
 * Whether an undo may run at all, or why not.
 *
 * ## Not while the dispatch is still out
 *
 * The change view's own finding: **concurrent dispatches share one working tree.** An undo racing
 * an employee mid-edit is that collision with the office on one side of it — the office would
 * search for text the employee is in the middle of replacing, and either miss it or hit a version
 * of the file that existed for a hundred milliseconds. The refusal is the same shape as every
 * other refusal here: the office cannot see what somebody else is doing, so it does not act.
 *
 * A dispatch is still out when no outcome line names it — `unfinished()` in `main/ledger.ts`,
 * which is the office's one definition of that and stays the only one.
 *
 * ## Not twice
 *
 * A second undo would search for text the first one already put back, and either find nothing
 * (refuse, confusingly) or find the *original* text and put back the version the employee wrote —
 * an undo that redoes. Refusing is the honest reading, and it is why `Undone` is recorded.
 */
export function mayUndo(stillOut: boolean, undone: Undone | null): string | null {
  if (stillOut) {
    return 'This employee has not reported back yet. The office will not change files somebody may still be editing.'
  }
  if (undone !== null) {
    return `These changes were already put back on ${undone.at.slice(0, 10)}.`
  }
  return null
}

/** What a completed undo did, for the record and for the person who asked for it. */
export function whatWasUndone(undone: Undone): string {
  const parts: string[] = []
  if (undone.restored > 0) {
    parts.push(undone.restored === 1 ? '1 file was put back' : `${undone.restored} files were put back`)
  }
  if (undone.removed > 0) {
    parts.push(undone.removed === 1 ? '1 file was removed' : `${undone.removed} files were removed`)
  }
  // Both zero is reachable: a dispatch whose every change was a refusal has an empty plan.
  return parts.length === 0 ? 'Nothing was changed.' : `${parts.join(', ')}.`
}

/** The counts a finished undo is recorded with. Derived from the plan, not from a running tally. */
export function tally(resolved: readonly Resolved[], at: string): Undone {
  let restored = 0
  let removed = 0
  for (const one of resolved) {
    if (!one.ok) continue
    if (one.step.act === 'delete') removed += 1
    else if (one.step.act === 'restore') restored += 1
  }
  return { at, restored, removed }
}

/**
 * What an undo did, or every reason it did nothing.
 *
 * Here rather than beside the code that performs it, because it crosses the bridge and the
 * renderer cannot import from `main/`. `why` is a list on purpose: the undo is all-or-nothing, so
 * reporting only the first refusal would have somebody fix that one, click again, and meet the
 * second — one file at a time, with a write to their tree between each pair of attempts.
 */
export type UndoResult =
  | { readonly ok: true; readonly said: string; readonly undone: Undone }
  | { readonly ok: false; readonly why: readonly string[] }

/**
 * Of the files this undo put back, how many a later dispatch has also changed.
 *
 * ## Why "put back" can be true about the operation and false about the file
 *
 * Undoing dispatch A after dispatch B edited a different region of the same file succeeds — A's
 * text is still unique, so the restore is exactly right — and leaves the file in a state **neither
 * dispatch produced**. That is correct, and it is what was asked for. The problem is the sentence:
 * *"1 file was put back"* means restored to a prior state, and this file is not in any state it
 * has ever been in. A reader who concludes the file is as it was before A ran is wrong, and
 * nothing on screen corrects them.
 *
 * This is **not** the shell-command declaration in a different hat. That one declares a blind
 * spot — the office cannot see what those commands did, so a short list would read as complete.
 * Here the office knows exactly what it restored and restored it correctly. Nothing is missing;
 * one true sentence is simply available to be read as a different, false one.
 *
 * So the answer is not a caveat bolted onto the sentence. It is a **different sentence for a
 * different situation** — the same move as keeping `unknown` writes in their own group rather
 * than folding them into a count, and as *"Still working, or stopped before it reported"* rather
 * than *"changed nothing"*.
 *
 * ## What it may not claim
 *
 * Only dispatches. A **person** editing elsewhere in the file produces the identical hybrid and
 * is undetectable — the uniqueness and whole-file guards catch a hand edit at the same slice and
 * refuse, but not one further down. So the sentence says *another dispatch has edited it since*
 * and never *nothing else has changed*, and the absence of the sentence is not a guarantee.
 */
export function alsoChangedSince(putBack: readonly string[], laterPaths: readonly string[]): number {
  if (putBack.length === 0 || laterPaths.length === 0) return 0
  const later = new Set(laterPaths)
  // Distinct files, not distinct changes: two later edits to one file is one file to warn about.
  return new Set(putBack.filter((path) => later.has(path))).size
}

/** The second sentence, or `null` when there is no second situation to describe. */
export function notAsItWas(count: number): string | null {
  if (count <= 0) return null
  return count === 1
    ? 'Another dispatch has edited it since, so it is not as it was before.'
    : `Another dispatch has since edited ${count} of them, so they are not as they were before.`
}
