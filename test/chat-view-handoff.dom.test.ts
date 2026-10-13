/**
 * The one tool call that is conversation rather than mechanism.
 *
 * The module draws the line and says where it is:
 *
 *     A handoff is conversation. Everything else is mechanism.
 *
 *     The line between them is not "how interesting is this" — it is **who it is about.** A
 *     dispatch is the manager telling you it has put somebody on the job: a thing a manager says
 *     out loud, and the one tool call that changes the room. A file read is the office working,
 *     which is what the floor is for.
 *
 * So a dispatch is a thing in the transcript with a name and a face on it, and everything else
 * collapses into the turn's mark. Getting that backwards in either direction is a specific
 * failure: fold dispatches into the mark and the manager silently stops telling you who it put
 * on the job; promote file reads and the conversation becomes a tool log.
 *
 * It is also the only element in the transcript that is a **button leading somewhere else** —
 * to that employee and their own record of the work. `every-button.dom.test.ts` checks that a
 * press reaches a handler; what it cannot check is that the press carries the right person,
 * which is the whole content of this control.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { ChatView } from '../src/renderer/chat-view.js'
import type { TimelineEntry } from '../src/shared/transcript/parse.js'

installDom()

let n = 0
const base = (): { uuid: string; timestamp: string } => ({ uuid: `u${++n}`, timestamp: '2026-08-27T10:00:00Z' })

type ToolEntry = Extract<TimelineEntry, { kind: 'tool' }>

const dispatch = (who: string, brief = 'audit the ledger'): ToolEntry => ({
  ...base(),
  kind: 'tool',
  toolUseId: `t${n}`,
  // 'Task' and 'Agent' are the two names `delegation.ts` recognises. Read from there rather
  // than guessed: a name that is not one of them is mechanism, and the test would be asserting
  // about a file read.
  name: 'Task',
  input: { subagent_type: who, description: brief, prompt: brief },
  result: 'done',
  isError: false,
  settled: true,
})

const readFile = (): ToolEntry => ({
  ...base(),
  kind: 'tool',
  toolUseId: `t${n}`,
  name: 'Read',
  input: { file_path: 'src/main/ledger.ts' },
  result: '194 lines',
  isError: false,
  settled: true,
})

interface Panel {
  /** Everybody a press has opened, in press order. */
  readonly opened: string[]
  readonly replay: (entries: readonly TimelineEntry[]) => void
  readonly handoffs: () => El[]
  readonly text: () => string
}

function panel(): Panel {
  const root = document.createElement('div')
  const opened: string[] = []
  const view = new ChatView(
    root,
    document.createElement('div'),
    undefined,
    () => {},
    (who) => opened.push(who),
  )
  const walk = (node: El): El[] => [node, ...node.children.flatMap(walk)]
  return {
    opened,
    replay: (entries) => view.replay(entries, 'manager'),
    handoffs: () => walk(root as unknown as El).filter((node) => node.classList.contains('handoff')),
    text: () => ((root as unknown as El).textContent ?? '').replace(/\s+/g, ' '),
  }
}

test('a dispatch is a thing in the conversation, with the name of who was put on it', () => {
  const p = panel()
  p.replay([dispatch('reviewer')])

  assert.equal(p.handoffs().length, 1, `expected one handoff, found ${p.handoffs().length}`)
  assert.match(
    p.text(),
    /reviewer/,
    'the manager put somebody on the job and the transcript does not say who. That is the one ' +
      'tool call that changes the room, folded into a step count.',
  )
})

test('a file read is not', () => {
  // The other half of the same line. Without this the rule reads as "tools are conversation",
  // and the transcript becomes a tool log.
  const p = panel()
  p.replay([readFile()])
  assert.equal(
    p.handoffs().length,
    0,
    'a file read was promoted into the conversation. The office working is what the floor is for.',
  )
})

test('pressing a handoff opens that employee, not the last one dispatched', () => {
  const p = panel()
  p.replay([dispatch('reviewer'), dispatch('builder'), dispatch('tester')])

  const handoffs = p.handoffs()
  assert.equal(handoffs.length, 3, `expected three handoffs, found ${handoffs.length}`)

  handoffs[0]?.dispatchEvent({ type: 'click', bubbles: true })
  assert.deepEqual(
    p.opened,
    ['reviewer'],
    'the first handoff opened somebody else. Every one of these is built in the same loop, so a ' +
      'handler that closed over the wrong variable sends all three to whoever was dispatched last.',
  )

  handoffs[2]?.dispatchEvent({ type: 'click', bubbles: true })
  assert.deepEqual(p.opened, ['reviewer', 'tester'], 'the third handoff carried the wrong employee')
})

test('a dispatch with no employee name is not a door to nowhere', () => {
  // `subagent_type` missing or blank. The element still has to render — it is a real thing that
  // happened — but a button that opens the empty string opens a card for nobody.
  const p = panel()
  p.replay([{ ...dispatch(''), input: { description: 'something' } }])

  const handoff = p.handoffs()[0]
  assert.ok(handoff, 'a dispatch with no name vanished from the transcript entirely')
  assert.match(p.text(), /an employee/, 'a nameless dispatch renders with a blank where the name goes')

  handoff.dispatchEvent({ type: 'click', bubbles: true })
  assert.deepEqual(p.opened, [], 'pressing a handoff that names nobody opened a card for nobody')
})
