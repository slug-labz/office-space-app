/**
 * What the task board says happened, as opposed to what it means.
 *
 * The board is the surface for the office's second standing order — claims are verified, not
 * believed — so the thing it must never do is report one kind of failure as another. There are
 * three, and only one of them is about the work:
 *
 * | state | what it means | who has to act |
 * |---|---|---|
 * | the command exited non-zero | the check ran and said no | whoever wrote the code |
 * | the command timed out | it ran and never finished | whoever wrote the check, or the code |
 * | the command could not be started | nothing ran at all | whoever wrote the VERIFY, or this machine |
 *
 * `verify.ts` carries the third one deliberately: *"a command that cannot be started is a result
 * carrying the reason, because 'we could not run the check' is a different thing from 'the check
 * failed', and an office that conflated them would report broken plumbing as broken code."*
 *
 * It carried the reason and nothing read it. `VerifyResult.error` had no reader anywhere, so a
 * VERIFY naming a command this machine does not have rendered as the literal string `exit null` —
 * the least informative way to say the most fixable thing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderTaskList } from '../src/renderer/views/tasks.js'
import { installDom, type El } from './dom.js'
import type { TaskReport } from '../src/main/harness.js'
import type { VerifyResult } from '../src/main/verify.js'
import type { Task } from '../src/shared/tasks.js'

installDom()

const task = (over: Partial<Task> = {}): Task => ({
  ref: '3',
  title: 'Benchmark the parser',
  owner: 'backend',
  condition: '`cargo bench` finishes',
  command: 'cargo bench',
  state: 'queued',
  ...over,
})

const ran = (over: Partial<VerifyResult> = {}): VerifyResult => ({
  command: 'cargo bench',
  passed: false,
  exitCode: 1,
  output: 'thread panicked at src/parse.rs:88',
  durationMs: 1200,
  timedOut: false,
  error: null,
  missing: [],
  unchecked: [],
  ...over,
})

const report = (result: VerifyResult | null, over: Partial<TaskReport> = {}): TaskReport => ({
  project: 'billing',
  checks: [{ task: task(), verdict: { state: 'allowed', rule: 'Bash(cargo bench:*)' }, result }],
  unreadable: 0,
  unrecognised: [],
  problem: null,
  ...over,
})

function render(r: TaskReport): El {
  const el = document.createElement('div') as unknown as El
  renderTaskList(el as unknown as HTMLElement, r, { onRun: () => {} })
  return el
}

const outputOf = (el: El): string | null => el.querySelector('.task__out')?.textContent ?? null

// ──────────────────────────────── the check could not be run — nothing ran at all ──

test('a command that could not be started says so, and says why', () => {
  const out = outputOf(render(report(ran({ error: 'spawn cargo ENOENT', exitCode: null, output: '' }))))

  assert.match(out ?? '', /could not be run/)
  assert.match(out ?? '', /spawn cargo ENOENT/)
})

test('and it never renders as "exit null", which is what it used to say', () => {
  // Empty output and a null exit code are exactly what a failed spawn leaves behind, so the old
  // `result.output || \`exit ${result.exitCode}\`` produced the two least useful words available.
  const out = outputOf(render(report(ran({ error: 'spawn cargo ENOENT', exitCode: null, output: '' }))))

  assert.doesNotMatch(out ?? '', /exit null/)
})

test('it says the trouble is the VERIFY, not the work', () => {
  // The whole point of the distinction. Somebody reading this should go and look at the command
  // in TASKS.md, or install something — not at the code the task is about.
  const out = outputOf(render(report(ran({ error: 'spawn cargo ENOENT', exitCode: null, output: '' }))))

  assert.match(out ?? '', /not about the work/)
})

// ──────────────────────────────────────── the other two, which must stay unchanged ──

test('a check that ran and failed still shows what it printed', () => {
  const out = outputOf(render(report(ran())))

  assert.equal(out, 'thread panicked at src/parse.rs:88')
  assert.doesNotMatch(out ?? '', /could not be run/)
})

test('a timeout still says a check that never finishes has not passed', () => {
  const out = outputOf(render(report(ran({ timedOut: true, durationMs: 30_000, output: 'compiling…' }))))

  assert.match(out ?? '', /Timed out after 30s/)
  assert.match(out ?? '', /has not passed/)
  assert.match(out ?? '', /compiling…/)
})

test('a check that ran, failed and printed nothing falls back to its exit code', () => {
  const out = outputOf(render(report(ran({ output: '', exitCode: 2 }))))

  assert.equal(out, 'exit 2')
})

test('a task nothing was run for shows no output block at all', () => {
  // Not an empty one. An empty `<pre>` reads as "it ran and said nothing", which is a claim.
  assert.equal(outputOf(render(report(null))), null)
})

// ──────────────────────────────────────────────────────────────── the error wins ──

test('an error is reported even when the run also timed out', () => {
  // A spawn that failed did not time out in any meaningful sense; if both are set, the one that
  // explains why nothing ran is the one to lead with.
  const out = outputOf(render(report(ran({ error: 'EACCES', timedOut: true, output: '' }))))

  assert.match(out ?? '', /could not be run: EACCES/)
})

// ────────────────────────── the badge and the message have to agree ──

test('an unstartable command is badged "not checked", not "failed"', () => {
  // The two halves of the same fix, pinned together on purpose. The message says *"the check
  // could not be run"* and the badge used to say **failed** directly above it — one row telling
  // a person two different things about whose problem it is.
  //
  // `outcomeOf` routes it to `not-run` now, which the view renders as "not checked". No seventh
  // outcome was needed: `not-run` already means *nothing was run — because it could not be, or
  // was not permitted to be*.
  const el = render(report(ran({ error: 'spawn cargo ENOENT', exitCode: null, output: '' })))
  const text = (el.textContent || '').replace(/\s+/g, ' ')

  assert.match(text, /not checked/)
  assert.doesNotMatch(text, /\bfailed\b/)
  assert.match(text, /could not be run/)
})

test('and a check that ran and said no is still badged failed', () => {
  const text = (render(report(ran())).textContent || '').replace(/\s+/g, ' ')

  assert.match(text, /failed/)
  assert.doesNotMatch(text, /could not be run/)
})

// ──────────────────────────── a run that skipped a test file its VERIFY names ──

/**
 * `tsx --test a b` with `b` missing runs `a`, exits 0 and never mentions `b`. The harness now calls
 * that failed, and the board has to say why: the output below the badge is the runner's, and it
 * reads as a pass.
 */
const SKIPPED = 'npx tsx --test test/exists.test.ts test/never-written.test.ts'

const skipped = (over: Partial<VerifyResult> = {}): TaskReport =>
  report(null, {
    checks: [
      {
        task: task({ command: SKIPPED, condition: `\`${SKIPPED}\` exits 0` }),
        verdict: { state: 'allowed', rule: 'Bash(npx tsx --test:*)' },
        result: ran({
          command: SKIPPED,
          exitCode: 0,
          output: '# tests 1\n# pass 1',
          missing: ['test/never-written.test.ts'],
          ...over,
        }),
      },
    ],
  })

const badgeOf = (el: El): string | null => el.querySelector('.task__state')?.textContent ?? null

test('a run that named a missing test file says so, above what the runner printed', () => {
  const el = render(skipped())
  const out = outputOf(el) ?? ''

  assert.equal(badgeOf(el), 'failed')
  assert.match(out, /^`test\/never-written\.test\.ts` is not in the workspace folder, where VERIFY commands run/)
  assert.match(out, /`tsx --test` exits 0 when some of the files it is given are missing and the others pass/)
  assert.match(out, /so the command's exit 0 does not show that this file was tested\./)
  assert.doesNotMatch(out.split('\n\n')[0] ?? '', /skip/i, 'nothing here knows whether the runner skipped the file')
  assert.match(out, /# pass 1$/, 'what the runner printed is still shown, after the reason')
})

test('a run that failed anyway names the missing file and does not blame an exit 0', () => {
  const out = outputOf(render(skipped({ exitCode: 1, output: 'Could not find test/never-written.test.ts' }))) ?? ''

  assert.match(out, /^`test\/never-written\.test\.ts` is not in the workspace folder/)
  assert.doesNotMatch(out, /exit 0/)
  assert.match(out, /Could not find/)
})

test('a check that could not be started leads with that, not with the files', () => {
  // Nothing ran, so nothing was skipped by a runner; the badge says "not checked" and the reason
  // has to match it.
  const el = render(skipped({ error: 'spawn npx ENOENT', exitCode: null, output: '' }))

  assert.equal(badgeOf(el), 'not checked')
  assert.match(outputOf(el) ?? '', /^The check could not be run: spawn npx ENOENT/)
  assert.doesNotMatch(outputOf(el) ?? '', /workspace folder/)
})

test('a run with every named file there shows only what the runner printed', () => {
  // The control. The reason must not appear on the common case.
  const el = render(skipped({ passed: true, missing: [] }))

  assert.equal(badgeOf(el), 'passed')
  assert.equal(outputOf(el), '# tests 1\n# pass 1')
})

// ──────────────────────────── a run whose test files nothing looked for ──

/**
 * A command the office cannot place the files of, `cd` here, is run and judged on its exit code,
 * and its files are not looked for. A pass then looks exactly like a pass that looked, unless the
 * board says which it was.
 */
const MOVED = 'cd packages/app && node --test a.test.mjs b.test.mjs'

const moved = (over: Partial<VerifyResult> = {}): TaskReport =>
  report(null, {
    checks: [
      {
        task: task({ command: MOVED, condition: `\`${MOVED}\` exits 0` }),
        verdict: { state: 'allowed', rule: 'Bash(cd packages/app && node --test:*)' },
        result: ran({
          command: MOVED,
          passed: true,
          exitCode: 0,
          output: '# tests 1\n# pass 1',
          unchecked: [{ runner: 'node', reason: 'moves', word: 'cd' }],
          ...over,
        }),
      },
    ],
  })

test('a pass whose test files nothing looked for says so and why, and never that one was skipped', () => {
  const el = render(moved())
  const out = outputOf(el) ?? ''

  assert.equal(badgeOf(el), 'passed', 'not looking is not a failure, and the badge must not say one')
  assert.match(
    out,
    /^The office did not look for the files this command names after `node --test`: the command has `cd` in it/,
  )
  assert.doesNotMatch(out, /skip/i, 'nothing here knows whether a file was skipped')
  assert.match(out, /# pass 1$/, 'what the runner printed is still shown, after the note')
})

test('a missing file and a run nothing looked at are both said, the missing file first', () => {
  const both = 'node --test a.test.mjs never-written.test.mjs; sh -c "node --test b.test.mjs"'
  const out =
    outputOf(
      render(
        moved({
          command: both,
          passed: false,
          missing: ['never-written.test.mjs'],
          unchecked: [{ runner: 'node', reason: 'quoted', word: '"node --test b.test.mjs"' }],
        }),
      ),
    ) ?? ''

  const missing = out.indexOf('`never-written.test.mjs` is not in the workspace folder')
  const unread = out.indexOf('The office did not look for the files this command names after `node --test`')
  assert.ok(missing === 0, `the missing file does not lead:\n${out}`)
  assert.ok(unread > missing, `the runs nothing looked at are not said after it:\n${out}`)
})

test('a pass whose command holds --test that no run read says where it is, and nothing about a run', () => {
  // `echo "node --test done"` runs no test. The note may not say that anything ran or was skipped.
  const el = render(
    moved({
      command: 'echo "node --test done"',
      unchecked: [{ runner: null, reason: 'unread', word: '"node --test done"' }],
    }),
  )
  const out = outputOf(el) ?? ''

  assert.equal(badgeOf(el), 'passed')
  assert.match(out, /^`--test` appears in `"node --test done"`, which the office did not read as a test run, /)
  assert.doesNotMatch(out.split('\n\n')[0] ?? '', /skip|\bran\b|after `/i)
  assert.match(out, /# pass 1$/, 'what the command printed is still shown, after the note')
})

test('a check that could not be started does not say which test files went unread', () => {
  // Nothing ran, so there is no pass to qualify; the reason it could not start is the whole story.
  const el = render(moved({ passed: false, error: 'spawn /bin/sh EACCES', exitCode: null, output: '' }))

  assert.equal(badgeOf(el), 'not checked')
  assert.match(outputOf(el) ?? '', /^The check could not be run: spawn \/bin\/sh EACCES/)
  assert.doesNotMatch(outputOf(el) ?? '', /did not look for the files/)
})
