/**
 * Rows the session registry could not read are said, not dropped.
 *
 * `loadRegistry` counts the rows `parseRegistry` could not use. `openRegistry` in `main.ts` took
 * the sessions and dropped the count, and only workspace search reported it. So a registry whose
 * every row failed to parse opened as a workspace with no history, and nothing on screen said the
 * list was short. A registry file that would not open at all was already reported, as
 * `unreadable-file`; rows inside a file that did open were not.
 *
 * Found by reading `dev` at e6fe5cb, not by running the app. `main.ts` imports electron, so no
 * test can load it. The decision is therefore `skippedRowsProblem`, beside `mayWriteRegistry`,
 * and `main.ts` only assigns what it returns. The last test here checks that assignment by
 * parsing the source, and `problems-reach-the-snapshot` checks that the variable is spread into
 * the snapshot. Neither of them runs `openRegistry`.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import { loadRegistry, registryPath, skippedRowsProblem, type SessionRecord } from '../src/main/registry.js'
import { describeProblem } from '../src/shared/problem-view.js'
import { tempDir } from './temp-dir.js'

const CWD = '/work/office'

const row = (id: string): SessionRecord => ({
  id,
  mode: 'building',
  project: '',
  cwd: CWD,
  agent: 'manager',
  createdAt: '2026-09-17T09:00:00.000Z',
  updatedAt: '2026-09-17T09:00:00.000Z',
  costUsd: null,
  title: null,
  opened: true,
})

/** Three rows `parseRegistry` rejects: no id or cwd, not an object, and an empty id. */
const BAD_ROWS: readonly unknown[] = [{ nonsense: true }, null, { id: '', cwd: CWD }]

/** A workspace whose registry holds exactly `rows`, written as text so a bad row stays bad. */
async function registryWith(t: TestContext, rows: readonly unknown[]): Promise<string> {
  const root = await tempDir(t, 'office-rows-')
  await mkdir(dirname(registryPath(root)), { recursive: true })
  await writeFile(registryPath(root), JSON.stringify({ version: 1, sessions: rows }), 'utf8')
  return root
}

test('rows the registry could not read are counted on screen, with the file they are in', async (t) => {
  const root = await registryWith(t, [row('kept-1'), BAD_ROWS[0], row('kept-2'), BAD_ROWS[1], BAD_ROWS[2]])
  const loaded = await loadRegistry(root)
  assert.equal(loaded.state === 'ok' ? loaded.sessions.length : loaded.state, 2, 'the fixture should read two of five rows')

  const problem = skippedRowsProblem(root, loaded)
  assert.ok(problem, 'three rows could not be read and nothing says so')
  assert.equal(problem.path, registryPath(root))
  assert.equal(
    problem.kind,
    'lint',
    'the file was read. The first-run panel shows an `unreadable-file` problem as its own sentence, ' +
      '"exists and could not be read", built from the path alone, which is false here and drops the count',
  )
  assert.equal(
    problem.rule,
    'registry-rows-unreadable',
    'the rule decides where the first-run panel puts the problem (`firstRunState` in app.ts, read): ' +
      '`no-claude-on-path`, `workspace-not-trusted` and `app-quarantined` become steps of their own, ' +
      'and any other lint is listed as it is written',
  )

  // What the panel prints for it.
  const said = describeProblem(problem)
  assert.match(said, /\b3 rows\b/, `the count is missing: ${said}`)
  assert.ok(said.includes(registryPath(root)), `the file is not named: ${said}`)
  assert.match(said, /may be incomplete/, `nothing says the list may be short: ${said}`)
})

test('a registry whose every row failed is not an empty history', async (t) => {
  const root = await registryWith(t, BAD_ROWS.slice(0, 2))
  const loaded = await loadRegistry(root)
  // This is the list the office would show: empty, which reads as "no conversations yet".
  assert.equal(loaded.state === 'ok' ? loaded.sessions.length : loaded.state, 0)

  const problem = skippedRowsProblem(root, loaded)
  assert.match(problem ? describeProblem(problem) : 'nothing', /\b2 rows\b/)
})

test('one row that could not be read is one row', async (t) => {
  const root = await registryWith(t, [row('kept-1'), BAD_ROWS[0]])
  const problem = skippedRowsProblem(root, await loadRegistry(root))
  const said = problem ? describeProblem(problem) : 'nothing'
  assert.match(said, /\b1 row in /, said)
})

test('a registry with every row read says nothing, and so does one with no rows to read', async (t) => {
  const root = await registryWith(t, [row('kept-1'), row('kept-2')])
  assert.equal(skippedRowsProblem(root, await loadRegistry(root)), null)

  // No file is a new workspace. A file that will not open is reported by `openRegistry` as
  // `unreadable-file`, and has no rows to count.
  assert.equal(skippedRowsProblem(root, { state: 'missing' }), null)
  assert.equal(skippedRowsProblem(root, { state: 'unreadable', cause: 'Unexpected end of JSON input' }), null)
})

/**
 * The expression that assigns to `id` where it stands, or `null` for any other use of it.
 *
 * It climbs out of what can wrap a target and leave it one: `(x)`, `x!`, `x as T`, `<T>x` and
 * `x satisfies T`, which are the wrappers TypeScript accepts around an assignment target
 * (`checkReferenceExpression` in 5.9.3), and a destructuring's elements, `[x]`, `[...x]`, `{ x }`,
 * `{ a: x }` and `{ ...x }`. What it reaches is written if it is the left side of any assignment
 * operator, `=`, `&&=`, `??=`, `+=` and the rest, the operand of `++` or `--`, or the head of a
 * `for…in` or `for…of`. A default, `[x = d]`, is an assignment of its own. A literal that is not a
 * target is a read, and so is a property name. A write this cannot see is one in a string run by
 * `eval`.
 */
function writtenBy(id: ts.Identifier): ts.Node | null {
  let target: ts.Node = id
  for (;;) {
    const up = target.parent
    const wraps =
      ts.isParenthesizedExpression(up) ||
      ts.isNonNullExpression(up) ||
      ts.isAsExpression(up) ||
      ts.isTypeAssertionExpression(up) ||
      ts.isSatisfiesExpression(up) ||
      ts.isArrayLiteralExpression(up) ||
      ts.isObjectLiteralExpression(up) ||
      ts.isSpreadElement(up) ||
      ts.isSpreadAssignment(up) ||
      (ts.isShorthandPropertyAssignment(up) && up.name === target) ||
      (ts.isPropertyAssignment(up) && up.initializer === target)
    if (wraps) {
      target = up
      continue
    }
    const kind = ts.isBinaryExpression(up) && up.left === target ? up.operatorToken.kind : null
    if (kind !== null && kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment) return up
    const stepped = ts.isPrefixUnaryExpression(up) || ts.isPostfixUnaryExpression(up)
    if (stepped && (up.operator === ts.SyntaxKind.PlusPlusToken || up.operator === ts.SyntaxKind.MinusMinusToken)) return up
    if ((ts.isForOfStatement(up) || ts.isForInStatement(up)) && up.initializer === target) return up
    return null
  }
}

/** Whether `id` is the name a declaration gives a binding of its own, which would hide the module's. */
const binds = (id: ts.Identifier): boolean => {
  const up = id.parent
  return (
    (ts.isVariableDeclaration(up) ||
      ts.isParameter(up) ||
      ts.isBindingElement(up) ||
      ts.isFunctionDeclaration(up) ||
      ts.isClassDeclaration(up) ||
      ts.isImportSpecifier(up) ||
      ts.isImportClause(up) ||
      ts.isNamespaceImport(up)) &&
    up.name === id
  )
}

test('openRegistry puts the rows problem where the snapshot reads it, whatever the read was', async () => {
  // Parsed rather than searched, so a comment naming the call is not the call, and the assignment
  // is checked where it stands. A review measured two ways past the first version of this check,
  // which only asked whether the text was in the function: the assignment moved after the early
  // return an `ok` read takes, and the assignment put under an `if` that is false for `ok`. `ok`
  // is the only read with rows to count, so both dropped the count again, and both passed.
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'main.ts')
  const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const printer = ts.createPrinter({ removeComments: true })
  const code = (node: ts.Node): string =>
    printer.printNode(ts.EmitHint.Unspecified, node, source).replace(/\s+/g, ' ').trim()
  const returns = (node: ts.Node): boolean =>
    ts.isReturnStatement(node) ||
    (!ts.isFunctionLike(node) && (ts.forEachChild(node, (child) => returns(child) || undefined) ?? false))

  const declared = source.statements.filter(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'openRegistry',
  )
  const steps = declared.length === 1 ? declared[0]?.body?.statements : undefined
  assert.ok(steps, 'main.ts no longer declares one `openRegistry` with a body; this check needs rewriting')

  const read = steps.findIndex((s) => code(s) === 'const loaded = await loadRegistry(WORKSPACE_ROOT);')
  assert.ok(read >= 0, '`openRegistry` no longer reads the registry into `loaded`; this check needs rewriting')
  const kept = steps.findIndex((s) => code(s) === 'registryRowsProblem = skippedRowsProblem(WORKSPACE_ROOT, loaded);')
  assert.ok(
    kept > read,
    '`openRegistry` no longer keeps what `skippedRowsProblem` says as a step of its own after the read, ' +
      'so the count is dropped again, or kept only for some reads',
  )
  assert.deepEqual(
    steps.slice(0, kept).filter(returns).map(code),
    [],
    '`openRegistry` can return before it keeps the count, so for those reads it never does',
  )

  // Said for the run: nothing else in main.ts assigns to it, in any of the forms `writtenBy` knows.
  // Reviews measured writes getting past earlier versions of this: `registryRowsProblem &&= null`
  // and `[registryRowsProblem] = [null]` while it looked for a plain `=` only, and the same through
  // `satisfies` before it looked through that. Not covered: a write in a string run by `eval`, and
  // any change to the problem the variable holds, which assigns no variable: `Object.assign` on it,
  // or a property written through a cast, `(registryRowsProblem as { detail: string }).detail = ''`.
  const sets: string[] = []
  const bindings: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'registryRowsProblem') {
      const write = writtenBy(node)
      if (write) sets.push(code(write))
      // A module-scope `let` is a declaration, in a list, in a statement, in the file.
      const statement = node.parent.parent?.parent
      const where = statement && ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent) ? 'module' : 'inner'
      if (binds(node)) bindings.push(`${where}: ${code(node.parent)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.deepEqual(
    sets,
    ['registryRowsProblem = skippedRowsProblem(WORKSPACE_ROOT, loaded)'],
    'something else in main.ts sets `registryRowsProblem`, so the count can be replaced or cleared during the run',
  )
  // And that assignment is to the variable the snapshot reads. A binding of the same name inside a
  // function would take it there, and the module's would stay `null`.
  assert.deepEqual(
    bindings,
    ['module: registryRowsProblem: Problem | null = null'],
    '`registryRowsProblem` is declared somewhere other than once, at the top of main.ts',
  )
})
