/**
 * A time nobody can read is not the oldest thing on screen, and it is not the newest either.
 *
 * `inAnswerOrder` and `sessionsFor` sorted ISO timestamps with `localeCompare`. Text order agrees
 * with time order only while every value is a timestamp this app wrote, and two values that reach
 * these lists are not:
 *
 * - `''` — what `parseRegistry` reads a missing `updatedAt` as. It sorts before every date. For a
 *   held call this is a guard, since the hook always writes `toISOString()`, but a request file
 *   with an empty time would have been answered first, ahead of calls that really were older.
 * - `'not a date'` — whatever a hand edit leaves. It sorts after every date, so newest-first put it
 *   at the head of a project's conversations, and the first of those with a time is what a
 *   project's last-active line shows.
 *
 * Bare `Date.parse` is no fix either: on Node 22 it reads `'1'`, `'Sep 16'` and `'garbled 3'` as
 * days in 2001, `'32'` as 2032, and a time with no zone as local time. The last two tests pin that.
 *
 * The two tests on the real functions were run on `dev` before the fix, and both failed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { inAnswerOrder } from '../src/shared/approval-summary.js'
import type { PendingApproval } from '../src/shared/ipc.js'
import { sessionsFor, type SessionRecord } from '../src/main/registry.js'
import { newestFirst, oldestFirst } from '../src/shared/time-order.js'

const call = (tool: string, askedAt: string): PendingApproval => ({
  sessionId: 's-1',
  project: '',
  toolUseId: `t-${tool}`,
  tool,
  input: {},
  askedAt,
  waitMs: null,
  agent: null,
})

const conversation = (id: string, updatedAt: string): SessionRecord => ({
  id,
  mode: 'building',
  project: 'billing',
  cwd: '/work/office',
  agent: 'manager',
  createdAt: '2026-09-16T09:00:00.000Z',
  updatedAt,
  costUsd: null,
  title: null,
  opened: true,
})

test('a held call whose time will not parse is answered last, not first', () => {
  const order = inAnswerOrder([
    call('Bash', '2026-09-16T11:58:00.000Z'),
    call('Read', ''),
    call('Write', '2026-09-16T11:57:00.000Z'),
  ])
  assert.deepEqual(order.map((r) => r.tool), ['Write', 'Bash', 'Read'], 'an empty time was ranked as the oldest call')
})

test("a conversation whose time will not parse never heads a project's list", () => {
  const listed = sessionsFor(
    [
      conversation('old', '2026-09-15T08:00:00.000Z'),
      conversation('garbled', 'not a date'),
      conversation('new', '2026-09-16T14:02:00.000Z'),
      conversation('blank', ''),
    ],
    'billing',
    '/work/office',
  )
  // The two unreadable ones tie, so they keep the order they were handed in.
  assert.deepEqual(listed.map((s) => s.id), ['new', 'old', 'garbled', 'blank'], 'an unreadable time outranked a real one')
})

test('times are compared as instants, not as text', () => {
  // 12:00 at +02:00 is 10:00 UTC: earlier than 11:00 UTC, though its text sorts later.
  const sorted = ['2026-09-16T11:00:00Z', '2026-09-16T12:00:00+02:00'].sort(oldestFirst)
  assert.deepEqual(sorted, ['2026-09-16T12:00:00+02:00', '2026-09-16T11:00:00Z'], 'text order was used for times')
})

test('oldest first puts text that will not parse after every time', () => {
  const sorted = ['', '2026-09-16T11:58:00.000Z', 'not a date', '2026-09-16T11:57:00.000Z'].sort(oldestFirst)
  assert.deepEqual(
    sorted,
    ['2026-09-16T11:57:00.000Z', '2026-09-16T11:58:00.000Z', '', 'not a date'],
    'unreadable text was ranked among the times',
  )
})

test('newest first still puts text that will not parse last', () => {
  const sorted = ['', '2026-09-16T11:57:00.000Z', 'not a date', '2026-09-16T11:58:00.000Z'].sort(newestFirst)
  assert.deepEqual(
    sorted,
    ['2026-09-16T11:58:00.000Z', '2026-09-16T11:57:00.000Z', '', 'not a date'],
    'reversing the order also moved unreadable text to the front',
  )
})

test('one instant spelled two ways is a tie', () => {
  assert.equal(
    oldestFirst('2026-09-16T11:58:00Z', '2026-09-16T11:58:00.000Z'),
    0,
    'the same instant was ranked by how it was written',
  )
})

test('two times that will not parse are a tie, left to the caller', () => {
  assert.equal(oldestFirst('', 'not a date'), 0, 'two unreadable values were ranked against each other')
})

test('text a lenient parser would call a time is still text that will not parse', () => {
  // Each of these parses under bare `Date.parse` on Node 22: the first three as days in 2001, the
  // zoneless one as local time, the last rolled over into March. A day-earlier zoneless time is
  // used so that, in any time zone, reading it would put it before the real time.
  const real = '2026-09-16T11:58:00.000Z'
  for (const loose of ['garbled 3', '1', 'Sep 16', '2026-09-15T11:58:00', '2026-02-30T00:00:00Z']) {
    assert.deepEqual([loose, real].sort(oldestFirst), [real, loose], `${JSON.stringify(loose)} was read as a time`)
  }
})

test('newest first does not let a lenient parse head the list', () => {
  // Bare `Date.parse` reads '32' as 2032, which would put it above every real time.
  const real = '2026-09-16T11:58:00.000Z'
  assert.deepEqual(['Sep 16', real, '32'].sort(newestFirst), [real, 'Sep 16', '32'], 'a number was read as a year')
})
