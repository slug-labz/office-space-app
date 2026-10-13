/**
 * The record: what a turn actually did.
 *
 * This is the other half of taking tool calls out of the transcript. The conversation reads as
 * a conversation because the mechanism is not in it; the mechanism is still *there* because
 * this exists and one click reaches it. Remove either half and the feature is either clutter or
 * a lie.
 *
 * A drawer over the panel rather than a modal in the middle of the window, and the reason is
 * about what it holds: these steps are *about* the conversation behind them. A modal covering
 * the whole window would take away the thing you clicked from, which is the context that makes
 * the steps mean anything.
 *
 * Everything here came from a tool. `textContent`, always.
 */

import type { Ledger, Step } from './steps.js'

export interface Record {
  /** Show a turn's steps. Replaces whatever was open. */
  open(ledger: Ledger): void
  close(): void
}

export function mountRecord(host: HTMLElement): Record {
  let panel: HTMLElement | null = null

  const close = () => {
    panel?.remove()
    panel = null
  }

  return {
    close,
    open(ledger: Ledger) {
      close()

      const el = document.createElement('div')
      el.className = 'record'

      const head = document.createElement('header')
      head.className = 'record__head'

      const title = document.createElement('h3')
      title.className = 'record__title'
      const n = ledger.length
      title.textContent = n === 1 ? 'What this turn did — 1 step' : `What this turn did — ${n} steps`
      head.appendChild(title)

      const shut = document.createElement('button')
      shut.type = 'button'
      shut.className = 'control'
      shut.style.marginLeft = 'auto'
      shut.textContent = 'close'
      shut.addEventListener('click', close)
      head.appendChild(shut)

      const list = document.createElement('div')
      list.className = 'record__list'
      for (const step of ledger.all) list.appendChild(row(step))

      el.append(head, list)
      host.appendChild(el)
      panel = el

      // Focus goes to the close button so Escape and Tab both behave, and so a keyboard user
      // is not left with focus on a mark that is now behind a drawer.
      shut.focus()
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') close()
      })
    },
  }
}

/**
 * One step.
 *
 * The state word is the honest part, and there are four of them because any fewer forces one to
 * be a lie. `running` means the result has not come back yet. `unknown` means it never will —
 * the office closed mid-step and a saved transcript cannot gain a result afterwards. Neither is
 * a synonym for `failed`, which is reserved for a tool that actually said no.
 */
function row(step: Step): HTMLElement {
  const el = document.createElement('div')
  el.className = 'step'

  const head = document.createElement('div')
  head.className = 'step__head'

  const tool = document.createElement('span')
  tool.className = 'step__tool'
  tool.textContent = step.tool
  head.appendChild(tool)

  if (step.argument) {
    const arg = document.createElement('span')
    arg.className = 'step__arg'
    arg.textContent = step.argument
    head.appendChild(arg)
  }

  const state = document.createElement('span')
  state.className = 'step__state'
  state.dataset['state'] = step.outcome ?? 'open'
  state.textContent =
    step.outcome === 'failed'
      ? 'failed'
      : step.outcome === 'ok'
        ? 'ok'
        : step.outcome === 'unknown'
          ? 'unknown'
          : 'running'
  head.appendChild(state)

  el.appendChild(head)

  // An empty result is a real answer and a different one from no result at all — a command that
  // printed nothing succeeded silently. Only a step with no result yet has no detail.
  if (step.detail !== null) {
    const detail = document.createElement('pre')
    detail.className = 'step__detail'
    detail.textContent = step.detail || '(no output)'
    el.appendChild(detail)
  }

  return el
}
