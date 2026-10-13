/**
 * The activity strip's memory, rebuilt from a transcript.
 *
 * ## The bug (F2)
 *
 * `ActivityState` lives in a `Map` in the renderer and nowhere else. `restore()` put the
 * conversation back and stopped there, so after a relaunch the chat showed a dispatch to
 * `frontend` while the strip beside it said **"Nothing yet this session."** Neither sentence
 * was false. Together they were a lie, and it was measured on a real session rather than
 * imagined here — standing order three broken by omission, which is the harder kind to notice
 * because nothing on screen is visibly wrong.
 *
 * ## What a transcript can and cannot tell you
 *
 * The fix is *not* "replay the session and carry on as though nothing happened", because a
 * relaunch is not nothing. Three things are genuinely unknowable afterwards and none of them
 * may be guessed:
 *
 * | after a restart | what this module does |
 * |---|---|
 * | is anybody still working? | **No.** The child processes died with the last run, so {@link restoreActivity} cannot return a running row — it returns history and nothing else, so there is no way for a caller to put restored work in the live "Running" zone by mistake. |
 * | how did a dispatch end? | Only if the transcript says. A dispatch with no result recorded gets a line saying exactly that, never a `done` and never a silent drop. |
 * | when did it happen? | Only the times the records carry. An entry with no timestamp gets `''`, which the strip renders as no clock rather than as now. |
 *
 * Every line produced here is marked {@link Entry.restored}, because a line read out of a file
 * is a weaker claim than a line watched happening and the strip has to be able to say so.
 *
 * ## Why it goes through `factsFromEvent`
 *
 * The same reason the live strip does. Two code paths reading one stream is how a strip and a
 * floor come to disagree about who is busy; deriving dispatches a second way here would add a
 * third reading and a third opportunity for the office to contradict itself about the very
 * events this file exists to stop it lying about.
 */

import { applyFact, applyNote, EMPTY, type Activity, type Entry } from './activity.js'
import { isAsyncLaunch, isDelegationTool } from './delegation.js'
import { factsFromEvent } from './floor/choreography.js'
import type { TimelineEntry } from './transcript/parse.js'

/** Who the office speaks as when it is reporting on itself rather than on a person. */
const OFFICE = 'the office'

export interface RestoredActivity {
  /**
   * History only, newest first, already capped at `HISTORY_LIMIT` and every line marked
   * `restored`. Deliberately not an {@link Activity}: there is no honest running row to hand
   * back, so the type does not offer one.
   */
  readonly history: readonly Entry[]
  /**
   * Transcript lines that could not be parsed. Each is also a visible entry in `history` —
   * this count is for a caller that wants to say so somewhere else too.
   *
   * Standing order four. A line we failed to read is not a line that was not there, and the one
   * outcome forbidden here is for it to leave no trace.
   */
  readonly unreadable: number
}

/**
 * Fold a restored transcript into the lines the strip shows.
 *
 * `speaker` names whoever owns this conversation — the manager for the manager's session, the
 * employee for theirs — and is used exactly where {@link factsFromEvent} uses it live: as the
 * author of a skill fetch and the convener of a meeting.
 */
export function restoreActivity(entries: readonly TimelineEntry[], speaker: string): RestoredActivity {
  let activity: Activity = EMPTY
  let unreadable = 0

  for (const entry of entries) {
    if (entry.kind === 'unreadable') {
      unreadable++
      activity = applyNote(activity, {
        kind: 'failed',
        who: OFFICE,
        // The parser's own reason, verbatim. "Something went wrong" would be a line that
        // reports a failure while withholding the only part of it worth having.
        text: `a line of the transcript could not be read — ${entry.reason}`,
        at: entry.timestamp ?? '',
      })
      continue
    }

    // Everything else on a timeline is conversation: what was said, what was thought, what was
    // typed. The strip's subject is work changing hands, and only a tool call is that.
    if (entry.kind !== 'tool') continue

    const at = entry.timestamp ?? ''
    const facts = factsFromEvent(
      {
        kind: 'assistant',
        blocks: [{ type: 'tool_use', id: entry.toolUseId, name: entry.name, input: entry.input }],
      },
      speaker,
    )
    for (const fact of facts) activity = applyFact(activity, fact, at)

    if (endsHere(entry)) {
      // The *result's* timestamp, not the call's. `parse.ts` merges a `tool_use` and its
      // `tool_result` into one entry sitting at the call's position, so using `entry.timestamp`
      // here would stamp every handback with the moment it was asked for — a wrong time on
      // screen, which is worse than the blank an unknown one leaves.
      activity = applyFact(activity, { kind: 'delivered', toolUseId: entry.toolUseId }, entry.resultTimestamp ?? '')
    }
  }

  // Dispatches the transcript never resolved.
  //
  // In a live session `settle()` handles this when the turn ends, and says "the turn ended
  // before they reported back". That is the wrong sentence here: we are not watching a turn
  // end, we are reading a file that stops. What we know is narrower and is all this says — a
  // dispatch went out and no result was written down. Whether the agent finished, died with the
  // app, or is a background task whose answer never reached the transcript, this cannot tell,
  // and it does not pretend either way.
  //
  // They land last, so they sit at the top of the restored block. That is the right end: an
  // unfinished handoff is the part of yesterday somebody actually needs to see.
  for (const pending of [...activity.inFlight.values()]) {
    activity = applyNote(activity, {
      kind: 'note',
      who: pending.who,
      text: pending.brief
        ? `picked up: ${pending.brief} — the transcript does not record how it ended`
        : 'picked up a task — the transcript does not record how it ended',
      at: pending.since,
    })
  }

  return {
    // Marked here rather than at each construction site: everything folded above came out of a
    // file, so there is exactly one place this can be got wrong and it is this line.
    history: activity.state.history.map((entry) => ({ ...entry, restored: true as const })),
    unreadable,
  }
}

/**
 * Whether this entry's result is an ending.
 *
 * `run_in_background` defaults to **true**, so a dispatch's own `tool_result` arrives within
 * milliseconds saying the agent was *launched*. Live, the strip learns this from a `task-started`
 * event; a transcript has no such record, so the receipt is recognised by what it says instead.
 *
 * Treating it as an ending would be the bug this repo has already shipped once on the floor — an
 * employee walking to their desk and immediately walking back to report while the agent was
 * still working. Here it would be worse, because the strip would then show a **completed** task
 * whose outcome nobody ever saw.
 */
function endsHere(entry: Extract<TimelineEntry, { kind: 'tool' }>): boolean {
  if (!entry.settled || entry.result === null) return false
  return !(isDelegationTool(entry.name) && isAsyncLaunch(entry.result))
}
