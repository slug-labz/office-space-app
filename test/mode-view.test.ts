/**
 * The control that ends intake, and the copy that decides whether it works.
 *
 * The requirement: saying hi must not send the manager off building — it stays in intake until
 * the person has agreed that the full vision is shared.
 *
 * Laptop 2 built the enforcement — intake withholds `Task`, `Write` and `Edit` from the CLI — and
 * `session/mode.ts` says why in one line worth keeping in front of anyone editing this file:
 * *"The person, never the model. A mode the manager could leave when it felt ready is the
 * one-shot again, wearing a state machine as a costume."*
 *
 * That makes the copy load-bearing rather than decorative, so it is asserted. A label that reads
 * as an instruction to the manager puts the decision back with the manager, which is the exact
 * thing the mode exists to take away — and it would look completely fine in a diff.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MODES, type Mode } from '../src/shared/session/mode.js'
import type { ModeChange } from '../src/shared/ipc.js'
import { changeIsForHere, modeAnnouncement, modeChrome } from '../src/shared/mode-view.js'

test('every mode is drawable, and building is the one that says nothing', () => {
  for (const mode of MODES) {
    const chrome = modeChrome(mode)
    if (mode === 'building') {
      // The resting state. A banner that is always on screen is furniture — it stops being read
      // within a day, and the two modes that do need saying would inherit that indifference.
      assert.equal(chrome.shown, false, 'building should say nothing')
      assert.equal(chrome.action, null)
      continue
    }
    assert.equal(chrome.shown, true, `${mode} must say what it is`)
    assert.notEqual(chrome.lede, '', `${mode} has no lede`)
    assert.notEqual(chrome.detail, '', `${mode} does not say what is withheld or happening`)
  }
})

test('every mode that shows a control names where the control goes', () => {
  // A button with no destination is a button that cannot be wired, and the wiring reads `next`
  // out of the DOM — so a null here would be a control that silently does nothing.
  for (const mode of MODES) {
    const chrome = modeChrome(mode)
    if (chrome.action === null) continue
    assert.notEqual(chrome.next, null, `${mode} offers "${chrome.action}" and goes nowhere`)
    assert.notEqual(chrome.next, mode, `${mode}'s control moves it to itself`)
  }
})

test('the modes lead to building, and nothing loops', () => {
  // Following the controls from the first mode must terminate. A cycle would be a conversation
  // that can never build, which is the opposite of the complaint this feature answers.
  let mode: Mode = 'intake'
  const seen = new Set<Mode>()
  for (let i = 0; i < MODES.length + 1; i++) {
    assert.equal(seen.has(mode), false, `looped back to ${mode}`)
    seen.add(mode)
    const next: Mode | null = modeChrome(mode).next
    if (next === null) break
    mode = next
  }
  assert.equal(mode, 'building', 'following the controls does not reach building')
})

test('the label is the person\'s sentence, never an instruction to the manager', () => {
  // The whole feature is that the model cannot end the mode. A label in the imperative aimed at
  // the office — "tell it to start", "let it begin" — reads as asking the manager to agree, and
  // hands back the decision the mode exists to take away.
  const intake = modeChrome('intake')
  assert.ok(intake.action !== null)
  assert.doesNotMatch(
    intake.action,
    /\b(tell|ask|let|allow|permit)\b/i,
    `"${intake.action}" addresses the manager rather than stating what the person has done`,
  )
  // And it says what the person is asserting, not what the office will do next.
  assert.match(intake.action, /vision/i)
})

test('intake says what is withheld, because a wall you were warned about is a rule', () => {
  // An agent that discovers a missing tool by reaching for it spends the turn confused. A person
  // who does not know why nothing is happening assumes the app is broken. Both are answered by
  // one sentence up front, and `session/mode.ts` makes the same argument to the model.
  const { detail } = modeChrome('intake')
  assert.match(detail, /dispatch/i)
  assert.match(detail, /files/i)
})

test('a mode that did not move announces nothing, and only intake ending interrupts', () => {
  for (const mode of MODES) {
    assert.equal(modeAnnouncement(mode, mode), null, `${mode} to itself is not news`)
  }
  // `from` is used rather than ignored: "intake just ended" and "a new conversation opened in
  // planning" are different facts, and only the first is worth interrupting anybody with.
  assert.notEqual(modeAnnouncement('intake', 'planning'), null)
  assert.equal(modeAnnouncement('building', 'planning'), null)
})

/**
 * The way back.
 *
 * Reported: once planning and building start, there is no stop button at all. Moving a
 * conversation on was a one-way door, which made pressing it a commitment
 * rather than a step. The mode is supposed to belong to the person — and a door that only opens
 * one way is owned by whoever is on the other side of it.
 */
test('a mode with a way back has words on the button', () => {
  // `app.ts` drives the button from two fields — `textContent = chrome.back ?? ''` and
  // `hidden = chrome.previous === null`. A mode with `previous` set and `back` forgotten is a
  // visible button with no words in it: nothing for a screen reader to announce, and a blank
  // pill for everybody else. All three modes pair correctly today, by consistent authorship
  // rather than by anything checking, and the test below asks about `previous` alone.
  //
  // Both directions. `back` without `previous` is the quieter half — a label written for a
  // button that stays hidden, which reads as a working way back when there is none.
  // `back?.trim()` rather than `back === null`, because the failure this comment describes is a
  // button with *no words in it* and `''` is that button. `back: ''` with `previous: 'intake'`
  // is `false === false` under the first version, which passed — the test did not cover the case
  // it was written from. A sibling below happens to catch it today by pinning the three exact
  // strings, so a fourth mode would have no cover at all.
  for (const mode of MODES) {
    const { back, previous } = modeChrome(mode)
    assert.equal(
      !back?.trim(),
      previous === null,
      `${mode} has ${!back?.trim() ? 'a way back with no words on it' : 'a label for a way back it does not have'} ` +
        `— back: ${JSON.stringify(back)}, previous: ${JSON.stringify(previous)}`,
    )
  }
})

test('every mode you can get to, you can get back from', () => {
  assert.equal(modeChrome('planning').previous, 'intake')
  assert.equal(modeChrome('building').previous, 'planning')
  // Intake is where a conversation starts. There is nowhere behind it, and a control offering to
  // go there would be a control that does nothing.
  assert.equal(modeChrome('intake').previous, null)
  assert.equal(modeChrome('intake').back, null)
})

test('the way back is labelled with where it goes, not with what it undoes', () => {
  // "Cancel" and "Undo" describe the button's relationship to the last press. A person reading
  // this is deciding where to be, not regretting a click.
  assert.equal(modeChrome('planning').back, 'Back to listening')
  assert.equal(modeChrome('building').back, 'Back to planning')
})

test('building has a way back even though it has no banner', () => {
  // The banner is hidden because building is the ordinary state and a permanent bar saying
  // "nothing is withheld" earns nothing. That is a reason to hide a sentence, not to trap
  // somebody in a mode.
  const building = modeChrome('building')
  assert.equal(building.shown, false)
  assert.equal(building.previous, 'planning')
})

// ──────────────────────────────────── which conversation a mode change belongs to ──

/*
 * A project is not a session but *a group* of them.
 *
 * The renderer used to accept a mode change on the project alone. That was right for exactly as
 * long as a project meant one conversation, and wrong from the moment "Talk to them directly"
 * shipped — it opens an employee's own conversation in the same project and makes it active.
 *
 * The damage was not only cosmetic. `showMode` hands the floor a `conversing` fact keyed by the
 * *shown* session, and scenes are per conversation, so the reviewer's floor moved because the
 * manager changed mode in a conversation nobody was watching.
 *
 * `ModeChange.sessionId` was on the wire the whole time, built deliberately in main, read by
 * nothing. Found by `scripts/unread-fields.mjs`.
 */

const change = (over: Partial<ModeChange> = {}): ModeChange => ({
  project: 'billing',
  sessionId: 'sess-office',
  from: 'intake',
  to: 'building',
  ...over,
})

test('a change for the conversation on screen is applied', () => {
  assert.equal(changeIsForHere(change(), 'billing', 'sess-office'), true)
})

test("another conversation in the SAME project does not repaint this one", () => {
  // The bug, exactly: you are talking to the reviewer; the office moves from intake to building.
  // Same project, different conversation.
  assert.equal(
    changeIsForHere(change({ sessionId: 'sess-office' }), 'billing', 'sess-reviewer'),
    false,
    "the office's mode must not reach an employee's floor",
  )
})

test('a different project is still refused, as it always was', () => {
  assert.equal(changeIsForHere(change(), 'payments', 'sess-office'), false)
})

test('both have to match — neither check alone is enough', () => {
  assert.equal(changeIsForHere(change(), 'payments', 'sess-reviewer'), false)
})

test('before any conversation is open, nothing is applied', () => {
  // `activeSession` is '' until the first session opens. Letting a change through would apply a
  // fact to a scene keyed by the empty string — a floor for a conversation that does not exist.
  assert.equal(changeIsForHere(change(), 'billing', ''), false)
})

test('the office project is a project like any other, not a wildcard', () => {
  // `OFFICE_PROJECT` is the empty string, so a project comparison that treated falsy as "any"
  // would make every change match while the office tab is open.
  assert.equal(changeIsForHere(change({ project: '' }), '', 'sess-office'), true)
  assert.equal(changeIsForHere(change({ project: 'billing' }), '', 'sess-office'), false)
})
