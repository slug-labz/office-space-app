/**
 * A question the manager asks before it starts.
 *
 * The brief: while you are talking to the manager it should be thinking on the spot and asking
 * questions, offering a recommended option with a little explanation of it, so it can gather
 * all the information it needs to create the best version of the project.
 *
 * The office already had the opposite habit and it is worth naming, because it is the failure
 * this fixes: `manager.md` tells the manager to *"ask only when it genuinely matters"* and that
 * *"interruptions are expensive"*. Correct for a manager mid-task, and exactly wrong at the
 * start of one. A vague opening request answered by guessing produces a confident wrong build,
 * and the cost of that is an afternoon; the cost of one question is ten seconds.
 *
 * ## The format, and why it is a fenced block
 *
 * ````
 * ```ask
 * Which database should this use?
 * - Postgres — recommended. You already run one, and the data here is relational.
 * - SQLite — nothing to run, but no concurrent writes.
 * - Tell me something else
 * ```
 * ````
 *
 * A fence, rather than a marker inside prose, for one reason: **it degrades correctly.** Any
 * renderer that has never heard of `ask` shows a code block containing a legible question and
 * its options — in a terminal, in a diff, in somebody's git history. A convention that turned
 * into unmatched punctuation when it was not understood would be a convention that makes the
 * transcript worse everywhere it is not implemented.
 *
 * Pure parsing, no DOM, so the shape can be tested against what a model actually writes rather
 * than against what we hope it writes.
 */

export interface AskOption {
  /** What is sent if this is chosen. The line as written, minus the marker and the detail. */
  readonly label: string
  /** The clause after the dash, if there is one. What choosing this actually means. */
  readonly detail: string
  /** The manager's own pick. At most one, and never invented when the manager named none. */
  readonly recommended: boolean
}

export interface Ask {
  readonly question: string
  readonly options: readonly AskOption[]
}

/** The info string that marks a fenced block as a question rather than as code. */
export const ASK_FENCE = 'ask'

/**
 * Read an `ask` block.
 *
 * Returns null when the body is not a question with options, and that is the important half:
 * a model that writes ```` ```ask ```` around a paragraph, or around nothing, must fall back to
 * a code block rather than render an empty card with no way out of it. One option is also not a
 * question — it is a statement with a button — so two is the floor.
 */
export function parseAsk(body: string): Ask | null {
  const lines = body.split('\n')

  const question = lines.find((l) => l.trim() !== '')?.trim() ?? ''
  if (question === '') return null

  const options: AskOption[] = []
  for (const line of lines.slice(lines.indexOf(lines.find((l) => l.trim() !== '') as string) + 1)) {
    const item = /^\s*[-*]\s+(.*)$/.exec(line)
    if (!item) continue

    const text = (item[1] ?? '').trim()
    if (text === '') continue

    // The detail is whatever follows the first em dash, en dash or ` - `. Models reach for all
    // three and picking one would mean silently swallowing the other two into the label.
    const split = /\s+[—–]\s+|\s+-\s+/.exec(text)
    const label = split ? text.slice(0, split.index).trim() : text
    const detail = split ? text.slice(split.index + split[0].length).trim() : ''

    // "recommended" anywhere in the detail, in any case, and stripped from what is shown so the
    // word does not appear twice — once as a badge and once in the sentence.
    const recommended = /\brecommended\b/i.test(detail)
    const shown = recommended ? readable(detail.replace(/\brecommended\b[.,:;]?\s*/i, '')) : sentence(detail)

    options.push({ label, detail: shown, recommended })
  }

  if (options.length < 2) return null

  // At most one recommendation. Two is not a recommendation, and a model that marks three is
  // telling you nothing while looking like it told you something.
  let seen = false
  const single = options.map((o) => {
    if (!o.recommended || seen) return { ...o, recommended: false }
    seen = true
    return o
  })

  return { question, options: single }
}

/**
 * Repair the fragment that stripping "recommended" leaves behind.
 *
 * This was pasted back as badly formatted, and that was right. Models write
 * the recommendation and its reason as one clause — `— recommended, since the exploration is
 * already done` — so removing the word we already show as a badge leaves the card reading
 * **"since the exploration is already done"**: lowercase, no subject, visibly the back half of
 * a sentence somebody cut.
 *
 * The dangling word is always a subordinating conjunction, because that is what joins a reason
 * to the claim it supports. Dropping it promotes the subordinate clause to the main one, which
 * is what it now is: *"The exploration is already done."* Nothing is invented and nothing that
 * carries meaning is lost — the conjunction's only job was to attach to a word that is now a
 * badge.
 */
function readable(detail: string): string {
  const promoted = detail.trim().replace(/^(?:since|because|as|given that|given|seeing as)\s+/i, '')
  return sentence(promoted)
}

/** A capital at the front, so a clause that survived surgery still opens like a sentence. */
function sentence(text: string): string {
  const t = text.trim()
  return t === '' ? '' : t[0]!.toUpperCase() + t.slice(1)
}

/**
 * One question at a time, and none of them lost.
 *
 * `manager.md` tells the manager to ask **one question per turn**, and that instruction is
 * prompt guidance: it holds until it does not. It has already not held — a turn arrived with
 * three `ask` blocks and the panel drew three cards stacked on top of each other, which is the
 * interrogation the one-question rule exists to prevent. A rule that lives only in a prompt is a
 * rule the renderer is not enforcing, so the renderer enforces it here.
 *
 * ## The failure mode this is built around
 *
 * The naive enforcement is "render the first block and drop the rest", and it is the worse bug.
 * The manager asked three questions because it wants three answers; silently discarding two
 * leaves it waiting on information the person was never shown and never had the chance to give.
 * So nothing is dropped: the later cards exist, hidden, and each one appears as the one before
 * it is settled. Answered or skipped both count — the way out of a question is still a way out.
 *
 * ## Why the queue is keyed on the question text
 *
 * Because the cards are **rebuilt constantly**. A streamed reply is re-rendered from its whole
 * source on every chunk (`appendTo` in `chat-view.ts`), so the DOM node holding a question is
 * thrown away and replaced several times a second while it is arriving. State stored on a card
 * would be state that lives for one chunk. Keyed on the text, a re-render replaces the handle
 * in place and the queue's memory of what has been answered survives it.
 *
 * No DOM in here. A card is two callbacks, which is what makes the ordering testable without a
 * browser and what keeps the policy separable from the panel that draws it.
 */

/** What the queue can do to one card on screen. */
export interface AskCard {
  /** Put it on screen. `after` is how many questions are still waiting behind this one. */
  readonly show: (after: number) => void
  /** Take it off screen. It still exists, and it is still going to be asked. */
  readonly hide: () => void
  /**
   * Draw it as already dealt with, showing what was chosen.
   *
   * Needed because of the re-render: a card the person answered is rebuilt from the source text
   * a moment later as a fresh, live, clickable card. Without this the transcript would offer a
   * question that has already been answered — the third standing order broken by a redraw.
   */
  readonly settle: (chosen: string) => void
}

export class AskQueue {
  /**
   * Every question this conversation has asked, in the order it first asked it.
   *
   * A `Map` for the insertion order, which is the queue order. Re-registering a question
   * replaces its card without moving it, so a re-render cannot reorder the queue.
   */
  private readonly cards = new Map<string, AskCard>()
  /**
   * Questions already dealt with, and what was chosen.
   *
   * Never emptied — a settled question stays settled for the life of the conversation. The
   * answer is kept rather than a bare flag so that a rebuilt card can be drawn as the person
   * left it instead of as a live question they have already been asked.
   */
  private readonly settled = new Map<string, string>()

  /** A card has been drawn for this question. Adds it to the queue, or replaces the old handle. */
  register(question: string, card: AskCard): void {
    this.cards.set(question, card)
    this.refresh()
  }

  /** This question has been answered or skipped. The next one, if there is one, comes forward. */
  resolve(question: string, chosen: string): void {
    this.settled.set(question, chosen)
    this.refresh()
  }

  /** What was chosen for this question, or `null` if it is still open. */
  chosenFor(question: string): string | null {
    return this.settled.get(question) ?? null
  }

  /** What is still waiting, in order. Empty when every question has been dealt with. */
  get waiting(): readonly string[] {
    return [...this.cards.keys()].filter((q) => !this.settled.has(q))
  }

  /**
   * Show the first unsettled question, hide the unsettled ones behind it, and leave the settled
   * ones showing what was chosen.
   *
   * Every card is told what to do on every refresh rather than only the ones that changed. A
   * card that was already hidden being hidden again costs nothing, and the alternative — a
   * diff of what the queue believes is on screen — is a second model of the DOM to keep in
   * step with the DOM.
   *
   * An answered card is **not** hidden. It is part of the record: the question was put and this
   * is what was said back, and a transcript that folds that away is a transcript missing a
   * decision.
   */
  private refresh(): void {
    const waiting = this.waiting
    for (const [question, card] of this.cards) {
      const chosen = this.settled.get(question)
      if (chosen !== undefined) card.settle(chosen)
      else if (waiting[0] === question) card.show(waiting.length - 1)
      else card.hide()
    }
  }
}
