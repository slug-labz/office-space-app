/**
 * A `.claude/settings.json` that is JSON but not an object runs no gate, and the office says so.
 *
 * `null`, `[]`, `"x"`, `42`, `true` and `false` all parse. `gateState` looked in them for a
 * stanza, found none, and answered `not-wired`, which tells somebody to add the gate to a file
 * whose problem is its top level.
 *
 * Claude Code doesn't use such a file at all. Its settings loader (2.1.266's `AHe`, read from
 * the installed binary) runs the settings schema on each user, project or local file and drops
 * the whole file when the check fails, and a top level that isn't an object always fails. The
 * settings page files that under Settings Error, and `claude --help` says print mode silently
 * ignores a settings file that fails validation.
 *
 * So the office can tell: nothing in the file runs, the gate included. That is `settings-skipped`,
 * blocked like the other "no gate" answers, with the file's actual problem in place of a stanza to
 * add. It is not `unreadable` ("we could not tell"), which is a warning somebody can dismiss.
 *
 * #246 made `readPolicy` refuse such a file for permission rules.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { gateLede, gateState, type FileRead } from '../src/shared/gate.js'
import { diagnose, type FirstRunState } from '../src/shared/first-run.js'
import { readGate } from '../src/main/instructions.js'
import { tempDir } from './temp-dir.js'

const hookThere: FileRead = { state: 'present', text: '#!/usr/bin/env node\n' }
const hookGone: FileRead = { state: 'absent' }
const present = (text: string): FileRead => ({ state: 'present', text })

for (const [text, shape] of [
  ['null', 'null'],
  ['[]', 'an array'],
  ['"x"', 'a string'],
  ['42', 'a number'],
  ['true', 'true'],
  ['false', 'false'],
] as const) {
  test(`settings whose top level is ${text} run no gate, and say why`, () => {
    const verdict = gateState(present(text), hookThere)
    assert.equal(verdict.state, 'settings-skipped')
    const cause = verdict.state === 'settings-skipped' ? verdict.cause : ''
    assert.ok(cause.includes(`its top level is ${shape}, not an object`), `the cause does not say what the top level is: ${cause}`)
  })
}

test('the top level is judged before the hook file, as a parse error is', () => {
  // With the hook gone as well, the answer is still about the settings. Nothing was read from them
  // that could claim a gate, so "hook-missing" would be a confident answer from a file that said
  // nothing.
  assert.equal(gateState(present('[]'), hookGone).state, 'settings-skipped')
})

test('the panel names the file, says Claude Code skips it, and keeps the hedge', () => {
  const said = gateLede(gateState(present('null'), hookThere)) ?? ''
  assert.match(said, /\.claude\/settings\.json is JSON, but its top level is null/)
  assert.match(said, /Claude Code skips the whole file/)
  // The office reads only this file; another settings file could still run the gate.
  assert.match(said, /Unless another settings file runs the gate/)
  assert.match(said, /never asked to approve a shell command before it runs/)
})

test('first run blocks on it, and says to fix the file rather than restore the gate', () => {
  const state: FirstRunState = {
    claudePath: '/usr/local/bin/claude',
    claudeProblem: null,
    staffCount: 7,
    projectCount: 2,
    canCreateProject: true,
    canAddTemplate: true,
    instructions: 'present',
    gate: gateState(present('[]'), hookThere),
    permissionsInForce: true,
    quarantinedApp: null,
    unreadable: [],
    problems: [],
  }
  const said = diagnose(state).find((s) => s.id === 'gate-settings-skipped')
  assert.ok(said, 'a skipped settings file was not reported at all')
  assert.equal(said.severity, 'blocked', 'a file Claude Code skips was raised as something to dismiss')
  assert.match(said.title, /without the approval gate/)
  assert.match(said.detail, /its top level is an array/)
  assert.match(said.detail, /top level is an object/)
  assert.doesNotMatch(said.detail, /two files/)
})

test('readGate gives the same answer for a real file', async (t) => {
  // Through the read, with the hook on disk, so nothing about the verdict comes from a missing half.
  const root = await tempDir(t, 'office-gate-top-level-')
  await mkdir(join(root, '.claude', 'hooks'), { recursive: true })
  await writeFile(join(root, '.claude', 'hooks', 'approval-gate.mjs'), '#!/usr/bin/env node\n')
  await writeFile(join(root, '.claude', 'settings.json'), '[]\n')
  const verdict = await readGate(root)
  assert.equal(verdict.state, 'settings-skipped')
})
