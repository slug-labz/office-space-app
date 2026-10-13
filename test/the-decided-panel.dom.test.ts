/**
 * Drawing what the office did while you were out.
 *
 * The counting is tested against strings and the read against a real filesystem. What only a
 * rendering test can check is **which sentence a person meets, and in what order** — and on this
 * surface that is not cosmetic. The panel's whole subject is what the office can and cannot tell
 * you, so a silence drawn in the wrong place is the feature failing rather than looking untidy.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderDecided } from '../src/renderer/views/decided.js'
import { installDom, type El } from './dom.js'
import type { Decision, DecisionReport } from '../src/shared/decisions.js'

installDom()

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

const decision = (over: Partial<Decision> = {}): Decision => ({
  id: '1772614800000.allowed.sess-a.t-91',
  at: 1_772_614_800_000,
  outcome: 'allowed',
  request: {
    sessionId: 'sess-a',
    project: null,
    toolUseId: 't-91',
    tool: 'Bash',
    input: { command: 'npm test -- --run' },
    askedAt: '2026-09-04T02:20:00.000Z',
    waitMs: null,
    agent: 'tester',
  },
  reason: null,
  decidedAt: '2026-09-04T02:20:11.000Z',
  ...over,
})

const report = (over: Partial<DecisionReport> = {}): DecisionReport => ({
  decisions: [],
  unread: [],
  problem: null,
  beyond: 0,
  ...over,
})

function draw(r: DecisionReport, focus?: string): { host: El; text: string } {
  const node = document.createElement('div')
  renderDecided(node as unknown as HTMLElement, r, focus)
  const host = node as unknown as El
  return { host, text: (host.textContent ?? '').replace(/\s+/g, ' ').trim() }
}

test('a record that could not be opened is not an office that decided nothing', () => {
  // The fourth standing order on the surface built to serve it. "Nothing decided yet" over a
  // directory that would not open is the exact failure this whole feature exists to remove.
  const { text } = draw(report({ problem: 'decided/ exists and could not be opened: EACCES' }))
  assert.match(text, /cannot tell you what it approved/)
  assert.doesNotMatch(text, /Nothing decided yet/)
})

test('nothing below an unreadable record, because a list there would read as its contents', () => {
  const { host } = draw(report({ problem: 'EACCES', decisions: [decision()] }))
  assert.equal(all(host).some((n) => n.className.includes('deccard')), false, 'cards were drawn under "could not open"')
})

test('a decision somebody answered and the office lost is not reported as a refusal', () => {
  /*
   * The worst lie available on this panel. Somebody sat down and answered; what was lost is which
   * way. Wording it as a decline would blame the person for the office's own failure to read them,
   * and wording it as an approval would claim a permission nobody can show was given.
   */
  const { text } = draw(report({ decisions: [decision({ outcome: 'unreadable' })] }))
  assert.match(text, /could not read which way/)
  assert.doesNotMatch(text, /You declined this/)
  assert.doesNotMatch(text, /You approved this/)
})

test('the outcome is in the class as well as the words, and the lost one is not a third colour', () => {
  // Colour alone is the wrong encoding for a record of what you permitted. The dashed edge is
  // what makes "the office could not tell" look like neither of the two answers it is not.
  for (const outcome of ['allowed', 'declined', 'unreadable'] as const) {
    const { host } = draw(report({ decisions: [decision({ outcome })] }))
    const card = all(host).find((n) => n.className.includes('deccard '))
      ?? all(host).find((n) => n.className.startsWith('deccard'))
    assert.ok(card?.className.includes(`deccard--${outcome}`), `a ${outcome} record carries no outcome class`)
  }
})

test('the card says what the call was going to do, verbatim', () => {
  // Drawn with `summarise()` — the same function the live approval card uses. A second one would
  // eventually describe the same command differently on two surfaces of the same app.
  const { text } = draw(report({ decisions: [decision()] }))
  assert.match(text, /npm test -- --run/)
  assert.match(text, /Bash/)
})

test("the office's own words on a decline are kept, because they are the only record of why", () => {
  const { text } = draw(report({ decisions: [decision({ outcome: 'declined', reason: 'Not to that host.' })] }))
  assert.match(text, /Not to that host\./)
})

test('a record with no time says so rather than leaving the slot blank', () => {
  /*
   * A blank there reads as a rendering fault. "No time recorded" is a fact about a file written
   * before the gate put times in names, and it is the honest half of `undated` reaching the panel.
   */
  const { text } = draw(report({ decisions: [decision({ at: null, decidedAt: null })] }))
  assert.match(text, /no time recorded/)
})

test('records with no readable time sit under a heading of their own, not among the dated ones', () => {
  // The memory panel's `unlabelled` move: the ones that did not say get a name rather than being
  // folded in. Sorting one as oldest would be a claim its filename does not make. In `decided/`
  // this means a damaged name rather than an older format — the directory postdates the dating.
  const { text } = draw(
    report({
      decisions: [decision({ at: null, id: 'old.t-3', decidedAt: null }), decision()],
    }),
  )
  assert.match(text, /Recorded with no readable time/)
  assert.ok(
    text.indexOf('npm test') < text.indexOf('Recorded with no readable time'),
    'an undated record was drawn among the dated ones',
  )
})

test('a workspace that has decided nothing says so, and says what the record is for', () => {
  const { text } = draw(report())
  assert.match(text, /Nothing decided yet/)
  assert.match(text, /a night you were not here for has an answer afterwards/)
})

test('nothing readable is not nothing, when files are there', () => {
  /*
   * `memoryLede` shipped "Nothing recorded · 1 more exists" and had the contradiction caught in
   * the running app — more than nothing. There is no reason to rediscover it here, so the empty
   * case has its own wording and this pins it.
   */
  const { text } = draw(report({ unread: [{ id: 'a', cause: 'EACCES' }] }))
  assert.match(text, /Nothing readable recorded/)
  assert.doesNotMatch(text, /Nothing decided yet/)
})

test('an unreadable record is named, not counted', () => {
  // A count cannot be searched for later, and the file that would not open may be the very
  // decision somebody came looking for.
  const { text } = draw(report({ unread: [{ id: '1772612000000.allowed.sess-a.t-80', cause: 'EACCES' }] }))
  assert.match(text, /1772612000000\.allowed\.sess-a\.t-80/)
})

test('a focus that is no longer there is said, and said above the list', () => {
  // The click promised to land somewhere. A panel that quietly opens on a list not containing the
  // thing somebody clicked has reported success and landed nowhere.
  const { text } = draw(report({ decisions: [decision()] }), 'gone.t-1')
  assert.match(text, /is not here now/)
  assert.ok(text.indexOf('is not here now') < text.indexOf('npm test'), 'the notice was drawn under the list')
})

test('an unreadable record does not answer a focus with "it is not there"', () => {
  /*
   * Could-not-check and is-not-there, kept apart at the point a person would otherwise assume the
   * second. The office did not look, so it does not know whether the thing they clicked is there.
   */
  const { text } = draw(report({ problem: 'EACCES' }), 'some-id')
  assert.match(text, /could not be checked/)
  assert.doesNotMatch(text, /is not here now/)
})

test('the record somebody opened at is marked', () => {
  const { host } = draw(report({ decisions: [decision()] }), '1772614800000.allowed.sess-a.t-91')
  assert.ok(
    all(host).some((n) => n.className.includes('deccard--found')),
    'the record the panel was opened at is indistinguishable from the rest of the list',
  )
})

test('a command is never rendered as markup', () => {
  // These are strings from a person's own shell history, which is the text in this app most
  // likely to contain something that wanted rendering.
  const { host, text } = draw(
    report({ decisions: [decision({ request: { ...decision().request, input: { command: '<img src=x onerror=alert(1)>' } } })] }),
  )
  assert.equal(all(host).some((n) => n.tag === 'img'), false, 'a command became an element')
  assert.match(text, /<img src=x/)
})

test('a window that does not show everything says how much it is not showing', () => {
  /*
   * The reader opens only the newest records, because `decided/` is unbounded and nothing prunes
   * it — so a panel that drew them and stopped would read as the whole record.
   *
   * A window that states its own edges is not a truncation. This is the sentence that makes that
   * true, and it is appended rather than substituted: the older count is a fact *about* the number
   * above it, and a reader given only one of the two learns the wrong thing from either.
   */
  const { text } = draw(report({ decisions: [decision()], beyond: 412 }))
  assert.match(text, /1 decision recorded/)
  assert.match(text, /412 older are not shown/)
})

test('one older reads as one older', () => {
  const { text } = draw(report({ decisions: [decision()], beyond: 1 }))
  assert.match(text, /1 older is not shown/)
})

test('the edge is said even when nothing in the window could be read', () => {
  // The case a single `if` would drop: no readable decisions, some unreadable, and a window edge.
  // All three are separate facts and the panel owes the reader every one of them.
  const { text } = draw(report({ unread: [{ id: 'a', cause: 'EACCES' }], beyond: 9 }))
  assert.match(text, /Nothing readable recorded/)
  assert.match(text, /could not be read/)
  assert.match(text, /9 older are not shown/)
})
