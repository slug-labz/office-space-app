/**
 * The floor, drawn.
 *
 * Plain Canvas 2D. A WebGL scene graph would buy batching for a scene that is a dozen sprites
 * and some furniture, and cost a dependency in an app whose pitch is "clone it and it runs" —
 * so, no. What matters for pixel art is `imageSmoothingEnabled = false` and an integer scale,
 * both of which are free here.
 *
 * Everything the floor knows about movement lives in `shared/floor`, which has no renderer in
 * it and is tested without one. This file is the part that cannot be tested that way: pixels,
 * a clock, and a mouse.
 */

import {
  DESK_ORIGIN_X,
  POD,
  POD_GAP_TILES,
  TILE_SIZE,
  planFloor,
  stationsByName,
  type Floorplan,
  type Workstation,
} from '../shared/floor/floorplan.js'
import { assignSeats, type SeatMap } from '../shared/floor/seats.js'
import {
  TILE_D,
  TILE_W,
  chooseScale,
  depthAt,
  depthOf,
  toScreenAt,
  type ViewBounds,
  viewBounds,
} from '../shared/floor/projection.js'
import { FrameGate } from '../shared/floor/frame-gate.js'
import { KEYSTROKE_MS, PET_SETTLE_MS } from '../shared/floor/idle-clock.js'
import {
  NAME_ROW,
  columnsFor,
  campusSize,
  cardAt,
  layOutCampus,
  type CampusCard,
  markFor,
  pictureOf,
  type CampusOffice,
  canvasCeiling,
  fitCampus,
} from '../shared/floor/campus.js'
import { ellipsise, labelWidthFor } from '../shared/floor/labels.js'
import {
  DESK_TOP,
  drawChair,
  drawDesk,
  drawFloorTile,
  drawMonitor,
  drawWastebasket,
  drawPictureFrame,
  drawRug,
  drawCrate,
  drawNoticeBoard,
  drawPet,
  drawPlant,
  drawPrinter,
  drawServerRack,
  drawShelfUnit,
  drawSofa,
  drawStereo,
  drawTable,
  drawWall,
  drawWaterCooler,
  drawCoffeeMachine,
  drawPartition,
  drawWhiteboard,
  mix,
  PALETTE,
  type Facing,
} from './props.js'
import { Stereo } from './music.js'
import { doingLine, checkedLine, BubbleBoard, situationKey, type Bubble } from '../shared/floor/bubbles.js'
import { Choreographer, type Fact, type Pose, type Routine, type Unstaged } from '../shared/floor/choreography.js'
import { RoutineRunner, type Stations } from '../shared/floor/routine.js'
import { Walker } from '../shared/floor/walker.js'
import type { Direction, Pixel, Tile } from '../shared/floor/geometry.js'
import {  type PaintDirection } from '../shared/character/painter.js'
import { lookKey } from '../shared/character/recipe.js'
import { toBitmaps } from './sprites.js'
import { nothingRan, type TaskOutcome } from '../shared/tasks.js'
import { UNREAD, type RoomReading } from '../shared/floor/room.js'
import type { SpriteSheet, StaffMember } from '../shared/ipc.js'

/** Walk cycle: 0 → 1 → 2 → 1. Step 0 is the standing frame. */
const WALK_CYCLE = [0, 1, 2, 1] as const
const FRAME_MS = 140

/** Space between a bubble and the character it belongs to, in css pixels. Clears the name tag. */
const GAP = 12

/**
 * What an outstanding task looks like on the person carrying it.
 *
 * Four colours for five states, and `passed` is the quiet one on purpose: the floor should
 * shout when something is wrong or unknown and merely reassure when it is fine. `done` never
 * reaches here — finished work is not what somebody is carrying.
 */
const OUTCOME_COLOUR: Readonly<Record<TaskOutcome, string | null>> = {
  failed: '#e0685f',
  refused: '#e0685f',
  'not-run': '#e8b25e',
  uncheckable: '#838ca1',
  passed: '#7fb08a',
  done: null,
}

interface Cast {
  readonly who: string
  readonly label: string
  readonly isManager: boolean
  readonly walker: Walker
  readonly runner: RoutineRunner
  readonly art: Readonly<Record<PaintDirection, ImageBitmap[]>>
  readonly spriteW: number
  readonly spriteH: number
  phase: number
  pose: Pose
}

/**
 * How tall the walls stand, in `z` units.
 *
 * Needed by `fit` as well as by the wall itself: a wall drawn at the very back of the room
 * reaches above tile (0,0), and a canvas sized to the floor alone clips it off. That failure
 * looks exactly like the wall never being drawn, which is a long afternoon.
 */
const WALL_HEIGHT = 1

/**
 * How big a miniature office is drawn, as a fraction of full size.
 *
 * The requirement is the same maps and artwork for every project, minimised — drawn smaller so
 * that more projects fit. At full size one office filled the column and
 * the campus showed one project at a time, which is the thing zooming out exists to fix.
 *
 * A **half**, and the fraction matters. Downscaling pixel art always costs something, but an
 * integer *divisor* costs the least of any of them: every 2×2 block becomes one pixel, so
 * everything keeps its shape and its alignment. A third, or 0.4, resamples across block
 * boundaries and turns a wall into a grey suggestion.
 *
 * What it costs, said plainly rather than discovered: a one-pixel detail has a one-in-two chance
 * of surviving. Desks, chairs, screens and characters are all several pixels across and read
 * fine at 8×12; the name plates over each desk do not, and are not meant to — that is what
 * clicking in is for.
 */
const THUMB_SCALE = 0.5

/** Room around the campus grid, so the outermost offices are not flush against the stage. */
const CAMPUS_PAD = 12

/** How long the zoom into a project takes. Long enough to read as movement, short enough to
    never be the reason you are waiting. Kept in step with `.flier` in `panels.css`. */
const ZOOM_MS = 220

/**
 * A floor axis, as one of the four faces a prop can present.
 *
 * Trivial now, and it was not under the isometric camera: with the floor rotated 45°, tile +x
 * was *down-right* on screen and the mapping between where somebody was walking and which
 * sprite to draw needed an argument. Removing the rotation makes screen direction and floor
 * axis the same thing again. The table stays because furniture and people must agree, and
 * agreeing by coincidence is how they silently stop agreeing.
 */
const FACE_OF: Readonly<Record<Direction, Facing>> = {
  right: 'east',
  left: 'west',
  down: 'south',
  up: 'north',
}

export interface FloorCallbacks {
  /** Someone was clicked. */
  onPick(who: string): void
  /** Work the floor cannot show — a dispatch to an agent with no desk. Never swallowed. */
  onUnstaged(missing: Unstaged): void
  /** The bubble's own button — open the full detail for this agent. */
  onDetails(who: string): void
  /** A theme could not be drawn from. Reported, never rendered as an empty desk unexplained. */
  onArtFailed(who: string, cause: string): void
  /**
   * The lounge was clicked — open the music controller.
   *
   * Optional, and the fallback matters: with nothing wired the sofa still toggles the generated
   * drone, so a build with no controller is a room you can change the mood of rather than a
   * click that does nothing.
   */
  onPickMusic?(): void
  /**
   * A bubble came down because what it described stopped being true.
   *
   * Told to the app so that anything it cached from that answer goes with it — an answer kept
   * anywhere after the floor has ruled it stale is the same lie in a different place.
   */
  onStale(who: string): void
  /** An office on the campus was clicked. */
  onPickProject(id: string): void
}

/**
 * One project's floor.
 *
 * The office has one set of staff and one layout, but each project is its own instance of it —
 * its own dispatches in flight, its own people mid-walk, its own bubbles. Keeping a scene per
 * project is what lets you leave a project with its reviewer halfway across the room, work
 * somewhere else, and come back to find them where they should be.
 *
 * The alternative — one floor, reset when you switch — would show a project's staff sitting
 * idle at their desks while their subagents were genuinely running. That is the floor lying
 * about the session, which is the one thing this project refuses to ship.
 */
interface Scene {
  readonly chore: Choreographer
  cast: Cast[]
  /** What is being said over whose head in this project, and whether it is still true. */
  readonly bubbles: BubbleBoard
  /**
   * Time this scene is owed, in seconds, because it was not on screen when it elapsed.
   *
   * Paid back in coarse lumps rather than at 60 Hz — see `OFFSCREEN_STEP_S`. Always zero for
   * the scene you are looking at.
   */
  owed: number
}

/**
 * How long an off-screen office may fall behind before it is caught up.
 *
 * `step()` used to advance **every** scene every frame, so twenty projects opened once were
 * twenty crowds being simulated at 60 Hz behind a floor you were not looking at. Not a memory
 * leak — laptop 2 measured that and withdrew the word — but an unbounded CPU cost growing on
 * exactly the axis the "20 projects" exit condition tests.
 *
 * Not simulating them at all is the wrong fix: a dispatch that arrives while you are in another
 * tab has to move somebody, and coming back to find them still standing where they were an hour
 * ago is the floor lying about work that happened. So an off-screen scene accumulates its time
 * and is stepped once every quarter second with the whole accumulated amount. Positions come out
 * identical — the walker integrates `dt`, so one 250 ms step lands where fifteen 16 ms steps
 * would — and the frames between them are frames nobody was going to see.
 *
 * 15× fewer updates per off-screen office, and the only thing given up is smoothness in a scene
 * that is not being drawn.
 */
const OFFSCREEN_STEP_S = 0.25

export class FloorView {
  private ctx: CanvasRenderingContext2D
  /** Shared: the roster is the workspace's, so every project gets the same room. */
  private plan: Floorplan = planFloor('manager', [])
  private readonly scenes = new Map<string, Scene>()
  private active = ''
  /**
   * Character art, keyed by agent name and shared across projects.
   *
   * Painted once. The same person works in every project, and decoding their frames again per
   * tab would be a round trip and a decode for nothing.
   */
  private readonly art = new Map<string, { frames: Readonly<Record<PaintDirection, ImageBitmap[]>>; w: number; h: number }>()
  /**
   * Which theme the cached art was painted from.
   *
   * The cache is keyed by agent, because the same person works in every project and decoding
   * them again per tab would be waste. But it is only valid for the theme it was drawn from —
   * without this, switching themes leaves everybody in the old art and only somebody hired
   * afterwards appears in the new one, which looks like the switch half-worked.
   */
  private artTheme = ''
  /**
   * The roster and the layout, kept so a scene created later can be furnished with staff.
   *
   * A project's floor is built the first time you open its tab, which is long after the cast
   * was last set. Without these, that floor comes up with desks and nobody at them.
   */
  private roster: readonly StaffMember[] = []
  private stations = new Map<string, Workstation>()
  private resolver: Stations = { resolve: () => null }
  /** The DOM layer the bubbles live on. Re-aligned to the canvas box by `fit()`. */
  private readonly layer: HTMLElement
  private readonly bubbleEls = new Map<string, HTMLElement>()
  private scale = 2
  /** Where the projected floor sits, and how big it is. Recomputed by `fit`. */
  private bounds: ViewBounds = viewBounds(1, 1, WALL_HEIGHT)
  private last = 0
  private raf = 0
  private readonly gate = new FrameGate()
  private cards: CampusCard[] = []
  /**
   * The office stereo.
   *
   * Owned here rather than wired through `app.ts`, and the reason is the boundary rather than
   * convenience: the lounge is a **click target on the floor**, the floor's click handling
   * lives in this file, and the sound is generated in the renderer from nothing — no file, no
   * IPC, no main-process involvement of any kind. Routing it through the wiring layer would
   * add a call site to a file this feature has nothing to say to. See `music.ts`.
   */
  private readonly stereo = new Stereo()
  /** Spotify, as opposed to the generated drone. Either one warms the room. */
  private externalMusic = false
  /** Who sits where. Survives a roster change; does not survive a restart, on purpose. */
  private seats: SeatMap = {}

  /** Milliseconds of office time. Drives the cat and the typing beat, and nothing else. */
  private clockMs = 0
  private petSettle = 0
  private keyBeat = 0
  private campus = false

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly stage: HTMLElement,
    private readonly callbacks: FloorCallbacks,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('this window has no 2d canvas')
    this.ctx = ctx

    // Bubbles are DOM rather than canvas. They carry real sentences and a button, and at the
    // floor's integer scale canvas text would be either unreadable or a different size from
    // the rest of the app. The layer is positioned over the canvas and moves with it.
    this.layer = document.createElement('div')
    this.layer.className = 'bubbles'
    stage.appendChild(this.layer)

    canvas.addEventListener('click', (e) => this.pick(e))
    // Watch the stage, not the window. The window is only an approximation of what actually
    // decides the floor's size: the stage also changes when a project tab wraps to a second
    // line, when the session strip appears, or when a problem pill shows up — none of which
    // resize the window, and all of which left the floor drawn for a stage that no longer
    // existed.
    //
    // This is only safe because the stage's height no longer depends on the canvas inside it —
    // see the `.floor` note in styles.css. Observing a box that your own output inflates is how
    // you build a loop rather than a fix.
    new ResizeObserver(() => this.fit()).observe(stage)
  }

  /** The floor being looked at. Scenes are created on first mention and never discarded. */
  private get scene(): Scene {
    // `portrait` is set only while an office is being painted into a thumbnail. Everything that
    // draws reads `this.scene`, so redirecting it here is what lets one drawing routine render
    // any project without every method below growing a parameter it would ignore.
    return this.sceneFor(this.portrait ?? this.active)
  }

  /** The conversation being painted into a thumbnail, or null when drawing the real floor. */
  private portrait: string | null = null

  /**
   * One rendered office per project, at campus size.
   *
   * What was asked for: a miniature version of the artwork of the running office, with the
   * people visibly moving and clickable. The campus used to draw a rectangle, a
   * hue and a light per agent, and `campus.ts` defends that as a performance contract —
   * correctly, for the thing it describes: forty **live** floors would cost forty walking
   * crowds every frame.
   *
   * They do not have to be live. An office painted once into an offscreen canvas is a bitmap,
   * and forty bitmaps are forty `drawImage` calls — the same cost as forty rectangles, to
   * within noise. A thumbnail is repainted only when that project's own scene changes, which
   * `step()` already knows because it tracks what moved per scene.
   *
   * So the contract survives intact and only its implementation changes: an office you are not
   * focused on is still not simulated for the campus's benefit. It is remembered.
   *
   * Keyed by **conversation**, the same key as the scene each one is a picture of. It was keyed by
   * project, and a project id names a scene nothing ever feeds — see `CampusOffice.session`.
   */
  private readonly thumbs = new Map<string, HTMLCanvasElement>()

  /** Conversations whose thumbnail is out of date. Emptied as they are repainted. */
  private readonly staleThumbs = new Set<string>()

  /**
   * Somewhere to stand in the lounge: in front of the sofa, or beside the cooler.
   *
   * In front of, not on. The cast has no sitting frame, and a character drawn standing on a
   * sofa is worse than one standing beside it.
   */
  private loungeSpot(spot: 'sofa' | 'cooler' | 'coffee'): Tile {
    const { sofa, waterCooler } = this.plan.lounge
    if (spot === 'coffee') {
      // Standing at the machine, not on it. The pantry's own spots know where that is.
      return this.plan.pantry.spots[0]?.tile ?? { x: waterCooler.x, y: waterCooler.y + 1 }
    }
    return spot === 'sofa'
      ? { x: sofa.x0, y: sofa.y1 + 1 }
      : { x: waterCooler.x, y: waterCooler.y + 1 }
  }

  private sceneFor(key: string): Scene {
    const existing = this.scenes.get(key)
    if (existing) return existing

    // Furnished from the roster as it stands now. A project opened for the first time gets the
    // same office as every other one — an empty floor here would be a room with desks and
    // nobody at them, which is not what the workspace says is true.
    const manager = this.roster.find((s) => s.isManager)
    const scene: Scene = {
      chore: new Choreographer({
        manager: manager?.id ?? 'manager',
        roster: this.roster.filter((s) => !s.isManager).map((e) => e.id),
      }),
      cast: [],
      bubbles: new BubbleBoard(),
      owed: 0,
    }
    scene.cast = this.rebuild([], this.roster, this.stations, this.resolver)
    this.scenes.set(key, scene)
    return scene
  }

  /**
   * The projects, for the campus view. Cheap to call — it lays out cards, not floors.
   */
  setCampus(offices: readonly CampusOffice[]): void {
    this.invalidate()
    this.relayOutCampus(offices)
    if (this.campus) this.fit()
  }

  /** The offices as last given. Kept so a resize can re-column without asking for them again. */
  private offices: readonly CampusOffice[] = []
  /** Offices the canvas has no room for. Zero unless the workspace is past the ceiling. */
  private omittedOffices = 0
  /** The pending break, when the floor is parked and somebody could earn one. */
  private breakTimer: ReturnType<typeof setTimeout> | null = null
  /** When the loop stopped, so the timer can hand `ambient` the time actually spent parked. */
  private parkedAt = 0

  /**
   * Lay the campus out for the width there is.
   *
   * A card is exactly one office's rendered bounds plus a name row, so the grid is a function of
   * the artwork rather than a tile count somebody guessed. The columns come from the stage's own
   * width: wide windows pack more per row, narrow ones wrap, and the campus scrolls rather than
   * shrinking every office until nobody can tell them apart — which is what fitting forty
   * offices into one screenful would do.
   */
  private relayOutCampus(offices: readonly CampusOffice[] = this.offices): void {
    this.offices = offices
    const card = this.thumbSize()
    const available = Math.max(1, this.stage.clientWidth - CAMPUS_PAD * 2)
    this.cards = layOutCampus(offices, columnsFor(available, card.width), card)
  }

  /** How big one office renders, in campus pixels. The same bounds `paintThumb` paints into. */
  private thumbSize(): { width: number; height: number } {
    const bounds = viewBounds(this.plan.width, this.plan.height, WALL_HEIGHT)
    return {
      width: Math.round(bounds.width * THUMB_SCALE),
      height: Math.round(bounds.height * THUMB_SCALE),
    }
  }

  /**
   * Zoom out to the campus, or back into one office.
   *
   * The same canvas and the same projection either way. That is the whole reason the tower was
   * dropped: a cutaway building needed a second way to draw, and this needs a different scale.
   */
  setView(view: 'office' | 'campus'): void {
    if (this.campus === (view === 'campus')) return
    this.campus = view === 'campus'
    // The stage clips in one mode and scrolls in the other, and only it knows which. Set here
    // rather than by the caller, so the two cannot disagree about which view is on screen.
    this.stage.dataset['view'] = this.campus ? 'campus' : 'office'
    this.invalidate()
    this.fit()
  }

  get isCampus(): boolean {
    return this.campus
  }

  /**
   * Show a project's floor.
   *
   * Everything about the one being left carries on — its routines keep running and its
   * dispatches stay tracked — because a project you are not looking at is still working. Only
   * the bubbles come down, and only their elements: they belong to a floor you can no longer
   * see, and re-showing them is a click away.
   */
  setProject(key: string): void {
    this.invalidate()
    if (this.active === key) return
    // The readings belong to the floor on screen, so the picture of the one being left stops
    // carrying them. See `paintThumb`.
    this.staleThumbs.add(this.active)
    this.active = key
    this.sceneFor(key)
    for (const el of this.bubbleEls.values()) el.remove()
    this.bubbleEls.clear()
    this.fit()
    this.drawBubbles()
  }

  /** What is on the shelf. A workspace with no skills gets an empty one, which is the truth. */
  setSkills(count: number): void {
    this.invalidate()
    this.skillCount = count
  }

  /**
   * Rebuild the cast from the roster.
   *
   * Called on first load and again on every workspace change, so an agent added to
   * `.claude/agents/` walks in without a reload. Anyone already on the floor keeps their
   * position: the office they are standing in did not change, only its staff list.
   */
  async setCast(
    staff: readonly StaffMember[],
    sprites: (name: string) => Promise<SpriteSheet>,
    themeId: string,
  ) {
    this.invalidate()
    // Every miniature is of an office that no longer exists — different staff, or the same
    // staff drawn differently. Dropped wholesale rather than diffed: it happens when somebody
    // hires, fires or changes theme, which is on the order of once a session.
    this.forgetThumbs()
    // A different theme is different art for everybody, not just for the next person hired.
    if (themeId !== this.artTheme) {
      for (const cached of this.art.values()) {
        for (const frames of Object.values(cached.frames)) for (const f of frames) f.close()
      }
      this.art.clear()
      this.artTheme = themeId
      // Every cast entry holds bitmaps from the old theme, so they are rebuilt rather than
      // reused — this is the one case where keeping somebody's existing art is wrong.
      for (const scene of this.scenes.values()) scene.cast = []
    }

    const manager = staff.find((s) => s.isManager)
    const employees = staff.filter((s) => !s.isManager)

    // Seats carried across the roster change, so firing somebody moves exactly their desk.
    //
    // Held here rather than persisted, and `seats.ts` argues why: the promise is that *one event
    // must not move four people*, and a restart is not that kind of event — nobody is watching
    // the desks at the moment the app starts. A store would be a second thing to keep in step
    // with the roster, and a stale entry in it is a desk drawn for somebody who has gone.
    this.seats = assignSeats(this.seats, employees.map((e) => e.id))
    this.plan = planFloor(manager?.id ?? 'manager', employees.map((e) => e.id), this.seats)

    // Art first, once, shared by every project. The same person works in all of them.
    for (const member of staff) {
      // Keyed by **what the art depends on**, not by who it is of. Keyed by id, an agent whose
      // description changed kept their old character until a restart, because the cache had no
      // way to know the look had moved. See `lookKey`.
      const key = lookKey(member.id, member.description ?? '')
      if (this.art.has(key)) continue
      try {
        // One fetch, both uses. Sprite dimensions come from the sheet rather than a constant —
        // a theme may draw at a different size — but asking for the sheet a second time just to
        // read them cost an IPC round trip and a second decode for every hire.
        //
        // Inside the `try`, not above it. A pack that will not *arrive* — a corrupt file, a
        // theme directory that has gone, an EACCES — used to leave this loop entirely: nobody
        // below that person in the roster was even asked for, nothing was reported, and every
        // line after the loop was skipped while `plan` and `seats` had already been replaced.
        // That is not one missing character, it is an empty office standing on a new floorplan,
        // and it is exactly the failure the line below describes.
        const sheet = await sprites(member.id)
        this.art.set(key, {
          frames: await toBitmaps(sheet),
          w: sheet.kind === 'painted' ? sheet.width : sheet.frameWidth,
          h: sheet.kind === 'painted' ? sheet.height : sheet.frameHeight,
        })
      } catch (error) {
        // A pack that will not load is reported and the person is skipped, never drawn as a
        // blank. An office missing somebody is obvious; an office of invisible people is a
        // mystery, and the mystery is what this whole seam exists to prevent.
        this.callbacks.onArtFailed(member.id, error instanceof Error ? error.message : String(error))
      }
    }

    const stations = stationsByName(this.plan)
    const resolver: Stations = {
      resolve: (ref) =>
        ref.at === 'briefing'
          ? this.plan.briefingSpot
          : ref.at === 'window'
            ? this.plan.window
            : ref.at === 'shelf'
              ? this.plan.shelfSpot
              : ref.at === 'meeting'
                ? (this.plan.meeting.seats[ref.seat]?.tile ?? null)
                : ref.at === 'lounge'
                  ? this.loungeSpot(ref.spot)
                  : (stations.get(ref.who)?.seat ?? null),
    }

    this.roster = staff
    this.stations = stations
    this.resolver = resolver

    // Every project's floor, not just the one on screen. A roster change while you are looking
    // at another tab still has to reach the floors you are not.
    this.sceneFor(this.active)
    for (const scene of this.scenes.values()) {
      // Updated in place, never rebuilt: a rescan lands mid-task routinely, and a fresh
      // choreographer would forget which character every in-flight dispatch belongs to.
      scene.chore.updateRoster({
        manager: manager?.id ?? 'manager',
        roster: employees.map((e) => e.id),
      })
      scene.cast = this.rebuild(scene.cast, staff, stations, resolver)
    }

    this.fit()
  }

  /** One scene's cast, keeping whoever is already standing there exactly where they are. */
  private rebuild(
    current: readonly Cast[],
    staff: readonly StaffMember[],
    stations: Map<string, Workstation>,
    resolver: Stations,
  ): Cast[] {
    const previous = new Map(current.map((c) => [c.who, c]))
    const next: Cast[] = []

    for (const member of staff) {
      const station = stations.get(member.id)
      const art = this.art.get(lookKey(member.id, member.description ?? ''))
      // No art means the theme could not be drawn from for this person; it has already been
      // reported, and a desk with nobody at it is the honest picture.
      if (!station || !art) continue

      const existing = previous.get(member.id)

      if (existing) {
        // Already here. The walker keeps their position, and the runner keeps their routine —
        // building a new one would silently drop a walk in progress, leaving whoever was
        // crossing the room stranded and their arrival never fired. Only the floorplan they
        // are walking on is swapped.
        existing.runner.retarget(this.plan.grid, resolver)
        next.push({ ...existing, label: member.name || member.id, isManager: member.isManager })
        continue
      }

      const walker = new Walker(station.seat, { tileSize: TILE_SIZE, facing: station.facing })
      next.push({
        who: member.id,
        label: member.name || member.id,
        isManager: member.isManager,
        walker,
        runner: new RoutineRunner(walker, this.plan.grid, resolver, TILE_SIZE),
        art: art.frames,
        spriteW: art.w,
        spriteH: art.h,
        phase: 0,
        pose: 'idle',
      })
    }

    return next
  }

  /**
   * Feed a project's choreographer.
   *
   * Named rather than implied, because events arrive for projects you are not looking at and
   * their floors have to stay correct anyway — that is the whole point of a floor per project.
   */
  apply(project: string, facts: readonly Fact[]): void {
    this.invalidate()
    const scene = this.sceneFor(project)
    for (const fact of facts) {
      const staged = scene.chore.handle(fact)
      for (const routine of staged.routines) this.begin(scene, routine)
      // The whole fact, not just the name. Narrowing it here is what kept the dispatch id out
      // of a notice whose own words are "the work is real".
      for (const missing of staged.unstaged) this.callbacks.onUnstaged(missing)
    }
    // A fact arriving is the moment a bubble can stop being true, so it is the moment to
    // check — rather than waiting for the next frame, which on a hidden or paused floor may
    // be a long way off.
    this.reconcileBubbles(scene)
  }

  /**
   * How each employee's outstanding work stands, from the harness.
   *
   * The floor's whole claim is that it shows real work, and whether the work is *verified* is
   * the most real thing about it. A panel that has to be opened is not the floor showing you
   * anything.
   */
  private outcomes: ReadonlyMap<string, TaskOutcome> = new Map()
  /** How many skills the workspace has. Drawn on the shelf — none means an empty shelf. */
  private skillCount = 0

  /**
   * What the room's props are reporting.
   *
   * Starts at {@link UNREAD} rather than at a set of plausible numbers, so a floor drawn before
   * anything has been read says so. The constants this replaced made the opposite promise on
   * the very first frame: a full-health plant and a clean whiteboard, before a project existed.
   */
  private room: RoomReading = UNREAD

  setOutcomes(outcomes: ReadonlyMap<string, TaskOutcome>): void {
    this.invalidate()
    this.outcomes = outcomes
    // The one picture painted with these is the open floor's. See `paintThumb`.
    this.staleThumbs.add(this.active)
  }

  /** What the props may say. See `src/shared/floor/room.ts` for where the readings come from. */
  setRoom(room: RoomReading): void {
    this.invalidate()
    this.room = room
    this.staleThumbs.add(this.active)
  }

  /**
   * What someone is doing, and the tool call that backs it.
   *
   * The comment here used to say *"Never invented — it names the cause"*, and it returned the
   * summary alone. See {@link doingLine}: the cause and the id are what make the animation a
   * claim somebody can check rather than one that merely looks plausible.
   */
  reasonFor(who: string): { text: string; trace: string | null } {
    return doingLine(this.scene.chore.routineFor(who) ?? null)
  }

  /**
   * Put a bubble up over someone while we ask what they are doing.
   *
   * Returns the situation being asked about. Hand it back to {@link settle} — that is what
   * lets an answer be checked against the moment it was a question about.
   */
  askOver(who: string): string {
    // One at a time. Desks are three tiles apart, so at any usable text width two bubbles on
    // neighbouring desks overlap and clip each other — the second one covering the first is
    // worse than not having asked. The board itself holds as many as you like; keeping the
    // floor to one is this view's decision, because it is the one that knows how far apart
    // the desks are.
    this.scene.bubbles.clearAll()

    const about = this.situationOf(who)
    this.scene.bubbles.ask(who, about)
    this.drawBubbles()
    return about
  }

  /**
   * An answer came back. Returns false if it was overtaken and therefore not shown.
   *
   * Being overtaken is normal, not a failure: asides take a second or two and the floor does
   * not wait. What matters is that a stale answer is dropped rather than displayed.
   */
  settle(who: string, about: string, text: string, isError: boolean): boolean {
    this.invalidate()
    const shown = this.scene.bubbles.answer(who, about, text, isError)
    this.drawBubbles()
    return shown
  }

  /** Take a bubble down. No argument takes them all down. */
  dismiss(who?: string): void {
    this.invalidate()
    if (who === undefined) this.scene.bubbles.clearAll()
    else this.scene.bubbles.clear(who)
    this.drawBubbles()
  }

  private situationOf(who: string, scene: Scene = this.scene): string {
    return situationKey(scene.chore.routineFor(who))
  }

  /**
   * Run the floor, and **stop running it when nothing is happening.**
   *
   * An office at rest is a still picture, and the loop this replaced repainted that still
   * picture sixty times a second for as long as the app was open. That is the charter's first
   * budget — *zero draw calls while nothing changes* — and it is not a micro-optimisation: it
   * is what makes a campus of N offices affordable at all, because N idle offices have to cost
   * nothing rather than N times something.
   *
   * The loop parks itself when a frame produces no change and restarts on {@link invalidate}.
   * Every public mutator calls that, which is the invariant the whole thing rests on: **a
   * change nobody announces is a frame nobody draws.** Miss one and the floor freezes holding a
   * stale picture, which is a worse failure than the waste it replaces — so the mutators are
   * listed in one place and each one calls it as its first act.
   */
  start(): void {
    if (this.raf) return
    this.last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 0.25) // a backgrounded window must not teleport
      this.last = now

      // The office drifts when there is nothing to do. Only the visible scene: an idle floor
      // you are not looking at has nothing to depict to anyone. On the campus nobody is looking at
      // a floor: the open one is a card's picture like the rest, and a break taken in it would
      // make that card the only one whose people move, which reads as work.
      const drifted = this.campus ? false : this.ambient(dt)
      if (this.gate.frame(this.step(dt) || drifted)) {
        this.draw()
        this.raf = requestAnimationFrame(tick)
        return
      }

      // The gate parked. Stop asking for frames; `invalidate` is what starts them again — and
      // sleep for exactly as long as the next break needs, rather than for nothing.
      this.raf = 0
      this.armBreak()
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.disarmBreak()
    this.gate.stop()
  }

  /**
   * Sleep until somebody could earn a break.
   *
   * The office drifting when there is nothing to do is a documented feature that has never once
   * happened, and the reason is a join between two correct designs: `FrameGate` parks the loop
   * when a frame changes nothing, and `Choreographer.ambient` only accumulates idle time when it
   * is called. The loop that would earn a break is switched off by the office becoming idle.
   *
   * One sleeping timer, not a poll. The charter's first budget is *zero draw calls while nothing
   * changes* and it is why a campus of idle offices costs nothing; checking on a schedule would
   * spend exactly what it protects. `msUntilNextBreak` is computable at the moment the loop
   * stops, so the floor can sleep the precise interval and wake once.
   */
  private armBreak(): void {
    this.disarmBreak()
    // No breaks while the campus is up, for the reason the frame loop gives. Leaving it goes
    // through `invalidate`, and the office arms again when it parks.
    if (this.campus) return

    const wait = this.scene.chore.msUntilNextBreak({ grounded: this.grounded() })
    if (wait === null) return

    this.parkedAt = performance.now()
    this.breakTimer = setTimeout(() => {
      this.breakTimer = null
      // Nor when the campus came up after this was armed. `setView` disarms this on its way
      // through `invalidate`, so this check is a second guard, and it holds without relying on that
      // order. Nothing is re-armed here: the office arms again when it parks.
      if (this.campus) return

      // The time actually spent parked, not the interval that was asked for. A timer that fires
      // late — a busy machine, a backgrounded window — would otherwise hand `ambient` less time
      // than really passed, and one that fires after a suspend would hand it hours; `ambient`
      // discards a gap that large rather than emptying the office in one step.
      const parked = performance.now() - this.parkedAt

      // Staging is what makes it worth a frame. If nothing came of it — everyone became busy or
      // grounded while we slept — sleep again rather than wake the floor to draw no change.
      if (this.ambient(parked / 1000)) this.invalidate()
      else this.armBreak()
    }, Math.max(wait, 1))
  }

  /**
   * Forget the pending break.
   *
   * Called by `invalidate`, which is the whole of why this is safe: any real change wakes the
   * loop, and the loop parks again with a schedule computed from where things now stand. Leaving
   * it armed across a wake would fire against a plan made before twenty seconds of animation and
   * hand `ambient` time the frame loop had already counted.
   */
  private disarmBreak(): void {
    if (this.breakTimer === null) return
    clearTimeout(this.breakTimer)
    this.breakTimer = null
  }

  /**
   * Everything drawn is out of date, including the miniatures.
   *
   * For a palette change: it repaints the room under every office at once, and a cached
   * thumbnail would keep the old colours until somebody in that project happened to move.
   */
  repaint(): void {
    this.forgetThumbs()
    this.invalidate()
  }

  /**
   * Real music is playing on a real device.
   *
   * The carpet already warmed while the built-in drone was on, and that was a decoration —
   * driven by a flag this class set for itself. Driven by Spotify's own `is_playing`, from a
   * device genuinely making sound, the same pixels become a **report**: the room telling you
   * something true about the world rather than about its own state.
   */
  setMusicPlaying(playing: boolean): void {
    if (this.externalMusic === playing) return
    this.externalMusic = playing
    this.invalidate()
  }

  /**
   * Something changed that the loop cannot see for itself. Draw at least one more frame.
   *
   * Called by every mutator, and public because not everything that changes the picture goes
   * through one: the interface palette is written straight into `props.PALETTE`, which the draw
   * loop reads every frame but only *when* it draws — and it parks when nothing is happening. A
   * theme switched on an idle office would sit unpainted until the next event. Anything that
   * changes what a frame would look like without going through this class has to say so, and
   * this is where it says it.
   */
  invalidate(): void {
    // Before waking, not after. The pending break was scheduled against an office that has just
    // stopped being the office it was scheduled for.
    this.disarmBreak()
    if (this.gate.invalidate()) this.start()
  }

  /** Frames actually drawn. Exposed so the idle budget can be asserted rather than asserted at. */
  get framesDrawn(): number {
    return this.gate.framesDrawn
  }

  /** True when the loop has stopped because the office is at rest. */
  get isParked(): boolean {
    return this.gate.isParked
  }

  // ────────────────────────────────────────────────────────────────────── internals ──

  private begin(scene: Scene, routine: Routine): void {
    scene.cast.find((c) => c.who === routine.who)?.runner.start(routine)
  }

  /**
   * Who may not drift, however quiet their session is.
   *
   * A failed or refused VERIFY means work outstanding that is known to be broken. Drawing that
   * person on the sofa would be the floor being *reassuring* rather than truthful, which is a
   * subtler version of the same failure as showing work that is not happening.
   */
  private grounded(): ReadonlySet<string> {
    const set = new Set<string>()
    for (const [who, outcome] of this.outcomes) {
      if (outcome === 'failed' || outcome === 'refused') set.add(who)
    }
    return set
  }

  /**
   * Let the visible scene drift, if it has been quiet long enough.
   *
   * `Math.random` rather than a seeded source: nothing here is reproduced, replayed or
   * asserted against, and the *decision* — who may drift and when — is tested in the
   * choreographer with a deterministic `pick`. This is the only place the randomness is real,
   * and it chooses between a sofa and a water cooler.
   */
  private ambient(dt: number): boolean {
    const staged = this.scene.chore.ambient(dt * 1000, {
      pick: (n) => Math.floor(Math.random() * n),
      // Someone with broken work outstanding is not on a coffee break.
      grounded: this.grounded(),
    })
    for (const routine of staged.routines) this.begin(this.scene, routine)
    return staged.routines.length > 0
  }

  /**
   * Advance every scene, and report whether the one on screen changed.
   *
   * Every scene is stepped, including projects you are not looking at — a floor you switch back
   * to must be where the work actually got to, not where you left it. But only the **visible**
   * scene's movement is a reason to repaint, which is the whole point: five projects walking
   * about in the background cost arithmetic, not pixels.
   */
  private step(dt: number): boolean {
    let visibleChanged = false

    // The one clock on this floor that is not bound to a fact.
    //
    // It drives the cat and nothing else, and it is **quantised on purpose**: the pose changes
    // once every PET_SETTLE_MS, so the render budget pays for one extra frame every seven
    // seconds rather than sixty a second. An idle office still parks — see FrameGate — it just
    // wakes up occasionally to move a cat, which is a cost worth stating out loud rather than
    // discovering in a profile.
    this.clockMs += dt * 1000
    const settle = Math.floor(this.clockMs / PET_SETTLE_MS)
    if (settle !== this.petSettle) {
      this.petSettle = settle
      visibleChanged = true
    }

    // The typing beat. Only advanced while somebody on this floor is actually working, so an
    // office with nothing happening in it does not pay for a clock it is not showing.
    const typing = this.scene.cast.some((c) => c.pose === 'working')
    const beat = typing ? Math.floor(this.clockMs / KEYSTROKE_MS) % 2 : 0
    if (beat !== this.keyBeat) {
      this.keyBeat = beat
      visibleChanged = true
    }

    for (const [key, scene] of this.scenes.entries()) {
      const onScreen = scene === this.scene
      let moved = false

      // An office you are not looking at is caught up in lumps, not simulated frame by frame.
      let elapsed = dt
      if (!onScreen) {
        scene.owed += dt
        if (scene.owed < OFFSCREEN_STEP_S) continue
        elapsed = scene.owed
        scene.owed = 0
      } else if (scene.owed !== 0) {
        // Just came into view carrying a debt. Pay it with this frame so the first drawn frame
        // is already correct rather than a quarter second stale.
        elapsed += scene.owed
        scene.owed = 0
      }

      for (const member of scene.cast) {
        const finished = member.runner.update(elapsed)
        const pose = member.runner.state.pose
        if (pose !== member.pose) {
          member.pose = pose
          moved = true
        }
        if (member.walker.isMoving) {
          member.phase += elapsed * 1000
          moved = true
        } else if (member.phase !== 0) {
          member.phase = 0
          moved = true
        }

        if (finished) {
          for (const routine of scene.chore.finished(member.who).routines) this.begin(scene, routine)
          moved = true
        }

        // A routine still in flight is a change, even on a frame where no pixel moves.
        //
        // A `pause` step moves nothing: the walker has arrived, the pose is set, and the only
        // thing happening is time passing. Without this the gate reads that frame as "nothing
        // changed" and parks — mid-routine, with the pause never counted down. The character
        // stays at the sofa forever, the choreographer keeps them in `running`, and no further
        // ambient behaviour is possible for anybody, because `msUntilNextBreak` answers null for
        // an office where everyone is busy.
        //
        // This never showed because no ambient routine has ever started. The coffee break was
        // the first thing to walk somebody anywhere and then ask them to wait, and it froze on
        // its first pause.
        if (member.runner.isRunning) moved = true
      }

      // Also every frame, because a routine can finish without any new fact arriving.
      if (this.reconcileBubbles(scene)) moved = true

      if (!moved) continue
      if (onScreen) visibleChanged = true

      // Somebody in this office moved, so its thumbnail is out of date. Marked rather than
      // repainted: repainting here would cost a full office render per scene per frame, which
      // is exactly the "forty live floors" bill the campus was built to avoid. The repaint
      // happens once, in `drawCampus`, and only for offices actually on screen.
      this.staleThumbs.add(key)
      // And the campus has to be told, or a floor full of walking people sits frozen behind a
      // gate that was never invalidated.
      if (this.campus) this.gate.invalidate()
    }

    return visibleChanged
  }

  /**
   * Take down anything being said about a moment that has passed.
   *
   * The rule the whole bubble module exists for. Run on every fact and on every frame, because
   * a situation can change either because something happened or because something finished.
   */
  private reconcileBubbles(scene: Scene = this.scene): boolean {
    const dropped = scene.bubbles.reconcile((who) => this.situationOf(who, scene))
    if (dropped.length === 0) return false
    for (const who of dropped) this.callbacks.onStale(who)
    if (scene === this.scene) this.drawBubbles()
    return true
  }

  private fit(): void {
    // The projected floor is a diamond, so its bounding box is nothing like `width x height`
    // tiles. Sizing to the tile counts would waste most of the canvas and clip the rest.
    if (this.campus) {
      // Already pixels — `campusSize` measures rendered offices, not tiles — so there is no
      // projection to do. Re-columned first, because the number that fits depends on the width
      // this resize just changed.
      this.relayOutCampus()

      // Clamped to a canvas this engine will actually hand back.
      //
      // Nothing capped this, and past the ceiling the canvas keeps every attribute it is given
      // and loses its pixels — `canvas.height` reads back correctly, every draw call succeeds,
      // and the pane is empty while the switcher still lists the projects. Measured: 600
      // projects asked for 1408x81976 and drew nothing at all. A blank campus is a statement
      // that the workspace has no offices, which is the one thing this app must not say.
      //
      // The ceiling is a function of width, not a constant — see `canvasCeiling`. The scale is
      // handed in because the canvas is allocated in device pixels while the layout is in CSS
      // ones, and a ceiling that forgot the ratio would be twice as generous as the engine on
      // every retina screen.
      const full = campusSize(this.cards)
      const room = canvasCeiling(full.width, window.devicePixelRatio || 1)
      const fitted = fitCampus(this.cards, room)
      this.cards = [...fitted.drawn]
      this.omittedOffices = fitted.omitted

      // The omitted count, so the note that reports it gets a row rather than being printed over
      // the last row of names.
      const size = campusSize(this.cards, this.omittedOffices)
      this.bounds = { width: size.width, height: size.height, offsetX: 0, offsetY: 0 }
    } else {
      this.bounds = viewBounds(this.plan.width, this.plan.height, WALL_HEIGHT)
    }
    // The stage must be a box this canvas cannot inflate — see the `.floor` note in styles.css,
    // where a `1fr` track sized by its content turned this measurement into a feedback loop.
    // The campus is laid out in the pixels it will be drawn in, so there is nothing to fit: it
    // is 1:1 and the stage scrolls. Fitting it instead — the old behaviour, inherited from a
    // campus of abstract cards — shrinks every office until forty of them are indistinguishable
    // smudges, which is the exact failure real artwork is meant to fix.
    this.scale = this.campus
      ? 1
      : chooseScale(
          { width: this.stage.clientWidth, height: this.stage.clientHeight },
          this.bounds,
        )

    const dpr = window.devicePixelRatio || 1
    const cssW = this.bounds.width * this.scale
    const cssH = this.bounds.height * this.scale
    this.canvas.style.width = `${cssW}px`
    this.canvas.style.height = `${cssH}px`
    this.canvas.width = Math.round(cssW * dpr)
    this.canvas.height = Math.round(cssH * dpr)
    // The offset is baked into the transform rather than added at every draw call: half the
    // floor projects to negative x, and a projection that had to remember where it was being
    // drawn would not be a projection.
    this.ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0)
    this.ctx.translate(this.bounds.offsetX, this.bounds.offsetY)
    this.ctx.imageSmoothingEnabled = false
    // Resizing clears the canvas, so a repaint is mandatory rather than merely likely.
    this.invalidate()

    // The canvas is centred in the stage by grid, so its offset is only known after layout.
    // Reading it here — right after the size changed — is what keeps the bubbles over the
    // right heads when the window is resized.
    this.layer.style.left = `${this.canvas.offsetLeft}px`
    this.layer.style.top = `${this.canvas.offsetTop}px`
    this.layer.style.width = `${cssW}px`
    this.layer.style.height = `${cssH}px`
  }

  private draw(): void {
    if (this.campus) {
      this.drawCampus()
      return
    }
    this.drawOffice()
  }

  /**
   * Paint one conversation's floor into an offscreen canvas, at campus scale.
   *
   * The whole trick is that `drawOffice()` already knows how to draw an office — it reads
   * `this.ctx`, `this.bounds` and `this.scene`, and none of those has to be the real ones. So
   * this swaps all three, calls the routine unchanged, and puts them back. Every prop, every
   * chair, every character and the same depth sort come along for free, which is the point: a
   * thumbnail that had its own drawing code would be a second office that drifts from the first.
   *
   * It also reads the VERIFY outcomes and the room readings, and those are **the open floor's**:
   * `app.ts` sets them from `tasksOf(active)` and nothing else. Swapping only the three above
   * painted one project's failed check and notice board onto every card on the campus. Any other
   * floor is painted with none — no outcomes, an unread room — which is what this view knows
   * about it.
   *
   * `try/finally` around the swap is load-bearing rather than defensive. A throw anywhere inside
   * `drawOffice` — a bitmap that failed to decode, a prop with a bad tile — would otherwise
   * leave the view pointing its context at an offscreen canvas, and the real floor would stop
   * appearing with no error anybody could see.
   */
  private paintThumb(key: string): HTMLCanvasElement {
    const scale = THUMB_SCALE
    const bounds = viewBounds(this.plan.width, this.plan.height, WALL_HEIGHT)
    const dpr = window.devicePixelRatio || 1

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bounds.width * scale * dpr)
    canvas.height = Math.round(bounds.height * scale * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0)
    ctx.translate(bounds.offsetX, bounds.offsetY)
    ctx.imageSmoothingEnabled = false

    const realCtx = this.ctx
    const realBounds = this.bounds
    const realOutcomes = this.outcomes
    const realRoom = this.room
    try {
      this.ctx = ctx
      this.bounds = bounds
      this.portrait = key
      if (key !== this.active) {
        this.outcomes = new Map()
        this.room = UNREAD
      }
      this.drawOffice()
    } finally {
      this.ctx = realCtx
      this.bounds = realBounds
      this.portrait = null
      this.outcomes = realOutcomes
      this.room = realRoom
    }

    return canvas
  }

  /** This conversation's thumbnail, painted if it has never been painted or has gone stale. */
  private thumbFor(key: string): HTMLCanvasElement {
    const already = this.thumbs.get(key)
    if (already && !this.staleThumbs.has(key)) return already

    const painted = this.paintThumb(key)
    this.thumbs.set(key, painted)
    this.staleThumbs.delete(key)
    return painted
  }

  /**
   * Every thumbnail is wrong now.
   *
   * The roster changed, or the theme did, or the window's device pixel ratio moved. Cheaper to
   * drop them all than to work out which are still right, and it happens on the order of once a
   * session rather than once a frame.
   */
  private forgetThumbs(): void {
    this.thumbs.clear()
    this.staleThumbs.clear()
  }

  /**
   * Every project at once — as itself, not as a swatch.
   *
   * Each card is that office's own artwork: the same room, the same desks, the same people
   * standing where the facts put them, painted once into an offscreen canvas and blitted here.
   * This is exactly what was asked for — a miniature of the running office's own artwork, with
   * the people visibly moving and clickable — and the reason it is
   * affordable is in `campus.ts`: forty offices are forty `drawImage` calls, because a thumbnail
   * is repainted only when that project's own scene changes.
   *
   * The hue survives as a tint under the room and as the name's colour. It was carrying the
   * whole identity of a project before; now it is the thing that tells two offices apart at a
   * glance when their floors are, by design, identical.
   */
  private drawCampus(): void {
    const { ctx } = this
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(-8, -8, this.bounds.width + 16, this.bounds.height + 16)

    for (const card of this.cards) {
      const { rect, office, hue } = card
      const w = rect.x1 - rect.x0
      const h = rect.y1 - rect.y0

      // A tinted ground under the artwork. Two purposes: it is what the card looks like in the
      // instant before its thumbnail exists, and it gives a project a colour of its own on a
      // campus where every floor plan is deliberately the same.
      ctx.fillStyle = `hsl(${hue} 22% ${office.focused ? 20 : 13}%)`
      ctx.fillRect(rect.x0, rect.y0, w, h)

      // A scene keyed the way facts reach it, never the project id, which names a scene nothing
      // feeds. `null` is a card with no picture — see `pictureOf`.
      const picture = pictureOf(office)
      const thumb = picture === null ? null : this.thumbFor(picture)
      if (thumb && thumb.width > 0) {
        // Drawn at its natural size, centred. Never stretched to the card: this is pixel art,
        // and a fractional scale turns a one-pixel wall into a grey smear.
        const dx = rect.x0 + Math.floor((w - thumb.width / (window.devicePixelRatio || 1)) / 2)
        const dy = rect.y0 + Math.floor((h - thumb.height / (window.devicePixelRatio || 1)) / 2)
        ctx.drawImage(
          thumb,
          dx,
          dy,
          thumb.width / (window.devicePixelRatio || 1),
          thumb.height / (window.devicePixelRatio || 1),
        )
      }

      /*
       * What this office wants from you, which is not the same as what it is doing.
       *
       * This comment used to say `busy` answered *"which of these wants me"*. It answers the
       * opposite: a project whose manager is running is working and wants nothing, while one
       * holding a decision at the gate has stopped and is refused after four minutes whether or
       * not anybody looked. The card said "something is happening here" and was read as
       * "something needs you here".
       *
       * So two marks, and `waiting` outranks `busy` — they can be true at once when one
       * conversation is held and another runs, and drawing the busy half over that reports the
       * half that needs nothing from you.
       */
      const mark = markFor(office)
      if (mark) {
        ctx.strokeStyle = mark.role === 'warn' ? PALETTE.warn : PALETTE.accent
        ctx.lineWidth = mark.width
        ctx.strokeRect(
          rect.x0 + mark.inset,
          rect.y0 + mark.inset,
          w - mark.inset * 2,
          h - mark.inset * 2,
        )
      }

      if (office.focused) {
        ctx.strokeStyle = PALETTE.ink
        ctx.lineWidth = 1
        ctx.strokeRect(rect.x0 + 1.5, rect.y0 + 1.5, w - 3, h - 3)
      }

      ctx.font = '9px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillStyle = office.focused ? PALETTE.ink : PALETTE.inkDim
      ctx.fillText(
        ellipsise(office.name, w - 4, (t) => ctx.measureText(t).width),
        rect.x0 + 1,
        rect.y1 + NAME_ROW - 6,
      )
    }

    this.drawOmittedNote()
    // Takes down whatever the office view left up. See `drawBubbles`.
    this.drawBubbles()
  }

  /**
   * Say how many offices this canvas had no room for.
   *
   * A partial campus that says it is partial is honest; one that just stops is a statement that
   * the workspace has that many projects and no more. The sentence names both numbers and where
   * the rest are, because a bare "+300" tells somebody a count and not what to do with it — the
   * switcher lists every project whatever the canvas can hold.
   */
  private drawOmittedNote(): void {
    if (this.omittedOffices === 0) return

    const { ctx } = this
    // Branched even though this cannot be one — the note only draws when something was omitted,
    // so the total is at least two. `repo-health.test.ts` cannot see that and should not have to:
    // the rule is that a count in a sentence carries its own plural, and an exception argued from
    // the surrounding code is how the two it was written for got in.
    const total = this.cards.length + this.omittedOffices
    const projects = total === 1 ? '1 project' : `${total} projects`
    const text = `${projects} · ${this.cards.length} drawn · the rest are in the switcher`

    ctx.font = '9px ui-monospace, monospace'
    ctx.textAlign = 'left'
    ctx.fillStyle = PALETTE.inkDim
    ctx.fillText(text, 1, this.bounds.height - 4)
  }

  private drawOffice(): void {
    const { ctx } = this
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(-this.bounds.offsetX, -this.bounds.offsetY, this.bounds.width, this.bounds.height)

    this.drawRoom()

    // Furniture and people sorted together, by the y of whatever they stand on.
    //
    // Two passes — all desks, then all characters — is the intuitive arrangement and it is
    // wrong: a desk in front of its occupant would be painted behind them, and since a
    // character is two tiles tall and a desk is one, the desk would vanish entirely. One
    // sorted pass is what gives you a person sitting *at* a desk rather than on top of it.
    const scene: { sortY: number; draw: () => void }[] = []

    for (const station of [...this.plan.workstations, this.plan.managerStation]) {
      const isManagers = station.who === this.plan.managerStation.who
      // The chair sorts on its OWN tile, not the desk's, and that is the whole of two bugs
      // the user reported: "the agents look like they're sitting under the chair" and "their
      // chairs look like they're above the table".
      //
      // Both came from painting desk, chair and monitor as one item keyed to the desk. A seat
      // is one row nearer the camera than the desk it belongs to, so the character standing
      // there sorts *lower* than the composite and gets painted before it — and the chair,
      // riding along with the desk, landed on top of them. Within the composite the same row
      // difference put the chair, painted second, visibly on the desk's lid.
      //
      // No tie-break is needed between a chair and its occupant: stations are pushed before
      // characters and `Array#sort` is stable, so an equal key already paints chair first.
      scene.push({
        sortY: depthOf(station.desk),
        draw: () => this.drawStation(station, isManagers),
      })
      scene.push({
        sortY: depthOf(station.seat),
        draw: () =>
          drawChair(this.ctx, station.seat, FACE_OF[station.facing], {
            pushedIn: !this.isSeated(station),
          }),
      })
    }

    const pet = this.petTile()
    if (pet) {
      scene.push({
        sortY: depthOf(pet),
        draw: () => drawPet(this.ctx, pet, { pose: this.petSettle }),
      })
    }

    for (const member of this.scene.cast) {
      const t = tileOf(member.walker.position)
      scene.push({ sortY: depthAt(t.y), draw: () => this.drawCharacter(member) })
    }

    this.pushFixtures(scene)

    scene.sort((a, b) => a.sortY - b.sortY)
    for (const item of scene) item.draw()

    // Labels last and unsorted — a name that disappears behind furniture is no use.
    for (const member of this.scene.cast) this.drawLabel(member)

    this.drawBubbles()
  }

  /**
   * Bubbles, in the DOM, over the right heads.
   *
   * Called from the draw loop to keep them over a moving character, **and** directly whenever
   * the board changes. The second is what makes a bubble appear the instant you click rather
   * than on the next frame — and it means what is being said does not depend on the animation
   * running at all. `stop()` freezes the office; it should not also freeze the answers.
   *
   * Elements are created and removed to match the board rather than hidden and reused, so
   * there is never an element on the page holding text the board has already ruled stale.
   */
  private drawBubbles(): void {
    // None on the campus. A bubble is DOM over the floor you are standing in, and the campus is a
    // wall of pictures: `paintThumb` reaches here through `drawOffice`, and drawing that
    // conversation's board would raise its bubbles over the cards. The boards keep what they
    // hold, and the office view puts it back up.
    const live = new Map<string, Bubble>(this.campus ? [] : this.scene.bubbles.all().map((b) => [b.who, b]))

    for (const [who, el] of this.bubbleEls) {
      if (!live.has(who)) {
        el.remove()
        this.bubbleEls.delete(who)
      }
    }

    for (const [who, bubble] of live) {
      const member = this.scene.cast.find((c) => c.who === who)
      // Somebody left the workspace while their bubble was up. Nothing to point at.
      if (!member) {
        this.scene.bubbles.clear(who)
        continue
      }

      const el = this.bubbleEls.get(who) ?? this.createBubble(who)
      this.fillBubble(el, bubble)
      this.placeBubble(el, member)
    }
  }

  /**
   * Put a bubble over a character's head — or under their feet, when there is no room.
   *
   * The top row of desks sits two tiles from the wall, so a bubble above those heads would
   * hang off the floor entirely and over the app's chrome. Rather than clamp it to the edge,
   * where the tail would point at nobody, it flips below the character and the tail flips with
   * it. A bubble that does not clearly belong to somebody is worse than one in the wrong half
   * of the room.
   */
  private placeBubble(el: HTMLElement, member: Cast): void {
    // Bubbles live in the DOM, not the canvas, so they need the canvas transform applied by
    // hand — including the offset that `fit` baked in, which the canvas gets for free.
    const foot = screenOf(member.walker.position)
    const x = Math.round((foot.x + this.bounds.offsetX) * this.scale)
    const head = Math.round((foot.y - member.spriteH + this.bounds.offsetY) * this.scale)
    const feet = Math.round((foot.y + this.bounds.offsetY) * this.scale)

    // `offsetHeight` is 0 on the frame an element is created, before layout has run. Treat
    // that as "assume it fits" rather than flipping every new bubble on its first frame.
    const height = el.offsetHeight
    const above = height === 0 || head - GAP - height >= 0

    el.dataset['flip'] = above ? 'above' : 'below'
    el.style.transform = above
      ? `translate(-50%, -100%) translate(${x}px, ${head - GAP}px)`
      : `translate(-50%, 0) translate(${x}px, ${feet + GAP}px)`
  }

  private createBubble(who: string): HTMLElement {
    const el = document.createElement('div')
    el.className = 'bubble'

    const text = document.createElement('p')
    text.className = 'bubble__text'
    el.appendChild(text)

    // The office's own line, kept as a separate element rather than appended to the sentence
    // above. What `.bubble__text` holds came from a model; this came from running the task's
    // VERIFY. Two different kinds of claim should not share one paragraph.
    const checked = document.createElement('p')
    checked.className = 'bubble__checked'
    el.appendChild(checked)

    const details = document.createElement('button')
    details.type = 'button'
    details.className = 'bubble__more'
    details.textContent = 'Details'
    details.addEventListener('click', (event) => {
      event.stopPropagation()
      // Take the bubble down as the card comes up.
      //
      // Reported as double tooltips: clicking the agent's own tooltip brought up a second card
      // saying the same thing. That is two surfaces holding the same sentence at the
      // same time — the bubble said it, and the card said it again in a second speech bubble
      // with a tail pointing at nothing. One answer, one place to read it. The card carries the
      // answer forward from `lastAnswers`, so nothing is lost and nothing is asked twice.
      this.dismiss(who)
      this.callbacks.onDetails(who)
    })
    el.appendChild(details)

    this.layer.appendChild(el)
    this.bubbleEls.set(who, el)
    return el
  }

  private fillBubble(el: HTMLElement, bubble: Bubble): void {
    const wanted = bubble.state === 'asking' ? 'asking…' : bubble.text
    const text = el.querySelector('.bubble__text')
    // Everything in here came from a model. `textContent`, always — an agent that prints a
    // script tag renders as the characters of a script tag. Compared before writing because
    // this runs every frame and rewriting identical text thrashes layout.
    if (text && text.textContent !== wanted) text.textContent = wanted

    // Hidden rather than blank when there is nothing checked to say. An empty line under a
    // sentence reads as a result that failed to load, which is the one thing it must not.
    const checked = el.querySelector<HTMLElement>('.bubble__checked')
    if (checked) {
      const line = bubble.state === 'asking' ? null : checkedLine(this.outcomes.get(bubble.who))
      if (checked.textContent !== (line ?? '')) checked.textContent = line ?? ''
      checked.hidden = line === null
    }

    el.dataset['state'] = bubble.state
    const more = el.querySelector<HTMLElement>('.bubble__more')
    if (more) more.hidden = bubble.state === 'asking'
  }

  private drawRoom(): void {
    const { ctx, plan } = this

    // Carpet first, in depth order. The weave is the props module's, which is the same trick
    // this file used in plan view: two tones a hair apart read as texture rather than a
    // chessboard.
    //
    // Carpet runs under the furniture and under the interior walls as well as under the open
    // floor, and stops at the outer ring. Two things follow from that: a desk with an overhang
    // no longer shows the app's backdrop through the gap between its legs, and an interior wall
    // can be drawn as a course of masonry standing *on* the floor rather than as a hole in it.
    // The boundary stays bare, because outside the room there is no room.
    //
    // **The vibe.** When music is playing, the vibe of the office changes — and it is the
    // carpet, warmed a step toward the plant pots, and nothing else — no overlay, no filter, no
    // second pass. A palette shift costs one redraw when it changes and nothing per frame after
    // that, which is the only kind of atmosphere this renderer can afford. `drawFloorTile`
    // derives its second tone from the first, so the weave survives the recolour.
    const carpet = this.stereo.isPlaying || this.externalMusic
      ? { colour: mix(PALETTE.floor, PALETTE.pot, 0.14) }
      : undefined
    for (let y = 1; y < plan.height - 1; y++) {
      for (let x = 1; x < plan.width - 1; x++) {
        drawFloorTile(ctx, { x, y }, carpet)
      }
    }

    // Then walls, back to front. Which face a wall presents is decided by which side of it the
    // room is on — a wall showing its back to the room is a wall you cannot see past.
    for (let y = 0; y < plan.height; y++) {
      for (let x = 0; x < plan.width; x++) {
        if (plan.grid.isWalkable(x, y)) continue
        if (this.isDesk(x, y)) continue

        // Interior walls are solid and lit; the outer ring stays a thin, dark boundary slab.
        const outer = x === 0 || y === 0 || x === plan.width - 1 || y === plan.height - 1
        drawWall(ctx, { x, y }, this.wallFacing(x, y), {
          height: WALL_HEIGHT,
          solid: !outer,
          ...(outer ? {} : { colour: PALETTE.wallInner }),
        })
      }
    }

    this.drawWindow()
    this.drawShelf()
  }

  /**
   * The shelf the skills come off.
   *
   * Drawn as shelving with things on it rather than as a blocked rectangle, because "walked
   * over and took something down" only reads as that if there is visibly something to take.
   * The colours are the desks' wood, a shade lighter, so it belongs to the same room.
   */
  private drawShelf(): void {
    const { ctx, plan } = this
    // One unit per tile the shelf spans, so a wider shelf is more shelving rather than one
    // stretched sprite. The books are the workspace's real skill count spread across them, so
    // an empty shelf is an honest picture of a workspace with no skills in it.
    const tiles = plan.shelf.x1 - plan.shelf.x0 + 1
    let left = this.skillCount

    for (let i = 0; i < tiles; i++) {
      const share = Math.min(left, Math.ceil(this.skillCount / tiles))
      left -= share
      drawShelfUnit(ctx, { x: plan.shelf.x0 + i, y: plan.shelf.y0 }, 'south', { books: share })
    }
  }

  /**
   * The rooms that are not desks.
   *
   * A meeting table, a lounge, a server corner. Drawn from what the floorplan says is there
   * rather than from anything this file decides — the same rule the desks follow, and for the
   * same reason: there is one map, it lives on the floor, and a renderer holding a second
   * opinion about where the sofa is would be a second map.
   *
   * Sorted in with everything else rather than painted in a pass of their own. A character at
   * the water cooler has to be in front of it, and one behind the meeting table has to be
   * behind it.
   */
  private pushFixtures(scene: { sortY: number; draw: () => void }[]): void {
    const { ctx, plan } = this
    const { meeting, lounge, servers, pantry } = plan

    // The rug is drawn immediately and unsorted, because it is floor covering rather than a
    // thing standing on the floor: nothing is ever behind it.
    drawRug(
      ctx,
      { x: lounge.rug.x0, y: lounge.rug.y0 },
      {
        width: lounge.rug.x1 - lounge.rug.x0 + 1,
        height: lounge.rug.y1 - lounge.rug.y0 + 1,
      },
    )

    scene.push({
      sortY: depthOf({ x: meeting.table.x0, y: meeting.table.y1 }),
      draw: () =>
        drawTable(
          ctx,
          { x: meeting.table.x0, y: meeting.table.y0 },
          { length: meeting.table.x1 - meeting.table.x0 + 1, along: 'x' },
        ),
    })

    // The pantry: a machine on a counter, and a table to stand at. Drawn in the sorted pass
    // like every other standing thing, so somebody at the table occludes it correctly.
    scene.push({
      sortY: depthOf(pantry.coffee),
      draw: () => drawCoffeeMachine(ctx, pantry.coffee, 'south'),
    })
    // Stood on its end, so the column beside it stays a walkway. `length` counts tiles along
    // whichever axis the table actually spans; reading it off the wrong one draws a one-tile
    // table under a two-tile footprint and leaves a person standing in mid-air.
    const pantryAlongY = pantry.table.y1 > pantry.table.y0
    scene.push({
      sortY: depthOf({ x: pantry.table.x0, y: pantry.table.y1 }),
      draw: () =>
        drawTable(
          ctx,
          { x: pantry.table.x0, y: pantry.table.y0 },
          {
            length: pantryAlongY
              ? pantry.table.y1 - pantry.table.y0 + 1
              : pantry.table.x1 - pantry.table.x0 + 1,
            along: pantryAlongY ? 'y' : 'x',
          },
        ),
    })

    // Chairs at the eating table, which is what makes it an eating table rather than a counter.
    // Only the spots that face it across its free side — a chair at the coffee machine would be
    // a chair facing a wall.
    for (const spot of pantry.spots) {
      if (spot.facing !== 'left' && spot.facing !== 'right') continue
      scene.push({
        sortY: depthOf(spot.tile),
        draw: () => drawChair(ctx, spot.tile, FACE_OF[spot.facing], { pushedIn: !this.standingAt(spot.tile) }),
      })
    }

    for (const seat of meeting.seats) {
      scene.push({
        sortY: depthOf(seat.tile),
        draw: () => drawChair(ctx, seat.tile, FACE_OF[seat.facing], { pushedIn: true }),
      })
    }

    scene.push({
      sortY: depthOf({ x: meeting.whiteboard.x0, y: meeting.whiteboard.y1 }),
      draw: () => {
        for (let x = meeting.whiteboard.x0; x <= meeting.whiteboard.x1; x++) {
          drawWhiteboard(ctx, { x, y: meeting.whiteboard.y0 }, 'south', { lines: this.room.board })
        }
      },
    })

    for (const tile of plan.pictureFrames) {
      scene.push({ sortY: depthOf(tile), draw: () => drawPictureFrame(ctx, tile, 'south') })
    }

    scene.push({
      sortY: depthOf({ x: lounge.sofa.x0, y: lounge.sofa.y1 }),
      draw: () => {
        drawSofa(ctx, { x: lounge.sofa.x0, y: lounge.sofa.y0 }, 'south', {
          length: lounge.sofa.x1 - lounge.sofa.x0 + 1,
        })
        drawStereo(ctx, { x: lounge.sofa.x1, y: lounge.sofa.y0 }, 'south', {
          playing: this.stereo.isPlaying || this.externalMusic,
        })
      },
    })

    scene.push({
      sortY: depthOf(lounge.waterCooler),
      draw: () => drawWaterCooler(ctx, lounge.waterCooler),
    })

    // The printer. `busy` is left false on purpose: nothing in the office currently knows when
    // a document is being produced, and a sheet permanently half-fed would be the prop claiming
    // an activity. It gets its paper the day there is a fact behind it.
    const { amenities } = plan
    scene.push({
      sortY: depthOf(amenities.printer),
      draw: () => drawPrinter(ctx, amenities.printer, 'south'),
    })

    for (const tile of amenities.crates) {
      scene.push({ sortY: depthOf(tile), draw: () => drawCrate(ctx, tile, 'south', { count: 2 }) })
    }

    // Plants read the project's recency — `ProjectInfo.lastActiveAt`, the conversation's own
    // timestamp rather than a directory mtime, so a project somebody edited in an editor has
    // not been "worked on here". A project with no recency to read draws ashen rather than
    // healthy: the comment that used to sit here said a wilting plant "would be a status nobody
    // set", which was right, and full health was that same mistake pointing the other way.
    for (const tile of amenities.plants) {
      scene.push({
        sortY: depthOf(tile),
        draw: () => drawPlant(ctx, tile, { health: this.room.health }),
      })
    }

    // The notice board carries the project's outstanding work, a note per row. An absent or
    // unreadable `TASKS.md` dims the cork instead of hanging the board empty — those were the
    // same picture until now, and they are not the same fact.
    scene.push({
      sortY: depthOf({ x: amenities.noticeBoard.x0, y: amenities.noticeBoard.y1 }),
      draw: () => {
        for (let x = amenities.noticeBoard.x0; x <= amenities.noticeBoard.x1; x++) {
          drawNoticeBoard(ctx, { x, y: amenities.noticeBoard.y0 }, 'south', { notes: this.room.notes })
        }
      },
    })

    // The racks report the harness. Nothing else on this floor can say "the build is broken"
    // without being asked, and a red light in the corner is a thing you notice.
    const state = this.rackState()
    scene.push({
      sortY: depthOf({ x: servers.racks.x0, y: servers.racks.y1 }),
      draw: () => {
        for (let x = servers.racks.x0; x <= servers.racks.x1; x++) {
          drawServerRack(ctx, { x, y: servers.racks.y0 }, 'south', { state })
        }
      },
    })
  }

  /**
   * What the racks are saying.
   *
   * Read from the same task outcomes the name-tag marks use, so the corner of the room and the
   * label over somebody's head can never disagree — one fact rendered twice, not two facts.
   */
  private rackState(): 'idle' | 'busy' | 'fault' {
    for (const outcome of this.outcomes.values()) if (outcome === 'failed') return 'fault'
    return this.scene.cast.some((c) => c.pose === 'working') ? 'busy' : 'idle'
  }

  /**
   * The window in the right-hand wall.
   *
   * Worth drawing rather than leaving the spot unmarked. "The manager comes to the window when
   * you type" is only a gesture if there is visibly a window there — otherwise a character has
   * merely wandered to the edge of the floor and stopped. It is the one piece of the room that
   * says where you are standing.
   *
   * Drawn as light rather than as glass, and that is forced by the camera rather than chosen.
   * The right-hand wall runs north-south, so its face is a plane of constant `x` and projects
   * to a line with no width — there is no pane to paint on. What a raised camera does show of a
   * window is the light coming through it, so that is what is drawn: a bright edge where the
   * wall meets the floor, and a wash across the carpet that falls off with distance.
   *
   * Under the isometric camera this was a quad built from two points that differed only in `y`;
   * projected here those share a screen x, the quad is zero-width, and the window silently drew
   * nothing at all.
   */
  private drawWindow(): void {
    const { ctx, plan } = this
    const wallX = plan.width - 1
    const top = plan.window.y - 1
    const rows = 3

    // The wash. Three tiles deep into the room, brightest at the wall.
    const near = toScreenAt(wallX, top, 0)
    const far = toScreenAt(wallX - 4, top, 0)
    const spill = ctx.createLinearGradient(near.x, 0, far.x, 0)
    spill.addColorStop(0, 'rgb(120 150 220 / 0.16)')
    spill.addColorStop(1, 'rgb(120 150 220 / 0)')
    ctx.fillStyle = spill
    ctx.fillRect(far.x, near.y - TILE_D / 2, near.x - far.x, rows * TILE_D)

    // The opening itself: the lit edge of the wall, at the height a window sits.
    for (let i = 0; i < rows; i++) {
      const at = toScreenAt(wallX, top + i, 0)
      const sill = Math.round(at.y - TILE_D / 2)
      ctx.fillStyle = '#2b3a5c'
      ctx.fillRect(Math.round(at.x - TILE_W / 2), Math.round(sill - WALL_HEIGHT * 18), 3, TILE_D + 2)
      ctx.fillStyle = '#7e93c4'
      ctx.fillRect(Math.round(at.x - TILE_W / 2), Math.round(sill - WALL_HEIGHT * 18), 1, TILE_D + 2)
    }
  }

  private wallFacing(x: number, y: number): Facing {
    const { grid } = this.plan
    // South first, and it is not arbitrary. Under this camera a face of constant `x` projects
    // to a zero-width line, so only a south face has any area at all — a wall tile with floor
    // on two sides that picked `east` would draw a wall nobody can see.
    const looks: readonly (readonly [Facing, number, number])[] = [
      ['south', 0, 1],
      ['east', 1, 0],
      ['west', -1, 0],
      ['north', 0, -1],
    ]

    for (let reach = 1; reach <= 3; reach++) {
      for (const [facing, dx, dy] of looks) {
        if (grid.isWalkable(x + dx * reach, y + dy * reach)) return facing
      }
    }
    // Fully enclosed — a wall nobody can see the face of. Any answer is as good as another.
    return 'south'
  }

  private isDesk(x: number, y: number): boolean {
    const { plan } = this
    if (plan.managerStation.desk.x === x && plan.managerStation.desk.y === y) return true
    return plan.workstations.some((w) => w.desk.x === x && w.desk.y === y)
  }

  /**
   * A desk, its chair, and the monitor on it.
   *
   * One station rather than three props, because they sort as one thing: a monitor is on the
   * desk and the chair is tucked under it, so nothing else can ever come between them. Sorting
   * them separately would be three chances to get the same answer.
   *
   * The chair is pushed in when nobody is standing at the desk, which is the cheapest honest
   * signal on the floor — you can see at a glance who is at their station.
   */
  private drawStation(station: Workstation, isManagers: boolean): void {
    const { ctx } = this
    const tile = station.desk
    const facing = FACE_OF[station.facing]
    const wood = isManagers ? PALETTE.deskWarm : PALETTE.desk

    drawDesk(ctx, tile, facing, { colour: wood })
    drawMonitor(ctx, tile, facing, { z: DESK_TOP, screen: this.screenFor(station.who) })

    // A partition on the right-hand side of every open-floor desk, which turns a row of desks
    // into a row of workstations. The manager has an office and does not need one.
    //
    // Drawn, not planned: the panel sits in the gap column the desk pitch already leaves, so
    // no tile changes state, pathfinding is untouched, and the promise that desks never move is
    // kept. The lattice is broken in the picture rather than in the floor.
    if (!isManagers) {
      // Two heights, and the difference is what makes a pod read as a pod. A low panel between
      // the pair says "you two share this"; a full one on the outer edge says "and that is
      // where it ends". One height everywhere is a fence, which is what the linear row was.
      const insidePod = (tile.x - DESK_ORIGIN_X) % POD_GAP_TILES < POD - 1
      drawPartition(ctx, { x: tile.x + 1, y: tile.y }, facing, {
        height: insidePod ? 0.34 : 0.62,
      })

      // The bench spine, on the seam this desk shares with the one backing onto it. Drawn from
      // the camera-facing side only, so the two desks of a bench get one screen between them
      // rather than two in the same place. Low — a bench screen you see over, not a wall.
      if (station.facing === 'down') {
        drawPartition(ctx, tile, facing, { runs: 'along', back: -0.5, height: 0.3 })
      }
    }

    // The bin, against whichever side of the desk is open floor. Drawn at an offset rather than
    // on the free tile: the cat stands there, and a walkable tile is where a person walks.
    //
    // It is full when nothing about this person's work has been run — see `nothingRan`. That is
    // `PLAN.md`'s fourth reporting prop, and it is the only thing on this floor that can say
    // "nobody has checked this", which the monitor cannot: a dark screen means not working now,
    // and those are different facts about different moments.
    const side = this.freeSide(station)
    if (side !== null) {
      const outcome = this.outcomes.get(station.who)
      drawWastebasket(ctx, tile, facing, {
        // Negated: a positive `across` moves a prop toward *smaller* x, and `side` is a tile
        // delta where -1 is the smaller neighbour. Passing it through unnegated put the bin in
        // the desk next door rather than in the aisle, on every station — caught by the test
        // that checks the offset direction, which is why that test asserts a direction at all.
        across: -side * 0.62,
        full: outcome !== undefined && nothingRan(outcome),
      })
    }
  }

  /**
   * Where the cat is, or `null` on a floor too small to have one.
   *
   * Beside its owner's desk, in whichever of the two neighbouring columns is actually free —
   * the bench layout puts an aisle on one side of every desk and another desk on the other, and
   * which side that is depends on where in the bench you sit. A cat drawn inside a desk is a
   * cat nobody can see.
   */
  private petTile(): Tile | null {
    const owner = this.plan.petOwner
    if (!owner) return null
    const station = this.plan.workstations.find((w) => w.who === owner)
    if (!station) return null
    const dx = this.freeSide(station)
    return dx === null ? null : { x: station.desk.x + dx, y: station.desk.y }
  }

  /**
   * Which side of a desk is open floor: `-1`, `1`, or `null` when neither is.
   *
   * The bench layout puts an aisle on one side of every desk and another desk on the other, and
   * which side that is depends on where in the bench you sit. Two props need this — the cat
   * stands on that tile and the bin is drawn against it — and they must agree, because a second
   * copy of this rule is how one of them ends up inside a desk.
   */
  private freeSide(station: Workstation): -1 | 1 | null {
    for (const dx of [-1, 1] as const) {
      if (this.plan.grid.isWalkable(station.desk.x + dx, station.desk.y)) return dx
    }
    return null
  }

  /** Whether anybody is standing on this tile right now. Chairs are pushed in when nobody is. */
  private standingAt(tile: Tile): boolean {
    return this.scene.cast.some((c) => {
      const t = tileOf(c.walker.position)
      return Math.abs(t.x - tile.x) < 0.6 && Math.abs(t.y - tile.y) < 0.6
    })
  }

  /** Whether anybody is actually standing at this station right now. */
  private isSeated(station: Workstation): boolean {
    const member = this.scene.cast.find((c) => c.who === station.who)
    if (!member) return false
    const t = tileOf(member.walker.position)
    return Math.abs(t.x - station.seat.x) < 0.6 && Math.abs(t.y - station.seat.y) < 0.6
  }

  /**
   * What is on an employee's screen.
   *
   * Bound to what they are actually doing, not to whether they exist — a lit screen at an
   * empty desk is the floor claiming work that is not happening, which is the one thing this
   * project refuses to ship.
   */
  private screenFor(who: string): 'dark' | 'lit' | 'alert' {
    if (this.outcomes.get(who) === 'failed') return 'alert'
    const member = this.scene.cast.find((c) => c.who === who)
    return member?.pose === 'working' ? 'lit' : 'dark'
  }

  private drawCharacter(member: Cast): void {
    const { ctx } = this
    const facing: Direction = member.walker.facing
    const source: PaintDirection = facing === 'left' ? 'right' : facing
    const step = member.walker.isMoving
      ? (WALK_CYCLE[Math.floor(member.phase / FRAME_MS) % WALK_CYCLE.length] ?? 0)
      : 0

    const bitmap = member.art[source]?.[step]
    if (!bitmap) return

    const foot = screenOf(member.walker.position)
    const x = Math.round(foot.x - member.spriteW / 2)
    // Typing is a one-pixel rock of the whole figure on the keystroke beat.
    //
    // A pixel is the entire budget here: the cast is fourteen pixels across and has no arms to
    // animate, so the only thing that can move without redrawing the sprite is the sprite. It
    // reads at 2x because everything around it is nailed to the tile grid — a person who is not
    // perfectly still in a room where everything else is, is a person doing something.
    const typing = member.pose === 'working' && !member.walker.isMoving
    const y = Math.round(foot.y - member.spriteH) - (typing ? this.keyBeat : 0)

    // The contact shadow, lying in the ground plane. It was already here — it is the ellipse
    // that stops everyone looking pasted on — but it was drawn one pixel high of the feet to
    // reach a cast that turned out to be floating, and round rather than 2:1 so it did not lie
    // flat on a floor that had no perspective to lie flat in. Both fixed.
    ctx.fillStyle = 'rgb(0 0 0 / 0.28)'
    ctx.beginPath()
    ctx.ellipse(foot.x, foot.y, 6, 3, 0, 0, Math.PI * 2)
    ctx.fill()

    if (facing === 'left') {
      // Left is right, mirrored — the painter draws three directions and the fourth is free.
      ctx.save()
      ctx.translate(x + member.spriteW, y)
      ctx.scale(-1, 1)
      ctx.drawImage(bitmap, 0, 0)
      ctx.restore()
    } else {
      ctx.drawImage(bitmap, x, y)
    }
  }

  private drawLabel(member: Cast): void {
    const { ctx } = this
    ctx.font = '5px ui-monospace, monospace'
    ctx.textAlign = 'center'
    // Clamped to the space a desk actually owns, with the marks on either side kept out of it.
    // Six desks across the room means neighbouring names are a desk apart, and a name wider
    // than its desk does not overflow into empty space — it overlaps the person next to it,
    // and two half-legible names are worse than one truncated one.
    // Widths are measured against the **pod**, not the desk. Desks inside a pod sit one tile
    // apart, so pitching the label to that clipped every name to about four characters the
    // moment the layout became pods — 'Revie…', 'ronte…'. A pod is four tiles including its
    // gap, and two names can share that width because they are staggered, below.
    const text = ellipsise(
      member.label,
      labelWidthFor(POD_GAP_TILES * TILE_W),
      (t) => ctx.measureText(t).width,
    )
    const width = ctx.measureText(text).width + 4
    const foot = screenOf(member.walker.position)
    const x = foot.x

    // At a desk the name goes **on the desk**, not above the head.
    //
    // Above the head is right for somebody crossing the room and wrong for somebody sitting in
    // a grid: rows of pods sit back to back, so a tag floating over one person lands on the
    // desk of the person behind them. Every dense arrangement collided — first with the
    // fixtures, then with each other.
    //
    // On the desk front it cannot collide with anything, because a desk is exactly the width
    // its own name needs and there is one per person. It is also where a real office puts a
    // nameplate, which is the sort of agreement worth taking when it is offered.
    const station = this.plan.workstations.find((w) => w.who === member.who)
    const seated = station ? tileOf(member.walker.position).y === station.seat.y : false
    const y = seated ? foot.y + TILE_D - 3 : foot.y - member.spriteH - 5

    // Opaque, and with a lit top edge. The desk rows sit at the same screen height as the
    // shelves and server racks behind them, so a translucent plate let the rack show *through*
    // the letters — which is what made the names read as text scattered on furniture rather
    // than as tags in front of it. Nothing here dodges or reflows; the plate simply stops being
    // see-through, and the edge gives it a front face so it sits in the room's light.
    ctx.fillStyle = '#0b0e17'
    ctx.fillRect(x - width / 2, y - 5, width, 7)
    ctx.fillStyle = '#232a3d'
    ctx.fillRect(x - width / 2, y - 5, width, 1)
    ctx.fillStyle = member.isManager ? '#e8b25e' : '#b9c0d0'
    ctx.fillText(text, x, y)

    // Right of the name: what they are doing this second.
    if (member.pose === 'working') {
      ctx.fillStyle = '#e8b25e'
      ctx.fillRect(x + width / 2 + 1, y - 4, 2, 2)
    }

    // Left of the name: how their outstanding work stands. Two different questions — "busy
    // right now" and "is any of it verified" — so two different marks, and they must not be
    // mistaken for each other.
    const outcome = this.outcomes.get(member.who)
    const colour = outcome ? OUTCOME_COLOUR[outcome] : null
    if (colour) {
      ctx.fillStyle = colour
      ctx.fillRect(x - width / 2 - 3, y - 4, 2, 2)
    }
  }

  /**
   * Fly the clicked office up to fill the stage, then hand over to the real floor.
   *
   * Clicking an office should animate going inside the project: a zoom in, and deliberately not
   * a flourish. So: one transform, 220ms, no bounce.
   *
   * Done with a DOM overlay holding the thumbnail rather than by animating the canvas, and the
   * reason is that the canvas is about to be resized and repainted for a completely different
   * view. Animating it would mean interpolating the campus and the office in the same buffer,
   * every frame, on the render path this whole feature exists to keep cheap. A positioned copy
   * of a bitmap is composited by the browser and costs the render loop nothing.
   *
   * Resolves when it is over — or immediately, if the person has asked their system for reduced
   * motion. That is not a nicety: a zoom is exactly the kind of movement that setting exists to
   * refuse, and the destination is identical either way.
   */
  private zoomInto(card: CampusCard): Promise<void> {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return Promise.resolve()

    // `thumbFor`, not `thumbs.get`. A card can be clicked before it has ever been painted — a
    // project scrolled into view and clicked in the same gesture, or a window that was hidden
    // while the campus opened, where `requestAnimationFrame` never ran and nothing was drawn at
    // all. Reaching into the cache and giving up on a miss makes the animation depend on draw
    // order; painting on demand makes it depend on nothing.
    //
    // The same picture the card was painted with. A card with none has nothing to fly; the click
    // still lands.
    const picture = pictureOf(card.office)
    if (picture === null) return Promise.resolve()
    const thumb = this.thumbFor(picture)
    if (thumb.width === 0) return Promise.resolve()

    const canvasBox = this.canvas.getBoundingClientRect()
    const stageBox = this.stage.getBoundingClientRect()
    const w = card.rect.x1 - card.rect.x0
    const h = card.rect.y1 - card.rect.y0

    const flier = document.createElement('canvas')
    flier.width = thumb.width
    flier.height = thumb.height
    flier.getContext('2d')?.drawImage(thumb, 0, 0)
    flier.className = 'flier'
    // Positioned against the viewport, from where the card actually is on screen — which
    // accounts for the campus being scrolled, since the canvas box moves with it.
    flier.style.left = `${canvasBox.left + card.rect.x0 * this.scale}px`
    flier.style.top = `${canvasBox.top + card.rect.y0 * this.scale}px`
    flier.style.width = `${w * this.scale}px`
    flier.style.height = `${h * this.scale}px`
    document.body.appendChild(flier)

    // Grow to whatever the office is about to occupy, which is the stage. Not to the office's
    // final pixel size: that is only known after `fit()` runs, and running it first would swap
    // the view out from under the thing we are animating away from.
    const scale = Math.min(stageBox.width / (w * this.scale), stageBox.height / (h * this.scale))
    const dx = stageBox.left + stageBox.width / 2 - (canvasBox.left + (card.rect.x0 + w / 2) * this.scale)
    const dy = stageBox.top + stageBox.height / 2 - (canvasBox.top + (card.rect.y0 + h / 2) * this.scale)

    return new Promise((done) => {
      // One frame between appending and transforming, or the browser collapses both styles into
      // one computation and there is no transition to run.
      requestAnimationFrame(() => {
        flier.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`
        flier.style.opacity = '0.15'
      })

      const finish = () => {
        flier.remove()
        done()
      }
      flier.addEventListener('transitionend', finish, { once: true })
      // A transition that never fires an event — an interrupted style recalculation, a hidden
      // window — must not leave the overlay on screen forever with the office behind it.
      window.setTimeout(finish, ZOOM_MS + 120)
    })
  }

  private pick(event: MouseEvent): void {
    if (this.campus) {
      // Campus space is pixels, and the campus is drawn at 1:1 — so undoing the scale is the
      // whole conversion. It used to divide by TILE_W and TILE_D as well, because cards were
      // laid out in tiles; doing that now would put every click a whole office to the left.
      const rect = this.canvas.getBoundingClientRect()
      const x = (event.clientX - rect.left) / this.scale
      const y = (event.clientY - rect.top) / this.scale
      const card = cardAt(this.cards, x, y)
      if (card) void this.zoomInto(card).then(() => this.callbacks.onPickProject(card.office.id))
      return
    }
    this.pickCharacter(event)
  }

  private pickCharacter(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect()
    // Into the same space the canvas draws in: undo the scale, then the offset `fit` baked
    // into the transform. Miss the offset and every click lands half a floor away.
    const fx = (event.clientX - rect.left) / this.scale - this.bounds.offsetX
    const fy = (event.clientY - rect.top) / this.scale - this.bounds.offsetY

    // Tested against each character's projected box rather than by inverting the click to a
    // tile: a character is taller than a tile is deep and stands *in front of* the tile its feet
    // are on, so the tile under the pointer is frequently not the tile of the person being
    // pointed at.
    //
    // Nearest hit wins, front to back, so an overlapping pair picks the one in front.
    const hit = [...this.scene.cast]
      .map((c) => ({ c, at: screenOf(c.walker.position), t: tileOf(c.walker.position) }))
      .sort((a, b) => depthAt(b.t.y) - depthAt(a.t.y))
      .find(
        ({ c, at }) =>
          Math.abs(fx - at.x) <= c.spriteW / 2 && fy <= at.y && fy >= at.y - c.spriteH,
      )?.c

    if (hit) {
      this.callbacks.onPick(hit.who)
      return
    }

    // The lounge is the music section.
    //
    // The brief asked for a relaxing section you can click to play something. It is this one
    // rather than a new room: the lounge already exists, people already go there on a break,
    // and inventing a fourth room in a fourteen-tile band is exactly the clutter the floorplan
    // rework just removed.
    //
    // What the click *does* changed once real music arrived: clicking the sofa is not very
    // intuitive. That is right, and the fix is not to remove the shortcut but to stop
    // it being the whole feature — it now opens the controller, which is discoverable, has a
    // search box and says what is playing. A shortcut is allowed to be obscure; it is not
    // allowed to be the only door.
    //
    // The generated drone stays as the fallback for a machine with no Spotify account: with no
    // controller wired, this is still a room you can click to change the mood of, and that is
    // the clone-and-run answer laptop 1 signed off on.
    if (this.hitLounge(fx, fy)) {
      if (this.callbacks.onPickMusic) this.callbacks.onPickMusic()
      else this.stereo.toggle()
      this.invalidate()
      return
    }

    // Clicking the floor itself is how you stop asking. A bubble nobody dismissed sits there
    // claiming to be current until the situation changes, which may be a while on a quiet
    // office.
    this.dismiss()
  }

  /**
   * Whether a click landed on the lounge.
   *
   * Tested against the sofa and its rug as one region, in tile space, because that is the
   * section as a person sees it — the rug is what makes the sofa a *place* rather than a piece
   * of furniture, and somebody aiming at "the music corner" aims at the middle of it.
   */
  private hitLounge(fx: number, fy: number): boolean {
    const { sofa, rug } = this.plan.lounge
    const x0 = Math.min(sofa.x0, rug.x0)
    const x1 = Math.max(sofa.x1, rug.x1)
    const y0 = Math.min(sofa.y0, rug.y0)
    const y1 = Math.max(sofa.y1, rug.y1)
    const tile = { x: fx / TILE_W, y: fy / TILE_D }
    return tile.x >= x0 && tile.x <= x1 + 1 && tile.y >= y0 && tile.y <= y1 + 1
  }
}

/**
 * The tile a walker is standing on, as a continuous coordinate.
 *
 * The half-tile trap, and it is worth the function rather than the inline arithmetic: walkers
 * carry a pixel position from `tileToPixel`, which centres x within the tile but anchors y at
 * the tile's *bottom edge* — because sprites hang from their feet. Dividing both by the tile
 * size, which is the obvious thing to write, puts everybody half a tile off their diamond in
 * one axis and a whole tile off in the other.
 */
function tileOf(p: Pixel): { readonly x: number; readonly y: number } {
  return { x: p.x / TILE_SIZE - 0.5, y: p.y / TILE_SIZE - 1 }
}

/** Where a walker's feet land on screen. */
function screenOf(p: Pixel): Pixel {
  const t = tileOf(p)
  return toScreenAt(t.x, t.y)
}

