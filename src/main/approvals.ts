/**
 * The app's half of the approval gate.
 *
 * `.claude/hooks/approval-gate.mjs` writes a request and blocks. This watches for requests,
 * hands them to the renderer, and writes back the verdict the person gave.
 *
 * ## Why a directory and not a socket
 *
 * The hook is a **separate process**: spawned by the CLI, which was spawned by Electron. It has
 * no handle on anything in this process. So the two need a rendezvous with a name, and a
 * directory under `.office-space/` is the one both can find with no configuration — the hook
 * gets `CLAUDE_PROJECT_DIR`, we know the workspace root, and they are the same place.
 *
 * There is a pleasing symmetry in that: `.office-space/` used to hold `floor.ndjson`, an event
 * log nobody read, and it comes back as the channel that carries a decision.
 *
 * ## The rule
 *
 * **An unanswered request is a denial**, and this module cannot change that — the hook denies on
 * its own timeout without asking anybody. What this module can do is fail to answer, and that
 * fails in the safe direction by construction.
 */

import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { safeRelativePath } from './safe-path.js'
import { judge, type Policy, type PolicyRead } from './permissions.js'
import { projectOfSession, type SessionRecord } from './registry.js'
import type { Problem } from './workspace.js'
import type { PendingApproval } from '../shared/ipc.js'
import { oldestFirst } from '../shared/time-order.js'
import type { PermissionMode } from '../shared/controls.js'
import { PERMISSION_CHOICES } from '../shared/control-copy.js'
import { truncate } from '../shared/truncate.js'

const DIR = join('.office-space', 'approvals')
/**
 * Proof that an Office Space is actually watching this directory.
 *
 * Without it the gate is live in every `claude` session run in this workspace, including a plain
 * terminal one — measured the hard way: registering the hook made `claude` in this repo hang for
 * four minutes on the first unlisted command, waiting for a verdict from an app nobody had
 * opened. A gate that blocks the tool it is meant to govern is worse than no gate.
 *
 * Touched on every poll rather than written once, so a crashed app stops claiming to be
 * watching. There is no cleanup path that survives a kill -9, and a stale marker would put the
 * hang back.
 */
export const WATCHING = join(DIR, '.watching')
/** Just the filename, for telling our own heartbeat apart from a real request arriving. */
export const MARKER_NAME = '.watching'
const REQUEST = '.request.json'

/** A tool call waiting for somebody to say yes. */
export interface ApprovalRequest {
  readonly sessionId: string
  readonly toolUseId: string
  readonly tool: string
  /** Verbatim from the CLI. What the card shows must be what is about to run. */
  readonly input: Record<string, unknown>
  readonly cwd: string
  /** As the gate wrote it, or `''` when the file's was missing or not text. See `pending`. */
  readonly askedAt: string
  /**
   * How long the hook will hold this before refusing it, in milliseconds — or `null`.
   *
   * Written by the gate, because the gate is the only thing that knows: its wait has a default
   * of four minutes that `OFFICE_APPROVAL_WAIT_MS` may lower, and a copy of that number in this
   * repository would disagree with the running hook the first time anybody set the variable.
   *
   * `null` is a request from a gate that did not record it, and it means the office does not
   * know when this expires. It must not be filled in with the default — a countdown drawn from
   * a guessed deadline is worse than no countdown, because it is believed.
   */
  readonly waitMs: number | null
  /**
   * The employee whose command this is, or `null` for the manager's own.
   *
   * Not "unknown" — the CLI puts `agent_type` on every subagent tool call and on none of the
   * manager's, so absence here is a positive answer rather than a gap. Measured against the
   * installed CLI, not read off the docs.
   */
  readonly agent?: string | null
  /** Stable for one dispatch, so two commands from the same employee stay distinguishable. */
  readonly agentId?: string | null
}

/**
 * The names in one of the gate's two record directories, or `null` when it would not open.
 *
 * ## The errno line, and why it is drawn here
 *
 * This argument was written for a count of `missed/` that fed a status bar, and it is moved here
 * rather than restated now that the count has no caller left: the discipline outlived the
 * function, and this read is what carries it.
 *
 * The gate refuses an unanswered request after four minutes, which is correct — *"an unanswered
 * request is a denial, never an allowance"*. What it used to do as well was delete the request,
 * so a person opening the office an hour later saw nothing: no sign that a session had asked ten
 * times, waited forty minutes in total, and been refused every time. The only way to catch it
 * was to be looking inside a four-minute window, and that is how a peer session spent a whole
 * day blocked without anybody noticing.
 *
 * An absence nobody recorded reads exactly like nothing having happened, which is the fourth
 * standing order aimed at the office's own telemetry.
 *
 * ## Names rather than a number
 *
 * The time and the outcome are *in* the names, so the counting belongs in `shared/decisions.ts`
 * and the reading belongs here. That split is also what keeps the per-file cost to one `readdir`
 * for directories nothing prunes — and it is why the `.request.json` filter that used to sit in
 * this read now sits in `tally`, which is the thing that has to know what a record looks like.
 */
async function filedIn(root: string, which: 'decided' | 'missed'): Promise<readonly string[] | null> {
  try {
    return await readdir(join(root, DIR, which))
  } catch (err) {
    // **ENOENT only.** The gate creates each directory the first time it files something, so a
    // missing one really is nothing filed rather than a failure to look.
    //
    // Every other errno is exactly a failure to look, and the first version of this read returned
    // a zero for all of them under a comment claiming otherwise. A directory that exists and will
    // not open would have read as *nothing was missed* — the fourth standing order in the place it
    // costs a person the record of what their office did without them, and a tool call that never
    // ran.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    return null
  }
}

/** Both halves of the gate's record, each `null` when that half would not open. */
export interface ApprovalRecord {
  readonly decisions: readonly string[] | null
  readonly missed: readonly string[] | null
}

/**
 * Everything the gate has filed, as names.
 *
 * The two directories are read separately and fail separately, because they can: one may be
 * unreadable while the other is fine, and collapsing that into a single failure would throw away
 * half an answer the office actually has. `shared/decisions.ts` turns these into a sentence.
 */
export async function approvalRecord(root: string): Promise<ApprovalRecord> {
  const [decisions, missed] = await Promise.all([filedIn(root, 'decided'), filedIn(root, 'missed')])
  return { decisions, missed }
}

/**
 * Read the requests currently waiting, or `null` when the office could not look.
 *
 * The `null` is the whole of this signature. It used to be a bare `catch` returning `[]`, under a
 * comment that said *"Genuinely empty, not unreadable-and-hidden"* — which is what the code did
 * not do: `EACCES` and `ENOENT` came back identically. `filedIn`, just above, gets this exactly
 * right and argues it at length; this is the same read with more at stake, because `pending` is
 * the sole source of approval cards.
 *
 * An approvals directory that exists and will not open then produced no card, an office that
 * looked idle, and an agent blocked for four minutes before being refused — while the screen said
 * nothing was waiting. That is the fourth standing order in the one place its cost is a tool call
 * that never ran, and it is the failure `filedIn`'s docblock describes somebody losing a day to.
 */
export async function pending(root: string): Promise<readonly ApprovalRequest[] | null> {
  const dir = join(root, DIR)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (err) {
    // **ENOENT only**, like `filedIn`. No directory means nothing has ever asked — the hook
    // creates it on the first request, so that really is empty rather than a failure to look.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    return null
  }

  const out: ApprovalRequest[] = []
  for (const name of names) {
    if (!name.endsWith(REQUEST)) continue
    try {
      const raw = JSON.parse(await readFile(join(dir, name), 'utf8')) as Record<string, unknown>
      const parsed = raw as unknown as ApprovalRequest
      if (parsed.sessionId && parsed.toolUseId && parsed.tool) {
        // Read rather than trusted: a `waitMs` that is absent, a string, or nonsense means the
        // office does not know the deadline, and saying so is the only honest answer.
        const held = raw['waitMs']
        // And `askedAt`, for the sort below. A time that is absent or not text is `''`.
        const asked = raw['askedAt']
        out.push({
          ...parsed,
          askedAt: typeof asked === 'string' ? asked : '',
          waitMs: typeof held === 'number' && Number.isFinite(held) && held > 0 ? held : null,
        })
      }
    } catch {
      // A half-written file — we are watching a directory another process writes into, so
      // catching one mid-write is expected rather than exceptional. It will be complete on the
      // next tick, and the hook is still blocking.
    }
  }
  /*
   * Oldest first, by instant, with a call whose time will not parse after every call whose time
   * will. See `time-order.ts`.
   *
   * A request whose `askedAt` is missing or not text is kept, not skipped. It parsed, so unlike a
   * half-written file it will read the same on the next tick, and the hook is still holding the
   * call: skipping it would hide that call until the gate refused it. Its time is carried as `''`,
   * which is how `parseRegistry` and `parseDecision` read a time nobody wrote, and which `timeLeft`
   * reads as not knowing, so the card draws no countdown from it. A number passed through breaks the
   * rule that `askedAt` is text. The clock as it was at e6fe5cb reads such a value with `Date.parse`,
   * which reads `5` as a day in 2001 (measured on Node 22), and would call a held call refused
   * (inferred).
   *
   * This sort was `a.askedAt.localeCompare(b.askedAt)`, and nothing above checked `askedAt`, so such
   * a request threw here, outside the `try`, and the whole read rejected. Measured on dev at e6fe5cb:
   * with two such files held, `pending` rejected with a TypeError and the watcher pushed nothing,
   * not even a call written after it started.
   */
  return out.sort((a, b) => oldestFirst(a.askedAt, b.askedAt))
}

/**
 * Answer one.
 *
 * `reason` is shown to the *model*, not only to the user: a denial the agent can read is a
 * denial it can work around, and one it cannot read is a wall it will hit again.
 */
export async function decide(
  root: string,
  sessionId: string,
  toolUseId: string,
  allow: boolean,
  reason?: string,
): Promise<void> {
  const dir = join(root, DIR)

  /*
   * The ids become a filename, and they arrive off the bridge.
   *
   * `main.ts` hands this `String(sessionId ?? '')` straight from the renderer, and a `../` in
   * either one walks the write out of the directory — verified: `decide(root,
   * '../../../escaped', 'x', true)` put `escaped.x.verdict.json` in the workspace's *parent*.
   * That is an arbitrary-path write on the code path that records a security decision.
   *
   * ## Two guards, and the separator rule is the load-bearing one
   *
   * That is the opposite of what stood here first, and the correction came from measuring
   * the two as *sets* rather than by mutating either. Escaping the directory requires a
   * separator — so everything containment catches, the separator rule catches too, and its set
   * is strictly larger:
   *
   *     caught by containment and not by the separator rule    0
   *     caught by the separator rule and not by containment    5
   *
   * The five are contained-but-wrong: `a/b`, `a/b/c`, a separator in the *other* id, `a\b`, and
   * doubled-dot padding that resolves to literal directories. None escapes. Each lands in a
   * subdirectory `watchApprovals` never reads — so with the separator rule gone and
   * `approvals/a/` already present, `decide('a/b', 'x', true)` **succeeds**, writes
   * `approvals/a/b.x.verdict.json`, and the decision is never applied. No error anywhere. That
   * is worse than the traversal this function was changed to fix: the traversal was loud and in
   * the wrong place; this is silent and looks right.
   *
   * It runs first because a traversal deserves *"cannot contain a slash"* rather than *"not
   * addressed to this workspace"* — same refusal, more useful sentence.
   *
   * Containment stays anyway, and the honest reason is not the one first given here. It is not
   * that a pattern might be wrong about a real id: this pattern cannot be, because an id that
   * becomes one filename component can never legitimately contain a separator. It is that
   * containment survives somebody later relaxing the pattern for an id shape we have not seen.
   *
   * One caveat on the pattern, since it is the rule doing the work: `a\b` is refused and a
   * backslash is a legal filename character on POSIX. That is a false positive, kept because no
   * session id or `toolu_…` contains one and Windows would treat it as a separator.
   */
  if (/[/\\]/.test(sessionId) || /[/\\]/.test(toolUseId)) {
    throw new Error('An approval id cannot contain a slash — it becomes a filename.')
  }

  // `safeRelativePath` rather than a fourth hand-rolled `resolve`-and-compare: written for
  // `reconcile.ts`, where being wrong once is a write over an arbitrary file, and fuzzed against
  // nineteen shapes including a drive letter, a UNC path and an embedded NUL.
  const path = safeRelativePath(dir, `${sessionId}.${toolUseId}.verdict.json`)
  if (path === null) {
    throw new Error('That approval is not addressed to this workspace, so no decision was written.')
  }

  await mkdir(dir, { recursive: true })

  // Written to a temp file and renamed, never in place.
  //
  // The hook polls `existsSync(answer)` and parses whatever is there, and **a verdict it cannot
  // parse is a denial** — which is the right rule for a file that might be truncated, and the
  // wrong outcome to reach by racing our own write. Writing in place makes the file exist before
  // it is complete, so a poll landing in that window turns a person's *allow* into "Office Space
  // could not read the decision, so this was not approved."
  //
  // Small window, and the worst possible message to show somebody who just approved something.
  // `rename` within a directory is atomic, so the file is absent or whole and never between —
  // the same move `saveRegistry` makes, for the same reason, one directory over.
  const temp = `${path}.${process.pid}.${++verdictSeq}.tmp`
  try {
    await writeFile(temp, JSON.stringify({ allow, ...(reason ? { reason } : {}) }), 'utf8')
    await rename(temp, path)
  } catch (err) {
    // A failed write leaves nothing behind. `answerFromPolicy` tries a failed verdict again on
    // every batch, each try is a new temporary file, and one left per failure piles up in the
    // directory the gate reads: measured in review, eleven after ten changes. If removing it
    // fails too, the write's own error is still the one thrown, since it is the one reported.
    await rm(temp, { force: true }).catch(() => {})
    throw err
  }
}

/** Distinguishes two verdicts written in the same millisecond by the same process. */
let verdictSeq = 0

/**
 * Write the marker, never through a link.
 *
 * `writeFile(path, '')` follows a symlink and truncates whatever is at the other end — and this
 * runs on every tick, at a fixed and public path, with no user interaction. One link dropped at
 * `.office-space/approvals/.watching` empties its target for as long as the office is open.
 *
 * Lower than the same shape in `projects/_TEMPLATE/`, and the difference is `.gitignore`:
 * `.office-space/` is ignored, so a clone cannot carry one, while `!projects/_TEMPLATE/**` ships
 * the scaffold deliberately. Reaching this needs the ignore file edited too. It is still a write
 * rather than a read, and the fix is three lines.
 *
 * `lstat` and replace rather than `O_NOFOLLOW`, which is not portable — and replace rather than
 * refuse, because the marker's whole job is to exist and be recent. A tick that declined to write
 * it would tell every approval hook that nobody is watching.
 */
async function beat(path: string): Promise<void> {
  const link = await lstat(path).then((info) => info.isSymbolicLink(), () => false)
  if (link) await rm(path, { force: true })
  await writeFile(path, '', 'utf8')
}

/**
 * Which requests this office has already answered from policy.
 *
 * The hook deletes its own request file once it reads the verdict, but the poll can tick again
 * before it does — so without this, a request answered from `permissions.allow` is answered
 * again on the next tick, and the log claims more decisions than were made.
 *
 * ## Why it is a class rather than a `Set` in `main.ts`
 *
 * It was a `Set` in `main.ts`, and nothing ever removed from it. One `sessionId.toolUseId` string
 * per auto-decided tool call, for the lifetime of the process, on the hot path — every call the
 * office allows without asking goes through here. Same shape as the recorder map, and the same
 * reason it survived: `main.ts` imports `electron` at module scope, so no test could reach it.
 *
 * ## What bounds it
 *
 * The set only has to outlive the request file. {@link keepOnly} is handed the batch the poll
 * just read, and anything not in it is gone from disk — the hook cleaned up, and a request that
 * has been cleaned up cannot come back.
 *
 * The exception is a request `pending()` skipped this tick because it caught the file mid-write.
 * That key is dropped and decided a second time when the whole file appears. The cost is one
 * duplicate line in the log, which is the cost the original comment already accepted — *"writing
 * the same verdict twice is harmless; deciding it twice is noise"* — and it is a better trade
 * than a set that only grows.
 *
 * ## And which answers did not land
 *
 * A verdict whose write failed is held here per call, beside its key, until a later write for that
 * call lands or the call leaves the batch. Per call, not per batch, because batches overlap: one
 * that skips a call because another batch is writing it has said nothing about that call.
 */
export class Decided {
  private keys = new Set<string>()
  private failures = new Map<string, Unwritten>()

  /** True the first time this key is seen, false every time after. */
  first(key: string): boolean {
    if (this.keys.has(key)) return false
    this.keys.add(key)
    return true
  }

  /**
   * A verdict for this key did not reach disk.
   *
   * The key is given back, so the next batch that holds the request answers it again: the hook is
   * still waiting, and a kept key meant the office never tried again. The failure is kept until a
   * write lands or the request is gone.
   */
  failed(key: string, unwritten: Unwritten): void {
    this.keys.delete(key)
    this.failures.set(key, unwritten)
  }

  /**
   * Nothing is owed for this key any more: its verdict reached disk, or it is a person's question
   * now, after the mode or the settings changed.
   */
  settled(key: string): void {
    this.failures.delete(key)
  }

  /** Every verdict still unwritten, for a request the last batch held. */
  get unwritten(): readonly Unwritten[] {
    return [...this.failures.values()]
  }

  /** Forget every key not in this batch. Those requests are off disk and cannot return. */
  keepOnly(live: Iterable<string>): void {
    const alive = new Set(live)
    for (const key of this.keys) {
      if (!alive.has(key)) this.keys.delete(key)
    }
    for (const key of this.failures.keys()) {
      if (!alive.has(key)) this.failures.delete(key)
    }
  }

  /** How many are remembered. The number that used to only go up. */
  get size(): number {
    return this.keys.size
  }
}

/**
 * Watch for requests.
 *
 * Polls as well as watching. `fs.watch` on a directory is not reliable everywhere — it misses
 * events on some filesystems and reports them twice on others — and a missed request here is a
 * card that never appears and an agent that hangs until its timeout. The poll is the floor; the
 * watcher only makes it feel immediate.
 */
export function watchApprovals(
  root: string,
  onChange: (requests: readonly ApprovalRequest[]) => void,
  pollMs = 400,
): { close(): void; resend(): void } {
  let closed = false
  let watcher: FSWatcher | null = null

  /**
   * What was last handed to the caller, so an unchanged answer is not handed over again.
   *
   * `null` means nothing has been pushed yet, which is different from having pushed an empty
   * list — the first answer must always go out, even when it is "no requests".
   *
   * This is not an optimisation. The renderer rebuilds the whole activity strip on every push,
   * and a rebuild replaces the approval card's buttons with new elements. A real click needs
   * `mousedown` and `mouseup` on the *same* element, so a rebuild landing between them means no
   * click event is ever produced — which is exactly the reported fault: **Allow and Refuse could
   * not be pressed at all.** Pushing only on change means the card is rebuilt only when it
   * genuinely changed, which is never while somebody is reaching for it.
   *
   * ## Handed over is not received
   *
   * This records what went to `onChange`, not what reached a window, and in `main.ts` those
   * differ at startup. Measured with a scratch script, not in this repository, that boots the app
   * with one call already held. In a build instrumented to log each forward, the first push went
   * out at 931ms, the window was created at 1102ms, and `send` dropped the push for want of one.
   * Nothing changed afterwards, so nothing was pushed again — in a run left for ten seconds the
   * strip still read "nobody mid-task" with the request on disk. The gate refuses such a call at
   * its deadline, and no card is ever drawn for it. `resend` below is how a listener that arrives
   * late gets the answer it missed.
   */
  let last: string | null = null

  const push = (requests: readonly ApprovalRequest[]): void => {
    // A request is immutable once written, so the set of ids is the whole of what can change.
    const key = requests.map((r) => `${r.sessionId}.${r.toolUseId}`).sort().join('|')
    if (key === last) return
    last = key
    onChange(requests)
  }

  const tick = () => {
    if (closed) return
    // Say we are here, every tick. The hook reads the mtime; see WATCHING.
    void beat(join(root, WATCHING)).catch(() => {
      // Cannot write the marker, so the hook will defer to Claude Code's own permission flow.
      // That is the safe direction: the office loses its card, nothing loses its gate.
    })
    void pending(root)
      .then((requests) => {
        /*
         * `null` is not an empty list and must not be pushed as one.
         *
         * Pushing `[]` here would clear every card on screen the moment the directory became
         * unreadable — replacing "these three calls are waiting" with a floor that looks idle,
         * which is worse than the stale list, because the stale list is at least a true statement
         * about something. The office says so instead, through the problems panel; see `main.ts`.
         */
        if (!closed && requests !== null) push(requests)
      })
      .catch((err: unknown) => {
        /*
         * Said, not swallowed, unlike the catches either side of this one.
         *
         * Each of those has a fallback that keeps the gate honest: without the marker the hook
         * defers to Claude Code's own check, and without the watcher the poll carries on. This read
         * has none. Every card comes from it, so a tick that fails pushes nothing, and a call that
         * arrived since the last push has no card until a later tick succeeds.
         *
         * Two things reach here. `pending` rejecting, which a request whose `askedAt` was not text
         * made it do on every tick until the sort in `pending` stopped throwing; and `onChange`
         * throwing inside `push`, after which `last` already names the set that did not go out, so
         * that set is not pushed again until it changes or a `resend` asks for it.
         *
         * Logged the way `main.ts` logs a change record it could not write, and on every tick that
         * fails: a failure that repeats is one somebody should hear about.
         */
        console.error(
          'Office Space: a check for held tool calls failed, so a call waiting now may have no card: ' +
            String(err),
        )
      })
  }

  const timer = setInterval(tick, pollMs)
  void mkdir(join(root, DIR), { recursive: true })
    .then(() => {
      if (closed) return
      /**
       * Ignore our own heartbeat.
       *
       * `WATCHING` lives *inside* the directory being watched, so writing it on every tick fired
       * the watcher, which called `tick`, which wrote it again. A self-sustaining loop: measured
       * at **24.6 pushes a second** against the 2.5 the 400ms poll accounts for.
       *
       * The marker cannot simply move — the approval-gate hook reads it at this exact path, and
       * hooks live in workspaces that were seeded once and are never updated. So the loop is cut
       * here, where both ends are in one file.
       */
      watcher = watch(join(root, DIR), (_event, filename) => {
        if (filename === MARKER_NAME) return
        tick()
      })
    })
    .catch(() => {
      // Cannot watch, so the poll carries it alone. Slower, and still correct.
    })

  tick()

  return {
    close() {
      closed = true
      clearInterval(timer)
      watcher?.close()
      // Stop claiming to watch. Best effort — the mtime check is what actually protects this,
      // because a killed process runs no cleanup at all.
      void rm(join(root, WATCHING), { force: true }).catch(() => {})
    },
    /**
     * Push the current set once more, changed or not.
     *
     * For a listener that has only just started listening. Forgetting `last` makes the next
     * answer a first answer, and a tick fetches it now rather than at the next poll. Still read
     * from disk, so what goes out is the set as it is, not as it was when the push was dropped.
     *
     * It costs at most one push that no change caused, per call rather than per tick, which leaves
     * the rule above intact: that rule is about a card rebuilt while somebody reaches for it, and a
     * window that has only just subscribed has not had a card up long enough to be reached for.
     */
    resend() {
      last = null
      tick()
    },
  }
}

/**
 * Send the renderer what each batch leaves for a person — never an older batch after a newer one.
 *
 * `watchApprovals` calls this each time the set of ids changes. An empty batch is sent at once. A
 * non-empty one is sent only after `toAsk` has read the settings and written a verdict for every
 * call the policy answers, and two batches can be inside that window together. Nothing made them
 * finish in the order they started, so a `[H]` worked out first could land after the `[]` that
 * replaced it.
 *
 * The renderer then kept a card for a call nothing was waiting on, and nothing took it down: the
 * watcher's last key already matched the directory, so it had no change left to push. Found by
 * reading, not seen in the app. The test drives the real watcher and holds a stand-in for the
 * settings read open, so it shows the order can happen, not how often it does.
 *
 * ## The rule
 *
 * Each batch takes a number as it starts, and its list is dropped if a later batch's list has
 * already been sent. A later batch that has only *started* does not count. Until it answers, the
 * older list is the newest one there is, and if it never answers, because a verdict write threw,
 * the older list is all the renderer gets.
 *
 * A dropped batch has still done its work, and its verdicts are written. Only its list is stale.
 *
 * Here rather than in `main.ts` so a test can reach it — see `pendingFrom`. The empty-batch
 * shortcut came too, because it is half of how the two orders came apart.
 */
export function forwardInOrder(
  toAsk: (requests: readonly ApprovalRequest[]) => Promise<readonly ApprovalRequest[]>,
  forward: (held: readonly ApprovalRequest[]) => void,
): (requests: readonly ApprovalRequest[]) => void {
  let started = 0
  let sent = 0
  return (requests) => {
    const turn = ++started
    const send = (held: readonly ApprovalRequest[]): void => {
      if (turn < sent) return
      sent = turn
      forward(held)
    }
    // The overwhelming majority of ticks see nothing. Reading the policy on each of those would
    // be a settings.json read every 400ms for the life of the window.
    if (requests.length === 0) {
      send([])
      return
    }
    void toAsk(requests).then(send)
  }
}

/**
 * What to do with a request before a person ever sees it.
 *
 * The gate fires on every `Bash` call, including ones the workspace already authorised —
 * measured: a `PreToolUse` hook runs before permission resolution, so `Bash(echo:*)` in the
 * allow list does not stop the hook firing. Without this triage, registering the gate would put
 * every `npm test` an employee runs in front of a human for four minutes, and the allow list in
 * `.claude/settings.json` — which exists precisely so the office can run its own tests unattended
 * — would buy nothing.
 *
 * So the same policy that decides what the verify harness may run unattended decides this. One
 * policy, declared once, doing three jobs now rather than two:
 *
 * - **allowed** — the workspace already said yes. Answer immediately; show nobody. Claude Code
 *   would have permitted this anyway, so asking would be theatre.
 * - **denied** — the workspace said no. Answer immediately, with the rule, so the agent reads
 *   why rather than hitting a silent wall. Never offered to a person: `deny` in that file means
 *   *not a decision anybody is invited to make*.
 * - **unlisted** — nobody has decided. **This is the case the gate exists for.** `--print`
 *   cannot stop and ask, so today it is simply refused and the employee finds out by being told
 *   no. With the gate registered, it becomes a question.
 *
 * Anything that is not a `Bash` call is asked. The registered matcher is `Bash`, so that branch
 * is unreachable today — it is there because widening the matcher must fail towards asking, and
 * a triage that silently auto-allowed an unrecognised tool would be the opposite.
 */
export type Triage =
  /**
   * `rule` here has no reader, and that asymmetry is the decision rather than an oversight.
   *
   * A refusal quotes its rule — *"Refused by this workspace's own policy: `<rule>`, in
   * .claude/settings.json or …"* — because being told no without being told why is the complaint
   * this whole gate exists to answer. An allow says nothing, because an allow list that announced
   * itself on every match would be the log clutter that was cut from this app on purpose: the
   * point of permitting something in advance is not to be interrupted about it.
   *
   * It stays on the type because the two branches are one shape, and because a future "why did
   * that run?" surface — a per-call trace rather than a running commentary — is the one place it
   * would belong.
   */
  | { readonly action: 'allow'; readonly rule: string }
  | { readonly action: 'deny'; readonly rule: string }
  | { readonly action: 'ask' }

export function triage(
  request: ApprovalRequest,
  policy: Policy,
  mode: PermissionMode = 'default',
): Triage {
  if (request.tool !== 'Bash') return { action: 'ask' }

  const command = request.input['command']
  // A Bash call with no command string is not something to reason about — ask.
  if (typeof command !== 'string' || !command.trim()) return { action: 'ask' }

  const verdict = judge(command, policy)

  // **Deny wins, in every mode, including bypass.**
  //
  // Claude Code's own `bypassPermissions` does the same. This comment used to call the rule a
  // departure from the CLI, "whose own `bypassPermissions` ignores everything". Measured
  // against 2.1.266 on 2026-09-16, under `--print` in bypass mode:
  // - a deny rule still refused `node -e 0`;
  // - so did an ask rule;
  // - both refused even with a PreToolUse hook answering `allow`, as this gate does.
  // Bypass skips the question, not the rules.
  //
  // The rule would be the office's either way. A deny is a standing instruction somebody wrote
  // once and expects to hold, a mode is a convenience set for an afternoon and forgotten. An
  // unnecessary refusal costs a turn; `rm -rf` on the wrong directory costs the afternoon.
  //
  // This gate does not read ask rules yet. In bypass it answers such a call with `allow`, and
  // Claude Code refuses it anyway.
  //
  // The picker says what bypass still refuses: see `PERMISSION_CHOICES` in
  // `shared/control-copy.ts`. A mode that quietly does less than its name is the third standing
  // order broken in the place somebody is most likely to trust it.
  if (verdict.state === 'denied') return { action: 'deny', rule: verdict.rule }
  if (verdict.state === 'allowed') return { action: 'allow', rule: verdict.rule }

  // Unlisted: nobody has decided. That is the case this gate exists for — and the case two of
  // the five modes are *about*, which is why they were inert until they were passed in here.
  //
  // Reported from a session with `bypass permissions` selected and forty-one approval cards
  // already answered: bypass was on and nothing was being bypassed. That reading was right.
  // The mode reached the CLI, the CLI honoured it, and then the call arrived at a gate of our
  // own that had never been told the mode existed.
  switch (mode) {
    // "Asks for nothing." So it does not ask.
    case 'bypassPermissions':
      return { action: 'allow', rule: 'bypassPermissions' }
    // "Stops asking, and refuses anything the rules do not already allow." The name is the
    // specification: the answer to an unlisted command is no, and no question is put.
    case 'dontAsk':
      return { action: 'deny', rule: 'dontAsk' }
    default:
      return { action: 'ask' }
  }
}

/**
 * Triage, but never from rules we could not read.
 *
 * A settings file that exists and cannot be used produces zero rules — and the zero that matters
 * is `deny`. Everything above turns on "deny wins in every mode, including bypass", and the
 * picker puts that in front of a person in the words they choose by: *"Runs without asking
 * anything the rules neither deny nor ask about, except a few actions Claude Code always asks
 * about. Everything else is refused."*
 *
 * That sentence describes the office and Claude Code together, and it is false of this state.
 * The rules it counts on are missing — not because nothing was written, but because nothing
 * could be read — and a mode that quietly does less than its name is the third standing order
 * broken in the place somebody is most likely to trust it. Which is the argument the comment
 * above already makes, applied to the one case it did not cover.
 *
 * So: ask, for as long as the read is `incomplete`. "We cannot tell you what your own rules say"
 * has exactly one honest consequence, and it is not to carry on deciding.
 *
 * Except where the rules that were read already refuse. A deny rule from a file that could be
 * read still says no, and `triage` promises a denied call is never offered to a person. Asking
 * about it anyway turned a refusal into a question (found in review), when the only thing
 * missing is rules that might refuse *more*. So the deny rules that were read are checked first,
 * in every mode, and what they do not refuse is asked about. None of the allow rules are used.
 *
 * `checkPolicy` puts the same fact on the first-run panel at startup. That is the right place to
 * explain it and the wrong place to rely on — a panel can be dismissed, and the turn where it
 * matters is the one after that.
 */
export function triageAgainst(request: ApprovalRequest, read: PolicyRead, mode: PermissionMode = 'default'): Triage {
  if (!read.incomplete) return triage(request, read.policy, mode)
  const refused = triage(request, { allow: [], deny: read.policy.deny })
  return refused.action === 'deny' ? refused : { action: 'ask' }
}

/** A verdict the office reached for a held call without asking, which did not reach disk. */
export interface Unwritten {
  readonly request: ApprovalRequest
  /** What was decided: `true` to allow, `false` to refuse. */
  readonly allow: boolean
  /**
   * What decided it: a rule from the workspace's settings, or the name of the conversation's
   * permission mode. `triage`'s `rule`, which carries both.
   */
  readonly rule: string
  /**
   * Why the write failed, short enough to say more than once: the errno and the system call for a
   * filesystem error, whose message carries two temporary paths, and the error's own words, less
   * a closing full stop, for anything else.
   */
  readonly cause: string
  /** The errno, or `null` when the write was refused rather than failed: an id `decide` refuses. */
  readonly code: string | null
}

/** What `answerFromPolicy` needs from the office around it. */
export interface FromPolicy {
  /** This workspace's rules, read fresh for each batch. */
  readonly policy: () => Promise<PolicyRead>
  /** The permission mode of the conversation a call came from. */
  readonly modeOf: (sessionId: string) => PermissionMode
  /** The calls this office has already answered, so each is answered once. */
  readonly answered: Decided
  /** Write a verdict where the gate is waiting for it: `decide`, bound to the workspace. */
  readonly write: (
    request: ApprovalRequest,
    allow: boolean,
    reason: string | undefined,
  ) => Promise<void>
  /** Told, after every batch, the verdicts still unwritten for calls that batch holds. */
  readonly wrote: (unwritten: readonly Unwritten[]) => void
}

/**
 * Answer every held call the rules can answer, and return the ones left for a person.
 *
 * This loop was inline in `main.ts`, which no test can load (see `pendingFrom`), so it moved here
 * and everything it touches outside this module is handed in.
 *
 * ## A verdict that will not write
 *
 * `write` is `decide`, and `decide` throws: on a full disk, on a directory it may not write to,
 * on an id it refuses. The loop used to let that escape. The batch's promise rejected with nobody
 * listening, and the calls still waiting on a person were never sent to the renderer. The watcher
 * pushes only when the set of held calls changes, so it had nothing new to send, and those calls
 * stayed off the strip until the gate refused them. Found by reading, and not seen in the app.
 *
 * So each write is caught on its own, and the loop carries on:
 *
 * - **The call is left unanswered.** Nothing else is written for it, and it is not offered to a
 *   person: a refusal is not a question anybody is invited to answer, and an allow never was one.
 *   The gate refuses what nobody answers, and that still holds.
 * - **Its key is given back**, so the next batch that holds it tries the write again. A kept key
 *   meant it was never tried again, and the gate's clock refused what the rules had allowed.
 * - **It is reported, for as long as the call is held.** `wrote` hears after every batch, and
 *   what it hears is `Decided`'s record of unwritten verdicts, pruned to that batch. A failed call
 *   still held is in every batch and is tried again in each, so the report stays true; once the
 *   call leaves, or becomes a question for a person, the report drops it. The first version
 *   replaced the report only when a batch wrote something, and a call that had gone was still
 *   described as held.
 *
 * A refusal says what refused it. `triage` answers unlisted calls in two modes, and its `rule` is
 * then the mode's name, not a line of `.claude/settings.json`.
 *
 * ## Batches that overlap
 *
 * Two batches can be in here at once. The record is per call, so a batch that skips a call
 * because another batch is writing it leaves that call's failure alone.
 *
 * What is not covered, found in review: a batch that finishes after a newer one prunes and
 * reports from its own, older list.
 * - It can put back a call the newer batch no longer holds.
 * - It can drop a failure the newer batch recorded for a call it never saw, so the report goes
 *   empty while that call is still held and unwritten.
 * - Its failed write can come after a newer batch has made the call a question. An older batch
 *   writes a call in bypass mode, the mode goes back to default, a newer batch settles the call
 *   and puts it on the strip, and then the older write fails. The report says again that the
 *   office allowed the call and will try again.
 *
 * Each lasts until the next batch, which need not come while the held calls stay the same.
 * Ordering the lists main sends is a separate change, and this report needs the same ordering
 * when that lands.
 */
export async function answerFromPolicy(
  requests: readonly ApprovalRequest[],
  office: FromPolicy,
): Promise<readonly ApprovalRequest[]> {
  const read = await office.policy()

  /*
   * A settings file that exists and cannot be used contributes no rules, and that includes its
   * *deny* rules.
   *
   * `triage` is emphatic that deny wins in every mode, including bypass, and the picker tells a
   * person choosing bypass that what the rules refuse is still refused. That holds for rules
   * that were read. It cannot hold for rules nobody could read.
   *
   * So a read like that is not decided from as if it were whole. What `triageAgainst` does
   * instead is its own to say, and nothing here repeats it. What it never does is let a call
   * run on rules it could not read.
   *
   * `checkPolicy` already puts this on the first-run panel at startup. That is the right
   * place to *explain* it and the wrong place to rely on: a panel can be dismissed, and the
   * turn where it matters is the one after that.
   */
  const ask: ApprovalRequest[] = []
  for (const request of requests) {
    const key = `${request.sessionId}.${request.toolUseId}`
    // `triageAgainst`, not `triage`: it takes the whole read rather than the rules, so a
    // settings file that would not parse cannot be mistaken for one that permits nothing.
    const call = triageAgainst(request, read, office.modeOf(request.sessionId))
    if (call.action === 'ask') {
      // A failure recorded while the office was answering this call is not the office's to report
      // once the call is a question: measured in review, a card on the strip beside a report
      // saying the office had allowed it and would try again.
      office.answered.settled(key)
      ask.push(request)
      continue
    }
    // The hook clears its own files once it reads the verdict, but the poll can tick again
    // before it does. Writing the same verdict twice is harmless; deciding it twice is
    // noise, and this keeps the log honest about how many decisions were actually made.
    if (!office.answered.first(key)) continue
    const allow = call.action === 'allow'
    try {
      await office.write(request, allow, allow ? undefined : refusal(call.rule))
      office.answered.settled(key)
    } catch (err) {
      office.answered.failed(key, { request, allow, rule: call.rule, ...failureOf(err) })
    }
  }
  // Anything we remember that is no longer pending has been cleaned up by the hook and
  // cannot come back, so the set is bounded by what is in flight rather than by how long
  // the office has been open.
  office.answered.keepOnly(requests.map((r) => `${r.sessionId}.${r.toolUseId}`))
  office.wrote(office.answered.unwritten)
  return ask
}

/** The permission mode `rule` names, when it is a mode's answer rather than a settings rule's. */
const modeNamed = (rule: string) => PERMISSION_CHOICES.find((choice) => choice.value === rule)

/** What the model is told about a refusal. It reads this, so it has to name the right thing. */
function refusal(rule: string): string {
  const mode = modeNamed(rule)
  if (mode) {
    return (
      `Refused by this conversation's ${mode.label} permission mode, which refuses anything ` +
      "this workspace's rules do not already allow."
    )
  }
  // The policy merges both settings files and does not keep which one a rule came from, so
  // naming one of them sends the reader to the wrong file whenever the rule is in the other.
  return (
    `Refused by this workspace's own policy: ${rule}, ` +
    'in .claude/settings.json or .claude/settings.local.json.'
  )
}

/** Why a write failed, in the two fields `Unwritten` keeps. */
function failureOf(err: unknown): Pick<Unwritten, 'cause' | 'code'> {
  const failure = err as Partial<NodeJS.ErrnoException> | null | undefined
  if (typeof failure?.code === 'string') {
    const cause = failure.syscall ? `${failure.code} on ${failure.syscall}` : failure.code
    return { cause, code: failure.code }
  }
  const said = err instanceof Error ? err.message : String(err)
  return { cause: said.replace(/\.+$/, ''), code: null }
}

/** How many calls, and how many causes, the sentence below names before it counts the rest. */
const NAMED = 3

/**
 * What the problems panel says about verdicts that did not land.
 *
 * The panel prints this and nothing else, so it carries the whole of it: which calls, what
 * answered each, why the writes failed, what happens to those calls now, and — when the failure
 * was the filesystem's — where to look. Assumes at least one, which is the only time `main.ts`
 * asks.
 *
 * What answered a call is named, because it is not always the rules: `bypassPermissions` allows
 * and `dontAsk` refuses what the rules do not list, and crediting the rules with that sends the
 * reader to a settings file that says nothing about it. Measured in review on the first version,
 * which said *"This workspace's rules answered "curl example.com" (allowed)"* in bypass mode.
 */
export function unwrittenDetail(unwritten: readonly Unwritten[], dir: string): string {
  const named = unwritten.slice(0, NAMED).map((u) => {
    const mode = modeNamed(u.rule)
    const by = mode ? `the ${mode.label} mode` : `the rule ${u.rule}`
    return `"${commandOf(u.request)}" (${u.allow ? 'allowed' : 'refused'} by ${by})`
  })
  const more = unwritten.length > NAMED ? ` and ${unwritten.length - NAMED} more` : ''
  const causes = [...new Set(unwritten.map((u) => u.cause))]
  const others = causes.length - NAMED
  const said =
    causes.slice(0, NAMED).join('; ') +
    (others > 0 ? `; and ${others} other ${others === 1 ? 'error' : 'errors'}` : '')
  const one = unwritten.length === 1
  const filesystem = unwritten.some((u) => u.code !== null)
  const where = filesystem ? ` Check that ${dir} can be written to.` : ''
  return (
    `Office Space answered ${named.join(', ')}${more} without asking, and could not write ` +
    `${one ? 'that answer' : 'those answers'} for the gate to read: ${said}. ` +
    `${one ? 'The call is' : 'Those calls are'} still held, and the office tries again ` +
    'whenever the held calls change. A call no try reaches is not approved by the office: the ' +
    'gate refuses it when it stops waiting, or, if it stops hearing from the office, hands it to ' +
    `Claude Code's own permission check.${where}`
  )
}

/**
 * The problem main shows for what `answerFromPolicy` reports, or `null` when nothing is unwritten.
 *
 * Here rather than in `main.ts`, because whether the problem is set at all is a decision, and
 * review found `main.ts` could stop setting it while every test stayed green.
 */
export function unwrittenProblem(unwritten: readonly Unwritten[], dir: string): Problem | null {
  if (unwritten.length === 0) return null
  const detail = unwrittenDetail(unwritten, dir)
  return { kind: 'lint', path: dir, rule: 'verdicts-unwritten', detail }
}

/** One short line for a call the rules answered. Only `Bash` calls are answered from policy. */
function commandOf(request: ApprovalRequest): string {
  const command = request.input['command']
  if (typeof command !== 'string') return request.tool
  return truncate(command.split('\n')[0] ?? '', 60)
}


/**
 * The held calls as the renderer needs them.
 *
 * Here rather than inline in `main.ts` so the mapping can be tested at all. The lookup alone was
 * extracted first and that was not enough: `main.ts` is unreachable from the suite, so the
 * *call* stayed unguarded and `projectOfSession(...) ?? ''` passed 2583 tests green.
 *
 * **This narrowed that gap and did not close it**, which is worth stating plainly because two
 * earlier versions of this comment claimed otherwise. The call in `main.ts` is still one untested
 * line, and it still carries a decision: measured on this branch, `pendingFrom(rs, [])` — every
 * held call unplaceable, the mark unreachable for anyone — is green, and so is
 * `pendingFrom(rs, sessions.filter((s) => s.opened))`, which is the exact edit the `opened`
 * paragraph in `projectOfSession` warns against, applied one level out.
 *
 * What moved inside the guard is the shape of the record. What is left outside it is *which
 * sessions get handed in*. Closing that needs `main.ts` reachable from the suite, which is a
 * larger change than the one this comment sits in.
 *
 * `ApprovalRequest.cwd` is not carried across, and nothing was dropped in the move to say so:
 * the old mapping in `main.ts` never carried it either. `PendingApproval` has never had the
 * field — `cwd` is how the gate found the workspace, not something a card shows.
 */
export function pendingFrom(
  requests: readonly ApprovalRequest[],
  sessions: readonly SessionRecord[],
): readonly PendingApproval[] {
  return requests.map((r) => ({
    sessionId: r.sessionId,
    // The registry is the only thing that knows. The gate writes a session id, and the renderer
    // cannot map it for a project nobody has opened — `watchSessions` returns early on
    // `list.project !== active`. `null` where the registry has no row, never a guess at the open
    // project and never the office, which would put a stray `claude` session's held call on the
    // office's own card.
    project: projectOfSession(sessions, r.sessionId),
    toolUseId: r.toolUseId,
    tool: r.tool,
    input: r.input,
    askedAt: r.askedAt,
    waitMs: r.waitMs,
    // `null` is the manager, not "we could not tell" — see ApprovalRequest. Read by `blockedBy`
    // in approval-summary.ts, which is what puts a name on the card.
    agent: r.agent ?? null,
  }))
}
