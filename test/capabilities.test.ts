/**
 * What the staff can actually reach.
 *
 * Two claims are checked here harder than anything else, because both are ways the office would
 * put a confident, wrong picture on screen.
 *
 * **An agent with no `tools:` key has not got no tools.** It inherits the default set — every
 * tool its parent has. Showing that employee as the one who can do least would be exactly
 * backwards, so `inherited` and `none` are separate states and are asserted to stay separate.
 *
 * **A config we could not read is not a workspace with no servers.** Every file this module
 * touches has three answers, and the middle one — there, and would not open — must never come
 * out looking like the first.
 *
 * The credential rules are checked here too, since "we only ever read key names" is the kind of
 * promise that is true until somebody adds a field.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  mcpToolsWithoutServer,
  readMcpServers,
  scanCapabilities,
  summarisePolicy,
  toolAccess,
  type StaffCapability,
} from '../src/main/capabilities.js'
import type { Employee } from '../src/main/workspace.js'

import { tempDir } from './temp-dir.js'

// ─────────────────────────────────────────────────────────────────── fixtures ──

/** A workspace root. `files` are written relative to it, directories created as needed. */
async function workspace(t: TestContext, files: Record<string, string> = {}): Promise<string> {
  const root = await tempDir(t, 'office-cap-')
  await mkdir(join(root, '.claude', 'agents'), { recursive: true })
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, body)
  }
  return root
}

/** A home directory holding a `.claude.json`, so no test reads the developer's own. */
async function home(t: TestContext, config?: unknown): Promise<string> {
  const dir = await tempDir(t, 'office-cap-home-')
  if (config !== undefined) await writeFile(join(dir, '.claude.json'), JSON.stringify(config))
  return dir
}

const agentFile = (fields: string) => `---\n${fields}\n---\n\nBody text.\n`

const employee = (over: Partial<Employee> = {}): Employee => ({
  id: 'reviewer',
  name: 'reviewer',
  description: 'Reviews code.',
  tools: ['Read', 'Grep'],
  model: null,
  filePath: '/tmp/reviewer.md',
  ...over,
})

const staffMember = (over: Partial<StaffCapability> = {}): StaffCapability => ({
  id: 'reviewer',
  name: 'reviewer',
  tools: { state: 'declared', tools: ['Read'] },
  filePath: '/tmp/reviewer.md',
  ...over,
})

const sourceFor = (
  capabilities: Awaited<ReturnType<typeof scanCapabilities>>,
  path: string,
) => capabilities.mcp.sources.find((s) => s.path.endsWith(path))

// ────────────────────────────────── no tools key means default, not none ──

test('an agent with no tools key inherits the default set — it does not have none', () => {
  assert.deepEqual(toolAccess(employee({ tools: null })), { state: 'inherited' })
})

test('an agent whose tools key names nothing genuinely has none', () => {
  assert.deepEqual(toolAccess(employee({ tools: [] })), { state: 'none' })
})

test('inherited and none are never the same value', () => {
  // The distinction the whole type exists for. Collapsing these shows the most powerful
  // employee in the building as the most restricted one.
  assert.notDeepEqual(toolAccess(employee({ tools: null })), toolAccess(employee({ tools: [] })))
})

test('a declared list is reported exactly as written', () => {
  assert.deepEqual(toolAccess(employee({ tools: ['Read', 'Bash'] })), {
    state: 'declared',
    tools: ['Read', 'Bash'],
  })
})

test('the distinction survives a real scan of a real directory', async (t) => {
  const root = await workspace(t, {
    '.claude/agents/manager.md': agentFile('name: manager\ndescription: Runs it.'),
    '.claude/agents/tester.md': agentFile('name: tester\ndescription: Tests.\ntools: Read, Bash'),
  })

  const capabilities = await scanCapabilities(root, { home: await home(t) })
  const byId = new Map(capabilities.staff.map((s) => [s.id, s]))

  assert.equal(byId.get('manager')?.tools.state, 'inherited')
  assert.equal(byId.get('tester')?.tools.state, 'declared')
})

// ────────────────────────────────────────────── absent / unreadable / present ──

test('a config file that is not there is missing, and is not a problem', async (t) => {
  const root = await workspace(t)

  const capabilities = await scanCapabilities(root, { home: await home(t) })

  assert.equal(sourceFor(capabilities, '.mcp.json')?.read.state, 'missing')
  assert.deepEqual(capabilities.problems, [], 'a workspace that configured nothing has failed at nothing')
})

test('a config file that is there and will not open is unreadable — NOT zero servers', async (t) => {
  const root = await workspace(t, { '.mcp.json': JSON.stringify({ mcpServers: { thing: { command: 'node' } } }) })
  const path = join(root, '.mcp.json')
  await chmod(path, 0o000)

  try {
    const capabilities = await scanCapabilities(root, { home: await home(t) })

    // Running as root defeats the permission bit; skip rather than assert something false.
    if (capabilities.mcp.servers.length > 0) return

    assert.equal(sourceFor(capabilities, '.mcp.json')?.read.state, 'unreadable')
    assert.equal(
      capabilities.problems.some((p) => p.kind === 'unreadable-file' && p.path === path),
      true,
      'the failure this module exists to avoid: unreadable rendered as nothing configured',
    )
  } finally {
    await chmod(path, 0o644)
  }
})

test('a config file that is not JSON is unreadable, and says so', async (t) => {
  const root = await workspace(t, { '.mcp.json': '{ not json' })

  const capabilities = await scanCapabilities(root, { home: await home(t) })
  const read = sourceFor(capabilities, '.mcp.json')?.read

  assert.equal(read?.state, 'unreadable')
  assert.match(read?.state === 'unreadable' ? read.cause : '', /not readable JSON/)
})

test('a config file we read is reported as read, with what it held', async (t) => {
  const root = await workspace(t, {
    '.mcp.json': JSON.stringify({ mcpServers: { alpha: { command: 'node' }, beta: { command: 'node' } } }),
  })

  const capabilities = await scanCapabilities(root, { home: await home(t) })

  assert.deepEqual(sourceFor(capabilities, '.mcp.json')?.read, { state: 'ok', servers: 2 })
})

test('every place looked is reported, so an empty answer can show its work', async (t) => {
  const capabilities = await scanCapabilities(await workspace(t), { home: await home(t) })

  assert.equal(capabilities.mcp.servers.length, 0)
  assert.equal(capabilities.mcp.sources.length > 0, true, 'saying "none" means nothing without saying where')
})

test('an unreadable agents directory reaches the caller rather than reading as no staff', async (t) => {
  const root = await workspace(t, { '.claude/agents/tester.md': agentFile('name: tester\ndescription: Tests.\ntools: Read') })
  const agents = join(root, '.claude', 'agents')
  await chmod(agents, 0o000)

  try {
    const capabilities = await scanCapabilities(root, { home: await home(t) })
    if (capabilities.staff.length > 0) return

    assert.equal(
      capabilities.problems.some((p) => p.kind === 'unreadable-dir'),
      true,
      'an empty staff list must never be the only thing said about a directory that would not open',
    )
  } finally {
    await chmod(agents, 0o755)
  }
})

test('a lint finding is left to the roster — this scan reports only what it could not read', async (t) => {
  // `tools:` omitted is a lint finding in discovery. It is not a failure to read anything, and
  // repeating it here would double it on screen.
  const root = await workspace(t, { '.claude/agents/tester.md': agentFile('name: tester\ndescription: Tests.') })

  const capabilities = await scanCapabilities(root, { home: await home(t) })

  assert.deepEqual(capabilities.problems, [])
})

// ────────────────────────────────────────────────────────── what a server says ──

test('name, transport and command come back for a stdio server', () => {
  const { servers } = readMcpServers(
    { files: { type: 'stdio', command: 'node', args: ['server.mjs'] } },
    'project',
    '/ws/.mcp.json',
  )

  assert.equal(servers.length, 1)
  assert.deepEqual(
    { name: servers[0]?.name, transport: servers[0]?.transport, command: servers[0]?.command, args: servers[0]?.args },
    { name: 'files', transport: 'stdio', command: 'node', args: ['server.mjs'] },
  )
})

test('a declared transport is believed; a command with none is stdio', () => {
  const { servers } = readMcpServers(
    { remote: { type: 'sse', url: 'https://example.test/sse' }, local: { command: 'node' } },
    'project',
    '/ws/.mcp.json',
  )

  assert.equal(servers.find((s) => s.name === 'remote')?.transport, 'sse')
  assert.equal(servers.find((s) => s.name === 'local')?.transport, 'stdio')
})

test('a url with no declared transport is unknown rather than guessed at', () => {
  const { servers } = readMcpServers({ remote: { url: 'https://example.test/mcp' } }, 'user', '/home/.claude.json')

  assert.equal(servers[0]?.transport, 'unknown', 'http and sse are both possible, so neither is claimed')
})

test('a malformed entry is reported, not quietly dropped', () => {
  const { servers, problems } = readMcpServers({ broken: 'npx some-server' }, 'project', '/ws/.mcp.json')

  assert.equal(servers.length, 0)
  assert.equal(problems[0]?.kind === 'lint' && problems[0].rule, 'mcp-server-malformed')
})

test('a config with no mcpServers block yields no servers and no complaint', () => {
  assert.deepEqual(readMcpServers(undefined, 'project', '/ws/.mcp.json'), { servers: [], problems: [] })
})

// ──────────────────────────────────────────────────────── nothing is a credential ──

test('an env block gives up its key names and never its values', () => {
  const { servers } = readMcpServers(
    { thing: { command: 'node', env: { API_TOKEN: 'sk-live-do-not-print-me', REGION: 'eu' } } },
    'project',
    '/ws/.mcp.json',
  )

  assert.deepEqual(servers[0]?.envKeys, ['API_TOKEN', 'REGION'])
  assert.equal(JSON.stringify(servers[0]).includes('sk-live-do-not-print-me'), false)
})

test('headers give up their names only — Authorization is a name, its value is the secret', () => {
  const { servers } = readMcpServers(
    { thing: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer hunter2' } } },
    'user',
    '/home/.claude.json',
  )

  assert.deepEqual(servers[0]?.headerKeys, ['Authorization'])
  assert.equal(JSON.stringify(servers[0]).includes('hunter2'), false)
})

test('a url is cut back to scheme, host and path, because tokens live in query strings', () => {
  const { servers } = readMcpServers(
    { thing: { type: 'http', url: 'https://user:pw@example.test/mcp?key=secret-value#frag' } },
    'user',
    '/home/.claude.json',
  )

  assert.equal(servers[0]?.url, 'https://example.test/mcp')
  assert.equal(JSON.stringify(servers[0]).includes('secret-value'), false)
})

test('credential-shaped arguments are replaced, in both conventional spellings', () => {
  const { servers } = readMcpServers(
    { thing: { command: 'npx', args: ['-y', 'a-server', '--api-key=sk-abc', '--token', 'tok-xyz', '/data'] } },
    'project',
    '/ws/.mcp.json',
  )

  assert.deepEqual(servers[0]?.args, ['-y', 'a-server', '--api-key=<redacted>', '--token', '<redacted>', '/data'])
})

// ────────────────────────────────────────────────────────────── where they come from ──

test('user-scope and workspace-local servers are both found, and say which they are', async (t) => {
  const root = await workspace(t, {
    '.claude/settings.local.json': JSON.stringify({ mcpServers: { fromSettings: { command: 'node' } } }),
  })
  const dir = await home(t, {
    mcpServers: { fromUser: { type: 'http', url: 'https://example.test/mcp' } },
    projects: { [root]: { mcpServers: { fromLocal: { command: 'node' } } } },
  })

  const capabilities = await scanCapabilities(root, { home: dir })
  const scopes = new Map(capabilities.mcp.servers.map((s) => [s.name, s.scope]))

  assert.deepEqual([...scopes.entries()].sort(), [
    ['fromLocal', 'local'],
    ['fromSettings', 'local'],
    ['fromUser', 'user'],
  ])
})

test('a workspace that is not the one recorded gets no other workspace\'s servers', async (t) => {
  const root = await workspace(t)
  const dir = await home(t, { projects: { '/somewhere/else': { mcpServers: { theirs: { command: 'node' } } } } })

  const capabilities = await scanCapabilities(root, { home: dir })

  assert.deepEqual(capabilities.mcp.servers, [])
})

// ────────────────────────────────────────────────────────────── the policy ──

test('the policy is counted, and is in force when the workspace is trusted', async (t) => {
  const root = await workspace(t, {
    '.claude/settings.json': JSON.stringify({
      permissions: { allow: ['Bash(npm test:*)', 'Bash(pwd)'], deny: ['Bash(rm:*)'] },
    }),
  })
  const dir = await home(t, { projects: { [root]: { hasTrustDialogAccepted: true } } })

  const summary = await summarisePolicy(root, dir)

  assert.equal(summary.allow, 2)
  assert.equal(summary.deny, 1)
  assert.equal(summary.trust.state, 'trusted')
  assert.equal(summary.inForce, true)
})

test('an untrusted workspace still declares its rules, and none of them are in force', async (t) => {
  // The number on its own is a lie: Claude Code is ignoring every one of them.
  const root = await workspace(t, {
    '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'] } }),
  })
  const dir = await home(t, { projects: { [root]: { hasTrustDialogAccepted: false } } })

  const summary = await summarisePolicy(root, dir)

  assert.equal(summary.allow, 1)
  assert.equal(summary.inForce, false)
})

test('trust we could not determine is not permission', async (t) => {
  const root = await workspace(t, {
    '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(pwd)'] } }),
  })

  const summary = await summarisePolicy(root, await home(t))

  assert.equal(summary.trust.state, 'unknown', 'a failed read is not evidence about somebody\'s machine')
  assert.equal(summary.inForce, false, 'and being unable to tell is still not a yes')
})

test('a workspace with no settings declares nothing rather than failing', async (t) => {
  const summary = await summarisePolicy(await workspace(t), await home(t))

  assert.deepEqual({ allow: summary.allow, deny: summary.deny }, { allow: 0, deny: 0 })
})

// ─────────────────────────────────────────────────── declared versus reachable ──

test('an MCP tool whose server nobody declares is a claim with nothing behind it', () => {
  const dangling = mcpToolsWithoutServer(
    [staffMember({ id: 'backend', tools: { state: 'declared', tools: ['Read', 'mcp__ledger__query'] } })],
    [],
  )

  assert.deepEqual(dangling, [{ employee: 'backend', tool: 'mcp__ledger__query', server: 'ledger' }])
})

test('a declared server clears its own tools, hyphens and all', () => {
  const servers = readMcpServers({ 'note-store': { command: 'node' } }, 'user', '/home/.claude.json').servers

  const dangling = mcpToolsWithoutServer(
    [staffMember({ tools: { state: 'declared', tools: ['mcp__note-store__search', 'mcp__note-store'] } })],
    servers,
  )

  assert.deepEqual(dangling, [])
})

test('an employee who inherits claims nothing specific, so nothing of theirs can dangle', () => {
  assert.deepEqual(mcpToolsWithoutServer([staffMember({ tools: { state: 'inherited' } })], []), [])
})

test('ordinary tools are not mistaken for MCP ones', () => {
  const dangling = mcpToolsWithoutServer(
    [staffMember({ tools: { state: 'declared', tools: ['Read', 'Write', 'Bash', 'WebFetch'] } })],
    [],
  )

  assert.deepEqual(dangling, [])
})

test('no credential survives anywhere in the survey, not just in the field it came from', () => {
  /*
   * The module's header states this as a guarantee: *"Nothing that comes out of here may be a
   * credential… Only key names are read from `env` and `headers` — never a value. URLs are cut at
   * the first `?`, and credential-shaped arguments are replaced."*
   *
   * The tests above check each field is right — `envKeys` equals these two names, `args` equals
   * this list. That is field-by-field, and the guarantee is about the whole object: a value could
   * be correct in the field it was read from and still be echoed into a problem message, a source
   * path, or a name. This serialises the entire result and looks for the secrets in it.
   *
   * ## The bare positional, which is deliberate
   *
   * The header is precise about what it does *not* promise: *"not a guarantee about a token
   * somebody passed as a bare positional argument; it is a guarantee that this module never reads
   * the places credentials are actually kept."* So a bare positional is asserted to survive —
   * pinning the documented limit, so that if scrubbing is ever widened to cover it the doc is
   * updated with it rather than left describing the old behaviour.
   *
   * ## What made this worth writing
   *
   * A first pass at this probe handed `readMcpServers` a whole `.mcp.json` instead of the
   * `mcpServers` block, so it parsed **zero** servers — and reported every secret as absent. Five
   * clean results from a function that had read nothing. The count assertion below is what stops
   * that shape passing for the wrong reason.
   */
  const SECRETS = {
    inEnvValue: 'SECRET-IN-ENV-VALUE',
    inHeaderValue: 'SECRET-IN-HEADER-VALUE',
    inQueryString: 'SECRET-IN-QUERY-STRING',
    afterAFlag: 'SECRET-AFTER-A-FLAG',
    inMalformedQuery: 'SECRET-IN-A-URL-THAT-DOES-NOT-PARSE',
  }

  const { servers, problems } = readMcpServers(
    {
      local: {
        command: 'node',
        args: ['server.js', '--token', SECRETS.afterAFlag, 'SECRET-AS-BARE-POSITIONAL'],
        env: { API_KEY: SECRETS.inEnvValue, PATH: '/usr/bin' },
      },
      remote: {
        type: 'http',
        url: `https://example.com/mcp?key=${SECRETS.inQueryString}#fragment`,
        headers: { Authorization: SECRETS.inHeaderValue },
      },
      // A URL `new URL()` cannot take apart, which is `scrubUrl`'s *other* branch. Mutating the
      // fallback away with only the well-formed case above changed nothing — the primary path
      // strips the query on its own, so the fallback had no cover at all.
      malformed: {
        type: 'http',
        // `example.com?…` with no scheme: `new URL()` throws on it, which is the only way into
        // the fallback. `not-a-url:::?…` does *not* — it parses, as `not-a-url://::` — so a first
        // attempt at this case went straight down the primary path and left the fallback
        // uncovered exactly as before.
        url: `example.com?key=${SECRETS.inMalformedQuery}`,
        headers: {},
      },
    },
    'project',
    '/w/.mcp.json',
  )

  assert.equal(servers.length, 3, 'nothing was parsed, so the assertions below prove nothing')

  const everything = JSON.stringify({ servers, problems })
  for (const [where, secret] of Object.entries(SECRETS)) {
    assert.ok(!everything.includes(secret), `the secret ${where} survived somewhere in the survey`)
  }

  // The documented limit, pinned rather than assumed.
  assert.ok(
    everything.includes('SECRET-AS-BARE-POSITIONAL'),
    'a bare positional is now scrubbed — good, and the header in capabilities.ts says it is not, ' +
      'so that paragraph needs updating with this change',
  )
})
