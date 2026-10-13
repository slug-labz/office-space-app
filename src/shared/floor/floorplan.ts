/**
 * The office, generated from the roster.
 *
 * This file exists to keep one promise: **add an agent to `.claude/agents/` and a desk appears
 * for them.** Nobody edits a map. There is no list of characters in the frontend to keep in
 * sync with the list in the workspace, because there is only one list — the workspace's — and
 * the floor is a function of it.
 *
 * That constraint drives the layout maths. Desks are placed by roster *index* into a
 * fixed-width grid, so the floor grows downward as the company hires and every existing desk
 * stays exactly where it was. An agent added today does not shuffle the office you learned
 * yesterday. `test/choreography.test.ts` asserts that property directly, because it is the
 * kind of thing that silently stops being true.
 *
 * ## The room, in bands
 *
 * The camera looks down the room's `+y` axis, so depth reads as horizontal bands across the
 * screen — and the office is laid out as bands, because a section that straddles two of them
 * is a section nobody can point at.
 *
 * ```
 *   y=0     ┄┄ back wall ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄   the whiteboard hangs here
 *   y=1..5    manager's office   │   meeting table
 *   y=6       racks   shelf   cooler sofa                 the fixtures, against a wall
 *   y=7     ┄┄ the aisle, full width, rug at its right end ┄┄
 *   y=8..     desks, four across, growing toward you
 * ```
 *
 * Every fixture is pinned to a fixed row and only the desks move. The company grows into the
 * front of the room; the room it grew out of stays exactly where it was. That is what lets the
 * window, the manager, the shelf and the meeting table all be things you learn the position of
 * once — and it is the same guarantee as desk stability, applied to the furniture.
 *
 * Six places on this floor have meaning beyond being somewhere to stand:
 *
 *   **The desk.** Where an employee works. One per agent, in roster order.
 *   **The briefing spot.** In front of the manager's desk, inside the office. Where an
 *   employee stands when the manager hands them a task.
 *   **The window.** The right-hand edge of the floor — which is where the chat panel is, and
 *   therefore where *you* are. A character at the window is facing you.
 *   **The shelf.** Where the skills are. An agent that invokes one walks over, takes it down,
 *   and carries it back to their desk — which is the vision's own image of what using a skill
 *   looks like, and the only way the floor can depict a capability rather than a task.
 *   **The meeting table.** Six seats around one table: somewhere a group can be shown as a
 *   group, which no arrangement of desks can do.
 *   **The lounge, and the server racks.** The two places that are visibly not work. A
 *   character on the sofa is not at a desk, and that difference is the whole point of drawing
 *   them; the racks are a fixed address for something said about the build rather than about
 *   a person.
 */

import type { Direction, Tile } from './geometry.js'
import { WalkGrid } from './grid.js'
import type { SeatMap } from './seats.js'

/** Tile size in pixels. 16px is the pitch the character painter draws to. */
export const TILE_SIZE = 16

/** A block of tiles, corners inclusive. Walls, furniture and floor coverings are all this. */
export interface Rect {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/**
 * Somewhere to stand, and which way you look once you are there.
 *
 * The older fixtures spell this as two fields — `shelfSpot` and `shelfFacing` — which is fine
 * when there is exactly one of each. The sections added since have a *list* of places to
 * stand, and two parallel arrays are the shape that silently goes out of step.
 */
export interface Spot {
  readonly tile: Tile
  readonly facing: Direction
}

/**
 * The floor's width, in tiles. A constant, so that hiring can only ever grow the room downward.
 *
 * The office renders at an integer scale — pixel art at 1.7x has pixels of two different sizes
 * and looks broken — so the room's proportions decide how much of the window it can fill, and
 * a floor a few tiles too wide does not get slightly smaller, it drops a whole step and halves.
 *
 * Under the isometric camera this file used to draw for, the projected width was `(w + h) * 16`
 * and **depth pushed on width**: a deeper office was a wider one, so the room could be wide or
 * deep and not both. That is gone. Width is now `w * TILE_W` and nothing else, which is why the
 * layout above spends the freed budget entirely on depth.
 *
 * The arithmetic, for whoever changes this next. The stage is about 840 x 712 CSS px — a
 * 1280 x 820 window less the 27rem chat pane — and 2x is the floor of what is readable, 1x
 * being the complaint this layout was drawn to answer. So the projected floor may be 420px
 * across, which is 13 tiles at `TILE_W = 32`. The renderer will overflow by 8% before it steps
 * down, and that buys a fourteenth tile and no more. Fifteen is 1x.
 */
const FLOOR_WIDTH = 14

/**
 * Shortest the floor is ever drawn — and, for any company whose desks fit in two rows, the
 * only height it is ever drawn at.
 *
 * The same budget in the other axis: 356px of stage depth, less one `z` unit of headroom so
 * the back wall is not painted above the canvas, leaves 328px — sixteen rows at `TILE_D = 20`.
 * The 8% the renderer tolerates buys a seventeenth. Eighteen is 1x.
 *
 * Sixteen is therefore the room rather than a floor under it: the bands above the desks account
 * for eight rows, two desk rows fill five more, and what is left over is open floor at the
 * front. Nine to twelve staff spend the seventeenth row and still draw at 2x. Past that the
 * office is drawn smaller, which is honest — a bigger company seen from the same distance is a
 * smaller picture — but it is a cliff rather than a slope, so it is worth knowing where the
 * edge is.
 */
const MIN_FLOOR_HEIGHT = 14

/**
 * The last roster size that still draws at 2x. The edge the comment above says is worth knowing.
 *
 * Named, and exported, because the number is wanted in two places that must not drift: the test
 * that holds the 2x bound from both sides, and the hire form — the office says so at the moment
 * somebody confirms the hire that crosses it, which is the only moment the fact is actionable.
 * Written as a literal in either place it would be a fact about the layout kept somewhere the
 * layout is not.
 */
export const STAFF_AT_FULL_SCALE = 12

/**
 * The desk field, and the one rule that governs it: **a floor you look into, not along.**
 *
 * Reported four times now: the cubicles are still in a line, they are not arranged properly,
 * they all face the same way, and the arrangement looks random. The last two
 * are the ones this layout is a response to, and they are different complaints.
 *
 *   *All facing the same way* was true and structural: every workstation faced the camera,
 *   because a desk's `facing` decided which side its occupant sat on and only one side had
 *   been used. Desks now come in **benches** — two rows back to back, one row facing the
 *   camera and one facing away — which is what an open-plan office actually looks like and
 *   the only arrangement in this camera where two people are visibly working *at each other*.
 *
 *   *Random* was also true, and it was the stagger: an odd row shifted sideways by half a pod
 *   to break the lattice, which broke it by making a partial row look like a mistake. Rows are
 *   square again. What breaks the lattice now is the bench, which is a real structure rather
 *   than an offset.
 *
 * ```
 *   x=      1   2   3   4   5   6   7   8   9  10  11  12
 *   y=8         ▲   ▲       │   ▲   ▲       │   ▲   ▲        seats, facing the camera
 *   y=9         ▬   ▬       │   ▬   ▬       │   ▬   ▬        their desks
 *   y=10        ▬   ▬       │   ▬   ▬       │   ▬   ▬        the other side of the bench
 *   y=11        ▼   ▼       │   ▼   ▼       │   ▼   ▼        seats, facing away
 *   y=12    (clear)                                          before the next bench
 * ```
 *
 * Twelve people fit in one bench block, four rows deep, in a room fourteen rows tall — which
 * is *less* depth than the eight the old two-row grid needed for the same headcount, and it is
 * why the room can afford three clear columns and a clear row at the front. Spacious is not a
 * decoration here; it is what the depth saved bought.
 */

/** Where each bench of desks starts across the room. Three benches, two desks wide each. */
const BENCH_X: readonly number[] = [2, 6, 10]
/** Desks per bench, side by side. */
const BENCH_WIDTH = 2
/** Sides per bench: one facing the camera, one facing away. */
const BENCH_SIDES = 2
/** Seats in one full bench block. */
const BLOCK_SEATS = BENCH_X.length * BENCH_WIDTH * BENCH_SIDES

/**
 * Rows one bench block occupies, including the clear row in front of it.
 *
 * Four rows of furniture and one of air. The clear row is not spare space — it is the aisle
 * between one block and the next, and without it the far side of block two sits directly
 * behind the near side of block one with no way through.
 */
const BLOCK_DEPTH = 5

/** The left-hand edge of the desk field. Kept for the renderer's partition arithmetic. */
export const DESK_ORIGIN_X = BENCH_X[0] ?? 2
/** How far apart two benches start. Used by the label width — a name may be this wide. */
export const POD_GAP_TILES = (BENCH_X[1] ?? 6) - (BENCH_X[0] ?? 2)
/** Desks inside one bench sit next to each other. */
export const POD = BENCH_WIDTH

/** The first bench row, one clear row below the aisle that serves the fixtures. */
const DESK_ORIGIN_Y = 8

/**
 * The manager's office: a walled room, back-left, with a door in the wall facing the camera.
 *
 * Narrower than it was by a tile, and that tile went to the meeting room. A manager's office
 * needs a desk, a visitor's side and a way round; anything past that was empty carpet in the
 * densest band of the floor.
 */
const OFFICE: Rect = { x0: 1, y0: 1, x1: 4, y1: 5 }
/**
 * The one gap in its wall, in the south wall rather than the east one.
 *
 * A door in the east wall would be drawn on a receding surface, and "walked into the manager's
 * office" has to be readable at a glance or it is not an event. The south wall faces the
 * camera, so the doorway is a hole you can see through.
 */
const OFFICE_DOOR_X = 3

/**
 * The meeting room — walls, a door, and a table with room to walk round it.
 *
 * It used to be a table standing in the open beside the manager's office, which is why that
 * whole band read as clutter: two rooms' worth of furniture and one room's worth of walls.
 * A meeting is the one event on this floor that is about a *group*, and a group needs somewhere
 * that is visibly not the floor.
 *
 * Two tiles of table with two chairs on each long side and one at each end. Six seats, which is
 * the number the choreographer already assumes, and every one of them is reachable without
 * moving another — the end seats double as the way past the table.
 *
 * It **shares the manager's office's east wall** rather than standing its own beside it. Two
 * walls in adjacent columns is two tiles of masonry between two rooms, which is both wrong as
 * building and expensive as floor: the tile it gives back is a tile of walking room inside the
 * meeting room, which is where the room needed it.
 */
const MEETING_ROOM: Rect = { x0: OFFICE.x1, y0: 1, x1: 10, y1: 5 }
const MEETING_DOOR_X = 7
const MEETING_TABLE: Rect = { x0: 7, y0: 3, x1: 8, y1: 3 }

/** The whiteboard, on the meeting room's own back wall. It faces the camera; a side wall would not. */
const WHITEBOARD: Rect = { x0: 6, y0: 1, x1: 9, y1: 1 }

/**
 * The row every fixture stands on, and the row you stand on to use one.
 *
 * One row of furniture with one clear row in front of it, repeated across the whole width, is
 * what lets four sections share eight metres of depth. The aisle is unbroken from wall to
 * wall, which is what stops any of them becoming a pocket.
 */
const FIXTURE_Y = 6
const AISLE_Y = FIXTURE_Y + 1

/** The server racks, in the corner the manager's office makes with the west wall. */
const RACKS: Rect = { x0: 1, y0: FIXTURE_Y, x1: 2, y1: FIXTURE_Y }

/**
 * The shelf, under the manager's office wall, in the middle of the room.
 *
 * On the aisle rather than off in a corner, because the walk is the point — but a step *off*
 * the aisle, so taking something down is a turn and a pause rather than something that happens
 * in passing. Three tiles wide because a shelf one tile wide is a box.
 */
const SHELF: Rect = { x0: 4, y0: FIXTURE_Y, x1: 6, y1: FIXTURE_Y }

/** The printer, between the shelf and the meeting room door. You stand on the aisle to use it. */
const PRINTER: Tile = { x: 8, y: FIXTURE_Y }

/** The break end of the fixture row: somewhere to sit that is visibly not a desk. */
const SOFA: Rect = { x0: 9, y0: FIXTURE_Y, x1: 10, y1: FIXTURE_Y }
const WATER_COOLER: Tile = { x: 12, y: FIXTURE_Y }
/** Walkable. A rug is floor, and the only thing on this floor that marks a place without one. */
const RUG: Rect = { x0: 9, y0: AISLE_Y, x1: 10, y1: AISLE_Y }

/**
 * The pantry — the asked-for food place and eating area, and now an actual corner of the room.
 *
 * A two-tile-wide column behind the break end of the fixture row, open to it rather than walled
 * off: a machine against the back wall, a table stood on its end so the far column stays a
 * walkway, and one way in past the sofa. It reads as the corner of an office where people eat,
 * which is what was asked for and what a coffee machine wedged beside a meeting table was never
 * going to be. The table runs along `y` for the same reason the meeting table is two tiles and
 * not three: a table that spans its whole room is a wall.
 */
const COFFEE: Tile = { x: 11, y: 1 }
const PANTRY_TABLE: Rect = { x0: 11, y0: 3, x1: 11, y1: 4 }

/**
 * The notice board, on the meeting room's south wall beside the door.
 *
 * A wall that faces the camera, like the whiteboard and the picture frames — the three props
 * that hang rather than stand. On the busiest wall in the room, where a real one goes.
 */
const NOTICE_BOARD: Rect = { x0: 8, y0: MEETING_ROOM.y1, x1: 9, y1: MEETING_ROOM.y1 }

/** Storage. Two boxes were asked for; `drawCrate` stacks them, in the pantry's dead corner. */
const CRATES: readonly Tile[] = [{ x: 12, y: 1 }] as const

/**
 * A pot plant, in the back corner of the meeting room.
 *
 * Exactly one, and the count is a constraint rather than a shrug. Every section on this floor
 * is sized to what it holds, so almost every free tile in the fixed bands is somebody's route:
 * the meeting room has two back corners and the seats behind the table reach the door through
 * one of them, so the plant may stand in the other and nowhere else. The manager's office and
 * the pantry have no slack at all — an obstacle in either strands the far half of the room.
 *
 * `test/choreography.test.ts` walks from every seat to every named spot rather than trusting
 * any of that, because sealing a section off is the kind of thing a prop does silently.
 */
const PLANTS: readonly Tile[] = [{ x: MEETING_ROOM.x0 + 1, y: 2 }] as const


/**
 * Wall tiles a framed picture can hang on.
 *
 * All three face the camera. A frame on a receding wall is four pixels of edge-on nothing, so
 * the choice of tile is the whole of whether the prop is worth drawing: two on the office's
 * back wall, either side of the manager, and one on the room's own back wall over the pantry.
 */
const PICTURE_FRAMES: readonly Tile[] = [
  { x: 2, y: OFFICE.y0 },
  { x: 3, y: OFFICE.y0 },
  { x: 12, y: 0 },
] as const


export function insideOffice(office: Rect, x: number, y: number): boolean {
  return x > office.x0 && x < office.x1 && y > office.y0 && y < office.y1
}

export interface Workstation {
  /** Roster name of the agent this desk belongs to. */
  readonly who: string
  /**
   * The desk furniture. Blocked — you cannot stand on a desk.
   *
   * Always the tile *below* the seat, so the character sits behind it facing the room. A
   * character is two tiles tall and a desk is one, so putting the desk behind them hides it
   * completely and the floor renders as people standing in an empty room. This way you get
   * the classic thing instead: head and shoulders above the desk, legs behind it.
   */
  readonly desk: Tile
  /** Where the character stands to work. Walkable. */
  readonly seat: Tile
  /** Which way they face while working. Toward their desk, and therefore toward you. */
  readonly facing: Direction
}

/** Where a group can be shown as a group. */
export interface MeetingArea {
  /** The table. Blocked — a meeting happens around one. */
  readonly table: Rect
  /** Seats around it: the far row left to right, then the near row. Walkable. */
  readonly seats: readonly Spot[]
  /** The wall tiles behind the table. Blocked, and already wall. */
  readonly whiteboard: Rect
}

/** The eating area: a counter with a machine on it, and a table to stand at. */
export interface Pantry {
  /** The table. Blocked — you stand at one. */
  readonly table: Rect
  readonly coffee: Tile
  /** Somewhere to stand: at the machine, and around the table. */
  readonly spots: readonly Spot[]
}

/** The part of the floor that is visibly not work. */
export interface Lounge {
  readonly sofa: Rect
  readonly waterCooler: Tile
  /** Walkable — this is the floor covering, not a thing standing on the floor. */
  readonly rug: Rect
  /** Standing room in front of the sofa and the cooler, left to right. */
  readonly spots: readonly Spot[]
}

/**
 * The rest of the office — the sections that make it a workplace rather than a desk farm.
 *
 * Grouped into one field rather than six because they share a rule: all of them are drawn from
 * fixed tiles above the desks, none of them is a destination a routine can be sent to, and the
 * only one that reports anything is the notice board. Keeping them together makes that rule
 * checkable in one place instead of remembered in six.
 */
export interface Amenities {
  /** The printer. Blocked; you stand at `printerSpot`. */
  readonly printer: Tile
  readonly printerSpot: Spot
  /** Wall tiles carrying the notice board. Already wall — nothing to block. */
  readonly noticeBoard: Rect
  /** Storage boxes. Blocked, and in corners nothing routes through. */
  readonly crates: readonly Tile[]
  /** Pot plants. Blocked, for the same reason a crate is: you walk around a plant. */
  readonly plants: readonly Tile[]
}

/** Where the infrastructure lives, and therefore where something about the build belongs. */
export interface ServerCorner {
  /** The racks. Blocked. */
  readonly racks: Rect
  /** Where somebody stands to look at them. */
  readonly spot: Spot
}

export interface Floorplan {
  readonly width: number
  readonly height: number
  readonly tileSize: number
  readonly grid: WalkGrid
  /** One per employee, in roster order. */
  readonly workstations: readonly Workstation[]
  /** The manager's own desk, inside the office. */
  readonly managerStation: Workstation
  /** The walled room, walls included. */
  readonly office: Rect
  /** The one gap in the office wall. Everyone who visits the manager walks through it. */
  readonly door: Tile
  /** Where a visiting employee stands to be briefed, facing the manager. */
  readonly briefingSpot: Tile
  readonly briefingFacing: Direction
  /** The chat-side spot. A character here is looking out at you. */
  readonly window: Tile
  readonly windowFacing: Direction
  /** The shelf itself. Blocked — you take things off a shelf, you do not stand on it. */
  readonly shelf: Rect
  /** Where somebody stands to take something down. */
  readonly shelfSpot: Tile
  readonly shelfFacing: Direction
  readonly meeting: MeetingArea
  readonly lounge: Lounge
  /** Where people eat. A place you go, not a fixture you pass. */
  readonly pantry: Pantry
  readonly servers: ServerCorner
  readonly amenities: Amenities
  /** Wall tiles that can carry a framed picture. All face the camera. */
  readonly pictureFrames: readonly Tile[]
  /**
   * Whose desk the office cat sits by, or `null` for a roster too small to spare one.
   *
   * Deterministic from the roster, so the same agent has it every session — a pet that moved
   * desks between runs would be the floor telling you something changed when nothing had.
   *
   * It is also the **one** thing on this floor allowed to move without reporting anything, and
   * that is defensible precisely because nobody would read a cat as a status. Everything else
   * that moves is a claim.
   */
  readonly petOwner: string | null
}

/**
 * Where the *n*th hire sits, and which way they look.
 *
 * A pure function of the index, which is the whole of the desk-stability promise: the same
 * roster position always resolves to the same tile, so hiring adds a desk and never moves one.
 *
 * The order fills **across the benches before it fills down them** — first the camera-facing
 * seat of every bench, then the away-facing seat of every bench, then the second desk in each.
 * A roster of three therefore spreads across the width of the room facing you, rather than
 * filling one bench and leaving two empty. That is the difference between an office with three
 * people in it and a corner with three people in it.
 */
function benchSeat(who: string, index: number): Workstation {
  const block = Math.floor(index / BLOCK_SEATS)
  const slot = index % BLOCK_SEATS

  const bench = slot % BENCH_X.length
  const rest = Math.floor(slot / BENCH_X.length)
  // 0 = the far side, facing the camera. 1 = the near side, facing away.
  const side = rest % BENCH_SIDES
  const column = Math.floor(rest / BENCH_SIDES)

  const x = (BENCH_X[bench] ?? BENCH_X[0] ?? 2) + column
  const top = DESK_ORIGIN_Y + block * BLOCK_DEPTH

  // The desk always sits on the side of the seat its occupant faces — that is what `facing`
  // means to `drawDesk`, and it is why the far row's legs are hidden by their desks and the
  // near row is seen from behind, over the tops of theirs.
  return side === 0
    ? { who, seat: { x, y: top }, desk: { x, y: top + 1 }, facing: 'down' }
    : { who, seat: { x, y: top + 3 }, desk: { x, y: top + 2 }, facing: 'up' }
}

/** Block a rectangle of tiles. Furniture is furniture; you cannot stand on it. */
function block(grid: WalkGrid, rect: Rect): void {
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) grid.setWalkable(x, y, false)
  }
}

/** A row of places to stand along `y`, all looking the same way. */
function spotsAlong(x0: number, x1: number, y: number, facing: Direction): Spot[] {
  const out: Spot[] = []
  for (let x = x0; x <= x1; x++) out.push({ tile: { x, y }, facing })
  return out
}

/**
 * Lay out an office for a roster.
 *
 * `manager` gets the private office; everyone in `employees` gets a desk on the open floor, in
 * the order given. Pass the roster straight through from workspace discovery — the order there
 * is directory order, which is stable, so desks are stable too.
 */
export function planFloor(
  manager: string,
  employees: readonly string[],
  /**
   * Where people were already sitting, if anybody was.
   *
   * Optional, and the default is the roster-index assignment this function used before seats
   * existed — so every call site that does not care is unchanged and a fresh window looks the
   * way it always did. The caller that *does* care is the one watching a roster change, and the
   * reason is in `seats.ts`: without this, firing one person moves four.
   */
  seats: SeatMap = {},
): Floorplan {
  // The floor is as deep as the highest slot in use, not as the headcount. Those differ the
  // moment somebody leaves a gap behind: six people occupying slots 0–4 and 7 need the second
  // bench, and sizing by `employees.length` would put a desk past the near wall.
  const slots = employees.map((who, index) => seats[who] ?? index)
  const highest = slots.length ? Math.max(...slots) : 0
  const blocks = Math.max(1, Math.ceil((highest + 1) / BLOCK_SEATS))
  // Only the desks decide the height; every fixture above them sits at a fixed row and never
  // moves. The wall goes immediately in front of the last bench rather than a row clear of it,
  // which matters once a company outgrows the minimum: a clear row there is one more row of
  // depth, and one more row of depth is what drops the whole office from 2x to 1x. The near
  // wall is the least informative thing drawn, so it is what gets crowded.
  const lastDeskY = DESK_ORIGIN_Y + (blocks - 1) * BLOCK_DEPTH + BLOCK_DEPTH - 2
  const height = Math.max(MIN_FLOOR_HEIGHT, lastDeskY + 2)

  const grid = WalkGrid.open(FLOOR_WIDTH, height)

  // Outer walls. An office has an outside.
  for (let x = 0; x < FLOOR_WIDTH; x++) {
    grid.setWalkable(x, 0, false)
    grid.setWalkable(x, height - 1, false)
  }
  for (let y = 0; y < height; y++) {
    grid.setWalkable(0, y, false)
    grid.setWalkable(FLOOR_WIDTH - 1, y, false)
  }

  // The manager's office walls, with a doorway. The door is the only way in, which is what
  // makes "walked into the manager's office" a legible event rather than a diagonal drift.
  for (let x = OFFICE.x0; x <= OFFICE.x1; x++) {
    grid.setWalkable(x, OFFICE.y0, false)
    if (x !== OFFICE_DOOR_X) grid.setWalkable(x, OFFICE.y1, false)
  }
  for (let y = OFFICE.y0; y <= OFFICE.y1; y++) {
    grid.setWalkable(OFFICE.x0, y, false)
    grid.setWalkable(OFFICE.x1, y, false)
  }

  // The manager sits behind their desk facing the door, the way a manager does. A visitor
  // stands on the near side. The desk between them is what makes the handoff read as a
  // handoff and not two characters standing on the same square.
  const managerDesk: Tile = { x: OFFICE_DOOR_X, y: OFFICE.y0 + 2 }
  const managerSeat: Tile = { x: OFFICE_DOOR_X, y: OFFICE.y0 + 1 }
  const briefingSpot: Tile = { x: OFFICE_DOOR_X, y: OFFICE.y0 + 3 }
  grid.setWalkable(managerDesk.x, managerDesk.y, false)


  // The meeting room, built the same way and for the same reason: a group has to be somewhere
  // that is visibly not the floor, and the only way to draw that is walls.
  for (let x = MEETING_ROOM.x0; x <= MEETING_ROOM.x1; x++) {
    grid.setWalkable(x, MEETING_ROOM.y0, false)
    if (x !== MEETING_DOOR_X) grid.setWalkable(x, MEETING_ROOM.y1, false)
  }
  for (let y = MEETING_ROOM.y0; y <= MEETING_ROOM.y1; y++) {
    grid.setWalkable(MEETING_ROOM.x0, y, false)
    grid.setWalkable(MEETING_ROOM.x1, y, false)
  }
  block(grid, MEETING_TABLE)

  // The fixture row. Everything on it is furniture against the wall behind it; the gaps between
  // the sections are the ways through, and there are exactly three — under the office door,
  // under the meeting room door, and past the sofa into the pantry. Each one is the only route
  // into the section above it. Narrowing any of them seals a section off, which is why
  // `test/choreography.test.ts` walks from every desk to every named spot rather than trusting
  // this comment.
  block(grid, RACKS)
  block(grid, SHELF)
  grid.setWalkable(PRINTER.x, PRINTER.y, false)
  block(grid, SOFA)
  grid.setWalkable(WATER_COOLER.x, WATER_COOLER.y, false)

  // The pantry, behind the sofa. Open to the room rather than walled: it is a corner, not a
  // fourth room, and three walled rooms in a fourteen-tile band is the clutter this replaced.
  block(grid, PANTRY_TABLE)
  grid.setWalkable(COFFEE.x, COFFEE.y, false)

  for (const tile of CRATES) grid.setWalkable(tile.x, tile.y, false)
  for (const tile of PLANTS) grid.setWalkable(tile.x, tile.y, false)

  const workstations: Workstation[] = employees.map((who, index) => {
    const station = benchSeat(who, slots[index] ?? index)
    grid.setWalkable(station.desk.x, station.desk.y, false)
    return station
  })

  return {
    width: FLOOR_WIDTH,
    height,
    tileSize: TILE_SIZE,
    grid,
    workstations,
    managerStation: { who: manager, desk: managerDesk, seat: managerSeat, facing: 'down' },
    office: OFFICE,
    door: { x: OFFICE_DOOR_X, y: OFFICE.y1 },
    briefingSpot,
    briefingFacing: 'up',
    // Hard against the right-hand edge, at the end of the aisle, so the walk to the window
    // crosses the whole floor and you can see it coming.
    window: { x: FLOOR_WIDTH - 2, y: AISLE_Y },
    windowFacing: 'right',
    shelf: SHELF,
    // Directly in front of it, facing the shelf — so taking something down reads as taking
    // something down rather than as standing near a wall.
    shelfSpot: { x: SHELF.x0 + 1, y: AISLE_Y },
    shelfFacing: 'up',
    meeting: {
      table: MEETING_TABLE,
      // Two on each long side and one at each end: six chairs round one table, which is the
      // number the choreographer already assumes. The end seats double as the way past the
      // table, so nobody has to be moved for somebody else to sit down.
      seats: [
        ...spotsAlong(MEETING_TABLE.x0, MEETING_TABLE.x1, MEETING_TABLE.y0 - 1, 'down'),
        ...spotsAlong(MEETING_TABLE.x0, MEETING_TABLE.x1, MEETING_TABLE.y1 + 1, 'up'),
        { tile: { x: MEETING_TABLE.x0 - 1, y: MEETING_TABLE.y0 }, facing: 'right' },
        { tile: { x: MEETING_TABLE.x1 + 1, y: MEETING_TABLE.y0 }, facing: 'left' },
      ],
      whiteboard: WHITEBOARD,
    },
    lounge: {
      sofa: SOFA,
      waterCooler: WATER_COOLER,
      rug: RUG,
      spots: spotsAlong(SOFA.x0, WATER_COOLER.x, AISLE_Y, 'up'),
    },
    pantry: {
      table: PANTRY_TABLE,
      coffee: COFFEE,
      // Under the machine, along the free side of the table, and at each end of it. Every one
      // of them is on the walkway column, which is what makes the pantry a place two people
      // can be in at once rather than a queue.
      spots: [
        { tile: { x: COFFEE.x, y: COFFEE.y + 1 }, facing: 'up' },
        { tile: { x: PANTRY_TABLE.x0, y: PANTRY_TABLE.y1 + 1 }, facing: 'up' },
        { tile: { x: PANTRY_TABLE.x1 + 1, y: PANTRY_TABLE.y0 }, facing: 'left' },
        { tile: { x: PANTRY_TABLE.x1 + 1, y: PANTRY_TABLE.y1 }, facing: 'left' },
      ],
    },
    amenities: {
      printer: PRINTER,
      // On the aisle, facing the wall the printer stands against — the same arrangement as the
      // shelf, and for the same reason: standing *at* something has to be distinguishable from
      // walking past it.
      printerSpot: { tile: { x: PRINTER.x, y: AISLE_Y }, facing: 'up' },
      noticeBoard: NOTICE_BOARD,
      crates: CRATES,
      plants: PLANTS,
    },
    petOwner: petOwnerFor(employees),
    servers: {
      racks: RACKS,
      // The right-hand rack rather than the left, so the character is a tile clear of the wall
      // and drawn against racks on both sides of them.
      spot: { tile: { x: RACKS.x1, y: AISLE_Y }, facing: 'up' },
    },
    pictureFrames: PICTURE_FRAMES,
  }
}

/**
 * Which desk the cat sits by.
 *
 * The same hash the rest of the floor uses to turn a name into a stable choice, so it is
 * decided by *who is on the roster* rather than by roster order — hiring somebody does not move
 * the cat to a different desk, which is the property that matters. Ties break on the earlier
 * index, which is arbitrary and stable, and stable is the whole requirement.
 *
 * Nobody gets one below four employees. A cat on a floor of two is half the cast.
 */
const PET_MIN_ROSTER = 4

export function petOwnerFor(employees: readonly string[]): string | null {
  if (employees.length < PET_MIN_ROSTER) return null
  let best = employees[0] ?? null
  let bestHash = Infinity
  for (const who of employees) {
    const h = hashName(who)
    if (h < bestHash) {
      bestHash = h
      best = who
    }
  }
  return best
}

/** FNV-1a. The floor's one hash — campus hues and the pet both read from it. */
function hashName(name: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** Every station on the floor, keyed by who works there. Includes the manager. */
export function stationsByName(plan: Floorplan): Map<string, Workstation> {
  const map = new Map<string, Workstation>()
  map.set(plan.managerStation.who, plan.managerStation)
  for (const station of plan.workstations) map.set(station.who, station)
  return map
}
