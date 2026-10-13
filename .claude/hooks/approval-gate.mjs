#!/usr/bin/env node
/**
 * Office Space — the approval gate.
 *
 * Claude Code runs this before every tool call it is configured to gate. We write the request
 * where the app can see it, wait for a verdict, and answer.
 *
 * ## Why a hook and not a flag
 *
 * `--print` cannot stop and ask. There is no `--permission-prompt-tool`, and `--permission-mode
 * manual` is one of exactly two modes the CLI accepts and silently resolves to `default`,
 * because both need a human to answer a prompt and print mode has nobody to ask. Measured.
 *
 * A `PreToolUse` hook can. It refuses a call by returning a decision, and — the part that makes
 * this a feature rather than a denial with extra steps — **it can block while it decides.**
 * Measured on the installed CLI: 60 seconds on the default, 90 with `"timeout": 300` on the
 * hook, both honoured, `outcome: success` either way.
 *
 * ## The rule that cannot be configured away
 *
 * **An unanswered request is a denial.** Never an allowance. A clock that defaults to yes lets
 * time originate work, and the first standing order says only two principals may do that — the
 * user and the manager. A timeout is neither.
 *
 * This file must therefore never crash into an allow. Every failure path below writes a denial
 * and exits 0: an exception, an unreadable directory, a malformed verdict. If this hook cannot
 * function, the office stops acting — it does not start acting freely.
 *
 * There is a third outcome, and it is neither of those. When there is no office to ask — none
 * open when the call arrives, or none left by the time it would have been answered — this file
 * exits without printing a decision at all, handing the question back to Claude Code's own
 * permission flow. That is not an allowance; it is this file declining to stand as a gate with
 * nobody behind it. See `defer()`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** Where a request and its verdict meet. Beside the app's other state, not in the workspace. */
const DIR = '.office-space/approvals'
/**
 * The longest this hook will ever hold, whatever it is asked to.
 *
 * The ceiling is the load-bearing part. Everything in this file routes a failure to `deny()`,
 * and none of it runs if the CLI kills the process first — a hook that is killed writes no
 * decision at all, which is the one outcome the header rules out. So the wait has to stay under
 * the `timeout` registered for this hook in `.claude/settings.json`, and until now that was a
 * relationship between a number in this file and a number in that one, asserted in a comment
 * and held by nobody. `test/repo-health.test.ts` now fails if the registered timeout does not
 * clear this ceiling.
 *
 * It also caps the environment override, which could otherwise raise the wait past the point
 * where the CLI stops waiting — breaking the invariant from the outside without touching either
 * file.
 */
const MAX_WAIT_MS = 270_000

/**
 * How long to hold before giving up. Under the hook's own timeout, so we answer rather than die.
 *
 * The comment this replaces was right about `NaN` and wrong about the size of the hole. It read:
 * *"a NaN deadline makes `Date.now() < deadline` false on the first check, so the loop never runs
 * and every request is denied instantly"* — true, and `Number('240_000')` is how it happened.
 * `|| 240_000` catches that, because `NaN` is falsy.
 *
 * It does not catch a **negative**. `OFFICE_APPROVAL_WAIT_MS=-5` is a number, so `||` keeps it,
 * and `Math.min(-5, MAX_WAIT_MS)` is `-5` — a deadline already in the past, the loop skipped, and
 * every request denied the instant it arrives. The same failure as the NaN one, from an input
 * nobody thought to reject.
 *
 * Denying is the safe direction, and that is exactly why this is worth closing rather than
 * shrugging at: the gate would appear to work while never once holding a call open for a person
 * to answer, and the only symptom is that everything is refused very quickly.
 *
 * One predicate for all of it. `Number.isFinite` rejects `NaN` and the `Infinity` that
 * `Number('1e999')` produces; `> 0` rejects negatives and zero. Anything else is the default.
 */
const asked = Number(process.env['OFFICE_APPROVAL_WAIT_MS'])
const WAIT_MS = Math.min(Number.isFinite(asked) && asked > 0 ? asked : 240_000, MAX_WAIT_MS)
const POLL_MS = 150

/**
 * How long the marker has to keep looking stale before we believe it.
 *
 * The freshness window in `watching` answers *has the office beaten lately*, and its five seconds
 * are sized for a machine that missed a tick under load. It cannot answer the case where the
 * whole machine stopped. Close a laptop with an approval pending and both processes freeze; on
 * waking, the marker's mtime is minutes old through no fault of the office, and this hook — which
 * polls every 150ms and has nothing to wait on — reads it before the app's 400ms timer has fired
 * once. Deferring there would hand back the request the person came back to answer, which is the
 * opposite of what the gate is for.
 *
 * So a stale marker is watched rather than acted on, and three of the app's beats is ample room
 * for one to land. Against a wait measured in minutes it costs nothing.
 *
 * **Counted in polls, not in clock time**, and that is the whole point of it: a clock jump is the
 * thing being survived, so `Date.now()` would carry the entire sleep across the gap and defer on
 * the first look anyway. Each poll adds `POLL_MS` and each poll takes slightly longer than that,
 * so this under-counts real time — erring towards waiting, which is the safe direction here.
 */
const GONE_MS = 1_200

/**
 * Whether an Office Space is polling this directory right now.
 *
 * The app touches `.watching` on every poll — currently every 400ms — so freshness is the
 * signal rather than existence. A crashed app leaves the file behind and runs no cleanup, and a
 * marker that only had to *exist* would put the four-minute hang straight back.
 *
 * The window is deliberately several times the poll interval: a machine under load can miss a
 * tick, and treating that as "the office is gone" would drop the gate exactly when things are
 * busy enough to matter.
 *
 * Asked once before we write a request and then on every poll of the wait, so the same window is
 * also how long a request outlives the office that could have answered it.
 */
function watching(dir) {
  try {
    return Date.now() - statSync(join(dir, '.watching')).mtimeMs < 5_000
  } catch {
    // No marker at all. Nobody is watching, and that is a real answer rather than an error.
    return false
  }
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  )
  process.exit(0)
}

function allow() {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    }),
  )
  process.exit(0)
}

/**
 * Hand the question back to Claude Code's own permission flow, by saying nothing at all.
 *
 * The third outcome, and the one with no JSON. A hook that exits 0 without printing a decision
 * has not decided — the CLI falls through to the permission flow it would have used if this file
 * did not exist, which prompts a person in a terminal and refuses under `--print`. Both are the
 * right answer when there is nobody here to ask.
 *
 * **This is not an allow, and it must never become one.** `allow()` grants permission and skips
 * the prompt; this grants nothing. Naming it is the point: two sites in this file end the process
 * without deciding, and a reader who cannot tell that from `allow()` is one tidy-up away from
 * auto-approving every unlisted command in every terminal session.
 */
function defer() {
  process.exit(0)
}

async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk

  const event = JSON.parse(raw)
  // Both arrive on the payload, and together they are the routing key: several projects run at
  // once, so a card has to reach the right conversation and match the right call.
  const sessionId = String(event.session_id ?? '')
  const toolUseId = String(event.tool_use_id ?? '')
  if (!sessionId || !toolUseId) {
    // Nothing to route to. Denying is the safe direction and the reason is worth showing.
    deny('Office Space could not identify this request, so it was not approved.')
  }

  const root = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
  const dir = join(root, DIR)

  // Is anybody actually watching?
  //
  // This hook is registered in `.claude/settings.json`, which means it runs for **every** claude
  // session started in this workspace — including a plain terminal one with no Office Space
  // open. Measured the hard way: registering the gate made `claude` in this repo hang for four
  // minutes on the first unlisted command, waiting for a verdict nobody was going to give.
  //
  // So when no office is watching we **defer**, by exiting with no decision at all. Not `allow`
  // — that would grant permission and skip Claude Code's own prompt, silently auto-approving
  // every unlisted command in every terminal session, which is far worse than the hang it fixes.
  // Exiting silently hands the question back to the normal permission flow, which prompts a
  // person in a terminal and refuses under `--print`. Both are the right answer.
  //
  // Asked again on every poll of the wait below, because this answer expires: see there.
  if (!watching(dir)) defer()

  mkdirSync(dir, { recursive: true })

  const base = join(dir, `${sessionId}.${toolUseId}`)
  const ask = `${base}.request.json`
  const answer = `${base}.verdict.json`

  // The tool and its input verbatim, never a paraphrase. What the card shows has to be what the
  // CLI is about to run, or approving it means approving something else.
  writeFileSync(
    ask,
    JSON.stringify({
      sessionId,
      toolUseId,
      tool: String(event.tool_name ?? 'unknown'),
      input: event.tool_input ?? {},
      cwd: String(event.cwd ?? ''),
      // Who is actually blocked. Measured against the installed CLI: a subagent's tool call
      // carries `agent_type` — the employee's own name, exactly as it appears in
      // `.claude/agents/` — and `agent_id`, stable for that dispatch. The manager's own calls
      // carry neither.
      //
      // So `null` here is not "we could not tell". It is the manager, and it is the only thing
      // absence can mean, because every employee call carries the field. The floor needs this
      // to draw the right desk waiting: an approval that cannot say who is blocked leaves every
      // desk looking idle while one of them is stopped mid-command.
      agent: typeof event.agent_type === 'string' ? event.agent_type : null,
      agentId: typeof event.agent_id === 'string' ? event.agent_id : null,
      askedAt: new Date().toISOString(),
      /*
       * How long this hook will hold, written down so the office can say how long is left.
       *
       * The app cannot know this number any other way. It is `WAIT_MS` above — a default of four
       * minutes that `OFFICE_APPROVAL_WAIT_MS` may lower and `MAX_WAIT_MS` caps — and a second
       * copy of it in `src/` would be a constant that silently disagrees with this one the first
       * time anybody sets that variable. So the fact travels with the request that depends on it.
       *
       * Until now the card showed no clock at all: a person could read a held command carefully,
       * decide, and click into a request that had already been refused, with nothing on screen
       * having said a timer was running.
       */
      waitMs: WAIT_MS,
    }),
  )

  const deadline = Date.now() + WAIT_MS
  /** How long we have watched the office fail to say it is there. Reset the moment it does. */
  let goneFor = 0
  while (Date.now() < deadline) {
    if (existsSync(answer)) {
      let verdict
      try {
        verdict = JSON.parse(readFileSync(answer, 'utf8'))
      } catch {
        // A verdict we cannot read is not a yes.
        //
        // Filed all the same, and as `unreadable` rather than as a refusal. Somebody sat down and
        // answered this; what was lost is *which way*. A record that dropped it would be missing
        // exactly the decisions the office failed to carry, which is the one class it can least
        // afford to be quiet about.
        decided(ask, 'unreadable', null)
        cleanup(ask, answer)
        deny('Office Space could not read the decision, so this was not approved.')
      }
      // Before `cleanup`, which is about to delete the request this reads.
      decided(ask, verdict && verdict.allow === true ? 'allowed' : 'declined', verdict)
      cleanup(ask, answer)
      if (verdict && verdict.allow === true) allow()
      deny(
        typeof verdict?.reason === 'string' && verdict.reason
          ? verdict.reason
          : 'Declined in Office Space.',
      )
    }

    /*
     * Is the question still there?
     *
     * The app can take it away mid-wait. The privacy panel's Delete on `.office-space/approvals`
     * empties the store, and `forget()` removes everything not in a `shipped` list, which for
     * this store is everything — a request in flight included. Somebody clearing a count deletes
     * a live question.
     *
     * What happened before this check, driven rather than reasoned about:
     *
     *     control — nobody answers      deny at 6041ms    missed/ ["…t-1.request.json"]
     *     request deleted mid-wait      deny at 6187ms    missed/ []
     *     whole store deleted           deny at 6184ms    missed/ []
     *
     * The full window stalled, then *"Nobody answered in Office Space"* — about a question the
     * app itself destroyed — and `missed()` filed nothing, because it opens with
     * `if (!existsSync(ask)) return`. So the damage was invisible in the very record whose count
     * was being cleared.
     *
     * **Deferred, not denied**, reusing the argument the `goneFor` branch below already makes:
     * there is no question here any more, so there is nothing for this gate to answer, and it
     * goes back to Claude Code's own permission flow rather than being refused by a process whose
     * request has gone. Denying would be this file saying nobody answered when nobody was asked.
     *
     * The `goneFor` branch cannot cover this, and it is worth saying why rather than assuming it
     * might: the delete is a button inside the running app, so the office is beating its marker
     * at 400ms against this hook's 1200ms staleness threshold, by construction. The marker is
     * removed and rewritten well inside the window. **That branch is structurally unreachable on
     * exactly the path where it would have helped.**
     *
     * Two separate reasons this is safe, and only one of them is about the rest of the codebase.
     *
     * **It cannot fire spuriously**, because a missing request is never normal operation: nothing
     * but this hook ever removes a `*.request.json`. `approvals.ts` removes only the `.watching`
     * marker and its symlink guard, and `keepOnly` is in-memory.
     *
     * **And if it fired anyway, deferring is the safe direction.** That premise is about code
     * this file cannot enforce, and somebody who later falsifies it should not conclude the check
     * has to go: the worst a spurious fire can do is hand a question back to Claude Code's own
     * permission flow, so the call is asked about twice or refused. It can never allow one. The
     * premise makes the check precise; the deferral is what makes it safe.
     *
     * The verdict check above comes first, deliberately and for the same reason it precedes the
     * `goneFor` branch: an office that answered and then deleted the store has still answered,
     * and reversing these would throw away a decision a person actually made.
     */
    if (!existsSync(ask)) {
      // Nothing to file — `missed()` would no-op on the absent request, and this is not a refusal
      // to record. The verdict is cleaned up in case one arrived in the same instant.
      cleanup(answer)
      defer()
    }

    /*
     * Is anybody *still* watching?
     *
     * The check above the loop proves an office was polling at the instant we asked. It proves
     * nothing about the next four minutes, and until now nothing looked again — so an office that
     * quit or crashed one second in left this process holding a request for a rendezvous with
     * no other end, until the deadline turned it into a denial.
     *
     * Measured on this file before the check was added: with the marker's beat stopped 3 seconds
     * into a 20-second window, the hook held for the full 20 seconds and then denied. At the
     * shipped `WAIT_MS` that is four minutes of an agent stopped dead, waiting for an answer
     * that stopped being possible in the first few seconds.
     *
     * Both ways the office can leave are covered by the same freshness test. A clean quit removes
     * the marker — `watchApprovals().close()` does — and `statSync` then throws, which `watching`
     * reads as gone. A kill runs no cleanup at all and leaves the marker behind, and it goes
     * stale five seconds later.
     *
     * **Deferring, not denying, and that is the whole of the change.** This is not the office
     * saying no and it is not somebody failing to answer in time — both of those still deny,
     * below and above. It is the case the check above the loop already handles, arriving a few
     * seconds late: there is no office here, so there is no gate here, so the question goes back
     * to Claude Code's own permission flow rather than being answered by a process that has
     * nobody to ask. Same situation, same answer; the only thing that changes is that we now
     * notice it happening rather than only at the start.
     *
     * The verdict check comes first, deliberately. An office that wrote a verdict and then quit
     * has answered, and its answer outlives it — reversing these two lines would throw away a
     * decision a person actually made.
     *
     * And one stale reading is not enough to act on. See `GONE_MS`: a machine waking from sleep
     * presents a marker minutes old and an office that is perfectly alive.
     */
    goneFor = watching(dir) ? 0 : goneFor + POLL_MS
    if (goneFor >= GONE_MS) {
      // Take the request with us. Nothing will read it now, and an office that reopens later
      // would otherwise find a card for a tool call whose process is long gone.
      //
      // Deleted rather than filed under `missed/`, which is the distinction that filing exists
      // to make: the office reports those as *"N approvals were asked for and nobody answered
      // them in time, so those tool calls were refused"*. Neither half of that is true here.
      // Nobody was asked, because there was nobody to ask; and this call is not refused, it is
      // handed back. Counting it would put a number on the status bar that overstates what the
      // gate did.
      cleanup(ask)
      defer()
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, POLL_MS)
  }

  // Kept, not deleted, and this is the one thing that made a day of this invisible.
  //
  // Deleting the request here leaves nothing behind: a person who opens the office an hour later
  // sees no sign that a session asked ten times, waited forty minutes in total, and was refused
  // every time. The only way to catch it was to be looking inside a four-minute window.
  //
  // That is the fourth standing order pointed at the office's own telemetry — an absence nobody
  // recorded reads exactly like nothing having happened. The refusal is unchanged and still a
  // refusal; what changes is that it leaves a mark somebody can find afterwards.
  missed(ask)
  cleanup(ask, answer)
  deny('Nobody answered in Office Space, so this was not approved.')
}

/**
 * Move a request nobody answered into `missed/`, so it can be counted later.
 *
 * Best-effort by construction. This runs on the way to a denial that has already been decided,
 * so nothing here may change that outcome or throw — a hook that failed while filing a record
 * would turn a clean refusal into an exception, and an exception in a PreToolUse hook is not a
 * refusal at all.
 */
function missed(ask) {
  try {
    if (!existsSync(ask)) return
    const dir = join(dirname(ask), 'missed')
    mkdirSync(dir, { recursive: true })
    renameSync(ask, join(dir, `${Date.now()}.${basename(ask)}`))
  } catch {
    // Filing is not correctness. The refusal stands either way.
  }
}

/**
 * File a decision somebody actually made, so it outlives the call that used it.
 *
 * ## The asymmetry this exists to end
 *
 * `missed()` above preserves every request **nobody** answered, and nothing anywhere removes one.
 * `cleanup()` below deletes every request somebody **did** answer, along with its verdict, the
 * instant the verdict has been read. So the office kept a permanent record of its own absences
 * and no record at all of a person's decisions, and *"what did I approve last night"* had no
 * answer while *"how much did the office lose to nobody being there"* had one that could only
 * grow.
 *
 * ## Why the facts are in the name
 *
 * This directory is unbounded, like `missed/`. A count that had to open every file to bucket it
 * would get slower every night the office ran unattended — which is the night this record exists
 * for. `approvalRecord` already reads both directories with a single `readdir` each and this
 * keeps that cost, so the outcome and the time travel in the filename:
 *
 *     <epochMs>.<outcome>.<sessionId>.<toolUseId>.decision.json
 *
 * `missed()` gained the same prefix in this change. A dated record beside an undated one would
 * leave the office reporting a window for half its evidence and a lifetime total for the other
 * half, on the same line. Names written by earlier versions carry no time, and
 * `shared/decisions.ts` counts those as neither inside a window nor outside it.
 *
 * ## Best-effort, exactly as `missed()` is
 *
 * This runs on the way to a decision that has already been made, so nothing here may change that
 * outcome or throw. The record is therefore lossy **by design**, and anything reporting from it
 * has to be able to say so rather than presenting a count as complete.
 */
function decided(ask, outcome, verdict) {
  try {
    if (!existsSync(ask)) return
    const dir = join(dirname(ask), 'decided')
    mkdirSync(dir, { recursive: true })

    // The request verbatim, plus what came of it. Read before `cleanup` deletes it.
    const request = JSON.parse(readFileSync(ask, 'utf8'))
    const reason = typeof verdict?.reason === 'string' && verdict.reason ? verdict.reason : null
    const record = JSON.stringify({ ...request, outcome, decidedAt: new Date().toISOString(), reason })

    // Temp then rename, so a reader never meets a half-written record. `approvals.ts` writes the
    // verdict the same way and says why: the file is absent or whole, never in between.
    const path = join(dir, `${Date.now()}.${outcome}.${basename(ask).replace(/\.request\.json$/, '')}.decision.json`)
    writeFileSync(`${path}.tmp`, record)
    renameSync(`${path}.tmp`, path)
  } catch {
    // Filing is not correctness. The decision stands either way, and a person still gets what
    // they clicked for.
  }
}

function cleanup(...paths) {
  for (const p of paths) {
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {
      // A file we cannot delete is tidiness, not correctness. The verdict has been read.
    }
  }
}

// The single most important line in this file. Any failure at all — a broken payload, a
// directory we cannot create, a bug in the above — becomes a denial rather than an exception,
// because an exception in a PreToolUse hook is not a refusal and the call may proceed.
main().catch((err) => deny(`Office Space could not handle this request: ${String(err)}`))
