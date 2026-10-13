/**
 * The office telling you something is waiting, without becoming an alarm.
 *
 * Driven before this existed: a fresh install, the manager dispatched `builder`, `builder`
 * stopped on a gated command, and the floor read *"1 call needs you · 1 mid-task"* for **350
 * seconds**. The office was working perfectly and saying so to an empty chair. That is
 * `docs/the-queue.md` decision #2, and it stopped being a design question the moment it was
 * measured.
 *
 * The whole risk here is the other direction. The approvals watcher fires about every 400ms, so
 * a notification per tick is an alarm going off four times a second. Everything below is about
 * which requests are *new*.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { nudgeFor, type Waiting } from '../src/shared/nudge.js'

const call = (key: string, agent: string | null = 'builder'): Waiting => ({ key, tool: 'Bash', agent })
const none: ReadonlySet<string> = new Set()

test('a new call with nobody looking is announced, and says who is stuck', () => {
  const n = nudgeFor(none, [call('s.1')], false)
  assert.ok(n.announce, 'nothing was announced for a call nobody has seen')
  assert.match(n.announce.title, /a call is waiting/i)
  assert.match(n.announce.body, /builder/, 'the notification does not say who is blocked')
  assert.match(n.announce.body, /Bash/, 'it does not say what they are blocked on')
})

test('the same call is never announced twice', () => {
  // The watcher ticks about every 400ms. Without this the office notifies four times a second
  // for as long as the request is unanswered, which for the four-minute wait is roughly 600
  // notifications about one command.
  const first = nudgeFor(none, [call('s.1')], false)
  const second = nudgeFor(first.seen, [call('s.1')], false)
  assert.ok(first.announce, 'the first tick said nothing')
  assert.equal(second.announce, null, 'the second tick announced the same call again')
})

test('nothing is announced while somebody is looking at the office', () => {
  // Firing a notification at a person who is reading the card is the office interrupting them
  // to tell them what is already on their screen.
  const n = nudgeFor(none, [call('s.1')], true)
  assert.equal(n.announce, null)
})

test('a call that arrives while you are away is announced when it arrives, not when you return', () => {
  const away = nudgeFor(none, [call('s.1')], false)
  assert.ok(away.announce)
  // Coming back and looking must not re-announce what you are now looking at.
  const back = nudgeFor(away.seen, [call('s.1')], true)
  assert.equal(back.announce, null)
})

test('the manager is named as the manager, never as nobody', () => {
  // `agent: null` means the manager — it is not "we could not tell". Same rule the floor follows.
  const n = nudgeFor(none, [call('s.1', null)], false)
  assert.match(n.announce?.body ?? '', /the manager/)
})

test('several at once is one notification, not several', () => {
  const n = nudgeFor(none, [call('s.1', 'builder'), call('s.2', 'tester')], false)
  assert.ok(n.announce)
  assert.match(n.announce.title, /2 calls are waiting/)
  assert.match(n.announce.body, /builder and tester/)
})

test('the badge counts what is waiting whether or not you are looking', () => {
  // The badge answers a different question from the notification: it is the dock agreeing with
  // the floor, and it should agree whether or not anybody is watching.
  assert.equal(nudgeFor(none, [call('s.1'), call('s.2')], true).badge, '2')
  assert.equal(nudgeFor(none, [call('s.1')], false).badge, '1')
})

test('answering everything clears the badge', () => {
  const n = nudgeFor(new Set(['s.1']), [], false)
  assert.equal(n.badge, '', 'the dock still claims something is waiting')
  assert.equal(n.announce, null)
})

test('what has been seen is pruned to what is still waiting', () => {
  // Otherwise it grows for the life of the window — every tool call of every session, forever.
  const n = nudgeFor(new Set(['old.1', 'old.2', 's.1']), [call('s.1')], true)
  assert.deepEqual([...n.seen], ['s.1'])
})
