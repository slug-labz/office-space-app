/**
 * The three numbers "scalable" is written against, asserted rather than assumed.
 *
 * The exit condition is a paragraph of adjectives until somebody turns it into arithmetic:
 * *an idle office draws ≤ 2 frames per second*, *appending a message costs the same at 5,000
 * entries as at 300*, and *per-frame cost does not grow with the number of projects open*.
 *
 * The transcript number is the one that cannot be tested here, and saying so is better than
 * pretending: it is a browser layout cost, and `node:test` has no layout. It was measured in
 * the dev harness instead and the numbers are written into `WINDOW`'s doc comment in
 * `chat-view.ts` — 6.4 ms at 208 turns, 340 ms at 5,638. What *is* testable is the rule that
 * keeps it bounded, and that is what the first section below checks.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { beatsAt, idleDraws, IDLE_BUDGET_FPS, KEYSTROKE_MS, PET_SETTLE_MS } from '../src/shared/floor/idle-clock.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const chatView = readFileSync(join(root, 'src/renderer/chat-view.ts'), 'utf8')
const panels = readFileSync(join(root, 'src/renderer/panels.css'), 'utf8')
const floorView = readFileSync(join(root, 'src/renderer/floor-view.ts'), 'utf8')

// ───────────────────────────────────────────────────────────── the idle budget ──

test('an idle office draws no more than two frames a second', () => {
  // Ten simulated seconds at 60 Hz. The whole point of the frame gate is that most of those
  // frames are not drawn; this is the number that says how many are.
  const seconds = 10
  const draws = idleDraws(seconds)

  assert.ok(
    draws / seconds <= IDLE_BUDGET_FPS,
    `an idle office drew ${draws} frames in ${seconds}s — the budget is ${IDLE_BUDGET_FPS}/s`,
  )
  // And in fact it is two orders of magnitude inside it: one frame per seven seconds.
  assert.equal(draws, Math.floor((seconds * 1000) / PET_SETTLE_MS))
})

test('nobody typing means no typing beat at all', () => {
  // The failure this catches: a keystroke clock that advances whether or not anybody is working
  // wakes the floor four times a second forever, and the gate draws every one of those frames
  // because it was truthfully told something changed.
  const quiet = [0, 219, 220, 1000, 5000].map((ms) => beatsAt(ms, false).key)
  assert.deepEqual(quiet, [0, 0, 0, 0, 0])

  // While somebody is working it alternates, and only twice per beat.
  assert.equal(beatsAt(0, true).key, 0)
  assert.equal(beatsAt(KEYSTROKE_MS, true).key, 1)
  assert.equal(beatsAt(KEYSTROKE_MS * 2, true).key, 0)
})

test('the cat moves once every seven seconds, not once a frame', () => {
  assert.equal(beatsAt(0, false).pet, beatsAt(PET_SETTLE_MS - 1, false).pet)
  assert.notEqual(beatsAt(0, false).pet, beatsAt(PET_SETTLE_MS, false).pet)
})

// ──────────────────────────────────────────────── projects, and off-screen scenes ──

test('an off-screen office is not simulated frame by frame', () => {
  // `step()` used to advance every scene every frame, so twenty projects opened once were
  // twenty crowds simulated at 60 Hz behind a floor nobody was looking at — an unbounded cost
  // growing on exactly the axis the "20 projects" exit condition tests.
  //
  // Read out of the source because the alternative is a canvas, and the root tsconfig excludes
  // the renderer. A string check is a weak test; it is stronger than the nothing that was here.
  assert.match(floorView, /scene\.owed \+= dt/, 'off-screen scenes no longer accumulate their time')
  assert.match(floorView, /if \(scene\.owed < OFFSCREEN_STEP_S\) continue/, 'off-screen scenes are stepped every frame again')
})

test('an office coming back into view pays its debt in the first frame', () => {
  // Otherwise the first frame after a tab switch is a quarter-second stale, which reads as the
  // floor being slow to react rather than as a scheduling choice.
  assert.match(floorView, /elapsed \+= scene\.owed/)
})

// ──────────────────────────────────────────────────── one identity, several views ──

test('there is exactly one place that turns a sprite sheet into bitmaps', () => {
  // F5 wants characters legible as *this* agent and F1c wants the conversation to use the same
  // ones. Both are the same requirement: one identity system, two views. A second decoder would
  // be a second identity system that happens to agree today and drifts the first time somebody
  // installs a sprite pack — and it would drift silently, because both halves would still draw
  // *a* person.
  const decoders = readFileSync(join(root, 'src/renderer/sprites.ts'), 'utf8')
  assert.match(decoders, /export async function toBitmaps/)

  for (const file of ['src/renderer/floor-view.ts', 'src/renderer/views/avatar.ts']) {
    const text = readFileSync(join(root, file), 'utf8')
    assert.match(text, /from '\.{1,2}\/(?:\.\.\/)?sprites\.js'/, `${file} does not use the shared decoder`)
    assert.doesNotMatch(text, /function fromPixels/, `${file} has grown a decoder of its own`)
  }
})

// ─────────────────────────────────────────────────────────────── the transcript ──

test('the transcript keeps a bounded number of turns in the DOM', () => {
  // Bounded, and the bound is small. `WINDOW` at four figures would satisfy the letter of this
  // and none of the point — 808 turns already costs 32 ms per message.
  const match = /const WINDOW = (\d+)/.exec(chatView)
  assert.ok(match, 'chat-view.ts no longer windows the transcript')
  const window = Number(match[1])
  assert.ok(window > 0 && window <= 500, `WINDOW is ${window}; measured cost is linear in it`)
})

test('trimmed turns are kept, never discarded', () => {
  // The honesty condition on windowing, and the reason it is a test rather than a comment: a
  // transcript that silently dropped its first four thousand messages would *look* complete,
  // which is the hardest way for this to be wrong. If `trimmed` ever stops being appended to,
  // the panel is quietly editing the record.
  assert.match(chatView, /this\.trimmed\.push\(first\)/, 'trimmed turns are being dropped rather than kept')
  assert.match(chatView, /earlier messages/, 'nothing tells the user there are turns off screen')
})

test('a turn may shrink, so one long line cannot widen the whole conversation', () => {
  // Found by running the real app: every line of a reply clipped at the same x, with a
  // horizontal scrollbar under it. Reproduced in the harness at 343px wide reporting
  // `scrollWidth: 664`.
  //
  // `.turn` is a grid, so `.turn__body` is a grid item and its automatic minimum size is its
  // min-content width — which a fenced block holding one unbreakable path sets to the whole
  // line. The `<pre>`'s own `overflow-x: auto` does not save it: that zeroes the minimum size
  // only for a flex or grid item, and the `<pre>` is a normal block.
  //
  // A string check, because this is a layout property and `node:test` has no layout. It is
  // here so that deleting the rule fails something rather than silently returning the bug.
  assert.match(
    panels,
    /\.turn > \* \{\s*min-width: 0;/,
    'the transcript can be widened by a single long line again',
  )
})

test('nothing still being written to is ever trimmed', () => {
  // A result arriving for an element that has been detached would append output into something
  // nobody can see, and it would simply never appear — a tool call that ran and shows nothing,
  // which is the third standing order broken by a performance optimisation.
  //
  // Written against the *invariant* rather than one line of it. The original asserted
  // `new Set(this.pending.values())` exactly, and F1c moved the mechanism out of the transcript
  // so `pending` is now empty and a mark is the thing that gets written to after the fact. The
  // hole did not go away; it changed shape. A test pinned to the old shape would have gone green
  // by having nothing left to protect, which is the worst way for a test to pass.
  assert.match(chatView, /const live = new Set<HTMLElement>\(this\.pending\.values\(\)\)/)
  assert.match(chatView, /live\.has\(first\)/, 'trim() no longer skips protected elements')
})


test('a turn never trims away its own mark', () => {
  // The mark is created on a turn's first step and repainted on every step and result after it.
  // A single turn appending more than WINDOW elements would trim it off the top and then keep
  // painting a node nobody can see: the count stops moving, a failure stops turning it red, and
  // nothing reports it.
  //
  // This is the same hole `trim` already guarded for pending tool cards, reopened in a new shape
  // when F1c removed the cards. Asserted on the source because the alternative is a DOM harness
  // for a two-line invariant — the same trade `WINDOW`'s own test makes above.
  assert.match(
    chatView,
    /if \(this\.mark\) live\.add\(this\.mark\)/,
    'trim() no longer protects the current turn\'s mark from being detached',
  )
})
