/**
 * A `claude` that costs nothing.
 *
 * `runClaude` takes a `claudePath`, which makes the CLI adapter testable end to end against a
 * stand-in binary: a real child process, real stdout chunking, real exit codes, and a record of
 * the argv it was actually given. That last part is the point — the flags Office Space passes
 * *are* the behaviour. `--fork-session` is the entire guarantee that asking an agent what it is
 * doing does not become part of the work it is doing, and asserting it against a recorded argv
 * is the difference between that guarantee being tested and being merely intended.
 *
 * Not a mock of the adapter. The adapter under test is the shipping one; only the program on
 * the other end is fake.
 */

import { chmod, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import { tempDir } from './temp-dir.js'

export interface FakeClaudeOptions {
  /** Records to emit as newline-delimited JSON. */
  readonly lines?: readonly unknown[]
  /** Raw stdout instead, for testing partial lines and chunk boundaries. */
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number
}

export interface FakeClaude {
  /** Pass as `claudePath`. */
  readonly path: string
  /** A real directory, usable as `cwd`. */
  readonly dir: string
  /** The arguments the last run was given. */
  argv(): Promise<string[]>
}

const SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
fs.writeFileSync(path.join(__dirname, 'argv.json'), JSON.stringify(process.argv.slice(2)))
if (config.stdout) process.stdout.write(config.stdout)
if (config.stderr) process.stderr.write(config.stderr)
process.exit(config.exitCode || 0)
`

/** `t` is the test the fake belongs to, and its directory is removed when that test ends. */
export async function fakeClaude(t: TestContext, options: FakeClaudeOptions = {}): Promise<FakeClaude> {
  const dir = await tempDir(t, 'office-fake-claude-')
  const path_ = join(dir, 'claude.cjs')

  const stdout =
    options.stdout ??
    (options.lines ?? []).map((line) => JSON.stringify(line)).join('\n') + (options.lines?.length ? '\n' : '')

  await writeFile(
    join(dir, 'config.json'),
    JSON.stringify({ stdout, stderr: options.stderr ?? '', exitCode: options.exitCode ?? 0 }),
  )
  await writeFile(path_, SCRIPT)
  await chmod(path_, 0o755)

  return {
    path: path_,
    dir,
    async argv() {
      return JSON.parse(await readFile(join(dir, 'argv.json'), 'utf8')) as string[]
    },
  }
}

// ─────────────────────────────────────────────────────────── record builders ──

export const init = (sessionId: string) => ({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  model: 'claude-opus-4',
  cwd: '/somewhere',
  tools: ['Read'],
  agents: ['manager'],
})

export const assistantText = (text: string) => ({
  type: 'assistant',
  message: { model: 'claude-opus-4', content: [{ type: 'text', text }] },
})

export const result = (isError: boolean, text = 'done', costUsd: number | null = 0.0123) => ({
  type: 'result',
  is_error: isError,
  result: text,
  total_cost_usd: costUsd,
  num_turns: 1,
  duration_ms: 42,
})
