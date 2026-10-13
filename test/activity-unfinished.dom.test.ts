/**
 * "Never reported back" — the zone that answers *what was I in the middle of?*
 *
 * The approval half of this strip is covered by `approval-card.dom.test.ts`. This is the other
 * half: work that was dispatched and whose result never arrived, read from the ledger on disk
 * rather than derived from this session's events — *"that is the entire point"*, because a
 * dispatch sent before the window closed is exactly the one this session cannot know about.
 *
 * ## Three things that collapse into the same number, and must not
 *
 * **Nobody has asked yet** is `null`, and the zone does not draw at all. An empty zone would
 * announce "nothing outstanding" before anybody had looked.
 *
 * **The ledger would not open** is a `problem`:
 *
 *     Said before anything else, because every count below it is then a count of what we managed
 *     to read and not of what is outstanding.
 *
 * **Lines that would not parse** are carried across and shown:
 *
 *     A line we cannot parse may be the record of the very dispatch somebody is looking for, and
 *     dropping it would turn "we cannot read this" into "this never happened".
 *
 * The count in the heading is the place all three go wrong at once, because it is a bare number
 * and a bare number reads as a fact. It is only a fact when the ledger opened and every line in
 * it parsed; in the other two cases it is a count of what we managed to read, and it says so.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { renderStrip, type ActivityHandlers, type StripModel } from '../src/renderer/views/activity.js'
import type { Dispatch, TornLine } from '../src/main/ledger.js'
import type { UnfinishedReport } from '../src/shared/ipc.js'

installDom()

// Real shapes, read from the declarations. Two earlier fixtures in this suite were written from
// memory, waved through by an `as` cast, and then failed inside the module looking like its bug.
const dispatch = (id: string, employee = 'reviewer'): Dispatch => ({
  id,
  sessionId: 's1',
  project: 'a-project',
  employee,
  brief: `look at the ${employee} thing`,
  verify: '`npm test` exits 0',
  sentAt: '2026-08-27T09:00:00Z',
})

const torn = (at: number): TornLine => ({ at, text: '{"kind":"dispat', cause: 'unterminated JSON' })

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

interface Zone {
  readonly host: El
  readonly text: string
  readonly zones: El[]
  readonly heading: string
  readonly buttons: El[]
  readonly acted: { readonly id: string; readonly verb: string }[]
}

function strip(unfinished: UnfinishedReport | null): Zone {
  const host = document.createElement('div')
  const acted: { id: string; verb: string }[] = []
  const on: ActivityHandlers = {
    onDecide: () => {},
    onOpen: () => {},
    onUnfinished: (entry, verb) => acted.push({ id: entry.id, verb }),
  }

  const model: StripModel = {
    activity: { running: [], history: [] },
    approvals: [],
    unfinished,
    nowMs: Date.parse('2026-08-27T10:00:00Z'),
  }
  renderStrip(host, model, on)

  const nodes = all(host as unknown as El)
  return {
    host: host as unknown as El,
    text: ((host as unknown as El).textContent ?? '').replace(/\s+/g, ' ').trim(),
    zones: nodes.filter((n) => n.classList.contains('strip__zone--attention')),
    heading: (nodes.find((n) => n.classList.contains('strip__count'))?.textContent ?? '').trim(),
    buttons: nodes.filter((n) => n.tag === 'button'),
    acted,
  }
}

test('nobody having asked is not the same as nothing being outstanding', () => {
  // `null` means no answer has arrived. Drawing an empty zone here would answer "what was I in
  // the middle of?" with "nothing" on behalf of a ledger nobody has opened.
  const s = strip(null)
  assert.equal(s.zones.length, 0, 'the zone drew before any answer had arrived')
  assert.equal(
    /never reported/i.test(s.text),
    false,
    'the strip claims to know what is unfinished before the ledger has been read',
  )
})

test('the count is a plain number only when the ledger opened and every line parsed', () => {
  const clean = strip({ entries: [dispatch('a'), dispatch('b')], torn: [], problem: null })
  // The control: the zone must exist, or every assertion in this file is about an empty string.
  assert.equal(clean.zones.length, 1, `expected one attention zone, found ${clean.zones.length}`)
  assert.equal(clean.heading, '2 dispatches have no result')
})

test('one dispatch is one, not "1 dispatches"', () => {
  assert.equal(strip({ entries: [dispatch('a')], torn: [], problem: null }).heading, 'one dispatch has no result')
})

test('a count read off a ledger that would not open does not present itself as a fact', () => {
  // The number is the first thing on the zone and a bare number reads as settled. When the
  // ledger would not open it is a count of what we managed to read, and somebody scanning the
  // strip for what they were in the middle of must not take "0" for an answer.
  const s = strip({ entries: [], torn: [], problem: 'EACCES: permission denied' })

  assert.match(
    s.text,
    /could not be read: EACCES/,
    'the ledger problem was swallowed and the zone reports a count as though it knew',
  )
  assert.equal(
    /^\s*(one|\d+) dispatch/.test(s.heading),
    false,
    `the heading reads ${JSON.stringify(s.heading)} — a bare number, printed above the sentence ` +
      `saying the ledger would not open. That is the reading order the module's own comment ` +
      `warns about: "every count below it is then a count of what we managed to read and not of ` +
      `what is outstanding."`,
  )
})

test('a count taken from a ledger with unreadable lines does not present itself as a fact either', () => {
  // Same argument, one step in: a line that would not parse may be the record of the very
  // dispatch somebody is looking for, so a count that excludes it is not a count of what is
  // outstanding. "0 dispatches have no result" with two unreadable lines below it is the fourth
  // standing order broken by arithmetic.
  const s = strip({ entries: [], torn: [torn(12), torn(31)], problem: null })

  assert.equal(
    s.heading,
    'at least 0 — 2 lines of the ledger could not be read',
    `the heading reads ${JSON.stringify(s.heading)}`,
  )
})

test('lines that would not parse are shown, not filtered out on the way', () => {
  const s = strip({ entries: [], torn: [torn(12), torn(31)], problem: null })
  assert.match(s.text, /line 12/, 'an unreadable ledger line is not mentioned anywhere')
  assert.match(s.text, /line 31/, 'the second unreadable line was dropped')
  assert.match(s.text, /unterminated JSON/, 'the reason a line could not be read is not given')
})

test('a workspace with nothing outstanding and one whose ledger will not open do not look alike', () => {
  const clean = strip({ entries: [], torn: [], problem: null }).text
  const broken = strip({ entries: [], torn: [], problem: 'EACCES' }).text
  assert.notEqual(
    clean,
    broken,
    'a workspace that has dispatched nothing and one whose ledger will not open render ' +
      'identically. They are different facts and only one of them is good news.',
  )
})

test('each outstanding dispatch says who was asked and what was to be checked', () => {
  const s = strip({ entries: [dispatch('a', 'reviewer'), dispatch('b', 'builder')], torn: [], problem: null })
  assert.match(s.text, /reviewer/, 'the employee who was asked is not named')
  assert.match(s.text, /builder/, 'the second outstanding dispatch is missing')
  assert.match(
    s.text,
    /VERIFY `npm test` exits 0/,
    'the VERIFY is not shown. A retry that dropped it would re-send the work without the thing ' +
      'that settles it.',
  )
})

test('a dispatch with no VERIFY says so rather than showing an empty line', () => {
  const without: Dispatch = { ...dispatch('a'), verify: null }
  assert.match(strip({ entries: [without], torn: [], problem: null }).text, /No VERIFY was recorded/)
})

test('every verb is a deliberate press, and all three are wired', () => {
  // One handler for all three verbs "so a card can never be wired up with two of them and a dead
  // button — which is how a control that does nothing gets shipped."
  const s = strip({ entries: [dispatch('a')], torn: [], problem: null })
  assert.equal(s.acted.length, 0, 'drawing the strip acted on an unfinished dispatch by itself')

  const labels = s.buttons.map((b) => (b.textContent ?? '').trim())
  assert.deepEqual(labels, ['Drop', 'Retry', 'Resume'], `the card offers ${JSON.stringify(labels)}`)

  for (const button of s.buttons) button.dispatchEvent({ type: 'click', bubbles: true })
  assert.deepEqual(
    s.acted.map((a) => a.verb),
    ['drop', 'retry', 'resume'],
    'a verb reached the handler carrying the wrong word, or not at all',
  )
  assert.deepEqual(new Set(s.acted.map((a) => a.id)), new Set(['a']), 'a press carried the wrong dispatch')
})
