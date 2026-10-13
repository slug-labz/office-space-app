/**
 * The gate is the one thing between an agent running unattended in `acceptEdits` and a shell
 * command nobody approved, and it is two files a person may edit. `approvals.ts` cannot tell you
 * whether it is there: no requests is what a working gate looks like before anybody runs a
 * command, and what no gate looks like forever.
 *
 * The case these tests care most about is `unreadable`. It is the state every surface in this
 * app has got wrong first — the roster warned it could not read the staff and then said "Nobody
 * works here yet" underneath — so most of what is asserted here is that it stays distinct from
 * the answers that mean *we looked and there is no gate*.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { gateLede, gateState, type FileRead, type GateState } from '../src/shared/gate.js'

const WIRED = JSON.stringify({
  hooks: {
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/approval-gate.mjs"', timeout: 300 }] },
    ],
  },
})

const present = (text: string): FileRead => ({ state: 'present', text })
const absent: FileRead = { state: 'absent' }
const unreadable = (cause: string): FileRead => ({ state: 'unreadable', cause })
const hookThere = present('// the gate')

test('the office ships a wired gate, judged from the real settings file', () => {
  // Against the actual shipped stanza rather than the literal above, so the matcher is measured
  // against what this repo installs into people's workspaces. A fixture agreeing with a fixture
  // is what let a top-level `utilization` that never existed be parsed on every run for weeks.
  const real = readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8')
  assert.match(real, /approval-gate\.mjs/, 'the shipped settings no longer name the hook — this test went blind')
  assert.deepEqual(gateState(present(real), hookThere), { state: 'wired' })
})

test('settings claiming a gate whose hook is gone is not the same as no gate asked for', () => {
  // The dangerous one. Settings say a gate runs; the file it names is not on disk. Somebody
  // reading their own settings would conclude they are protected.
  assert.deepEqual(gateState(present(WIRED), absent), { state: 'hook-missing' })

  // And the merely-unconfigured one, which is a different thing to fix.
  assert.deepEqual(gateState(present('{}'), hookThere), { state: 'not-wired' })
  assert.deepEqual(gateState(present('{}'), absent), { state: 'not-wired' })
  assert.deepEqual(gateState(absent, hookThere), { state: 'not-wired' })
})

test('a hook called after the command it should have held is not a gate', () => {
  // `PostToolUse` runs once the command has already gone. Matching the filename anywhere in the
  // file would report this as protected, which is the most confident possible wrong answer.
  const post = JSON.stringify({
    hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/approval-gate.mjs' }] }] },
  })
  assert.deepEqual(gateState(present(post), hookThere), { state: 'not-wired' })
})

test('a moved, requoted or wrapped command is still wired', () => {
  // Matched on the hook's filename inside a PreToolUse command rather than the whole string.
  // Asserting the exact command would report a person who moved their workspace as ungated, and
  // a warning that cries wolf gets muted — after which it protects nobody.
  for (const command of [
    "node '/somewhere/else/.claude/hooks/approval-gate.mjs'",
    'sh -c "node $CLAUDE_PROJECT_DIR/.claude/hooks/approval-gate.mjs"',
    'node ./.claude/hooks/approval-gate.mjs --verbose',
  ]) {
    const settings = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] } })
    assert.deepEqual(gateState(present(settings), hookThere), { state: 'wired' }, command)
  }
})

test('could not look is never reported as looked and found nothing', () => {
  // The whole reason this is a predicate rather than a boolean. Either half unreadable and the
  // answer is that we do not know — checked before every other branch, because each of them
  // would otherwise return a confident answer from half the evidence.
  assert.deepEqual(gateState(unreadable('EACCES'), hookThere), { state: 'unreadable', cause: 'EACCES' })
  assert.deepEqual(gateState(present(WIRED), unreadable('EACCES')), { state: 'unreadable', cause: 'EACCES' })

  // Including when the other half would have produced a definite answer on its own. An
  // unreadable settings file with a missing hook is not `hook-missing`: we never read the stanza
  // that would have claimed one.
  assert.deepEqual(gateState(unreadable('EIO'), absent), { state: 'unreadable', cause: 'EIO' })

  // And settings that will not parse is not settings without a stanza. The gate is not running
  // either way, but "not wired" sends somebody to add a stanza to a file whose problem is a comma.
  const broken = gateState(present('{ "hooks": '), hookThere)
  assert.equal(broken.state, 'unreadable')
})

test('every state says something different, and only one says nothing', () => {
  const states: GateState[] = [
    { state: 'wired' },
    { state: 'hook-missing' },
    { state: 'not-wired' },
    { state: 'unreadable', cause: 'EACCES' },
    { state: 'hooks-off' },
    { state: 'settings-skipped', cause: 'is JSON, but its top level is null, not an object' },
  ]
  const said = states.map(gateLede)
  assert.equal(said.filter((s) => s === null).length, 1, 'exactly one state is the quiet one')
  assert.equal(gateLede({ state: 'wired' }), null, 'a working gate does not announce itself')

  // `typeof`, not `!== null`: a state with no case in the switch comes back `undefined`, and that
  // must not count as a sentence of its own.
  const spoken = said.filter((s): s is string => typeof s === 'string')
  assert.equal(new Set(spoken).size, 5, 'two states share a sentence — then one of them is unsaid')

  // Three of the "no gate" answers must say so plainly (hooks-off has its own file); "could not tell" must
  // not, or it becomes the roster telling somebody nobody works here when it simply could not read.
  //
  // Plainly means this office is never asked, not that commands run unapproved: `approvals.ts`
  // records that under `--print` an unlisted shell command with no gate is refused, and only bypass
  // runs it. Both also hedge, because `readGate` reads `.claude/settings.json` and nothing else.
  const noGate = /never asked to approve a shell command before it runs/
  for (const state of [
    { state: 'hook-missing' },
    { state: 'not-wired' },
    { state: 'settings-skipped', cause: 'is JSON, but its top level is null, not an object' },
  ] as const) {
    const said = gateLede(state) ?? ''
    assert.match(said, noGate, `${state.state} no longer says what a missing gate means`)
    assert.match(said, /unless another/i, `${state.state} claims more than readGate read`)
  }
  const cannot = gateLede({ state: 'unreadable', cause: 'EACCES' }) ?? ''
  assert.doesNotMatch(cannot, noGate, 'not knowing is being reported as knowing')
  assert.match(cannot, /unknown|could not/i)
})
