/**
 * An exported type nothing refers to.
 *
 * This repository has spent a lot of effort on the other kind of orphan — a module with no
 * caller, a channel used on one side, a field measured and dropped — and had nothing at all for
 * the simplest one: a type declared, exported, and pointed at by nothing.
 *
 * ## Why this one gets to be a test
 *
 * Most of that family cannot be checked soundly. `scripts/unread-fields.mjs` audits properties
 * and deliberately stays a script, because main takes payloads off the bridge as
 * `Record<string, unknown>` and reads them by key, which the checker cannot follow — so it
 * over-reports and a green assertion would be unreachable.
 *
 * A *type reference* has no such ambiguity. It resolves to exactly one declaration and the
 * checker will say which, so "nothing points at this" is a fact rather than an estimate. That is
 * the whole difference, and it is why the number below is asserted rather than eyeballed.
 *
 * ## What it caught
 *
 * `ThemeSelection` — `{ active, available, problems }` — referenced by nothing. Not built, not
 * imported, in no signature. Its docstring made a real promise:
 *
 *     Themes that were installed but failed to load. Non-empty means the UI must say so. Someone
 *     who paid for art and dropped it in deserves an error, not a silent downgrade.
 *
 * The promise is kept, by a different path: `ThemeRegistry.problems` collects the failures and
 * `main.ts` folds them into the snapshot the diagnosis panel reads. **A dead type carrying a live
 * promise is the most expensive kind of dead code** — it reads like the thing that keeps the
 * promise, so the next person wires it up instead of the one that already works.
 *
 * ## It typechecks `scratch/` as a side effect, and that is worth having
 *
 * The program it builds spans `src`, `test` and `scratch`, and it refuses to answer if any of
 * them has an unresolved diagnostic. `scratch/` is in **neither** tsconfig — ten files that
 * import from `src` and were checked by nothing — so a refactor could leave `check-capabilities`
 * or `check-floorplan` uncompilable and nobody would learn until they next reached for one.
 *
 * Now `npm test` says so. Verified rather than assumed: a deliberate type error in
 * `scratch/check-floorplan.ts` fails this test, naming the file and the line.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

// @ts-expect-error — a plain .mjs script, deliberately outside the TS program it inspects.
import { unusedTypes, unresolved } from '../scripts/unused-types.mjs'

test('every exported type under src/ is referenced by something', () => {
  const { dead, checked, walked, expected } = unusedTypes() as {
    dead: readonly { name: string; where: string; line: number }[]
    checked: number
    walked: number
    expected: number
  }

  // If this collapses, the program stopped resolving and the answer above is not "all of them
  // are used" but "I could not tell" — the two are indistinguishable from a passing test, which
  // is the failure this repository has paid for more than once.
  assert.ok(checked > 200, `only ${checked} exported types found — the program or the walk moved`)

  // And the sharper half of the same question. The threshold above was written against a walk
  // that reached *nothing*, and it would wave through one that reached most things: 200 of 800
  // is a 75% collapse that still passes. The anchored walk fails partially rather than totally —
  // a root one level off still matches some files — so the guard that fits it is an identity
  // rather than a floor. Every source file handed to the program is one the walk reached, and
  // this needs no recalibrating the next time `src/` grows.
  assert.equal(
    walked,
    expected,
    `the walk reached ${walked} of ${expected} files under src/ — it is resolving somewhere else`,
  )

  assert.deepEqual(
    dead.map((r) => `${r.where}:${r.line} ${r.name}`),
    [],
    'exported and pointed at by nothing — delete it, or wire the thing it promises',
  )
})

// ───────────────────────────────────────────── the guard on the guard ──

/**
 * A diagnostic shaped the way `ts.getPreEmitDiagnostics` returns them.
 *
 * Faithful in four ways an earlier version was not, each of which let a real mutation through:
 *
 * - **the position is honoured.** It used to ignore its argument and hand back a fixed line, so
 *   replacing `getLineAndCharacterOfPosition(d.start ?? 0)` with `(0)` — every diagnostic
 *   reported at line 1, silently — passed. Ten characters per line here, so `start` maps to a
 *   line the assertions can name.
 * - **`messageText` can chain.** Real ones do: three of seven harvested from a genuinely broken
 *   program were objects with a `next`, not strings. `flattenDiagnosticMessageText` ignores its
 *   separator entirely on a plain string, so the string-only fake never exercised it.
 * - **a message can be long enough to truncate.** Real chained ones measured 188 and 250
 *   characters against the 110-char cut; the old fake's were 49, so the cut never fired.
 * - **the path is under the real root**, so `shown()` has something to strip. Against a path
 *   outside it, dropping `shown()` altogether changed nothing.
 *
 * The stronger design is to build a tiny broken program in a temp directory and assert on what
 * is thrown — no export needed, and it would pin all four by construction. Not done here because
 * this file already builds the real program once and that run is the slowest test in the suite.
 */
const diagnostic = (
  file: string,
  start: number,
  messageText: string | { messageText: string; category: number; code: number; next?: unknown[] },
) => ({
  // Ten characters to the line, so `start` and the reported line are tied together and a lookup
  // that discards its argument cannot produce the same answer.
  file: { fileName: file, getLineAndCharacterOfPosition: (pos: number) => ({ line: Math.floor(pos / 10), character: 0 }) },
  start,
  messageText,
})

/** Under the repo root, so `shown()` has a prefix to strip. */
const inRepo = (rel: string) => join(process.cwd(), rel)

test('a program that did not resolve says so, naming the files', () => {
  /*
   * This branch had no test, and held a bug for as long as that was true. It declared a
   * `const shown` that shadowed the module's own `shown()` and called it **inside its own
   * initialiser** — a temporal dead zone — so every real diagnostic came out as
   * `ReferenceError: Cannot access 'shown' before initialization` rather than the report.
   *
   * The guard on the guard failed in the one way its own comment rules out. *"A check that goes
   * wrong loudly is worth ten that go quiet"* is right, and this went wrong loudly about the
   * wrong thing: anybody who hit it debugged the script instead of reading the type error it was
   * trying to hand them. Reproduced before the fix by putting `const x: number = 'not a number'`
   * in `src/`.
   */
  const said = unresolved([
    diagnostic(inRepo('src/shared/truncate.ts'), 610, "Type 'string' is not assignable to type 'number'."),
  ]) as string

  assert.match(said, /1 unresolved diagnostic/)
  assert.match(said, /truncate\.ts:62/, 'the line is 0-based in the diagnostic and 1-based for a person')
  assert.match(said, /not assignable/, 'the diagnostic itself was dropped, leaving only a count')
  assert.doesNotMatch(said, /ReferenceError/)

  // The path is shortened relative to the checkout. Without `shown()` this prints an absolute
  // path that differs on every machine — and dropping it changed nothing the old fake could see.
  assert.match(said, /^ {2}src\/shared\/truncate\.ts:62/m, 'the path was not made relative to the checkout')
  assert.doesNotMatch(said, new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('a chained diagnostic is flattened onto one line, and a long one is cut', () => {
  /*
   * Both halves are about real diagnostics rather than the tidy ones a fake produces. Harvested
   * from a genuinely broken program: three of seven `messageText` values were chained objects,
   * and flattened lengths reached 188 and 250 characters against a 110-char cut.
   *
   * `flattenDiagnosticMessageText` ignores its separator on a plain string, so a string-only
   * fixture left both the separator and the truncation unexercised — changing `' '` to a newline,
   * or deleting `.slice(0, 110)` outright, passed.
   */
  const tail = 'TAIL_THAT_MUST_BE_CUT'
  const long = 'Type A is not assignable to type B. '.repeat(4) + tail
  const said = unresolved([
    diagnostic(inRepo('src/a.ts'), 0, {
      messageText: long,
      category: 1,
      code: 2345,
      next: [{ messageText: 'Types of property x are incompatible.', category: 1, code: 2326 }],
    }),
  ]) as string

  assert.ok(!said.includes(tail), 'a 250-character diagnostic was printed whole, so one error can be a wall')
  assert.equal(said.split('\n').length, 2, 'one diagnostic did not produce one line under the heading')

  /*
   * The separator needs its own case, and the first version of this test did not give it one.
   * Chained here but **short**, because the 110-character cut lands before the join in a long
   * message — so a long chained fixture exercises the truncation and leaves the separator
   * untouched. Measured: with both in one case, changing `' '` to a newline still passed.
   */
  const short = unresolved([
    diagnostic(inRepo('src/b.ts'), 0, {
      messageText: 'Outer.',
      category: 1,
      code: 2345,
      next: [{ messageText: 'Inner.', category: 1, code: 2326 }],
    }),
  ]) as string

  // `\s+` rather than a single space: measured, `flattenDiagnosticMessageText` writes the
  // separator *and* two spaces of indentation, so `' '` produces `"Outer.   Inner."`. Asserting
  // one space failed on the correct code, which is a fixture testing its author's guess.
  assert.match(short, /Outer\.\s+Inner\./, 'a chained message was not flattened onto one line')
  assert.equal(short.split('\n').length, 2, 'a chained diagnostic spilled onto a second line')
})

test('the count is all of them and the list is capped, so a hundred broken files say one thing', () => {
  // Two different numbers on purpose. Printing a hundred lines to report one fact is the wall
  // `refusals.ts` exists to prevent; printing "8" as the count would understate the damage.
  const many = Array.from({ length: 30 }, (_, i) => diagnostic(inRepo(`src/a${i}.ts`), i * 10, 'broken'))
  const said = unresolved(many) as string

  assert.match(said, /30 unresolved diagnostic/, 'the count was capped along with the list')
  assert.equal((said.match(/src\/a\d+\.ts/g) ?? []).length, 8, 'the list is not capped at eight')
})
