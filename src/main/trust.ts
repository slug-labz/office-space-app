/**
 * Whether Claude Code trusts this workspace.
 *
 * A workspace that has not been trusted has its `permissions.allow` **ignored entirely**.
 * Claude Code says so on stderr and carries on, so from inside the office it looks like an
 * allowlist that simply does not work: agents are refused commands the settings plainly permit,
 * and nothing on screen explains why.
 *
 * That lands hardest on exactly the story this project sells. A fresh clone has never been
 * trusted, so a brand new office ships an allowlist that does nothing, and the first thing its
 * staff try to do is the thing they are refused.
 *
 * We cannot fix it from here, and should not want to: the trust prompt exists so that a person
 * decides whether a directory's settings may run commands on their machine. An app that answered
 * it on their behalf would be defeating the one control standing between a cloned repo and their
 * shell. So the office detects it and says so, which is the whole of its job here.
 *
 * ## The rule, in its least forgiving form
 *
 * Three states, never two. If the file cannot be read or parsed, the answer is **unknown** — not
 * untrusted. Warning somebody that their workspace is untrusted because we failed to read a file
 * would be the office inventing a fact about their machine, which is the same failure as an
 * empty floor standing in for an unreadable directory.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Claude Code's own config, where the trust decision is recorded. */
const CONFIG = '.claude.json'

export type Trust =
  /** The workspace is trusted. `permissions.allow` applies. */
  | { readonly state: 'trusted' }
  /** Recorded as not trusted. Everything in `permissions.allow` is being ignored. */
  | { readonly state: 'untrusted' }
  /**
   * We could not tell — or nobody has been asked yet. Two different silences.
   *
   * `why` separates them, because only one is a guess. **`unreadable`** means the config would
   * not open, and warning off that would be inventing a fact about somebody's machine.
   * **`never-opened`** means the config opened and holds no record for this directory, which is
   * not a failure to know: Claude Code ignores the allowlist until the prompt is answered, so the
   * consequence is certain even though the *decision* has not been made. `harness.ts` already
   * treats both as untrusted for the purpose of running a command; this lets the surface tell the
   * second one apart, which is the fresh-clone case this module's header calls the one that
   * *"lands hardest on exactly the story this project sells."*
   */
  | { readonly state: 'unknown'; readonly why: 'unreadable' | 'never-opened'; readonly cause: string }

/**
 * Read the trust decision for a workspace.
 *
 * `home` is injectable so this is testable against a fixture rather than against whatever the
 * developer's own machine happens to say.
 */
export async function workspaceTrust(root: string, home: string = homedir()): Promise<Trust> {
  const path = join(home, CONFIG)

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    return { state: 'unknown', why: 'unreadable', cause: `could not read ${path}: ${(err as Error).message}` }
  }

  let config: unknown
  try {
    config = JSON.parse(text)
  } catch (err) {
    return { state: 'unknown', why: 'unreadable', cause: `${path} is not readable JSON: ${(err as Error).message}` }
  }

  if (typeof config !== 'object' || config === null) {
    return { state: 'unknown', why: 'unreadable', cause: `${path} is not an object` }
  }

  const projects = (config as Record<string, unknown>)['projects']
  if (typeof projects !== 'object' || projects === null) {
    // No projects recorded at all. Claude Code has never run anywhere, which tells us nothing
    // about this directory in particular.
    return { state: 'unknown', why: 'never-opened', cause: `${path} records no projects` }
  }

  const entry = (projects as Record<string, unknown>)[root]
  if (typeof entry !== 'object' || entry === null) {
    // Never opened here. That is not a recorded refusal, and the prompt has simply not been
    // asked yet — which is genuinely different from having been answered "no".
    return { state: 'unknown', why: 'never-opened', cause: 'Claude Code has not been run in this workspace yet' }
  }

  return (entry as Record<string, unknown>)['hasTrustDialogAccepted'] === true
    ? { state: 'trusted' }
    : { state: 'untrusted' }
}

/**
 * What to tell somebody whose allowlist is being ignored.
 *
 * Names the fix rather than the symptom, and names it as something they do — the office cannot
 * and must not do it for them.
 *
 * ## Corrected, because the first version of this message was false
 *
 * It said the office "will be refused when it tries to run anything". Measured against the
 * installed CLI, that is not what happens. `claude` prints
 *
 * > `Ignoring 27 permissions.allow entries … this workspace has not been trusted.`
 *
 * …and then **runs the tool anyway**: `Bash("ls package.json")` came back `is_error: false`
 * with an empty `permission_denials`. Under `--print` the effect of being untrusted is
 * *permissive*, not restrictive.
 *
 * The refusal is **ours**. `harness.ts` uses none of an untrusted workspace's allow rules, so it
 * runs no VERIFY on its own: each comes back `unlisted`, or `denied` where a deny rule covers it.
 * That gate is deliberate and it is the right one — but it means the thing this message must
 * describe is the office declining to verify, not the CLI declining to act.
 *
 * Saying it the old way was worse than saying nothing: somebody reading it would conclude their
 * agents were sandboxed, and they are not.
 */
export function untrustedMessage(root: string, allowCount: number, asked = true): string {
  return [
    asked
      ? `This workspace is not trusted by Claude Code, so its ${allowCount} permission`
      : // Never asked is not the same as answered no, and the remedy sentence below is identical
        // either way — so the only thing worth getting right here is not accusing somebody of a
        // refusal they never made.
        `Claude Code has never been opened in this workspace, so it has not been trusted and its ${allowCount} permission`,
    `${allowCount === 1 ? 'rule is' : 'rules are'} being ignored.`,
    'Agents still run commands — Claude Code does not sandbox an untrusted workspace, it just',
    'stops honouring the list. What stops is the office\'s own checking: with the allow list',
    'ignored, the office runs no VERIFY condition on its own, so nothing here is verified unless',
    'somebody runs it by hand.',
    `Run \`claude\` once in ${root} and accept the trust prompt.`,
  ].join(' ')
}
