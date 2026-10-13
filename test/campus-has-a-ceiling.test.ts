/**
 * The campus layout never caps, which is how it goes blank without saying so.
 *
 * The campus draws every office at 1:1 and lets the stage scroll, deliberately \u2014 fitting them
 * instead "shrinks every office until forty of them are indistinguishable smudges, which is the
 * exact failure real artwork is meant to fix". So the canvas grows with the project count.
 *
 * ## What that costs, measured in the running app
 *
 * Two synthetic workspaces, same machine, same window:
 *
 *     120 projects   canvas 1408 x 16696   drew fine, about 2.3s to switch
 *     600 projects   canvas 1408 x 81976   blank
 *
 * At 600 the height is past the browser's per-side ceiling. The attribute is accepted \u2014
 * `canvas.height` reads back as 81976 \u2014 and the backing store is not: a `fillRect` at the
 * origin reads back as transparent black. Nothing throws, nothing is logged, and the pane is
 * empty while the switcher lists 604 projects. A blank campus is a statement that there are no
 * offices, and it is the third standing order broken by an allocation nobody checked.
 *
 * ## Why this file asserts a shape and not a number
 *
 * The first version of it pinned a threshold of 467 offices. That was wrong, and wrong in an
 * instructive way: the card size is `thumbSize()`, derived from the floorplan, which depends on
 * how many people work there \u2014 and the column count comes from the window width. There is no
 * single ceiling. A workspace with more staff reaches it sooner, and a narrower window sooner
 * still, so a constant here would have been a number that is true on one machine.
 *
 * What is true everywhere is the mechanism: the layout grows without bound and never clamps,
 * so it will hand the renderer a size the browser accepts as an attribute and refuses as a
 * buffer. Capping it, paginating, or something else is a product decision the plan has already
 * rejected the obvious answer to; this only refuses to let the growth become bounded by accident
 * and unnoticed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  campusSize,
  canvasCeiling,
  fitCampus,
  layOutCampus,
  MAX_CANVAS_AREA,
  GAP,
  MAX_CANVAS_SIDE,
  NOTE_ROW,
  type CampusOffice,
} from '../src/shared/floor/campus.js'

const offices = (n: number): CampusOffice[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Project ${i}`,
    staff: 3,
    busy: false,
    waiting: 0,
    focused: false,
    session: null,
  }))

/** The layout at a card size and column count a caller chooses, the way the renderer does. */
const height = (n: number, cols: number, card: { width: number; height: number }): number =>
  campusSize(layOutCampus(offices(n), cols, card)).height

// Close to what the running app produced: 120 offices came back 8348 CSS pixels tall.
const REAL_CARD = { width: 160, height: 250 }
const REAL_COLS = 4

test('the layout matches the shape the running app produced', () => {
  // The control. Every claim below is about growth, and growth is only interesting if these
  // numbers are in the region the app actually reaches.
  const h = height(120, REAL_COLS, REAL_CARD)
  assert.ok(
    h > 5_000 && h < 12_000,
    `120 offices lay out ${h} pixels tall, which is nowhere near the 8348 the app produced — ` +
      `this file is no longer modelling the thing it was written about`,
  )
})

test('nothing caps the campus: it grows for as long as you add offices', () => {
  // The mechanism, and the only part that is true on every machine.
  const at = (n: number) => height(n, REAL_COLS, REAL_CARD)
  const steps = [100, 500, 1000, 4000].map(at)

  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(
      steps[i]! > steps[i - 1]!,
      `the layout stopped growing between ${[100, 500, 1000, 4000][i - 1]} and ` +
        `${[100, 500, 1000, 4000][i]} offices — something now caps it, and this file should say ` +
        `what instead of what follows`,
    )
  }

  assert.ok(
    steps.at(-1)! > MAX_CANVAS_SIDE,
    `four thousand offices ask for ${steps.at(-1)} pixels, which the browser can still allocate ` +
      `— the ceiling this was written about is no longer reachable by adding projects`,
  )
})

test('the ceiling is two bounds, and which one binds depends on the width', () => {
  // The correction that came out of review. A clamp written against the per-side limit alone is
  // right at the width it was measured at and wrong at every wider one.
  assert.equal(canvasCeiling(1408), MAX_CANVAS_SIDE, 'at a narrow campus the per-side bound is the one that binds')
  assert.ok(
    canvasCeiling(8192) < MAX_CANVAS_SIDE,
    'at 8192 wide the area bound should bite first — if it does not, the two bounds have been ' +
      'collapsed into one and a wider campus will blank under the ceiling this file states',
  )
  assert.equal(canvasCeiling(8192), 32_768)
})

test('the ceiling is reachable, and where depends on the workspace', () => {
  // Two workspaces, same project count, different floorplans: more staff means a bigger card
  // means a taller campus. This is why the threshold is not a constant.
  const small = height(400, REAL_COLS, { width: 160, height: 180 })
  const large = height(400, REAL_COLS, { width: 160, height: 320 })

  assert.ok(
    large > small,
    'a larger office card produced no taller a campus, so card size no longer drives the ceiling',
  )
  assert.ok(
    large > MAX_CANVAS_SIDE || small < MAX_CANVAS_SIDE,
    'both workspaces landed on the same side of the ceiling, so this comparison shows nothing',
  )
})

/**
 * ## Fitting a campus the engine will actually draw
 *
 * Everything above establishes that the layout never stops growing. This is what the renderer
 * does about it, and every rule in it came out of review by `office-space-6c` reading the design
 * before it was written \u2014 from a session that could not run a single command.
 */


const CARD = { width: 160, height: 250 }
const COLS = 4

const laidOut = (n: number, focusedIndex = -1) =>
  layOutCampus(
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      name: `Project ${i}`,
      staff: 3,
      waiting: 0,
      busy: false,
      focused: i === focusedIndex,
      session: null,
    })),
    COLS,
    CARD,
  )

test('a campus that already fits is left exactly alone', () => {
  // The control. A clamp that trims something is easy; one that trims nothing when nothing needs
  // trimming is the half that keeps ordinary workspaces untouched.
  const cards = laidOut(40)
  const fitted = fitCampus(cards, 100_000)
  assert.equal(fitted.omitted, 0)
  assert.equal(fitted.drawn.length, cards.length)
  assert.equal(fitted.drawn[0], cards[0], 'the cards were rebuilt rather than passed through')
})

test('a campus too tall loses whole rows, and says how many offices went', () => {
  const cards = laidOut(400)
  const fitted = fitCampus(cards, 4_000)

  assert.ok(fitted.omitted > 0, 'nothing was dropped from a campus far past the ceiling')
  assert.equal(fitted.drawn.length + fitted.omitted, cards.length, 'the count does not add up')
  assert.ok(campusSize(fitted.drawn).height <= 4_000, 'what survived is still too tall to draw')

  // Whole rows: a grid with half a row on the end is a hole, and row-major order is what makes
  // the layout learnable in the first place.
  assert.equal(fitted.drawn.length % COLS, 0, `${fitted.drawn.length} cards is not a whole number of rows`)
})

test('the office you are working in is never the one dropped', () => {
  // The sharpest of the review points. Dropping by position alone loses the focused office the
  // moment a workspace grows past the ceiling, and generated fixtures would never show it.
  const cards = laidOut(400, 390)
  const fitted = fitCampus(cards, 4_000)

  assert.ok(fitted.omitted > 0, 'nothing was dropped, so this proves nothing')
  assert.ok(
    fitted.drawn.some((c) => c.office.id === 'p390'),
    'the focused office was dropped. It sorts past the ceiling, and it is the one office the ' +
      'person is actually looking at.',
  )
  assert.equal(fitted.drawn.length + fitted.omitted, cards.length, 'pinning it changed the count')
})

test('the ceiling is both bounds, and which binds depends on the width', () => {
  assert.equal(canvasCeiling(1408), MAX_CANVAS_SIDE, 'at a narrow campus the per-side bound binds')
  assert.equal(canvasCeiling(8192), 32_768, 'at 8192 wide the area bound should arrive first')
  assert.ok(
    canvasCeiling(8192) < MAX_CANVAS_SIDE,
    'the two bounds have been collapsed into one, so a wider campus will blank under the ceiling',
  )
  assert.equal(MAX_CANVAS_AREA, 2 ** 28, 'the area cap measured at exactly 2^28; a different value wants re-measuring')
})

test('the ceiling accounts for device pixels, because that is what is allocated', () => {
  // The canvas is sized in device pixels and the layout is in CSS ones. A ceiling that forgot
  // the ratio would be twice as generous as the engine on every retina screen.
  assert.ok(
    canvasCeiling(1408, 2) < canvasCeiling(1408, 1),
    'doubling the device pixel ratio did not lower the ceiling, so the clamp is measuring the ' +
      'wrong pixels and will still blank on a retina display',
  )
})

// ─────────────────────────────────── the sentence that says what did not fit ────

/**
 * A partial campus says it is partial, and the saying needs somewhere to go.
 *
 * `drawOmittedNote` writes at `bounds.height - 4`, and the office names at
 * `rect.y1 + NAME_ROW - 6`. Two baselines two pixels apart, both inside the same twenty-pixel
 * name row. Seen in the running app at 620 projects:
 *
 *     620 projects · 480 drawn · the rest are in the switcher
 *     project 477      project 478      project 479
 *
 * printed over each other, so neither could be read. The sentence was right; the arithmetic that
 * makes room for it did not exist — which is the worse half, because a partial campus that cannot
 * say it is partial is a statement that the workspace has that many projects and no more.
 *
 * Only when there is something to say. A campus that fits pays nothing for a note it will not
 * draw, and a canvas one row taller than it needs would be the ceiling arithmetic being wrong in
 * the other direction.
 */
test('a campus with something omitted reserves a line to say so', () => {
  const cards = laidOut(40)
  const plain = campusSize(cards).height
  const withNote = campusSize(cards, 12).height

  assert.equal(
    withNote - plain,
    NOTE_ROW,
    'the note gets no room of its own, so it is drawn over the last row of office names and ' +
      'neither can be read',
  )
})

test('and a campus with nothing omitted pays nothing for it', () => {
  const cards = laidOut(40)
  assert.equal(campusSize(cards, 0).height, campusSize(cards).height, 'a full campus reserved a row for a note it will not draw')
})

test('an empty campus reserves it too, because "0 projects" is still a sentence', () => {
  // The empty case has its own branch and its own constant, so it is the one that silently
  // keeps the old arithmetic when the other is fixed.
  assert.equal(campusSize([], 3).height - campusSize([], 0).height, NOTE_ROW)
})

test('the note fits under the ceiling, and does not depend on a coincidence to', () => {
  /**
   * The whole point of trimming is that what is left can be drawn, and a note added *after* the
   * trim is a row outside the budget it was trimmed to.
   *
   * **This assertion cannot currently fail, and that is worth writing down rather than dressing
   * up.** `fitCampus` measures a row as `card.height + NAME_ROW + GAP` while `campusSize`
   * measures to the last card's `y1 + NAME_ROW` — so every trimmed campus already ends with
   * `GAP` = 16 pixels of slack, and the note is 14. Removing the `- NOTE_ROW` from the row
   * budget changes nothing at today's constants; it was mutation-tested and survived, twice,
   * including against a 1200-pixel sweep chosen to straddle every row boundary.
   *
   * The subtraction stays anyway, and the last assertion is why: today two constants happen to
   * be in the right order, and nothing said so. That is the same shape `ade-af` found in the
   * shipped-file manifest — a list that "applied the same exclusions" as another list and in
   * fact only ever *agreed* with it, because no case had yet distinguished them. The
   * subtraction makes the arithmetic true on its own terms; the assertion makes the coincidence
   * visible if somebody ever changes the constant that ends it.
   */
  const cards = laidOut(400)
  const tooTall: string[] = []
  let everTrimmed = false

  for (let ceiling = 1_200; ceiling <= 2_400; ceiling += 1) {
    const fitted = fitCampus(cards, ceiling)
    if (fitted.omitted === 0) continue
    everTrimmed = true
    const drawn = campusSize(fitted.drawn, fitted.omitted).height
    if (drawn > ceiling) tooTall.push(`ceiling ${ceiling}: ${drawn}`)
  }

  // The instrument. A sweep where nothing was ever trimmed reports a clean bill about nothing.
  assert.ok(everTrimmed, 'no ceiling in the sweep dropped anything, so this proves nothing')
  assert.deepEqual(
    tooTall.slice(0, 4),
    [],
    'the trim made room for the cards and not for the sentence explaining them, so the canvas ' +
      'ends up past the ceiling it was just trimmed to',
  )

  assert.ok(
    GAP >= NOTE_ROW,
    `GAP is ${GAP} and NOTE_ROW is ${NOTE_ROW}. The trailing gap no longer covers the note, so ` +
      `\`fitCampus\` subtracting NOTE_ROW from its row budget has stopped being belt-and-braces ` +
      `and started being the only thing keeping a trimmed campus under its ceiling. Check that it ` +
      `is still there before raising this.`,
  )
})
