/**
 * How much of a failure a person is told about.
 *
 * This function decides that, and until now it lived inside `app.ts` where nothing could reach
 * it — which is why it was wrong for a year in one direction and then, briefly, wrong in the
 * other. Both mistakes are pinned below, because the second is the one that would have shipped:
 * it is the repair for the first, applied one step too far.
 *
 * The rule, in one line: **a `detail` stands alone; everything else gets its path.**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { describeProblem } from '../src/shared/problem-view.js'

// ────────────────────────────── the original fault: the class, and not the thing ──

test('an unreadable file names the file and the reason, not just its category', () => {
  // What this used to render, in full: "unreadable-file". Not which file, not why. The fourth
  // standing order is that a file you could not read is reported — reporting that *a* file
  // could not be read keeps the letter of it and none of the use.
  assert.equal(
    describeProblem({ kind: 'unreadable-file', path: '.mcp.json', cause: 'EACCES' }),
    '.mcp.json — EACCES',
  )
})

test('an unreadable directory is treated the same way', () => {
  assert.equal(
    describeProblem({ kind: 'unreadable-dir', path: '.claude/commands', cause: 'EPERM' }),
    '.claude/commands — EPERM',
  )
})

test('a problem carrying only a path still says which file it was about', () => {
  assert.equal(
    describeProblem({ kind: 'no-frontmatter', path: '.claude/agents/tester.md' }),
    '.claude/agents/tester.md — no-frontmatter',
  )
})

// ─────────────────────────── the repair applied too far: burying a written sentence ──

test('a detail stands alone — the producer wrote a sentence to be read on its own', () => {
  // The first-run panel is the one screen a new user cannot avoid, and every problem on it is a
  // `lint` whose `detail` is already a complete instruction. Prefixing the workspace root to
  // "The office cannot find the claude command… Run `which claude`" puts an absolute path in
  // front of the only words that help.
  const claude = {
    kind: 'lint',
    path: '/Users/someone/office-space',
    rule: 'no-claude-on-path',
    detail: 'The office cannot find the `claude` command. Run `which claude` in your terminal.',
  }

  assert.equal(describeProblem(claude), claude.detail)
})

test('the billing warning does not gain the word "environment"', () => {
  // `path: 'environment'` is a placeholder for a problem that is not about a file at all.
  assert.equal(
    describeProblem({ kind: 'lint', path: 'environment', rule: 'billing-redirected', detail: 'Requests are billed to X.' }),
    'Requests are billed to X.',
  )
})

test('an empty detail is not a sentence, so the path comes back', () => {
  assert.equal(
    describeProblem({ kind: 'unreadable-file', path: '.mcp.json', cause: 'ENOENT', detail: '' }),
    '.mcp.json — ENOENT',
  )
})

// ─────────────────────────────────────────────────────────── nothing to describe ──

test('a problem that is not an object does not throw and does not invent detail', () => {
  assert.equal(describeProblem(null), 'unknown')
  assert.equal(describeProblem(undefined), 'unknown')
  assert.equal(describeProblem('EACCES'), 'unknown')
})

test('an object with nothing recognisable says so rather than rendering [object Object]', () => {
  assert.equal(describeProblem({}), 'unknown')
})

test('a path with no cause and no kind still leads with the path', () => {
  assert.equal(describeProblem({ path: 'somewhere' }), 'somewhere — unknown')
})
