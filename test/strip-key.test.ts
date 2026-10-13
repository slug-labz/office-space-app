/**
 * The activity strip reads the key the event stream writes.
 *
 * It did not, and the strip was dead for it. `feed()` wrote every fact under the **session** id;
 * `drawStrip()` read under the **project**. Two `Map<string, …>` keys, both plausible, never
 * equal — so the Running zone never showed anybody, the Happened log stayed empty, and a turn
 * that dispatched the reviewer and the tester drew two people onto the floor while the strip
 * beside it read *nobody mid-task* for its whole length.
 *
 * The redraw was dead too: `if (session === active)` compared a session id to a project id, so it
 * was false on every event and the strip never redrew from the stream at all. What did show — the
 * refusal notes — got there because `decide()` also wrote under the project key. One wrong key
 * agreeing with another wrong key is why it looked like a working panel with nothing to say.
 *
 * This is the second time this exact pair has been confused, after `ModeChange.sessionId`. Both
 * were `active` where `activeSession` was meant, both compiled, and both produced a screen that
 * was quietly about the wrong conversation.
 *
 * The third was in `restore()`, and this file did not catch it because it only named `feed`'s
 * line. A conversation rebuilt from its transcript put its log into the model and redrew on
 * `session === active`, so the log never reached the screen. Measured in the dev harness: opening
 * a conversation with two restored entries showed *nobody mid-task* and no count, and the two
 * lines appeared the moment anything else forced a redraw. The same run showed the other half of
 * it — `openSession` changed which conversation the strip was about and drew nothing, so a
 * conversation with an empty log read *2 logged*, which was the previous one's count.
 *
 * ## Why this is a source check
 *
 * `app.ts` is the renderer entry — importing it starts the application. The property is one line
 * each, and a source check that names the two lines is worth more than no check at all. If either
 * moves, this fails and somebody re-reads it, which is all a guard of this kind can promise.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src/renderer/app.ts'), 'utf8')

test('the strip reads the conversation on screen, not the project', () => {
  assert.match(
    source,
    /activityFor\(activeSession\)/,
    'drawStrip must read the session key — the event stream writes under it',
  )
  assert.doesNotMatch(
    source,
    /activityFor\(active\)/,
    '`active` is the project. The activity map is keyed by conversation, and reading it with a ' +
      'project id returns EMPTY_ACTIVITY forever, which is a strip that never shows anything.',
  )
})

test('an event redraws the strip when it belongs to the conversation on screen', () => {
  // Tied to `drawStrip` specifically. `showPhase` has the same comparison one line down and was
  // always correct — which is exactly why the manager indicator updated through a turn while the
  // strip beside it did not, and is the corroboration that pinned this down.
  assert.match(
    source,
    /session === activeSession\) drawStrip\(\)/,
    'feed must compare a session to a session; `session === active` compares it to a project id ' +
      'and is false on every event',
  )
})

test('opening a conversation redraws the strip for it', () => {
  // `openSession` is where the conversation on screen changes, and it used to change it without
  // drawing. Everything else that redraws is an event, a verdict or a tick — none of which has to
  // happen when somebody switches conversation, so the panel could sit on the wrong one for as
  // long as the office stayed quiet.
  assert.match(
    source,
    /activeSession = info\.id[\s\S]{0,600}?drawStrip\(\)/,
    'openSession must redraw the strip once it has changed which conversation it is about',
  )
})

test('a log rebuilt from the transcript reaches the screen, not just the model', () => {
  // Scoped to `restore`'s own block, so `feed`'s copy of the same line cannot satisfy it — and by
  // its two anchors rather than by distance, because a comment between them is not a defect.
  const start = source.indexOf('async function restore(')
  const end = source.indexOf('// ── end F2', start)
  assert.ok(start !== -1 && end > start, 'restore() and the F2 block it ends with must be findable')

  // Both halves: the redraw is still there, and it compares a conversation to a conversation.
  assert.match(
    source.slice(start, end),
    /session === activeSession\) drawStrip\(\)/,
    'restore must redraw once it has put the remembered history into the model',
  )
  assert.doesNotMatch(
    source,
    /\bsession === active\)/,
    '`active` is the project id and a conversation id is never equal to it, so a redraw guarded ' +
      'on that comparison is dead code that reads like a working one',
  )
})

test('the map says what it is keyed by', () => {
  // A `Map<string, Activity>` called `activities` invites both keys. Naming it is most of what
  // stops the next person doing it again, because the mistake becomes visible at the call site.
  assert.match(source, /const activityBySession = new Map<string, Activity>\(\)/)
  assert.doesNotMatch(source, /\bconst activities\b/)
})
