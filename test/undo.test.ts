/**
 * Putting back what a dispatch changed, and the four ways that goes wrong.
 *
 * The design is teammate 3's: the CLI's `Edit` requires `old_string` to appear exactly once, and
 * the inverse inherits that requirement. So ambiguity is not a problem to engineer around — it is
 * one of three honest outcomes, and two of the three are a refusal.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  planUndo,
  resolveUndo,
  wouldRestore,
  mayUndo,
  tally,
  whatWasUndone,
  alsoChangedSince,
  notAsItWas,
} from '../src/shared/undo.js'
import type { Changes } from '../src/shared/changes.js'

const edit = (path: string, before: string, after: string) =>
  ({ path, kind: 'edit' as const, before, after })
const made = (path: string, content: string) =>
  ({ path, kind: 'create' as const, before: null, after: content })

const changes = (over: Partial<Changes> = {}): Changes => ({
  changes: [],
  shell: 0,
  unattributed: 0,
  ...over,
})

const tree = (files: Record<string, string>) => (path: string) => files[path] ?? null

test('an edit is put back by finding what the employee wrote', () => {
  const plan = planUndo(changes({ changes: [edit('/w/a.js', 'bravo', 'BRAVO')] }))
  const [got] = resolveUndo(plan, tree({ '/w/a.js': 'alpha BRAVO charlie' }))
  assert.equal(got?.ok, true)
  assert.equal(got?.ok ? got.write : null, 'alpha bravo charlie')
})

test('text that is no longer there is refused, not searched harder for', () => {
  const plan = planUndo(changes({ changes: [edit('/w/a.js', 'bravo', 'BRAVO')] }))
  const [got] = resolveUndo(plan, tree({ '/w/a.js': 'somebody rewrote this entirely' }))
  assert.equal(got?.ok, false)
  assert.match(got?.ok === false ? got.why : '', /nothing here to put back/)
})

test('text that appears twice is refused, because the office cannot tell which was its own', () => {
  /*
   * `Edit` guaranteed `old_string` was unique when it ran. If it is not unique now, something has
   * happened to the file since — and picking one is the office guessing about somebody's work.
   */
  const plan = planUndo(changes({ changes: [edit('/w/a.js', 'bravo', 'BRAVO')] }))
  const [got] = resolveUndo(plan, tree({ '/w/a.js': 'BRAVO and also BRAVO' }))
  assert.equal(got?.ok, false)
  assert.match(got?.ok === false ? got.why : '', /more than one place/)
})

test('edits are undone in reverse, or the first undo destroys what the second needs', () => {
  // Two edits to one file: the second was made against the text the first produced.
  const plan = planUndo(
    changes({ changes: [edit('/w/a.js', 'one', 'two'), edit('/w/a.js', 'two', 'three')] }),
  )
  const first = plan.steps[0]
  assert.equal(first?.act === 'restore' ? first.find : null, 'three', 'the later edit was not undone first')
})

test('nothing is written unless every step resolves', () => {
  /*
   * The one that would have shipped broken. Five edits where the third refuses leaves one and two
   * put back and three to five in place — a file in a state nobody ever authored, produced by the
   * office while trying to undo.
   */
  const plan = planUndo(
    changes({ changes: [edit('/w/a.js', 'a', 'A'), edit('/w/b.js', 'b', 'B')] }),
  )
  const got = resolveUndo(plan, tree({ '/w/a.js': 'A', '/w/b.js': 'somebody changed this' }))
  assert.equal(got.some((r) => !r.ok), true, 'the impossible step was not refused')
  assert.equal(
    got.every((r) => r.ok),
    false,
    'a caller checking `every(ok)` is what makes this all-or-nothing — if one refuses, none are written',
  )
})

// ── the destructive one ─────────────────────────────────────────────────────────────────────

test('undoing a creation is a deletion, and is guarded on the whole file', () => {
  // `after` is the entire content for a creation, so the guard is whole-file equality. Anything
  // else means somebody edited it since, and the office never held a copy of that.
  const plan = planUndo(changes({ changes: [made('/w/new.js', 'hello\n')] }))
  const [ok] = resolveUndo(plan, tree({ '/w/new.js': 'hello\n' }))
  assert.equal(ok?.ok, true)
  assert.equal(ok?.ok ? ok.write : 'x', null, 'a deletion was given something to write')

  const [no] = resolveUndo(plan, tree({ '/w/new.js': 'hello\nand my own line\n' }))
  assert.equal(no?.ok, false)
  assert.match(no?.ok === false ? no.why : '', /destroy somebody's changes/)
})

test('a write the office could not classify is refused rather than deleted', () => {
  /*
   * The one that would destroy something. `Write` overwrites as happily as it creates, so a
   * change recorded as a creation on a guess would delete a file whose prior bytes were never
   * recorded — unrecoverable, in exactly the case somebody reached for undo.
   */
  const plan = planUndo(
    changes({ changes: [{ path: '/w/x.js', kind: 'unknown', before: null, after: 'x' }] }),
  )
  assert.equal(plan.steps[0]?.act, 'refuse')
  assert.match(plan.steps[0]?.act === 'refuse' ? plan.steps[0].why : '', /could delete something it never recorded/)
})

// ── what an undo cannot reach ───────────────────────────────────────────────────────────────

test('a dispatch that also ran commands says the undo is partial', () => {
  // Saying "undone" without this hands somebody a false all-clear.
  const plan = planUndo(changes({ changes: [edit('/w/a.js', 'a', 'A')], shell: 7 }))
  assert.match(plan.partial ?? '', /will not undo everything/)
  assert.match(plan.partial ?? '', /7 shell commands/)
})

test('unattributed edits are named in the same breath', () => {
  const plan = planUndo(changes({ changes: [], shell: 2, unattributed: 3 }))
  assert.match(plan.partial ?? '', /2 shell commands/)
  assert.match(plan.partial ?? '', /3 edits could not be attributed/)
})

test('a clean dispatch promises nothing it cannot keep, and warns about nothing', () => {
  assert.equal(planUndo(changes({ changes: [edit('/w/a.js', 'a', 'A')] })).partial, null)
})

test('counting occurrences is the whole safety check', () => {
  assert.equal(wouldRestore('one two three', 'two'), 'once')
  assert.equal(wouldRestore('one two two', 'two'), 'ambiguous')
  assert.equal(wouldRestore('one three', 'two'), 'missing')
  assert.equal(wouldRestore('anything', ''), 'missing', 'an empty needle matches everywhere')
})

// ── hole 3: not while somebody is still working ─────────────────────────────────────────────

test('an undo is refused while the dispatch is still out', () => {
  /*
   * The change view's own finding: concurrent dispatches share one working tree. An undo racing
   * an employee mid-edit is that same collision with the office on one side of it.
   */
  const no = mayUndo(true, null)
  assert.match(no ?? '', /has not reported back/)
})

test('a finished dispatch that was never undone may be undone', () => {
  assert.equal(mayUndo(false, null), null)
})

// ── hole 4: the record has to describe the tree ─────────────────────────────────────────────

test('a second undo is refused, and says when the first one happened', () => {
  /*
   * Without the record, a second undo searches for text the first already put back — and finds
   * the *original*, which it then replaces with what the employee wrote. An undo that redoes.
   */
  const no = mayUndo(false, { at: '2026-09-01T01:44:00.000Z', restored: 1, removed: 0 })
  assert.match(no ?? '', /already put back on 2026-09-01/)
})

test('what an undo did is counted from what resolved, not from what was planned', () => {
  const plan = planUndo(
    changes({ changes: [edit('/w/a.js', 'a', 'A'), made('/w/new.js', 'hi')] }),
  )
  const resolved = resolveUndo(plan, tree({ '/w/a.js': 'A', '/w/new.js': 'hi' }))
  const got = tally(resolved, '2026-09-01T01:44:00.000Z')
  assert.deepEqual({ restored: got.restored, removed: got.removed }, { restored: 1, removed: 1 })
  assert.match(whatWasUndone(got), /1 file was put back, 1 file was removed/)
})

test('an undo that did nothing says nothing, rather than reporting zero files', () => {
  assert.equal(whatWasUndone({ at: 'x', restored: 0, removed: 0 }), 'Nothing was changed.')
})

// ── a true sentence that reads as a false one ───────────────────────────────────────────────

test('a file another dispatch has since edited gets a different sentence, not a caveat', () => {
  /*
   * Undoing A after B edited a different region of the same file succeeds and leaves the file in
   * a state neither dispatch produced. "1 file was put back" is true about the operation and
   * false about the file — a reader concludes it is as it was before A ran, and it is not.
   */
  assert.equal(alsoChangedSince(['/w/a.js'], ['/w/a.js', '/w/other.js']), 1)
  assert.match(notAsItWas(1) ?? '', /not as it was before/)
})

test('the sentence counts files, not changes', () => {
  /*
   * A dispatch with two edits to one file puts that one file back, and the sentence must say one.
   * The duplicates are on the *restored* side — putting them on the later side proves nothing,
   * which is what my first version of this test did: it passed with and without the fix.
   */
  assert.equal(alsoChangedSince(['/w/a.js', '/w/a.js'], ['/w/a.js']), 1)
  assert.equal(alsoChangedSince(['/w/a.js'], ['/w/a.js', '/w/a.js', '/w/a.js']), 1)
})

test('nothing is said when no later dispatch touched any of them', () => {
  assert.equal(alsoChangedSince(['/w/a.js'], ['/w/b.js']), 0)
  assert.equal(notAsItWas(0), null)
})

test('the sentence never claims nothing else changed', () => {
  /*
   * The boundary that keeps it honest. A person editing elsewhere in the file produces the
   * identical hybrid and is undetectable — the guards catch a hand edit at the same slice and
   * refuse, but not one further down. So its absence must not read as a guarantee.
   */
  const said = notAsItWas(1) ?? ''
  assert.doesNotMatch(said, /nothing else|no other|unchanged|untouched/i)
  assert.match(said, /Another dispatch/)
})
