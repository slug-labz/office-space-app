/**
 * The command line the office actually spawns.
 *
 * `buildArgs` is the whole of the app's relationship with the CLI — every option the office
 * models becomes a flag here, and a flag that is wrong produces a run that is silently not the
 * run anybody asked for. It had no test until 2026-08-20, which is how the `--` bug below
 * survived: it is not visible in any behaviour until a caller sets a variadic option, and no
 * caller did yet.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildArgs } from '../src/main/claude/run.js'

const PROMPT = 'what is the state of the build'
const CWD = '/workspace'

test('the stream flags are always present, because without them there is no floor', () => {
  const args = buildArgs({ cwd: CWD, prompt: PROMPT })
  assert.ok(args.includes('--print'))
  assert.deepEqual(args.slice(0, 4), ['--print', '--output-format', 'stream-json', '--verbose'])
})

test('the prompt is the last argument and survives a variadic flag before it', () => {
  // The bug this file was written for. `--tools` is variadic: it consumes positionals until it
  // meets another flag, so `--tools Read <prompt>` makes the prompt a tool name. Measured
  // against the installed CLI — it exits with "Input must be provided either through stdin or
  // as a prompt argument", having been handed a run with no request in it.
  const args = buildArgs({ cwd: CWD, prompt: PROMPT, tools: ['Read', 'Bash'] })

  assert.equal(args.at(-1), PROMPT, 'the prompt must be the last argument')
  assert.equal(args.at(-2), '--', 'a terminator must separate the prompt from the flags')

  const tools = args.indexOf('--tools')
  assert.ok(tools >= 0)
  assert.ok(
    args.indexOf('--') > tools,
    'the terminator has to come after the variadic flag or it does not terminate it',
  )
})

test('a prompt that begins with a dash is a prompt, not an unrecognised flag', () => {
  const args = buildArgs({ cwd: CWD, prompt: '--help me understand this repo' })
  assert.equal(args.at(-1), '--help me understand this repo')
  assert.equal(args.at(-2), '--')
})

test('resume and session-id are alternatives, never both', () => {
  // Passing both is not a stricter request, it is a contradiction the CLI resolves silently.
  const resumed = buildArgs({ cwd: CWD, prompt: PROMPT, resume: 'abc', sessionId: 'def' })
  assert.ok(resumed.includes('--resume'))
  assert.ok(!resumed.includes('--session-id'))
})

test('--strict-mcp-config is never passed alone', () => {
  // On its own it drops every server the user has and gives nothing back.
  const args = buildArgs({ cwd: CWD, prompt: PROMPT, strictMcp: true })
  assert.ok(!args.includes('--strict-mcp-config'))
})

test('withheld tools reach the CLI, and the prompt still survives them', () => {
  // `--disallowedTools` is variadic, so this is the flag the `--` terminator was added for. The
  // first version of this measurement failed exactly here: the CLI exited with "Input must be
  // provided" because the prompt had been swallowed as a third tool name.
  const args = buildArgs({ cwd: CWD, prompt: PROMPT, disallowedTools: ['Task', 'Write', 'Edit'] })

  const at = args.indexOf('--disallowedTools')
  assert.ok(at >= 0, 'the flag is not passed at all')
  assert.deepEqual(args.slice(at + 1, at + 4), ['Task', 'Write', 'Edit'])
  assert.equal(args.at(-1), PROMPT, 'the variadic flag ate the prompt')
  assert.equal(args.at(-2), '--')
})

test('no withheld tools means the flag is absent, not empty', () => {
  // `--disallowedTools ''` is not "withhold nothing" to a variadic flag — it is one tool whose
  // name is the empty string, and the difference is the kind that only shows up in production.
  assert.ok(!buildArgs({ cwd: CWD, prompt: PROMPT, disallowedTools: [] }).includes('--disallowedTools'))
  assert.ok(!buildArgs({ cwd: CWD, prompt: PROMPT }).includes('--disallowedTools'))
})
