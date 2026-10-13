/**
 * One recorder per conversation, and whether it is ever let go.
 *
 * This module exists because the two bugs it fixes lived in `main.ts`, which imports `electron`
 * at module scope and so cannot be loaded by any test. That is the same reason `store.ts` held
 * the Spotify credential and the master network switch untested, and the same fix: move the
 * decision somewhere a test can reach and leave the wiring behind.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Recorders } from '../src/main/voice/recorders.js'
import type { ClaudeEvent } from '../src/main/claude/stream.js'

// Built whole rather than cast. A cast through `unknown` would compile against a shape that had
// drifted, which is the failure this repository spends most of its time hunting — and these two
// events are the entire input surface of the thing under test.
const dispatch = (id: string, to: string): ClaudeEvent => ({
  kind: 'assistant',
  model: null,
  parentToolUseId: null,
  blocks: [{ type: 'tool_use', id, name: 'Task', input: { subagent_type: to, description: 'a job' } }],
})

const result = (toolUseId: string): ClaudeEvent => ({
  kind: 'user',
  blocks: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'the work came back' }],
})

const done = (): ClaudeEvent => ({
  kind: 'result',
  isError: false,
  text: 'ok',
  costUsd: null,
  turns: null,
  durationMs: null,
  denials: [],
})

test('a turn accumulates and is handed over whole when it ends', async () => {
  const r = new Recorders(() => 'manager')

  assert.equal(r.observe('s1', dispatch('t1', 'auditor')), null, 'a mid-turn event ended the turn')
  const turn = r.observe('s1', done())
  assert.ok(turn, 'the result did not end the turn')
  assert.deepEqual(
    turn.map((m) => m.kind),
    ['dispatched', 'awaiting-you'],
    'the turn lost what happened before the result',
  )
})

test('two conversations are two turns, never one', async () => {
  // The reason the key is a session and not a project, stated as a test. The lookup used to be
  // called `recorderFor(project)` while every caller passed a session id, so the obvious tidy-up
  // — making the call match the parameter — would have merged these two.
  const r = new Recorders(() => 'manager')

  r.observe('s1', dispatch('t1', 'auditor'))
  r.observe('s2', dispatch('t2', 'writer'))

  const first = r.observe('s1', done())
  assert.ok(first)
  assert.deepEqual(
    first.map((m) => m.who),
    ['auditor', 'manager'],
    "one conversation's turn included work from another conversation",
  )

  const second = r.observe('s2', done())
  assert.ok(second)
  assert.deepEqual(second.map((m) => m.who), ['writer', 'manager'])
})

test('a result in one conversation cannot answer a dispatch made in another', async () => {
  // The regression the old name invited, and the only test that can see it.
  //
  // "Two turns are two turns" is not enough on its own: the accumulated moments are keyed by
  // session anyway, so a single shared recorder still produces separate turns and that test
  // stays green. What a shared recorder actually shares is the `tool_use` -> agent map, so the
  // cross-talk shows up only when one conversation's *result* is offered a `tool_use_id` that
  // belongs to another's dispatch.
  //
  // Found by mutating `get(sessionId)` to `get('shared')` and watching nothing fail.
  const r = new Recorders(() => 'manager')

  r.observe('s1', dispatch('shared-id', 'auditor'))
  // s2 never dispatched anything, and this id is not its business.
  r.observe('s2', result('shared-id'))
  const stray = r.observe('s2', done())

  assert.ok(stray)
  assert.deepEqual(
    stray.map((m) => m.kind),
    ['awaiting-you'],
    "a conversation reported work finishing that was dispatched in a different conversation",
  )

  // And s1 still owns the pairing: the stray read must not have consumed it. s1's own turn has
  // not ended yet, so its `dispatched` moment is still accumulated — that is the point of
  // holding a turn — and the `finished` must arrive behind it rather than instead of it.
  r.observe('s1', result('shared-id'))
  const mine = r.observe('s1', done())
  assert.ok(mine)
  assert.deepEqual(
    mine.map((m) => [m.kind, m.who]),
    [
      ['dispatched', 'auditor'],
      ['finished', 'auditor'],
      ['awaiting-you', 'manager'],
    ],
    'the dispatch was consumed by the wrong conversation and never came back to its own',
  )
})

test('closing a conversation lets go of it', async () => {
  // The leak. Nothing removed from either map, so every conversation ever opened stayed for the
  // lifetime of the process.
  const r = new Recorders(() => 'manager')
  for (const id of ['s1', 's2', 's3']) r.observe(id, dispatch('t', 'auditor'))
  assert.equal(r.size, 3)

  r.forget('s2')
  assert.equal(r.size, 2, 'the recorder survived the conversation being closed')

  // And the moments it was holding went with it, rather than being handed to whoever reuses the
  // id — a fresh conversation must not open with the tail of a closed one.
  r.observe('s2', dispatch('t9', 'writer'))
  const turn = r.observe('s2', done())
  assert.ok(turn)
  assert.deepEqual(turn.map((m) => m.who), ['writer', 'manager'], 'a closed turn leaked into a new one')
})

test('forgetting a conversation nobody watched is not an error', async () => {
  // Closing a conversation the voice never saw is ordinary: the voice is off until asked, so
  // most conversations in most workspaces are never recorded at all.
  const r = new Recorders(() => 'manager')
  r.forget('never-seen')
  assert.equal(r.size, 0)
})

test('switching the voice off drops everything, recorders included', async () => {
  const r = new Recorders(() => 'manager')
  r.observe('s1', dispatch('t1', 'auditor'))
  r.observe('s2', dispatch('t2', 'writer'))
  assert.equal(r.size, 2)

  r.clear()
  assert.equal(r.size, 0)

  // Not just the accumulated moments — the recorder too. A recorder pairs a `tool_use` with the
  // `tool_result` that answers it, and keeping half of that across a quiet period would report a
  // result for a dispatch whose moment was thrown away.
  const after = r.observe('s1', done())
  assert.ok(after)
  assert.deepEqual(after.map((m) => m.kind), ['awaiting-you'], 'a moment survived the voice being switched off')
})

test('the manager is read per recorder, not captured once', async () => {
  // The workspace can be rescanned while the office is open, and the manager can change with it.
  let manager = 'first'
  const r = new Recorders(() => manager)

  r.observe('s1', done())
  manager = 'second'
  const turn = r.observe('s2', done())
  assert.ok(turn)
  assert.equal(turn[0]?.who, 'second', 'the manager was captured at construction rather than read per use')
})
