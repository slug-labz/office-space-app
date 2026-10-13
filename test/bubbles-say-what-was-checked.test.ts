/**
 * VISION §3.4 asks a bubble for four things and the fourth is *"how progress looks"*. Nothing in
 * the bubble answered it.
 *
 * Worth being exact about what was wrong, because the obvious framing is not right: the bubble
 * does **not** "ask the agent". `doingLine` reports something observed — the choreographer builds
 * its summaries from real facts and the trace names the tool call behind them. And §3.4 does ask
 * for a self-report, in its own words: *"The agent summarizes against that."* So the gap is not a
 * self-report where a check belongs. It is that the bubble only ever spoke about **this second**,
 * while the office was already running every task's VERIFY and holding the result per person.
 *
 * This is additive. The doing line is untouched.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { checkedLine } from '../src/shared/floor/bubbles.js'
import type { TaskOutcome } from '../src/shared/tasks.js'

const ALL: readonly TaskOutcome[] = ['passed', 'failed', 'refused', 'not-run', 'uncheckable', 'done']

test('no task at all says nothing, and says it differently from a failure', () => {
  // Silence has to mean one thing. A bubble quiet on failure *and* on having-no-work would make
  // absence ambiguous between "fine" and "we have nothing" — which is the distinction this whole
  // floor exists to keep.
  assert.equal(checkedLine(undefined), null)
  for (const outcome of ALL) {
    assert.notEqual(checkedLine(outcome), null, `${outcome} fell silent`)
  }
})

test('all six outcomes say six different things', () => {
  const said = ALL.map((o) => checkedLine(o))
  assert.equal(new Set(said).size, 6, `two outcomes share a sentence: ${said.join(' | ')}`)
})

test('the three where nothing ran never read as a result', () => {
  // The collapse this guards is `uncheckable` → failed and `not-run` → passed. Three of the six
  // mean **no command ran**, and rendering those as a tick or a cross invents a result nobody
  // produced.
  //
  // Listed here rather than imported: `nothingRan` in `shared/tasks.ts` is the same set, and it
  // is on an unmerged branch. Two copies of a set is the fault this repo keeps finding, so the
  // count is asserted below as well — a seventh outcome, or one moved between the groups, breaks
  // this rather than passing quietly on a stale list.
  const NOTHING_RAN: readonly TaskOutcome[] = ['refused', 'not-run', 'uncheckable']
  assert.equal(
    ALL.filter((o) => (checkedLine(o) ?? '').includes('not checked')).length,
    NOTHING_RAN.length,
    'the set that says "not checked" no longer matches the set listed here',
  )

  for (const outcome of NOTHING_RAN) {
    const line = checkedLine(outcome) ?? ''
    assert.doesNotMatch(line, /passed|failed/, `${outcome} is being reported as a result: "${line}"`)
    assert.match(line, /not checked/, `${outcome} does not say it was not checked: "${line}"`)
  }

  // And the ones that did run must say which way it went, or the distinction is lost the other way.
  assert.match(checkedLine('passed') ?? '', /passed/)
  assert.match(checkedLine('failed') ?? '', /failed/)
})

test('a refusal and an uncheckable task are not the same sentence', () => {
  // Both mean "not checked", and they are not the same problem: one is waiting on the person at
  // the keyboard, the other on whoever wrote the task. The bubble is small, so the temptation to
  // fold them is real — this is what stops it.
  const refused = checkedLine('refused') ?? ''
  const uncheckable = checkedLine('uncheckable') ?? ''
  assert.notEqual(refused, uncheckable)
  assert.match(refused, /not allowed/)
  assert.match(uncheckable, /nothing to run/)
})

/** One call expression, from its opening bracket to the matching close, or `null`. */
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

test('the floor puts it in the bubble, from the outcome', () => {
  // The call site is in a class that touches the DOM at load, so a test cannot construct it.
  // Bounded by its own brackets rather than a character count, so a move reports as "could not
  // read it" instead of as a wrong answer about what it read.
  const source = readFileSync(new URL('../src/renderer/floor-view.ts', import.meta.url), 'utf8')
  assert.match(source, /checkedLine\(/, 'nothing on the floor asks what was checked')

  const call = enclosingCall(source, 'checkedLine(')
  assert.ok(call !== null, 'the checkedLine call could not be bracketed — this assertion went blind')
  assert.match(call, /outcomes\.get\(/, 'the line is filled from something other than the task outcomes')

  // Separate element, not appended to the model's sentence. What `.bubble__text` holds came from
  // a model; this came from running a command. Two kinds of claim, two nodes.
  assert.match(source, /bubble__checked/, 'the checked line has no element of its own')
})
