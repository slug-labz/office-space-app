/**
 * Running a VERIFY condition.
 *
 * The office's second standing order says a task is done when its check passes, not when
 * somebody says it is. Everything here is about the ways a check can fail to be a check: one
 * that never finishes, one that could not be started, one whose output nobody kept.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { mkdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { runVerify } from '../src/main/verify.js'
import type { Unchecked } from '../src/shared/tasks.js'

import { tempDir } from './temp-dir.js'

const cwd = tmpdir()

test('exit zero is the only thing that counts as passing', async () => {
  const result = await runVerify({ command: 'exit 0', cwd })

  assert.equal(result.passed, true)
  assert.equal(result.exitCode, 0)
})

test('a non-zero exit is a failure however cheerful the output', async () => {
  const result = await runVerify({ command: 'echo "all good!" && exit 3', cwd })

  assert.equal(result.passed, false)
  assert.equal(result.exitCode, 3)
  assert.match(result.output, /all good!/, 'and the output is kept, because a failure with none is unactionable')
})

test('output is kept even when the check passes', async () => {
  const result = await runVerify({ command: 'echo "42 tests, 0 failures"', cwd })

  assert.equal(result.passed, true)
  assert.match(result.output, /42 tests/)
})

test('stderr is kept too, interleaved with stdout', async () => {
  const result = await runVerify({ command: 'echo out; echo err 1>&2', cwd })

  assert.match(result.output, /out/)
  assert.match(result.output, /err/)
})

test('a check that never finishes has not passed, and says it timed out', async () => {
  // Distinct from failing: "takes longer than the harness waits" and "is broken" are different
  // problems with different fixes.
  const result = await runVerify({ command: 'sleep 5', cwd, timeoutMs: 300 })

  assert.equal(result.passed, false)
  assert.equal(result.timedOut, true)
  assert.ok(result.durationMs < 4000, 'and it was actually killed rather than waited out')
})

test('a command that cannot be run is a result, not a throw', async () => {
  const result = await runVerify({ command: 'definitely-not-a-real-command-xyzzy', cwd })

  assert.equal(result.passed, false)
  // The shell reports this as a non-zero exit with a message, which is a real answer.
  assert.notEqual(result.exitCode, 0)
})

test('a check runs where it was told to', async () => {
  const result = await runVerify({ command: 'pwd', cwd })

  assert.equal(result.passed, true)
  assert.ok(result.output.length > 0)
})

test('the command is echoed back on the result, so a report can name what it ran', async () => {
  const result = await runVerify({ command: 'exit 0', cwd })

  assert.equal(result.command, 'exit 0')
})

test('a very noisy check is clamped rather than returned whole', async () => {
  const result = await runVerify({ command: 'for i in $(seq 1 2000); do echo "line $i padding padding"; done', cwd })

  assert.ok(result.output.length <= 4100, `kept ${result.output.length} characters`)
  assert.match(result.output, /^…/, 'and says it was cut')
})

test('a timeout kills the whole process tree, not just the shell', async () => {
  // The bug CI found on its first run, and the reason it is worth writing a second test for a
  // behaviour the test above already covers: that one asserted the *duration*, which is a
  // symptom. This asserts the thing that was actually wrong.
  //
  // `shell: true` makes the child `/bin/sh -c "<command>"`. Killing the shell is enough on
  // macOS, which often execs a single command — so every local run passed. On Linux the shell
  // forks and the command outlives it, holding the pipe open, and the harness reported
  // `timedOut: true` about a process that was still running.
  //
  // A shell that spawns a child and waits makes the difference visible on either platform.
  const started = Date.now()
  const result = await runVerify({ command: 'sh -c "sleep 5 & wait"', cwd, timeoutMs: 300 })
  const elapsed = Date.now() - started

  assert.equal(result.timedOut, true)
  assert.equal(result.passed, false)
  assert.ok(
    elapsed < 3000,
    `the deadline reported a kill it did not perform — waited ${elapsed}ms for a 300ms timeout`,
  )
})

/**
 * A process the command leaves behind, holding its stdout and stderr.
 *
 * `runVerify` settled on the child's `'close'`, which Node fires once the process has exited *and*
 * its pipes have closed — and what the command starts inherits those pipes, so it can hold them
 * open after the command is gone. `LINGER_SECONDS` outlasts every wait below, so a check that
 * waits for `'close'` is waiting for the leftover rather than for the command.
 */
const LINGER_SECONDS = 30

/** The promise's value, or `'still pending'` if it has not settled within `ms`. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'still pending'> {
  let timer: NodeJS.Timeout | undefined
  const expiry = new Promise<'still pending'>((resolve) => {
    timer = setTimeout(() => resolve('still pending'), ms)
  })
  try {
    return await Promise.race([promise, expiry])
  } finally {
    clearTimeout(timer)
  }
}

/** The pid a command wrote down for what it left behind. Never 0: `kill(0)` is this test's own group. */
async function leftoverPid(pidFile: string): Promise<number | null> {
  const pid = Number((await readFile(pidFile, 'utf8').catch(() => '')).trim())
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

/** Probe the pid itself. A pattern over `ps` also matches every command line that names it. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Housekeeping: a leftover would otherwise outlive the test run. */
async function killLeftover(pidFile: string): Promise<void> {
  const pid = await leftoverPid(pidFile)
  if (pid === null) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Already gone.
  }
}

test('a command that exits is answered, even while a process outside its group holds the output', async (t) => {
  // The leftover takes a session and process group of its own, so the signal the deadline sends
  // the command's group cannot reach it. `'close'` then waited for the leftover to exit, and so did
  // the check. A script rather than `setsid`, which macOS does not ship: `detached: true` is
  // `setsid()`.
  const dir = await tempDir(t, 'office-verify-detached-')
  const script = join(dir, 'detach.cjs')
  const pidFile = join(dir, 'leftover.pid')
  await writeFile(
    script,
    `const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')

if (process.argv[2] === 'leftover') {
  // Writing for as long as it runs, so a check that ended it by closing the pipes on it would show.
  setInterval(() => process.stdout.write('written by what it left behind\\n'), 100)
  setTimeout(() => process.exit(0), ${LINGER_SECONDS} * 1000)
} else {
  process.stdout.write('answered before exiting\\n')
  const leftover = spawn(process.execPath, [__filename, 'leftover'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  })
  leftover.unref()
  writeFileSync(${JSON.stringify(pidFile)}, String(leftover.pid))
}
`,
  )

  const check = runVerify({
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`,
    cwd,
    timeoutMs: 10_000,
  })

  try {
    const result = await within(check, 20_000)
    assert.ok(result !== 'still pending', 'still pending twenty seconds in, ten past its own deadline')

    // The command's answer, not the deadline's: it exited 0 long before ten seconds.
    assert.equal(result.timedOut, false)
    assert.equal(result.exitCode, 0)
    assert.equal(result.passed, true)
    assert.match(result.output, /answered before exiting/)
    // Settling after the exit did not mean dropping what arrived just after it.
    assert.match(result.output, /written by what it left behind/)

    // And the bound did not come from ending the leftover: not with a signal, which the check
    // cannot aim outside its own group knowing whose process it reaches, and not by closing the
    // pipes it is still writing to.
    const pid = await leftoverPid(pidFile)
    assert.ok(pid !== null, 'the command did not record what it left behind')
    await sleep(500)
    assert.equal(isAlive(pid), true, 'the check ended a process outside its own group')
  } finally {
    await killLeftover(pidFile)
  }
})

test('a command that exits zero has passed, even while a process in its group holds the output', async (t) => {
  // Here the deadline could reach the leftover, and did: the check waited for `'close'` until the
  // deadline killed the command's group, then reported a command that had exited 0 at once as
  // timed out and failed — the harness calling a passing check failed.
  const dir = await tempDir(t, 'office-verify-grouped-')
  const pidFile = join(dir, 'leftover.pid')
  const check = runVerify({
    command: `echo answered; sleep ${LINGER_SECONDS} & echo $! > ${JSON.stringify(pidFile)}`,
    cwd,
    timeoutMs: 10_000,
  })

  try {
    const result = await within(check, 20_000)
    assert.ok(result !== 'still pending', 'still pending twenty seconds in, ten past its own deadline')

    assert.equal(result.timedOut, false, 'reported the deadline for a command that had already exited')
    assert.equal(result.exitCode, 0)
    assert.equal(result.passed, true)
    assert.match(result.output, /answered/)
  } finally {
    await killLeftover(pidFile)
  }
})

test('a deadline settles the check even while a process outside its group holds the output', async (t) => {
  // The deadline marked the check timed out and killed the command's group, but only `'close'`
  // settled a check, and a leftover out of the group's reach kept `'close'` from coming. Here the
  // command never answers at all, and the check still has to.
  const dir = await tempDir(t, 'office-verify-detached-')
  const script = join(dir, 'hang.cjs')
  const pidFile = join(dir, 'leftover.pid')
  await writeFile(
    script,
    `const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')

if (process.argv[2] === 'leftover') {
  setTimeout(() => process.exit(0), ${LINGER_SECONDS} * 1000)
} else {
  const leftover = spawn(process.execPath, [__filename, 'leftover'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  })
  leftover.unref()
  writeFileSync(${JSON.stringify(pidFile)}, String(leftover.pid))
  process.stdout.write('started, and not about to finish\\n')
  setTimeout(() => {}, ${LINGER_SECONDS} * 1000)
}
`,
  )

  const check = runVerify({
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`,
    cwd,
    timeoutMs: 2_000,
  })

  try {
    const result = await within(check, 15_000)
    // First, that there was a leftover at all. A command killed before it started one would settle
    // on `'close'` and pass this test without testing anything.
    assert.ok((await leftoverPid(pidFile)) !== null, 'the command was killed before it left anything behind')
    assert.ok(result !== 'still pending', 'still pending fifteen seconds in, thirteen past its own deadline')

    assert.equal(result.timedOut, true)
    assert.equal(result.passed, false)
    assert.equal(result.exitCode, null, 'killed by the deadline, so it has no exit code of its own')
    assert.match(result.output, /started, and not about to finish/)
  } finally {
    await killLeftover(pidFile)
  }
})

test('an exit disarms the deadline, even when the drain runs on past it', async (t) => {
  // Test 12's deadline is ten seconds, well past the command's exit plus the drain, so a deadline
  // the exit failed to clear had nothing to fire into: deleting that `clearTimeout` left all
  // thirteen tests above passing — found by the review of #234, and measured again on 2026-09-15.
  // Here the deadline falls after the exit and before the drain ends. The review measured what a
  // deadline still armed does there: it kills the command's group after the command was reaped,
  // and reports a command that exited 0 as timed out and failed.
  const dir = await tempDir(t, 'office-verify-grouped-')
  const pidFile = join(dir, 'leftover.pid')
  const check = runVerify({
    command: `sleep 0.3; echo answered; sleep ${LINGER_SECONDS} & echo $! > ${JSON.stringify(pidFile)}`,
    cwd,
    timeoutMs: 1_500,
  })

  try {
    const result = await within(check, 15_000)
    assert.ok(result !== 'still pending', 'still pending fifteen seconds in')

    assert.equal(result.timedOut, false, 'the deadline fired after the command had exited')
    assert.equal(result.exitCode, 0)
    assert.equal(result.passed, true)
    assert.match(result.output, /answered/)

    // And nothing signalled the group once the command was gone. The wait gives a leftover that was
    // killed time to be reaped before its pid is probed.
    const pid = await leftoverPid(pidFile)
    assert.ok(pid !== null, 'the command did not record what it left behind')
    await sleep(500)
    assert.equal(isAlive(pid), true, 'the group was signalled after the command had exited')
  } finally {
    await killLeftover(pidFile)
  }
})

// ──────────────────────────── a test run that skipped a file it was given has not passed ──

/**
 * A new folder holding one test file that passes, for a runner to be pointed at.
 *
 * The commands below start with `env -u NODE_TEST_CONTEXT` because these tests run inside a test
 * runner, and `node --test` started from inside one runs nothing: measured on Node 22.16.0, it
 * warns "node:test run() is being called recursively within a test file. skipping running files."
 * and exits 0. That is the result these tests are about, arrived at for another reason.
 */
async function folderWithATest(t: TestContext): Promise<string> {
  const dir = await tempDir(t, 'office-verify-named-')
  await writeFile(join(dir, 'passes.test.mjs'), PASSING)
  return dir
}

const PASSING = "import { test } from 'node:test'\ntest('passes', () => {})\n"

test('a test run that names a file that is not there has not passed, though the runner exits 0', async (t) => {
  // `node --test a b` with `b` missing runs `a`, exits 0 and never mentions `b`, and `tsx --test`
  // does the same; each fails only when none of its files exist. Measured on 2026-09-17 with Node
  // 22.16.0 and tsx 4.23.12. So exit zero alone passed a VERIFY naming a test nobody wrote.
  const dir = await folderWithATest(t)
  const result = await runVerify({
    command: 'env -u NODE_TEST_CONTEXT node --test passes.test.mjs never-written.test.mjs',
    cwd: dir,
  })

  // The trap, as the runner reported it: it ran the one file it found, and exited 0.
  assert.equal(result.exitCode, 0, `the runner failed by itself, so this is not the trap:\n${result.output}`)
  assert.match(result.output, /pass 1/, 'the runner did not run the file that is there')
  assert.doesNotMatch(result.output, /never-written/, 'the runner named the missing file after all')

  assert.equal(result.passed, false, 'a check that never ran a test file its VERIFY names was reported passed')
  assert.deepEqual(result.missing, ['never-written.test.mjs'], 'the file it did not run is not named')
  assert.equal(result.timedOut, false)
  assert.equal(result.error, null, 'it ran, so this is a failure, not a check that could not be started')
})

test('a test run whose files are all there, beside a flag, passes as it did', async (t) => {
  // `passes.test.mjs` is only in `dir`, so this also says where the files are looked for: the
  // folder the command ran in, not the one this test process started in.
  const dir = await folderWithATest(t)
  const result = await runVerify({
    command: 'env -u NODE_TEST_CONTEXT node --test --test-reporter=spec passes.test.mjs',
    cwd: dir,
  })

  assert.equal(result.exitCode, 0, result.output)
  assert.match(result.output, /pass 1/, 'the runner ran nothing, so this checks nothing')
  assert.deepEqual(result.missing, [], 'a file that is there, or the flag, was called missing')
  assert.equal(result.passed, true)
})

test('a command that is not a test run is still judged by its exit code alone', async () => {
  const result = await runVerify({ command: 'echo --test never-written.test.mjs', cwd })

  assert.deepEqual(result.missing, [])
  assert.equal(result.passed, true)
})

test('a run whose option takes the next word passes, and its file is still looked for', async (t) => {
  // Each option's value here was once read as a test file, `tsx`, `passes`, `1` and `spec`, and
  // called missing, though the runner ran the file and passed.
  const dir = await folderWithATest(t)
  await writeFile(join(dir, 'passes.test.ts'), PASSING)
  // This checkout's packages, so `--import tsx` resolves from `dir`. A link: removing `dir` removes
  // the link and not what it points at.
  const modules = join(dir, 'node_modules')
  symlinkSync(dirname(dirname(fileURLToPath(import.meta.resolve('tsx/package.json')))), modules)
  try {
    for (const command of [
      'node --test --import tsx passes.test.ts',
      'node --test --test-name-pattern passes passes.test.mjs',
      'node --test --test-concurrency 1 passes.test.mjs',
      'node --test --test-reporter spec passes.test.mjs',
    ]) {
      const result = await runVerify({ command: `env -u NODE_TEST_CONTEXT ${command}`, cwd: dir })
      assert.equal(result.exitCode, 0, `${command}\n${result.output}`)
      assert.match(result.output, /pass 1/, `${command}: the runner ran nothing, so this checks nothing`)
      assert.deepEqual(result.missing, [], command)
      assert.deepEqual(result.unchecked, [], `${command}: its file was not looked for`)
      assert.equal(result.passed, true, command)
    }

    // And the value is all that is passed over: the same run naming a file that is not there has not passed.
    const result = await runVerify({
      command: 'env -u NODE_TEST_CONTEXT node --test --import tsx passes.test.ts never-written.test.ts',
      cwd: dir,
    })
    assert.equal(result.exitCode, 0, result.output)
    assert.deepEqual(result.missing, ['never-written.test.ts'])
    assert.equal(result.passed, false)
  } finally {
    unlinkSync(modules)
  }
})

test('an option written after the files is a file to the runner, and is looked for as one', async (t) => {
  // The runner's options end at its first file, and it skips a file it cannot find, so here the
  // reporter stays TAP and `spec` is a test file nobody wrote. Calling this passed would be the trap.
  // TAP is asked for before the file, because Node 24 prints spec when nothing is asked for
  // (measured, 24.3.0); had the runner read the later option too, it would print spec or, with two
  // reporters and no destinations, refuse to run (measured on 22.16.0: exit 1).
  const dir = await folderWithATest(t)
  const result = await runVerify({
    command: 'env -u NODE_TEST_CONTEXT node --test --test-reporter=tap passes.test.mjs --test-reporter spec',
    cwd: dir,
  })

  assert.equal(result.exitCode, 0, result.output)
  assert.match(result.output, /^# pass 1$/m, 'the runner did not print TAP, so it read the option as one')
  assert.deepEqual(result.missing, ['--test-reporter', 'spec'])
  assert.equal(result.passed, false)
})

test('a run whose files cannot be placed passes on its exit code, and says nothing looked for them', async (t) => {
  // Each of these runs `passes.test.mjs` and exits 0, and none is read, so none is failed for what
  // it names: `never-written.test.mjs`, which the runner skips, or `{}` and `+`, which `find`
  // replaces. The result says so rather than passing as if it had looked.
  const dir = await folderWithATest(t)
  const runner = 'env -u NODE_TEST_CONTEXT node --test'
  const run = `${runner} passes.test.mjs never-written.test.mjs`
  // The inner shell's text starts at the runner, as a person would write it; `env` goes outside.
  const nested = 'sh -c \\"node --test passes.test.mjs never-written.test.mjs\\"'
  const cases: [string, Unchecked][] = [
    [`cd . && ${run}`, { runner: 'node', reason: 'moves', word: 'cd' }],
    [`sh -c "${run}"`, { runner: 'node', reason: 'quoted', word: `"${run}"` }],
    [`env -u NODE_TEST_CONTEXT sh -c "${nested}"`, { runner: 'node', reason: 'quoted', word: `"${nested}"` }],
    [`find . -name passes.test.mjs -exec ${runner} {} +`, { runner: 'node', reason: 'prefix', word: 'find' }],
    [`echo passes.test.mjs | xargs ${runner} never-written.test.mjs`, { runner: 'node', reason: 'prefix', word: 'xargs' }],
  ]
  for (const [command, unchecked] of cases) {
    const result = await runVerify({ command, cwd: dir })
    assert.equal(result.exitCode, 0, `${command}\n${result.output}`)
    assert.match(result.output, /pass 1/, `${command}: the runner ran nothing, so this checks nothing`)
    assert.deepEqual(result.unchecked, [unchecked], command)
    assert.deepEqual(result.missing, [], `${command}: a file nothing could place was called missing`)
    assert.equal(result.passed, true, command)
  }
})

test('a path that names nothing is missing, and one the office cannot reach is left to the runner', async (t) => {
  // A path through a file names nothing (ENOTDIR), and is as missing as a name nobody wrote. A link
  // to itself (ELOOP) is there, and "not in the workspace folder" would be untrue of it.
  //
  // Whether the runner fails on the path through a file depends on the Node release: exit 7 on
  // 22.16.0 and 24.3.0, and exit 0 on 22.23.2, the version CI resolves `node-version: '22'` to,
  // which skips the path and runs the rest. So its exit code is not asserted. The panel's verdict
  // is, and holds on both, because a missing file fails the run whatever the runner said — which
  // is the case this check exists for.
  const dir = await folderWithATest(t)
  symlinkSync('loop.test.mjs', join(dir, 'loop.test.mjs'))
  const through = await runVerify({
    command: 'env -u NODE_TEST_CONTEXT node --test passes.test.mjs passes.test.mjs/inside.test.mjs',
    cwd: dir,
  })
  const loop = await runVerify({ command: 'env -u NODE_TEST_CONTEXT node --test passes.test.mjs loop.test.mjs', cwd: dir })

  assert.deepEqual(through.missing, ['passes.test.mjs/inside.test.mjs'])
  assert.equal(through.passed, false, `a path through a file passed the run:\n${through.output}`)

  assert.notEqual(loop.exitCode, 0, `the runner passed a link to itself:\n${loop.output}`)
  assert.deepEqual(loop.missing, [], 'a link that is there was called missing')
  assert.equal(loop.passed, false)
})

test('a VERIFY that puts its test file in place and then runs it has passed', async (t) => {
  // The files are looked for after the run, not before, because a VERIFY can build or copy what it
  // then tests. Looking first calls this one missing a file its runner then ran and passed.
  const dir = await folderWithATest(t)
  const result = await runVerify({
    command: 'mkdir -p made && cp passes.test.mjs made/a.test.mjs && env -u NODE_TEST_CONTEXT node --test made/a.test.mjs',
    cwd: dir,
  })

  assert.equal(result.exitCode, 0, result.output)
  assert.match(result.output, /pass 1/, 'the runner did not run the file the VERIFY made')
  assert.deepEqual(result.missing, [], 'a file the VERIFY made before its runner started was called missing')
  assert.equal(result.passed, true)
})

test('a VERIFY that writes a test, runs it and deletes it is still missing that file', async (t) => {
  // The cost of looking after the run, pinned so that changing it is a decision. The runner ran the
  // file and it passed; by the time anything looks, the VERIFY has deleted it.
  const dir = await folderWithATest(t)
  const result = await runVerify({
    command: 'cp passes.test.mjs gone.test.mjs && env -u NODE_TEST_CONTEXT node --test gone.test.mjs && rm gone.test.mjs',
    cwd: dir,
  })

  assert.equal(result.exitCode, 0, result.output)
  assert.match(result.output, /pass 1/, 'the runner did not run the file, so this is not the case it pins')
  assert.deepEqual(result.missing, ['gone.test.mjs'])
  assert.equal(result.passed, false)
})

// ─────────────────── a note about --test that no run read, and the words a runner skips ──

test('a note about --test that no run read is kept after an exit 0, and only then', async () => {
  // `echo "node --test done"` runs no test, and is said only as text holding `--test`. A line the
  // shell refuses, a quote that never closes, ran none of its text, and a command that did not
  // exit 0 has said no by itself, so neither gets that note. A note about a run the office found
  // stays after a failure.
  const said = await runVerify({ command: 'echo "node --test done"', cwd })
  assert.equal(said.exitCode, 0, said.output)
  assert.equal(said.passed, true)
  assert.deepEqual(said.unchecked, [{ runner: null, reason: 'unread', word: '"node --test done"' }])

  const unclosed = await runVerify({ command: 'node --test never-run.test.mjs "b.test.mjs', cwd })
  assert.equal(unclosed.exitCode, 2, `the shell did not refuse the line:\n${unclosed.output}`)
  assert.deepEqual(unclosed.unchecked, [])
  assert.deepEqual(unclosed.missing, [])

  const failed = await runVerify({ command: 'echo "node --test done"; exit 1', cwd })
  assert.equal(failed.exitCode, 1, failed.output)
  assert.deepEqual(failed.unchecked, [])

  const late = await runVerify({ command: 'echo "node --test done"; sleep 5', cwd, timeoutMs: 300 })
  assert.equal(late.timedOut, true)
  assert.deepEqual(late.unchecked, [])

  const moved = await runVerify({ command: 'cd . && false && node --test never-run.test.mjs', cwd })
  assert.equal(moved.exitCode, 1, moved.output)
  assert.deepEqual(moved.unchecked, [{ runner: 'node', reason: 'moves', word: 'cd' }])
})

test('a file two runs name is missing once', async () => {
  const name = 'office-verify-named-twice-never-written.test.mjs'
  const run = `env -u NODE_TEST_CONTEXT node --test ${name}`
  const result = await runVerify({ command: `${run}; ${run}`, cwd })

  assert.notEqual(result.exitCode, 0, `the runner found the file, so this is not the case:\n${result.output}`)
  assert.deepEqual(result.missing, [name])
  assert.equal(result.passed, false)
})

test('a file written with a slash at its end has to be a folder', async (t) => {
  // Measured on Node 22.16.0: `node --test a.test.mjs a.test.mjs/` ran `a` and exited 0, so the
  // runner skipped the word with the slash, where `resolve`, which drops the slash, found the file.
  const dir = await folderWithATest(t)
  mkdirSync(join(dir, 'sub'))
  const runner = 'env -u NODE_TEST_CONTEXT node --test passes.test.mjs'

  const file = await runVerify({ command: `${runner} passes.test.mjs/`, cwd: dir })
  assert.equal(file.exitCode, 0, file.output)
  assert.match(file.output, /pass 1/, 'the runner ran nothing, so this checks nothing')
  assert.deepEqual(file.missing, ['passes.test.mjs/'])
  assert.equal(file.passed, false)

  const nothing = await runVerify({ command: `${runner} never-written/`, cwd: dir })
  assert.equal(nothing.exitCode, 0, nothing.output)
  assert.deepEqual(nothing.missing, ['never-written/'])
  assert.equal(nothing.passed, false)

  // A folder that is there is not missing. The runner fails on it by itself (measured: it tried to
  // load the folder as a module).
  const folder = await runVerify({ command: `${runner} sub/`, cwd: dir })
  assert.notEqual(folder.exitCode, 0, folder.output)
  assert.deepEqual(folder.missing, [])
})

/** A passing test file that leaves a line in `marks.log`, in the folder it runs from, when it runs. */
const MARKING =
  "import { test } from 'node:test'\nimport { appendFileSync } from 'node:fs'\n" +
  "appendFileSync('marks.log', 'ran\\n')\ntest('passes', () => {})\n"

test('a test run out of sight that skips a file does not pass with nothing said', async (t) => {
  // The third review's shell forms, run for real. Each runs `marks.test.mjs`, skips
  // `never-written.test.mjs`, and exits 0; at 47ac339 each came back passed with nothing said.
  // Each must now be failed, or say what was not looked at.
  const dir = await folderWithATest(t)
  await writeFile(join(dir, 'marks.test.mjs'), MARKING)
  const run = 'env -u NODE_TEST_CONTEXT node --test marks.test.mjs never-written.test.mjs'
  for (const command of [
    `[ "$(${run} 2>&1 | grep -c '^not ok')" = 0 ]`,
    `echo "$(${run})"`,
    `echo \`${run}\``,
    `echo "\`${run}\`"`,
    `x=\`${run}\``,
    `eval ${run}`,
    `${run}; echo $'it\\'s'`,
    'env -u NODE_TEST_CONTEXT node --test marks.test.mjs marks.test.mjs/',
    // On a disk that is not case-insensitive the shell finds no `Node`, and this fails by itself.
    'env -u NODE_TEST_CONTEXT Node --test marks.test.mjs never-written.test.mjs',
    // The fourth review's: a `#` the split once took for a comment, a `$$`, a brace list, an escape,
    // and a runner by another name; at 3aacd2c each came back passed with nothing said.
    `echo "$(echo "a #")"; ${run}`,
    `[ "$(printf "%s #" x)" = "x #" ] && ${run}`,
    `[ \`printf 1 #count\` -gt 0 ] && ${run}`,
    `echo $$'\\'; echo ' #'; ${run}`,
    'env -u NODE_TEST_CONTEXT node --test {marks,never-written}.test.mjs',
    "env -u NODE_TEST_CONTEXT node --test 'marks.test.mjs' '{marks,never-written}.test.mjs'",
    'env -u NODE_TEST_CONTEXT node --tes{t,t} marks.test.mjs never-written.test.mjs',
    "env -u NODE_TEST_CONTEXT node $'--te\\x73t' marks.test.mjs never-written.test.mjs",
    "env -u NODE_TEST_CONTEXT sh -c $'node --te\\x73t marks.test.mjs never-written.test.mjs'",
    `NODE_BIN=node; env -u NODE_TEST_CONTEXT $NODE_BIN --test marks.test.mjs never-written.test.mjs`,
    'ln -sf "$(command -v node)" nodejs && env -u NODE_TEST_CONTEXT ./nodejs --test marks.test.mjs never-written.test.mjs',
  ]) {
    await writeFile(join(dir, 'marks.log'), '')
    const result = await runVerify({ command, cwd: dir })
    if (result.exitCode === 0) {
      assert.match(await readFile(join(dir, 'marks.log'), 'utf8'), /ran/, `${command}: the runner ran nothing`)
    }
    assert.deepEqual(result.missing.filter((file) => file !== 'never-written.test.mjs' && file !== 'marks.test.mjs/'), [])
    assert.ok(
      !result.passed || result.unchecked.length > 0,
      `${command}\npassed with nothing said: ${JSON.stringify(result)}`,
    )
  }
})

test('a test file a shell only prints is not called missing, and the run it did make passes', async (t) => {
  // The fourth review's false failure, and one beside it. In each, the shell only echoes the text
  // naming `never-written.test.mjs` (a `$$` before a quote, and quotes inside a `$(…)` in double
  // quotes), and then runs `passes.test.mjs`. At 3aacd2c both were failed, the file called missing.
  const dir = await folderWithATest(t)
  const runner = 'env -u NODE_TEST_CONTEXT node --test passes.test.mjs'
  const cases: [string, string][] = [
    [`echo $$'\\'; echo '; node --test never-written.test.mjs; #'; ${runner}`, `'; node --test never-written.test.mjs; #'`],
    [`echo "$(echo "a; node --test never-written.test.mjs")"; ${runner}`, '"$(echo "a; node --test never-written.test.mjs")"'],
  ]
  for (const [command, echoed] of cases) {
    const result = await runVerify({ command, cwd: dir })
    assert.equal(result.exitCode, 0, `${command}\n${result.output}`)
    assert.match(result.output, /pass 1/, `${command}: the runner ran nothing`)
    assert.match(result.output, /never-written\.test\.mjs/, `${command}: the shell did not print the text`)
    assert.deepEqual(result.missing, [], `${command}: a file only printed was called missing`)
    assert.deepEqual(result.unchecked, [{ runner: null, reason: 'unread', word: echoed }], command)
    assert.equal(result.passed, true, command)
  }
})

const FAILING = "import { test } from 'node:test'\ntest('fails', () => { throw new Error('boom') })\n"

test('a test file in node_modules is said, not called missing, because the runner leaves it out', async (t) => {
  // Measured on 2026-09-17 with Node 22.16.0 and 24.3.0: the runner left out the failing file under
  // `node_modules`, ran the other, and exited 0. The file is there, so it is not missing; the run is
  // not read, and says why. The controls, a `node_modules` further in and an absolute path, ran it.
  const dir = await folderWithATest(t)
  for (const folder of ['node_modules', 'sub/node_modules']) {
    mkdirSync(join(dir, folder), { recursive: true })
    await writeFile(join(dir, folder, 'fails.test.mjs'), FAILING)
  }
  const runner = 'env -u NODE_TEST_CONTEXT node --test passes.test.mjs'

  for (const file of ['node_modules/fails.test.mjs', './node_modules/fails.test.mjs']) {
    const left = await runVerify({ command: `${runner} ${file}`, cwd: dir })
    assert.equal(left.exitCode, 0, `the runner ran ${file}, so this is not the trap:\n${left.output}`)
    assert.match(left.output, /pass 1/, 'the runner ran nothing, so this checks nothing')
    assert.doesNotMatch(left.output, /fail 1|boom/, `the runner ran ${file}`)
    assert.deepEqual(left.missing, [], `${file} is there, and was called missing`)
    assert.deepEqual(left.unchecked, [{ runner: 'node', reason: 'excluded', word: file }])
    assert.equal(left.passed, true)
  }

  for (const file of ['sub/node_modules/fails.test.mjs', `'${join(dir, 'node_modules', 'fails.test.mjs')}'`]) {
    const ran = await runVerify({ command: `${runner} ${file}`, cwd: dir })
    assert.notEqual(ran.exitCode, 0, `the runner left out ${file}:\n${ran.output}`)
    assert.match(ran.output, /boom/, `the runner did not run ${file}`)
    assert.deepEqual(ran.unchecked, [], file)
    assert.deepEqual(ran.missing, [], file)
    assert.equal(ran.passed, false)
  }
})
