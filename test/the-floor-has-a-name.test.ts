/**
 * The thing this product is named after must say what it is.
 *
 * The office floor is a `<canvas>`, and a canvas is opaque: there is no markup inside it to
 * describe, no text to read, nothing an assistive technology can infer. It shipped bare —
 * measured over CDP against the real accessibility tree:
 *
 *     #floor-canvas   ignored=false   role=Canvas   name=""
 *
 * `ignored=false` is the part that matters. It was **in** the tree and announced, as an unnamed
 * graphic, in the middle of an app whose entire subject it is.
 *
 * ## Why `role="img"` and not something interactive
 *
 * Clicking a desk asks that person a question, so the canvas is not decorative and it is not
 * inert either. But there is no keyboard route to that gesture, so calling it a button would
 * promise an interaction that does not exist for anybody relying on one. `img` is the honest
 * account of what this offers here, and the label names the route that is real: the roster holds
 * the same people, the same states and the same actions, as text.
 *
 * ## The avatars are the opposite case, and were already right
 *
 * `views/avatar.ts` sets `aria-hidden` on every portrait, because each one sits directly beside
 * the name it draws. A picture announced next to the name it depicts is noise. That is checked
 * here too, because it is the sort of thing a later "let's label all the canvases" sweep undoes
 * while believing it is making things better — which is exactly what I nearly did: my own sweep
 * listed twelve unnamed `canvas.avatar__art` elements as findings, and reading the tree showed
 * every one already ignored, deliberately, by an author who had thought about it.
 *
 * ## Receipt and check
 *
 * Whether any of this is *useful* to somebody using a screen reader is not decidable here. The
 * CDP readings are receipts. What this checks is that the label exists and that the deliberate
 * hiding stays deliberate — the two things a later edit removes without noticing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(root, 'src', 'renderer', 'index.html'), 'utf8')
const avatar = readFileSync(join(root, 'src', 'renderer', 'views', 'avatar.ts'), 'utf8')

test('the floor canvas says what it is', () => {
  const tag = /<canvas[^>]*\bid="floor-canvas"[^>]*>/s.exec(html)?.[0]
  assert.ok(tag, '#floor-canvas is gone from index.html, or is no longer a <canvas>')

  const role = /\brole="([^"]*)"/.exec(tag)?.[1]
  assert.equal(
    role,
    'img',
    'the floor canvas has no role="img". Bare, it sits in the accessibility tree as an unnamed ' +
      '`Canvas` — measured: ignored=false, role=Canvas, name="" — which is an announced graphic ' +
      'that says nothing, in the middle of the app it is the subject of.',
  )

  const label = /\baria-label="([^"]*)"/.exec(tag)?.[1] ?? ''
  assert.ok(
    label.length > 30,
    `the floor canvas's aria-label is ${JSON.stringify(label)}. A canvas has nothing inside it to ` +
      `describe, so this string is the only account of it anybody gets who cannot see it.`,
  )
  // It must point at the route that actually works, because the click gesture does not have one.
  assert.match(
    label,
    /roster/i,
    'the label must name where the same information exists as text. Clicking a desk has no ' +
      'keyboard equivalent; the roster does, with the same people and the same actions.',
  )
})

test('the avatars stay deliberately hidden', () => {
  assert.match(
    avatar,
    /setAttribute\('aria-hidden',\s*'true'\)/,
    'views/avatar.ts no longer hides the portrait it draws. Each one sits beside the name it ' +
      'depicts, so announcing it repeats the name as an unnamed graphic. Twelve of them appear ' +
      'in the roster at once.',
  )
})
