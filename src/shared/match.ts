/**
 * "Does this match what I typed" — one answer, in one place.
 *
 * Subsequence matching: typing `phv` finds "Privacy", `pmt` finds "payment page". That is what
 * makes a search box worth having rather than a prefix filter — you type the shape of the thing,
 * not its opening letters.
 *
 * Lifted out of `actions.ts` when the switcher needed it too. Two lists a person searches, in one
 * app, with two ideas of what counts as a match is the shape this repository keeps finding: the
 * palette would find `pmt` and the switcher would not, and nobody would be able to say why.
 */

/**
 * Where the match starts, or `null` for no match.
 *
 * The position is the useful part rather than a boolean: an exact prefix beats a scattered
 * subsequence, and a caller sorting by this gets that ordering for nothing.
 */
export function subsequenceStart(hay: string, needle: string): number | null {
  let start: number | null = null
  let at = 0

  for (const char of needle) {
    const found = hay.indexOf(char, at)
    if (found === -1) return null
    if (start === null) start = found
    at = found + 1
  }

  return start
}

/**
 * The best match across several strings, or `null` if none of them match.
 *
 * Several because the thing being searched usually has more than one name — a project has a
 * label and a directory id, and somebody who knows it from the filesystem types the hyphen.
 */
export function matchIn(haystacks: readonly string[], needle: string): number | null {
  const wanted = needle.trim().toLowerCase()
  if (wanted === '') return 0

  let best: number | null = null
  for (const hay of haystacks) {
    const at = subsequenceStart(hay.toLowerCase(), wanted)
    if (at !== null && (best === null || at < best)) best = at
  }
  return best
}
