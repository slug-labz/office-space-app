/**
 * The reap, against real processes.
 *
 * `orphans.test.ts` states the decision; this runs it. The two are worth keeping apart because
 * the operation on the end of the decision is `kill -9` against a pid read out of a file written
 * by a process that has since died, and an argument that it is safe is not the same as watching
 * it decline to fire.
 *
 * So the important test here is not that an orphan dies. It is that a **recycled** pid does not:
 * a live process whose start time does not match the record must come through untouched, and it
 * is checked by looking at whether it is still running afterwards rather than by inspecting a
 * verdict.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { forget, reapOrphans, remember, stampOf } from '../src/main/orphans.js'
import type { Spawned } from '../src/shared/orphans.js'

import { tempDir } from './temp-dir.js'

const started: number[] = []

async function workspace(t: TestContext): Promise<string> {
  return tempDir(t, 'office-orphans-')
}

/** A real process in its own group, the way `runClaude` starts one. */
function sleeper(): number {
  const child = spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore' })
  child.unref()
  const pid = child.pid
  assert.ok(pid, 'could not start a test process')
  started.push(pid)
  return pid
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const recordPath = (root: string): string => join(root, '.office-space', 'running.json')

async function writeRecord(root: string, entries: readonly Spawned[]): Promise<void> {
  await mkdir(join(root, '.office-space'), { recursive: true })
  await writeFile(recordPath(root), JSON.stringify({ version: 1, entries }), 'utf8')
}

test.after(async () => {
  for (const pid of started) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* already reaped, which is what most of these tests are about */
    }
  }
})

test('a running process has a start time, and an unused number has none', async () => {
  const mine = await stampOf(process.pid)
  assert.ok(mine && mine.since.length > 0, 'this process could not be asked when it started')
  // Above `pid_max` on both platforms this runs on, so nothing can be running under it.
  assert.equal(await stampOf(4_194_305), null, 'an unused number reported a start time')
})

test('a child is recorded and then dropped again', async (t) => {
  const root = await workspace(t)
  const pid = sleeper()
  await remember(root, pid, 'claude (test)')

  const after = JSON.parse(await readFile(recordPath(root), 'utf8')) as { entries: Spawned[] }
  assert.equal(after.entries.length, 1)
  assert.equal(after.entries[0]?.child.pid, pid)
  assert.equal(after.entries[0]?.owner.pid, process.pid, 'the office that started it is the owner')
  assert.ok(after.entries[0]?.child.since, 'recorded without a start time, so it could never be identified')

  await forget(root, pid)
  const gone = JSON.parse(await readFile(recordPath(root), 'utf8')) as { entries: Spawned[] }
  assert.deepEqual(gone.entries, [], 'a child that exited is still on the list')
})

test('a child this very process owns is left alone, because this office is still running', async (t) => {
  const root = await workspace(t)
  const pid = sleeper()
  await remember(root, pid, 'claude (mine)')

  const reaped = await reapOrphans(root)
  assert.deepEqual(reaped.killed, [], 'it killed a child belonging to a live office')
  assert.ok(alive(pid), 'the process was killed while its owner was still running')

  const kept = JSON.parse(await readFile(recordPath(root), 'utf8')) as { entries: Spawned[] }
  assert.equal(kept.entries.length, 1, 'a live office had its record dropped, so nothing can reap it later')
})

test('an orphan whose office is gone is killed', async (t) => {
  const root = await workspace(t)
  const pid = sleeper()
  const stamp = await stampOf(pid)
  assert.ok(stamp)
  await writeRecord(root, [
    { child: { pid, since: stamp.since }, owner: { pid: 4_194_305, since: 'never' }, what: 'claude (orphan)' },
  ])

  const reaped = await reapOrphans(root)
  assert.deepEqual(reaped.killed, ['claude (orphan)'])
  // Signals are not synchronous; give the kernel the moment it needs to reap.
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(alive(pid), false, 'the orphan is still running')

  const left = JSON.parse(await readFile(recordPath(root), 'utf8')) as { entries: Spawned[] }
  assert.deepEqual(left.entries, [], 'a killed orphan stayed on the list')
})

test('a live process whose start time does not match is NOT killed', async (t) => {
  /*
   * The one that matters. This is the app being handed a number that is running, whose owner is
   * gone, and which is not the thing it started — a pid the OS handed to somebody else after the
   * crash. Killing here would be this app killing a stranger's process to fix its own leak.
   */
  const root = await workspace(t)
  const pid = sleeper()
  await writeRecord(root, [
    {
      child: { pid, since: 'Mon Jan  1 00:00:00 2001' },
      owner: { pid: 4_194_305, since: 'never' },
      what: 'claude (not really)',
    },
  ])

  const reaped = await reapOrphans(root)
  assert.deepEqual(reaped.killed, [], 'it killed a process it had only a recycled number for')
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(alive(pid), true, 'a process that was never ours was killed')
})

test('a record that will not parse is reported, and nothing is killed', async (t) => {
  // Absent is not empty, on the surface where treating it as empty abandons the children it named.
  const root = await workspace(t)
  const pid = sleeper()
  await mkdir(join(root, '.office-space'), { recursive: true })
  await writeFile(recordPath(root), '{"entries": [ truncated', 'utf8')

  const reaped = await reapOrphans(root)
  assert.deepEqual(reaped.killed, [])
  assert.match(reaped.problem ?? '', /will not parse/, 'an unreadable record passed silently')
  assert.ok(alive(pid), 'something was killed off an unparseable record')
})

test('a workspace that has never run anything reaps nothing and reports nothing', async (t) => {
  const reaped = await reapOrphans(await workspace(t))
  assert.deepEqual(reaped.killed, [])
  assert.equal(reaped.problem, null, 'a fresh workspace reported a problem it does not have')
})
