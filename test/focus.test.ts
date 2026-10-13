/**
 * Which control takes focus when a panel opens — the decision, not the DOM walk.
 *
 * The bug this covers shipped and was invisible: opening the task list on the office
 * conversation left focus on the composer *behind* the panel, so Tab walked the app underneath
 * a panel that was covering it. Measured in the running app over CDP; there was no error, no
 * focus event, and nothing on screen to see.
 *
 * The cause is one `??`. `watchPanels` asked `querySelector` for the first thing you can act on
 * and used the close button as a floor:
 *
 *     const first = open.querySelector('input, textarea, [href], button:not(.card__close)')
 *     ;(first ?? open.querySelector('.card__close'))?.focus()
 *
 * On that panel `first` is a **disabled** "Check everything allowed" — there is no project, so
 * there is nothing to check. It is non-null, so the floor is never reached; and `.focus()` on a
 * disabled control does nothing at all. The roster panel does the same thing correctly, purely
 * because its first button happens to be enabled, which is why this looked like it worked.
 *
 * Fourth standing order, one level up: `querySelector` found something, and something that
 * cannot do the job is not the same as something that can. A floor reached only when nothing was
 * *found* is not a floor — it has to be reached when nothing found can take focus.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { canTakeFocus, firstFocusable, type Focusable } from '../src/shared/focus.js'

/** A control, named so a failure says which one was chosen. */
const control = (name: string, over: Partial<Focusable> = {}): Focusable & { name: string } => ({
  name,
  hidden: false,
  ...over,
})

test('a disabled first candidate does not swallow the fallback', () => {
  // The exact panel that shipped broken: a disabled action, and a close button behind it.
  const action = control('Check everything allowed', { disabled: true })
  const close = control('×')

  assert.equal(
    firstFocusable([action], close)?.name,
    '×',
    'the close button is the floor, and a disabled candidate must not stop it being reached — ' +
      'this is the bug: `first ?? close` keeps a non-null disabled element and focus stays ' +
      'outside the panel entirely',
  )
})

test('the first candidate that can take focus wins, not the first that matches', () => {
  const chosen = firstFocusable(
    [
      control('a disabled input', { disabled: true }),
      control('a hidden button', { hidden: true }),
      control('the real one'),
      control('a later one'),
    ],
    control('×'),
  )
  assert.equal(chosen?.name, 'the real one')
})

test('an enabled first candidate is still preferred over the close button', () => {
  // The behaviour that already worked, kept. The roster opens onto its first action, not onto ×.
  assert.equal(firstFocusable([control('Send home'), control('Fire')], control('×'))?.name, 'Send home')
})

test('a panel with nothing focusable says so rather than pretending', () => {
  assert.equal(
    firstFocusable([control('disabled', { disabled: true })], control('×', { hidden: true })),
    null,
    'when the fallback cannot take focus either, the answer is null — calling .focus() into the ' +
      'void and believing it worked is how the original bug stayed invisible',
  )
  assert.equal(firstFocusable([], null), null)
})

test('a missing `disabled` is not a disabled control', () => {
  // Anchors and divs have no `disabled` property. Treating undefined as true would make every
  // non-form control unfocusable, which would move focus to the close button on every panel.
  assert.equal(canTakeFocus({ hidden: false }), true)
  assert.equal(canTakeFocus({ hidden: false, disabled: undefined }), true)
  assert.equal(canTakeFocus({ hidden: false, disabled: false }), true)
  assert.equal(canTakeFocus({ hidden: false, disabled: true }), false)
  assert.equal(canTakeFocus({ hidden: true }), false)
})
