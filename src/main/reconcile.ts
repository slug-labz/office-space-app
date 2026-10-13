/**
 * Bringing shipped `.claude/` files forward, without touching anything the user wrote.
 *
 * A workspace is seeded from what shipped **once** and never touched again — see
 * `workspace-root.ts`, which says why in as many words: *"an app that quietly reverted
 * somebody's agent file on upgrade would be worse than one that never shipped a template at
 * all."* That is the right rule. The price of it is that every fix we ship after somebody's
 * first launch never reaches them: a skill added last week is not in their office, and their
 * manager is running whatever `manager.md` said the day they installed. That has already
 * happened for real, and the only way it was put right was by hand, file by file.
 *
 * This module is the narrow way out, and it rests on one thing that can be *proved* rather than
 * guessed:
 *
 *   **A workspace file may be replaced only when its content hash matches some version of that
 *   file we have actually shipped.**
 *
 * If it matches a version we shipped, nobody has typed in it since it was copied there, so
 * replacing it cannot lose anything. If it matches none of them, the user edited it: it is
 * theirs, we do not touch it, we do not merge it, and we do not ask. We list it and move on.
 * `dist/shipped-hashes.json` carries every version of every file, recovered from git history by
 * `scripts/build.mjs`, so "some version we shipped" is a fact and not a hope.
 *
 * ## The four ways this could destroy something, and what stops each
 *
 * The hash rule only covers files that are *present*. Everything below is a way to get a write
 * onto a path it should never have reached, and each is refused here rather than hoped about.
 *
 *   **A file the user edited.** The hash rule. It is the whole design.
 *
 *   **A file the user deliberately removed.** This office can fire an agent (`roster.ts` unlinks
 *   the file) and remove a skill (`skills.ts` removes the directory). Both leave a shipped path
 *   absent — indistinguishable, from the path alone, from a skill we shipped after this office
 *   was seeded. So absence alone is not licence to write. Two things settle it: a *disabled*
 *   agent leaves `<name>.md.off` beside the gap, which is positive evidence of intent; and
 *   `.office-space/shipped.json` records what this workspace has already been given, so a path
 *   we gave it and that is now gone was taken away on purpose. See `keptBecauseRemoved`.
 *
 *   **A path that is not really inside the workspace.** `..` in a manifest key, an absolute
 *   path, a drive letter. `safeRelativePath` refuses anything that does not stay under the
 *   workspace root, because the cost of being wrong once is a write over an arbitrary file on
 *   somebody's machine.
 *
 *   **A symlink standing where a shipped file should be** — including a *dangling* one, which
 *   reads as ENOENT and would otherwise look like "not there yet". Writing to either follows the
 *   link and lands outside the workspace. Seeding writes real files, so a symlink at a shipped
 *   path is something the user put there: it counts as theirs and is left alone.
 *
 * ## Deciding and doing are separate
 *
 * `planReconcile` reads and returns a plan; nothing on disk moves until `applyReconcile` is
 * handed that plan. That is what lets the rule above be tested without a build, and it is why
 * the decision can be shown to somebody before it is acted on.
 *
 * Standing order 4 decides the failure case, and here it is not academic. A workspace file we
 * could not read is `unreadable` — never `added` — because "add it" means "write over that
 * path", and writing over a file we could not read is exactly the loss this module exists to
 * prevent.
 */

import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { safeRelativePath } from './safe-path.js'

// Re-exported because this is where it was written and where callers already look for it.
export { safeRelativePath } from './safe-path.js'
import type { Problem } from './workspace.js'
import { STATE_DIR } from './registry.js'
import { DISABLED_SUFFIX } from './roster.js'

// ─────────────────────────────────────────────────────────────────────────────
// The manifest
// ─────────────────────────────────────────────────────────────────────────────

export interface ShippedFile {
  /** sha256 of every version of this file that has ever shipped. Oldest first, current last. */
  readonly hashes: readonly string[]
  /** sha256 of the version this build ships. Always the last entry of `hashes`. */
  readonly current: string
}

export interface ShippedManifest {
  /** For whoever opens the manifest. Nothing in the app reads it; the file is the audience. */
  readonly generatedAt: string
  /** Keyed by path relative to a workspace root — `.claude/agents/manager.md`. */
  readonly files: Readonly<Record<string, ShippedFile>>
}

/** What every hash in here means. One definition, so the build and the app cannot disagree. */
export function hashOf(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Where a workspace records what it has been given. Gitignored, like the rest of `STATE_DIR`. */
const RECEIPT_FILE = 'shipped.json'

export function receiptPath(root: string): string {
  return join(root, STATE_DIR, RECEIPT_FILE)
}

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// Planning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What reconciliation would do, before any of it is done.
 *
 * Every shipped file lands in exactly one of these lists or in none at all — a file already
 * identical to what we ship needs no entry, because nothing happens to it.
 *
 * Six lists rather than four. `keptBecauseRemoved` and `unsafe` are both decisions *not* to
 * write, and a decision not to write is exactly the kind of thing that must not be invisible:
 * folded into silence, "we left your fired agent fired" and "we refused a path that pointed at
 * your home directory" would look identical to having found nothing to do.
 */
export interface ReconcilePlan {
  /** Provably an old shipped copy. Safe to replace: nobody has typed in it. */
  readonly updated: readonly string[]
  /** Matches no version we ever shipped, so the user wrote it. Left exactly as it is. */
  readonly keptBecauseEdited: readonly string[]
  /** Shipped, genuinely not here, and no sign it was ever taken away on purpose. */
  readonly added: readonly string[]
  /** Absent because this office removed it — fired, disabled, or deleted. Not resurrected. */
  readonly keptBecauseRemoved: readonly string[]
  /** Present, and we could not read it. **Not** missing, and never written over. */
  readonly unreadable: readonly string[]
  /** A manifest key that does not name a file inside this workspace. Refused, and reported. */
  readonly unsafe: readonly string[]
  /**
   * What each file to be updated actually held when the plan decided it was safe.
   *
   * A plan is a decision made from a read, and the write happens later. Between the two, the
   * file can change — an editor saving on a timer, a second instance starting, the office's own
   * hire flow writing an agent, a sync client. Without this, `applyReconcile` re-verified the
   * *source* against the manifest and never looked at the destination again, so it wrote over
   * whatever had arrived in the meantime.
   *
   * Demonstrated rather than argued, against the merged code: plan says update, the user saves
   * the file, apply writes anyway, and the edit is gone. That is the exact loss this module
   * exists to prevent, arriving through the one door nobody was watching.
   *
   * Absent for `added` — a file the plan found missing has no prior content to protect, and the
   * write itself refuses to clobber one that appeared since.
   */
  readonly sawInWorkspace: Readonly<Record<string, string>>
}

/** What this workspace has already been given, as last written down. */
export interface Receipt {
  readonly given: readonly string[]
}

/**
 * Read the receipt.
 *
 * `null` means there is no usable one — a workspace seeded before this existed, or a file we
 * could not read. Deliberately one answer for both: neither tells us what the office was given,
 * and pretending an unreadable receipt is an empty one would turn "I do not know" into "you
 * were given nothing", which is the mistake standing order 4 is about.
 */
export async function readReceipt(root: string): Promise<Receipt | null> {
  try {
    const parsed = JSON.parse(await readFile(receiptPath(root), 'utf8')) as { given?: unknown }
    if (!Array.isArray(parsed.given)) return null
    return { given: parsed.given.filter((p): p is string => typeof p === 'string') }
  } catch {
    return null
  }
}

/** Path order, so a plan reads the same twice and a test can compare it whole. */
function byPath(a: readonly [string, ShippedFile], b: readonly [string, ShippedFile]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
}

/** Whether the workspace still holds the trace `disable` leaves when it benches somebody. */
async function isDisabledInPlace(full: string): Promise<boolean> {
  try {
    await lstat(`${full}${DISABLED_SUFFIX}`)
    return true
  } catch {
    return false
  }
}

/**
 * Decide what may move in `workspaceRoot`, and touch nothing.
 *
 * Reads the workspace; writes nowhere. `receipt` is what the office has already been given —
 * `null` when there is no record, which is every workspace that existed before this shipped.
 * That case is called out at the branch where it matters.
 */
export async function planReconcile(
  manifest: ShippedManifest,
  workspaceRoot: string,
  receipt: Receipt | null,
): Promise<ReconcilePlan> {
  const updated: string[] = []
  const keptBecauseEdited: string[] = []
  const added: string[] = []
  const keptBecauseRemoved: string[] = []
  const unreadable: string[] = []
  const unsafe: string[] = []
  const sawInWorkspace: Record<string, string> = {}

  const given = new Set(receipt?.given ?? [])

  for (const [path, shipped] of Object.entries(manifest.files).sort(byPath)) {
    const full = safeRelativePath(workspaceRoot, path)
    if (full === null) {
      unsafe.push(path)
      continue
    }

    // Before the read, not after. A symlink — dangling or not — reads as either the target's
    // bytes or as ENOENT, and both would put this path on a list that ends in a write *through*
    // the link, landing outside the workspace entirely. Seeding writes real files, so a symlink
    // here is the user's own arrangement and is left exactly as it is.
    let link = false
    try {
      link = (await lstat(full)).isSymbolicLink()
    } catch {
      // Nothing to stat. The read below decides between "absent" and "cannot be read"; guessing
      // either from a failed `lstat` would be answering a question we have not asked yet.
    }
    if (link) {
      keptBecauseEdited.push(path)
      continue
    }

    let content: Uint8Array
    try {
      content = await readFile(full)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Something is there and we are ignorant of it, which is not the same fact as nothing
        // being there. It is never written over on the strength of a failed read.
        unreadable.push(path)
        continue
      }

      // ENOENT — the path holds nothing, so a write here would land on nothing of the user's.
      // That is necessary and not sufficient: this office deletes shipped files on purpose when
      // somebody fires an agent or removes a skill, and re-creating one of those would be the
      // app overruling a decision the user made in its own UI.
      if (given.has(path) || (await isDisabledInPlace(full))) {
        keptBecauseRemoved.push(path)
        continue
      }

      // Nothing says it was taken away, so it is ours to give.
      //
      // With no receipt at all — an office seeded before any of this existed, which is exactly
      // the office we are here to fix — that is a judgement rather than a proof: we cannot tell
      // "shipped after you were seeded" from "you fired this", because the two look identical on
      // disk. We add, because the two mistakes are not the same size. A file that comes back
      // costs one click and is named out loud in the notice; a file that never arrives leaves
      // the reported bug unfixed on precisely the workspaces that have it. Neither overwrites
      // anything of theirs, and the receipt written after this run makes every later run exact.
      added.push(path)
      continue
    }

    const hash = hashOf(content)
    if (hash === shipped.current) continue
    if (shipped.hashes.includes(hash)) {
      updated.push(path)
      // Kept so the write can confirm nothing arrived in this file between deciding and writing.
      sawInWorkspace[path] = hash
    } else keptBecauseEdited.push(path)
  }

  return { updated, keptBecauseEdited, added, keptBecauseRemoved, unreadable, unsafe, sawInWorkspace }
}

// ─────────────────────────────────────────────────────────────────────────────
// Applying
// ─────────────────────────────────────────────────────────────────────────────

export interface ApplyOutcome {
  /** Paths actually written. What the user is told about, because it is what happened. */
  readonly written: readonly string[]
  /** Planned, and did not happen. Surfaced; a silent half-update is the worst of both. */
  readonly failed: readonly { readonly path: string; readonly cause: string }[]
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Carry out a plan, copying from the shipped tree into the workspace.
 *
 * Only `updated` and `added` are acted on. The other four lists exist to be reported, and this
 * function never reads them — a plan is a decision, and the decision for those was to leave the
 * file where it is.
 *
 * `shippedRoot` is where the template actually lives, which packaged is **not** the app root —
 * see `RootOptions.templateRoot`. Getting that wrong once already opened the office onto an
 * empty workspace; getting it wrong here would copy nothing and report success.
 */
export async function applyReconcile(
  plan: ReconcilePlan,
  manifest: ShippedManifest,
  shippedRoot: string,
  workspaceRoot: string,
): Promise<ApplyOutcome> {
  const written: string[] = []
  const failed: { path: string; cause: string }[] = []

  for (const path of [...plan.updated, ...plan.added]) {
    const shipped = manifest.files[path]
    if (!shipped) {
      failed.push({ path, cause: 'not in the manifest the plan was made from' })
      continue
    }

    // Checked again, on both roots. A plan is data, and this is the last point before a write:
    // re-deriving the destination here means a plan that arrived from anywhere still cannot
    // aim one outside the workspace.
    const from = safeRelativePath(shippedRoot, path)
    const to = safeRelativePath(workspaceRoot, path)
    if (from === null || to === null) {
      failed.push({ path, cause: 'does not name a file inside the workspace' })
      continue
    }

    let content: Uint8Array
    try {
      content = await readFile(from)
    } catch (err) {
      failed.push({ path, cause: describe(err) })
      continue
    }

    // The plan was reasoned from the manifest, so the copy on disk must be the copy the
    // manifest describes. When a build is half-finished, or somebody has edited the app's own
    // `.claude/` since it was built, it is not — and copying it then would push a stray local
    // edit into somebody else's office under the banner of an update.
    if (hashOf(content) !== shipped.current) {
      failed.push({ path, cause: 'the shipped copy on disk does not match the manifest' })
      continue
    }

    /**
     * Has the destination moved since the plan looked at it?
     *
     * The plan decided this file was safe to replace by reading it. The write happens later, and
     * in between anything may have saved over it — an editor on a timer, a second instance, the
     * office's own hire flow writing an agent file, a sync client. The source was re-verified
     * here from the start; the destination never was.
     *
     * Found by attacking the merged code rather than reading it: plan says update, the user
     * saves the file, apply writes anyway, and the edit is gone. **The one loss this whole
     * module exists to prevent, through the one door nobody was watching.**
     *
     * A file that is missing now was there when the plan read it, so something removed it in the
     * same window — also not ours to overwrite. Both cases refuse and say so.
     */
    const expected = plan.sawInWorkspace[path]
    if (expected !== undefined) {
      let now: Uint8Array | null = null
      try {
        now = await readFile(to)
      } catch {
        now = null
      }
      if (now === null || hashOf(now) !== expected) {
        failed.push({ path, cause: 'it changed after the plan was made, so it is not ours to replace' })
        continue
      }
    }

    try {
      await mkdir(dirname(to), { recursive: true })
      await writeFile(to, content)
      written.push(path)
    } catch (err) {
      failed.push({ path, cause: describe(err) })
    }
  }

  return { written, failed }
}

/**
 * Write down what this workspace now has of ours.
 *
 * Every shipped path that is present after a run, plus everything the previous receipt already
 * knew about. Union rather than replacement, and that is the whole point: a file recorded as
 * given and later missing is one the user took away, which is what stops the next launch from
 * putting it back. A file we failed to write is deliberately *not* recorded, so it is tried
 * again rather than remembered as delivered.
 *
 * Never throws. A receipt we could not write means the next run is one degree less certain, not
 * that the update failed — but it is returned as a cause so it can be said out loud.
 */
export async function writeReceipt(
  manifest: ShippedManifest,
  workspaceRoot: string,
  receipt: Receipt | null,
  /**
   * What this run actually wrote. A delivery we just made, whatever the file says now.
   *
   * **Required, deliberately.** It was written with `= []` first, and a mutation proved the
   * mistake: deleting the argument at the call site typechecked cleanly, because the default
   * silently answered for the caller. A fix that compiles while unwired is the exact bug this
   * repository keeps finding, and a default parameter is how it gets in.
   */
  wrote: readonly string[],
): Promise<{ ok: true } | { ok: false; cause: string }> {
  const given = new Set(receipt?.given ?? [])

  for (const path of Object.keys(manifest.files)) {
    const full = safeRelativePath(workspaceRoot, path)
    if (full === null) continue

    /**
     * Present is not the same question as delivered, and this used to answer the wrong one.
     *
     * It recorded a path as given whenever a file existed there. For a workspace this app seeded,
     * those sets are identical — and they come apart the moment somebody's own file sits at a
     * path we also ship. Three steps, each correct on its own, which is this repository's
     * signature:
     *
     *   1. The user writes `.claude/skills/handoff/SKILL.md`. The plan reads it, it matches no
     *      version we shipped, and it is kept as theirs. The rule working exactly right.
     *   2. The receipt records it as **given**, because it is there. It never was. It is theirs.
     *   3. They delete their own skill. Absent *and* recorded as given is the exact signature of
     *      "this office took it away on purpose" — so it is never restored.
     *
     * The shipped `handoff` skill can then never arrive in that workspace. Nothing is
     * overwritten, so it is not the dangerous class — but it is permanently and silently
     * missing, and no surface can say so, because it is indistinguishable from the rule working.
     *
     * Not a curiosity about name collisions either: the roster's own "write a skill" form lets
     * somebody create one by name, and the shipped names are `handoff`, `plan`, `state`,
     * `verify`, `meet` — ordinary enough to collide without anybody hand-editing anything.
     *
     * So the question asked here is now "did we put it there": either this run wrote it, or its
     * contents are a version we shipped. The second clause is what carries offices seeded before
     * receipts existed — our files, at our hashes, genuinely given.
     */
    if (wrote.includes(path)) {
      given.add(path)
      continue
    }
    try {
      const content = await readFile(full)
      if (manifest.files[path]?.hashes.includes(hashOf(content))) given.add(path)
    } catch {
      // Not there, or not readable. Either the user removed something we did give — in which
      // case it is already in `given` and stays there — or we never gave it, and recording it
      // now would be recording a delivery that did not happen.
    }
  }

  try {
    const path = receiptPath(workspaceRoot)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify({ given: [...given].sort() }, null, 2)}\n`)
    return { ok: true }
  } catch (err) {
    return { ok: false, cause: describe(err) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

/** How many paths the notice names before it starts counting. A sentence, not a manifest. */
const NAMED_IN_NOTICE = 4

/**
 * Paths whose contents are a security decision, always named however long the list is.
 *
 * `permissions.allow` in `settings.json` is the set of commands this app runs **without asking
 * anybody**, and `approval-gate.mjs` is what refuses the rest. Both are shipped files, so an
 * office that never touched them correctly gets them brought forward — that is the whole point of
 * the reconciler, and skipping them would strand exactly the workspaces most in need of a fix.
 *
 * The write is defensible. Not naming it was not.
 *
 * Found twice on the same night, independently, from opposite ends: by attacking the reconciler
 * from outside, and by the second session reading which paths are shipped. The failure was
 * *structural* rather than unlucky — the manifest is sorted by path, `.claude/agents/` sorts
 * before `.claude/hooks/` and `.claude/settings.json`, and this repo ships seven agent files
 * against a four-name cap. So on any office more than a few versions behind, the two files that
 * decide what runs unattended were **guaranteed** to be inside "and N more".
 *
 * A resurrected agent costs one click and is visible on the floor. This is invisible by
 * construction, during a startup nobody initiated, and the reader has no way to learn which of
 * the unnamed files it was.
 */
const ALWAYS_NAMED: ReadonlySet<string> = new Set([
  join('.claude', 'settings.json'),
  join('.claude', 'hooks', 'approval-gate.mjs'),
])

/**
 * One sentence for the transcript, or null when there is nothing worth saying.
 *
 * Counts what was *written*, not what was planned — a plan that failed halfway is not an
 * update, and saying otherwise would be the floor claiming work that did not happen.
 *
 * Silent when nothing moved, including the common case where every difference is the user's own
 * and was left alone. Told at every launch that we touched nothing, nobody reads the launch
 * where we did.
 */
export function summarise(plan: ReconcilePlan, outcome: ApplyOutcome): string | null {
  if (outcome.written.length === 0) return null

  const n = outcome.written.length
  const kept = plan.keptBecauseEdited.length
  const yours = kept === 0 ? '' : `, ${kept} of yours left alone`

  // Security decisions first, and never folded away. Everything else keeps the old rule: a
  // workspace seeded long ago can be nineteen files behind, and nineteen paths in one line is a
  // paragraph nobody finishes — which would bury the part that matters, that their own files
  // were untouched. The full list is on disk.
  const rules = outcome.written.filter((path) => ALWAYS_NAMED.has(path))
  const ordinary = outcome.written.filter((path) => !ALWAYS_NAMED.has(path))
  const named = [...rules, ...ordinary.slice(0, Math.max(0, NAMED_IN_NOTICE - rules.length))]
  const rest = n - named.length
  const list = rest === 0 ? named.join(', ') : `${named.join(', ')}, and ${rest} more`

  // And what it means, not only which file it was. "settings.json changed" is a filename; the
  // sentence somebody actually needs is the one about what may now happen without them.
  const consequence = rules.length === 0 ? '' : ' What this office may run without asking you has changed.'

  return (
    `Your office was updated: ${n} file${n === 1 ? '' : 's'} brought forward${yours}. ` +
    `${list}.${consequence} Anything you had edited was left exactly as it was.`
  )
}

/**
 * What went wrong, in the shape the rest of this app already reports startup facts in.
 *
 * `lint` with a named rule, the same as `workspace-unavailable` and `app-quarantined` — the
 * renderer's diagnosis panel reads problems by rule, so a new kind of union member would have
 * been a second mechanism for a thing that already has one.
 *
 * Files we chose not to touch are not here. Leaving an edited file alone, and leaving a fired
 * agent fired, are the rule working rather than something going wrong.
 */
export function reconcileProblems(plan: ReconcilePlan, outcome: ApplyOutcome): Problem[] {
  const problems: Problem[] = []

  for (const path of plan.unreadable) {
    problems.push({
      kind: 'unreadable-file',
      path,
      cause: 'could not be read, so it was left exactly as it is rather than written over',
    })
  }

  for (const path of plan.unsafe) {
    problems.push({
      kind: 'lint',
      path,
      rule: 'update-blocked',
      detail:
        `The shipped-file list names "${path}", which is not a file inside this workspace. ` +
        'Nothing was written for it. This means the list is damaged — rebuild it with `npm run build`.',
    })
  }

  for (const { path, cause } of outcome.failed) {
    problems.push({
      kind: 'lint',
      path,
      rule: 'update-blocked',
      detail: `Could not bring ${path} forward: ${cause}. Your copy is unchanged.`,
    })
  }

  return problems
}
