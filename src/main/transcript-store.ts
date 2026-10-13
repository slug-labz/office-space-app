/**
 * Finding a session's transcript on disk.
 *
 * Claude Code writes every session to `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`,
 * where the encoding replaces path separators with hyphens. Office Space reads that file for
 * one purpose only: to show you the conversation you were already having, in the session it
 * opened itself.
 *
 * ## The scope, stated because it matters
 *
 * Every Claude Code session on the machine lives under that directory — other projects, other
 * work, things that have nothing to do with this office. So this module is only ever given a
 * session id the registry already knows, and it never lists or reads anything else. The
 * fallback below searches for **one exact filename** and reads no directory contents beyond
 * their names.
 *
 * ## Why there is a fallback at all
 *
 * The encoding is not a published contract. Deriving the directory is right nearly always and
 * would break silently the day it changed — and "silently" would look exactly like "you have no
 * history", which is the failure this project refuses to ship. So a derived miss falls back to
 * looking for the file by name, and a genuine miss is reported as a miss rather than as an
 * empty conversation.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { safeRelativePath } from './safe-path.js'

const PROJECTS_DIR = join('.claude', 'projects')

/**
 * How Claude Code names a working directory's folder.
 *
 * **Every character that is not a letter or a digit becomes a hyphen** — not only the separators.
 * This said `cwd.replace(/\//g, '-')`, which is right for a path made of letters, digits and
 * slashes and wrong for most real ones.
 *
 * Measured rather than reasoned about. Each transcript records the `cwd` it ran in and sits
 * inside the directory the CLI derived from that cwd, which makes the CLI's own output the
 * authority. Against 25 such pairs on one machine:
 *
 *     `/` only                 wrong on 9 of 25   ← what this used to do
 *     `/` and `.`              wrong on 5 of 25
 *     every non-alphanumeric   wrong on 0 of 25
 *
 * The nine included every agent worktree this app makes, because they live under `.claude/` and
 * the dot was left alone: `…office-space-.claude-worktrees-…` where the CLI writes
 * `…office-space--claude-worktrees-…`. The five that survived the dot were a directory called
 * `Ria_Jira_Insights 2` — an underscore and a space, both hyphens on disk.
 *
 * This was not a hard failure, because the search below falls back to finding the file by name
 * when the derived path misses. It was a wrong first guess on a third of the directories on that
 * machine, and the fallback is a scan.
 */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

export type Located =
  | { readonly state: 'found'; readonly path: string }
  /** Searched, and it is not there. Genuinely no transcript. */
  | { readonly state: 'missing' }
  /** Could not look properly. **Not** the same as not there. */
  | { readonly state: 'unreadable'; readonly cause: string }

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Find the transcript for one session.
 *
 * `home` is injectable so this can be tested against a fixture rather than against whatever
 * happens to be in the developer's own Claude history.
 */
export async function locateTranscript(
  sessionId: string,
  cwd: string,
  home: string = homedir(),
): Promise<Located> {
  const root = join(home, PROJECTS_DIR)

  /*
   * A session id becomes a filename, so it is checked like one.
   *
   * `${sessionId}.jsonl` is joined onto a directory, and a `../` in it walks the *read* out of
   * the projects tree — verified: `locateTranscript('../../../secrets', '/w', home)` came back
   * `found` at `~/secrets.jsonl`, which the transcript panel would then display. A read rather
   * than a write, so this discloses instead of destroying; the panel showing an arbitrary
   * `.jsonl` off somebody's disk is still not what it is for.
   *
   * The ids this receives come from the session registry, which is a JSON file in the workspace
   * that a person can edit — the same reachability the `disable`/`enable` guards in `roster.ts`
   * are written against, and the same standard: a check nothing can reach today is the one that
   * matters the day something can.
   *
   * `safeRelativePath` rather than a fourth hand-rolled comparison. It was written for
   * `reconcile.ts`, where being wrong once is a write over an arbitrary file, and it is fuzzed
   * against nineteen shapes including a drive letter, a UNC path and an embedded NUL.
   */
  const file = `${sessionId}.jsonl`

  /*
   * Both components, checked as one relative path.
   *
   * The first version of this guarded `file` alone, against `root/<encoded>` — and the call is
   * `join(root, encodeCwd(cwd), file)`, so the *middle* argument was never checked. `encodeCwd`
   * replaces `/` with `-`, which flattens any cwd containing a separator; a cwd that is exactly
   * `..` has no separator to replace and survives intact:
   *
   *     encodeCwd('/w/../..')  →  '-w-..-..'   flattened
   *     encodeCwd('..')        →  '..'          intact
   *
   *     locateTranscript('history', '..', home)  →  found: ~/.claude/history.jsonl
   *
   * One level, and one level is enough: `.claude/` holds Claude Code's own global history, which
   * is every project rather than this one. `cwd` arrives from the same registry entry as
   * `sessionId`, so it has exactly the reachability the id does.
   *
   * Checking the joined relative path rather than a component is the shape that cannot have this
   * bug again — a traversal in any argument shows up in the path they combine into, and adding a
   * third component later gets the check for free.
   */
  const encoded = encodeCwd(cwd)
  const unusable =
    // The whole relative path. Redundant today and kept deliberately: a traversal needs a `..`
    // segment in *some* component, and both components are checked below, so mutating this line
    // away fails nothing. It is here because it is the check that does not need editing when
    // somebody adds a third component to the join — which is exactly how `cwd` came to be
    // unguarded, by a check written for the arguments that existed when it was written.
    safeRelativePath(root, join(encoded, file)) === null ||
    // Each component on its own, and these are the two doing the work. `join` normalises: `join('-w', '../sibling.jsonl')`
    // is `sibling.jsonl`, with no `..` left for the check above to see. That lands inside
    // `projects/` — it does not leave the tree — and it is somebody's other conversation, which
    // is the harm this is about. Checking the joined path alone lost that case, and the test for
    // it is what said so.
    safeRelativePath(root, encoded) === null ||
    safeRelativePath(root, file) === null

  if (unusable) {
    return { state: 'unreadable', cause: `${sessionId} is not a session id this office can look up.` }
  }

  const derived = join(root, encodeCwd(cwd), file)
  if (await isFile(derived)) return { state: 'found', path: derived }

  // Not where we expected. Look for the exact filename instead of concluding it is absent.
  let projects: string[]
  try {
    projects = await readdir(root)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
    return { state: 'unreadable', cause: (err as Error).message }
  }

  for (const project of projects) {
    const candidate = join(root, project, file)
    if (await isFile(candidate)) return { state: 'found', path: candidate }
  }

  return { state: 'missing' }
}

export type TranscriptRead =
  | { readonly state: 'ok'; readonly jsonl: string; readonly path: string }
  | { readonly state: 'missing' }
  | { readonly state: 'unreadable'; readonly cause: string }

/** Read a session's transcript, or say precisely why not. */
export async function readTranscript(
  sessionId: string,
  cwd: string,
  home?: string,
): Promise<TranscriptRead> {
  const located = home === undefined
    ? await locateTranscript(sessionId, cwd)
    : await locateTranscript(sessionId, cwd, home)
  if (located.state !== 'found') return located

  try {
    return { state: 'ok', jsonl: await readFile(located.path, 'utf8'), path: located.path }
  } catch (err) {
    return { state: 'unreadable', cause: (err as Error).message }
  }
}
