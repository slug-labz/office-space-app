/**
 * A line of prose in the transcript that nobody said, and what it used to cost.
 *
 * `notice()` opened with `this.reset()`. That drops the streaming pointer, throws away the turn's
 * `Ledger` and unhooks its mark — which is exactly right for one of the eleven callers, and
 * damage for the other ten.
 *
 * The one is `case 'result'`, the turn ending. It **already calls `reset()` itself**, on the line
 * above, so the effect there was to do it twice:
 *
 *     case 'result': {
 *       this.reset()
 *       if (event.isError && event.text) this.notice(event.text)
 *
 * Everywhere else the reset was a side effect of saying something. `case 'retry'` and
 * `case 'rate-limit'` both fire **mid-turn**. A turn that retried — which is a normal thing for a
 * turn to do, `529 overloaded` happens — lost its ledger at the retry, so the mark stopped
 * counting the steps that turn ran, and a failure after the retry could no longer turn it red.
 * Nothing threw. The number simply stopped being about the turn, which is the class of fault this
 * panel's own comment calls *"rare, silent, and exactly the class of bug"*.
 *
 * And it got worse rather than better: `88b9116` made the renderer report its own faults through
 * `notice()`, so an unhandled rejection at any instant could reset a turn in flight.
 *
 * Found by `office-space-6c`, which read `case 'result'` and pointed out that the deletion was
 * the whole fix — no second method, and the reset left attributable to the event that means it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { ChatView } from '../src/renderer/chat-view.js'
import type { ClaudeEvent } from '../src/main/claude/stream.js'

installDom()

const MANAGER = 'manager'

function panel(): { view: ChatView; root: El; marks: () => El[]; text: () => string } {
  const root = document.createElement('div')
  const empty = document.createElement('div')
  const view = new ChatView(root, empty)
  const walk = (n: El): El[] => [n, ...n.children.flatMap(walk)]
  return {
    view,
    root: root as unknown as El,
    marks: () => walk(root as unknown as El).filter((n) => n.classList.contains('mark')),
    text: () => ((root as unknown as El).textContent ?? '').replace(/\s+/g, ' '),
  }
}

/** A tool call, in the shape the stream emits. */
const step = (id: string, tool: string, argument: string): ClaudeEvent => ({
  kind: 'assistant', parentToolUseId: null,
  // `model` is required and was missing from the first draft of this fixture. Read from the
  // declaration rather than remembered — the same slip four other files in this suite have made,
  // each time producing a failure inside the module that looked like the module's.
  model: 'opus',
  blocks: [{ type: 'tool_use', id, name: tool, input: { command: argument } }],
})

const result = (isError: boolean, text: string | null): ClaudeEvent => ({
  kind: 'result',
  isError,
  text,
  costUsd: null,
  turns: null,
  durationMs: null,
  denials: [],
})

test('a turn that retries keeps counting the steps it ran', () => {
  // The live case. A retry is an ordinary thing for a turn to do.
  const p = panel()
  p.view.event(step('a', 'Bash', 'npm test'), MANAGER)
  p.view.event(step('b', 'Read', 'src/main/main.ts'), MANAGER)

  // The control: two steps, one mark, and it says so — otherwise the assertion below is about
  // a mark that was never drawn.
  assert.equal(p.marks().length, 1, `expected one mark, found ${p.marks().length}`)
  assert.equal(p.marks()[0]?.textContent, '2 steps')

  p.view.event({ kind: 'retry', attempt: 2, status: 529, error: 'overloaded' }, MANAGER)
  p.view.event(step('c', 'Write', 'src/main/registry.ts'), MANAGER)

  const counts = p.marks().map((m) => m.textContent)
  assert.deepEqual(
    counts,
    ['3 steps'],
    `after a retry the turn's marks read ${JSON.stringify(counts)}. The retry dropped the ledger, ` +
      `so the count restarted and the mark stopped being about the turn — and a second mark means ` +
      `one turn is wearing two.`,
  )
})

test('and a failure before the notice still turns the mark red', () => {
  // The other half of what the ledger carries. A reset loses `failed` as well as the count, so a
  // turn that failed and then said something read as a turn that was fine.
  const p = panel()
  p.view.event(step('a', 'Bash', 'npm test'), MANAGER)
  p.view.event(
    { kind: 'user', blocks: [{ type: 'tool_result', tool_use_id: 'a', is_error: true, content: 'exit 1' }] },
    MANAGER,
  )
  assert.equal(p.marks()[0]?.getAttribute('data-state'), 'failed', 'the failure never reached the mark')

  p.view.event({ kind: 'retry', attempt: 2, status: 529, error: 'overloaded' }, MANAGER)

  assert.equal(
    p.marks()[0]?.getAttribute('data-state'),
    'failed',
    'saying something cleared the turn\'s failure. The mark went back to reading as fine while ' +
      'the failed step is still on screen above it.',
  )
})

test('the turn ending does end the turn, and the next one starts its own count', () => {
  // The one caller that means it. `case 'result'` resets explicitly, and this is what would break
  // if the deletion had gone one line too far: two turns sharing a ledger read as one long turn.
  const p = panel()
  p.view.event(step('a', 'Bash', 'npm test'), MANAGER)
  p.view.event(result(false, null), MANAGER)
  p.view.event(step('b', 'Read', 'src/main/main.ts'), MANAGER)

  const counts = p.marks().map((m) => m.textContent)
  assert.deepEqual(
    counts,
    ['1 step', '1 step'],
    `two turns of one step each produced marks reading ${JSON.stringify(counts)} — a running ` +
      `total across turns is a number nobody can act on`,
  )
})

test('a failed result still says why, and still closes its turn', () => {
  // Both at once, because this is the path where `reset()` and `notice()` are adjacent and it
  // would be easy to fix the ordering by removing the wrong one.
  const p = panel()
  p.view.event(step('a', 'Bash', 'npm test'), MANAGER)
  p.view.event(result(true, 'Invalid API key. Please run /login.'), MANAGER)
  p.view.event(step('b', 'Read', 'src/main/main.ts'), MANAGER)

  assert.match(p.text(), /Invalid API key/, 'a failed result said nothing')
  assert.deepEqual(p.marks().map((m) => m.textContent), ['1 step', '1 step'], 'the failed result did not close its turn')
})

test('a notice lands after what is already there, and nothing is removed to make room', () => {
  // Placement. The transcript's claim is that it shows what happened in the order it happened, so
  // a notice raised mid-turn belongs after the work it interrupted rather than before it.
  const p = panel()
  p.view.event({ kind: 'partial', index: 0, of: 'text', text: 'thinking about it', parentToolUseId: null }, MANAGER)
  const beforeChildren = p.root.children.length

  p.view.notice('Something in the office went wrong.')

  assert.ok(p.root.children.length > beforeChildren, 'the notice replaced something instead of being added')
  assert.match(p.text(), /thinking about it/, 'the reply in flight was removed by a notice about something else')
  assert.match(p.text(), /Something in the office went wrong/, 'the notice was not shown')
  assert.ok(
    p.text().indexOf('thinking about it') < p.text().indexOf('Something in the office'),
    'the notice was placed above the work it interrupted, so the transcript no longer reads in order',
  )
})
