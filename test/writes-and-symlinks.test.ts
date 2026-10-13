/**
 * What the filesystem primitives actually do when a symlink is in the way — **measured here,
 * every run, rather than remembered.**
 *
 * Three fixes in a row turned on the answers to these questions: `.watching` was truncated
 * through a link on every tick, the shipped `_TEMPLATE` could carry one into a new project, and
 * the privacy panel measured a link by its target while the delete button removed the link. Each
 * fix rests on a claim about a primitive — *`rm` does not follow*, *`rename` replaces*, *`wx`
 * refuses* — and every one of those claims was measured rather than reasoned about, because
 * several are counterintuitive and two candidates turned out not to exist.
 *
 * A claim that was measured once and written into a comment is a claim that quietly stops being
 * true: a Node upgrade, a different platform, a filesystem without `O_EXCL` semantics. This file
 * re-measures on every run, so the comments elsewhere in the tree keep being true or this fails.
 *
 * ## What the measurements settled
 *
 * | primitive | with a symlink at the path | so |
 * |---|---|---|
 * | `rm` recursive | unlinks the link, target untouched | `forget`, `archiveProject` are safe |
 * | `rename` onto it | replaces the link | `disable`/`enable`, temp-then-rename are safe |
 * | `writeFile` `flag:'wx'` | refuses, even on a dangling link | `hire`, `addSkill` are safe |
 * | `writeFile` plain | **writes through** | the `.watching` bug |
 * | `stat` | reports the target | the privacy panel bug |
 * | `lstat` | reports the link | the fix |
 * | `mkdir` recursive | **walks through a linked component** | the open one, below |
 *
 * ## The one that is open
 *
 * `mkdir(dirname(path), { recursive: true })` walks through a symlinked intermediate, so a link
 * at *any* directory component of a fixed path redirects the write while the filename stays
 * innocent. **Fourteen** sites do this. They are not guarded, and that is a decision rather than
 * an oversight:
 *
 * - **Git cannot ship one.** A path is either a symlink blob or a tree, never both, so a
 *   directory holding tracked files is a real directory in every clone. `.claude/agents/`,
 *   `.claude/skills/`, `projects/_TEMPLATE/` all hold tracked files. The gitignored ones —
 *   `.office-space/`, `projects/*`, `memory/` — need the ignore file edited too.
 * - **Refusing would break a real workflow.** Linking a project directory in from elsewhere is a
 *   thing people do, and `rm`/`rename` are already safe on it. A guard here buys nothing against
 *   an attacker who could not get a link in anyway, and costs a workflow that works today.
 *
 * The reachability bound is the whole reason, and it is deliberately not the other one. An
 * earlier draft of this comment also cited the `if (link) return` argument from the heartbeat —
 * that refusing rather than repairing trades a rare loud failure for a common quiet one. **That
 * argument does not apply here, and the other session was right to say so.** Refusing to write
 * `.watching` is quiet: the file's whole job is to exist and be recent, so a skipped write leaves
 * a stale mtime and every hook concludes nobody is watching. A guarded `mkdir` that refuses is
 * the opposite — the approval is not written, the registry is not saved, and the caller surfaces
 * it. Loud. Citing it here would hand the next person a rule that reaches the wrong conclusion
 * with a citation attached, which is worse than having no reason written down at all.
 *
 * So the class is bounded rather than closed, and this file is where that is written down.
 *
 * ## Fourteen, not twelve
 *
 * Both sweeps that produced this file — mine and the other session's, independently — said
 * twelve. Both had grepped `mkdir(`, and three of the sites are `mkdirSync(`. Two independent
 * counts agreed because they shared a blind spot, which is the failure this repository keeps
 * finding in itself: `source-is-text.test.ts` records four greps agreeing a live module was dead.
 * The census below is a scanner rather than a remembered number for exactly that reason, and it
 * checks it can see something before reporting that it sees nothing.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, symlink, readFile, rm, rename, stat, lstat, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

import { tempDir } from './temp-dir.js'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A workspace with a file worth not destroying, and a link pointing at it. */
async function withVictim(t: TestContext): Promise<{ box: string; victim: string; link: string }> {
  const box = await tempDir(t, 'links-')
  const victim = join(box, 'VICTIM.txt')
  await writeFile(victim, 'the target contents\n')
  const link = join(box, 'pointer')
  await symlink(victim, link)
  return { box, victim, link }
}

test('rm recursive unlinks the link and leaves the target whole', async (t) => {
  // The worst case, and it is not one. Both directions: the link handed to `rm`, and a link
  // sitting inside a directory handed to `rm`.
  const { box, victim, link } = await withVictim(t)
  await rm(link, { recursive: true, force: true })
  assert.equal(await readFile(victim, 'utf8'), 'the target contents\n', 'rm followed the link')

  const doomed = join(box, 'doomed')
  await mkdir(doomed)
  await symlink(victim, join(doomed, 'inner'))
  await rm(doomed, { recursive: true, force: true })
  assert.equal(await readFile(victim, 'utf8'), 'the target contents\n', 'rm followed a link it walked onto')
})

test('rename replaces a link rather than writing through it', async (t) => {
  const { box, victim, link } = await withVictim(t)
  const source = join(box, 'source.txt')
  await writeFile(source, 'the new contents\n')

  await rename(source, link)

  assert.equal(await readFile(victim, 'utf8'), 'the target contents\n', 'rename wrote through the link')
  assert.equal((await lstat(link)).isSymbolicLink(), false, 'the link survived the rename')
  assert.equal(await readFile(link, 'utf8'), 'the new contents\n')
})

test("writeFile with flag 'wx' refuses an existing link, including a dangling one", async (t) => {
  const { box, victim, link } = await withVictim(t)

  await assert.rejects(
    writeFile(link, 'clobbered', { encoding: 'utf8', flag: 'wx' }),
    (err: NodeJS.ErrnoException) => err.code === 'EEXIST',
    'wx wrote through a live link',
  )
  assert.equal(await readFile(victim, 'utf8'), 'the target contents\n')

  // A dangling link is the subtler half: `wx` tests the *link's* existence, not the target's, so
  // it refuses even when nothing is on the other end. That is what makes `hire` and `addSkill`
  // safe without either of them knowing about symlinks.
  const dangling = join(box, 'dangling')
  await symlink(join(box, 'nothing-here'), dangling)
  await assert.rejects(
    writeFile(dangling, 'clobbered', { encoding: 'utf8', flag: 'wx' }),
    (err: NodeJS.ErrnoException) => err.code === 'EEXIST',
    'wx created a file at the far end of a dangling link',
  )
  await assert.rejects(stat(join(box, 'nothing-here')), (err: NodeJS.ErrnoException) => err.code === 'ENOENT')
})

test('a plain writeFile does write through a link — which is why the heartbeat had to change', async (t) => {
  // The bug, kept as a measurement. If this ever stops being true the fix in `approvals.ts` and
  // the `lstat` in `privacy.ts` are both solving a problem that no longer exists, and somebody
  // should find out from a failing test rather than by reading a stale comment.
  const { victim, link } = await withVictim(t)
  await writeFile(link, '', 'utf8')
  assert.equal(await readFile(victim, 'utf8'), '', 'writeFile stopped following links; the guards can be revisited')
})

test('stat reports the target and lstat reports the link', async (t) => {
  const { box, link } = await withVictim(t)
  const big = join(box, 'big.bin')
  await writeFile(big, Buffer.alloc(64 * 1024, 1))
  const toBig = join(box, 'to-big')
  await symlink(big, toBig)

  assert.equal((await stat(toBig)).size, 64 * 1024, 'stat stopped following')
  assert.ok((await lstat(toBig)).size < 1024, 'lstat reported the target size')
  assert.equal((await lstat(link)).isSymbolicLink(), true)

  // And the Dirent from a readdir reflects `lstat`, which is why `walk` never recursed into a
  // link and instead measured it as a file.
  const entry = (await readdir(box, { withFileTypes: true })).find((e) => e.name === 'to-big')
  assert.ok(entry)
  assert.equal(entry.isDirectory(), false)
  assert.equal(entry.isSymbolicLink(), true)
})

test('mkdir recursive walks through a symlinked component, so the leaf lands outside', async (t) => {
  // The open one. Nothing guards this; the doc comment above says why.
  const box = await tempDir(t, 'links-')
  const outside = await tempDir(t, 'outside-')
  await mkdir(join(box, 'inner'), { recursive: true })
  await symlink(outside, join(box, 'inner', 'through'))

  const leaf = join(box, 'inner', 'through', 'deep', 'leaf.txt')
  await mkdir(dirname(leaf), { recursive: true })
  await writeFile(leaf, 'landed here\n')

  assert.equal(
    await readFile(join(outside, 'deep', 'leaf.txt'), 'utf8'),
    'landed here\n',
    'mkdir stopped walking through symlinked components — the twelve sites could now be guarded cheaply',
  )
})

// ────────────────────────────────────────────────── the primitives we do not use ──

/**
 * `createWriteStream`, `appendFile` and `copyFile` all write through a symlink and none of them
 * appears in `src/`. Absent by accident is one refactor away from present; absent on purpose is
 * this test.
 *
 * Whoever adds one should have to delete a line here and say why, at which point they will have
 * read what the line says.
 */
const FOLLOWS_AND_UNUSED = ['createWriteStream', 'appendFile', 'copyFile', 'truncate'] as const

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(join(repo, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

/**
 * Every name a file imports from `node:fs` or `node:fs/promises`.
 *
 * ## Why this reads imports rather than calls
 *
 * It used to look for `\bname\s*\(` anywhere in `src`, which asks *"is there a call to
 * something spelled like this"* rather than *"does anything use the filesystem primitive"*.
 * Those are different questions and the difference shipped: `truncate` was reported as used, by
 * `src/shared/truncate.ts` — a function that shortens **strings** and has never touched a disk.
 *
 * It went red only when this branch was composed with the one that expanded string truncation.
 * Both were green alone. That is the composition risk in one test, in the file whose entire
 * subject is instruments that answer the wrong question confidently.
 *
 * An import list cannot be fooled that way: a local function named `truncate` is not imported
 * from `node:fs`, and one that *is* imported is the primitive whatever it gets called locally.
 * Every fs import in `src` is a named destructure — checked, not assumed, and the control below
 * fails if that stops being true.
 */
async function fsImportsIn(file: string): Promise<Set<string>> {
  const text = await readFile(join(repo, file), 'utf8')
  const names = new Set<string>()
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'node:fs(?:\/promises)?'/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      // `readFile as read` binds the local name; the imported one is what matters here.
      const name = part.trim().split(/\s+as\s+/)[0]?.trim()
      if (name) names.add(name)
    }
  }
  return names
}

async function importersOf(name: string): Promise<string[]> {
  const found: string[] = []
  for (const file of await sourceFiles('src')) {
    if ((await fsImportsIn(file)).has(name)) found.push(file)
  }
  return found
}

test('the write primitives that follow a symlink are not imported, and the scanner can see one that is', async () => {
  // The instrument check first. A scanner that finds nothing is indistinguishable from a clean
  // tree, and this repository has already been burnt twice by exactly that — four greps agreeing
  // that a live module was dead, because all four were blind. So prove it can see something
  // before believing it when it says it sees nothing.
  //
  // It also guards the assumption the rewrite rests on: if `src` ever switches to
  // `import * as fs` or a `require`, this control drops to zero and says so, rather than
  // reporting a clean tree because it can no longer read the imports.
  const control = await importersOf('writeFile')
  assert.ok(
    control.length > 3,
    `the scanner found ${control.length} modules importing writeFile from node:fs, so it is ` +
      `broken — or src has stopped using named destructures — rather than the tree being clean`,
  )

  for (const name of FOLLOWS_AND_UNUSED) {
    assert.deepEqual(
      await importersOf(name),
      [],
      `${name} follows a symlink and had not been imported anywhere. If this is a deliberate ` +
        `addition, guard the path with lstat first — see the heartbeat in approvals.ts — and ` +
        `remove ${name} from FOLLOWS_AND_UNUSED in this file.`,
    )
  }
})

test('no tracked path is a symlink, which is what makes the mkdir sites safe', async () => {
  // **The premise, asserted directly.** An earlier draft counted the recursive `mkdir` sites and
  // failed when the count moved. That is the wrong fact: a fifteenth site is not the event that
  // makes the decision wrong. What makes those sites safe is that a clone cannot carry a
  // symlinked directory into them — so assert *that*, and it fails on the day the premise dies
  // rather than on the day somebody adds a call.
  //
  // The other session put the general rule better than that draft did: a test asserting "we
  // decided not to" cannot fail when the decision becomes wrong. It can only fail when a count
  // changes, which is a different fact — a check that cannot fail for the right reason, and more
  // dangerous than a comment saying the same words, because it is green, and green implies
  // somebody verified something.
  //
  // Git stores a symlink as mode 120000. Zero of them today, across 266 tracked files.
  const ls = await new Promise<string>((resolve, reject) => {
    execFile('git', ['ls-files', '-s'], { cwd: repo, maxBuffer: 8 << 20 }, (err, out) =>
      err ? reject(err) : resolve(out),
    )
  })

  const entries = ls.split('\n').filter(Boolean)
  // The instrument, before its answer. An empty listing and a repository with no symlinks read
  // identically, and only one of them means anything.
  assert.ok(entries.length > 50, `git listed ${entries.length} tracked files, so this is not reading the index`)

  const links = entries.filter((line) => line.startsWith('120000')).map((line) => line.split('\t')[1] ?? line)
  assert.deepEqual(
    links,
    [],
    'a tracked symlink means a clone now carries one, and the reachability bound that leaves ' +
      'every recursive mkdir site unguarded no longer holds. Read the doc comment at the top of ' +
      'this file before deciding what to do about it.',
  )
})
