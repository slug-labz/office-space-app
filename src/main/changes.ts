/**
 * Keeping what a dispatch changed, so somebody can look afterwards.
 *
 * `shared/changes.ts` decides what a dispatch changed and what it cannot see. This holds the
 * result, and holds it **one file per dispatch**.
 *
 * ## Not in `dispatches.jsonl`, and this is load-bearing
 *
 * That ledger rewrites the whole file on every append — read, temp, rename — and its own header
 * justifies that only because *"the file grows by two lines per dispatched task"*. Patch bodies
 * are not two lines. Putting them there makes every later dispatch pay a rewrite proportional to
 * every earlier dispatch's diff, and the cost arrives quietly, as a slow office.
 *
 * So the ledger keeps the row and this keeps the contents, joined by the one id both already
 * have. The same split `reconcile.ts` uses for the same reason: a record that grows without
 * bound does not belong in a file that is rewritten whole.
 */

import { mkdir, readdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

import type { Changes } from '../shared/changes.js'
import type { Undone } from '../shared/undo.js'

/**
 * Who made these changes and when, for a record the ledger does not describe.
 *
 * A dispatch's row is built from the ledger — employee, brief, sent-at, all recorded there. The
 * manager's own turn is in no ledger, so the little that a row needs travels with the record.
 * Absent on a dispatch record, where the ledger is the better source and a second copy would be
 * one more thing to disagree.
 */
export interface About {
  /** The manager's own id, as the roster knows them. */
  readonly who: string
  readonly at: string
  /** Which conversation it happened in, so a row can say where to look. */
  readonly session: string
}

const DIR = join('.office-space', 'changes')

/** Where one dispatch's changes live. The dispatch id is a `tool_use` id — safe as a filename. */
function pathOf(root: string, dispatch: string): string {
  return join(root, DIR, `${dispatch}.json`)
}

/**
 * Write what a dispatch changed.
 *
 * Temp-then-rename like every other durable write here: a half-written record of what an agent
 * did to somebody's files is worse than none, because it reads as a complete short list.
 */
export async function recordChanges(
  root: string,
  dispatch: string,
  changes: Changes,
  about: About | null = null,
): Promise<void> {
  const path = pathOf(root, dispatch)
  await mkdir(join(root, DIR), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  const body = about === null ? { version: 1, ...changes } : { version: 1, ...changes, about }
  await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

/**
 * Every dispatch or turn that has a record, newest last.
 *
 * The directory is the list. There is no index to keep in step with it, which is the same choice
 * `roster.ts` makes about the staff: the filesystem is the record, and anything holding a second
 * copy eventually names something that is not there.
 *
 * An unreadable directory is `null`, never an empty list — a panel that draws nothing because it
 * could not look is the exact failure this whole feature exists to prevent.
 */
export async function listChanges(root: string): Promise<readonly string[] | null> {
  try {
    const names = await readdir(join(root, DIR))
    return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length)).sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    return null
  }
}

/**
 * Read one back, or say why not.
 *
 * `null` for absent — a dispatch nobody has finished has no record, and that is not a failure.
 * A file that is *there* and will not parse is a different thing and says so, because a change
 * list that silently becomes empty is the exact failure this whole feature exists to prevent.
 */
export async function readChanges(
  root: string,
  dispatch: string,
): Promise<
  | {
      readonly ok: true
      readonly changes: Changes | null
      readonly undone: Undone | null
      readonly about: About | null
    }
  | { readonly ok: false; readonly reason: string }
> {
  let text: string
  try {
    text = await readFile(pathOf(root, dispatch), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, changes: null, undone: null, about: null }
    return { ok: false, reason: `the record of what this dispatch changed could not be read — ${(err as Error).message}` }
  }
  try {
    /*
     * Read field by field rather than handed back whole.
     *
     * The file also carries `version`, and returning the parsed object would leak it into a
     * `Changes` that no longer matches its own type. It also means a record written by a later
     * build with fields this one does not know about arrives as the fields this one does — rather
     * than as an object that type-checks and is not what it says.
     */
    const raw = JSON.parse(text) as Record<string, unknown>
    const undone = raw['undone'] as Record<string, unknown> | undefined
    return {
      ok: true,
      /*
       * An undo is a separate fact from what the dispatch did, and stays one.
       *
       * Folding it into `Changes` would mean the list of what an employee changed quietly also
       * carried what the office did about it afterwards — two facts in one field, which is how
       * every bug in this repository starts.
       */
      about: readAbout(raw['about']),
      undone:
        undone && typeof undone['at'] === 'string'
          ? {
              at: undone['at'],
              restored: typeof undone['restored'] === 'number' ? undone['restored'] : 0,
              removed: typeof undone['removed'] === 'number' ? undone['removed'] : 0,
            }
          : null,
      changes: {
        changes: Array.isArray(raw['changes']) ? (raw['changes'] as Changes['changes']) : [],
        shell: typeof raw['shell'] === 'number' ? raw['shell'] : 0,
        unattributed: typeof raw['unattributed'] === 'number' ? raw['unattributed'] : 0,
      },
    }
  } catch (err) {
    return { ok: false, reason: `the record of what this dispatch changed will not parse — ${(err as Error).message}` }
  }
}

/**
 * Record that the office put a dispatch's changes back.
 *
 * Read-modify-write rather than an append, because there is exactly one of these per dispatch and
 * it is written once. The read is what keeps the change list itself intact: a bare write of
 * `{undone}` would replace the record of what the employee did with the record of undoing it,
 * which is the same class of loss this whole file exists to prevent.
 */
export async function markUndone(root: string, dispatch: string, undone: Undone): Promise<void> {
  const got = await readChanges(root, dispatch)
  if (!got.ok || got.changes === null) {
    // Nothing to annotate, and inventing an empty change list to hang this on would be a record
    // of an undo of nothing.
    return
  }
  const path = pathOf(root, dispatch)
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify({ version: 1, ...got.changes, undone }, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

/** Field by field, for the reason the changes themselves are read that way. */
function readAbout(raw: unknown): About | null {
  if (typeof raw !== 'object' || raw === null) return null
  const it = raw as Record<string, unknown>
  if (typeof it['who'] !== 'string' || typeof it['at'] !== 'string') return null
  return { who: it['who'], at: it['at'], session: typeof it['session'] === 'string' ? it['session'] : '' }
}
