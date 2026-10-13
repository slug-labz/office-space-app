/**
 * A long conversation costs a bounded amount of page, however long it gets.
 *
 * Reopening a project that has been talked to for months replays its whole transcript. If the
 * page grew with it, the cost of opening a conversation would be a function of how much you had
 * used it \u2014 which is the wrong way round, and the kind of slowness that arrives gradually
 * enough that nobody files it.
 *
 * Measured before this was written, so it is describing something rather than hoping for it:
 *
 *     200 entries    5 ms   1901 nodes
 *     1000 entries  24 ms   2853 nodes
 *     4000 entries 100 ms   2853 nodes
 *
 * Linear in time and **flat in nodes**: past the window, a longer transcript is more work to
 * read and no more page to hold.
 *
 * ## What is asserted, and what is only recorded
 *
 * Named `.dom.test.ts`, which is not cosmetic: the root `tsconfig` excludes the renderer and
 * every DOM test, and `tsconfig.renderer.json` picks both up with the DOM lib. A test that
 * touches a renderer module under any other name compiles without `HTMLElement` and fails to
 * typecheck while its assertions pass, which is how this one announced itself.
 *
 * The node count, because it is deterministic. Not the milliseconds \u2014 a wall-clock assertion
 * on a shared runner is a test that fails for reasons that have nothing to do with the code, and
 * this repository has enough real failures without inventing flaky ones. The timings are in the
 * comment as evidence for why the bound is worth holding, not as a threshold to defend.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { ChatView } from '../src/renderer/chat-view.js'
import type { TimelineEntry } from '../src/shared/transcript/parse.js'

installDom()

let n = 0
const base = (): { uuid: string; timestamp: string } => ({ uuid: `u${++n}`, timestamp: '2026-08-27T10:00:00Z' })

/** A conversation of `count` turns, with replies long enough to give the renderer real work. */
const conversation = (count: number): TimelineEntry[] => {
  const out: TimelineEntry[] = []
  for (let i = 0; i < count / 2; i += 1) {
    out.push({ ...base(), kind: 'user', text: `Question number ${i} about the thing we are building.` })
    out.push({
      ...base(),
      kind: 'assistant',
      model: null,
      text:
        `A reply of a realistic length. It mentions \`code\` and has **emphasis** and runs on for ` +
        `a sentence or two so the markdown renderer has real work to do, entry ${i}.`,
    })
  }
  return out
}

const nodesAfter = (count: number): number => {
  const root = document.createElement('div')
  const view = new ChatView(root as never, document.createElement('div') as never)
  view.replay(conversation(count), 'manager')
  const walk = (el: El): number => 1 + el.children.reduce((a, c) => a + walk(c), 0)
  return walk(root as unknown as El)
}

test('a short conversation draws all of itself', () => {
  // The control: the window has to be big enough that a normal conversation is not trimmed, or
  // the bound below is being met by showing nothing.
  const short = nodesAfter(40)
  assert.ok(short > 100, `forty turns drew only ${short} nodes, so the panel is trimming a normal conversation`)
})

test('a long conversation holds no more page than a medium one', () => {
  const medium = nodesAfter(1000)
  const long = nodesAfter(4000)

  assert.ok(medium > 0 && long > 0, 'nothing was drawn at all')
  assert.equal(
    long,
    medium,
    `1000 turns hold ${medium} nodes and 4000 hold ${long}. The page is growing with the ` +
      `transcript, so the cost of opening a conversation becomes a function of how much you have ` +
      `used it \u2014 which arrives gradually enough that nobody files it.`,
  )
})

test('four times the conversation is not four times the page', () => {
  // Stated as a ratio as well, because an exact equality could be met by a cap that happens to
  // land in the same place while the real windowing had gone.
  const small = nodesAfter(200)
  const big = nodesAfter(4000)
  assert.ok(
    big < small * 2,
    `200 turns hold ${small} nodes and 4000 hold ${big} \u2014 twenty times the conversation for ` +
      `more than double the page is not a bound`,
  )
})
