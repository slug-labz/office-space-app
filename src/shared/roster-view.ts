/**
 * What the roster panel says, worked out apart from the DOM that shows it.
 *
 * The repository's convention, and the reason for it: renderer view modules build elements and
 * nothing else, and every decision they would otherwise bury in a branch lives in `shared/`
 * where a test can reach it without a browser. `tasks.ts` and `slash.ts` are the same shape.
 *
 * The decisions here are small and all four have a way of being got wrong quietly:
 *
 * - **Who may be fired.** The manager may not, and the reason is not politeness — firing it
 *   leaves a building with a floor, a transcript and nobody to answer, and there is no path in
 *   the app back from that. A button that is offered and then refused teaches nothing.
 * - **What `tools:` absent means.** Larger than a list, not smaller. It inherits the dispatch
 *   tool, which is the standing order about who originates work broken by omission.
 * - **Empty against unreadable.** `[]` is a workspace with no skills. `null` is a question we
 *   asked and could not answer. Drawing them the same is the fourth standing order broken.
 * - **Which count to print.** Benched staff are staff. A roster that prints one number hides
 *   the difference between an office of seven and an office of five with two sent home.
 */

import type { ShelfRow, SkillInfo, StaffMember } from './ipc.js'
import { whyUnsafeAsPath } from './agent-id.js'

export interface RosterModel {
  readonly staff: readonly StaffMember[]
  /**
   * Whether `.claude/agents` could be read at all.
   *
   * `staff: []` means two different things and this is what tells them apart — the same
   * distinction `shelf` makes two fields down by being nullable, which the staff half of this
   * panel did not make.
   *
   * Seen in the running app with that directory at mode 000: the panel's own banner said *"Could
   * not read everything the staff can reach: EACCES: permission denied"* and the section
   * underneath it said **"0 at a desk · Nobody works here yet. Hire somebody and a desk appears
   * for them."** Both at once, on the one surface whose entire job is showing who works here.
   */
  readonly staffUnreadable: boolean
  /** Agent ids whose file is `.off`. Real employees; not at a desk. */
  readonly benched: readonly string[]
  /** `null` when the shelf could not be read — which is not the same as an empty shelf. */
  readonly shelf: readonly ShelfRow[] | null
  /**
   * Every skill on disk, as the office described it.
   *
   * Joined onto the shelf by id so a row can say what the skill *does*. The office reads a
   * name and a description out of every skill's frontmatter and ships both on the snapshot,
   * and until now the app used the array's `length` twice and dropped the rest — so the shelf
   * offered `graphify · used 3×` and no way to find out what that is, while the sentence
   * explaining it sat one field away.
   */
  readonly skills: readonly SkillInfo[]
  /**
   * Tools an employee will reach for that no configured server can answer, by agent id.
   *
   * From the capability survey — `mcp__notion__search` declared by an agent in a workspace with
   * no `notion` server. The call does not fail loudly: the agent reaches, gets nothing, and
   * reports that it could not do the thing. From the outside that is indistinguishable from the
   * agent being bad at its job, which is why it belongs on the row for that agent rather than in
   * a diagnostics panel nobody opens.
   */
  readonly dangling: ReadonlyMap<string, readonly string[]>
  /**
   * Built-in tools an employee declares that this workspace will refuse, by agent id.
   *
   * The same fault as `dangling` one layer down, and it shipped: `WebFetch` sat in five agents'
   * tool lists and in neither `allow` nor `deny`, so it was unlisted and refused — while this
   * panel printed it under all five names. A capability the roster asserts and the office cannot
   * deliver is standing order 3 broken on the surface built to describe the staff.
   */
  readonly unreachable: ReadonlyMap<string, readonly string[]>
}

/** What one person's row says. `actions` is exactly the set of buttons that may be offered. */
export interface StaffRow {
  readonly id: string
  /** MCP tools this agent declares that nothing can answer. Empty for almost everybody. */
  readonly dangling: readonly string[]
  /** Built-in tools this agent declares that the workspace will refuse. */
  readonly unreachable: readonly string[]
  readonly name: string
  readonly description: string
  readonly model: string | null
  readonly badges: readonly string[]
  /** The tools sentence, and whether it is the case worth colouring. */
  readonly tools: { readonly text: string; readonly warn: boolean }
  /**
   * True when this row's tools are the ones most of the office has.
   *
   * Measured on `dev`: `Read · Write · Edit · Glob · Grep · Bash · WebFetch` printed **verbatim
   * under every employee**, identical for backend, builder and frontend. Six appearances of one
   * fact. A line that is the same on every row is not telling you about the row — it is telling
   * you about the office, once, in six places, and it cost about 20px of every card.
   *
   * So the common list is printed once, above the staff, and rows that match it say so. Rows
   * that *differ* still print their own, because that is the case where the line means
   * something. Nothing is hidden: it moves to where it is true.
   */
  readonly toolsAreCommon: boolean
  readonly actions: readonly ('bench' | 'unbench' | 'fire')[]
  /**
   * Why this person cannot be managed from here, or `null` when they can.
   *
   * Set for a name that could not be a filename. `roster.ts` in main refuses `bench` and `fire`
   * for one — correctly, since the id becomes a path — so offering the buttons meant two presses
   * ending in *"A name cannot contain a slash."* The row above this one already states the rule
   * for the manager: **not offered rather than offered and refused.** This is the same case, and
   * unlike the manager it needs a sentence, because "you cannot fire this one" is not something
   * anybody can infer from a name they did not choose.
   */
  readonly unmanageable: string | null
  readonly atDesk: boolean
}

/**
 * A tool list shared by three or more of the staff, or `null` when there is no such thing.
 *
 * **Three, and the number is a correction rather than a preference.** The plan claimed this list
 * was *"printed verbatim under every employee"*. Measured against the shipped `.claude/`, it is
 * not: `backend`, `builder` and `frontend` share exactly `Read · Write · Edit · Glob · Grep ·
 * Bash · WebFetch`, and `manager`, `memory-keeper`, `reviewer` and `tester` each have their own.
 * Three of seven, not six of six.
 *
 * The first version of this function asked for a strict majority and therefore did nothing here,
 * which is how the overstatement was caught — it was written from the claim and disagreed with
 * the workspace.
 *
 * Two would be too few: two agents happening to agree is a coincidence, and collapsing on a
 * coincidence moves a line off the rows where it is the only thing distinguishing them. Three
 * agents with an identical seven-item list is not a coincidence — those three are the office's
 * implementers and they are meant to have the same reach.
 *
 * `null` tools never count. That is the case the roster exists to make loud — an agent
 * inheriting every tool including the one that dispatches other agents — and a surprise that got
 * quietly folded into "the usual" would be a bigger finding than this function may hide.
 */
const SHARED_BY = 3

export function commonTools(model: RosterModel): readonly string[] | null {
  const lists = model.staff
    .filter((m) => !m.isManager && m.tools !== null)
    .map((m) => (m.tools ?? []).join('\u0000'))
  if (lists.length === 0) return null

  const tally = new Map<string, number>()
  for (const key of lists) tally.set(key, (tally.get(key) ?? 0) + 1)

  const [key, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
  if (count < SHARED_BY) return null
  return key === '' ? [] : key.split('\u0000')
}

/** The line printed once above the staff, so no row has to repeat it. */
export function commonToolsLine(model: RosterModel): string | null {
  const common = commonTools(model)
  if (common === null) return null
  // "Several" rather than "most", because three of seven is not most, and the line is read by
  // somebody who can count the rows underneath it.
  return common.length === 0
    ? 'Several of the staff have no tools, and answer from context only.'
    : `Several share the same tools: ${common.join(' · ')}.`
}

/**
 * The sentence for somebody the office cannot act on, or `null`.
 *
 * Asked of `whyUnsafeAsPath` — the same function the write refuses with — so the courtesy and the
 * guarantee are one rule rather than two that can drift. The wording is the row's, because a
 * person reading a roster wants to know what to do, not which check fired.
 */
function cannotBeManaged(id: string): string | null {
  return whyUnsafeAsPath(id)
    ? `Their file says \`name: ${id}\`, which cannot be a filename — so the office cannot send them home or let them go. Fix the name in .claude/agents/, or remove the file by hand.`
    : null
}

export function staffRows(model: RosterModel): readonly StaffRow[] {
  const common = commonTools(model)
  const isCommon = (tools: readonly string[] | null): boolean =>
    common !== null && tools !== null && tools.join('\u0000') === common.join('\u0000')

  const at = model.staff.map(
    (member): StaffRow => ({
      id: member.id,
      name: member.name,
      description: member.description || 'No description in their file.',
      model: member.model,
      badges: member.isManager ? ['manager'] : [],
      tools: toolsSentence(member.tools),
      toolsAreCommon: isCommon(member.tools),
      dangling: model.dangling.get(member.id) ?? [],
      unreachable: model.unreachable.get(member.id) ?? [],
      // The manager is the office. Not offered rather than offered and refused — and the same
      // for a name the write path will not take, which is the other way to be unmanageable.
      actions: member.isManager || whyUnsafeAsPath(member.id) ? [] : ['bench', 'fire'],
      unmanageable: member.isManager ? null : cannotBeManaged(member.id),
      atDesk: true,
    }),
  )

  const off = model.benched.map(
    (id): StaffRow => ({
      id,
      name: id,
      description: `Their file is ${id}.md.off, so nothing on the floor can see them. Their prompt is untouched.`,
      model: null,
      badges: ['sent home'],
      // Unknown rather than none: their frontmatter is not in the snapshot, because discovery
      // cannot see the file. Saying "no tools" here would be inventing an answer.
      tools: { text: 'their file is not read while they are off', warn: false },
      // Never "the usual", because we did not look. Saying a benched employee has the common
      // tools would be inventing an answer about a file discovery cannot read.
      toolsAreCommon: false,
      // Same reason. The survey cannot read a `.off` file either, so an empty list here is
      // "we did not look", and it must not be drawn as "nothing wrong".
      dangling: [],
      unreachable: [],
      // The staff branch above says it: *the manager is the office, not offered rather than
      // offered and refused*. This branch did not, because a benched row is built from an id and
      // has no `isManager` to consult — their frontmatter is not in the snapshot.
      //
      // So it compares the id, and the honest account of what that covers is narrower than the
      // first version of this comment claimed. It argued that a `.off` file's `tools:` *cannot*
      // be read, so a benched agent could only be the manager by being called one. Both halves
      // were wrong: nothing stops `readFile` on a `.off` — the office *chooses* not to read one,
      // which is this module's whole thesis — and "nobody on the bench is the manager" is true
      // of every benched agent, because `findManager` reads `*.md`. It carried no conclusion.
      //
      // What this actually does is keep the shipped name off the bench's delete button. A file
      // called `boss.md.off` that would become the manager the moment it is brought back is not
      // covered, and that is the line: these guards are about the manager the office is running
      // on, and nobody on the bench is running it.
      actions: id === 'manager' || whyUnsafeAsPath(id) ? ['unbench'] : ['unbench', 'fire'],
      unmanageable: cannotBeManaged(id),
      atDesk: false,
    }),
  )

  return [...at, ...off]
}

/**
 * The three states `tools:` can be in, and which one deserves a colour.
 *
 * Only `null` warns. A named list is a normal agent and an empty list is a deliberate
 * read-only one; neither is a surprise. Inheriting everything is the surprise.
 */
export function toolsSentence(tools: readonly string[] | null): { text: string; warn: boolean } {
  if (tools === null) {
    return {
      text: 'inherits every tool — including the one that dispatches other agents',
      warn: true,
    }
  }
  if (tools.length === 0) return { text: 'no tools — answers from context only', warn: false }
  return { text: tools.join(' · '), warn: false }
}

/** The line under "Staff". Both numbers when there are two, so the second cannot hide at zero. */
export function staffCountLine(model: RosterModel): string {
  return model.benched.length > 0
    ? `${model.staff.length} at a desk · ${model.benched.length} benched`
    : `${model.staff.length} at a desk`
}

/** What the shelf section says when it has no rows to draw. `null` is a different sentence. */
export interface ShelfSummary {
  readonly count: string | null
  readonly empty: string | null
  /** True when `empty` is a failure to read rather than an honest zero. */
  readonly problem: boolean
}

export function shelfSummary(shelf: readonly ShelfRow[] | null): ShelfSummary {
  if (shelf === null) {
    return {
      count: null,
      empty: 'The shelf could not be read. This is not the same as it being empty.',
      problem: true,
    }
  }

  const onShelf = shelf.filter((s) => s.onShelf).length
  return {
    count: `${onShelf} on the shelf`,
    empty: shelf.length === 0 ? 'Nothing on the shelf, and nothing has ever been used.' : null,
    problem: false,
  }
}

/** How often a skill has been invoked, counted from the transcripts rather than from a counter. */
export function usesLine(row: ShelfRow): string {
  return row.count === 1 ? 'used once' : `used ${row.count}×`
}

/** One skill's row, with what it does rather than only how often it was reached for. */
export interface SkillRow {
  readonly id: string
  /** The name from its frontmatter, falling back to the id it is invoked by. */
  readonly name: string
  readonly description: string
  readonly onShelf: boolean
  readonly uses: string
  /** `last used …`, or the sentence for a skill nothing has invoked. Null for a removed one. */
  readonly when: string | null
}

/**
 * The shelf, joined to what each skill says about itself.
 *
 * The two fallbacks are the whole of the care here, and they are different sentences because
 * they are different facts:
 *
 * - **On the shelf, no description in the file.** The file was read and says nothing. Same case
 *   as an employee with no description, and the same words, because it is the same situation.
 * - **Off the shelf.** The file is *gone*. There is nothing to have read. Writing "no
 *   description" would report an absent file as an empty one, which is the fourth standing
 *   order, and the row exists precisely because deleting it would delete the evidence that the
 *   office once relied on this skill.
 */
export function skillRows(model: RosterModel): readonly SkillRow[] {
  const described = new Map(model.skills.map((s) => [s.id, s]))

  return (model.shelf ?? []).map((row): SkillRow => {
    const skill = described.get(row.id)
    return {
      id: row.id,
      name: skill?.name || row.id,
      description: row.onShelf
        ? skill?.description || 'No description in its file.'
        : 'Its file is gone. What it did is no longer on disk; this row is the record that it was used.',
      onShelf: row.onShelf,
      uses: usesLine(row),
      when: row.lastUsed ? `last used ${row.lastUsed}` : row.onShelf ? 'never invoked in this project' : null,
    }
  })
}
