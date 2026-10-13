/**
 * The count and the list it counts are drawn from one diagnosis, and both have to be current.
 *
 * `render()` rebuilds the badge — *"2 things to know"* — on every snapshot. The panel underneath
 * it was painted once, when it opened, and then left alone. So a problem arriving while somebody
 * had the panel open moved the number and not the list.
 *
 * Measured with the panel open throughout: make an agent file unreadable, and the badge goes from
 * *"1 thing to know"* to *"2 things to know"* while the panel still lists the same two items. The
 * office states a count it cannot account for, on the one surface whose whole job is telling
 * somebody what is wrong, and the reader has nowhere to go to find the second thing.
 *
 * ## Why this reads the source
 *
 * `app.ts` builds its element map from `document` at module scope, so it cannot be imported by a
 * test. Its siblings have the same constraint and the same answer —
 * `one-transcript-at-a-time.test.ts` parses `openSession`, `no-panel-is-a-trap.test.ts` parses
 * `runAction`. This is narrower than driving it and it is what there is; the behaviour above was
 * checked by driving the real app, before and after.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = await readFile(join(repo, 'src/renderer/app.ts'), 'utf8')

/**
 * Comments blanked in place, newlines kept.
 *
 * Not decoration. The first version of the check below scanned the raw source, and commenting the
 * call out — which is exactly how this regresses — left the text `refreshFirstRun()` sitting in
 * the comment for `indexOf` to find. The mutation passed. `repo-health.test.ts` blanks comments
 * for the same reason and says so; this file had to learn it again.
 */
const code = app.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(?<!:)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))

test('the scan found what it guards, or everything below is about nothing', () => {
  assert.match(code, /function refreshFirstRun\(\)/, 'refreshFirstRun has been renamed')
  assert.match(code, /function paintFirstRun\(/, 'paintFirstRun has been renamed')
  assert.match(code, /els\.gettingStarted\.textContent = started/, 'the badge is no longer set here')
})

test('whatever repaints the badge also repaints the panel it counts', () => {
  // Both in `render`, and adjacent on purpose: they read the same diagnosis, and the defect is
  // exactly the two of them disagreeing about when to read it.
  const badge = code.indexOf('els.gettingStarted.textContent = started')
  const refresh = code.indexOf('refreshFirstRun()', badge)
  assert.ok(badge > 0, 'the badge assignment has moved — this check is blind')
  assert.ok(
    refresh > badge && refresh - badge < 400,
    'nothing repaints the first-run panel where the badge is rebuilt. The badge counts the ' +
      "panel's own items, so a problem arriving while somebody has it open moves the number and " +
      'not the list — a count the reader cannot account for.',
  )
})

test('the repaint refuses to open a closed panel', () => {
  /*
   * The half that keeps this a fix rather than a new bug. Whether the panel should be on screen
   * is `firstRunVerdict`'s decision — stated in `showFirstRun` as the reason that call exists —
   * and a repaint that opened it would put a panel over the office every time a snapshot
   * arrived, which is a far worse failure than the stale list it replaces.
   */
  const body = /function refreshFirstRun\(\)[\s\S]*?\n}/.exec(code)?.[0] ?? ''
  assert.match(
    body,
    /if \(els\.firstRunPanel\.hidden\) return/,
    'refreshFirstRun does not check whether the panel is open first',
  )
  assert.doesNotMatch(body, /hidden = false/, 'refreshFirstRun opens the panel; that is not its decision to make')
  assert.doesNotMatch(body, /onlyPanel\(/, 'refreshFirstRun raises the panel over whatever else is open')
})

/*
 * The same fault one panel along, and the reason this file is not named after the first one.
 *
 * The floor's status bar rebuilds *"N on the floor"* from every snapshot. The roster lists the
 * same people and was painted once, when it opened. Both are on screen together — the bar along
 * the bottom, the panel down the side — so writing an agent file while the roster is open put
 * *"8 on the floor"* above a list of seven, in one glance.
 *
 * That panel's own header is the argument for the fix: *"the filesystem is the roster, and
 * anything holding a second copy of it eventually draws a desk for somebody who is not there."*
 * A panel painted once and left is that second copy.
 */
test('an open roster is repainted when the staff or the shelf changes', () => {
  assert.match(code, /function refreshRoster\(\)/, 'refreshRoster has been renamed — this check is blind')

  const render = /async function render\(next: OfficeSnapshot\)[\s\S]*?\n\}/.exec(code)?.[0] ?? ''
  assert.ok(render, 'render has been renamed')
  assert.match(
    render,
    /refreshRoster\(\)/,
    'nothing repaints the roster from render. The status bar counts the same people from every ' +
      'snapshot, so an open roster goes stale beside a number that does not — the office ' +
      'contradicting itself in a single glance.',
  )
  assert.match(
    render,
    /next\.staff\.map|next\.skills\.map/,
    'the repaint is not keyed on what the roster shows, so it runs on every snapshot — three IPC ' +
      'round-trips and two disk reads each time anything in the workspace moves.',
  )
})

test('the roster repaint refuses to open a closed panel, and is silent', () => {
  const body = /function refreshRoster\(\)[\s\S]*?\n}/.exec(code)?.[0] ?? ''
  assert.match(body, /if \(els\.rosterPanel\.hidden\) return/, 'it does not check whether the panel is open')
  assert.doesNotMatch(body, /hidden = false/, 'a repaint that opens the panel puts it over the office on every change')
  // `loading()` over a list already on screen reads as a panel reloading itself whenever any
  // file in the workspace moves. The notice belongs to an empty panel somebody just opened.
  assert.doesNotMatch(body, /loading\(/, 'the repaint flashes the reading notice over a list already drawn')
})
