/**
 * What the panel draws, and which silence it is drawing.
 *
 * `what-the-office-remembers.test.ts` covers the reading and the lede. This is the surface: three
 * failures that must not look alike, a kind that is never guessed at, and a file that is a note
 * rather than a record saying so on its own card.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { renderMemory } from '../src/renderer/views/memory.js'
import { parseMemory, type MemoryReport } from '../src/shared/memory.js'

installDom()

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

const RECORD = `---
title: The registry is the only record of a conversation
type: fact
created: 2026-08-27
---

Nothing else on disk lists them.
`

function panel(
  report: Partial<MemoryReport> = {},
  focus?: string,
): { host: El; text: string; cards: El[]; groups: string[] } {
  const host = document.createElement('div')
  renderMemory(host as unknown as HTMLElement, { memories: [], unread: [], problem: null, ...report }, focus)
  const el = host as unknown as El
  return {
    host: el,
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    cards: all(el).filter((n) => n.classList.contains('memcard')),
    groups: all(el).filter((n) => n.classList.contains('memory__group')).map((n) => (n.textContent ?? '').trim()),
  }
}

test('an office that has recorded nothing is told how to start, not shown an empty box', () => {
  const p = panel()
  assert.match(p.text, /Nothing recorded yet/)
  assert.match(
    p.text,
    /Ask the memory-keeper/,
    'the empty state names no next step, so it reads as a panel that failed to load rather than ' +
      'a workspace nobody has written notes in',
  )
  assert.equal(p.cards.length, 0)
})

test('a directory that would not open draws no list under its own excuse', () => {
  // A list under "the office cannot tell you what it remembers" reads as "and here is what is in
  // it", which is the contradiction the sentence exists to avoid.
  const p = panel({ problem: 'EACCES: permission denied', memories: [parseMemory('a', RECORD)] })

  assert.match(p.text, /cannot tell you what it remembers/)
  assert.equal(p.cards.length, 0, 'memories were drawn under a sentence saying they could not be read')
  assert.doesNotMatch(p.text, /Nothing recorded yet/)
})

test('an unreadable file is named, one by one, rather than counted', () => {
  // It may be the record of the very thing somebody is looking for, and a count cannot be
  // searched for later.
  const p = panel({ unread: [{ id: 'half-written', cause: 'EACCES: permission denied' }] })
  assert.match(p.text, /memory\/half-written\.md could not be read/)
  assert.match(p.text, /EACCES/, 'the cause is not carried, so nobody can act on it')
})

test('a kind the keeper does not use gets a group of its own, not one of the five', () => {
  const p = panel({
    memories: [parseMemory('a', RECORD), parseMemory('b', '---\ntype: musings\ntitle: Hm\n---\n\nHm.\n')],
  })
  assert.deepEqual(p.groups, ['Facts', 'Recorded without a type'])
})

test('a note with no frontmatter says it is a note', () => {
  const p = panel({ memories: [parseMemory('a-note-somebody-left', 'The retry cap is next.\n')] })

  assert.match(p.text, /a note, not a record/)
  assert.equal(p.cards[0]?.classList.contains('memcard--note'), true, 'a note is drawn identically to a record')
  assert.match(p.text, /a-note-somebody-left/, 'the filename is not shown, so it cannot be found to edit')
})

test('a record with no date says so rather than leaving the line blank', () => {
  // The keeper is told to use absolute dates, so no date is a rule not followed — which is worth
  // seeing, and a blank space is not a way of saying it.
  const p = panel({ memories: [parseMemory('x', '---\ntitle: Undated\ntype: fact\n---\n\nA thing.\n')] })
  assert.match(p.text, /no date recorded/)
})

test('a revision is shown as one, because when it changed is the useful half', () => {
  const p = panel({
    memories: [parseMemory('x', '---\ntitle: T\ntype: fact\ncreated: 2026-08-19\nupdated: 2026-08-26\n---\n\nA thing.\n')],
  })
  assert.match(p.text, /recorded 2026-08-19 · revised 2026-08-26/)
})

test('a title with nothing under it says the file was started', () => {
  // An empty card reads as a rendering fault. "Nothing written under this title yet" is both
  // true and the thing somebody would want to know.
  const p = panel({ memories: [parseMemory('x', '---\ntitle: Started\ntype: fact\n---\n')] })
  assert.match(p.text, /Nothing written under this title yet/)
})

test('every memory is drawn, in its group, with its file path', () => {
  // The control: without this, the assertions above are about an empty panel.
  const p = panel({
    memories: [
      parseMemory('one', RECORD),
      parseMemory('two', '---\ntitle: A decision\ntype: decision\ncreated: 2026-08-01\n---\n\nWhy.\n'),
    ],
  })
  assert.equal(p.cards.length, 2)
  assert.deepEqual(p.groups, ['Decisions', 'Facts'], 'the group order is not the declared one')
  assert.match(p.text, /memory\/one\.md/)
  assert.match(p.text, /memory\/two\.md/)
})

test('the body is markdown, because the keeper writes markdown', () => {
  /**
   * Its prompt ends every record with `**Why it matters:** <one line>`. Rendered as plain text
   * that puts a pair of literal asterisks on essentially every card — which is what the running
   * app showed on the first one it drew.
   */
  const p = panel({
    memories: [parseMemory('x', '---\ntitle: T\ntype: fact\n---\n\nA thing.\n\n**Why it matters:** because.\n')],
  })

  assert.doesNotMatch(p.text, /\*\*/, `the body shows literal asterisks: ${JSON.stringify(p.text.slice(-80))}`)
  assert.match(p.text, /Why it matters/, 'the line was dropped rather than rendered')
  assert.ok(
    all(p.host).some((n) => n.tag === 'strong'),
    'the emphasis the keeper writes is not rendered as emphasis',
  )
})

test('a body that is only markup still draws something', () => {
  // A record whose body renders to nothing would be an empty card — the state the "nothing
  // written under this title" line exists to avoid, arriving by a different route.
  const p = panel({ memories: [parseMemory('x', '---\ntitle: T\ntype: fact\n---\n\nplain.\n')] })
  assert.match(p.text, /plain/)
})

test('a memory opened from a search is marked, and only that one', () => {
  /*
   * The panel is a list, and a search result that opens the list has not taken anybody anywhere —
   * it has handed them the same haystack with the panel in front of it. One memory on this
   * machine hid that; forty would not.
   */
  const two = [parseMemory('a', RECORD), parseMemory('b', RECORD)]
  const marked = (p: ReturnType<typeof panel>): number =>
    p.cards.filter((c) => c.classList.contains('memory__card--found')).length

  assert.equal(marked(panel({ memories: two }, 'b')), 1, 'the panel marked no card, or marked several')

  // The ordinary open, from the menu rather than from a result, marks nothing — a permanent
  // highlight on one card is a claim that somebody was sent there.
  assert.equal(marked(panel({ memories: two })), 0)
})

test('a memory that is gone says so, rather than opening a list without it', () => {
  /*
   * Found in review and then driven: deleting the memory between the search and the press left the
   * panel open with nothing marked. The row promised "open" and landed nowhere, silently — while
   * the conversation arm already said why in the same situation. Two arms of one control giving
   * opposite accounts of the same event.
   */
  const gone = panel({ memories: [parseMemory('a', RECORD)] }, 'b')
  assert.match(gone.text, /is not here now/, 'the panel opened without the memory and said nothing')
  assert.match(gone.text, /\bb\b/, 'the sentence does not name which memory was missing')

  // Present, and it is marked rather than explained away.
  const there = panel({ memories: [parseMemory('a', RECORD)] }, 'a')
  assert.doesNotMatch(there.text, /is not here now/)
  assert.equal(there.cards.filter((c) => c.classList.contains('memory__card--found')).length, 1)

  // And an ordinary open, with no focus asked for, says nothing either way.
  assert.doesNotMatch(panel({ memories: [parseMemory('a', RECORD)] }).text, /is not here now/)
})

test('could not look and is not there are different sentences', () => {
  /*
   * The distinction this whole feature is about, one level in. A person who opened one memory from
   * a search result and lands on "memory could not be read" has been told about the directory and
   * nothing about what they pressed — and telling them it is *not here* would be worse than
   * silence, because the office did not look and does not know.
   */
  const blind = panel({ problem: 'memory/ exists and could not be opened' }, 'why-backoff')
  assert.match(blind.text, /could not be checked/, 'the press went unanswered when the directory would not open')
  assert.doesNotMatch(blind.text, /is not here now/, 'an unreadable directory was reported as a missing memory')

  // And the other way: read completely, genuinely absent.
  const gone = panel({ memories: [parseMemory('a', RECORD)] }, 'why-backoff')
  assert.match(gone.text, /is not here now/)
  assert.doesNotMatch(gone.text, /could not be checked/)

  // An unreadable directory with nobody having pressed anything says neither.
  const plain = panel({ problem: 'memory/ exists and could not be opened' })
  assert.doesNotMatch(plain.text, /could not be checked/)
  assert.doesNotMatch(plain.text, /is not here now/)
})
