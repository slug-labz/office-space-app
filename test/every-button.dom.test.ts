/**
 * Every button in every view the harness can reach, and whether pressing it reaches anything.
 *
 * `no-dead-controls.dom.test.ts` asks this of five surfaces. This asks it of the rest — the
 * settings panel, the task list, the first-run steps — because the report that prompted it was
 * *"all the buttons that you made when we click on settings or tasks, none of those buttons are
 * actually working"*, and the honest answer to that is a measurement rather than a reading.
 *
 * The two files are deliberately separate: the other one covers surfaces that were already
 * tested and stays small; this one is where a view goes when it comes off the parked list and
 * has nothing else aimed at it yet.
 *
 * ## What "working" means here, and what it does not
 *
 * A button is live if pressing it reaches a handler. That is one of three things that must be
 * true for a control to work, and it is the only one checkable without the app:
 *
 *   1. the press reaches a handler — **here**
 *   2. the handler does something — a behaviour test, per view
 *   3. what it does is visible — only running it shows that
 *
 * `+ new project` failed at (2) while passing (1), which is why this file says so rather than
 * claiming more than it checks.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { renderSettings, type SettingsHandlers } from '../src/renderer/views/settings.js'
import { renderTaskList, type TaskHandlers } from '../src/renderer/views/tasks.js'
import { renderFirstRun, type FirstRunHandlers } from '../src/renderer/views/first-run.js'
import type { TaskReport } from '../src/main/harness.js'

installDom()

const host = (): El => document.createElement('div') as unknown as El
const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

/**
 * Whether a person could press this at all, checked *before* asking whether pressing it lands.
 *
 * `.click()` fires on a `display: none` element. That is not a quibble — it is how this file's
 * own headline nearly stayed wrong: driving the `getting-started` pill in the running app
 * produced a true observation about a control with `display: none`, zero size and no text, and
 * the conclusion drawn from it named the wrong bug entirely. A sweep that reports "all live"
 * while some of them are unpressable is measuring the event system, not the app.
 *
 * `hidden` and an ancestor's `hidden` are what the shim can answer. It returns a zero-sized rect
 * for everything on purpose — geometry here would be true only of the invention — so **being
 * obscured, zero-sized, or `display: none` from a class cannot be checked in this harness**. The
 * five-point hit test that settles it needs a browser, and that is a receipt taken by hand rather
 * than a check that runs.
 */
function reachable(node: El): boolean {
  for (let at: El | null = node; at !== null; at = at.parent) if (at.hidden) return false
  return true
}

function buttons(tree: El): { label: string; live: boolean; reachable: boolean }[] {
  const submits = (node: El): boolean => {
    if (node.type !== 'submit') return false
    for (let at: El | null = node; at !== null; at = at.parent) if (at.listensFor('submit')) return true
    return false
  }
  return all(tree)
    .filter((n) => n.tag === 'button')
    .map((n) => ({
      label: n.textContent || '(no label)',
      live: n.listensFor('click') || submits(n),
      reachable: reachable(n),
    }))
}

/**
 * The precondition every check below shares: a control nobody can press is not a live control,
 * whatever is listening to it.
 *
 * A button that is deliberately hidden until some state arrives belongs behind that state in the
 * fixture, so the sweep sees it in the condition it is drawn in. One that is hidden here with no
 * way to reveal it is either dead markup or a control the panel forgot to show.
 */
function assertPressable(found: readonly { label: string; reachable: boolean }[], surface: string): void {
  const unreachable = found.filter((b) => !b.reachable).map((b) => `"${b.label}"`)
  assert.deepEqual(
    unreachable,
    [],
    `${surface}: these are in the tree and cannot be pressed — a click dispatches on them and ` +
      `reaches a handler, which says nothing about whether a person can get to them: ${unreachable.join(', ')}`,
  )
}

function settingsTree(): El {
  const into = host()
  const on: SettingsHandlers = {
    onChange: () => {},
    readAloud: () => false,
    setReadAloud: () => {},
    canReadAloud: true,
  }
  renderSettings(into as unknown as HTMLElement, on)
  return into
}

function tasksTree(): El {
  const into = host()
  const report: TaskReport = {
    project: 'a-project',
    unreadable: 0,
    unrecognised: [],
    problem: null,
    checks: [
      {
        task: { ref: '1', title: 'Build the thing', owner: 'builder', state: 'queued', condition: '`npm test` exits 0', command: 'npm test' },
        verdict: { state: 'allowed', rule: 'Bash(npm test:*)' },
        result: null,
      },
      {
        task: { ref: '2', title: 'The other thing', owner: 'tester', state: 'queued', condition: 'reviewed by eye', command: null },
        verdict: { state: 'unlisted' },
        result: null,
      },
    ],
  }
  renderTaskList(into as unknown as HTMLElement, report, { onRun: () => {} } as TaskHandlers)
  return into
}

function firstRunTree(): El {
  const into = host()
  const steps = [
    { id: 'claude', title: 'Install Claude', detail: 'It is how the office runs.', done: false, action: 'Check again' },
    { id: 'agents', title: 'Hire somebody', detail: 'The floor is a function of the roster.', done: true },
  ]
  renderFirstRun(into as unknown as HTMLElement, steps as never, { onAction: () => {}, onRecheck: () => {} } as FirstRunHandlers)
  return into
}

test('every button in the settings panel reaches a handler', () => {
  const tree = settingsTree()
  const found = buttons(tree)

  // The control: a settings panel that drew no buttons would pass a check for no dead ones.
  assert.ok(found.length >= 8, `only ${found.length} buttons in the settings panel — it did not render`)

  assertPressable(found, 'the settings panel')

  const dead = found.filter((b) => !b.live).map((b) => `"${b.label}"`)
  assert.deepEqual(dead, [], `settings buttons with nothing listening: ${dead.join(', ')}`)
})

test('every button in the task list reaches a handler', () => {
  const tree = tasksTree()
  const found = buttons(tree)
  assert.ok(found.length > 0, 'the task list drew no buttons at all — it did not render')

  assertPressable(found, 'the task list')

  const dead = found.filter((b) => !b.live).map((b) => `"${b.label}"`)
  assert.deepEqual(dead, [], `task list buttons with nothing listening: ${dead.join(', ')}`)
})

test('every button in the first-run steps reaches a handler', () => {
  const tree = firstRunTree()
  const found = buttons(tree)
  assert.ok(found.length > 0, 'the first-run panel drew no buttons — it did not render')

  assertPressable(found, 'the first-run steps')

  const dead = found.filter((b) => !b.live).map((b) => `"${b.label}"`)
  assert.deepEqual(dead, [], `first-run buttons with nothing listening: ${dead.join(', ')}`)
})

/**
 * A first-run panel with nothing to report must say so, not render a bare button.
 *
 * `getting-started` is a control in the chrome, and on a healthy workspace pressing it did
 * nothing whatsoever — no panel, no message, no feedback. `showFirstRun` returned early on an
 * empty diagnosis, which is right when the panel is deciding whether to appear on its own and
 * wrong when somebody has just pressed the thing that opens it. Measured in the running app
 * before the fix: click, and not one attribute on the page changed.
 *
 * That is the same report as the one this file was written for — "the buttons don't work" —
 * arriving through silence rather than through a missing listener. It is why the header of this
 * file distinguishes *reaches a handler* from *does something*: this button passed the first and
 * failed the second, and a check that only asks the first would have called it fine.
 *
 * With the early return gone, the remaining way to fail is to open a panel that renders as one
 * unexplained "Look again" button under a heading, which reads as a screen that failed to load.
 * "Nothing needs attention" and "nothing was checked" look identical when both are blank, and
 * they are not the same claim — the fourth standing order, on the one screen whose whole job is
 * telling a stranger what is true about their workspace.
 */
test('a first-run panel with no steps explains itself rather than rendering blank', () => {
  const into = host()
  renderFirstRun(into as unknown as HTMLElement, [] as never, {
    onAction: () => {},
    onRecheck: () => {},
  } as FirstRunHandlers)

  const text = all(into)
    .map((n) => n.textContent)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  const found = buttons(into)
  assert.deepEqual(
    found.map((b) => b.label),
    ['Look again'],
    'the empty first-run panel should offer exactly one control',
  )
  assert.ok(found[0]?.live, 'the "Look again" button on the empty panel reaches nothing')

  // The panel must carry a sentence, not just the button. Anything shorter than the button's own
  // label plus a clause is a panel that renders as blank to the person looking at it.
  const withoutButton = text.replace('Look again', '').trim()
  assert.ok(
    withoutButton.length > 40,
    `the empty first-run panel says nothing except its button — a stranger reads that as a screen ` +
      `that failed to load rather than as "everything is fine". Rendered: ${JSON.stringify(text)}`,
  )
  assert.match(
    withoutButton,
    /nothing needs attention/i,
    `the empty panel must state that nothing is wrong, in words. Rendered: ${JSON.stringify(withoutButton)}`,
  )
})

/**
 * The reachability precondition's own test — both branches, because only one of them is easy.
 *
 * A button with `hidden` set on itself is the obvious case. A button that is perfectly visible
 * *itself* but sits inside a hidden row is the one that actually happens, and it is the one a
 * naive check misses: `node.hidden` is false, the listener is attached, and a synthetic click
 * dispatches and runs the handler. Everything looks right except that nobody can see it.
 *
 * Written as a test rather than proved by mutating a view, because the obvious mutation — set
 * `hidden` on the row inside `settings.ts` — silently does nothing: at the point the listener is
 * attached the button has not been appended yet, so it has no parent to hide. That produced a
 * clean run that looked like the check failing to fire, and the difference between "the check is
 * broken" and "the mutation never landed" is the whole reason a mutation needs its own control.
 */
test('the reachability check sees a button hidden by its row, not just one hidden itself', () => {
  const build = (hideRow: boolean, hideButton: boolean): El => {
    const into = document.createElement('div')
    const row = document.createElement('div')
    row.hidden = hideRow
    const button = document.createElement('button')
    button.textContent = 'Press me'
    button.hidden = hideButton
    button.addEventListener('click', () => {})
    row.appendChild(button)
    into.appendChild(row)
    return into as unknown as El
  }

  // The control: with nothing hidden, this fixture must pass — otherwise the two cases below
  // would "fail" for a reason that has nothing to do with reachability.
  const plain = buttons(build(false, false))
  assert.equal(plain.length, 1, 'the fixture did not render one button')
  assert.ok(plain[0]?.live, 'the fixture button has no listener, so this proves nothing')
  assert.ok(plain[0]?.reachable, 'a button in a visible row must read as reachable')
  assert.doesNotThrow(() => assertPressable(plain, 'the control'))

  assert.throws(
    () => assertPressable(buttons(build(false, true)), 'a button hidden itself'),
    /cannot be pressed/,
  )
  assert.throws(
    () => assertPressable(buttons(build(true, false)), 'a button inside a hidden row'),
    /cannot be pressed/,
    'a visible button in a hidden row is the case that actually ships, and the one a check on ' +
      'the node alone walks straight past',
  )
})
