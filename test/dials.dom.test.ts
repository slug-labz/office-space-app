/**
 * The three dials, which decide what every turn costs and what it is allowed to do.
 *
 * Model, effort, and permission mode. Nothing was aimed at this module — it sat in the census
 * under "loads fine, no test" — and it is the one place in the UI where a wrong answer is
 * expensive rather than ugly: pick `opus` and get `sonnet`, or believe you are in
 * `acceptEdits` when the session is in `default`.
 *
 * ## Three invariants, each with a scar
 *
 * **A pending choice beats the painted one.** `readDials` prefers what you just picked over what
 * the office last confirmed, and the comment says why: *"if we sent that we would only ever ask
 * it to keep doing what it is already doing."* The line above it is blunter — *"The value, not
 * just the fact of a change. Discarding it is what made every picker inert."* So there was a
 * release where all three dials moved and nothing happened, and this ordering is the fix.
 *
 * **The office's answer ends the pendency.** `showControls` clears the pending value before
 * painting. Without that, a choice the office refused would go on overriding the truth on every
 * subsequent send, forever, and the dial would show one thing while the session did another.
 *
 * **Two permission modes are deliberately not offered.** The CLI accepts them and then silently
 * resolves them to `default` under `--print`. Offering them would put a mode in the picker that
 * the session is not in — the third standing order, in a dropdown.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { fillDials, readDials, showControls, type DialElements } from '../src/renderer/views/dials.js'
import { OFFERED_PERMISSION_MODES, PERMISSION_MODES, type Controls } from '../src/shared/controls.js'
import { triggerLabel } from '../src/shared/control-copy.js'

installDom()

interface Rig {
  readonly els: DialElements
  readonly changes: number[]
  /** Pick a labelled option out of one dial, the way a pointer does. */
  readonly pick: (dial: keyof DialElements, label: string) => void
  readonly options: (dial: keyof DialElements) => string[]
  readonly triggerText: (dial: keyof DialElements) => string
}

function rig(): Rig {
  const host = (): HTMLElement => document.createElement('div')
  const els: DialElements = { model: host(), effort: host(), permission: host() }
  const changes: number[] = []
  fillDials(els, () => changes.push(changes.length + 1))

  const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

  /**
   * Open the dial, then read its rows.
   *
   * A `Select` builds its list on open and marks rows with `role="option"`, not with a class —
   * the first version of this rig looked for `.sel__row` on an unopened dial, found nothing, and
   * the "no withheld permission mode leaked" assertion passed on an empty list. Which is why the
   * first test here counts the options before anything else reads them.
   */
  const rowsOf = (dial: keyof DialElements): El[] => {
    const host = els[dial] as unknown as El
    const trigger = all(host).find((n) => n.tag === 'button')
    assert.ok(trigger, `the ${dial} dial has no trigger, so nothing here can open it`)
    if (!all(host).some((n) => n.getAttribute('role') === 'option')) {
      trigger.dispatchEvent({ type: 'click', bubbles: true })
    }
    return all(host).filter((n) => n.getAttribute('role') === 'option')
  }

  return {
    els,
    changes,
    options: (dial) => rowsOf(dial).map((r) => (r.textContent || '').trim()),
    triggerText: (dial) =>
      (all(els[dial] as unknown as El).find((n) => n.classList.contains('sel__trigger'))?.textContent ?? '').trim(),
    pick: (dial, label) => {
      const row = rowsOf(dial).find((r) => (r.textContent || '').startsWith(label))
      assert.ok(row, `no option starting ${JSON.stringify(label)} in the ${dial} dial — found ${JSON.stringify(rowsOf(dial).map((r) => (r.textContent || '').slice(0, 12)))}`)
      // `select.ts` commits on mousedown, not click.
      row.dispatchEvent({ type: 'mousedown', bubbles: true, preventDefault: () => {} })
    },
  }
}

test('the dials draw the choices the office can actually be in', () => {
  const r = rig()

  // The control: three empty hosts would satisfy every "does not contain a bad option" check.
  for (const dial of ['model', 'effort', 'permission'] as const) {
    assert.ok(r.options(dial).length > 1, `the ${dial} dial drew ${r.options(dial).length} options`)
  }
})

test('a mode the CLI silently downgrades is never offered', () => {
  const r = rig()
  const offered = r.options('permission')

  // The ones that exist but are not offered — the whole point of the filter.
  const withheld = PERMISSION_MODES.filter((m) => !OFFERED_PERMISSION_MODES.includes(m as never))
  assert.ok(
    withheld.length > 0,
    'every permission mode is now offered, so either the CLI stopped downgrading them — in ' +
      'which case this test should go — or the filter was removed, in which case the picker can ' +
      'now show a mode the session is not in',
  )

  // Counted, not text-matched.
  //
  // The first version compared each withheld mode's *identifier* against the rendered labels,
  // and `bypassPermissions` renders as "bypass permissions" — so a leak would not have matched
  // and the check could not have failed. Worse, mutating the filter out of `dials.ts` changed
  // nothing at all, because `choicesFor` already excludes them: the filter there is a second
  // guard on the same door, and the door it guards is `control-copy.ts`.
  //
  // So the assertion is against the count, which moves whichever of the two stops filtering.
  assert.equal(
    offered.length,
    OFFERED_PERMISSION_MODES.length,
    `the permission dial drew ${offered.length} options for ${OFFERED_PERMISSION_MODES.length} ` +
      `offered modes: ${JSON.stringify(offered)}. ${withheld.join(' and ')} are accepted by the ` +
      `CLI and then silently resolved to \`default\` under --print, so a picker offering them ` +
      `tells you the session is in a mode it is not in.`,
  )

  // And by label, using the app's own copy rather than the identifier, so a mode that leaks
  // under its human name is caught too.
  const leaked = withheld
    .map((mode) => ({ mode, label: triggerLabel('permissionMode', String(mode)) }))
    .filter(({ label }) => offered.some((o) => o.toLowerCase().includes(label.toLowerCase())))
    .map(({ mode }) => String(mode))
  assert.deepEqual(leaked, [], `offered under its own label: ${leaked.join(', ')}`)
})

test('what you just picked is what gets sent, not what the office last confirmed', () => {
  const r = rig()

  // The office says it is on defaults, and paints them.
  showControls(r.els, { model: 'default', effort: 'default', permissionMode: 'default' } as Controls, [])
  assert.equal(readDials(r.els).model, 'default')

  // You pick something else. Nothing has confirmed it yet.
  r.pick('model', 'opus')
  assert.equal(
    readDials(r.els).model,
    'opus',
    'the pending choice was discarded in favour of the painted value — which is what made every ' +
      'picker inert: the office would only ever be asked to keep doing what it was already doing',
  )
  assert.ok(r.changes.length > 0, 'picking an option did not notify the caller, so nothing would re-cost the turn')
})

test('once the office answers, its answer is the truth', () => {
  const r = rig()
  showControls(r.els, { model: 'default', effort: 'default', permissionMode: 'default' } as Controls, [])
  r.pick('model', 'opus')
  assert.equal(readDials(r.els).model, 'opus')

  // The office comes back having refused, and says it is still on default.
  showControls(r.els, { model: 'default', effort: 'default', permissionMode: 'default' } as Controls, [])
  assert.equal(
    readDials(r.els).model,
    'default',
    'a pending choice survived the office answering. It would then override the truth on every ' +
      'send from here on, and the dial would show one thing while the session did another.',
  )
})

test('each dial is independent — picking a model does not move the effort', () => {
  const r = rig()
  showControls(r.els, { model: 'default', effort: 'default', permissionMode: 'default' } as Controls, [])

  r.pick('effort', 'high')
  const after = readDials(r.els)
  assert.equal(after.effort, 'high')
  assert.equal(after.model, 'default', 'picking an effort changed the model')
  assert.equal(after.permissionMode, 'default', 'picking an effort changed the permission mode')
})
