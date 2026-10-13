/**
 * The cap on simultaneous `claude` processes, and the four answers a session gives about itself.
 *
 * `session.test.ts` drives conversations. What it never reaches is the refusal at the top of
 * `send`, which is the only thing standing between a loop and twelve Node processes:
 *
 *     Asked **before** spawning, not after. The cap exists because each of these is a real Node
 *     process, so a check that runs once the process is already up has counted it and not
 *     prevented it. Nothing below this line happens if the answer is no.
 *
 * "Nothing below this line" is the whole claim and it is not observable from the transcript —
 * a session that spawned and then failed and a session that never spawned both end up idle with
 * an error on them. The difference is a process, and the only way to tell is to ask whether the
 * binary was run.
 *
 * And it refuses rather than queues, which `children.ts` argues for at length:
 *
 *     A queue would make the office silently slow instead of silently over-subscribed, which is
 *     the same failure wearing a better hat — the person is still not told, and now they are
 *     waiting for something with no stated end.
 *
 * ## The four getters, each of which is a bug that was fixed
 *
 * They look like boilerplate. Their comments say otherwise: `agent` exists because "a brand-new
 * conversation with the tester reported as the manager's — the lookup fell through to the
 * default on the one turn where being wrong is most visible", and `project` because without it
 * "`bypassPermissions` and `dontAsk` were inert, because the gate could not tell which
 * conversation a parked command had come from". A getter that starts returning the wrong thing
 * breaks a permission mode silently.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ManagerSession } from '../src/main/session.js'
import { MAX_LIVE, admit, liveCount } from '../src/main/children.js'
import type { SessionState, StaffMember } from '../src/shared/ipc.js'
import { assistantText, fakeClaude, init, result } from './fake-claude.js'

const staff: StaffMember[] = [
  { id: 'manager', name: 'manager', description: 'Runs the floor.', tools: ['Read', 'Task'], model: 'opus', isManager: true },
]

function session(over: { claudePath: string; cwd: string; agent?: string; project?: string; projectId?: string }) {
  const states: SessionState[] = []
  const manager = new ManagerSession({
    cwd: over.cwd,
    agent: over.agent ?? 'manager',
    staff: () => staff,
    projectBlock: () => over.project ?? '## CURRENT PROJECT\n\nNone.',
    project: over.projectId ?? 'the-office',
    controls: () => ({ model: null, thinking: null, permission: null }) as never,
    claudePath: over.claudePath,
    onEvent: () => {},
    onState: (s) => states.push(s),
  })
  return { manager, states }
}

/** Fill the cap with children that are not real processes, and hand back the way out. */
function fillTheCap(): () => void {
  const releases: (() => void)[] = []
  while (liveCount() < MAX_LIVE) {
    const seat = admit({ what: `stand-in ${liveCount()}`, stop: () => {} })
    if (!seat.ok) break
    releases.push(seat.release)
  }
  return () => {
    for (const release of releases) release()
  }
}

test('a turn refused by the cap starts no process at all', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('ok'), result(false)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  const empty = fillTheCap()
  try {
    // The control: the cap must actually be full, or this asserts about an ordinary turn.
    assert.equal(liveCount(), MAX_LIVE, `only ${liveCount()} of ${MAX_LIVE} seats are taken`)

    await manager.send('do the thing')

    let ran = true
    try {
      await fake.argv()
    } catch {
      ran = false
    }
    assert.equal(
      ran,
      false,
      'the binary was spawned and then refused. The cap exists because each of these is a real ' +
        'Node process, so a check that runs once the process is up has counted it and not ' +
        'prevented it.',
    )
  } finally {
    empty()
  }
})

test('the refusal names what is running, and is not a code or a silence', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('ok'), result(false)] })
  const { manager, states } = session({ claudePath: fake.path, cwd: fake.dir })

  const empty = fillTheCap()
  try {
    await manager.send('do the thing')

    const said = states.at(-1)?.error ?? ''
    assert.match(said, new RegExp(String(MAX_LIVE)), `the refusal does not say what the limit is: ${JSON.stringify(said)}`)
    assert.match(
      said,
      /stand-in/,
      '"too many" is not something anybody can act on. The list of what is running is what tells ' +
        'somebody which conversation to stop, or that something is looping.',
    )
    assert.match(said, /Nothing was started/i, 'the refusal does not say whether the work happened')
  } finally {
    empty()
  }
})

test('a refused message is dropped, not queued behind the cap', async (t) => {
  // "A queue behind a cap is the same over-subscription with a longer wait and no explanation."
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('ok'), result(false)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  const empty = fillTheCap()
  await manager.send('the refused one')
  empty()

  await manager.send('the one I actually sent')

  const argv = await fake.argv()
  const prompt = argv.at(-1) ?? ''
  assert.match(prompt, /the one I actually sent$/, 'the wrong message was sent once a seat freed up')
  assert.equal(
    /the refused one/.test(prompt),
    false,
    'the refused message was held and sent later. Somebody was told nothing happened and then ' +
      'it happened anyway, which is worse than either answer on its own.',
  )
})

test('the session says which agent answers, before it has ever run', () => {
  // "A brand-new conversation with the tester reported as the manager's — the lookup fell
  // through to the default on the one turn where being wrong is most visible."
  const { manager } = session({ claudePath: '/nonexistent', cwd: '/tmp', agent: 'tester' })
  assert.equal(manager.agent, 'tester')
})

test('the session says which project it belongs to, as a key the gate can look up', () => {
  // This getter exists for exactly one caller. `main.ts`:
  //
  //     function modeOf(sessionId: string): PermissionMode {
  //       const session = managers.get(sessionId)
  //       if (!session) return 'default'
  //       return controlsFor(session.project).permissionMode
  //     }
  //
  // and `controlsFor` is `controls.get(project)`, a map keyed by project id — set from the
  // renderer's `setControls(project, ...)`. So whatever this returns has to *be* that id.
  //
  // The session is constructed the way `main.ts` constructs it, which is the whole point: a
  // fixture passing a bare id here would agree with the getter and disagree with the app.
  const { manager } = session({
    claudePath: '/nonexistent',
    cwd: '/tmp',
    projectId: 'payment-page',
    project: '## CURRENT PROJECT\n\npayment-page — a checkout page.\n',
  })

  assert.equal(
    manager.project,
    'payment-page',
    'the session reports the block of prose the manager is told about the project, where the ' +
      'gate expects the project id. `controls.get()` never matches a markdown document, so the ' +
      'lookup falls through to the defaults every time and the permission mode somebody chose ' +
      'is never the one applied.',
  )
})

test('a conversation with nothing said in it has no title and no last prompt', async (t) => {
  // "Inventing a title from nothing would be worse than having none."
  const fake = await fakeClaude(t, { lines: [init('s'), assistantText('ok'), result(false)] })
  const { manager } = session({ claudePath: fake.path, cwd: fake.dir })

  assert.equal(manager.title, null, 'a conversation nobody has spoken in already has a name')
  assert.equal(manager.lastPrompt, null, 'a conversation that has sent nothing reports a last prompt')

  await manager.send('the first thing I said')
  assert.equal(manager.title, 'the first thing I said', 'the title is not the first thing said')

  // `lastPrompt` is the **assembled** prompt, not the line that was typed, and deliberately:
  // "the largest thing Office Space sends is not a destination — it is the prompt it assembles
  // itself: `withOfficeContext` prepends blocks to every message and the user has never seen
  // them ... it is what makes 'you can see exactly what leaves this machine' a property rather
  // than a promise." Asserting the raw message here would be asking for the privacy panel to
  // show less than what left.
  const first = manager.lastPrompt ?? ''
  assert.match(first, /the first thing I said/, 'what was sent does not contain what was typed')
  assert.match(
    first,
    /CURRENT PROJECT|CURRENT STAFF/,
    'the prompt held for the privacy panel is only the typed line, so the blocks this app ' +
      'prepends — which the user has never seen — are exactly the part it cannot show them',
  )

  await manager.send('the second thing')
  assert.equal(manager.title, 'the first thing I said', 'the title moved to the newest message')
  assert.match(manager.lastPrompt ?? '', /the second thing/, 'the last prompt did not follow the conversation')
  assert.equal(
    /the first thing I said/.test(manager.lastPrompt ?? ''),
    false,
    'the last prompt still holds the previous turn',
  )
})
