/**
 * The four preferences, and the command palette that reaches everything else.
 *
 * Two things worth testing here and they are both about *recovery*. Stored settings are the one
 * input to this app that comes from a previous version of itself — hand-edited, written by a
 * build that had a fifth preference, or from a machine where storage is disabled. And the
 * palette is what makes "reachable with the keyboard" true, so its matching has to find the
 * thing somebody meant rather than the thing that happens to sort first.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applied,
  DEFAULT_SETTINGS,
  FONT_SCALES,
  parseSettings,
  scaleLabel,
} from '../src/shared/settings.js'
import { byGroup, filterActions, type Action } from '../src/shared/actions.js'
import { PALETTES } from '../src/shared/palette.js'

const themes = PALETTES.map((p) => p.id)

test('one bad field does not cost you the other three', () => {
  // The failure this is written against: validate-the-whole-object, fall back to defaults. A
  // `fontScale` written by some future version silently resets somebody's theme, density and
  // pane side too — three preferences lost to one they never touched.
  const recovered = parseSettings(
    { theme: 'graphite', density: 'compact', side: 'left', fontScale: 'enormous' },
    themes,
  )

  assert.equal(recovered.theme, 'graphite')
  assert.equal(recovered.density, 'compact')
  assert.equal(recovered.side, 'left')
  assert.equal(recovered.fontScale, DEFAULT_SETTINGS.fontScale)
})

test('nothing stored, nonsense stored, and null all give the defaults', () => {
  for (const raw of [undefined, null, {}, 42, 'settings', []]) {
    assert.deepEqual(parseSettings(raw, themes), DEFAULT_SETTINGS, `${JSON.stringify(raw)} did not recover`)
  }
})

test('a theme that no longer exists falls back rather than rendering nothing', () => {
  // A palette removed between versions, or a typo. Applying an unknown id would set no custom
  // properties at all, which renders as an interface with no colours — much worse than the
  // wrong theme.
  assert.equal(parseSettings({ theme: 'sunset-vaporwave' }, themes).theme, DEFAULT_SETTINGS.theme)
  assert.equal(parseSettings({ theme: themes[1] }, themes).theme, themes[1])
})

test('only the offered text sizes are accepted', () => {
  // An arbitrary scale would render, and then the panel would show four buttons none of which
  // is selected — a control that cannot describe its own state.
  for (const scale of FONT_SCALES) {
    assert.equal(parseSettings({ fontScale: scale }, themes).fontScale, scale)
  }
  assert.equal(parseSettings({ fontScale: 1.05 }, themes).fontScale, DEFAULT_SETTINGS.fontScale)
})

test('every setting reaches the document as something CSS can read', () => {
  const { attributes, properties } = applied({
    theme: 'graphite',
    density: 'compact',
    side: 'left',
    fontScale: 1.25,
  })

  assert.equal(attributes['data-density'], 'compact')
  assert.equal(attributes['data-side'], 'left')
  assert.equal(properties['--font-scale'], '1.25')
  // Density is spacing and only spacing. If this ever became a font size, "compact" and "text
  // size" would be two controls doing half of each other's job.
  assert.equal(properties['--density'], '0.75')
  assert.equal(applied(DEFAULT_SETTINGS).properties['--density'], '1')
})

test('the size label is a percentage a person would say out loud', () => {
  assert.deepEqual(FONT_SCALES.map(scaleLabel), ['90%', '100%', '110%', '125%'])
})

// ─────────────────────────────────────────────────────────── the command palette ──

const actions: readonly Action[] = [
  { id: 'roster', label: 'Open the roster — who works here', group: 'Office', also: ['staff', 'hire'] },
  { id: 'privacy', label: 'What leaves this machine, and what is kept', group: 'Office', also: ['privacy', 'delete'] },
  { id: 'settings', label: 'Settings — theme, density, layout', group: 'View' },
  { id: 'campus', label: 'Zoom out to the campus', group: 'View', also: ['projects'] },
]

test('typing the shape of a word finds it', () => {
  // Subsequence, not prefix. This is the difference between a palette and a menu with a search
  // box: you type what you remember, in the order you remember it, and it narrows.
  assert.equal(filterActions(actions, 'rost')[0]?.id, 'roster')
  assert.equal(filterActions(actions, 'zmout')[0]?.id, 'campus')
  assert.equal(filterActions(actions, 'dnsty')[0]?.id, 'settings')
})

test('a word that is not in the label but is what people type still matches', () => {
  // Nothing in the privacy row says "delete", and deleting your data is exactly what somebody
  // opens it for.
  assert.equal(filterActions(actions, 'delete')[0]?.id, 'privacy')
  assert.equal(filterActions(actions, 'staff')[0]?.id, 'roster')
})

test('an earlier match wins over a scattered one', () => {
  // "Settings" starts with `set`; "What leaves this machine, and what is kept" contains s…e…t
  // scattered across three words. Both are matches and only one is what was meant.
  const found = filterActions(actions, 'set')
  assert.equal(found[0]?.id, 'settings')
})

test('an empty query is every action, in the order they were declared', () => {
  // The declared order is somebody's judgement about what people reach for. Sorting it away
  // when there is nothing to sort by would throw that out.
  assert.deepEqual(
    filterActions(actions, '   ').map((a) => a.id),
    actions.map((a) => a.id),
  )
})

test('nothing matching is an empty list, not everything', () => {
  assert.deepEqual(filterActions(actions, 'qqqq'), [])
})

test('grouping keeps the order the groups first appeared in', () => {
  const grouped = byGroup(filterActions(actions, ''))
  assert.deepEqual(
    grouped.map((g) => g.group),
    ['Office', 'View'],
  )
  assert.deepEqual(
    grouped[0]?.actions.map((a) => a.id),
    ['roster', 'privacy'],
  )
})
