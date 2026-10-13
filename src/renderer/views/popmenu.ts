/**
 * A button that opens a small menu, and the keyboard that comes with it.
 *
 * Written down because it existed twice and only one copy was complete. The switcher's `+` menu
 * has focus-on-open, arrows, and Escape-back-to-the-trigger; the status bar's `···` menu and the
 * dials next to it had none of the three — and `···` carries `role="menu"` in the markup and
 * gives every item `role="menuitem"`, which is a promise to assistive technology that arrow keys
 * move between them. They did not.
 *
 * `switcher-keys.dom.test.ts` already names this fault about a different control: *"the same
 * class of fault as the panels that opened without taking focus at all — three of which were
 * fixed on this branch."* These are the fourth and fifth.
 *
 * ## Clamped, not wrapped
 *
 * Same call as the switcher's list, and for the same reason written down there: the palette and
 * the slash menu wrap because they are candidates you are picking from, and these are short fixed
 * menus where running off the end and reappearing at the other is a way to lose your place. Both
 * behaviours are defensible and opposite, so the one that ships is pinned here rather than left
 * to whoever writes the next menu.
 *
 * ## And the way out returns you to where you were
 *
 * Escape closes and puts focus back on the trigger. Closing without that leaves focus on an
 * element that is no longer on screen, which is how a keyboard lands nowhere and the next Tab
 * starts from the top of the document.
 */

export interface PopMenu {
  readonly isOpen: () => boolean
  open(): void
  close(): void
}

/**
 * Anything a person can Tab to. Used only when the menu holds no `.popmenu__item` — the dials
 * menu is a panel of controls rather than a list of commands, and it still has to receive focus.
 */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function mountPopMenu(
  trigger: HTMLElement,
  menu: HTMLElement,
  options: {
    /** Build the menu's contents. Called on every open, for menus whose items are rebuilt. */
    readonly fill?: () => void
    /** Called after the menu is hidden — for a caller that has its own bookkeeping. */
    readonly onClose?: () => void
    /** What counts as an item to walk between. */
    readonly items?: string
  } = {},
): PopMenu {
  const selector = options.items ?? '.popmenu__item'
  const isOpen = (): boolean => menu.hidden === false

  const itemsIn = (): HTMLElement[] => Array.from(menu.querySelectorAll<HTMLElement>(selector))

  const close = (): void => {
    if (menu.hidden) return
    menu.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    options.onClose?.()
  }

  const open = (): void => {
    options.fill?.()
    menu.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    // The first item, so the menu is usable the instant it appears. A menu that opens without
    // taking focus is reachable only by Tabbing to it from wherever focus happened to be, which
    // for a status-bar control is the far end of the document.
    const first = itemsIn()[0] ?? menu.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
  }

  trigger.addEventListener('click', () => (isOpen() ? close() : open()))

  menu.addEventListener('keydown', (event) => {
    const items = itemsIn()

    // Escape first, and arrows only when there is a list to walk.
    //
    // `go()` called `preventDefault()` before it indexed, so a menu with no `.popmenu__item` —
    // the dials, which hold controls rather than commands — **prevented every arrow key and then
    // did nothing with it**. That is worse than not handling them: a `<select>` or a range input
    // inside such a menu has arrow keys as its native keyboard, and the shared menu was eating
    // the keystroke that operates the control.
    //
    // The `+` menu's behaviour was applied to a menu with no items, and the side effect leaked
    // while the effect did not. `office-space-6c`, on the extraction risk in its exact form, on
    // the one caller I had flagged as the odd one.
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      trigger.focus()
      return
    }
    if (items.length === 0) return

    const here = items.indexOf(document.activeElement as HTMLElement)
    const go = (i: number): void => {
      event.preventDefault()
      items[Math.max(0, Math.min(items.length - 1, i))]?.focus()
    }

    if (event.key === 'ArrowDown') go(here + 1)
    else if (event.key === 'ArrowUp') go(here - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(items.length - 1)
  })

  /**
   * Two `document` listeners per menu, and **nothing removes them**.
   *
   * `PopMenu` has no `destroy()`, deliberately: all three call sites mount at module scope —
   * two in `app.ts` at boot, one inside `mountSwitcher`, which `app.ts` calls once — so this is
   * three menus' worth of listeners for the life of the window, and a teardown nothing calls is
   * the dead code we keep removing.
   *
   * **The condition under which that stops being true is a property of the call sites, not of
   * this module**, which is why it is written here rather than left in somebody's head: if a
   * fourth caller ever mounts inside a rebuild, every redraw adds two more listeners closing
   * over the previous menu element — detached, never able to open again — and this becomes the
   * fourth instance of *the thing that accumulates and nothing prunes*, after `managers`,
   * `recorders` and `autoDecided`. At that point `destroy()` is owed and the caller has to call
   * it. `office-space-6c` found the shape and was right that the safety is circumstantial.
   *
   * `mousedown` rather than `click`, so the menu is down before whatever is behind it receives
   * its own event — otherwise picking something behind it opens that thing underneath a menu
   * that is still up.
   */
  document.addEventListener('mousedown', (event) => {
    if (!isOpen()) return
    const target = event.target as Node
    if (!menu.contains(target) && !trigger.contains(target)) close()
  })

  // Escape from anywhere, not only from inside the menu. Focus may be nowhere in particular —
  // the trigger itself, or the body after a click — and Escape has to mean *out* regardless.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) close()
  })

  return { isOpen, open, close }
}
