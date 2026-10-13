/**
 * Read a workspace's hooks, and be exact about every way that can fail.
 *
 * The judgement is `src/shared/hooks.ts`, which imports nothing. This is the directory walk and
 * the three settings files, kept on this side of the boundary so the join can be tested without
 * a filesystem.
 *
 * ## Three files, because a hook declared in any of them fires
 *
 * `.claude/settings.json` is the committed one. `.claude/settings.local.json` is the personal,
 * uncommitted half — `permissions.ts` reads both for exactly this reason, having found that
 * reading only the shared file reports fewer rules than are actually in force. And
 * `~/.claude/settings.json` is the user's own, which is outside this workspace and registers
 * hooks that run inside it anyway.
 *
 * **Precedence between them is not claimed.** Every registration is listed with the file it came
 * from, and nothing here decides which wins when two declare the same thing. That is deliberate:
 * it was not measured against the installed CLI, and a plausible ordering invented by this module
 * would be believed. Two rows and an honest silence beat one row and a guess.
 *
 * ## The user's file is read, and it is not a workspace file
 *
 * Reading `~/.claude/settings.json` is necessary — a hook declared there fires on every tool call
 * made here, and a panel that omitted it would say "these are your hooks" while something else
 * ran. It is deliberately **not** folded into the privacy panel's model: that panel is about what
 * the office *writes into your workspace*, and this is the office *reading a file elsewhere on
 * your machine*. Different category, different surface.
 *
 * `home` is injectable so a test never reads the developer's real config, following
 * `capabilities.ts`.
 *
 * ## What is shown of a command, and what is not
 *
 * The command line is the whole point of the panel — it is what actually runs — so it is shown
 * verbatim, with one substitution: an absolute path under the user's home is abbreviated to `~`.
 * That costs nothing (the same path, minus the account name) and keeps a screenshot of this panel
 * from carrying somebody's username off their machine. Hook *file contents* are never read for
 * display; this module reads them only to hash them, and the hash is never shown either.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { hashOf, type ShippedManifest } from './reconcile.js'
import {
  buildReport,
  registrationsIn,
  type HookFile,
  type HookOrigin,
  type HookSource,
  type HooksReport,
  type Registration,
  type SettingsScope,
} from '../shared/hooks.js'

const CLAUDE_DIR = '.claude'
const HOOKS_DIR = 'hooks'

/** Where a hook file sits in the shipped manifest, which is keyed from the workspace root. */
function manifestKey(name: string): string {
  return `${CLAUDE_DIR}/${HOOKS_DIR}/${name}`
}

/**
 * A path with the user's home abbreviated to `~`.
 *
 * Only ever cosmetic — nothing reads a path back out of this. See the header for why it is done
 * to commands as well as to the settings paths themselves.
 */
function abbreviate(text: string, home: string): string {
  return home === '' ? text : text.split(home).join('~')
}

/**
 * Not a hook.
 *
 * A markdown file in `.claude/hooks/` is documentation about the directory rather than a claim
 * that something is gated, and listing it as *never run* would be noise on the one line that has
 * to mean something. The same call `memory.ts` makes about its `README.md`.
 *
 * Nothing else is filtered. In particular there is no extension allow-list: a hook can be written
 * in anything the shell can start, and a panel that only listed `.mjs` would hide a Python hook
 * from the surface whose entire job is listing what runs.
 */
function isDocumentation(name: string): boolean {
  return name.toLowerCase().endsWith('.md')
}

/**
 * What is in `.claude/hooks/`, and who put each file there.
 *
 * Returns `null` for the file list when the directory could not be listed, which is not the same
 * value as `[]` and is the distinction the whole feature exists for. `ENOENT` is the one case
 * where absent really is empty: a workspace nobody has put a hook in has no such directory, and
 * `CLAUDE.md` draws the same line for `.claude/commands/`.
 */
async function readHookFiles(
  root: string,
  manifest: ShippedManifest | null,
): Promise<{ files: readonly HookFile[] | null; problem: string | null }> {
  const dir = join(root, CLAUDE_DIR, HOOKS_DIR)

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { files: [], problem: null }
    return { files: null, problem: `${dir} exists and could not be opened: ${message(err)}` }
  }

  const files: HookFile[] = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // Deliberately not `isFile()`: a symlinked hook is still a hook and the CLI runs it, the same
    // reasoning `commands.ts` gives about a symlinked command.
    if (entry.isDirectory()) continue
    if (entry.name.startsWith('.') || isDocumentation(entry.name)) continue

    files.push({ name: entry.name, origin: await originOf(join(dir, entry.name), entry.name, manifest) })
  }

  return { files, problem: null }
}

/**
 * Who put one file here.
 *
 * Read from the manifest rather than from a hardcoded filename, so the answer stays true the
 * first time this app ships a second hook and says something useful about one the user wrote.
 *
 * A file we cannot hash is `unknown` rather than `yours`. Claiming a person wrote a file we could
 * not open is the same class of mistake as claiming a directory we could not read is empty.
 */
async function originOf(path: string, name: string, manifest: ShippedManifest | null): Promise<HookOrigin> {
  if (manifest === null) return 'unknown'

  const shipped = manifest.files[manifestKey(name)]
  // No version of this path has ever shipped, so nobody but the user can have put it there. This
  // answer does not need the file's content and is safe even if it will not open.
  if (!shipped) return 'yours'

  let content: Buffer
  try {
    content = await readFile(path)
  } catch {
    return 'unknown'
  }

  // Against every version ever shipped, not just the current one — an office seeded from an older
  // build holds an older copy nobody has touched, and calling that "edited" would accuse somebody
  // of a change they did not make. `reconcile.ts` uses the same rule to decide what is safe to
  // replace.
  return shipped.hashes.includes(hashOf(content)) ? 'shipped' : 'shipped-edited'
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** One settings file: read it, parse it, and take the registrations out of it. */
async function readSource(
  path: string,
  scope: SettingsScope,
  home: string,
): Promise<{ source: HookSource; registrations: readonly Registration[] }> {
  const shown = abbreviate(path, home)

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { source: { path: shown, scope, state: 'missing', cause: null, registrations: 0 }, registrations: [] }
    }
    return {
      source: { path: shown, scope, state: 'unreadable', cause: message(err), registrations: 0 },
      registrations: [],
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    // Its own state, and the CLI is the reason it matters. Under `--print` a settings file that
    // fails validation is "silently ignored (no error dialog is shown)" — its own `--help` says
    // so — which means a trailing comma disables every hook in the file and nothing anywhere
    // mentions it. Reporting that as "no hooks registered" would make this panel the second thing
    // keeping the secret.
    return {
      source: { path: shown, scope, state: 'unparsable', cause: message(err), registrations: 0 },
      registrations: [],
    }
  }

  const registrations = registrationsIn(parsed, scope, shown).map((r) => ({
    ...r,
    command: abbreviate(r.command, home),
  }))

  return {
    source: { path: shown, scope, state: 'ok', cause: null, registrations: registrations.length },
    registrations,
  }
}

/**
 * Everything that runs on a hook in this workspace.
 *
 * Never throws. `manifestPath` is where `scripts/build.mjs` left `shipped-hashes.json`; a
 * manifest that will not open costs provenance and nothing else, so the panel still lists every
 * hook and says only that it cannot tell you who put the files there.
 */
export async function readHooks(
  root: string,
  options: { readonly home: string; readonly manifestPath: string },
): Promise<HooksReport> {
  let manifest: ShippedManifest | null = null
  try {
    manifest = JSON.parse(await readFile(options.manifestPath, 'utf8')) as ShippedManifest
  } catch {
    // Absent is not empty here either, and the cost of not knowing is one column. Every origin
    // becomes `unknown`, which the panel says out loud rather than defaulting to `yours`.
    manifest = null
  }

  const consulted = [
    { path: join(root, CLAUDE_DIR, 'settings.json'), scope: 'project' as const },
    { path: join(root, CLAUDE_DIR, 'settings.local.json'), scope: 'local' as const },
    { path: join(options.home, CLAUDE_DIR, 'settings.json'), scope: 'user' as const },
  ]

  const sources: HookSource[] = []
  const registrations: Registration[] = []
  const seen = new Set<string>()

  for (const { path, scope } of consulted) {
    /*
     * The same file, twice.
     *
     * A workspace whose root **is** the home directory — somebody who opened the office on `~`,
     * which nothing stops them doing — makes `.claude/settings.json` both the project file and
     * the user file. Read twice, it lists every hook in it twice and says "2 hooks are registered
     * here" about one. Found by pointing the reader at a real directory rather than at a fixture;
     * no mock would have produced it, because a mock is written by somebody who already knows the
     * three paths are different.
     *
     * The first wins, so the row keeps the more specific scope. Nothing is hidden by this: the
     * file is still listed, still read, and its hooks still counted — once.
     */
    const key = resolve(path)
    if (seen.has(key)) continue
    seen.add(key)

    const read = await readSource(path, scope, options.home)
    sources.push(read.source)
    registrations.push(...read.registrations)
  }

  const { files, problem } = await readHookFiles(root, manifest)

  return buildReport(registrations, files, problem, sources)
}
