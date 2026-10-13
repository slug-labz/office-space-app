/**
 * Projects — the work, as opposed to the office.
 *
 * The workspace convention already says what a project is: a directory under `projects/`
 * carrying a plan, a progress log, and a task list. This module reads that, and creates new
 * ones from `projects/_TEMPLATE/`. Nothing here invents a second idea of a project — the floor
 * is a function of the filesystem, and so is the tab bar.
 *
 * ## Why a project is not a working directory
 *
 * The obvious move is to run each project's session with its own `cwd`, and it is wrong. The
 * staff live in `<workspace>/.claude/agents/`, and a session started two directories down is a
 * session that may not find them — the office would arrive on the floor empty, or with somebody
 * else's roster. So every project's session runs in the workspace root, and the project is
 * carried in what the manager is told rather than in where it is standing.
 *
 * That also matches the vision's own framing: opening a tab gives you *the whole office again*,
 * pointed at different work.
 *
 * ## The rule, again
 *
 * A `projects/` directory that cannot be read is not a workspace with no projects. It goes in
 * `problems` and the tab bar says so, rather than offering a clean slate over work that exists.
 */

import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Problem } from './workspace.js'

export const PROJECTS_DIR = 'projects'
export const TEMPLATE = '_TEMPLATE'

/** The three files the convention asks for. The floor reads them for status. */
export const PROJECT_FILES = ['PLAN.md', 'PROGRESS.md', 'TASKS.md'] as const

/** What `_TEMPLATE` writes where a project's own name goes. Exactly one string, once per file. */
export const PLACEHOLDER = '<Project Name>'

export interface Project {
  /** Directory name under `projects/`. Stable, and what sessions are tagged with. */
  readonly id: string
  /** What to put on the tab. The directory name, tidied. */
  readonly name: string
  readonly directory: string
  /**
   * Which of the convention's files are actually present.
   *
   * Reported rather than assumed: a project missing its `TASKS.md` is a project whose status
   * bubble has nothing to read, and the office should be able to say that instead of showing
   * an agent with nothing to report and no reason why.
   */
  readonly has: Readonly<Record<(typeof PROJECT_FILES)[number], boolean>>
}

export interface ProjectScan {
  readonly projects: readonly Project[]
  /** Empty means the scan was clean. Non-empty must reach the UI. */
  readonly problems: readonly Problem[]
  /** True when `projects/_TEMPLATE/` is there to copy. */
  readonly canCreate: boolean
}

/** A directory name from something a person typed. Lowercase, hyphens, nothing exotic. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** The directory name, made readable: `auth-refresh` becomes `auth refresh`. */
export function displayName(id: string): string {
  return id.replace(/[-_]+/g, ' ').trim() || id
}

/**
 * List the projects in a workspace.
 *
 * Never throws. `_TEMPLATE` is the scaffold rather than a project, and is excluded from the
 * list while its presence is reported separately — without it, creating a project is not
 * something the office can offer, and it should say so rather than failing at the click.
 */
export async function discoverProjects(root: string): Promise<ProjectScan> {
  const base = join(root, PROJECTS_DIR)
  const problems: Problem[] = []
  const projects: Project[] = []

  let entries: string[]
  try {
    entries = await readdir(base)
  } catch (err) {
    // A workspace with no `projects/` yet genuinely has none. Anything else is a problem.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { projects, problems, canCreate: false }
    }
    return {
      projects,
      problems: [{ kind: 'unreadable-dir', path: base, cause: (err as Error).message }],
      canCreate: false,
    }
  }

  let canCreate = false

  for (const entry of entries.filter((e) => !e.startsWith('.')).sort()) {
    const directory = join(base, entry)

    try {
      if (!(await stat(directory)).isDirectory()) continue
    } catch (err) {
      problems.push({ kind: 'unreadable-dir', path: directory, cause: (err as Error).message })
      continue
    }

    if (entry === TEMPLATE) {
      canCreate = true
      continue
    }

    const has = {} as Record<(typeof PROJECT_FILES)[number], boolean>
    for (const file of PROJECT_FILES) {
      has[file] = await exists(join(directory, file))
    }

    projects.push({ id: entry, name: displayName(entry), directory, has })
  }

  return { projects, problems, canCreate }
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

export type Created =
  | { readonly state: 'created'; readonly project: Project }
  | { readonly state: 'exists'; readonly id: string }
  | { readonly state: 'failed'; readonly cause: string }

/**
 * Every symbolic link under a directory, by relative path.
 *
 * `lstat` rather than `stat`, because `stat` follows the link and answers about the target — the
 * exact substitution that makes a link invisible to a check. `reconcile.ts` makes the same choice
 * for the same reason, in the module where being wrong means writing through one.
 */
async function linksIn(dir: string, prefix = ''): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // Unreadable is not link-free, but it is also not this function's to report: the `cp` below
    // fails on it and says so with the real errno.
    return []
  }

  const found: string[] = []
  for (const entry of entries) {
    const shown = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) found.push(shown)
    else if (entry.isDirectory()) found.push(...(await linksIn(join(dir, entry.name), shown)))
  }
  return found
}

/**
 * Start a project from the template.
 *
 * Refuses to overwrite. A name that collides with an existing project is somebody opening the
 * one they already have, not asking to flatten it — and copying the template over a plan and a
 * progress log would destroy exactly the record the convention exists to keep.
 */
export async function createProject(root: string, name: string): Promise<Created> {
  const id = slugify(name)
  if (!id) return { state: 'failed', cause: 'a project needs a name with letters or numbers in it' }
  if (id === TEMPLATE.toLowerCase()) return { state: 'failed', cause: `"${TEMPLATE}" is the scaffold, not a project` }

  const base = join(root, PROJECTS_DIR)
  const directory = join(base, id)

  try {
    await stat(directory)
    return { state: 'exists', id }
  } catch {
    // Not there, which is what we want.
  }

  const template = join(base, TEMPLATE)
  try {
    await stat(template)
  } catch {
    return { state: 'failed', cause: `no ${PROJECTS_DIR}/${TEMPLATE}/ to copy — the office cannot scaffold a project` }
  }

  /*
   * A symlink in the scaffold becomes a symlink in every project made from it.
   *
   * `cp`'s `dereference` defaults to **false**, so a link in `_TEMPLATE` is copied *as a link*
   * into the new project — and then the office reads the copy. A plan file is plain markdown with
   * no frontmatter and no structure, so whatever the link points at simply becomes the project's
   * PLAN.md:
   *
   *     createProject → created
   *     projects/my-project/PLAN.md → "ssh-rsa AAAAB3NzaC1yc2E PRIVATE KEY MATERIAL"
   *     discovery → my-project, nothing missing, no problem reported
   *
   * `.gitignore` ships `_TEMPLATE` deliberately — `!projects/_TEMPLATE/**` — and git preserves
   * symlinks, so a cloned workspace can carry one. The trigger is not a hand-edit: it is somebody
   * creating their first project, which is the thing the README tells them to do.
   *
   * Refusing rather than dereferencing. `dereference: true` would copy the *contents* through the
   * link, which puts the secret in the project instead of pointing at it — the same disclosure
   * with an extra copy. And refusing costs nothing: `_TEMPLATE` is this repository's own file and
   * nobody has a legitimate symlink in it.
   *
   * The agents directory has the same shape and a narrower bound — `readEmployee` needs
   * frontmatter, so its targets are other agent files rather than any readable file. That one is
   * still open; see the note in `safe-path.ts`.
   */
  const linked = await linksIn(template)
  if (linked.length > 0) {
    return {
      state: 'failed',
      cause:
        `${TEMPLATE} contains ${linked.length === 1 ? 'a symbolic link' : `${linked.length} symbolic links`} ` +
        `(${linked.join(', ')}), and copying it would put ${linked.length === 1 ? 'that link' : 'those links'} ` +
        'in every project made from it. Replace it with a real file.',
    }
  }

  try {
    await mkdir(base, { recursive: true })
    await cp(template, directory, { recursive: true, errorOnExist: true, force: false })
  } catch (err) {
    return { state: 'failed', cause: (err as Error).message }
  }

  /*
   * Put the project's name where the template left a placeholder.
   *
   * `cp` copies the scaffold verbatim, so every project started this way opened with
   * `# <Project Name>` at the top of all three files — a document telling somebody it was still
   * a template, in the first thing they see after naming it. It stayed that way until an agent
   * happened to edit the file for another reason, which is why two of the projects on this
   * machine say their own name and the one nobody worked on still says `<Project Name>`.
   *
   * The name we were given, not the slug. `payment-page` came from somebody typing *Payment
   * Page*, and that is the title they meant.
   *
   * Best effort, and deliberately not fatal. The directory exists and the files are in it; a
   * placeholder left behind is cosmetic and visible, whereas failing the creation over it would
   * throw away a project that was made. Any file that could not be rewritten simply keeps the
   * placeholder, which says the same thing as a warning would.
   */
  const titled = name.trim() || id
  await Promise.all(
    PROJECT_FILES.map(async (file) => {
      const path = join(directory, file)
      try {
        const text = await readFile(path, 'utf8')
        if (text.includes(PLACEHOLDER)) await writeFile(path, text.replaceAll(PLACEHOLDER, titled), 'utf8')
      } catch {
        // Unreadable or unwritable. The project stands; the heading keeps its placeholder.
      }
    }),
  )

  const has = {} as Record<(typeof PROJECT_FILES)[number], boolean>
  for (const file of PROJECT_FILES) has[file] = await exists(join(directory, file))

  return { state: 'created', project: { id, name: displayName(id), directory, has } }
}

/**
 * What the manager is told about the project it is working in.
 *
 * The same shape as the staff block, and for the same reason: the manager cannot see the tab
 * bar, so anything it needs to know about which work this is has to arrive in what it is sent.
 * Missing files are named rather than passed over — an agent told to keep `TASKS.md` current
 * should know when there is no `TASKS.md`.
 */
export function projectBlock(project: Project | null): string {
  if (!project) {
    return [
      '## CURRENT PROJECT',
      '',
      'None. This conversation is not scoped to a project directory, so there is no plan, progress',
      'log or task list to keep. Do not invent one; say so if the work needs one.',
    ].join('\n')
  }

  const missing = PROJECT_FILES.filter((f) => !project.has[f])

  return [
    '## CURRENT PROJECT',
    '',
    /*
     * The **absolute** directory, not `projects/<id>/`.
     *
     * A relative path has to be resolved against something, and the manager never sees what. Sent
     * `projects/retry-helper/`, it read `/Users/somebody/projects/retry-helper/PLAN.md` — the user's
     * home, which on that machine exists — and Claude Code's own permission system refused all
     * three reads for being outside the workspace. The transcript then said *"3 tool calls were
     * refused, so none of them ran"*, on a new user's first message, about the project they had
     * just made. Measured on a packaged build whose workspace lives under `userData`, where the
     * home directory is nowhere near it.
     *
     * `directory` is already absolute and already on the object. Nothing to resolve, nothing to
     * guess, and the block stops depending on the manager knowing where it is standing.
     */
    `${project.name} — \`${project.directory}\``,
    '',
    'Keep its plan, progress log and task list current; the office floor reads them.',
    ...(missing.length > 0
      ? ['', `Not present yet: ${missing.join(', ')}. Create them from the template rather than working without them.`]
      : []),
  ].join('\n')
}
