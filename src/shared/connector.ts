/**
 * Connecting a service to the office.
 *
 * VISION.md's sixth section: connectors should just work the way Claude Code's already do.
 * Claude Code has them all, so nothing needs reinventing — they need wiring into the frontend
 * properly.
 *
 * Half of that was already here. `main/capabilities.ts` reads `.mcp.json` and `~/.claude.json`,
 * names every server, and takes real care over the difference between a config that is absent and
 * one that would not open. What it could never do is **add** one — so the answer to "how do I
 * connect Slack" was still *"leave the office, edit a JSON file, come back"*, which is the thing
 * the sentence above is asking not to be true.
 *
 * ## The office does not take your token
 *
 * `capabilities.ts` is built on a guarantee it states in its own header: *"Nothing that comes out
 * of here may be a credential... it never reads the places credentials are actually kept."* A
 * form that adds a server is exactly where somebody would paste one, and a write surface can
 * break a read guarantee from the other side — the value would be in `.mcp.json`, which is a file
 * in the workspace, which is a file people commit.
 *
 * So the fields that would hold a secret hold **the name of an environment variable instead**,
 * and what gets written is `${THAT_NAME}` — the expansion `.mcp.json` already supports. The
 * office writes a reference to a secret and never the secret.
 *
 * The rule that makes this real is narrow on purpose: an environment variable name is
 * `^[A-Z][A-Z0-9_]*$`, capped in length. A token is mixed-case, or has a dash, or is far too
 * long — `ghp_...`, `sk-...`, `xoxb-...`, a JWT's dots. Refusing anything that is not shouting
 * snake case costs a person one rename and makes pasting a credential into this form fail rather
 * than succeed quietly.
 *
 * ## Writing it connects nothing
 *
 * The other half of `capabilities.ts`'s header: *"a `.mcp.json` server stays inert until a person
 * approves it in Claude Code... the UI must say 'configured', never 'connected'."* This form
 * writes configuration. It is not a login, it does not start anything, and it must not be
 * described as though it were — `whatWritingDoes` is that sentence, kept next to the rule it
 * comes from rather than typed into a template somewhere.
 */

/** The three ways Claude Code reaches an MCP server. */
export type Transport = 'stdio' | 'http' | 'sse'

/** One header, and the environment variable its value comes from. */
export interface HeaderFrom {
  readonly header: string
  readonly from: string
}

/** What a person fills in to connect something. */
export interface ConnectRequest {
  readonly name: string
  readonly transport: Transport
  /** stdio: the executable, and its arguments. */
  readonly command: string
  readonly args: readonly string[]
  /** http/sse: where it lives. */
  readonly url: string
  /** Environment variable names to pass through. Written as `${NAME}`, never a value. */
  readonly envKeys: readonly string[]
  /** Headers, each taking its value from an environment variable. Same rule. */
  readonly headers: readonly HeaderFrom[]
}

/** An environment variable name, and nothing that could be a pasted credential. */
const VARIABLE = /^[A-Z][A-Z0-9_]*$/
const VARIABLE_MAX = 64

/**
 * A server name that survives being turned into a tool name.
 *
 * Tools are `mcp__<name>__<tool>`, and `mcpToolsWithoutServer` splits them on exactly that. A
 * name containing `__` makes the split ambiguous, so a server called `my__thing` would be
 * looked up under `my` and reported as configured-but-missing for as long as it existed. Not a
 * style rule — the format has no room for it.
 */
const SERVER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

/** Query keys that carry credentials. `capabilities.ts` drops the query string for this reason. */
const SECRET_IN_QUERY = /(^|[?&])[^=&]*(token|key|secret|password|auth|sig|signature)[^=&]*=/i

/**
 * Whether a string is an environment variable name rather than a value somebody pasted.
 *
 * The narrowness is the point. This is the only thing standing between a person with a token on
 * their clipboard and a credential in a file they will commit.
 */
export function isVariableName(value: string): boolean {
  return value.length <= VARIABLE_MAX && VARIABLE.test(value)
}

/**
 * Why this cannot be written, in words for the person who typed it.
 *
 * Returns `null` when it can. Every branch names the field, because a form that says only
 * "invalid" makes somebody guess which of six boxes it meant.
 */
export function whyNotConnectable(request: ConnectRequest): string | null {
  const name = request.name.trim()
  if (!name) return 'Give the service a name — it is what an employee writes in their tools list.'
  if (!SERVER_NAME.test(name)) {
    return 'A name may use letters, digits, dashes and single underscores, and must start with a letter or digit.'
  }
  if (name.includes('__')) {
    return 'A name cannot contain a double underscore — tools are called mcp__name__tool, and it would split in the wrong place.'
  }

  if (request.transport === 'stdio') {
    if (!request.command.trim()) return 'Give the command that starts the server.'
  } else {
    const url = request.url.trim()
    if (!url) return 'Give the URL the server answers on.'
    if (!/^https?:\/\//i.test(url)) return 'The URL must start with http:// or https://.'
    if (SECRET_IN_QUERY.test(url)) {
      return 'That URL carries a credential in its query string. Put the secret in a header taken from an environment variable instead — a URL is logged, and the office will not write one that holds a key.'
    }
  }

  for (const key of request.envKeys) {
    if (!isVariableName(key)) return refusalFor(key, 'The environment variables field')
  }
  for (const { header, from } of request.headers) {
    if (!header.trim()) return 'A header needs a name.'
    if (!/^[A-Za-z0-9-]+$/.test(header.trim())) return `"${header}" is not a header name.`
    if (!isVariableName(from)) return refusalFor(from, `The value of the ${header.trim()} header`)
  }

  const seen = new Set<string>()
  for (const { header } of request.headers) {
    const lower = header.trim().toLowerCase()
    if (seen.has(lower)) return `The ${header.trim()} header is given twice.`
    seen.add(lower)
  }

  return null
}

/**
 * The sentence for a field that was given a value where a name belongs.
 *
 * The subject is a whole phrase rather than a noun to slot in, because "The environment variable
 * needs the NAME of an environment variable" is what the slotted version says out loud — seen in
 * the running app, in the message this function exists to make useful.
 *
 * It says *what to do*, not just what is wrong. Somebody who has just pasted a token is one
 * sentence away from either putting it in their environment or giving up and editing the JSON by
 * hand, and only one of those two ends with the secret out of the repository.
 */
function refusalFor(given: string, subject: string): string {
  return (
    `${subject} needs the NAME of an environment variable — SLACK_BOT_TOKEN, not the token itself. ` +
    `The office writes \${NAME} into .mcp.json and never the value, so the secret stays in your ` +
    `environment and out of anything you might commit. ` +
    (given.trim() ? `"${short(given)}" is not a variable name.` : 'This one is empty.')
  )
}

/** Never echo a whole pasted credential back onto the screen. */
function short(value: string): string {
  const trimmed = value.trim()
  return trimmed.length <= 12 ? trimmed : `${trimmed.slice(0, 6)}…`
}

/**
 * The object to write under this server's name in `.mcp.json`.
 *
 * Only the keys the transport actually uses — a stdio entry with an empty `url` is a config that
 * reads as two things at once, and `capabilities.ts` would have to guess which.
 */
export function declarationFor(request: ConnectRequest): Record<string, unknown> {
  const out: Record<string, unknown> = { type: request.transport }

  if (request.transport === 'stdio') {
    out['command'] = request.command.trim()
    if (request.args.length > 0) out['args'] = [...request.args]
  } else {
    out['url'] = request.url.trim()
  }

  if (request.envKeys.length > 0) {
    out['env'] = Object.fromEntries(request.envKeys.map((key) => [key, `\${${key}}`]))
  }
  if (request.headers.length > 0) {
    out['headers'] = Object.fromEntries(
      request.headers.map(({ header, from }) => [header.trim(), `\${${from}}`]),
    )
  }

  return out
}

/**
 * What writing it does, and what it does not.
 *
 * Kept here rather than in the panel's markup so it sits beside the rule it restates.
 * `capabilities.ts`: *"a `.mcp.json` server stays inert until a person approves it in Claude
 * Code... the UI must say 'configured', never 'connected'."* A form that said "Connected!" on a
 * successful write would be the third standing order broken by a past-tense verb.
 */
export function whatWritingDoes(name: string, path: string): string {
  return (
    `${name} is written into ${path}. Nothing is connected yet and nothing has been started — ` +
    `Claude Code asks you to approve a new server the first time it sees one, and until you do, ` +
    `the office will keep showing it as configured rather than connected.`
  )
}

/** The variables a person still has to set, so the panel can say them rather than imply them. */
export function variablesToSet(request: ConnectRequest): readonly string[] {
  return [...new Set([...request.envKeys, ...request.headers.map((h) => h.from)])].filter(isVariableName)
}

/**
 * The names in a field somebody typed a list into.
 *
 * Commas, spaces and newlines all separate, because all three are what people actually type and
 * guessing wrong turns `A, B` into one variable called `A, B` — which then fails validation with
 * a message about the wrong thing entirely.
 *
 * Case is left alone. Lowercasing a mistyped name would make `slack_token` pass as
 * `SLACK_TOKEN`, writing `${SLACK_TOKEN}` for a variable the person does not have set — a config
 * that looks right and never works. The rule is strict so the refusal can be specific.
 */
export function parseNames(text: string): readonly string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))]
}

/**
 * `Header=VARIABLE` pairs.
 *
 * Split on the **first** `=` only. Nothing here should contain a second one, but a header line
 * that did would otherwise be silently truncated, and a silently truncated credential reference
 * is a connector that fails with no clue why.
 */
export function parseHeaders(text: string): readonly HeaderFrom[] {
  const out: HeaderFrom[] = []
  for (const line of text.split(/[\n,]+/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const at = trimmed.indexOf('=')
    // No `=` at all still becomes an entry, with an empty source, so `whyNotConnectable` can say
    // which header is missing its variable. Dropping it would make the field silently ignore a
    // line somebody typed.
    if (at === -1) out.push({ header: trimmed, from: '' })
    else out.push({ header: trimmed.slice(0, at).trim(), from: trimmed.slice(at + 1).trim() })
  }
  return out
}
