/**
 * The four answers, and the three of them that must not kill anything.
 *
 * `children.ts` stops a `claude` outliving a *clean* quit. Nothing stopped one outliving a
 * crash: `before-quit` does not run, and `detached: true` — which `runClaude` needs so it can
 * signal claude's own tool children as a group — is also what stops the kernel taking the child
 * down with its parent. Driven before any of this was written, with the agent confirmed
 * mid-answer: `SIGKILL` the Electron main, and twenty seconds later the child is alive, ppid 1.
 *
 * The reap that fixes it is the dangerous half. Every entry it reads was written before a crash,
 * every pid in it may since have been handed to something else, and the operation on the end of
 * the decision is `kill -9`. So the decision is here, where all four cases can be stated, rather
 * than inline in a startup path where only the happy one would ever be exercised.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { remember } from '../src/main/orphans.js'

import { keepAfterReap, reapMessage, verdictFor, type Spawned } from '../src/shared/orphans.js'

import { tempDir } from './temp-dir.js'

const entry: Spawned = {
  child: { pid: 4242, since: 'Fri Aug 28 12:20:11 2026' },
  owner: { pid: 4200, since: 'Fri Aug 28 12:19:02 2026' },
  what: 'claude (0170b225)',
}

test('a child whose office is still running is somebody live conversation, not an orphan', () => {
  const v = verdictFor(entry, { since: entry.owner.since }, { since: entry.child.since })
  assert.deepEqual(v, { act: 'owned' })
})

test('the owner is checked before the child, so a second window cannot reap the first one work', () => {
  /*
   * Two offices open at once is ordinary — it is how the registry merge bug was found. If this
   * reaped on child liveness alone, launching the second window would kill whatever the first
   * one had mid-answer, which is the bug being fixed, caused deliberately, by the fix.
   */
  const v = verdictFor(entry, { since: entry.owner.since }, null)
  assert.deepEqual(v, { act: 'owned' }, 'a live owner settles it whatever the child is doing')
})

test('nothing running under that number is a stale record, not something to kill', () => {
  assert.deepEqual(verdictFor(entry, null, null), { act: 'gone' })
})

test('a recycled pid is left alone, because a pid is not an identity', () => {
  /*
   * The case that makes this a function. Between the crash and this launch the OS may have given
   * 4242 to anything at all, and the entry cannot tell by number alone. `kill -9` here is this
   * app killing a stranger's process to fix its own bug — strictly worse than the leak.
   */
  const v = verdictFor(entry, null, { since: 'Fri Aug 28 13:05:44 2026' })
  assert.deepEqual(v, { act: 'reused' })
})

test('only a dead owner and an unchanged child start time gets killed', () => {
  const v = verdictFor(entry, null, { since: entry.child.since })
  assert.deepEqual(v, { act: 'kill', pid: 4242, what: 'claude (0170b225)' })
})

test('an owner whose own pid was recycled is still a dead owner', () => {
  // The office is gone; something else holds its number. That does not make its children owned.
  const v = verdictFor(entry, { since: 'Fri Aug 28 14:00:00 2026' }, { since: entry.child.since })
  assert.deepEqual(v, { act: 'kill', pid: 4242, what: 'claude (0170b225)' })
})

test('the record keeps exactly the entries whose office is still up', () => {
  const other: Spawned = { ...entry, child: { pid: 99, since: 'x' }, what: 'claude (beefbeef)' }
  const kept = keepAfterReap([entry, other], [{ act: 'owned' }, { act: 'kill', pid: 99, what: 'x' }])
  assert.deepEqual(kept, [entry], 'a killed orphan is finished with; a live office clears its own')
})

test('a reap that killed nothing says nothing', () => {
  assert.equal(reapMessage([]), null, 'an ordinary launch must not report a cleanup that did not happen')
})

test('a reap that killed something says so, and counts correctly', () => {
  assert.match(reapMessage(['claude (a)']) ?? '', /one agent was still running/)
  assert.match(reapMessage(['claude (a)', 'claude (b)']) ?? '', /2 agents were still running/)
})

/*
 * The disk half, and the case that used to be indistinguishable from success.
 *
 * `remember` refuses to append when the record will not parse, and it is right to: `store`
 * writes the whole file, so appending to a bad read would delete the entries it still holds.
 * What was wrong is that it returned as though it had worked. `rememberHere`'s `.catch()` could
 * never fire, nothing reported, and every child spawned afterwards went unwritten — so a crash
 * left them running against the user's allowance with nothing left to reap them by.
 */
test('a running-record that will not parse is reported, not silently skipped', async (t) => {
  const root = await tempDir(t, 'office-orphans-')
  await mkdir(join(root, '.office-space'), { recursive: true })

  const path = join(root, '.office-space', 'running.json')
  const corrupt = '{ "version": 1, "entries": [ truncated'
  await writeFile(path, corrupt, 'utf8')

  // `process.pid` for the child too: both stamps have to come back, and this one is certainly
  // running. The test is about the record file, not about `ps`.
  const result = await remember(root, process.pid, 'claude (a)')

  assert.equal(result.recorded, false, 'it claimed to have written the child down')
  assert.ok(result.problem !== null, 'the refusal came back with no reason, which is the old bug')
  assert.match(result.problem, /running\.json/, 'the reason has to name the file a person can fix')

  assert.equal(await readFile(path, 'utf8'), corrupt, 'the record was rewritten, losing what it held')
})

test('a child is written down when the record is readable', async (t) => {
  const root = await tempDir(t, 'office-orphans-')

  const result = await remember(root, process.pid, 'claude (a)')
  assert.equal(result.problem, null, 'a fresh workspace is not a problem')
  assert.equal(result.recorded, true, 'nothing was written down on the ordinary path')

  const written = JSON.parse(await readFile(join(root, '.office-space', 'running.json'), 'utf8')) as {
    entries: { child: { pid: number }; what: string }[]
  }
  assert.equal(written.entries.length, 1)
  assert.equal(written.entries[0]?.child.pid, process.pid)
  assert.equal(written.entries[0]?.what, 'claude (a)')
})
