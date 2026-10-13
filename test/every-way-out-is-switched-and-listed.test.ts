/**
 * Every way off this machine is behind the switch, and on the list.
 *
 * Two promises, made in two panels. The switch in the music panel says *"Office Space may make its
 * own network requests. Click to stop it."* The privacy panel says it lists what this app can
 * reach. `privacy.test.ts` holds both for `fetch`: no module outside its allow-list names it, and
 * `main.ts` hands it out only through `gated`. Two gaps stayed open beside those checks, and this
 * file is for them.
 *
 * - **A default is a handout too.** `spotify/connect.ts` is on the allow-list, so the scan skips
 *   it, and its `fetchImpl` defaulted to the real `globalThis.fetch`. `main.ts` passed the gated
 *   one; any other caller got the bypass by leaving the argument out. So the checks here read the
 *   parse tree of every module, allow-listed or not.
 * - **A program that downloads is a request no wrapper sees.** `hired-from.ts` ran `git clone` on
 *   a URL somebody typed, with nothing asking the switch and no row in the panel. `installWhisper`
 *   asked the switch before `brew install`, and had no row either.
 *
 * Measured on 2026-09-16, before any of this was written: with the switch on, a browse of
 * `http://127.0.0.1:<port>/nobody/agents.git` sent `GET /nobody/agents.git/info/refs` to a local
 * server, from `git/2.39.5`. The fix makes that request wait for the switch; the test below counts
 * requests at the same kind of server, so a clone that stops asking fails it.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import { browseSource, checkOnThem, readFromSource } from '../src/main/hired-from.js'
import { hiringEgress, homebrewEgress, speechEgress, type Egress } from '../src/main/privacy.js'
import type { Provenance, Source } from '../src/shared/hired-from.js'
import { egressLede } from '../src/shared/privacy-view.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The switch, exactly as `main.ts` reads it. Only `on` permits a request. */
const SWITCH = "() => musicNetwork === 'on'"

async function sources(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await sources(path)))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out.sort()
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
}

function every(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [node]
  ts.forEachChild(node, (child) => {
    out.push(...every(child))
  })
  return out
}

function where(source: ts.SourceFile, node: ts.Node): string {
  return `${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`
}

// ─────────────────────────────────────────────────────────────── the real fetch ──

const GLOBAL_SCOPES = new Set(['globalThis', 'window', 'self', 'global'])

/** `fetch` as a name some code uses, rather than as a member name, a declaration or a type. */
function usedAsAValue(id: ts.Identifier): boolean {
  const parent = id.parent
  if (ts.isShorthandPropertyAssignment(parent)) return true
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === id
  if (ts.isTypeQueryNode(parent) || ts.isQualifiedName(parent) || ts.isTypeReferenceNode(parent)) return false
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isBindingElement(parent)) return false
  return (parent as { readonly name?: ts.Node }).name !== id
}

/**
 * Every place a module gets hold of the real `fetch`, and whether it is the one sanctioned shape.
 *
 * Read from the parse tree rather than from text, because the shapes that matter are not
 * spellings: a parameter default, a destructure from `globalThis`, a shorthand property. The one
 * shape allowed is `gated(<the switch>, globalThis.fetch)` in `main.ts`, where the switch is the
 * one the music panel sets.
 */
function realFetches(file: string, text: string): { readonly at: string; readonly gated: boolean }[] {
  const source = parse(file, text)
  const found: { at: string; gated: boolean }[] = []
  for (const node of every(source)) {
    const onAGlobal = (target: ts.Expression): boolean => ts.isIdentifier(target) && GLOBAL_SCOPES.has(target.text)
    const named =
      (ts.isPropertyAccessExpression(node) && node.name.text === 'fetch' && onAGlobal(node.expression)) ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === 'fetch' &&
        onAGlobal(node.expression)) ||
      (ts.isIdentifier(node) && node.text === 'fetch' && usedAsAValue(node)) ||
      (ts.isBindingElement(node) &&
        (node.propertyName ?? node.name).getText(source) === 'fetch' &&
        ts.isObjectBindingPattern(node.parent) &&
        ts.isVariableDeclaration(node.parent.parent) &&
        node.parent.parent.initializer !== undefined &&
        onAGlobal(node.parent.parent.initializer))
    if (!named) continue

    const call = node.parent
    const gated =
      file === 'src/main/main.ts' &&
      ts.isCallExpression(call) &&
      call.expression.getText(source) === 'gated' &&
      call.arguments.length === 2 &&
      call.arguments[1] === node &&
      call.arguments[0]!.getText(source) === SWITCH
    found.push({ at: where(source, node), gated })
  }
  return found
}

test('the scanner for the real fetch sees the shapes a bypass takes, and not a type', () => {
  // The control first. A scanner that recognises nothing reports a tree with no bypass in it,
  // which reads exactly like a tree that has none.
  const bypasses = [
    'export function connect(id: string, fetchImpl: typeof globalThis.fetch = globalThis.fetch) {}',
    'const { fetch } = globalThis',
    "fetch('https://example.invalid')",
    'const deps = { fetch }',
    "const f = globalThis['fetch']",
    'const f = window.fetch',
    "gated(() => true, globalThis.fetch)",
  ]
  for (const bypass of bypasses) {
    assert.deepEqual(
      realFetches('src/main/main.ts', bypass).map((f) => f.gated),
      [false],
      `the scanner did not see this as a handout of the real fetch: ${bypass}`,
    )
  }

  const harmless = [
    'type Fetch = typeof globalThis.fetch',
    'function f(real: typeof fetch) {}',
    'const deps = { fetch: gatedOne }',
    'this.deps.fetch(url)',
    'interface Deps { readonly fetch: typeof globalThis.fetch }',
  ]
  for (const line of harmless) {
    assert.deepEqual(realFetches('src/main/x.ts', line), [], `the scanner flagged something that is not a handout: ${line}`)
  }

  assert.deepEqual(
    realFetches('src/main/main.ts', `gated(${SWITCH}, globalThis.fetch)`),
    [{ at: 'src/main/main.ts:1', gated: true }],
    'the one sanctioned shape is not recognised',
  )
  assert.deepEqual(
    realFetches('src/main/other.ts', `gated(${SWITCH}, globalThis.fetch)`).map((f) => f.gated),
    [false],
    'a gate outside the composition root is a second place the capability is handed out',
  )
})

test('the real fetch is reached only through the gate, with the switch, in any module', async () => {
  const files = await sources('src')
  assert.ok(files.length > 50, `the scanner walked ${files.length} files, so it is broken`)

  const found = (
    await Promise.all(files.map(async (file) => realFetches(file, await readFile(join(root, file), 'utf8'))))
  ).flat()

  // Three today: the Spotify client, its sign-in, and the speech model. Not pinned to three,
  // because a fourth gated handout is fine; pinned to more than none, because none is a scanner
  // that has stopped seeing `main.ts`.
  assert.ok(found.some((f) => f.gated), 'no gated fetch was found in main.ts — the wiring moved and this check is blind')
  assert.deepEqual(
    found.filter((f) => !f.gated).map((f) => f.at),
    [],
    'the real fetch is reachable here without the switch. Hand in the gated one from main.ts, ' +
      `as \`gated(${SWITCH}, globalThis.fetch)\`, and take it as a required parameter.`,
  )
})

test('a fetch or a switch that is handed in has no default, and cannot be left out', async () => {
  // A default is how `connect.ts` put the bypass back: the parameter was there, `main.ts` filled
  // it in, and nothing required anybody else to. `?` is the same default, spelled as a fallback
  // somewhere further down.
  const seen: string[] = []
  const loose: string[] = []
  for (const file of await sources('src')) {
    const source = parse(file, await readFile(join(root, file), 'utf8'))
    for (const node of every(source)) {
      if (!ts.isParameter(node) && !ts.isPropertySignature(node)) continue
      const type = node.type?.getText(source)
      const name = node.name.getText(source)
      const handsInAFetch = type === 'typeof globalThis.fetch' || type === 'typeof fetch'
      const handsInTheSwitch = name === 'allowed' && type === '() => boolean'
      if (!handsInAFetch && !handsInTheSwitch) continue
      seen.push(`${file}:${name}`)
      if (node.questionToken || (ts.isParameter(node) && node.initializer)) loose.push(`${where(source, node)} ${name}`)
    }
  }

  // The ones this was written about, so a scanner that sees nothing cannot pass.
  for (const known of [
    'src/main/spotify/connect.ts:fetchImpl',
    'src/main/spotify/client.ts:fetch',
    'src/main/voice/transcribe.ts:net',
    'src/main/voice/transcribe.ts:allowed',
    'src/main/hired-from.ts:allowed',
  ]) {
    assert.ok(seen.includes(known), `the scanner no longer sees ${known}, so this check is blind to it`)
  }
  assert.deepEqual(loose, [], 'a fetch or a switch can be left out here, and leaving it out is the bypass')
})

// ───────────────────────────────────────────────────────── programs that are started ──

/**
 * Every process this app starts, and whether that program can reach the network.
 *
 * `what-the-app-can-start.test.ts` sorts these by what bounds them. This sorts them by the question
 * the privacy panel answers, and a new one fails both files until somebody has answered both.
 *
 * Each start is written as the program and its first argument, as the source spells them — so
 * `sharing.ts` growing a `git fetch` beside its `git check-ignore` fails here, even though the
 * module was already on the list.
 *
 * `reaches` is one of:
 * - `nothing` — the program works on this machine. Inferred from what each program is: `ps` and
 *   `xattr` read process and file metadata, `git rev-parse` and `git check-ignore` read the local
 *   repository, and whisper reads a model file already on disk.
 * - `a row` — the privacy panel lists it, and the switch is asked before the program starts. The
 *   value names the function that builds the row, and `main.ts` must use it.
 * - a sentence, for the two starts that run what they are handed.
 */
const STARTS: Readonly<Record<string, readonly { readonly start: string; readonly reaches: string }[]>> = {
  'src/main/claude/run.ts': [
    {
      start: "options.claudePath ?? 'claude' buildArgs(options)",
      // The first row of the panel, `who: 'the claude CLI'`. What it reaches is on its own login,
      // and bounded by its own permission system; see `what-the-app-can-start.test.ts`.
      reaches: 'the claude CLI',
    },
  ],
  'src/main/verify.ts': [
    {
      start: 'request.command',
      // A VERIFY somebody wrote in TASKS.md, run only if `.claude/settings.json` permits it or a
      // person clicks. What it reaches is that command's business — `npm test` may fetch, `ls` does
      // not — and a list of hosts could not describe it. Not listed, and not behind the switch.
      reaches: 'what the command a person wrote reaches',
    },
  ],
  'src/main/quarantine.ts': [{ start: 'XATTR appPath', reaches: 'nothing' }],
  'src/main/orphans.ts': [{ start: "'/bin/ps' '-o'", reaches: 'nothing' }],
  'src/main/sharing.ts': [
    { start: "'git' 'rev-parse'", reaches: 'nothing' },
    { start: "'git' 'check-ignore'", reaches: 'nothing' },
  ],
  'src/main/hired-from.ts': [{ start: "'git' 'clone'", reaches: 'a row: hiringEgress' }],
  'src/main/voice/transcribe.ts': [
    { start: "brew 'install'", reaches: 'a row: homebrewEgress' },
    { start: 'binary ...args', reaches: 'nothing' },
  ],
}

const CHILD_PROCESS = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'])

/**
 * The process starts in one module, as `program firstArgument`.
 *
 * A start is a call to something from `node:child_process`, to a `promisify` of one, or to a name
 * declared as `typeof` one — the injected `spawnFn` and `spawnIt`. By binding rather than by call
 * spelling, for the reason `what-the-app-can-start.test.ts` gives: its first draft grepped
 * `spawn(` and found two modules of four.
 */
function startsIn(file: string, text: string): string[] {
  const source = parse(file, text)
  const imported = new Set<string>()
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /^(node:)?child_process$/.test(statement.moduleSpecifier.text)
    ) {
      const named = statement.importClause?.namedBindings
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          if (CHILD_PROCESS.has((element.propertyName ?? element.name).text)) imported.add(element.name.text)
        }
      }
    }
  }

  const starters = new Set(imported)
  for (const node of every(source)) {
    if (!(ts.isParameter(node) || ts.isVariableDeclaration(node)) || !ts.isIdentifier(node.name)) continue
    const typed = node.type && ts.isTypeQueryNode(node.type) && imported.has(node.type.exprName.getText(source))
    const init = node.initializer
    const wrapped =
      init !== undefined &&
      ((ts.isCallExpression(init) &&
        init.expression.getText(source) === 'promisify' &&
        imported.has(init.arguments[0]?.getText(source) ?? '')) ||
        (ts.isBinaryExpression(init) && imported.has(init.right.getText(source))))
    if (typed || wrapped) starters.add(node.name.text)
  }

  const starts: string[] = []
  for (const node of every(source)) {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || !starters.has(node.expression.text)) continue
    const [program, args] = node.arguments
    const first =
      args === undefined || ts.isObjectLiteralExpression(args)
        ? ''
        : ts.isArrayLiteralExpression(args)
          ? (args.elements[0]?.getText(source) ?? '[]')
          : args.getText(source)
    starts.push(`${program?.getText(source) ?? ''} ${first}`.trim())
  }
  return starts
}

test('the scanner for process starts sees a start however it is bound', () => {
  const found = startsIn(
    'src/main/x.ts',
    [
      "import { execFile, spawn as start } from 'node:child_process'",
      "import { promisify } from 'node:util'",
      'const run = promisify(execFile)',
      "run('git', ['fetch', remote])",
      "start('/usr/bin/curl', [url])",
      "function install(spawnFn: typeof start) { spawnFn(brew, ['install', 'x']) }",
      'const spawnIt = options.spawnFn ?? start',
      'spawnIt(binary, [...args])',
      "other('git', ['clone'])",
    ].join('\n'),
  )
  assert.deepEqual(found, ["'git' 'fetch'", "'/usr/bin/curl' url", "brew 'install'", 'binary ...args'])
})

test('every program this app starts is sorted by whether it can reach the network', async () => {
  const files = await sources('src')
  const spawners: string[] = []
  const starts: Record<string, string[]> = {}
  for (const file of files) {
    const text = await readFile(join(root, file), 'utf8')
    if (!/from 'node:child_process'/.test(text)) continue
    spawners.push(file)
    starts[file] = startsIn(file, text)
  }

  const sorted = Object.fromEntries(Object.entries(STARTS).map(([file, list]) => [file, list.map((s) => s.start)]))
  assert.deepEqual(
    Object.fromEntries(Object.entries(starts).sort(([a], [b]) => a.localeCompare(b))),
    Object.fromEntries(Object.entries(sorted).sort(([a], [b]) => a.localeCompare(b))),
    'a program this app starts has changed. Decide whether it can reach the network. If it can, ' +
      'it needs a row in the privacy panel and a check of the switch before it starts — ' +
      '`hiringEgress` and `openSource` are one of each — and then a line in STARTS.',
  )
  assert.ok(spawners.length >= 7, `found ${spawners.length} modules that start processes; the scanner is blind`)
})

// ─────────────────────────────────────────────────────── the composition root ──

/** The privacy handler's source, and every call in `main.ts`, parsed once. */
async function mainTs(): Promise<{ readonly source: ts.SourceFile; readonly calls: readonly ts.CallExpression[] }> {
  const source = parse('src/main/main.ts', await readFile(join(root, 'src/main/main.ts'), 'utf8'))
  return { source, calls: every(source).filter(ts.isCallExpression) }
}

test('main.ts hands the switch to everything that starts a download', async () => {
  // `installWhisper` and the three hiring calls take the switch as a predicate, read per call.
  // `() => true` here would type-check and pass every other test in this file, so the argument
  // itself is what is pinned.
  const { source, calls } = await mainTs()
  const asked = new Map<string, string[]>()
  for (const call of calls) {
    const name = call.expression.getText(source)
    if (!['browseSource', 'checkOnThem', 'readFromSource', 'installWhisper'].includes(name)) continue
    asked.set(name, [...(asked.get(name) ?? []), call.arguments.at(-1)?.getText(source) ?? ''])
  }

  assert.deepEqual(
    [...asked.keys()].sort(),
    ['browseSource', 'checkOnThem', 'installWhisper', 'readFromSource'],
    'one of these is no longer called from main.ts — the wiring moved and this check is blind to it',
  )
  for (const [name, passed] of asked) {
    for (const argument of passed) {
      assert.equal(argument, SWITCH, `${name} is handed ${argument} instead of the switch`)
    }
  }
})

test('the privacy panel lists every program that can reach the network', async () => {
  const { source, calls } = await mainTs()
  const handler = calls.find(
    (call) =>
      call.expression.getText(source) === 'ipcMain.handle' && call.arguments[0]?.getText(source) === 'CHANNEL.privacy',
  )
  assert.ok(handler, 'the privacy handler is not where this looks for it')

  const spread = new Map<string, string[]>()
  for (const node of every(handler)) {
    if (ts.isSpreadElement(node) && ts.isCallExpression(node.expression)) {
      spread.set(
        node.expression.expression.getText(source),
        node.expression.arguments.map((a) => a.getText(source)),
      )
    }
  }

  const builders = Object.values(STARTS)
    .flat()
    .flatMap((s) => (s.reaches.startsWith('a row: ') ? [s.reaches.slice('a row: '.length)] : []))
  assert.deepEqual(builders.sort(), ['hiringEgress', 'homebrewEgress'])
  for (const builder of builders) {
    assert.ok(spread.has(builder), `the privacy panel does not list what ${builder} describes`)
    // The switch itself, not a guess at it: a row that says "switched off" must be reading the
    // same value the gate reads.
    assert.equal(spread.get(builder)!.at(-1), 'musicNetwork', `${builder} is not told what the switch says`)
  }

  // The per-host rows come from what this office has hired, read when the panel opens. An empty
  // list here would type-check and quietly drop every host a check reaches again.
  assert.match(handler.getText(source), /recordedHires\(WORKSPACE_ROOT\)/, 'the hiring rows are not built from the record')
  assert.match(spread.get('hiringEgress')![0]!, /\.source\b/, 'the hiring rows are not given the recorded sources')
})

// ───────────────────────────────────────────────────── the switch, at a real server ──

/** A server that answers nothing useful and counts who asked. */
async function aCountingServer(t: TestContext): Promise<{ url: string; asked: string[] }> {
  const asked: string[] = []
  const server = createServer((request, response) => {
    asked.push(`${request.method} ${request.url}`)
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/nobody/agents.git`, asked }
}

test('with the switch off, a git source is refused before anything is sent, and asked again every time', async (t) => {
  const { url, asked } = await aCountingServer(t)
  let network = false
  const allowed = (): boolean => network

  const browsed = await browseSource(url, 'git', allowed)
  assert.ok('problem' in browsed, 'a browse went ahead with the switch off')
  assert.match(browsed.problem, /set not to make its own network requests/, 'the refusal does not say why')

  const record: Provenance = {
    id: 'ariel-review',
    source: { kind: 'git', at: url, file: 'agents/ariel-review.md' },
    hiredHash: 'x',
    hiredAt: '2026-09-16',
  }
  const checked = (await checkOnThem([record], allowed)).get('ariel-review')
  assert.ok(checked && !checked.seen, 'a check reported seeing a source it was not allowed to open')
  assert.equal(checked.why, 'unreachable', 'switched off is not the colleague withdrawing their file')
  assert.match(checked.detail, /set not to make its own network requests/)

  const read = await readFromSource(record.source, allowed)
  assert.ok('problem' in read, 'taking their version went ahead with the switch off')
  assert.match(read.problem, /set not to make its own network requests/)

  // A copy, because the assertion narrows what it is handed, and `asked` is read again below.
  assert.deepEqual(asked.slice(), [], 'a request left this machine with the switch off')

  // The control, with the same predicate: switched on, the same browse reaches the same server,
  // so the silence above is the switch and not a clone that never tried. Read per call — the
  // switch is flipped after the predicate was handed over, which is what somebody pressing it
  // mid-session does.
  network = true
  const reached = await browseSource(url, 'git', allowed)
  assert.ok('problem' in reached, 'the stand-in server has no repository, so this should fail after asking')
  assert.ok(
    asked.some((line) => line.includes('/nobody/agents.git/info/refs')),
    `git did not ask the server once switched on, so the check above proves nothing: ${JSON.stringify(asked)}`,
  )
})

test('with the switch off, a checkout on this machine is still read, because nothing is sent', async () => {
  // This repository is such a checkout: its own staff, in `.claude/agents`, read where they stand.
  // Nothing is written, so there is no folder to make or to clean up.
  const off = (): boolean => false

  const browsed = await browseSource(root, 'directory', off)
  assert.ok('offered' in browsed, `a directory source was refused: ${JSON.stringify(browsed)}`)
  const shipped = browsed.offered.find((o) => o.file.startsWith('.claude/agents/'))
  assert.ok(shipped, `none of the shipped staff was offered: ${browsed.offered.map((o) => o.file).join(', ')}`)

  const read = await readFromSource({ kind: 'directory', at: root, file: shipped.file }, off)
  assert.ok('content' in read, 'a directory source could not be read with the switch off')
  assert.equal(read.content, await readFile(join(root, shipped.file), 'utf8'))
})

// ─────────────────────────────────────────────────────────────────── the rows ──

const git = (at: string): Source => ({ kind: 'git', at, file: 'agents/a.md' })

test('hiring is listed as a capability, and by every host already hired from, without a credential', () => {
  const rows = hiringEgress(
    [
      git('https://someone:ghp_notarealtoken@GitHub.com/company/agents.git'),
      git('git@github.com:company/more.git'),
      git('ssh://git@gitlab.example:2222/team/agents.git'),
      git('git://git.example.org/agents.git'),
      // Places this cannot name a host for. Covered by the first row, and given none of their own.
      git('/Users/someone/mirrors/agents.git'),
      git('file:///Users/someone/mirrors/agents.git'),
      git('C:\\repos\\agents'),
      git('hg::https://hg.example/agents'),
      git('./agents'),
      // A checkout is read where it stands, so it reaches nothing and is not listed.
      { kind: 'directory', at: '/Users/someone/agents', file: 'a.md' },
    ],
    'on',
  )

  assert.deepEqual(
    rows.map((r) => r.what),
    ['any repository you hire from', 'git.example.org', 'github.com', 'gitlab.example'],
  )
  assert.match(rows.find((r) => r.what === 'github.com')!.detail, /^Hiring — 2 employees here were hired/)
  assert.match(rows.find((r) => r.what === 'gitlab.example')!.detail, /^Hiring — One employee here was hired/)
  assert.match(rows[0]!.detail, /never on its own/)

  for (const row of rows) {
    assert.equal(row.who, 'office-space', `${row.what} is a request this app makes`)
    assert.equal(row.active, false, `${row.what} is reached only when somebody asks, never "right now"`)
    assert.doesNotMatch(`${row.what} ${row.detail}`, /ghp_notarealtoken|someone/, 'a credential reached the panel')
  }

  // Nothing hired yet still lists the capability. A row that appears only after somebody has
  // used the feature answers "where has it been" — the privacy panel is asked "where can it go".
  assert.deepEqual(
    hiringEgress([], 'on').map((r) => r.what),
    ['any repository you hire from'],
  )
})

test('the hiring and Homebrew rows say when the switch is holding them off, in both of its ways', () => {
  const hired = [git('git@github.com:company/agents.git')]
  for (const row of [...hiringEgress(hired, 'off'), ...homebrewEgress('off')]) {
    assert.match(row.detail, /switched off, so/, `${row.what} does not say it is switched off`)
    assert.equal(row.active, false)
  }
  for (const row of [...hiringEgress(hired, 'unreadable'), ...homebrewEgress('unreadable')]) {
    assert.match(row.detail, /could not be read, so it is being held off/, `${row.what} hides why it is off`)
    assert.match(row.detail, /Set the switch again in the music panel\./)
  }
  assert.match(hiringEgress(hired, 'off')[0]!.detail, /directory is still read/, 'the way round the switch is not named')
  assert.match(homebrewEgress('off')[0]!.detail, /refuses without starting brew/)

  const [brew, ...more] = homebrewEgress('on')
  assert.deepEqual(more, [], 'Homebrew is one row')
  assert.equal(brew!.what, 'Homebrew')
  assert.equal(brew!.who, 'office-space')
  assert.equal(brew!.active, false, 'installing happens when somebody presses Install, never "right now"')
  assert.match(brew!.detail, /brew install whisper-cpp, only when you press Install/)
})

test('with the new rows, a fresh install still says it is reaching none of them', () => {
  // The state `egressLede` has a sentence for, and the one the speech rows once made unreachable
  // by reporting live. Rows that are never `active` must keep it reachable.
  const fresh: Egress[] = [
    { what: 'claude', who: 'the claude CLI', detail: '', active: true },
    ...speechEgress(['huggingface.co'], '.hf.co', false),
    ...hiringEgress([], 'on'),
    ...homebrewEgress('on'),
  ]
  assert.match(egressLede(fresh), /and is reaching none of them right now/)
})
