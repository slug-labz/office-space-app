/**
 * Connecting a service, drawn.
 *
 * VISION.md's sixth section: *"The connector should just work like Claude Code... We just need to
 * wire them in the frontend properly."* The office could already read `.mcp.json` and say what
 * the staff can reach. This is the half that writes one.
 *
 * ## Two things this panel must not say
 *
 * **"Connected."** `capabilities.ts` is explicit: *"a `.mcp.json` server stays inert until a
 * person approves it in Claude Code... the UI must say 'configured', never 'connected'."* Writing
 * a file is not a login and does not start anything, so the sentence after a successful write is
 * `whatWritingDoes`, which says what did happen and what has not.
 *
 * **A blank where a value would go.** The two fields that would hold a secret hold the *name* of
 * an environment variable, and every hint under them says so, before somebody pastes rather than
 * after they are refused. The refusal is good; not needing it is better.
 *
 * ## Removable is a narrower thing than visible
 *
 * The list shows every server the survey found, including ones from the machine-wide config —
 * that is what makes it an honest answer to *what can the staff reach*. Only the ones this
 * workspace's own `.mcp.json` declares get a remove control, because the rest are somebody's
 * setup for every project they have, and a button here would reach a long way outside this one.
 */

import { whatWritingDoes, type Transport } from '../../shared/connector.js'
import type { CapabilityReport } from '../../shared/ipc.js'
import type { Problem } from '../../main/workspace.js'
import { line } from './work.js'

/** The status words, said the way a person would rather than the way a config does. */
function statusOf(status: string): { readonly said: string; readonly tone: string } {
  if (status === 'connected') return { said: 'answering', tone: 'conn__state--live' }
  if (status === 'failed') return { said: 'tried, and did not answer', tone: 'conn__state--failed' }
  // The default, and the honest one: it is written down. Nobody has established anything more.
  return { said: 'configured — declared here, not yet answered', tone: 'conn__state--configured' }
}

export function renderConnectors(
  host: HTMLElement,
  report: CapabilityReport | null,
  ours: readonly string[],
  onRemove: (name: string) => void,
): void {
  host.replaceChildren()

  if (report === null) {
    // The survey failing is not a workspace with no connectors. The fourth standing order, in the
    // panel whose whole subject is what has been configured.
    host.appendChild(
      line('conn__problem', 'What the staff can reach could not be read, so nothing here is a list of connectors.'),
    )
    return
  }

  /*
   * A config that would not open, named before the list under it.
   *
   * Found by opening this panel on a workspace whose `.mcp.json` was one line of broken JSON: the
   * list showed a single machine-wide server, looked complete, and said nothing. `capabilities.ts`
   * had the answer the whole time — its `sources` marks that file `unreadable` and its `problems`
   * carries the parse error — and this panel, whose entire subject is that file, read neither.
   *
   * Above the list rather than instead of it: the servers shown are really declared, and the point
   * is that the list is **short**, not that it is wrong. A count of what we managed to read is not
   * a count. Fourth standing order.
   */
  const unreadable = report.sources.filter((source) => source.state === 'unreadable')
  for (const source of unreadable) {
    // Narrowed, not asserted. `Problem` is a union and only the two `unreadable-*` kinds carry a
    // cause — a `lint` at the same path carries a `rule` and a `detail` instead, and reaching for
    // `.cause` on it would print `undefined` where the reason belongs.
    const found = report.problems.find(
      (problem): problem is Extract<Problem, { cause: string }> =>
        problem.path === source.path &&
        (problem.kind === 'unreadable-file' || problem.kind === 'unreadable-dir'),
    )
    const why = found?.cause
    host.appendChild(
      line(
        'conn__problem',
        `${source.path} could not be read, so any server it declares is missing from this list${
          why ? ` — ${why}` : ''
        }`,
      ),
    )
  }

  if (report.servers.length === 0) {
    host.appendChild(
      line(
        'conn__empty',
        unreadable.length > 0
          ? 'Nothing readable is connected. Adding one below goes into .mcp.json, which will refuse while it cannot be parsed.'
          : 'No services are connected. Add one below and it goes into .mcp.json.',
      ),
    )
    return
  }

  for (const server of report.servers) {
    const el = document.createElement('article')
    el.className = 'conn'

    const name = document.createElement('h4')
    name.className = 'conn__name'
    name.textContent = server.name
    el.appendChild(name)

    const { said, tone } = statusOf(server.status)
    el.appendChild(line(`conn__state ${tone}`, said))
    el.appendChild(line('conn__where', `${server.transport} · ${server.scope}`))

    if (ours.includes(server.name)) {
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'btn conn__remove'
      remove.textContent = `Remove ${server.name}`
      remove.addEventListener('click', () => onRemove(server.name))
      el.appendChild(remove)
    } else {
      // Said rather than left as an unexplained gap: the same list holds rows with a button and
      // rows without, and the difference is not a property of the server but of where it lives.
      el.appendChild(
        line('conn__blocked', 'Declared outside this workspace, so it is not this office’s to remove.'),
      )
    }

    host.appendChild(el)
  }
}

/** Which fields belong to which transport, so the form asks for one thing and not both. */
export function fieldsFor(transport: Transport): { readonly stdio: boolean; readonly url: boolean } {
  return { stdio: transport === 'stdio', url: transport !== 'stdio' }
}

/**
 * What to say after a write succeeded.
 *
 * The variables come second and separately, because they are the part somebody still has to do
 * and a sentence that ended at "written" would read as finished.
 */
export function afterWriting(name: string, path: string, variables: readonly string[]): string {
  const said = whatWritingDoes(name, path)
  if (variables.length === 0) return said
  return `${said} Set ${variables.join(' and ')} in your environment — the office wrote the name and never the value.`
}
