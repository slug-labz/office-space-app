/**
 * The one line the activity strip shows while it is shut.
 *
 * ## Why it says "mid-task" and not "running"
 *
 * The status bar's own indicator reads `Manager running` when a turn is in flight — that is
 * `SessionPhase`, printed as written. This line counts something else entirely: **dispatched
 * employees**, which is zero for most of a turn, because the manager thinks before it delegates
 * and often never delegates at all.
 *
 * So the screen said `Manager running` and `0 running` at the same time, six inches apart, and
 * it was read the only way it can be read: the manager is running at the top left, and the
 * bottom says zero running. Both numbers were right. One word was doing two
 * jobs.
 *
 * The zone below already had the answer and used it — its empty state reads *"Nobody is
 * mid-task."* This is the same words on the collapsed bar, which is the half most people see.
 *
 * ## Why it takes everything as an argument
 *
 * It used to take three and close over three more from module scope, which is why it could not
 * be tested: half its inputs were not in its signature. That is the same shape as the `restore()`
 * leak this repository already has a comment about — *"it could not have done anything else,
 * because the argument it needed was not in the signature."*
 */

export interface StripCounts {
  /** Employees mid-task. Not the manager's own turn. */
  readonly working: number
  /** Entries in the activity log. */
  readonly logged: number
  /** Tool calls held at the gate. */
  readonly waiting: number
  /**
   * Dispatches with no result, or `'unreadable'` when the ledger would not open.
   *
   * Never a number when the file could not be read: a ledger we cannot open has an unknown
   * count, and printing `0 never reported back` for it is the fourth standing order broken on
   * the one line somebody glances at.
   */
  readonly unfinished: number | 'unreadable'
  /** Whether the panel is open, which is only the arrow. */
  readonly open: boolean
}

export function stripLine(counts: StripCounts): string {
  const parts: string[] = []

  if (counts.waiting > 0) {
    parts.push(counts.waiting === 1 ? '1 call needs you' : `${counts.waiting} calls need you`)
  }

  // Named on the collapsed bar, so the offer survives the panel being shut again.
  if (counts.unfinished === 'unreadable') parts.push('ledger unreadable')
  else if (counts.unfinished > 0) {
    parts.push(counts.unfinished === 1 ? '1 never reported back' : `${counts.unfinished} never reported back`)
  }

  parts.push(counts.working === 0 ? 'nobody mid-task' : `${counts.working} mid-task`)
  if (counts.logged > 0) parts.push(`${counts.logged} logged`)

  return `${counts.open ? '▾' : '▸'} ${parts.join(' · ')}`
}
