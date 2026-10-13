/**
 * The three ways something stops being in your way, and why they are three.
 *
 * Until now the whole removal surface of a 48-method API was `forget(path)`, which deletes a
 * stored file from the privacy panel. Projects, conversations and offices were **create-only**,
 * so the switcher grew forever and a project started by mistake was permanent.
 *
 * One verb would have been wrong, and the reason is that the three things being removed are not
 * the same kind of thing:
 *
 * **Close a conversation.** Hides it from the list. **The transcript is Claude Code's, not
 * ours** — it lives under `~/.claude/projects/` and it is the record of what somebody actually
 * said. Deleting it because they tidied a list is not a trade this app gets to make on their
 * behalf, so closing touches nothing but our own registry and is reversible by definition.
 *
 * **Archive a project.** Moves it inside the workspace, out of `projects/`. Nothing leaves the
 * directory the person owns; it stops being somewhere they have to look. For work that is
 * finished rather than unwanted.
 *
 * **Delete a project.** The only destructive one, and it goes to the **OS Trash** rather than
 * `rm -rf`. Khalid's call, and the right one: it is genuinely gone from the workspace, the app
 * has no recovery to build, and the recovery that exists is the one every Mac user already
 * knows. A "delete" that quietly kept the files somewhere would be the dishonest option; a
 * `rm -rf` on somebody's plans, progress and task lists would be the reckless one.
 *
 * ## What a confirmation has to be able to say
 *
 * {@link describeProject} exists so the dialog can name the directory and count what is in it
 * *before* anything moves. A confirmation that cannot say what it is about to destroy is a speed
 * bump, not a safeguard — it trains people to click through it, which is worse than not having
 * one.
 */

import { readdir, rename, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface RemovalOutcome {
  readonly ok: boolean
  /** Why not, in words for the person who asked. Never an exception, never a code. */
  readonly reason?: string
}

/** Where archived projects go. Inside the workspace, and out of the way. */
export const ARCHIVE_DIR = '.archived'

/** What is in a project, so a confirmation can name it rather than say "are you sure". */
export interface ProjectContents {
  readonly path: string
  readonly files: number
  /** True when we could not read it. **Not** the same as an empty project. */
  readonly unreadable: boolean
}

/**
 * A project id that cannot escape `projects/`.
 *
 * Ids come from directory listings today, so this is belt and braces — but the three functions
 * below `rename` and `trash` whatever they are handed, and a `..` reaching one of them would be
 * the worst bug in this file. Checked here once rather than trusted three times.
 */
export function isSafeProjectId(id: string): boolean {
  if (id === '' || id === '.' || id === '..') return false
  if (id.startsWith('.')) return false
  return !/[/\\]/.test(id)
}

export async function describeProject(root: string, id: string): Promise<ProjectContents> {
  const path = join(root, 'projects', id)
  if (!isSafeProjectId(id)) return { path, files: 0, unreadable: true }

  let files = 0
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(join(dir, entry.name))
      else files += 1
    }
  }

  try {
    await walk(path)
    return { path, files, unreadable: false }
  } catch {
    // Absent is not empty, and this is the surface where that matters most: a confirmation that
    // says "0 files" about a directory it could not read invites somebody to delete their work.
    return { path, files: 0, unreadable: true }
  }
}

/**
 * Move a project out of `projects/` and into `projects/.archived/`.
 *
 * A rename inside one directory, so it is atomic on every filesystem this runs on and there is
 * no window where the project exists in neither place.
 */
export async function archiveProject(root: string, id: string): Promise<RemovalOutcome> {
  if (!isSafeProjectId(id)) return { ok: false, reason: `"${id}" is not a project this office can move.` }

  const from = join(root, 'projects', id)
  const archive = join(root, 'projects', ARCHIVE_DIR)
  const to = join(archive, id)

  try {
    await stat(from)
  } catch {
    return { ok: false, reason: `There is no project called "${id}" to archive.` }
  }

  try {
    await stat(to)
    // Overwriting would destroy the earlier archive of the same name silently. Say so instead.
    return {
      ok: false,
      reason: `A project called "${id}" is already archived. Rename one of them first — nothing has been moved.`,
    }
  } catch {
    // Nothing there, which is what we want.
  }

  try {
    await mkdir(archive, { recursive: true })
    await rename(from, to)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: `Could not archive "${id}": ${(err as Error).message}` }
  }
}

/** What the app needs from Electron to delete. Injected so this module is testable without it. */
export type Trash = (path: string) => Promise<void>

/**
 * Move a project to the OS Trash.
 *
 * The one destructive verb, and it delegates the destruction. `shell.trashItem` is the same
 * thing Finder does, so the file manager the person already uses is the recovery path — and
 * this app does not grow an undo of its own for the one operation where an undo has to work.
 */
export async function deleteProject(root: string, id: string, trash: Trash): Promise<RemovalOutcome> {
  if (!isSafeProjectId(id)) return { ok: false, reason: `"${id}" is not a project this office can delete.` }

  const path = join(root, 'projects', id)
  try {
    await stat(path)
  } catch {
    return { ok: false, reason: `There is no project called "${id}" to delete.` }
  }

  try {
    await trash(path)
    return { ok: true }
  } catch (err) {
    // Trash can fail for real reasons — a network volume, a permission. Saying so beats a
    // silent no-op on the one call where somebody expects something to have happened.
    return { ok: false, reason: `Could not move "${id}" to the Trash: ${(err as Error).message}` }
  }
}
