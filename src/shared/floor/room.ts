/**
 * What the room can honestly say about a project.
 *
 * PLAN.md's V2 line asks for props that *report* rather than decorate: "monitor from
 * `TASKS.md`, whiteboard from `VISION.md`, plant health from `last_updated`". Until now three
 * of them took constants, and `floor-view.ts` said so in place — the plant was drawn at full
 * health because "nothing in this workspace measures anything a plant could honestly stand
 * for", the notice board hung empty because there was "no such count yet".
 *
 * Those comments were honest about the code and wrong about the workspace. `ProjectInfo`
 * already carries which of the convention's three files are present and when the project was
 * last worked in; `TaskReport` already carries the checks, the rows it could not parse, and why
 * there is nothing to report. The readings were available and nothing asked for them.
 *
 * ## Why every reading is nullable
 *
 * A prop that draws a value it did not measure is the failure standing order 3 refuses, and it
 * is worse than a prop that draws nothing: `health: 1` is not a neutral default, it is the
 * office asserting that a project it never looked at is thriving. `notes: 0` is the same
 * sentence about work — an unread `TASKS.md` and a task list with nothing left in it are the
 * same picture today, and standing order 4 exists because they are not the same fact.
 *
 * So `null` is a first-class reading here and means *nothing measured this*. It is the caller's
 * job to draw that as its own state rather than collapsing it into a value on the scale.
 *
 * Pure, and `now` is a parameter rather than a call to the clock, so the decay below is
 * testable without waiting a fortnight.
 */

/** A measurement, or `null` where there was nothing to measure. */
export type Reading = number | null

/** The three files every project under `projects/` carries. See CLAUDE.md. */
export const CONVENTION = ['PLAN.md', 'PROGRESS.md', 'TASKS.md'] as const

/**
 * How long a project stays green.
 *
 * A day of grace, then a fortnight's slide to nothing. Both numbers are a judgement rather than
 * a measurement and are named here so they can be argued with — the shape that matters is that
 * a project worked on this morning and one abandoned in the spring do not look alike.
 */
export const FRESH_MS = 24 * 60 * 60 * 1000
export const WILT_MS = 14 * 24 * 60 * 60 * 1000

/** The task list as the harness reports it, reduced to what the room needs. */
export interface TaskSummary {
  /** Tasks that are not done. */
  readonly outstanding: number
  /** Rows in the file that could not be read as tasks. Reported by the harness, never dropped. */
  readonly unreadable: number
  /** Why there is nothing to report, when there is nothing to report. */
  readonly problem: string | null
}

/** Everything the room reads from. All of it already crosses IPC; none of it is new. */
export interface RoomSources {
  /** Which of {@link CONVENTION} are absent. From `ProjectInfo.missing`. */
  readonly missing: readonly string[]
  /** When the project was last talked to, ISO, or `null` if it never has been. */
  readonly lastActiveAt: string | null
  /** The task list, or `null` when it could not be read at all. */
  readonly tasks: TaskSummary | null
}

/** What each prop should draw. `null` anywhere means the prop must say it does not know. */
export interface RoomReading {
  /** Notes pinned to the notice board: the work still outstanding. */
  readonly notes: Reading
  /** Lines on the whiteboard: how much of the project convention is actually written down. */
  readonly board: Reading
  /** Plant health, 1 thriving to 0 dead. */
  readonly health: Reading
}

/** Nothing is known, because there is no project to know it about. */
export const UNREAD: RoomReading = { notes: null, board: null, health: null }

/**
 * Read the room.
 *
 * @param sources what the office knows, or `null` when no project is open.
 * @param now milliseconds since the epoch, passed in rather than read.
 */
export function readRoom(sources: RoomSources | null, now: number): RoomReading {
  if (!sources) return UNREAD
  return {
    notes: notesOn(sources),
    board: linesOn(sources),
    health: healthOf(sources.lastActiveAt, now),
  }
}

/**
 * How many notes are pinned up.
 *
 * Three ways this is *unknown* rather than zero, and they are the point of the function:
 * `TASKS.md` is not there, the harness could not read it, or it reported a problem instead of a
 * list. In every one of those the office has not looked, and an empty board would say it had.
 *
 * A row the harness could not parse counts as outstanding. That is deliberate and it is
 * standing order 4 at the level of a single line: a row nobody can read is not a row that is
 * finished. Silently dropping it would shrink the count on the board every time the file got
 * harder to read, which is the wrong direction for a number to move.
 */
function notesOn({ missing, tasks }: RoomSources): Reading {
  if (missing.includes('TASKS.md')) return null
  if (!tasks || tasks.problem !== null) return null
  return tasks.outstanding + tasks.unreadable
}

/**
 * How much is written up.
 *
 * The count of the convention's files that are actually present, which is a real answer to "how
 * much of this project is written down" and lands naturally on a board that three lines fill.
 * A project with none of them draws a blank board, and that is not a failure — it is what a
 * project nobody has planned yet looks like, and PLAN.md's D12 says such a project is
 * first-class.
 *
 * Never `null` when a project is open: `missing` is a list the office computed by looking, so
 * "which files are here" is the one thing it is never guessing about.
 */
function linesOn({ missing }: RoomSources): Reading {
  const absent = new Set(missing)
  return CONVENTION.filter((file) => !absent.has(file)).length
}

/**
 * Plant health from when the project was last worked in.
 *
 * `null` when it never has been. A fresh project genuinely has no recency to read, and both
 * available alternatives are a lie: full health says somebody has been tending it, and a wilted
 * plant says they stopped. The plant is told to say it does not know instead.
 *
 * An unparseable date is the same answer, for the same reason — `Date.parse` returning `NaN` is
 * the office failing to read something, not the project being neglected.
 */
function healthOf(lastActiveAt: string | null, now: number): Reading {
  if (lastActiveAt === null) return null
  const at = Date.parse(lastActiveAt)
  if (Number.isNaN(at)) return null
  const age = now - at
  if (age <= FRESH_MS) return 1
  if (age >= FRESH_MS + WILT_MS) return 0
  return 1 - (age - FRESH_MS) / WILT_MS
}
