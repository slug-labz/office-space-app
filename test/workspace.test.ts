/**
 * Workspace discovery.
 *
 * This is the module the office's fourth rule is named after: **absent is not empty.** A
 * directory that could not be read must never come back as a floor with nobody on it, because
 * that is a confident, wrong picture of a workspace that is actually full.
 *
 * It is also where "only the manager may delegate" is actually enforced, via `lintEmployee`.
 * Both of those are load-bearing claims made in `CLAUDE.md` and in the README, so both are
 * checked here rather than asserted in prose.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  discoverWorkspace,
  findManager,
  lintEmployee,
  lintStaff,
  parseFrontmatter,
  watchWorkspace,
  type Employee,
  type Problem,
} from '../src/main/workspace.js'

import { tempDir } from './temp-dir.js'

async function workspace(t: TestContext, agents: Record<string, string> = {}, skills: Record<string, string> = {}): Promise<string> {
  const root = await tempDir(t, 'office-ws-')
  await mkdir(join(root, '.claude', 'agents'), { recursive: true })
  for (const [name, body] of Object.entries(agents)) {
    await writeFile(join(root, '.claude', 'agents', name), body)
  }
  for (const [name, body] of Object.entries(skills)) {
    await mkdir(join(root, '.claude', 'skills', name), { recursive: true })
    await writeFile(join(root, '.claude', 'skills', name, 'SKILL.md'), body)
  }
  return root
}

const agentFile = (fields: string) => `---\n${fields}\n---\n\nBody text.\n`

const employee = (over: Partial<Employee> = {}): Employee => ({
  id: 'reviewer',
  name: 'reviewer',
  description: 'Reviews code.',
  tools: ['Read', 'Grep'],
  model: null,
  filePath: '/tmp/reviewer.md',
  ...over,
})

// ─────────────────────────────────────────────────────────────── frontmatter ──

test('a file with no frontmatter is null, not an empty record', () => {
  assert.equal(parseFrontmatter('Just a body.\n'), null)
  assert.equal(parseFrontmatter(''), null)
})

test('an unterminated frontmatter block is null rather than a partial parse', () => {
  assert.equal(parseFrontmatter('---\nname: reviewer\n\nno closing fence\n'), null)
})

test('values may contain colons, because descriptions routinely do', () => {
  const fm = parseFrontmatter('---\ndescription: Reviews code: correctness, then security\n---\n')
  assert.equal(fm?.['description'], 'Reviews code: correctness, then security')
})

test('one layer of matching quotes is stripped', () => {
  const fm = parseFrontmatter(`---\na: "quoted"\nb: 'single'\nc: "mismatched'\n---\n`)
  assert.equal(fm?.['a'], 'quoted')
  assert.equal(fm?.['b'], 'single')
  assert.equal(fm?.['c'], `"mismatched'`)
})

test('a byte-order mark does not hide the frontmatter', () => {
  const fm = parseFrontmatter('﻿---\nname: reviewer\n---\n')
  assert.equal(fm?.['name'], 'reviewer')
})

// ───────────────────────────────────────────────────────────────────── lint ──

test('an employee with no tools key is a finding, not a style nit', () => {
  // The manager named, because the rule is about who they are and this function no longer
  // guesses from a name. `reviewer` is the employee under test, so the manager is somebody else.
  const problems = lintEmployee(employee({ tools: null }), 'manager')
  assert.equal(problems.length, 1)
  assert.equal(problems[0]?.kind === 'lint' && problems[0].rule, 'employee-must-declare-tools')
})

test('the manager may omit tools; nobody else may', () => {
  assert.equal(lintEmployee(employee({ id: 'manager', tools: null, description: 'Runs it.' }), 'manager').length, 0)
  // And when the office is run by somebody else, the exemption follows them rather than the name.
  assert.equal(lintEmployee(employee({ id: 'boss', tools: null, description: 'Runs it.' }), 'boss').length, 0)
  assert.equal(lintEmployee(employee({ id: 'manager', tools: null, description: 'Runs it.' }), 'boss').length, 1)
})

test('an employee that can delegate breaks the office rule, under either spelling', () => {
  for (const tool of ['Task', 'Agent']) {
    const problems = lintEmployee(employee({ tools: ['Read', tool] }), 'manager')
    assert.equal(
      problems.some((p) => p.kind === 'lint' && p.rule === 'only-manager-may-delegate'),
      true,
      `${tool} must be caught`,
    )
  }
})

test('a missing description is a finding — the manager dispatches from that text', () => {
  const problems = lintEmployee(employee({ description: '   ' }), 'manager')
  assert.equal(
    problems.some((p) => p.kind === 'lint' && p.rule === 'description-required'),
    true,
  )
})

// ──────────────────────────────────────────────────────────────── discovery ──

test('staff are discovered in a stable order, with frontmatter read', async (t) => {
  const root = await workspace(t, {
    'reviewer.md': agentFile('name: reviewer\ndescription: Reads changes.\ntools: Read, Grep\nmodel: opus'),
    'builder.md': agentFile('name: builder\ndescription: Writes code.\ntools: Read, Write'),
  })

  const ws = await discoverWorkspace(root)

  assert.deepEqual(ws.employees.map((e) => e.id), ['builder', 'reviewer'])
  assert.deepEqual(ws.employees[1]?.tools, ['Read', 'Grep'])
  assert.equal(ws.employees[1]?.model, 'opus')
})

test('a missing tools key survives discovery as null, never as an empty list', async (t) => {
  const root = await workspace(t, { 'memory.md': agentFile('name: memory\ndescription: Remembers.') })

  const ws = await discoverWorkspace(root)

  assert.equal(ws.employees[0]?.tools, null, 'null means "inherits everything" and must not become []')
})

test('an agent with no name is reported, not given one from its filename', async (t) => {
  /*
   * This asserted the opposite — that the id falls back to the filename stem — with no reasoning
   * attached, which is what made it worth re-checking rather than working around.
   *
   * Measured against the installed CLI (2.1.250): `claude --agent <nonsense>` prints its own
   * registry, and a file whose frontmatter carries no `name:` was not in it, while the office
   * drew it on the floor. That is a person at a desk the office cannot dispatch to — clicking
   * them cannot work, and nothing said why.
   *
   * Reported rather than skipped, like the no-frontmatter case below it: a half-written agent
   * file is exactly when somebody wants to be told. Nothing the office writes can reach here,
   * because `agentFile()` always emits `name:`.
   */
  const root = await workspace(t, { 'tester.md': agentFile('description: Breaks things.') })

  const ws = await discoverWorkspace(root)

  assert.equal(ws.employees.length, 0, 'a phantom employee was drawn on the floor')
  const said = ws.problems.find((p) => p.kind === 'lint' && p.rule === 'agent-has-no-name')
  assert.ok(said, 'the office refused to read it as staff and refused silently')
  assert.match(said.kind === 'lint' ? said.detail : '', /cannot dispatch/)
})

test('a file with no frontmatter is reported, not skipped', async (t) => {
  const root = await workspace(t, { 'broken.md': 'no frontmatter here\n' })

  const ws = await discoverWorkspace(root)

  assert.equal(ws.employees.length, 0)
  assert.equal(ws.problems.some((p) => p.kind === 'no-frontmatter'), true)
})

test('a missing agents directory is genuinely zero staff and no problem', async (t) => {
  const root = await tempDir(t, 'office-empty-')

  const ws = await discoverWorkspace(root)

  assert.equal(ws.employees.length, 0)
  assert.equal(ws.problems.length, 0, 'a fresh workspace has not failed at anything')
})

test('a directory that exists but cannot be read is a problem, NOT zero staff', async (t) => {
  const root = await workspace(t, { 'reviewer.md': agentFile('name: reviewer\ndescription: Reads.\ntools: Read') })
  const agents = join(root, '.claude', 'agents')
  await chmod(agents, 0o000)

  try {
    const ws = await discoverWorkspace(root)

    // Running as root defeats the permission bit; skip rather than assert something false.
    if (ws.employees.length > 0) return

    assert.equal(ws.employees.length, 0)
    assert.equal(
      ws.problems.some((p) => p.kind === 'unreadable-dir'),
      true,
      'this is the failure the whole module exists to prevent: unreadable rendered as empty',
    )
  } finally {
    await chmod(agents, 0o755)
  }
})

test('discovery never throws — everything that went wrong comes back in problems', async () => {
  const ws = await discoverWorkspace('/definitely/not/a/real/path')
  assert.equal(ws.employees.length, 0)
  assert.equal(ws.problems.length, 0)
})

test('lint findings ride along with discovery', async (t) => {
  // Two agents, because one is no longer a violation. A lone agent declaring `Task` is the only
  // thing in the office that can dispatch, so `findManager` returns *them* — they are the
  // manager, and flagging them was the bug this fixture used to depend on. A manager plus an
  // employee who also declares it is a real misconfiguration and still reported.
  const root = await workspace(t, {
    'manager.md': agentFile('name: manager\ndescription: Runs the floor.\ntools: Task, Read'),
    'rogue.md': agentFile('name: rogue\ndescription: Does as it pleases.\ntools: Task'),
  })

  const ws = await discoverWorkspace(root)

  assert.equal(ws.employees.length, 2, 'the employees are still on the floor')
  assert.equal(
    ws.problems.some((p) => p.kind === 'lint' && p.rule === 'only-manager-may-delegate'),
    true,
    'and the misconfiguration is still reported',
  )
})

test('a skills directory with a non-skill subdirectory is not an error', async (t) => {
  const root = await workspace(t, {}, { 'brain-search': '---\nname: brain-search\ndescription: Finds it.\n---\n' })
  await mkdir(join(root, '.claude', 'skills', 'shared-assets'), { recursive: true })

  const ws = await discoverWorkspace(root)

  assert.deepEqual(ws.skills.map((s) => s.id), ['brain-search'])
  assert.equal(ws.problems.length, 0)
})

// ─────────────────────────────────────────────────────────────────── watching ──

test('adding an agent file pushes a whole new snapshot', async (t) => {
  const root = await workspace(t, { 'manager.md': agentFile('name: manager\ndescription: Runs it.\ntools: Read, Task') })

  /*
   * Two races, both of which made this fail for the machine rather than for the behaviour.
   *
   * It went red once in about ten runs on a loaded machine and green six of six alone — and it
   * misattributed a mutation result during a review, which is the cost: a bisect run through a
   * test that lies under load is sent somewhere wrong.
   *
   * ## Neither race is proven to be that failure, and both resources have now been ruled out
   *
   * Ten runs of the original under a CPU load average near 6: green. Ten more under an I/O load
   * average near 15 — ten workers doing 64KB write, fsync and readdir: green. Neither reproduces
   * it, so what follows removes two ways this test can fail for reasons other than the behaviour
   * and does **not** close a case nobody has reproduced.
   *
   * The record of the original failure is a pass/fail count and a test name; the assertion body
   * was not kept. So "it timed out with no event" is a guess, and the honest statement is that
   * the cause is unknown. The most likely missing variable is not load at all but the harness:
   * the failure happened under `tsx --test test/*.test.ts`, which runs a pool of about fifteen
   * node processes contending for FSEvents delivery and libuv threadpool slots, and neither
   * repro attempt recreated that.
   *
   * **The write was a guess at readiness.** `watchWorkspace` returns no ready signal, so a single
   * write 50ms in assumes the fs watch is established by then. When it is not, no event ever
   * fires — which is indistinguishable from a watcher that does not work. The file is now written
   * repeatedly until the rescan arrives, so a missed first write costs a tick rather than the run.
   *
   * Measured, and it matters: across thirteen instrumented runs idle and at load 8–15, the repeat
   * **never fired once** — `writes=1` every time, with the callback arriving at 77–90ms and the
   * first interval tick due at 150ms. So this is a standby mechanism that has not yet run in
   * anger. That is the correct shape for it and it is also the reason this PR claims nothing
   * about having fixed the observed failure.
   *
   * A ready signal would beat all of this, and does not belong here: a callback does arrive
   * before the first write in twelve of sixteen runs, but only twelve, so "write on the first
   * callback" deadlocks the other four. The absent signal is a gap in `watchWorkspace`, not in
   * the test.
   *
   * ## Why the deadline is ten seconds and not thirty
   *
   * Five had to cover an fs event, a debounce and a full rescan of agents, skills, commands,
   * hooks and settings. Thirty was the first choice here and is wrong in a way that only shows up
   * on CI: `checks.yml` caps the job at `timeout-minutes: 10`, and that cap is **actively
   * binding**. Measured over 58 jobs on `started_at` → `completed_at`, which is the interval
   * `timeout-minutes` actually bounds:
   *
   *     success    n=43   2.68 … 9.90, 9.93        none at or over 10:00
   *     cancelled  n=15   nine of them 10.15–10.28  cap plus shutdown grace
   *
   * **Four seconds of headroom**, and nine kills rather than the one a first pass found. That
   * first pass measured run wall-clock, which includes queue time — up to 11.7 minutes here, so
   * it reported "successes" of 14.4 minutes under a 10-minute cap, which is an instrument saying
   * plainly that it is not measuring what it is being read as.
   *
   * GitHub reports each kill as `cancelled`, the same string a superseded run gets. So roughly a
   * third of everything this repo has called `cancelled` was a hard failure wearing a supersede's
   * name, and a hang that used to fail loudly as a red test at 5s would, at 30s, be likelier to
   * end the job in the state that does not read as a failure at all.
   *
   * Ten is chosen for that property rather than to buy slack. If the failure was the readiness
   * race then no deadline was ever going to help and the repeat write is the cure; if it was
   * slowness, ten is a hundred times the 77–90ms this actually takes. Either way the deadline's
   * job is only to make a genuine hang fail as a test, and it should cost the job as little as
   * possible while doing it.
   */
  let ticking: NodeJS.Timeout | null = null
  const stop = (): void => {
    if (ticking) clearInterval(ticking)
    ticking = null
  }

  /**
   * The **first** write that failed, if any — deliberately not the last.
   *
   * A transient first failure followed by permanent ones therefore reports the transient one. That
   * is the right trade for the case this exists for, a directory that was never writable at all,
   * where every failure is the same failure and the first arrives soonest. Written down because
   * "the write failed" and "the first write failed" are different claims and only one is true.
   *
   * Without this the writes are fire-and-forget up to a hundred times, and a directory that
   * cannot be written to produces a timeout reading *"the watcher never reported a second
   * employee"* — which blames the watcher for never seeing a file that was never created. Kept
   * and reported rather than thrown, because a rejection here races the deadline and the
   * deadline's message is the one a person reads.
   */
  let writeFailed: Error | null = null

  const seen = await new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      stop()
      watcher.close()
      reject(
        new Error(
          writeFailed === null
            ? 'no rescan within 10s — the watcher never reported a second employee'
            : `no rescan within 10s, and the agent file could not be written: ${writeFailed.message}`,
        ),
      )
    }, 10_000)

    const watcher = watchWorkspace(
      root,
      (ws) => {
        if (ws.employees.length < 2) return
        clearTimeout(timer)
        stop()
        watcher.close()
        resolve(ws.employees.map((e) => e.id))
      },
      { debounceMs: 20 },
    )

    const write = (): void => {
      void writeFile(
        join(root, '.claude', 'agents', 'reviewer.md'),
        agentFile('name: reviewer\ndescription: Reads.\ntools: Read'),
      ).catch((err: unknown) => {
        // One `void` was one chance to become an unhandled rejection; a hundred of them is a
        // hundred, and node:test fails the *file* on one — attributing it to whichever test
        // happens to be running. Caught rather than ignored: the first failure is kept and the
        // deadline reports it, so a write that never succeeded stops reading as a watcher that
        // never fired.
        writeFailed ??= err instanceof Error ? err : new Error(String(err))
      })
    }
    setTimeout(write, 50)
    ticking = setInterval(write, 100)
  })

  stop()

  assert.deepEqual(seen, ['manager', 'reviewer'])
})

test('the office does not flag its own manager, whatever they are called', async () => {
  /*
   * `main.ts` found the manager by name and fell back to *whoever declares the delegation tool*.
   * `lintEmployee` decided the same question with `e.id === 'manager'`. So an office run by an
   * agent called anything else flagged **its own manager** with `only-manager-may-delegate`:
   *
   *     employees : boss, builder
   *     problems  : [lint] only-manager-may-delegate — Declares the delegation tool (Task).
   *                 Only the manager may dispatch work.
   *
   * A false problem, shown permanently in the panel whose job is telling the truth, advising a
   * fix that would stop the office working — remove `Task` from `boss` and nobody can dispatch.
   *
   * Two places answering one question and disagreeing. `findManager` lives here now and `main.ts`
   * imports it, and the lint runs over the set rather than per file, because *who the manager is*
   * cannot be known from one file.
   */
  // `filePath` per agent, because a lint reports the file rather than the id — the shared
  // `employee()` helper hardcodes one, so without this every row comes back as reviewer.md and
  // the assertion compares the wrong thing while looking like it compares the right one.
  const staff = (agents: readonly (readonly [string, string])[]): Employee[] =>
    agents.map(([id, tools]) =>
      employee({ id, tools: tools ? tools.split(', ') : [], description: 'Does things.', filePath: `/tmp/${id}.md` }),
    )

  const rules = (list: Employee[]): string[] =>
    lintStaff(list).filter((p): p is Extract<Problem, { kind: 'lint' }> => p.kind === 'lint').map((p) => `${p.path.split('/').pop()}:${p.rule}`)

  assert.deepEqual(rules(staff([['boss', 'Task, Read'], ['builder', 'Read']])), [], 'the office flagged its own manager')
  assert.deepEqual(rules(staff([['manager', 'Task, Read'], ['builder', 'Read']])), [], 'the office flagged the named manager')

  // Still enforced for everybody else — a guard that stops flagging is worse than one that
  // over-flags, and the fix could have been "never flag anyone".
  assert.deepEqual(
    rules(staff([['manager', 'Task'], ['sneaky', 'Task, Read']])),
    ['sneaky.md:only-manager-may-delegate'],
    'an employee declaring the delegation tool went unflagged',
  )
  // And with no agent named `manager`, the delegator discovery finds first is the manager; a
  // second one is an employee who should not have it. Two findings, not one: the office also
  // says it picked by filename order, because otherwise the choice is invisible. See the
  // ambiguity test below.
  assert.deepEqual(
    rules(staff([['boss', 'Task'], ['sneaky', 'Task, Read']])).sort(),
    ['boss.md:no-designated-manager', 'sneaky.md:only-manager-may-delegate'],
  )
})

test('findManager is the office asking itself one question', () => {
  // It was two functions in two modules. The lint's copy is gone; this is the survivor.
  const staff = (agents: readonly (readonly [string, string[]])[]): Employee[] =>
    agents.map(([id, tools]) => employee({ id, tools, description: 'Does things.' }))

  assert.equal(findManager(staff([['manager', ['Task']], ['boss', ['Task']]])), 'manager', 'the name wins over the tool')
  assert.equal(findManager(staff([['boss', ['Task', 'Read']], ['builder', ['Read']]])), 'boss', 'the delegator is the manager when nobody is named one')
  assert.equal(findManager(staff([['builder', ['Read']]])), null, 'an office with nobody who can dispatch has no manager')
  assert.equal(findManager([]), null, 'an empty workspace has no manager, rather than a stand-in')
})

test('an office with two agents who can dispatch and nobody designated says so', () => {
  /*
   * `findManager` falls back to whoever declares the delegation tool, and with two it takes the
   * first — deterministic, because discovery sorts by filename, and arbitrary all the same. The
   * per-file rule then reports the *other* one:
   *
   *     boss + sneaky  →  "sneaky.md violates only-manager-may-delegate"
   *     alpha + zeta   →  "zeta.md violates only-manager-may-delegate"
   *
   * Same office, same ambiguity, and renaming the files moves which one is blamed. It reads as
   * one agent overstepping when the condition is that two can dispatch and neither was chosen.
   *
   * The name-based rule this module replaced flagged both. That was wrong for a lone delegator —
   * the bug — and right here, because it made the ambiguity visible. This is that half kept, as
   * a finding about the set.
   */
  const staff = (agents: readonly (readonly [string, string[]])[]): Employee[] =>
    agents.map(([id, tools]) => employee({ id, tools, description: 'Does things.', filePath: `/tmp/${id}.md` }))
  const rules = (list: Employee[]): string[] =>
    lintStaff(list).filter((p): p is Extract<Problem, { kind: 'lint' }> => p.kind === 'lint')
      .map((p) => `${p.path.split('/').pop()}:${p.rule}`)

  const ambiguous = rules(staff([['boss', ['Task']], ['sneaky', ['Task', 'Read']]]))
  assert.ok(
    ambiguous.includes('boss.md:no-designated-manager'),
    `the office chose boss by filename order and did not say so — got ${ambiguous.join(', ')}`,
  )

  // The message names the one it picked, because that is the fact a reader cannot otherwise get.
  const finding = lintStaff(staff([['boss', ['Task']], ['sneaky', ['Task', 'Read']]]))
    .find((p): p is Extract<Problem, { kind: 'lint' }> => p.kind === 'lint' && p.rule === 'no-designated-manager')
  // `using boss`, not `boss`. The message names it twice — once as the office's choice and once
  // in "Rename boss to manager" — so matching the bare name passes with the choice removed. That
  // mutation came back green until this was narrowed.
  assert.match(
    finding?.detail ?? '',
    /using boss/,
    'the finding does not say which agent the office is actually running on',
  )

  // Not fired when there is nothing ambiguous: one delegator is the manager, and a named manager
  // settles it however many others there are.
  assert.deepEqual(rules(staff([['boss', ['Task']], ['builder', ['Read']]])), [])
  assert.deepEqual(
    rules(staff([['manager', ['Task']], ['rogue', ['Task', 'Read']]])),
    ['rogue.md:only-manager-may-delegate'],
    'a named manager is designated, so there is no ambiguity to report',
  )
})

test('an office where nobody can dispatch says so, rather than throwing at first use', () => {
  /*
   * The louder half of the same question, and it was the silent one:
   *
   *     builder (Read), reviewer (Read, Grep)
   *     findManager : null     lint : []     ws.problems : []
   *
   * A clean panel on an office that looks fully staffed and throws `no manager agent found in
   * …/.claude/agents` the first time anybody sends a message. Its neighbour —
   * `no-designated-manager` — covers a *working* office making an arbitrary choice; this covers
   * one that cannot run at all, and only the milder of the two was reported.
   */
  const staff = (agents: readonly (readonly [string, string[]])[]): Employee[] =>
    agents.map(([id, tools]) => employee({ id, tools, description: 'Does things.', filePath: `/tmp/${id}.md` }))
  const rules = (list: Employee[]): string[] =>
    lintStaff(list).filter((p): p is Extract<Problem, { kind: 'lint' }> => p.kind === 'lint').map((p) => p.rule)

  assert.deepEqual(
    rules(staff([['builder', ['Read']], ['reviewer', ['Read', 'Grep']]])),
    ['no-manager'],
    'an office with nobody who can dispatch reported nothing',
  )

  // An empty workspace is not a misconfiguration — it is a fresh clone, and the composer already
  // says "Nobody works here yet — hire somebody to get started". Reporting it here would put a
  // lint finding on every first run.
  assert.deepEqual(rules([]), [], 'a fresh clone was told it is broken')

  // And it does not fire when there is a manager, by either route.
  assert.deepEqual(rules(staff([['boss', ['Task']], ['builder', ['Read']]])), [])
  assert.deepEqual(rules(staff([['manager', ['Task']], ['builder', ['Read']]])), [])
})

test('a manager who cannot dispatch is reported, and an inheriting one is not', () => {
  /*
   * The third case in this family and the most reachable. `findManager` matches on the **name**
   * and never looks at tools, so an agent called `manager` with an explicit list that omits the
   * delegation tool is returned as the manager. The office starts, the panel is clean, and every
   * dispatch fails.
   *
   *     no delegator at all         cannot run          `no-manager`
   *     2+ delegators, none named   runs, arbitrary     `no-designated-manager`
   *     named manager, no Task      starts, then fails  this one, and it was silent
   *
   * The other two need a hand-edited `.claude/agents/`. This one comes out of the hire form.
   *
   * `tools: null` must not be flagged: an omitted key inherits everything *including* delegation,
   * which is the distinction `employee-must-declare-tools` already turns on. A rule that got that
   * backwards would tell somebody to add a tool their manager already has.
   */
  const staff = (agents: readonly (readonly [string, string[] | null])[]): Employee[] =>
    agents.map(([id, tools]) => employee({ id, tools, description: 'Does things.', filePath: `/w/.claude/agents/${id}.md` }))
  const rules = (list: Employee[]): string[] =>
    lintStaff(list).filter((p): p is Extract<Problem, { kind: 'lint' }> => p.kind === 'lint').map((p) => p.rule)

  assert.deepEqual(
    rules(staff([['manager', ['Read', 'Write']], ['builder', ['Read']]])),
    ['manager-cannot-delegate'],
    'a manager with no delegation tool started the office and reported nothing',
  )

  // Inheritance is not absence.
  assert.deepEqual(rules(staff([['manager', null], ['builder', ['Read']]])), [], 'an inheriting manager was told to add a tool it already has')
  assert.deepEqual(rules(staff([['manager', ['Task', 'Read']], ['builder', ['Read']]])), [])
  // And the same for a manager found by the delegation fallback, who has it by definition.
  assert.deepEqual(rules(staff([['boss', ['Task']], ['builder', ['Read']]])), [])
})

test('the no-manager finding counts, and points at the directory rather than a file', () => {
  // "1 agents are on the floor" was reachable — it is the shape that broke a `hire` test. And the
  // finding is about the set, so blaming whichever file sorts first gives a name with no reason
  // attached, unlike `no-designated-manager` which points at the agent the office chose.
  const staff = (ids: readonly string[]): Employee[] =>
    ids.map((id) => employee({ id, tools: ['Read'], description: 'Does things.', filePath: `/w/.claude/agents/${id}.md` }))
  const finding = (list: Employee[]) =>
    lintStaff(list).find((p): p is Extract<Problem, { kind: 'lint' }> => p.kind === 'lint' && p.rule === 'no-manager')

  assert.match(finding(staff(['builder']))?.detail ?? '', /The one agent on the floor does not/)
  assert.match(finding(staff(['builder', 'reviewer']))?.detail ?? '', /All 2 agents on the floor do not/)
  assert.equal(finding(staff(['builder']))?.path, '/w/.claude/agents', 'the finding blames a file for a fact about the set')
})

/*
 * A skill dropped straight into `skills/`, which is the near-miss somebody actually makes.
 *
 * A skill is `skills/<name>/SKILL.md`. Given `skills/loose.md`, the scanner used to stat
 * `loose.md/SKILL.md` — a path that cannot exist — and report `ENOTDIR: not a directory` about
 * it. A raw errno, naming a file nobody wrote, for a mistake with a one-line fix.
 *
 * The silence beside it matters as much: a `README.md` next to the skills is somebody's note and
 * none of the office's business. The line between them is whether the file *looks like a skill*,
 * which is the same discrimination `memory.ts` makes between a record and a note.
 */
test('a skill in the wrong place is named, and a plain file beside it is not', async (t) => {
  const root = await workspace(t, {}, { proper: '---\nname: proper\ndescription: Fine.\n---\nBody.\n' })
  await writeFile(
    join(root, '.claude', 'skills', 'loose.md'),
    '---\nname: loose\ndescription: a skill that is not in a directory.\n---\nBody.\n',
  )
  await writeFile(join(root, '.claude', 'skills', 'README.md'), '# Skills\n\nNotes about this directory.\n')

  const ws = await discoverWorkspace(root)

  assert.deepEqual(ws.skills.map((s) => s.id), ['proper'], 'the real one is still found')

  const about = (name: string): Problem[] => ws.problems.filter((p) => p.path.endsWith(name))
  assert.deepEqual(about('README.md'), [], 'a note beside the skills is nobody else’s business')

  const misplaced = about('loose.md')
  assert.equal(misplaced.length, 1)
  assert.equal(misplaced[0]?.kind, 'lint')
  const detail = (misplaced[0] as { detail?: string }).detail ?? ''
  assert.match(detail, /skills\/loose\/SKILL\.md/, 'the fix, as a path they can act on')
  assert.doesNotMatch(detail, /ENOTDIR|not a directory/, 'not the errno from an impossible path')
})

test('an agent file that names itself is unaffected', async (t) => {
  // The control. The fallback only ever mattered for files without the field, and removing it
  // must not change anything about the ones that have it.
  const root = await workspace(t)
  await mkdir(join(root, '.claude', 'agents'), { recursive: true })
  await writeFile(
    join(root, '.claude', 'agents', 'file-name-differs.md'),
    '---\nname: wren\ndescription: Reviews things.\n---\n\nYou review.\n',
    'utf8',
  )

  const found = await discoverWorkspace(root)
  // And the `name:` wins over the filename, which is what the CLI does.
  assert.deepEqual(found.employees.map((e) => e.id), ['wren'])
})

test('a SKILL.md one directory too deep is reported, not silently passed over', async (t) => {
  /*
   * Measured against the installed CLI on this machine: with `skills/pack/inner/SKILL.md` in
   * place, `/buried` (its frontmatter name) and `/inner` (its directory) are both "Unknown
   * command", while a properly-placed skill in the same workspace loads. The CLI's own debug log
   * names the skills it found and never mentions the one it passed over.
   *
   * So the office does not start loading them — they would sit on a shelf and refuse to run,
   * which is the floor lying in the other direction. It says why instead, which is exactly the
   * discrimination `skill-outside-a-directory` already makes: the shape is the evidence.
   */
  const root = await tempDir(t, 'office-deep-')
  await mkdir(join(root, '.claude', 'skills', 'pack', 'inner'), { recursive: true })
  await writeFile(
    join(root, '.claude', 'skills', 'pack', 'inner', 'SKILL.md'),
    '---\nname: buried\ndescription: A skill nobody will ever run.\n---\n\nDo the thing.\n',
    'utf8',
  )

  const ws = await discoverWorkspace(root)
  assert.equal(ws.skills.length, 0, 'a skill the CLI will not load was put on the shelf')
  const said = ws.problems.find((p) => p.kind === 'lint' && p.rule === 'skill-too-deep')
  assert.ok(said, 'a skill that cannot run was passed over in silence')
  assert.match(said.kind === 'lint' ? said.detail : '', /skills\/inner\/SKILL\.md/)
})

test('a directory of shared assets beside the skills is nobody’s business', async (t) => {
  /*
   * The control, and the line this check must not cross. Some packs ship images and data
   * alongside their skills; a lint for every one of those is how a problems panel gets ignored.
   * The discrimination is whether it looks like a skill — a `SKILL.md` with a description.
   */
  const root = await tempDir(t, 'office-assets-')
  await mkdir(join(root, '.claude', 'skills', 'assets', 'img'), { recursive: true })
  await writeFile(join(root, '.claude', 'skills', 'assets', 'img', 'note.txt'), 'not a skill\n', 'utf8')

  const ws = await discoverWorkspace(root)
  assert.deepEqual(ws.problems, [], 'a directory of assets was reported as a broken skill')
})
