/**
 * What a push would include, and what stays on this machine.
 *
 * VISION.md's seventh section is distribution — *"clone it and it's yours"* — and it makes one
 * promise about the direction back out:
 *
 *     **Memory and personal data are never pushed.** The repo ships the office; the contents stay
 *     yours.
 *
 * `.gitignore` implements that, carefully, with a comment at the top saying exactly this. And
 * nothing in the app has ever shown it. To find out whether the thing you just typed is about to
 * be shared with everyone who clones your office, you have to leave and read a dotfile.
 *
 * That was tolerable while the office wrote only into places `.gitignore` covers. It stopped
 * being tolerable when the office learned to write `.mcp.json`, which is **deliberately not
 * ignored** — sharing a team's connector setup is the point, and the reason that is safe is a
 * rule in `connector.ts` about `${VAR}` rather than anything a person can see.
 *
 * ## The answer comes from git, never from a list here
 *
 * The tempting shape is a table in this file saying which paths are ignored. It would agree with
 * `.gitignore` on the day it was written and drift from it silently afterwards — two definitions
 * of one fact, which is the bug this codebase meets more than any other. So the *expectation*
 * lives here and the *answer* is asked of git, and the interesting output is where they differ.
 *
 * ## Four answers, not two
 *
 * `ignored` and `not ignored` are the two everybody thinks of. The other two are the reason this
 * is a module rather than a boolean:
 *
 * - **not a repository** — nothing is being pushed anywhere, so nothing is at risk, and saying
 *   "your memory is safe" would be true for a reason that stops applying the moment somebody runs
 *   `git init`.
 * - **could not ask** — git is missing, or the command failed. That is *unknown*, and unknown may
 *   never be drawn as safe. The fourth standing order, about the one file where being wrong means
 *   somebody's notes are on GitHub.
 */

/** Which side of the line something the office writes is meant to be on. */
export type Side = 'yours' | 'shipped'

/** One thing the office writes, and where it belongs. */
export interface Written {
  /** Repo-relative, as a person would name it. */
  readonly path: string
  readonly what: string
  readonly side: Side
  /** True when `path` names a directory. Decides what git is actually asked — see `probe`. */
  readonly directory: boolean
}

/**
 * The path to hand `git check-ignore`, which is not always the path to show.
 *
 * **Asking about a bare directory is always the wrong question.** `memory/**` matches files
 * *inside* `memory` and not `memory` itself, so `check-ignore memory` answers *not ignored* about
 * a directory whose every file is ignored — and the panel would report the office leaking your
 * notes while `.gitignore` was doing exactly its job. `.office-space/` behaves the other way and
 * matches the directory, so neither style can be relied on alone.
 *
 * A child is matched by both. Verified against real repositories with both rule styles, which is
 * how this was found: the first version asked about the directory and reported three false leaks.
 */
export function probe(written: Written): string {
  return written.directory ? `${written.path}/anything` : written.path
}

/** What git said about a path. */
export type Asked =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'tracked' }
  | { readonly kind: 'no-repo' }
  | { readonly kind: 'unknown'; readonly why: string }

/** How a thing's expected side compares with what git actually says. */
export type Verdict =
  /** Yours, and git agrees. */
  | 'kept'
  /** Shipped, and git agrees. */
  | 'shared'
  /** Meant to be yours and **would go out**. The one that matters. */
  | 'leaking'
  /** Meant to ship and is ignored — surprising, and nobody's data is at risk. */
  | 'withheld'
  /** Not a git repository, so nothing is being pushed at all. */
  | 'nowhere'
  /** Git could not be asked. Never drawn as safe. */
  | 'unknown'

export function verdictFor(written: Written, asked: Asked): Verdict {
  switch (asked.kind) {
    case 'no-repo':
      return 'nowhere'
    case 'unknown':
      return 'unknown'
    case 'ignored':
      return written.side === 'yours' ? 'kept' : 'withheld'
    case 'tracked':
      return written.side === 'yours' ? 'leaking' : 'shared'
  }
}

/**
 * The things the office writes into a workspace.
 *
 * Hand-written, because nothing can derive it — and guarded by a test that scans the main process
 * for writes and fails if one lands somewhere not listed here. A list like this is only worth
 * having if forgetting to update it is louder than the thing it was meant to catch.
 */
export const WRITES: readonly Written[] = [
  { path: '.claude/agents', what: 'The employees. Hiring writes one file each.', side: 'shipped', directory: true },
  { path: '.claude/skills', what: 'What the staff know how to do.', side: 'shipped', directory: true },
  {
    path: '.mcp.json',
    what: 'Connectors. Written with ${VARIABLE} references and never a secret — which is the only reason this one can be shared.',
    side: 'shipped',
    directory: false,
  },
  { path: 'memory', what: 'What the office remembers about you and your work.', side: 'yours', directory: true },
  { path: 'projects', what: 'Your projects: their plans, progress and tasks.', side: 'yours', directory: true },
  {
    path: '.office-space',
    what: 'Which conversations exist, and where each employee came from.',
    side: 'yours',
    directory: true,
  },
  {
    path: '.claude/settings.local.json',
    what: 'Permissions you granted on this machine.',
    side: 'yours',
    directory: false,
  },
  /*
   * Everything below is seeded into a workspace and was missing from this list, which meant the
   * panel answering *"what would a push carry"* was answering about 17 of the 28 files the office
   * actually puts there.
   *
   * The guard beneath this list could not see them. It scans the main process for
   * `cp(join(root, CONST))` and the seed copies `.claude` whole, in a loop whose target is a
   * variable rather than a constant — so the one call that installs six of these resolved to
   * nothing and was skipped. The check and the thing checked never met.
   */
  {
    path: '.claude/hooks',
    what: 'The approval gate. An executable this app installs, which every tool call in this workspace passes through — including calls from a plain terminal `claude` session.',
    side: 'shipped',
    directory: true,
  },
  {
    path: '.claude/commands',
    what: 'Slash commands the office ships. Typeable by anyone working in this workspace.',
    side: 'shipped',
    directory: true,
  },
  {
    path: '.claude/settings.json',
    what: 'The workspace permission rules, and the registration for the approval gate above. Meant to be shared — `settings.local.json` is the one that stays.',
    side: 'shipped',
    directory: false,
  },
  {
    path: 'CLAUDE.md',
    what: 'The standing instructions every agent here reads before doing anything.',
    side: 'shipped',
    directory: false,
  },
  {
    path: '.gitignore',
    what: 'What the office asks git to leave alone — which is what keeps your memory and conversations off a remote.',
    side: 'shipped',
    directory: false,
  },
  {
    path: 'assets/themes',
    what: 'Art the floor is drawn with.',
    side: 'shipped',
    directory: true,
  },
]

/**
 * One line for a row, in the register the rest of the office speaks.
 *
 * Plain text, with no markdown in it. These go into a `textContent`, so a `**not**` meant as
 * emphasis arrives as two pairs of asterisks — seen in the running app, on the one row a person
 * most needs to read. The emphasis is the row's colour instead, which is a thing the panel can
 * actually render.
 *
 * Takes the description rather than a whole `Written`, so the row that crosses the bridge — which
 * carries a verdict and no `directory` flag, because the renderer has no use for one — can be
 * passed as it is instead of being reassembled into a shape it is not.
 */
export function saidPlainly(what: string, verdict: Verdict): string {
  switch (verdict) {
    case 'kept':
      return 'Stays on this machine. Git is told to ignore it.'
    case 'shared':
      return 'Goes with the repository, so everyone who clones your office gets it.'
    case 'leaking':
      return `Git is not ignoring this, so a push would publish it. ${what}`
    case 'withheld':
      return 'Git is ignoring this, so it will not go out with the office. Nobody’s data is at risk; it just will not arrive.'
    case 'nowhere':
      return 'This workspace is not a git repository, so nothing is being pushed anywhere yet.'
    case 'unknown':
      return 'Git could not be asked about this, so nothing is known about whether it would be pushed.'
  }
}

/**
 * The sentence above the list.
 *
 * Leads with the bad news when there is any, because a summary that opens with *"6 of 7 correct"*
 * buries the one that is not, and the one that is not is somebody's memory directory on GitHub.
 */
export function sharingLede(verdicts: readonly Verdict[]): string {
  if (verdicts.length === 0) return 'Nothing is known about what the office writes.'

  const leaking = verdicts.filter((v) => v === 'leaking').length
  if (leaking > 0) {
    return `${leaking === 1 ? 'One thing' : `${leaking} things`} meant to stay on this machine would be included in a push.`
  }

  const unknown = verdicts.filter((v) => v === 'unknown').length
  if (unknown === verdicts.length) return 'Git could not be asked, so nothing here is known.'
  if (unknown > 0) {
    return `Nothing known to be private would be pushed, and ${unknown} could not be checked — which is not the same as safe.`
  }

  if (verdicts.every((v) => v === 'nowhere')) {
    return 'This workspace is not a git repository. Nothing is being pushed anywhere, and this becomes a real question the day it is.'
  }

  const withheld = verdicts.filter((v) => v === 'withheld').length
  if (withheld > 0) {
    return `Your work stays yours. ${withheld === 1 ? 'One part' : `${withheld} parts`} of the office is ignored too, so it will not travel with the repository.`
  }

  return 'Your work stays yours, and the office ships without it.'
}

/**
 * Whether each row should say what a push would do with it.
 *
 * `nowhere` is a fact about the *workspace* — there is no repository, so nothing about any path
 * is being pushed — and `sharingLede` already says it once, well, at the top. Repeating it on
 * every row produced the sentence *"This workspace is not a git repository, so nothing is being
 * pushed anywhere yet"* **seven times** on one panel, under a heading that had just said it.
 *
 * A reader scanning seven identical lines learns nothing from six of them, and the panel's whole
 * job is that a row which differs should be visible. Uniform noise is the worst possible
 * background for that.
 *
 * A set-level question, deliberately: a row cannot know that the sentence above it has already
 * covered the case. `every` rather than `some`, so a mixed list — if one is ever reachable —
 * keeps its per-row answers rather than losing them to a lede that only spoke for some.
 */
export function rowsSayVerdict(verdicts: readonly Verdict[]): boolean {
  return verdicts.length > 0 && !verdicts.every((v) => v === 'nowhere')
}
