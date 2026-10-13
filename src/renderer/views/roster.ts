/**
 * The roster panel — who works here, what they know, and changing both.
 *
 * F12 and F13 shipped the mechanism: `hire`, `fire`, `disable`, `enable`, `addSkill`,
 * `removeSkill` and the shelf report all cross IPC and all have tests. Before this file, none
 * of them had a caller in the renderer — eleven methods reachable only by somebody who had read
 * `preload.ts`. That is the same fault the completion plan opened with about `capabilities.ts`,
 * and having written that criticism it would be a poor look to leave my own half in that state.
 *
 * This file builds DOM and reports what was clicked. It decides nothing: every sentence and
 * every offered button comes from `shared/roster-view.ts`, where a test can reach it without a
 * browser. It performs nothing either — fetching, writing and rescanning are the caller's, which
 * is what keeps the rule that the renderer owns no I/O.
 */

import { avatar, type AvatarSource } from './avatar.js'
import {
  commonToolsLine,
  shelfSummary,
  skillRows,
  type SkillRow,
  staffCountLine,
  staffRows,
  type RosterModel,
  type StaffRow,
} from '../../shared/roster-view.js'

export type { RosterModel }

export interface RosterHandlers {
  /** Where faces come from. Optional: the roster is a list of names first and a gallery second. */
  readonly art?: AvatarSource

  readonly onHire: () => void
  readonly onFire: (id: string) => void
  readonly onBench: (id: string) => void
  readonly onUnbench: (id: string) => void
  readonly onAddSkill: () => void
  readonly onRemoveSkill: (id: string) => void
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Fill `host` with the staff list and the shelf. Replaces whatever was there. */
export function renderRoster(host: HTMLElement, model: RosterModel, on: RosterHandlers): void {
  host.replaceChildren()
  host.appendChild(staffSection(model, on))
  host.appendChild(shelfSection(model, on))
}

function staffSection(model: RosterModel, on: RosterHandlers): HTMLElement {
  const section = el('section', 'roster__section')

  const head = el('div', 'roster__head')
  head.appendChild(el('h4', 'label', 'Staff'))
  head.appendChild(el('span', 'roster__count', staffCountLine(model)))
  section.appendChild(head)

  // Printed once, above everybody, instead of six times underneath them.
  const shared = commonToolsLine(model)
  if (shared) section.appendChild(el('p', 'roster__shared', shared))

  const rows = staffRows(model)
  for (const row of rows) section.appendChild(personRow(row, on))

  if (rows.length === 0) {
    /*
     * Two different facts, and until now one sentence for both. A staff directory that will not
     * open is not an office with nobody in it — and the panel says so at the top while this said
     * the opposite underneath. The `--problem` variant, because an office that cannot see its own
     * staff is a fault rather than an empty room, and they must not draw the same.
     */
    section.appendChild(
      model.staffUnreadable
        ? el(
            'p',
            'roster__empty roster__empty--problem',
            'The staff could not be read, so the office cannot say who works here. This is not the ' +
              'same as nobody working here — check the permissions on .claude/agents.',
          )
        : el('p', 'roster__empty', 'Nobody works here yet. Hire somebody and a desk appears for them.'),
    )
  }

  const hire = el('button', 'btn btn--sm roster__add', 'Hire somebody')
  hire.type = 'button'
  hire.addEventListener('click', on.onHire)
  section.appendChild(hire)

  return section
}

/**
 * One person. A benched employee gets the same row as anybody else, dimmed and dashed.
 *
 * Not hidden, and this is the reason: disabling renames their file out of `*.md`, so they leave
 * discovery entirely and this row is the only place they can be found. A roster showing only
 * active staff makes "send home" and "fire" look identical, and only one of them is reversible.
 */
function personRow(row: StaffRow, on: RosterHandlers): HTMLElement {
  const node = el('div', `roster__row${row.atDesk ? '' : ' roster__row--off'}`)

  const top = el('div', 'roster__top')
  // The same character that is at their desk. A roster of names beside a floor of faces makes
  // somebody match one to the other by reading; this is the whole of F5's "legible as *this*
  // agent" applied to the list where it is hardest.
  if (on.art) top.appendChild(avatar(row.id, 18, on.art))
  top.appendChild(el('span', 'roster__name', row.name))
  // The model an agent file names, or silence. Printing "default" would invent a value the
  // file does not contain.
  if (row.model) top.appendChild(el('span', 'roster__model mono', row.model))
  for (const badge of row.badges) {
    top.appendChild(
      el('span', `roster__badge${row.atDesk ? '' : ' roster__badge--off'}`, badge),
    )
  }
  node.appendChild(top)

  node.appendChild(el('p', 'roster__desc', row.description))

  // Only when it distinguishes this row. The common list is above, said once; repeating it here
  // told you nothing about this person and cost about 20px on every card.
  if (!row.toolsAreCommon) {
    const tools = el('p', 'roster__tools mono', row.tools.text)
    if (row.tools.warn) {
      tools.classList.add('roster__tools--inherited')
      tools.title =
        'Their file has no `tools:` line. Omitting it inherits everything the parent has, which lets an employee summon a colleague.'
    }
    node.appendChild(tools)
  }

  // A tool this employee will reach for that nothing can answer. It does not fail loudly: they
  // reach, get nothing, and report that they could not do the thing — which from the outside is
  // indistinguishable from the agent being bad at its job. That is why it belongs here, on their
  // row, rather than in a diagnostics panel nobody opens.
  // A built-in tool this workspace will refuse. Same shape of failure as a dangling MCP tool
  // and a different fix, so it says which — "add it to permissions.allow" and "configure a
  // server called notion" are not the same sentence.
  if (row.unreachable.length > 0) {
    const warn = el('p', 'roster__tools roster__tools--dangling mono')
    warn.textContent =
      row.unreachable.length === 1
        ? `${row.unreachable[0]} — this workspace has not permitted it, so the call is refused`
        : `${row.unreachable.join(' · ')} — this workspace has not permitted these, so the calls are refused`
    warn.title =
      'The tool is in this agent\'s `tools:` list and not in `permissions.allow`, so Claude Code refuses it — and under --print there is no human to ask.'
    node.appendChild(warn)
  }

  if (row.dangling.length > 0) {
    const warn = el('p', 'roster__tools roster__tools--dangling mono')
    warn.textContent =
      row.dangling.length === 1
        ? `${row.dangling[0]} — no such server is configured, so this call cannot work`
        : `${row.dangling.join(' · ')} — no such servers are configured, so these calls cannot work`
    node.appendChild(warn)
  }

  // Why there are no buttons, when there are none and it is not because they are the manager.
  // An unexplained gap where two controls sit on every other row reads as a rendering fault.
  if (row.unmanageable !== null) {
    const why = el('p', 'roster__tools roster__tools--dangling')
    why.textContent = row.unmanageable
    node.appendChild(why)
  }

  if (row.actions.length > 0) {
    // On the identity row, right-aligned, rather than on a line of their own beneath the card.
    //
    // Reported: a lot of Send home and Fire buttons. Measured: **18 buttons in one 480 x
    // 654 panel**, of which twelve were `Send home` and `Fire` repeated six times each, every one
    // permanently drawn at full weight on its own row. That is not six decisions the panel is
    // asking you to make; it is one list, and the actions belong to whichever row you are
    // pointing at. Quiet until the row is hovered or focused — always present, never shouting.
    const actions = el('div', 'roster__actions')
    for (const action of row.actions) {
      if (action === 'fire') {
        actions.appendChild(fireButton(row.id, on))
        continue
      }
      const button = el('button', 'btn btn--sm roster__act', action === 'bench' ? 'Send home' : 'Bring back')
      button.type = 'button'
      if (action === 'bench') {
        button.title = `Renames their file to ${row.id}.md.off. They leave the floor; nothing is lost.`
      }
      button.addEventListener('click', () =>
        action === 'bench' ? on.onBench(row.id) : on.onUnbench(row.id),
      )
      actions.appendChild(button)
    }
    top.appendChild(actions)
  }

  return node
}

/**
 * Fire, behind a confirmation that lives in the button itself.
 *
 * `fire()` calls `unlink`. There is no undo and the file may not be in anybody's git. A second
 * click on a button that has changed its own label is a confirmation the keyboard can reach and
 * a screen reader announces, which `window.confirm` in a sandboxed renderer is not. It resets on
 * blur, so a stray click never leaves an armed delete sitting on screen.
 */
function fireButton(id: string, on: RosterHandlers): HTMLButtonElement {
  const button = el('button', 'btn btn--sm btn--danger roster__act', 'Fire')
  button.type = 'button'
  let armed = false

  const disarm = () => {
    armed = false
    button.textContent = 'Fire'
    button.classList.remove('roster__act--armed')
  }

  button.addEventListener('click', () => {
    if (!armed) {
      armed = true
      button.textContent = 'Delete their file — click again'
      button.classList.add('roster__act--armed')
      return
    }
    disarm()
    on.onFire(id)
  })
  button.addEventListener('blur', disarm)

  return button
}

function shelfSection(model: RosterModel, on: RosterHandlers): HTMLElement {
  const shelf = model.shelf
  const section = el('section', 'roster__section')
  const summary = shelfSummary(shelf)

  const head = el('div', 'roster__head')
  head.appendChild(el('h4', 'label', 'Skills'))
  if (summary.count) head.appendChild(el('span', 'roster__count', summary.count))
  section.appendChild(head)

  if (shelf === null) {
    section.appendChild(
      el('p', 'roster__empty roster__empty--problem', summary.empty ?? ''),
    )
    return section
  }

  for (const row of skillRows(model)) section.appendChild(skillRow(row, on))
  if (summary.empty) section.appendChild(el('p', 'roster__empty', summary.empty))

  const add = el('button', 'btn btn--sm roster__add', 'Write a skill')
  add.type = 'button'
  add.addEventListener('click', on.onAddSkill)
  section.appendChild(add)

  return section
}

/**
 * One skill, and how often it has actually been invoked.
 *
 * The count comes from the transcripts rather than a counter beside the file, so it cannot drift
 * from what happened — and a skill that is gone but was used keeps its row, because deleting the
 * row would delete the evidence that the office once relied on it.
 */
function skillRow(row: SkillRow, on: RosterHandlers): HTMLElement {
  const node = el('div', `roster__row${row.onShelf ? '' : ' roster__row--off'}`)

  const top = el('div', 'roster__top')
  top.appendChild(el('span', 'roster__name', row.name))
  if (!row.onShelf) top.appendChild(el('span', 'roster__badge roster__badge--off', 'removed'))
  top.appendChild(el('span', 'roster__uses mono', row.uses))
  node.appendChild(top)

  // What it does, above how often it was reached for — the same order as a person's row, and
  // for the same reason: the count is only worth reading once you know what was counted.
  node.appendChild(el('p', 'roster__desc', row.description))

  if (row.when) {
    node.appendChild(el('p', 'roster__tools mono', row.when))
  }

  if (row.onShelf) {
    const actions = el('div', 'roster__actions')
    const remove = el('button', 'btn btn--sm roster__act', 'Take off the shelf')
    remove.type = 'button'
    remove.addEventListener('click', () => on.onRemoveSkill(row.id))
    actions.appendChild(remove)
    node.appendChild(actions)
  }

  return node
}
