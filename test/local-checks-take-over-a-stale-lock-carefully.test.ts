/**
 * Local checks take over a stale lock carefully: a lock whose owner has died, or an empty one,
 * does not block forever; a takeover never moves aside a lock another run took meanwhile; and a
 * lock taken under other rules says so.
 *
 * One of six files that pin `scripts/ci-local.mjs`'s promises; the list, and the rig they
 * share, are in `local-checks-rig.ts`. Split from one file on 2026-09-24 so that each fits the
 * suite’s minute per file on a loaded machine.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { SKIP, aRepo, run, type Finished, start, lines, seen, until, collect } from './local-checks-rig.js'

test('a lock whose owner has died is taken over rather than waited on forever', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const gone = spawnSync('true')
  assert.ok(gone.pid !== undefined && gone.pid > 0)
  await mkdir(rig.lock)
  await writeFile(join(rig.lock, 'owner.json'), JSON.stringify({ pid: gone.pid, sha: 'abcdef1', startedAt: '2026-09-17T05:00:00.000Z' }))

  const r = run(rig)
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stderr, /taking over a lock left by pid \d+, which is no longer running/)
  assert.equal((await seen(rig)).length, 3)
  // The dead run's lock is kept aside, not deleted, and the new run's own lock is gone.
  const aside = (await readdir(rig.base)).filter((name) => name.startsWith('lock.stale-'))
  assert.equal(aside.length, 1, `expected one lock moved aside, found ${aside.join(', ')}`)
  assert.equal(JSON.parse(await readFile(join(rig.base, aside[0] ?? '', 'owner.json'), 'utf8')).pid, gone.pid)
  assert.equal(existsSync(rig.lock), false, 'the run left its lock behind')
})

test('an empty lock directory, which no run leaves behind for long, is taken at once', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await mkdir(rig.lock)
  const r = run(rig)
  assert.equal(r.code, 0, r.stderr)
  assert.equal((await seen(rig)).length, 3)
  assert.equal(existsSync(rig.lock), false)
})

test('runs that find the same dead owner take the lock one at a time', { skip: SKIP }, async (t) => {
  const gone = spawnSync('true')
  for (let trial = 0; trial < 4; trial++) {
    const rig = await aRepo(t)
    await mkdir(rig.lock)
    await writeFile(join(rig.lock, 'owner.json'), JSON.stringify({ pid: gone.pid, sha: 'abcdef1', startedAt: '2026-09-17T05:00:00.000Z' }))
    const overlap = join(rig.base, 'running')
    const runs = Array.from({ length: 8 }, () => start(t, rig, [], { OVERLAP: overlap }))
    const ends = await Promise.all(runs.map((r) => r.done))
    const codes = ends.map((end) => end.code)
    assert.ok(codes.every((code) => code === 0 || code === 3), `trial ${trial}: exits ${codes.join(' ')}\n${ends.map((end) => end.stderr).join('\n')}`)
    assert.ok(codes.includes(0), `trial ${trial}: no run took the lock: ${codes.join(' ')}`)
    assert.deepEqual(await lines(`${overlap}.seen`), [], `trial ${trial}: steps of two runs overlapped; exits ${codes.join(' ')}`)
    assert.equal(existsSync(rig.lock), false, `trial ${trial}: a lock was left behind`)
  }
})

test('a run that judged a lock stale cannot move aside the lock another run took meanwhile', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const gone = spawnSync('true')
  await mkdir(rig.lock)
  await writeFile(join(rig.lock, 'owner.json'), JSON.stringify({ pid: gone.pid, sha: 'abcdef1', startedAt: '2026-09-17T05:00:00.000Z', token: 'dead', lockRules: 2 }))
  const pause = join(rig.base, 'pause')
  const hold = join(rig.base, 'hold')
  const lateSteps = join(rig.base, 'late-steps')
  const firstSteps = join(rig.base, 'first-steps')

  // The late run finds the dead owner, judges the lock stale, and waits right there.
  const late = start(t, rig, [], { OFFICE_CHECKS_TAKEOVER_PAUSE: pause, STARTED: lateSteps })
  await until(() => (existsSync(`${pause}.reached`) ? true : undefined), 'the late run to judge the lock', 15_000)

  // Meanwhile another run takes the same lock over, and is still in its first step.
  const first = start(t, rig, [], { STARTED: firstSteps, STEP_WAIT: 'typecheck', WAIT_FOR: hold })
  await until(async () => ((await lines(firstSteps)).length > 0 ? true : undefined), 'the first run to start its typecheck', 15_000)

  // Now the late run goes on, towards a lock that is no longer the one it judged.
  await writeFile(`${pause}.go`, '')
  const l = await late.done
  await writeFile(hold, '')
  const f = await first.done

  assert.equal(l.code, 3, `the late run took the lock the first run held:\n${l.stderr}`)
  assert.match(l.stderr, /another run holds .*One full suite at a time/)
  assert.deepEqual(await lines(lateSteps), [], 'the late run ran steps while the first run held the lock')
  assert.equal(f.code, 0, f.stderr)
  assert.doesNotMatch(f.stderr, /no longer this run's lock/, 'the first run lost its lock while it ran')
  assert.deepEqual(await lines(firstSteps), ['typecheck', 'build', 'coverage'])
  // The dead owner's lock is the one moved aside, and the only one.
  const aside = (await readdir(rig.base)).filter((name) => name.startsWith('lock.stale-'))
  const owners = await Promise.all(aside.map(async (name) => JSON.parse(await readFile(join(rig.base, name, 'owner.json'), 'utf8')).token))
  assert.deepEqual(owners, ['dead'], `the locks moved aside: ${aside.join(', ')}`)
  assert.equal(existsSync(rig.lock), false)
})

test('a lock taken under other lock rules says so, whether its owner is running or not', { skip: SKIP }, async (t) => {
  // The first version of this script wrote no token and no rules.
  const first = { sha: 'abcdef1', startedAt: '2026-09-17T05:00:00.000Z' }
  const gone = spawnSync('true').pid
  const cases = [
    { what: 'a running older copy', owner: { pid: process.pid, ...first }, code: 3, says: /taken by a copy of this script from before its current lock rules, which can remove a lock another run has just taken/ },
    { what: 'a dead older copy', owner: { pid: gone, ...first }, code: 0, says: /^note: taking over a lock left by pid \d+, .* It was taken by a copy of this script from before its current lock rules/m },
    { what: 'a running copy with other rules', owner: { pid: process.pid, ...first, token: 'x', lockRules: 99 }, code: 3, says: /taken by a copy of this script with lock rules 99, where this one keeps 2/ },
  ]
  for (const c of cases) {
    const rig = await aRepo(t)
    await mkdir(rig.lock)
    await writeFile(join(rig.lock, 'owner.json'), JSON.stringify(c.owner))
    const r = run(rig)
    assert.equal(r.code, c.code, `${c.what}: ${r.stdout}\n${r.stderr}`)
    assert.match(r.stderr, c.says, c.what)
    assert.match(r.stderr, /fetch the script fresh for every run/, c.what)
  }

  // And a lock that an older copy took from under this run while it ran.
  const rig = await aRepo(t)
  const r = run(rig, [], { STEAL: 'build', STEAL_OLD: '1' })
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stderr, /is no longer this run's lock, so it was left where it is\. It was taken by a copy of this script from before its current lock rules/)
})

test('an empty OFFICE_CHECKS_TAKEOVER_PAUSE holds no takeover', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const gone = spawnSync('true')
  await mkdir(rig.lock)
  await writeFile(join(rig.lock, 'owner.json'), JSON.stringify({ pid: gone.pid, sha: 'abcdef1', startedAt: '2026-09-17T05:00:00.000Z', token: 'dead', lockRules: 2 }))
  // Set, but to nothing, as `OFFICE_CHECKS_TAKEOVER_PAUSE= node …` sets it. A pause would hold the
  // run for thirty seconds, so the test stops at its first sign: the note, or `.reached` in the checkout.
  const running = start(t, rig, [], { OFFICE_CHECKS_TAKEOVER_PAUSE: '' })
  const stderr = collect(running.child.stderr)
  let ended: Finished | undefined
  void running.done.then((finished) => (ended = finished))
  const paused = () => stderr().includes('as OFFICE_CHECKS_TAKEOVER_PAUSE asks') || existsSync(join(rig.root, '.reached'))
  const r = await until(() => (paused() ? null : ended), 'the run to end', 15_000)
  assert.ok(r !== null, `an empty OFFICE_CHECKS_TAKEOVER_PAUSE held the run:\n${stderr()}`)
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stderr, /^note: taking over a lock left by pid \d+, which is no longer running/m, 'the run never came to the takeover, so its pause was not tested')
})
