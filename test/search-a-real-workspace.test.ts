/**
 * Searching a workspace on disk, and the one behaviour that cannot be tested in memory.
 *
 * `search.test.ts` covers the decisions against strings. This covers the half that only a real
 * filesystem can show: that a source which *fails to open* arrives as `blind` rather than as a
 * shorter list of results.
 *
 * That distinction is the whole feature. A person searching for a decision they half-remember,
 * seeing "nothing matches", and not being told that `memory/` could not be opened will conclude
 * it was never written down.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'

import { searchWorkspace, CONVERSATION_LIMIT } from '../src/main/search.js'
import { encodeCwd } from '../src/main/transcript-store.js'
import { summarise, whatWasNotSearched } from '../src/shared/search.js'

import { tempDir } from './temp-dir.js'

/** A workspace with one memory, one project document and one dispatch. */
async function office(t: TestContext): Promise<string> {
  const root = await tempDir(t, 'office-search-')
  await mkdir(join(root, 'memory'), { recursive: true })
  await mkdir(join(root, 'projects', 'greeter'), { recursive: true })
  await mkdir(join(root, '.office-space'), { recursive: true })

  await writeFile(
    join(root, 'memory', 'why-backoff.md'),
    '---\nname: why-backoff\ndescription: the retry decision\n---\n\nWe chose retry-with-backoff over a fixed delay.\n',
    'utf8',
  )
  await writeFile(join(root, 'projects', 'greeter', 'PLAN.md'), '# greeter\n\nAdd a retry helper.\n', 'utf8')
  await writeFile(
    join(root, '.office-space', 'dispatches.jsonl'),
    `${JSON.stringify({
      line: 'sent',
      id: 'toolu_a',
      sessionId: 's',
      project: 'greeter',
      employee: 'builder',
      brief: 'Add retry-with-backoff to the fetch helper.',
      verify: null,
      sentAt: '2026-09-03T09:00:00.000Z',
    })}\n`,
    'utf8',
  )
  return root
}

test('a search reads memory, projects and the ledger, and says which it read', async (t) => {
  const root = await office(t)
  const found = await searchWorkspace(root, 'backoff')

  assert.deepEqual(
    [...found.hits.map((h) => h.source)].sort(),
    ['dispatch', 'memory'],
    'a term in a memory and in a dispatch brief was not found in both',
  )
  assert.equal(found.blind.length, 0, `unexpected blind sources: ${JSON.stringify(found.blind)}`)
  // `looked` is what makes "nothing found" trustworthy, so it has to be populated.
  assert.ok(found.looked.includes('memory') && found.looked.includes('project'))
})

test('a directory that will not open is blind, not empty — and the sentence changes', async (t) => {
  /*
   * The one this module exists for, and it cannot be faked in memory: a real `chmod 000` on a
   * real directory.
   *
   * Both halves are asserted. Reporting `blind` and then still saying "nothing matches" would
   * leave the person exactly where they started.
   */
  const root = await office(t)
  await chmod(join(root, 'memory'), 0o000)
  try {
    const found = await searchWorkspace(root, 'backoff')

    assert.equal(found.blind.some((b) => b.source === 'memory'), true, 'an unreadable memory directory was not reported')
    assert.equal(found.looked.includes('memory'), false, 'memory was listed as searched when it could not be opened')
    assert.match(whatWasNotSearched(found) ?? '', /did not search memory/)

    // And the same with a term that matches nothing, which is where the lie would land.
    const nothing = await searchWorkspace(root, 'somethingnobodywrote')
    assert.match(summarise(nothing, 'somethingnobodywrote'), /could be read/)
    assert.doesNotMatch(summarise(nothing, 'somethingnobodywrote'), /Nothing in this workspace matches/)
  } finally {
    await chmod(join(root, 'memory'), 0o755)
  }
})

test('a workspace read completely, with no match, gives a real answer', async (t) => {
  // The other side of the same line. An office that genuinely holds nothing on a topic should say
  // so plainly rather than hedging — a permanent caveat is how a real one stops being read.
  const root = await office(t)
  const found = await searchWorkspace(root, 'somethingnobodywrote')
  assert.equal(found.hits.length, 0)
  assert.equal(found.blind.length, 0)
  assert.match(summarise(found, 'somethingnobodywrote'), /Nothing in this workspace matches/)
})

test('an empty query reads nothing at all rather than everything', async (t) => {
  /*
   * Not only that it returns no hits — that it does no reading. A search box is typed into one
   * character at a time, and walking every transcript on the first keystroke is the difference
   * between a feature and one somebody turns off.
   */
  const root = await office(t)
  const found = await searchWorkspace(root, '   ')
  assert.deepEqual(found.hits, [])
  assert.deepEqual(found.looked, [], 'an empty query still read the workspace')
})

test('a conversation with torn records is searched, and says it was searched incompletely', async (t) => {
  /*
   * The guard that survived its first mutation, because the fixture above holds no conversations.
   *
   * `parseTranscript` counts records it could not use rather than dropping them silently, so a
   * conversation with torn lines has been searched *incompletely* — and reporting "no matches
   * there" would be a claim about text nobody read. Same rule as an unreadable directory, one
   * level further in.
   */
  const root = await office(t)
  const home = await tempDir(t, 'office-home-')

  const cwd = join(root, 'projects', 'greeter')
  const dir = join(home, '.claude', 'projects', encodeCwd(cwd))
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'sess-1.jsonl'),
    [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'does backoff belong here' } }),
      '{ this line is not json',
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'unrelated' } }),
    ].join('\n') + '\n',
    'utf8',
  )
  await writeFile(
    join(root, '.office-space', 'sessions.json'),
    JSON.stringify({
      version: 1,
      sessions: [
        {
          id: 'sess-1',
          project: 'greeter',
          cwd,
          agent: 'manager',
          createdAt: '2026-09-03T09:00:00.000Z',
          updatedAt: '2026-09-03T09:00:00.000Z',
          costUsd: null,
          title: 'the backoff conversation',
          mode: 'building',
        },
      ],
    }),
    'utf8',
  )

  const found = await searchWorkspace(root, 'backoff', home)

  assert.equal(
    found.hits.some((h) => h.source === 'conversation'),
    true,
    'the readable half of the transcript was not searched',
  )
  assert.match(
    found.blind.find((b) => b.source === 'conversation')?.why ?? '',
    /would not parse/,
    'a transcript with a torn record was reported as fully searched',
  )
})

test('a ledger with a torn line is searched, and says it was searched incompletely', async (t) => {
  /*
   * `loadLedger` returns `ok` *and* a list of lines it could not parse — the file is usable and
   * incomplete at the same time. The first version read `.sent` and `.outcomes` and never touched
   * `.torn`, which produced an unqualified "nothing in this workspace matches" over a ledger that
   * did contain the term.
   *
   * The same case as `memory.unread` and `transcript.unreadable`, both handled correctly on
   * either side of it.
   */
  const root = await office(t)
  await writeFile(
    join(root, '.office-space', 'dispatches.jsonl'),
    `${JSON.stringify({
      line: 'sent',
      id: 'toolu_a',
      sessionId: 's',
      project: 'greeter',
      employee: 'builder',
      brief: 'Add retry-with-backoff to the fetch helper.',
      verify: null,
      sentAt: '2026-09-03T09:00:00.000Z',
    })}\n{"line":"sent","id":"toolu_b","brief":"the auth refre\n`,
    'utf8',
  )

  const found = await searchWorkspace(root, 'backoff')
  assert.equal(found.hits.some((h) => h.source === 'dispatch'), true, 'the readable half was not searched')
  assert.equal(
    found.blind.some((b) => b.source === 'dispatch' && b.extent === 'some'),
    true,
    'a ledger with a line nobody could read was reported as fully searched',
  )

  // And the sentence, which is where the omission actually reached a person.
  const nothing = await searchWorkspace(root, 'auth refresh')
  assert.match(summarise(nothing, 'auth refresh'), /could be read/)
  assert.doesNotMatch(summarise(nothing, 'auth refresh'), /Nothing in this workspace matches/)
})

test('one transcript that throws does not blind the other three sources', async (t) => {
  /*
   * `parseTranscript` wraps `JSON.parse` and then dereferences the result, so a line that is
   * literally `null` parses and throws on the next statement. Unwrapped, that escaped
   * `searchWorkspace` into the IPC catch-all, which used to hardcode `source: 'memory'` — so one
   * torn conversation produced a panel saying memory could not be searched, while memory was
   * readable, the failing source was a conversation, and the three sources that *had* been read
   * were reported as unsearched.
   */
  const root = await office(t)
  const home = await tempDir(t, 'office-home-')

  const cwd = join(root, 'projects', 'greeter')
  const dir = join(home, '.claude', 'projects', encodeCwd(cwd))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'sess-1.jsonl'), 'null\n', 'utf8')
  await writeFile(join(root, '.office-space', 'sessions.json'), registryOf('sess-1', cwd), 'utf8')

  const found = await searchWorkspace(root, 'backoff', home)

  assert.equal(
    found.hits.some((h) => h.source === 'memory'),
    true,
    'a throw in one conversation lost the memory that did match',
  )
  assert.equal(
    found.blind.some((b) => b.source === 'conversation'),
    true,
    'the conversation that threw was not reported',
  )
  assert.equal(
    found.blind.some((b) => b.source === 'memory'),
    false,
    'a conversation failing was blamed on memory',
  )
})

test("an employee's own turns are searched, because that is where the work is described", async (t) => {
  /*
   * `parseTranscript` drops every `isSidechain` record unless asked, and in an office whose entire
   * model is dispatching work to employees those turns are the bulk of the transcript. A builder
   * writes "I finished the auth refresh work", somebody searches for it, and without this there is
   * no hit, no blind entry, and the panel says nothing in the workspace matches — so the reader
   * concludes no employee ever touched it.
   */
  const root = await office(t)
  const home = await tempDir(t, 'office-home-')

  const cwd = join(root, 'projects', 'greeter')
  const dir = join(home, '.claude', 'projects', encodeCwd(cwd))
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'sess-1.jsonl'),
    JSON.stringify({
      type: 'assistant',
      isSidechain: true,
      message: { role: 'assistant', content: [{ type: 'text', text: 'I finished the auth refresh work.' }] },
    }) + '\n',
    'utf8',
  )
  await writeFile(join(root, '.office-space', 'sessions.json'), registryOf('sess-1', cwd), 'utf8')

  const found = await searchWorkspace(root, 'auth refresh', home)
  assert.equal(
    found.hits.some((h) => h.source === 'conversation'),
    true,
    "an employee's turn was dropped, and nothing said so",
  )
})

test('the conversation bound reads what it says it read, and says what it did not', async (t) => {
  /*
   * This bound had no test at all — `CONVERSATION_LIMIT` appeared nowhere under `test/`. Three
   * things were undetectable: `>` becoming `>=` (a permanent false caveat at exactly the limit),
   * `slice(0, LIMIT - 1)` (reads 59, reports nothing missing), and the `updatedAt` ordering that
   * decides *which* conversations survive — the one that would fail quietly.
   */
  const root = await office(t)
  const home = await tempDir(t, 'office-home-')

  const cwd = join(root, 'projects', 'greeter')
  const dir = join(home, '.claude', 'projects', encodeCwd(cwd))
  await mkdir(dir, { recursive: true })

  // One more than the limit, and the newest carries the term. Ordering is the thing under test:
  // by id these sort the wrong way round, so only `updatedAt` puts the match inside the window.
  const total = CONVERSATION_LIMIT + 1
  const sessions = []
  for (let i = 0; i < total; i++) {
    const id = `sess-${String(i).padStart(3, '0')}`
    await writeFile(
      join(dir, `${id}.jsonl`),
      JSON.stringify({
        type: 'user',
        /*
         * Two markers, at both ends of the window.
         *
         * `backoff` at the newest proves the ordering; `edgeofwindow` at the *last* conversation
         * inside the bound proves the width. Without the second, `slice(0, LIMIT - 1)` reads 59
         * while reporting 60 and every assertion here still passes — which is exactly what it did.
         */
        message: {
          role: 'user',
          content:
            i === 0
              ? 'the newest mentions backoff'
              : i === CONVERSATION_LIMIT - 1
                ? 'the last one inside the window says edgeofwindow'
                : 'nothing here',
        },
      }) + '\n',
      'utf8',
    )
    sessions.push({
      id,
      project: 'greeter',
      cwd,
      agent: 'manager',
      createdAt: '2026-09-01T09:00:00.000Z',
      /*
       * `sess-000` is newest, each later one an hour older. Sorted by id these run the other way,
       * so only `updatedAt` puts the marked ones where this test claims they are.
       *
       * Arithmetic on a real date rather than string interpolation: the first version wrote
       * `2026-09-${30 - i}`, which goes negative past thirty and produced `2026-09--29`. Sixty-one
       * malformed strings still sort — as strings — so the fixture ordered nothing like it said
       * and the assertions passed anyway.
       */
      updatedAt: new Date(Date.UTC(2026, 8, 30) - i * 3_600_000).toISOString(),
      costUsd: null,
      title: id,
      mode: 'building',
    })
  }
  await writeFile(
    join(root, '.office-space', 'sessions.json'),
    JSON.stringify({ version: 1, sessions }),
    'utf8',
  )

  const found = await searchWorkspace(root, 'backoff', home)

  assert.equal(
    found.hits.some((h) => h.source === 'conversation'),
    true,
    'the newest conversation fell outside the window, so the bound is not ordered by updatedAt',
  )
  const bound = found.blind.find((b) => b.why.includes('most recent'))
  assert.ok(bound, 'more conversations existed than were read, and nothing said so')
  assert.equal(bound.extent, 'some', 'a bounded read was reported as no read at all')
  assert.match(bound.why, new RegExp(`${CONVERSATION_LIMIT} most recent of ${total}`))

  // The width, not just the ordering. A window one short of what it claims reports no shortfall
  // and loses the conversation at its edge, and every assertion above passes while it does.
  const edge = await searchWorkspace(root, 'edgeofwindow', home)
  assert.equal(
    edge.hits.some((h) => h.source === 'conversation'),
    true,
    `the window says it read ${CONVERSATION_LIMIT} and did not reach the ${CONVERSATION_LIMIT}th`,
  )
})

test('exactly the limit is not reported as a shortfall', async (t) => {
  // `>` becoming `>=` puts a permanent caveat on a workspace that was in fact read completely,
  // which is the false-positive twin of everything else in this file.
  const root = await office(t)
  const home = await tempDir(t, 'office-home-')

  const cwd = join(root, 'projects', 'greeter')
  const dir = join(home, '.claude', 'projects', encodeCwd(cwd))
  await mkdir(dir, { recursive: true })

  const sessions = []
  for (let i = 0; i < CONVERSATION_LIMIT; i++) {
    const id = `sess-${String(i).padStart(3, '0')}`
    await writeFile(join(dir, `${id}.jsonl`), JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } }) + '\n', 'utf8')
    sessions.push({
      id, project: 'greeter', cwd, agent: 'manager',
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: new Date(Date.UTC(2026, 8, 30) - i * 3_600_000).toISOString(),
      costUsd: null, title: id, mode: 'building',
    })
  }
  await writeFile(join(root, '.office-space', 'sessions.json'), JSON.stringify({ version: 1, sessions }), 'utf8')

  const found = await searchWorkspace(root, 'somethingnobodywrote', home)
  assert.equal(
    found.blind.some((b) => b.why.includes('most recent')),
    false,
    'a workspace read in full was told part of it was skipped',
  )
})

test('a registry row that will not parse is a conversation nobody searched, and is counted', async (t) => {
  /*
   * `parseRegistry` counts rows it could not use so a shortfall can be "reported rather than
   * assumed away" — and `loadRegistry` computed that count and dropped it one line later. A
   * malformed row was missing from the search, from any blind entry, and from the `of N`.
   */
  const root = await office(t)
  await writeFile(
    join(root, '.office-space', 'sessions.json'),
    JSON.stringify({
      version: 1,
      sessions: [{ id: 'fine', project: 'greeter', cwd: root, agent: 'manager', createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-01T09:00:00.000Z', costUsd: null, title: 't', mode: 'building' }, { nonsense: true }],
    }),
    'utf8',
  )

  const found = await searchWorkspace(root, 'backoff')
  assert.equal(
    found.blind.some((b) => b.source === 'conversation' && /registry/.test(b.why)),
    true,
    'a registry row nobody could read was not reported',
  )
})

test('a hit carries a real address, not a repeat of its label', async (t) => {
  /*
   * Added after a mutation showed the whole of this was untested: with every `goto` forced to
   * `null`, 2454 tests still passed and the app silently fell back to copying a location for
   * every result — which is the behaviour this replaced.
   *
   * Each assertion compares the address against the *label*, deliberately. `where` is what a
   * person reads and `goto` is where the click lands, and the failure that matters is not a
   * missing field but the two being conflated: a conversation's title is not its session id, and
   * two conversations can share a title.
   */
  const root = await office(t)
  const home = await tempDir(t, 'office-home-')

  const cwd = join(root, 'projects', 'greeter')
  const dir = join(home, '.claude', 'projects', encodeCwd(cwd))
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'sess-1.jsonl'),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'the backoff decision' } }) + '\n',
    'utf8',
  )
  await writeFile(
    join(root, '.office-space', 'sessions.json'),
    JSON.stringify({
      version: 1,
      sessions: [
        {
          id: 'sess-1',
          project: 'greeter',
          cwd,
          agent: 'manager',
          createdAt: '2026-09-03T09:00:00.000Z',
          updatedAt: '2026-09-03T09:00:00.000Z',
          costUsd: null,
          title: 'the backoff conversation',
          mode: 'building',
        },
      ],
    }),
    'utf8',
  )

  const found = await searchWorkspace(root, 'backoff', home)

  const memory = found.hits.find((h) => h.source === 'memory')
  assert.deepEqual(memory?.goto, { kind: 'memory', id: 'why-backoff' })
  assert.notEqual(memory?.goto && 'id' in memory.goto && memory.goto.id, memory?.where)

  /*
   * The project travels with the session id, and that is not tidiness.
   *
   * `openSession(project, id)` in the main process does `current.set(project, id)` — it *binds*
   * the conversation to whichever project it is handed. An address without the project would let
   * the renderer open this hit under whatever happened to be on screen, rebinding a live session
   * onto the wrong project, or building a new one under the wrong project when it is not live.
   */
  const conversation = found.hits.find((h) => h.source === 'conversation')
  assert.deepEqual(conversation?.goto, { kind: 'conversation', sessionId: 'sess-1', project: 'greeter' })
  assert.equal(conversation?.where, 'the backoff conversation', 'the label stopped being the title')

  // A ledger row has nowhere to open, and saying so is the point — a destination invented here
  // would put somebody on a project page wondering which row they clicked.
  const dispatch = found.hits.find((h) => h.source === 'dispatch')
  assert.equal(dispatch?.goto, null)
})

test('a project hit addresses the project, not the file it was found in', async (t) => {
  // `greeter/PLAN.md` is where to look; `greeter` is where to go. Conflating them is the same
  // mistake as the conversation title, and this is the source where it looks most harmless.
  const root = await office(t)
  const found = await searchWorkspace(root, 'retry helper')

  const project = found.hits.find((h) => h.source === 'project')
  assert.deepEqual(project?.goto, { kind: 'project', id: 'greeter' })
  assert.equal(project?.where, 'greeter/PLAN.md')
})

/** A one-session registry, for the tests above that only care about the transcript. */
function registryOf(id: string, cwd: string): string {
  return JSON.stringify({
    version: 1,
    sessions: [
      {
        id,
        project: 'greeter',
        cwd,
        agent: 'manager',
        createdAt: '2026-09-03T09:00:00.000Z',
        updatedAt: '2026-09-03T09:00:00.000Z',
        costUsd: null,
        title: `the ${id} conversation`,
        mode: 'building',
      },
    ],
  })
}

test('a slash command and a tool result are both searchable', async (t) => {
  /*
   * The structural version of `spoken()` — `text` else `said` else `input` — read plausibly and
   * lost both of these. A `command` entry has neither `text` nor `input`, so every slash command
   * anybody ran was invisible; and a `tool` entry returned at the `input` branch and never reached
   * `result`, while the comment above it named tool results as the reason the branch existed.
   *
   * Results are where file contents, command output and error messages live — the largest body of
   * text in a transcript, and the thing "which conversation ran that migration" actually asks
   * about.
   */
  const root = await office(t)
  const home = await tempDir(t, 'office-home-')

  const cwd = join(root, 'projects', 'greeter')
  const dir = join(home, '.claude', 'projects', encodeCwd(cwd))
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'sess-1.jsonl'),
    [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: '<command-name>/dispatch</command-name><command-args>builder slashmarker</command-args>' },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ran the resultmarker migration' }],
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  )
  await writeFile(join(root, '.office-space', 'sessions.json'), registryOf('sess-1', cwd), 'utf8')

  const inResult = await searchWorkspace(root, 'resultmarker', home)
  assert.equal(
    inResult.hits.some((h) => h.source === 'conversation'),
    true,
    'what a tool returned was not searched, so the question the comment names comes back empty',
  )

  const inCommand = await searchWorkspace(root, 'slashmarker', home)
  assert.equal(
    inCommand.hits.some((h) => h.source === 'conversation'),
    true,
    'a slash command and its arguments were not searched',
  )
})
