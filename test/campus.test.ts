import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  campusFrom,
  campusSize,
  cardAt,
  columnsFor,
  GAP,
  hueFor,
  layOutCampus,
  NAME_ROW,
  attentionOf,
  markFor,
  waitingByProject,
  type CampusOffice,
} from '../src/shared/floor/campus.js'
import type { PendingApproval, ProjectInfo } from '../src/shared/ipc.js'

const office = (id: string, over: Partial<CampusOffice> = {}): CampusOffice => ({
  id, name: id, staff: 3, busy: false, waiting: 0, focused: false, session: null, ...over,
})

test('projects sit side by side, not on top of each other', () => {
  // The vision's actual correction to the tower: adjacent, so you can see them all at once.
  const cards = layOutCampus([office('a'), office('b')])
  assert.ok(cards[1]!.rect.x0 > cards[0]!.rect.x1, 'the second office should be to the right')
  assert.equal(cards[0]!.rect.y0, cards[1]!.rect.y0, 'and on the same row')
})

test('adding a project never moves the ones already there', () => {
  // The same promise desks make. An office you learned the position of stays put.
  const before = layOutCampus([office('a'), office('b'), office('c')])
  const after = layOutCampus([office('a'), office('b'), office('c'), office('d'), office('e')])
  for (const [i, card] of before.entries()) {
    assert.deepEqual(after[i]!.rect, card.rect, `office ${card.office.id} moved`)
  }
})

test('the campus grows down once a row is full', () => {
  const cards = layOutCampus([office('a'), office('b'), office('c'), office('d')], 3)
  assert.equal(cards[3]!.rect.x0, cards[0]!.rect.x0, 'wraps to the first column')
  assert.ok(cards[3]!.rect.y0 > cards[0]!.rect.y1, 'on a new row')
})

test('a colour is a property of the project, not of its position', () => {
  // Deleting a project in the middle must not repaint every office after it.
  const first = layOutCampus([office('alpha'), office('beta'), office('gamma')])
  const afterDeletingBeta = layOutCampus([office('alpha'), office('gamma')])
  assert.equal(afterDeletingBeta[1]!.hue, first[2]!.hue, 'gamma changed colour when beta went')
})

test('the same project is the same colour on every machine', () => {
  assert.equal(hueFor('office-space'), hueFor('office-space'))
  assert.notEqual(hueFor('alpha'), hueFor('beta'))
})

test('an empty campus still has a size, so the canvas can be fitted', () => {
  const { width, height } = campusSize([])
  assert.ok(width > 0 && height > 0)
})

test('clicking a card finds the office; clicking the gap finds nothing', () => {
  const cards = layOutCampus([office('a'), office('b')])
  const a = cards[0]!
  assert.equal(cardAt(cards, a.rect.x0, a.rect.y0)?.office.id, 'a')
  assert.equal(cardAt(cards, a.rect.x1 + 1, a.rect.y0), null, 'the gap between offices is not an office')
})

test('the last row of offices has room for its names', () => {
  // Names are drawn under their card, and rows after the first have the gap to sit in. The
  // last row has nothing below it, so without an extra row every office in it renders
  // anonymous — which is exactly how the first campus came out.
  const cards = layOutCampus([office('a'), office('b')])
  const { height } = campusSize(cards)
  assert.ok(height > cards[0]!.rect.y1 + 1, 'no room under the last row for a name')
})

test('a click on the name counts as a click on the office', () => {
  // Somebody aiming at a project aims at its label as readily as at its picture, and a click
  // that lands one pixel under the artwork and does nothing reads as the campus being broken
  // rather than as a miss.
  const cards = layOutCampus([office('a'), office('b')])
  const a = cards[0]!
  assert.equal(cardAt(cards, a.rect.x0 + 2, a.rect.y1 + 1)?.office.id, 'a', 'the name row is dead')
  assert.equal(cardAt(cards, a.rect.x0 + 2, a.rect.y1 + NAME_ROW + GAP)?.office.id, undefined)
})

test('the columns come from the width there actually is', () => {
  // Wide windows pack more per row and narrow ones wrap. Fitting every office into one
  // screenful instead would shrink forty offices until none of them was distinguishable, which
  // is the thing a campus of real artwork exists to avoid.
  // Four 200px cards plus three 16px gaps is 848, which fits in 1000; five would be 1064.
  assert.equal(columnsFor(1000, 200), 4)
  // Three would be 632 and the window is 600, so two. Computed rather than eyeballed — my first
  // guess here was three, and the arithmetic is the point of having the function at all.
  assert.equal(columnsFor(600, 200), 2)
  assert.equal(columnsFor(200, 200), 1)
})

test('a window narrower than one office still shows one', () => {
  // One office cut off is the better of two bad answers; zero columns is a divide by zero
  // dressed as a layout.
  assert.equal(columnsFor(50, 200), 1)
  assert.equal(columnsFor(0, 200), 1)
  assert.equal(columnsFor(-100, 200), 1)
})

test('a card is exactly one office, so the grid follows the artwork', () => {
  // The layout used to be a tile count somebody guessed, which meant re-tuning it whenever the
  // floor plan changed. It is the rendered bounds now.
  const cards = layOutCampus([office('a')], 3, { width: 312, height: 168 })
  assert.equal(cards[0]!.rect.x1 - cards[0]!.rect.x0, 312)
  assert.equal(cards[0]!.rect.y1 - cards[0]!.rect.y0, 168)
})


// ────────────────────────────────────── what a card is asking of you ──

test('a held decision outranks a running manager, because they are opposite questions', () => {
  /*
   * The defect this answers, in the code's own words. `floor-view.ts` said of the busy outline:
   * *"It answers 'which of these wants me' without opening any of them, which is the reason to
   * draw a campus at all."*
   *
   * It answers the opposite. A project whose manager is running is **working** and wants
   * nothing; a project holding a decision at the gate has **stopped**, and the hook refuses it
   * after four minutes whether or not anybody looked. So a card that marked only `busy` was
   * telling somebody to open the one office that needed them least.
   *
   * They are not exclusive — a project with several conversations can have one held while
   * another runs — which is why this is a ranking and not a branch.
   */
  assert.equal(attentionOf(office('a', { busy: true, waiting: 2 })), 'waiting')
  assert.equal(attentionOf(office('b', { busy: true, waiting: 0 })), 'busy')
  assert.equal(attentionOf(office('c', { busy: false, waiting: 1 })), 'waiting')
})

test('an office nobody is waiting on is not marked at all', () => {
  // Most offices are idle most of the time. A mark on every card is a mark on none, which is the
  // argument `planWarning` makes for staying silent below its threshold.
  assert.equal(attentionOf(office('d', { busy: false, waiting: 0 })), 'idle')
})

test('waiting is a count, because two in one office is a different morning from one each in two', () => {
  /*
   * Rewritten: this asserted its own title and built none of it. It made one office with
   * `waiting: 2`, checked `two.waiting === 2` — which tests that this file's `office()` helper
   * spreads its override, and touches no `src/` code at all — and then repeated the ranking
   * assertion from twelve lines above.
   *
   * The title's claim is about *counting*, so it is checked where counting happens. Two held
   * calls in one office and one each in two are the two shapes, and they must not collapse to
   * the same answer.
   */
  const twoInOne = waitingByProject([held('alpha'), held('alpha', 't2')])
  const oneEach = waitingByProject([held('alpha'), held('beta', 't2')])

  assert.equal(twoInOne.get('alpha'), 2)
  assert.equal(twoInOne.size, 1, 'two calls in one office were spread across two')

  assert.equal(oneEach.get('alpha'), 1)
  assert.equal(oneEach.get('beta'), 1)
  assert.equal(oneEach.size, 2, 'one call each in two offices was collapsed into one')

  // And the count survives to the office the card is drawn from, which is the whole reason it is
  // a number rather than a flag at the boundary.
  assert.equal(attentionOf(office('e', { waiting: twoInOne.get('alpha') ?? 0 })), 'waiting')
})

test('the two marks differ by more than colour, so the distinction survives not seeing colour', () => {
  /*
   * The theme row is the precedent and it is exact: two palettes shipped whose grounds were 2, 1
   * and 6 out of 255 apart. The choice was real, the code rewrote 41 CSS variables, and nobody
   * could see it — so the first control anybody pressed appeared to do nothing.
   *
   * A campus mark has more riding on it than a theme does. If "waiting" and "busy" resolve to
   * one appearance, somebody opens the office that needs them least, which is what the outline
   * existed to prevent.
   */
  const waiting = markFor(office('a', { waiting: 1 }))
  const busy = markFor(office('b', { busy: true }))

  assert.ok(waiting && busy)
  assert.notEqual(waiting.role, busy.role, 'both marks ask the palette for the same colour')
  assert.notEqual(waiting.width, busy.width, 'the two marks are separated by colour alone')
  assert.ok(waiting.width > busy.width, 'the one that needs a person is not the heavier of the two')
})

test('an idle office is given no mark at all, not a faint one', () => {
  // `null` rather than a third style. A mark on every card is a mark on none — the argument
  // `planWarning` makes for staying silent below its threshold.
  assert.equal(markFor(office('c')), null)
})

test('the mark is a palette role, never a colour', () => {
  /*
   * `campus.ts` is a pure module and a hex here would be the one literal it must not hold — the
   * campus chrome and the interface would then drift the way `styles.css` and `props.ts` did.
   * The renderer resolves the role against whatever the live theme says, so switching theme
   * moves the outline with everything else.
   */
  for (const o of [office('d', { waiting: 1 }), office('e', { busy: true })]) {
    const mark = markFor(o)
    assert.ok(mark)
    assert.doesNotMatch(mark.role, /^#/, 'a colour was baked into the pure layer')
    assert.ok(['warn', 'accent'].includes(mark.role))
  }
})


// ─────────────────────────────────── attributing a held call to an office ──

/** An approval as main forwards it. Only the two fields this counting cares about vary. */
const held = (project: string | null, id = 't'): PendingApproval => ({
  sessionId: 's', project, toolUseId: id, tool: 'Bash',
  input: { command: 'npm test' }, askedAt: '2026-09-05T02:00:00.000Z', waitMs: null, agent: null,
})

test('a held call is counted against the office it is blocking, not the one you are looking at', () => {
  /*
   * The defect this replaced, and it defeated the whole feature. The renderer used to attribute
   * approvals through a map it fills while opening projects — and `watchSessions` returns early
   * on `list.project !== active`, so that map only ever holds the office you have opened.
   *
   * A held call in an office you had *not* opened was therefore attributed to nothing and drew no
   * mark, which is exactly the office a campus exists to tell you about. Measured on the previous
   * version with two offices each holding one call: the opened one showed `waiting`, the other
   * showed `idle`.
   *
   * `project` now arrives from main off the session registry, which can answer for every session
   * in the workspace rather than for the one window's history.
   */
  const counted = waitingByProject([held('alpha'), held('beta', 't2'), held('beta', 't3')])

  assert.equal(counted.get('alpha'), 1)
  assert.equal(counted.get('beta'), 2, 'two calls held in one office read as one')
})

test('a call the office cannot place is dropped, never bucketed', () => {
  /*
   * `null` is main saying the registry has not recorded that session yet. Two wrong answers were
   * available and both put a number on a card nobody earned: counting it against the open project
   * puts somebody else's held call on your office, and counting it under its own key marks an
   * office that does not exist.
   */
  const counted = waitingByProject([held(null), held('alpha')])

  assert.equal(counted.get('alpha'), 1)
  assert.equal(counted.size, 1, 'an unplaceable call was given a bucket of its own')
  assert.equal(counted.get(''), undefined, 'an unplaceable call was attributed to the office itself')
})

test("the office's own project is an empty string, and that is a project like any other", () => {
  /*
   * `OFFICE_PROJECT = ''` — the unscoped conversation every workspace has, and on a real
   * registry the majority of rows. So `''` is a project id, and the only falsy one.
   *
   * Written because the first three cases used `'alpha'`, `'beta'` and `null` and never touched
   * the one id where the distinction bites. Measured: changing `approval.project === null` to
   * `!approval.project` — which silently drops every held call in the office itself — passed all
   * of them green.
   */
  const counted = waitingByProject([held(''), held('', 't2'), held('alpha', 't3')])

  assert.equal(counted.get(''), 2, "the office's own held calls were dropped as though unplaceable")
  assert.equal(counted.get('alpha'), 1)
})

test('no held calls is an empty map, not a map of zeroes', () => {
  // So a card asks `?? 0` and gets the same answer either way, rather than the office keeping a
  // row per project saying nothing is happening there.
  assert.equal(waitingByProject([]).size, 0)
})

// ────────────────────────────────────────────── the campus, built from what main sends ──

/**
 * A project row as main sends it. `running` is the field under test; the rest are the
 * defaults a never-opened project has, so a fixture cannot accidentally answer through one
 * of them.
 */
const row = (id: string, over: Partial<ProjectInfo> = {}): ProjectInfo => ({
  id,
  name: id,
  missing: [],
  conversations: 0,
  lastActiveAt: null,
  running: false,
  ...over,
})

test('an office nobody has opened is busy when main says it is running', () => {
  /*
   * The defect this function was moved out of `app.ts` to make visible. The renderer knew which
   * projects were busy only from tabs it had opened — `watchSessions` returns early on
   * `list.project !== active` — so a project working away in a window you had never visited drew
   * an unmarked card. On the surface whose entire job is the offices you are *not* looking at.
   *
   * `seenBusy` is empty here on purpose: that is what a never-opened office looks like.
   */
  const campus = campusFrom([row('alpha', { running: true }), row('beta')], 7, new Map(), 'beta', new Set(), new Map(), new Set())

  assert.equal(
    campus.find((o) => o.id === 'alpha')?.busy,
    true,
    'a running project this window never opened drew a card that said nothing was happening',
  )
  assert.equal(campus.find((o) => o.id === 'beta')?.busy, false, 'an idle project was marked busy')
})

test('a tab that just started working marks its office before the next snapshot lands', () => {
  // The other half of the union, and the reason the renderer's set is kept rather than replaced.
  // Main's `running` arrives on a snapshot; the tab knows immediately. `running: false` here is
  // main not having caught up yet, not main saying no.
  const campus = campusFrom([row('alpha')], 7, new Map(), 'alpha', new Set(['alpha']), new Map(), new Set())

  assert.equal(campus[0]?.busy, true, 'the office you are watching work looked idle until the next snapshot')
})

test('the count of held calls reaches the office it was held in', () => {
  const campus = campusFrom(
    [row('alpha'), row('beta')],
    7,
    new Map([
      ['alpha', 3],
      ['beta', 1],
    ]),
    'alpha',
    new Set(),
    new Map(),
    new Set(),
  )

  assert.equal(campus.find((o) => o.id === 'alpha')?.waiting, 3)
  assert.equal(campus.find((o) => o.id === 'beta')?.waiting, 1)
})

test('a project with no held calls carries zero, not undefined', () => {
  // `held.get()` misses for every project that is fine, which is most of them. A `?? 0` dropped
  // here would put `undefined` on the field `attentionOf` compares with `> 0` — false, by luck
  // rather than by rule, and typed as a number the whole way.
  const campus = campusFrom([row('alpha')], 7, new Map(), 'alpha', new Set(), new Map(), new Set())

  assert.equal(campus[0]?.waiting, 0)
})

test('only the open project is focused', () => {
  const campus = campusFrom([row('alpha'), row('beta')], 7, new Map(), 'beta', new Set(), new Map(), new Set())

  assert.deepEqual(
    campus.filter((o) => o.focused).map((o) => o.id),
    ['beta'],
  )
})
