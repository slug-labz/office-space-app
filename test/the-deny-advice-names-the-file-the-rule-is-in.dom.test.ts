/**
 * The transcript names the settings file a deny rule is in, as the result carried it.
 *
 * `summariseRefusals` names the file only if the refusals it is handed still carry `deniedIn`.
 * The chat view is the one caller, and nothing else checks that it passes them on whole: a review
 * of #266 measured that a `chat-view.ts` stripping `deniedIn` before the call passed every other
 * test, because the bridge check that would have noticed has to exempt this field (its reader is
 * in `src/shared/`). This is the check that sees it, through the view itself.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { ChatView } from '../src/renderer/chat-view.js'
import type { ClaudeEvent, ToolDenial } from '../src/main/claude/stream.js'

installDom()

const refused = (detail: string, deniedIn?: readonly string[]): ToolDenial => ({
  tool: 'Bash',
  toolUseId: null,
  detail,
  cause: 'denied',
  ...(deniedIn ? { deniedIn } : {}),
})

const finished = (...denials: ToolDenial[]): ClaudeEvent => ({
  kind: 'result',
  isError: false,
  text: 'done',
  costUsd: null,
  turns: null,
  durationMs: null,
  denials,
})

/** What the panel shows after this one event, as text. */
function shown(event: ClaudeEvent): string {
  const root = document.createElement('div')
  const view = new ChatView(root, document.createElement('div'))
  view.event(event, 'manager')
  return (root as unknown as El).textContent ?? ''
}

test('the transcript names the file the result says the deny rule is in', () => {
  const text = shown(finished(refused('rm -rf dist', ['settings.local.json'])))

  assert.match(text, /rm -rf dist/, 'the instrument: the refusal block was drawn')
  assert.ok(
    text.includes('A deny rule in .claude/settings.local.json refuses this outright'),
    `the panel did not name settings.local.json, so what reached the advice lost \`deniedIn\`: ${text}`,
  )
  assert.ok(!text.includes('.claude/settings.json'), `the panel named settings.json, where there is no such rule: ${text}`)
})

test('a result that does not say where gets words true of either file', () => {
  // The control: without `deniedIn` the panel says both files, so the test above can tell the two
  // apart.
  const text = shown(finished(refused('rm -rf dist')))
  assert.ok(
    text.includes('A deny rule in .claude/settings.json or .claude/settings.local.json refuses this outright'),
    text,
  )
})
