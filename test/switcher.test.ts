/**
 * Where am I, and how do I get somewhere else.
 *
 * The control this replaces was three surfaces: a horizontal tab strip, a **254 × 12.5px**
 * session button, and the drawer it opened. The shape was picked from a mock — projects
 * above, the current project's conversations below, the active row tagged.
 *
 * The panel itself is DOM and is not tested here. What is asserted below is the four judgements
 * it makes, each of which has a way of being got wrong that would look completely reasonable:
 *
 * 1. a project that is working says so, instead of saying when it last was,
 * 2. a conversation with no title has not been spoken to, which is not "Untitled",
 * 3. a project with no conversations is a fact, not a zero,
 * 4. the clock never reads `0m`,
 * 5. a conversation that exists and has done nothing is a third state, and not a timestamp.
 *
 * The fifth was added after it shipped wrong twice in opposite directions. `rowFor` first counted
 * only the registry, so the row read **"no conversations yet · never"** directly above the
 * conversation the reader was sitting in. Counting the rendered list instead fixed that and
 * introduced the other half: the live conversation's `updatedAt` was minted with `new Date()` per
 * payload, so the row read **"1 conversation · now"** and went on reading *now* for as long as it
 * sat idle. Two `describe()` calls a second and a half apart came back a second and a half apart,
 * on a workspace nobody had touched.
 *
 * Both are the same mistake: a state with no answer being given one of the answers that exist.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { OFFICE_PROJECT, type ProjectInfo, type SessionInfo } from '../src/shared/ipc.js'
import {
  ago,
  narrow,
  projectNames,
  projectRows,
  sessionNames,
  sessionRows,
  splitSessions,
  switcherLabel,
  workspaceLabel,
} from '../src/shared/switcher.js'
import { money } from '../src/shared/cost.js'
import { readFileSync } from 'node:fs'

const NOW = Date.parse('2026-08-21T12:00:00.000Z')
const at = (ms: number): string => new Date(NOW - ms).toISOString()

const project = (over: Partial<ProjectInfo> = {}): ProjectInfo => ({
  id: 'payments',
  name: 'payments',
  missing: [],
  conversations: 3,
  lastActiveAt: at(120_000),
  running: false,
  ...over,
})

const session = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  id: 's1',
  agent: 'manager',
  title: 'fix the retry bug',
  updatedAt: at(120_000),
  costUsd: null,
  current: false,
  running: false,
  ...over,
})

test('the clock never reads zero', () => {
  // A clock that says `0m ago` looks stopped, and the row it is on is the one telling you where
  // you were last. Under a minute is "now" — which is also true, and is a sentence rather than a
  // number that has run out of resolution.
  assert.equal(ago(at(0), NOW), 'now')
  assert.equal(ago(at(59_000), NOW), 'now')
  assert.equal(ago(at(61_000), NOW), '1m ago')
  assert.equal(ago(at(3600_000), NOW), '1h ago')
  assert.equal(ago(at(86_400_000), NOW), '1d ago')
  // Never talked to is not "a long time ago".
  assert.equal(ago(null, NOW), 'never')
  // A timestamp we cannot read is not a timestamp of zero.
  assert.equal(ago('not a date', NOW), 'never')
})

test('a project that is working says so, instead of saying when it last was', () => {
  const [row] = projectRows([project({ running: true, lastActiveAt: at(120_000) })], 'x', NOW)
  assert.match(row!.meta, /working now/)
  assert.doesNotMatch(
    row!.meta,
    /ago/,
    '"2m ago" on a project that is working right now is true and answers a question nobody ' +
      'asked. The row is for deciding where to go next.',
  )
  assert.equal(row!.running, true)
})

test('a project with no conversations says so, rather than printing a zero', () => {
  const [none] = projectRows([project({ conversations: 0, lastActiveAt: null })], 'x', NOW)
  assert.match(none!.meta, /no conversations yet/)
  assert.doesNotMatch(none!.meta, /\b0\b/)

  // And the plural is stated once rather than per call site.
  const [one] = projectRows([project({ conversations: 1 })], 'x', NOW)
  assert.match(one!.meta, /1 conversation ·/)
  const [many] = projectRows([project({ conversations: 4 })], 'x', NOW)
  assert.match(many!.meta, /4 conversations ·/)
})

test('exactly one project is current, and it is the active one', () => {
  const rows = projectRows(
    [project({ id: 'a', name: 'a' }), project({ id: 'b', name: 'b' }), project({ id: OFFICE_PROJECT, name: 'The office' })],
    'b',
    NOW,
  )
  assert.deepEqual(rows.filter((r) => r.current).map((r) => r.id), ['b'])
  // The unscoped conversation is always present and is not a directory, so it is marked as
  // itself rather than being mistaken for a project somebody made.
  assert.equal(rows.find((r) => r.id === OFFICE_PROJECT)?.isOffice, true)
  assert.equal(rows.find((r) => r.id === 'a')?.isOffice, false)
})

test('a conversation with no title has not been spoken to, which is not "Untitled"', () => {
  // The title *is* the first thing you said. Its absence is a fact about the conversation, and
  // "Untitled" would be a fact about a naming field that does not exist.
  const [row] = sessionRows([session({ title: null })], NOW)
  assert.equal(row!.title, 'Nothing said yet')
})

test('a running conversation says so too, and current is carried from the office', () => {
  const rows = sessionRows(
    [session({ id: 'a', running: true }), session({ id: 'b', current: true })],
    NOW,
  )
  assert.match(rows[0]!.meta, /^working now\b/, 'the state leads the row; the cost follows it')
  assert.equal(rows[0]!.current, false)
  assert.equal(rows[1]!.current, true)
  assert.match(rows[1]!.meta, /ago|now/)
})

test('the closed control says where you are at both levels, and never says nothing', () => {
  // The button this replaces said the conversation and not the project, which is half of
  // "where am I" — and it said it at 12.5px.
  const both = switcherLabel(project({ name: 'payments' }), session({ title: 'fix the retry bug' }))
  assert.equal(both.project, 'payments')
  assert.equal(both.session, 'fix the retry bug')

  // A project you have just switched to has no conversation open. That is a real state, and
  // "Nothing said yet" would be a claim about a conversation that does not exist.
  const none = switcherLabel(project({ name: 'payments' }), undefined)
  assert.equal(none.session, 'No conversation open')

  // Before the first snapshot there is no project either, and the control still has to say
  // something true.
  const empty = switcherLabel(undefined, undefined)
  assert.equal(empty.project, 'The office')
  assert.notEqual(empty.session, '')
})


/**
 * Which office you are in, and when it is worth saying.
 *
 * This cost an hour. Conversations that were safely on disk read as lost, because an app pointed
 * at an unexpected directory and an app with nothing in it look **identical** — nothing on
 * screen could say which office was open.
 *
 * The fix is not "always show the path". That was tried and removed, for a good reason: naming
 * the directory you are obviously in is a developer's answer to a question nobody asks twice, and
 * it was the longest string on screen in the corner the eye lands on first. Silence is the
 * default; **presence is the signal.**
 */
test('the default workspace is not named, and anything else is', () => {
  const home = '/Users/somebody/Library/Application Support/office-space/workspace'
  assert.equal(workspaceLabel(home, home), null, 'the expected office says nothing')
  // A trailing slash is the same directory, and a check that says otherwise would name the
  // office every time somebody's path happened to carry one.
  assert.equal(workspaceLabel(home + '/', home), null)
  assert.equal(workspaceLabel(home, home + '/'), null)
})

test('an unexpected workspace is named by its folder, not its path', () => {
  const home = '/Users/somebody/Library/Application Support/office-space/workspace'
  // The folder name is what a person recognises. The full path is what they already rejected
  // having on screen, and it is still one hover away on the control's title.
  assert.equal(workspaceLabel('/tmp/fresh-office', home), 'fresh-office')
  assert.equal(workspaceLabel('/Users/somebody/ADE/office-space-project/office-space', home), 'office-space')
})


/**
 * The third level: people.
 *
 * Until this existed you could not talk to an agent at all. `askAbout` forks the **manager's**
 * session and asks the manager about them, and the prompt it sends says outright *"You cannot
 * see inside a subagent while it runs"* — so the answer to "what did the tester find?" was a
 * recollection by somebody who was not there.
 *
 * A conversation with the manager and a conversation with the tester are not the same thing, and
 * one list would make them look it: the first is the project's work, the second is a side
 * conversation that never enters it.
 */
test("an employee's conversation is not one of the office's", () => {
  const split = splitSessions(
    [
      session({ id: 'a', agent: 'manager' }),
      session({ id: 'b', agent: 'tester' }),
      session({ id: 'c', agent: 'manager' }),
    ],
    'manager',
  )
  assert.deepEqual(split.office.map((s) => s.id), ['a', 'c'])
  assert.deepEqual(split.people.map((s) => s.id), ['b'])
})

test('which agent runs the office is read, never assumed to be called "manager"', () => {
  // `findManager` takes whoever can delegate when nobody is named manager, so a workspace can
  // legitimately have its office run by `lead`. Hardcoding the string here would file the office's
  // own conversations under "people you have talked to" in exactly that workspace.
  const split = splitSessions(
    [session({ id: 'a', agent: 'lead' }), session({ id: 'b', agent: 'manager' })],
    'lead',
  )
  assert.deepEqual(split.office.map((s) => s.id), ['a'])
  assert.deepEqual(split.people.map((s) => s.id), ['b'])
})

test('a row carries who answers, so a people row can name them', () => {
  const [row] = sessionRows([session({ agent: 'tester' })], NOW)
  assert.equal(row!.agent, 'tester')
})

// ─────────────────────────────── what a project is missing, on the row that picks it ──

/*
 * `PLAN.md`, `PROGRESS.md` and `TASKS.md` are not bookkeeping. `CLAUDE.md` says the floor reads
 * them — "this is where an agent's status bubble gets its content" — and the task board is
 * `TASKS.md` and nothing else. A project missing one has a quieter office for a reason nobody
 * can see from the list, which is exactly where you choose which project to open.
 *
 * `ProjectInfo.missing` was built in three places to say this and read in none, while the
 * interface's own comment says the three fields under `name` *are* the second line.
 */

test('a project missing a convention file says which one, on the row', () => {
  const [row] = projectRows([project({ missing: ['TASKS.md'] })], 'x', NOW)

  assert.ok(row?.meta.endsWith('· no TASKS.md'), row?.meta)
})

test('two missing files are both named, never counted', () => {
  // "2 files missing" makes you open the project to find out which, and the whole reason this is
  // carried on the row is that you should not have to.
  const [row] = projectRows([project({ missing: ['PLAN.md', 'TASKS.md'] })], 'x', NOW)

  assert.ok(row?.meta.endsWith('· no PLAN.md, no TASKS.md'), row?.meta)
})

test('a project with all three says nothing extra — the common case costs no words', () => {
  const [row] = projectRows([project({ missing: [] })], 'x', NOW)

  assert.equal(row?.meta, '3 conversations · 2m ago')
})

test('it sits after the timestamp rather than replacing it', () => {
  const [row] = projectRows([project({ missing: ['PROGRESS.md'] })], 'x', NOW)

  assert.equal(row?.meta, '3 conversations · 2m ago · no PROGRESS.md')
})

test('a running project keeps "working now" and still says what it lacks', () => {
  const [row] = projectRows([project({ running: true, missing: ['TASKS.md'] })], 'x', NOW)

  assert.equal(row?.meta, '3 conversations · working now · no TASKS.md')
})

test('the office is never described as missing files it cannot have', () => {
  // The unscoped conversation has no directory. Reporting the absence of something that could
  // not exist is the fourth standing order pointed the wrong way.
  const [row] = projectRows([project({ id: OFFICE_PROJECT, missing: ['PLAN.md'] })], 'x', NOW)

  assert.equal(row?.isOffice, true)
  assert.equal(row?.meta.includes('no PLAN.md'), false, row?.meta)
})

test('a conversation that exists and has done nothing is not "never", and is not a time', () => {
  // `never` belongs to a project that has had no conversations. A project holding one that has
  // just been opened has a conversation *and* no activity, and saying either of the other two
  // things about it is the fault this case exists to name.
  const [row] = projectRows([project({ conversations: 1, lastActiveAt: null })], 'x', NOW)

  assert.match(row!.meta, /1 conversation/, 'the conversation stopped being counted')
  assert.match(
    row!.meta,
    /nothing said yet/,
    `the row reads ${JSON.stringify(row!.meta)} for a project whose only conversation has never ` +
      `been spoken in`,
  )
  assert.doesNotMatch(
    row!.meta,
    /never/,
    '"never" is about a project with no conversations. Said about one that is on screen in front ' +
      'of the reader it is the same untruth as "no conversations yet" was, one level down.',
  )
  assert.doesNotMatch(
    row!.meta,
    /\bnow\b|ago/,
    'a conversation nothing has happened in was given a time. That time can only have come from ' +
      'the clock the payload was built at, which re-reads as "now" on every snapshot forever.',
  )
})

test('a project with no conversations does not also say when it last was', () => {
  // "no conversations yet · never" is the same fact twice, and the second half invites the reader
  // to wonder which of the two the row is actually about.
  const [row] = projectRows([project({ conversations: 0, lastActiveAt: null })], 'x', NOW)
  assert.equal(row!.meta, 'no conversations yet', `the row reads ${JSON.stringify(row!.meta)}`)
})

test('a project whose newest conversation is fresh still shows its real history', () => {
  // The live one leads the list and has no time; the row must not take its `null` and report a
  // project with a week of work as having done nothing.
  const [row] = projectRows([project({ conversations: 4, lastActiveAt: at(3600_000) })], 'x', NOW)
  assert.match(row!.meta, /1h ago/, `the row reads ${JSON.stringify(row!.meta)}`)
})

test('a conversation row leaves the third state to its title, rather than saying it twice', () => {
  // Rendered both ways first. "Nothing said yet — nothing said yet" is not untrue, it is the
  // same fact in both columns, and it reads as a bug. The title already carries it.
  const [row] = sessionRows([session({ title: null, updatedAt: null })], NOW)

  assert.equal(row!.title, 'Nothing said yet', 'the title stopped carrying it, so nothing does')
  assert.equal(
    row!.meta,
    '',
    `the row reads ${JSON.stringify(row!.meta)} beside a title that already says the same thing`,
  )
  assert.doesNotMatch(
    row!.meta,
    /never/,
    '"never" about a conversation on screen in front of the reader is the untruth this whole case ' +
      'exists to avoid',
  )
})

test('a running conversation still says so, whatever its timestamp is', () => {
  // The order matters: `running` is checked before the null, so a conversation that is working
  // right now is never described as having had nothing said in it.
  const [row] = sessionRows([session({ updatedAt: null, running: true })], NOW)
  assert.equal(row!.meta, 'working now')
})

// ─────────────────────────────────────────────── narrowing a list you cannot read ────

/**
 * A switcher with six hundred rows is a directory, not a control.
 *
 * Measured on a workspace with 620 projects: the list drew all of them, flat, with no way to
 * narrow. `narrow` is the decision half of the filter and lives here rather than in the view,
 * because *which rows survive a query* is a decision and a view is a place that draws things.
 *
 * It uses the same matcher the command palette does — `matching-what-you-typed.test.ts` covers
 * that — so three letters find the same thing in both, which is the whole reason it was lifted
 * out rather than written twice.
 */

test('an empty query is not a filter that matches nothing', () => {
  // The failure that would empty the list the moment somebody cleared the box.
  const all = [project({ id: 'a', name: 'alpha' }), project({ id: 'b', name: 'beta' })]
  assert.deepEqual(narrow(all, '', projectNames), all)
  assert.deepEqual(narrow(all, '   ', projectNames), all, 'a query of spaces was treated as a search')
})

test('a project is found by its name and by its directory', () => {
  // Somebody who knows a project from the filesystem types the hyphen; somebody who knows it
  // from the screen types the space. Both are the same project.
  const rows = [project({ id: 'auth-refresh', name: 'auth refresh' }), project({ id: 'billing', name: 'billing' })]
  assert.deepEqual(narrow(rows, 'auth-', projectNames).map((r) => r.id), ['auth-refresh'])
  assert.deepEqual(narrow(rows, 'auth ', projectNames).map((r) => r.id), ['auth-refresh'])
  assert.deepEqual(narrow(rows, 'ahr', projectNames).map((r) => r.id), ['auth-refresh'], 'a scattered match was missed')
})

test('a conversation is found by who answers in it, which is not in its title', () => {
  // "reviewer" is how you find the conversation you had with the reviewer, and the title is the
  // first thing *you* said — which will not contain their name.
  const rows = [
    session({ id: '1', title: 'the retry bug', agent: 'reviewer' }),
    session({ id: '2', title: 'the auth thing', agent: 'manager' }),
  ]
  assert.deepEqual(narrow(rows, 'reviewer', sessionNames).map((r) => r.id), ['1'])
})

test('an untitled conversation does not match everything', () => {
  // Its name is the empty string, and a matcher that treated that as "contains anything" would
  // make the untitled row the one result for every query.
  const rows = [session({ id: 'untitled', title: null }), session({ id: 'named', title: 'the retry bug' })]
  assert.deepEqual(narrow(rows, 'retry', sessionNames).map((r) => r.id), ['named'])
  assert.deepEqual(narrow(rows, '', sessionNames).map((r) => r.id), ['untitled', 'named'], 'it vanished with no filter')
})

test('an exact prefix comes before a match found in the middle', () => {
  // The ordering the position buys. Somebody typing `bill` wants the project called billing
  // first, not the one that happens to contain those letters further in.
  const rows = [
    project({ id: 'the-billing-thing', name: 'the billing thing' }),
    project({ id: 'billing', name: 'billing' }),
  ]
  assert.deepEqual(narrow(rows, 'bill', projectNames).map((r) => r.id), ['billing', 'the-billing-thing'])
})

test('nothing matching is nothing, not everything', () => {
  // The direction that would be worst: a filter that fails open shows the whole list and reads
  // as though the query matched all of it.
  const rows = [project({ id: 'a', name: 'alpha' })]
  assert.deepEqual(narrow(rows, 'zzzz', projectNames), [])
})

// ─────────────────────────────────────────────────── what a conversation cost ────

test('a conversation with no recorded cost does not read as a free one', () => {
  // The whole entry. `SessionInfo.costUsd` is null when the registry has no figure — a
  // conversation restored from before costs were written down, or one Claude never reported a
  // result for. None of those cost nothing, and `$0.0000` would be the office inventing a
  // number it does not have. This is the same distinction the props draw between an unread
  // task list and an empty one.
  const [row] = sessionRows([session({ costUsd: null })], NOW)

  assert.ok(row, 'no row was built')
  assert.doesNotMatch(row.meta, /\$/, 'a row with no figure must not print a price at all')
  assert.doesNotMatch(row.meta, /0\.0000|\$0/, 'and certainly not a zero one')
  assert.match(row.meta, /no cost recorded/)
})

test('a conversation with a cost prints it, and prints the one it was given', () => {
  const rows = sessionRows(
    [session({ id: 'a', costUsd: 0.2431 }), session({ id: 'b', costUsd: 1.5 })],
    NOW,
  )
  assert.match(rows[0]!.meta, /\$0\.2431/)
  assert.match(rows[1]!.meta, /\$1\.5000/)
})

test('a cost of zero is a real zero and says so', () => {
  // Not the same case as the one above, and the pair is the point: a conversation the registry
  // priced at nothing did cost nothing, and it should say `$0.0000` rather than borrow the
  // no-figure wording.
  const [row] = sessionRows([session({ costUsd: 0 })], NOW)
  assert.match(row!.meta, /\$0\.0000/)
  assert.doesNotMatch(row!.meta, /no cost recorded/)
})

test('the switcher and the header format one number the same way', () => {
  // `AsideResult.costUsd` carried the rule — "a second display here would put two formats for
  // one number on screen, written by two people". There are two displays now, so the rule needs
  // a function rather than an absence, and this is the test that it is one function.
  //
  // The header's string is built as `${money(x)} this session`, so the row's figure must be a
  // prefix of it exactly. Comparing to a literal would let the two drift together and still
  // pass, which is the failure mode this is aimed at.
  for (const usd of [0, 0.2431, 1.5, 12.3456789]) {
    const header = `${money(usd)} this session`
    const [row] = sessionRows([session({ costUsd: usd })], NOW)
    // Found by the part that carries a figure, not by its position. Indexing `[1]` assumed the
    // meta always has two halves — and a conversation nothing has happened in has one, or none,
    // at which point `[1]!` is `undefined` and the `!` turns a failed assertion into a crash.
    // A test that throws instead of failing tells you less than one that never ran.
    const figure = row!.meta.split(' · ').find((part) => part.startsWith('$'))
    assert.ok(figure, `no part of "${row!.meta}" carries a figure`)
    assert.ok(header.startsWith(figure), `the row says ${figure} and the header says ${header}`)
  }
})

test('the header builds its figure with the shared formatter and not a second one', () => {
  // The test above compares the row against `money()`, which is the function the row already
  // calls — so it cannot see the header drifting. This is the half that can: the header used to
  // own `` `$${state.costUsd.toFixed(4)} this session` ``, and a change there would leave every
  // other test in this file green while two formats for one number appeared on screen.
  //
  // Source-level, and weaker than rendering it, which is written down rather than glossed: it
  // proves the call site uses the shared function, not that the pixels agree.
  const source = readFileSync(new URL('../src/renderer/app.ts', import.meta.url), 'utf8')

  const line = source.split('\n').find((l) => l.includes('this session'))
  assert.ok(line, 'the header cost line is not there — this test went blind rather than passed')
  assert.match(line, /money\(/, 'the header formats cost some other way than the shared function')
  assert.doesNotMatch(line, /toFixed/, 'the header is building a second format of its own')
})
