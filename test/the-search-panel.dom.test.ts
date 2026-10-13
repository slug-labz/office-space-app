/**
 * Drawing search results, and the ordering that is the whole of this view's job.
 *
 * The decision layer is tested against strings and the reads against a real filesystem. What only
 * a rendering test can check is **where the blind-spot sentence sits** — and that is not
 * cosmetic. A reader who meets "nothing found" first has already concluded the thing was never
 * written down by the time they reach a caveat underneath it.
 *
 * The changed panel made exactly this mistake with "put back on <date>", and it was found by
 * opening the panel and reading it in the order a person does rather than by a test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderSearch } from '../src/renderer/views/search.js'
import { installDom, type El } from './dom.js'
import type { Hit, Searched } from '../src/shared/search.js'

installDom()

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

/**
 * A hit, with `at` derived from the text rather than written down.
 *
 * Hand-counted offsets are wrong on the first try often enough that a fixture carrying them tests
 * the arithmetic in the fixture. `matchesIn` produces these in real use; here the needle is stated
 * and the offsets follow from it.
 */
const hit = (over: Partial<Hit> & { needle?: string } = {}): Hit => {
  const { needle = 'retry', ...rest } = over
  const text = rest.text ?? 'We chose retry-with-backoff.'
  const start = text.indexOf(needle)
  if (start === -1) throw new Error(`fixture: "${needle}" is not in "${text}"`)
  return {
    source: 'memory',
    where: 'memory/why-backoff.md',
    goto: { kind: 'memory', id: 'why-backoff' },
    line: 5,
    ...rest,
    text,
    at: { start, end: start + needle.length },
  }
}

const found = (over: Partial<Searched> = {}): Searched => ({
  hits: [],
  looked: ['memory', 'project', 'conversation', 'dispatch'],
  blind: [],
  ...over,
})

function draw(
  searched: Searched | null,
  query = 'retry',
  onOpen: (h: Hit) => void = () => {},
): { host: El; text: string } {
  const node = document.createElement('div')
  renderSearch(node as unknown as HTMLElement, searched, query, { onOpen })
  const host = node as unknown as El
  return { host, text: (host.textContent ?? '').replace(/\s+/g, ' ').trim() }
}

test('what was not searched is shown ABOVE the count, not below it', () => {
  /*
   * The one thing this file exists to check. Both sentences being present is not enough — the
   * order is what decides whether the caveat is read before the conclusion or after it.
   */
  const { text } = draw(found({ blind: [{ source: 'memory', extent: 'none', why: 'permission denied' }] }))
  assert.match(text, /did not search memory/)
  assert.ok(
    text.indexOf('did not search memory') < text.indexOf('Nothing found'),
    'the blind-spot sentence is drawn after the result, where it arrives too late to change the reading',
  )
})

test('nothing asked yet is not the same as nothing found', () => {
  // An empty panel reporting "no results" is answering a question nobody has put.
  const { text } = draw(null, '')
  assert.match(text, /Search this workspace/)
  assert.doesNotMatch(text, /Nothing/)
})

test('a hit says which part of the workspace it came from', () => {
  // "Which part of my work is this in" is the first question, before the line itself.
  const { text } = draw(found({ hits: [hit()] }))
  assert.match(text, /memory/)
  assert.match(text, /memory\/why-backoff\.md/)
})

test('the match itself is marked, and marked in the right place', () => {
  const { host } = draw(found({ hits: [hit()] }))
  const mark = all(host).find((n) => n.tag === 'mark')
  assert.ok(mark, 'the match was not marked at all')
  assert.equal(mark.textContent, 'retry', 'the mark covers the wrong characters')
})

test('result text is never rendered as markup', () => {
  /*
   * This draws text out of a person's own transcripts and project files — the string in this app
   * most likely to contain markup that something wanted rendered.
   */
  const { host, text } = draw(found({ hits: [hit({ text: '<img src=x onerror=alert(1)> retry' })] }))
  assert.equal(all(host).some((n) => n.tag === 'img'), false, 'markup in a result became an element')
  assert.match(text, /<img src=x/)
})

test('a dispatch has no line number, and none is invented for it', () => {
  // A ledger row has no lines. A number here would be a lie about a record that has none.
  const { host } = draw(found({ hits: [hit({ source: 'dispatch', where: 'builder', line: null })] }))
  assert.equal(all(host).some((n) => n.className.includes('find__line')), false)
})

test('choosing a result reports which one', () => {
  const chosen: Hit[] = []
  const { host } = draw(found({ hits: [hit()] }), 'retry', (h) => chosen.push(h))
  const row = all(host).find((n) => n.tag === 'button')
  assert.ok(row, 'a result is not selectable at all')
  row.click()
  assert.equal(chosen[0]?.where, 'memory/why-backoff.md')
})

test('hits in one file are drawn under one heading, not repeated per line', () => {
  const { text } = draw(
    found({ hits: [hit({ line: 5 }), hit({ line: 9 }), hit({ where: 'other.md', line: 2 })] }),
  )
  assert.equal((text.match(/why-backoff\.md/g) ?? []).length, 1, 'the same file was given two headings')
  assert.match(text, /2 matches/)
})

test('a row says whether it will take you there or only tell you where', () => {
  /*
   * Both rows do something, so neither is the control that could only refuse. But they do
   * different things, and somebody who clicks expecting to arrive somewhere and instead gets a
   * clipboard notification has been told the office lost their dispatch.
   */
  const { text } = draw(
    found({ hits: [hit(), hit({ source: 'dispatch', where: 'builder', line: null, goto: null })] }),
  )
  assert.match(text, /open/, 'a hit with somewhere to go does not say so')
  assert.match(text, /copy/, 'a hit with nowhere to go is drawn as though it had')
})

test('the label follows the destination, not the source', () => {
  /*
   * The trap this is pinned against: labelling from `source` would work today and quietly become
   * a lie the moment a source gains or loses a destination — the row would read "open" while
   * behaving like "copy".
   */
  const { text } = draw(found({ hits: [hit({ source: 'memory', goto: null })] }))
  assert.match(text, /copy/, 'a memory hit with no destination was still labelled by its source')
  assert.doesNotMatch(text, /open/)
})
