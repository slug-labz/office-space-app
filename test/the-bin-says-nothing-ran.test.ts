/**
 * `PLAN.md`'s V2 asks for four props that report rather than decorate — monitor, whiteboard,
 * plant, and *"wastebasket from blocked tasks"*. The first three were made to read from a file
 * by `every-prop-reports-or-says-it-cannot`; that pass **listed** the fourth rather than fixing
 * it, because there was no wastebasket at all to make honest.
 *
 * The line names a source that does not exist. `TaskState` is `in-progress | queued | done` and
 * there is no blocked state — the word covers two conditions waiting on two different people,
 * plus a third waiting on nobody. So the prop reports the thing those three share, which is that
 * **no command ran**, and the reason they differ is kept in words rather than drawn in paper.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { nothingRan, whyNothingRan, type TaskOutcome } from '../src/shared/tasks.js'
import { drawWastebasket, type Surface } from '../src/renderer/props.js'

const ALL: readonly TaskOutcome[] = ['passed', 'failed', 'refused', 'not-run', 'uncheckable', 'done']


/**
 * One call expression, from its opening bracket to the matching close.
 *
 * Returns `null` rather than a truncated string when the brackets do not balance, so a caller
 * can tell *"I could not read it"* from *"I read it and it was wrong"*. That distinction is the
 * whole reason this exists: the fixed-width slice it replaced could only ever report the second,
 * including when the first was true.
 *
 * Bracket counting is enough here and would not be in general — a parenthesis inside a string
 * literal in the call would fool it. There is none, and a test that needs a parser to check a
 * call site is a test asking the wrong question.
 */
function enclosingCall(source: string, opening: string): string | null {
  const at = source.indexOf(opening)
  if (at === -1) return null
  let depth = 0
  for (let i = at + opening.length - 1; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') {
      depth--
      if (depth === 0) return source.slice(at, i + 1)
    }
  }
  return null
}

test('nothing ran means exactly the three outcomes where no command was executed', () => {
  assert.deepEqual(ALL.filter(nothingRan), ['refused', 'not-run', 'uncheckable'])

  // Stated as its own assertion because it is the one somebody will get wrong. A failure is a
  // check that **did** happen and said no — the most informative outcome there is, and the one
  // the monitor already reports. A bin that filled on `failed` would be saying "unchecked" about
  // the most thoroughly checked thing on the floor.
  assert.equal(nothingRan('failed'), false, 'a failure is a check that ran')
  assert.equal(nothingRan('passed'), false)
  assert.equal(nothingRan('done'), false)
})

test('the reason is kept in words, and only for the outcomes that have one', () => {
  // Three reasons, three different people waiting. `refused` waits on the user, who can allow
  // the command; `uncheckable` waits on whoever wrote the task, because there is nothing to
  // allow; `not-run` waits on nobody. Merging them into "blocked" would put three facts behind
  // one word — which is what `PLAN.md`'s line asks for and what this deliberately does not do.
  const reasons = ALL.map(whyNothingRan).filter((r): r is string => r !== null)
  assert.equal(reasons.length, 3, 'a reason exists for exactly the outcomes where nothing ran')
  assert.equal(new Set(reasons).size, 3, 'two outcomes share a sentence — then one of them is unsaid')

  assert.match(whyNothingRan('refused') ?? '', /you/i, 'refused waits on the user and must say so')
  assert.match(whyNothingRan('uncheckable') ?? '', /wrote the task/i)

  for (const outcome of ALL.filter((o) => !nothingRan(o))) {
    assert.equal(whyNothingRan(outcome), null, `${outcome} ran, so it has no reason for not running`)
  }
})

class Recorder implements Surface {
  fillStyle = '#000000'
  readonly rects: { x: number; y: number; w: number; h: number }[] = []
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h })
  }
}

const drew = (options: Parameters<typeof drawWastebasket>[3]): Recorder => {
  const ctx = new Recorder()
  drawWastebasket(ctx, { x: 5, y: 5 }, 'south', options)
  return ctx
}

test('the bin is drawn in both states, because empty is an answer', () => {
  // A bin that appeared only when full would make its absence ambiguous between *checked and
  // fine* and *not drawn yet*, which is the distinction this floor exists to keep.
  const empty = drew({})
  assert.ok(empty.rects.length >= 3, 'an empty bin drew almost nothing — it would read as absent')

  const full = drew({ full: true })
  assert.ok(full.rects.length > empty.rects.length, 'a full bin is not distinguishable from an empty one')
})

test('the paper sits above the rim, or it is not in the bin', () => {
  const empty = drew({})
  const full = drew({ full: true })
  // Canvas y grows downward, so higher on screen is a smaller y. The paper must be above the
  // top of the empty bin, otherwise it is drawn inside the can and invisible.
  const rim = Math.min(...empty.rects.map((r) => r.y))
  const top = Math.min(...full.rects.map((r) => r.y))
  assert.ok(top < rim, `paper at ${top} is not above the rim at ${rim}`)
})

test('the offset moves the whole bin, not part of it', () => {
  // The bin stands beside a desk at a fractional offset rather than on the free tile, so no tile
  // changes state and pathfinding is untouched. If the offset reached only some of the parts,
  // the bin would come apart at exactly the desks where it is used.
  const centred = drew({ full: true })
  const beside = drew({ full: true, across: 0.62 })
  assert.equal(beside.rects.length, centred.rects.length, 'the offset changed how much was drawn')

  const shifts = new Set(
    beside.rects.map((rect, i) => {
      const from = centred.rects[i]
      assert.ok(from !== undefined, `part ${i} has no counterpart`)
      return rect.x - from.x
    }),
  )
  assert.equal(shifts.size, 1, `the bin came apart: parts moved by ${[...shifts].join(', ')}`)

  // And the direction, pinned rather than assumed. A positive `across` moves a prop toward
  // *smaller* x, while a tile delta of -1 is the smaller neighbour — so a call site that wants
  // the bin on the free side has to negate. Writing that down here is what caught the call site
  // doing it the other way and drawing the bin inside the next desk along.
  const [shift] = [...shifts]
  assert.ok(shift !== undefined && shift < 0, `a positive across moved the bin by ${String(shift)}, not toward smaller x`)
})

test('the floor draws it, from the outcome rather than from anything else', () => {
  // The prop exists to be looked at, and a prop nothing calls is the defect this codebase spent
  // the day finding. Read rather than assumed: the call site is in a class that touches the DOM
  // at load, so a test cannot construct it — but it can check that the wiring is there and says
  // what it should.
  const source = readFileSync(new URL('../src/renderer/floor-view.ts', import.meta.url), 'utf8')
  assert.match(source, /drawWastebasket\(/, 'nothing on the floor draws the bin')

  // The call is bounded by its own parentheses rather than by a character count. A fixed window
  // was here and it lied once already: adding a comment inside the call pushed `nothingRan` past
  // 260 characters and the test reported *"filled from something other than nothingRan"* — a
  // false diagnosis of a real thing, when the truth was that it could not see far enough. A
  // pattern over source fails for a move as readily as for a regression, so the only honest
  // version says which of the two happened.
  const call = enclosingCall(source, 'drawWastebasket(')
  assert.ok(call !== null, 'the drawWastebasket call could not be bracketed — this assertion went blind')
  assert.match(call, /nothingRan\(/, 'the bin is filled from something other than `nothingRan`')
  assert.doesNotMatch(call, /'failed'|"failed"/, 'the bin reads `failed` directly rather than through the predicate')
})
