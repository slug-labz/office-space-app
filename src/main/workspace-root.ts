/**
 * Which directory the office is a window onto, and where it comes from when the app is packaged.
 *
 * ## The problem packaging creates, which does not exist in a clone
 *
 * Run from a clone, the answer is easy and it is the whole "clone it and it works" story: the
 * repo *is* the workspace. `.claude/` sits beside `dist/`, the office has seven staff on day
 * one, and everything the user edits is a file they already own.
 *
 * Packaged, that breaks in a way that would not show until the end. `dist/` goes inside
 * `app.asar`, which is **read-only** — and the workspace is not a read-only thing. Adding an
 * agent writes `.claude/agents/<name>.md`; the registry writes `.office-space/sessions.json`;
 * a project is a directory somebody creates. An office you cannot hire into is not an office.
 *
 * So a packaged app cannot use its own bundle as a workspace, and the fix is not a path tweak:
 * it needs a real directory the user owns.
 *
 * ## The rule
 *
 * 1. `OFFICE_WORKSPACE` wins, always. Somebody who has said where has said where.
 * 2. **Unpackaged** — the app root, exactly as before. A clone is its own office.
 * 3. **Packaged** — a directory under the user's own space, seeded once from what shipped.
 *
 * Seeding is a copy, not a symlink and not a read-through: from the moment it exists it is
 * theirs. Their edits are not overwritten by an update, which is the property that matters —
 * an app that quietly reverted somebody's agent file on upgrade would be worse than one that
 * never shipped a template at all.
 */

import { cp, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECTS_DIR, TEMPLATE } from './projects.js'

export interface RootOptions {
  /** `app.isPackaged`. Injected so this is testable without an Electron app object. */
  readonly packaged: boolean
  /** The app's own directory — where `.claude/` sits in a clone. */
  readonly appRoot: string
  /**
   * Where the shipped template actually is, which is **not** `appRoot` in a packaged build.
   *
   * Packaged, `appRoot` resolves inside `app.asar` — that is where `dist/main/main.js` runs
   * from. The template does not live there: `files` puts only `dist/` and `package.json` in the
   * asar, and `extraResources` copies `.claude/` and `projects/_TEMPLATE` to
   * `Contents/Resources/app/`, *beside* the archive. Seeding from `appRoot` therefore looked in
   * a directory that has never contained a template, failed with ENOENT, and opened the office
   * onto an empty workspace.
   *
   * Nothing caught it because nothing had ever built an artifact — the build config carried
   * `_comment_*` keys that electron-builder's schema rejects, so `npm run dist` had never once
   * produced anything to open.
   *
   * In a clone the two are the same directory, which is exactly why this went unnoticed: every
   * developer and every test takes the path where the bug cannot appear.
   */
  readonly templateRoot: string
  /** Where a packaged app may write. `app.getPath('userData')`. */
  readonly userData: string
  /** `process.env`, injected for the same reason. */
  readonly env: Record<string, string | undefined>
}

export interface ResolvedRoot {
  readonly root: string
  readonly why:
    /** `OFFICE_WORKSPACE` named it. */
    | 'env'
    /** Running from a clone; the repo is the office. */
    | 'clone'
    /** Packaged, and this workspace already existed. */
    | 'existing'
    /** Packaged, and we have just created it from what shipped. */
    | 'seeded'
  /** Set when seeding was attempted and could not finish. Never swallowed. */
  readonly problem?: string
}

/** What a seeded workspace is called under `userData`. */
export const WORKSPACE_DIR = 'workspace'

/**
 * Decide the workspace, creating it if this is a packaged app's first run.
 *
 * Never throws. A seeding failure comes back as a `problem` on an otherwise usable answer,
 * because an office that opens onto an empty workspace and says why is more useful than one
 * that refuses to open at all — and far more useful than one that opens onto an empty
 * workspace and says nothing.
 */
export async function resolveWorkspaceRoot(options: RootOptions): Promise<ResolvedRoot> {
  const named = options.env['OFFICE_WORKSPACE']
  if (named) return { root: named, why: 'env' }

  // A clone is its own office. This is the path every developer and every test takes.
  if (!options.packaged) return { root: options.appRoot, why: 'clone' }

  const root = join(options.userData, WORKSPACE_DIR)

  // Already there. Do **not** re-seed: those are the user's files now, and an update that
  // restored our version of their agent would be the worst bug this module could have.
  const contents = await contentsOf(root)
  if (contents === 'some') return { root, why: 'existing' }

  // We could not look, which is not the same as there being nothing there — and this is the one
  // decision in this module where guessing wrong restores files somebody deleted on purpose.
  // Treated as occupied, and said out loud: a workspace that opens without its own scaffold and
  // explains why is recoverable, and one that silently puts our agents back beside theirs is the
  // bug the comment above is about.
  if (contents === 'unreadable') {
    return {
      root,
      why: 'existing',
      problem:
        `The office could not read its workspace at ${root}, so it has not set anything up there — ` +
        'a directory that cannot be listed is not an empty one, and seeding into it could put back ' +
        'files you deleted. Check the permissions on that directory, or set OFFICE_WORKSPACE to ' +
        'point somewhere you can read and write.',
    }
  }

  try {
    await mkdir(root, { recursive: true })
    // `recursive`, and `force: false` so an interrupted first run cannot half-overwrite a
    // workspace somebody has started editing.
    // `projects/_TEMPLATE`, not `projects`. The packaged bundle only carries the template — see
    // package.json's extraResources and the note there — so seeding the whole directory would
    // fail on a path that is not in the bundle, and on a dev build would copy the developer's
    // own work into the user's workspace.
    for (const dir of ['.claude', 'projects/_TEMPLATE']) {
      await cp(join(options.templateRoot, dir), join(root, dir), {
        recursive: true,
        force: false,
        errorOnExist: false,
      })
    }
    return { root, why: 'seeded' }
  } catch (err) {
    return {
      root,
      why: 'seeded',
      problem:
        `The office could not set up its workspace at ${root}: ${err instanceof Error ? err.message : String(err)}. ` +
        'It will open empty. Set OFFICE_WORKSPACE to point it somewhere you can write.',
    }
  }
}

/**
 * Whether a directory exists and has anything in it. **A directory we cannot read is not empty.**
 *
 * That sentence was already the docstring here, and the body did the opposite: `catch { return
 * false }` turned every failure into "nothing there", which is the definition of empty. The
 * comment vouched for a rule the code broke, which is worse than no comment — the next person
 * reads the guarantee and stops looking.
 *
 * Three answers, because there are three situations. `ENOENT` is the only one that honestly
 * means nothing is there; `EACCES`, `EIO`, `ENOTDIR` and the rest mean we could not look. The
 * caller acts very differently on the two, and this is the fourth standing order in a function.
 *
 * `ledger.ts:428` and `spotify/network-switch.ts` draw the same line for the same reason.
 */
type Contents = 'some' | 'none' | 'unreadable'

async function contentsOf(path: string): Promise<Contents> {
  try {
    return (await readdir(path)).length > 0 ? 'some' : 'none'
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'none' : 'unreadable'
  }
}

/**
 * Put the project template into a workspace that has none, when somebody asks for it.
 *
 * ## Why this is a request rather than part of seeding
 *
 * `OFFICE_WORKSPACE` returns above without seeding anything, deliberately: that directory is
 * somebody's own, they said where, and scattering `projects/_TEMPLATE/` through a repository
 * unbidden is not the office's call to make.
 *
 * But the consequence was a dead end. `createProject` hard-requires that template, so pointing
 * the office at a repository you already have — the one thing rule 1 exists for — left the
 * first-run panel saying *"that template is missing, so the office cannot start one for you.
 * Create the directory by hand, or re-clone."* Re-clone what? It is their repository.
 *
 * So the same copy, on a button. The office does not decide to write into somebody's tree; it
 * offers to, and the person decides. That is the difference between seeding and this, and it is
 * the whole reason this is a separate function rather than a relaxed condition above.
 *
 * `force: false` and `errorOnExist: false` like the seed, so pressing it twice, or pressing it
 * on a workspace that has half a template, never overwrites what is already there.
 */
export async function addProjectTemplate(
  root: string,
  templateRoot: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  // `projects.ts`'s own names. `createProject` refuses on the absence of exactly this path, so a
  // second spelling of it here would be a button that creates a directory the check still fails.
  const from = join(templateRoot, PROJECTS_DIR, TEMPLATE)
  const to = join(root, PROJECTS_DIR, TEMPLATE)
  try {
    await mkdir(join(root, PROJECTS_DIR), { recursive: true })
    await cp(from, to, { recursive: true, force: false, errorOnExist: false })
    return { ok: true }
  } catch (err) {
    /*
     * Named, including where it was copying from. The interesting failure is not permissions —
     * it is a build whose `extraResources` does not carry the template, which is exactly the bug
     * this repository shipped once already and which presents as an ENOENT on a path nobody can
     * see from the panel.
     */
    return {
      ok: false,
      reason: `The office could not copy its project template from ${from} — ${(err as Error).message}`,
    }
  }
}
