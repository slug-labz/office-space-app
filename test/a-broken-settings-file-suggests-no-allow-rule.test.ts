/**
 * A refusal judged while a settings file cannot be used suggests no rule to add.
 *
 * Found in the review of #246, and measured again on dev at `e6fe5cb` before this change. With
 * `.claude/settings.json` holding `null`, `readPolicy` reports that file `unreadable` and the read
 * `incomplete`. `ManagerSession` kept only the read's rules, which were none, so a refused `Bash`
 * call came back `unlisted` and the transcript said:
 *
 * > Nothing in .claude/settings.json refuses this — nobody has allowed it either. Add it to
 * > permissions.allow there and it will run without asking.
 *
 * Claude Code's settings page, read on 2026-09-16 ("Fix a broken settings file"), calls a file
 * with invalid JSON or a value the schema rejects a Settings Error, and says a `-p` run "skips the
 * broken file or values and continues with the rest". So a rule added to that file is not in force
 * while the file stays as it is. That a top level which is not an object is such a value is
 * inferred: settings files are objects, and the page does not name the case.
 *
 * A file that will not parse made it worse. Measured at `e6fe5cb`: a `settings.json` that allows
 * `Bash(npm test:*)` and has a trailing comma in it produced "nobody has allowed it either" for
 * `npm test`, which that file allows.
 *
 * What the office says instead is pinned below. It names the file and why, and it claims no cause,
 * which is where `triageAgainst` stands on the same read.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ClaudeEvent, ToolDenial } from '../src/main/claude/stream.js'
import { readPolicy } from '../src/main/permissions.js'
import { ManagerSession, withCauses } from '../src/main/session.js'
import { DEFAULT_CONTROLS } from '../src/shared/controls.js'
import { summariseRefusals } from '../src/shared/refusals.js'
import { fakeClaude, init } from './fake-claude.js'
import { tempDir } from './temp-dir.js'

type Result = Extract<ClaudeEvent, { kind: 'result' }>

/** A workspace whose `.claude/` holds exactly these files, gone when the test `t` ends. */
async function workspace(t: TestContext, files: Record<string, string>): Promise<string> {
  const root = await tempDir(t, 'office-broken-settings-')
  await mkdir(join(root, '.claude'))
  for (const [name, body] of Object.entries(files)) await writeFile(join(root, '.claude', name), body)
  return root
}

const rules = (allow: string[], deny: string[] = []) => JSON.stringify({ permissions: { allow, deny } })

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
  summariseRefusals(event.denials, event.unusable)?.advice.join(' ') ?? ''

/**
 * Every settings body `readPolicy` sets aside on dev: each JSON value that is not an object, and
 * one that will not parse. The last one allows the very command that gets refused.
 */
const SET_ASIDE = ['null', 'true', 'false', '42', '"Bash(npm test:*)"', '[]', '{ "permissions": { "allow": ["Bash(npm test:*)"], } }']

// ────────────────────────────────────────────────────────────────── the decision ──

test('a settings file that cannot be used is named, and no cause is claimed', async (t) => {
  for (const body of SET_ASIDE) {
    const read = await readPolicy(await workspace(t, { 'settings.json': body }))
    const why = read.sources[0]?.cause ?? null
    // The instrument first: each body is one the reader really set aside, with a reason.
    assert.equal(read.sources[0]?.state, 'unreadable', `${body} was read as settings`)
    assert.ok(why, `${body} was set aside with no reason`)

    const event = withCauses(finished(refused('Bash', 'npm test')), read)

    assert.equal(event.denials[0]?.cause, 'unknown', `${body}: a cause was claimed from rules that were not all read`)
    assert.deepEqual(event.unusable, [{ file: 'settings.json', why }], `${body}: the file did not reach the transcript`)
  }
})

test('a deny rule in the file that was read is not claimed while the other is set aside', async (t) => {
  // `denied` would say "A deny rule in .claude/settings.json refuses this", and settings.json is
  // the file that could not be used. The rule that was read is in settings.local.json.
  const read = await readPolicy(
    await workspace(t, { 'settings.json': 'null', 'settings.local.json': rules([], ['Bash(rm:*)']) }),
  )
  assert.deepEqual(read.policy.deny, ['Bash(rm:*)'], 'the instrument: the deny rule was read')

  const event = withCauses(finished(refused('Bash', 'rm -rf dist')), read)

  // `unknown` is what keeps the deny sentence out of the block: the words for `unknown` beside an
  // unusable file are pinned below.
  assert.equal(event.denials[0]?.cause, 'unknown')
})

test('two files that cannot be used are both named, in the order they were read', async (t) => {
  const read = await readPolicy(await workspace(t, { 'settings.json': 'null', 'settings.local.json': '{ "permissions": ' }))
  const [shared, local] = read.sources
  assert.deepEqual(read.sources.map((s) => s.state), ['unreadable', 'unreadable'], 'the instrument')

  const event = withCauses(finished(refused('Bash', 'npm test'), refused('Write', 'notes.md')), read)

  assert.deepEqual(event.denials.map((d) => d.cause), ['unknown', 'unknown'])
  assert.deepEqual(event.unusable, [
    { file: 'settings.json', why: shared?.cause ?? null },
    { file: 'settings.local.json', why: local?.cause ?? null },
  ])
})

test('a read that used every file keeps its causes and its words', async (t) => {
  // "For complete reads, keep the existing wording": each line below is the one on dev.
  const read = await readPolicy(await workspace(t, { 'settings.json': rules(['Bash(npm test:*)'], ['Bash(rm:*)']) }))
  assert.equal(read.incomplete, false, 'the instrument: nothing was set aside')

  const event = withCauses(
    finished(refused('Bash', 'rm -rf dist'), refused('Bash', 'npm publish'), refused('Write', '/etc/hosts')),
    read,
  )

  assert.deepEqual(event.denials.map((d) => d.cause), ['denied', 'unlisted', 'unknown'])
  assert.equal('unusable' in event, false, 'a read with nothing set aside named a file anyway')
  assert.deepEqual(summariseRefusals(event.denials, event.unusable)?.advice, [
    'A deny rule in .claude/settings.json refuses this outright, so the office will never run it ' +
      'and will never offer to. Change or remove that rule if it should be allowed.',
    'Nothing in .claude/settings.json refuses this — nobody has allowed it either. Add it to ' +
      'permissions.allow there and it will run without asking.',
    'Allowing it means a rule in .claude/settings.json, under permissions.allow.',
  ])
})

test('a settings file that is not there is not one that could not be used', async (t) => {
  // A workspace need not have either file. Saying one "could not be used" would send somebody to
  // look for a file that does not exist.
  const read = await readPolicy(await workspace(t, {}))
  assert.deepEqual(read.sources.map((s) => s.state), ['missing', 'missing'], 'the instrument')

  const event = withCauses(finished(refused('Bash', 'npm test')), read)

  assert.equal(event.denials[0]?.cause, 'unlisted')
  assert.equal('unusable' in event, false)
})

// ─────────────────────────────────────────────────────────────────── the words ──

const NULL_TOP = { file: 'settings.json', why: 'Its top level is null, not an object.' }

test('the sentence names the file and why, and points at no rule', () => {
  const one = summariseRefusals([{ tool: 'Bash', detail: 'npm test', cause: 'unknown' }], [NULL_TOP])
  assert.deepEqual(one?.advice, [
    'The office could not use .claude/settings.json, so it will not work out why this was ' +
      'refused, or what would let it run, until it can. Its top level is null, not an object.',
  ])

  const two = summariseRefusals(
    [
      { tool: 'Bash', detail: 'npm test', cause: 'unknown' },
      { tool: 'Write', detail: 'notes.md', cause: 'unknown' },
    ],
    [NULL_TOP],
  )
  assert.deepEqual(two?.advice, [
    'The office could not use .claude/settings.json, so it will not work out why these were ' +
      'refused, or what would let them run, until it can. Its top level is null, not an object.',
  ])
})

test('with two files set aside, each reason says which file it is about', () => {
  const notice = summariseRefusals(
    [{ tool: 'Bash', detail: 'npm test', cause: 'unknown' }],
    [NULL_TOP, { file: 'settings.local.json', why: 'Unexpected end of JSON input' }],
  )
  assert.deepEqual(notice?.advice, [
    'The office could not use .claude/settings.json or .claude/settings.local.json, so it will ' +
      'not work out why this was refused, or what would let it run, until it can. ' +
      '.claude/settings.json: Its top level is null, not an object. ' +
      '.claude/settings.local.json: Unexpected end of JSON input.',
  ])
})

test('a reason the reader gave without a full stop is ended as a sentence, and one with one is left alone', () => {
  const advice = (why: string) =>
    summariseRefusals([{ tool: 'Bash', detail: 'npm test', cause: 'unknown' }], [{ file: 'settings.json', why }])?.advice[0] ?? ''
  assert.ok(advice('Unexpected end of JSON input').endsWith(' Unexpected end of JSON input.'), advice('Unexpected end of JSON input'))
  assert.ok(advice('Its top level is null, not an object.').endsWith(' not an object.'), advice('Its top level is null, not an object.'))
  assert.doesNotMatch(advice('Its top level is null, not an object.'), /\.\.$/)
})

test('every body set aside on dev gets that sentence, and none of the old advice', async (t) => {
  for (const body of SET_ASIDE) {
    const read = await readPolicy(await workspace(t, { 'settings.json': body }))
    const advice = advised(withCauses(finished(refused('Bash', 'npm test')), read))

    // The old advice is looked for first, so that naming the file while keeping the old advice
    // beside it fails here, rather than on the shape of the sentence.
    assert.doesNotMatch(advice, /permissions\.allow|without asking|nobody has allowed/, `${body}: ${advice}`)
    assert.match(advice, /^The office could not use \.claude\/settings\.json, /, `${body}: ${advice}`)
    const why = (read.sources[0]?.cause ?? '(no reason)').trim()
    assert.ok(advice.endsWith(` ${why}`) || advice.endsWith(` ${why}.`), `${body}: ${advice}`)
  }
})

// ─────────────────────────────────────────────────────────────── through a turn ──

test('a turn over a settings file holding null carries the file on its result', async (t) => {
  const fake = await fakeClaude(t, {
    lines: [
      init('s'),
      {
        type: 'result',
        is_error: false,
        result: 'done',
        permission_denials: [{ tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'npm test' } }],
      },
    ],
  })
  await mkdir(join(fake.dir, '.claude'))
  await writeFile(join(fake.dir, '.claude', 'settings.json'), 'null')

  // `turn` starts the read beside the run rather than awaiting it, and says why. A real run takes
  // seconds and the read a millisecond, but this fake answers as soon as node has started. Holding
  // its answer back 200 ms keeps the order a real run has, so this test is not a race.
  const slow = join(fake.dir, 'slow.cjs')
  await writeFile(slow, "#!/usr/bin/env node\nsetTimeout(() => require('./claude.cjs'), 200)\n")
  await chmod(slow, 0o755)

  const events: ClaudeEvent[] = []
  const manager = new ManagerSession({
    cwd: fake.dir,
    agent: 'manager',
    staff: () => [],
    projectBlock: () => '## CURRENT PROJECT\n\nNone.',
    project: 'the-office',
    controls: () => DEFAULT_CONTROLS,
    claudePath: slow,
    onEvent: (event) => events.push(event),
    onState: () => {},
  })
  await manager.send('run the tests')

  const result = events.find((e): e is Result => e.kind === 'result')
  assert.ok(result, 'the turn reported no result')
  const why = (await readPolicy(fake.dir)).sources[0]?.cause ?? null
  assert.deepEqual(result.denials.map((d) => [d.detail, d.cause]), [['npm test', 'unknown']])
  assert.deepEqual(result.unusable, [{ file: 'settings.json', why }])
  assert.doesNotMatch(advised(result), /permissions\.allow/, advised(result))
})
