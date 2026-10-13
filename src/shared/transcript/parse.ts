/**
 * Transcript parsing.
 *
 * The chat panel is a **window onto the real Claude session**, not a chat app with its own
 * message model. What you see in Office Space is what you would see in the terminal or in VS
 * Code, because it is literally the same conversation, read from the same place Claude Code
 * writes it.
 *
 * This module turns a session's JSONL into a timeline the UI can render, and nothing more. It
 * does not summarise, reorder, or editorialise. If a record is unreadable, it becomes a visible
 * entry saying so — never a silently skipped line, because a transcript that quietly drops what
 * it could not parse is a transcript that lies about what happened.
 */

// ─────────────────────────────────────────────────────────────── raw records ──

/** A `tool_use` block, as Claude emits it. */
export interface ToolUseBlock {
  readonly type: 'tool_use'
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

/** A `tool_result` block, carried on the following user turn. */
export interface ToolResultBlock {
  readonly type: 'tool_result'
  readonly tool_use_id: string
  readonly content: unknown
  readonly is_error?: boolean
}

export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/** Extended thinking. `signature` is opaque and must never be shown or altered. */
export interface ThinkingBlock {
  readonly type: 'thinking'
  readonly thinking: string
  readonly signature?: string
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock

/** One line of the JSONL, before interpretation. */
export interface TranscriptRecord {
  readonly type: string
  readonly uuid?: string
  readonly parentUuid?: string | null
  readonly timestamp?: string
  readonly sessionId?: string
  /** True for subagent work. Excluded from the main thread. */
  readonly isSidechain?: boolean
  readonly cwd?: string
  readonly gitBranch?: string
  readonly message?: {
    readonly role?: string
    readonly model?: string
    readonly content?: string | ContentBlock[]
    readonly usage?: Record<string, unknown>
  }
  readonly attachment?: Record<string, unknown>
  readonly [key: string]: unknown
}

// ───────────────────────────────────────────────────────────────── timeline ──

interface Base {
  readonly uuid: string
  readonly timestamp: string | null
}

export type TimelineEntry =
  | (Base & { readonly kind: 'user'; readonly text: string })
  /**
   * A slash command the user ran.
   *
   * Its own kind rather than a user message, because a command is not what somebody typed and
   * showing it as though it were is the third standing order broken in the transcript itself.
   * The CLI expands a command into two records — a marker naming it, then the whole command
   * body — and both arrive tagged `type: 'user'`. Rendered naively you get two speech bubbles
   * attributed to a person who typed eight characters.
   */
  | (Base & { readonly kind: 'command'; readonly name: string; readonly args: string })
  | (Base & { readonly kind: 'assistant'; readonly text: string; readonly model: string | null })
  | (Base & { readonly kind: 'thinking'; readonly text: string })
  | (Base & {
      readonly kind: 'tool'
      readonly toolUseId: string
      readonly name: string
      readonly input: Record<string, unknown>
      /** Null while the call is still in flight — genuinely different from an empty result. */
      readonly result: string | null
      /**
       * When the result came back, which is not when the call went out.
       *
       * A `tool_use` and its `tool_result` are two records that can be minutes apart, and this
       * module merges them into one entry sitting at the *call's* position — so `timestamp` is
       * the call's and nothing else here remembers the ending's. Anything that reports on the
       * ending would otherwise have to stamp it with the start's clock, which is a **wrong**
       * time on screen rather than a missing one. The activity strip rebuilding its log from a
       * restored transcript is the reader that needs this.
       *
       * Absent while the call is unsettled; null when the result's record carried no time.
       */
      readonly resultTimestamp?: string | null
      readonly isError: boolean
      readonly settled: boolean
    })
  /** A line we could not read. Surfaced, never swallowed. */
  | (Base & { readonly kind: 'unreadable'; readonly reason: string; readonly raw: string })

export interface Transcript {
  readonly sessionId: string | null
  readonly cwd: string | null
  readonly entries: readonly TimelineEntry[]
  /** Records that were valid JSON but carry nothing renderable (titles, queue ops, hooks). */
  readonly skipped: number
  readonly unreadable: number
}

// ─────────────────────────────────────────────────────────────────── parsing ──

/**
 * Flatten a `tool_result.content` into display text. It may be a string or a block array.
 *
 * `String(b.text)` was doing the reading, and `String` never fails — so a block arriving as
 * `{ type: 'text', text: undefined }` produced the literal word "undefined" and `.filter(Boolean)`
 * kept it, because a non-empty string is truthy however little it means. `{ text: {…} }` gave
 * "[object Object]" the same way.
 *
 * This is the **restored** transcript — what a conversation looks like when the app is reopened —
 * and `chat-view.ts`'s `flatten` is the live one. The same fault sat in both, which is the whole
 * argument for fixing it in both at once: a reader who saw only one path would have concluded the
 * other was fine.
 *
 * Only a string is text. A part whose `text` is anything else contributes nothing, rather than a
 * rendering of its own type name in a transcript somebody is reading as a record of what happened.
 */
function resultToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b !== 'object' || b === null) return ''
        const text = (b as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content == null) return ''
  // Not a string and not blocks: show the shape rather than nothing, because a tool result that
  // arrived and rendered as empty is indistinguishable from one that never came.
  return JSON.stringify(content)
}

/** Records that carry no conversational content. Counted, not rendered, never an error. */
const NON_CONVERSATIONAL = new Set([
  'queue-operation',
  'last-prompt',
  'custom-title',
  'frame-link',
  'attachment',
  'system',
])

export interface ParseOptions {
  /** Include subagent (sidechain) records. Off by default — the chat shows the main thread. */
  readonly includeSidechain?: boolean
}

/**
 * Whether a user record is really a slash command's marker.
 *
 * The CLI writes `<command-message>`, `<command-name>` and `<command-args>` tags into a record
 * tagged as the user's. Matching on the tags rather than on a leading slash is deliberate: a
 * person can legitimately type a message that starts with one, and a person's message is not a
 * command just because it looks like the CLI's own bookkeeping.
 */
function asCommand(text: string): { name: string; args: string } | null {
  const name = /<command-name>\s*\/?([^<]*)<\/command-name>/.exec(text)
  if (!name) return null
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)
  return { name: (name[1] ?? '').trim(), args: (args?.[1] ?? '').trim() }
}

/**
 * Parse a session transcript into a renderable timeline.
 *
 * Tool calls are paired with their results: a `tool_use` becomes one entry whose `result` is
 * filled in when the matching `tool_result` arrives on a later turn. An unsettled call — the
 * agent is still working — keeps `result: null` and `settled: false`, which is what lets the
 * UI show a spinner rather than an empty box. Those two states must not collapse into one.
 */
export function parseTranscript(jsonl: string, options: ParseOptions = {}): Transcript {
  const includeSidechain = options.includeSidechain ?? false

  const entries: TimelineEntry[] = []
  const pendingTools = new Map<string, number>() // tool_use_id → index in `entries`
  let sessionId: string | null = null
  let cwd: string | null = null
  let skipped = 0
  // Set when a slash command's marker has just been seen, so the expansion that follows it —
  // the command's whole body, arriving tagged as the user's — can be dropped rather than shown
  // as something the user typed.
  let expandingCommand = false
  let unreadable = 0
  let lineNo = 0

  for (const rawLine of jsonl.split('\n')) {
    const line = rawLine.trim()
    lineNo++
    if (!line) continue

    let record: TranscriptRecord
    try {
      record = JSON.parse(line) as TranscriptRecord
    } catch (err) {
      unreadable++
      entries.push({
        kind: 'unreadable',
        uuid: `unreadable-${lineNo}`,
        timestamp: null,
        reason: err instanceof Error ? err.message : String(err),
        raw: line.slice(0, 500),
      })
      continue
    }

    sessionId ??= record.sessionId ?? null
    cwd ??= record.cwd ?? null

    if (record.isSidechain && !includeSidechain) {
      skipped++
      continue
    }

    if (NON_CONVERSATIONAL.has(record.type)) {
      skipped++
      continue
    }

    const uuid = record.uuid ?? `line-${lineNo}`
    const timestamp = record.timestamp ?? null
    const content = record.message?.content

    // A plain-string user turn: the person typed something.
    if (record.type === 'user' && typeof content === 'string') {
      const command = asCommand(content)
      if (command) {
        entries.push({ kind: 'command', uuid, timestamp, ...command })
        expandingCommand = true
        continue
      }
      // The expansion that follows the marker: the command's own body, arriving as though the
      // user had typed the whole file. Dropped rather than rendered — the entry above already
      // says what was run, and the body is instructions to the model, not conversation.
      if (expandingCommand) {
        expandingCommand = false
        continue
      }
      entries.push({ kind: 'user', uuid, timestamp, text: content })
      continue
    }

    if (!Array.isArray(content)) {
      skipped++
      continue
    }

    for (const block of content) {
      if (!block || typeof block !== 'object') continue

      switch (block.type) {
        case 'text': {
          const text = block.text ?? ''
          if (!text.trim()) break
          entries.push(
            record.type === 'user'
              ? { kind: 'user', uuid, timestamp, text }
              : { kind: 'assistant', uuid, timestamp, text, model: record.message?.model ?? null },
          )
          break
        }

        case 'thinking': {
          // `signature` is deliberately dropped — it is opaque, it is large, and it has no
          // business reaching the renderer.
          entries.push({ kind: 'thinking', uuid, timestamp, text: block.thinking ?? '' })
          break
        }

        case 'tool_use': {
          pendingTools.set(block.id, entries.length)
          entries.push({
            kind: 'tool',
            uuid,
            timestamp,
            toolUseId: block.id,
            name: block.name,
            input: block.input ?? {},
            result: null,
            isError: false,
            settled: false,
          })
          break
        }

        case 'tool_result': {
          const index = pendingTools.get(block.tool_use_id)
          if (index === undefined) {
            // A result whose call we never saw — a resumed session that begins mid-turn. Show
            // it rather than dropping it; a missing call is information, not noise.
            entries.push({
              kind: 'tool',
              uuid,
              timestamp,
              toolUseId: block.tool_use_id,
              name: '(call not in transcript)',
              input: {},
              result: resultToText(block.content),
              resultTimestamp: timestamp,
              isError: block.is_error === true,
              settled: true,
            })
            break
          }
          const call = entries[index]
          if (call?.kind === 'tool') {
            entries[index] = {
              ...call,
              result: resultToText(block.content),
              // The *result* record's timestamp, not the call's. See `resultTimestamp` above.
              resultTimestamp: timestamp,
              isError: block.is_error === true,
              settled: true,
            }
          }
          pendingTools.delete(block.tool_use_id)
          break
        }
      }
    }
  }

  return { sessionId, cwd, entries, skipped, unreadable }
}
