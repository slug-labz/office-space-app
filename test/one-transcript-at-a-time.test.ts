/**
 * The empty string is falsy, and it is also a real conversation.
 *
 * `.transcripts` is a grid with every pane in cell `1 / 1`, so exactly one may be shown and the
 * rest are hidden. `styles.css` has said what happens otherwise since the layout was written:
 *
 *     It looks like one transcript with two conversations printed on top of each other, and
 *     `element.hidden` reads perfectly true the whole time.
 *
 * It shipped anyway, and not through the CSS. `openSession` hid the outgoing pane behind
 * `if (activeSession)` — and `activeSession` starts as `''`, while `current()` is
 * `tabFor(activeSession)`. So the startup notice — *"your office was updated: 20 files brought
 * forward"* — creates a genuine tab keyed by the empty string, the truthiness guard skips it, and
 * from the first frame two panes paint in the same cell. Found by sending one message to the
 * manager and looking at the screen; both panes reported `grid-area: 1 / 1`, identical geometry
 * and `opacity: 1`.
 *
 * ## Why this is a source check and not a behaviour one
 *
 * `app.ts` runs on import — it builds the element map from `document` at module scope — so there
 * is no way to drive `openSession` from a test. The honest options were a check that reads the
 * source or no check at all, and this file's siblings already read it: `panels-are-dialogs.test.ts`
 * parses `coveringPanels()`, and `no-panel-is-a-trap.test.ts` parses `runAction`. This is narrower
 * than a behaviour test and it is what there is.
 *
 * ## The trap, which is not specific to this line
 *
 * `OFFICE_PROJECT` is `''`. Anything keyed by a project or a session can hold it, and every
 * `if (thatKey)` reads as *"if there is one"* while meaning *"if it is not the office"*. This is
 * the second time in one week: three switcher DOM tests use `id: 'the-office'` and have therefore
 * never rendered the office row, because the office's id is the empty string.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = await readFile(join(repo, 'src/renderer/app.ts'), 'utf8')

test('the scan found what it guards, or the assertions below are about nothing', () => {
  assert.match(app, /async function openSession\(/, 'openSession has been renamed')
  assert.match(app, /function tabFor\(/, 'tabFor has been renamed')
  assert.match(app, /let activeSession = ''/, 'activeSession no longer starts as the empty string')
})

test('the outgoing transcript is hidden by asking whether a tab exists, not whether the key is truthy', () => {
  const hide = /if \((.+?)\)\s*tabFor\(activeSession\)\.element\.hidden = true/.exec(app)
  assert.ok(hide, 'nothing in app.ts hides the outgoing pane — every conversation would paint over the last')

  const guard = (hide[1] ?? '').trim()
  assert.equal(
    guard,
    'tabs.has(activeSession)',
    `the outgoing pane is hidden behind \`${guard}\`. \`activeSession\` starts as '' and ` +
      `\`current()\` is \`tabFor(activeSession)\`, so a tab under the empty string is real and a ` +
      `truthiness guard walks past it. Two panes then share grid cell 1 / 1 and print over each ` +
      `other, which is what styles.css warns about and what shipped.`,
  )
})

/*
 * The CSS half, which was never the broken half and is what makes the bookkeeping worth having.
 * A pane marked hidden must actually stop painting: `.transcript` sets `display: flex`, and a
 * class beats the browser's own `[hidden]` rule.
 */
test('a hidden pane is taken out of the layout, not merely marked', async () => {
  const styles = await readFile(join(repo, 'src/renderer/styles.css'), 'utf8')
  assert.match(
    styles,
    /\.transcripts > \[hidden\]\s*\{[^}]*display:\s*none/,
    'without this, `element.hidden` is true and the pane keeps painting anyway',
  )
})

/*
 * The other way to skip the switch: tell `openSession` it has nothing to do.
 *
 * Its first line is `if (info.id === activeSession) return`. Assigning `activeSession` before
 * calling it makes that true, and everything after is skipped — hiding the outgoing pane, showing
 * the new one, pointing the floor at it, restoring its transcript. `cardTalk` did exactly that.
 *
 * The result was worse than a pane that did not change. `activeSession` *had* moved, so `current()`
 * resolved to a tab that had never been created, while the office's pane was still the one on
 * screen. Pressing "Talk to them directly" on `backend` printed *"Talking to backend"*, left the
 * header reading *"The office"*, and would have put anything typed into a conversation with no
 * transcript at all. Confirmed by running both versions: the old one created no pane for the
 * agent; the fixed one creates it and shows only it.
 */
test('nothing assigns activeSession before handing over to openSession', () => {
  const body = /async function openSession\([\s\S]*?\n}/.exec(app)?.[0] ?? ''
  assert.match(body, /if \(info\.id === activeSession\) return/, 'the early return has moved — this check is blind')

  // Every assignment outside `openSession` itself, which is the one place entitled to make it.
  const outside = app.replace(body, '')
  const assignments = [...outside.matchAll(/^[^\n]*\bactiveSession = (?!'')[^\n]*$/gm)].map((m) => m[0].trim())
  assert.deepEqual(
    assignments,
    [],
    'these set activeSession outside openSession. Its first act is to return when the id already ' +
      'matches, so anything that assigns first silently cancels the switch it was about to ask ' +
      'for — and leaves activeSession pointing at a conversation with no pane on screen.',
  )
})

/*
 * Panes for conversations that never happened — and the condition that decides it.
 *
 * `+ new conversation` mints a session every time it is asked, and a conversation nobody has said
 * anything in never gets a record, so the office does not list it. Together those stranded a pane
 * per press for the life of the window.
 *
 * The first prune keyed on `state.sessionId === null`, reasoning that anything which had run would
 * have an id and therefore a listing. `sessionId` arrives on a stream event *after* the send, so
 * that version deleted a pane holding a message somebody had just typed. Driving it is what said
 * so; the argument for it was self-consistent.
 *
 * The condition that holds is the pane itself: a send appends the outgoing message immediately, so
 * a pane still showing nothing but its empty state has never been sent to.
 */
test('a pane is only dropped when it is still showing nothing', () => {
  const prune = /function dropStrandedTabs\(\)[\s\S]*?\n}/.exec(app)?.[0]
  assert.ok(prune, 'dropStrandedTabs has been renamed — this check is blind')

  assert.match(prune, /id === activeSession/, 'the pane on screen must never be a candidate')
  assert.match(prune, /listed\.has\(id\)/, "the office's own list decides what is stranded")
  assert.match(
    prune,
    /childElementCount > 1/,
    'without the content check this drops a conversation between Send and its first stream event, ' +
      'which is a message somebody typed and watched disappear',
  )
})
