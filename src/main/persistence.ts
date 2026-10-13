/**
 * What this app leaves on disk, in one place, so the question can be answered.
 *
 * The aim this round is a tool somebody can be given, and *"it should not leak everything"* is
 * one of the conditions. That is not answerable by intent — it is answerable by a list. This is
 * the list, and it is code rather than prose so it can be tested and so the packaging config can
 * be checked against it.
 *
 * ## The distinction that matters
 *
 * **What ships** and **what accumulates** are different things and only one of them is safe to
 * hand somebody.
 *
 * The office ships as a template: agents, skills, the project scaffold. Those are the office.
 * What accumulates as you use it — what you asked, what the agents found, what you told the
 * memory-keeper to remember — is yours, and no version of "share the app" should include any
 * of it. A clone that arrived with somebody else's memory would be a worse failure than one
 * that arrived with no agents at all: the second is obviously broken and the first is not
 * obviously anything.
 */

/** Where something lives, and whether it may be handed to another person. */
export interface Store {
  /** Relative to the workspace root. */
  readonly path: string
  readonly what: string
  /**
   * `template` — ships with the app, the same for everybody, seeded on first run.
   * `yours` — accumulates as you work. **Never ships, never seeds, never committed.**
   */
  readonly kind: 'template' | 'yours'
  /** True when deleting it loses something a person would miss. */
  readonly precious: boolean
  /**
   * Direct children that ship with the repo, inside a store that is otherwise yours.
   *
   * A `yours` store is not always empty on a fresh clone. `projects/` arrives with `_TEMPLATE`
   * and a `README.md`, `memory/` with a `README.md` and a `.gitkeep` — all four are in
   * `.gitignore` as exceptions, which is the definition of shipped. They are nobody's work, and
   * the privacy panel counts what it calls *"N B of yours"*.
   *
   * One list because it was two, and they disagreed. `measure` skipped `_TEMPLATE`; `forget`
   * skipped `_TEMPLATE` and `README.md`. So on a fresh clone with nothing in it the panel said
   * `projects` held 812 B of yours, and clicking Delete left the number exactly where it was —
   * the one panel whose whole job is telling the truth, reporting a shipped file as the user's
   * and then failing to remove what it had just offered to remove. `memory` had the opposite:
   * `forget` deleted the whole directory, taking a git-tracked file out of the clone with it.
   */
  readonly shipped?: readonly string[]
}

/**
 * Everything this app reads or writes under a workspace.
 *
 * Adding a store here and not to `.gitignore` — or shipping a `yours` store in the package —
 * is what the tests below exist to catch. A new store that nobody adds to this list is invisible
 * to every check in the repo, which is the failure mode this file is trying to prevent rather
 * than an accident it can rule out.
 */
export const STORES: readonly Store[] = [
  {
    path: '.claude/agents',
    what: 'The staff. One file per employee.',
    kind: 'template',
    precious: false,
  },
  {
    path: '.claude/skills',
    what: 'What the staff know how to do.',
    kind: 'template',
    precious: false,
  },
  {
    path: '.claude/commands',
    what: 'Slash commands.',
    kind: 'template',
    precious: false,
  },
  {
    path: '.claude/settings.json',
    what: 'What the office may run without asking.',
    kind: 'template',
    precious: false,
  },
  {
    path: 'projects/_TEMPLATE',
    what: 'The scaffold a new project is copied from.',
    kind: 'template',
    precious: false,
  },
  {
    path: 'projects/README.md',
    what: 'What a project is, for somebody opening the directory.',
    kind: 'template',
    precious: false,
  },
  {
    // Everything under `projects/` **except** `_TEMPLATE`. The split is the whole point: the
    // scaffold is the office and ships; what you write into it is your work and does not.
    // Listing `projects` as one store shipped the developer's own plans to every user, which is
    // what test/persistence.test.ts caught in a config written two hours earlier.
    path: 'projects',
    what: 'Your work: plans, progress, task lists.',
    kind: 'yours',
    precious: true,
    // `_TEMPLATE` is the scaffold a new project is copied from — removing it leaves the office
    // unable to start one — and `README.md` explains the convention. Neither is anybody's work.
    shipped: ['_TEMPLATE', 'README.md'],
  },
  {
    path: 'memory',
    what: 'What the office remembers about you and your work.',
    kind: 'yours',
    precious: true,
    // `.gitkeep` is what makes the directory exist in a fresh clone at all, and its absence is
    // the difference the panel draws between "never created" and "empty".
    shipped: ['README.md', '.gitkeep'],
  },
  {
    path: '.office-space/sessions.json',
    what: 'Which conversations exist, so the app can reopen them.',
    kind: 'yours',
    // Losing it loses the list, not the conversations — those are Claude Code's own transcripts.
    precious: false,
  },
  {
    path: '.office-space/approvals',
    what: 'Tool calls waiting for a decision, the decisions you made, and every one nobody answered in time.',
    kind: 'yours',
    /*
     * Both halves of the old entry were wrong, and in opposite directions.
     *
     * It said *"and the decisions"* — which was, when it said it, the one thing this store did
     * **not** keep. The hook's `cleanup()` unlinks the verdict the instant it has been read, so a
     * decision somebody actually made was the shortest-lived file here, and the panel advertised
     * the only content that was always gone.
     *
     * It says it again now, and this time it is true. The gate files an answered request under
     * `decided/`, so what the rendezvous deletes the record keeps. Corrected in the same change
     * that made it true rather than left to be noticed later — which is the mistake the ledger's
     * own entry below records happening once already, and the reason this entry needed correcting
     * in the first place.
     *
     * And its comment said *"Transient by design: a request outlives neither the hook that wrote
     * it nor the run"*, which is false of `missed/`. **Nothing removes anything from `missed/`,
     * anywhere.** Three kinds of site touch it in the whole repo — the gate's `missed()` renames
     * in, `approvalRecord` reads the names out, and `tally` buckets them for the panel to render.
     * **Nothing prunes it**, so a request nobody answered outlives the hook, the run, and every
     * run after it.
     *
     * One thing does delete it, and it is the Delete button below rather than a pruner:
     * `privacy.ts`'s `forget()` empties this store of everything not in its `shipped` list, and
     * this store has none. Measured — two filed requests, `forget()` returns `{ ok: true }`, the
     * directory comes back empty. That is a person choosing to clear it, which is the remedy the
     * paragraph below is about; it is not a code path that trims the record as it grows.
     *
     * That was not merely a stale comment. `main.ts` reported the count as a present condition
     * with present-tense advice — *"N approvals were asked for and nobody answered them in time"*
     * — and nothing could ever reduce N. One unattended night put twelve on the status bar; a
     * month of them put forty there, and no day of perfect attendance took any of it back. Fixed
     * since: both halves carry a time, so the surface reports a window and says separately what
     * falls outside it. The store is still append-only, which is why the paragraph above stays.
     *
     * ## `precious`, argued from the data rather than from the button
     *
     * *"True when deleting it loses something a person would miss"* — the field's own definition,
     * and a claim about contents. It was `false` and unexamined.
     *
     * A first attempt here justified keeping it `false` on the grounds that `precious` only makes
     * the delete heavier, and deleting this store is the sole way to clear the count `main.ts`
     * reports. That is an argument from what the flag *does*, and taking it would leave
     * `precious: false` sitting on an unbounded pile of refused-command records — a false claim
     * about contents, one line under a comment being fixed for making a false claim about
     * contents.
     *
     * Argued from the data, it is `true`. `missed/` holds every tool call an employee made that
     * nobody was there to answer, each with the command verbatim, and it is the **only** record
     * that any of it happened — that is the whole reason `missed()` files rather than deletes.
     * The ledger beside this is `precious` for a version of the same claim: it holds work nobody
     * has seen yet, and these are refusals nobody has seen yet.
     *
     * The friction is wanted here for a second reason, found while arguing the first. The button
     * takes the whole store, including a request in flight — and `missed()` opens with
     * `if (!existsSync(ask)) return`, so a call deleted out from under the gate is refused at the
     * deadline and filed nowhere. Clearing the count can cost a live approval and leave no mark
     * in the very directory whose count was being cleared, and the count is highest exactly when
     * the office is running unattended, which is when a call is most likely to be in flight.
     *
     * What this does not fix: `main.ts` still never says the count can be cleared, or how. That
     * is the smaller defect and it now matters more, since the only remedy is behind the heavier
     * control. It belongs on the lint, not in this field.
     */
    precious: true,
  },
  {
    path: '.office-space/dispatches.jsonl',
    what: 'What each employee was asked to do, and what came back.',
    kind: 'yours',
    /*
     * Precious, and the most personal thing under `.office-space/`.
     *
     * Every line is a brief in the words somebody wrote — the whole `Task` prompt, not the
     * summary — plus whatever came back. `ledger.ts` keeps it precisely so a run that died
     * mid-dispatch can be offered back on the next launch, which means it is the one file here
     * that holds work nobody has seen yet.
     *
     * It was not on this list. The panel's claim is *what is on disk, and one delete each*, and
     * the ledger arrived after the list was written — so the panel measured nine stores and this
     * one sat beside them, unmentioned and undeleteable.
     */
    precious: true,
  },
  {
    path: '.office-space/floor.ndjson',
    what: 'An event log the office no longer writes. Left over; safe to delete.',
    kind: 'yours',
    /*
     * Nothing writes this any more. `approvals.ts` notes it in passing — *"`.office-space/` used
     * to hold `floor.ndjson`, an event log nobody read"* — and the code that wrote it is gone.
     *
     * Listed rather than deleted on launch. It is megabytes of somebody's own history on the
     * machines that ran the old version, and an app that quietly removed a file at startup
     * because it believed the file was obsolete is *exactly* the shape of the bug that used to
     * eat this office's conversations. The panel's job is to show what is on disk and offer one
     * delete each; that is the honest way for this to go.
     */
    precious: false,
  },
]

/** Nothing here may be handed to another person. */
export function yours(): readonly Store[] {
  return STORES.filter((s) => s.kind === 'yours')
}

/** The office itself: the same for everybody, safe to ship and to seed. */
export function template(): readonly Store[] {
  return STORES.filter((s) => s.kind === 'template')
}

/**
 * What a person should be told before deleting a store.
 *
 * `null` when there is nothing to warn about. A confirmation on everything is a confirmation
 * nobody reads, and then the one that mattered gets clicked through as reflex.
 *
 * **No caller in `src/`.** The confirmation happens — `views/privacy.ts` arms the Delete button
 * and reads `store.precious` itself to say *"Delete 4.2 kB permanently — click again"* — so the
 * promise this describes is kept, by a path that does not go through here. What is not shown is
 * this function's second sentence: that the data is not in git, and that this is deliberate.
 *
 * Said here rather than deleted, because the sentence is worth having if anybody wires the two
 * together, and rather than left silent, because an exported function with a doc like this reads
 * as the thing doing the work. `unused-types.mjs` cannot see it — it counts a reference from a
 * test, and this has six.
 */
export function warnBeforeDeleting(path: string): string | null {
  const store = STORES.find((s) => s.path === path)
  if (!store || !store.precious) return null
  return `${store.what} This cannot be recovered — it is not in git, and that is deliberate.`
}
