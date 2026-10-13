/**
 * What the settings panel's controls actually do — the half `every-button.dom.test.ts` says it
 * does not check.
 *
 * That file states the distinction it works to, and it is the reason this one exists:
 *
 *   1. the press reaches a handler   <- every-button.dom.test.ts
 *   2. the handler does something    <- a behaviour test, per view
 *   3. what it does is visible       <- only running it shows that
 *
 * Twelve settings buttons pass (1), and until now nothing asked (2) of any of them. That gap is
 * not theoretical here: this whole branch started from a report that these controls did nothing,
 * and the answer turned out to be that one row of them changes 41 variables nobody can see. A
 * check on (1) alone would have agreed with the report's diagnosis and missed its cause.
 *
 * ## The three rules the module states
 *
 * **A preference that cannot be saved is still a preference.** Storage may be gone — a
 * locked-down profile, private browsing — and *"that is not an error state; it is somebody who
 * gets the defaults every launch, which is a perfectly usable app."* So neither reading nor
 * writing may throw, and a failed write must still apply for this session.
 *
 * **A theme picked before the panel existed is not lost.** Before F9 the palette had a key of its
 * own, and `readSettings` migrates it.
 *
 * **Applied before anything else is drawn.** `applySettings` is exported precisely so the app can
 * call it first — *"a window that is briefly the wrong colour, or briefly the wrong shape, is a
 * worse first frame than one that waits."*
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { applySettings, readSettings, renderSettings, type SettingsHandlers } from '../src/renderer/views/settings.js'
import { DEFAULT_SETTINGS, FONT_SCALES, type Settings } from '../src/shared/settings.js'

installDom()

const KEY = 'office-space.settings'

/** A `localStorage` a test can steer, including into failure. */
function storage(initial: Record<string, string> = {}, options: { readonly broken?: boolean } = {}): Map<string, string> {
  const store = new Map(Object.entries(initial))
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => {
        if (options.broken) throw new Error('storage is disabled in this profile')
        return store.get(k) ?? null
      },
      setItem: (k: string, v: string) => {
        if (options.broken) throw new Error('storage is disabled in this profile')
        store.set(k, v)
      },
      removeItem: (k: string) => store.delete(k),
    },
  })
  return store
}

const root = (): El => document.documentElement as unknown as El

interface Panel {
  readonly host: El
  readonly press: (label: string) => void
  readonly labels: () => string[]
  readonly changes: Settings[]
}

function panel(): Panel {
  const host = document.createElement('div')
  const changes: Settings[] = []
  const on: SettingsHandlers = {
    onChange: (s) => changes.push(s),
    readAloud: () => false,
    setReadAloud: () => {},
    canReadAloud: true,
  }
  renderSettings(host, on)

  const all = (n: El): El[] => [n, ...n.children.flatMap(all)]
  return {
    host: host as unknown as El,
    changes,
    labels: () => all(host as unknown as El).filter((n) => n.tag === 'button').map((b) => (b.textContent ?? '').trim()),
    press: (label) => {
      const button = all(host as unknown as El).find((b) => b.tag === 'button' && (b.textContent ?? '').trim() === label)
      assert.ok(button, `no button labelled ${JSON.stringify(label)} — found ${JSON.stringify(all(host as unknown as El).filter((n) => n.tag === 'button').map((b) => (b.textContent ?? '').trim()))}`)
      button.dispatchEvent({ type: 'click', bubbles: true })
    },
  }
}

test('pressing a density writes it, and puts it on the document', () => {
  const store = storage()
  const p = panel()
  // The control: the panel must actually offer this, or the press below is about nothing.
  assert.ok(p.labels().includes('compact'), `no density choice rendered: ${JSON.stringify(p.labels())}`)

  p.press('compact')

  assert.equal(root().getAttribute('data-density'), 'compact', 'the density never reached the document, so no stylesheet can see it')
  assert.equal(root().style.getPropertyValue('--density'), '0.75', 'the density multiplier the layout reads was not set')
  assert.match(store.get(KEY) ?? '', /compact/, 'the choice was applied but not saved, so it is gone next launch')
  assert.equal(p.changes.at(-1)?.density, 'compact', 'the caller was not told, so the floor never repaints')
})

test('pressing a text size scales the whole interface, not one element', () => {
  const store = storage()
  const p = panel()
  p.press('125%')

  assert.equal(
    root().style.getPropertyValue('--font-scale'),
    '1.25',
    'the scale is a multiplier every rem in both stylesheets reads — setting anything else means ' +
      'restating it per element, which is how half the app ends up not scaling',
  )
  assert.match(store.get(KEY) ?? '', /1\.25/)
})

test('pressing a side moves the pane and records which', () => {
  storage()
  const p = panel()
  p.press('right')
  assert.equal(root().getAttribute('data-side'), 'right')
  p.press('left')
  assert.equal(root().getAttribute('data-side'), 'left')
})

test('a theme picked before the panel existed is not lost', () => {
  // Before F9 the palette had a key of its own. Somebody who chose a theme yesterday should not
  // get the default because the settings panel arrived today.
  storage({ 'office-space.palette': 'graphite' })
  const settings = readSettings()
  assert.equal(settings.theme, 'graphite', 'the pre-F9 theme was dropped on the floor')
})

test('a stored value that is nonsense reads as the defaults, not as a crash', () => {
  for (const stored of ['{ not json', '{}', 'null', '{"density":"enormous","fontScale":"huge"}', '[]']) {
    storage({ [KEY]: stored })
    const settings = readSettings()
    assert.equal(settings.density, DEFAULT_SETTINGS.density, `density survived ${JSON.stringify(stored)}`)
    assert.ok(
      FONT_SCALES.includes(settings.fontScale as never),
      `${JSON.stringify(stored)} produced a font scale of ${settings.fontScale}, which is not one this app offers`,
    )
  }
})

test('a machine with no storage gets the defaults rather than an error', () => {
  // "That is not an error state; it is somebody who gets the defaults every launch, which is a
  // perfectly usable app."
  storage({}, { broken: true })
  assert.doesNotThrow(() => readSettings(), 'a locked-down profile makes the settings panel throw')
  assert.deepEqual(readSettings(), DEFAULT_SETTINGS)
})

test('a preference that cannot be saved is still applied for this session', () => {
  storage({}, { broken: true })
  const p = panel()
  assert.doesNotThrow(() => p.press('compact'), 'pressing a setting on a machine with no storage throws')
  assert.equal(
    root().getAttribute('data-density'),
    'compact',
    'the write failed and the preference was dropped with it. Somebody who just expressed a ' +
      'preference should have it for as long as the window is open, whatever the profile allows.',
  )
})

test('applySettings puts everything on the document in one go', () => {
  // Exported so the app can call it before the first frame: a window that is briefly the wrong
  // colour, or briefly the wrong shape, is a worse first frame than one that waits.
  storage()
  applySettings({ theme: 'graphite', density: 'compact', side: 'right', fontScale: 0.9 } as Settings)

  assert.equal(root().getAttribute('data-density'), 'compact')
  assert.equal(root().getAttribute('data-side'), 'right')
  assert.equal(root().style.getPropertyValue('--font-scale'), '0.9')
  assert.equal(root().style.getPropertyValue('--density'), '0.75')
  assert.equal(root().dataset['palette'], 'graphite', 'the palette was not applied, so the interface and the room disagree')
})

/**
 * ## The keyboard on a group of preferences
 *
 * Each row of settings is a radio group, and the module says what the pattern buys:
 *
 *     Only the chosen one is in the tab order; arrow keys move within the group. This is the
 *     standard radio-group pattern and it is what stops four preferences costing sixteen tab
 *     stops on the way to the composer.
 *
 * Both halves are needed and they fail independently. Put every button in the tab order and the
 * panel is correct but exhausting. Take the arrows away instead and the group is short to tab
 * past and impossible to change without a mouse, which is worse.
 *
 * It wraps, where the switcher's list clamps. Not an inconsistency: a radio group is a set of
 * alternatives you cycle among, and that is what every other radio group on the platform does.
 *
 * ## Re-queried every time, because the panel rebuilds itself
 *
 * `update()` ends in `renderSettings(host, on)`, so every pick replaces every button. A test
 * holding a reference from before the press is holding an element that is no longer on screen —
 * which is the same fault `select.ts` records against its own list, and it made the first draft
 * of these tests report that the arrow keys did nothing at all.
 */

const groupOf = (p: Panel, ...labels: string[]): El[] => {
  const all = (n: El): El[] => [n, ...n.children.flatMap(all)]
  return all(p.host).filter((n) => n.tag === 'button' && labels.includes((n.textContent ?? '').trim()))
}

/** Press a key on the group as it stands now, having re-found it after the last redraw. */
const arrow = (p: Panel, labels: string[], key: string): void => {
  const group = groupOf(p, ...labels)
  assert.ok(group.length > 0, `no group matching ${JSON.stringify(labels)} to press ${key} on`)
  group[0]!.dispatchEvent({ type: 'keydown', bubbles: true, key, preventDefault: () => {} })
}

const DENSITY = ['comfortable', 'compact']
const SIZES = ['90%', '100%', '110%', '125%']

test('only the chosen preference is a tab stop', () => {
  storage()
  const p = panel()
  const group = groupOf(p, ...DENSITY)
  assert.equal(group.length, 2, `expected two density buttons, found ${group.length}`)

  const stops = group.map((b) => (b as unknown as { tabIndex: number }).tabIndex)
  assert.equal(
    stops.filter((t) => t === 0).length,
    1,
    `${stops.filter((t) => t === 0).length} of ${stops.length} density buttons are tab stops ` +
      `(${JSON.stringify(stops)}). Four groups at that rate is sixteen presses between opening ` +
      `settings and getting back to the composer.`,
  )
  assert.ok(stops.includes(-1), 'no button was taken out of the tab order at all')
})

test('the arrows move within a group and apply as they go', () => {
  storage()
  const p = panel()
  // Set a known starting point through the panel itself, so the assertion is not about whatever
  // the shared documentElement was left holding by an earlier test.
  p.press('comfortable')
  assert.equal(root().getAttribute('data-density'), 'comfortable', 'the starting point did not take')

  arrow(p, DENSITY, 'ArrowRight')
  assert.equal(root().getAttribute('data-density'), 'compact', 'ArrowRight did not move to the next choice')
  assert.ok(p.changes.length > 0, 'the caller was never told, so nothing outside the panel follows the change')

  arrow(p, DENSITY, 'ArrowLeft')
  assert.equal(root().getAttribute('data-density'), 'comfortable', 'ArrowLeft did not come back')
})

test('ArrowDown and ArrowUp do the same as Right and Left', () => {
  // Both axes, because a row of buttons is read as horizontal by some people and vertical by
  // others, and a group that answers only one of them is half a control.
  storage()
  const p = panel()
  p.press('comfortable')

  arrow(p, DENSITY, 'ArrowDown')
  assert.equal(root().getAttribute('data-density'), 'compact', 'ArrowDown did nothing')
  arrow(p, DENSITY, 'ArrowUp')
  assert.equal(root().getAttribute('data-density'), 'comfortable', 'ArrowUp did nothing')
})

test('the group wraps, the way every radio group does', () => {
  storage()
  const p = panel()
  p.press('90%')

  const seen = new Set<string>()
  for (let i = 0; i < SIZES.length + 1; i += 1) {
    arrow(p, SIZES, 'ArrowRight')
    seen.add(root().style.getPropertyValue('--font-scale'))
  }

  assert.equal(
    seen.size,
    SIZES.length,
    `walking ${SIZES.length + 1} steps through ${SIZES.length} choices reached ${seen.size} of ` +
      `them (${[...seen].join(', ')}). A group that stops at the end leaves the choices past it ` +
      `unreachable by keyboard.`,
  )
})

test('a key that is not an arrow is left alone', () => {
  // The group must not swallow Tab, or the tab-order work above buys nothing.
  storage()
  const p = panel()
  p.press('compact')

  for (const key of ['Tab', 'Enter', 'a', 'Escape']) arrow(p, DENSITY, key)
  assert.equal(root().getAttribute('data-density'), 'compact', 'a key that is not an arrow changed the setting')
})
