/**
 * Telling somebody a tool call is waiting, when they are not looking at the office.
 *
 * ## The measurement this exists for
 *
 * `docs/the-queue.md` decision #2 asked whether a pending approval should make itself noticed
 * outside the app window, and it stayed a design question for weeks because nothing had ever
 * driven it. Then the whole loop was walked on a fresh install: the manager dispatched `builder`,
 * `builder` stopped on a gated command, and the floor read *"1 call needs you · 1 mid-task"* —
 * **for 350 seconds**, until somebody happened to look. The office was working perfectly and
 * saying so to an empty chair.
 *
 * Decision #1 fixed the case where the office *goes away* mid-wait. Nothing helps the case where
 * it is open and you are not, which `the-queue.md` itself calls the normal state of this app.
 *
 * ## Why a decision and not three lines in the watcher
 *
 * The watcher fires roughly every 400ms. A notification per tick is not a feature, it is an
 * alarm going off four times a second, and the difference between the two is entirely *which*
 * requests are new. That is bookkeeping over what was announced last time, which is exactly the
 * kind of thing that is wrong in a way nobody notices until it is annoying — so it is here, with
 * a test, rather than inline where only the happy path would ever be exercised.
 */

/** One waiting request, reduced to what a notification can say about it. */
export interface Waiting {
  /** `sessionId.toolUseId` — unique per call, and what "have we mentioned this one" is keyed on. */
  readonly key: string
  readonly tool: string
  /** The employee blocked by it, or `null` for the manager — same meaning as `ApprovalRequest`. */
  readonly agent: string | null
}

export interface Nudge {
  /** What to announce now. Empty when there is nothing new, or when somebody is already looking. */
  readonly announce: { readonly title: string; readonly body: string } | null
  /** The dock badge. `''` clears it. */
  readonly badge: string
  /** What to carry into the next tick. Pruned to what is still waiting, so it cannot grow forever. */
  readonly seen: ReadonlySet<string>
}

/** Who is blocked, in the office's own words. `null` is the manager — never "unknown". */
function whoIsStuck(waiting: readonly Waiting[]): string {
  const names = [...new Set(waiting.map((w) => w.agent ?? 'the manager'))]
  if (names.length === 1) return names[0] ?? 'the manager'
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.length} of the staff`
}

export function nudgeFor(seen: ReadonlySet<string>, waiting: readonly Waiting[], focused: boolean): Nudge {
  // Pruned to what is still on the queue. A key that has been answered is gone, and if the same
  // number ever came round again it would be a different call and worth mentioning again.
  const now = new Set(waiting.map((w) => w.key))

  const fresh = waiting.filter((w) => !seen.has(w.key))

  /*
   * Nothing is announced while the window has focus, and the badge is set either way.
   *
   * They answer different questions. A notification is for somebody who is not looking; firing
   * one at a person who is already reading the card is the office interrupting them to tell them
   * what is on their screen. The badge is not an interruption — it is the dock agreeing with the
   * floor, and it should agree whether or not anybody is watching.
   */
  const announce =
    focused || fresh.length === 0
      ? null
      : {
          title: fresh.length === 1 ? 'A call is waiting' : `${fresh.length} calls are waiting`,
          body:
            fresh.length === 1
              ? `${whoIsStuck(fresh)} stopped on ${fresh[0]?.tool ?? 'a tool call'} and needs an answer.`
              : `${whoIsStuck(fresh)} stopped and need an answer.`,
        }

  return { announce, badge: waiting.length === 0 ? '' : String(waiting.length), seen: now }
}
