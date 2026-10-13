/**
 * The slash menu.
 *
 * Everything typeable after a slash in this workspace — commands from `.claude/commands/` and
 * skills, which the CLI resolves as `/skill-name` for free.
 *
 * ## Why a menu is worth building at all
 *
 * The office **expands nothing**: `--print` resolves a slash command before the model ever sees
 * it. So this list does not make commands work; they already work. What it fixes is that an
 * unknown command is **silent**. Type `/stat` instead of `/state` and the CLI answers it
 * synthetically — zero tokens, zero cost, no error, and no reply. Nothing tells you that you
 * misspelled it. A list you pick from is the difference between a facility you can use and one
 * you have to already know by heart.
 *
 * ## What it does not do
 *
 * It builds DOM and reports what you chose. It does not read the filesystem, does not decide
 * what a choice means, and does not insert anything into the composer — the caller owns the
 * composer and owns that decision.
 */

import { filterItems, slashToken } from '../../shared/slash.js'
import type { Invocable } from '../../shared/ipc.js'

// Re-exported so the composer imports one thing, not two.
export { slashToken }

export interface CommandMenuHandlers {
  /** Something was chosen. The caller decides what to put in the composer. */
  readonly onChoose: (item: Invocable) => void
  readonly onDismiss: () => void
}

export class CommandMenu {
  private items: readonly Invocable[] = []
  private shown: readonly Invocable[] = []
  private index = 0

  constructor(
    private readonly root: HTMLElement,
    private readonly on: CommandMenuHandlers,
  ) {
    this.root.hidden = true
  }

  /** The list to filter against. Replaced whenever the workspace changes. */
  setItems(items: readonly Invocable[]): void {
    this.items = items
  }

  get open(): boolean {
    return !this.root.hidden
  }

  /** Show what matches, or hide if nothing does. */
  show(token: string): void {
    this.shown = filterItems(this.items, token)

    if (this.shown.length === 0) {
      // Nothing matches. Hiding is right rather than showing an empty box: the composer is
      // still perfectly usable for a command we have never heard of, and the CLI is the one
      // that decides what exists.
      this.hide()
      return
    }

    this.index = 0
    this.root.hidden = false
    this.paint()
  }

  hide(): void {
    if (this.root.hidden) return
    this.root.hidden = true
    this.root.replaceChildren()
  }

  /**
   * Give the menu first refusal on a keystroke.
   *
   * Returns true when it handled the key, so the caller knows not to also act on it. Arrow keys
   * and Enter mean something different while a menu is open, and Enter especially: sending the
   * message and choosing an item are both reasonable readings, and only one of them can happen.
   */
  handleKey(key: string): boolean {
    if (!this.open) return false

    if (key === 'Escape') {
      this.hide()
      this.on.onDismiss()
      return true
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const delta = key === 'ArrowDown' ? 1 : -1
      this.index = (this.index + delta + this.shown.length) % this.shown.length
      this.paint()
      return true
    }
    if (key === 'Enter' || key === 'Tab') {
      const chosen = this.shown[this.index]
      if (chosen) {
        this.hide()
        this.on.onChoose(chosen)
      }
      return true
    }
    return false
  }

  private paint(): void {
    this.root.replaceChildren()
    for (const [i, item] of this.shown.entries()) {
      this.root.appendChild(this.row(item, i === this.index))
    }
  }

  private row(item: Invocable, selected: boolean): HTMLElement {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = selected ? 'slash__row slash__row--on' : 'slash__row'

    const name = document.createElement('span')
    name.className = 'slash__name'
    name.textContent = `/${item.name}`
    el.appendChild(name)

    if (item.argumentHint) {
      const hint = document.createElement('span')
      hint.className = 'slash__args'
      hint.textContent = item.argumentHint
      el.appendChild(hint)
    }

    const kind = document.createElement('span')
    kind.className = 'slash__kind'
    // A skill becomes a `Skill` tool call the floor can act on; a command is expanded into a
    // prompt and leaves no trace in the stream. Same gesture to type, different thing to watch.
    kind.textContent = item.shadowsSkill ? 'command · shadows a skill' : item.kind
    el.appendChild(kind)

    if (item.description) {
      const desc = document.createElement('span')
      desc.className = 'slash__desc'
      desc.textContent = item.description
      el.appendChild(desc)
    }

    el.addEventListener('mousedown', (event) => {
      // mousedown, not click: the composer loses focus on mousedown and a blur handler would
      // close the menu before the click ever landed.
      event.preventDefault()
      this.hide()
      this.on.onChoose(item)
    })
    return el
  }
}
