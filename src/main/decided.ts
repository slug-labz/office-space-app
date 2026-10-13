/**
 * Read `decided/`, and be exact about every way that can fail.
 *
 * The parsing is `src/shared/decisions.ts`, which reads no files and is where the decisions live.
 * This is the directory walk, and it is deliberately `memory.ts`'s walk with one directory
 * swapped — the same three failures answered the same three ways, because they *are* the same
 * three failures and two solutions would drift.
 *
 * ## Three failures, three answers
 *
 * `ENOENT` on the directory is **not** a problem. The gate creates it the first time it files a
 * decision, so an office where nobody has answered an approval yet genuinely has none, and
 * reporting that as a fault would be the office complaining about the ordinary case.
 *
 * Any other errno **is** a problem, and it is the one this app exists to distinguish: a
 * `decided/` that is there and will not open is not an office that has approved nothing.
 *
 * And a single record that will not open is carried per file rather than sinking the read. Nine
 * decisions and one unreadable is nine decisions and a named gap. Named, not counted — a file
 * that will not open may be the very record somebody came looking for, and a count cannot be
 * searched for later.
 *
 * ## Newest first, which `memory.ts` does not need and this does
 *
 * Memories are grouped by kind and sorted by name. These are events, and the question they answer
 * is *what happened while I was out* — so the most recent is the one somebody is looking for, and
 * a record with no time in its name sorts last rather than first, because it cannot claim to be
 * recent.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  filedAt,
  parseDecision,
  type Decision,
  type DecisionReport,
  type UnreadDecision,
} from '../shared/decisions.js'

/** Where the gate files a decision somebody made. Named once, beside `missed/`. */
export const DECIDED_DIR = join('.office-space', 'approvals', 'decided')

/**
 * How many records the panel opens.
 *
 * A count rather than a time window, and the difference matters for the case this is for:
 * somebody back after three days away gets nothing from a 24-hour window and the last two hundred
 * decisions from this. The lint on the workspace problems list is the thing with a clock; the
 * record is the thing with a depth.
 *
 * Two hundred is generous against any real night — the figure this feature was argued from is
 * twelve missed approvals in a night of total absence — and bounded regardless of how long the
 * office has been running.
 */
const NEWEST = 200

export async function readDecided(root: string): Promise<DecisionReport> {
  const dir = join(root, DECIDED_DIR)

  let names: string[]
  try {
    // Flat, unlike `memory.ts`. Nothing organises this directory — the gate writes one file per
    // decision into it and nothing else ever writes there — so a subdirectory would be somebody
    // else's, and recursing into it would draw their files as decisions this office carried.
    names = await readdir(dir)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // Absent really is empty here, and only here. The gate creates the directory the first time
    // it files something, so an office that has answered nothing genuinely has no record.
    if (code === 'ENOENT') return { decisions: [], unread: [], problem: null, beyond: 0 }
    return {
      decisions: [],
      unread: [],
      problem: `${dir} exists and could not be opened: ${err instanceof Error ? err.message : String(err)}`,
      beyond: 0,
    }
  }

  /*
   * Only the newest are opened, and this is the whole reason the time is in the filename.
   *
   * `approval-gate.mjs` argues it at the point of writing — *"a count that had to open every file
   * to bucket it would get slower every night the office ran unattended, which is the night this
   * record exists for"* — and the first version of this reader was exactly the thing that comment
   * warns about. It `readdir`'d and then opened every record ever filed.
   *
   * That degrades in proportion to the usage the feature exists for: more unattended nights means
   * more records, so the panel answering *"what did I approve last night"* would get slower every
   * night it had something to record, and be slowest on the machine that had used it most, on the
   * night with the most to show. `ActivityState.history` is capped in almost these words.
   *
   * One `readdir` whatever the size, no read at all for a record nobody will see. Undated names
   * sort last, so they are opened only when there is room — a name that makes no claim about when
   * it happened cannot claim a place among the recent.
   */
  const mine = names.filter((n) => n.endsWith('.decision.json'))
  const ordered = mine
    .map((name) => ({ name, at: filedAt(name) }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  const opening = ordered.slice(0, NEWEST)

  const decisions: Decision[] = []
  const unread: UnreadDecision[] = []

  for (const { name } of opening) {
    const id = name.slice(0, -'.decision.json'.length)
    let text: string
    try {
      text = await readFile(join(dir, name), 'utf8')
    } catch (err) {
      // Per file. One unreadable record among nine is a named gap, not a failed read.
      unread.push({ id, cause: err instanceof Error ? err.message : String(err) })
      continue
    }

    const parsed = parseDecision(name, text)
    if (parsed === null) {
      /*
       * Read, and not a record this office wrote — a truncated write, a hand-edited file, or an
       * outcome word nobody produces.
       *
       * Filed under `unread` rather than skipped, and that is the deliberate half. Skipping is
       * right in `tally`, which is counting names and must not claim somebody answered something;
       * here the file is *on disk in the office's own record directory* and the panel's subject
       * is what the office can and cannot tell you. A silently dropped record is the fourth
       * standing order on the surface built to serve it.
       */
      unread.push({ id, cause: 'the record could not be read as a decision' })
      continue
    }
    decisions.push(parsed)
  }

  /*
   * Newest first, and undated last.
   *
   * A record whose name carries no time cannot claim a place among the recent ones — sorting it
   * as `0` would bury it at the bottom, which is right, but by accident rather than by rule.
   * Stated so the next person does not "fix" it into the wrong order.
   */
  decisions.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  unread.sort((a, b) => a.id.localeCompare(b.id))

  /*
   * What was on disk and not opened, so the panel can say so.
   *
   * A window that states its own edges is not a truncation. Without this the panel would show the
   * newest two hundred and read as the whole record, which is the shape of quiet wrongness this
   * feature exists to remove — and the number is free, because it comes from the `readdir` that
   * already happened.
   */
  return { decisions, unread, problem: null, beyond: mine.length - opening.length }
}
