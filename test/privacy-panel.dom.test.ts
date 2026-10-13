/**
 * The panel whose answers nobody can check, rendered.
 *
 * `views/privacy.ts` was on the parked list, and it is the one whose failure would be
 * **invisible**. Every other view fails visibly — a button does nothing, a list looks wrong. This
 * one states facts about somebody's disk and about what leaves their machine, and there is no
 * second source to check it against. A wrong number here is a lie told confidently to the one
 * person who came looking for the truth.
 *
 * Both sides of it were changed recently and neither change had a rendering test: the
 * measurement now counts a symlink as the link rather than its target, and the egress row now
 * carries the CDN a request is redirected to. What the panel does with those numbers was
 * untested.
 *
 * ## What is pinned
 *
 * 1. **Only `yours` stores offer Delete.** A `template` store is the shipped scaffold; a Delete
 *    on it is a button that breaks the app.
 * 2. **Delete is two-click armed, and a precious store's armed label states the amount.** That
 *    sentence is the last thing somebody reads before destroying something, so it must carry the
 *    real number rather than a plausible one.
 * 3. **The panel prints what `sizeLine` says**, including the answers that are not a size —
 *    `could not be read`, `never created`, `empty`, and `at least N`. Rendering a short count as
 *    a complete one is the failure the `unreadable` field exists to prevent, and it would be
 *    undetectable from the screen.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderPrivacy, type PrivacyHandlers } from '../src/renderer/views/privacy.js'
import { humanBytes, sizeLine } from '../src/shared/privacy-view.js'
import { installDom, click, type El } from './dom.js'
import type { MeasuredStore, PrivacyReport } from '../src/main/privacy.js'
import type { SharingRow } from '../src/shared/ipc.js'

installDom()

const store = (over: Partial<MeasuredStore> = {}): MeasuredStore => ({
  path: 'memory',
  what: 'What the office remembers about you and your work.',
  kind: 'yours',
  precious: true,
  state: 'present',
  bytes: 8_400_000,
  files: 42,
  unreadable: 0,
  where: '/Users/somebody/office/memory',
  ...over,
})

const report = (stores: readonly MeasuredStore[]): PrivacyReport => ({
  root: '/Users/somebody/office',
  stores,
  egress: [],
  lastPrompt: null,
  unreadSources: [],
})

const quiet: PrivacyHandlers = { onForget: () => {} }
const host = (): El => document.createElement('div') as unknown as El

function all(node: El): El[] {
  return [node, ...node.children.flatMap((child) => all(child))]
}

function draw(
  stores: readonly MeasuredStore[],
  on: PrivacyHandlers = quiet,
  sharing: readonly SharingRow[] | null = null,
): El {
  const into = host()
  renderPrivacy(into as unknown as HTMLElement, report(stores), on, sharing)
  return into
}

const textOf = (node: El): string => all(node).map((n) => n.textContent).join('\n')
const deletes = (node: El): El[] => all(node).filter((n) => n.tag === 'button' && /^Delete/.test(n.textContent))

test('only what is yours can be deleted', () => {
  // A Delete on the shipped scaffold is a button that breaks the app. `kind` is the whole of
  // that rule and it is enforced in the renderer as well as in `forget`.
  const into = draw([store({ path: 'memory', kind: 'yours' }), store({ path: '.claude/skills', kind: 'template' })])

  assert.equal(deletes(into).length, 1, 'a template store was offered a Delete button')
  assert.match(textOf(into), /\.claude\/skills/, 'the template store is not shown at all')
})

test('a store that is not there offers nothing to delete', () => {
  // `absent` is a real answer, and a Delete on it would promise to remove something that was
  // never created.
  const into = draw([store({ state: 'absent', bytes: 0, files: 0 })])
  assert.deepEqual(deletes(into), [], 'an absent store was offered a Delete button')
  assert.match(textOf(into), /never created/)
})

test('Delete is armed, and the armed label states the real amount', () => {
  // The last sentence somebody reads before destroying something. It must carry the number the
  // panel measured, not a plausible one — so it is compared against the store, not a literal.
  const forgotten: string[] = []
  const into = draw([store({ bytes: 8_400_000, precious: true })], { onForget: (p) => forgotten.push(p) })
  const button = deletes(into)[0]!

  click(button)
  assert.deepEqual(forgotten, [], 'one click deleted a store')
  assert.match(button.textContent, /click again/, 'the button did not say it is armed')
  // Against `humanBytes`, not a literal. A literal here is a guess about a formatter, and the
  // first draft guessed `8.4 MB` for a value the panel renders as `8.0 MB` — these are MiB. The
  // claim worth pinning is that the button states *the amount the panel measured*, not that a
  // particular string appears.
  const amount = humanBytes(8_400_000)
  assert.ok(
    button.textContent.includes(amount),
    `the armed label does not state the measured amount (${amount}) — it reads ` +
      JSON.stringify(button.textContent),
  )

  click(button)
  assert.deepEqual(forgotten, ['memory'], 'the second click did not forget the right store')
})

test('looking away disarms Delete', () => {
  const forgotten: string[] = []
  const into = draw([store()], { onForget: (p) => forgotten.push(p) })
  const button = deletes(into)[0]!

  click(button)
  button.dispatchEvent({ type: 'blur', bubbles: false })
  assert.equal(button.textContent, 'Delete', 'the button stayed armed after focus left it')

  click(button)
  assert.deepEqual(forgotten, [], 'a click after looking away deleted a store')
})

test('the panel prints what sizeLine says, including the answers that are not a size', () => {
  // Four answers that are not numbers, and each is a claim the screen is making. `at least N` is
  // the one that matters most: a short count rendered as a complete one is exactly what the
  // `unreadable` field exists to prevent, and nothing on screen would show it.
  for (const measured of [
    store({ state: 'unreadable', bytes: 0, files: 0 }),
    store({ state: 'absent', bytes: 0, files: 0 }),
    store({ state: 'present', bytes: 0, files: 0, unreadable: 0 }),
    store({ state: 'present', bytes: 9_100, files: 2, unreadable: 1 }),
    store({ state: 'present', bytes: 0, files: 0, unreadable: 2 }),
  ]) {
    const shown = textOf(draw([measured]))
    const expected = sizeLine(measured)
    assert.ok(
      shown.includes(expected),
      `the panel does not print ${JSON.stringify(expected)} for a store in state ${measured.state} ` +
        `with ${measured.unreadable} unreadable — it would show a short number as a whole one`,
    )
  }
})

test('a partly-read store says so on screen, in words', () => {
  // The rendered form of the fix, rather than the function's return value — `sizeLine` has its
  // own tests and they would keep passing if the panel dropped the string on the floor.
  const shown = textOf(draw([store({ bytes: 9_100, files: 2, unreadable: 1 })]))
  assert.match(shown, /at least/, 'the panel presented a short total as a complete one')
  assert.match(shown, /1 folder inside could not be read/, 'the panel does not say how much it could not see')
})

/*
 * VISION.md §7: *"Memory and personal data are never pushed."* The panel that answers *what leaves
 * this machine* now also answers *what a push would carry*, and the two are different questions —
 * one goes to a service, the other to everyone who clones the office.
 */
test('a workspace whose memory git would push says so, above everything else', () => {
  const into = draw([], quiet, [
    { path: 'memory', what: 'What the office remembers.', side: 'yours', verdict: 'leaking', detail: null },
    { path: '.claude/agents', what: 'The employees.', side: 'shipped', verdict: 'shared', detail: null },
  ])
  const text = into.textContent ?? ''
  assert.match(text, /One thing meant to stay on this machine would be included in a push/)
  assert.match(text, /a push would publish it/)
  assert.match(text, /What the office remembers/, 'and what it is, so the sentence can be acted on')
})

test('git failing to answer is not an office with nothing to push', () => {
  const text = draw([], quiet, null).textContent ?? ''
  assert.match(text, /Git could not be asked/)
  assert.doesNotMatch(text, /stays yours/, 'never the sentence for a clean answer')
})
