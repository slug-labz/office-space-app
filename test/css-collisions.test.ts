/**
 * One component, one block.
 *
 * `styles.css` is fifteen hundred lines with two authors, and the failure it invites is not a
 * syntax error — it is a second block for a selector that already had one. The later block
 * wins on source order, nothing warns, and the earlier design is silently replaced by whatever
 * the newer rule happened to set.
 *
 * That shipped. F2's control layer wrote a second `.pill` — "pills are labels, not controls" —
 * and Wave C later rebuilt the status bar around `.pill` having a card background. F2's block
 * sat further down the file, so every pill went transparent, the plain and quiet variants
 * became **pixel-identical**, and the distinction the row was rebuilt to draw stopped existing.
 * Found by reading computed styles in the running app, which is the only place the two blocks
 * can be seen to disagree.
 *
 * So: a bare single-class selector may open at most one top-level block. Variants belong on the
 * one block as attribute or pseudo-class selectors — `.pill[data-tone="quiet"]`, `.pill:hover` —
 * which is the model Wave A settled for buttons and the reason this rule is cheap to keep.
 *
 * ## What this file used to miss, and why it was widened
 *
 * Four instances of the same fault turned up in these two files in one day. The original check
 * caught **one** of them — the `.pill` case above, which is the one it was written for — and it
 * could not have caught the other three, for three separate structural reasons:
 *
 * | found | why it was invisible |
 * |---|---|
 * | three control systems in `styles.css`, each introduced by a comment claiming to unify the controls | they opened with **selector lists** (`.control, .voice, .ghost, #send {`), and the rule head pattern required a class followed immediately by `{` |
 * | `.pane` declared in `styles.css` **and** `panels.css`, the later winning silently | the test looped **per file**, so a component split across the pair was two singletons |
 * | a second `:root` deriving a radius scale whose `sm` was the 3px the other declared outright | `:root` is not a class |
 *
 * The third one is the one that cost time: correcting `.pane`'s grid in `styles.css` changed
 * **nothing on screen**, because a four-track template a thousand lines away in the other file
 * was still in force. The header measured 77px and reported a `bottom` of −279.
 *
 * All three gaps are closed below. Multiple `:root` blocks stay legal — grouping tokens by what
 * they are for is reasonable — but **declaring the same custom property in two of them is not**,
 * which is the narrow thing that actually went wrong.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Strip comments and the contents of at-rules, so a media override is not read as a redefinition. */
function topLevel(css: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // Drop `@media`/`@supports` blocks wholesale: redefining a token or a rule inside one is the
  // entire point of them, and counting those as collisions would make the rule unusable.
  return withoutComments.replace(/@(?:media|supports|container)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
}

const SHEETS = ['src/renderer/styles.css', 'src/renderer/panels.css'] as const

/** Every `.ts` under `src/`, so a token set from script is found wherever somebody puts it. */
function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) sources(path, acc)
    else if (entry.name.endsWith('.ts')) acc.push(path)
  }
  return acc
}
const read = (file: string): string => topLevel(readFileSync(join(root, file), 'utf8'))

/**
 * Every top-level rule as (selector parts, body), with at-rules already dropped.
 *
 * No `(^|\})` anchor, and that is not a simplification — the first version had one and it made
 * this helper see **every other rule**. A global match that consumes a rule's closing brace
 * leaves the next rule with no brace to anchor on, so rules 1, 3 and 5 matched and 2, 4 and 6
 * were invisible. It found the duplicate `:root` token and silently missed a `.pane` block that
 * had been appended two lines away, which is how it was caught: by breaking the thing on purpose
 * and getting only half the failure back.
 *
 * At-rules are already stripped, so at this point every `{ … }` *is* a top-level rule and no
 * anchor is needed.
 */
function rules(css: string): readonly { parts: readonly string[]; body: string; at: number }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    parts: m[1]!.split(',').map((x) => x.trim()).filter((x) => x !== ''),
    body: m[2]!,
    at: m.index ?? 0,
  }))
}

/** A selector that is exactly one class and nothing else — the case where a second block is a
 *  redefinition rather than a variant. */
const bareClass = (selector: string): string | null =>
  /^\.[a-zA-Z][\w-]*$/.test(selector) ? selector : null

/** The properties a block sets, longhand names as written. */
const propertiesOf = (body: string): readonly string[] =>
  [...body.matchAll(/(^|;)\s*([a-zA-Z-]+)\s*:/g)].map((m) => m[2]!.trim())

/**
 * How far apart two blocks may be and still count as one design.
 *
 * A base block and the variant right under it are a pattern this codebase uses on purpose —
 * `.voice` taking the control core's geometry, then a quiet block three lines down replacing its
 * background. A reader sees both at once and neither is a surprise.
 *
 * The failure this file exists for is the opposite: *"the later block wins on source order and
 * the earlier design is silently replaced"*. That only misleads when you cannot see both, and
 * every one of the four real instances was exactly that — `.pill` and `.pane` a thousand-odd
 * lines apart or in different files, never adjacent. So distance is the discriminator, and it is
 * measured rather than guessed: forty lines is more than any base-and-variant pair in these two
 * files and an order of magnitude below any of the four.
 *
 * It was forty first, and forty flagged a base block and its variant sixty lines apart — a pair
 * that reads perfectly well and is the pattern this codebase uses on purpose. Raising it is not
 * fitting the rule to the data: the four instances it exists to catch were **eight hundred to a
 * thousand lines apart, or in different files**, so eighty still leaves a full order of magnitude
 * of margin. What would be fitting the rule to the data is raising it again the next time it
 * fires. If that happens, move the blocks together instead.
 */
const NEARBY_LINES = 80

test('no single-class selector sets the same property from two distant blocks', () => {
  // **The same property**, not merely the same selector, and **across both files**, not per file.
  //
  // Both of those were learned the hard way. `.pane` was declared once in each file and the pair
  // loads in order, so the second silently governed while two per-file checks each saw a
  // singleton — correcting the template in the first file changed nothing on screen.
  const seen = new Map<string, { file: string; line: number; property: string }[]>()
  for (const file of SHEETS) {
    const css = read(file)
    for (const rule of rules(css)) {
      const line = css.slice(0, rule.at).split('\n').length
      for (const part of rule.parts) {
        const selector = bareClass(part)
        if (selector === null) continue
        for (const property of propertiesOf(rule.body)) {
          seen.set(selector, [...(seen.get(selector) ?? []), { file, line, property }])
        }
      }
    }
  }

  const clashes: string[] = []
  for (const [selector, entries] of seen) {
    const properties = new Set(entries.map((e) => e.property))
    for (const property of properties) {
      const hits = entries.filter((e) => e.property === property)
      for (let i = 0; i < hits.length; i++) {
        for (let j = i + 1; j < hits.length; j++) {
          const a = hits[i]!
          const b = hits[j]!
          const adjacent = a.file === b.file && Math.abs(a.line - b.line) <= NEARBY_LINES
          if (adjacent) continue
          clashes.push(
            a.file === b.file
              ? `${selector} { ${property} } at ${a.file}:${a.line} and :${b.line}`
              : `${selector} { ${property} } in ${a.file} and ${b.file}`,
          )
        }
      }
    }
  }

  assert.deepEqual(
    clashes.sort(),
    [],
    `set from two blocks too far apart to be read together, so the later value silently wins ` +
      `while the earlier block still appears to state it:\n${clashes.join('\n')}`,
  )
})

test('every var(--token) resolves to a property something actually declares', () => {
  // A `var()` naming a token nobody declared is not an error anywhere: the declaration is simply
  // dropped, the element keeps whatever it inherited, and the page looks *almost* right. Same
  // family as everything else in this file — a rule that is present, plausible, and inert.
  //
  // This was written the moment it caught something. `.work--trace` was added with
  // `margin-top: var(--gap-2)`, borrowing a spacing scale from a design system this sheet does
  // not have — the neighbourhood uses literal rem. The suite stayed green, and the only reason
  // it did not ship is that somebody went looking for the token by hand.
  //
  // Declarations are read from the RAW sheet rather than `topLevel`, because a token declared
  // only inside `@media (prefers-color-scheme: dark)` is genuinely declared; stripping at-rules
  // first would report every one of those as missing.
  const declared = new Set<string>()
  for (const file of SHEETS) {
    const raw = readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of raw.matchAll(/(--[a-zA-Z][\w-]*)\s*:/g)) declared.add(m[1]!)
  }

  // A custom property set from script is declared too — `mic.ts` drives `--level` on the button
  // to animate the input meter. Scanned rather than listed, so the next one does not need a
  // change here to stay true.
  for (const file of sources('src')) {
    const code = readFileSync(join(root, file), 'utf8')
    for (const m of code.matchAll(/setProperty\(\s*['"`](--[a-zA-Z][\w-]*)/g)) declared.add(m[1]!)
  }

  assert.ok(declared.size > 40, `parsed only ${declared.size} tokens — the sheet shape moved`)

  const dangling = new Set<string>()
  for (const file of SHEETS) {
    const raw = readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // `var(--x, fallback)` is allowed to name something undeclared — the author wrote what
    // happens when it is missing, which is the whole point of the second argument.
    for (const m of raw.matchAll(/var\(\s*(--[a-zA-Z][\w-]*)\s*\)/g)) {
      if (!declared.has(m[1]!)) dangling.add(m[1]!)
    }
  }

  assert.deepEqual(
    [...dangling].sort(),
    [],
    'referenced by var() and declared nowhere, so the declaration is dropped in silence — ' +
      'either declare the token or write the literal the neighbourhood uses',
  )
})

test('no custom property is declared by two top-level :root blocks', () => {
  // Several `:root` blocks are fine — grouping tokens by what they are for is reasonable, and
  // this repo does it deliberately for the static palette mirror. Declaring the same property in
  // two of them is not: `--radius` was set to the same value in both files by two people who
  // each believed they owned it, and the derived scale beside it reached `--radius-control`'s
  // 3px by arithmetic rather than by decision.
  const where = new Map<string, string[]>()
  for (const file of SHEETS) {
    for (const rule of rules(read(file))) {
      if (!rule.parts.includes(':root')) continue
      for (const m of rule.body.matchAll(/(--[a-zA-Z][\w-]*)\s*:/g)) {
        where.set(m[1]!, [...(where.get(m[1]!) ?? []), file])
      }
    }
  }

  const twice = [...where]
    .filter(([, files]) => files.length > 1)
    .map(([token, files]) => `${token} (${files.length}×: ${[...new Set(files)].join(', ')})`)

  assert.deepEqual(
    twice,
    [],
    `declared in more than one :root, so the later one wins and nothing warns: ${twice.join(', ')}`,
  )
})

test('every class the code applies has a rule, or a stated reason not to', () => {
  // The `var(--gap-2)` fault one level up.
  //
  // `el('section', 'strip__zone strip__zone--attention')` compiles, renders, and shows nothing
  // different — a modifier with no rule is not an error anywhere. That one was applied by
  // `needsYou` and `neverReported`, the two zones on the strip that are *waiting on a person*, so
  // a tool call held at the gate and a dispatch that never came back looked exactly like the
  // zones that need nobody.
  //
  // Nothing checked this. `turn__command` had been applied once, styled never and queried never,
  // for as long as it had existed.
  const sheets = SHEETS.map((f) => readFileSync(join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n')
  const defined = new Set([...sheets.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]!))

  const applied = new Map<string, string>()
  const record = (cls: string, where: string) => {
    if (/^[a-z]/.test(cls) && !applied.has(cls)) applied.set(cls, where)
  }

  const walk = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : [],
    )

  for (const file of walk('src/renderer')) {
    const code = readFileSync(join(root, file), 'utf8')
    // Only literal class strings. A template literal is built at runtime and cannot be checked
    // here, which is a limit of this test rather than a licence to write them.
    /*
     * `[^,\n]` and not `[^,]`, which is the difference between reading one call and reading three
     * lines of unrelated code.
     *
     * The class group used to be `el\([^,]+,` — and `[^,]` matches newlines, so `onlyPanel(` at
     * the top of a function could run on until the next comma anywhere below it and swallow the
     * first string it found. `loading(body, 'Reading what each dispatch changed…')` three lines
     * down was read as four class names: `what`, `each`, `dispatch`, `changed…`.
     *
     * Every existing caller escaped it by luck. `showRoster` has the same shape and passes only
     * because a *comment* between the two lines contains a comma, which stops the run early. An
     * audit that depends on the punctuation of a nearby comment is one that fails on the next
     * function somebody writes — which is how this was found.
     *
     * An `el('tag', 'class')` call is one line. Saying so costs a character.
     */
    for (const m of code.matchAll(/(?:className\s*=\s*|classList\.(?:add|remove|toggle)\(|el\([^,\n]+,\s*)['"`]([^'"`$]+)['"`]/g)) {
      for (const cls of m[1]!.split(/\s+/).filter(Boolean)) record(cls, file)
    }
  }
  for (const m of readFileSync(join(root, 'src/renderer/index.html'), 'utf8').matchAll(/class="([^"]+)"/g)) {
    for (const cls of m[1]!.split(/\s+/).filter(Boolean)) record(cls, 'index.html')
  }

  assert.ok(applied.size > 200, `parsed only ${applied.size} class names — the walk moved`)

  // Structural hooks: applied to be *found*, not to be painted. Each is listed with the selector
  // that queries it, so the exception has to be earned rather than assumed.
  const HOOKS: Readonly<Record<string, string>> = {
    // `views/music.ts` queries `.music__search .music__input` to put focus back after a re-render.
    music__search: 'src/renderer/views/music.ts',
  }

  const unstyled = [...applied]
    .filter(([cls]) => !defined.has(cls) && !(cls in HOOKS))
    .map(([cls, where]) => `${cls} (${where.replace('src/renderer/', '')})`)

  assert.deepEqual(
    unstyled,
    [],
    'applied by the code and styled by neither sheet — add the rule, or add it to HOOKS with the selector that needs it',
  )
})

