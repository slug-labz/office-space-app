/**
 * What a turn actually did, kept out of the transcript and one click away from it.
 *
 * The instruction for this panel: take out the tool calls and most of the rest, keep it as
 * simple as possible, and have the manager talk to the user rather than filling this with chat.
 *
 * The instruction is right and the naive reading of it is dangerous. Tool calls are not noise —
 * they are the evidence that what the manager says happened, happened. Deleting them makes the
 * panel calmer and makes the office **unfalsifiable**, which is the one thing this project has
 * refused to ship since its first standing order.
 *
 * So they are **relocated, not removed.** The transcript carries the conversation. This module
 * carries the record. Every turn that did something wears one mark saying how much it did, and
 * that mark opens this.
 *
 * *One* mark: never zero, which is the audit trail deleted, and never two, which is the fault
 * that produced two cards showing one answer.
 */

/** One thing the office did, in the order it did it. */
export interface Step {
  readonly tool: string
  /** The one argument worth reading at a glance — a path, a command, a name. */
  readonly argument: string
  /**
   * How it ended.
   *
   * Four states, and the fourth is the one worth arguing for. `null` is *still running*.
   * `unknown` is **we never found out** — a step that was in flight when the office closed, read
   * back from a saved transcript that can never gain a result.
   *
   * The first version folded `unknown` into `failed`, and it was wrong in the way this project
   * cares about: reopening yesterday's conversation turned a turn red for a command that may
   * well have succeeded after the window went away. "It broke" and "nobody was there to see"
   * are different claims, and a record that cannot tell them apart is inventing the more
   * alarming one.
   */
  outcome: 'ok' | 'failed' | 'unknown' | null
  /** The result, clamped. Absent until it arrives; empty string is a real, different answer. */
  detail: string | null
}

/** Everything one turn did. Ordered. */
export class Ledger {
  private readonly steps: Step[] = []
  private readonly byId = new Map<string, Step>()

  get length(): number {
    return this.steps.length
  }

  get all(): readonly Step[] {
    return this.steps
  }

  /**
   * Whether anything here actually went wrong. Drives the mark's colour, and nothing else.
   *
   * `unknown` deliberately does not count. A turn interrupted by the window closing is not a
   * turn that failed, and colouring it red would be the office reporting a fault it did not
   * observe.
   */
  get failed(): boolean {
    return this.steps.some((s) => s.outcome === 'failed')
  }

  add(id: string | undefined, tool: string, argument: string): Step {
    const step: Step = { tool, argument, outcome: null, detail: null }
    this.steps.push(step)
    if (id) this.byId.set(id, step)
    return step
  }

  /**
   * Close a step out.
   *
   * Three cases, and the middle one was a bug `test/chat-record.test.ts` caught before this
   * shipped: a replayed step recorded itself twice, because replay has no `tool_use` ids and
   * every `settle` therefore looked like a result for a call nobody had seen.
   *
   *   **A known id** settles that step. This is every live result; the stream always carries one.
   *   **No id at all** settles the most recent step still waiting. Safe because the only caller
   *     without ids is `replay`, which walks a saved transcript strictly in order — a step is
   *     added and settled before the next one is read, so "the last open step" is unambiguous.
   *   **An id nobody recognises** is recorded as its own step. An orphan in the record is a
   *     smaller lie than a gap in it, which is the rule the transcript already followed when
   *     results were drawn inline.
   */
  settle(id: string | undefined, outcome: 'ok' | 'failed' | 'unknown', detail: string): void {
    const step = id
      ? (this.byId.get(id) ?? this.add(id, 'result', ''))
      : (this.lastOpen() ?? this.add(undefined, 'result', ''))
    step.outcome = outcome
    step.detail = detail
  }

  /** The most recent step still waiting for a result, or nothing. */
  private lastOpen(): Step | undefined {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      const step = this.steps[i]
      if (step && step.outcome === null) return step
    }
    return undefined
  }
}
