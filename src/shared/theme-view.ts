/**
 * The two strings the theme pill shows.
 *
 * Here rather than in `app.ts` for the reason the other five `*-view.ts` modules are here: a
 * string the user reads is worth a test, and a string built inline in a 2700-line renderer is
 * not reachable by one.
 *
 * ## The fact that was not being shown
 *
 * `ThemeInfo.redistributable` was built in four places, crossed the bridge in every snapshot,
 * and was read by nothing. `scripts/unread-fields.mjs` has been reporting it — the script says
 * of itself that it over-reports and is a place to look rather than a test, and this was one of
 * the ones worth looking at.
 *
 * What made it worth fixing rather than deleting is `theme.ts`, where the field's own comment
 * says: *"Anything a user installs is theirs, stays on their machine, and is never committed —
 * the app surfaces this so nobody has to read a licence to know."* The first half is true and
 * enforced: `assets/themes/**` is gitignored, `docs/themes.md` explains why, and every pack
 * anybody looked at permits commercial use and forbids redistribution, so committing one
 * breaches the licence the user just paid for. The second half was made in that comment and
 * nowhere else.
 */

import type { ThemeChoice, ThemeInfo } from './ipc.js'

/**
 * What the pill says.
 *
 * The credit is not decoration — nearly every licence that permits commercial use requires
 * attribution wherever the art is named, so it is named here.
 */
export function themeLabel(theme: ThemeInfo): string {
  return theme.credit ? `${theme.name} — ${theme.credit}` : theme.name
}

/**
 * What hovering it says.
 *
 * Two independent facts, because they answer two different questions and either can apply
 * without the other: what this control does, and what the art you are looking at costs you.
 * A user with one bought pack installed has a control that does nothing *and* a licence worth
 * knowing about; a user with three has the opposite of the first and the same of the second.
 */
export function themeTitle(theme: ThemeInfo, themes: readonly ThemeChoice[]): string {
  const control =
    themes.length < 2
      ? 'Install a pack into assets/themes/ to use your own art. See docs/themes.md.'
      : `Switch theme — ${themes.map((t) => t.name).join(', ')}`

  // Only ever false for something the user installed themselves, which is exactly when the
  // sentence is worth reading. Saying it about the built-in would be noise on every fresh clone.
  //
  // "installed", not "licensed". The first draft said *art you licensed*, and driving the app
  // with the synthetic test pack installed put that sentence under a credit reading *"Generated
  // by scratch/make-theme.ts … Not art, and not anybody else's."* `main` sets `redistributable:
  // false` for every installed pack, so what the office actually knows is that this came from
  // outside it — whether money changed hands is a thing it was inferring. The three facts after
  // the colon are true of any installed pack either way, and they are the ones worth having.
  const licence = theme.redistributable
    ? ''
    : ` · ${theme.name} is yours: it stays in assets/themes/, which is gitignored, and is never committed.`

  return `${control}${licence}`
}
