/**
 * The office can be asked what it knows, and every silence has its own answer.
 *
 * VISION.md's fifth section asks for a memory keeper you can *"just ask — what's going on, how is
 * progress, what do we know"*. The agent has existed since the workspace shipped, `memory/` has
 * existed with a README in it, and `privacy.ts` counted its bytes so they could be deleted —
 * **nothing ever read it.** There was no answer to look at, and no way to tell an office that had
 * recorded nothing from one whose notes would not open.
 *
 * The rule binding this is the keeper's own, and it binds the surface exactly as hard as the
 * agent:
 *
 *     If nothing was recorded about something, say "nothing recorded" — do not infer, and do not
 *     fill the gap with something plausible. A confident guess from the memory keeper is the most
 *     damaging thing you can produce, because people believe you.
 *
 * So: nothing recorded, could not be read, and could not look are three different sentences, and
 * a file that did not say what kind it is does not get guessed at.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { memoryLede, parseMemory } from '../src/shared/memory.js'
import { readMemory } from '../src/main/memory.js'

import { tempDir } from './temp-dir.js'

const workspace = (t: TestContext) => tempDir(t, 'office-memory-')

const RECORD = `---
title: Spotify auth is PKCE, and the client id is not a secret
type: decision
created: 2026-08-21
updated: 2026-08-26
---

Under PKCE the client id is public by design.

**Why it matters:** it looks like a secret and is not.
`

// ── parsing ─────────────────────────────────────────────────────────────────────────────────

test('a record is read as what it says it is', () => {
  const m = parseMemory('pkce-not-a-secret', RECORD)

  assert.equal(m.title, 'Spotify auth is PKCE, and the client id is not a secret')
  assert.equal(m.kind, 'decision')
  assert.equal(m.created, '2026-08-21')
  assert.equal(m.updated, '2026-08-26')
  assert.match(m.body, /public by design/)
  assert.equal(m.unstructured, false)
  assert.doesNotMatch(m.body, /^---/, 'the frontmatter was left in the body')
})

test('a title containing a colon survives, because most of them do', () => {
  // Split on the *first* colon only. Splitting on every one turns "Auth: why we chose PKCE" into
  // a field called `auth` and a lost title.
  const m = parseMemory('x', '---\ntitle: Auth: why we chose PKCE\ntype: decision\n---\n\nBecause.\n')
  assert.equal(m.title, 'Auth: why we chose PKCE')
})

test('a file with no frontmatter is a note, and says so rather than being dressed as a record', () => {
  const m = parseMemory('a-note-somebody-left', 'The retry cap is the thing to look at next.\n')

  assert.equal(m.unstructured, true)
  assert.equal(m.kind, 'unlabelled')
  assert.equal(
    m.title,
    'a-note-somebody-left',
    'the title fell back to something other than the filename — which is a real name somebody ' +
      'chose, and "Untitled" is neither true nor useful',
  )
})

test('a type the keeper does not use is unlabelled, not guessed at', () => {
  // Five kinds are named in its prompt. Filing a sixth under one of them would be this reader
  // inventing the one thing the file did not say.
  assert.equal(parseMemory('x', '---\ntype: musings\n---\n\nHm.\n').kind, 'unlabelled')
  assert.equal(parseMemory('x', '---\ntitle: No type at all\n---\n\nHm.\n').kind, 'unlabelled')
})

test('a date that is not a date is no date', () => {
  // The keeper is told **absolute dates, never "yesterday"**. A value that is not one is a rule
  // being broken, and printing it in a date column would hide that.
  assert.equal(parseMemory('x', '---\ncreated: yesterday\n---\n\nHm.\n').created, null)
  assert.equal(parseMemory('x', '---\ncreated: 2026-08-21\n---\n\nHm.\n').created, '2026-08-21')
})

test('a byte-order mark does not turn a record into a note', () => {
  // Some editors write one. `startsWith('---')` is false for it, so every such file would be
  // reported as prose — `workspace.ts` strips it on agent files for the same reason.
  const m = parseMemory('x', '﻿' + RECORD)
  assert.equal(m.unstructured, false, 'a BOM made a record read as an unstructured note')
  assert.equal(m.kind, 'decision')
})

// ── the lede ────────────────────────────────────────────────────────────────────────────────

test('nothing recorded says so, and is not a count', () => {
  assert.equal(memoryLede({ memories: [], unread: [], problem: null }), 'Nothing recorded yet')
})

test('a directory that would not open is not a workspace with nothing in it', () => {
  const lede = memoryLede({ memories: [], unread: [], problem: 'EACCES: permission denied' })
  assert.match(lede, /cannot tell you what it remembers/)
  assert.doesNotMatch(
    lede,
    /Nothing recorded/,
    'an unreadable directory was reported as an office that has recorded nothing — the one ' +
      'sentence this whole surface exists not to say',
  )
})

test('a count that excluded unreadable files says "at least"', () => {
  // The same distinction the activity strip draws: a number taken from a partial read is a count
  // of what we managed to read, not of what is remembered.
  const lede = memoryLede({
    memories: [parseMemory('a', RECORD), parseMemory('b', RECORD)],
    unread: [{ id: 'c', cause: 'EACCES' }],
    problem: null,
  })
  assert.match(lede, /at least/i, `the lede reads ${JSON.stringify(lede)}`)
  assert.match(lede, /1 more exists and could not be read/)
})

test('a clean read is a plain count with no hedging', () => {
  // The control. "At least 2 things" where nothing is missing would be hedging with nothing to
  // hedge about, which is its own way of being untrustworthy.
  const lede = memoryLede({ memories: [parseMemory('a', RECORD)], unread: [], problem: null })
  assert.equal(lede, '1 thing recorded')
  assert.doesNotMatch(lede, /at least/i)
})

// ── reading the directory ───────────────────────────────────────────────────────────────────

test('a workspace that has never recorded anything is empty, not broken', async (t) => {
  // ENOENT is the one errno where absent really is empty: the directory is created by whatever
  // first writes to it, so its absence is a workspace nobody has recorded in.
  const report = await readMemory(await workspace(t))
  assert.deepEqual(report, { memories: [], unread: [], problem: null })
})

test('the README is not something the office learned', async (t) => {
  // It is committed, and it explains the directory to a person. Counting it would put "Memory"
  // in the list of things the office remembers on every fresh clone.
  const root = await workspace(t)
  await mkdir(join(root, 'memory'), { recursive: true })
  await writeFile(join(root, 'memory', 'README.md'), '# Memory\n\nWhat the office remembers.\n', 'utf8')

  const report = await readMemory(root)
  assert.deepEqual(report.memories, [], 'the README was read as a memory')
})

test('records are read, and the id is the filename', async (t) => {
  const root = await workspace(t)
  await mkdir(join(root, 'memory'), { recursive: true })
  await writeFile(join(root, 'memory', 'pkce-not-a-secret.md'), RECORD, 'utf8')

  const report = await readMemory(root)
  assert.equal(report.memories.length, 1)
  assert.equal(report.memories[0]?.id, 'pkce-not-a-secret', 'the id is how somebody edits or deletes the file')
  assert.equal(report.problem, null)
})

test('a directory that exists and will not open is a problem, not an empty office', async (t) => {
  const root = await workspace(t)
  const dir = join(root, 'memory')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'a.md'), RECORD, 'utf8')
  await chmod(dir, 0o000)

  try {
    const report = await readMemory(root)
    assert.notEqual(
      report.problem,
      null,
      'a memory directory that could not be opened reported as a workspace with nothing recorded',
    )
    assert.match(report.problem ?? '', /could not be opened/)
  } finally {
    // Restored whatever the assertion did, so a failure does not leave an unreadable directory
    // behind for whatever runs next.
    await chmod(dir, 0o755)
  }
})

test('one unreadable file among several is a named gap, not a failed read', async (t) => {
  // Nine memories and one unreadable is nine memories and a gap. Sinking the read would lose the
  // nine; ignoring the file would lose the one — and it may be the record of the very thing
  // somebody is looking for.
  const root = await workspace(t)
  const dir = join(root, 'memory')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'good.md'), RECORD, 'utf8')
  await writeFile(join(dir, 'locked.md'), RECORD, 'utf8')
  await chmod(join(dir, 'locked.md'), 0o000)

  try {
    const report = await readMemory(root)
    assert.deepEqual(report.memories.map((m) => m.id), ['good'], 'the readable memory was lost')
    assert.deepEqual(report.unread.map((u) => u.id), ['locked'], 'the unreadable one was dropped in silence')
    assert.equal(report.problem, null, 'one bad file was reported as the whole directory failing')
  } finally {
    await chmod(join(dir, 'locked.md'), 0o644)
  }
})

/*
 * The half of the partial-read lede that had no test, and read wrongly because of it.
 *
 * Seen in the running app on a workspace whose only memory file was `chmod 000`: *"Nothing
 * readable recorded · 1 more exists and could not be read."* **More** than nothing is a
 * contradiction, and the sentence it was borrowed from is only correct when something was read.
 *
 * "Nothing recorded yet" would be worse than clumsy: it is a false statement about a directory
 * with a file in it, which is the fourth standing order in one sentence.
 */
test('a directory where nothing could be read is not a directory with nothing in it', () => {
  const one = memoryLede({ memories: [], unread: [{ id: 'a', cause: 'EACCES' }], problem: null })
  assert.match(one, /Nothing here could be read/)
  assert.match(one, /One file exists and would not open/)
  assert.doesNotMatch(one, /\bmore\b/, 'more than nothing is a contradiction')
  assert.doesNotMatch(one, /Nothing recorded yet/, 'there is something recorded; it cannot be opened')

  const several = memoryLede({
    memories: [],
    unread: [{ id: 'a', cause: 'EACCES' }, { id: 'b', cause: 'EACCES' }],
    problem: null,
  })
  assert.match(several, /2 files exist and would not open/)

  // And the empty office keeps its own sentence, which is a different fact entirely.
  assert.match(memoryLede({ memories: [], unread: [], problem: null }), /Nothing recorded yet/)
})

test('a memory the keeper filed in a subdirectory is found, not silently skipped', async (t) => {
  /*
   * The way this was broken is the shape the fourth standing order names.
   *
   * `readdir` was flat, and the loop's first line skips anything not ending `.md` — so a
   * *directory* was skipped in silence, indistinguishable from an empty memory. And the keeper
   * organises: asked on a fresh workspace to record one decision, it wrote
   * `memory/decisions/2026-08-31-mit-licence.md`, with frontmatter and a "why it matters". The
   * panel went on saying *"Nothing recorded yet. Nothing has been written down yet."*
   *
   * The office had written something down and could not see it, on the one surface whose entire
   * subject is what it remembers.
   */
  const root = await workspace(t)
  await mkdir(join(root, 'memory', 'decisions'), { recursive: true })
  await writeFile(join(root, 'memory', 'decisions', 'pkce-not-a-secret.md'), RECORD, 'utf8')

  const report = await readMemory(root)
  assert.equal(report.memories.length, 1, 'a memory one directory down was not found')
  assert.equal(
    report.memories[0]?.id,
    'decisions/pkce-not-a-secret',
    'the id has to keep the path — the panel prints it as `memory/<id>.md`, and a bare filename ' +
      'would name a file that is not there',
  )
})

test('a README one directory down is still not a memory', async (t) => {
  // The exclusion is about the basename, not the path. Grouping by kind puts a README inside
  // `memory/decisions/` within reach of somebody being tidy.
  const root = await workspace(t)
  await mkdir(join(root, 'memory', 'decisions'), { recursive: true })
  await writeFile(join(root, 'memory', 'decisions', 'README.md'), '# Decisions\n', 'utf8')

  const report = await readMemory(root)
  assert.deepEqual(report.memories, [], 'a nested README was counted as something the office learned')
})
