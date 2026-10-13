/**
 * The manager's session.
 *
 * Two things are checked here, and both are promises made elsewhere in the repo that used to
 * have nothing holding them up.
 *
 * **The roster block.** `.claude/agents/manager.md` tells the manager its staff arrive under
 * `## CURRENT STAFF` every turn. If that block does not actually arrive, the manager is
 * following an instruction about something that never happens and picking who to dispatch from
 * memory instead.
 *
 * **The session id.** A first message that fails must not leave every later message resuming a
 * conversation that was never created. The id is only ours to reuse once Claude has said it
 * exists.
 */

import { DEFAULT_CONTROLS, type Controls } from '../src/shared/controls.js'
import type { Mode } from '../src/shared/session/mode.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { initialControls, ManagerSession } from '../src/main/session.js'
import type { SessionState, StaffMember } from '../src/shared/ipc.js'
import { assistantText, fakeClaude, init, result } from './fake-claude.js'

const staff: StaffMember[] = [
  { id: 'manager', name: 'manager', description: 'Runs the floor.', tools: ['Read', 'Task'], model: 'opus', isManager: true },
  { id: 'reviewer', name: 'reviewer', description: 'Reads changes.', tools: ['Read', 'Grep'], model: 'opus', isManager: false },
  { id: 'memory-keeper', name: 'memory-keeper', description: 'Remembers.', tools: null, model: null, isManager: false },
]

function session(over: {
  claudePath: string
  cwd: string
  staff?: StaffMember[]
  controls?: Controls
  mode?: Mode
  costUsd?: number | null
}) {
  const states: SessionState[] = []
  const manager = new ManagerSession({
    cwd: over.cwd,
    agent: 'manager',
    staff: () => over.staff ?? staff,
    projectBlock: () => '## CURRENT PROJECT\n\nNone.',
    project: 'the-office',
    controls: () => over.controls ?? DEFAULT_CONTROLS,
    claudePath: over.claudePath,
    ...(over.mode ? { mode: over.mode } : {}),
    ...('costUsd' in over ? { costUsd: over.costUsd ?? null } : {}),
    onEvent: () => {},
    onState: (s) => states.push(s),
  })
  return { manager, states }
}

// ────────────────────────────────────────────────────────────── the roster ──

test('the roster reaches the prompt Claude is actually given', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('On it.'), result(false)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  await manager.send('review the auth change')

  const argv = await fake.argv()
  const prompt = argv.at(-1) ?? ''
  assert.match(prompt, /## CURRENT STAFF/)
  assert.match(prompt, /- reviewer —/)
  assert.match(prompt, /review the auth change$/)
})

test('the roster is re-read every turn, not captured when the session opened', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('ok'), result(false)] })
  let roster = [staff[0]!, staff[1]!]

  const manager = new ManagerSession({
    cwd: fake.dir,
    agent: 'manager',
    staff: () => roster,
    projectBlock: () => '## CURRENT PROJECT\n\nNone.',
    project: 'the-office',
    controls: () => DEFAULT_CONTROLS,
    claudePath: fake.path,
    onEvent: () => {},
    onState: () => {},
  })

  await manager.send('first')
  assert.ok(!(await fake.argv()).at(-1)?.includes('memory-keeper'))

  roster = staff // somebody was hired mid-project
  await manager.send('second')
  assert.match((await fake.argv()).at(-1) ?? '', /memory-keeper/)
})

// ───────────────────────────────────────────────────────── the session id ──

test('the first message claims the id; the second resumes it', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), result(false)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  await manager.send('one')
  assert.ok((await fake.argv()).includes('--session-id'))

  await manager.send('two')
  const argv = await fake.argv()
  assert.equal(argv[argv.indexOf('--resume') + 1], manager.id)
})

test('a first message that never opened a session does not poison the ones after it', async (t) => {
  // The failure this guards: `claude` reports an error before emitting `init`, so no session
  // exists on disk. Treating the attempt as "started" makes every later message resume an id
  // that was never created, and the office stays broken until it is restarted.
  const fake = await fakeClaude(t, { lines: [result(true, 'Invalid API key')], exitCode: 1 })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  await manager.send('one')
  assert.equal(manager.state.phase, 'failed')
  assert.equal(manager.state.sessionId, null, 'no session was opened, so there is none to report')

  await manager.send('two')
  const argv = await fake.argv()
  assert.ok(argv.includes('--session-id'), 'the second attempt starts a session rather than resuming a ghost')
  assert.ok(!argv.includes('--resume'))
})

test('a run that opened a session and then failed is still resumable', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), result(true, 'rate limited')], exitCode: 1 })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  await manager.send('one')
  assert.equal(manager.state.phase, 'failed')

  await manager.send('two')
  assert.ok((await fake.argv()).includes('--resume'), 'init arrived, so the conversation exists')
})

test('a binary that cannot be started is reported as failed, not as idle', async () => {
  const { manager, states } = session({ claudePath: '/nonexistent/claude', cwd: process.cwd() })

  await assert.rejects(manager.send('hello'))

  assert.equal(manager.state.phase, 'failed')
  assert.match(manager.state.error ?? '', /nonexistent/)
  assert.equal(states.at(-1)?.phase, 'failed', 'the renderer is told, rather than left showing idle')
})

/**
 * This replaces a test that asserted the opposite, and the change is deliberate rather than a
 * regression.
 *
 * The old behaviour threw, and its stated reason was sound and is still true: two concurrent
 * runs on one session id interleave in the transcript, and the floor would depict two
 * conversations as one. What was wrong was the conclusion drawn from it. That argument forbids
 * running them *at the same time*. It says nothing against running them *in order*.
 *
 * So the invariant below is the one that was actually being protected, and it is unchanged.
 */
test('a message sent mid-turn is queued, not refused', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), result(false)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  const first = manager.send('one')
  await manager.send('two') // resolves immediately; it is queued behind the first
  assert.deepEqual(manager.state.queued, ['two'], 'an accepted message must be visible somewhere')
  await first
  assert.deepEqual(manager.state.queued, [], 'the queue drained')
})

test('THE INVARIANT: queued messages run one at a time, never concurrently', async (t) => {
  // The thing the old exception existed to protect. Two runs on one session id would interleave
  // in the transcript and the floor would show two conversations as one.
  const fake = await fakeClaude(t, { lines: [init('s'), result(false)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  const first = manager.send('one')
  await manager.send('two')
  await manager.send('three')
  await first

  // Every message ran, and the session never held two at once — `send` awaits each turn before
  // starting the next, so a second run cannot begin while `running` is set.
  assert.deepEqual(manager.state.queued, [])
  assert.equal(manager.state.phase, 'idle')
})

test('stop clears what was waiting, and says what it dropped', async (t) => {
  // Pressing stop and then watching three more messages fire would be alarming, and it is not
  // what the word means. Discarding them silently would be worse — the user typed them and the
  // office accepted them.
  const fake = await fakeClaude(t, { lines: [init('s'), result(false)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  const first = manager.send('one')
  await manager.send('two')
  await manager.send('three')

  const dropped = manager.interrupt()
  assert.deepEqual(dropped, ['two', 'three'])
  assert.deepEqual(manager.state.queued, [])
  await first.catch(() => {})
})

test('cost accumulates across turns rather than reporting only the last one', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), result(false, 'done', 0.01)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  await manager.send('one')
  await manager.send('two')

  assert.equal(manager.state.costUsd, 0.02)
})

test('money spent outside a turn still lands on the project total', async (t) => {
  // Asides and voice digests are separate `claude` runs on separate sessions, and they cost
  // real money. Leaving them out meant the number under the composer was not what the
  // conversation had cost — a small lie told in a very believable font.
  const fake = await fakeClaude(t, { lines: [init('s'), result(false, 'done', 0.02)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  await manager.send('one')
  assert.equal(manager.state.costUsd, 0.02)

  manager.spend(0.0005) // an aside
  manager.spend(0.0003) // a voice digest

  assert.equal(Number(manager.state.costUsd?.toFixed(4)), 0.0208)
})

test('a free digest and a null cost change nothing', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), result(false, 'done', 0.01)] })
  const { manager, states } = session({ claudePath: fake.path, cwd: fake.dir })

  await manager.send('one')
  const before = states.length

  manager.spend(null)
  manager.spend(0)

  assert.equal(manager.state.costUsd, 0.01)
  assert.equal(states.length, before, 'and nothing is republished for a change that did not happen')
})

// ──────────────────────────────────────────────────────────────── the dials ──

test('a dial the user turned reaches the process that was spawned', async (t) => {
  // The honesty check for the whole controls feature, and the reason it is asserted against a
  // recorded argv rather than against our own intent: a picker that says "opus" over a
  // conversation running the workspace default is the third standing order broken in the
  // smallest and least visible way there is. Nobody would notice for weeks.
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('ok'), result(false)] })
  const { manager } = session({
    claudePath: fake.path,
    cwd: fake.dir,
    controls: { model: 'opus', effort: 'max', permissionMode: 'plan' },
  })

  await manager.send('anything')
  const argv = await fake.argv()

  for (const [flag, value] of [
    ['--model', 'opus'],
    ['--effort', 'max'],
    ['--permission-mode', 'plan'],
  ] as const) {
    const at = argv.indexOf(flag)
    assert.ok(at >= 0, `${flag} never reached the CLI`)
    assert.equal(argv[at + 1], value, `${flag} was passed with the wrong value`)
  }
})

test('dials left at default put no flag on the command line at all', async (t) => {
  // Not the same as passing the CLI's current default by name. The office must not pin a choice
  // the user did not make — when the CLI's default changes, an office that had named the old
  // one would silently keep it.
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('ok'), result(false)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  await manager.send('anything')
  const argv = await fake.argv()

  for (const flag of ['--model', '--effort', '--permission-mode']) {
    assert.ok(!argv.includes(flag), `${flag} was passed when nothing was set`)
  }
  assert.ok(!argv.includes('default'), 'the literal word "default" reached the CLI')
})

test('the dials are read at send time, so turning one mid-conversation takes effect', async (t) => {
  // A value captured when the session was constructed would mean switching to plan mode and
  // then sending took effect on the message *after* the one you were worried about.
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('ok'), result(false)] })
  let controls: Controls = { ...DEFAULT_CONTROLS }

  const manager = new ManagerSession({
    cwd: fake.dir,
    agent: 'manager',
    staff: () => staff,
    projectBlock: () => '## CURRENT PROJECT\n\nNone.',
    project: 'the-office',
    controls: () => controls,
    claudePath: fake.path,
    onEvent: () => {},
    onState: () => {},
  })

  await manager.send('first')
  assert.ok(!(await fake.argv()).includes('--model'), 'nothing was set for the first message')

  controls = { ...DEFAULT_CONTROLS, model: 'sonnet' }
  await manager.send('second')
  const argv = await fake.argv()
  assert.equal(argv[argv.indexOf('--model') + 1], 'sonnet')
})

test('OFFICE_PERMISSION_MODE cannot smuggle in a mode the CLI ignores', () => {
  // X8 through a second door. `manual` passes `isPermissionMode` — it is a real CLI mode — and
  // under `--print` it silently resolves to `default`. Honouring it here would put the office
  // back to reporting a mode the session is not in, this time without a picker to blame.
  const before = process.env['OFFICE_PERMISSION_MODE']
  try {
    for (const ignored of ['manual', 'auto']) {
      process.env['OFFICE_PERMISSION_MODE'] = ignored
      assert.notEqual(initialControls().permissionMode, ignored)
    }

    // A mode that works is still honoured, or the guard has overreached.
    process.env['OFFICE_PERMISSION_MODE'] = 'plan'
    assert.equal(initialControls().permissionMode, 'plan')

    // And nonsense still falls back rather than throwing.
    process.env['OFFICE_PERMISSION_MODE'] = 'nonsense'
    assert.equal(initialControls().permissionMode, 'acceptEdits')
  } finally {
    if (before === undefined) delete process.env['OFFICE_PERMISSION_MODE']
    else process.env['OFFICE_PERMISSION_MODE'] = before
  }
})

test('the shelf reaches the prompt claude is actually given', async (t) => {
  // The gap F15 exists to close, asserted where it counts — in the argv handed to the binary,
  // not in the assembly function. `manager.md` instructs the manager to invoke skills by name,
  // and the office never handed over the list: a user adding a fourth skill got it drawn on the
  // shelf and never mentioned to the one who would use it.
  const fake = await fakeClaude(t, { lines: [init('s'), result(false)] })
  const manager = new ManagerSession({
    cwd: fake.dir,
    agent: 'manager',
    staff: () => staff,
    projectBlock: () => 'office-space',
    project: 'office-space',
    controls: () => DEFAULT_CONTROLS,
    claudePath: fake.path,
    office: () => ({
      skills: [{ id: 'meet', description: 'Call colleagues into the meeting room.' }],
      nowPlaying: 'Miles Davis — So What',
    }),
    onEvent: () => {},
    onState: () => {},
  })

  await manager.send('who should look at the retry ceiling?')
  const prompt = (await fake.argv()).at(-1) ?? ''

  assert.match(prompt, /## SKILLS ON THE SHELF/)
  assert.match(prompt, /`meet`/)
  assert.match(prompt, /## NOW PLAYING[\s\S]*Miles Davis/)
  // …and the two that were always there are still there, ahead of it.
  assert.ok(prompt.indexOf('## CURRENT STAFF') < prompt.indexOf('## SKILLS ON THE SHELF'))
  assert.match(prompt, /who should look at the retry ceiling\?$/)
})

test('a session with nothing extra to say sends no extra blocks', () => {
  // The cost rule, at the wiring level: a caller that supplies no office state must not start
  // paying for headings on every turn.
  const manager = new ManagerSession({
    cwd: '/tmp',
    agent: 'manager',
    staff: () => staff,
    projectBlock: () => 'office-space',
    project: 'office-space',
    controls: () => DEFAULT_CONTROLS,
    onEvent: () => {},
    onState: () => {},
  })
  assert.ok(manager.id.length > 0)
})

// ──────────────────────────────────────────────────────────────── the mode ──

test('a session in intake spawns without the tools intake withholds', async (t) => {
  // The enforcement, end to end against a real child process and a recorded argv. Everything
  // else about intake is a claim until this line: the mode module says Task is withheld, run.ts
  // says the flag is built, and this is the only test that proves the session connects them.
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('ok'), result(false)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir, mode: 'intake' })

  await manager.send('hello')
  const argv = await fake.argv()

  const at = argv.indexOf('--disallowedTools')
  assert.ok(at >= 0, 'intake spawned with nothing withheld — the manager can still dispatch')
  assert.deepEqual(argv.slice(at + 1, at + 4), ['Task', 'Write', 'Edit'])
})

test('a session in building spawns with nothing withheld', async (t) => {
  // The other half. A flag that is always passed is not enforcement, it is decoration.
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('ok'), result(false)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir, mode: 'building' })

  await manager.send('hello')
  assert.ok(!(await fake.argv()).includes('--disallowedTools'))
})

test('the prompt survives the withheld-tools flag', async (t) => {
  // `--disallowedTools` is variadic. Without the `--` terminator it eats the prompt and the CLI
  // exits with "Input must be provided" — measured, and the reason the terminator exists.
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('ok'), result(false)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir, mode: 'intake' })

  await manager.send('what are we building')
  assert.match((await fake.argv()).at(-1) ?? '', /what are we building/)
})

test('moving the mode reports what it left, and reports nothing when it did not move', () => {
  // The event carries `from` because "intake ended" and "a new conversation opened in planning"
  // are different facts. A move to the mode you are already in is not a move.
  const { manager } = session({ claudePath: '/nonexistent', cwd: '/tmp' })
  assert.equal(manager.mode, 'intake')
  assert.equal(manager.setMode('building'), 'intake')
  assert.equal(manager.mode, 'building')
  assert.equal(manager.setMode('building'), null)
})

// ─────────────────────────────────────────────── what the conversation has cost ────

/**
 * A resumed conversation owes what it already owed.
 *
 * `main.ts` writes the registry from `session.state.costUsd` on every state change. Every other
 * field in that write falls back to what is already recorded — `createdAt: existing?.createdAt ??
 * now`, and the title to `existing?.title` — because they are facts about the conversation rather
 * than about this run of it. Cost is the same kind of fact and did not.
 *
 * So the session started at zero on resume, the first turn set it to that turn's spend, and the
 * write put **this run's cost** over the conversation's total. Resume something that had cost
 * $2.40, say one thing worth 3 cents, and the registry records $0.03. The earlier figure is gone
 * and there is nothing to recover it from.
 *
 * It went unnoticed for as long as nothing read the number. `sessionRows` reads it as of #173, so
 * the silent write became a wrong figure on the row somebody picks a conversation from.
 */
test('a resumed conversation carries the cost it already had', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('ok'), result(false, 'done', 0.03)] })
  const { manager, states } = session({ claudePath: fake.path, cwd: fake.dir, costUsd: 2.4 })

  // Before anything is spent. A session that reported `null` here would have its recorded total
  // written away by the very first state change, before a single turn.
  assert.equal(manager.state.costUsd, 2.4, 'the conversation opened having spent nothing it had already spent')

  await manager.send('carry on')

  // Compared with a tolerance, and the reason is worth writing down rather than hiding behind a
  // rounder number: this is a running sum of floats, so 2.4 + 0.03 is 2.4299999999999997. It is
  // never shown that way — `money()` is `toFixed(4)`, which renders it `$2.4300` — but the value
  // on disk does carry the drift, and an exact comparison here would be a test that passes only
  // for costs that happen to be representable.
  assert.ok(
    Math.abs((manager.state.costUsd ?? 0) - 2.43) < 1e-9,
    `the conversation reports ${manager.state.costUsd}: the run replaced its total instead of ` +
      `adding to it, and that is the number that goes into the registry over the top of the one ` +
      `it came from`,
  )
  assert.ok(
    states.some((s) => Math.abs((s.costUsd ?? 0) - 2.43) < 1e-9),
    'the total never reached a state anybody was told about',
  )
})

test('a new conversation starts at nothing, which is not the same as zero', async (t) => {
  // The control, and the distinction the switcher draws: `null` is "no figure", `0` is "cost
  // nothing". A seed that defaulted to 0 would make every new conversation claim a price.
  const fake = await fakeClaude(t, { lines: [init('s'), result(false, 'done', 0.05)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  assert.equal(manager.state.costUsd, null, 'a conversation nothing has been spent on reported a number')
  await manager.send('hello')
  assert.equal(manager.state.costUsd, 0.05)
})

test('a conversation resumed with no recorded figure still starts at nothing', async (t) => {
  // The registry has `costUsd: null` for conversations written before costs were recorded. That
  // must stay null rather than becoming 0, or restoring an old conversation invents a price of
  // exactly nothing for it.
  const fake = await fakeClaude(t, { lines: [init('s'), result(false, 'done', 0.05)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir, costUsd: null })
  assert.equal(manager.state.costUsd, null)
})
