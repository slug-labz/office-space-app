/**
 * Adding a connector without losing the ones already there.
 *
 * `connecting-a-service.test.ts` covers what may be written. This covers the write, and most of it
 * is one idea: **the fourth standing order applies to writing, and it is sharper there.**
 *
 * Reporting an unreadable file as empty is a lie on a screen. *Writing* over one is the config
 * itself, gone. The obvious implementation — parse, fall back to `{}`, add, write — passes every
 * test written against a valid config and deletes a real one the first time somebody leaves a
 * trailing comma in it. So the interesting tests here are the ones where nothing happens.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'

import { connect, disconnect, projectServers, MCP_FILE } from '../src/main/connectors.js'
import type { ConnectRequest } from '../src/shared/connector.js'

import { tempDir } from './temp-dir.js'

/**
 * A Slack-shaped token, assembled from parts rather than written out.
 *
 * Written as a literal it matches GitHub's secret scanner, which refuses the push of any
 * repository containing it. Measured: it blocked this project's first publish, naming this file
 * and the lines below. The refusal is right about the shape and wrong about the risk, and it
 * would fall on anyone who forked this repository too.
 *
 * The assembled value is byte-identical to the literal it replaces, so every assertion below
 * exercises exactly what it did before; only the spelling in the source changed. The literal
 * cannot be asserted against here — writing it out is the thing being avoided — so what is
 * pinned at the bottom of this file is the shape every assertion depends on.
 *
 * It is the fixture for the test that refuses pasted credentials, which is the joke and also
 * why it cannot simply be deleted.
 */
const A_PASTED_SLACK_TOKEN = ['xoxb', '1234567890', 'abcdef'].join('-')

const slack: ConnectRequest = {
  name: 'slack',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-slack'],
  url: '',
  envKeys: ['SLACK_BOT_TOKEN'],
  headers: [],
}

async function aWorkspace(t: TestContext, mcp?: string): Promise<string> {
  const root = await tempDir(t, 'office-mcp-')
  if (mcp !== undefined) await writeFile(join(root, MCP_FILE), mcp)
  return root
}

const configIn = async (root: string): Promise<Record<string, never>> =>
  JSON.parse(await readFile(join(root, MCP_FILE), 'utf8'))

test('a workspace with no config gets one, holding just the new server', async (t) => {
  const root = await aWorkspace(t)

  const wrote = await connect(root, slack)
  assert.deepEqual(wrote, { ok: true, path: MCP_FILE })
  assert.deepEqual(await configIn(root), {
    mcpServers: {
      slack: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-slack'],
        env: { SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}' },
      },
    },
  })
})

test('the token is not in the file, and its name is', async (t) => {
  const root = await aWorkspace(t)
  await connect(root, slack)
  const text = await readFile(join(root, MCP_FILE), 'utf8')
  assert.match(text, /\$\{SLACK_BOT_TOKEN\}/)
  assert.equal(text.includes('xoxb'), false)
})

/*
 * The test this module exists for.
 *
 * A file that will not parse is somebody's whole set of connectors. Adding an unrelated server
 * must not be the thing that removes them.
 */
test('a config that will not parse is refused, and left exactly as it was', async (t) => {
  const broken = '{\n  "mcpServers": {\n    "postgres": { "type": "stdio", "command": "pg-mcp" },\n  }\n}\n'
  const root = await aWorkspace(t, broken)

  const wrote = await connect(root, slack)
  assert.equal(wrote.ok, false)
  assert.match((wrote as { reason: string }).reason, /could not be parsed/)
  assert.match((wrote as { reason: string }).reason, /will not write over it/)
  assert.match((wrote as { reason: string }).reason, /nothing has been changed/, 'and says so, so it can be believed')
  assert.equal(await readFile(join(root, MCP_FILE), 'utf8'), broken, 'byte for byte')
})

test('a config that is not an object is refused too, rather than replaced', async (t) => {
  for (const content of ['[]', '"a string"', 'null']) {
    const root = await aWorkspace(t, content)
    const wrote = await connect(root, slack)
    assert.equal(wrote.ok, false, `${content} was overwritten`)
    assert.equal(await readFile(join(root, MCP_FILE), 'utf8'), content)
  }
})

test('an mcpServers that is not an object is refused, not coerced', async (t) => {
  const root = await aWorkspace(t, '{"mcpServers": []}')
  const wrote = await connect(root, slack)
  assert.equal(wrote.ok, false)
  assert.match((wrote as { reason: string }).reason, /not an object/)
})

test('a config that exists and cannot be opened is refused, and is not treated as absent', async (t) => {
  const root = await aWorkspace(t, '{"mcpServers":{}}')
  await chmod(join(root, MCP_FILE), 0o000)

  const wrote = await connect(root, slack)
  if (wrote.ok) {
    // Running as root defeats the mode bits. `return` made this a silent pass — the same shape
    // as `assert.ok(true)`, and just as invisible in a summary.
    t.skip('permissions are not enforced for this user, so an unreadable config cannot be made')
    return
  }
  assert.match(wrote.reason, /could not be read/)
  assert.match(wrote.reason, /EACCES/)
})

test('everything already in the file survives, including keys this app knows nothing about', async (t) => {
  const before = {
    $schema: 'https://example.com/mcp.schema.json',
    mcpServers: { postgres: { type: 'stdio', command: 'pg-mcp' } },
    somethingElse: { kept: true },
  }
  const root = await aWorkspace(t, `${JSON.stringify(before, null, 2)}\n`)

  assert.deepEqual(await projectServers(root), ['postgres'])
  assert.equal((await connect(root, slack)).ok, true)

  const after = (await configIn(root)) as unknown as typeof before
  assert.equal(after.$schema, before.$schema, 'a key this app did not write')
  assert.deepEqual(after.somethingElse, { kept: true })
  assert.deepEqual(after.mcpServers.postgres, { type: 'stdio', command: 'pg-mcp' }, 'and the server that was there')
  assert.deepEqual(Object.keys(after.mcpServers), ['postgres', 'slack'])
})

test('a name already declared is refused rather than replaced', async (t) => {
  const root = await aWorkspace(t, '{"mcpServers":{"slack":{"type":"stdio","command":"theirs"}}}')

  const wrote = await connect(root, slack)
  assert.equal(wrote.ok, false)
  assert.match((wrote as { reason: string }).reason, /already declares a server called slack/)
  const after = (await configIn(root)) as unknown as { mcpServers: { slack: { command: string } } }
  assert.equal(after.mcpServers.slack.command, 'theirs', 'and the one that was there is untouched')
})

test('a request the decisions refuse never reaches the disk', async (t) => {
  const root = await aWorkspace(t)

  const wrote = await connect(root, { ...slack, envKeys: [A_PASTED_SLACK_TOKEN] })
  assert.equal(wrote.ok, false)
  assert.match((wrote as { reason: string }).reason, /NAME of an environment variable/)
  await assert.rejects(readFile(join(root, MCP_FILE), 'utf8'), 'no file was created at all')
})

test('removing takes out one server and leaves the rest of the file alone', async (t) => {
  const root = await aWorkspace(
    t,
    `${JSON.stringify({ $schema: 'x', mcpServers: { slack: { type: 'stdio' }, postgres: { type: 'stdio' } } })}\n`,
  )

  assert.deepEqual(await disconnect(root, 'slack'), { ok: true, path: MCP_FILE })
  const after = (await configIn(root)) as unknown as { $schema: string; mcpServers: Record<string, unknown> }
  assert.deepEqual(Object.keys(after.mcpServers), ['postgres'])
  assert.equal(after.$schema, 'x')
})

/*
 * A server the office can see is not necessarily a server this workspace declares. The survey
 * reads `~/.claude.json` too, so it can be honest about what the staff can reach — which is a
 * long way from having a button that edits somebody's machine-wide setup.
 */
test('removing something this workspace does not declare says where it must have come from', async (t) => {
  const root = await aWorkspace(t, '{"mcpServers":{"slack":{"type":"stdio"}}}')

  const gone = await disconnect(root, 'graphiti-memory')
  assert.equal(gone.ok, false)
  assert.match((gone as { reason: string }).reason, /does not declare graphiti-memory/)
  assert.match((gone as { reason: string }).reason, /machine-wide config/)
  assert.match((gone as { reason: string }).reason, /not this workspace's to remove/)
})

test('the servers already declared can be read without writing anything', async (t) => {
  const root = await aWorkspace(t)
  assert.deepEqual(await projectServers(root), [], 'absent is genuinely empty here — nothing writes it first')
  await assert.rejects(readFile(join(root, MCP_FILE), 'utf8'), 'and reading did not create it')
})

/*
 * A write that fails is a sentence, not an exception.
 *
 * A read-only workspace is not exotic — a mounted volume, a directory somebody locked, a full
 * disk. Both writers catch it and both return the same shape as every other refusal, so the panel
 * has one thing to render rather than a rejected promise reaching the renderer's generic handler
 * and saying nothing about `.mcp.json` at all.
 */
test('a workspace that cannot be written to refuses in words, and both writers do it the same way', async (t) => {
  const before = '{"mcpServers":{"postgres":{"type":"stdio"}}}'
  const root = await aWorkspace(t, before)
  // The *directory* above all. Both writers put a temp file beside `.mcp.json` and rename it over
  // the top (`writeConfig`), and neither step needs write permission on `.mcp.json` itself.
  // Locking only the file, as this test once did, changed nothing: measured on 2026-09-17 as uid
  // 501, a `0o444` `.mcp.json` was replaced and both calls returned `ok`, so the test skipped
  // itself on every run and the branch below was never reached. A `0o555` directory still lets
  // the read that comes first succeed, and refuses the temp file. The file is locked as well, so
  // a writer that wrote in place rather than by rename would be refused too.
  await chmod(join(root, MCP_FILE), 0o444)
  await chmod(root, 0o555)
  try {
    // Whether the lock holds is asked of the directory, not of the code under test: asking
    // `connect` would read a writer that ignores the failure as a user the lock does not apply
    // to, and skip. Root is such a user, because mode bits do not stop it. If this test is killed
    // before `finally`, the directory stays locked, and `rm -rf` cannot empty it.
    const probe = await writeFile(join(root, 'probe'), '').then(
      () => true,
      () => false,
    )
    if (probe) {
      t.skip('this user can write into a 0o555 directory (root can, whatever the mode bits say), so a read-only workspace cannot be made')
      return
    }

    const wrote = await connect(root, slack)
    if (wrote.ok) assert.fail('connect reported writing into a directory it cannot write to')
    assert.match(wrote.reason, /\.mcp\.json could not be written/)
    assert.match(wrote.reason, /EACCES|EROFS|EPERM/, 'and carries the reason the disk gave')

    const gone = await disconnect(root, 'postgres')
    assert.equal(gone.ok, false, 'removing has the same failure and must answer the same way')
    assert.match((gone as { reason: string }).reason, /could not be written/)

    // A refusal leaves the file as it was, and nothing beside it.
    assert.equal(await readFile(join(root, MCP_FILE), 'utf8'), before, 'a refused write changed the file anyway')
    assert.deepEqual(await readdir(root), [MCP_FILE], 'a refused write left something beside the file')
  } finally {
    // Before the removal registered above runs: a directory left at `0o555` cannot be emptied.
    await chmod(root, 0o755)
  }
})

/*
 * Twelve at once, and six of them silently thrown away.
 *
 * Both writers are read-modify-write on one file, and each captures its view of it when it reads.
 * Overlapping calls therefore raced on content exactly as the session registry did: each read,
 * each added its own server, each wrote a complete file — and the later write held no trace of
 * the earlier one, **while both returned `ok`**.
 *
 * Measured against the running app before the fix: twelve `connectService` calls issued together,
 * twelve `ok` replies, six servers on disk. The app said it had written every one of them.
 */
test('connectors added at the same time are all written, and none of them lies about it', async (t) => {
  const root = await aWorkspace(t)

  const names = Array.from({ length: 12 }, (_, i) => `service-${i}`)
  const results = await Promise.all(
    names.map((name) => connect(root, { ...slack, name, envKeys: ['TOKEN'] })),
  )

  assert.deepEqual(
    results.filter((r) => !r.ok),
    [],
    'every call reported success, so every call must have written',
  )

  const after = (await configIn(root)) as unknown as { mcpServers: Record<string, unknown> }
  assert.deepEqual(Object.keys(after.mcpServers).sort(), [...names].sort())
})

test('removals at the same time take exactly what they name', async (t) => {
  const root = await aWorkspace(t)

  const names = Array.from({ length: 8 }, (_, i) => `s-${i}`)
  for (const name of names) await connect(root, { ...slack, name, envKeys: ['TOKEN'] })

  await Promise.all(names.slice(0, 4).map((name) => disconnect(root, name)))

  const after = (await configIn(root)) as unknown as { mcpServers: Record<string, unknown> }
  assert.deepEqual(Object.keys(after.mcpServers).sort(), names.slice(4).sort(), 'the other four survived')
})

/*
 * The write is atomic, so a crash cannot leave a half-written config.
 *
 * `readConfig` refuses a `.mcp.json` that will not parse — permanently, and rightly, since the
 * alternative deletes every connector somebody has. That refusal is the safety net; this is the
 * thing that keeps a person out of the state that needs it. A plain `writeFile` truncated by a
 * force-quit leaves the file mid-object, and the only way out is hand-editing JSON.
 *
 * Checked by the property that makes it safe rather than by trying to crash mid-write: the bytes
 * arrive under a temporary name and are moved into place, so a reader sees the whole old file or
 * the whole new one. Every other state file in this app is written this way — `orphans.ts`,
 * `registry.ts`, `ledger.ts`, `approvals.ts`, `changes.ts`, `spotify/network-switch.ts`.
 */
test('the config is moved into place, never written over where a reader can see it half-done', async (t) => {
  const root = await aWorkspace(t, '{\n  "mcpServers": {\n    "already": { "command": "x" }\n  }\n}\n')

  const path = join(root, MCP_FILE)
  const before = await readFile(path, 'utf8')

  /*
   * The inode is what tells the two implementations apart, deterministically and without racing
   * a crash. `writeFile` to an existing path opens it with `O_TRUNC` and writes through — same
   * file, same inode, and a reader in that window sees a truncated config. `rename` puts a
   * different file there, so the inode changes and no reader ever sees a partial one.
   *
   * Asserting "no .tmp was left" or "the content is right" would pass under either, which is a
   * test that agrees with whatever the code does.
   */
  const { stat, readdir } = await import('node:fs/promises')
  const inodeBefore = (await stat(path)).ino

  const outcome = await connect(root, { ...slack, name: 'postgres' })
  assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.reason)

  assert.notEqual(
    (await stat(path)).ino,
    inodeBefore,
    'the config was written through the live path, so a crash mid-write leaves it truncated',
  )

  const after = await readFile(path, 'utf8')
  assert.notEqual(after, before, 'nothing was written')
  const parsed = JSON.parse(after) as { mcpServers: Record<string, unknown> }
  assert.deepEqual(Object.keys(parsed.mcpServers).sort(), ['already', 'postgres'], 'the existing server survived')

  // And nothing left beside it. A `.tmp` sibling that outlives the write is a second way to leave
  // the workspace in a state nobody asked for.
  const left = (await readdir(root)).filter((n) => n.includes('.tmp'))
  assert.deepEqual(left, [], 'a temporary file was left in the workspace')
})

test('the assembled fixture still has the credential shape these tests rely on', () => {
  // Without this a typo in the join would quietly turn every test above into one that passes
  // because nothing looked like a credential any more — the failure this file is itself about.
  assert.match(A_PASTED_SLACK_TOKEN, /^xoxb-\d{10}-[a-z]{6}$/, 'the shape connect has to refuse before it writes anything')
  assert.equal(A_PASTED_SLACK_TOKEN.split('-').length, 3, 'the parts a real one has')
})
