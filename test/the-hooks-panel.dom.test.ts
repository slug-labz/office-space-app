/**
 * What the hooks panel says, and the four things it must never say.
 *
 * The panel's whole job is keeping apart four answers that a careless renderer collapses into
 * two. So these tests are about what does **not** appear:
 *
 *   **"Never run", about a directory nobody could open.** An unreadable `.claude/hooks/` produces
 *   no file list at all; a panel that printed the inert heading anyway would be claiming a fact
 *   about a directory it could not read.
 *
 *   **A missing file, where the answer is "we could not look".** `file-missing` says a gate is
 *   gone. `unknown` says we could not tell. Rendering them alike is the bug this repository has
 *   found in the roster, in the campus, and in the memory panel — three times before this one.
 *
 *   **"No hooks", about settings that would not parse.** Claude Code ignores an invalid settings
 *   file silently. A panel repeating that silence is the second thing keeping the secret.
 *
 *   **A precedence order between settings files.** It was not measured, so it is not stated —
 *   and the sentence that admits it only appears when more than one file actually registered
 *   something, because a warning about an ambiguity that cannot arise is noise.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { renderHooks } from '../src/renderer/views/hooks.js'
import { buildReport, type HookFile, type HookSource, type Registration } from '../src/shared/hooks.js'

installDom()

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

const GATE = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/approval-gate.mjs"'

function registration(over: Partial<Registration> = {}): Registration {
  return {
    event: 'PreToolUse',
    matcher: 'Bash',
    command: GATE,
    timeoutSeconds: 300,
    unknownType: null,
    scope: 'project',
    path: '.claude/settings.json',
    ...over,
  }
}

function source(over: Partial<HookSource> = {}): HookSource {
  return { path: '.claude/settings.json', scope: 'project', state: 'ok', cause: null, registrations: 1, ...over }
}

const gateFile: HookFile = { name: 'approval-gate.mjs', origin: 'shipped' }

function drawn(report: Parameters<typeof renderHooks>[1]): { text: string; classes: string[] } {
  const host = document.createElement('div') as unknown as El
  renderHooks(host as unknown as HTMLElement, report)
  const nodes = all(host)
  return {
    text: nodes.map((n) => n.textContent ?? '').join(' '),
    classes: nodes.map((n) => n.className ?? '').filter((c) => c.includes('hookcard--')),
  }
}

test('a wired gate says what runs and who put it there', () => {
  const report = buildReport([registration()], [gateFile], null, [source()])
  const { text, classes } = drawn(report)

  assert.match(text, /approval-gate\.mjs/)
  assert.match(text, /the office put it there, and it is unchanged/)
  assert.ok(classes.some((c) => c.includes('hookcard--wired')))
  // The reassuring row must not carry any of the alarming language.
  assert.doesNotMatch(text, /will fail/)
  assert.doesNotMatch(text, /could not/)
})

test('a missing file and an unchecked one do not render alike', () => {
  const missing = drawn(buildReport([registration()], [], null, [source()]))
  const unchecked = drawn(buildReport([registration()], null, 'EACCES', [source()]))

  assert.match(missing.text, /is not there\. It will fail every time it fires/)
  assert.match(unchecked.text, /could not be checked/)

  // The distinction that three other panels in this app got wrong first.
  assert.notEqual(missing.text, unchecked.text)
  assert.doesNotMatch(unchecked.text, /is not there/)
  assert.ok(missing.classes.some((c) => c.includes('hookcard--file-missing')))
  assert.ok(unchecked.classes.some((c) => c.includes('hookcard--unknown')))
})

test('an unreadable directory never draws the "never run" heading', () => {
  const { text } = drawn(buildReport([registration()], null, 'EACCES: permission denied', [source()]))

  assert.match(text, /could not be opened/)
  // There is no file list, so there is nothing that can be said to be unregistered.
  assert.doesNotMatch(text, /never run/i)
})

test('a file nothing registers is named, and said to be a file rather than a hook', () => {
  const inert: HookFile = { name: 'format-on-save.mjs', origin: 'yours' }
  const { text } = drawn(buildReport([], [inert], null, [source({ registrations: 0 })]))

  assert.match(text, /format-on-save\.mjs/)
  assert.match(text, /Never run/)
  assert.match(text, /A hook file is a claim that something is gated; an unregistered one is a file/)
})

test('settings that will not parse never produce the sentence a clean workspace gets', () => {
  const bad = source({ state: 'unparsable', cause: 'Unexpected token }', registrations: 0 })
  const { text } = drawn(buildReport([], [], null, [bad]))

  assert.match(text, /not valid JSON/)
  assert.match(text, /Claude Code ignores it silently/)
  // The sentence reserved for a workspace we actually read all of.
  assert.doesNotMatch(text, /No hook is registered in this workspace/)
})

test('a workspace with genuinely nothing says so plainly', () => {
  const { text } = drawn(buildReport([], [], null, [source({ registrations: 0 })]))

  assert.match(text, /No hook is registered in this workspace/)
  assert.doesNotMatch(text, /could not/)
})

test('precedence is left unstated, and only mentioned when two files actually register', () => {
  const one = drawn(buildReport([registration()], [gateFile], null, [source()]))
  assert.doesNotMatch(one.text, /precedence/)

  const two = drawn(
    buildReport(
      [registration(), registration({ scope: 'user', path: '~/.claude/settings.json' })],
      [gateFile],
      null,
      [source(), source({ path: '~/.claude/settings.json', scope: 'user' })],
    ),
  )
  assert.match(two.text, /has not been established here, so this panel does not say/)
})

test('an unrecognised event is drawn as unrecognised rather than dropped or explained', () => {
  const { text } = drawn(
    buildReport([registration({ event: 'SomethingNew', matcher: null })], [gateFile], null, [source()]),
  )

  assert.match(text, /SomethingNew/)
  assert.match(text, /an event this app does not recognise/)
  // And no invented claim about when it fires or what it matches.
  assert.doesNotMatch(text, /every time it fires/)
})

test('every settings file consulted is listed, including the ones that were not there', () => {
  const { text } = drawn(
    buildReport([], [], null, [
      source({ registrations: 0 }),
      source({ path: '.claude/settings.local.json', scope: 'local', state: 'missing', registrations: 0 }),
      source({ path: '~/.claude/settings.json', scope: 'user', state: 'missing', registrations: 0 }),
    ]),
  )

  // Answering "did you look in my local settings?" rather than leaving it to be inferred.
  assert.match(text, /settings\.local\.json — not there/)
  assert.match(text, /~\/\.claude\/settings\.json — not there/)
})
