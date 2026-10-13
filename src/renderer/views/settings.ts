/**
 * The settings panel, and the seam laptop 2 left for it.
 *
 * `views/palette.ts` says in its own header: *"There is no settings panel yet — it is F9… when
 * F9 arrives with a real settings surface this whole function goes and `applyPalette` stays,
 * which is the seam it was written for."* This is F9 arriving. `mountPaletteControl` is gone;
 * `applyPalette` is called from here.
 *
 * Four preferences — theme, density, pane side, text size — stored on this machine rather than
 * in the workspace, because none of them is a fact about anybody's project. The parsing and the
 * defaults are in `shared/settings.ts` where a test can reach them; this reads storage, paints
 * the document, and draws four rows of buttons.
 */

import { PALETTES } from '../../shared/palette.js'
import {
  applied,
  DEFAULT_SETTINGS,
  DENSITIES,
  FONT_SCALES,
  parseSettings,
  scaleLabel,
  SIDES,
  type Settings,
} from '../../shared/settings.js'
import { applyPalette } from './palette.js'

const KEY = 'office-space.settings'

/** Palette ids, which is the one part of the settings vocabulary this module does not own. */
const themeIds = (): readonly string[] => PALETTES.map((p) => p.id)

/**
 * What was chosen last time.
 *
 * Never throws. A machine with storage disabled — a locked-down profile, private browsing —
 * is not an error state; it is somebody who gets the defaults every launch, which is a
 * perfectly usable app.
 */
export function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) {
      // Nothing stored under the new key. Before F9 the palette had a key of its own, and a
      // person who picked a theme yesterday should not lose it because the panel arrived.
      const legacy = localStorage.getItem('office-space.palette')
      return legacy ? parseSettings({ theme: legacy }, themeIds()) : DEFAULT_SETTINGS
    }
    return parseSettings(JSON.parse(raw), themeIds())
  } catch {
    return DEFAULT_SETTINGS
  }
}

function write(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Applied for this session either way. A preference that cannot be saved is still a
    // preference somebody just expressed.
  }
}

/**
 * Put the conversation column on the side the settings ask for — **in the document**, not in CSS.
 *
 * It was `order: -1`, which moves an element visually and leaves it where it was in the tab
 * order. The default is the conversation on the left, so by default the column a person sees
 * first was the second one the keyboard reached. `ade-af` measured what that costs, tabbing from
 * a cold start:
 *
 *     stop 1     #view-toggle      top right
 *     stops 2-7  the status bar    bottom
 *     stop 8     #switcher         top left
 *     stop 9     #new-open         top left
 *
 * Focus crosses the window diagonally twice per cycle and the top bar is visited at stops 1, 8
 * and 9 with the whole bottom of the screen in between. Everything is reachable and visible, so
 * nothing is broken — it is the order that is unreadable, which is exactly what a single-control
 * check cannot see and a sweep can.
 *
 * `order` is the cause rather than an aggravation: CSS reordering is defined not to affect
 * sequential navigation, so any layout built on it has a tab order that disagrees with the
 * screen by construction. Moving the node fixes both at once, and the grid places columns in
 * document order so the widths follow without a second rule.
 *
 * Exported and taking its elements, because `applySettings` runs against a real `document` and
 * this is the part with a right and a wrong answer.
 */
export function orderColumns(building: Element, pane: Element, side: Settings['side']): void {
  const first = building.firstElementChild
  if (side === 'left') {
    if (first !== pane) building.insertBefore(pane, first)
    return
  }
  if (building.lastElementChild !== pane) building.appendChild(pane)
}

/**
 * Put the settings onto the document.
 *
 * Exported because the app calls it once before anything else — a window that is briefly the
 * wrong colour, or briefly the wrong shape, is a worse first frame than one that waits.
 */
export function applySettings(settings: Settings): void {
  const { attributes, properties } = applied(settings)
  const root = document.documentElement

  for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value)
  for (const [name, value] of Object.entries(properties)) root.style.setProperty(name, value)

  const building = document.getElementById('building')
  const pane = building?.querySelector('.pane')
  if (building && pane) orderColumns(building, pane, settings.side)

  applyPalette(settings.theme)
}

export interface SettingsHandlers {
  /** Something changed. The floor parks when idle, so it has to be told to repaint. */
  readonly onChange: (settings: Settings) => void
  /**
   * Whether the office reads its reports aloud.
   *
   * Not part of {@link Settings} and deliberately so: the four above are local preferences in
   * `localStorage` that no office ever sees, and this one is a thing the *office* does, persisted
   * by main, that costs money per turn. Same panel, different owner — so it is read and written
   * through here rather than folded into a type that promises nothing travels.
   */
  readonly readAloud: () => boolean
  readonly setReadAloud: (on: boolean) => void
  /** False where the machine has no speech synthesiser. The row says so rather than lying. */
  readonly canReadAloud: boolean
}

/** Fill `host` with the five rows. */
export function renderSettings(host: HTMLElement, on: SettingsHandlers): void {
  let settings = readSettings()

  const update = (next: Partial<Settings>) => {
    settings = { ...settings, ...next }
    write(settings)
    applySettings(settings)
    on.onChange(settings)
    renderSettings(host, on)
  }

  host.replaceChildren(
    row(
      'Theme',
      'The interface palette, derived from a syntax theme. The office floor reads the same one.',
      PALETTES.map((p) => ({ label: p.name.toLowerCase(), on: p.id === settings.theme, pick: () => update({ theme: p.id }) })),
    ),
    row(
      'Density',
      'How much room everything is given. Compact fits more on a laptop screen.',
      DENSITIES.map((d) => ({ label: d, on: d === settings.density, pick: () => update({ density: d }) })),
    ),
    row(
      'Conversation on the',
      'Which side of the window the chat panel sits on.',
      SIDES.map((s) => ({ label: s, on: s === settings.side, pick: () => update({ side: s }) })),
    ),
    row(
      'Read aloud',
      on.canReadAloud
        ? 'Whether the office speaks when something finishes, fails or needs you — it stays quiet the rest of the time, and costs a little per turn. To talk to the office you need nothing here: system dictation types straight into the composer.'
        : 'This machine has no speech synthesiser, so the office cannot talk back. Talking to it still works — system dictation types straight into the composer.',
      on.canReadAloud
        ? [
            { label: 'off', on: !on.readAloud(), pick: () => { on.setReadAloud(false); renderSettings(host, on) } },
            { label: 'on', on: on.readAloud(), pick: () => { on.setReadAloud(true); renderSettings(host, on) } },
          ]
        : [{ label: 'unavailable', on: true, pick: () => {} }],
    ),
    row(
      'Text size',
      'Scales everything together, including the labels on the floor.',
      FONT_SCALES.map((s) => ({
        label: scaleLabel(s),
        on: s === settings.fontScale,
        pick: () => update({ fontScale: s }),
      })),
    ),
  )
}

interface Choice {
  readonly label: string
  readonly on: boolean
  readonly pick: () => void
}

/**
 * One preference, as a row of buttons.
 *
 * A radio group in behaviour and in markup: `role="radiogroup"` with `aria-checked`, so arrow
 * keys and a screen reader both work without a keydown handler of our own. Native `<input
 * type="radio">` would give that for free, but not the look, and the accessible name of a styled
 * radio is the fight this avoids.
 */
function row(label: string, note: string, choices: readonly Choice[]): HTMLElement {
  const section = document.createElement('section')
  section.className = 'setting'

  const head = document.createElement('p')
  head.className = 'setting__label'
  head.textContent = label
  section.appendChild(head)

  const group = document.createElement('div')
  group.className = 'setting__choices'
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-label', label)

  for (const choice of choices) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'setting__choice'
    button.textContent = choice.label
    button.setAttribute('role', 'radio')
    button.setAttribute('aria-checked', String(choice.on))
    // Only the chosen one is in the tab order; arrow keys move within the group. This is the
    // standard radio-group pattern and it is what stops four preferences costing sixteen tab
    // stops on the way to the composer.
    button.tabIndex = choice.on ? 0 : -1
    button.addEventListener('click', choice.pick)
    button.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
      if (step === 0) return
      event.preventDefault()
      const at = choices.findIndex((c) => c.on)
      choices[(at + step + choices.length) % choices.length]?.pick()
    })
    group.appendChild(button)
  }

  section.appendChild(group)

  const hint = document.createElement('p')
  hint.className = 'setting__note'
  hint.textContent = note
  section.appendChild(hint)

  return section
}
