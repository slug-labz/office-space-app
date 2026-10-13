/**
 * Transcript parsing.
 *
 * The module is not reachable from the UI yet — `PLAN.md` says so, and the chat panel currently
 * renders the live event stream instead. It is tested anyway, for two reasons: it is what
 * "a project is a group of sessions" will be built on, and every rule it encodes is one the
 * office has already paid to learn.
 *
 * Chiefly: **a line that cannot be read is not a line that did not happen.** A transcript that
 * quietly drops what it could not parse is a transcript that lies about the session.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseTranscript } from '../src/shared/transcript/parse.js'

const jsonl = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join('\n')

const userTurn = (text: string, uuid = 'u1') => ({
  type: 'user',
  uuid,
  timestamp: '2026-08-19T10:00:00Z',
  sessionId: 'sess-1',
  cwd: '/work',
  message: { role: 'user', content: text },
})

const assistantTurn = (content: unknown[], uuid = 'a1') => ({
  type: 'assistant',
  uuid,
  timestamp: '2026-08-19T10:00:01Z',
  message: { role: 'assistant', model: 'claude-opus-4', content },
})

test('a plain user turn and an assistant reply become a timeline', () => {
  const t = parseTranscript(jsonl(userTurn('fix the auth bug'), assistantTurn([{ type: 'text', text: 'On it.' }])))

  assert.equal(t.sessionId, 'sess-1')
  assert.equal(t.cwd, '/work')
  assert.deepEqual(t.entries.map((e) => e.kind), ['user', 'assistant'])
  assert.equal(t.entries[1]?.kind === 'assistant' && t.entries[1].model, 'claude-opus-4')
})

test('a tool call and its result become one entry, paired by id', () => {
  const t = parseTranscript(
    jsonl(
      assistantTurn([{ type: 'tool_use', id: 'x1', name: 'Read', input: { file_path: 'a.ts' } }]),
      { type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'x1', content: '42 lines' }] } },
    ),
  )

  assert.equal(t.entries.length, 1)
  const entry = t.entries[0]
  assert.equal(entry?.kind, 'tool')
  assert.equal(entry.kind === 'tool' && entry.result, '42 lines')
  assert.equal(entry.kind === 'tool' && entry.settled, true)
})

test('an unsettled call is not an empty result — the two must not collapse', () => {
  const t = parseTranscript(jsonl(assistantTurn([{ type: 'tool_use', id: 'x1', name: 'Bash', input: { command: 'ls' } }])))

  const entry = t.entries[0]
  assert.equal(entry?.kind === 'tool' && entry.result, null, 'still running')
  assert.equal(entry?.kind === 'tool' && entry.settled, false)
})

test('an empty result is settled, and is not the same as no result', () => {
  const t = parseTranscript(
    jsonl(
      assistantTurn([{ type: 'tool_use', id: 'x1', name: 'Bash', input: {} }]),
      { type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'x1', content: '' }] } },
    ),
  )

  const entry = t.entries[0]
  assert.equal(entry?.kind === 'tool' && entry.result, '')
  assert.equal(entry?.kind === 'tool' && entry.settled, true)
})

test('a line that will not parse is surfaced, never dropped', () => {
  const t = parseTranscript([JSON.stringify(userTurn('hello')), '{"type":"assis', ''].join('\n'))

  assert.equal(t.unreadable, 1)
  const bad = t.entries.find((e) => e.kind === 'unreadable')
  assert.ok(bad, 'the broken line is evidence about the session and belongs in the timeline')
  assert.match(bad?.kind === 'unreadable' ? bad.raw : '', /assis/)
})

test('a result whose call is not in the transcript is shown rather than swallowed', () => {
  const t = parseTranscript(
    jsonl({ type: 'user', uuid: 'u1', message: { content: [{ type: 'tool_result', tool_use_id: 'gone', content: 'ok' }] } }),
  )

  const entry = t.entries[0]
  assert.equal(entry?.kind, 'tool')
  assert.equal(entry.kind === 'tool' && entry.name, '(call not in transcript)')
  assert.equal(entry.kind === 'tool' && entry.settled, true)
})

test('a failed tool result is marked failed', () => {
  const t = parseTranscript(
    jsonl(
      assistantTurn([{ type: 'tool_use', id: 'x1', name: 'Bash', input: {} }]),
      {
        type: 'user',
        uuid: 'u2',
        message: { content: [{ type: 'tool_result', tool_use_id: 'x1', content: 'boom', is_error: true }] },
      },
    ),
  )

  assert.equal(t.entries[0]?.kind === 'tool' && t.entries[0].isError, true)
})

test('subagent records are excluded from the main thread by default, and counted', () => {
  const t = parseTranscript(
    jsonl(userTurn('go'), { ...assistantTurn([{ type: 'text', text: 'inner' }]), isSidechain: true }),
  )

  assert.deepEqual(t.entries.map((e) => e.kind), ['user'])
  assert.equal(t.skipped, 1, 'skipped is counted, so "nothing there" is distinguishable from "not shown"')
})

test('subagent records can be asked for', () => {
  const t = parseTranscript(
    jsonl(userTurn('go'), { ...assistantTurn([{ type: 'text', text: 'inner' }]), isSidechain: true }),
    { includeSidechain: true },
  )

  assert.deepEqual(t.entries.map((e) => e.kind), ['user', 'assistant'])
})

test('bookkeeping records are counted, not rendered and not treated as errors', () => {
  const t = parseTranscript(jsonl({ type: 'queue-operation', uuid: 'q1' }, { type: 'custom-title', uuid: 'c1' }))

  assert.equal(t.entries.length, 0)
  assert.equal(t.skipped, 2)
  assert.equal(t.unreadable, 0)
})

test('a thinking block is kept and its signature is not', () => {
  const t = parseTranscript(
    jsonl(assistantTurn([{ type: 'thinking', thinking: 'weighing it up', signature: 'opaque-blob' }])),
  )

  const entry = t.entries[0]
  assert.equal(entry?.kind, 'thinking')
  assert.equal(entry.kind === 'thinking' && entry.text, 'weighing it up')
  assert.ok(!JSON.stringify(entry).includes('opaque-blob'), 'the signature has no business reaching a renderer')
})

test('an empty transcript is empty, and says nothing went wrong', () => {
  const t = parseTranscript('')

  assert.deepEqual(t.entries, [])
  assert.equal(t.unreadable, 0)
  assert.equal(t.sessionId, null)
})

// ─────────────────────────────────────────────────────────── slash commands ──

test('a slash command is its own entry, not something the user typed', () => {
  // The CLI expands `/state` into two records, both tagged as the user's: a marker naming the
  // command, then the command's entire body. Rendered naively that is two speech bubbles
  // attributed to somebody who typed six characters — the third standing order broken inside
  // the transcript itself.
  const jsonl = [
    JSON.stringify({
      type: 'user',
      uuid: 'a',
      timestamp: '2026-08-19T10:00:00Z',
      message: { content: '<command-message>state</command-message>\n<command-name>/state</command-name>\n<command-args>random</command-args>' },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'b',
      timestamp: '2026-08-19T10:00:01Z',
      message: { content: '# /state\n\nWalk the plan, run every VERIFY, reconcile the files to what is true on disk.' },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'c',
      timestamp: '2026-08-19T10:00:02Z',
      message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'Three tasks, two verified.' }] },
    }),
  ].join('\n')

  const { entries } = parseTranscript(jsonl)

  assert.equal(entries.length, 2, 'the expanded body must not appear as a second user message')
  const command = entries[0]
  assert.equal(command?.kind, 'command')
  assert.equal(command?.kind === 'command' ? command.name : null, 'state')
  assert.equal(command?.kind === 'command' ? command.args : null, 'random')
  assert.equal(entries[1]?.kind, 'assistant')
})

test('a command with no arguments still parses, with empty args', () => {
  const jsonl = JSON.stringify({
    type: 'user',
    uuid: 'a',
    timestamp: '2026-08-19T10:00:00Z',
    message: { content: '<command-name>/plan</command-name>\n<command-args></command-args>' },
  })

  const entry = parseTranscript(jsonl).entries[0]
  assert.equal(entry?.kind, 'command')
  assert.equal(entry?.kind === 'command' ? entry.args : null, '')
})

test('a message that merely starts with a slash is still a message', () => {
  // Matched on the CLI's own tags rather than on a leading slash, because a person can
  // legitimately type one and their words are not bookkeeping.
  const jsonl = JSON.stringify({
    type: 'user',
    uuid: 'a',
    timestamp: '2026-08-19T10:00:00Z',
    message: { content: '/usr/local/bin is missing from PATH' },
  })

  const entry = parseTranscript(jsonl).entries[0]
  assert.equal(entry?.kind, 'user')
})

test('THE BUG: a restored result renders what arrived, or nothing — never the name of a type', () => {
  // `String(b.text)` never fails, which is the problem: a malformed block put words into the
  // restored transcript that nobody wrote, and `.filter(Boolean)` kept them because a non-empty
  // string is truthy however little it means.
  //
  // This is the restore path. `chat-view.ts`'s `flatten` is the live one and had the identical
  // fault — the whole reason both are fixed together is that a reader who checked only one would
  // have concluded the other was fine.
  const malformed = [
    [{ type: 'text', text: undefined }, 'undefined'],
    [{ type: 'text', text: null }, 'null'],
    [{ type: 'text', text: { nested: 1 } }, '[object Object]'],
    [{ type: 'text', text: 42 }, '42'],
  ] as const

  for (const [block, wouldHaveBeen] of malformed) {
    const t = parseTranscript(
      jsonl(
        assistantTurn([{ type: 'tool_use', id: 'x1', name: 'Read', input: { file_path: 'a.ts' } }]),
        { type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'x1', content: [block] }] } },
      ),
    )
    const entry = t.entries[0]
    // `assert.ok` rather than `assert.equal` on the kind: it carries an assertion signature, so
    // the compiler narrows past it and the reads below are checked rather than cast.
    assert.ok(entry && entry.kind === 'tool', 'expected one tool entry')
    assert.equal(entry.result, '', `rendered ${JSON.stringify(wouldHaveBeen)} into the transcript`)
    // The call is still settled: the result arrived, it simply held nothing readable. Those are
    // different facts and the transcript keeps them apart.
    assert.equal(entry.settled, true)
  }
})

test('and a well-formed restored result still reads exactly as it arrived', () => {
  // The other half. A fix that emptied everything would pass the test above and be worse.
  const t = parseTranscript(
    jsonl(
      assistantTurn([{ type: 'tool_use', id: 'x1', name: 'Read', input: { file_path: 'a.ts' } }]),
      {
        type: 'user',
        uuid: 'u2',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'x1',
              // A readable part beside an unreadable one keeps what it can.
              content: [{ type: 'text', text: 'first' }, { type: 'text', text: undefined }, { type: 'text', text: 'second' }],
            },
          ],
        },
      },
    ),
  )
  const entry = t.entries[0]
  assert.ok(entry && entry.kind === 'tool')
  assert.equal(entry.result, 'first\nsecond')
})

test('a result that is neither string nor blocks shows its shape rather than nothing', () => {
  // An arrived-and-empty result is indistinguishable from one that never came, which is the
  // distinction this file spends most of its length keeping.
  const t = parseTranscript(
    jsonl(
      assistantTurn([{ type: 'tool_use', id: 'x1', name: 'Read', input: { file_path: 'a.ts' } }]),
      { type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'x1', content: { rows: 3 } }] } },
    ),
  )
  const entry = t.entries[0]
  assert.ok(entry && entry.kind === 'tool')
  assert.equal(entry.result, '{"rows":3}')
})
