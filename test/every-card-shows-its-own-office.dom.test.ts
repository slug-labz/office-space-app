/**
 * Every card on the campus is a picture of its own office.
 *
 * `drawCampus` painted each card from `thumbFor(office.id)` — a **project** id. Every fact the
 * floor is fed arrives keyed by **conversation**: `main.ts` sends `session.id` on
 * `CHANNEL.event`, `app.ts` hands that to `floor.apply`, and `setProject` is given the
 * conversation being opened. So the scene a card was painted from was one nothing ever wrote to:
 * a project whose builder had just been sent off showed a quiet office, and so did every other
 * card. Measured before this file existed: beta's own floor showed the builder working, beta's
 * card did not, and the view held scenes called `alpha` and `beta` that the cards had created
 * for themselves.
 *
 * The same swap carried the other half. `paintThumb` redirected the context, the bounds and the
 * scene, and nothing else — so the VERIFY marks and room readings, which `app.ts` only ever sets
 * for the open project, were painted onto every card on the campus.
 *
 * ## How it is read
 *
 * From the calls each card's own canvas recorded. A thumbnail is an offscreen canvas that the
 * campus blits with a five-argument `drawImage`, so the campus's calls say which picture went on
 * which card, and that picture's calls say what was in it. The name tags carry both marks this
 * file asks about: `drawLabel` puts a 2x2 square right of a name for "working this second" and
 * one left of it for how their outstanding work stands. Nothing here is about pixels.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import type { ClaudeEvent } from '../src/main/claude/stream.js'
import { FloorView, type FloorCallbacks } from '../src/renderer/floor-view.js'
import {
  campusFrom,
  following,
  pictureOf,
  runKnown,
  type CampusOffice,
  type RunNews,
} from '../src/shared/floor/campus.js'
import type { ProjectInfo, SpriteSheet, StaffMember } from '../src/shared/ipc.js'

installDom()

type Call = { readonly method: string; readonly args: readonly unknown[] }

const FRAME_W = 16
const FRAME_H = 24
const SHEET: Extract<SpriteSheet, { kind: 'painted' }> = {
  kind: 'painted',
  width: FRAME_W,
  height: FRAME_H,
  frames: {
    down: [new Uint8ClampedArray(FRAME_W * FRAME_H * 4)],
    up: [new Uint8ClampedArray(FRAME_W * FRAME_H * 4)],
    right: [new Uint8ClampedArray(FRAME_W * FRAME_H * 4)],
  },
}

const person = (id: string, isManager = false): StaffMember => ({
  id,
  name: id,
  description: `the ${id}`,
  tools: [],
  model: null,
  isManager,
})
const STAFF = [person('manager', true), person('builder'), person('reviewer')]
const NAMES = ['Alpha', 'Beta', 'Gamma']

/** One project as the campus is told about it, with the conversation its card should show. */
const office = (
  name: string,
  session: string | null,
  focused = false,
  over: Partial<CampusOffice> = {},
): CampusOffice => ({
  id: name.toLowerCase(),
  name,
  staff: STAFF.length,
  busy: false,
  waiting: 0,
  focused,
  session,
  ...over,
})

const pending = (): number => (globalThis as unknown as Record<string, () => number>)['__pendingFrames']!()
const runFrame = (now: number): number =>
  (globalThis as unknown as Record<string, (n: number) => number>)['__runFrame']!(now)
const recorded = (canvas: unknown): Call[] =>
  (canvas as { getContext(kind: '2d'): { calls: Call[] } }).getContext('2d').calls

/**
 * Who a picture of an office shows, and the two marks on each name tag.
 *
 * `drawLabel` writes the name, then a 2x2 square to its right when the person is working and a
 * 2x2 square to its left when their work has an outcome. Both sit on the tag's row, so the side
 * of the name is the whole distinction.
 */
function tags(calls: readonly Call[]): Map<string, { working: boolean; marked: boolean }> {
  const found = new Map<string, { working: boolean; marked: boolean }>()
  calls.forEach((call, at) => {
    if (call.method !== 'fillText') return
    const [text, x, y] = call.args as [unknown, number, number]
    if (typeof text !== 'string' || !STAFF.some((s) => s.id === text)) return
    const squares = calls
      .slice(at + 1, at + 3)
      .filter((c) => c.method === 'fillRect' && c.args[1] === y - 4 && c.args[2] === 2 && c.args[3] === 2)
    found.set(text, {
      working: squares.some((c) => (c.args[0] as number) > x),
      marked: squares.some((c) => (c.args[0] as number) < x),
    })
  })
  return found
}

const working = (calls: readonly Call[]): string[] =>
  [...tags(calls)].filter(([, t]) => t.working).map(([who]) => who)
const marked = (calls: readonly Call[]): string[] =>
  [...tags(calls)].filter(([, t]) => t.marked).map(([who]) => who)

/**
 * Where two paints first differ, or `null` when they made the same calls.
 *
 * Objects in the arguments — bitmaps, gradients — are compared by position only, so two paints of
 * the same office compare equal whichever canvas they went to.
 */
function firstDifference(a: readonly Call[], b: readonly Call[]): string | null {
  const one = (c: Call | undefined): string =>
    c === undefined
      ? '(nothing)'
      : `${c.method}(${c.args.map((x) => (typeof x === 'object' && x !== null ? '[object]' : String(x))).join(', ')})`
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (one(a[i]) !== one(b[i])) return `call ${i} of ${a.length} vs ${b.length}: ${one(a[i])} vs ${one(b[i])}`
  }
  return null
}

interface Rig {
  readonly view: FloorView
  readonly stage: El
  /** Frames with the clock moving, so walks and pauses actually progress. */
  readonly run: (frames: number) => void
  /** The office on screen, painted once. Its canvas calls. */
  readonly office: () => Call[]
  /** The campus, painted until the loop parks. Each card's picture by office name — `null` for none. */
  readonly campus: () => Map<string, Call[] | null>
  /** From the last campus paint: where a card's ground was drawn, and the canvas blitted onto it. */
  readonly card: (name: string) => { readonly x: number; readonly y: number; readonly picture: unknown } | undefined
  readonly click: (x: number, y: number) => void
  readonly bubbles: () => number
  readonly done: () => void
}

async function floor(): Promise<Rig> {
  const canvas = document.createElement('canvas')
  const stage = document.createElement('div') as unknown as El
  stage.clientWidth = 800
  stage.clientHeight = 600

  const callbacks: FloorCallbacks = {
    onPick: () => {},
    onUnstaged: () => {},
    onDetails: () => {},
    onArtFailed: () => {},
    onStale: () => {},
    onPickProject: () => {},
  }
  const view = new FloorView(canvas as never, stage as never, callbacks)
  await view.setCast(STAFF, async () => SHEET, 'a-theme')

  let clock = 0
  const perf = globalThis.performance as { now: () => number }
  const realNow = perf.now.bind(perf)
  perf.now = () => clock

  const placed = new Map<string, { x: number; y: number; picture: unknown }>()

  // Painting runs on a frozen clock. Nothing walks and the cat keeps its pose, so two paints of
  // the same office can be compared call for call.
  const settle = (): void => {
    view.start()
    let ran = 0
    while (pending() > 0 && ran < 200) {
      runFrame(clock)
      ran += 1
    }
    assert.ok(ran < 200, 'the floor never stopped asking for frames, so nothing here settles')
  }

  return {
    view,
    stage,
    run: (frames) => {
      view.start()
      for (let i = 0; i < frames; i += 1) {
        clock += 16
        runFrame(clock)
      }
    },
    office: () => {
      view.setView('office')
      const calls = recorded(canvas)
      calls.length = 0
      view.invalidate()
      view.start()
      runFrame(clock)
      return [...calls]
    },
    campus: () => {
      view.setView('campus')
      const calls = recorded(canvas)
      calls.length = 0
      view.invalidate()
      settle()
      // A card is its ground, then its picture if it has one, then its name — in that order.
      const cards = new Map<string, Call[] | null>()
      let ground: { x: number; y: number } | null = null
      let picture: unknown = null
      for (const call of calls) {
        if (call.method === 'fillRect' && ground === null) ground = { x: call.args[0] as number, y: call.args[1] as number }
        if (call.method === 'drawImage' && call.args.length === 5) picture = call.args[0]
        const [text] = call.args
        if (call.method === 'fillText' && typeof text === 'string' && NAMES.includes(text)) {
          cards.set(text, picture === null ? null : recorded(picture))
          if (ground) placed.set(text, { ...ground, picture })
          ground = null
          picture = null
        }
      }
      return cards
    },
    card: (name) => placed.get(name),
    click: (x, y) =>
      (canvas as unknown as El).dispatchEvent({ type: 'click', bubbles: true, clientX: x, clientY: y } as never),
    bubbles: () => stage.querySelectorAll('.bubble').length,
    done: () => {
      // The frame queue is global to the harness; a floor left running here would hold the next
      // test's settle open.
      view.stop()
      perf.now = realNow
    },
  }
}

test("a card shows the work going on in its own project's conversation", async () => {
  const rig = await floor()
  try {
    // Beta's conversation is open, and the manager sends the builder off in it.
    rig.view.setCampus([office('Alpha', 'sess-a'), office('Beta', 'sess-b', true)])
    rig.view.setProject('sess-b')
    rig.view.apply('sess-b', [{ kind: 'dispatch', toolUseId: 'toolu_b1', employee: 'builder', brief: 'build it' }])

    let frames = 0
    while (rig.view.reasonFor('builder').trace !== null && frames < 3_000) {
      rig.run(1)
      frames += 1
    }
    assert.equal(rig.view.reasonFor('builder').trace, null, 'the briefing never finished, so there is nothing to look for')

    // The control. Beta's own floor has to show the work, or a card that does not proves nothing.
    assert.deepEqual(working(rig.office()), ['builder'], "beta's own floor does not show the builder working")

    // Now over to alpha, and zoom out — what `switchTo` and the view toggle do.
    rig.view.setCampus([office('Alpha', 'sess-a', true), office('Beta', 'sess-b')])
    rig.view.setProject('sess-a')
    const cards = rig.campus()

    const beta = cards.get('Beta')
    assert.ok(beta, "beta's card was drawn with no picture of its office at all")
    assert.deepEqual(
      working(beta),
      ['builder'],
      "beta's floor has the builder at work and beta's card shows nobody working. The card is a " +
        'picture of a scene nothing ever feeds: facts arrive by conversation, and the card was ' +
        'looked up by project.',
    )

    const alpha = cards.get('Alpha')
    assert.ok(alpha, "alpha's card was drawn with no picture of its office at all")
    assert.deepEqual(working(alpha), [], "alpha's card shows somebody working, and nobody has been sent anywhere in alpha")
  } finally {
    rig.done()
  }
})

test('a card this window has no conversation for shows a quiet office while nothing happens there', async () => {
  // Main says no turn is running in gamma and no call is held there, and a floor nothing has
  // happened on is a quiet office: its staff, nobody working, no marks. The picture must be its
  // own scene, not a conversation this window is following somewhere else.
  const rig = await floor()
  try {
    rig.view.setCampus([office('Alpha', 'sess-a', true), office('Gamma', null)])
    rig.view.setProject('sess-a')
    rig.view.apply('sess-a', [{ kind: 'dispatch', toolUseId: 'toolu_a1', employee: 'builder', brief: 'build it' }])
    let frames = 0
    while (rig.view.reasonFor('builder').trace !== null && frames < 3_000) {
      rig.run(1)
      frames += 1
    }
    rig.view.setOutcomes(new Map([['reviewer', 'failed']]))
    const cards = rig.campus()

    // The control: alpha, which this window is following, shows its own work and its own marks.
    assert.deepEqual(working(cards.get('Alpha') ?? []), ['builder'], "alpha's card does not show alpha's builder working")
    assert.deepEqual(marked(cards.get('Alpha') ?? []), ['reviewer'], "alpha's card does not show alpha's failed VERIFY")

    const gamma = cards.get('Gamma')
    assert.ok(gamma, "gamma's card has no picture, though main says nothing is happening there")
    assert.deepEqual([...tags(gamma).keys()].sort(), ['builder', 'manager', 'reviewer'], 'the quiet office is not furnished from the roster')
    assert.deepEqual(working(gamma), [], "gamma's quiet office shows somebody working")
    assert.deepEqual(marked(gamma), [], "gamma's quiet office carries another project's VERIFY marks")
  } finally {
    rig.done()
  }
})

test('a card this window has no conversation for shows no office while something happens there', async () => {
  // A new window on a Mac starts knowing nothing, while `main` can still be running a project it
  // was left with (`window-all-closed` does not quit there). Any picture of that office — people
  // at their desks, dark screens, idle racks — is a statement about who is working that this
  // window has nothing to base on. The outline still says what main knows.
  const rig = await floor()
  try {
    rig.view.setCampus([
      office('Alpha', 'sess-a', true),
      office('Beta', null, false, { waiting: 1 }),
      office('Gamma', null, false, { busy: true }),
    ])
    rig.view.setProject('sess-a')
    const cards = rig.campus()

    assert.ok(cards.has('Beta') && cards.has('Gamma'), 'the cards were not drawn at all, so there is nothing to check')
    for (const name of ['Beta', 'Gamma']) {
      const card = cards.get(name)
      assert.ok(
        card === null,
        `${name}: an office main says something is happening in was painted as a picture this window ` +
          `cannot back: ${[...tags(card ?? []).keys()].join(', ')}`,
      )
    }
    assert.ok(cards.get('Alpha'), "the open project's card lost its picture too")
  } finally {
    rig.done()
  }
})

test("a busy project's card shows no picture of a conversation whose run this window did not watch", async () => {
  // Review's scenario, measured on be0db19. Beta is busy because its second conversation, sess-b2,
  // has the builder at work, and the conversation beta last showed, sess-b1, is idle: beta's card
  // was drawn from sess-b1, with nobody working. Gamma is busy too, and this window opened its
  // conversation after the run began, so no fact of that run ever reached its floor. `campusFrom`
  // decides both, so the offices come from it, as `renderSwitcher` builds them.
  const rig = await floor()
  try {
    const row = (name: string, running: boolean): ProjectInfo => ({
      id: name.toLowerCase(),
      name,
      missing: [],
      conversations: 2,
      lastActiveAt: null,
      running,
    })
    const projects = [row('Alpha', false), row('Beta', true), row('Gamma', true)]
    // sess-b2's run, watched from its start: the builder is sent off in it.
    const followed = new Set(['sess-b2'])
    const show = (beta: string): void =>
      rig.view.setCampus(
        campusFrom(
          projects,
          STAFF.length,
          new Map(),
          'alpha',
          new Set(),
          new Map([
            ['alpha', 'sess-a'],
            ['beta', beta],
            ['gamma', 'sess-g'],
          ]),
          followed,
        ),
      )

    rig.view.setProject('sess-b2')
    rig.view.apply('sess-b2', [{ kind: 'dispatch', toolUseId: 'toolu_b2', employee: 'builder', brief: 'build it' }])
    let frames = 0
    while (rig.view.reasonFor('builder').trace !== null && frames < 3_000) {
      rig.run(1)
      frames += 1
    }
    assert.equal(rig.view.reasonFor('builder').trace, null, 'the briefing never finished, so there is nothing to look for')
    // Then beta's other conversation is opened, gamma's is opened mid-run, and alpha last.
    rig.view.setProject('sess-b1')
    rig.view.setProject('sess-g')
    rig.view.setProject('sess-a')

    show('sess-b1')
    const cards = rig.campus()
    assert.ok(cards.has('Beta') && cards.has('Gamma'), 'the cards were not drawn at all, so there is nothing to check')
    for (const name of ['Beta', 'Gamma']) {
      const card = cards.get(name)
      assert.ok(
        card === null,
        `${name} is busy and its card is a picture of a conversation whose run this window did not watch, ` +
          `with ${working(card ?? []).join(', ') || 'nobody'} working`,
      )
    }
    assert.ok(cards.get('Alpha'), 'alpha is quiet and its card lost its picture')

    // The control: a card showing the conversation this window did watch shows its work.
    show('sess-b2')
    assert.deepEqual(
      working(rig.campus().get('Beta') ?? []),
      ['builder'],
      "beta's card shows the conversation that is working and not its builder at work, so the check above proves nothing",
    )
  } finally {
    rig.done()
  }
})

test('a card shows its conversation, else a quiet office only while nothing happens there', () => {
  assert.equal(pictureOf(office('Alpha', 'sess-a')), 'sess-a')
  assert.equal(pictureOf(office('Alpha', 'sess-a', false, { busy: true, waiting: 2 })), 'sess-a')
  assert.equal(pictureOf(office('Gamma', null)), 'quiet:gamma')
  assert.equal(pictureOf(office('Gamma', null, false, { busy: true })), null)
  assert.equal(pictureOf(office('Gamma', null, false, { waiting: 1 })), null)
  // Keyed apart from every conversation, so a project named like one does not borrow its picture.
  assert.notEqual(pictureOf({ ...office('Gamma', null), id: 'sess-a' }), 'sess-a')
})

test('each office is told the conversation its project was last showing, and none when there is not one', () => {
  // The wiring half. `app.ts` hands `lastSession` over and nothing in the suite reaches that file,
  // so the mapping is stated here, where `campusFrom` keeps it. The office's own project has the
  // id `''`, which is a real key and a falsy one.
  const row = (id: string): ProjectInfo => ({
    id,
    name: id || 'The office',
    missing: [],
    conversations: 1,
    lastActiveAt: null,
    running: false,
  })
  const campus = campusFrom(
    [row(''), row('alpha'), row('gamma')],
    STAFF.length,
    new Map(),
    'alpha',
    new Set(),
    new Map([
      ['', 'sess-office'],
      ['alpha', 'sess-a'],
    ]),
    new Set(),
  )

  assert.deepEqual(
    campus.map((o) => [o.id, o.session]),
    [
      ['', 'sess-office'],
      ['alpha', 'sess-a'],
      ['gamma', null],
    ],
  )
})

/**
 * The conversation `campusFrom` gives one project's card.
 *
 * Every project shows a conversation of its own here, except `gamma`, which this window has not
 * opened. `beta`'s is `sess-b1`; review's case has `sess-b2`, beta's other conversation, at work.
 */
function sessionFor(
  id: string,
  how: {
    readonly running?: boolean
    readonly seenBusy?: boolean
    readonly held?: number
    readonly followed?: readonly string[]
  } = {},
): string | null {
  const showing = new Map([
    ['', 'sess-office'],
    ['alpha', 'sess-a'],
    ['beta', 'sess-b1'],
  ])
  const [office] = campusFrom(
    [{ id, name: id || 'The office', missing: [], conversations: 2, lastActiveAt: null, running: how.running ?? false }],
    STAFF.length,
    new Map(how.held ? [[id, how.held]] : []),
    'alpha',
    new Set(how.seenBusy ? [id] : []),
    showing,
    new Set(how.followed ?? []),
  )
  assert.ok(office, 'campusFrom dropped the project')
  return office.session
}

test("a quiet project's card is its conversation, whether or not this window watched it run", () => {
  // Nothing is running and nothing is held, so the conversation's picture can only show that:
  // nobody working, whatever this window missed.
  assert.equal(sessionFor('alpha'), 'sess-a', 'a quiet project lost the picture of its own conversation')
  assert.equal(sessionFor('alpha', { followed: ['sess-a'] }), 'sess-a')
  assert.equal(sessionFor('gamma'), null, 'a project with no conversation in this window was given one')
})

test("a busy project's card is not a picture of a conversation whose run this window did not watch", () => {
  // Measured in review: beta was busy because sess-b2 was working, while the conversation beta had
  // last shown, sess-b1, was idle, and beta's card was drawn from sess-b1 with nobody working. And
  // a conversation opened after its run began never shows that run's work: `restore` puts the
  // transcript back and no facts, and an employee is drawn working only through `dispatch`.
  assert.equal(
    sessionFor('beta', { running: true, followed: ['sess-b2'] }),
    null,
    "beta is busy in a conversation its card is not a picture of, and the card shows sess-b1's floor",
  )
  assert.equal(
    sessionFor('beta', { running: true }),
    null,
    'beta is busy and this window has watched no run of its, and the card still shows a picture',
  )
  assert.equal(
    sessionFor('beta', { seenBusy: true }),
    null,
    "busy on the renderer's own signal is still busy, and the card still shows a picture",
  )
})

test("a busy project's card is its conversation while this window watches that conversation's run", () => {
  assert.equal(
    sessionFor('beta', { running: true, followed: ['sess-b1'] }),
    'sess-b1',
    'this window has watched the run from its start, and the card lost its picture anyway',
  )
  assert.equal(sessionFor('beta', { seenBusy: true, followed: ['sess-b1'] }), 'sess-b1')
  // Followed runs are conversations. A project id in the set is no reason to trust a picture.
  assert.equal(
    sessionFor('beta', { running: true, followed: ['beta'] }),
    null,
    'a project id in the followed set was read as the conversation being followed',
  )
  // Nor does a followed run give a project with no conversation in this window a picture.
  assert.equal(sessionFor('gamma', { running: true, followed: ['sess-b1'] }), null)
})

test('a project holding a call gets its picture on the same terms as a busy one', () => {
  // `attentionOf` puts waiting ahead of busy, and a held call is inside a run. A picture of a
  // conversation this window did not watch cannot show who is waiting on it.
  assert.equal(
    sessionFor('beta', { held: 1 }),
    null,
    'beta holds a call in a run this window did not watch, and its card still shows a picture',
  )
  assert.equal(sessionFor('beta', { held: 1, followed: ['sess-b1'] }), 'sess-b1')
})

test("the office's own project, whose id is empty, follows the same rule", () => {
  assert.equal(sessionFor('', { running: true }), null, "the office's own project is busy and unwatched, and its card has a picture")
  assert.equal(sessionFor('', { running: true, followed: ['sess-office'] }), 'sess-office')
  assert.equal(sessionFor(''), 'sess-office', "the office's own project is quiet and lost its picture")
})

test('a message sent while no run is going is followed from the send', () => {
  assert.equal(
    following(false, { kind: 'sent', running: false }),
    true,
    'a turn this window started was not followed until its init, so its card had no picture before then',
  )
  // Queued behind a run that may have begun before this window was watching.
  assert.equal(
    following(false, { kind: 'sent', running: true }),
    false,
    'a message queued behind a run this window did not watch made that run followed',
  )
  assert.equal(following(true, { kind: 'sent', running: true }), true)
})

test("of a run's own events, only init starts following it, and none ends it, result included", () => {
  assert.equal(following(false, { kind: 'event', event: 'init' }), true, 'init did not start following the run')
  assert.equal(
    following(true, { kind: 'event', event: 'result' }),
    true,
    "a result stopped following the run, which leaves a busy card with no picture until main's idle",
  )
  assert.equal(following(false, { kind: 'event', event: 'result' }), false)
  assert.equal(following(false, { kind: 'event', event: 'assistant' }), false, 'a run joined halfway was followed from one of its later events')
  assert.equal(following(true, { kind: 'event', event: 'assistant' }), true)

  // Every other kind can arrive after the run began. `system` does in every turn: a turn streams
  // partial messages, and their `message_start`, `message_delta` and `message_stop` records are
  // read as `system` (`stream.ts`). The list is checked against `ClaudeEvent`, so a new kind has
  // to be added here.
  const others = {
    assistant: 0, user: 0, result: 0, 'rate-limit': 0, retry: 0, partial: 0, 'partial-end': 0,
    'task-started': 0, 'task-finished': 0, system: 0, unparsed: 0,
  } satisfies Record<Exclude<ClaudeEvent['kind'], 'init'>, 0>
  for (const kind of Object.keys(others)) {
    assert.equal(
      following(false, { kind: 'event', event: kind }),
      false,
      `a run joined halfway was followed from its ${kind} event`,
    )
    assert.equal(following(true, { kind: 'event', event: kind }), true, `a ${kind} event stopped following`)
  }
})

test("main's phase ends a run unless it is running, and a failed send starts nothing and ends only a run it was to start", () => {
  assert.equal(following(true, { kind: 'phase', phase: 'running' }), true)
  assert.equal(
    following(false, { kind: 'phase', phase: 'running' }),
    false,
    "main's running was taken for this window seeing the run start. A window opened mid-run hears it too, when a message is queued",
  )
  assert.equal(following(true, { kind: 'phase', phase: 'idle' }), false, 'a finished run is still followed')
  assert.equal(following(true, { kind: 'phase', phase: 'failed' }), false, 'a failed run is still followed')
  assert.equal(
    following(true, { kind: 'unsent', running: false }),
    false,
    'a send that was to start a run failed, and left its conversation followed',
  )
  // Queued behind a run this window is watching. That run goes on whether or not the message
  // reached main.
  assert.equal(
    following(true, { kind: 'unsent', running: true }),
    true,
    'a message that failed to queue ended the watched run it was queued behind',
  )
  assert.equal(following(false, { kind: 'unsent', running: true }), false)
  // A late failure usually lands here: main has already reported the run's end, so nothing is
  // followed, and the failure must not start following anything.
  assert.equal(
    following(false, { kind: 'unsent', running: false }),
    false,
    'a send that failed started following a run',
  )
})

test("a window knows a run is going from its tab, or from main's list before any phase has reached the tab", () => {
  const listed = [
    { id: 'sess-a', running: false },
    { id: 'sess-b', running: true },
  ]
  assert.equal(runKnown('sess-a', false, listed), false)
  assert.equal(runKnown('sess-a', true, listed), true, 'the tab says a run is going and was not believed')
  // Opened while its run was going. Main has reported no phase since, so the tab still says idle.
  assert.equal(runKnown('sess-b', false, listed), true, 'main lists the conversation as running, and the idle tab was believed')
  assert.equal(runKnown('sess-c', false, listed), false, "another conversation's run was taken for this one's")
})

test('a turn this window starts is followed from the send to the end, in the order main reports it', () => {
  // Main's order, measured with `ManagerSession` and the fake CLI over two turns, the second
  // message sent while the first ran: `running`, `running` again for the queued message, `init`,
  // `assistant`, `result`, `idle`, `idle`, then the queued turn's `running`, `init`, `assistant`,
  // `result`, `idle`. Beside each step, whether this window is following the conversation's run
  // after it. A busy card showing the conversation has a picture only on the steps that say true.
  const replay = (steps: readonly (readonly [RunNews, boolean])[], why: string): void => {
    let now = false
    const got = steps.map(([news]) => (now = following(now, news)))
    assert.deepEqual(got, steps.map(([, want]) => want), why)
  }
  const sent = (running: boolean): RunNews => ({ kind: 'sent', running })
  const phase = (to: 'running' | 'idle'): RunNews => ({ kind: 'phase', phase: to })
  const event = (kind: string): RunNews => ({ kind: 'event', event: kind })

  replay(
    [
      [sent(false), true], [phase('running'), true], [event('init'), true], [event('assistant'), true],
      [event('result'), true], [phase('idle'), false],
    ],
    'a turn this window started went unfollowed somewhere between its send and its idle',
  )

  // The second message is queued, and its turn is followed from its own `init`. Main's `running`
  // for that turn comes first, and that one step is the only one without a picture.
  replay(
    [
      [sent(false), true], [phase('running'), true], [sent(true), true], [phase('running'), true],
      [event('init'), true], [event('assistant'), true], [event('result'), true], [phase('idle'), false],
      [phase('idle'), false], [phase('running'), false], [event('init'), true], [event('assistant'), true],
      [event('result'), true], [phase('idle'), false],
    ],
    "the first turn or the queued one was followed at the wrong steps",
  )

  // A window opened while the first turn was going. Main's list says it is running, so the
  // message is queued behind it, and nothing of that turn is followed. The queued turn is.
  const running = runKnown('sess-b', false, [{ id: 'sess-b', running: true }])
  replay(
    [
      [sent(running), false], [phase('running'), false], [event('assistant'), false], [event('result'), false],
      [phase('idle'), false], [phase('idle'), false], [phase('running'), false], [event('init'), true],
      [event('assistant'), true], [event('result'), true], [phase('idle'), false],
    ],
    'a run this window joined halfway was followed, or the turn queued behind it was not',
  )
})

test("the open project's VERIFY marks and room readings are not painted on another card", async () => {
  const rig = await floor()
  try {
    rig.view.setCampus([office('Alpha', 'sess-a', true), office('Beta', 'sess-b')])
    rig.view.setProject('sess-b')
    rig.view.setProject('sess-a')
    const before = rig.campus()

    // What `refreshOutcomes` does, for the project on screen and no other — and then every picture
    // repainted, as a theme or palette change does.
    rig.view.setOutcomes(new Map([['reviewer', 'failed']]))
    rig.view.setRoom({ notes: 3, board: 2, health: 1 })
    const floorBefore = rig.office()
    rig.view.repaint()
    const after = rig.campus()

    // The control: the readings do reach a card, and it is alpha's.
    assert.deepEqual(marked(after.get('Alpha') ?? []), ['reviewer'], "alpha's own card does not show alpha's failed VERIFY")

    const beta = after.get('Beta')
    assert.ok(beta, "beta's card was drawn with no picture of its office at all")
    assert.deepEqual(marked(beta), [], "alpha's failed VERIFY is on beta's card")
    const moved = firstDifference(before.get('Beta') ?? [], beta)
    assert.ok(
      moved === null,
      "beta's card changed when alpha's readings arrived, so it is painted with another project's " +
        `notice board, whiteboard or plant — first difference at ${moved}`,
    )

    // Painting beta's card without alpha's readings must hand them back to alpha's own floor.
    assert.deepEqual(marked(floorBefore), ['reviewer'], "precondition: alpha's floor shows alpha's failed VERIFY")
    const lost = firstDifference(floorBefore, rig.office())
    assert.ok(lost === null, `visiting the campus changed the open floor's marks or room — first difference at ${lost}`)
  } finally {
    rig.done()
  }
})

test('a card is repainted when the readings it carries arrive or stop being its own', async () => {
  // Pictures are cached until something marks them out of date, so a card that carries readings
  // has to be marked when they change — or it keeps saying what the harness said before.
  const rig = await floor()
  try {
    rig.view.setCampus([office('Alpha', 'sess-a', true), office('Beta', 'sess-b')])
    rig.view.setProject('sess-b')
    rig.view.setProject('sess-a')
    rig.campus()

    rig.view.setOutcomes(new Map([['reviewer', 'failed']]))
    const outcomes = rig.campus()
    assert.deepEqual(
      marked(outcomes.get('Alpha') ?? []),
      ['reviewer'],
      "alpha's VERIFY outcomes arrived and alpha's card does not show them — the picture was not repainted",
    )

    rig.view.setRoom({ notes: 3, board: 2, health: 1 })
    const room = rig.campus()
    assert.ok(
      firstDifference(outcomes.get('Alpha') ?? [], room.get('Alpha') ?? []) !== null,
      "alpha's room reading arrived and alpha's card was not repainted with it",
    )

    // Leaving alpha: the view holds one set of readings, the open floor's, so alpha's card stops
    // carrying them rather than keeping whichever were current when it was last painted.
    rig.view.setCampus([office('Alpha', 'sess-a'), office('Beta', 'sess-b', true)])
    rig.view.setProject('sess-b')
    const left = rig.campus()
    assert.deepEqual(
      marked(left.get('Alpha') ?? []),
      [],
      'alpha is no longer open and its card still carries the readings the view holds for the floor on screen',
    )
  } finally {
    rig.done()
  }
})

test('the campus puts up no speech bubbles, from any conversation', async () => {
  // A card is a picture, and a bubble is DOM over the floor you are standing in. Painting a
  // picture of a conversation must not raise that conversation's bubbles over the campus.
  const rig = await floor()
  try {
    rig.view.setCampus([office('Alpha', 'sess-a', true), office('Beta', 'sess-b')])
    rig.view.setProject('sess-b')
    rig.view.askOver('builder')
    assert.equal(rig.bubbles(), 1, 'asking put up no bubble, so the harness cannot see one and this proves nothing')

    // Leaving beta takes its element down and leaves the question on beta's board.
    rig.view.setProject('sess-a')
    rig.view.askOver('reviewer')
    rig.office()
    assert.equal(rig.bubbles(), 1)

    rig.campus()
    assert.equal(rig.bubbles(), 0, 'the campus is showing speech bubbles over its cards')

    // The control: the question on the open floor was never withdrawn, only hidden.
    rig.office()
    assert.equal(rig.bubbles(), 1, 'the open floor lost its bubble by visiting the campus')

    // Back out with every picture already painted, so nothing is repainted on the way.
    rig.campus()
    assert.equal(rig.bubbles(), 0, 'a bubble from the open floor stayed up over the campus')
  } finally {
    rig.done()
  }
})

test("the picture that flies up from a clicked card is that card's own", async () => {
  // `zoomInto` looks the picture up again rather than taking it from the campus, so the two have to
  // agree on the key — or the zoom flies up a picture of a scene nothing feeds.
  const rig = await floor()
  const page = globalThis as unknown as { document: Record<string, unknown>; window: Record<string, unknown> }
  const body = document.createElement('body') as unknown as El
  page.document['body'] = body
  // The shim has no media queries. Motion allowed, so the picture is actually flown.
  page.window['matchMedia'] = () => ({ matches: false })
  try {
    rig.view.setCampus([
      office('Alpha', 'sess-a', true),
      office('Beta', 'sess-b'),
      office('Gamma', null, false, { busy: true }),
    ])
    rig.view.setProject('sess-b')
    rig.view.setProject('sess-a')
    rig.campus()

    const beta = rig.card('Beta')
    assert.ok(beta?.picture, "beta's card has no picture, so there is nothing to fly")
    rig.click(beta.x + 4, beta.y + 4)
    const flier = body.children.at(-1)
    assert.ok(flier, 'clicking a card flew nothing up, so there is nothing to compare')
    const flown = recorded(flier).find((c) => c.method === 'drawImage')?.args[0]
    assert.ok(flown === beta.picture, "the picture that flew up from beta's card is not the one painted on it")

    const gamma = rig.card('Gamma')
    assert.ok(gamma, "gamma's card was not drawn, so there is nothing to click")
    const fliers = body.children.length
    rig.click(gamma.x + 4, gamma.y + 4)
    assert.equal(body.children.length, fliers, 'a card with no picture flew one up')
  } finally {
    // The zoom queued a frame of its own on the harness's shared queue. The clock never moved.
    runFrame(0)
    delete page.document['body']
    delete page.window['matchMedia']
    rig.done()
  }
})
