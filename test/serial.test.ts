/**
 * One at a time, in order — and the two properties that are easy to get wrong.
 *
 * `serial()` was written for the session registry, where two overlapping saves each wrote the
 * whole file from their own view of `sessions` and the slower one won. It is tested here rather
 * than through `main.ts`, which calls `app.whenReady()` at module scope and cannot be imported
 * outside Electron.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { serial } from '../src/main/serial.js'

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

test('tasks run one after another, in the order they were queued', async () => {
  const queue = serial()
  const order: string[] = []

  // Deliberately slowest-first. Run concurrently they would finish c, b, a; run in order they
  // finish a, b, c — which is the whole difference between the two behaviours.
  await Promise.all([
    queue(async () => { await tick(30); order.push('a') }),
    queue(async () => { await tick(20); order.push('b') }),
    queue(async () => { await tick(10); order.push('c') }),
  ])

  assert.deepEqual(order, ['a', 'b', 'c'])
})

test('a task never overlaps the one before it', async () => {
  const queue = serial()
  let inside = 0
  let overlapped = false

  await Promise.all(
    Array.from({ length: 8 }, () =>
      queue(async () => {
        inside += 1
        if (inside > 1) overlapped = true
        await tick(5)
        inside -= 1
      }),
    ),
  )

  assert.equal(overlapped, false, 'two tasks were inside the queue at once')
})

test('THE POINT: a task reads its state when its turn comes, not when it was queued', async () => {
  // This is the bug the queue exists for. `saveRegistry(root, sessions)` evaluated at queue time
  // captures the array that was current *then*; a closure reads the variable *later*. Two
  // overlapping writes therefore wrote two different views of the registry, and the older one
  // could land second.
  const queue = serial()
  let state = 'first'
  const written: string[] = []

  const a = queue(async () => { await tick(20); written.push(state) })
  state = 'second'
  const b = queue(async () => { written.push(state) })
  await Promise.all([a, b])

  // `a` was queued while state was 'first' and still reads 'second', because it read late.
  assert.deepEqual(written, ['second', 'second'])
})

test('a failure reaches the caller that asked for it, and nobody else', async () => {
  // One failed write is not a reason to stop writing, and the caller is the only one who can say
  // that the thing it asked for did not happen — reporting it to the tasks behind it would blame
  // them for something they had no part in, and swallowing it would tell nobody at all.
  const queue = serial()
  const done: string[] = []

  const bad = queue(async () => { throw new Error('disk full') })
  const after = queue(async () => { done.push('ran anyway') })

  await assert.rejects(bad, /disk full/)
  await after
  assert.deepEqual(done, ['ran anyway'])

  // And the queue is still usable, rather than poisoned by the rejection.
  await queue(async () => { done.push('and again') })
  assert.deepEqual(done, ['ran anyway', 'and again'])
})

test('a synchronous throw is a rejection, not an explosion at the call site', async () => {
  const queue = serial()
  await assert.rejects(queue(() => { throw new Error('immediate') }), /immediate/)
  let ran = false
  await queue(async () => { ran = true })
  assert.equal(ran, true, 'the queue survived it')
})

test('the queue hands back what the task returned', () => {
  // The first version resolved `void`. A queue that swallows the return value forces any caller
  // with an answer to smuggle it out through a mutable closure variable and a sentinel for "the
  // task never ran" — which is exactly what `ledger.ts` did, in the file that records what the
  // office actually did. The value belongs to the caller.
  const queue = serial()
  return Promise.all([
    queue(async () => 'first'),
    queue(async () => 42),
    queue(async () => ({ ok: true as const })),
  ]).then(([a, b, c]) => {
    assert.equal(a, 'first')
    assert.equal(b, 42)
    assert.deepEqual(c, { ok: true })
  })
})

test('a rejection is the caller\'s and does not become the next task\'s value', async () => {
  // The tail swallows failures so the chain keeps running; `run` is what the caller holds, and
  // it must still reject. Getting this backwards would hand the next task a silent `undefined`
  // where its own result should be.
  const queue = serial()
  const bad = queue(async () => { throw new Error('disk full') })
  const after = queue(async () => 'ran anyway')

  await assert.rejects(bad, /disk full/)
  assert.equal(await after, 'ran anyway')
})
