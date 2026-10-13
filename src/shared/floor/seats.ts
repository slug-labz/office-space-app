/**
 * Which desk is whose, and why firing somebody must not move four other people.
 *
 * ## The bug this exists to remove
 *
 * Desks were placed by **roster index**: the third name got the third seat. Hiring appends, so
 * that kept the promise the layout was built around — *"the same roster position always resolves
 * to the same tile, so hiring adds a desk and never moves one"*.
 *
 * Firing does not append. Remove the third of seven and every later index shifts by one.
 * Measured on a floor of seven before this module existed: **one person left and four other
 * people's desks moved**, one of them across the room. Laptop 1 found it; I argued at first that
 * a room re-arranging when somebody leaves is honest, and I was wrong for a reason that is the
 * floor's own contract — **one thing happened and the screen showed five.** Four people who had
 * nothing to do with it visibly relocated, which is the floor reporting four events that did not
 * occur.
 *
 * ## Why a map rather than a hash
 *
 * Hashing a name to a seat was the first idea and it does not work. Two names that hash to the
 * same seat need a probe, the probe order depends on who else is present, and removing somebody
 * changes it — so firing would still move people, just less predictably.
 *
 * ## Why it is not persisted
 *
 * Khalid's rule for the roster applies here: the filesystem owns existence and an overlay of
 * ours owns only what the filesystem cannot say. This is an overlay, and it is held **in memory
 * for the life of the window**.
 *
 * That is enough, because of what the promise actually is: *one event must not move four
 * people*. A restart is not that kind of event — nobody is watching the desks at the moment the
 * app starts, so re-deriving the assignment then costs nothing anybody can see. Persisting it
 * would mean a second store to keep in step with the roster, and a stale entry in it is a desk
 * drawn for somebody who is gone. Given the choice between a promise kept while anybody is
 * looking and a store that can lie, this takes the first.
 */

/** Who sits in which slot. A slot is an index into the bench layout, not a tile. */
export type SeatMap = Readonly<Record<string, number>>

/**
 * Work out where everybody sits, given where they sat a moment ago.
 *
 * Pure, and total: an empty `previous` produces exactly the roster-index assignment the layout
 * used before this module, which is what makes a fresh window look the way it always did.
 *
 * Three rules, in this order:
 *
 *   **Anybody still here keeps their slot.** This is the whole point.
 *   **A slot belonging to nobody is free**, and is reclaimed by the next hire rather than held —
 *   otherwise a busy office slowly fills with gaps for people who left months ago.
 *   **A new hire takes the lowest free slot**, so the room fills from the front and a small
 *   company does not end up spread across three benches with holes in them.
 */
export function assignSeats(previous: SeatMap, employees: readonly string[]): SeatMap {
  const roster = new Set(employees)
  const next: Record<string, number> = {}
  const taken = new Set<number>()

  // Pass one: everybody who was already sitting somewhere stays there. Entries for names no
  // longer on the roster are simply not copied — that is the reclaim, and it needs no sweep.
  for (const who of employees) {
    const slot = previous[who]
    if (slot !== undefined && !taken.has(slot)) {
      next[who] = slot
      taken.add(slot)
    }
  }

  // Pass two: everybody else, into the lowest free slot. Two passes rather than one, because a
  // new hire must not be given a slot that somebody further down the list is still holding.
  //
  // **Sorted, and that is laptop 1's finding rather than tidiness.** Assigning in the order the
  // roster arrived made this correct only because `workspace.ts` happens to `files.sort()`
  // before reading agents — an incidental detail of discovery, in another process, that nothing
  // here declares a dependency on. If that sort ever went away, two people hired between one
  // launch and the next would swap desks depending on directory order, and the failure would
  // look like the floor shuffling for no reason.
  //
  // Sorting here costs nothing and makes the guarantee this module's own, so it holds whatever
  // order it is handed.
  let cursor = 0
  for (const who of [...employees].filter((w) => next[w] === undefined).sort()) {
    while (taken.has(cursor)) cursor++
    next[who] = cursor
    taken.add(cursor)
  }

  // `roster` is read here rather than above so the intent is checkable: nothing outside the
  // current roster survives into the result, whatever was in `previous`.
  for (const who of Object.keys(next)) {
    if (!roster.has(who)) delete next[who]
  }

  return next
}
