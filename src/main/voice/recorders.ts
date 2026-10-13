/**
 * One recorder per conversation, and a way to forget one.
 *
 * Lifted out of `main.ts` for the reason `network-switch.ts` was lifted out of `store.ts`:
 * `main.ts` imports `electron` at module scope, so nothing under `node:test` can load it, and a
 * bug that lives there cannot be tested. Both bugs below lived there.
 *
 * ## The leak
 *
 * `recorders` and `pending` were keyed by session id and nothing ever removed from them. Closing
 * a conversation marked the registry and pushed the list; the two map entries stayed for the
 * lifetime of the process, one pair per conversation ever opened. Small — a recorder is a
 * manager name and a usually-empty map — and unbounded, which is the part that matters, in the
 * subsystem whose failure mode is already silence.
 *
 * The neighbouring fix for `managers` says it best and this is the same sentence: *"It is keyed
 * by session and nothing removed from it, so every conversation ever opened stayed."*
 *
 * ## The name that lied, which is the worse half
 *
 * The lookup read `recorderFor(project: string)` and every call passed a **session id**. The map
 * was called `recorders` and its comment said *"What has happened in each project"*, while the
 * comment twenty lines below said *"Keyed by conversation: two of a project's sessions running
 * at once are two turns, and digesting them together would summarise work that never happened in
 * one place."*
 *
 * Both cannot be true. The code was right and every name around it was wrong — so the obvious
 * tidy-up, making the call site match the parameter, is precisely the regression the second
 * comment warns about. A name that invites a correctness bug is worse than the leak it sits
 * next to, because the leak costs bytes and the name costs the next person's afternoon.
 */

import type { ClaudeEvent } from '../claude/stream.js'
import { MomentRecorder, type Moment } from './digest.js'

export class Recorders {
  private readonly bySession = new Map<string, MomentRecorder>()
  private readonly pending = new Map<string, Moment[]>()

  /**
   * @param manager who to attribute a moment to when the event does not name anybody. Read per
   *   recorder rather than captured once, because the workspace can be rescanned and the
   *   manager can change while the office is open.
   */
  constructor(private readonly manager: () => string) {}

  /**
   * Accumulate what this event was worth, and hand back the whole turn when it ends.
   *
   * `null` while the turn is still going. The turn end is the moment to speak, not each event —
   * an office that narrates every tool call is unbearable inside two minutes.
   */
  observe(sessionId: string, event: ClaudeEvent): Moment[] | null {
    let recorder = this.bySession.get(sessionId)
    if (!recorder) {
      recorder = new MomentRecorder(this.manager())
      this.bySession.set(sessionId, recorder)
    }

    const moments = [...(this.pending.get(sessionId) ?? []), ...recorder.observe(event)]
    if (event.kind !== 'result') {
      this.pending.set(sessionId, moments)
      return null
    }

    this.pending.set(sessionId, [])
    return moments
  }

  /**
   * Drop everything held for one conversation.
   *
   * Called when it closes. Safe on a session that was never seen — closing a conversation the
   * voice never watched (it was off, or nothing happened) is ordinary, not an error.
   */
  forget(sessionId: string): void {
    this.bySession.delete(sessionId)
    this.pending.delete(sessionId)
  }

  /**
   * Drop everything, for every conversation.
   *
   * Switching the voice off. Coming back on should not open with a summary of a quarter of an
   * hour somebody deliberately asked not to hear about — and the recorders go too, not just the
   * accumulated moments: a recorder pairs a `tool_use` with the `tool_result` that answers it,
   * and keeping half of that pairing across a quiet period would attribute a result to a
   * dispatch whose moment was thrown away.
   */
  clear(): void {
    this.bySession.clear()
    this.pending.clear()
  }

  /** How many conversations are being held. The number that used to only ever go up. */
  get size(): number {
    return this.bySession.size
  }
}
