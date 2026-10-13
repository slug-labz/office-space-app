/**
 * What the theme pill says, and the one fact it was not saying.
 *
 * `ThemeInfo.redistributable` was built in four places, crossed the bridge in every snapshot,
 * and was read by nothing — while its own comment in `theme.ts` said *"the app surfaces this so
 * nobody has to read a licence to know."* The half of that promise about the files is real and
 * enforced by `.gitignore`; the half about the app was made in the comment and nowhere else.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { themeLabel, themeTitle } from '../src/shared/theme-view.js'
import type { ThemeChoice, ThemeInfo } from '../src/shared/ipc.js'

const built: ThemeInfo = { id: 'procedural', name: 'Drawn in code', credit: null, redistributable: true }
const bought: ThemeInfo = { id: 'limezu', name: 'Modern Interiors', credit: 'LimeZu', redistributable: false }
const choice = (t: ThemeInfo, active = false): ThemeChoice => ({ ...t, active })

test('the credit is named, because most licences require it wherever the art is', () => {
  assert.equal(themeLabel(bought), 'Modern Interiors — LimeZu')
  // No dangling separator when there is nothing to attribute — the built-in has no credit
  // because there is nobody to credit, and `Drawn in code — ` would read as a missing value.
  assert.equal(themeLabel(built), 'Drawn in code')
})

test('a pack the user licensed says so, which is the fact that was going unsaid', () => {
  const title = themeTitle(bought, [choice(built), choice(bought, true)])

  assert.match(title, /Switch theme/, 'the control forgot to say what it does')
  // The names, not just the verb. `Switch theme` on its own passed every assertion here until
  // the list was mutated away and nothing went red — saying a control switches something without
  // saying to what is the half a tooltip exists for.
  assert.match(title, /Drawn in code/, 'the tooltip does not say what you would be switching to')
  assert.match(title, /is yours/, 'the ownership fact is missing — this is the bug')
  assert.match(title, /gitignored/, 'says it is theirs without saying what keeps it theirs')
  // Against the licence clause alone, not the whole string. The control half is `Switch theme —
  // Drawn in code, Modern Interiors`, so it already contains the name — and a match against the
  // whole title passed with the name dropped from the sentence that needed it. Caught by
  // mutating the sentence and watching this test stay green, which is the only reason to mutate.
  const licence = title.slice(title.indexOf(' · '))
  assert.match(licence, /Modern Interiors/, 'the licence sentence does not say which pack it is about')
})

test('the built-in says nothing about licences, because there is nothing to say', () => {
  // Every fresh clone has exactly this. A licence sentence here would be noise on the one theme
  // that ships with the project and may be redistributed with it.
  const title = themeTitle(built, [choice(built, true), choice(bought)])

  assert.match(title, /Switch theme/)
  assert.doesNotMatch(title, /is yours|gitignored/, 'the built-in is being described as the user\'s own art')
})

test('one theme is not a choice, and the licence is independent of that', () => {
  // The two facts answer different questions and either can apply without the other: what this
  // control does, and what the art costs you. A user with one bought pack installed has a
  // control that does nothing *and* a licence worth knowing about.
  assert.match(themeTitle(built, [choice(built, true)]), /Install a pack/)
  assert.doesNotMatch(themeTitle(built, [choice(built, true)]), /Switch theme/)

  const alone = themeTitle(bought, [choice(bought, true)])
  assert.match(alone, /Install a pack/, 'the instruction is gone when only one theme is installed')
  assert.match(alone, /is yours/, 'and the ownership fact went with it')
})
