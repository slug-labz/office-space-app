/**
 * The approval gate and the hooks panel must not come to disagree about the same file.
 *
 * They walked `settings.hooks` twice — the panel to enumerate every registration, the gate to
 * answer one yes/no about whether `PreToolUse` names `approval-gate.mjs`. Two traversals of one
 * tree is two places for the tolerances to drift, and here **the tolerances are the behaviour**:
 * nearly every branch of that walk is about what to skip. A `hooks` block that is a string, a
 * stanza that is a number, an entry with no `command` — each must be stepped over, because one
 * malformed line must not cost a person the sight of the ones beside it.
 *
 * ## What this file does and does not answer
 *
 * It answers *"does the shared walk find the same `PreToolUse` commands the inline walk found"* —
 * the structural tolerances, which is what a refactor is most likely to break. It does **not**
 * answer *"is the gate correct"*, and it cannot: a differential test compares two implementations,
 * so an omission they share is invisible by construction, at 24 shapes or at 2,400.
 *
 * They shared four, found by review and not by this file: a matcher of `Read` and a hook of type
 * `prompt` both reported a wired gate that could never fire. Those live in
 * `a-gate-that-cannot-fire-is-not-a-gate.test.ts`, which states expected answers instead of
 * comparing two of them, and the shipped `callsTheHook` has **deliberately diverged** from the old
 * body to fix them. So the comparison below is between two transcriptions of the *walk*, not
 * between the old gate and the shipped one — which is what it was always doing, and is worth
 * saying rather than leaving to be discovered.
 *
 * ## Why a differential test and not six more cases
 *
 * `gateState` decides whether somebody is warned that the thing standing between an unattended
 * agent and an unapproved shell command is missing. A wrong `not-wired` cries wolf; a wrong
 * `wired` hides the very thing the check exists to find, which is the worse direction. Six
 * hand-written cases prove the shapes somebody thought of. This runs the **old implementation and
 * the new one over the same inputs** and requires identical answers, so the shapes nobody thought
 * of are covered too — including the ones this file's author would have got wrong.
 *
 * The old body is kept here rather than in the source. It is not a second implementation to
 * maintain: it is the record of what the behaviour *was*, and the day it stops matching is the day
 * somebody changed the gate's mind about a file without meaning to.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { declaredIn } from '../src/shared/hooks.js'

const HOOK_FILE = 'approval-gate.mjs'

/**
 * `callsTheHook` exactly as it stood before the walk was shared. Verbatim, deliberately — a
 * tidied copy would be testing the tidying.
 */
function callsTheHookAsItWas(settings: unknown): boolean {
  if (settings === null || typeof settings !== 'object') return false
  const hooks = (settings as Record<string, unknown>)['hooks']
  if (hooks === null || typeof hooks !== 'object') return false
  const pre = (hooks as Record<string, unknown>)['PreToolUse']
  if (!Array.isArray(pre)) return false

  for (const matcher of pre) {
    if (matcher === null || typeof matcher !== 'object') continue
    const list = (matcher as Record<string, unknown>)['hooks']
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      if (entry === null || typeof entry !== 'object') continue
      const command = (entry as Record<string, unknown>)['command']
      if (typeof command === 'string' && command.includes(HOOK_FILE)) return true
    }
  }
  return false
}

/**
 * The same question asked through the shared walk.
 *
 * Deliberately *not* the shipped `callsTheHook`, which now also reads `matcher` and `unknownType`.
 * This isolates the walk, which is the thing the refactor moved; the shipped gate's behaviour is
 * pinned next door by expected answers.
 */
function sameQuestionViaTheWalk(settings: unknown): boolean {
  return declaredIn(settings).some((r) => r.event === 'PreToolUse' && r.command.includes(HOOK_FILE))
}

const wired = (command: string): unknown => ({
  hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command }] }] },
})

/**
 * Shapes, including the ones a person writing this by hand would not think of.
 *
 * Named, because a failure has to say which shape disagreed rather than "index 23".
 */
const SHAPES: readonly (readonly [string, unknown])[] = [
  ['null', null],
  ['undefined', undefined],
  ['a string', 'hooks'],
  ['a number', 7],
  ['an array', []],
  ['no hooks key', { permissions: {} }],
  ['hooks is a string', { hooks: 'PreToolUse' }],
  ['hooks is null', { hooks: null }],
  ['hooks is an array', { hooks: [] }],
  ['no PreToolUse', { hooks: { PostToolUse: [] } }],
  ['PreToolUse is a string', { hooks: { PreToolUse: 'x' } }],
  ['PreToolUse is empty', { hooks: { PreToolUse: [] } }],
  ['stanza is null', { hooks: { PreToolUse: [null] } }],
  ['stanza is a number', { hooks: { PreToolUse: [3] } }],
  ['stanza has no hooks list', { hooks: { PreToolUse: [{ matcher: '*' }] } }],
  ['stanza hooks is a string', { hooks: { PreToolUse: [{ hooks: 'no' }] } }],
  ['entry is null', { hooks: { PreToolUse: [{ hooks: [null] }] } }],
  ['entry has no command', { hooks: { PreToolUse: [{ hooks: [{ type: 'command' }] }] } }],
  ['command is a number', { hooks: { PreToolUse: [{ hooks: [{ command: 5 }] }] } }],
  ['command is empty', { hooks: { PreToolUse: [{ hooks: [{ command: '' }] }] } }],
  ['command is whitespace', { hooks: { PreToolUse: [{ hooks: [{ command: '   ' }] }] } }],
  ['the shipped stanza', wired('node "$CLAUDE_PROJECT_DIR/.claude/hooks/approval-gate.mjs"')],
  ['requoted', wired("node '/somewhere/else/.claude/hooks/approval-gate.mjs'")],
  ['wrapped in a shell', wired('sh -c "node .claude/hooks/approval-gate.mjs"')],
  ['a different hook', wired('node .claude/hooks/something-else.mjs')],
  ['named only in PostToolUse', { hooks: { PostToolUse: [{ hooks: [{ command: `node ${HOOK_FILE}` }] }] } }],
  ['in Pre and Post', {
    hooks: {
      PostToolUse: [{ hooks: [{ command: `node ${HOOK_FILE}` }] }],
      PreToolUse: [{ hooks: [{ command: `node ${HOOK_FILE}` }] }],
    },
  }],
  ['second entry is the gate', {
    hooks: { PreToolUse: [{ hooks: [{ command: 'node other.mjs' }, { command: `node ${HOOK_FILE}` }] }] },
  }],
  ['second stanza is the gate', {
    hooks: { PreToolUse: [{ hooks: [{ command: 'node other.mjs' }] }, { hooks: [{ command: `node ${HOOK_FILE}` }] }] },
  }],
  ['a bad stanza before a good one', {
    hooks: { PreToolUse: [null, { hooks: [{ command: `node ${HOOK_FILE}` }] }] },
  }],
  // Leading and trailing space: the new walk trims commands and the old one did not. Both must
  // still find the filename inside, and this is the case where a trim could have changed an answer.
  ['padded command', wired(`   node ${HOOK_FILE}   `)],
]

test('the two readings agree on every shape, including the malformed ones', () => {
  const disagreed = SHAPES.filter(([, v]) => callsTheHookAsItWas(v) !== sameQuestionViaTheWalk(v)).map(([name]) => name)
  assert.deepEqual(
    disagreed,
    [],
    `the gate changed its mind about these shapes when it started using the shared walk: ${disagreed.join(', ')}`,
  )
})

test('the shapes are not all answering the same way, or the comparison proves nothing', () => {
  /*
   * The check on the check. Thirty inputs that all return `false` would compare equal under any
   * two implementations, including a `callsTheHook` that had been replaced with `() => false` —
   * which is the mutation that matters, since it reports a wired office as ungated.
   */
  const yes = SHAPES.filter(([, v]) => sameQuestionViaTheWalk(v)).length
  assert.ok(yes >= 5, `only ${yes} shapes are wired; the comparison is mostly comparing false to false`)
  assert.ok(yes < SHAPES.length - 5, `only ${SHAPES.length - yes} shapes are unwired; same problem, other way`)
})

test('a hook named only after the fact is still not a gate', () => {
  // The one discrimination that must survive the refactor, asserted directly rather than left to
  // the comparison: `PostToolUse` runs after the command it was supposed to hold.
  const post = { hooks: { PostToolUse: [{ hooks: [{ command: `node ${HOOK_FILE}` }] }] } }
  assert.equal(sameQuestionViaTheWalk(post), false)
  assert.equal(callsTheHookAsItWas(post), false)
})
