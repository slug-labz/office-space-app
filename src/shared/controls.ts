/**
 * The dials on the conversation.
 *
 * Which model answers, how hard it thinks, and what it may do without asking. Three settings
 * that a Claude Code user already has in their terminal and that this office, until now, simply
 * did not offer — the flags were plumbed through to the CLI and nothing ever set them.
 *
 * ## Why this is a shared module and not three string fields
 *
 * Every value here is passed to somebody else's binary as a command-line argument. A typo does
 * not fail here; it fails three layers down, as a process that exits non-zero with a message
 * about an unrecognised choice, at which point the office reports that the manager could not be
 * reached. So the valid sets live in one place, they are checked before they are spent, and the
 * check is a pure function with tests rather than a comment saying which values are allowed.
 *
 * The lists are taken from `claude --help` as it actually is, not from memory. When the CLI
 * gains a mode, this file is the one that has to learn about it — and `unknownControl` exists
 * so that a workspace carrying a setting from a *newer* CLI than the one installed degrades to
 * a named problem rather than a failed spawn.
 *
 * ## The rule these follow
 *
 * A control the user set is a control the office must actually use. Showing "opus" in a picker
 * while spawning the default model would be the third standing order broken in the smallest
 * possible way, so `argsFor` is the single place that turns these into flags and it is tested
 * against the exact strings the CLI expects.
 */

/**
 * Models offered in the picker.
 *
 * Aliases rather than pinned model names, deliberately: an alias resolves to the newest model
 * in its family, so an office that has been sitting on a shelf for six months still spawns
 * something current. A user who needs an exact build can still type one — see {@link isModel}.
 */
export const MODELS = ['default', 'opus', 'sonnet', 'haiku', 'fable'] as const
export type Model = (typeof MODELS)[number]

/**
 * How hard the model thinks before it answers.
 *
 * Straight from `--effort`. The distinction that matters when choosing: **effort is for work
 * that fails by not looking hard enough** — skipping a file, not verifying a claim — while a
 * bigger model is for work that fails by being confidently wrong with everything in front of
 * it. Raising effort on a model that already understood the problem buys nothing but latency.
 */
export const EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

/**
 * What the office may do without stopping to ask.
 *
 * These are the CLI's own modes, and the office does not invent a fifth. Two are worth knowing
 * apart from the rest:
 *
 * - `plan` — think it through and propose, change nothing. The mode you want before a large
 *   piece of work, and the one this app had no way to reach.
 * - `bypassPermissions` — ask for nothing at all. Offered because the CLI offers it and hiding
 *   it would not make it less available, but it is never the default and never chosen for the
 *   user.
 *
 * Note that none of this overrides the workspace trust gate. An untrusted workspace has its
 * permission rules ignored entirely, whatever is selected here — see `src/main/trust.ts`.
 */
export const PERMISSION_MODES = [
  'default',
  'plan',
  'manual',
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

/**
 * The two modes `--print` accepts and then silently ignores.
 *
 * Measured against the installed CLI rather than reasoned about: each value was passed as
 * `--permission-mode <x>` and the *effective* mode read back off the `init` event.
 *
 * | asked | reported |
 * |---|---|
 * | `default`, `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions` | themselves |
 * | **`manual`** | **`default`** |
 * | **`auto`** | **`default`** |
 *
 * The pattern is coherent rather than arbitrary: these are the two modes that need a human to
 * answer a prompt, and `--print` has nobody to ask. The CLI does not error — it accepts the flag
 * and quietly resolves it.
 *
 * Which is exactly why this list exists. Office Space always runs `--print`, so offering either
 * of these in a picker would be a control that reports a mode the session is not in. That is the
 * third standing order broken in the place the user is most likely to trust it, and it shipped
 * once already because the test asserted the CLI *accepted* each string and never asserted what
 * it *did* with one.
 */
export const IGNORED_UNDER_PRINT: readonly PermissionMode[] = ['manual', 'auto']

/**
 * The modes worth putting in front of somebody.
 *
 * `PERMISSION_MODES` stays the full set because it is the truth about the CLI, and a settings
 * file written by hand may legitimately name any of them. This is the subset that does anything
 * when we run it.
 */
export const OFFERED_PERMISSION_MODES: readonly PermissionMode[] = PERMISSION_MODES.filter(
  (m) => !IGNORED_UNDER_PRINT.includes(m),
)

/** Whether the CLI would accept this mode and then ignore it. */
export function isIgnoredUnderPrint(mode: PermissionMode): boolean {
  return IGNORED_UNDER_PRINT.includes(mode)
}

/**
 * The settings for one conversation.
 *
 * `'default'` everywhere means "say nothing to the CLI and let it decide", which is not the same
 * as naming the model the CLI happens to default to today. The office should not pin a choice
 * the user did not make.
 */
export interface Controls {
  readonly model: Model
  readonly effort: Effort
  readonly permissionMode: PermissionMode
}

export const DEFAULT_CONTROLS: Controls = {
  model: 'default',
  effort: 'default',
  permissionMode: 'default',
}

export function isModel(value: unknown): value is Model {
  return typeof value === 'string' && (MODELS as readonly string[]).includes(value)
}

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value)
}

/**
 * Read controls out of something that came off disk or across the IPC boundary.
 *
 * Never throws and never returns a partially-valid object. A field that is missing, misspelt,
 * or from a newer CLI falls back to the default *for that field only* — losing a whole
 * conversation's settings because one of three strings was unrecognised would be a worse
 * failure than quietly running at default effort.
 *
 * What was dropped is reported rather than swallowed, because the office's fourth standing
 * order is that absent is not empty: a user who set `effort: ultra` in a file should be told
 * the office ignored it, not left to wonder why nothing got slower.
 */
export function readControls(value: unknown): {
  controls: Controls
  unknown: readonly string[]
  /** Values the CLI **would** accept, and then ignores because we run `--print`. */
  ignored: readonly string[]
} {
  const raw = (value ?? {}) as Record<string, unknown>
  const dropped: string[] = []
  const inert: string[] = []

  const pick = <T extends string>(key: string, ok: (v: unknown) => v is T, fallback: T): T => {
    const v = raw[key]
    if (v === undefined || v === null) return fallback
    if (ok(v)) return v
    dropped.push(`${key}=${String(v)}`)
    return fallback
  }

  // Picked in the order the picker shows them, because `dropped` is read out to the user as a
  // sentence and it should name them left to right.
  const model = pick('model', isModel, DEFAULT_CONTROLS.model)
  const effort = pick('effort', isEffort, DEFAULT_CONTROLS.effort)
  const permissionMode = pick('permissionMode', isPermissionMode, DEFAULT_CONTROLS.permissionMode)

  return {
    controls: {
      model,
      effort,
      // Recognised, and inert. Kept out of `controls` rather than carried, because carrying it
      // would put the mode in the picker while the session runs `default` — which is the fault
      // this whole distinction exists to close.
      permissionMode: isIgnoredUnderPrint(permissionMode)
        ? DEFAULT_CONTROLS.permissionMode
        : permissionMode,
    },
    unknown: dropped,
    ignored: isIgnoredUnderPrint(permissionMode) ? [`permissionMode=${permissionMode}`] : inert,
  }
}

/**
 * The controls, as command-line arguments.
 *
 * The single place a control becomes a flag. `'default'` contributes nothing at all — not an
 * empty string, not the word "default", which the CLI would reject as an unrecognised choice.
 *
 * Kept here rather than in the spawn code so the mapping can be tested without spawning
 * anything, which matters because the failure mode is a process that dies on startup and
 * reports itself as "the manager could not be reached".
 */
export function argsFor(controls: Controls): readonly string[] {
  const args: string[] = []
  if (controls.model !== 'default') args.push('--model', controls.model)
  if (controls.effort !== 'default') args.push('--effort', controls.effort)
  // A mode the CLI accepts and ignores is not worth a flag. `readControls` should already have
  // reset it, so this is the belt to that braces — a caller constructing `Controls` by hand
  // must not be able to put a lie on the command line.
  if (controls.permissionMode !== 'default' && !isIgnoredUnderPrint(controls.permissionMode)) {
    args.push('--permission-mode', controls.permissionMode)
  }
  return args
}

/** Whether anything has been changed from the CLI's own defaults. Drives the UI's "modified" dot. */
export function isDefault(controls: Controls): boolean {
  return (
    controls.model === 'default' &&
    controls.effort === 'default' &&
    controls.permissionMode === 'default'
  )
}

/**
 * How to say a control in a sentence.
 *
 * The office reports which model answered, and "default" is not an answer to that question —
 * it is the absence of one. Callers that know what the CLI actually resolved should say that
 * instead; this is for the case where all we know is what we asked for.
 */
export function describe(controls: Controls): string {
  const parts: string[] = []
  if (controls.model !== 'default') parts.push(controls.model)
  if (controls.effort !== 'default') parts.push(`${controls.effort} effort`)
  if (controls.permissionMode !== 'default') parts.push(controls.permissionMode)
  return parts.length > 0 ? parts.join(' · ') : 'workspace default'
}
