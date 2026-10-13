/**
 * A refusal judged while a deny list was read short suggests no rule to add.
 *
 * Two changes that are each right alone. #256 made an entry in `permissions.deny` that is not a
 * string a `skipped` entry, kept the file's other rules — Claude Code removes the same entry and
 * keeps the rest — and set the read `incomplete`, so `triageAgainst` refuses what the deny rules
 * it read refuse and puts every other call it holds to a person. #260 left the `unlisted` and
 * `unknown` advice alone for a file that *was* used, because on dev every `incomplete` read had a
 * file that could not be used in it.
 *
 * Together they reach a state neither branch has: a file in force, a read that is short, and the
 * old sentence. Measured on dev `e6fe5cb` merged with both, with `.claude/settings.json` allowing
 * `Bash(npm test:*)` and denying `["Bash(rm:*)", 5]`, a refused `npm test` was advised:
 *
 * > Nothing in .claude/settings.json refuses this — nobody has allowed it either. Add it to
 * > permissions.allow there and it will run without asking.
 *
 * False twice. That file allows `npm test`, and `triageAgainst` asked about it in all seven
 * modes — the rule is already there and it does not run without asking. The control, the same
 * file without the `5`, allowed it in every mode.
 *
 * What the office says instead is pinned below. The `denied` line is pinned unchanged beside it:
 * a deny rule that was read still refuses outright, which is what `triageAgainst` still does.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { triageAgainst, type ApprovalRequest } from '../src/main/approvals.js'
import type { ClaudeEvent, ToolDenial } from '../src/main/claude/stream.js'
import { readPolicy } from '../src/main/permissions.js'
import { withCauses } from '../src/main/session.js'
import { PERMISSION_MODES } from '../src/shared/controls.js'
import { summariseRefusals } from '../src/shared/refusals.js'
import { tempDir } from './temp-dir.js'

type Result = Extract<ClaudeEvent, { kind: 'result' }>

/** A workspace whose `.claude/` holds exactly these files, gone when the test `t` ends. */
async function workspace(t: TestContext, files: Record<string, string>): Promise<string> {
  const root = await tempDir(t, 'office-short-deny-')
  await mkdir(join(root, '.claude'))
  for (const [name, body] of Object.entries(files)) await writeFile(join(root, '.claude', name), body)
  return root
}

/** The measured case: a file in force, with one entry in its deny list that is not a rule. */
const SHORT = '{ "permissions": { "allow": ["Bash(npm test:*)"], "deny": ["Bash(rm:*)", 5] } }'
/** The same file without that entry. */
const WHOLE = '{ "permissions": { "allow": ["Bash(npm test:*)"], "deny": ["Bash(rm:*)"] } }'

const held = (command: string): ApprovalRequest => ({
  sessionId: 's-1',
  toolUseId: 't-1',
  tool: 'Bash',
  input: { command },
  cwd: '/w',
  askedAt: '2026-09-17T10:00:00.000Z',
  waitMs: 240_000,
  agent: null,
  agentId: null,
})

const refused = (tool: string, detail: string): ToolDenial => ({ tool, toolUseId: null, detail, cause: 'unknown' })

const finished = (...denials: ToolDenial[]): Result => ({
  kind: 'result',
  isError: false,
  text: 'done',
  costUsd: null,
  turns: null,
  durationMs: null,
  denials,
})

/** The advice the transcript would draw for this result, as one string. */
const advised = (event: Result): string =>
  summariseRefusals(event.denials, event.unusable, event.shortDeny)?.advice.join(' ') ?? ''

const SHORT_DENY =
  "1 entry in .claude/settings.json's permissions.deny is not a rule, so the office refuses what " +
  'the deny rules it read refuse and puts every other call it holds to a person. Until that entry ' +
  'is a rule, or gone, an allow rule for it will not stop the asking.'

// ────────────────────────────────────────────────────────────────── the instrument ──

test('the case: the file is in force, the read is short, and every call is asked about', async (t) => {
  const read = await readPolicy(await workspace(t, { 'settings.json': SHORT }))

  assert.equal(read.sources[0]?.state, 'ok', 'the file was set aside, so this is #260\'s case, not this one')
  assert.deepEqual(read.sources[0]?.skipped, [{ list: 'deny', shape: 'a number' }])
  assert.equal(read.incomplete, true)
  assert.deepEqual(read.policy.allow, ['Bash(npm test:*)'], 'the allow rule the old advice said nobody had written')

  for (const mode of PERMISSION_MODES) {
    assert.deepEqual(triageAgainst(held('npm test'), read, mode), { action: 'ask' }, `npm test in ${mode}`)
    // What the deny rules that were read refuse is still refused, in every mode.
    assert.deepEqual(triageAgainst(held('rm -rf dist'), read, mode), { action: 'deny', rule: 'Bash(rm:*)' }, mode)
  }
})

test('the control: without that entry, the same file allows the same command in every mode', async (t) => {
  const read = await readPolicy(await workspace(t, { 'settings.json': WHOLE }))

  assert.equal(read.incomplete, false)
  for (const mode of PERMISSION_MODES) {
    assert.deepEqual(triageAgainst(held('npm test'), read, mode), { action: 'allow', rule: 'Bash(npm test:*)' }, mode)
  }
})

// ────────────────────────────────────────────────────────────────── the decision ──

test('a deny list read short rides on the result, and no file is called unusable', async (t) => {
  const read = await readPolicy(await workspace(t, { 'settings.json': SHORT }))

  const event = withCauses(finished(refused('Bash', 'npm test')), read)

  assert.deepEqual(event.shortDeny, [{ file: 'settings.json', entries: 1 }])
  assert.equal('unusable' in event, false, 'a file that was read and used was named as one that could not be')
  // The cause is still established: the deny rules that were read are the deny rules in force.
  assert.equal(event.denials[0]?.cause, 'unlisted')
})

test('a read with every entry a rule carries no such list', async (t) => {
  const read = await readPolicy(await workspace(t, { 'settings.json': WHOLE }))

  const event = withCauses(finished(refused('Bash', 'npm test')), read)

  assert.equal('shortDeny' in event, false, 'a whole read named a deny list anyway')
})

test('an entry that is not a rule in the allow list is reported and changes no advice', async (t) => {
  // `readPolicy` leaves such a read complete: a skipped allow entry can only leave the office
  // less willing than what was written, so nothing here has a promise to take back.
  const body = '{ "permissions": { "allow": ["Bash(npm test:*)", 5], "deny": ["Bash(rm:*)"] } }'
  const read = await readPolicy(await workspace(t, { 'settings.json': body }))
  assert.deepEqual(read.sources[0]?.skipped, [{ list: 'allow', shape: 'a number' }], 'the instrument')
  assert.equal(read.incomplete, false, 'the instrument')

  const event = withCauses(finished(refused('Bash', 'npm publish')), read)

  assert.equal('shortDeny' in event, false)
  assert.match(advised(event), /Add it to permissions\.allow there and it will run without asking\./)
})

// ─────────────────────────────────────────────────────────────────── the words ──

test('the sentence says what the office is doing, and promises no rule', async (t) => {
  const read = await readPolicy(await workspace(t, { 'settings.json': SHORT }))

  const advice = advised(withCauses(finished(refused('Bash', 'npm test')), read))

  // The old advice is looked for first, so that keeping it beside the new sentence fails here
  // rather than on the shape of the sentence.
  assert.doesNotMatch(advice, /nobody has allowed|without asking/, advice)
  assert.equal(advice, SHORT_DENY)
})

test('a call refused by a deny rule that was read keeps its own line', async (t) => {
  const read = await readPolicy(await workspace(t, { 'settings.json': SHORT }))

  const event = withCauses(finished(refused('Bash', 'rm -rf dist'), refused('Bash', 'npm test')), read)

  assert.deepEqual(event.denials.map((d) => d.cause), ['denied', 'unlisted'])
  assert.deepEqual(summariseRefusals(event.denials, event.unusable, event.shortDeny)?.advice, [
    'A deny rule in .claude/settings.json refuses this outright, so the office will never run it ' +
      'and will never offer to. Change or remove that rule if it should be allowed.',
    SHORT_DENY,
  ])
})

test('a cause nobody could establish gets the same sentence, not the rule it would otherwise name', async (t) => {
  const read = await readPolicy(await workspace(t, { 'settings.json': SHORT }))

  // `Write` is not something `ruleCovers` can judge, so its cause is `unknown` — whose own line
  // ends "under permissions.allow", which is as empty a promise here as the `unlisted` one.
  const advice = advised(withCauses(finished(refused('Write', '/etc/hosts')), read))

  assert.doesNotMatch(advice, /permissions\.allow/, advice)
  assert.equal(advice, SHORT_DENY)
})

test('several refused calls, and several entries, are said in the plural', () => {
  const both = summariseRefusals(
    [
      { tool: 'Bash', detail: 'npm test', cause: 'unlisted' },
      { tool: 'Bash', detail: 'npm publish', cause: 'unlisted' },
    ],
    [],
    [{ file: 'settings.json', entries: 2 }],
  )
  assert.deepEqual(both?.advice, [
    "2 entries in .claude/settings.json's permissions.deny are not rules, so the office refuses " +
      'what the deny rules it read refuse and puts every other call it holds to a person. Until ' +
      'those entries are rules, or gone, allow rules for them will not stop the asking.',
  ])
})

test('two files read short are both named, in the order they were read', async (t) => {
  const read = await readPolicy(
    await workspace(t, {
      'settings.json': SHORT,
      'settings.local.json': '{ "permissions": { "deny": [{ "Bash": "curl" }] } }',
    }),
  )
  assert.deepEqual(read.sources.map((s) => s.state), ['ok', 'ok'], 'the instrument')

  const event = withCauses(finished(refused('Bash', 'npm test')), read)

  assert.deepEqual(event.shortDeny, [
    { file: 'settings.json', entries: 1 },
    { file: 'settings.local.json', entries: 1 },
  ])
  assert.equal(
    advised(event),
    "2 entries in .claude/settings.json's permissions.deny and .claude/settings.local.json's " +
      'permissions.deny are not rules, so the office refuses what the deny rules it read refuse ' +
      'and puts every other call it holds to a person. Until those entries are rules, or gone, an ' +
      'allow rule for it will not stop the asking.',
  )
})

test('a file that could not be used is still named first', async (t) => {
  // Both at once: one file set aside, one used with an entry that is not a rule. The causes are
  // all `unknown` — #260's position — and its sentence is the one to act on first.
  const read = await readPolicy(await workspace(t, { 'settings.json': 'null', 'settings.local.json': SHORT }))

  const event = withCauses(finished(refused('Bash', 'npm test')), read)

  assert.deepEqual(event.unusable, [{ file: 'settings.json', why: 'Its top level is null, not an object.' }])
  assert.deepEqual(event.shortDeny, [{ file: 'settings.local.json', entries: 1 }])
  assert.match(advised(event), /^The office could not use \.claude\/settings\.json, /, advised(event))
})
