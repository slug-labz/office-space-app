/**
 * The two claims that are about the drawing, checked against the drawing.
 *
 * The repo's convention is that view *models* are tested and the DOM is not — the DOM is the
 * part `styles.css` can change, and `Ledger` is tested rather than the cards it produces. That
 * convention is right almost everywhere and wrong for these two, because for both of them the
 * claim **is** about what is on screen:
 *
 * - U6a: nineteen refusals render as **one block**, and the distinct commands are still in it.
 * - U6b: a two-question turn renders **one card**, and the second appears when the first is
 *   answered.
 *
 * A view-model test would assert that the summariser returns one object and the queue reports
 * one open question, and would pass just as happily against a renderer that drew nineteen
 * paragraphs and three stacked cards. That is the shape of test this repo keeps finding and
 * deleting.
 *
 * ## Why this file is named `.dom.test.ts`
 *
 * `tsconfig.json` deliberately omits the DOM library so that main-process code reaching for
 * `document` fails to compile, and it checks `test/**` under that config. A test that drives a
 * renderer is browser code and belongs with the browser half — so the name is the rule:
 * `*.dom.test.ts` is excluded from the base config and included by `tsconfig.renderer.json`.
 * Both configs still check everything else, and `npm test` runs this like any other test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { summariseRefusals, type Refusal } from '../src/shared/refusals.js'
import { refusalBlock } from '../src/renderer/views/refusal.js'
import { renderMarkdown } from '../src/renderer/markdown.js'
import { announcesItself, clamp, flatten, summarise } from '../src/renderer/chat-view.js'
import { AskQueue } from '../src/shared/transcript/ask.js'
import { installDom, click, type El } from './dom.js'

installDom()

// ─────────────────────────────────────────────────────── U6a: nineteen refusals, one block ──

const refusal = (detail: string, cause: Refusal['cause'] = 'unlisted', tool = 'Bash'): Refusal => ({
  tool,
  detail,
  cause,
})

test('nineteen refusals draw one block, and every distinct command is inside it', () => {
  const notice = summariseRefusals(
    Array.from({ length: 19 }, (_, i) => refusal(`npm run build:package-${i}`)),
  )
  assert.ok(notice)
  const el = refusalBlock(notice) as unknown as El

  // One statement of the problem, not nineteen. This is the assertion the wall failed.
  assert.equal(el.querySelectorAll('.refusal__head').length, 1)
  assert.equal(el.querySelectorAll('.refusal__head')[0]?.textContent, notice.headline)

  // …and nineteen commands still on screen. This is the assertion a "19 commands were refused"
  // summary would fail, which is the over-correction worth guarding against.
  const drawn = el.querySelectorAll('.refusal__command').map((c) => c.textContent)
  assert.equal(drawn.length, 19)
  assert.ok(drawn.includes('npm run build:package-0'))
  assert.ok(drawn.includes('npm run build:package-18'))

  // Still one of the office's own red notices rather than a new kind of thing.
  assert.ok(el.classList.contains('notice'))
})

test('a repeated command is one line carrying its count', () => {
  const notice = summariseRefusals(Array.from({ length: 11 }, () => refusal('git push')))
  const el = refusalBlock(notice!) as unknown as El

  assert.equal(el.querySelectorAll('.refusal__call').length, 1)
  assert.equal(el.querySelector('.refusal__times')?.textContent, '× 11')
})

test('a turn that hit both causes tags each line, and a turn with one cause tags none', () => {
  const both = refusalBlock(
    summariseRefusals([refusal('rm -rf /', 'denied'), refusal('npm publish', 'unlisted')])!,
  ) as unknown as El
  assert.deepEqual(both.querySelectorAll('.refusal__cause').map((c) => c.textContent), [
    'denied',
    'unlisted',
  ])

  // A column of identical tags beside every command is the noise this block exists to remove.
  const one = refusalBlock(summariseRefusals([refusal('a'), refusal('b')])!) as unknown as El
  assert.equal(one.querySelectorAll('.refusal__cause').length, 0)
})

test('a cut command says it was cut, in the text rather than in the styling', () => {
  // So it is still visibly cut when the line is copied out of the app.
  const el = refusalBlock(summariseRefusals([refusal(`echo ${'x'.repeat(400)}`)])!) as unknown as El
  assert.ok(el.querySelector('.refusal__command')?.textContent?.endsWith('…'))
})

test('a denial with no argument draws the tool and no empty command slot', () => {
  const el = refusalBlock(
    summariseRefusals([{ tool: 'WebFetch', detail: null, cause: 'unknown' }])!,
  ) as unknown as El

  assert.equal(el.querySelector('.refusal__tool')?.textContent, 'WebFetch')
  assert.equal(el.querySelectorAll('.refusal__command').length, 0)
})

// ──────────────────────────────────────────────────── U6b: several questions, one at a time ──

const TWO_QUESTIONS = [
  'Before I start, two things.',
  '',
  '```ask',
  'Which database should this use?',
  '- Postgres — recommended. You already run one.',
  '- SQLite — nothing to run.',
  '```',
  '',
  '```ask',
  'Where should it deploy?',
  '- Fly — recommended. Closest to the database.',
  '- Render — simpler dashboard.',
  '```',
].join('\n')

test('a two-question turn renders one card, and the second after the first is answered', () => {
  const queue = new AskQueue()
  const frag = renderMarkdown(TWO_QUESTIONS, queue) as unknown as El
  const cards = frag.querySelectorAll('.ask')

  // Both cards exist. Dropping one is the failure being guarded against, not the fix.
  assert.equal(cards.length, 2)
  assert.equal(cards[0]?.hidden, false, 'the first question is on screen')
  assert.equal(cards[1]?.hidden, true, 'the second is drawn and waiting')

  // And the person can tell more are coming, rather than being surprised by one appearing.
  const waiting = cards[0]?.querySelector('.ask__waiting')
  assert.equal(waiting?.hidden, false)
  assert.equal(waiting?.textContent, '1 more question after this one.')

  click(cards[0]!.querySelectorAll('.ask__option')[0]!)

  assert.equal(cards[1]?.hidden, false, 'the second question is now on screen')
  assert.equal(cards[0]?.hidden, false, 'and the answered one stays, showing what was chosen')
  assert.equal(cards[1]?.querySelector('.ask__waiting')?.hidden, true, 'nothing behind the last')
})

test('every question in a three-question turn is eventually answerable', () => {
  // The whole of "nothing is silently dropped", end to end and through the DOM.
  const three = [
    '```ask',
    'One?',
    '- A — first',
    '- B — second',
    '```',
    '',
    '```ask',
    'Two?',
    '- A — first',
    '- B — second',
    '```',
    '',
    '```ask',
    'Three?',
    '- A — first',
    '- B — second',
    '```',
  ].join('\n')

  const frag = renderMarkdown(three, new AskQueue()) as unknown as El
  const cards = frag.querySelectorAll('.ask')
  assert.equal(cards.length, 3)

  const asked: string[] = []
  for (let i = 0; i < 3; i++) {
    const open = cards.filter((c) => !c.hidden)
    assert.equal(open.length, i + 1, 'exactly one more card is open than before, never two')

    const current = cards[i]!
    assert.equal(current.hidden, false, `question ${i + 1} should be open by now`)
    asked.push(current.querySelector('.ask__q')?.textContent ?? '')
    click(current.querySelectorAll('.ask__option')[0]!)
  }

  assert.deepEqual(asked, ['One?', 'Two?', 'Three?'])
})

test('answering the open card still sends the answer', () => {
  // One-at-a-time must not cost the thing the card was for.
  const frag = renderMarkdown(TWO_QUESTIONS, new AskQueue()) as unknown as El
  const heard: unknown[] = []
  frag.addEventListener('office:answer', (event) => heard.push(event.detail))

  click(frag.querySelectorAll('.ask')[0]!.querySelectorAll('.ask__option')[0]!)
  assert.deepEqual(heard, ['Postgres'])
})

test('skipping the first still brings the second forward', () => {
  // A skip is a way out of the question, not a way to leave it permanently next.
  const queue = new AskQueue()
  const frag = renderMarkdown(TWO_QUESTIONS, queue) as unknown as El
  const cards = frag.querySelectorAll('.ask')

  click(cards[0]!.querySelector('.ask__skip')!)

  assert.equal(cards[1]?.hidden, false)
  assert.equal(queue.waiting.length, 1, 'the skipped question is settled, not still queued')
})

const ONE_QUESTION = [
  '```ask',
  'Which database?',
  '- Postgres — you already run one.',
  '- SQLite — no server.',
  '```',
].join('\n')

test('one question is drawn exactly as it always was', () => {
  // The common case, and one-at-a-time has to be invisible in it: nothing hidden, and nothing
  // announcing a queue of one.
  const cards = (renderMarkdown(ONE_QUESTION, new AskQueue()) as unknown as El).querySelectorAll('.ask')

  assert.equal(cards.length, 1)
  assert.equal(cards[0]?.hidden, false)
  assert.equal(cards[0]?.querySelector('.ask__waiting')?.hidden, true)
})

test('a caller with no queue still draws the card', () => {
  // Three of `renderMarkdown`'s callers have no conversation behind them. They must not lose the
  // card to an enforcement that has nowhere to put it.
  const cards = (renderMarkdown(ONE_QUESTION) as unknown as El).querySelectorAll('.ask')
  assert.equal(cards.length, 1)
  assert.equal(cards[0]?.hidden, false)
})

test('a redrawn card does not offer a question that has been answered', () => {
  // A streamed reply is re-rendered from its whole source on every chunk, so the element holding
  // a question is thrown away and rebuilt while it is being read. The rebuilt card must come
  // back closed — a redraw that reopens an answered question is the panel contradicting the
  // record it is supposed to be.
  const queue = new AskQueue()
  const first = renderMarkdown(ONE_QUESTION, queue) as unknown as El
  click(first.querySelectorAll('.ask__option')[0]!)

  const again = renderMarkdown(ONE_QUESTION, queue) as unknown as El
  const buttons = again.querySelectorAll('button')
  assert.ok(buttons.length > 0)
  assert.ok(
    buttons.every((b) => b.disabled),
    'every control on a rebuilt answered card is dead',
  )
  assert.ok(again.querySelector('.ask__option--chosen'), 'and it still shows what was chosen')
})

// ─────────────────── a message from a CLI this version has never met ──

/*
 * `toEvent` never drops a record it does not recognise: it returns
 * `{ kind: 'system', subtype: 'unknown', raw }` and keeps the whole thing. Nothing consumed it —
 * every `system` event fell through the transcript's `default`.
 *
 * So the parser refused to swallow an unfamiliar format and the transcript swallowed it one
 * function later, which is precisely the failure `stream.ts` opens by naming: *"a feed that
 * quietly swallows what it cannot read is a feed that lies about what happened."* That held for
 * a line that would not parse and not for a line that parsed into something unfamiliar — and the
 * second is the shape a CLI format change actually arrives in.
 */

test('an unrecognised message is announced', () => {
  assert.equal(announcesItself('unknown'), true)
  assert.equal(announcesItself('stream_event/unknown'), true)
})

test('the ordinary traffic is not', () => {
  // `init` is read elsewhere, and the deltas arrive several times a second. Announcing those
  // would put back the log clutter this panel was cut to remove — which would get the whole
  // notice ignored, including the one time it mattered.
  for (const quiet of ['init', 'stream_event/content_block_delta', 'stream_event/message_start', 'compact_boundary']) {
    assert.equal(announcesItself(quiet), false, `${quiet} would be announced`)
  }
})

test('a subtype that merely contains the word is not an unknown', () => {
  // `endsWith`, not `includes`. A future `unknown_tool_result` is a named thing this app has not
  // taught itself to read yet, and it is not the parser saying it could not tell what arrived.
  assert.equal(announcesItself('unknown_tool_result'), false)
  assert.equal(announcesItself('stream_event/unknown_field'), false)
})


// ── What a tool result says it did ───────────────────────────────────────────────────────────
//
// `flatten` and `summarise` decide the two pieces of text a person reads about work they did
// not watch happen: what a call was doing, and what it produced. Both read shapes the CLI owns
// and this app does not, and neither had a test.

test('THE BUG: a tool result renders what arrived, or nothing — never the name of a type', () => {
  // `String(part.text)` never fails, which is the problem. `String` turns every shape into some
  // string, so a malformed block put words into the transcript that nobody wrote — as the
  // *result of an employee's work*, at the surface where somebody checks what actually happened.
  assert.equal(flatten([{ type: 'text', text: undefined }]), '', 'not the word "undefined"')
  assert.equal(flatten([{ type: 'text', text: null }]), '', 'not the word "null"')
  assert.equal(flatten([{ type: 'text', text: { nested: 1 } }]), '', 'not "[object Object]"')
  assert.equal(flatten([{ type: 'text', text: 42 }]), '', 'a number is not the text it is named')
  assert.equal(flatten([{ type: 'text', text: ['a'] }]), '', 'not "a"')
})

test('and a well-formed result still reads exactly as it arrived', () => {
  // The other half. A fix that emptied everything would pass the test above and be worse.
  assert.equal(flatten('a plain string'), 'a plain string')
  assert.equal(flatten([{ type: 'text', text: 'hello' }]), 'hello')
  assert.equal(
    flatten([{ type: 'text', text: 'one' }, { type: 'text', text: ' and two' }]),
    'one and two',
    'parts join in order, with nothing inserted between them',
  )
  // A readable part beside an unreadable one keeps what it can.
  assert.equal(flatten([{ type: 'text', text: 'kept' }, { type: 'text', text: undefined }]), 'kept')
  // Shapes that are not content at all are not an error, just nothing.
  for (const shape of [undefined, null, 42, { text: 'not an array' }]) {
    assert.equal(flatten(shape), '', JSON.stringify(shape))
  }
  assert.equal(flatten([null, 'bare string', { no: 'text' }]), '')
})

test('a summary picks the first field that actually says something', () => {
  // `??` only skips `null` and `undefined`. A call carrying `description: ''` beside a real
  // `file_path` summarised as nothing at all — the emptier field winning by being listed first.
  assert.equal(summarise('Read', { description: '', file_path: 'src/app.ts' }), 'src/app.ts')
  assert.equal(summarise('Read', { description: '   ', file_path: 'src/app.ts' }), 'src/app.ts')
  // A non-string in a preferred slot is skipped rather than falling through to the key list.
  assert.equal(summarise('Read', { description: 42, file_path: 'src/app.ts' }), 'src/app.ts')
  // And the order still holds when the first field is real.
  assert.equal(summarise('Read', { description: 'Read the config', file_path: 'src/app.ts' }), 'Read the config')
})

test('a call with nothing sayable names itself and its arguments', () => {
  // Better than an empty line: the reader learns a call happened and what it was given, which
  // is the difference between "something ran" and nothing at all.
  assert.equal(summarise('Bash', { timeout: 5000, quiet: true }), 'Bash(timeout, quiet)')
  assert.equal(summarise('Read', {}), '')
  assert.equal(summarise('Read', undefined), '')
})

test('a long summary is cut with a mark, not silently', () => {
  // Truncation that looks like the whole value is how a "verbatim" guarantee gets broken
  // without anybody noticing — this repo has paid for that once already.
  const long = 'x'.repeat(500)
  const out = summarise('Bash', { command: long })
  assert.ok(out.length < long.length, 'it was cut')
  assert.ok(out.endsWith('…'), 'and it says so')

  assert.equal(clamp('short', 200), 'short')
  assert.equal(clamp('  padded  ', 200), 'padded', 'trimmed before measuring, so whitespace is not content')
  assert.equal(clamp('abcdef', 3), 'abc\n…')
})
