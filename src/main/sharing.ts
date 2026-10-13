/**
 * Asking git what it would push.
 *
 * The decisions are in `shared/sharing.ts`. This asks the only authority there is, which is git
 * itself — a table in our source saying which paths are ignored would agree with `.gitignore` the
 * day it was written and drift afterwards, and the drift would be silent in the direction that
 * matters.
 *
 * ## Why `git check-ignore` and not `git status`
 *
 * `status` answers *what is dirty now*. That is a different question with the same shape and the
 * wrong answer: `memory/` with nothing new in it is clean, and clean is not ignored. The question
 * here is what the rules say about a path, which is exactly what `check-ignore` reports and
 * nothing else does.
 *
 * ## And why the path asked about is not always the path shown
 *
 * A bare directory is the wrong question. `memory/**` matches files *inside* `memory`, not
 * `memory` itself — so `check-ignore memory` says *not ignored* about a directory whose every file
 * is ignored. The first version of this reported three false leaks against this repo's own
 * `.gitignore`. `probe()` asks about a child, which both rule styles match.
 *
 * ## The exit codes, which are the whole interface
 *
 *     0   ignored
 *     1   not ignored           — a normal answer, not a failure
 *     128 not a repository, or something genuinely wrong
 *
 * A caller that treats non-zero as failure gets *"could not be asked"* for every unignored path,
 * which turns the one alarming state into a shrug. `--no-index` so a file already tracked still
 * reports what the rules say — otherwise a `memory/` somebody committed before the rule existed
 * comes back "not ignored" for a reason the panel cannot explain.
 */

import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'

import { WRITES, probe, verdictFor, type Asked, type Verdict, type Written } from '../shared/sharing.js'

const run = promisify(execFile)

/** Long enough for a cold `git` on a big repository, short enough that a hang is not forever. */
const TIMEOUT_MS = 10_000

/** One row of the answer, as the panel needs it. */
export interface SharingRow {
  readonly path: string
  readonly what: string
  readonly side: Written['side']
  readonly verdict: Verdict
  /** Why git could not answer, when it could not. `null` otherwise. */
  readonly detail: string | null
}

/** Whether this workspace is a git repository at all. Asked once, not once per path. */
async function isRepository(root: string): Promise<Asked | null> {
  try {
    await run('git', ['rev-parse', '--git-dir'], { cwd: root, timeout: TIMEOUT_MS })
    return null
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean }
    if (err.code === 'ENOENT') {
      /*
       * Two different `ENOENT`s, and only one of them is about git.
       *
       * `execFile` reports the same code whether the binary is missing or the `cwd` it was told
       * to run in is. Reported as "git is not installed", a workspace somebody deleted while the
       * app was open sends them to check their PATH — which is fine, and not the problem, and
       * three steps from the answer. Found by chasing a coverage gap into this branch.
       */
      const workspaceGone = await access(root).then(
        () => false,
        () => true,
      )
      return {
        kind: 'unknown',
        why: workspaceGone
          ? 'This workspace is not on disk any more, so nothing can be asked about it.'
          : 'git is not installed, or is not on the office’s PATH.',
      }
    }
    /*
     * Exit 128 is git's code for **both** "there is no repository here" and a whole family of
     * refusals to look: dubious ownership on a shared volume or in a container, a `.git` it
     * cannot read, a broken config. Only the first is an answer about the workspace; the rest
     * are failures to get one.
     *
     * The distinction is not cosmetic. `verdictFor` maps `no-repo` to `nowhere` — *"Not a git
     * repository, so nothing is being pushed at all."* Saying that about a real repository
     * whose ignore rules were never consulted is the worst thing this panel can do, and it is
     * why `unknown` is documented **"Never drawn as safe."**
     *
     * So the message is read rather than the rejection believed — the same reasoning `askAbout`
     * gives below about exit 1. Anything git does not actually call "not a git repository"
     * lands on `unknown`, which errs toward telling the person we could not look. A translated
     * git would land there too, which is the safe direction to be wrong in.
     */
    const stderr = err.stderr ?? ''
    if (/not a git repository/i.test(stderr)) return { kind: 'no-repo' }
    if (err.killed === true) {
      return { kind: 'unknown', why: `git did not answer within ${TIMEOUT_MS / 1000} seconds.` }
    }
    return { kind: 'unknown', why: firstLine(stderr || err.message || 'git could not be asked.') }
  }
}

/**
 * What the rules say about one path.
 *
 * Exit 1 is the *answer* "not ignored", which `execFile` delivers as a rejection — so the code has
 * to be read rather than the rejection believed.
 */
async function askAbout(root: string, path: string): Promise<Asked> {
  try {
    await run('git', ['check-ignore', '--no-index', '--quiet', '--', path], { cwd: root, timeout: TIMEOUT_MS })
    return { kind: 'ignored' }
  } catch (error) {
    /*
     * `code` is the **exit status**, and it is a number.
     *
     * Not typed as `NodeJS.ErrnoException`, deliberately. That interface declares `code?: string`
     * — right for an `fs` error, wrong for a spawned process — and intersecting with it narrows
     * this comparison to one TypeScript can prove is always false, while at runtime it is the
     * one that decides between *not ignored* and *something went wrong*. A cast that made the
     * error go away would have left a branch the compiler says cannot be taken and the feature
     * depends on.
     */
    const failed = error as { code?: unknown; stderr?: string; message?: string }
    if (failed.code === 1) return { kind: 'tracked' }
    if (failed.code === 'ENOENT') {
      return { kind: 'unknown', why: 'git is not installed, or is not on the office’s PATH.' }
    }
    return { kind: 'unknown', why: firstLine(failed.stderr ?? failed.message ?? '') }
  }
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0)
  return (line ?? 'git gave no reason').trim()
}

/**
 * Every place the office writes, and whether a push would carry it.
 *
 * A workspace that is not a repository short-circuits: asking `check-ignore` seven times to be
 * told the same thing seven times spends seven processes on one fact.
 */
export async function whatWouldBeShared(root: string): Promise<readonly SharingRow[]> {
  const wholeAnswer = await isRepository(root)
  if (wholeAnswer !== null) {
    return WRITES.map((written) => ({
      path: written.path,
      what: written.what,
      side: written.side,
      verdict: verdictFor(written, wholeAnswer),
      detail: wholeAnswer.kind === 'unknown' ? wholeAnswer.why : null,
    }))
  }

  return Promise.all(
    WRITES.map(async (written) => {
      const asked = await askAbout(root, probe(written))
      return {
        path: written.path,
        what: written.what,
        side: written.side,
        verdict: verdictFor(written, asked),
        detail: asked.kind === 'unknown' ? asked.why : null,
      }
    }),
  )
}
