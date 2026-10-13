/**
 * Every panel can be left, and every panel can be reached without a mouse.
 *
 * `panels-are-dialogs.test.ts` already checks what a panel *is* — `role="dialog"`, `aria-modal`,
 * a name that is not a filesystem path. These are the two things a panel has to *do*, and
 * neither had a check.
 *
 * ## The claim this verifies
 *
 * `app.ts` says of the memory entry, next to the palette registration:
 *
 *     Registered rather than given a shortcut, which is what makes "every shipped capability is
 *     reachable with the keyboard" true by construction instead of by an audit somebody repeats.
 *
 * That is right about the *mechanism* and wrong about *by construction*: nothing forced the next
 * panel to be registered at all. A panel with a `showX()` and no palette entry is reachable only
 * by whatever else happens to call it, and the sentence above quietly stops being true — which is
 * worse than never having claimed it, because the claim is why nobody looks.
 *
 * The repository already knows the shape. `app.ts`, on the music controller: *"Laptop 1's review:
 * the controller had one door and it was the sofa. A pill in the status bar fixed discoverability
 * by mouse and left it with no keyboard route at all."*
 *
 * ## And the other one
 *
 * A modal that will not close on Escape is a trap. That used to be guarded here, because
 * `escapables()` was a hand-written list beside a hand-written `coveringPanels()` and two
 * hand-written lists of the same things is this codebase's most familiar bug. They are now views
 * of one table, so the assertion has moved to `one-panel-list.test.ts`, which checks the thing
 * that can still be wrong: whether the table and the markup name the same panels.
 *
 * What stays here is the half a merged list does not settle — that a panel can be *reached*.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = await readFile(join(repo, 'src/renderer/app.ts'), 'utf8')

/**
 * The `els.` names in `panels()`, optionally only the covering ones.
 *
 * Was two calls to a helper that read `coveringPanels()` and `escapables()` as literal arrays.
 * Both are now derived from one table, which is why the assertion that used to sit here —
 * *every covering panel is also escapable* — has gone rather than been rewritten: with one list
 * it cannot be false, and a test that cannot fail is a line that reads like protection and is
 * not. What replaced it guards the thing that can still go wrong — that the table and the markup
 * name the same panels — and it lives in `one-panel-list.test.ts`.
 */
function panelNames(onlyCovering: boolean): string[] {
  const body = /function panels\(\)[\s\S]*?return \[([\s\S]*?)\n  \]/.exec(app)?.[1]
  assert.ok(body, 'panels() has been renamed or restructured — this test can no longer find what it guards')
  return [...body.matchAll(/\{\s*el:\s*els\.(\w+),[^}]*covering:\s*(true|false)\s*\}/g)]
    .filter((m) => !onlyCovering || m[2] === 'true')
    .map((m) => m[1]!)
}

const covering = panelNames(true)

test('the scan found the table, or the assertions below are about nothing', () => {
  assert.ok(covering.length >= 6, `panels() yielded ${covering.length} covering panels`)
  assert.ok(panelNames(false).length > covering.length, 'no non-covering surfaces found; the parse has drifted')
})

/*
 * Panels a palette entry would be wrong for. Each is opened by something more specific than a
 * command, and putting it in a list of things you can *ask for* would offer a door that is not
 * one.
 */
const NOT_ASKED_FOR: Record<string, string> = {
  // The person card. Opened by clicking somebody on the floor — "open the card" is not a command,
  // it is a command about a particular colleague, and the palette already lists them by name.
  card: 'opened by choosing a person, who the palette lists individually',
  // Shown once, by the app, when there is no workspace yet. Asking for it is not a thing to want.
  firstRunPanel: 'shown by the app on a first run, never requested',
}

/**
 * The function that opens each panel, found by the line that reveals it.
 *
 * `hidden = false` is the whole of what opening means here, and every panel does it in exactly
 * one place — which is what makes this findable rather than guessed at.
 */
function opensPanel(name: string): string | null {
  const at = app.indexOf(`els.${name}.hidden = false`)
  if (at === -1) return null
  const before = app.slice(0, at)
  const fn = [...before.matchAll(/function (\w+)\(/g)].pop()
  return fn?.[1] ?? null
}

test('every panel that covers the app has a route from the command palette', () => {
  const switchBody = /function runAction\([\s\S]*?\n}/.exec(app)?.[0]
  assert.ok(switchBody, 'runAction has been restructured — this test can no longer find what it guards')

  const unreachable: string[] = []
  for (const name of covering) {
    if (name in NOT_ASKED_FOR) continue
    const opener = opensPanel(name)
    assert.ok(opener, `nothing in app.ts sets els.${name}.hidden = false, so this scan cannot see how it opens`)
    // A whole word, not a substring. `includes('showMemory')` is satisfied by `showMemoryXX`,
    // so the check passed a mutation that renamed the call — found by mutating it, which is the
    // only way an assertion that is merely too weak ever announces itself.
    if (!new RegExp(`\\b${opener}\\b`).test(switchBody)) unreachable.push(`${name} (opened by ${opener})`)
  }

  assert.deepEqual(
    unreachable,
    [],
    'runAction() never calls what opens these, so they have no keyboard route. app.ts claims ' +
      'palette registration makes "every shipped capability is reachable with the keyboard" true ' +
      'by construction — it is only true while every panel is actually registered, and nothing ' +
      'made the next one be. Either add a palette entry, or say here why it is not asked for.',
  )
})

test('the exceptions are real panels, so a rename cannot leave a stale excuse behind', () => {
  for (const [name, why] of Object.entries(NOT_ASKED_FOR)) {
    assert.ok(covering.includes(name), `${name} is excused from needing a palette entry and is not a covering panel`)
    assert.ok(why.length > 20, `${name} is excused without a reason worth reading`)
  }
})
