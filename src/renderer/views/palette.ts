/**
 * Putting a palette on the page.
 *
 * `src/shared/palette.ts` decides what the colours are; this decides when they are on the
 * document. Two functions and no state beyond `localStorage`, because the interface theme is a
 * preference about this machine rather than anything to do with the workspace — it does not
 * belong in `.office-space/`, which the office writes about a *project*.
 *
 * ## Why there is a control here at all rather than in the settings panel
 *
 * There is no settings panel yet — it is F9. A second palette that nothing can reach is an
 * orphan, and this round's plan calls orphans out by name. So the theme cycles from the floor's
 * status bar until F9 gives it a proper home: reachable now, replaced later, and never a
 * feature that exists only in the source.
 */

import { cssVariables, paletteById } from '../../shared/palette.js'
import { applyRoomPalette } from '../props.js'

/**
 * Paint a palette onto the root element.
 *
 * Setting the properties on `documentElement` rather than swapping a stylesheet means the
 * static declarations in `styles.css` stay as the floor under this — if a future palette forgets
 * a token, the default's value is still there rather than nothing. `test/palette.test.ts` makes
 * that a belt over braces rather than the only thing holding the trousers up.
 */
export function applyPalette(id: string): void {
  const palette = paletteById(id)
  const root = document.documentElement
  for (const [name, value] of Object.entries(cssVariables(palette))) {
    root.style.setProperty(name, value)
  }
  root.dataset['palette'] = palette.id
  // The room, from the same object. This is the line the whole palette module exists for: the
  // interface and the office stop being two lists that nearly agree.
  applyRoomPalette(palette)
}

// `storedPalette` went with `mountPaletteControl`, which was its only caller. `settings.ts` reads
// the same legacy key directly, at the one place that still cares — the F9 migration, for a
// person who picked a theme before the panel existed.

// `mountPaletteControl` was here — a working palette-cycling button that nothing mounted.
//
// Its own comment predicted its end: *"when F9 arrives with a real settings surface this whole
// function goes and `applyPalette` stays, which is the seam it was written for."* F9 arrived.
// `views/settings.ts` says so in its header — *"This is F9 arriving. `mountPaletteControl` is
// gone; `applyPalette` is called from here"* — and `panels.css` says it too.
//
// Three places recorded the deletion and the deletion never happened. That is worse than an
// ordinary orphan: the notes are right about the design and wrong about the code, so anybody
// checking whether the old control still exists is told no by three documents and yes by the
// export list.
