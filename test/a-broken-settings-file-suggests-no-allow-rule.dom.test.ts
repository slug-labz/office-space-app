/**
 * The transcript draws what `ManagerSession` found about a settings file it could not use.
 *
 * The file names ride on the result event beside the denials, and `chat-view.ts` passes them to
 * `summariseRefusals`. That one line is what this pins. Without it the block falls back to the
 * advice for a cause nobody established, which points at `permissions.allow` in the very file
 * that could not be used. The words themselves are pinned in
 * `a-broken-settings-file-suggests-no-allow-rule.test.ts`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { ChatView } from '../src/renderer/chat-view.js'

installDom()

test('the refusal block names the settings file that could not be used, and suggests no rule', () => {
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
      denials: [{ tool: 'Bash', toolUseId: 't1', detail: 'npm test', cause: 'unknown' }],
      unusable: [{ file: 'settings.json', why: 'Its top level is null, not an object.' }],
    },
    'manager',
  )

  const drawn = (root as unknown as El)
    .querySelectorAll('.refusal__advice')
    .map((p) => p.textContent)
    .join(' ')
  assert.match(drawn, /could not use \.claude\/settings\.json/, `the block says: ${drawn}`)
  assert.match(drawn, /Its top level is null, not an object\./, `the block says: ${drawn}`)
  assert.doesNotMatch(drawn, /permissions\.allow/, `the block says: ${drawn}`)
})
