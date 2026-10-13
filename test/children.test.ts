/**
 * Every process this app started, and making sure none outlives it.
 *
 * Before this existed, closing the window with two projects mid-turn left both `claude`
 * processes running: still talking to Anthropic, still spending the allowance, with nothing on
 * screen to show it or stop it. On a plan with no overage that is not an abstract leak — it is
 * minutes of a seven-day window going somewhere nobody can see.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { admit, liveChildren, liveCount, MAX_LIVE, stopAll, track } from '../src/main/children.js'
import { runClaude } from '../src/main/claude/run.js'
import { fakeClaude, init, result } from './fake-claude.js'

test('a tracked child is stopped, and named in what was stopped', () => {
  stopAll()
  let stopped = false
  track({ what: 'claude (abc)', stop: () => { stopped = true } })

  assert.deepEqual(liveChildren(), ['claude (abc)'])
  assert.deepEqual(stopAll(), ['claude (abc)'])
  assert.equal(stopped, true)
  assert.equal(liveCount(), 0)
})

test('untracking removes it, so quit does not signal something long gone', () => {
  stopAll()
  const untrack = track({ what: 'gone', stop: () => assert.fail('stopped a child that had exited') })
  untrack()

  assert.deepEqual(stopAll(), [])
})

test('one child refusing to stop does not spare the others', () => {
  // Quitting halfway through the list is how one stuck process keeps four others alive.
  stopAll()
  const stopped: string[] = []
  track({ what: 'stubborn', stop: () => { throw new Error('will not') } })
  track({ what: 'polite', stop: () => stopped.push('polite') })

  stopAll()
  assert.deepEqual(stopped, ['polite'], 'a throwing child prevented the next one being asked')
  assert.equal(liveCount(), 0, 'the registry kept an entry for a child it had already asked')
})

test('a real run is tracked while it runs and untracked when it ends', async (t) => {
  // The end-to-end version. `session.ts` registers the handle and clears it in `finally` — not
  // on the success path, because a run that threw is still a run that is over, and its entry
  // would otherwise have quit trying to kill something that exited minutes ago.
  stopAll()
  const fake = await fakeClaude(t, { lines: [init('s'), result(false)] })

  const run = runClaude({ cwd: fake.dir, prompt: 'hi', claudePath: fake.path }, () => {})
  const untrack = track({ what: 'claude (test)', stop: () => run.kill() })
  assert.equal(liveCount(), 1)

  await run.done
  untrack()
  assert.equal(liveCount(), 0)
})

test('kill stops a run that is still going', async (t) => {
  // The polite path waits three seconds per child. Quit has neither the time nor anywhere left
  // to render a graceful shutdown into.
  const fake = await fakeClaude(t, { lines: [init('s')], stdout: '' })
  const run = runClaude({ cwd: fake.dir, prompt: 'hi', claudePath: fake.path }, () => {})

  run.kill()
  const summary = await run.done
  // No result event arrived, so the run reports itself as failed rather than as a clean exit —
  // which is right: it did not finish, it was stopped.
  assert.equal(summary.isError, true)
})

/*
 * Being on the list and holding a seat are two different questions.
 *
 * They agreed for as long as `session.ts` was the only caller, and the moment asides and the
 * voice digest were registered — so that quit could stop them, which it previously could not —
 * they stopped agreeing. `admit` refused on `live.size`, and `track` grew `live`, so twelve
 * background asides refused the user's own conversation and the refusal called them
 * "conversations already mid-answer". Measured before the fix: twelve tracked asides, `admit`
 * returning `ok: false`, and the reason naming `aside (0), aside (1)…`.
 *
 * The office would have become unusable while saying something untrue about why, which is the
 * third standing order failing on the way out of a fix for something else.
 */
test('a background child is stopped at quit but does not refuse anybody a turn', () => {
  stopAll()
  for (let i = 0; i < MAX_LIVE; i++) track({ what: `aside (${i})`, stop: () => {} })

  assert.equal(liveCount(), MAX_LIVE, 'they are on the list, which is what quit reads')

  const seat = admit({ what: 'a real conversation', stop: () => {} })
  assert.equal(seat.ok, true, 'background work refused a turn — the cap counts turns, not everything running')
  stopAll()
})

test('a refusal names the turns that filled the cap, not the background work beside them', () => {
  stopAll()
  track({ what: 'voice digest', stop: () => {} })
  for (let i = 0; i < MAX_LIVE; i++) admit({ what: `claude (turn-${i})`, stop: () => {} })

  const refused = admit({ what: 'one too many', stop: () => {} })
  assert.equal(refused.ok, false, 'the cap did not hold once background work was on the list')
  const reason = refused.ok ? '' : refused.reason
  assert.match(reason, /turn-0/, 'the refusal does not name what is holding the seats')
  assert.doesNotMatch(
    reason,
    /voice digest/,
    'the refusal names background work as a conversation mid-answer. The person reading it is ' +
      'trying to work out which turn to stop, and this sends them after something that is not one.',
  )
  stopAll()
})

test('everything registered is still stopped, whichever kind it is', () => {
  stopAll()
  const stopped: string[] = []
  track({ what: 'aside (abc)', stop: () => stopped.push('aside (abc)') })
  admit({ what: 'claude (def)', stop: () => stopped.push('claude (def)') })

  assert.deepEqual([...stopAll()].sort(), ['aside (abc)', 'claude (def)'])
  assert.deepEqual(
    stopped.sort(),
    ['aside (abc)', 'claude (def)'],
    'a child on the list was not actually asked to stop, which is the whole point of the list',
  )
})
