/**
 * Employees somebody else maintains.
 *
 * VISION.md's fourth section is the shareable-employee model, and its example is a colleague:
 *
 *     A senior engineer reviews the team's pull requests and already shares a review agent. So
 *     Office Space can live on the company GitHub, and they maintain that review agent there.
 *     It becomes an employee under the manager — **they control and edit it in that repo**, and
 *     it's always available to review our code, working like the real person would.
 *
 * The naive build of this is a download button, and it is wrong in a way that is invisible for
 * months. Copying `wren-review.md` into `.claude/agents/` gives you *a snapshot of what their
 * reviewer was on the day you copied it*. The roster then says "a colleague's reviewer" — a real
 * person's name, a real person's judgement — about a file that person has since rewritten twice.
 * Nothing on screen may lie, and a name is the loudest claim on it.
 *
 * So the thing worth building is not the copy. It is the **answer to "is this still theirs?"**,
 * and the copy is what makes the question askable.
 *
 * ## Two facts, not one
 *
 * The tempting shape is one status: up to date, out of date, unknown. It is wrong, and it is
 * wrong in this codebase's most familiar way — two different facts flattened into one word that
 * agrees with both until a case pulls them apart.
 *
 * The two facts are independent and both matter:
 *
 * - **here** — has *our* copy changed since we hired it? Somebody may have tuned their reviewer
 *   for this repo. That is allowed, and it is theirs to know about.
 * - **there** — has *their* file changed since we hired it? That is the update.
 *
 * A single status has to pick one to report. Both-changed is then either "out of date" (and a
 * one-click update silently destroys work somebody did here) or "edited locally" (and their
 * three months of improvements never arrive). Keeping them apart costs one extra field and makes
 * the fourth case sayable, which is the only reason it can be handled.
 *
 * ## The silences are different too
 *
 * `there` has three ways of not being a hash, and collapsing them is the same mistake again:
 *
 * - **unchecked** — we have not looked. Not the same as up to date, and the resting state.
 * - **unreachable** — we looked and could not get there. The network, the credentials, the repo
 *   moved. Says nothing about the file.
 * - **withdrawn** — we reached the source and the file is not in it. The colleague deleted it.
 *   That is a decision by the person whose name is on it, and it is the one case where the
 *   employee sitting in our roster is genuinely unbacked.
 *
 * Wifi being off must never render as a colleague retiring their reviewer.
 */

/** Where an employee is kept, when it is not kept here. */
export interface Source {
  /** A git remote to clone, or a directory already on this machine. */
  readonly kind: 'git' | 'directory'
  /** The remote or path, as it was given. Shown back verbatim — it is what somebody typed. */
  readonly at: string
  /** Which file inside the source, e.g. `agents/wren-review.md`. Always source-relative. */
  readonly file: string
}

/** What the office wrote down when it hired somebody from a source. */
export interface Provenance {
  /** The agent id in `.claude/agents/`, which may differ from the file name at the source. */
  readonly id: string
  readonly source: Source
  /** The source file's digest at the moment of hiring — the fixed point both sides are read against. */
  readonly hiredHash: string
  /** ISO date. Absolute, because "3 months ago" is only true on the day it is written. */
  readonly hiredAt: string
}

/** What a look at the source found. */
export type Found =
  | { readonly seen: true; readonly hash: string }
  | { readonly seen: false; readonly why: 'withdrawn' | 'unreachable'; readonly detail: string }

/**
 * The two facts, kept apart.
 *
 * Neither field is derivable from the other, and no combination of them is impossible — which is
 * the test that they are really two facts and not one wearing a disguise.
 */
export interface Standing {
  readonly here: 'as-hired' | 'edited' | 'missing'
  readonly there: 'as-hired' | 'moved-on' | 'withdrawn' | 'unreachable' | 'unchecked'
}

/**
 * Read both sides against the hash recorded at hire time.
 *
 * `ours` is `null` when the agent file is not in `.claude/agents/` any more — somebody fired them,
 * or renamed the file. `found` is `null` when nothing has looked at the source this run, which is
 * the state every row starts in: checking costs a clone, so it is asked for and not assumed.
 */
export function standingOf(p: Provenance, ours: string | null, found: Found | null): Standing {
  const here = ours === null ? 'missing' : ours === p.hiredHash ? 'as-hired' : 'edited'
  if (found === null) return { here, there: 'unchecked' }
  if (!found.seen) return { here, there: found.why }
  return { here, there: found.hash === p.hiredHash ? 'as-hired' : 'moved-on' }
}

/**
 * Whether taking their version can be offered as a plain action.
 *
 * Only when there is a new version *and* nothing here would be lost by it. Everything else is
 * either nothing to do or a choice somebody has to make with the facts in front of them, and a
 * button that quietly resolves it either way is the failure this module exists to prevent.
 */
export function updateIsSafe(s: Standing): boolean {
  return s.here === 'as-hired' && s.there === 'moved-on'
}

/**
 * Whether an update would destroy work done here.
 *
 * Separate from `updateIsSafe` on purpose: "not offered" and "offered with a warning" are
 * different surfaces, and a caller that only knows *unsafe* cannot tell which one it is looking
 * at. This is true for exactly one combination, and it is the combination a single-status design
 * cannot represent.
 */
export function updateWouldOverwriteLocalWork(s: Standing): boolean {
  return s.here === 'edited' && s.there === 'moved-on'
}

/**
 * One sentence, in the register the rest of the office speaks.
 *
 * Every branch names a person's action rather than a state word where it can — "they have changed
 * it" rather than "outdated" — because the whole point of the feature is that a real colleague is
 * on the other end of the file.
 */
export function saidPlainly(s: Standing): string {
  if (s.here === 'missing') {
    return s.there === 'unreachable'
      ? 'No longer in this office. Their copy was not reachable to compare.'
      : 'No longer in this office.'
  }
  const edited = s.here === 'edited'
  switch (s.there) {
    case 'unchecked':
      return edited
        ? 'Edited here since hiring. Not checked against theirs.'
        : 'Not checked against theirs.'
    case 'unreachable':
      return edited
        ? 'Edited here since hiring. Theirs could not be reached, so nothing is known about it.'
        : 'Theirs could not be reached, so nothing is known about it.'
    case 'withdrawn':
      return edited
        ? 'They have removed it where it was kept. The copy here has been edited and is now the only one.'
        : 'They have removed it where it was kept. The copy here is now the only one.'
    case 'as-hired':
      return edited ? 'Edited here since hiring. Theirs is unchanged.' : 'The same as theirs.'
    case 'moved-on':
      return edited
        ? 'They have changed theirs, and this copy has been edited here. Taking theirs would replace those edits.'
        : 'They have changed theirs since it was hired.'
  }
}

/**
 * Whether a location can be handed to `git` as a remote.
 *
 * Two refusals, both about the fact that this string is typed by a person into a box and then
 * becomes an argument to a program.
 *
 * **A leading dash is an option, not a URL.** `git clone --depth 1 --quiet <at> <dir>` parses
 * `--upload-pack=...` in the `<at>` position as a flag, and the flag it parses names a command
 * git will run. `openSource` also passes `--` before the remote so git stops looking for options,
 * and this check exists as well because a defence that only lives in the argv order is one
 * refactor away from being gone.
 *
 * **`ext::` is a remote helper, and helpers are commands.** `git clone "ext::sh -c whoami"` runs
 * `whoami`. It is a documented git transport, it is a real one somebody could want, and it is not
 * one this box is going to offer — the box is for a repository a colleague keeps agents in.
 *
 * Not injection through a shell: `execFile` is given an array and never sees one. This is the
 * other kind, where the program being run is the one interpreting the argument.
 */
export function whyNotASource(at: string): string | null {
  const trimmed = at.trim()
  if (!trimmed) return 'Give a repository URL or a directory on this machine.'
  if (trimmed.startsWith('-')) {
    return 'A source cannot start with a dash — git would read it as an option rather than a location.'
  }
  if (/^ext::/i.test(trimmed)) {
    return 'ext:: remotes run a command of their own rather than fetching a repository, so the office will not open one.'
  }
  return null
}
