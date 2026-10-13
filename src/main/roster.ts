/**
 * Hiring, firing, and sending somebody home for the day.
 *
 * Until now an employee was added by hand-writing a markdown file. That is a true answer and a
 * developer's one: `grep -riE 'createAgent|writeAgent|deleteAgent' src/` returned nothing before
 * this file existed. For a product whose entire premise is *"clone it and add your own agents"*,
 * the adding has to be something the office does rather than something you do behind its back.
 *
 * ## The rule everything here follows
 *
 * **The filesystem stays the source of truth.** These functions write the same files a person
 * writes by hand, in the same place, in the same format — they do not maintain a parallel list.
 * `discoverWorkspace()` remains the only thing that says who exists, and it finds what we wrote
 * exactly as it would find what somebody typed in an editor.
 *
 * That is not a stylistic preference. A second registry beside a directory the user edits is how
 * the office ends up drawing a desk for somebody who is not there — and the office's whole claim
 * is that the floor cannot show what is not real.
 *
 * ## Disabling, and why it is a rename rather than a flag
 *
 * A disabled agent has to disappear from discovery, which reads `*.md`. A `disabled: true` line
 * in frontmatter would need every reader to know about it — discovery, the capability survey,
 * the manager's roster block, anything a user greps. One of them will forget, and the one that
 * forgets shows a desk for somebody who is off.
 *
 * `reviewer.md` → `reviewer.md.off` disappears from every reader at once, for free, and is
 * obvious to somebody looking at the directory with no knowledge of this app. It is also
 * trivially reversible by hand, which a flag inside a file we wrote is not.
 */

import { access, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { isDelegationTool } from '../shared/delegation.js'
import { whyInvalid, whyUnsafeAsPath } from '../shared/agent-id.js'

const CLAUDE_DIR = '.claude'
const AGENTS_DIR = 'agents'
/*
 * Moved to `workspace.ts`, which owns the layout of `.claude/agents/` and needs it for the walk
 * that finds agent files. Re-exported here because `reconcile.ts` and the tests import it from
 * this module, and because a benched agent is a roster idea even when the string is not.
 */
import { agentFiles, DISABLED_SUFFIX } from './workspace.js'
export { DISABLED_SUFFIX }

/**
 * The name the manager has unless somebody says otherwise.
 *
 * The default, not the answer. `main.ts` finds the manager by this name first and falls back to
 * whoever declares the delegation tool, so a workspace can have a manager called `boss` — and
 * the guards below take that id as a parameter rather than assuming this one.
 *
 * They did assume it, in the first version of this change, and the review that caught it put the
 * problem precisely: the layer described in the commit message as *the guarantee* permitted
 * exactly what the renderer's *courtesy* withheld. `staffRows` withholds both buttons from
 * whoever `findManager` picked; `fire` compared against a literal and let `boss` through. A
 * guarantee that protects a strict subset of what the check above it protects is not a
 * guarantee, whatever the comment says.
 *
 * What is still not protected, deliberately: a benched file that would become the manager if it
 * were brought back. `findManager` reads `*.md`, so nobody on the bench is the manager *now* —
 * which is the question these guards ask. The first version reasoned from "a `.off` file's
 * `tools:` cannot be read", which was two wrong things at once: nothing stops `readFile` on a
 * `.off`, and "nobody on the bench is currently the manager" is true of every benched agent, so
 * it carried no conclusion. The office chooses not to read `.off` files — that is this module's
 * whole thesis — and the line drawn here is *the manager the office is running on*, not every
 * file that could one day hold one.
 */
const DEFAULT_MANAGER_ID = 'manager'

/** Whether a path is there, as a question rather than an exception. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** What you need to say to hire somebody. */
export interface Hire {
  /** Becomes the filename and the `name:` field. The manager dispatches to this. */
  readonly id: string
  readonly description: string
  /** `null` inherits everything, which is what omitting `tools:` means. */
  readonly tools: readonly string[] | null
  /** `null` uses the workspace default. */
  readonly model: string | null
  /** The body: what this employee is for, in their own words. */
  readonly prompt: string
}

export type RosterResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string }

/**
 * Name validation lives in `shared/agent-id.ts` so the hire form can use the same rule this
 * module enforces. Re-exported here because this is where callers already look for it, and
 * because a name check that is not beside the thing that writes the file is a check somebody
 * will eventually forget to run.
 */
export { isValidAgentId, whyInvalid } from '../shared/agent-id.js'

/** The file a hire produces. Exported because writing it is one thing and testing it is another. */
export function agentFile(hire: Hire): string {
  const front = [`name: ${hire.id}`, `description: ${hire.description.trim()}`]
  // Omitted rather than empty when null — omitting `tools:` is what "inherits everything" means
  // in this format, and writing `tools:` with nothing after it would mean the opposite.
  if (hire.tools !== null) front.push(`tools: ${hire.tools.join(', ')}`)
  if (hire.model !== null) front.push(`model: ${hire.model}`)

  return `---\n${front.join('\n')}\n---\n\n${hire.prompt.trim()}\n`
}

/**
 * Hire.
 *
 * Refuses to overwrite. Hiring somebody who already exists is almost always a mistake — a typo,
 * or a second person adding the same name — and silently replacing an agent file somebody wrote
 * is not a recoverable kind of wrong.
 */
export async function hire(root: string, request: Hire): Promise<RosterResult> {
  const bad = whyInvalid(request.id)
  if (bad) return { ok: false, reason: bad }
  if (!request.description.trim()) {
    // The manager chooses who to dispatch from the description. An employee without one is
    // somebody the manager has no reason to pick, which is a quieter failure than not existing.
    return { ok: false, reason: 'A description is required — it is how the manager decides who to give work to.' }
  }

  /*
   * A named list may not include a delegation tool.
   *
   * The first standing order is that only the user and the manager originate work, and it is
   * kept by employees not having `Task`. `prompts.test.ts` checks that in the seven files we
   * ship — and every agent hired after install was written by this function, which checked the
   * name and the description and never the tools.
   *
   * `views/hire.ts` already says the right thing about this in its own header, and finishes with
   * *"`hire()` still validates independently, because a renderer check is a courtesy and never a
   * guarantee."* The courtesy was there. The guarantee was not.
   *
   * `tools: null` is deliberately still allowed. Omitting the field is what the format means by
   * *inherit everything*, the form makes it a checkbox with the consequence written beside it,
   * and the roster prints it loudly under a name — a knowing choice, made once, and visible
   * afterwards. Refusing it here would outlaw a documented path; refusing an explicit `Task` in
   * a curated list costs nothing, because a list somebody typed item by item has no other reason
   * to contain it.
   */
  // `isDelegationTool` rather than a set of names copied to here — the office already has one
  // answer to "is this the tool that summons somebody", and two would be one too many.
  const delegation = (request.tools ?? []).filter(isDelegationTool)
  if (delegation.length > 0) {
    return {
      ok: false,
      reason:
        `An employee may not be given ${delegation.join(' or ')} — only the manager dispatches. ` +
        'Remove it, or tick "inherit every tool" if that is really what you mean.',
    }
  }

  const path = join(root, CLAUDE_DIR, AGENTS_DIR, `${request.id}.md`)

  /*
   * Somebody on the bench is still somebody. `wx` below refuses to overwrite `${id}.md` and
   * says nothing about `${id}.md.off`, so hiring a benched employee's name used to succeed —
   * and then the roster drew that name twice, once at a desk and once under "sent home",
   * because `discoverWorkspace` and `disabled()` were each reading the file the other cannot
   * see. Clicking *Bring back* on the second row renames `.off` over the file this call just
   * wrote, and POSIX `rename` replaces silently: the new employee's description and prompt were
   * gone with `{ ok: true }` returned for it.
   *
   * The header above already forbids that — *"silently replacing an agent file somebody wrote
   * is not a recoverable kind of wrong"*. It was one suffix away from being true.
   *
   * Checking before writing has the gap the `wx` comment names, and this one is real: an agent
   * benched between this line and that write is hired over anyway. It is left as a check rather
   * than closed, because closing it means writing the file first and deleting it on discovering
   * the `.off`, which trades a race nobody has hit for an unlink in the error path.
   */
  /*
   * Asked, not built — and this guard was the last place in the file still building.
   *
   * `exists(`${path}.off`)` only sees a benched agent whose *filename* matches the name being
   * hired. Measured: a benched `code-reviewer.md.off` declaring `name: ariel` is on the bench as
   * **ariel**, and hiring "ariel" succeeded — putting ariel on the floor and on the bench at the
   * same time, which is precisely the state the paragraph above says this guard exists to stop.
   * The guard was right about the rule and wrong about where to look.
   */
  const benched = await locateAgent(root, request.id, 'benched')
  if ('path' in benched) {
    return {
      ok: false,
      reason:
        `${request.id} is on the bench — their file is ${relative(root, benched.path)}, with their ` +
        'prompt still in it. Bring them back or let them go before hiring the name again.',
    }
  }

  try {
    /*
     * The directory has to be made, and this is not defensive tidiness.
     *
     * `.claude/agents/` exists in a packaged install because the build seeds six agents into it.
     * It does not exist anywhere else — and "anywhere else" is this product's own pitch: point
     * the office at a repository you already have. There, the first-run panel opens itself
     * `blocked` — *"Nobody works here yet, so there is no manager to answer you"* — offers
     * exactly one button, Hire somebody, and that button returned a raw ENOENT naming an
     * absolute path. An office that cannot be started, and whose only unblocking action fails
     * with the errno of a directory nobody told the person about.
     *
     * `addSkill` in `skills.ts` has always done this, three lines from an otherwise identical
     * `writeFile(..., 'wx')`. Same module family, same pattern, one had the mkdir.
     *
     * Before `writeFile` rather than in the catch: retrying on ENOENT would make the common path
     * pay for the rare one and would not distinguish a missing parent from a missing volume.
     */
    await mkdir(dirname(path), { recursive: true })
    // `wx` — fail if it exists, atomically. Checking-then-writing has a gap that two clicks can
    // fit through.
    await writeFile(path, agentFile(request), { encoding: 'utf8', flag: 'wx' })
    return { ok: true, path }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return { ok: false, reason: `There is already an agent called ${request.id}.` }
    }
    return { ok: false, reason: `Could not write ${path}: ${describe(err)}` }
  }
}

/**
 * Where an agent's file actually is, asked rather than assumed.
 *
 * This module used to build `.claude/agents/<id>.md` from the id. Discovery, meanwhile, took the
 * id from `name:` inside the file. Two definitions of one fact, agreeing only while every file
 * happened to be named after the agent inside it.
 *
 * Measured on a flat directory, no nesting involved: `code-reviewer.md` declaring `name: ariel`
 * puts **ariel** on the floor, and `fire('ariel')` answered *"There is no agent called ariel."*
 * The office showed somebody and then denied they existed — and every operation here that acts on
 * an existing agent had it.
 *
 * `agentFiles` is the walk discovery itself uses, so the answer cannot drift from who is drawn.
 * `null` means no file declares that name, which is the honest reading of both "there is nobody
 * called that" and "the directory could not be read" — the callers say which, because they have
 * different things to tell somebody.
 */
async function locateAgent(
  root: string,
  id: string,
  want: 'active' | 'benched',
): Promise<{ readonly path: string } | { readonly missing: 'no-such-agent' | 'unreadable'; readonly cause?: string }> {
  const found = await agentFiles(root)
  if (found.state === 'error') return { missing: 'unreadable', cause: found.cause }
  if (found.state === 'missing') return { missing: 'no-such-agent' }

  const wantDisabled = want === 'benched'
  for (const file of found.files) {
    if (file.disabled !== wantDisabled) continue
    // The declared name, or the filename stem for a benched file — a `.md.off` is still parsed,
    // but somebody may have benched a file by hand before it ever had a `name:`.
    const called = file.name ?? basename(file.path).replace(/\.md(\.off)?$/, '')
    if (called === id) return { path: file.path }
  }
  return { missing: 'no-such-agent' }
}

/**
 * Send somebody home, reversibly.
 *
 * The file is renamed rather than edited, so every reader of `*.md` stops seeing them at once
 * and nobody has to know about a flag.
 */
export async function disable(root: string, id: string, manager: string = DEFAULT_MANAGER_ID): Promise<RosterResult> {
  /*
   * The same name check `hire` runs, for the same reason and one layer later.
   *
   * These three take an id straight off the bridge — `String(id ?? '')` in main — and turn it
   * into a path. `whyInvalid` refuses a slash and a dot, and without it `fire` was an `unlink`
   * of anything the id could reach:
   *
   *     fire(root, '../skills/victim')  →  { ok: true }, and a skill file gone
   *     disable(root, '../skills/v2')   →  { ok: true }, and a skill file renamed
   *
   * The renderer only ever sends ids off roster rows, which is precisely the argument this
   * module rejects everywhere else: a renderer check is a courtesy and never a guarantee.
   *
   * `whyUnsafeAsPath` rather than `whyInvalid`, and the difference cost a round: `whyInvalid` is
   * the convention for a name somebody is *choosing*, and these three are handed whatever
   * `readdir` found. Using it here made the office refuse to act on rows it had just drawn —
   * `Reviewer.md` and `my_helper.md` are discovered, given both buttons, then answered with a
   * complaint about a name the user never typed.
   */
  const badName = whyUnsafeAsPath(id)
  if (badName) return { ok: false, reason: badName }

  if (id === manager) {
    return { ok: false, reason: 'The manager is the office. Sending them home leaves nobody who can dispatch work.' }
  }
  // Where their file actually is, rather than where the id says it should be. See `locateAgent`.
  const found = await locateAgent(root, id, 'active')
  if ('missing' in found) {
    return {
      ok: false,
      reason:
        found.missing === 'unreadable'
          ? `The office could not read ${CLAUDE_DIR}/${AGENTS_DIR} to find ${id} — ${found.cause ?? 'unknown'}.`
          : `There is no agent called ${id} to disable.`,
    }
  }
  const from = found.path
  const to = `${from}${DISABLED_SUFFIX}`
  // `rename` replaces the destination without a word. Both files existing is not a state the
  // office can reach on its own, but `.off` is documented as a thing you may do by hand — the
  // header above sells it as "trivially reversible by hand" — so a directory somebody has
  // edited is exactly the directory this runs against.
  if (await exists(to)) {
    return { ok: false, reason: `${id} is already on the bench — ${relative(root, to)} exists and holds a prompt.` }
  }
  try {
    await rename(from, to)
    return { ok: true, path: to }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, reason: `There is no agent called ${id} to disable.` }
    }
    return { ok: false, reason: `Could not disable ${id}: ${describe(err)}` }
  }
}

/** Bring them back. */
export async function enable(root: string, id: string): Promise<RosterResult> {
  // Same reason as `disable` above: the id becomes a path, and it arrives off the bridge.
  const badName = whyUnsafeAsPath(id)
  if (badName) return { ok: false, reason: badName }

  const benched = await locateAgent(root, id, 'benched')
  if ('missing' in benched) {
    return {
      ok: false,
      reason:
        benched.missing === 'unreadable'
          ? `The office could not read ${CLAUDE_DIR}/${AGENTS_DIR} to find ${id} — ${benched.cause ?? 'unknown'}.`
          : `There is nobody called ${id} on the bench.`,
    }
  }
  const from = benched.path
  // The live path is the benched one with the suffix taken off, so a nested agent comes back to
  // the directory it was benched in rather than to the top level.
  const to = from.slice(0, -DISABLED_SUFFIX.length)
  // The overwrite that actually cost something: with `hire` guarded above, the office can no
  // longer produce both files, but a directory a person has edited can, and this used to
  // replace a live agent's file with a benched one and report success.
  if (await exists(to)) {
    return { ok: false, reason: `There is already an agent called ${id} at a desk. Bringing ${id} back would replace their file.` }
  }
  try {
    await rename(from, to)
    return { ok: true, path: to }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, reason: `There is no disabled agent called ${id}.` }
    }
    return { ok: false, reason: `Could not re-enable ${id}: ${describe(err)}` }
  }
}

/**
 * Fire.
 *
 * Deletes the file, which is not undoable and is why the UI must confirm it. This function does
 * not confirm anything — a module that second-guesses its caller is a module the caller starts
 * working around.
 *
 * Their desk is freed by the seat map, not here: `.claude/agents/` says who exists and nothing
 * else does. What happens to their transcripts is also not this function's business — those are
 * a record of work that really happened, and firing somebody does not unhappen it.
 */
export async function fire(root: string, id: string, manager: string = DEFAULT_MANAGER_ID): Promise<RosterResult> {
  // Same reason as `disable` above: the id becomes a path, and it arrives off the bridge.
  const badName = whyUnsafeAsPath(id)
  if (badName) return { ok: false, reason: badName }

  if (id === manager) {
    const theirs = await locateAgent(root, manager, 'active')
    const managerFile = 'path' in theirs ? relative(root, theirs.path) : null
    return {
      ok: false,
      reason:
        'The manager is the office — without one, `openSession` has nobody to start and nothing ' +
        // Parameterising the name was half of it. The other half is that a manager's file need
        // not be `<name>.md` at the top level at all — it can declare its name from any filename,
        // at any depth — so this now names the file that is actually there, and falls back to the
        // conventional path only when there is none to name.
        `here can run. Remove ${managerFile ?? join(CLAUDE_DIR, AGENTS_DIR, `${manager}.md`)} ` +
          'yourself if you really mean to.',
    }
  }

  /*
   * At a desk or on the bench.
   *
   * This built `${id}.md` and unlinked that, which is by definition not where a benched agent's
   * file is — so the *Fire* button the bench row offers answered "There is no agent called X"
   * about a row that was on screen at that moment, badged "sent home", describing the file as
   * `X.md.off`. The screen and the button disagreed about whether somebody existed, and the
   * screen was right.
   *
   * It failed safe and it failed dishonestly, and the second is the half that matters: the
   * office's third standing order is that nothing on screen may lie, and there was no way to
   * let a benched employee go at all without first bringing them back.
   */
  const active = await locateAgent(root, id, 'active')
  const bench = await locateAgent(root, id, 'benched')
  if ('missing' in active && 'missing' in bench) {
    return {
      ok: false,
      reason:
        active.missing === 'unreadable'
          ? `The office could not read ${CLAUDE_DIR}/${AGENTS_DIR} to find ${id} — ${active.cause ?? 'unknown'}.`
          : `There is no agent called ${id}.`,
    }
  }
  // Both are still checked below, and both existing is still a refusal rather than a choice —
  // see the note beneath. These are just the real paths now instead of two guesses.
  const at = 'path' in active ? active.path : join(root, CLAUDE_DIR, AGENTS_DIR, `${id}.md`)
  const off = 'path' in bench ? bench.path : `${at}${DISABLED_SUFFIX}`

  /*
   * Both files is a refusal, not a choice of one.
   *
   * `disable` and `enable` above both refuse this state, and the test defending it says so in
   * its name. `fire` — the only one of the three with no undo — took the first path that
   * existed, which meant a click on the *bench* row unlinked the *desk* file: a different row's
   * agent destroyed, `{ ok: true }` returned, the row that was clicked still on screen, and the
   * confirmation saying their file is gone. Two untrue things on screen from one click, one of
   * them irreversible.
   *
   * Naming both files, because the person who has to resolve this is looking at a directory
   * they edited and needs to know which one they meant to keep.
   */
  if ((await exists(at)) && (await exists(off))) {
    return {
      ok: false,
      reason:
        // The real paths, not `${id}.md` rebuilt from the name.
        //
        // The comment on the manager guard above this one says exactly why: *"the check was
        // parameterised and the sentence was not"*. This sentence had the same fault and I put it
        // back while fixing the check — an agent at `team/whatever.md` declaring `name:
        // nestedone` produced "remove nestedone.md", sending somebody to a file that does not
        // exist, in the one message whose whole job is telling them which file to remove.
        `There are two files for ${id} — ${relative(root, at)} and ${relative(root, off)} — and ` +
        'firing them would delete one and leave the other. Remove the one you do not want first.',
    }
  }

  for (const path of [at, off]) {
    try {
      await unlink(path)
      return { ok: true, path }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      return { ok: false, reason: `Could not remove ${id}: ${describe(err)}` }
    }
  }
  return { ok: false, reason: `There is no agent called ${id}.` }
}

/** Who is on the bench — disabled, and re-enablable. */
export async function disabled(root: string): Promise<readonly string[]> {
  try {
    /*
     * `agentFiles` — the same walk discovery uses, which is what the comment this replaces was
     * asking for: *"Two readers of the same directory have to agree on what an agent file is."*
     * They were still two readers. The dotfile rule is now applied in one place rather than
     * copied into a second, the bench sees agents in subdirectories exactly as the floor does,
     * and a benched agent is listed under the name it declares rather than under its filename —
     * which is the same correction `locateAgent` makes for firing and enabling.
     */
    const found = await agentFiles(root)
    if (found.state !== 'ok') return []
    return found.files
      .filter((f) => f.disabled)
      .map((f) => f.name ?? basename(f.path).replace(/\.md\.off$/, ''))
      .sort()
  } catch {
    // A directory we cannot read is not a workspace with nobody on the bench. The caller that
    // needs to know the difference asks `discoverWorkspace`, which reports it properly.
    return []
  }
}

// `readAgent` was here — "the file as it stands, for an editor that must not invent what it
// shows". There is no editor. Written for a surface that was never built, and kept for months
// looking like part of one.

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
