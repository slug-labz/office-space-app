/**
 * What the office remembers, drawn.
 *
 * The vision's fifth section asks for a memory keeper you can *"just ask — what's going on, how
 * is progress, what do we know"*. The agent has existed since the workspace shipped; nothing ever
 * read what it writes, so there was no answer to look at and no way to tell an office that has
 * recorded nothing from one whose notes will not open.
 *
 * ## Grouped by kind, and the ungrouped group is the honest one
 *
 * The keeper's prompt names five kinds — decision, fact, person, project, reference. A file whose
 * `type:` is missing or is something else is **`unlabelled`**, and it gets a group of its own
 * rather than being dropped into one of the five. Guessing a kind would be this panel inventing
 * the one thing the file did not say.
 *
 * A file with no frontmatter at all is a further step down: it is somebody's note rather than a
 * record, and it says so on the card. `parseMemory` falls back to the filename for its title,
 * because the filename is a real name somebody chose and "Untitled" is not.
 *
 * ## And every silence is labelled
 *
 * *"If nothing was recorded about something, say nothing recorded — do not infer, and do not fill
 * the gap with something plausible. A confident guess from the memory keeper is the most damaging
 * thing you can produce, because people believe you."* That is the keeper's instruction, and it
 * binds this surface exactly as hard: nothing recorded, could not be read, and could not look are
 * three different sentences here.
 */

import { memoryLede, type Memory, type MemoryKind, type MemoryReport } from '../../shared/memory.js'
import { renderMarkdown } from '../markdown.js'
import { line } from './work.js'

/** The order the groups appear in, and the words above them. */
const GROUPS: readonly { kind: MemoryKind; heading: string }[] = [
  { kind: 'decision', heading: 'Decisions' },
  { kind: 'fact', heading: 'Facts' },
  { kind: 'project', heading: 'Projects' },
  { kind: 'person', heading: 'People' },
  { kind: 'reference', heading: 'References' },
  // Last, and named for what it is. "Other" would suggest a category somebody chose; these are
  // the files that did not say.
  { kind: 'unlabelled', heading: 'Recorded without a type' },
]

/**
 * @param focus  A memory to mark and scroll to, when the panel was opened *at* one — a search
 *   result, rather than the menu. `undefined` is the ordinary open and marks nothing.
 *
 *   The panel holds one memory on this machine today, which is why nothing needed this before:
 *   opening it landed on the thing by accident. That stops being true at forty, and "correct
 *   until the list grows" is how a control that says *open* ends up landing somewhere adjacent.
 */
export function renderMemory(host: HTMLElement, report: MemoryReport, focus?: string): void {
  host.replaceChildren()
  host.appendChild(line('memory__lede', memoryLede(report)))

  // A directory that would not open. Nothing below it would be about the workspace, so nothing
  // below it is drawn — a list under this sentence would read as "and here is what is in it".
  if (report.problem !== null) {
    /*
     * The press still gets an answer, and it is **not** the one below.
     *
     * Somebody who opened one specific memory from a search result and lands on "memory could not
     * be read" has been told about the directory and nothing about what they clicked. Saying
     * *"that one is not here"* would be worse than silence: the office did not look, so it does
     * not know whether it is there. Could-not-check and is-not-there, kept apart at the point
     * where a person would otherwise assume the second.
     */
    if (focus !== undefined) {
      host.appendChild(
        line(
          'memory__lede memory__lede--problem',
          `Whether ${focus} is still here could not be checked, because memory/ would not open.`,
        ),
      )
    }
    return
  }

  /*
   * Somebody came here from a search result, and the memory they came for is not here.
   *
   * Said, and said **above** the list. The panel would otherwise open on a list that quietly does
   * not contain the thing they clicked — the click reporting success while landing nowhere, which
   * is the failure the row's "open" label exists to promise against. A conversation that has gone
   * already says so in its own pane; this is the same sentence for the other arm.
   *
   * Deliberately after the unreadable-directory return above: *"memory could not be opened"* is a
   * better answer than *"that one is not here"*, and a reader who gets both learns nothing from
   * the second.
   */
  if (focus !== undefined && !report.memories.some((m) => m.id === focus)) {
    host.appendChild(
      line(
        'memory__lede memory__lede--problem',
        `The memory you opened — ${focus} — is not here now. It may have been removed since the search ran.`,
      ),
    )
  }

  for (const group of GROUPS) {
    const mine = report.memories.filter((m) => m.kind === group.kind)
    if (mine.length === 0) continue
    host.appendChild(line('memory__group', group.heading))
    for (const memory of mine) {
      const drawn = card(memory)
      if (memory.id === focus) {
        drawn.classList.add('memory__card--found')
        /*
         * `scrollIntoView` guarded rather than called. This view renders under `test/dom.ts` as
         * well as in Electron, and the stub has no layout to scroll — a missing method would
         * throw *inside the render* and leave the panel half-drawn, which is worse than not
         * scrolling.
         */
        drawn.scrollIntoView?.({ block: 'center' })
      }
      host.appendChild(drawn)
    }
  }

  if (report.memories.length === 0 && report.unread.length === 0) {
    host.appendChild(
      line(
        'memory__empty',
        'Nothing has been written down yet. Ask the memory-keeper to record something worth ' +
          'keeping — a decision and its reason, or a constraint you found the hard way.',
      ),
    )
  }

  // Named one by one rather than counted. A file that could not be read may be the record of the
  // very thing somebody is looking for, and a count cannot be searched for later.
  for (const gap of report.unread) {
    host.appendChild(
      line(
        'memory__unread',
        `memory/${gap.id}.md could not be read, so whatever it remembers is not here — ${gap.cause}`,
      ),
    )
  }
}

function card(memory: Memory): HTMLElement {
  const el = document.createElement('article')
  el.className = memory.unstructured ? 'memcard memcard--note' : 'memcard'

  const title = document.createElement('h4')
  title.className = 'memcard__title'
  title.textContent = memory.title
  el.appendChild(title)

  el.appendChild(line('memcard__meta', metaOf(memory)))

  if (memory.body !== '') {
    const body = document.createElement('div')
    body.className = 'memcard__body'
    /**
     * Markdown, because the keeper's own format is markdown.
     *
     * Its prompt ends every record with `**Why it matters:** <one line>`, so plain text puts a
     * pair of literal asterisks on essentially every card — seen in the running app on the first
     * one it drew.
     *
     * `renderMarkdown` is the transcript's, which is the right one rather than a convenient one:
     * it is built for text this app did not write and escapes accordingly, and `memory/` is
     * written by an agent.
     */
    body.appendChild(renderMarkdown(memory.body))
    el.appendChild(body)
  } else {
    // A record with a title and nothing under it is a file somebody started. Saying so is more
    // use than an empty card, which reads as a rendering fault.
    el.appendChild(line('memcard__body memcard__body--empty', 'Nothing written under this title yet.'))
  }

  return el
}

/**
 * The second line: where it came from and when.
 *
 * The id as well as the dates, because it is the filename and the filename is how somebody edits
 * or deletes it — a panel that shows a title with no path leaves them grepping for it.
 */
function metaOf(memory: Memory): string {
  const parts = [`memory/${memory.id}.md`]

  if (memory.unstructured) {
    parts.push('a note, not a record — no frontmatter')
  } else if (memory.created === null && memory.updated === null) {
    // Said, not blank. The keeper is told to use absolute dates, so no date is a rule not
    // followed rather than a field that happens to be empty.
    parts.push('no date recorded')
  } else if (memory.updated !== null && memory.updated !== memory.created) {
    parts.push(`recorded ${memory.created ?? 'undated'} · revised ${memory.updated}`)
  } else {
    parts.push(`recorded ${memory.updated ?? memory.created}`)
  }

  return parts.join(' · ')
}
