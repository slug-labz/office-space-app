/**
 * The first-run panel.
 *
 * Draws whatever `shared/first-run.ts` diagnosed. Two shapes, decided by that module rather than
 * here: a takeover across the floor when nothing can work, and a quiet card when the office is
 * merely new.
 *
 * A command is shown as text with a copy button rather than run. Office Space installs nothing
 * and touches nobody's PATH — the whole architecture is that it spawns a binary the user already
 * chose to have, and an onboarding screen that starts running `npm install -g` on their machine
 * would be a different product with a different threat model.
 */

import type { Step } from '../../shared/first-run.js'

export interface FirstRunHandlers {
  /** Run an app action by id — the same ids the command palette uses. */
  readonly onAction: (id: string) => void
  /** Look again. The usual reason a step is on screen is one the user just went and fixed. */
  readonly onRecheck: () => void
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

export function renderFirstRun(host: HTMLElement, steps: readonly Step[], on: FirstRunHandlers): void {
  host.replaceChildren()

  // Zero steps used to render as one bare "Look again" button under a heading — a panel that
  // looks like it failed to load. It is the opposite: every condition this screen knows how to
  // check came back fine. Say which, because "nothing needs attention" and "nothing was checked"
  // look identical on screen and are not the same claim. Standing order 4, on the one screen
  // whose whole job is telling a stranger what is true about their workspace.
  if (steps.length === 0) {
    const fine = el('div', 'firstrun__step firstrun__step--ready')
    fine.appendChild(el('p', 'firstrun__detail', 'Nothing needs attention. The claude command is installed and reachable, this workspace is trusted so its permission rules are in force, everything here could be read, and the office has staff.'))
    host.appendChild(fine)
  }

  for (const step of steps) host.appendChild(stepCard(step, on))

  // Always offered, and it is the button people actually want: they have just installed
  // something in a terminal and want the app to notice without a restart.
  const again = el('button', 'btn btn--sm roster__add', 'Look again')
  again.type = 'button'
  again.addEventListener('click', on.onRecheck)
  host.appendChild(again)
}

function stepCard(step: Step, on: FirstRunHandlers): HTMLElement {
  const card = el('div', `firstrun__step firstrun__step--${step.severity}`)

  const top = el('div', 'roster__top')
  top.appendChild(el('span', 'roster__name', step.title))
  top.appendChild(el('span', `roster__badge roster__badge--${step.severity}`, badge(step.severity)))
  card.appendChild(top)

  // Not `roster__desc`: its three-line clamp hid the end of a detail, which is usually the fix.
  card.appendChild(el('p', 'firstrun__detail', step.detail))

  if (step.command) card.appendChild(commandRow(step.command))

  if (step.action) {
    const actions = el('div', 'roster__actions')
    const button = el('button', 'btn btn--sm roster__act', label(step.action))
    button.type = 'button'
    button.addEventListener('click', () => on.onAction(step.action!))
    actions.appendChild(button)
    card.appendChild(actions)
  }

  return card
}

/** The command, and a way to get it into a terminal without retyping it. */
function commandRow(command: string): HTMLElement {
  const row = el('div', 'firstrun__cmd')
  row.appendChild(el('code', 'firstrun__cmd-text mono', command))

  const copy = el('button', 'btn btn--sm roster__act', 'Copy')
  copy.type = 'button'
  copy.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(command)
      .then(() => {
        copy.textContent = 'Copied'
        window.setTimeout(() => (copy.textContent = 'Copy'), 1200)
      })
      .catch(() => {
        // Clipboard permission refused. Saying so beats a button that silently does nothing —
        // the text is right there to select by hand.
        copy.textContent = 'Select it instead'
      })
  })
  row.appendChild(copy)

  return row
}

function badge(severity: Step['severity']): string {
  // "empty" is not a fault and must not read as one. Somebody who has just arrived and started
  // nothing is in a correct state.
  return severity === 'blocked' ? 'blocked' : severity === 'warning' ? 'worth knowing' : 'nothing here yet'
}

function label(action: string): string {
  if (action === 'hire') return 'Hire somebody'
  if (action === 'new-project') return 'Start a project'
  if (action === 'add-template') return 'Add the project template'
  return 'Do it'
}
