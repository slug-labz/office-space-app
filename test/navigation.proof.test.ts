/**
 * Navigation has to look like navigation, and `new` has to be somewhere you can find it.
 *
 * Reported after going to look for it and failing: new projects could not be made at all.
 * Every layer was individually correct. `Start a new project` existed — in the ⌘K palette.
 * `+ new conversation` existed — inside the switcher's list. The switcher had a caret, hover
 * states and a 32px target. And the app still could not be used to start anything, because the
 * one control that led anywhere read as a **window title**: full-width, borderless at rest, with
 * its caret `margin-left: auto` four hundred pixels away from the words it belonged to.
 *
 * That is this repository's recurring shape — *declared in one place and unreachable from
 * another* — wearing its most expensive costume, because the thing out of reach was the way in.
 *
 * These are source and stylesheet checks, in the idiom `escape.test.ts` and `hidden.test.ts`
 * settled: this repo does not carry a renderer harness, and every invariant below is a few lines
 * of reading. **They are not proof that the control can be clicked.** A control can pass every
 * assertion here and still be dead to a real mouse — `controls.proof.test.ts` was written after
 * exactly that, and the last test in this file is the one guard that speaks to it, because the
 * reason a control in this header goes dead is a property no synthetic event can observe.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { newActions, switcherLabel } from '../src/shared/switcher.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => readFileSync(join(root, p), 'utf8')

const html = read('src/renderer/index.html')
const view = read('src/renderer/views/switcher.ts')
const app = read('src/renderer/app.ts')

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, ' ')
const css = stripComments(read('src/renderer/styles.css')) + stripComments(read('src/renderer/panels.css'))

/** The body of every rule whose selector list contains exactly this class. */
function bodiesOf(selector: string): readonly string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.split(',').some((part) => part.trim() === selector))
    .map((m) => m[2]!)
}


// ─────────────────────────────────────────────────── what the menu offers ──

test('both ways to start something are offered, and the everyday one is first', () => {
  const rows = newActions('payments')
  assert.deepEqual(
    rows.map((r) => r.action),
    ['session', 'project'],
    'a new conversation is a several-times-a-day thing and a new project is a Monday thing. A ' +
      'menu that puts the rare item under the cursor has spent the common one\'s position on it.',
  )
})

test('the conversation row says where it would land', () => {
  // "New conversation" on its own does not say *where*, and not knowing where you are is the
  // whole complaint this answers.
  const [session] = newActions('payments')
  assert.match(session!.label, /payments/)
})

test('a project with no name still reads as a sentence, and agrees with the trigger beside it', () => {
  // `switcherLabel` resolves the nameless case to "The office". Two fallbacks would let the menu
  // and the button it hangs from disagree about which office you are in — which is the bug that
  // put `workspaceLabel` in `shared/switcher.ts` in the first place.
  const fallback = switcherLabel(undefined, undefined).project
  const [session] = newActions('')
  assert.match(session!.label, new RegExp(fallback))
  assert.doesNotMatch(session!.label, /undefined|null/)
})

test('the project row says it will ask before it does anything', () => {
  // Naming a project opens a prompt. A menu item that asks a question first should say so.
  const project = newActions('payments').find((r) => r.action === 'project')
  assert.match(project!.label, /…$/, 'an item that opens a dialog ends in an ellipsis')
})


// ────────────────────────────────────────────── that it reads as a control ──

test('the switcher wears its outline at rest, not only under the pointer', () => {
  // It was `border: 1px solid transparent` until hover. A borderless line of text is a title,
  // and nobody opens a title — which is the entire finding this stream was given.
  const [pair] = bodiesOf('.where__pair')
  assert.ok(pair, '.where__pair has been renamed; the switcher\'s outline lives on it')
  const border = /(^|;)\s*border\s*:\s*([^;]+)/.exec(pair!)
  assert.ok(border, 'the box around the switcher declares no border at rest')
  assert.doesNotMatch(
    border![2]!,
    /transparent|^\s*0/,
    'a border that only appears on hover is a control that only exists on hover',
  )
})

test('the caret sits against the label rather than at the far edge of the pane', () => {
  const [caret] = bodiesOf('.switcher::after')
  assert.ok(caret, '.switcher::after has gone; the trigger has no caret at all')
  assert.match(caret!, /content\s*:/)
  assert.doesNotMatch(
    caret!,
    /margin-left\s*:\s*auto/,
    'the trigger is a flex row, so `margin-left: auto` pushes the caret to its far end. ' +
      'Measured: four hundred pixels between the words and the one mark that says they open ' +
      'something, which is the layout of a title bar.',
  )
})

test('the switcher is the size of what it says, rather than the width of the pane', () => {
  const [trigger] = bodiesOf('.switcher')
  assert.ok(trigger)
  assert.doesNotMatch(
    trigger!,
    /flex\s*:\s*1\s+1\s+0/,
    '`flex: 1 1 0` stretches the trigger across the whole header, which is what made it read ' +
      'as the window title. The frame around it shrinks to fit; the trigger should not fight it.',
  )
})

test('the trigger still says where you are, and has not become a bare icon', () => {
  // The caret was the fix; deleting the label would have been a different bug. Both halves of
  // "where am I" are drawn by the view, and both are still there.
  assert.match(view, /switcher__project/)
  assert.match(view, /switcher__session/)
})


// ─────────────────────────────────────────── that `new` is reachable at all ──

/** The `<header class="pane__head"> … </header>` block, which is where the switcher lives. */
const paneHead = /<header class="pane__head">([\s\S]*?)<\/header>/.exec(html)?.[1] ?? ''

test('the pane header markup is still where this test thinks it is', () => {
  assert.notEqual(paneHead, '', 'the pane header block could not be found — the scan has drifted')
  assert.match(paneHead, /id="switcher"/)
})

test('starting something is one control in the header, not only ⌘K and not only the list', () => {
  assert.match(paneHead, /id="new-open"/, 'the way to start something has left the header')
  assert.match(paneHead, /aria-haspopup="menu"/)
  assert.match(paneHead, /id="new-menu"/)

  // Both of the routes it replaces are deliberately kept. `+ new conversation` at the bottom of
  // the list is where you land when you are *already* choosing where to go, and the palette is
  // the keyboard route — neither is a repetition to delete. What was missing was a way in for
  // somebody who is not already inside one of them.
  assert.match(view, /\+ new conversation/)
  assert.match(app, /Start a new project/)
})

test('both actions are wired from the menu, and to different handlers', () => {
  const openNew = /const openNew = \(\): void => \{([\s\S]*?)\n  \}/.exec(view)
  assert.ok(openNew, 'openNew() has been renamed or restructured')
  assert.match(openNew![1]!, /newActions\(/, 'the menu is being built from a list of its own again')
  assert.match(openNew![1]!, /on\.onNewSession\(\)/)

  // The project action used to call `on.onNewProject()` from here, and the app answered with
  // `window.prompt` — which **Electron does not implement**, so the whole route ended in a
  // `null` the caller discarded. The menu now lands in the switcher's own name field, so this
  // follows the route rather than the old call: the menu reaches `startNaming`, and the field is
  // what calls the handler, with a name.
  assert.match(openNew![1]!, /startNaming\(\)/, 'the menu no longer reaches the naming field')
  assert.match(view, /on\.onNewProject\(name\)/, 'nothing calls onNewProject with a name')
  assert.doesNotMatch(view, /window\.prompt\(/, 'the switcher is asking through a dialog Electron does not have')
})

test('the menu is built when it opens, and never while the pointer is moving over it', () => {
  // `views/select.ts`'s `moveTo` rebuilt its rows on `mouseenter`, which destroys the element
  // under the pointer between the press and the release: the click lands on nothing, and the
  // control is dead to a mouse while looking perfectly alive. That was found by hand, twice.
  //
  // Comments stripped first, the way `type-scale.test.ts` strips them before checking for a
  // retired token — so the comment in the view that explains this trap may name it.
  const code = view.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
  assert.doesNotMatch(
    code,
    /mouseenter/,
    'a row that rebuilds on mouseenter cannot be clicked. Build on open.',
  )
})


// ──────────────────────────────────────────────── that it opens where it can be read ──

test('a menu opened from the top of the window opens downward', () => {
  // `.popmenu` hangs from `bottom: calc(100% + 6px)` because it was written for the floor's `···`
  // and the composer's `model`, which both sit on the bottom edge. Inherited here it would open
  // upward, through the header and off the top.
  assert.match(paneHead, /popmenu--down/)
  const [down] = bodiesOf('.popmenu--down')
  assert.ok(down, '.popmenu--down is used in the markup and declared nowhere')
  assert.match(down!, /top\s*:/)
  assert.match(down!, /bottom\s*:\s*auto/, 'without resetting `bottom` the menu is anchored twice')
})

test('a menu opened from the left end of a row is anchored to that end', () => {
  // Measured on this project once already, on the composer's drawer: it inherited `right: 0`
  // from the base and drew its left edge at **-169px** — open, correct, and entirely off the
  // side of the window.
  assert.match(paneHead, /popmenu--left/)
  const [left] = bodiesOf('.popmenu--left')
  assert.ok(left, '.popmenu--left is used in the markup and declared nowhere')
  assert.match(left!, /left\s*:\s*0/)
})


// ─────────────────────────────────── that a real mouse can reach it ──

test('every button in the pane header opts out of the window drag region', () => {
  /*
   * The one fault in this header that no synthetic event can see.
   *
   * `.pane__head` is `-webkit-app-region: drag` — it is how you move the window. Anything inside
   * it that does not say otherwise belongs to that region, and the compositor takes the press
   * before the page does: `el.click()` and `dispatchEvent` both still work perfectly, the button
   * has a correct hit area, correct ARIA and a correct listener, and a hand on a real mouse gets
   * nothing but a window that slides. A test suite cannot tell the difference. This can.
   */
  const [head] = bodiesOf('.pane__head')
  assert.ok(head, '.pane__head has been renamed')
  assert.match(head!, /-webkit-app-region\s*:\s*drag/, 'if the header stopped being a drag region this test is obsolete — delete it rather than weakening it')

  const undraggable = new Set(
    [...css.matchAll(/([^{}]+)\{([^{}]*-webkit-app-region\s*:\s*no-drag[^{}]*)\}/g)]
      .flatMap((m) => m[1]!.split(','))
      .map((part) => part.trim().replace(/^\./, '')),
  )

  const exposed: string[] = []
  for (const button of paneHead.matchAll(/<button\b([^>]*)>/g)) {
    const classes = /class="([^"]+)"/.exec(button[1]!)?.[1]?.split(/\s+/) ?? []
    const id = /id="([^"]+)"/.exec(button[1]!)?.[1] ?? '(unnamed)'
    if (!classes.some((c) => undraggable.has(c))) exposed.push(id)
  }

  assert.ok(paneHead.includes('<button'), 'no buttons found in the header — the scan has drifted')
  assert.deepEqual(
    exposed,
    [],
    `these sit in the window's drag region, so the press moves the window and the click never ` +
      `lands — invisible to every test that does not measure it: ${exposed.join(', ')}`,
  )
})
