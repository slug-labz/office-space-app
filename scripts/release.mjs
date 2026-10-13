/**
 * Cut a release: build the artifacts, hash them, write the notes, upload, then check the upload.
 *
 * Releases here were made by hand, and the last one shows what that costs. `v0.0.1`'s notes name
 * the artifacts with spaces in them — GitHub serves `Office.Space-0.0.1-arm64.dmg`, with dots —
 * and they assert that Actions had refused every job since 2026-09-17, which stopped being true at
 * 08:24:00Z on 2026-10-01 while the notes went on saying it. Both are the same mistake: a release
 * described from memory rather than from the thing being released. So this script writes nothing
 * it has not read off disk or off the API.
 *
 * ## The one thing it will not let you do
 *
 * **Release a commit whose green check never ran.** On 2026-10-01 this project released a red
 * `main`, because "Actions has refused every job since 2026-09-17" was asserted for two weeks
 * without being re-measured. Asking for `conclusion == success` would have caught that one: a
 * billing refusal is a *failure* in seconds with no steps.
 *
 * The gate also asks for **at least one completed step**, which catches a different and quieter
 * case: a workflow that succeeded because every job in it was skipped — a path filter that matched
 * nothing, a job behind an `if` that was false. That reports green, has no steps, and means nobody
 * checked anything. The duration is printed beside each run because it is the free signal: the
 * refusals of September took 3 to 5 seconds where the real runs take 195 to 291.
 *
 * `--dry-run` does everything except create the tag, create the release, and upload: it builds,
 * hashes, and prints the notes it would have posted. That is the way to prove a change to this
 * file without spending a version number on it.
 *
 * ## Checksums, and what they are actually worth
 *
 * The app is ad-hoc signed on purpose — no Apple Developer membership, `docs/release.md` has the
 * reasoning and the price. A checksum is not a substitute for that signature and this script does
 * not pretend otherwise. What `SHA256SUMS.txt` catches is a truncated download and a tampered
 * mirror. What it cannot catch is a bad artifact uploaded here, because then the file and the
 * hash beside it change together. Say that in the notes rather than implying more.
 *
 * GitHub computes its own SHA-256 for every release asset and serves it as `digest` on the asset
 * object, so the upload is verified against the local hash **without downloading 240MB back**.
 * That check is the last thing this script does, and a mismatch fails the run after the release
 * exists — deliberately, because a release whose checksums are wrong should be visibly wrong
 * rather than quietly absent.
 *
 * ## It refuses, rather than guesses, in these cases
 *
 * - **Not Node 22.** `npm run dist` runs esbuild and electron-builder on whatever `node` is first
 *   on PATH, and on this machine that is 18. The major is asserted, not hoped for.
 * - **A dirty tree.** A release has to describe a commit. `graphify-out/` is excluded, as it is in
 *   `ci-local.mjs`, because this machine's hooks rewrite it on every checkout.
 * - **Not on `main`.** Releases are cut from `main`; `dev` reaches it by pull request. A tag on
 *   `dev` names a tree nobody promoted.
 * - **A version that does not match `package.json`.** The tag, the filenames electron-builder
 *   writes, and the notes all derive from one number. Bump it in a commit on `dev` and let it
 *   reach `main` the normal way — this script will not edit a tracked file and then release the
 *   tree it just changed.
 * - **A tag that already exists**, locally or on the remote. Moving a published tag means two
 *   people have different code under one name.
 * - **An artifact that is implausibly small.** A dmg under 50MB means the build half-finished;
 *   electron-builder exits 0 on some of those.
 * - **A flag it does not take**, so a typo is not a release without the thing it meant to ask.
 *   `npm run release --dry-run` without the `--` gives the flag to npm, which runs this without
 *   it; that is caught by requiring `--version` to be present and refusing unknown argv shapes.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RELEASE_DIR = join(ROOT, 'release')
const SUMS = 'SHA256SUMS.txt'

/** Exit codes, so a caller can tell the refusals apart. */
const EXIT = {
  usage: 2,
  node: 3,
  dirty: 4,
  branch: 5,
  version: 6,
  tag: 7,
  checks: 8,
  build: 9,
  upload: 10,
  digest: 11,
}

const KNOWN_FLAGS = new Set(['--version', '--dry-run', '--notes-only', '--allow-dirty', '--sha'])

function die(code, ...lines) {
  for (const l of lines) process.stderr.write(`${l}\n`)
  process.exit(code)
}

function say(...lines) {
  for (const l of lines) process.stdout.write(`${l}\n`)
}

/**
 * `stdio: 'inherit'` gives the child our streams, so there is no captured stdout and `execFileSync`
 * returns null — measured on Node 22.16. `null.trim()` throws, `tryRun` catches the TypeError, and
 * the step that *succeeded* is reported `failed (exit undefined)`: the build below is the one caller
 * that inherits, so until this line existed the script could not finish a release or a dry run.
 */
function run(cmd, args, opts = {}) {
  const out = execFileSync(cmd, args, { encoding: 'utf8', cwd: ROOT, ...opts })
  return out === null ? '' : out.trim()
}

function tryRun(cmd, args, opts = {}) {
  try {
    return { ok: true, out: run(cmd, args, opts) }
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim(), status: e.status }
  }
}

/* ------------------------------------------------------------------ argv */

const argv = process.argv.slice(2)
const flags = { dryRun: false, notesOnly: false, allowDirty: false, version: null, sha: null }

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!KNOWN_FLAGS.has(a)) {
    die(
      EXIT.usage,
      `release.mjs: unknown argument ${JSON.stringify(a)}.`,
      `Takes: ${[...KNOWN_FLAGS].join(' ')}`,
      `A flag this script does not know is a typo, and a typo must not become a release that`,
      `skipped the thing it meant to ask for.`,
    )
  }
  if (a === '--version') {
    flags.version = argv[++i] ?? null
    if (!flags.version) die(EXIT.usage, 'release.mjs: --version needs a value, e.g. --version 0.1.0')
  }
  if (a === '--sha') {
    flags.sha = argv[++i] ?? null
    if (!flags.sha) die(EXIT.usage, 'release.mjs: --sha needs a value.')
  }
  if (a === '--dry-run') flags.dryRun = true
  if (a === '--notes-only') flags.notesOnly = true
  if (a === '--allow-dirty') flags.allowDirty = true
}

if (!flags.version) {
  die(
    EXIT.usage,
    'release.mjs: --version is required.',
    '',
    '  node scripts/release.mjs --version 0.1.0 --dry-run   # build, hash, print the notes',
    '  node scripts/release.mjs --version 0.1.0             # and tag, release, upload, verify',
    '',
    'npm eats a bare --dry-run: write `npm run release -- --version 0.1.0 --dry-run`.',
  )
}

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(flags.version)) {
  die(EXIT.usage, `release.mjs: ${flags.version} is not a version. Expected 1.2.3 or 1.2.3-rc.1.`)
}

/**
 * A dry run may ask about a commit other than HEAD. The gate is the part of this script worth
 * rehearsing, and on an unpushed branch HEAD has no run to ask about — so a rehearsal that skipped
 * the gate would rehearse everything except the thing that matters. A real release always uses
 * HEAD: releasing a tree you are not standing on is how you ship something nobody built.
 *
 * This sits with the other argument checks and not with the repository checks below, because it is
 * a flaw in the command rather than in the tree. Asked from a feature branch it used to be answered
 * with "releases are cut from main" — true, and not what was wrong with what you typed.
 */
if (flags.sha && !flags.dryRun) {
  die(
    EXIT.usage,
    'release.mjs: --sha is for --dry-run only.',
    'A real release tags HEAD, because the artifacts were built from the tree on disk. Naming a',
    'different commit would put one version in the tag and another in the files.',
  )
}

const TAG = `v${flags.version}`

/* -------------------------------------------------------------- refusals */

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor !== 22) {
  die(
    EXIT.node,
    `release.mjs: running on Node ${process.versions.node}; this build is pinned to 22.`,
    `CI resolves node-version: '22' to 22.23.2. Put a 22 first on PATH and run again —`,
    `a release built on another major is a release nobody checked.`,
  )
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
if (pkg.version !== flags.version) {
  die(
    EXIT.version,
    `release.mjs: package.json says ${pkg.version}, you asked for ${flags.version}.`,
    `electron-builder names the artifacts from package.json, so these cannot differ: the files`,
    `would say one version and the tag another.`,
    `Bump it in a commit on dev and let it reach main by pull request.`,
  )
}

const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main' && !flags.dryRun) {
  die(
    EXIT.branch,
    `release.mjs: on ${branch}, and releases are cut from main.`,
    `dev reaches main by pull request; a tag anywhere else names a tree nobody promoted.`,
    `--dry-run works from any branch.`,
  )
}

const dirty = run('git', ['status', '--porcelain']).split('\n').filter(Boolean)
  .filter((l) => !l.slice(3).startsWith('graphify-out/'))
if (dirty.length && !flags.allowDirty) {
  die(
    EXIT.dirty,
    `release.mjs: ${dirty.length} uncommitted change(s). A release has to describe a commit.`,
    ...dirty.slice(0, 10).map((l) => `  ${l}`),
    dirty.length > 10 ? `  … and ${dirty.length - 10} more` : '',
    `graphify-out/ is already excluded. --allow-dirty overrides this and should not be used to`,
    `cut a real release.`,
  )
}

const sha = flags.sha ? run('git', ['rev-parse', flags.sha]) : run('git', ['rev-parse', 'HEAD'])
const shortSha = sha.slice(0, 7)

const tagExistsLocally = tryRun('git', ['rev-parse', '--verify', `refs/tags/${TAG}`]).ok
const remoteTag = tryRun('git', ['ls-remote', '--tags', 'origin', `refs/tags/${TAG}`])
const tagExistsRemotely = remoteTag.ok && remoteTag.out.length > 0
if ((tagExistsLocally || tagExistsRemotely) && !flags.dryRun) {
  die(
    EXIT.tag,
    `release.mjs: ${TAG} already exists (${tagExistsLocally ? 'locally' : ''}${
      tagExistsLocally && tagExistsRemotely ? ' and ' : ''
    }${tagExistsRemotely ? 'on origin' : ''}).`,
    `Moving a published tag means two people have different code under one name. Pick the next`,
    `version instead.`,
  )
}

/* ----------------------------------------- the check that must be a real run */

/**
 * A refused Actions run and a passing one are both "not a failure". They differ in shape: a
 * refusal has no steps. So this asks for steps, not for a colour, and prints the duration because
 * the refusals of September took 3 to 5 seconds where the real runs take 195 to 291.
 */
function assertChecksReallyRan(headSha) {
  const runsRaw = tryRun('gh', [
    'api',
    `repos/{owner}/{repo}/actions/runs?head_sha=${headSha}&per_page=20`,
    '--jq',
    '[.workflow_runs[] | {id, name, status, conclusion, started: .run_started_at, updated: .updated_at}]',
  ])
  if (!runsRaw.ok) {
    die(EXIT.checks, `release.mjs: could not ask GitHub about ${headSha.slice(0, 7)}.`, runsRaw.out)
  }
  const runs = JSON.parse(runsRaw.out)
  if (runs.length === 0) {
    die(
      EXIT.checks,
      `release.mjs: no workflow run exists for ${headSha.slice(0, 7)}.`,
      `A commit with no run cannot be told from one nobody checked. Push it and wait.`,
    )
  }

  const verdicts = []
  for (const r of runs) {
    const jobsRaw = tryRun('gh', [
      'api',
      `repos/{owner}/{repo}/actions/runs/${r.id}/jobs`,
      '--jq',
      '[.jobs[] | {name, conclusion, steps: ([.steps[]? | select(.conclusion != null)] | length)}]',
    ])
    const jobs = jobsRaw.ok ? JSON.parse(jobsRaw.out) : []
    const steps = jobs.reduce((n, j) => n + j.steps, 0)
    const seconds = Math.round((Date.parse(r.updated) - Date.parse(r.started)) / 1000)
    verdicts.push({ ...r, jobs: jobs.length, steps, seconds })
  }

  const real = verdicts.filter((v) => v.conclusion === 'success' && v.steps > 0)
  const table = verdicts
    .map((v) => `  ${v.name}: ${v.status}/${v.conclusion} · ${v.jobs} job(s) · ${v.steps} step(s) · ${v.seconds}s`)
    .join('\n')

  if (real.length === 0) {
    die(
      EXIT.checks,
      `release.mjs: nothing on ${headSha.slice(0, 7)} is a passing run that actually ran steps.`,
      table,
      ``,
      `A run that succeeded with 0 steps is a refusal wearing green — that is how a red main got`,
      `released on 2026-10-01. Fix the run, do not override this.`,
    )
  }
  say(`Checks on ${headSha.slice(0, 7)} — measured, not assumed:`, table)
  return real
}

/* ----------------------------------------------------------------- hashing */

function sha256(path) {
  const h = createHash('sha256')
  h.update(readFileSync(path))
  return h.digest('hex')
}

function artifacts() {
  if (!existsSync(RELEASE_DIR)) return []
  return readdirSync(RELEASE_DIR)
    .filter((f) => /\.(dmg|AppImage|zip|exe)$/.test(f))
    .map((f) => {
      const p = join(RELEASE_DIR, f)
      return { name: f, path: p, size: statSync(p).size, sha256: sha256(p) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** GitHub replaces a space in the product name with a dot. The notes must say what it serves. */
function servedAs(name) {
  return name.replace(/ /g, '.')
}

/* ------------------------------------------------------------------- notes */

function writeNotes(built, checks) {
  const stamp = run('date', ['-u', '+%Y-%m-%d %H:%M:%SZ'])
  const rows = built
    .map((a) => `| \`${servedAs(a.name)}\` | ${(a.size / 1048576).toFixed(1)} MB | \`${a.sha256}\` |`)
    .join('\n')
  const checkLines = checks
    .map((c) => `\`${c.name}\` passed in ${c.seconds} s over ${c.steps} steps`)
    .join('; ')

  return `Cut from \`main\` at \`${shortSha}\`, built ${stamp}.

## Verify the download before you open it

The app is **ad-hoc signed on purpose** — there is no Apple Developer membership on this account,
and \`docs/release.md\` names the price and the reasoning. So there is no signature to check, and
these hashes are what there is instead:

| File | Size | SHA-256 |
|---|---|---|
${rows}

\`\`\`bash
shasum -a 256 -c ${SUMS}      # with ${SUMS} and the files in the same directory
\`\`\`

**What that is worth, exactly.** It catches a truncated download and a tampered mirror. It does
not catch a bad artifact uploaded here, because then the file and the hash beside it change
together. It is not a substitute for notarisation and is not offered as one.

## macOS will refuse it the first time

Downloaded through a browser, macOS quarantines it and says *"Office Space" is damaged and can't
be opened*. It is not damaged. Right-click → Open **does not work** on a quarantined app; this is
the line that does:

\`\`\`bash
xattr -cr "/Applications/Office Space.app"
\`\`\`

The disk image carries \`INSTALL.txt\` and \`Fix permissions.command\` beside the app, and if the
app starts while still flagged it prints the command for the path it actually found.

## What ran

${checkLines}, on \`${shortSha}\`.

## What this does not include

**No Windows build.** Neither machine has one to test on. The code avoids POSIX assumptions and
\`test/claude-path.test.ts\` checks that, which is not the same as saying it works there.

**No Linux build.** The config asks for an AppImage and an AppImage cannot be produced on macOS.

**No auto-update.** It needs a signed app and a feed to host.
`
}

/* -------------------------------------------------------------------- main */

say(`Office Space ${TAG} — ${shortSha} on ${branch}${flags.dryRun ? ' (dry run)' : ''}`, '')

const checks = assertChecksReallyRan(sha)
say('')

if (!flags.notesOnly) {
  say('Building (npm run dist) …')
  const build = tryRun('npm', ['run', 'dist'], { stdio: 'inherit' })
  if (!build.ok) die(EXIT.build, `release.mjs: npm run dist failed (exit ${build.status}).`)
}

const built = artifacts()
if (built.length === 0) {
  die(EXIT.build, `release.mjs: no artifacts in ${RELEASE_DIR}. Nothing to release.`)
}

const tiny = built.filter((a) => a.size < 50 * 1048576)
if (tiny.length) {
  die(
    EXIT.build,
    `release.mjs: ${tiny.length} artifact(s) under 50MB — the build half-finished.`,
    ...tiny.map((a) => `  ${a.name}  ${(a.size / 1048576).toFixed(1)} MB`),
    `electron-builder exits 0 on some of those.`,
  )
}

const sumsBody = built.map((a) => `${a.sha256}  ${servedAs(a.name)}`).join('\n') + '\n'
const sumsPath = join(RELEASE_DIR, SUMS)
writeFileSync(sumsPath, sumsBody)
say('', `${SUMS}:`, sumsBody.trimEnd())

const notes = writeNotes(built, checks)
const notesPath = join(RELEASE_DIR, `notes-${TAG}.md`)
writeFileSync(notesPath, notes)
say('', `Notes written to ${notesPath} (${notes.split('\n').length} lines).`)

if (flags.dryRun) {
  say(
    '',
    '--- the notes it would have posted ---',
    notes,
    '--- end ---',
    '',
    `Dry run: no tag, no release, no upload. ${TAG} was not created.`,
  )
  process.exit(0)
}

say('', `Tagging ${TAG} at ${shortSha} …`)
run('git', ['tag', '-a', TAG, '-m', `Office Space ${flags.version}`])
run('git', ['push', 'origin', TAG])

say(`Creating the release and uploading ${built.length + 1} files …`)
const create = tryRun('gh', [
  'release', 'create', TAG,
  '--title', `Office Space ${flags.version}`,
  '--notes-file', notesPath,
  ...built.map((a) => a.path),
  sumsPath,
])
if (!create.ok) die(EXIT.upload, `release.mjs: gh release create failed.`, create.out)
say(create.out)

/* ------------------------------------------- verify the upload, for free */

say('', 'Checking what GitHub stored against what we hashed …')
const remoteRaw = tryRun('gh', [
  'api', `repos/{owner}/{repo}/releases/tags/${TAG}`,
  '--jq', '[.assets[] | {name, size, digest}]',
])
if (!remoteRaw.ok) die(EXIT.digest, 'release.mjs: could not read the release back.', remoteRaw.out)
const remote = new Map(JSON.parse(remoteRaw.out).map((a) => [a.name, a]))

let bad = 0
for (const a of built) {
  const want = `sha256:${a.sha256}`
  const got = remote.get(servedAs(a.name))
  if (!got) {
    say(`  MISSING  ${servedAs(a.name)} — uploaded but not listed`)
    bad++
  } else if (got.digest !== want) {
    say(`  MISMATCH ${servedAs(a.name)}`, `           local  ${want}`, `           GitHub ${got.digest}`)
    bad++
  } else {
    say(`  ok       ${servedAs(a.name)}  ${got.digest}`)
  }
}

if (bad) {
  die(
    EXIT.digest,
    '',
    `release.mjs: ${bad} asset(s) do not match what we hashed. ${TAG} exists and is wrong.`,
    `Leave it visible and fix it — a release with wrong checksums must not be quietly deleted.`,
  )
}

say('', `${TAG} published. ${built.length} artifacts, every digest checked against GitHub's own.`)
