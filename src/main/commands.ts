/**
 * Slash command discovery.
 *
 * A command is a markdown file in `.claude/commands/`, and typing its name in the chat panel
 * runs its body as the prompt. The office does not implement any of that — the `claude` we
 * spawn does — so this module's only job is to know what is there, well enough that the UI can
 * offer it and describe it.
 *
 * ## What the CLI actually does, measured rather than assumed
 *
 * Checked against `claude` 2.1.231 in `--print --output-format stream-json --verbose` mode,
 * which is exactly how `claude/run.ts` spawns it. The session transcript on disk records the
 * prompt the model was actually sent, so these are readings, not inferences:
 *
 * - **Commands expand in `--print` mode.** `/hello alpha beta` reaches the model as the body of
 *   `.claude/commands/hello.md`, preceded by a `<command-name>/hello</command-name>` marker.
 *   The office therefore does not need to expand anything itself; it passes the text through.
 * - **The filename is the name.** A file called `renamed.md` is `/renamed` even when its
 *   frontmatter says `name: totally-different`. Frontmatter `name` is ignored, which is why
 *   identity here comes from the path and the shipped commands do not declare one.
 * - **Subdirectories namespace.** `commands/office/nested.md` is `/office:nested`.
 * - **Frontmatter is optional.** A file with none is still a working command. See `readCommand`.
 * - **An unknown command never reaches the model.** The CLI answers it locally with a synthetic
 *   `Unknown command: /x` message, costing nothing and exiting zero. So a typo is silent rather
 *   than loud, which is the reason the UI wants this list: it can only refuse what it knows.
 * - **`$ARGUMENTS` is the whole argument string.** Positionals are **zero-indexed**: given
 *   `/x alpha beta`, `$0` is `alpha` and `$1` is `beta` — not what shell habits predict — and an
 *   index past the end is left in the prompt as literal `$2`. The commands this repo ships use
 *   `$ARGUMENTS` only, for that reason.
 *
 * ## The rule this module is governed by
 *
 * The same one as `workspace.ts`: **a directory we could not read is not an empty directory.**
 * `.claude/commands/` not existing is genuinely zero commands — a workspace nobody has added
 * one to has none, and `CLAUDE.md` says so explicitly. A `.claude/commands/` that exists and
 * cannot be read is a different fact entirely and goes in `problems`, because a menu that
 * quietly shows nothing is a menu that says "this workspace has no commands" about a workspace
 * that may be full of them.
 */

import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { parseFrontmatter, type Problem } from './workspace.js'

const CLAUDE_DIR = '.claude'
const COMMANDS_DIR = 'commands'

/** A slash command, discovered from a `.claude/commands/**\/*.md` file. */
export interface Command {
  /**
   * What you type after the slash — `state`, or `office:nested` for one in a subdirectory.
   *
   * Taken from the path, because that is what the CLI resolves against. There is no separate
   * id: for a command the typed token *is* the identity, and a second field holding the same
   * string is a second field that can disagree with the first.
   */
  readonly name: string
  /** Frontmatter `description`. Empty when the file declares none — never invented. */
  readonly description: string
  /**
   * Frontmatter `argument-hint`, or `null` when the command declares none.
   *
   * `null` is not `''`: it is the difference between a command that takes no arguments and one
   * whose author never said what it takes. The UI can prompt for the first and should not.
   */
  readonly argumentHint: string | null
  readonly filePath: string
}

export interface CommandScan {
  readonly commands: readonly Command[]
  /** Empty means the scan was clean. Non-empty must reach the UI. */
  readonly problems: readonly Problem[]
}

async function readCommand(
  filePath: string,
  name: string,
): Promise<{ command: Command | null; problem: Problem | null }> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (err) {
    return { command: null, problem: { kind: 'unreadable-file', path: filePath, cause: (err as Error).message } }
  }

  const fm = parseFrontmatter(text)
  if (fm === null) {
    // Unlike an agent, a command with no frontmatter still works — the CLI resolves it by path
    // and runs the whole file. So it is listed, and separately reported: leaving it out would
    // put the office's menu out of step with what typing the name actually does, and the third
    // standing order is that nothing on screen may lie. The author still wants telling that
    // their command will appear with nothing to describe it.
    return {
      command: { name, description: '', argumentHint: null, filePath },
      problem: { kind: 'no-frontmatter', path: filePath },
    }
  }

  const hint = fm['argument-hint']?.trim()

  return {
    command: {
      name,
      description: fm['description'] ?? '',
      argumentHint: hint ? hint : null,
      filePath,
    },
    problem: null,
  }
}

/**
 * Walk one directory of commands, and any beneath it.
 *
 * `namespace` is the path back to `.claude/commands/`, which the CLI joins with colons — the
 * recursion exists to match that, not to be general. A directory that is not there is silently
 * zero; anything else that stops us reading it is a problem.
 */
async function collect(
  dir: string,
  namespace: readonly string[],
  commands: Command[],
  problems: Problem[],
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      problems.push({ kind: 'unreadable-dir', path: dir, cause: (err as Error).message })
    }
    return
  }

  for (const entry of entries.filter((e) => !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      await collect(join(dir, entry.name), [...namespace, entry.name], commands, problems)
      continue
    }

    // Deliberately not `isFile()`: a symlinked command is still a command, and the CLI reads it.
    if (!entry.name.endsWith('.md')) continue

    const filePath = join(dir, entry.name)
    const name = [...namespace, basename(entry.name, extname(entry.name))].join(':')

    const { command, problem } = await readCommand(filePath, name)
    if (command) commands.push(command)
    if (problem) problems.push(problem)
  }
}

/**
 * Scan a workspace for slash commands.
 *
 * Never throws. Sorted by what you type, so a namespaced command sits where somebody scanning
 * the list would look for it rather than where its directory happened to fall.
 */
export async function discoverCommands(root: string): Promise<CommandScan> {
  const commands: Command[] = []
  const problems: Problem[] = []

  await collect(join(root, CLAUDE_DIR, COMMANDS_DIR), [], commands, problems)
  commands.sort((a, b) => a.name.localeCompare(b.name))

  return { commands, problems }
}
