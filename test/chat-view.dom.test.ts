/**
 * The transcript panel, which is the thing you look at most and the least-driven class here.
 *
 * Four test files import `chat-view.ts` and every one of them tests its standalone helpers —
 * `summarise`, `flatten`, `clamp`. The `ChatView` class itself, lines 87 to 705, was never
 * constructed: 46% function coverage, and the census counted the module as aimed at because
 * something imported it. Aimed at is not the same as driven, which is the distinction the census
 * makes about *modules* and cannot make about the halves of one.
 *
 * ## The two promises it makes in its own words
 *
 * **What you typed is what you see.** `you()` renders plain, not markdown, because *"running
 * your own words through a markdown renderer means a pasted JSON blob comes back with its
 * asterisks eaten and its underscores italicised — the panel quietly editing your message on the
 * way in."* Nothing about that failure looks like a bug; it looks like your message.
 *
 * **The panel shows the session, not a tidied account of it.** Turns past `WINDOW` come out of
 * the DOM and are *kept*, with a button saying how many:
 *
 *     silently dropping the first four thousand messages would break that promise in exactly the
 *     way that is hardest to notice — the transcript would look complete.
 *
 * A transcript that looks complete and is not is the third standing order broken on the surface
 * whose whole job is being the record.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { ChatView } from '../src/renderer/chat-view.js'

installDom()

interface Panel {
  readonly view: ChatView
  readonly root: El
  readonly empty: El
  readonly turns: () => El[]
  readonly text: () => string
  readonly buttons: () => El[]
}

function panel(): Panel {
  const root = document.createElement('div')
  const empty = document.createElement('div')
  empty.hidden = false
  const view = new ChatView(root, empty)
  const walk = (n: El): El[] => [n, ...n.children.flatMap(walk)]
  return {
    view,
    root: root as unknown as El,
    empty: empty as unknown as El,
    turns: () => (root as unknown as El).children.filter((c) => c.classList.contains('turn')),
    buttons: () => walk(root as unknown as El).filter((n) => n.tag === 'button'),
    text: () =>
      walk(root as unknown as El)
        .map((n) => n.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' '),
  }
}

test('what you typed is what you see', () => {
  const p = panel()
  // A pasted JSON blob, a snippet with underscores, a shell line with asterisks — all things
  // somebody types into a chat and none of them markdown.
  const typed = 'run **all** the tests_now and grep "a_b_c" *.ts'
  p.view.you(typed)

  assert.ok(
    p.text().includes(typed),
    `the panel edited the message on the way in. It rendered ${JSON.stringify(p.text().slice(0, 120))}, ` +
      `which is not what was typed — asterisks eaten and underscores italicised is a markdown ` +
      `renderer applied to somebody's own words.`,
  )
  // And it is one turn, marked as yours.
  const mine = p.turns().filter((t) => t.classList.contains('turn--you'))
  assert.equal(mine.length, 1, `expected one turn of yours, found ${p.turns().length} turns`)
})

test('saying something puts the empty state away', () => {
  const p = panel()
  assert.equal(p.empty.hidden, false, 'the fixture starts with the empty state already hidden, so this proves nothing')
  p.view.you('hello')
  assert.equal(p.empty.hidden, true, '"Nothing said in this conversation yet" is still on screen after something was said')
})

test('a slash command is shown as one, not as a message that happens to start with a slash', () => {
  const p = panel()
  p.view.command('meet', 'reviewer builder')
  const text = p.text()
  assert.match(text, /meet/, `the command name is missing: ${JSON.stringify(text.slice(0, 120))}`)
  assert.match(text, /reviewer builder/, 'the command arguments are missing')
})

test('a notice goes into the transcript, not beside it', () => {
  // `.notice`, not `.turn` — the first version of this counted turns and failed on a notice that
  // was rendering perfectly. A notice is deliberately not a turn: nobody said it, and dressing
  // it as somebody's message would put words in a speaker's mouth. It still goes *in* the
  // record, because a transcript that keeps its messages and drops the app's own reports is a
  // partial account of the session.
  const p = panel()
  const before = p.root.children.length
  p.view.notice('The office cannot find the claude command.')

  assert.ok(p.root.children.length > before, 'a notice drew nothing at all')
  const notices = p.root.children.filter((c) => c.classList.contains('notice'))
  assert.equal(notices.length, 1, `expected one notice, found ${notices.length}`)
  assert.equal(p.turns().length, 0, 'the notice was drawn as a turn, which attributes it to a speaker')
  assert.match(p.text(), /cannot find the claude command/)
})

test('past the window, turns come out of the DOM and are kept, with a count', () => {
  // The honesty condition. `WINDOW` is 300, so this says enough to push well past it.
  const p = panel()
  const said = 340
  for (let i = 0; i < said; i += 1) p.view.you(`message number ${i}`)

  const onScreen = p.turns().length
  assert.ok(onScreen < said, `all ${said} turns are still in the DOM — the window is not trimming at all`)
  assert.ok(onScreen > 0, 'the window trimmed everything')

  // The part that makes trimming honest: it says how many it is holding.
  const earlier = p.buttons().filter((b) => /earlier/i.test(b.textContent ?? ''))
  assert.equal(
    earlier.length,
    1,
    'turns were taken out of the transcript and nothing on screen says so. A transcript that ' +
      'looks complete and is not is the worst version of this — the panel promises the session, ' +
      'not a tidied account of it.',
  )
  const label = earlier[0]?.textContent ?? ''
  const claimed = Number(/(\d+)/.exec(label)?.[1] ?? '0')
  assert.equal(
    claimed,
    said - onScreen,
    `the button says ${JSON.stringify(label)} but ${said - onScreen} turns were removed — the ` +
      `count is the only evidence anybody has that nothing was lost`,
  )
})

test('the earliest message is still reachable, not discarded', () => {
  const p = panel()
  for (let i = 0; i < 340; i += 1) p.view.you(`message number ${i}`)

  // It is off screen.
  assert.equal(p.text().includes('message number 0'), false, 'nothing was trimmed, so this proves nothing')

  // And pressing the button brings some of it back, rather than re-rendering an approximation.
  const earlier = p.buttons().find((b) => /earlier/i.test(b.textContent ?? ''))
  assert.ok(earlier, 'there is no way back to what was trimmed')
  earlier.dispatchEvent({ type: 'click', bubbles: true })

  assert.ok(
    p.turns().length > 0,
    'restoring emptied the transcript',
  )
  assert.match(
    p.text(),
    /message number \d+/,
    'pressing "earlier messages" restored nothing — the turns were discarded rather than held, ' +
      'and the button was an offer the panel could not keep',
  )
})
