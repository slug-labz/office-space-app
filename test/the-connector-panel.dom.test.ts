/**
 * What the connector panel says, and the two things it must never say.
 *
 * **"Connected."** `capabilities.ts` is explicit in its own header: *"a `.mcp.json` server stays
 * inert until a person approves it in Claude Code, which is state this scan does not read. So the
 * type is named for a claim and the UI must say 'configured', never 'connected'."* This panel is
 * the first surface in the app that can *write* one of those entries, which makes it the first
 * place a success message could quietly turn a claim into a fact.
 *
 * **Nothing, where a list of connectors would go.** A survey that failed is not a workspace with
 * no connectors — the fourth standing order, in the panel whose whole subject is what has been
 * configured.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { afterWriting, fieldsFor, renderConnectors } from '../src/renderer/views/connect.js'
import type { CapabilityReport } from '../src/shared/ipc.js'

installDom()

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

function survey(
  servers: CapabilityReport['servers'],
  sources: CapabilityReport['sources'] = [],
  problems: readonly { kind: string; path: string; cause: string }[] = [],
): CapabilityReport {
  return { staff: [], servers, sources, problems } as unknown as CapabilityReport
}

function drawn(
  report: CapabilityReport | null,
  ours: readonly string[] = [],
): { text: string; buttons: El[]; tones: string[] } {
  const host = document.createElement('div') as unknown as El
  renderConnectors(host as unknown as HTMLElement, report, ours, () => {})
  const nodes = all(host)
  return {
    text: nodes.map((n) => n.textContent ?? '').join(' '),
    buttons: nodes.filter((n) => n.tag === 'button'),
    tones: nodes
      .map((n) => n.className ?? '')
      .filter((c) => c.includes('conn__state--'))
      .map((c) => c.split(' ').pop() ?? ''),
  }
}

const configured = { name: 'postgres', transport: 'stdio', scope: 'project', status: 'configured' }
const live = { name: 'graphiti-memory', transport: 'http', scope: 'user', status: 'connected' }
const failed = { name: 'slack', transport: 'sse', scope: 'user', status: 'failed' }

/*
 * The word the rest of the module is built to avoid.
 *
 * A server that is written down and a server that answered are different claims, and the default
 * status is the first one. Nothing about a `configured` row may read as the second.
 */
test('a configured server is not described as connected, and does not look like a success', () => {
  const { text, tones } = drawn(survey([configured]))
  assert.match(text, /configured/)
  assert.match(text, /not yet answered/, 'the claim, spelled out')
  assert.doesNotMatch(text, /\bconnected\b/i)
  assert.deepEqual(tones, ['conn__state--configured'])
})

test('the three states are three sentences and three tones', () => {
  const { tones } = drawn(survey([configured, live, failed]))
  assert.deepEqual(tones, ['conn__state--configured', 'conn__state--live', 'conn__state--failed'])
  assert.equal(new Set(tones).size, 3)

  const said = [configured, live, failed].map((s) => drawn(survey([s])).text)
  assert.equal(new Set(said).size, 3)
  assert.match(said[1] ?? '', /answering/, 'one that did answer says so')
  assert.match(said[2] ?? '', /did not answer/, 'and one that was tried and did not')
})

/*
 * The list is wider than the button. Every server the survey found is shown, because that is what
 * makes it an honest answer to *what can the staff reach* — but only the ones this workspace
 * declares can be removed from here.
 */
test('only servers this workspace declares get a remove control, and the rest say why not', () => {
  const { buttons, text } = drawn(survey([configured, live]), ['postgres'])
  assert.equal(buttons.length, 1)
  assert.match(buttons[0]?.textContent ?? '', /Remove postgres/)
  assert.match(text, /Declared outside this workspace/)
  assert.match(text, /not this office’s to remove/)
  assert.match(text, /graphiti-memory/, 'and it is still listed — visible is not the same as removable')
})

test('a survey that could not be read is not a workspace with no connectors', () => {
  const { text, buttons } = drawn(null)
  assert.match(text, /could not be read/)
  assert.doesNotMatch(text, /No services are connected/, 'never the sentence for an empty one')
  assert.equal(buttons.length, 0)
})

test('a workspace with genuinely none says so, and says where one would go', () => {
  const { text } = drawn(survey([]))
  assert.match(text, /No services are connected/)
  assert.match(text, /\.mcp\.json/)
})

test('the form asks for a command or a URL, never both', () => {
  assert.deepEqual(fieldsFor('stdio'), { stdio: true, url: false })
  assert.deepEqual(fieldsFor('http'), { stdio: false, url: true })
  assert.deepEqual(fieldsFor('sse'), { stdio: false, url: true })
})

/*
 * The sentence after a successful write.
 *
 * It is the moment a form usually says "Connected!" — and that would be a past-tense verb about
 * something nobody has established. It also has to leave the person holding the part they still
 * have to do, rather than ending on a word that reads as finished.
 */
test('a successful write reports what happened and what has not', () => {
  const said = afterWriting('slack', '.mcp.json', ['SLACK_BOT_TOKEN'])
  assert.match(said, /written into \.mcp\.json/)
  assert.match(said, /Nothing is connected yet/)
  assert.match(said, /approve/)
  assert.match(said, /Set SLACK_BOT_TOKEN in your environment/, 'the part still to do')
  assert.match(said, /wrote the name and never the value/)
})

test('a service needing no variables is not told to set none', () => {
  const said = afterWriting('local-thing', '.mcp.json', [])
  assert.doesNotMatch(said, /Set  in your environment/)
  assert.doesNotMatch(said, /environment —/)
  assert.match(said, /Nothing is connected yet/, 'but still never claims a connection')
})

/*
 * Found by opening this panel on a workspace whose `.mcp.json` was one line of broken JSON.
 *
 * The list showed a single machine-wide server, looked complete, and said nothing at all. The
 * survey had the answer the whole time — `sources` marks the file `unreadable` and `problems`
 * carries the parse error — and the panel whose entire subject is that file read neither. The
 * fourth standing order, broken in the place it is easiest to break it.
 */
test('a config that would not open is named, above a list that is short because of it', () => {
  const { text } = drawn(
    survey(
      [live],
      [
        { path: '/w/.mcp.json', state: 'unreadable' },
        { path: '/w/.claude/settings.json', state: 'ok' },
        { path: '/w/.claude/settings.local.json', state: 'missing' },
      ],
      [{ kind: 'unreadable-file', path: '/w/.mcp.json', cause: "not readable JSON: Unexpected token 'o'" }],
    ),
  )
  assert.match(text, /\/w\/\.mcp\.json could not be read/)
  assert.match(text, /missing from this list/, 'and what that costs the list under it')
  assert.match(text, /Unexpected token/, 'with the cause, which is what sends somebody to the file')
  assert.match(text, /graphiti-memory/, 'the servers that were read are still shown — the list is short, not wrong')
})

test('a config that is merely absent is not reported as a failure', () => {
  const { text } = drawn(survey([live], [{ path: '/w/.mcp.json', state: 'missing' }]))
  assert.doesNotMatch(text, /could not be read/, 'a workspace that has configured nothing has configured nothing')
})

test('an unreadable config with no readable servers does not read as an empty office', () => {
  const { text } = drawn(
    survey([], [{ path: '/w/.mcp.json', state: 'unreadable' }], [{ kind: 'unreadable-file', path: '/w/.mcp.json', cause: 'bad JSON' }]),
  )
  assert.match(text, /could not be read/)
  assert.match(text, /Nothing readable is connected/)
  assert.doesNotMatch(text, /^No services are connected/m, 'that sentence is for a workspace we actually read')
  assert.match(text, /will refuse while it cannot be parsed/, 'and says what adding one would do')
})
