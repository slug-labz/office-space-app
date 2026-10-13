/**
 * Where the keyboard goes when a panel closes.
 *
 * `watchPanels` already remembers `document.activeElement` when a panel opens and focuses it
 * again on close — *"a panel that hands focus back to the top of the document makes the next Tab
 * start over"*. It works, and it has one hole, which is that the remembered element may no longer
 * be able to take focus by the time it is asked to.
 *
 * The command palette is the case. Measured in the running app, opening the task list with ⌘K:
 *
 *     TEXTAREA#composer          focus starts somewhere real
 *     INPUT#app-palette-input    ⌘K moves it — and this is what gets remembered
 *     BUTTON#task-close          the panel opens and takes focus
 *     BODY                       Escape: the input is inside a hidden subtree now, `.focus()`
 *                                does nothing, and the keyboard lands on the floor
 *
 * Every panel reachable from ⌘K closed that way.
 *
 * ## Why the check is "did focus move" and not "can this take focus"
 *
 * Detached, hidden, `inert`, `disabled` and `tabindex="-1"` all produce the same silent nothing,
 * and a predicate enumerating them is one that is missing the fifth. `app.ts` has already paid
 * for the other spelling: `firstFocusable` exists because `querySelector(...) ?? close` matched a
 * **disabled** button, so the `??` never reached the fallback and focus stayed behind the panel.
 *
 * The shim's `focus()` always takes, which is what a real focusable element does — so the failing
 * case is written as an element whose `focus()` is a no-op. That is a fair model of *every* reason
 * above and it is the only one a harness without layout can offer; said plainly rather than
 * implied.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { restoreFocus } from '../src/renderer/views/focus-return.js'

installDom()

/** An element focus does not stick to — hidden, detached, inert, disabled, all look like this. */
function unfocusable(): El {
  const el = document.createElement('button') as unknown as El
  el.focus = () => {}
  return el
}

/** Whatever the harness last focused, since there is no real `document.activeElement` here. */
function tracker(): { active: () => Element | null; el: (tag?: string) => El } {
  let current: El | null = null
  return {
    active: () => current as unknown as Element | null,
    el: (tag = 'button') => {
      const made = document.createElement(tag) as unknown as El
      made.focus = () => {
        current = made
      }
      return made
    },
  }
}

test('focus goes back where it was', () => {
  const t = tracker()
  const remembered = t.el()
  const fallback = t.el('textarea')

  assert.equal(restoreFocus(remembered as unknown as HTMLElement, fallback as unknown as HTMLElement, t.active), remembered)
  assert.equal(t.active(), remembered, 'focus did not return to the element that had it')
})

test('and to where typing goes when it cannot', () => {
  // The finding. A remembered element inside a hidden subtree accepts `.focus()` and does nothing
  // with it, and nothing downstream notices — which is how the keyboard ends up on `<body>`.
  const t = tracker()
  const gone = unfocusable()
  const composer = t.el('textarea')

  const landed = restoreFocus(gone as unknown as HTMLElement, composer as unknown as HTMLElement, t.active)

  assert.equal(
    landed,
    composer,
    'the remembered element silently refused focus and nothing took over, so the keyboard is on ' +
      'the body and the next Tab starts from the top of the document',
  )
  assert.equal(t.active(), composer)
})

test('nothing remembered still lands somewhere', () => {
  // A panel opened with focus nowhere in particular — after a click on the floor, say.
  const t = tracker()
  const composer = t.el('textarea')
  assert.equal(restoreFocus(null, composer as unknown as HTMLElement, t.active), composer)
})

test('and when neither can take it, it says so rather than claiming it landed', () => {
  // Both unfocusable is a real state during teardown. The caller gets `null` — an honest "focus
  // is nowhere" — instead of a reference to an element that does not have it.
  const t = tracker()
  assert.equal(
    restoreFocus(unfocusable() as unknown as HTMLElement, unfocusable() as unknown as HTMLElement, t.active),
    null,
    'a restore that failed twice reported success',
  )
})

test('the fallback is not used when the first attempt worked', () => {
  // The other direction, and the one that would be easy to break by always focusing the fallback
  // afterwards: closing a panel would then dump you in the composer no matter where you were.
  const t = tracker()
  const remembered = t.el()
  let fallbackTouched = false
  const fallback = document.createElement('textarea') as unknown as El
  fallback.focus = () => {
    fallbackTouched = true
  }

  restoreFocus(remembered as unknown as HTMLElement, fallback as unknown as HTMLElement, t.active)

  assert.equal(fallbackTouched, false, 'the fallback ran anyway, so every close lands in the composer')
})

test('a disabled composer is not a fallback, and the caller has to know', () => {
  /**
   * `office-space-6c`, and it is not a corner. `render()` sets
   *
   *     els.composer.disabled = !manager
   *
   * so a workspace with staff and no delegator — the state the `no-manager` lint exists for —
   * has no composer to fall back to. A disabled element cannot take focus, both rungs fail, and
   * the keyboard is on `<body>` at the worst possible moment: the reader is in a broken
   * workspace and has just closed the panel that might have explained it.
   *
   * `null` is the honest answer and the wrong place to stop. The third rung belongs at the call
   * site, because this module's argument is that it asks the DOM rather than enumerating
   * reasons, and a hardcoded target here would be the start of that enumeration.
   */
  const t = tracker()
  const landed = restoreFocus(
    unfocusable() as unknown as HTMLElement,
    unfocusable() as unknown as HTMLElement,
    t.active,
  )
  assert.equal(landed, null, 'a restore where neither rung took focus reported success')
  assert.equal(t.active(), null, 'something was focused after both attempts failed')
})

test('focus that lands on a child of what was asked for still counts', () => {
  // An identity check is too strict: a container with `delegatesFocus`, or a `<label>`, moves
  // focus to a descendant. The fallback would then fire and **steal** focus from where the
  // browser had correctly put it. `office-space-6c`.
  const t = tracker()
  const container = document.createElement('div') as unknown as El
  const child = t.el('input')
  container.appendChild(child)
  // Focusing the container delegates to its child, the way a real one can.
  container.focus = () => child.focus()

  let fallbackTouched = false
  const fallback = document.createElement('textarea') as unknown as El
  fallback.focus = () => {
    fallbackTouched = true
  }

  const landed = restoreFocus(container as unknown as HTMLElement, fallback as unknown as HTMLElement, t.active)

  assert.equal(fallbackTouched, false, 'focus went to a child of the remembered element and the fallback fired anyway')
  assert.equal(landed, container as unknown as HTMLElement, 'delegated focus was reported as a failure')
})

/*
 * The default argument, which is the one that ships.
 *
 * `restoreFocus` takes `active` so a test can control what the DOM reports back — and every test
 * above passes one, so the parameter's **default** has never run. In the app there is no third
 * argument: production reads `document.activeElement`, and that path had no coverage at all.
 *
 * The header of this file says there is no real `document.activeElement` here. There is now —
 * `dom.ts`'s `focus()` sets it, and clears the previous one, so that "which element is focused"
 * is answerable. The harness above pre-dates that and overrides `focus` on every element it
 * makes, which is why the shim's own tracking never runs in these tests.
 *
 * So this one uses plain elements and omits the argument, and it is the only test here that
 * exercises what the app actually calls.
 */
test('with no third argument it reads the real document, which is what the app does', () => {
  const remembered = document.createElement('button') as unknown as El
  const fallback = document.createElement('textarea') as unknown as El

  assert.equal(
    restoreFocus(remembered as unknown as HTMLElement, fallback as unknown as HTMLElement),
    remembered,
    'the default did not see the focus it had just moved',
  )
  assert.equal((document as unknown as { activeElement: El }).activeElement, remembered)

  // And the fallback path, still without a supplied reader.
  const wontTake = unfocusable()
  assert.equal(
    restoreFocus(wontTake as unknown as HTMLElement, fallback as unknown as HTMLElement),
    fallback,
    'focus did not fall through to the fallback',
  )
  assert.equal((document as unknown as { activeElement: El }).activeElement, fallback)
})
