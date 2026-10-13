/**
 * The approval rendezvous.
 *
 * The hook is a separate process with no handle on anything in ours, so the two meet in a
 * directory. These tests drive the app's half against files written the way the hook writes
 * them — including half-written ones, because we are watching a directory another process is
 * writing into and catching one mid-write is expected rather than exceptional.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import type { Policy, PolicyRead } from '../src/main/permissions.js'
import { chmod, lstat, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import { Decided, MARKER_NAME, WATCHING, approvalRecord, decide, forwardInOrder, pending, triage, triageAgainst, type ApprovalRequest, watchApprovals, pendingFrom } from '../src/main/approvals.js'

import { tempDir } from './temp-dir.js'

const DIR = join('.office-space', 'approvals')

async function workspace(t: TestContext): Promise<string> {
  return tempDir(t, 'office-approvals-')
}

async function ask(root: string, over: Record<string, unknown> = {}): Promise<void> {
  const req = {
    sessionId: 's-1',
    toolUseId: 't-1',
    tool: 'Bash',
    input: { command: 'rm -rf dist' },
    cwd: root,
    askedAt: '2026-08-20T10:00:00Z',
    waitMs: 240_000,
    ...over,
  }
  await mkdir(join(root, DIR), { recursive: true })
  await writeFile(join(root, DIR, `${req.sessionId}.${req.toolUseId}.request.json`), JSON.stringify(req))
}

/**
 * The waiting list, insisting it could actually be read.
 *
 * `pending` now returns `null` for "could not look", and every test below is about the list. A
 * `?? []` here would paper over exactly the distinction this signature exists to make, so it
 * fails loudly instead.
 */
async function waiting(root: string): Promise<readonly ApprovalRequest[]> {
  const got = await pending(root)
  assert.notEqual(got, null, 'the approvals directory could not be read')
  return got ?? []
}

test('a workspace nothing has ever asked in has nothing pending', async (t) => {
  // Genuinely empty rather than unreadable-and-hidden: the hook creates the directory on its
  // first request, so its absence is a fact rather than a failure.
  assert.deepEqual(await waiting(await workspace(t)), [])
})

test('a request is read with its tool and input verbatim', async (t) => {
  // The card must show what is about to run. A paraphrase means approving something else.
  const root = await workspace(t)
  await ask(root)

  const [req] = await waiting(root)
  assert.equal(req?.tool, 'Bash')
  assert.deepEqual(req?.input, { command: 'rm -rf dist' })
  assert.equal(req?.sessionId, 's-1')
  assert.equal(req?.toolUseId, 't-1')
})

test('a half-written request is skipped, not crashed on', async (t) => {
  // We watch a directory another process writes into. Catching a file mid-write is normal, and
  // it will be complete on the next tick — meanwhile the hook is still blocking, so nothing is
  // lost by ignoring it.
  const root = await workspace(t)
  await mkdir(join(root, DIR), { recursive: true })
  await writeFile(join(root, DIR, 's-1.t-1.request.json'), '{"sessionId":"s-1","too')
  await ask(root, { toolUseId: 't-2' })

  const got = await waiting(root)
  assert.equal(got.length, 1, 'the complete request was lost along with the partial one')
  assert.equal(got[0]?.toolUseId, 't-2')
})

test('requests come back oldest first', async (t) => {
  // Somebody answering a queue answers the one that has been waiting longest, and the hook that
  // has been blocking longest is the one closest to timing out.
  const root = await workspace(t)
  await ask(root, { toolUseId: 'later', askedAt: '2026-08-20T10:05:00Z' })
  await ask(root, { toolUseId: 'earlier', askedAt: '2026-08-20T10:00:00Z' })

  assert.deepEqual((await waiting(root)).map((r) => r.toolUseId), ['earlier', 'later'])
})

test('a verdict is written where the hook is looking for it', async (t) => {
  // The other side of the rendezvous. The filename is the contract.
  const root = await workspace(t)
  await decide(root, 's-1', 't-1', true)

  const written = JSON.parse(await readFile(join(root, DIR, 's-1.t-1.verdict.json'), 'utf8'))
  assert.deepEqual(written, { allow: true })
})

test('a denial carries its reason, because the model reads it too', async (t) => {
  // A denial an agent can read is one it can work around. One it cannot read is a wall it will
  // walk into again on the next turn.
  const root = await workspace(t)
  await decide(root, 's-1', 't-1', false, 'Not on the production database.')

  const written = JSON.parse(await readFile(join(root, DIR, 's-1.t-1.verdict.json'), 'utf8'))
  assert.equal(written.allow, false)
  assert.equal(written.reason, 'Not on the production database.')
})

test('the watcher reports a request that appears after it started', async (t) => {
  // The poll is the floor and the watcher only makes it feel immediate — fs.watch misses events
  // on some filesystems, and a missed request is a card that never appears and an agent that
  // hangs until its timeout.
  const root = await workspace(t)
  const seen: string[][] = []
  const w = watchApprovals(root, (rs) => seen.push(rs.map((r) => r.toolUseId)), 40)

  await ask(root, { toolUseId: 'appeared' })
  await new Promise((r) => setTimeout(r, 250))
  w.close()

  assert.ok(seen.some((batch) => batch.includes('appeared')), 'the watcher never reported it')
})

test('a command the workspace already allows is answered without asking anybody', () => {
  // The reason the gate could be registered at all. `PreToolUse` fires before permission
  // resolution — measured, with `Bash(echo:*)` allow-listed and the hook firing anyway — so
  // without this every `npm test` an employee runs would stop for four minutes and the allow
  // list would buy nothing.
  const call = triage(request('Bash', { command: 'npm test' }), {
    allow: ['Bash(npm test:*)'],
    deny: [],
  })
  assert.deepEqual(call, { action: 'allow', rule: 'Bash(npm test:*)' })
})

test('a denied command is answered with its rule, never offered to a person', () => {
  // `deny` in settings.json does not mean "ask me about it". It means nobody is invited to
  // decide, so surfacing a card would be offering a choice the workspace already refused.
  const call = triage(request('Bash', { command: 'rm -rf build' }), {
    allow: [],
    deny: ['Bash(rm:*)'],
  })
  assert.deepEqual(call, { action: 'deny', rule: 'Bash(rm:*)' })
})

test('an unlisted command is the one that becomes a question', () => {
  // The whole point. Today `--print` refuses this silently and the employee is told no.
  const call = triage(request('Bash', { command: 'node scripts/migrate.mjs' }), {
    allow: ['Bash(npm test:*)'],
    deny: ['Bash(rm:*)'],
  })
  assert.deepEqual(call, { action: 'ask' })
})

test('a chained command does not inherit the permission of the command it starts with', () => {
  // `npm test && rm -rf ~` begins with `npm test`. permissions.ts already refuses to let a
  // chain inherit a rule; this pins that the gate does not quietly undo it by auto-allowing.
  const call = triage(request('Bash', { command: 'npm test && rm -rf ~' }), {
    allow: ['Bash(npm test:*)'],
    deny: [],
  })
  assert.deepEqual(call, { action: 'ask' })
})

test('anything that is not Bash is asked about', () => {
  // Unreachable while the matcher is Bash. It exists so that widening the matcher fails towards
  // asking — a triage that auto-allowed a tool it did not recognise would be the wrong default
  // in the one direction that matters.
  const call = triage(request('WebFetch', { url: 'https://example.com' }), {
    allow: ['Bash(npm test:*)'],
    deny: [],
  })
  assert.deepEqual(call, { action: 'ask' })
})

test('a Bash call with no command string is asked about rather than reasoned about', () => {
  const call = triage(request('Bash', {}), { allow: ['Bash(npm test:*)'], deny: [] })
  assert.deepEqual(call, { action: 'ask' })
})

/** One request, as the hook writes it. Only `tool` and `input` matter to triage. */
function request(tool: string, input: Record<string, unknown>): ApprovalRequest {
  return { sessionId: 's', toolUseId: 't', tool, input, cwd: '/w', askedAt: '2026-08-20T00:00:00Z', waitMs: 240_000 }
}

test('an employee command is attributed, and the manager is the absence of attribution', () => {
  // Measured against the installed CLI rather than read off the docs: a subagent's tool call
  // carries `agent_type` — the employee's name exactly as `.claude/agents/` spells it — plus a
  // stable `agent_id`. The manager's own calls carry neither key at all.
  //
  // So `null` here means the manager. It never means "we could not tell", and nothing downstream
  // should render it as unknown: the floor draws a waiting desk from this field, and an approval
  // that cannot name who is blocked leaves seven desks looking idle while one is stopped.
  const employee = request('Bash', { command: 'node scripts/migrate.mjs' })
  assert.equal(triage({ ...employee, agent: 'builder' }, { allow: [], deny: [] }).action, 'ask')
  assert.equal(triage({ ...employee, agent: null }, { allow: [], deny: [] }).action, 'ask')

  // Attribution is carried, not consulted: who is asking must not change whether we ask.
  const policy = { allow: ['Bash(npm test:*)'], deny: [] }
  const ok = request('Bash', { command: 'npm test' })
  assert.equal(triage({ ...ok, agent: 'builder' }, policy).action, 'allow')
  assert.equal(triage({ ...ok, agent: null }, policy).action, 'allow')
})

test('the watcher says it is watching, and stops saying so when it closes', async (t) => {
  // The fix for a regression this file caused. Registering the gate in settings.json made it
  // live in *every* claude session started in this workspace, including a plain terminal one —
  // measured: `claude` in this repo hung for four minutes on the first unlisted command, waiting
  // for a verdict from an app nobody had opened. A gate that blocks the tool it governs is worse
  // than no gate.
  //
  // The hook reads this marker's mtime. Freshness rather than existence, because a killed app
  // runs no cleanup and a marker that only had to exist would put the hang straight back.
  const root = await tempDir(t, 'watching-')
  const marker = join(root, WATCHING)

  const watcher = watchApprovals(root, () => {}, 20)
  await new Promise((r) => setTimeout(r, 120))
  const seen = await stat(marker)
  assert.ok(Date.now() - seen.mtimeMs < 5_000, 'the marker is not fresh while the watcher runs')

  watcher.close()
  await new Promise((r) => setTimeout(r, 120))
  await assert.rejects(
    stat(marker),
    'closing left the marker behind, so the hook still thinks somebody is watching',
  )
})

test('the heartbeat writes a file, never through a link somebody left there', async (t) => {
  // `writeFile(path, '')` follows a symlink and truncates the far end. This one runs on a timer,
  // at a path that is fixed and documented, so a link dropped at `.office-space/approvals/`
  // empties its target every 400ms for as long as the office is open — no click, no prompt, no
  // trace in the UI. A read through a link leaks once; a write like this destroys repeatedly.
  //
  // Ranked below the same shape in `projects/_TEMPLATE/` because `.gitignore` covers
  // `.office-space/`, so a clone cannot carry the link and somebody has to place it. That is a
  // reason it is not first, not a reason to leave it.
  const root = await tempDir(t, 'watching-link-')
  const victim = join(root, 'VICTIM.txt')
  await mkdir(join(root, DIR), { recursive: true })
  await writeFile(victim, 'contents that must survive\n')
  await symlink(victim, join(root, WATCHING))

  const watcher = watchApprovals(root, () => {}, 20)
  await new Promise((r) => setTimeout(r, 120))
  // Read the marker before closing: `close` unlinks it on purpose, so afterwards there is
  // nothing to tell a replaced link from a link that was never touched.
  const info = await lstat(join(root, WATCHING))
  watcher.close()

  assert.equal(
    await readFile(victim, 'utf8'),
    'contents that must survive\n',
    'the heartbeat wrote through the symlink and truncated whatever was on the other end',
  )
  // And it still beats — replacing the link rather than refusing to write, because a tick that
  // declined would tell every hook that nobody is watching, which is the four-minute hang.
  assert.ok(!info.isSymbolicLink(), 'the link is still in place, so the next tick truncates again')
  assert.ok(Date.now() - info.mtimeMs < 5_000, 'the marker went stale, so the hook stops trusting it')
})

// ──────────────────────────────────── the loop that made a button unclickable ──

/**
 * Reported of the approval card: Allow and Refuse could not be clicked at all.
 *
 * Nothing was covering the buttons and they were not disabled — `elementFromPoint` returned the
 * button itself. They could not be pressed because they **did not survive long enough to be
 * pressed**. A real click needs `mousedown` and `mouseup` on the same element; the renderer
 * rebuilds the whole activity strip on every push, replacing those buttons with new ones.
 *
 * Measured in the running app: **24.6 pushes a second**, where the 400ms poll accounts for 2.5.
 * The other 22 came from a feedback loop — `WATCHING` is written *inside* the directory being
 * watched, so every heartbeat fired the watcher, which ticked, which wrote the heartbeat again.
 *
 * Two properties fix it and both are tested here: the watcher ignores its own marker, and an
 * unchanged set is not handed to the caller at all.
 */
test('an unchanged set of requests is not pushed again', async (t) => {
  const root = await tempDir(t, 'office-approvals-')
  const pushes: number[] = []

  const watch = watchApprovals(root, (requests) => pushes.push(requests.length), 30)
  try {
    await new Promise((r) => setTimeout(r, 400))
    // Many ticks have run. Nothing changed, so exactly one answer should have been handed over:
    // the first, which must go out even though it is empty.
    assert.equal(pushes.length, 1, `pushed ${pushes.length} times with nothing changing`)
    assert.equal(pushes[0], 0, 'and the first answer is "no requests", not silence')

    await mkdir(join(root, '.office-space', 'approvals'), { recursive: true })
    await writeFile(
      join(root, '.office-space', 'approvals', 's1.t1.request.json'),
      JSON.stringify({ sessionId: 's1', toolUseId: 't1', tool: 'Bash', input: { command: 'ls' }, cwd: root, askedAt: new Date(0).toISOString() }),
      'utf8',
    )
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(pushes.length, 2, 'a request arriving is a change, and must be pushed')
    assert.equal(pushes[1], 1)

    // And it settles again rather than repeating.
    const after = pushes.length
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(pushes.length, after, 'the same request must not be pushed on every tick')
  } finally {
    watch.close()
  }
})

test('the heartbeat does not feed itself', async (t) => {
  // The marker lives *inside* the directory being watched, so a watcher that does not filter it
  // ticks itself forever. Measured in the running app before the fix: 24.6 pushes a second
  // against the 2.5 a 400ms poll accounts for.
  //
  // Counted with a second, independent watcher rather than by trusting the implementation. The
  // dedupe added above hides this from the push count entirely, which is why it needs its own
  // test — a quiet infinite loop is still an infinite loop.
  assert.equal(WATCHING, join('.office-space', 'approvals', MARKER_NAME), 'the marker is inside the watched directory')

  const root = await tempDir(t, 'office-approvals-')
  const dir = join(root, '.office-space', 'approvals')
  await mkdir(dir, { recursive: true })

  const { watch } = await import('node:fs')
  let beats = 0
  const spy = watch(dir, (_e, name) => {
    if (name === MARKER_NAME) beats += 1
  })

  const POLL = 100
  const WINDOW = 1500
  const started = watchApprovals(root, () => {}, POLL)
  try {
    await new Promise((r) => setTimeout(r, WINDOW))
  } finally {
    started.close()
    spy.close()
  }

  // One beat per poll. Measured on this machine: **16 with the filter, 30 without** — each
  // heartbeat firing the watcher, which ticks, which writes another. 1.5x sits cleanly between
  // them and leaves room for a filesystem that coalesces or double-reports a write.
  const expected = WINDOW / POLL
  assert.ok(
    beats <= expected * 1.5,
    `the heartbeat fired ${beats} times in ${WINDOW}ms with a ${POLL}ms poll — it is feeding ` +
      `itself through the watcher, which is what made the approval buttons unclickable`,
  )
})

// ──────────────────────────── the call that was held before the window opened ──

/** Poll a condition rather than sleeping a fixed time, so a loaded machine is not a failure. */
async function until(done: () => boolean, ms: number): Promise<boolean> {
  const by = Date.now() + ms
  while (!done() && Date.now() < by) await new Promise((r) => setTimeout(r, 10))
  return done()
}

/**
 * A watcher whose pushes go nowhere until something listens — `send` in main.ts, before there is
 * a window to send to.
 */
function lateListener(root: string, pollMs: number) {
  let listening = false
  let dropped = 0
  const shown: (readonly string[])[] = []
  const watcher = watchApprovals(
    root,
    (requests) => {
      if (listening) shown.push(requests.map((r) => r.toolUseId))
      else dropped += 1
    },
    pollMs,
  )
  return {
    watcher,
    shown,
    dropped: () => dropped,
    listen: () => {
      listening = true
    },
  }
}

/**
 * The watcher starts before `createWindow()`, and its first push is its only one until the held
 * set changes. Measured with a scratch script that is not in this repository, booting the real app
 * with one call already held — see the comment above `let last` in `approvals.ts` for the numbers.
 *
 * Written first without the `resend()` line, where it failed with `shown` empty — the call never
 * reached a listener that arrived after the first push. That is the bug as main.ts had it.
 */
test('a call already held when the office starts reaches the window once it is listening', async (t) => {
  const root = await workspace(t)
  await ask(root, { toolUseId: 'held-at-boot' })
  const late = lateListener(root, 20)

  try {
    assert.ok(await until(() => late.dropped() > 0, 5_000), 'the watcher never answered at all')
    await new Promise((r) => setTimeout(r, 100))

    late.listen()
    // What the renderer's subscription asks for — see `onApprovals` in preload.ts.
    late.watcher.resend()
    await until(() => late.shown.length > 0, 2_000)
    // Ten more polls with nothing changing on disk: the resend is one push, not a new habit.
    await new Promise((r) => setTimeout(r, 200))
  } finally {
    late.watcher.close()
  }

  // One assertion per way this goes wrong, so a failure names the one that happened. The
  // independent review of #238 found a single `deepEqual` here saying "never shown" about a call
  // that had been pushed ten times.
  assert.equal(late.dropped(), 1, `pushed ${late.dropped()} times before anybody listened, with nothing changing`)
  assert.ok(
    late.shown.length > 0,
    'a call held before the window could listen was never shown — the gate refuses it at its deadline with no card ever drawn for it',
  )
  assert.equal(
    late.shown.length,
    1,
    `the resend was pushed ${late.shown.length} times with nothing changing — it must be one push, not a new habit`,
  )
  assert.deepEqual(late.shown, [['held-at-boot']], 'the resend carried something other than the held call')
})

/**
 * The test above polls every 20ms, so it cannot tell a resend that ticks from one that waits for
 * the poll: with the `tick()` taken out of `resend()` it still passed. Here the poll is a minute
 * away, so every push comes from a tick somebody asked for — the one the watcher runs as it
 * starts, and the one in `resend()`. In the app a resend that waited would go out at the next poll,
 * up to 400ms later by the default.
 */
test('a resend is pushed when it is asked for, not at the next poll', async (t) => {
  const root = await workspace(t)
  await ask(root, { toolUseId: 'held-at-boot' })
  const late = lateListener(root, 60_000)

  try {
    assert.ok(await until(() => late.dropped() > 0, 5_000), 'the watcher never answered at all')
    // Long enough for a filesystem event from the first heartbeat to arrive and be ignored.
    await new Promise((r) => setTimeout(r, 300))

    late.listen()
    late.watcher.resend()
    assert.ok(
      await until(() => late.shown.length > 0, 2_000),
      'nothing was pushed when the resend was asked for, and the next poll is a minute away',
    )
  } finally {
    late.watcher.close()
  }

  assert.deepEqual(late.shown, [['held-at-boot']])
})

/**
 * The fix's two lines outside `watchApprovals`, checked as text.
 *
 * `main.ts` imports `electron` at module scope and `preload.ts` calls `contextBridge` as it loads,
 * so neither runs under this suite. Without this, main's handler could be emptied with every test
 * still passing, and `the-bridge-has-two-ends` only asks that both ends of `approvals:resend`
 * exist somewhere — not that subscribing is what asks.
 *
 * Text pins less than a run would. A line that is present and never reached still passes.
 */
test('subscribing to held calls asks for them, and main answers with a resend', async () => {
  const preload = await readFile(new URL('../src/preload/preload.ts', import.meta.url), 'utf8')
  const main = await readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8')

  const subscribing = /\n {2}onApprovals: \(callback\) => \{((?:\n {4}.*)*)\n {2}\},/.exec(preload)?.[1]
  assert.ok(subscribing !== undefined, 'onApprovals in preload.ts is not written the way this test reads it')
  const listens = subscribing.indexOf('onPlain(CHANNEL.approvals, callback)')
  const asks = subscribing.indexOf('ipcRenderer.invoke(CHANNEL.approvalsResend)')
  assert.ok(asks >= 0, 'subscribing no longer asks for the held set, so a call held at startup is never shown')
  assert.ok(listens >= 0 && listens < asks, 'onApprovals must subscribe before it asks, so the answer has a listener')

  const answering = /\n {2}ipcMain\.handle\(CHANNEL\.approvalsResend, \(\) => \{((?:\n {4}.*)*)\n {2}\}\)/.exec(main)?.[1]
  assert.ok(answering !== undefined, 'main.ts does not handle approvals:resend the way this test reads it')
  assert.match(answering, /^\s*approvalWatcher\?\.resend\(\)\s*$/m, 'main answers approvals:resend without resending')
})

// ──────────────────────────────── the two modes that did nothing whatsoever ──

/**
 * Reported from a session with `bypass permissions` selected and forty-one approval cards
 * already answered: bypass was on and nothing was being bypassed.
 *
 * That was right. The mode reached the CLI and the CLI honoured it — and then every call arrived
 * at a gate of our own that had never been told the mode existed. `triage` took a request and
 * the allow/deny lists and nothing else, so the two modes that are entirely *about* what happens
 * to an unlisted command were inert.
 *
 * They fail in opposite directions, which is why one flag could not have covered both: bypass
 * should never ask because you want everything through, `dontAsk` should never ask because you
 * want nothing through.
 */
const req = (command: string): ApprovalRequest => ({
  sessionId: 's', toolUseId: 't', tool: 'Bash',
  input: { command }, cwd: '/tmp', askedAt: new Date(0).toISOString(), waitMs: 240_000, agent: null, agentId: null,
})

const POLICY = { allow: ['Bash(npm test:*)'], deny: ['Bash(rm:*)'] }

test('bypass runs an unlisted command instead of asking about it', () => {
  assert.equal(triage(req('node -e "x"'), POLICY, 'default').action, 'ask')
  assert.equal(triage(req('node -e "x"'), POLICY, 'bypassPermissions').action, 'allow')
})

test("don't ask refuses an unlisted command instead of asking about it", () => {
  // The name is the specification: the answer is no, and no question is put.
  assert.equal(triage(req('node -e "x"'), POLICY, 'dontAsk').action, 'deny')
})

test('deny wins in every mode, including bypass', () => {
  // Claude Code's own bypass keeps deny rules too (measured against 2.1.266 on 2026-09-16); this
  // comment used to call the rule a departure from it. The asymmetry is the argument either way:
  // a deny is a standing instruction somebody wrote once and expects to hold, a mode is a
  // convenience set for an afternoon. An unnecessary refusal costs a turn; `rm -rf` on the wrong
  // directory costs the afternoon.
  for (const mode of ['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions'] as const) {
    assert.equal(triage(req('rm -rf /'), POLICY, mode).action, 'deny', `rm ran under ${mode}`)
  }
})

test('an allowed command is allowed in every mode, and never becomes a question', () => {
  for (const mode of ['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions'] as const) {
    assert.equal(triage(req('npm test'), POLICY, mode).action, 'allow', `npm test asked under ${mode}`)
  }
})

test('the three modes that should ask still ask', () => {
  // The regression that matters most: widening two modes must not quietly widen the other three.
  for (const mode of ['default', 'plan', 'acceptEdits'] as const) {
    assert.equal(triage(req('node -e "x"'), POLICY, mode).action, 'ask', `${mode} stopped asking`)
  }
})

test('a request from a conversation we cannot identify is asked about', () => {
  // `modeOf` answers `default` for an unknown session, and default asks. A request we cannot
  // attribute is exactly the one to put in front of a person.
  assert.equal(triage(req('node -e "x"'), POLICY).action, 'ask', 'the default argument must ask')
})

test('the picker no longer promises something bypass does not do', async () => {
  // It read "Asks for nothing and checks nothing. Everything this office starts may run." That
  // was false twice over — the gate asked anyway, and now that it does not, the deny list still
  // holds. A mode that quietly does less than its name is the third standing order broken where
  // somebody is most likely to trust it.
  const { PERMISSION_CHOICES } = await import('../src/shared/control-copy.js')
  const bypass = PERMISSION_CHOICES.find((c) => c.value === 'bypassPermissions')
  assert.ok(bypass, 'the bypass entry has moved; this check needs rewriting')
  assert.doesNotMatch(bypass.detail, /checks nothing/i, 'it does check the deny list')
  assert.match(bypass.detail, /deny/i, 'and the description has to say so')

  // It then read "Runs anything the rules have not explicitly denied", which promised too much as
  // well. Claude Code keeps ask rules in bypass mode: under `--print`, an ask rule refused the call
  // even with a PreToolUse hook answering `allow`, as this office's gate does (measured against
  // 2.1.266 on 2026-09-16).
  assert.doesNotMatch(bypass.detail, /anything the rules have not explicitly denied/i)

  // And then "Runs anything the rules neither deny nor ask about, without asking. Anything they
  // deny or ask about is refused." Still too much: even in bypass mode, Claude Code asks before
  // a few actions no rule denies, such as removing a critical path, and under `--print` asking
  // is refusing (its docs, repeated, not measured here). In review, four of seven rewordings
  // that promised something else passed a check on single words, so the sentence is pinned
  // whole.
  assert.equal(
    bypass.detail,
    'Runs without asking anything the rules neither deny nor ask about, except a few actions ' +
      'Claude Code always asks about. Everything else is refused.',
  )
})

// ─────────────────────────── rules we could not read are not rules that permit ──

/*
 * A settings file that exists and cannot be used produces zero rules — and the zero that matters
 * is `deny`.
 *
 * Everything in `triage` turns on "deny wins in every mode, including bypass", and the picker
 * puts that in front of a person in the words they choose by: *"Runs without asking anything the
 * rules neither deny nor ask about, except a few actions Claude Code always asks about.
 * Everything else is refused."*
 *
 * That sentence describes the office and Claude Code together, and it is false of this state.
 * The rules it counts on are missing — not because nothing was written but because nothing could
 * be read — and bypass would then run whatever they would have stopped, in the mode whose own
 * description is the reason somebody trusted it.
 */

const whole = (policy: Policy): PolicyRead => ({
  policy,
  sources: [{ file: 'settings.json', state: 'ok', allow: policy.allow.length, deny: policy.deny.length }],
  incomplete: false,
})

const torn = (policy: Policy): PolicyRead => ({
  policy,
  sources: [{ file: 'settings.json', state: 'unreadable', cause: 'Unexpected token }', allow: 0, deny: 0 }],
  incomplete: true,
})

test('an unreadable settings file makes bypass ask, not allow', () => {
  const nothing: Policy = { allow: [], deny: [] }

  assert.deepEqual(
    triageAgainst(request('Bash', { command: 'rm -rf /' }), torn(nothing), 'bypassPermissions'),
    { action: 'ask' },
    'the deny list it promised to honour could not be read — running anyway is the lie',
  )
})

test('and it still asks in every other mode', () => {
  const nothing: Policy = { allow: [], deny: [] }
  for (const mode of ['default', 'acceptEdits', 'plan', 'dontAsk'] as const) {
    assert.deepEqual(
      triageAgainst(request('Bash', { command: 'ls' }), torn(nothing), mode),
      { action: 'ask' },
      `${mode} decided from rules that could not be read`,
    )
  }
})

test('a torn file is not treated as an empty allow list either', () => {
  // The subtler half. `dontAsk` refuses anything unlisted, so an unreadable file would make it
  // refuse *everything* — including the commands the user had explicitly allowed. Asking is the
  // honest answer in both directions, not just the permissive one.
  const allowed: Policy = { allow: ['Bash(npm test:*)'], deny: [] }

  assert.deepEqual(triageAgainst(request('Bash', { command: 'npm test' }), torn(allowed), 'dontAsk'), {
    action: 'ask',
  })
})

test('a whole file decides exactly as it always did', () => {
  const policy: Policy = { allow: ['Bash(npm test:*)'], deny: ['Bash(rm:*)'] }

  assert.equal(triageAgainst(request('Bash', { command: 'npm test' }), whole(policy), 'default').action, 'allow')
  assert.equal(triageAgainst(request('Bash', { command: 'rm -rf x' }), whole(policy), 'bypassPermissions').action, 'deny')
  assert.equal(triageAgainst(request('Bash', { command: 'curl x' }), whole(policy), 'bypassPermissions').action, 'allow')
  assert.equal(triageAgainst(request('Bash', { command: 'curl x' }), whole(policy), 'default').action, 'ask')
})

test('a decision is written where the office will read it, whatever the renderer sends', async (t) => {
  /*
   * `main.ts` hands `decide` a `String(sessionId ?? '')` straight off the bridge, and the ids
   * become a filename. Two ways that goes wrong, and the second is the one that hid:
   *
   *   escaping   decide(root, '../../../escaped', 'x', true)
   *              →  escaped.x.verdict.json, in the workspace's parent
   *
   *   contained  decide(root, 'a/b', 'x', true), with approvals/a/ present
   *              →  approvals/a/b.x.verdict.json — inside the workspace, past a containment
   *                 check, in a subdirectory `watchApprovals` never reads. A security decision
   *                 recorded successfully and never applied, with no error anywhere.
   *
   * The second is worse: the traversal is loud and in the wrong place, this is silent and looks
   * right. It also went unmeasured at first, because the fixture never created `approvals/a/` —
   * so `writeFile` hit ENOENT, the test saw a throw either way, and mutating the guard away
   * reported a clean pass. The mutation was telling the truth about the fixture and I read it as
   * the truth about the code.
   */
  const outer = await tempDir(t, 'office-approvals-out-')
  const root = join(outer, 'workspace')
  const approvals = join(root, '.office-space', 'approvals')

  await decide(root, 'ok', 'ok', true)

  // The subdirectory exists, so a contained-but-nested write would *succeed* rather than fail on
  // a missing directory. Without this the case below cannot distinguish a guard from an ENOENT.
  await mkdir(join(approvals, 'a'), { recursive: true })

  const escapes = ['../../../escaped', '../sibling']
  const contained = ['a/b', 'a/b/c', 'a\\b']

  for (const bad of [...escapes, ...contained]) {
    await assert.rejects(
      () => decide(root, bad, 'x', true),
      // A RegExp, not a string. `assert.rejects(fn, string)` treats the string as the assertion's
      // own message and checks only *that* it rejected — so the first version of this asserted
      // nothing about why, and would have passed on an unrelated ENOENT.
      /cannot contain a slash|not addressed to this workspace/,
      `decide accepted ${JSON.stringify(bad)}`,
    )
  }
  // And in the other id, not only the first.
  await assert.rejects(() => decide(root, 'ok', 'a/b', true), /cannot contain a slash/)

  assert.deepEqual(
    (await readdir(outer)).filter((f) => f !== 'workspace'),
    [],
    'a verdict was written outside the workspace',
  )
  assert.deepEqual(await readdir(join(approvals, 'a')), [], 'a verdict was written where nothing reads it')
  assert.deepEqual(
    (await readdir(approvals)).filter((f) => f !== 'a'),
    ['ok.ok.verdict.json'],
  )
})


// ─────────────────────────────────────────── a key for every tool call ever made ──

/**
 * The set that only went up.
 *
 * `autoDecided` in `main.ts` held one `sessionId.toolUseId` string per auto-decided tool call
 * for the lifetime of the process, and nothing removed from it. It is on the hot path — every
 * call the office allows without asking passes through it — and it survived for the same reason
 * the recorder map did: `main.ts` imports `electron` at module scope, so no test could reach it.
 */

test('a request answered from policy is not answered twice', async () => {
  // What the set is for, and it must keep working. The hook deletes its request file once it
  // reads the verdict, but the poll can tick again first.
  const decided = new Decided()
  assert.equal(decided.first('s-1.t-1'), true, 'the first decision did not happen')
  assert.equal(decided.first('s-1.t-1'), false, 'the same request was decided twice')
  assert.equal(decided.first('s-1.t-2'), true, 'a different call was mistaken for the same one')
})

test('what is no longer pending is forgotten', async () => {
  const decided = new Decided()
  for (const key of ['s.1', 's.2', 's.3']) decided.first(key)
  assert.equal(decided.size, 3)

  // The hook cleaned up s.1 and s.3; only s.2 is still on disk.
  decided.keepOnly(['s.2'])
  assert.equal(decided.size, 1, 'the set kept keys for requests that are gone from disk')

  // And the ones it dropped are genuinely forgotten rather than merely uncounted.
  assert.equal(decided.first('s.1'), true)
})

test('a request still pending is still remembered', async () => {
  // The half that matters more: pruning must not forget something in flight, or the next tick
  // decides it again and the log claims a decision that was already made.
  const decided = new Decided()
  decided.first('s.1')
  decided.keepOnly(['s.1'])
  assert.equal(decided.first('s.1'), false, 'a request still on disk was forgotten and re-decided')
})

test('an empty batch forgets everything, because everything is gone', async () => {
  // The steady state of a quiet office. Nothing pending means every file was cleaned up, and a
  // set that stayed full through an idle night is the bug this replaces.
  const decided = new Decided()
  for (const key of ['a.1', 'b.2', 'c.3']) decided.first(key)
  decided.keepOnly([])
  assert.equal(decided.size, 0, 'the set survived an office with nothing pending')
})

/**
 * ## A click that says allow must not be read as a denial
 *
 * The hook polls `existsSync(verdict)` and parses whatever is there, and a verdict it cannot
 * parse is a denial. That is the right rule for a file that might be truncated \u2014 and the wrong
 * outcome to reach by racing our own write.
 *
 * Found in review by `office-space-6c`, reading the hook it has been blocked behind all day:
 * `decide` wrote in place, so the file existed before it was complete, and a poll landing in
 * that window turned somebody's *allow* into "Office Space could not read the decision, so this
 * was not approved." Small window, and the worst possible message to show a person who has just
 * approved something.
 *
 * ## What these three prove, and what they do not
 *
 * Not atomicity. That rests on `rename` within a directory being atomic, which is a POSIX
 * guarantee rather than something a test here establishes \u2014 and mutation-checking said so
 * plainly: putting the write back in place leaves these three green, because they inspect the
 * aftermath and the aftermath is identical. A race test would be flaky about a window measured
 * in microseconds, which is worse than an honest gap.
 *
 * What they hold is the part that rots quietly: no temp file left beside the verdict for the
 * hook to find and fail to parse, the content whole on the other side, and the reason surviving
 * because the model reads it too. The atomicity is carried by the comment in `decide` and by
 * `rename` being the call it is.
 */

test('a verdict is written whole, or not at all', async (t) => {
  const root = await tempDir(t, 'office-verdict-')
  await decide(root, 'sess-1', 'tool-1', true)

  const dir = join(root, '.office-space', 'approvals')
  const left = (await readdir(dir)).sort()

  assert.deepEqual(
    left,
    ['sess-1.tool-1.verdict.json'],
    `the approvals directory holds ${JSON.stringify(left)}. A temp file left behind is a file the ` +
      `hook may find and try to parse, and a verdict it cannot parse is a denial.`,
  )

  const written = JSON.parse(await readFile(join(dir, left[0]!), 'utf8')) as { allow: boolean }
  assert.equal(written.allow, true, 'the verdict did not survive the rename intact')
})

test('a refusal is written the same way, and carries its reason', async (t) => {
  const root = await tempDir(t, 'office-verdict-')
  await decide(root, 'sess-2', 'tool-2', false, 'Not this one.')

  const dir = join(root, '.office-space', 'approvals')
  assert.deepEqual(await readdir(dir), ['sess-2.tool-2.verdict.json'], 'a temp file was left beside the refusal')

  const written = JSON.parse(await readFile(join(dir, 'sess-2.tool-2.verdict.json'), 'utf8')) as {
    allow: boolean
    reason?: string
  }
  assert.equal(written.allow, false)
  assert.equal(written.reason, 'Not this one.', 'the reason did not survive — the model reads it too')
})

test('several verdicts at once each land whole', async (t) => {
  // Three different tool calls answered together. Their paths differ, so this does not exercise
  // the sequence counter — that guards the narrower case of one call answered twice, which a
  // double-click can produce and which this does not reach. Said rather than implied, because
  // the counter looks tested by this and is not.
  const root = await tempDir(t, 'office-verdict-')
  await Promise.all([
    decide(root, 's', 'a', true),
    decide(root, 's', 'b', false, 'no'),
    decide(root, 's', 'c', true),
  ])

  const dir = join(root, '.office-space', 'approvals')
  const left = (await readdir(dir)).sort()
  assert.deepEqual(
    left,
    ['s.a.verdict.json', 's.b.verdict.json', 's.c.verdict.json'],
    `three simultaneous decisions left ${JSON.stringify(left)}`,
  )

  for (const name of left) {
    const text = await readFile(join(dir, name), 'utf8')
    assert.doesNotThrow(() => JSON.parse(text) as unknown, `${name} is not whole: ${JSON.stringify(text)}`)
  }
})

/**
 * ## An expired request leaves a mark
 *
 * The gate refuses after four minutes, which is right — "an unanswered request is a denial,
 * never an allowance". What it also did was delete the request, so afterwards there was nothing:
 * a person opening the office an hour later saw no sign that a session had asked ten times,
 * waited forty minutes in total, and been refused every time.
 *
 * That is how a peer session spent an entire day blocked behind this hook without anybody
 * noticing. The only way to catch it was to be looking inside a four-minute window, and the
 * reason it was ever caught is that somebody happened to look.
 *
 * An absence nobody recorded reads exactly like nothing having happened. The fourth standing
 * order, pointed at the office's own telemetry rather than at a workspace.
 */

test('a request still waiting is not a request that expired', async (t) => {
  /*
   * The two live in different places precisely so one cannot be read as the other, and this is
   * the assertion that holds the boundary: a live request sits directly in `approvals/`, an
   * expired one under `approvals/missed/`, and `pending` and `approvalRecord` must each see only
   * their own.
   *
   * It matters in both directions. Counting a waiting request as missed reports a refusal that
   * has not happened and may never; missing a waiting one is a card that never appears, which is
   * the failure `pending`'s docblock describes costing an agent four minutes and a tool call.
   */
  const root = await tempDir(t, 'office-missed-')
  const dir = join(root, '.office-space', 'approvals')
  await mkdir(join(dir, 'missed'), { recursive: true })
  await writeFile(
    join(dir, 'live.t9.request.json'),
    JSON.stringify({ sessionId: 'live', toolUseId: 't9', tool: 'Bash', input: { command: 'ls' }, at: 1 }),
    'utf8',
  )
  await writeFile(join(dir, 'missed', '1.old.t1.request.json'), '{}', 'utf8')
  await writeFile(join(dir, 'missed', '2.old.t2.request.json'), '{}', 'utf8')

  assert.equal((await waiting(root)).length, 1, 'the live request was lost')
  const filed = await approvalRecord(root)
  assert.deepEqual(
    [...(filed.missed ?? [])].sort(),
    ['1.old.t1.request.json', '2.old.t2.request.json'],
    'the expired ones were lost, or the live one was filed among them',
  )
  assert.deepEqual(filed.decisions, [], 'a request nobody answered was counted as a decision somebody made')
})

test('the two halves of the record fail apart, and each says so on its own', async (t) => {
  /*
   * `approvalRecord` reads `decided/` and `missed/` separately, and this is the reason. They can
   * fail independently — one unreadable while the other is perfectly fine — and collapsing that
   * into a single "could not look" throws away half an answer the office actually has.
   *
   * The ENOENT line is argued in `filedIn`'s docblock and inherited here: the gate creates each
   * directory the first time it files something, so a missing one really is nothing filed. Every
   * other errno is a failure to look, and reporting that as an empty night is the fourth standing
   * order in the place it costs somebody the record of what their office did without them.
   *
   * Both directions are checked. `filedIn` takes which directory to read as a parameter, so a
   * test that only ever made `decided/` unreadable would pass on a version that special-cased
   * one name — and the half this discipline was originally written for is `missed/`.
   */
  const root = await tempDir(t, 'office-record-')
  const approvals = join(root, '.office-space', 'approvals')
  const decided = join(approvals, 'decided')
  const missed = join(approvals, 'missed')
  await mkdir(decided, { recursive: true })
  await mkdir(missed, { recursive: true })
  await writeFile(join(decided, '1.allowed.s.t.decision.json'), '{}', 'utf8')
  await writeFile(join(missed, '1.s.t.request.json'), '{}', 'utf8')

  // The control, without which every assertion below could pass on a function that always fails.
  const both = await approvalRecord(root)
  assert.deepEqual(both.decisions, ['1.allowed.s.t.decision.json'])
  assert.deepEqual(both.missed, ['1.s.t.request.json'])

  await chmod(decided, 0o000)
  try {
    const half = await approvalRecord(root)
    assert.equal(half.decisions, null, 'a directory that would not open was read as no decisions')
    assert.deepEqual(
      half.missed,
      ['1.s.t.request.json'],
      'one unreadable half took the other down with it, losing an answer the office had',
    )
  } finally {
    await chmod(decided, 0o755)
  }

  // And the other way round. A `missed/` that exists and will not open must not read as *nothing
  // was missed* — that is the fourth standing order in the one place its cost is a tool call that
  // never ran, and it is the failure the whole record exists to make visible.
  await chmod(missed, 0o000)
  try {
    const half = await approvalRecord(root)
    assert.equal(half.missed, null, 'a directory that could not be opened was read as nothing missed')
    assert.deepEqual(
      half.decisions,
      ['1.allowed.s.t.decision.json'],
      'an unreadable missed/ took the decisions down with it',
    )
  } finally {
    await chmod(missed, 0o755)
  }
})

test('a workspace that has filed nothing is genuinely empty, not unreadable', async (t) => {
  // The other side of the ENOENT line. Neither directory exists until the gate files something,
  // so their absence is a real zero — and a `null` here would put a "could not look" warning on
  // every fresh workspace, which is the way this check gets turned off.
  const root = await tempDir(t, 'office-record-')
  const fresh = await approvalRecord(root)
  assert.deepEqual(fresh, { decisions: [], missed: [] })
})

test('an approvals directory that will not open is not an office with nothing waiting', async (t) => {
  /*
   * `pending` is the only source of approval cards. A bare catch returning `[]` meant an
   * unreadable directory produced no card, an office that looked idle, and every held call
   * refused four minutes later — while the screen said nothing was waiting.
   *
   * `filedIn`, in the same file, had always got this right, and the docblock it now carries
   * describes somebody losing a day to precisely this failure.
   */
  const root = await workspace(t)
  const dir = join(root, '.office-space', 'approvals')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'x.request.json'),
    JSON.stringify({ sessionId: 's', toolUseId: 't', tool: 'Bash', input: { command: 'ls' }, cwd: root, askedAt: new Date().toISOString() }),
    'utf8',
  )
  await chmod(dir, 0o000)
  try {
    assert.equal(await pending(root), null, 'an unreadable directory read as an empty one')
  } finally {
    // Restore before the test-wide cleanup, or the temp dir cannot be removed.
    await chmod(dir, 0o755)
  }
})

test('a directory that has never been created is genuinely empty', async (t) => {
  // The other side of the same line, and it must not move: the hook makes the directory on the
  // first request, so its absence really does mean nobody has ever asked.
  assert.deepEqual(await pending(await workspace(t)), [])
})


// ────────────────────────── what the renderer is handed ──

const held = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  sessionId: 's1', toolUseId: 't1', tool: 'Bash', input: { command: 'npm test' },
  cwd: '/w', askedAt: '2026-09-06T02:00:00.000Z', waitMs: 240_000, agent: null, ...over,
})

const row = (id: string, project: string) => ({
  id, project, cwd: '/w', agent: 'manager', title: null,
  updatedAt: '2026-09-06T02:00:00.000Z', opened: true,
}) as unknown as Parameters<typeof pendingFrom>[1][number]

test('a held call carries the project it is blocking, read from the registry', async () => {
  /*
   * Tested here rather than at the call site, because the call site is `main.ts` and nothing in
   * the suite reaches it. Extracting the *lookup* alone was not enough: the line calling it stayed
   * unguarded, and `projectOfSession(...) ?? ''` passed 2583 tests green.
   *
   * This pins the record's shape. It does not pin the one line in `main.ts` that decides which
   * sessions are handed in — `pendingFrom(rs, [])` is still green — and saying so here is the
   * point, because two earlier versions of this comment said the gap was closed.
   */
  const request = held({ sessionId: 's1', toolUseId: 't-9', agent: 'tester' })
  const [forwarded] = pendingFrom([request], [row('s1', 'auth-refresh')])

  assert.equal(forwarded?.project, 'auth-refresh')

  /*
   * Every field, not the three this once asserted.
   *
   * `toolUseId: r.sessionId` — the canonical copy-paste error between two adjacent `string` id
   * fields, in a literal hand-rewritten across two commits — passed 2586 tests green. It is not
   * cosmetic: `app.ts` calls `office.decide(request.sessionId, request.toolUseId, allow)` and
   * `decide()` turns that pair into the decision **filename**. Swapped, every verdict is written
   * where the gate is not looking, and every held call is refused after four minutes.
   *
   * So the check is field-for-field against the request. Moving this mapping into a reachable
   * module made it testable; only assertions make it tested, and three of eight is not that.
   */
  assert.deepEqual(
    { ...forwarded, project: undefined },
    {
      sessionId: request.sessionId,
      toolUseId: request.toolUseId,
      tool: request.tool,
      input: request.input,
      askedAt: request.askedAt,
      waitMs: request.waitMs,
      agent: request.agent,
      project: undefined,
    },
    'a field was dropped, renamed or crossed with another on the way to the renderer',
  )
})

test('a session the registry has no row for is null, not the office', async () => {
  /*
   * The mutation that survived until this test existed. `?? ''` is `OFFICE_PROJECT`, so a plain
   * `claude` started in this workspace outside the office would have put its held calls on the
   * office's own card — a mark for work nobody did there.
   */
  const [forwarded] = pendingFrom([held({ sessionId: 'stray' })], [row('s1', 'auth-refresh')])

  assert.equal(forwarded?.project, null)
  assert.notEqual(forwarded?.project, '', 'an unplaceable call was attributed to the office')
})

test("the office's own conversations are placed as the office, not as unplaceable", async () => {
  // `OFFICE_PROJECT` is the empty string, so the two answers this function must keep apart are
  // `''` and `null` — the same distinction `waitingByProject` turns on.
  const [forwarded] = pendingFrom([held({ sessionId: 's1' })], [row('s1', '')])

  assert.equal(forwarded?.project, '')
  assert.notEqual(forwarded?.project, null)
})


// ──────────────────────────── an older list never reaches the renderer after a newer one ──

/**
 * ## Two batches can reach the renderer backwards, and nothing puts it right
 *
 * `watchApprovals` hands main a batch only when the set of ids changes. Main forwarded an empty
 * batch at once, and a non-empty one only after `await readPolicy(...)` and one `await decide(...)`
 * for each call the policy answers. So two batches in flight could arrive in the wrong order: the
 * `[H]` worked out first landed after the `[]` that replaced it.
 *
 * The renderer then shows a held call that nothing is waiting on, and keeps showing it. The
 * watcher's last key already matches the directory, so it has no change left to push.
 *
 * Found by reading, and not seen in the app. These tests hold main's `await` open on purpose, so
 * they show that the order can happen, not how often it does. The window is one policy read plus
 * the verdict writes, which is why a batch with several calls the policy answers is the likeliest
 * trigger.
 */

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll until something is true, and say what was being waited for if it never is. */
async function waitUntil(what: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (ready()) return
    await pause(5)
  }
  assert.fail(`${what} — nothing after 5s`)
}

const ids = (requests: readonly ApprovalRequest[]) => requests.map((r) => r.toolUseId)

test('a held call that went while its batch was being worked out does not come back', async (t) => {
  const root = await workspace(t)
  const started: string[][] = []
  const sent: string[][] = []

  // Main's policy read and verdict writes, held open until the test lets go.
  let finish: () => void = () => {}
  const working = new Promise<void>((resolve) => {
    finish = resolve
  })
  const route = forwardInOrder(
    async (requests) => {
      started.push(ids(requests))
      await working
      return requests
    },
    (list) => sent.push(ids(list)),
  )

  const watcher = watchApprovals(root, route, 20)
  try {
    await waitUntil('the first answer, "nothing waiting", never went out', () => sent.length === 1)
    await ask(root, { toolUseId: 'H' })
    await waitUntil('the batch holding H never started', () => started.length === 1)

    // H goes while its batch is still being worked out. The gate removes a request when it reads a
    // verdict, refuses on its timeout, or hands the call back, and the privacy panel can empty the
    // whole directory.
    await rm(join(root, DIR, 's-1.H.request.json'))
    await waitUntil('the empty batch never went out', () => sent.length === 2)

    finish()
    // Ten polls, so a watcher that could put this right has had ten chances to.
    await pause(200)
  } finally {
    watcher.close()
  }

  assert.deepEqual(await waiting(root), [], 'the premise: nothing is waiting')
  assert.deepEqual(
    sent.at(-1),
    [],
    `the renderer was last sent ${JSON.stringify(sent.at(-1))} with nothing waiting: a card ` +
      'for a call that has already gone, and no later push will take it down',
  )
})

/**
 * Batches whose answers the test hands back itself, in whatever order it likes.
 *
 * Keyed by the batch's ids joined with `|`, so `answer('a|b')` finishes the batch holding `a` and
 * `b`.
 */
function byHand() {
  const working = new Map<string, () => void>()
  const sent: string[][] = []
  const route = forwardInOrder(
    (requests) =>
      new Promise((resolve) => {
        working.set(ids(requests).join('|'), () => resolve(requests))
      }),
    (list) => sent.push(ids(list)),
  )
  const answer = async (batch: string): Promise<void> => {
    const finish = working.get(batch)
    assert.ok(finish, `no batch ${batch} is being worked out`)
    finish()
    // A macrotask, so every microtask between the answer and the forward has run.
    await pause(0)
  }
  return { route, sent, answer }
}

const batch = (...toolUseIds: string[]) => toolUseIds.map((toolUseId) => held({ toolUseId }))

test('an empty batch is not overtaken by a batch that started before it', async () => {
  const { route, sent, answer } = byHand()
  route(batch('h'))
  route(batch())
  await answer('h')

  assert.deepEqual(sent, [[]], 'the older batch landed after the empty one and put its call back')
})

test('an older answer is dropped once a newer batch has been sent', async () => {
  const { route, sent, answer } = byHand()
  route(batch('a'))
  route(batch('a', 'b'))

  await answer('a|b')
  await answer('a')

  assert.deepEqual(sent, [['a', 'b']], 'the older batch overwrote the newer one')
})

test('an older answer that arrives before the newer one is still sent', async () => {
  // Dropped only once something newer has been *sent*. Until the newer batch answers, the older
  // one is the newest list there is. If the newer batch never answers, because a verdict write
  // threw, the older one is all the renderer gets.
  const { route, sent, answer } = byHand()
  route(batch('a'))
  route(batch('a', 'b'))

  await answer('a')
  await answer('a|b')

  assert.deepEqual(sent, [['a'], ['a', 'b']])
})

test('a batch that holds the same calls as the last one sent is still sent', async () => {
  // A resend is the watcher pushing an unchanged set again, for a window that has only just
  // subscribed. It is a newer batch with an equal list, and it has to reach the renderer: the
  // order rule drops a list for being older than one already sent, never for being equal to it.
  const { route, sent, answer } = byHand()
  route(batch('a'))
  await answer('a')
  route(batch('a'))
  await answer('a')
  route(batch())
  route(batch())

  assert.deepEqual(sent, [['a'], ['a'], [], []], 'an unchanged list from a newer batch was not sent')
})

test('an empty batch is sent at once, and nothing is worked out for it', () => {
  // Nearly every batch is this one. It reads no policy and waits on nothing.
  let worked = 0
  const sent: string[][] = []
  const route = forwardInOrder(
    async (requests) => {
      worked += 1
      return requests
    },
    (list) => sent.push(ids(list)),
  )

  route([])

  assert.deepEqual(sent, [[]], 'the empty batch was not sent before route returned')
  assert.equal(worked, 0, 'an empty batch was worked out: a settings read on an idle office')
})

test('main hands held calls to the renderer through forwardInOrder, and no other way', async () => {
  /*
   * A source-level check, and it says so. `main.ts` imports electron at module scope, so no test
   * can load it; `pendingFrom` above describes the same gap. Every test above drives
   * `forwardInOrder`, and none of them would notice `main.ts` calling
   * `send(CHANNEL.approvals, ...)` directly again, which is this bug back.
   *
   * Parsed rather than grepped, so a comment that names the channel is not counted as a send.
   */
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'main.ts')
  const text = await readFile(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)

  const sends: { readonly line: number; readonly guarded: boolean }[] = []
  const visit = (node: ts.Node, guarded: boolean): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.getText(source) === 'CHANNEL' &&
      node.name.text === 'approvals'
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
      sends.push({ line: line + 1, guarded })
    }
    const inside =
      guarded || (ts.isCallExpression(node) && node.expression.getText(source) === 'forwardInOrder')
    ts.forEachChild(node, (child) => visit(child, inside))
  }
  visit(source, false)

  assert.ok(sends.length > 0, 'main.ts no longer names CHANNEL.approvals; rewrite this check')
  assert.deepEqual(
    sends.filter((s) => !s.guarded).map((s) => s.line),
    [],
    'main.ts sends held calls to the renderer outside forwardInOrder, so a batch that finishes ' +
      'late can overwrite a newer one',
  )
})
