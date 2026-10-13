/**
 * Put focus back where it was, and notice when that is nowhere.
 *
 * `watchPanels` remembers `document.activeElement` when a panel opens and focuses it again when
 * the panel closes, because *"a panel that hands focus back to the top of the document makes the
 * next Tab start over"*. It works, and it has one hole: the element it remembered may no longer
 * be able to take focus.
 *
 * The common case is the command palette. Open the task list with ⌘K and the sequence is:
 *
 *     composer            → focus starts somewhere real
 *     ⌘K                  → focus moves to the palette's input
 *     choose an entry     → the panel opens; the remembered element is that input
 *     Escape              → the input is still in the document and inside a hidden subtree,
 *                           so `.focus()` does nothing and focus falls to `<body>`
 *
 * Measured in the running app: `TEXTAREA#composer` → `INPUT#app-palette-input` → `BUTTON#task-close`
 * → **`BODY`**. Every panel reachable from the palette closes onto the floor.
 *
 * ## Asking, rather than predicting
 *
 * The check is *"did focus actually move"* rather than a list of reasons it might not. Detached,
 * hidden, `inert`, `disabled` and `tabindex="-1"` all produce the same silent nothing, and a
 * predicate enumerating them is a predicate that is missing the fifth one.
 *
 * `app.ts` has already paid for the other spelling of this. `firstFocusable` exists because a
 * `querySelector(...) ?? close` matched a **disabled** button, so the `??` never reached the
 * fallback, `.focus()` did nothing, and focus stayed behind the panel. Silently. Same lesson,
 * one layer up: ask the DOM what happened instead of predicting what it will do.
 */

/**
 * Focus `remembered`, and if that did not take, focus `fallback`.
 *
 * Returns what ended up with focus, so a caller can tell the difference between the two — and so
 * a test can, since the interesting case is the one where the first attempt silently fails.
 */
export function restoreFocus(
  remembered: HTMLElement | null,
  fallback: HTMLElement | null,
  active: () => Element | null = () => document.activeElement,
): HTMLElement | null {
  remembered?.focus()
  // `contains`, not identity. A container with `delegatesFocus`, or a `<label>`, moves focus to a
  // descendant — and an identity check would call that a failure and let the fallback **steal**
  // focus from where the browser had correctly put it. `office-space-6c`.
  const landedOn = active()
  if (remembered !== null && landedOn !== null && (landedOn === remembered || remembered.contains(landedOn))) {
    return remembered
  }

  fallback?.focus()
  return active() === fallback ? fallback : null
}
