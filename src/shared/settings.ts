/**
 * What the interface remembers about how you like it.
 *
 * Four preferences, and the reason they live together rather than as four `localStorage` keys is
 * that they are read together on every start and a partial read is the failure worth designing
 * against: a stored blob written by an older version, or hand-edited, or from a machine where
 * storage is disabled. {@link readSettings} never throws and never returns half an answer — it
 * returns the defaults for anything it does not recognise, one field at a time, so a single bad
 * value cannot cost you the other three.
 *
 * They are stored on the **machine**, not in the workspace. `.office-space/` holds facts about a
 * project — which conversations exist, what is waiting for a decision — and it is shared if the
 * project is. "I prefer the pane on the left" is not a fact about anybody's project.
 *
 * Nothing here touches the DOM or `localStorage`; that is `views/settings.ts`. This is the shape,
 * the defaults, and the parsing — which is the part that has to be right and the part a test can
 * reach.
 */

export const DENSITIES = ['comfortable', 'compact'] as const
export const SIDES = ['right', 'left'] as const
/** Multipliers on the root font size. Enough range to matter, few enough to be a row of buttons. */
export const FONT_SCALES = [0.9, 1, 1.1, 1.25] as const

export type Density = (typeof DENSITIES)[number]
export type Side = (typeof SIDES)[number]

export interface Settings {
  /** A palette id. Validated against the palette list by the caller, which owns that list. */
  readonly theme: string
  readonly density: Density
  /** Which side of the window the conversation is on. */
  readonly side: Side
  readonly fontScale: number
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'night-shift',
  density: 'comfortable',
  /**
   * Left, on Khalid's call.
   *
   * F1a's argument was already that the conversation is the thing you use and the floor is the
   * thing you watch — and reading order puts what you use first. Still a setting, because a
   * second monitor and a different hand change the answer.
   */
  side: 'left',
  fontScale: 1,
}

/**
 * Parse whatever was stored, field by field.
 *
 * Field by field on purpose. The obvious implementation validates the whole object and falls
 * back to the defaults if anything is wrong, which means a `fontScale` of `"large"` written by
 * some future version silently resets somebody's theme and pane side as well. Recovering three
 * of four preferences is strictly better than recovering none, and it costs four lines.
 */
export function parseSettings(raw: unknown, knownThemes: readonly string[]): Settings {
  const it = (raw ?? {}) as Record<string, unknown>

  const theme = typeof it['theme'] === 'string' && knownThemes.includes(it['theme']) ? it['theme'] : DEFAULT_SETTINGS.theme
  const density = DENSITIES.find((d) => d === it['density']) ?? DEFAULT_SETTINGS.density
  const side = SIDES.find((s) => s === it['side']) ?? DEFAULT_SETTINGS.side
  // Nearest of the offered scales rather than any number: an arbitrary value would render, and
  // then the settings panel would show four buttons none of which is selected.
  const fontScale = FONT_SCALES.find((s) => s === it['fontScale']) ?? DEFAULT_SETTINGS.fontScale

  return { theme, density, side, fontScale }
}

/**
 * The custom properties and data attributes a settings object implies.
 *
 * Returned as data rather than applied, so the mapping can be asserted without a document. Every
 * value here is consumed by a rule in `panels.css`; a name added to one and not the other is an
 * undefined custom property, which renders as nothing at all rather than as an error.
 */
export interface Applied {
  readonly attributes: Readonly<Record<string, string>>
  readonly properties: Readonly<Record<string, string>>
}

export function applied(settings: Settings): Applied {
  return {
    attributes: {
      'data-density': settings.density,
      'data-side': settings.side,
    },
    properties: {
      // A multiplier rather than a size, so every `rem` in both stylesheets scales together and
      // nothing has to be restated per element.
      '--font-scale': String(settings.fontScale),
      // Density is spacing, and spacing is one number the layout multiplies. `compact` is a
      // quarter tighter, which is the difference between "more fits" and "it is cramped".
      '--density': settings.density === 'compact' ? '0.75' : '1',
    },
  }
}

/** `110%`. What the button says. */
export function scaleLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`
}
