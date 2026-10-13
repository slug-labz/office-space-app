/**
 * One format for one number.
 *
 * `AsideResult.costUsd` carries the rule this module exists to keep: *"cost belongs to one
 * surface, and a second display here would put two formats for one number on screen, written by
 * two people."* The rule was right and it was enforced by there being only one display. Adding
 * a second — the per-conversation figure in the switcher — means the rule now needs a function
 * rather than an absence.
 *
 * So the header and the session list call the same one. Four decimal places because a question
 * to Claude costs fractions of a cent and `$0.00` for every conversation would be a column of
 * noughts pretending to be data.
 */

/** A cost, formatted. The only place this string is built. */
export function money(usd: number): string {
  return `$${usd.toFixed(4)}`
}

/**
 * What the session list says when there is no figure.
 *
 * **Not `$0.0000`.** `SessionInfo.costUsd` is `null` when the registry has no cost for that
 * conversation — one restored from before costs were written down, or one Claude never
 * reported a result for. None of those is a conversation that cost nothing, and a row of
 * noughts would be the office inventing a number it does not have.
 *
 * Words rather than a dash. A `—` in a list of prices is read as zero about as often as it is
 * read as unknown, and this is the distinction the whole entry exists to draw.
 */
export const UNRECORDED = 'no cost recorded'

/** A per-conversation cost as a person reads it, including when there is not one. */
export function costLabel(usd: number | null): string {
  return usd === null ? UNRECORDED : money(usd)
}
