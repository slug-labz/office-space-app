/**
 * The streaming half of the transcript: fragments arriving, then the whole thing arriving again.
 *
 * `event()` is the largest uncovered stretch in `chat-view.ts` and it holds the subtlest state in
 * the panel. The class keeps two separate fields for what looks like one idea, and says why:
 *
 *     Separate from `streaming` because the two mean different things and conflating them is how
 *     the text ends up doubled: `streaming` is "the last thing appended was a text block, so
 *     append the next one to it", while this is "a reply is *mid-flight* and the complete version
 *     has not arrived yet". When it does arrive it carries the whole text again, so the complete
 *     event **replaces** what is here rather than adding to it.
 *
 * That is the bug this file is mostly about. A reply streams in as fragments, the finished
 * message arrives carrying the entire text, and if it appends rather than replaces you get every
 * answer printed twice. Nothing throws. The panel looks busy and reads as if the model repeated
 * itself.
 *
 * ## And who is speaking
 *
 * An employee's streamed text carries `parentToolUseId` and nothing else — no name. So the only
 * way the panel knows who is talking is to have watched the dispatch that started them:
 *
 *     This is what makes the panel a group chat rather than a monologue.
 *
 * A fragment whose dispatch was never seen has no speaker, and the panel must not invent one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { ChatView } from '../src/renderer/chat-view.js'
import type { ClaudeEvent } from '../src/main/claude/stream.js'

installDom()

const MANAGER = 'manager'

interface Panel {
  readonly view: ChatView
  readonly root: El
  readonly text: () => string
  readonly turns: () => El[]
}

function panel(): Panel {
  const root = document.createElement('div')
  const empty = document.createElement('div')
  const view = new ChatView(root, empty)
  const walk = (n: El): El[] => [n, ...n.children.flatMap(walk)]
  return {
    view,
    root: root as unknown as El,
    turns: () => (root as unknown as El).children.filter((c) => c.classList.contains('turn')),
    /**
     * The rendered text, once.
     *
     * The root's own `textContent`, not a walk. The first version joined every node's
     * `textContent` — which counts a string once for the leaf and once for each ancestor above
     * it, so a single reply inside a paragraph inside a turn "appeared" five times. Against a
     * test whose whole subject is duplication, that is an instrument that manufactures the fault
     * it is looking for.
     */
    text: () => ((root as unknown as El).textContent ?? '').replace(/\s+/g, ' '),
  }
}

/** How often a string appears — the whole question when the fault is duplication. */
const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1

const partial = (text: string, index = 0, parentToolUseId: string | null = null): ClaudeEvent => ({
  kind: 'partial',
  index,
  of: 'text',
  text,
  parentToolUseId,
})

const assistant = (text: string): ClaudeEvent => ({
  kind: 'assistant', parentToolUseId: null,
  blocks: [{ type: 'text', text } as never],
  model: 'claude-opus-5',
})

test('a reply that streamed in is not printed twice when it completes', () => {
  // The invariant the two fields exist for. Fragments, then the finished message carrying the
  // whole text again.
  const p = panel()
  const whole = 'The suite passes: 1590 assertions, none failing.'

  p.view.event(partial('The suite passes: '), MANAGER)
  p.view.event(partial('1590 assertions, none failing.'), MANAGER)
  // The control: the fragments really did land, or "not doubled" would be trivially true.
  assert.ok(p.text().includes('The suite passes:'), 'the streamed fragments never reached the panel')

  p.view.event(assistant(whole), MANAGER)

  assert.equal(
    occurrences(p.text(), whole),
    1,
    `the reply appears ${occurrences(p.text(), whole)} times. The completed message carries the ` +
      `whole text again, so it has to replace what streamed rather than append to it — otherwise ` +
      `every answer in the transcript is printed twice and it reads as the model repeating itself.`,
  )
})

test('two blocks in one message do not merge into one paragraph', () => {
  // `partialIndex` exists for this: fragments carry which content block they belong to, and two
  // blocks interleaving into one is a different sentence than either of them.
  const p = panel()
  p.view.event(partial('first block', 0), MANAGER)
  p.view.event(partial('second block', 1), MANAGER)

  const text = p.text()
  assert.ok(text.includes('first block'), 'the first block is missing')
  assert.ok(text.includes('second block'), 'the second block is missing')
  assert.equal(
    text.includes('first blocksecond block'),
    false,
    'two separate content blocks were concatenated into one — they are separate blocks because ' +
      'the model wrote them separately',
  )
})

test('a completed message with nothing streamed still appears', () => {
  // The path where no fragment arrived at all: a short reply, or a stream the panel joined late.
  const p = panel()
  p.view.event(assistant('Done.'), MANAGER)
  assert.match(p.text(), /Done\./, 'a completed assistant message with no preceding fragments drew nothing')
})

test('a fragment from a dispatch nobody watched is dropped rather than misattributed', () => {
  // An employee's text carries `parentToolUseId` and no name, so the panel only knows who is
  // speaking if it watched the dispatch. The code makes the call explicitly and the other way
  // from my first guess at it:
  //
  //   a fragment whose dispatch we never saw is still skipped, because a turn with nobody's
  //   name on it is worse than one that is absent.
  //
  // I asserted the opposite — that a gap is worse than an unattributed line — and the test
  // failed against behaviour that is deliberate and reasoned. This asserts what the panel
  // actually promises, which is that nothing on the floor carries a name it cannot support.
  const p = panel()
  p.view.event(partial('I looked at the diff.', 0, 'toolu_never_seen'), MANAGER)

  const text = p.text()
  assert.equal(
    text.includes('I looked at the diff.'),
    false,
    'an orphaned fragment was drawn. There is no name to put on it, so it would appear as ' +
      "somebody's — and a turn attributed to the wrong speaker is worse than one that is absent.",
  )
  assert.equal(p.turns().length, 0, 'a turn was created for a speaker the panel cannot identify')
})

test('a failed result is shown as failed, not swallowed', () => {
  // `isError` covers auth failures, which arrive as a *successful* run — so a panel that only
  // watches the process exit code would show nothing at all.
  const p = panel()
  p.view.event(
    {
      kind: 'result',
      isError: true,
      text: 'Invalid API key. Please run /login.',
      costUsd: null,
      turns: null,
      durationMs: null,
      denials: [],
    },
    MANAGER,
  )

  assert.match(
    p.text(),
    /Invalid API key/,
    'a failed result said nothing. An auth failure arrives as a successful run, so this is the ' +
      'only thing that reports it — and "nothing happened" is what the user sees otherwise.',
  )
})

test('an event kind the panel has no opinion about does not throw', () => {
  // The panel receives everything the stream emits. A kind it does not draw must be ignored
  // rather than fatal: one unhandled event would take the transcript down mid-conversation.
  const p = panel()
  const exotic: ClaudeEvent[] = [
    { kind: 'system', subtype: 'stream_event/message_start', raw: {} },
    { kind: 'partial-end', index: 0 },
    { kind: 'retry', attempt: 2, status: 529, error: 'overloaded' },
    { kind: 'unparsed', line: '{ not json', reason: 'not a JSON object' },
  ]

  for (const event of exotic) {
    assert.doesNotThrow(() => p.view.event(event, MANAGER), `event kind ${event.kind} threw`)
  }

  // And the panel still works afterwards.
  p.view.event(assistant('still here'), MANAGER)
  assert.match(p.text(), /still here/, 'the panel stopped drawing after an event it does not render')
})

/**
 * ## An employee speaking, in pieces
 *
 * An employee's text arrives as fragments carrying `parentToolUseId` and no name, so the panel
 * knows who is speaking only because it saw the dispatch that started them. What it then has to
 * do with the pieces is stated on `employeeSaid`:
 *
 *     Their words accumulate into one turn per employee per manager-turn rather than a block per
 *     fragment -- the same reason the manager's text does, and the same failure if it does not: a
 *     reply arriving in eleven pieces reads as eleven people saying one word each.
 *
 * And they have to stop accumulating when the turn ends. `reset()` clears `employeeTurns` for
 * the reason its own comment gives -- "both cursors go together, or a fragment outlives its
 * turn" -- so the next thing that employee says lands in the next turn rather than being
 * appended to a block somebody has already scrolled past.
 */

const dispatchTo = (who: string, id: string): ClaudeEvent => ({
  kind: 'assistant', parentToolUseId: null,
  blocks: [{ type: 'tool_use', id, name: 'Task', input: { subagent_type: who, description: 'go' } } as never],
  model: 'claude-opus-5',
})

// The real shape, read from `stream.ts`. Written from memory the first time, it was missing
// `refusals` and threw inside `summariseRefusals` — which reads as the module being broken.
const finished = (): ClaudeEvent => ({
  kind: 'result',
  isError: false,
  text: null,
  costUsd: null,
  turns: null,
  durationMs: null,
  denials: [],
})

test('an employee replying in pieces is one turn, not one turn per piece', () => {
  const p = panel()
  p.view.event(dispatchTo('reviewer', 't1'), MANAGER)
  const before = p.turns().length

  p.view.event(partial('The auth change ', 0, 't1'), MANAGER)
  p.view.event(partial('looks right ', 1, 't1'), MANAGER)
  p.view.event(partial('to me.', 2, 't1'), MANAGER)

  const added = p.turns().length - before
  assert.equal(
    added,
    1,
    'three fragments from one employee drew ' + added + ' turns. A reply arriving in eleven ' +
      'pieces reads as eleven people saying one word each.',
  )
  assert.match(p.text(), /The auth change looks right to me\./, 'the pieces did not join into the sentence')
})

test('two employees speaking at once get a turn each', () => {
  const p = panel()
  p.view.event(dispatchTo('reviewer', 't1'), MANAGER)
  p.view.event(dispatchTo('builder', 't2'), MANAGER)
  const before = p.turns().length

  p.view.event(partial('I read it. ', 0, 't1'), MANAGER)
  p.view.event(partial('I wrote it. ', 0, 't2'), MANAGER)
  p.view.event(partial('It is fine.', 1, 't1'), MANAGER)

  assert.equal(p.turns().length - before, 2, 'two employees did not get one turn each')
  assert.match(p.text(), /I read it\. It is fine\./, 'the reviewer’s two pieces did not join')
  assert.match(p.text(), /I wrote it\./, 'the builder’s words are missing')
})

test('once the turn ends, the same employee starts a new one', () => {
  // "Both cursors go together, or a fragment outlives its turn." Without the clear, the next
  // thing this employee says is appended to a block somebody has already scrolled past.
  const p = panel()
  p.view.event(dispatchTo('reviewer', 't1'), MANAGER)
  p.view.event(partial('First turn.', 0, 't1'), MANAGER)
  const afterFirst = p.turns().length

  p.view.event(finished(), MANAGER)
  p.view.event(dispatchTo('reviewer', 't2'), MANAGER)
  p.view.event(partial('Second turn.', 0, 't2'), MANAGER)

  // A dispatch draws a handoff rather than a turn, so the second turn is one more block, not two.
  assert.equal(
    p.turns().length,
    afterFirst + 1,
    'the second turn drew ' + (p.turns().length - afterFirst) + ' blocks',
  )

  // The property, and the one that discriminates: without the clear in `reset()`, both
  // sentences land in the *same* turn — the one above where anybody is now looking.
  const said = p.turns().map((t) => (t.textContent ?? '').replace(/\s+/g, ' '))
  const holding = said.filter((t) => /First turn\.|Second turn\./.test(t))
  assert.equal(
    holding.length,
    2,
    'the two turns hold ' + JSON.stringify(said) + '. A fragment from this turn was appended to ' +
      'the previous one, which is above where anybody is looking.',
  )
  assert.equal(
    holding.filter((t) => /First turn\./.test(t) && /Second turn\./.test(t)).length,
    0,
    'both turns ended up in one block',
  )
})
