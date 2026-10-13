/**
 * `"disableAllHooks": true` switches the approval gate off, and the office said nothing about it.
 *
 * Claude Code documents the key as a boolean that turns hooks off. Set in any settings file but
 * managed settings, it disables user, project, local and plugin hooks, so a gate wired in any of
 * those does not run, while hooks from managed settings keep running. Its value is settled by
 * settings precedence like any other key: managed, the command line,
 * `.claude/settings.local.json`, `.claude/settings.json`, then the user's own file. (Settings
 * reference, `disableAllHooks`, and the settings precedence list; both read 2026-09-16.)
 *
 * `gateState` never read the key. The shipped stanza, the hook on disk and the switch set to
 * `true` was judged `wired`, which is the one state `gateLede` answers with `null`. The first-run
 * panel stayed quiet while no shell command was ever held, and quiet on that panel reads as
 * "you are protected".
 *
 * The office passes no `--settings` to `claude`, so for its runs only
 * `.claude/settings.local.json` and managed settings sit above the project file, and the office
 * reads neither. The sentence names both rather than claiming to know what they say.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { gateLede, gateState, type FileRead } from '../src/shared/gate.js'

const HOOK = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/approval-gate.mjs"'
const WIRED = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: HOOK }] }] }
/** Names the gate with a matcher no RegExp accepts, which is `unreadable` on its own. */
const EXOTIC = { PreToolUse: [{ matcher: '(', hooks: [{ type: 'command', command: HOOK }] }] }

const file = (settings: object): FileRead => ({ state: 'present', text: JSON.stringify(settings) })
const hookThere: FileRead = { state: 'present', text: '#!/usr/bin/env node\n' }
const hookGone: FileRead = { state: 'absent' }

test('the shipped settings with hooks switched off are not a gate', () => {
  // The real file, so the stanza is the one this repo installs. Unchanged it is wired, which makes
  // the switch the only difference between the two verdicts below.
  const shipped = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8')) as object
  assert.deepEqual(gateState(file(shipped), hookThere), { state: 'wired' }, 'the shipped settings no longer wire the gate, so this test went blind')
  assert.deepEqual(gateState(file({ ...shipped, disableAllHooks: true }), hookThere), { state: 'hooks-off' })
})

/*
 * The switch is read before the stanza, because it decides whether any stanza runs. Each of these
 * files has another answer without it, and the fix that answer points to (add the stanza, put the
 * hook back, rewrite the matcher) changes nothing while hooks are off. Nor is a gate wired in the
 * user's or the local settings file a way out: the switch turns those hooks off as well.
 */
for (const [what, hooks, hook, without] of [
  ['with no stanza at all', {}, hookThere, 'not-wired'],
  ['with the hook file gone', WIRED, hookGone, 'hook-missing'],
  ['with a matcher nothing can read', EXOTIC, hookThere, 'unreadable'],
] as const) {
  test(`hooks switched off is the answer ${what}`, () => {
    assert.equal(gateState(file({ hooks }), hook).state, without, 'precondition: without the switch this file has another answer')
    assert.deepEqual(gateState(file({ hooks, disableAllHooks: true }), hook), { state: 'hooks-off' })
  })
}

test('disableAllHooks set to false leaves a wired gate wired', () => {
  // Documented as "hooks ... run". It is also how a project overrides a `true` in the user's own
  // settings, so it must not be read as a warning.
  assert.deepEqual(gateState(file({ hooks: WIRED, disableAllHooks: false }), hookThere), { state: 'wired' })
})

/*
 * The key is a boolean. The settings page ("Fix a broken settings file") files a value the schema
 * rejects under Settings Error, and says a `-p` run, which is how this office runs `claude`, skips
 * the broken file or values and carries on with the rest; `claude --help` says print mode ignores
 * a settings file that fails validation. Nothing coerces the value, then. If the file is skipped,
 * the gate never loads; if only the value is, the gate runs. Either way the value cannot vouch for
 * a gate, so it is `unreadable`: a reason to go and look, with no claim that the gate is gone.
 * `null` is here because it is easy to read as "not set" when the key is in fact set.
 *
 * The cause names the value's shape rather than printing it, so a long value cannot turn the
 * sentence into the file, and a number too large for a double still reads as a number.
 */
for (const [value, shape] of [['true', 'a string'], [1, 'a number'], [null, 'null'], [{}, 'an object'], [[], 'an array']] as const) {
  test(`disableAllHooks set to ${JSON.stringify(value)} does not leave a gate reported as wired`, () => {
    const verdict = gateState(file({ hooks: WIRED, disableAllHooks: value }), hookThere)
    assert.equal(verdict.state, 'unreadable')
    const cause = verdict.state === 'unreadable' ? verdict.cause : ''
    assert.ok(cause.includes(`disableAllHooks to ${shape}`), `the cause does not name the key and the shape: ${cause}`)
  })
}

test('a long value is described, not printed', () => {
  const verdict = gateState(file({ hooks: WIRED, disableAllHooks: Array.from({ length: 5000 }, (_, i) => i) }), hookThere)
  const cause = verdict.state === 'unreadable' ? verdict.cause : ''
  assert.ok(cause.includes('disableAllHooks to an array'), cause.slice(0, 120))
  assert.ok(cause.length < 400, `the cause is ${cause.length} characters long`)
})

test('a number too large for a double is still described as a number', () => {
  // JSON.parse reads 1e400 as Infinity, and JSON.stringify writes Infinity as null.
  const text = `{"hooks": ${JSON.stringify(WIRED)}, "disableAllHooks": 1e400}`
  const verdict = gateState({ state: 'present', text }, hookThere)
  const cause = verdict.state === 'unreadable' ? verdict.cause : ''
  assert.ok(cause.includes('disableAllHooks to a number'), cause)
})

/*
 * An unreadable value only stands between a file and `wired`. It never replaces an answer that is
 * already "no gate": that answer is true whatever the value means, and it is the more useful of
 * the two.
 */
test('a value nothing can read does not hide a missing stanza', () => {
  assert.deepEqual(gateState(file({ disableAllHooks: 'true' }), hookThere), { state: 'not-wired' })
})

test('a value nothing can read does not hide a missing hook', () => {
  assert.deepEqual(gateState(file({ hooks: WIRED, disableAllHooks: 'true' }), hookGone), { state: 'hook-missing' })
})

test('a settings file that is JSON null is judged before the switch is read', () => {
  // It parses, and there is no key to read on it. Claude Code skips such a file whole, so it is
  // answered before `disableAllHooks` is looked for; the read never sees `null`.
  assert.equal(gateState({ state: 'present', text: 'null' }, hookThere).state, 'settings-skipped')
})

test('hooks switched off has its own sentence, naming the key and what can turn hooks back on', () => {
  const said = gateLede({ state: 'hooks-off' })
  assert.notEqual(said, null, 'a gate switched off went unannounced')
  const text = said ?? ''
  assert.match(text, /disableAllHooks/)
  assert.match(text, /\.claude\/settings\.json/)
  // The two levels above the project file that can still set the key for the office's runs. The
  // office reads neither.
  assert.match(text, /\.claude\/settings\.local\.json/)
  assert.match(text, /managed settings/)
  assert.match(text, /run the gate/)
  assert.match(text, /never asked to approve a shell command before it runs/)
  // The claim comes after its condition. "Keeps the approval gate from running" is false in exactly
  // the cases the condition lists, so it must not be said first and without one.
  assert.match(text, /keeps the approval gate from running/)
  const unless = text.indexOf('Unless')
  assert.ok(unless !== -1 && unless < text.indexOf('keeps the approval gate from running'), 'the sentence says the gate is off before saying when it is not')
})
