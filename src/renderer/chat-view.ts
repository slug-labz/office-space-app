/**
 * The transcript.
 *
 * This panel is not a summary of the manager's session, or a friendlier rendering of it. It is
 * that session, shown — the gateway to the conversation rather than a report about it. So tool
 * calls appear, results appear, failures appear verbatim, and nothing is quietly tidied away
 * because it would look neater without it. If the office did it, it is in here.
 *
 * Every string that came from Claude or from a tool is written with `textContent`. An agent
 * that prints a `<script>` tag renders as the characters of a script tag, in an app that can
 * start processes with your credentials.
 */

import { isDelegationTool } from '../shared/delegation.js'
import { Ledger } from './views/steps.js'
import { refusalBlock } from './views/refusal.js'
import { summariseRefusals } from '../shared/refusals.js'
import { AskQueue } from '../shared/transcript/ask.js'
import { planWarning } from '../shared/plan-usage.js'
import { stripOfficeContext } from '../shared/office-context.js'
import type { TimelineEntry } from '../shared/transcript/parse.js'
import { renderMarkdown } from './markdown.js'
import type { ClaudeEvent, StreamBlock } from '../main/claude/stream.js'
import { avatar, type AvatarSource } from './views/avatar.js'
import { truncate } from '../shared/truncate.js'

/** How much of a tool result to show before it stops being informative and starts being wall. */
const RESULT_CLAMP = 600

/**
 * How many turns stay in the DOM.
 *
 * **Measured, not guessed.** Appending one message to a transcript and pinning the scroll costs,
 * in the dev harness on this machine:
 *
 * | turns in the DOM | cost of one more |
 * |---|---|
 * | 208 | **6.4 ms** |
 * | 408 | 14.7 ms |
 * | 808 | 32.4 ms |
 * | 5,638 | **340 ms** |
 *
 * Linear in the number of children, and 340 ms is *per message* — a streaming reply drops frames
 * on every chunk. The cost is the layout of a flex column with thousands of children, which the
 * browser must redo to know where the bottom is.
 *
 * Two cheaper-looking fixes were tried first and neither moved the number: reading `scrollHeight`
 * *before* the mutation rather than after (274 ms vs 315 ms — noise), and `content-visibility:
 * auto` on every turn (264 ms). Both attack the forced *read*; the cost is the layout itself,
 * and scrolling to the bottom forces it regardless.
 *
 * So the fix is the one the plan named: keep fewer children. 300 holds a long session's recent
 * history at the cost a short session pays.
 */
const WINDOW = 300

/**
 * How many trimmed turns come back at once when you ask for them.
 *
 * Smaller than the window on purpose. Restoring everything would put the transcript straight
 * back into the state the window exists to avoid, and somebody looking for one message they
 * remember does not need all four thousand.
 */
const RESTORE_BATCH = 200

/**
 * Whether a `system` event is one a person should be told about.
 *
 * `toEvent` never drops a record it does not recognise — it returns
 * `{ kind: 'system', subtype: 'unknown', raw }` and keeps the whole thing. Nothing consumed it:
 * every `system` event fell through the transcript's `default`, so the parser refused to swallow
 * an unfamiliar format and the transcript swallowed it one function later.
 *
 * `stream.ts` opens by naming that exact failure — *"a feed that quietly swallows what it cannot
 * read is a feed that lies about what happened."* It held for a line that would not parse, and
 * not for a line that parsed into something unfamiliar, which is the shape a CLI format change
 * actually arrives in.
 *
 * Only the unknowns. `init` is read elsewhere, and the `stream_event/*` deltas arrive several
 * times a second — announcing those would put back the log clutter this panel was cut to remove.
 */
export function announcesItself(subtype: string): boolean {
  return subtype === 'unknown' || subtype.endsWith('/unknown')
}

export class ChatView {
  /** Tool cards awaiting their result, by `tool_use` id. */
  private readonly pending = new Map<string, HTMLElement>()
  /** The assistant paragraph currently being appended to, so streamed text does not fragment. */
  private streaming: HTMLElement | null = null
  /**
   * The paragraph a reply is currently being written into, fragment by fragment.
   *
   * Separate from {@link streaming} because the two mean different things and conflating them
   * is how the text ends up doubled: `streaming` is "the last thing appended was a text block,
   * so append the next one to it", while this is "a reply is *mid-flight* and the complete
   * version has not arrived yet". When it does arrive it carries the whole text again, so the
   * complete event **replaces** what is here rather than adding to it.
   */
  private partial: HTMLElement | null = null
  /** Which content block `partial` belongs to. Two blocks in one message must not merge. */
  private partialIndex: number | null = null
  /**
   * Turns taken out of the DOM to keep it fast. Kept, never discarded.
   *
   * This is the whole honesty condition on windowing. The panel's promise is that it shows the
   * session rather than a tidied account of it, and silently dropping the first four thousand
   * messages would break that promise in exactly the way that is hardest to notice — the
   * transcript would look complete. They are held as live elements, so restoring one is a
   * re-attach rather than a re-render, and the button above them says how many there are.
   */
  private readonly trimmed: HTMLElement[] = []
  /** The "N earlier messages" button, while there are any. Always the first child. */
  private earlier: HTMLButtonElement | null = null
  /**
   * The questions this conversation has been asked, and which of them is open.
   *
   * One per panel rather than one per app: a question in this project's chat must not sit behind
   * an unanswered question in another project's, which is exactly what a module-level queue
   * would do. Never emptied — it is the record of what was asked and answered here.
   */
  private readonly asks = new AskQueue()

  constructor(
    private readonly root: HTMLElement,
    private readonly emptyState: HTMLElement,
    /**
     * Where a speaker's face comes from, or nothing.
     *
     * Optional so the transcript still works with no art at all — a test, or a workspace whose
     * theme failed to load. The conversation is the record; the picture is an improvement to it
     * and must never be a precondition for showing what was said.
     */
    private readonly art?: AvatarSource,
    /**
     * What a click on a mark opens: the steps that turn actually ran.
     *
     * Defaulted to a no-op so the panel is still constructible with no host — but a mark that
     * opens nothing is the audit trail deleted with extra steps, so the real caller supplies
     * this and `test/chat-record.test.ts` asserts a turn that did something has exactly one.
     */
    private readonly onSteps: (ledger: Ledger) => void = () => {},
    /** What a click on a handoff opens: that employee, and their own record of the work. */
    private readonly onEmployee: (who: string) => void = () => {},
  ) {}

  /** What this turn has done. Emptied when a turn ends, not when one begins. */
  private ledger = new Ledger()
  /** The mark on the current turn, created on the first step and updated after that. */
  private mark: HTMLElement | null = null
  /**
   * Which employee a dispatch went to, by `tool_use` id.
   *
   * This is what makes the panel a group chat rather than a monologue. An employee's streamed
   * text carries `parentToolUseId` and nothing else — no name — so the only way to know *who is
   * speaking* is to have watched the dispatch that started them.
   */
  private readonly dispatchedTo = new Map<string, string>()
  /** The turn an employee is currently speaking into, so their words do not fragment. */
  private readonly employeeTurns = new Map<string, HTMLElement>()

  /** Something you said. */
  you(text: string): void {
    this.reset()
    const turn = block('turn turn--you', 'You')
    // **Plain, not markdown.** What you typed is what you see. Running your own words through a
    // markdown renderer means a pasted JSON blob comes back with its asterisks eaten and its
    // underscores italicised — the panel quietly editing your message on the way in. Markdown
    // is for what the model wrote, because the model writes markdown on purpose.
    turn.appendChild(body(text, false))
    this.append(turn)
  }

  /**
   * A slash command you ran.
   *
   * Its own shape rather than `you()`, because a command is not something you said — it is
   * something you invoked, and the CLI expands one into a whole prompt nobody typed. Showing
   * `/state` as a line of speech would attribute several hundred words to six characters.
   */
  command(name: string, args: string): void {
    this.streaming = null
    const turn = block('turn turn--command', 'You')
    const el = document.createElement('p')
    // `turn__command` was here too. Nothing styled it and nothing queried it — the rules beside
    // it are `.turn__command-name` and `.turn__command-args`, which are their own classes rather
    // than descendants, so the marker had never done anything.
    el.className = 'turn__body'

    const slug = document.createElement('span')
    slug.className = 'turn__command-name'
    slug.textContent = `/${name}`
    el.appendChild(slug)

    if (args) {
      el.appendChild(document.createTextNode(' '))
      const rest = document.createElement('span')
      rest.className = 'turn__command-args'
      rest.textContent = args
      el.appendChild(rest)
    }

    turn.appendChild(el)
    this.append(turn)
  }

  /**
   * Put a saved conversation back on screen.
   *
   * Rendered through the same builders as a live turn, so a restored session looks like the
   * session it is rather than like a quotation of one. A tool call that never settled stays
   * unsettled here — it was still running when the app was closed, and showing it as finished
   * would be inventing an ending.
   */
  replay(entries: readonly TimelineEntry[], speaker: string): void {
    for (const entry of entries) {
      switch (entry.kind) {
        case 'user':
          // What you said, not the roster the office put in front of it. Otherwise a restored
          // conversation opens with several hundred words attributed to you.
          this.you(stripOfficeContext(entry.text))
          break

        // Added after this switch was found to have no case for it at all, two commits after
        // `parse.ts` learned to emit one. A `/state` in a saved conversation rendered as
        // nothing — the parser produced the entry, the replay matched no case, and it was
        // dropped in silence. Absent is not empty, including in our own transcript.
        case 'command':
          this.command(entry.name, entry.args)
          break

        case 'assistant': {
          this.streaming = null
          const turn = block('turn', speaker, this.art, this.art?.manager())
          // Through the same queue as a live turn. A reopened conversation whose last reply
          // carried three questions must not open with three cards stacked, or the enforcement
          // would hold only for people who watched it arrive.
          turn.appendChild(body(entry.text, true, this.asks))
          this.append(turn)
          break
        }

        // Thinking is not shown in a live turn either. Skipped here for the same reason, and
        // not silently: `parseTranscript` counts it, and the office is not claiming otherwise.
        case 'thinking':
          break

        /**
         * A restored conversation follows exactly the same rules as a live one.
         *
         * This branch used to draw tool cards, and leaving it that way would have been the
         * subtler half of the bug: reopen yesterday's conversation and it looks like a different
         * product from the one you were using this morning. A record that renders differently
         * depending on whether you watched it happen is not a record.
         */
        case 'tool': {
          this.streaming = null
          const argument = summarise(entry.name, entry.input)

          if (isDelegationTool(entry.name)) {
            this.append(this.handoff(String(entry.input?.['subagent_type'] ?? '').trim(), argument))
            break
          }

          this.step(undefined, entry.name, argument)
          // `settled: false` means it was in flight when the office closed. **Unknown, not
          // failed** — a saved transcript can never gain the result, and calling that a failure
          // would turn a reopened conversation red for a command that may well have succeeded.
          this.ledger.settle(
            undefined,
            entry.settled ? (entry.isError ? 'failed' : 'ok') : 'unknown',
            entry.settled
              ? clamp(entry.result ?? '') || (entry.isError ? 'failed' : 'done')
              : 'still running when the office was closed — the result was never written',
          )
          if (this.mark) paintMark(this.mark, this.ledger)
          break
        }

        case 'unreadable':
          this.notice(`Unreadable line in the saved transcript: ${entry.raw}`)
          break

        // Exhaustiveness, so the next entry kind added to `parse.ts` fails the typecheck here
        // rather than disappearing at runtime. This is the guard whose absence let a whole
        // entry kind go unrendered without anything erroring.
        default:
          assertNever(entry)
      }
    }
    this.streaming = null
  }

  /**
   * A line of prose in the transcript that nobody said.
   *
   * **It does not end the turn.** It used to: `reset()` was the first statement here, so every
   * notice cleared the streaming pointer, dropped the turn's `Ledger` and unhooked its mark. That
   * is right for exactly one of the eleven callers — `case 'result'`, which is the turn ending —
   * and that caller already calls `reset()` itself on the line above, so the effect there was to
   * do it twice.
   *
   * Everywhere else it was damage. `case 'retry'` and `case 'rate-limit'` both fire **mid-turn**:
   * a turn that retried lost its ledger, so the mark stopped counting the steps that turn ran and
   * a later failure could no longer turn it red. Nothing errored; the number simply stopped being
   * about the turn. `setPhase` calls it for a session error, and the renderer-wide mishap surface
   * added in 88b9116 can call it at any instant at all, which is what made this worth chasing.
   *
   * `office-space-6c`, reading `case 'result'`: *"the one caller that legitimately ends a turn
   * already resets explicitly, before calling notice"* — so this is a deletion rather than a
   * second method somebody could call by mistake, and the reset stays attributable to the event
   * that means it.
   *
   * Placement is the end of the transcript, always. A notice raised while a reply is streaming
   * lands after the partial, and stays there: the partial is an element already in the list and
   * grows in place rather than moving, so the explanation stays next to what it interrupted.
   */
  notice(text: string): void {
    const el = document.createElement('div')
    el.className = 'notice'
    el.textContent = text
    this.append(el)
  }

  event(event: ClaudeEvent, speaker: string): void {
    switch (event.kind) {
      case 'assistant':
        for (const b of event.blocks) this.assistantBlock(b, speaker)
        return

      /**
       * A fragment of a reply still being written.
       *
       * Shown, because a transcript is a record of what was said and watching it arrive is the
       * difference between a conversation and a progress bar. **Not** passed to the floor —
       * `factsFromEvent` does not match this kind, which is the whole reason it is a kind and
       * not a flag on `assistant`.
       */
      case 'partial': {
        // Thinking is not rendered in a live turn or in a replay, so it is not rendered here
        // either. Skipped consistently rather than in one path and not the other.
        if (event.of !== 'text' || !event.text) return
        // An employee's fragments are not the manager's voice — they are **their own**, and
        // this is the line that turns the panel from a monologue into the group chat the brief
        // asked for: different agents reading as different voices when they talk, rather than
        // one stream. The fragment carries only a parent id, so the name comes from having watched
        // the dispatch that started them; a fragment whose dispatch we never saw is still
        // skipped, because a turn with nobody's name on it is worse than one that is absent.
        if (event.parentToolUseId) {
          const who = this.dispatchedTo.get(event.parentToolUseId)
          if (who) this.employeeSaid(who, event.text)
          return
        }

        if (this.partial === null || this.partialIndex !== event.index) {
          const turn = block('turn', speaker, this.art, this.art?.manager())
          const p = body('')
          turn.appendChild(p)
          this.append(turn)
          this.partial = p
          this.partialIndex = event.index
        }
        this.partial.textContent = `${this.partial.textContent ?? ''}${event.text}`
        return
      }

      // The block finished. The element stays — the complete `assistant` event is still to
      // come and will replace its text with the authoritative version.
      case 'partial-end':
        return

      case 'user':
        for (const b of event.blocks) {
          if (b.type === 'tool_result' && b.tool_use_id) this.result(b)
        }
        return

      case 'result': {
        this.reset()
        if (event.isError && event.text) this.notice(event.text)

        // Why nothing happened.
        //
        // `--print` cannot stop and ask, so a call the workspace has not authorised is simply
        // refused and the agent finds out by being told no. Until now so did nobody else: the
        // run looked like it had finished, and the thing you asked for had not been done. This
        // is the buildable half of an approval prompt — after the fact rather than before it,
        // but it answers the question the prompt was actually wanted for.
        //
        // **One block per turn, not one paragraph per refusal.** U6 was nineteen of these in a
        // row, each repeating the same two sentences around a different giant command string.
        // The shape of the problem is stated once, every distinct command is still shown, and
        // the advice is the one for the cause — see `summariseRefusals`. When a settings file
        // could not be used, `unusable` names it, and the advice is about that file instead. When
        // one was used with an entry in its deny list that is not a rule, `shortDeny` names it,
        // and the advice says the office is asking about everything rather than naming a rule
        // that would stop it.
        const refused = summariseRefusals(event.denials, event.unusable, event.shortDeny)
        if (refused) this.append(refusalBlock(refused))
        return
      }

      /**
       * How much of the plan is left.
       *
       * Arrives on **every** run, and is deliberately almost always silent — `planWarning`
       * returns null below the threshold. The two states worth interrupting for are running out
       * and out; anything else is a number nobody asked for, and an office that reports it every
       * time will be ignored on the run where it mattered.
       */
      case 'rate-limit': {
        const warning = planWarning(event, Date.now())
        if (warning) this.notice(warning)
        return
      }

      case 'retry':
        this.notice(
          `Retrying after ${event.status ?? 'an error'}${event.error ? ` — ${event.error}` : ''} (attempt ${event.attempt}).`,
        )
        return

      /*
       * A line the parser could not read is evidence, not noise. Dropping it is how a UI
       * silently stops reflecting a CLI that has moved on.
       *
       * The reason leads, and the line follows. `stream.ts` computes exactly two — a parser
       * error, or *"not a JSON object"* — and they are different problems with different
       * owners: the first is malformed JSON, which usually means chunking; the second is valid
       * JSON of a shape this app does not know, which usually means the CLI's format moved.
       *
       * Only the line was shown, so somebody reading a wall of truncated JSON had to work out
       * which of those they were looking at. The reason was computed and dropped one function
       * later.
       */
      case 'unparsed':
        this.notice(`Unreadable line from claude — ${event.reason}: ${event.line}`)
        return

      /*
       * An event shape this app does not know.
       *
       * `toEvent` is careful here: anything unrecognised comes back as
       * `{ kind: 'system', subtype: 'unknown', raw }` rather than being dropped, and it keeps the
       * whole record. Nothing consumed it. Every `system` event fell into the `default` below —
       * so the parser refused to swallow a format it did not recognise, and the transcript
       * swallowed it one function later.
       *
       * That is the failure `stream.ts` opens by describing: *"a feed that quietly swallows what
       * it cannot read is a feed that lies about what happened."* It held for a line that would
       * not parse and not for a line that parsed into something unfamiliar, which is the shape a
       * CLI format change actually arrives in.
       *
       * Only `unknown`. The other subtypes are `init`, which the office reads elsewhere, and the
       * `stream_event/*` deltas, which arrive several times a second — announcing those would be
       * the log clutter this panel was cut back to avoid.
       */
      case 'system':
        if (announcesItself(event.subtype)) {
          this.notice(`A message from claude this version does not recognise: ${JSON.stringify(event.raw).slice(0, 300)}`)
        }
        return

      default:
        return
    }
  }

  /** Nothing is mid-flight any more. Both cursors go together, or a fragment outlives its turn. */
  private reset(): void {
    this.streaming = null
    this.partial = null
    this.partialIndex = null
    // The ledger and its mark go with them, and that is what makes a mark mean *what this turn
    // did* rather than *what the office has ever done* — a running total would be a number
    // nobody could act on. The mark element stays on the page holding its final count; only the
    // pointer to it is dropped.
    this.ledger = new Ledger()
    this.mark = null
    this.employeeTurns.clear()
  }

  /**
   * An employee, speaking.
   *
   * Their words accumulate into one turn per employee per manager-turn rather than a block per
   * fragment — the same reason the manager's text does, and the same failure if it does not: a
   * reply arriving in eleven pieces reads as eleven people saying one word each.
   */
  private employeeSaid(who: string, text: string): void {
    let turn = this.employeeTurns.get(who)
    if (!turn) {
      turn = block('turn turn--employee', who, this.art, who)
      turn.appendChild(body(''))
      this.employeeTurns.set(who, this.append(turn))
    }
    const said = turn.querySelector<HTMLElement>('.turn__body')
    if (said) appendTo(said, text, this.asks)
    this.scroll()
  }

  private assistantBlock(b: StreamBlock, speaker: string): void {
    if (b.type === 'text' && b.text) {
      // The authoritative version of something we already streamed. **Replace, never append** —
      // the complete event carries the whole text, so appending it to the fragments that
      // built it prints the reply twice. Replacing also means the final state is the CLI's
      // text rather than our reassembly of it, which is the version to trust if the two
      // ever disagree.
      if (this.partial) {
        // **Rendered, not assigned.** This line used to be `textContent = b.text`, which was
        // right when it was written and stopped being right the day the panel learned markdown:
        // fragments stream in as plain text and the complete event was replacing them with more
        // plain text, so a *streamed* reply — which is every reply, `partials` is on — never
        // got markdown at all, and an `ask` block never became a card. The bug was invisible
        // because the code path that does render one is the one partials skip.
        render(this.partial, b.text, this.asks)
        this.streaming = this.partial
        this.partial = null
        this.partialIndex = null
        return
      }
      if (this.streaming) {
        appendTo(this.streaming, b.text, this.asks)
      } else {
        const turn = block('turn', speaker, this.art, this.art?.manager())
        const p = body(b.text, true, this.asks)
        turn.appendChild(p)
        this.streaming = p
        this.append(turn)
      }
      return
    }

    if (b.type !== 'tool_use' || !b.name) return
    this.streaming = null

    const argument = summarise(b.name, b.input)

    // A handoff is conversation. Everything else is mechanism.
    //
    // The line between them is not "how interesting is this" — it is **who it is about.** A
    // dispatch is the manager telling you it has put somebody on the job: a thing a manager
    // says out loud, and the one tool call that changes the room. A file read is the office
    // working, which is what the floor is for.
    if (isDelegationTool(b.name)) {
      const who = String(b.input?.['subagent_type'] ?? b.input?.['agent'] ?? '').trim()
      if (b.id && who) this.dispatchedTo.set(b.id, who)
      this.append(this.handoff(who, argument))
      return
    }

    this.step(b.id, b.name, argument)
  }

  /**
   * Record a step, and make sure this turn is wearing its mark.
   *
   * The mark is created lazily, on the first step, so a turn that only talked has nothing
   * hanging off it — which is the common case, and the one the panel is being cleaned up for.
   */
  private step(id: string | undefined, tool: string, argument: string): void {
    this.ledger.add(id, tool, argument)
    if (!this.mark) this.mark = this.append(markFor(this.ledger, this.onSteps))
    paintMark(this.mark, this.ledger)
  }

  /**
   * One line: an arrow, a face, a name, the job.
   *
   * Clickable, and that click is the guarantee at its most direct — what is behind a handoff is
   * that employee's **own record**, which is a different and more trustworthy thing than the
   * manager's account of it.
   */
  private handoff(who: string, what: string): HTMLElement {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'handoff'

    const arrow = document.createElement('span')
    arrow.className = 'handoff__arrow'
    arrow.textContent = '\u2192'
    el.appendChild(arrow)

    // The same face as at their desk, from the module that already decodes it once. Building a
    // second avatar here would be the exact mistake laptop 1's F1c commit exists to avoid.
    if (this.art && who) el.appendChild(avatar(who, 16, this.art))

    const name = document.createElement('span')
    name.className = 'handoff__who'
    name.textContent = who || 'an employee'
    el.appendChild(name)

    const task = document.createElement('span')
    task.className = 'handoff__what'
    task.textContent = what
    el.appendChild(task)

    if (who) el.addEventListener('click', () => this.onEmployee(who))
    return el
  }

  /**
   * A result. Recorded, never drawn.
   *
   * This is the method that used to put a wall of tool output in the middle of a conversation.
   * The output has not stopped existing — it is in the ledger, behind the mark — and the only
   * part of it that now reaches the panel is the mark's colour changing when something fails,
   * which is the one bit of a result that is genuinely news.
   */
  private result(b: StreamBlock): void {
    this.ledger.settle(b.tool_use_id, b.is_error ? 'failed' : 'ok', clamp(flatten(b.content)))
    if (!this.mark) this.mark = this.append(markFor(this.ledger, this.onSteps))
    paintMark(this.mark, this.ledger)
  }

  private append<T extends HTMLElement>(el: T): T {
    this.emptyState.hidden = true
    this.root.appendChild(el)
    this.trim()
    this.scroll()
    return el
  }

  /**
   * Keep the DOM within {@link WINDOW}, moving what comes off the top into `trimmed`.
   *
   * Never touches a card that is still waiting for its result: a tool call whose result arrives
   * after its card has been detached would append the output into an element that is no longer
   * on screen, and the result would simply never appear. In practice a pending call is always
   * within a few turns of the bottom, so this costs nothing — but "in practice" is not a reason
   * to leave the hole open.
   */
  private trim(): void {
    // What must not be detached while it is still being written to.
    //
    // This used to be the pending tool cards, and the reason was exact: a result arriving after
    // its card had been detached would append output into an element nobody could see. F1c
    // removed the cards — the mechanism lives in `views/record.ts` now — so `pending` is empty
    // and that hole is closed by there being nothing to put in it.
    //
    // **The same hole reopened in a new shape, though, and it is the mark.** A mark is created
    // on a turn's first step and repainted on every step and result after it. A single turn that
    // appends more than `WINDOW` elements — many handoffs, a long reply — would trim its own
    // mark off the top and then keep painting a detached node: the count would stop moving, a
    // failure would stop turning it red, and nothing would report it. Rare, silent, and exactly
    // the class of bug the comment below was written about.
    const live = new Set<HTMLElement>(this.pending.values())
    if (this.mark) live.add(this.mark)

    // Count turns, not children, and start below the button.
    //
    // The first draft did neither, and the failure was worth writing down: `showEarlier()`
    // prepends the button, so the button became `firstElementChild`, so the next trim hit it,
    // broke out of the loop, and windowing stopped after exactly one trim. Nothing looked
    // wrong — no error, no warning — the transcript simply grew to six thousand children again
    // and got slow, which is the state this whole feature exists to prevent. Found by measuring
    // the fix rather than by trusting it.
    while (this.turnCount() > WINDOW) {
      const first = this.earlier ? this.earlier.nextElementSibling : this.root.firstElementChild
      if (!(first instanceof HTMLElement) || live.has(first)) break
      first.remove()
      this.trimmed.push(first)
    }

    this.showEarlier()
  }

  /** Children that are actually turns. The "earlier" button is chrome and does not count. */
  private turnCount(): number {
    return this.root.children.length - (this.earlier?.isConnected ? 1 : 0)
  }

  /** The button that says how many turns are off screen, and brings some back. */
  private showEarlier(): void {
    if (this.trimmed.length === 0) {
      this.earlier?.remove()
      this.earlier = null
      return
    }

    if (!this.earlier) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'earlier mono'
      button.addEventListener('click', () => this.restore())
      this.earlier = button
    }

    const count = this.trimmed.length
    this.earlier.textContent =
      count === 1 ? '1 earlier message — show it' : `${count} earlier messages — show ${Math.min(count, RESTORE_BATCH)}`
    // Always the first child — but only moved when it is not already there. `prepend` on every
    // append would be a DOM mutation per message for no change.
    if (this.root.firstElementChild !== this.earlier) this.root.prepend(this.earlier)
  }

  /**
   * Put the most recently trimmed turns back, above what is on screen.
   *
   * The scroll position is held by hand across the insertion. Without it the browser keeps
   * `scrollTop` where it was while the content above it grows, so the view jumps backwards by
   * the height of everything just inserted — which lands you somewhere you were not reading.
   */
  private restore(): void {
    const before = this.root.scrollHeight
    const at = this.root.scrollTop

    // The tail of the array is what was trimmed most recently, so it is what goes back first —
    // and it goes back in the order it left, which `splice` already gives us.
    const batch = this.trimmed.splice(Math.max(0, this.trimmed.length - RESTORE_BATCH))
    const fragment = document.createDocumentFragment()
    for (const turn of batch) fragment.appendChild(turn)

    this.showEarlier()
    // Under the button, which stays at the top for whatever is still trimmed.
    if (this.earlier) this.earlier.after(fragment)
    else this.root.prepend(fragment)

    this.root.scrollTop = at + (this.root.scrollHeight - before)
  }

  private scroll(): void {
    // Only follow along if you were already at the bottom — yanking the view down while
    // someone is reading back through a long run is infuriating.
    const nearBottom = this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight < 120
    if (nearBottom) this.root.scrollTop = this.root.scrollHeight
  }
}

/**
 * The one mark a turn wears when it did something.
 *
 * Deliberately the quietest interactive thing in the panel: no border, no fill, one line of
 * dimmed text. It is a **door, not an announcement** — the point of moving the mechanism out
 * was that the conversation reads as a conversation, and a badge on every turn would put the
 * clutter back in a smaller font.
 */
function markFor(ledger: Ledger, onOpen: (ledger: Ledger) => void): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'mark'
  // **The ledger is captured here, not read at click time**, and that distinction was a real bug
  // caught by opening the record in the running app: `reset()` swaps in a fresh `Ledger` at the
  // end of every turn, so a handler that reached for `this.ledger` when clicked opened whatever
  // the *current* turn was doing — which for any finished turn is an empty one. Every mark on
  // the page belongs to a turn that has ended; it has to hold that turn's own record.
  el.addEventListener('click', () => onOpen(ledger))
  paintMark(el, ledger)
  return el
}

/**
 * Update a mark in place.
 *
 * Called on every step and every result, so it is written to be cheap and idempotent: it sets
 * text and one attribute and touches nothing else. The count is the whole of what it says
 * quantitatively — naming the tools here would be the tool cards again, smaller.
 */
function paintMark(el: HTMLElement, ledger: Ledger): void {
  const n = ledger.length
  const wanted = n === 1 ? '1 step' : `${n} steps`
  if (el.textContent !== wanted) el.textContent = wanted
  el.dataset['state'] = ledger.failed ? 'failed' : 'ok'
  el.title = ledger.failed
    ? 'Something in this turn failed. Click to see what ran.'
    : 'What this turn actually did. Click to see it.'
}


/** A compile-time check that every entry kind is handled. Never called at runtime. */
function assertNever(value: never): void {
  void value
}

/**
 * One turn, headed by who said it.
 *
 * With `art`, the speaker gets the **same character that is at their desk** — F1c's "one
 * identity system, two views". Not a second set of pictures that happens to match: the same
 * `office.sprites()` call, so a sprite pack installed for the floor changes the conversation
 * too, because there is nothing else for it to change with.
 */
function block(className: string, who: string, art?: AvatarSource, agent?: string): HTMLElement {
  const el = document.createElement('div')
  el.className = className

  const label = document.createElement('span')
  label.className = 'turn__who'

  // Only somebody who works here gets a face. "You" and the office's own notices are not
  // employees, and drawing a procedural character for them would invent a colleague.
  if (art && agent) label.appendChild(avatar(agent, 16, art))

  const name = document.createElement('span')
  name.textContent = who
  label.appendChild(name)

  el.appendChild(label)
  return el
}

/**
 * A block of assistant or user prose, rendered.
 *
 * The raw source is kept on the element because streaming appends to it: a partial reply has to
 * be re-rendered from the whole text each time rather than patched, or a `**` that arrives split
 * across two chunks never becomes bold and stays on screen as asterisks forever.
 */
function body(text: string, markdown = true, asks?: AskQueue): HTMLElement {
  const p = document.createElement('div')
  p.className = 'turn__body'
  if (markdown) render(p, text, asks)
  else p.textContent = text
  return p
}

/**
 * Draw a body from its whole source, keeping the source on the element.
 *
 * One function because every path that puts prose on screen has to do both halves — render it,
 * and remember what it was rendered from — and the one place that did only the first is the
 * place a streamed reply lost its markdown for two commits.
 */
function render(el: HTMLElement, text: string, asks?: AskQueue): void {
  el.dataset['raw'] = text
  el.replaceChildren(renderMarkdown(text, asks))
}

/** Add streamed text and re-render, so formatting that spans a chunk boundary still works. */
function appendTo(el: HTMLElement, more: string, asks?: AskQueue): void {
  render(el, (el.dataset['raw'] ?? '') + more, asks)
}

/**
 * The one argument that tells you what a call is actually doing.
 *
 * The order is the useful-first order, and the pick is *the first one that is a non-empty
 * string* rather than the first one present. `??` only skips `null` and `undefined`, so a call
 * carrying `description: ''` alongside a real `file_path` summarised as nothing at all — the
 * emptier field winning because it was listed first. The same step drops a field whose value is
 * not a string, which previously fell straight through to the key list.
 *
 * Exported for the reason `announcesItself` is: the judgement is here, and it decides what a
 * person reads about work they did not watch happen.
 */
export function summarise(tool: string, input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  const first = [
    input['description'],
    input['file_path'],
    input['command'],
    input['pattern'],
    input['path'],
    input['url'],
    input['prompt'],
  ].find((value): value is string => typeof value === 'string' && value.trim() !== '')

  if (first !== undefined) return clamp(first, 200)
  const keys = Object.keys(input)
  return keys.length ? `${tool}(${keys.join(', ')})` : ''
}

/**
 * A tool result's content, as text.
 *
 * `String(part.text)` was doing the reading, and `String` never fails: a block arriving as
 * `{ type: 'text', text: undefined }` put the literal word **"undefined"** into the transcript
 * as the result of an employee's work, `{ text: {…} }` put `[object Object]` there, and `null`
 * put "null". The content comes straight off the CLI's `tool_result` block, which is a shape
 * this app does not own — the same reason `stream.ts` checks `typeof b.type === 'string'`
 * rather than trusting the field to be what it is called.
 *
 * So only a string is text. A part whose `text` is something else contributes nothing rather
 * than contributing a rendering of its own type name, because the transcript showing words
 * nobody wrote is the third standing order, and it costs most here — this is where somebody
 * checks what actually happened.
 *
 * Contributing nothing is not the same as saying nothing: the outcome (`ok` / `failed`) is
 * carried separately by the caller and stays true. What is lost is detail that was never
 * readable, which is the honest amount to lose.
 */
export function flatten(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part !== 'object' || part === null) return ''
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}


/** Exported alongside the two above, so the boundary they share can be tested at it. */
export function clamp(text: string, limit = RESULT_CLAMP): string {
  const trimmed = text.trim()
  return truncate(trimmed, limit, '\n…')
}
