/**
 * Reopening a saved conversation, which has to read the same as watching it happen.
 *
 * `replay()` was the last uncovered stretch of `chat-view.ts`. It walks a parsed transcript and
 * rebuilds the panel, and its own comments record two things it got wrong on the way here.
 *
 * ## The case that was simply missing
 *
 *     Added after this switch was found to have no case for it at all, two commits after
 *     `parse.ts` learned to emit one. A `/state` in a saved conversation rendered as nothing —
 *     the parser produced the entry, the replay matched no case, and it was dropped in silence.
 *     Absent is not empty, including in our own transcript.
 *
 * That is the fourth standing order failing inside the record itself, and the shape of it is
 * worth keeping: one module learned a new kind, another module's `switch` did not, and TypeScript
 * had nothing to say because a `switch` with no `default` over a union is not an error. Nothing
 * threw; the line just was not there.
 *
 * ## And the several hundred words that were not yours
 *
 * The office prepends a roster and a project heading to what you type before sending it. Replayed
 * naively, a restored conversation opens with all of that attributed to you — so `replay` strips
 * it, and a test that only checked "the message is there" would pass on a transcript that puts
 * a staff list in your mouth.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { ChatView } from '../src/renderer/chat-view.js'
import type { TimelineEntry } from '../src/shared/transcript/parse.js'
import type { Ledger } from '../src/renderer/views/steps.js'

installDom()

const SPEAKER = 'manager'

interface Panel {
  readonly view: ChatView
  readonly root: El
  readonly text: () => string
  readonly turns: () => El[]
}

function panel(): Panel {
  const root = document.createElement('div')
  const view = new ChatView(root, document.createElement('div'))
  return {
    view,
    root: root as unknown as El,
    turns: () => (root as unknown as El).children.filter((c) => c.classList.contains('turn')),
    // The root's own text, once. A walk counts a string once per ancestor.
    text: () => ((root as unknown as El).textContent ?? '').replace(/\s+/g, ' '),
  }
}

let n = 0
const base = (): { uuid: string; timestamp: string } => ({ uuid: `u${++n}`, timestamp: '2026-08-27T10:00:00Z' })

const said = (text: string): TimelineEntry => ({ ...base(), kind: 'user', text })
const replied = (text: string): TimelineEntry => ({ ...base(), kind: 'assistant', text, model: null })
const ran = (name: string, args: string): TimelineEntry => ({ ...base(), kind: 'command', name, args })
const thought = (text: string): TimelineEntry => ({ ...base(), kind: 'thinking', text })

test('a saved conversation comes back as a conversation', () => {
  const p = panel()
  p.view.replay([said('what is the state of the branch'), replied('Thirty commits, all green.')], SPEAKER)

  const text = p.text()
  assert.match(text, /what is the state of the branch/, 'what you said is missing from the replay')
  assert.match(text, /Thirty commits, all green\./, 'the reply is missing from the replay')
  assert.equal(p.turns().length, 2, `expected two turns, found ${p.turns().length}`)
})

test('a slash command in a saved conversation is not dropped in silence', () => {
  // The recorded bug. `parse.ts` learned to emit this kind and the switch here had no case for
  // it, so a `/state` in a reopened conversation rendered as nothing at all — no error, no gap
  // anybody could see, just a line that was not there.
  const p = panel()
  p.view.replay([ran('state', 'the branch')], SPEAKER)

  assert.ok(p.root.children.length > 0, 'a replayed command drew nothing — the entry was parsed and then matched no case')
  const text = p.text()
  assert.match(text, /state/, `the command name is missing: ${JSON.stringify(text.slice(0, 100))}`)
  assert.match(text, /the branch/, 'the command arguments are missing')
})

test('the office context is not attributed to you', () => {
  // What actually goes down the wire is your message with a roster and a project heading in
  // front of it. Replayed whole, a restored conversation opens with several hundred words of
  // staff list in your mouth.
  const p = panel()
  const sent = [
    '## CURRENT PROJECT',
    '',
    'office-space',
    '',
    '## THE STAFF',
    '',
    'reviewer, builder, tester, memory-keeper',
    '',
    '## THE MESSAGE',
    '',
    'have a look at the switcher',
  ].join('\n')

  p.view.replay([said(sent)], SPEAKER)
  const text = p.text()

  assert.match(text, /have a look at the switcher/, 'the actual message was stripped along with the context')
  assert.equal(
    /reviewer, builder, tester/.test(text),
    false,
    'the staff list the office prepended is being shown as something you typed. A restored ' +
      'conversation would open with several hundred words attributed to you.',
  )
  assert.equal(text.includes('CURRENT PROJECT'), false, 'the project heading is being shown as your words')
})

test('thinking is skipped here for the same reason it is skipped live', () => {
  // Not shown in a live turn either, so showing it on replay would make a reopened conversation
  // read differently from the one somebody watched.
  const p = panel()
  p.view.replay([said('go'), thought('I should check the tests first.'), replied('Done.')], SPEAKER)

  const text = p.text()
  assert.match(text, /go/, 'the control: your message must be there, or this proves nothing')
  assert.match(text, /Done\./)
  assert.equal(
    text.includes('I should check the tests first.'),
    false,
    'thinking was drawn on replay but is not drawn live, so a reopened conversation reads ' +
      'differently from the one that was watched',
  )
})

test('a reopened conversation does not stack every question it ever asked', () => {
  // The enforcement the panel applies live has to apply to a restored conversation too, or it
  // "would hold only for people who watched it arrive". Two replies, each carrying a question:
  // only one card may be open, and the other waits its turn.
  const p = panel()
  const ask = (question: string): string =>
    ['```ask', question, '- yes', '- no', '```'].join('\n')

  p.view.replay([replied(ask('Ship it?')), replied(ask('Merge to dev?'))], SPEAKER)

  const cards = p.root.children.flatMap(function walk(n: El): El[] {
    return [n, ...n.children.flatMap(walk)]
  }).filter((n) => n.classList.contains('ask'))

  // The control: if no card was drawn at all, "not stacked" would be trivially true and this
  // would be measuring an ask block that never rendered.
  assert.ok(cards.length > 0, 'no ask card rendered at all, so this proves nothing about stacking')

  const open = cards.filter((c) => !c.classList.contains('ask--waiting') && !c.hidden)
  assert.equal(
    open.length,
    1,
    `${open.length} questions are open at once in a reopened conversation. They go through the ` +
      `same queue as a live turn precisely so this cannot happen — otherwise the rule holds only ` +
      `for somebody who watched the reply arrive.`,
  )
})

test('an empty transcript replays as nothing, rather than as an empty turn', () => {
  const p = panel()
  p.view.replay([], SPEAKER)
  assert.equal(p.root.children.length, 0, 'replaying nothing drew something')
})

test('replaying twice does not double the conversation', () => {
  // A panel is replayed when a conversation is reopened, and reopening the same one twice is an
  // ordinary thing to do.
  const p = panel()
  const entries = [said('hello'), replied('hi')]
  p.view.replay(entries, SPEAKER)
  const once = p.turns().length

  p.view.replay(entries, SPEAKER)
  assert.equal(
    p.turns().length,
    once * 2,
    'replay appends rather than replacing, which is what the caller expects — it clears the ' +
      'panel itself. If that ever changes, this is the assertion that says so rather than a ' +
      'transcript that quietly shows everything twice.',
  )
})

/**
 * ## A step that never settled is unknown, and unknown is not red
 *
 * `settled: false` on a saved entry means the tool call was in flight when the office closed.
 * A saved transcript can never gain the result, so the outcome is not "failed" — it is not
 * known, and `steps.ts` says the distinction cost something to learn:
 *
 *     The first version folded `unknown` into `failed`, and it was wrong in the way this project
 *     cares about most.
 *
 * The cost is specific: every reopened conversation that was closed mid-command comes back with
 * a red mark on a turn whose command may well have succeeded. That is the office reporting a
 * fault it did not observe — the third standing order, on a record somebody reopens precisely
 * because they want to know what happened.
 */

const inFlight = (name: string): TimelineEntry => ({
  ...base(),
  kind: 'tool',
  toolUseId: `t${n}`,
  name,
  input: { command: 'npm test' },
  result: null,
  isError: false,
  settled: false,
})

const settledTool = (name: string, isError: boolean): TimelineEntry => ({
  ...base(),
  kind: 'tool',
  toolUseId: `t${n}`,
  name,
  input: { command: 'npm test' },
  result: isError ? 'exit 1' : 'ok',
  isError,
  settled: true,
})

const marks = (p: Panel): El[] =>
  p.root.children.flatMap(function walk(node: El): El[] {
    return [node, ...node.children.flatMap(walk)]
  }).filter((node) => node.classList.contains('mark'))

test('a turn that was interrupted does not come back red', () => {
  const p = panel()
  p.view.replay([said('run the tests'), inFlight('Bash')], SPEAKER)

  const mark = marks(p)[0]
  assert.ok(mark, 'a replayed tool call left no mark at all, so the turn claims to have done nothing')
  assert.notEqual(
    mark.dataset['state'],
    'failed',
    'a command that was still running when the office closed is drawn as a failure. It may well ' +
      'have succeeded — nothing here observed either outcome, and saying "failed" is the office ' +
      'reporting a fault it did not see.',
  )
})

test('a turn that genuinely failed still comes back red', () => {
  // The control. Without it the test above passes just as well on a mark that is never red.
  const p = panel()
  p.view.replay([said('run the tests'), settledTool('Bash', true)], SPEAKER)

  const mark = marks(p)[0]
  assert.ok(mark, 'a replayed tool call left no mark')
  assert.equal(mark.dataset['state'], 'failed', 'a command that came back with an error is not marked as failed')
})

test('an interrupted step says why it has no result rather than looking finished', () => {
  // Not in the transcript — the transcript shows a mark. The reason lives in the turn's own
  // record, which is what the mark opens, and that is the only place somebody asking "what
  // happened to this?" will look.
  const root = document.createElement('div')
  const opened: Ledger[] = []
  const view = new ChatView(root, document.createElement('div'), undefined, (ledger) => opened.push(ledger))
  view.replay([said('run the tests'), inFlight('Bash')], SPEAKER)

  const walk = (node: El): El[] => [node, ...node.children.flatMap(walk)]
  const mark = walk(root as unknown as El).find((node) => node.classList.contains('mark'))
  assert.ok(mark, 'no mark to open')
  mark.dispatchEvent({ type: 'click', bubbles: true })

  assert.equal(opened.length, 1, 'the mark opened nothing, so the record is unreachable')
  const detail = opened[0]?.all.map((step) => step.detail).join(' ') ?? ''
  assert.match(
    detail,
    /still running when the office was closed/,
    `the step records ${JSON.stringify(detail)} — an unsettled call with no explanation reads as ` +
      `a command that ran and returned nothing`,
  )
})
