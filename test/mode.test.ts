/**
 * The mode, and the one property that makes it a feature rather than a label.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FIRST_MODE,
  LEGACY_MODE,
  MODES,
  isMode,
  modeBody,
  withheldIn,
  type Mode,
} from '../src/shared/session/mode.js'

test('a new conversation starts in intake', () => {
  // The whole complaint: "even if I say hi, it goes back and starts doing things."
  assert.equal(FIRST_MODE, 'intake')
})

test('a conversation written before modes existed resumes able to work', () => {
  // Absent is not empty, and here absence is a specific past rather than a gap. A session
  // recorded before this feature could already do everything; resuming it into intake would be
  // the app taking tools away that the user never asked it to take away.
  assert.equal(LEGACY_MODE, 'building')
  assert.notEqual(LEGACY_MODE, FIRST_MODE)
})

test('intake withholds delegation — this is the feature, not the wording', () => {
  // Measured against the installed CLI before it was built on: --disallowedTools Task leaves the
  // model unable to find Task at all. `cannot`, not `should not`.
  assert.ok(withheldIn('intake').includes('Task'))
})

test('intake withholds writing too, or the manager just does the work itself', () => {
  // A manager that cannot dispatch but can still edit has not stopped building — it has started
  // doing the work by hand, which manager.md already names as the failure that empties the floor.
  const withheld = withheldIn('intake')
  assert.ok(withheld.includes('Write'))
  assert.ok(withheld.includes('Edit'))
})

test('reading is never withheld, in any mode', () => {
  // Intake exists so the manager can find out. manager.md's own rule is "never ask what you can
  // read"; taking reading away during the asking mode would make the questions worse.
  for (const mode of MODES) {
    const withheld = withheldIn(mode)
    for (const tool of ['Read', 'Grep', 'Glob']) {
      assert.ok(!withheld.includes(tool), `${mode} withholds ${tool}, so it cannot look anything up`)
    }
  }
})

test('building withholds nothing', () => {
  assert.deepEqual(withheldIn('building'), [])
})

test('every mode says what it withholds, and every mode gets a block', () => {
  // Present in every mode, unlike most office blocks. A manager only told about its mode when
  // something is missing learns the block means bad news, and stops reading the one that says
  // "you may now build".
  for (const mode of MODES) {
    const block = modeBody(mode)
    // The body names its own mode in the first line. `blocks.ts` supplies the `## MODE` heading,
    // so the body has to say *which* mode or the block is a heading over unattributed prose.
    assert.match(block, new RegExp(`^\\*\\*${mode}\\*\\*`), `${mode} does not name itself first`)
    for (const tool of withheldIn(mode)) {
      assert.ok(
        block.includes(tool),
        `${mode} withholds ${tool} and never says so — the manager finds out by reaching for it`,
      )
    }
  }
})

test('intake tells the manager it does not end the mode itself', () => {
  // The one sentence that stops this being the one-shot it replaces. A mode the manager could
  // leave when it felt ready is "ask two questions then build" wearing a state machine.
  assert.match(modeBody('intake'), /you do not end this mode/i)
})

test('isMode refuses anything that is not one', () => {
  // It guards the registry, where the value arrives as whatever was on disk.
  for (const mode of MODES) assert.ok(isMode(mode))
  for (const junk of ['', 'Intake', 'idle', null, undefined, 0, {}]) assert.ok(!isMode(junk))
})

test('withheldIn is total over Mode', () => {
  // The compiler enforces the switch is exhaustive; this catches a mode added to MODES and not
  // to the switch, which typechecks fine and returns undefined at runtime.
  for (const mode of MODES) {
    assert.ok(Array.isArray(withheldIn(mode)), `${mode} has no entry in withheldIn`)
    assert.equal(typeof modeBody(mode), 'string', `${mode} has no entry in modeBody`)
  }
})

test('an unknown mode does not silently become a permissive one', () => {
  // Defence in depth against a registry hand-edited to a mode we removed. Falling through to
  // "withhold nothing" would turn a typo into a manager with every tool.
  const bogus = 'planning-v2' as Mode
  assert.ok(!isMode(bogus), 'isMode is the guard that stops this reaching withheldIn')
})
