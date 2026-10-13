/**
 * `active` is a project. `activeSession` is a conversation. Both are strings.
 *
 * That has been confused twice, in the two places it does the most damage:
 *
 * - **`ModeChange.sessionId`** — mode changes were filtered on the project alone, so the office
 *   changing mode repainted whichever conversation you were looking at, and handed an employee's
 *   floor a `conversing` fact from a conversation nobody was watching.
 * - **the activity strip** — `feed()` wrote under the session id and `drawStrip()` read under the
 *   project, so the Running zone never showed anybody and the Happened log stayed empty for the
 *   life of the app.
 *
 * Both compiled. Both produced a screen quietly about the wrong conversation. Neither was going to
 * be caught by a type checker, because `Map<string, …>` takes either one and `office.workOf(a, b)`
 * takes two strings.
 *
 * ## Why this one can be a test
 *
 * `OfficeApi` names its own parameters. A method whose first parameter is `project: string` is
 * documentation of what belongs there, written by the person who wrote the method — so a call
 * passing `activeSession` into it is checkable without inference, and so is the reverse.
 *
 * It reads literal call sites only. A project id held in a local, passed through a helper, or
 * built at runtime is out of reach — which is a limit of the check, not a licence.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ipc = readFileSync(join(root, 'src/shared/ipc.ts'), 'utf8')
const app = readFileSync(join(root, 'src/renderer/app.ts'), 'utf8')

/** Each `OfficeApi` method, and what it calls its first parameter. */
const firstParameter = new Map<string, string>()
{
  const body = /export interface OfficeApi \{\n([\s\S]*?)\n\}/.exec(ipc)?.[1]
  assert.ok(body, 'OfficeApi is not where this test expects it')
  for (const m of body.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\((.*?)\)/gm)) {
    firstParameter.set(m[1]!, (m[2] ?? '').split(',')[0]?.trim() ?? '')
  }
  assert.ok(firstParameter.size > 20, `parsed only ${firstParameter.size} methods — the interface moved`)
}

const callsWith = (variable: string): { method: string; parameter: string }[] =>
  [...app.matchAll(new RegExp(`office\\.(\\w+)\\(\\s*${variable}\\b`, 'g'))]
    .map((m) => ({ method: m[1]!, parameter: firstParameter.get(m[1]!) ?? '(not on OfficeApi)' }))

test('nothing hands a project to a method that asked for a session', () => {
  const wrong = callsWith('active')
    .filter(({ parameter }) => !/project/i.test(parameter))
    .map(({ method, parameter }) => `office.${method}(active) — its first parameter is \`${parameter}\``)

  assert.deepEqual(wrong, [], '`active` is the project; these methods asked for something else')
})

test('nothing hands a session to a method that asked for a project', () => {
  const wrong = callsWith('activeSession')
    .filter(({ parameter }) => !/session|id\b/i.test(parameter))
    .map(({ method, parameter }) => `office.${method}(activeSession) — its first parameter is \`${parameter}\``)

  assert.deepEqual(wrong, [], '`activeSession` is a conversation; these methods asked for a project')
})

test('the check is actually looking at something', () => {
  // Both lists being empty because the pattern stopped matching would read exactly like both
  // lists being empty because the code is right — which is the failure this repository has paid
  // for more than once.
  assert.ok(callsWith('active').length > 10, `found only ${callsWith('active').length} call sites — the pattern moved`)
})
