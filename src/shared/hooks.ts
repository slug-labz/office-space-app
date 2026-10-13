/**
 * What runs when the office does something, and where it came from.
 *
 * `VISION.md` §2 lists what a `.claude/` workspace is — *"agents, skills, hooks, commands, MCPs,
 * memory, projects, and a main instruction file."* Every item on that list has a surface: the
 * roster shows the staff, the shelf shows the skills, the connector panel shows the MCPs, the
 * memory panel shows what is remembered, the switcher shows the projects, the slash menu shows
 * the commands, and the first-run panel reports the instruction file. **Hooks had none.**
 *
 * That is not a symmetry complaint. This app writes an executable into every workspace it seeds
 * — `.claude/hooks/approval-gate.mjs` — and every `Bash` call made in that workspace passes
 * through it, including calls from a plain terminal `claude` that has never heard of Office
 * Space. The office puts a program in your workspace, wires it into your tool calls, and until
 * now said nothing about it anywhere.
 *
 * ## The subject is registration, not the directory
 *
 * Claude Code does not run a file because it is in `.claude/hooks/`. It runs the commands named
 * under `hooks` in a settings file. The two are separate facts and this module's whole job is
 * holding them apart, because **every interesting state is a disagreement between them**:
 *
 *   **Registered, and the file is there.** It runs. This is the only reassuring row.
 *
 *   **Registered, and the file is not there.** It runs and fails. For a `PreToolUse` gate that
 *   is the worst of the four: settings promise that something is checking, and nothing is.
 *
 *   **On disk, and nothing registers it.** A file, not a hook. This one is not hypothetical —
 *   it is this repository's own most expensive bug, four times over. `approval-gate.mjs` sat in
 *   `.claude/hooks/` for weeks beside 133 lines of `approvals.ts` waiting on it and a panel
 *   built to answer it, while `.claude/settings.json` shipped `"hooks": {}`. Nothing fired,
 *   nothing was ever written to the approvals directory, the suite stayed green throughout, and
 *   `CLAUDE.md` told every agent in the workspace that the gate "can refuse a tool call". It
 *   could not. `test/repo-health.test.ts` now fails if a hook in *this* repo is unregistered.
 *   Nothing tells a person the same thing about *their* workspace, which is what this is for.
 *
 *   **We could not tell.** A settings file that will not parse, a hooks directory that will not
 *   open. Kept apart at the type level so no caller can collapse it into one of the other three
 *   — the fourth standing order, on a surface whose entire subject is what is and is not running.
 *
 * ## Why the event is a string and not a union
 *
 * `PreToolUse`, `PostToolUse`, `SessionStart` and the rest are described in `describeEvent`, and
 * anything not on that list is carried through with its raw name and drawn as unrecognised. A
 * closed union would mean the day the CLI adds an event, a registration that genuinely fires
 * silently vanishes from the panel that exists to list what fires. A surface that omits a hook
 * because it did not recognise the word is the third standing order broken by a type.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Where a registration came from
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which settings file a hook was registered in.
 *
 * The same three `capabilities.ts` uses for MCP servers, and for the same reason: a hook
 * declared in `~/.claude/settings.json` fires on every tool call in this workspace, so a panel
 * that read only the committed project file would list "your hooks" while something else ran.
 */
export type SettingsScope = 'project' | 'local' | 'user'

/**
 * One settings file, and what came of consulting it.
 *
 * `unparsable` is separate from `unreadable` because they send a person to different places: one
 * is a permission or a disk, the other is a comma. And the CLI is silent about the second — its
 * own `--help` states that under `--print`, settings files that fail validation are "silently
 * ignored (no error dialog is shown)". So a typo disables every hook in the file and nothing
 * anywhere says so. `permissions.ts` found this first, in the module that decides what may run.
 */
export interface HookSource {
  readonly path: string
  readonly scope: SettingsScope
  readonly state: 'ok' | 'missing' | 'unreadable' | 'unparsable'
  /** Why, for the two failing states. `null` otherwise. */
  readonly cause: string | null
  /** How many registrations came out of it. Meaningful only when `ok`. */
  readonly registrations: number
}

// ─────────────────────────────────────────────────────────────────────────────
// A registration
// ─────────────────────────────────────────────────────────────────────────────

/** One `hooks.<Event>[].hooks[]` entry, as declared. Nothing here is inferred. */
export interface Registration {
  /** `PreToolUse`, or whatever the file said. Never normalised — see the header. */
  readonly event: string
  /**
   * The tool pattern this stanza matches, or `null` when it declares none.
   *
   * `null` is not `'*'`: one is a stanza that said nothing and one is a stanza that said
   * everything, and although the CLI treats them alike today, showing a person a `*` they did
   * not write is the panel putting words in the file's mouth.
   */
  readonly matcher: string | null
  /** The command line, verbatim. This is what actually runs. */
  readonly command: string
  /**
   * The `timeout`, in seconds, or `null` when none is declared.
   *
   * Worth carrying rather than dropping. A hook killed at its timeout writes nothing, and for
   * the approval gate "writes nothing" is a denial the person never saw asked — which is why
   * `repo-health.test.ts` asserts the registered timeout clears the gate's own longest wait.
   * Seconds here; the gate counts in milliseconds. The two have disagreed before.
   */
  readonly timeoutSeconds: number | null
  /**
   * The declared `type`, when it is not `command`.
   *
   * `null` for the ordinary case. Anything else is a kind of hook this app has never seen, and
   * it is listed as declared rather than dropped or guessed at.
   */
  readonly unknownType: string | null
  readonly scope: SettingsScope
  readonly path: string
}

// ─────────────────────────────────────────────────────────────────────────────
// A file in .claude/hooks/
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Who put this file here.
 *
 * Answered from `dist/shipped-hashes.json` — the manifest `reconcile.ts` already uses to decide
 * whether a workspace file is safe to replace — rather than from a hardcoded filename. Hardcoding
 * `approval-gate.mjs` would answer today's question and be wrong the first time the office ships
 * a second hook, and would say nothing at all about the one the user wrote.
 */
export type HookOrigin =
  /** Content matches a version we have shipped. The office put it here and nobody has typed in it. */
  | 'shipped'
  /** A path we ship, holding content we have never shipped. Ours to begin with, theirs now. */
  | 'shipped-edited'
  /** No version of this path has ever shipped. Somebody wrote it. */
  | 'yours'
  /** The manifest could not be read, so provenance is not known. Never shown as `yours`. */
  | 'unknown'

/** A file in `.claude/hooks/`. */
export interface HookFile {
  /** The basename — `approval-gate.mjs`. What a registration has to name for it to run. */
  readonly name: string
  readonly origin: HookOrigin
}

// ─────────────────────────────────────────────────────────────────────────────
// The join
// ─────────────────────────────────────────────────────────────────────────────

/** Whether the thing a registration names is actually there to be run. */
export type Wiring =
  /** The command names a file in `.claude/hooks/` and the file is there. */
  | { readonly state: 'wired'; readonly file: HookFile }
  /** The command names a file in `.claude/hooks/` and it is not there. It will fail when it fires. */
  | { readonly state: 'file-missing'; readonly name: string }
  /**
   * The command runs something that is not in `.claude/hooks/`.
   *
   * Not a fault. A hook may be `npx something`, a script elsewhere in the repo, or a line of
   * shell. We can see that it is registered and we cannot say whether what it names exists, so
   * we say the first and not the second.
   */
  | { readonly state: 'elsewhere' }
  /** `.claude/hooks/` would not open, so whether the file is there is unknown. */
  | { readonly state: 'unknown'; readonly cause: string }

export interface Hook {
  readonly registration: Registration
  readonly wiring: Wiring
}

export interface HooksReport {
  /** Everything registered, in the order the events are declared in `EVENTS`, then by file. */
  readonly hooks: readonly Hook[]
  /**
   * Files in `.claude/hooks/` that no registration names.
   *
   * The bug this repo has shipped four times. Empty when the directory could not be read — that
   * is `directoryProblem`, and an empty list under an unreadable directory would read as "you
   * have no unregistered hooks", which is a claim we are in no position to make.
   */
  readonly inert: readonly HookFile[]
  /** Every settings file consulted, including the ones that were not there. */
  readonly sources: readonly HookSource[]
  /** `.claude/hooks/` exists and would not open. Never drawn as "no hooks". */
  readonly directoryProblem: string | null
  /** True when a settings file exists and could not be used, so this report is short. */
  readonly incomplete: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * A registration as the file declares it, before anybody says which file it came from.
 *
 * `scope` and `path` are how a *panel* labels a row; they are not part of what the settings object
 * says. Splitting them off is what lets a caller that only wants to know whether something is
 * registered use the same walk without inventing a scope and a path for a value nothing reads.
 */
export type DeclaredRegistration = Omit<Registration, 'scope' | 'path'>

/**
 * The one walk of `settings.hooks`.
 *
 * There were two: this shape, and a yes/no in `gate.ts` asking whether `PreToolUse` names one
 * filename. Two traversals of one tree is two places for the tolerances to drift — and the
 * tolerances *are* the behaviour here, since nearly every branch below is about what to skip
 * rather than what to collect. The gate asks this and filters.
 */
export function declaredIn(settings: unknown): readonly DeclaredRegistration[] {
  if (!isRecord(settings)) return []
  const hooks = settings['hooks']
  if (!isRecord(hooks)) return []

  const out: DeclaredRegistration[] = []

  for (const [event, stanzas] of Object.entries(hooks)) {
    if (!Array.isArray(stanzas)) continue

    for (const stanza of stanzas) {
      if (!isRecord(stanza)) continue

      // A matcher that is present but empty is `null` here, not `''`. An empty string is what a
      // file says when somebody deleted the value, and it means the same as saying nothing.
      const rawMatcher = stanza['matcher']
      const matcher = typeof rawMatcher === 'string' && rawMatcher.trim() !== '' ? rawMatcher.trim() : null

      const list = stanza['hooks']
      if (!Array.isArray(list)) continue

      for (const entry of list) {
        if (!isRecord(entry)) continue
        const command = entry['command']
        // No command is not a hook. There is nothing to run and nothing to show a person; a row
        // with an empty command would be this panel inventing a hook the file did not declare.
        if (typeof command !== 'string' || command.trim() === '') continue

        const type = entry['type']
        const timeout = entry['timeout']

        out.push({
          event,
          matcher,
          command: command.trim(),
          // Guarded rather than cast: a `timeout` of `"300"` is a string in a field the CLI reads
          // as a number, and showing it as 300 seconds would hide a setting that is not in force.
          timeoutSeconds: typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : null,
          unknownType: typeof type === 'string' && type !== 'command' ? type : null,
        })
      }
    }
  }

  return out
}

/**
 * Every registration in one parsed settings object, labelled with the file it came from.
 *
 * Takes the parsed value rather than the text so the caller owns both failure modes — the file
 * that would not open and the file that would not parse — and this stays a function about shape.
 *
 * The tolerance lives in `declaredIn`, which is also what the approval gate asks, so the two
 * cannot come to answer differently about the same file.
 */
export function registrationsIn(
  settings: unknown,
  scope: SettingsScope,
  path: string,
): readonly Registration[] {
  return declaredIn(settings).map((r) => ({ ...r, scope, path }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Which file a command names
// ─────────────────────────────────────────────────────────────────────────────

/** The directory a workspace's own hooks live in, as it appears inside a command line. */
const HOOKS_PATH = /\.claude[/\\]hooks[/\\]([A-Za-z0-9._-]+)/

/**
 * The `.claude/hooks/` file this command runs, or `null` when it runs something else.
 *
 * Matched on the path inside the command rather than on the whole command string, for the reason
 * `gate.ts` gives about the same join: the shipped stanza is
 * `node "$CLAUDE_PROJECT_DIR/.claude/hooks/approval-gate.mjs"`, and somebody who moved their
 * workspace, quoted it differently or wrapped it in a shell is still running the same hook.
 * Asserting the exact string would report those people as running nothing.
 *
 * `onDisk` is the second chance, and it is what catches a registration that names a hook by a
 * bare filename or through a variable this function cannot expand. Order matters: the path form
 * is tried first, because it is the one that can tell us a file is **missing**, and a bare-name
 * fallback can only ever tell us something is present.
 */
export function fileNamedBy(command: string, onDisk: readonly string[]): string | null {
  const path = HOOKS_PATH.exec(command)
  if (path) return path[1] ?? null

  // Longest first: a command naming `gate-v2.mjs` should not match a file called `gate.mjs`
  // that happens to be a prefix of it.
  for (const name of [...onDisk].sort((a, b) => b.length - a.length)) {
    if (command.includes(name)) return name
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The events this app recognises, in the order a person meets them in a session.
 *
 * The order is the point: a panel sorted alphabetically puts `PostToolUse` above `PreToolUse`,
 * which is the one pair whose order carries meaning. Read top to bottom this is a session.
 */
export const EVENTS: readonly string[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'PreCompact',
  'SubagentStop',
  'Stop',
  'SessionEnd',
]

/**
 * When this event fires, in a sentence.
 *
 * `null` for anything not in `EVENTS`, which the panel draws as an unrecognised event rather
 * than hiding or guessing. The wording says *when*, because "what fires them" is the question a
 * person opening this panel is asking, and a name like `PreCompact` answers it for nobody.
 */
export function describeEvent(event: string): string | null {
  switch (event) {
    case 'SessionStart':
      return 'when a conversation starts or is resumed'
    case 'UserPromptSubmit':
      return 'when you send a message, before Claude sees it'
    case 'PreToolUse':
      return 'before a tool call runs, and the only place a hook can refuse one'
    case 'PostToolUse':
      return 'after a tool call has finished'
    case 'Notification':
      return 'when Claude Code raises a notification, such as waiting on you'
    case 'PreCompact':
      return 'before the conversation is compacted'
    case 'SubagentStop':
      return 'when a dispatched employee finishes'
    case 'Stop':
      return 'when the office finishes answering'
    case 'SessionEnd':
      return 'when a conversation ends'
    default:
      return null
  }
}

/**
 * What a matcher covers, in words.
 *
 * Only `PreToolUse` and `PostToolUse` match against tool names; on every other event a matcher
 * is not a thing the CLI consults, so a stanza carrying one is reporting a value that does
 * nothing. Said plainly rather than rendered as though it were in force — a matcher drawn beside
 * `SessionStart` would tell somebody their hook is narrower than it is.
 */
export function describeMatcher(event: string, matcher: string | null): string {
  // An event we do not recognise gets no claim about its matcher either. Saying "every time it
  // fires" one line under "an event this app does not recognise" is the panel being confident
  // about the second half of something it has just admitted it does not know the first half of.
  if (describeEvent(event) === null) {
    return matcher === null ? 'declares no matcher' : `declares the matcher ${matcher}`
  }

  const tooled = event === 'PreToolUse' || event === 'PostToolUse'

  if (!tooled) {
    return matcher === null ? 'every time it fires' : `declares a matcher (${matcher}), which this event does not use`
  }

  if (matcher === null || matcher === '*') return 'every tool'

  // Split rather than tested for a pipe: `Bash|` contains one and names one tool, and the old
  // form said "the Bash and  tools" about it. The noun is computed with the list for the same
  // reason — a hard-coded plural after a count reads "1 tools" the moment the count is 1.
  const tools = matcher.split('|').map((t) => t.trim()).filter(Boolean)
  if (tools.length === 0) return `declares the matcher ${matcher}`

  const noun = tools.length === 1 ? 'tool' : 'tools'
  return `the ${tools.join(' and ')} ${noun}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Building the report
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Join what is registered to what is on disk.
 *
 * Pure, and given reads rather than paths, so the I/O stays on the main side of the boundary
 * this repo keeps and a test can put an unreadable directory in front of it without one.
 *
 * `files` is `null` — not `[]` — when the directory could not be listed. That is the distinction
 * the whole module exists for, and making it a separate type rather than an empty array is what
 * stops a caller reaching this function with a mistake already made.
 */
export function buildReport(
  registrations: readonly Registration[],
  files: readonly HookFile[] | null,
  directoryProblem: string | null,
  sources: readonly HookSource[],
): HooksReport {
  const onDisk = files?.map((f) => f.name) ?? []
  const byName = new Map(files?.map((f) => [f.name, f]) ?? [])
  const named = new Set<string>()

  const hooks: Hook[] = registrations.map((registration) => {
    const name = fileNamedBy(registration.command, onDisk)
    if (name !== null) named.add(name)

    if (name === null) return { registration, wiring: { state: 'elsewhere' } as const }

    // Could not look. Reported as neither present nor missing, because the confident wrong answer
    // here is "your gate is gone" — which sends somebody hunting for a problem they may not have.
    if (files === null) {
      return {
        registration,
        wiring: { state: 'unknown', cause: directoryProblem ?? 'the hooks directory could not be read' } as const,
      }
    }

    const file = byName.get(name)
    return file
      ? { registration, wiring: { state: 'wired', file } as const }
      : { registration, wiring: { state: 'file-missing', name } as const }
  })

  const order = (event: string) => {
    const at = EVENTS.indexOf(event)
    // Unrecognised events last, so the session reads in order and the odd one out is where a
    // person will look for it rather than wedged between two they know.
    return at === -1 ? EVENTS.length : at
  }

  const sorted = [...hooks].sort(
    (a, b) =>
      order(a.registration.event) - order(b.registration.event) ||
      a.registration.event.localeCompare(b.registration.event) ||
      a.registration.command.localeCompare(b.registration.command),
  )

  return {
    hooks: sorted,
    // Empty when we could not look, and `directoryProblem` is what says so. See the field.
    inert: (files ?? []).filter((f) => !named.has(f.name)),
    sources,
    directoryProblem,
    incomplete: sources.some((s) => s.state === 'unreadable' || s.state === 'unparsable'),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// What the panel says above the list
// ─────────────────────────────────────────────────────────────────────────────

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`
}

/**
 * The sentence above the list.
 *
 * Six states, and the reason they are not collapsible is the fourth standing order on the one
 * surface whose subject is whether anything is running. In particular *"nothing runs here"* is
 * only ever said when we successfully looked in every place a hook can be declared and found
 * none — never because a file would not parse, and never because a directory would not open.
 */
export function hooksLede(report: HooksReport): string {
  const runs = report.hooks.length
  const broken = report.hooks.filter((h) => h.wiring.state === 'file-missing').length
  const unknown = report.hooks.filter((h) => h.wiring.state === 'unknown').length

  const parts: string[] = []

  if (runs === 0) {
    // The honest empty, and only reachable when every source was read. `incomplete` below turns
    // this sentence into a different one, because a workspace whose settings would not parse has
    // not been shown to run nothing — it has not been read.
    parts.push(report.incomplete ? 'Nothing could be read that registers a hook' : 'Nothing here runs on a hook')
  } else {
    // "registered", not "runs". Registration is the thing we read; whether it runs is what the
    // rows below qualify, and one of them may be a command whose file we could not even check.
    parts.push(`${plural(runs, 'hook is registered here', 'hooks are registered here')}`)
  }

  if (broken > 0) {
    // "it" rather than "1 of them" when there is only one hook at all — a count referring back to
    // a set of one reads as though something else were being counted.
    parts.push(
      broken === 1
        ? `${runs === 1 ? 'it names' : '1 of them names'} a file that is not there and will fail when it fires`
        : `${broken} of them name files that are not there and will fail when they fire`,
    )
  }

  if (unknown > 0) {
    parts.push(
      unknown === 1
        ? `${runs === 1 ? 'it could not be checked' : '1 of them could not be checked'}`
        : `${unknown} of them could not be checked`,
    )
  }

  if (report.inert.length > 0) {
    parts.push(
      report.inert.length === 1
        ? '1 file in .claude/hooks/ is never run'
        : `${report.inert.length} files in .claude/hooks/ are never run`,
    )
  }

  if (report.directoryProblem !== null) {
    parts.push('.claude/hooks/ could not be opened, so what is in it is unknown')
  }

  if (report.incomplete) {
    const bad = report.sources.filter((s) => s.state === 'unreadable' || s.state === 'unparsable').length
    parts.push(`${plural(bad, 'settings file could not be used', 'settings files could not be used')}, so there may be more`)
  }

  return parts.join(' · ')
}
