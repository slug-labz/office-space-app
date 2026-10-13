/**
 * A save keeps the registry rows it could not read, and says which conversations it left out.
 *
 * `parseRegistry` keeps the rows it can read and counts the rest as `skipped`. The save wrote only
 * what had been read, so one load and one save deleted the rest from `.office-space/sessions.json`,
 * and the next read counted nothing skipped. Measured on dev at e6fe5cb by another agent, and again
 * by the tests below before the fix.
 *
 * A row this version cannot read is not always a broken one. Two offices on one workspace share
 * this file, and a newer build can write a row this one does not understand. Deleting that row is
 * the writing side of the fourth standing order, and `connectors.ts` states the same rule for
 * `.mcp.json`: never lose what is already there.
 *
 * "Could not read" is `parseRegistry`'s own test: an object with a non-empty string `id` and a
 * string `cwd`. A newer shape fails it only if it moves or retypes one of those two. A row that
 * passes is read and managed, whatever else it carries.
 *
 * Keeping such a row means not writing this office's copy of the same conversation over it, and a
 * review measured what that cost while it was silent: a close that was never written came back as
 * done, and a conversation whose row a hand edit broke was "saved" while the file kept the broken
 * row. So the save now throws `RowsLeftOut` once it has written everything else.
 *
 * The saves here are the ones `writeRegistry` in `main.ts` makes, copied because `main.ts` imports
 * electron and no test can load it: read the file once, `mergeNewest` what the office holds over
 * what was read, and hand `saveRegistry` the result and that same read. When the office's first
 * write, a create, is refused because another office made the file first, it reads that file and
 * does the same.
 *
 * The last four tests parse `main.ts`. They check that it still makes those calls, in that order,
 * and that each `try` around a save is as written there, with its `catch` and no `finally`:
 * - `writeRegistry`'s first save rethrows every failure but `RegistryAppeared`, which goes on to
 *   the adoption, whose read and save are steps of the task outside any `try`. `writeRegistry`
 *   awaits that task as a step of its own, queued on `writeRegistryQueue`, which is bound once, to
 *   `serial()` from `./serial.js`. `serial.test.ts` checks that `serial()` passes a task's failure
 *   on to the caller that queued it. So what the task throws reaches `writeRegistry`'s callers.
 * - `remember` hands every failure of its save to `setRegistryProblem`, through
 *   `registrySaveProblem`, and does nothing after that.
 * - The close handler rethrows a failure unless `writtenDespite` says the close was written, and
 *   otherwise hands it on as `remember` does. Only the push and the answer come after.
 * - Each function and class those steps use is bound once, at the top of `main.ts`, so no binding
 *   of the same name inside a function takes the call.
 *
 * They read the source and do not run it. Not covered: what `setRegistryProblem`, `outcomeOf` and
 * the panel do with a failure, which is read, not tested; and the steps before each save that these
 * checks do not name, other than that none of them returns. The close handler's `key`, the id it
 * asks `writtenDespite` about, is one of those.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import ts from 'typescript'

import {
  loadRegistry,
  mergeNewest,
  RegistryAppeared,
  registryPath,
  registrySaveProblem,
  RowsLeftOut,
  saveRegistry,
  writtenDespite,
  type SessionRecord,
} from '../src/main/registry.js'
import { describeProblem } from '../src/shared/problem-view.js'
import { tempDir } from './temp-dir.js'

const CWD = '/work/office'
const EARLIER = '2026-09-17T09:00:00.000Z'
const LATER = '2026-09-17T10:00:00.000Z'
const LATEST = '2026-09-17T11:00:00.000Z'

const row = (id: string, over: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  mode: 'building',
  project: '',
  cwd: CWD,
  agent: 'manager',
  createdAt: EARLIER,
  updatedAt: EARLIER,
  costUsd: null,
  title: null,
  opened: true,
  ...over,
})

/** A newer office's row: a real id, and the working directory moved where this version does not look. */
const NEWER = {
  id: 'from-a-newer-office',
  project: 'billing',
  workspace: { cwd: CWD, host: 'studio' },
  agent: 'manager',
  createdAt: EARLIER,
  updatedAt: LATER,
  turns: [{ at: LATER, costUsd: 0.0421 }],
  opened: true,
}

/** Rows `parseRegistry` rejects, one for each way of failing its test. */
const UNREAD: readonly unknown[] = [
  42,
  'a row that is only a string',
  null,
  ['an', 'array'],
  { cwd: CWD, title: 'no id' },
  { id: '', cwd: CWD },
  { id: 7, cwd: CWD },
  { id: 'cwd-is-not-a-string', cwd: { path: CWD } },
  NEWER,
]

/** Replace the file's rows, as another office or a person editing it would. */
const putRows = (root: string, rows: readonly unknown[]): Promise<void> =>
  writeFile(registryPath(root), `${JSON.stringify({ version: 1, sessions: rows }, null, 2)}\n`, 'utf8')

/** A workspace with an empty `.office-space`, removed when the test that asked for it ends. */
async function workspace(t: TestContext): Promise<string> {
  const root = await tempDir(t, 'office-keep-rows-')
  await mkdir(dirname(registryPath(root)), { recursive: true })
  return root
}

/** A workspace whose registry holds exactly `rows`, written as text so an unreadable row stays one. */
async function registryWith(t: TestContext, rows: readonly unknown[]): Promise<string> {
  const root = await workspace(t)
  await putRows(root, rows)
  return root
}

/** Every row in the file as JSON, read without `parseRegistry`. */
async function rowsIn(root: string): Promise<unknown[]> {
  const file = JSON.parse(await readFile(registryPath(root), 'utf8')) as { sessions: unknown[] }
  return file.sessions
}

/** What is in `.office-space`. A save leaves the registry there and nothing beside it. */
const besideIt = (root: string): Promise<string[]> => readdir(dirname(registryPath(root)))

/** How many of `rows` are JSON-equal to `wanted`. */
const times = (rows: readonly unknown[], wanted: unknown): number =>
  rows.filter((r) => isDeepStrictEqual(r, wanted)).length

/** The rows whose `id` is `id`, whether or not this version can read them. */
const withId = (rows: readonly unknown[], id: string): unknown[] =>
  rows.filter((r) => typeof r === 'object' && r !== null && (r as { id?: unknown }).id === id)

/** What an office holds after `openRegistry`: the rows the read could use. */
async function openOffice(root: string): Promise<SessionRecord[]> {
  const loaded = await loadRegistry(root)
  assert.equal(loaded.state, 'ok', 'the fixture should open')
  return loaded.state === 'ok' ? [...loaded.sessions] : []
}

/** The save `writeRegistry` makes once the file is this office's: one read, merged over, handed on. */
async function save(root: string, held: readonly SessionRecord[]): Promise<SessionRecord[]> {
  const onDisk = await loadRegistry(root)
  const merged = onDisk.state === 'ok' ? mergeNewest(onDisk.sessions, held) : [...held]
  await saveRegistry(root, merged, { read: onDisk })
  return merged
}

/** The save `writeRegistry` makes when its create is refused: adopt the other office's file. */
async function adopt(root: string, held: readonly SessionRecord[]): Promise<void> {
  await assert.rejects(saveRegistry(root, held, { create: true }), RegistryAppeared)
  const theirs = await loadRegistry(root)
  if (theirs.state !== 'ok') throw new RegistryAppeared()
  await saveRegistry(root, mergeNewest(theirs.sessions, held), { read: theirs })
}

/** What `promise` rejected with, or `undefined` when it did not. */
const failure = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (err: unknown) => err,
  )

/** The one field a test is about, from the record the next read gives for `id`. */
async function fieldOf<K extends keyof SessionRecord>(root: string, id: string, key: K): Promise<unknown> {
  const loaded = await loadRegistry(root)
  return loaded.state === 'ok' ? loaded.sessions.find((s) => s.id === id)?.[key] : loaded.state
}

/** What the next read says: the ids it can use, and how many rows it could not. */
async function reread(root: string): Promise<{ readonly ids: string[]; readonly skipped: number | string }> {
  const loaded = await loadRegistry(root)
  if (loaded.state !== 'ok') return { ids: [], skipped: loaded.state }
  return { ids: loaded.sessions.map((s) => s.id).sort(), skipped: loaded.skipped }
}

const once = UNREAD.map(() => 1)

test('one load and one save keep every row the registry could not read', async (t) => {
  const root = await registryWith(t, [row('kept-1'), ...UNREAD.slice(0, 4), row('kept-2'), ...UNREAD.slice(4)])
  const held = await openOffice(root)
  // The control: this version really cannot read the other rows.
  assert.deepEqual(await reread(root), { ids: ['kept-1', 'kept-2'], skipped: UNREAD.length })

  // What the office does next: a cost lands on one conversation, and a new one starts.
  await save(root, [
    ...held.map((s) => (s.id === 'kept-1' ? { ...s, costUsd: 0.25, updatedAt: LATER } : s)),
    row('new-here', { updatedAt: LATER }),
  ])

  const rows = await rowsIn(root)
  assert.deepEqual(
    UNREAD.filter((u) => times(rows, u) === 0),
    [],
    'the save deleted rows it could not read',
  )
  assert.deepEqual(
    await reread(root),
    { ids: ['kept-1', 'kept-2', 'new-here'], skipped: UNREAD.length },
    'the next read no longer counts them, so nothing can report them',
  )
  assert.equal(await fieldOf(root, 'kept-1', 'costUsd'), 0.25, 'the rows this office manages were not written')
  assert.deepEqual(await besideIt(root), ['sessions.json'], 'the save left a file beside the registry')
})

test('a second save, and a save by another office, write each of them once', async (t) => {
  const root = await registryWith(t, [row('kept-1'), ...UNREAD])
  // Two offices open the same file, and each saves its own work.
  const opened = await openOffice(root)

  const here = await save(root, [...opened, row('here-1')])
  await save(root, [...opened, row('there-1')])
  await save(root, [...here, row('here-2')])

  const rows = await rowsIn(root)
  assert.deepEqual(
    UNREAD.map((u) => times(rows, u)),
    once,
    'a row this version could not read was lost, or written more than once',
  )
  assert.deepEqual(await reread(root), {
    ids: ['here-1', 'here-2', 'kept-1', 'there-1'],
    skipped: UNREAD.length,
  })
  assert.equal(rows.length, 4 + UNREAD.length, 'the file holds rows nobody wrote')
})

test("an office adopting a registry another office created keeps the rows it could not read", async (t) => {
  // This office read `missing`, so its first write is a create. A newer office made the file first.
  const root = await registryWith(t, [row('theirs'), ...UNREAD])

  await adopt(root, [row('mine')])

  const rows = await rowsIn(root)
  assert.deepEqual(
    UNREAD.map((u) => times(rows, u)),
    once,
    "adopting the other office's file lost, or doubled, a row this version could not read",
  )
  assert.deepEqual(await reread(root), { ids: ['mine', 'theirs'], skipped: UNREAD.length })
})

test('a row repaired while the office was open is written once, as a row', async (t) => {
  const broken = { id: 'repaired', title: 'lost its working directory' }
  const root = await registryWith(t, [row('kept-1'), broken, ...UNREAD])
  const opened = await openOffice(root)

  // Somebody puts the working directory back by hand. The office read the row as unreadable, and
  // must not write that old copy next to the repaired one.
  await putRows(root, [row('kept-1'), { ...broken, cwd: CWD }, ...UNREAD])
  await save(root, [...opened, row('new-here')])

  assert.equal(withId(await rowsIn(root), 'repaired').length, 1, 'the repaired row is in the file twice')
  assert.deepEqual(await reread(root), {
    ids: ['kept-1', 'new-here', 'repaired'],
    skipped: UNREAD.length,
  })
})

test('a conversation a newer office rewrote is not written back beside its row, and the save says so', async (t) => {
  const root = await registryWith(t, [row('shared'), row('kept-1')])
  const opened = await openOffice(root)

  // A newer office takes the conversation on and writes it in a shape this version cannot read.
  const theirs = { ...NEWER, id: 'shared' }
  await putRows(root, [theirs, row('kept-1')])

  // This office still holds its copy from before, and touches it. Newer by the clock, and still not
  // written: this version cannot tell which of the two is current, and its shape over theirs would
  // delete whatever the newer office added.
  const error = await failure(
    save(root, opened.map((s) => (s.id === 'shared' ? { ...s, costUsd: 0.9, updatedAt: LATEST } : s))),
  )

  assert.ok(error instanceof RowsLeftOut, `the save left this office's copy out and said nothing: ${String(error)}`)
  assert.deepEqual(error.ids, ['shared'], 'the save named the wrong conversations')
  assert.deepEqual(
    withId(await rowsIn(root), 'shared'),
    [theirs],
    "the newer office's row was replaced, or this office's copy was written beside it",
  )
  assert.deepEqual(await reread(root), { ids: ['kept-1'], skipped: 1 })
})

test('a file that already holds an id both ways keeps both, and the readable one still takes an update', async (t) => {
  const theirs = { ...NEWER, id: 'both' }
  const root = await registryWith(t, [row('both'), theirs])
  const opened = await openOffice(root)

  await save(root, opened.map((s) => ({ ...s, costUsd: 0.5, updatedAt: LATER })))

  assert.equal(times(await rowsIn(root), theirs), 1, 'the row this version cannot read was lost')
  const loaded = await loadRegistry(root)
  assert.deepEqual(
    loaded.state === 'ok' ? loaded.sessions.map((s) => [s.id, s.costUsd]) : loaded.state,
    [['both', 0.5]],
    "the row this version can read was dropped, or did not take this office's update",
  )
})

test('a registry that stopped parsing while the office was open is refused, not written over', async (t) => {
  const root = await registryWith(t, [row('kept-1'), ...UNREAD])
  const opened = await openOffice(root)

  // Cut off halfway, as a torn write or a bad hand edit can leave it.
  const whole = await readFile(registryPath(root), 'utf8')
  const torn = whole.slice(0, Math.floor(whole.length / 2))
  await writeFile(registryPath(root), torn, 'utf8')

  await assert.rejects(save(root, [...opened, row('new-here')]), /refusing to write the session registry/)
  assert.equal(
    await readFile(registryPath(root), 'utf8'),
    torn,
    'every row in the file was replaced by what this office holds',
  )
  assert.deepEqual(await besideIt(root), ['sessions.json'], 'a refused save left a file beside the registry')
})

test('a registry deleted while the office was open is written again from what the office holds', async (t) => {
  // The control for the refusal above: a file that is not there has nothing in it to lose.
  const root = await registryWith(t, [row('kept-1'), ...UNREAD])
  const opened = await openOffice(root)
  await rm(registryPath(root))

  await save(root, [...opened, row('new-here')])

  assert.deepEqual(await reread(root), { ids: ['kept-1', 'new-here'], skipped: 0 })
})

test('a row this version can read is written once, whatever else it carries', async (t) => {
  // A newer shape that only adds fields passes `parseRegistry`'s test, so it is read and managed,
  // and it must not also be kept as a row that could not be read. This does not check its extra
  // fields: on 2026-09-17 the save dropped them, which is a separate loss from the one here.
  const extended = { ...row('extended'), turns: [{ at: LATER, costUsd: 0.01 }] }
  const root = await registryWith(t, [extended, ...UNREAD])
  const opened = await openOffice(root)

  await save(root, opened)

  assert.equal(withId(await rowsIn(root), 'extended').length, 1, 'a row this version reads was written twice')
  assert.deepEqual(await reread(root), { ids: ['extended'], skipped: UNREAD.length })
})

// ───────────────────────────────────────────────── one read, merged and kept ──

test('a save merged from a torn read is refused, even when the file is whole again by the time it writes', async (t) => {
  // A review's S2. The read the merge came from is the one refused. While the save checked a second
  // read of its own, a file torn at the first and whole at the second was written over with a list
  // that had merged nothing from it, and a row only the file held was lost.
  const root = await registryWith(t, [row('kept-1'), row('only-on-disk', { title: 'written by another office' })])
  const whole = await readFile(registryPath(root), 'utf8')
  await writeFile(registryPath(root), whole.slice(0, 40), 'utf8')

  // What `writeRegistry` does, with the other writer finishing between its read and its write.
  const read = await loadRegistry(root)
  const held = [row('kept-1', { costUsd: 0.5, updatedAt: LATER })]
  const merged = read.state === 'ok' ? mergeNewest(read.sessions, held) : held
  assert.equal(read.state, 'unreadable', 'the fixture should read as torn')
  await writeFile(registryPath(root), whole, 'utf8')

  const error = await failure(saveRegistry(root, merged, { read }))
  assert.match(String(error), /refusing to write the session registry/, 'a list that merged nothing was written over the file')
  assert.equal(await readFile(registryPath(root), 'utf8'), whole, 'the file changed')
})

test('a row repaired between the read and the write is not dropped', async (t) => {
  // A review's S1. With two reads the row was in neither half: the merge read it as unreadable, so
  // `sessions` did not have it, and the second read found it readable, so it was not kept either.
  // With one read the copy that read saw is kept. The repair itself is lost when this write lands,
  // as any change made between the read and the write is.
  const broken = { id: 'repaired', title: 'lost its working directory' }
  const root = await registryWith(t, [row('kept-1'), broken])
  const held = await openOffice(root)
  const read = await loadRegistry(root)
  const merged = read.state === 'ok' ? mergeNewest(read.sessions, held) : held

  await putRows(root, [row('kept-1'), { ...broken, cwd: CWD }])
  await saveRegistry(root, merged, { read })

  assert.equal(withId(await rowsIn(root), 'repaired').length, 1, 'the row was dropped, or written twice')
})

test('the rows kept come from the read the save was merged from, not from a later one', async (t) => {
  const first = { ...NEWER, id: 'in-the-read' }
  const later = { ...NEWER, id: 'written-after-it' }
  const root = await registryWith(t, [row('kept-1'), first])
  const held = await openOffice(root)
  const read = await loadRegistry(root)
  const merged = read.state === 'ok' ? mergeNewest(read.sessions, held) : held

  // Another office replaces the file between this office's read and its write. What it wrote goes
  // when this write lands, as a readable row written there would. That window was there before any
  // row was kept, and keeping rows does not change it.
  await putRows(root, [row('kept-1'), later])
  await saveRegistry(root, merged, { read })

  const rows = await rowsIn(root)
  assert.deepEqual(
    [times(rows, first), times(rows, later)],
    [1, 0],
    'the rows kept did not come from the read the merge was made from',
  )
})

// ───────────────────────────────────────────── files that will not open ──

test('a registry this user cannot open is refused, and left as it was', async (t) => {
  const root = await registryWith(t, [row('kept-1'), row('kept-2')])
  await chmod(registryPath(root), 0o000)
  try {
    // Whether the lock holds is asked of the file, not of the code under test, which could read a
    // save that ignores the failure as a user the lock does not apply to. Root is such a user.
    const locked = await readFile(registryPath(root), 'utf8').then(
      () => false,
      () => true,
    )
    if (!locked) {
      t.skip('this user can read a 0o000 file (root can, whatever the mode bits say), so an unreadable registry cannot be made')
      return
    }

    // A save replaces the file by renaming a new one over it, and a new file does not have mode 000.
    // This user cannot open a 000 file to change it in place, so the mode says whether it was kept.
    const mode = async (): Promise<number> => (await stat(registryPath(root))).mode & 0o777
    const held = [row('kept-1', { costUsd: 1, updatedAt: LATER })]

    // With the read `writeRegistry` hands on.
    assert.match(String(await failure(save(root, held))), /refusing to write the session registry.*EACCES/)
    assert.equal(await mode(), 0, 'the file was replaced')
    assert.deepEqual(await besideIt(root), ['sessions.json'], 'a refused save left a file beside the registry')
    // And reading for itself, as a caller that hands on no read does.
    assert.match(String(await failure(saveRegistry(root, held))), /refusing to write the session registry.*EACCES/)
  } finally {
    await chmod(registryPath(root), 0o644)
  }
})

test('a registry path that is a directory is refused, and nothing is left beside it', async (t) => {
  const root = await workspace(t)
  await mkdir(registryPath(root))
  const held = [row('kept-1')]

  assert.match(String(await failure(save(root, held))), /refusing to write the session registry.*EISDIR/)
  assert.ok((await stat(registryPath(root))).isDirectory(), 'what was at the path was replaced')
  assert.deepEqual(await besideIt(root), ['sessions.json'], 'a refused save left a file beside the registry')
  assert.match(String(await failure(saveRegistry(root, held))), /refusing to write the session registry.*EISDIR/)
})

// ─────────────────────────────────────── what a save leaves out, it says ──

test("this office's own conversation, broken by a hand edit, is reported at every save, and its row is left alone", async (t) => {
  // A review's S5. While a save left the copy out silently, three saves "succeeded", the file kept
  // the broken row, and the next launch listed nothing.
  const root = await registryWith(t, [row('mine', { title: 'my work' }), row('other')])
  let held = await openOffice(root)
  const broken = { ...row('mine', { title: 'my work' }), cwd: null }
  await putRows(root, [broken, row('other')])

  for (const turn of [1, 2, 3]) {
    // A turn ends in both conversations, and each change is saved.
    held = held.map((s) => ({ ...s, costUsd: turn, updatedAt: `2026-09-17T10:0${turn}:00.000Z` }))
    const error = await failure(save(root, held))

    assert.ok(error instanceof RowsLeftOut, `save ${turn} left this office's conversation out and said nothing: ${String(error)}`)
    assert.deepEqual(error.ids, ['mine'], `save ${turn} named the wrong conversations`)
    assert.match(error.message, /^1 conversation was not saved: "my work" \(mine\)\. /, `the conversation is not named: ${error.message}`)
    assert.ok(error.message.includes(registryPath(root)), `the file is not named: ${error.message}`)
    assert.deepEqual(
      withId(await rowsIn(root), 'mine'),
      [broken],
      `save ${turn} replaced the broken row, or wrote this office's copy beside it`,
    )
    assert.equal(await fieldOf(root, 'other', 'costUsd'), turn, `save ${turn} did not write the rest`)
  }
  assert.deepEqual(await reread(root), { ids: ['other'], skipped: 1 })
})

test('closing a conversation a newer office rewrote is not reported as done, and its row is left alone', async (t) => {
  // A review's S4. The close handler marks the record closed, changes nothing else, and saves. It
  // answers from what that save threw, through `writtenDespite`; the last test checks main.ts does.
  const root = await registryWith(t, [row('shared', { title: 'shared work' }), row('kept-1')])
  const opened = await openOffice(root)
  const theirs = { ...NEWER, id: 'shared' }
  await putRows(root, [theirs, row('kept-1')])

  const closing = opened.map((s) =>
    s.id === 'shared' ? { ...s, closed: true } : { ...s, costUsd: 0.3, updatedAt: LATER },
  )
  const error = await failure(save(root, closing))

  assert.ok(error instanceof RowsLeftOut, `the close was not written and the save said nothing: ${String(error)}`)
  assert.deepEqual(error.ids, ['shared'], 'the save named the wrong conversations')
  assert.equal(writtenDespite(error, 'shared'), false, 'a close that was not written would be answered as done')
  assert.deepEqual(
    withId(await rowsIn(root), 'shared'),
    [theirs],
    "the newer office's row was replaced, or the close was written beside it",
  )
  assert.equal(await fieldOf(root, 'kept-1', 'costUsd'), 0.3, 'the rest of the save was not written')
})

test('a close is written, and stands, when the same save leaves out a different conversation', async (t) => {
  const root = await registryWith(t, [row('broken-later', { title: 'edited by hand' }), row('closing')])
  const opened = await openOffice(root)
  await putRows(root, [{ ...row('broken-later', { title: 'edited by hand' }), cwd: null }, row('closing')])

  const error = await failure(save(root, opened.map((s) => (s.id === 'closing' ? { ...s, closed: true } : s))))

  assert.ok(error instanceof RowsLeftOut, `the save left a conversation out and said nothing: ${String(error)}`)
  assert.deepEqual(error.ids, ['broken-later'], 'the save named the wrong conversations')
  assert.equal(await fieldOf(root, 'closing', 'closed'), true, 'the close was not written')
  assert.equal(writtenDespite(error, 'closing'), true, 'a close that was written would be answered as failed')

  // Every other failure left the registry as it was, whatever conversation is asked about.
  for (const other of [new Error('EACCES: permission denied'), new RegistryAppeared(), 'a string', undefined]) {
    assert.equal(writtenDespite(other, 'closing'), false, `a close would be answered as done after: ${String(other)}`)
  }
})

test("an office whose only conversation was left out is told, and so is one whose file has no row it can read", async (t) => {
  // A review's X10 and X11 passed the 23 tests this file had at dc13962: a save that threw only
  // when it also wrote something, and one that threw only when the file had a row this version
  // reads. Both are silent for this office.
  const root = await registryWith(t, [row('mine', { title: 'my work' })])
  const held = await openOffice(root)
  const broken = { ...row('mine', { title: 'my work' }), cwd: null }
  await putRows(root, [broken])

  // The office holds one conversation, and the file holds only its broken row.
  const alone = await failure(save(root, held.map((s) => ({ ...s, costUsd: 1, updatedAt: LATER }))))
  assert.ok(alone instanceof RowsLeftOut, `the only conversation was left out and the save said nothing: ${String(alone)}`)
  assert.deepEqual(alone.ids, ['mine'], 'the save named the wrong conversations')
  assert.deepEqual(await rowsIn(root), [broken], 'the broken row was replaced, or a copy was written beside it')

  // The same file, and a conversation started since: that one is written, and the save still says
  // what it left out.
  const withNew = await failure(save(root, [...held, row('new-here', { updatedAt: LATER })]))
  assert.ok(withNew instanceof RowsLeftOut, `the file had no row to read and the save said nothing: ${String(withNew)}`)
  assert.deepEqual(withNew.ids, ['mine'], 'the save named the wrong conversations')
  assert.deepEqual(await reread(root), { ids: ['new-here'], skipped: 1 })
})

test('closing the second of two conversations a save left out is not answered as done', async (t) => {
  // A review's X3, `writtenDespite` asking only about the first id left out, passed the 23 tests this
  // file had at dc13962.
  const root = await registryWith(t, [row('a'), row('b'), row('c')])
  const opened = await openOffice(root)
  const newer = (id: string) => ({ ...NEWER, id })
  await putRows(root, [newer('a'), newer('b'), row('c')])

  const error = await failure(save(root, opened.map((s) => (s.id === 'b' ? { ...s, closed: true } : s))))

  assert.ok(error instanceof RowsLeftOut, `the save left two conversations out and said nothing: ${String(error)}`)
  assert.deepEqual(error.ids, ['a', 'b'], 'the save named the wrong conversations, or in another order')
  assert.deepEqual(
    ['a', 'b', 'c'].map((id) => [id, writtenDespite(error, id)]),
    [
      ['a', false],
      ['b', false],
      ['c', true],
    ],
    'a close would be answered by what happened to a different conversation',
  )
  assert.deepEqual(withId(await rowsIn(root), 'b'), [newer('b')], "the close was written over the newer office's row")
})

test('a row whose id is not a string holds no conversation, whatever that id prints as', async (t) => {
  // `parseRegistry` reads an id only as a non-empty string, so `{ id: 7 }` is no conversation of this
  // office's, not even one called "7", and a row with no id is not one called "undefined". A review's
  // X6 compared the ids as strings, and passed the 23 tests this file had at dc13962. This pins the
  // rule; it is not a case anybody has reported.
  const root = await registryWith(t, [{ id: 7, cwd: CWD }, { cwd: CWD, title: 'no id' }])

  await save(root, [row('7'), row('undefined')])

  assert.deepEqual(await reread(root), { ids: ['7', 'undefined'], skipped: 2 })
})

test('what the office says about a save that left conversations out, and about one that wrote nothing', () => {
  const path = registryPath(CWD)
  const one = new RowsLeftOut(path, [row('mine', { title: 'my work' })])
  const problem = registrySaveProblem(CWD, one)

  // The rule decides where the first-run panel puts it (`firstRunState` in app.ts, read): three
  // rules become steps of their own, `no-claude-on-path`, `workspace-not-trusted` and
  // `app-quarantined`, and every other `lint` is listed as something the office noticed. It is also
  // not the rule that counts the rows a read skipped, `registry-rows-unreadable`.
  assert.deepEqual(
    problem.kind === 'lint' ? [problem.kind, problem.rule, problem.path] : [problem.kind],
    ['lint', 'registry-rows-left-out', path],
    'the problem is not the lint the panel lists as it is written',
  )
  const said = describeProblem(problem)
  assert.equal(said, one.message, 'the panel does not show the sentence the save wrote')
  assert.equal(
    said,
    `1 conversation was not saved: "my work" (mine). Its row in ${path} is in a form this version cannot ` +
      'use, so this office did not write its own copy over it. That row is kept as this version read it, ' +
      'and may be reformatted. Everything else was saved. If the row is damaged, repair it. If a newer ' +
      'version wrote it, keep it and use that version for this conversation.',
  )

  const three = new RowsLeftOut(path, [row('a'), row('b', { title: 'bee' }), row('c')])
  assert.deepEqual(three.ids, ['a', 'b', 'c'])
  assert.equal(
    three.message,
    `3 conversations were not saved: a, "bee" (b), c. Their rows in ${path} are in a form this version ` +
      'cannot use, so this office did not write its own copies over them. Those rows are kept as this ' +
      'version read them, and may be reformatted. Everything else was saved. If a row is damaged, repair ' +
      'it. If a newer version wrote it, keep it and use that version for that conversation.',
  )

  // Two things it said until a review, and must not say again. The row is not unchanged: a save
  // writes back what it parsed, and the review measured keys reordered, a big integer altered, -0
  // written as 0 and the row moved. And a row a newer version wrote is that version's copy, so the
  // advice is never to remove one.
  for (const sentence of [said, three.message]) {
    assert.doesNotMatch(sentence, /unchanged/, `the sentence says the row is unchanged: ${sentence}`)
    assert.doesNotMatch(sentence, /\b(remove|delete)\b/i, `the sentence advises removing the row: ${sentence}`)
  }

  const seven = new RowsLeftOut(path, ['1', '2', '3', '4', '5', '6', '7'].map((id) => row(id)))
  assert.equal(seven.ids.length, 7, 'the error does not carry every id it left out')
  assert.match(seven.message, /^7 conversations were not saved: 1, 2, 3, 4, 5, and 2 more\. /)

  // Anything else left the registry as it was, and is said as `remember` always said it.
  assert.deepEqual(registrySaveProblem(CWD, new Error('EACCES: permission denied')), {
    kind: 'unreadable-file',
    path,
    cause:
      'could not write the session registry, so this conversation will not be offered next time: EACCES: ' +
      'permission denied',
  })
  assert.equal(registrySaveProblem(CWD, 'a string').kind, 'unreadable-file')
})

// ─────────────────────────────────────────────── the order a save writes ──

test('the rows this office writes come first, then the kept rows, in the order the file had them', async (t) => {
  const first = { ...NEWER, id: 'first' }
  const root = await registryWith(t, [first, row('a'), 42, row('b'), 'last'])

  await save(root, await openOffice(root))

  assert.deepEqual(await rowsIn(root), [row('a'), row('b'), first, 42, 'last'])
})

test('kept rows that are the same are each kept', async (t) => {
  const twin = { ...NEWER, id: 'twin' }
  const root = await registryWith(t, [row('a'), 42, twin, 42, { ...twin }])

  await save(root, await openOffice(root))

  const rows = await rowsIn(root)
  assert.deepEqual(
    [rows.length, times(rows, 42), times(rows, twin)],
    [5, 2, 2],
    'rows the file held twice were written once',
  )
})

// ──────────────────────────────────────────── main.ts, read rather than run ──

const printer = ts.createPrinter({ removeComments: true })

/** A node as the printer writes it, on one line. A comment is not code, and a reflow is not a change. */
const code = (node: ts.Node): string =>
  printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).replace(/\s+/g, ' ').trim()

/** `main.ts`, parsed. It imports electron, so no test can load it. */
async function parsedMain(): Promise<ts.SourceFile> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'main.ts')
  return ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
}

/** `a` or `a.b`, for a callee that is a plain name, and `null` for anything else. */
function nameOf(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text
  if (!ts.isPropertyAccessExpression(node)) return null
  const left = nameOf(node.expression)
  return left === null ? null : `${left}.${node.name.text}`
}

/** The calls to `name` anywhere under `root`, in source order. */
function callsTo(root: ts.Node, name: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && nameOf(node.expression) === name) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

/** The body of the one top-level function called `name`. */
function bodyOf(source: ts.SourceFile, name: string): ts.Block {
  const found = source.statements.filter(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name,
  )
  const body = found.length === 1 ? found[0]?.body : undefined
  assert.ok(body, `main.ts no longer declares one \`${name}\` with a body; this check needs rewriting`)
  return body
}

/** Whether a `return` is anywhere in `node`, leaving out functions declared inside it. */
const returns = (node: ts.Node): boolean =>
  ts.isReturnStatement(node) ||
  (!ts.isFunctionLike(node) && (ts.forEachChild(node, (child) => returns(child) || undefined) ?? false))

/** The index of the `try` among `steps` whose first statement is `first`, or -1. */
const tryStarting = (steps: readonly ts.Statement[], first: string): number =>
  steps.findIndex((s) => {
    const opening = ts.isTryStatement(s) ? s.tryBlock.statements[0] : undefined
    return opening !== undefined && code(opening) === first
  })

/**
 * What a `try` does, what its `catch` names the error and does with it, and what its `finally`
 * does. A `finally` runs after the `catch`, so a `return` there drops what the `catch` rethrew, and
 * a statement there can undo what the `catch` reported.
 */
const attemptAt = (steps: readonly ts.Statement[], at: number) => {
  const step = steps[at]
  assert.ok(step && ts.isTryStatement(step), 'no such try; this check needs rewriting')
  const caught = step.catchClause
  return {
    tries: step.tryBlock.statements.map(code),
    error: caught?.variableDeclaration ? code(caught.variableDeclaration.name) : null,
    catches: caught ? caught.block.statements.map(code) : null,
    finally: step.finallyBlock ? step.finallyBlock.statements.map(code) : null,
  }
}

/**
 * Whether `id` is the name a declaration gives a binding of its own. A named function or class
 * expression counts: its name is a binding inside it, so `async function setRegistryProblem() {…}`
 * as a handler takes every call of that name in its body.
 */
const binds = (id: ts.Identifier): boolean => {
  const up = id.parent
  return (
    (ts.isVariableDeclaration(up) ||
      ts.isParameter(up) ||
      ts.isBindingElement(up) ||
      ts.isFunctionDeclaration(up) ||
      ts.isClassDeclaration(up) ||
      ts.isFunctionExpression(up) ||
      ts.isClassExpression(up) ||
      ts.isImportSpecifier(up) ||
      ts.isImportClause(up) ||
      ts.isNamespaceImport(up)) &&
    up.name === id
  )
}

/**
 * Every binding of `name` in `source`, in source order. An import is written as the one name it
 * brings in and the module it comes from, and a declaration at the top of the file as its kind
 * and name, or for a variable its whole statement. Anything else is written as `inner:` and its
 * declaration: a binding inside a function or a block, which takes every use of the name there,
 * or a shape this does not name.
 */
function bindingsOf(source: ts.SourceFile, name: string): string[] {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name && binds(node)) {
      const up = node.parent
      const statement = up.parent?.parent
      const imported = ts.findAncestor(up, ts.isImportDeclaration)
      if (imported && ts.isImportSpecifier(up)) {
        found.push(`import { ${(up.propertyName ?? up.name).text} } from ${code(imported.moduleSpecifier)}`)
      } else if (imported) {
        found.push(`import ${code(up)} from ${code(imported.moduleSpecifier)}`)
      } else if ((ts.isFunctionDeclaration(up) || ts.isClassDeclaration(up)) && ts.isSourceFile(up.parent)) {
        found.push(`${ts.isClassDeclaration(up) ? 'class' : 'function'} ${name}`)
      } else if (ts.isVariableDeclaration(up) && statement && ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent)) {
        found.push(code(statement))
      } else {
        found.push(`inner: ${code(up).slice(0, 100)}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

test('writeRegistry hands the read it merged from to both of its saves, and passes on what they throw', async () => {
  // The two reads are what this file's `save` and `adopt` copy. Parsed, so a comment naming a call
  // is not the call, and each step is checked where it stands: a step moved behind a `return`, or
  // under an `if` that never holds, is no longer found as written.
  const body = bodyOf(await parsedMain(), 'writeRegistry')
  const queued = callsTo(body, 'writeRegistryQueue')
  const task = queued.length === 1 ? queued[0]?.arguments[0] : undefined
  assert.ok(
    task && ts.isArrowFunction(task) && ts.isBlock(task.body),
    '`writeRegistry` no longer queues one task with a body; this check needs rewriting',
  )
  const steps = task.body.statements
  const at = (text: string): number => steps.findIndex((s) => code(s) === text)

  const found = {
    'the read': at('const onDisk = creating ? null : await loadRegistry(WORKSPACE_ROOT);'),
    'the merge from it': at("if (onDisk?.state === 'ok') sessions = mergeNewest(onDisk.sessions, sessions);"),
    'the save handed it': tryStarting(
      steps,
      'await saveRegistry(WORKSPACE_ROOT, sessions, onDisk === null ? { create: true } : { read: onDisk });',
    ),
    'the read of an adopted file': at('const theirs = await loadRegistry(WORKSPACE_ROOT);'),
    'the merge from that': at('sessions = mergeNewest(theirs.sessions, sessions);'),
    'the save handed that': at('await saveRegistry(WORKSPACE_ROOT, sessions, { read: theirs });'),
  }
  const lost = Object.entries(found).filter(([, i]) => i < 0).map(([what]) => what)
  assert.deepEqual(lost, [], "writeRegistry's task no longer has these steps as they are written here")
  const order = Object.values(found)
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the steps of writeRegistry are out of order')

  assert.equal(callsTo(body, 'saveRegistry').length, 2, 'writeRegistry saves somewhere other than the two saves checked here')
  const save = found['the save handed it']
  assert.deepEqual(steps.slice(0, save).filter(returns).map(code), [], 'writeRegistry can return before its first save')
  assert.deepEqual(
    steps.slice(save + 1, found['the save handed that']).filter(returns).map(code),
    [],
    'writeRegistry can return before it saves a file it adopted',
  )

  // What the first save throws. Only `RegistryAppeared` goes on to the adoption below. Anything
  // else, a `RowsLeftOut` included, goes to `remember` and the close handler, which report it. A
  // review's X1 and X2 kept every step above and passed: one returned on a `RowsLeftOut`, and one on
  // anything but `RegistryAppeared`. Either leaves S4 and S5 silent again. So did the delta review's
  // F1, `finally { if (!creating) return }`, which drops what the `catch` rethrew.
  assert.deepEqual(
    attemptAt(steps, save),
    {
      tries: [
        'await saveRegistry(WORKSPACE_ROOT, sessions, onDisk === null ? { create: true } : { read: onDisk });',
        'if (creating) registryIsOurs = false;',
        'return;',
      ],
      error: 'err',
      catches: ['if (!(err instanceof RegistryAppeared)) throw err;'],
      finally: null,
    },
    "writeRegistry's first save no longer passes on every failure but RegistryAppeared, as written here " +
      'with no `finally`',
  )
  // The adoption save is a step of the task (above), so what it throws leaves the task too. And both
  // reach the callers: `writeRegistry` awaits the task as a step of its own, and the next test checks
  // that the queue is the `serial()` that `serial.test.ts` checks passes a task's rejection on.
  const queuing = queued[0]?.parent
  assert.ok(
    queuing && ts.isAwaitExpression(queuing) && ts.isExpressionStatement(queuing.parent) && queuing.parent.parent === body,
    'writeRegistry no longer awaits its queued task as a step of its own, so what the task throws may not reach its callers',
  )
})

test("the save's queue is serial(), and every function and class these checks name is main.ts's own", async () => {
  // The delta review's F2 declared `writeRegistryQueue` as `(t) => queue(t).catch(() => {})`. Every
  // step the test above checks was still there, and it passed, while a failure the task passed on
  // stopped in the queue, so S4 and S5 were silent again. A function-local binding of the same name
  // does the same where it stands. So the queue is bound once, to `serial()` from `./serial.js`,
  // which `serial.test.ts` checks passes a task's failure on to the caller that queued it, and each
  // name the save and report steps use is bound once, at the top of main.ts.
  const source = await parsedMain()
  const expected = {
    writeRegistryQueue: ['const writeRegistryQueue = serial();'],
    serial: ["import { serial } from './serial.js'"],
    writeRegistry: ['function writeRegistry'],
    loadRegistry: ["import { loadRegistry } from './registry.js'"],
    mergeNewest: ["import { mergeNewest } from './registry.js'"],
    saveRegistry: ["import { saveRegistry } from './registry.js'"],
    RegistryAppeared: ["import { RegistryAppeared } from './registry.js'"],
    setRegistryProblem: ['function setRegistryProblem'],
    registrySaveProblem: ["import { registrySaveProblem } from './registry.js'"],
    writtenDespite: ["import { writtenDespite } from './registry.js'"],
    upsert: ["import { upsert } from './registry.js'"],
    pushSessions: ['function pushSessions'],
  }
  assert.deepEqual(
    Object.fromEntries(Object.keys(expected).map((name) => [name, bindingsOf(source, name)])),
    expected,
    'a name the save or its report uses is bound somewhere other than once, as written here, so a call ' +
      'may not reach what the other checks read',
  )
})

test('remember reports what a save left out in its own words, and a save that went through clears it', async () => {
  const body = bodyOf(await parsedMain(), 'remember')
  const steps = body.statements
  const at = tryStarting(steps, 'await writeRegistry();')
  assert.ok(at >= 0, '`remember` no longer saves as the first step of a try; this check needs rewriting')

  // The delta review's F6 added `finally { setRegistryProblem(null) }`, which clears what the
  // `catch` just reported, and passed. A step after the `try` does the same.
  assert.deepEqual(
    attemptAt(steps, at),
    {
      tries: ['await writeRegistry();', 'setRegistryProblem(null);'],
      error: 'err',
      catches: ['setRegistryProblem(registrySaveProblem(WORKSPACE_ROOT, err));'],
      finally: null,
    },
    'remember no longer reports a failed save through registrySaveProblem, or no longer clears what a ' +
      'failed save reported once one goes through, whichever kind it was, or has a `finally`',
  )
  assert.deepEqual(steps.slice(at + 1).map(code), [], 'remember does something after its save, which can undo what it reported')
  assert.equal(callsTo(body, 'writeRegistry').length, 1, 'remember saves somewhere other than the save checked here')
  assert.deepEqual(
    steps.slice(0, at).filter(returns).map(code),
    ['if (!session) return;'],
    'remember can return before it saves a session it has',
  )
})

test('the close handler fails a close only when the save left that conversation out', async () => {
  const source = await parsedMain()
  const handlers = callsTo(source, 'ipcMain.handle').filter(
    (call) => call.arguments[0] !== undefined && code(call.arguments[0]) === 'CHANNEL.closeSession',
  )
  const outcome = handlers.length === 1 && handlers[0] ? callsTo(handlers[0], 'outcomeOf') : []
  const run = outcome.length === 1 ? outcome[0]?.arguments[1] : undefined
  assert.ok(
    run && ts.isArrowFunction(run) && ts.isBlock(run.body),
    'the close handler no longer runs one task through `outcomeOf`; this check needs rewriting',
  )
  const steps = run.body.statements
  const found = {
    'the close': steps.findIndex((s) => code(s) === 'sessions = upsert(sessions, { ...base, closed: true });'),
    'the save': tryStarting(steps, 'await writeRegistry();'),
    'the push': steps.findIndex((s) => code(s) === 'pushSessions(project);'),
    'the answer': steps.findIndex((s) => code(s) === 'return { ok: true };'),
  }
  const lost = Object.entries(found).filter(([, i]) => i < 0).map(([what]) => what)
  assert.deepEqual(lost, [], 'the close handler no longer has these steps as they are written here')
  const order = Object.values(found)
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the steps of the close handler are out of order')

  // `outcomeOf` turns the throw into `{ ok: false, reason }` (read, main.ts). The delta review's F7
  // added `finally { setRegistryProblem(null) }` here and passed; it clears what the `catch` reported
  // about another conversation. So nothing but the push and the answer may follow the `try` either.
  assert.deepEqual(
    attemptAt(steps, found['the save']),
    {
      tries: ['await writeRegistry();', 'setRegistryProblem(null);'],
      error: 'err',
      catches: [
        'if (!writtenDespite(err, key)) throw err;',
        'setRegistryProblem(registrySaveProblem(WORKSPACE_ROOT, err));',
      ],
      finally: null,
    },
    'the close handler no longer fails exactly the closes a save did not write, or no longer reports ' +
      'another conversation the save left out, or has a `finally`',
  )
  assert.deepEqual(
    steps.slice(found['the save'] + 1).map(code),
    ['pushSessions(project);', 'return { ok: true };'],
    'the close handler does more between its save and its answer, which can undo what it reported',
  )
  assert.equal(callsTo(run, 'writeRegistry').length, 1, 'the close saves somewhere other than the save checked here')
  assert.deepEqual(
    steps.slice(0, found['the answer']).filter(returns).map(code),
    [],
    'the close handler can answer before it has saved',
  )
})
