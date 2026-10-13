/**
 * The renderer had no `error` handler and no `unhandledrejection` handler.
 *
 * Nothing in `src/renderer/` listened for either, and the result is the quietest failure this app
 * can have. A view that throws while drawing stops drawing. An `invoke` that rejects never
 * resolves. The window keeps sitting there looking exactly like an office where nothing is
 * happening — which is the third standing order failing in the one direction the floor cannot
 * show, because a frozen office and an idle office are the same picture.
 *
 * The bridge is where it bites. `ipcMain.handle` and `ipcRenderer.invoke` are joined by a string
 * and nothing else, so a channel with no handler rejects with `No handler registered for '…'`
 * behind whatever control called it. Three call sites in `app.ts` catch, by hand; the rest do
 * not.
 *
 * ## Nothing is caught
 *
 * The obvious fix — preload catches and hands back a value — is the one this repository refuses.
 * It converts a call that *failed* into a call that *returned nothing*, and the renderer draws
 * nothing perfectly well: a task file that would not open would render as a project with no
 * tasks. So the rejection still rejects. The only change is that it stops being invisible.
 *
 * ## Repeats are counted, not dropped
 *
 * A draw that throws throws every frame. Sixty notices a second is not honesty. But dropping the
 * repeats silently is the fourth standing order one layer up — "we stopped saying it" becoming
 * "it stopped happening". So the 1st, 10th, 100th and 1000th are said, each after the first
 * carrying the count.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { describeMishap, MishapLog, unwrap } from '../src/shared/mishap.js'
import { watchForMishaps, type MishapSource } from '../src/renderer/mishaps.js'

test('a channel with no handler is named, and blamed on the build rather than the reader', () => {
  // The exact string Electron produces. A reader who sees this did nothing wrong and cannot fix
  // it, and the sentence has to say both or it reads as something they broke.
  const m = describeMishap(new Error("Error invoking remote method 'office:tasks': Error: No handler registered for 'office:tasks'"))

  assert.match(m.sentence, /office:tasks/, 'the channel is not named, so nobody can look it up')
  assert.match(m.sentence, /fault in this build/i, 'the sentence does not say whose fault it is')
  assert.match(
    m.sentence,
    /did not happen/i,
    'the sentence does not say the press had no effect — which is the only thing the reader ' +
      'actually needs to know',
  )
  assert.equal(m.key, 'no-handler:office:tasks', 'two presses of the same dead control would report as two faults')
})

test('a resize notice is not reported as an action that may not have happened', () => {
  /*
   * Found by driving the running app. Toggling to the campus drew three offices correctly and the
   * office said *"Something in the office went wrong: ResizeObserver loop completed with
   * undelivered notifications. Nothing was lost, but whatever you just did may not have taken
   * effect."*
   *
   * The action **had** taken effect — the offices were on screen. The browser emits this when a
   * resize callback resizes something, deferring the next pass to the following frame, and this
   * app produces it by construction: `floor-view.ts` observes the stage and calls `fit()`, which
   * changes the canvas size. Chrome delivers it as a window `error` event, so the renderer's
   * handler catches it like any real fault.
   *
   * That is the third standing order in the module written to serve it: the one surface whose job
   * is saying what went wrong, telling somebody their action might not have happened when it did.
   */
  const said = describeMishap(new Error('ResizeObserver loop completed with undelivered notifications')).sentence

  assert.doesNotMatch(said, /may not have taken effect/, 'a scheduling notice was reported as a possibly lost action')
  assert.match(said, /Nothing failed/)
  // The older Chrome wording, which is the same event and must not fall through to the general
  // sentence just because the phrasing changed.
  assert.doesNotMatch(
    describeMishap(new Error('ResizeObserver loop limit exceeded')).sentence,
    /may not have taken effect/,
  )
})

test('and it is still reported, because suppressing it would be the other standing order', () => {
  /*
   * The obvious fix is to drop it, and it is wrong in the way this repository is most careful
   * about: one of these is noise, a steady stream is a real resize loop, and a module that
   * swallowed them could not tell anybody the difference.
   *
   * So it keeps a key and a detail like any other fault, and the repeat machinery counts it.
   */
  const mishap = describeMishap(new Error('ResizeObserver loop completed with undelivered notifications'))
  assert.equal(mishap.key, 'resize-loop')
  assert.match(mishap.detail, /ResizeObserver/)

  const thrown = new Error('ResizeObserver loop completed with undelivered notifications')
  const log = new MishapLog()
  assert.ok(log.note(thrown), 'the first one is not said at all')

  // And a burst is not silence. The repeat rule speaks again at ten, carrying the count, which is
  // what separates one benign notice from something genuinely resizing in a loop.
  const again = Array.from({ length: 12 }, () => log.note(thrown)).filter((said) => said !== null)
  assert.ok(again.length >= 1, 'a burst of them is silent, so a real resize loop cannot be seen')
  assert.match(again[0] ?? '', /\d/, 'the repeat does not carry a count, so a loop looks like one notice')
})

test('an ordinary error keeps its name, because TypeError and Error are different faults', () => {
  const m = describeMishap(new TypeError('cannot read properties of null'))
  assert.match(m.sentence, /TypeError: cannot read properties of null/)
})

test('a plain Error does not have "Error:" pasted in front of its own message', () => {
  assert.match(describeMishap(new Error('the floor gave up')).sentence, /: the floor gave up\./)
  assert.doesNotMatch(describeMishap(new Error('the floor gave up')).sentence, /Error: the floor gave up/)
})

test('anything at all can be thrown, and none of it may throw again on the way out', () => {
  // A reporter that fails while reporting says nothing, which is the state this replaces.
  const circular: Record<string, unknown> = {}
  circular['self'] = circular

  for (const thrown of ['a bare string', 42, null, undefined, circular, Symbol('x'), { a: 1 }]) {
    const m = describeMishap(thrown)
    assert.equal(typeof m.sentence, 'string', `describing ${String(thrown)} did not produce a sentence`)
    assert.ok(m.sentence.length > 0, `describing ${String(thrown)} produced an empty sentence`)
  }
})

test('the same fault twice is said once', () => {
  const log = new MishapLog()
  const boom = (): Error => new Error('the same thing')

  assert.ok(log.note(boom()), 'the first report was suppressed')
  assert.equal(log.note(boom()), null, 'the second report of one fault was said again')
  assert.equal(log.note(boom()), null)
})

test('and it is still counted, so "we stopped saying it" is not "it stopped"', () => {
  const log = new MishapLog()
  for (let i = 0; i < 7; i += 1) log.note(new Error('again'))
  assert.equal(log.countOf(new Error('again')), 7, 'suppressed repeats were not counted')
})

test('a fault that keeps happening gets louder, at ten and at a hundred', () => {
  const log = new MishapLog()
  const said: string[] = []
  for (let i = 1; i <= 120; i += 1) {
    const line = log.note(new Error('every frame'))
    if (line !== null) said.push(line)
  }

  assert.equal(
    said.length,
    3,
    `a fault reported 120 times produced ${said.length} notices. One per occurrence would bury ` +
      `the transcript; none after the first would hide that it is still going.`,
  )
  assert.match(said[1] ?? '', /\(10 times now\.\)/)
  assert.match(said[2] ?? '', /\(100 times now\.\)/)
})

test('two different faults are two reports', () => {
  const log = new MishapLog()
  assert.ok(log.note(new Error('one')))
  assert.ok(log.note(new Error('two')), 'a second, different fault was suppressed by the first')
})

// ── the subscription ────────────────────────────────────────────────────────────────────────

function source(): MishapSource & { fire: (type: string, event: unknown) => void; live: () => number } {
  const listeners = new Map<string, ((event: unknown) => void)[]>()
  return {
    addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type, listener) =>
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener)),
    fire: (type, event) => (listeners.get(type) ?? []).forEach((l) => l(event)),
    live: () => [...listeners.values()].reduce((n, l) => n + l.length, 0),
  }
}

test('both events are listened for, because they are different failures', () => {
  // `error` is a throw that escaped — the frame it was in is gone. `unhandledrejection` is an
  // answer that never arrives, and the control that asked waits forever. Neither is the other.
  const s = source()
  const said: string[] = []
  watchForMishaps(s, (line) => said.push(line))

  s.fire('error', { error: new Error('drawing broke') })
  s.fire('unhandledrejection', { reason: new Error('nobody answered') })

  assert.equal(said.length, 2, `expected both to be reported, got ${JSON.stringify(said)}`)
  assert.match(said[0] ?? '', /drawing broke/)
  assert.match(said[1] ?? '', /nobody answered/)
})

test('an ErrorEvent carrying only a message is still reported', () => {
  // A cross-origin script error arrives with `error: null` and a message. Reporting "null" there
  // would be worse than reporting what the browser managed to say.
  const s = source()
  const said: string[] = []
  watchForMishaps(s, (line) => said.push(line))

  s.fire('error', { error: null, message: 'Script error.' })
  assert.match(said[0] ?? '', /Script error\./)
})

test('a reporter that throws does not take the window down with it', () => {
  // The listener is where the throw would land, so a `say` that throws would be caught by the
  // very handler that called it. There is nowhere honest left to send it, and an infinite
  // regress ends in a hung window.
  const s = source()
  watchForMishaps(s, () => {
    throw new Error('the transcript is gone too')
  })

  assert.doesNotThrow(() => s.fire('error', { error: new Error('first') }))
})

test('the unsubscribe removes both, so a torn-down view stops reporting', () => {
  const s = source()
  const stop = watchForMishaps(s, () => {})
  assert.equal(s.live(), 2, 'both listeners were not attached')
  stop()
  assert.equal(s.live(), 0, 'a listener survived the unsubscribe, so it holds the old view alive')
})

// ── the key, which is the part that had a real hole in it ───────────────────────────────────

/**
 * Found by `office-space-6c` reading `registry.ts`, and it is the busiest write path in the app.
 *
 *     const temp = `${path}.${process.pid}.${++saveSeq}.tmp`
 *     await writeFile(temp, …)
 *
 * A full disk produces a Node errno error, and Node errno errors embed the path. So the counter
 * that was added to stop two overlapping saves sharing a temp name also gives every failure a
 * different message — a different key, a first occurrence every time, and one unthrottled notice
 * per registry write. `writeRegistry` runs on every cost update, which lands per turn.
 *
 * The gate was inert for exactly the case it exists to stop.
 */
test('a fault whose message carries a counter is still one fault', () => {
  const log = new MishapLog()
  const said: string[] = []
  for (let n = 1; n <= 40; n += 1) {
    const line = log.note(
      new Error(`EACCES: permission denied, open '/w/.office-space/sessions.json.42.${n}.tmp'`),
    )
    if (line !== null) said.push(line)
  }

  assert.ok(
    said.length <= 2,
    `forty registry-write failures produced ${said.length} notices. Each message differs only by ` +
      `a counter and a pid, and keying on the message makes every one a first occurrence — which ` +
      `is the transcript being flooded by the one path the gate was written for.`,
  )
  assert.equal(log.countOf(new Error("EACCES: permission denied, open '/w/x.1.tmp'")), 40)
})

test('and the sentence still carries the path, because that is the actionable part', () => {
  // Only the key is normalised. A reader who cannot see which file failed has a notice they
  // cannot act on.
  const m = describeMishap(new Error("ENOENT: no such file or directory, open '/w/.claude/agents'"))
  assert.match(m.sentence, /\/w\/\.claude\/agents/, 'the path was normalised out of the message the reader sees')
  assert.doesNotMatch(m.key, /agents/, 'the key still carries the path, so it moves with the occurrence')
})

test('a widening failure does not read as a single stuck one', () => {
  // The risk the normalised key introduces, and the reason `detail` exists. One file failing
  // forty times and forty files failing once are different situations; a bare count is the same
  // for both.
  const log = new MishapLog()
  let tenth = ''
  for (let n = 1; n <= 10; n += 1) {
    const line = log.note(new Error(`EACCES: permission denied, open '/w/transcript-${n}.jsonl'`))
    if (line !== null && n === 10) tenth = line
  }
  assert.match(tenth, /10 times now, 10 different/, `the tenth report reads ${JSON.stringify(tenth)}`)

  const stuck = new MishapLog()
  let same = ''
  for (let n = 1; n <= 10; n += 1) {
    const line = stuck.note(new Error("EACCES: permission denied, open '/w/one.jsonl'"))
    if (line !== null && n === 10) same = line
  }
  assert.match(same, /10 times now\.\)/, `a fault stuck on one file reads ${JSON.stringify(same)}`)
  assert.doesNotMatch(same, /different/, 'one file was described as several')
})

test('two genuinely different faults are still two, whatever they have in common', () => {
  // The normalisation must not flatten everything with a path in it into one bucket.
  const log = new MishapLog()
  assert.ok(log.note(new Error("EACCES: permission denied, open '/w/a'")))
  assert.ok(log.note(new Error("ENOENT: no such file or directory, open '/w/a'")), 'a different errno was suppressed as a repeat')
  assert.ok(log.note(new TypeError('cannot read properties of null')), 'an unrelated fault was suppressed as a repeat')
})

test('the same message over two different channels is two faults', () => {
  // The channel is the call site, and the call site is most of what makes one fault distinct
  // from another with the same words.
  const log = new MishapLog()
  assert.ok(log.note(new Error("Error invoking remote method 'roster:fire': Error: it went wrong")))
  assert.ok(
    log.note(new Error("Error invoking remote method 'skills:add': Error: it went wrong")),
    'two channels failing the same way were reported as one fault',
  )
})

test("Electron's IPC frame is taken off the sentence and kept as the channel", () => {
  // The boot catch already learned this: "Error invoking remote method 'session:open': Error: …"
  // is an IPC frame, not a sentence, and it went on a stranger's first screen.
  const { message, channel } = unwrap(
    new Error("Error invoking remote method 'session:open': Error: no manager agent found"),
  )
  assert.equal(message, 'no manager agent found')
  assert.equal(channel, 'session:open')

  const plain = unwrap(new Error('just an error'))
  assert.equal(plain.message, 'just an error')
  assert.equal(plain.channel, null)
})

test('a fault hitting more things than we remember says "over"', () => {
  // The detail set is capped so a registry of thousands cannot grow it without bound. Past the
  // cap the count is still exact and the spread is honest about being a floor.
  const log = new MishapLog()
  let hundredth = ''
  for (let n = 1; n <= 100; n += 1) {
    const line = log.note(new Error(`EACCES: permission denied, open '/w/${n}.jsonl'`))
    if (line !== null && n === 100) hundredth = line
  }
  assert.match(hundredth, /100 times now, over \d+ different/, `reads ${JSON.stringify(hundredth)}`)
})

// ── when a fault stops being an event ───────────────────────────────────────────────────────

/**
 * `office-space-6c`'s design, built last because it is the one that needed a reason rather than
 * a defect.
 *
 * The transcript is for **events** and the problem strip is for **conditions**. A fault crosses
 * from one to the other by repeating, and the numbers are the argument: the strip's contents are
 * re-derived from the snapshot on every scan, so an event placed there vanishes at the next file
 * change — *"a problem that disappears on its own is one the reader is entitled to think was
 * solved"* — while the transcript's own contract is that if the office did it, it is in here.
 *
 * The case is sharpest for an office left open and unattended, which the approval gate has
 * already shown is the normal state: the transcript scrolls past, and a line in the status bar is
 * what is still there when somebody comes back.
 */

test('one occurrence is an event and says nothing standing', () => {
  const log = new MishapLog()
  const first = log.report(new Error('the floor gave up'))
  assert.ok(first.say, 'the first occurrence was not reported at all')
  assert.equal(
    first.standing,
    null,
    'a single fault was raised as a standing condition. One is an event — a strip that reported ' +
      'every one-off would be a strip nobody reads.',
  )
})

test('the same fault twice is a condition, and says so once', () => {
  const log = new MishapLog()
  log.report(new Error('the floor gave up'))
  const second = log.report(new Error('the floor gave up'))

  assert.ok(second.standing, 'a fault that happened twice never became a condition')
  assert.match(second.standing ?? '', /not a one-off/, `reads ${JSON.stringify(second.standing)}`)
  assert.equal(second.say, null, 'the second occurrence was said in the transcript as well as raised')
})

test('and never again after that', () => {
  // The caller holds these for the life of the window. A crossing test written as `count >= 2`
  // rather than as a crossing would raise the same condition on every occurrence from the second
  // onwards, and the strip would fill with one fault.
  const log = new MishapLog()
  const raised: string[] = []
  for (let n = 1; n <= 50; n += 1) {
    const r = log.report(new Error('every frame'))
    if (r.standing !== null) raised.push(r.standing)
  }
  assert.equal(raised.length, 1, `fifty occurrences raised ${raised.length} standing conditions`)
})

test('two different faults are two conditions', () => {
  const log = new MishapLog()
  log.report(new Error('one'))
  log.report(new Error('two'))
  assert.ok(log.report(new Error('one')).standing, 'the first fault never became a condition')
  assert.ok(log.report(new Error('two')).standing, 'the second fault was suppressed by the first')
})

test('a fault whose message carries a counter crosses once, not forty times', () => {
  // The same normalisation that keeps the transcript quiet has to keep the strip quiet, and for
  // a sharper reason: a transcript line scrolls and a standing condition does not.
  const log = new MishapLog()
  const raised: string[] = []
  for (let n = 1; n <= 40; n += 1) {
    const r = log.report(new Error(`EACCES: permission denied, open '/w/sessions.json.42.${n}.tmp'`))
    if (r.standing !== null) raised.push(r.standing)
  }
  assert.equal(raised.length, 1, `forty registry-write failures raised ${raised.length} conditions`)
})

test('the standing sentence still names the fault', () => {
  // It goes on a strip, away from the transcript that has the context. A condition reading only
  // "something happened twice" is one nobody can act on.
  const log = new MishapLog()
  log.report(new Error("Error invoking remote method 'office:tasks': Error: No handler registered for 'office:tasks'"))
  const second = log.report(new Error("Error invoking remote method 'office:tasks': Error: No handler registered for 'office:tasks'"))
  assert.match(second.standing ?? '', /office:tasks/, 'the standing condition does not name the channel')
})

test('the subscription raises it, and only when a caller wants it', () => {
  const s = source()
  const said: string[] = []
  const standing: string[] = []
  watchForMishaps(s, (line) => said.push(line), (line) => standing.push(line))

  s.fire('error', { error: new Error('drawing broke') })
  s.fire('error', { error: new Error('drawing broke') })

  assert.deepEqual(said.length, 1, 'the repeat was said in the transcript twice')
  assert.deepEqual(standing.length, 1, 'the repeat did not become a standing condition')

  // And a caller that passes no `raise` still gets every sentence rather than throwing.
  const plain = source()
  const only: string[] = []
  watchForMishaps(plain, (line) => only.push(line))
  assert.doesNotThrow(() => {
    plain.fire('error', { error: new Error('twice') })
    plain.fire('error', { error: new Error('twice') })
  })
  assert.equal(only.length, 1)
})

test('a raise that throws does not stop the transcript getting its line', () => {
  // Two reporters, two failure modes. The one that matters is the second: a strip that cannot be
  // written must not take the transcript — the surface that always works — down with it.
  const s = source()
  const said: string[] = []
  watchForMishaps(s, (line) => said.push(line), () => {
    throw new Error('the strip is gone')
  })

  s.fire('error', { error: new Error('boom') })
  assert.doesNotThrow(() => s.fire('error', { error: new Error('boom') }))
  assert.equal(said.length, 1, 'the transcript lost its line because the strip threw')
})
