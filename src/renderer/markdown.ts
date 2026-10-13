/**
 * Rendering what the model wrote.
 *
 * Assistant text arrived as `textContent`, so a reply containing `**this**` showed you the
 * asterisks. Correct, safe, and unreadable — the transcript was displaying markup instead of
 * the message.
 *
 * **Every node here is built with `createElement` and `textContent`. There is no `innerHTML`
 * anywhere in this file and there must never be one.** This renders text written by a language
 * model, inside an app that can start processes with your credentials; the whole reason the
 * transcript was plain text in the first place was that safety, and the fix has to keep it
 * rather than trade it away for formatting. A model that writes a `<script>` tag gets a
 * paragraph containing the characters of a script tag.
 *
 * Deliberately a small subset. Fences, headings, lists, quotes, and inline code/bold/italic —
 * what a coding assistant actually emits. Tables, images and raw HTML are left as text, which
 * is honest: showing the source is better than half-rendering it.
 */

import { ASK_FENCE, parseAsk, type Ask, type AskQueue } from '../shared/transcript/ask.js'

/**
 * Build the DOM for a block of markdown.
 *
 * `queue` is the conversation's question queue. Given one, a reply carrying several `ask` blocks
 * shows them one at a time instead of stacking them — see `AskQueue`. Optional so that the three
 * callers with no conversation behind them still render a card the moment they draw it.
 */
export function renderMarkdown(text: string, queue?: AskQueue): DocumentFragment {
  const frag = document.createDocumentFragment()
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    // ``` fenced code. Everything until the closing fence is verbatim — no inline parsing,
    // because the point of a fence is that its contents are not prose.
    //
    // **Three or more backticks, and an info string that may be anything without a backtick in
    // it.** This was `` /^\s*```(\w*)\s*$/ `` — exactly three, and a single word after them —
    // which is narrower than what a model writes and narrower than CommonMark. ```` ```` ```` and
    // ``` ```js extra ``` are both ordinary fences and neither matched.
    //
    // Not matching was not the bug; it was the trigger. The paragraph branch below breaks on
    // ``/^\s*```/`` — three backticks *anywhere at the start* — so a line this regex rejected
    // was consumed by nothing, `i` never advanced, and the loop appended an empty paragraph
    // forever. Ten backticks exhausted the heap and killed the renderer, and model output is
    // exactly where a stray run of them comes from.
    const fence = /^\s*`{3,}[ \t]*([^\s`]*)[^`]*$/.exec(line)
    if (fence) {
      const code: string[] = []
      i++
      // A closing fence is backticks and nothing else. An info string only opens.
      while (i < lines.length && !/^\s*`{3,}\s*$/.test(lines[i] ?? '')) code.push(lines[i++] ?? '')
      i++ // the closing fence

      // A question the manager is asking, rather than code it is showing. Rendered as something
      // you can answer with a click; anything that is not a question with at least two options
      // falls through to a code block, so a malformed one is legible rather than an empty card.
      if (fence[1] === ASK_FENCE) {
        const ask = parseAsk(code.join('\n'))
        if (ask) {
          frag.appendChild(askCard(ask, queue))
          continue
        }
      }

      const pre = document.createElement('pre')
      pre.className = 'md-code'
      const el = document.createElement('code')
      el.textContent = code.join('\n')
      if (fence[1]) pre.dataset['lang'] = fence[1]
      pre.appendChild(el)
      frag.appendChild(pre)
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const h = document.createElement('p')
      h.className = `md-h md-h${heading[1]!.length}`
      inline(h, heading[2] ?? '')
      frag.appendChild(h)
      i++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) {
        quoted.push((lines[i] ?? '').replace(/^\s*>\s?/, ''))
        i++
      }
      const q = document.createElement('div')
      q.className = 'md-quote'
      q.appendChild(renderMarkdown(quoted.join('\n'), queue))
      frag.appendChild(q)
      continue
    }

    if (isItem(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const list = document.createElement(ordered ? 'ol' : 'ul')
      list.className = 'md-list'
      while (i < lines.length && isItem(lines[i] ?? '')) {
        const li = document.createElement('li')
        inline(li, (lines[i] ?? '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''))
        list.appendChild(li)
        i++
      }
      frag.appendChild(list)
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    // A paragraph runs until a blank line or the start of another block.
    const para: string[] = []
    while (i < lines.length) {
      const l = lines[i] ?? ''
      if (l.trim() === '' || isItem(l) || /^\s*```/.test(l) || /^#{1,4}\s/.test(l) || /^\s*>\s?/.test(l)) break
      para.push(l)
      i++
    }

    // The loop above must always move, and the guarantee is here rather than in the conditions.
    //
    // Every branch in this function ends by consuming at least one line — except this one, which
    // could break on its first test and leave `i` exactly where it was. Then nothing had handled
    // the line and nothing had moved past it, and the outer `while` ran again on the same input:
    // an empty paragraph per turn, forever, until the heap gave out.
    //
    // Fixing the fence regex removes today's way in. This removes the *shape* of the fault, so
    // the next condition added to that `break` cannot bring it back — and the line is rendered
    // rather than skipped, because a line the parser could not classify is still something
    // somebody wrote.
    if (para.length === 0) {
      para.push(line)
      i++
    }
    const p = document.createElement('p')
    p.className = 'md-p'
    inline(p, para.join('\n'))
    frag.appendChild(p)
  }

  return frag
}

function isItem(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)
}

/**
 * Inline spans: `code`, **bold**, *italic*.
 *
 * One pass, longest marker first, so `**a**` is not read as two italics. Anything unmatched is
 * left exactly as written — an unpaired asterisk is an asterisk, not the start of something the
 * renderer should guess at.
 *
 * ## The promise above was true and the pattern did not keep it
 *
 * "Unmatched" was doing more work than the regex could. `\*[^*\n]+\*` calls any two asterisks on
 * a line a pair, so in a tool whose whole subject is code:
 *
 *     2 * 3 * 4                 rendered as   2  3  4
 *     files: *.ts and *.css     rendered as   files: .ts and .css
 *     snake_case_name           rendered as   snakecasename
 *     __dirname and __filename  rendered as   _dirname and _filename
 *
 * Arithmetic, globs, and every snake_case identifier in the transcript. That is the third
 * standing order at the surface a person reads most: the screen showing text nobody sent.
 *
 * The fix is the rule CommonMark already uses, which is about **whitespace on the inside of the
 * markers** rather than about counting them:
 *
 * - an opener may not be followed by a space — `* 3` opens nothing;
 * - a closer may not be preceded by one — `and *` closes nothing;
 * - `_` additionally may not touch a word character on its outside, because intra-word
 *   underscores are identifiers everywhere and emphasis nowhere.
 *
 * Backticks keep their own rule. A code span is delimited by a character that cannot appear in
 * running prose by accident, which is the reason the marker was chosen.
 */
function inline(parent: HTMLElement, text: string): void {
  const pattern =
    /(`[^`\n]+`)|(\*\*(?!\s)[^*\n]+?(?<!\s)\*\*)|(\*(?!\s)[^*\n]+?(?<!\s)\*)|(?<!\w)(_(?!\s)[^_\n]+?(?<!\s)_)(?!\w)/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)))
    const [raw] = m
    if (raw.startsWith('`')) {
      const code = document.createElement('code')
      code.className = 'md-inline-code'
      code.textContent = raw.slice(1, -1)
      parent.appendChild(code)
    } else if (raw.startsWith('**')) {
      const b = document.createElement('strong')
      b.textContent = raw.slice(2, -2)
      parent.appendChild(b)
    } else {
      const em = document.createElement('em')
      em.textContent = raw.slice(1, -1)
      parent.appendChild(em)
    }
    last = m.index + raw.length
  }

  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)))
}


/**
 * A question, as something you answer rather than read.
 *
 * The options are buttons. Choosing one dispatches an `office:answer` event carrying the label,
 * which `app.ts` turns into a message — the answer goes into the conversation as if it had been
 * typed, because it is an answer to a question in that conversation and pretending otherwise
 * would put a decision somewhere the transcript does not record.
 *
 * A custom event rather than a callback threaded down through `renderMarkdown`, because this
 * module is called from four places and three of them have nothing to do with answering
 * questions. The event is the narrow seam.
 *
 * ## One at a time
 *
 * Given a `queue`, the card does not decide whether it is on screen — the queue does. A turn
 * carrying three questions produces three cards and shows the first; the second appears when the
 * first is answered or skipped. The manager is *told* to ask one question per turn, and it has
 * already not: prompt guidance loses eventually, so the panel enforces it rather than hoping.
 */
function askCard(ask: Ask, queue?: AskQueue): HTMLElement {
  const card = document.createElement('div')
  card.className = 'ask'

  const question = document.createElement('p')
  question.className = 'ask__q'
  question.textContent = ask.question
  card.appendChild(question)

  const list = document.createElement('div')
  list.className = 'ask__options'

  for (const option of ask.options) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = option.recommended ? 'ask__option ask__option--pick' : 'ask__option'

    const label = document.createElement('span')
    label.className = 'ask__label'
    label.textContent = option.label
    button.appendChild(label)

    if (option.recommended) {
      const badge = document.createElement('span')
      badge.className = 'ask__badge'
      badge.textContent = 'recommended'
      button.appendChild(badge)
    }

    if (option.detail) {
      const detail = document.createElement('span')
      detail.className = 'ask__detail'
      detail.textContent = option.detail
      button.appendChild(detail)
    }

    button.addEventListener('click', () => {
      // Every button in the card goes dead once one is pressed. The question has been answered;
      // leaving the others live invites a second answer to a question that is no longer open,
      // which arrives as a bare noun in the middle of the work that followed the first.
      answered(button)
      // Told before the answer is dispatched, so the next question is already on screen by the
      // time the manager's reply to this one starts arriving.
      queue?.resolve(ask.question, option.label)
      card.dispatchEvent(
        new CustomEvent('office:answer', { bubbles: true, detail: option.label }),
      )
    })

    list.appendChild(button)
  }

  card.appendChild(list)

  /**
   * The way out.
   *
   * Reported from a card with three buttons: it asks a question and offers no way to cancel or
   * skip it. That was right, and the omission has a shape worth naming — every option on
   * the card was a way of *answering*, so a card offering three choices offered no choice at
   * all about whether to choose.
   *
   * It sends rather than merely hiding, because a question the manager is still waiting on is
   * not resolved by the person who asked it looking away. Quiet, and last, so it never competes
   * with the answer the manager actually wants.
   */
  const skip = document.createElement('button')
  skip.type = 'button'
  skip.className = 'ask__skip'
  skip.textContent = 'Skip this question'
  skip.addEventListener('click', () => {
    answered(skip)
    // A skip settles the question as firmly as an answer does. If it did not, skipping the first
    // of three would leave the other two behind a card nobody is ever going to press again —
    // the questions would be lost by being permanently next.
    queue?.resolve(ask.question, SKIPPED)
    card.dispatchEvent(new CustomEvent('office:answer', { bubbles: true, detail: SKIPPED }))
  })
  card.appendChild(skip)

  /**
   * How many questions are still waiting behind this one.
   *
   * The half of one-at-a-time that makes it honest rather than merely tidy. Showing one card
   * and saying nothing looks identical to the manager having asked one question — the person
   * answers, a second card appears out of nowhere, and the office looks like it is making them
   * up as it goes. Present only when there really are more; silence in the ordinary case.
   */
  const waiting = document.createElement('p')
  waiting.className = 'ask__waiting'
  waiting.hidden = true
  card.appendChild(waiting)

  /** Close the card around whichever control was pressed, including the skip. */
  function answered(chosen: HTMLButtonElement): void {
    card.querySelectorAll('button').forEach((other) => (other.disabled = true))
    chosen.classList.add(chosen === skip ? 'ask__skip--chosen' : 'ask__option--chosen')
  }

  if (queue) {
    queue.register(ask.question, {
      show: (after) => {
        card.hidden = false
        waiting.hidden = after === 0
        waiting.textContent =
          after === 0 ? '' : `${after} more question${after === 1 ? '' : 's'} after this one.`
      },
      hide: () => {
        card.hidden = true
      },
      // A rebuilt card for a question already dealt with. Drawn closed, around what was chosen,
      // because a redraw must not turn an answered question back into an open one.
      settle: (chosen) => {
        card.hidden = false
        waiting.hidden = true
        const pressed = chosen === SKIPPED ? skip : buttonFor(list, chosen)
        if (pressed) answered(pressed)
        else card.querySelectorAll('button').forEach((other) => (other.disabled = true))
      },
    })
  }

  return card
}

/** What a skip sends. A sentence, because it goes into the conversation as the person's reply. */
const SKIPPED = 'Skip that question — use your best judgement and carry on.'

/** The option button carrying this label, or nothing if the wording has changed under us. */
function buttonFor(list: HTMLElement, label: string): HTMLButtonElement | null {
  for (const button of Array.from(list.querySelectorAll('button'))) {
    if (button.querySelector('.ask__label')?.textContent === label) return button
  }
  return null
}
