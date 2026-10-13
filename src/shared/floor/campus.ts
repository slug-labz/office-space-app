/**
 * The campus — every project at once, side by side.
 *
 * The brief: instead of stacking projects on top of each other, lay them out horizontally — a
 * new project adds an adjacent office in a different colour, you can zoom out and see all the
 * offices laid out at once, and clicking one focuses it.
 *
 * This replaces the tower. A stacked building shows one floor at a time, and the entire point of
 * zooming out is to see **all** the projects at once — so the metaphor and the requirement were
 * pulling against each other, and the flat one wins. It is also the cheaper architecture: the
 * same projection draws one office or forty, where a cutaway needed a second rendering mode.
 *
 * ## Fidelity: what changed, and what did not
 *
 * This file used to say an office you are not focused on is *"a room, a colour and a light per
 * agent — never a live simulation. Forty projects must cost forty rectangles, not forty walking
 * crowds."* The real thing was then asked for: a miniature of the running office's own
 * artwork, with the people visibly moving and clickable.
 *
 * The constraint survives; only the implementation changes. **Forty offices still cost forty
 * draw calls** — they are bitmaps, painted once into offscreen canvases and repainted only when
 * that project's own scene changes. What was never affordable was forty *live* floors, and that
 * is still not what happens. See `paintThumb` in `floor-view.ts`.
 *
 * What this file owns is therefore the layout, in pixels rather than in campus tiles: a card is
 * exactly one office's rendered bounds plus a line for its name, so the grid is a function of
 * the artwork instead of a guess that has to be re-tuned whenever the floor plan changes.
 */

import type { Rect } from './floorplan.js'
import type { PendingApproval, ProjectInfo, SessionInfo, SessionPhase } from '../ipc.js'

/** One project, as the campus needs to know it. */
export interface CampusOffice {
  readonly id: string
  readonly name: string
  /** How many agents work there. Drives the lights, not a crowd. */
  readonly staff: number
  /**
   * True while that project's manager is running.
   *
   * **Two channels carrying the same bit**, OR-ed. Both resolve to `ManagerSession.state.phase`:
   * `ProjectInfo.running` reads it in main via `describeSession`, off `managers` — the live map
   * of running sessions. **Not the registry**, which has no `running` field at all; an earlier
   * version of this comment said registry and that was the sentence doing the safety work here.
   * The renderer's set reads the same phase off `CHANNEL.state`.
   *
   * Because it is one value, the union cannot add a false positive the app did not already hold
   * — which is a stronger guarantee than "two independent sources that happen not to lie", and
   * the reason to state where each actually reads from rather than that both are trustworthy.
   *
   * What the union removes is the blind spot each channel has alone. The renderer's covers only
   * offices visited in this window's lifetime: every writer of `sessionProject` stores the
   * literal `active`, so `recomputeBusy` drops any session it cannot place. Main was already
   * sending state for unvisited projects — `CHANNEL.state` is not project-filtered — and the
   * renderer was receiving it, building a tab, and then discarding it at that guard.
   *
   * The renderer's half is kept rather than replaced because it is the only signal while
   * `workspace` is null and `pushSessions` suppresses the snapshot, and because `setPhase` calls
   * `renderSwitcher` synchronously while `snapshot` is still the old one. That buys **one frame**
   * — both sends leave main in the same tick — not the gap an earlier draft of this implied.
   *
   * This used to be the renderer's set **alone**, so `busy` could only ever be true for an office
   * you had already opened: the same defect `waiting` was fixed for, left standing on the stated
   * grounds that a false negative here costs a card that says nothing rather than a card that
   * misdirects. That was true and it was still a card that could not answer for an office you had
   * not visited — which is most of them, on the surface whose whole job is the ones you are not
   * looking at.
   *
   * Closed 2026-09-09, and the fix was not the OR. It was moving the composition into
   * `campusFrom` below, where a test can reach it; the renderer built this object inline, and
   * `app.ts` is not a file the suite can see.
   *
   * Still the signal this module argues you should *not* act on — see `waiting`.
   */
  readonly busy: boolean
  /**
   * Tool calls held in that project, waiting for somebody to decide.
   *
   * The one signal on a card that answers **"what should I work on"** rather than "what is
   * happening". `busy` was doing that job and is the wrong way round for it: a project whose
   * manager is running does not want you, it is working. A project holding a decision has
   * stopped, and the gate refuses it after four minutes whether or not anybody looked.
   *
   * A count rather than a flag, because two held calls in one project and one each in two
   * projects are different mornings.
   */
  readonly waiting: number
  /** True for the one you are looking at. */
  readonly focused: boolean
  /**
   * The conversation this card is a picture of, or `null` when there is none this window can
   * vouch for.
   *
   * The floor keeps a scene per **conversation** — every fact reaches it keyed by one, off
   * `CHANNEL.event` — so a card looked up by project id was a picture of a scene nothing ever fed:
   * a project with its builder at work showed a quiet office. This is the conversation the project
   * was last showing in this window, which is the floor a click on the card lands on — **but only
   * when that picture can show what is happening in the project**:
   *
   * - **While the project is quiet** (`attentionOf` says `idle`): nothing is running and nothing is
   *   held, so the picture can only show that, whatever this window missed.
   * - **While it is busy or waiting, only if this window has watched that conversation's current
   *   run from its start.** A scene holds only the facts this window received. `restore` puts a
   *   transcript back and no facts, and an employee is drawn working only through the `dispatch`
   *   fact, so a conversation opened after its run began shows nobody working. So does the one a
   *   project last showed while another of its conversations is the one running. Review measured
   *   both on the first version of this, which used the last-shown conversation whatever was
   *   happening.
   *
   * `null` is not "idle". A window opened while main is still running a project — on a Mac,
   * closing the window does not quit — knows no conversation for it, and opening that project's
   * conversation mid-run still gives it none until a run is watched. What a card without one shows
   * is `pictureOf`'s to decide.
   */
  readonly session: string | null
}

/**
 * What a card is saying, in the order somebody should read it.
 *
 * The activity strip settled this ordering and gives the reason: *"**What needs you** comes
 * first, because a held tool call and a finished task are not the same kind of news and a feed
 * that mixes them buries the one you have to answer."* The campus is that feed for a whole
 * workspace, so it takes the same order rather than inventing a second one.
 *
 * `idle` is not a state worth marking. Most offices are idle most of the time, and a mark on
 * every card is a mark on none.
 */
export type Attention = 'waiting' | 'busy' | 'idle'

/**
 * Which of the three an office is in.
 *
 * Waiting outranks busy deliberately, and they can be true together: a project with three
 * conversations can have one held at the gate while another runs. Drawing "busy" over that would
 * report the half that needs nothing from you and hide the half that does.
 */
export function attentionOf(office: CampusOffice): Attention {
  if (office.waiting > 0) return 'waiting'
  return office.busy ? 'busy' : 'idle'
}

/**
 * How to outline a card, or `null` for one that says nothing.
 *
 * The decision lives here rather than in the draw call, so it can be checked. `role` is a name
 * out of the palette rather than a colour, because a colour picked here would be a literal in
 * the one module that must not hold one — the renderer maps the role to whatever the live theme
 * says it is, which is how the campus chrome and the interface stay in step.
 *
 * **The two must not resolve to the same colour**, and that is not a style note. The theme row
 * shipped two palettes whose grounds were 2, 1 and 6 out of 255 apart: the choice was real, the
 * code rewrote 41 variables, and nobody could see it. A distinction that is drawn and cannot be
 * seen is the same defect, and this is the surface where it would mean opening the wrong office.
 */
export interface CardMark {
  readonly role: 'warn' | 'accent'
  readonly width: number
  /** Inset from the card's edge, so a thicker outline does not sit outside a thinner one. */
  readonly inset: number
}

export function markFor(office: CampusOffice): CardMark | null {
  switch (attentionOf(office)) {
    // Thicker as well as a different colour. Two marks that differ only in hue are one mark to
    // anybody who cannot separate those hues, and the whole point is that this one is found
    // across a grid without being looked for.
    case 'waiting':
      return { role: 'warn', width: 2, inset: 1 }
    case 'busy':
      return { role: 'accent', width: 1, inset: 0.5 }
    case 'idle':
      return null
  }
}

/**
 * The scene a card is a picture of, or `null` for a card with no picture.
 *
 * - **Its conversation**, when the card has one (`session`). That is the floor a click on the card
 *   lands on, and the one every fact about it reaches. `campusFrom` gives a busy or waiting project
 *   one only while this window has watched that conversation's current run from its start, so the
 *   picture can show the work.
 * - **A quiet office**, when it has none and the office is `idle`: main says no turn is running
 *   there and no call is held. A floor nothing has happened on is exactly that, so the picture is
 *   one no fact ever reaches, keyed apart from every conversation. A quiet project this window has
 *   a conversation for is never here: it gets that conversation.
 * - **Nothing**, when it has none and something is happening there: this window has no
 *   conversation for the project, or has one whose current run it did not watch, or the project is
 *   busy in another of its conversations. The window cannot draw who is working in a run it has
 *   not been following, and a quiet office would say nobody is. The outline from `markFor` still
 *   says what main knows.
 */
export function pictureOf(office: CampusOffice): string | null {
  if (office.session !== null) return office.session
  return attentionOf(office) === 'idle' ? `quiet:${office.id}` : null
}

/** Where one office sits on the campus, in pixels. */
export interface CampusCard {
  readonly office: CampusOffice
  /** The rendered office, top-left corner and size. Excludes the name written under it. */
  readonly rect: Rect
  /** Deterministic per project id, so an office is the same colour every time you open it. */
  readonly hue: number
}

/** Space between cards, and the room a name needs under one. */
export const GAP = 16
export const NAME_ROW = 20
/**
 * The line under the grid that says how many offices did not fit.
 *
 * A row of its own, because it did not have one. The note was drawn at
 * `bounds.height - 4` and the names at `rect.y1 + NAME_ROW - 6` — two baselines two pixels
 * apart, both inside the same twenty-pixel name row. Seen at 620 projects:
 *
 *     620 projects · 480 drawn · the rest are in the switcher
 *     project 477      project 478      project 479
 *
 * printed on top of each other, so neither could be read. The sentence was right and the
 * arithmetic that made room for it was missing, which is the worse half — a partial campus that
 * cannot say it is partial is a statement that the workspace has that many projects and no more.
 */
export const NOTE_ROW = 14

/** How big one office renders. Supplied by the caller, because only the view knows the plan. */
export interface CardSize {
  readonly width: number
  readonly height: number
}

/**
 * Lay the offices out in a grid, growing rightward then down.
 *
 * Row-major and index-stable, for the same reason desks are: an office you learned the position
 * of does not move when a new project is added beside it. Honeycomb was the other option in the
 * vision and is deliberately not taken — a hex grid buys visual interest and costs the property
 * that makes the layout learnable.
 *
 * `columns` is worked out by the caller from the width it actually has, so a wide window packs
 * more per row and a narrow one wraps. It is never fewer than one, because a grid of zero
 * columns is a divide by zero dressed as a layout.
 */
export function layOutCampus(
  offices: readonly CampusOffice[],
  columns = 3,
  card: CardSize = { width: 7 * 24, height: 5 * 12 },
): CampusCard[] {
  const cols = Math.max(1, columns)
  return offices.map((office, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x0 = col * (card.width + GAP)
    const y0 = row * (card.height + NAME_ROW + GAP)
    return {
      office,
      rect: { x0, y0, x1: x0 + card.width, y1: y0 + card.height },
      hue: hueFor(office.id),
    }
  })
}

/**
 * The campus's extent in pixels, so the canvas can be sized to it.
 *
 * The name row is added on the bottom, and it is not slack: each office's name is drawn *under*
 * its card, and rows after the first have the gap to sit in. The last row does not — without
 * this its names fall outside the canvas and are clipped away, which is how the first campus
 * rendered with every office anonymous.
 */
export function campusSize(
  cards: readonly CampusCard[],
  /** How many offices did not fit. Non-zero means a note is drawn, and a note needs a row. */
  omitted = 0,
): { width: number; height: number } {
  const note = omitted > 0 ? NOTE_ROW : 0
  if (cards.length === 0) return { width: 7 * 24, height: 5 * 12 + NAME_ROW + note }
  return {
    width: Math.max(...cards.map((c) => c.rect.x1)),
    height: Math.max(...cards.map((c) => c.rect.y1)) + NAME_ROW + note,
  }
}

/**
 * Chromium will not give you a canvas past either of these.
 *
 * Measured in this app's own Electron on 2026-08-27, both bounds, because only measuring one is
 * how this was got wrong the first time:
 *
 *      1408 x 65535    92 Mpx   drawable
 *     16384 x 16384   268 Mpx   drawable
 *      8192 x 32768   268 Mpx   drawable
 *     20000 x 20000   400 Mpx   NOT drawable
 *
 * Engine facts rather than facts about this product. Electron pins Chromium, so they hold for a
 * given build and are worth re-measuring when it moves. Past either one the canvas keeps the
 * attributes you set and loses its pixels: `canvas.height` reads back correctly, every draw call
 * succeeds, and nothing appears. A campus that large therefore renders as an empty room, which
 * is a statement that the workspace has no projects.
 */
export const MAX_CANVAS_SIDE = 65_535
export const MAX_CANVAS_AREA = 268_435_456

/**
 * The tallest canvas this engine will actually hand back at a given width.
 *
 * Both bounds, and the area one is the easy one to miss: a bisection at one width finds the
 * per-side limit and stops. At 1408 wide the side bound is what you hit; at 8192 wide the area
 * bound arrives at 32768, less than half of it. A clamp written against the side alone is right
 * at the width it was measured at and wrong at every wider one.
 */
export function canvasCeiling(width: number, scale = 1): number {
  const devicePixels = Math.max(1, Math.round(width * scale))
  return Math.min(MAX_CANVAS_SIDE, Math.floor(MAX_CANVAS_AREA / devicePixels)) / Math.max(1, scale)
}

/** What a campus too large to draw shows instead, and what it leaves out. */
export interface FittedCampus {
  readonly drawn: readonly CampusCard[]
  /** How many offices are not on screen. Zero when everything fits. */
  readonly omitted: number
}

/**
 * Drop whole rows off the bottom until the campus is a canvas the engine will draw.
 *
 * Rows, not cards: half a row is a hole in a grid, and the grid being learnable is the reason
 * `layOutCampus` is row-major in the first place.
 *
 * **The focused office is kept whatever its position.** Dropping by position alone drops the
 * office somebody is working in the moment their workspace grows past the ceiling, which is the
 * worst possible member of the set to lose and the one no test with generated names would
 * notice. It takes the place of the last card that survived, so the count is unchanged and the
 * grid stays full.
 *
 * Nothing is scaled. PLAN.md rejected that and says why: fitting instead "shrinks every office
 * until forty of them are indistinguishable smudges, which is the exact failure real artwork is
 * meant to fix". A partial campus that says it is partial is honest. A blank one is not, and a
 * smudged one is not either.
 */
export function fitCampus(cards: readonly CampusCard[], maxHeight: number): FittedCampus {
  if (cards.length === 0) return { drawn: cards, omitted: 0 }
  if (campusSize(cards).height <= maxHeight) return { drawn: cards, omitted: 0 }

  const rowHeight = Math.max(1, (cards[0]?.rect.y1 ?? 1) - (cards[0]?.rect.y0 ?? 0) + NAME_ROW + GAP)
  // `NOTE_ROW` as well as `NAME_ROW`: reaching this line means something is being dropped, so a
  // note is going to be drawn and it has to fit inside the same ceiling the cards do.
  //
  // **It is belt, and the belt is currently slack.** A row here is `card.height + NAME_ROW + GAP`
  // while `campusSize` measures to the last card's `y1 + NAME_ROW`, so every trimmed campus
  // already ends with `GAP` = 16 pixels to spare and the note is 14. Removing this subtraction
  // changes no answer today; it was mutation-tested and survived, at one ceiling and then across
  // a 1200-pixel sweep chosen to straddle every row boundary.
  //
  // Kept rather than deleted, and said rather than implied — the same call as the containment
  // guard in `approvals.ts`. What makes it honest instead of dead code is that
  // `campus-has-a-ceiling.test.ts` asserts `GAP >= NOTE_ROW` directly, so the day somebody
  // shrinks `GAP` is the day the test fails and this line starts being the only thing holding
  // the ceiling. `office-space-6c`: keeping it with a comment implying it does something is what
  // would not be honest.
  const rows = Math.max(1, Math.floor((maxHeight - NAME_ROW - NOTE_ROW) / rowHeight))
  const perRow = Math.max(1, cards.filter((c) => c.rect.y0 === cards[0]!.rect.y0).length)
  const keep = Math.min(cards.length, rows * perRow)

  const drawn = cards.slice(0, keep)
  const focused = cards.findIndex((c) => c.office.focused)
  if (focused >= keep) {
    // Into the last surviving slot, so it is on screen and the grid has no hole in it. The card
    // keeps its own office and takes the position it is standing in.
    drawn[keep - 1] = { ...cards[keep - 1]!, office: cards[focused]!.office, hue: cards[focused]!.hue }
  }

  return { drawn, omitted: cards.length - keep }
}

/**
 * How many columns fit in the width available.
 *
 * At least one, always. A window narrower than a single office shows one office cut off rather
 * than none at all, which is the better of two bad answers on a window nobody should be using.
 */
export function columnsFor(available: number, cardWidth: number): number {
  return Math.max(1, Math.floor((available + GAP) / (cardWidth + GAP)))
}

/**
 * A stable hue for a project id.
 *
 * The same FNV-1a the character recipe uses, for the same reason: a project must be the same
 * colour on every machine and every launch, and an incrementing counter would repaint the whole
 * campus the moment somebody deleted a project in the middle.
 */
export function hueFor(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % 360
}

/**
 * Which card a campus point falls in, or null. Used for click-to-focus.
 *
 * The name row counts as part of the office. Somebody aiming at a project aims at its label as
 * readily as at its picture, and a click that lands one pixel below the artwork and does nothing
 * reads as the campus being broken rather than as a miss.
 */
export function cardAt(cards: readonly CampusCard[], x: number, y: number): CampusCard | null {
  return (
    cards.find(
      (c) => x >= c.rect.x0 && x <= c.rect.x1 && y >= c.rect.y0 && y <= c.rect.y1 + NAME_ROW,
    ) ?? null
  )
}


/**
 * Every office on the campus, from the lists the renderer already holds.
 *
 * Here rather than in `app.ts` for the reason `waitingByProject` is here: **nothing in the suite
 * reaches that file.** The renderer composed this object inline, and a mutation installing the
 * exact defect this function exists to prevent passed the whole suite green — which is how the
 * `busy` blind spot above survived being written down twice and fixed neither time.
 *
 * `seenBusy` is the renderer's own set of projects with a live tab. It is passed in rather than
 * read, so this stays pure and the union above is a thing a test can state.
 *
 * `showing` is which conversation each project was last showing in this window — `lastSession` in
 * `app.ts`. A project it does not name gets no conversation; see `pictureOf` for what its card
 * shows instead.
 *
 * `followed` is the conversations whose current run this window has watched from its start —
 * `followedRuns` in `app.ts`, kept with `following`. A busy or waiting project gets the
 * conversation it was showing only if that conversation is in it; see `CampusOffice.session` for
 * why. A quiet one gets it regardless. Quiet is `attentionOf`'s `idle`, read off the same office,
 * so this and `pictureOf`'s fallback cannot disagree about which projects are quiet.
 */
export function campusFrom(
  projects: readonly ProjectInfo[],
  staff: number,
  held: ReadonlyMap<string, number>,
  active: string,
  seenBusy: ReadonlySet<string>,
  showing: ReadonlyMap<string, string>,
  followed: ReadonlySet<string>,
): readonly CampusOffice[] {
  return projects.map((project) => {
    const office: CampusOffice = {
      id: project.id,
      name: project.name,
      staff,
      busy: project.running || seenBusy.has(project.id),
      waiting: held.get(project.id) ?? 0,
      focused: project.id === active,
      session: null,
    }
    const shown = showing.get(project.id) ?? null
    const quiet = attentionOf(office) === 'idle'
    return shown !== null && (quiet || followed.has(shown)) ? { ...office, session: shown } : office
  })
}

/** Something this window learned about one conversation's run. See `following`. */
export type RunNews =
  /** This window sent the conversation a message. `running`: it knew a run was going (`runKnown`). */
  | { readonly kind: 'sent'; readonly running: boolean }
  /** Sending that message failed. `running`: as it was for the `sent` before it. */
  | { readonly kind: 'unsent'; readonly running: boolean }
  /** An event of the conversation's run arrived. `event` is its `ClaudeEvent` kind. */
  | { readonly kind: 'event'; readonly event: string }
  /** Main reported the conversation's phase. */
  | { readonly kind: 'phase'; readonly phase: SessionPhase }

/**
 * Whether this window is following a conversation's current run after `news`, given `was`.
 *
 * This is membership of `followed` in `campusFrom`, one conversation at a time; `app.ts` keeps its
 * set with it. Here rather than there for `campusFrom`'s reason: nothing in the suite reaches
 * `app.ts`.
 *
 * - **A message sent while no run is going** starts a run now, and every event of that run reaches
 *   this window. So it is followed from the send, before main reports `running` and before the
 *   run's `init`. A message sent while a run is going is queued behind it (`ManagerSession.send`).
 *   It says nothing about the run in progress, which may have begun before this window was
 *   watching.
 * - **`init`** opens every `claude -p` process, and a turn is one process. It covers the runs this
 *   window did not start with a send, which is a queued message's run above all. No other event
 *   changes anything, `result` included: main reports `idle` after every `result` and before the
 *   next run starts (`session.ts`), so stopping at the result would only leave a busy card without
 *   a picture until then.
 * - **Any phase but `running`** ends the run, and the next one is followed from its own start.
 *   `running` starts nothing here: a window opened mid-run hears it too, when a message is queued.
 * - **A send that was to start a run and failed** ends following. If it failed before the run
 *   started, main may never report a phase for it. If the run started, the send fails only after
 *   that run is over, and any queued run it went on to start (`ManagerSession.send`), and main
 *   reports the end of each before that. A message that was to be queued behind a run leaves that
 *   run as it was: its failure stops nothing.
 */
export function following(was: boolean, news: RunNews): boolean {
  switch (news.kind) {
    case 'sent':
      return was || !news.running
    case 'unsent':
      return was && news.running
    case 'event':
      return was || news.event === 'init'
    case 'phase':
      return was && news.phase === 'running'
  }
}

/**
 * Whether this window knows a run is going in `session`, for a `sent`.
 *
 * Its tab says so once main has reported the conversation's phase. Until then a tab says idle
 * whatever is happening. A window opened while a run was already going has had no report for it,
 * because main reports a phase when something about the conversation changes (a turn, a queued
 * message, its mode, its cost), not when a window opens. Main's list carries `running` for each
 * conversation. `app.ts` fetches that list when it opens a conversation, and main sends it again
 * with every phase it reports, so the list covers that window.
 */
export function runKnown(
  session: string,
  tabBusy: boolean,
  listed: readonly Pick<SessionInfo, 'id' | 'running'>[],
): boolean {
  return tabBusy || listed.some((s) => s.id === session && s.running)
}

/**
 * Held calls, counted per project.
 *
 * Pure, and here rather than in `app.ts`, because nothing in the suite can reach `app.ts` — a
 * mutation installing the exact defect this function exists to prevent passed 2577 tests green.
 * The renderer keeps the wiring; the decision is checkable.
 *
 * `project` comes from main, off the session registry. It is `null` when the office cannot place
 * a session, and a `null` is **dropped rather than bucketed**: attributing it to the open project
 * would put somebody else's held call on your card, and attributing it to a made-up key would
 * count it against an office that does not exist.
 */
export function waitingByProject(
  approvals: readonly PendingApproval[],
): ReadonlyMap<string, number> {
  const held = new Map<string, number>()
  for (const approval of approvals) {
    if (approval.project === null) continue
    held.set(approval.project, (held.get(approval.project) ?? 0) + 1)
  }
  return held
}
