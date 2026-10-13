/**
 * Does every field that crosses the bridge have somebody on the other side reading it?
 *
 * Four fields in one day were written, persisted, and read by nobody: `costUsd` computed on every
 * switcher refresh, `parentToolUseId` parsed and dropped, `plan-usage`'s `used` gated on a null
 * that could never arrive, and a change record's `before`/`after` stored and never rendered. Each
 * had a finished producing half and a consuming half left for later, and **nothing here could
 * tell "not consumed yet" from "consumed nowhere"**.
 *
 * ## This is the wide check. `ipc-readers.test.ts` is the precise one.
 *
 * Read that file before this one, because the division of labour is the only thing that makes
 * this one worth running. `test/ipc-readers.test.ts` resolves each property access to the
 * **symbol** it lands on, so `SessionState.costUsd` and `SessionInfo.costUsd` are two different
 * questions to it. It is right where it looks, and it deliberately looks at one file: *"Only into
 * shapes declared in this file. Types from elsewhere are their own module's business."*
 *
 * Elsewhere is where the rest of the bridge lives. `onEvent` carries `ClaudeEvent`, declared in
 * `src/main/claude/stream.ts`; `changed()` carries `DispatchRow`, `restore()` reaches
 * `TimelineEntry`, `whatWouldBeShared()` reaches `Written`. None of those are declared in
 * `ipc.ts`, so none of them are that check's business — and every field this one now reports is
 * in that territory. So: the precise check owns `ipc.ts`, and this one owns the reach.
 *
 * The cost of covering the reach is that it is **name-level**, and the section below says exactly
 * what that costs.
 *
 * ## Where the boundary is: reachable from `OfficeApi`, not one hop by module
 *
 * The walk starts at `OfficeApi`'s method signatures and follows every type they mention, through
 * imports and re-exports, into whatever module declares it, transitively, `extends` included. A
 * type is on the bridge when a call the renderer can make can hand it one — which is what
 * *crossing the bridge* means, rather than "sits in a module `ipc.ts` imported something else
 * from".
 *
 * This replaced *"`ipc.ts` plus the shared modules it imports types from, one hop"*. Measured on
 * 2026-09-06, against `dev` at e1cce1b:
 *
 *     one hop by module     163 fields
 *     reachable by type     230 fields, over 109 types
 *
 * It **stops seeing 7**: `binding`, `changes`, `partial`, `recipe`, `resetsIn`, `usedLabel`,
 * `hiredHash`. Every one was swept in by sharing a module with a type that crosses, and not one of
 * them crosses. `PlanLine` (`usedLabel`, `resetsIn`, `binding`) is built shared-side *from*
 * `PlanReading`, which is the type that actually crosses; `FoundChanges.changes` is an
 * intermediate `rowsFor` consumes before it returns `DispatchRow`; `UndoPlan.partial` is the plan,
 * where `UndoResult` is the answer; `CharacterSheet.recipe` sits beside `PaintDirection`;
 * `Provenance.hiredHash` is a main-side record beside `Source` and `Standing`. Two of those —
 * `changes` and `recipe` — were on the list of fields permanently exempt through module paths, and
 * they leave by being off the bridge rather than by being matched better.
 *
 * It **starts seeing 74**, and the concentration is the finding: `ClaudeEvent` accounts for most
 * of them, and six of the nine fields this now reports are on it or on the `StreamBlock` it
 * carries. The old walk followed `./`-relative imports only, so the largest payload the bridge
 * carries — every event of every run — was never looked at. Two of the 74 arrive through an
 * `extends` rather than a field: `Store`'s, which `MeasuredStore` inherits and the privacy panel
 * is built from.
 *
 * `NOT_ON_THE_BRIDGE` is gone, as intended, by construction rather than by list: `Tally` is
 * computed in main and named nowhere in `OfficeApi`, so nothing reaches it. `FORMAT_MODULES` went
 * the same way — `transcript/parse.ts` contributes `TimelineEntry` and the `Base` it is built on,
 * and none of the JSONL keys that module exists to skip, because nothing on the bridge points at
 * them. Both lists were the one-hop walk's width being corrected by hand after the fact.
 *
 * ## What a pass means, which is less than it looks
 *
 * A field passes when its name appears as an **identifier** somewhere under `src/renderer/`. That
 * is the parser's answer, not a scanner's: comments, string literals, template prose and module
 * specifiers are not identifiers, so none of them can satisfy a field any more.
 *
 * It replaced `new RegExp('\\b' + name + '\\b')` over the concatenated source, whose failure was
 * that `/`, `.` and `-` are non-word characters — so `\bagent\b` matched inside
 * `'../../shared/agent-id.js'`, and **any field whose name appeared in the filename of a module
 * the renderer imports was permanently exempt**. That was 17 of 155 fields when it was counted,
 * and it correlated with the fields most central to their module, because a module and its
 * principal field tend to share a name.
 *
 * Unread counts on the same tree, by walk and by matcher:
 *
 *     one hop   / word         1     hiredHash, which was exempted — so: green
 *     one hop   / identifier   3     + changes, recipe
 *     reachable / word         4     cwd, mcpServers, resultTimestamp, taskId
 *     reachable / identifier   9     + agents, directory, shipped, thinking, tokens
 *
 * **Do not use a bare `ts.createScanner` for this.** It was tried first and it is wrong: a
 * standalone scan loop does not rescan template tokens, so after the first `${…}` it lexes the
 * template's *prose* as identifiers, and it desynchronises far enough to hand back comment text
 * too. It reported `agent` as an identifier at `app.ts:737`, the middle of a notice string, and at
 * `app.ts:748`, inside a docblock. Those are the exact false positives this change exists to
 * remove, reintroduced by the instrument meant to remove them. Parse.
 *
 * ## The ceiling this cannot pass, which is names
 *
 * **74 of the 230 names are declared on more than one reachable type** — `kind` on 33 of them,
 * `state` on 27, `id` on 24, `name` on 16. A genuine read of any one satisfies every other, and no
 * amount of better matching changes that: it is what asking about a name instead of a field means.
 *
 * The live example is this file's own self-check. `costUsd` is declared four times on the bridge —
 * on `ClaudeEvent`, `SessionState`, `AsideResult` and `SessionInfo`. `SessionState.costUsd` is
 * read at `app.ts:1295`, `SessionInfo.costUsd` at `switcher.ts:108`, and `AsideResult.costUsd` has
 * no reader and should not have one — *"an aside's cost is folded into the session that paid for
 * it, and a display here would price the same spend twice"*. This check says `costUsd` is read.
 * All four of those are one answer to it.
 *
 * That is the boundary with `ipc-readers.test.ts`, which has a test whose whole subject is that
 * distinction and fails if it ever degrades to matching names. **Where the two overlap, believe
 * that one.** This one earns its keep on `ClaudeEvent` and the other types it declines.
 *
 * ## Two things the corpus cannot see, both measured, neither fixed here
 *
 * The reader corpus is every `.ts` under `src/renderer/`. Two known faults in it, stated with
 * numbers so the next change to this file starts from evidence rather than from this docblock:
 *
 * **`mock.ts` is not a reader.** It is the dev harness, and its own header says it *"fakes the
 * bridge"* — the far end wearing the renderer's directory, excluded from the shipped build.
 * Counting it holds up **22 further fields**: `album`, `blind`, `credit`, `deny`, `extent`,
 * `hosts`, `inForce`, `lastUsed`, `looked`, `notShown`, `overage`, `progressMs`,
 * `redistributable`, `removed`, `resetsAt`, `scannedAt`, `timestamp`, `turns`, `usage`,
 * `usingOverage`, `uuid`, `windows`. The last is `ClaudeEvent.windows`, which
 * `scripts/unread-fields.mjs` records as confirmed dead by hand — *"every rate-limit bucket the
 * CLI reports… read by no screen"* — so this check is green today about a field the repository has
 * already written down as unread. `ipc-readers.test.ts` excludes `mock.ts` and gives the reason;
 * this one should too.
 *
 * **Shared modules are readers.** The repository keeps the renderer's judgements in `src/shared/`
 * on purpose, so `switcher.ts` reading `SessionInfo.costUsd` and `activity-restore.ts` reading
 * `TimelineEntry.resultTimestamp` are the renderer reading them, and `ipc-readers.test.ts` scans
 * `src/shared/` for exactly that reason. **This check cannot copy that**, for two reasons worth
 * writing down rather than rediscovering.
 *
 * The first is that at name level a field declared in `src/shared/` would be satisfied by *its own
 * declaration*, because a property signature's name is an identifier too. Symbol resolution tells
 * a declaration from a read; a name cannot. So the narrow corpus is a consequence of the
 * name-level matching rather than an oversight beside it.
 *
 * The second is that `src/shared/` holds both halves. Four entries below — `deniedIn`,
 * `directory`, `resultTimestamp`, `thinking` — record reads in shared modules, and a widened corpus
 * would be right about two of them: `activity-restore.ts` is driven by `app.ts:74` and
 * `refusals.ts` by `ChatView.event`, so `resultTimestamp` and `deniedIn` really are the renderer
 * reading them, while `sharing.ts`'s `probe()` and `transcript/parse.ts` are both driven from
 * `main/`. Widening would silence all four and be correct about two, which is a check getting the
 * right answer for the wrong reason twice.
 *
 * Both are width changes. The width of this walk has now twice been chosen by running it and
 * counting, and either of those owes the same before-and-after in its own diff rather than a
 * reviewer's trust inside one about something else.
 *
 * ## What a red line and a green line are each worth
 *
 * A false **negative** is silent, and the self-checks below cannot see one: they confirm that a
 * field known to be read *is* seen, and there is no converse. What they now also confirm is the
 * other direction — that a name appearing only in a module path or a comment is **not** counted —
 * because that is the regression this change would suffer if the matcher were ever loosened back
 * toward text.
 *
 * Read a red line from this as real. Do not read a green one as proof anybody consumes the field.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'

const root = new URL('..', import.meta.url).pathname

/** The one entry point. Everything the renderer can reach, it reaches through this type. */
const ENTRY = 'src/shared/ipc.ts'
const SURFACE = 'OfficeApi'

/**
 * Fields with no renderer, each with the reason it is allowed to have none.
 *
 * An entry here is a claim that somebody looked. It is **not** a place for a field whose reader
 * has not been written yet — with the one exception this list has carried since `askedAt` and
 * states in each case it applies: where what a surface should say is a decision about that
 * surface, the gap is recorded here, named plainly as a gap, rather than settled by whoever
 * happened to be editing this test.
 *
 * Six of the first nine are on `ClaudeEvent` or the `StreamBlock` it carries, and they arrived
 * together when the walk stopped being one hop by module. That is one payload parsed in full and
 * mostly discarded, not nine separate oversights. `deniedIn`, on the same event, came later.
 */
const NO_READER_NEEDED = new Map<string, string>([
  [
    'agents',
    "`ClaudeEvent`'s `init` names the agents the CLI actually loaded for the session. Written at " +
      '`stream.ts:371`, read nowhere in `src/` — measured 2026-09-06. The floor draws its staff ' +
      'from `OfficeSnapshot.staff`, discovered from `.claude/agents/` on this side, so the two ' +
      'lists are a second opinion and the only thing worth showing is where they **disagree**: an ' +
      'agent the floor is drawing that the run cannot dispatch. Nobody has specified that surface, ' +
      'and specifying it is a decision about the roster rather than about this test.',
  ],
  [
    'cwd',
    "`ClaudeEvent`'s `init` echoes the directory the CLI started in. The office chose it — main " +
      'spawns with `cwd: WORKSPACE_ROOT` — so the field confirms something this side already ' +
      'knows, and there is nothing for a view to add by printing it back. Read by nothing ' +
      '(measured 2026-09-06; the thirty-odd other `.cwd` reads in `src/` are the session ' +
      "registry's and the spawn options', a different shape wearing the same name).",
  ],
  [
    'deniedIn',
    '**Read, and this check cannot see it.** `ToolDenial.deniedIn` is read by `whereDenied` in ' +
      '`src/shared/refusals.ts`, which `ChatView.event` reaches through `summariseRefusals` to name ' +
      "the settings file a deny rule is in, in the advice under a turn's refusals. The corpus here is " +
      '`src/renderer/` only, so this entry records a read rather than a gap, as `resultTimestamp` ' +
      'does. The handoff through the view is checked by ' +
      '`the-deny-advice-names-the-file-the-rule-is-in.dom.test.ts` instead (2026-09-17).',
  ],
  [
    'directory',
    '`Written.directory` says whether a path names a directory, and `probe()` — ' +
      '`src/shared/sharing.ts:65` — reads it to decide what `git check-ignore` is actually asked, ' +
      'because asking about a bare directory is always the wrong question. It is an input to how ' +
      'the question gets formed, on the main side that asks it. What a person needs is the answer, ' +
      'and `views/privacy.ts` renders that through `rowsSayVerdict` and `saidPlainly`.',
  ],
  [
    'mcpServers',
    "`ClaudeEvent`'s `init` carries the MCP servers the session actually reached, with a live " +
      'per-server verdict — the difference between what a workspace declares and what it has. Its ' +
      'own comment says it is *"only ever used to confirm what that scan found"*, and that ' +
      'confirmation does not happen: written at `stream.ts:372`, read nowhere (measured ' +
      '2026-09-06 — every read of the name in `src/` is `capabilities.ts` and `connectors.ts` ' +
      'pulling the key out of config JSON, a different shape). A comment describing a feature ' +
      'neither end has is the shape that cost this repository `PendingApproval.agent`. Recorded ' +
      'rather than repaired because wiring it is a change to the capability scan.',
  ],
  [
    'resultTimestamp',
    '**Read, and this check cannot see it.** `TimelineEntry.resultTimestamp` is read at ' +
      '`src/shared/activity-restore.ts:105`, which `app.ts:74` imports to rebuild the activity ' +
      "strip from a restored transcript — the reader the field's own comment names. The corpus " +
      'here is `src/renderer/` only, for the reason the header gives, so this entry records a read ' +
      'rather than a gap — and it is one of the two such entries where the shared module doing ' +
      'the reading is driven by the renderer rather than by main. `deniedIn` is the other.',
  ],
  [
    'shipped',
    '`Store.shipped` lists the children that ship with the repo inside a store that is otherwise ' +
      "yours — `projects/` arrives with `_TEMPLATE` and a `README.md`. It is read main-side at " +
      '`privacy.ts:160` and `:311`, by the measure and by the delete, so that both skip the same ' +
      'files: they were two hard-coded lists once and they disagreed, which is how the panel came ' +
      "to offer to delete bytes it then left in place. The renderer is handed the result — " +
      '`views/privacy.ts` renders `bytes` and `precious` — and a list of shipped filenames is not ' +
      'something a view has anything to do with.',
  ],
  [
    'taskId',
    "The CLI's own id for a dispatched task, on `task-started` and `task-finished`. Everything " +
      'that consumes those events maps by `toolUseId` instead — `choreography.ts:889`, ' +
      '`ledger.ts:406` — because that is the id the floor already has walking to a desk. Written ' +
      'twice in `stream.ts` and read only by tests (measured 2026-09-06). The honest alternative ' +
      'is taking it off the event, which is a change to `stream.ts` rather than to this test.',
  ],
  [
    'thinking',
    '`StreamBlock.thinking` is read at `src/shared/transcript/parse.ts:292`, which turns it into a ' +
      "`TimelineEntry` of kind `thinking`, and the transcript renders that entry's `text`. " +
      'Consumed on the way across, so the renderer reads the result and not the block. (`app.ts` ' +
      "writes `dataset['thinking']`, an unrelated DOM attribute sharing the name, which this check " +
      'does not count because a string inside an element access is not an identifier.)',
  ],
  [
    'tokens',
    '`task-finished` carries what a dispatched run cost in tokens — its own comment calls it *"the ' +
      'only per-dispatch figure anybody gets"* — and nothing reads it. `outcomeIn()` takes ' +
      '`toolUseId`, `status` and `summary` off the same event and leaves this (measured ' +
      "2026-09-06; every other `.tokens` in `src/` is Spotify's auth pair). The same shape as " +
      '`costUsd`, the field this guard was written for: a number computed and thrown away. Where ' +
      'it belongs on screen is a decision about the dispatch surface, not about this test.',
  ],
])

const sources = new Map<string, ts.SourceFile>()

function parsed(file: string): ts.SourceFile {
  const already = sources.get(file)
  if (already) return already
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    // A module named by an import that is not on disk means the walk is wrong about the tree.
    // That is not "a module with no fields" and must not be counted as one.
    throw new Error(`bridge module ${relative(root, file)} could not be read`)
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  sources.set(file, source)
  return source
}

/**
 * A `'./foo.js'` specifier, back to the `.ts` on disk.
 *
 * Relative ones only. A type from a package or from `lib` is not ours to walk into, and a name
 * this cannot place is skipped rather than reported — `Promise`, `Record` and `Uint8Array` are
 * type references like any other, and treating an unplaceable name as a fault would make every
 * walk fail. The fault worth reporting is the other one: a **relative** import naming a file that
 * is not there, which means the tree moved under this walk.
 */
function moduleFor(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = join(dirname(fromFile), specifier.replace(/\.js$/, ''))
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `${relative(root, fromFile)} imports '${specifier}', which is not on disk — the walk is wrong about the tree`,
  )
}

type Declaration = ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration | ts.ClassDeclaration

interface Elsewhere {
  readonly specifier: string
  readonly original: string
}

interface Index {
  readonly declared: ReadonlyMap<string, Declaration>
  readonly elsewhere: ReadonlyMap<string, Elsewhere>
}

const indexes = new Map<string, Index>()

/** What names a module declares itself, and which module each of the rest comes from. */
function indexOf(file: string): Index {
  const already = indexes.get(file)
  if (already) return already

  const declared = new Map<string, Declaration>()
  const elsewhere = new Map<string, Elsewhere>()

  for (const statement of parsed(file).statements) {
    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      declared.set(statement.name.text, statement)
      continue
    }
    // `import type { X }` and `import { X }` alike: a type can be imported either way, and which
    // keyword was used says nothing about whether it crosses.
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const named = statement.importClause?.namedBindings
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          elsewhere.set(element.name.text, {
            specifier: statement.moduleSpecifier.text,
            original: (element.propertyName ?? element.name).text,
          })
        }
      }
    }
    // `export type { X } from './y.js'`. `ipc.ts` re-exports several types it does not declare,
    // and a walk that stopped at the re-export would lose every field behind it.
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        elsewhere.set(element.name.text, {
          specifier: statement.moduleSpecifier.text,
          original: (element.propertyName ?? element.name).text,
        })
      }
    }
  }

  const index: Index = { declared, elsewhere }
  indexes.set(file, index)
  return index
}

/** Where a name is declared, following imports and re-exports. `null` when it is not ours. */
function declarationOf(file: string, name: string): { file: string; declaration: Declaration } | null {
  const index = indexOf(file)
  const here = index.declared.get(name)
  if (here) return { file, declaration: here }
  const imported = index.elsewhere.get(name)
  if (!imported) return null
  const target = moduleFor(file, imported.specifier)
  return target === null ? null : declarationOf(target, imported.original)
}

/**
 * Every type this node names.
 *
 * `extends` is not a type reference — an interface's heritage is an `ExpressionWithTypeArguments`
 * — and missing it loses whole shapes rather than single fields. `MeasuredStore extends Store` is
 * the case on this tree: `Store` carries the five fields the privacy panel is built from, so a
 * walk that stopped at the `extends` would report that panel's contract as four fields long.
 */
function typesNamedIn(node: ts.Node): string[] {
  const names: string[] = []
  const visit = (child: ts.Node): void => {
    if (ts.isTypeReferenceNode(child)) {
      const named = child.typeName
      names.push(ts.isIdentifier(named) ? named.text : named.right.text)
    }
    if (ts.isExpressionWithTypeArguments(child) && ts.isIdentifier(child.expression)) {
      names.push(child.expression.text)
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return names
}

interface Bridge {
  /** Field name, to every place on the bridge that declares it. */
  readonly fields: ReadonlyMap<string, readonly string[]>
  /** Every type the walk reached, as `Name @ path`. */
  readonly types: ReadonlySet<string>
}

/**
 * Every data field on a type reachable from `OfficeApi`'s signatures.
 *
 * The descent is by type and transitive: a field's own type is walked into, so a payload carrying
 * its detail a layer down is examined rather than counted as one field. Object literals inside a
 * declaration count as part of it — `ClaudeEvent` is a union of inline shapes and has no other
 * form.
 *
 * A name is kept with **every** site that declares it, not the first. With 74 of 230 names on more
 * than one type, reporting only the first would name one type in a failure about a field that
 * might be on any of four. This is also where the old `NOT_ON_THE_BRIDGE` filtering had to happen
 * *during* the walk rather than after it: a name is claimed once, so a field filtered out
 * afterwards would already have taken the name from a genuine one. Nothing is filtered now —
 * unreachable is unreachable, and a type that does not cross is never opened — which is that
 * hazard removed rather than handled.
 */
function bridge(): Bridge {
  const fields = new Map<string, string[]>()
  const types = new Set<string>()
  const walked = new Set<string>()

  const reach = (file: string, name: string): void => {
    const found = declarationOf(file, name)
    if (!found) return
    // Keyed on where the declaration *is*, not on who asked for it: the same type reached from two
    // importers is one type, and keying on the asker walks it twice and doubles every site it
    // contributes.
    const key = `${found.file}#${name}`
    if (walked.has(key)) return
    walked.add(key)

    const source = parsed(found.file)
    types.add(`${name} @ ${relative(root, found.file)}`)

    const collect = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
        for (const member of node.members) {
          if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) continue
          const { line } = source.getLineAndCharacterOfPosition(member.name.getStart(source))
          const at = `${name} @ ${relative(root, found.file)}:${line + 1}`
          const sites = fields.get(member.name.text)
          if (!sites) fields.set(member.name.text, [at])
          else if (!sites.includes(at)) sites.push(at)
        }
      }
      ts.forEachChild(node, collect)
    }
    collect(found.declaration)

    for (const referenced of typesNamedIn(found.declaration)) reach(found.file, referenced)
  }

  const entry = join(root, ENTRY)
  const api = declarationOf(entry, SURFACE)
  assert.ok(api, `${SURFACE} is not declared in ${ENTRY} — the surface this walks from has moved`)
  assert.ok(
    ts.isInterfaceDeclaration(api.declaration),
    `${SURFACE} is no longer an interface, and this walk reads its members`,
  )
  for (const member of api.declaration.members) {
    for (const referenced of typesNamedIn(member)) reach(entry, referenced)
  }

  return { fields, types }
}

/** Every `.ts` under `src/renderer/`, at any depth. */
function rendererFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.ts')) found.push(full)
    }
  }
  walk(join(root, 'src/renderer'))
  return found
}

interface Renderer {
  /** Every identifier the renderer contains. */
  readonly identifiers: ReadonlySet<string>
  /** The same files as raw text, so the self-checks can assert on the difference. */
  readonly text: string
  readonly files: number
}

/**
 * What the renderer reads, as identifiers.
 *
 * From the **parser**. A comment, a string literal, a template's prose and a module specifier are
 * none of them identifiers, so none can stand in for a read — which is the whole of what this
 * matcher is for.
 */
function rendererReads(): Renderer {
  const identifiers = new Set<string>()
  const parts: string[] = []
  const files = rendererFiles()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    parts.push(text)
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) identifiers.add(node.text)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { identifiers, text: parts.join('\n'), files: files.length }
}

test('every data field on the bridge is read by a renderer, or says why not', () => {
  const { fields, types } = bridge()
  const { identifiers, text, files } = rendererReads()

  // The instrument, both halves. A walk that found nothing, or a renderer read that came back
  // empty, makes the assertion below pass while checking nothing — which is the exact failure
  // this file exists to detect and the one it is most able to commit itself.
  assert.ok(fields.size > 150, `only ${fields.size} bridge fields parsed — the walk moved`)
  assert.ok(types.size > 80, `only ${types.size} types reached from ${SURFACE} — the walk moved`)
  assert.ok(files > 20, `only ${files} renderer files read — the walk moved`)
  assert.ok(text.length > 50_000, `renderer read as ${text.length} chars — the walk moved`)
  assert.ok(identifiers.size > 1_000, `only ${identifiers.size} renderer identifiers — the parse moved`)
  assert.ok(fields.has('costUsd'), 'the parse no longer sees `costUsd`, a field this test was written for')
  assert.ok(identifiers.has('costUsd'), 'the renderer read cannot see a field known to be read')

  // The reach, specifically. Every field this check reports is on a type declared outside
  // `ipc.ts`, and following imports out of `src/shared/` is the whole difference between it and
  // `ipc-readers.test.ts`. A walk that quietly stopped short would still pass everything above.
  assert.ok(
    [...types].some((named) => named.includes('@ src/main/')),
    `nothing outside src/shared/ was reached from ${SURFACE} — the walk stopped following imports`,
  )
  assert.ok(types.has('ClaudeEvent @ src/main/claude/stream.ts'), '`onEvent` no longer reaches `ClaudeEvent`')

  // The exclusion lists went by construction, not by looking away. `Tally` is what
  // `NOT_ON_THE_BRIDGE` held, and `isSidechain` is one of the JSONL keys `FORMAT_MODULES` excluded
  // a whole module for. Either becoming reachable is a real change to the bridge, and wants a
  // decision rather than a list.
  assert.equal([...types].some((named) => named.startsWith('Tally @')), false, '`Tally` is on the bridge now')
  assert.equal(fields.has('isSidechain'), false, "the JSONL format's own keys are on the bridge now")

  // The other direction, which is the one this change is about. Both names are in the renderer —
  // `recipe` inside `'…/character/recipe.js'`, `changes` inside an import path, a palette keyword
  // array and a mock description — and neither is ever an identifier there. If the matcher is
  // loosened back toward text, these fail before a field silently passes on a module path.
  for (const name of ['recipe', 'changes']) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(text), `\`${name}\` is no longer in the renderer at all`)
    assert.equal(
      identifiers.has(name),
      false,
      `\`${name}\` is being counted as an identifier — either the matcher has loosened back to ` +
        'text, or the renderer now genuinely binds that name and this canary needs another one',
    )
  }

  const unread = [...fields]
    .filter(([name]) => !identifiers.has(name))
    .filter(([name]) => !NO_READER_NEEDED.has(name))
    .map(([name, sites]) => `${name} (${sites.join(', ')})`)

  assert.deepEqual(
    unread,
    [],
    'these cross the bridge and no renderer reads them — finish the reader, or record why there is none',
  )
})

test('the exemption list is a record of looking, not a place to hide', () => {
  const { fields } = bridge()
  const { identifiers } = rendererReads()

  for (const [name, why] of NO_READER_NEEDED) {
    // An exemption naming a field that no longer exists is a claim about nothing, and it is how a
    // list like this rots into decoration.
    assert.ok(fields.has(name), `${name} is exempted but is no longer a field on the bridge`)
    assert.ok(why.length > 60, `${name}'s exemption does not say enough for anybody to check it`)

    // The other way a claim goes stale, and the one nothing here used to catch: the gap gets
    // closed and the exemption outlives it, because an exempted field is never looked at again.
    // `askedAt` sat here saying the approval card *"does not show it — so a person cannot see how
    // long the office has been waiting"*, and by 2026-09-06 `views/activity.ts:140` was reading it
    // to draw the countdown. Removed on that measurement rather than reworded: an entry here is a
    // claim there is no reader, and that claim had become false.
    assert.equal(
      identifiers.has(name),
      false,
      `${name} has a reader in src/renderer/ now — retire the exemption rather than rewording it`,
    )
  }
})
