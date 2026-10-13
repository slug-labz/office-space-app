/**
 * The portrait cache, and the two bugs it has already been on the wrong side of.
 *
 * `avatar()` draws a character's standing frame beside their name. Nothing was aimed at it.
 *
 * ## Keyed by what the art depends on, not by who it is of
 *
 * The cache was keyed by agent id, which was correct for exactly as long as a character was a
 * function of their id. Then descriptions started folding into the recipe, and neither this
 * cache nor the floor's knew — so rewriting an agent's role changed their art and **changed
 * nothing on screen until a restart**. The comment is blunt about the fix that was not taken:
 * *"A third `forgetFaces()` call site would have papered over it and left the next input to do
 * the same thing again."*
 *
 * ## And the theme, which is the same bug from the other side
 *
 * A cached face is the old art the moment the sprite theme changes. Without the theme check,
 * switching themes leaves everybody in yesterday's clothes and only somebody newly hired looks
 * right — the exact fault `floor-view.ts` records against its own art cache.
 *
 * ## How this is checked without a canvas
 *
 * By counting how often the source is asked for sprites. A cache hit is a call that does not
 * happen, and that is the whole of both invariants — no bitmap, no context, no drawing. The art
 * never arrives here on purpose: `sprites()` rejects, which exercises the other thing worth
 * having, that a face which never loads leaves the initial rather than a blank hole where a
 * person should be.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { avatar, forgetFaces, type AvatarSource } from '../src/renderer/views/avatar.js'

installDom()

interface Rig {
  readonly source: AvatarSource
  /** Every agent the source was asked to fetch art for, in order. */
  readonly asked: string[]
  readonly setTheme: (id: string) => void
  readonly setDescription: (agent: string, text: string) => void
}

function rig(): Rig {
  const asked: string[] = []
  const descriptions = new Map<string, string>()
  let theme = 'default'

  return {
    asked,
    setTheme: (id) => {
      theme = id
    },
    setDescription: (agent, text) => descriptions.set(agent, text),
    source: {
      sprites: (agent) => {
        asked.push(agent)
        // No art in this harness, deliberately. `avatar()` catches it and keeps the initial,
        // which is the fallback this test also cares about.
        return Promise.reject(new Error('no sprite sheet here'))
      },
      themeId: () => theme,
      manager: () => 'Manager',
      describe: (agent) => descriptions.get(agent) ?? '',
    },
  }
}

/** Let the rejected sprite promise and its `catch` settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

test('an avatar is never a blank hole where a person should be', async () => {
  forgetFaces()
  const r = rig()

  const el = avatar('reviewer', 28, r.source) as unknown as El
  // Immediately, before any art could have arrived.
  assert.equal(el.textContent, 'R', 'the element did not come back with the initial in it')

  await settle()
  assert.equal(
    el.textContent,
    'R',
    'the art never arrived and the initial was removed anyway, leaving an empty square where a ' +
      'person should be',
  )
})

test('a portrait is hidden from a screen reader, because the name is right beside it', async () => {
  forgetFaces()
  const r = rig()
  const el = avatar('reviewer', 28, r.source) as unknown as El
  assert.equal(
    el.getAttribute('aria-hidden'),
    'true',
    'announcing "reviewer, image, reviewer" is worse than announcing it once',
  )
  await settle()
})

test('the same person is fetched once, however many avatars of them are drawn', async () => {
  forgetFaces()
  const r = rig()

  avatar('reviewer', 28, r.source)
  avatar('reviewer', 16, r.source)
  avatar('reviewer', 40, r.source)
  await settle()

  assert.deepEqual(
    r.asked,
    ['reviewer'],
    'the same face was fetched once per avatar — a roster of twelve would decode twelve copies ' +
      'of every character',
  )
})

test('rewriting an agent description re-fetches, because it changes the art', async () => {
  // The recorded bug. Keyed by id alone, this returns the cached face and the change appears
  // nowhere until a restart.
  forgetFaces()
  const r = rig()
  r.setDescription('reviewer', 'reads diffs')

  avatar('reviewer', 28, r.source)
  await settle()
  assert.deepEqual(r.asked, ['reviewer'])

  r.setDescription('reviewer', 'now runs the release')
  avatar('reviewer', 28, r.source)
  await settle()

  assert.deepEqual(
    r.asked,
    ['reviewer', 'reviewer'],
    'the description changed and the cache handed back the old face. The recipe folds the ' +
      'description in, so this is a different character — and the screen would go on showing the ' +
      'previous one until the app restarted.',
  )
})

test('a theme change drops every cached face at once', async () => {
  forgetFaces()
  const r = rig()

  avatar('reviewer', 28, r.source)
  avatar('builder', 28, r.source)
  await settle()
  assert.deepEqual(r.asked, ['reviewer', 'builder'])

  r.setTheme('a-different-sprite-theme')
  avatar('reviewer', 28, r.source)
  await settle()

  assert.deepEqual(
    r.asked,
    ['reviewer', 'builder', 'reviewer'],
    'the theme changed and a cached face was reused. Everybody stays in yesterday\'s art and ' +
      'only somebody newly hired looks right, which is exactly the fault floor-view.ts records ' +
      'against its own cache.',
  )
})

test('forgetFaces empties the cache rather than marking it stale', async () => {
  forgetFaces()
  const r = rig()

  avatar('reviewer', 28, r.source)
  await settle()
  assert.deepEqual(r.asked, ['reviewer'])

  forgetFaces()
  avatar('reviewer', 28, r.source)
  await settle()
  assert.deepEqual(r.asked, ['reviewer', 'reviewer'], 'forgetFaces() left the face reachable')
})
