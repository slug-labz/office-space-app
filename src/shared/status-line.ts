/**
 * The line under the floor: how many people work here, and how much is on the shelf.
 *
 * It is on screen permanently, which is what makes it worth its own module. Two counts, and a
 * count is the easiest place in an interface to state something you do not know — `0 skills`
 * from a shelf that could not be opened reads exactly like `0 skills` from a shelf with nothing
 * on it, and only one of those is a fact about the workspace.
 *
 * That is the fourth standing order, and this app has now got it wrong in four places in one
 * day: the unfinished-work count above the reason the ledger would not open, the first-run
 * panel telling somebody nobody worked there, the same panel telling them their projects were
 * gone, and this. The other three were caught by opening the app with a directory made
 * unreadable; this one is here so it can be caught by a test instead.
 *
 * Extracted rather than written inline because `app.ts` imports electron at load and no
 * `node:test` file can reach it. The boundary is the reason, not the harness — the same move
 * `firstRunVerdict` and `firstFocusable` were pulled out for.
 */

/** The shape this needs from a discovery problem, and nothing more. */
export interface CountedProblem {
  readonly kind: string
  readonly path?: string
}

export const unreadableUnder = (problems: readonly CountedProblem[], segment: string): boolean =>
  problems.some(
    (p) =>
      (p.kind === 'unreadable-dir' || p.kind === 'unreadable-file') &&
      typeof p.path === 'string' &&
      p.path.replace(/\\/g, '/').includes(segment),
  )

/**
 * How many people are at a desk, or that we could not find out.
 *
 * The count is only a count of the staff when every agent file could be read. Otherwise it is a
 * count of the ones we managed to read, which is a different number with the same digits.
 */
export function staffPart(staffCount: number, problems: readonly CountedProblem[]): string {
  if (unreadableUnder(problems, '.claude/agents')) return 'staff could not all be read'
  return `${staffCount} on the floor`
}

/**
 * What is on the shelf, or that we could not look.
 *
 * `1 skills` is reachable and this line is permanent, which is why the singular is spelled out
 * rather than left to a plural that is right most of the time.
 */
export function shelfPart(skillCount: number, problems: readonly CountedProblem[]): string {
  if (unreadableUnder(problems, '.claude/skills')) return 'shelf could not be read'
  return skillCount === 1 ? '1 skill' : `${skillCount} skills`
}

/**
 * What the composer invites you to type, or why it cannot.
 *
 * Three states, and it had two. `app.ts` read
 *
 *     els.composer.placeholder = manager ? `Ask ${who} for something…`
 *                                        : 'Nobody works here yet — hire somebody to get started'
 *
 * and `manager` is `null` both when there genuinely is nobody **and when `.claude/agents/` could
 * not be opened**. Measured with that directory chmod 000: the status line said *"staff could not
 * all be read"*, the first-run panel said *"There may be employees in .claude/agents/ — this
 * office could not open it to find out"*, and it said of every file *"this is not the same as it
 * being empty"* — and then the composer, the one surface with the cursor in it, said **nobody
 * works here**.
 *
 * Every other surface on that screen got it right. This is the one somebody is looking at.
 *
 * Here rather than in `app.ts` for the reason the rest of this file is here: it is a decision,
 * `app.ts` cannot be loaded by a test, and it is the same distinction `staffPart` already draws
 * two functions up — so it uses the same predicate rather than a second one that can disagree.
 */
export function composerInvite(
  manager: string | null,
  problems: readonly CountedProblem[],
): string {
  if (manager !== null) return `Ask ${manager} for something…`
  if (unreadableUnder(problems, '.claude/agents')) {
    return 'The staff could not be read, so nobody here can answer yet'
  }
  return 'Nobody works here yet — hire somebody to get started'
}

/** The whole line, as it appears under the floor. */
export function statusLine(
  staffCount: number,
  skillCount: number,
  problems: readonly CountedProblem[],
): string {
  return `${staffPart(staffCount, problems)} \u00b7 ${shelfPart(skillCount, problems)}`
}

/**
 * What the mode banner and the empty transcript say when there is nobody to listen.
 *
 * `null` means a manager really is there and the ordinary sentence stands.
 *
 * ## Why this exists
 *
 * `composerInvite` above was written to fix exactly this on the composer, and its own comment
 * ends *"Every other surface on that screen got it right. This is the one somebody is looking
 * at."* That was not true, and the two that got it wrong are the two largest pieces of text on
 * the screen. On a workspace with no employees the composer correctly read *"Nobody works here
 * yet — hire somebody to get started"* and was disabled, while directly above it the banner said
 * **"The manager is listening"** with a live *"That's the whole vision"* button, and the
 * transcript said **"The office is waiting. Say something to the manager and watch the floor."**
 *
 * One screen, three surfaces, two of them inviting somebody to talk to a manager that does not
 * exist — and the one that told the truth was the small grey placeholder inside the disabled box.
 *
 * The same predicate as `composerInvite`, deliberately: three states, not two. `manager` is
 * `null` both when there is genuinely nobody and when `.claude/agents/` could not be opened, and
 * a surface that collapses those says the office is empty when it cannot see.
 */
export function nobodyListening(
  manager: string | null,
  problems: readonly CountedProblem[],
): string | null {
  if (manager !== null) return null
  if (unreadableUnder(problems, '.claude/agents')) {
    return 'The staff could not be read, so nobody here can answer yet.'
  }
  // The words the first-run panel already uses, so the two surfaces do not describe one state in
  // two voices.
  return 'Nobody works here yet, so there is no manager to answer you.'
}
