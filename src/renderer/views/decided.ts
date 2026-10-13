/**
 * What the office did while you were out, drawn.
 *
 * The gate has always kept a perfect record of its own absences and, until the record landed, none
 * at all of a person's decisions. This is the door onto the half that was missing — and it is a
 * **panel**, not a line on the problems list, for a reason worth stating because the alternative
 * looked reasonable for a while.
 *
 * The workspace problem that reports a night's refusals fires on `unanswered > 0`, and it should:
 * a lint is a problems list, somebody who answered everything has no problem, and a card that
 * appears on a good night is one nobody reads on a bad one. But *"what did I approve last night"*
 * is not a problem report, and putting the only answer to it inside one is a category error — it
 * would make the record reachable only on the nights something also went wrong.
 *
 * ## Why this is not part of the memory panel
 *
 * They look like the same shape and they are different questions. **Memory is authored; this is
 * observed.** Everything under `memory/` is there because a person or an agent decided to write it
 * down. Everything here is there because something happened and the office noticed. Merging them
 * would put a night of `npm test` approvals beside a decision somebody wrote deliberately, and the
 * memory panel's honesty depends on that line staying clean.
 *
 * ## Why it is not the activity strip either
 *
 * That was the obvious home — the strip already argues that *needs you* / *running* / *happened*
 * is the right order, and a night's decisions are a happened-fact. Its history is **per-session**
 * and **capped**, though, and its own comment says it is not a thing that grows forever. This
 * record is cross-session and unbounded, and the case it exists for is a night whose session is
 * long gone. Two different scopes wearing the same word: putting it there would either misattribute
 * cross-session records to one session or truncate exactly the night somebody wanted.
 *
 * What the strip does have is the right concept, and `Entry.restored` names it: *"The office was
 * not running when it happened; it is reading a file afterwards and can vouch for nothing the file
 * does not record."* Every card here is further from watched than that — the filing is best-effort
 * and allowed to lose records rather than throw. The distinction is borrowed; the container is not.
 *
 * ## What it draws each call with
 *
 * `summarise()` from `approval-summary.ts` — the same function that draws the **live** approval
 * card. Not a second one. A separate "what was this call going to do" would drift, and the two
 * would eventually describe the same command differently on two surfaces of the same app.
 */

import { summarise } from '../../shared/approval-summary.js'
import { decisionsLede, type Decision, type DecisionReport } from '../../shared/decisions.js'
import { line } from './work.js'

/**
 * What each outcome is called on a card, and the class that colours it.
 *
 * The class is written out rather than composed from the outcome. `deccard--${outcome}` reads
 * fine and is invisible to `css-applied.test.ts`, which greps for the literal — so three styled
 * rules would sit in the sheet looking dead, and the next person to tidy dead bytes would delete
 * the styling for the state that matters most.
 */
const SAID: Record<Decision['outcome'], { word: string; className: string }> = {
  allowed: { word: 'You approved this', className: 'deccard deccard--allowed' },
  declined: { word: 'You declined this', className: 'deccard deccard--declined' },
  // Not "you", and that is the point. Somebody answered and the office lost which way — blaming
  // the person for the office's own failure to read them is the worst lie available here.
  unreadable: {
    word: 'You answered, and the office could not read which way',
    className: 'deccard deccard--unreadable',
  },
}

/**
 * @param focus  A record to mark and scroll to, when the panel was opened *at* one rather than
 *   from the menu. `undefined` is the ordinary open and marks nothing.
 *
 *   Built in rather than retrofitted: *"what did I approve about the deploy script"* is a natural
 *   search, and the memory panel gained this parameter after the fact for exactly that reason.
 */
export function renderDecided(host: HTMLElement, report: DecisionReport, focus?: string): void {
  host.replaceChildren()
  host.appendChild(line('decided__lede', decisionsLede(report)))

  // A directory that would not open. Nothing below it would be about this office, so nothing
  // below it is drawn — a list under that sentence would read as "and here is what is in it".
  if (report.problem !== null) {
    if (focus !== undefined) {
      // Could-not-check and is-not-there, kept apart at the point where a person would otherwise
      // assume the second. The office did not look, so it does not know whether it is there.
      host.appendChild(
        line(
          'decided__lede decided__lede--problem',
          `Whether ${focus} is still here could not be checked, because the record would not open.`,
        ),
      )
    }
    return
  }

  if (focus !== undefined && !report.decisions.some((d) => d.id === focus)) {
    host.appendChild(
      line(
        'decided__lede decided__lede--problem',
        `The decision you opened — ${focus} — is not here now. It may have been removed since the search ran.`,
      ),
    )
  }

  /*
   * Dated first, newest first; undated last under a heading that says what they are.
   *
   * The same move as the memory panel's `unlabelled` group: the ones that did not say get a name
   * of their own rather than being folded in among the ones that did. Sorting one as though it
   * were the oldest would be a claim about when it happened, from a filename that makes none.
   *
   * The heading says *no readable time* rather than *before the office noted times*, which an
   * earlier draft said and which is false of this directory: `decided/` did not exist before the
   * gate wrote times into names. `missed/` has both shapes; this one has only damaged names — a
   * corrupted prefix, a hand edit, a truncated write. Rare, and the group costs one line.
   */
  const dated = report.decisions.filter((d) => d.at !== null)
  const undated = report.decisions.filter((d) => d.at === null)

  for (const decision of dated) host.appendChild(draw(decision, focus))

  if (undated.length > 0) {
    host.appendChild(line('decided__group', 'Recorded with no readable time'))
    for (const decision of undated) host.appendChild(draw(decision, focus))
  }

  if (report.decisions.length === 0 && report.unread.length === 0) {
    host.appendChild(
      line(
        'decided__empty',
        'Nothing has been approved or declined here yet. When a tool call needs your permission, ' +
          'what you decide is kept — so a night you were not here for has an answer afterwards.',
      ),
    )
  }

  /*
   * Named one by one rather than counted.
   *
   * `memory.ts` settled this and the reason holds harder here: a record that will not open may be
   * the very decision somebody came looking for, and a count cannot be searched for later. It also
   * covers a file that read fine and is not one of ours — a truncated write, a hand edit — which
   * `parseDecision` returns `null` for and the reader files here rather than dropping.
   */
  for (const gap of report.unread) {
    host.appendChild(
      line('decided__unread', `${gap.id} could not be read, so what was decided is not here — ${gap.cause}`),
    )
  }
}

function draw(decision: Decision, focus?: string): HTMLElement {
  const el = document.createElement('article')
  const said = SAID[decision.outcome]
  el.className = said.className
  if (decision.id === focus) el.classList.add('deccard--found')

  const summary = summarise(decision.request)

  const title = document.createElement('h4')
  title.className = 'deccard__title'
  // The tool and the one thing the call was about, exactly as the live card words it. An empty
  // `detail` is a call with nothing to name, and the tool alone is then the whole truth.
  title.textContent = summary.detail === '' ? summary.tool : `${summary.tool} · ${summary.detail}`
  el.appendChild(title)

  if (summary.truncated) {
    // Said, never implied. A command shown cut without saying so is a command somebody may read
    // as complete and approve a rule for.
    el.appendChild(line('deccard__cut', 'This command was cut to fit — the record holds all of it.'))
  }

  el.appendChild(line('deccard__verdict', said.word))
  el.appendChild(line('deccard__meta', metaOf(decision, summary.blockedBy)))

  // The office's own words on a decline, when there were any. Part of the decision rather than
  // decoration: it is what the agent was told, and the only record of why.
  if (decision.reason !== null) {
    el.appendChild(line('deccard__reason', `Your reason: ${decision.reason}`))
  }

  if (decision.id === focus) {
    // Guarded: this view renders under `test/dom.ts` as well as in Electron, and the stub has no
    // layout to scroll. A missing method would throw *inside* the render and leave the panel
    // half-drawn, which is worse than not scrolling.
    el.scrollIntoView?.({ block: 'center' })
  }

  return el
}

/**
 * The second line: whose call it was, and when it was decided.
 *
 * `blockedBy` rather than a bare agent name, because `null` is the manager rather than "we could
 * not tell" — the CLI puts `agent_type` on every subagent call and on none of the manager's, and
 * a card with no name on it reads as one the office could not attribute.
 */
function metaOf(decision: Decision, blocked: string): string {
  const parts = [blocked]

  if (decision.decidedAt !== null) {
    parts.push(`decided ${decision.decidedAt}`)
  } else if (decision.at !== null) {
    // The name's time, when the record's own field is missing. Marked as filed rather than
    // decided, because they are not the same instant and the difference is the office's, not the
    // person's.
    parts.push(`filed ${new Date(decision.at).toISOString()}`)
  } else {
    // Said, not blank. A record with no time at all is one from before the gate wrote them, and
    // an empty slot there reads as a rendering fault rather than a fact about the file.
    parts.push('no time recorded')
  }

  return parts.join(' · ')
}
