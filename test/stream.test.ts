import { test } from 'node:test'
import assert from 'node:assert/strict'

import { StreamParser, toEvent, type ClaudeEvent } from '../src/main/claude/stream.js'
import { factsFromEvent } from '../src/shared/floor/choreography.js'
import { runClaude } from '../src/main/claude/run.js'
import { fakeClaude, init, result } from './fake-claude.js'

const INIT = JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: 'c5c4f905-9996-4d73-9351-6c67c13d640b',
  model: 'claude-opus-4-8',
  cwd: '/tmp/spike',
  tools: ['Read', 'Write', 'Bash'],
  agents: ['manager', 'reviewer'],
})

const ASSISTANT = JSON.stringify({
  type: 'assistant',
  message: { model: 'claude-opus-4-8', role: 'assistant', content: [{ type: 'text', text: 'OK' }] },
})

const RESULT_OK = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'OK',
  total_cost_usd: 0.2897,
  num_turns: 1,
  duration_ms: 765,
})

/** The real shape of an expired token, captured from an actual failing run. */
const RESULT_AUTH_FAIL = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: true,
  result: 'Failed to authenticate. API Error: 401 OAuth access token has expired.',
  total_cost_usd: 0,
  num_turns: 1,
})

const kinds = (events: ClaudeEvent[]) => events.map((e) => e.kind)

// ──────────────────────────────────────────────────────────── line handling ──

test('a whole line yields one event', () => {
  const p = new StreamParser()
  assert.deepEqual(kinds(p.push(INIT + '\n')), ['init'])
})

test('THE BUG: one object split across chunks must still parse', () => {
  // stdout chunks have nothing to do with line boundaries. A naive
  // `chunk.split('\n').map(JSON.parse)` throws on the fragment — or, inside a try/catch,
  // silently drops the event and the floor goes out of sync with reality.
  const p = new StreamParser()
  const half = Math.floor(INIT.length / 2)

  assert.deepEqual(p.push(INIT.slice(0, half)), [], 'a partial line must emit nothing yet')

  const events = p.push(INIT.slice(half) + '\n')
  assert.deepEqual(kinds(events), ['init'])
  const first = events[0]
  assert.ok(first && first.kind === 'init')
  assert.equal(first.sessionId, 'c5c4f905-9996-4d73-9351-6c67c13d640b')
})

test('an object split into many tiny chunks still parses', () => {
  const p = new StreamParser()
  const line = ASSISTANT + '\n'
  const collected: ClaudeEvent[] = []
  for (const ch of line) collected.push(...p.push(ch)) // one character at a time
  assert.deepEqual(kinds(collected), ['assistant'])
})

test('several events in one chunk all come out, in order', () => {
  const p = new StreamParser()
  assert.deepEqual(kinds(p.push(`${INIT}\n${ASSISTANT}\n${RESULT_OK}\n`)), [
    'init',
    'assistant',
    'result',
  ])
})

test('a chunk boundary between two events loses neither', () => {
  const p = new StreamParser()
  const both = `${INIT}\n${ASSISTANT}\n`
  const cut = INIT.length + 20 // mid-way through the second object
  const events = [...p.push(both.slice(0, cut)), ...p.push(both.slice(cut))]
  assert.deepEqual(kinds(events), ['init', 'assistant'])
})

test('blank lines are ignored, not reported as damage', () => {
  const p = new StreamParser()
  assert.deepEqual(kinds(p.push(`\n\n${INIT}\n\n`)), ['init'])
})

// ──────────────────────────────────────────────────── nothing is ever lost ──

test('an unreadable line becomes an event rather than vanishing', () => {
  const p = new StreamParser()
  const events = p.push('{ this is not json }\n')
  assert.deepEqual(kinds(events), ['unparsed'])
  const first = events[0]
  assert.ok(first && first.kind === 'unparsed')
  assert.equal(first.line, '{ this is not json }')
})

test('the reason says which kind of unreadable it was', () => {
  /*
   * Two reasons, and they are different problems with different owners.
   *
   * Malformed JSON usually means chunking — a line that arrived in two pieces and was parsed as
   * one. Valid JSON that is not an object usually means the CLI's format moved. Somebody looking
   * at a wall of truncated JSON in the transcript cannot tell those apart from the line alone,
   * and the line alone is all the transcript used to show: `reason` was computed here and
   * dropped one function later.
   */
  const broken = new StreamParser().push('{ this is not json }\n')[0]
  assert.ok(broken && broken.kind === 'unparsed')
  assert.ok(broken.reason.length > 0, 'a reason nobody wrote is a reason nobody can act on')
  assert.doesNotMatch(broken.reason, /not a JSON object/, 'malformed JSON is not the same complaint')

  const scalar = new StreamParser().push('42\n')[0]
  assert.ok(scalar && scalar.kind === 'unparsed')
  assert.equal(scalar.reason, 'not a JSON object')
})

test('an array is a JSON value and still not a record', () => {
  /*
   * `typeof [] === 'object'`, and an array is not null.
   *
   * So the two checks that guard `toEvent` let one straight through: it was cast to a record,
   * found to have no `type`, and came back as a **system event**. A line the parser cannot read,
   * reported as a kind of line it can — which is the exact failure this module's header says it
   * exists to prevent, arrived at by the oldest trap in the language.
   */
  for (const line of ['[1,2,3]', '[]', '[{"type":"system"}]']) {
    const events = new StreamParser().push(`${line}\n`)
    const first = events[0]
    assert.equal(first?.kind, 'unparsed', `${line} was read as ${first?.kind}`)
    assert.equal(first && first.kind === 'unparsed' ? first.reason : '', 'not a JSON object')
  }
})

test('a block without a type is not a block', () => {
  /*
   * The predicate says `b is StreamBlock`, and `StreamBlock.type` is a required string — so the
   * check has to establish that much, or the assertion is a promise the data has not made.
   *
   * It accepted anything object-shaped and non-null, which let through `{}` and, for the same
   * reason `parseLine` once did, `[]`. Nothing downstream broke, because every reader compares
   * `block.type` against a literal and a block without one was already ignored. The type was
   * the thing that was wrong.
   */
  const events = new StreamParser().push(
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'kept' }, {}, [], { type: 42 }, null] },
    }) + '\n',
  )

  const first = events[0]
  assert.ok(first && first.kind === 'assistant')
  assert.deepEqual(
    first.blocks.map((b) => b.type),
    ['text'],
    'only the block that says what it is survives',
  )
})

test('a record the parser does not recognise keeps everything it arrived with', () => {
  // Not swallowed and not guessed at. A `type` this version has never heard of is the shape a
  // CLI format change arrives in, and the whole record is kept so somebody can see what it was.
  const events = new StreamParser().push('{"type":"something_new","payload":{"a":1}}\n')
  const first = events[0]

  assert.equal(first?.kind, 'system')
  assert.equal(first && first.kind === 'system' ? first.subtype : '', 'something_new')
  assert.deepEqual(
    first && first.kind === 'system' ? first.raw : null,
    { type: 'something_new', payload: { a: 1 } },
    'the raw record is the evidence; a subtype alone cannot be acted on',
  )
})

test('a record with no type at all is unknown, not empty', () => {
  const events = new StreamParser().push('{"payload":{"a":1}}\n')
  const first = events[0]

  assert.equal(first?.kind, 'system')
  assert.equal(first && first.kind === 'system' ? first.subtype : '', 'unknown')
})

test('a damaged line does not stop the ones after it', () => {
  const p = new StreamParser()
  assert.deepEqual(kinds(p.push(`{oops\n${INIT}\n`)), ['unparsed', 'init'])
})

test('a JSON scalar is not a record', () => {
  const p = new StreamParser()
  const events = p.push('42\n')
  assert.equal(events[0]!.kind, 'unparsed')
})

test('end() surfaces a final unterminated line', () => {
  // A process killed mid-write leaves exactly this, and it is the best evidence of why.
  const p = new StreamParser()
  assert.deepEqual(p.push(INIT), [])
  assert.deepEqual(kinds(p.end()), ['init'])
})

test('end() on a clean stream emits nothing', () => {
  const p = new StreamParser()
  p.push(INIT + '\n')
  assert.deepEqual(p.end(), [])
})

// ───────────────────────────────────────────────────────────────── mapping ──

test('init carries what a session needs to be resumed and rendered', () => {
  const e = toEvent(JSON.parse(INIT))
  assert.equal(e.kind, 'init')
  if (e.kind !== 'init') return
  assert.equal(e.model, 'claude-opus-4-8')
  assert.deepEqual([...e.agents], ['manager', 'reviewer'])
  assert.equal(e.tools.length, 3)
})

test('an expired token is a failed result, not a crash', () => {
  // This is the shape that actually bit us: the process reports a *successful* run whose
  // result carries is_error. Trusting the exit code or the subtype reports it as fine.
  const e = toEvent(JSON.parse(RESULT_AUTH_FAIL))
  assert.equal(e.kind, 'result')
  if (e.kind !== 'result') return
  assert.equal(e.isError, true, 'must be recognised as a failure')
  assert.match(e.text ?? '', /401/)
})

test('a healthy result carries the cost', () => {
  const e = toEvent(JSON.parse(RESULT_OK))
  assert.equal(e.kind === 'result' && e.isError, false)
  assert.equal(e.kind === 'result' && e.costUsd, 0.2897)
})

test('api_retry is surfaced as its own event', () => {
  const e = toEvent({ type: 'system', subtype: 'api_retry', attempt: 1, error_status: 401, error: 'authentication_failed' })
  assert.equal(e.kind, 'retry')
  assert.equal(e.kind === 'retry' && e.status, 401)
})

test('a plain-string user turn is normalised to blocks', () => {
  const e = toEvent({ type: 'user', message: { role: 'user', content: 'hello' } })
  assert.equal(e.kind, 'user')
  assert.deepEqual(e.kind === 'user' ? e.blocks : [], [{ type: 'text', text: 'hello' }])
})

test('tool_use blocks survive intact', () => {
  const e = toEvent({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/x' } }] },
  })
  assert.equal(e.kind === 'assistant' && e.blocks[0]?.name, 'Read')
  assert.deepEqual(e.kind === 'assistant' ? e.blocks[0]?.input : null, { file_path: '/x' })
})

test('an unknown system subtype is kept, not discarded', () => {
  // New CLI versions add event types. Dropping them silently is how a floor stops reacting
  // to work after an upgrade, with nothing in the logs to explain it.
  const e = toEvent({ type: 'system', subtype: 'something_new_in_2027', payload: 1 })
  assert.equal(e.kind, 'system')
  assert.equal(e.kind === 'system' && e.subtype, 'something_new_in_2027')
})

// ─────────────────────────────────────────────── partials, and the floor's blindness to them ──

test('a content_block_delta becomes its own event kind, not a flag on assistant', () => {
  // The shape is measured, not remembered: this is what `--include-partial-messages` actually
  // emits, captured from the installed CLI.
  const [event] = new StreamParser().push(
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'the quick ' } },
      session_id: 's1',
      parent_tool_use_id: null,
    }) + '\n',
  )

  assert.equal(event?.kind, 'partial')
  assert.equal(event?.kind === 'partial' && event.of, 'text')
  assert.equal(event?.kind === 'partial' && event.text, 'the quick ')
  assert.equal(event?.kind === 'partial' && event.index, 0)
})

test('thinking deltas are carried, not discarded', () => {
  const [event] = new StreamParser().push(
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } },
    }) + '\n',
  )
  // Not rendered, which is a decision the renderer makes. Not dropped here, which would be this
  // module deciding on its behalf that it never could be.
  assert.equal(event?.kind === 'partial' && event.of, 'thinking')
})

test('a subagent fragment is attributed to its parent tool call', () => {
  const [event] = new StreamParser().push(
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } },
      parent_tool_use_id: 'toolu_abc',
    }) + '\n',
  )
  assert.equal(event?.kind === 'partial' && event.parentToolUseId, 'toolu_abc')
})

test('stream_event records we do not interpret stay visible as system events', () => {
  // `message_start` and friends. Kept rather than dropped: a record we chose not to interpret
  // is not the same as one that was not there, and the difference is the fourth standing order.
  const [event] = new StreamParser().push(
    JSON.stringify({ type: 'stream_event', event: { type: 'message_start', message: {} } }) + '\n',
  )
  assert.equal(event?.kind, 'system')
  assert.equal(event?.kind === 'system' && event.subtype, 'stream_event/message_start')
})

test('THE GUARANTEE: a partial produces no facts, so the floor cannot act on one', () => {
  // Agreed with the machine that owns the floor before either half was built, and the reason is
  // about how each shape fails rather than which is tidier. A *flag* on `assistant` fails open:
  // every call site must remember to check it, and the one that forgets animates a dispatch
  // that has not happened. A separate *kind* fails closed — the switch simply does not match.
  //
  // A partial is the one provisional event in the stream. Text that looks like a decision may
  // not survive to the end of the block. The transcript may show it, because a transcript
  // records what was said. The floor may not, because the floor is a claim about what is
  // happening.
  const partials = [
    { kind: 'partial' as const, index: 0, of: 'text' as const, text: 'dispatching the reviewer now', parentToolUseId: null },
    { kind: 'partial' as const, index: 1, of: 'thinking' as const, text: 'I should call a meeting', parentToolUseId: null },
    { kind: 'partial' as const, index: 0, of: 'text' as const, text: 'x', parentToolUseId: 'toolu_1' },
    { kind: 'partial-end' as const, index: 0 },
  ]

  for (const event of partials) {
    assert.deepEqual(
      factsFromEvent(event, 'Manager'),
      [],
      `a ${event.kind} produced a fact — the floor can now depict something that has not happened`,
    )
  }
})

// ───────────────────────────────── refused tool calls, and why nothing happened ──

test('refused tool calls are carried off the result event', () => {
  // The buildable half of an approval prompt. `--print` cannot stop and ask, so a call the
  // workspace has not authorised is refused and the agent finds out by being told no — and
  // until this was read, so did nobody else. The run looked finished and the thing you asked
  // for had simply not been done.
  const [event] = new StreamParser().push(
    JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'done',
      permission_denials: [
        { tool_name: 'Bash', tool_use_id: 'toolu_1', tool_input: { command: 'rm -rf dist' } },
        { tool_name: 'Write', tool_use_id: 'toolu_2', tool_input: { file_path: '/etc/hosts' } },
      ],
    }) + '\n',
  )

  assert.equal(event?.kind, 'result')
  const denials = event?.kind === 'result' ? event.denials : []
  assert.equal(denials.length, 2)
  // The detail comes from the payload rather than being reconstructed, so what the office shows
  // is what the CLI actually refused.
  assert.deepEqual(denials[0], {
    tool: 'Bash',
    toolUseId: 'toolu_1',
    detail: 'rm -rf dist',
    // **Never anything else from a parse.** The payload above is the whole denial entry the CLI
    // sends — `tool_name`, `tool_use_id`, `tool_input` — and it carries no reason at all. A
    // parser that reported `denied` here would be inventing a fact about somebody else's data.
    // The cause is established later, by `refusalCause`, against rules that can actually be
    // read. See `test/refusals.test.ts`.
    cause: 'unknown',
  })
  assert.equal(denials[1]?.detail, '/etc/hosts')
  assert.equal(denials[1]?.cause, 'unknown')
})

test('an ordinary run refuses nothing, and says so as an empty list', () => {
  const [event] = new StreamParser().push(
    JSON.stringify({ type: 'result', is_error: false, result: 'done', permission_denials: [] }) + '\n',
  )
  assert.deepEqual(event?.kind === 'result' ? event.denials : null, [])
})

test('a denial with no recognisable detail is still reported', () => {
  // Absent is not empty. A refusal we cannot summarise is still a refusal, and dropping it
  // would put the office back to saying nothing about why the work did not happen.
  const [event] = new StreamParser().push(
    JSON.stringify({
      type: 'result',
      is_error: false,
      permission_denials: [{ tool_name: 'WebFetch', tool_input: { something: 'unmodelled' } }],
    }) + '\n',
  )
  const denials = event?.kind === 'result' ? event.denials : []
  assert.equal(denials.length, 1)
  assert.equal(denials[0]?.tool, 'WebFetch')
  assert.equal(denials[0]?.detail, null)
})

test('the rate limit event is read, and reported rather than judged', () => {
  /*
   * **This fixture is the real payload, and the last one was not.**
   *
   * The old fixture carried a flat `utilization: 0.73`, which is exactly what the parser read —
   * so the code and its own test agreed with each other and neither agreed with the CLI. Against
   * a real run the number is nested per window, and `used` came out `null` on every run since
   * this was written. The one figure worth having read as "we do not know" while sitting in the
   * same object, one level down.
   *
   * Captured verbatim from `claude --print --output-format stream-json --verbose` on 2026-09-01.
   * Do not flatten it to make an assertion easier — flattening it is the bug.
   */
  const [event] = new StreamParser().push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        resetsAt: 1788253800,
        rateLimitType: 'five_hour',
        overageStatus: 'rejected',
        overageDisabledReason: 'org_level_disabled',
        isUsingOverage: false,
        unifiedWindows: {
          five_hour: { utilization: 0.72, resetsAt: 1788253800 },
          seven_day: { utilization: 0.07, resetsAt: 1788836400 },
        },
      },
    }) + '\n',
  )

  assert.equal(event?.kind, 'rate-limit')
  if (event?.kind !== 'rate-limit') return
  assert.equal(event.status, 'allowed')
  assert.equal(event.window, 'five_hour')
  assert.equal(event.used, 0.72, 'the binding window\'s utilisation was not read')
  assert.equal(event.resetsAt, 1788253800)
  assert.equal(event.usingOverage, false)
  assert.equal(event.overage, 'rejected', 'whether you can pay past the limit is the difference between slowed and stopped')
})

test('both windows are reported, because the one that stops you tonight is not the weekly one', () => {
  // Measured on a real machine: five_hour 0.72 and seven_day 0.07 at the same instant. Reporting
  // only the binding window answers half the question — and which half changes hour to hour.
  const [event] = new StreamParser().push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        rateLimitType: 'five_hour',
        unifiedWindows: {
          five_hour: { utilization: 0.72, resetsAt: 1788253800 },
          seven_day: { utilization: 0.07, resetsAt: 1788836400 },
        },
      },
    }) + '\n',
  )
  if (event?.kind !== 'rate-limit') return assert.fail('not parsed as a rate limit')
  assert.deepEqual(
    event.windows.map((w) => [w.name, w.used]),
    [
      ['five_hour', 0.72],
      ['seven_day', 0.07],
    ],
  )
})

test('a window the payload did not carry is absent, not a window at zero', () => {
  // Absent is not empty, on the surface where reading it as empty says "you have used none of
  // your plan" to somebody who may have used all of it.
  const [event] = new StreamParser().push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', unifiedWindows: { five_hour: {} } },
    }) + '\n',
  )
  if (event?.kind !== 'rate-limit') return assert.fail('not parsed as a rate limit')
  assert.equal(event.windows[0]?.used, null, 'a missing utilisation was invented as a number')
  assert.equal(event.used, null, 'the binding window reported a utilisation it was never given')
})

test('the older flat shape still parses, so a different CLI version is not broken', () => {
  // The fallback costs one `??`. Guessing which version somebody has installed is not this
  // parser's job, and a CLI that sends the old shape should keep working.
  const [event] = new StreamParser().push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.73, resetsAt: 1787626800 },
    }) + '\n',
  )
  if (event?.kind !== 'rate-limit') return assert.fail('not parsed as a rate limit')
  assert.equal(event.used, 0.73)
  assert.equal(event.resetsAt, 1787626800)
})

test('an unfamiliar rate-limit status is passed through, not mapped to "fine"', () => {
  const [event] = new StreamParser().push(
    JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'something_new' } }) + '\n',
  )
  assert.equal(event?.kind === 'rate-limit' ? event.status : null, 'something_new')
})

test('a project can bring its own MCP servers', async (t) => {
  // The other half of connectors, and the half that makes the office agnostic: the survey says
  // what a workspace declares, this is how a project adds to it. Verified working end to end
  // against a real probe in an earlier session, then unused for weeks.
  const fake = await fakeClaude(t, { lines: [init('s'), result(false)] })
  const run = runClaude(
    { cwd: fake.dir, prompt: 'hi', claudePath: fake.path, mcpConfigs: ['/w/.mcp.json'] },
    () => {},
  )
  await run.done

  const argv = await fake.argv()
  assert.equal(argv[argv.indexOf('--mcp-config') + 1], '/w/.mcp.json')
  // Not strict unless asked: the user's own servers work in their terminal and are theirs.
  assert.ok(!argv.includes('--strict-mcp-config'))
})

test('strict is refused on its own, because alone it only takes things away', async (t) => {
  // `--strict-mcp-config` with no config drops every server the user has and gives nothing back.
  // A flag that can only subtract should not fire without the thing it is scoping.
  const fake = await fakeClaude(t, { lines: [init('s'), result(false)] })
  const run = runClaude(
    { cwd: fake.dir, prompt: 'hi', claudePath: fake.path, strictMcp: true },
    () => {},
  )
  await run.done

  assert.ok(!(await fake.argv()).includes('--strict-mcp-config'))
})

// ── The three branches nothing was reading ───────────────────────────────────────────────────
//
// Found by asking which *code* lines the coverage run reports as uncovered, rather than which
// lines it reports. This file is 39% comment and the report counts prose and type declarations
// alongside statements, so `stream.ts` read as 56% covered while the untested part was three
// branches and a helper. A percentage measured against a denominator that is half prose says
// something, but not the thing a reader takes from it.
//
// All three read output from a process this app does not control. That is the whole reason they
// are worth a test: every one of them is a guess about a shape somebody else chose.

test('a server the CLI has connected to is not the same as one that is merely configured', () => {
  // This feeds `liveMcpStatus`, which the privacy panel's egress rows read to decide between
  // `configured` and `connected` — a distinction `CapabilityReport.servers` calls out in its own
  // comment as one the UI must not conflate. Parsed wrongly, the panel makes exactly that claim.
  const event = toEvent({
    type: 'system',
    subtype: 'init',
    session_id: 's',
    mcp_servers: [
      { name: 'graphiti-memory', status: 'connected' },
      { name: 'unreachable-one', status: 'failed' },
      // No status at all: `unknown` is the honest reading, and defaulting it to `connected`
      // would put a live badge on a server nobody has heard from.
      { name: 'silent-one' },
    ],
  })

  assert.equal(event.kind, 'init')
  assert.deepEqual(event.kind === 'init' ? event.mcpServers : null, [
    { name: 'graphiti-memory', status: 'connected' },
    { name: 'unreachable-one', status: 'failed' },
    { name: 'silent-one', status: 'unknown' },
  ])
})

test('a malformed server entry is dropped rather than dragging the list down with it', () => {
  // One bad row must not cost the good ones. The alternative — returning `[]` on any surprise —
  // reports a machine with no MCP servers, which is the reading this repository spends most of
  // its time refusing.
  const event = toEvent({
    type: 'system',
    subtype: 'init',
    session_id: 's',
    mcp_servers: [
      null,
      'not-an-object',
      { status: 'connected' }, // no name
      { name: '', status: 'connected' }, // empty name
      { name: 'real', status: 'connected' },
      { name: 'numeric-status', status: 7 },
    ],
  })

  assert.deepEqual(event.kind === 'init' ? event.mcpServers : null, [
    { name: 'real', status: 'connected' },
    { name: 'numeric-status', status: 'unknown' },
  ])
})

test('mcp_servers that is not a list at all is no servers, not a crash', () => {
  for (const shape of [undefined, null, 'connected', 42, { name: 'x' }]) {
    const event = toEvent({ type: 'system', subtype: 'init', session_id: 's', mcp_servers: shape })
    assert.deepEqual(event.kind === 'init' ? event.mcpServers : null, [], `mcp_servers: ${JSON.stringify(shape)}`)
  }
})

test('a task that started is reported with the id the finish will arrive under', () => {
  const event = toEvent({
    type: 'system',
    subtype: 'task_started',
    tool_use_id: 'toolu_01',
    task_id: 'task-9',
    subagent_type: 'reviewer',
    description: 'Check the retry path',
  })

  assert.deepEqual(event, {
    kind: 'task-started',
    toolUseId: 'toolu_01',
    taskId: 'task-9',
    agent: 'reviewer',
    description: 'Check the retry path',
  })
})

test('a task start with no tool_use_id is not a task start', () => {
  // The id is what a later finish is matched against. Without one there is nothing to close, and
  // inventing an empty-string key would collapse every anonymous task onto one another.
  for (const id of [undefined, '', 42, null]) {
    const event = toEvent({ type: 'system', subtype: 'task_started', tool_use_id: id, task_id: 't' })
    assert.notEqual(event.kind, 'task-started', `tool_use_id: ${JSON.stringify(id)}`)
  }
})

test('a finished task reports its status rather than deciding what it means', () => {
  const event = toEvent({
    type: 'system',
    subtype: 'task_notification',
    tool_use_id: 'toolu_02',
    task_id: 'task-9',
    status: 'failed',
    summary: 'Two of the three retries never fired',
    usage: { total_tokens: 4210, duration_ms: 8_000 },
  })

  assert.deepEqual(event, {
    kind: 'task-finished',
    toolUseId: 'toolu_02',
    taskId: 'task-9',
    // `failed`, verbatim. A parser that mapped this to `done` would put standing order three on
    // the floor — an employee sitting down as though the work had landed.
    status: 'failed',
    summary: 'Two of the three retries never fired',
    tokens: 4210,
    durationMs: 8_000,
  })
})

test('a finished task with no usage reports null rather than zero', () => {
  // Zero tokens and zero milliseconds are measurements. Absent is not empty, and a work feed
  // printing "0 tokens · 0ms" for a task nobody measured is the fourth standing order in a cell.
  const event = toEvent({
    type: 'system',
    subtype: 'task_notification',
    tool_use_id: 'toolu_03',
    status: 'completed',
  })

  assert.equal(event.kind, 'task-finished')
  if (event.kind !== 'task-finished') return
  assert.equal(event.tokens, null)
  assert.equal(event.durationMs, null)
  assert.equal(event.summary, null)
  // No `status` on the wire is `unknown`, never a guess at success.
  assert.equal(toEvent({ type: 'system', subtype: 'task_notification', tool_use_id: 'x' }).kind, 'task-finished')
})

test('a task notification with no tool_use_id is not a task finish', () => {
  for (const id of [undefined, '', 0, null]) {
    const event = toEvent({ type: 'system', subtype: 'task_notification', tool_use_id: id, status: 'completed' })
    assert.notEqual(event.kind, 'task-finished', `tool_use_id: ${JSON.stringify(id)}`)
  }
})

test('THE BUG: a number that is not finite is not a number this app will show', () => {
  // `typeof NaN === 'number'` and `typeof Infinity === 'number'`, and JSON reaches the second
  // without trying — `1e999` parses to `Infinity`. It passed the guard, was added to the running
  // total, and `Infinity.toFixed(4)` is the string "Infinity", so the cost line read
  // **"$Infinity this session"**: money stated wrongly, on screen, in the one place a person
  // checks what a turn cost.
  //
  // Nothing observed sends such a value. That is a fact about the CLI measured this week rather
  // than about the format, and this file exists because the format is somebody else's.
  const absurd = JSON.parse('{"type":"result","total_cost_usd":1e999,"num_turns":1e999,"duration_ms":1e999}')
  const event = toEvent(absurd)

  assert.equal(event.kind, 'result')
  if (event.kind !== 'result') return
  assert.equal(event.costUsd, null, 'an infinite cost is not a cost')
  assert.equal(event.turns, null)
  assert.equal(event.durationMs, null)
})

test('and an ordinary result still reports its numbers', () => {
  // The other half: a guard that rejected everything would pass the test above and be worse.
  const event = toEvent({ type: 'result', total_cost_usd: 0.2431, num_turns: 3, duration_ms: 8_000 })
  assert.equal(event.kind, 'result')
  if (event.kind !== 'result') return
  assert.equal(event.costUsd, 0.2431)
  assert.equal(event.turns, 3)
  assert.equal(event.durationMs, 8_000)
  // Zero is a measurement, not a missing value — a free turn cost zero and must not read as null.
  const free = toEvent({ type: 'result', total_cost_usd: 0, num_turns: 0, duration_ms: 0 })
  assert.equal(free.kind === 'result' && free.costUsd, 0)
  assert.equal(free.kind === 'result' && free.turns, 0)
})

test('the same rule holds for a finished task\'s usage', () => {
  const absurd = toEvent({
    type: 'system', subtype: 'task_notification', tool_use_id: 'x',
    usage: JSON.parse('{"total_tokens":1e999,"duration_ms":1e999}'),
  })
  assert.equal(absurd.kind, 'task-finished')
  if (absurd.kind !== 'task-finished') return
  assert.equal(absurd.tokens, null)
  assert.equal(absurd.durationMs, null)
})

test('THE FUZZ: no corruption of a real event shape produces a type name or a non-number', () => {
  // This file's whole job is reading a format somebody else owns. The tests above each name one
  // field that was got wrong; this asks the same question of every field at once, by taking the
  // shapes the CLI actually sends and replacing pieces of them with things it never would.
  //
  // It found `sessionId: String(record['session_id'] ?? '')` — `??` steps past null and undefined
  // and nothing else, so `{}` arrived as the string "[object Object]". That id is written to the
  // registry, passed to `--resume`, and used to key the live-session map: a conversation existing
  // in three places and openable from none. Its own neighbours, `model` and `cwd`, already used
  // `typeof`.
  //
  // Deterministic seed, so a failure is reproducible rather than a story about one run.
  let seed = 987654321
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!

  const corrupt: unknown[] = [null, undefined, 0, 1e999, NaN, '', [], {}, true, -1, { text: {} }]
  const maybe = (good: unknown): unknown => (rnd() > 0.55 ? good : pick(corrupt))

  const templates: (() => Record<string, unknown>)[] = [
    () => ({ type: 'system', subtype: maybe('init'), session_id: maybe('s'), agents: maybe(['a']), mcp_servers: maybe([{ name: 'x', status: 'connected' }]) }),
    () => ({ type: 'system', subtype: maybe('task_started'), tool_use_id: maybe('t1'), task_id: maybe('k'), subagent_type: maybe('builder') }),
    () => ({ type: 'system', subtype: maybe('task_notification'), tool_use_id: maybe('t1'), status: maybe('completed'), usage: maybe({ total_tokens: maybe(10) }) }),
    () => ({ type: 'assistant', message: maybe({ content: maybe([{ type: 'text', text: maybe('hi') }]) }) }),
    () => ({ type: 'user', message: maybe({ content: maybe([{ type: 'tool_result', tool_use_id: maybe('t1'), content: maybe('out') }]) }) }),
    () => ({ type: 'result', is_error: maybe(false), result: maybe('done'), total_cost_usd: maybe(0.1), num_turns: maybe(2) }),
  ]

  // The name of a type is never a value. If one of these reaches a field, something was coerced
  // rather than checked, and it will be shown to somebody as though the CLI had said it.
  const TYPE_NAMES = new Set(['undefined', 'null', '[object Object]', 'true', 'false', 'NaN'])
  const kinds = new Set<string>()
  const problems: string[] = []

  for (let n = 0; n < 20_000; n++) {
    const record = pick(templates)()
    let event
    try {
      event = toEvent(record)
    } catch (err) {
      problems.push(`threw on ${JSON.stringify(record).slice(0, 60)}: ${(err as Error).message}`)
      continue
    }
    kinds.add(event.kind)
    for (const [key, value] of Object.entries(event)) {
      if (typeof value === 'number' && !Number.isFinite(value)) problems.push(`${event.kind}.${key} is ${String(value)}`)
      if (typeof value === 'string' && TYPE_NAMES.has(value)) problems.push(`${event.kind}.${key} is the string ${JSON.stringify(value)}`)
    }
  }

  assert.deepEqual(problems.slice(0, 5), [], `${problems.length} of 20000 records produced a coerced value`)
  // The fuzz is only worth its runtime if it reaches the branches. If a refactor stops these
  // shapes parsing, this fails loudly rather than passing on six thousand `unparsed` events.
  for (const kind of ['init', 'assistant', 'user', 'result', 'task-started', 'task-finished']) {
    assert.ok(kinds.has(kind), `the fuzz never produced a ${kind} event, so it checked less than it looks`)
  }
})
