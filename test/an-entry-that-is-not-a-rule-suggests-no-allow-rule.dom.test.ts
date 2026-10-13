/**
 * The transcript draws what `ManagerSession` found about a deny list it read short.
 *
 * The files ride on the result event beside the denials, and `chat-view.ts` passes them to
 * `summariseRefusals`. That one argument is what this pins. Without it the block falls back to the
 * `unlisted` line, which tells somebody to add a rule to `permissions.allow` — and while an entry
 * in a deny list is not a rule, the office asks about the call whether that rule is there or not.
 * The words themselves are pinned in `an-entry-that-is-not-a-rule-suggests-no-allow-rule.test.ts`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { ChatView } from '../src/renderer/chat-view.js'

installDom()

test('the refusal block names the deny list that was read short, and suggests no rule', () => {
  const root = document.createElement('div')
  const view = new ChatView(root, document.createElement('div'))

  view.event(
    {
      kind: 'result',
      isError: false,
      text: null,
      costUsd: null,
      turns: null,
      durationMs: null,
      denials: [{ tool: 'Bash', toolUseId: 't1', detail: 'npm test', cause: 'unlisted' }],
      shortDeny: [{ file: 'settings.json', entries: 1 }],
    },
    'manager',
  )

  const drawn = (root as unknown as El)
    .querySelectorAll('.refusal__advice')
    .map((p) => p.textContent)
    .join(' ')
  assert.match(drawn, /1 entry in \.claude\/settings\.json's permissions\.deny is not a rule/, `the block says: ${drawn}`)
  assert.match(drawn, /will not stop the asking\./, `the block says: ${drawn}`)
  assert.doesNotMatch(drawn, /permissions\.allow there/, `the block says: ${drawn}`)
})
