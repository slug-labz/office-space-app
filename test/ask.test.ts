/**
 * The manager's questions, parsed.
 *
 * The input to this is text a language model wrote, which is the whole reason it is tested
 * against what a model *actually* produces rather than against the format we asked for. Models
 * reach for em dashes, en dashes and hyphens interchangeably; they mark recommendations in three
 * different places; they occasionally open an `ask` block and write a paragraph.
 *
 * The rule every test below is really checking: **a malformed question falls back to a code
 * block, and never renders as an empty card.** A question with nothing to click is worse than no
 * question — the office would have stopped and given the person no way to start it again.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AskQueue, parseAsk, type AskCard } from '../src/shared/transcript/ask.js'

test('a question with options, one of them recommended', () => {
  const ask = parseAsk(
    [
      'Which database should this use?',
      '- Postgres — recommended. You already run one, and this data is relational.',
      '- SQLite — nothing to run, but no concurrent writes.',
      '- Something else — tell me',
    ].join('\n'),
  )

  assert.ok(ask)
  assert.equal(ask.question, 'Which database should this use?')
  assert.deepEqual(
    ask.options.map((o) => o.label),
    ['Postgres', 'SQLite', 'Something else'],
  )
  assert.equal(ask.options[0]?.recommended, true)
  // The word itself is stripped from the sentence, because it is already a badge. Left in, it
  // reads "recommended · recommended. You already run one".
  assert.equal(ask.options[0]?.detail, 'You already run one, and this data is relational.')
  assert.equal(ask.options[1]?.recommended, false)
})

test('em dash, en dash and hyphen all separate a label from its detail', () => {
  // Models use all three and the choice is not stable between runs. Recognising one would
  // silently swallow the other two into the label, so the button would read "Postgres - you
  // already run one, and this data is relational" and send that as the answer.
  for (const dash of ['—', '–', '-']) {
    const ask = parseAsk(`Pick one\n- Postgres ${dash} it is already running.\n- SQLite ${dash} no server.`)
    assert.equal(ask?.options[0]?.label, 'Postgres', `failed on "${dash}"`)
    // Capitalised, not verbatim — the detail is rendered on its own line under the label, where
    // it is a sentence rather than the back half of one. See the fragment test below.
    assert.equal(ask?.options[0]?.detail, 'It is already running.')
  }
})

/**
 * The card that was pasted back as badly formatted.
 *
 * Models write the recommendation and its reason as one clause — `— recommended, since the
 * exploration is already done` — so stripping the word we already show as a badge left the card
 * reading "since the exploration is already done": lowercase, no subject, visibly the back half
 * of a sentence somebody cut. Every option on that card had the same shape.
 *
 * The dangling word is always a subordinating conjunction, because that is what attaches a
 * reason to the claim it supports. Once the claim is a badge, the conjunction has nothing to
 * attach to and the clause it introduced is the sentence.
 */
test('stripping the badge does not leave a sentence fragment behind', () => {
  const ask = parseAsk(
    'What do you want to point the office at?\n' +
      "- Pick up the undo thread — recommended, since the exploration is already done, so it's the cheapest thing.\n" +
      "- Something new — tell me what you're building and I'll work out what it needs.",
  )

  assert.equal(ask?.options[0]?.recommended, true)
  assert.equal(
    ask?.options[0]?.detail,
    "The exploration is already done, so it's the cheapest thing.",
    'the badge word, its punctuation and the conjunction that only existed to attach to it all go',
  )
  // And an option that never had a badge keeps every word it was given.
  assert.equal(ask?.options[1]?.detail, "Tell me what you're building and I'll work out what it needs.")
})

test('every conjunction a model reaches for is handled, not just the one it used that day', () => {
  for (const because of ['since', 'because', 'as', 'given that', 'Since', 'BECAUSE']) {
    const ask = parseAsk(`Pick one\n- Postgres — recommended, ${because} you already run one.\n- SQLite — no server.`)
    assert.equal(ask?.options[0]?.detail, 'You already run one.', `failed on "${because}"`)
  }
})

test('an option with no detail is still an option', () => {
  const ask = parseAsk('Pick one\n- Yes\n- No')
  assert.deepEqual(ask?.options.map((o) => o.label), ['Yes', 'No'])
  assert.equal(ask?.options[0]?.detail, '')
})

test('only the first recommendation counts', () => {
  // Two recommendations is not a recommendation. A model that marks three is telling you
  // nothing while looking like it told you something.
  const ask = parseAsk(
    'Pick one\n- A — recommended, because x\n- B — recommended, because y\n- C — because z',
  )
  assert.deepEqual(ask?.options.map((o) => o.recommended), [true, false, false])
})

test('a block with fewer than two options is not a question', () => {
  // One option is a statement with a button on it. Falling through to a code block shows the
  // text; rendering a card would show a question you cannot answer.
  assert.equal(parseAsk('Which database?\n- Postgres — the only one'), null)
  assert.equal(parseAsk('Which database?'), null)
})

test('an empty or prose-only block is not a question', () => {
  assert.equal(parseAsk(''), null)
  assert.equal(parseAsk('   \n  \n'), null)
  assert.equal(parseAsk('I think we should use Postgres for this, since you already run one.'), null)
})

test('asterisk bullets work, because half of all markdown uses them', () => {
  const ask = parseAsk('Pick one\n* Yes — do it\n* No — leave it')
  assert.deepEqual(ask?.options.map((o) => o.label), ['Yes', 'No'])
})

test('blank lines and indentation between options are ignored', () => {
  // What a model writes when it is being tidy.
  const ask = parseAsk('Which one?\n\n  - Alpha — first\n\n  - Beta — second\n')
  assert.deepEqual(ask?.options.map((o) => o.label), ['Alpha', 'Beta'])
  assert.equal(ask?.question, 'Which one?')
})

test('RECOMMENDED in any case is recognised', () => {
  for (const word of ['recommended', 'Recommended', 'RECOMMENDED']) {
    const ask = parseAsk(`Pick\n- A — ${word}. because\n- B — because`)
    assert.equal(ask?.options[0]?.recommended, true, `failed on "${word}"`)
  }
})

test('a word that merely contains "recommend" is not a recommendation', () => {
  // "recommendations" and "recommending" are prose, not a marker.
  const ask = parseAsk('Pick\n- A — I have no recommendations here\n- B — nor here')
  assert.equal(ask?.options[0]?.recommended, false)
})

// ──────────────────────────────────────────── one question at a time, and none of them lost ──

/**
 * The enforcement, and the fix that would have been worse than the bug.
 *
 * `manager.md` says one question per turn. That is prompt guidance, and prompt guidance loses
 * eventually — a turn arrived with several `ask` blocks and the panel drew every card stacked on
 * top of the last. So the renderer enforces it instead of hoping.
 *
 * The naive enforcement is "draw the first and drop the rest", and it is the worse bug: the
 * manager asked three questions because it wants three answers, and silently discarding two
 * leaves it waiting on information the person was never shown and never had a chance to give.
 * Everything below is written against **both** failures — one card on screen, and every question
 * eventually answerable.
 */

/** A card that records what the queue did to it, in order. */
function spy(): AskCard & { readonly log: string[] } {
  const log: string[] = []
  return {
    log,
    show: (after) => log.push(`show:${after}`),
    hide: () => log.push('hide'),
    settle: (chosen) => log.push(`settle:${chosen}`),
  }
}

test('a turn with two questions opens one of them', () => {
  const queue = new AskQueue()
  const first = spy()
  const second = spy()

  queue.register('Which database?', first)
  queue.register('Which host?', second)

  // Registering the second must not open it, and must not close the first.
  assert.equal(first.log.at(-1), 'show:1', 'the first question is open, with one behind it')
  assert.equal(second.log.at(-1), 'hide', 'the second is drawn and waiting, not on screen')
  assert.deepEqual(queue.waiting, ['Which database?', 'Which host?'])
})

test('the second appears when the first is answered', () => {
  const queue = new AskQueue()
  const first = spy()
  const second = spy()
  queue.register('Which database?', first)
  queue.register('Which host?', second)

  queue.resolve('Which database?', 'Postgres')

  assert.equal(second.log.at(-1), 'show:0', 'the second is now the open question')
  // The answered one is not hidden. It is part of the record — the question was put and this is
  // what was said back, and a transcript that folds that away is a transcript missing a decision.
  assert.equal(first.log.at(-1), 'settle:Postgres')
  assert.deepEqual(queue.waiting, ['Which host?'])
})

test('skipping settles too, or the rest are lost by being permanently next', () => {
  const queue = new AskQueue()
  const second = spy()
  queue.register('One?', spy())
  queue.register('Two?', second)

  queue.resolve('One?', 'Skip that question — use your best judgement and carry on.')

  assert.equal(second.log.at(-1), 'show:0')
  assert.deepEqual(queue.waiting, ['Two?'])
})

test('three questions are all answerable, one after another — nothing is dropped', () => {
  const queue = new AskQueue()
  queue.register('A?', spy())
  queue.register('B?', spy())
  queue.register('C?', spy())

  const opened: string[] = []
  for (const question of ['A?', 'B?', 'C?']) {
    assert.equal(queue.waiting[0], question, `${question} should be the open one by now`)
    opened.push(question)
    queue.resolve(question, 'yes')
  }

  assert.deepEqual(opened, ['A?', 'B?', 'C?'], 'every question was eventually put')
  assert.deepEqual(queue.waiting, [], 'and every one of them was dealt with')
})

test('a redraw does not reopen a question that has been answered', () => {
  // A streamed reply is re-rendered from its whole source on every chunk, so the element holding
  // a question is thrown away and rebuilt several times a second. Keyed on the question text,
  // the queue's memory survives that — the rebuilt card is drawn closed, around what was chosen.
  const queue = new AskQueue()
  queue.register('Which database?', spy())
  queue.resolve('Which database?', 'Postgres')

  const rebuilt = spy()
  queue.register('Which database?', rebuilt)

  assert.deepEqual(rebuilt.log, ['settle:Postgres'], 'the rebuilt card is closed, not live')
  assert.equal(queue.chosenFor('Which database?'), 'Postgres')
})

test('a redraw does not reorder the queue', () => {
  const queue = new AskQueue()
  queue.register('First?', spy())
  queue.register('Second?', spy())
  // The first card is rebuilt, which re-registers it. If that moved it to the back, the second
  // question would jump the queue and the first would be answered last.
  queue.register('First?', spy())
  assert.deepEqual(queue.waiting, ['First?', 'Second?'])
})

// The same rules, drawn — one card on screen, the next one after it — are in
// `transcript.dom.test.ts`. They need a DOM, and this file is checked without one.
