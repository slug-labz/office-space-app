/**
 * Slash command discovery.
 *
 * `.claude/commands/` is the directory `CLAUDE.md` singles out: it does not ship, and the
 * moment somebody creates it the office has to read it. That makes it the sharpest case of the
 * fourth standing order, because all three states are real here and two of them look identical
 * from the outside — **no directory** is genuinely zero commands, and **a directory we could
 * not read** is not. The split between those two is what most of this file checks.
 *
 * The rest checks the things that were measured against the real CLI rather than assumed: that
 * the filename is the name, that subdirectories namespace with a colon, and that a command with
 * no frontmatter is still a command. Those are load-bearing claims made in the module comment
 * of `src/main/commands.ts`, so they are checked here rather than asserted in prose.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { discoverCommands } from '../src/main/commands.js'

import { tempDir } from './temp-dir.js'

/** A workspace whose `.claude/commands/` holds exactly these files. Keys may name a subdirectory. */
async function workspace(t: TestContext, commands: Record<string, string> | null = {}): Promise<string> {
  const root = await tempDir(t, 'office-cmd-')
  if (commands === null) return root

  const base = join(root, '.claude', 'commands')
  await mkdir(base, { recursive: true })

  for (const [name, body] of Object.entries(commands)) {
    const path = join(base, name)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, body)
  }
  return root
}

const commandFile = (fields: string, body = 'Do the thing.\n') => `---\n${fields}\n---\n\n${body}`

// ──────────────────────────────────────────────────────── the three states ──

test('a workspace with no commands directory has no commands and no problem', async (t) => {
  // The one case where absent really does mean empty: nobody has added a command, so there are
  // none. `CLAUDE.md` says this out loud because it is the exception, not the rule.
  const scan = await discoverCommands(await workspace(t, null))

  assert.deepEqual(scan.commands, [])
  assert.equal(scan.problems.length, 0, 'a fresh clone has not failed at anything')
})

test('an empty commands directory is zero commands, and still not a failure', async (t) => {
  const scan = await discoverCommands(await workspace(t, {}))

  assert.deepEqual(scan.commands, [])
  assert.equal(scan.problems.length, 0)
})

test('a commands directory that cannot be read is a problem, NOT zero commands', async (t) => {
  const root = await workspace(t, { 'state.md': commandFile('description: Reconcile.') })
  const base = join(root, '.claude', 'commands')
  await chmod(base, 0o000)

  try {
    const scan = await discoverCommands(root)
    if (scan.commands.length > 0) return // running as root

    assert.equal(scan.commands.length, 0)
    assert.equal(
      scan.problems.some((p) => p.kind === 'unreadable-dir' && p.path === base),
      true,
      'otherwise the office claims this workspace has no commands, about a workspace that has one',
    )
  } finally {
    await chmod(base, 0o755)
  }
})

test('a subdirectory that cannot be read is a problem, and the rest still comes back', async (t) => {
  const root = await workspace(t, {
    'state.md': commandFile('description: Reconcile.'),
    'office/nested.md': commandFile('description: Nested.'),
  })
  const nested = join(root, '.claude', 'commands', 'office')
  await chmod(nested, 0o000)

  try {
    const scan = await discoverCommands(root)
    if (scan.commands.length > 1) return // running as root

    assert.deepEqual(scan.commands.map((c) => c.name), ['state'])
    assert.equal(scan.problems.some((p) => p.kind === 'unreadable-dir' && p.path === nested), true)
  } finally {
    await chmod(nested, 0o755)
  }
})

test('a command file that cannot be read is a problem, not a command that is missing', async (t) => {
  const root = await workspace(t, { 'state.md': commandFile('description: Reconcile.') })
  const file = join(root, '.claude', 'commands', 'state.md')
  await chmod(file, 0o000)

  try {
    const scan = await discoverCommands(root)
    if (scan.commands.length > 0) return // running as root

    assert.equal(
      scan.problems.some((p) => p.kind === 'unreadable-file' && p.path === file),
      true,
    )
  } finally {
    await chmod(file, 0o644)
  }
})

// ─────────────────────────────────────────────────────────────── discovery ──

test('a command carries its description, its argument hint and where it lives', async (t) => {
  const root = await workspace(t, {
    'verify.md': commandFile('description: Run a task\'s VERIFY.\nargument-hint: <task number>'),
  })

  const command = (await discoverCommands(root)).commands[0]

  assert.equal(command?.name, 'verify')
  assert.equal(command?.description, "Run a task's VERIFY.")
  assert.equal(command?.argumentHint, '<task number>')
  assert.equal(command?.filePath, join(root, '.claude', 'commands', 'verify.md'))
})

test('a command that declares no argument hint has null, not an empty string', async (t) => {
  // The difference between "takes no arguments" and "nobody said what it takes".
  const root = await workspace(t, {
    'state.md': commandFile('description: Reconcile.'),
    'plan.md': commandFile('description: Plan.\nargument-hint:   '),
  })

  const byName = new Map((await discoverCommands(root)).commands.map((c) => [c.name, c]))

  assert.equal(byName.get('state')?.argumentHint, null)
  assert.equal(byName.get('plan')?.argumentHint, null, 'a blank hint is no hint')
})

test('the filename is the name, even when frontmatter claims otherwise', async (t) => {
  // Measured against claude 2.1.231: a file called `renamed.md` is `/renamed`, and its
  // frontmatter `name` is ignored. A menu that offered the frontmatter name would offer
  // something that does not work.
  const root = await workspace(t, { 'renamed.md': commandFile('name: totally-different\ndescription: Nope.') })

  assert.deepEqual((await discoverCommands(root)).commands.map((c) => c.name), ['renamed'])
})

test('a subdirectory namespaces its commands with a colon, the way the CLI does', async (t) => {
  const root = await workspace(t, {
    'office/nested.md': commandFile('description: Nested.'),
    'office/deep/deeper.md': commandFile('description: Deeper.'),
  })

  assert.deepEqual(
    (await discoverCommands(root)).commands.map((c) => c.name),
    ['office:deep:deeper', 'office:nested'],
  )
})

test('a command with no frontmatter is still a command, and is still reported', async (t) => {
  // The CLI runs it — it resolves commands by path, not by anything inside them. Hiding it
  // would leave the office showing a shorter menu than the one that actually works.
  const root = await workspace(t, { 'bare.md': 'Just a body.\n' })

  const scan = await discoverCommands(root)

  assert.deepEqual(scan.commands.map((c) => c.name), ['bare'])
  assert.equal(scan.commands[0]?.description, '', 'and nothing is invented to fill the gap')
  assert.equal(scan.problems.some((p) => p.kind === 'no-frontmatter'), true)
})

test('only markdown counts, and dotfiles are not commands', async (t) => {
  const root = await workspace(t, {
    'state.md': commandFile('description: Reconcile.'),
    'README.txt': 'not a command',
    '.hidden.md': commandFile('description: Hidden.'),
  })

  assert.deepEqual((await discoverCommands(root)).commands.map((c) => c.name), ['state'])
})

test('commands come back sorted by what you type', async (t) => {
  const root = await workspace(t, {
    'verify.md': commandFile('description: Verify.'),
    'decision.md': commandFile('description: Decide.'),
    'office/nested.md': commandFile('description: Nested.'),
    'gotcha.md': commandFile('description: Gotcha.'),
  })

  assert.deepEqual(
    (await discoverCommands(root)).commands.map((c) => c.name),
    ['decision', 'gotcha', 'office:nested', 'verify'],
  )
})
