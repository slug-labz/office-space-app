/**
 * The activity strip's history, rebuilt from a transcript.
 *
 * F2, measured on a real session: after a relaunch the chat showed a dispatch to `frontend`
 * while the strip beside it said **"Nothing yet this session."** Neither sentence was false.
 * Together they were a lie, and it is the kind of lie that is hard to see because nothing on
 * screen looks broken — standing order three failed by omission.
 *
 * Four things are asserted here and each is a different way of getting the fix wrong:
 *
 * 1. the strip forgetting at all — the bug;
 * 2. the strip *over*-remembering, and showing yesterday's dispatch as running today. Those
 *    processes died with the last run. A "Running" zone repopulated from a file would be the
 *    office claiming to watch work that is not happening, which is worse than the bug;
 * 3. a line the parser could not read vanishing on the way through. Standing order four —
 *    absent is not empty, and a rebuild is exactly where an unreadable line gets quietly lost;
 * 4. the run-folding still folding runs, and *not* folding across the seam between what was
 *    read and what was watched.
 *
 * Driven through `parseTranscript` rather than from hand-built timeline entries, because the
 * thing being fixed is the real path from a file on disk to a line on screen.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { restoreActivity } from '../src/shared/activity-restore.js'
import { collapse, type Entry } from '../src/shared/activity.js'
import { parseTranscript } from '../src/shared/transcript/parse.js'

/** A string is written to the file verbatim, which is how a line that is not JSON gets in. */
const jsonl = (...records: unknown[]) =>
  records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')

const assistantTurn = (content: unknown[], uuid = 'a1', timestamp = '2026-08-24T09:00:00Z') => ({
  type: 'assistant',
  uuid,
  timestamp,
  sessionId: 'sess-1',
  message: { role: 'assistant', model: 'claude-opus-4', content },
})

const resultTurn = (content: unknown[], uuid = 'u2', timestamp = '2026-08-24T09:12:00Z') => ({
  type: 'user',
  uuid,
  timestamp,
  message: { role: 'user', content },
})

const dispatch = (id: string, subagent: string, description: string) => ({
  type: 'tool_use',
  id,
  name: 'Task',
  input: { subagent_type: subagent, description },
})

/** Fold a transcript the way `restore()` does. */
const rebuild = (...records: unknown[]) => restoreActivity(parseTranscript(jsonl(...records)).entries, 'manager')

// ─────────────────────────────────────────────── (a) the strip stops forgetting ──

test('a transcript with a dispatch in it rebuilds a non-empty log', () => {
  // The bug, in one assertion. Before this the answer was zero and the panel said "Nothing yet
  // this session" beside a chat that showed the dispatch.
  const { history } = rebuild(
    assistantTurn([dispatch('t1', 'frontend', 'wire the settings panel')]),
    resultTurn([{ type: 'tool_result', tool_use_id: 't1', content: 'panel wired' }]),
  )

  assert.ok(history.length > 0, 'the strip forgot a conversation the transcript remembers')
  assert.ok(
    history.some((e) => e.kind === 'dispatch' && e.who === 'frontend' && /wire the settings panel/.test(e.text)),
    'the dispatch the transcript shows is not in the log the strip shows',
  )
  assert.ok(
    history.some((e) => e.kind === 'done' && e.who === 'frontend'),
    'the transcript records how it ended and the log does not',
  )
})

test('every rebuilt line says it was read rather than watched', () => {
  // A line out of a file is a weaker claim than a line out of the event stream, and the strip
  // has to be able to draw the difference. Marking is what stops the fix for one lie becoming
  // a second one: hearsay presented as observation.
  const { history } = rebuild(assistantTurn([dispatch('t1', 'tester', 'run the suite')]))

  assert.ok(history.length > 0)
  assert.ok(history.every((e) => e.restored === true), 'a rebuilt line is passing itself off as live')
})

test('a skill and a meeting come back too, and the conversation around them does not', () => {
  // The strip's subject is work changing hands. Text turns are the chat's job, and a log that
  // repeated them would be a second transcript in a panel that says it is not one.
  const { history } = rebuild(
    { type: 'user', uuid: 'u1', timestamp: '2026-08-24T08:59:00Z', message: { role: 'user', content: 'ship it' } },
    assistantTurn([
      { type: 'text', text: 'On it.' },
      { type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'record-progress' } },
      { type: 'tool_use', id: 'm1', name: 'Skill', input: { skill: 'meet', args: 'reviewer tester' } },
    ]),
  )

  assert.deepEqual(
    history.map((e) => e.kind).sort(),
    ['meeting', 'skill'],
    'the log either lost the shelf and the meeting, or grew a copy of the conversation',
  )
  assert.ok(history.some((e) => e.kind === 'meeting' && /reviewer, tester/.test(e.text)))
})

test('an ordinary tool call is not a line of history', () => {
  // Ten Reads in a row are one person working. Live, they only refine a running row; a rebuild
  // that turned each into a log line would spend the whole cap on them.
  const { history } = rebuild(
    assistantTurn([
      { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'tool_use', id: 'r2', name: 'Grep', input: { pattern: 'x' } },
    ]),
  )

  assert.deepEqual(history, [])
})

test('the rebuilt log is capped, and carries the times the transcript recorded', () => {
  // `HISTORY_LIMIT` is enforced by the same `push` the live fold uses, so a long transcript
  // cannot make the strip pay a growing cost. Newest is kept.
  const many = Array.from({ length: 80 }, (_, i) => [
    assistantTurn([dispatch(`t${i}`, `agent${i}`, `job ${i}`)], `a${i}`, '2026-08-24T09:00:00Z'),
    resultTurn([{ type: 'tool_result', tool_use_id: `t${i}`, content: 'done' }], `u${i}`, '2026-08-24T09:30:00Z'),
  ]).flat()

  const { history } = rebuild(...many)

  assert.equal(history.length, 60, 'the cap is not being applied to a rebuild')
  assert.equal(history[0]?.who, 'agent79', 'the cap kept the oldest lines instead of the newest')

  // The handback carries the *result's* time, not the call's. Stamping an ending with the
  // moment it was asked for is a wrong time on screen, which is worse than a missing one.
  const done = history.find((e) => e.kind === 'done')
  assert.equal(done?.at, '2026-08-24T09:30:00Z')
  const picked = history.find((e) => e.kind === 'dispatch')
  assert.equal(picked?.at, '2026-08-24T09:00:00Z')
})

// ───────────────────────────── (b) nothing restored is shown as running today ──

test('a rebuild cannot produce a running row at all', () => {
  // The processes those dispatches started died with the last run. `restoreActivity` returns
  // history and nothing else, so this is structural rather than a rule somebody has to follow:
  // there is no running row available for a caller to draw.
  const rebuilt = rebuild(
    assistantTurn([dispatch('t1', 'builder', 'a long job')]),
    assistantTurn([dispatch('t2', 'tester', 'another long job')], 'a2'),
  )

  assert.deepEqual(Object.keys(rebuilt).sort(), ['history', 'unreadable'])
  assert.ok(!('running' in rebuilt), 'a rebuild is offering somebody as currently running')
  assert.ok(!('inFlight' in rebuilt), 'a rebuild is handing back dispatches to carry on as live')
})

test('a dispatch the transcript never resolved is said plainly, not shown as running', () => {
  // The honest treatment of the genuinely unknowable. We know a dispatch went out and we know
  // no result was written down. Whether the agent finished, died with the app, or answered
  // somewhere this file does not reach, we cannot tell — so the line says only what we know.
  const { history } = rebuild(assistantTurn([dispatch('t1', 'builder', 'the long job')]))

  assert.equal(history.length, 2)
  const unresolved = history[0]
  assert.equal(unresolved?.kind, 'note')
  assert.equal(unresolved?.who, 'builder')
  assert.match(unresolved?.text ?? '', /does not record how it ended/)
  assert.ok(
    !history.some((e) => e.kind === 'done'),
    'an unresolved dispatch was rebuilt as a completed one',
  )
})

test('a background launch receipt is not an ending', () => {
  // `run_in_background` defaults to true, so a dispatch's own `tool_result` arrives within
  // milliseconds saying the agent was *launched*. This repo has already shipped the mistake of
  // reading that as an answer, on the floor. Here it would be worse: the strip would show a
  // finished task whose outcome nobody ever saw.
  const { history } = rebuild(
    assistantTurn([dispatch('t1', 'builder', 'the long job')]),
    resultTurn([
      { type: 'tool_result', tool_use_id: 't1', content: 'Async agent launched with ID: builder-1' },
    ]),
  )

  assert.ok(!history.some((e) => e.kind === 'done'), 'a launch receipt was rebuilt as a completed task')
  assert.match(history[0]?.text ?? '', /does not record how it ended/)
})

// ─────────────────────────────────── (c) a line we could not read leaves a mark ──

test('an unparseable line is reported in the log, never silently dropped', () => {
  // Standing order four. A rebuild is exactly where this goes wrong quietly: the loop is
  // looking for tool calls, an unreadable line is not one, and skipping it costs nothing
  // visible. What it costs is the office's claim to be showing what happened.
  const rebuilt = rebuild(
    assistantTurn([dispatch('t1', 'frontend', 'wire the panel')]),
    '{ this is not json',
  )

  assert.equal(rebuilt.unreadable, 1, 'an unreadable line was counted as if it were not there')
  const reported = rebuilt.history.find((e) => e.kind === 'failed')
  assert.ok(reported, 'a line the office could not read left no trace in the log')
  assert.match(reported.text, /could not be read/)
  // The parser's own reason, carried through. A report that withholds why is half a report.
  assert.ok(reported.text.length > 'a line of the transcript could not be read — '.length)
  // And it did not cost the work that *was* readable.
  assert.ok(rebuilt.history.some((e) => e.kind === 'dispatch'))
})

test('a transcript of nothing but noise still says the noise was there', () => {
  const rebuilt = rebuild('{{{', 'not json either')

  assert.equal(rebuilt.unreadable, 2)
  assert.equal(rebuilt.history.filter((e) => e.kind === 'failed').length, 2)
})

// ──────────────────────────────────────── (d) run-folding, across the seam too ──

test('rebuilt lines still fold into runs', () => {
  // The cap is sixty and a rebuild can fill it with repetition just as a live session can.
  const { history } = rebuild(
    ...Array.from({ length: 5 }, (_, i) => assistantTurn([dispatch(`t${i}`, 'builder', 'the same job')], `a${i}`)),
  )

  const dispatches = collapse(history.filter((e) => e.kind === 'dispatch'))
  assert.equal(dispatches.length, 1)
  assert.equal(dispatches[0]?.count, 5)
})

test('a rebuilt line never folds into an identical live one', () => {
  // The seam. Restored history is appended under whatever has been watched since, so the two
  // sit next to each other — and they read identically whenever the same dispatch is made
  // again. Folding across the boundary would put this session's count on a previous session's
  // line: the strip claiming to have watched something it only read.
  const live: Entry = { kind: 'dispatch', who: 'builder', text: 'picked up: the same job', at: '2026-08-25T09:00:00Z' }
  const read: Entry = { ...live, at: '2026-08-24T09:00:00Z', restored: true }

  const runs = collapse([live, read])
  assert.equal(runs.length, 2, 'a line read out of a file was folded into a line watched happening')
  assert.equal(runs[0]?.entry.restored, undefined)
  assert.equal(runs[1]?.entry.restored, true)

  // Two restored lines still fold with each other, which is the behaviour being preserved.
  assert.equal(collapse([read, read]).length, 1)
})

// ──────────────────────────────────────────────── and that it is actually wired ──

/**
 * A correct rebuild nobody calls fixes nothing.
 *
 * `restore()` lives in the renderer's top-level script and there is no harness that can run it,
 * so this reads the source instead — the same trade `escape.test.ts` and the scale tests make,
 * and for the same reason: a full renderer harness for an invariant that is two lines of
 * reading. What it guards is precisely the shape of the original bug, which was not a wrong
 * rebuild but the **absence** of one at the only place it belongs.
 */
const restoreBody = (): string => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src/renderer/app.ts'), 'utf8')
  const body = /async function restore\(session: string\): Promise<void> \{([\s\S]*?)\n\}/.exec(app)
  assert.ok(body, 'restore() has been renamed or restructured')
  return body[1]!
}

test('restore() rebuilds the strip as well as the chat', () => {
  const body = restoreBody()
  assert.match(body, /tab\.chat\.replay\(/, 'restore() no longer puts the transcript back')
  assert.match(
    body,
    /restoreActivity\(previous\.entries/,
    'restore() puts the conversation back and leaves the strip saying "Nothing yet this ' +
      'session" beside it — the F2 bug, returned.',
  )
  assert.match(body, /activityBySession\.set\(/, 'the rebuilt log is computed and then thrown away')
})
