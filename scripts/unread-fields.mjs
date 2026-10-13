/**
 * Fields the app builds and never reads, resolved through the type checker.
 *
 * Grep cannot answer this. `name`, `path`, `state`, `status` sit on a dozen unrelated objects, so
 * a name-based check matches somebody else's read and reports a dead field as live. It
 * under-reports — the one direction a check must never fail in, because it looks like coverage.
 *
 * The checker knows which declaration a `.foo` resolves to. Two details make it sound:
 *
 * 1. **Match declaration nodes, not symbols.** A property on a union type (`{ok: true, text} |
 *    {ok: false, reason}`) resolves to a *synthetic* symbol that is not any of the declared ones,
 *    so symbol identity silently misses every union. `symbol.declarations` names the real ones.
 * 2. **`getRootSymbols` for the rest.** Mapped and intersected types produce their own synthetic
 *    symbols whose declarations point back at the originals.
 *
 * Reads counted: property access, destructuring with and without renaming. Writes counted
 * separately, through the object literal's *contextual* type — the symbol on a literal's own key
 * belongs to the literal, not to the interface it is being assigned to.
 *
 * ## What it cannot see, and why this is a script and not a test
 *
 * Main takes every payload off the bridge as `Record<string, unknown>` and validates it field by
 * field — `String(r['id'] ?? '')`. That is correct across a trust boundary: the renderer could
 * send anything. But an index signature has no named properties, so the checker cannot tie
 * `r['id']` back to `HireRequest.id`, and every request type reads as unread here.
 *
 * ## A read from a test is not the app using a field
 *
 * Tests are in the program and must be — the checker resolves less without them, and this script
 * would go quiet rather than wrong. But a test reading a field proves only that the thing which
 * produces it produces it. It says nothing about whether the app uses it.
 *
 * Counting the two together is how `ClaudeEvent.windows` stayed invisible. It carries every
 * rate-limit bucket the CLI reports — `five_hour` and `seven_day` — `stream.test.ts` asserted on
 * it twice, and **nothing in `src/` ever read it**, so the office threw those numbers away for
 * weeks while this script called the field live. It was found by hand, which is the work this
 * script exists to make unnecessary.
 *
 * So reads are attributed by where they come from, and a field only a test reads gets its own
 * heading. That is not automatically a fault — a field can be asserted on deliberately to pin a
 * parser's shape — but it is the difference between dead weight and **a feature somebody built,
 * proved, and never wired to anything**.
 *
 * ## Over-reporting, and structural reads in particular
 *
 * Two things put live fields on these lists, and a reader should know both.
 *
 * The first is the index-signature boundary above. The second is **structural typing**: the
 * rate-limit fields below are consumed by passing the whole event where a `PlanUsage` is wanted,
 * so every named read lands on `PlanUsage.status` and `ClaudeEvent.status` reads as untouched.
 * The value flows; the name does not. That is worth knowing before treating a row as a gap.
 *
 * So this **over-reports**, and a test asserting the list is empty would be a test nobody can
 * make pass. A test asserting a frozen baseline would train people to bump the number. It earns
 * its place as a place to look, run by a person who then checks each answer — which is how the
 * four things it has already found were confirmed:
 *
 *   PendingApproval.agent     built, sent, read by nothing, while its own comment and main's
 *                             both described a feature neither of them had
 *   ClaudeEvent.windows       every rate-limit bucket the CLI reports, parsed and asserted on by
 *                             a test, and read by no screen — found by hand, and the reason the
 *                             test/src split above exists
 *   mic.ts, hire.ts,          three IPC contracts restated as structurally identical local
 *   roster-view.ts            shapes, so drift between them is invisible to the compiler
 *
 * Run: `node scripts/unread-fields.mjs [path-suffix]`  (default `src/shared/ipc.ts`)
 */
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where this checkout actually is, rather than where it was assumed to be.
 *
 * Both scanners used to filter on `fileName.includes('/office-space/src/')` — the repository's
 * *directory name*, written into the walk. That holds in a clone named `office-space` and in
 * nothing else, and the case that matters is not a renamed clone: it is a **git worktree**.
 * `.claude/worktrees/<name>/src/foo.ts` sits under `/office-space/.claude/...`, never under
 * `/office-space/src/`, so every file was skipped and the scan reported a clean tree over zero
 * files. This repository runs most of its parallel work in worktrees.
 *
 * It was caught by the guard rather than by anybody reading: the floor below fails as "the
 * program or the walk moved" instead of passing as "all of them are used". That guard is the
 * only reason this was ever visible, and it is the argument for writing them.
 *
 * **Anchored to this file, not to the working directory.** `resolve('.')` would have swapped one
 * ambient assumption for another: it is right under `npm test`, and wrong for `npx tsx --test`
 * from anywhere else, an editor's runner, or any wrapper that chdirs — failing in the same
 * direction as the bug it replaced. These scripts live in `scripts/`, so their own location is
 * exact and nothing about how the process was launched can move it.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = join(ROOT, 'src')
const SRC = SRC_DIR + '/'

/** A path to show a person: relative to this checkout, wherever the checkout happens to be. */
const shown = (file) => (file.startsWith(ROOT + '/') ? file.slice(ROOT.length + 1) : file)

const cfgPath = join(ROOT, 'tsconfig.json')
const cfg = ts.parseJsonConfigFileContent(
  ts.parseConfigFileTextToJson(cfgPath, readFileSync(cfgPath, 'utf8')).config,
  ts.sys,
  ROOT,
)

const files = [...ts.sys.readDirectory(SRC_DIR, ['.ts']), ...ts.sys.readDirectory(join(ROOT, 'test'), ['.ts'])]
// DOM in `lib`, and no `exclude`. The base config compiles only the non-renderer half — it sets
// `lib: ["ES2023"]` and excludes `src/renderer/**` — so a program built from it has 453 errors,
// all of them in the renderer, and every expression there collapses to `any`. Property accesses
// on `any` resolve to no symbol at all, which this script would then count as "never read".
//
// That is not a bug that fails loudly. It reported `EmployeeWork.brief` as unread while a reader
// sat at `app.ts:1115`, and it reported the whole renderer as dead. **A tool that cannot see and
// a tool that sees nothing give the same answer**, and only one of them is honest — the same
// fault as the NUL byte that made grep report no matches.
//
// So the program is built with both halves' libs, and the diagnostic count is asserted below.
const program = ts.createProgram(files, {
  ...cfg.options,
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
  noEmit: true,
  skipLibCheck: true,
})

// The guard on the guard. If the program stops resolving, this script goes quiet rather than
// wrong, and quiet reads as "nothing to report".
const broken = ts.getPreEmitDiagnostics(program).filter((d) => d.file && !d.file.isDeclarationFile)
if (broken.length > 0) {
  const worst = new Map()
  for (const d of broken) worst.set(d.file.fileName, (worst.get(d.file.fileName) ?? 0) + 1)
  console.error(`the program has ${broken.length} unresolved diagnostic(s) — every answer below would be a guess:`)
  for (const [f, n] of [...worst].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.error(`  ${String(n).padStart(4)}  ${shown(f)}`)
  }
  process.exit(2)
}
const checker = program.getTypeChecker()

// Which module's declarations to audit. `shared/ipc.ts` by default, because the bridge is where
// a field is most likely to be measured on one side and dropped on the other — but the pattern is
// not the bridge's, so any module can be named.
const wanted = process.argv[2] ?? 'src/shared/ipc.ts'
// `--all` audits every module under `src/` in one program build. Eighty-six separate runs is an
// hour of rebuilding the same program; this is the same answer in one pass.
const all = wanted === '--all'
const targets = program
  .getSourceFiles()
  .filter(
    (f) =>
      !f.isDeclarationFile &&
      (all ? f.fileName.startsWith(SRC) : f.fileName.endsWith(wanted.replace(/^\.?\//, ''))),
  )
if (targets.length === 0) {
  console.error(`no source file matched ${wanted}`)
  process.exit(1)
}
const [ipcFile] = targets

/** Declaration node → record. Nodes, not symbols, so a union member is its own entry. */
const declared = new Map()

const collectFrom = (node, iface, file) => {
  const visit = (n) => {
    if (ts.isPropertySignature(n) && n.name && ts.isIdentifier(n.name)) {
      declared.set(n, {
        iface,
        name: n.name.text,
        reads: 0,
        testReads: 0,
        writes: 0,
        where: shown(file.fileName),
        line: ts.getLineAndCharacterOfPosition(file, n.getStart()).line + 1,
      })
    }
    n.forEachChild(visit)
  }
  visit(node)
}

for (const file of targets) {
  file.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node)) collectFrom(node, node.name.text, file)
    else if (ts.isTypeAliasDeclaration(node)) collectFrom(node, node.name.text, file)
  })
}

/*
 * The floor under the whole scan.
 *
 * Every guard in this file exists because **a tool that cannot see and a tool that sees nothing
 * give the same answer**, and only one of them is honest. The diagnostics check above catches a
 * program that stopped resolving. This catches the other silence: a walk that collected no
 * declarations at all — a renamed AST node kind, a `--all` glob that matched nothing usable —
 * which would print "every property is read" over a scan of zero fields.
 *
 * That is not hypothetical here. The path filter in this script was once written against the
 * repository's own directory name and skipped every file in a worktree, and the guard on the
 * count is the only reason anybody noticed.
 */
if (declared.size === 0) {
  console.error(`no property signatures were collected from ${wanted} — the walk found nothing, which is not the same as finding nothing wrong`)
  process.exit(2)
}

/** Every declaration this symbol stands for, following synthetic union/mapped symbols back. */
const declarationsOf = (symbol) => {
  if (!symbol) return []
  const roots = checker.getRootSymbols(symbol)
  const all = roots.length ? roots : [symbol]
  return all.flatMap((s) => s.declarations ?? [])
}

/**
 * The interface property an object literal's key is filling.
 *
 * Strips `| null` and `| undefined` first, and looks through the remaining union members. A
 * handler declared `Promise<RestoredSession | null>` has a contextual type that is a union, and
 * `union.getProperty('sessionId')` is undefined because `null` has no properties — so every
 * builder that can also return nothing was reported as "never built either". `RestoredSession`
 * is built twice, in the same function, eleven lines apart.
 *
 * A wrong label on a true finding is its own defect: it sends the reader looking for a dead
 * feature instead of a redundant field.
 */
const contextualProperty = (literal, key) => {
  const type = checker.getContextualType(literal)
  if (!type) return undefined
  const bare = type.getNonNullableType?.() ?? type
  const found = bare.getProperty(key)
  if (found) return found
  return bare.isUnion?.() ? bare.types.map((t) => t.getProperty(key)).find(Boolean) : undefined
}

/**
 * The property a shorthand binding takes, resolved from what is being destructured.
 *
 * Walks out to whatever the pattern belongs to — a variable's initializer, or a parameter — and
 * asks that type for the key. Nullables are stripped for the same reason they are in
 * `contextualProperty`.
 */
const destructuredProperty = (pattern, key) => {
  // The type of the PATTERN itself, not of whatever it was walked out to.
  //
  // The first version followed `pattern.parent` to a variable's initializer, which is undefined
  // for `for (const { path, cause } of outcome.failed)` — the value comes from the iterable, not
  // from an initializer — so every for-of destructure came back as a non-read. `reconcile.ts`
  // reads both of those fields on the line that reports a half-finished update.
  //
  // Asking the pattern resolves all three shapes at once: a variable, a parameter, and a loop.
  const type = checker.getTypeAtLocation(pattern)
  if (!type) return undefined
  const bare = type.getNonNullableType?.() ?? type
  const found = bare.getProperty(key)
  if (found) return found
  return bare.isUnion?.() ? bare.types.map((t) => t.getProperty(key)).find(Boolean) : undefined
}

const bump = (symbol, kind) => {
  for (const decl of declarationsOf(symbol)) {
    const rec = declared.get(decl)
    if (rec) rec[kind] += 1
  }
}

/**
 * Whether a file is a test.
 *
 * Matched on the `test/` directory rather than on a `.test.ts` suffix, because the helpers beside
 * the tests — `test/dom.ts` is the big one — are not named that and are just as much not the app.
 */
const isTest = (file) => file.fileName.startsWith(join(ROOT, 'test') + '/')

for (const file of program.getSourceFiles()) {
  if (file.isDeclarationFile) continue
  /*
   * Which counter this file's reads land in.
   *
   * Tests stay in the program — they must, or the type checker resolves less and this goes quiet
   * rather than wrong — but a read from a test is not the app using a field. It is the parser's
   * own test asserting that the parser parsed it.
   *
   * That distinction is the whole reason this pass exists. `ClaudeEvent.windows` carried every
   * rate-limit bucket the CLI sends, `test/stream.test.ts` asserted on it twice, and **nothing in
   * `src/` ever read it** — so it was counted as live and stayed invisible while the office threw
   * the numbers away. It was found by hand instead, which is the work this script is supposed to
   * make unnecessary.
   */
  const readKind = isTest(file) ? 'testReads' : 'reads'
  // The target file is NOT skipped. A property *signature* is type-level and a property *access*
  // is value-level, so a declaration can never be mistaken for a read of itself — and skipping
  // the file throws away every read a module makes of its own types.
  //
  // That was harmless for `shared/ipc.ts`, which is declarations and nothing else, and wrong the
  // moment the tool was pointed anywhere else: `choreography.ts` declares `Routine` AND reads
  // `current.priority` on line 633, so skipping it reported the priority the floor is ordered by
  // as dead, along with about fifty other live fields. The first sweep of four modules produced
  // 54 findings, nearly all of them this.

  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      bump(checker.getSymbolAtLocation(node.name), readKind)
    } else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      // `m['id']`, which is how main reads an `unknown` payload off the bridge. Not a
      // PropertyAccessExpression, so counting only those reported every IPC *request* type as
      // unread — the half of the interface the renderer sends and main takes apart by key.
      const owner = checker.getTypeAtLocation(node.expression)
      bump(owner?.getProperty(node.argumentExpression.text), readKind)
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      // `const { cause } = reason` and `const { cause: c } = reason`.
      //
      // For the renamed form the symbol at `propertyName` is the property. For the SHORTHAND
      // form — much the commoner one — the symbol at `name` is the local variable, not the
      // property, so asking for it is asking the wrong question and getting a confident answer.
      // That made every shorthand destructure read as a non-read: `Reason.cause` stayed on the
      // list after `doingLine` was written specifically to read it.
      //
      // So the shorthand is resolved through the type of the thing being taken apart.
      const key = node.propertyName ?? node.name
      if (!ts.isIdentifier(key)) {
        // A computed or string key. Nothing to resolve.
      } else if (node.propertyName) {
        bump(checker.getSymbolAtLocation(key), readKind)
      } else {
        bump(destructuredProperty(node.parent, key.text), readKind)
      }
    } else if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      ts.isIdentifier(node.name) &&
      ts.isObjectLiteralExpression(node.parent)
    ) {
      bump(contextualProperty(node.parent, node.name.text), 'writes')
    }
    node.forEachChild(visit)
  }
  visit(file)
}

const byLine = (a, b) => a.line - b.line

/** Nothing anywhere touches these — not the app, not a test. */
const dead = [...declared.values()].filter((r) => r.reads === 0 && r.testReads === 0).sort(byLine)

/**
 * Read **only** by a test, which is the class this script used to count as live.
 *
 * A test reading a field proves the thing that produces it produces it. It says nothing about
 * whether the app uses it, and conflating the two is how `ClaudeEvent.windows` — every rate-limit
 * bucket the CLI reports — stayed invisible while `stream.test.ts` asserted on it twice and no
 * screen ever showed a number from it.
 *
 * Not automatically a fault. A field can be asserted on deliberately to pin a parser's shape. It
 * is a place to look, which is what this whole script is.
 */
const tested = [...declared.values()].filter((r) => r.reads === 0 && r.testReads > 0).sort(byLine)

export const unreadFields = dead.map((r) => `${r.iface}.${r.name}`)
export const testOnlyFields = tested.map((r) => `${r.iface}.${r.name}`)

if (import.meta.url === `file://${process.argv[1]}`) {
  const built = (r) => (r.writes ? `built in ${r.writes} place${r.writes > 1 ? 's' : ''}` : 'never built either')
  const say = (r, tail) => console.log(`  ${r.where}:${String(r.line).padEnd(4)} ${r.iface}.${r.name}  —  ${tail}`)

  if (!dead.length && !tested.length) {
    console.log(`every property declared in ${wanted} is read by something in src/.`)
  }

  if (dead.length) {
    console.log(`${dead.length} propert${dead.length === 1 ? 'y' : 'ies'} in ${wanted} declared and never read:\n`)
    for (const r of dead) say(r, built(r))
  }

  if (tested.length) {
    // Its own heading, because the two are different findings and the fix is different. A field
    // nothing reads may be dead. A field only a test reads is one somebody built, proved, and
    // then never wired to anything — which is a feature sitting on the floor, not dead weight.
    console.log(
      `\n${tested.length} propert${tested.length === 1 ? 'y is' : 'ies are'} read only by a test in ${wanted} — ` +
        `parsed and proved, and nothing in src/ uses ${tested.length === 1 ? 'it' : 'them'}:\n`,
    )
    for (const r of tested) say(r, `${built(r)}, read in ${r.testReads} test${r.testReads > 1 ? 's' : ''}`)
  }
}
