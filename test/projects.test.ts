/**
 * Projects.
 *
 * The tab bar is a function of `projects/`, the same way the floor is a function of
 * `.claude/agents/`. So the rules that matter are the same ones: a directory that could not be
 * read is not a workspace with no projects, and the scaffold is not one of the projects.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PLACEHOLDER,
  PROJECTS_DIR,
  PROJECT_FILES,
  createProject,
  discoverProjects,
  displayName,
  projectBlock,
  slugify,
  type Project,
} from '../src/main/projects.js'

import { tempDir } from './temp-dir.js'

async function workspace(t: TestContext, projects: Record<string, string[]> = {}): Promise<string> {
  const root = await tempDir(t, 'office-proj-')
  for (const [name, files] of Object.entries(projects)) {
    const dir = join(root, 'projects', name)
    await mkdir(dir, { recursive: true })
    for (const file of files) await writeFile(join(dir, file), `# ${file}\n`)
  }
  return root
}

const TEMPLATE_FILES = ['PLAN.md', 'PROGRESS.md', 'TASKS.md']

// ────────────────────────────────────────────────────────────────── naming ──

test('a typed name becomes a directory name', () => {
  assert.equal(slugify('  Auth Refresh!  '), 'auth-refresh')
  assert.equal(slugify('Q4 — planning (2026)'), 'q4-planning-2026')
  assert.equal(slugify('***'), '', 'nothing usable is nothing, not a directory called ---')
})

test('a directory name becomes something readable on a tab', () => {
  assert.equal(displayName('auth-refresh'), 'auth refresh')
  assert.equal(displayName('billing_v2'), 'billing v2')
})

// ─────────────────────────────────────────────────────────────── discovery ──

test('each directory under projects/ is a project', async (t) => {
  const root = await workspace(t, { 'auth-refresh': TEMPLATE_FILES, billing: TEMPLATE_FILES })

  const scan = await discoverProjects(root)

  assert.deepEqual(scan.projects.map((p) => p.id), ['auth-refresh', 'billing'])
  assert.equal(scan.problems.length, 0)
})

test('the template is the scaffold, not a project', async (t) => {
  const root = await workspace(t, { _TEMPLATE: TEMPLATE_FILES, billing: TEMPLATE_FILES })

  const scan = await discoverProjects(root)

  assert.deepEqual(scan.projects.map((p) => p.id), ['billing'])
  assert.equal(scan.canCreate, true, 'and its presence is what makes creating one possible')
})

test('without a template the office says it cannot scaffold, rather than failing at the click', async (t) => {
  const root = await workspace(t, { billing: TEMPLATE_FILES })

  assert.equal((await discoverProjects(root)).canCreate, false)
})

test('a workspace with no projects directory has no projects and no problem', async (t) => {
  const root = await tempDir(t, 'office-proj-')

  const scan = await discoverProjects(root)

  assert.deepEqual(scan.projects, [])
  assert.equal(scan.problems.length, 0, 'a fresh clone has not failed at anything')
})

test('a projects directory that cannot be read is a problem, NOT zero projects', async (t) => {
  const root = await workspace(t, { billing: TEMPLATE_FILES })
  const base = join(root, 'projects')
  await chmod(base, 0o000)

  try {
    const scan = await discoverProjects(root)
    if (scan.projects.length > 0) return // running as root

    assert.equal(scan.projects.length, 0)
    assert.equal(scan.problems.some((p) => p.kind === 'unreadable-dir'), true)
  } finally {
    await chmod(base, 0o755)
  }
})

test('a project missing one of the three files is reported as missing it', async (t) => {
  const root = await workspace(t, { billing: ['PLAN.md'] })

  const project = (await discoverProjects(root)).projects[0]

  assert.equal(project?.has['PLAN.md'], true)
  assert.equal(project?.has['TASKS.md'], false, 'so the office can say why a status bubble is empty')
})

// ──────────────────────────────────────────────────────────────── creating ──

test('a new project is copied from the template', async (t) => {
  const root = await workspace(t, { _TEMPLATE: TEMPLATE_FILES })

  const created = await createProject(root, 'Auth Refresh')

  assert.equal(created.state, 'created')
  assert.equal(created.state === 'created' ? created.project.id : '', 'auth-refresh')

  const scan = await discoverProjects(root)
  assert.deepEqual(scan.projects.map((p) => p.id), ['auth-refresh'])
  assert.equal(scan.projects[0]?.has['TASKS.md'], true)
})

test('creating a project that exists opens it rather than flattening it', async (t) => {
  // Copying the template over a plan and a progress log would destroy the record the whole
  // convention exists to keep.
  const root = await workspace(t, { _TEMPLATE: TEMPLATE_FILES, billing: TEMPLATE_FILES })
  await writeFile(join(root, 'projects', 'billing', 'PLAN.md'), '# real work\n')

  const created = await createProject(root, 'Billing')

  assert.deepEqual(created, { state: 'exists', id: 'billing' })
  const { readFile } = await import('node:fs/promises')
  assert.match(await readFile(join(root, 'projects', 'billing', 'PLAN.md'), 'utf8'), /real work/)
})

test('a name with nothing usable in it is refused', async (t) => {
  const root = await workspace(t, { _TEMPLATE: TEMPLATE_FILES })

  assert.equal((await createProject(root, '***')).state, 'failed')
})

test('creating without a template fails with a reason, not a stack trace', async (t) => {
  const root = await workspace(t, {})

  const created = await createProject(root, 'billing')

  assert.equal(created.state, 'failed')
  assert.match(created.state === 'failed' ? created.cause : '', /_TEMPLATE/)
})

// ──────────────────────────────────────────────────── what the manager reads ──

const project = (over: Partial<Project> = {}): Project => ({
  id: 'auth-refresh',
  name: 'auth refresh',
  directory: '/w/projects/auth-refresh',
  has: { 'PLAN.md': true, 'PROGRESS.md': true, 'TASKS.md': true },
  ...over,
})

test('the manager is told which project it is in, and where — absolutely', () => {
  /*
   * The path has to be absolute, and that is the whole point of this assertion.
   *
   * It used to read `projects/auth-refresh/`, which is relative to something the manager is
   * never told. Driven on a packaged build, whose workspace lives under `userData` and nowhere
   * near the home directory: sent `projects/retry-helper/`, the manager read
   * `/Users/somebody/projects/retry-helper/PLAN.md` — a directory that happened to exist — and
   * Claude Code refused all three reads for being outside the workspace. The transcript said
   * "3 tool calls were refused, so none of them ran", on a new user's first message, about the
   * project they had just created.
   *
   * `Project.directory` is already absolute and already on the object, so there is nothing for
   * the manager to resolve and nothing for it to guess.
   */
  const block = projectBlock(project())

  assert.match(block, /^## CURRENT PROJECT$/m)
  assert.match(block, /auth refresh/)
  assert.match(block, /\/w\/projects\/auth-refresh/, 'the block does not carry the project directory')
  assert.doesNotMatch(
    block,
    /`projects\/auth-refresh/,
    'the directory is given relative to nothing. The manager cannot see where it is standing, ' +
      'so it resolves this against a guess — and the guess it made was the user home.',
  )
})

test('missing convention files are named rather than passed over', () => {
  const block = projectBlock(project({ has: { 'PLAN.md': true, 'PROGRESS.md': false, 'TASKS.md': false } }))

  assert.match(block, /Not present yet: PROGRESS\.md, TASKS\.md/)
})

test('no project says so outright, and forbids inventing one', () => {
  const block = projectBlock(null)

  assert.match(block, /None\./)
  assert.match(block, /Do not invent one/)
})

// ──────────────────────────── a new project stops calling itself the template ──

/*
 * `cp` copies the scaffold verbatim, so every project started this way opened with
 * `# <Project Name>` at the top of all three files — a document telling somebody it was still a
 * template, in the first thing they see after naming it.
 *
 * It stayed that way until an agent happened to edit the file for another reason. On the machine
 * this was found on, two projects say their own name and the one nobody worked on still says
 * `<Project Name>`, which is exactly that difference showing.
 */

/** A template whose files carry the placeholder, the way the shipped one does. */
async function templated(t: TestContext): Promise<string> {
  const root = await tempDir(t, 'office-proj-')
  const dir = join(root, 'projects', '_TEMPLATE')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'PLAN.md'), `# ${PLACEHOLDER}\n\nWhat we are building.\n`)
  await writeFile(join(dir, 'PROGRESS.md'), `# Progress — ${PLACEHOLDER}\n`)
  await writeFile(join(dir, 'TASKS.md'), `# Tasks — ${PLACEHOLDER}\n`)
  return root
}

const read = async (root: string, project: string, file: string) =>
  (await import('node:fs/promises')).readFile(join(root, 'projects', project, file), 'utf8')

test('a new project puts its own name where the template left a placeholder', async (t) => {
  const root = await templated(t)

  await createProject(root, 'Auth Refresh')

  for (const file of TEMPLATE_FILES) {
    const text = await read(root, 'auth-refresh', file)
    assert.doesNotMatch(text, /<Project Name>/, `${file} still calls itself the template`)
    assert.match(text, /Auth Refresh/, `${file} does not say the project's name`)
  }
})

test('the name it uses is the one somebody typed, not the slug', async (t) => {
  // `payment-page` came from somebody typing *Payment Page*, and that is the title they meant.
  // A heading that read `# payment-page` would be the directory talking, not the person.
  const root = await templated(t)

  await createProject(root, 'Payment Page')

  assert.match(await read(root, 'payment-page', 'PLAN.md'), /# Payment Page/)
})

test('the rest of the file is untouched', async (t) => {
  // A substitution that rewrote more than the placeholder would be editing somebody's scaffold.
  const root = await templated(t)

  await createProject(root, 'Auth Refresh')

  assert.match(await read(root, 'auth-refresh', 'PLAN.md'), /What we are building\./)
})

test('a template with no placeholder is copied unchanged', async (t) => {
  const root = await workspace(t, { _TEMPLATE: TEMPLATE_FILES })

  const created = await createProject(root, 'Auth Refresh')

  assert.equal(created.state, 'created')
  assert.equal(await read(root, 'auth-refresh', 'PLAN.md'), '# PLAN.md\n')
})


test('the shipped template carries the placeholder the office substitutes', async () => {
  // `createProject` replaces `PLACEHOLDER` only `if (text.includes(PLACEHOLDER))` — correct, so a
  // file without one is copied untouched rather than mangled. The consequence is that the
  // substitution is silent about failing: edit `<Project Name>` out of the template and every
  // project created afterwards is headed `# <Project Name>`, with nothing red anywhere.
  //
  // That is not hypothetical. It shipped once, and the fix was the substitution above. This is
  // the other half — the fix works only while the template still holds what it substitutes.
  //
  // The tests above use `TEMPLATE_FILES`, a list of *names*, and build their own contents. They
  // are right to: they are about copying and refusing to overwrite, not about what ships. So
  // nothing in this file reads the real template, which is why this reads it.
  const { readFile } = await import('node:fs/promises')
  const here = dirname(fileURLToPath(import.meta.url))

  for (const file of PROJECT_FILES) {
    const text = await readFile(join(here, '..', 'projects', '_TEMPLATE', file), 'utf8')
    const count = text.split(PLACEHOLDER).length - 1
    // `=== 1` rather than `>= 1`, because `PLACEHOLDER`'s own doc pins the convention: *"Exactly
    // one string, once per file."* Two is not a bug in `createProject` — it uses `replaceAll`, and
    // a second copy substitutes correctly — so the message has to say which of the two conditions
    // it is firing on. The first version explained only the zero case and fired on both, which
    // sends the reader looking for a substitution failure that is not there.
    assert.equal(
      count,
      1,
      count === 0
        ? `projects/_TEMPLATE/${file} contains no ${PLACEHOLDER} — createProject substitutes it, so ` +
          'every new project is created carrying the placeholder as its own name, and the suite ' +
          'stays green while it happens'
        : `projects/_TEMPLATE/${file} contains ${count} copies of ${PLACEHOLDER}. All of them will ` +
          `substitute correctly — createProject uses replaceAll — but ${PLACEHOLDER} is documented ` +
          'as appearing exactly once per file, and a second one is usually a paste rather than a ' +
          'decision. Delete it, or change the doc on PLACEHOLDER if the convention has moved.',
    )
  }
})

test('a symbolic link in the scaffold is refused, rather than copied into every project', async (t) => {
  /*
   * `cp`'s `dereference` defaults to **false**, so a link in `_TEMPLATE` is copied *as a link*
   * into the new project — and then the office reads the copy:
   *
   *     createProject → created
   *     projects/my-project/PLAN.md → "ssh-rsa AAAAB3NzaC1yc2E PRIVATE KEY MATERIAL"
   *     discovery → my-project, nothing missing, no problem reported
   *
   * A plan file is plain markdown with no frontmatter and no structure, so *any* readable file
   * becomes the project's PLAN.md. That is the difference from the same shape in
   * `.claude/agents/`, where `readEmployee` needs frontmatter and the targets narrow to other
   * agent files — a property of that parser rather than of the class.
   *
   * `.gitignore` ships `_TEMPLATE` deliberately (`!projects/_TEMPLATE/**`) and git preserves
   * symlinks, so a cloned workspace can carry one. The trigger is somebody creating their first
   * project, which is what the README tells them to do.
   */
  const root = await tempDir(t, 'office-template-link-')
  const template = join(root, PROJECTS_DIR, '_TEMPLATE')
  await mkdir(join(template, 'sub'), { recursive: true })
  await writeFile(join(root, 'id_rsa'), 'PRIVATE KEY MATERIAL\n')
  for (const file of PROJECT_FILES) await writeFile(join(template, file), `# ${PLACEHOLDER}\n`)

  // One level down, because the check has to walk rather than list.
  await symlink(join(root, 'id_rsa'), join(template, 'sub', 'notes.md'))

  const made = await createProject(root, 'my project')

  assert.equal(made.state, 'failed', 'a link in the scaffold was copied into a project')
  assert.match(made.state === 'failed' ? made.cause : '', /sub\/notes\.md/, 'the refusal does not say which file')
  await assert.rejects(stat(join(root, PROJECTS_DIR, 'my-project')), 'the project was created anyway')
})

test('...and a scaffold with no links still makes a project', async (t) => {
  // The other half. Refusing every template would pass the test above and break the product.
  const root = await tempDir(t, 'office-template-ok-')
  const template = join(root, PROJECTS_DIR, '_TEMPLATE')
  await mkdir(template, { recursive: true })
  for (const file of PROJECT_FILES) await writeFile(join(template, file), `# ${PLACEHOLDER}\n`)

  const made = await createProject(root, 'my project')

  assert.equal(made.state, 'created', made.state === 'failed' ? made.cause : '')
  assert.match(await readFile(join(root, PROJECTS_DIR, 'my-project', 'PLAN.md'), 'utf8'), /# my project/)
})

// ────────────────────────────────────────────────── names nobody meant well ──

/**
 * What a person types is now a path component, and until recently nobody could type it.
 *
 * `+ new project` called `window.prompt`, which Electron does not implement — it returns `null`,
 * so the field that feeds `createProject` was unreachable for as long as the app has shipped.
 * Replacing it with a real input made this the one place in the product where free text from the
 * renderer becomes a directory name, and a path this repository has never had a hostile test for
 * is a path whose safety nobody has checked.
 *
 * `slugify` is an allowlist — `[^a-z0-9]+` becomes a hyphen — which is the right shape and the
 * reason these pass. They are written against the **property** rather than the spelling: not
 * "what does this name slug to" but "wherever this ends up, is it inside `projects/`". A future
 * slugify that kept dots for readability would leave every existing naming test green and fail
 * these, which is the point of writing them this way round.
 */
test('no name, however hostile, escapes the projects directory', async (t) => {
  const hostile = [
    '../../../etc/passwd',
    '..',
    '../',
    './../.ssh/id_rsa',
    '/etc/passwd',
    '~/.ssh/authorized_keys',
    'foo/../../bar',
    String.raw`..\..\windows\system32`,
    '.',
    '...',
    'projects/../../outside',
    '../../up',
  ]

  for (const name of hostile) {
    const root = await workspace(t, { _TEMPLATE: TEMPLATE_FILES })
    const projects = join(root, 'projects')
    const created = await createProject(root, name)

    // Refused outright is a perfectly good answer; the assertion is about what happens when it
    // is not refused.
    if (created.state !== 'created') continue

    const where = resolve(projects, created.project.id)

    // `dirname(where) === projects`, not `!relative(...).startsWith('..')`.
    //
    // The first draft used the string test and it was wrong in a way that passed: it rejects any
    // id whose *name* begins with two dots — `..-..-etc-passwd` is a perfectly ordinary single
    // directory inside `projects/`, and the check called it an escape. It failed the mutation
    // for a reason next to the real one, and it would have refused an honest project called
    // `..hello`. Asking who the parent is settles it exactly, with no spelling involved.
    assert.equal(
      dirname(where),
      resolve(projects),
      `createProject(${JSON.stringify(name)}) produced id ${JSON.stringify(created.project.id)}, ` +
        `which lands in ${dirname(where)} rather than ${projects}. A typed project name is ` +
        `renderer input and must never become more than one path component.`,
    )
    assert.equal(
      created.project.id.includes('/') || created.project.id.includes('\\'),
      false,
      `id ${JSON.stringify(created.project.id)} carries a path separator`,
    )
    // And a directory really was made, rather than a claim that one was.
    assert.equal(
      (await stat(where)).isDirectory(),
      true,
      `${where} was reported created and is not there`,
    )
  }
})

test('a name that is only punctuation is refused rather than becoming a directory', async (t) => {
  const root = await workspace(t, { _TEMPLATE: TEMPLATE_FILES })
  for (const name of ['...', '///', '   ', '..', ' ', '!!!']) {
    const created = await createProject(root, name)
    assert.equal(
      created.state,
      'failed',
      `createProject(${JSON.stringify(name)}) returned ${created.state} — a name with nothing ` +
        `usable in it is not a project, and must not become a directory named after its separators`,
    )
  }
})

test('a very long name is cut to something a filesystem will take', async (t) => {
  const root = await workspace(t, { _TEMPLATE: TEMPLATE_FILES })
  const created = await createProject(root, 'a'.repeat(500))

  assert.equal(created.state, 'created')
  const id = created.state === 'created' ? created.project.id : ''
  // The assertion is the filesystem's limit rather than the current cap, so tightening
  // `slice(0, 48)` stays green and removing it does not.
  assert.ok(
    id.length > 0 && id.length <= 255,
    `id is ${id.length} characters, which no common filesystem will take`,
  )
  assert.equal((await stat(join(root, 'projects', id))).isDirectory(), true)
})
