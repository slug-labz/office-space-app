/**
 * The gate, driven.
 *
 * `approvals.test.ts` drives the app's half against files written the way the hook writes them.
 * Nothing drove the hook. It had been read, reasoned about and argued over — `docs/the-queue.md`
 * carries a whole decision about it — and the only checks on it were `repo-health.test.ts`
 * matching patterns in its source, which is a check that a sentence is still present rather than
 * that a process still behaves.
 *
 * So every test here spawns the real `.mjs` as a real child process and feeds it a real
 * `PreToolUse` event on stdin, exactly as the CLI does. What is asserted is what the CLI reads:
 * the process's own stdout.
 *
 * ## The three outcomes, and the one that must never appear
 *
 * `allow` grants permission and skips Claude Code's prompt. `deny` refuses. **Printing nothing
 * at all** is neither — it defers, handing the question back to the permission flow that would
 * have run if this hook did not exist, which prompts a person in a terminal and refuses under
 * `--print`.
 *
 * The header of the hook states the rule these tests exist to hold: *an unanswered request is a
 * denial, never an allowance*. So an `allow` here is only ever correct when a verdict on disk
 * says `allow`, and every assertion on a deferral checks the output is **empty** rather than
 * merely "not an allow" — a deferral that started printing anything would be a decision nobody
 * made.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { tempDir } from './temp-dir.js'

/**
 * The hook, found from this file rather than from the working directory.
 *
 * `#167` is the reason: two scanners in this repo located their targets by a path that held in a
 * clone called `office-space` and in nothing else, so in a worktree they scanned zero files and
 * reported a clean tree. Anchoring to `import.meta.url` is the fix that PR landed, and this file
 * spawns a path — the failure would be `MODULE_NOT_FOUND` on every test rather than a silent
 * pass, but the habit is cheap and the alternative is a test that only runs at one address.
 */
const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'hooks', 'approval-gate.mjs')

const DIR = join('.office-space', 'approvals')
const SESSION = '11111111-2222-3333-4444-555555555555'
const TOOL_USE = 't-1'

/**
 * How long a wait to give the hook.
 *
 * Short, because two of these tests prove the hook stops waiting early and the way they fail is
 * by waiting the whole window. Six seconds is long enough that "it deferred promptly" and "the
 * window ran out" are not the same measurement, and short enough that a regression costs seconds
 * rather than the shipped four minutes.
 */
const WINDOW_MS = 6_000
/** What "promptly" means. Half the window, which is not a latency claim — it is *not the window*. */
const PROMPT_MS = WINDOW_MS / 2

interface Ended {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly ms: number
}

/** A workspace with an approvals directory and nobody watching it. */
async function workspace(t: TestContext): Promise<string> {
  const root = await tempDir(t, 'office-gate-')
  await mkdir(join(root, DIR), { recursive: true })
  return root
}

/**
 * Open an office: write the marker the way `beat()` in `approvals.ts` does.
 *
 * Written once rather than on a timer. The hook treats a marker as fresh for five seconds and
 * every test here finishes well inside that, so a timer would add a source of flake and prove
 * nothing the single write does not.
 */
const open = (root: string) => writeFile(join(root, DIR, '.watching'), '', 'utf8')

/** Quit: `watchApprovals().close()` removes the marker rather than letting it go stale. */
const quit = (root: string) => rm(join(root, DIR, '.watching'), { force: true })

/** Die: the marker is left behind, as after a kill, and ages past the five-second window. */
const abandon = async (root: string): Promise<void> => {
  const then = new Date(Date.now() - 60_000)
  await utimes(join(root, DIR, '.watching'), then, then)
}

const base = (root: string) => join(root, DIR, `${SESSION}.${TOOL_USE}`)

/**
 * Answer, atomically.
 *
 * `decide()` writes to a temp name and renames for a reason worth repeating here: the hook polls
 * for the file and denies on anything it cannot parse, so a poll landing inside a partial write
 * turns an approval into *"could not read the decision"*. A test that wrote in place would fail
 * on a correct hook, occasionally.
 */
async function answer(root: string, body: string): Promise<void> {
  const path = `${base(root)}.verdict.json`
  await writeFile(`${path}.tmp`, body, 'utf8')
  await rename(`${path}.tmp`, path)
}

const there = (path: string) => stat(path).then(() => true, () => false)

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll until something is true, and say what was being waited for if it never is. */
async function until(what: string, ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await ready()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  assert.fail(`the hook never ${what} — nothing after 5s`)
}

/** Spawn the hook against this workspace and feed it one tool call. */
function ask(root: string, waitMs = WINDOW_MS): Promise<Ended> {
  const started = Date.now()
  const child = spawn(process.execPath, [HOOK], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, OFFICE_APPROVAL_WAIT_MS: String(waitMs) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => (stdout += chunk))
  child.stderr.on('data', (chunk: string) => (stderr += chunk))
  child.stdin.end(
    JSON.stringify({
      session_id: SESSION,
      tool_use_id: TOOL_USE,
      tool_name: 'Bash',
      tool_input: { command: 'curl https://example.com/health' },
    }),
  )
  return new Promise<Ended>((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }))
  })
}

/**
 * What the CLI reads out of that stdout.
 *
 * Empty output is a deferral rather than a malformed decision, so it comes back as no decision
 * instead of an exception. `JSON.parse('')` throws *"Unexpected end of JSON input"*, and a gate
 * test that fails with that has hidden the only interesting fact — that the hook decided
 * nothing — behind a parser complaint. Caught while mutating: making the mid-wait check fire
 * unconditionally is exactly the regression that empties this stream.
 */
function decision(out: string): { permissionDecision?: string; permissionDecisionReason?: string } {
  if (out === '') return {}
  const parsed = JSON.parse(out) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }
  return parsed.hookSpecificOutput ?? {}
}

test('a watching office is waited for, and its answer is honoured', async (t) => {
  // The path everything else is a departure from: an office is open, the hook blocks, somebody
  // clicks, and the click is the decision. It is here because the mid-wait check added for
  // queue item #1 runs on every poll of this same loop — an over-eager one would abandon a
  // request while the person deciding it is still reaching for the button.
  const root = await workspace(t)
  await open(root)

  const ended = ask(root)
  await until('wrote its request', () => there(`${base(root)}.request.json`))
  await answer(root, JSON.stringify({ allow: true }))

  const out = await ended
  assert.equal(decision(out.stdout).permissionDecision, 'allow', out.stdout || '(nothing was printed at all)')
  assert.equal(await there(`${base(root)}.request.json`), false, 'the request outlived the verdict, so the office would show a card for a call that already ran')
})

/** What the gate filed under `decided/`, or `[]` when it filed nothing. */
const filed = (root: string) => readdir(join(root, DIR, 'decided')).catch(() => [] as string[])

test('the rendezvous is cleaned up, and the decision it carried is kept', async (t) => {
  /*
   * Two facts that sound contradictory and are not, which is why they are asserted together.
   *
   * The **rendezvous** does not survive: `cleanup()` unlinks the request and the verdict the
   * instant the verdict has been read, and it must, or the office draws a card for a call that
   * already ran. That was the whole content of this store until now, and the privacy panel
   * advertised *"and the decisions"* over the one file that is always gone.
   *
   * The **decision** now does survive, as a record filed under `decided/`. This files a copy; it
   * does not resurrect the rendezvous, and confusing the two would put a live-looking approval
   * card back on screen for work that finished hours ago.
   *
   * The outcome and the time are in the **name** rather than only inside the file, because this
   * directory is unbounded like `missed/`, and a count that had to open every record to bucket it
   * would get slower every night the office ran unattended — which is the night it exists for.
   */
  const root = await workspace(t)
  await open(root)

  const ended = ask(root)
  await until('wrote its request', () => there(`${base(root)}.request.json`))
  await answer(root, JSON.stringify({ allow: true }))
  await ended

  const names = await filed(root)
  assert.equal(names.length, 1, 'an approval was answered and left no record')
  assert.match(
    names[0] ?? '',
    /^\d+\.allowed\..*\.decision\.json$/,
    'the record does not carry the time and outcome in its name, so counting a window must open every file',
  )

  assert.equal(await there(`${base(root)}.request.json`), false, 'the request outlived the verdict, so the office would show a card for a call that already ran')
  assert.equal(await there(`${base(root)}.verdict.json`), false, 'the rendezvous verdict survived the call it answered')
  assert.deepEqual(
    await readdir(join(root, DIR, 'missed')).catch(() => []),
    [],
    'a call somebody answered was filed as one nobody answered',
  )
})

test('a refusal a person actually made is not filed as one nobody answered', async (t) => {
  // The two are opposite facts about the night and would otherwise be one number. A person who
  // declined nineteen commands did not fail to answer them.
  const root = await workspace(t)
  await open(root)

  const ended = ask(root)
  await until('wrote its request', () => there(`${base(root)}.request.json`))
  await answer(root, JSON.stringify({ allow: false, reason: 'Not to that host.' }))
  await ended

  assert.match((await filed(root))[0] ?? '', /\.declined\./)
  assert.deepEqual(await readdir(join(root, DIR, 'missed')).catch(() => []), [], 'a declined call was filed as missed')
})

test('a decision the office could not read is filed as exactly that', async (t) => {
  /*
   * The class it can least afford to be quiet about. Somebody sat down and answered; what was
   * lost is *which way*. Filing nothing would drop precisely the decisions the office failed to
   * carry, and filing it as a refusal would blame the person for the office's own failure.
   */
  const root = await workspace(t)
  await open(root)

  const ended = ask(root)
  await until('wrote its request', () => there(`${base(root)}.request.json`))
  await answer(root, 'this is not json')
  const out = await ended

  assert.equal(decision(out.stdout).permissionDecision, 'deny', 'an unreadable verdict was not a denial')
  assert.match((await filed(root))[0] ?? '', /\.unreadable\./)
})

test('an unanswered request is filed with a time, like a decision is', async (t) => {
  /*
   * `missed/` names carried no time, so its count was a lifetime total reported in the present
   * tense — one bad night puts twelve on the status bar and no day of perfect attendance takes
   * any of it back. A dated record beside an undated one would leave the office reporting a
   * window for half its evidence and a lifetime for the other half, on the same line.
   */
  const root = await workspace(t)
  await open(root)

  const out = await ask(root, 400)
  assert.equal(decision(out.stdout).permissionDecision, 'deny')

  const names = await readdir(join(root, DIR, 'missed'))
  assert.equal(names.length, 1)
  assert.match(names[0] ?? '', /^\d+\..*\.request\.json$/, 'a missed request was filed without a time')
  assert.deepEqual(await filed(root), [], 'a call nobody answered was filed as a decision somebody made')
})
test("a refusal carries the office's own words back to the model", async (t) => {
  // `decide()`'s comment: a denial the agent can read is a denial it can work around, and one it
  // cannot read is a wall it will hit again. The reason is part of the decision, not decoration.
  const root = await workspace(t)
  await open(root)

  const ended = ask(root)
  await until('wrote its request', () => there(`${base(root)}.request.json`))
  await answer(root, JSON.stringify({ allow: false, reason: 'Not to that host.' }))

  const out = await ended
  assert.equal(decision(out.stdout).permissionDecision, 'deny')
  assert.equal(decision(out.stdout).permissionDecisionReason, 'Not to that host.')
})

test('an office that quits mid-wait is deferred to, not waited out', async (t) => {
  // Queue item #1, the half that is fixed here. `watching()` used to be asked once, before the
  // loop, and the loop then ran to its deadline no matter what happened to the office — so
  // quitting the app one second in left the hook holding a rendezvous with no other end for the
  // remaining four minutes, and denying at the end of it.
  //
  // Measured before the check existed: with the office stopped 3 seconds into a 20-second
  // window, the hook held the whole 20 and then denied.
  //
  // The answer is a deferral rather than a denial, and the distinction is the point. Nobody
  // refused this call; there is nobody here to ask, which is the same state the check above the
  // wait loop already handles — so it gets the same answer, and Claude Code's own permission
  // flow decides.
  const root = await workspace(t)
  await open(root)

  const ended = ask(root)
  await until('wrote its request', () => there(`${base(root)}.request.json`))
  await quit(root)

  const out = await ended
  assert.equal(out.stdout, '', 'a deferral prints nothing at all — anything here is a decision nobody made')
  assert.equal(out.code, 0, 'a non-zero exit is not a deferral: the CLI reads it as the hook failing')
  assert.ok(out.ms < PROMPT_MS, `held ${out.ms}ms of a ${WINDOW_MS}ms window after the office had gone`)
})

test('an office that stops refreshing its marker is gone, not busy', async (t) => {
  // The other way an office leaves, and the reason the marker's freshness is the signal rather
  // than its existence: a kill runs no cleanup, so the file stays exactly where it was. Five
  // seconds of silence is the office being gone; anything shorter would drop the gate on a
  // machine that missed a tick under load.
  //
  // Aged with `utimes` rather than by waiting, which tests the same arithmetic in `watching()`
  // and does not spend five seconds of the suite doing it.
  const root = await workspace(t)
  await open(root)

  const ended = ask(root)
  await until('wrote its request', () => there(`${base(root)}.request.json`))
  await abandon(root)

  const out = await ended
  assert.equal(out.stdout, '', 'a deferral prints nothing at all — anything here is a decision nobody made')
  assert.ok(out.ms < PROMPT_MS, `held ${out.ms}ms of a ${WINDOW_MS}ms window after the office had gone`)
})

test('an office that goes quiet and comes back keeps the request it was deciding', async (t) => {
  // The way the fix above could hurt somebody, and the reason it waits before acting.
  //
  // A stale marker is not always a dead office. Close a laptop with an approval on screen and
  // both processes freeze; on waking, the marker is minutes old through no fault of the app, and
  // the hook — polling every 150ms with nothing to wait on — looks before the app's 400ms timer
  // has fired once. Deferring on that first look would cancel the request the person came back to
  // answer, and under `--print` the office's own sessions read a deferral as a refusal. The gate's
  // headline feature would have become "close the lid and lose your approval".
  //
  // So the hook watches a stale marker for `GONE_MS` before believing it, and this is that
  // window driven from outside: gone for a moment, back well inside it, and the answer still
  // lands. The staleness is manufactured with `utimes` and the recovery is a real write, which is
  // exactly the pair a wake produces.
  const root = await workspace(t)
  await open(root)

  const ended = ask(root)
  await until('wrote its request', () => there(`${base(root)}.request.json`))
  await abandon(root)
  await pause(300)
  await open(root)
  await answer(root, JSON.stringify({ allow: true }))

  const out = await ended
  assert.equal(
    decision(out.stdout).permissionDecision,
    'allow',
    out.stdout || '(nothing was printed at all — the hook gave up on an office that was only briefly quiet)',
  )
})

test('a request nobody can answer is taken away, and never counted as missed', async (t) => {
  // Two claims, and they are the same claim.
  //
  // The request goes, because an office reopened an hour later would otherwise find a card for a
  // tool call whose process ended long ago, and clicking it would write a verdict into an empty
  // room.
  //
  // And it does **not** go to `missed/`, which exists so an unanswered request leaves a mark: the
  // office counts what is filed there and reports it as *"N approvals were asked for and nobody
  // answered them in time, so those tool calls were refused"*. Neither half fits a deferral —
  // nobody was asked, and the call was not refused, it was handed back. Filing it would put a
  // number in front of a person that overstates what the gate did.
  const root = await workspace(t)
  await open(root)

  const ended = ask(root)
  await until('wrote its request', () => there(`${base(root)}.request.json`))
  await quit(root)
  await ended

  assert.equal(await there(`${base(root)}.request.json`), false, 'the request was left for an office that will find it stale')
  assert.deepEqual(
    await readdir(join(root, DIR, 'missed')).catch(() => []),
    [],
    'a deferral was filed as an approval nobody answered, which is a different and worse thing',
  )
})

test('an office that was there the whole time and answered nothing still denies, and leaves a mark', async (t) => {
  // The behaviour the fix must not touch. This is the timeout the header is about — *an
  // unanswered request is a denial, never an allowance* — and it is a genuinely different case
  // from the two above: somebody could have answered and did not.
  //
  // The office stays open for the whole window here, so the mid-wait check never fires; a
  // check that fired anyway would turn every slow decision into a deferral and quietly retire
  // the gate's only refusal.
  const root = await workspace(t)
  await open(root)

  const out = await ask(root, 1_500)

  assert.equal(decision(out.stdout).permissionDecision, 'deny', out.stdout || '(nothing was printed at all)')
  assert.match(decision(out.stdout).permissionDecisionReason ?? '', /Nobody answered/)
  /*
   * The name gained a `<epochMs>.` prefix when `missed/` started carrying a time, so this asserts
   * the shape rather than the exact string — the claim here is that the request is *still there*,
   * which is what "leaves a mark" meant and what a day of being blocked with nothing to find
   * afterwards was the cost of. The session and tool ids are still pinned, so a mark filed for
   * the wrong call still fails.
   */
  const marks = await readdir(join(root, DIR, 'missed'))
  assert.equal(
    marks.length,
    1,
    'an expired request that leaves nothing behind is a day of being blocked with nothing to find afterwards',
  )
  assert.match(marks[0] ?? '', new RegExp(`^\\d+\\.${SESSION}\\.${TOOL_USE}\\.request\\.json$`))
})

test('a question the app destroyed is handed back, not answered on its behalf', async (t) => {
  /*
   * The privacy panel's Delete on `.office-space/approvals` empties the store, and `forget()`
   * removes everything not `shipped` — which for this store is everything, a request in flight
   * included. So clearing a count deletes a live question.
   *
   * Driven before the fix, and every prediction held:
   *
   *     control — nobody answers      deny at 6041ms    missed/ ["…t-1.request.json"]
   *     request deleted mid-wait      deny at 6187ms    missed/ []
   *
   * The full window stalled, then *"Nobody answered in Office Space"* about a question nobody was
   * ever given the chance to answer — and `missed()` filed nothing, since it opens with
   * `if (!existsSync(ask)) return`. The damage was invisible in the record whose count was being
   * cleared, and the count is highest exactly when the office runs unattended, which is when a
   * call is most likely to be in flight.
   *
   * A deferral rather than a denial, for the reason the mid-wait check already gives: there is no
   * question here any more, so there is nothing for this gate to answer.
   */
  const root = await workspace(t)
  await open(root)

  const ended = ask(root)
  await until('wrote its request', () => there(`${base(root)}.request.json`))
  await rm(join(root, DIR, `${SESSION}.${TOOL_USE}.request.json`))

  const out = await ended

  // Empty output is the deferral. Asserted as *empty* rather than "not an allow", because a
  // deferral that started printing anything would be a decision nobody made.
  assert.equal(out.stdout, '', `the hook answered for a question that was gone: ${out.stdout}`)
  assert.ok(
    out.ms < PROMPT_MS,
    `the hook stalled ${out.ms}ms on a request that no longer existed — it used to wait the whole window`,
  )
  assert.deepEqual(
    await readdir(join(root, DIR, 'missed')).catch(() => []),
    [],
    'a question the app destroyed was filed as one nobody answered',
  )
})

test('a verdict that will not parse is a denial', async (t) => {
  // The path most likely to break the header's rule, which is why the sweep drove it by hand:
  // the hook reads a file another process writes, and the safe reading of "I cannot tell what
  // this says" is no.
  const root = await workspace(t)
  await open(root)

  const ended = ask(root)
  await until('wrote its request', () => there(`${base(root)}.request.json`))
  await answer(root, '{"allow": tr')

  const out = await ended
  assert.equal(decision(out.stdout).permissionDecision, 'deny', out.stdout || '(nothing was printed at all)')
  assert.match(decision(out.stdout).permissionDecisionReason ?? '', /could not read the decision/)
})

test('with no office open at all, the hook decides nothing and writes nothing', async (t) => {
  // The gate is registered in `.claude/settings.json`, so it runs in every `claude` session
  // started in this workspace — including a plain terminal one. Registering it made `claude`
  // here hang for four minutes on the first unlisted command, which is what the pre-wait check
  // exists to prevent.
  //
  // The request file matters as much as the output: writing one would leave a card waiting in
  // an office nobody has opened.
  const root = await workspace(t)

  const out = await ask(root)

  assert.equal(out.stdout, '', 'a deferral prints nothing at all — anything here is a decision nobody made')
  assert.equal(out.code, 0)
  assert.ok(out.ms < PROMPT_MS, `waited ${out.ms}ms for an office that was never open`)
  assert.equal(await there(`${base(root)}.request.json`), false, 'a request was written for an office that does not exist')
})
