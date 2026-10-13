/**
 * What runs on a hook, drawn.
 *
 * `VISION.md` §2 lists hooks beside agents, skills, commands, MCPs, memory and projects. Every
 * other item on that list has had a surface for weeks. This one had none, on the app that writes
 * an executable into your workspace and routes your tool calls through it.
 *
 * ## The panel is organised by the join, not by the directory
 *
 * A person opening this wants three things, and they are the three the office could not answer:
 * *what hooks exist*, *what fires them*, and *what did you put there*. So a row is a
 * **registration** — an event, a matcher and a command — and the file is a property of it. A
 * listing of `.claude/hooks/` would look like an answer and be a different question: a file in
 * that directory that nothing registers never runs, and this repository shipped exactly that for
 * weeks with a green suite.
 *
 * Those files still get a section, at the bottom, headed by what is true about them: they are
 * there and nothing runs them.
 *
 * ## Four wirings, drawn four ways
 *
 * `wired`, `file-missing`, `elsewhere` and `unknown` each get their own line and their own edge.
 * The temptation is a ternary — *is the file there, yes or no* — and it is the single most
 * repeated bug in this codebase: the roster once warned it could not read the staff and printed
 * "Nobody works here yet" underneath, on the one screen whose job is showing who works here.
 * **We could not look** is not **we looked and found nothing**, and here the confident wrong
 * answer is *"your approval gate is gone"*, which sends somebody hunting a problem they may not
 * have.
 */

import {
  describeEvent,
  describeMatcher,
  hooksLede,
  type Hook,
  type HookFile,
  type HookOrigin,
  type HookSource,
  type HooksReport,
} from '../../shared/hooks.js'
import { line } from './work.js'

export function renderHooks(host: HTMLElement, report: HooksReport): void {
  host.replaceChildren()
  host.appendChild(line('hooks__lede', hooksLede(report)))

  /*
   * The directory problem is said here and does **not** stop the list below it.
   *
   * Unlike the memory panel, which returns on an unreadable directory because everything under it
   * would have been about that directory. Here the two halves come from different reads: settings
   * still tell us what is registered even when `.claude/hooks/` will not open. Hiding the
   * registrations would throw away the half we do know — and every one of them is already carried
   * as `unknown` rather than as present or missing, so nothing below can overstate itself.
   */
  if (report.directoryProblem !== null) {
    host.appendChild(line('hooks__problem', `${report.directoryProblem} — so whether each file is there is unknown.`))
  }

  for (const group of groupByEvent(report.hooks)) {
    host.appendChild(eventHeading(group.event))
    for (const hook of group.hooks) host.appendChild(card(hook))
  }

  if (report.hooks.length === 0) host.appendChild(nothingRegistered(report))

  if (report.inert.length > 0) {
    host.appendChild(line('hooks__group', 'In .claude/hooks/ and never run'))
    host.appendChild(
      line(
        'hooks__note',
        'Nothing in any settings file names these, so Claude Code never starts them. A hook file ' +
          'is a claim that something is gated; an unregistered one is a file.',
      ),
    )
    for (const file of report.inert) host.appendChild(inertCard(file))
  }

  host.appendChild(line('hooks__group', 'Where this was read from'))
  for (const source of report.sources) host.appendChild(sourceRow(source))

  /*
   * Said only when it could actually bite, and never resolved.
   *
   * Which file wins when two register the same event was not measured against the installed CLI,
   * so this panel does not say. A plausible order invented here would be believed — and the rule
   * this office keeps is that a confident guess is worse than an admitted gap. The sentence is
   * withheld when only one file registered anything, because then there is no order to wonder
   * about and a warning about one would be chrome.
   */
  if (report.sources.filter((s) => s.registrations > 0).length > 1) {
    host.appendChild(
      line(
        'hooks__note',
        'More than one settings file registers hooks. They are all listed above; which takes ' +
          'precedence when two declare the same thing has not been established here, so this ' +
          'panel does not say.',
      ),
    )
  }
}

// ─────────────────────────────────────────────────────────────────────── groups ──

/** The hooks, in the order `buildReport` sorted them, split where the event changes. */
function groupByEvent(hooks: readonly Hook[]): readonly { event: string; hooks: readonly Hook[] }[] {
  const out: { event: string; hooks: Hook[] }[] = []
  for (const hook of hooks) {
    const last = out[out.length - 1]
    if (last && last.event === hook.registration.event) last.hooks.push(hook)
    else out.push({ event: hook.registration.event, hooks: [hook] })
  }
  return out
}

/**
 * The event, and when it fires.
 *
 * The description is the answer to half the question this panel exists for. An event we do not
 * recognise says so rather than being dropped or being given a plausible sentence — the CLI may
 * have added it since this build, and a hook that genuinely fires must not vanish from the list
 * of what fires because a word was unfamiliar.
 */
function eventHeading(event: string): HTMLElement {
  const el = document.createElement('p')
  el.className = 'hooks__group'

  const name = document.createElement('span')
  name.className = 'hooks__event mono'
  name.textContent = event
  el.appendChild(name)

  const when = describeEvent(event)
  const rest = document.createElement('span')
  rest.className = when === null ? 'hooks__when hooks__when--unknown' : 'hooks__when'
  rest.textContent = when === null ? ' — an event this app does not recognise' : ` — ${when}`
  el.appendChild(rest)

  return el
}

// ──────────────────────────────────────────────────────────────────────── a hook ──

/**
 * The class for one wiring, written out rather than interpolated.
 *
 * `hookcard--${state}` is shorter and it hides all four names from every tool that reads the
 * stylesheet — `css-applied.test.ts` reported the four as styled by nothing, which is exactly the
 * check that once caught the macOS traffic-light clearance being handed to a deleted element.
 * A class that cannot be grepped from the CSS to the code is a class nobody can delete safely.
 */
function classFor(wiring: Hook['wiring']): string {
  switch (wiring.state) {
    case 'wired':
      return 'hookcard hookcard--wired'
    case 'file-missing':
      return 'hookcard hookcard--file-missing'
    case 'elsewhere':
      return 'hookcard hookcard--elsewhere'
    case 'unknown':
      return 'hookcard hookcard--unknown'
  }
}

function card(hook: Hook): HTMLElement {
  const el = document.createElement('article')
  el.className = classFor(hook.wiring)

  // The command first and in full. It is the thing that actually runs, and every other line on
  // the card is a fact about it.
  const command = document.createElement('p')
  command.className = 'hookcard__command mono'
  command.textContent = hook.registration.command
  el.appendChild(command)

  el.appendChild(line('hookcard__state', stateOf(hook)))
  el.appendChild(line('hookcard__meta', metaOf(hook)))

  return el
}

/** What is true about this hook's file, in a sentence. Four answers, never three. */
function stateOf(hook: Hook): string {
  switch (hook.wiring.state) {
    case 'wired':
      return `Runs .claude/hooks/${hook.wiring.file.name} — ${originOf(hook.wiring.file.origin)}`
    case 'file-missing':
      // The dangerous one. Settings promise something is checking and nothing is, and on a
      // `PreToolUse` stanza that is the difference between a gated workspace and an ungated one
      // that looks gated.
      return `Names .claude/hooks/${hook.wiring.name}, which is not there. It will fail every time it fires.`
    case 'elsewhere':
      // Not a fault, and not dressed as one. We can see it is registered; we cannot see whether
      // what it names exists, and saying so is the whole of what we know.
      return 'Runs something outside .claude/hooks/, so whether it is there was not checked.'
    case 'unknown':
      return `Whether its file is there could not be checked — ${hook.wiring.cause}`
  }
}

/** Who put the file there, in the words the manifest can actually support. */
function originOf(origin: HookOrigin): string {
  switch (origin) {
    case 'shipped':
      return 'the office put it there, and it is unchanged'
    case 'shipped-edited':
      return 'the office put it there, and it has been edited since'
    case 'yours':
      return 'not something this app ships'
    case 'unknown':
      // Never `yours`. Claiming somebody wrote a file we could not check is the same mistake as
      // calling an unreadable directory empty.
      return 'who added it could not be determined'
  }
}

/** The second line: what it matches, where it was declared, and how long it may take. */
function metaOf(hook: Hook): string {
  const { event, matcher, timeoutSeconds, unknownType, path } = hook.registration
  const parts = [describeMatcher(event, matcher), `declared in ${path}`]

  if (timeoutSeconds !== null) parts.push(`killed after ${timeoutSeconds}s`)

  // A hook whose `type` is not `command` is a kind this app has never seen. Listed as declared,
  // because guessing what it does would be worse than admitting the gap.
  if (unknownType !== null) parts.push(`declared type "${unknownType}", which this app does not recognise`)

  return parts.join(' · ')
}

// ────────────────────────────────────────────────────────────────── inert files ──

function inertCard(file: HookFile): HTMLElement {
  const el = document.createElement('article')
  el.className = 'hookcard hookcard--inert'

  const name = document.createElement('p')
  name.className = 'hookcard__command mono'
  name.textContent = `.claude/hooks/${file.name}`
  el.appendChild(name)

  el.appendChild(line('hookcard__state', `Never run — ${originOf(file.origin)}`))
  return el
}

// ───────────────────────────────────────────────────────────────────── the reads ──

/**
 * One settings file, and what came of consulting it.
 *
 * A file that is not there is listed rather than omitted, so the section answers *"did you look
 * in my local settings?"* rather than leaving a person to infer it from a gap.
 */
function sourceRow(source: HookSource): HTMLElement {
  const el = document.createElement('p')
  el.className = source.state === 'ok' || source.state === 'missing' ? 'hooks__source' : 'hooks__source hooks__source--bad'

  const path = document.createElement('span')
  path.className = 'mono'
  path.textContent = source.path
  el.appendChild(path)

  el.appendChild(document.createTextNode(` — ${saidOf(source)}`))
  return el
}

function saidOf(source: HookSource): string {
  switch (source.state) {
    case 'ok':
      return source.registrations === 0
        ? 'read, and it registers no hooks'
        : source.registrations === 1
          ? 'read, and it registers 1 hook'
          : `read, and it registers ${source.registrations} hooks`
    case 'missing':
      return 'not there, so it registers nothing'
    case 'unreadable':
      return `there, and could not be read, so anything it registers is missing from this list — ${source.cause}`
    case 'unparsable':
      // The silent one. Claude Code ignores a settings file that fails validation without saying
      // so, which means a trailing comma turns off every hook in the file and nothing anywhere
      // mentions it. This panel is not going to be the second thing keeping that quiet.
      return `not valid JSON, so Claude Code ignores it silently and none of its hooks run — ${source.cause}`
  }
}

// ─────────────────────────────────────────────────────────────── nothing at all ──

/**
 * The empty state, which is three different sentences.
 *
 * Only the first is good news, and it is the only one reachable when every source was read. The
 * other two exist because *"nothing runs here"* is a claim, and a panel that could not read the
 * settings has not established it.
 */
function nothingRegistered(report: HooksReport): HTMLElement {
  if (report.incomplete) {
    return line(
      'hooks__empty',
      'No hooks could be listed, and at least one settings file could not be used — so this is ' +
        'not the same as a workspace with no hooks. Fix the file named above and reopen this.',
    )
  }

  if (report.inert.length > 0) {
    return line(
      'hooks__empty',
      'Nothing is registered, so none of the files below run. Whatever they were meant to gate ' +
        'is not being gated.',
    )
  }

  return line(
    'hooks__empty',
    'No hook is registered in this workspace, and there are no hook files waiting to be. Nothing ' +
      'runs before or after what the office does.',
  )
}
