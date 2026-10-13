/**
 * Local checks run CI’s three steps in order, on the Node they checked, and stop at the first
 * failure (an exit code, a ceiling, a signal, a step that cannot start, or output held open),
 * cleaning up after a stop or a crash.
 *
 * One of six files that pin `scripts/ci-local.mjs`'s promises; the list, and the rig they
 * share, are in `local-checks-rig.ts`. Split from one file on 2026-09-24 so that each fits the
 * suite’s minute per file on a loaded machine.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { constants } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

import { SKIP, gitIn, stub, aRepo, withOrigin, posted, run, start, lines, seen, alive, until, collect, pidsIn, pidsWritten, pidFile, report } from './local-checks-rig.js'

test('a passing run takes CI\'s three steps in order, reports the suite\'s own counts, and leaves nothing behind', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const r = run(rig)
  assert.equal(r.code, 0, r.stderr)

  const steps = await seen(rig)
  assert.deepEqual(steps.map((line) => line.split(' ')[0]), ['typecheck', 'build', 'coverage'], 'the steps did not run in CI\'s order')

  // One temp folder, the same for every step, under the base it was given, and gone now.
  const folders = new Set(steps.map((line) => line.split(' ')[1]))
  assert.equal(folders.size, 1, `each step got a different temp folder: ${[...folders].join(', ')}`)
  const [folder] = [...folders] as [string]
  assert.ok(folder.includes(`${join('tmp-base', 'osc-')}`), `the temp folder was not the run's own: ${folder}`)
  assert.equal(existsSync(folder), false, 'the run left its temp folder behind')
  assert.equal(existsSync(rig.lock), false, 'the run left its lock behind')

  assert.match(r.stdout, /^tests {7}3 tests: 2 pass, 0 fail, 0 cancelled, 1 skipped$/m, 'the suite\'s counts were not reported as the suite gave them')
  assert.match(r.stdout, /^coverage {4}all files \| 81\.20/m)
  assert.match(r.stdout, /^left behind 1 entries \(1 office-\*\)/m, 'what the suite left behind was not counted')
  assert.match(r.stdout, /not CI, and not Linux/, 'the report does not say where it ran')
  assert.match(r.stdout, /^result {6}PASSED$/m)

  const saved = await report(rig)
  assert.equal(saved['passed'], true)
  assert.equal(saved['dirty'], false)
  const ran = saved['steps'] as { name: string; ceilingSeconds: number }[]
  assert.deepEqual(ran.map((s) => s.name), ['typecheck', 'build', 'tests, with coverage'])
  // CI's whole job, checkout and `npm ci` included, is killed at twenty minutes.
  const ceilings = ran.map((s) => s.ceilingSeconds)
  assert.ok(ceilings.every((seconds) => seconds > 0), `ceilings ${ceilings.join(', ')}`)
  assert.ok(ceilings.reduce((sum, seconds) => sum + seconds, 0) <= 20 * 60, `the ceilings add up past CI's twenty minutes: ${ceilings.join(' + ')} s`)
  assert.equal(saved['ceilingsFrom'], 'this script')
  // What ran the steps was this file's stand-in, not npm, and the report says so.
  const npm = rig.env['OFFICE_CHECKS_NPM']
  assert.equal(saved['npmFrom'], `OFFICE_CHECKS_NPM=${npm}`)
  assert.ok(r.stdout.split('\n').includes(`npm         ${npm}, from OFFICE_CHECKS_NPM`), `the report does not name the stand-in for npm:\n${r.stdout}`)
})

test('a failing step stops the run, and the run fails', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const r = run(rig, [], { STEP_FAIL: 'build' })
  assert.equal(r.code, 1, 'a failed build was not a failed run')
  assert.deepEqual((await seen(rig)).map((line) => line.split(' ')[0]), ['typecheck', 'build'], 'the suite ran after the build failed')
  assert.match(r.stdout, /^build {17}failed \(exit 3\)/m)
  assert.match(r.stdout, /^tests, with coverage {2}not run, because an earlier step failed$/m, 'the step that never ran was not named')
  assert.match(r.stdout, /^result {6}FAILED$/m)
  const saved = await report(rig)
  assert.equal(saved['passed'], false)
  assert.deepEqual(saved['notRun'], ['tests, with coverage'])
  assert.equal(existsSync(rig.lock), false, 'a failed run kept the lock')
})

test('the steps run on the Node the script checked, whatever node the caller\'s PATH finds first', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  // A shell whose PATH starts with another Node, the way this machine's login shell starts with
  // Homebrew's. `tsc` and `tsx` start with `#!/usr/bin/env node`, so they would run on it.
  const other = join(rig.base, 'other-node')
  await stub(join(other, 'node'), '#!/bin/sh\necho v24.3.0-stand-in\n')
  const nodeSeen = join(rig.base, 'node-seen')
  const r = run(rig, [], { NODE_SEEN: nodeSeen, PATH: `${other}${delimiter}${rig.env['PATH'] ?? ''}` })
  assert.equal(r.code, 0, r.stderr)
  const checked = `${join(dirname(process.execPath), 'node')} ${process.version}`
  assert.deepEqual(await lines(nodeSeen), ['typecheck', 'build', 'coverage'].map((step) => `${step} ${checked}`), 'a step ran on a Node other than the one the report names')
  assert.match(r.stdout, new RegExp(`Node ${process.versions.node} — not CI`))
})

test('a step that outlives its ceiling fails, and its whole process group goes with it', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const pids = pidFile(t)
  const started = Date.now()
  const r = run(rig, [], { STEP_HANG: 'build', PIDS: pids, OFFICE_CHECKS_CEILING_SECONDS: '1' })
  const took = Date.now() - started
  assert.equal(r.code, 1, r.stderr)
  assert.ok(took < 15_000, `the run took ${took} ms`)
  assert.match(r.stdout, /^build {17}timed out in [\d.]+s, at its ceiling of 1s$/m)
  assert.match(r.stdout, /^tests, with coverage {2}not run, because an earlier step failed$/m)
  assert.match(r.stdout, /^result {6}FAILED$/m)
  for (const pid of await pidsIn(pids)) await until(() => (alive(pid) ? undefined : true), `pid ${pid}, which the step started, to be gone`)
  const saved = await report(rig)
  assert.equal(saved['passed'], false)
  assert.deepEqual((saved['steps'] as { timedOut: boolean }[]).map((s) => s.timedOut), [false, true])
})

test('what a step leaves running in its own process group is killed when the step exits', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const pids = pidFile(t)
  const r = run(rig, [], { STEP_LEAVE: 'build', PIDS: pids })
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /^build {17}passed in [\d.]+s$/m)
  const [left] = await pidsIn(pids)
  assert.ok(left !== undefined && left > 0)
  await until(() => (alive(left) ? undefined : true), `pid ${left}, which the build left running, to be gone`)
})

test('a step is over when its process exits, even while something it started holds its output', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const pids = pidFile(t)
  const started = Date.now()
  // The holder lives 30 s, as long as the harness waits for the whole run.
  const r = run(rig, [], { STEP_HOLD: 'typecheck', PIDS: pids })
  const took = Date.now() - started
  assert.equal(r.code, 1, r.stderr)
  assert.ok(took < 15_000, `the run waited ${took} ms on a process outside the step`)
  assert.match(r.stdout, /^typecheck {13}exited 0 in [\d.]+s, but something it started outside its process group still held its output 2s later$/m)
  assert.deepEqual((await seen(rig)).map((line) => line.split(' ')[0]), ['typecheck'])
  assert.match(r.stdout, /^result {6}FAILED$/m)
  assert.equal(existsSync(rig.lock), false, 'the run kept its lock')
  const [holder] = await pidsIn(pids)
  assert.ok(holder !== undefined && alive(holder), 'the holder had already gone, so nothing was held')
})

test('a stopped run kills its step and everything the step started, then releases its folder and lock', { skip: SKIP }, async (t) => {
  const cases = [
    { signal: 'SIGINT', hungUp: false },
    { signal: 'SIGTERM', hungUp: false },
    { signal: 'SIGHUP', hungUp: false },
    // Ctrl-\ on a terminal.
    { signal: 'SIGQUIT', hungUp: false },
    // A closed terminal: nothing reads what the run writes any more.
    { signal: 'SIGHUP', hungUp: true },
  ] as const
  for (const { signal, hungUp } of cases) {
    const what = `${signal}${hungUp ? ' with nothing reading' : ''}`
    const rig = await aRepo(t)
    await withOrigin(rig)
    const pids = pidFile(t)
    const running = start(t, rig, ['--post-status'], { STEP_HANG: 'build', PIDS: pids })
    const step = await until(async () => {
      const found = await pidsIn(pids).catch(() => [])
      return found.length === 2 ? found : undefined
    }, `${what}: the build to start`)
    if (hungUp) {
      running.child.stdout.destroy()
      running.child.stderr.destroy()
    }
    const signalled = Date.now()
    running.child.kill(signal)
    const r = await running.done
    // The build would sleep for a minute; a run that waited for it instead of killing it is too late.
    assert.ok(Date.now() - signalled < 10_000, `${what}: the run took ${Date.now() - signalled} ms to stop`)
    assert.equal(r.code, 128 + constants.signals[signal], `${what}: ${r.stderr}`)
    for (const pid of step) await until(() => (alive(pid) ? undefined : true), `${what}: pid ${pid}, which the build started, to be gone`)
    assert.deepEqual(await readdir(rig.tmpBase), [], `${what} left the run's temp folder`)
    assert.equal(existsSync(rig.lock), false, `${what} left the lock`)
    assert.deepEqual((await seen(rig)).map((line) => line.split(' ')[0]), ['typecheck', 'build'], `${what}: a step ran after the stop`)
    assert.deepEqual(await lines(rig.ghLog), [], `${what}: a stopped run was posted`)
    if (hungUp) continue
    assert.match(r.stdout, new RegExp(`^stopped {5}by ${signal}`, 'm'))
    assert.match(r.stdout, /^tests, with coverage {2}not run, because the run was stopped$/m)
    assert.match(r.stdout, /^result {6}FAILED$/m)
    assert.match(r.stderr, /status not posted: the run was stopped/)
  }
})

test('the verdict is the steps\' own: a last step that exits 1 fails the run, whatever its summary says', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  const r = run(rig, ['--post-status'], { COVERAGE_EXIT: '1' })
  assert.equal(r.code, 1, r.stdout)
  assert.match(r.stdout, /^tests {7}3 tests: 2 pass, 0 fail, 0 cancelled, 1 skipped$/m, 'the summary this case relies on was not clean')
  assert.match(r.stdout, /^tests, with coverage {2}failed \(exit 1\)/m)
  assert.match(r.stdout, /^result {6}FAILED$/m)
  assert.equal((await report(rig))['passed'], false)
  assert.equal((await posted(rig)).fields['state'], 'failure')
})

test('a step killed by a signal has no exit code, and that is a failure that stops the run', { skip: SKIP }, async (t) => {
  // First: nothing after it may run.
  const first = await aRepo(t)
  const early = run(first, [], { STEP_KILL: 'typecheck' })
  assert.equal(early.code, 1, early.stdout)
  assert.deepEqual((await seen(first)).map((line) => line.split(' ')[0]), ['typecheck'], 'steps ran after one was killed')
  assert.match(early.stdout, /^build {17}not run, because an earlier step failed$/m)
  assert.match(early.stdout, /^result {6}FAILED$/m)
  assert.match(early.stdout, /^typecheck {13}killed by SIGKILL in [\d.]+s$/m)
  const steps = (await report(first))['steps'] as { name: string; code: number | null; signal: string | null }[]
  assert.deepEqual(steps.map((step) => [step.name, step.code, step.signal]), [['typecheck', null, 'SIGKILL']])

  // Last, and only after a complete, clean summary: the kill alone has to fail it.
  const last = await aRepo(t)
  const late = run(last, [], { STEP_KILL: 'coverage' })
  assert.equal(late.code, 1, late.stdout)
  assert.match(late.stdout, /^tests {7}3 tests: 2 pass, 0 fail, 0 cancelled, 1 skipped$/m)
  assert.match(late.stdout, /^result {6}FAILED$/m)
  assert.equal((await report(last))['passed'], false)
})

test('a step that cannot start says why, in the report and in its file', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const npm = join(rig.base, 'no-such-npm')
  const r = run(rig, [], { OFFICE_CHECKS_NPM: npm })
  assert.equal(r.code, 1, r.stdout)
  assert.match(r.stdout, new RegExp(`^typecheck {13}could not start in [\\d.]+s: spawn ${npm} ENOENT$`, 'm'))
  assert.match(r.stdout, /^build {17}not run, because an earlier step failed$/m)
  assert.match(r.stdout, /^result {6}FAILED$/m)
  const steps = (await report(rig))['steps'] as { error: string | null }[]
  assert.match(steps[0]?.error ?? '', /ENOENT/)
  assert.equal(existsSync(rig.lock), false)
})

test('a run that breaks on something it did not expect exits 5, and releases the lock it took', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const r = run(rig, [], { OFFICE_CHECKS_TMP_BASE: join(rig.base, 'no-such-temp-base') })
  assert.equal(r.code, 5, `${r.stdout}\n${r.stderr}`)
  assert.match(r.stderr, /^crashed: .*ENOENT/m)
  assert.equal(existsSync(rig.lock), false, 'the crash left the lock behind')
  assert.deepEqual(await seen(rig), [])

  // Before the lock: a file where the worktrees directory would be.
  const odd = await aRepo(t)
  await mkdir(join(odd.root, '.claude'))
  await writeFile(join(odd.root, '.claude', 'worktrees'), 'not a directory\n')
  gitIn(odd.root, 'add', '-A')
  gitIn(odd.root, 'commit', '-qm', 'a file named worktrees')
  const early = run(odd)
  assert.equal(early.code, 5, `${early.stdout}\n${early.stderr}`)
  assert.match(early.stderr, /^crashed: .*ENOTDIR/m)
  assert.equal(existsSync(odd.lock), false)
})

test('a stop that comes while a finished step\'s output is still held keeps the next step from starting', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const pids = pidFile(t)
  const release = join(rig.base, 'release')
  const running = start(t, rig, [], { STEP_HOLD_UNTIL: 'typecheck', PIDS: pids, RELEASE: release })
  const stderr = collect(running.child.stderr)
  const [step = 0, holder = 0] = await pidsWritten(pids, 2, 'the typecheck to leave its output held')
  // The typecheck itself has exited, and the run is waiting for its output to close.
  await until(() => (alive(step) ? undefined : true), 'the typecheck itself to exit')
  const exited = Date.now()
  running.child.kill('SIGINT')
  await until(() => (stderr().includes('SIGINT: stopping') ? true : undefined), 'the run to take the SIGINT')
  // Let go well inside the run's two seconds of grace: the typecheck then passes, and only the stop
  // can keep the build from starting.
  await writeFile(release, '')
  await until(() => (alive(holder) ? undefined : true), 'what held the output to let go')
  const letGo = Date.now() - exited
  const r = await running.done
  assert.equal(r.code, 130, `${r.stdout}\n${r.stderr}`)
  assert.match(r.stdout, /^typecheck {13}passed in [\d.]+s$/m, `the output was let go ${letGo} ms after the typecheck exited, and the typecheck did not pass, so this did not test a stop between steps`)
  assert.deepEqual((await seen(rig)).map((line) => line.split(' ')[0]), ['typecheck'], 'a step started after the stop')
  assert.match(r.stdout, /^build {17}not run, because the run was stopped$/m)
  assert.match(r.stdout, /^result {6}FAILED$/m)
  assert.deepEqual(await readdir(rig.tmpBase), [])
  assert.equal(existsSync(rig.lock), false)
})

test('a crash in the middle of a step still kills the step, and releases the folder and the lock', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const pids = pidFile(t)
  // Something the script does not expect, while the build runs: a listener, loaded before the
  // script, that throws when the test sends SIGUSR2. The run's own `finally` never gets to run.
  const preload = join(rig.base, 'throw-on-usr2.cjs')
  await writeFile(preload, "process.on('SIGUSR2', () => { throw new Error('thrown on purpose, while a step runs') })\n")
  const running = start(t, rig, [], { STEP_HANG: 'build', PIDS: pids, NODE_OPTIONS: `--require "${preload}"` })
  const step = await pidsWritten(pids, 2, 'the build to start')
  running.child.kill('SIGUSR2')
  const r = await running.done
  assert.equal(r.code, 5, `${r.stdout}\n${r.stderr}`)
  assert.match(r.stderr, /^crashed: Error: thrown on purpose, while a step runs$/m)
  assert.equal(existsSync(rig.lock), false, 'the crash left the lock, for the next run to take over while the build still runs')
  assert.deepEqual(await readdir(rig.tmpBase), [], 'the crash left the run\'s temp folder')
  for (const pid of step) await until(() => (alive(pid) ? undefined : true), `pid ${pid}, which the build started, to be gone`)
})
