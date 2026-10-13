/**
 * What the staff can actually reach.
 *
 * The floor shows seven people and implies they can all do their jobs. Nothing on it has ever
 * checked. An employee's `tools:` list, the MCP servers this machine declares, and the
 * permission rules deciding whether any of it runs are three separate files nobody reads
 * together — and the gap between them is where an office quietly stops working. A tester with
 * no `Bash`. A server named in a config that was never installed. An allowlist a trust prompt
 * is discarding, so every VERIFY command comes back refused.
 *
 * This module reads all three and says what it found. It changes nothing and starts nothing.
 *
 * ## Three rules it is built around
 *
 * **Absent is not empty.** Every file here has three answers, not two: it is not there, it is
 * there and would not open, or we read it. A config we could not parse must never come back as
 * a workspace with no servers, because that reads as "nothing configured" when the truth is
 * "we do not know" — the fourth standing order, in the one module most tempted to break it.
 *
 * **Declared is not reachable.** Everything here is what the config *claims*. The office does
 * not start an MCP server to find out whether it answers: spawning a command that came out of
 * a settings file, unasked, is precisely what `permissions.ts` exists to refuse. And a
 * `.mcp.json` server stays inert until a person approves it in Claude Code, which is state this
 * scan does not read. So the type is named for a claim and the UI must say "configured", never
 * "connected".
 *
 * **Nothing that comes out of here may be a credential.** An MCP server config carries `env`
 * and `headers` blocks, and people put tokens in argument lists and URL query strings. Only key
 * names are read from `env` and `headers` — never a value. URLs are cut at the first `?`, and
 * credential-shaped arguments are replaced. That is not a guarantee about a token somebody
 * passed as a bare positional argument; it is a guarantee that this module never reads the
 * places credentials are actually kept.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { discoverWorkspace, type Employee, type Problem, type Workspace } from './workspace.js'
import { readPolicy } from './permissions.js'
import { workspaceTrust, type Trust } from './trust.js'

// ─────────────────────────────────────────────────────────────────────── types ──

/**
 * What one employee may use.
 *
 * `inherited` and `none` are the two states that must never be collapsed. An agent file with no
 * `tools:` key does not have an empty toolset — it inherits the default one, which is every
 * tool its parent has, including the ability to delegate. Rendering that as "no tools" would
 * show the most powerful employee in the building as the most restricted.
 */
export type ToolAccess =
  /** `tools:` names these, and only these. */
  | { readonly state: 'declared'; readonly tools: readonly string[] }
  /** `tools:` is present and names nothing. Genuinely no tools. */
  | { readonly state: 'none' }
  /** No `tools:` key at all. Inherits the default set. **Not** the same as `none`. */
  | { readonly state: 'inherited' }

export interface StaffCapability {
  readonly id: string
  readonly name: string
  readonly tools: ToolAccess
  readonly filePath: string
}

/** How a server is spoken to. `unknown` when the config says neither, rather than a guess. */
export type Transport = 'stdio' | 'http' | 'sse' | 'unknown'

/**
 * Where a server was declared.
 *
 * The same names Claude Code uses for its own config scopes, so somebody reading the office and
 * somebody running `claude mcp list` are looking at the same word for the same thing.
 */
export type McpScope = 'project' | 'local' | 'user'

/** A server this machine declares. Declared — not started, not answered. */
export interface McpServer {
  /** The identity. Tool names are `mcp__<name>__<tool>`, so this is what an agent list names. */
  readonly name: string
  readonly transport: Transport
  /** stdio: the executable. Null for everything else. */
  readonly command: string | null
  /** stdio: its arguments, with credential-shaped values replaced. */
  readonly args: readonly string[]
  /** http/sse: scheme, host and path. The query string is dropped — tokens live there. */
  readonly url: string | null
  /** Names only. The values are never read. */
  readonly envKeys: readonly string[]
  /** Names only. `Authorization` is a header name; its value is a credential. */
  readonly headerKeys: readonly string[]
  readonly scope: McpScope
  /** The file that declared it, so two servers with one name can be told apart. */
  readonly source: string
}

/** How one config file read. Three answers, never two. */
export type SourceRead =
  | { readonly state: 'ok'; readonly servers: number }
  /** Not there. A workspace that never configured MCP genuinely has none here. */
  | { readonly state: 'missing' }
  /** There, and unusable. **Not** zero servers. */
  | { readonly state: 'unreadable'; readonly cause: string }

export interface McpSource {
  readonly path: string
  readonly scope: McpScope
  readonly read: SourceRead
}

/**
 * Every server found, and every place looked.
 *
 * `sources` is the half that matters when `servers` is empty: an office that says "no MCP
 * servers" has to be able to show that it looked, and where.
 */
export interface McpSurvey {
  readonly servers: readonly McpServer[]
  readonly sources: readonly McpSource[]
}

/**
 * The permission policy, counted.
 *
 * `inForce` is the whole point of reporting trust alongside the counts. An untrusted workspace
 * has its `permissions.allow` ignored by Claude Code entirely, so "27 rules" on its own is a
 * number that means nothing is permitted. `harness.ts` makes the same call for the stricter
 * reason — it is about to run things, so it treats `unknown` as untrusted too. This is a
 * report, so it keeps the three states and says which one it saw.
 */
export interface PolicySummary {
  readonly allow: number
  readonly deny: number
  readonly trust: Trust
  /** Whether those allow rules are doing anything at all. Only ever true when trusted. */
  readonly inForce: boolean
}

export interface Capabilities {
  readonly root: string
  readonly staff: readonly StaffCapability[]
  readonly mcp: McpSurvey
  readonly permissions: PolicySummary
  /** What this scan could not read. Empty means clean; non-empty must reach the screen. */
  readonly problems: readonly Problem[]
  readonly scannedAt: string
}

// ──────────────────────────────────────────────────────────────────────── tools ──

/** Read one employee's declared tools. The `null` from discovery becomes a named state here. */
export function toolAccess(employee: Employee): ToolAccess {
  if (employee.tools === null) return { state: 'inherited' }
  if (employee.tools.length === 0) return { state: 'none' }
  return { state: 'declared', tools: employee.tools }
}

/**
 * Tools an employee names that no configured server provides.
 *
 * This is the "merely claimed" half: `mcp__foo__bar` in an agent's `tools:` list does nothing
 * unless something declares a server called `foo`.
 *
 * Kept as a function rather than a field on `Capabilities` because the answer is only as
 * complete as the sources scanned, and plugins and enterprise config can supply servers this
 * module never looks at. It says "no source we read declares this", which is worth showing and
 * is not the same as "this server does not exist". An employee whose tools are `inherited`
 * claims nothing specific, so claims nothing that can dangle.
 */
export function mcpToolsWithoutServer(
  staff: readonly StaffCapability[],
  servers: readonly McpServer[],
): readonly { readonly employee: string; readonly tool: string; readonly server: string }[] {
  const known = new Set(servers.map((s) => s.name))
  const dangling: { employee: string; tool: string; server: string }[] = []

  for (const member of staff) {
    if (member.tools.state !== 'declared') continue
    for (const tool of member.tools.tools) {
      const match = /^mcp__([^_]+(?:_[^_]+)*?)(?:__.*)?$/.exec(tool)
      const server = match?.[1]
      if (server !== undefined && !known.has(server)) {
        dangling.push({ employee: member.id, tool, server })
      }
    }
  }

  return dangling
}

/**
 * Built-in tools an employee names that this workspace will refuse.
 *
 * The sibling above is the "merely claimed" half for MCP. This is the same disease one layer
 * down, and it shipped: `WebFetch` and `WebSearch` were in the tools of five agents and in
 * neither `allow` nor `deny`, so both were **unlisted** — and under `--print` there is no human
 * to ask, so both were refused. The roster printed them under five names anyway.
 *
 * ## Why this is not just "is it in the allow list"
 *
 * Most built-in tools need no entry at all. Measured against the installed CLI in this
 * workspace: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Task`, `Skill` and `TodoWrite` all run
 * with nothing in `allow`; `Bash` is permitted per command; and only the two web tools are
 * refused outright when unlisted.
 *
 * That set belongs to Claude Code, not to us, and encoding it as a fixed list would be exactly
 * the fault this function exists to catch — two declarations that cannot see each other. So the
 * list below is **what has been measured**, and anything not on it and not allowed is reported
 * as *unknown* rather than as fine. A tool nobody has classified is a tool nobody has checked.
 */
const NEEDS_NO_ENTRY: ReadonlySet<string> = new Set([
  // Measured 2026-08-21: each ran with no matching entry in `permissions.allow`.
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Task', 'Skill', 'TodoWrite', 'NotebookEdit',
  // Permitted per command rather than wholesale, which `permissions` already models properly.
  'Bash',
])

export type ToolReach = 'allowed' | 'refused' | 'unknown'

export interface UnreachableTool {
  readonly employee: string
  readonly tool: string
  /** `refused` when we know it needs an entry and has none; `unknown` when nobody has checked. */
  readonly reach: ToolReach
}

/**
 * @param allow `permissions.allow` from `.claude/settings.json`, verbatim.
 */
export function toolsWithoutPermission(
  staff: readonly StaffCapability[],
  allow: readonly string[],
): readonly UnreachableTool[] {
  // An entry matches a tool bare (`WebFetch`) or with an argument pattern (`Bash(npm test:*)`).
  const permitted = (tool: string): boolean =>
    allow.some((entry) => entry === tool || entry.startsWith(`${tool}(`))

  const out: UnreachableTool[] = []
  for (const member of staff) {
    if (member.tools.state !== 'declared') continue
    for (const tool of member.tools.tools) {
      // MCP tools are the sibling's job, and they fail for a different reason.
      if (tool.startsWith('mcp__')) continue
      if (permitted(tool) || NEEDS_NO_ENTRY.has(tool)) continue
      out.push({ employee: member.id, tool, reach: 'unknown' })
    }
  }
  return out
}


// ────────────────────────────────────────────────────────────────────────── mcp ──

const REDACTED = '<redacted>'

/** Argument names people hang secrets off. Matched on the name half, never the value. */
const SECRETISH = /key|token|secret|password|passwd|credential|auth/i

/**
 * Strip credential-shaped values out of an argument list.
 *
 * Catches the two conventional shapes — `--api-key=sk-…` and `--api-key sk-…`. A token passed
 * as a bare positional argument is not detectable and is not claimed to be; the values this
 * module *guarantees* it never reads are the ones in `env`, `headers` and query strings.
 */
function scrubArgs(args: readonly string[]): string[] {
  const out: string[] = []
  let redactNext = false

  for (const arg of args) {
    if (redactNext) {
      out.push(REDACTED)
      redactNext = false
      continue
    }

    const eq = arg.indexOf('=')
    if (eq > 0 && SECRETISH.test(arg.slice(0, eq))) {
      out.push(`${arg.slice(0, eq)}=${REDACTED}`)
      continue
    }

    if (arg.startsWith('-') && SECRETISH.test(arg)) {
      out.push(arg)
      redactNext = true
      continue
    }

    out.push(arg)
  }

  return out
}

/** Scheme, host and path. Everything a query string or userinfo carries is dropped unread. */
function scrubUrl(raw: string): string {
  try {
    const url = new URL(raw)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    // Not a URL we can take apart, so we cannot tell which half is the secret. Cut at the
    // first delimiter and show no more than that.
    return raw.split(/[?#]/)[0] ?? ''
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function keysOf(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : []
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function transportOf(config: Record<string, unknown>): Transport {
  const declared = config['type']
  if (declared === 'stdio' || declared === 'http' || declared === 'sse') return declared
  // `claude mcp add` documents stdio as the default when no transport is given, and a config
  // with a `command` is a subprocess whatever it calls itself. A `url` with no `type` could be
  // either of the two remote transports, and guessing between them would be inventing a fact.
  return typeof config['command'] === 'string' ? 'stdio' : 'unknown'
}

/**
 * Read the `mcpServers` block out of already-parsed JSON.
 *
 * Malformed entries are reported rather than dropped — a server somebody meant to configure and
 * mistyped is exactly the thing this surface exists to show them.
 */
export function readMcpServers(
  block: unknown,
  scope: McpScope,
  source: string,
): { servers: McpServer[]; problems: Problem[] } {
  const servers: McpServer[] = []
  const problems: Problem[] = []

  if (!isRecord(block)) return { servers, problems }

  for (const name of Object.keys(block).sort()) {
    const config = block[name]
    if (!isRecord(config)) {
      problems.push({
        kind: 'lint',
        path: source,
        rule: 'mcp-server-malformed',
        detail: `\`${name}\` is not a server configuration, so nothing can connect to it.`,
      })
      continue
    }

    const command = config['command']
    const url = config['url']

    servers.push({
      name,
      transport: transportOf(config),
      command: typeof command === 'string' ? command : null,
      args: scrubArgs(stringsOf(config['args'])),
      url: typeof url === 'string' ? scrubUrl(url) : null,
      envKeys: keysOf(config['env']),
      headerKeys: keysOf(config['headers']),
      scope,
      source,
    })
  }

  return { servers, problems }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Read and parse one JSON config. The three states are kept apart all the way out. */
async function readJson(
  path: string,
): Promise<{ state: 'ok'; value: unknown } | { state: 'missing' } | { state: 'unreadable'; cause: string }> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
    return { state: 'unreadable', cause: describe(err) }
  }

  try {
    return { state: 'ok', value: JSON.parse(text) }
  } catch (err) {
    return { state: 'unreadable', cause: `not readable JSON: ${describe(err)}` }
  }
}

/**
 * Every file that can declare an MCP server for a workspace.
 *
 * Claude Code keeps them in more than one place and the office has to look in all of them,
 * because a survey that reads one file and reports "none configured" is wrong in the direction
 * that matters — it tells somebody their staff cannot reach something their staff can.
 *
 *   `.mcp.json`                    project scope; the file that gets committed
 *   `.claude/settings.*.json`      where a workspace may also carry a block
 *   `~/.claude.json`               user scope, plus this workspace's own local scope
 *
 * `home` is injectable so a test never reads the developer's real config.
 */
async function surveyMcp(root: string, home: string): Promise<{ survey: McpSurvey; problems: Problem[] }> {
  const servers: McpServer[] = []
  const sources: McpSource[] = []
  const problems: Problem[] = []

  const record = (path: string, scope: McpScope, read: SourceRead) => sources.push({ path, scope, read })

  const inWorkspace: readonly (readonly [string, McpScope])[] = [
    [join(root, '.mcp.json'), 'project'],
    [join(root, '.claude', 'settings.json'), 'project'],
    [join(root, '.claude', 'settings.local.json'), 'local'],
  ]

  for (const [path, scope] of inWorkspace) {
    const json = await readJson(path)
    if (json.state !== 'ok') {
      record(path, scope, json)
      if (json.state === 'unreadable') {
        problems.push({ kind: 'unreadable-file', path, cause: json.cause })
      }
      continue
    }

    const block = isRecord(json.value) ? json.value['mcpServers'] : undefined
    const found = readMcpServers(block, scope, path)
    servers.push(...found.servers)
    problems.push(...found.problems)
    record(path, scope, { state: 'ok', servers: found.servers.length })
  }

  // Claude Code's own config holds two scopes in one file: user-wide servers at the top level,
  // and this workspace's local ones under its project entry.
  const configPath = join(home, '.claude.json')
  const config = await readJson(configPath)

  if (config.state !== 'ok') {
    record(configPath, 'user', config)
    if (config.state === 'unreadable') {
      problems.push({ kind: 'unreadable-file', path: configPath, cause: config.cause })
    }
  } else {
    const top = isRecord(config.value) ? config.value : {}
    const user = readMcpServers(top['mcpServers'], 'user', configPath)
    servers.push(...user.servers)
    problems.push(...user.problems)
    record(configPath, 'user', { state: 'ok', servers: user.servers.length })

    const projects = top['projects']
    const entry = isRecord(projects) ? projects[root] : undefined
    const local = readMcpServers(isRecord(entry) ? entry['mcpServers'] : undefined, 'local', configPath)
    servers.push(...local.servers)
    problems.push(...local.problems)
    record(configPath, 'local', { state: 'ok', servers: local.servers.length })
  }

  // A name declared in two places is listed twice, with its source. Which one Claude Code
  // actually uses is a precedence question, and answering it from here would be a guess.
  servers.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source))

  return { survey: { servers, sources }, problems }
}

// ─────────────────────────────────────────────────────────────────── permissions ──

/** Count what the workspace declared, and say whether any of it is in force. */
export async function summarisePolicy(root: string, home: string): Promise<PolicySummary> {
  const policy = (await readPolicy(root)).policy
  const trust = await workspaceTrust(root, home)

  return {
    allow: policy.allow.length,
    deny: policy.deny.length,
    trust,
    inForce: trust.state === 'trusted',
  }
}

// ───────────────────────────────────────────────────────────────────────── scan ──

export interface CapabilityOptions {
  /** An existing scan, so the office does not walk `.claude/agents/` twice for one screen. */
  readonly workspace?: Workspace | undefined
  /** Where `~/.claude.json` lives. Injectable so tests never read the real one. */
  readonly home?: string | undefined
}

/**
 * The whole capability picture for a workspace.
 *
 * Never throws. Everything that went wrong is in `problems`, so the caller can render a floor
 * that is honest about what it could not see rather than one that looks confidently bare.
 */
export async function scanCapabilities(
  root: string,
  options: CapabilityOptions = {},
): Promise<Capabilities> {
  const workspace = options.workspace ?? (await discoverWorkspace(root))
  const home = options.home ?? homedir()

  const staff: StaffCapability[] = workspace.employees.map((e) => ({
    id: e.id,
    name: e.name,
    tools: toolAccess(e),
    filePath: e.filePath,
  }))

  const mcp = await surveyMcp(root, home)

  // Discovery's read failures are carried through, because without them an unreadable
  // `.claude/agents/` would arrive here as a workspace with no staff — which would render as a
  // building where nobody can do anything, rather than as a directory we could not open. Lint
  // findings are left behind: they are rule violations the roster already reports, not gaps in
  // what this scan managed to read.
  const inherited = workspace.problems.filter((p) => p.kind !== 'lint')

  return {
    root,
    staff,
    mcp: mcp.survey,
    permissions: await summarisePolicy(root, home),
    problems: [...inherited, ...mcp.problems],
    scannedAt: new Date().toISOString(),
  }
}
