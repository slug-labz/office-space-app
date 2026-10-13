/**
 * What an employee actually did, drawn from their own record.
 *
 * Builds DOM from an `EmployeeWork` the caller has already fetched. The distinction this file
 * has to keep is between *finished* and *still running* — a step that had not settled when we
 * looked says so, because showing it as done would be inventing an ending.
 */

import type { EmployeeWork } from '../../shared/ipc.js'
import { truncate } from '../../shared/truncate.js'

export function line(className: string, text: string): HTMLElement {
  const el = document.createElement('p')
  el.className = className
  el.textContent = text
  return el
}

/** The one argument that says what a step was doing. Same idea as the transcript's. */
export function summariseWork(input: Record<string, unknown>): string {
  const first =
    input['file_path'] ?? input['command'] ?? input['pattern'] ?? input['path'] ?? input['url'] ?? input['description']
  if (typeof first !== 'string') return ''
  return truncate(first, 90)
}

/** Fill `host` with this employee's steps. */
export function renderWorkLog(host: HTMLElement, work: EmployeeWork): void {
  host.replaceChildren()

  if (work.problem) {
    host.appendChild(line('work work--failed', work.problem))
    return
  }

  if (work.truncated > 0) {
    host.appendChild(line('work', `…${work.truncated} earlier steps not shown`))
  }

  for (const entry of work.entries) {
    switch (entry.kind) {
      case 'assistant':
        host.appendChild(line('work work--said', entry.text))
        break

      case 'tool': {
        const el = document.createElement('p')
        el.className = entry.isError ? 'work work--failed' : 'work'

        const name = document.createElement('span')
        name.className = 'work__tool'
        name.textContent = entry.name
        el.appendChild(name)

        const argument = summariseWork(entry.input)
        if (argument) {
          el.appendChild(document.createTextNode(' '))
          const arg = document.createElement('span')
          arg.className = 'work__arg'
          arg.textContent = argument
          el.appendChild(arg)
        }

        // Still running when we looked. Not the same as finished, and not shown as it.
        if (!entry.settled) el.appendChild(document.createTextNode(' — still running'))

        host.appendChild(el)
        break
      }

      // Their own prompt and their thinking are not what "what did they do" means.
      default:
        break
    }
  }

  if (host.childElementCount === 0) {
    host.appendChild(line('work', 'Their record has no steps in it yet.'))
  }

  // Which dispatch this record is.
  //
  // The id was already being measured and sent — `EmployeeWork.toolUseId` says in its own
  // comment that it exists "so a claim can be checked against the transcript" — and then
  // nothing read it. A field whose stated purpose is verification, and which no surface offers,
  // is the second standing order written down and not kept.
  //
  // It names one `Task` call in the manager's transcript and one `sent` line in the ledger. With
  // it on screen, "the tester says the suite passes" and "this is the run where they said it"
  // stop being two things a person has to match by eye.
  //
  // Last, and after the empty check on purpose: a run with no steps still gets to say which run
  // it was, because an empty record and an unidentifiable one are different problems.
  if (work.toolUseId) {
    host.appendChild(line('work work--trace', `dispatch ${work.toolUseId}`))
  }
}
