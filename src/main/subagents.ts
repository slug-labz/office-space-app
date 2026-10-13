/**
 * What an employee actually did.
 *
 * Dispatch work to `frontend` and the manager's transcript records two things: that the work
 * was handed over, and what came back. Everything in between — the reading, the decisions, the
 * commands, the file the employee actually wrote — happens somewhere else entirely and was
 * invisible to the office.
 *
 * That is the wrong half to be missing. The floor's whole promise is that you can see the work,
 * and the vision's reason for the agent card is to skip having to read a raw chat session. An
 * office that can only report the summary its employee chose to give is an office taking that
 * employee's word for it — which the second standing order says not to do.
 *
 * ## Where it lives
 *
 * Claude Code files a subagent's run beside its parent session:
 *
 *     ~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.jsonl
 *     ~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.meta.json
 *
 * The sidecar names the agent, the brief it was given, and the `tool_use` id it came from —
 * which is the same id the floor already uses to walk that character into the manager's office
 * and back. So a run on disk and a walk on the floor are the same event, and can be shown as
 * one thing.
 *
 * ## The rule
 *
 * A run we could not read is **not** an employee who did nothing. Every failure below is
 * reported as a failure, because "they did nothing" is a claim about somebody's work and we
 * would be making it up.
 *
 * That holds for a run we cannot *attach* to an employee too: those come back in `skipped` rather
 * than simply being absent from `runs`, because a caller answering about the whole workspace has
 * to be able to say what it did not open.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { locateTranscript } from './transcript-store.js'

const SUBAGENTS = 'subagents'
const META = '.meta.json'
const RUN = '.jsonl'

/** One dispatch, as recorded on disk. */
export interface SubagentRun {
  /** Which employee. Matches `subagent_type` on the dispatch, and the name on the floor. */
  readonly agentType: string
  /** The brief, as the manager wrote it. */
  readonly description: string
  /** The dispatch this came from. The same id the floor choreographs against. */
  readonly toolUseId: string
  /** The raw JSONL of everything they did. Parsed by the caller. */
  readonly jsonl: string
  /** When the run last changed. Used to pick the most recent. */
  readonly at: number
}

/**
 * A run we listed and could not use. Which employee's it was is the thing we could not establish,
 * so this names the file instead — which is what a person can go and look at.
 */
export interface SkippedRun {
  /** The run's file name, `agent-<id>.jsonl`. */
  readonly run: string
  readonly cause: string
}

export type SubagentScan =
  | {
      readonly state: 'ok'
      readonly runs: readonly SubagentRun[]
      /** Runs in this directory that are not in `runs`. Empty is a real answer; absent is not. */
      readonly skipped: readonly SkippedRun[]
    }
  /** No subagents directory. This session has dispatched nobody, which is a real answer. */
  | { readonly state: 'none' }
  /** We could not look. **Not** the same as nobody having done anything. */
  | { readonly state: 'unreadable'; readonly cause: string }

function parseMeta(text: string): Omit<SubagentRun, 'jsonl' | 'at'> | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null

  const m = raw as Record<string, unknown>
  const agentType = typeof m['agentType'] === 'string' ? m['agentType'] : ''
  const toolUseId = typeof m['toolUseId'] === 'string' ? m['toolUseId'] : ''
  // Without an agent and a dispatch there is nothing to attach this run to on the floor.
  if (!agentType || !toolUseId) return null

  return {
    agentType,
    toolUseId,
    description: typeof m['description'] === 'string' ? m['description'] : '',
  }
}

/**
 * Every subagent run recorded under one session.
 *
 * Never throws. A missing directory means this session has dispatched nobody; anything else
 * that goes wrong comes back as `unreadable`, so the caller can say so instead of showing an
 * employee with an empty history they did not earn.
 */
export async function scanSubagents(
  sessionId: string,
  cwd: string,
  home?: string,
): Promise<SubagentScan> {
  const located = home === undefined
    ? await locateTranscript(sessionId, cwd)
    : await locateTranscript(sessionId, cwd, home)

  if (located.state === 'missing') return { state: 'none' }
  if (located.state === 'unreadable') return { state: 'unreadable', cause: located.cause }

  // The runs sit in a directory named after the session, beside the session's own transcript.
  const directory = join(dirname(located.path), basename(located.path, '.jsonl'), SUBAGENTS)

  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'none' }
    return { state: 'unreadable', cause: (err as Error).message }
  }

  const runs: SubagentRun[] = []

  /*
   * The runs we could not use, kept rather than dropped.
   *
   * Every `continue` below used to be the end of it — right for the card, which would rather show
   * one run than none, and a silence for a caller answering about the whole workspace, such as
   * `search.ts`, which was handed a short list with nothing to say it was short.
   */
  const skipped: SkippedRun[] = []
  const sidecars = entries.filter((e) => e.endsWith(META)).sort()

  for (const entry of sidecars) {
    const metaPath = join(directory, entry)
    const name = `${entry.slice(0, -META.length)}${RUN}`
    const runPath = join(directory, name)

    let meta: ReturnType<typeof parseMeta>
    try {
      meta = parseMeta(await readFile(metaPath, 'utf8'))
    } catch (err) {
      // One unreadable sidecar should not hide every other employee's work.
      skipped.push({ run: name, cause: `its sidecar could not be read: ${(err as Error).message}` })
      continue
    }
    if (!meta) {
      skipped.push({ run: name, cause: 'its sidecar does not say which employee ran it' })
      continue
    }

    let jsonl: string
    let at: number
    try {
      jsonl = await readFile(runPath, 'utf8')
      at = (await stat(runPath)).mtimeMs
    } catch (err) {
      skipped.push({ run: name, cause: `the record could not be read: ${(err as Error).message}` })
      continue
    }

    runs.push({ ...meta, jsonl, at })
  }

  /*
   * A record with no sidecar beside it. The loop above lists sidecars, so such a run is never
   * looked at — the quietest of the four ways one goes missing here, and the only one nothing
   * else in the directory hints at.
   */
  const attached = new Set(sidecars.map((e) => `${e.slice(0, -META.length)}${RUN}`))
  for (const entry of entries.filter((e) => e.endsWith(RUN)).sort()) {
    if (!attached.has(entry)) {
      skipped.push({ run: entry, cause: 'no sidecar beside it says which employee ran it' })
    }
  }

  return { state: 'ok', runs, skipped }
}

/**
 * The most recent thing one employee did.
 *
 * Most recent rather than all of them: the card answers "what did they do", and on a floor
 * where the same person is dispatched repeatedly the answer people mean is the last time.
 */
export function latestFor(runs: readonly SubagentRun[], agentType: string): SubagentRun | null {
  const theirs = runs.filter((r) => r.agentType === agentType)
  if (theirs.length === 0) return null
  return theirs.reduce((best, r) => (r.at > best.at ? r : best))
}
