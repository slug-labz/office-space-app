/**
 * Running the user's own `claude`.
 *
 * Office Space does not embed an agent runtime, does not implement OAuth, and never handles a
 * credential. It spawns the `claude` the user already installed and already logged into, and
 * renders what comes back — the relationship a terminal emulator has to a shell.
 *
 * That is a deliberate architectural choice, not a shortcut. Anthropic's policy is explicit
 * that third-party products may not offer claude.ai login or route requests through Free, Pro
 * or Max credentials, and it names agents built on the Agent SDK specifically. Spawning the
 * user's own first-party client on their own machine is the position that stays clearly inside
 * that line, and it is what `docs/auth.md` commits us to.
 */

import { argsFor, type Controls } from '../../shared/controls.js'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { StreamParser, type ClaudeEvent } from './stream.js'
import { forgetHere, rememberHere } from '../orphans.js'

export interface RunOptions {
  /** Working directory. This is what scopes the session to a project. */
  readonly cwd: string
  readonly prompt: string
  /**
   * Reuse a specific session id.
   *
   * Passing an id we generated lets a project own its session rather than discovering the id
   * after the fact — which is what makes "a project is a group of sessions" implementable.
   */
  readonly sessionId?: string
  /** Resume an existing conversation by id. Mutually exclusive with `sessionId`. */
  readonly resume?: string
  /**
   * Branch instead of continuing.
   *
   * With `resume`, this loads the whole conversation but writes to a **new** session id,
   * leaving the original untouched. It is what lets us ask an agent a question mid-task
   * without that question becoming part of the work it is doing.
   */
  readonly fork?: boolean
  /**
   * Exact tool list. `[]` means no tools at all — the agent may only answer from context it
   * already has, which is precisely what a read-only aside should be able to do.
   */
  readonly tools?: readonly string[]
  /** Which agent answers. The chat panel runs as `manager`. */
  readonly agent?: string
  /**
   * Which model, how hard it thinks, and what it may do without asking.
   *
   * One object rather than three optional strings, because the three are set together, stored
   * together, and — the part that matters — turned into flags by one tested function. A control
   * shown in the UI and not passed here would be the third standing order broken in the
   * smallest possible way: a picker that says "opus" over a conversation running the default.
   */
  readonly controls?: Controls
  /** Override the binary. Defaults to `claude` on PATH. */
  readonly claudePath?: string
  /**
   * Stream the reply as it is written, rather than delivering it whole.
   *
   * Adds `--include-partial-messages`, which emits `stream_event` records alongside the
   * complete ones. The complete `assistant` event still arrives afterwards and is still the
   * authoritative version — partials are additive, so nothing downstream that ignores them
   * behaves differently.
   */
  readonly partials?: boolean
  /**
   * Extra MCP servers for this run, as paths to JSON config files.
   *
   * The other half of connectors: the survey says what a workspace *declares*, and this is how a
   * project brings its own. VISION §6 is explicit that connectors are how this scales — a
   * stranger gets our seven agents and, without this, no way to reach their database, their
   * tracker or their Slack.
   *
   * Verified working end to end against a purpose-built stdio probe, confirmed from the probe's
   * own log rather than from the model's account of itself, and then not used for weeks.
   */
  readonly mcpConfigs?: readonly string[]
  /**
   * Ignore every MCP server except the ones named above.
   *
   * Off by default, deliberately. The user's own `~/.claude.json` servers are theirs and work in
   * their terminal; silently dropping them because the office passed a project config would be
   * the office taking something away without saying so.
   */
  readonly strictMcp?: boolean
  /**
   * Tools this run may not use, whatever the agent file says.
   *
   * How a session mode is enforced rather than requested. `intake` withholds `Task`, so the
   * manager cannot dispatch — see `shared/session/mode.ts` for why that is state and not a
   * sentence in the prompt.
   *
   * Measured against the installed CLI before anything was built on it: the model searches for
   * the withheld tool, does not find it, and says so. It is variadic, which is exactly why the
   * prompt is pushed after a `--` terminator below.
   */
  readonly disallowedTools?: readonly string[]
  /** Extra flags, escape hatch for anything not modelled here. */
  readonly extraArgs?: readonly string[]
}

export interface RunSummary {
  /** Process exit code. **Not** a success signal on its own — see `isError`. */
  readonly exitCode: number | null
  /**
   * Whether the run actually failed.
   *
   * Taken from the `result` event, not the exit code. An expired token exits 1 *and* reports
   * `is_error: true`; a refusal can exit 0 while still being a failure. The result event is
   * the only honest answer, and its absence is itself a failure (the process died early).
   */
  readonly isError: boolean
  readonly sessionId: string | null
  readonly costUsd: number | null
  /** Anything the process wrote to stderr. Empty on a healthy run. */
  readonly stderr: string
}

export interface RunHandle {
  /** Ask the run to stop. Sends SIGINT, then SIGKILL if it does not exit. */
  interrupt(): void
  /** Stop it now, and everything it started. For quit, where there is no time to be polite. */
  kill(): void
  readonly done: Promise<RunSummary>
}

export function buildArgs(options: RunOptions): string[] {
  const args = ['--print', '--output-format', 'stream-json', '--verbose']

  // `--verbose` is not optional decoration: without it the CLI collapses the stream to a
  // single result event, and the office floor has nothing to render.

  if (options.resume) {
    args.push('--resume', options.resume)
    if (options.fork) args.push('--fork-session')
  } else if (options.sessionId) {
    args.push('--session-id', options.sessionId)
  }

  if (options.tools) args.push('--tools', ...(options.tools.length ? options.tools : ['']))
  if (options.agent) args.push('--agent', options.agent)
  if (options.mcpConfigs?.length) args.push('--mcp-config', ...options.mcpConfigs)
  // Only meaningful alongside a config, and dangerous alone: on its own it would drop every
  // server the user has and give nothing back.
  if (options.strictMcp && options.mcpConfigs?.length) args.push('--strict-mcp-config')
  if (options.disallowedTools?.length) args.push('--disallowedTools', ...options.disallowedTools)
  if (options.partials) args.push('--include-partial-messages')
  if (options.controls) args.push(...argsFor(options.controls))
  if (options.extraArgs?.length) args.push(...options.extraArgs)

  // `--` ends the options, and it is load-bearing rather than tidy.
  //
  // Several of the flags above are **variadic** — `--tools`, `--mcp-config`, and anything a
  // caller puts in `extraArgs` — and a variadic flag keeps eating positionals until it meets
  // another flag. With the prompt pushed straight after one, the prompt *is* eaten: measured
  // against the installed CLI, which then exits with "Input must be provided either through
  // stdin or as a prompt argument". The office would have spawned a run with no request in it.
  //
  // Latent rather than live when this was written — nothing in the app sets `tools` or
  // `mcpConfigs` yet, and `--agent` happens to sit after `--tools` and terminate it. It stops
  // being latent the moment anybody uses one, which is why it is fixed before the first user
  // rather than after.
  //
  // It also makes a prompt beginning with `-` a prompt rather than an unrecognised flag.
  args.push('--', options.prompt)
  return args
}

/**
 * How long to keep draining stdout after `claude` has exited.
 *
 * Only ever spent when a descendant is holding the pipes open, because otherwise `'close'` has
 * already settled the run — measured at 36–50ms after exit against the real CLI, so this is
 * roughly forty times the drain it is covering for. Long enough that no legitimate output is
 * cut off, short enough that nothing on screen claims to be running for meaningfully longer
 * than it was.
 */
const DRAIN_GRACE_MS = 2000

/**
 * Start a run.
 *
 * Events arrive through `onEvent` as they are parsed. The returned promise resolves when the
 * process exits — it does **not** reject on a failed run, because "the agent could not
 * authenticate" is a result to render, not an exception to throw. It rejects only when the
 * process could not be started at all.
 */
export function runClaude(
  options: RunOptions,
  onEvent: (event: ClaudeEvent) => void,
): RunHandle {
  const parser = new StreamParser()
  // stdin is 'ignore' — the prompt is an argv entry, and leaving stdin open makes a run
  // hang forever waiting for input that never comes.
  let child: ChildProcessByStdio<null, Readable, Readable>
  let sessionId: string | null = options.resume ?? options.sessionId ?? null
  let isError = true // until a result says otherwise; a run that dies early has failed
  let sawResult = false
  let costUsd: number | null = null
  let stderr = ''
  let killTimer: NodeJS.Timeout | null = null
  let drainTimer: NodeJS.Timeout | null = null
  let settled = false

  const emit = (event: ClaudeEvent) => {
    if (event.kind === 'init' && event.sessionId) sessionId = event.sessionId
    if (event.kind === 'result') {
      sawResult = true
      isError = event.isError
      costUsd = event.costUsd
    }
    onEvent(event)
  }

  const done = new Promise<RunSummary>((resolve, reject) => {
    try {
      child = spawn(options.claudePath ?? 'claude', buildArgs(options), {
        cwd: options.cwd,
        // Inherit the environment. The user's PATH, HOME and credential location all live
        // there, and replacing it wholesale is how a spawned CLI mysteriously stops being
        // logged in.
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Its own process group, so `kill()` can signal the whole tree. `claude` spawns tools of
        // its own, and signalling only the parent leaves those running — which is exactly the
        // bug CI found in `verify.ts`, where the harness reported a kill it had not performed.
        detached: true,
      })
    } catch (err) {
      reject(err)
      return
    }

    /*
     * On disk, now, because the process that knows what it started is the one that dies.
     *
     * `children.ts` closes this door for a clean quit and cannot close it for a crash:
     * `before-quit` does not run, and `detached: true` above — which `kill()` needs so it can
     * signal claude's own tools as a group — is also what stops the kernel taking this child
     * down with its parent. Measured, agent mid-answer: `SIGKILL` the Electron main and the
     * child is alive twenty seconds later, reparented to init, still spending the allowance
     * with nothing on screen to show it. The next office to start reads this file and kills it.
     *
     * Here rather than at the call sites because all four of them reach this line, and three of
     * them had already forgotten to register with `children.ts`.
     */
    const recorded = child.pid
    if (recorded !== undefined) {
      rememberHere(recorded, `claude (${(options.sessionId ?? options.resume ?? String(recorded)).slice(0, 8)})`)
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      for (const event of parser.push(chunk)) emit(event)
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', reject)

    /**
     * The run is over. Called once, from whichever of the two events below gets here first.
     *
     * `cut` when it is the drain that ran out: `claude` had exited, its pipes were still open, and
     * this adapter stopped reading them.
     */
    const settle = (exitCode: number | null, cut = false) => {
      if (settled) return
      settled = true
      if (killTimer) clearTimeout(killTimer)
      if (drainTimer) clearTimeout(drainTimer)
      // Before anything that can throw. An entry left behind is a pid this app would consider
      // killing on its next launch, and by then the number may belong to somebody else.
      if (recorded !== undefined) forgetHere(recorded)
      // Flush a final unterminated line — the most useful evidence when a run is killed.
      for (const event of parser.end()) emit(event)

      if (!sawResult) {
        // No result event means the process died before finishing. Say so explicitly rather
        // than letting a silent exit read as a clean one.
        //
        // Unless the drain ran out. Then the office stopped reading pipes that were still open,
        // and "before reporting a result" would blame `claude` for a read the office cut short.
        // The cut goes first because the activity strip shows only the first line.
        const said = stderr.trim()
        const text = cut
          ? `claude exited with code ${exitCode}, but its output was still open ${DRAIN_GRACE_MS}ms ` +
            `later, so the office stopped reading before any result arrived` +
            (said ? `\n${said}` : '')
          : said || `claude exited with code ${exitCode} before reporting a result`
        emit({
          kind: 'result',
          // A process that died before finishing refused nothing; it never got that far.
          denials: [],
          isError: true,
          text,
          costUsd: null,
          turns: null,
          durationMs: null,
        })
      }

      resolve({ exitCode, isError, sessionId, costUsd, stderr })
    }

    /*
     * `'close'` is the normal path and stays the preferred one: it is the moment the pipes are
     * drained, so settling there is what guarantees the last line of stdout is parsed before
     * anybody is told the run finished.
     *
     * But `'close'` is not "the process exited". Node fires it when the process has ended *and*
     * its stdio streams are closed, and those are different moments whenever something else
     * holds the write end. `claude` is spawned `detached` with stdout and stderr piped, so a
     * descendant that inherited those two descriptors keeps this promise pending after `claude`
     * itself is gone — and `session.ts` nulls `this.running` in a `finally` driven by it, which
     * `describeSession` reads as `phase === 'running'`. The visible failure is not a leak, it is
     * a campus card that says an agent is busy when there is no process left to be busy.
     *
     * Measured against the CLI at 2.1.266, by pid and by descriptor, on 2026-09-15: a process an
     * agent backgrounds through the Bash tool can outlive `claude` — it was still running when
     * `claude` exited — but its stdout and stderr are the tool's own output file, not `claude`'s,
     * and `'close'` followed `'exit'` by 3ms. The same through `run_in_background` was gone by the
     * time `claude` exited, and so was a hung MCP stdio server, which held sockets of its own
     * rather than `claude`'s. None of the routes measured reach this. This is not a bug that has
     * been seen. It is the adapter declining to rest a UI invariant on the stdio habits of a
     * program it does not own, given `claudePath` can name any program at all.
     *
     * Corrected 2026-09-14: this first said 2.1.259. That was a `claude --version` taken twenty
     * seconds before the binary at the same path was upgraded in place; the runs came after, and
     * each one's own transcript is stamped 2.1.266. A version belongs to the run it describes,
     * not to a check made before it.
     *
     * Corrected 2026-09-15: the "Measured against the CLI" paragraph used to imply those children
     * were still running when `claude` exited, and said `claude` hands them private socketpairs.
     * Neither had been measured. Liveness was a `grep -c` over `ps` output, which also matched the
     * harness's own command lines and read 2 with nothing alive; and a socketpair is what Node's
     * own piped stdio is, so the type distinguished nothing. That paragraph now reports the
     * re-measurement: `kill -0` on the child's pid at both events, and its descriptors' addresses
     * against `claude`'s fds 1 and 2.
     *
     * So: keep waiting for the drain, but only for a bounded time after the process is known to
     * be gone. Nothing is lost in the normal case, because in the normal case `'close'` has
     * already fired long before the timer.
     */
    child.on('exit', (exitCode) => {
      drainTimer = setTimeout(() => {
        // Stop reading before settling. `claude` has exited, so nothing further on these pipes
        // is its output; letting it through would emit events into a turn that has ended.
        child.stdout.destroy()
        child.stderr.destroy()
        settle(exitCode, true)
      }, DRAIN_GRACE_MS)
    })

    child.on('close', (exitCode) => settle(exitCode))
  })

  return {
    interrupt() {
      if (!child || child.exitCode !== null) return
      child.kill('SIGINT')
      // A run mid-tool-call does not always honour SIGINT. Escalate rather than hang.
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 3000)
    },
      /**
       * Stop now, without the polite phase.
       *
       * For quit, where there is no time to wait three seconds per child and nothing left to
       * render a graceful shutdown into. `claude` spawns tools of its own, so this signals the
       * **process group** — the same lesson `verify.ts` learned when CI found that killing the
       * shell left `sleep 5` running on Linux while the harness reported it killed.
       */
      kill() {
        if (!child || child.exitCode !== null) return
        if (killTimer) clearTimeout(killTimer)
        const pid = child.pid
        try {
          if (pid !== undefined) process.kill(-pid, 'SIGKILL')
          else child.kill('SIGKILL')
        } catch {
          try {
            child.kill('SIGKILL')
          } catch {
            // Already gone between the check and the signal.
          }
        }
      },
    done,
  }
}
