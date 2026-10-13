/**
 * Every agent that can run a command is told how to run one.
 *
 * The rule — one command per `Bash` call, never chained — lived only in `manager.md`, while six of
 * the seven agents have `Bash` in their tools. The five who do most of the command-running had
 * never been told, and the cost is not style: `settings.json` allows by **leading word**, so a
 * chain has no single word to match, the approval gate holds it, and a person is asked about a
 * command every part of which was already permitted. Measured on a first message, in the
 * manager's own file: two chained calls, two approval cards, before anything had been said.
 *
 * ## Why this starts from the files and not from a list
 *
 * A check that enumerates the thing it is checking cannot see what the list forgot — three panel
 * guards missed `changed-panel` for exactly that reason, each iterating a list it was absent from.
 * So this reads `.claude/agents/`, decides from each file's own `tools:` line whether that agent
 * can run commands, and requires the rule of the ones that can. An agent added tomorrow is covered
 * by construction; an agent that gains `Bash` is covered the moment it does.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(repo, '.claude', 'agents')

/**
 * The whole `## Running commands` section, or `null`.
 *
 * Extracted rather than probed for its first line. The first version asked
 * `body.includes('One command per Bash call')` — which `manager.md` and the five added beside it
 * both satisfied **while already disagreeing**, at birth, before anybody had edited anything. The
 * other fourteen lines could drift six ways and every assertion stayed green.
 *
 * Which is this file's own subject one level up: the rule lived in one place, five agents never
 * got it, and nothing found out. Copying it into six places creates six places to drift, so what
 * is checked is that they are the same text, not that each mentions the topic.
 */
function sectionIn(body: string): string | null {
  const from = body.indexOf('## Running commands')
  if (from === -1) return null
  const next = body.indexOf('\n## ', from + 1)
  return next === -1 ? body.slice(from) : body.slice(from, next)
}

const names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort()
const agents = await Promise.all(
  names.map(async (name) => {
    const body = await readFile(join(dir, name), 'utf8')
    // The frontmatter's `tools:` line. Absent means the agent inherits everything, which includes
    // `Bash` — so a missing line is *more* permissive than a present one, never less.
    const line = /^tools:\s*(.*)$/m.exec(body)
    return {
      id: name.replace(/\.md$/, ''),
      inherits: line === null,
      runsCommands: line === null || /\bBash\b/.test(line[1] ?? ''),
      section: sectionIn(body),
    }
  }),
)

test('the scan found the staff, or everything below is about nothing', () => {
  // Without this, a renamed directory or a changed extension makes every assertion below vacuous
  // — the shape of failure this repo has now been bitten by more than once.
  assert.ok(agents.length >= 5, `only ${agents.length} agents found in .claude/agents/`)
  assert.ok(
    agents.some((a) => a.runsCommands),
    'no agent was read as able to run commands, so the `tools:` line is no longer being parsed',
  )
})

test('every agent that can run a command carries the rule for running one', () => {
  const missing = agents.filter((a) => a.runsCommands && a.section === null).map((a) => a.id)
  assert.deepEqual(
    missing,
    [],
    `these agents have Bash and are not told the one-command rule: ${missing.join(', ')}. ` +
      'A chain has no single leading word, so `settings.json` cannot match it and the gate holds ' +
      'it for a person — on work nobody is watching.',
  )
})

test('an agent with no tools line is treated as able to run commands', () => {
  /*
   * Omitting `tools:` inherits everything the parent has, which is the more permissive case and
   * the one a naive check gets backwards: read as "no tools listed, so no Bash", such an agent
   * would be excused the rule precisely because it has the most access.
   *
   * Asserted on the parsing rather than on today's files, since all seven currently declare one.
   */
  const inheriting = agents.filter((a) => a.inherits)
  for (const a of inheriting) {
    assert.equal(a.runsCommands, true, `${a.id} inherits every tool and was excused the rule`)
  }
})

test('an agent that cannot run commands is not made to carry the rule', () => {
  // The other direction, so the guard cannot be satisfied by pasting the section into every file.
  // `memory-keeper` has no `Bash`; telling it how to chain commands it cannot run is noise in a
  // prompt, and noise in a prompt is not free.
  const pointless = agents.filter((a) => !a.runsCommands && a.section !== null).map((a) => a.id)
  assert.deepEqual(pointless, [], `these agents cannot run commands and are told how anyway: ${pointless.join(', ')}`)
})

test('every copy of the rule is the same text, to the byte', () => {
  /*
   * Six files now carry this section, and `manager.md` and the five added beside it **already
   * disagreed** — different wording for the same sentence, before anyone had edited anything.
   * Presence checks cannot see that: each file said "One command per Bash call" and each said
   * something different afterwards.
   *
   * It matters because the section is about to be corrected: the sentence claiming a held call
   * waits for a person was wrong — the gate denies after 240 seconds — and a partial fix would
   * leave some agents told the true thing and some the false one, with the suite green either way.
   */
  const carrying = agents.filter((a) => a.section !== null)
  const distinct = new Set(carrying.map((a) => a.section))
  assert.equal(
    distinct.size,
    1,
    `the rule is worded ${distinct.size} different ways across ${carrying.length} agents: ` +
      `${carrying.map((a) => a.id).join(', ')}. One of them is telling somebody something the ` +
      'others are not.',
  )
})

test('the copies say the thing that is actually true about an unanswered call', () => {
  /*
   * Pinned against `settings.json`'s own account rather than left to prose: *"An unanswered
   * request is a denial and the hook enforces that itself"*, at 240 seconds.
   *
   * Two earlier versions of this paragraph were wrong in opposite directions — one said the run
   * was unattended when the app draws an approval card, the next said the call waits until
   * somebody answers when in fact it is denied. Both read plausibly.
   */
  const text = agents.find((a) => a.section !== null)?.section ?? ''
  assert.match(text, /denies/, 'the section no longer says what happens when nobody answers')
  assert.match(text, /240/, 'the section states no deadline, so "eventually" is left to the reader')
  assert.doesNotMatch(
    text,
    /deliberately not allowed/,
    'the section claims a command is deliberately denied; check settings.json before restoring that',
  )
})
