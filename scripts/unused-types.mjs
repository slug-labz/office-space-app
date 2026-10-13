/**
 * Exported types that nothing anywhere refers to.
 *
 * Unlike the property audit next door, this one is sound in both directions, which is why it can
 * be a test rather than a place to look. A property name is shared by a dozen unrelated objects,
 * so a grep for `.name` matches somebody else's read; a *type reference* resolves to exactly one
 * declaration and the checker will say which.
 *
 * ## What it caught
 *
 * `ThemeSelection` — `{ active, available, problems }` — was referenced by nothing: not built, not
 * imported, in no signature. Its docstring made a real promise:
 *
 *     Themes that were installed but failed to load. Non-empty means the UI must say so. Someone
 *     who paid for art and dropped it in deserves an error, not a silent downgrade.
 *
 * That promise is kept, by a different path — `ThemeRegistry.problems` collects the failures and
 * `main.ts` folds them into the snapshot. **A dead type carrying a live promise is the most
 * expensive kind of dead code**, because it reads like the thing that keeps the promise, so the
 * next person wires it up instead of the one that already works.
 *
 * ## The rule
 *
 * Referenced *anywhere*, including its own module. A type used only where it is declared is
 * private-by-habit rather than dead, and that is a different complaint. This one is only about
 * declarations nothing at all points at.
 *
 * Run: `node scripts/unused-types.mjs`
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

/**
 * What to say when the program did not resolve, given the diagnostics.
 *
 * Extracted so it can be tested at all. The branch that calls it had none — and held a
 * shadowing bug for as long as that was true: a `const shown` declared here shadowed the
 * function above and was called **inside its own initialiser**, so every real diagnostic came
 * out as `ReferenceError: Cannot access 'shown' before initialization`.
 *
 * The `throw` below interpolates this function's result, and on the broken version it named the
 * local correctly — so renaming only the declaration would have printed this file's `shown`
 * helper into the error message instead. A trap for a partial fix rather than a second defect,
 * said that way because an earlier description of this change called it one.
 *
 * The guard on the guard therefore failed in the one way its own comment rules out. *"A check
 * that goes wrong loudly is worth ten that go quiet"* is right, and this went wrong loudly about
 * the wrong thing — anybody hitting it debugged this script instead of reading the type error it
 * was trying to hand them.
 *
 * Eight is a cap on the list, not on the count: the number in the sentence is all of them, and
 * a hundred broken files should not print a hundred lines to say one thing.
 */
export function unresolved(broken) {
  const listed = broken
    .slice(0, 8)
    .map((d) => {
      const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0)
      const where = shown(d.file.fileName) + ':' + (line + 1)
      return `  ${where}  ${ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 110)}`
    })
    .join('\n')
  return `the program has ${broken.length} unresolved diagnostic(s); every answer would be a guess\n${listed}`
}

/**
 * Every exported type under `src/` that nothing anywhere refers to.
 *
 * A function so `test/unused-types.test.ts` can assert on it. The check is sound in both
 * directions, so it earns being a test rather than a place to look — see the note above.
 */
export function unusedTypes() {
const cfgPath = join(ROOT, 'tsconfig.json')
const cfg = ts.parseJsonConfigFileContent(
  ts.parseConfigFileTextToJson(cfgPath, readFileSync(cfgPath, 'utf8')).config,
  ts.sys,
  ROOT,
)

// `scratch/` too. Those are one-off checks a person runs by hand — `check-capabilities.ts`,
// `check-floorplan.ts` — and they import from `src` like anything else. Leaving them out would
// make this report an export used only there as dead, which is the one direction a check that is
// allowed to be a test must never fail in.
const srcFiles = ts.sys.readDirectory(SRC_DIR, ['.ts']).filter((f) => !f.endsWith('.d.ts'))
const files = [
  ...srcFiles,
  ...ts.sys.readDirectory(join(ROOT, 'test'), ['.ts']),
  ...ts.sys.readDirectory(join(ROOT, 'scratch'), ['.ts']),
]
const program = ts.createProgram(files, {
  ...cfg.options,
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
  noEmit: true,
  skipLibCheck: true,
})
const checker = program.getTypeChecker()

const broken = ts.getPreEmitDiagnostics(program).filter((d) => d.file && !d.file.isDeclarationFile)
// The guard on the guard: a program that stopped resolving would report everything as unused,
// and a check that goes wrong loudly is worth ten that go quiet.
if (broken.length > 0) throw new Error(unresolved(broken))

/**
 * How many files under `src/` the walk actually reached.
 *
 * Reported beside the result because the floor that caught the directory-name bug —
 * `checked > 200`, against 800 real — was calibrated for a *total* failure and would wave
 * through a partial one. The failure modes of the anchored code are partial by nature: a root
 * one level off still matches some files. So the honest guard is not a threshold at all but an
 * identity — every source file handed to the program is a source file the walk reached — and it
 * needs no recalibrating when the repository grows.
 */
let walked = 0

/** Exported interfaces, type aliases and enums declared under `src/`. */
const declared = new Map()
for (const file of program.getSourceFiles()) {
  if (file.isDeclarationFile || !file.fileName.startsWith(SRC)) continue
  walked++
  file.forEachChild((node) => {
    const exported = ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export
    if (!exported) return
    // Types, and the values beside them. A function or a const resolves just as unambiguously as
    // a type does, so the same soundness argument covers both — and the orphan this repository
    // paid most for was a *module*, 475 tested lines whose only caller was its own test.
    const names = []
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
      names.push({ name: node.name, kind: 'type' })
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      names.push({ name: node.name, kind: 'function' })
    } else if (ts.isClassDeclaration(node) && node.name) {
      names.push({ name: node.name, kind: 'class' })
    } else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.push({ name: d.name, kind: 'const' })
      }
    }

    for (const { name, kind } of names) {
      const symbol = checker.getSymbolAtLocation(name)
      if (!symbol) continue
      declared.set(symbol, {
        name: name.text,
        kind,
        where: shown(file.fileName),
        line: ts.getLineAndCharacterOfPosition(file, name.getStart()).line + 1,
        refs: 0,
      })
    }
  })
}

for (const file of program.getSourceFiles()) {
  if (file.isDeclarationFile) continue
  const visit = (node) => {
    // Every identifier that is not the declaration's own name.
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      const isOwnName =
        (ts.isInterfaceDeclaration(parent) ||
          ts.isTypeAliasDeclaration(parent) ||
          ts.isEnumDeclaration(parent) ||
          ts.isFunctionDeclaration(parent) ||
          ts.isClassDeclaration(parent) ||
          ts.isVariableDeclaration(parent)) &&
        parent.name === node
      if (!isOwnName) {
        let symbol = checker.getSymbolAtLocation(node)
        // An import binding aliases the real symbol; follow it or every import looks like a use
        // of something else.
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        const rec = declared.get(symbol)
        if (rec) rec.refs += 1
      }
    }
    node.forEachChild(visit)
  }
  visit(file)
}

const dead = [...declared.values()].filter((r) => r.refs === 0).sort((a, b) => a.where.localeCompare(b.where))
  return { dead, checked: declared.size, walked, expected: srcFiles.length }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { dead, checked } = unusedTypes()
  if (!dead.length) {
    console.log(`every exported name under src/ is referenced somewhere (${checked} checked).`)
  } else {
    console.log(`${dead.length} exported name(s) referenced by nothing, of ${checked}:\n`)
    for (const r of dead) console.log(`  ${r.where}:${String(r.line).padEnd(4)} ${r.kind.padEnd(8)} ${r.name}`)
  }
}
