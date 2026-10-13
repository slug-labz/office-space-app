/**
 * A select we own.
 *
 * The three dials above the composer were native `<select>` elements. That was a defensible
 * choice and `index.html` argued for it: keyboard-navigable, screen-reader-legible and correctly
 * placed on every platform for free, and none of that is worth reimplementing to gain a chevron.
 *
 * It is the wrong trade here, and the reason is not the chevron. **A native option is a single
 * line of text and nothing else.** It cannot carry the sentence that says what `acceptEdits`
 * does, and that sentence is the entire difference between a control somebody can use and a flag
 * name they have to already know. The menu is also drawn by the operating system, which is why
 * three amber-on-charcoal pickers open a white macOS menu in the middle of a dark app.
 *
 * So: our own listbox, built to the model shadcn/ui uses for its Select — a trigger showing the
 * current value, a floating list, one option per row with a description under it, a checkmark on
 * the selected one. What that model gets right and a naive rewrite misses is that **everything
 * the native control did for free has to be put back by hand**, and this file is mostly that:
 *
 * - `role="listbox"` and `role="option"` with `aria-selected`, so a screen reader still reads it
 *   as a picker rather than as a pile of buttons.
 * - Arrow keys, Home and End, Enter and Space, Escape to close without choosing.
 * - **Typeahead.** Typing `s` jumps to `sonnet`. It is the one native behaviour people use
 *   without noticing and miss immediately.
 * - Focus returns to the trigger when the list closes, so tabbing does not restart at the top of
 *   the document.
 * - Clicking anywhere else closes it.
 *
 * No animation, on Khalid's instruction. The list appears and disappears.
 */

import type { Choice } from '../../shared/control-copy.js'

export interface SelectOptions {
  /** For the accessible name, and for the label the closed trigger shows when nothing is set. */
  readonly label: string
  readonly choices: readonly Choice[]
  /** What the closed trigger reads as, given the value. */
  readonly triggerText: (value: string) => string
  /** True for a choice that should be marked as carrying consequences. */
  readonly grave?: (value: string) => boolean
  readonly onChange: (value: string) => void
}

/** How long a run of keystrokes counts as one typeahead search. The native control's own feel. */
const TYPEAHEAD_MS = 500

export class Select {
  private value = ''
  private open = false
  private cursor = 0
  private search = ''
  private searchAt = 0

  private readonly trigger: HTMLButtonElement
  private readonly list: HTMLDivElement

  constructor(
    private readonly root: HTMLElement,
    private readonly options: SelectOptions,
  ) {
    this.root.classList.add('sel')

    // An id for the listbox, so the trigger can point at it.
    //
    // `aria-haspopup` says *a listbox opens*; `aria-expanded` says *it is open now*; only
    // `aria-controls` says **which one**. Without it a screen reader is told a listbox exists and
    // is left to guess where — which is fine with one dial on screen and is not what this
    // composer has: three triggers sit in a row and each opens its own list.
    //
    // Derived from the label rather than a counter, so the id is stable across re-renders and
    // says what it belongs to when somebody reads the DOM.
    const listId = `sel-${options.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

    this.trigger = document.createElement('button')
    this.trigger.type = 'button'
    this.trigger.className = 'sel__trigger'
    this.trigger.setAttribute('aria-haspopup', 'listbox')
    this.trigger.setAttribute('aria-expanded', 'false')
    this.trigger.setAttribute('aria-controls', listId)
    this.trigger.setAttribute('aria-label', options.label)
    this.trigger.addEventListener('click', () => this.toggle())
    this.trigger.addEventListener('keydown', (event) => this.triggerKey(event))

    this.list = document.createElement('div')
    this.list.id = listId
    this.list.className = 'sel__list'
    this.list.setAttribute('role', 'listbox')
    this.list.setAttribute('aria-label', options.label)
    this.list.hidden = true
    this.list.addEventListener('keydown', (event) => this.listKey(event))

    this.root.append(this.trigger, this.list)

    /*
     * Anything outside closes it. Captured on the document rather than on a backdrop element,
     * because a backdrop over a composer would swallow the click that put the cursor back.
     *
     * **This listener outlives the instance, and there is no teardown.** `document` is never
     * replaced, so the closure over `this` keeps a discarded `Select` alive for the life of the
     * window. Every other listener in this class is on `this.root` or `this.list` and dies when
     * those nodes are dropped; this one does not.
     *
     * Measured rather than assumed, and it is not currently a leak: the only construction site is
     * `fillDials`, which runs at boot. Driving the app — five panel open/close cycles, both dial
     * listboxes, three new conversations — added **zero** document listeners.
     *
     * It becomes one the moment anything constructs a `Select` on a redraw, and `fillDials`'s own
     * comment invites exactly that: *"Idempotent: calling it twice does not stack a second listbox
     * inside the same element."* True of the DOM, because it calls `replaceChildren()`. Not true
     * of this — two calls leave two of these behind, holding two dead Selects.
     *
     * Left rather than fixed because a teardown nobody calls is its own dead code, and the class
     * has no lifecycle to hang one on today. Named so the next person adding a construction site
     * meets it as a known cost.
     */
    document.addEventListener('mousedown', (event) => {
      if (this.open && !this.root.contains(event.target as Node)) this.close(false)
    })
  }

  /** What is selected. Never guesses — the caller sets it from what the office actually holds. */
  get current(): string {
    return this.value
  }

  /**
   * Show a value.
   *
   * Always given what the office came back with, never what the UI sent. A picker showing a
   * value the session is not running is the third standing order broken in the smallest possible
   * way, and it is the rule `dials.ts` was already written to keep.
   */
  set(value: string, marks: { set: boolean; unknown: boolean }): void {
    this.value = value
    this.cursor = Math.max(0, this.options.choices.findIndex((c) => c.value === value))
    this.trigger.textContent = this.options.triggerText(value)
    this.trigger.dataset['set'] = String(marks.set)
    this.trigger.dataset['unknown'] = String(marks.unknown)
    this.trigger.dataset['grave'] = String(this.options.grave?.(value) ?? false)
    if (this.open) this.draw()
  }

  private toggle(): void {
    if (this.open) this.close(true)
    else this.show()
  }

  private show(): void {
    this.open = true
    this.list.hidden = false
    this.trigger.setAttribute('aria-expanded', 'true')
    this.draw()
    this.place()
    // Focus moves into the list so the arrow keys belong to it. The trigger keeps the accessible
    // name; the list carries the cursor.
    this.list.focus()
  }

  /**
   * Open into whichever side has room, and never past the edge of the window.
   *
   * The dials sit at the bottom of the pane, so up is the natural direction — but the window's
   * minimum height is 600px and at that size a five-option list does not fit above them. What
   * that produced was a menu whose last row was half visible, and in the permissions picker the
   * last row is `bypass permissions`: the one option whose consequences most need reading.
   *
   * A fixed `max-height` would have hidden it just as effectively. This measures instead: pick
   * the roomier side, then cap to what is actually there. The list still scrolls when neither
   * side is enough, which is the honest outcome on a very short window.
   */
  private place(): void {
    const trigger = this.trigger.getBoundingClientRect()
    const margin = 12

    const above = trigger.top - margin
    const below = window.innerHeight - trigger.bottom - margin
    const upward = above >= below

    this.list.classList.toggle('sel__list--down', !upward)
    this.list.style.maxHeight = `${Math.max(120, Math.floor(upward ? above : below))}px`
  }

  private close(focusTrigger: boolean): void {
    this.open = false
    this.list.hidden = true
    this.trigger.setAttribute('aria-expanded', 'false')
    // Back to the trigger, so tabbing continues from here rather than from the top of the
    // document — the single most-missed thing when a native control is replaced.
    if (focusTrigger) this.trigger.focus()
  }

  private choose(index: number): void {
    const choice = this.options.choices[index]
    if (!choice) return
    this.close(true)
    // The caller decides what a change means, and what it paints afterwards. This never sets its
    // own value on the strength of a click.
    this.options.onChange(choice.value)
  }

  private triggerKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      this.show()
    }
  }

  private listKey(event: KeyboardEvent): void {
    const last = this.options.choices.length - 1

    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        // Closes without choosing. The value is unchanged, which is what Escape means everywhere
        // else in this app.
        this.close(true)
        return
      case 'ArrowDown':
        event.preventDefault()
        this.moveTo(Math.min(this.cursor + 1, last), true)
        return
      case 'ArrowUp':
        event.preventDefault()
        this.moveTo(Math.max(this.cursor - 1, 0), true)
        return
      case 'Home':
        event.preventDefault()
        this.moveTo(0, true)
        return
      case 'End':
        event.preventDefault()
        this.moveTo(last, true)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        this.choose(this.cursor)
        return
      case 'Tab':
        // Let focus leave, but do not leave a menu open behind it.
        this.close(false)
        return
    }

    // Typeahead. One printable character at a time, accumulated while they keep typing.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now()
      this.search = now - this.searchAt > TYPEAHEAD_MS ? event.key : this.search + event.key
      this.searchAt = now

      const at = this.options.choices.findIndex((c) => c.label.toLowerCase().startsWith(this.search.toLowerCase()))
      if (at !== -1) {
        event.preventDefault()
        this.moveTo(at, true)
      }
    }
  }

  /**
   * Move the cursor to a row.
   *
   * **Marks the existing rows; never rebuilds them.** It used to call `draw()`, which is
   * `replaceChildren()` — so moving the mouse onto a row destroyed every row, built new ones,
   * and then scrolled the list. Your `mousedown` landed on whatever had slid under the pointer,
   * usually the container's own gap, and no row handler ran at all.
   *
   * Reported as the tick staying where it was and choosing a row changing nothing.
   * That is precisely it — the tick could not move because the press never reached a
   * row. Every synthetic test passed because dispatching onto a held reference never fires
   * `mouseenter`, so nothing was ever rebuilt underneath it.
   *
   * `scroll` is off by default and asked for by the keyboard alone. Scrolling the list because
   * the pointer arrived somewhere moves the target out from under the hand that is reaching for
   * it, which is the same bug wearing a different hat.
   */
  private moveTo(index: number, scroll = false): void {
    this.cursor = index
    this.mark()
    if (scroll) this.list.children[index]?.scrollIntoView({ block: 'nearest' })
  }

  /**
   * Repaint which row is the cursor and which is chosen, in place.
   *
   * The class names must stay in step with {@link draw}. They are set in one place each way
   * round rather than shared, because `draw` builds a row from nothing and this only ever
   * adjusts one that already exists — and the whole point is that it touches no identity.
   */
  private mark(): void {
    for (const [index, row] of Array.from(this.list.children).entries()) {
      const choice = this.options.choices[index]
      if (!choice) continue
      row.setAttribute('aria-selected', String(choice.value === this.value))
      row.classList.toggle('sel__row--on', index === this.cursor)
      row.classList.toggle('sel__row--picked', choice.value === this.value)
    }
    this.list.setAttribute('aria-activedescendant', this.list.children[this.cursor]?.id ?? '')
  }

  private draw(): void {
    this.list.replaceChildren()
    // `tabindex` on the list, not on each row: the list is the focused element and `aria-
    // activedescendant` says which row the cursor is on. One tab stop for the whole control,
    // which is what a native select is.
    this.list.tabIndex = -1

    for (const [index, choice] of this.options.choices.entries()) {
      const row = document.createElement('div')
      row.className = 'sel__row'
      row.id = `${this.options.label.replace(/\W+/g, '-')}-opt-${index}`
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(choice.value === this.value))
      if (index === this.cursor) row.classList.add('sel__row--on')
      if (choice.value === this.value) row.classList.add('sel__row--picked')
      if (this.options.grave?.(choice.value)) row.classList.add('sel__row--grave')

      const head = document.createElement('span')
      head.className = 'sel__label'
      head.textContent = choice.label
      row.appendChild(head)

      // The whole reason this control exists. A native option cannot carry this line.
      const detail = document.createElement('span')
      detail.className = 'sel__detail'
      detail.textContent = choice.detail
      row.appendChild(detail)

      // `mousedown`, not `click`: the list has focus, and a click would blur it first and let
      // the document handler close the menu before the selection landed.
      row.addEventListener('mousedown', (event) => {
        event.preventDefault()
        this.choose(index)
      })
      row.addEventListener('mouseenter', () => this.moveTo(index))

      this.list.appendChild(row)
    }

    this.list.setAttribute('aria-activedescendant', this.list.children[this.cursor]?.id ?? '')
  }
}
