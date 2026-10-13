/**
 * Which conversation a request is for.
 *
 * These tests exist because of a bug nobody could have caught by reading the renderer: the
 * transcript was addressed by session, and sending was addressed by project. Both halves were
 * individually correct. The gap was in the *signature* — the renderer had no way to say which
 * conversation it meant, so main resolved one for it, and the two agreed only while a project
 * had exactly one conversation.
 *
 * Reported from the running app: typing into one project's chat and watching the reply arrive
 * in a different project.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { route, sessionOf } from '../src/main/routing.js'

test('a named conversation is used', () => {
  assert.deepEqual(route('sess-a', 'sess-a'), { kind: 'named', session: 'sess-a' })
})

test('THE FIX: a named conversation wins even when it disagrees with the project', () => {
  // The whole point. `current` is main's own idea of which conversation this project is
  // showing; `named` is what the renderer has already rendered the user's words into. When they
  // disagree, the renderer is right — it is the one holding the transcript.
  //
  // Preferring `current` here is not a lesser choice, it is the original bug: the words appear
  // in one conversation and the run happens in another.
  const r = route('sess-b', 'sess-a')
  assert.deepEqual(r, { kind: 'named', session: 'sess-b' })
  assert.equal(sessionOf(r), 'sess-b', 'the project\'s current session was substituted for the named one')
})

test('naming nothing falls back to what the project is showing', () => {
  // A real case rather than a leftover: a caller with genuinely no opinion should behave
  // exactly as it did before.
  assert.deepEqual(route(null, 'sess-a'), { kind: 'current', session: 'sess-a' })
})

test('nobody with an opinion means resume or start', () => {
  assert.deepEqual(route(null, undefined), { kind: 'resume-or-start' })
  assert.equal(sessionOf({ kind: 'resume-or-start' }), null)
})

test('a named conversation is used even when the project has none', () => {
  // Opening an old conversation from the strip in a project nothing is running in. Falling back
  // to resume-or-start here would start a *new* conversation and then fill it with the old
  // one's transcript — which is the leak, in its most confusing form.
  assert.deepEqual(route('sess-old', undefined), { kind: 'named', session: 'sess-old' })
})

test('two conversations in one project never resolve to each other', () => {
  // The invariant, stated as the property rather than as a case. A project is a group of
  // sessions; addressing one must never reach another, whatever the project happens to be
  // showing at the time.
  const ids = ['sess-a', 'sess-b', 'sess-c']
  for (const named of ids) {
    for (const current of [...ids, undefined]) {
      assert.equal(
        sessionOf(route(named, current)),
        named,
        `addressing ${named} while the project showed ${current} resolved elsewhere`,
      )
    }
  }
})
