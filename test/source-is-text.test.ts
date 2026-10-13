/**
 * No source file may contain a control byte, because grep goes blind on the ones that do.
 *
 * A file holding a raw NUL is treated as binary by grep, which then reports **no matches** —
 * not an error, not a warning, exit 1 and a silent zero. Every grep-shaped check anybody runs
 * against that file, forever, quietly answers "nothing here".
 *
 * This is not hypothetical. `src/shared/refusals.ts:159` shipped with two literal NULs in a
 * template literal — somebody meant the escape and typed the byte:
 *
 *     const key = `${refusal.tool}<NUL>${text}<NUL>${refusal.cause}`
 *
 * NUL is the right separator there. A tool name and a command can each contain nearly anything,
 * and NUL is the one character neither can hold. Nothing about the design was wrong; only the
 * byte, and `\u0000` produces exactly the same string at runtime.
 *
 * ## What it cost before anybody noticed
 *
 * On the night of 2026-08-26 the second session made the same mistake in `main.ts`, then ran four
 * greps to establish that a freshly hardened module "had no caller anywhere in src" and was
 * therefore dead code. Every one of those greps returned nothing because every one of them was
 * reading a file grep had decided was binary. Four measurements agreed, and they agreed because
 * they shared a blind spot rather than because they were true. The module was wired the whole
 * time.
 *
 * That is the lesson worth keeping past this one byte: **consistency is not corroboration when
 * every check asks the same broken question.** A tool that declines to answer and a tool that
 * answers "no" are indistinguishable at the shell, and only one of them is honest.
 *
 * Tab, newline and carriage return are the three control characters a source file legitimately
 * holds. Everything below 0x20 otherwise is a typo nobody can see.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Tab, line feed, carriage return. The three a text file is allowed. */
const ALLOWED = new Set([0x09, 0x0a, 0x0d])

/**
 * Directories that are somebody else's, and are not ours to police.
 *
 * `node_modules` is obvious. `.claude/worktrees` is less so: it holds whole checkouts made by
 * agents, each with its own `node_modules`, and walking it turns a check about this repository
 * into a check about every dependency any agent ever installed. It is also not shipped — the
 * bundle filter excludes it, and `persistence.test.ts` fails if that ever stops being true.
 */
const NOT_OURS = new Set(['node_modules', 'worktrees', '.git', 'release', 'dist'])

async function textFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    if (NOT_OURS.has(entry.name)) continue
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await textFiles(path)))
    else if (/\.(ts|tsx|js|mjs|css|html|json|md)$/.test(entry.name)) out.push(path)
  }
  return out
}

test('no source file contains a control byte that makes grep go blind', async () => {
  const offenders: string[] = []

  // `.claude` is the reason this list grew.
  //
  // The rule at the top of this file is about *source files*, and it was enforced on the three
  // directories holding TypeScript. `.claude/` is the product's own data — seven agent prompts,
  // five skills, six commands, a `settings.json` the app parses on every launch, and a `.mjs`
  // hook that stands between a tool call and the filesystem. A NUL in any of those blinds grep
  // exactly where it is used most: agents' prompts are searched constantly, and the incident
  // this file records was four greps agreeing because they shared a blind spot.
  //
  // `docs/` and `planning/` are here for a smaller reason — they are read by people and by
  // grep, and a file that cannot be searched is a file that stops being found.
  for (const dir of ['src', 'test', 'scripts', '.claude', 'docs', 'planning']) {
    for (const file of await textFiles(dir)) {
      const bytes = await readFile(join(root, file))
      for (const [index, byte] of bytes.entries()) {
        if (byte >= 0x20 || ALLOWED.has(byte)) continue
        // Which line, so the fix is one jump rather than a hunt through a file the editor
        // renders as if nothing were wrong.
        const line = bytes.subarray(0, index).toString('utf8').split('\n').length
        offenders.push(`${relative(root, join(root, file))}:${line} holds byte 0x${byte.toString(16).padStart(2, '0')}`)
        break
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'grep reports NO MATCHES on a file it thinks is binary — silently, exit 1, no warning. ' +
      'Write the escape (\\u0000) rather than the byte: the runtime string is identical and the ' +
      `file stays searchable.\n  ${offenders.join('\n  ')}`,
  )
})
