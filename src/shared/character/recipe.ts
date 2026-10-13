/**
 * Character recipes.
 *
 * An employee's appearance is a pure function of their name. Drop `wren-review.md` into
 * `.claude/agents/` and that reviewer gets a face — the same face on every machine, forever, with
 * nobody drawing anything. That is what makes the office scale: the art is derived, not
 * authored.
 *
 * The palettes here are **curated, not enumerated**, and that distinction is the whole
 * difference between a cast that looks designed and one that looks randomised. An early
 * prototype fed raw variant ranges into a hash and produced a room full of people in heavy
 * sunglasses pulling faces. Every value below was picked to sit beside every other value.
 */

export interface RGB {
  readonly r: number
  readonly g: number
  readonly b: number
}

const rgb = (hex: number): RGB => ({
  r: (hex >> 16) & 0xff,
  g: (hex >> 8) & 0xff,
  b: hex & 0xff,
})

// ──────────────────────────────────────────────────────────────── palettes ───

/** Skin. A real range, evenly spaced in lightness so no tone reads as "the default". */
const SKIN = [
  rgb(0xf3d9c0),
  rgb(0xe8c39d),
  rgb(0xd9a87c),
  rgb(0xc0885d),
  rgb(0xa06a42),
  rgb(0x7d4f30),
  rgb(0x5c3a24),
  rgb(0x422a1a),
] as const

/** Hair. Naturals, then greys, then three dyed shades to break up a crowded floor. */
const HAIR = [
  rgb(0x1b1512),
  rgb(0x2e2019),
  rgb(0x4a3323),
  rgb(0x7a5334),
  rgb(0xb08b52),
  rgb(0xd8bd85),
  rgb(0x8f8f97),
  rgb(0xc9c6c0),
  rgb(0xa8412c),
  rgb(0x3a5f8a),
  rgb(0x6d4a7e),
  rgb(0x2f6b5a),
] as const

/**
 * Shirts. Muted and considered rather than saturated — an office of twenty people in primary
 * colours reads as a toy. These are all roughly equal in value, so no one employee shouts.
 */
const SHIRT = [
  rgb(0x46647f),
  rgb(0x76866a),
  rgb(0xb0644a),
  rgb(0x5a586d),
  rgb(0xcfc3a2),
  rgb(0x3d5a50),
  rgb(0x87596a),
  rgb(0x2e3944),
  rgb(0xbe9c48),
  rgb(0x8a8f96),
  rgb(0x4a4f7a),
  rgb(0xa8503f),
] as const

/**
 * Trousers. Mid-tone rather than black.
 *
 * The first pass used near-black trousers on the reasoning that legs should recede. On a dark
 * floor they disappeared entirely and the cast looked like floating torsos — legs need to hold
 * their own value against *both* a light and a dark ground, since the office has both.
 */
const TROUSERS = [
  rgb(0x3d434e),
  rgb(0x4a5364),
  rgb(0x5b5445),
  rgb(0x6a7079),
  rgb(0x3a4c60),
  rgb(0x554a58),
] as const

/** Shoes. Clearly darker than every trouser tone, so the ankle break is always visible. */
const SHOES = [rgb(0x1e2024), rgb(0x2f231b), rgb(0x2a2a30)] as const

/** The outline. Never pure black — a hair of blue keeps it from punching a hole in the floor. */
export const OUTLINE: RGB = rgb(0x14161a)

export type HairStyle = 'crop' | 'short' | 'bob' | 'long' | 'bun' | 'bald'
export type Accessory = 'none' | 'glasses' | 'tie' | 'headphones' | 'lanyard'

const HAIR_STYLES: readonly HairStyle[] = ['crop', 'short', 'bob', 'long', 'bun', 'bald']

/**
 * Accessory weighting. `none` appears four times because a floor where everyone wears
 * something looks costumed; most people should just be people.
 */
const ACCESSORIES: readonly Accessory[] = [
  'none',
  'none',
  'none',
  'none',
  'glasses',
  'glasses',
  'tie',
  'headphones',
  'lanyard',
]

// ─────────────────────────────────────────────────────────────────── recipe ───

export interface Recipe {
  /** The name this was derived from. Kept so a rendered character can be traced back. */
  readonly source: string
  readonly skin: RGB
  readonly hair: RGB
  readonly hairStyle: HairStyle
  readonly shirt: RGB
  readonly trousers: RGB
  readonly shoes: RGB
  readonly accessory: Accessory
  /** Slight build variation, so a row of employees is not a row of identical silhouettes. */
  readonly slim: boolean
}

/**
 * FNV-1a, 32-bit.
 *
 * Chosen over a cryptographic hash for one reason that matters here: it is tiny, synchronous,
 * and identical in Node and the browser with no dependency and no async. We are picking hair
 * colours, not signing anything.
 */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Independent draws from one hash.
 *
 * Slicing bit ranges out of a single 32-bit value correlates the choices — with only 32 bits
 * and eight decisions, characters start sharing traits in visible clusters. Re-hashing the
 * name with a per-field salt keeps every decision independent, which is what makes a room of
 * twenty look like twenty people.
 */
function pick<T>(name: string, field: string, pool: readonly T[]): T {
  const index = hash(`${name}:${field}`) % pool.length
  return pool[index]!
}

/**
 * Everything a character's art depends on, as one string.
 *
 * **This is a cache key, and it exists because two caches were keyed by the wrong thing.** Both
 * the floor's art and the transcript's faces were keyed by agent id and cleared only on a theme
 * change — which was right while a look was a function of the id alone. Folding the description
 * in made that untrue and neither cache knew, so an agent whose role was rewritten kept their
 * old character until a restart. Laptop 1 caught it: *"the fix is not a third forget call — it
 * is keying the caches by what the art actually depends on."*
 *
 * So the rule is here rather than in either cache: **anything that changes a character changes
 * this string.** Add an input to `recipeFor` and add it here, and both caches follow without
 * being told.
 *
 * The theme is the caller's to add — it decides whether art is painted from this recipe at all,
 * and a sheet-backed theme ignores the recipe entirely.
 */
export function lookKey(name: string, description = ''): string {
  return `${name.trim().toLowerCase()}\u0000${description.trim().toLowerCase()}`
}

/**
 * Build a character recipe. Same inputs in, same character out, on every machine, always.
 *
 * ## L2-33, and the half of it I am not building
 *
 * The item asks to *"make them legible as **this** agent"* — the recipe hashes a name, and it
 * should also read the agent's own file, *"a reviewer holding something, a tester with a
 * different posture. Deterministic, and drawn from the workspace rather than invented."*
 *
 * The second sentence rules out the first. Matching *reviewer* in a description and handing that
 * character a clipboard is **invented meaning**: nothing in the workspace says a reviewer holds
 * anything, the office would be asserting a mapping it made up, and — worse — a viewer who
 * noticed the clipboard could not decode it. A difference nobody can read is decoration
 * pretending to be information, which is the one thing the props file already refuses to draw.
 *
 * So: the **description is folded into the hash** and nothing is derived from its contents. What
 * that buys is real and is what the item is actually for. Two agents whose names are close no
 * longer look close, because their jobs differ. Rewriting an agent's role changes their
 * appearance, so the floor reflects the workspace rather than a name that has stopped being
 * accurate. And it costs nothing: the description is already on `StaffMember`.
 *
 * `description` is optional because a hand-written agent file may not have one, and an agent
 * with no description must still get a character rather than a blank.
 */
export function recipeFor(name: string, description = ''): Recipe {
  // Both, joined by something that cannot appear in either, so ("ab", "c") and ("a", "bc") are
  // different people. Trimmed and lowercased for the same reason the name always was: whitespace
  // and capitalisation in a file are not identity, and a character that changes when somebody
  // fixes an indent would be the floor reporting an event that did not happen.
  const key = lookKey(name, description)

  return {
    source: name,
    skin: pick(key, 'skin', SKIN),
    hair: pick(key, 'hair', HAIR),
    hairStyle: pick(key, 'hairStyle', HAIR_STYLES),
    shirt: pick(key, 'shirt', SHIRT),
    trousers: pick(key, 'trousers', TROUSERS),
    shoes: pick(key, 'shoes', SHOES),
    accessory: pick(key, 'accessory', ACCESSORIES),
    slim: hash(`${key}:build`) % 2 === 0,
  }
}

// `PALETTES` was here, "exposed for the character studio's legend". There is no studio, and
// nothing under `scratch/` reads it either — which is where a tool like that would live.
