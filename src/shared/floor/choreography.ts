/**
 * Choreography — turning what actually happened into who walks where.
 *
 * The office is a *depiction of real events*, and this is the file where that promise is kept
 * or broken. Every routine below is caused by a fact lifted out of the Claude event stream:
 * a `Task` tool call, a tool result, a turn ending. Nothing here invents activity to make the
 * floor look busy, and nothing here keeps animating a thing that has already stopped being
 * true.
 *
 * The lifecycle of a delegated task, and how the floor tells it:
 *
 * | What really happens                       | What you see                                    |
 * |-------------------------------------------|-------------------------------------------------|
 * | manager calls `Task(subagent_type: X)`    | X walks into the office, stands at the desk     |
 * | the subagent runs                         | X walks back and works at their own desk        |
 * | the `tool_result` comes back              | X returns to the office, hands it over          |
 * | after the beat                            | X goes back to their desk                       |
 *
 * The round trip is not decoration — it is the shape of the actual data flow. A subagent
 * receives a brief from the manager and returns a result to the manager, and that is exactly
 * twice that a character has reason to be in that room.
 *
 * ## The one rule that keeps it honest
 *
 * A depiction must never outlive the fact it depicts. Facts supersede: a newer fact about a
 * character cancels whatever that character was doing. If a task finishes in under a second,
 * the employee does not finish a leisurely walk to a briefing that is already over — the
 * delivery routine takes over mid-stride.
 *
 * The single exception is deliberately asymmetric. {@link Priority.ambient} routines come from
 * the app's own UI state (you are typing) rather than from Claude, and they may never
 * interrupt a routine caused by real work. A manager who is genuinely mid-task stays at their
 * desk while you type, because that is what is genuinely happening. This is the rare case; you
 * are usually typing precisely because the manager is waiting on you.
 */

import { isDelegationTool } from '../delegation.js'
import type { Direction } from './geometry.js'

/** Where a routine can send someone. Resolved to tiles by the floorplan. */
export type StationRef =
  | { readonly at: 'desk'; readonly who: string }
  | { readonly at: 'briefing' }
  | { readonly at: 'window' }
  | { readonly at: 'shelf' }
  /** A named seat at the meeting table. Seats are assigned in the order people were called. */
  | { readonly at: 'meeting'; readonly seat: number }
  /** The lounge — the sofa, or the water cooler. Where an idle agent goes. */
  | { readonly at: 'lounge'; readonly spot: 'sofa' | 'cooler' | 'coffee' }

/** What a character is visibly doing while standing still. */
export type Pose = 'idle' | 'working' | 'listening'

export type Step =
  | { readonly kind: 'walk'; readonly to: StationRef }
  | { readonly kind: 'face'; readonly direction: Direction }
  | { readonly kind: 'pause'; readonly ms: number }
  | { readonly kind: 'pose'; readonly pose: Pose }

export const Priority = {
  /** Caused by app state, not by Claude. Yields to everything. */
  ambient: 0,
  /** Caused by a real event in the session. */
  work: 1,
} as const

/**
 * Why a character is doing this.
 *
 * Carried so the floor can be audited. Click someone mid-walk and the popup can say "taking a
 * brief from the manager" and point at the tool call that caused it — a claim backed by an id
 * in the transcript rather than by the animation looking plausible.
 */
export interface Reason {
  readonly summary: string
  readonly cause: Fact['kind'] | 'idle'
  /** The `tool_use` id this traces back to, when there is one. */
  readonly toolUseId?: string
}

export interface Routine {
  readonly who: string
  readonly name: 'briefing' | 'delivering' | 'settling' | 'resting' | 'attending' | 'returning' | 'fetching' | 'meeting' | 'dispersing' | 'break'
  readonly steps: readonly Step[]
  readonly priority: number
  readonly reason: Reason
}

/**
 * A fact about the session, already lifted out of the raw stream.
 *
 * Deliberately narrower than `ClaudeEvent`: the choreographer should be impossible to feed
 * ambiguous input. {@link factsFromEvent} does the extraction.
 */
export type Fact =
  | {
      readonly kind: 'dispatch'
      readonly toolUseId: string
      readonly employee: string
      readonly brief: string | null
    }
  | { readonly kind: 'delivered'; readonly toolUseId: string }
  /**
   * A dispatched agent actually began, in the background.
   *
   * Arrives **before** the dispatch's own `tool_result`, which matters: with
   * `run_in_background` defaulting to true that result is a launch receipt, not an answer, and
   * knowing a background task exists is what lets the floor ignore it.
   */
  | { readonly kind: 'running'; readonly toolUseId: string }
  | { readonly kind: 'acting'; readonly who: string; readonly tool: string }
  /** Somebody invoked a skill. The floor sends them to the shelf for it. */
  | { readonly kind: 'fetching'; readonly who: string; readonly skill: string }
  /**
   * A meeting was called.
   *
   * Separate from `fetching` even though both arrive as a `Skill` call, because they are
   * different events that happen to share a tool. Reading `meet` as a fetch sent the manager to
   * the bookshelf — the floor depicting the wrong thing, which standing order 3 rates as worse
   * than depicting nothing at all.
   */
  | {
      readonly kind: 'meeting'
      readonly toolUseId: string
      readonly convener: string
      readonly attendees: readonly string[]
    }
  | { readonly kind: 'settled'; readonly who: string }
  | { readonly kind: 'composing'; readonly composing: boolean }
  /**
   * The conversation is live — you and the manager are working something out together.
   *
   * The requirement: while you and the manager are talking and the manager is on screen, it
   * must not go back to its desk — it stays at the monitor, thinking about the conversation and
   * giving real feedback right then and there.
   *
   * `composing` was the wrong thing to hang this on, and the bug is visible in its name: it is
   * true while you are **typing**, so the manager turned to listen at your first keystroke and
   * walked away the moment you paused — mid-conversation, with its own reply still arriving. It
   * depicted the state of your keyboard and called it attention.
   *
   * This is the state of the *conversation*, which is what a person means by talking to
   * somebody. The app knows it exactly — `intake` and `planning` are the modes where the two of
   * you are deciding something and nobody has been sent to build it yet — so the floor can
   * depict it rather than infer it.
   */
  | { readonly kind: 'conversing'; readonly conversing: boolean }

export interface AmbientOptions {
  /** Returns `0 <= r < n`. Injected so idle behaviour is deterministic under test. */
  readonly pick: (n: number) => number
  /**
   * Anyone who must stay at their desk however quiet their session is.
   *
   * A failed VERIFY is the case this exists for: somebody with broken work outstanding is not
   * on a coffee break, and showing them on the sofa would be the floor being *reassuring*
   * rather than truthful.
   */
  readonly grounded?: ReadonlySet<string>
}

export interface ChoreographyOptions {
  readonly manager: string
  /** Everyone who has a desk. A dispatch to anyone else is reported, not silently dropped. */
  readonly roster: Iterable<string>
}

/** Something real happened that the floor cannot show. Surfaced, never swallowed. */
export interface Unstaged {
  readonly employee: string
  /**
   * The dispatch this was. The notice says *"the work is real"*, and this is what makes that
   * checkable rather than merely asserted — the same evidence the work log and the character
   * card carry.
   *
   * It used to be built here and dropped one line later: `floor-view.ts` narrowed the whole fact
   * to `missing.employee` at the callback boundary, so the id never left this file.
   */
  readonly toolUseId: string
  /**
   * Why it could not be staged.
   *
   * One value today, and deliberately not switched on for that reason — a `switch` with one arm
   * is a branch pretending to be a decision. It stays a union because the second reason (a desk
   * that exists and is occupied) is a real possibility, and when it arrives the notice will need
   * to say something different.
   */
  readonly why: 'no-desk'
}

export interface Staged {
  readonly routines: readonly Routine[]
  /**
   * Dispatches to agents with no desk — a built-in type like `general-purpose`, or an agent
   * added to the workspace since the floor was laid out. The work is real and the UI should
   * say so; an office that just fails to react is the floor quietly lying about what the
   * session is doing.
   */
  readonly unstaged: readonly Unstaged[]
}

const EMPTY: Staged = { routines: [], unstaged: [] }

/** How long a character stands at the manager's desk during a handoff, in milliseconds. */
const HANDOFF_BEAT = 700

/**
 * How long somebody must be *continuously* idle before they drift off.
 *
 * Long enough that it reads as "there is nothing to do" rather than as fidgeting between tool
 * calls, and long enough that a normal working session never triggers it.
 */
export const BREAK_AFTER_MS = 45_000

/**
 * How much of that threshold is spread across the staff.
 *
 * **Reported from the running app: the agents take too many breaks, and they take them
 * together.** Both halves were one bug and it is worth naming precisely, because
 * the mechanism is not obvious and the symptom is: every idle character accumulated idleness at
 * the same rate from the same moment, so they all crossed the same threshold on the same frame
 * and left their desks in lockstep. An office where six people stand up at once does not read
 * as a lull, it reads as a fire drill.
 *
 * Each person's threshold is now offset by a stable fraction of their name's hash, so the same
 * agent always waits the same amount and no two wait the same amount. The office empties the way
 * an office empties: one at a time, unevenly.
 */
export const BREAK_STAGGER_MS = 30_000

/** Longer than this in one call is a gap in time, not a stretch of idleness. */
const DISCONTINUITY_MS = 2 * (45_000 + 30_000)

/** How long they stay there before wandering back. */
const BREAK_LASTS_MS = 8_000

/**
 * Quiet after a break before the same person may take another.
 *
 * The other half of "too many". Without it, somebody who returns to a still-idle office starts
 * the clock again immediately and is back at the coffee machine within the minute — a loop that
 * looks less like a lull than like pacing.
 */
const BREAK_COOLDOWN_MS = 90_000

/** Stable 0..1 per name. The same hash the character recipe uses, for the same reason. */
function fractionOf(name: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h % 1000) / 1000
}

export class Choreographer {
  private manager: string
  private roster: Set<string>
  /** `tool_use` id → who it was dispatched to. Correlates a result back to a character. */
  private readonly dispatched = new Map<string, string>()
  /** Characters currently mid-task according to the stream — not according to the animation. */
  private readonly busy = new Set<string>()
  private readonly running = new Map<string, Routine>()
  /** `tool_use` id of a live meeting → everyone it called. Ends when that call returns. */
  private readonly meetings = new Map<string, readonly string[]>()
  /** How long each character has been continuously idle, in milliseconds. */
  private readonly idleFor = new Map<string, number>()
  /** When each person last took a break, on this choreographer's own clock. */
  private readonly lastBreak = new Map<string, number>()
  /** Milliseconds of ambient time observed. Not wall time — it only advances while running. */
  private clock = 0
  private composing = false
  private conversing = false

  constructor(options: ChoreographyOptions) {
    this.manager = options.manager
    this.roster = new Set(options.roster)
  }

  /**
   * The staff changed. Keep everything that is still in flight.
   *
   * The workspace is watched, so a roster change lands in the middle of real work as a matter
   * of routine — someone adds an agent file while a subagent is running. Rebuilding the
   * choreographer at that moment throws away `dispatched`, which is the only record of which
   * character a pending `tool_result` belongs to. The result then arrives, matches nothing, and
   * the employee who was sent to do the work never walks back with it: they stand at their desk
   * forever while the transcript says the task is done.
   *
   * That is the floor outliving the fact it depicts, caused by an event that has nothing to do
   * with the work. So the roster is swapped and the in-flight state is left alone.
   */
  updateRoster(options: ChoreographyOptions): void {
    this.manager = options.manager
    this.roster = new Set(options.roster)

    // Anyone who left the workspace has no desk to be depicted at. Their routine goes; a
    // dispatch still out in their name does not, because that work is real and may still
    // come back.
    for (const who of [...this.running.keys()]) {
      if (!this.knows(who)) this.running.delete(who)
    }
  }

  /** Who is at work right now, per the event stream. Exposed for the status UI. */
  isBusy(who: string): boolean {
    return this.busy.has(who)
  }

  /** What a character is doing and why, or `null` if they are at rest. */
  routineFor(who: string): Routine | null {
    return this.running.get(who) ?? null
  }

  /** Call when a routine's last step completes, so ambient behaviour can resume. */
  finished(who: string): Staged {
    const done = this.running.get(who)
    this.running.delete(who)
    // You may have started typing while they were busy. Now that they are free, they can come
    // to the window — but only if the stream agrees they are actually free.
    //
    // **Never in answer to attending.** All three of its steps finish the instant the manager is
    // already at the window — the walk has nowhere to go, and `face` and `pose` take effect as
    // they begin — so re-staging here completes again on the next frame and stages again, for as
    // long as anybody is composing. A routine that restarts itself every frame.
    //
    // It spun in silence for as long as the frame gate covered for it: nothing moved, so the
    // gate parked and the loop stopped asking. Teaching the loop that a routine in flight is a
    // change — which it had to learn for a coffee break to survive its own pause — turned the
    // silent spin into sixty frames a second with the office standing still. Measured: 1807
    // frames in thirty seconds, all of them the manager.
    if (
      who === this.manager &&
      done?.name !== 'attending' &&
      (this.composing || this.conversing) &&
      !this.busy.has(this.manager)
    ) {
      return this.stage(this.attendRoutine())
    }
    return EMPTY
  }

  /** Feed one fact. Returns the routines that should start now. */
  handle(fact: Fact): Staged {
    switch (fact.kind) {
      case 'dispatch':
        return this.onDispatch(fact)
      case 'running':
        return this.onRunning(fact)
      case 'delivered':
        return this.onDelivered(fact)
      case 'acting':
        return this.onActing(fact)
      case 'fetching':
        return this.onFetching(fact)
      case 'meeting':
        return this.onMeeting(fact)
      case 'settled':
        return this.onSettled(fact)
      case 'composing':
        return this.onComposing(fact)
      case 'conversing':
        return this.onConversing(fact)
    }
  }

  /** Dispatches known to be running in the background, whose `tool_result` is only a receipt. */
  private readonly background = new Set<string>()

  private onDispatch(fact: Extract<Fact, { kind: 'dispatch' }>): Staged {
    this.dispatched.set(fact.toolUseId, fact.employee)
    this.markBusy(fact.employee)

    if (!this.roster.has(fact.employee)) {
      return { routines: [], unstaged: [{ ...fact, why: 'no-desk' }] }
    }

    const reason: Reason = {
      summary: fact.brief
        ? `taking a brief from ${this.manager}: ${fact.brief}`
        : `taking a brief from ${this.manager}`,
      cause: 'dispatch',
      toolUseId: fact.toolUseId,
    }

    return this.stage({
      who: fact.employee,
      name: 'briefing',
      priority: Priority.work,
      reason,
      steps: [
        { kind: 'walk', to: { at: 'briefing' } },
        { kind: 'face', direction: 'up' },
        { kind: 'pause', ms: HANDOFF_BEAT },
        { kind: 'walk', to: { at: 'desk', who: fact.employee } },
        { kind: 'pose', pose: 'working' },
      ],
    })
  }

  /**
   * A dispatched agent began working in the background.
   *
   * Nothing moves — `onDispatch` already walked them to their desk. What this records is that
   * the `tool_result` about to arrive for this id is a **launch receipt, not an ending**, so
   * they stay working until the real completion.
   */
  private onRunning(fact: Extract<Fact, { kind: 'running' }>): Staged {
    if (this.dispatched.has(fact.toolUseId)) this.background.add(fact.toolUseId)
    return EMPTY
  }

  private onDelivered(fact: Extract<Fact, { kind: 'delivered' }>): Staged {
    // A meeting is a tool call too, and its result is the moment it is over.
    const ended = this.endMeeting(fact.toolUseId)
    if (ended.routines.length > 0) return ended

    // The launch receipt for a background dispatch. `run_in_background` defaults to true, so
    // this arrives within milliseconds of the dispatch and says the agent was *launched* — not
    // what it found. Acting on it is what made an employee walk to their desk and immediately
    // walk back to report while the agent was still working. Cleared here so the real
    // completion, which carries the same id, is the one that ends the task.
    if (this.background.has(fact.toolUseId)) {
      this.background.delete(fact.toolUseId)
      return EMPTY
    }

    const employee = this.dispatched.get(fact.toolUseId)
    // Most tool results are not subagent results. An id we never dispatched is a `Read` or a
    // `Bash` coming home, and nobody needs to walk anywhere.
    if (!employee) return EMPTY

    this.dispatched.delete(fact.toolUseId)
    this.busy.delete(employee)
    if (!this.roster.has(employee)) return EMPTY

    return this.stage({
      who: employee,
      name: 'delivering',
      priority: Priority.work,
      reason: {
        summary: `handing the result back to ${this.manager}`,
        cause: 'delivered',
        toolUseId: fact.toolUseId,
      },
      steps: [
        { kind: 'walk', to: { at: 'briefing' } },
        { kind: 'face', direction: 'up' },
        { kind: 'pause', ms: HANDOFF_BEAT },
        { kind: 'walk', to: { at: 'desk', who: employee } },
        { kind: 'pose', pose: 'idle' },
      ],
    })
  }

  /**
   * Somebody used a skill, so they go and get it.
   *
   * The vision's own image of what using a capability looks like: walk to the shelf, take
   * something down, carry it back to the desk. It outranks the `settling` that an ordinary tool
   * call produces — a skill *is* a tool call, and "went to fetch the thing they used" is a more
   * truthful account of the same moment than "sat down and worked".
   *
   * It does not outrank a briefing or a delivery. Those are the two ends of a dispatch, and a
   * skill invoked in the middle of one does not change whose hands the work is in.
   */
  private onFetching(fact: Extract<Fact, { kind: 'fetching' }>): Staged {
    this.markBusy(fact.who)
    if (!this.knows(fact.who)) return EMPTY

    const current = this.running.get(fact.who)
    if (current && (current.name === 'briefing' || current.name === 'delivering')) return EMPTY

    return this.stage({
      who: fact.who,
      name: 'fetching',
      priority: Priority.work,
      reason: { summary: `fetching ${fact.skill} from the shelf`, cause: 'fetching' },
      steps: [
        { kind: 'walk', to: { at: 'shelf' } },
        { kind: 'face', direction: 'up' },
        { kind: 'pause', ms: HANDOFF_BEAT },
        { kind: 'walk', to: { at: 'desk', who: fact.who } },
        { kind: 'pose', pose: 'working' },
      ],
    })
  }

  /**
   * A meeting was called. Everyone named walks to the table and stays there.
   *
   * The convener takes the first seat and the people they called take the rest, in the order
   * they were named — so the picture matches the invocation rather than an arrangement the
   * floor chose. Nobody sits: they walk to the seat and stand at it, because the cast has no
   * sitting frame and drawing one it does not have would be inventing a posture.
   *
   * There is no pause and no walk home in these steps, and that is the point. A meeting lasts
   * as long as the tool call lasts, so it ends when the result arrives — see
   * {@link onDelivered}. A routine that walked them back after a fixed beat would be a
   * depiction with its own opinion about how long a meeting takes.
   */
  private onMeeting(fact: Extract<Fact, { kind: 'meeting' }>): Staged {
    const called = [fact.convener, ...fact.attendees].filter(
      (who, i, all) => this.knows(who) && all.indexOf(who) === i,
    )
    if (called.length === 0) return EMPTY

    this.meetings.set(fact.toolUseId, called)
    const routines: Routine[] = []

    for (const [seat, who] of called.entries()) {
      this.markBusy(who)
      const staged = this.stage({
        who,
        name: 'meeting',
        priority: Priority.work,
        reason: {
          summary:
            who === fact.convener
              ? `chairing a meeting${fact.attendees.length ? ` with ${fact.attendees.join(', ')}` : ''}`
              : `called to a meeting by ${fact.convener}`,
          cause: 'meeting',
          toolUseId: fact.toolUseId,
        },
        steps: [
          { kind: 'walk', to: { at: 'meeting', seat } },
          { kind: 'face', direction: 'up' },
          { kind: 'pose', pose: 'listening' },
        ],
      })
      routines.push(...staged.routines)
    }

    // Anyone named who has no desk is reported, exactly as a dispatch to a stranger is.
    const unstaged = fact.attendees
      .filter((who) => !this.knows(who))
      .map((employee) => ({ employee, toolUseId: fact.toolUseId, why: 'no-desk' as const }))

    return { routines, unstaged }
  }

  /** The meeting ended because its tool call returned. Everyone goes back to their desk. */
  private endMeeting(toolUseId: string): Staged {
    const called = this.meetings.get(toolUseId)
    if (!called) return EMPTY
    this.meetings.delete(toolUseId)

    const routines: Routine[] = []
    for (const who of called) {
      this.busy.delete(who)
      // Only move people the meeting still owns. Anyone pulled away by real work since is
      // depicting something newer and truer than a meeting that has just finished.
      if (this.running.get(who)?.name !== 'meeting') continue
      routines.push(
        ...this.stage({
          who,
          name: 'dispersing',
          priority: Priority.work,
          reason: { summary: 'back from the meeting', cause: 'delivered', toolUseId },
          steps: [
            { kind: 'walk', to: { at: 'desk', who } },
            { kind: 'pose', pose: 'idle' },
          ],
        }).routines,
      )
    }
    return { routines, unstaged: [] }
  }

  /**
   * How long until anybody could earn a break, or `null` when nobody can.
   *
   * Exists so a parked floor can sleep exactly as long as it needs to rather than poll. Every
   * threshold is `BREAK_AFTER_MS + fractionOf(who) * BREAK_STAGGER_MS` and `fractionOf` is a
   * pure hash of the name, so the answer is computable the moment the loop stops — which is what
   * makes the feature affordable at all. The charter's first budget is *zero draw calls while
   * nothing changes*, and a timer that sleeps costs nothing while a loop that checks costs
   * everything the budget was written to prevent.
   *
   * `null` for an office where nobody is eligible — everyone busy, running, or grounded. Not
   * zero, which would read as *"right now"* and arm a timer that fires immediately and stages
   * nothing, forever.
   *
   * The cooldown is folded in, so somebody who has just had one is not reported as due.
   */
  msUntilNextBreak(options: { readonly grounded?: ReadonlySet<string> } = {}): number | null {
    let soonest: number | null = null

    for (const who of this.everyone()) {
      if (this.busy.has(who) || this.running.has(who) || options.grounded?.has(who)) continue

      const idle = this.idleFor.get(who) ?? 0
      const threshold = BREAK_AFTER_MS + fractionOf(who) * BREAK_STAGGER_MS
      const cooling = (this.lastBreak.get(who) ?? -Infinity) + BREAK_COOLDOWN_MS
      const wait = Math.max(threshold - idle, cooling - this.clock, 0)

      if (soonest === null || wait < soonest) soonest = wait
    }

    return soonest
  }

  /**
   * Time passes, and the people with nothing to do start to look like it.
   *
   * The requirement that the office work like a living office — agents taking coffee breaks,
   * walking about. Read literally that is **invented activity**, which this module refuses to
   * do in as many words a hundred lines above. It resolves, and the resolution is the feature
   * rather than a caveat:
   *
   * > **An idle agent walking to the coffee machine is not a lie. It is the truest available
   * > picture of an agent that is doing nothing.**
   *
   * So the rule is a boundary, not a ban, and it is enforced here rather than described
   * anywhere:
   *
   *   - **Busy stays put.** Anyone the stream says is working, or who has a routine running, is
   *     at their desk. Their idle clock is reset, not paused — a break is earned by being idle
   *     *continuously*, so somebody who works in short bursts never drifts off mid-task.
   *   - **`grounded` stays put.** Someone carrying a failed VERIFY is not on a coffee break,
   *     however quiet their session is.
   *   - **Ambient priority.** A real event interrupts a break mid-stride, using the machinery
   *     that already exists for it.
   *
   * `pick` is injected so this is deterministic under test. An office whose idle behaviour can
   * only be observed by watching it is an office whose idle behaviour is not checked.
   */
  ambient(dtMs: number, options: AmbientOptions): Staged {
    this.clock += dtMs

    // A gap this large is not idleness, and must not be spent as if it were.
    //
    // Handed an hour — a closed laptop, a suspended process, a timer that fired late — every
    // idle person crosses their threshold inside one call and the whole office stands up
    // together, which is exactly the lockstep `BREAK_STAGGER_MS` exists to prevent. `floor.ts`
    // holds the walker against the same hazard; this had no equivalent.
    //
    // Resetting rather than clamping, because the honest reading is that nothing happened. If
    // the machine was asleep nobody was sitting at a desk doing nothing — there was no office —
    // and counting it as idle time would be inventing idleness and then walking somebody to the
    // coffee machine to depict it. The clocks start again from now and a break is earned in the
    // ordinary way.
    //
    // The bound is twice the longest a break can take to earn, so a floor that parked and handed
    // back its own idle time is well inside it. Clamping that away would fix the stampede by
    // removing the feature.
    if (dtMs > DISCONTINUITY_MS) {
      for (const who of this.everyone()) this.idleFor.set(who, 0)
      return { routines: [], unstaged: [] }
    }

    const routines: Routine[] = []

    for (const who of this.everyone()) {
      // Busy, or already doing something. Reset rather than pause: a break is earned by being
      // idle continuously.
      if (this.busy.has(who) || this.running.has(who) || options.grounded?.has(who)) {
        this.idleFor.set(who, 0)
        continue
      }

      const idle = (this.idleFor.get(who) ?? 0) + dtMs
      // Staggered per person, so the office does not empty in lockstep, and pushed out further
      // for anyone who has just had one.
      const cooling = (this.lastBreak.get(who) ?? -Infinity) + BREAK_COOLDOWN_MS
      const threshold = BREAK_AFTER_MS + fractionOf(who) * BREAK_STAGGER_MS
      this.clock += 0
      if (idle < threshold || this.clock < cooling) {
        this.idleFor.set(who, idle)
        continue
      }
      this.idleFor.set(who, 0)
      this.lastBreak.set(who, this.clock)

      // Three places to be idle, and the pantry is one of them — an eating area nobody ever
      // walks to is scenery.
      const spot = (['sofa', 'cooler', 'coffee'] as const)[options.pick(3)] ?? 'sofa'
      routines.push(
        ...this.stage({
          who,
          name: 'break',
          priority: Priority.ambient,
          reason: {
            summary:
              spot === 'sofa'
                ? 'on the sofa — nothing to do'
                : spot === 'coffee'
                  ? 'in the pantry, making coffee'
                  : 'at the water cooler',
            cause: 'idle',
          },
          steps: [
            { kind: 'walk', to: { at: 'lounge', spot } },
            { kind: 'pose', pose: 'idle' },
            { kind: 'pause', ms: BREAK_LASTS_MS },
            { kind: 'walk', to: { at: 'desk', who } },
            { kind: 'pose', pose: 'idle' },
          ],
        }).routines,
      )
    }

    return routines.length ? { routines, unstaged: [] } : EMPTY
  }

  /**
   * Busy from now, with the idle clock started again.
   *
   * `ambient` resets the clock too, but only when it is called, and the floor does not call it for a
   * conversation that is not on screen or while the campus is up. Somebody who worked through that
   * and finished had earned no break, however idle they were before it.
   */
  private markBusy(who: string): void {
    this.busy.add(who)
    this.idleFor.set(who, 0)
  }

  /** The manager and everyone with a desk. */
  private everyone(): string[] {
    return [this.manager, ...this.roster]
  }

  private onActing(fact: Extract<Fact, { kind: 'acting' }>): Staged {
    this.markBusy(fact.who)
    if (!this.knows(fact.who)) return EMPTY

    // Tool calls arrive in a stream, several a second. Re-issuing a routine for each one would
    // leave a character twitching at their desk, and would yank an employee out of the
    // manager's office the instant their subagent made its first call — the walk home from a
    // briefing already ends at the right desk in the right pose.
    //
    // Ambient routines are the exception, and the reason this is a priority check rather than
    // a "busy?" check: someone who wandered to the window because you were typing should be
    // pulled back to their desk the moment there is genuine work to show.
    const current = this.running.get(fact.who)
    if (current && current.priority >= Priority.work) return EMPTY

    return this.stage({
      who: fact.who,
      name: 'settling',
      priority: Priority.work,
      reason: { summary: `working — ${fact.tool}`, cause: 'acting' },
      steps: [
        { kind: 'walk', to: { at: 'desk', who: fact.who } },
        { kind: 'pose', pose: 'working' },
      ],
    })
  }

  private onSettled(fact: Extract<Fact, { kind: 'settled' }>): Staged {
    this.busy.delete(fact.who)
    if (!this.knows(fact.who)) return EMPTY

    const current = this.running.get(fact.who)
    // A delivery walk is a depiction *of* the work ending, so it has to be allowed to finish.
    // Only the "head down at the desk" depiction stops being true the instant work stops, and
    // clearing it here is what lets the character be given something else to do.
    if (current && current.name !== 'settling') return EMPTY
    this.running.delete(fact.who)

    if (fact.who === this.manager && (this.composing || this.conversing)) {
      return this.stage(this.attendRoutine())
    }

    return this.stage({
      who: fact.who,
      name: 'resting',
      priority: Priority.work,
      reason: { summary: 'done for now', cause: 'settled' },
      steps: [{ kind: 'pose', pose: 'idle' }],
    })
  }

  private knows(who: string): boolean {
    return who === this.manager || this.roster.has(who)
  }

  private onComposing(fact: Extract<Fact, { kind: 'composing' }>): Staged {
    if (this.composing === fact.composing) return EMPTY
    this.composing = fact.composing

    if (fact.composing) {
      // A manager who is actually mid-task does not drop it to come and watch you type.
      if (this.busy.has(this.manager)) return EMPTY
      return this.stage(this.attendRoutine())
    }

    // You stopped typing. That is not the end of a conversation, and treating it as one is the
    // bug being fixed here — so while the two of you are still deciding something, they stay.
    if (this.conversing) return EMPTY

    // Only walk them back if the window is in fact where they went.
    if (this.running.get(this.manager)?.name !== 'attending') return EMPTY

    return this.stage({
      who: this.manager,
      name: 'returning',
      priority: Priority.ambient,
      reason: { summary: 'back to the desk', cause: 'composing' },
      steps: [
        { kind: 'walk', to: { at: 'desk', who: this.manager } },
        { kind: 'pose', pose: 'idle' },
      ],
    })
  }

  /**
   * The conversation opened or closed.
   *
   * Opening brings the manager over if they are free; closing is deliberately *not* the mirror
   * of that. Ending a conversation means work is about to start, and the routines that depict
   * work already move people to their desks — sending them there from here as well would be two
   * systems moving one character, which is how the floor learns to contradict itself.
   */
  private onConversing(fact: Extract<Fact, { kind: 'conversing' }>): Staged {
    if (this.conversing === fact.conversing) return EMPTY
    this.conversing = fact.conversing

    if (!fact.conversing) return EMPTY
    if (this.busy.has(this.manager)) return EMPTY
    if (this.running.get(this.manager)?.name === 'attending') return EMPTY

    return this.stage(this.attendRoutine())
  }

  private attendRoutine(): Routine {
    return {
      who: this.manager,
      name: 'attending',
      priority: Priority.ambient,
      reason: { summary: 'listening — you are typing', cause: 'composing' },
      steps: [
        { kind: 'walk', to: { at: 'window' } },
        { kind: 'face', direction: 'right' },
        { kind: 'pose', pose: 'listening' },
      ],
    }
  }

  /**
   * Admit a routine, or refuse it.
   *
   * Equal priority means the newer fact wins, which is what makes a depiction unable to
   * outlive its cause. Lower priority is refused outright — that is the whole of the rule that
   * app state never overrides real work.
   */
  private stage(routine: Routine): Staged {
    const current = this.running.get(routine.who)
    if (current && routine.priority < current.priority) return EMPTY
    this.running.set(routine.who, routine)
    return { routines: [routine], unstaged: [] }
  }
}

// ────────────────────────────────────────────────────────── reading the stream ──

/**
 * The minimum of a `ClaudeEvent` this needs. Keeps the module free of a stream import.
 *
 * The point of writing it out is that `ClaudeEvent` has to stay assignable to it — if the stream
 * grows a field or renames one this module depends on, the call site stops compiling and somebody
 * finds out. That check was switched off: the one caller passed `event as never`, which is not a
 * cast to a wider type but an instruction to stop checking altogether. Removing it changes
 * nothing today, because `ClaudeEvent` is assignable as written; the value is entirely in what
 * happens the day it is not.
 */
export interface EventLike {
  readonly kind: string
  /** Set on `task-started` and `task-finished`, which carry no blocks. */
  readonly toolUseId?: string
  readonly blocks?: readonly {
    readonly type: string
    readonly id?: string
    readonly name?: string
    readonly input?: Record<string, unknown>
    readonly tool_use_id?: string
  }[]
  // No `who`. `factsFromEvent` takes the speaker as its second argument, which is where it comes
  // from — the renderer knows whose conversation this is, and the event does not. A second way to
  // say it that nothing ever set was one more thing for the two to disagree about.
}

/**
 * Extract the facts a floor can act on from one stream event.
 *
 * A subagent dispatch is a `Task` tool call whose `subagent_type` names an agent; its result
 * arrives later as a `tool_result` carrying the same id. That id is the only reliable way to
 * connect the two — the events are far apart in the stream and there is nothing else in a
 * result that says whose it was.
 */
export function factsFromEvent(event: EventLike, speaker: string): Fact[] {
  const facts: Fact[] = []

  // The dispatch lifecycle, which is not carried in `blocks` at all.
  //
  // `run_in_background` defaults to true, so a dispatch's `tool_result` arrives within
  // milliseconds saying the agent was *launched*. Treating that as the ending is what made an
  // employee walk to their desk and immediately walk back to report, while the agent was still
  // working — the floor claiming an ending that had not happened, which is the one thing it may
  // never do.
  if (event.kind === 'task-started' && event.toolUseId) {
    return [{ kind: 'running', toolUseId: event.toolUseId }]
  }
  if (event.kind === 'task-finished' && event.toolUseId) {
    return [{ kind: 'delivered', toolUseId: event.toolUseId }]
  }

  if (!event.blocks) return facts

  for (const block of event.blocks) {
    if (block.type === 'tool_use' && block.name && isDelegationTool(block.name) && block.id) {
      const employee = asString(block.input?.['subagent_type'])
      if (employee) {
        facts.push({
          kind: 'dispatch',
          toolUseId: block.id,
          employee,
          brief: asString(block.input?.['description']),
        })
        continue
      }
    }

    // A skill is a tool call, and it is also somebody going to get something. The second is
    // the more truthful account of the moment, so it is the one the floor uses.
    if (block.type === 'tool_use' && block.name === 'Skill') {
      const skill = asString(block.input?.['skill'])
      // `meet` is a skill, but it is not a fetch. Everything else off the shelf is.
      if (skill === MEET_SKILL && block.id) {
        facts.push({
          kind: 'meeting',
          toolUseId: block.id,
          convener: speaker,
          // Attendees come from the payload rather than from prose. `args` is what the skill
          // was actually invoked with, so who is at the meeting is a fact and not a reading.
          attendees: attendeesFrom(block.input?.['args']),
        })
        continue
      }
      if (skill) {
        facts.push({ kind: 'fetching', who: speaker, skill })
        continue
      }
    }

    if (block.type === 'tool_use' && block.name) {
      facts.push({ kind: 'acting', who: speaker, tool: block.name })
    }

    if (block.type === 'tool_result' && block.tool_use_id) {
      facts.push({ kind: 'delivered', toolUseId: block.tool_use_id })
    }
  }

  return facts
}

/** The skill that calls a meeting. One definition; see `delegation.ts` for why. */
export const MEET_SKILL = 'meet'

/** Whitespace-separated names, as the skill was invoked with them. */
function attendeesFrom(args: unknown): string[] {
  return typeof args === 'string' ? args.split(/\s+/).filter(Boolean) : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
