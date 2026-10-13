/**
 * When `done` settles, the process is gone.
 *
 * `runClaude` settled its `done` promise on the child's `'close'` event, and `'close'` is not
 * "the process exited" — Node's own contract is that it fires once the process has ended *and*
 * its stdio streams are closed, which is a different moment whenever something else is holding
 * the write end. `claude` is spawned `detached` with piped stdout and stderr, so any descendant
 * that inherits those two descriptors keeps them open after `claude` itself is gone.
 *
 * `session.ts` nulls `this.running` in a `finally` driven by that promise, and
 * `main.ts`'s `describeSession` reads `state.phase === 'running'` straight out of it. So a late
 * `'close'` is not a late cleanup, it is a campus card that says an agent is busy when its
 * process has already exited — the third standing order, in the one place the user is most
 * likely to believe it.
 *
 * Measured against the CLI at 2.1.266 on 2026-09-15, by pid and by descriptor, none of the routes
 * tried produce this test's grandchild. A process backgrounded through the Bash tool outlived
 * `claude`, but its stdout and stderr were the tool's own output file, not `claude`'s; the same
 * through `run_in_background`, and a hung MCP stdio server holding sockets of its own, were both
 * gone by the time `claude` exited. So this is not a bug anybody has seen. It is the adapter
 * declining to depend on that, because `claudePath` names a program we do not control and the
 * failure mode is a spinner that never stops.
 *
 * Corrected 2026-09-14: the version above first read 2.1.259, which was a `--version` check taken
 * before the binary was upgraded in place. Every run behind these numbers is stamped 2.1.266 in
 * its own transcript — see the matching note in `run.ts`.
 *
 * Corrected 2026-09-15: the "Measured against" paragraph first said `claude` hands its own
 * descriptors to nothing it starts, implied the background processes were still running when it
 * exited, and called the MCP server's fds private rather than inherited. None of those had been
 * measured — see the matching note in `run.ts` for what the check actually counted.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runClaude } from '../src/main/claude/run.js'
import type { ClaudeEvent } from '../src/main/claude/stream.js'
import { fakeClaude, init } from './fake-claude.js'
import { tempDir } from './temp-dir.js'

/**
 * A `claude` that writes `lines`, exits at once, and leaves a grandchild holding its stdout and
 * stderr.
 *
 * The grandchild inherits the pipes because that is the whole mechanism: it is what a tool
 * left running in the background would do if the program on the other end of `claudePath` did
 * not pipe its own children. By default it writes nothing for `LINGER_SECONDS`, which is far
 * longer than the drain grace, so a run that waits for `'close'` waits for the grandchild rather
 * than for `claude`.
 */
const LINGER_SECONDS = 30

const INIT = { type: 'system', subtype: 'init', session_id: 'linger-1', model: 'claude-opus-4' }
const RESULT = { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.01 }

async function lingeringClaude(
  t: TestContext,
  lines: readonly object[] = [INIT, RESULT],
  grandchild = `setTimeout(() => {}, ${LINGER_SECONDS} * 1000)`,
): Promise<string> {
  const dir = await tempDir(t, 'office-linger-claude-')
  const path = join(dir, 'claude.cjs')

  await writeFile(
    path,
    `#!/usr/bin/env node
const { spawn } = require('node:child_process')
process.stdout.write(${JSON.stringify(lines.map((line) => JSON.stringify(line) + '\n').join(''))})
// The grandchild: inherits this process's stdout and stderr, then outlives it.
const held = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {
  stdio: ['ignore', 'inherit', 'inherit'],
  detached: true,
})
held.unref()
process.stdout.write(String(held.pid) + '\\n')
process.exit(0)
`,
  )
  await chmod(path, 0o755)
  return path
}

/** Housekeeping: the grandchild is detached and would outlive the test run. */
function release(events: readonly ClaudeEvent[]): void {
  const pid = Number(events.find((e) => e.kind === 'unparsed')?.line)
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

test('a run whose grandchild holds the pipes is over when claude exits, not when the pipes close', async (t) => {
  const claudePath = await lingeringClaude(t)
  const events: ClaudeEvent[] = []

  const started = Date.now()
  const handle = runClaude({ cwd: tmpdir(), prompt: 'anything', claudePath }, (event) => {
    events.push(event)
  })

  const summary = await handle.done
  const elapsed = Date.now() - started

  // The assertion the old behaviour fails: it waited the full LINGER_SECONDS.
  assert.ok(
    elapsed < LINGER_SECONDS * 1000 * 0.5,
    `done settled after ${elapsed}ms — it waited for the grandchild's pipes, not for claude`,
  )

  // And the half of the fix that is easy to get wrong. Settling early must not throw away what
  // the process already wrote: the result event is the difference between a finished run and one
  // this app reports as having died before answering.
  //
  // What these do not do is pin the drain. A review on 2026-09-15 made the adapter settle on
  // 'exit' immediately, with no drain at all, and this test still passed five times out of five;
  // re-run that way the same day, it passed five of five again. They show that output written
  // before exit survives, not that the drain is what saves it. The next test is the one that
  // fails without it.
  assert.equal(summary.exitCode, 0)
  assert.equal(summary.isError, false)
  assert.equal(summary.sessionId, 'linger-1')
  assert.equal(summary.costUsd, 0.01)

  const results = events.filter((event) => event.kind === 'result')
  assert.equal(results.length, 1, 'exactly one result, and not a synthesised "died early" one')
  assert.equal(results[0]?.isError, false)

  release(events)
})

/**
 * When the grandchild below writes the result: long after `claude` has exited, and well inside
 * the drain's grace.
 *
 * `claude` exits a few milliseconds after starting the grandchild, which has to start Node before
 * this timer even begins.
 */
const LATE_MS = 250

test('a result that reaches the pipes after claude has exited is still read, if they close within the drain', async (t) => {
  // The drain, pinned: an adapter that settles on 'exit' fails this, and so does one whose grace
  // is shorter than LATE_MS.
  //
  // The obvious candidate does not pin it. A `claude` that writes more than a pipe buffer's worth
  // ending in its result, then exits at once, was measured on 2026-09-15 (Darwin 24.2 arm64, Node
  // 22.16.0, libuv 1.49.2): ~1 MiB passed 40 of 40 against an adapter that settles on 'exit' with
  // no drain, and a probe spawning children the way `run.ts` does, in 560 trials that delivered
  // their whole payload, never read a byte after 'exit', 160 of them with eight children running
  // at once. That is libuv on kqueue, as on macOS: it reaps only the child whose own exit event
  // arrived, and only after the other I/O in that poll (read from its source, not run), so what a
  // child wrote before exiting has been read by the time its 'exit' fires.
  //
  // It is not so everywhere, and that is why the drain matters for more than stray descendants.
  // On Unix without kqueue, Linux included, libuv answers a SIGCHLD by reaping every child that has
  // exited, in one pass (`src/unix/process.c`, read from its source, not measured). So when another
  // process the office started exits, that pass can reap `claude` and fire its 'exit' before its
  // last bytes have been read — inferred from that source, not measured — and the drain is what
  // still reads them. That is a race this test cannot arrange, so it uses what it can: a grandchild
  // still holding the pipes, writing after `claude` has exited.
  const late = `setTimeout(() => process.stdout.write(${JSON.stringify(JSON.stringify(RESULT) + '\n')}), ${LATE_MS})`
  const claudePath = await lingeringClaude(t, [INIT], late)
  const events: ClaudeEvent[] = []

  const summary = await runClaude({ cwd: tmpdir(), prompt: 'anything', claudePath }, (event) => {
    events.push(event)
  }).done

  const results = events.filter((event) => event.kind === 'result')
  assert.equal(results.length, 1, 'exactly one result, and not a synthesised "died early" one')
  assert.equal(summary.isError, false, 'done settled before the result on the pipes was read')
  assert.equal(summary.costUsd, 0.01)
})

test('a run the drain cuts off says the office stopped reading, not that claude never reported', async (t) => {
  // No result, and the grandchild still holding the pipes when the drain runs out. The office
  // stops reading there, so whatever it did not read is its own cut, and the result it
  // synthesises has to say that rather than report that `claude` never answered. The first line
  // is the one the activity strip shows.
  const claudePath = await lingeringClaude(t, [INIT])
  const events: ClaudeEvent[] = []

  const summary = await runClaude({ cwd: tmpdir(), prompt: 'anything', claudePath }, (event) => {
    events.push(event)
  }).done
  release(events)

  assert.equal(summary.isError, true)
  const results = events.filter((event) => event.kind === 'result')
  assert.equal(results.length, 1)
  const [first = ''] = (results[0]?.text ?? '').split('\n')
  assert.match(first, /the office stopped reading/)
  assert.doesNotMatch(first, /before reporting a result/)
})

test('a run that dies with nothing holding its pipes still says claude never reported', async (t) => {
  // The other side of that line, so that not every early death is reported as the office's cut.
  const fake = await fakeClaude(t, { lines: [init('s')], exitCode: 3 })
  const events: ClaudeEvent[] = []

  await runClaude({ cwd: fake.dir, prompt: 'hi', claudePath: fake.path }, (event) => {
    events.push(event)
  }).done

  const last = events.at(-1)
  assert.equal(last?.kind === 'result' ? last.text : null, 'claude exited with code 3 before reporting a result')
})
