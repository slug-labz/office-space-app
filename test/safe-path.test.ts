/**
 * Both corpora, because one of them proves nothing on its own.
 *
 * `safeRelativePath` was fuzzed against nineteen shapes when it was lifted out of `reconcile.ts`
 * — `a/../../x`, `....//x`, a drive letter, a UNC path, an embedded NUL — and refused every one.
 * That reads as a thorough check and is half of one: every input was hostile, so the only thing
 * it could measure was false *negatives*. A corpus of things that must be refused, all refused,
 * says nothing about what else is being refused alongside them.
 *
 * Reviewing it that way found four: `..verdict.json` and friends are contained, ordinary
 * filenames, and they are refused with a message about not being in the workspace. See the note
 * in `safe-path.ts` for why they stay refused.
 *
 * So: a must-refuse list and a must-accept list, and the accept list is the one that was missing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, sep } from 'node:path'

import { safeRelativePath } from '../src/main/safe-path.js'

const ROOT = '/tmp/office-workspace'

/** Anything that could put a write outside the root, or is not a usable relative path. */
const MUST_REFUSE = [
  '..',
  '../x',
  '../../etc/passwd',
  'a/../../x',
  'a/./../../x',
  'a/b/../../../outside',
  '.claude/agents/../../../outside.md',
  '/etc/passwd',
  'C:\\Windows\\x',
  '\\\\server\\share',
  '.claude\\agents\\x.md',
  'a\u0000/../../x',
  '',
  '.',
  './',
  'a/..',
  '....//x',
]

/** Ordinary paths the office actually builds. Refusing any of these breaks something real. */
const MUST_ACCEPT = [
  '.claude/agents/manager.md',
  '.claude/agents/memory-keeper.md',
  '.claude/skills/record-progress/SKILL.md',
  '.claude/settings.json',
  'projects/_TEMPLATE/PLAN.md',
  '691d59be-dde0-4957-ac36-fd912b428ed8.toolu_01Xr34.verdict.json',
  '.hidden.md',
  'a/b/c/d/e.md',
  'name with spaces.md',
  'ünïcode.md',
]

test('nothing that could escape the root is accepted', () => {
  for (const path of MUST_REFUSE) {
    assert.equal(safeRelativePath(ROOT, path), null, `accepted ${JSON.stringify(path)}`)
  }
})

test('everything the office actually builds is accepted', () => {
  // The half the original fuzz did not have. A guard that refuses everything passes the test
  // above, and this is what stops that being a way to pass.
  for (const path of MUST_ACCEPT) {
    const out = safeRelativePath(ROOT, path)
    assert.notEqual(out, null, `refused ${JSON.stringify(path)}, which the office builds`)
    assert.ok(
      out !== null && out.startsWith(resolve(ROOT) + sep),
      `${JSON.stringify(path)} was accepted but resolved outside the root`,
    )
  }
})

test('a name beginning with two dots is refused, and that is a known cost', () => {
  // Not a bug being enshrined — a false positive being pinned so it is a decision rather than a
  // surprise. `inside.startsWith('..')` cannot tell "escapes the root" from "is a file whose
  // name begins with two dots", and by the time it runs the `'..'` segment check has already
  // removed every genuine escape. Measured: four differ, none escapes.
  //
  // If somebody removes that clause, these become accepted and this test says so rather than
  // going quietly green — which is the outcome to want, because it makes the removal a choice.
  for (const path of ['..verdict.json', '..x.verdict.json', '...x.verdict.json', '..leading.md']) {
    assert.equal(
      safeRelativePath(ROOT, path),
      null,
      `${JSON.stringify(path)} is now accepted — if that was deliberate, the note in safe-path.ts ` +
        'needs updating with it, because it currently documents the opposite',
    )
  }
})
