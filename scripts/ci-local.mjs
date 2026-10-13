/**
 * The checks CI runs, run on this machine, for as long as CI cannot run them.
 *
 * `.github/workflows/checks.yml` runs three steps on every push to a PR or to `dev`: typecheck,
 * build, and the suite with coverage. On 2026-09-17 the organisation's GitHub Actions minutes
 * ran out, and they come back in about fourteen days. Until then "CI is green" is not evidence of
 * anything, and a merge that waits for it waits forever — so this runs the same three steps here
 * and says exactly what it ran, on which commit, on which machine.
 *
 * **Borrow it fresh for every run, and keep no copy.** A copy keeps the lock rules of the day it
 * was made. A copy from before the current rules (the first version, 2734b00, is one) deletes a
 * lock it judged stale, and can delete the one another run took a moment later, so two suites run
 * at once. Fetch, then `git show origin/<branch>:scripts/ci-local.mjs > <file>`, right before each
 * run. A run that finds a lock taken under other rules says so.
 *
 * **What it is not: Linux.** CI runs on `ubuntu-latest`. This runs on whatever machine you are
 * on, so a test that only fails on Linux passes here. The suite's own skip count is printed, not
 * hidden, and the report names the platform so nobody mistakes one for the other.
 *
 * **What it checks: this commit, not a merge.** CI checks a pull request merged into `dev`, as
 * `dev` stands when the run starts. That is the same tree as the head only when the head already
 * contains `dev`. So every run first fetches `dev` into `origin/dev`, and the report names that
 * commit and says whether the head contains it.
 *
 * It refuses, rather than guesses, in these cases:
 *
 * - **Not Node 22.** CI pins 22, and bare `node` on a developer machine can be another major.
 *   The steps then run on this same Node, whatever the caller's PATH finds first: its directory
 *   is put at the front of theirs.
 * - **A checkout holding worktrees.** `test/instructions.test.ts` copies the whole `.claude/` of
 *   the directory it runs in. In a checkout whose `.claude/worktrees/` holds other checkouts
 *   that is gigabytes, written into the temp folder, on a disk that may not have them.
 * - **Uncommitted changes**, unless `--allow-dirty`: a result has to describe a commit. Changes
 *   under `graphify-out/` are not counted: this machine's git hooks rewrite it on every commit
 *   and checkout, it is generated, and nothing the three steps run reads it.
 * - **`--post-status` for a head that does not contain `dev`**, or when `dev` could not be
 *   fetched: the status would describe a test CI would not have run. Also when `origin` is not a
 *   repository on GitHub, where the status would go.
 * - **A flag it does not take**, so that a typo is not a run without the thing it meant to ask.
 *   So is a flag npm kept for itself: `npm run checks:local --post-status`, without `--`, gives
 *   the flag to npm, which runs this without it.
 * - **Another run in progress** (exit 3). Two full suites at once push each other past the
 *   60-second test timeout, and the failures that produces look like real ones. One lock, one run
 *   at a time, among copies that keep the current lock rules. A lock whose owner has died is taken
 *   over; so is one whose owner cannot be read, once it is older than any run can last. A run
 *   removes only its own lock. Something at the lock's path that is not a directory is left alone,
 *   and so is a lock this user may not read, which cannot be judged or moved aside.
 *   Each takeover moves the old lock aside to `<lock>.stale-<inode>` and keeps it there, because
 *   that name is what keeps two takeovers apart. So they pile up, one small directory for each
 *   takeover; remove them only while no run is in progress.
 *
 * **A cancelled test is not a failed one.** The runner stops a test file that passes its own ceiling
 * and counts it cancelled, which says the machine had too much on it rather than that the code is
 * broken: on 2026-09-24 `8cc1c69` gave 0 failures and 1 or 2 cancellations at loads from 8.2 to 29.6
 * on 8 CPUs, and 3012 of 3012 with none cancelled on the same commit while the machine was quiet. So
 * a run whose only complaint is cancellations is called a timeout, not a failure: it says so with the
 * load it recorded, exits 6, and posts `error` — the state for a check that could not be completed.
 * Not `failure`, which is the word that cost a day; not `success`, which would claim a suite that did
 * not finish; and not nothing, because a commit with no status cannot be told from one nobody ran.
 * The status carries the counts and the load, because that is what a reader needs to know it was the
 * machine. Run it again on a quieter machine. A cancellation beside a failure is a failure, a suite
 * that was killed or hit its ceiling is a failure whatever its summary says, and the ceiling itself is
 * a separate question (TASKS.md row 96).
 *
 * Every run gets its own temp folder, handed to the children as `TMPDIR`, and removed at the end.
 * The suite leaves folders behind; they land there, get counted, and go. A folder the run cannot
 * remove, because a step left something in it this user may not delete, is left where it is, and
 * the report says so and where. The run still releases its lock, and still ends with the exit code
 * its checks earned.
 *
 * A run stopped by SIGINT, SIGTERM, SIGHUP or SIGQUIT first kills the step with everything it
 * started, then releases the folder and the lock, reports, and posts nothing. A second signal
 * releases what it can at once and exits. Any other signal that ends a process leaves all of it:
 * SIGKILL, which cannot be caught, and every signal this does not catch, SIGUSR2 and SIGALRM among
 * them. The step keeps running in a session of its own, the temp folder stays, and the lock's
 * owner is dead, so the next run takes the lock over and runs its suite alongside the one still
 * going. After such a signal, find the step's process group (`ps -eo pid,pgid,command`, the
 * `npm run` line) and kill it (`kill -- -<pgid>`) before running again.
 *
 *     node scripts/ci-local.mjs                 run the three steps, print a report
 *     node scripts/ci-local.mjs --post-status   and record it on GitHub as a commit status
 *     node scripts/ci-local.mjs --allow-dirty   run on a tree with uncommitted changes
 *     npm run checks:local -- --post-status     the same through npm, with the flags after --
 *
 * It checks the checkout it is run from, not the one this file sits in. A branch cut before the
 * script existed is checked by running another checkout's copy from inside that branch, which
 * leaves the branch's own tree untouched.
 *
 * `--post-status` writes a `local-checks` status on the commit through `gh`: `success` for a run that
 * passed, `error` for one that ran out of time, `failure` for everything else. It costs no Actions
 * minutes, and it says in its own description that it ran on this machine rather than in CI.
 * It is refused on a dirty tree, because the status would describe a commit that did not run.
 * After the steps, HEAD and the tree are read again: if either changed, the run fails and nothing
 * is posted, because the result no longer describes one commit.
 *
 * Exit codes, one for each way it can end:
 *
 *     0              every step passed, and was posted if --post-status asked for it
 *     1              the checks failed: a step failed, timed out, was killed or could not start,
 *                    the suite's summary was missing or reported failures, or the checkout changed
 *                    during the run (also when a failed run's status could not be posted)
 *     2              refused before anything ran: a flag, Node, worktrees, a dirty tree, origin, dev
 *     3              another run holds the lock, it could not be taken, its path holds something
 *                    that is not a lock, or this user may not read it
 *     4              every step passed, but --post-status could not record it (the reason is printed)
 *     5              the script itself broke on something it did not expect (printed as "crashed:").
 *                    It kills the step and releases the temp folder and the lock as far as it can,
 *                    and prints what it could not release.
 *     6              the suite cancelled tests and failed none, so the run ran out of time: neither a
 *                    pass nor a failure. Posted as `error`; still 6 if that could not be recorded,
 *                    with the reason printed
 *     129, 130, 131, 143
 *                    stopped by SIGHUP, SIGINT, SIGQUIT or SIGTERM (128 + the signal's number)
 */

import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { arch, constants, loadavg, platform, release } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

// What a run holds, for whichever way it ends: the step running now, the run's temp folder, the
// lock's token, and the signal that is stopping it.
let running = null
let tmp = null
let lockToken = null
let stopping = null

// Anything unexpected ends the run with an exit code of its own, never 1, which says a check
// failed. An error in the run itself arrives here after the run's `finally` has released what it
// held; one from anywhere else is released here.
process.on('uncaughtException', (error) => {
  console.error(`crashed: ${error?.stack ?? error}`)
  abandon()
  process.exit(5)
})

const FLAGS = ['--post-status', '--allow-dirty']
const ARGS = process.argv.slice(2)
const unknown = ARGS.filter((arg) => !FLAGS.includes(arg))
if (unknown.length > 0) refuse(`${unknown.join(' ')}: this takes only ${FLAGS.join(' and ')}.`)
// `npm run checks:local --post-status`, without `--`, gives the flag to npm rather than to this
// script. npm 10 keeps it as a setting, `npm_config_post_status=true`, and runs this without it.
// (`--no-post-status` leaves that setting empty, and asks for what a run does anyway.)
const keptByNpm = FLAGS.filter((flag) => !ARGS.includes(flag) && (process.env[`npm_config_${flag.slice(2).replaceAll('-', '_')}`] ?? '') !== '')
if (keptByNpm.length > 0) {
  // The command to run instead keeps every flag given, those that did reach this script too.
  const given = FLAGS.filter((flag) => ARGS.includes(flag) || keptByNpm.includes(flag))
  refuse(
    `npm kept ${keptByNpm.join(' and ')} for itself, so this run would go ahead without it. ` +
      `Put the flags after --: npm run ${process.env['npm_lifecycle_event'] ?? 'checks:local'} -- ${given.join(' ')}`,
  )
}
const POST = ARGS.includes('--post-status')
const ALLOW_DIRTY = ARGS.includes('--allow-dirty')

const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
if (top.status !== 0) refuse(`run this from inside a git checkout: ${(top.stderr || '').trim()}`)
const ROOT = top.stdout.trim()

// Short on purpose. tsx opens a socket inside TMPDIR, and macOS caps a socket path at 104 bytes:
// a temp folder under a long path makes the suite fail to start with EADDRINUSE.
const TMP_BASE = process.env['OFFICE_CHECKS_TMP_BASE'] ?? '/tmp'
const LOCK = process.env['OFFICE_CHECKS_LOCK'] ?? '/tmp/office-space-checks.lock'
const REPORTS = process.env['OFFICE_CHECKS_REPORTS'] ?? '/tmp/office-space-checks'
// The tests run the steps with a stand-in for npm. A run given one says so, in its report and in
// its status, because what it ran was not npm.
const NPM_OVERRIDE = process.env['OFFICE_CHECKS_NPM']
const NPM = NPM_OVERRIDE ?? 'npm'

/**
 * The three steps, in CI's order, each with a ceiling. CI kills its whole job at twenty minutes
 * (`timeout-minutes: 20` in checks.yml), and the three ceilings together are twenty minutes too.
 * That is looser than CI, not the same: CI's twenty minutes also pay for checkout, Node's setup
 * and `npm ci`, which this does not run, so steps that take nearly twenty minutes between them can
 * pass here and be killed there. Each ceiling is still over twenty times what the step took in the
 * first run that posted a status (4.3 s, 4.4 s and 39.9 s, on 2026-09-17), because the suite slows
 * down when other work shares the machine.
 */
const STEPS = [
  { name: 'typecheck', args: ['run', 'typecheck'], minutes: 3 },
  { name: 'build', args: ['run', 'build'], minutes: 2 },
  { name: 'tests, with coverage', args: ['run', 'coverage'], minutes: 15, summary: true },
]

// The tests shorten every ceiling with this. A run given it says so in its report.
const CEILING_SECONDS = process.env['OFFICE_CHECKS_CEILING_SECONDS']
if (CEILING_SECONDS !== undefined && !(Number(CEILING_SECONDS) > 0)) refuse(`OFFICE_CHECKS_CEILING_SECONDS is a number of seconds above 0, not "${CEILING_SECONDS}"`)
const ceilingMs = (step) => (CEILING_SECONDS === undefined ? step.minutes * 60_000 : Number(CEILING_SECONDS) * 1000)

/**
 * Longer than any run can last: every step at its ceiling, plus the git calls and output waits
 * around them. A lock whose owner cannot be read is taken over once it is older than this.
 */
const LONGEST_RUN_MS = (STEPS.reduce((sum, step) => sum + step.minutes, 0) + 5) * 60_000

/**
 * How long a step's output may stay open after its process has exited. npm has written everything
 * by then; what still holds the output is something the step started outside its own process
 * group, out of reach of the group kill, and still running while the lock is released.
 */
const OUTPUT_GRACE_MS = 2_000

function refuse(message, code = 2) {
  console.error(`refused: ${message}`)
  process.exit(code)
}

/** Git in the checkout under test. It never prompts: a fetch that wants a password fails instead. */
function gitRun(...args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 60_000 })
}

function git(...args) {
  const r = gitRun(...args)
  if (r.status !== 0) refuse(`git ${args.join(' ')} failed: ${why(r)}`)
  return r.stdout.trim()
}

/** Why a finished `spawnSync` did not succeed, in its own words where it gave any. */
function why(r) {
  return (r.error?.message ?? r.stderr ?? '').trim() || (r.signal ? `killed by ${r.signal}` : `exit ${r.status}`)
}

// ── refusals ───────────────────────────────────────────────────────────────────────────────

const nodeMajor = process.versions.node.split('.')[0]
if (nodeMajor !== '22') refuse(`this is Node ${process.versions.node}; CI runs 22. Put Node 22 first on PATH and run again.`)

const worktrees = join(ROOT, '.claude', 'worktrees')
if (existsSync(worktrees) && (await readdir(worktrees)).length > 0) {
  refuse(
    `${worktrees} holds other checkouts, and test/instructions.test.ts copies this checkout's whole .claude/ into the temp folder. ` +
      'Run from a worktree instead, e.g. git worktree add --detach <path> <ref>, and run this script there.',
  )
}

const sha = git('rev-parse', 'HEAD')
const STATUS = ['status', '--porcelain', '--', '.', ':(exclude)graphify-out']
const statusBefore = gitRun(...STATUS)
if (statusBefore.status !== 0) refuse(`git ${STATUS.join(' ')} failed: ${why(statusBefore)}`)
const dirty = statusBefore.stdout.trim() !== ''
if (dirty && !ALLOW_DIRTY) refuse('the tree has uncommitted changes, so a result would not describe any commit. Commit them, or pass --allow-dirty.')
if (dirty && POST) refuse('--post-status on a dirty tree would record a result for a commit that did not run.')

// ── where a status would go, and the dev CI would merge with ───────────────────────────────

const slug = POST ? originSlug() : null
const dev = checkDev()
if (POST && dev.error !== null) refuse(`--post-status has to say which dev this was checked against, and ${dev.error}`)
if (POST && !dev.contained) {
  refuse(
    `this commit does not contain dev (${dev.sha.slice(0, 7)}). CI tests a pull request merged with dev, so a result for this commit alone ` +
      'is not the result CI would give. Rebase onto origin/dev and run again.',
  )
}

/** The GitHub repository `origin` names, as `owner/name`. Anything else refuses the post. */
function originSlug() {
  // The configured URL, not `git remote get-url`, which rewrites it through `insteadOf`: that is
  // where git fetches from, while this names the repository on GitHub.
  const configured = gitRun('config', '--get', 'remote.origin.url')
  if (configured.status !== 0) refuse(`--post-status needs a remote named origin, and git config --get remote.origin.url found none (${why(configured)}).`)
  const url = configured.stdout.trim()
  const slug = githubSlug(url)
  if (slug === null) refuse(`--post-status records the result on GitHub, and origin is ${url}, which is not a repository on GitHub.`)
  return slug
}

/**
 * `owner/name` from a GitHub remote URL, or null. It takes https and ssh (scp-style too), with or
 * without a user, a port, `.git` or a trailing slash, and the host in any case. The host has to be
 * github.com itself: a name that only ends in it, or only contains it, is somewhere else.
 */
function githubSlug(url) {
  const match = url.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]+@)?github\.com(?::\d+)?[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
  return match === null ? null : `${match[1]}/${match[2]}`
}

/**
 * Fetches `dev` and asks whether the commit this run reports contains it: that commit, rather than
 * whatever HEAD is by now. The refspec is spelled out so that `origin/dev` is updated whatever the
 * remote's fetch configuration says.
 */
function checkDev() {
  const fetched = gitRun('fetch', '--quiet', 'origin', '+refs/heads/dev:refs/remotes/origin/dev')
  if (fetched.status !== 0) return { sha: null, contained: null, error: `git fetch origin dev failed: ${why(fetched)}` }
  const named = gitRun('rev-parse', '--verify', 'refs/remotes/origin/dev^{commit}')
  if (named.status !== 0) return { sha: null, contained: null, error: `origin/dev names no commit after the fetch: ${why(named)}` }
  const devSha = named.stdout.trim()
  const ancestor = gitRun('merge-base', '--is-ancestor', devSha, sha)
  if (ancestor.status === 0 || ancestor.status === 1) return { sha: devSha, contained: ancestor.status === 0, error: null }
  return { sha: devSha, contained: null, error: `git merge-base --is-ancestor failed: ${why(ancestor)}` }
}

function devLine(dev) {
  if (dev.sha === null) return `not checked: ${dev.error}`
  if (dev.contained === null) return `${dev.sha}, but whether this commit contains it is unknown: ${dev.error}`
  return dev.contained ? `${dev.sha}, which this commit contains` : `${dev.sha}, which this commit does not contain, so CI would test the two merged`
}

// ── one run at a time ──────────────────────────────────────────────────────────────────────

/**
 * The lock is a directory that only ever appears whole: the owner record, with a token only this
 * run knows, is written into a directory of the run's own, which is then renamed into place.
 * Renaming onto a directory that has anything in it fails, so of two runs only one can take it,
 * and no run ever finds it without its owner. (An empty directory there is replaced. This script
 * never leaves one; the version before it did, between its mkdir and its write.)
 *
 * A lock whose owner has died, or whose owner cannot be read once it is older than any run can
 * last, is moved aside to a name made from its inode, and kept there. A run that judged the same
 * lock a moment later tries that same rename and fails, because the name is taken and not empty,
 * so it can never move aside a lock that another run has just taken. That holds only among copies
 * that keep these rules, which is why the owner record says which rules it keeps.
 */
function takeLock() {
  const token = randomUUID()
  const mine = `${LOCK}.new-${token}`
  for (let attempt = 0; attempt < 5; attempt++) {
    mkdirSync(mine)
    try {
      const owner = { pid: process.pid, sha, startedAt: new Date().toISOString(), token, lockRules: LOCK_RULES }
      writeFileSync(join(mine, 'owner.json'), JSON.stringify(owner))
      renameSync(mine, LOCK)
      return token
    } catch (error) {
      rmSync(mine, { recursive: true, force: true })
      // ENOTDIR: what is in the way is not a directory, and inspectLock refuses it. EACCES from the
      // rename: this user may not replace what is there (on macOS, even an empty directory it may
      // not read), and inspectLock refuses a lock it may not read. EACCES from the write is this
      // run's own directory, and a crash.
      const inTheWay = ['ENOTEMPTY', 'EEXIST', 'ENOTDIR'].includes(error.code) || (error.code === 'EACCES' && error.syscall === 'rename')
      if (!inTheWay) throw error
    }
    const held = inspectLock()
    if (held === null) continue
    if (!held.stale) refuse(held.refusal, 3)
    pauseBeforeTakeover()
    const aside = `${LOCK}.stale-${held.ino}`
    try {
      renameSync(LOCK, aside)
    } catch (error) {
      // Gone, or another run moved it aside first: look again.
      if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) continue
      throw error
    }
    console.error(`note: taking over a lock ${held.why}. It is kept at ${aside}.${held.rules}`)
  }
  refuse(`could not take ${LOCK} in 5 attempts: other runs kept taking it first.`, 3)
}

/**
 * The lock rules this copy keeps, as a number in its owner record. Raise it whenever they change,
 * so that a run can tell a lock taken under other rules. A record with no number is older: with a
 * token it is from this script before the number was added, which kept these same rules (2); with
 * none, from a copy that deleted a stale lock outright (1).
 */
const LOCK_RULES = 2

/** A sentence for a lock taken under other rules than this copy's, or nothing. */
function otherRules(owner) {
  const rules = owner.lockRules ?? (owner.token === undefined ? 1 : 2)
  if (rules === LOCK_RULES) return ''
  const which = rules === 1 ? 'from before its current lock rules, which can remove a lock another run has just taken' : `with lock rules ${rules}, where this one keeps ${LOCK_RULES}`
  return ` It was taken by a copy of this script ${which}: fetch the script fresh for every run.`
}

/**
 * For the tests alone, and only when `OFFICE_CHECKS_TAKEOVER_PAUSE` names a path: waits between
 * judging a lock stale and moving it aside, having written `<path>.reached`, until `<path>.go`
 * exists or thirty seconds pass. That is when another run can take the lock over first, which is
 * what the inode name is for, and nothing else lets a test hold a run there. Set but empty, it
 * names no path, and asks for no pause.
 */
function pauseBeforeTakeover() {
  const pause = process.env['OFFICE_CHECKS_TAKEOVER_PAUSE']
  if (!pause) return
  console.error(`note: waiting before moving the lock aside, as OFFICE_CHECKS_TAKEOVER_PAUSE asks`)
  writeFileSync(`${pause}.reached`, `${process.pid}\n`)
  const nap = new Int32Array(new SharedArrayBuffer(4))
  for (const end = Date.now() + 30_000; !existsSync(`${pause}.go`) && Date.now() < end; ) Atomics.wait(nap, 0, 0, 20)
}

/** The lock as it stands: null if there is nothing to judge, else whether it may be taken over. */
function inspectLock() {
  let info
  let names
  try {
    info = lstatSync(LOCK, { bigint: true })
    if (!info.isDirectory()) {
      return {
        stale: false,
        refusal: `${LOCK} is there, but it is not a directory, so it is no lock this script made. It was left as it is. If nothing needs it, remove it with: rm ${LOCK}`,
      }
    }
    names = readdirSync(LOCK)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    // Whose lock it is cannot be told, and on macOS it cannot be moved aside either: renaming a
    // directory there takes leave to write in it.
    if (error.code === 'EACCES') {
      return {
        stale: false,
        refusal:
          `${LOCK} is there, but this user may not read it (EACCES), so whose lock it is cannot be told. It was left as it is. ` +
          `If no run is in progress, whoever owns it can remove it with: chmod u+rwx ${LOCK} && rm -r ${LOCK}`,
      }
    }
    throw error
  }
  // An empty directory is taken by the rename itself, next time round.
  if (names.length === 0) return null
  let owner = null
  let unreadable = null
  try {
    owner = JSON.parse(readFileSync(join(LOCK, 'owner.json'), 'utf8'))
    if (!Number.isInteger(owner?.pid)) unreadable = 'owner.json names no pid'
  } catch (error) {
    unreadable = error.code === 'ENOENT' ? 'there is no owner.json' : (error.code ?? error.message)
  }
  const clear = `If no run is in progress, remove it with: rm -r ${LOCK}`
  if (unreadable === null) {
    const since = `on ${String(owner.sha).slice(0, 7)}, since ${owner.startedAt}`
    const rules = otherRules(owner)
    if (owner.pid !== process.pid && alive(owner.pid)) {
      return { stale: false, refusal: `another run holds ${LOCK} (pid ${owner.pid}, ${since}). One full suite at a time.${rules} ${clear}` }
    }
    return { stale: true, ino: info.ino, why: `left by pid ${owner.pid}, which is no longer running (${since})`, rules }
  }
  const minutes = Math.floor((Date.now() - Number(info.mtimeMs)) / 60_000)
  if (minutes * 60_000 < LONGEST_RUN_MS) {
    return {
      stale: false,
      refusal:
        `${LOCK} is held, but its owner could not be read (${unreadable}). It last changed ${minutes} minutes ago, so a run may be starting; ` +
        `it is taken over once it is ${LONGEST_RUN_MS / 60_000} minutes old. ${clear}`,
    }
  }
  return { stale: true, ino: info.ino, why: `whose owner could not be read (${unreadable}), ${minutes} minutes old`, rules: '' }
}

/**
 * Removes the lock, but only if it is still this run's. It is renamed away before it is deleted,
 * so no other run can find it half removed.
 */
function releaseLock() {
  let owner = null
  try {
    owner = JSON.parse(readFileSync(join(LOCK, 'owner.json'), 'utf8'))
  } catch {
    // Gone, or unreadable: either way it cannot be shown to be this run's.
  }
  if (owner?.token !== lockToken) {
    const rules = Number.isInteger(owner?.pid) ? otherRules(owner) : ''
    console.error(`note: ${LOCK} is no longer this run's lock, so it was left where it is.${rules}`)
    return
  }
  const gone = `${LOCK}.released-${lockToken}`
  try {
    renameSync(LOCK, gone)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  rmSync(gone, { recursive: true, force: true })
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

// ── the run ────────────────────────────────────────────────────────────────────────────────

/**
 * Runs one step. It is over when its process exits — not when its output closes, which something
 * the step started can hold open for as long as it likes, while this run holds the lock. At the
 * ceiling, or at exit, whatever is left in the step's process group is killed.
 */
function runStep(step, env) {
  return new Promise((resolve) => {
    const started = Date.now()
    const ceiling = ceilingMs(step)
    const child = spawn(NPM, step.args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    running = child
    let output = ''
    const take = (chunk, stream) => {
      const text = chunk.toString()
      output += text
      stream.write(text)
    }
    child.stdout.on('data', (c) => take(c, process.stdout))
    child.stderr.on('data', (c) => take(c, process.stderr))
    const result = { name: step.name, code: null, signal: null, timedOut: false, heldOpen: false, error: null, summaryProblem: null, summaryTimeout: null, ceilingSeconds: ceiling / 1000 }
    let exited = false
    let grace
    const finish = () => {
      clearTimeout(timer)
      clearTimeout(grace)
      running = null
      resolve({ ...result, seconds: (Date.now() - started) / 1000, output })
    }
    const timer = setTimeout(() => {
      result.timedOut = true
      killGroup(child)
    }, ceiling)
    child.on('error', (error) => {
      result.error = error.message
      finish()
    })
    child.on('exit', (code, signal) => {
      exited = true
      clearTimeout(timer)
      result.code = code
      result.signal = signal
      killGroup(child)
      grace = setTimeout(() => {
        result.heldOpen = true
        child.stdout.destroy()
        child.stderr.destroy()
        finish()
      }, OUTPUT_GRACE_MS)
    })
    child.on('close', () => {
      if (exited) finish()
    })
  })
}

/** The whole group: `npm run` starts a shell, which starts the real work. */
function killGroup(child) {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // Nothing left in it.
  }
}

/**
 * A step passed only if it ran, exited 0 by itself, let go of its output, and — for the suite — its
 * own summary agrees.
 */
function stepPassed(r) {
  return stepRanCleanly(r) && r.summaryProblem === null && r.summaryTimeout === null
}

/**
 * That the step ran to an end of its own: started, exited 0, not killed, not at its ceiling, and not
 * still holding its output. Everything but what its summary said. A suite that ended any other way is
 * a failure whatever counts it managed to print first — the summary of a killed run is not the
 * summary of a run.
 */
function stepRanCleanly(r) {
  return r.error === null && !r.timedOut && r.code === 0 && !r.heldOpen
}

/** How a step ended, after its name: the first thing wrong with it, or that it passed. */
function howItEnded(r, took = '') {
  if (r.error !== null) return `could not start${took}: ${r.error}`
  if (r.timedOut) return `timed out${took}, at its ceiling of ${r.ceilingSeconds}s`
  if (r.signal !== null) return `killed by ${r.signal}${took}`
  if (r.code !== 0) return `failed (exit ${r.code})${took}`
  if (r.heldOpen) return `exited 0${took}, but something it started outside its process group still held its output ${OUTPUT_GRACE_MS / 1000}s later`
  if (r.summaryProblem !== null) return `exited 0${took}, but ${r.summaryProblem}`
  if (r.summaryTimeout !== null) return `exited 0${took}, but ${r.summaryTimeout}`
  return `passed${took}`
}

/**
 * What is wrong with the suite's closing counts, or null. An exit code of 0 is not enough on its
 * own: the counts have to be there, all four, and nothing may have failed. A cancelled test is not
 * a failed one; see `summaryTimeout` below, and the header.
 */
function summaryProblem(counts) {
  const missing = ['tests', 'pass', 'fail', 'cancelled'].filter((key) => counts[key] === undefined)
  if (missing.length > 0) return `the suite printed no complete summary (no ${missing.map((key) => `# ${key}`).join(', ')})`
  if (!(counts.fail > 0)) return null
  const bad = [`${counts.fail} failed`, ...(counts.cancelled > 0 ? [`${counts.cancelled} cancelled`] : [])]
  return `the suite reported ${bad.join(' and ')}`
}

/**
 * That the suite ran out of time rather than finding anything wrong, or null. Only a summary that is
 * all there and failed nothing can say this: a summary that cannot be read is a problem of its own,
 * and a cancellation beside a failure is a failure.
 */
function summaryTimeout(counts) {
  if (summaryProblem(counts) !== null || !(counts.cancelled > 0)) return null
  return `the suite cancelled ${counts.cancelled} of ${counts.tests} tests and failed none`
}

/** The node test runner's closing lines: `# tests 12`, `# pass 11`, and so on. */
function summaryOf(output) {
  const counts = {}
  for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms']) {
    const found = [...output.matchAll(new RegExp(`^# ${key} (\\d+(?:\\.\\d+)?)$`, 'gm'))].at(-1)
    if (found) counts[key] = Number(found[1])
  }
  // The last, like the counts: a test may print a line of the same shape before the real one.
  const coverage = output.split('\n').findLast((line) => /^# all files\s*\|/.test(line))
  return { counts, coverage: coverage === undefined ? null : coverage.replace(/^# /, '').trim() }
}

/**
 * What changed in the checkout while the steps ran: a result is only about the commit it started
 * on if HEAD is still there and the tree is as it was. For a tree that was already dirty this
 * compares which files are changed, not what is in them.
 */
function changesDuringRun() {
  const head = gitRun('rev-parse', 'HEAD')
  const status = gitRun(...STATUS)
  const changes = []
  if (head.status !== 0) changes.push(`HEAD could not be read after the run: ${why(head)}`)
  else if (head.stdout.trim() !== sha) changes.push(`HEAD moved during the run, from ${sha.slice(0, 7)} to ${head.stdout.trim().slice(0, 7)}`)
  if (status.status !== 0) changes.push(`the tree could not be read after the run: ${why(status)}`)
  else if (status.stdout !== statusBefore.stdout) {
    const entries = (text) => new Set(text.split('\n').filter(Boolean))
    const [was, now] = [entries(statusBefore.stdout), entries(status.stdout)]
    const show = (line, prefix = '') => `${line.slice(3)} (${prefix}${line.slice(0, 2).trim()})`
    const files = [...[...now].filter((line) => !was.has(line)).map((line) => show(line)), ...[...was].filter((line) => !now.has(line)).map((line) => show(line, 'was '))]
    const listed = files.length > 5 ? `${files.slice(0, 5).join(', ')} and ${files.length - 5} more` : files.join(', ')
    changes.push(`the tree changed during the run: ${listed}`)
  }
  return changes
}

async function leftIn(dir) {
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    return { total: null, office: null }
  }
  return { total: names.length, office: names.filter((n) => n.startsWith('office-')).length }
}

// ── stopping ───────────────────────────────────────────────────────────────────────────────

/**
 * Ctrl-C, Ctrl-\, a closed terminal or a kill ends the run the usual way. The step runs in a
 * process group of its own, so none of them reaches it by itself: the handler kills that whole
 * group, and the run releases its temp folder and lock once the step's process has gone. A second
 * signal releases what it can at once and exits. SIGKILL, and every signal not listed here, is
 * beyond this; see the header.
 */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
  process.on(signal, () => {
    if (running !== null) killGroup(running)
    if (stopping !== null) {
      abandon()
      process.exit(128 + constants.signals[signal])
    }
    stopping = signal
    console.error(`\n${signal}: stopping the step and everything it started`)
  })
}

/**
 * Kills the step and releases the temp folder and the lock at once, each as far as it can: a
 * folder that cannot be removed does not keep the lock from being released.
 */
function abandon() {
  if (running !== null) killGroup(running)
  if (tmp !== null) {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch (error) {
      console.error(`could not remove the run's temp folder, so it is still at ${tmp}: ${error.message}`)
    }
  }
  if (lockToken !== null) {
    try {
      releaseLock()
    } catch (error) {
      console.error(`could not release ${LOCK}: ${error.message}`)
    }
  }
}

// After a hangup nothing reads what this writes, and a failed write must not end the run before it
// has released what it holds.
for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {})

// ── the run, and what it says ──────────────────────────────────────────────────────────────

lockToken = takeLock()
const loadBefore = loadavg().map((n) => n.toFixed(2)).join(' ')
const results = []
let left = { total: null, office: null }
// The temp folder, when it could not be removed: where it is, and why.
let kept = null
let changed = []
try {
  tmp = await realpath(await mkdtemp(join(TMP_BASE, 'osc-')))
  // The steps run on the Node checked above. `tsc` and `tsx` start with `#!/usr/bin/env node`, and
  // npm 10 puts only `node_modules/.bin` directories in front of PATH, not its own Node's, so a
  // shell whose PATH starts with another Node would run the checks on that one while the report
  // named this one. `npm` itself is looked up on this PATH too, so it is the one beside this Node.
  const PATH = [dirname(process.execPath), process.env['PATH']].filter(Boolean).join(delimiter)
  const env = { ...process.env, TMPDIR: tmp, PATH }
  for (const step of STEPS) {
    if (stopping !== null) break
    console.log(`\n── ${step.name} ──`)
    const result = await runStep(step, env)
    if (step.summary) {
      const counts = summaryOf(result.output).counts
      result.summaryProblem = summaryProblem(counts)
      result.summaryTimeout = summaryTimeout(counts)
    }
    results.push(result)
    if (!stepPassed(result)) break
  }
  changed = changesDuringRun()
} finally {
  if (tmp !== null) {
    left = await leftIn(tmp)
    try {
      await rm(tmp, { recursive: true, force: true })
    } catch (error) {
      // Left where it is, and said so below. The lock and the verdict do not depend on it: a step
      // left something this user may not delete, which is somebody's to look at, not a failure.
      kept = { path: tmp, why: error.message }
    }
    tmp = null
  }
  releaseLock()
  lockToken = null
}
const loadAfter = loadavg().map((n) => n.toFixed(2)).join(' ')

const passed = stopping === null && changed.length === 0 && results.length === STEPS.length && results.every(stepPassed)
const tests = summaryOf(results.find((r) => r.name === 'tests, with coverage')?.output ?? '')
/**
 * What a run that ran out of time says, or null when that is not what happened: the suite ran to an
 * end of its own, its only complaint is its own cancellations, and nothing else went wrong. The load
 * goes in the sentence because it is what told this apart from a break on 2026-09-24. A suite that
 * was killed or hit its ceiling is a failure however its counts read, and so is a run whose checkout
 * moved under it or that a signal stopped: those describe no finished run and no single commit. The
 * last two guards are the ones `passed` carries on the line above, for the same reasons.
 */
const cancelledSuite = results.find((r) => r.summaryTimeout !== null && stepRanCleanly(r))
const outOfTime =
  stopping === null && changed.length === 0 && results.length === STEPS.length && cancelledSuite !== undefined && results.every((r) => r === cancelledSuite || stepPassed(r))
    ? `${cancelledSuite.summaryTimeout}, at load ${loadBefore} before, ${loadAfter} after. A cancelled test ran out of time, which is not a defect, so this run is neither a pass nor a failure.`
    : null
const report = {
  sha,
  dirty,
  dev,
  passed,
  outOfTime,
  stoppedBy: stopping,
  platform: `${platform()} ${release()} ${arch()}`,
  node: process.versions.node,
  ranAt: new Date().toISOString(),
  loadBefore,
  loadAfter,
  ceilingsFrom: CEILING_SECONDS === undefined ? 'this script' : `OFFICE_CHECKS_CEILING_SECONDS=${CEILING_SECONDS}`,
  npmFrom: NPM_OVERRIDE === undefined ? 'PATH' : `OFFICE_CHECKS_NPM=${NPM_OVERRIDE}`,
  steps: results.map(({ name, code, signal, timedOut, heldOpen, error, summaryProblem, summaryTimeout, ceilingSeconds, seconds }) => ({
    name,
    code,
    signal,
    timedOut,
    heldOpen,
    error,
    summaryProblem,
    summaryTimeout,
    ceilingSeconds,
    seconds: Number(seconds.toFixed(1)),
  })),
  notRun: STEPS.slice(results.length).map((s) => s.name),
  tests: tests.counts,
  coverage: tests.coverage,
  leftInTempFolder: left,
  tempFolderKept: kept,
  changedDuringRun: changed,
}

console.log('\n── local checks ──')
console.log(`commit      ${sha}${dirty ? ' (with uncommitted changes)' : ''}`)
console.log(`dev         ${devLine(dev)}`)
console.log(`machine     ${report.platform}, Node ${report.node} — not CI, and not Linux`)
console.log(`load        ${loadBefore} before, ${loadAfter} after`)
if (CEILING_SECONDS !== undefined) console.log(`ceilings    ${CEILING_SECONDS}s each, from OFFICE_CHECKS_CEILING_SECONDS`)
if (NPM_OVERRIDE !== undefined) console.log(`npm         ${NPM_OVERRIDE}, from OFFICE_CHECKS_NPM`)
if (stopping !== null) console.log(`stopped     by ${stopping}, before the run could finish`)
for (const s of report.steps) console.log(`${s.name.padEnd(22)}${howItEnded(s, ` in ${s.seconds}s`)}`)
const whyNotRun = stopping === null ? 'an earlier step failed' : 'the run was stopped'
for (const name of report.notRun) console.log(`${name.padEnd(22)}not run, because ${whyNotRun}`)
if (Object.keys(tests.counts).length > 0) {
  const c = tests.counts
  console.log(`tests       ${c.tests ?? '?'} tests: ${c.pass ?? '?'} pass, ${c.fail ?? '?'} fail, ${c.cancelled ?? '?'} cancelled, ${c.skipped ?? '?'} skipped`)
}
if (tests.coverage !== null) console.log(`coverage    ${tests.coverage}`)
const leftBehind = `left behind ${left.total ?? '?'} entries (${left.office ?? '?'} office-*) in the run's own temp folder`
console.log(kept === null ? `${leftBehind}, now removed` : `${leftBehind}, which could not be removed, so it is still at ${kept.path}: ${kept.why}`)
for (const change of changed) console.log(`changed     ${change}`)
if (outOfTime !== null) console.log(`out of time ${outOfTime}`)
console.log(passed ? 'result      PASSED' : outOfTime !== null ? 'result      TIMED OUT' : 'result      FAILED')

await mkdir(REPORTS, { recursive: true })
const file = join(REPORTS, `${sha}.json`)
await writeFile(file, `${JSON.stringify(report, null, 2)}\n`)
console.log(`report      ${file}`)

let posted = true
if (POST && stopping !== null) console.error(`status not posted: the run was stopped by ${stopping}`)
else if (POST && changed.length > 0) console.error('status not posted: the checkout changed during the run, so the result describes no single commit')
else if (POST) posted = postStatus(report)
process.exitCode = stopping !== null ? 128 + constants.signals[stopping] : outOfTime !== null ? 6 : !passed ? 1 : posted ? 0 : 4

/** Records the result as a `local-checks` commit status. Says why, and returns false, if it could not. */
function postStatus(report) {
  // A run that passed has the suite's four counts; `# skipped` is not one of them.
  const c = report.tests
  const failed = report.steps.find((s) => !stepPassed(s))
  // `error` is GitHub's state for a check that could not be completed, which is what a run out of
  // time is. It still blocks anything waiting for a green one.
  const state = report.passed ? 'success' : report.outOfTime === null ? 'failure' : 'error'
  // 140 characters cannot hold the verdict's own sentence beside `where`, and a cut one would lose
  // the load mid-number, so this says the same facts short: what was cancelled, that nothing failed,
  // and the one-minute load before and after. The whole sentence is on screen and in the report.
  const oneMinute = (load) => load.split(' ')[0]
  const what =
    state === 'error'
      ? `timed out: ${c.cancelled} of ${c.tests} cancelled, ${c.fail} failed, load ${oneMinute(report.loadBefore)}→${oneMinute(report.loadAfter)}`
      : failed === undefined
        ? `typecheck, build, ${c.pass}/${c.tests} pass, ${c.fail} fail, ${c.skipped ?? '?'} skipped`
        : `${failed.name} ${howItEnded(failed)}`
  // GitHub takes 140 characters. What gets cut is the detail, never which dev and where it ran, or
  // that the steps were not npm's.
  const npm = NPM_OVERRIDE === undefined ? '' : ', npm from OFFICE_CHECKS_NPM'
  const where = ` — dev ${report.dev.sha.slice(0, 7)}, on ${platform()}, Node ${report.node}${npm}, not CI`
  const room = 140 - where.length
  const description = `${what.length > room ? `${what.slice(0, room - 1)}…` : what}${where}`
  const r = spawnSync(
    'gh',
    ['api', '-X', 'POST', `repos/${slug}/statuses/${report.sha}`, '-f', `state=${state}`, '-f', 'context=local-checks', '-f', `description=${description}`],
    { encoding: 'utf8', timeout: 60_000 },
  )
  if (r.status !== 0) {
    console.error(`status not posted: gh api failed: ${why(r)}`)
    return false
  }
  console.log(`status      local-checks = ${state} on ${slug}@${report.sha.slice(0, 7)}`)
  return true
}
