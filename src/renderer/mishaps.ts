/**
 * Listen for the app going wrong, and say so where the reader already is.
 *
 * The decision — what a fault reads as, and when a repeat is worth repeating — is
 * `src/shared/mishap.ts`, which imports nothing. This file is the two subscriptions and the
 * unsubscribe, and it takes its target as an argument rather than reaching for `window` so that
 * a test can hand it one.
 *
 * ## Both events, because they are different failures
 *
 * `error` is a throw that escaped: a view that broke while drawing, a listener that threw. The
 * frame it was in is gone and usually every frame after it.
 *
 * `unhandledrejection` is a promise nobody caught, which is what an `invoke` becomes when the
 * main process has no handler or its handler threw. Nothing stops; the answer simply never
 * arrives, and the control that asked for it waits forever.
 *
 * Neither has ever been listened for in this renderer. Both are silent by default.
 */

import { MishapLog } from '../shared/mishap.js'

/** The part of `window` this needs. Narrowed so a test can pass an object rather than a browser. */
export interface MishapSource {
  addEventListener(type: string, listener: (event: unknown) => void): void
  removeEventListener(type: string, listener: (event: unknown) => void): void
}

/**
 * Start reporting faults through `say`. Returns the unsubscribe.
 *
 * The reporter is wrapped: a `say` that throws while reporting a throw would be caught by the
 * very listener it was called from, which is an infinite regress that ends in a hung window.
 * There is nowhere honest left to send it at that point, so it is dropped — and that is the one
 * place in this app where dropping is right, because the alternative is not reporting anything
 * ever again.
 */
export function watchForMishaps(
  source: MishapSource,
  say: (sentence: string) => void,
  /**
   * Called once, on the occurrence where a fault stops being an event and becomes a condition.
   *
   * Optional because most of what this module is for is the transcript. A caller that wants the
   * standing half passes it; one that does not still gets every sentence.
   */
  raise?: (sentence: string) => void,
): () => void {
  const log = new MishapLog()

  const report = (reason: unknown): void => {
    let outcome: { say: string | null; standing: string | null }
    try {
      outcome = log.report(reason)
    } catch {
      return
    }
    // Each in its own `try`, so a reporter that throws does not take the other one down with it.
    if (outcome.say !== null) {
      try {
        say(outcome.say)
      } catch {
        // See above.
      }
    }
    if (outcome.standing !== null && raise) {
      try {
        raise(outcome.standing)
      } catch {
        // See above.
      }
    }
  }

  // `reason` on a rejection, `error` on a throw, and the event itself if a browser ever hands us
  // something with neither — a report that said "undefined" would be worse than one that said
  // what it was given.
  const onRejection = (event: unknown): void => report(reasonOf(event, 'reason'))
  const onError = (event: unknown): void => report(reasonOf(event, 'error'))

  source.addEventListener('unhandledrejection', onRejection)
  source.addEventListener('error', onError)

  return () => {
    source.removeEventListener('unhandledrejection', onRejection)
    source.removeEventListener('error', onError)
  }
}

function reasonOf(event: unknown, field: 'reason' | 'error'): unknown {
  if (event && typeof event === 'object' && field in event) {
    const value = (event as Record<string, unknown>)[field]
    if (value !== undefined && value !== null) return value
    // An `ErrorEvent` with no `error` still carries the message the browser built.
    const message = (event as Record<string, unknown>)['message']
    if (typeof message === 'string' && message.length > 0) return message
  }
  return event
}
