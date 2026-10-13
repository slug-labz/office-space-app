/**
 * What the panel draws for an employee somebody else maintains.
 *
 * `an-employee-somebody-else-maintains.test.ts` pins the decisions and
 * `hiring-from-a-colleagues-repo.test.ts` runs them against real files. This is the surface, and
 * it has one thing to get right that neither of those can check: **the row with no button.**
 *
 * When both copies have changed, taking theirs would destroy work done here. There is no control
 * for that, deliberately — but an empty space where a control might be is a bad surface, so the
 * space holds the reason instead. A test that only counted buttons would pass on a row that says
 * nothing at all, which is the version of this that looks finished and is not.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { kindFrom, renderMaintained, renderOffered, renderRefusal } from '../src/renderer/views/maintained.js'
import type { MaintainedRow, OfferedFromSource } from '../src/shared/ipc.js'
import type { Standing } from '../src/shared/hired-from.js'

installDom()

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

function row(id: string, standing: Standing, detail: string | null = null): MaintainedRow {
  return {
    id,
    source: { kind: 'git', at: 'https://github.com/company/agents.git', file: `agents/${id}.md` },
    hiredAt: '2026-03-04',
    standing,
    detail,
  }
}

function drawn(rows: readonly MaintainedRow[]): { host: El; text: string; buttons: El[] } {
  const host = document.createElement('div') as unknown as El
  const took: string[] = []
  renderMaintained(host as unknown as HTMLElement, rows, (id) => took.push(id))
  const nodes = all(host)
  return {
    host,
    text: nodes.map((n) => n.textContent ?? '').join(' '),
    // `tag`, lowercase. Reading `tagName` gets `undefined`, every filter finds nothing, and a
    // panel full of controls reads as one that drew none — the shape `dom.ts` warns about in its
    // own header: a missing property does not fail, it answers wrongly.
    buttons: nodes.filter((n) => n.tag === 'button'),
  }
}

test('a new version at the source is offered as a button', () => {
  const { text, buttons } = drawn([row('wren-review', { here: 'as-hired', there: 'moved-on' })])
  assert.equal(buttons.length, 1)
  assert.match(buttons[0]!.textContent ?? '', /Take their version/)
  assert.match(text, /changed theirs/)
})

/*
 * The row this file exists for.
 *
 * No button, and the space it would have occupied says why and what to do instead. Both halves
 * are asserted: a row that silently omitted the control would satisfy the first assertion alone.
 */
test('when both copies have changed there is no button, and the space holds the reason', () => {
  const { text, buttons } = drawn([row('wren-review', { here: 'edited', there: 'moved-on' })])
  assert.equal(buttons.length, 0, 'no one-click update')
  assert.match(text, /changed theirs/, 'their change is stated')
  assert.match(text, /edited here/i, 'and ours')
  assert.match(text, /no one-click update/i, 'the absence is explained rather than left blank')
  assert.match(text, /\.claude\/agents\/wren-review\.md/, 'and both files are named, so it can be done by hand')
  assert.match(text, /agents\/wren-review\.md/)
})

test('the four other answers each get their own sentence, and none of them gets a button', () => {
  const cases: readonly [string, Standing][] = [
    ['level', { here: 'as-hired', there: 'as-hired' }],
    ['ours', { here: 'edited', there: 'as-hired' }],
    ['unchecked', { here: 'as-hired', there: 'unchecked' }],
    ['unreachable', { here: 'as-hired', there: 'unreachable' }],
    ['withdrawn', { here: 'as-hired', there: 'withdrawn' }],
  ]
  const sentences = new Set<string>()
  for (const [name, standing] of cases) {
    const { text, buttons } = drawn([row('wren-review', standing)])
    assert.equal(buttons.length, 0, `${name} is not an update`)
    sentences.add(text)
  }
  assert.equal(sentences.size, cases.length, 'five states, five different rows')
})

/* Wifi being off must not be drawn like a colleague retiring their agent. */
test('unreachable and withdrawn are told apart by their tone as well as their words', () => {
  const toneOf = (standing: Standing): string => {
    const { host } = drawn([row('wren-review', standing)])
    return all(host)
      .map((n) => n.className ?? '')
      .filter((c) => c.includes('maintained__standing--'))
      .join(' ')
  }
  assert.notEqual(
    toneOf({ here: 'as-hired', there: 'unreachable' }),
    toneOf({ here: 'as-hired', there: 'withdrawn' }),
  )
})

test('the git message behind a failure is shown, not summarised away', () => {
  const { text } = drawn([
    row('dana-security', { here: 'as-hired', there: 'unreachable' }, 'Permission denied (publickey).'),
  ])
  assert.match(text, /Permission denied \(publickey\)/, 'which is what sends somebody to their ssh agent')
})

test('an office where nobody is maintained elsewhere says so, and says what to do', () => {
  const { text } = drawn([])
  assert.match(text, /Nobody here is maintained elsewhere/)
  assert.match(text, /repository of agents/, 'and the next step is in the same breath')
})

test('a source that would not open is a problem, not a source with nobody in it', () => {
  const host = document.createElement('div') as unknown as El
  renderOffered(host as unknown as HTMLElement, { problem: 'repository not found' }, () => {})
  const text = all(host)
    .map((n) => n.textContent ?? '')
    .join(' ')
  assert.match(text, /could not be read/)
  assert.match(text, /repository not found/)
  assert.doesNotMatch(text, /no agent files/, 'never the sentence for an empty source')
})

test('a source that opened with nothing in it says that instead, and where it looked', () => {
  const host = document.createElement('div') as unknown as El
  renderOffered(host as unknown as HTMLElement, { offered: [] }, () => {})
  const text = all(host)
    .map((n) => n.textContent ?? '')
    .join(' ')
  assert.match(text, /no agent files/)
  assert.match(text, /\.claude\/agents\//, 'and the places it looked, so the answer can be acted on')
})

/* A name already taken is said before the click, not discovered by being refused after it. */
test('somebody whose name is already taken is offered without a button', () => {
  const offered: OfferedFromSource = {
    offered: [
      { file: 'agents/wren-review.md', id: 'wren-review', description: 'Reviews PRs.', taken: true },
      { file: 'agents/dana-security.md', id: 'dana-security', description: 'Finds the mistakes.', taken: false },
    ],
  }
  const host = document.createElement('div') as unknown as El
  const hired: string[] = []
  renderOffered(host as unknown as HTMLElement, offered, (id) => hired.push(id))
  const nodes = all(host)
  const buttons = nodes.filter((n) => n.tag === 'button')
  assert.equal(buttons.length, 1, 'one of the two')
  assert.match(buttons[0]!.textContent ?? '', /Hire dana-security/)

  const text = nodes.map((n) => n.textContent ?? '').join(' ')
  assert.match(text, /already has somebody called wren-review/)
  assert.match(text, /Rename one of them first/)
})

test('nothing is drawn before a source has been looked at', () => {
  const host = document.createElement('div') as unknown as El
  renderOffered(host as unknown as HTMLElement, null, () => {})
  assert.equal(host.children.length, 0, 'an empty panel, not an empty list of colleagues')
})

/*
 * Found by looking at the running app.
 *
 * After hiring `wren-review`, the panel held two lists of identically-shaped cards and
 * `wren-review` was the first name in both — once as somebody the source offers, once as
 * somebody who works here — with nothing between them saying which was which. Both lists now
 * name themselves.
 */
test('both lists say what they are, because the same name appears in both', () => {
  const offers = document.createElement('div') as unknown as El
  renderOffered(offers as unknown as HTMLElement, {
    offered: [{ file: 'agents/wren-review.md', id: 'wren-review', description: '', taken: true }],
  }, () => {})

  const { host } = drawn([row('wren-review', { here: 'as-hired', there: 'as-hired' })])

  const headingIn = (n: El): string[] =>
    all(n)
      .filter((e) => (e.className ?? '').includes('maintained__group'))
      .map((e) => e.textContent ?? '')

  assert.deepEqual(headingIn(offers), ['What that source is offering'])
  assert.deepEqual(headingIn(host), ['Working here, kept elsewhere'])
})

/*
 * Found by pressing every button in every panel.
 *
 * "Look" with an empty box did nothing and said nothing: the handler was `if (!at) return`. The
 * connect form two panels over already got this right, and the sentence for this one was written
 * and tested — `whyNotASource('')` says *"Give a repository URL or a directory on this machine."*
 *
 * The first fix routed it through `renderOffered`, which frames every problem as *"That source
 * could not be read — …"*. That preamble is right for a git error and contradicts this one: there
 * is no source, so nothing failed to be read.
 */
test('a refusal about what was typed does not claim a source could not be read', () => {
  const host = document.createElement('div') as unknown as El
  renderRefusal(host as unknown as HTMLElement, 'Give a repository URL or a directory on this machine.')
  const text = all(host)
    .map((n) => n.textContent ?? '')
    .join(' ')
  assert.match(text, /Give a repository URL/)
  assert.doesNotMatch(text, /could not be read/, 'nothing was read, so nothing failed to be')
})

/*
 * Which transport a source is read as.
 *
 * Untested until a coverage report pointed at it, and it is not a formality: read a local
 * directory as `git` and the office tries to clone a path, read a remote as `directory` and it
 * tries to `readdir` a URL. Both fail, and neither failure names the real cause — a person would
 * see "could not be read" about a source that is sitting right there.
 *
 * Anything unexpected is a repository, because that is the field's common case and the one a
 * stale `<select>` value is most likely to have meant.
 */
test('a source is read as a directory only when it says so', () => {
  assert.equal(kindFrom('directory'), 'directory')
  assert.equal(kindFrom('git'), 'git')
  assert.equal(kindFrom(''), 'git', 'an empty select value is not a directory')
  assert.equal(kindFrom('Directory'), 'git', 'the value is the option value, not a label')
  assert.equal(kindFrom('folder'), 'git')
})
