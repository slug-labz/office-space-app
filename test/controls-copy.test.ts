/**
 * What the dials say, and the two ways this file rots.
 *
 * The pickers exist to answer a question a flag name cannot: what does `acceptEdits` actually
 * do to my repository. That answer lives in `control-copy.ts` as data, so the two failures worth
 * guarding are **an option that loses its sentence** and **an option that has no sentence
 * because somebody added it to `controls.ts` and not here** — both of which put a bare flag name
 * back in front of a person, silently, in the control that decides whether an agent may write.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  choicesFor,
  isGrave,
  triggerLabel,
  EFFORT_CHOICES,
  MODEL_CHOICES,
  PERMISSION_CHOICES,
} from '../src/shared/control-copy.js'
import { EFFORTS, MODELS, OFFERED_PERMISSION_MODES, PERMISSION_MODES } from '../src/shared/controls.js'

test('every value the CLI accepts has something written about it', () => {
  // The drift this catches: a mode added to `controls.ts` when the CLI gains one, and not here.
  // It would appear in the picker with an empty description, which is worse than the native
  // select we replaced — that at least showed the name without a blank line under it.
  const covered = (choices: readonly { value: string }[]) => new Set(choices.map((c) => c.value))

  assert.deepEqual([...covered(MODEL_CHOICES)].sort(), [...MODELS].sort())
  assert.deepEqual([...covered(EFFORT_CHOICES)].sort(), [...EFFORT_CHOICES].map((c) => c.value).sort())
  for (const effort of EFFORTS) {
    assert.ok(covered(EFFORT_CHOICES).has(effort), `no copy for effort "${effort}"`)
  }
  for (const mode of OFFERED_PERMISSION_MODES) {
    assert.ok(covered(PERMISSION_CHOICES).has(mode), `no copy for permission mode "${mode}"`)
  }
})

test('nothing is offered that the CLI would silently ignore', () => {
  // `manual` and `auto` are accepted by the CLI under `--print` and then resolved to `default`.
  // Describing them here would be describing a mode the session is not in.
  const offered = new Set(PERMISSION_CHOICES.map((c) => c.value))
  for (const mode of PERMISSION_MODES) {
    if (OFFERED_PERMISSION_MODES.includes(mode)) continue
    assert.equal(offered.has(mode), false, `"${mode}" is described but the CLI ignores it under --print`)
  }
})

test('every description is a sentence about what happens, not a restatement of the name', () => {
  for (const key of ['model', 'effort', 'permissionMode'] as const) {
    for (const choice of choicesFor(key)) {
      assert.ok(choice.detail.length > 20, `${choice.value} has no real description`)
      // A description that is just the label again teaches nothing, and is the shape this file
      // decays into when somebody adds an option in a hurry.
      assert.notEqual(choice.detail.toLowerCase().replace(/\W/g, ''), choice.value.toLowerCase())
      assert.match(choice.detail, /\.$/, `${choice.value}: descriptions are sentences and end in a full stop`)
    }
  }
})

test('exactly one choice is marked as carrying consequences', () => {
  // `bypassPermissions` removes the question before almost any command the rules do not stop.
  // Marking several things grave marks nothing; marking none presents a decision as a preference.
  const grave = PERMISSION_CHOICES.filter((c) => isGrave(c.value))
  assert.deepEqual(
    grave.map((c) => c.value),
    ['bypassPermissions'],
  )
  assert.equal(MODEL_CHOICES.some((c) => isGrave(c.value)), false)
})

test('the closed picker says which dial it is when nothing is set', () => {
  // Three pickers all reading "default" is three words of chrome saying nothing about the turn
  // about to be sent. Unset, each says its own name; set, each says its value.
  assert.equal(triggerLabel('model', 'default'), 'model')
  assert.equal(triggerLabel('effort', 'default'), 'effort')
  assert.equal(triggerLabel('permissionMode', 'default'), 'permissions')

  assert.equal(triggerLabel('model', 'opus'), 'opus')
  assert.equal(triggerLabel('effort', 'high'), 'high')
  // The label, not the flag — the picker shows what a person reads, and `argsFor` sends the
  // value. Those being different is the point of having both fields.
  assert.equal(triggerLabel('permissionMode', 'acceptEdits'), 'accept edits')
  assert.equal(triggerLabel('permissionMode', 'bypassPermissions'), 'bypass permissions')
})

test('a value from a newer CLI falls back to itself rather than to nothing', () => {
  // A workspace whose settings name a mode this build has never heard of. Showing the raw value
  // is right — the session is running it — and showing an empty trigger would not be.
  assert.equal(triggerLabel('permissionMode', 'someFutureMode'), 'someFutureMode')
})
