/**
 * Which control in a panel should take focus when the panel opens.
 *
 * `watchPanels` in `app.ts` moves focus into a panel the moment it opens, so that Tab walks the
 * panel rather than the app behind it. It chose the target like this:
 *
 *     const first = open.querySelector('input, textarea, [href], button:not(.card__close)')
 *     ;(first ?? open.querySelector('.card__close'))?.focus()
 *
 * Read as prose that is right: the first thing you can act on, and the close button as a floor.
 * What it actually does is take the first element the **selector matches**, which is not the same
 * as the first element that can take focus — and `.focus()` on a disabled control does nothing at
 * all, silently.
 *
 * Measured in the running app. Open the task list on the office conversation, where there is no
 * project and so nothing to check: the panel holds `×` and a disabled "Check everything allowed".
 * `querySelector` returns the disabled button, `first` is non-null, so the `??` never reaches the
 * close button, `.focus()` is a no-op, and focus stays on the composer behind the panel. No
 * error, no focus event, nothing to see. The roster does the same thing correctly, because its
 * first button happens to be enabled.
 *
 * The bug is the fourth standing order one level up: `querySelector` found something, and
 * something that cannot do the job is not the same as something that can. A floor that is only
 * reached when nothing was *found* is not a floor — it has to be reached when nothing found can
 * take focus.
 *
 * ## Why this is a list and not a DOM walk
 *
 * So it can be tested. `app.ts` cannot be loaded by a test — top-level side effects, and it needs
 * a `window.office` — which is exactly why the bug lived there; and `test/dom.ts` returns a
 * zero-sized rect for everything on purpose, so a check written against geometry would be true
 * only of the shim. What is left is the part that is actually a decision, over plain objects.
 *
 * ## What this deliberately does not check
 *
 * Only `hidden` and `disabled`. A control made unfocusable some other way — `display: none` from
 * a class rather than the attribute, an `inert` ancestor, `visibility: hidden` — still gets past
 * this, and finding that out needs a browser. Both of the real cases are covered and the rest is
 * written down rather than implied, because a helper that claims to know what is focusable would
 * be trusted for cases it has never seen.
 */

/** The two ways a control in these panels is unable to take focus. */
export interface Focusable {
  readonly hidden: boolean
  /** Only form controls have one; everything else is `undefined`, which is not disabled. */
  readonly disabled?: boolean | undefined
}

/**
 * Whether `.focus()` on this would do anything.
 *
 * `disabled === undefined` is not disabled — a `div` or an anchor has no such property, and
 * treating a missing field as true would make every non-form control unfocusable.
 */
export function canTakeFocus(el: Focusable): boolean {
  return !el.hidden && el.disabled !== true
}

/**
 * The first candidate that can actually take focus, falling back to the close button.
 *
 * The fallback is checked too. A panel whose close button is itself hidden has nothing to give
 * focus to, and saying so — `null` — lets the caller leave focus where it was rather than call
 * `.focus()` into the void and believe it worked.
 */
export function firstFocusable<T extends Focusable>(
  candidates: readonly T[],
  fallback: T | null,
): T | null {
  for (const candidate of candidates) {
    if (canTakeFocus(candidate)) return candidate
  }
  return fallback !== null && canTakeFocus(fallback) ? fallback : null
}
