/**
 * Parsing Claude Code's `--output-format stream-json` feed.
 *
 * The CLI writes newline-delimited JSON to stdout. That sounds trivial and contains one
 * genuinely nasty bug: **stdout arrives in chunks that have nothing to do with line
 * boundaries.** A single JSON object routinely spans two chunks, and a naive
 * `chunk.split('\n').map(JSON.parse)` throws on the fragment, or — worse — silently drops it
 * inside a try/catch. Either way an event vanishes and the office floor goes quietly out of
 * sync with reality.
 *
 * So this module owns exactly one responsibility: turn a byte stream into whole lines, and
 * whole lines into typed events, **losing nothing**. A line that will not parse becomes an
 * `unparsed` event rather than disappearing, because a feed that quietly swallows what it
 * cannot read is a feed that lies about what happened.
 */

import type { RefusalCause, ShortDenyList, UnusableSettings } from '../../shared/refusals.js'

/** A content block inside an assistant or user message. */
export interface StreamBlock {
  readonly type: string
  readonly text?: string
  readonly thinking?: string
  readonly id?: string
  readonly name?: string
  readonly input?: Record<string, unknown>
  readonly tool_use_id?: string
  readonly content?: unknown
  readonly is_error?: boolean
}

/** One of a plan's buckets, as the CLI reported it. */
export interface RateWindow {
  /** `five_hour`, `seven_day` — whatever the payload called it, never mapped. */
  readonly name: string
  /** 0–1, or `null` when the payload carried the window and not its number. */
  readonly used: number | null
  readonly resetsAt: number | null
}

export type ClaudeEvent =
  /** First event of every run. Carries the session id we need in order to resume. */
  | {
      readonly kind: 'init'
      readonly sessionId: string
      readonly model: string | null
      readonly cwd: string | null
      readonly tools: readonly string[]
      readonly agents: readonly string[]
      /**
       * The MCP servers this session actually reached, with a live per-server verdict.
       *
       * The difference between what a workspace *declares* and what it *has*. Every other
       * source of this information — the settings files, `.mcp.json`, `~/.claude.json` — says
       * what somebody wrote down; a server can be configured perfectly and be a dead port, a
       * missing binary, or awaiting an approval nobody gave. This field is the CLI reporting
       * what happened when it tried, and the office gets it free from a session it was
       * starting anyway.
       *
       * Empty is ambiguous and must not be read as "none configured": a session may simply not
       * have said. The capability scan distinguishes those two, and this is only ever used to
       * *confirm* what that scan found.
       */
      readonly mcpServers: readonly McpStatus[]
    }
  | {
      readonly kind: 'assistant'
      readonly blocks: readonly StreamBlock[]
      readonly model: string | null
      /**
       * Which dispatch this turn belongs to, or `null` for the manager's own.
       *
       * The CLI tags every event a subagent produces with the `tool_use` id of the `Task` call
       * that started it — and that id **is** `Dispatch.id`, which `ledger.ts` already records.
       * So an employee's `Edit` arrives already joined to the brief it was sent, with no
       * correlation heuristic and no timestamp matching.
       *
       * Read for `partial` since that was written and dropped here, which is why nothing could
       * say who changed a file. Captured from a real dispatch in a bare, non-git directory: an
       * `Edit` block carrying `file_path`, `old_string` and `new_string`, tagged with the
       * manager's `Task` id.
       */
      readonly parentToolUseId: string | null
    }
  | { readonly kind: 'user'; readonly blocks: readonly StreamBlock[] }
  /** Terminal. `isError` true covers auth failures, which arrive as a *successful* run. */
  | {
      readonly kind: 'result'
      readonly isError: boolean
      readonly text: string | null
      readonly costUsd: number | null
      readonly turns: number | null
      readonly durationMs: number | null
      /**
       * Tool calls the office was refused, and what it was trying to do.
       *
       * The one thing that answers *"why did nothing happen?"* — which is the actual pain
       * behind wanting an approval prompt. `--print` cannot ask, so a blocked call is simply
       * refused and the agent finds out by being told no; without this, so does nobody else.
       *
       * Empty on an ordinary run, and that emptiness is meaningful rather than a default.
       */
      readonly denials: readonly ToolDenial[]
      /**
       * Settings files the office could not use when it judged `denials`, and why.
       *
       * Never read from the payload, for the reason `ToolDenial.cause` is not. `ManagerSession`
       * sets it beside the causes, and only when there is at least one — see `withCauses`.
       */
      readonly unusable?: readonly UnusableSettings[]
      /**
       * Deny lists the office read short when it judged `denials`: a file it used, with an entry
       * in it that is not a rule.
       *
       * Set beside the causes for the reason `unusable` is, and only when there is at least one.
       * A refusal judged in that state gets advice about it rather than one that ends in a rule
       * to add, because while it holds no allow rule stops the office asking — see `withCauses`.
       */
      readonly shortDeny?: readonly ShortDenyList[]
    }
  /** The CLI is retrying an API call — an expired token surfaces here first. */
  /**
   * How much of the plan is left, and when it comes back.
   *
   * **The first event of every run**, and nothing read it until now. It is a better signal than
   * any budget cap we could build: a cap tells you what you have spent, this tells you *what you
   * can still do* and *when the next run will start failing* — before it fails.
   *
   * It matters more on a subscription than an API key. `total_cost_usd` on a Max plan is
   * notional — what those tokens would have cost at API rates — and no such charge ever appears
   * on the account. This is the real currency: a seven-day bucket that empties, and when it is
   * empty Claude Code stops until it resets. With overage disabled there is no way to pay past
   * it, so "how full is the bucket" is the only question worth asking.
   */
  | {
      readonly kind: 'rate-limit'
      /** e.g. `allowed`, `allowed_warning`, `out_of_credits`. Reported, never interpreted. */
      readonly status: string
      /** e.g. `five_hour`. Which bucket the CLI says is binding right now. */
      readonly window: string
      /** 0–1 for the binding window. `0.72` is 72% used. `null` means the payload did not say. */
      readonly used: number | null
      /** Unix seconds. When the binding bucket refills. */
      readonly resetsAt: number | null
      readonly usingOverage: boolean
      /**
       * Whether paying past the limit is possible at all — `rejected` when it is not.
       *
       * The difference between "you will be slowed" and "you will stop": with overage rejected
       * there is no way through, and the reset time is the only answer to *when can I work again*.
       */
      readonly overage: string
      /**
       * Every window the payload reported, binding or not.
       *
       * A plan has more than one bucket — five-hour and seven-day are both live, and the one
       * that stops you tonight is not the one that stops you this week. Reporting only the
       * binding one answers half the question.
       *
       * A window the payload did not carry is absent from this list. It is **not** a window at
       * zero, and nothing here may render it as one.
       */
      readonly windows: readonly RateWindow[]
    }
  | { readonly kind: 'retry'; readonly attempt: number; readonly status: number | null; readonly error: string | null }
  /**
   * A fragment of a reply, arriving while it is still being written.
   *
   * **Its own kind, deliberately — not a flag on `assistant`.** Agreed with the machine that
   * owns the floor before either half was built, and the argument is about how each shape
   * fails. A flag fails *open*: every call site has to remember to check it, and the one that
   * forgets animates a dispatch that has not happened yet. A separate kind fails *closed* —
   * `factsFromEvent` switches on `kind` and simply does not match this one, so the floor cannot
   * act on a fragment even by accident.
   *
   * That matters more here than anywhere else in the app. A partial is the one event in the
   * stream that is **provisional**: the model may still be mid-sentence, and text that looks
   * like a decision may not survive to the end of the block. The transcript can show it because
   * a transcript is a record of what was said. The floor may not, because the floor is a claim
   * about what is happening.
   */
  | {
      readonly kind: 'partial'
      /** Which content block, so two blocks in one message cannot interleave into one. */
      readonly index: number
      /** `text` is the reply itself. `thinking` is not rendered, but it is not discarded either. */
      readonly of: 'text' | 'thinking'
      readonly text: string
      /** Set when this fragment belongs to a subagent's turn rather than the manager's. */
      readonly parentToolUseId: string | null
    }
  /** A content block finished. The complete version arrives separately as `assistant`. */
  | { readonly kind: 'partial-end'; readonly index: number }
  /**
   * A dispatched agent actually began.
   *
   * Distinct from the `tool_use` that asked for it. `run_in_background` defaults to **true**,
   * so the dispatch's `tool_result` comes back within milliseconds carrying *"Async agent
   * launched successfully"* — a receipt, not an answer. This is the event that says the work
   * started, and it carries the same `tool_use_id`, so it maps to the employee the floor
   * already has walking to their desk.
   */
  | {
      readonly kind: 'task-started'
      readonly toolUseId: string
      readonly taskId: string
      readonly agent: string | null
      readonly description: string | null
    }
  /**
   * A dispatched agent finished, and what it actually did.
   *
   * **The real completion.** Until this arrives the employee is still working, however long ago
   * the launch receipt came back. Firing the floor's `delivered` on that receipt is what made
   * an employee walk to their desk and immediately report back while the agent was still
   * running — the floor claiming an ending that had not happened.
   *
   * Carries what the run cost, which is the only per-dispatch figure anybody gets.
   */
  | {
      readonly kind: 'task-finished'
      readonly toolUseId: string
      readonly taskId: string
      /** `completed`, or whatever else the CLI reports. Never assumed to be success. */
      readonly status: string
      /** The agent's own one-line account of what it did. */
      readonly summary: string | null
      readonly tokens: number | null
      readonly durationMs: number | null
    }
  /** Any `system` subtype we do not model. Kept so new CLI versions never silently vanish. */
  | { readonly kind: 'system'; readonly subtype: string; readonly raw: Record<string, unknown> }
  /** A line we could not read. Never dropped. */
  | { readonly kind: 'unparsed'; readonly line: string; readonly reason: string }

/**
 * The blocks in a message, keeping only the ones that are actually blocks.
 *
 * The predicate says `b is StreamBlock`, and `StreamBlock.type` is a required string — so the
 * check has to establish that much or the assertion is a promise the data has not made. It used
 * to accept anything object-shaped and non-null, which let through `{}`, and let through `[]`
 * for the same reason the line above this function once did: `typeof [] === 'object'`.
 *
 * Behaviour is unchanged today. Every reader downstream compares `block.type` against a literal,
 * so a block without one was already ignored — this stops the type saying otherwise. `capabilities.ts`
 * has had `!Array.isArray` in its own `isRecord` all along; this is the same care, three files over.
 */
function asBlocks(value: unknown): StreamBlock[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (b): b is StreamBlock =>
      typeof b === 'object' &&
      b !== null &&
      !Array.isArray(b) &&
      typeof (b as { type?: unknown }).type === 'string',
  )
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

/** A tool call the workspace's rules refused. */
export interface ToolDenial {
  readonly tool: string
  readonly toolUseId: string | null
  /** What it was going to do — the command, the path. Never a paraphrase. */
  readonly detail: string | null
  /**
   * Which of the two reasons it was refused for, when the office can establish it.
   *
   * **Never read from the payload, because the payload does not say.** The CLI's denial entry
   * is `tool_name`, `tool_use_id`, `tool_input` and nothing else — checked against the schema
   * in the installed binary rather than assumed — so a parser that produced anything but
   * `unknown` here would be inventing a fact about somebody else's data.
   *
   * `ManagerSession` fills it in afterwards by judging the command against the same
   * `.claude/settings.json` the CLI just used. That is a different claim from the CLI's and it
   * is made where the rules can actually be read, which is not here.
   */
  readonly cause: RefusalCause
  /**
   * For a `denied` call, the settings files holding a deny rule that covers it, relative to
   * `.claude/`. Filled in beside `cause`, for the same reason: the payload does not say.
   */
  readonly deniedIn?: readonly string[]
}

/**
 * One MCP server, as the CLI reported it at startup.
 *
 * `status` is the CLI's own word rather than a boolean, because "connected" and "failed" are
 * not the only things it has ever said and narrowing them here would throw away the one detail
 * somebody debugging actually wants.
 */
export interface McpStatus {
  readonly name: string
  readonly status: string
}

/**
 * Refused tool calls, from the result event.
 *
 * `tool_input` is a whole object; only the one field that says what the call was *doing* is
 * carried through, the same way the transcript summarises a tool call. Taken from the payload
 * rather than reconstructed, so what the office shows is what the CLI refused.
 */
function asDenials(value: unknown): readonly ToolDenial[] {
  if (!Array.isArray(value)) return []
  const out: ToolDenial[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const tool = typeof row['tool_name'] === 'string' ? row['tool_name'] : ''
    if (!tool) continue
    const input = (row['tool_input'] ?? {}) as Record<string, unknown>
    const detail =
      input['command'] ?? input['file_path'] ?? input['path'] ?? input['url'] ?? input['pattern']
    out.push({
      tool,
      toolUseId: typeof row['tool_use_id'] === 'string' ? row['tool_use_id'] : null,
      detail: typeof detail === 'string' ? detail : null,
      // The payload does not carry a reason, so neither does the parse. See `ToolDenial.cause`.
      cause: 'unknown',
    })
  }
  return out
}

/**
 * Read the init event's server list.
 *
 * Tolerant on purpose: this is somebody else's payload, it has gained fields before, and a
 * shape we did not expect must cost us the list rather than the whole event. An unparseable
 * entry is dropped rather than guessed at — a server reported under the wrong name would be
 * worse than one not reported at all.
 */
function asMcpServers(value: unknown): readonly McpStatus[] {
  if (!Array.isArray(value)) return []
  const out: McpStatus[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const name = row['name']
    if (typeof name !== 'string' || name === '') continue
    out.push({ name, status: typeof row['status'] === 'string' ? row['status'] : 'unknown' })
  }
  return out
}

/**
 * The token, duration, status, turn and cost numbers this file takes off the wire are checked
 * with `Number.isFinite`, not `typeof`. Not every number is: the `rate_limit_event` branch of
 * `toEvent` still reads its `utilization` and `resetsAt` fields with `typeof`, and a retry's
 * `attempt` and a partial event's `index` go through a bare `Number(…)`, which turns whatever
 * arrives into a number without checking it.
 *
 * `typeof NaN === 'number'` and `typeof Infinity === 'number'`, and JSON reaches the second of
 * those without trying: `JSON.parse('{"total_cost_usd": 1e999}')` yields `Infinity`, passes a
 * `typeof` guard, and `Infinity.toFixed(4)` is the string `"Infinity"` — so the cost line reads
 * **"$Infinity this session"**, which is money stated wrongly on screen.
 *
 * Nothing observed sends such a value. That is a fact about the version of the CLI measured this
 * week rather than about the format, and this file exists precisely because the format is
 * somebody else's. It already refuses a `type` that is not a string for the same reason; a number
 * that is not a number is the same class of surprise one field over.
 *
 * `Number.isFinite` is also the honest predicate for what these are used for. Every one is
 * displayed or added up, and neither `NaN` nor `Infinity` survives arithmetic in a form anybody
 * can read.
 */
/** Interpret one parsed JSON record. */
export function toEvent(record: Record<string, unknown>): ClaudeEvent {
  const type = record['type']

  if (type === 'system') {
    // `typeof`, not `String(… ?? '')`. The same reason as every other field here: `??` only
    // steps past null and undefined, so an object arrives as "[object Object]" and is then
    // compared against real subtype names — a comparison that can only fail, and fails
    // silently. An absent subtype is the empty string, which no branch below claims.
    const subtype = typeof record['subtype'] === 'string' ? record['subtype'] : ''

    if (subtype === 'init') {
      return {
        kind: 'init',
        // Its neighbours below already do this; this line did not, and fuzzing found it.
        // `String({})` is "[object Object]", and that string would have been written to the
        // registry, passed to `--resume`, and used to key the live-session map — a
        // conversation that exists in three places and cannot be reopened. Empty is the
        // honest answer for "no id arrived", and `run.ts` already treats it as one.
        sessionId: typeof record['session_id'] === 'string' ? record['session_id'] : '',
        model: typeof record['model'] === 'string' ? record['model'] : null,
        cwd: typeof record['cwd'] === 'string' ? record['cwd'] : null,
        tools: asStrings(record['tools']),
        agents: asStrings(record['agents']),
        mcpServers: asMcpServers(record['mcp_servers']),
      }
    }

    if (subtype === 'task_started') {
      const toolUseId = typeof record['tool_use_id'] === 'string' ? record['tool_use_id'] : ''
      if (toolUseId) {
        return {
          kind: 'task-started',
          toolUseId,
          taskId: typeof record['task_id'] === 'string' ? record['task_id'] : '',
          agent: typeof record['subagent_type'] === 'string' ? record['subagent_type'] : null,
          description: typeof record['description'] === 'string' ? record['description'] : null,
        }
      }
    }

    if (subtype === 'task_notification') {
      const toolUseId = typeof record['tool_use_id'] === 'string' ? record['tool_use_id'] : ''
      if (toolUseId) {
        const usage = (record['usage'] ?? {}) as Record<string, unknown>
        return {
          kind: 'task-finished',
          toolUseId,
          taskId: typeof record['task_id'] === 'string' ? record['task_id'] : '',
          // Reported, not interpreted. A task that failed is not a task that finished, and this
          // module is not the place to decide which of those a caller cares about.
          status: typeof record['status'] === 'string' && record['status'] ? record['status'] : 'unknown',
          summary: typeof record['summary'] === 'string' ? record['summary'] : null,
          tokens: Number.isFinite(usage['total_tokens']) ? (usage['total_tokens'] as number) : null,
          durationMs: Number.isFinite(usage['duration_ms']) ? (usage['duration_ms'] as number) : null,
        }
      }
    }

    if (subtype === 'api_retry') {
      return {
        kind: 'retry',
        attempt: Number(record['attempt'] ?? 0),
        status: Number.isFinite(record['error_status']) ? (record['error_status'] as number) : null,
        error: typeof record['error'] === 'string' ? record['error'] : null,
      }
    }

    return { kind: 'system', subtype, raw: record }
  }

  // Only present with `--include-partial-messages`. Everything here is provisional: the
  // authoritative version of the same content arrives afterwards as a complete `assistant`
  // event, which is what the floor and the transcript's final state are built from.
  if (type === 'stream_event') {
    const event = (record['event'] ?? {}) as Record<string, unknown>
    const eventType = event['type']

    if (eventType === 'content_block_delta') {
      const delta = (event['delta'] ?? {}) as Record<string, unknown>
      const index = Number(event['index'] ?? 0)
      const parentToolUseId =
        typeof record['parent_tool_use_id'] === 'string' ? record['parent_tool_use_id'] : null

      if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
        return { kind: 'partial', index, of: 'text', text: delta['text'], parentToolUseId }
      }
      if (delta['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
        return { kind: 'partial', index, of: 'thinking', text: delta['thinking'], parentToolUseId }
      }
    }

    if (eventType === 'content_block_stop') {
      return { kind: 'partial-end', index: Number(event['index'] ?? 0) }
    }

    // message_start, message_delta, message_stop and any delta shape we do not render. Kept as
    // `system` rather than dropped, because a record we chose not to interpret is not the same
    // as one that was not there.
    return { kind: 'system', subtype: `stream_event/${String(eventType ?? 'unknown')}`, raw: record }
  }

  if (type === 'rate_limit_event') {
    const info = (record['rate_limit_info'] ?? {}) as Record<string, unknown>

    /*
     * `utilization` is not where this used to look for it.
     *
     * The parser read `info['utilization']`, and the test beside it passed a fixture with
     * exactly that key — so the code and its test agreed, and both were wrong about the CLI.
     * Captured from a real run on 2026-09-01, the number lives one level down, per window:
     *
     *     "unifiedWindows": {
     *       "five_hour": { "utilization": 0.72, "resetsAt": 1788253800 },
     *       "seven_day": { "utilization": 0.07, "resetsAt": 1788836400 }
     *     }
     *
     * So `used` was `null` on **every run since this was written**, and the one number worth
     * having — how full the plan is — read as "we do not know" while sitting in the same object.
     *
     * The flat key is still read as a fallback rather than deleted: it costs one `??` and a CLI
     * that sends the older shape keeps working. Guessing which version somebody has installed is
     * not this parser's job.
     */
    const unified = (info['unifiedWindows'] ?? {}) as Record<string, unknown>
    const windows: RateWindow[] = []
    for (const [name, raw] of Object.entries(unified)) {
      const w = (raw ?? {}) as Record<string, unknown>
      windows.push({
        name,
        used: typeof w['utilization'] === 'number' ? w['utilization'] : null,
        resetsAt: typeof w['resetsAt'] === 'number' ? w['resetsAt'] : null,
      })
    }

    const binding = String(info['rateLimitType'] ?? 'unknown')
    const bound = windows.find((w) => w.name === binding)

    return {
      kind: 'rate-limit',
      status: String(info['status'] ?? 'unknown'),
      window: binding,
      used: bound?.used ?? (typeof info['utilization'] === 'number' ? info['utilization'] : null),
      resetsAt: bound?.resetsAt ?? (typeof info['resetsAt'] === 'number' ? info['resetsAt'] : null),
      usingOverage: info['isUsingOverage'] === true,
      overage: String(info['overageStatus'] ?? 'unknown'),
      windows,
    }
  }

  if (type === 'assistant') {
    const message = (record['message'] ?? {}) as Record<string, unknown>
    return {
      kind: 'assistant',
      blocks: asBlocks(message['content']),
      model: typeof message['model'] === 'string' ? message['model'] : null,
      // Absent on the manager's own turns, and that absence is meaningful — it is the difference
      // between "the manager did this" and "somebody it dispatched did". Never defaulted.
      parentToolUseId: typeof record['parent_tool_use_id'] === 'string' ? record['parent_tool_use_id'] : null,
    }
  }

  if (type === 'user') {
    const message = (record['message'] ?? {}) as Record<string, unknown>
    const content = message['content']
    // A user turn is either a plain string (the person typed something) or blocks (tool
    // results being fed back). Normalise to blocks so callers have one shape to handle.
    if (typeof content === 'string') {
      return { kind: 'user', blocks: [{ type: 'text', text: content }] }
    }
    return { kind: 'user', blocks: asBlocks(content) }
  }

  if (type === 'result') {
    return {
      kind: 'result',
      denials: asDenials(record['permission_denials']),
      // Note: an expired token produces `is_error: true` on an otherwise *successful*
      // process exit. Trusting the exit code alone reports failures as successes.
      isError: record['is_error'] === true,
      text: typeof record['result'] === 'string' ? record['result'] : null,
      costUsd: Number.isFinite(record['total_cost_usd']) ? (record['total_cost_usd'] as number) : null,
      turns: Number.isFinite(record['num_turns']) ? (record['num_turns'] as number) : null,
      durationMs: Number.isFinite(record['duration_ms']) ? (record['duration_ms'] as number) : null,
    }
  }

  return { kind: 'system', subtype: String(type ?? 'unknown'), raw: record }
}

/**
 * Accumulates stdout chunks and emits whole events.
 *
 * Feed it whatever the process hands you, in whatever sizes it arrives. The parser holds the
 * trailing partial line until its newline turns up. Call {@link end} when the stream closes so
 * a final unterminated line is still surfaced rather than lost in the buffer.
 */
export class StreamParser {
  private buffer = ''

  /** Push a chunk. Returns every event completed by it — often none, sometimes several. */
  push(chunk: string): ClaudeEvent[] {
    this.buffer += chunk
    const events: ClaudeEvent[] = []

    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      const event = this.parseLine(line)
      if (event) events.push(event)
      newline = this.buffer.indexOf('\n')
    }

    return events
  }

  /**
   * Flush whatever is left when the stream ends.
   *
   * The CLI usually terminates its last line, but a process killed mid-write does not — and
   * that half-written line is exactly the evidence you want when diagnosing why.
   */
  end(): ClaudeEvent[] {
    const remainder = this.buffer
    this.buffer = ''
    const event = remainder.trim() ? this.parseLine(remainder) : null
    return event ? [event] : []
  }

  private parseLine(line: string): ClaudeEvent | null {
    const trimmed = line.trim()
    if (!trimmed) return null

    let record: unknown
    try {
      record = JSON.parse(trimmed)
    } catch (err) {
      return {
        kind: 'unparsed',
        line: trimmed.slice(0, 2000),
        reason: err instanceof Error ? err.message : String(err),
      }
    }

    // `Array.isArray` as well, and it is not belt and braces. `typeof [] === 'object'` and an
    // array is not null, so the two checks above let one straight through — it was cast to a
    // record, handed to `toEvent`, found to have no `type`, and came back as a **system event**.
    // A line the parser cannot read reported as a kind of line it can is the exact failure this
    // module's header says it exists to prevent, arrived at by the oldest trap in the language.
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      return { kind: 'unparsed', line: trimmed.slice(0, 2000), reason: 'not a JSON object' }
    }

    return toEvent(record as Record<string, unknown>)
  }
}
