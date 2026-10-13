/**
 * A matcher made only of names is a list of names, not a regular expression.
 *
 * Claude Code's hooks reference sorts a `matcher` by the characters in it. `"*"`, `""` or none
 * matches every tool. One made only of letters, digits, `_`, `-`, spaces, `,` and `|` is an exact
 * tool name, or a list of them split on `|` or `,` with whitespace allowed around each, so `Bash`
 * matches the Bash tool and nothing else. Anything else is a JavaScript regular expression, tested
 * unanchored. (Hooks reference, "Matcher patterns", read 2026-09-16.)
 *
 * `couldHoldACommand` tested every matcher as an unanchored regular expression, which went wrong
 * both ways:
 *
 *     Bas, ash, Edit|Bas     wired       no tool has that name, so the gate never fires on Bash
 *     Bash, Edit             not-wired   a list naming Bash, so the gate does fire on it
 *
 * The first is the direction nothing warns about: `wired` is the one answer the panel stays quiet
 * for.
 *
 * These tests pin the current rules. Comma lists and whitespace around separators arrived in
 * v2.1.191, and hyphens joined the exact set in v2.1.195; the changelog lists both as fixes. The
 * pull request says why the office does not try to model the versions before them.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { gateState } from '../src/shared/gate.js'

const HOOK = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/approval-gate.mjs"'

/** The verdict on a settings file whose one stanza calls the gate under `matcher`, hook on disk. */
function verdictFor(matcher: string): string {
  const text = JSON.stringify({ hooks: { PreToolUse: [{ matcher, hooks: [{ type: 'command', command: HOOK }] }] } })
  return gateState({ state: 'present', text }, { state: 'present', text: '#!/usr/bin/env node\n' }).state
}

/*
 * Every one of these, read as an unanchored regular expression, matches inside "Bash", and none
 * of them names the Bash tool. The last three also carry a digit and `_`, a hyphen, and a comma
 * with spaces, so each character the exact set allows is used by a matcher that must stay on it.
 */
for (const matcher of ['Bas', 'ash', 'B', 'Edit|Bas', 'Bas|mcp__tool_2', 'Bas|code-reviewer', 'Bas|Edit, Write']) {
  test(`a matcher naming no tool called Bash is not a gate on shell commands: ${JSON.stringify(matcher)}`, () => {
    assert.equal(verdictFor(matcher), 'not-wired')
  })
}

/*
 * Four more that never fire on Bash in the CLI, each of which a looser reading would call a gate:
 * - a tab is not in the exact set, so `Edit,\tBash` is a pattern, and it doesn't match;
 * - a list of nothing but separators names no tool;
 * - a space belongs to a name and doesn't separate names;
 * - the exact set is ASCII, so `Édit,Bash` is a pattern too.
 * The review of #250 found that each of these passed every test while a mutation widened the
 * reading.
 */
for (const matcher of ['Edit,\tBash', '|', 'Bash Edit', 'Édit,Bash']) {
  test(`a matcher the CLI never fires on Bash is not a gate: ${JSON.stringify(matcher)}`, () => {
    assert.equal(verdictFor(matcher), 'not-wired')
  })
}

/*
 * Lists that name Bash, which the regular-expression reading said could not match it. Bash first,
 * Bash last, spaces around a separator, a bare comma, and a comma beside a hyphenated name.
 */
for (const matcher of ['Bash, Edit', 'Edit, Bash', 'Edit | Bash', 'Edit,Bash', 'Bash,code-reviewer']) {
  test(`a list that names Bash is a gate on shell commands: ${JSON.stringify(matcher)}`, () => {
    assert.equal(verdictFor(matcher), 'wired')
  })
}

test('a name that only begins with Bash is another tool', () => {
  // `BashOutput` is a tool of its own. Matching names by containment would count it as Bash.
  assert.equal(verdictFor('BashOutput'), 'not-wired')
})

test('an exact name is matched with its case', () => {
  assert.equal(verdictFor('bash'), 'not-wired')
})

test('a matcher with any other character is still an unanchored regular expression', () => {
  // The dot and the caret put these on the regular-expression path, and each matches inside
  // "Bash" only because nothing anchors the pattern at both ends.
  assert.equal(verdictFor('as.'), 'wired')
  assert.equal(verdictFor('^Bas'), 'wired')
})
