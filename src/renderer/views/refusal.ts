/**
 * A turn's refusals, drawn as one thing.
 *
 * The model half of this lives in `src/shared/refusals.ts` and the argument for it is there.
 * This is the DOM half, and it has one job the model cannot do for it: make a list of nineteen
 * refused calls **scannable** rather than merely shorter.
 *
 * So the block is three parts, in the order somebody reads them:
 *
 * 1. the shape of the problem, once;
 * 2. every distinct call, one line each, the command verbatim;
 * 3. what to do, one line per cause.
 *
 * The command is the part that must never be summarised away. A refusal notice that says "some
 * commands were blocked" has removed the only fact its reader can act on, which is the failure
 * the wall of paragraphs was at least not guilty of.
 *
 * **`textContent` throughout, and no `innerHTML` anywhere.** Every string here came from a
 * language model or from a tool payload, in an app that can start processes with your
 * credentials. Same rule as `markdown.ts`, same reason.
 */

import type { RefusalCause, RefusalCall, RefusalNotice } from '../../shared/refusals.js'

/** The word for each cause, when the block has to say which is which. */
const TAG: Readonly<Record<RefusalCause, string>> = {
  denied: 'denied',
  unlisted: 'unlisted',
  unknown: 'refused',
}

export function refusalBlock(notice: RefusalNotice): HTMLElement {
  // `notice` is kept as the outer class, so a refusal block still reads as one of the office's
  // own red notices rather than as a new kind of thing. `refusal` adds the layout on top of it;
  // it does not replace the vocabulary.
  const el = document.createElement('div')
  el.className = 'notice refusal'

  const head = document.createElement('p')
  head.className = 'refusal__head'
  head.textContent = notice.headline
  el.appendChild(head)

  const list = document.createElement('ul')
  list.className = 'refusal__calls'
  for (const call of notice.calls) list.appendChild(callLine(call, notice.mixed))
  el.appendChild(list)

  for (const line of notice.advice) {
    const p = document.createElement('p')
    p.className = 'refusal__advice'
    p.textContent = line
    el.appendChild(p)
  }

  return el
}

/**
 * One refused call.
 *
 * The tool name leads, because `Bash` and `Write` are refused for different-feeling reasons and
 * the eye sorts on it. The `× 11` is deliberately loud enough to see in a scan: an agent that
 * tried the same command eleven times was looping, and that is a different problem from an
 * agent working through eleven different commands — the wall of paragraphs made the two look
 * identical.
 */
function callLine(call: RefusalCall, showCause: boolean): HTMLElement {
  const li = document.createElement('li')
  li.className = 'refusal__call'

  const tool = document.createElement('span')
  tool.className = 'refusal__tool'
  tool.textContent = call.tool
  li.appendChild(tool)

  // A denial the CLI gave us no argument for. Saying nothing is better than inventing one; the
  // tool name on its own is still the honest answer to "what was refused".
  if (call.detail) {
    const detail = document.createElement('code')
    detail.className = 'refusal__command'
    // The ellipsis is part of the text rather than a CSS overflow, so a cut command is visibly
    // cut when the line is copied out of the app as well as when it is read in it.
    detail.textContent = call.truncated ? `${call.detail}…` : call.detail
    li.appendChild(detail)
  }

  if (call.times > 1) {
    const times = document.createElement('span')
    times.className = 'refusal__times'
    times.textContent = `× ${call.times}`
    li.appendChild(times)
  }

  // Only when the turn hit both causes. A column of identical tags beside every line is the
  // noise this block exists to remove, and it would push the command — the thing being read —
  // further from the edge.
  if (showCause) {
    const tag = document.createElement('span')
    tag.className = 'refusal__cause'
    tag.textContent = TAG[call.cause]
    li.appendChild(tag)
  }

  return li
}
