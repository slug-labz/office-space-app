/**
 * Local checks hold one lock at a time: a run in progress is not joined, a held lock refuses the
 * next run, only its holder releases it, and a lock that cannot be read, signalled or written is
 * left alone.
 *
 * One of six files that pin `scripts/ci-local.mjs`'s promises; the list, and the rig they
 * share, are in `local-checks-rig.ts`. Split from one file on 2026-09-24 so that each fits the
 * suite’s minute per file on a loaded machine.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { SKIP, gitIn, aRepo, run, seen } from './local-checks-rig.js'

test('a run already in progress is not joined', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await mkdir(rig.lock)
  await writeFile(join(rig.lock, 'owner.json'), JSON.stringify({ pid: process.pid, sha: 'abcdef1', startedAt: '2026-09-17T05:00:00.000Z' }))

  const r = run(rig)
  assert.equal(r.code, 3, r.stdout)
  assert.match(r.stderr, /another run holds .*pid \d+, on abcdef1/)
  // That owner record has no token, as the first version of this script wrote them.
  assert.match(r.stderr, /taken by a copy of this script from before its current lock rules/, 'a lock taken under older rules was not named as such')
  assert.deepEqual(await seen(rig), [], 'a step ran while another run held the lock')
  assert.equal(existsSync(join(rig.lock, 'owner.json')), true, 'the lock of a live run was taken away')
})

test('a lock whose owner cannot be read holds until it is older than any run could be, and says how to clear it', { skip: SKIP }, async (t) => {
  const cases: [string, (lock: string) => Promise<void>, RegExp][] = [
    ['garbage', (lock) => writeFile(join(lock, 'owner.json'), '{not json'), /could not be read \(.*JSON/],
    ['null', (lock) => writeFile(join(lock, 'owner.json'), 'null'), /could not be read \(owner\.json names no pid\)/],
    ['no owner.json', (lock) => writeFile(join(lock, 'something-else'), ''), /could not be read \(there is no owner\.json\)/],
  ]
  for (const [what, make, reason] of cases) {
    const rig = await aRepo(t)
    await mkdir(rig.lock)
    await make(rig.lock)

    const young = run(rig)
    assert.equal(young.code, 3, `${what}: ${young.stdout}`)
    assert.match(young.stderr, reason, what)
    assert.ok(young.stderr.includes(`rm -r ${rig.lock}`), `${what}: the refusal does not say how to clear ${rig.lock}: ${young.stderr}`)
    assert.deepEqual(await seen(rig), [], `${what}: a step ran`)

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await utimes(rig.lock, dayAgo, dayAgo)
    const old = run(rig)
    assert.equal(old.code, 0, `${what}: ${old.stderr}`)
    assert.match(old.stderr, /taking over a lock whose owner could not be read \(.*\), 1440 minutes old/, what)
    assert.equal(existsSync(rig.lock), false, `${what}: the run left its lock behind`)
  }
})

test('a lock is released only by the run that holds it', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const r = run(rig, [], { STEAL: 'build' })
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stderr, /is no longer this run's lock, so it was left where it is/)
  const owner = JSON.parse(await readFile(join(rig.lock, 'owner.json'), 'utf8'))
  assert.equal(owner.token, 'someone-else', 'the run removed a lock that was no longer its own')
})

test('while a run holds the lock, another run is refused before it runs anything', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const nested = join(rig.base, 'nested')
  const r = run(rig, [], { NESTED: 'build', NESTED_OUT: nested, SCRIPT: join(rig.root, 'scripts', 'ci-local.mjs') })
  assert.equal(r.code, 0, r.stderr)
  const inner = await readFile(nested, 'utf8')
  assert.match(inner, /^exit 3$/m, inner)
  assert.match(inner, /another run holds .*One full suite at a time/)
  assert.deepEqual((await seen(rig)).map((line) => line.split(' ')[0]), ['typecheck', 'build', 'coverage'], 'the second run ran steps of its own')
  // What the second run found: the first run's whole owner record.
  const owner = JSON.parse(await readFile(`${nested}.owner`, 'utf8'))
  assert.equal(owner.pid, Number(await readFile(`${nested}.parent`, 'utf8')))
  assert.equal(owner.sha, gitIn(rig.root, 'rev-parse', 'HEAD'))
  assert.match(owner.token, /^[0-9a-f-]{36}$/)
  assert.ok(!Number.isNaN(Date.parse(owner.startedAt)), owner.startedAt)
  assert.equal(owner.lockRules, 2, 'the owner record does not say which lock rules it keeps')
  // A lock taken by this same script is no other copy's.
  assert.doesNotMatch(inner, /lock rules|fetch the script fresh/)
  assert.equal(existsSync(rig.lock), false)
})

test('a lock held by a process this user may not signal is still held', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  // Signalling pid 1 as anyone but root answers EPERM, which means it is running.
  await mkdir(rig.lock)
  await writeFile(join(rig.lock, 'owner.json'), JSON.stringify({ pid: 1, sha: 'abcdef1', startedAt: '2026-09-17T05:00:00.000Z' }))
  const r = run(rig)
  assert.equal(r.code, 3, r.stdout)
  assert.match(r.stderr, /another run holds .*\(pid 1, on abcdef1/)
  assert.deepEqual(await seen(rig), [])
})

test('something at the lock\'s path that is not a directory is refused, and left as it is', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await writeFile(rig.lock, 'not a lock\n')
  const r = run(rig)
  assert.equal(r.code, 3, `${r.stdout}\n${r.stderr}`)
  assert.match(r.stderr, /^refused: .* is there, but it is not a directory, so it is no lock this script made\./m)
  assert.ok(r.stderr.includes(`remove it with: rm ${rig.lock}`), r.stderr)
  assert.deepEqual(await seen(rig), [], 'a step ran without the lock')
  assert.equal(await readFile(rig.lock, 'utf8'), 'not a lock\n', 'the file at the lock\'s path was changed')
  assert.deepEqual((await readdir(rig.base)).filter((name) => name.startsWith('lock.')), [], 'the run left something beside the lock')
})

test('a lock this user may not read is refused, and left as it is', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await mkdir(rig.lock)
  await writeFile(join(rig.lock, 'owner.json'), JSON.stringify({ pid: process.pid, sha: 'abcdef1', startedAt: '2026-09-17T05:00:00.000Z', token: 'x', lockRules: 2 }))
  await chmod(rig.lock, 0o000)
  try {
    // Root reads it whatever its mode says, and then there is nothing to test.
    if (await readdir(rig.lock).then(() => true, () => false)) {
      t.skip('this user can read a directory whose mode forbids it (root can)')
      return
    }
    const r = run(rig)
    assert.equal(r.code, 3, `${r.stdout}\n${r.stderr}`)
    assert.match(r.stderr, /^refused: .* is there, but this user may not read it \(EACCES\), so whose lock it is cannot be told\./m)
    assert.ok(r.stderr.includes(`remove it with: chmod u+rwx ${rig.lock} && rm -r ${rig.lock}`), r.stderr)
    assert.deepEqual(await seen(rig), [], 'a step ran without the lock')
    assert.deepEqual((await readdir(rig.base)).filter((name) => name.startsWith('lock.')), [], 'the run left something beside the lock')
  } finally {
    // Otherwise the rig's own removal cannot go into it. A lock the run removed needs nothing, and
    // the error that would say so here must not hide the assertion that failed first.
    await chmod(rig.lock, 0o755).catch(() => {})
  }
  const left = await readdir(rig.lock).catch((error: NodeJS.ErrnoException) => [`the lock could not be read: ${error.code}`])
  assert.deepEqual(left, ['owner.json'], 'the lock was changed')
})

test('a run that may not write its own owner record crashes, rather than blaming other runs', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  // Under umask 0277 a new directory is not writable, so the owner record cannot go into it. Root
  // writes there anyway, which the disk is asked about first.
  const umask = (...args: string[]) => spawnSync('/bin/sh', ['-c', 'umask 0277 && "$@"', 'sh', ...args], { cwd: rig.root, env: { ...process.env, ...rig.env }, encoding: 'utf8', timeout: 30_000 })
  if (umask('sh', '-c', 'mkdir "$0" && : > "$0/f"', join(rig.base, 'probe')).status === 0) {
    t.skip('this user writes into a directory whose mode forbids it (root can)')
    return
  }
  const r = umask(process.execPath, join(rig.root, 'scripts', 'ci-local.mjs'))
  assert.equal(r.status, 5, `${r.stdout}\n${r.stderr}`)
  assert.match(r.stderr, /^crashed: Error: EACCES: permission denied, open '.*owner\.json'$/m)
  assert.deepEqual((await readdir(rig.base)).filter((name) => name.startsWith('lock')), [], 'the run left a lock, or its own directory, behind')
  assert.deepEqual(await seen(rig), [])
})
