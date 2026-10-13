/**
 * Finding the `claude` the office is supposed to run.
 *
 * The whole product rests on one sentence: *if `claude` works in your terminal, this works.*
 * That sentence is true only if the app can find the same binary your terminal finds, and a
 * GUI application on macOS does not get your terminal's `PATH`. Launched from the Dock it
 * inherits `launchd`'s environment, which has no nvm, no Homebrew shims, and none of what
 * `.zshrc` sets up — so spawning a bare `claude` finds nothing and the office arrives with a
 * room full of people who cannot do anything.
 *
 * It is worse than it sounds, because it looks fine in development. Start the app from a shell
 * and it inherits that shell's `PATH` and works perfectly. The failure only appears for people
 * who launch it the way people launch applications.
 *
 * ## What this does about it
 *
 * Looks where `claude` actually installs itself, in the order of most-deliberate-choice first:
 * an explicit override, then `PATH`, then the places the installers put it. Every version
 * manager keeps its binaries somewhere `launchd` has never heard of, so the list is real
 * locations rather than a guess.
 *
 * ## The rule
 *
 * Not finding it is reported with everywhere that was looked. "The office cannot start" is
 * useless; "I looked in these six places and it is in none of them" is something a person can
 * act on in a minute.
 */

import { access, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'

export type Found =
  | {
      readonly state: 'found'
      readonly path: string
      /** How it was found, so the UI can say why it chose this one. */
      readonly how: 'override' | 'path' | 'installed'
    }
  | { readonly state: 'missing'; readonly looked: readonly string[] }

async function isRunnable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Every `claude` under a version manager that keeps one directory per version. */
async function underVersions(root: string): Promise<string[]> {
  try {
    const versions = await readdir(root)
    return versions.sort().reverse().map((v) => join(root, v, 'bin', 'claude'))
  } catch {
    return []
  }
}

/**
 * What the executable is called, in the order worth trying.
 *
 * On Windows an npm-installed CLI is a `.cmd` shim and the bare name is not executable — so a
 * search for `claude` finds nothing while `claude` works perfectly in the user's terminal, which
 * is the same class of failure as the PATH problem this module already exists for.
 *
 * We do not claim Windows works — neither machine has one to test on, and an exit condition
 * nobody can run is an aspiration with a checkbox. What we do is not bake in the assumption that
 * it cannot, so the port stays cheap.
 */
function binaryNames(platform: string): readonly string[] {
  return platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude']
}

/**
 * The two locations that are absolute rather than under `home`.
 *
 * Separated out because they are the one part of this search a test cannot steer. Every other
 * candidate is built from the injected `home`, so a test pointing `home` at a temp directory
 * controls what is found — but these two are read off the real machine whatever the test says.
 *
 * That was invisible until somebody symlinked `claude` into `/opt/homebrew/bin`, at which point
 * three tests that assert "nothing is installed" started finding something and failing. **The
 * tests were passing for an environmental reason rather than a correct one**, which is the
 * failure this repository spends most of its time hunting.
 */
const SYSTEM_LOCATIONS: readonly string[] = ['/opt/homebrew/bin/claude', '/usr/local/bin/claude']

/**
 * Where `claude` installs itself, in the order worth trying.
 *
 * `~/.claude/local` first because that is the native installer's own directory and the least
 * likely to be a stale copy. Version-manager directories are searched newest-first, which is
 * the one that gets updated when somebody runs the upgrade.
 */
async function installedLocations(
  home: string,
  platform: string,
  system: readonly string[] = SYSTEM_LOCATIONS,
): Promise<string[]> {
  if (platform === 'win32') {
    const appData = process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming')
    const localAppData = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
    return [
      join(home, '.claude', 'local', 'claude.cmd'),
      join(appData, 'npm', 'claude.cmd'),
      join(localAppData, 'Programs', 'claude', 'claude.exe'),
      join(home, '.bun', 'bin', 'claude.exe'),
    ]
  }

  return [
    join(home, '.claude', 'local', 'claude'),
    ...(await underVersions(join(home, '.nvm', 'versions', 'node'))),
    ...(await underVersions(join(home, '.local', 'share', 'fnm', 'node-versions'))),
    join(home, '.volta', 'bin', 'claude'),
    join(home, '.bun', 'bin', 'claude'),
    ...system,
    join(home, '.npm-global', 'bin', 'claude'),
  ]
}

export interface ResolveOptions {
  /** `OFFICE_CLAUDE_PATH`, when somebody has said exactly which one to use. */
  readonly override?: string | undefined
  /** The `PATH` this process actually has. Often not the one your terminal has. */
  readonly path?: string | undefined
  readonly home: string
  /**
   * `process.platform`, injected so the Windows behaviour is testable from a Mac.
   *
   * That is the whole reason it is a parameter: neither machine has Windows, so the only way to
   * check that we have not baked in POSIX is to be able to ask for the other answer.
   */
  readonly platform?: string | undefined
  /**
   * The absolute, non-`home` locations to search. Injected for the same reason `platform` is:
   * they are read off the real machine, so a test that cannot steer them is a test whose result
   * depends on what the person running it happens to have installed.
   */
  readonly system?: readonly string[] | undefined
}

/**
 * Find the binary to spawn.
 *
 * Returns an absolute path even when it came from `PATH`, so the spawn does not depend on the
 * environment a second time — the whole failure being fixed here is an environment that was
 * not what anybody assumed.
 */
export async function resolveClaude(options: ResolveOptions): Promise<Found> {
  const looked: string[] = []

  // Somebody said exactly which one. If they were wrong, say so about that one rather than
  // quietly using a different binary than the one they named.
  if (options.override) {
    looked.push(options.override)
    return (await isRunnable(options.override))
      ? { state: 'found', path: options.override, how: 'override' }
      : { state: 'missing', looked }
  }

  const platform = options.platform ?? process.platform

  for (const directory of (options.path ?? '').split(delimiter).filter(Boolean)) {
    // Every name the platform might use, not just `claude`. On Windows an npm-installed CLI is
    // a `.cmd` shim and the bare name is not executable — so a search for `claude` finds nothing
    // while `claude` works perfectly in the user's terminal. Same class of failure as the PATH
    // problem this module already exists for.
    for (const name of binaryNames(platform)) {
      const candidate = join(directory, name)
      looked.push(candidate)
      if (await isRunnable(candidate)) return { state: 'found', path: candidate, how: 'path' }
    }
  }

  for (const candidate of await installedLocations(options.home, platform, options.system)) {
    looked.push(candidate)
    if (await isRunnable(candidate)) return { state: 'found', path: candidate, how: 'installed' }
  }

  return { state: 'missing', looked }
}

/**
 * What to tell somebody whose office has nothing to run. Names the fix, not the symptom.
 *
 * **The list is never replaced by its own length.** Above six entries this printed
 * `Looked in 10 places.` and stopped, which is the bare "the office cannot start" the header of
 * this module calls useless -- and `docs/release-checklist.md` §3 sends the reader to check that
 * list *"rather than guessing"*, so there was nothing there to check.
 *
 * Six was never a threshold a failing Mac could get under. `installedLocations` returns at least
 * six candidates on any POSIX host before a single `PATH` entry is counted, and an app opened from
 * the Dock inherits `launchd`'s four -- measured at ten on 2026-10-01, against the packaged build.
 * The only inputs below the threshold are an explicit `OFFICE_CLAUDE_PATH`, which is one path, and
 * an empty `PATH`. So the branch that was supposed to spare somebody a wall of text was in fact
 * the only branch a real failure ever took.
 *
 * The count is kept beside the paths, because how many were tried is worth knowing. It may not
 * stand in for them.
 */
export function missingMessage(looked: readonly string[]): string {
  const all = looked.join(', ')
  const shown = looked.length > 6 ? `${looked.length} places: ${all}` : all
  return [
    'The office cannot find the `claude` command, so nobody here can do anything.',
    `Looked in ${shown}.`,
    'If `claude` works in your terminal, the app is not seeing the same PATH your shell does —',
    'which is normal for an app launched from the Dock. Run `which claude` in your terminal and',
    'start the office with OFFICE_CLAUDE_PATH set to what it prints.',
  ].join(' ')
}
