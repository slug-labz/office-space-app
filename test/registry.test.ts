/**
 * The session registry, and finding the transcript it points at.
 *
 * This is the file where "absent is not empty" has real consequences. A registry that could
 * not be read is not a workspace with no history — offering someone a blank slate over the top
 * of a week's work is the exact failure the office rule exists to prevent, and it is
 * indistinguishable from correct behaviour unless the states are kept apart. So most of what
 * is checked here is which of the three states came back, not just what was in it.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { loadRegistry, mayWriteRegistry, parseRegistry, RegistryAppeared, registryPath, resumable, saveRegistry, serializeRegistry, titleFrom, type RegistryState, type SessionRecord, upsert, mergeNewest,
  projectOfSession, sessionsFor, shownSessions,
} from '../src/main/registry.js'
import { encodeCwd, locateTranscript, readTranscript } from '../src/main/transcript-store.js'
import { parseTranscript } from '../src/shared/transcript/parse.js'

import { tempDir } from './temp-dir.js'

const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'aaaa-1',
  mode: 'building',
  project: '',
  cwd: '/work/office',
  agent: 'manager',
  createdAt: '2026-08-19T09:00:00.000Z',
  updatedAt: '2026-08-19T09:00:00.000Z',
  costUsd: null,
  title: null,
  opened: true,
  ...over,
})

const workspace = (t: TestContext) => tempDir(t, 'office-reg-')

// ───────────────────────────────────────────────────────────────── pure logic ──

test('a registry round-trips through text', () => {
  const sessions = [session(), session({ id: 'aaaa-2', title: 'fix the auth bug' })]
  const parsed = parseRegistry(serializeRegistry(sessions))

  assert.ok(!('error' in parsed))
  assert.deepEqual(parsed.sessions, sessions)
})

test('text that is not a registry is an error, not an empty registry', () => {
  assert.ok('error' in parseRegistry('not json at all'))
  assert.ok('error' in parseRegistry('"a string"'))
  assert.ok('error' in parseRegistry('{"version":1}'), 'no sessions array is broken, not empty')
})

test('an unreadable row is skipped and counted, rather than losing every other row', () => {
  const text = JSON.stringify({ version: 1, sessions: [session(), { nonsense: true }, null] })
  const parsed = parseRegistry(text)

  assert.ok(!('error' in parsed))
  assert.equal(parsed.sessions.length, 1)
  assert.equal(parsed.skipped, 2, 'counted, so it can be reported rather than assumed away')
})

test('upsert replaces by id rather than appending a duplicate', () => {
  const first = session({ costUsd: 0.01 })
  const updated = upsert(upsert([], first), session({ costUsd: 0.02 }))

  assert.equal(updated.length, 1)
  assert.equal(updated[0]?.costUsd, 0.02)
})

test('the session offered on open is the most recently touched one for this directory', () => {
  const sessions = [
    session({ id: 'old', updatedAt: '2026-08-18T09:00:00.000Z' }),
    session({ id: 'new', updatedAt: '2026-08-19T18:00:00.000Z' }),
    session({ id: 'elsewhere', cwd: '/work/other', updatedAt: '2026-08-19T23:00:00.000Z' }),
  ]

  assert.equal(resumable(sessions, '/work/office')?.id, 'new')
})

test('a session Claude never confirmed is never offered', () => {
  // An id we generated but never saw an `init` for names no conversation on disk. Resuming it
  // produces an error, not a conversation.
  const sessions = [session({ id: 'ghost', opened: false, updatedAt: '2026-08-19T23:00:00.000Z' })]

  assert.equal(resumable(sessions, '/work/office'), null)
})

test('a directory with no sessions offers nothing', () => {
  assert.equal(resumable([session()], '/somewhere/else'), null)
})

test('a title is the first line, cut to something that fits', () => {
  assert.equal(titleFrom('  fix the auth bug\nand the tests  '), 'fix the auth bug')
  assert.equal(titleFrom('x'.repeat(80)).length, 61, '60 characters and an ellipsis')
  assert.equal(titleFrom('   '), '')
})

// ───────────────────────────────────────────────────────────────────────── io ──

test('a workspace that has never had a session reads as missing, not as an error', async (t) => {
  const root = await workspace(t)

  assert.deepEqual(await loadRegistry(root), { state: 'missing' })
})

test('a saved registry reads back', async (t) => {
  const root = await workspace(t)
  await saveRegistry(root, [session({ title: 'fix the auth bug' })])

  const loaded = await loadRegistry(root)

  assert.equal(loaded.state, 'ok')
  assert.equal(loaded.state === 'ok' ? loaded.sessions[0]?.title : null, 'fix the auth bug')
})

test('a corrupt registry is unreadable — NOT a workspace with no history', async (t) => {
  const root = await workspace(t)
  await mkdir(join(root, '.office-space'), { recursive: true })
  await writeFile(registryPath(root), '{ this is not json')

  const loaded = await loadRegistry(root)

  assert.equal(loaded.state, 'unreadable', 'offering a blank slate here would bury real work')
})

test('a registry that cannot be opened is unreadable, not missing', async (t) => {
  const root = await workspace(t)
  await saveRegistry(root, [session()])
  await chmod(registryPath(root), 0o000)

  try {
    const loaded = await loadRegistry(root)
    if (loaded.state === 'ok') return // running as root; the permission bit means nothing
    assert.equal(loaded.state, 'unreadable')
  } finally {
    await chmod(registryPath(root), 0o644)
  }
})

test('saving twice leaves one good file rather than a torn one', async (t) => {
  const root = await workspace(t)
  await saveRegistry(root, [session({ id: 'one' })])
  await saveRegistry(root, [session({ id: 'one' }), session({ id: 'two' })])

  const text = await readFile(registryPath(root), 'utf8')
  const parsed = parseRegistry(text)

  assert.ok(!('error' in parsed))
  assert.deepEqual(parsed.sessions.map((s) => s.id), ['one', 'two'])
})

// ───────────────────────────────────────────────────────── finding transcripts ──

test('a working directory encodes to the folder Claude Code uses', () => {
  assert.equal(encodeCwd('/Users/somebody/ADE'), '-Users-somebody-ADE')
})

test('a transcript is found where the encoding says it should be', async (t) => {
  const home = await tempDir(t, 'office-home-')
  const cwd = '/work/office'
  const dir = join(home, '.claude', 'projects', encodeCwd(cwd))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'sess-1.jsonl'), '{}\n')

  const found = await locateTranscript('sess-1', cwd, home)

  assert.equal(found.state, 'found')
})

test('a transcript filed somewhere unexpected is still found, not reported as absent', async (t) => {
  // The encoding is not a published contract. If it ever changes, "we cannot derive the path"
  // must not come out looking like "you have no history".
  const home = await tempDir(t, 'office-home-')
  const dir = join(home, '.claude', 'projects', 'some-other-encoding')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'sess-1.jsonl'), '{}\n')

  const found = await locateTranscript('sess-1', '/work/office', home)

  assert.equal(found.state, 'found')
})

test('a session with no transcript is missing, and says so', async (t) => {
  const home = await tempDir(t, 'office-home-')
  await mkdir(join(home, '.claude', 'projects'), { recursive: true })

  assert.deepEqual(await locateTranscript('nope', '/work/office', home), { state: 'missing' })
})

test('no Claude history at all is missing rather than an error', async (t) => {
  const home = await tempDir(t, 'office-home-')

  assert.deepEqual(await locateTranscript('nope', '/work/office', home), { state: 'missing' })
})

test('reading a transcript returns its text', async (t) => {
  const home = await tempDir(t, 'office-home-')
  const cwd = '/work/office'
  const dir = join(home, '.claude', 'projects', encodeCwd(cwd))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'sess-1.jsonl'), '{"type":"user"}\n')

  const read = await readTranscript('sess-1', cwd, home)

  assert.equal(read.state, 'ok')
  assert.equal(read.state === 'ok' ? read.jsonl.trim() : '', '{"type":"user"}')
})

// ─────────────────────────────────────────────────────────── the whole chain ──

test('a saved session leads all the way back to a rendered conversation', async (t) => {
  // The path main.ts actually walks on launch: read the registry, pick what to offer, find its
  // transcript, parse it. Each piece is checked above; this is the join between them, which is
  // where a mismatch in the contract would otherwise hide.
  const root = await workspace(t)
  const home = await tempDir(t, 'office-home-')
  const cwd = root

  await saveRegistry(root, [
    session({ id: 'old-one', cwd, updatedAt: '2026-08-18T09:00:00.000Z' }),
    session({ id: 'sess-live', cwd, updatedAt: '2026-08-19T18:00:00.000Z', title: 'fix the auth bug' }),
  ])

  const dir = join(home, '.claude', 'projects', encodeCwd(cwd))
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'sess-live.jsonl'),
    [
      JSON.stringify({ type: 'user', uuid: 'u1', sessionId: 'sess-live', message: { content: 'fix the auth bug' } }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: { model: 'opus', content: [{ type: 'text', text: 'On it.' }] },
      }),
    ].join('\n') + '\n',
  )

  const loaded = await loadRegistry(root)
  assert.equal(loaded.state, 'ok')

  const target = loaded.state === 'ok' ? resumable(loaded.sessions, cwd) : null
  assert.equal(target?.id, 'sess-live')
  assert.equal(target?.title, 'fix the auth bug')

  const read = await readTranscript(target?.id ?? '', target?.cwd ?? '', home)
  assert.equal(read.state, 'ok')

  const timeline = parseTranscript(read.state === 'ok' ? read.jsonl : '')
  assert.deepEqual(timeline.entries.map((e) => e.kind), ['user', 'assistant'])
})

test('a session whose transcript is gone still resolves — it just cannot be shown', async (t) => {
  // The manager will remember this conversation when it is resumed; we simply have nothing to
  // put on screen. That must read as "cannot show it", never as an empty conversation.
  const root = await workspace(t)
  const home = await tempDir(t, 'office-home-')
  await saveRegistry(root, [session({ id: 'sess-gone', cwd: root })])

  const loaded = await loadRegistry(root)
  const target = loaded.state === 'ok' ? resumable(loaded.sessions, root) : null
  assert.equal(target?.id, 'sess-gone', 'still offered — the session is real')

  assert.equal((await readTranscript('sess-gone', root, home)).state, 'missing')
})

test('a registry written before projects existed reads as the office', () => {
  // The upgrade path. Rows with no `project` field were written when there was one
  // conversation per workspace — which is exactly what the office tab is.
  const old = JSON.stringify({
    version: 1,
    sessions: [{ id: 'a', cwd: '/w', agent: 'manager', createdAt: '', updatedAt: '', costUsd: null, title: null, opened: true }],
  })

  const parsed = parseRegistry(old)

  assert.ok(!('error' in parsed))
  assert.equal(parsed.sessions[0]?.project, '', 'not undefined, and not dropped')
})

test('sessions in different projects do not resume each other', () => {
  const all = [
    session({ id: 'office-one', project: '', updatedAt: '2026-08-19T10:00:00.000Z' }),
    session({ id: 'billing-one', project: 'billing', updatedAt: '2026-08-19T20:00:00.000Z' }),
  ]

  assert.equal(resumable(all.filter((s) => s.project === ''), '/work/office')?.id, 'office-one')
  assert.equal(resumable(all.filter((s) => s.project === 'billing'), '/work/office')?.id, 'billing-one')
})

// ──────────────────────────────── a project is a group of sessions, not one ──

test('a project lists every conversation it has had, newest first', async () => {
  const { sessionsFor } = await import('../src/main/registry.js')
  const all = [
    session({ id: 'b', project: 'billing', updatedAt: '2026-08-19T12:00:00.000Z' }),
    session({ id: 'a', project: 'billing', updatedAt: '2026-08-18T09:00:00.000Z' }),
    session({ id: 'c', project: 'billing', updatedAt: '2026-08-19T20:00:00.000Z' }),
    session({ id: 'other', project: 'auth', updatedAt: '2026-08-19T23:00:00.000Z' }),
  ]

  assert.deepEqual(sessionsFor(all, 'billing', '/work/office').map((s) => s.id), ['c', 'b', 'a'])
})

test('a conversation Claude never confirmed is not one of the group', async () => {
  const { sessionsFor } = await import('../src/main/registry.js')
  const all = [session({ id: 'ghost', project: 'billing', opened: false })]

  assert.deepEqual(sessionsFor(all, 'billing', '/work/office'), [])
})

test('another directory\'s sessions are not this project\'s', async () => {
  const { sessionsFor } = await import('../src/main/registry.js')
  const all = [session({ id: 'elsewhere', project: 'billing', cwd: '/somewhere/else' })]

  assert.deepEqual(sessionsFor(all, 'billing', '/work/office'), [])
})

test('a row written before modes existed resumes able to work, not in intake', () => {
  // The one that matters on upgrade. Every session already on disk has no `mode`, and reading
  // those as `intake` would silently take Task, Write and Edit away from every conversation the
  // user already had — the app changing something nobody asked it to change.
  const parsed = parseRegistry(
    JSON.stringify({
      version: 1,
      sessions: [{ id: 'old-1', project: '', cwd: '/w', agent: 'manager', opened: true }],
    }),
  )
  assert.ok(!('error' in parsed))
  assert.equal(parsed.sessions[0]?.mode, 'building')
})

test('a mode we do not recognise reads as the legacy mode, not as permissive-by-accident', () => {
  // A hand edit, or a row from a version that had a mode we later removed. Falling through to
  // "withhold nothing" would turn a typo into a manager holding every tool.
  const parsed = parseRegistry(
    JSON.stringify({
      version: 1,
      sessions: [{ id: 'x', project: '', cwd: '/w', agent: 'manager', opened: true, mode: 'planning-v2' }],
    }),
  )
  assert.ok(!('error' in parsed))
  assert.equal(parsed.sessions[0]?.mode, 'building')
})

test('a recorded mode survives the round trip', () => {
  const parsed = parseRegistry(serializeRegistry([session({ id: 'k', mode: 'intake' })]))
  assert.ok(!('error' in parsed))
  assert.equal(parsed.sessions[0]?.mode, 'intake')
})

// ───────────────────────────────────────── a closed conversation stays closed ──

/**
 * Closing a conversation lasted until the app restarted.
 *
 * Closing writes one boolean, `closed`, and `parseRegistry` rebuilds each record field by field.
 * Its list predates closing and never gained the field, so the flag reached the disk and the
 * next read dropped it. Every read goes through that parser, the one at startup included, so a
 * restart would put the conversation back in the list and the first save after it would write
 * the registry out without the flag.
 *
 * Found by reading the parser against the type, and measured at the level of these functions,
 * not in the running app. The round trip at the top of this file could not see it, because
 * none of its records had been closed.
 */
test('a closed conversation is still closed after the registry is read back', () => {
  const all = [
    session({ id: 'kept', project: 'billing', updatedAt: '2026-09-01T09:00:00.000Z' }),
    session({ id: 'closed-one', project: 'billing', updatedAt: '2026-09-02T09:00:00.000Z', closed: true }),
  ]
  const parsed = parseRegistry(serializeRegistry(all))

  assert.ok(!('error' in parsed))
  assert.equal(
    parsed.sessions.find((s) => s.id === 'closed-one')?.closed,
    true,
    'the flag closing wrote did not survive being read back',
  )
  assert.deepEqual(
    sessionsFor(parsed.sessions, 'billing', '/work/office').map((s) => s.id),
    ['kept'],
    'a conversation somebody closed is back in the list',
  )
  // The closed one is the newer of the two, so this is the case where a project opening with
  // nothing live would have picked it back up.
  assert.equal(
    resumable(parsed.sessions, '/work/office')?.id,
    'kept',
    'the conversation somebody closed is the one that would be reopened',
  )
})

test('only `true` closes a conversation; anything else on disk reads as open', () => {
  // A hand edit, or a row some other version wrote. Hiding is the direction that takes a
  // conversation out of sight, so doubt reads as open — the answer the field already gives a row
  // written before closing existed. `'false'` is here because it is truthy.
  const row = { project: 'billing', cwd: '/work/office', agent: 'manager', opened: true }
  const parsed = parseRegistry(
    JSON.stringify({
      version: 1,
      sessions: [
        { ...row, id: 'absent' },
        { ...row, id: 'false', closed: false },
        { ...row, id: 'the string true', closed: 'true' },
        { ...row, id: 'the string false', closed: 'false' },
        { ...row, id: 'one', closed: 1 },
        { ...row, id: 'null', closed: null },
        { ...row, id: 'true', closed: true },
      ],
    }),
  )
  assert.ok(!('error' in parsed))

  const listed = sessionsFor(parsed.sessions, 'billing', '/work/office')
  assert.deepEqual(
    parsed.sessions.filter((s) => !listed.includes(s)).map((s) => s.id),
    ['true'],
    'the rows hidden from the list are not exactly the one whose `closed` is `true`',
  )
  for (const s of parsed.sessions) {
    assert.ok(
      s.closed === undefined || typeof s.closed === 'boolean',
      `${s.id} came back with closed: ${JSON.stringify(s.closed)}, which is not a boolean`,
    )
  }
})

test('every field of a record survives the round trip', () => {
  // `Required` is the point. The compiler will not accept this fixture until it names every field
  // `SessionRecord` has, optional ones included, so a field added to the type without a line in
  // `parseRegistry` fails here instead of after a restart. `closed` was added exactly that way.
  //
  // Every value differs from what the parser substitutes for an absent field, so a dropped field
  // cannot pass by matching its own default.
  const full: Required<SessionRecord> = {
    id: 'every-field',
    project: 'billing',
    cwd: '/work/office',
    agent: 'reviewer',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
    costUsd: 0.0488,
    title: 'fix the auth bug',
    mode: 'intake',
    opened: true,
    closed: true,
  }
  // And the row the close handler writes for a conversation Claude never confirmed: `opened`
  // left at its default, `closed: true`. With `full` alone, a parser that kept `closed` only
  // beside `opened: true` passed this test.
  const unconfirmed: Required<SessionRecord> = { ...full, id: 'closed-unconfirmed', opened: false }
  const parsed = parseRegistry(serializeRegistry([full, unconfirmed]))

  assert.ok(!('error' in parsed))
  assert.deepEqual(parsed.sessions, [full, unconfirmed])
})

test('a closed conversation is still closed on disk after a restart and the save that follows', async (t) => {
  // The two calls the app makes around a restart, without the app around them: `loadRegistry`,
  // as `openRegistry` does, then `saveRegistry` with what was read, as the next save does.
  const root = await workspace(t)
  await saveRegistry(root, [session({ id: 'closed-one', project: 'billing', closed: true })])

  const restarted = await loadRegistry(root)
  assert.equal(restarted.state, 'ok')
  await saveRegistry(root, restarted.state === 'ok' ? restarted.sessions : [])

  const again = await loadRegistry(root)
  assert.equal(
    again.state === 'ok' ? again.sessions[0]?.closed : null,
    true,
    'the save after a restart wrote the close away',
  )
  assert.match(await readFile(registryPath(root), 'utf8'), /"closed": true/)
})

// ─────────────────────────────────────── the ordering that deleted a conversation ──

/**
 * The registry must be read after the workspace root is known, and written only after that.
 *
 * This is a source-order check because the bug was one of source order, in the composition root,
 * where there is nothing to unit test. It is worth the awkwardness: this cost a user every
 * conversation they had had in the installed app, and the failure was silent in both directions.
 *
 * Packaged, `WORKSPACE_ROOT` starts as `APP_ROOT` — inside `app.asar`, read-only, no registry in
 * it. `openRegistry()` ran there, `loadRegistry` answered `missing`, and `missing` raises no
 * problem because only `unreadable` does. The office started with an empty list and said nothing
 * was wrong. Then the root was corrected, the registry was never re-read, and the first
 * `remember()` wrote the empty list over the real file — `saveRegistry` replaces the whole file,
 * so this did not fail to *show* the conversations, it **deleted** them.
 *
 * In a clone the two paths are the same directory. It worked perfectly on both of our machines.
 */
test('the session registry is read only after the workspace root is settled', async () => {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')

  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const main = await readFile(join(root, 'src/main/main.ts'), 'utf8')

  const settled = main.indexOf('WORKSPACE_ROOT = resolved.root')
  const opened = main.indexOf('await openRegistry()')

  assert.ok(settled > 0, 'the root is no longer resolved in main.ts; this check needs rewriting')
  assert.ok(opened > 0, 'openRegistry is no longer called in main.ts; this check needs rewriting')
  assert.ok(
    opened > settled,
    'openRegistry() runs before WORKSPACE_ROOT is resolved, so a packaged app reads its ' +
      'session registry from inside its own read-only bundle, finds nothing, and then ' +
      'overwrites the real one. That deletes conversations rather than failing to show them.',
  )
})

test('a registry that is merely missing is not the same as one that is empty', () => {
  // `missing` raises no problem today, and that is defensible for a genuinely new workspace.
  // What is not defensible is treating it as "there are no conversations" and then writing that
  // conclusion back to disk. The states stay distinct so the caller has to decide which it is.
  const states: RegistryState['state'][] = ['ok', 'missing', 'unreadable']
  assert.ok(states.includes('missing'))
  assert.notEqual('missing', 'ok')
})

test('THE BUG: two saves at once do not fight over the same scratch file', async (t) => {
  // The temp name was `${path}.${pid}.tmp` — unique per process, shared by every call inside it.
  // Two overlapping saves wrote to the same scratch file and both renamed it, so the second
  // found nothing there. Reproduced before the fix: one writer fulfilled, the other rejected with
  // `ENOENT: no such file or directory, rename`, and its records were gone.
  //
  // The pid was right about the wrong axis. Two Office Spaces on one workspace cannot collide;
  // two handlers in one Office Space could — closing a conversation while a turn finishes writes
  // twice, which is the ordinary case rather than the exotic one.
  const root = await workspace(t)

  const batch = (tag: string, n: number) =>
    Array.from({ length: n }, (_, i) => session({ id: `${tag}-${i}`, cwd: root }))

  const results = await Promise.allSettled([
    saveRegistry(root, batch('a', 200)),
    saveRegistry(root, batch('b', 300)),
    saveRegistry(root, batch('c', 400)),
    saveRegistry(root, batch('d', 500)),
  ])

  const failed = results.filter((r) => r.status === 'rejected')
  assert.deepEqual(
    failed.map((r) => String((r as PromiseRejectedResult).reason).slice(0, 60)),
    [],
    'a save failed because another was using its temp file',
  )

  // And what landed is one writer's whole batch — a valid registry, not a mixture of two.
  const loaded = await loadRegistry(root)
  assert.equal(loaded.state, 'ok', 'the registry is readable after four concurrent writes')
  if (loaded.state !== 'ok') return
  assert.ok([200, 300, 400, 500].includes(loaded.sessions.length), `got ${loaded.sessions.length} records, which is no writer's batch`)
  const tags = new Set(loaded.sessions.map((s) => s.id.split('-')[0]))
  assert.equal(tags.size, 1, `the file mixes writers: ${[...tags].join(', ')}`)
})

test('THE BUG: a working directory is encoded the way the CLI encodes it, not the way it reads', async () => {
  // `encodeCwd` derives the folder Claude Code keeps a project's transcripts in. It replaced only
  // `/`, and the CLI replaces **every character that is not a letter or a digit**.
  //
  // Measured against the CLI's own output rather than reasoned about: each transcript records the
  // `cwd` it ran in and sits inside the directory derived from that cwd, so the pairs are the
  // authority. Across 25 of them on one machine — `/` only was wrong on 9, `/` and `.` wrong on
  // 5, every-non-alphanumeric wrong on none.
  //
  // The nine included every agent worktree this app makes, because they live under `.claude/`.
  // The paths below are synthetic and carry the same characters; the real ones are somebody's
  // directory listing and are not this repository's to keep.
  const cases: readonly [string, string][] = [
    // The plain case, which is the only one the old rule got right.
    ['/Users/ada/work', '-Users-ada-work'],
    // A dot. This is the shape of every worktree the office creates.
    ['/Users/ada/app/.claude/worktrees/night-1', '-Users-ada-app--claude-worktrees-night-1'],
    // An underscore and a space.
    ['/Users/ada/Downloads/Ria_Jira Insights 2', '-Users-ada-Downloads-Ria-Jira-Insights-2'],
    // A dot used as a separator rather than a hidden-file marker.
    ['/Users/ada/proj 2.worktrees/docs', '-Users-ada-proj-2-worktrees-docs'],
    // Digits survive; so does an existing hyphen.
    ['/Volumes/SSD-2/repo-9', '-Volumes-SSD-2-repo-9'],
  ]

  for (const [cwd, expected] of cases) {
    assert.equal(encodeCwd(cwd), expected, cwd)
  }

  // And the property the table is an instance of: nothing but letters, digits and hyphens comes
  // out, whatever goes in.
  assert.match(encodeCwd('/a/b.c_d e!f/ünïcode'), /^[A-Za-z0-9-]*$/)
})

/**
 * ## Whether it is safe to write the registry back
 *
 * The most expensive question in this file, and it had no answer of its own.
 *
 * `main.ts` guards writes with a flag and a message that names the harm exactly: "refusing to
 * write the session registry ... that would replace every conversation this workspace remembers
 * with whatever happens to be in memory." The flag was set unconditionally after reading, so it
 * covered writing *before* the read and not writing after one that **failed**.
 *
 * Reproduced in the running app before it was fixed: a `sessions.json` truncated mid-array --
 * two whole records present, needing a closing brace a person could have typed -- and closing a
 * single conversation replaced the file with one new record. Both were gone, and nothing on
 * screen had said the history was at risk.
 *
 * `missing` is deliberately a yes: there is nothing to lose, and the first write is what creates
 * the file in a new workspace. Reading that as "not ok, so refuse" would mean no workspace ever
 * got a registry at all.
 */

test('a registry that was read is safe to write back', () => {
  assert.equal(mayWriteRegistry('ok'), true)
})

test('a registry that is not there yet is safe to write, or no workspace ever gets one', () => {
  assert.equal(
    mayWriteRegistry('missing'),
    true,
    'a workspace with no registry can never write its first one, so nothing is ever remembered',
  )
})

test('a registry that would not parse is never written over', () => {
  assert.equal(
    mayWriteRegistry('unreadable'),
    false,
    'writing over a registry that would not parse replaces every conversation the workspace ' +
      'remembers with whatever this process holds — which, after a failed read, is nothing. A ' +
      'truncated one usually has every record but the last intact and wants a closing brace.',
  )
})

/**
 * ## The one verdict that can expire while you hold it
 *
 * `mayWriteRegistry` answers from a read that already happened, and the answer authorises a
 * write that has not. `office-space-6c` reviewed that and found the asymmetry:
 *
 *     ok          file changed since   last-writer-wins, accepted by design
 *     unreadable  now readable         we refuse anyway; merely conservative
 *     missing     now EXISTS           "nothing to lose" is false, and the write destroys it
 *
 * Only one can flip in the dangerous direction, and it is the one whose whole justification is a
 * claim about a moment rather than a property of the workspace.
 *
 * It is also the verdict that is *normal* to hold twice. There is no single-instance lock, so
 * two copies opening the same fresh workspace both read `missing` and both believe they may
 * create. The first records forty conversations; the second replaces them with two. The verdict
 * is held for the life of the process — `openRegistry` runs once — so the window is not
 * milliseconds, it is the whole session.
 *
 * `wx` moves the question from a remembered fact to the syscall: create only if still absent.
 */

test('creating refuses rather than replaces when a registry has appeared', async (t) => {
  const root = await workspace(t)

  // Another copy of the app got there first and has recorded real work.
  await saveRegistry(root, [session({ id: 'theirs-1' }), session({ id: 'theirs-2' })], { create: true })

  await assert.rejects(
    () => saveRegistry(root, [session({ id: 'mine' })], { create: true }),
    /one appeared while this office was running/,
    'a second process holding a stale "missing" overwrote a registry that had appeared since',
  )

  const after = await loadRegistry(root)
  assert.equal(after.state, 'ok')
  assert.deepEqual(
    after.state === 'ok' ? after.sessions.map((s) => s.id).sort() : [],
    ['theirs-1', 'theirs-2'],
    'the other office\'s conversations were destroyed by a write authorised before they existed',
  )
})

test('creating works when the registry really is absent', async (t) => {
  // The control. A guard that refused every create would pass the test above and stop any
  // workspace ever getting its first registry.
  const root = await workspace(t)
  await saveRegistry(root, [session({ id: 'first' })], { create: true })

  const loaded = await loadRegistry(root)
  assert.equal(loaded.state, 'ok', 'a fresh workspace could not create its first registry')
  assert.deepEqual(loaded.state === 'ok' ? loaded.sessions.map((s) => s.id) : [], ['first'])
})

test('an ordinary save still replaces, because by then the file is ours', async (t) => {
  // After the create, the process knows the registry exists and is its own. Every write after
  // that is the temp-and-rename that has always been there, and must still overwrite.
  const root = await workspace(t)
  await saveRegistry(root, [session({ id: 'first' })], { create: true })
  await saveRegistry(root, [session({ id: 'first' }), session({ id: 'second' })])

  const loaded = await loadRegistry(root)
  assert.deepEqual(
    loaded.state === 'ok' ? loaded.sessions.map((s) => s.id).sort() : [],
    ['first', 'second'],
    'a normal save stopped being able to update the registry',
  )
})

test('the refusal is a class, so a caller can do something about it', () => {
  /**
   * Refusing to overwrite is right and, on its own, **terminal**. `registryIsOurs` stays true, so
   * every write for the rest of the run is refused the same way and the second office can never
   * record anything again.
   *
   * Measured with two real instances on one fresh workspace: the first created the file, the
   * second was correctly refused — and then could not close a conversation for as long as it was
   * open, with a message that said why and offered nothing.
   *
   * So the refusal carries a type. `main.ts` catches it, re-reads, merges what it holds on top,
   * and carries on as an ordinary writer — which is exactly the state it would have been in had
   * it started a second later. Matching on the sentence instead is how that recovery stops
   * working the day somebody rewords the error.
   */
  const err = new RegistryAppeared()
  assert.equal(err instanceof Error, true, 'a caller catching Error would miss it')
  assert.equal(err.name, 'RegistryAppeared')
  assert.match(err.message, /another copy is recording to it/, 'the sentence still says why, for a reader')
})

test('adopting keeps both offices\' conversations, and does not duplicate a shared one', async (t) => {
  // The merge `main.ts` does after a refusal, exercised where a test can reach it. `upsert` per
  // record rather than a concatenation, because two offices can hold the same conversation — the
  // same id, opened in both — and two rows for one conversation is a duplicate the registry has
  // no way to resolve later.
  const root = await workspace(t)
  await saveRegistry(root, [session({ id: 'theirs' }), session({ id: 'shared', title: 'their title' })], { create: true })

  const loaded = await loadRegistry(root)
  assert.equal(loaded.state, 'ok')

  let merged = loaded.state === 'ok' ? [...loaded.sessions] : []
  for (const ours of [session({ id: 'ours' }), session({ id: 'shared', title: 'our title' })]) {
    merged = upsert(merged, ours)
  }
  await saveRegistry(root, merged)

  const after = await loadRegistry(root)
  assert.deepEqual(
    after.state === 'ok' ? after.sessions.map((s) => s.id).sort() : [],
    ['ours', 'shared', 'theirs'],
    'a conversation was lost or duplicated by the merge',
  )
  assert.equal(
    after.state === 'ok' ? after.sessions.find((s) => s.id === 'shared')?.title : null,
    'our title',
    'the office doing the writing did not win on a conversation both hold',
  )
})

/*
 * Two windows on one workspace, and the record one of them was not holding.
 *
 * A second office starts by reading the registry, so its memory holds the first office's records
 * **as they were at that moment**. Writing all of its records back puts those stale copies over
 * whatever the first office has written since.
 *
 * Measured with two real instances: both had a conversation, both answered, and both showed
 * `$0.0488` on screen. On disk one of them had `costUsd: null` — the other office had saved its
 * startup snapshot of that record over the newer one. The screen was right and the durable record
 * was wrong, which is the direction that matters.
 */
test('a record nobody here has touched keeps what the office that touched it wrote', () => {
  const theirsOnDisk: SessionRecord = {
    ...session({ id: 'theirs' }),
    costUsd: 0.0488,
    updatedAt: '2026-08-28T12:00:05.000Z',
  }
  // What we read at startup, five seconds before they wrote the cost.
  const theirsStale: SessionRecord = { ...theirsOnDisk, costUsd: null, updatedAt: '2026-08-28T12:00:00.000Z' }
  const ours: SessionRecord = { ...session({ id: 'ours' }), updatedAt: '2026-08-28T12:00:09.000Z' }

  const merged = mergeNewest([theirsOnDisk], [theirsStale, ours])

  assert.equal(merged.find((s) => s.id === 'theirs')?.costUsd, 0.0488, 'their newer row survived ours')
  assert.ok(merged.some((s) => s.id === 'ours'), 'and ours is still written')
  assert.equal(merged.length, 2, 'one row per conversation, which is what upsert was for')
})

test('our own newer record still wins, and a record only we have is kept', () => {
  const old: SessionRecord = { ...session({ id: 'a' }), costUsd: null, updatedAt: '2026-08-28T12:00:00.000Z' }
  const ours: SessionRecord = { ...session({ id: 'a' }), costUsd: 0.5, updatedAt: '2026-08-28T12:00:09.000Z' }
  const onlyOurs: SessionRecord = { ...session({ id: 'b' }), updatedAt: '2026-08-28T12:00:01.000Z' }

  const merged = mergeNewest([old], [ours, onlyOurs])
  assert.equal(merged.find((s) => s.id === 'a')?.costUsd, 0.5, 'newer is newer whoever wrote it')
  assert.ok(merged.some((s) => s.id === 'b'), 'a conversation only this office has is not dropped')
})

test('a tie goes to the office doing the writing', () => {
  const same = '2026-08-28T12:00:00.000Z'
  const disk: SessionRecord = { ...session({ id: 'a' }), costUsd: null, updatedAt: same }
  const mine: SessionRecord = { ...session({ id: 'a' }), costUsd: 0.25, updatedAt: same }

  assert.equal(mergeNewest([disk], [mine]).find((s) => s.id === 'a')?.costUsd, 0.25)
})

/*
 * Two windows on one workspace, and a close only one of them made.
 *
 * Closing sets `closed: true` on the record it finds and leaves `updatedAt` where it was (the
 * close handler in `main.ts`). A second office that read the registry before the close still holds
 * that record open, at the same `updatedAt`, and a tie went to the office doing the saving. So the
 * second office's next save, whichever conversation it was for, took the flag off the disk, and
 * `sessionsFor` listed the conversation again.
 *
 * Found in review of #240, and measured at the level of these functions. Nobody has watched it
 * happen with two windows open.
 */
test('a close survives a save by an office still holding the conversation open', () => {
  const open = session({ id: 'x', project: 'billing', updatedAt: '2026-09-10T09:00:00.000Z' })

  // On disk, what the closing office wrote. In memory, the other office's copy from before it.
  const merged = mergeNewest([{ ...open, closed: true }], [open])

  assert.equal(
    merged.find((s) => s.id === 'x')?.closed,
    true,
    "another office's open copy, no newer than the close, took the close off the disk",
  )
  assert.deepEqual(
    sessionsFor(merged, 'billing', '/work/office').map((s) => s.id),
    [],
    'a conversation somebody closed in another window is back in the list',
  )
})

test('a tie keeps a close from either side, and the rest of the record from this office', () => {
  const open = session({ id: 'x', project: 'billing', updatedAt: '2026-09-10T09:00:00.000Z' })

  // This office closed it, and the copy on disk is the other office's open one.
  assert.equal(
    mergeNewest([open], [{ ...open, closed: true }]).find((s) => s.id === 'x')?.closed,
    true,
    'the open copy on disk took back the close this office is saving',
  )
  // The other way round, with a second difference: only the close comes from the disk. Two writes
  // in one millisecond is the case `a tie goes to the office doing the writing` already builds.
  const closedOnDisk: SessionRecord = { ...open, closed: true, costUsd: null }
  const costedHere: SessionRecord = { ...open, costUsd: 0.25 }
  assert.equal(
    mergeNewest([closedOnDisk], [costedHere]).find((s) => s.id === 'x')?.costUsd,
    0.25,
    'keeping the close took the rest of the record from the disk as well',
  )
})

/*
 * Reopening is a newer write, so a close is kept only on a tie.
 *
 * Nothing un-closes a record on purpose. A closed conversation opened again by its id (the resume
 * on an unfinished dispatch's card does this) gets a fresh record from `remember` the next time its
 * state changes: `updatedAt` moved on, and no `closed`. Read in `main.ts`, not run in the app. A
 * close that stuck past a tie would hide that conversation again on the next save, from whichever
 * office still held the older closed copy.
 */
test('a newer write still reopens a closed conversation, whichever office holds it', () => {
  const closed = session({ id: 'x', project: 'billing', updatedAt: '2026-09-10T09:00:00.000Z', closed: true })
  const reopened = session({ id: 'x', project: 'billing', updatedAt: '2026-09-10T09:05:00.000Z' })

  assert.equal(
    mergeNewest([closed], [reopened]).find((s) => s.id === 'x')?.closed,
    undefined,
    'this office reopened it, and the older close on disk hid it again',
  )
  assert.equal(
    mergeNewest([reopened], [closed]).find((s) => s.id === 'x')?.closed,
    undefined,
    "another office reopened it, and this office's older closed copy hid it again",
  )
})

/*
 * The same close, seen from the office that is still in the conversation.
 *
 * The tie rule puts another office's close into this office's memory at this office's next save,
 * whichever conversation that save is for, and that is what keeps the close on disk. This office's
 * list is drawn from the same memory. So office B, sitting in `x` (perhaps mid-turn) when office A
 * closed it, dropped `x` from its list after its next save for `y`: `sessionsFor` hides a closed
 * record, and `shownSessions` does not add back a live one whose record says closed. B's project
 * row counts that list and asks it whether anything is running (`rowFor` in `main.ts`), so it
 * stopped counting `x` and stopped saying it was working, while `x` ran in B's window. Found in
 * review of #257, at the level of these functions. Nobody has watched it with two windows.
 *
 * A close now hides a conversation Claude has confirmed only when this process holds nothing for it.
 * `main.ts` answers that from `managers`, and this office's own close takes the conversation out of
 * `managers` (`repo-health.test.ts` checks the close handler for that), so what this office closes
 * still goes.
 */
test('a conversation this office still holds stays listed after another office closes it', () => {
  const x = session({ id: 'x', project: 'billing', updatedAt: '2026-09-10T09:00:00.000Z' })
  const y = session({ id: 'y', project: 'billing', updatedAt: '2026-09-10T08:00:00.000Z' })
  const read = [x, y]

  // Office A closes `x`, and its save puts the close on disk.
  const inA = upsert(read, { ...x, closed: true })
  const disk = mergeNewest(read, inA)
  // Office B, still in `x`, saves for `y`. What B holds afterwards is also what it writes.
  const inB = mergeNewest(disk, upsert(read, { ...y, updatedAt: '2026-09-10T09:30:00.000Z' }))
  const shown = (sessions: readonly SessionRecord[], live: string | null, held: readonly string[]) =>
    shownSessions(sessions, 'billing', '/work/office', live === null ? null : { id: live }, new Set(held))
      .map((s) => s.id)

  assert.equal(inB.find((s) => s.id === 'x')?.closed, true, "office B's save took A's close off the disk")
  assert.deepEqual(
    shown(inB, 'x', ['x', 'y']),
    ['y', 'x'],
    'office B stopped listing, and so stopped counting, the conversation it is sitting in',
  )
  assert.deepEqual(
    shown(inB, 'y', ['x', 'y']),
    ['y', 'x'],
    'office B stopped listing a conversation it still has open behind the one on screen',
  )
  assert.deepEqual(
    shown(inB, 'y', ['y']),
    ['y'],
    'office B still lists a conversation another office closed, after B stopped holding it',
  )
  // Office A's next save reads B's write. A's own close released `x`, so A holds nothing for it.
  assert.deepEqual(
    shown(mergeNewest(inB, inA), null, []),
    ['y'],
    'the conversation office A closed is back in its list',
  )
})

test('holding a conversation outweighs a close, and nothing else the list leaves out', () => {
  const rows = [
    session({ id: 'another project', project: 'payments', closed: true }),
    session({ id: 'another workspace', project: 'billing', cwd: '/work/elsewhere', closed: true }),
    session({ id: 'never confirmed, closed', project: 'billing', opened: false, closed: true }),
    session({ id: 'never confirmed', project: 'billing', opened: false }),
  ]
  assert.deepEqual(
    shownSessions(rows, 'billing', '/work/office', null, { has: () => true }).map((s) => s.id),
    [],
    'holding a conversation listed one this project would not list even if nobody had closed it',
  )
})

/*
 * Which conversations this process holds is for `main.ts` to say, and no test can load `main.ts`.
 *
 * So this reads the source, like the ordering check above. It finds `sessionListOf`, the list the
 * panel draws and the project row counts, and asks whether its call to `shownSessions` is handed
 * `managers`. It cannot tell whether the answer is right, only that one is given. Without one, the
 * parameter falls back to "holds nothing", and the two tests above pass while the app drops the
 * conversation anyway.
 */
test('the list main.ts draws is told which conversations this process holds', async () => {
  const main = await readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8')

  const at = main.indexOf('function sessionListOf(')
  assert.ok(at > 0, '`sessionListOf` is gone from main.ts; this check needs rewriting')
  const call = main.indexOf('shownSessions(', at)
  assert.ok(
    call > at && call < main.indexOf('\n}\n', at),
    '`sessionListOf` no longer calls `shownSessions`; this check needs rewriting',
  )

  // The call's arguments, by matching brackets, because `liveFor(key)` closes one of its own.
  let depth = 0
  let end = -1
  for (let i = main.indexOf('(', call); i < main.length && end < 0; i++) {
    if (main[i] === '(') depth++
    else if (main[i] === ')' && --depth === 0) end = i
  }
  assert.ok(end > call, 'the call to `shownSessions` is never closed; main.ts does not parse')
  // Comments out, both kinds: `/* managers */` in place of the argument passed a first draft of this.
  const args = main
    .slice(call, end + 1)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  // The last argument, whole. A review found that asking only whether the word appears passed a
  // call that looked the live conversation up in `managers` and dropped `held`, and one that
  // passed `managers && new Set()`.
  const inner = args.slice(args.indexOf('(') + 1, -1)
  const parts: string[] = []
  let level = 0
  let from = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === '(' || c === '[' || c === '{') level++
    else if (c === ')' || c === ']' || c === '}') level--
    else if (c === ',' && level === 0) {
      parts.push(inner.slice(from, i).trim())
      from = i + 1
    }
  }
  parts.push(inner.slice(from).trim())
  assert.equal(parts.length, 5, `\`shownSessions\` is called with ${parts.length} arguments, not five: ${parts.join(' | ')}`)
  assert.equal(
    parts[4],
    'managers',
    '`sessionListOf` does not tell `shownSessions` which conversations this process holds, so a ' +
      'conversation another office closed drops out of this office while it is still open here',
  )
})

test('closing a conversation here releases it before the list is pushed', async () => {
  // What keeps this office's own close from being overridden by `held`: the close handler takes the
  // conversation out of `managers` before it pushes the list. Read as text, because main.ts
  // imports electron and no test can run the handler. A review measured that moving the delete
  // after `pushSessions` passed every test.
  const main = await readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8')
  const mark = main.indexOf('sessions = upsert(sessions, { ...base, closed: true })')
  assert.ok(mark > 0, 'the close handler no longer marks the record closed this way; this check needs rewriting')
  const start = main.lastIndexOf('ipcMain.handle(', mark)
  const end = main.indexOf('ipcMain.handle(', mark)
  const handler = main.slice(start, end < 0 ? undefined : end)

  const release = handler.indexOf('managers.delete(key)')
  const push = handler.indexOf('pushSessions(project)')
  assert.ok(release > 0, 'the close handler no longer releases the conversation from `managers`')
  assert.ok(push > 0, 'the close handler no longer pushes the list')
  assert.ok(
    release < push,
    'the close handler pushes the list before it releases the conversation, so the list it pushes ' +
      'still holds the conversation it has just closed',
  )
})


// ────────────────────────── attributing a held call to an office ──

test('a session is placed in its project, whether or not anybody opened it', () => {
  /*
   * The gate writes a session id and nothing else — `ApprovalRequest` carries no project — so a
   * held tool call can only be attributed against this registry.
   *
   * The renderer used to do it from a map it fills while opening projects, and that map only
   * ever holds the office you are looking at: `watchSessions` returns early on
   * `list.project !== active`. So a call held in an office nobody had opened drew no mark, which
   * is exactly the office the campus exists to point at. This is the lookup that replaced it,
   * and it answers from one workspace-wide array loaded at startup.
   */
  const sessions = [
    session({ id: 'a', project: 'auth-refresh' }),
    session({ id: 'b', project: 'billing' }),
    // The "whether or not anybody opened it" half, which this test named and did not build:
    // `session()` hardcodes `opened: true`, so every row was an opened one and the title was
    // asserted by nothing. Adding `s.opened &&` to the lookup passed 2587 tests green — and it
    // is the *consistency* edit, since `resumable` and `sessionsFor`, the functions either side
    // of this one in the same file, both filter on `opened`.
    session({ id: 'c', project: 'billing', opened: false }),
  ]

  assert.equal(projectOfSession(sessions, 'a'), 'auth-refresh')
  assert.equal(projectOfSession(sessions, 'b'), 'billing', 'a second project was not reachable')
  assert.equal(
    projectOfSession(sessions, 'c'),
    'billing',
    'a session nobody has opened was treated as unplaceable — a held call in it would draw no mark',
  )
})

test("the office's own conversations place as the office, not as unplaceable", () => {
  // `OFFICE_PROJECT` is the empty string and is the majority of rows on a real registry. A
  // lookup that returned `null` for it — or a caller testing the result for truthiness — drops
  // every held call in the default project.
  assert.equal(projectOfSession([session({ id: 'c', project: '' })], 'c'), '')
})

test('a session the registry has never seen is null, not the first project in the list', () => {
  /*
   * A plain `claude` started in this workspace outside the office writes no registry row, so its
   * held calls are genuinely unplaceable. `null` says so. Returning anything else would put
   * somebody else's held call on a card.
   */
  assert.equal(projectOfSession([session({ id: 'd', project: 'billing' })], 'unknown'), null)
  assert.equal(projectOfSession([], 'anything'), null)
})
