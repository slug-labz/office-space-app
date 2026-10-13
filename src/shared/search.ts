/**
 * Finding something in a workspace, and saying what was not looked at.
 *
 * An office accumulates: conversations, memory, project plans, a dispatch ledger. On this machine
 * that is 553 transcript files and 157 project documents. Until now the only thing in this app
 * that searched anything was the Spotify controller.
 *
 * ## The whole difficulty is the silence, not the matching
 *
 * Substring matching is arithmetic. What is hard is that a search reads several sources, any of
 * which can fail independently — a memory directory at mode 000, a transcript whose JSON is torn,
 * a project file deleted between the listing and the read. And **"no results" and "no results in
 * the half I could read" are the same sentence** unless something forces them apart.
 *
 * That is the fourth standing order pointed at the one surface where a person acts on absence:
 * somebody searches for a decision they half-remember, sees nothing, and concludes it was never
 * written down. So `Searched` carries `blind` beside `hits`, and `summarise` refuses to say
 * "nothing here matches" when part of the workspace could not be opened.
 *
 * ## Why substring and not something cleverer
 *
 * Fuzzy matching invents results. A person searching their own workspace for `retry` and being
 * shown `registry` has been told something false about their own notes, and the cost is higher
 * here than a missed match: they can widen a search, but they cannot un-see a result that sent
 * them down the wrong path. Case-insensitive substring is what the query says and nothing more.
 */

/** Where a hit came from. Named rather than pathed, because the question is "which part of my work". */
export type Source = 'memory' | 'project' | 'conversation' | 'dispatch'

/**
 * Where a hit can be opened, or `null` when there is nowhere in this app to go.
 *
 * Separate from `where`, which is a **label** — `greeter/PLAN.md`, a conversation's title, a
 * dispatch's employee and date. A label is what a person reads; it is not an address, and the two
 * diverge exactly where it matters: two conversations can carry the same title, and a project's
 * display path is not its id.
 *
 * `null` is a real answer and the reason this is a union rather than an optional. A dispatch is a
 * row in a ledger — there is no dispatch viewer to open, and the honest thing is to say so in the
 * type so the view cannot draw a control that would refuse.
 */
export type Destination =
  | { readonly kind: 'project'; readonly id: string }
  /*
   * The project as well as the session.
   *
   * `openSession(project, id)` in the main process does `current.set(project, id)` — it *binds*
   * the conversation to whichever project it is told. Opening a hit from another project while
   * looking at this one would rebind a live session to the wrong project, and for a conversation
   * that is not live would build a new one under the wrong project entirely. The address has to
   * carry both, so the renderer can switch first and open second.
   */
  | { readonly kind: 'conversation'; readonly sessionId: string; readonly project: string }
  | { readonly kind: 'memory'; readonly id: string }
  | null

export interface Hit {
  readonly source: Source
  /** Where a person should look — a file path, a project name, a conversation title. */
  readonly where: string
  /** Where clicking it goes, or `null` when this app has nowhere to open. */
  readonly goto: Destination
  /** 1-based, or `null` for a source with no lines (a ledger row, say). */
  readonly line: number | null
  /** The matching line, trimmed, cut around the match rather than at the start. */
  readonly text: string
  /** Offsets of the match within `text`, so a renderer marks it without searching again. */
  readonly at: { readonly start: number; readonly end: number }
}

/**
 * A source that could not be read in full, and why in words a person can act on.
 *
 * `extent` is the distinction the first version of this missed, and it produced a sentence that
 * contradicted its own parenthetical on the machine it was written on:
 *
 *     This did not search conversation (only the 60 most recent of 553 were read).
 *     1 match for "backoff", in 1 place.
 *
 * Sixty conversations were read and a match was found in one of them, above a line asserting that
 * conversations were not searched. The module already keeps `missing` apart from `unreadable`;
 * this keeps *none* apart from *some*, which is the same distinction one level up.
 */
export interface Blind {
  readonly source: Source
  /** `none` — nothing of this source was read. `some` — it was read, but not all of it. */
  readonly extent: 'none' | 'some'
  readonly why: string
}

export interface Searched {
  readonly hits: readonly Hit[]
  /** Sources actually read. A source that holds nothing is `looked`, not `blind`. */
  readonly looked: readonly Source[]
  readonly blind: readonly Blind[]
}

/** Every source, in the order a person meets them in the panel. */
export const SOURCES: readonly Source[] = ['memory', 'project', 'conversation', 'dispatch']

/**
 * The answer when the search itself failed and **nothing was read**.
 *
 * One entry per source, not one for `memory`. The first version hardcoded `memory`, so a total
 * failure told the reader that memory was the gap *and*, by omission, that projects, dispatches
 * and conversations had been read and held no match — under-reporting blindness for three of four
 * sources at the exact moment blindness was total. `whatWasNotSearched` collapses these into one
 * sentence, so the honest shape costs the view nothing.
 */
export function nothingWasSearched(why: string): Searched {
  return { hits: [], looked: [], blind: SOURCES.map((source) => ({ source, extent: 'none', why })) }
}

/** How much of a long line to keep either side of the match. */
const AROUND = 90

/**
 * Every match of `query` in `body`, as hits.
 *
 * One hit per line at most: a line containing the query three times is one place to look, and
 * three rows would push other files off the screen without saying anything new.
 */
export function matchesIn(
  body: string,
  query: string,
  source: Source,
  where: string,
  goto: Destination = null,
): readonly Hit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []

  const hits: Hit[] = []
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const found = line.toLowerCase().indexOf(needle)
    if (found === -1) continue

    /*
     * Cut around the match, not from the start of the line.
     *
     * A minified line or a long paragraph would otherwise show its first 200 characters and hide
     * the thing being searched for — a result proving a match exists while refusing to say where.
     */
    const from = Math.max(0, found - AROUND)
    const to = Math.min(line.length, found + needle.length + AROUND)
    const window = line.slice(from, to)
    const lead = window.length - window.trimStart().length
    const prefix = from > 0 ? '…' : ''
    const text = prefix + window.trim() + (to < line.length ? '…' : '')

    // Where the match sits in `text` after cutting and trimming, so a renderer can mark it.
    const start = prefix.length + (found - from - lead)
    hits.push({ source, where, goto, line: i + 1, text, at: { start, end: start + needle.length } })
  }
  return hits
}

/**
 * What this search did not look at, or `null`.
 *
 * Never omitted when it applies. A person who searches for a decision they half-remember, sees
 * nothing, and is not told that memory could not be opened will conclude it was never written
 * down — and that conclusion is the reason this field exists.
 */
export function whatWasNotSearched(searched: Searched): string | null {
  if (searched.blind.length === 0) return null

  /*
   * Grouped by source, because one source can fail in several ways at once — a workspace with 553
   * conversations and one torn transcript produces two entries for `conversation`, and listing
   * them separately gave *"did not search conversation … or conversation …"*.
   *
   * A source with any `none` entry is wholly unsearched; a source whose failures are all partial
   * was searched incompletely. Nothing merges across that line, because the two sentences mean
   * opposite things about the results underneath them.
   */
  const bySource = new Map<Source, { none: string[]; some: string[] }>()
  for (const b of searched.blind) {
    const at = bySource.get(b.source) ?? { none: [], some: [] }
    at[b.extent].push(b.why)
    bySource.set(b.source, at)
  }

  const whole: string[] = []
  const partial: string[] = []
  for (const [source, { none, some }] of bySource) {
    if (none.length > 0) whole.push(`${source} (${none.join('; ')})`)
    else partial.push(`${source} (${some.join('; ')})`)
  }

  const sentences: string[] = []
  if (whole.length > 0) sentences.push(`This did not search ${list(whole)}.`)
  if (partial.length > 0) sentences.push(`This searched only part of ${list(partial)}.`)
  return sentences.join(' ')
}

/** `a`, `a or b`, `a, b or c`. */
function list(items: readonly string[]): string {
  if (items.length === 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/**
 * The line above the results.
 *
 * Three states kept apart, and only one of them means "there is nothing here":
 *
 * - matches found — how many, and across how many places;
 * - nothing found and everything was read — a real answer;
 * - nothing found and something could not be read — **not** an answer, and it must not read like
 *   one. This is the case the whole module exists for.
 */
export function summarise(searched: Searched, query: string): string {
  const q = query.trim()
  if (q === '') return 'Type something to search for.'

  const places = new Set(searched.hits.map((h) => `${h.source}:${h.where}`)).size
  if (searched.hits.length > 0) {
    const n = searched.hits.length === 1 ? '1 match' : `${searched.hits.length} matches`
    const p = places === 1 ? '1 place' : `${places} places`
    return `${n} for "${q}", in ${p}.`
  }

  if (searched.blind.length > 0) {
    // Deliberately not "nothing matches". The office does not know that — and this holds for a
    // partial read as much as a total one, which is why it keys off `blind` at all rather than
    // off `extent`. Sixty conversations read out of 553 and no match is not an answer about 553.
    return `Nothing found for "${q}" in the part of this workspace that could be read.`
  }
  return `Nothing in this workspace matches "${q}".`
}

/** Hits grouped by the place they are in, in the order the places were first seen. */
export function byPlace(
  hits: readonly Hit[],
): readonly { readonly source: Source; readonly where: string; readonly hits: readonly Hit[] }[] {
  const groups = new Map<string, { source: Source; where: string; hits: Hit[] }>()
  for (const hit of hits) {
    const key = `${hit.source} ${hit.where}`
    const existing = groups.get(key)
    if (existing) existing.hits.push(hit)
    else groups.set(key, { source: hit.source, where: hit.where, hits: [hit] })
  }
  return [...groups.values()]
}
