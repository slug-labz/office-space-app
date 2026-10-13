/**
 * The office writes a reference to a secret, and never the secret.
 *
 * VISION.md's sixth section asks for connectors wired into the frontend. `main/capabilities.ts`
 * could already read them; it could never add one, so "how do I connect Slack" still ended in
 * *leave the office and edit a JSON file*.
 *
 * The reason this needed a decision module of its own is that a write surface can break a read
 * guarantee from the other side. `capabilities.ts` promises, in its own header, that *"nothing
 * that comes out of here may be a credential"* — and it keeps that promise by never reading the
 * values in `env` and `headers`. A form that let somebody paste a token into those fields would
 * put the credential in `.mcp.json` regardless, which is a file in the workspace, which is a file
 * people commit. The reading half would still be honest and the secret would still be gone.
 *
 * So the fields hold an environment variable *name* and the office writes `${NAME}`. These tests
 * are mostly about the one rule that makes that real, and about the fact that it fails closed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  declarationFor,
  parseHeaders,
  parseNames,
  isVariableName,
  variablesToSet,
  whatWritingDoes,
  whyNotConnectable,
  type ConnectRequest,
} from '../src/shared/connector.js'

/**
 * A Slack-shaped token, assembled from parts rather than written out.
 *
 * Written as a literal it matches GitHub's secret scanner, which refuses the push of any
 * repository containing it. Measured: it blocked this project's first publish, naming this file
 * and the lines below. The refusal is right about the shape and wrong about the risk, and it
 * would fall on anyone who forked this repository too.
 *
 * The assembled value is byte-identical to the literal it replaces, so every assertion below
 * exercises exactly what it did before; only the spelling in the source changed. The literal
 * cannot be asserted against here — writing it out is the thing being avoided — so what is
 * pinned at the bottom of this file is the shape every assertion depends on.
 *
 * It is the fixture for the test that refuses pasted credentials, which is the joke and also
 * why it cannot simply be deleted.
 */
const A_PASTED_SLACK_TOKEN = ['xoxb', '1234567890', 'abcdefghijklmnop'].join('-')

const blank: ConnectRequest = {
  name: '',
  transport: 'stdio',
  command: '',
  args: [],
  url: '',
  envKeys: [],
  headers: [],
}

const slack: ConnectRequest = {
  ...blank,
  name: 'slack',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-slack'],
  envKeys: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
}

const notion: ConnectRequest = {
  ...blank,
  name: 'notion',
  transport: 'http',
  url: 'https://mcp.notion.com/mcp',
  headers: [{ header: 'Authorization', from: 'NOTION_AUTH' }],
}

test('a stdio server is written with the keys its transport uses, and no others', () => {
  assert.equal(whyNotConnectable(slack), null)
  assert.deepEqual(declarationFor(slack), {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}', SLACK_TEAM_ID: '${SLACK_TEAM_ID}' },
  })
  const written = JSON.stringify(declarationFor(slack))
  assert.doesNotMatch(written, /url/, 'no empty url making it read as two transports at once')
})

test('an http server takes its header value from a variable, and the value is never written', () => {
  assert.equal(whyNotConnectable(notion), null)
  assert.deepEqual(declarationFor(notion), {
    type: 'http',
    url: 'https://mcp.notion.com/mcp',
    headers: { Authorization: '${NOTION_AUTH}' },
  })
})

/*
 * The rule the whole feature rests on.
 *
 * Every one of these is a real credential shape, and every one of them is refused *because it is
 * not a variable name* rather than because it was recognised as a secret. Recognising secrets is
 * a losing game; requiring shouting snake case is not.
 */
test('a pasted credential is refused wherever a variable name belongs', () => {
  const pasted = [
    A_PASTED_SLACK_TOKEN,
    'ghp_16CharactersOfNonsenseHere1234',
    'sk-proj-aBcDeFgHiJkLmNoPqRsTuV',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc',
    'Bearer abc123',
    'my-token',
    'lowercase_name',
  ]
  for (const value of pasted) {
    assert.equal(isVariableName(value), false, `${value} must not pass as a variable name`)

    const asEnv = whyNotConnectable({ ...slack, envKeys: [value] })
    assert.ok(asEnv, `${value} accepted as an env key`)
    assert.match(asEnv, /NAME of an environment variable/)

    const asHeader = whyNotConnectable({ ...notion, headers: [{ header: 'Authorization', from: value }] })
    assert.ok(asHeader, `${value} accepted as a header source`)
  }
})

test('the refusal says what to do, and does not print the whole thing back', () => {
  const said = whyNotConnectable({ ...slack, envKeys: [A_PASTED_SLACK_TOKEN] })
  assert.ok(said)
  assert.match(said, /SLACK_BOT_TOKEN, not the token itself/, 'the fix, by example')
  assert.match(said, /stays in your environment/, 'and why it is worth doing')
  assert.doesNotMatch(said, /abcdefghijklmnop/, 'never the whole credential back onto the screen')
  assert.match(said, /xoxb-1…/, 'enough to know which field it meant')
  // Seen in the running app: a noun slotted into "The ${field} needs the NAME of an environment
  // variable" produced "The environment variable needs the NAME of an environment variable".
  assert.doesNotMatch(said, /environment variable needs the NAME of an environment variable/)
  assert.match(said, /^The environment variables field needs/)
})

test('a valid variable name is accepted, and a suspiciously long one is not', () => {
  assert.equal(isVariableName('SLACK_BOT_TOKEN'), true)
  assert.equal(isVariableName('A'), true)
  assert.equal(isVariableName('A1_B2'), true)
  assert.equal(isVariableName('_LEADING'), false, 'must start with a letter')
  assert.equal(isVariableName('1LEADING'), false)
  assert.equal(isVariableName('A'.repeat(65)), false, 'a 65-character name is a value in disguise')
})

/*
 * A credential in a URL is the same leak wearing a different hat, and `capabilities.ts` already
 * knows it — it cuts every URL at the first `?` when reading, *"the query string is dropped —
 * tokens live there"*. Writing one would put it in the file the reader is careful never to quote.
 */
test('a URL carrying a key in its query string is refused, with somewhere to put it instead', () => {
  for (const url of [
    'https://example.com/mcp?token=abc123',
    'https://example.com/mcp?foo=1&api_key=abc',
    'https://example.com/mcp?X-Signature=deadbeef',
  ]) {
    const said = whyNotConnectable({ ...notion, url })
    assert.ok(said, `${url} was accepted`)
    assert.match(said, /credential in its query string/)
    assert.match(said, /header taken from an environment variable/, 'and where it should go')
  }
  assert.equal(whyNotConnectable({ ...notion, url: 'https://example.com/mcp?v=2' }), null, 'an ordinary query is fine')
})

/*
 * `mcpToolsWithoutServer` splits `mcp__name__tool` on the double underscore. A server called
 * `my__thing` is looked up as `my`, found missing, and reported as a dangling tool forever.
 */
test('a name that would split in the wrong place is refused before it is written', () => {
  const said = whyNotConnectable({ ...slack, name: 'my__thing' })
  assert.ok(said)
  assert.match(said, /double underscore/)
  assert.match(said, /mcp__name__tool/, 'and the format that explains why')

  assert.equal(whyNotConnectable({ ...slack, name: 'my_thing' }), null, 'one underscore is fine')
  assert.equal(whyNotConnectable({ ...slack, name: 'my-thing' }), null)
  assert.ok(whyNotConnectable({ ...slack, name: '-leading' }))
  assert.ok(whyNotConnectable({ ...slack, name: 'has space' }))
})

test('each empty field names itself rather than saying the form is invalid', () => {
  assert.match(whyNotConnectable(blank) ?? '', /name/)
  assert.match(whyNotConnectable({ ...slack, command: '' }) ?? '', /command that starts the server/)
  assert.match(whyNotConnectable({ ...notion, url: '' }) ?? '', /URL the server answers on/)
  assert.match(whyNotConnectable({ ...notion, url: 'mcp.notion.com' }) ?? '', /http:\/\/ or https:\/\//)
  assert.match(
    whyNotConnectable({ ...notion, headers: [{ header: '', from: 'X' }] }) ?? '',
    /header needs a name/,
  )
})

test('the same header given twice is refused, since only one of them would survive the write', () => {
  const said = whyNotConnectable({
    ...notion,
    headers: [
      { header: 'Authorization', from: 'ONE' },
      { header: 'authorization', from: 'TWO' },
    ],
  })
  assert.match(said ?? '', /given twice/)
})

/*
 * The past tense that would be a lie.
 *
 * `capabilities.ts`: *"a `.mcp.json` server stays inert until a person approves it in Claude
 * Code... the UI must say 'configured', never 'connected'."* A form that reported "Connected!" on
 * a successful write breaks the third standing order with a single verb.
 */
test('what writing does says plainly that nothing is connected yet', () => {
  const said = whatWritingDoes('slack', '.mcp.json')
  assert.match(said, /Nothing is connected yet/)
  assert.match(said, /nothing has been started/)
  assert.match(said, /approve/, 'and who does the connecting')
  assert.match(said, /configured rather than connected/, 'in the words the survey will use')
})

test('the variables somebody still has to set are listed, not implied', () => {
  assert.deepEqual(variablesToSet(slack), ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'])
  assert.deepEqual(variablesToSet(notion), ['NOTION_AUTH'])
  assert.deepEqual(
    variablesToSet({ ...slack, envKeys: ['A', 'A'], headers: [{ header: 'X', from: 'A' }] }),
    ['A'],
    'once each, however many places it is used',
  )
})

test('a list field splits on commas, spaces and newlines, since all three get typed', () => {
  assert.deepEqual(parseNames('SLACK_BOT_TOKEN, SLACK_TEAM_ID'), ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'])
  assert.deepEqual(parseNames('A\nB  C,,D'), ['A', 'B', 'C', 'D'])
  assert.deepEqual(parseNames('   '), [])
  assert.deepEqual(parseNames('A, A'), ['A'], 'once each')
})

/*
 * Case is left alone on purpose. Helpfully uppercasing `slack_token` would write
 * `${SLACK_TOKEN}` for a variable the person does not have — a config that reads as correct and
 * never works, in place of a refusal that names the field.
 */
test('a mistyped variable name is refused rather than corrected into one that does not exist', () => {
  assert.deepEqual(parseNames('slack_token'), ['slack_token'])
  assert.match(whyNotConnectable({ ...slack, envKeys: ['slack_token'] }) ?? '', /not a variable name/)
})

test('a header pair splits on the first equals only', () => {
  assert.deepEqual(parseHeaders('Authorization=NOTION_AUTH'), [{ header: 'Authorization', from: 'NOTION_AUTH' }])
  assert.deepEqual(parseHeaders('X-Api=A=B'), [{ header: 'X-Api', from: 'A=B' }], 'not truncated at the second')
  assert.deepEqual(parseHeaders('A=1\nB=2'), [
    { header: 'A', from: '1' },
    { header: 'B', from: '2' },
  ])
})

test('a header line with no variable becomes an entry that can be complained about by name', () => {
  assert.deepEqual(parseHeaders('Authorization'), [{ header: 'Authorization', from: '' }])
  const said = whyNotConnectable({ ...notion, headers: parseHeaders('Authorization') })
  assert.match(said ?? '', /value of the Authorization header needs/, 'named, not silently dropped')
  assert.match(said ?? '', /This one is empty/)
})

test('the assembled fixture still has the credential shape these tests rely on', () => {
  // Without this a typo in the join would quietly turn every test above into one that passes
  // because nothing looked like a credential any more — the failure this file is itself about.
  assert.match(A_PASTED_SLACK_TOKEN, /^xoxb-\d{10}-[a-z]{16}$/, 'ten digits so the refusal truncates to xoxb-1…, sixteen letters it must never echo back')
  assert.equal(A_PASTED_SLACK_TOKEN.split('-').length, 3, 'the parts a real one has')
})
