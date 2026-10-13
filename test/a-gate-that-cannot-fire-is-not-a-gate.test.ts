/**
 * Whether the approval gate would actually hold a shell command — not merely whether the settings
 * file mentions it.
 *
 * ## Why this exists beside the differential test
 *
 * `the-gate-and-the-panel-read-one-tree.test.ts` runs the old `callsTheHook` against the new one
 * over the same inputs and requires identical answers. That is the right instrument for *"did I
 * change behaviour"* and it answers it well. **It structurally cannot find anything both
 * implementations get wrong** — an omission they share is invisible by construction, at 24 shapes
 * or at 2,400.
 *
 * They shared four. Review ran them against the branch's own `gateState`:
 *
 *     wired   matcher Read          — names one tool, and it is not Bash; cannot fire on Bash
 *     wired   matcher Write|Edit    — no Bash anywhere
 *     wired   type prompt           — not a command hook
 *     wired   type agent            — not a command hook
 *
 * One word edited in `settings.json` and the office reported a gate it did not have, with
 * `gateLede` returning `null` so the panel said nothing at all.
 *
 * So this file asks the other question — *is the behaviour right* — and every case states its
 * expected answer rather than comparing two implementations. These are settings somebody could
 * plausibly write.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { gateLede, gateState } from '../src/shared/gate.js'

const HOOK = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/approval-gate.mjs"'

/** A settings file with one `PreToolUse` stanza, as a real one is shaped. */
function settings(stanza: Record<string, unknown>): string {
  return JSON.stringify({ hooks: { PreToolUse: [stanza] } })
}

/** Both halves present, so the answer is about the settings and not about a missing file. */
function judge(text: string): string {
  return gateState({ state: 'present', text }, { state: 'present', text: '#!/usr/bin/env node\n' }).state
}

test('the shipped stanza is wired', () => {
  // The control. Without it every assertion below could pass on a `callsTheHook` that never
  // returns true, which is the failure that matters most here.
  assert.equal(judge(settings({ matcher: '*', hooks: [{ type: 'command', command: HOOK }] })), 'wired')
})

test('a matcher that cannot match Bash is not a gate on shell commands', () => {
  /*
   * A matcher of plain names lists the tools it covers. `Read` gates reads. A gate that never
   * fires on `Bash` is not standing between an unattended agent and an unapproved shell command,
   * and saying "wired" about it tells somebody they are protected when they are not.
   */
  for (const matcher of ['Read', 'Write|Edit', 'Glob', 'WebFetch']) {
    assert.notEqual(
      judge(settings({ matcher, hooks: [{ type: 'command', command: HOOK }] })),
      'wired',
      `a PreToolUse hook matched on ${matcher} was reported as a wired gate`,
    )
  }
})

test('the matcher shapes that do cover shell commands are still wired', () => {
  // The other direction, and the one that decides whether this check can cry wolf. Every one of
  // these legitimately gates `Bash`, and a person running any of them must not be told their gate
  // is missing.
  for (const matcher of ['*', '.*', 'Bash', 'Bash|Edit', '(Bash)', 'Bash.*', '^Bash$']) {
    assert.equal(
      judge(settings({ matcher, hooks: [{ type: 'command', command: HOOK }] })),
      'wired',
      `${matcher} covers Bash and was reported as no gate — this warning cried wolf`,
    )
  }
})

test('a stanza with no matcher covers every tool', () => {
  // Omitting `matcher` is the CLI's "everything", and it is what the shipped settings could
  // legitimately become. `null` here must not be read as "matches nothing".
  assert.equal(judge(settings({ hooks: [{ type: 'command', command: HOOK }] })), 'wired')
})

test('a hook that is not a command hook is not a gate', () => {
  // `declaredIn` already decides this and hands over `unknownType`; it was being discarded. A
  // `prompt` hook does not run the file, so naming the file proves nothing about it.
  for (const type of ['prompt', 'agent', 'anything-else']) {
    assert.notEqual(
      judge(settings({ matcher: '*', hooks: [{ type, command: HOOK }] })),
      'wired',
      `a hook of type ${type} was reported as a wired gate`,
    )
  }
})

test('a matcher nobody can interpret is neither a gate nor the absence of one', () => {
  /*
   * This first returned `wired`, on the reasoning that the warning must never cry wolf — sound as
   * far as it went, and wrong because the choice was never between crying wolf and staying quiet.
   *
   * **`wired` makes `gateLede` return `null`**, so an exotic matcher produced *silence*, and
   * silence on this surface reads as "you are protected". An unparseable matcher does not mean
   * *this fires*; it means *we cannot tell whether this fires*, and `unreadable` is the answer
   * this type already has for that — with wording that does neither: "The approval gate could not
   * be checked, so whether commands are being approved is unknown."
   *
   * Caught in review after the first fix had already been cleared and merged, which is why it is
   * a separate change with its own test rather than a line in the original.
   */
  const verdict = gateState(
    { state: 'present', text: settings({ matcher: '(unclosed', hooks: [{ type: 'command', command: HOOK }] }) },
    { state: 'present', text: '#!/usr/bin/env node\n' },
  )
  assert.equal(verdict.state, 'unreadable', 'an unreadable matcher was collapsed into a confident answer')
  assert.match(
    verdict.state === 'unreadable' ? verdict.cause : '',
    /\(unclosed/,
    'the cause does not name the matcher, so nobody can go and fix it',
  )
  assert.match(gateLede(verdict) ?? '', /could not be checked/, 'the panel says nothing about it')
})

test('a readable gate beside an unreadable one is still a gate', () => {
  // Knowing a gate is there beats not being able to read a second one. Without this, adding an
  // exotic second stanza beside a working gate would turn a confident `wired` into a shrug.
  const two = JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: '(unclosed', hooks: [{ type: 'command', command: HOOK }] },
        { matcher: '*', hooks: [{ type: 'command', command: HOOK }] },
      ],
    },
  })
  assert.equal(judge(two), 'wired')
})

test('naming the file in the wrong event is still not a gate', () => {
  // Held here as well as in the differential test, because it is the discrimination a refactor is
  // most likely to lose and this file states the answer rather than comparing two of them.
  const post = JSON.stringify({ hooks: { PostToolUse: [{ matcher: '*', hooks: [{ command: HOOK }] }] } })
  assert.notEqual(judge(post), 'wired')
})

test('a gate that runs only for writes is not described as never being called', () => {
  /*
   * `gateLede` said "Nothing calls the approval gate" for every `not-wired` state. This file's own
   * table disproves it: with a `Write|Edit` matcher the gate *is* called, on every write and every
   * edit. It is shell commands it never sees, and `couldHoldACommand` judges exactly that, by
   * testing the matcher against `Bash`. The old sentence was true of an absent settings file — the
   * other road to `not-wired` — and said the same thing here.
   *
   * What both roads share is narrower, so the sentence says only that: which file was read, that
   * nothing in it runs the gate *before* a shell command (a `PostToolUse` stanza runs it after), and
   * what that means — this office is never asked. It hedges on the files the office does not read,
   * because a gate declared in one of those would make that conclusion false.
   */
  const verdict = gateState(
    { state: 'present', text: settings({ matcher: 'Write|Edit', hooks: [{ type: 'command', command: HOOK }] }) },
    { state: 'present', text: '#!/usr/bin/env node\n' },
  )
  assert.equal(verdict.state, 'not-wired', 'the precondition moved: this case is no longer not-wired')

  const said = gateLede(verdict) ?? ''
  assert.doesNotMatch(
    said,
    /nothing calls the approval gate/i,
    'the gate runs on every write and edit here, and the office says nothing calls it',
  )
  assert.match(said, /gate (for|before) shell commands/i, 'the sentence no longer says the gate is missing for shell commands')
  assert.match(said, /\.claude\/settings\.json/, 'the sentence no longer says which settings file was read')
  assert.match(said, /the only settings file the office checks/, 'the sentence claims more than readGate read')
  assert.match(said, /Unless another one does/, 'the sentence dropped its hedge on the files the office does not read')
  assert.match(said, /never asked to approve a shell command before it runs/, 'the sentence no longer says what a missing gate means')
})
