/**
 * The smallest window the app allows must still fit the app at the largest text it offers.
 *
 * Two numbers, in two files, with a relationship nothing states:
 *
 *     src/main/main.ts       minWidth: 900, minHeight: 600   the smallest a person can drag to
 *     src/shared/settings.ts FONT_SCALES … 1.25              the largest text settings offers
 *
 * The conversation pane is sized in `rem`, so it grows with the text scale. Measured in the
 * running app over CDP, at a 900x600 viewport — the exact minimum:
 *
 *     scale 0.9   root 14.4px   pane 317px    clean on both axes
 *     scale 1     root 16px     pane 352px    clean on both axes
 *     scale 1.1   root 17.6px   pane 387px    clean on both axes
 *     scale 1.25  root 20px     pane 440px    clean on both axes
 *
 * So the pane takes 440px of 900 at the largest scale and the floor keeps 460. Vertically the
 * document never overflows; four suggestion cards sit below the fold inside the transcript, and
 * one was scrolled to and hit-tested to confirm it is reachable rather than merely present.
 *
 * That is a **receipt** — it was true when it was measured. This file is the **tripwire** that
 * says when the receipt has expired.
 *
 * ## What this watches, and what it does not
 *
 * It watches exactly two inputs: the declared minimum window size, and the largest text scale.
 * It does **not** watch anything else that consumes the same width — a new column, a wider right
 * rail, a longer label, more padding, one more control beside `⌘K`. Every one of those
 * reproduces the clipping without touching either number, and none of them will turn this red.
 *
 * The honest reason is the same one in `css-applied.test.ts`: the real assertion is that nothing
 * lands off-screen at the smallest reachable size, and that needs a layout engine. `test/dom.ts`
 * is a hand-rolled object graph with no layout and no opinion about where anything is. So this
 * notices when one of two inputs moves and nobody re-measured, and it is worth having only
 * because the failure is silent and the two numbers live far apart.
 *
 * ## Why the assertions are directional
 *
 * A gate that goes red on a strict improvement gets edited reflexively, and after the third
 * reflexive edit nobody reads it. Raising `minWidth` to 1000 is safer than 900; dropping the
 * largest scale from 1.25 to 1.1 is safer than 1.25. Both must pass. Only movement toward the
 * clipping fails — a smaller window, or bigger text.
 *
 * `office-space-6c` raised both of these against the first version of this file, which asserted
 * equality on both numbers and would have gone red on either improvement.
 *
 * ## What is on the other side of the line
 *
 * Drop `minWidth` to 700 — reasonable-looking, and somebody will, for a smaller laptop — and at
 * 620px the right-hand column is clipped: `tasks`, the `···` menu, `⌘K`, and the **Allow and
 * Refuse buttons of a pending approval**, measured at x 641–743 in a 620px viewport. The office
 * would be waiting on an answer the user cannot give and cannot widen the window to reach.
 *
 * Which is one cause of a wider symptom. A pending approval is equally unanswerable when nobody
 * is looking at the window — the gate denies after 240s either way, and from inside the app the
 * two are indistinguishable. Guarding the width guards one cause; whether a pending approval
 * should make itself noticed outside the window is a product question, not this file's.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { FONT_SCALES } from '../src/shared/settings.js'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The viewport that was actually measured, and what it held.
 *
 * These are the *worst case that was checked*, not a target. A window larger than this, or text
 * smaller than this, was not measured but is strictly easier — so the assertions below allow it.
 */
const MEASURED = {
  width: 900,
  height: 600,
  scale: 1.25,
  /** The conversation pane at `scale`, in a `width` viewport. The floor keeps the rest. */
  paneWidth: 440,
} as const

test('the smallest window still fits the widest text', async () => {
  const main = await readFile(join(repo, 'src', 'main', 'main.ts'), 'utf8')

  const width = Number(/minWidth:\s*(\d+)/.exec(main)?.[1])
  const height = Number(/minHeight:\s*(\d+)/.exec(main)?.[1])

  assert.ok(
    Number.isFinite(width) && Number.isFinite(height),
    'src/main/main.ts no longer declares both minWidth and minHeight. Without them the window ' +
      'can be dragged to any size, and below about 780px wide the right-hand column — including ' +
      "the Allow and Refuse buttons of a pending approval — is clipped off the edge.",
  )

  const largest = Math.max(...FONT_SCALES)

  // Directional, all three. A bigger minimum or smaller text is safer than what was measured.
  assert.ok(
    width >= MEASURED.width,
    `minWidth is ${width}, below the ${MEASURED.width} that was measured. At ${MEASURED.scale}x ` +
      `the pane takes ${MEASURED.paneWidth}px, leaving the floor ` +
      `${MEASURED.width - MEASURED.paneWidth}px — and below ~780px the tasks button, the ··· ` +
      `menu, ⌘K and a pending approval's Allow and Refuse buttons go off-screen, in a window ` +
      `nobody can widen past the minimum. Re-measure at ${width}px and every scale in ` +
      `FONT_SCALES before lowering MEASURED.`,
  )

  assert.ok(
    height >= MEASURED.height,
    `minHeight is ${height}, below the ${MEASURED.height} that was measured. Re-measure the ` +
      `vertical axis at ${height}px and every scale in FONT_SCALES: the composer, its notice and ` +
      `the dials share a column that grows with the text scale.`,
  )

  assert.ok(
    largest <= MEASURED.scale,
    `FONT_SCALES now offers ${largest}x, above the ${MEASURED.scale}x that was measured. The ` +
      `pane grows with it — ${MEASURED.paneWidth}px at ${MEASURED.scale}x — so a larger scale ` +
      `eats into the floor's share of a window nobody can widen past ${width}px. Re-measure at ` +
      `${largest}x in a ${width}x${height} viewport before raising MEASURED.`,
  )

  // And the shape of the split, which no amount of raising the minimum fixes: the floor is what
  // the product is named after, and it must not be the smaller half at the size everybody
  // eventually meets.
  assert.ok(
    MEASURED.paneWidth <= MEASURED.width / 2,
    `at ${MEASURED.scale}x the pane takes ${MEASURED.paneWidth}px of ${MEASURED.width}, which is ` +
      `more than half the smallest window the app allows`,
  )
})
