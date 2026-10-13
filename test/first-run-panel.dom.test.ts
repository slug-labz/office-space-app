/**
 * The first screen a stranger sees, and the two promises it makes.
 *
 * `first-run.test.ts` covers the diagnosis — which steps exist and when. This is the panel that
 * draws them, and its own header states the constraint the whole screen is built around:
 *
 *     A command is shown as text with a copy button rather than run. Office Space installs
 *     nothing and touches nobody's PATH — the whole architecture is that it spawns a binary the
 *     user already chose to have, and an onboarding screen that starts running `npm install -g`
 *     on their machine would be a different product with a different threat model.
 *
 * That is not a styling note. It is the line between an app that reads your workspace and one
 * that modifies your machine before you have agreed to anything, and the only thing holding it
 * is that nobody adds a Run button to the row that already has the command sitting in it.
 *
 * ## And "nothing needs attention" is a claim, not a blank
 *
 *     Zero steps used to render as one bare "Look again" button under a heading — a panel that
 *     looks like it failed to load. It is the opposite: every condition this screen knows how to
 *     check came back fine. Say which, because "nothing needs attention" and "nothing was
 *     checked" look identical on screen and are not the same claim.
 *
 * Standing order 4, on the one screen whose entire job is telling somebody who has just arrived
 * what is true about their workspace.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { renderFirstRun, type FirstRunHandlers } from '../src/renderer/views/first-run.js'
import type { Step } from '../src/shared/first-run.js'

installDom()

const clipboard = (): { refuse: boolean } =>
  (globalThis as unknown as { navigator: { clipboard: { refuse: boolean } } }).navigator.clipboard
const writes = (): string[] => (globalThis as unknown as Record<string, string[]>)['__clipboardWrites']!

const step = (over: Partial<Step> = {}): Step =>
  ({
    id: 'claude-missing',
    title: 'The claude command was not found',
    detail: 'Office Space spawns the claude you already have.',
    severity: 'blocked',
    command: 'npm install -g @anthropic-ai/claude-code',
    action: null,
    ...over,
  }) as Step

interface Panel {
  readonly host: El
  readonly text: () => string
  readonly buttons: () => El[]
  readonly press: (label: RegExp) => El | undefined
  readonly actions: string[]
  readonly rechecks: number[]
}

function panel(steps: readonly Step[]): Panel {
  const host = document.createElement('div')
  const actions: string[] = []
  const rechecks: number[] = []
  const on: FirstRunHandlers = {
    onAction: (id) => actions.push(id),
    onRecheck: () => rechecks.push(1),
  }
  renderFirstRun(host, steps, on)

  const walk = (n: El): El[] => [n, ...n.children.flatMap(walk)]
  const buttons = (): El[] => walk(host as unknown as El).filter((n) => n.tag === 'button')
  return {
    host: host as unknown as El,
    actions,
    rechecks,
    buttons,
    text: () => ((host as unknown as El).textContent ?? '').replace(/\s+/g, ' '),
    press: (label) => {
      const button = buttons().find((b) => label.test((b.textContent ?? '').trim()))
      button?.dispatchEvent({ type: 'click', bubbles: true })
      return button
    },
  }
}

test('a workspace with nothing wrong says so, and says what it checked', () => {
  const p = panel([])
  assert.match(
    p.text(),
    /Nothing needs attention/i,
    'an all-clear renders as a bare "Look again" button, which reads as a panel that failed to load',
  )
  assert.match(
    p.text(),
    /claude command/i,
    '"nothing needs attention" does not say what was checked, so it is indistinguishable from ' +
      '"nothing was checked" — on the one screen whose job is telling a stranger what is true',
  )
})

test('the office never offers to run the command on somebody’s machine', () => {
  // The architectural line. The command is right there in the row; adding a button that runs it
  // is a one-line change and a different product.
  const p = panel([step()])

  assert.match(p.text(), /npm install -g/, 'the command is not shown at all, so there is nothing to copy')
  const runners = p
    .buttons()
    .map((b) => (b.textContent ?? '').trim())
    .filter((label) => /^(run|install|fix|do it)\b/i.test(label))

  assert.deepEqual(
    runners,
    [],
    `the first-run screen offers to execute something: ${JSON.stringify(runners)}. Office Space ` +
      `installs nothing and touches nobody's PATH — it spawns a binary the user already chose ` +
      `to have, and a screen that runs "npm install -g" has a different threat model.`,
  )
})

test('copy puts the command on the clipboard and says it did', async () => {
  clipboard().refuse = false
  writes().length = 0
  const p = panel([step()])

  const button = p.press(/^Copy$/)
  assert.ok(button, 'no copy button next to a command that has to be retyped by hand without one')
  await new Promise((resolve) => setTimeout(resolve, 5))

  assert.deepEqual(writes(), ['npm install -g @anthropic-ai/claude-code'], 'the press copied nothing')
  assert.equal(button.textContent, 'Copied', 'the press changed nothing on screen, so it reads as a button that did not work')
})

test('a clipboard that refuses is answered, not swallowed', async () => {
  // Permission refused, or the window not focused. A press that silently does nothing is the
  // worst of the three outcomes: the command is not copied and the person believes it is.
  clipboard().refuse = true
  writes().length = 0
  const p = panel([step()])

  const button = p.press(/^Copy$/)
  assert.ok(button)
  await new Promise((resolve) => setTimeout(resolve, 5))

  assert.deepEqual(writes(), [], 'the refusal was recorded as a successful copy')
  assert.equal(
    button.textContent,
    'Select it instead',
    `the button reads ${JSON.stringify(button.textContent)} after a refused clipboard write. The ` +
      `text is right there to select by hand, but only if the screen says so.`,
  )
  clipboard().refuse = false
})

test('“Look again” is always there, because the usual reason a step is up is one just fixed', () => {
  for (const steps of [[], [step()]]) {
    const p = panel(steps)
    p.press(/Look again/)
    assert.equal(p.rechecks.length, 1, `no working "Look again" with ${steps.length} step(s) on screen`)
  }
})

test('a step with an action offers it, and hands back the id the palette knows', () => {
  const p = panel([step({ action: 'hire', command: null })])
  p.buttons().find((b) => (b.textContent ?? '').trim() !== 'Look again')?.dispatchEvent({ type: 'click', bubbles: true })
  assert.deepEqual(p.actions, ['hire'], 'the action button reached nothing, or carried the wrong id')
})
