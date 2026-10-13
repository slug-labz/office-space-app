/**
 * Speech bubbles — what somebody said, and when it stops being true.
 *
 * Click an employee and a bubble appears over their head saying what they are doing. The
 * saying is the easy half. The hard half is that **an answer is about a moment**, and the
 * moment passes: an aside takes a second or two to come back, and in that time the character
 * it is about may have finished, been handed something else, or walked across the room.
 *
 * The office rule is that a depiction may not outlive the fact it depicts, and a bubble is a
 * depiction made of words — the most literal kind there is. A stale bubble is not a cosmetic
 * problem; it is the floor stating something about the session that is no longer so. So every
 * bubble is stamped with the situation it was asked about, and:
 *
 *   - an answer that arrives after the situation changed is **discarded, never shown**;
 *   - a bubble whose situation has moved on is dropped on the next reconcile.
 *
 * What counts as "the situation" is the caller's to define — on the floor it is the routine a
 * character is running, which is itself caused by a real event. This module only needs it to
 * be a value that changes when the truth does.
 *
 * There is no timeout, deliberately. A bubble on somebody who has been sitting still since
 * they answered is not stale, and expiring it on a clock would be inventing a change that did
 * not happen.
 */

import type { Routine } from './choreography.js'

export type BubbleState =
  /** The question is out; nothing has come back. */
  | 'asking'
  /** They answered. */
  | 'answered'
  /** The aside failed, or came back with nothing. Shown, not hidden. */
  | 'failed'

export interface Bubble {
  readonly who: string
  readonly state: BubbleState
  readonly text: string
  /** The situation this was asked about. When it changes, this is stale. */
  readonly about: string
}

/** What is shown when an aside returns successfully but says nothing at all. */
export const NO_ANSWER = 'No answer came back.'

export class BubbleBoard {
  private readonly bubbles = new Map<string, Bubble>()

  /**
   * Start asking about somebody.
   *
   * Replaces any bubble already over their head — you asked again, so whatever was there is
   * the previous question's answer and no longer what you want to know.
   */
  ask(who: string, about: string): void {
    this.bubbles.set(who, { who, about, state: 'asking', text: '' })
  }

  /**
   * An answer came back.
   *
   * `about` is the situation captured when the question was asked. If it no longer matches
   * what is on the board, the answer describes a moment that has passed and is dropped rather
   * than displayed. Returns whether it was shown, so a caller can tell the difference between
   * an answer that landed and one that was overtaken.
   */
  answer(who: string, about: string, text: string, isError: boolean): boolean {
    const current = this.bubbles.get(who)
    // Cleared while we waited, or asked again about something else. Either way this answer is
    // no longer an answer to anything on screen.
    if (!current || current.about !== about || current.state !== 'asking') return false

    const trimmed = text.trim()
    this.bubbles.set(who, {
      who,
      about,
      state: isError || !trimmed ? 'failed' : 'answered',
      text: trimmed || NO_ANSWER,
    })
    return true
  }

  clear(who: string): void {
    this.bubbles.delete(who)
  }

  clearAll(): void {
    this.bubbles.clear()
  }

  get(who: string): Bubble | null {
    return this.bubbles.get(who) ?? null
  }

  all(): readonly Bubble[] {
    return [...this.bubbles.values()]
  }

  /**
   * Drop every bubble whose situation has moved on.
   *
   * Called each frame against the floor's own idea of what each character is doing. A bubble
   * still waiting on an answer is dropped too — the question was about a moment that is over,
   * so its answer would be stale before it arrived.
   *
   * Returns who was dropped, so the caller can abandon the request rather than let a reply
   * land on an empty board.
   */
  reconcile(situationOf: (who: string) => string): string[] {
    const dropped: string[] = []
    for (const [who, bubble] of this.bubbles) {
      if (situationOf(who) !== bubble.about) {
        this.bubbles.delete(who)
        dropped.push(who)
      }
    }
    return dropped
  }
}

import type { TaskOutcome } from '../tasks.js'

/**
 * What the card says someone is doing, and what backs it.
 *
 * `Reason` exists, by its own comment, "so the floor can be audited. Click someone mid-walk and
 * the popup can say *taking a brief from the manager* **and point at the tool call that caused
 * it** — a claim backed by an id in the transcript rather than by the animation looking
 * plausible." `floor-view.ts` promised the same thing in fewer words: *"Never invented — it names
 * the cause."*
 *
 * It returned `reason.summary` and nothing else. `Reason.cause` was built in thirteen places and
 * read in none, and the id that makes the claim checkable never reached a surface. The third
 * standing order is that nothing on screen may lie, and the floor's own audit trail was the part
 * that had not been wired.
 *
 * So: the summary, and — when the routine traces to a tool call — the id, the way the work log
 * already ends with `dispatch <id>`. Same evidence, same shape, both halves of the card.
 *
 * `cause` is deliberately not printed raw. It is `acting`, `dispatch`, `delivered` — the kind of
 * the fact, useful to this code and meaningless on screen. It earns its place by choosing the
 * preposition, which is the difference between "working" and "waiting on".
 */
export function doingLine(routine: Pick<Routine, 'reason'> | null): {
  readonly text: string
  readonly trace: string | null
} {
  if (!routine) return { text: 'at their desk', trace: null }
  const { summary, cause, toolUseId } = routine.reason
  return {
    text: summary,
    // Only an id that names a real call. A routine with no tool behind it — resting, a break —
    // has nothing to point at, and an empty trace line would imply we lost the evidence rather
    // than that there never was any.
    trace: toolUseId ? `${cause} · ${toolUseId}` : null,
  }
}

/**
 * What the office has actually checked about this person's work, beside what they are doing.
 *
 * `doingLine` answers *"what is happening right now"*, and it answers it from something
 * observed — the choreographer builds those summaries out of real facts (`fact.brief`, a skill
 * being fetched, a result going back to the manager), and the trace names the tool call behind
 * it. That half is already evidence. **It is also only ever about this second.**
 *
 * VISION §3.4 asks a bubble for four things, and the fourth is *"how progress looks"*. Nothing
 * in the bubble answers that. Meanwhile the office runs every task's VERIFY condition and holds
 * the result per person — the monitor already reads it to decide whether a screen is lit or in
 * alarm. The bubble is the one surface that says what somebody is doing without ever saying
 * whether it is working.
 *
 * This is **additive**. It does not touch the doing line, and it does not replace a self-report
 * with a check — the self-report is what §3.4 asks for, in its own words: *"The agent summarizes
 * against that."* What was missing is the office's own answer standing next to it.
 *
 * ## The four must not collapse
 *
 * `uncheckable` is not `failed` and `not-run` is not `passed`. Three of the six mean **no
 * command ran** — see `nothingRan` — and a bubble that rendered those as either a tick or a
 * cross would be inventing a result nobody produced. The task panel already refuses to do that;
 * this matches it rather than deciding it again.
 *
 * `null` when there is no task for them at all. Absent is not "passing", and a bubble that fell
 * silent on failure and on having-no-work-at-all would make silence mean two things.
 */
export function checkedLine(outcome: TaskOutcome | undefined): string | null {
  switch (outcome) {
    case undefined:
      return null
    case 'passed':
      return 'their task\u2019s check passed'
    case 'failed':
      return 'their task\u2019s check failed'
    case 'done':
      return 'their task is marked done'
    case 'refused':
      return 'not checked \u2014 the command was not allowed'
    case 'uncheckable':
      return 'not checked \u2014 the task names nothing to run'
    case 'not-run':
      return 'not checked yet'
  }
}

/**
 * The situation a character is in, as a comparable value.
 *
 * Built from the routine they are running, because a routine is only ever started by a real
 * fact — so "the routine changed" and "the truth changed" are the same statement. The tool
 * call id is included where there is one: two consecutive briefings are different situations
 * even though both are called `briefing`.
 */
export function situationKey(routine: Pick<Routine, 'name' | 'reason'> | null): string {
  if (!routine) return 'idle'
  return routine.reason.toolUseId ? `${routine.name}:${routine.reason.toolUseId}` : routine.name
}
