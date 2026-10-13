#!/usr/bin/env node
/**
 * What an agent must confirm before it writes a line of code.
 *
 * ## Why this exists
 *
 * On the night of 2026-08-26 six sub-agents were run in parallel worktrees against one
 * integration branch. Every worktree was created from a commit **156 behind the branch they were
 * briefed against**. What that cost, measured:
 *
 *   - one stream built its entire feature on the stale tree, reported "114 tests" where the
 *     branch has 980, and had to be sent back — 16 minutes and 179,000 tokens, discarded
 *   - four other streams each independently discovered the same fact, diagnosed it, and
 *     self-corrected: four separate agents paying to learn one thing
 *   - the redo brief had to list four canary facts by hand, because the failure is invisible
 *     from inside: a stale checkout typechecks, builds, and passes its own smaller suite
 *
 * That last point is the whole argument. **A wrong base does not look wrong.** Everything is
 * green; the tree is simply not the one anybody meant. It is the same shape as the bug this
 * repository keeps finding — something correct in isolation and unreachable from where it
 * matters — and the answer is the same: make the machine check, rather than hope the reader
 * notices.
 *
 * ## What it does not do
 *
 * It does not run the test suite. A full run is minutes, this must be seconds, and a suite that
 * passes proves nothing about *which* tree passed it — the stale tree passed its own suite too.
 * Identity is the question, so identity is what is checked.
 *
 * ## Usage
 *
 *     node scripts/preflight.mjs <expected-ref>
 *
 * Exit 0 and print the tree's identity, or exit 1 and print the exact command that fixes it.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The tree you are standing in — not the tree this file was loaded from.
 *
 * Derived from the script's own path at first, which is wrong in exactly the case that matters:
 * an agent in a worktree invoking it by absolute path from the parent checkout would have
 * verified the parent and been told everything was fine. Caught by running it that way, which is
 * the only reason it is not still there.
 */
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

/**
 * Files that did not exist 156 commits ago.
 *
 * A second opinion on the same question git already answers, and worth its four lines: a
 * worktree can be handed to an agent in a state where the ref check is inconclusive — detached,
 * grafted, shallow — and "does the file my brief names actually exist" is the question the agent
 * was about to answer by hand anyway. Cheap, and it fails loudly rather than subtly.
 */
const CANARIES = [
  'src/main/workspace-root.ts',
  'src/shared/session/mode.ts',
  'src/renderer/views/switcher.ts',
  '.claude/skills/explore-options/SKILL.md',
]

const expected = process.argv[2]
if (!expected) {
  console.error('usage: node scripts/preflight.mjs <expected-ref>')
  process.exit(1)
}

const fail = (what, fix) => {
  console.error(`\npreflight FAILED — ${what}\n`)
  console.error(`  ${fix}\n`)
  console.error('Do not write code until this passes. A stale tree typechecks, builds, and passes')
  console.error('its own smaller suite — being green proves nothing about which tree you are on.\n')
  process.exit(1)
}

let target
try {
  target = git('rev-parse', expected)
} catch {
  fail(`the ref "${expected}" does not exist in this checkout`, `check the name — the orchestrator's branch may not be fetched here`)
}

const head = git('rev-parse', 'HEAD')
const base = git('merge-base', 'HEAD', target)

// Behind: the branch has commits this tree has never seen. The failure the night was built on.
if (base !== target) {
  const behind = git('rev-list', '--count', `${base}..${target}`)
  fail(
    `this worktree is ${behind} commits behind ${expected}`,
    `git reset --hard ${expected}`,
  )
}

for (const canary of CANARIES) {
  if (!existsSync(join(ROOT, canary))) {
    fail(
      `${canary} is missing, so this is not the tree your brief describes`,
      `git reset --hard ${expected}`,
    )
  }
}

/**
 * The toolchain, which is its own repeated discovery.
 *
 * Every agent that night found an empty `node_modules` and independently decided to symlink the
 * parent checkout's. That is the right call — a fresh install per worktree costs minutes and a
 * network — but five agents each spending a turn to reach it is four turns wasted.
 */
if (!existsSync(join(ROOT, 'node_modules', 'typescript'))) {
  /**
   * `npm ci` first, and the symlink second with a warning attached.
   *
   * The order used to be reversed, and it was a trap of this script's own making. `.gitignore`
   * read `node_modules/` — with a trailing slash, which matches a directory and does **not**
   * match a symlink of that name. So the sequence this script recommended was: run preflight,
   * follow its fix, `git add -A`, and commit an absolute path that means nothing on anybody
   * else's machine.
   *
   * The gitignore is fixed, so the symlink is safe now. It stays second anyway: a real install
   * is what a fresh checkout has, and advice that only works because of a rule somewhere else
   * is advice that breaks when somebody tidies that rule.
   */
  fail(
    'node_modules is missing or incomplete, so nothing can be verified here',
    `npm ci    # or, to borrow the parent checkout's:  ln -s "$(git rev-parse --show-toplevel)/node_modules" node_modules`,
  )
}

const ahead = git('rev-list', '--count', `${target}..HEAD`)
console.log('preflight OK')
console.log(`  HEAD      ${head.slice(0, 7)}${ahead === '0' ? '' : `  (${ahead} of your own commits on top)`}`)
console.log(`  based on  ${target.slice(0, 7)} — ${expected}`)
console.log(`  canaries  ${CANARIES.length}/${CANARIES.length} present`)
console.log(`  toolchain node_modules reachable`)
