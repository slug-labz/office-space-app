/**
 * The record drawer, which displays output this app does not control.
 *
 * Every string in here came out of a tool: a path, a shell command, a result, an error message.
 * The office runs those tools with the user's own credentials, so their output is the most
 * untrusted text in the product — and it is rendered into a window that can start processes.
 * `record.ts` says the rule in one line and does not elaborate:
 *
 *     Everything here came from a tool. `textContent`, always.
 *
 * Nothing was aimed at the module. So this asserts the rule twice: once by rendering a step
 * whose argument is markup and checking it comes back as *text*, and once by scanning the source
 * for the four ways to stop it being text. The second is the one that catches a change; the
 * first is the one that proves the second is checking something real.
 *
 * ## And the two halves of the feature
 *
 * The drawer exists because tool calls were taken out of the transcript — *"the conversation
 * reads as a conversation because the mechanism is not in it; the mechanism is still there
 * because this exists and one click reaches it. Remove either half and the feature is either
 * clutter or a lie."*
 *
 * So a drawer that opens empty, or opens without a way back out, is not a smaller version of
 * this feature — it is the lie. Both are checked.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { installDom, type El } from './dom.js'
import { mountRecord } from '../src/renderer/views/record.js'
import { Ledger } from '../src/renderer/views/steps.js'

installDom()

/** A turn that ran three tools: one fine, one broken, one nobody ever heard back about. */
function ledger(): Ledger {
  const l = new Ledger()
  l.add('a', 'Bash', 'npm test')
  l.settle('a', 'ok', '1532 passing')
  l.add('b', 'Edit', 'src/main/main.ts')
  l.settle('b', 'failed', 'no such file')
  l.add('c', 'Read', 'notes.md')
  return l
}

function rig(): { host: El; open: (l?: Ledger) => void; close: () => void; text: () => string; all: () => El[] } {
  const host = document.createElement('div')
  const record = mountRecord(host)
  const walk = (n: El): El[] => [n, ...n.children.flatMap(walk)]
  return {
    host: host as unknown as El,
    open: (l = ledger()) => record.open(l),
    close: () => record.close(),
    all: () => walk(host as unknown as El),
    text: () =>
      walk(host as unknown as El)
        .map((n) => n.textContent ?? '')
        .join(' '),
  }
}

test('a turn opens with every step it took', () => {
  const r = rig()
  assert.equal(r.all().length, 1, 'the drawer drew something before it was opened')

  r.open()
  const text = r.text()

  // The control: an empty drawer would satisfy any "nothing wrong is shown" assertion.
  assert.match(text, /3 steps/, `the header did not count the steps: ${JSON.stringify(text.slice(0, 80))}`)
  for (const shown of ['Bash', 'npm test', 'Edit', 'src/main/main.ts', 'Read', 'notes.md']) {
    assert.ok(text.includes(shown), `the record does not mention ${JSON.stringify(shown)} — the mechanism is missing from the place that exists to hold it`)
  }
})

test('one step is counted as one step, not "1 steps"', () => {
  const r = rig()
  const one = new Ledger()
  one.add('a', 'Bash', 'npm test')
  r.open(one)
  assert.match(r.text(), /1 step\b/)
  assert.doesNotMatch(r.text(), /1 steps/)
})

test('a tool argument that looks like markup arrives as text', () => {
  // The rule, exercised. This string is what a tool could plausibly emit — a grep result, a file
  // path in a repository that contains HTML, an error quoting a template.
  const nasty = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
  const l = new Ledger()
  l.add('a', 'Bash', nasty)
  l.settle('a', 'failed', `also ${nasty}`)

  const r = rig()
  r.open(l)

  // It is present, as characters.
  assert.ok(r.text().includes(nasty), 'the argument was not rendered at all, so this proves nothing about how it was rendered')

  // And no element was built from it. If any of that string had been parsed, there would be an
  // `img` or a `script` in the tree; `textContent` cannot produce either.
  const tags = r.all().map((n) => n.tag)
  assert.equal(tags.includes('img'), false, 'a tool argument was parsed as markup — an <img> exists that no code in this module creates')
  assert.equal(tags.includes('script'), false, 'a tool argument was parsed as markup — a <script> exists that no code in this module creates')
})

test('no source in the record path can turn a tool string into markup', () => {
  // The scan that catches the change. The behavioural test above cannot: `innerHTML` on a string
  // with no tags renders identically, so a module could switch to it and every rendering
  // assertion would still pass until the day a tool emitted a bracket.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')

  const offenders: string[] = []
  for (const file of ['src/renderer/views/record.ts', 'src/renderer/views/steps.ts']) {
    const source = readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [index, line] of source.split('\n').entries()) {
      if (line.trimStart().startsWith('//')) continue
      if (/\b(innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write\b/.test(line)) {
        offenders.push(`${file}:${index + 1}  ${line.trim()}`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'these turn a string into markup, and every string on this surface came out of a tool the ' +
      `office ran with the user's own credentials:\n  ${offenders.join('\n  ')}`,
  )
})

test('the drawer opens with a way out, and closing removes it', () => {
  const r = rig()
  r.open()

  const buttons = r.all().filter((n) => n.tag === 'button')
  assert.ok(buttons.length > 0, 'the drawer has no close button, so a pointer has no way back out')
  const shut = buttons.find((b) => (b.textContent || '').includes('close'))
  assert.ok(shut, `no button says close — found ${JSON.stringify(buttons.map((b) => b.textContent))}`)
  assert.equal(shut.focused, true, 'focus was not moved to the drawer, so a keyboard user is left on a mark now behind it')

  shut.dispatchEvent({ type: 'click', bubbles: true })
  assert.equal(r.all().length, 1, 'closing left the drawer in the tree')
})

test('opening twice replaces rather than stacks', () => {
  const r = rig()
  r.open()
  const afterFirst = r.all().length
  r.open()
  assert.equal(r.all().length, afterFirst, 'a second open added a second drawer on top of the first')
})

/**
 * ## The four state words, and why there are four
 *
 *     The state word is the honest part, and there are four of them because any fewer forces one
 *     to be a lie. `running` means the result has not come back yet. `unknown` means it never
 *     will -- the office closed mid-step and a saved transcript cannot gain a result afterwards.
 *     Neither is a synonym for `failed`, which is reserved for a tool that actually said no.
 *
 * This is the same distinction `chat-view.ts` draws when it replays a saved conversation, and
 * the same one `steps.ts` records having got wrong once: folding `unknown` into `failed` turns
 * every conversation that was closed mid-command red for work that may well have succeeded.
 * The drawer is where somebody goes to find out what actually happened, so it is the last place
 * that should guess.
 *
 * ## And the way in and out, for somebody not using a mouse
 *
 *     Focus goes to the close button so Escape and Tab both behave, and so a keyboard user is
 *     not left with focus on a mark that is now behind a drawer.
 */

const stateWords = (r: ReturnType<typeof rig>): string[] =>
  r.all().filter((n) => n.classList.contains('step__state')).map((n) => (n.textContent ?? '').trim())

const stateAttrs = (r: ReturnType<typeof rig>): (string | undefined)[] =>
  r.all().filter((n) => n.classList.contains('step__state')).map((n) => n.dataset['state'])

test('the four outcomes are four different words', () => {
  const l = new Ledger()
  l.add('a', 'Bash', 'npm test')
  l.settle('a', 'ok', 'passing')
  l.add('b', 'Edit', 'main.ts')
  l.settle('b', 'failed', 'no such file')
  l.add('c', 'Read', 'notes.md')
  l.settle('c', 'unknown', 'still running when the office was closed')
  l.add('d', 'Grep', 'pattern')

  const r = rig()
  r.open(l)

  const words = stateWords(r)
  assert.equal(words.length, 4, 'expected four steps on screen, found ' + words.length)
  assert.equal(
    new Set(words).size,
    4,
    'the four outcomes render as ' + JSON.stringify(words) + '. Any two sharing a word makes one ' +
      'of them a lie, and the drawer is where somebody goes precisely because they want to know ' +
      'which of the four it was.',
  )
})

test('a step nobody heard back about is not called a failure', () => {
  // The distinction that cost something to learn, on the surface built to answer "what happened".
  const l = new Ledger()
  l.add('a', 'Bash', 'npm test')
  l.settle('a', 'unknown', 'still running when the office was closed')

  const r = rig()
  r.open(l)

  assert.equal(stateWords(r)[0] === 'failed', false, 'an unknown outcome is written as a failure')
  assert.equal(stateAttrs(r)[0], 'unknown', 'the state attribute the stylesheet colours by says something else')
})

test('a step still in flight is marked open rather than settled', () => {
  const l = new Ledger()
  l.add('a', 'Bash', 'npm test')

  const r = rig()
  r.open(l)
  assert.equal(stateAttrs(r)[0], 'open', 'a step with no result yet is drawn as though it had one')
})

test('the drawer takes focus, and Escape gives it back', () => {
  // "So a keyboard user is not left with focus on a mark that is now behind a drawer."
  const r = rig()
  r.open()

  const shut = r.all().find((n) => n.tag === 'button')
  assert.ok(shut, 'the drawer has no close button')
  assert.equal(
    shut.focused,
    true,
    'the drawer opened without taking focus, so a keyboard user is still on the mark behind it ' +
      'and Tab walks the page underneath',
  )

  const panel = r.all().find((n) => n.classList.contains('record'))
  assert.ok(panel, 'no drawer element to press Escape on')
  panel.dispatchEvent({ type: 'keydown', bubbles: true, key: 'Escape' })

  assert.equal(
    r.all().some((n) => n.classList.contains('record')),
    false,
    'Escape left the drawer open',
  )
})
