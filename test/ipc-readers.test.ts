/**
 * A field the main process fills in and the renderer never reads.
 *
 * This is **the** recurring defect in this repository — something declared in one place and
 * never read by the place that needs it, with every layer individually correct and the whole
 * thing typechecking. It has been found by hand about fourteen times. Recent instances: an
 * agent's tool list never compared against permissions; the permission-mode dial never passed to
 * the approval gate; the session registry read before the workspace root was known.
 *
 * `src/shared/ipc.ts` is where the class keeps living, because it is the one file both halves
 * agree on: main populates a field, the renderer never touches it, and nothing anywhere fails.
 * The instance that prompted this check is `SessionInfo.costUsd` — computed on every switcher
 * refresh from the live session or the registry, persisted across restarts, and read by no
 * renderer. Nobody could have noticed a wrong figure, because no surface ever printed one.
 *
 * ## Why this is a compiler check and not a grep
 *
 * A grep for the field name would have passed on the very bug that motivated the check.
 * `costUsd` is declared on three interfaces, and `app.ts` reads `state.costUsd` —
 * `SessionState`, a different type. Name-level matching sees a reader and reports fine. So this
 * resolves each property access to the **symbol** it actually lands on, which is the only way
 * `SessionState.costUsd` and `SessionInfo.costUsd` are different answers.
 *
 * `mock.ts` does not count as a reader. It is the fixture harness — it fills these types in to
 * drive the UI without a main process — so a field mentioned only there is a field mentioned
 * only by the thing pretending to be main.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const IPC = 'src/shared/ipc.ts'

/**
 * Every field that has no direct reader, and what was found when somebody looked.
 *
 * Explicit, like `NEEDS_NO_ENTRY` in `capabilities.ts` and for the same reason: silence is not an
 * opt-out. A field nobody has classified is a field nobody has checked, which is the state that
 * produced the bug this file exists for. Adding a line here is a claim that somebody looked, so
 * each carries what they found and the date.
 *
 * The entries are **not** all "this is fine". Three kinds are recorded, and the difference
 * matters more than the exemption:
 *
 *   **twin** — the renderer reads the field, through a structurally identical type it declares
 *   itself rather than importing. `mic.ts` re-declares the dictation payloads inline;
 *   `hire.ts` declares `HireDraft` against `HireRequest`. These typecheck by structure, so a
 *   rename on one side leaves the other compiling against a shape that no longer exists at
 *   runtime. Weaker than the bug above, same family.
 *
 *   **accounted elsewhere** — genuinely nothing for the renderer to do with it.
 *
 *   **unread** — a real orphan, found by this check on 2026-08-26 and not yet fixed. Listed here
 *   so the suite is green about a known state rather than red about a known state; each one is
 *   named in the night's report for triage rather than quietly repaired at 3am.
 */
const NO_READER_NEEDED: ReadonlyMap<string, string> = new Map([
  // twin — mic.ts:48 declares `{ ok, text, reason? }` inline instead of importing `Dictated`,
  // and takes `DictationSetup` through its own handler type. Read at mic.ts:207, :314-:322.
  ['Dictated.ok', 'twin: read via the inline type at views/mic.ts:48 — 2026-08-26'],
  ['Dictated.text', 'twin: read via the inline type at views/mic.ts:48 — 2026-08-26'],
  ['Dictated.reason', 'twin: read via the inline type at views/mic.ts:48 — 2026-08-26'],
  ['DictationSetup.detail', 'twin: read at views/mic.ts:207 through the handler type — 2026-08-26'],
  ['DictationSetup.fix', 'twin: read through the handler type in views/mic.ts — 2026-08-26'],

  // twin — views/hire.ts declares `HireDraft`, field for field the same shape, and the form
  // builds one of those. Nothing imports `HireRequest` into the renderer.
  ['HireRequest.id', 'twin: built as HireDraft in views/hire.ts:30 — 2026-08-26'],
  ['HireRequest.description', 'twin: built as HireDraft in views/hire.ts:30 — 2026-08-26'],
  ['HireRequest.tools', 'twin: built as HireDraft in views/hire.ts:30 — 2026-08-26'],
  ['HireRequest.model', 'twin: built as HireDraft in views/hire.ts:30 — 2026-08-26'],
  ['HireRequest.prompt', 'twin: built as HireDraft in views/hire.ts:30 — 2026-08-26'],

  // accounted elsewhere — main adds an aside's cost to the session that paid for it
  // (main.ts, `live?.spend(answer.costUsd)`), and the session's total is what the window shows.
  // The renderer has nothing to do with the figure a second time.
  ['AsideResult.costUsd', 'accounted elsewhere: main folds it into the session total — 2026-08-26'],

  // unread — real orphans, found 2026-08-26, named for triage rather than fixed at 3am.
  ['ThemeInfo.redistributable', 'unread: no surface says whether a theme may be redistributed — 2026-08-26'],
  ['ThemeChoice.redistributable', 'unread: inherited from ThemeInfo, equally unread — 2026-08-26'],
  ['OfficeSnapshot.scannedAt', 'unread: nothing shows when the workspace was last scanned — 2026-08-26'],
  ['RestoredSession.sessionId', 'unread: the restore path already knows the id it asked for — 2026-08-26'],
  ['RestoredSession.title', 'unread: the title is re-read from the session list instead — 2026-08-26'],
  // This one is worth more than its size. The field's own comment says it exists so "a claim can
  // be checked against the transcript" — and no surface offers that check.
  ['EmployeeWork.toolUseId', 'unread: the dispatch a claim traces back to, offered nowhere — 2026-08-26'],
  // `SessionInfo.costUsd` was here, found by this check on its first run against merged `dev`
  // and listed because the surface it was said to wait on — S6, the Work Feed — turned out to
  // be named in two comments in this repository and written down nowhere else. Waiting for a
  // specification nobody had written, while a real number was computed and discarded on every
  // refresh, was not a reason. It has a reader now: `sessionRows` puts it on the conversation's
  // row in the switcher, which is where the field's own comment always said it belonged.
  // Removed rather than re-worded — an entry here is a claim that somebody looked and found no
  // reader, and that claim is now false.
  ['ModeChange.sessionId', 'unread: the handler applies the change to the active session — 2026-08-26'],
  // The held-call card never says which agent asked. The approval list is workspace-wide, so
  // "who wants to run this" is a question the card cannot currently answer.
  ['PendingApproval.agent', 'unread: the approval card does not say who asked — 2026-08-26'],
  ['MusicSetup.hosts', 'unread: the music panel never lists the redirect hosts — 2026-08-26'],

  /*
   * The survey is fetched and mostly discarded, and the reason is worth stating exactly once.
   *
   * `capabilitiesOf()` IS called — app.ts:1376 — and the caller keeps `staff`, reading `id`,
   * `danglingMcpTools` and `unreachableTools` to build the roster's two warning columns. It
   * keeps nothing else. So the survey crosses the boundary whole and four fifths of it is
   * dropped on arrival, which is a smaller fault than an uncalled IPC and a real one: every one
   * of these was measured in the main process to answer a question no surface asks.
   */
  ['CapabilityReport.servers', 'unread: the caller keeps only `staff` — 2026-08-26'],
  ['CapabilityReport.sources', 'unread: the caller keeps only `staff` — 2026-08-26'],
  ['CapabilityReport.permissions', 'unread: the caller keeps only `staff` — 2026-08-26'],
  ['CapabilityReport.problems', 'unread: the caller keeps only `staff` — 2026-08-26'],
  ['CapabilityReport.scannedAt', 'unread: the caller keeps only `staff` — 2026-08-26'],

  // The same, one layer down — found only once this check learned to descend.
  ['CapabilityReport.servers[].name', 'unread: nothing renders the survey’s server list — 2026-08-26'],
  ['CapabilityReport.servers[].transport', 'unread: nothing renders the survey’s server list — 2026-08-26'],
  ['CapabilityReport.servers[].scope', 'unread: nothing renders the survey’s server list — 2026-08-26'],
  ['CapabilityReport.servers[].status', 'unread: nothing renders the survey’s server list — 2026-08-26'],
  ['CapabilityReport.sources[].path', 'unread: nothing renders where capabilities came from — 2026-08-26'],
  ['CapabilityReport.sources[].state', 'unread: nothing renders where capabilities came from — 2026-08-26'],
  ['CapabilityReport.permissions.allow', 'unread: no surface shows this workspace’s allow list — 2026-08-26'],
  ['CapabilityReport.permissions.deny', 'unread: no surface shows this workspace’s deny list — 2026-08-26'],
  ['CapabilityReport.permissions.inForce', 'unread: no surface says whether the lists are in force — 2026-08-26'],
  // The roster reads `id`, `danglingMcpTools` and `unreachableTools` from this shape. These two
  // it does not: an agent's access mode (`declared`/`inherited`/`none`) and its tool list are
  // surveyed per agent and shown nowhere, though `StaffMember.tools` covers the same ground.
  ['CapabilityReport.staff[].access', 'unread: the roster shows the two warnings, not the survey — 2026-08-26'],
  ['CapabilityReport.staff[].tools', 'unread: the roster draws StaffMember.tools instead — 2026-08-26'],

  // The office ships every skill's id, name and description and the app counts them. `next.skills`
  // is read twice (app.ts:458, :505) and both are `.length` — so the material for "what does this
  // office know how to do" is already on the wire and no surface spends it.
  ['OfficeSnapshot.skills[].id', 'unread: only skills.length is read — 2026-08-26'],
  ['OfficeSnapshot.skills[].name', 'unread: only skills.length is read — 2026-08-26'],
  ['OfficeSnapshot.skills[].description', 'unread: only skills.length is read — 2026-08-26'],
])

/** Every `.ts` under a directory, recursively, as absolute paths. */
function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of ts.sys.readDirectory(join(root, dir), ['.ts'])) acc.push(entry)
  return acc
}

/**
 * Where a reader is allowed to live.
 *
 * The renderer, and `src/shared/` with it — because this repository deliberately keeps the
 * renderer's *judgements* in shared modules so a decision can be reached by a test rather than
 * buried in a branch. `switcher.ts` is the whole of what a conversation row says; `approval-
 * summary.ts` is the whole of what a held call shows. Scanning only `src/renderer/` would report
 * `SessionInfo.title` as unread, which is the check being wrong about the convention rather than
 * the code being wrong.
 *
 * `mock.ts` is not a reader anywhere. It is the fixture harness — it fills these types in to
 * drive the UI without a main process — so a field mentioned only there is a field mentioned
 * only by the thing pretending to be main.
 */
function consumerFiles(): string[] {
  return [...sources('src/renderer'), ...sources('src/shared')].filter((f) => !f.endsWith('mock.ts'))
}

/**
 * The renderer project, compiled once for the whole file.
 *
 * Four of the five tests here call this, and it was building a fresh `ts.Program` each time —
 * four full type-checks of the same unchanging tree.
 *
 * Sound because a `ts.Program` is immutable **and because nothing in the suite writes into
 * `src/`**. The second is a precondition rather than an observation: were a test to start
 * generating a source file, this cache would hand the later callers a view of the tree from before
 * it existed, and they would be right about a repository that no longer exists. Checked in review
 * across every test, and worth re-checking if that ever changes.
 *
 * Memoised rather than hoisted to a top-level constant: a file that is imported for one of its
 * other exports should not pay for a compile it never asks for.
 */
let compiled: ts.Program | null = null

function program(): ts.Program {
  if (compiled !== null) return compiled
  const configPath = join(root, 'tsconfig.renderer.json')
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    root,
  )
  compiled = ts.createProgram(config.fileNames, config.options)
  return compiled
}

/**
 * Every property symbol the renderer actually reaches, by any route.
 *
 * Four routes, because a field can be read four ways and three of them are not a dot: `s.cost`,
 * `const { cost } = s`, `s['cost']`, and an object literal being built to *satisfy* one of these
 * types — which is the renderer writing the field rather than reading it, and still counts as
 * the field being wired to something.
 */
function reached(prog: ts.Program, files: readonly string[]): ReadonlySet<ts.Symbol> {
  const checker = prog.getTypeChecker()
  const seen = new Set<ts.Symbol>()

  const note = (node: ts.Node | undefined): void => {
    if (!node) return
    const symbol = checker.getSymbolAtLocation(node)
    if (symbol) seen.add(symbol)
  }

  for (const file of files) {
    const source = prog.getSourceFile(file)
    if (!source) continue

    const walk = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) note(node.name)
      else if (ts.isBindingElement(node)) note(node.propertyName ?? node.name)
      else if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
        note(node.argumentExpression)
      } else if (ts.isObjectLiteralExpression(node)) {
        // A literal being built to fit one of these interfaces. Its own property symbols belong
        // to the literal, not to the interface, so the contextual type is the only way through.
        const contextual = checker.getContextualType(node)
        if (contextual) {
          for (const property of node.properties) {
            const name = property.name && ts.isIdentifier(property.name) ? property.name.text : null
            if (!name) continue
            const target = contextual.getProperty(name)
            if (target) seen.add(target)
          }
        }
      }
      ts.forEachChild(node, walk)
    }

    walk(source)
  }

  return seen
}

/**
 * Every property declared on an exported interface in `ipc.ts`, nested ones included.
 *
 * The descent is the correction. The first version enumerated only an interface's **top level**,
 * which meant a payload that carries its detail one layer down was almost entirely unexamined:
 * `CapabilityReport.staff` was checked, and the five fields inside `staff[]` — where the whole
 * report actually lives — were not looked at at all. That is a guard reporting on the wrapper
 * while the contents go unchecked, and `staff[].access` sat unread underneath it.
 *
 * A false negative rather than a false alarm, which is the failure worth being deliberate about:
 * a guard that cries wolf gets waved through, and a guard that quietly checks less than it claims
 * gets trusted for coverage it does not have. This one claimed the boundary and inspected the
 * first inch of it.
 *
 * Only into shapes declared **in this file**, and each type once. An array's element type counts
 * as the same shape — `readonly Foo[]` is a promise about `Foo`. Types from elsewhere are their
 * own module's business, and `lib` types have hundreds of properties nobody wired by hand.
 */
function declared(prog: ts.Program): { name: string; symbol: ts.Symbol }[] {
  const source = prog.getSourceFile(join(root, IPC))
  assert.ok(source, `${IPC} is not in the renderer program — the config this reads has moved`)

  const checker = prog.getTypeChecker()
  const out: { name: string; symbol: ts.Symbol }[] = []
  const visited = new Set<ts.Type>()

  /** Declared here, rather than in `lib` or another module. */
  const isOurs = (type: ts.Type): boolean => {
    const declarations = type.getSymbol()?.getDeclarations() ?? []
    return declarations.some((d) => d.getSourceFile().fileName === source.fileName)
  }

  const descend = (type: ts.Type, path: string, at: ts.Node): void => {
    if (visited.has(type)) return
    visited.add(type)

    for (const property of type.getProperties()) {
      out.push({ name: `${path}.${property.getName()}`, symbol: property })

      const valueType = checker.getTypeOfSymbolAtLocation(property, at)
      // `readonly Foo[]` is a promise about `Foo`, so the element type is the same shape.
      const inner = checker.getTypeArguments(valueType as ts.TypeReference)[0] ?? valueType
      if (inner.isClassOrInterface() || (inner.flags & ts.TypeFlags.Object) !== 0) {
        if (isOurs(inner) || inner.getSymbol()?.getName() === '__type') {
          descend(inner, `${path}.${property.getName()}[]`.replace('[]', inner === valueType ? '' : '[]'), at)
        }
      }
    }
  }

  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue
    if (!statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue
    descend(checker.getTypeAtLocation(statement.name), statement.name.text, statement)
  }

  return out
}

test('every field on the renderer-facing IPC contract has a reader in the renderer', () => {
  const prog = program()
  const seen = reached(prog, consumerFiles())

  const orphans = declared(prog)
    .filter((field) => !seen.has(field.symbol))
    .filter((field) => !NO_READER_NEEDED.has(field.name))
    .map((field) => field.name)

  assert.deepEqual(
    orphans,
    [],
    'these fields cross the IPC boundary and nothing in src/renderer/ reads them. Either read ' +
      'them, take them off the interface, or — if the field genuinely has no renderer reader ' +
      'and you have checked why — add it to NO_READER_NEEDED with the reason and the date.',
  )
})

/**
 * The register describes fields that exist, and says something about each.
 *
 * Two ways an allowlist stops meaning anything: an entry outlives the field it excused, and an
 * entry says nothing about why. The first turns the list into a place stale names accumulate;
 * the second turns it into the silence it was built to replace.
 */
test('nothing is excused that is not there, and nothing is excused without a reason', () => {
  const fields = new Set(declared(program()).map((f) => f.name))

  assert.deepEqual(
    [...NO_READER_NEEDED.keys()].filter((name) => !fields.has(name)),
    [],
    'these are excused from a check they can no longer fail — the field is gone from ipc.ts',
  )

  assert.deepEqual(
    [...NO_READER_NEEDED.entries()].filter(([, why]) => !/— 20\d\d-\d\d-\d\d$/.test(why)).map(([n]) => n),
    [],
    'every entry states what was found and the date somebody looked',
  )
})

/**
 * A read through an optional chain and an arrow parameter still counts.
 *
 * `survey?.staff.map((m) => m.unreachableTools)` — app.ts:1390 — is the shape this was suspected
 * of missing, and the suspicion was reasonable: it is three inferences deep, and if resolution
 * gave up there the field would read as orphaned. It does not. The two fields reached that way
 * resolve, while `access` beside them in the same shape does not, which is the pair that shows
 * the check is discriminating rather than simply optimistic.
 *
 * Pinned because the alternative to knowing this is arguing about it. A guard that cries wolf is
 * worse than no guard — the next real finding gets waved through by whoever is tired of triage —
 * so "does it over-report" has to be answerable by running something.
 */
test('a field read through an optional chain and an arrow parameter is not an orphan', () => {
  const prog = program()
  const seen = reached(prog, consumerFiles())
  const nested = new Map(declared(prog).map((f) => [f.name, f.symbol]))

  for (const name of ['CapabilityReport.staff[].danglingMcpTools', 'CapabilityReport.staff[].unreachableTools']) {
    const symbol = nested.get(name)
    assert.ok(symbol, `${name} is no longer declared; this test is pinning a shape that has moved`)
    assert.ok(seen.has(symbol), `${name} is read at app.ts:1390 and the check could not see it`)
  }

  const access = nested.get('CapabilityReport.staff[].access')
  assert.ok(access, 'CapabilityReport.staff[].access has moved')
  assert.equal(seen.has(access), false, 'if this becomes read, take it out of NO_READER_NEEDED')
})

/**
 * The check's own trap, stated as a test.
 *
 * A name-level check passes on the bug that motivated this file: `costUsd` is declared on three
 * interfaces and `app.ts` reads one of them, so grepping the name finds a reader and reports
 * fine. If this check ever degrades to matching names, this fails.
 */
test('two same-named fields on different interfaces are two different questions', () => {
  const prog = program()
  const fields = declared(prog).filter((f) => f.name.endsWith('.costUsd'))

  assert.ok(fields.length > 1, `costUsd is declared once now; this guard assumed several. ${IPC} has moved on.`)
  assert.equal(
    new Set(fields.map((f) => f.symbol)).size,
    fields.length,
    'the same symbol was returned for fields on different interfaces, so a reader of one would ' +
      'count as a reader of all — which is the exact blindness this file was written to avoid',
  )
})

/**
 * The file this reads is the file the app ships.
 *
 * A guard pointed at a path that no longer exists passes forever and checks nothing, which is
 * the same failure mode one layer up.
 */
test('the contract this guards is where it says it is', () => {
  assert.match(readFileSync(join(root, IPC), 'utf8'), /export interface SessionInfo/)
})
