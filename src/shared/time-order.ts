/**
 * Ordering by time, when the times are text somebody else wrote.
 *
 * Every sort in this app over an ISO timestamp held as a string goes through this module:
 *
 *     oldest first  held tool calls, as main reads them (`pending`) and as the strip shows them
 *                   (`inAnswerOrder`)
 *     newest first  a project's conversations (`sessionsFor`), and through it the one resumed with
 *                   an employee (`conversationWith`); the rows under "What the office changed"
 *                   (`newestSentFirst`); and the conversations a search reads (`searchWorkspace`)
 *
 * Each compared the strings with `localeCompare`, which orders text, not time. For the timestamps
 * this app writes, the two orders agree — and the moment a value is not one of those timestamps,
 * they stop agreeing in the direction that hides it:
 *
 *     ''            sorts before every date, so a call with no readable time ranked as the oldest
 *     'not a date'  sorts after every date, so newest-first put it at the head of the list
 *
 * `pending`'s was worse: nothing checked that `askedAt` was text, so a request without one threw.
 *
 * The registry and the ledger read a missing time as `''` (`parseRegistry`, `parseLedger`), `pending`
 * reads a time that is missing or not text the same way, and a hand-edited file can hold anything.
 * The approval hook always writes `toISOString()`, so for `askedAt` this is a guard rather than a
 * repair. Either way, text that will not parse goes after every time that will, whichever way the
 * list runs: a time nobody can read is not the oldest thing on screen, and it is not the newest
 * either.
 *
 * Three comparisons that are not sorts still read these times as text: `resumable` and
 * `mergeNewest` in `registry.ts`, and `pathsChangedAfter` in `undo.ts`.
 *
 * Ties — one instant spelled two ways, or two unreadable values — compare as `0`.
 * `Array.prototype.sort` is stable, so a tie keeps the order the caller handed over, and what that
 * order means is the caller's to say.
 */

/**
 * The ISO shape this app writes, with an explicit zone. Nothing looser.
 *
 * `Date.parse` alone is not a reader for this. Measured on Node 22: `'1'`, `'Sep 16'` and
 * `'garbled 3'` parse as days in 2001 and `'32'` as 2032, so each would take a real time's place in
 * the order; a time with no zone parses as the machine's local time, so the order would depend on
 * where the app runs; and `'2026-02-30T00:00:00Z'` rolls over to 2 March. Everything this app writes
 * comes from `toISOString()` and has this shape.
 */
const ISO = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/

/**
 * Milliseconds since the epoch, or `null` for text that is not a time in that shape.
 *
 * Exported for the approval card's clock, `timeLeft`, which counts down from `askedAt` and so
 * needs the instant itself rather than an order.
 */
export function instantOf(text: string): number | null {
  const m = ISO.exec(text)
  if (m === null) return null
  const ms = Date.parse(text)
  if (Number.isNaN(ms)) return null
  // Read it back at its own offset: a value the parser rolled over does not come back as written.
  const offset = m[7] === undefined ? 0 : (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]))
  const at = new Date(ms + offset * 60_000)
  const asWritten =
    at.getUTCFullYear() === Number(m[1]) &&
    at.getUTCMonth() + 1 === Number(m[2]) &&
    at.getUTCDate() === Number(m[3]) &&
    at.getUTCHours() === Number(m[4]) &&
    at.getUTCMinutes() === Number(m[5]) &&
    (m[6] === undefined || at.getUTCSeconds() === Number(m[6]))
  return asWritten ? ms : null
}

function byInstant(a: string, b: string, latestFirst: boolean): number {
  const x = instantOf(a)
  const y = instantOf(b)
  if (x === null || y === null) {
    if (x === y) return 0
    // Last in either direction, which is why this branch is not flipped for `newestFirst`.
    return x === null ? 1 : -1
  }
  return latestFirst ? y - x : x - y
}

/** For `sort`: the earliest instant first, and text that will not parse after every time. */
export function oldestFirst(a: string, b: string): number {
  return byInstant(a, b, false)
}

/** For `sort`: the latest instant first, and text that will not parse still after every time. */
export function newestFirst(a: string, b: string): number {
  return byInstant(a, b, true)
}
