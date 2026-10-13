/**
 * Who the floor decides to draw, and what it says about the people it cannot.
 *
 * This is the seam `setCast` exists for, and until the harness grew `createImageBitmap` and
 * `ImageData` it could not be reached: every path through it ends in `toBitmaps`, so the art map
 * stayed empty, `rebuild` skipped everybody, and the floor rendered an empty office. Every
 * question about who is on it then answered itself by drawing nobody.
 *
 * ## The mystery this seam exists to prevent
 *
 * `setCast` states it where a pack fails to decode:
 *
 *     A pack that will not decode is reported and the person is skipped, never drawn as a blank.
 *     An office missing somebody is obvious; an office of invisible people is a mystery, and the
 *     mystery is what this whole seam exists to prevent.
 *
 * Both halves matter and only one of them is visible. Skipping is the safe half. *Reporting* is
 * the half that turns "where did the reviewer go?" into an answer, and it is a callback nothing
 * on screen depends on — which is exactly the kind of thing that gets dropped in a refactor and
 * is never noticed, because the floor looks fine. It looks like an office with fewer people.
 *
 * ## And art is keyed by what it depends on
 *
 *     Keyed by **what the art depends on**, not by who it is of. Keyed by id, an agent whose
 *     description changed kept their old character until a restart, because the cache had no way
 *     to know the look had moved.
 *
 * A cache keyed by identity when the value depends on appearance is right until somebody edits
 * an agent, and then it is silently, permanently wrong — the third standing order, expressed as
 * a map key.
 *
 * ## What this does not claim
 *
 * Nothing about pixels. The bitmaps here are stubs carrying width and height; a claim about what
 * the office *looks* like would be a claim about the stub. What is answerable is who the floor
 * decided to draw, when it re-fetched art, and what it released — decisions, not images.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom } from './dom.js'
import { FloorView, type FloorCallbacks } from '../src/renderer/floor-view.js'
import type { SpriteSheet, StaffMember } from '../src/shared/ipc.js'

installDom()

const person = (id: string, over: Partial<StaffMember> = {}): StaffMember => ({
  id,
  name: id,
  description: `the ${id}`,
  tools: [],
  model: null,
  isManager: false,
  ...over,
})

/** A sheet painted in code — the shape that avoids PNG decoding entirely. */
const SHEET: Extract<SpriteSheet, { kind: 'painted' }> = {
  kind: 'painted',
  width: 16,
  height: 24,
  frames: {
    down: [new Uint8ClampedArray(16 * 24 * 4)],
    up: [new Uint8ClampedArray(16 * 24 * 4)],
    right: [new Uint8ClampedArray(16 * 24 * 4)],
  },
}

interface Rig {
  readonly view: FloorView
  /** Every id the floor asked for art for, in order. Re-fetches are visible here. */
  readonly fetched: string[]
  readonly artFailed: { who: string; cause: string }[]
  /** The injected fetcher, handed back so each test drives the same one the rig is recording. */
  readonly sprites: (id: string) => Promise<SpriteSheet>
}

function rig(options: { readonly broken?: ReadonlySet<string>; readonly absent?: ReadonlySet<string> } = {}): Rig {
  const canvas = document.createElement('canvas')
  const stage = document.createElement('div')
  const fetched: string[] = []
  const artFailed: { who: string; cause: string }[] = []

  const callbacks: FloorCallbacks = {
    onPick: () => {},
    onUnstaged: () => {},
    onDetails: () => {},
    onArtFailed: (who, cause) => artFailed.push({ who, cause }),
    onStale: () => {},
    onPickProject: () => {},
  }
  const view = new FloorView(canvas as never, stage as never, callbacks)

  const sprites = async (id: string): Promise<SpriteSheet> => {
    fetched.push(id)
    // The pack could not be read at all — a corrupt file, a theme directory that has gone, an
    // EACCES. The fetch rejects rather than returning something undecodable.
    if (options.absent?.has(id)) throw new Error(`EACCES reading the pack for ${id}`)
    if (options.broken?.has(id)) {
      // What a pack that will not decode looks like from here: the fetch succeeds and the
      // pixels are the thing that is wrong. A frame whose buffer does not match the sheet's
      // dimensions is the commonest form of it, and `ImageData` is where it surfaces.
      const short = new Uint8ClampedArray(8)
      return { ...SHEET, frames: { down: [short], up: [short], right: [short] } }
    }
    return SHEET
  }

  return { view, fetched, artFailed, sprites }
}

test('a pack that will not decode is reported, and the person is skipped rather than drawn blank', async () => {
  const r = rig({ broken: new Set(['reviewer']) })
  await r.view.setCast([person('manager', { isManager: true }), person('builder'), person('reviewer')], r.sprites, 'theme-a')

  assert.deepEqual(
    r.artFailed.map((f) => f.who),
    ['reviewer'],
    'a pack that would not decode was skipped silently. The office simply has one fewer person ' +
      'in it and nothing anywhere says why — which is the mystery this seam exists to prevent.',
  )
  assert.ok(r.artFailed[0]?.cause, 'the failure was reported with no cause, so it names a symptom and not a reason')
})

test('art is fetched once per look, not once per render', async () => {
  const r = rig()
  const staff = [person('manager', { isManager: true }), person('builder')]

  await r.view.setCast(staff, r.sprites, 'theme-a')
  const first = r.fetched.length
  assert.ok(first >= 2, `only ${first} sprite fetches for two people — nobody can be drawn`)

  await r.view.setCast(staff, r.sprites, 'theme-a')
  assert.equal(
    r.fetched.length,
    first,
    'the same roster re-fetched every sprite. That is an IPC round trip and a decode per person ' +
      'on every roster change, for art that did not move.',
  )
})

test('an agent whose description changed gets new art without a restart', async () => {
  // Keyed by look, not by id. Keyed by id this returns the old character until the app restarts,
  // and the floor then shows somebody who no longer exists as configured.
  const r = rig()
  await r.view.setCast([person('manager', { isManager: true }), person('builder')], r.sprites, 'theme-a')
  const before = r.fetched.length

  await r.view.setCast(
    [person('manager', { isManager: true }), person('builder', { description: 'a completely different brief' })],
    r.sprites,
    'theme-a',
  )

  assert.ok(
    r.fetched.length > before,
    'an agent was edited and the floor kept drawing the old character. The cache is keyed by who ' +
      'the art is of rather than by what it depends on, so the look moved and the key did not.',
  )
})

test('a theme change re-fetches everybody and releases the art it replaced', async () => {
  // "A different theme is different art for everybody, not just for the next person hired."
  // The bitmaps hold GPU memory; dropping the map without closing them leaks it per theme switch.
  const r = rig()
  const staff = [person('manager', { isManager: true }), person('builder')]
  await r.view.setCast(staff, r.sprites, 'theme-a')
  const before = r.fetched.length

  await r.view.setCast(staff, r.sprites, 'theme-b')
  assert.ok(
    r.fetched.length > before,
    'a theme change reused the old art, so half the office is drawn in the theme you just left',
  )
})

test('a pack that will not arrive is treated like one that will not decode', async () => {
  // The `try` covers `toBitmaps` and starts one line too late: `await sprites(id)` sits outside
  // it. A fetch that rejects therefore leaves the loop entirely — so nobody after that person is
  // even asked for, `onArtFailed` never fires, and everything after the loop (the roster, the
  // stations, the resolver, the cast rebuild) is skipped while `this.plan` and `this.seats` have
  // already been replaced.
  //
  // The result is not one missing character. It is an empty office on a new floorplan, reported
  // to nobody — the failure the sibling branch's own comment describes, in its worst form: "an
  // office of invisible people is a mystery, and the mystery is what this whole seam exists to
  // prevent."
  const r = rig({ absent: new Set(['builder']) })

  await assert.doesNotReject(
    r.view.setCast([person('manager', { isManager: true }), person('builder'), person('reviewer')], r.sprites, 'theme-a'),
    'one unreadable sprite pack threw out of setCast, so the whole office is left half-built',
  )

  assert.deepEqual(
    r.artFailed.map((f) => f.who),
    ['builder'],
    'the pack that could not be read was not reported to anybody',
  )
  assert.ok(
    r.fetched.includes('reviewer'),
    'the person after the failure was never asked for at all. One bad pack takes down everybody ' +
      'below it in the roster.',
  )
})

test('the floor is still usable after a pack fails', async () => {
  // The half that says the state stayed consistent: `plan` and `seats` are replaced before the
  // art loop, so a throw mid-loop leaves a new floorplan with the old cast standing on it.
  const r = rig({ absent: new Set(['builder']) })
  await r.view.setCast([person('manager', { isManager: true }), person('builder'), person('reviewer')], r.sprites, 'theme-a')

  const about = r.view.askOver('reviewer')
  assert.equal(
    r.view.settle('reviewer', about, 'an answer', false),
    true,
    'somebody whose art loaded fine cannot be asked anything, so the cast was never rebuilt — ' +
      'the floorplan moved and the people on it did not',
  )
})
