/**
 * A workspace that is not a clone of this repo could not make a project.
 *
 * Which is the product's core loop. `VISION.md` §2 and `CLAUDE.md` both describe a project as the
 * unit of work, and `+ new project` copies `projects/_TEMPLATE`. That template ships — it is in
 * `package.json`'s `extraResources`, so it is inside the bundle — but shipping a file into the
 * *app* is not the same as seeding it into somebody's *workspace*, and only `shipped-hashes.json`
 * does the second thing. It was built from `git ls-files .claude` and nothing else.
 *
 * So an office opened anywhere but a clone got seven agents, five skills, and no `projects/`
 * directory at all. Pressing `+ new project` answered, correctly and uselessly:
 *
 *   "A project is a directory under projects/ copied from projects/_TEMPLATE — and that template
 *    is missing, so the office cannot start one for you. Create the directory by hand, or
 *    re-clone."
 *
 * Measured on a workspace holding one agent file: the manifest had 21 entries, every one under
 * `.claude/`. Nothing anywhere read that manifest in a test, so eleven audit passes went by
 * without noticing — every one of them either made project directories by hand or never pressed
 * the button.
 *
 * This file exists so the seeding list and the thing it has to seed cannot drift apart again.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
// @ts-expect-error — a plain .mjs declaration with no types, read for its exported list.
import { SHIPPED } from '../scripts/shipped.mjs'

const run = promisify(execFile)
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * The list the manifest is generated from — the only thing that decides what a new office gets.
 *
 * Imported now rather than regexed out of `scripts/build.mjs`. It used to be parsed, with an
 * assertion whose message read *"scripts/build.mjs no longer declares SHIPPED — this whole file
 * is blind"* — and that assertion did its job: moving the list into its own module to make it
 * readable without running a build turned every test here red at once, loudly, which is exactly
 * what it was written for.
 *
 * The import is strictly better than what it replaces, but not for the reason this comment used
 * to give. It claimed the rename "fails at the typechecker" — and the `@ts-expect-error` two
 * lines above the import is precisely what stops it doing that. Measured: rename the export and
 * `tsc --noEmit` exits 0, because `scripts/**` is outside `tsconfig.json`'s `include` and
 * `allowJs` is off, so the specifier never resolves and the suppression swallows it.
 *
 * What is true, also measured: the rename fails at **load**, loudly, before a single assertion
 * runs —
 *
 *     SyntaxError: The requested module '../scripts/shipped.mjs' does not provide an
 *     export named 'SHIPPED'
 *
 * which is what a regex could not do. It would have matched nothing and reported a short list as
 * a complete one. Loud at runtime is the guarantee; the typechecker was never involved.
 *
 * Left here rather than deleted because a comment describing a protection the code beside it
 * removes is the same species as `closeEverything()` sitting under "one list, because there were
 * two and they drifted" — and this file is about seeding, where a silently short list is the
 * whole fault.
 */
function shippedList(): string[] {
  return [...SHIPPED]
}

test('the seeding list carries the project template, not only .claude', () => {
  const shipped = shippedList()
  assert.ok(shipped.includes('.claude'), 'the staff are no longer seeded')
  assert.ok(
    shipped.includes('projects/_TEMPLATE'),
    'a new office will be seeded without `projects/_TEMPLATE`, so `+ new project` refuses and ' +
      'the product cannot do the thing it is for. Anyone running from a clone will not see this, ' +
      'because a clone already has the file — which is exactly how it shipped.',
  )
})

test('every path in the seeding list is real and tracked, or it seeds nothing', async () => {
  // A path that is merely absent seeds silently: `git ls-files` returns no rows for it, the
  // manifest is short by exactly the missing set, and the build still prints a cheerful count.
  for (const path of shippedList()) {
    await access(join(repo, path))
    const { stdout } = await run('git', ['ls-files', '--', path], { cwd: repo })
    assert.ok(
      stdout.trim().length > 0,
      `${path} is in the seeding list and git tracks nothing there, so it seeds nothing`,
    )
  }
})

test('the three files a project is made of are all seeded', async () => {
  /*
   * Named one at a time rather than trusting the directory. `projects.ts` copies the template
   * wholesale, and `CLAUDE.md` says every project carries PLAN, PROGRESS and TASKS — a template
   * that lost one would still copy, still make a project, and produce a project the floor cannot
   * read, which is a worse failure than refusing.
   */
  const { stdout } = await run('git', ['ls-files', '--', 'projects/_TEMPLATE'], { cwd: repo })
  const tracked = stdout.split('\n').filter(Boolean)
  for (const file of ['PLAN.md', 'PROGRESS.md', 'TASKS.md']) {
    assert.ok(
      tracked.includes(`projects/_TEMPLATE/${file}`),
      `projects/_TEMPLATE/${file} is not tracked, so a new project would be missing it`,
    )
  }
})

test('the refusal still names the file this seeds, so the two cannot drift', async () => {
  // If somebody renames the template, this is the sentence that has to change with it — and it
  // is the only place a user is told what went wrong.
  const firstRun = await readFile(join(repo, 'src/shared/first-run.ts'), 'utf8')
  assert.match(
    firstRun,
    /projects\/_TEMPLATE/,
    'the "cannot start a project" message no longer names projects/_TEMPLATE, so the message and ' +
      'the seeding list can now disagree about which file is missing',
  )
})

test('the seeding list carries the rules that keep the work private', () => {
  /*
   * `.gitignore`'s own header is the rule this manifest exists to implement: *"we ship the OFFICE
   * (agents, skills, commands, settings). You keep the WORK (memory, projects, history,
   * credentials)."* A fresh office was getting the first half and not the second — it had no
   * `.gitignore` at all.
   *
   * The privacy panel said so, correctly and uselessly: **"3 things meant to stay on this machine
   * would be included in a push"**, naming `memory`, `projects` and `.office-space`, each with
   * *"Git is not ignoring this, so a push would publish it."* So the office was warning about a
   * hole it had left itself, on the one surface whose subject is what leaves your machine.
   *
   * Anybody running from a clone sees none of this, because a clone already has the file. Same
   * shape as the template above, and found the same way — by opening the panel in a workspace
   * that was not this repository.
   */
  assert.ok(
    shippedList().includes('.gitignore'),
    'a new office is seeded without a `.gitignore`, so `memory/`, `projects/` and `.office-space/` ' +
      'are all publishable by a push — the memory the office keeps about somebody, and their work.',
  )
})

test('the seeded rules actually cover the private directories', async () => {
  // Naming the file is not the same as the file being right. These three are what the privacy
  // panel names, and what `.gitignore`'s own header promises stays on the machine.
  const rules = await readFile(join(repo, '.gitignore'), 'utf8')
  for (const kept of ['memory/**', 'projects/**', '.office-space/']) {
    assert.ok(rules.includes(kept), `.gitignore no longer keeps ${kept} out of a push`)
  }
  // And the one exception that has to survive, or seeding the template achieves nothing.
  assert.ok(
    rules.includes('!projects/_TEMPLATE/'),
    'projects/** is ignored with no exception for _TEMPLATE, so the template a new project is ' +
      'copied from would not be committed by anybody who forks this office',
  )
})

test('the standing orders reach the offices that are meant to obey them', async () => {
  /*
   * The worst of these, and found last.
   *
   * `CLAUDE.md`'s first section is titled "The standing orders" and opens *"These rules govern
   * every agent in this workspace"*. Four rules — only two principals may originate work, claims
   * are verified not believed, nothing on screen may lie, and absent is not empty, which the file
   * itself calls the mistake that has cost more than any other. A fresh office had **none** of
   * them, because the manifest seeded `.claude/` and nothing beside it.
   *
   * Every agent in every installed copy was working without the rules this repository spends its
   * documentation explaining, while the repository's own agents read them from a clone and
   * therefore looked fine.
   */
  const shipped = shippedList()
  assert.ok(
    shipped.includes('CLAUDE.md'),
    'a new office is seeded without CLAUDE.md, so no agent in it ever reads the standing orders',
  )

  const rules = await readFile(join(repo, 'CLAUDE.md'), 'utf8')
  assert.match(rules, /standing orders/i, 'CLAUDE.md no longer states the standing orders')
  /*
   * The one-command-per-Bash-call rule is deliberately **not** asserted here.
   *
   * It was moved out of `manager.md` into `CLAUDE.md` so that all seven agents read it rather
   * than only the manager, and that move has been taken back out of this branch: `CLAUDE.md` is
   * Vish's standing instruction to every session, and changing it is his decision to make rather
   * than one to find inside a large diff.
   *
   * So the rule sits in `manager.md` again, which means **the six employees — who run most of
   * the commands — do not see it.** That is a real gap and it is recorded here rather than
   * quietly dropped, because a test that stops asserting something is the easiest place in a
   * repository for a known problem to disappear.
   */
})

test('everything the manifest promises to seed is actually in the package', async () => {
  /*
   * Two lists that have to agree, and nothing made them.
   *
   * `SHIPPED` in `scripts/build.mjs` decides what a new office is *seeded with*.
   * `build.extraResources` in `package.json` decides what is *in the bundle*. The manifest names
   * a path; `reconcile.ts` then reads that path out of the installed app to copy it. A path in
   * one list and not the other is a promise the package cannot keep — `readFile` → ENOENT →
   * reported to the user on first run as a file the office could not bring forward.
   *
   * It happened. `CLAUDE.md`, `.gitignore` and `memory/README.md` were added to the manifest and
   * not to `extraResources`, and every check of them passed, because `npx electron .` resolves
   * the app root to this repository — where all three exist. Building the DMG and looking inside
   * is what showed it: three MISSING out of seven.
   */
  const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')) as {
    build?: { extraResources?: { from: string }[] }
  }
  const bundled = (pkg.build?.extraResources ?? []).map((r) => r.from)
  assert.ok(bundled.length > 0, 'nothing is copied into the package, so this proved nothing')

  const promised = shippedList()
  const unkeepable = promised.filter(
    (path) => !bundled.some((from) => path === from || path.startsWith(`${from}/`)),
  )
  assert.deepEqual(
    unkeepable,
    [],
    'the manifest promises to seed these and the package does not contain them. In development ' +
      'they resolve against this repository and look fine; installed, each one is a file the ' +
      'office reports it could not bring forward. Add them to build.extraResources.',
  )
})
