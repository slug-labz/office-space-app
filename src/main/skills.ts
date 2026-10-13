/**
 * The shelf: adding to it, taking off it, and seeing what has actually been used.
 *
 * Skills are the half of customisability that agent files are not. An agent is *who* is in the
 * office; a skill is *what anybody here knows how to do*, and the office ships two. A stranger
 * who cannot add a third has a fixed office with a configurable staff list.
 *
 * ## Observability, derived rather than recorded
 *
 * "What ran, and how often" is a question with two possible answers and only one honest one.
 *
 * We could keep a counter — increment it when a skill is invoked, store it in `.office-space/`.
 * That is a second record beside the transcripts, and it can disagree with them: a run that
 * crashed mid-turn increments nothing, a transcript deleted by hand leaves the counter standing,
 * and the number on screen slowly stops describing anything.
 *
 * So this counts from the transcripts, which are the record of what actually happened. It is
 * more work per read and it cannot drift, and the office's whole claim is that what it shows is
 * real. A count that is occasionally recomputed is worth more than a count that is fast and
 * eventually fictional.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { locateSkill } from './workspace.js'
import type { TimelineEntry } from '../shared/transcript/parse.js'

const CLAUDE_DIR = '.claude'
const SKILLS_DIR = 'skills'

export interface NewSkill {
  /** The directory name, and what somebody types after a slash. */
  readonly id: string
  /** Frontmatter `description`. This is what the manager reads to decide whether to use it. */
  readonly description: string
  /** The body: how to do the thing. */
  readonly body: string
}

export type SkillResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string }

/**
 * Whether a name can be a skill.
 *
 * Same shape as an agent id and for the same three reasons — it is a directory name, it is what
 * the CLI resolves after a slash, and it is what a person types.
 */
export function isValidSkillId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
}

export function whySkillInvalid(id: string): string | null {
  if (id === '') return 'A name is required.'
  if (id.length > 64) return 'That is too long for a name — 64 characters at most.'
  if (/[A-Z]/.test(id)) return 'Names are lowercase, because they become directory names and are typed after a slash.'
  if (/[/\\.]/.test(id)) return 'A name cannot contain a slash or a dot — it becomes a directory.'
  if (!/^[a-z0-9]/.test(id)) return 'A name starts with a letter or a number.'
  if (!isValidSkillId(id)) return 'Use letters, numbers and hyphens only.'
  return null
}

/** The `SKILL.md` a new skill starts as. Separate from writing it, so it can be tested. */
export function skillFile(skill: NewSkill): string {
  return `---\nname: ${skill.id}\ndescription: ${skill.description.trim()}\n---\n\n${skill.body.trim()}\n`
}

/**
 * Put a skill on the shelf.
 *
 * Refuses to overwrite, for the same reason hiring does: replacing a file somebody wrote is not
 * a recoverable kind of wrong, and the overwhelmingly likely cause is a name collision nobody
 * intended.
 */
export async function addSkill(root: string, skill: NewSkill): Promise<SkillResult> {
  const bad = whySkillInvalid(skill.id)
  if (bad) return { ok: false, reason: bad }
  if (!skill.description.trim()) {
    // The description is the whole of how a skill gets chosen. Without one it sits on the shelf
    // and is never picked, which is a quieter failure than not existing.
    return { ok: false, reason: 'A description is required — it is how anybody decides to use this skill.' }
  }

  const dir = join(root, CLAUDE_DIR, SKILLS_DIR, skill.id)
  const path = join(dir, 'SKILL.md')
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(path, skillFile(skill), { encoding: 'utf8', flag: 'wx' })
    return { ok: true, path }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return { ok: false, reason: `There is already a skill called ${skill.id}.` }
    }
    return { ok: false, reason: `Could not write ${path}: ${describe(err)}` }
  }
}

/**
 * Take one off the shelf.
 *
 * Removes the whole directory, because a skill is a directory — some ship assets beside their
 * `SKILL.md`, and leaving those behind would leave a directory discovery correctly ignores and
 * a person correctly finds confusing.
 */
export async function removeSkill(root: string, id: string): Promise<SkillResult> {
  if (!isValidSkillId(id)) return { ok: false, reason: 'Not a skill name.' }

  /*
   * Asked, not built. `id` comes from `name:` inside the SKILL.md, and this used to rebuild the
   * path as `skills/<id>/` — two definitions of one fact, agreeing only while every directory
   * happened to be named after the skill inside it.
   *
   * Measured on a directory `dirname-here/` declaring `name: frontmatter-name`: the shelf showed
   * **frontmatter-name** and removing it answered "There is no skill called frontmatter-name."
   * The same fault the roster had for agents, one entity over.
   */
  const dir = await locateSkill(root, id)
  if (dir === null) return { ok: false, reason: `There is no skill called ${id}.` }

  try {
    await rm(dir, { recursive: true, force: false })
    return { ok: true, path: dir }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, reason: `There is no skill called ${id}.` }
    }
    return { ok: false, reason: `Could not remove ${id}: ${describe(err)}` }
  }
}

/** How often a skill was used, and when it was last used. */
export interface SkillUse {
  readonly id: string
  readonly count: number
  /** ISO timestamp of the most recent invocation, or `null` if none carried one. */
  readonly lastUsed: string | null
}

/**
 * Count skill invocations out of a conversation's own record.
 *
 * A skill invocation is a `Skill` tool call carrying `input.skill`, which is the same fact the
 * floor reads to walk somebody to the shelf. Counting the same event both places is the point:
 * there is one truth, and two readers of it.
 *
 * A call that never settled still counts. It happened — somebody invoked it — and whether it
 * finished is a different question from whether it was used. Reporting only settled calls would
 * quietly under-count exactly the invocations most worth looking at.
 */
export function skillUse(entries: readonly TimelineEntry[]): readonly SkillUse[] {
  const counts = new Map<string, { count: number; lastUsed: string | null }>()

  for (const entry of entries) {
    if (entry.kind !== 'tool' || entry.name !== 'Skill') continue
    const id = entry.input['skill']
    if (typeof id !== 'string' || id === '') continue

    const seen = counts.get(id) ?? { count: 0, lastUsed: null }
    counts.set(id, {
      count: seen.count + 1,
      // Entries arrive in order, so the last one wins. `timestamp` may be empty on a record the
      // CLI wrote without one, and an empty string is not a time.
      lastUsed: entry.timestamp || seen.lastUsed,
    })
  }

  return [...counts.entries()]
    .map(([id, v]) => ({ id, count: v.count, lastUsed: v.lastUsed }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

/**
 * What is on the shelf, joined to what has been used.
 *
 * Both halves matter and they are different facts. A skill that exists and has never been used
 * is worth seeing — it is the one somebody wrote and the manager has never picked, which is
 * usually a description problem rather than a skill problem. A *use* of something no longer on
 * the shelf is worth seeing too: it is a skill somebody removed while conversations that used it
 * still exist, and pretending it never happened would be editing the record.
 */
export function shelfReport(
  onShelf: readonly { id: string }[],
  used: readonly SkillUse[],
): readonly (SkillUse & { readonly onShelf: boolean })[] {
  const byId = new Map(used.map((u) => [u.id, u]))

  const rows = onShelf.map((s) => ({
    id: s.id,
    count: byId.get(s.id)?.count ?? 0,
    lastUsed: byId.get(s.id)?.lastUsed ?? null,
    onShelf: true,
  }))

  for (const u of used) {
    if (!onShelf.some((s) => s.id === u.id)) rows.push({ ...u, onShelf: false })
  }

  return rows.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
