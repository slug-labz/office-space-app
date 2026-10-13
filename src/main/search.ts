/**
 * Reading the workspace so it can be searched.
 *
 * `shared/search.ts` decides what a match is and what a silence means. This does the four reads,
 * and its whole job beyond that is to report the ones that failed rather than returning a shorter
 * list. A source that could not be opened must arrive as `blind`, because the alternative is a
 * person being told their workspace does not contain something when the office simply could not
 * look.
 *
 * ## Why conversations are read from the registry rather than from disk
 *
 * There are 553 transcript files under `~/.claude/projects` on this machine, and they are every
 * Claude Code session this person has ever run — most of them nothing to do with this office. The
 * registry lists the sessions *this workspace* started, which is both the honest scope and the
 * reason this does not have to walk a gigabyte to answer a question about your own office.
 *
 * It also means the count is knowable: a search says how many conversations it read, and a
 * transcript that has been deleted from under the registry is one it could not, and says so.
 *
 * ## Every incomplete read is declared, and the three that were not
 *
 * The first version of this handled `memory.unread` and `transcript.unreadable` correctly and
 * dropped three others in between them — the ledger's torn lines, the registry's unusable rows,
 * and every employee's turn. Each was a silence the module exists to refuse, committed inside the
 * module. They are named here so the next thing added to this file is checked against the list:
 *
 * - **`ledger.torn`** — lines `loadLedger` could not parse while still returning `ok`.
 * - **`registry.skipped`** — rows `parseRegistry` could not use, so they are missing from the
 *   count as well as from the search.
 * - **the employees' own records** — their work. Asking `parseTranscript` for `isSidechain` turns
 *   was half of it and read like all of it: an employee's run is a *separate file*, under
 *   `<session>/subagents/`, and nothing here opened one. **Measured 2026-09-17** across this
 *   machine's four office-space folders: 0 of 21,657 main-transcript lines carry `isSidechain`,
 *   all 4,219 lines in the run files do, 18 of 105 sessions in this repo's folder have runs. So a
 *   search could answer "nothing in this workspace matches" about a command the office itself
 *   dispatched. Read below, and the runs that will not open are declared rather than dropped.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { matchesIn, type Blind, type Hit, type Searched, type Source } from '../shared/search.js'
import { readMemory, MEMORY_DIR } from './memory.js'
import { discoverProjects } from './projects.js'
import { loadRegistry } from './registry.js'
import { loadLedger } from './ledger.js'
import { readTranscript } from './transcript-store.js'
import { scanSubagents } from './subagents.js'
import { parseTranscript } from '../shared/transcript/parse.js'
import type { TimelineEntry } from '../shared/transcript/parse.js'
import { newestFirst } from '../shared/time-order.js'

/**
 * The three files the project convention carries.
 *
 * Named rather than discovered, for the reason `CLAUDE.md` gives: these are the convention, and a
 * directory walk would search whatever happened to be sitting in a project folder.
 */
const PROJECT_FILES = ['PLAN.md', 'PROGRESS.md', 'TASKS.md'] as const

/** How many conversations to read. Newest first; the rest are declared, not silently dropped. */
export const CONVERSATION_LIMIT = 60

/**
 * `home` exists for the same reason `readTranscript`'s does: transcripts live under the user's
 * home directory, so a test that cannot move it cannot exercise the conversation path at all —
 * and a guard nobody has watched fail is not yet evidence of anything.
 */
export async function searchWorkspace(root: string, query: string, home?: string): Promise<Searched> {
  const hits: Hit[] = []
  const looked: Source[] = []
  const blind: Blind[] = []

  if (query.trim() === '') return { hits: [], looked: [], blind: [] }

  // ── memory ────────────────────────────────────────────────────────────────────────────────
  const memory = await readMemory(root)
  if (memory.problem !== null) {
    blind.push({ source: 'memory', extent: 'none', why: memory.problem })
  } else {
    looked.push('memory')
    for (const one of memory.memories) {
      hits.push(
        ...matchesIn(one.body, query, 'memory', join(MEMORY_DIR, one.id), { kind: 'memory', id: one.id }),
      )
    }
    /*
     * A memory file that would not parse is a gap in this answer, not a memory with nothing in
     * it. `readMemory` already keeps them apart; losing that here would undo it one layer up.
     */
    for (const one of memory.unread) {
      blind.push({ source: 'memory', extent: 'some', why: `${one.id}: ${one.cause}` })
    }
  }

  // ── projects ──────────────────────────────────────────────────────────────────────────────
  const scan = await discoverProjects(root)
  looked.push('project')
  for (const problem of scan.problems) {
    blind.push({ source: 'project', extent: 'some', why: describe(problem) })
  }
  for (const project of scan.projects) {
    for (const name of PROJECT_FILES) {
      let body: string
      try {
        body = await readFile(join(project.directory, name), 'utf8')
      } catch (err) {
        // A file the convention says should be there and is not is `missing` on the project and
        // already visible elsewhere; only a real read failure is a blind spot for a *search*.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          blind.push({
            source: 'project',
            extent: 'some',
            why: `${project.id}/${name}: ${(err as Error).message}`,
          })
        }
        continue
      }
      hits.push(
        ...matchesIn(body, query, 'project', `${project.id}/${name}`, { kind: 'project', id: project.id }),
      )
    }
  }

  // ── the dispatch ledger ───────────────────────────────────────────────────────────────────
  const ledger = await loadLedger(root)
  if (ledger.state === 'ok') {
    looked.push('dispatch')
    for (const sent of ledger.ledger.sent) {
      /*
       * The brief and the outcome, as one searchable line each. A dispatch is not a file, so
       * these carry `line: null` — the row is the place, and there is nothing below it to point
       * at.
       *
       * And `goto` is `null` for the same kind of reason: there is no dispatch viewer in this app
       * to open. Left as `null` rather than pointed at the project it belongs to, because a
       * control that says "open" and lands somewhere adjacent is worse than no control — the
       * person is now looking at a project page wondering which row they clicked.
       */
      for (const hit of matchesIn(sent.brief, query, 'dispatch', `${sent.employee} · ${sent.sentAt.slice(0, 10)}`)) {
        hits.push({ ...hit, line: null })
      }
    }
    for (const outcome of ledger.ledger.outcomes) {
      for (const hit of matchesIn(outcome.output, query, 'dispatch', `what came back · ${outcome.at.slice(0, 10)}`)) {
        hits.push({ ...hit, line: null })
      }
    }
    /*
     * A torn line in the ledger is a dispatch nobody searched.
     *
     * `loadLedger` returns `ok` *and* a list of lines it could not parse — the file is usable and
     * incomplete at the same time. Reading `.sent` and `.outcomes` while ignoring `.torn` produced
     * an unqualified "nothing in this workspace matches" over a ledger that did contain the term,
     * on a `dispatches.jsonl` killed mid-write. `memory.unread` above and the transcripts below
     * are the same case, handled; this was the one in between that was missed.
     */
    for (const torn of ledger.ledger.torn) {
      blind.push({ source: 'dispatch', extent: 'some', why: `line ${torn.at}: ${torn.cause}` })
    }
  } else if (ledger.state === 'unreadable') {
    blind.push({ source: 'dispatch', extent: 'none', why: ledger.cause })
  } else {
    // `missing` is a workspace that has never dispatched anything. Genuinely searched, and empty.
    looked.push('dispatch')
  }

  // ── conversations ─────────────────────────────────────────────────────────────────────────
  const registry = await loadRegistry(root)
  if (registry.state === 'unreadable') {
    blind.push({ source: 'conversation', extent: 'none', why: registry.cause })
  } else {
    looked.push('conversation')
    const sessions = registry.state === 'ok' ? registry.sessions : []

    /*
     * Rows the registry itself could not use.
     *
     * These are conversations that exist and are not in `sessions`, so they are missing from the
     * search *and* from the `of N` below — a shortfall that does not even show up as a shortfall.
     */
    if (registry.state === 'ok' && registry.skipped > 0) {
      blind.push({
        source: 'conversation',
        extent: 'some',
        why: `${registry.skipped} row${registry.skipped === 1 ? '' : 's'} in the registry could not be read`,
      })
    }

    // By instant, so a conversation whose time will not parse is the first left out rather than the
    // first read. See `time-order.ts`.
    const newest = [...sessions].sort((a, b) => newestFirst(a.updatedAt, b.updatedAt))

    /*
     * Bounded, and the bound is declared rather than hidden.
     *
     * Reading every conversation a busy office has held is the difference between a search that
     * answers and one somebody cancels. Anything past the limit is reported as unsearched — which
     * is the same rule as everywhere else here: a shorter answer must say it is shorter.
     *
     * `extent: 'some'` and not `'none'`: sixty were read. Reported as a total blindness it
     * produced *"this did not search conversation (only the 60 most recent of 553 were read)"*
     * printed above a match found in one of those sixty.
     */
    if (newest.length > CONVERSATION_LIMIT) {
      blind.push({
        source: 'conversation',
        extent: 'some',
        why: `only the ${CONVERSATION_LIMIT} most recent of ${newest.length} were read`,
      })
    }

    for (const session of newest.slice(0, CONVERSATION_LIMIT)) {
      const named = title(session.title, session.id)
      const read = await readTranscript(session.id, session.cwd, home)
      if (read.state === 'missing') {
        blind.push({ source: 'conversation', extent: 'some', why: `${named}: no transcript on disk` })
        continue
      }
      if (read.state === 'unreadable') {
        blind.push({ source: 'conversation', extent: 'some', why: `${named}: ${read.cause}` })
        continue
      }

      /*
       * One torn transcript must not blind the whole answer.
       *
       * `parseTranscript` wraps `JSON.parse` and then dereferences the result, so a line that is
       * literally `null` parses and throws on the next statement. Unwrapped, that landed in the
       * IPC catch-all and produced a panel claiming memory could not be searched — while memory
       * was readable, the failing source was a conversation, and the three sources that *had*
       * been read were reported as unsearched. Every clause of that sentence was wrong.
       */
      try {
        /*
         * `includeSidechain: true` — kept, and not where the employees' work turned out to be.
         *
         * This asked for those turns because an office built on dispatching work needs them, and
         * then called them the bulk of the transcript; the count at the top of this file says no
         * main transcript here holds one. The flag stays for a transcript that does — another CLI
         * version, a session copied in — and the runs are read below. `main.ts` passes the same
         * option, but to a run file, which is the distinction this comment used to blur.
         */
        const transcript = parseTranscript(read.jsonl, { includeSidechain: true })

        /*
         * A transcript can be *partly* unreadable, and that is a gap in this answer too.
         *
         * `parseTranscript` counts records it could not use rather than dropping them silently —
         * so a conversation searched with torn lines in it has been searched *incompletely*, and
         * saying "no matches there" would be a claim about text nobody read.
         */
        if (transcript.unreadable > 0) {
          blind.push({
            source: 'conversation',
            extent: 'some',
            why: `${named}: ${transcript.unreadable} record${transcript.unreadable === 1 ? '' : 's'} would not parse`,
          })
        }

        for (const entry of transcript.entries) {
          for (const text of spoken(entry)) {
            hits.push(
              ...matchesIn(text, query, 'conversation', named, {
                kind: 'conversation',
                sessionId: session.id,
                project: session.project,
              }),
            )
          }
        }
      } catch (err) {
        blind.push({ source: 'conversation', extent: 'some', why: `${named}: ${(err as Error).message}` })
      }

      /*
       * The employees' own records, filed beside the session rather than inside it.
       *
       * `scanSubagents` rather than a reader of our own: the employee card already reads this
       * layout, and two descriptions of where Claude Code files a run is one of them being wrong
       * later. Its `none` is a conversation that dispatched nobody — searched, and empty.
       */
      const work = await scanSubagents(session.id, session.cwd, home)
      if (work.state === 'unreadable') {
        blind.push({ source: 'conversation', extent: 'some', why: `${named}: employees' records: ${work.cause}` })
      } else if (work.state === 'ok') {
        // A run it listed and could not use. Passing over these would be this module's own defect
        // one level down: a record nobody opened, inside a source reported as read.
        for (const skip of work.skipped) {
          blind.push({ source: 'conversation', extent: 'some', why: `${named}: ${skip.run}: ${skip.cause}` })
        }

        for (const run of work.runs) {
          /*
           * Labelled with the employee, and `goto: null`.
           *
           * The label because `where` is what `byPlace` and `summarise` count: two records under
           * one label report as one place, so the count would quietly change meaning on the day
           * this began finding anything. `null` because there is nowhere to open — the
           * conversation view parses the main transcript with the defaults, no employee turns, and
           * the card shows only that person's latest run, so "open" would land on a view without
           * the line somebody clicked. The dispatch rows take the same branch for the same reason.
           */
          const where = `${named} · ${run.agentType}`
          try {
            const record = parseTranscript(run.jsonl, { includeSidechain: true })
            if (record.unreadable > 0) {
              blind.push({
                source: 'conversation',
                extent: 'some',
                why: `${where}: ${record.unreadable} record${record.unreadable === 1 ? '' : 's'} would not parse`,
              })
            }
            for (const entry of record.entries) {
              for (const text of spoken(entry)) {
                hits.push(...matchesIn(text, query, 'conversation', where))
              }
            }
          } catch (err) {
            // Its own try: one torn run must not cost the reader the runs filed after it.
            blind.push({ source: 'conversation', extent: 'some', why: `${where}: ${(err as Error).message}` })
          }
        }
      }
    }
  }

  return { hits, looked, blind }
}

/** A conversation's name for a person, falling back to its id rather than to nothing. */
function title(given: string | null, id: string): string {
  return given && given.trim() !== '' ? given : `session ${id.slice(0, 8)}`
}

/** A problem in whatever shape `discoverProjects` reports it, as one sentence. */
function describe(problem: unknown): string {
  if (typeof problem === 'string') return problem
  const p = problem as { path?: string; cause?: string; detail?: string; kind?: string }
  return [p.path, p.cause ?? p.detail ?? p.kind].filter(Boolean).join(': ') || 'could not be read'
}

/**
 * Every searchable string in a timeline entry.
 *
 * Switched on `kind` rather than probed for fields. The structural version — `text` else `said`
 * else `input` — read plausibly and lost three things: `said` is on no variant at all, a
 * `command` entry has neither `text` nor `input` so every slash command anybody ran was
 * unsearchable, and a `tool` entry returned at `input` and **never reached `result`**. That last
 * one contradicted the comment sitting directly above it, which named tool results as the reason
 * the branch existed: *"which conversation ran that migration"* was exactly the question that
 * came back empty, because results are where file contents, command output and errors live.
 *
 * Several strings per entry rather than one, since a tool call is a call *and* what came back.
 *
 * `thinking` is searched, deliberately rather than by accident of shape. Somebody looking for why
 * a decision was made wants the reasoning that led to it, and this is a local app reading a
 * person's own workspace.
 */
function spoken(entry: TimelineEntry): readonly string[] {
  switch (entry.kind) {
    case 'user':
    case 'assistant':
    case 'thinking':
      return entry.text === '' ? [] : [entry.text]
    case 'command':
      // The name and what it was given. `/dispatch builder fix the auth refresh` is one line
      // somebody would search for, and it is two fields here.
      return [`/${entry.name} ${entry.args}`.trim()]
    case 'tool': {
      // No `try` around the stringify: tool input arrives parsed from JSON, so it cannot be
      // circular, and CLAUDE.md forbids handling a case that cannot occur.
      const said = [`${entry.name} ${JSON.stringify(entry.input)}`]
      if (entry.result !== null && entry.result !== '') said.push(entry.result)
      return said
    }
    case 'unreadable':
      // The raw line, so a search can still find a term inside a record that would not parse.
      // The record is already counted in `transcript.unreadable` and declared as a blind spot.
      return entry.raw === '' ? [] : [entry.raw]
  }
}
