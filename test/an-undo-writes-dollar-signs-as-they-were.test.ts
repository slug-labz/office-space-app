/**
 * The text an undo puts back is written as it was recorded, dollar signs and all.
 *
 * `resolveUndo` put text back with `current.replace(step.find, step.put)`. With a string as the
 * second argument, `replace` reads it as a pattern: `$$` is one `$`, `$&` is the matched text, and
 * `` $` `` and `$'` are the text before and after the match. So an employee's edit to `echo $$` was
 * undone as `echo $`, and the office said "1 file was put back." Found by the Honesty Sweep on
 * 2026-09-17, while its F4.1 confirmation was being written; measured on dev at e6fe5cb.
 *
 * Pure, like `undo.test.ts`: the file's text comes through `resolveUndo`'s callback, and no temp
 * folder is made.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planUndo, resolveUndo } from '../src/shared/undo.js'
import type { Changes } from '../src/shared/changes.js'

const edit = (path: string, before: string, after: string) => ({ path, kind: 'edit' as const, before, after })
const changes = (list: Changes['changes']): Changes => ({ changes: list, shell: 0, unattributed: 0 })

/** What the undo would write for one edit, or its reason for refusing. */
function putBack(before: string, after: string, file: string): string {
  const [got] = resolveUndo(planUndo(changes([edit('/w/run.sh', before, after)])), () => file)
  if (got === undefined) throw new Error('the plan had no step')
  if (!got.ok) return `refused: ${got.why}`
  if (got.write === null) throw new Error('an edit was resolved as a removal')
  return got.write
}

test('control: text with no dollar sign is put back as it was', () => {
  assert.equal(putBack('echo hi', 'REPLACED', '#!/bin/sh\nREPLACED\n'), '#!/bin/sh\necho hi\n')
})

test('text with a dollar pattern in it is put back exactly', () => {
  // `$$`, `$&`, `` $` `` and `$'` are patterns in a replacement string whatever the search is, and
  // dev wrote those four wrong. `$1` and `$<name>` are patterns only when the search is a regular
  // expression with groups, so dev wrote them right; they are here for the day the search is one.
  for (const was of ['echo $$', 'cost: $& total', "before $' after", 'tick $` tock', 'a $1 b', 'x $<name> y']) {
    assert.equal(
      putBack(was, 'REPLACED', '#!/bin/sh\nREPLACED\n'),
      `#!/bin/sh\n${was}\n`,
      `the undo wrote something other than ${JSON.stringify(was)}, and the office would say it had put the file back`,
    )
  }
})
