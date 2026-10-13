/**
 * What an employee actually did — the panel, not the model.
 *
 * `renderWorkLog` had no tests at all, which is a strange gap for the one surface in the app
 * whose whole reason to exist is the office's second standing order: the manager's account of
 * an employee's work is a *report*, and this panel is where you go to check it against the
 * employee's own record.
 *
 * So the properties asserted here are the ones that make checking possible, and each of them is
 * a way the panel could lie rather than merely look wrong:
 *
 * | property | the lie it prevents |
 * |---|---|
 * | an unreadable record says so | rendering it as an employee who did nothing — a claim about somebody's work, and the fourth standing order broken |
 * | a step still in flight says so | inventing an ending for a call that has not returned |
 * | truncation is stated | showing a partial record as a whole one |
 * | the dispatch id is on screen | leaving "they said the suite passes" and "this is the run where they said it" as two things to match by eye |
 *
 * The last is new. `EmployeeWork.toolUseId` was measured in main, sent across IPC, and read by
 * nothing — a field whose own comment says it exists "so a claim can be checked against the
 * transcript", offered by no surface. That is the second standing order written down and not
 * kept, which is worse than never having claimed it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderWorkLog, summariseWork } from '../src/renderer/views/work.js'
import { installDom, type El } from './dom.js'
import type { EmployeeWork } from '../src/shared/ipc.js'
import type { TimelineEntry } from '../src/shared/transcript/parse.js'

installDom()

/** Render into a fresh host and hand back the fake element, so every test reads its children. */
function render(what: EmployeeWork): El {
  const el = document.createElement('div') as unknown as El
  renderWorkLog(el as unknown as HTMLElement, what)
  return el
}

const work = (over: Partial<EmployeeWork> = {}): EmployeeWork => ({
  brief: 'Review the auth change',
  toolUseId: 'toolu_01H8XYZ',
  entries: [],
  truncated: 0,
  problem: null,
  ...over,
})

const tool = (over: Partial<Extract<TimelineEntry, { kind: 'tool' }>> = {}): TimelineEntry => ({
  kind: 'tool',
  uuid: 'w1',
  timestamp: null,
  toolUseId: 'r1',
  name: 'Read',
  input: { file_path: 'src/auth.ts' },
  result: 'ok',
  isError: false,
  settled: true,
  ...over,
})

const texts = (el: El): string[] => el.children.map((c) => c.textContent)
const classes = (el: El): string[] => el.children.map((c) => c.className)

// ───────────────────────────────────────────── which run this is, and how you check it ──

test('the dispatch id is on screen, because that is the whole point of carrying it', () => {
  const el = render(work({ entries: [tool()] }))

  const trace = el.children.find((c) => c.className.includes('work--trace'))
  assert.ok(trace, 'the id names one Task call in the transcript and one sent line in the ledger')
  assert.equal(trace.textContent, 'dispatch toolu_01H8XYZ')
})

test('a run with no steps still says which run it was', () => {
  // Deliberate ordering: the trace is appended after the empty-state line rather than instead of
  // it. An empty record and an unidentifiable one are different problems, and only the first one
  // is the employee's.
  const el = render(work())

  assert.deepEqual(texts(el), ['Their record has no steps in it yet.', 'dispatch toolu_01H8XYZ'])
})

test('no id means no trace line, rather than the word "dispatch" and nothing after it', () => {
  const el = render(work({ toolUseId: '', entries: [tool()] }))

  assert.equal(classes(el).filter((c) => c.includes('work--trace')).length, 0)
})

// ─────────────────────────────────────────────────── absent is not empty (order four) ──

test('a record that could not be read says so, and renders no steps at all', () => {
  const el = render(work({ problem: 'Their record could not be read: EACCES', entries: [tool()] }))

  assert.deepEqual(texts(el), ['Their record could not be read: EACCES'])
  assert.ok(classes(el)[0]?.includes('work--failed'))
})

test('an unreadable record does not get a trace either — there is nothing to trace to', () => {
  const el = render(work({ problem: 'unreadable', toolUseId: 'toolu_01' }))

  assert.equal(
    classes(el).filter((c) => c.includes('work--trace')).length,
    0,
    'offering an id for a record we could not open invites checking something we never read',
  )
})

// ────────────────────────────────────────────── still running is not the same as done ──

test('a call that had not returned when we looked says so', () => {
  const el = render(work({ entries: [tool({ settled: false, name: 'Bash', input: { command: 'npm test' } })] }))

  assert.ok(
    texts(el)[0]?.endsWith(' — still running'),
    'a step drawn as finished is an ending this panel invented',
  )
})

test('a settled call carries no running marker', () => {
  const el = render(work({ entries: [tool()] }))

  assert.equal(texts(el)[0], 'Read src/auth.ts')
})

test('a failed step is marked failed rather than blending into the list', () => {
  const el = render(work({ entries: [tool({ isError: true })] }))

  assert.ok(classes(el)[0]?.includes('work--failed'))
})

// ──────────────────────────────────────────────────── a partial record says it is one ──

test('truncation is stated, never silent', () => {
  const el = render(work({ truncated: 4, entries: [tool()] }))

  assert.equal(texts(el)[0], '…4 earlier steps not shown')
})

test('nothing dropped means nothing said about dropping', () => {
  const el = render(work({ truncated: 0, entries: [tool()] }))

  assert.equal(texts(el).some((t) => t.includes('not shown')), false)
})

// ──────────────────────────────────────────────── what "what did they do" excludes ──

test('their thinking and their own prompt are not things they did', () => {
  const el = render(
  work({
    entries: [
      { kind: 'user', uuid: 'u1', timestamp: null, text: 'Review the auth change' },
      { kind: 'thinking', uuid: 't1', timestamp: null, text: 'I should look at the refresh path' },
      { kind: 'assistant', uuid: 'a1', timestamp: null, model: 'opus', text: 'Reading the token refresh path.' },
      tool(),
    ],
  }),
  )

  assert.deepEqual(texts(el), ['Reading the token refresh path.', 'Read src/auth.ts', 'dispatch toolu_01H8XYZ'])
})

// ───────────────────────────────────────────────────────── the one-argument summary ──

test('the argument shown is the one that says what the step was doing', () => {
  assert.equal(summariseWork({ command: 'npm test' }), 'npm test')
  assert.equal(summariseWork({ file_path: 'src/a.ts', command: 'ignored' }), 'src/a.ts')
  assert.equal(summariseWork({ nothing_recognised: 'x' }), '')
})

test('a long argument is cut with an ellipsis rather than wrapping the panel', () => {
  const long = 'a'.repeat(200)
  const shown = summariseWork({ command: long })

  assert.equal(shown.length, 91, '90 characters and the ellipsis')
  assert.ok(shown.endsWith('…'))
})
