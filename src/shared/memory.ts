/**
 * What the office remembers, read rather than assumed.
 *
 * `memory/` is the one directory in this workspace that is nobody else's — gitignored except for
 * its README, so a clone gives you colleagues and not somebody's notes. The `memory-keeper` agent
 * owns it, one fact per file, and its own prompt specifies the shape:
 *
 *     ---
 *     title: <short human title>
 *     type: decision | fact | person | project | reference
 *     created: YYYY-MM-DD
 *     updated: YYYY-MM-DD
 *     ---
 *
 *     <the fact, stated plainly>
 *
 *     **Why it matters:** <one line>
 *
 * Until now nothing in the app read it. The agent existed, the directory existed with a README in
 * it, `privacy.ts` counted its bytes so they could be deleted — and the vision's *"you can just
 * ask it — what's going on, how is progress, what do we know"* had no surface at all.
 *
 * ## Every failure is its own answer
 *
 * The memory keeper's own instruction is the reason this module is shaped the way it is:
 *
 *     If nothing was recorded about something, say "nothing recorded" — do not infer, and do not
 *     fill the gap with something plausible. A confident guess from the memory keeper is the most
 *     damaging thing you can produce, because people believe you.
 *
 * That rule binds the surface as hard as it binds the agent. So a file that will not open is not
 * a fact that does not exist, a file with no frontmatter is not a file with no title, and a
 * directory that is absent is not a directory that is empty. Each is carried separately, and the
 * panel says which.
 */

/** What kind of thing a memory is. The keeper's prompt names five; anything else is kept as-is. */
export type MemoryKind = 'decision' | 'fact' | 'person' | 'project' | 'reference' | 'unlabelled'

const KINDS: readonly MemoryKind[] = ['decision', 'fact', 'person', 'project', 'reference']

/** One thing the office remembers. */
export interface Memory {
  /** The filename without `.md` — what the keeper is told to make kebab-case and unique. */
  readonly id: string
  /**
   * The title from the frontmatter, or the id when there is none.
   *
   * Falling back to the id rather than to "Untitled": the filename is a real name somebody chose,
   * and it is the one thing a file always has. `untitled` would be less true and less useful.
   */
  readonly title: string
  readonly kind: MemoryKind
  /** `null` when the frontmatter has no date, which is a fact about the file rather than a gap. */
  readonly created: string | null
  readonly updated: string | null
  /** The body, with the frontmatter removed and the edges trimmed. May be empty. */
  readonly body: string
  /** True when there was no frontmatter block at all — the file is prose, not a record. */
  readonly unstructured: boolean
}

/** A file in `memory/` that could not be read at all. Reported, never dropped. */
export interface UnreadMemory {
  readonly id: string
  readonly cause: string
}

export interface MemoryReport {
  readonly memories: readonly Memory[]
  readonly unread: readonly UnreadMemory[]
  /**
   * Why the directory itself could not be listed, or `null`.
   *
   * Separate from an empty `memories`, and the distinction is the whole point: **absent is not
   * empty**. A workspace where nobody has recorded anything and one whose `memory/` will not open
   * are different facts, and only the first is good news.
   */
  readonly problem: string | null
}

/**
 * One file, parsed.
 *
 * `README.md` is excluded by the caller rather than here — this function's job is to read what it
 * is handed, and a reader that quietly skipped a filename would be the second place that decision
 * lives.
 */
export function parseMemory(id: string, text: string): Memory {
  const front = frontmatter(text)
  if (front === null) {
    return {
      id,
      title: id,
      kind: 'unlabelled',
      created: null,
      updated: null,
      body: text.trim(),
      // Said rather than guessed at. A prose file in `memory/` is somebody's note, and rendering
      // it as a record with a missing title would be dressing it as something it is not.
      unstructured: true,
    }
  }

  const declared = (front.fields['type'] ?? '').trim().toLowerCase()
  return {
    id,
    title: (front.fields['title'] ?? '').trim() || id,
    kind: KINDS.find((k) => k === declared) ?? 'unlabelled',
    created: date(front.fields['created']),
    updated: date(front.fields['updated']),
    body: front.body.trim(),
    unstructured: false,
  }
}

/**
 * A date, only if it looks like one.
 *
 * The keeper is told **absolute dates, never "yesterday"** — so a value that is not a date is a
 * rule being broken, and showing it in a date column would hide that. `null` sends it to the
 * "no date recorded" state, which is honest about both cases.
 */
function date(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

/** The `---` block and what follows it. `null` when there is no block. */
function frontmatter(text: string): { fields: Record<string, string>; body: string } | null {
  // The BOM first: a file written by some editors starts with one, and `startsWith('---')` is
  // false for it — which would report every such file as prose. `workspace.ts` strips it for the
  // same reason on agent files.
  const normalised = text.replace(/^﻿/, '')
  if (!normalised.startsWith('---')) return null

  const end = normalised.indexOf('\n---', 3)
  if (end === -1) return null

  const fields: Record<string, string> = {}
  for (const line of normalised.slice(3, end).split('\n')) {
    const at = line.indexOf(':')
    if (at === -1) continue
    // Split on the *first* colon only. A title routinely contains one, and splitting on every
    // colon turns "Auth: why we chose PKCE" into a field called `Auth` and a lost title.
    fields[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
  }

  const after = normalised.indexOf('\n', end + 1)
  return { fields, body: after === -1 ? '' : normalised.slice(after + 1) }
}

/**
 * What the panel says above the list.
 *
 * Three states and they are not interchangeable — this is the sentence the fourth standing order
 * is about, on the surface whose whole subject is what is and is not known.
 */
export function memoryLede(report: MemoryReport): string {
  if (report.problem !== null) {
    return `The office cannot tell you what it remembers — ${report.problem}`
  }

  const n = report.memories.length
  const kept = n === 0 ? 'Nothing recorded yet' : n === 1 ? '1 thing recorded' : `${n} things recorded`

  if (report.unread.length === 0) return kept

  /*
   * Nothing was read, and files are there.
   *
   * Its own sentence, because the other one says "**more**" — and more than nothing is a
   * contradiction. Seen in the running app on a workspace whose only memory file was `chmod 000`:
   * *"Nothing readable recorded · 1 more exists and could not be read."* The `n > 0` half had a
   * test and this half did not, which is exactly where the wording went.
   *
   * "Nothing recorded yet" would be worse than clumsy here — it is a false statement about a
   * directory with something in it.
   */
  if (n === 0) {
    return report.unread.length === 1
      ? 'Nothing here could be read. One file exists and would not open.'
      : `Nothing here could be read. ${report.unread.length} files exist and would not open.`
  }

  const unread =
    report.unread.length === 1
      ? '1 more exists and could not be read'
      : `${report.unread.length} more exist and could not be read`
  // "At least", because a count that excluded unreadable files is a count of what we managed to
  // read and not of what is remembered — the same distinction the activity strip draws.
  return `At least ${kept.toLowerCase()} · ${unread}`
}
