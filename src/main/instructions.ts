/**
 * The workspace's own instruction file, and whether the agents in it have one.
 *
 * `CLAUDE.md` at the workspace root is the file every agent Claude Code starts here reads before
 * it does anything. VISION.md lists it as part of the backend this app is a frontend for — *"the
 * backend is a `.claude/` workspace — agents, skills, hooks, commands, MCPs, memory, projects,
 * and a main instruction file"* — and it was the one item on that list the office showed nothing
 * about. The roster shows the agents, the shelf shows the skills, the connectors panel shows the
 * MCPs, the memory panel shows the memory; the file that governs all of them was invisible.
 *
 * ## Why absence is the case worth building for
 *
 * This is not hypothetical. `scripts/build.mjs` shipped a manifest that did not carry
 * `CLAUDE.md`, so **no installed office ever received one** — every agent in every packaged
 * workspace ran with no standing instructions at all, and nothing anywhere said so. The fix was
 * one line in a manifest. Finding it took using the product somewhere that was not a clone.
 *
 * A workspace with no instruction file is not broken in a way anybody can see. The agents answer,
 * the floor draws, the office looks well. They are simply working without the rules.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { gateState, type FileRead, type GateState } from '../shared/gate.js'

/** The file Claude Code reads at a workspace root. Not configurable; this is the CLI's own name. */
export const INSTRUCTIONS_FILE = 'CLAUDE.md'

export type Instructions =
  | { readonly state: 'present'; readonly bytes: number }
  /** No file. Every agent here runs with no standing instructions. */
  | { readonly state: 'absent' }
  /**
   * It is there and could not be read.
   *
   * Kept apart from `absent` for the reason everything in this codebase is: they are different
   * facts and only one of them is fixed by writing a file. Somebody told to create a CLAUDE.md
   * that already exists, and whose permissions are the actual problem, has been sent the wrong
   * way by a panel that was trying to help.
   */
  | { readonly state: 'unreadable'; readonly cause: string }

export async function readInstructions(root: string): Promise<Instructions> {
  try {
    const found = await stat(join(root, INSTRUCTIONS_FILE))
    // A directory called `CLAUDE.md` is not an instruction file, and reporting it as present
    // would send somebody looking for content in a thing that has none.
    if (!found.isFile()) {
      return { state: 'unreadable', cause: `${INSTRUCTIONS_FILE} is not a file` }
    }
    return { state: 'present', bytes: found.size }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' }
    return { state: 'unreadable', cause: (err as Error).message }
  }
}

/**
 * Read a file for a decision that only needs to know these three things.
 *
 * `FileRead` is `shared/gate.ts`'s input shape, and it is deliberately the same three states this
 * module already draws for `CLAUDE.md`: present, never written, or there and unreadable. Both
 * questions are "is this part of the workspace actually in place", and answering them with two
 * different vocabularies is how one of them eventually gets a fourth state the other lacks.
 */
async function readOr(path: string): Promise<FileRead> {
  try {
    return { state: 'present', text: await readFile(path, 'utf8') }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' }
    return { state: 'unreadable', cause: (err as Error).message }
  }
}

/**
 * Whether the approval gate is actually in place in this workspace.
 *
 * Both halves are shipped files a person may edit, and `reconcile.ts` will not put either back —
 * *"a path we gave it and that is now gone was taken away on purpose"*, which is the right rule
 * for a skill somebody deleted and means the gate can be permanently absent by design.
 *
 * What the office sees then is an approvals directory with nothing in it, which is exactly what a
 * working gate looks like when nobody has run a command. There is a liveness marker in the other
 * direction — proof an office is watching, so a plain terminal `claude` does not hang — and
 * nothing in the reverse. This is the reverse.
 */
export async function readGate(root: string): Promise<GateState> {
  const [settings, hook] = await Promise.all([
    readOr(join(root, '.claude', 'settings.json')),
    readOr(join(root, '.claude', 'hooks', 'approval-gate.mjs')),
  ])
  return gateState(settings, hook)
}
