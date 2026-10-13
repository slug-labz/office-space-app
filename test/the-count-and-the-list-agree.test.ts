/**
 * The number above the list, and the list.
 *
 * The switcher draws a project's row — *"The office · N conversations · last active"* — and then,
 * a few lines below it under "conversations in the office", the conversations themselves. Two
 * renderings of one fact, from one snapshot, visible at the same moment.
 *
 * They came from two definitions. `sessionListOf` prepended a conversation started this run and
 * not yet written down; `rowFor` counted `sessionsFor`, which is the registry alone. So the first
 * screen a new user sees said:
 *
 *     The office — no conversations yet · never
 *     ─ CONVERSATIONS IN THE OFFICE ─
 *     Nothing said yet — now
 *
 * Read in the running app on a fresh workspace. "no conversations yet" was printed directly above
 * the conversation the reader was sitting in, and "never" directly above "now".
 *
 * The near miss is that both were already refreshed together — `pushSessions` sends the list and
 * the snapshot in one breath, with a comment saying why. Refreshing two definitions at the same
 * moment makes them wrong at the same moment; it does not make them agree. So there is one rule
 * now, and this file is about it.
 *
 * ## What each case is
 *
 * A conversation this run started is **in the group** — you are in it — but it is not in the
 * registry until something writes it down, and writing happens on a state change. Between opening
 * the app and saying the first word there is a window where the only conversation that exists is
 * the one that is not recorded.
 *
 * Unless it has been closed. Closing the conversation you are *in* leaves it live, and an earlier
 * version put its row straight back on every redraw for exactly that reason.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shownSessions, type SessionRecord } from '../src/main/registry.js'

const CWD = '/work/office'

const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'aaaa-1',
  mode: 'building',
  project: 'office',
  cwd: CWD,
  agent: 'manager',
  createdAt: '2026-08-27T09:00:00.000Z',
  updatedAt: '2026-08-27T09:00:00.000Z',
  costUsd: null,
  title: null,
  opened: true,
  ...over,
})

const ids = (rows: readonly { id: string }[]): string[] => rows.map((r) => r.id)

test('a conversation started this run and not written down yet is one of the group', () => {
  // The first screen of a fresh workspace: nothing in the registry, one live conversation.
  const shown = shownSessions([], 'office', CWD, { id: 'live-1' })

  assert.deepEqual(ids(shown), ['live-1'], 'the conversation the reader is sitting in is not listed')
  assert.equal(
    shown[0]?.record,
    null,
    'an unrecorded conversation was handed back with a record it does not have',
  )
})

test('and it is counted, because the count is the length of this list', () => {
  // The bug, stated as the thing the caller does. `rowFor` takes `.length`; on a fresh workspace
  // the old rule made that zero and printed "no conversations yet" above a list of one.
  const shown = shownSessions([], 'office', CWD, { id: 'live-1' })
  assert.equal(
    shown.length,
    1,
    'the count is zero while the list has an entry — which is the row reading "no conversations ' +
      'yet · never" directly above the conversation it is describing',
  )
})

test('the live one is not listed twice once it reaches the registry', () => {
  const shown = shownSessions([record({ id: 'live-1' })], 'office', CWD, { id: 'live-1' })
  assert.deepEqual(ids(shown), ['live-1'], 'the same conversation was listed as both live and recorded')
  assert.ok(shown[0]?.record, 'once written down, the record is what the caller should read')
})

test('closing the conversation you are in closes it', () => {
  // It is still the live one, so a rule that only asked "is it in the registry" put the row back
  // on the next redraw and the close button did nothing you could see.
  const shown = shownSessions(
    [record({ id: 'live-1', closed: true })],
    'office',
    CWD,
    { id: 'live-1' },
  )
  assert.deepEqual(ids(shown), [], 'a closed conversation came back because it was still the live one')
})

test('the newest is first, so the row can take its timestamp off the head', () => {
  const shown = shownSessions(
    [
      record({ id: 'older', updatedAt: '2026-08-20T09:00:00.000Z' }),
      record({ id: 'newer', updatedAt: '2026-08-26T09:00:00.000Z' }),
    ],
    'office',
    CWD,
    null,
  )
  assert.deepEqual(ids(shown), ['newer', 'older'], 'the head of the list is not the most recent')
})

test('the live one leads, because it is the one being looked at', () => {
  const shown = shownSessions(
    [record({ id: 'older', updatedAt: '2026-08-26T09:00:00.000Z' })],
    'office',
    CWD,
    { id: 'live-1' },
  )
  assert.deepEqual(ids(shown), ['live-1', 'older'], 'the conversation on screen was not the head of its own list')
})

test('another project\'s conversations are not counted into this one', () => {
  const shown = shownSessions(
    [record({ id: 'ours' }), record({ id: 'theirs', project: 'payment-page' })],
    'office',
    CWD,
    null,
  )
  assert.deepEqual(ids(shown), ['ours'], 'a conversation from another project was listed here')
})

test('another workspace\'s conversations are not counted either', () => {
  // Same registry shape, different `cwd`. Two clones of this repo share nothing, and a count that
  // ignored `cwd` would report the other clone's history on this one's first run.
  const shown = shownSessions([record({ id: 'elsewhere', cwd: '/somewhere/else' })], 'office', CWD, null)
  assert.deepEqual(ids(shown), [], "another workspace's conversation was listed in this one")
})

test('a conversation that was never opened is not one you have had', () => {
  const shown = shownSessions([record({ id: 'unopened', opened: false })], 'office', CWD, null)
  assert.deepEqual(ids(shown), [], 'a conversation nobody ever opened was counted as one')
})

test('no conversations and none live is genuinely none', () => {
  // The control. Every assertion above is that something appears; without this one, a rule that
  // returned a row unconditionally would pass most of them.
  assert.deepEqual(shownSessions([], 'office', CWD, null), [], 'an empty project produced a row from nothing')
})
