/**
 * Telling what the office said from what you said.
 *
 * Every message to a manager is prefixed with the project and the roster, because the manager
 * cannot see the tab bar and its own instructions promise that block each turn. But it is the
 * office talking, not you — and a restored conversation that renders it as your message is the
 * office putting several hundred words of roster in your mouth, in its own chat panel.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MESSAGE_HEADING, stripOfficeContext, withOfficeContext } from '../src/shared/office-context.js'

test('the context goes in front and the message stays last', () => {
  const sent = withOfficeContext(['## CURRENT PROJECT\n\nbilling', '## CURRENT STAFF\n\n- reviewer'], 'fix the auth bug')

  assert.match(sent, /^## CURRENT PROJECT/)
  assert.match(sent, /## CURRENT STAFF/)
  assert.ok(sent.endsWith('fix the auth bug'))
  assert.ok(sent.includes(MESSAGE_HEADING))
})

test('what you said comes back out again', () => {
  const sent = withOfficeContext(['## CURRENT PROJECT\n\nbilling'], 'fix the auth bug')

  assert.equal(stripOfficeContext(sent), 'fix the auth bug')
})

test('a message with blank lines and headings of its own survives the round trip', () => {
  const message = 'Do these:\n\n## Step one\n\nread the file\n\n## Step two\n\nfix it'
  const sent = withOfficeContext(['## CURRENT STAFF\n\n- reviewer'], message)

  assert.equal(stripOfficeContext(sent), message)
})

test('a message that itself contains the marker keeps everything after the last one', () => {
  // Somebody pasting a previous turn back in. The office's own marker is the outermost, and
  // the last one is the real boundary.
  const message = `quoting you:\n\n${MESSAGE_HEADING}\n\nthe inner bit`
  const sent = withOfficeContext(['## CURRENT PROJECT\n\nbilling'], message)

  assert.equal(stripOfficeContext(sent), 'the inner bit')
})

test('a turn with no marker is left exactly alone', () => {
  // Sent before the office added context, or by something that is not this app. Guessing which
  // part was "really" the message would be worse than showing all of it.
  const plain = 'just a message, typed into a terminal'

  assert.equal(stripOfficeContext(plain), plain)
})

test('an empty message still round-trips to empty', () => {
  assert.equal(stripOfficeContext(withOfficeContext(['## CURRENT STAFF\n\nNobody.'], '')), '')
})

// ─────────────────────────────────────────── the office's own earlier format ──

test('a turn from before the marker existed still gives up the message', () => {
  // Recognising a shape this app wrote is not guessing at somebody's text. Without it, every
  // conversation recorded before today opens with a wall of roster attributed to the reader.
  const legacy = [
    '## CURRENT PROJECT',
    '',
    'random — `projects/random/`',
    '',
    'Keep its plan, progress log and task list current; the office floor reads them.',
    '',
    '## CURRENT STAFF',
    '',
    '- backend — Builds services. (tools: Read, Write)\n- reviewer — Reads changes. (tools: Read)',
    '',
    'make a web page that says coming soon',
  ].join('\n')

  assert.equal(stripOfficeContext(legacy), 'make a web page that says coming soon')
})

test('a legacy turn whose message has paragraphs keeps all of them', () => {
  const legacy = `## CURRENT STAFF\n\n- reviewer — Reads changes.\n\nfirst paragraph\n\nsecond paragraph`

  assert.equal(stripOfficeContext(legacy), 'first paragraph\n\nsecond paragraph')
})

test('a message that merely mentions the roster heading is not mistaken for one', () => {
  // It does not start with the office's blocks, so it is somebody's text and stays whole.
  const typed = 'why does ## CURRENT STAFF keep showing up in my transcript?'

  assert.equal(stripOfficeContext(typed), typed)
})
