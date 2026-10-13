/**
 * What this app leaves on disk, checked against the files that are supposed to control it.
 *
 * "It should not leak everything" is not answerable by intent. These tests turn it into three
 * questions with answers: is everything personal gitignored, is anything personal in the
 * package, and does the list itself still describe the repo.
 *
 * The failure they exist to catch is a *new* store — somebody adds one, forgets `.gitignore`,
 * and a user's memory rides into a commit. That has happened to enough projects to be worth a
 * test rather than a convention.
 */

import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

// @ts-expect-error — a plain .mjs declaration with no types, read for its expansion of SHIPPED.
import { seededFiles, shipsFromClaude } from '../scripts/shipped.mjs'
import { STORES, template, warnBeforeDeleting, yours } from '../src/main/persistence.js'

const root = process.cwd()

test('every personal store is gitignored', async () => {
  // The one that keeps somebody's memory out of a commit. A store added to STORES and not to
  // .gitignore is a leak with a test that would have caught it.
  const ignore = await readFile(join(root, '.gitignore'), 'utf8')

  for (const store of yours()) {
    const top = store.path.split('/')[0]!
    assert.match(
      ignore,
      new RegExp(`^${top.replace('.', '\\.')}`, 'm'),
      `${store.path} accumulates as you work and is not in .gitignore`,
    )
  }
})

test('memory is ignored right down to its contents', async () => {
  // The most sensitive store in the app, and the one a shallow rule misses: `memory` alone
  // ignores the directory while `memory/**` ignores what is in it, and a rule that only names
  // the directory can be defeated by a path that reaches inside it.
  const ignore = await readFile(join(root, '.gitignore'), 'utf8')
  assert.match(ignore, /^memory\/\*\*$/m)
  // …and the README explaining the directory is deliberately kept.
  assert.match(ignore, /^!memory\/README\.md$/m)
})

test('nothing personal is in the package', async () => {
  // What ships and what accumulates are different things, and only one is safe to hand somebody.
  // A clone arriving with somebody else's memory is a worse failure than one arriving with no
  // agents: the second is obviously broken and the first is not obviously anything.
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    build?: { files?: string[]; extraResources?: { from: string }[] }
  }
  // Refuses to pass vacuously. Without a build config there is nothing to check, and a test
  // that reports success because it found nothing to look at is worse than no test — it is a
  // green tick over an unexamined question. This caught itself: the first version of this file
  // passed on a branch that had no packaging config at all.
  assert.ok(pkg.build, 'there is no build config, so nothing here checked what ships')

  const shipped = [
    ...(pkg.build.files ?? []),
    ...(pkg.build.extraResources ?? []).map((r) => r.from),
  ].join(' ')
  assert.ok(shipped.length > 0, 'the build config ships nothing, so this proved nothing')

  // A shipped path leaks if it is a personal store or sits inside one — *unless* it is itself
  // listed as a template. `projects/_TEMPLATE` lives inside `projects` and is the scaffold, so
  // the exception is the design rather than a hole in the check.
  const safe = new Set(template().map((s) => s.path))

  /*
   * And the exceptions a personal store names itself.
   *
   * A `yours` store carries `shipped` — the children that are the office rather than the work:
   * `projects` names `_TEMPLATE` and `README.md`, `memory` names `README.md` and `.gitkeep`.
   * This check did not read that field, so the only reason `projects/README.md` passed was that
   * it is *also* declared as its own top-level template store. `memory/README.md` is not, and
   * adding it to the package failed here — correctly by the letter, wrongly by the design, which
   * had already said that file is shipped.
   *
   * Reading `shipped` is narrower than it sounds: it exempts named children and nothing else, so
   * `memory/what-i-learned.md` still fails exactly as before.
   */
  for (const store of yours()) {
    for (const child of store.shipped ?? []) safe.add(`${store.path}/${child}`)
  }

  for (const entry of shipped.split(/\s+/).filter(Boolean)) {
    if (safe.has(entry)) continue
    for (const store of yours()) {
      assert.ok(
        entry !== store.path && !entry.startsWith(`${store.path}/`),
        `the package ships ${entry}, which is inside ${store.path} — that is somebody's work`,
      )
    }
  }
})

test('every template store actually exists in the repo', async () => {
  // A template we ship and do not have is a first run that seeds an empty office and says
  // nothing about why.
  for (const store of template()) {
    await assert.doesNotReject(
      stat(join(root, store.path)),
      `${store.path} is listed as shipping and is not here`,
    )
  }
})

test('only the stores worth warning about produce a warning', () => {
  // A confirmation on everything is a confirmation nobody reads, and then the one that mattered
  // gets clicked through as reflex. Four of twelve is not everything — `projects`, `memory`,
  // `dispatches.jsonl` and this one, counted rather than remembered.
  assert.match(warnBeforeDeleting('memory') ?? '', /cannot be recovered/)
  assert.match(warnBeforeDeleting('projects') ?? '', /cannot be recovered/)

  /*
   * Approvals moved into this set, and the expectation changed with the fact under it rather
   * than to accommodate a diff.
   *
   * It was excluded while the entry called this store *"transient by design"* — on which reading
   * there is nothing here to lose, and no confirmation to earn. That reading was wrong:
   * **nothing removes anything from `missed/`**, so the store holds every tool call an employee
   * made that nobody answered, each with its command verbatim, accumulating for as long as the
   * office has ever run unattended. It is the only record any of it happened.
   *
   * `precious` is defined as *"deleting it loses something a person would miss"*, which is a
   * claim about contents. Under the corrected contents it is true.
   *
   * Worth knowing what this line actually guards: `warnBeforeDeleting` has **no caller in
   * `src/`** — its own docstring says so, and `views/privacy.ts` arms its button by reading
   * `store.precious` directly. So no new confirmation text appears anywhere in the running app;
   * the only visible change is that armed label gaining a byte count and the word *permanently*.
   * This assertion guards the wiring that docstring anticipates, and the question it settles is
   * the easy form: when the two are joined, should the store holding the only evidence those
   * refusals happened produce a warning?
   */
  assert.match(warnBeforeDeleting('.office-space/approvals') ?? '', /cannot be recovered/)

  assert.equal(warnBeforeDeleting('.claude/agents'), null)
  assert.equal(warnBeforeDeleting('something-invented'), null)
})

test('the list distinguishes the two kinds, and both are populated', () => {
  // A list where everything is one kind is a list nobody has thought about.
  assert.ok(yours().length > 0)
  assert.ok(template().length > 0)
  assert.equal(yours().length + template().length, STORES.length)
})

test('nothing git deliberately ignores is copied into the bundle', async () => {
  // Found by building an artifact for the first time on 2026-08-20 — which had never happened,
  // because the build config carried `_comment_*` keys and electron-builder validates its schema
  // strictly. `npm run dist` had never once produced anything, and the reason was a comment.
  //
  // The first bundle that did build shipped `.claude/settings.local.json`. That file is
  // **gitignored** — this machine's config, deliberately not the project's — and `extraResources`
  // copies the directory wholesale. A file the project takes care to keep out of version control
  // was going to everyone who installs. Here it held three disabled MCP server names; on another
  // machine `settings.local.json` carries permissions and environment.
  //
  // The rule generalises past that one file: **if git is told to ignore it, it is not ours to
  // hand out.** The two questions have the same answer and this is the only place they meet.
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    build?: { extraResources?: { from: string; filter?: string[] }[] }
  }
  assert.ok(pkg.build?.extraResources?.length, 'nothing is copied in, so this proved nothing')

  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)

  for (const resource of pkg.build.extraResources) {
    // Everything git would actually ignore under this path, asked of git rather than guessed.
    const { stdout } = await run(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', resource.from],
      { cwd: root },
    ).catch(() => ({ stdout: '' }))

    const ignored = stdout.split('\n').filter(Boolean)

    // electron-builder's `filter` is include-patterns with `!` negations. Two shapes are in use
    // here and both have to be understood, or the check passes for the wrong reason: an
    // allowlist (`["README.md"]` — only that ships) and an everything-minus-one
    // (`["**/*", "!settings.local.json"]`).
    const patterns = resource.filter ?? ['**/*']
    const include = patterns.filter((f) => !f.startsWith('!'))
    const exclude = patterns.filter((f) => f.startsWith('!')).map((f) => f.slice(1))
    const matches = (pattern: string, relative: string): boolean =>
      pattern === '**/*' || pattern === relative || pattern === relative.split('/')[0]

    const leaking = ignored.filter((path) => {
      // git reports repo-relative paths; the filter is relative to `from`.
      const relative = path.slice(resource.from.length + 1).replace(/\/$/, '')
      if (!relative) return true
      return include.some((p) => matches(p, relative)) && !exclude.some((p) => matches(p, relative))
    })

    assert.deepEqual(
      leaking,
      [],
      `${resource.from} ships these, and git is told to ignore them — add "!<name>" to its filter`,
    )
  }
})

test('every file the office writes under .office-space is a store the panel knows', async () => {
  /*
   * The privacy panel's claim is *what is on disk, and one delete each*. It keeps that by
   * measuring a fixed list, and a fixed list goes stale the moment somebody adds a writer.
   *
   * Which is what happened. `dispatches.jsonl` — the dispatch ledger — arrived with the work
   * that turns a crash into an offer, and the list was written before it existed. So the panel
   * measured the registry and the approvals directory and said nothing about the file holding
   * **every brief in the words somebody wrote**, which is the most personal thing under that
   * directory and the one thing there that holds work nobody has seen yet.
   *
   * Asserted against the real path functions rather than repeated strings, so a rename tracks
   * instead of quietly passing.
   */
  const { registryPath, STATE_DIR } = await import('../src/main/registry.js')
  const { ledgerPath } = await import('../src/main/ledger.js')
  const { WATCHING } = await import('../src/main/approvals.js')

  const listed = new Set(STORES.map((s) => s.path))

  // Everything the app writes there, named by the code that writes it.
  const written = [registryPath('/w'), ledgerPath('/w'), `/w/${WATCHING}`].map((abs) =>
    abs.replace('/w/', ''),
  )

  const uncovered = written.filter((path) => {
    if (listed.has(path)) return false
    // A file inside a listed directory is covered by it — `.watching` lives in the approvals
    // directory, which is listed and deleted whole.
    return ![...listed].some((store) => path.startsWith(`${store}/`))
  })

  assert.deepEqual(
    uncovered,
    [],
    'the office writes these and the privacy panel neither shows nor offers to delete them',
  )

  // And the directory itself is not a store, deliberately: deleting `.office-space` whole would
  // take the registry, the ledger and the approvals rendezvous with it in one click.
  assert.equal(listed.has(STATE_DIR), false, 'the state directory must not be deletable as one lump')
})


test('the workspace the app seeds carries nothing that only makes sense in this repo', async () => {
  // `.claude/launch.json` is Claude Code's dev-server config for building *this* repo — it serves
  // `dist/` on a port so the renderer can be driven without Electron. Somebody who installs the
  // app has no `dist/` to serve, and the office never reads the file: `grep -rn launch.json src/`
  // is empty. It is ours, not theirs.
  //
  // #124 settled what to do about our own harness riding along in the package — there it was
  // `dev.html` and `mock.js` in `build.files`, "the dev harness whose job is drawing seven people
  // who do not exist". This is the same thing one directory over, in `extraResources`, and it was
  // missed because that half of the config was never read with the same question in mind.
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    build?: { extraResources?: { from: string; filter?: string[] }[] }
  }

  // The instrument first. A parse that quietly found nothing must fail as "I could not look",
  // never as "nothing is leaking" — the two are indistinguishable from the assertion downstream.
  const workspace = (pkg.build?.extraResources ?? []).find((r) => r.from === '.claude')
  assert.ok(workspace, 'nothing copies `.claude` into the bundle, so this test proved nothing')
  const filter = workspace.filter
  assert.ok(filter, 'the `.claude` resource ships unfiltered, so the exclusion below is not in force')
  assert.ok(filter.length > 0, 'the filter is empty, so nothing of the workspace ships at all')

  // And the file is still there, so this is aimed at something rather than left behind pointing
  // at nothing — which is how a rule stops being a rule while still reading like one.
  await assert.doesNotReject(
    stat(join(root, '.claude/launch.json')),
    'this check has outlived the file it is about — delete one or the other',
  )

  /*
   * Asked as *does it ship*, not as *is `!launch.json` in the list*.
   *
   * This used to assert the filter contained `'**\/*'` and `'!launch.json'` — the spelling of a
   * deny-list. The filter is an allow-list now and both assertions went red while the fact they
   * protect was still true: `launch.json` does not ship, and is excluded more strongly than
   * before, by not being named at all. A test written against the shape of a config cannot tell
   * a change of shape from a regression. Put through `shipsFromClaude`, this survives either.
   */
  assert.equal(
    shipsFromClaude(root)('launch.json'),
    false,
    '.claude/launch.json ships to users; it is this repo’s dev-server config and they have no dist/',
  )
})

test('the shipped manifest cannot claim a file the package does not contain', async () => {
  // `dist/shipped-hashes.json` is what `reconcile.ts` plans from, and it then *reads* the file
  // each entry names. A path in the manifest that `extraResources` does not copy is
  // `readFile` → ENOENT → `failed.push`, which the office reports to the user on first run as a
  // file it could not bring forward. A packaging exclusion becomes a visible first-run failure.
  //
  // The two lists agreed by accident until now: the manifest's set is `git ls-files .claude`,
  // and everything the filter excluded — `settings.local.json`, `worktrees/` — happened to be
  // gitignored, so git never listed it and nobody had to keep them together. `.claude/launch.json`
  // is the first tracked file the filter excludes, and it broke that.
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    build?: { extraResources?: { from: string; filter?: string[] }[] }
  }
  const resource = (pkg.build?.extraResources ?? []).find((r) => r.from === '.claude')
  assert.ok(resource?.filter, 'the `.claude` resource has no filter — this test went blind')

  /*
   * What the filter refuses, asked of the matcher rather than read off the `!` entries.
   *
   * This derived `excluded` from entries beginning `!`, which worked only while the filter was a
   * deny-list. It is an allow-list now and has none, so that reading returned "nothing is
   * excluded" — and the instrument check on the next line fired, correctly, rather than letting
   * the loop below pass over an empty list. That failure is why this is written the other way:
   * the refused set is every tracked `.claude` path the matcher will not admit.
   */
  const gitFiles = (dir: string) =>
    execFileSync('git', ['ls-files', '-z', '--', dir], { encoding: 'utf8', cwd: root })
      .split('\0')
      .filter(Boolean)
  const ships = shipsFromClaude(root) as (inside: string) => boolean
  const excluded = gitFiles('.claude')
    .filter((path) => !ships(path.slice('.claude/'.length)))
    .map((path) => path.slice('.claude/'.length))
  assert.ok(excluded.length > 0, 'the filter refuses no tracked file, so this test proves nothing')

  /*
   * The build must *read* that filter rather than restate it. Restating is what let them drift,
   * and a second copy of this list is the thing being removed.
   *
   * Asserted on the behaviour rather than on the source. This was a regex over `scripts/build.mjs`
   * looking for `extraResources … startsWith('!')`, and it went red the moment that code moved
   * into `scripts/shipped.mjs` — correctly, since it could no longer see what it was checking,
   * and its message said exactly that. But a pattern over source fails for a rename or a
   * reformat as readily as for a real regression, and the thing actually worth guaranteeing is
   * that a tracked-but-excluded file does not end up in the seed.
   *
   * `.claude/launch.json` is that file: tracked, and excluded by the filter above. If the
   * expansion ever stops honouring the exclusions, it appears here.
   */
  const git = (args: readonly string[]) => execFileSync('git', [...args], { encoding: 'utf8', cwd: root })
  const seeded: string[] = seededFiles(root, git)
  assert.equal(seeded.length, 28, `the expansion listed ${seeded.length} files, not 28`)

  /*
   * Only the exclusions git can actually return, and this is the whole correction.
   *
   * Four entries are excluded by that filter and **one** of them is tracked. `settings.local.json`
   * and `worktrees` are gitignored, so `git ls-files` can never produce them however wrong
   * `seededFiles` becomes — their assertions could not fire, and three of this loop's four
   * iterations were structurally incapable of failing while reading as four checks.
   *
   * Derived from the index rather than asserted from memory, so it stays true when what is
   * tracked changes.
   */
  // Tracked by construction now: the refused set was built *from* the index, so the correction
  // this block used to make — that three of its four iterations could never fire, because
  // `settings.local.json` and `worktrees` are gitignored and `git ls-files` cannot return them —
  // is no longer possible to reintroduce. Every entry here is a real tracked file.
  const testable = excluded.map((skip) => `.claude/${skip}`)
  for (const path of testable) {
    assert.equal(
      seeded.some((p) => p === path || p.startsWith(`${path}/`)),
      false,
      `${path} is excluded from the package and the seed expansion still lists it, so the ` +
        'manifest will name a file the bundle does not contain — ENOENT on somebody’s first run.',
    )
  }

  /*
   * The glob-shape assertion that stood here is gone, and deliberately.
   *
   * It checked that no exclusion used a pattern `seededFiles` could not honour — true and useful
   * while `seededFiles` compared exclusions as literal paths with one trailing `/**\/*` stripped.
   * It asks the real matcher now, so any pattern electron-builder honours, it honours too, and
   * the limitation the assertion guarded no longer exists.
   *
   * Left as a note rather than deleted silently: with the refused set derived from the index, the
   * loop would have iterated real file paths and asserted they contain no `*` or `?` — passing
   * always, checking nothing, and reading like a fourth guard.
   */

  // And the consequence, checked against the artifact when there is one. `dist/` is gitignored
  // and CI builds *after* it tests, so this half is conditional — said plainly rather than left
  // to look like a check that always ran.
  let manifest: string
  try {
    manifest = await readFile(join(root, 'dist/shipped-hashes.json'), 'utf8')
  } catch {
    return
  }
  /*
   * `.files`, not the top level. The build writes `{ generatedAt, files: { "<path>": … } }`, so
   * reading the top level gave `["generatedAt", "files"]` every time: `claimed.length > 0` passed
   * on those two keys and `claimed.includes('.claude/…')` could never be true. Both assertions
   * below were incapable of failing under any input.
   *
   * It went unnoticed because the comment above says this half is conditional in CI — which was
   * true until the build was moved ahead of the tests. It now runs on every CI run, so a check
   * that cannot fail is worse than one that is skipped: it reads as coverage.
   *
   * `test/what-a-push-would-carry.test.ts` has always done it this way.
   */
  const parsed = JSON.parse(manifest) as { files?: Record<string, unknown> }
  const claimed = Object.keys(parsed.files ?? {})
  assert.ok(claimed.length > 0, 'the manifest is empty — it would claim nothing and prove nothing')
  for (const skip of excluded) {
    assert.ok(
      !claimed.includes(`.claude/${skip}`),
      `the manifest claims .claude/${skip}, which extraResources does not copy`,
    )
  }
})
