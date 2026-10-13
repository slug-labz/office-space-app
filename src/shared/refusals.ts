/**
 * Nineteen refusals, said once.
 *
 * U6, from a real run: the workspace refused nineteen commands in a single turn and the
 * transcript printed nineteen red paragraphs, each one repeating the same two sentences and
 * each one carrying a whole command string. Verbatim:
 *
 * > Refused: Bash — <the whole command>. This workspace's rules do not permit it, so it did not
 * > run. Allowing it means a rule in .claude/settings.json.
 *
 * Nineteen times. Two failures, not one:
 *
 * 1. **It was unreadable.** The shape of the problem — *the rules refused a batch of commands* —
 *    was stated nineteen times and therefore not stated at all.
 * 2. **It never said what to do.** "Allowing it means a rule in .claude/settings.json" names a
 *    file and stops. It does not say which list, and it does not distinguish the two reasons a
 *    call gets refused, which need opposite responses.
 *
 * ## The failure a naive fix would have
 *
 * The obvious repair is "collapse them into one line saying 19 commands were refused", and that
 * is worse than the wall. The one thing a person needs out of this is **which command did not
 * run** — a count tells them a batch failed and hides every fact they could act on. So: one
 * block, the shape said once, and every distinct call still visible.
 *
 * ## Denied and unlisted are different problems
 *
 * `permissions.ts` already draws this line for the verify harness and `approvals.ts` draws it
 * for the gate, in these words:
 *
 * - **denied** — a `deny` rule says no. Not a decision anybody is invited to make; the office
 *   will not offer it. The way out is to change the rule.
 * - **unlisted** — nobody has decided. The way out is to add an `allow` rule.
 *
 * Telling somebody to add an `allow` rule for a command a `deny` rule refuses sends them to
 * write a rule that will not work, so the advice is split. Where the cause cannot be established
 * the notice says the cause-neutral thing rather than guessing — see `RefusalCause`.
 *
 * Pure: no DOM, no `node:` imports. The renderer draws what this returns, and the tests read
 * the same structure the renderer draws from.
 */


import { truncate } from './truncate.js'
/**
 * Why a call was refused.
 *
 * `unknown` is load-bearing and is the honest default. The CLI's own `permission_denials`
 * payload carries **no reason** — its schema is `tool_name`, `tool_use_id`, `tool_input` and
 * nothing else (checked against the installed binary's schema, not assumed) — so the cause is
 * established by the office judging the command against the workspace's own rules, and that is
 * possible only for a `Bash` call with a command string. Everything else arrives here as
 * `unknown` and gets advice that is true without knowing which of the two it was.
 *
 * So does every refusal judged while a settings file could not be used, because the rules that
 * were read are not all the rules that were written. The advice then names that file instead of a
 * rule to write — see `UnusableSettings`.
 */
export type RefusalCause = 'denied' | 'unlisted' | 'unknown'

/**
 * A settings file the office could not use when it judged a turn's refusals, and why.
 *
 * Carried beside the refusals rather than on each one, because it is a fact about the read they
 * were all judged against.
 */
export interface UnusableSettings {
  /** Relative to `.claude/`, as `readPolicy` names it. */
  readonly file: string
  /** What went wrong, in the reader's words. */
  readonly why: string | null
}

/**
 * A deny list the office read with an entry in it that is not a rule.
 *
 * Carried beside the refusals for the reason `UnusableSettings` is: it is a fact about the read
 * they were all judged against, not about any one of them.
 *
 * It is **not** an unusable file. The file was read, and the rules in it are in force — Claude
 * Code skips the same entry and keeps the rest. What it costs is the deny list, which is shorter
 * than what somebody wrote: `readPolicy` calls that read `incomplete`, and `triageAgainst` will
 * not decide from it. So the office refuses what the deny rules it read refuse and asks about
 * everything else, in every mode — which is what the advice below has to say, because the
 * `unlisted` and `unknown` lines promise the opposite.
 */
export interface ShortDenyList {
  /** Relative to `.claude/`, as `readPolicy` names it. */
  readonly file: string
  /** How many entries in its `permissions.deny` are not rules. */
  readonly entries: number
}

/** One refused call, as the office knows it. */
export interface Refusal {
  readonly tool: string
  /** What it was going to do — the command, the path. Never a paraphrase. */
  readonly detail: string | null
  readonly cause: RefusalCause
  /**
   * Where the rule that refused it is, for a `denied` call whose rules were read: the settings
   * files, relative to `.claude/`, holding a deny rule that covers it.
   */
  readonly deniedIn?: readonly string[]
}

/** One distinct call in the block, and how many times the turn tried it. */
export interface RefusalCall {
  readonly tool: string
  readonly detail: string | null
  readonly cause: RefusalCause
  /** True when `detail` was cut. The block says so rather than implying the string ended. */
  readonly truncated: boolean
  /**
   * How many times this exact call was refused in this turn.
   *
   * Kept rather than deduplicated away, because "it tried the same command eleven times" is the
   * single most useful thing in a wall of nineteen — it says the agent was looping, not working
   * through a list.
   */
  readonly times: number
}

/** One block, replacing a run of red paragraphs. */
export interface RefusalNotice {
  /** The shape of the problem, in one sentence. Never carries a command. */
  readonly headline: string
  /** Every distinct call, in the order the turn first tried it. */
  readonly calls: readonly RefusalCall[]
  /**
   * What to do, one line per cause present.
   *
   * Usually exactly one line, because a turn's refusals usually share a cause. Two lines when a
   * turn hit both, which is the case where a single line would have to be vague enough to be
   * useless.
   */
  readonly advice: readonly string[]
  /**
   * Whether the calls carry more than one cause.
   *
   * The renderer tags each call with its cause only when this is true — a column of identical
   * "unlisted" tags beside three commands is noise, and noise is the thing this module exists
   * to remove.
   */
  readonly mixed: boolean
}

/**
 * Where a command is cut.
 *
 * Long enough to identify any real command, short enough that eleven of them are a list rather
 * than a wall. A cut command is marked, never silently shortened: `approval-summary.ts` settled
 * that rule for the cards and it holds here for the same reason.
 */
export const MAX_COMMAND = 160

/** The order causes are advised in: the blocking one first, then the ones a rule can open. */
const CAUSE_ORDER: readonly RefusalCause[] = ['denied', 'unlisted', 'unknown']

/**
 * What to do about each cause, singular and plural.
 *
 * Written out rather than assembled from fragments because these are the sentences the person
 * actually acts on, and a sentence built by string concatenation is a sentence nobody read.
 *
 * `denied` is not here, because its sentence names a file — see `deniedAdvice`.
 */
const ADVICE: Readonly<Record<Exclude<RefusalCause, 'denied'>, { readonly one: string; readonly many: string }>> = {
  unlisted: {
    one:
      'Nothing in .claude/settings.json refuses this — nobody has allowed it either. Add it to ' +
      'permissions.allow there and it will run without asking.',
    many:
      'Nothing in .claude/settings.json refuses these — nobody has allowed them either. Add ' +
      'them to permissions.allow there and they will run without asking.',
  },
  unknown: {
    one: 'Allowing it means a rule in .claude/settings.json, under permissions.allow.',
    many: 'Allowing them means a rule in .claude/settings.json, under permissions.allow.',
  },
}

/**
 * A turn's refusals, as one block.
 *
 * `null` when nothing was refused, so the caller never has to decide whether to draw an empty
 * one — the same shape `planWarning` uses for the same reason.
 *
 * `unusable` is the settings files that could not be used when the causes were judged. When there
 * are any, the `unknown` advice names them instead of pointing at a rule — see `unusableAdvice`.
 *
 * `short` is the deny lists that were read with an entry in them that is not a rule. When there
 * are any, every line but `denied` says what that state does instead of promising a rule — see
 * `shortDenyAdvice`. `unusable` comes first where both are true: a file that could not be used at
 * all is the larger thing to fix, and the causes are all `unknown` in that case anyway.
 */
export function summariseRefusals(
  refusals: readonly Refusal[],
  unusable: readonly UnusableSettings[] = [],
  short: readonly ShortDenyList[] = [],
): RefusalNotice | null {
  if (refusals.length === 0) return null

  // First-seen order, not sorted. The order the turn tried things in is information — sorting
  // alphabetically would separate the three commands an agent tried in a row while retrying.
  const byCall = new Map<string, { call: RefusalCall; times: number }>()
  for (const refusal of refusals) {
    const { text, truncated } = cut(refusal.detail)
    const key = `${refusal.tool}\u0000${text}\u0000${refusal.cause}`
    const seen = byCall.get(key)
    if (seen) {
      seen.times += 1
      continue
    }
    byCall.set(key, {
      call: { tool: refusal.tool, detail: refusal.detail === null ? null : text, cause: refusal.cause, truncated, times: 1 },
      times: 1,
    })
  }

  const calls = [...byCall.values()].map(({ call, times }) => ({ ...call, times }))
  const causes = CAUSE_ORDER.filter((cause) => calls.some((c) => c.cause === cause))

  return {
    headline: headlineFor(refusals.length, calls.length),
    calls,
    // Singular advice when there is one call to act on, whatever the retry count: "add them to
    // permissions.allow" for one command tried eleven times is a sentence about the wrong thing.
    advice: causes.map((cause) => {
      const one = calls.filter((c) => c.cause === cause).length === 1
      if (cause === 'unknown' && unusable.length > 0) return unusableAdvice(unusable, one)
      // `denied` keeps its own line: a deny rule that was read refuses outright whatever else
      // the list holds, which is exactly what `triageAgainst` still does. The other two end in a
      // rule that would let the call run, and that is the promise a short deny list takes away.
      if (cause !== 'denied' && short.length > 0) return shortDenyAdvice(short, one)
      if (cause === 'denied') return deniedAdvice(whereDenied(refusals), one)
      return ADVICE[cause][one ? 'one' : 'many']
    }),
    mixed: causes.length > 1,
  }
}

/**
 * What to say in place of the `unknown` advice while a settings file could not be used.
 *
 * The `unknown` line points at a rule in `.claude/settings.json`, and so does the `unlisted` one.
 * Neither can be relied on while a file is set aside. Claude Code's settings page, read on
 * 2026-09-16, says a `-p` run "skips the broken file or values", so a rule added to a broken file
 * is not in force. And a file that will not parse may already hold the rule: measured on dev at
 * `e6fe5cb`, one that allowed `npm test` was told "nobody has allowed it either".
 *
 * So this says only what the office knows: which file, and why, and that it has not judged the
 * refusal. It makes no claim about what Claude Code did with the file. The office failing to read
 * it does not prove Claude Code did too: an error such as running out of file handles would be
 * this process's alone (inferred, not seen).
 */
function unusableAdvice(files: readonly UnusableSettings[], one: boolean): string {
  const named = files.map((f) => `.claude/${f.file}`).join(' or ')
  const said = one
    ? `The office could not use ${named}, so it will not work out why this was refused, or what would let it run, until it can.`
    : `The office could not use ${named}, so it will not work out why these were refused, or what would let them run, until it can.`
  // One reason follows the sentence that names its file. Several each say which file they are about.
  const why = files.flatMap((f) => (f.why === null ? [] : [files.length === 1 ? f.why : `.claude/${f.file}: ${f.why}`]))
  return [said, ...why.map(sentence)].join(' ')
}

/**
 * What to say in place of the `unlisted` and `unknown` advice while a deny list was read short.
 *
 * Both of those lines end in a rule that would let the call run — *"Add it to permissions.allow
 * there and it will run without asking"* — and while an entry in a deny list is not a rule that
 * is false twice over. Measured on dev `e6fe5cb` merged with #256 and #260, against a
 * `settings.json` allowing `Bash(npm test:*)` and denying `["Bash(rm:*)", 5]`: `npm test` was
 * already allowed there, so "nobody has allowed it either" was untrue, and `triageAgainst` asked
 * about it in all seven modes, so the rule that is already in the file does not make it run
 * without asking.
 *
 * So this says what that state does, in the words `policyProblem` uses for it on the panel, and
 * ends on the thing that actually clears it. It makes no claim about the entry's file being
 * unusable: it was used, and its rules are in force.
 */
function shortDenyAdvice(lists: readonly ShortDenyList[], one: boolean): string {
  const named = lists.map((l) => `.claude/${l.file}'s permissions.deny`).join(' and ')
  const entries = lists.reduce((total, l) => total + l.entries, 0)
  const single = entries === 1
  return (
    `${entries} ${single ? 'entry' : 'entries'} in ${named} ${single ? 'is not a rule' : 'are not rules'}, ` +
    'so the office refuses what the deny rules it read refuse and puts every other call it holds ' +
    `to a person. Until ${single ? 'that entry is a rule, or gone' : 'those entries are rules, or gone'}, ` +
    `${one ? 'an allow rule for it' : 'allow rules for them'} will not stop the asking.`
  )
}

/**
 * A reason, ended as a sentence. The reader's words are an error message, which usually stops
 * without a full stop — `Unexpected end of JSON input` — and ran straight into whatever followed.
 */
function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * What to do about a deny rule, which starts with the file it is in.
 *
 * Both settings files can hold deny rules and the office merges them, so the file travels on each
 * refusal from where the rules were read (`deniedIn`). This sentence used to name
 * `.claude/settings.json` whichever file it was, which sent anybody whose rule was in
 * `settings.local.json` to change a file that did not have one.
 *
 * `files` is `null` when a denied call does not say where its rule is. Then the sentence names both
 * files the rules are read from, which is true whichever it was.
 */
function deniedAdvice(files: readonly string[] | null, one: boolean): string {
  if (files === null) {
    return one
      ? 'A deny rule in .claude/settings.json or .claude/settings.local.json refuses this outright, so ' +
          'the office will never run it and will never offer to. Change or remove that rule if it ' +
          'should be allowed.'
      : 'A deny rule in .claude/settings.json or .claude/settings.local.json refuses these outright, ' +
          'so the office will never run them and will never offer to. Change or remove that rule if ' +
          'they should be allowed.'
  }

  const named = listed(files.map((file) => `.claude/${file}`))
  if (files.length === 1) {
    return one
      ? `A deny rule in ${named} refuses this outright, so the office will never run it and will ` +
          'never offer to. Change or remove that rule if it should be allowed.'
      : `A deny rule in ${named} refuses these outright, so the office will never run them and ` +
          'will never offer to. Change or remove that rule if they should be allowed.'
  }
  // More than one file: every one of those rules has to change before the call can run.
  return one
    ? `Deny rules in ${named} refuse this outright, so the office will never run it and will never ` +
        'offer to. Change or remove every one of them if it should be allowed.'
    : `Deny rules in ${named} refuse these outright, so the office will never run them and will ` +
        'never offer to. Change or remove those rules if they should be allowed.'
}

/**
 * The files the denied refusals name, in the order the turn met them.
 *
 * `null` unless every denied refusal names at least one: a sentence naming some of the files would
 * leave out the one a call without them was refused from. Only asked of a turn with a denied call in it.
 */
function whereDenied(refusals: readonly Refusal[]): readonly string[] | null {
  const files: string[] = []
  for (const refusal of refusals) {
    if (refusal.cause !== 'denied') continue
    if (!refusal.deniedIn?.length) return null
    for (const file of refusal.deniedIn) if (!files.includes(file)) files.push(file)
  }
  return files
}

/** `a`, `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The shape of the problem, once.
 *
 * A single refusal gets no count at all. "1 command was refused" is the tell of a summary
 * written for the many case and applied to the one, and it reads like a machine — the whole
 * point of collapsing the wall was that a person could read the result.
 */
function headlineFor(total: number, distinct: number): string {
  if (total === 1) return "Refused — this workspace's rules do not permit it, so it did not run."
  if (distinct === total) return `${total} tool calls were refused, so none of them ran.`
  return (
    `${total} tool calls were refused, so none of them ran — ` +
    `${distinct} distinct ${distinct === 1 ? 'command' : 'commands'}.`
  )
}

function cut(detail: string | null): { text: string; truncated: boolean } {
  if (detail === null) return { text: '', truncated: false }
  const trimmed = detail.trim()
  return trimmed.length <= MAX_COMMAND
    ? { text: trimmed, truncated: false }
    : { text: truncate(trimmed, MAX_COMMAND, ''), truncated: true }
}
