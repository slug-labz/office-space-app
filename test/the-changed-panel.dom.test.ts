/**
 * What the change panel draws, and the four silences it must not confuse.
 *
 * `changes-view.test.ts` covers the arrangement. This is the surface, and the surface is where
 * the confusion would actually happen: a dispatch that changed nothing, one that has not
 * finished, one whose record could not be read, and a workspace where nobody has been dispatched
 * at all are four different facts that all render as "no files" if nobody is careful.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { renderChanged } from '../src/renderer/views/changed.js'
import type { DispatchRow } from '../src/shared/changes-view.js'
import type { Change } from '../src/shared/changes.js'

const file = (path: string, kind: Change['kind'], before: string | null = 'was', after: string | null = 'now'): Change => ({
  path,
  kind,
  before,
  after,
})

installDom()

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

const row = (over: Partial<DispatchRow> = {}): DispatchRow => ({
  id: 'toolu_a',
  employee: 'builder',
  brief: 'Add retry-with-backoff to the fetch helper.',
  sentAt: '2026-09-01T01:20:00.000Z',
  edited: [],
  created: [],
  undone: null,
  stillOut: false,
  unclear: [],
  notShown: null,
  problem: null,
  ...over,
})

function panel(
  rows: readonly DispatchRow[],
  hasRecord = true,
  onUndo: (id: string) => void = () => {},
): { host: El; text: string } {
  const node = document.createElement('div')
  renderChanged(node as unknown as HTMLElement, rows, { hasRecord: () => hasRecord, onUndo })
  const host = node as unknown as El
  return { host, text: (host.textContent ?? '').replace(/\s+/g, ' ').trim() }
}

test('a changed file is listed before a created one', () => {
  /*
   * Ordering is the cheapest emphasis there is, and *changed* is the word somebody scanning for
   * damage is scanning for. A file that did not exist before the dispatch ran is additive and
   * can wait; one that already existed and has been altered is the question.
   */
  const { host } = panel([row({ edited: [file('/w/existing.js', 'edit')], created: [file('/w/new.js', 'create', null)] })])
  const paths = all(host)
    .filter((n) => n.className === 'roster__path')
    .map((n) => n.textContent)
  assert.deepEqual(paths, ['/w/existing.js', '/w/new.js'])
})

test('each file says which it was, because they are different events to a reader', () => {
  const { host } = panel([row({ edited: [file('/w/a.js', 'edit')], created: [file('/w/b.js', 'create', null)] })])
  const kinds = all(host)
    .filter((n) => n.className === 'roster__kind')
    .map((n) => n.textContent)
  assert.deepEqual(kinds, ['changed', 'created'])
})

test('a dispatch still working does not read as one that changed nothing', () => {
  const { text } = panel([row()], false)
  assert.match(text, /Still working, or stopped before it reported/)
  assert.doesNotMatch(text, /No files changed/)
})

test('a record that could not be read says so on the card', () => {
  // An unreadable record rendered as an empty list is a false sentence about somebody's files.
  const { text } = panel([row({ problem: 'the record will not parse — Unexpected end of JSON input' })])
  assert.match(text, /will not parse/)
  assert.doesNotMatch(text, /No files changed/)
})

test('a dispatch that genuinely changed nothing still declares what it ran', () => {
  const { text } = panel([
    row({ notShown: 'This dispatch also ran 7 shell commands, whose file effects are not captured.' }),
  ])
  assert.match(text, /7 shell commands/)
})

test('an empty panel may now say nothing changed, and still declares its one blind spot', () => {
  /*
   * This asserted the opposite, and its reasoning was right at the time: the office recorded only
   * what an *employee* did, so "nothing has changed" would have been a claim about files the
   * panel never looked at — the manager keeps `Write` and `Edit`, and its own turns were dropped
   * entirely.
   *
   * They are recorded now, so the claim is honest and the disclaimer would be false. What has
   * not changed is the real blind spot: a shell command's writes are invisible to the stream, so
   * the panel still says so rather than presenting an empty list as complete.
   */
  const { text } = panel([])
  assert.match(text, /Nothing has been changed yet/)
  assert.match(text, /manager changed in its own turns/, 'the panel stopped claiming to watch the manager')
  assert.match(text, /shell command are not captured/, 'the one thing it genuinely cannot see went undeclared')
  assert.doesNotMatch(text, /does not watch the files a manager edits/, 'a disclaimer that is no longer true')
})

test('the brief and the employee are on the card, because a file list answers nothing alone', () => {
  const { text } = panel([row({ edited: [file('/w/a.js', 'edit')] })])
  assert.match(text, /builder/)
  assert.match(text, /retry-with-backoff/)
})

// ── the control that writes to somebody's files ─────────────────────────────────────────────

const button = (host: El): El | undefined => all(host).find((n) => n.tag === 'button')

test('putting back takes two clicks, and the second label names the consequence', () => {
  /*
   * `window.confirm` does not exist usefully in a sandboxed renderer, and this writes over files
   * as they are now. A label that changes is a confirmation the keyboard reaches and a screen
   * reader announces — the same pattern as firing somebody.
   */
  let asked: string | null = null
  const { host } = panel([row({ edited: [file('/w/a.js', 'edit', 'a', 'b')] })], true, (id) => {
    asked = id
  })
  const b = button(host)
  assert.ok(b, 'no way to put anything back')
  b?.click()
  assert.equal(asked, null, 'one click was enough to overwrite files')
  assert.match(b?.textContent ?? '', /Overwrite these files/)
  b?.click()
  assert.equal(asked, 'toolu_a')
})

test('no undo is offered while the employee is still working, and it says why', () => {
  const { host, text } = panel([row({ edited: [file('/w/a.js', 'edit', 'a', 'b')], stillOut: true })])
  assert.equal(button(host), undefined, 'offered to change files somebody may be editing')
  assert.match(text, /has not reported back/)
})

test('a dispatch already put back says so before its file list, not after', () => {
  /*
   * Order is the whole of it. A reader who meets "1 changed" first has already concluded the
   * tree contains that change by the time they reach the line saying it does not.
   */
  const { host, text } = panel([
    row({
      edited: [file('/w/a.js', 'edit', 'a', 'b')],
      undone: { at: '2026-09-01T01:44:00.000Z', restored: 1, removed: 0 },
    }),
  ])
  assert.equal(button(host), undefined, 'offered a second undo')
  assert.match(text, /put this back on 2026-09-01/)
  assert.ok(
    text.indexOf('put this back') < text.indexOf('/w/a.js'),
    'the file list is shown before the notice that it was undone',
  )
})

test('a dispatch that changed nothing gets no undo control and no explanation for its absence', () => {
  // There is no absence to account for, and a line explaining why a button is missing from a row
  // that never had anything to undo is noise on every such row.
  const { host, text } = panel([row({})])
  assert.equal(button(host), undefined)
  assert.doesNotMatch(text, /put back/i)
})

test('a row is never offered a button that can only refuse', () => {
  /*
   * Found by looking at the panel, not by a test. `Write` overwrites as happily as it creates, so
   * `planUndo` refuses every unclassified file — a row with nothing else got a "Put back" whose
   * only possible outcome was a refusal after the click. An offer that cannot be honoured is
   * worse than no offer.
   */
  const { host, text } = panel([row({ unclear: [file('/w/notes.md', 'unknown', null, '# Notes')] })])
  assert.equal(button(host), undefined, 'offered an undo that would refuse every file')
  assert.match(text, /never recorded whether these files existed/)
})

test('an undone row says it once, not twice', () => {
  // `summarise` already says it at the top of the card, where it changes how the list beneath
  // reads. The control area repeating it is the same sentence twice on one row.
  const { text } = panel([
    row({
      edited: [file('/w/a.js', 'edit', 'a', 'b')],
      undone: { at: '2026-09-01T01:44:00.000Z', restored: 1, removed: 0 },
    }),
  ])
  assert.equal(text.match(/put (this|these changes)? ?back on/gi)?.length ?? 0, 1, 'said twice')
})
