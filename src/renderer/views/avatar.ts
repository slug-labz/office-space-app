/**
 * An agent's face, outside the floor.
 *
 * F5 asks for characters *legible as this agent*, and F1c for the transcript to use *"the same
 * procedural character that is on the floor as the avatar"*. Both are the same requirement said
 * twice: **one identity system, two views.** The person at the third desk and the person who
 * just spoke in the conversation have to be recognisably one employee, or the floor is a
 * decoration beside the real interface rather than a window onto it.
 *
 * So this draws from `office.sprites()` — the same call, the same bitmaps, the same theme — and
 * never from a second source of pictures. If somebody installs a sprite pack, the avatars change
 * with the floor because there is nothing else for them to change with.
 *
 * ## Why a canvas rather than an <img>
 *
 * The art is 8-bit pixel work at around 16×24. Scaling that up with the default smoothing turns
 * a face into a smudge, and `image-rendering: pixelated` is the CSS that fixes it — but it is
 * unevenly honoured, and an `<img>` needs a data URL, which means an encode per agent per size.
 * A canvas with `imageSmoothingEnabled = false` is exact everywhere, costs one blit, and is the
 * same drawing call the floor already makes.
 */

import type { SpriteSheet } from '../../shared/ipc.js'
import { lookKey } from '../../shared/character/recipe.js'
import { toBitmaps } from '../sprites.js'

/** The front-facing standing frame, per agent. Decoded once and shared by every avatar of them. */
const faces = new Map<string, Promise<ImageBitmap | null>>()

/** What the cache was filled from. A theme change invalidates every face at once. */
let cachedTheme = ''

export interface AvatarSource {
  readonly sprites: (agent: string) => Promise<SpriteSheet>
  /** The current sprite theme's id. When it changes, cached faces are the old art. */
  readonly themeId: () => string
  /**
   * Who the manager is, by agent id.
   *
   * The transcript knows the manager by their *display name* — "Manager", or whatever their file
   * calls them — and the art is keyed by id. Asking here rather than passing the id through
   * three call sites keeps the transcript's one idea of a speaker intact.
   */
  readonly manager: () => string
  /**
   * An agent's description, or empty when they are not on the roster.
   *
   * The art depends on it — `recipeFor` folds it in — so the cache has to as well. Supplied by
   * the caller rather than fetched, because `app.ts` already holds the snapshot and a second
   * lookup here would be a second idea of who is on staff.
   */
  readonly describe?: (agent: string) => string
}

/**
 * Drop every cached face.
 *
 * Called on a theme change, and it has to be: the cache is keyed by agent because the same
 * person works in every project, but it is only valid for the theme it was drawn from. Without
 * this, changing themes leaves everybody in the old art and only somebody newly hired looks
 * right — the exact bug `floor-view.ts` records against its own art cache.
 */
export function forgetFaces(): void {
  for (const pending of faces.values()) void pending.then((bitmap) => bitmap?.close())
  faces.clear()
}

function faceOf(agent: string, source: AvatarSource): Promise<ImageBitmap | null> {
  const theme = source.themeId()
  if (theme !== cachedTheme) {
    forgetFaces()
    cachedTheme = theme
  }

  // **Keyed by what the art depends on, not by who it is of.**
  //
  // Keyed by agent, this cache was correct for exactly as long as a character was a function of
  // their id. L2-33 folded the description in, and neither this nor the floor's art cache knew
  // — so rewriting an agent's role changed their recipe and changed nothing on screen until a
  // restart. A third `forgetFaces()` call site would have papered over it and left the next
  // input to do the same thing again.
  const key = lookKey(agent, source.describe?.(agent) ?? '')

  const already = faces.get(key)
  if (already) return already

  const pending = source
    .sprites(agent)
    .then(toBitmaps)
    // Frame 0 of `down` is the standing pose facing the viewer — the one that reads as a
    // portrait rather than as somebody caught mid-stride.
    .then((art) => art.down[0] ?? null)
    .catch(() => null)

  faces.set(key, pending)
  return pending
}

/**
 * An element showing this agent, at `size` CSS pixels square.
 *
 * Returns immediately with the element and fills it when the art arrives, because the caller is
 * building a row in a list and must not wait on a decode to lay it out. Until then it shows the
 * initial — which is also what it shows if the art never arrives, so an avatar is never a blank
 * hole where a person should be.
 */
export function avatar(agent: string, size: number, source: AvatarSource): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'avatar'
  wrap.style.width = `${size}px`
  wrap.style.height = `${size}px`
  // Decorative here: every use of this sits beside the agent's name in text, and a screen
  // reader announcing "reviewer, image, reviewer" is worse than announcing it once.
  wrap.setAttribute('aria-hidden', 'true')

  const initial = document.createElement('span')
  initial.className = 'avatar__initial'
  initial.textContent = (agent[0] ?? '?').toUpperCase()
  wrap.appendChild(initial)

  void faceOf(agent, source).then((face) => {
    if (!face) return

    const canvas = document.createElement('canvas')
    // Backed at the device's resolution so the pixels stay square on a retina screen; the CSS
    // size is what the layout sees.
    const scale = Math.max(1, Math.round(window.devicePixelRatio || 1))
    canvas.width = size * scale
    canvas.height = size * scale
    canvas.className = 'avatar__art'

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false

    // Fit the frame inside the square without stretching it: character art is taller than it is
    // wide, and a squashed face is less recognisable than a smaller one.
    const fit = Math.min(canvas.width / face.width, canvas.height / face.height)
    const w = Math.max(1, Math.floor(face.width * fit))
    const h = Math.max(1, Math.floor(face.height * fit))
    ctx.drawImage(face, Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), w, h)

    wrap.replaceChildren(canvas)
  })

  return wrap
}
