/**
 * What a stranger is told, and the distinction the whole feature turns on.
 *
 * **Blocked and empty are different.** No `claude` binary means nothing in this app can work —
 * the room is not empty, it is unpowered. No projects yet means somebody has just arrived and
 * started nothing, which is a correct state. Both draw as a room with desks and nobody at them,
 * and a first-run screen that renders them the same teaches a new user that the app is broken
 * on the first screen they see.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { diagnose, firstRunVerdict, isBlocked, summarise, type FirstRunState, type Step } from '../src/shared/first-run.js'

/** A workspace where everything is fine. Overridden field by field per test. */
const healthy = (over: Partial<FirstRunState> = {}): FirstRunState => ({
  claudePath: '/usr/local/bin/claude',
  claudeProblem: null,
  staffCount: 7,
  projectCount: 2,
  canCreateProject: true,
  canAddTemplate: true,
  instructions: 'present',
  gate: { state: 'wired' },
  permissionsInForce: true,
  quarantinedApp: null,
  unreadable: [],
  problems: [],
  ...over,
})

test('a healthy workspace is told nothing at all', () => {
  // The common case after the first day, and the one an onboarding feature most often gets
  // wrong: a permanent "welcome" strip nobody can get rid of.
  assert.deepEqual(diagnose(healthy()), [])
  assert.equal(summarise([]), null)
})

test('no claude blocks, and says where it looked', () => {
  const steps = diagnose(
    healthy({ claudePath: null, claudeProblem: 'Looked in /usr/local/bin, ~/.local/bin and 4 other places.' }),
  )

  assert.equal(steps[0]?.severity, 'blocked')
  assert.equal(isBlocked(steps), true)
  // The resolver's own account, verbatim. "Not found" is useless; "looked in these six places"
  // is something a person can act on.
  assert.match(steps[0]?.detail ?? '', /Looked in \/usr\/local\/bin/)
  assert.match(steps[0]?.command ?? '', /claude-code/)
})

test('no projects is empty; no staff is blocked, because nothing can answer you', () => {
  // The distinction this module exists to draw, and it was drawn one notch too generously.
  //
  // No projects is genuinely "nothing here yet" — the office works, you have not given it
  // anything to do. Interrupting somebody's first look to say so would be onboarding treating
  // itself as more important than the thing it onboards them to.
  //
  // No *staff* is not that. No staff means no manager, and `openSession` throws on it: the
  // office cannot answer a single message. Measured against a fresh workspace, what a stranger
  // actually met was an empty room, a header reading `the manager · idle`, a composer inviting
  // them to ask it something, and a raw IPC error in the transcript — with the one screen that
  // explains it all hidden behind a link in the status bar, because this said `empty`.
  const noProjects = diagnose(healthy({ projectCount: 0 }))
  assert.equal(isBlocked(noProjects), false, 'an office with staff and no projects works fine')
  assert.deepEqual(noProjects.map((s) => s.severity), ['empty'])

  const noStaff = diagnose(healthy({ staffCount: 0 }))
  assert.equal(isBlocked(noStaff), true, 'an office nobody works at cannot answer you')
  assert.equal(noStaff.find((s) => s.id === 'no-staff')?.severity, 'blocked')

  // And it still offers the thing that fixes it, rather than only describing it.
  assert.equal(noStaff.find((s) => s.id === 'no-staff')?.action, 'hire')
})

test('an untrusted workspace is a warning, and only once there is something to run', () => {
  const running = diagnose(healthy({ permissionsInForce: false }))
  assert.equal(running.find((s) => s.id === 'untrusted')?.severity, 'warning')
  // The one that matters: every VERIFY condition is a command, so none of them runs on its own,
  // which from inside the app is indistinguishable from an allowlist that does not work.
  assert.match(running.find((s) => s.id === 'untrusted')?.detail ?? '', /VERIFY/)

  // Stacked on a blocker it is noise. Somebody with no claude at all does not need to hear
  // about their permission rules first.
  const blocked = diagnose(healthy({ claudePath: null, permissionsInForce: false }))
  assert.equal(blocked.some((s) => s.id === 'untrusted'), false)
})

test('the untrusted step says which rules are ignored, and what the checks come back as', () => {
  /*
   * It said Claude Code drops a workspace's permission rules, and that checks come back "not
   * allowed". Claude Code ignores an untrusted workspace's allow rules and still applies its deny
   * rules (measured against 2.1.266 on 2026-09-16), and the harness does the same: a check the
   * office would have run comes back not checked, and one a deny rule covers comes back refused.
   * Its title said nothing here can be verified, though a person can still run a check by hand.
   */
  const step = diagnose(healthy({ permissionsInForce: false })).find((s) => s.id === 'untrusted')
  assert.equal(
    step?.title,
    'This workspace is not trusted, so the office verifies nothing here on its own',
  )
  assert.equal(
    step?.detail,
    'Claude Code ignores a workspace’s allow rules until you trust it, though it still ' +
      'applies its deny rules. The staff can still read and write files, but every VERIFY ' +
      'condition is a command, so the office runs none of them on its own: checks come back ' +
      'not checked, or refused where a deny rule covers them, rather than passing or failing. ' +
      'Run claude once in this directory and accept the prompt.',
  )
})

test('a directory that could not be read is never counted as empty', () => {
  // The fourth standing order at the moment it costs the most. A first-run screen that quietly
  // counted an unreadable `.claude/agents` as zero would tell a stranger their office is empty
  // when it is not, and they would go and write agents that were already there.
  const steps = diagnose(healthy({ unreadable: ['/w/.claude/agents'] }))
  const step = steps.find((s) => s.id.startsWith('unreadable:'))

  assert.equal(step?.severity, 'warning')
  assert.match(step?.detail ?? '', /not the same as it being empty/)
})

test('a quarantined app names the command that clears it, and says why it is flagged', () => {
  // The app is unsigned on purpose — a $99/year membership this project has not bought — so a
  // downloaded copy is refused by macOS, on Apple Silicon with the word *damaged*. Somebody
  // reading this has already worked around that once; the flag is still on the bundle and the
  // next update meets the same wall.
  const steps = diagnose(healthy({ quarantinedApp: '/Applications/Office Space.app' }))
  const step = steps.find((s) => s.id === 'quarantined')

  // Never blocked. The app has plainly launched, and a takeover panel arguing otherwise would
  // be the office lying about its own state to make a point about signing.
  assert.equal(step?.severity, 'warning')
  assert.equal(isBlocked(steps), false)

  // The fix, verbatim and runnable, against the bundle we actually found rather than the
  // /Applications path the install card assumes.
  assert.equal(step?.command, 'xattr -cr "/Applications/Office Space.app"')
  // And the reason, because "macOS security settings are preventing…" is true, useless, and
  // reads as the app blaming the OS for a bill this project decided not to pay.
  assert.match(step?.detail ?? '', /com\.apple\.quarantine/)
  assert.match(step?.detail ?? '', /signed by Apple/)
  assert.match(step?.detail ?? '', /\$99/)

  // And it sits below the two warnings that mean something on screen is not true. An allowlist
  // that is not in force and a directory that is not on the floor both cost something right
  // now; a flag on a bundle that has already launched does not.
  const among = diagnose(
    healthy({
      permissionsInForce: false,
      unreadable: ['/w/memory'],
      quarantinedApp: '/Applications/Office Space.app',
    }),
  )
  assert.deepEqual(among.map((s) => s.id), ['untrusted', 'unreadable:/w/memory', 'quarantined'])
})

test('the quarantine step names the bundle it actually found', () => {
  // Somebody who ran it from ~/Downloads gets their own path. A hard-coded /Applications line
  // would succeed against a bundle that is not theirs and change nothing they can see, which is
  // worse than no command at all.
  const steps = diagnose(healthy({ quarantinedApp: '/Users/x/Downloads/Office Space.app' }))
  assert.equal(
    steps.find((s) => s.id === 'quarantined')?.command,
    'xattr -cr "/Users/x/Downloads/Office Space.app"',
  )
})

test('no quarantine flag, no step — and that covers every machine that is not a Mac', () => {
  // `quarantinedApp` is null in four unlike situations: not macOS, run from a clone, checked
  // and clean, and could not check. `main/quarantine.ts` keeps them apart and hands a path over
  // only when it has seen the flag, so this module has one rule and it is the safe one — say
  // nothing unless somebody has actually looked and found something.
  //
  // The macOS-only half of the promise is proved where the check lives, in
  // `test/quarantine.test.ts`: on a non-darwin platform `appQuarantine` returns before it can
  // run `xattr` at all.
  assert.deepEqual(diagnose(healthy()), [])
  assert.equal(diagnose(healthy({ staffCount: 0 })).some((s) => s.id === 'quarantined'), false)
})

test('a problem the office reported gets a row rather than a second surface', () => {
  // There used to be two places telling somebody what was wrong: this diagnosis, and a banner
  // across the bottom of the floor that printed the whole of the first problem. They overlapped
  // on the untrusted warning, in different words, and neither was complete. Anything the
  // diagnosis has no proper step for now arrives here.
  const steps = diagnose(healthy({ problems: ['themes/ could not be listed'] }))
  const step = steps.find((s) => s.id.startsWith('problem:'))

  assert.equal(step?.severity, 'warning')
  assert.equal(step?.detail, 'themes/ could not be listed')
  // No next action, and that is right: the office does not know what this one is.
  assert.equal(step?.action, null)
  assert.equal(step?.command, null)
})

test('a reported problem outranks an empty room and is outranked by a missing binary', () => {
  const steps = diagnose(
    healthy({ claudePath: null, claudeProblem: 'nothing on the PATH', staffCount: 0, problems: ['something else'] }),
  )
  // Two blockers now: no binary, and nobody to run it. The warning sits between them and the
  // empty room, which is the whole point of the ordering.
  assert.deepEqual(
    steps.map((s) => s.severity),
    ['blocked', 'blocked', 'warning'],
  )
})

test('the worst thing comes first', () => {
  const steps = diagnose(
    healthy({
      claudePath: null,
      claudeProblem: 'nothing on the PATH',
      staffCount: 0,
      projectCount: 0,
      unreadable: ['/w/memory'],
    }),
  )

  assert.equal(steps[0]?.severity, 'blocked')
  // Sorted, not merely pushed in a lucky order. Before this was enforced, `no-staff` becoming a
  // blocker put one below two warnings — and `summarise` answers with `steps[0].title`, so the
  // status bar would have named a warning as the worst thing in the office.
  assert.deepEqual(
    steps.map((s) => s.severity),
    ['blocked', 'blocked', 'warning', 'empty'],
  )
})

test('a missing template offers a button only when there is something to copy', () => {
  /*
   * The rule this test was written for still holds, and it is the same one the undo obeys: a
   * button offered and then failing is worse than a sentence saying why there is no button,
   * because the failure arrives after the click and looks like the app broke.
   *
   * What changed is that `canCreateProject: false` turned out to be two situations. A workspace
   * somebody pointed the office at with OFFICE_WORKSPACE has no template *and the office has one
   * to give* — there the old sentence sent them to "re-clone" their own repository. A build
   * carrying no template has nothing to offer, and there the sentence was right all along.
   */
  const none = diagnose(healthy({ projectCount: 0, canCreateProject: false, canAddTemplate: false }))
  const noButton = none.find((s) => s.id === 'no-projects')
  assert.equal(noButton?.action, null, 'offered to copy a template this build does not carry')
  assert.match(noButton?.detail ?? '', /_TEMPLATE/)
  assert.match(noButton?.detail ?? '', /re-clone/, 'a genuinely broken build stopped saying so')

  const theirOwnRepo = diagnose(healthy({ projectCount: 0, canCreateProject: false, canAddTemplate: true }))
  const offered = theirOwnRepo.find((s) => s.id === 'no-projects')
  assert.equal(offered?.action, 'add-template')
  assert.doesNotMatch(offered?.detail ?? '', /re-clone/, 'still telling somebody to re-clone their own repository')

  const canStart = diagnose(healthy({ projectCount: 0, canCreateProject: true }))
  assert.equal(canStart.find((s) => s.id === 'no-projects')?.action, 'new-project')
})

test('the status line says the worst thing, not a count', () => {
  assert.equal(
    summarise(diagnose(healthy({ claudePath: null }))),
    'The office cannot find the claude command',
  )
  assert.equal(summarise(diagnose(healthy({ permissionsInForce: false }))), '1 thing to know')
  // Was 'getting started', the line for a workspace that is merely new. An office with nobody
  // in it is not new, it is stopped — and the status bar should say which.
  assert.equal(
    summarise(diagnose(healthy({ staffCount: 0 }))),
    'Nobody works here yet, so there is no manager to answer you',
  )
  // Still 'getting started' for the case that genuinely is just new.
  assert.equal(summarise(diagnose(healthy({ projectCount: 0 }))), 'getting started')
})

/**
 * What a stranger's first screen must not contain.
 *
 * Measured against a genuinely empty workspace, before any of this: an empty room, a header
 * reading `the manager · idle`, a composer inviting them to "Ask the manager for something…",
 * and two red blocks in the transcript — one of them a raw IPC frame with an absolute temp path:
 *
 *   Could not read the workspace: Error invoking remote method 'session:open':
 *   Error: no manager agent found in /private/tmp/…/-Users-somebody-ADE/…
 *
 * Every one of those is the app describing its own internals to somebody who has been using it
 * for four seconds, and the one screen that explains the situation in prose stayed hidden behind
 * a link in the status bar because "no staff" was filed as *empty* rather than *blocked*.
 */
test('an empty workspace is diagnosed in prose, not in exceptions', () => {
  const steps = diagnose(healthy({ staffCount: 0, projectCount: 0 }))

  assert.equal(isBlocked(steps), true, 'so the panel opens itself rather than waiting to be found')
  assert.equal(steps[0]?.id, 'no-staff', 'and the thing that stops everything is named first')

  for (const step of steps) {
    // No exception text, no IPC frames, no absolute paths from this machine.
    const said = `${step.title} ${step.detail}`
    assert.doesNotMatch(said, /Error invoking remote method/, 'an IPC frame is not a sentence')
    assert.doesNotMatch(said, /^Error:|\bError:\s/, 'an exception is not a sentence')
    assert.doesNotMatch(said, /\/private\/tmp\/|\/Users\/[a-z]+\//i, 'a path from this machine is not the reader’s business')
    assert.ok(step.title.length > 0 && step.detail.length > 0, 'every step says what and why')
  }

  // And the blocker offers the action rather than only describing the problem.
  assert.equal(steps[0]?.action, 'hire')
})

/**
 * When the panel is on screen — the decision that could not be tested, and so was wrong.
 *
 * This lived in `showFirstRun` in `app.ts` as three early returns threaded through the DOM
 * writes. `app.ts` has top-level side effects and needs a `window.office` to load, so no test
 * could address it, and the branch that opens on a forced press was broken the whole time.
 *
 * The control it was broken for is the **command palette**, not the pill in the status bar.
 * `⌘K` → "What this workspace still needs" is in the static action list, so it is always shown,
 * always matchable on `start`, `setup`, `help`, `broken`, and it called `showFirstRun(true)`
 * into a function that returned without drawing anything. Always present, permanently inert.
 *
 * The pill is the opposite case and was never affected: `render` sets
 * `gettingStarted.hidden = summarise(steps) === null`, so it is on screen only when there is
 * something to report — which is exactly when `steps.length > 0` and the old code worked. An
 * alert that is always on screen is not an alert, and a control hidden when it has nothing to
 * say cannot demonstrate a bug about having nothing to say.
 *
 * Worth writing down because the first version of this comment named the pill. It was found by
 * clicking the pill in the running app over CDP — `.click()` works on a `display: none` element,
 * so the measurement was real and the attribution was wrong. Right symptom, wrong door.
 *
 * It reached the user as "the buttons don't work", which was an accurate description of the
 * experience and a wrong description of the code: the listener was attached and firing the whole
 * time. That gap is why this repository separates *reaches a handler* from *does something*.
 *
 * The re-break is the part worth keeping: with the decision still inside `app.ts`, restoring the
 * original bug typechecked clean and turned the entire suite green. A decision no test can
 * address is a decision that gets to be wrong for as long as nobody happens to click it.
 */

const step = (over: Partial<Step> = {}): Step => ({
  id: 'x',
  severity: 'warning',
  title: 'Something',
  detail: 'Something happened.',
  command: null,
  action: null,
  ...over,
})

test('a press opens the panel even when there is nothing wrong', () => {
  // The bug, stated as the assertion that catches it. `force` is somebody pressing the control;
  // an empty diagnosis is the healthy case, which is the common case.
  assert.equal(
    firstRunVerdict({ steps: [], force: true, dismissed: false }),
    'open',
    'pressing "getting started" on a healthy workspace must answer. Returning without drawing ' +
      'anything is indistinguishable, from the outside, from a button that is not wired.',
  )
  assert.equal(
    firstRunVerdict({ steps: [], force: true, dismissed: true }),
    'open',
    'having dismissed the panel once must not make the control that opens it stop working',
  )
})

test('nothing wrong and nobody asking shuts it, rather than leaving it up', () => {
  assert.equal(firstRunVerdict({ steps: [], force: false, dismissed: false }), 'shut')
  // 'shut' rather than 'leave' matters: a panel raised by an earlier, worse diagnosis has to come
  // down once the thing it was reporting is fixed. `onRecheck` re-runs exactly this path.
  assert.notEqual(
    firstRunVerdict({ steps: [], force: false, dismissed: false }),
    'leave',
    'a panel that reported a problem must close itself once the problem is gone, not sit there ' +
      'reporting a state that is no longer true',
  )
})

test('a blocker opens itself, and keeps opening itself after it has been dismissed', () => {
  const blocked = [step({ severity: 'blocked' })]
  assert.equal(firstRunVerdict({ steps: blocked, force: false, dismissed: false }), 'open')
  assert.equal(
    firstRunVerdict({ steps: blocked, force: false, dismissed: true }),
    'open',
    'an office that cannot run anything is not a state somebody should be able to dismiss and ' +
      'then wonder about',
  )
})

test('an empty room is not worth a panel, but a warning is', () => {
  const empty = [step({ severity: 'empty' })]
  assert.equal(
    firstRunVerdict({ steps: empty, force: false, dismissed: false }),
    'leave',
    'nothing is wrong — there is just nothing here yet. That is a line in the status bar.',
  )
  assert.equal(
    firstRunVerdict({ steps: [step({ severity: 'warning' })], force: false, dismissed: false }),
    'open',
    'a warning is something being not-true on screen, which is worth interrupting for once',
  )
  assert.equal(
    firstRunVerdict({ steps: [step({ severity: 'warning' })], force: false, dismissed: true }),
    'leave',
    'and once dismissed, a warning stays dismissed — only a blocker overrides that',
  )
})

test('a mixed list is judged by its worst row, not its first', () => {
  const mixed = [step({ severity: 'empty' }), step({ severity: 'blocked', id: 'y' })]
  assert.equal(
    firstRunVerdict({ steps: mixed, force: false, dismissed: true }),
    'open',
    '`steps.every(empty)` must not be reached before the blocker is noticed',
  )
})

/**
 * ## Zero staff because there are none, and zero staff because we could not look
 *
 * `unreadable` is on this state already, under a comment saying what it is for: "directories and
 * files discovery could not read. Never the same as absent." The `no-staff` step did not consult
 * it, so a workspace whose `.claude/agents/` cannot be opened -- a permissions change, a
 * half-restored backup, a mount that came back read-protected -- was told:
 *
 *     Nobody works here yet, so there is no manager to answer you
 *     An employee is a markdown file in .claude/agents/ ... Write one by hand or let the office
 *     write it for you, and a desk appears.
 *
 * with a Hire button under it. Seven employees were in that directory. Following the advice
 * means writing an eighth file into a directory nothing can read, which fixes nothing and leaves
 * somebody believing their staff are gone.
 *
 * The warnings underneath did say the files could not be read -- discovery is careful and the
 * panel prints every one of them. But the blocked step is the headline, it is the one with the
 * action on it, and it stated the one thing standing order 4 exists to prevent: "this one
 * mistake has cost more than any other in the projects this office was built from."
 */

test('staff that could not be read is not reported as staff that do not exist', () => {
  const steps = diagnose(
    healthy({
      staffCount: 0,
      unreadable: ['/w/.claude/agents', '/w/.claude/agents/manager.md'],
    }),
  )
  const blocker = steps.find((s) => s.severity === 'blocked')
  assert.ok(blocker, 'an office that cannot answer you is blocked whatever the reason')

  assert.equal(
    /Nobody works here yet/.test(blocker.title),
    false,
    'a workspace whose agents directory cannot be opened is told nobody works there. The staff ' +
      'may all be present and unreadable, and "nobody works here" is a claim about what is in a ' +
      'directory nothing could open.',
  )
  assert.match(
    blocker.title + ' ' + blocker.detail,
    /could not be read|cannot be read|could not open/i,
    'the blocker does not say that reading failed, so the reason is only in the warnings below it',
  )
})

test('and it does not offer to hire into a directory nothing can read', () => {
  const steps = diagnose(healthy({ staffCount: 0, unreadable: ['/w/.claude/agents'] }))
  const blocker = steps.find((s) => s.severity === 'blocked')
  assert.ok(blocker)

  assert.notEqual(
    blocker.action,
    'hire',
    'the blocked step offers to write another employee file into the directory that could not ' +
      'be read. That writes an eighth agent nobody can see and leaves the actual fault in place.',
  )
})

test('an unreadable directory somewhere else does not change the no-staff advice', () => {
  // The control. Without it, "mentions unreadable anywhere" would satisfy the tests above and
  // the step would change its words for a workspace whose *skills* directory is the problem.
  const steps = diagnose(healthy({ staffCount: 0, unreadable: ['/w/.claude/skills'] }))
  const blocker = steps.find((s) => s.severity === 'blocked')
  assert.ok(blocker)
  assert.match(
    blocker.title,
    /Nobody works here yet/,
    'an unreadable skills directory changed what the panel says about the staff',
  )
  assert.equal(blocker.action, 'hire', 'a genuinely empty office is no longer offered a way to fill it')
})

/**
 * ## And the same question about the projects directory
 *
 * The staff fix above has a twin one field over, found the same way: a `projects/` directory
 * that exists and cannot be opened produced
 *
 *     No projects yet
 *     A project is a directory under projects/ copied from projects/_TEMPLATE — and that
 *     template is missing, so the office cannot start one for you. Create the directory by hand,
 *     or re-clone.
 *
 * Two false statements and one piece of harmful advice. There was a project in there. The
 * template was in there too — `canCreateProject` is false because the directory could not be
 * read, not because anything is missing. And re-cloning does not fix a permissions bit; it tells
 * somebody their work is gone when it is sitting on disk exactly where they left it.
 */

test('projects that could not be read are not reported as projects that do not exist', () => {
  const steps = diagnose(
    healthy({ projectCount: 0, canCreateProject: false, unreadable: ['/w/projects'] }),
  )
  const about = steps.find((s) => /project/i.test(s.title))
  assert.ok(about, 'nothing on the panel mentions projects at all')

  assert.equal(
    /No projects yet/.test(about.title),
    false,
    'a projects directory that could not be opened is reported as a workspace with no projects. ' +
      'There may be a dozen in there.',
  )
  assert.match(about.title + ' ' + about.detail, /could not be read|cannot be read/i)
})

test('and it does not blame a template it could not look for', () => {
  const steps = diagnose(
    healthy({ projectCount: 0, canCreateProject: false, unreadable: ['/w/projects'] }),
  )
  const about = steps.find((s) => /project/i.test(s.title))
  assert.ok(about)

  assert.equal(
    /template is missing/i.test(about.detail),
    false,
    'the panel says the template is missing when the directory holding it could not be opened. ' +
      '`canCreateProject` is false for the same reason the count is zero, and neither is evidence ' +
      'about what is on disk.',
  )
  assert.equal(
    /re-clone/i.test(about.detail),
    false,
    'it advises re-cloning, which does not fix a permissions bit and tells somebody their work is ' +
      'gone when it is exactly where they left it',
  )
})

test('a genuinely empty projects directory still says so, and still offers the template', () => {
  // The control for both of the above.
  const empty = diagnose(healthy({ projectCount: 0, canCreateProject: true }))
  const about = empty.find((s) => /project/i.test(s.title))
  assert.ok(about)
  assert.match(about.title, /No projects yet/, 'an empty projects directory stopped saying it is empty')
  assert.equal(about.severity, 'empty', 'an empty workspace is not a fault and must not read as one')

  // And a genuinely missing template still says so — in both of its two situations.
  const noTemplate = diagnose(healthy({ projectCount: 0, canCreateProject: false, canAddTemplate: false }))
  const missing = noTemplate.find((s) => /project/i.test(s.title))
  assert.match(missing?.detail ?? '', /template is missing/i, 'a genuinely missing template is no longer reported')

  // A workspace that lives *under* a directory called `projects` — which is where a great many
  // checkouts live. Matching "projects" anywhere in an unreadable path turns an unreadable
  // skills directory here into a claim about the projects directory, so the match is on the
  // path ending and this is what says so.
  const under = diagnose(
    healthy({ projectCount: 0, canCreateProject: true, unreadable: ['/home/me/projects/office/.claude/skills'] }),
  )
  const stillEmpty = under.find((step) => /project/i.test(step.title))
  assert.match(
    stillEmpty?.title ?? '',
    /No projects yet/,
    'an unreadable path that merely contains the word "projects" was read as the projects ' +
      'directory being unreadable — which is every workspace kept under a folder of that name',
  )
})

test('a workspace with no instruction file is told, without being called broken', () => {
  /*
   * `warning`, not `blocked`: the office genuinely runs without a CLAUDE.md, and calling a
   * working office broken is how a panel earns being closed unread. Not `empty` either — that
   * severity means nothing is wrong and there is just nothing here yet, and this absence has a
   * consequence for every agent in the workspace.
   */
  const steps = diagnose(healthy({ instructions: 'absent' }))
  const said = steps.find((s) => s.id === 'no-instructions')
  assert.ok(said, 'a workspace with no standing instructions was told nothing')
  assert.equal(said.severity, 'warning')
  assert.match(said.detail, /every agent Claude Code starts here\s+reads it first/)
})

test('an instruction file that will not open is a different sentence', () => {
  // Only one of the two is fixed by writing a file. Somebody sent to create a CLAUDE.md that
  // already exists has been sent the wrong way by a panel trying to help.
  const steps = diagnose(healthy({ instructions: 'unreadable' }))
  assert.equal(steps.find((s) => s.id === 'no-instructions'), undefined)
  const said = steps.find((s) => s.id === 'instructions-unreadable')
  assert.ok(said)
  assert.match(said.detail, /permissions/)
  assert.doesNotMatch(said.detail, /Write one/, 'told somebody to write a file that is already there')
})

test('a workspace that has one is told nothing about it', () => {
  // The common case, and the panel's whole discipline: no permanent strip about a thing that is
  // fine.
  const ids = diagnose(healthy({ instructions: 'present' })).map((s) => s.id)
  assert.equal(ids.includes('no-instructions'), false)
  assert.equal(ids.includes('instructions-unreadable'), false)
})

test('a workspace whose approval gate is gone says so before anything else', () => {
  /*
   * `blocked`, and the only use of that severity for something the office will happily keep
   * running through. It genuinely works without standing instructions; it does not work as
   * advertised without this, because `acceptEdits` plus unapproved Bash is the configuration the
   * whole approval story exists to prevent. Somebody who believes they have a gate and does not
   * is worse off than somebody who knows they have none.
   */
  const steps = diagnose(healthy({ gate: { state: 'hook-missing' } }))
  const said = steps.find((s) => s.id === 'gate-hook-missing')
  assert.ok(said, 'a missing approval gate was not reported at all')
  assert.equal(said.severity, 'blocked')
  assert.match(said.detail, /never asked to approve a shell command before it runs/)
  // And it names both halves, because which one is missing decides what to do about it.
  assert.match(said.detail, /approval-gate\.mjs/)
  assert.match(said.detail, /settings\.json/)
})

test('a gate that could not be checked is not a gate that is missing', () => {
  /*
   * The distinction every surface in this app gets wrong first — the roster said "Nobody works
   * here yet" underneath its own banner reporting it could not read the staff. Here the confident
   * wrong answer is "commands are unapproved", which sends somebody hunting a problem they may
   * not have.
   */
  const steps = diagnose(healthy({ gate: { state: 'unreadable', cause: 'EACCES' } }))
  const said = steps.find((s) => s.id === 'gate-unreadable')
  assert.ok(said)
  assert.equal(said.severity, 'warning', 'could-not-tell was raised as loudly as a known failure')
  assert.match(said.title, /unknown/)
  assert.doesNotMatch(said.title, /running without/)
})

test('a working gate says nothing at all', () => {
  // It does not announce itself. A permanent strip about a thing that is fine is how a panel
  // teaches somebody to close it unread.
  const ids = diagnose(healthy({ gate: { state: 'wired' } })).map((s) => s.id)
  assert.equal(ids.some((id) => id.startsWith('gate-')), false)
})

test('a workspace with hooks switched off is told which setting did it, not to restore files', () => {
  /*
   * `blocked`, like the other two "no gate" answers: no shell command is held either way. The
   * remedy is different, though. Both of the gate's files can be in place, so "the gate is two
   * files" would send somebody to check files that are fine while the setting stays on.
   */
  const steps = diagnose(healthy({ gate: { state: 'hooks-off' } }))
  const said = steps.find((s) => s.id === 'gate-hooks-off')
  assert.ok(said, 'hooks switched off was not reported at all')
  assert.equal(said.severity, 'blocked')
  assert.match(said.title, /without the approval gate/)
  // The sentence from `gateLede`; the remedy below names the key too, so match what only it says.
  assert.match(said.detail, /sets disableAllHooks to true/)
  assert.match(said.detail, /Set disableAllHooks to false in \.claude\/settings\.json/)
  // False there only stops this file turning hooks off. A local or managed setting can still keep
  // them off, so the remedy must not promise that hooks come back.
  assert.match(said.detail, /a local or managed setting can still keep them off/)
  assert.doesNotMatch(said.detail, /turn hooks back on/)
  // Deleting the line is not the same fix: the user's own settings then decide.
  assert.match(said.detail, /deleting the line/i)
  assert.doesNotMatch(said.detail, /two files/)
})
