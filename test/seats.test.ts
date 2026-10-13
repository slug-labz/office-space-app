/**
 * Seam 4, and the test I said would come with it.
 *
 * From `planning/06-SEAMS.md`: *"The existing test stays and gains a sibling: `hiring never moves
 * a desk` keeps passing, and **firing moves exactly one desk — the fired one's — and no others**
 * joins it."* This is the sibling. It was promised in round 19 and the implementation was not
 * built, so `F12` shipped hiring and firing on top of index-assigned seats.
 *
 * Measured on `dev` before this landed, and it is worse than the description: on a floor of
 * seven, **carol leaving moved four other people's desks**, one of them from `2,11` to `10,8` —
 * right across the room. One thing happened and the screen showed five.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planFloor } from '../src/shared/floor/floorplan.js'
import { assignSeats, type SeatMap } from '../src/shared/floor/seats.js'
import { findPath } from '../src/shared/floor/pathfinding.js'

const SEVEN = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace']
const seatsOf = (plan: ReturnType<typeof planFloor>) =>
  new Map(plan.workstations.map((w) => [w.who, `${w.seat.x},${w.seat.y}`]))

/** Walk a roster through a change the way the renderer does: assign, then plan. */
function floor(previous: SeatMap, roster: readonly string[]) {
  const seats = assignSeats(previous, roster)
  return { seats, plan: planFloor('manager', roster, seats) }
}

test('firing moves exactly one desk — the fired one’s — and no others', () => {
  const before = floor({}, SEVEN)
  const after = floor(before.seats, SEVEN.filter((n) => n !== 'carol'))

  const was = seatsOf(before.plan)
  const now = seatsOf(after.plan)

  const moved = [...now].filter(([who, at]) => was.get(who) !== at).map(([who]) => who)
  assert.deepEqual(moved, [], `these were not fired and their desks moved: ${moved.join(', ')}`)
  assert.equal(now.has('carol'), false, 'carol still has a desk')
})

test('hiring still never moves a desk that already exists', () => {
  // The original promise, re-asserted against the new mechanism rather than assumed to survive.
  let seats: SeatMap = {}
  let previous = new Map<string, string>()
  for (let n = 1; n <= SEVEN.length; n++) {
    const step = floor(seats, SEVEN.slice(0, n))
    seats = step.seats
    const now = seatsOf(step.plan)
    for (const [who, at] of previous) {
      assert.equal(now.get(who), at, `hiring ${SEVEN[n - 1]} moved ${who}`)
    }
    previous = now
  }
})

test('a freed seat is reclaimed by the next hire rather than held forever', () => {
  // The other half of the rule. Holding it would leave a busy office slowly filling with gaps
  // for people who left months ago — furniture for nobody, which is its own small lie.
  const start = floor({}, SEVEN)
  const gone = floor(start.seats, SEVEN.filter((n) => n !== 'carol'))
  const carolsSlot = start.seats['carol']

  const hired = floor(gone.seats, [...SEVEN.filter((n) => n !== 'carol'), 'heidi'])
  assert.equal(hired.seats['heidi'], carolsSlot, 'the new hire did not take the empty desk')

  // …and taking it still moved nobody else.
  const before = seatsOf(gone.plan)
  const after = seatsOf(hired.plan)
  for (const [who, at] of before) assert.equal(after.get(who), at, `hiring heidi moved ${who}`)
})

test('nobody outside the roster keeps a seat, whatever the map remembers', () => {
  // A stale entry is a desk drawn for somebody who is gone — the exact failure Khalid's registry
  // rule is about, arriving at the seat map instead of the agent list.
  const seats = assignSeats({ ghost: 0, alice: 1 }, ['alice', 'bob'])
  assert.equal('ghost' in seats, false)
  assert.equal(seats['alice'], 1, 'alice kept her slot')
  assert.equal(seats['bob'], 0, 'bob took the freed one')
})

test('an empty map is the roster-index assignment the floor always used', () => {
  // What makes this change invisible on a fresh window: no map, no difference.
  const withMap = planFloor('manager', SEVEN, assignSeats({}, SEVEN))
  const without = planFloor('manager', SEVEN)
  assert.deepEqual(seatsOf(withMap), seatsOf(without))
})

test('a gap past the first bench still fits inside the room', () => {
  // The floor is as deep as the highest slot in use, not as the headcount. Six people holding
  // slots 0–4 and 13 need a second bench; sizing by `employees.length` would put a desk through
  // the near wall.
  const roster = ['a', 'b', 'c', 'd', 'e', 'f']
  const plan = planFloor('manager', roster, { a: 0, b: 1, c: 2, d: 3, e: 4, f: 13 })
  for (const station of plan.workstations) {
    assert.ok(station.desk.y < plan.height - 1, `${station.who}'s desk is in or past the wall`)
    assert.ok(station.seat.y < plan.height - 1, `${station.who} is sitting in the wall`)
  }
})

test('seating does not depend on the order the roster arrives in', () => {
  // Laptop 1's review: the assignment was correct only because `workspace.ts` happens to
  // `files.sort()` before reading agents — an incidental detail of discovery, in another
  // process, that nothing here declared a dependency on. Two people hired between one launch and
  // the next would have swapped desks with directory order, and it would have looked like the
  // floor shuffling for no reason.
  const forward = assignSeats({}, ['alice', 'bob', 'carol'])
  const backward = assignSeats({}, ['carol', 'bob', 'alice'])
  assert.deepEqual(forward, backward, 'the same people in a different order got different desks')
})

test('an existing seat still wins over the sort', () => {
  // Sorting is only for the unseated. Somebody already sitting keeps their desk even when the
  // alphabet would have given it to somebody else — otherwise the fix for one shuffle would
  // have introduced another.
  const seats = assignSeats({ zoe: 0 }, ['adam', 'zoe'])
  assert.equal(seats['zoe'], 0, 'zoe was moved out of the seat she already had')
  assert.equal(seats['adam'], 1)
})

// ──────────────────────────────────── an office that grows past one block of desks ──

/*
 * Twelve seats fill a block; the thirteenth starts another and the room gets taller.
 *
 * The tests above are about *which* seat somebody gets — that a hire never moves an existing
 * desk, that a freed seat is reclaimed. None of them asks the question the whole floor rests on:
 * **is every desk still a place a person can walk to?**
 *
 * That is not the same question as "does it have coordinates". A block is added by making the
 * room taller and placing furniture in it, and furniture is blocked tile by tile — so an
 * arrangement that walls off the far bench, or pushes the shelf behind a wall of desks, produces
 * a floor that draws perfectly and cannot be used. Nobody would see it until an employee was
 * dispatched and simply never arrived.
 *
 * Checked from the office door, because that is where every visit starts.
 */

const SIZES = [1, 11, 12, 13, 24, 25, 40, 60]

test('every employee gets a desk, at every size', () => {
  for (const n of SIZES) {
    const roster = Array.from({ length: n }, (_, i) => `a${i}`)
    const plan = planFloor('manager', roster, {})

    assert.equal(plan.workstations.length, n, `${n} staff got ${plan.workstations.length} desks`)
  }
})

test('no two people are put on the same tile, at every size', () => {
  for (const n of SIZES) {
    const roster = Array.from({ length: n }, (_, i) => `a${i}`)
    const plan = planFloor('manager', roster, {})

    const tiles = plan.workstations.flatMap((w) => [`${w.seat.x},${w.seat.y}`, `${w.desk.x},${w.desk.y}`])
    assert.equal(new Set(tiles).size, tiles.length, `${n} staff share a tile somewhere`)
  }
})

test('every seat can be walked to from the office door, at every size', () => {
  // The one that matters. A desk nobody can reach is worse than no desk: the floor looks right
  // and an employee dispatched there never arrives.
  for (const n of SIZES) {
    const roster = Array.from({ length: n }, (_, i) => `a${i}`)
    const plan = planFloor('manager', roster, {})

    const stranded = plan.workstations
      .filter((w) => findPath(plan.grid, plan.door, w.seat) === null)
      .map((w) => `${w.who} at ${w.seat.x},${w.seat.y}`)

    assert.deepEqual(stranded, [], `${n} staff: these desks cannot be reached from the door`)
  }
})

test('the fixtures stay reachable as the room grows', () => {
  // Adding a block makes the room taller and fills the new rows with furniture. The briefing
  // spot, the window and the shelf are pinned to fixed rows, so a bench that grew across the way
  // to one of them would strand a routine that every session uses.
  for (const n of SIZES) {
    const roster = Array.from({ length: n }, (_, i) => `a${i}`)
    const plan = planFloor('manager', roster, {})

    const lost = (
      [
        ['the briefing spot', plan.briefingSpot],
        ['the window', plan.window],
        ['the shelf', plan.shelfSpot],
        ["the manager's desk", plan.managerStation.seat],
      ] as const
    )
      .filter(([, tile]) => findPath(plan.grid, plan.door, tile) === null)
      .map(([name]) => name)

    assert.deepEqual(lost, [], `${n} staff: these are walled off`)
  }
})

test('the room only grows when a block is actually full', () => {
  // Twelve to a block. Growing early wastes a screen of empty desks; growing late puts one
  // through a wall, which is the failure the test above would catch and this one explains.
  const heightAt = (n: number) =>
    planFloor('manager', Array.from({ length: n }, (_, i) => `a${i}`), {}).height

  assert.equal(heightAt(12), heightAt(1), 'twelve still fits the first block')
  assert.ok(heightAt(13) > heightAt(12), 'the thirteenth needs a second block')
  assert.equal(heightAt(24), heightAt(13), 'twelve more fit in the second')
  assert.ok(heightAt(25) > heightAt(24), 'the twenty-fifth needs a third')
})

