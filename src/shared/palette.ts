/**
 * One palette, for the room and the interface.
 *
 * The theme has to align with the development environment — coding forms, coding theme
 * colours — taking as much inspiration from the code as it can.
 *
 * The literal reading of that is "pick colours a code editor would pick", and it is the right
 * one — but there is a better version available here, because **the office's own furniture is
 * already a syntax palette and nobody noticed.** The book spines on the skills shelf are five
 * hues chosen to stay apart at eight pixels; the desk lamp is amber; the alarm on a failed
 * check is red. Those are the same jobs `number`, `string` and `error` do in a theme, solved
 * once already for a harder case.
 *
 * So this module is not a new palette. It is the one that was already there, named for what the
 * colours **do** rather than what they are on, and made the single source for both consumers.
 *
 * ## Why one source rather than two that agree
 *
 * `styles.css` and `props.ts` each held a hand-written list, and they already nearly matched —
 * `#e8b25e` was `--lamp` in one and `leafDying` in the other, `#e0685f` was `--alarm` and
 * `screenAlert`. Nearly is the problem: two lists that agree today are two lists that disagree
 * after the next edit, and the disagreement is invisible because CSS fails silently.
 *
 * The CSS variables are still declared statically in `styles.css` so the first paint has colour
 * before any script runs. **`test/palette.test.ts` asserts the two agree**, which is what makes
 * "one source" true rather than aspirational.
 *
 * ## Why the syntax names survive into the interface
 *
 * A role name — `accent`, `good`, `warn` — says what a colour means here. A syntax name says
 * where it came from and, more usefully, **why it is that hue and not another**: `number` is
 * amber in most dark themes because amber is what is left after strings take green and
 * keywords take purple. Keeping both means a new theme is authored by answering seven familiar
 * questions rather than by inventing twenty.
 */

/** The seven colours a syntax theme decides, and every other colour here is derived from. */
export interface Syntax {
  readonly keyword: string
  readonly string: string
  readonly number: string
  readonly func: string
  readonly type: string
  readonly comment: string
  readonly error: string
}

/** What a colour means in the interface, as opposed to where it came from. */
export interface Roles {
  /** The one interactive colour. Everything clickable and nothing else. */
  readonly accent: string
  /** Verified. Passed. Came back clean. */
  readonly good: string
  /** Needs you. Not broken — waiting. */
  readonly warn: string
  /** Failed, refused, could not be read. */
  readonly bad: string
  /** Running. Activity with no verdict yet. */
  readonly info: string
}

export interface Palette {
  readonly id: string
  readonly name: string
  /**
   * Four grounds, darkest first: the window, a panel, a raised surface, a hover.
   *
   * Four rather than three because an input sitting on a panel and a hover state on that input
   * are different surfaces, and collapsing them is what makes a dark interface read as flat.
   */
  readonly ground: readonly [string, string, string, string]
  /** One-pixel borders. Never a fill. */
  readonly line: string
  /** Primary, secondary, tertiary. `faint` is the comment colour — the same job, twice. */
  readonly ink: string
  readonly inkDim: string
  readonly inkFaint: string
  readonly syntax: Syntax
  readonly roles: Roles
  /**
   * The six colours the room needs that a syntax theme has no opinion about.
   *
   * Carpet, masonry and wood are surfaces, and a syntax theme names *marks on* a surface. Every
   * other colour in `props.ts` — the screens, the books, the plants, the alarm light — is
   * derived from `syntax` and `roles`, because every one of them is a mark that means something.
   * The split is the useful part: **if a colour is in here, it reports nothing.**
   */
  readonly room: {
    readonly floor: string
    readonly wall: string
    readonly wallInner: string
    readonly desk: string
    readonly deskWarm: string
    readonly fabric: string
    /** Terracotta. Plant pots, cork, cardboard — the warm neutral the room needs. */
    readonly pot: string
  }
}

/**
 * The office at night, which is what it has always been.
 *
 * Every value here was already in the codebase; this is a rename, not a redesign. The five book
 * spines became `func`, `number`, `string`, `keyword` and `type` in that order, which is the
 * order they were written in — they were chosen to stay apart from each other, which is exactly
 * the constraint a syntax palette is under.
 */
export const NIGHT_SHIFT: Palette = {
  id: 'night-shift',
  name: 'Night shift',
  ground: ['#0b0e17', '#131826', '#1a2132', '#232a3d'],
  line: '#232a3d',
  ink: '#e6e3dd',
  inkDim: '#98a0b3',
  inkFaint: '#5b6478',
  syntax: {
    keyword: '#c47f9e',
    string: '#9ec47f',
    number: '#e8b25e',
    func: '#7f9ec4',
    type: '#7fc4bd',
    comment: '#5b6478',
    error: '#e0685f',
  },
  roles: {
    accent: '#e8b25e',
    good: '#9ec47f',
    warn: '#c47f9e',
    bad: '#e0685f',
    info: '#7f9ec4',
  },
  room: {
    floor: '#2e2a3d',
    wall: '#1b2030',
    wallInner: '#3a3550',
    desk: '#3b3348',
    deskWarm: '#4a3a55',
    fabric: '#2b3a5c',
    pot: '#c4a97f',
  },
}

/**
 * A second theme, and its only job is to prove the first one is not hard-coded.
 *
 * Deliberately far from `night-shift` on the axis that is easiest to get wrong: the ground is
 * neutral rather than violet, and the accent is cyan rather than amber.
 *
 * **And far enough to see.** The grounds used to be `#0b0e17` and `#0d0f11` — two, one and
 * six out of 255 apart. Measured in the running app, the floor canvas is 14.3% of the
 * window, so the accent being opposite and the room being cooler were both true and both
 * small: 86% of what you look at barely moved, and switching theme read as a control that
 * did nothing. A probe for the token layer is worth having, and it is offered to people in
 * a menu, so it has to work as a theme as well. The ramp is lighter now and still dark —
 * 1.17 against night shift, 16.5 against white. If the interface still
 * reads correctly under both, the token layer is real. If a surface only works under one of
 * them, that surface is still holding a literal somewhere.
 */
export const GRAPHITE: Palette = {
  id: 'graphite',
  name: 'Graphite',
  ground: ['#1c1f24', '#242830', '#2d323b', '#3a4049'],
  line: '#3a4049',
  ink: '#e4e6ea',
  // Raised with the ground. `--muted-foreground` is this value and `--secondary` is
  // `ground[3]`, so lightening the ramp pushed the pair to 4.05 and the contrast floor caught
  // it. 4.67 now, against a bar of 4.5.
  inkDim: '#a6aeb9',
  inkFaint: '#5e6672',
  syntax: {
    keyword: '#b78ce0',
    string: '#8fc98f',
    number: '#e3a86b',
    func: '#6fb7c9',
    type: '#7fd0b8',
    comment: '#5e6672',
    error: '#dd6a68',
  },
  roles: {
    accent: '#6fb7c9',
    good: '#8fc98f',
    warn: '#e3a86b',
    bad: '#dd6a68',
    info: '#b78ce0',
  },
  room: {
    floor: '#2a2d33',
    wall: '#181b20',
    wallInner: '#363b44',
    desk: '#363b44',
    deskWarm: '#45403c',
    fabric: '#2f4551',
    pot: '#b39a76',
  },
}

export const PALETTES: readonly Palette[] = [NIGHT_SHIFT, GRAPHITE]

/** The one the app opens with, and the one `styles.css` declares statically. */
export const DEFAULT_PALETTE = NIGHT_SHIFT

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? DEFAULT_PALETTE
}

/* ── The contrast floor ─────────────────────────────────────────────────────────────────────

   Everything above this line is the *art*: a room, seven syntax colours, five roles. Everything
   below is the *mapping* from that art onto interface tokens, and the two have different jobs.
   A theme is allowed to choose a colour because it looks right in the room. An interface token
   is not allowed to be illegible.

   Those came apart in practice. Measured against the shipped `night-shift` palette in the
   running app:

   | pair | ratio | |
   |---|---|---|
   | `--ink-faint` on `--secondary` | **2.41** | fails WCAG 1.4.3 (4.5 for text under 18.66px) |
   | `--ink-faint` on `--card`      | **2.98** | fails |
   | `--border` against `--card`    | **1.24** | fails WCAG 1.4.11 (3.0 for a control's edge) |

   `--ink-faint` is not decoration — it sets tool lists, hints, timestamps and code comments, at
   11px. And a border you cannot see is why the panels in this app read as floating text rather
   than as objects you could pick up.

   The fix belongs *here* rather than in the palettes, for two reasons. It holds for every theme
   at once, including ones nobody has written yet — a floor that only applies to the palette you
   happened to look at is not a floor. And it leaves the art alone: `night-shift` still declares
   the colour it wants, and this decides how far it has to move to be readable on the surface it
   actually lands on.                                                                            */

const channels = (hex: string): readonly [number, number, number] => {
  const h = hex.replace('#', '')
  const n = Number.parseInt(h, 16)
  return h.length === 6 ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0]
}

const hex = (c: readonly [number, number, number]): string =>
  `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v)))
    .toString(16)
    .padStart(2, '0')).join('')}`

/** WCAG 2.x relative luminance. */
const luminance = (colour: string): number => {
  const [r, g, b] = channels(colour).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.x contrast ratio. 1 is identical, 21 is black on white. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * The same colour, moved just far enough from `surfaces` to clear `min` against all of them.
 *
 * Direction is decided by the surfaces rather than assumed: a dark theme lightens its ink, a
 * light one darkens it, and neither is hardcoded here — which is what lets a light palette be
 * added later without this function being the thing that has to change.
 *
 * It mixes toward white or black rather than adjusting lightness in a perceptual space, and
 * that is a deliberately dull choice: a hue-preserving nudge is what is wanted, the input is
 * always a near-neutral ink or line, and the alternative is a colour-space dependency for a
 * difference nobody could point to. If it cannot reach `min` it returns the closest it got —
 * white or black — because an approximation you can read beats a guarantee you cannot keep.
 */
export function legibleOn(colour: string, surfaces: readonly string[], min: number): string {
  const worst = (c: string): number => Math.min(...surfaces.map((s) => contrast(c, s)))
  if (surfaces.length === 0 || worst(colour) >= min) return colour

  const towardsWhite = luminance(colour) >= Math.max(...surfaces.map(luminance))
  const target: readonly [number, number, number] = towardsWhite ? [255, 255, 255] : [0, 0, 0]
  const from = channels(colour)

  // Contrast is monotonic in the mix as long as we move *away* from every surface, so a binary
  // search lands on the least change that clears the floor. 12 steps is finer than 8-bit.
  let lo = 0
  let hi = 1
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    const mixed = hex([0, 1, 2].map((k) => from[k]! + (target[k]! - from[k]!) * mid) as unknown as [number, number, number])
    if (worst(mixed) >= min) hi = mid
    else lo = mid
  }
  return hex([0, 1, 2].map((k) => from[k]! + (target[k]! - from[k]!) * hi) as unknown as [number, number, number])
}

/**
 * The office lamp, before either contrast floor is applied to it.
 *
 * `styles.css` carries this same value as `--lamp-dim`, which is what borders use and what
 * everything falls back to before a palette has been applied.
 */
const LAMP = '#8a6a38'

/** Text under 18.66px, which is all of it here. WCAG 1.4.3 level AA. */
export const TEXT_CONTRAST = 4.5

/** The edge of a control, when the edge is what tells you it is one. WCAG 1.4.11 level AA. */
export const EDGE_CONTRAST = 3


/**
 * The palette as CSS custom properties.
 *
 * The names are the contract between this file and `styles.css`, so they are generated from the
 * palette rather than written twice — a token the stylesheet uses and this function does not
 * emit is a colour that silently falls back to nothing, which is the failure mode CSS is worst
 * at reporting.
 */
export function cssVariables(p: Palette): Readonly<Record<string, string>> {
  return {
    ...semanticVariables(p),
    '--ground-0': p.ground[0],
    '--ground-1': p.ground[1],
    '--ground-2': p.ground[2],
    '--ground-3': p.ground[3],
    '--line': p.line,
    '--ink': p.ink,
    '--ink-dim': p.inkDim,
    // Text, so it clears 4.5:1 — against every ground it can land on, not just the darkest.
    '--ink-faint': legibleOn(p.inkFaint, p.ground, TEXT_CONTRAST),
    /*
       The lamp, at the two readings it is held to.

       `--lamp-dim` is a border in seven places and *text* in two, and WCAG asks different
       things of those: 3:1 of an edge, 4.5:1 of body text. Measured in the running app, the
       lamp on the pane is 3.56:1 — fine as a border, under the line as the "You" on every
       message you have ever sent.

       Derived here rather than written as a second hex in `styles.css`, because a fixed value
       is only correct for the grounds it was measured against. The two palettes that ship are
       both near-black; the moment a light one exists, a hand-picked light gold fails on it and
       nothing says so. `legibleOn` is the same machinery `--ink-faint` and `--syn-comment`
       already use, and it moves the least distance that clears the floor.

       Only the text reading is derived. The seven borders keep `--lamp-dim`, because at 3.56:1
       they already clear the 3:1 an edge is held to and `legibleOn` would hand back the same
       colour — a second derived token that changes nothing today, for a light palette that does
       not exist yet. If one is ever added, that is the moment to derive the edge too, and this
       is the note saying so.                                                                  */
    '--lamp-text': legibleOn(LAMP, p.ground, TEXT_CONTRAST),
    '--syn-keyword': p.syntax.keyword,
    '--syn-string': p.syntax.string,
    '--syn-number': p.syntax.number,
    '--syn-func': p.syntax.func,
    '--syn-type': p.syntax.type,
    '--syn-comment': legibleOn(p.syntax.comment, p.ground, TEXT_CONTRAST),
    '--syn-error': p.syntax.error,
    '--accent': p.roles.accent,
    '--good': p.roles.good,
    '--warn': p.roles.warn,
    '--bad': p.roles.bad,
    '--info': p.roles.info,
  }
}


/**
 * The semantic layer: what a surface is, and what may be written on it.
 *
 * shadcn/ui was asked for as a reference, and this is the idea worth taking from it. shadcn
 * pairs every surface token with a `-foreground` — `card` / `card-foreground`, `primary` /
 * `primary-foreground` — so a component names *the surface it is on* and gets the right text
 * colour for free. Nothing ever picks a text colour.
 *
 * We had the raw materials and not the pairing: four grounds and three inks, unrelated, so every
 * panel written in this repo chose its own text colour out of the list. That is why the roster,
 * the strip and the privacy panel each ended up with a slightly different idea of what "quiet
 * text on a raised surface" means. Four files, four answers, all defensible.
 *
 * **These are derived, not authored.** Every value below is a `ground` or an `ink` or a role
 * this palette already declares, which is what keeps the promise that a new theme is seven
 * syntax colours and a room — not twenty-two. A theme cannot get the pairing wrong because a
 * theme never states it.
 *
 * The names are shadcn's, deliberately. Somebody who has used it can read this stylesheet, and
 * the mapping below is the only translation they need:
 *
 * | here | is |
 * |---|---|
 * | `--background` | the window: `ground[0]` |
 * | `--card` | a panel resting on it: `ground[1]` |
 * | `--popover` | something floating over it: `ground[1]` |
 * | `--muted` | a quiet surface, and quiet text on any surface |
 * | `--primary` | the one interactive colour, and what is legible on it |
 * | `--secondary` | a control that is not the primary action |
 * | `--destructive` | delete, fire, refuse |
 * | `--input` | the ground inside a field — darker than the panel, so it reads as a hole |
 * | `--ring` | focus, everywhere, one colour |
 */
export function semanticVariables(p: Palette): Readonly<Record<string, string>> {
  return {
    '--background': p.ground[0],
    '--foreground': p.ink,

    '--card': p.ground[1],
    '--card-foreground': p.ink,

    // The same ground as a card on purpose. A popover is a card that happens to float; giving it
    // its own shade would make the same content two colours depending on where it opened.
    '--popover': p.ground[1],
    '--popover-foreground': p.ink,

    '--muted': p.ground[2],
    '--muted-foreground': p.inkDim,

    // The fourth ground is a raised surface — a hover, a selected row, a control that is not the
    // primary action. It is the one the old code kept reaching for and calling `--ground-3`.
    '--secondary': p.ground[3],
    '--secondary-foreground': p.ink,

    '--primary': p.roles.accent,
    // Text *on* the accent, not the accent. Both palettes put a light hue there, so the darkest
    // ground is what stays legible — and stating it as a token is what stops each button
    // guessing. An earlier one guessed `#241a08`, a literal that belongs to neither theme.
    '--primary-foreground': p.ground[0],

    '--destructive': p.roles.bad,
    '--destructive-foreground': p.ground[0],

    '--border': p.line,
    // A divider between two rows of the same thing needs no contrast floor — raising it draws a
    // grid nobody asked for. A control's edge is different: it is the thing that says "this is a
    // control", so WCAG 1.4.11 asks for 3:1 and `--border` was 1.24:1 against the card it sat on.
    '--border-strong': legibleOn(p.line, [p.ground[1], p.ground[2], p.ground[3]], EDGE_CONTRAST),
    // Darker than the card it sits on, so a field reads as a hole rather than a raised tile.
    '--input': p.ground[0],
    '--ring': p.roles.accent,
  }
}
