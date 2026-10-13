/**
 * The approval card for a request whose time will not read, drawn the way the strip draws it.
 *
 * The rules are in `a-request-time-that-will-not-read-is-not-a-deadline.test.ts`. This is the one
 * place they reach a person: `renderStrip` puts `aboutTheClock`'s sentence on the card
 * (`views/activity.ts`). On dev at e6fe5cb, a request stamped `'1'` drew a card saying it had been
 * refused when nobody answered, while the gate could still be holding it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderStrip, type ActivityHandlers, type StripModel } from '../src/renderer/views/activity.js'
import { installDom, type El } from './dom.js'
import type { PendingApproval } from '../src/shared/ipc.js'

installDom()

const NOW = Date.parse('2026-08-26T21:00:05Z')
const FOUR_MINUTES = 240_000

test('the card for a request stamped "1" does not say it was refused', () => {
  const request: PendingApproval = {
    sessionId: 's-1',
    project: null,
    toolUseId: 't-1',
    tool: 'Bash',
    input: { command: 'npm run build' },
    askedAt: '1',
    waitMs: FOUR_MINUTES,
    agent: 'builder',
  }
  const model: StripModel = { activity: { running: [], history: [] }, approvals: [request], unfinished: null, nowMs: NOW }
  const quiet: ActivityHandlers = { onDecide: () => {}, onOpen: () => {}, onUnfinished: () => {} }
  const host = document.createElement('div') as unknown as El
  renderStrip(host as unknown as HTMLElement, model, quiet)

  const all = (node: El): El[] => [node, ...node.children.flatMap((child) => all(child))]
  const shown = all(host)
    .map((n) => n.textContent)
    .join('\n')
  assert.match(shown, /builder is waiting on you/, 'the card was not drawn')
  assert.doesNotMatch(shown, /refused when nobody answered/, 'the card said a held call had been refused')
  assert.match(shown, /could not be read/, 'the card does not say why it cannot count down')
})
