/**
 * The permanent line under the floor, and the two numbers on it.
 *
 * A count is the easiest place in an interface to state something you do not know. `0 skills`
 * from a shelf that could not be opened reads exactly like `0 skills` from a shelf with nothing
 * on it, and only one of those is a fact about the workspace.
 *
 * This was found by making `.claude/skills` unreadable and looking at the running app: the
 * roster panel one click away printed the EACCES verbatim, the first-run panel opened itself
 * with a warning per file, and the line on screen said "7 on the floor - 0 skills". Every
 * careful surface was careful; the summary was not, and the summary is the one that is always
 * visible.
 *
 * The staff half has the same fault available to it and is guarded the same way -- an
 * unreadable `.claude/agents` gives a count of the agents we managed to read, which is a
 * different number with the same digits.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { composerInvite, shelfPart, staffPart, statusLine, type CountedProblem, nobodyListening } from '../src/shared/status-line.js'

const clean: readonly CountedProblem[] = []
const unreadable = (path: string): CountedProblem[] => [{ kind: 'unreadable-dir', path }]

test('with everything readable it is two plain counts', () => {
  assert.equal(statusLine(7, 5, clean), '7 on the floor \u00b7 5 skills')
})

test('one skill is one skill, not "1 skills"', () => {
  // Reachable, and this line is on screen permanently rather than in a panel somebody opened.
  assert.equal(shelfPart(1, clean), '1 skill')
  assert.equal(shelfPart(0, clean), '0 skills')
  assert.equal(shelfPart(2, clean), '2 skills')
})

test('a shelf that could not be read does not report a count of zero', () => {
  const said = shelfPart(0, unreadable('/w/.claude/skills'))
  assert.equal(
    /\d/.test(said),
    false,
    'the line says ' + JSON.stringify(said) + ' for a shelf nothing could open. A number there ' +
      'is indistinguishable from a shelf with nothing on it, and only one of those is true.',
  )
  assert.match(said, /could not be read/i)
})

test('an unreadable skill file counts too, not just the directory', () => {
  // One file inside the shelf that will not open means the count is short by at least one, and
  // the count cannot say by how many.
  const said = shelfPart(4, [{ kind: 'unreadable-file', path: '/w/.claude/skills/meet/SKILL.md' }])
  assert.match(said, /could not be read/i, 'a shelf missing one unreadable skill still prints a firm count')
})

test('staff that could not all be read does not report a count either', () => {
  const said = staffPart(0, unreadable('/w/.claude/agents'))
  assert.equal(/\d/.test(said), false, 'the line says ' + JSON.stringify(said))
  assert.match(said, /could not/i)
})

test('a problem somewhere else leaves both counts alone', () => {
  // The control. Without it, "any problem at all" would satisfy the tests above and the line
  // would stop reporting counts for a workspace with a lint warning in it.
  const elsewhere: CountedProblem[] = [
    { kind: 'lint', path: '/w/.claude/agents/reviewer.md' },
    { kind: 'unreadable-dir', path: '/w/projects' },
    { kind: 'no-frontmatter', path: '/w/.claude/agents/tester.md' },
  ]
  assert.equal(statusLine(7, 5, elsewhere), '7 on the floor \u00b7 5 skills')
})

test('a workspace living under a path with the same words is not confused by it', () => {
  // `/home/me/.claude/skills` is the shelf. `/home/me/projects/.claude-notes/skills-old` is not,
  // and a workspace kept anywhere unusual must not lose its counts to a substring.
  const said = statusLine(7, 5, [{ kind: 'unreadable-dir', path: '/home/me/notes/skills-old' }])
  assert.equal(said, '7 on the floor \u00b7 5 skills', 'a directory merely named "skills-old" silenced the count')
})

// ─────────────────────────────────────── what the composer invites you to type ────

/**
 * Three states, and it had two.
 *
 * `app.ts` read `manager ? 'Ask … for something' : 'Nobody works here yet'`, and `manager` is
 * `null` both when there genuinely is nobody **and when `.claude/agents/` could not be opened**.
 *
 * Measured with that directory chmod 000: the status line said *"staff could not all be read"*,
 * the first-run panel said *"There may be employees in .claude/agents/ — this office could not
 * open it to find out"*, and of every file *"this is not the same as it being empty"* — and then
 * the composer said **nobody works here**. Every other surface on that screen was right. That one
 * is the one with the cursor in it.
 */

test('a manager gets asked by name', () => {
  assert.equal(composerInvite('the manager', []), 'Ask the manager for something…')
  assert.equal(composerInvite('Ada', []), 'Ask Ada for something…')
})

test('an empty workspace says it is empty', () => {
  assert.match(composerInvite(null, []), /Nobody works here yet/)
})

test('an unreadable staff directory is not an empty one', () => {
  const invite = composerInvite(null, [{ kind: 'unreadable-dir', path: '/w/.claude/agents' }])

  assert.doesNotMatch(
    invite,
    /Nobody works here yet/,
    `the composer reads ${JSON.stringify(invite)} about a directory the office could not open — ` +
      `which is the sentence every other surface on that screen refuses to say`,
  )
  assert.match(invite, /could not be read/)
})

test('an unreadable agent file counts too, not only the directory', () => {
  // One file of seven failing is still "we do not know who works here", and `staffPart` already
  // treats it that way. Two answers to that question is the thing this shares a predicate to
  // avoid.
  const invite = composerInvite(null, [{ kind: 'unreadable-file', path: '/w/.claude/agents/manager.md' }])
  assert.match(invite, /could not be read/)
})

test('a problem somewhere else does not change the invitation', () => {
  // An unreadable `projects/` is a real problem and says nothing about the staff. The predicate
  // is scoped to the directory the question is about.
  const invite = composerInvite(null, [{ kind: 'unreadable-dir', path: '/w/projects' }])
  assert.match(invite, /Nobody works here yet/, 'an unrelated problem was read as the staff being unreadable')
})

test('the composer and the status line answer with one predicate', () => {
  // The property that matters more than either sentence: they cannot disagree about whether the
  // staff were readable, because they ask the same question of the same list.
  const unreadable = [{ kind: 'unreadable-dir', path: '/w/.claude/agents' }]
  assert.match(staffPart(0, unreadable), /could not all be read/)
  assert.match(composerInvite(null, unreadable), /could not be read/)

  assert.match(staffPart(7, []), /7 on the floor/)
  assert.match(composerInvite(null, []), /Nobody works here yet/)
})

// ── the three surfaces that must agree ──────────────────────────────────────────────────────

test('an office with nobody in it does not say the manager is listening', () => {
  /*
   * `composerInvite` above was written for exactly this and its comment claimed every other
   * surface got it right. Two did not, and they were the two largest pieces of text on the
   * screen: the mode banner said "The manager is listening" with a live "That's the whole
   * vision" button, and the transcript said "Say something to the manager and watch the floor" —
   * directly above and below a composer correctly disabled for having no manager.
   */
  const said = nobodyListening(null, [])
  assert.match(said ?? '', /Nobody works here yet/)
})

test('staff that could not be read is not staff that are not there', () => {
  // Three states, not two, and the same predicate `composerInvite` uses so the surfaces cannot
  // disagree about whether the staff were readable.
  const unreadable = [{ kind: 'unreadable-dir' as const, path: '.claude/agents', count: 1 }]
  const said = nobodyListening(null, unreadable)
  assert.match(said ?? '', /could not be read/)
  assert.doesNotMatch(said ?? '', /Nobody works here/)
})

test('a manager who is there gets no replacement sentence', () => {
  // `null` means the ordinary lede stands. Returning a sentence here would replace "The manager
  // is listening" on every screen where it is true.
  assert.equal(nobodyListening('manager', []), null)
})

test('the composer and the banner give the same answer about the same office', () => {
  /*
   * The property, rather than two strings. If these ever disagree, one surface is describing a
   * state the other has ruled out — which is what this whole pair of functions exists to stop.
   */
  const unreadable = [{ kind: 'unreadable-dir' as const, path: '.claude/agents', count: 1 }]
  for (const problems of [[], unreadable]) {
    const readable = !composerInvite(null, problems).includes('could not be read')
    const alsoReadable = !((nobodyListening(null, problems) ?? '').includes('could not be read'))
    assert.equal(readable, alsoReadable, 'the composer and the banner disagree about the staff')
  }
})
