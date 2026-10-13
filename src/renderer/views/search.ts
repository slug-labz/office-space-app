/**
 * Drawing what a search found, and what it could not look at.
 *
 * `shared/search.ts` decides all of it. This puts it on screen, and the one rule it adds is the
 * ordering: **what was not searched goes above the results, not below them.**
 *
 * A reader who meets "no matches" first has already concluded the thing was never written down by
 * the time they reach a caveat underneath. That is the same mistake the changed panel made with
 * "put back on <date>", found by opening it and reading it in the order a person does.
 */

import { byPlace, summarise, whatWasNotSearched, type Hit, type Searched, type Source } from '../../shared/search.js'

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** What each source is called on screen. The panel says "memory", not "MemoryReport". */
const CALLED: Record<Source, string> = {
  memory: 'memory',
  project: 'project',
  conversation: 'conversation',
  dispatch: 'dispatch',
}

export interface SearchHost {
  /** Somebody chose a result. The caller decides what opening it means. */
  readonly onOpen: (hit: Hit) => void
}

/**
 * The matching text, with the match itself marked.
 *
 * `textContent` on both halves, never `innerHTML`. This renders text out of a person's own
 * transcripts and project files — the one string in this app most likely to contain markup that
 * something wanted rendered.
 */
function line(hit: Hit): HTMLElement {
  const p = el('p', 'find__text')
  const before = hit.text.slice(0, hit.at.start)
  const match = hit.text.slice(hit.at.start, hit.at.end)
  const after = hit.text.slice(hit.at.end)

  if (before) p.appendChild(document.createTextNode(before))
  const mark = el('mark', 'find__hit')
  mark.textContent = match
  p.appendChild(mark)
  if (after) p.appendChild(document.createTextNode(after))
  return p
}

export function renderSearch(
  into: HTMLElement,
  found: Searched | null,
  query: string,
  host: SearchHost,
): void {
  into.textContent = ''

  if (found === null) {
    /*
     * Nothing has been asked yet. Deliberately not "no results" — the office has not looked, and
     * an empty box that says "nothing found" is answering a question nobody put.
     */
    // Named, because this list is what a person measures a later "nothing found" against — and
    // "conversations" alone was true of the manager's side of them and of nothing else.
    into.appendChild(
      el('p', 'roster__desc', "Search this workspace — memory, projects, dispatches, and conversations down to each employee's own record."),
    )
    return
  }

  /*
   * The blind spots first.
   *
   * Above the count, because it changes what the count means. "Nothing found" read before
   * "memory could not be opened" has already done its damage.
   */
  const missed = whatWasNotSearched(found)
  if (missed !== null) into.appendChild(el('p', 'roster__desc roster__desc--problem', missed))

  into.appendChild(el('p', 'find__summary', summarise(found, query)))

  for (const group of byPlace(found.hits)) {
    const card = el('div', 'roster__row')

    const top = el('div', 'roster__top')
    top.appendChild(el('span', 'find__source', CALLED[group.source]))
    top.appendChild(el('span', 'roster__name', group.where))
    top.appendChild(
      el('span', 'roster__meta', group.hits.length === 1 ? '1 match' : `${group.hits.length} matches`),
    )
    card.appendChild(top)

    for (const hit of group.hits) {
      const row = document.createElement('button')
      row.className = 'find__row'
      row.type = 'button'
      // A line number is where to look; a dispatch has none, and inventing one would be a lie
      // about a record that has no lines.
      if (hit.line !== null) row.appendChild(el('span', 'find__line mono', String(hit.line)))
      row.appendChild(line(hit))

      /*
       * What the row will actually do, said on the row.
       *
       * Both rows do something, so neither is the "control that could only refuse" this panel was
       * careful to avoid. But they do *different* things, and a row that opens a conversation and
       * a row that copies a ledger reference are not interchangeable — somebody who clicks
       * expecting to arrive somewhere and instead gets a clipboard notification has been told the
       * office lost their dispatch.
       *
       * Derived from `goto` rather than from `source`, so a source that gains a destination later
       * cannot end up labelled "copy" while behaving like "open".
       */
      row.appendChild(el('span', 'find__does', hit.goto === null ? 'copy' : 'open'))
      row.addEventListener('click', () => host.onOpen(hit))
      card.appendChild(row)
    }

    into.appendChild(card)
  }
}
