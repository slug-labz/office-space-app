/**
 * Switching a theme has to repaint both halves, or the office wears yesterday's clothes.
 *
 * `applyPalette` is the whole mechanism behind the theme row in the settings panel. It does two
 * things from one object: writes every CSS variable onto `documentElement` for the interface,
 * and calls `applyRoomPalette` to repaint the canvas room. Its own comment says which line
 * matters and why:
 *
 *     The room, from the same object. This is the line the whole palette module exists for:
 *     the interface and the office stop being two lists that nearly agree.
 *
 * Remove that call and nothing breaks. The panel redraws, the interface changes colour, every
 * test in the suite passes, and the office floor keeps painting itself in the palette you just
 * left — because the room's colours live in a mutable object that nobody told. Two lists that
 * nearly agree is exactly what it would go back to being.
 *
 * ## Why this is worth a test now
 *
 * Nothing was aimed at this module — it sat in the census under "loads fine, no test" — and it
 * is about to matter. Both palettes that ship are near-black and differ by two units of red:
 * pressing either theme button genuinely changes 41 variables and reaches the paint, and nobody
 * can see it. That is with Vish as a design decision, and every way of answering it goes through
 * this function.
 *
 * ## What is asserted, and what is not
 *
 * That every variable the palette declares reaches the root, that `data-palette` records which
 * one won, that an unknown id falls back to a real palette rather than leaving the office
 * unpainted, and that the room is repainted from the same object as the interface.
 *
 * Not that the colours are *good*, or distinguishable, or that anybody can see the difference.
 * That is the open question, and a test claiming to have settled it would be the second thing in
 * this repository to say something true and useless about the palettes.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom } from './dom.js'
import { applyPalette } from '../src/renderer/views/palette.js'
import { PALETTE } from '../src/renderer/props.js'
import { PALETTES, cssVariables, paletteById } from '../src/shared/palette.js'

installDom()

const root = (): { style: { getPropertyValue: (n: string) => string }; dataset: Record<string, string> } =>
  document.documentElement as unknown as never

test('every variable the palette declares reaches the root', () => {
  for (const palette of PALETTES) {
    applyPalette(palette.id)

    const declared = cssVariables(palette)
    // The control: a palette that declares nothing would pass the loop below without running it.
    assert.ok(Object.keys(declared).length > 20, `${palette.id} declares only ${Object.keys(declared).length} variables`)

    const missing: string[] = []
    for (const [name, value] of Object.entries(declared)) {
      if (root().style.getPropertyValue(name) !== value) {
        missing.push(`${name}: root has ${JSON.stringify(root().style.getPropertyValue(name))}, palette says ${JSON.stringify(value)}`)
      }
    }
    assert.deepEqual(missing, [], `${palette.id} did not reach the interface:\n  ${missing.join('\n  ')}`)
  }
})

test('the root records which palette won', () => {
  for (const palette of PALETTES) {
    applyPalette(palette.id)
    assert.equal(
      root().dataset['palette'],
      palette.id,
      'panels.css selects on [data-palette], and the settings panel reads it back to show which ' +
        'theme is on. A palette applied without recording itself is one the panel cannot tick.',
    )
  }
})

test('an unknown id paints a real palette rather than leaving the office blank', () => {
  applyPalette('a-theme-that-never-existed')

  const fallback = paletteById('a-theme-that-never-existed')
  assert.ok(PALETTES.some((p) => p.id === fallback.id), 'the fallback is not one of the palettes that ship')
  assert.equal(root().dataset['palette'], fallback.id)
  assert.equal(
    root().style.getPropertyValue('--background'),
    cssVariables(fallback)['--background'],
    'an id nobody recognises must still paint something — a settings value from an older ' +
      'release, or a hand-edited file, should not produce an office with no colours in it',
  )
})

test('the room is repainted from the same object as the interface', () => {
  // The line the module exists for. `PALETTE` is a mutable object the canvas reads every frame,
  // so if nothing writes to it the floor keeps the previous theme while the panel around it
  // changes — and there is no error, no failing test, and nothing on screen that looks broken
  // except that the two halves disagree.
  const [first, second] = PALETTES
  assert.ok(first && second && first.id !== second.id, 'this needs two different palettes to compare')

  applyPalette(first.id)
  const afterFirst = { ...PALETTE }

  applyPalette(second.id)
  const afterSecond = { ...PALETTE }

  const changed = Object.keys(afterSecond).filter((k) => (afterSecond as Record<string, unknown>)[k] !== (afterFirst as Record<string, unknown>)[k])
  assert.ok(
    changed.length > 0,
    `switching from ${first.id} to ${second.id} changed nothing in the room's palette. The ` +
      'interface would repaint and the office floor would go on drawing itself in the theme you ' +
      'just left.',
  )

  // And it is the *right* object: the room's ink must be the palette's ink, not something near it.
  assert.equal(PALETTE.ink, second.ink, 'the room was repainted from something other than the palette that was applied')
  assert.equal(PALETTE.floor, second.room.floor)
  assert.equal(PALETTE.accent, second.roles.accent)
  // The fourth, added with the campus's waiting mark. Named here rather than left to the three
  // above it: this list is what stops a new interface colour being wired at declaration and
  // never on theme change, which is a mark that is correct until somebody switches theme.
  assert.equal(PALETTE.warn, second.roles.warn)
})
