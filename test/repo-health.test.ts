/**
 * The repo's claims about itself, checked.
 *
 * A separate concern from testing behaviour: these are the statements that rot silently. A
 * module with no importer, a documented file that does not exist, a script the docs tell people
 * to run that is not in package.json. Each is invisible until somebody follows the instruction
 * and it does not work.
 *
 * This repo has had the failure three times — `capabilities.ts` unreachable for days,
 * `docs/auth.md` claiming a check nobody had built, `CLAUDE.md` naming directories that were not
 * there. Every one was found by a person reading rather than by anything running.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
// @ts-expect-error — a plain .mjs declaration with no types.
import { seededFiles } from '../scripts/shipped.mjs'

const root = process.cwd()
const read = (p: string) => readFile(join(root, p), 'utf8')

/** Every `.ts` under a directory, recursively. */
async function sources(dir: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) await sources(rel, acc)
    else if (entry.name.endsWith('.ts')) acc.push(rel)
  }
  return acc
}

test('every module in src/ is imported by something', async () => {
  // The orphan check. `capabilities.ts` sat on dev for days — 475 tested lines with no caller,
  // invisible to every other test in the repo because tests import it directly and that counts
  // as a consumer to nothing but this.
  //
  // And it did not do that. The line below used to join `src` AND `test` before searching, so a
  // module imported only by its own test file counted as imported — which is the exact case the
  // comment above says this test exists for. The intent was written down correctly and the
  // implementation did the opposite, for as long as the test has existed.
  //
  // Found by the second session on the night of 2026-08-26, while checking whether a hardened
  // module had a caller. It did. This did not.
  //
  // `src` only. A module in the product that only its own test imports is dead weight in the
  // product, whatever the test suite thinks of it.
  /*
   * Resolved by path, not by basename.
   *
   * It used to ask whether the string `from '…/<basename>.js'` appeared anywhere in `src`. Eleven
   * basenames in this repository are used twice — `tasks`, `roster`, `privacy`, `settings`,
   * `switcher`, `activity`, `palette`, `registry`, `music`, `auth`, `first-run` — almost all of
   * them a `shared/` module and its `renderer/views/` counterpart. That is **22 of 110 modules
   * masking each other**: orphan `views/tasks.ts` and an import of `shared/tasks.ts` satisfies
   * the check on its behalf.
   *
   * Which is the second weakness found in this one test. Its own comment already records the
   * first — joining `src` and `test` before searching, so a module imported only by its own test
   * counted as imported, "for as long as the test has existed". A check that has been wrong twice
   * in two different ways is a check worth resolving properly rather than pattern-matching again.
   */
  const files = await sources('src')

  const imported = new Set<string>()
  for (const file of files) {
    const text = await read(file)
    const from = dirname(file)
    for (const m of text.matchAll(/from\s+'(\.[^']*)\.js'/g)) {
      // `./x` and `../y/x` are relative to the importing file. Normalised through `join` so
      // `renderer/views/../music` and `renderer/music` are the same module.
      imported.add(join(from, `${m[1]!}.ts`))
    }
  }
  assert.ok(imported.size > 60, `resolved only ${imported.size} imports — the pattern moved`)

  const orphans: string[] = []
  for (const file of files) {
    // Entry points are imported by the build, not by other modules.
    if (/^src\/(main\/main|preload\/preload|renderer\/(app|mock))\.ts$/.test(file)) continue
    if (file.endsWith('/cli/discover.ts') || file.includes('/cli/')) continue

    if (!imported.has(file)) orphans.push(file)
  }

  assert.deepEqual(orphans, [], 'these modules are imported by nothing and ship as dead weight')
})

test('every script the docs tell people to run exists', async () => {
  // "Run `npm run dist`" is an instruction, and an instruction that fails is worse than none —
  // it is the first thing somebody tries.
  const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> }

  // The same set the path check below reads, not just `docs/`. The two were asymmetric: a path
  // named in README.md was checked and a *script* named in README.md was not, which is the wrong
  // way round — the README is the first prose anybody reads and its first instruction is a
  // command.
  const prose = (
    await Promise.all(
      ['CLAUDE.md', 'README.md', ...(await readdir(join(root, 'docs'))).map((f) => `docs/${f}`)].map(read),
    )
  ).join('\n')

  // Backticked and fenced. A fenced block is the form somebody copies, so leaving it out checked
  // the mention and not the instruction.
  const named = new Set([
    ...[...prose.matchAll(/`npm run ([a-z-]+)`/g)].map((m) => m[1]!),
    ...[...prose.matchAll(/^\s*npm run ([a-z-]+)/gm)].map((m) => m[1]!),
  ])
  assert.ok(named.size > 3, `found only ${named.size} npm-run mentions — the prose or the pattern moved`)

  const absent = [...named].filter((script) => !pkg.scripts[script])
  assert.deepEqual(absent, [], 'the prose says to run these and package.json has no such script')
})

test('every repo file the docs point at is there', async () => {
  // CLAUDE.md once named three directories that did not exist. A path in prose is a claim.
  // Kept as pairs, because a relative link has to be resolved against the file that holds it.
  const names = ['CLAUDE.md', 'README.md', ...(await readdir(join(root, 'docs'))).map((f) => `docs/${f}`)]
  const docFiles: [string, string][] = await Promise.all(
    names.map(async (name) => [name, await read(name)] as [string, string]),
  )
  const docs = docFiles.map(([, text]) => text).join('\n')

  const claimed = new Set(
    [...docs.matchAll(/`((?:src|test|docs|scripts|\.claude|\.github)\/[A-Za-z0-9_./-]+)`/g)].map((m) => m[1]!),
  )

  // Markdown links too, and they were the half nobody was checking.
  //
  // The pattern above only sees a path in backticks. The README's entire documentation table is
  // written as links — `[docs/running.md](docs/running.md)`, `[VISION.md](VISION.md)` — so the
  // thirteen most prominent paths in the repository, the ones a stranger clicks first, were
  // outside the guard that exists to keep paths honest.
  //
  // Relative to the file that holds the link, not to the root: `docs/release.md` pointing at
  // `release-checklist.md` means the one beside it.
  const links: { from: string; to: string }[] = []
  for (const [file, text] of docFiles) {
    for (const m of text.matchAll(/\[[^\]]+\]\(([^)#][^)]*)\)/g)) {
      const target = m[1]!
      if (/^https?:/.test(target) || /[*<>]/.test(target)) continue
      links.push({ from: file, to: target })
    }
  }
  assert.ok(links.length > 8, `found only ${links.length} markdown links — the prose or the pattern moved`)

  for (const { from, to } of links) {
    const where = join(root, dirname(from), to)
    await assert.doesNotReject(stat(where), `${from} links to ${to} and it is not there`)
  }

  // A path with a glob or a placeholder is describing a shape, not naming a file.
  const real = [...claimed].filter((path) => !/[*<>]/.test(path))

  // A path git is told to ignore is not a repo file either, and whether it is on disk is a fact
  // about the checkout rather than about the commit.
  //
  // `.claude/worktrees` is the one that showed it. Nothing under it is tracked, it is excluded
  // through `.git/info/exclude` — `docs/the-sweep.md` says so in the same breath as naming it —
  // and the agent tooling creates it at runtime. It is present in the main checkout only because
  // somebody has run parallel work there, so this test answered differently for the same commit
  // depending on which checkout ran it: green here, red in a fresh clone and red in every git
  // worktree, which is where most of this repository's parallel work happens. A repo-health test
  // that reads the environment instead of the commit is the same defect the scanners had.
  //
  // Asked of git rather than guessed, the way `persistence.test.ts` asks it, so this follows
  // `.git/info/exclude` and every `.gitignore` instead of a second list to keep in sync.
  //
  // Narrower than skipping whatever is absent, which would have gutted the check. Git never
  // calls a tracked file ignored, so all 26 real paths are still asserted; a documented path
  // that is neither tracked nor ignored is still a broken claim and still fails; and a typo
  // inside an ignored directory — `.claude/wrktrees` — matches no exclude rule, so it fails too.
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const { stdout } = await run('git', ['check-ignore', '--', ...real], { cwd: root }).catch(() => ({
    stdout: '',
  }))
  const ignored = new Set(stdout.split('\n').filter(Boolean))

  // The guard on the skip. If that call ever answered for everything — run outside a work tree,
  // or handed a pathspec it read as a match-all — every assertion below would be skipped and this
  // test would pass having checked nothing, which is the failure this file exists to refuse. The
  // other direction is already safe: if the call fails outright the set is empty and everything
  // is asserted, so that mistake lands loudly.
  assert.ok(
    ignored.size < real.length / 2,
    `git called ${ignored.size} of ${real.length} documented paths ignored — that is the tool answering wrong, not the docs`,
  )

  for (const path of real) {
    if (ignored.has(path)) continue
    await assert.doesNotReject(stat(join(root, path)), `the docs name ${path} and it is not there`)
  }
})

test('the release checklist covers each thing the app promises not to lie about', async () => {
  // The checklist is the last line of defence and the easiest document to let drift. These are
  // the four failures the office is built to avoid; if one is not on the list, nobody checks it.
  const checklist = await read('docs/release-checklist.md')
  for (const promise of [/could not be read/, /ANTHROPIC_API_KEY/, /streams/, /stopped/]) {
    assert.match(checklist, promise, 'the release checklist has drifted from what the app claims')
  }
})

test('the lock file and package.json agree, so `npm ci` can install', async () => {
  // CI was red for an hour and the reason was this, one step before anything interesting ran.
  //
  // F19 added `electron-builder` to `package.json` and never regenerated the lock file. `npm ci`
  // — unlike `npm install` — refuses to proceed when the two disagree, so every run since died
  // at the first step with `EUSAGE`. Nothing downstream executed: not the typecheck, not the 732
  // tests, not the build. A red tick that means "the dependency list is out of sync" and a red
  // tick that means "your change is broken" look identical from the outside, which is the part
  // that makes this worth a test rather than a memory.
  //
  // Checked here rather than by running `npm ci` in the suite, because that would take minutes
  // and reach the network. The condition `npm ci` actually enforces is that every dependency
  // declared in `package.json` appears in the lock file's root entry, which is arithmetic.
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')) as {
    packages?: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>
  }

  const rootEntry = lock.packages?.['']
  assert.ok(rootEntry, 'package-lock.json has no root entry — it is not a v2/v3 lock file')

  for (const [kind, declared] of [
    ['dependencies', pkg.dependencies ?? {}],
    ['devDependencies', pkg.devDependencies ?? {}],
  ] as const) {
    const locked: Record<string, string> = rootEntry[kind] ?? {}
    for (const [name, range] of Object.entries(declared)) {
      assert.equal(
        locked[name],
        range,
        `${name} is ${kind === 'dependencies' ? 'a dependency' : 'a devDependency'} at ${range} in package.json but ${
          locked[name] ? `${locked[name]} in` : 'missing from'
        } package-lock.json — run \`npm install\` and commit the lock file, or CI dies at \`npm ci\``,
      )
      // And the package itself has to be resolvable, not just named in the root entry.
      assert.ok(
        lock.packages?.[`node_modules/${name}`],
        `${name} is in the lock file's root entry but has no node_modules/${name} entry to install from`,
      )
    }
  }
})

/*
 * Nothing in the shipped app is anybody else's.
 *
 * `dependencies` is empty and `devDependencies` are build and test only, so the packaged
 * application contains no third-party code at all — no vendored directories, no copyright line
 * anywhere in `src/`, and no committed art. That is an architectural fact (the floor, the
 * characters and the props are drawn in code) and it is also the reason this repository has no
 * licence obligations to anyone.
 *
 * VISION.md §8 warns that munder-difflin's code is *"MIT (reusable with attribution)"*. Checked:
 * none of it is here. The warning is conditional on a reuse that did not happen, and adding a
 * runtime dependency is how that would quietly stop being true — a licence to honour, arriving in
 * a diff nobody reads as a licence change.
 *
 * The allowlist is empty on purpose. Adding one is allowed; adding one silently is not.
 */
const RUNTIME_DEPENDENCIES_WE_ACCEPT: Record<string, string> = {}

test('the app ships with no third-party runtime code', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const unexpected = Object.keys(pkg.dependencies ?? {}).filter(
    (name) => !(name in RUNTIME_DEPENDENCIES_WE_ACCEPT),
  )
  assert.deepEqual(
    unexpected,
    [],
    'these are runtime dependencies, so they are inside the packaged app. This repository ' +
      'currently contains no third-party code, no vendored source and no committed art, which is ' +
      'what makes its licensing a question about this project alone. Adding one is a real choice ' +
      'with a licence attached — name it in RUNTIME_DEPENDENCIES_WE_ACCEPT with the reason.',
  )
})

/*
 * The licence, now that there is one, held across the three places that state it.
 *
 * MIT was chosen on 2026-08-31. `docs/the-licence-question.md` records the audit that made the
 * choice a free one; what that document cannot do is stay true by itself. A licence is not one
 * fact in one file. It is `LICENSE` at the root — the terms a person reads before cloning — the
 * `license` field in `package.json`, which is the only form npm, GitHub and every dependency
 * scanner ever look at, and `build.copyright`, the notice electron-builder compiles into the
 * shipped bundle as NSHumanReadableCopyright. Three statements of one fact, each editable alone.
 *
 * The direction that fails silently is the expensive one. Move `LICENSE` in a tidy-up and this is
 * an unlicensed repository again — VISION.md §7 offers it as *"a GitHub repository anyone can
 * clone as **their** Claude workspace"* and legally nobody may — while `package.json` goes on
 * advertising MIT to every tool and the packaged app goes on carrying a copyright notice for terms
 * stated nowhere. Nothing else in the suite would notice: a licence is not code, so no import
 * breaks, no behaviour changes, and the run stays green.
 *
 * Which is the same shape as everything else in this file. The licence went unstated on every
 * branch until a person went looking and wrote it up under *"Outstanding, and not ours to close"*
 * in `docs/the-sweep.md`. Having been nobody's job once is the whole argument for it not being
 * nobody's job twice.
 *
 * Identified by what the file *says*, not by what it is named. A file called `LICENSE` holding a
 * different licence is precisely the mismatch worth catching, so the declared SPDX id has to be
 * found in the text rather than assumed from the filename.
 *
 * `private: true` stays, and is not in tension with any of this. It instructs npm not to publish
 * the package; the licence states the terms the published-or-cloned thing may be used under. They
 * answer different questions and both answers are wanted — dropping `private` to "match" the new
 * licence would only make an accidental `npm publish` possible.
 */
const LICENCE_TEXT_SAYS: Record<string, RegExp> = {
  // The title line of the canonical text. One entry, because one licence is declared; the
  // assertion below refuses an id it has no signature for rather than passing on trust, so
  // changing licence means adding the new one here deliberately.
  'MIT': /^MIT License$/m,
}

test('the licence is stated in all three places, and all three agree', async () => {
  await assert.doesNotReject(
    stat(join(root, 'LICENSE')),
    'there is no LICENSE at the root. Nobody who clones this repository has permission to use it ' +
      'without one, whatever package.json advertises — and package.json is read by tools, not people.',
  )
  const text = await read('LICENSE')
  const pkg = JSON.parse(await read('package.json')) as {
    license?: string
    build?: { copyright?: string }
  }

  assert.ok(
    pkg.license,
    'LICENSE is at the root but package.json has no `license` field, so the terms are invisible to ' +
      'npm, to GitHub’s licence banner and to every dependency scanner — each of which reads ' +
      'the field and never the file.',
  )

  const saysSo = LICENCE_TEXT_SAYS[pkg.license]
  assert.ok(
    saysSo,
    `package.json declares "${pkg.license}" and this check has no signature for it. Add the title ` +
      'line of its canonical text to LICENCE_TEXT_SAYS, so the field and the file go on being held ' +
      'against each other instead of both being taken on trust.',
  )
  assert.match(
    text,
    saysSo,
    `package.json declares "${pkg.license}" and the LICENSE file is not that licence. One of the ` +
      'two was changed alone; every tool believes the field and every person believes the file.',
  )

  // The copyright line is not decoration. MIT grants rights *from* a named holder and requires
  // this notice to travel with every copy, so a LICENSE still carrying the template's
  // `<copyright holders>` or `[fullname]` grants nothing anyone can rely on.
  const holder = /^Copyright \(c\) (\d{4}) (\S.*)$/m.exec(text)
  assert.ok(
    holder,
    'LICENSE has no `Copyright (c) <year> <holder>` line naming somebody. MIT grants rights from a ' +
      'named holder, so an unnamed one grants nothing.',
  )
  assert.doesNotMatch(holder[2]!, /^[<[]/, 'the copyright holder in LICENSE is still the placeholder')

  // And the same notice where it ships. This is the only copy of it that reaches somebody who
  // installs the app and never sees the repository.
  assert.equal(
    pkg.build?.copyright,
    `Copyright (c) ${holder[1]!} ${holder[2]!}`,
    'the copyright notice compiled into the packaged app is not the one in LICENSE — and the app ' +
      'is what a stranger receives, so this is the copy that is wrong in front of the most people.',
  )
})

test('every method the renderer is promised is actually bridged in preload', async () => {
  // `OfficeApi` is a promise made to the renderer, and `preload.ts` is the only thing that keeps
  // it. A method declared here and not bridged there is not a type error — the renderer holds an
  // `OfficeApi` by assertion across the context bridge — it is `undefined is not a function` the
  // first time a user clicks the thing.
  //
  // Same shape as the approval gate: declared on one side, unwired on the other, green suite.
  const ipc = await read('src/shared/ipc.ts')
  const preload = await read('src/preload/preload.ts')

  const body = /export interface OfficeApi \{\n([\s\S]*?)\n\}/.exec(ipc)?.[1]
  assert.ok(body, 'OfficeApi is not where this test expects it')

  // Declarations only: `name(` or `name:` at one level of indentation, skipping comment bodies.
  const declared = new Set<string>()
  for (const line of body.split('\n')) {
    const m = /^ {2}(?:readonly )?([a-zA-Z][a-zA-Z0-9]*)\s*[(:]/.exec(line)
    if (m) declared.add(m[1]!)
  }
  assert.ok(declared.size > 20, `parsed only ${declared.size} methods — the interface shape moved`)

  const missing = [...declared].filter((name) => !new RegExp(`^\\s*${name}:`, 'm').test(preload))
  assert.deepEqual(missing, [], 'these are promised on OfficeApi and never bridged in preload.ts')

  // And the other way, for the same reason the channel guard above now asks both sides.
  //
  // A bridge for a method `OfficeApi` does not declare is not a crash — it is dead weight the
  // renderer's types cannot see, so nothing will ever tell you it stopped being needed. Less
  // dangerous than the direction above and exactly as invisible, which is the whole argument for
  // checking it: 61 and 61 today is an answer, and "we never asked" is not.
  const bridged = new Set([...preload.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]!))
  const unpromised = [...bridged].filter((name) => !declared.has(name))

  assert.deepEqual(unpromised, [], 'these are bridged in preload.ts and on no interface the renderer holds')
})

test('every channel is used on both sides, so none is a dead letter', async () => {
  // A channel nobody listens on is a call that hangs; a channel nobody sends on is a subscription
  // that never fires. Both are silent, and both look exactly like a feature that is merely slow.
  //
  // This also feeds C6: a channel used in exactly one file is a handler with no caller, or a
  // caller with no handler, and either way it is dead weight to be deleted rather than kept.
  const ipc = await read('src/shared/ipc.ts')
  const table = /export const CHANNEL = \{\n([\s\S]*?)\n\} as const/.exec(ipc)?.[1]
  assert.ok(table, 'the CHANNEL table is not where this test expects it')

  const keys = [...table.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]!)
  assert.ok(keys.length > 30, `parsed only ${keys.length} channels — the table shape moved`)

  // BOTH sides, separately.
  //
  // This test has been called "used on both sides" since it was written and did not check that:
  // it joined every non-`ipc.ts` source into one string and asked whether the channel appeared in
  // it. A channel named only in `preload.ts` — bridged to the renderer, handled by nobody —
  // passed. So did one handled in main and reachable from nothing.
  //
  // The fifth guard in this repository found enforcing something weaker than its own name. The
  // other four: the IPC reader guard that enumerated an interface's top level only, the
  // target-size guard that asked about height and never width, the control list that guarded the
  // controls on the list, and the orphan check that counted a module's own test as its consumer.
  // All five read as coverage.
  const files = (await sources('src')).filter((f) => !f.endsWith('ipc.ts'))
  const texts = new Map(await Promise.all(files.map(async (f) => [f, await read(f)] as const)))

  const inAny = (predicate: (file: string) => boolean, key: string): boolean =>
    [...texts].some(([file, text]) => predicate(file) && new RegExp(`CHANNEL\\.${key}\\b`).test(text))

  // Main answers or sends; preload and the renderer ask or listen. `preload.ts` counts as the
  // renderer's side because it is the only thing allowed to name a channel there.
  const isMain = (f: string) => f.includes('/main/')
  const isFront = (f: string) => f.includes('/renderer/') || f.includes('/preload/')

  const oneSided = keys
    .map((k) => ({ k, main: inAny(isMain, k), front: inAny(isFront, k) }))
    .filter(({ main, front }) => !main || !front)
    .map(({ k, main, front }) =>
      !main && !front ? `${k} (neither side)` : !main ? `${k} (front only — nobody handles it)` : `${k} (main only — nobody calls it)`,
    )

  assert.deepEqual(
    oneSided,
    [],
    'a channel nobody listens on is a call that hangs; a channel nobody sends on is a subscription that never fires',
  )
})

test('every hook in .claude/hooks/ is registered, so it can actually run', async () => {
  // The fourth instance of this repo's most expensive failure, and the most serious.
  //
  // `.claude/hooks/approval-gate.mjs` is careful, complete work: it holds a tool call open while
  // a person decides, and every one of its failure paths denies. `src/main/approvals.ts` is 133
  // lines that watch for its requests and write back the verdict. There is a panel for it.
  //
  // Nothing tells the CLI the hook exists. `.claude/settings.json` ships `"hooks": {}`, nothing
  // in `run.ts` or `session.ts` passes a hook argument, and a `PreToolUse` hook that is not
  // registered is not a gate — it is a file. So no request is ever written and `approvals.ts`
  // watches an empty directory forever, with a green suite the whole time.
  //
  // What makes it worse than the `capabilities.ts` orphan is that `CLAUDE.md` tells every agent
  // in this workspace that `.claude/hooks/` "can refuse a tool call, and hold one while you
  // decide". A documented capability that cannot fire is not a gap, it is the third standing
  // order broken in the repo's own front matter.
  //
  // A hook file is a claim that something is gated. This is the check that the claim is wired.
  const dir = '.claude/hooks'
  const hooks = (await readdir(join(root, dir))).filter((f) => /\.(mjs|js|cjs|sh)$/.test(f))

  // Settings may be split across the committed file and a local override; either can register.
  const configs: string[] = []
  for (const file of ['.claude/settings.json', '.claude/settings.local.json']) {
    try {
      configs.push(await read(file))
    } catch {
      // Absent is not empty — but a settings file nobody wrote is genuinely no registration.
    }
  }
  const registered = configs.join('\n')

  for (const hook of hooks) {
    assert.ok(
      registered.includes(hook),
      `.claude/hooks/${hook} is never named in any settings file, so the CLI never runs it — ` +
        `it is a gate that cannot refuse anything. Register it under "hooks", or delete it and ` +
        `the code that waits on it.`,
    )
  }
})

test('the counts CLAUDE.md gives for .claude/ are the counts on disk', async () => {
  // "Two ship; add your own" is a claim, and it was wrong: three skills ship. A number in prose
  // is the kind of fact that is true when written and silently false a week later, and this one
  // is read by every agent in the workspace on its first turn.
  const words: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  }
  const claude = await read('CLAUDE.md')

  const counted: Record<string, number> = {
    'agents': (await readdir(join(root, '.claude/agents'))).filter((f) => f.endsWith('.md')).length,
    'skills': (await readdir(join(root, '.claude/skills'), { withFileTypes: true })).filter((e) => e.isDirectory()).length,
    'commands': (await readdir(join(root, '.claude/commands'))).filter((f) => f.endsWith('.md')).length,
  }

  // Each Layout row is `| \`.claude/<dir>/\` | …<Number> ship… |`.
  for (const [, dir, word] of claude.matchAll(
    /`\.claude\/([a-z]+)\/`[^|]*\|[^|]*?\b([A-Za-z]+) ship/g,
  )) {
    const expected = counted[dir!]
    if (expected === undefined) continue
    const claimed = words[word!.toLowerCase()]
    assert.equal(
      claimed,
      expected,
      `CLAUDE.md says ${word} ship in .claude/${dir}/ and there are ${expected}`,
    )
  }
})

/**
 * A symlinked `node_modules` must be ignored, not just a real one.
 *
 * `node_modules/` with a trailing slash matches a directory and does **not** match a symlink of
 * that name — git stages it, and what goes in is an absolute path meaningful on exactly one
 * machine.
 *
 * That was live here, and this script created the hazard itself: `scripts/preflight.mjs` tells an
 * agent in a worktree to symlink the parent checkout's modules, because a fresh install per
 * worktree costs minutes and a network. Follow that advice, run `git add -A`, and the symlink is
 * staged. Found on the night five agents each independently made that symlink, by the one session
 * that read `git status` after staging instead of assuming.
 */
test('a node_modules symlink is ignored, not only a node_modules directory', async () => {
  const patterns = (await read('.gitignore'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))

  assert.ok(
    patterns.includes('node_modules'),
    'the pattern needs to be `node_modules` with no trailing slash: a trailing slash matches a ' +
      'directory only, and preflight tells people to create a symlink of exactly that name',
  )
  assert.ok(
    !patterns.includes('node_modules/'),
    'the trailing-slash form is what let a symlink through; keeping both invites it back',
  )
})

test('a test that stops has a deadline, so the suite fails rather than hangs', async () => {
  /*
   * `node:test` has **no per-test timeout by default**, so a wedged test waits forever and takes
   * the suite with it. Measured on this repo: `approvals.test.ts` alive 29 minutes inside a full
   * run, against 45 tests passing in 3.95s when run alone — under the contention of several agents
   * testing on one machine, which is this project's normal operating state rather than an edge.
   *
   * The reason it is worth a guard rather than a habit is what a hang looks like from outside.
   * `checks.yml` caps the job at `timeout-minutes: 10`, and GitHub reports that kill as
   * **`cancelled`** — the same string a superseded run gets. So a suite that *stops* does not look
   * like a suite that *failed*; it looks like a run somebody replaced. Measured over 58 jobs:
   * nine sat at 10.15–10.28 minutes, cap plus shutdown grace, wearing a supersede's name.
   *
   * A deadline converts that into a red test with a name on it. Any finite number does, which is
   * why this one is generous rather than tight.
   *
   * **Sized on a loaded machine, because a quiet one gives the wrong answer.** The first version
   * of this paragraph said the slowest test takes "about 8 seconds" and called sixty roughly
   * seven times it — both true of an idle machine and neither true of the condition this flag
   * exists for. Measured by Auditor across the same tests in both conditions, the second during a
   * real multi-agent run on this machine:
   *
   *     every field on the renderer-facing IPC contract has a reader   8.4s → 35.7s   4.25x
   *     every exported type under src/ is referenced by something      6.0s → 21.3s   3.55x
   *     a break is earned again after one has been taken               4.3s → 17.2s   4.0x
   *     suite total                                                   32.7s → 107.9s  3.3x
   *
   * So the real headroom is **1.68x, not seven** — and 107.9s was not the worst run of that night.
   * Sixty holds, and it is much closer to the line than it looks. That matters because "about 8
   * seconds" is the figure somebody quotes when deciding whether the deadline can be tightened,
   * and it points the wrong way by a factor of four: this paragraph's own argument is that too
   * tight causes false failures on loaded machines, and its supporting number was taken on an
   * idle one.
   *
   * ## The trap this creates for us rather than for CI
   *
   * **A timed-out test reports `# fail 0`.** Measured:
   *
   *     not ok 1 - test/zz-probe.test.ts
   *       failureType: 'testTimeoutFailure'
   *     # pass 0
   *     # fail 0        exit code 1
   *
   * The exit code is right, so `checks.yml` is correct and CI cannot be fooled. A **mutation
   * harness** can: every one run against this repo has scored by grepping `^# (pass|fail)`, which
   * reads a timeout as zero failures and records the mutation as SURVIVED. That is where this
   * whole line of work started — a mutation scored `pass=2445 fail=1 => CAUGHT` from counts, on
   * an unrelated red test.
   *
   * So this flag makes a wedge more likely to be *seen* and no more likely to be *counted*. Score
   * on the exit code, not the summary lines.
   */
  const pkg = JSON.parse(await read('package.json')) as { scripts?: Record<string, string> }
  const runners = Object.entries(pkg.scripts ?? {}).filter(([, cmd]) => / --test\b/.test(cmd))

  // The control. A renamed script or a changed runner makes every assertion below vacuous, which
  // is the failure mode of every check that iterates something it also has to find.
  assert.ok(runners.length >= 2, `only ${runners.length} scripts run node:test — the check cannot see what it guards`)

  for (const [name, cmd] of runners) {
    const set = /--test-timeout=(\d+)/.exec(cmd)
    assert.ok(set, `\`npm run ${name}\` runs node:test with no --test-timeout, so a wedged test hangs the suite instead of failing it`)
    /*
     * The floor is **derived from the contended figure above**, not chosen beside it.
     *
     * It was 20,000, picked when this docblock said the slowest test took "about 8 seconds". That
     * sentence was corrected to 35.7s under contention and the constant it was supporting was
     * not — so the guard would have accepted `--test-timeout=25000`, ten seconds under a number
     * measured two paragraphs up, without firing.
     *
     * A correction that stops at the prose and leaves the derived value behind is the same shape
     * as a field with a producing half and no consuming half, which is the defect
     * `bridge-fields-are-read.test.ts` exists for — here, inside an edit fixing a different
     * instance of it.
     *
     * 40,000 clears 35.7s with room and sits well under the 60,000 actually set, so this is a
     * floor rather than a restatement of the setting.
     */
    assert.ok(
      Number(set[1]) >= 40_000,
      `\`npm run ${name}\` sets --test-timeout=${set[1]}ms, and the slowest legitimate test here takes 35.7s under the multi-agent contention this flag exists for — that turns contention into false failures`,
    )
  }
})

test('the approval gate is given longer to answer than it will ever take', async () => {
  // The gate's whole promise is that **an unanswered request is a denial, never an allowance**,
  // and every failure path in `approval-gate.mjs` routes to `deny()` to keep it. None of those
  // paths run if the CLI kills the process first: a hook killed at its timeout writes no
  // decision at all, which is the one outcome the file's header rules out — its own words, about
  // an exception, apply exactly as well to a kill: *"not a refusal, and the call may proceed."*
  //
  // So the registered `timeout` has to clear the longest wait the hook can perform. Until now
  // that was a number in `.claude/settings.json`, a different number in the hook, and a sentence
  // in a comment asserting they were in the right order. Nothing held it. Lowering the timeout,
  // or raising the wait, would have left the gate being killed mid-decision with a green suite —
  // which is how the hook came to be unregistered for weeks in the first place, recorded a few
  // lines above this one.

  const hook = await read('.claude/hooks/approval-gate.mjs')
  const ceiling = /const MAX_WAIT_MS = ([\d_]+)/.exec(hook)
  assert.ok(ceiling, 'approval-gate.mjs no longer declares MAX_WAIT_MS — this check cannot see what it guards')
  const maxWaitMs = Number(ceiling[1]!.replace(/_/g, ''))

  // The wait is clamped to the ceiling, so the environment cannot raise it past this.
  assert.match(
    hook,
    /Math\.min\([^)]*,\s*MAX_WAIT_MS\s*\)/,
    'OFFICE_APPROVAL_WAIT_MS must be capped at MAX_WAIT_MS, or the invariant can be broken from outside both files',
  )

  // And it has a floor, which is the half this check first missed. `|| 240_000` rejects `NaN`
  // because `NaN` is falsy — but `-5` is a perfectly good number, so `Math.min(-5, ceiling)` is
  // `-5`: a deadline already in the past, the wait loop skipped, and every request denied the
  // instant it arrives. The gate would look like it was working while never once holding a call
  // open for somebody to answer.
  assert.match(
    hook,
    /Number\.isFinite\(\s*asked\s*\)\s*&&\s*asked\s*>\s*0/,
    'the wait must reject a negative, a zero, a NaN and an Infinity — `|| default` only catches ' +
      'the falsy ones, and a negative deadline denies every request instantly while looking fine',
  )

  const settings = JSON.parse(await read('.claude/settings.json')) as {
    hooks?: Record<string, { hooks?: { command?: string; timeout?: number }[] }[]>
  }

  const registered = Object.values(settings.hooks ?? {})
    .flat()
    .flatMap((entry) => entry.hooks ?? [])
    .filter((h) => (h.command ?? '').includes('approval-gate.mjs'))

  assert.ok(registered.length > 0, 'the approval gate is not registered at all')

  for (const entry of registered) {
    // Seconds in the settings file, milliseconds in the hook. A missing timeout is not a pass:
    // the CLI's own default is 60s, well under the wait, so silence here is the failing case.
    assert.equal(typeof entry.timeout, 'number', 'the gate is registered with no timeout, so the CLI default of 60s applies — shorter than the wait')
    const timeoutMs = entry.timeout! * 1000
    assert.ok(
      timeoutMs > maxWaitMs,
      `the gate may wait ${maxWaitMs}ms but is killed after ${timeoutMs}ms — it would be killed mid-decision, and a killed hook writes no denial`,
    )
  }
})

test('model output reaches the screen as text, never as markup', async () => {
  // `shared/ipc.ts` states this as a property of the whole app, in the comment that explains why
  // the IPC surface is narrow:
  //
  //   "model output is written with `textContent`, never `innerHTML`. An agent that prints a
  //    `<script>` tag should render as the characters of a script tag."
  //
  // Three files repeat it locally — `markdown.ts`, `views/refusal.ts`, `views/activity.ts` — and
  // until now that was four comments and no check. This repository has spent the week finding
  // rules that were written down and held by nobody; a security rule is a poor one to leave in
  // that state.
  //
  // The CSP (`default-src 'self'`, no inline script) would make an injected `<script>` inert, and
  // that is the second line rather than the first. It does not make an injected `<img>`, `<a>` or
  // `<style>` inert, and a transcript that renders an agent's markup is no longer a record of
  // what the agent said.
  //
  // Comments are blanked **in place**, preserving newlines, so the line numbers below point at
  // the right lines — the catch sweep earlier this week did not, and reported twelve locations
  // that pointed at unrelated code.
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')

  const SINKS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
    { pattern: /\.innerHTML\s*(?:=|\+=)/g, why: 'assigns innerHTML' },
    { pattern: /\.outerHTML\s*(?:=|\+=)/g, why: 'assigns outerHTML' },
    { pattern: /\.insertAdjacentHTML\s*\(/g, why: 'calls insertAdjacentHTML' },
    { pattern: /document\.write\s*\(/g, why: 'calls document.write' },
    { pattern: /createContextualFragment\s*\(/g, why: 'calls createContextualFragment' },
    // The same family one step further out: a string that becomes code.
    { pattern: /(?<![\w.])eval\s*\(/g, why: 'calls eval' },
    { pattern: /new\s+Function\s*\(/g, why: 'constructs a Function from a string' },
  ]

  // `src` only, and deliberately: `sources()` walks TypeScript, and the rule is about the code
  // that renders. `scripts/` is build tooling that never touches a DOM, and listing it here would
  // have looked like coverage while matching nothing — `sources()` returns no `.mjs` at all.
  const offenders: string[] = []
  {
    for (const file of await sources('src')) {
      const raw = await read(file)
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<!:)\/\/[^\n]*/g, blank)
      for (const { pattern, why } of SINKS) {
        for (const match of code.matchAll(pattern)) {
          offenders.push(`${file}:${code.slice(0, match.index).split('\n').length} ${why}`)
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'this app renders model output and tool results — untrusted text — inside a desktop ' +
      'application that can start processes with your credentials. Build nodes with ' +
      '`createElement` and `textContent`; an agent that prints a `<script>` tag must render as ' +
      `the characters of a script tag.\n  ${offenders.join('\n  ')}`,
  )
})
test('an untrusted description is rendered in a block, so a bidi override cannot escape it', async () => {
  /*
   * The sibling above stops untrusted text becoming *markup*. This stops it rewriting the text
   * around it, which needs no markup at all.
   *
   * A hired employee's description is a colleague's prose, copied out of their repository by
   * `hireFrom` and drawn in the roster verbatim. `U+202E RIGHT-TO-LEFT OVERRIDE` has no closing
   * character: everything after it renders reversed until something resets the bidi algorithm.
   * The only thing that resets it is a block boundary — UAX #9 runs per paragraph, and every
   * block container starts a new one.
   *
   * So the containment is real and it is spec-level, but it rests entirely on the description
   * being its own block. Rendered as a `<span>` beside the name and the buttons — the obvious
   * shape if somebody ever compacts the row to one line — the override would run straight out of
   * the description and reverse `Send home` and `Fire` next to it. The buttons would still be in
   * the right order in the DOM and the wrong order on screen, which is the third standing order
   * failing in the one way no assertion about the DOM would catch.
   *
   * Driven before this was written, against an agent whose description carried a bare `U+202E`:
   * both buttons still read left-to-right, and the override sat inside a `<p>` that the browser
   * had given `unicode-bidi: isolate`. That `isolate` is a side effect of the `-webkit-box`
   * line-clamp below it, not a decision anybody made — which is exactly why the load-bearing
   * half is asserted here instead of being left to a computed style nobody asked for.
   */
  const roster = await read('src/renderer/views/roster.ts')

  // Block containers only. `p` is what both sites use; the rest are the plausible rewrites.
  const BLOCKS = new Set(['p', 'div', 'li', 'section', 'article'])
  const sites = [...roster.matchAll(/el\(\s*'([a-z]+)'\s*,\s*'roster__desc'/g)].map((m) => m[1] ?? '')

  assert.ok(
    sites.length >= 2,
    'no `roster__desc` element is created in roster.ts — this check is blind and the rule above ' +
      'it is unheld. If the class was renamed, rename it here too.',
  )
  assert.deepEqual(
    sites.filter((tag) => !BLOCKS.has(tag)),
    [],
    'a description is drawn in an inline element. It carries a colleague\'s prose across a trust ' +
      'boundary, and an unterminated bidi override in it reverses every sibling in the same ' +
      'block — including the Send home and Fire buttons.',
  )

  /*
   * The other way to break it, from the stylesheet rather than the markup: a block element told
   * to lay out inline stops being a bidi paragraph, and the tag above becomes decorative.
   */
  const css = await read('src/renderer/panels.css')
  const rule = /\.roster__desc\s*\{([^}]*)\}/.exec(css)
  assert.ok(rule, '`.roster__desc` has no rule in panels.css — this half of the check is blind')
  assert.doesNotMatch(
    rule[1] ?? '',
    /display:\s*(?:inline|inline-block|inline-flex|contents)\b/,
    'this makes the description lay out inline, so it is no longer its own bidi paragraph and an ' +
      'override in a colleague\'s prose reaches the row around it.',
  )
})

test('the packaged app does not carry the dev harness or the source maps', async () => {
  /*
   * `build.files` was `["dist/**\/*", "package.json"]`, and `scripts/build.mjs` writes
   * `dist/renderer/dev.html` beside `index.html`. So the shipped application contained the dev
   * harness — `dev.html`, `mock.js` and its map, about 83 kB — whose entire job is drawing a
   * staff of seven people who do not exist, in an application whose third standing order is that
   * nothing on screen may lie.
   *
   * It was never reachable: `will-navigate` is `preventDefault()`ed, `setWindowOpenHandler`
   * denies unconditionally and only `shell.openExternal`s an `https?:` URL — so a `file://` path
   * to the harness is refused before it reaches a browser — and the window only ever `loadFile`s
   * `index.html`. So this is weight and not a hole,
   * It was never reachable: `will-navigate` is `preventDefault()`ed, `setWindowOpenHandler` is
   * set, and the window only ever `loadFile`s `index.html`. So this is weight and not a hole,
   * and it is worth saying which — the fix is a build exclusion rather than a security patch.
   * The maps are another 217 kB, and this project publishes its source, so they were never
   * hiding anything either.
   *
   * ## What this checks, and what it cannot
   *
   * The declaration, not the artefact. Asserting what `electron-builder` actually put in the
   * asar would mean running a package build — minutes, and 286 MB — for a check that would then
   * be too slow to run. This reads the globs and asserts the exclusions are declared, which
   * catches the way this regresses: somebody rewrites `files` and drops them.
   *
   * The assumption that breaks first: `will-navigate` does **not** fire for subframes — that is
   * `will-frame-navigate`. There is no iframe in `index.html` and no `innerHTML` or
   * `insertAdjacentHTML` anywhere in `src/renderer/` (`markdown.ts` and `refusal.ts` both state
   * the `textContent`-only rule outright), so there is nothing to inject into today. The day a
   * frame or an HTML sink appears, unreachable stops being true and this stops being weight.
   */
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    build?: { files?: string[] }
  }
  const files = pkg.build?.files ?? []

  assert.ok(files.length > 0, 'package.json has no `build.files`, so electron-builder ships its own default')

  /*
   * The path is read out of the script that writes it, not typed here a second time.
   *
   * The first version of this asserted three hardcoded strings were present in `build.files`,
   * and `scripts/build.mjs` writes `dist/renderer/dev.html` as its own literal. Rename the
   * harness there and this test still passed while the package shipped it — a check comparing
   * one constant against another, which is the same fault as the two `costUsd` comments that
   * cited each other. Deriving it means the two cannot drift apart without this failing.
   */
  const buildScript = await readFile(join(root, 'scripts/build.mjs'), 'utf8')
  const written = [...buildScript.matchAll(/writeFile\(\s*join\(root,\s*'(dist\/[^']+)'/g)].map((m) => m[1]!)
  const harness = written.filter((path) => /dev|mock/.test(path))

  assert.ok(
    harness.length > 0,
    `no harness output found in scripts/build.mjs — it wrote ${written.join(', ') || 'nothing this could see'}, ` +
      'so this test is checking almost nothing and would pass over a package that ships one',
  )

  for (const path of harness) {
    assert.ok(
      files.includes(`!${path}`),
      `scripts/build.mjs writes ${path} and build.files does not exclude it — the packaged app ` +
        'carries it. The harness draws seven people who do not exist.',
    )
  }

  // `mock.js` is an esbuild entry rather than a `writeFile`, and the maps are a compiler option,
  // so neither is derivable the same way. Named, with the reason they are named.
  for (const excluded of ['!dist/renderer/dev.html', '!dist/renderer/mock.js', '!dist/**/*.map']) {
    assert.ok(
      files.includes(excluded),
      `build.files no longer excludes ${excluded.slice(1)} — the packaged app carries it again. ` +
        'The harness draws seven people who do not exist; the maps are weight.',
    )
  }
})

test('a count in a user-facing string is not followed by a hard-coded plural', async () => {
  /*
   * `${n} skills` reads "1 skills" when there is one skill, and that line sits on screen
   * permanently.
   *
   * This is a house rule the codebase already keeps almost everywhere — `switcher.ts` states it
   * once for conversations and says so in a comment, `chat-view.ts` and `record.ts` both branch
   * for steps, `first-run.ts` and `privacy-view.ts` for their own counts. A sweep found thirteen
   * interpolated counts and eleven were already handled, which is what made the two exceptions
   * worth a test rather than a shrug.
   *
   * ## What this cannot see
   *
   * Source, not rendering. It flags `${expr} nouns` where the expression is not obviously doing
   * the work, so a count formatted through a helper it does not recognise reads as a violation,
   * and a plural built some other way is invisible. The allowlist below is the honest cost of
   * that: each entry is a place a person checked once.
   */
  const { readdir } = await import('node:fs/promises')
  const NOUNS =
    /\$\{([^}]{1,60})\}\s+(agents|files|folders|projects|skills|tools|conversations|hosts|servers|commands|tasks|entries|characters|bytes|lines|items|messages|sessions|things|steps|rows)\b/g

  // Checked by hand, and each is either guarded upstream or not a count of the noun beside it.
  const settled = new Set([
    'src/main/children.ts',       // MAX_LIVE is a constant greater than one
    'src/main/claude-path.ts',    // only reached when the list is longer than six
    'src/main/cli/discover.ts',   // a column label in a dev CLI, not a count
    'src/main/voice/transcribe.ts', // a byte length in a failure message
    'src/renderer/views/privacy.ts', // a character count, never one
  ])

  const sources = async (dir: string): Promise<string[]> => {
    const out: string[] = []
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) out.push(...(await sources(path)))
      else if (entry.name.endsWith('.ts') && entry.name !== 'mock.ts') out.push(path)
    }
    return out
  }

  const offenders: string[] = []
  for (const file of await sources('src')) {
    if (settled.has(file)) continue
    const text = await readFile(join(root, file), 'utf8')
    const lines = text.split('\n')
    for (const [i, line] of lines.entries()) {
      const trimmed = line.trimStart()
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue
      // A window, not the line. The branch that does the work is often on a neighbouring line —
      // `n === 1` above, or a ternary whose two arms are wrapped — and checking only the
      // interpolation flagged all eight sites in this repo, including the five that were already
      // correct and the two this test was written for.
      // Asymmetric on purpose. The branch that does the work is usually just above — an `if`
      // guarding the block, or a `const` computing the plural — and the message it guards can be
      // several lines of template literal below it. Two lines back was not enough to see the
      // `delegators.length > 1` that makes `no-designated-manager` safe.
      const near = lines.slice(Math.max(0, i - 10), i + 3).join('\n')
      // `> 1` as well as `=== 1`. A count the code has already established is greater than one
      // cannot read "1 agents" — `no-designated-manager` in `workspace.ts` fires only when more
      // than one agent declares the delegation tool, and flagging it would have pushed a whole
      // file onto the allowlist and blinded this to the message beside it that *was* wrong.
      if (/===\s*1\b|length === 1|>\s*1\b|\? '1 |\? `1 |\? 'one |\? `one /.test(near)) continue
      for (const m of line.matchAll(NOUNS)) {
        offenders.push(`${file}:${i + 1}  ${m[0].trim()}`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'a count is followed by a fixed plural, so this reads "1 skills" at the boundary:\n  ' +
      offenders.join('\n  '),
  )
})

test('closing a conversation stops it, rather than only hiding its row', async () => {
  // A source-level check, and it says so. `main.ts` calls `app.whenReady()` at module scope, so
  // importing it outside Electron fails — which is why no test does, and why this asks the file
  // rather than the behaviour. The behaviour it stands in for was real: closing a conversation
  // mid-turn marked the registry and pushed the list, and left the child `claude` running. The
  // row went, the process did not, and the app said "Conversation closed."
  //
  // Both halves matter and both are checked. `interrupt()` stops the running turn and clears the
  // queue; `managers.delete` releases the entry, which is keyed by session and had nothing that
  // ever removed from it — every conversation ever opened stayed, each holding its last prompt
  // in full and a handle on a process that might still be alive.
  const main = await read('src/main/main.ts')

  const at = main.indexOf('CHANNEL.closeSession')
  assert.ok(at > 0, 'the closeSession handler has been renamed; this check needs rewriting')
  // To the end of that handler, which is the next `ipcMain.handle(` after it.
  const end = main.indexOf('ipcMain.handle(', at)
  const handler = main.slice(at, end > at ? end : at + 4000)

  assert.match(
    handler,
    /\.interrupt\(\)/,
    'closing a conversation does not interrupt it — the row goes and the `claude` process keeps ' +
      'spending, on a turn nobody can see any more',
  )
  assert.match(
    handler,
    /managers\.delete\(/,
    'closing a conversation does not release its manager — `managers` is keyed by session and ' +
      'nothing else removes from it, so every conversation ever opened is retained with its last ' +
      'prompt and a handle on its process',
  )
})

test('no compiled JavaScript is tracked outside dist/', () => {
  /*
   * A 3,173-line `app.js` — compiled `src/renderer/app.ts` — was committed to the repo root and
   * very nearly merged into `dev`. It survived because it is invisible to everything here:
   * `.gitignore` lists `dist/`, which cannot match a file at the root; "every module in src/ is
   * imported by something" walks `src/`; the packaging filter reads `dist/**`. It was swept in by
   * a `git add -A` after a build wrote it, and caught by a person reading a diff.
   *
   * Tracked files only, so an untracked build artefact lying about is not this test's business —
   * being committed is the fault.
   *
   * `scripts/` and `test/` hold genuine hand-written `.mjs`/`.js`; those are sources, not output.
   * What is refused is a `.js` sitting beside the TypeScript it was compiled from.
   */
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: root })
    .split('\0')
    .filter(Boolean)

  const compiled = tracked.filter((path) => {
    if (!path.endsWith('.js')) return false
    if (path.startsWith('dist/') || path.startsWith('scripts/') || path.startsWith('test/')) return false
    if (path.startsWith('.claude/')) return false
    // The tell: a sibling or `src/` twin with the same stem in TypeScript.
    const stem = path.replace(/\.js$/, '')
    return tracked.includes(`${stem}.ts`) || tracked.some((t) => t.endsWith(`/${stem}.ts`) || t === `src/${stem}.ts`)
  })

  assert.deepEqual(
    compiled,
    [],
    'these are compiled output tracked outside dist/, most likely swept in by `git add -A` after ' +
      'a build. A root-level one is matched by no .gitignore entry and walked by no other check.',
  )
})

test('nothing shipped names a path outside the workspace', () => {
  /*
   * `.claude/settings.json` ships — it is inside `SHIPPED`'s first entry and one of the 28
   * manifest files — and it acquired two `PreToolUse` hooks pointing at
   * `/Users/<somebody>/.local/bin/graphify`. Every installed office would have spawned a binary
   * from a stranger's home directory on every Bash, Grep, Read and Glob call, and the settings
   * file the app had just installed would name that stranger's home as part of the user's
   * workspace.
   *
   * It rode in on a commit about deleting an unrelated file, because `git add -A` does not
   * distinguish what a tool wrote from what a person meant. That is twice from one command.
   *
   * `is-the-gate-actually-there.test.ts` reads this same file and did not catch it: it asserts
   * `/approval-gate\.mjs/` matches, which stays true however many other hooks are added. A check
   * that asks "is mine present" cannot see what else arrived.
   *
   * Checked across every seeded file rather than just this one, because the fault is "a personal
   * absolute path reached a shipped file", not "a hook was added".
   */
  const seeded = seededFiles(root, (args: readonly string[]) =>
    execFileSync('git', [...args], { encoding: 'utf8', cwd: root }),
  )

  /*
   * The bundle, as well as the seed. Two different ways a path reaches a stranger's machine, and
   * the seeded list only covers one of them.
   *
   * `build.files` is `dist/**\/*`, so every `src/` file is compiled into `app.asar` and installed.
   * A comment in `src/main/projects.ts` naming a real home directory rode along inside the
   * application itself, and the seeded-file scan above could not see it — `src/` is not seeded,
   * it is *shipped*, which is the same fault reached by a different route.
   *
   * `git ls-files` rather than a directory walk, for the reason `SHIPPED` gives: what is tracked
   * is what a clone and a build get.
   */
  const bundled = execFileSync('git', ['ls-files', '-z', '--', 'src'], { encoding: 'utf8', cwd: root })
    .split('\0')
    .filter(Boolean)

  assert.ok(bundled.length > 50, `git listed ${bundled.length} files under src/ — this scan went blind`)

  const offenders: string[] = []
  for (const rel of [...seeded, ...bundled]) {
    /*
     * Binary is skipped; unreadable is not.
     *
     * This was one `catch { continue }` covering both, which is standing order 4 inside the test
     * that enforces a shipping invariant: a seeded file that will not open would have been
     * silently unchecked and reported as clean. Binary content is the real motivation, so it is
     * named — anything else is a failure to look and fails here.
     */
    const buf = readFileSync(join(root, rel))
    if (buf.includes(0)) continue
    const text = buf.toString('utf8')
    // `/Users/<name>` and `/home/<name>`, but not the generic placeholders docs legitimately use.
    for (const m of text.matchAll(/\/(?:Users|home)\/([A-Za-z0-9._-]+)/g)) {
      const who = m[1] ?? ''
      /*
       * Placeholders documentation legitimately uses. `somebody` earns its place: `.gitignore`
       * uses it in a comment describing this exact fault — "`git add -A`, commit a symlink to
       * /Users/somebody/..., caught by the second session checking `git status` after staging
       * rather than assuming". The file warns about the thing this test now enforces.
       */
      if (['someone', 'somebody', 'you', 'runner', 'user'].includes(who)) continue
      offenders.push(`${rel}: ${m[0]}`)
    }
  }

  assert.deepEqual(
    [...new Set(offenders)],
    [],
    'these ship to every installed office and name somebody’s home directory. A hook here is ' +
      'executed on the user’s machine; a path here is a stranger’s filesystem described as theirs.',
  )
})
