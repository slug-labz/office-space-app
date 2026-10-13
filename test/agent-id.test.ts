/**
 * Two guards on agent names, and the relationship between them that nothing was checking.
 *
 * The module was parked as *"exercised through roster.ts, not aimed at"* — which is true, and is
 * the reason both of its bugs reached a release. Being exercised is not being asked.
 *
 * ## The two, and why there are two
 *
 * `whyInvalid` is the rule for a name somebody is **choosing**: lowercase, hyphens, no dots. It
 * belongs at `hire`, the only place a name gets chosen.
 *
 * `whyUnsafeAsPath` is the rule for a name the office **found**. `fire`, `disable` and `enable`
 * receive whatever `readdir` returned, and hand-writing an agent file is the documented way to
 * add one — `roster.ts` opens by saying so.
 *
 * ## Both directions have already shipped
 *
 * Too loose: `fire('../skills/victim')` was an `unlink` in another directory.
 *
 * Too strict: putting `whyInvalid` on those three made the office refuse to act on rows it had
 * drawn itself. `Reviewer.md`, `my_helper.md` and `data.scientist.md` are all discovered, all
 * drawn with a Send home and a Fire button, and all answered with a complaint about a name the
 * user never typed. I fixed that one during the merge, and left the guard with no test.
 *
 * The module states the relationship: *"the set of names the office can draw is wider than the
 * set `whyInvalid` accepts."* Wider is a claim about two functions, so it is asserted as one —
 * against every name in this file, in both directions, rather than as a sentence in a comment.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve, dirname } from 'node:path'

import { isValidAgentId, whyInvalid, whyUnsafeAsPath } from '../src/shared/agent-id.js'

/** Names a person would choose. Both guards must accept every one. */
const CHOSEN = ['reviewer', 'builder', 'memory-keeper', 'a', 'a1', 'agent-2', '0', 'x'.repeat(64)]

/**
 * Names the office can genuinely find in `agents/`, and must be able to act on.
 *
 * Every one of these is a legal directory entry that `whyInvalid` refuses — which is exactly the
 * gap the second bug lived in.
 */
const FOUND_ON_DISK = ['Reviewer', 'my_helper', 'data.scientist', 'Agent Smith', 'ünicode', 'a'.repeat(200)]

/** Names that cannot be a single entry inside `agents/`, whatever anybody typed. */
const DANGEROUS = [
  '../skills/victim',
  '..',
  '.',
  '../../etc/passwd',
  'a/b',
  'a\\b',
  '..\\..\\windows',
  '.hidden',
  '',
  // Escapes, never the bytes themselves. The first draft of this file carried the raw
  // characters — and `test/source-is-text.test.ts` failed naming the line, while `grep -c` on
  // this very file reported nothing at all, because grep had decided it was binary. The check
  // that exists for that caught it inside a minute.
  'has\u0000nul',
  'bell\u0007',
  'del\u007f',
]

test('a name somebody chose passes both guards', () => {
  for (const name of CHOSEN) {
    assert.equal(whyInvalid(name), null, `whyInvalid refused ${JSON.stringify(name)}`)
    assert.equal(whyUnsafeAsPath(name), null, `whyUnsafeAsPath refused ${JSON.stringify(name)}`)
    assert.equal(isValidAgentId(name), true, `isValidAgentId refused ${JSON.stringify(name)}`)
  }
})

test('a name the office found on disk is one it can act on', () => {
  // The second bug, stated as the assertion that catches it. Each of these is a real file
  // somebody wrote by hand, drawn on the roster with buttons on it.
  for (const name of FOUND_ON_DISK) {
    assert.equal(
      whyUnsafeAsPath(name),
      null,
      `the office draws ${JSON.stringify(name)} with a Send home and a Fire button and then ` +
        `refuses to act on it, complaining about a name the user never typed`,
    )
  }

  // The control. If `whyInvalid` accepted these too, the list would prove nothing about the gap
  // between the two guards — it would just be a list of ordinary names.
  const alsoValid = FOUND_ON_DISK.filter((n) => whyInvalid(n) === null)
  assert.deepEqual(
    alsoValid,
    [],
    `these were meant to be names only the looser guard accepts, and whyInvalid accepts them ` +
      `too: ${alsoValid.join(', ')}`,
  )
})

test('a name that is really a path is refused, and says why', () => {
  for (const name of DANGEROUS) {
    const why = whyUnsafeAsPath(name)
    assert.ok(why, `whyUnsafeAsPath accepted ${JSON.stringify(name)} — fire() on it is an unlink somewhere else`)
    assert.ok(why.length > 10, `the refusal of ${JSON.stringify(name)} is too terse to act on: ${JSON.stringify(why)}`)
  }
})

test('nothing the path guard accepts can leave the agents directory', () => {
  // The property, rather than the spelling. A future guard that allowed dots for readability
  // would keep every naming assertion above green and fail this.
  const agents = resolve('/tmp/office-agents')

  for (const name of [...CHOSEN, ...FOUND_ON_DISK]) {
    assert.equal(whyUnsafeAsPath(name), null, `precondition: ${JSON.stringify(name)} should be accepted`)
    const where = resolve(agents, `${name}.md`)
    assert.equal(
      dirname(where),
      agents,
      `${JSON.stringify(name)} lands in ${dirname(where)} rather than ${agents} — a name the ` +
        `guard accepted is more than one path component`,
    )
  }

  for (const name of DANGEROUS.filter((n) => n !== '')) {
    const where = resolve(agents, `${name}.md`)
    const escapes = dirname(where) !== agents
    if (escapes) {
      assert.ok(whyUnsafeAsPath(name), `${JSON.stringify(name)} escapes to ${dirname(where)} and the guard allowed it`)
    }
  }
})

test('the path guard is strictly looser than the choosing guard', () => {
  // The relationship the module states in prose. Asserted, because it is the thing that broke:
  // the too-strict bug was `whyInvalid` used where `whyUnsafeAsPath` belonged, and nothing said
  // those were different sizes.
  const everyName = [...CHOSEN, ...FOUND_ON_DISK, ...DANGEROUS]

  const contradictions = everyName.filter((n) => whyInvalid(n) === null && whyUnsafeAsPath(n) !== null)
  assert.deepEqual(
    contradictions,
    [],
    `these are accepted as a chosen name and refused as a path, which cannot both be right — ` +
      `hire would create a file that fire could never remove: ${contradictions.join(', ')}`,
  )

  // And the gap is real rather than the two being the same function twice.
  const onlyLooser = everyName.filter((n) => whyUnsafeAsPath(n) === null && whyInvalid(n) !== null)
  assert.ok(
    onlyLooser.length > 0,
    'no name is accepted by the path guard and refused by the choosing guard, so the two are the ' +
      'same rule written twice — and the office is back to refusing rows it drew itself',
  )
})

test('a dot inside a name is fine; a name that is only dots is not', () => {
  // The distinction the looser guard exists to make, and the one a blanket "no dots" rule loses.
  assert.equal(whyUnsafeAsPath('data.scientist'), null)
  assert.equal(whyUnsafeAsPath('release-1.2'), null)
  assert.ok(whyUnsafeAsPath('.'))
  assert.ok(whyUnsafeAsPath('..'))
  assert.ok(whyUnsafeAsPath('.hidden'), 'a leading dot is a hidden file, not an agent')
})

test('a control character is refused, because the kernel stops reading at one', () => {
  // Cannot arrive from readdir; can arrive across the bridge. A NUL truncates the path at the
  // syscall, so two different names become one file.
  assert.ok(whyUnsafeAsPath('reviewer\u0000.md'), 'a NUL in a name reached the guard unrefused')
  assert.match(String(whyUnsafeAsPath('reviewer\u0000.md')), /control character/i)
  assert.equal(
    join('/tmp/office-agents', 'reviewer\u0000extra.md').includes('\u0000'),
    true,
    'this asserts the premise: the string still carries the byte, and it is the syscall that truncates',
  )
})
