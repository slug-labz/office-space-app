/**
 * The privacy panel — what leaves, what is kept, and the exact words that were sent.
 *
 * Three sections, and the third is the one that was missing from the plan until round 18.
 * Laptop 2 wrote the "doesn't leak" exit condition counting network destinations; the largest
 * thing this app sends is not a destination at all, it is **the prompt it assembles itself**.
 * `withOfficeContext()` prepends blocks to every message and until now the user had no way to
 * know what the office added to their words. That correction was accepted in round 19, and this
 * section is it.
 *
 * The panel's one rule: **every number here is measured, none is assumed.** A store that could
 * not be read says so rather than reporting zero, and a store that has never existed says that
 * rather than reporting empty — those are three different facts and a panel that draws them the
 * same is a panel that cannot be trusted with the question it exists to answer.
 */

import type { Egress, MeasuredStore, PrivacyReport } from '../../main/privacy.js'
import type { Unread } from '../../shared/privacy-view.js'
import { egressCaveat, egressLede, humanBytes, sizeLine } from '../../shared/privacy-view.js'
import { rowsSayVerdict, saidPlainly, sharingLede } from '../../shared/sharing.js'
import type { SharingRow } from '../../shared/ipc.js'

export interface PrivacyHandlers {
  /** Delete one `yours` store. The caller confirms; this only reports the click. */
  readonly onForget: (path: string) => void
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

export function renderPrivacy(
  host: HTMLElement,
  report: PrivacyReport,
  on: PrivacyHandlers,
  sharing: readonly SharingRow[] | null,
): void {
  host.replaceChildren()
  // First, because it is the question with a wrong answer that cannot be taken back. What leaves
  // at runtime goes to a service; what leaves in a push goes to everyone who clones the office.
  host.appendChild(sharingSection(sharing))
  host.appendChild(egressSection(report.egress, report.unreadSources))
  host.appendChild(storesSection(report.stores, on))
  host.appendChild(promptSection(report.lastPrompt))
}

/**
 * What a push would carry, and what it would leave behind.
 *
 * VISION.md §7: *"Memory and personal data are never pushed. The repo ships the office; the
 * contents stay yours."* `.gitignore` has always implemented that and nothing has ever shown it.
 *
 * The answer comes from git — see `shared/sharing.ts` for why a table in our own source would be
 * wrong in exactly the direction nobody notices.
 */
function sharingSection(rows: readonly SharingRow[] | null): HTMLElement {
  const section = el('section', 'roster__section')
  const head = el('div', 'roster__head')
  head.appendChild(el('h4', 'label', 'What a push would carry'))
  section.appendChild(head)

  // `!rows` rather than `=== null`: absent and null both mean nobody got an answer, and this is
  // the one panel where an empty list would be read as "nothing would be pushed".
  if (!rows) {
    // Never an empty list. A failure to ask is not an answer of "nothing would be pushed", and
    // this is the one panel where the two would be read as the same sentence.
    section.appendChild(el('p', 'share__lede', 'Git could not be asked what a push would carry.'))
    return section
  }

  const verdicts = rows.map((r) => r.verdict)
  section.appendChild(el('p', 'share__lede', sharingLede(verdicts)))
  // See `rowsSayVerdict`: when the lede has already answered for every row, repeating it on each
  // of them is seven copies of one sentence with nothing to distinguish them.
  const saySo = rowsSayVerdict(verdicts)

  for (const row of rows) {
    const item = el('div', `share ${TONE[row.verdict]}`)
    item.appendChild(el('p', 'share__path mono', row.path))
    if (saySo) item.appendChild(el('p', 'share__said', saidPlainly(row.what, row.verdict)))
    if (row.detail !== null) item.appendChild(el('p', 'share__detail mono', row.detail))
    section.appendChild(item)
  }

  return section
}

/*
 * Written out, not interpolated.
 *
 * `share--${row.verdict}` is invisible to the check that every styled class is applied somewhere
 * — it can see a rule for `.share--kept` and no literal to match it, so a rule that is really in
 * use reads as dead, and a rule that is really dead would read the same. A lookup keeps both
 * answerable.
 */
const TONE: Record<SharingRow['verdict'], string> = {
  kept: 'share--kept',
  shared: 'share--shared',
  leaking: 'share--leaking',
  withheld: 'share--withheld',
  nowhere: 'share--nowhere',
  unknown: 'share--unknown',
}

/** Everything that can reach off this machine, and who reaches it. */
function egressSection(egress: readonly Egress[], unread: readonly Unread[]): HTMLElement {
  const section = el('section', 'roster__section')

  const head = el('div', 'roster__head')
  head.appendChild(el('h4', 'label', 'What leaves this machine'))
  head.appendChild(el('span', 'roster__count', `${egress.length}`))
  section.appendChild(head)

  // Derived, never asserted. See `egressLede` — this line was a constant that stopped being
  // true the day a feature reached the network, and said so for as long as nobody noticed.
  section.appendChild(el('p', 'roster__desc', egressLede(egress)))

  // The rows below are the servers a scan found. When a config would not open there is one
  // fewer row and nothing else changes, so the panel has to say so — a short list is the
  // reassuring answer and therefore the one nobody thinks to check.
  const caveat = egressCaveat(unread)
  if (caveat !== null) section.appendChild(el('p', 'roster__desc roster__desc--problem', caveat))

  for (const item of egress) {
    const row = el('div', `roster__row${item.active ? '' : ' roster__row--off'}`)

    const top = el('div', 'roster__top')
    top.appendChild(el('span', 'roster__name', item.what))

    // Whose destination this is. The lede counts these; the badge is how you find them, and
    // without it "reaches 3 hosts of its own" would be a number with nothing to point at.
    if (item.who === 'office-space') {
      top.appendChild(el('span', 'roster__badge roster__badge--warning', 'ours'))
    }

    top.appendChild(
      el(
        'span',
        `roster__badge${item.active ? '' : ' roster__badge--off'}`,
        // Written down is not reachable, and this is the last place those two should blur.
        item.active ? 'live' : 'not reached',
      ),
    )
    row.appendChild(top)
    row.appendChild(el('p', 'roster__tools mono', item.detail))
    section.appendChild(row)
  }

  return section
}

/** Every path the office reads or writes, measured, with a delete on the ones that are yours. */
function storesSection(stores: readonly MeasuredStore[], on: PrivacyHandlers): HTMLElement {
  const section = el('section', 'roster__section')

  const yours = stores.filter((s) => s.kind === 'yours')
  const total = yours.reduce((sum, s) => sum + s.bytes, 0)

  const head = el('div', 'roster__head')
  head.appendChild(el('h4', 'label', 'What is kept'))
  head.appendChild(el('span', 'roster__count', `${humanBytes(total)} of yours`))
  section.appendChild(head)

  // Yours first. Somebody opening this panel is asking about their own data, and making them
  // scroll past the app's own template files to find it is answering a different question.
  for (const store of [...yours, ...stores.filter((s) => s.kind === 'template')]) {
    section.appendChild(storeRow(store, on))
  }

  return section
}

function storeRow(store: MeasuredStore, on: PrivacyHandlers): HTMLElement {
  const row = el('div', `roster__row${store.state === 'present' ? '' : ' roster__row--off'}`)

  const top = el('div', 'roster__top')
  top.appendChild(el('span', 'roster__name', store.path))
  top.appendChild(
    el('span', `roster__badge${store.kind === 'yours' ? '' : ' roster__badge--off'}`, store.kind),
  )
  top.appendChild(el('span', 'roster__uses mono', sizeLine(store)))
  row.appendChild(top)

  row.appendChild(el('p', 'roster__desc', store.what))
  row.appendChild(el('p', 'roster__tools mono', store.where))

  if (store.kind === 'yours' && store.state === 'present') {
    const actions = el('div', 'roster__actions')
    actions.appendChild(forgetButton(store, on))
    row.appendChild(actions)
  }

  return row
}

/**
 * Delete, behind a confirmation in the button itself.
 *
 * Same arming as firing an employee and for the same reason: this is `rm -rf` on somebody's
 * work, `window.confirm` does not exist usefully in a sandboxed renderer, and a label that
 * changes is a confirmation the keyboard reaches and a screen reader announces.
 */
function forgetButton(store: MeasuredStore, on: PrivacyHandlers): HTMLButtonElement {
  const button = el('button', 'btn btn--sm btn--danger roster__act', 'Delete')
  button.type = 'button'
  let armed = false

  const disarm = () => {
    armed = false
    button.textContent = 'Delete'
    button.classList.remove('roster__act--armed')
  }

  button.addEventListener('click', () => {
    if (!armed) {
      armed = true
      button.textContent = store.precious
        ? `Delete ${humanBytes(store.bytes)} permanently — click again`
        : 'Delete — click again'
      button.classList.add('roster__act--armed')
      return
    }
    disarm()
    on.onForget(store.path)
  })
  button.addEventListener('blur', disarm)

  return button
}

/** The exact string that was sent last. Not a summary of it, and not the part you typed. */
function promptSection(lastPrompt: string | null): HTMLElement {
  const section = el('section', 'roster__section')

  const head = el('div', 'roster__head')
  head.appendChild(el('h4', 'label', 'The last thing sent'))
  section.appendChild(head)

  if (lastPrompt === null) {
    // Nothing sent is not an empty prompt, and the sentence has to be the first of those.
    section.appendChild(
      el('p', 'roster__empty', 'This conversation has not sent anything yet.'),
    )
    return section
  }

  section.appendChild(
    el(
      'p',
      'roster__desc',
      'Verbatim, including the blocks the office added above your message. This is the whole string that went to the CLI.',
    ),
  )

  const pre = el('pre', 'privacy__prompt mono', lastPrompt)
  section.appendChild(pre)

  const meta = el('p', 'roster__tools mono')
  // Characters, not tokens. We do not have a tokeniser and an estimate presented as a count is
  // the kind of number people repeat back as fact.
  meta.textContent = `${lastPrompt.length.toLocaleString()} characters`
  section.appendChild(meta)

  return section
}
