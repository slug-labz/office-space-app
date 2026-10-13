/**
 * The floor is allowed to spill over the stage. It has to spill where there is room to lose.
 *
 * `chooseScale` takes a step up when the floor overflows by less than `OVERFLOW` — 8% — rather
 * than dropping a whole integer step and halving the office. Both comments that defend the trade
 * say the same thing about what it costs:
 *
 *     styles.css   "What spills over is the outermost ring of boundary wall"
 *     projection.ts "what gets clipped is the outermost ring of boundary wall, the least
 *                    informative thing on the floor"
 *
 * A ring is on every side. What actually happened is that the whole 8% came off two of them —
 * and then, once it was split evenly, that half of it came off a side with nothing to spare.
 *
 * ## The margins, measured rather than assumed
 *
 * `ade-af` enumerated every plan the app can draw, across eight roster sizes (#174):
 *
 *     sideways    the outermost column is empty on all of them — no desk, no prop, nobody can
 *                 stand there. A trim of up to 16.6 floor px a side really is boundary wall.
 *     upwards     the back wall reserves WALL_HEIGHT * TILE_RISE = 28 and the tallest wall prop
 *                 draws 21 into it. **7 px.** The even split takes up to 12.44 — so it does not
 *                 take wall, it takes the top off `pictureFrames[2]`, in the band of stage
 *                 heights 623–643 a person lands on by dragging a corner.
 *     downwards   the last tile row is empty on all of them too, and a row is 22 floor px.
 *
 * Seven against twenty-two is not a close call, so the vertical overflow goes to the bottom and
 * only the horizontal is split. `place-items: start center`.
 *
 * ## Measured in the running app, before the fix
 *
 * Default 1280x820 window, a 896x672 canvas in an 848x663 stage:
 *
 *     left 0   right 56   top 0   bottom 17
 *
 * `.stage` is `display: grid; place-items: center`, and centring is exactly what it could not
 * do: with no explicit template the single implicit track is `auto`, which resolves to
 * max-content, so the track grew to the canvas, the canvas filled the track, and there was
 * nothing left to centre. The floor sat flush against the padding edge and lost everything off
 * the far corner.
 *
 * What went with it was not boundary wall. It was the window prop along the right wall and most
 * of the manager's desk — the two rightmost columns of the room, drawn every frame, on a canvas
 * whose `overflow: hidden` means there is not even a scrollbar to hint that they are there.
 *
 * Capping the track puts it back to 24 a side and 5 top and bottom.
 *
 * ## And the campus wants the opposite, for a reason on the same axis
 *
 * The campus scrolls at 1:1. Capped, a campus wider than its stage would be centred in a track
 * it overflows on **both** sides — and the half to the left of the scroll origin cannot be
 * reached by scrolling. That is the fault the campus block's `place-items: start center` already
 * names on the block axis: *"a centred grid taller than its box hides its first row above the
 * scroll origin."* Same fault, other axis. So the campus overrides the cap back to `none`.
 *
 * ## What this test can and cannot show
 *
 * It reads the declarations. It cannot lay anything out — there is no layout engine in the test
 * process — so it cannot prove the browser centres what it is given. The evidence for that is
 * the measurement above, taken over CDP against the running app, before and after.
 *
 * What it can do is hold the shape that made the measurement come out right, which is the part a
 * later edit would remove without noticing: an explicit capped track on both axes, `overflow`
 * and `place-items` still saying what they said, and the campus still exempt.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// From `import.meta.url`, not the working directory: this suite is run from the repo root today
// and from a packaged tree by the release check, and a path built from `resolve('.')` has already
// bitten this repo twice.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string): string => readFileSync(join(root, 'src', 'renderer', file), 'utf8')

/** The declarations of the first top-level block whose selector is exactly `selector`. */
function block(css: string, selector: string): string {
  // Comments first — every one of these blocks carries prose that names the properties being
  // asserted, and a scan that read them would pass on the explanation rather than the rule.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const at = bare.indexOf(`\n${selector} {`)
  if (at === -1) return ''
  const open = bare.indexOf('{', at)
  const close = bare.indexOf('}', open)
  return close === -1 ? '' : bare.slice(open + 1, close)
}

const office = block(read('styles.css'), '.stage')
const campus = block(read('panels.css'), '.stage[data-view="campus"]')

test('both blocks were found, or nothing below is about the office at all', () => {
  // The guard first. Every assertion in this file is a substring test against a string, and a
  // string that came back empty passes none of them for the wrong reason — it reports a missing
  // selector as a missing declaration, and a renamed one as a fixed bug.
  assert.notEqual(office, '', '`.stage` was not found in styles.css — this test is reading nothing')
  assert.notEqual(campus, '', '`.stage[data-view="campus"]` was not found in panels.css')
  assert.match(office, /overflow:\s*hidden/, 'the office stage no longer clips, so trimming is not what happens here any more')
  assert.match(campus, /overflow:\s*auto/, 'the campus stage no longer scrolls, so the exemption below is about something else')
})

test('the office stage caps its track on both axes, so an oversized floor has something to be centred in', () => {
  for (const axis of ['grid-template-columns', 'grid-template-rows']) {
    const declared = new RegExp(`${axis}\\s*:\\s*minmax\\(\\s*0`).test(office)
    assert.ok(
      declared,
      `\`.stage\` does not cap \`${axis}\`. Without it the implicit track is \`auto\`, which ` +
        `resolves to max-content in this box — the track grows to the canvas, \`place-items: ` +
        `center\` has nothing left to centre, and the floor is drawn flush to the padding edge. ` +
        `Measured that way: 56px lost off the right and 17px off the bottom, and none off the ` +
        `left or the top. The window prop and most of the manager's desk went with them.`,
    )
  }
})

test('sideways it centres, because both outermost columns are wall', () => {
  // The cap alone does not distribute anything. It creates a track the canvas can overflow;
  // the alignment is what decides which edge pays. Either one without the other is the old
  // behaviour.
  assert.match(
    office,
    /place-items:\s*start\s+center|justify-items:\s*center/,
    'the office stage caps its track but no longer centres across it, so the horizontal trim is ' +
      'one-sided again by a different route — and sideways is the axis where an even split is ' +
      'right, because the outermost column is empty on every roster size',
  )
})

test('upwards it does not, because the back wall has 7px and the bottom row has 22', () => {
  // The half that shipped wrong. An even vertical split takes up to 12.44 floor px off a top
  // margin of 7, which is the top of a picture frame rather than boundary wall.
  assert.match(
    office,
    /place-items:\s*start\s+center|align-items:\s*start/,
    'the office stage centres vertically. The back wall has 7 floor px of headroom above the ' +
      'tallest prop and the trim reaches 12.44, so half the overflow lands on the one edge that ' +
      'cannot afford any of it. The bottom row is empty on every roster size — 22 px — which is ' +
      'where it belongs.',
  )
  assert.doesNotMatch(
    office,
    /place-items:\s*center\s*;/,
    'a bare `place-items: center` is back, which centres on both axes and puts half the vertical ' +
      'overflow back on the 7px edge',
  )
})

test('the campus is exempt, because there the cap would hide the first column', () => {
  for (const axis of ['grid-template-columns', 'grid-template-rows']) {
    assert.match(
      campus,
      new RegExp(`${axis}\\s*:\\s*none`),
      `the campus does not override \`${axis}\`. It scrolls at 1:1, so a capped track makes a ` +
        `campus wider than the stage overflow both sides — and the half left of the scroll ` +
        `origin cannot be scrolled to. That is the same fault \`place-items: start center\` ` +
        `already avoids on the block axis, arriving on the inline one.`,
    )
  }
})
