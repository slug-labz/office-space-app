/**
 * Which modules no test aims at — **declared, so it is a decision rather than a discovery.**
 *
 * This exists because "we decided not to test that" and "we never got to it" look identical six
 * months later, and only one of them is honest. Every module below is listed with what is true
 * about it, and the list is checked both ways: a new untested module fails this, and so does a
 * stale line for a module that has since been covered.
 *
 * ## What this measures, and what it does not
 *
 * **Aimed at** means a test file value-imports the module. That is a different question from
 * whether the module *executes* — many of these run transitively when a test imports something
 * that imports them, and `node --experimental-test-coverage` scores several at 100% for exactly
 * that reason. Transitive execution is not coverage of intent: nothing asserts anything about
 * what these modules do, and a change to one of them can only fail a test that was aiming
 * somewhere else.
 *
 * Both numbers are worth having and neither substitutes for the other.
 *
 * ## What the measurement actually found
 *
 * The assumption going in — mine and the other session's — was that the renderer is untested
 * because it needs a DOM and `main.ts` because it needs Electron. **That is wrong**, and it was
 * wrong in the direction that flatters us. Importing all 25 in a plain `node` process:
 *
 *     23 LOAD    including every renderer view and floor-view.ts
 *      2 BLOCKED spotify/connect.ts and spotify/store.ts, both on `import { app } from 'electron'`
 *
 * There is no structural barrier. `test/dom.ts` already provides `installDom()`, and three test
 * files already use it. The renderer views are untested because nothing has aimed at them, not
 * because nothing could.
 *
 * The real reason is narrower and worth writing down: **every instrument this audit built
 * operates on return values.** Mutation testing needs a value to change; set comparison needs
 * predicates over inputs; accept/refuse corpora need a verdict. A view function returns an
 * element tree and its output is judged by looking at it. So the search kept selecting problems
 * the tools could reach, and the shape of what was left over is the shape of the tools.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The most modules that may sit here at once. **This is the check that has teeth.**
 *
 * The reasons below are documentation and nothing more. A test that demanded a *good* reason
 * would be satisfied by "TODO: needs a harness" in its first week and would then read as
 * enforcement for years — which is strictly worse than no check, and this repository has been
 * caught by that shape three times already: a scanner satisfied by a comment naming the symbol
 * it was hunting, a `/boss/` guard matched by the line "rename boss to manager", a substring
 * filter matched by a quotation of the claim it was checking.
 *
 * So the budget is the enforcement. Adding a module here costs either removing another or
 * raising this number, and raising it is one character that shows up in a diff with a name
 * against it. Parking is still possible; it is no longer free, which is the only property that
 * has ever reduced parking.
 *
 * ## What this does not do, stated rather than implied
 *
 * A budget measures how much is parked. It does not measure whether the tests that let a module
 * off this list assert anything — a one-line import with no assertion removes an entry as
 * effectively as real coverage. That hole cannot be closed by making the rule stricter, because
 * every stricter rule is satisfiable by the same kind of gesture, one language further down.
 *
 * The honest description: this bounds the debt and makes it visible. It does not price it.
 *
 * ## It goes down, and it has
 *
 * 25 when this was written; 23 now.
 *
 * `spotify/client.ts` came off when the PR adding 225 lines of tests for it landed — the module
 * holding the OAuth token refresh and every Spotify request. **The stale-line half of this check
 * is what noticed**, by turning `dev` red on the merge rather than by anybody remembering the
 * comment that predicted it.
 *
 * `views/activity.ts` and `views/roster.ts` came off deliberately — between them every click in
 * this app that has a consequence: granting a tool call permission to run, and deleting an
 * agent's file. Nothing was stopping either from being tested; both load in plain `node`, and
 * `installDom()` had been sitting in `test/dom.ts` the whole time.
 *
 * `views/privacy.ts` came off on a different criterion: it is the one whose failure would be
 * **invisible**. Every other view fails visibly — a button does nothing, a list looks wrong. That
 * one states facts about somebody's disk and about what leaves their machine, and there is no
 * second source to check it against.
 *
 * `views/hire.ts` came off on a third criterion: it is the one place a *renderer* and a *writer*
 * both decide the same question. `agent-id.ts` exists so there is one definition of what a name
 * is, and its docstring says why — "the copy in the renderer would drift from the copy that
 * actually writes the file". One definition is the right way to keep that promise; nothing was
 * checking that it stays kept, so the test asks both layers the same corpus and requires the same
 * answers.
 *
 * Writing the roster one found a gap in the harness rather than in the app: `classList` had `add`
 * and `contains` and no `remove`, so the first test to reach a button that removes a class threw.
 * Throwing is the good outcome — the same file's `childElementCount` comment records the bad one,
 * where a missing property is *read* and answers wrongly instead of failing.
 *
 * Lowering the ceiling with the entry is the whole point of a ratchet: leaving it at 25 would
 * bank a free parking space for the next person, which is the thing this is supposed to cost.
 */
const MAX_UNTESTED = 0

/**
 * Modules with runtime exports that no test file imports, and what is true about each.
 *
 * Delete a line when you add a test. Adding one means raising {@link MAX_UNTESTED}.
 */
const NO_TEST_AIMS_AT: Record<string, string> = {
  // The floor's renderer half. The shared half beneath it is the best-covered subsystem in the
  // repo — 267 tests across choreography, projection, pathfinding, walker, routine, bubbles,
  // seats, campus, frame-gate — and this is the part that turns those decisions into pixels.

  // Views. All load in plain node; `installDom()` in test/dom.ts is what three other test files
  // already use to drive this kind of module.

  // `spotify/store.ts` still imports electron at module scope, so nothing can load it — but there
  // is nothing left in it to load. Every decision it used to hold has been lifted out and tested:
  // the master network switch into `network-switch.ts`, and what counts as a stored credential
  // into `token-file.ts`. What remains is where the file is and which keychain to use, which are
  // the two things that genuinely need Electron.
  //
  // So the BLOCKED category is empty. It held three modules: `connect.ts` came off when its
  // electron import turned out to exist for nothing but a default argument, and the other two by
  // moving the decision to where a test can reach it. Not one of the three was blocked by
  // anything about what it did.

  // A dev tool, and the one module here that nothing imports at runtime either — the app hands
  // its pixel buffers to `createImageBitmap` instead. Used only by the contact-sheet CLI.

  // Both execute at 100% through `main/roster.ts`, which is well covered. Nothing asserts about
  // them directly, so a change here can only fail a test aiming somewhere else.
}

async function tsFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(join(repo, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await tsFiles(path)))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

/**
 * Every module a test file value-imports. `import type` is erased and does not count.
 *
 * **Both spellings of import.** The first version matched only the static form, and so measured
 * "statically imports" while its own comment claimed "value-imports" — a scanner answering a
 * narrower question than the one it is asked, which is the failure this file's header is about.
 *
 * It went unnoticed because nothing needed the dynamic form until `spotify/store.ts`. That module
 * imports `electron` at module scope, so a static import of it is hoisted above the resolver hook
 * that makes it loadable and throws before any test runs; it has to be `await import(...)`. The
 * census then reported it untested while a file full of assertions about it sat next to the
 * report.
 *
 * The query string goes too. `import('./store.js?fresh=/tmp/x')` is a cache-buster, not a
 * different module.
 */
async function aimedAt(): Promise<Set<string>> {
  const found = new Set<string>()
  const add = (file: string, spec: string): void => {
    const withoutQuery = spec.split('?')[0] ?? spec
    found.add(relative(repo, resolve(repo, dirname(file), withoutQuery)).replace(/\.js$/, '.ts'))
  }

  for (const file of (await tsFiles('test')).filter((f) => f.endsWith('.test.ts'))) {
    const text = await readFile(join(repo, file), 'utf8')
    for (const match of text.matchAll(/^import\s+(?!type\b)[\s\S]*?from\s+'(\.[^']+)'/gm)) {
      if (match[1] !== undefined) add(file, match[1])
    }
    // `await import('./x.js')`, and the same without the await. Deliberately not `import type`,
    // which cannot appear in this form anyway.
    for (const match of text.matchAll(/\bimport\s*\(\s*[`'](\.[^`']+)[`']\s*\)/g)) {
      if (match[1] !== undefined) add(file, match[1])
    }
    // The template-literal form, where a cache-buster is interpolated: import(`./x.js?k=${v}`).
    for (const match of text.matchAll(/\bimport\s*\(\s*`(\.[^`$]+)\$\{/g)) {
      if (match[1] !== undefined) add(file, match[1])
    }
  }
  return found
}

test('every module with runtime exports is either aimed at by a test or declared here', async () => {
  const aimed = await aimedAt()

  // The instrument first. A scanner that resolves nothing would report every module as untested,
  // and the list would then be "correct" for entirely the wrong reason.
  assert.ok(
    aimed.size > 50,
    `the import scanner resolved ${aimed.size} modules, so it is broken rather than the tests being absent`,
  )
  assert.ok(aimed.has('src/main/privacy.ts'), 'the scanner cannot see a module it certainly should')

  const untested: string[] = []
  for (const file of await tsFiles('src')) {
    const text = await readFile(join(repo, file), 'utf8')
    if (!/^export (async )?(function|class|const|let|enum) /m.test(text)) continue
    if (!aimed.has(file)) untested.push(file)
  }

  const declared = Object.keys(NO_TEST_AIMS_AT).sort()
  const actual = untested.sort()

  const undeclared = actual.filter((f) => !declared.includes(f))
  assert.deepEqual(
    undeclared,
    [],
    'a module with runtime exports has no test aiming at it and is not declared in ' +
      'NO_TEST_AIMS_AT. Either write the test, or add it to that list with a real reason.',
  )

  const stale = declared.filter((f) => !actual.includes(f))
  assert.deepEqual(
    stale,
    [],
    'these are declared as untested but a test now imports them — delete the lines, so the list ' +
      'keeps meaning what it says',
  )

  // The ratchet. Only ever down without a deliberate, visible edit.
  assert.ok(
    declared.length <= MAX_UNTESTED,
    `${declared.length} modules parked, and the budget is ${MAX_UNTESTED}. Write the test, or ` +
      `take one off the list, or raise MAX_UNTESTED and put your name on it.`,
  )
})

// ────────────────────────────────────── the modules the census could not see ────

/**
 * How many modules with **no exports at all** may sit untested.
 *
 * A separate budget from {@link MAX_UNTESTED}, and separate on purpose. That one is at zero and
 * should stay visibly at zero; folding these in would move it to eight and lose the fact that
 * every library module in this repo is aimed at.
 *
 * They are a real category all the same, and `ade-af` found out how real by testing one of them:
 * `src/main/cli/eval.ts` is 179 lines, exports nothing, and was invisible to the census — while
 * containing a check that ran **downstream of the decision it should have made**, so the harness
 * printed `!! ghost is not on this roster` beside a scenario it had already counted as passing,
 * and exited zero. Second standing order, in the machinery that enforces the second standing
 * order, in a file the budget written to bound exactly this could not see.
 *
 * The census skips them because it asks `/^export (function|class|const|let|enum) /`. That
 * question is right for *"is there a decision here nobody checks"* and wrong for *"is there code
 * here nobody runs"* — an entrypoint that exports nothing is not less worth testing than a
 * library that exports one function. It is the thing that actually runs.
 */
const MAX_UNEXPORTED = 8

/**
 * Modules that export nothing, and what is true about each.
 *
 * Three reasons appear here and they are not equally good. `types` is not a gap. `boundary` is a
 * gap the boundary rule answers by moving the decision out rather than by testing the module.
 * `entrypoint` is a plain gap.
 */
const NO_EXPORTS: Record<string, { readonly why: 'types' | 'boundary' | 'entrypoint'; readonly note: string }> = {
  'src/shared/theme/theme.ts': {
    why: 'types',
    note: 'Interfaces and a type alias. Nothing executes, so there is nothing a test could assert.',
  },
  'src/main/main.ts': {
    why: 'boundary',
    note:
      'Imports electron at module scope, so no test can load it. The answer is the boundary rule ' +
      'rather than a harness: every decision that mattered has been moved out to where a test can ' +
      'reach it — `mayWriteRegistry` and `shownSessions` to main/registry.ts, `approvalRecord` to ' +
      'main/approvals.ts, `statusLine` to shared/status-line.ts, `msUntilNextBreak` to ' +
      'shared/floor/choreography.ts. What is left is wiring.',
  },
  'src/renderer/app.ts': {
    why: 'boundary',
    note:
      'Reaches for `window` at load. Same rule and the same answer — shared/status-line.ts, ' +
      'renderer/mishaps.ts, renderer/views/popmenu.ts, renderer/views/focus-return.ts and ' +
      'shared/approval-decision.ts all came out of it, each because a decision in here could not ' +
      'otherwise be checked.',
  },
  'src/preload/preload.ts': {
    why: 'boundary',
    note:
      'Imports electron and is compiled to CJS. Not loadable, and not unchecked: ' +
      'test/the-bridge-has-two-ends.test.ts reads it as text and compares every channel it ' +
      'invokes and subscribes to against every handler and push in src/main.',
  },
  'src/renderer/mock.ts': {
    why: 'entrypoint',
    note: 'The dev harness. Loads the real renderer against a fake bridge; nothing imports it.',
  },
  'src/main/cli/eval.ts': {
    why: 'entrypoint',
    note:
      'The evaluation harness. `ade-af` is testing it in #175, which found a check running ' +
      'downstream of the decision it should have made — delete this line when that lands.',
  },
  'src/main/cli/discover.ts': {
    why: 'entrypoint',
    note: 'A dev CLI that prints what the workspace scan found. 38 lines, all of it printing.',
  },
  'src/shared/character/cli/contact-sheet.ts': {
    why: 'entrypoint',
    note: 'A dev CLI that paints every character frame into one sheet to look at.',
  },
}

test('every module that exports nothing is either driven by a test or declared here', async () => {
  const aimed = await aimedAt()
  assert.ok(aimed.size > 50, `the import scanner resolved ${aimed.size} modules, so it is broken`)

  const unexported: string[] = []
  for (const file of await tsFiles('src')) {
    const text = await readFile(join(repo, file), 'utf8')
    // The same question the census asks, answered the other way round.
    if (/^export (async )?(function|class|const|let|enum) /m.test(text)) continue
    if (!aimed.has(file)) unexported.push(file)
  }

  const declared = Object.keys(NO_EXPORTS).sort()
  const actual = unexported.sort()

  assert.deepEqual(
    actual.filter((f) => !declared.includes(f)),
    [],
    'a module that exports nothing has no test driving it and is not declared in NO_EXPORTS. ' +
      'That is the category `eval.ts` hid in: 179 lines the census could not see, holding a ' +
      'check that reported a pass it had not observed.',
  )
  assert.deepEqual(
    declared.filter((f) => !actual.includes(f)),
    [],
    'these are declared as undriven but a test now imports them — delete the lines, so the list ' +
      'keeps meaning what it says',
  )
  assert.ok(
    declared.length <= MAX_UNEXPORTED,
    `${declared.length} modules parked, and the budget is ${MAX_UNEXPORTED}. Write the test, or ` +
      `take one off the list, or raise MAX_UNEXPORTED and put your name on it.`,
  )
})

test('a module excused as types-only really has nothing that runs', async () => {
  // The excuse that would be easiest to borrow. "Types only" is the one reason on that list that
  // is not a gap at all, so a module claiming it must actually be types only — otherwise the
  // strongest exemption is available to whatever wants it.
  const wrong: string[] = []
  for (const [file, entry] of Object.entries(NO_EXPORTS)) {
    if (entry.why !== 'types') continue
    const text = await readFile(join(repo, file), 'utf8')
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^(export )?(type|interface) [\s\S]*?^}/gm, '')
      .replace(/^export type .*$/gm, '')
      .replace(/^import[\s\S]*?from '[^']*'$/gm, '')
    if (/\b(function|class|const|let|var)\b/.test(code)) wrong.push(`${file}: ${code.trim().slice(0, 80)}`)
  }
  assert.deepEqual(wrong, [], 'a module declared types-only has runtime code in it')
})

test('the modules a boundary excuse points at still exist, and still hold something', async () => {
  /**
   * Named for what it does. It is a **referential-integrity** check and not a validation of the
   * reason — `office-space-6c` was right that a check on prose gets satisfied by prose, and that
   * calling this one `justified` or `names what was moved` would be claiming otherwise.
   *
   * What it is worth is the decay mode. `boundary` is true the day it is written and stays on the
   * page after the module it points at is renamed, absorbed or emptied — and a justification
   * referring to something that no longer exists is worse than no justification, because it reads
   * as considered.
   *
   * So: the entry names at least one module, every module it names is on disk, and every one of
   * them exports something. That last clause is 6c's, and it closes the hole where `the decisions
   * went to X` is satisfied by naming another empty file — a pointer to a pointer with no ground
   * underneath.
   */
  const wrong: string[] = []
  for (const [file, entry] of Object.entries(NO_EXPORTS)) {
    if (entry.why !== 'boundary') continue

    const named = [...entry.note.matchAll(/\b([\w./-]+\.ts)\b/g)].map((m) => m[1] ?? '')
    if (named.length === 0) {
      wrong.push(`${file}: names no module at all, so there is nothing to go and look at`)
      continue
    }

    for (const target of named) {
      // `src/` unless the note names a test — `preload.ts` cannot have its decisions moved
      // anywhere, and what makes it checked is a test that reads it as text. Naming that is
      // evidence of the same kind, so it resolves the same way.
      const path = target.startsWith('src/') || target.startsWith('test/') ? target : join('src', target)
      let text: string
      try {
        text = await readFile(join(repo, path), 'utf8')
      } catch {
        wrong.push(`${file}: points at ${target}, which is not there`)
        continue
      }
      // A test file is evidence of a different kind: what makes it count is that it *runs*, and
      // a test with no assertions would be caught by the suite rather than by a grep for
      // `export`. So the export clause is asked only of source modules.
      const isTest = path.startsWith('test/')
      if (!isTest && !/^export /m.test(text)) {
        wrong.push(`${file}: points at ${target}, which exports nothing`)
      }
      if (isTest && !/\bassert\./.test(text)) {
        wrong.push(`${file}: points at ${target}, which asserts nothing`)
      }
    }
  }
  assert.deepEqual(wrong, [])
})
