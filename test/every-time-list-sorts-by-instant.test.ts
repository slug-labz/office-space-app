/**
 * The four lists #242 left on `localeCompare`, each sorted by instant.
 *
 * #242 moved two lists of ISO timestamps onto `time-order.ts`. Four more still compared the text,
 * and each is pinned here from where a test can reach it:
 *
 * - **`pending()`**, the held calls the approval watcher pushes. It sorted with
 *   `a.askedAt.localeCompare(...)`, and its parse check never looked at `askedAt`, so a request file
 *   whose time was missing or not text threw from the sort, outside the per-file `try`. Measured on
 *   dev at e6fe5cb with a scratch script outside the repository: with two such files beside a
 *   readable one, `pending()` rejected with a TypeError; and a watcher over two such files pushed
 *   nothing in 1.3 seconds, neither its first answer nor a request written after it started, while
 *   67 rejections reached the process with nothing on the chain to catch them.
 * - **`conversationWith`**, the conversation `openAgentSession` resumes, and **`newestSentFirst`**,
 *   the order of the rows under "What the office changed". Both were inline in `main.ts`, which
 *   imports `electron` and so no test can load. They were moved out unchanged first, and the tests
 *   below were run on that move before the order was changed.
 * - **`searchWorkspace`**, which conversations a search reads when there are more than it will read.
 *
 * Run on dev's code, with the two `main.ts` choices moved out unchanged, every test here failed but
 * one: that a conversation with no readable time is still resumed when it is the only one. That one
 * passed there too, and pins that the new order does not drop such a conversation.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pending, watchApprovals } from '../src/main/approvals.js'
import { conversationWith, type SessionRecord } from '../src/main/registry.js'
import { CONVERSATION_LIMIT, searchWorkspace } from '../src/main/search.js'
import { encodeCwd } from '../src/main/transcript-store.js'
import { newestSentFirst, type SentDispatch } from '../src/shared/changes-view.js'
import { tempDir } from './temp-dir.js'

/** Poll a condition rather than sleeping a fixed time, so a loaded machine is not a failure. */
async function until(done: () => boolean, ms: number): Promise<boolean> {
  const by = Date.now() + ms
  while (!done() && Date.now() < by) await new Promise((r) => setTimeout(r, 10))
  return done()
}

// ─────────────────────────────────────────────────────────────────────── held calls ──

const APPROVALS = join('.office-space', 'approvals')

/** A request as the gate writes one, with `askedAt` set to anything, or left out for `undefined`. */
async function held(root: string, toolUseId: string, askedAt: unknown): Promise<void> {
  const request: Record<string, unknown> = {
    sessionId: 's-1',
    toolUseId,
    tool: 'Bash',
    input: { command: 'npm test' },
    cwd: root,
    waitMs: 240_000,
  }
  if (askedAt !== undefined) request['askedAt'] = askedAt
  await mkdir(join(root, APPROVALS), { recursive: true })
  await writeFile(join(root, APPROVALS, `s-1.${toolUseId}.request.json`), JSON.stringify(request))
}

/**
 * Two requests whose time is not text, so that one of them is not the first one listed.
 *
 * `localeCompare` threw only when called on such a request, not when handed one, and in a list this
 * short the sort never called it on the request listed first. So one such file failed the old sort
 * only when the directory listed another request before it. Measured on dev, with one such file
 * beside readable requests: listed first, `pending()` resolved; listed after one, it rejected. With
 * two, one of them is not listed first, whatever order the filesystem gives.
 */
async function twoWithNoTime(root: string): Promise<void> {
  await held(root, 'no-time', undefined)
  await held(root, 'a-number', 1_758_016_800_000)
}

test('a held call whose time is missing or not text is still listed, after every readable one', async (t) => {
  const root = await tempDir(t, 'office-times-')
  await held(root, 'later', '2026-09-16T10:05:00.000Z')
  await held(root, 'earlier', '2026-09-16T10:00:00.000Z')
  await twoWithNoTime(root)

  const listed = await pending(root)
  assert.notEqual(listed, null, 'the approvals directory could not be read')
  const ids = (listed ?? []).map((r) => r.toolUseId)
  assert.deepEqual(ids.slice(0, 2), ['earlier', 'later'], 'the calls with a time were not first, oldest first')
  // The two tie, so the directory's order decides between them.
  assert.deepEqual(ids.slice(2).sort(), ['a-number', 'no-time'], 'a call the gate is still holding was dropped')
  for (const request of (listed ?? []).slice(2)) {
    assert.equal(request.askedAt, '', `${request.toolUseId} was passed on with a time that is not text`)
  }
})

test('a held call with an empty time is listed after the calls with one, not before them', async (t) => {
  const root = await tempDir(t, 'office-times-')
  await held(root, 'later', '2026-09-16T10:05:00.000Z')
  await held(root, 'blank', '')
  await held(root, 'earlier', '2026-09-16T10:00:00.000Z')

  const listed = await pending(root)
  assert.deepEqual(
    (listed ?? []).map((r) => r.toolUseId),
    ['earlier', 'later', 'blank'],
    'an empty time was ranked as the oldest call',
  )
})

test('a call that arrives while calls with no readable time are held still reaches the strip', async (t) => {
  const root = await tempDir(t, 'office-times-')
  await twoWithNoTime(root)
  const shown: (readonly string[])[] = []
  const watcher = watchApprovals(root, (requests) => shown.push(requests.map((r) => r.toolUseId)), 20)

  try {
    assert.ok(await until(() => shown.length > 0, 5_000), 'the watcher never answered while those two were on disk')
    await held(root, 'arrived', '2026-09-16T10:00:00.000Z')
    assert.ok(
      await until(() => shown.some((ids) => ids.includes('arrived')), 5_000),
      'a call written after them never reached the strip, so the gate would refuse it at its deadline with no card drawn',
    )
  } finally {
    watcher.close()
  }
  assert.equal(shown.at(-1)?.[0], 'arrived', 'the one call with a readable time was not first')
})

/**
 * Nothing on disk makes `pending()` reject now, so the catch is reached here the other way: the
 * listener throws inside the same chain. Before the catch, that rejection had nobody listening.
 */
test('a check for held calls that fails is reported, not left to reject with nobody listening', async (t: TestContext) => {
  const root = await tempDir(t, 'office-times-')
  await held(root, 'waiting', '2026-09-16T10:00:00.000Z')
  const said = t.mock.method(console, 'error', () => {})
  const unhandled: unknown[] = []
  const listen = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', listen)

  const watcher = watchApprovals(
    root,
    () => {
      throw new Error('the listener failed mid-push')
    },
    20,
  )
  try {
    assert.ok(await until(() => said.mock.callCount() > 0, 5_000), 'a failed check was not reported at all')
    // Long enough for a rejection nobody caught to be reported.
    await new Promise((r) => setTimeout(r, 100))
  } finally {
    watcher.close()
    process.off('unhandledRejection', listen)
  }

  const line = String(said.mock.calls[0]?.arguments[0])
  assert.match(line, /^Office Space: /, 'the report does not say which program it came from')
  assert.match(line, /the listener failed mid-push/, 'the report does not carry the failure')
  assert.deepEqual(unhandled, [], 'the failure also escaped as an unhandled rejection')
})

// ──────────────────────────────────────────────────────────── the resumed conversation ──

const conversation = (id: string, updatedAt: string, agent = 'builder'): SessionRecord => ({
  id,
  mode: 'building',
  project: 'billing',
  cwd: '/work/office',
  agent,
  createdAt: '2026-09-16T09:00:00.000Z',
  updatedAt,
  costUsd: null,
  title: null,
  opened: true,
})

test("an employee's newest real conversation is resumed, not one whose time will not parse", () => {
  const chosen = conversationWith(
    [
      conversation('older', '2026-09-15T08:00:00.000Z'),
      conversation('garbled', 'not a date'),
      conversation('newer', '2026-09-16T14:02:00.000Z'),
      conversation('blank', ''),
      // Newer than all of them, and somebody else's.
      conversation('theirs', '2026-09-16T15:00:00.000Z', 'reviewer'),
      // Newer still, and the employee's, but none is one to resume: closed, never opened, another project's.
      { ...conversation('closed', '2026-09-16T16:00:00.000Z'), closed: true },
      { ...conversation('unopened', '2026-09-16T16:00:00.000Z'), opened: false },
      { ...conversation('elsewhere', '2026-09-16T16:00:00.000Z'), project: 'payroll' },
    ],
    'billing',
    '/work/office',
    'builder',
  )
  assert.equal(chosen?.id, 'newer', `resumed ${chosen?.id ?? 'nothing'}, not the employee's newest real conversation`)
})

test('a conversation with no readable time is still resumed when it is the only one', () => {
  const only = [conversation('garbled', 'not a date'), conversation('theirs', '2026-09-16T15:00:00.000Z', 'reviewer')]
  const chosen = conversationWith(only, 'billing', '/work/office', 'builder')
  assert.equal(
    chosen?.id,
    'garbled',
    `resumed ${chosen?.id ?? 'nothing'}, not the one conversation this employee has, whose time will not parse`,
  )
  assert.equal(conversationWith(only, 'billing', '/work/office', 'designer'), null, 'somebody with no conversation here was given one')
})

// ─────────────────────────────────────────────────────────────────── the change rows ──

const sent = (id: string, sentAt: string): SentDispatch => ({ id, employee: 'builder', brief: id, sentAt })

test('the change rows run newest first by time, with times nobody can read after them', () => {
  const rows = newestSentFirst([
    sent('old', '2026-09-15T08:00:00.000Z'),
    sent('garbled', 'not a date'),
    sent('new', '2026-09-16T14:02:00.000Z'),
    sent('blank', ''),
  ])
  const ids = rows.map((d) => d.id)
  // The two unreadable rows tie, so they keep the order they were handed in.
  assert.deepEqual(ids.slice(2), ['garbled', 'blank'], 'a row whose time will not parse was not listed after every row with one')
  assert.deepEqual(ids.slice(0, 2), ['new', 'old'], 'the rows with a time were not newest first')
})

// ──────────────────────────────────────────────────────────────────────────── search ──

test('a search over more conversations than it reads reads the newest real ones', async (t) => {
  const root = await tempDir(t, 'office-times-')
  const home = await tempDir(t, 'office-times-')
  const cwd = join(root, 'projects', 'greeter')
  const dir = join(home, '.claude', 'projects', encodeCwd(cwd))
  await mkdir(dir, { recursive: true })
  await mkdir(join(root, 'memory'), { recursive: true })
  await mkdir(join(root, '.office-space'), { recursive: true })

  const sessions: Record<string, unknown>[] = []
  const talked = async (id: string, said: string, updatedAt: string): Promise<void> => {
    await writeFile(join(dir, `${id}.jsonl`), `${JSON.stringify({ type: 'user', message: { role: 'user', content: said } })}\n`, 'utf8')
    sessions.push({ id, project: 'greeter', cwd, agent: 'manager', createdAt: '2026-09-01T09:00:00.000Z', updatedAt, costUsd: null, title: id, mode: 'building' })
  }
  // As many real conversations as a search reads, an hour apart, with the term in the oldest; and
  // one more whose time nobody can read, written first. Only an order by instant leaves that one
  // out: read in the registry's own order it is read, and the oldest real one is not.
  await talked('sess-garbled', 'nothing here either', 'not a date')
  for (let i = 0; i < CONVERSATION_LIMIT; i++) {
    await talked(
      `sess-${String(i).padStart(3, '0')}`,
      i === CONVERSATION_LIMIT - 1 ? 'the oldest real one says edgeofwindow' : 'nothing here',
      new Date(Date.UTC(2026, 8, 30) - i * 3_600_000).toISOString(),
    )
  }
  await writeFile(join(root, '.office-space', 'sessions.json'), JSON.stringify({ version: 1, sessions }), 'utf8')

  const found = await searchWorkspace(root, 'edgeofwindow', home)
  assert.equal(
    found.hits.some((h) => h.source === 'conversation'),
    true,
    'a conversation whose time will not parse was read in place of a real one, and the oldest real one was left out',
  )
  assert.ok(
    found.blind.some((b) => b.why === `only the ${CONVERSATION_LIMIT} most recent of ${CONVERSATION_LIMIT + 1} were read`),
    `the one left unread was not declared: ${JSON.stringify(found.blind)}`,
  )
})
