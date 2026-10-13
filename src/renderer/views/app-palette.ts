/**
 * The command palette for the app itself — ⌘K.
 *
 * Not the slash menu. That one sends things to Claude and costs money; this one opens panels and
 * moves the pane about. `shared/actions.ts` says why they are kept apart.
 *
 * It exists to make the exit condition *"every shipped capability is reachable with a mouse or
 * the keyboard"* true by construction rather than by an audit somebody has to repeat. A panel
 * registered as an action is keyboard-reachable the moment it is registered; nobody has to
 * remember to find it a shortcut.
 */

import { byGroup, filterActions, type Action } from '../../shared/actions.js'

export interface PaletteHost {
  /** Everything that can be done right now. Re-read on open, so it can vary with state. */
  readonly actions: () => readonly Action[]
  readonly run: (id: string) => void
}

export class AppPalette {
  private query = ''
  private cursor = 0
  private shown: readonly Action[] = []

  constructor(
    private readonly root: HTMLElement,
    private readonly input: HTMLInputElement,
    private readonly list: HTMLElement,
    private readonly host: PaletteHost,
  ) {
    this.input.addEventListener('input', () => {
      this.query = this.input.value
      this.cursor = 0
      this.draw()
    })
    this.input.addEventListener('keydown', (event) => this.key(event))
    // Clicking the backdrop closes it. The dialog itself does not, or every click inside would.
    this.root.addEventListener('mousedown', (event) => {
      if (event.target === this.root) this.close()
    })
  }

  get isOpen(): boolean {
    return !this.root.hidden
  }

  open(): void {
    this.query = ''
    this.cursor = 0
    this.input.value = ''
    this.root.hidden = false
    this.draw()
    this.input.focus()
  }

  close(): void {
    this.root.hidden = true
  }

  toggle(): void {
    if (this.isOpen) this.close()
    else this.open()
  }

  private key(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      // Wraps, because a list you can walk off the end of makes you look at it to use it.
      this.cursor = (this.cursor + step + this.shown.length) % Math.max(1, this.shown.length)
      this.draw()
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = this.shown[this.cursor]
      if (chosen) this.choose(chosen)
    }
  }

  private choose(action: Action): void {
    // Closed first. Several actions open a panel and focus something in it, and doing that
    // underneath a palette that is still up is how focus ends up somewhere nobody can see.
    this.close()

    /*
     * Run on the next task, not inside the event that asked for it.
     *
     * Rows are chosen on `mousedown`, and that event keeps bubbling to `document` after this
     * handler returns. Anything the action *opens* which dismisses itself on an outside mousedown
     * — `switcher.ts` and `popmenu.ts` both do, deliberately — is open by the time the event
     * reaches those listeners, and its target is this row, which is outside. So the menu opens and
     * closes inside one event, and the command does nothing at all.
     *
     * That is exactly what `⌘K → "Switch project or conversation"` did, while `⌘L` — the same
     * `els.switcher.click()`, from a keydown — worked. Every layer was individually correct: the
     * row is right to bind mousedown, and the switcher is right to close on an outside one.
     *
     * `stopPropagation` would also fix this one and would cost the document-level listeners that
     * are entitled to see it, `noticeThePerson` among them. A task boundary fixes the whole class
     * and takes nothing away: an action must not be undone by the event that requested it.
     */
    setTimeout(() => this.host.run(action.id), 0)
  }

  /**
   * How many rows the list will draw.
   *
   * Needed once the palette could reach **projects and conversations** rather than a fixed
   * fifteen commands. A workspace with six hundred projects would otherwise put six hundred rows
   * in a dialog, which is not a palette, and typing a single common letter would put four hundred
   * back.
   *
   * The cap applies with or without a query, deliberately: the failure it prevents is the same
   * either way, and a rule that changes with the query is one nobody can predict. What is never
   * capped is the *matching* — `filterActions` sees everything, so the project you are looking
   * for is always findable by typing more of its name.
   *
   * The fixed actions are declared first and therefore always survive the cap. That is the
   * property that makes this safe rather than merely bounded.
   */
  private static readonly SHOWN_MAX = 24

  private draw(): void {
    const matched = filterActions(this.host.actions(), this.query)
    this.shown = matched.slice(0, AppPalette.SHOWN_MAX)
    const hidden = matched.length - this.shown.length
    this.list.replaceChildren()

    if (this.shown.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'apal__empty'
      empty.textContent = `Nothing here matches “${this.query}”.`
      this.list.appendChild(empty)
      return
    }

    let index = 0
    for (const { group, actions } of byGroup(this.shown)) {
      const heading = document.createElement('p')
      heading.className = 'apal__group'
      heading.textContent = group
      this.list.appendChild(heading)

      for (const action of actions) {
        this.list.appendChild(this.rowFor(action, index))
        index += 1
      }
    }

    // Said, never silent. A list that stops at twenty-four without saying so is a list claiming
    // the workspace has twenty-four things in it — the same sentence the campus refuses to make
    // when it cannot draw every office. And it says what to do about it, because a count on its
    // own tells somebody a number and not the next move.
    if (hidden > 0) {
      const more = document.createElement('p')
      more.className = 'apal__more'
      more.textContent =
        hidden === 1
          ? '1 more matches — type another letter to narrow it.'
          : `${hidden} more match — type another letter to narrow them.`
      this.list.appendChild(more)
    }
  }

  private rowFor(action: Action, index: number): HTMLElement {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = index === this.cursor ? 'apal__row apal__row--on' : 'apal__row'
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', String(index === this.cursor))

    const label = document.createElement('span')
    label.className = 'apal__label'
    label.textContent = action.label
    row.appendChild(label)

    if (action.keys) {
      const keys = document.createElement('span')
      keys.className = 'apal__keys mono'
      keys.textContent = action.keys
      row.appendChild(keys)
    }

    // `mousedown`, not `click`: the input has focus, and a click would blur it first and let the
    // backdrop handler race the selection.
    row.addEventListener('mousedown', (event) => {
      event.preventDefault()
      this.choose(action)
    })
    row.addEventListener('mouseenter', () => {
      this.cursor = index
      this.draw()
    })

    return row
  }
}

/**
 * The accelerator, written the way this platform writes it.
 *
 * `⌘K` on a Mac and `Ctrl K` everywhere else. Shown rather than assumed, because a label that
 * says ⌘ on Linux is a label nobody can follow.
 */
export function accelerator(platform: string, key: string): string {
  return /mac/i.test(platform) ? `⌘${key.toUpperCase()}` : `Ctrl ${key.toUpperCase()}`
}
