/**
 * The digest — deciding what is worth saying out loud.
 *
 * An office that reads every event aloud is unusable within ninety seconds. The speech is the
 * easy half of talking; the hard half, and the whole product, is the **filter**. So the
 * default answer here is silence, and everything is arranged so that silence is also the
 * cheapest answer.
 *
 * Two stages, in this order for a reason:
 *
 *   **1. The gate — free, local, instant.** Nothing about "did anything happen at all" needs a
 *   language model. {@link notable} throws away file reads, searches, edits and ordinary
 *   commands, and if nothing survives, nothing is spoken and no request is made. On a normal
 *   working session this is what happens almost every time.
 *
 *   **2. The editorial pass — Claude, once there is something to weigh.** Judging whether a
 *   finished task is worth interrupting a person for is a judgement call, and that is what a
 *   model is for. It runs on Haiku with no tools, and it is told in as many words that saying
 *   nothing is a good answer.
 *
 * The honesty rule from the status bubble applies here too, and harder — a bubble you chose to
 * read is one thing, a voice that speaks unbidden is another. The digest may only say what is
 * in the events it was given. It may not infer that something finished because it looks like
 * it probably did.
 */

import { runClaude } from '../claude/run.js'
import { track } from '../children.js'
import { isDelegationTool } from '../../shared/delegation.js'
import type { Quiet } from '../../shared/ipc.js'
import type { ClaudeEvent } from '../claude/stream.js'

/** Cheap and fast. Editing a list down to one sentence is not a reasoning task. */
export const DIGEST_MODEL = 'claude-haiku-4-5'

/** The exact reply that means "do not speak". Checked for, so it has to be unmistakable. */
const SILENCE = 'SILENCE'

export type MomentKind =
  /** The manager handed work to someone. */
  | 'dispatched'
  /** Something came back finished. */
  | 'finished'
  /** Something went wrong. */
  | 'failed'
  /** Nothing is running; you are the blocker. */
  | 'awaiting-you'
  /** An ordinary tool call. Never notable on its own. */
  | 'acted'

export interface Moment {
  readonly kind: MomentKind
  readonly who: string
  readonly detail: string
}

/**
 * The local gate.
 *
 * `acted` is dropped wholesale. It is not that individual tool calls are uninteresting — they
 * are what the floor animates, and they are why the office looks alive — but watching someone
 * work is very different from being told about it. Nobody needs a voice narrating each file
 * that gets opened.
 */
export function notable(moments: readonly Moment[]): Moment[] {
  return moments.filter((m) => m.kind !== 'acted')
}

export interface DigestRequest {
  readonly moments: readonly Moment[]
  /**
   * Where to run. Note this loads the project's `CLAUDE.md` like any other run — one more
   * reason the gate above exists, so that a quiet session costs nothing at all.
   */
  readonly cwd: string
  readonly model?: string
  readonly claudePath?: string
}

export interface Spoken {
  /** False means say nothing. The common case, and not a failure. */
  readonly speak: boolean
  readonly text: string
  readonly costUsd: number | null
  /** True when the gate answered without asking Claude. */
  readonly free: boolean
  /**
   * Why nothing is being said, when that is worth a person knowing.
   *
   * Absent for the gate's own silence, which happens on nearly every turn and means only that
   * ordinary work is proceeding. Present for the two silences that are decisions or faults —
   * because before this they were the same silence as a broken voice, and telling them apart
   * required reading the code.
   */
  readonly quiet?: Quiet
}

const QUIET: Spoken = { speak: false, text: '', costUsd: null, free: true }

export const DIGEST_PROMPT = [
  'You are the voice of an office of AI agents, speaking aloud to the one person in charge.',
  'Below is everything notable that happened since you last spoke.',
  '',
  'Speech interrupts a person. Earn it.',
  '',
  'Worth saying out loud:',
  '  - something finished, and what came of it',
  '  - something failed, is stuck, or needs them to decide',
  '  - they are the one being waited on',
  '',
  'Not worth saying:',
  '  - that work is proceeding normally',
  '  - individual files read, edited, or searched',
  '  - anything they can already see happening',
  '',
  `If nothing below clears that bar, reply with exactly: ${SILENCE}`,
  '',
  'Otherwise reply with at most two short sentences, as you would say them to someone',
  'across a room. No markdown, no lists, no preamble, no sign-off.',
  '',
  'Say only what the events below actually state. If they do not clearly show that',
  `something finished, do not say that it finished — reply ${SILENCE} instead.`,
].join('\n')

/** Decide what to say, and say nothing whenever that is the honest answer. */
export async function digest(request: DigestRequest): Promise<Spoken> {
  const worth = notable(request.moments)
  if (worth.length === 0) return QUIET

  const prompt = [
    DIGEST_PROMPT,
    '',
    '--- events ---',
    ...worth.map((m) => `${m.kind}: ${m.who} — ${m.detail}`),
  ].join('\n')

  const chunks: string[] = []
  const handle = runClaude(
    {
      cwd: request.cwd,
      prompt,
      tools: [], // it summarises what it was handed; it has no business reading anything
      // Through `extraArgs` rather than `controls` for the same reason the aside does it: the
      // user's dials belong to the user's conversation, and this is the office talking to
      // itself about what it just watched. It pays for a cheap model whatever the chat is set to.
      extraArgs: ['--model', request.model ?? DIGEST_MODEL],
      ...(request.claudePath ? { claudePath: request.claudePath } : {}),
    },
    (event: ClaudeEvent) => {
      if (event.kind !== 'assistant') return
      for (const block of event.blocks) {
        if (block.type === 'text' && block.text) chunks.push(block.text)
      }
    },
  )

  // `runClaude` rejects when the process cannot be spawned at all — a `claudePath` that is not
  // there, a binary that dies before it says anything. That rejection used to travel up into
  // `void listen(...)` in main, where it was swallowed, and the office simply stopped having a
  // voice with nothing anywhere saying so. Exactly the silence this file now exists to name, in
  // its worst form: permanent, and invisible.
  // Registered for the same reason the aside is: `stopAll()` at quit only reaches children that
  // are on the list, and this one was not on it. A digest is short, but "short" is not a
  // guarantee — it is a `claude` process, and the one that outlives the window is the one that
  // was slow.
  const untrack = track({ what: 'voice digest', stop: () => handle.kill() })

  let summary: Awaited<typeof handle.done>
  try {
    summary = await handle.done
  } catch {
    return { speak: false, text: '', costUsd: null, free: false, quiet: 'failed' }
  } finally {
    untrack()
  }

  const text = chunks.join('').trim()

  // A failed run says nothing rather than speaking an error message aloud. The failure still
  // belongs on screen — but a voice announcing its own plumbing is worse than a quiet office.
  // `quiet` is how it gets on screen without being spoken.
  if (summary.isError) {
    return { speak: false, text: '', costUsd: summary.costUsd, free: false, quiet: 'failed' }
  }

  if (isSilence(text)) {
    return { speak: false, text: '', costUsd: summary.costUsd, free: false, quiet: 'judged' }
  }

  return { speak: true, text, costUsd: summary.costUsd, free: false }
}

/**
 * Recognise a refusal to speak.
 *
 * Tolerant on purpose. A model that has decided to stay quiet has decided correctly, and
 * treating `"SILENCE."` as a two-syllable utterance to read aloud would be a ridiculous way to
 * lose that. Anything that is only the sentinel, however punctuated, is silence.
 */
function isSilence(text: string): boolean {
  return text.replace(/[.!\s]/g, '').toUpperCase() === SILENCE || text.length === 0
}

// ──────────────────────────────────────────────────── turning a stream into moments ──

/** Track dispatches so a result can be reported as *whose* result. */
export class MomentRecorder {
  private readonly dispatched = new Map<string, string>()

  constructor(private readonly manager: string) {}

  /** Moments worth remembering from one event. Usually none. */
  observe(event: ClaudeEvent, speaker: string = this.manager): Moment[] {
    if (event.kind === 'result') {
      return event.isError
        ? [{ kind: 'failed', who: speaker, detail: event.text ?? 'the run failed' }]
        : [{ kind: 'awaiting-you', who: speaker, detail: 'finished and is waiting on you' }]
    }

    if (event.kind === 'retry') {
      return [{ kind: 'failed', who: speaker, detail: `retrying after ${event.status ?? 'an error'}` }]
    }

    if (event.kind !== 'assistant' && event.kind !== 'user') return []

    const out: Moment[] = []
    for (const block of event.blocks) {
      if (block.type === 'tool_use' && block.name && isDelegationTool(block.name) && block.id) {
        const to = block.input?.['subagent_type']
        if (typeof to === 'string') {
          this.dispatched.set(block.id, to)
          const what = block.input?.['description']
          out.push({
            kind: 'dispatched',
            who: to,
            detail: typeof what === 'string' ? what : 'a task',
          })
          continue
        }
      }

      if (block.type === 'tool_use' && block.name) {
        out.push({ kind: 'acted', who: speaker, detail: block.name })
      }

      if (block.type === 'tool_result' && block.tool_use_id) {
        const who = this.dispatched.get(block.tool_use_id)
        // Only a *subagent's* result is a finished piece of work. Every other tool result is
        // a file coming back, which is not news.
        if (who) {
          this.dispatched.delete(block.tool_use_id)
          out.push({ kind: 'finished', who, detail: firstLine(block.content) })
        }
      }
    }
    return out
  }
}

function firstLine(content: unknown): string {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((c) => (typeof c === 'object' && c && 'text' in c ? String(c.text) : ''))
            .join(' ')
        : ''
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > 200 ? `${line.slice(0, 200)}…` : line || 'finished'
}
