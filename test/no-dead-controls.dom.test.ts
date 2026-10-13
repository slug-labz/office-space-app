/**
 * Every button a view draws does something when it is pressed.
 *
 * This exists because of a bug found by pressing a button rather than by reading anything:
 * `+ new project` called `window.prompt`, which **Electron does not implement**, so it returned
 * `null` and the guard discarded it. The control was drawn, styled, hoverable and completely
 * inert, and every test passed because every test was of the layer underneath.
 *
 * It was not the first. `views/select.ts` rebuilt its rows on `mouseenter`, which destroys the
 * element under the pointer between the press and the release — the click lands on nothing, and
 * the control is dead to a mouse while looking perfectly alive. **That one was found by hand,
 * twice**, which is what a class of bug looks like when nothing is watching for it.
 *
 * So this watches for the class rather than the instances: render each view the harness can
 * reach, walk everything it drew, and require that every button has somebody listening.
 *
 * ## What this does and does not catch
 *
 * It catches a button with no listener at all — drawn and forgotten, or wired to an element that
 * is not the one on screen. It does **not** catch a listener that runs and achieves nothing,
 * which is what `window.prompt` actually was: the listener existed and fired, and the platform
 * answered `null`. That one is caught by `dialogs-electron-has.test.ts`, and the two together
 * are the pair. Neither alone would have found it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { renderStrip, type ActivityHandlers } from '../src/renderer/views/activity.js'
import { renderRoster, type RosterHandlers } from '../src/renderer/views/roster.js'
import { renderPrivacy, type PrivacyHandlers } from '../src/renderer/views/privacy.js'
import { hireForm, skillForm, type FormHandlers, type HireDraft, type SkillDraft } from '../src/renderer/views/hire.js'
import type { RosterModel } from '../src/shared/roster-view.js'
import type { MeasuredStore, PrivacyReport } from '../src/main/privacy.js'
import type { PendingApproval, StaffMember } from '../src/shared/ipc.js'

installDom()

const host = (): El => document.createElement('div') as unknown as El
const all = (node: El): El[] => [node, ...node.children.flatMap((child) => all(child))]

/**
 * Every button in a tree, and whether pressing it reaches anything.
 *
 * Two ways a button can be live, and the second is why this asks about *shape* rather than about
 * labels. A `type="submit"` button carries no listener of its own — the handler sits on the
 * form's `submit` event, which is how a browser wires it and how `hireForm` does. The first
 * draft of this exempted them by matching their text, which flagged `"Put it on the shelf"` the
 * moment a second form existed. Matching a label is matching text and not meaning, which is the
 * mistake this whole file is about.
 */
function buttons(tree: El): { label: string; live: boolean }[] {
  const submits = (node: El): boolean => {
    if (node.type !== 'submit') return false
    for (let at: El | null = node; at !== null; at = at.parent) if (at.listensFor('submit')) return true
    return false
  }
  return all(tree)
    .filter((n) => n.tag === 'button')
    .map((n) => ({ label: n.textContent || '(no label)', live: n.listensFor('click') || submits(n) }))
}

function held(over: Partial<PendingApproval> = {}): PendingApproval {
  return {
    sessionId: 's',
    project: null,
    toolUseId: 't',
    tool: 'Bash',
    input: { command: 'npm test' }, askedAt: '2026-08-27T00:00:00Z', waitMs: 240_000, agent: 'builder',
    ...over,
  }
}

function person(over: Partial<StaffMember> = {}): StaffMember {
  return { id: 'builder', name: 'builder', description: 'x', tools: ['Read'], model: 'sonnet', isManager: false, ...over }
}

function store(over: Partial<MeasuredStore> = {}): MeasuredStore {
  return {
    path: 'memory', what: 'x', kind: 'yours', precious: true, state: 'present',
    bytes: 100, files: 2, unreadable: 0, where: '/w/memory', ...over,
  }
}

/** Every surface the harness can render, drawn with something on it to draw. */
function surfaces(): { name: string; tree: El }[] {
  const noop = () => {}

  const strip = host()
  const activity: ActivityHandlers = { onDecide: noop, onOpen: noop, onUnfinished: noop }
  renderStrip(strip as unknown as HTMLElement, {
    activity: { running: [], history: [] },
    approvals: [held(), held({ toolUseId: 't2' })],
    unfinished: null,
    nowMs: 0,
  }, activity)

  const roster = host()
  const rosterOn: RosterHandlers = {
    onHire: noop, onFire: noop, onBench: noop, onUnbench: noop, onAddSkill: noop, onRemoveSkill: noop,
  }
  const model: RosterModel = {
    staff: [person(), person({ id: 'manager', name: 'manager', isManager: true })],
    staffUnreadable: false,
    benched: ['tester'], shelf: [], skills: [], dangling: new Map(), unreachable: new Map(),
  }
  renderRoster(roster as unknown as HTMLElement, model, rosterOn)

  const privacy = host()
  const report: PrivacyReport = {
    root: '/w',
    stores: [store(), store({ path: '.claude/skills', kind: 'template' })],
    egress: [], lastPrompt: null, unreadSources: [],
  }
  renderPrivacy(privacy as unknown as HTMLElement, report, { onForget: noop } as PrivacyHandlers, null)

  const hire = hireForm({ onSubmit: noop, onCancel: noop } as FormHandlers<HireDraft>) as unknown as El
  const skill = skillForm({ onSubmit: noop, onCancel: noop } as FormHandlers<SkillDraft>) as unknown as El

  return [
    { name: 'the activity strip', tree: strip },
    { name: 'the roster', tree: roster },
    { name: 'the privacy panel', tree: privacy },
    { name: 'the hire form', tree: hire },
    { name: 'the skill form', tree: skill },
  ]
}

test('no view draws a button that nobody is listening to', () => {
  const drawn = surfaces()

  // The control, inside the test. A walker that finds no buttons reports every surface clean,
  // which is exactly what a broken walker looks like.
  const total = drawn.reduce((n, s) => n + buttons(s.tree).length, 0)
  assert.ok(total > 8, `only ${total} buttons found across ${drawn.length} surfaces, so the walker is broken`)

  const dead: string[] = []
  for (const { name, tree } of drawn) {
    for (const { label, live } of buttons(tree)) {
      if (!live) dead.push(`${name}: "${label}"`)
    }
  }

  assert.deepEqual(
    dead,
    [],
    'these buttons are drawn and nothing is listening for a click on them. A control that is ' +
      'drawn, styled and inert looks exactly like a working one — which is how `+ new project` ' +
      'shipped calling a dialog Electron does not have.\n  ' + dead.join('\n  '),
  )
})

test('the check can see a dead button when there is one', () => {
  // The mutation, as a test rather than as a thing somebody remembers to run. Without this, a
  // walker that silently stopped finding listeners would report every surface clean forever.
  const tree = host()
  const dead = document.createElement('button')
  dead.textContent = 'press me'
  tree.appendChild(dead as unknown as El)

  const found = buttons(tree)
  assert.equal(found.length, 1)
  assert.equal(found[0]?.live, false, 'a button with no listener was reported as live')

  dead.addEventListener('click', () => {})
  assert.equal(buttons(tree)[0]?.live, true, 'a button with a listener was reported as dead')
})
