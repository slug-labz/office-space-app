/**
 * Workspace discovery.
 *
 * The office floor is a reflection of the filesystem and nothing else. Drop a markdown file
 * into `.claude/agents/` and that employee is on the floor; delete it and they are gone. There
 * is no registry, no manifest, and no place in the frontend where an agent is named.
 *
 * One rule governs this whole module:
 *
 *   **A directory we could not read is not an empty directory.**
 *
 * If discovery cannot read something, that goes in `problems` and the caller is told. It never
 * degrades into "there are zero employees", because that would render an empty office — a
 * confident, wrong picture of a workspace that is actually full. That failure has cost more
 * than any other in the projects this one was built from, so it is encoded in the types here
 * rather than left to a convention someone has to remember.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { isDelegationTool } from '../shared/delegation.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A member of staff, discovered from a `.claude/agents/*.md` file. */
export interface Employee {
  /** Stable identity. The frontmatter `name`, falling back to the filename stem. */
  readonly id: string
  readonly name: string
  readonly description: string
  /**
   * Declared tools, or `null` when the file omits `tools` entirely.
   *
   * `null` is meaningfully different from `[]`: an agent with no `tools` key **inherits its
   * parent's tools**, which for an employee means inheriting the manager's ability to delegate.
   * That is the one misconfiguration that breaks the office's central rule, so we surface it
   * rather than normalising it away. See `lintEmployee`.
   */
  readonly tools: readonly string[] | null
  readonly model: string | null
  readonly filePath: string
}

/** A capability, discovered from `.claude/skills/<name>/SKILL.md`. */
export interface Skill {
  readonly id: string
  readonly name: string
  readonly description: string
  /**
   * Where it was read from.
   *
   * No reader: `skills.ts` derives the same path from `id` at both call sites that need it, so
   * this is a second source of truth for one location. Kept because the derivation would be the
   * thing to delete if these ever disagreed, and it is recorded here so the next person does not
   * have to find that out — but nothing should start reading it without removing the derivation
   * at the same time.
   */
  readonly filePath: string
}

/** Something discovery could not do. Never swallowed, never rendered as absence. */
export type Problem =
  | { readonly kind: 'unreadable-dir'; readonly path: string; readonly cause: string }
  | { readonly kind: 'unreadable-file'; readonly path: string; readonly cause: string }
  | { readonly kind: 'no-frontmatter'; readonly path: string }
  | { readonly kind: 'lint'; readonly path: string; readonly rule: string; readonly detail: string }

export interface Workspace {
  readonly root: string
  readonly employees: readonly Employee[]
  readonly skills: readonly Skill[]
  /** Empty means discovery was clean. Non-empty must be surfaced in the UI. */
  readonly problems: readonly Problem[]
  readonly scannedAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the leading `---` block of a markdown file.
 *
 * Deliberately a small YAML subset — `key: value`, one per line — because that is all agent and
 * skill frontmatter uses, and a real YAML dependency in the main process buys us nothing here.
 * Values may contain colons (descriptions routinely do), so we split on the *first* colon only.
 *
 * Returns `null` when there is no frontmatter block at all, which the caller reports as a
 * problem rather than treating as an empty record.
 */
export function parseFrontmatter(text: string): Record<string, string> | null {
  const normalised = text.replace(/^﻿/, '')
  if (!normalised.startsWith('---')) return null

  const end = normalised.indexOf('\n---', 3)
  if (end === -1) return null

  const block = normalised.slice(normalised.indexOf('\n', 3) + 1, end)
  const out: Record<string, string> = {}

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const colon = line.indexOf(':')
    if (colon === -1) continue

    const key = line.slice(0, colon).trim()
    if (!key) continue

    let value = line.slice(colon + 1).trim()
    // Strip one layer of matching quotes, if present.
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1)
      }
    }
    out[key] = value
  }

  return out
}

/** Split a comma-separated frontmatter list (`tools: Read, Write, Bash`). */
function parseList(value: string | undefined): string[] | null {
  if (value === undefined) return null
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// ─────────────────────────────────────────────────────────────────────────────
// Lint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Who runs this place, from the staff alone.
 *
 * By id if somebody is called `manager`, otherwise whoever declares the delegation tool — the
 * ability to dispatch is what makes an agent a manager, whatever the file is named. `null` on an
 * empty workspace, which the UI reports rather than papering over with a stand-in.
 *
 * Here rather than in `main.ts`, where it was, because the lint below needs the same answer and
 * had its own. `main.ts` said *whoever declares the delegation tool* and the lint said
 * `e.id === 'manager'`, so an office run by an agent called anything else flagged **its own
 * manager** with `only-manager-may-delegate` — a false problem, shown permanently in the panel
 * whose job is telling the truth, advising a fix that would stop the office working.
 *
 * That is the office's one answer to one question, in one place, and `main.ts` imports it.
 */
export function findManager(employees: readonly Employee[]): string | null {
  const named = employees.find((e) => e.id === MANAGER_ID)
  if (named) return named.id
  return employees.find((e) => e.tools?.some(isDelegationTool))?.id ?? null
}

/** The name a manager has unless the workspace says otherwise. */
const MANAGER_ID = 'manager'

/**
 * Lint the whole staff.
 *
 * The set rather than one at a time, because *only the manager may delegate* is a rule about who
 * the manager is, and that cannot be known from a single file. Discovery used to call
 * `lintEmployee` inside the loop that read them, so the rule was evaluated before the answer
 * existed and fell back to the name.
 */
export function lintStaff(employees: readonly Employee[]): Problem[] {
  const manager = findManager(employees)
  const problems = employees.flatMap((e) => lintEmployee(e, manager))

  /*
   * Nobody designated, and more than one candidate.
   *
   * `findManager` falls back to whoever declares the delegation tool, and with two of them it
   * takes the first — deterministic, because discovery sorts by filename, and arbitrary all the
   * same. The per-file rule then reports the *other* one as though it were a rogue employee:
   *
   *     boss + sneaky, neither named manager  →  "sneaky.md violates only-manager-may-delegate"
   *
   * Which reads as one agent overstepping. The actual condition is that two can dispatch and
   * neither was designated, and renaming the files moves which one is blamed. A person who fixes
   * the reported file ends up with `boss` running the office having never been told; a person who
   * meant `sneaky` to run it is being advised to disable the one they wanted.
   *
   * The name-based rule this replaced flagged both, which was wrong for a lone delegator — the
   * bug this module was changed for — and right here, because it made the ambiguity visible.
   * This is that half, kept, as a finding about the set rather than about a file.
   */
  /*
   * Nobody can dispatch at all.
   *
   * The louder half of the same question, and it was the silent one. An office with five agents
   * and no delegator among them reports nothing, looks fully staffed, and throws
   * `no manager agent found in …/.claude/agents` the first time anybody sends a message.
   *
   * `employees.length > 0` because an empty workspace is not a misconfiguration — it is a fresh
   * clone, and the composer already says *"Nobody works here yet — hire somebody to get
   * started"*. A workspace with staff and no manager gets no such sentence anywhere, which is
   * what makes it worth a finding: it is the one shape that looks correct and cannot run.
   */
  if (employees.length > 0 && manager === null) {
    problems.push({
      kind: 'lint',
      // The directory, not `employees[0]`. This is a fact about the set, and blaming whichever
      // file sorts first gives the reader a name with no reason attached — unlike
      // `no-designated-manager` below, which points at the agent the office actually chose.
      path: dirname(employees[0]!.filePath),
      rule: 'no-manager',
      detail:
        `${employees.length === 1 ? 'The one agent on the floor does' : `All ${employees.length} agents on the floor do`} ` +
        `not declare the delegation tool, so there is nobody to dispatch work. Name one ` +
        `${MANAGER_ID}, or give one the delegation tool — until then the office cannot start a ` +
        'conversation.',
    })
  }

  /*
   * A manager who cannot dispatch.
   *
   * The third member of this family and the most reachable: `findManager` matches on the **name**
   * and never looks at tools, so an agent called `manager` with an explicit list that omits the
   * delegation tool is returned as the manager. `openSession` succeeds, the panel is clean, and
   * every dispatch fails.
   *
   *     no delegator at all         cannot run          reported above
   *     2+ delegators, none named   runs, arbitrary     reported below
   *     named manager, no Task      starts, then fails  this
   *
   * The other two need a hand-edited `.claude/agents/`. This one comes out of the hire form: name
   * an agent `manager`, give it a tool list without the delegation tool, and the office looks
   * correct until the first thing it is asked to delegate.
   *
   * `tools: null` is not this. An omitted key inherits everything *including* delegation, which
   * is the distinction `employee-must-declare-tools` already turns on — so only an explicit list
   * that leaves it out is a finding.
   */
  const inCharge = manager === null ? undefined : employees.find((e) => e.id === manager)
  if (inCharge && inCharge.tools !== null && !inCharge.tools.some(isDelegationTool)) {
    problems.push({
      kind: 'lint',
      path: inCharge.filePath,
      rule: 'manager-cannot-delegate',
      detail:
        `${inCharge.id} runs this office and its tool list does not include the delegation tool, ` +
        'so every dispatch will fail. Add it, or remove the `tools:` key to inherit everything.',
    })
  }

  const delegators = employees.filter((e) => e.tools?.some(isDelegationTool))
  const named = employees.some((e) => e.id === MANAGER_ID)
  // `manager !== null` is unreachable here and kept as a belt: `delegators` filters on the same
  // predicate `findManager` searches with, so more than one delegator guarantees it found one.
  // Said rather than left, so the next reader does not have to work out whether it guards
  // anything — it does not, and it costs nothing.
  if (!named && delegators.length > 1 && manager !== null) {
    problems.push({
      kind: 'lint',
      path: employees.find((e) => e.id === manager)?.filePath ?? MANAGER_ID,
      rule: 'no-designated-manager',
      detail:
        `${delegators.length} agents declare the delegation tool and none is called ` +
        `${MANAGER_ID}, so the office is using ${manager} — chosen by filename order rather than ` +
        `by anybody saying so. Rename ${manager} to ${MANAGER_ID}, or take the tool off the ` +
        // `the 1 that should not have it` at exactly two delegators, which is the common case —
        // this rule needs more than one and two is the smallest more-than-one there is.
        `${delegators.length - 1 === 1 ? 'one that should not have it' : `${delegators.length - 1} that should not have it`}.`,
    })
  }

  return problems
}

/**
 * Check an employee against the office's structural rules.
 *
 * Only the manager may delegate. An employee that omits `tools` silently inherits the parent's
 * toolset — including delegation — so an omitted key is a real finding, not a style nit.
 *
 * One employee, against a manager the caller already knows.
 *
 * `manager` is required, and that is the point rather than an inconvenience. It defaulted to
 * `MANAGER_ID`, which answers *who is the manager* from a name — the exact logic this change
 * exists to delete, reinstated by anybody who omits the argument. It was not hypothetical: four
 * tests in `workspace.test.ts` called the one-argument form and so asserted the old semantics
 * while sitting in the file documenting the new ones.
 *
 * `lintStaff` is the only production caller. The cost of requiring it is four test lines; the
 * cost of the default was a silent way back to the bug with no type error to stop it.
 */
export function lintEmployee(e: Employee, manager: string | null): Problem[] {
  const problems: Problem[] = []
  const isManager = e.id === manager

  if (e.tools === null && !isManager) {
    problems.push({
      kind: 'lint',
      path: e.filePath,
      rule: 'employee-must-declare-tools',
      detail:
        'No `tools:` key. An agent without an explicit tool list inherits its parent\'s tools, ' +
        'including delegation. List tools explicitly.',
    })
  }

  if (!isManager && e.tools?.some(isDelegationTool)) {
    const found = e.tools.filter(isDelegationTool).join(', ')
    problems.push({
      kind: 'lint',
      path: e.filePath,
      rule: 'only-manager-may-delegate',
      detail: `Declares the delegation tool (${found}). Only the manager may dispatch work.`,
    })
  }

  if (!e.description.trim()) {
    problems.push({
      kind: 'lint',
      path: e.filePath,
      rule: 'description-required',
      detail: 'No description. The manager chooses who to dispatch from this text.',
    })
  }

  return problems
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery
// ─────────────────────────────────────────────────────────────────────────────

const CLAUDE_DIR = '.claude'
/** Where a workspace keeps its work. Watched for *entries*, not contents — see `watchWorkspace`. */
const PROJECTS_DIR = 'projects'
const AGENTS_DIR = 'agents'
const SKILLS_DIR = 'skills'
const COMMANDS_DIR = 'commands'

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * List a directory.
 *
 * Distinguishes the three cases that must never collapse into one:
 *   - `missing`  — the directory does not exist. Legitimately zero entries (a fresh workspace).
 *   - `ok`       — read successfully.
 *   - `error`    — it exists but we could not read it. NOT zero entries.
 */
async function listDir(
  path: string,
): Promise<{ state: 'ok'; entries: string[] } | { state: 'missing' } | { state: 'error'; cause: string }> {
  try {
    const entries = await readdir(path)
    return { state: 'ok', entries }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
    return { state: 'error', cause: describe(err) }
  }
}


/** One agent file on disk, with the name it declares for itself. */
export interface AgentFile {
  readonly path: string
  /** From `name:` in the frontmatter. `null` when it declares none — see `readEmployee`. */
  readonly name: string | null
  /** Benched: the file is `<something>.md.off`. */
  readonly disabled: boolean
}

/**
 * What a benched agent's file is called. Chosen so no reader of `*.md` can see it.
 *
 * Here rather than in `roster.ts`, where it used to live, because the walk below has to recognise
 * one and `workspace.ts` cannot import from `roster.ts` without a cycle. `roster.ts` re-exports
 * it, so `reconcile.ts` and the tests are unaffected — and there is still one definition of it.
 */
export const DISABLED_SUFFIX = '.off'

/** How far down to look. The CLI stops at 32; nobody files staff eight folders deep. */
const MAX_AGENT_DEPTH = 8

/**
 * Every agent file under `.claude/agents/`, at any depth, with the name each declares.
 *
 * ## Why this is one function used by two callers
 *
 * `roster.ts` used to answer *"where is agent X's file"* by building the string
 * `.claude/agents/<id>.md`, while this module answered *"who works here"* by reading `name:` out
 * of the frontmatter. Two definitions of one fact, and they agreed only while every file happened
 * to be named after the agent inside it.
 *
 * They disagree the moment anybody hand-writes one. Measured on a flat directory: a file
 * `code-reviewer.md` declaring `name: wren` put **wren** on the floor, and firing wren
 * answered *"There is no agent called wren."* The office showed somebody and then denied they
 * existed.
 *
 * ## Why it recurses
 *
 * Because Claude Code does. Measured against 2.1.250 on one directory: with
 * `.claude/agents/team/nestedone.md` present, `claude --agent` listed `nestedone` in its own
 * registry and the office drew only the flat one. That is a real employee the manager can
 * dispatch to and the floor does not show — which is the premise of this app failing quietly.
 *
 * Skills are the other way round and stay that way: the CLI loads only `skills/<name>/SKILL.md`,
 * so the office matches it there and reports the near-miss instead. The rule is not "recurse
 * everything"; it is "agree with the thing that actually runs them".
 */
export async function agentFiles(root: string): Promise<
  { readonly state: 'ok'; readonly files: readonly AgentFile[] } | { readonly state: 'missing' } | { readonly state: 'error'; readonly cause: string }
> {
  const base = join(root, CLAUDE_DIR, AGENTS_DIR)
  const found: AgentFile[] = []

  const walk = async (dir: string, depth: number): Promise<string | null> => {
    const listed = await listDir(dir)
    if (listed.state === 'missing') return null
    if (listed.state === 'error') return listed.cause

    for (const entry of [...listed.entries].sort()) {
      // Dotfiles are skipped at every level, as they always were at the top one. `.DS_Store` is
      // not an employee and neither is anything inside `.git`.
      if (entry.startsWith('.')) continue
      const here = join(dir, entry)

      if (entry.endsWith('.md') || entry.endsWith(`.md${DISABLED_SUFFIX}`)) {
        const text = await readFile(here, 'utf8').catch(() => null)
        // Unreadable here is not reported: `readEmployee` reads it again and reports properly.
        // This walk answers *where the files are*, and a second opinion about why one will not
        // open is how two messages about one file end up on the panel.
        const fm = text === null ? null : parseFrontmatter(text)
        found.push({
          path: here,
          name: fm?.['name']?.trim() || null,
          disabled: entry.endsWith(DISABLED_SUFFIX),
        })
        continue
      }

      // A directory. Anything else — a stray binary, a socket — is not an agent and not an error.
      if (depth < MAX_AGENT_DEPTH && !entry.includes('.')) {
        const deeper = await walk(here, depth + 1)
        if (deeper !== null) return deeper
      }
    }
    return null
  }

  const listedTop = await listDir(base)
  if (listedTop.state === 'missing') return { state: 'missing' }
  if (listedTop.state === 'error') return { state: 'error', cause: listedTop.cause }

  const cause = await walk(base, 0)
  if (cause !== null) return { state: 'error', cause }
  return { state: 'ok', files: found }
}

async function readEmployee(
  filePath: string,
): Promise<{ employee: Employee } | { problem: Problem }> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (err) {
    return { problem: { kind: 'unreadable-file', path: filePath, cause: describe(err) } }
  }

  const fm = parseFrontmatter(text)
  if (fm === null) return { problem: { kind: 'no-frontmatter', path: filePath } }

  /*
   * No `name:` is not a name the office may invent.
   *
   * This fell back to the filename stem, and the CLI does not: measured against 2.1.250 on one
   * directory, `claude --agent` enumerated its registry and a file whose frontmatter carried no
   * `name:` was simply not in it, while the office put it on the floor. A person drawn at a desk
   * whom the office cannot dispatch — clicking them cannot work, and nothing said why.
   *
   * Reported rather than skipped, because a half-written agent file is exactly the case where
   * somebody wants to know. `hire()` always writes `name:`, so nothing the office made can land
   * here; what does is a file somebody wrote by hand and did not finish.
   */
  const named = fm['name']?.trim()
  if (!named) {
    return {
      problem: {
        kind: 'lint',
        path: filePath,
        rule: 'agent-has-no-name',
        detail:
          'This file has no `name:` in its frontmatter, so Claude Code will not register it as ' +
          'an agent and the office cannot dispatch to it. Add a `name:` line — the office does ' +
          'not guess one from the filename, because an employee it invented is one you could ' +
          'never send anywhere.',
      },
    }
  }
  const id = named

  return {
    employee: {
      id,
      name: id,
      description: fm['description'] ?? '',
      tools: parseList(fm['tools']),
      model: fm['model'] ?? null,
      filePath,
    },
  }
}


/**
 * A `SKILL.md` one directory too far down, which nothing will ever load.
 *
 * Measured: Claude Code reads `skills/<name>/SKILL.md` and only that. `skills/pack/inner/SKILL.md`
 * is not loaded, and the CLI says nothing about it either — its own debug log names the skills it
 * found and never mentions the one it passed over.
 *
 * So the office does not start loading them: they would appear on a shelf and refuse to run,
 * which is the floor lying in the other direction. It reports them, which is the discrimination
 * `skill-outside-a-directory` already makes above — *"the shape is the evidence"*. A directory of
 * shared assets is nobody's business; a directory containing a file literally called `SKILL.md`
 * with a description in it is somebody's skill that has not worked and nobody has said why.
 *
 * One level only. This is a near-miss check, not a search: two directories down is not a typo.
 */
async function tooDeep(dirPath: string): Promise<{ problem: Problem } | null> {
  let entries: string[]
  try {
    entries = await readdir(dirPath)
  } catch {
    // The directory was listable a moment ago or we would not be here. Not knowing now is not
    // grounds to invent a lint about a file we cannot see.
    return null
  }

  for (const entry of entries) {
    const buried = join(dirPath, entry, 'SKILL.md')
    const fm = await readFile(buried, 'utf8').then(parseFrontmatter, () => null)
    if (!fm?.['description']) continue
    return {
      problem: {
        kind: 'lint',
        path: buried,
        rule: 'skill-too-deep',
        detail:
          'This looks like a skill, and a skill is `skills/<name>/SKILL.md` — one directory ' +
          `down, not two. Move it to skills/${entry}/SKILL.md and the office will pick it up. ` +
          'Claude Code does not load it where it is now, and says nothing about it either.',
      },
    }
  }
  return null
}


/**
 * What a skill is called — the one expression, used by the reader and by `locateSkill`.
 *
 * Measured: Claude Code answers to **both** the directory name and the frontmatter `name:`, so
 * neither is wrong and the office picks the declared one when there is one. What it may not do is
 * pick one here and rebuild the path from it somewhere else — which is what happened.
 */
function skillNameIn(dirPath: string, fm: Record<string, string>): string {
  const stem = basename(dirPath)
  return (fm['name'] ?? stem).trim() || stem
}

/**
 * Where a skill's directory actually is, by the name the office shows for it.
 *
 * `removeSkill` built `skills/<id>/` from the id, while the id came from `name:` inside the file.
 * The `wren` bug one entity over: measured on a directory `dirname-here/` whose SKILL.md declares
 * `name: frontmatter-name`, the shelf showed **frontmatter-name** and removing it answered *"There
 * is no skill called frontmatter-name."* The office showed something and then denied it existed.
 *
 * One level, like the CLI and like `readSkill`. `null` is "nothing here is called that", and the
 * caller says what that means to a person.
 */
export async function locateSkill(root: string, id: string): Promise<string | null> {
  const base = join(root, CLAUDE_DIR, SKILLS_DIR)
  const listed = await listDir(base)
  if (listed.state !== 'ok') return null

  for (const entry of [...listed.entries].sort()) {
    if (entry.startsWith('.')) continue
    const dirPath = join(base, entry)
    const text = await readFile(join(dirPath, 'SKILL.md'), 'utf8').catch(() => null)
    if (text === null) continue
    const fm = parseFrontmatter(text)
    if (fm === null) continue
    if (skillNameIn(dirPath, fm) === id) return dirPath
  }
  return null
}

async function readSkill(dirPath: string): Promise<{ skill: Skill } | { problem: Problem } | null> {
  /*
   * A file where a directory was expected, which is a mistake somebody makes.
   *
   * A skill is `skills/<name>/SKILL.md`. Dropping a `my-skill.md` straight into `skills/` is the
   * obvious near-miss, and without this the code stats `my-skill.md/SKILL.md` and reports
   * `ENOTDIR: not a directory` about a path that cannot exist — a raw errno, naming a file nobody
   * wrote, for a mistake with a one-line fix.
   *
   * Silence for anything that is merely *a file*: a `README.md` beside the skills is somebody's
   * note and none of the office's business. The line between them is whether it looks like a
   * skill — frontmatter with a description — which is the same discrimination `memory.ts` makes
   * between a record and a note, and for the same reason: the shape is the evidence.
   */
  try {
    const here = await stat(dirPath)
    if (!here.isDirectory()) {
      const misplaced = await readFile(dirPath, 'utf8').then(parseFrontmatter, () => null)
      if (!misplaced?.['description']) return null
      return {
        problem: {
          kind: 'lint',
          path: dirPath,
          rule: 'skill-outside-a-directory',
          detail:
            'This looks like a skill, and a skill is a directory: move it to ' +
            `skills/${basename(dirPath, '.md')}/SKILL.md and the office will pick it up.`,
        },
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    return { problem: { kind: 'unreadable-dir', path: dirPath, cause: describe(err) } }
  }

  const filePath = join(dirPath, 'SKILL.md')

  try {
    const s = await stat(filePath)
    if (!s.isFile()) return null
  } catch (err) {
    // A directory under skills/ with no SKILL.md is not a skill and not an error — some packs
    // ship shared assets alongside. Anything else is worth reporting.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return await tooDeep(dirPath)
    return { problem: { kind: 'unreadable-file', path: filePath, cause: describe(err) } }
  }

  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (err) {
    return { problem: { kind: 'unreadable-file', path: filePath, cause: describe(err) } }
  }

  const fm = parseFrontmatter(text)
  if (fm === null) return { problem: { kind: 'no-frontmatter', path: filePath } }

  return { skill: { id: skillNameIn(dirPath, fm), name: skillNameIn(dirPath, fm), description: fm['description'] ?? '', filePath } }
}

/**
 * Scan a workspace for staff and skills.
 *
 * Never throws. Everything that went wrong comes back in `problems` so the caller can show the
 * user a floor that is honest about what it could not see.
 */
export async function discoverWorkspace(root: string): Promise<Workspace> {
  const problems: Problem[] = []
  const employees: Employee[] = []
  const skills: Skill[] = []

  // --- Staff ---
  const agentsPath = join(root, CLAUDE_DIR, AGENTS_DIR)
  const found = await agentFiles(root)

  if (found.state === 'error') {
    problems.push({ kind: 'unreadable-dir', path: agentsPath, cause: found.cause })
  } else if (found.state === 'ok') {
    // Benched files are not staff — they are a `.md.off`, which is the whole point of the
    // suffix. `roster.disabled()` lists them, from this same walk.
    for (const file of found.files.filter((f) => !f.disabled)) {
      const result = await readEmployee(file.path)
      if ('problem' in result) {
        problems.push(result.problem)
      } else {
        employees.push(result.employee)
      }
    }
  }

  // After the loop, not inside it: `only the manager may delegate` is a rule about who the
  // manager is, and that is a property of the set.
  problems.push(...lintStaff(employees))

  // --- Skills ---
  const skillsPath = join(root, CLAUDE_DIR, SKILLS_DIR)
  const skillsDir = await listDir(skillsPath)

  if (skillsDir.state === 'error') {
    problems.push({ kind: 'unreadable-dir', path: skillsPath, cause: skillsDir.cause })
  } else if (skillsDir.state === 'ok') {
    for (const entry of skillsDir.entries.filter((e) => !e.startsWith('.')).sort()) {
      const result = await readSkill(join(skillsPath, entry))
      if (result === null) continue
      if ('problem' in result) problems.push(result.problem)
      else skills.push(result.skill)
    }
  }

  return { root, employees, skills, problems, scannedAt: new Date().toISOString() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Watching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Watch a workspace and re-scan when it changes.
 *
 * Editors write markdown in bursts (write, rename, chmod), so changes are debounced. The
 * callback receives a complete `Workspace` rather than a diff — the floor's job is to render
 * whatever is true now, and a full snapshot means a missed event can never leave the UI holding
 * a stale roster.
 */
export function watchWorkspace(
  root: string,
  onChange: (ws: Workspace) => void,
  { debounceMs = 200 }: { debounceMs?: number } = {},
): { close(): void } {
  const watchers: FSWatcher[] = []
  let timer: NodeJS.Timeout | null = null
  let closed = false

  const rescan = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (closed) return
      void discoverWorkspace(root).then(onChange)
    }, debounceMs)
  }

  // `commands/` is watched even though `discoverWorkspace` does not read it. The rescan it
  // triggers is what tells the renderer something under `.claude/` changed, and the command
  // menu re-reads on that signal — so a command you have just written appears without a
  // restart. Watching only what this function itself parses would be a narrower rule that
  // happens to leave the newest file in the workspace invisible for as long as nothing else
  // changes.
  for (const dir of [
    join(root, CLAUDE_DIR, AGENTS_DIR),
    join(root, CLAUDE_DIR, SKILLS_DIR),
    join(root, CLAUDE_DIR, COMMANDS_DIR),
  ]) {
    try {
      watchers.push(watch(dir, { recursive: true }, rescan))
    } catch {
      // A directory that does not exist yet simply is not watched. Discovery already reports
      // its absence, and the caller can re-establish watchers after a scan finds it.
    }
  }

  /*
   * `projects/`, and deliberately **not** recursively.
   *
   * `main.ts` rebuilds its project list inside `rescan()`, and `rescan()` was reachable only from
   * the three directories above — so a project created the way `CLAUDE.md` tells you to create one,
   * *"Copy `projects/_TEMPLATE/` to start a new one"*, stayed invisible until the app was restarted
   * or something unrelated touched `.claude/`. Found by making one by hand and watching the tab bar
   * not notice.
   *
   * Non-recursive, because the *list* changes when a directory is added or removed and nothing
   * else. Watching the contents would fire on every append to a `PROGRESS.md`, and a project
   * holding a build tree would make that constant — each one costing a workspace scan.
   *
   * It was briefly made recursive on the belief that kqueue was not reporting `mkdir` here. It
   * reports it; what looked like a missed event was the command palette drawing its first
   * `SHOWN_MAX = 24` rows, with projects appended after the fixed commands and therefore first
   * over the edge. The palette is right — `filterActions` sees everything, so typing the name
   * finds it — and the watch was never the thing that was wrong.
   */
  try {
    watchers.push(watch(join(root, PROJECTS_DIR), { recursive: false }, rescan))
  } catch {
    // Same as above: a workspace with no `projects/` yet simply is not watched.
  }

  return {
    close() {
      closed = true
      if (timer) clearTimeout(timer)
      for (const w of watchers) w.close()
    },
  }
}
