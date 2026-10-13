/**
 * Whether the agents in this workspace have any standing instructions.
 *
 * `CLAUDE.md` at the root is the file every agent Claude Code starts here reads first, and it was
 * the one item on VISION's list of what a `.claude/` workspace holds — *"agents, skills, hooks,
 * commands, MCPs, memory, projects, and a main instruction file"* — that the office showed
 * nothing about.
 *
 * Not a hypothetical gap. `scripts/build.mjs` shipped a manifest that did not carry `CLAUDE.md`,
 * so no installed office ever received one: every agent in every packaged workspace ran with no
 * standing instructions, and nothing anywhere said so.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, rm, chmod, cp } from 'node:fs/promises'
import { join } from 'node:path'

import { readGate, readInstructions } from '../src/main/instructions.js'

import { tempDir } from './temp-dir.js'

async function workspace(t: TestContext): Promise<string> {
  return tempDir(t, 'office-instructions-')
}

test('a workspace with an instruction file says so, with its size', async (t) => {
  const root = await workspace(t)
  await writeFile(join(root, 'CLAUDE.md'), '# Office\n\nStanding orders.\n', 'utf8')
  const got = await readInstructions(root)
  assert.equal(got.state, 'present')
  assert.equal(got.state === 'present' ? got.bytes > 0 : false, true)
})

test('a workspace with none says absent, which is the case this exists for', async (t) => {
  // The state every packaged office was in, invisibly, until the manifest was fixed.
  assert.deepEqual(await readInstructions(await workspace(t)), { state: 'absent' })
})

test('a file that will not open is not a file that is not there', async (t) => {
  /*
   * The distinction the whole codebase turns on, and here it decides what somebody is told to
   * do: write a CLAUDE.md, or go and look at the permissions on the one they already have.
   * Somebody sent to create a file that exists has been sent the wrong way by a panel trying to
   * help.
   */
  const root = await workspace(t)
  await writeFile(join(root, 'CLAUDE.md'), '# Office\n', 'utf8')
  await chmod(join(root, 'CLAUDE.md'), 0o000)
  const got = await readInstructions(root)
  // Reading metadata still works at mode 000 — `stat` does not open the file — so this is
  // honestly `present` on a POSIX box. The branch exists for the errors that are not ENOENT.
  assert.notEqual(got.state, 'absent', 'a file that exists was reported as never written')
})

test('a directory called CLAUDE.md is not an instruction file', async (t) => {
  // Reporting it present would send somebody looking for content in a thing that has none.
  const root = await workspace(t)
  await mkdir(join(root, 'CLAUDE.md'))
  const got = await readInstructions(root)
  assert.equal(got.state, 'unreadable')
  assert.match(got.state === 'unreadable' ? got.cause : '', /not a file/)
})

// ── the gate, read from an actual workspace ─────────────────────────────────────────────────

test('the gate is read from both its halves on disk', async (t) => {
  /*
   * `gateState` is tested against literals and the first-run panel is tested against its four
   * states. Between them sat the function that actually opens the two files, and a mutation
   * making it never read the hook survived everything — `hook-missing` became unreachable and
   * nothing failed.
   *
   * That is the shape CLAUDE.md names: a suite complete about everything downstream of a
   * decision, never asking the decision. I had checked this by hand and moved on, which is not
   * the same as a test and is why the mutation found it.
   *
   * Read against the real `.claude/` this repository ships, so the matcher is measured against
   * the stanza actually installed rather than one written to match it.
   */
  const root = await workspace(t)
  // The two files `readGate` opens, and nothing else from `.claude/`. The whole directory is
  // more than the repository ships: in a checkout where parallel sessions work it also holds
  // `.claude/worktrees/`, their git worktrees, which `du -sk` put at 2.8 GB in the main checkout
  // on 2026-09-16, and this test used to copy all of it on every run. A file `readGate` comes to
  // read belongs in this list.
  for (const half of ['settings.json', join('hooks', 'approval-gate.mjs')]) {
    await cp(join(process.cwd(), '.claude', half), join(root, '.claude', half))
  }

  assert.deepEqual(await readGate(root), { state: 'wired' })

  // The half a person can remove, and which reconcile deliberately will not put back.
  await rm(join(root, '.claude', 'hooks', 'approval-gate.mjs'), { force: true })
  assert.deepEqual(await readGate(root), { state: 'hook-missing' })

  // And with nothing wiring it, the hook's presence is beside the point.
  await rm(join(root, '.claude', 'settings.json'), { force: true })
  assert.deepEqual(await readGate(root), { state: 'not-wired' })
})

test('a workspace with no .claude at all is not wired, and does not throw', async (t) => {
  // The first thing a fresh directory is, and it must produce an answer rather than an error.
  assert.deepEqual(await readGate(await workspace(t)), { state: 'not-wired' })
})
