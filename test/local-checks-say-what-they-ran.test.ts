/**
 * Local checks say what they ran: the suite’s own counts and coverage, the dev the run was
 * checked against, and a status posted to GitHub and nowhere else.
 *
 * One of six files that pin `scripts/ci-local.mjs`'s promises; the list, and the rig they
 * share, are in `local-checks-rig.ts`. Split from one file on 2026-09-24 so that each fits the
 * suite’s minute per file on a loaded machine.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { delimiter, join } from 'node:path'

import { SKIP, gitIn, stub, aRepo, withOrigin, commit, posted, run, lines, seen, onPath, report } from './local-checks-rig.js'

test('a head that does not contain dev is never posted, and its report says so', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  const head = gitIn(rig.root, 'rev-parse', 'HEAD')
  // dev moves on after this branch was cut, and the branch is not rebased.
  const dev = commit(rig, 'dev moves on')
  gitIn(rig.root, 'push', '-q', 'origin', 'HEAD:refs/heads/dev')
  gitIn(rig.root, 'reset', '-q', '--hard', head)

  const refused = run(rig, ['--post-status'])
  assert.equal(refused.code, 2, refused.stdout)
  assert.match(refused.stderr, new RegExp(`does not contain dev \\(${dev.slice(0, 7)}\\)`))
  assert.deepEqual(await seen(rig), [], 'a head behind dev was run for a post')
  assert.deepEqual(await lines(rig.ghLog), [], 'a head behind dev was posted')

  const local = run(rig)
  assert.equal(local.code, 0, local.stderr)
  assert.match(local.stdout, new RegExp(`^dev {9}${dev}, which this commit does not contain`, 'm'))
  assert.deepEqual((await report(rig))['dev'], { sha: dev, contained: false, error: null })
})

test('the suite\'s own summary can fail a run its exit code passed, and the posted state follows the result', { skip: SKIP }, async (t) => {
  const cases = [
    {
      summary: 'fail',
      step: /^tests, with coverage {2}exited 0 in [\d.]+s, but the suite reported 1 failed$/m,
      counts: /^tests {7}1 tests: 0 pass, 1 fail, 0 cancelled, 0 skipped$/m,
      description: /^tests, with coverage exited 0, but the suite reported 1 failed — dev /,
    },
    {
      // A failure beside cancellations is a failure, and both counts are named.
      summary: 'fail-and-cancelled',
      step: /^tests, with coverage {2}exited 0 in [\d.]+s, but the suite reported 1 failed and 1 cancelled$/m,
      counts: /^tests {7}3 tests: 1 pass, 1 fail, 1 cancelled, 0 skipped$/m,
      // Cut about there, to fit GitHub's 140 characters.
      description: /^tests, with coverage exited 0, but the suite reported 1 failed/,
    },
    {
      // Cancellations in a summary that is not all there: what is missing is the complaint, because
      // a run that cannot be read is not a run that ran out of time.
      summary: 'cancelled-incomplete',
      step: /^tests, with coverage {2}exited 0 in [\d.]+s, but the suite printed no complete summary \(no # pass, # fail\)$/m,
      counts: /^tests {7}3 tests: \? pass, \? fail, 2 cancelled, \? skipped$/m,
      // Cut about there, to fit GitHub's 140 characters.
      description: /^tests, with coverage exited 0, but the suite printed no complete/,
    },
    {
      summary: 'none',
      step: /^tests, with coverage {2}exited 0 in [\d.]+s, but the suite printed no complete summary \(no # tests, # pass, # fail, # cancelled\)$/m,
      counts: null,
      // Cut about there, to fit GitHub's 140 characters.
      description: /^tests, with coverage exited 0, but the suite printed no complete/,
    },
    {
      // A count the suite did not print is shown as unknown, never as 0.
      summary: 'partial',
      step: /^tests, with coverage {2}exited 0 in [\d.]+s, but the suite printed no complete summary \(no # pass, # cancelled\)$/m,
      counts: /^tests {7}3 tests: \? pass, 0 fail, \? cancelled, \? skipped$/m,
      // Cut about there, to fit GitHub's 140 characters.
      description: /^tests, with coverage exited 0, but the suite printed no complete/,
    },
    {
      // A suite that fails still shows the counts it printed.
      summary: 'fail',
      exit: '1',
      step: /^tests, with coverage {2}failed \(exit 1\) in [\d.]+s$/m,
      counts: /^tests {7}1 tests: 0 pass, 1 fail, 0 cancelled, 0 skipped$/m,
      description: /^tests, with coverage failed \(exit 1\) — dev /,
    },
  ]
  for (const c of cases) {
    const what = `${c.summary}, exit ${c.exit ?? '0'}`
    const rig = await aRepo(t)
    await withOrigin(rig)
    const r = run(rig, ['--post-status'], { SUMMARY: c.summary, COVERAGE_EXIT: c.exit ?? '0' })
    assert.equal(r.code, 1, `${what}: ${r.stdout}`)
    assert.match(r.stdout, c.step, what)
    if (c.counts === null) assert.doesNotMatch(r.stdout, /^tests {7}/m, what)
    else assert.match(r.stdout, c.counts, what)
    assert.match(r.stdout, /^result {6}FAILED$/m, what)
    assert.equal((await report(rig))['passed'], false, what)
    const { fields } = await posted(rig)
    assert.equal(fields['state'], 'failure', `${what} was posted as ${fields['state']}`)
    assert.match(fields['description'] ?? '', c.description, what)
  }
})

test('a suite that cancelled tests and failed none ran out of time, and is called neither pass nor failure', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  const sha = gitIn(rig.root, 'rev-parse', 'HEAD')
  const r = run(rig, ['--post-status'], { SUMMARY: 'cancelled' })

  // Its own exit code, so a caller can tell this from a failure (1) and from a pass (0).
  assert.equal(r.code, 6, `${r.stdout}\n${r.stderr}`)
  assert.match(r.stdout, /^tests, with coverage {2}exited 0 in [\d.]+s, but the suite cancelled 2 of 3 tests and failed none$/m)
  assert.match(r.stdout, /^tests {7}3 tests: 1 pass, 0 fail, 2 cancelled, 0 skipped$/m)
  assert.match(r.stdout, /^result {6}TIMED OUT$/m)
  assert.doesNotMatch(r.stdout, /^result {6}(PASSED|FAILED)$/m)

  // The verdict carries the load the report already shows, which is what tells a busy machine from
  // a broken commit, and says in the same breath why this is not a failure.
  const load = r.stdout.match(/^load {8}(([\d.]+) [\d.]+ [\d.]+ before, ([\d.]+) [\d.]+ [\d.]+ after)$/m)
  assert.ok(load, `the load line this pins against is not the load line: ${r.stdout}`)
  const [, whole, before, after] = load
  const said = `the suite cancelled 2 of 3 tests and failed none, at load ${whole}. A cancelled test ran out of time, which is not a defect, so this run is neither a pass nor a failure.`
  assert.ok(r.stdout.includes(`\nout of time ${said}\n`), `the verdict does not say it: ${r.stdout}`)

  // Posted, and posted as `error`: a commit with no status cannot be told from one nobody checked,
  // and `failure` is the word that cost a day. GitHub's 140 characters cannot hold the sentence
  // beside the dev and the machine, so the status says the same facts short, load included.
  const { fields } = await posted(rig)
  assert.equal(fields['state'], 'error')
  assert.equal(fields['context'], 'local-checks')
  assert.equal(
    fields['description'],
    `timed out: 2 of 3 cancelled, 0 failed, load ${before}→${after} — dev ${sha.slice(0, 7)}, on ${process.platform}, Node ${process.versions.node}, npm from OFFICE_CHECKS_NPM, not CI`,
  )
  assert.ok((fields['description'] ?? '').length <= 140, `${(fields['description'] ?? '').length} characters: ${fields['description']}`)
  assert.match(r.stdout, new RegExp(`^status {6}local-checks = error on o/r@${sha.slice(0, 7)}$`, 'm'))

  const rep = await report(rig)
  assert.equal(rep['passed'], false)
  assert.equal(rep['outOfTime'], said)
  const suite = (rep['steps'] as { name: string; summaryProblem: string | null; summaryTimeout: string | null }[])[2]
  assert.equal(suite?.summaryProblem, null, 'a cancellation was recorded as a problem with the summary')
  assert.equal(suite?.summaryTimeout, 'the suite cancelled 2 of 3 tests and failed none')
})

test('a suite that was killed is a failure, whatever counts it printed before it died', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  // The stand-in prints the cancelled summary and only then kills itself, so everything a timeout
  // would be read from is there, and the step still did not end on its own.
  const r = run(rig, ['--post-status'], { SUMMARY: 'cancelled', STEP_KILL: 'coverage' })
  assert.equal(r.code, 1, `${r.stdout}\n${r.stderr}`)
  assert.match(r.stdout, /^tests {7}3 tests: 1 pass, 0 fail, 2 cancelled, 0 skipped$/m, 'the summary this case relies on was not printed')
  assert.match(r.stdout, /^tests, with coverage {2}killed by SIGKILL in [\d.]+s$/m)
  assert.doesNotMatch(r.stdout, /^out of time/m)
  assert.match(r.stdout, /^result {6}FAILED$/m)
  assert.equal((await report(rig))['outOfTime'], null)
  assert.equal((await posted(rig)).fields['state'], 'failure')
})

test('a run that ran out of time and changed under itself is a failure, because it describes no commit', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  const head = gitIn(rig.root, 'rev-parse', 'HEAD')
  const r = run(rig, ['--post-status'], { SUMMARY: 'cancelled', STEP_ADD: 'coverage' })
  assert.equal(r.code, 1, `${r.stdout}\n${r.stderr}`)
  assert.match(r.stdout, /^changed {5}the tree changed during the run: made-during-the-run\.txt \(\?\?\)$/m)
  assert.match(r.stdout, /^result {6}FAILED$/m)
  assert.doesNotMatch(r.stdout, /^out of time/m)
  assert.equal((await report(rig, head))['outOfTime'], null)
  assert.match(r.stderr, /status not posted: .*describes no single commit/)
  assert.deepEqual(await lines(rig.ghLog), [], 'a run whose tree changed under it was posted')
})

test('the counts and the coverage line are the suite\'s last, not a test\'s early ones', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  const r = run(rig, [], { SUMMARY: 'spoofed' })
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /^tests {7}3 tests: 2 pass, 0 fail, 0 cancelled, 1 skipped$/m)
  assert.match(r.stdout, /^coverage {4}all files \| 81\.20 \| 70\.10 \| 79\.00 \|$/m)
  assert.equal((await report(rig))['coverage'], 'all files | 81.20 | 70.10 | 79.00 |')
})

test('dev is fetched into origin/dev whatever the clone\'s own fetch refspec leaves out', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  const head = gitIn(rig.root, 'rev-parse', 'HEAD')
  // A clone of one other branch, as `git clone --single-branch --branch main` makes one: a plain
  // `git fetch origin` brings origin/main up to date, and nothing else.
  gitIn(rig.root, 'push', '-q', 'origin', 'HEAD:refs/heads/main')
  gitIn(rig.root, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main')
  // dev moves on, while this clone's origin/dev still names a commit the head contains.
  const dev = commit(rig, 'dev moves on')
  gitIn(rig.root, 'push', '-q', 'origin', 'HEAD:refs/heads/dev')
  gitIn(rig.root, 'reset', '-q', '--hard', head)
  assert.equal(gitIn(rig.root, 'rev-parse', 'refs/remotes/origin/dev'), head, 'the push moved origin/dev, so it is not the stale one this needs')

  const r = run(rig, ['--post-status'])
  const { fields } = await posted(rig)
  assert.equal(fields['state'], undefined, `posted against the dev this clone fetched last: ${fields['state']}, "${fields['description']}"`)
  assert.equal(r.code, 2, r.stdout)
  assert.match(r.stderr, new RegExp(`does not contain dev \\(${dev.slice(0, 7)}\\)`))
  assert.equal(gitIn(rig.root, 'rev-parse', 'refs/remotes/origin/dev'), dev, 'origin/dev was not brought up to date')
})

test('dev is asked about the commit the run reports, even while HEAD stands elsewhere', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  const head = commit(rig, 'the branch adds a commit')
  // A commit that does not contain dev. A git that stands HEAD there while it answers `merge-base`,
  // and puts it back afterwards, is a HEAD that moved between two of the run's git calls.
  const elsewhere = gitIn(rig.root, 'commit-tree', 'HEAD^{tree}', '-m', 'dev is not in here')
  const real = onPath('git')
  const asked = join(rig.base, 'merge-base-asked')
  const bin = join(rig.base, 'moving-git')
  await stub(join(bin, 'git'), `#!/bin/sh
if [ "$1" = merge-base ]; then
  echo "$*" >> '${asked}'
  '${real}' -c core.hooksPath=/dev/null update-ref HEAD ${elsewhere}
  '${real}' "$@"
  code=$?
  '${real}' -c core.hooksPath=/dev/null update-ref HEAD ${head}
  exit $code
fi
exec '${real}' "$@"
`)
  const r = run(rig, ['--post-status'], { PATH: `${bin}${delimiter}${rig.env['PATH'] ?? ''}` })
  assert.equal((await lines(asked)).length, 1, 'no merge-base was asked while HEAD stood elsewhere, so which commit is asked about was not tested')
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`)
  assert.equal((await posted(rig)).path, `repos/o/r/statuses/${head}`)
})
