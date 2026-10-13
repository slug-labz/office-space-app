/**
 * A project's conversation with its manager.
 *
 * The vision calls a project "a group of sessions", and this is one of them: the manager's.
 * The chat panel is not a summary of it or a view derived from it — it is that conversation,
 * rendered. So this class owns one session id from the first message onward and resumes it
 * every time, rather than discovering an id after the fact.
 *
 * Generating the id up front is what makes a project able to *own* its session: the id exists
 * before the conversation does, so it can be stored, reopened, and forked for asides without
 * ever having to go looking for it.
 */

import {
  DEFAULT_CONTROLS,
  isIgnoredUnderPrint,
  isPermissionMode,
  type Controls,
  type PermissionMode,
} from '../shared/controls.js'
import { randomUUID } from 'node:crypto'
import { runClaude, type RunHandle } from './claude/run.js'
import { FIRST_MODE, withheldIn, type Mode } from '../shared/session/mode.js'
import { denyingFiles, judge, readPolicy, type Policy, type PolicyRead } from './permissions.js'
import type { RefusalCause } from '../shared/refusals.js'
import type { ClaudeEvent, ToolDenial } from './claude/stream.js'
import { withOfficeContext } from '../shared/office-context.js'
import { officeBlocks, type OfficeState } from '../shared/context/blocks.js'
import type { SessionState, StaffMember } from '../shared/ipc.js'
import { admit } from './children.js'

/**
 * How much the office may do without asking.
 *
 * `-p` has no way to answer a permission prompt, so whatever is not pre-authorised is refused
 * — an office in the strictest mode looks like a room full of people who cannot open a file.
 * `acceptEdits` is Claude Code's own everyday working mode and is the default here for that
 * reason, not because it is permissive.
 *
 * Override with `OFFICE_PERMISSION_MODE`. Denials are rendered in the transcript either way:
 * a tool that was refused is a thing that happened, and hiding it would leave you wondering
 * why nothing changed.
 */
const DEFAULT_PERMISSION_MODE: PermissionMode = 'acceptEdits'

export interface SessionOptions {
  readonly cwd: string
  /** Which agent answers in the chat panel. The manager, by definition. */
  readonly agent: string
  /**
   * Tools withheld for the whole life of this session, whatever mode it is in.
   *
   * The mode's own list is per-turn and moves as the conversation does. This one is a fact about
   * *whose* conversation it is: an employee's own session never gets `Task`, `Write` or `Edit`,
   * and no mode change gives them back.
   */
  readonly withhold?: readonly string[]
  /**
   * What this conversation had already cost when it was resumed.
   *
   * Without it a resumed conversation starts counting from zero, and the number that goes back
   * into the registry is **this run's spend rather than the conversation's**. Every other field
   * beside it in that write already knows: `createdAt` is `existing?.createdAt ?? now` and the
   * title falls back to `existing?.title`. Cost did not, so resuming a conversation that had
   * cost $2.40, saying one thing worth 3 cents, and closing the app left $0.03 on disk — the
   * earlier figure gone, with nothing to recover it from.
   *
   * It went unnoticed because nothing read it. `sessionRows` reads it now, which is what turned
   * a silent write into a wrong number on a row somebody is choosing between conversations with.
   */
  readonly costUsd?: number | null
  /**
   * The roster, read fresh at the moment of sending.
   *
   * A function rather than a value because the workspace is watched: staff are hired and let
   * go while a project is open, and a roster captured when the session was constructed would
   * be a roster that is wrong by the second message.
   */
  readonly staff: () => readonly StaffMember[]
  /**
   * What to tell the manager about the project it is working in.
   *
   * A function for the same reason `staff` is: the project's files change while the
   * conversation is open, and a block captured at construction would go stale.
   */
  readonly projectBlock: () => string
  /**
   * Which project this conversation belongs to, **by id**.
   *
   * A plain string, and separate from `projectBlock` above, because the two are different kinds
   * of thing that were briefly one: that is prose written for the manager to read, and this is a
   * key other parts of the app look conversations up by. `modeOf` does
   * `controlsFor(session.project)` against a map keyed by project id, so a getter returning the
   * prose meant the lookup never matched and the permission mode somebody chose was never the
   * one applied — the exact fault the `project` getter's own comment says it was added to fix.
   */
  readonly project: string
  /**
   * Which model, how hard it thinks, and what it may do without asking.
   *
   * A function for the same reason `staff` and `project` are: these are dials the user can turn
   * while a conversation is open, and a value captured when the session was constructed would
   * be the setting from before they turned it. Read at the moment of sending, every time.
   */
  readonly controls: () => Controls
  /**
   * Everything else the office knows that the manager cannot see for itself.
   *
   * The shelf, who is out of their chair, what the harness says is unverified, which connectors
   * answered, what is playing, how much of the plan is left. A function for the same reason the
   * three above are: all of it changes while a conversation is open.
   *
   * Optional so that a caller with nothing to add — the aside path, a test — sends the two
   * blocks that were always there and nothing more.
   */
  readonly office?: () => Partial<Omit<OfficeState, 'project' | 'staff'>>
  /**
   * Which mode this conversation opens in.
   *
   * A new one opens in `intake`; a resumed one opens in whatever the registry recorded, so
   * resuming does not silently hand back tools that were withheld — or take back tools that
   * were not. Omitted means new.
   */
  readonly mode?: Mode
  /**
   * Which `claude` to run. Defaults to whatever is on PATH.
   *
   * "If `claude` works in your terminal, this works" is true for almost everyone and not quite
   * true for anyone whose install is somewhere a GUI app's PATH does not reach — a launcher
   * that does not source a shell profile is the usual way to end up there. `OFFICE_CLAUDE_PATH`
   * is the way out, and it is the same escape hatch `runClaude` already exposes.
   */
  readonly claudePath?: string
  /**
   * Pick an existing conversation back up instead of starting a new one.
   *
   * Only ever an id the registry has recorded as opened — an id Claude never confirmed names
   * no conversation on disk, and resuming it would produce an error rather than a session.
   */
  readonly resume?: string
  readonly onEvent: (event: ClaudeEvent) => void
  readonly onState: (state: SessionState) => void
}


export class ManagerSession {
  /** Stable for the life of the project, and known before the first word is sent. */
  readonly id: string

  /**
   * The mode this conversation is in. **The person moves it, never the model.**
   *
   * Held here rather than passed per turn because it is a property of the conversation: the
   * whole point is that it survives the manager deciding it has heard enough.
   */
  private currentMode: Mode
  private started: boolean
  private running: RunHandle | null = null
  /**
   * What the whole conversation has cost, not what this run of it has.
   *
   * Seeded from the registry on resume — see `SessionOptions.costUsd`. `spend` and the result
   * summary both add, so this is a running total across every run of one conversation, which is
   * the number both readers want: the header's *"$x this session"* and the switcher's
   * per-conversation figure are the same question asked twice.
   */
  private costUsd: number | null = null
  private error: string | null = null
  private firstMessage: string | null = null
  /**
   * The exact text of the last prompt sent, office blocks and all.
   *
   * Held in memory only, and only the most recent one — this is for answering "what did you
   * just send on my behalf", not for building a second transcript of the first. Writing it to
   * disk would add a `yours` store to protect in order to answer a question about privacy.
   */
  private sent: string | null = null

  constructor(private readonly options: SessionOptions) {
    // A resumed conversation already exists, so it is already started — the next message
    // continues it rather than trying to claim its id a second time.
    this.id = options.resume ?? randomUUID()
    this.started = options.resume !== undefined
    // A new conversation opens in intake; a resumed one opens where it left off.
    this.currentMode = options.mode ?? FIRST_MODE
    // And it opens owing what it already owed.
    this.costUsd = options.costUsd ?? null
  }

  /**
   * Who answers in this conversation.
   *
   * Exposed because a session that has not reached the registry yet still has an answer, and
   * without it a brand-new conversation with the tester reported as the manager's — the lookup
   * fell through to the default on the one turn where being wrong is most visible.
   */
  get agent(): string {
    return this.options.agent
  }

  /**
   * Which project this conversation belongs to.
   *
   * Exposed for the same reason `agent` is: something outside needs the answer and the session
   * has always had it. The approval gate needs it to look up the permission mode — without it,
   * `bypassPermissions` and `dontAsk` were inert, because the gate could not tell which
   * conversation a parked command had come from.
   */
  get project(): string {
    return this.options.project
  }

  /**
   * Everything this turn may not use: the mode's list, plus whatever the session withholds for
   * good. Deduplicated, because `--disallowedTools Task Task` is a flag naming one tool twice.
   */
  private withheld(): readonly string[] {
    return [...new Set([...withheldIn(this.currentMode), ...(this.options.withhold ?? [])])]
  }

  /**
   * What this conversation is called: the first thing you said to it.
   *
   * Null on a resumed session until you say something new — the opening message is in the
   * transcript, not in this process, and inventing a title from nothing would be worse than
   * having none.
   */
  get title(): string | null {
    return this.firstMessage
  }

  /** What was actually sent last, or null if this conversation has not sent anything yet. */
  get lastPrompt(): string | null {
    return this.sent
  }

  get state(): SessionState {
    return {
      phase: this.running ? 'running' : this.error ? 'failed' : 'idle',
      sessionId: this.started ? this.id : null,
      costUsd: this.costUsd,
      error: this.error,
      queued: [...this.queue],
      mode: this.currentMode,
    }
  }

  /**
   * Send a message. If one is already in flight, queue it behind that turn.
   *
   * The old version threw, and the reason it gave was sound and is still true: **two concurrent
   * runs on one session id interleave in the transcript**, and the floor would depict two
   * conversations as one. What was wrong was the conclusion. That argument forbids running them
   * *at the same time*; it says nothing against running them *in order*, which is what a queue
   * is.
   *
   * So the invariant is unchanged — one run per session, ever — and the behaviour is that
   * typing ahead works, which every other Claude surface allows and which this one turned into
   * an exception the user had to read.
   *
   * Resolves when *this* message's turn has finished, not when the queue has drained.
   */
  async send(text: string): Promise<void> {
    if (this.running) {
      this.queue.push(text)
      // Say so immediately. A message that has been accepted and is invisible is worse than one
      // that was refused, because the user has no way to tell which happened.
      this.publish()
      return
    }

    await this.turn(text)

    // Drain what arrived while that was running. Sequential and awaited, so the one-run
    // invariant holds for the whole chain rather than only for the first link.
    while (this.queue.length > 0 && !this.error) {
      const next = this.queue.shift()
      if (next === undefined) break
      this.publish()
      await this.turn(next)
    }
  }

  /** Which mode this conversation is in. */
  get mode(): Mode {
    return this.currentMode
  }

  /**
   * Move the conversation to another mode. Returns the mode it left, or `null` if it was already
   * there.
   *
   * Returning the previous mode rather than a boolean because every caller needs it: the event
   * carries `from` and `to`, and *"intake ended"* and *"a fresh conversation began in planning"*
   * are different facts that a bare `to` cannot tell apart.
   *
   * Takes effect on the **next** turn. A turn already in flight was spawned with the tool set of
   * the mode it started in, and there is no way to take a tool away from a running process —
   * pretending otherwise would be the app claiming an enforcement it does not have.
   */
  setMode(next: Mode): Mode | null {
    if (this.currentMode === next) return null
    const previous = this.currentMode
    this.currentMode = next
    this.publish()
    return previous
  }

  /**
   * Everything still waiting, dropped.
   *
   * Returns what was dropped rather than discarding it quietly — the caller has to be able to
   * tell the user which of their messages never ran.
   */
  private drop(): readonly string[] {
    const dropped = [...this.queue]
    this.queue.length = 0
    return dropped
  }

  /** One turn: the run itself, unchanged. */
  private async turn(text: string): Promise<void> {
    this.error = null
    const first = !this.started
    this.firstMessage ??= text

    /**
     * The rules in force for *this* turn, so a refusal can say *why*.
     *
     * **Started, never awaited.** `turn` has two places where an `await` cannot go, and this
     * read tried to sit in both of them before the tests said otherwise:
     *
     * - **Before `this.running` is set.** `send` decides whether to queue a message by looking
     *   at `this.running`, so an await ahead of that assignment lets a second message arrive
     *   mid-start, find nothing running, and spawn a second `claude` on the same session id —
     *   the interleaved transcript the queue exists to prevent.
     * - **Between the spawn and `await handle.done`.** A binary that cannot be started rejects
     *   immediately, and a rejection with nothing attached yet is an unhandled rejection that
     *   takes the test runner down instead of being reported as a failed turn.
     *
     * So it runs alongside the turn and lands whenever it lands. `readPolicy` never rejects —
     * every failure is a `PolicySource` in its report — which is what makes the floating promise
     * safe rather than merely convenient.
     *
     * Read per turn rather than cached because `.claude/settings.json` is a file a person edits
     * while the app is open. That is the whole way out of a refusal, so the one moment a cached
     * copy would be wrong is the moment straight after somebody acted on our own advice.
     *
     * While it is `null` no cause is claimed, so each refusal gets the `unknown` advice. That is
     * not silence: the advice still points at a rule in `.claude/settings.json`, which is wrong
     * about a file that cannot be used. A `claude` turn takes seconds and this read about a
     * millisecond, so the read usually lands first. Not always: with libuv's thread pool held
     * by blocked opens, three results out of three arrived before it (measured in #260's review).
     * An empty policy would report every refusal as *unlisted*, which is a guess wearing the
     * clothes of a finding.
     */
    let read: PolicyRead | null = null
    void readPolicy(this.options.cwd).then((landed) => {
      read = landed
    })

    // `started` is set by the `init` event below, not here.
    //
    // It means "a session with this id exists and can be resumed", and only Claude can tell us
    // that. Setting it optimistically before the run is how a first message that fails —
    // `claude` not installed, an expired token, a bad workspace — leaves every later message
    // resuming a session that was never created, so the office stays broken until it is
    // restarted. The first failure is recoverable; being wrong about this makes it permanent.
    const watch = (event: ClaudeEvent) => {
      if (event.kind === 'init') this.started = true
      this.options.onEvent(event.kind === 'result' ? withCauses(event, read) : event)
    }

    // The exact string this app is about to send, kept so a person can read it.
    //
    // The largest thing Office Space sends is not a destination — it is the prompt it assembles
    // itself: `withOfficeContext` prepends blocks to every message and the user has never seen
    // them. Holding it here costs one reference to a string we already built, and it is what
    // makes "you can see exactly what leaves this machine" a property rather than a promise.
    const prompt = withOfficeContext(
      officeBlocks({
        project: this.options.projectBlock(),
        staff: this.options.staff().map((s) => ({
          id: s.id,
          description: s.description,
          tools: s.tools,
          isManager: s.isManager,
        })),
        // `[]`, not `null`. `null` means *the scan failed* and produces a line telling the
        // manager the shelf could not be read — which would be a false statement for any
        // caller that simply did not supply one (an aside, a test). `[]` produces no block at
        // all, which is silence, and silence is honest about a question nobody asked.
        skills: [],
        ...(this.options.office?.() ?? {}),
      }),
      text,
    )
    this.sent = prompt

    // Asked **before** spawning, not after. The cap exists because each of these is a real Node
    // process, so a check that runs once the process is already up has counted it and not
    // prevented it. Nothing below this line happens if the answer is no.
    const seat = admit({ what: `claude (${this.id.slice(0, 8)})`, stop: () => this.running?.kill() })
    if (!seat.ok) {
      // Reported as this turn's error, which is how every other refusal in this app surfaces:
      // the transcript says why nothing happened rather than the office looking idle. The
      // message is *not* re-queued — a queue behind a cap is the same over-subscription with a
      // longer wait and no explanation.
      this.error = seat.reason
      this.publish()
      return
    }

    const handle = runClaude(
      {
        cwd: this.options.cwd,
        prompt,
        agent: this.options.agent,
        // The chat panel is meant to be a Claude session with a face on it, and every real
        // Claude surface streams. A reply that lands whole after twenty seconds of nothing is
        // the difference between watching someone work and watching a progress bar.
        partials: true,
        controls: this.options.controls(),
        // The enforcement. In `intake` this is `Task`, `Write` and `Edit`, so the manager cannot
        // dispatch or change files — measured against the CLI, not assumed from the flag's name.
        //
        // `withhold` is the other half and it is orthogonal to the mode: a conversation with an
        // *employee* withholds the same three whatever mode it is in, because standing order 1
        // says only the user and the manager originate work. Asking the tester a question is not
        // originating work; a tester that starts editing files because you wondered aloud is.
        // Unioned rather than chosen between — either reason to withhold a tool is sufficient.
        ...(this.withheld().length ? { disallowedTools: this.withheld() } : {}),
        ...(this.options.claudePath ? { claudePath: this.options.claudePath } : {}),
        ...(first ? { sessionId: this.id } : { resume: this.id }),
      },
      watch,
    )

    this.running = handle
    // The seat was taken above, before the process existed — which is the whole point of the
    // cap. `stop` closes over `this.running` rather than over `handle`, so quit reaches whatever
    // is actually running now.
    const untrack = seat.release
    this.publish()

    try {
      const summary = await handle.done
      if (summary.costUsd !== null) {
        this.costUsd = (this.costUsd ?? 0) + summary.costUsd
      }
      // Failure comes from the result event, never the exit code — an expired token exits
      // non-zero *and* reports a result, and a refusal can exit zero.
      this.error = summary.isError ? summary.stderr.trim() || 'the run failed' : null
    } catch (err) {
      // The process could not be started at all — `claude` is not on PATH. That is a failed
      // session, and it has to be visible as one: reporting `idle` with no error would leave
      // the office looking ready when nothing about it works.
      this.error = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      // In `finally`, not on the success path. A run that threw — `claude` not on PATH, the
      // process dying — is still a run that is over, and leaving its entry behind would have
      // quit trying to kill a child that exited minutes ago while the count on screen said
      // something was still going.
      untrack()
      this.running = null
      this.publish()
    }
  }

  /**
   * Record money spent on this project's behalf outside a turn.
   *
   * Asides and voice digests are separate `claude` runs on separate sessions, and they cost
   * real money. Leaving them out of the total meant the number under the composer was not the
   * amount this conversation had cost — which is a small lie told in a very believable font.
   */
  spend(costUsd: number | null): void {
    if (costUsd === null || costUsd === 0) return
    this.costUsd = (this.costUsd ?? 0) + costUsd
    this.publish()
  }

  /**
   * Stop.
   *
   * Clears the queue as well as the running turn, and that is deliberate: pressing stop and
   * then watching three more messages fire would be alarming, and it is not what the word
   * means. What was dropped is returned so the caller can say so — silently discarding
   * messages the user typed and the office accepted would be the fourth standing order in the
   * one place they are certain to notice.
   */
  interrupt(): readonly string[] {
    const dropped = this.drop()
    this.running?.interrupt()
    if (dropped.length > 0) this.publish()
    return dropped
  }

  /** Messages typed while a turn was in flight. Drained in order, one run at a time. */
  private readonly queue: string[] = []

  private publish(): void {
    this.options.onState(this.state)
  }
}

/**
 * Why each refused call was refused, established rather than guessed.
 *
 * The CLI tells us *that* it refused something and never *why*: its denial entry is
 * `tool_name`, `tool_use_id`, `tool_input`, full stop. But the decision it made was made
 * against `.claude/settings.json`, and that file is right here — so the office asks the same
 * question of the same rules with `judge`, which is the function the verify harness and the
 * approval gate already answer it with. One policy, one matcher, three callers.
 *
 * Without this the transcript could only ever give the cause-neutral advice, and the two causes
 * need opposite actions: a `deny` rule has to be *changed*, an unlisted command has to be
 * *added*. Telling somebody to add an allow rule for a command a deny rule refuses sends them
 * to write a rule that will not work, and then to wonder why.
 *
 * Given the whole read rather than its rules, and exported, so the decision can be tested without
 * a turn around it.
 *
 * ## A settings file that could not be used decides nothing
 *
 * When `readPolicy` reports a file it consulted as `unreadable`, every refusal in the turn is
 * `unknown`, and the files ride on the event as `unusable`. Either cause judged from the rest of
 * the rules would be told as advice that can be false:
 *
 * - `unlisted` says to add the command to `permissions.allow` "and it will run without asking".
 *   Claude Code's settings page, read on 2026-09-16, says a `-p` run "skips the broken file or
 *   values", so a rule added to a broken file is not in force. Measured on dev at `e6fe5cb`, a
 *   `settings.json` holding `null` got that advice, and so did one that already allowed the
 *   command and had a trailing comma in it.
 * - `denied` says the deny rule is in `.claude/settings.json`. When that is the file set aside,
 *   the deny rule that was read is in `settings.local.json`.
 *
 * `triageAgainst` takes the same position on the same read: it does not decide from rules it knows
 * are short. The check here is on an `unreadable` source rather than on `incomplete`, because the
 * sentence it leads to says that a file could not be used.
 *
 * ## A file that was used, with an entry in its deny list that is not a rule
 *
 * The two are not the same set. A settings file can be read, keep its rules, and still leave the
 * read `incomplete` — one entry in `permissions.deny` that is not a string, which `readPolicy`
 * reports as `skipped` and Claude Code removes too. Nothing there is unusable, so the causes are
 * judged as usual and `denied` is as true as ever.
 *
 * What is not true is the end of the other two lines. Measured against a `settings.json` allowing
 * `Bash(npm test:*)` and denying `["Bash(rm:*)", 5]`: a refused `npm test` came back `unlisted`
 * and was advised *"nobody has allowed it either. Add it to permissions.allow there and it will
 * run without asking"* — and that file already allows it, and `triageAgainst` asks about it in all
 * seven modes. So the lists ride on the event as `shortDeny` and `shortDenyAdvice` says what the
 * state actually does.
 */
export function withCauses(
  event: Extract<ClaudeEvent, { kind: 'result' }>,
  read: PolicyRead | null,
): Extract<ClaudeEvent, { kind: 'result' }> {
  // No rules read yet means no cause claimed, and `unknown` gets advice that is true of either
  // cause. It still points at a rule in .claude/settings.json, which is wrong if that file cannot
  // be used — and with no read, nothing here can know. `turn` says why the read lands first.
  if (read === null || event.denials.length === 0) return event

  const unusable = read.sources.flatMap((s) => (s.state === 'unreadable' ? [{ file: s.file, why: s.cause ?? null }] : []))
  // The deny lists that were read short. Only `deny`: a skipped `allow` entry can leave the office
  // less willing than what was written and never more, so `readPolicy` reports it and nothing
  // more, and the advice would have nothing to warn about.
  const shortDeny = read.sources.flatMap((s) => {
    const entries = s.skipped?.filter((entry) => entry.list === 'deny').length ?? 0
    return entries > 0 ? [{ file: s.file, entries }] : []
  })
  // Absent rather than empty when there are none, as `unusable` is, so a turn judged against a
  // whole read carries neither field.
  const short = shortDeny.length > 0 ? { shortDeny } : {}
  if (unusable.length > 0) {
    return { ...event, denials: event.denials.map((d): ToolDenial => ({ ...d, cause: 'unknown' })), unusable, ...short }
  }

  const { policy } = read
  return { ...event, denials: event.denials.map((d) => judgeDenial(d, policy)), ...short }
}

/**
 * One refused call with its cause, and for a `denied` one, the files its deny rules are in.
 *
 * The advice for a deny rule tells somebody to change it, and the rules of both settings files are
 * merged before anything is judged. So the file is taken here, where the policy still knows where
 * each rule came from, and `summariseRefusals` names it.
 */
export function judgeDenial(denial: ToolDenial, policy: Policy): ToolDenial {
  const cause = refusalCause(denial, policy)
  const deniedIn = cause === 'denied' && denial.detail ? denyingFiles(denial.detail, policy) : []
  return deniedIn.length > 0 ? { ...denial, cause, deniedIn } : { ...denial, cause }
}

/**
 * Denied, unlisted, or not something this office can tell.
 *
 * **Only `Bash`, and only with a command string.** `ruleCovers` understands `Bash(...)` rules
 * and nothing else, so asking it about `Read(./.env)` gets "no rule covers this" — which would
 * be reported as *unlisted* for a path a `deny` rule refuses by name. That is the shape of lie
 * the third standing order is about, and the fix is to not answer: `unknown` gets advice that
 * holds either way. The same conservatism `triage` uses, for the same reason.
 *
 * The limit worth naming: this reads the workspace's own settings files. A rule in `~/.claude`
 * or in an enterprise policy is invisible from here, so a command refused by one of those comes
 * back `unlisted` — which is why the copy for that case says *nothing in .claude/settings.json
 * refuses this* rather than *nothing refuses this*. It states what was actually checked.
 */
export function refusalCause(denial: ToolDenial, policy: Policy): RefusalCause {
  if (denial.tool !== 'Bash' || !denial.detail) return 'unknown'

  // `allow` is dropped on purpose. The CLI already refused this call, so whether some allow
  // rule would have covered it is a question the answer to is "evidently not" — and feeding the
  // list in would let a stale allow rule turn a refusal into a report that it was permitted.
  const verdict = judge(denial.detail, { allow: [], deny: policy.deny })
  return verdict.state === 'denied' ? 'denied' : 'unlisted'
}

/**
 * Where a conversation's controls start.
 *
 * The office opens `acceptEdits` rather than the CLI's own default, because an office whose
 * staff stop at every edit to ask is an office that cannot be watched working — which is the
 * whole point of the floor. `OFFICE_PERMISSION_MODE` overrides it for anyone who disagrees.
 *
 * `OFFICE_PERMISSION_MODE=manual` and `=auto` are **not** honoured, and that is deliberate
 * rather than an oversight — the CLI takes both and ignores them under `--print`, so accepting
 * one would mean reporting a mode the session is not in.
 *
 * This is a starting position, not a policy. The user turns the dial in the chat panel and that
 * choice is remembered per project; nothing here overrides it. And none of it overrides the
 * workspace trust gate — an untrusted workspace has its permission rules ignored whatever is
 * selected. See `src/main/trust.ts`.
 */
export function initialControls(): Controls {
  const requested = process.env['OFFICE_PERMISSION_MODE']

  // `manual` and `auto` are real modes the CLI accepts and then silently resolves to `default`
  // under `--print`, because both need a human to answer a prompt. Honouring one here would
  // reopen the fault the picker just had, through a second door: the office would report the
  // mode it was asked for and run something else. See `IGNORED_UNDER_PRINT`.
  const usable = isPermissionMode(requested) && !isIgnoredUnderPrint(requested)

  return {
    ...DEFAULT_CONTROLS,
    permissionMode: usable ? requested : DEFAULT_PERMISSION_MODE,
  }
}
