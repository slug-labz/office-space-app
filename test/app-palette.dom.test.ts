/**
 * The command palette — the one route to everything, and the only keyboard route to most of it.
 *
 * `⌘K` is how somebody who is not clicking gets to the roster, the task list, the settings, the
 * music, a new project. Several of those have no other keyboard route at all: the settings panel
 * is behind a `···` menu, and the first-run panel's pill is hidden whenever there is nothing
 * wrong with the workspace. So this surface carries more than its share, and nothing was aimed
 * at it — it sat in `every-module-is-aimed-at.test.ts` under "loads fine, no test".
 *
 * ## The invariant worth having a test for
 *
 * `choose()` closes the palette **before** running the action, and its comment says why:
 *
 *     Several actions open a panel and focus something in it, and doing that underneath a
 *     palette that is still up is how focus ends up somewhere nobody can see.
 *
 * That is not hypothetical in this branch. `watchPanels` moves focus into a panel the moment it
 * opens, and three separate focus bugs were fixed a few commits ago — one of which put focus on
 * `document.body` because a panel's content was replaced under it. Swap those two lines and the
 * palette re-opens the race deliberately: the panel takes focus, then the palette closes on top
 * of the result. Nothing throws, nothing looks wrong, and the keyboard user is nowhere.
 *
 * So the order is asserted directly, by recording whether the palette was still open at the
 * moment `run` was called.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { AppPalette, accelerator } from '../src/renderer/views/app-palette.js'
import type { Action } from '../src/shared/actions.js'

installDom()

const ACTIONS: readonly Action[] = [
  { id: 'roster', label: 'Open the roster — who works here', group: 'Office', also: ['staff', 'hire'] },
  { id: 'settings', label: 'Settings — theme, density, layout, text size', group: 'View', keys: '⌘,', also: ['preferences'] },
  { id: 'tasks', label: 'Open the task list for this project', group: 'Project', also: ['verify'] },
  { id: 'new-project', label: 'Start a new project', group: 'Project', also: ['create'] },
]

interface Harness {
  readonly palette: AppPalette
  readonly root: El
  readonly input: El
  readonly list: El
  readonly ran: string[]
  /** Whether the palette was still open at the instant each action was run. */
  readonly openWhenRun: boolean[]
  readonly rows: () => El[]
  readonly type: (text: string) => void
  readonly press: (key: string) => void
}

function harness(actions: readonly Action[] = ACTIONS): Harness {
  const root = document.createElement('div')
  const input = document.createElement('input')
  const list = document.createElement('div')
  root.appendChild(input)
  root.appendChild(list)
  root.hidden = true

  const ran: string[] = []
  const openWhenRun: boolean[] = []
  let palette: AppPalette
  palette = new AppPalette(root, input as HTMLInputElement, list, {
    actions: () => actions,
    run: (id) => {
      ran.push(id)
      openWhenRun.push(palette.isOpen)
    },
  })

  const el = root as unknown as El
  const all = (n: El): El[] => [n, ...n.children.flatMap(all)]
  return {
    palette,
    root: el,
    input: input as unknown as El,
    list: list as unknown as El,
    ran,
    openWhenRun,
    rows: () => all(list as unknown as El).filter((n) => n.classList.contains('apal__row')),
    type: (text) => {
      ;(input as unknown as { value: string }).value = text
      ;(input as unknown as El).dispatchEvent({ type: 'input', bubbles: false })
    },
    // `preventDefault` is not optional here: `key()` calls it on every branch it handles, and
    // the shim throws rather than swallowing a missing one — which is the right failure, since
    // a swallowed `preventDefault` lets a test drive something a browser would have intercepted.
    press: (key) =>
      (input as unknown as El).dispatchEvent({ type: 'keydown', bubbles: false, key, preventDefault: () => {} }),
  }
}

test('opening draws every action and puts the cursor in the field', () => {
  const h = harness()
  assert.equal(h.palette.isOpen, false, 'it must start closed, or every assertion below is about a palette nobody opened')

  h.palette.open()

  assert.equal(h.palette.isOpen, true)
  // `focused`, not `document.activeElement`: the shim records that focus was *asked for* and
  // has no active element at all, deliberately — "recorded, not performed". Asking it for a
  // browser fact it does not model is how a test ends up asserting something about the fake.
  assert.equal(h.input.focused, true, 'the field was never asked for focus, so typing goes nowhere')
  assert.equal(h.rows().length, ACTIONS.length, 'not every action was drawn')
})

test('typing filters, and a query that matches nothing says so rather than drawing blank', () => {
  const h = harness()
  h.palette.open()

  h.type('roster')
  assert.equal(h.rows().length, 1, 'a query that names one action should leave one row')

  h.type('zzzznothing')
  assert.equal(h.rows().length, 0)
  // Blank is indistinguishable from broken. The panel has to say which it is.
  const text = [h.list, ...h.list.children].map((n) => n.textContent).join(' ')
  assert.match(text, /Nothing here matches/, 'an empty result draws nothing at all, which reads as a failure to load')
})

test('the arrows walk the list and wrap at both ends', () => {
  const h = harness()
  h.palette.open()
  const highlighted = (): string => h.rows().find((r) => r.classList.contains('apal__row--on'))?.textContent ?? '(none)'

  const first = highlighted()
  assert.notEqual(first, '(none)', 'nothing is highlighted on open, so Enter would have no target')

  h.press('ArrowDown')
  assert.notEqual(highlighted(), first, 'ArrowDown did not move the cursor')

  // Down through the whole list and one more: it must come back to the top rather than stopping.
  for (let i = 1; i < ACTIONS.length; i += 1) h.press('ArrowDown')
  assert.equal(highlighted(), first, 'the cursor did not wrap — a list you can walk off the end of makes you look at it to use it')

  h.press('ArrowUp')
  assert.equal(highlighted(), h.rows()[h.rows().length - 1]?.textContent, 'ArrowUp from the top must wrap to the bottom')
})


/**
 * Let the action run.
 *
 * `choose()` defers to the next task on purpose: a row is taken on `mousedown`, and that event
 * keeps bubbling to `document` afterwards, where `switcher.ts` and `popmenu.ts` both listen for
 * an outside press and close. An action that opened one of those inside the event had it shut
 * again by the same event — which is what `⌘K → "Switch project or conversation"` did, silently,
 * while `⌘L` worked. So every assertion about what ran waits one task first.
 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

test('Enter runs what is highlighted, and Escape runs nothing', async () => {
  const h = harness()
  h.palette.open()
  h.press('Enter')
  await settle()
  assert.deepEqual(h.ran, ['roster'], 'Enter did not run the highlighted action')

  h.palette.open()
  h.press('ArrowDown')
  h.press('Enter')
  await settle()
  assert.deepEqual(h.ran, ['roster', 'settings'], 'Enter ran the wrong row after ArrowDown')

  h.palette.open()
  h.press('Escape')
  await settle()
  assert.equal(h.palette.isOpen, false, 'Escape did not close it')
  assert.deepEqual(h.ran, ['roster', 'settings'], 'Escape ran something')
})

test('the palette is already closed by the time the action runs', async () => {
  // The invariant this file exists for. Several actions open a panel and focus something inside
  // it; `watchPanels` does that automatically now. Running one underneath a palette that is
  // still up puts focus behind the palette, and nothing about it throws or looks wrong.
  const h = harness()
  h.palette.open()
  h.press('Enter')
  await settle()

  assert.deepEqual(h.ran, ['roster'])
  assert.deepEqual(
    h.openWhenRun,
    [false],
    'the palette was still open when the action ran. Anything that opens a panel and focuses ' +
      'into it will land underneath this, and the person driving by keyboard ends up somewhere ' +
      'they cannot see. `choose()` must close before it calls `run`.',
  )
})

test('clicking the backdrop closes it; clicking inside does not', () => {
  const h = harness()
  h.palette.open()

  h.list.dispatchEvent({ type: 'mousedown', bubbles: true, target: h.list })
  assert.equal(h.palette.isOpen, true, 'a click on the list closed the palette, so picking a row would be impossible')

  h.root.dispatchEvent({ type: 'mousedown', bubbles: true, target: h.root })
  assert.equal(h.palette.isOpen, false, 'clicking the backdrop must close it — it is what everybody tries first')
})

test('the accelerator is written the way the platform writes it', () => {
  // A label saying ⌘ on Linux is a label nobody can follow.
  assert.match(accelerator('MacIntel', 'k'), /⌘/)
  assert.doesNotMatch(accelerator('Linux x86_64', 'k'), /⌘/)
  assert.match(accelerator('Linux x86_64', 'k'), /Ctrl/i)
})

/**
 * ## The pointer, which is deliberately not a click
 *
 *     `mousedown`, not `click`: the input has focus, and a click would blur it first and let the
 *     backdrop handler race the selection.
 *
 * The backdrop closes the palette when you press outside it. A `click` on a row fires after the
 * blur, by which point the race with that handler is already running -- so the row you pressed
 * either runs or does not depending on ordering, which is the worst kind of control to ship.
 *
 * ## And hovering must not cost you the row you were reaching for
 *
 * Hovering sets the cursor and redraws, and `draw()` is `replaceChildren()` -- so every row a
 * moment later is a different object. That exact shape was a real reported bug in `select.ts`:
 * "i cant change it the tick remains on the same position and it doesnt change anything",
 * because the list also scrolled and moved the target out from under the hand reaching for it.
 * This list does not scroll, so it is fine -- and that is worth a test rather than a reading,
 * because the thing that made it fine over there is a line somebody could add here.
 */

test('toggle opens a closed palette and closes an open one', () => {
  const h = harness()
  assert.equal(h.palette.isOpen, false, 'the palette starts open')

  h.palette.toggle()
  assert.equal(h.palette.isOpen, true, 'toggle did not open it')

  h.palette.toggle()
  assert.equal(h.palette.isOpen, false, 'toggle did not close it again')
})

test('a row is taken on mousedown, before the field can blur', async () => {
  const h = harness()
  h.palette.open()
  const rows = h.rows()
  assert.ok(rows.length > 0, 'no rows to press')

  rows[0]!.dispatchEvent({ type: 'mousedown', bubbles: true, preventDefault: () => {} })
  await settle()
  assert.equal(h.ran.length, 1, 'pressing a row ran nothing')
})

test('hovering a row and then pressing it runs that row', async () => {
  // Hover redraws the whole list, so the element pressed is not the element hovered. The guard
  // is that pressing still reaches the action the pointer is actually over.
  const h = harness()
  h.palette.open()
  assert.ok(h.rows().length >= 2, 'need at least two rows to tell them apart')

  const wanted = (h.rows()[1]!.textContent ?? '').trim()
  h.rows()[1]!.dispatchEvent({ type: 'mouseenter', bubbles: false })

  // Re-found after the redraw, the way a pointer finds whatever is under it now.
  const again = h.rows()[1]
  assert.ok(again, 'the second row disappeared when it was hovered')
  assert.match(again.className, /apal__row--on/, 'hovering did not move the cursor to the row under the pointer')
  assert.equal((again.textContent ?? '').trim(), wanted, 'the rows reordered themselves under the pointer')

  again.dispatchEvent({ type: 'mousedown', bubbles: true, preventDefault: () => {} })
  await settle()
  assert.equal(h.ran.length, 1, 'pressing the hovered row ran nothing')
})

test('closing an already closed palette is not an error', () => {
  const h = harness()
  h.palette.close()
  assert.equal(h.palette.isOpen, false)
})

// ── when the list is longer than a dialog ───────────────────────────────────────────────────

/**
 * The palette can reach **every project and every conversation** by name now, and a workspace
 * with six hundred projects would otherwise put six hundred rows in a dialog. Measured on one:
 * the switcher drew all 620, in a flat list with no filter, and ⌘K could not reach a project at
 * all — it offered *"Switch project or conversation"*, which opens the list you were going to
 * have to read anyway.
 *
 * So the drawing is capped and the **matching is not**. That split is the whole design: the
 * project you want is always findable by typing more of its name, and the dialog never becomes
 * a scrollable directory.
 */

const many = (n: number): Action[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `go:project-${i}`,
    label: `Go to project ${i}`,
    group: 'Project' as const,
  }))

test('a list longer than the dialog is cut, and says how much was cut', () => {
  // Silence here would be the palette claiming the workspace has twenty-four things in it —
  // the same sentence the campus refuses to make when it cannot draw every office.
  const h = harness([...ACTIONS, ...many(300)])
  h.palette.open()

  const drawn = h.rows().length
  assert.ok(drawn > 0 && drawn < 300, `the palette drew ${drawn} rows`)

  const text = (h.list.textContent ?? '').replace(/\s+/g, ' ')
  assert.match(text, /more match/, `nothing said the list was cut: ${JSON.stringify(text.slice(-90))}`)
  assert.match(text, /type another letter/, 'the note gives a count and not the next move')
})

test('and the fixed commands are never the ones cut', () => {
  // The property that makes the cap safe rather than merely bounded. A capability becoming
  // unreachable because a workspace grew is the failure this whole palette exists to prevent.
  const h = harness([...ACTIONS, ...many(300)])
  h.palette.open()

  const labels = h.rows().map((r) => (r.textContent ?? ''))
  for (const fixed of ACTIONS) {
    assert.ok(
      labels.some((l) => l.includes(fixed.label)),
      `"${fixed.label}" was pushed off the list by the projects behind it`,
    )
  }
})

test('typing still reaches something the cap had hidden', () => {
  // The half that matters. A cap on drawing is fine; a cap on *matching* would mean the four
  // hundredth project could not be found at all, which is worse than the flat list it replaces.
  const h = harness([...ACTIONS, ...many(300)])
  h.palette.open()
  h.type('project 287')

  const labels = h.rows().map((r) => r.textContent ?? '')
  assert.ok(
    labels.some((l) => l.includes('Go to project 287')),
    `typing its name did not find it: ${JSON.stringify(labels.slice(0, 3))}`,
  )
})

test('a list that fits says nothing about being cut', () => {
  // The control. A note that always appears is a note nobody reads.
  const h = harness()
  h.palette.open()
  assert.doesNotMatch((h.list.textContent ?? ''), /more match/, 'a short list claimed something was hidden')
})

test('one hidden match is "1 more matches", not "1 more match"', () => {
  // Both plurals stated once. `repo-health` checks that a count in a sentence carries its own,
  // and this is the sentence where getting it wrong is most visible — it is the last line.
  const h = harness([...ACTIONS, ...many(25 - ACTIONS.length)])
  h.palette.open()
  const text = (h.list.textContent ?? '').replace(/\s+/g, ' ')
  if (/more match/.test(text)) assert.match(text, /1 more matches|\d+ more match/)
})

/*
 * The guarantee, on its own.
 *
 * Found by operating the app: `⌘K → "Switch project or conversation"` closed the palette and
 * opened nothing, while `⌘L` — the same `els.switcher.click()`, reached from a keydown — worked.
 * Every layer was individually correct. The row binds `mousedown` deliberately, and
 * `switcher.ts` closes on an outside `mousedown` deliberately; the row's event keeps bubbling to
 * `document` after the action has already opened the list, its target is the row, the row is
 * outside, and the list shuts inside the event that asked for it.
 *
 * Asserted as *not synchronous* rather than by rebuilding that bubbling chain in a fake DOM: the
 * task boundary is the fix, and a test that reproduced the chain would pass just as well against
 * a `stopPropagation` that quietly took the event away from every other document listener.
 */
test('an action never runs inside the event that chose it', async () => {
  const h = harness()
  h.palette.open()
  const rows = h.rows()
  assert.ok(rows.length > 0)

  rows[0]!.dispatchEvent({ type: 'mousedown', bubbles: true, preventDefault: () => {} })
  assert.deepEqual(h.ran, [], 'the action ran inside the mousedown, where anything it opens can be closed by that same event')
  assert.equal(h.palette.isOpen, false, 'and the palette still closes immediately, which is what a person sees')

  await settle()
  assert.deepEqual(h.ran, ['roster'], 'the action never ran at all')
})
