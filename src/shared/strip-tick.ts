/**
 * Whether the activity strip has to redraw itself once a second.
 *
 * ## Why this is not "while somebody is mid-task"
 *
 * Two things on the strip change without an event: how long a dispatch has been running, and how
 * long a held call has left. The tick used to start for the first alone, and the approval card's
 * clock was written on the belief that it would be carried along — *"counts down for free"*.
 *
 * It was not, whenever a call was held with nobody mid-task. `working` counts dispatched
 * employees and never the manager's own turn, so the manager's held call leaves it at zero; so
 * does a call held in another project while the conversation on screen is idle, because the strip
 * draws every held call in the workspace. The card was drawn once, with more than a minute left
 * and so with no clock line, and nothing redrew it. The gate held for its four minutes and refused
 * the call without the card ever saying time was nearly up.
 *
 * A card first drawn inside the last minute was worse, because its number stood still. Measured in
 * the dev harness against the build before this file: a manager's call pushed with three seconds
 * left still read *"3 seconds left to answer"* five seconds after its deadline, beside *"Nobody is
 * mid-task."*
 *
 * ## Why it takes everything as an argument
 *
 * `app.ts` is the renderer entry and importing it starts the application, so a rule left inside
 * `drawStrip` is one the suite cannot reach. This is that rule, with its inputs in its signature.
 */

import type { PendingApproval } from './ipc.js'
import { timeLeft } from './approval-summary.js'

export interface StripClock {
  /** Whether the panel is open. A shut strip draws nothing, so nothing on it can move. */
  readonly open: boolean
  /** Employees mid-task in the conversation on screen. Not the manager's own turn. */
  readonly working: number
  /** Every held call in the workspace, which is what the strip draws. */
  readonly approvals: readonly Pick<PendingApproval, 'askedAt' | 'waitMs'>[]
  /** The `nowMs` the strip is drawn with, so the decision and the drawing agree on the time. */
  readonly nowMs: number
}

export function stripTicks(clock: StripClock): boolean {
  if (!clock.open) return false
  if (clock.working > 0) return true
  /*
   * A held call moves only while it is still counting down, and that includes the minutes when
   * its card shows no clock at all — the tick is what gets it to the minute where one appears.
   *
   * Not merely "has a known `waitMs`". A wait nobody can count down, and a deadline already
   * passed, each draw one sentence that never changes, and an idle office still draws nothing.
   */
  return clock.approvals.some((a) => timeLeft(a.askedAt, a.waitMs, clock.nowMs).state === 'waiting')
}
