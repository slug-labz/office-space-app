/**
 * Asides, and the CLI adapter underneath them.
 *
 * `src/main/claude/aside.ts` claims that asking an agent what it is doing never disturbs the
 * work — that the question goes to a *fork* of the session and the original transcript never
 * grows. That claim is worth exactly as much as its evidence, so it is checked here against a
 * real child process and the argv it was actually handed.
 *
 * The run tests below sit in the same file because they are the same guarantee at a lower
 * level: a failure that is reported as a success is the one thing the office may never do.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { askAside, askStatus, statusQuestionFor, ASIDE_MODEL, STATUS_QUESTION } from '../src/main/claude/aside.js'
import { runClaude } from '../src/main/claude/run.js'
import type { ClaudeEvent } from '../src/main/claude/stream.js'
import { assistantText, fakeClaude, init, result } from './fake-claude.js'

// ──────────────────────────────────────────────────────────────────── asides ──

test('an aside forks the session instead of continuing it', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('fork-abc'), assistantText('Reading the auth module.'), result(false)] })

  await askAside({
    cwd: fake.dir,
    sessionId: 'original-session',
    question: 'what are you doing?',
    claudePath: fake.path,
  })

  const argv = await fake.argv()
  assert.ok(argv.includes('--fork-session'), 'must fork, or the question joins the conversation it is asking about')
  assert.equal(argv[argv.indexOf('--resume') + 1], 'original-session')
})

test('the fork lands on a different session id — which is the guarantee itself', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('fork-abc'), assistantText('Still reviewing.'), result(false)] })

  const answer = await askAside({
    cwd: fake.dir,
    sessionId: 'original-session',
    question: 'status?',
    claudePath: fake.path,
  })

  assert.equal(answer.forkedSessionId, 'fork-abc')
  assert.notEqual(answer.forkedSessionId, 'original-session')
})

test('an aside carries no tools — a question about work never becomes work', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('fork-abc'), assistantText('Idle.'), result(false)] })

  await askStatus({ cwd: fake.dir, sessionId: 'original-session', claudePath: fake.path })

  const argv = await fake.argv()
  const tools = argv[argv.indexOf('--tools') + 1]
  assert.equal(tools, '', '`--tools ""` is how the CLI is told to disable every tool')
})

test('an aside runs on the cheap model, because it fires on every click', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('fork-abc'), assistantText('Idle.'), result(false)] })

  await askStatus({ cwd: fake.dir, sessionId: 'original-session', claudePath: fake.path })

  const argv = await fake.argv()
  assert.equal(argv[argv.indexOf('--model') + 1], ASIDE_MODEL)
})

test('the answer is the assistant text, not the raw stream', async (t) => {
  const fake = await fakeClaude(t, {
    lines: [init('fork-abc'), assistantText('Reviewing the '), assistantText('token refresh.'), result(false)],
  })

  const answer = await askAside({ cwd: fake.dir, sessionId: 's', question: 'q', claudePath: fake.path })

  assert.equal(answer.text, 'Reviewing the token refresh.')
  assert.equal(answer.isError, false)
})

test('a run that produces no turn falls back to the result text rather than an empty bubble', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('fork-abc'), result(true, 'Credit balance too low')] })

  const answer = await askAside({ cwd: fake.dir, sessionId: 's', question: 'q', claudePath: fake.path })

  assert.equal(answer.text, 'Credit balance too low')
  assert.equal(answer.isError, true)
})

test('the subagent status question admits what the manager cannot see', () => {
  const question = statusQuestionFor('reviewer')
  assert.match(question, /cannot see inside a subagent/)
  assert.match(question, /If you never\s+dispatched reviewer, say exactly that/)
  assert.match(STATUS_QUESTION, /if you are between tasks or unsure, say exactly that/)
})

// ───────────────────────────────────────────────────────────────── the runner ──

test('failure is read from the result event, never from the exit code', async (t) => {
  // The case that motivates the whole rule: an expired token exits non-zero *and* reports a
  // result. The result is the honest answer; the exit code is not.
  const fake = await fakeClaude(t, { lines: [init('s'), result(true, 'token expired')], exitCode: 1 })

  const summary = await runClaude({ cwd: fake.dir, prompt: 'hi', claudePath: fake.path }, () => {}).done

  assert.equal(summary.isError, true)
  assert.equal(summary.exitCode, 1)
})

test('a run that exits zero but reports an error is a failure', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), result(true, 'refused')], exitCode: 0 })

  const summary = await runClaude({ cwd: fake.dir, prompt: 'hi', claudePath: fake.path }, () => {}).done

  assert.equal(summary.exitCode, 0)
  assert.equal(summary.isError, true, 'exit code 0 is not evidence of success')
})

test('a process that dies before reporting a result is a failure, and says so', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s')], stderr: 'killed', exitCode: 137 })

  const events: ClaudeEvent[] = []
  const summary = await runClaude({ cwd: fake.dir, prompt: 'hi', claudePath: fake.path }, (e) => events.push(e)).done

  assert.equal(summary.isError, true)
  const last = events.at(-1)
  assert.equal(last?.kind, 'result')
  assert.equal(last.kind === 'result' && last.isError, true)
  assert.match(last.kind === 'result' ? (last.text ?? '') : '', /killed/)
})

test('a half-written final line is surfaced rather than lost in the buffer', async (t) => {
  const fake = await fakeClaude(t, {
    stdout: `${JSON.stringify(init('s'))}\n${JSON.stringify(result(false))}\n{"type":"assis`,
  })

  const events: ClaudeEvent[] = []
  await runClaude({ cwd: fake.dir, prompt: 'hi', claudePath: fake.path }, (e) => events.push(e)).done

  assert.ok(events.some((e) => e.kind === 'unparsed'), 'the fragment is the evidence; dropping it hides why')
})

test('a first run claims the session id; a resume does not', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), result(false)] })

  await runClaude({ cwd: fake.dir, prompt: 'hi', sessionId: 'chosen-id', claudePath: fake.path }, () => {}).done
  let argv = await fake.argv()
  assert.equal(argv[argv.indexOf('--session-id') + 1], 'chosen-id')
  assert.ok(!argv.includes('--resume'))

  await runClaude({ cwd: fake.dir, prompt: 'hi', resume: 'chosen-id', claudePath: fake.path }, () => {}).done
  argv = await fake.argv()
  assert.equal(argv[argv.indexOf('--resume') + 1], 'chosen-id')
  assert.ok(!argv.includes('--session-id'))
})

test('--verbose is always passed, because without it the floor has nothing to render', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), result(false)] })

  await runClaude({ cwd: fake.dir, prompt: 'hi', claudePath: fake.path }, () => {}).done

  const argv = await fake.argv()
  assert.ok(argv.includes('--verbose'))
  assert.equal(argv[argv.indexOf('--output-format') + 1], 'stream-json')
})

test('a binary that does not exist rejects rather than reporting a quiet success', async () => {
  await assert.rejects(
    runClaude({ cwd: process.cwd(), prompt: 'hi', claudePath: '/nonexistent/claude' }, () => {}).done,
  )
})
