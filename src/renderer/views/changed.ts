/**
 * What the office changed, drawn.
 *
 * `shared/changes-view.ts` decides the arrangement; this builds the nodes. Two things it does
 * that are not obvious:
 *
 * **Changed files come before created ones.** A file that already existed and has been altered is
 * what somebody scanning for damage is looking for; a file that did not exist before it ran is
 * additive and can wait. Ordering is the cheapest emphasis there is.
 *
 * **The replacement is shown as itself.** `old_string` → `new_string` are the exact bytes an
 * employee replaced, which is not a diff missing its context — it is a different artefact that
 * says precisely what was intended with nothing reconstructed. Rendering invented context around
 * it would be prettier and would be the office drawing something the stream never gave it.
 *
 * Every node here is built with `createElement` and `textContent`. An employee's file paths and
 * the text it wrote are model output, and this is the surface whose whole job is to show them.
 */

import type { Change } from '../../shared/changes.js'
import type { DispatchRow } from '../../shared/changes-view.js'
import { summarise } from '../../shared/changes-view.js'
import { mayUndo } from '../../shared/undo.js'

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export interface ChangedHost {
  /** Whether a record exists for this dispatch — the difference between "nothing" and "not yet". */
  readonly hasRecord: (row: DispatchRow) => boolean
  /** Put this dispatch's changes back. The caller does the work; this only reports the click. */
  readonly onUndo: (id: string) => void
}

/**
 * Put back, behind a confirmation that lives in the button itself.
 *
 * The same shape as `fireButton` in `roster.ts`, for the same reason: a second click on a button
 * that has changed its own label is a confirmation the keyboard reaches and a screen reader
 * announces, which `window.confirm` in a sandboxed renderer is not.
 *
 * The label names the consequence rather than repeating the verb. "Put back" is the reassuring
 * half of what this does; the other half is that it writes over files as they are now, and that
 * is the half somebody should read before the second click.
 */
function undoButton(row: DispatchRow, on: ChangedHost): HTMLButtonElement {
  // `el` here returns a bare HTMLElement; a button needs its own type for `type` and `disabled`.
  const button = document.createElement('button')
  button.className = 'btn btn--sm btn--danger roster__act'
  button.textContent = 'Put back'
  button.type = 'button'
  let armed = false

  const disarm = () => {
    armed = false
    button.textContent = 'Put back'
    button.classList.remove('roster__act--armed')
  }

  button.addEventListener('click', () => {
    if (!armed) {
      armed = true
      button.textContent = 'Overwrite these files — click again'
      button.classList.add('roster__act--armed')
      return
    }
    disarm()
    on.onUndo(row.id)
  })
  button.addEventListener('blur', disarm)

  return button
}

/**
 * The undo control, or the sentence saying why there isn't one.
 *
 * `mayUndo` is the same function the main process refuses with, so the reason on screen is the
 * reason the office would actually give — rather than a second, drifting copy of the rule written
 * to make the button look right.
 */
function undoControl(row: DispatchRow, on: ChangedHost): HTMLElement | null {
  // Nothing to put back. A row that changed no files gets no control and no explanation, because
  // there is no absence to account for.
  if (row.edited.length === 0 && row.created.length === 0 && row.unclear.length === 0) return null

  // Already put back — and `summarise` has said so at the top of the card, where it changes how
  // the file list beneath it reads. Repeating it here is the same sentence twice on one row.
  if (row.undone !== null) return null

  const no = mayUndo(row.stillOut, row.undone)
  if (no !== null) return el('p', 'roster__desc roster__desc--quiet', no)

  /*
   * Files the tool did not classify cannot be put back — `planUndo` refuses every one of them,
   * because `Write` overwrites as happily as it creates and the office never recorded which this
   * was. A row of nothing else would get a button that can only refuse, which is worse than no
   * button: it reads as an offer, and the refusal only arrives after somebody asks for it.
   */
  if (row.edited.length === 0 && row.created.length === 0) {
    return el(
      'p',
      'roster__desc roster__desc--quiet',
      'The office cannot put these back: it never recorded whether these files existed before.',
    )
  }

  return undoButton(row, on)
}

/**
 * The bytes an employee replaced, and the bytes it replaced them with.
 *
 * Shown as the replacement it is, with nothing around it. The hook route offers a
 * `structuredPatch` carrying context lines, and taking it would mean drawing lines the stream
 * never gave us — prettier, and invented. What is here is exact: this text became that text.
 *
 * Long values are left long and allowed to scroll rather than truncated with an ellipsis. A
 * middle-truncated string reads as the whole of a short one, and the end of a replacement is
 * where the difference usually is.
 */
function replacement(card: HTMLElement, file: Change): void {
  // A creation has nothing it replaced, and rendering an empty "before" would invent a prior
  // state for a file that had none.
  if (file.before !== null && file.before !== '') {
    const was = el('pre', 'roster__was')
    was.textContent = file.before
    card.appendChild(was)
  }
  if (file.after !== null && file.after !== '') {
    const now = el('pre', 'roster__now')
    now.textContent = file.after
    card.appendChild(now)
  }
}

export function renderChanged(into: HTMLElement, rows: readonly DispatchRow[], host: ChangedHost): void {
  into.textContent = ''

  if (rows.length === 0) {
    /*
     * Nobody has been dispatched, which is not the same as nobody having changed anything. The
     * office records what an employee did *and* what the manager did in its own turn, so an
     * empty list here really does mean nothing has been written — but it still cannot see what a
     * shell command did, and that is what the second line is for.
     */
    into.appendChild(el('p', 'roster__empty', 'Nothing has been changed yet.'))
    into.appendChild(
      el(
        'p',
        'roster__desc',
        'This lists what each dispatch changed, and what the manager changed in its own turns. ' +
          'Files written by a shell command are not captured, and a row that ran any says so.',
      ),
    )
    return
  }

  for (const row of rows) {
    const card = el('div', 'roster__row')

    const top = el('div', 'roster__top')
    top.appendChild(el('span', 'roster__name', row.employee))
    top.appendChild(el('span', 'roster__meta', new Date(row.sentAt).toLocaleString()))
    card.appendChild(top)

    card.appendChild(el('p', 'roster__desc', row.brief))
    card.appendChild(el('p', 'roster__desc', summarise(row, host.hasRecord(row))))

    // Altered first, then created, then the ones the tool did not say — see the header.
    for (const [label, files] of [
      ['changed', row.edited],
      ['created', row.created],
      ['written', row.unclear],
    ] as const) {
      for (const file of files) {
        const line = el('div', 'roster__file')
        line.appendChild(el('span', 'roster__kind', label))
        line.appendChild(el('span', 'roster__path', file.path))
        card.appendChild(line)
        replacement(card, file)
      }
    }

    const control = undoControl(row, host)
    if (control !== null) {
      /*
       * In `roster__actions`, not loose in the card.
       *
       * The card is a flex column, so a bare button stretches the full width and reads as a
       * primary action for the panel rather than one row's control — which the tests could not
       * see and the screenshot could. This is the same wrapper the roster's own row actions use,
       * so this button is quiet until the row is hovered and loud once it is armed, like every
       * other destructive control in the app.
       */
      const actions = el('div', 'roster__actions')
      actions.appendChild(control)
      card.appendChild(actions)
    }

    into.appendChild(card)
  }
}
