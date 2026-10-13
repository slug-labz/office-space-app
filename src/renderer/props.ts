/**
 * Office furniture, drawn.
 *
 * Pure drawing, and nothing else. Every function takes a context, a tile and some options,
 * and paints. Nothing here stores state, reads a pixel back, or touches the DOM — which is
 * what makes furniture testable: a fake surface that records rectangles is a complete
 * substitute for a canvas, and `test/props.test.ts` is written against one.
 *
 * ## Two faces, not three
 *
 * The camera in `projection.ts` is axis-aligned: it tilts from above and does not rotate. A
 * plane of constant `y` projects to a rectangle and a plane of constant `x` projects to a
 * **line** — so a box has exactly two faces with any area in it, the lid and the `+y` wall,
 * and the two side walls the isometric camera used to give away for free are gone.
 *
 * That is the whole reason this file was rewritten rather than renamed. Two flat tones read as
 * a sticker; the missing third value is put back as {@link Shades.side}, a one-pixel column
 * down the shaded edge of the front face. It is not a projected face and does not pretend to
 * be one — it is the pixel-art substitute for the corner the camera cannot show, and a box
 * without it looks like a swatch.
 *
 * ## Only `fillRect`, and now only rectangles
 *
 * Every face is an axis-aligned rectangle, so the scan-converter the isometric version needed
 * is gone with the diamonds. Each face rounds its own four edges and paints one `fillRect`.
 * Two faces that share an edge round the same number from the same arithmetic, so they abut to
 * the pixel with no seam and no double-paint — the property the old span filler existed to
 * buy, for a tenth of the code.
 *
 * ## Facing
 *
 * The floor no longer turns under the camera, so the four edges of a tile are the four
 * compass points and nothing has to be translated:
 *
 * ```
 *              north  (−y, away from the camera)
 *        ┌───────────────┐
 *   west │               │ east
 *   (−x) │               │ (+x)
 *        └───────────────┘
 *              south  (+y, towards the camera)
 * ```
 *
 * A prop's `facing` is **the way its front points**. A chair's front is the way the sitter
 * looks. A wall's front is the face you can see, so the wall sits on the *opposite* edge of
 * its tile. A desk's front is the side the room sees — its modesty panel — so whoever uses it
 * sits on the far side and looks the way the desk faces, which is why a workstation hands the
 * same facing to its desk and its chair.
 *
 * `south` is the only facing whose front the camera can see. A prop facing anywhere else shows
 * you its back or its edge, and details that live on the front — a screen, a shelf's books —
 * are correctly not drawn. That is the projection being honest, not a gap.
 *
 * ## What this module does not do
 *
 * It does not sort props against each other, and it does not know where the floor is on
 * screen. Both belong to the renderer: it translates the context by `viewBounds` once, and
 * orders whole props with `depthOf`. Parts *within* one prop are sorted here, because only
 * this module knows a chair has a post under its seat.
 */

import { depthAt, toScreenAt } from '../shared/floor/projection.js'
import type { Tile } from '../shared/floor/geometry.js'
import type { Palette } from '../shared/palette.js'

/**
 * The office's colours.
 *
 * Sampled from `floor-view.ts` rather than chosen — the plan-view room is already a deep
 * indigo office and the drawn one has to be the same room. Every value here appears verbatim
 * in that file; nothing new was invented, and anything lighter or darker than these is derived
 * by {@link tint} or {@link mix} rather than picked by eye.
 */
/**
 * The room's colours, and **the object identity is the contract**.
 *
 * Every call site reads `PALETTE.something` at draw time rather than capturing it, so swapping
 * the interface theme is a matter of writing new values into this object — the fifty reads
 * across this file pick them up on the next frame with no re-import and no cache to clear.
 * Replacing the object would break every module holding a reference to the old one, which is
 * why {@link applyRoomPalette} assigns fields instead.
 *
 * It is not `as const` any more for exactly that reason. The values are still the same values;
 * they are simply no longer a promise that they will never change.
 */
export const PALETTE: {
  floor: string
  wall: string
  wallInner: string
  desk: string
  deskWarm: string
  chairFrame: string
  chairSeat: string
  monitor: string
  screenDark: string
  screenLit: string
  screenAlert: string
  shelf: string
  shelfInside: string
  books: string[]
  pot: string
  leafHealthy: string
  leafDying: string
  /**
   * Four interface colours the campus needs, kept here rather than read from CSS.
   *
   * A canvas needs a colour string and `getComputedStyle` gives one — but per draw call, on the
   * hot path, and only after the stylesheet has applied. These arrive from the same `Palette`
   * object that fills the room, at the same moment, which is what stops the campus's chrome and
   * the interface drifting the way `styles.css` and `props.ts` used to.
   */
  ink: string
  inkDim: string
  accent: string
  /**
   * The role colour for something that has stopped and wants a person.
   *
   * A fourth, and it arrives the same way the other three do rather than being picked here.
   * `accent` already means "this is happening"; the campus needed a second mark for "this is
   * waiting on you", and the two must not be the same colour or the distinction is drawn and
   * cannot be seen. Both shipped palettes define `warn` as a role, so this is the design
   * system's own answer rather than a literal chosen for one card.
   */
  warn: string
} = {
  /** Carpet. The second tone is this one through {@link WEAVE}. */
  floor: '#2e2a3d',
  /** The outer wall. Darker than the carpet on purpose: it is the edge of the world, not a surface. */
  wall: '#1b2030',
  /**
   * Interior masonry — the manager's office, the meeting room.
   *
   * A step *lighter* than the carpet, where the outer wall is several steps darker, and the
   * difference is the whole reason the rooms now read as rooms. A wall with a room on each side
   * of it is a thing standing in the light; drawn in the boundary's colour it reads as a hole in
   * the floor, which is what prompted the report that the walls looked weird.
   */
  wallInner: '#3a3550',
  desk: '#3b3348',
  /** The manager's desk, which floor-view already draws a shade warmer than everyone else's. */
  deskWarm: '#4a3a55',
  /** Chair legs and post. The wall's colour, because a chair base is the darkest thing in a room. */
  chairFrame: '#1b2030',
  /** Upholstery. floor-view's dusk blue, which is the only colour in the room that is a fabric. */
  chairSeat: '#2b3a5c',
  monitor: '#151a26',
  screenDark: '#252c40',
  /** The lamp colour on a monitor's face — the light in the window. */
  screenLit: '#6d7ea8',
  screenAlert: '#e0685f',
  shelf: '#3b3348',
  shelfInside: '#2a2438',
  books: ['#7f9ec4', '#c4a97f', '#9ec47f', '#c47f9e', '#7fc4bd'],
  pot: '#c4a97f',
  leafHealthy: '#9ec47f',
  ink: '#e6e3dd',
  inkDim: '#98a0b3',
  accent: '#e8b25e',
  // `night-shift`'s own `warn`. A starting value only — `applyPalette` overwrites it with the
  // live theme's, the same as the three above it.
  warn: '#c47f9e',
  leafDying: '#e8b25e',
}

/**
 * Point the room at a palette.
 *
 * This is the payoff for `src/shared/palette.ts` existing: the interface and the room stop being
 * two lists that nearly agree and become one list with two consumers. Switch the theme and the
 * carpet moves with the buttons.
 *
 * **What is derived and what is not is the interesting part.** Carpet, masonry, wood and
 * upholstery come from `room` — they are surfaces, and a syntax theme has no opinion about a
 * surface. Everything that *means something* is derived from `syntax` and `roles`: a lit screen
 * is the function colour because a lit screen is the office saying work is happening, an alert
 * screen is `bad`, a healthy plant is `string`, and the book spines are the five syntax hues
 * because a shelf of skills is exactly the "keep five things apart at eight pixels" problem a
 * syntax theme already solved.
 *
 * So the rule a new theme is authored against is: **if a colour reports something, it is
 * derived; if it is just a surface, name it in `room`.**
 */
export function applyRoomPalette(p: Palette): void {
  PALETTE.ink = p.ink
  PALETTE.inkDim = p.inkDim
  PALETTE.accent = p.roles.accent
  PALETTE.warn = p.roles.warn
  PALETTE.floor = p.room.floor
  PALETTE.wall = p.room.wall
  PALETTE.wallInner = p.room.wallInner
  PALETTE.desk = p.room.desk
  PALETTE.deskWarm = p.room.deskWarm
  // A chair base is the darkest thing in a room, which is what the outer wall already is.
  PALETTE.chairFrame = p.room.wall
  PALETTE.chairSeat = p.room.fabric
  PALETTE.shelf = p.room.desk
  PALETTE.shelfInside = tint(p.room.desk, 0.72)
  PALETTE.pot = p.room.pot

  // A screen off is a surface; a screen on is a claim. Hence one from `ground` and two from the
  // palette's meanings.
  PALETTE.monitor = p.ground[0]
  PALETTE.screenDark = p.ground[3]
  PALETTE.screenLit = mix(p.syntax.func, p.ground[1], 0.22)
  PALETTE.screenAlert = p.roles.bad

  // Five spines, five syntax hues, one shared constraint: stay apart from each other. The pot
  // colour takes the middle slot because a shelf of five blues is a shelf of one book.
  PALETTE.books = [p.syntax.func, p.room.pot, p.syntax.string, p.syntax.keyword, p.syntax.type]

  PALETTE.leafHealthy = p.syntax.string
  PALETTE.leafDying = p.roles.accent
}

/**
 * How much lighter a box's lid is than its front, and how much darker its shaded edge.
 *
 * These two numbers are not taste. floor-view.ts already picks its highlight and shadow by
 * hand — `#3b3348` for a desk body, `#4a4059` for the lit edge, `#2a2438` for the shadow —
 * and 1.25 / 0.71 reproduce that pair from the body colour alone, to within a level or two.
 * Deriving them means a new piece of furniture cannot drift out of the family.
 */
const TOP = 1.25
const SHADE = 0.71

/**
 * The two steps that are not shading — they are silhouette.
 *
 * A desk is a box until its top surface is brighter than any box's and its supports are darker
 * than any box's shadow. At 32×20 there is no room to draw a leg in detail, so the only thing
 * that separates furniture from freight is the value gap between the surface you put things on
 * and the dark underneath it. `LID` is a step above `TOP`; `UNDER` is far enough below `SHADE`
 * that a leg reads against the shaded edge of the thing it holds up.
 */
const LID = 1.45
const UNDER = 0.42

/**
 * How dark the floor goes under a piece of furniture.
 *
 * One step, and hard-edged, because there is no alpha here and a two-step shadow reads as a
 * hole in the carpet. It earns its place twice over: a chair with no shadow floats at whatever
 * height its seat is drawn, which is the exact complaint this rewrite started from — and the
 * renderer does not carpet the tiles it has marked unwalkable, so a desk with an overhang and
 * no shadow shows the backdrop through the gap between its legs.
 */
const SHADOW = 0.72

/**
 * The carpet's second tone.
 *
 * 0.93 turns `#2e2a3d` into `#2b2739` exactly — floor-view's own pair. Two tones this close
 * read as weave; any further apart and the floor becomes a chessboard.
 */
const WEAVE = 0.93

/**
 * The slice of a canvas this module needs.
 *
 * Declared structurally rather than as `CanvasRenderingContext2D` for one concrete reason:
 * the root `tsconfig.json` deliberately leaves the DOM library out so that main-process code
 * reaching for `document` fails to compile. A test importing this module pulls it into that
 * program, where the DOM type does not exist. Naming the two members we actually use costs
 * nothing at the call site — a real 2D context satisfies it — and keeps the furniture
 * checkable from both configs.
 *
 * `fillStyle` is loose because the real context declares gradients and patterns there too,
 * and a `string`-only field would refuse the very object this module exists to draw on. We
 * only ever write CSS colour strings to it.
 */
export interface Surface {
  fillStyle: string | object
  fillRect(x: number, y: number, w: number, h: number): void
}

/** Which of a tile's four edges a thing faces. See the module docblock. */
export type Facing = 'north' | 'east' | 'south' | 'west'

/**
 * Where a prop stands, in tiles.
 *
 * Fractional, and `Tile` deliberately is not: a two-tile meeting table is centred on the line
 * between two tiles, so its anchor is `x + 0.5`. Every call site that has a real tile passes
 * one — `Tile` satisfies this — and the handful that span tiles compute a midpoint instead of
 * lying about the grid.
 */
export interface Anchor {
  readonly x: number
  readonly y: number
}

/** The step from a tile to the neighbour its front points at. */
const FACING_STEP: Readonly<Record<Facing, Tile>> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
}

const OPPOSITE: Readonly<Record<Facing, Facing>> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
}

/** A rectangle of floor in tile units. Fractional: furniture is not tile-sized. */
export interface Footprint {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/**
 * One face, in screen pixels, before rounding.
 *
 * A rectangle rather than four corners, because under this camera every face is one. The old
 * quad existed to carry the diamonds an isometric floor is made of, and there are none left.
 */
export interface Face {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/** The two faces of a box the camera can see. The other four are always hidden. */
export interface BoxFaces {
  /** The lid, at `z + height`. Lightest. */
  readonly top: Face
  /** The `+y` wall — the only vertical face with any width in this projection. */
  readonly front: Face
}

/** One colour per visible face, plus the edge that stands in for the ones that are not. */
export interface Shades {
  readonly top: string
  readonly front: string
  /** The one-pixel column down the `−x` edge of the front face. See the module docblock. */
  readonly side: string
}

/**
 * Where a part sits, in the local frame of whatever is facing somewhere.
 *
 * `across` runs along the front, positive towards the prop's own left; `back` runs away from
 * the front. Both are in tiles, measured from the anchor, so a desk leg is `across: -0.42,
 * back: -0.31` no matter which way the desk is turned.
 */
export interface LocalRect {
  /** Size along the front. */
  readonly width: number
  /** Size away from the front. */
  readonly depth: number
  readonly across?: number
  readonly back?: number
}

/** Everything {@link drawBox} needs. Heights are in `z` units — one is `TILE_RISE` pixels. */
export interface BoxSpec extends LocalRect {
  readonly height: number
  /** Floor of the box. Defaults to standing on the ground. */
  readonly z?: number
  /** Which way `across` and `back` point. Defaults to `south`, the camera-facing edge. */
  readonly facing?: Facing
  /** The front face's colour; the other two are derived from it. */
  readonly colour: string
  /** Overrides the derivation, for the few surfaces that are not one material. */
  readonly shades?: Shades
  /**
   * Whether to paint the shaded edge column.
   *
   * Off for anything drawn in a run against a copy of itself: a wall beveled once per tile
   * comes out striped, and the stripes are exactly a tile apart, which reads as a mistake in
   * the tiling rather than as shading.
   */
  readonly edge?: boolean
}

// ────────────────────────────────────────────────────────────────── colour ────

/** The three channels of a `#rrggbb` string. Only that form; nothing else is ever passed. */
function channels(colour: string): readonly [number, number, number] {
  return [
    parseInt(colour.slice(1, 3), 16),
    parseInt(colour.slice(3, 5), 16),
    parseInt(colour.slice(5, 7), 16),
  ]
}

function toHex(r: number, g: number, b: number): string {
  const byte = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

/**
 * The same colour, brighter or darker.
 *
 * A flat multiply on each channel, which keeps the hue and therefore keeps the room one room.
 * Clamped rather than renormalised: a face that would overflow to white is a face that was
 * given too bright a base, and quietly desaturating it hides that.
 */
export function tint(colour: string, factor: number): string {
  const [r, g, b] = channels(colour)
  return toHex(r * factor, g * factor, b * factor)
}

/** A blend of two colours, `t = 0` giving the first. Used for things that change state. */
export function mix(from: string, to: string, t: number): string {
  const k = Math.max(0, Math.min(1, t))
  const [r0, g0, b0] = channels(from)
  const [r1, g1, b1] = channels(to)
  return toHex(r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k)
}

/**
 * One material's three values.
 *
 * The base colour is the *front* rather than the top, so that a colour lifted straight out of
 * floor-view.ts lands on the face it was chosen for. The edge is dark rather than light
 * because the window is on `+x` — see `drawWindow` in floor-view.ts, which spills light back
 * across the carpet from the same wall — so it is the `−x` corner that turns away from it.
 */
export function shadesOf(base: string): Shades {
  return { top: tint(base, TOP), front: base, side: tint(base, SHADE) }
}

// ──────────────────────────────────────────────────────────────── geometry ────

/**
 * Where a part's footprint lands on the floor.
 *
 * The whole of the facing logic lives here: `across` runs along the front and `back` away
 * from it, and turning the prop rotates both. Which of the two tile axes ends up carrying the
 * width and which the depth swaps with the quarter turn, which is why the extents are built
 * from the axis vectors rather than assigned.
 */
export function footprintOf(anchor: Anchor, facing: Facing, rect: LocalRect): Footprint {
  const f = FACING_STEP[facing]
  // The across axis is the facing turned a quarter turn — the same rotation for all four, so
  // that `across: -0.42` stays the same leg of the desk however the desk is turned.
  const ax = -f.y
  const ay = f.x

  const across = rect.across ?? 0
  const back = rect.back ?? 0
  const cx = anchor.x - f.x * back + ax * across
  const cy = anchor.y - f.y * back + ay * across

  const hx = (Math.abs(f.x) * rect.depth + Math.abs(ax) * rect.width) / 2
  const hy = (Math.abs(f.y) * rect.depth + Math.abs(ay) * rect.width) / 2

  return { x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy }
}

/**
 * The two visible faces of a cuboid, projected.
 *
 * Three of the eight corners are enough: the lid is the footprint at `z + height`, and the
 * front is the same span of `x` hanging off the lid's near edge down to the floor. The other
 * five corners are either hidden or project onto a line.
 */
export function boxFaces(footprint: Footprint, z: number, height: number): BoxFaces {
  const { x0, y0, x1, y1 } = footprint
  const lid = z + height

  const back = toScreenAt(x0, y0, lid)
  const near = toScreenAt(x1, y1, lid)
  const foot = toScreenAt(x1, y1, z)

  return {
    top: { x0: back.x, y0: back.y, x1: near.x, y1: near.y },
    front: { x0: back.x, y0: near.y, x1: near.x, y1: foot.y },
  }
}

/**
 * One face, painted.
 *
 * Rounding each edge rather than the position and the size is what makes neighbouring shapes
 * tile: a boundary two faces share is the same number rounded the same way in both, so they
 * meet exactly and neither leaves a seam nor paints twice.
 */
function fillFace(ctx: Surface, face: Face, colour: string): void {
  const x = Math.round(face.x0)
  const y = Math.round(face.y0)
  const w = Math.round(face.x1) - x
  const h = Math.round(face.y1) - y
  if (w <= 0 || h <= 0) return

  ctx.fillStyle = colour
  ctx.fillRect(x, y, w, h)
}

// ──────────────────────────────────────────────────────────────── the props ────

/**
 * The primitive everything else is made of.
 *
 * Lid, front, and a one-pixel shaded edge, always. A box painted in one colour reads as a flat
 * rectangle, and no amount of detail on top of it recovers the depth.
 *
 * The faces abut exactly rather than overlapping, so the order they are painted in does not
 * matter and is not relied on.
 */
export function drawBox(ctx: Surface, anchor: Anchor, box: BoxSpec): void {
  const shades = box.shades ?? shadesOf(box.colour)
  const { top, front } = boxFaces(footprintOf(anchor, box.facing ?? 'south', box), box.z ?? 0, box.height)

  if (box.edge === false) {
    fillFace(ctx, front, shades.front)
  } else {
    // Split rather than overpainted, so that no pixel of a box is ever written twice — which
    // is a property the tests check and translucency would otherwise expose as a stripe.
    const seam = Math.min(Math.round(front.x0) + 1, Math.round(front.x1))
    fillFace(ctx, { ...front, x1: seam }, shades.side)
    fillFace(ctx, { ...front, x0: seam }, shades.front)
  }

  fillFace(ctx, top, shades.top)
}

/**
 * The parts of one piece of furniture, in the order they must be painted.
 *
 * Height first, nearness second. Within a single prop the parts stack far more often than
 * they stand side by side — a seat on a post on a base, a lid on its legs — and sorting by
 * nearness alone paints the base over the foot of the post standing on it. Nearness still
 * settles parts at the same height, which is what puts a chair's arms in front of its back.
 *
 * The limit of the rule is worth knowing: two parts at *different* heights standing side by
 * side would come out in the wrong order. That is why the modesty panel below runs to the
 * floor rather than hanging off the underside of the desk.
 */
function drawParts(ctx: Surface, anchor: Anchor, parts: readonly BoxSpec[]): void {
  const order = [...parts].sort((a, b) => {
    const byHeight = (a.z ?? 0) - (b.z ?? 0)
    return byHeight !== 0 ? byHeight : nearness(anchor, a) - nearness(anchor, b)
  })
  for (const part of order) drawBox(ctx, anchor, part)
}

/** How close a part's near edge comes to the camera. */
function nearness(anchor: Anchor, part: BoxSpec): number {
  return depthAt(footprintOf(anchor, part.facing ?? 'south', part).y1, part.z ?? 0)
}

/**
 * The face a prop's front presents to the camera, or `null` when it is turned away.
 *
 * Anything drawn *on* a front — a screen, the inside of a shelf — is a flat rectangle in that
 * plane rather than a box proud of it, so it cannot z-fight with the face it decorates.
 *
 * Only `south` returns anything. `east` and `west` fronts are planes of constant `x`, which
 * this camera projects to a line of zero width; there is nothing to draw on them, and a prop
 * that quietly drew its details on the nearest face instead would be pointing its screen at
 * the wrong person.
 */
function frontOf(anchor: Anchor, facing: Facing, rect: LocalRect & { z: number; height: number }): Face | null {
  if (facing !== 'south') return null
  return boxFaces(footprintOf(anchor, facing, { ...rect, depth: 0 }), rect.z, rect.height).front
}

/** The dark the carpet goes under a prop, painted before the prop itself. */
function drawShadow(ctx: Surface, anchor: Anchor, rect: LocalRect, facing: Facing = 'south'): void {
  fillFace(ctx, boxFaces(footprintOf(anchor, facing, rect), 0, 0).top, tint(PALETTE.floor, SHADOW))
}

/** The anchor of a prop `length` tiles long, given the first tile of its run. */
function spread(tile: Tile, along: 'x' | 'y', length: number): Anchor {
  const half = (length - 1) / 2
  return along === 'x' ? { x: tile.x + half, y: tile.y } : { x: tile.x, y: tile.y + half }
}

export interface FloorTileOptions {
  /** The lighter of the two tones. The darker is derived, so the weave survives a recolour. */
  readonly colour?: string
}

/**
 * One tile of carpet.
 *
 * Two tones a hair apart, alternating. It is a checkerboard in the arithmetic and a weave to
 * the eye, which is the trick floor-view already uses in plan view — the contrast is small
 * enough that what you see is texture and an edge between tiles, not squares.
 */
export function drawFloorTile(ctx: Surface, tile: Tile, options: FloorTileOptions = {}): void {
  const base = options.colour ?? PALETTE.floor
  const colour = (tile.x + tile.y) % 2 === 0 ? base : tint(base, WEAVE)
  fillFace(ctx, boxFaces(footprintOf(tile, 'south', { width: 1, depth: 1 }), 0, 0).top, colour)
}

export interface RugOptions {
  /** In tiles. `tile` is the rug's first corner, so a 3×2 rug runs right and down from it. */
  readonly width?: number
  readonly height?: number
  readonly colour?: string
}

/**
 * A rug.
 *
 * Flat — no height at all, so it takes no faces and casts no shadow. The border is the only
 * thing that stops it reading as a patch of differently-coloured carpet, and it is a step
 * lighter rather than darker so the rug sits *on* the floor rather than in a hole in it.
 */
export function drawRug(ctx: Surface, tile: Tile, options: RugOptions = {}): void {
  const w = options.width ?? 2
  const h = options.height ?? 2
  const anchor = { x: tile.x + (w - 1) / 2, y: tile.y + (h - 1) / 2 }

  // A rug is the largest single area of colour anyone puts on this floor, and the version this
  // replaced was two flat fills with a hard bright edge — which is exactly what a selection
  // highlight is. It read as UI chrome sitting on the room rather than as something lying in
  // it, and a floor covering that looks like chrome is worse than no floor covering.
  //
  // Two things fix it and neither costs a gradient, which the charter does not allow. The
  // value moves much nearer the carpet, so it stops announcing itself. And it gets **bands**:
  // concentric borders are what makes a shape read as woven rather than as filled, and four
  // flat fills is the whole expense.
  const field = options.colour ?? mix(PALETTE.floor, PALETTE.pot, 0.1)
  const binding = mix(field, PALETTE.floor, 0.35)

  const band = (inset: number, colour: string) =>
    fillFace(
      ctx,
      boxFaces(footprintOf(anchor, 'south', { width: w - inset, depth: h - inset }), 0, 0).top,
      colour,
    )

  band(0, binding) // the bound edge, darker than the field rather than lighter
  band(0.3, field)
  band(0.75, binding)
  band(1.05, field)
}

export interface WallOptions {
  /** In `z` units. One is a shade more than a tile's width of rise — head height. */
  readonly height?: number
  readonly colour?: string
  /**
   * True for a wall that has room on both sides of it.
   *
   * The outer wall is a boundary: a thin slab on the far edge of its tile, so the floor reads
   * as running right up to the edge of the room. An **interior** wall is a piece of building
   * with a room on each side, and drawing that thin leaves a one-tile gap with nothing in it —
   * which is exactly why the manager's office and the meeting room read as dark bands rather
   * than as rooms. A solid tile of masonry is what makes a doorway look like a hole in
   * something.
   */
  readonly solid?: boolean
}

/**
 * A wall along one edge of a tile.
 *
 * `facing` is the direction the wall's visible face looks, so the wall itself sits on the
 * opposite edge and a room is built by walling its far tiles with `south` faces. A wall facing
 * `north` is drawn between the camera and the room, which is occasionally what you want and
 * mostly is not.
 *
 * A wall running `east`–`west` shows you its face; one running `north`–`south` shows you only
 * its top and the cut end of its last segment, because this camera has no sideways in it. That
 * is what a wall looks like from almost overhead, and it is why the room reads as a room
 * rather than as a box you are looking into.
 */
export function drawWall(ctx: Surface, tile: Tile, facing: Facing, options: WallOptions = {}): void {
  drawBox(ctx, tile, {
    // Spans the tile edge to edge so that neighbouring wall segments meet with no seam.
    width: 1,
    // An interior wall is a third of a tile of masonry sitting in the middle of its own tile,
    // with carpet either side of it. Full depth was tried and reads as a slab: at 32x22 a solid
    // tile of wall is the largest single shape in the room, and the rooms disappeared behind
    // their own walls. Thin and *lighter than the floor* is what makes it read as building.
    depth: options.solid ? 0.34 : 0.16,
    // Pushed to the far edge of its own tile, leaving the whole tile walkable in front of it.
    back: options.solid ? 0.12 : 0.42,
    height: options.height ?? 1,
    facing,
    colour: options.colour ?? PALETTE.wall,
    edge: false,
  })
}

export interface DeskOptions {
  readonly colour?: string
}

/** How high a desk's surface is. Anything standing on a desk takes this as its floor. */
export const DESK_TOP = 0.5

/** Everything under a lid goes almost black. See {@link UNDER}. */
const legsOf = (colour: string): string => tint(colour, UNDER)

/** The gap between the floor and a lid. Legs and modesty panels run exactly this tall. */
const APRON = DESK_TOP - 0.09

/**
 * A desk.
 *
 * `facing` is the way the desk faces the room — the side its modesty panel is on — so whoever
 * works here sits on the far side and looks the same way the desk does. That is the opposite
 * of what this function meant under the isometric camera, and the flip is the fix for two of
 * the four faults this rewrite exists for: a station hands one facing to its desk, its chair
 * and its monitor, and all three now agree about which side the person is.
 *
 * Six boxes and a shadow: the panel, four legs, and the lid last so it covers the tops of all
 * of them. The shadow is not decoration — the renderer does not carpet an unwalkable tile, so
 * without it the daylight between the legs is the app's backdrop.
 */
export function drawDesk(ctx: Surface, tile: Tile, facing: Facing, options: DeskOptions = {}): void {
  const colour = options.colour ?? PALETTE.desk
  const under = legsOf(colour)

  drawShadow(ctx, tile, { width: 1, depth: 1 })
  drawParts(ctx, tile, [
    // Narrow, so that the legs show either side of it and the underside reads as a gap rather
    // than as a solid block. Down to the floor rather than hanging, so it never has to be
    // sorted against a leg at a different height — see drawParts.
    { width: 0.56, depth: 0.07, back: -0.3, z: 0, height: APRON, facing, colour: under },
    { width: 0.09, depth: 0.09, across: -0.42, back: -0.31, z: 0, height: APRON, facing, colour: under },
    { width: 0.09, depth: 0.09, across: 0.42, back: -0.31, z: 0, height: APRON, facing, colour: under },
    { width: 0.09, depth: 0.09, across: -0.42, back: 0.31, z: 0, height: APRON, facing, colour: under },
    { width: 0.09, depth: 0.09, across: 0.42, back: 0.31, z: 0, height: APRON, facing, colour: under },
    // Three pixels of lid, lit a step above anything else in the room, so the surface reads as
    // a surface from across the floor. It overhangs its supports on every side: a top that
    // stops where its legs stop is a crate.
    {
      width: 1,
      depth: 0.8,
      z: APRON,
      height: 0.09,
      facing,
      colour,
      shades: { top: tint(colour, LID), front: colour, side: tint(colour, SHADE) },
    },
  ])
}

export interface TableOptions {
  /** How many tiles it spans along `along`. Two or more; one tile of table is a desk. */
  readonly length?: number
  /** Which floor axis the long side runs along. `tile` is the first tile of that run. */
  readonly along?: 'x' | 'y'
  readonly colour?: string
}

/**
 * A meeting table.
 *
 * No facing, because people sit all the way round one — which is the only real difference
 * between this and a desk, and the reason it has an open underside and no modesty panel.
 *
 * The lid is one piece across the whole run rather than a table drawn per tile: two lids
 * meeting mid-table would show the seam between them as a one-pixel line of shading, and a
 * seam in a table top is the sort of thing nobody can unsee.
 */
export function drawTable(ctx: Surface, tile: Tile, options: TableOptions = {}): void {
  const length = Math.max(2, options.length ?? 2)
  const along = options.along ?? 'x'
  const colour = options.colour ?? PALETTE.desk
  const under = legsOf(colour)
  const anchor = spread(tile, along, length)
  // Turning the table is turning the frame it is built in: `width` always runs along the long
  // axis, so one set of numbers describes both orientations.
  const facing: Facing = along === 'x' ? 'south' : 'east'
  const foot = length / 2 - 0.2

  drawShadow(ctx, anchor, { width: length, depth: 1 }, facing)
  drawParts(ctx, anchor, [
    { width: 0.1, depth: 0.1, across: -foot, back: -0.32, z: 0, height: APRON, facing, colour: under },
    { width: 0.1, depth: 0.1, across: foot, back: -0.32, z: 0, height: APRON, facing, colour: under },
    { width: 0.1, depth: 0.1, across: -foot, back: 0.32, z: 0, height: APRON, facing, colour: under },
    { width: 0.1, depth: 0.1, across: foot, back: 0.32, z: 0, height: APRON, facing, colour: under },
    {
      width: length - 0.08,
      depth: 0.86,
      z: APRON,
      height: 0.09,
      facing,
      colour,
      shades: { top: tint(colour, LID), front: colour, side: tint(colour, SHADE) },
    },
  ])
}

export interface ChairOptions {
  /** Tucked under the desk it faces, rather than pulled out to sit in. */
  readonly pushedIn?: boolean
  readonly colour?: string
}

/** How high a chair's seat is. Six tenths of a desk, which is what a chair is. */
export const SEAT_TOP = 0.3

/**
 * An office chair.
 *
 * `facing` is the way the sitter looks — at their desk — so the back is behind them and
 * turning the chair moves it to the correct side of the seat on its own.
 *
 * Two things here are placement rather than drawing, and both were faults on the running
 * floor. The seat sits at {@link SEAT_TOP}, six tenths of {@link DESK_TOP}, which is the
 * ratio a real chair and a real desk have and the thing that stops the chair reading as
 * standing *on* the table. And the whole chair is wider than the eighteen-pixel character who
 * stands on this tile: the arms show past their hips, and the back is tall enough that its
 * lit top edge comes out beside their head rather than behind their shoulders. A chair
 * narrower than the sprite disappears entirely the moment somebody sits down, and then they
 * read as sitting on the floor.
 *
 * `pushedIn` slides the chair towards the desk until the seat is under the lid. Nothing else
 * changes: a chair that also shrank or turned when it was tucked in would stop reading as the
 * same chair, and the point of the state is that you can see at a glance whether somebody is
 * at their desk.
 */
export function drawChair(ctx: Surface, tile: Tile, facing: Facing, options: ChairOptions = {}): void {
  const colour = options.colour ?? PALETTE.chairSeat
  const frame = PALETTE.chairFrame
  const tuck = options.pushedIn === true ? -0.4 : 0

  drawShadow(ctx, tile, { width: 0.5, depth: 0.44, back: tuck }, facing)
  drawParts(ctx, tile, [
    { width: 0.46, depth: 0.4, back: tuck, z: 0, height: 0.05, facing, colour: frame },
    { width: 0.12, depth: 0.12, back: tuck, z: 0.05, height: SEAT_TOP - 0.11, facing, colour: frame },
    // Wider than the base it stands on and than the back behind it, because the one thing a
    // chair has to say at this size is that it has a horizontal surface to sit on.
    { width: 0.66, depth: 0.56, back: tuck, z: SEAT_TOP - 0.06, height: 0.06, facing, colour },
    { width: 0.06, depth: 0.4, across: -0.35, back: tuck, z: SEAT_TOP, height: 0.1, facing, colour: frame },
    { width: 0.06, depth: 0.4, across: 0.35, back: tuck, z: SEAT_TOP, height: 0.1, facing, colour: frame },
    // High-backed, and that is measured rather than styled: a back that stops at the sitter's
    // waist is exactly as wide as their torso and vanishes behind them. This one clears their
    // shoulders, so what you see is a head against a chair back — which is the whole picture
    // of somebody sitting down. Thick enough, too, that its lit top edge survives; a back one
    // pixel deep is a plane rather than a slab, and planes disappear when the chair turns.
    { width: 0.62, depth: 0.12, back: 0.25 + tuck, z: SEAT_TOP, height: 0.4, facing, colour },
  ])
}

export interface SofaOptions {
  /** How many tiles it spans across its front. `tile` is the first tile of that run. */
  readonly length?: number
  readonly colour?: string
}

/**
 * A sofa.
 *
 * The same fabric as the chairs and the same frame under it, so the breakout area reads as
 * belonging to the same office. Its run goes right for a sofa facing `north` or `south` and
 * down for one facing `east` or `west` — along its front, which is the only axis a sofa can
 * grow along.
 */
export function drawSofa(ctx: Surface, tile: Tile, facing: Facing, options: SofaOptions = {}): void {
  const length = Math.max(1, options.length ?? 2)
  const colour = options.colour ?? PALETTE.chairSeat
  const anchor = spread(tile, facing === 'east' || facing === 'west' ? 'y' : 'x', length)
  const arm = length / 2 - 0.09

  drawShadow(ctx, anchor, { width: length - 0.04, depth: 0.9 }, facing)
  drawParts(ctx, anchor, [
    { width: length - 0.1, depth: 0.78, z: 0, height: 0.18, facing, colour: PALETTE.chairFrame },
    // The cushions are pulled forward off the back, so the shadow line between the two reads
    // as a seam rather than as one upholstered block.
    { width: length - 0.26, depth: 0.5, back: -0.1, z: 0.18, height: 0.11, facing, colour },
    { width: length - 0.1, depth: 0.16, back: 0.31, z: 0.18, height: 0.42, facing, colour },
    { width: 0.14, depth: 0.78, across: -arm, z: 0.18, height: 0.22, facing, colour },
    { width: 0.14, depth: 0.78, across: arm, z: 0.18, height: 0.22, facing, colour },
  ])
}

/** What a screen is doing. Three states, because a screen that is merely on says nothing. */
export type ScreenState = 'dark' | 'lit' | 'alert'

const SCREEN_COLOUR: Readonly<Record<ScreenState, string>> = {
  dark: PALETTE.screenDark,
  lit: PALETTE.screenLit,
  alert: PALETTE.screenAlert,
}

export interface MonitorOptions {
  readonly screen: ScreenState
  /** Where its foot stands. Defaults to a desk's surface, which is where monitors live. */
  readonly z?: number
}

/**
 * A monitor.
 *
 * `facing` is **the desk's** facing, not the monitor's, and it is passed straight through from
 * the station: a monitor on a desk is always turned to whoever sits at it, so it takes the
 * facing of the thing it stands on and turns its screen back along it. Handing it the same
 * value as the desk and the chair is the whole point — the fault this replaces was three props
 * given one facing and disagreeing about what it meant, which put every screen's back to the
 * person reading it.
 *
 * The consequence is worth stating plainly, because it looks like a bug and is not: at a desk
 * whose occupant faces the camera, the camera gets the *back* of the monitor. It cannot have
 * both. What it can have is the light — a lit screen spills over the top bezel onto the
 * panel's lid, which is real light from a real screen and keeps the state readable from
 * behind. A dark screen spills nothing, because it emits nothing.
 *
 * The panel stands to one side of the desk rather than in the middle of it, and that is what
 * makes the spill worth drawing: dead centre, the whole monitor hides behind the eighteen
 * pixels of the person sitting at it, and a state nobody can see is not a state.
 */
export function drawMonitor(ctx: Surface, tile: Tile, facing: Facing, options: MonitorOptions): void {
  const base = options.z ?? DESK_TOP
  const colour = PALETTE.monitor
  // Built in the screen's own frame, so `back` reads as "further from the person looking at
  // it" throughout and the monitor stands at the far edge of the desk from them.
  const looks = OPPOSITE[facing]
  const panel = { width: 0.56, depth: 0.17, back: 0.2, across: 0.18, z: base + 0.16, height: 0.32 }

  // A chassis is the darkest thing in the room, and one multiplicative step on near-black is
  // five levels — invisible. Its lid takes a far bigger step or the back of a monitor reads
  // as a hole cut in the desk.
  const lid = tint(colour, 2.2)
  const chassis: Shades = { top: lid, front: colour, side: tint(colour, SHADE) }
  const spill = options.screen === 'dark' ? lid : mix(lid, SCREEN_COLOUR[options.screen], 0.62)

  const stand = { back: 0.16, across: panel.across, facing: looks, colour, shades: chassis }

  drawParts(ctx, tile, [
    { ...stand, width: 0.3, depth: 0.14, z: base, height: 0.03 },
    { ...stand, width: 0.08, depth: 0.08, z: base + 0.03, height: 0.13 },
    { ...panel, facing: looks, colour, shades: { ...chassis, top: spill } },
  ])

  const glass = frontOf(tile, looks, {
    width: panel.width - 0.09,
    depth: 0,
    // The front plane of the panel, so the inset sits exactly on the face it belongs to.
    back: panel.back - panel.depth / 2,
    across: panel.across,
    z: panel.z + 0.04,
    height: panel.height - 0.09,
  })
  if (glass) fillFace(ctx, glass, SCREEN_COLOUR[options.screen])
}

/**
 * How a prop looks when it has nothing to report.
 *
 * One visual idea shared by every reporting prop, rather than three improvisations: the
 * information layer is not drawn, and the surface that would have carried it is dimmed. That
 * makes *unmeasured* its own state on the floor instead of a value on the scale — a lit board
 * with no strokes says "nobody has written anything", a dim board says "nobody looked".
 *
 * The distinction is the whole of standing order 4 rendered in paint. Collapsing the two is how
 * `notes: 0` came to mean both "no work outstanding" and "no `TASKS.md` to read".
 */
export const UNREAD_TINT = 0.55

export interface WhiteboardOptions {
  /**
   * How much is written on it. Three fills it; nought is a board nobody has used.
   *
   * `null` is not nought. It means nothing measured this, and the board is dimmed rather than
   * drawn clean — see {@link UNREAD_TINT}.
   */
  readonly lines?: number | null
}

/**
 * A whiteboard, hung on the wall behind its tile.
 *
 * Proud of the wall by a pixel rather than flush with it, so the board's own lid catches the
 * light and the thing reads as hanging rather than as a patch of differently-coloured wall.
 * Turned away from the camera it is a slab, which is what the back of a whiteboard is.
 */
export function drawWhiteboard(ctx: Surface, tile: Tile, facing: Facing, options: WhiteboardOptions = {}): void {
  const frame = { width: 0.88, depth: 0.06, back: 0.33, z: 0.34, height: 0.52 }
  drawBox(ctx, tile, { ...frame, facing, colour: PALETTE.shelf })

  const surface = frame.back - frame.depth / 2
  const board = frontOf(tile, facing, {
    width: frame.width - 0.08,
    depth: 0,
    back: surface,
    z: frame.z + 0.03,
    height: frame.height - 0.06,
  })
  if (!board) return
  const unread = options.lines === null
  fillFace(ctx, board, tint(PALETTE.screenLit, unread ? UNREAD_TINT : 1.3))
  // Nothing is written on a board nobody read. Falling through to the loop below would draw
  // three strokes from the `?? 3` default, which is the prop inventing the reading it lacks.
  if (unread) return

  // Marker, not text: three strokes at three widths say "somebody has been working at this"
  // and any attempt at letters at this size says "somebody has smudged the board".
  const strokes = Math.max(0, Math.min(3, options.lines ?? 3))
  for (let i = 0; i < strokes; i++) {
    const mark = frontOf(tile, facing, {
      width: 0.54 - i * 0.14,
      depth: 0,
      back: surface,
      across: 0.08 + i * 0.06,
      z: frame.z + 0.36 - i * 0.11,
      // A stroke has to be thick enough to survive rounding. At 0.03 it is eight tenths of a
      // pixel, and whether it lands on one or none depends on where the board happens to sit.
      height: 0.05,
    })
    if (mark) fillFace(ctx, mark, i === 2 ? PALETTE.books[3]! : PALETTE.wall)
  }
}

export interface PictureOptions {
  /** What is in the frame. One of the office's book colours by default. */
  readonly colour?: string
}

/** A picture, hung on the wall behind its tile. The cheapest thing that says somebody lives here. */
export function drawPictureFrame(ctx: Surface, tile: Tile, facing: Facing, options: PictureOptions = {}): void {
  const frame = { width: 0.34, depth: 0.05, back: 0.33, z: 0.6, height: 0.28 }
  drawBox(ctx, tile, { ...frame, facing, colour: PALETTE.pot })

  const picture = frontOf(tile, facing, {
    width: frame.width - 0.08,
    depth: 0,
    back: frame.back - frame.depth / 2,
    z: frame.z + 0.04,
    height: frame.height - 0.08,
  })
  if (picture) fillFace(ctx, picture, options.colour ?? PALETTE.books[0]!)
}

/**
 * A water cooler.
 *
 * The bottle is the point. A cabinet on its own is a filing cabinet; the pale blue slab on top
 * of it is the whole of what makes this readable at a glance, so it is drawn a step brighter
 * than anything else in the corner it stands in.
 */
export function drawWaterCooler(ctx: Surface, tile: Tile, facing: Facing = 'south'): void {
  const body = tint(PALETTE.wall, 1.6)
  const water = tint(PALETTE.chairSeat, 1.5)

  drawShadow(ctx, tile, { width: 0.44, depth: 0.4 }, facing)
  drawParts(ctx, tile, [
    { width: 0.36, depth: 0.32, z: 0, height: 0.52, facing, colour: body },
    { width: 0.28, depth: 0.24, z: 0.52, height: 0.34, facing, colour: water },
    { width: 0.14, depth: 0.12, z: 0.86, height: 0.05, facing, colour: tint(water, SHADE) },
  ])

  const tap = frontOf(tile, facing, { width: 0.12, depth: 0, back: -0.16, z: 0.34, height: 0.07 })
  if (tap) fillFace(ctx, tap, PALETTE.chairFrame)
}

export interface PartitionOptions {
  /** How tall, in z units. Shoulder height on a seated person, which is the point of one. */
  readonly height?: number
  /**
   * Which way the panel runs.
   *
   * `across` divides two desks standing side by side — the default, and the only kind the row
   * layout needed. `along` is the **spine**: the screen down the middle of a bench, between two
   * desks that back onto each other. Without it a bench is two identical desk lids abutting,
   * which paints as one wide counter with somebody sitting at each end of it.
   */
  readonly runs?: 'across' | 'along'
  /** Shift toward the camera, in tiles. −0.5 puts the panel on the seam with the next tile. */
  readonly back?: number
}

/**
 * A cubicle partition — the panel between one desk and the next.
 *
 * The office felt very robotic, so cubicles were asked for, with the chairs arranged properly.
 * The floor is a lattice and everything sits square to it, which is exactly why it reads
 * as a diagram rather than a room. A partition is the cheapest thing that breaks the lattice
 * *visually* while changing nothing underneath: the desks keep their tiles, pathfinding keeps
 * its grid, and desk stability — which is a promise — is untouched.
 *
 * Shoulder height on purpose. Tall enough to divide the row into workstations, short enough
 * that you can still see who is at every desk, which is the whole reason the floor exists.
 */
export function drawPartition(
  ctx: Surface,
  tile: Tile,
  facing: Facing,
  options: PartitionOptions = {},
): void {
  const h = options.height ?? 0.55
  const panel = mix(PALETTE.wall, PALETTE.desk, 0.45)
  const along = options.runs === 'along'
  const width = along ? 0.92 : 0.12
  const depth = along ? 0.12 : 0.92
  const back = options.back ?? 0

  drawParts(ctx, tile, [{ width, depth, back, z: 0, height: h, facing, colour: panel }])
  // A lighter cap, so the panel has a top edge to catch the light rather than reading as a
  // slab cut out of the floor.
  const cap = frontOf(tile, facing, { width, depth: 0, back, z: h, height: 0.04 })
  if (cap) fillFace(ctx, cap, tint(panel, TOP))
}

export interface NoticeBoardOptions {
  /**
   * How many notes are pinned to it. Clamped to what fits; zero is a real answer.
   *
   * `null` is the answer that is not a number: no `TASKS.md`, or one the harness could not
   * read. The cork is dimmed and no notes are pinned — see {@link UNREAD_TINT}.
   */
  readonly notes?: number | null
}

/**
 * The notice board — the notes section that was asked for.
 *
 * Hangs on a wall like the whiteboard, and the notes on it are **counted, not decorated**. An
 * empty board is drawn empty: a workspace with nothing pinned up should look like one, and a
 * board that always carries the same four squares is a prop pretending to hold information.
 */
export function drawNoticeBoard(
  ctx: Surface,
  tile: Tile,
  facing: Facing,
  options: NoticeBoardOptions = {},
): void {
  // Cork, and warm enough to separate from the wall it hangs on. The first pass mixed it most
  // of the way to the desk colour and the board read as a crate lying on the floor: at this size
  // a prop is its value contrast with whatever is behind it, and nothing else.
  const cork = mix(PALETTE.pot, PALETTE.desk, 0.15)

  // Built the way the whiteboard is built, and for the reason the whiteboard's comment gives:
  // a frame with real depth, standing proud of the wall behind it, so its lid catches the light
  // and the thing reads as *hanging*. Drawn as a bare front face it has no body, sits at the
  // middle of its own tile rather than against the wall, and reads as a slab lying on the floor.
  const frame = { width: 0.82, depth: 0.06, back: 0.33, z: 0.34, height: 0.5 }
  drawBox(ctx, tile, { ...frame, facing, colour: mix(PALETTE.wall, PALETTE.pot, 0.25) })

  const surface = frame.back - frame.depth / 2
  const face = frontOf(tile, facing, {
    width: frame.width - 0.08,
    depth: 0,
    back: surface,
    z: frame.z + 0.03,
    height: frame.height - 0.06,
  })
  if (!face) return
  const unread = options.notes === null
  fillFace(ctx, face, unread ? tint(cork, UNREAD_TINT) : cork)
  // An empty board and an unread one are the same picture unless one of them stops here.
  if (unread) return

  // Three across, two down. Beyond six the board is full and the seventh note is not drawn —
  // a board cannot show more than it holds, and stacking them would invent space.
  const notes = Math.max(0, Math.min(6, options.notes ?? 0))
  const paper = [tint(PALETTE.screenLit, 1.1), PALETTE.leafDying, tint(PALETTE.deskWarm, 1.5)]
  for (let i = 0; i < notes; i++) {
    const col = i % 3
    const row = Math.floor(i / 3)
    const note = frontOf(tile, facing, {
      width: 0.13,
      depth: 0,
      back: surface,
      across: -0.19 + col * 0.19,
      z: frame.z + 0.29 - row * 0.15,
      height: 0.11,
    })
    if (note) fillFace(ctx, note, paper[i % paper.length] ?? paper[0]!)
  }
}

export interface CrateOptions {
  /** How many are stacked. Two is the vision's "two boxes"; one is a box on its own. */
  readonly count?: number
}

/** How full the bin is. Two states, because the fact it reports has two. */
export interface WastebasketOptions {
  /** `true` when nothing ran for this desk's owner. See `nothingRan` in `shared/tasks.ts`. */
  readonly full?: boolean
  /**
   * Sideways offset in tiles, so the bin stands *beside* a desk without occupying a tile.
   *
   * The same trick the desk partition uses and for the same reason: the bin sits in the gap the
   * desk pitch already leaves, so no tile changes state, pathfinding is untouched, and the
   * promise that desks never move is kept. A bin nobody can walk through would be a wall.
   */
  readonly across?: number
}

/**
 * A bin beside a desk, which is full when nothing about that desk's work has been run.
 *
 * `PLAN.md`'s V2 line asks for four reporting props and this is the fourth — *"wastebasket from
 * blocked tasks"*. Three of the four were already reading from a file when
 * `every-prop-reports-or-says-it-cannot` went through; this one did not exist at all, which is
 * why that pass listed it rather than fixing it.
 *
 * **Two states, not a gradient.** A bin that filled up by degrees would be claiming a quantity,
 * and the reading behind it is a predicate: something ran, or nothing did. Paper accumulating in
 * proportion to *how blocked* somebody is would be a number nobody computed.
 *
 * **Empty is a real answer here, not an absence.** A visible empty bin says "checked, and
 * nothing was thrown away"; the bin is drawn at every desk in both states for that reason. A bin
 * that appeared only when full would make its absence ambiguous between *fine* and *not drawn
 * yet*, which is the distinction this floor exists to keep.
 */
export function drawWastebasket(ctx: Surface, tile: Tile, facing: Facing, options: WastebasketOptions = {}): void {
  const metal = mix(PALETTE.pot, PALETTE.desk, 0.32)
  const across = options.across ?? 0

  drawShadow(ctx, tile, { width: 0.3, depth: 0.28, across }, facing)

  // Slightly narrower at the base than the rim, which is what stops a cylinder reading as a box.
  drawParts(ctx, tile, [
    { width: 0.24, depth: 0.22, across, z: 0, height: 0.14, facing, colour: tint(metal, 0.86) },
    { width: 0.28, depth: 0.26, across, z: 0.14, height: 0.16, facing, colour: metal },
  ])

  if (!options.full) return

  // Paper above the rim. Three pieces at fixed offsets rather than a count that varies: the
  // number is not a measurement of anything, so it must not look like one.
  // Off-white, derived rather than a new palette entry: one prop is not a reason to add a
  // colour the rest of the room does not use.
  //
  // Sized to **overflow the rim**, which the first version did not. At 0.08-0.11 tiles the paper
  // came out two or three pixels at the scale the office actually draws at, so a full bin and an
  // empty one were indistinguishable on screen while passing a test that only knew the two
  // differed in the recorder. The V2 line this prop answers asks that a stranger can tell who is
  // stuck, and a signal a stranger cannot see does not meet it, whatever the test says.
  const paper = tint(PALETTE.shelfInside, 2.1)
  for (const [offset, lift, size] of [
    [-0.08, 0.29, 0.19],
    [0.07, 0.31, 0.16],
    [0.0, 0.36, 0.14],
  ] as const) {
    drawParts(ctx, tile, [
      { width: size, depth: size - 0.02, across: across + offset, z: lift, height: 0.1, facing, colour: paper },
    ])
  }
}

/** Storage crates, stacked in a corner. Furniture, and honest about being furniture. */
export function drawCrate(ctx: Surface, tile: Tile, facing: Facing, options: CrateOptions = {}): void {
  const count = Math.max(1, Math.min(3, options.count ?? 2))
  const card = mix(PALETTE.pot, PALETTE.desk, 0.5)

  drawShadow(ctx, tile, { width: 0.5, depth: 0.46 }, facing)
  for (let i = 0; i < count; i++) {
    // Each one a little smaller and turned a little, or a stack reads as one tall block.
    const size = 0.46 - i * 0.05
    drawParts(ctx, tile, [
      {
        width: size,
        depth: size - 0.04,
        across: i % 2 === 0 ? 0 : 0.05,
        z: i * 0.3,
        height: 0.28,
        facing,
        colour: i % 2 === 0 ? card : tint(card, 1.12),
      },
    ])
    // The tape down the middle, which is what makes a cube read as a box.
    const tape = frontOf(tile, facing, {
      width: 0.06,
      depth: 0,
      back: -0.01,
      across: i % 2 === 0 ? 0 : 0.05,
      z: i * 0.3,
      height: 0.28,
    })
    if (tape) fillFace(ctx, tape, tint(card, SHADE))
  }
}

export interface PrinterOptions {
  /** True while something is actually printing. Bound to a fact or left false. */
  readonly busy?: boolean
}

/**
 * The printer.
 *
 * The sheet in the output tray is drawn only when `busy`. A printer with paper permanently
 * half-fed is a prop claiming an activity, and this module's own rule about rack lights applies
 * to it: never animated on a timer, only ever drawn from something the office knows.
 */
export function drawPrinter(ctx: Surface, tile: Tile, facing: Facing, options: PrinterOptions = {}): void {
  const body = tint(PALETTE.wall, 1.45)

  drawShadow(ctx, tile, { width: 0.58, depth: 0.5 }, facing)
  drawParts(ctx, tile, [
    { width: 0.52, depth: 0.44, z: 0, height: 0.26, facing, colour: body },
    { width: 0.46, depth: 0.38, z: 0.26, height: 0.12, facing, colour: tint(body, 1.15) },
  ])

  const slot = frontOf(tile, facing, { width: 0.36, depth: 0, back: -0.01, z: 0.2, height: 0.05 })
  if (slot) fillFace(ctx, slot, PALETTE.monitor)

  if (options.busy) {
    const sheet = frontOf(tile, facing, { width: 0.3, depth: 0, back: -0.03, z: 0.13, height: 0.08 })
    if (sheet) fillFace(ctx, sheet, tint(PALETTE.deskWarm, 1.6))
  }
}

/**
 * The coffee machine.
 *
 * The break room's reason to exist. Nothing on it reports anything — it is furniture, and
 * labelling it as such here is the point: a prop that looks like it might be showing you
 * something, and is not, is worse than one that plainly is not.
 */
export function drawCoffeeMachine(ctx: Surface, tile: Tile, facing: Facing = 'south'): void {
  const body = mix(PALETTE.monitor, PALETTE.wall, 0.4)
  const counter = PALETTE.desk

  drawShadow(ctx, tile, { width: 0.5, depth: 0.44 }, facing)
  drawParts(ctx, tile, [
    { width: 0.46, depth: 0.4, z: 0, height: 0.22, facing, colour: counter },
    { width: 0.34, depth: 0.3, z: 0.22, height: 0.42, facing, colour: body },
    { width: 0.36, depth: 0.32, z: 0.64, height: 0.06, facing, colour: tint(body, 1.2) },
  ])

  // The jug, and the cup beneath the spout.
  const jug = frontOf(tile, facing, { width: 0.16, depth: 0, back: -0.01, z: 0.26, height: 0.14 })
  if (jug) fillFace(ctx, jug, mix(PALETTE.pot, PALETTE.monitor, 0.4))
  const cup = frontOf(tile, facing, { width: 0.07, depth: 0, back: -0.02, across: 0.14, z: 0.22, height: 0.06 })
  if (cup) fillFace(ctx, cup, tint(PALETTE.deskWarm, 1.5))
}

/** What a rack is doing. The three states the office already has words for. */
export type RackState = 'idle' | 'busy' | 'fault'

/**
 * The lights on one blade, per state.
 *
 * Colour *and* count, because colour alone is two pixels of hue at this size and half the
 * people looking at it will not be able to tell the green from the amber. An idle rack is
 * mostly dark; a busy one is lit right across; a faulty one is red and everything else on the
 * blade has gone out, which is the pattern a person already reads as "this one is broken".
 */
const RACK_LIGHTS: Readonly<Record<RackState, readonly (string | null)[]>> = {
  idle: [PALETTE.leafHealthy, null, null],
  busy: [PALETTE.leafHealthy, PALETTE.screenLit, PALETTE.leafDying],
  fault: [PALETTE.screenAlert, null, PALETTE.screenAlert],
}

export interface ServerRackOptions {
  readonly state: RackState
}

/**
 * A server rack.
 *
 * Four blades with lights on them, and the lights are the only thing in this module that is
 * bound to something the office actually knows — so they are drawn from `state` and never
 * animated on a timer. A rack that blinks whether or not anything is running is the floor
 * telling you about work that is not happening.
 */
export function drawServerRack(ctx: Surface, tile: Tile, facing: Facing, options: ServerRackOptions): void {
  const carcass = { width: 0.72, depth: 0.56, back: 0.08, z: 0, height: 1.05 }
  drawShadow(ctx, tile, { width: 0.78, depth: 0.62, back: 0.08 }, facing)
  drawBox(ctx, tile, { ...carcass, facing, colour: PALETTE.monitor })

  const surface = carcass.back - carcass.depth / 2
  const blades = 4
  const lights = RACK_LIGHTS[options.state]

  for (let i = 0; i < blades; i++) {
    const z = 0.2 + i * 0.2
    const blade = frontOf(tile, facing, { width: carcass.width - 0.12, depth: 0, back: surface, z, height: 0.13 })
    if (!blade) return
    fillFace(ctx, blade, tint(PALETTE.monitor, 1.8))

    lights.forEach((colour, n) => {
      if (colour === null) return
      const lamp = frontOf(tile, facing, {
        width: 0.05,
        depth: 0,
        back: surface,
        across: 0.2 - n * 0.08,
        z: z + 0.04,
        height: 0.05,
      })
      // Every other blade one step down, so a busy rack reads as several machines rather than
      // as one strip of light.
      if (lamp) fillFace(ctx, lamp, i % 2 === 0 ? colour : tint(colour, SHADE))
    })
  }
}

export interface PlantOptions {
  /**
   * 1 is thriving, 0 is dead. Anything in between droops and yellows proportionally.
   *
   * `null` is neither. A project nobody has worked in has no recency to read, and both ends of
   * the scale would be a claim: thriving says somebody has been tending it, wilted says they
   * stopped. The plant goes ashen instead, which is the office saying it does not know.
   */
  readonly health: number | null
}

/** One leaf, in the plant's own frame: tiles out from the stem, and `z` off the floor. */
export interface Leaf {
  readonly dx: number
  readonly dy: number
  readonly z: number
  readonly size: number
}

/** The directions leaves grow in. Six, spread round the pot, so no two overlap exactly. */
const LEAF_DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1],
  [0.85, -0.5],
  [0.85, 0.5],
  [0, 1],
  [-0.85, 0.5],
  [-0.85, -0.5],
]

/**
 * What a plant's foliage looks like at a given health.
 *
 * Two things happen as it dies and both are visible from across the room: leaves splay
 * further out and hang lower — the droop — and the plant sheds them, six down to three. The
 * count is what you notice first, so it is what carries the bottom of the range.
 */
export function foliage(health: number): readonly Leaf[] {
  const h = Math.max(0, Math.min(1, health))
  const droop = 1 - h
  const count = 3 + Math.round(h * 3)
  const radius = 0.14 + 0.12 * droop
  const z = 0.44 - 0.16 * droop

  return LEAF_DIRECTIONS.slice(0, count).map(([dx, dy]) => ({
    dx: dx * radius,
    dy: dy * radius,
    z,
    size: 0.2,
  }))
}

/** Green through to amber. The same amber floor-view uses for a task nobody has run. */
export function leafColour(health: number | null): string {
  // Off the scale entirely rather than at a point on it. Halfway between dying and healthy is
  // still a health reading, and the one thing this colour must not do is read as a measurement.
  if (health === null) return tint(mix(PALETTE.leafHealthy, PALETTE.pot, 0.55), 0.9)
  return mix(PALETTE.leafDying, PALETTE.leafHealthy, Math.max(0, Math.min(1, health)))
}

/**
 * A potted plant.
 *
 * No facing: a plant has no front. The leaves are laid out in tile space instead, so they are
 * placed through the fixed `south` frame, where `across` runs along `−x` and `back` along
 * `−y` — hence the two negations.
 */
export function drawPlant(ctx: Surface, tile: Tile, options: PlantOptions): void {
  const leaf = leafColour(options.health)

  drawShadow(ctx, tile, { width: 0.48, depth: 0.44 })
  drawParts(ctx, tile, [
    { width: 0.38, depth: 0.34, z: 0, height: 0.22, colour: PALETTE.pot },
    { width: 0.44, depth: 0.4, z: 0.19, height: 0.05, colour: PALETTE.pot },
    { width: 0.06, depth: 0.06, z: 0.24, height: 0.2, colour: leaf },
    // Posture from the upright shape when there is no reading. The droop is the *second* way
    // this prop states a health it might not have, and a slumped plant beside an ashen one
    // would say "dying" twice as loudly as it knows. The colour carries the reading; the shape
    // just says a plant is there.
    ...foliage(options.health ?? 1).map((l): BoxSpec => ({
      width: l.size,
      depth: l.size,
      across: -l.dx,
      back: -l.dy,
      z: l.z,
      // A leaf is a slab, not a cube: one pixel of thickness so it catches the top light and
      // still shows an edge against the leaf below it.
      height: 0.03,
      colour: leaf,
    })),
  ])
}

export interface StereoOptions {
  /** True while sound is actually coming out of it. Bound to the audio graph, not to a timer. */
  readonly playing?: boolean
}

/**
 * The office stereo, sitting on the arm of the sofa.
 *
 * On the furniture rather than on a tile of its own, because the break end of the fixture row
 * has no tile to spare and a prop standing on a walkable square is a prop people walk through.
 *
 * The lamp on its face follows the same rule as the rack lights and the printer's sheet: it is
 * lit when and only when there is really sound coming out. A stereo that always glows is a prop
 * claiming an activity, which is the one thing the furniture in this file may not do.
 */
export function drawStereo(ctx: Surface, tile: Tile, facing: Facing, options: StereoOptions = {}): void {
  const body = tint(PALETTE.wall, 1.5)
  const z = 0.58

  drawParts(ctx, tile, [
    { width: 0.42, depth: 0.18, z, height: 0.2, facing, colour: body },
    { width: 0.38, depth: 0.14, z: z + 0.2, height: 0.03, facing, colour: tint(body, TOP) },
  ])

  // Two cones and a lamp between them, which is the whole of what makes a box a stereo.
  for (const across of [-0.12, 0.12]) {
    const cone = frontOf(tile, facing, {
      width: 0.13,
      depth: 0,
      back: -0.09,
      across,
      z: z + 0.04,
      height: 0.12,
    })
    if (cone) fillFace(ctx, cone, PALETTE.monitor)
  }

  const lamp = frontOf(tile, facing, { width: 0.04, depth: 0, back: -0.09, z: z + 0.08, height: 0.04 })
  if (lamp) fillFace(ctx, lamp, options.playing ? PALETTE.leafDying : tint(PALETTE.monitor, 1.3))
}

export interface PetOptions {
  /** 0, 1 or 2 — which of the three settled poses. Nothing reads it as a status. */
  readonly pose?: number
}

/**
 * The office cat.
 *
 * One of the agents has a pet, as suggested. It belongs to a **desk**, picked from the
 * roster by the same hash the campus uses for its hues, so the same agent has it every session.
 *
 * It is the only thing on this floor allowed to move without reporting anything, and that is
 * defensible for exactly one reason: nobody would read a cat as a status. Every other moving
 * thing here is a claim about work. This one is a cat.
 */
export function drawPet(ctx: Surface, tile: Tile, options: PetOptions = {}): void {
  const fur = mix(PALETTE.pot, PALETTE.deskWarm, 0.35)
  const dark = tint(fur, SHADE)
  const pose = ((options.pose ?? 0) % 3 + 3) % 3
  // Curled, sitting up, stretched. Three silhouettes rather than three positions: at eight
  // pixels a cat is its outline and nothing else.
  const body = [
    { width: 0.34, depth: 0.3, height: 0.13 },
    { width: 0.22, depth: 0.24, height: 0.2 },
    { width: 0.44, depth: 0.22, height: 0.1 },
  ][pose]!

  drawShadow(ctx, tile, { width: body.width + 0.04, depth: body.depth + 0.02 })
  drawParts(ctx, tile, [
    { ...body, z: 0, facing: 'south', colour: fur },
    // The head, forward and to one side, which is what turns a lump into an animal.
    {
      width: 0.16,
      depth: 0.14,
      across: pose === 2 ? -0.16 : 0.06,
      back: -0.08,
      z: pose === 1 ? body.height : body.height - 0.04,
      height: 0.14,
      facing: 'south',
      colour: fur,
    },
    // The tail, laid along the floor behind it.
    {
      width: 0.06,
      depth: 0.2,
      across: pose === 2 ? 0.2 : -0.14,
      back: 0.14,
      z: 0,
      height: 0.05,
      facing: 'south',
      colour: dark,
    },
  ])
}

export interface ShelfOptions {
  /** How many books are on it. Twelve fills it; an empty shelf is an honest empty shelf. */
  readonly books?: number
  readonly colour?: string
}

/**
 * A bookshelf.
 *
 * Drawn as shelving with things on it rather than as a blocked rectangle, for the reason
 * floor-view gives about its own shelf: "walked over and took something down" only reads as
 * that if there is visibly something to take.
 *
 * Everything inside — the recess, the boards, the books — is flat in the plane of the
 * carcass's front face, painted after it. Turned away from the camera you get the back of the
 * unit, which is a plain box, because that is what the back of a bookshelf is.
 */
export function drawShelfUnit(ctx: Surface, tile: Tile, facing: Facing, options: ShelfOptions = {}): void {
  const colour = options.colour ?? PALETTE.shelf
  const carcass = { width: 0.9, depth: 0.42, back: 0.12, z: 0, height: 0.86 }

  drawShadow(ctx, tile, { width: 0.94, depth: 0.46, back: 0.12 }, facing)
  drawBox(ctx, tile, { ...carcass, facing, colour })

  // The front plane of the carcass. Every detail below sits exactly on it.
  const front = carcass.back - carcass.depth / 2
  const inside = { width: carcass.width - 0.12, depth: 0, back: front }
  const slots = 3
  const firstShelf = 0.06
  const slotHeight = (carcass.height - firstShelf * 2) / slots

  const recess = frontOf(tile, facing, { ...inside, z: firstShelf, height: carcass.height - firstShelf * 2 })
  if (!recess) return
  fillFace(ctx, recess, PALETTE.shelfInside)

  const books = options.books ?? 12
  for (let i = 0; i < books; i++) {
    const slot = Math.floor(i / 4)
    if (slot >= slots) break
    const book = frontOf(tile, facing, {
      width: 0.06,
      depth: 0,
      back: front,
      // Four to a shelf, packed from one end so a half-full shelf looks half full.
      across: -0.3 + (i % 4) * 0.09,
      z: firstShelf + slot * slotHeight + 0.03,
      height: slotHeight - 0.12,
    })
    if (book) fillFace(ctx, book, PALETTE.books[i % PALETTE.books.length]!)
  }

  // The boards last: they cap the books, which is what makes the books look shelved rather
  // than stacked. Lit with the carcass's top shade, since a board's edge catches the light.
  for (let i = 1; i < slots; i++) {
    const board = frontOf(tile, facing, {
      ...inside,
      z: firstShelf + i * slotHeight,
      height: 0.03,
    })
    if (board) fillFace(ctx, board, tint(colour, TOP))
  }
}
