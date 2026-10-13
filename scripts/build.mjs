/**
 * Build.
 *
 * Two outputs with different rules, which is why this is a script and not one `tsc` call:
 *
 *   **Everything except the preload** compiles to ESM with `tsc`, which is what Electron's
 *   main process and the renderer both want.
 *
 *   **The preload** is bundled to CommonJS with esbuild, because a *sandboxed* preload must be
 *   CJS. It could have been hand-written as `.cjs` to avoid the extra step, but then the IPC
 *   channel names would exist in two places, and the entire point of `CHANNEL` is that main
 *   and preload cannot drift apart. Bundling inlines them from the one definition, and
 *   `sandbox: true` survives.
 *
 * The third output is not code at all: `dist/shipped-hashes.json`, the record of every version
 * of every `.claude/` file this repo has ever shipped. See the bottom of this file, and
 * `src/main/reconcile.ts` for what an installed office does with it.
 */

import { build } from 'esbuild'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { SHIPPED, seededFiles } from './shipped.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })

run('npx', ['tsc', '-p', 'tsconfig.build.json'])

await build({
  entryPoints: [join(root, 'src/preload/preload.ts')],
  outfile: join(root, 'dist/preload/preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Provided by the runtime; bundling it would produce a second, broken copy.
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
})

// `tsc` copies no assets, and the renderer is loaded from disk by `file://`.
await mkdir(join(root, 'dist/renderer'), { recursive: true })
for (const file of ['index.html', 'styles.css', 'panels.css']) {
  await cp(join(root, 'src/renderer', file), join(root, 'dist/renderer', file))
}

// The dev harness, generated from the same markup rather than a second copy of it — a
// duplicated index.html would drift, and a harness that no longer matches the app is worse
// than none. See src/renderer/mock.ts.
const html = await readFile(join(root, 'src/renderer/index.html'), 'utf8')
await writeFile(join(root, 'dist/renderer/dev.html'), html.replace('src="app.js"', 'src="mock.js"'))

// ────────────────────────────────────────────────── the shipped-file manifest ──
//
// An installed office is seeded from `.claude/` once and then left alone, so that an update can
// never overwrite an agent somebody has tuned — see `src/main/workspace-root.ts`. The price is
// that shipped fixes never reach anyone who already has an office, which has happened for real
// and was put right by hand.
//
// `src/main/reconcile.ts` undoes that at startup, and it may only move a file it can *prove*
// nobody has typed in. The proof is history: if a file's content hash matches any version this
// repo has ever shipped, it is still the copy that was put there. So the build walks every
// commit that touched `.claude/` and writes down the sha256 of every version it finds.
//
// The set of files is `git ls-files`, never a walk of the directory. `.claude/` on a working
// machine also holds `settings.local.json`, agent worktrees and session state, none of which is
// shipped, and a manifest that claimed them would have the app copying a developer's private
// state into somebody else's office.
//
// This comment used to say that was "the same exclusions `package.json`'s extraResources filter
// names". **It was not — it agreed with them by accident.** Every one of those paths is
// gitignored, so `git ls-files` never saw them, and nobody had to keep the two lists together.
// The first tracked file the filter excluded broke it: `.claude/launch.json` is committed, so
// git lists it, so the manifest claimed it — while `extraResources` had stopped copying it into
// the package.
//
// What that costs is not a stale entry. `reconcile.ts` plans from the manifest and then reads
// the file it names; a path the package does not contain is `readFile` → ENOENT →
// `failed.push`, which is **reported to the user** on first run as a file the office could not
// bring forward. A packaging exclusion would have shipped as a visible first-run failure.
//
// So the exclusions are read from `package.json` now rather than restated, and
// `test/persistence.test.ts` holds the two together.
//
// ## Why this is not only `.claude/`
//
// It was, and that broke the product's core loop for everybody who was not running from a clone.
//
// `projects/_TEMPLATE` is what `+ new project` copies. It ships — `package.json`'s
// `extraResources` puts it in the bundle — but shipping it into the *app* is not the same as
// seeding it into somebody's *workspace*, and only this manifest does the second thing. So a
// fresh office got its seven agents and five skills and no `projects/` directory at all, and
// pressing `+ new project` answered:
//
//   "A project is a directory under projects/ copied from projects/_TEMPLATE — and that template
//    is missing, so the office cannot start one for you. Create the directory by hand, or
//    re-clone."
//
// Which is honest, and is the app correctly reporting that it had been shipped without the one
// file it needs to do the thing it is for. Measured on a workspace holding nothing but
// `.claude/agents/manager.md`: manifest 21 entries, every one under `.claude/`, none under
// `projects/`.
//
// The reconciler already knows how to create a file that is absent — `added` is one of its
// verdicts — so the whole fix is telling it that these paths are ours to seed.
//
// `.gitignore` is here for the same reason and a sharper one. Its own header states the rule
// this whole manifest exists to implement — *"we ship the OFFICE (agents, skills, commands,
// settings). You keep the WORK (memory, projects, history, credentials)"* — and a fresh office
// was getting the first half and not the second. Driven: a new workspace has no `.gitignore` at
// all, and the privacy panel says so in as many words — **"3 things meant to stay on this
// machine would be included in a push"**, naming `memory`, `projects` and `.office-space`, each
// with *"Git is not ignoring this, so a push would publish it."*
//
// The panel was right and doing its job; the office was shipping itself the rules and not
// shipping them to the workspace it creates. The whole file is seeded rather than a trimmed
// copy: its Node and build rules are useful in a workspace whose projects hold real code — the
// office writes `package.json` into one — and a second, shorter version would be a second place
// for the rule to live and drift.

const gitText = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const gitBytes = (args) =>
  execFileSync('git', args, { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const manifestPath = join(root, 'dist/shipped-hashes.json')


try {
  // One definition, in `shipped.mjs`, so the list this build writes and the list the privacy
  // panel is checked against cannot drift apart.
  const tracked = seededFiles(root, (args) => gitText(args))

  // `rev-list` gives newest first, so reverse it and every path's versions come out in the
  // order they were actually written.
  const commits = gitText(['rev-list', 'HEAD', '--', ...SHIPPED]).split('\n').filter(Boolean).reverse()
  const blobs = new Map(tracked.map((path) => [path, []]))

  for (const commit of commits) {
    for (const entry of gitText(['ls-tree', '-r', '-z', commit, '--', ...SHIPPED]).split('\0')) {
      if (!entry) continue
      // `<mode> <type> <object>\t<path>`
      const tab = entry.indexOf('\t')
      const oid = entry.slice(0, tab).split(' ')[2]
      const seen = blobs.get(entry.slice(tab + 1))
      if (seen && !seen.includes(oid)) seen.push(oid)
    }
  }

  // One `cat-file` per distinct blob, hashed once and shared by every path that used it.
  const hashOfBlob = new Map()
  for (const oids of blobs.values()) {
    for (const oid of oids) {
      if (!hashOfBlob.has(oid)) hashOfBlob.set(oid, sha256(gitBytes(['cat-file', 'blob', oid])))
    }
  }

  const files = {}
  for (const path of tracked) {
    // The working tree, not HEAD: what ships is what is on disk when the build runs, and a file
    // staged but not yet committed still has to be recognisable as ours on the next launch.
    const current = sha256(await readFile(join(root, path)))
    const history = (blobs.get(path) ?? []).map((oid) => hashOfBlob.get(oid))
    files[path] = { hashes: [...history.filter((h) => h !== current), current], current }
  }

  await writeFile(
    manifestPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), files }, null, 2)}\n`,
  )
  console.log(`shipped-hashes.json → ${tracked.length} files`)
} catch (err) {
  // No git, no history, no proof — and without proof the reconciler must not move anything. An
  // old manifest left lying in `dist/` would describe a build that no longer exists, so it goes.
  // Its absence is what the app reports as "could not check", which is the truth. That is not
  // the same statement as "there was nothing to update", and must never be mistaken for it.
  await rm(manifestPath, { force: true })
  console.warn(
    `no shipped-file manifest: ${err instanceof Error ? err.message : String(err)}\n` +
      '  .claude/ updates are derived from git history, so a build without git cannot make one.\n' +
      '  The app will say it could not check rather than silently skipping the update.',
  )
}

console.log('built → dist/   (dev harness: npm run harness)')
