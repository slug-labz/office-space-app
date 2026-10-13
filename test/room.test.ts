/**
 * What the room is allowed to say.
 *
 * Every test here is a variation on one question: **can this reading be told apart from a
 * reading nobody took?** Before this module the answer was no — `notes: 0` was both "no work
 * outstanding" and "there is no `TASKS.md`", and `health: 1` was both "worked on this morning"
 * and "nobody has ever opened this project". Two facts sharing one picture is the failure
 * standing order 4 is named after, and a prop is the worst place for it, because a person reads
 * a room without deciding to.
 *
 * So the pairs matter more than the values. Several tests below assert two cases are *not
 * equal* rather than asserting either one is right, which is the property the drawing depends on.
 */

import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

import { CONVENTION, FRESH_MS, UNREAD, WILT_MS, readRoom } from '../src/shared/floor/room.js'
import type { RoomSources } from '../src/shared/floor/room.js'

const NOW = Date.parse('2026-08-27T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const project = (over: Partial<RoomSources> = {}): RoomSources => ({
  missing: [],
  lastActiveAt: ago(0),
  tasks: { outstanding: 0, unreadable: 0, problem: null },
  ...over,
})

// ─────────────────────────────────────────────────────────── the notice board ────

test('no project at all reads as nothing known, not as an empty office', () => {
  assert.deepEqual(readRoom(null, NOW), UNREAD)
})

test('an absent TASKS.md is not a board with nothing pinned to it', () => {
  const absent = readRoom(project({ missing: ['TASKS.md'] }), NOW)
  const empty = readRoom(project({ tasks: { outstanding: 0, unreadable: 0, problem: null } }), NOW)

  assert.equal(absent.notes, null, 'a file nobody could read is not a count of zero')
  assert.equal(empty.notes, 0, 'and zero is still a real answer when the file was read')
  assert.notDeepEqual(absent.notes, empty.notes, 'these two must never draw the same board')
})

test('a task list the harness could not read is unknown, however it failed', () => {
  assert.equal(readRoom(project({ tasks: null }), NOW).notes, null)
  assert.equal(
    readRoom(project({ tasks: { outstanding: 4, unreadable: 0, problem: 'unreadable' } }), NOW).notes,
    null,
    'a report carrying a problem is not a report — the four are not trustworthy',
  )
})

test('the board counts outstanding work, and takes it from the data', () => {
  assert.equal(readRoom(project({ tasks: { outstanding: 3, unreadable: 0, problem: null } }), NOW).notes, 3)
  assert.equal(readRoom(project({ tasks: { outstanding: 9, unreadable: 0, problem: null } }), NOW).notes, 9)
})

test('a row nobody could parse counts as outstanding, not as finished', () => {
  // Standing order 4 at the level of a single line. Dropping the unreadable rows would shrink
  // the number on the board every time the file got harder to read, and a count that falls when
  // the office understands less is worse than no count.
  const reading = readRoom(project({ tasks: { outstanding: 2, unreadable: 3, problem: null } }), NOW)
  assert.equal(reading.notes, 5)
})

// ───────────────────────────────────────────────────────────── the whiteboard ────

test('the whiteboard counts what is actually written down', () => {
  assert.equal(readRoom(project({ missing: [] }), NOW).board, CONVENTION.length)
  assert.equal(readRoom(project({ missing: ['PROGRESS.md'] }), NOW).board, 2)
  assert.equal(readRoom(project({ missing: [...CONVENTION] }), NOW).board, 0)
})

test('a project with nothing written down draws a blank board rather than an unknown one', () => {
  // Deliberately *not* null. `missing` is a list the office built by looking, so this is the one
  // reading it is never guessing at — and D12 says a project with no plan is a real project.
  assert.equal(readRoom(project({ missing: [...CONVENTION] }), NOW).board, 0)
})

test('a file the convention does not name does not fill the board', () => {
  assert.equal(readRoom(project({ missing: ['NOTES.md'] }), NOW).board, CONVENTION.length)
})

// ─────────────────────────────────────────────────────────────────── the plant ────

test('a project nobody has worked in has no health to draw', () => {
  const never = readRoom(project({ lastActiveAt: null }), NOW)
  assert.equal(never.health, null, 'never opened is not thriving, and it is not dying either')
})

test('an unparseable timestamp is the office failing to read, not the project decaying', () => {
  assert.equal(readRoom(project({ lastActiveAt: 'the other day' }), NOW).health, null)
})

test('health falls with the time since the project was last worked in', () => {
  const at = (ms: number) => readRoom(project({ lastActiveAt: ago(ms) }), NOW).health

  assert.equal(at(0), 1, 'just now')
  assert.equal(at(FRESH_MS), 1, 'still inside the day of grace')
  assert.equal(at(FRESH_MS + WILT_MS), 0, 'a fortnight past it')
  assert.equal(at(FRESH_MS + WILT_MS * 4), 0, 'and it does not go negative')

  const half = at(FRESH_MS + WILT_MS / 2)
  assert.ok(half !== null && half > 0.49 && half < 0.51, `halfway should be about half, got ${half}`)
})

test('health only ever falls as a project gets older', () => {
  // The direction is the part worth pinning. A decay curve that is subtly non-monotonic draws a
  // plant that perks up on its own, which is a prop reporting news that did not happen.
  let previous = 1
  for (let days = 0; days <= 30; days++) {
    const health = at(days)
    assert.ok(health !== null && health <= previous, `health rose at day ${days}`)
    previous = health
  }
  function at(days: number): number | null {
    return readRoom(project({ lastActiveAt: ago(days * 24 * 60 * 60 * 1000) }), NOW).health
  }
})

// ─────────────────────────────────────────────────────── the readings together ────

test('one prop going unknown does not blank the others', () => {
  // The case that made this function take the project row separately from the task report: a
  // `TASKS.md` the harness cannot open says nothing whatever about when the project was last
  // worked in, or about which files are on disk beside it.
  const reading = readRoom(project({ tasks: null, missing: ['TASKS.md'] }), NOW)

  assert.equal(reading.notes, null, 'the board cannot say')
  assert.equal(reading.board, 2, 'but the whiteboard still counts the two files that are there')
  assert.equal(reading.health, 1, 'and the plant still reads a recency nothing has disputed')
})

test('nothing here reads the clock', () => {
  // `now` is a parameter, so the same sources give the same answer twice. If this module ever
  // reaches for `Date.now()` the decay above becomes untestable and this fails first.
  const sources = project({ lastActiveAt: ago(FRESH_MS * 3) })
  assert.deepEqual(readRoom(sources, NOW), readRoom(sources, NOW))
})

// ─────────────────────────────────────────────── and that the floor uses it ────

test('every reporting prop is drawn from the reading, not from a literal', async () => {
  // The pure function above can be perfect and the room still lie, because the defect was never
  // in the arithmetic — it was three call sites passing `{ health: 1 }`, `{ lines: 3 }` and
  // `{ notes: 0 }` into props that were already able to say more. A regression here would not
  // fail any other test in this file: the module would still be right and nothing would ask it.
  //
  // `floor-view.ts` imports Electron-free but paints to a canvas, so this reads the source
  // rather than rendering it. That is a weaker check than driving the renderer and it is
  // written down as one — it proves the call sites take their state from `this.room`, not that
  // the picture is correct.
  const source = await readFile(new URL('../src/renderer/floor-view.ts', import.meta.url), 'utf8')

  const PROPS = ['drawPlant', 'drawWhiteboard', 'drawNoticeBoard'] as const
  for (const prop of PROPS) {
    // The instrument first: if the call site cannot be found at all, this test must fail as "I
    // could not look" rather than passing because a regex matched nothing.
    const calls = [...source.matchAll(new RegExp(`${prop}\\([^)]*\\)`, 'g'))].map((m) => m[0])
    assert.ok(calls.length > 0, `${prop} is not called in floor-view.ts — this test went blind`)

    for (const call of calls) {
      assert.match(
        call,
        /this\.room\./,
        `${prop} is drawn from something other than the room reading: ${call}`,
      )
    }
  }
})
