/**
 * The activity strip — three zones under the floor.
 *
 * **What needs you**, then **what is running**, then **what happened**. The order is the design
 * and `shared/activity.ts` explains why; this file only draws it.
 *
 * The first zone is the one that justifies the strip existing at all. F18 can park a tool call
 * and wait up to four minutes for a verdict — and before this, nothing in the app told anybody
 * a call was parked. A rendezvous with no surface is a hang.
 */

import type { Dispatch, PendingApproval, UnfinishedReport, UnfinishedVerb } from '../../shared/ipc.js'
import {
  collapse,
  elapsed,
  quietFor,
  quietNotice,
  type ActivityState,
  type Entry,
  type Running,
} from '../../shared/activity.js'
import { inAnswerOrder, summarise, timeLeft, aboutTheClock } from '../../shared/approval-summary.js'
import { avatar, type AvatarSource } from './avatar.js'

export interface ActivityHandlers {
  /** Answer a held call. `reason` is optional and travels with a refusal. */
  readonly onDecide: (request: PendingApproval, allow: boolean) => void
  /** Open somebody's card — the full record, read from their own session. */
  readonly onOpen: (who: string) => void
  /**
   * Act on a dispatch that never reported back.
   *
   * One handler for all three verbs rather than three, so a card can never be wired up with two
   * of them and a dead button — which is how a control that does nothing gets shipped.
   */
  readonly onUnfinished: (entry: Dispatch, verb: UnfinishedVerb) => void
  /** Where faces come from. Optional, like everywhere else an avatar is an improvement. */
  readonly art?: AvatarSource
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export interface StripModel {
  readonly activity: ActivityState
  readonly approvals: readonly PendingApproval[]
  /**
   * What the ledger says was sent and never came back.
   *
   * Read from disk rather than derived from this session's events — that is the entire point.
   * `null` means nobody has asked yet, which is not the same as "there is nothing", so the zone
   * simply does not draw until an answer has arrived.
   */
  readonly unfinished: UnfinishedReport | null
  /** Now, in ms. Passed rather than read, so a redraw and a test agree on the clock. */
  readonly nowMs: number
}

/** Fill `host`. Replaces everything, because every zone can change on one event. */
export function renderStrip(host: HTMLElement, model: StripModel, on: ActivityHandlers): void {
  host.replaceChildren()

  if (model.approvals.length > 0) host.appendChild(needsYou(model.approvals, model.nowMs, on))
  // After the held calls and before everything else. A parked tool call is stopping the office
  // *this second*; unfinished work stopped being urgent when the process died. Both come before
  // the log, because both are things only a person can end.
  if (unfinishedShows(model.unfinished)) host.appendChild(neverReported(model.unfinished, on))
  host.appendChild(nowRunning(model.activity.running, model.nowMs, on))
  host.appendChild(whatHappened(model.activity.history))
}

/**
 * Whether the unfinished zone has anything to say.
 *
 * A problem or a torn line counts on its own, with no entries at all. "The ledger would not
 * open" is exactly the case where drawing nothing would be the app claiming there is nothing
 * outstanding — which is the failure this zone was built to stop.
 */
export function unfinishedShows(report: UnfinishedReport | null): report is UnfinishedReport {
  if (!report) return false
  return report.entries.length > 0 || report.torn.length > 0 || report.problem !== null
}

/**
 * Held tool calls, oldest first.
 *
 * Two buttons and no default. The hook denies on its own deadline without consulting anything
 * here, so a decision that never arrives is already a refusal — which means this panel never
 * needs a timer of its own, and must never *look* like allowing is the quiet option.
 */
function needsYou(approvals: readonly PendingApproval[], nowMs: number, on: ActivityHandlers): HTMLElement {
  const zone = el('section', 'strip__zone strip__zone--attention')

  const head = el('div', 'strip__head')
  head.appendChild(el('h4', 'label', 'Needs you'))
  head.appendChild(
    el(
      'span',
      'strip__count',
      approvals.length === 1 ? 'one call is waiting' : `${approvals.length} calls are waiting`,
    ),
  )
  zone.appendChild(head)

  for (const request of inAnswerOrder(approvals)) {
    zone.appendChild(approvalCard(request, nowMs, on))
  }

  return zone
}

function approvalCard(request: PendingApproval, nowMs: number, on: ActivityHandlers): HTMLElement {
  const summary = summarise(request)
  const card = el('div', `approval approval--${summary.weight}`)

  const top = el('div', 'approval__top')
  top.appendChild(el('span', 'approval__tool mono', summary.tool))
  top.appendChild(el('span', 'approval__weight', summary.weight))
  card.appendChild(top)

  // Whose desk is stopped. On a floor with seven people on it, "one call is waiting" does not
  // say whose — and the premise of this app is that you can see who is doing what.
  card.appendChild(el('p', 'approval__who', `${summary.blockedBy} is waiting on you`))

  /*
   * How long is left, once it is short enough to matter.
   *
   * This counts down only because the strip redraws at 1 Hz with a fresh `nowMs`, which it does
   * while the strip is open and either somebody is mid-task or a held call is still counting
   * down — `stripTicks` in `shared/strip-tick.ts`. This comment used to call that free, riding on
   * the running chips' tick, and that tick never ran for the manager's own held call: the card was
   * drawn once, so this line never appeared, or appeared and then stood still. It is silent above
   * a minute on purpose: a number that runs for the whole four minutes is one somebody learns to
   * stop seeing.
   */
  const clock = aboutTheClock(timeLeft(request.askedAt, request.waitMs, nowMs))
  if (clock !== null) {
    const said = el('p', 'approval__clock', clock)
    // Marked so the styling can differ, and so a screen reader is told this one changed. The
    // rest of the card is static from the moment it appears; this is the only line that moves.
    said.setAttribute('role', 'status')
    card.appendChild(said)
  }

  if (summary.detail) {
    // `textContent`, always. This is the one string in the app most likely to contain markup
    // written by something that wanted it rendered.
    const detail = el('pre', 'approval__detail mono', summary.detail)
    card.appendChild(detail)
  }

  // Silence would read as "the string ended here", which is exactly the misreading that lets a
  // second command after an `&&` through.
  if (summary.truncated) {
    card.appendChild(el('p', 'approval__more', 'cut for length — there is more to this call'))
  }

  if (summary.rest.length > 0) {
    card.appendChild(el('p', 'approval__rest mono', summary.rest.join('  ')))
  }

  const actions = el('div', 'approval__actions')

  const refuse = el('button', 'btn btn--sm approval__act--refuse', 'Refuse')
  refuse.type = 'button'
  refuse.addEventListener('click', () => on.onDecide(request, false))
  actions.appendChild(refuse)

  const allow = el('button', 'btn btn--sm approval__act--allow', 'Allow once')
  allow.type = 'button'
  allow.addEventListener('click', () => on.onDecide(request, true))
  actions.appendChild(allow)

  card.appendChild(actions)
  return card
}

/**
 * What the heading claims, which is only ever what we could actually read.
 *
 * The count is the first thing on this zone and a bare number reads as settled — somebody
 * scanning for what they were in the middle of takes it for the answer and stops. It is the
 * answer only when the ledger opened and every line in it parsed. In the other two cases it is a
 * count of what we managed to read, and the reason travels with the number rather than a line
 * below it, because a caveat under a figure is read second if at all.
 *
 * The lines themselves are still printed below, with their line numbers. This is the summary
 * agreeing with them.
 */
function outstandingCount(report: UnfinishedReport): string {
  const found = report.entries.length
  if (report.problem) return `at least ${found} \u2014 the ledger could not be read`
  if (report.torn.length > 0) {
    const lines = report.torn.length === 1 ? '1 line' : `${report.torn.length} lines`
    return `at least ${found} \u2014 ${lines} of the ledger could not be read`
  }
  return found === 1 ? 'one dispatch has no result' : `${found} dispatches have no result`
}

/**
 * Work that was sent and never came back.
 *
 * The answer to the shrug. `settle()` in `shared/activity.ts` writes *"the turn ended before they
 * reported back"* when a run dies mid-dispatch — a true sentence with nothing after it. This zone
 * is what comes after it: the ledger on disk still holds the brief, so the office can offer the
 * work back rather than mention that it is gone.
 *
 * **Three verbs and no default.** Nothing here happens on a timer, on a redraw, or because a
 * card was ignored. Every one of them either re-opens a conversation, spends a run, or writes off
 * work somebody was waiting for, and an unanswered card that quietly became one of those would be
 * worse than the shrug it replaced.
 */
function neverReported(report: UnfinishedReport, on: ActivityHandlers): HTMLElement {
  const zone = el('section', 'strip__zone strip__zone--attention')

  const head = el('div', 'strip__head')
  head.appendChild(el('h4', 'label', 'Never reported back'))
  head.appendChild(el('span', 'strip__count', outstandingCount(report)))
  zone.appendChild(head)

  // The ledger would not open. Said before anything else, because every count below it is then
  // a count of what we managed to read and not of what is outstanding.
  if (report.problem) {
    zone.appendChild(el('p', 'unfinished__problem', `The dispatch ledger could not be read: ${report.problem}`))
  }

  // Absent is not empty, line by line. A line we cannot parse may be the record of the very
  // dispatch somebody is looking for, so it is shown rather than quietly skipped.
  for (const torn of report.torn) {
    const line = el('p', 'unfinished__torn mono')
    line.appendChild(el('span', 'unfinished__torn-at', `line ${torn.at}`))
    line.appendChild(el('span', 'unfinished__torn-why', `could not be read — ${torn.cause}`))
    line.title = torn.text
    zone.appendChild(line)
  }

  for (const entry of report.entries) zone.appendChild(unfinishedCard(entry, on))

  return zone
}

function unfinishedCard(entry: Dispatch, on: ActivityHandlers): HTMLElement {
  const card = el('div', 'unfinished')

  const top = el('div', 'unfinished__top')
  top.appendChild(el('span', 'unfinished__who', entry.employee))
  top.appendChild(el('span', 'unfinished__at mono', sentLine(entry.sentAt)))
  card.appendChild(top)

  // `textContent` through `el`, always. This is a brief written by a model and stored in a file
  // a person can edit, which is two reasons never to let it near `innerHTML`.
  if (entry.brief) card.appendChild(el('pre', 'unfinished__brief mono', entry.brief))

  // What was supposed to be checked, when the brief carried it. Shown rather than assumed: a
  // retry that dropped the VERIFY would re-send the work without the thing that settles it.
  card.appendChild(
    entry.verify
      ? el('p', 'unfinished__verify mono', `VERIFY ${entry.verify}`)
      : el('p', 'unfinished__verify unfinished__verify--none', 'No VERIFY was recorded for this dispatch.'),
  )

  const actions = el('div', 'unfinished__actions')

  const drop = el('button', 'btn btn--sm unfinished__act--drop', 'Drop')
  drop.type = 'button'
  drop.title = 'Write down that nobody is waiting for this. Deletes nothing and stops nothing.'
  drop.addEventListener('click', () => on.onUnfinished(entry, 'drop'))
  actions.appendChild(drop)

  const retry = el('button', 'btn btn--sm unfinished__act--retry', 'Retry')
  retry.type = 'button'
  retry.title = 'Put the re-dispatch brief in the composer, carrying what came back last time. Sends nothing.'
  retry.addEventListener('click', () => on.onUnfinished(entry, 'retry'))
  actions.appendChild(retry)

  const resume = el('button', 'btn btn--sm unfinished__act--resume', 'Resume')
  resume.type = 'button'
  resume.title = 'Re-open the conversation that sent this, so you can pick it up where it stopped.'
  resume.addEventListener('click', () => on.onUnfinished(entry, 'resume'))
  actions.appendChild(resume)

  card.appendChild(actions)
  return card
}

/** `sent 14:32`, or the raw string when it is not a time we can read. */
function sentLine(iso: string): string {
  const shown = clock(iso)
  return shown ? `sent ${shown}` : 'sent at an unrecorded time'
}

/** Who is working, and for how long. A chip you read in a glance, not a sentence you parse. */
function nowRunning(running: readonly Running[], nowMs: number, on: ActivityHandlers): HTMLElement {
  const zone = el('section', 'strip__zone')

  const head = el('div', 'strip__head')
  head.appendChild(el('h4', 'label', 'Running'))
  zone.appendChild(head)

  if (running.length === 0) {
    // Not a blank space. An empty floor and a floor whose events we stopped receiving look the
    // same, and only one of them is fine.
    zone.appendChild(el('p', 'strip__quiet', 'Nobody is mid-task.'))
    return zone
  }

  const chips = el('div', 'strip__chips')
  for (const row of running) {
    const chip = el('button', 'chip')
    chip.type = 'button'
    chip.title = row.brief ?? 'No brief was recorded for this dispatch.'
    if (on.art) chip.appendChild(avatar(row.who, 14, on.art))
    chip.appendChild(el('span', 'chip__who', row.who))
    chip.appendChild(el('span', 'chip__doing mono', row.doing))
    chip.appendChild(el('span', 'chip__age mono', elapsed(row.since, nowMs)))

    // The watchdog, and it is a *label*, not a verdict.
    //
    // Six minutes with nothing arriving for this row is a fact about what the office has heard,
    // and that is all this says. It kills nothing, retries nothing, and does not mark the row
    // failed — the chip still says the person is running, because as far as anyone here knows
    // they are. Claiming otherwise would be inventing an ending, which is the exact thing the
    // third standing order forbids.
    const quiet = quietFor(row, nowMs)
    if (quiet !== null) {
      const mark = el('span', 'chip__quiet mono', quietNotice(quiet))
      mark.title =
        'Nothing has arrived for this dispatch in that time. It may still be working — the ' +
        'office has stopped hearing, which is not the same as the work stopping.'
      chip.appendChild(mark)
    }

    chip.addEventListener('click', () => on.onOpen(row.who))
    chips.appendChild(chip)
  }
  zone.appendChild(chips)

  return zone
}

/** The log. Newest first, capped in the model, and never the whole transcript. */
function whatHappened(history: readonly Entry[]): HTMLElement {
  const zone = el('section', 'strip__zone')

  const head = el('div', 'strip__head')
  head.appendChild(el('h4', 'label', 'Happened'))
  zone.appendChild(head)

  if (history.length === 0) {
    zone.appendChild(el('p', 'strip__quiet', 'Nothing yet this session.'))
    return zone
  }

  const list = el('div', 'strip__log')
  for (const { entry, count } of collapse(history)) {
    const row = el('div', `logline logline--${entry.kind}`)
    row.appendChild(el('span', 'logline__who', entry.who))
    // Rebuilt from a transcript on relaunch, not watched happening. The office was not running
    // when this occurred and can vouch for nothing the file does not record, so the line says
    // where it came from instead of sitting among today's as though it were the same claim.
    if (entry.restored) row.appendChild(el('span', 'logline__earlier', 'earlier'))
    row.appendChild(el('span', 'logline__text', entry.text))
    // The count, only when there is one worth showing. A silent "×1" on every ordinary line
    // would be noise added while removing noise.
    if (count > 1) row.appendChild(el('span', 'logline__count mono', `×${count}`))
    row.appendChild(el('span', 'logline__at mono', clock(entry.at)))
    list.appendChild(row)
  }
  zone.appendChild(list)

  return zone
}

/** `14:32`. The date is the session's; only the time distinguishes two lines in it. */
function clock(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}
