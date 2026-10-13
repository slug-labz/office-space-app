/**
 * The deny advice names the file the rule is in.
 *
 * `readPolicy` reads two files, `.claude/settings.json` and `.claude/settings.local.json`, and
 * merges their rules into one list. The advice for a `denied` refusal always said *"A deny rule in
 * .claude/settings.json refuses this outright … Change or remove that rule"*, whichever file held
 * the rule. With the rule in `settings.local.json` — the personal file, where somebody puts a rule
 * for themselves — that sentence sends them to change a file with no such rule in it.
 *
 * Measured on dev at `e6fe5cb` through a real `ManagerSession` turn, with `settings.json` holding
 * `{}` and `settings.local.json` denying `Bash(rm:*)`: `rm -rf dist` came back `denied`, and the
 * advice named `.claude/settings.json`.
 *
 * The rule's file is known only where the rules were read, so the refusal carries it
 * (`deniedIn`), and the advice names what it carries. A refusal that does not carry it gets words
 * true of either file.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ClaudeEvent } from '../src/main/claude/stream.js'
import { denyingFiles, readPolicy } from '../src/main/permissions.js'
import { ManagerSession, judgeDenial } from '../src/main/session.js'
import { DEFAULT_CONTROLS } from '../src/shared/controls.js'
import { summariseRefusals, type Refusal } from '../src/shared/refusals.js'
import { fakeClaude, init } from './fake-claude.js'

type Result = Extract<ClaudeEvent, { kind: 'result' }>

const rules = (deny: string[], allow: string[] = []) => JSON.stringify({ permissions: { allow, deny } })

/**
 * A turn in which Claude Code refused these `Bash` commands, run in a workspace whose `.claude/`
 * holds exactly `files`. Returns the result the transcript would be given.
 */
async function refusedIn(t: TestContext, files: Record<string, string>, ...commands: string[]): Promise<Result> {
  const fake = await fakeClaude(t, {
    lines: [
      init('s'),
      {
        type: 'result',
        is_error: false,
        result: 'done',
        permission_denials: commands.map((command, i) => ({
          tool_name: 'Bash',
          tool_use_id: `t${i}`,
          tool_input: { command },
        })),
      },
    ],
  })
  t.after(() => rm(fake.dir, { recursive: true, force: true, maxRetries: 3 }))
  await mkdir(join(fake.dir, '.claude'))
  for (const [name, body] of Object.entries(files)) await writeFile(join(fake.dir, '.claude', name), body)

  // `turn` reads the rules beside the run rather than before it, and a real run takes seconds to
  // the read's millisecond. This fake answers as soon as node has started, so its answer is held
  // back to keep the order a real run has.
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
  await manager.send('clean up')

  const result = events.find((e): e is Result => e.kind === 'result')
  assert.ok(result, 'the turn reported no result')
  assert.deepEqual(
    result.denials.map((d) => d.detail),
    commands,
    'the instrument: every refusal the fake sent reached the result',
  )
  return result
}

/** The advice the transcript would draw for this result, one line per cause. */
const adviceFor = (result: Result): readonly string[] => summariseRefusals(result.denials)?.advice ?? []

const ONE_IN = (file: string) =>
  `A deny rule in .claude/${file} refuses this outright, so the office will never run it and ` +
  'will never offer to. Change or remove that rule if it should be allowed.'

// ─────────────────────────────────────────────────────────────── through a turn ──

test('a deny rule in settings.local.json is named there, and settings.json is not', async (t) => {
  const result = await refusedIn(t, { 'settings.json': '{}', 'settings.local.json': rules(['Bash(rm:*)']) }, 'rm -rf dist')

  assert.equal(result.denials[0]?.cause, 'denied', 'the instrument: the rule that was read refused it')
  assert.deepEqual(adviceFor(result), [ONE_IN('settings.local.json')])
})

test('a deny rule in settings.json is still named there', async (t) => {
  const result = await refusedIn(t, { 'settings.json': rules(['Bash(rm:*)']) }, 'rm -rf dist')

  assert.equal(result.denials[0]?.cause, 'denied')
  assert.deepEqual(adviceFor(result), [ONE_IN('settings.json')])
})

test('a file whose deny rules do not cover the command is not named', async (t) => {
  const result = await refusedIn(
    t,
    { 'settings.json': rules(['Bash(git push:*)']), 'settings.local.json': rules(['Bash(rm:*)']) },
    'rm -rf dist',
  )

  assert.deepEqual(adviceFor(result), [ONE_IN('settings.local.json')])
})

test('a command both files refuse names both, because both rules have to change', async (t) => {
  // Different rules, so the first one `judge` stops at is not the only one that counts: changing
  // the rule in settings.json alone would leave `rm -rf dist` refused by the other file.
  const result = await refusedIn(
    t,
    { 'settings.json': rules(['Bash(rm -rf:*)']), 'settings.local.json': rules(['Bash(rm:*)']) },
    'rm -rf dist',
  )

  assert.deepEqual(adviceFor(result), [
    'Deny rules in .claude/settings.json and .claude/settings.local.json refuse this outright, so ' +
      'the office will never run it and will never offer to. Change or remove every one of them ' +
      'if it should be allowed.',
  ])
})

test('several commands refused from one file name that file once', async (t) => {
  const result = await refusedIn(
    t,
    { 'settings.json': '{}', 'settings.local.json': rules(['Bash(rm:*)', 'Bash(git push:*)']) },
    'rm -rf dist',
    'git push --force',
  )

  assert.deepEqual(adviceFor(result), [
    'A deny rule in .claude/settings.local.json refuses these outright, so the office will never ' +
      'run them and will never offer to. Change or remove that rule if they should be allowed.',
  ])
})

test('several commands refused from both files name both', async (t) => {
  const result = await refusedIn(
    t,
    { 'settings.json': rules(['Bash(git push:*)']), 'settings.local.json': rules(['Bash(rm:*)']) },
    'git push --force',
    'rm -rf dist',
  )

  assert.deepEqual(adviceFor(result), [
    'Deny rules in .claude/settings.json and .claude/settings.local.json refuse these outright, so ' +
      'the office will never run them and will never offer to. Change or remove those rules if ' +
      'they should be allowed.',
  ])
})

test('an unlisted refusal in the same turn keeps its own advice beside the deny line', async (t) => {
  const result = await refusedIn(t, { 'settings.local.json': rules(['Bash(rm:*)']) }, 'rm -rf dist', 'npm publish')

  assert.deepEqual(adviceFor(result), [
    ONE_IN('settings.local.json'),
    'Nothing in .claude/settings.json refuses this — nobody has allowed it either. Add it to ' +
      'permissions.allow there and it will run without asking.',
  ])
})

// ───────────────────────────────────────────── a refusal that does not say where ──

const here = dirname(fileURLToPath(import.meta.url))

test('a denied refusal that does not say where its rule is gets words true of either file', async () => {
  const refused: Refusal = { tool: 'Bash', detail: 'rm -rf dist', cause: 'denied' }

  assert.deepEqual(summariseRefusals([refused])?.advice, [
    'A deny rule in .claude/settings.json or .claude/settings.local.json refuses this outright, so ' +
      'the office will never run it and will never offer to. Change or remove that rule if it ' +
      'should be allowed.',
  ])
  assert.deepEqual(summariseRefusals([refused, { ...refused, detail: 'rm -rf build' }])?.advice, [
    'A deny rule in .claude/settings.json or .claude/settings.local.json refuses these outright, ' +
      'so the office will never run them and will never offer to. Change or remove that rule if ' +
      'they should be allowed.',
  ])

  // "Either file" means the files the rules are read from, and no others. A workspace that is not
  // there reports every file `readPolicy` consults, as missing, and creates nothing.
  const consulted = (await readPolicy(join(here, 'no-such-workspace'))).sources.map((s) => `.claude/${s.file}`)
  assert.deepEqual(consulted, ['.claude/settings.json', '.claude/settings.local.json'])
})

test('the unlisted and unknown advice is word for word what it was', () => {
  const advice = (cause: Refusal['cause'], ...details: string[]) =>
    summariseRefusals(details.map((detail) => ({ tool: 'Bash', detail, cause })))?.advice

  assert.deepEqual(advice('unlisted', 'npm publish'), [
    'Nothing in .claude/settings.json refuses this — nobody has allowed it either. Add it to ' +
      'permissions.allow there and it will run without asking.',
  ])
  assert.deepEqual(advice('unlisted', 'npm publish', 'npm version'), [
    'Nothing in .claude/settings.json refuses these — nobody has allowed them either. Add them to ' +
      'permissions.allow there and they will run without asking.',
  ])
  assert.deepEqual(advice('unknown', 'npm publish'), [
    'Allowing it means a rule in .claude/settings.json, under permissions.allow.',
  ])
  assert.deepEqual(advice('unknown', 'npm publish', 'npm version'), [
    'Allowing them means a rule in .claude/settings.json, under permissions.allow.',
  ])
})

test('a turn whose denied calls do not all say where gets the words true of either file', () => {
  // Naming only the files some calls carry would leave out the file the others were refused from.
  const notice = summariseRefusals([
    { tool: 'Bash', detail: 'rm -rf dist', cause: 'denied', deniedIn: ['settings.local.json'] },
    { tool: 'Bash', detail: 'git push --force', cause: 'denied' },
  ])
  assert.match(notice?.advice[0] ?? '', /^A deny rule in \.claude\/settings\.json or \.claude\/settings\.local\.json refuses these /)
})

test('one command refused twice is still advised in the singular', () => {
  // Advice counts calls to act on, not attempts, as it does for the other causes. A review of this
  // PR found nothing held that for `denied`: counting refusals instead of distinct calls passed.
  const refusal: Refusal = { tool: 'Bash', detail: 'rm -rf dist', cause: 'denied', deniedIn: ['settings.local.json'] }
  assert.deepEqual(summariseRefusals([refusal, refusal])?.advice, [ONE_IN('settings.local.json')])
})

test('three files are listed the way a sentence lists them', () => {
  const notice = summariseRefusals([
    { tool: 'Bash', detail: 'rm -rf dist', cause: 'denied', deniedIn: ['a.json', 'b.json', 'c.json'] },
  ])
  assert.match(notice?.advice[0] ?? '', /^Deny rules in \.claude\/a\.json, \.claude\/b\.json and \.claude\/c\.json refuse this /)
})

// ─────────────────────────────────────────────────────────── where a rule came from ──

test('the files named are the ones whose rules cover the command, in the order the rules are read', () => {
  const policy = {
    allow: ['Bash(rm:*)'],
    deny: ['Bash(git push:*)', 'Bash(rm:*)', 'Bash(rm -rf:*)'],
    denyFrom: ['settings.json', 'settings.local.json', 'settings.json'],
  }
  assert.deepEqual(denyingFiles('rm -rf dist', policy), ['settings.local.json', 'settings.json'])
  assert.deepEqual(denyingFiles('  rm -f notes.txt ', policy), ['settings.local.json'])
  assert.deepEqual(denyingFiles('git push', policy), ['settings.json'])
  // Two rules in one file that both cover it name that file once.
  assert.deepEqual(denyingFiles('rm -rf dist', { ...policy, denyFrom: ['settings.json', 'settings.local.json', 'settings.local.json'] }), ['settings.local.json'])
  // An allow rule is not where a refusal comes from, whatever it matches.
  assert.deepEqual(denyingFiles('ls', { ...policy, allow: ['Bash(ls:*)'] }), [])
  // An empty command is unlisted to `judge`, so no rule refused it, not even `Bash(*)`.
  assert.deepEqual(denyingFiles('   ', { allow: [], deny: ['Bash(*)'], denyFrom: ['settings.json'] }), [])
  // A policy that does not say where its rules came from names nothing, rather than guessing.
  assert.deepEqual(denyingFiles('rm -rf dist', { allow: [], deny: ['Bash(rm:*)'] }), [])
})

test('only a denied call carries files, and only when its rule was read from one', () => {
  const policy = { allow: [], deny: ['Bash(rm:*)'], denyFrom: ['settings.local.json'] }
  const call = (detail: string | null, tool = 'Bash') => ({ tool, toolUseId: null, detail, cause: 'unknown' as const })

  assert.deepEqual(judgeDenial(call('rm -rf dist'), policy), {
    ...call('rm -rf dist'),
    cause: 'denied',
    deniedIn: ['settings.local.json'],
  })
  // No key at all on the others, so nothing downstream can read an empty list as "no file".
  assert.deepEqual(judgeDenial(call('npm publish'), policy), { ...call('npm publish'), cause: 'unlisted' })
  assert.deepEqual(judgeDenial(call('rm -rf dist', 'Write'), policy), { ...call('rm -rf dist', 'Write'), cause: 'unknown' })
  assert.deepEqual(judgeDenial(call(null), policy), { ...call(null), cause: 'unknown' })
  assert.deepEqual(judgeDenial(call('rm -rf dist'), { allow: [], deny: ['Bash(rm:*)'] }), {
    ...call('rm -rf dist'),
    cause: 'denied',
  })
})
