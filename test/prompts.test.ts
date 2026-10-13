/**
 * The agent prompts, checked against the code they describe.
 *
 * A prompt is not tested by running it — that costs money and is not repeatable. But a prompt
 * that *describes the app incorrectly* is checkable, and that is the failure mode this repo has
 * actually had: `manager.md` claimed for weeks that staff arrive under `## CURRENT STAFF` while
 * nothing anywhere wrote that block. The manager was following an instruction about something
 * that never happened.
 *
 * So these tests pin the prompts to the code. If a heading is renamed in `blocks.ts` and not in
 * `manager.md`, this fails — which is the only way that particular lie gets caught.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { OFFICE_HEADINGS } from '../src/shared/context/blocks.js'

const root = process.cwd()
const AGENTS = join(root, '.claude', 'agents')
const read = (name: string) => readFile(join(AGENTS, `${name}.md`), 'utf8')
const EMPLOYEES = ['backend', 'builder', 'frontend', 'memory-keeper', 'reviewer', 'tester']

test('every block the office can send is named in the manager prompt', async () => {
  // The check that would have caught H1 — a prompt describing a block nothing produced. It works
  // in the other direction too: a block we send and never explain is one the manager ignores.
  const manager = await read('manager')
  for (const heading of OFFICE_HEADINGS) {
    assert.ok(manager.includes(heading), `the office sends ${heading} and manager.md never mentions it`)
  }
})

test('the manager prompt claims no block the office cannot send', async () => {
  const manager = await read('manager')
  const claimed = [...manager.matchAll(/`(## [A-Z][A-Z ]+)`/g)].map((m) => m[1]!)
  for (const heading of claimed) {
    assert.ok(
      OFFICE_HEADINGS.includes(heading),
      `manager.md tells the manager to expect ${heading}, which nothing sends`,
    )
  }
})

test('every agent file parses as the frontmatter discovery expects', async () => {
  // Cheap, and it catches the one edit that breaks an agent silently: a description spanning
  // two lines, or a stray colon, leaves an employee discovery cannot read.
  for (const file of await readdir(AGENTS)) {
    if (!file.endsWith('.md')) continue
    const text = await readFile(join(AGENTS, file), 'utf8')
    assert.match(text, /^---\n/, `${file} has no frontmatter`)
    assert.match(text, /^name: [a-z0-9-]+$/m, `${file} has no usable name`)
    assert.match(text, /^description: \S/m, `${file} has no description — the manager picks by description`)
  }
})

test('the name in the frontmatter matches the filename', async () => {
  // They are two spellings of one identity, and the manager dispatches to the filename while
  // discovery reports the field. When they disagree, dispatch silently hits nobody.
  for (const file of await readdir(AGENTS)) {
    if (!file.endsWith('.md')) continue
    const text = await readFile(join(AGENTS, file), 'utf8')
    const declared = /^name: (.+)$/m.exec(text)?.[1]?.trim()
    assert.equal(declared, file.replace(/\.md$/, ''), `${file} declares a different name`)
  }
})

test('every employee is told the two things that stop them inventing activity', async () => {
  // The room rules exist so nobody writes "taking a quick break" and gets it animated. They are
  // in each file because agent files have no includes and a subagent receives no injected
  // context — so this test is the thing that keeps seven copies in agreement.
  for (const name of EMPLOYEES) {
    const text = await read(name)
    assert.match(text, /You do not call meetings/, `${name} is not told who calls meetings`)
    assert.match(text, /never announce a break/, `${name} is not told not to announce a break`)
  }
})

test('every employee is told their report is the whole of what is seen', async () => {
  // After the panel change the transcript carries no tool cards, so a report that leans on
  // visible receipts is a report nobody can follow.
  for (const name of EMPLOYEES) {
    assert.match(await read(name), /only account there is/, `${name} still assumes its tool calls are visible`)
  }
})

test('only the manager is given a delegation tool', async () => {
  // The first standing order, checked in the files rather than trusted. An employee with Task
  // can summon a colleague, and then the office has no single thread of authority.
  for (const name of EMPLOYEES) {
    const tools = /^tools: (.+)$/m.exec(await read(name))?.[1] ?? ''
    assert.ok(!/\b(Task|Agent)\b/.test(tools), `${name} has a delegation tool`)
  }
  assert.match(/^tools: (.+)$/m.exec(await read('manager'))?.[1] ?? '', /\bTask\b/)
})

test('every model an agent defaults to is one the manager knows how to size', async () => {
  // The office preaches model sizing in ~40 lines of manager.md — "do not send opus to do
  // haiku's job" — and until 2026-08-20 five of seven agents defaulted to opus, including the
  // three implementers whose ordinary work the same table calls sonnet work. The defaults
  // argued the opposite of the doctrine on every dispatch where the manager forgot to override.
  //
  // The judgement of which agent deserves which model is not testable. This is: a model named
  // in an agent file has to be one the manager's own table knows, or the sizing advice does not
  // reach it. Catches a typo, a retired model id, and a default nobody told the manager about.
  const manager = await read('manager')

  for (const who of ['manager', ...EMPLOYEES]) {
    const model = /^model:\s*(\S+)/m.exec(await read(who))?.[1]
    if (!model) continue
    assert.ok(
      new RegExp(`\`${model}\``).test(manager),
      `${who}.md defaults to \`${model}\` and the manager prompt's sizing table never names it`,
    )
  }
})

test('every skill a prompt tells somebody to use is actually on the shelf', async () => {
  // Caught in the writing of it: the `planning` mode block said "use the `plan-together` skill"
  // for the length of one commit before that skill existed. An instruction to invoke something
  // that is not there is the same shape as the approval gate — a capability named on one side
  // and absent on the other, with a green suite either way.
  //
  // It is worse in a prompt than in code, because the agent cannot tell. It reaches for the
  // skill, does not find it, and improvises something that looks like having used it.
  const shelf = new Set(
    (await readdir(join(root, '.claude/skills'), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  )

  const prose = [
    await readFile(join(AGENTS, 'manager.md'), 'utf8'),
    await readFile(join(root, 'src/shared/session/mode.ts'), 'utf8'),
  ].join('\n')

  // "the `x` skill" and "`x` skill" — the two ways either file names one.
  const named = new Set([...prose.matchAll(/`([a-z][a-z0-9-]*)` skill/g)].map((m) => m[1]!))
  assert.ok(named.size > 0, 'no skill is named in either file — the pattern moved')

  for (const skill of named) {
    assert.ok(shelf.has(skill), `a prompt says to use the \`${skill}\` skill and it is not on the shelf`)
  }
})

test('the manager prompt stays small enough to be read every turn', async () => {
  // It is prepended to every single message, including the one where the user types "hi". At
  // 16,626 bytes — where it stood on 2026-08-20 — that was roughly 4,000 tokens on every turn
  // before the office blocks and before the person's actual sentence.
  //
  // The cut that got it here removed argument, not rules: the dispatch case was made in two
  // sections, and "asking before you build" spent thirty lines reconciling itself with "do not
  // interrupt mid-task" — a contradiction that stopped existing once intake became a mode.
  //
  // The ceiling is a ratchet, not a target. If a real rule needs adding, raise it deliberately
  // and say why in the commit. What it stops is the file drifting back up a paragraph at a time,
  // which is how it got to 16KB in the first place.
  //
  // Raised once, from 13,000 to 13,500 on 2026-08-31, for the rule that says one command per
  // Bash call. It buys back more than it costs: `settings.json` allows by leading word, a chain
  // has no leading word, so a chained command asks a person for permission even when every part
  // of it was already allowed. Measured on a new user's very first message — two chained calls
  // produced two approval cards before the manager had said anything, and more after. The rule
  // is nine lines and removes the friction from the first thing anybody does.
  /*
   * Raised again, to 13,600, and **in bytes** — the unit it was always going to bind on.
   *
   * The line said `bytes`, said "bytes" in its failure message, and called `.length`, which counts
   * UTF-16 units. Two different quantities, and on 2026-09-04 they sat one either side of the
   * line: 13,432 by `.length`, 13,508 actual bytes, against a ceiling of 13,500.
   *
   * ## Why correcting the unit is a raise, not a cut
   *
   * The first fix renamed the variable and trimmed prose out of six agent files until the byte
   * count fit under 13,500. That is the move the paragraph above forbids — the file moved so the
   * line could stay — and it took a review to see it, because the suite was green either way.
   *
   * What the history actually says, measured rather than assumed:
   *
   *     616824d  ceiling set    13,410 UTF-16    13,488 bytes    12 bytes clear
   *     07fcb7bd merge base     13,432 UTF-16    13,508 bytes    -8 bytes — already over
   *     (this)   after the raise                 13,508 bytes    92 bytes clear
   *
   * **Twelve bytes is the most byte-headroom this guard has ever had**, on the day it was written.
   * 13,500 was a round number about ninety above a `.length` of 13,410; landing twelve above the
   * byte count was arithmetic nobody did. So correcting the unit did not spend the headroom — it
   * revealed there had never been any, and 13,600 restores in bytes roughly the ninety that raise
   * believed it was setting. The prose edits are gone; nothing about the shipped prompts changes
   * in this commit.
   *
   * ## One measure, not two
   *
   * An earlier version asserted characters **and** bytes, on the reasoning that requiring both is
   * stricter than either. It is not. In UTF-8 every code point costs at least one byte, so
   * `bytes <= N` implies `codePoints <= N` for every possible string — requiring both is exactly
   * as strict as requiring bytes, and the second assert can never be the one that fires.
   *
   * It could still do harm. Written first, it pre-empted the byte assert in the only case either
   * could fail, and reported the smaller, non-binding number three lines under a message calling
   * the byte count the binding one.
   *
   * And `[...text].length` is not characters either — it is **code points**, which was the same
   * mistake a third time inside the change about that mistake. `'👨‍👩‍👧'` is one character, five
   * code points and eighteen bytes. Bytes are the only measure here that needs no claim about
   * tokenizers to justify, which is the whole of the argument for them.
   *
   * A clause saying bytes are *"what the model is billed and budgeted in"* stood here and was
   * cut in review. Billing is in tokens, and the sentence made a tokenizer claim immediately
   * before disowning the need for one. It was the fourth turn of the same wheel in this guard's
   * life — every one a measure named for what it approximates rather than what it counts:
   *
   *     .length             called bytes
   *     .length             called characters
   *     [...text].length    called characters      (code points)
   *     bytes               called billing units   (tokens)
   *
   * Which is the thing this test now exists to stop, committed in the comment explaining it.
   */
  const bytes = Buffer.byteLength(await read('manager'), 'utf8')
  assert.ok(
    bytes <= 13_600,
    `manager.md is ${bytes} bytes and rides on every turn. Cut argument before adding rules, or ` +
      'raise this ceiling on purpose — in the commit message, with the reason, and without ' +
      'trimming the file to fit.',
  )
})

test('an agent told to invoke skills has the tool that invokes them', async () => {
  // The meeting room has never been usable, and nothing could see it.
  //
  // `manager.md` says *"A meeting is the `meet` skill, never a sentence… if you did not invoke
  // the skill, no meeting happened."* The skill exists, discovery finds it, and the office hands
  // it to the manager every turn under `## SKILLS ON THE SHELF`. The manager's `tools:` list did
  // not include `Skill`, so invoking one came back **"Skill invocation is disabled in this
  // session"** — found by driving a real planning meeting and watching it fail.
  //
  // Every layer was right on its own. The skill was written, shipped, discovered and advertised;
  // the only missing thing was the manager's permission to call it. Declared on one side, unwired
  // on the other — the same shape as the approval gate and `capabilities.ts` before it.
  const files = (await readdir(AGENTS)).filter((f) => f.endsWith('.md'))

  for (const file of files) {
    const body = await readFile(join(AGENTS, file), 'utf8')
    const tools = /^tools:\s*(.+)$/m.exec(body)?.[1]
    // No `tools:` line means the agent inherits everything, including Skill.
    if (!tools) continue
    // Does this prompt actually tell them to invoke one?
    if (!/`[a-z][a-z0-9-]*` skill/.test(body)) continue

    assert.ok(
      tools.split(',').some((t) => t.trim() === 'Skill'),
      `${file} tells its agent to invoke a skill and its tools: list has no Skill — the call is refused`,
    )
  }
})

test('every tool the shipped staff declare is one this workspace can actually deliver', async () => {
  /*
   * The bug this exists for shipped, and shipped in exactly this directory.
   *
   * `WebFetch` and `WebSearch` sat in five agents' tool lists and in neither `allow` nor `deny`,
   * so both were unlisted and refused — while the roster printed them under all five names. A
   * capability the office asserts and cannot deliver is the third standing order broken on the
   * surface built to describe the staff.
   *
   * `capabilities.ts` computes this at runtime, and the roster shows it per agent, which is the
   * right place for a *user's* workspace: they edit these files and want to be told. It is the
   * wrong place for the one we ship. Every new office starts as a copy of this directory, so a
   * gap here is a warning on the roster of every first run — found by the person we were trying
   * to impress, not by us.
   *
   * `NEEDS_NO_ENTRY` is the measured exception list: tools that ran with no entry in `allow`,
   * checked on 2026-08-21 rather than assumed from the docs.
   */
  const { scanCapabilities, toolsWithoutPermission } = await import('../src/main/capabilities.js')
  const { readPolicy } = await import('../src/main/permissions.js')

  const scan = await scanCapabilities(root)
  assert.ok(scan.staff.length >= 7, `scanned only ${scan.staff.length} agents — the shipped roster moved`)

  const declared = scan.staff.filter((m) => m.tools.state === 'declared')
  assert.ok(declared.length >= 7, 'the shipped agents should all declare their tools explicitly')

  // The same reader main uses. A second answer to "what is allowed" is the fault this check
  // exists to catch, so it must not have one of its own.
  const policy = await readPolicy(root)
  const unreachable = toolsWithoutPermission(scan.staff, policy.policy.allow)

  assert.deepEqual(
    unreachable.map((u) => `${u.employee} declares ${u.tool}`),
    [],
    'declared by an agent we ship and permitted by nothing — add the allow entry, or take the ' +
      'tool off the agent. A roster that prints a tool the office will refuse is worse than one ' +
      'that never claimed it.',
  )
})

test('the first standing order is not enforced by tool lists alone', async () => {
  /*
   * "An employee may not summon a colleague" is kept by withholding `Task`, and the test above
   * checks that in the agent files. `Bash` is the hole in it.
   *
   * Six of the seven shipped agents declare `Bash`. `claude` was **unlisted** — which the gate
   * answers by asking, in every mode except one. Under `bypassPermissions` unlisted means
   * *allowed*, so an employee could have run `claude -p "…"` and started an agent outside the
   * office entirely: not on the floor, not in the ledger, not gated, and reporting to nobody.
   *
   * The deny list is where a standing instruction belongs, by `triage`'s own argument — deny
   * wins in every mode including bypass, because *"a deny is a standing instruction somebody
   * wrote once and expects to hold"*. The first standing order is exactly that.
   *
   * ## What this does not claim
   *
   * A deny list is not a sandbox. `~/.claude/local/claude`, an alias, a wrapper script or a
   * shell that is not `sh`/`bash`/`zsh` would still get through, and enumerating those is a game
   * with no end. This closes the form somebody would actually reach for and raises the bar; it
   * does not seal the door, and saying otherwise here would be the third standing order broken
   * in a test about the first.
   */
  const { readPolicy, judge } = await import('../src/main/permissions.js')

  const read = await readPolicy(root)
  assert.equal(read.incomplete, false, 'the shipped settings file must parse')

  for (const command of ['claude', 'claude -p "go"', 'npx claude -p "go"']) {
    const verdict = judge(command, read.policy)
    assert.equal(verdict.state, 'denied', `\`${command}\` is how an employee summons a colleague`)
  }

  // And the shells, which are the same escape by a different door. Already denied; pinned here
  // so the two sets cannot drift apart.
  for (const command of ['sh -c "claude"', 'bash -c "claude"', 'node -e "x"', 'python3 -c "x"']) {
    assert.equal(judge(command, read.policy).state, 'denied', `\`${command}\` runs arbitrary code`)
  }

  // The office still has to work. A deny that swept up the ordinary commands would be traded
  // for an office nobody can use, which is not a better answer.
  for (const command of ['npm test', 'git status', 'npx tsc --noEmit']) {
    assert.equal(judge(command, read.policy).state, 'allowed', `\`${command}\` is everyday work`)
  }
})

