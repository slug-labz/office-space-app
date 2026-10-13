import { readFileSync } from 'node:fs'
import { FileMatcher } from 'app-builder-lib/out/fileMatcher.js'
import { join } from 'node:path'

/**
 * What the office puts into a workspace, declared once.
 *
 * Extracted from `build.mjs` so it can be read without running a build. It is imported by that
 * script, which expands it with `git ls-files`, and by `test/what-a-push-would-carry.test.ts`,
 * which checks that every file it expands to is covered by the privacy panel's own list.
 *
 * That test first read `dist/shipped-hashes.json` — the build's *output* — and passed locally
 * while failing in CI, which at the time ran the tests before the build. A check whose *input* is
 * an artifact reports on whatever happens to be lying around, and this repository's whole lesson
 * is that what is lying around here is everything.
 *
 * CI now builds first, so the manifest is present when the tests run. That does not put the input
 * back: this stays the declaration, and the manifest is compared *against* it — see the
 * `build.mjs wrote the same list this declares` case in that file. Same file, opposite roles.
 */

/**
 * What an office is seeded with.
 *
 * Paths rather than a directory walk, and hand-kept on purpose: a walk would seed whatever
 * happened to be in the tree, and what an installed office receives should be a decision somebody
 * made rather than a side effect of what was sitting on a disk.
 *
 * `projects/README.md` comes along because it is the other half of what `extraResources` ships
 * under `projects/`, and a `projects/` directory holding a bare `_TEMPLATE` and no word about
 * what it is for is a worse first impression than the two files together.
 */
/*
 * `CLAUDE.md` is the worst of these omissions and was found last.
 *
 * Its first section is titled "The standing orders" and opens *"These rules govern every agent in
 * this workspace"* — the four rules this product is built on, including *absent is not empty*,
 * which its own documentation calls the mistake that has cost more than any other. A fresh office
 * had none of them. Every agent in every installed copy was working without the rules this
 * repository spends its documentation explaining.
 *
 * It also silently undid a fix. The one-command-per-Bash-call rule had just been moved out of
 * `manager.md` into `CLAUDE.md` so that all seven agents would read it — into a file no installed
 * office has.
 */
export const SHIPPED = [
  '.claude',
  'projects/_TEMPLATE',
  'projects/README.md',
  '.gitignore',
  'CLAUDE.md',
  /*
   * The two READMEs that describe a workspace directory to the person standing in it, both found
   * by enumerating every tracked path rather than waiting for a fourth one to bite.
   *
   * `memory/README.md` is the file `memory.ts` already excludes from being counted as a memory —
   * *"It is committed, and it explains the directory to a person"* — so the guard was protecting
   * against a file no office had. `.gitignore` says the same thing from the other side, keeping
   * `memory/**` out of a push with `!memory/README.md` as the one exception.
   *
   * `assets/themes/README.md` says where a bought art pack goes, in a directory `scanThemes`
   * actually reads from the workspace root. Without it that directory does not exist and there is
   * nothing anywhere in an office saying art is possible.
   */
  'memory/README.md',
  'assets/themes/README.md',
]

/**
 * Every file the office actually seeds, expanded from `SHIPPED`.
 *
 * The expansion is not just `git ls-files`: `package.json`'s `extraResources` carries `!`
 * exclusions for the `.claude` resource, and a tracked file matching one of those is **not**
 * packaged. `.claude/launch.json` is exactly that — tracked, never shipped — and a check that
 * skipped this step reported it as an uncovered seed file, which would have sent somebody adding
 * a privacy-panel entry for a file no office ever receives.
 *
 * `git` is injected rather than imported so the build can pass its own runner and a test can pass
 * anything. The alternative was two copies of this filter, which is the fault it exists to stop.
 */
/**
 * Does a path inside `.claude/` reach the package?
 *
 * Asked of **electron-builder's own matcher**, not of a reading of the filter. This used to
 * interpret the `!` entries by hand, which worked only while the filter was a deny-list — and
 * the filter is an allow-list now, with no `!` entries at all. That reading would have returned
 * "nothing is excluded" and put every tracked `.claude` file back in the manifest, including the
 * `launch.json` that `#168` removed. A hand-reading of a filter is a second implementation of
 * somebody else's globbing, and it is wrong the moment the shape changes.
 *
 * `app-builder-lib` is a dev dependency and this reaches into its `out/`, which is not a public
 * entry point. That is deliberate: if it moves, this throws at import and every caller stops
 * loudly. The alternative — reimplementing the match — fails silently and agrees with itself.
 */
export function shipsFromClaude(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const resource = (pkg.build?.extraResources ?? []).find((r) => r.from === '.claude')
  if (!resource) throw new Error('package.json has no `.claude` extraResources entry')

  const from = join(root, '.claude')
  const match = new FileMatcher(from, '/unused', (it) => it, resource.filter).createFilter()
  // The matcher takes a stat only to tell files from directories; every path asked here is a file.
  const asFile = { isDirectory: () => false, isFile: () => true }
  return (inside) => match(join(from, inside), asFile)
}

export function seededFiles(root, git) {
  const ships = shipsFromClaude(root)

  return git(['ls-files', '-z', '--', ...SHIPPED])
    .split('\0')
    .filter(Boolean)
    /*
     * The exclusions belong to the `.claude` resource, so they are applied to `.claude` paths and
     * to nothing else.
     *
     * This stripped the prefix from *every* tracked path and then tested the result, so
     * `CLAUDE.md`, `.gitignore`, `memory/README.md` and `assets/themes/README.md` were measured
     * against a filter that has no authority over them. Demonstrated: adding `!CLAUDE.md` to that
     * resource's filter silently removed `CLAUDE.md` from the seed — the regression this module's
     * own docstring calls the worst of them, reachable by editing an unrelated resource.
     *
     * The old comment said the `projects/` paths "never match one", which was true of today's
     * `package.json` rather than of this code — a property of data, defended as if it were a
     * property of the function.
     */
    .filter((path) => {
      if (!path.startsWith('.claude/')) return true
      return ships(path.slice('.claude/'.length))
    })
}
