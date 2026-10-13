/**
 * Asides — asking an agent about itself without disturbing it.
 *
 * Click an employee on the floor and a bubble appears: what they are doing, which step they
 * are on, how it is going. Then you can ask a follow-up. All of that has to happen **without
 * touching the work in progress** — a status question that becomes part of the conversation
 * changes the thing it was measuring, and an agent that gets interrupted to explain itself is
 * an agent that stops working.
 *
 * The mechanism is `claude --resume <id> --fork-session`. The fork inherits the entire
 * conversation and writes to a *new* session id, so the original transcript never grows.
 *
 * `test/aside.test.ts` holds that to the flags: it runs the real adapter against a stand-in
 * binary that records the argv it was given, and asserts `--fork-session`, `--tools ""` and the
 * cheap model are all actually passed. What it does not do is prove Claude's own behaviour
 * given those flags — that was checked by hand against a live session on 2026-08-18. The two
 * halves are different claims and this comment used to blur them.
 *
 * Two deliberate constraints:
 *
 *   **No tools.** An aside answers from context it already has. Letting it read files or run
 *   commands would make a status check into an action with a cost and a blast radius, and a
 *   question about work should never become work.
 *
 *   **A cheap model.** These fire on every click. Status is a summarisation task, not a
 *   reasoning one, so it runs on Haiku unless the caller says otherwise.
 */

import { runClaude } from './run.js'
import { track } from '../children.js'
import type { ClaudeEvent } from './stream.js'

/** Model for asides. Fast and cheap — they fire on every click. */
export const ASIDE_MODEL = 'claude-haiku-4-5'

export interface AsideRequest {
  /** Working directory of the session being asked about. */
  readonly cwd: string
  /** The session to fork. */
  readonly sessionId: string
  readonly question: string
  readonly model?: string
  readonly claudePath?: string
}

export interface AsideAnswer {
  readonly text: string
  /**
   * Where the fork landed. Different from the session asked about — that difference *is* the
   * guarantee that the original was not modified.
   */
  readonly forkedSessionId: string | null
  readonly costUsd: number | null
  readonly isError: boolean
}

/** Ask a question about a session, leaving that session untouched. */
export async function askAside(request: AsideRequest): Promise<AsideAnswer> {
  const chunks: string[] = []
  let forkedSessionId: string | null = null
  let resultText: string | null = null

  const handle = runClaude(
    {
      cwd: request.cwd,
      prompt: request.question,
      resume: request.sessionId,
      fork: true,
      tools: [], // answer from context; never act
      // Through `extraArgs` rather than `controls`, and that is the honest shape: `controls`
      // are the user's dials on their conversation, and this is not their conversation. An
      // aside is a fork the office spends its own money on to answer a click, so it pins a
      // cheap model regardless of what the chat is set to.
      extraArgs: ['--model', request.model ?? ASIDE_MODEL],
      ...(request.claudePath ? { claudePath: request.claudePath } : {}),
    },
    (event: ClaudeEvent) => {
      if (event.kind === 'init') forkedSessionId = event.sessionId
      if (event.kind === 'assistant') {
        for (const block of event.blocks) {
          if (block.type === 'text' && block.text) chunks.push(block.text)
        }
      }
      if (event.kind === 'result' && event.text) resultText = event.text
    },
  )

  /*
   * Registered, so quit can stop it.
   *
   * `children.ts` describes itself as the one list every child is added to — *"the only
   * arrangement where 'did we get them all' is a question with an answer"*. It was not. Three of
   * the four `runClaude` callers never registered, so an aside in flight when you closed the
   * office carried on running and spending with nothing left on screen to show it, which is the
   * exact failure that module was written to prevent, in the module written to prevent it.
   *
   * `track` and not `admit`: this does not take a seat at the cap. An aside is a click on a
   * person's head, and refusing one because twelve turns are mid-answer would make the floor
   * stop answering at the moment there is most to look at. It is registered so quit stops it and
   * `liveChildren()` names it; it is not rationed.
   */
  const untrack = track({ what: `aside (${request.sessionId.slice(0, 8)})`, stop: () => handle.kill() })

  let summary: Awaited<typeof handle.done>
  try {
    summary = await handle.done
  } finally {
    untrack()
  }

  return {
    // Prefer streamed assistant text; fall back to the result field, which is where an error
    // message lands when the run never produced a turn.
    text: (chunks.join('').trim() || resultText || '').trim(),
    forkedSessionId,
    costUsd: summary.costUsd,
    isError: summary.isError,
  }
}

/**
 * The standard status question behind an employee's speech bubble.
 *
 * The wording is doing real work. It asks for plain language and forbids hedging, because the
 * answer is rendered in a small bubble above a character's head where nobody will read three
 * sentences. It also explicitly permits "I don't know" — a status report that invents progress
 * is worse than no bubble at all, and this is the office rule that nothing on screen may lie,
 * applied at the point where a model would otherwise be tempted to sound busy.
 */
export const STATUS_QUESTION = [
  'Briefly, for a status bubble on a dashboard:',
  'What are you working on right now, and which step are you on?',
  '',
  'Answer in at most two short sentences of plain language.',
  'No preamble, no markdown, no bullet points.',
  'Describe only what you have actually done or are actually doing —',
  'if you are between tasks or unsure, say exactly that.',
].join('\n')

export function askStatus(
  request: Omit<AsideRequest, 'question'>,
): Promise<AsideAnswer> {
  return askAside({ ...request, question: STATUS_QUESTION })
}

/**
 * The status question for a *subagent*, asked of the session that dispatched it.
 *
 * Subagents do not have their own resumable sessions, so there is nothing of theirs to fork.
 * What does exist is the manager's transcript, which contains the dispatch, the brief, and
 * whatever has come back — so that is where the question goes, and the answer is drawn from a
 * real record rather than from the floor's own animation.
 *
 * The limits of that record are stated in the prompt rather than papered over. The manager
 * genuinely cannot see inside a subagent that is still running, and must say so instead of
 * describing what it imagines is happening in there.
 *
 * ## A case where the manager is honestly wrong
 *
 * A turn that was interrupted mid-dispatch ends with a `tool_use` and no result. Resuming such
 * a conversation drops that dangling call — it is not a state the API will accept — so the
 * manager comes back genuinely unable to see a dispatch that is sitting in its own transcript
 * on disk. Asked about that employee, it will say it never dispatched them, and it is not
 * lying: that is what its context now contains.
 *
 * This is why the agent card reads the employee's **own record** rather than asking the
 * manager about them (`subagents.ts`). The record survives the interruption that the manager's
 * memory does not, and the two disagreeing is a case the office is built to get right rather
 * than a contradiction to explain away.
 */
export function statusQuestionFor(agent: string): string {
  return [
    `Briefly, for a status bubble on a dashboard: what is the ${agent} subagent doing?`,
    '',
    'Answer in at most two short sentences of plain language.',
    'No preamble, no markdown, no bullet points.',
    '',
    'Base this only on what is in this conversation: the task you gave them and anything',
    'they have reported back. You cannot see inside a subagent while it runs — if it has not',
    'reported yet, say that it is still working and what you asked it for. If you never',
    `dispatched ${agent}, say exactly that. Do not describe work you are guessing at.`,
  ].join('\n')
}
