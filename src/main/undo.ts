/**
 * Doing the undo `shared/undo.ts` planned.
 *
 * The split is the boundary rule: every decision about *whether* a file may be put back is in
 * the shared module and is a pure function of strings. This does the four things that need the
 * disk — read the record, read the files, write them, record that it happened — and nothing
 * else. There is no rule in here.
 *
 * ## Why it reads every file before writing any
 *
 * A dispatch with five changes where the third refuses would otherwise leave one and two put
 * back and three to five in place: a file in a state nobody ever authored, produced by the office
 * while trying to help. So the whole plan is resolved against the tree first, and one refusal
 * anywhere means nothing is written at all.
 *
 * The window between reading and writing is real and is not closed here — closing it would mean
 * holding a lock the CLI knows nothing about. It is bounded instead: the undo refuses to run
 * while the dispatch is still out, which is when a file underneath it is actually likely to move.
 */

import { readFile, writeFile, rm } from 'node:fs/promises'

import {
  planUndo,
  resolveUndo,
  mayUndo,
  tally,
  whatWasUndone,
  alsoChangedSince,
  notAsItWas,
  type UndoResult,
} from '../shared/undo.js'
import { readChanges, markUndone } from './changes.js'
import { insideDirectory } from './safe-path.js'
import { loadLedger, unfinished, type Ledger } from './ledger.js'

/**
 * Put back what one dispatch changed.
 *
 * `root` is the workspace; every path in the record must resolve inside it, and one that does not
 * is refused rather than skipped. A change naming `/etc/hosts` is not a file the office declines
 * to touch quietly — it is a record that should not exist, and saying so is the point.
 */
export async function undoDispatch(root: string, dispatch: string): Promise<UndoResult> {
  const record = await readChanges(root, dispatch)
  if (!record.ok) return { ok: false, why: [record.reason] }
  if (record.changes === null) {
    return { ok: false, why: ['The office has no record of what this dispatch changed.'] }
  }

  const state = await loadLedger(root)
  if (state.state !== 'ok') {
    /*
     * Absent is not empty — standing order 4. A ledger that will not load cannot answer whether
     * this employee is still out, and "cannot tell" is not "they are back".
     */
    return { ok: false, why: ['The ledger could not be read, so the office cannot tell whether this employee is still working.'] }
  }
  const stillOut = unfinished(state.ledger).some((d) => d.id === dispatch)

  const no = mayUndo(stillOut, record.undone)
  if (no !== null) return { ok: false, why: [no] }

  const plan = planUndo(record.changes)
  if (plan.steps.length === 0) {
    return { ok: false, why: ['This dispatch changed no files that the office recorded.'] }
  }

  // Read once, into memory, so the resolve sees one consistent view rather than re-reading a file
  // between two steps that both name it.
  const seen = new Map<string, string | null>()
  const outside: string[] = []
  for (const step of plan.steps) {
    if (step.act === 'refuse' || seen.has(step.path)) continue
    const full = insideDirectory(root, step.path)
    if (full === null) {
      outside.push(`${step.path} is not inside this workspace, and the office will not touch it.`)
      seen.set(step.path, null)
      continue
    }
    try {
      seen.set(step.path, await readFile(full, 'utf8'))
    } catch {
      seen.set(step.path, null)
    }
  }

  const resolved = resolveUndo(plan, (path) => seen.get(path) ?? null)
  const refused = [...outside, ...resolved.flatMap((one) => (one.ok ? [] : [one.why]))]
  if (refused.length > 0) return { ok: false, why: refused }

  for (const one of resolved) {
    if (!one.ok) continue
    const full = insideDirectory(root, one.path)
    // Checked above; re-derived rather than carried so the value written is the one just guarded.
    if (full === null) continue
    if (one.write === null) await rm(full, { force: true })
    else await writeFile(full, one.write, 'utf8')
  }

  const undone = tally(resolved, new Date().toISOString())
  await markUndone(root, dispatch, undone)

  /*
   * Whether any file this put back has since been changed by somebody else's dispatch.
   *
   * Read after the write rather than before it, because it changes only what is *said* and must
   * never be able to stop the undo. A failure here costs a sentence; a failure before the write
   * would cost the operation.
   */
  const putBack = resolved.flatMap((one) => (one.ok && one.step.act === 'restore' ? [one.path] : []))
  const hybrid = notAsItWas(alsoChangedSince(putBack, await pathsChangedAfter(root, state.ledger, dispatch, record.about?.at ?? null)))

  /*
   * `partial` is appended, not replaced. An undo of a dispatch that also ran shell commands did
   * everything it could and still did not undo everything, and a bare "5 files were put back"
   * would be read as an all-clear.
   */
  const said = [whatWasUndone(undone), hybrid, plan.partial].filter((bit) => bit !== null).join(' ')
  return { ok: true, said, undone }
}

/**
 * Every path changed by a dispatch sent after this one.
 *
 * Ordered by `sentAt`, which is what the ledger has. It is not a perfect ordering — two dispatches
 * sent in the same millisecond are unordered, and a dispatch sent earlier may have finished later
 * — but the failure is in the safe direction: at worst it names a file that was in fact untouched
 * since, and the sentence it produces sends somebody to look at a file rather than away from one.
 *
 * A record that cannot be read contributes nothing, deliberately. This decides one sentence, and
 * an unreadable neighbour is not grounds to refuse an undo the person asked for.
 */
async function pathsChangedAfter(
  root: string,
  ledger: Ledger,
  dispatch: string,
  /** When it happened, for a record the ledger does not name — the manager's own turn. */
  fallbackAt: string | null,
): Promise<string[]> {
  /*
   * The ledger holds dispatches, and the manager's own turns are not in it. Without the fallback
   * this returned `[]` for every manager row — so an undo of the manager's work could never say
   * a file had been edited since, which is silence that reads as "nothing has".
   */
  const at = ledger.sent.find((d) => d.id === dispatch)?.sentAt ?? fallbackAt
  if (at === null) return []

  const paths: string[] = []
  for (const other of ledger.sent) {
    if (other.id === dispatch || other.sentAt <= at) continue
    const got = await readChanges(root, other.id)
    if (!got.ok || got.changes === null) continue
    for (const change of got.changes.changes) paths.push(change.path)
  }
  return paths
}
