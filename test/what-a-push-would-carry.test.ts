/**
 * The office's own promise, checked against git rather than against itself.
 *
 * VISION.md §7: *"**Memory and personal data are never pushed.** The repo ships the office; the
 * contents stay yours."* `.gitignore` implements that and says so at the top. Nothing in the app
 * has ever shown it, so the only way to know whether what you just typed is about to be shared
 * was to leave and read a dotfile.
 *
 * The rule that makes this worth building rather than tabulating: **the answer comes from git.** A
 * list in our source saying which paths are ignored would agree with `.gitignore` on the day it
 * was written and drift silently after — two definitions of one fact, in the direction where
 * being wrong means somebody's memory directory is on GitHub.
 *
 * These tests build real repositories with real `.gitignore` files and ask.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
// @ts-expect-error — a plain .mjs declaration with no types, read for its one exported list.
import { seededFiles } from '../scripts/shipped.mjs'
import { join } from 'node:path'

import { whatWouldBeShared } from '../src/main/sharing.js'
import { WRITES, probe, saidPlainly, sharingLede, verdictFor, type Written, rowsSayVerdict } from '../src/shared/sharing.js'

import { tempDir } from './temp-dir.js'

const SHIPPED_GITIGNORE = `memory/**
projects/**
.office-space/
.claude/settings.local.json
`

async function aWorkspace(t: TestContext, gitignore?: string): Promise<string> {
  const root = await tempDir(t, 'office-share-')
  await mkdir(join(root, '.claude', 'agents'), { recursive: true })
  if (gitignore !== undefined) await writeFile(join(root, '.gitignore'), gitignore)
  return root
}

/*
 * A repository whose only ignore rules are the ones this file wrote.
 *
 * `core.excludesFile` is set per-repo, and it has to be: a developer's `~/.config/git/ignore` is
 * consulted by *path convention*, so `GIT_CONFIG_GLOBAL=/dev/null` does not switch it off. This
 * was found the honest way — the assertion that an empty `.gitignore` leaks everything failed on
 * one machine and would have passed on another, because that machine's global ignore has a rule
 * covering `.claude/settings.local.json` anywhere in a tree. (Written out rather than pasted:
 * the glob for that ends in a star-slash, which closes the comment it is sitting in.)
 *
 * The product deliberately does **not** do this. A user's global ignore genuinely decides what a
 * push carries, so honouring it is the whole point; it is only the test that must not depend on
 * whose machine it runs on.
 */
function makeRepo(root: string): void {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: 'ignore' })
  git('init', '--quiet', '-b', 'main')
  git('config', 'core.excludesFile', '/dev/null')
}

const verdictsIn = (rows: readonly { path: string; verdict: string }[]): Record<string, string> =>
  Object.fromEntries(rows.map((r) => [r.path, r.verdict]))

test('with the gitignore this repo ships, your work is kept and the office is shared', async (t) => {
  const root = await aWorkspace(t, SHIPPED_GITIGNORE)
  makeRepo(root)

  const rows = await whatWouldBeShared(root)
  const by = verdictsIn(rows)

  assert.equal(by['memory'], 'kept')
  assert.equal(by['projects'], 'kept')
  assert.equal(by['.office-space'], 'kept')
  assert.equal(by['.claude/settings.local.json'], 'kept')

  assert.equal(by['.claude/agents'], 'shared')
  assert.equal(by['.claude/skills'], 'shared')
  assert.equal(by['.mcp.json'], 'shared')

  assert.equal(rows.some((r) => r.verdict === 'leaking'), false)
  assert.match(sharingLede(rows.map((r) => r.verdict)), /Your work stays yours/)
})

/*
 * The state the whole feature is for.
 *
 * A workspace whose `.gitignore` lost the memory rule — or never had it, because somebody started
 * their office from a bare `git init` rather than a clone.
 */
test('a memory directory git would push is found, and leads the summary', async (t) => {
  const root = await aWorkspace(t, 'projects/**\n.office-space/\n.claude/settings.local.json\n')
  makeRepo(root)

  const rows = await whatWouldBeShared(root)
  const memory = rows.find((r) => r.path === 'memory')
  assert.equal(memory?.verdict, 'leaking')
  assert.match(saidPlainly(memory?.what ?? '', 'leaking'), /a push would publish it/)

  const lede = sharingLede(rows.map((r) => r.verdict))
  assert.match(lede, /^One thing meant to stay on this machine would be included in a push\./)
  assert.doesNotMatch(lede, /stays yours/, 'the good news never goes in front of this')
})

test('several leaks are counted rather than reported one at a time', () => {
  assert.match(sharingLede(['leaking', 'leaking', 'kept', 'shared']), /^2 things meant to stay/)
})

/*
 * Not a repository is a real answer, and a different one from safe.
 *
 * "Your memory is not being pushed" is true here — for a reason that stops applying the moment
 * somebody runs `git init`, which is a sentence that should not be reused for both.
 */
test('a workspace that is not a repository says so, rather than reporting everything as safe', async (t) => {
  const root = await aWorkspace(t, SHIPPED_GITIGNORE)

  const rows = await whatWouldBeShared(root)
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => r.verdict === 'nowhere'), 'every row, since it is one fact about the workspace')

  const lede = sharingLede(rows.map((r) => r.verdict))
  assert.match(lede, /not a git repository/)
  assert.match(lede, /becomes a real question the day it is/)
  assert.doesNotMatch(lede, /stays yours/)
})

/*
 * Exit 1 from `check-ignore` is the answer "not ignored", and `execFile` delivers it as a
 * rejection. Reading it as a failure would turn the single alarming state into a shrug on every
 * row — the bug this test exists to keep out.
 */
test('a path git reports as not ignored is tracked, never unknown', async (t) => {
  const root = await aWorkspace(t, '')
  makeRepo(root)

  const rows = await whatWouldBeShared(root)
  assert.equal(rows.some((r) => r.verdict === 'unknown'), false, 'exit 1 is an answer, not a failure')
  assert.equal(
    rows.filter((r) => r.side === 'yours').every((r) => r.verdict === 'leaking'),
    true,
    'an empty gitignore really does mean all of it would go',
  )
})

test('a file already committed still reports what the rules say about it', async (t) => {
  const root = await aWorkspace(t, SHIPPED_GITIGNORE)
  makeRepo(root)
  await mkdir(join(root, 'memory'), { recursive: true })
  await writeFile(join(root, 'memory', 'note.md'), 'something\n')
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: 'ignore' })
  git('add', '-f', 'memory/note.md')

  const rows = await whatWouldBeShared(root)
  // `--no-index` is why. Without it, a path already in the index comes back "not ignored", and
  // the panel would report a leak whose cause it cannot name.
  assert.equal(rows.find((r) => r.path === 'memory')?.verdict, 'kept')
})

test('every verdict has a sentence, and no two states share one', () => {
  const said = (['kept', 'shared', 'leaking', 'withheld', 'nowhere', 'unknown'] as const).map((v) =>
    saidPlainly('Notes.', v),
  )
  assert.equal(new Set(said).size, 6)
  for (const s of said) assert.ok(s.trim().length > 0)
})

test('unknown is never summarised as safe', () => {
  assert.match(sharingLede(['unknown', 'unknown']), /nothing here is known/)
  const mixed = sharingLede(['kept', 'shared', 'unknown'])
  assert.match(mixed, /could not be checked/)
  assert.match(mixed, /not the same as safe/)
})

test('the two sides are decided by expectation, and the answer by git', () => {
  const yours: Written = { path: 'memory', what: 'X.', side: 'yours', directory: true }
  const shipped: Written = { path: '.claude/agents', what: 'X.', side: 'shipped', directory: true }

  // The same answer from git means opposite things depending on which side the path belongs to,
  // which is the entire reason `side` is written down rather than inferred from the answer.
  assert.equal(verdictFor(yours, { kind: 'ignored' }), 'kept')
  assert.equal(verdictFor(shipped, { kind: 'ignored' }), 'withheld')
  assert.equal(verdictFor(yours, { kind: 'tracked' }), 'leaking')
  assert.equal(verdictFor(shipped, { kind: 'tracked' }), 'shared')
})

test('.mcp.json is listed as shared, and says why that is safe', () => {
  const mcp = WRITES.find((w) => w.path === '.mcp.json')
  assert.ok(mcp)
  assert.equal(mcp.side, 'shipped')
  assert.match(mcp.what, /\$\{VARIABLE\} references and never a secret/)
})

/*
 * The list of what the office writes is hand-written, because nothing can derive it. This is the
 * guard: a write in the main process that lands somewhere the list does not cover.
 *
 * It resolves the constant inside a *write call* joined onto the workspace root, and each half
 * of that matters. `transcript-store.ts` declares its own `PROJECTS_DIR`, meaning
 * `.claude/projects`, and joins it onto **home** — Claude Code's store, on the other side of the
 * machine. Two constants of one name meaning different paths, told apart only by what they are
 * joined to: the recurring shape, sitting inside the thing that checks for it.
 *
 * The write half matters too: `transcript-store.ts` declares its own `PROJECTS_DIR`, meaning `.claude/projects`,
 * and joins it onto **home** — Claude Code's transcript store, on the other side of the machine
 * from this workspace. Two constants of the same name meaning different paths, told apart only by
 * what they are joined to: the recurring shape, sitting in the middle of the thing that checks for
 * it.
 */
test('every workspace path the main process writes to is covered by the list', async () => {
  const { readFile, readdir } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { dirname } = await import('node:path')
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

  const files: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(join(repo, dir), { withFileTypes: true })) {
      if (e.isDirectory()) await walk(`${dir}/${e.name}`)
      else if (e.name.endsWith('.ts')) files.push(`${dir}/${e.name}`)
    }
  }
  await walk('src/main')
  assert.ok(files.length > 20, `only ${files.length} main files found — this scan is reading nothing`)

  const uncovered: string[] = []
  let joined = 0

  for (const file of files) {
    const source = await readFile(join(repo, file), 'utf8')
    // Constants declared in this module, resolved to a literal path.
    const constants = new Map<string, string>()
    for (const m of source.matchAll(/^(?:export )?const (\w+) = (?:join\(([^)]*)\)|'([^']*)')/gm)) {
      const value = m[3] ?? (m[2] ?? '').split(',').map((p) => p.trim().replace(/^'|'$/g, '')).join('/')
      if (value) constants.set(m[1] as string, value)
    }
    // Constants built from other constants — `WATCHING = join(DIR, '.watching')`.
    for (const [name, value] of [...constants]) {
      const [head, ...rest] = value.split('/')
      const resolved = constants.get(head as string)
      if (resolved) constants.set(name, [resolved, ...rest].join('/'))
    }

    /*
     * Writes only, not every join onto the root.
     *
     * `workspace.ts` does `readdir(join(root, CLAUDE_DIR))` and `main.ts` reads
     * `.claude/settings.json`. Both are joins onto this workspace and neither puts anything
     * there, so counting them would demand entries for paths the office only looks at — and the
     * list would stop meaning "what the office writes", which is the only thing it is for.
     */
    for (const m of source.matchAll(/\b(writeFile|mkdir|rename|unlink|rm|cp|appendFile)\(([^;]{0,160})/g)) {
      const target = /join\((?:root|WORKSPACE_ROOT), *(\w+)/.exec(m[2] as string)
      if (!target) continue
      const value = constants.get(target[1] as string)
      if (value === undefined) continue
      joined += 1
      const covered = WRITES.some((w) => value === w.path || value.startsWith(`${w.path}/`))
      if (!covered) uncovered.push(`${file}: ${m[1]}(join(root, ${target[1]})) → ${value}`)
    }
  }

  /*
   * 5 is what the scan resolves today, counted rather than guessed: two in `approvals.ts`, one in
   * `changes.ts`, one in `hired-from.ts`, one in `orphans.ts`. (`connectors.ts` used to add two;
   * its writes no longer join a resolvable constant onto the root.)
   *
   * It was 4, inherited from when there were fewer, and a floor below the real number is a
   * write that can silently stop being scanned while this still reports that every
   * workspace path the main process writes to is covered. A floor rather than an equality
   * because a new write should not fail this test — it should be caught by the coverage
   * assertion below, which is the one with something to say about it.
   */
  assert.ok(joined >= 5, `only ${joined} workspace writes resolved — the scan is reading nothing`)
  assert.deepEqual(
    [...new Set(uncovered)],
    [],
    'the main process joins these onto the workspace root and WRITES does not cover them, so the ' +
      'panel that answers "what would a push carry" is answering about less than the office writes.',
  )
})

/*
 * The bug the first version of this shipped with.
 *
 * `check-ignore memory` answers *not ignored* under `memory/**`, because that pattern matches
 * files inside the directory and not the directory itself — so the panel reported three leaks
 * against this repository's own `.gitignore`, which is the exact opposite of the truth. Both rule
 * styles are checked, since neither alone would have caught it: the star-star form needs the
 * child, and the trailing-slash form matches either.
 */
test('a directory is asked about by one of its children, because the bare name answers wrongly', async (t) => {
  const root = await aWorkspace(t, 'memory/**\n.office-space/\n.claude/settings.local.json\nprojects/**\n')
  makeRepo(root)

  assert.equal(probe({ path: 'memory', what: '', side: 'yours', directory: true }), 'memory/anything')
  assert.equal(probe({ path: '.mcp.json', what: '', side: 'shipped', directory: false }), '.mcp.json')

  const by = verdictsIn(await whatWouldBeShared(root))
  assert.equal(by['memory'], 'kept', 'the star-star style')
  assert.equal(by['.office-space'], 'kept', 'and the trailing-slash style')
})

/*
 * Seen in the running app, and the second time this exact thing has been caught by looking.
 *
 * These sentences go into `textContent`. `**not**`, meant as emphasis, arrived as four literal
 * asterisks on the one row a person most needs to read — the same shape as the memory panel's
 * `**Why it matters:**`, which was also found by drawing it rather than by testing it. The
 * emphasis is the row's colour now, which is something the panel can render.
 */
test('no sentence carries markdown, because every one of them is drawn as plain text', () => {
  const said = [
    ...(['kept', 'shared', 'leaking', 'withheld', 'nowhere', 'unknown'] as const).map((v) =>
      saidPlainly('Notes.', v),
    ),
    sharingLede(['leaking']),
    sharingLede(['kept', 'shared']),
    sharingLede(['unknown', 'kept']),
    sharingLede(['nowhere']),
    sharingLede([]),
  ]
  for (const sentence of said) {
    assert.doesNotMatch(sentence, /\*\*|__|`/, `markdown in a sentence drawn as text: ${sentence}`)
  }
})

/*
 * The workspace is gone, and git is fine.
 *
 * `execFile` reports the same `ENOENT` whether the binary is missing or the `cwd` it was told to
 * run in is. The first version of this said *"git is not installed, or is not on the office's
 * PATH"* about a directory somebody had deleted while the app was open — sending them to check
 * their PATH, which is fine, and not the problem, and three steps from the answer.
 *
 * Found by chasing a coverage gap into the branch, which is the whole argument for reading the
 * report rather than the total.
 */
test('a workspace that is no longer on disk says that, and does not blame git', async (t) => {
  const root = await tempDir(t, 'office-share-gone-')
  await rm(root, { recursive: true, force: true })

  const rows = await whatWouldBeShared(root)
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => r.verdict === 'unknown'), 'nothing is known, and nothing reads as safe')
  assert.match(rows[0]?.detail ?? '', /not on disk any more/)
  assert.doesNotMatch(rows[0]?.detail ?? '', /git is not installed/, 'git is installed; the workspace is not there')

  // And the summary never turns an unknown into an assurance.
  assert.match(sharingLede(rows.map((r) => r.verdict)), /nothing here is known/)
})

test('rows stop repeating a sentence the lede has already said for all of them', () => {
  /*
   * Found by opening the panel with `scripts/look.mjs`. `nowhere` is a fact about the
   * *workspace* — there is no repository — and `sharingLede` says it once at the top. Each row
   * said it too, so a workspace with seven watched paths printed "This workspace is not a git
   * repository, so nothing is being pushed anywhere yet" **seven times**, directly under a
   * heading that had just said it.
   *
   * This panel's whole job is that a row which differs should be visible. Seven identical lines
   * are the worst possible background for that.
   */
  assert.equal(rowsSayVerdict(['nowhere', 'nowhere', 'nowhere']), false)
})

test('a row that differs keeps its own sentence', () => {
  /*
   * The half that must not move. `every` rather than `some`: if a mixed list is ever reachable,
   * losing the per-row answers to a lede that spoke for only some of them would hide the one row
   * somebody opened this panel to find.
   */
  assert.equal(rowsSayVerdict(['nowhere', 'leaking']), true)
  assert.equal(rowsSayVerdict(['kept', 'shared', 'withheld']), true)
  assert.equal(rowsSayVerdict([]), false, 'an empty list has nothing to say either way')
})

test('every file the office seeds is covered by WRITES', async () => {
  /*
   * The guard above this one scans the main process for `cp(join(root, CONST))` and could not see
   * the seed, because `workspace-root.ts` copies `.claude` whole in a loop whose target is a
   * variable rather than a constant. So the one call that installs six of these resolved to
   * nothing and was skipped, and the panel answering "what would a push carry" was answering
   * about 17 of the 28 files the office actually puts into a workspace.
   *
   * Missing were `.claude/hooks` — an executable every tool call in the workspace passes
   * through — `.claude/settings.json`, `CLAUDE.md`, `.gitignore`, `.claude/commands` and
   * `assets/themes`.
   *
   * ## It reads the declaration, not the build
   *
   * The first version of this read `dist/shipped-hashes.json` — the build's *output*. It passed
   * here and failed in CI, which runs tests without building, and it deserved to: a check that
   * depends on an artifact reports on whatever happens to be lying around, and the whole lesson
   * of this repository is that what is lying around *here* is everything.
   *
   * `seededFiles` is the build's own expansion of the declared list, imported rather than
   * reimplemented. That matters: the expansion is not just `git ls-files`, because
   * `package.json`'s `extraResources` excludes some tracked paths from the package. A first
   * version of this test skipped that step and reported `.claude/launch.json` — tracked, never
   * shipped — which would have sent somebody adding a privacy entry for a file no office
   * receives.
   */
  const seeded: string[] = seededFiles(process.cwd(), (args: readonly string[]) =>
    execFileSync('git', [...args], { encoding: 'utf8' }),
  )
  /*
   * The real count, not a floor that tolerates losing most of it.
   *
   * This was `> 10` against an expansion of 28 — inherited from the version that read
   * `dist/shipped-hashes.json` and never re-derived. Dropping `.claude/agents` and
   * `.claude/commands` from the seed removes all seven employees and all six slash commands and
   * leaves 15, and `15 > 10` passes while `uncovered` is trivially empty over the short list. The
   * guard would have reported "every file the office seeds is covered" for an office seeded with
   * no staff.
   *
   * Pinned to the actual number so a change to what is seeded has to be a deliberate edit here.
   */
  assert.equal(
    seeded.length,
    28,
    `the office seeds ${seeded.length} files, not 28 — if that is intended, change this number ` +
      'deliberately; it is what stops the coverage check below passing over a truncated list',
  )

  const uncovered = seeded.filter(
    (path) => !WRITES.some((w) => path === w.path || path.startsWith(`${w.path}/`)),
  )
  assert.deepEqual(
    uncovered,
    [],
    'the office seeds these into a workspace and WRITES does not cover them, so the panel that ' +
      'answers "what would a push carry" is answering about less than the office puts there.',
  )
})

test('build.mjs wrote the same list this declares', async () => {
  /*
   * The only assertion in the suite that compares the build's *output* to the declaration.
   *
   * Moving the check above off `dist/shipped-hashes.json` was right — a check whose input is an
   * artifact reports on whatever is lying around. But it left both halves reading the same
   * source, so nothing compared what `build.mjs` actually wrote to what `SHIPPED` says. A build
   * that expands, filters or writes the manifest differently — a changed `ls-files` argument, an
   * early return, a filter applied on one side only — would ship a manifest naming files the
   * bundle lacks, and every test would stay green.
   *
   * The manifest is the *subject* here rather than the input, which is the distinction that makes
   * this legitimate: above, `seededFiles` is the truth and the manifest is unread; here the
   * manifest is what is on trial.
   *
   * CI builds before it tests, so this runs there. Locally it is skipped when nobody has built —
   * and it says so rather than passing quietly, because a skipped check that reads as a passing
   * one is the failure this whole file is about.
   */
  const manifestPath = join(process.cwd(), 'dist', 'shipped-hashes.json')
  let raw: string
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    console.log('    # skipped: no dist/shipped-hashes.json — run `npm run build` to check this')
    return
  }

  const manifest = JSON.parse(raw) as Record<string, unknown>
  const written = Object.keys((manifest['files'] as object) ?? manifest)
    .filter((k) => k !== 'generatedAt')
    .sort()
  const declared = [
    ...seededFiles(process.cwd(), (args: readonly string[]) =>
      execFileSync('git', [...args], { encoding: 'utf8' }),
    ),
  ].sort()

  assert.deepEqual(
    written,
    declared,
    'the manifest build.mjs wrote and the list scripts/shipped.mjs declares have diverged, so an ' +
      'installed office is seeded with something other than what this repository says it seeds',
  )
})

test('a git that could not answer is never drawn as safe', async (t) => {
  /*
   * The panel's worst possible sentence is "nothing is being pushed at all" said about a real
   * repository. `verdictFor` maps `no-repo` to `nowhere` and documents it exactly that way, while
   * `unknown` carries "Never drawn as safe" — so which of the two `isRepository` returns decides
   * whether a person is told their memory and projects are private when nobody looked.
   *
   * `git rev-parse --git-dir` exits 128 for *both* "there is no repository here" and a family of
   * refusals to look: dubious ownership on a shared volume or in a container, an unreadable
   * `.git`, a broken config. Every one of those used to land on `no-repo`, because the code read
   * the exit rather than the message.
   *
   * An invalid gitfile is the reproducible member of that family — no chmod, no container, no
   * ownership games, and its message is not the one git uses for a genuine absence:
   *
   *     fatal: invalid gitfile format: <path>/.git
   */
  const root = await aWorkspace(t, SHIPPED_GITIGNORE)
  await writeFile(join(root, '.git'), 'this is not a gitfile\n', 'utf8')

  const rows = await whatWouldBeShared(root)
  assert.ok(rows.length > 0, 'no rows — this test is asserting over an empty list')

  assert.deepEqual(
    rows.filter((r) => r.verdict === 'nowhere').map((r) => r.path),
    [],
    'git refused to look and the panel called it "nowhere", which a person reads as "private"',
  )

  for (const row of rows) {
    assert.equal(row.verdict, 'unknown', `${row.path} should be unknown when git could not answer`)
    assert.ok(
      row.detail !== null && row.detail.length > 0,
      `${row.path} is unknown with no reason given — "we could not look" has to say why`,
    )
  }

  // The pair to the test above: both are one fact about the workspace, and the difference between
  // them is whether anybody looked.
  assert.doesNotMatch(sharingLede(rows.map((r) => r.verdict)), /stays yours/)
})
