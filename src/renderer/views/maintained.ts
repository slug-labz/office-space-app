/**
 * Employees somebody else maintains, drawn.
 *
 * VISION.md's fourth section: a colleague keeps their review agent in their own repo, it becomes
 * an employee under the manager, and **they go on controlling and editing it there**. The
 * panel's job is the second half of that. Bringing the file over is a copy; keeping the claim
 * true is the feature, and the claim is a real person's name over a file they wrote.
 *
 * ## The button is missing on purpose, and the reason is written where it went
 *
 * Four states, and only one of them is a button. *They changed theirs* is an update and it is
 * safe. *Both changed* is not a button at all — taking theirs would throw away whatever was tuned
 * here, and a control that quietly resolves that is the thing `shared/hired-from.ts` exists to
 * prevent. So the row says what happened on both sides and what taking theirs would cost, and
 * leaves the decision with the person who has to live with it.
 *
 * An empty space where a control might be is a bad surface. A sentence in that space, saying why
 * there is no button, is a good one.
 *
 * ## Not checked is the resting state, and it says so
 *
 * Checking clones repositories. Doing it on every open would make this a panel nobody leaves
 * open, so rows start at *not checked* — which is a real answer and not a stale one. It is never
 * drawn as agreement.
 */

import {
  saidPlainly,
  updateIsSafe,
  updateWouldOverwriteLocalWork,
  type Standing,
} from '../../shared/hired-from.js'
import type { MaintainedRow, OfferedFromSource, OfferedRow, SourceKind } from '../../shared/ipc.js'
import { line } from './work.js'

/** Where a source is, said the way somebody would say it out loud. */
function whereFrom(row: MaintainedRow): string {
  const kind = row.source.kind === 'git' ? 'kept at' : 'kept in'
  return `${kind} ${row.source.at} · ${row.source.file} · hired ${row.hiredAt}`
}

export function renderMaintained(
  host: HTMLElement,
  rows: readonly MaintainedRow[],
  onTake: (id: string) => void,
): void {
  host.replaceChildren()

  /*
   * A heading, because both lists in this panel hold cards with the same shape and the same
   * names in them.
   *
   * Seen in the running app: after hiring `wren-review`, the panel showed `wren-review` twice —
   * once as somebody the source is offering and once as somebody who works here — with nothing
   * between them saying which was which. Two identical names, two different meanings, no label.
   */
  if (rows.length > 0) host.appendChild(line('maintained__group', 'Working here, kept elsewhere'))

  if (rows.length === 0) {
    host.appendChild(
      line(
        'maintained__empty',
        'Nobody here is maintained elsewhere. Everyone in this office was written in it. Point ' +
          'the box above at a repository of agents to hire somebody a colleague keeps up to date.',
      ),
    )
    return
  }

  for (const row of rows) {
    const el = document.createElement('article')
    el.className = 'maintained'

    const name = document.createElement('h4')
    name.className = 'maintained__name'
    name.textContent = row.id
    el.appendChild(name)

    el.appendChild(line('maintained__where', whereFrom(row)))
    el.appendChild(line(`maintained__standing ${toneOf(row.standing)}`, saidPlainly(row.standing)))

    // The git or errno text, kept verbatim. "Could not be reached" and "Permission denied
    // (publickey)" send a person to two different places, and only one of them is written here.
    if (row.detail !== null) el.appendChild(line('maintained__detail mono', row.detail))

    if (updateIsSafe(row.standing)) {
      const take = document.createElement('button')
      take.type = 'button'
      take.className = 'btn maintained__take'
      take.textContent = 'Take their version'
      take.addEventListener('click', () => onTake(row.id))
      el.appendChild(take)
    } else if (updateWouldOverwriteLocalWork(row.standing)) {
      // The one case with no button. Say what would have to happen first, so the absence reads as
      // a decision somebody made rather than a control that failed to draw.
      el.appendChild(
        line(
          'maintained__blocked',
          `There is no one-click update for this. Compare .claude/agents/${row.id}.md against ` +
            `${row.source.file} at the source, and either fold their change into ours or put ours ` +
            'back to theirs first.',
        ),
      )
    }

    host.appendChild(el)
  }
}

/** A class for the sentence, so *they changed theirs* and *could not be reached* do not look alike. */
function toneOf(standing: Standing): string {
  if (standing.here === 'missing') return 'maintained__standing--gone'
  if (standing.there === 'moved-on') return 'maintained__standing--behind'
  if (standing.there === 'withdrawn') return 'maintained__standing--gone'
  if (standing.there === 'unreachable' || standing.there === 'unchecked') return 'maintained__standing--unknown'
  return standing.here === 'edited' ? 'maintained__standing--ours' : 'maintained__standing--level'
}

/**
 * What a source is offering.
 *
 * `taken` is decided in main, against the roster, and shown *before* the click. Letting somebody
 * pick a name and then refusing them is a worse version of the same information.
 */
export function renderOffered(
  host: HTMLElement,
  result: OfferedFromSource | null,
  onHire: (id: string) => void,
): void {
  host.replaceChildren()
  if (result === null) return

  host.appendChild(line('maintained__group', 'What that source is offering'))

  if ('problem' in result) {
    // A source that would not open is a problem, not a source with nobody in it. The fourth
    // standing order, in the one place a person is most likely to read "no agents here" as "this
    // repo has no agents".
    host.appendChild(line('maintained__problem', `That source could not be read — ${result.problem}`))
    return
  }

  if (result.offered.length === 0) {
    host.appendChild(
      line(
        'maintained__empty',
        'That source opened, and there are no agent files in it. Agents are markdown with ' +
          'frontmatter, in .claude/agents/, agents/, or the top level.',
      ),
    )
    return
  }

  for (const offer of result.offered) host.appendChild(offerRow(offer, onHire))
}

function offerRow(offer: OfferedRow, onHire: (id: string) => void): HTMLElement {
  const el = document.createElement('article')
  el.className = 'maintained maintained--offer'

  const name = document.createElement('h4')
  name.className = 'maintained__name'
  name.textContent = offer.id
  el.appendChild(name)

  el.appendChild(line('maintained__where', offer.file))
  if (offer.description) el.appendChild(line('maintained__desc', offer.description))

  if (offer.taken) {
    el.appendChild(
      line('maintained__blocked', `This office already has somebody called ${offer.id}. Rename one of them first.`),
    )
  } else {
    const hire = document.createElement('button')
    hire.type = 'button'
    hire.className = 'btn maintained__hire'
    hire.textContent = `Hire ${offer.id}`
    hire.addEventListener('click', () => onHire(offer.id))
    el.appendChild(hire)
  }

  return el
}

/**
 * A refusal about what was typed, rather than about what was read.
 *
 * `renderOffered` frames every problem as *"That source could not be read — …"*, which is right
 * for a git error and wrong for an empty box: there is no source, so nothing failed to be read.
 * Seen in the running app after the empty-field case stopped being silent — the sentence arrived
 * with a preamble that contradicted it.
 */
export function renderRefusal(host: HTMLElement, text: string): void {
  host.replaceChildren()
  host.appendChild(line('maintained__problem', text))
}

/** The kind a `<select>` value means. Anything unexpected is a repository, which is the common case. */
export function kindFrom(value: string): SourceKind {
  return value === 'directory' ? 'directory' : 'git'
}
