/**
 * Read `memory/`, and be exact about every way that can fail.
 *
 * The parsing is `src/shared/memory.ts`, which imports nothing and is where the decisions live.
 * This is the directory walk, and it exists because the vision's *"you can just ask it — what's
 * going on, what do we know"* had an agent, a directory, and no reader.
 *
 * ## Three failures, three answers
 *
 * `ENOENT` on the directory is **not** a problem. A workspace where nobody has recorded anything
 * has no `memory/` until something writes one, and reporting that as a fault would be the office
 * complaining about the ordinary case. It is an empty report.
 *
 * Any other errno **is** a problem, and it is the one this whole app exists to distinguish: a
 * `memory/` that is there and will not open is not a workspace with nothing recorded.
 *
 * And a single file that will not open is carried per file rather than sinking the read. Nine
 * memories and one unreadable is nine memories and a named gap; treating it as a failed read
 * would lose the nine, and treating it as nothing would lose the one.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { parseMemory, type Memory, type MemoryReport, type UnreadMemory } from '../shared/memory.js'

/** Where the office keeps what it remembers. Named once. */
export const MEMORY_DIR = 'memory'

/**
 * Not a memory.
 *
 * `README.md` is committed and explains the directory to a person — it is documentation about the
 * shape, not something the office learned. Excluded here rather than inside `parseMemory`, so the
 * parser reads what it is handed and this stays the only place that decides what counts.
 */
const NOT_A_MEMORY = new Set(['readme.md'])

export async function readMemory(root: string): Promise<MemoryReport> {
  const dir = join(root, MEMORY_DIR)

  let names: string[]
  try {
    /*
     * Recursive, and this is the whole of a real defect.
     *
     * It was a flat `readdir`, and the next line skips anything not ending `.md` — so a
     * *directory* was skipped in silence. `memory-keeper` organises what it writes: asked to
     * record one decision it produced `memory/decisions/2026-08-31-mit-licence.md`, complete
     * with frontmatter and a "why it matters", and the panel went on saying **"Nothing recorded
     * yet. Nothing has been written down yet."**
     *
     * The office had written something down and could not see it, and nothing anywhere said so —
     * the fourth standing order failing on the one surface whose entire subject is what is
     * remembered. Driven end to end on a fresh workspace before this was changed.
     *
     * Recursion is the fix rather than telling the keeper to write flat, because grouping by
     * kind is the sensible thing for it to have done and a reader that silently ignores a
     * directory is the part that is wrong.
     */
    names = await readdir(dir, { recursive: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // Absent really is empty here, and only here. The directory is created by whatever first
    // writes to it, so a workspace that has never recorded anything genuinely has none.
    if (code === 'ENOENT') return { memories: [], unread: [], problem: null }
    return {
      memories: [],
      unread: [],
      problem: `${dir} exists and could not be opened: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const memories: Memory[] = []
  const unread: UnreadMemory[] = []

  for (const name of names.sort()) {
    // `recursive` yields directories too, and paths use the platform separator. The basename is
    // what `NOT_A_MEMORY` is about — a `README.md` one level down is documentation just the same.
    const base = name.split(/[/\\]/).pop() ?? name
    if (!name.endsWith('.md') || NOT_A_MEMORY.has(base.toLowerCase())) continue
    // Kept as the path relative to `memory/`, because that is what the panel prints and what
    // somebody would type to open it: `memory/decisions/…md`, not a bare filename that no longer
    // says where it lives.
    const id = name.slice(0, -'.md'.length).split(/[/\\]/).join('/')
    try {
      memories.push(parseMemory(id, await readFile(join(dir, name), 'utf8')))
    } catch (err) {
      // Per file. One unreadable memory among nine is a named gap, not a failed read.
      unread.push({ id, cause: err instanceof Error ? err.message : String(err) })
    }
  }

  return { memories, unread, problem: null }
}
