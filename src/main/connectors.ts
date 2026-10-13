/**
 * Writing a server into `.mcp.json`.
 *
 * The decisions are in `shared/connector.ts` — what may be written, and the rule that keeps a
 * credential out of the file. This is the write, and it has one job beyond putting bytes on disk:
 * **never lose what is already there.**
 *
 * ## Unreadable is not empty, on the writing side
 *
 * The fourth standing order is usually about reporting: a file you could not read is not an empty
 * file. On a write surface it is sharper than that. `.mcp.json` holds every connector somebody
 * has ever set up, and the obvious implementation — parse it, fall back to `{}` on failure, add
 * the new server, write it out — **deletes all of them** the one time the parse fails. A trailing
 * comma somebody left an hour ago becomes an empty config, silently, as a side effect of adding
 * something unrelated.
 *
 * So a config that exists and will not parse is a refusal, with the parse error in it. Absent is
 * the only case that starts from empty, because absent really is empty here: `.mcp.json` does not
 * exist until something writes one.
 *
 * ## And nothing else in the file is touched
 *
 * The object is read, one key is added under `mcpServers`, and it is written back. Any other
 * top-level key stays exactly where it was — this app did not put them there and does not know
 * what they are for.
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { declarationFor, whyNotConnectable, type ConnectRequest } from '../shared/connector.js'
import { serial } from './serial.js'

/**
 * One writer at a time.
 *
 * Both writes below are read-modify-write on one file, and each captures its view of it when it
 * reads. Two overlapping calls therefore raced on content exactly as the session registry did:
 * each read, each added its own server, each wrote a complete file — and the later write
 * contained no trace of the earlier one, **while both returned `ok`**.
 *
 * Measured: twelve `connectService` calls issued together, all twelve answering `ok`, six servers
 * on disk. The app said it had written every one of them.
 *
 * `serial()` chains the *starts*, so each read happens after the write before it has landed. Its
 * own header says why that is the fix rather than a lock: the hazard is not two writers in one
 * instant, it is a write that began before another finished and is working from state that has
 * since moved.
 */
const writes = serial()

/** Project scope. The file Claude Code reads for servers that belong to this workspace. */
export const MCP_FILE = '.mcp.json'

/** Why a write could not happen, or the names already in the file. */
type Existing =
  | { readonly ok: true; readonly config: Record<string, unknown>; readonly servers: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string }

async function readConfig(root: string): Promise<Existing> {
  let text: string
  try {
    text = await readFile(join(root, MCP_FILE), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // The one case where absent really is empty: the file does not exist until something makes it.
    if (code === 'ENOENT') return { ok: true, config: {}, servers: {} }
    return { ok: false, reason: `${MCP_FILE} could not be read — ${(error as Error).message}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    /*
     * The refusal that exists so a stray comma cannot cost somebody every connector they have.
     *
     * Falling back to `{}` here and writing would be a one-line implementation that passes every
     * test written against a workspace with a valid config, and destroys a real one.
     */
    return {
      ok: false,
      reason:
        `${MCP_FILE} is here and could not be parsed, so the office will not write over it — ` +
        `${(error as Error).message}. Fix the file and try again; nothing has been changed.`,
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: `${MCP_FILE} is not a JSON object, so the office will not write over it.` }
  }

  const config = parsed as Record<string, unknown>
  const servers = config['mcpServers']
  if (servers !== undefined && (typeof servers !== 'object' || servers === null || Array.isArray(servers))) {
    return { ok: false, reason: `${MCP_FILE} has an "mcpServers" that is not an object, so the office will not write over it.` }
  }

  return { ok: true, config, servers: (servers as Record<string, unknown>) ?? {} }
}

/**
 * Write the config the way every other state file in this app is written.
 *
 * Temp-then-rename. `orphans.ts`, `registry.ts`, `ledger.ts`, `approvals.ts`, `changes.ts` and
 * `spotify/network-switch.ts` all do this, and `network-switch.ts` names the others as the
 * pattern. `.mcp.json` was the one that did not — in the module whose whole stated job is never
 * to lose what is already there.
 *
 * A force-quit or a crash part-way through a plain `writeFile` leaves the file truncated
 * mid-object. `readConfig` above then refuses to touch it, permanently and by design, so every
 * connector the person ever configured is unreachable and the only way out is hand-editing JSON.
 * The refusal is right; arriving in a state that needs it is what this prevents.
 *
 * `rename` inside one directory is atomic on macOS and Linux: a reader sees the whole old file
 * or the whole new one, never half of either.
 */
let saveSeq = 0

async function writeConfig(root: string, next: unknown): Promise<void> {
  const path = join(root, MCP_FILE)
  const temp = `${path}.${process.pid}.${++saveSeq}.tmp`
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

/**
 * The servers this workspace's own `.mcp.json` declares, so a name clash is seen before the write.
 *
 * Returns `[]` for a config that will not parse, which looks like the fourth standing order being
 * broken and is not: the connector panel already says so by another route. `capabilities.ts:421`
 * surveys this same file at project scope, and `renderConnectors` draws every `unreadable` source
 * by name *above* the list, for exactly this reason. A second report from here would be the same
 * sentence twice.
 */
export async function projectServers(root: string): Promise<readonly string[]> {
  const existing = await readConfig(root)
  return existing.ok ? Object.keys(existing.servers) : []
}

/**
 * Add a server to the workspace's `.mcp.json`.
 *
 * Refuses to replace one that is already there. Two people's idea of `slack` landing on one key
 * means somebody's connector silently becomes somebody else's, and there is no way to notice
 * afterwards — the same reasoning as `hireFrom` refusing a name that is taken.
 */
export function connect(
  root: string,
  request: ConnectRequest,
): Promise<{ readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string }> {
  return writes(() => writeConnector(root, request))
}

async function writeConnector(
  root: string,
  request: ConnectRequest,
): Promise<{ readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string }> {
  const bad = whyNotConnectable(request)
  if (bad) return { ok: false, reason: bad }

  const existing = await readConfig(root)
  if (!existing.ok) return { ok: false, reason: existing.reason }

  const name = request.name.trim()
  if (name in existing.servers) {
    return {
      ok: false,
      reason: `${MCP_FILE} already declares a server called ${name}. Rename this one, or edit the existing entry.`,
    }
  }

  const next = {
    ...existing.config,
    mcpServers: { ...existing.servers, [name]: declarationFor(request) },
  }

  try {
    await writeConfig(root, next)
  } catch (error) {
    return { ok: false, reason: `${MCP_FILE} could not be written — ${(error as Error).message}` }
  }
  return { ok: true, path: MCP_FILE }
}

/**
 * Remove a server this workspace declares.
 *
 * Only from `.mcp.json`, and only a name that is in it. A server declared in `~/.claude.json` is
 * somebody's machine-wide setup — the survey reads it so the office can be honest about what the
 * staff can reach, and that is a long way from having a button that edits it.
 */
export function disconnect(
  root: string,
  name: string,
): Promise<{ readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string }> {
  return writes(() => removeConnector(root, name))
}

async function removeConnector(
  root: string,
  name: string,
): Promise<{ readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string }> {
  const existing = await readConfig(root)
  if (!existing.ok) return { ok: false, reason: existing.reason }
  if (!(name in existing.servers)) {
    return {
      ok: false,
      reason: `${MCP_FILE} does not declare ${name}. If the office can see it, it comes from somewhere else — your machine-wide config — and is not this workspace's to remove.`,
    }
  }

  const servers = { ...existing.servers }
  delete servers[name]
  const next = { ...existing.config, mcpServers: servers }

  try {
    await writeConfig(root, next)
  } catch (error) {
    return { ok: false, reason: `${MCP_FILE} could not be written — ${(error as Error).message}` }
  }
  return { ok: true, path: MCP_FILE }
}
