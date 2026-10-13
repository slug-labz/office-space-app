/**
 * Local checks post only what they checked: a head that contains dev is posted, with a status
 * that names that dev and stays within GitHub's limit; a post goes to a GitHub remote and nowhere
 * else, is refused without one or when dev cannot be fetched, and says why when it fails.
 *
 * One of six files that pin `scripts/ci-local.mjs`'s promises; the list, and the rig they
 * share, are in `local-checks-rig.ts`. Split from one file on 2026-09-24 so that each fits the
 * suite’s minute per file on a loaded machine.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'

import { SKIP, gitIn, aRepo, withOrigin, commit, posted, run, lines, seen, onPath, report } from './local-checks-rig.js'

test('a head that contains dev is posted, and the status names that dev', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  const dev = gitIn(rig.root, 'rev-parse', 'HEAD')
  const head = commit(rig, 'the branch adds a commit')

  const r = run(rig, ['--post-status'])
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, new RegExp(`^dev {9}${dev}, which this commit contains$`, 'm'))
  assert.deepEqual((await report(rig))['dev'], { sha: dev, contained: true, error: null })
  const { path, fields } = await posted(rig)
  assert.equal(path, `repos/o/r/statuses/${head}`)
  assert.equal(fields['state'], 'success')
  assert.equal(fields['context'], 'local-checks')
  // The steps were this file's stand-in, and the status says so too.
  assert.equal(fields['description'], `typecheck, build, 2/3 pass, 0 fail, 1 skipped — dev ${dev.slice(0, 7)}, on ${process.platform}, Node ${process.versions.node}, npm from OFFICE_CHECKS_NPM, not CI`)
  assert.match(r.stdout, new RegExp(`^status {6}local-checks = success on o/r@${head.slice(0, 7)}$`, 'm'))
})

test('when dev cannot be fetched, a post is refused and a local run says dev was not checked', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  await rm(join(rig.base, 'origin.git'), { recursive: true, force: true })

  const refused = run(rig, ['--post-status'])
  assert.equal(refused.code, 2, refused.stdout)
  assert.match(refused.stderr, /git fetch origin dev failed: \S/)
  assert.deepEqual(await seen(rig), [])
  assert.deepEqual(await lines(rig.ghLog), [])

  const local = run(rig)
  assert.equal(local.code, 0, local.stderr)
  assert.match(local.stdout, /^dev {9}not checked: git fetch origin dev failed: \S/m)
})

test('a status description stays within GitHub\'s 140 characters, and what is cut is never "not CI"', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  const r = run(rig, ['--post-status'], { SUMMARY: 'huge' })
  assert.equal(r.code, 0, r.stderr)
  const description = (await posted(rig)).fields['description'] ?? ''
  assert.ok(description.length <= 140, `${description.length} characters: ${description}`)
  assert.match(description, /…/, 'nothing was cut, so this does not test the cut')
  assert.match(description, / — dev [0-9a-f]{7}, on \w+, Node [\d.]+, npm from OFFICE_CHECKS_NPM, not CI$/)
})

test('a post that fails says why and exits 4, and a flag this does not take is refused', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)

  const typo = run(rig, ['--post-stauts'])
  assert.equal(typo.code, 2, typo.stdout)
  assert.match(typo.stderr, /refused: --post-stauts/)
  assert.deepEqual(await seen(rig), [], 'a run with a mistyped flag ran')

  const forbidden = run(rig, ['--post-status'], { GH_FAIL: 'HTTP 403: Resource not accessible by integration' })
  assert.equal(forbidden.code, 4, forbidden.stderr)
  assert.match(forbidden.stdout, /^result {6}PASSED$/m)
  assert.match(forbidden.stderr, /^status not posted: .*HTTP 403: Resource not accessible by integration/m)

  // No gh anywhere on PATH. The PATH is this test's own, holding only what a run needs besides gh,
  // because a system directory may well hold one: GitHub's Ubuntu runners install it in /usr/bin.
  const bare = join(rig.base, 'no-gh')
  await mkdir(bare)
  for (const tool of ['git', 'mkdir']) await symlink(onPath(tool), join(bare, tool))
  const missing = run(rig, ['--post-status'], { PATH: bare })
  assert.equal(missing.code, 4, missing.stderr)
  assert.match(missing.stderr, /^status not posted: gh api failed: .*gh ENOENT$/m)

  // A failed run stays a failed run, whether or not its status could be recorded.
  const both = run(rig, ['--post-status'], { STEP_FAIL: 'build', GH_FAIL: 'HTTP 502' })
  assert.equal(both.code, 1, both.stderr)
  assert.match(both.stderr, /^status not posted: .*HTTP 502/m)
})

test('a post with no origin, or an origin that is not on GitHub, is refused before anything runs', { skip: SKIP }, async (t) => {
  const none = await aRepo(t)
  const noOrigin = run(none, ['--post-status'])
  assert.equal(noOrigin.code, 2, noOrigin.stdout)
  assert.match(noOrigin.stderr, /needs a remote named origin/)
  assert.deepEqual(await seen(none), [])

  const elsewhere = await aRepo(t)
  await withOrigin(elsewhere, 'https://gitlab.com/o/r.git')
  const notGitHub = run(elsewhere, ['--post-status'])
  assert.equal(notGitHub.code, 2, notGitHub.stdout)
  assert.match(notGitHub.stderr, /https:\/\/gitlab\.com\/o\/r\.git, which is not a repository on GitHub/)
  assert.deepEqual(await seen(elsewhere), [])
  assert.deepEqual(await lines(elsewhere.ghLog), [])
})

test('only a GitHub remote is posted to, in any of the shapes git accepts for one', { skip: SKIP }, async (t) => {
  const rig = await aRepo(t)
  await withOrigin(rig)
  const origin = join(rig.base, 'origin.git')
  const head = gitIn(rig.root, 'rev-parse', 'HEAD')
  const shapes: [string, string | null][] = [
    ['https://github.com/o/r', 'o/r'],
    ['https://github.com/o/r/', 'o/r'],
    ['https://github.com/o/r.git/', 'o/r'],
    ['https://GitHub.COM/o/r.git', 'o/r'],
    ['https://someone@github.com/o/r.git', 'o/r'],
    ['git@github.com:o/r.git', 'o/r'],
    ['git@github.com:o/r', 'o/r'],
    ['ssh://git@github.com/o/r.git', 'o/r'],
    ['ssh://git@github.com:22/o/r.git', 'o/r'],
    ['https://notgithub.com/o/r.git', null],
    ['git@notgithub.com:o/r.git', null],
    ['https://github.com.example.org/o/r.git', null],
    ['https://example.org/github.com/o/r.git', null],
    ['https://github.com/o', null],
    ['https://github.com/o/r/tree/dev', null],
  ]
  for (const [url, slug] of shapes) {
    gitIn(rig.root, 'remote', 'set-url', 'origin', url)
    gitIn(rig.root, 'config', '--add', `url.${origin}.insteadOf`, url)
    await rm(rig.ghLog, { force: true })
    const r = run(rig, ['--post-status'])
    if (slug === null) {
      assert.equal(r.code, 2, `${url} was taken for GitHub: ${r.stdout}`)
      assert.match(r.stderr, /which is not a repository on GitHub/, url)
      assert.deepEqual(await lines(rig.ghLog), [], `${url} was posted to`)
    } else {
      assert.equal(r.code, 0, `${url}: ${r.stderr}`)
      assert.equal((await posted(rig)).path, `repos/${slug}/statuses/${head}`, url)
    }
  }
})
