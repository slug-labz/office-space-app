import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  insideOffice,
  planFloor,
  STAFF_AT_FULL_SCALE,
  stationsByName,
  TILE_SIZE,
} from '../src/shared/floor/floorplan.js'
import { BREAK_AFTER_MS, BREAK_STAGGER_MS, Choreographer, factsFromEvent, type AmbientOptions, type Fact, type Routine, type StationRef } from '../src/shared/floor/choreography.js'
import { RoutineRunner, type Stations } from '../src/shared/floor/routine.js'
import { Walker } from '../src/shared/floor/walker.js'
import { findPath } from '../src/shared/floor/pathfinding.js'
import { chooseScale, viewBounds } from '../src/shared/floor/projection.js'
import { tilesEqual } from '../src/shared/floor/geometry.js'

const STAFF = ['reviewer', 'builder', 'tester', 'frontend', 'backend']
/** A full bench block. Twelve is what one block seats, and where every side is occupied. */
const ROSTER_12 = Array.from({ length: 12 }, (_, i) => `staff-${i}`)

const chore = (roster: readonly string[] = STAFF) =>
  new Choreographer({ manager: 'manager', roster })

const only = (routines: readonly Routine[]): Routine => {
  assert.equal(routines.length, 1, `expected exactly one routine, got ${routines.length}`)
  return routines[0]!
}

const walks = (r: Routine): StationRef[] =>
  r.steps.flatMap((s) => (s.kind === 'walk' ? [s.to] : []))

// ─────────────────────────────────────────────────────────────── the floorplan ──

test('the floor is a function of the roster — no map to hand-edit', () => {
  const plan = planFloor('manager', STAFF)
  assert.equal(plan.workstations.length, STAFF.length)
  assert.deepEqual(
    plan.workstations.map((w) => w.who),
    STAFF,
  )
})

test('hiring does not rearrange the office', () => {
  // The promise is "add an agent, a desk appears". If existing desks moved, the office you
  // learned yesterday would be a different office today.
  const before = planFloor('manager', STAFF)
  const after = planFloor('manager', [...STAFF, ...Array.from({ length: 12 }, (_, i) => `hire-${i}`)])

  for (const [i, station] of before.workstations.entries()) {
    assert.deepEqual(after.workstations[i], station, `desk ${i} (${station.who}) moved`)
  }
  assert.ok(after.height > before.height, 'the floor should grow to fit the new rows')
  assert.equal(after.width, before.width, 'and grow downward only')
})

test('a small company still gets a whole office, not a corridor', () => {
  // The floor has a minimum size, so hiring a fourth person does not visibly stretch the room.
  const one = planFloor('manager', ['reviewer'])
  const four = planFloor('manager', ['reviewer', 'builder', 'tester', 'frontend'])
  assert.equal(one.height, four.height)
})

test('the window and the manager stay put as the company grows', () => {
  const small = planFloor('manager', ['reviewer'])
  const large = planFloor('manager', Array.from({ length: 17 }, (_, i) => `agent-${i}`))
  assert.deepEqual(small.window, large.window)
  assert.deepEqual(small.briefingSpot, large.briefingSpot)
  assert.deepEqual(small.managerStation.seat, large.managerStation.seat)
})

test('every desk can reach the manager, and the manager can reach the window', () => {
  const plan = planFloor('manager', STAFF)
  for (const station of plan.workstations) {
    assert.ok(
      findPath(plan.grid, station.seat, plan.briefingSpot),
      `${station.who} cannot walk to the manager's office`,
    )
  }
  assert.ok(findPath(plan.grid, plan.managerStation.seat, plan.window), 'window unreachable')
})

test('you cannot stand on furniture', () => {
  const plan = planFloor('manager', STAFF)
  assert.equal(plan.grid.isWalkable(plan.managerStation.desk.x, plan.managerStation.desk.y), false)
  for (const station of plan.workstations) {
    assert.equal(plan.grid.isWalkable(station.desk.x, station.desk.y), false, station.who)
    assert.equal(plan.grid.isWalkable(station.seat.x, station.seat.y), true, station.who)
  }
})

test('the office door is the only way in', () => {
  // If the walls leaked, an employee could drift diagonally into the room and "walking into
  // the manager's office" would stop being a legible moment.
  const plan = planFloor('manager', STAFF)
  const outside = plan.workstations[0]!.seat
  const path = findPath(plan.grid, outside, plan.briefingSpot)
  assert.ok(path, 'no route into the office at all')
  assert.ok(
    path.some((t) => tilesEqual(t, plan.door)),
    'a route into the office that does not use the door means the wall has a hole',
  )
})

test('a normal company fits on screen at 2×', () => {
  // The office renders at an integer scale, because pixel art at 1.7× has pixels of two
  // different sizes. That makes the room's proportions decide how much of the window it can
  // fill: a few tiles too big and it binds, drops to 1×, and the whole office halves. 1× was
  // the complaint the current layout was drawn to answer, so this is the check that matters.
  //
  // Asked of the *projection*, not of `TILE_SIZE`. Those were the same question in plan view
  // and have not been since; a tile is 16px to the walker and 32×20 on screen, so the arithmetic
  // this used to do — tile counts times `TILE_SIZE` — measured nothing the camera does and
  // would have passed a floor that draws at 1× as readily as one that does not.
  // Asked of `chooseScale` itself rather than re-derived here. This test used to restate the
  // rule — its own `OVERFLOW`, its own `PAD` — which meant it could agree with itself while
  // disagreeing with the renderer, and it did: it subtracted the pad a second time from a
  // figure that already had it taken off, so it had been 8px stricter than the real fit for as
  // long as it existed. A test that reimplements the thing it checks is checking the copy.
  const STAGE = { width: 848, height: 712 } // the stage in a 1280×820 window, per the app default
  const scaleFor = (count: number) => {
    const plan = planFloor('manager', Array.from({ length: count }, (_, i) => `a${i}`))
    // One z unit of headroom, or the back wall is drawn above the canvas.
    const box = viewBounds(plan.width, plan.height, 1)
    return { plan, box, scale: chooseScale(STAGE, box) }
  }

  for (const count of [1, 3, 6, 9, STAFF_AT_FULL_SCALE]) {
    const { plan, box, scale } = scaleFor(count)
    assert.ok(
      scale >= 2,
      `${count} staff gives a ${plan.width}×${plan.height} floor — ${box.width}×${box.height}px projected, which draws at ${scale}× not 2×`,
    )
  }

  // The other side of the same number, and the reason the hire form says something when a hire
  // crosses it. The scale is a whole number, so the office does not shrink gradually: one more
  // desk opens another row and the whole room steps down at once. If this ever starts passing,
  // `STAFF_AT_FULL_SCALE` is no longer where the edge is and the sentence in `openForm` is being
  // shown at the wrong moment.
  const past = scaleFor(STAFF_AT_FULL_SCALE + 1)
  assert.ok(
    past.scale < 2,
    `${STAFF_AT_FULL_SCALE + 1} staff still draws at ${past.scale}×, so the cliff is not where STAFF_AT_FULL_SCALE says it is`,
  )
})

test('a desk is always on the side its occupant faces', () => {
  // The rule that replaced "every desk faces the camera". A bench has two sides and the near
  // one is seen from behind, so the invariant cannot be about a fixed direction any more — but
  // it still has to be about *something*, or a station drawn with its desk on the wrong side
  // puts a person through their own furniture.
  const plan = planFloor('manager', ROSTER_12)
  for (const station of [...plan.workstations, plan.managerStation]) {
    const ahead = station.facing === 'down' ? station.seat.y + 1 : station.seat.y - 1
    assert.equal(station.desk.y, ahead, `${station.who} has their back to their desk`)
    assert.equal(station.desk.x, station.seat.x, `${station.who} sits off the end of their desk`)
  }
})

test('the staff do not all face the same way once there are enough of them', () => {
  // Reported: they all face the same way, and it looks weird. A bench block fills its
  // camera-facing side first, so a roster of three legitimately does; four is where the far
  // side starts, and from there on the floor has two directions in it.
  const facings = new Set(planFloor('manager', ROSTER_12).workstations.map((w) => w.facing))
  assert.deepEqual([...facings].sort(), ['down', 'up'])
})

test('desks spread across the benches before they fill one', () => {
  // Three hires belong on three benches, not stacked on the first one — an office with three
  // people in it should not look like a corner with three people in it.
  const xs = planFloor('manager', ['a', 'b', 'c']).workstations.map((w) => w.seat.x)
  assert.equal(new Set(xs).size, 3, `three hires share ${xs.length - new Set(xs).size} columns`)
})

test('hiring never moves a desk that already exists', () => {
  // The promise the whole layout is built around, re-asserted against the bench maths.
  const grow = ROSTER_12.map((_, i) => planFloor('manager', ROSTER_12.slice(0, i + 1)))
  for (let i = 1; i < grow.length; i++) {
    const before = grow[i - 1]!.workstations
    const after = grow[i]!.workstations
    for (let n = 0; n < before.length; n++) {
      assert.deepEqual(after[n], before[n], `hiring ${ROSTER_12[i]} moved ${before[n]!.who}`)
    }
  }
})

// ─────────────────────────────────────────────────── reading the event stream ──

test('a Task tool call is a dispatch, and carries who it went to', () => {
  const facts = factsFromEvent(
    {
      kind: 'assistant',
      blocks: [
        {
          type: 'tool_use',
          id: 'toolu_01',
          name: 'Task',
          input: { subagent_type: 'reviewer', description: 'Review the auth change' },
        },
      ],
    },
    'manager',
  )
  assert.deepEqual(facts, [
    {
      kind: 'dispatch',
      toolUseId: 'toolu_01',
      employee: 'reviewer',
      brief: 'Review the auth change',
    },
  ])
})

test('an ordinary tool call is work at a desk, not a delegation', () => {
  const facts = factsFromEvent(
    { kind: 'assistant', blocks: [{ type: 'tool_use', id: 't2', name: 'Read', input: {} }] },
    'builder',
  )
  assert.deepEqual(facts, [{ kind: 'acting', who: 'builder', tool: 'Read' }])
})

test('a Task with no subagent_type is not treated as a dispatch to nobody', () => {
  const facts = factsFromEvent(
    { kind: 'assistant', blocks: [{ type: 'tool_use', id: 't3', name: 'Task', input: {} }] },
    'manager',
  )
  assert.deepEqual(facts, [{ kind: 'acting', who: 'manager', tool: 'Task' }])
})

test('a tool result is a delivery', () => {
  const facts = factsFromEvent(
    { kind: 'user', blocks: [{ type: 'tool_result', tool_use_id: 'toolu_01' }] },
    'manager',
  )
  assert.deepEqual(facts, [{ kind: 'delivered', toolUseId: 'toolu_01' }])
})

// ──────────────────────────────────────────────────────── the delegation walk ──

const DISPATCH: Fact = {
  kind: 'dispatch',
  toolUseId: 'toolu_01',
  employee: 'reviewer',
  brief: 'Review the auth change',
}

test('a dispatch sends the employee to the manager, then back to their desk', () => {
  const routine = only(chore().handle(DISPATCH).routines)
  assert.equal(routine.who, 'reviewer')
  assert.equal(routine.name, 'briefing')
  assert.deepEqual(walks(routine), [{ at: 'briefing' }, { at: 'desk', who: 'reviewer' }])
})

test('the walk is traceable to the tool call that caused it', () => {
  // The floor is a claim about what is happening. This is the receipt.
  const routine = only(chore().handle(DISPATCH).routines)
  assert.equal(routine.reason.toolUseId, 'toolu_01')
  assert.match(routine.reason.summary, /Review the auth change/)
})

test('the result comes back to the manager too', () => {
  const c = chore()
  c.handle(DISPATCH)
  const routine = only(c.handle({ kind: 'delivered', toolUseId: 'toolu_01' }).routines)
  assert.equal(routine.name, 'delivering')
  assert.equal(routine.who, 'reviewer', 'the id is the only link back to who was dispatched')
  assert.deepEqual(walks(routine), [{ at: 'briefing' }, { at: 'desk', who: 'reviewer' }])
})

test('a result for something that was never a dispatch moves nobody', () => {
  // Most tool results are a Read or a Bash coming home. Nobody walks anywhere for those.
  assert.deepEqual(chore().handle({ kind: 'delivered', toolUseId: 'toolu_grep' }).routines, [])
})

test('a dispatch to an agent with no desk is reported, not swallowed', () => {
  // Absent is not empty. A built-in type, or an agent added since the floor was drawn, is
  // still real work — a floor that simply fails to react is lying by omission.
  const staged = chore().handle({
    kind: 'dispatch',
    toolUseId: 'toolu_09',
    employee: 'general-purpose',
    brief: null,
  })
  assert.deepEqual(staged.routines, [])
  assert.deepEqual(staged.unstaged, [
    { kind: 'dispatch', toolUseId: 'toolu_09', employee: 'general-purpose', brief: null, why: 'no-desk' },
  ])
})

test('a stream of tool calls does not make anyone twitch', () => {
  const c = chore()
  assert.equal(c.handle({ kind: 'acting', who: 'builder', tool: 'Read' }).routines.length, 1)
  assert.deepEqual(c.handle({ kind: 'acting', who: 'builder', tool: 'Edit' }).routines, [])
  assert.deepEqual(c.handle({ kind: 'acting', who: 'builder', tool: 'Bash' }).routines, [])
})

// ────────────────────────────────────────────────────── a depiction cannot lie ──

test('a task that finishes early cancels the walk that was depicting it', () => {
  // The employee is still walking to the briefing when the result lands. Carrying on with a
  // handoff that is already over would be the floor showing something that is no longer true.
  const c = chore()
  c.handle(DISPATCH)
  assert.equal(c.routineFor('reviewer')?.name, 'briefing')

  const routine = only(c.handle({ kind: 'delivered', toolUseId: 'toolu_01' }).routines)
  assert.equal(routine.name, 'delivering')
  assert.equal(c.routineFor('reviewer')?.name, 'delivering')
})

test('a run ending stops the head-down-at-the-desk depiction', () => {
  const c = chore()
  c.handle({ kind: 'acting', who: 'builder', tool: 'Edit' })
  assert.equal(c.routineFor('builder')?.name, 'settling')

  const routine = only(c.handle({ kind: 'settled', who: 'builder' }).routines)
  assert.equal(routine.name, 'resting')
  assert.deepEqual(routine.steps, [{ kind: 'pose', pose: 'idle' }])
})

test('a run ending does not cancel the walk that shows it ending', () => {
  // The delivery walk *is* the depiction of the work finishing. Cancelling it on the result
  // event would delete the one moment the floor exists to show.
  const c = chore()
  c.handle(DISPATCH)
  c.handle({ kind: 'delivered', toolUseId: 'toolu_01' })
  assert.deepEqual(c.handle({ kind: 'settled', who: 'reviewer' }).routines, [])
  assert.equal(c.routineFor('reviewer')?.name, 'delivering')
})

test('typing brings the manager to the window', () => {
  const routine = only(chore().handle({ kind: 'composing', composing: true }).routines)
  assert.equal(routine.who, 'manager')
  assert.equal(routine.name, 'attending')
  assert.deepEqual(walks(routine), [{ at: 'window' }])
})

test('a manager who is actually working does not come and watch you type', () => {
  const c = chore()
  c.handle({ kind: 'acting', who: 'manager', tool: 'Edit' })
  assert.deepEqual(c.handle({ kind: 'composing', composing: true }).routines, [])
})

test('…and comes over the moment they are free', () => {
  const c = chore()
  c.handle({ kind: 'acting', who: 'manager', tool: 'Edit' })
  c.handle({ kind: 'composing', composing: true })
  const routine = only(c.handle({ kind: 'settled', who: 'manager' }).routines)
  assert.equal(routine.name, 'attending')
})

test('real work interrupts listening; listening never interrupts real work', () => {
  const c = chore()
  c.handle({ kind: 'composing', composing: true })
  assert.equal(c.routineFor('manager')?.name, 'attending')

  // A real event outranks app state…
  c.handle({ kind: 'acting', who: 'manager', tool: 'Bash' })
  assert.equal(c.routineFor('manager')?.name, 'settling')

  // …and app state cannot take it back.
  c.handle({ kind: 'composing', composing: false })
  c.handle({ kind: 'composing', composing: true })
  assert.equal(c.routineFor('manager')?.name, 'settling')
})

test('sending walks the manager back to their desk', () => {
  const c = chore()
  c.handle({ kind: 'composing', composing: true })
  const routine = only(c.handle({ kind: 'composing', composing: false }).routines)
  assert.equal(routine.name, 'returning')
  assert.deepEqual(walks(routine), [{ at: 'desk', who: 'manager' }])
})

test('stopping typing when nobody came to listen moves nobody', () => {
  assert.deepEqual(chore().handle({ kind: 'composing', composing: false }).routines, [])
})

// ─────────────────────────────────────────────────────── a live conversation ──

/**
 * Reported after watching the manager answer and then walk off mid-answer:
 *
 * While you are talking to the manager and it is on screen talking back, it must not go back
 * to its desk — it should still be at the monitor, thinking about the conversation.
 *
 * The bug is legible in the name of the thing it was hung on. `composing` is true while you are
 * **typing**, so the manager turned to listen at the first keystroke and left at the first
 * pause — depicting the state of a keyboard and calling it attention. What a person means by
 * talking to somebody is the state of the *conversation*, which the app knows exactly.
 */
test('a pause in typing is not the end of a conversation', () => {
  const c = chore()
  c.handle({ kind: 'conversing', conversing: true })
  c.handle({ kind: 'composing', composing: true })

  assert.deepEqual(
    c.handle({ kind: 'composing', composing: false }).routines,
    [],
    'they stay with you; the walk back to the desk is what the complaint was about',
  )
  assert.equal(c.routineFor('manager')?.name, 'attending')
})

test('when the conversation is over, stopping typing walks them back as before', () => {
  const c = chore()
  c.handle({ kind: 'conversing', conversing: true })
  c.handle({ kind: 'composing', composing: true })
  c.handle({ kind: 'conversing', conversing: false })

  const routine = only(c.handle({ kind: 'composing', composing: false }).routines)
  assert.equal(routine.name, 'returning')
})

test('opening a conversation brings the manager over without waiting for a keystroke', () => {
  const routine = only(chore().handle({ kind: 'conversing', conversing: true }).routines)
  assert.equal(routine.name, 'attending')
  assert.deepEqual(walks(routine), [{ at: 'window' }])
})

test('a manager mid-task is not pulled out of it by a conversation opening', () => {
  // The same rule `composing` already had, and for the same reason: app state never outranks a
  // real event. A manager depicted at their desk is depicted there because the stream said so.
  const c = chore()
  c.handle({ kind: 'acting', who: 'manager', tool: 'Edit' })
  assert.deepEqual(c.handle({ kind: 'conversing', conversing: true }).routines, [])
  assert.equal(c.routineFor('manager')?.name, 'settling')
})

test('finishing a task during a conversation returns them to you, not to the desk', () => {
  const c = chore()
  c.handle({ kind: 'conversing', conversing: true })
  c.handle({ kind: 'acting', who: 'manager', tool: 'Read' })
  const routine = only(c.handle({ kind: 'settled', who: 'manager' }).routines)
  assert.equal(routine.name, 'attending', 'the conversation is still open, so they come back to it')
})

test('ending a conversation moves nobody by itself', () => {
  // Deliberately not the mirror of opening one. Work starting is what moves people to desks, and
  // a second system doing the same job is how a floor learns to contradict itself.
  const c = chore()
  c.handle({ kind: 'conversing', conversing: true })
  assert.deepEqual(c.handle({ kind: 'conversing', conversing: false }).routines, [])
})

// ────────────────────────────────────────────────────────────────── the runner ──

const runnerFor = (plan: ReturnType<typeof planFloor>, start: { x: number; y: number }) => {
  const byName = stationsByName(plan)
  const stations: Stations = {
    resolve(ref) {
      if (ref.at === 'briefing') return plan.briefingSpot
      if (ref.at === 'window') return plan.window
      if (ref.at === 'shelf') return plan.shelfSpot
      if (ref.at === 'meeting') return plan.meeting.seats[ref.seat]?.tile ?? null
      if (ref.at === 'lounge') {
        if (ref.spot === 'coffee') return plan.pantry.spots[0]?.tile ?? null
        return ref.spot === 'sofa'
          ? { x: plan.lounge.sofa.x0, y: plan.lounge.sofa.y1 + 1 }
          : { x: plan.lounge.waterCooler.x, y: plan.lounge.waterCooler.y + 1 }
      }
      return byName.get(ref.who)?.seat ?? null
    },
  }
  const walker = new Walker(start, { tileSize: TILE_SIZE })
  return { walker, runner: new RoutineRunner(walker, plan.grid, stations, TILE_SIZE) }
}

/** Tick until the routine finishes, or give up. Returns seconds of simulated time. */
function run(runner: RoutineRunner, limitSeconds = 60): number {
  const dt = 1 / 60
  for (let t = 0; t < limitSeconds; t += dt) {
    if (runner.update(dt)) return t
  }
  throw new Error('routine never finished')
}

test('an employee actually walks into the office and back to their desk', () => {
  const plan = planFloor('manager', STAFF)
  const desk = plan.workstations[0]!
  const { walker, runner } = runnerFor(plan, desk.seat)

  const routine = only(chore().handle(DISPATCH).routines)
  runner.start(routine)

  // Partway through, they should be inside the manager's office — not merely have teleported
  // to the end state.
  let reachedTheOffice = false
  const dt = 1 / 60
  for (let t = 0; t < 60; t += dt) {
    const done = runner.update(dt)
    const tx = Math.floor(walker.position.x / TILE_SIZE)
    const ty = Math.floor((walker.position.y - 0.0001) / TILE_SIZE)
    if (insideOffice(plan.office, tx, ty)) reachedTheOffice = true
    if (done) break
  }

  assert.ok(reachedTheOffice, 'never entered the office')
  assert.deepEqual(
    { x: Math.floor(walker.position.x / TILE_SIZE), y: Math.floor((walker.position.y - 0.0001) / TILE_SIZE) },
    desk.seat,
    'did not end up back at their own desk',
  )
  assert.equal(runner.state.pose, 'working')
})

test('the handoff beat is real time, not a skipped frame', () => {
  const plan = planFloor('manager', STAFF)
  const { runner } = runnerFor(plan, plan.briefingSpot)
  runner.start(only(chore().handle(DISPATCH).routines))
  // Standing at the briefing spot already, so the whole first walk is free — what is left is
  // the pause plus the walk home. Without a real pause this would finish almost instantly.
  assert.ok(run(runner) > 0.7, 'the pause at the desk was not observed')
})

test('the manager walks to the window and faces you', () => {
  const plan = planFloor('manager', STAFF)
  const { walker, runner } = runnerFor(plan, plan.managerStation.seat)
  runner.start(only(chore().handle({ kind: 'composing', composing: true }).routines))
  run(runner)

  assert.deepEqual(
    { x: Math.floor(walker.position.x / TILE_SIZE), y: Math.floor((walker.position.y - 0.0001) / TILE_SIZE) },
    plan.window,
  )
  assert.equal(walker.facing, 'right', 'the chat panel is to the right; they should be facing it')
  assert.equal(runner.state.pose, 'listening')
})

test('an unreachable station is reported rather than freezing the routine', () => {
  const plan = planFloor('manager', STAFF)
  const stations: Stations = { resolve: () => null } // as if a desk had vanished
  const walker = new Walker(plan.window, { tileSize: TILE_SIZE })
  const runner = new RoutineRunner(walker, plan.grid, stations, TILE_SIZE)

  runner.start(only(chore().handle(DISPATCH).routines))
  run(runner)
  assert.deepEqual(runner.state.blocked, { at: 'desk', who: 'reviewer' })
})

// ──────────────────────────────────────────────── a roster that changes mid-task ──
//
// The workspace is watched, so staff arrive and leave in the middle of real work as a matter of
// routine. Everything below is about what must survive that.

test('a roster change keeps the dispatch correlation, so the result still comes home', () => {
  const c = chore(['reviewer'])
  c.handle({ kind: 'dispatch', toolUseId: 't1', employee: 'reviewer', brief: 'review auth' })

  // Somebody drops a new agent file into .claude/agents/ while the reviewer is working.
  c.updateRoster({ manager: 'manager', roster: ['reviewer', 'builder'] })

  const staged = c.handle({ kind: 'delivered', toolUseId: 't1' })
  const routine = only(staged.routines)
  assert.equal(routine.who, 'reviewer')
  assert.equal(routine.name, 'delivering')
})

test('a roster change does not forget who is busy', () => {
  const c = chore(['reviewer'])
  c.handle({ kind: 'dispatch', toolUseId: 't1', employee: 'reviewer', brief: null })

  c.updateRoster({ manager: 'manager', roster: ['reviewer', 'tester'] })

  assert.equal(c.isBusy('reviewer'), true)
})

test('a roster change does not restage a routine that is already running', () => {
  const c = chore(['reviewer'])
  c.handle({ kind: 'dispatch', toolUseId: 't1', employee: 'reviewer', brief: null })

  c.updateRoster({ manager: 'manager', roster: ['reviewer'] })

  assert.equal(c.routineFor('reviewer')?.name, 'briefing')
})

test('somebody who leaves the workspace stops being depicted', () => {
  const c = chore(['reviewer'])
  c.handle({ kind: 'dispatch', toolUseId: 't1', employee: 'reviewer', brief: null })

  // Their agent file was deleted. There is no desk to walk back to.
  c.updateRoster({ manager: 'manager', roster: [] })

  assert.equal(c.routineFor('reviewer'), null)
})

test('work dispatched to someone who then left is still tracked, not lost', () => {
  const c = chore(['reviewer'])
  c.handle({ kind: 'dispatch', toolUseId: 't1', employee: 'reviewer', brief: null })
  c.updateRoster({ manager: 'manager', roster: [] })

  // The subagent is still running out there; the result arriving is real. There is simply
  // nobody on the floor to walk it back, and that is a silent no-op rather than a crash.
  const staged = c.handle({ kind: 'delivered', toolUseId: 't1' })
  assert.deepEqual(staged.routines, [])
  assert.equal(c.isBusy('reviewer'), false, 'the work did finish, whoever was doing it')
})

test('the manager can be replaced without stranding the floor', () => {
  const c = chore(['reviewer'])
  c.handle({ kind: 'composing', composing: true })
  assert.equal(c.routineFor('manager')?.name, 'attending')

  c.updateRoster({ manager: 'boss', roster: ['reviewer'] })

  assert.equal(c.routineFor('manager'), null, 'the old manager is not on the floor any more')
})

test('a dispatch is recognised under either name for the delegation tool', () => {
  for (const tool of ['Task', 'Agent']) {
    const facts = factsFromEvent(
      {
        kind: 'assistant',
        blocks: [{ type: 'tool_use', id: 'x1', name: tool, input: { subagent_type: 'reviewer', description: 'go' } }],
      },
      'manager',
    )
    assert.deepEqual(
      facts,
      [{ kind: 'dispatch', toolUseId: 'x1', employee: 'reviewer', brief: 'go' }],
      `${tool} must read as a dispatch, not as an ordinary tool call`,
    )
  }
})

// ───────────────────────────────────────────────────────────────── the shelf ──
//
// The vision's own image of using a capability: walk to the shelf, take something down, carry
// it back. A skill is a tool call, and "went to fetch the thing they used" is the more truthful
// account of the same moment.

test('a skill sends somebody to the shelf and back to their desk', () => {
  const c = chore(['reviewer'])

  const routine = only(c.handle({ kind: 'fetching', who: 'reviewer', skill: 'write-a-task' }).routines)

  assert.equal(routine.name, 'fetching')
  assert.deepEqual(walks(routine), [{ at: 'shelf' }, { at: 'desk', who: 'reviewer' }])
  assert.match(routine.reason.summary, /write-a-task/)
})

test('a skill call reads as a fetch rather than as an ordinary tool call', () => {
  const facts = factsFromEvent(
    { kind: 'assistant', blocks: [{ type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'record-progress' } }] },
    'reviewer',
  )

  assert.deepEqual(facts, [{ kind: 'fetching', who: 'reviewer', skill: 'record-progress' }])
})

test('a Skill call with no skill named falls back to being an ordinary tool call', () => {
  const facts = factsFromEvent(
    { kind: 'assistant', blocks: [{ type: 'tool_use', id: 's1', name: 'Skill', input: {} }] },
    'reviewer',
  )

  assert.deepEqual(facts, [{ kind: 'acting', who: 'reviewer', tool: 'Skill' }])
})

test('fetching outranks settling — it is the same moment, described more truthfully', () => {
  const c = chore(['reviewer'])
  c.handle({ kind: 'acting', who: 'reviewer', tool: 'Read' })

  const staged = c.handle({ kind: 'fetching', who: 'reviewer', skill: 'write-a-task' })

  assert.equal(only(staged.routines).name, 'fetching')
})

test('a skill used mid-dispatch does not pull somebody out of the manager’s office', () => {
  // A briefing and a delivery are the two ends of a dispatch. A skill invoked in between does
  // not change whose hands the work is in.
  for (const at of ['briefing', 'delivering'] as const) {
    const c = chore(['reviewer'])
    c.handle({ kind: 'dispatch', toolUseId: 't1', employee: 'reviewer', brief: null })
    if (at === 'delivering') c.handle({ kind: 'delivered', toolUseId: 't1' })

    const staged = c.handle({ kind: 'fetching', who: 'reviewer', skill: 'write-a-task' })

    assert.deepEqual(staged.routines, [], `${at} should not be interrupted`)
  }
})

test('the shelf is somewhere you can stand in front of, and not on', () => {
  const plan = planFloor('manager', STAFF)

  assert.equal(plan.grid.isWalkable(plan.shelf.x0, plan.shelf.y0), false, 'you do not stand on a shelf')
  assert.equal(plan.grid.isWalkable(plan.shelfSpot.x, plan.shelfSpot.y), true)
  assert.equal(plan.shelfSpot.y, plan.shelf.y0 + 1, 'directly in front of it')
})

test('the shelf is reachable from every desk', () => {
  const plan = planFloor('manager', STAFF)

  for (const station of plan.workstations) {
    assert.notEqual(
      findPath(plan.grid, station.seat, plan.shelfSpot),
      null,
      `${station.who} cannot reach the shelf`,
    )
  }
})

test('every named place on the floor is reachable from every seat', () => {
  // The one test that stands between a prop and a sealed section. Three of the four sections
  // in the fixed bands have exactly one way in, so any obstacle placed in the wrong square cuts
  // half the office off — and it does it silently, because a character that cannot route simply
  // stands still and standing still is what most of them are doing anyway.
  //
  // Run against a full bench block as well as a small roster: the desk field grows downward and
  // a route that exists for five people is not evidence about twelve.
  for (const roster of [['solo'], STAFF, ROSTER_12]) {
    const plan = planFloor('manager', roster)
    const places: [string, { x: number; y: number }][] = [
      ['the shelf', plan.shelfSpot],
      ['the printer', plan.amenities.printerSpot.tile],
      ['the briefing spot', plan.briefingSpot],
      ['the window', plan.window],
      ['the racks', plan.servers.spot.tile],
      ...plan.meeting.seats.map((s, i): [string, { x: number; y: number }] => [`meeting seat ${i}`, s.tile]),
      ...plan.lounge.spots.map((s, i): [string, { x: number; y: number }] => [`lounge spot ${i}`, s.tile]),
      ...plan.pantry.spots.map((s, i): [string, { x: number; y: number }] => [`pantry spot ${i}`, s.tile]),
    ]

    const seats = [...plan.workstations.map((w) => [w.who, w.seat] as const), ['the manager', plan.managerStation.seat] as const]
    for (const [name, tile] of places) {
      assert.equal(plan.grid.isWalkable(tile.x, tile.y), true, `${name} is not somewhere you can stand`)
      for (const [who, seat] of seats) {
        assert.notEqual(
          findPath(plan.grid, seat, tile),
          null,
          `with ${roster.length} on the floor, ${who} cannot reach ${name}`,
        )
      }
    }
  }
})

test('the manager can get out from behind their own desk', () => {
  // The office interior has one square of slack. A plant in the wrong corner of it strands the
  // manager, and the failure looks exactly like a manager who has decided not to move.
  for (const roster of [[], STAFF, ROSTER_12]) {
    const plan = planFloor('manager', roster)
    assert.notEqual(findPath(plan.grid, plan.managerStation.seat, plan.briefingSpot), null)
    assert.notEqual(findPath(plan.grid, plan.managerStation.seat, plan.shelfSpot), null)
  }
})

test('a bench block seats twelve without making the room taller', () => {
  // The depth the bench bought, asserted rather than described. Twelve staff used to need three
  // rows of desks and a fifteen-row room; they now share one block and the room stays at its
  // minimum, which is what pays for the clear columns between the benches.
  assert.equal(planFloor('manager', ROSTER_12).height, planFloor('manager', ['solo']).height)
})

test('the shelf does not sit on top of anybody’s desk', () => {
  const plan = planFloor('manager', STAFF)

  for (const station of [...plan.workstations, plan.managerStation]) {
    const onShelfRow = station.desk.y === plan.shelf.y0 && station.desk.x >= plan.shelf.x0 && station.desk.x <= plan.shelf.x1
    assert.equal(onShelfRow, false, `${station.who}'s desk collides with the shelf`)
  }
})

// ────────────────────────────────────────────────────────────────── meetings ──

const meetCall = (id: string, args: string) => ({
  kind: 'assistant',
  blocks: [{ type: 'tool_use', id, name: 'Skill', input: { skill: 'meet', args } }],
})

test('THE COLLISION: calling a meeting is not fetching a book', () => {
  // Laptop 1 caught this on the seam. Every Skill call became a `fetching` fact, so `/meet`
  // walked the manager to the bookshelf — the floor confidently depicting the wrong thing,
  // which standing order 3 rates as worse than depicting nothing.
  const facts = factsFromEvent(meetCall('toolu_m1', 'reviewer builder'), 'manager')
  assert.equal(facts.length, 1)
  assert.equal(facts[0]?.kind, 'meeting')
})

test('every other skill still goes to the shelf', () => {
  const facts = factsFromEvent(
    { kind: 'assistant', blocks: [{ type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'write-a-task' } }] },
    'builder',
  )
  assert.equal(facts[0]?.kind, 'fetching')
})

test('who is at the meeting comes from the payload, not from prose', () => {
  const facts = factsFromEvent(meetCall('toolu_m2', 'reviewer  builder '), 'manager')
  const f = facts[0]
  assert.ok(f && f.kind === 'meeting')
  assert.equal(f.convener, 'manager')
  assert.deepEqual([...f.attendees], ['reviewer', 'builder'])
})

test('everyone called walks to a seat, and the convener takes the first', () => {
  const c = chore()
  const staged = c.handle({
    kind: 'meeting', toolUseId: 'toolu_m3', convener: 'manager', attendees: ['reviewer', 'tester'],
  })
  assert.deepEqual(
    staged.routines.map((r) => r.who),
    ['manager', 'reviewer', 'tester'],
  )
  assert.deepEqual(
    staged.routines.flatMap((r) => r.steps.filter((s) => s.kind === 'walk').map((s) => s.to)),
    [{ at: 'meeting', seat: 0 }, { at: 'meeting', seat: 1 }, { at: 'meeting', seat: 2 }],
  )
})

test('a meeting lasts as long as its tool call, not a fixed beat', () => {
  // The steps deliberately have no pause and no walk home. A routine that sent everyone back
  // after N milliseconds would be a depiction with its own opinion about how long a meeting
  // takes, which is exactly the kind of invention the floor refuses.
  const c = chore()
  c.handle({ kind: 'meeting', toolUseId: 'toolu_m4', convener: 'manager', attendees: ['reviewer'] })
  assert.equal(c.routineFor('reviewer')?.name, 'meeting')

  const ended = c.handle({ kind: 'delivered', toolUseId: 'toolu_m4' })
  assert.deepEqual(ended.routines.map((r) => r.who).sort(), ['manager', 'reviewer'])
  assert.equal(c.routineFor('reviewer')?.name, 'dispersing')
})

test('a tool call during a meeting does not drag anybody back to their desk', () => {
  // A meeting is work-priority, so it is not interrupted by the tool calls of the people in it
  // — and that is the truer picture. Someone who acts during a meeting is acting *in* the
  // meeting; yanking them to their desk would depict them leaving a meeting that is still
  // running. (I wrote this test the other way round first and the code was right, not the test.)
  const c = chore()
  c.handle({ kind: 'meeting', toolUseId: 'toolu_m5', convener: 'manager', attendees: ['reviewer'] })
  c.handle({ kind: 'acting', who: 'reviewer', tool: 'Read' })
  assert.equal(c.routineFor('reviewer')?.name, 'meeting')
})

test('being dispatched mid-meeting wins, and the meeting lets them go', () => {
  // A dispatch is a newer fact of the same rank, so it supersedes. When the meeting then ends
  // it must not drag back somebody who is now doing something truer.
  const c = chore()
  c.handle({ kind: 'meeting', toolUseId: 'toolu_m8', convener: 'manager', attendees: ['reviewer'] })
  c.handle({ kind: 'dispatch', toolUseId: 'toolu_d1', employee: 'reviewer', brief: 'urgent' })
  assert.equal(c.routineFor('reviewer')?.name, 'briefing')

  const ended = c.handle({ kind: 'delivered', toolUseId: 'toolu_m8' })
  assert.deepEqual(ended.routines.map((r) => r.who), ['manager'])
  assert.equal(c.routineFor('reviewer')?.name, 'briefing', 'still doing the newer, truer thing')
})

test('calling somebody who has no desk is reported, not swallowed', () => {
  const staged = chore().handle({
    kind: 'meeting', toolUseId: 'toolu_m6', convener: 'manager', attendees: ['nobody'],
  })
  assert.deepEqual(staged.unstaged.map((u) => u.employee), ['nobody'])
})

test('a meeting called with nobody is still the manager at the table', () => {
  const staged = chore().handle({
    kind: 'meeting', toolUseId: 'toolu_m7', convener: 'manager', attendees: [],
  })
  assert.deepEqual(staged.routines.map((r) => r.who), ['manager'])
})

// ───────────────────────────────────────────────── the living office, honestly ──

/** Idle for `ms`, in one-second slices, and collect whatever drifts. */
function idleFor(c: Choreographer, ms: number, opts: AmbientOptions = { pick: () => 0 }) {
  const out: Routine[] = []
  for (let t = 0; t < ms; t += 1000) out.push(...c.ambient(1000, opts).routines)
  return out
}

test('nothing to do, so after a while they drift off', () => {
  // The living-office requirement. An idle agent walking to the coffee machine is not invented
  // activity — it is the truest available picture of an agent doing nothing.
  const c = chore()
  assert.deepEqual(idleFor(c, 20_000), [], 'not immediately — that would read as fidgeting')
  const drifted = idleFor(c, 90_000)
  assert.ok(drifted.length > 0, 'nobody ever took a break')
  assert.equal(drifted[0]?.name, 'break')
})

test('THE RULE: busy never drifts', () => {
  // The collision with standing order 3, enforced rather than described. Someone mid-tool-call
  // belongs at their desk, however long the office has been quiet around them.
  const c = chore()
  c.handle({ kind: 'acting', who: 'builder', tool: 'Edit' })
  const drifted = idleFor(c, 60_000)
  assert.equal(drifted.filter((r) => r.who === 'builder').length, 0, 'builder wandered off mid-task')
})

test('the idle clock resets rather than pauses', () => {
  // A break is earned by being idle *continuously*. Otherwise somebody working in short bursts
  // accumulates enough quiet between tool calls to wander off mid-task.
  const c = chore()
  idleFor(c, 10_000)
  c.handle({ kind: 'acting', who: 'builder', tool: 'Read' })
  c.handle({ kind: 'settled', who: 'builder' })
  assert.deepEqual(
    idleFor(c, 5_000).filter((r) => r.who === 'builder'),
    [],
    'the earlier idleness should not have counted toward a break',
  )
})

test('work done while nobody is counting idle time still starts the clock again', () => {
  // The floor does not call `ambient` for a conversation that is not on screen, or while the
  // campus is up. Somebody who works and finishes in that gap has earned no break, however long
  // they were idle before it. The test above cannot see this: its idleness is below every
  // threshold either way, and it calls `ambient` between the two facts' neighbours.
  //
  // Builder's own threshold is measured rather than assumed, because it is staggered by name.
  // `earned` stops a second short of it, so the idling below stops three seconds short. The five
  // seconds after the work would cross it, unless the work started the clock again.
  const probe = chore(['builder'])
  let earned = 0
  while (!idleFor(probe, 1000).some((r) => r.who === 'builder')) {
    earned += 1000
    assert.ok(earned < BREAK_AFTER_MS + BREAK_STAGGER_MS, 'builder never took a break, so there is nothing to measure')
  }

  // Every kind of fact that marks somebody busy, each followed by the fact that ends it. Each one
  // has to start the clock again itself. With only `acting` here, review took the reset out of
  // `dispatch`, `fetching` and `meeting` one at a time, and each change passed the whole suite.
  const work: readonly (readonly [string, readonly Fact[]])[] = [
    ['acting', [{ kind: 'acting', who: 'builder', tool: 'Read' }, { kind: 'settled', who: 'builder' }]],
    [
      'dispatch',
      [
        { kind: 'dispatch', toolUseId: 'toolu_d', employee: 'builder', brief: 'build it' },
        { kind: 'delivered', toolUseId: 'toolu_d' },
      ],
    ],
    ['fetching', [{ kind: 'fetching', who: 'builder', skill: 'write-a-task' }, { kind: 'settled', who: 'builder' }]],
    [
      'meeting',
      [
        { kind: 'meeting', toolUseId: 'toolu_m', convener: 'manager', attendees: ['builder'] },
        { kind: 'delivered', toolUseId: 'toolu_m' },
      ],
    ],
  ]

  for (const [kind, facts] of work) {
    const c = chore(['builder'])
    assert.deepEqual(idleFor(c, earned - 2000).filter((r) => r.who === 'builder'), [], `${kind}: the break came early`)
    // Work, start to finish, with no `ambient` call in between: the facts, and then the routine
    // that depicts them running to its end, as the floor's runner reports it.
    for (const fact of facts) c.handle(fact)
    for (let i = 0; i < 10 && c.routineFor('builder') !== null; i += 1) c.finished('builder')
    assert.equal(
      c.routineFor('builder'),
      null,
      `${kind}: builder is still doing something, so ambient would reset the clock anyway and this checks nothing`,
    )
    assert.equal(
      c.isBusy('builder'),
      false,
      `${kind}: builder is still busy, so ambient would reset the clock anyway and this checks nothing`,
    )
    assert.deepEqual(
      idleFor(c, 5_000).filter((r) => r.who === 'builder'),
      [],
      `${kind}: builder went on a break straight after working, on idle time from before the work`,
    )
  }
})

test('a failed VERIFY is not a coffee break', () => {
  // Someone with broken work outstanding stays at their desk. Showing them on the sofa would be
  // the floor being reassuring rather than truthful.
  const c = chore()
  const drifted = idleFor(c, 90_000, { pick: () => 0, grounded: new Set(['reviewer']) })
  assert.equal(drifted.filter((r) => r.who === 'reviewer').length, 0)
  assert.ok(drifted.length > 0, 'and everybody else still drifts')
})

test('a break is ambient, so real work interrupts it mid-stride', () => {
  const c = chore()
  idleFor(c, 90_000)
  assert.equal(c.routineFor('reviewer')?.name, 'break')
  c.handle({ kind: 'dispatch', toolUseId: 'toolu_x', employee: 'reviewer', brief: 'go' })
  assert.equal(c.routineFor('reviewer')?.name, 'briefing')
})

test('a break ends at a desk, not wherever they stopped', () => {
  const c = chore()
  const first = idleFor(c, 90_000)[0]
  assert.ok(first)
  const walks = first.steps.filter((s) => s.kind === 'walk').map((s) => s.to)
  assert.deepEqual(walks[0], { at: 'lounge', spot: 'sofa' })
  assert.deepEqual(walks[walks.length - 1], { at: 'desk', who: first.who })
})

test('where they go is chosen, not fixed', () => {
  const c = chore()
  const cooler = idleFor(c, 90_000, { pick: () => 1 })[0]
  assert.deepEqual(
    cooler?.steps.find((s) => s.kind === 'walk')?.to,
    { at: 'lounge', spot: 'cooler' },
  )
})

test('THE BUG KHALID SAW: the office does not empty in lockstep', () => {
  // "The agents are taking too many breaks. The agents are taking breaks together."
  //
  // Both halves were one mechanism: every idle character accumulated idleness at the same rate
  // from the same moment, so they all crossed the same threshold on the same frame. Six people
  // standing up at once does not read as a lull, it reads as a fire drill.
  const c = chore()
  const firstFrame = new Map<string, number>()
  for (let t = 0; t < 120_000; t += 1000) {
    for (const r of c.ambient(1000, { pick: () => 0 }).routines) {
      if (!firstFrame.has(r.who)) firstFrame.set(r.who, t)
    }
  }
  assert.ok(firstFrame.size >= 3, 'not enough people drifted to tell')
  assert.ok(
    new Set(firstFrame.values()).size > 1,
    `everybody left at once: ${[...firstFrame.values()].join(', ')}`,
  )
})

test('…and the same agent always waits the same amount', () => {
  // Staggered, not random. An office where the same person is unpredictably first would be
  // noise; this is a stable trait of that agent, like their hair.
  const when = () => {
    const c = chore()
    for (let t = 0; t < 120_000; t += 1000) {
      const r = c.ambient(1000, { pick: () => 0 }).routines[0]
      if (r) return `${r.who}@${t}`
    }
    return 'never'
  }
  assert.equal(when(), when())
})

test('the other half of "too many": a cooldown between breaks', () => {
  // Without it, somebody returning to a still-idle office restarts the clock at once and is
  // back at the coffee machine within the minute — which reads as pacing, not as a lull.
  const c = chore()
  let breaks = 0
  for (let t = 0; t < 300_000; t += 1000) breaks += c.ambient(1000, { pick: () => 0 }).routines.length
  const perPerson = breaks / 7
  assert.ok(perPerson <= 3, `${perPerson.toFixed(1)} breaks each in five minutes is pacing`)
})

// ──────────────────────── background dispatches, and the ending that had not happened ──

/**
 * The sequence below is not invented. It is what the real CLI emits, captured from a live
 * dispatch, in this order:
 *
 *   TOOL_USE     Agent            toolu_014b…
 *   TASK_STARTED                  toolu_014b…   subagent_type: tester
 *   TOOL_RESULT  "Async agent launched successfully"   toolu_014b…
 *   TASK_UPDATED                  status: completed
 *   TASK_NOTIFICATION             toolu_014b…   summary: "2 + 2 = 4."
 *
 * `run_in_background` defaults to **true**. So the `tool_result` is a launch receipt that
 * arrives within milliseconds, and the real ending comes minutes later as `task_notification`.
 *
 * The floor used to fire `delivered` on that receipt: the employee walked to their desk and
 * immediately walked back to report, while the agent was still working, and then sat idle for
 * however long it actually took. An ending the floor invented — which is the one thing it may
 * never do, and which looks from the outside exactly like an office where nobody does anything.
 */
test('a background dispatch does not end on its launch receipt', () => {
  const c = new Choreographer({ manager: 'Manager', roster: ['Manager', 'tester'] })
  const id = 'toolu_014bd2hT7jm18k6zPo3W7wWd'

  c.handle({ kind: 'dispatch', toolUseId: id, employee: 'tester', brief: 'State what 2+2 is' })
  c.handle({ kind: 'running', toolUseId: id })

  // The receipt. Nothing may happen here.
  const onReceipt = c.handle({ kind: 'delivered', toolUseId: id })
  assert.deepEqual(onReceipt.routines, [], 'the launch receipt ended the task')

  // The real completion, carrying the same tool_use_id.
  const onFinish = c.handle({ kind: 'delivered', toolUseId: id })
  assert.ok(onFinish.routines.length > 0, 'the real completion did not walk them back')
  assert.equal(onFinish.routines[0]?.who, 'tester')
})

test('a foreground dispatch still ends on its own result', () => {
  // `run_in_background: false` produces no task_started, so there is no receipt to ignore and
  // the tool_result *is* the answer. The guard must not swallow it.
  const c = new Choreographer({ manager: 'Manager', roster: ['Manager', 'tester'] })
  c.handle({ kind: 'dispatch', toolUseId: 't-1', employee: 'tester', brief: null })

  const staged = c.handle({ kind: 'delivered', toolUseId: 't-1' })
  assert.ok(staged.routines.length > 0, 'a synchronous dispatch was treated as a background one')
})

test('the lifecycle events carry the tool_use_id the floor keys on', () => {
  // Both task_started and task_notification carry tool_use_id — measured — which is the same
  // key `dispatched` already uses. Without it there would be no way back from a completion to
  // the person who did the work.
  assert.deepEqual(factsFromEvent({ kind: 'task-started', toolUseId: 'x' }, 'Manager'), [
    { kind: 'running', toolUseId: 'x' },
  ])
  assert.deepEqual(factsFromEvent({ kind: 'task-finished', toolUseId: 'x' }, 'Manager'), [
    { kind: 'delivered', toolUseId: 'x' },
  ])
})

/**
 * ## A gap is not idleness
 *
 * `ambient` accumulates from the `dtMs` it is handed, and nothing bounded it. Hand it an hour —
 * a closed laptop, a suspended process, a timer that fired late — and every idle person crosses
 * their threshold in the same call, so the whole office stands up at once. That is precisely
 * what `BREAK_STAGGER_MS` exists to prevent, defeated by one large number.
 *
 * `floor.test.ts` already holds the walker against the same hazard — *"a frame spike is absorbed,
 * not stuttered through"*, *"a huge frame cannot cut a corner through a wall"*. `ambient` had no
 * equivalent. Raised in review by `office-space-6c` before any of this was written, and it was
 * right that it needed no app to check: it needs one large number.
 *
 * The resolution is about honesty rather than about clamping. If the machine was asleep, nobody
 * was sitting at a desk doing nothing — there was no office. Counting that as idle time would be
 * inventing idleness that never happened, and then acting on it by walking somebody to the
 * coffee machine to depict it. So a gap past a whole threshold **resets** the clocks: the office
 * starts being idle again from now, and earns a break in the ordinary way.
 */

test('an hour-long gap does not empty the office in one step', () => {
  const c = chore()
  idleFor(c, 20_000)

  // One call carrying an hour, the shape a timer firing after a system sleep produces.
  const after = c.ambient(3_600_000, { pick: () => 0 }).routines
  assert.deepEqual(
    after.map((r) => r.who),
    [],
    'an hour handed over in one call sent people on breaks. Every idle person crosses their ' +
      'threshold in the same step, which is the lockstep BREAK_STAGGER_MS exists to prevent.',
  )
})

test('the idle already banked before the gap is discarded, not carried across', () => {
  // The discriminating half, and the first version of this test missed it entirely: starting
  // from a fresh office meant the counters were already zero, so removing the reset changed
  // nothing and the mutation went uncaught. The gap has to interrupt idleness that was
  // genuinely accumulating.
  const c = chore()
  const banked = idleFor(c, 40_000)
  assert.deepEqual(banked, [], 'forty seconds is under the threshold; nobody should have moved yet')

  c.ambient(3_600_000, { pick: () => 0 })

  assert.deepEqual(
    idleFor(c, 20_000),
    [],
    'the forty seconds banked before the machine went away were added to the twenty after it ' +
      'came back, and somebody took a break for sitting still through a gap in time',
  )
})

test('and the office is idle again from then, not owed a break', () => {
  // Resetting must not mean "never again" — the counters start from now and a break is earned
  // in the ordinary way.
  const c = chore()
  c.ambient(3_600_000, { pick: () => 0 })

  assert.deepEqual(idleFor(c, 20_000), [], 'a break was owed immediately after the gap')
  assert.ok(idleFor(c, 90_000).length > 0, 'nobody ever took a break again after a long gap')
})

test('an ordinary long frame is still counted, because it really was idle', () => {
  // The bound has to sit above a legitimate parked stretch. The floor parks when nothing is
  // happening and hands back the parked duration, which is the whole mechanism that makes a
  // break possible at all — clamping that away would fix the stampede by removing the feature.
  const c = chore()
  const drifted = c.ambient(BREAK_AFTER_MS + BREAK_STAGGER_MS, { pick: () => 0 }).routines
  assert.ok(
    drifted.length > 0,
    'a single call carrying one full threshold produced no break, so a parked floor handing back ' +
      'its own idle time can never earn one',
  )
})

/**
 * ## Sleeping exactly as long as it takes, instead of checking
 *
 * The coffee break has never fired. `floor-view.ts` calls `ambient` every frame under a comment
 * reading *"the office drifts when there is nothing to do"*, and `FrameGate` parks the loop the
 * moment a frame changes nothing — so the loop that would earn a break is switched off by the
 * office becoming idle. Measured in the running app: eighty-five seconds still, not one pixel;
 * and separately, **zero animation frames requested in twelve seconds**.
 *
 * Two correct designs. The feature lives in the join.
 *
 * The way out is not to poll. The charter's first budget is *zero draw calls while nothing
 * changes*, and it is the reason a campus of N idle offices costs nothing. `msUntilNextBreak`
 * makes the parked floor able to sleep for exactly the right interval instead: every threshold
 * is a pure function of the name and the clock, so the answer exists the moment the loop stops.
 */

test('an office that has just gone quiet waits the better part of a minute', () => {
  const c = chore()
  const wait = c.msUntilNextBreak()
  assert.ok(wait !== null, 'nobody is eligible in a fresh office, so no timer would ever be armed')
  assert.ok(
    wait >= BREAK_AFTER_MS && wait <= BREAK_AFTER_MS + BREAK_STAGGER_MS,
    `the first break is ${wait}ms away, outside the window the thresholds allow`,
  )
})

test('the wait shrinks as the office sits there', () => {
  const c = chore()
  const before = c.msUntilNextBreak()!
  idleFor(c, 20_000)
  const after = c.msUntilNextBreak()!

  assert.ok(after < before, 'twenty seconds of idleness did not bring the next break any closer')
  assert.ok(
    Math.abs(before - after - 20_000) < 1_500,
    `the wait moved by ${before - after}ms over twenty seconds of idle, which is not the same clock`,
  )
})

test('an office where nobody is eligible answers null, not zero', () => {
  // Zero would read as "now", arming a timer that fires immediately, stages nothing, and arms
  // again — a poll with extra steps, which is the thing this method exists to avoid.
  const c = chore()
  // The whole roster this fixture builds, read from it rather than written out again — a
  // hand-listed set that drifts from STAFF would leave somebody eligible and pass for the
  // wrong reason.
  const everyone = new Set(['manager', ...STAFF])
  assert.equal(
    c.msUntilNextBreak({ grounded: everyone }),
    null,
    'an office with nobody eligible reported a due time rather than nothing to wait for',
  )
})

test('somebody who has just had a break is not reported as due again', () => {
  // The cooldown is why a person does not take two breaks in a row, and a timer that ignored it
  // would wake the floor for somebody who is going to be skipped.
  const c = chore()
  const taken = idleFor(c, 120_000)
  assert.ok(taken.length > 0, 'nobody took a break, so there is no cooldown to respect')

  const wait = c.msUntilNextBreak()
  assert.ok(wait === null || wait > 0, 'somebody is due immediately after taking a break')
})

/**
 * ## A routine that restaged itself every frame
 *
 * `finished(manager)` brings them to the window when somebody is typing. All three steps of
 * `attendRoutine` complete instantly once they are *already* at the window — the walk has
 * nowhere to go, and `face` and `pose` take effect as they begin — so it finished, restaged, and
 * finished again, every frame, for as long as anybody was composing.
 *
 * It cost nothing visible for as long as the frame gate covered for it: nothing moved, so the
 * gate parked and the loop stopped asking. Teaching the loop that a routine in flight is a
 * change — which it had to learn for a coffee break to survive its own eight-second pause —
 * turned the silent spin into sixty frames a second with the office standing still. Measured in
 * the running app: 1807 frames in thirty seconds, every one of them the manager.
 *
 * Two bugs holding each other up. Neither was visible while the other was there.
 */

test('the manager comes to the window once, not once a frame', () => {
  const c = chore()

  // `onComposing` is what walks them over. `finished` exists for the other case, below.
  const walked = c.handle({ kind: 'composing', composing: true }).routines
  assert.equal(walked[0]?.name, 'attending', 'typing did not bring the manager to the window')

  // Finishing that must not start it again. Every step completes instantly once they are
  // already at the window, so a restage here runs again on the next frame and never stops.
  assert.deepEqual(
    c.finished('manager').routines.map((r) => r.name),
    [],
    'finishing the attend routine staged another one, which is a routine that restarts itself ' +
      'every frame for as long as somebody is composing',
  )
})

test('being busy while you start typing still brings them over when the work ends', () => {
  // Traced rather than assumed, twice: this path runs through `onSettled`, not `finished`. The
  // first two versions of this test asserted it through `finished` and failed for a reason that
  // had nothing to do with the guard being added here.
  const c = chore()
  c.handle({ kind: 'acting', who: 'manager', tool: 'Read' })

  assert.deepEqual(
    c.handle({ kind: 'composing', composing: true }).routines.map((r) => r.name),
    [],
    'a manager mid-task dropped it to come and watch somebody type',
  )

  assert.equal(
    c.handle({ kind: 'settled', who: 'manager' }).routines[0]?.name,
    'attending',
    'the work ended while somebody was typing and the manager stayed at their desk',
  )
})

test('finishing something that is not attending still brings them over', () => {
  // The branch in `finished` that the guard has to leave alone: a manager who drifts off to the
  // coffee machine and comes back should notice you are typing. A guard that simply stopped
  // staging would pass the restage test above and quietly delete this.
  const c = chore()
  c.handle({ kind: 'conversing', conversing: true })

  // Whatever they were doing was not attending.
  const before = (c as unknown as { running: Map<string, { name: string }> }).running
  before.set('manager', { name: 'break' } as never)

  assert.equal(
    c.finished('manager').routines[0]?.name,
    'attending',
    'the manager finished a break during a live conversation and did not come to the window',
  )
})

test('and nobody comes to the window when nobody is typing', () => {
  const c = chore()
  assert.deepEqual(c.finished('manager').routines, [], 'the manager attended a composer nobody is using')
})
