/**
 * What the office is allowed to run without asking.
 *
 * The verify harness runs commands that come out of a markdown file — a file agents write. So
 * the question is not "can we run this", it is "who decided we could". Running whatever
 * `TASKS.md` happens to say would hand anything that can write a file a shell on your machine,
 * and an agent writing its own VERIFY condition is exactly that.
 *
 * The answer already exists and is already yours: `.claude/settings.json` is where this
 * workspace declares what the office may do without being asked. The harness runs a VERIFY
 * command automatically when that policy already permits it, and otherwise says so and waits
 * for a person. One policy, declared once, doing both jobs.
 *
 * ## The guard that matters more than the matching
 *
 * `npm test && rm -rf ~` begins with `npm test`. Any matcher that only looks at the start of a
 * command is a matcher that can be walked straight past, so a command carrying shell operators
 * is **never** automatically allowed, whatever it starts with. It is not refused — it is
 * unlisted, which means a person looks at it.
 *
 * The office is not a sandbox and this is not a security boundary in the sense of stopping a
 * determined attacker who already controls your agents. It is the difference between "the
 * office runs what you said it may" and "the office runs whatever it reads".
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Policy {
  readonly allow: readonly string[]
  readonly deny: readonly string[]
  /**
   * The file each deny rule was read from, relative to `.claude/`, index for index with `deny`.
   *
   * Only `readPolicy` knows it, and a policy written out by hand has none. Advice about a deny rule
   * needs it: the rules of both settings files are merged into `deny`, and "change that rule" is
   * no help without the file it is in. See `denyingFiles`.
   */
  readonly denyFrom?: readonly string[]
}

export type Verdict =
  /** The workspace already said yes to this. Safe to run unattended. */
  | { readonly state: 'allowed'; readonly rule: string }
  /** The workspace said no. Never run, and never offer to. */
  | { readonly state: 'denied'; readonly rule: string }
  /** Nobody has decided. Show it to a person and let them choose. */
  | { readonly state: 'unlisted' }

/**
 * Shell syntax that turns one command into several.
 *
 * Anything here means the command is not the thing the rule matched, so it cannot inherit that
 * rule's permission. This is load-bearing rather than belt-and-braces: `verify.ts` spawns with
 * `shell: true`, so a metacharacter that reaches the shell is interpreted by it.
 *
 * ## What it deliberately omits, and why that is not a hole
 *
 * `$'…'`, `${…}`, `~`, `*`, `{a,b}` and a bare `(` are all absent, and every one was checked
 * against a real shell rather than reasoned about — bash's quoting rules are exactly the place
 * where reasoning goes wrong.
 *
 * The interesting one is `$'\x3b'`, which is ANSI-C quoting for a semicolon and looks like a way
 * to smuggle a separator past this regex. It is not. The shell substitutes it **after** it has
 * finished splitting the line into commands, so the result is an argument rather than a
 * separator. Measured:
 *
 *     echo $'\x3brm -rf ./victim'   →  prints ";rm -rf ./victim", and ./victim still exists
 *
 * The same holds for the rest: `${VAR}` expands a variable and cannot run a program, and a glob
 * or a brace expansion produces arguments. The two constructs that *do* run a program —
 * `$(…)` and a backtick — are both caught above.
 */
const CHAINS = /[;&|`\n\r]|\$\(|>|</

export function chainsCommands(command: string): boolean {
  return CHAINS.test(command)
}

/** The command a `Bash(...)` rule covers, or null if the rule is about something else. */
function bashRule(rule: string): string | null {
  const match = /^Bash\((.*)\)$/s.exec(rule.trim())
  return match?.[1] ?? null
}

/**
 * Does one rule cover this command?
 *
 * `Bash(npm test:*)` covers `npm test` and anything that continues it as arguments.
 * `Bash(pwd)` covers exactly `pwd`. A rule of `Bash(*)` covers everything, which is a thing
 * somebody can write and is treated as meaning it.
 */
export function ruleCovers(rule: string, command: string): boolean {
  const inner = bashRule(rule)
  if (inner === null) return false

  const wanted = command.trim()
  if (inner === '*') return true

  if (inner.endsWith(':*')) {
    const prefix = inner.slice(0, -2).trim()
    if (!prefix) return false
    // `npm test` and `npm test --watch`, but not `npm testify`.
    return wanted === prefix || wanted.startsWith(`${prefix} `)
  }

  return wanted === inner.trim()
}

/**
 * Decide whether the office may run this on its own.
 *
 * Deny is checked first and wins outright: a rule that says never is not overridden by a rule
 * that says sometimes.
 */
export function judge(command: string, policy: Policy): Verdict {
  const wanted = command.trim()
  if (!wanted) return { state: 'unlisted' }

  for (const rule of policy.deny) {
    if (ruleCovers(rule, wanted)) return { state: 'denied', rule }
  }

  // A command that chains cannot inherit a rule matched on its first few words. It is not
  // refused — a person may well want to run it — but the office will not do it unasked.
  if (chainsCommands(wanted)) return { state: 'unlisted' }

  for (const rule of policy.allow) {
    if (ruleCovers(rule, wanted)) return { state: 'allowed', rule }
  }

  return { state: 'unlisted' }
}

/**
 * The settings files holding a deny rule that covers this command, in the order they are read.
 *
 * Every such file, not only the one holding the rule `judge` stops at: a command refused by a rule
 * in each file stays refused until both change, so naming one sends somebody to change a rule and
 * find nothing different. Empty when no deny rule covers the command, and when the policy does not
 * say where its rules came from.
 */
export function denyingFiles(command: string, policy: Policy): readonly string[] {
  const wanted = command.trim()
  if (!wanted) return []

  const files: string[] = []
  policy.deny.forEach((rule, i) => {
    const file = policy.denyFrom?.[i]
    if (file !== undefined && !files.includes(file) && ruleCovers(rule, wanted)) files.push(file)
  })
  return files
}

/** One of the files a policy is assembled from, and what happened when we opened it. */
export interface PolicySource {
  /** Relative to the workspace root, as a person would name it. */
  readonly file: string
  readonly state:
    /** Read and parsed. */
    | 'ok'
    /** Not there. A workspace need not have one, and not having one is not a failure. */
    | 'missing'
    /** There, and we could not use it. **Not** the same as missing — see below. */
    | 'unreadable'
  /** Why, when `unreadable`. */
  readonly cause?: string
  readonly allow: number
  readonly deny: number
  /**
   * Entries in a rule list that are not rules, when the file is `ok` and has any.
   *
   * They are in neither the counts above nor the policy. Claude Code removes them too and keeps the
   * rest of the file, so the rules that remain are the ones in force. See `rulesIn`.
   */
  readonly skipped?: readonly SkippedEntry[]
}

/** An entry in `permissions.allow` or `permissions.deny` that is not a string. */
export interface SkippedEntry {
  readonly list: 'allow' | 'deny'
  /** What it is, as `shapeOf` names it: `a number`, `an object`, `null`… */
  readonly shape: string
}

export interface PolicyRead {
  readonly policy: Policy
  /** Every file consulted, including the ones that were not there. */
  readonly sources: readonly PolicySource[]
  /**
   * True when the policy may be smaller than what was written: a file exists and could not be
   * used, or a deny list holds an entry that is not a rule.
   *
   * The second is a file that *was* used. It sets this because the deny list is the one whose
   * shortfall costs something: `triageAgainst` then refuses only what the deny rules it has
   * refuse, and puts every other call to a person, as it does when a file could not be read. An
   * allow entry that is not a rule can only leave the office less willing than what was written,
   * in any mode, so it is reported and nothing more.
   */
  readonly incomplete: boolean
}

/**
 * The files a workspace's permission rules come from, in the order Claude Code reads them.
 *
 * `settings.local.json` is the personal, uncommitted half — the one somebody adds their own
 * test command to. Reading only the shared file, as this module used to, reports fewer rules
 * than are actually in force.
 */
const POLICY_FILES = ['settings.json', 'settings.local.json'] as const

/**
 * Read a workspace's policy.
 *
 * A workspace with no settings has declared nothing, which means everything is unlisted and a
 * person is asked. That is the safe direction to fail in, and it is the only one: guessing that
 * something is permitted because a file would not open is how an office ends up running what
 * nobody agreed to.
 *
 * ## Why this reports rather than just returning rules
 *
 * The old version was one `try` around everything, returning an empty policy from its `catch`, so a
 * settings file with a trailing comma in it was **indistinguishable from a workspace that has
 * no settings at all**. Both produced zero rules, silently, and the office carried on as though
 * the user had declared nothing — when in fact they had declared plenty and a typo ate it.
 *
 * That is the fourth standing order broken in the module that decides what may run. And it is
 * made worse by the CLI, which does the same thing one layer down: `--help` states that under
 * `--print`, "settings files that fail validation are silently ignored (no error dialog is
 * shown)". So a malformed file produces no complaint from the CLI *and* produced none from us.
 * Nobody was going to find out except by wondering why nothing was allowed.
 *
 * Missing is now `missing`, broken is `unreadable`, and the difference is carried to whoever
 * asks.
 *
 * The same holds one level in. A deny list written as a string used to read as a file with no
 * deny rules, so in bypass mode `triage` allowed what it named. `rulesIn` says where that line is
 * drawn now.
 */
export async function readPolicy(root: string): Promise<PolicyRead> {
  const allow: string[] = []
  const deny: string[] = []
  const denyFrom: string[] = []
  const sources: PolicySource[] = []
  let incomplete = false

  for (const file of POLICY_FILES) {
    let text: string
    try {
      text = await readFile(join(root, '.claude', file), 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        sources.push({ file, state: 'missing', allow: 0, deny: 0 })
      } else {
        // There, and we could not open it. Permissions, a directory where a file should be, a
        // dangling symlink. Not the same as absent and not to be reported as such.
        incomplete = true
        sources.push({ file, state: 'unreadable', cause: String(err), allow: 0, deny: 0 })
      }
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      incomplete = true
      sources.push({ file, state: 'unreadable', cause: (err as Error).message, allow: 0, deny: 0 })
      continue
    }

    /*
     * JSON, and not a settings object.
     *
     * `null` parses. Reading rules off it threw, so this read rejected. Measured on 2026-09-16: an
     * office started on such a workspace reached `ready` and made no window in the 12 seconds it
     * was watched, because `checkPolicy` awaits this read before `createWindow()`.
     *
     * `true`, a number, a string or an array did not throw. They read as `ok` with no rules,
     * which is a workspace that declared nothing. Neither is what the file is: it exists, and none
     * of it can be used as rules, which is what `unreadable` means.
     */
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      incomplete = true
      const cause = `Its top level is ${shapeOf(parsed)}, not an object.`
      sources.push({ file, state: 'unreadable', cause, allow: 0, deny: 0 })
      continue
    }

    const found = rulesIn(parsed)
    if ('cause' in found) {
      incomplete = true
      sources.push({ file, state: 'unreadable', cause: found.cause, allow: 0, deny: 0 })
      continue
    }
    allow.push(...found.allow)
    deny.push(...found.deny)
    denyFrom.push(...found.deny.map(() => file))
    if (found.skipped.some((entry) => entry.list === 'deny')) incomplete = true
    sources.push({
      file,
      state: 'ok',
      allow: found.allow.length,
      deny: found.deny.length,
      ...(found.skipped.length > 0 ? { skipped: found.skipped } : {}),
    })
  }

  return { policy: { allow, deny, denyFrom }, sources, incomplete }
}

/** The lists Claude Code reads permission rules from. The office uses the first two. */
const RULE_LISTS = ['allow', 'deny', 'ask'] as const

type Found =
  | { readonly allow: string[]; readonly deny: string[]; readonly skipped: SkippedEntry[] }
  | { readonly cause: string }

/**
 * The rules one settings object declares, or why none of them can be used.
 *
 * ## Where the line is drawn, and why there
 *
 * It follows what Claude Code does with the same file, because the rules the office decides from
 * have to be the rules in force. Measured against Claude Code 2.1.266 on 2026-09-16, with
 * `claude doctor` and with `claude -p` in a scratch project:
 *
 * - **A list that is not an array, or `permissions` that is not an object, sets the whole file
 *   aside.** `claude doctor` reports "Expected array" or "Expected object". A valid deny rule in
 *   the same file was not in force beside a string `allow`, a string `ask` or a `null` `allow`,
 *   and neither was a deny list written as a string. So the file is `unreadable` here too, and
 *   contributes nothing. Keeping its well-formed rules would not be the cautious choice it looks
 *   like: the gate answers an allowed call with `allow`, so we would grant an allow rule that
 *   Claude Code had set aside.
 * - **An entry that is not a string is removed, and the rest of the file stays.** `claude doctor`
 *   reports "Non-string value in deny array was removed", and a valid deny beside such an entry
 *   still refused. So the file is `ok`, the entry is `skipped`, and `policyProblem` says so.
 *
 * `ask` is checked for its shape though the office does not use it, because its shape decides
 * whether Claude Code keeps the file. Its entries are not checked.
 *
 * ## What it does not catch
 *
 * - A wrong type anywhere else also sets the file aside in Claude Code (measured with a string
 *   `env`). It is not looked for here, so this reader keeps rules that Claude Code has dropped.
 * - A string that is not a well-formed rule, such as `Bash(rm`, is skipped by Claude Code with a
 *   warning. Here it matches no command, and nothing reports it.
 * - A misspelled key, such as `denny`, draws no warning from Claude Code, and none from us.
 */
function rulesIn(settings: object): Found {
  const permissions = (settings as { permissions?: unknown }).permissions
  if (permissions === undefined) return { allow: [], deny: [], skipped: [] }
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
    return { cause: `Its "permissions" is ${shapeOf(permissions)}, not an object.` }
  }

  const lists = permissions as Partial<Record<(typeof RULE_LISTS)[number], unknown>>
  for (const list of RULE_LISTS) {
    const value = lists[list]
    if (value !== undefined && !Array.isArray(value)) {
      return { cause: `Its "permissions.${list}" is ${shapeOf(value)}, not a list of rules.` }
    }
  }

  const skipped: SkippedEntry[] = []
  const rules = (list: 'allow' | 'deny'): string[] => {
    const value = lists[list]
    if (!Array.isArray(value)) return []
    return value.flatMap((entry: unknown) => {
      if (typeof entry === 'string') return [entry]
      skipped.push({ list, shape: shapeOf(entry) })
      return []
    })
  }
  const allow = rules('allow')
  const deny = rules('deny')
  return { allow, deny, skipped }
}

/**
 * How many allow rules the shared settings file adds to the policy.
 *
 * The number the untrusted-workspace warning quotes. `main.ts` used to count `permissions.allow`
 * itself, and disagreed with what is in force: entries that are not rules were counted, and so
 * was the allow list of a file Claude Code sets aside (found in review).
 */
export function shippedAllowRules(read: PolicyRead): number {
  // A file that is missing or set aside is recorded with no rules, so it counts none.
  return read.sources.find((source) => source.file === 'settings.json')?.allow ?? 0
}

/**
 * What to tell somebody whose settings file, or an entry in one, is being skipped.
 *
 * `null` when there is nothing wrong, so a caller never has to decide whether to show it.
 */
export function policyProblem(read: PolicyRead): string | null {
  const said = read.sources.flatMap((s) => {
    if (s.state === 'unreadable') {
      // "Read as settings", because a file that parsed and is not settings was read.
      return [
        `.claude/${s.file} exists but could not be read as settings, so its permission rules are ` +
          `not in force — this looks exactly like having none. ${s.cause ?? ''}`.trim(),
      ]
    }
    const skipped = s.skipped ?? []
    return skipped.length > 0 ? [skippedSentence(s.file, skipped)] : []
  })
  // What `incomplete` makes `triageAgainst` do, said once however many files it comes from.
  if (read.sources.some((s) => s.skipped?.some((entry) => entry.list === 'deny'))) {
    said.push(
      'Until that is fixed, the office refuses what the rules it could read refuse, and puts ' +
        'every other call it holds to a person.',
    )
  }
  return said.length > 0 ? said.join(' ') : null
}

/**
 * What to tell somebody whose file is in force with entries in it that are not rules.
 *
 * It must not say the file's rules are not in force. Claude Code keeps them, and so do we.
 */
function skippedSentence(file: string, skipped: readonly SkippedEntry[]): string {
  const said: string[] = []
  for (const list of ['allow', 'deny'] as const) {
    const shapes = skipped.filter((entry) => entry.list === list).map((entry) => entry.shape)
    if (shapes.length === 0) continue
    const one = shapes.length === 1
    const kinds = new Set(shapes)
    const what = `${!one && kinds.size === 1 ? 'each ' : ''}${listed([...kinds])}`
    const does = list === 'allow' ? 'allow' : 'refuse'
    const they = one ? 'it too, so it' : 'them too, so they'
    said.push(
      `${said.length === 0 ? `.claude/${file} was read, but` : 'In the same file,'} ` +
        `${shapes.length} ${one ? 'entry' : 'entries'} in its permissions.${list} ` +
        `${one ? 'is not a rule' : 'are not rules'} (${what}). ` +
        `Claude Code skips ${they} ${does}${one ? 's' : ''} nothing.`,
    )
  }
  return said.join(' ')
}

/** `a`, `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.slice(-1).join('')}`
}

/** What a parsed value is, in the words the sentences above use. `true` and `false` as is. */
function shapeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'object') return 'an object'
  if (typeof value === 'string') return 'a string'
  if (typeof value === 'number') return 'a number'
  return String(value)
}
