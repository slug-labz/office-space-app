/**
 * Is the approval gate actually in place?
 *
 * The gate is the one thing standing between an agent running unattended in `acceptEdits` and a
 * shell command nobody approved. It is **two shipped files**, and a person may edit either:
 *
 *     .claude/hooks/approval-gate.mjs    the process that blocks
 *     .claude/settings.json              the PreToolUse stanza that calls it
 *
 * ## Why this cannot be inferred from the approvals directory
 *
 * `approvals.ts` watches a directory for requests the hook writes. **No requests is exactly what
 * a working gate looks like when nobody has run a command yet** — and exactly what no gate at all
 * looks like, forever. From that directory alone the two are indistinguishable, and the safe
 * reading is the wrong one: an office that has never blocked anything looks identical to an
 * office that cannot.
 *
 * There is already a marker in the other direction — proof an Office Space is watching, so the
 * gate stands down for a plain terminal `claude` rather than hanging it for four minutes. The
 * reverse has never existed. Nothing tells the app the hook is there.
 *
 * ## Why absence is permanent, and correctly so
 *
 * `reconcile.ts` will not put either file back. Its rule, in its own words, is that *"a path we
 * gave it and that is now gone was taken away on purpose"* — `keptBecauseRemoved`, decided by
 * `.office-space/shipped.json`. That is **right** for a skill or an agent: somebody who removes
 * one should not find it returned tomorrow. Applied here it means a deleted hook is deleted for
 * good, silently, and nothing about that rule should change. What has to change is that the
 * office can say so.
 *
 * ## The six answers, and why `unreadable` is not one of the others
 *
 * `unreadable` is the state every surface in this app gets wrong first — the roster warned it
 * could not read the staff and then said "Nobody works here yet" underneath, on the one screen
 * whose job is showing who works here. So it is kept apart here at the predicate, where it
 * cannot be collapsed by a caller who was only thinking about the happy path. **We could not
 * look** is not **we looked and found nothing**, and for a safety gate the difference is the
 * whole point: one of them is a reason to go and check, and the other is a reason to stop.
 *
 * ## A switch above the stanza
 *
 * Both files can be exactly as shipped and the gate still never runs, because
 * `"disableAllHooks": true` turns hooks off without removing them. The settings reference says so
 * for any file but managed settings: it stops user, project, local and plugin hooks, and managed
 * hooks keep running. So the switch is read before the stanza, since it decides whether any
 * stanza runs.
 *
 * The office reads only `.claude/settings.json`. Of the levels that can set the key back, the
 * command line is not one for the office's own runs, because `buildArgs` passes no `--settings`.
 * That leaves `.claude/settings.local.json` and managed settings, which the office does not read,
 * so the sentence names them instead of guessing.
 *
 * ## A file Claude Code skips
 *
 * `.claude/settings.json` can parse and still be ignored. Claude Code's loader (2.1.266's `AHe`,
 * read from the installed binary) runs the settings schema on each user, project and local file,
 * and drops the whole file when the check fails. A top level that isn't an object always fails.
 * Nothing in such a file runs, so the office can tell that no gate comes from it. That answer is
 * `settings-skipped`: blocked, with the file's actual problem given as the reason.
 */

import { declaredIn } from './hooks.js'

/**
 * What a read of one file came back as.
 *
 * Three cases rather than `string | null`, because `null` would put *absent* and *unreadable*
 * behind one value at the boundary and this module's entire job is keeping them apart.
 */
export type FileRead =
  | { readonly state: 'present'; readonly text: string }
  | { readonly state: 'absent' }
  | { readonly state: 'unreadable'; readonly cause: string }

export type GateState =
  /** The stanza names the hook and the hook is there. */
  | { readonly state: 'wired' }
  /** Settings claim a gate and the file it names is not on disk. The most dangerous of these. */
  | { readonly state: 'hook-missing' }
  /**
   * Nothing in `.claude/settings.json` runs the hook before a shell command, whether or not the
   * file exists.
   *
   * Not "nothing calls the hook". A stanza matched on `Write|Edit` calls it on every write and
   * edit, and a `PostToolUse` stanza calls it after a shell command has already run: the hook never
   * reads which event it was called for. Both land here, because `callsTheHook` counts only
   * `PreToolUse` stanzas that could fire on `Bash`.
   */
  | { readonly state: 'not-wired' }
  /** We could not tell. Never rendered as any of the "no gate" answers. */
  | { readonly state: 'unreadable'; readonly cause: string }
  /**
   * `.claude/settings.json` sets `disableAllHooks` to `true`, which keeps the gate from running
   * whatever the stanza says. A gate wired in the user's or the local settings file is off too.
   */
  | { readonly state: 'hooks-off' }
  /**
   * Claude Code skips `.claude/settings.json` whole, so nothing in it runs, the gate included.
   * Unlike `unreadable`, the office can tell. `cause` completes the sentence "This workspace's
   * .claude/settings.json …".
   */
  | { readonly state: 'settings-skipped'; readonly cause: string }

/** The file the `PreToolUse` command has to name for the gate to be the one we shipped. */
const HOOK_FILE = 'approval-gate.mjs'

/**
 * Whether a stanza could actually fire on a shell command.
 *
 * Claude Code reads a `PreToolUse` matcher by the characters in it. One made only of ASCII
 * letters, digits, `_`, `-`, spaces, `,` and `|` is a list of exact tool names, split on `|` or
 * `,` with whitespace allowed around each, so `Read` gates reads and not `Bash`, and `Bash, Edit`
 * gates both. Anything else is a regular expression tested unanchored against the name, so `.*`,
 * `(Bash)` and `^Bas` all gate shell commands. Naming the hook file is therefore not enough — a
 * gate matched on `Read` is a gate that never fires on the thing it exists to hold, and reporting
 * that as wired is the panel saying somebody is protected when they are not.
 *
 * This read every matcher as a regular expression at first, which was wrong both ways: `Bas`
 * matched inside "Bash" and was called a gate though no tool has that name, and `Bash, Edit` was
 * called no gate.
 *
 * Those are the current rules. Comma lists and the whitespace around separators arrived in
 * v2.1.191, and hyphens joined the exact set in v2.1.195; before them a comma list never fired
 * and a hyphenated name was a regular expression. The office cannot see which `claude` will run,
 * and answering `cannot-tell` for every list that depends on it would put a standing warning on
 * the comma form the hooks reference uses in its own example.
 *
 * A matcher that is absent or `*` covers every tool. One this office cannot compile is
 * `cannot-tell`. The CLI never fires a hook whose matcher it cannot compile: 2.1.266 and 2.1.231
 * both catch the error, log "Invalid regex pattern in hook matcher" and match nothing. But the
 * office compiles with Electron's V8 and the CLI with Bun's JavaScriptCore, and engines disagree
 * about some syntax: `(?i:Bash)` throws on Node 22.16 and compiles in Electron 43. So a pattern
 * that fails here may run there. Unless another stanza settles it, `gateState` reports
 * `unreadable`. The `catch` below says why it stopped being a yes.
 */
function couldHoldACommand(matcher: string | null): 'yes' | 'no' | 'cannot-tell' {
  if (matcher === null || matcher.trim() === '' || matcher === '*') return 'yes'
  // Only ASCII letters, digits, `_`, `-`, spaces, `,` and `|`: exact tool names, not a pattern.
  if (/^[A-Za-z0-9_ ,|-]+$/.test(matcher)) {
    return matcher.split(/[|,]/).some((name) => name.trim() === 'Bash') ? 'yes' : 'no'
  }
  try {
    return new RegExp(matcher).test('Bash') ? 'yes' : 'no'
  } catch {
    /*
     * Not `yes`, which is what this returned first and is the collapse this module exists to
     * refuse.
     *
     * If the CLI can't compile the matcher either, the hook never runs. Mapping it to `yes` made
     * `wired`, and `wired` makes `gateLede` return `null`: **silence**, and silence on this surface
     * reads as "you are protected". It isn't a plain `no` either, because the CLI's engine may
     * compile what this one can't (see the doc above), and then the hook does run. That is *we
     * cannot tell whether this fires*, and `unreadable` is the answer that says so.
     */
    return 'cannot-tell'
  }
}

/**
 * Whether a parsed `settings.json` calls the gate on `PreToolUse`, in a way that can fire.
 *
 * Matched on the hook's **filename inside a `PreToolUse` command**, not on the exact command
 * string. The shipped stanza is `node "$CLAUDE_PROJECT_DIR/.claude/hooks/approval-gate.mjs"`,
 * and somebody who moved their workspace, quoted it differently or wrapped it in a shell is
 * still wired — asserting the whole string would report those people as ungated, which is a
 * false alarm on a warning that must never cry wolf.
 *
 * A match anywhere else in the file does not count. `PostToolUse` naming the same script is not
 * a gate: it runs after the command it was supposed to hold.
 *
 * Three conditions, and the last two were found by review after this began using the shared walk:
 * the walk hands over `matcher` and `unknownType`, and reading neither produced four ways to
 * report a gate that does not gate.
 *
 *     wired   matcher Read          — cannot fire on a shell command
 *     wired   matcher Write|Edit    — no Bash anywhere
 *     wired   type prompt           — not a command hook
 *     wired   type agent            — not a command hook
 *
 * One word edited in `settings.json` and the office reported a gate it did not have. Not a
 * regression — the version before the shared walk ignored both fields too — but this is where the
 * fields arrived, and a value received and discarded is the shape that hides things.
 */
function callsTheHook(settings: unknown): { readonly gates: boolean; readonly unreadableMatcher: string | null } {
  let unreadableMatcher: string | null = null

  for (const r of declaredIn(settings)) {
    // `declaredIn` has already decided the type: one that is present and is not `command` is not
    // a command hook, whatever it names.
    if (r.event !== 'PreToolUse' || !r.command.includes(HOOK_FILE) || r.unknownType !== null) continue

    const covers = couldHoldACommand(r.matcher)
    // One stanza that definitely gates settles it, whatever the others say. Knowing a gate is
    // there beats not being able to read a second one.
    if (covers === 'yes') return { gates: true, unreadableMatcher: null }
    if (covers === 'cannot-tell' && unreadableMatcher === null) unreadableMatcher = r.matcher
  }

  return { gates: false, unreadableMatcher }
}

/**
 * What a parsed settings object sets `disableAllHooks` to, or `undefined` when it does not set it.
 *
 * The raw value rather than a boolean: the key is a boolean, and any other value is one Claude
 * Code's schema rejects, which `gateState` answers differently from both. JSON has no `undefined`,
 * so that answer can only mean the key is not there. Only an object gets here: `gateState`
 * answers every other top level first.
 */
function disableAllHooksIn(settings: object): unknown {
  return (settings as { readonly disableAllHooks?: unknown }).disableAllHooks
}

/**
 * What a parsed JSON value is, in words, for a sentence that should not print the value.
 *
 * Printed whole, the review measured a 10,085-character cause from a 5,000-element list, and
 * `1e400` printed as `null`, because JSON.parse reads it as Infinity and JSON.stringify writes
 * that as null. The same shapes #246 names for permission rules.
 */
function shapeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'string') return 'a string'
  if (typeof value === 'number') return 'a number'
  if (typeof value === 'boolean') return String(value)
  return 'an object'
}

/**
 * What state the approval gate is in, given a read of each of its two halves.
 *
 * Pure, and both arguments are reads rather than paths, so the I/O and the judgement stay on
 * their own sides of the boundary this repo keeps — and so a test can put the six states in
 * front of it without a filesystem.
 */
export function gateState(settings: FileRead, hook: FileRead): GateState {
  // Either half unreadable and we cannot answer at all. Checked before anything else, because
  // every other branch below would otherwise return a confident answer from half the evidence —
  // and the confident wrong answer here is "no gate", which is the one that sends somebody
  // looking for a problem they may not have.
  if (settings.state === 'unreadable') return { state: 'unreadable', cause: settings.cause }
  if (hook.state === 'unreadable') return { state: 'unreadable', cause: hook.cause }

  if (settings.state === 'absent') return { state: 'not-wired' }

  let parsed: unknown
  try {
    parsed = JSON.parse(settings.text)
  } catch (err) {
    // Settings that will not parse is not settings without a stanza. The CLI will not read them
    // either, so the gate is not running — but *why* is a thing somebody can fix, and "not
    // wired" would send them to add a stanza to a file whose real problem is a comma.
    return { state: 'unreadable', cause: err instanceof Error ? err.message : String(err) }
  }

  /*
   * JSON, and not settings. Claude Code drops a file whose top level isn't an object (see the
   * module header), so nothing in it runs, the gate included. That is a definite "no gate",
   * answered before anything inside the file is looked for.
   */
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { state: 'settings-skipped', cause: `is JSON, but its top level is ${shapeOf(parsed)}, not an object` }
  }

  /*
   * Read before the stanza, because it decides whether any stanza runs. A file with no stanza, a
   * missing hook or an unreadable matcher has another answer without it, and the fix that answer
   * points to changes nothing while hooks are off.
   */
  const hooksSwitch = disableAllHooksIn(parsed)
  if (hooksSwitch === true) return { state: 'hooks-off' }

  const called = callsTheHook(parsed)
  if (!called.gates) {
    /*
     * A stanza that names the gate and whose matcher nothing can parse is not "no gate". It is a
     * gate we cannot read, which is the one answer this type has that neither cries wolf nor
     * says everything is fine.
     */
    if (called.unreadableMatcher !== null) {
      return {
        state: 'unreadable',
        cause: `a PreToolUse stanza names the gate with the matcher ${called.unreadableMatcher}, which is not a pattern this office can read`,
      }
    }
    return { state: 'not-wired' }
  }
  if (hook.state === 'absent') return { state: 'hook-missing' }
  /*
   * Last, so a rejected value never hides a definite "no gate" above it. It only stands between
   * this file and `wired`.
   *
   * The settings page ("Fix a broken settings file") files a value the schema rejects under
   * Settings Error, and says a `-p` run, which is how the office runs `claude`, skips the broken
   * file or values and carries on with the rest; `claude --help` says print mode ignores a
   * settings file that fails validation. So nothing coerces it. If the file is skipped, the gate
   * never loads; if only the value is, the gate runs. Which one happens to this key is not
   * written down, so the answer is `unreadable` rather than `wired`, and neither outcome makes
   * the answers above untrue.
   */
  if (hooksSwitch !== undefined && hooksSwitch !== false) {
    return {
      state: 'unreadable',
      cause: `.claude/settings.json sets disableAllHooks to ${shapeOf(hooksSwitch)} rather than true or false, which Claude Code rejects, and a -p run then skips either that value or the whole file`,
    }
  }
  return { state: 'wired' }
}

/**
 * One sentence for a person, in the office's own voice.
 *
 * Kept beside the predicate rather than in a view, because the distinction between the "no gate"
 * answers is the whole reason this module exists and a renderer reaching for a ternary
 * would collapse it back. Deliberately not a `warning` in the sense `CLAUDE.md` uses: the office
 * genuinely runs without standing orders, and it does **not** genuinely run as advertised
 * without this.
 */
export function gateLede(state: GateState): string | null {
  switch (state.state) {
    case 'wired':
      return null
    case 'hook-missing':
      return "This workspace's .claude/settings.json asks for the approval gate, and the hook it names is not there. Unless another settings file runs the gate, this office is never asked to approve a shell command before it runs."
    case 'not-wired':
      return "This workspace's .claude/settings.json does not run the approval gate before shell commands, and it is the only settings file the office checks. Unless another one does, this office is never asked to approve a shell command before it runs."
    case 'unreadable':
      return `The approval gate could not be checked, so whether commands are being approved is unknown: ${state.cause}`
    case 'hooks-off':
      return "This workspace's .claude/settings.json sets disableAllHooks to true. Unless .claude/settings.local.json sets it back to false, or your organization's managed settings turn hooks on or run the gate, that keeps the approval gate from running, and this office is never asked to approve a shell command before it runs."
    case 'settings-skipped':
      return `This workspace's .claude/settings.json ${state.cause}, so Claude Code skips the whole file. Unless another settings file runs the gate, this office is never asked to approve a shell command before it runs.`
  }
}

/**
 * What to do about it, in the sentence after `gateLede`'s.
 *
 * A switch for the same reason `gateLede` is one: a state added to `GateState` without a remedy
 * here fails to compile, where a ternary in a view would quietly hand it another state's.
 */
export function gateRemedy(state: GateState): string {
  switch (state.state) {
    case 'wired':
      // Never drawn: a working gate has no step.
      return ''
    case 'hooks-off':
      // Both files can be exactly as shipped, so pointing at them would send somebody to check
      // what is fine while the setting stays on. And `false` there only stops this file turning
      // hooks off; a local or managed setting can still keep them off.
      return 'Set disableAllHooks to false in .claude/settings.json to stop this file turning hooks off, though a local or managed setting can still keep them off. Deleting the line instead hands the choice to your own ~/.claude/settings.json.'
    case 'settings-skipped':
      // The gate's two files may be fine. It is the file around the stanza that Claude Code refused.
      return 'Claude Code uses a settings file only when its top level is an object, { … }, so fix .claude/settings.json. Until then none of it takes effect, the gate included.'
    case 'hook-missing':
    case 'not-wired':
    case 'unreadable':
      return 'The gate is two files: .claude/hooks/approval-gate.mjs, and the PreToolUse entry in .claude/settings.json that calls it. The office does not put either back on its own, because a file you removed is one you meant to remove.'
  }
}
