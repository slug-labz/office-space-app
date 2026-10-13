/**
 * A card somebody has answered stays off the strip.
 *
 * While its decision is being written, that holds whatever main pushes. After that, it holds while
 * main's pushes arrive in order. `Held` in `approval-decision.ts` says what an older list arriving
 * late still does, and why that is main's half to fix.
 *
 * Main pushes the held calls whose request files are on disk, and a request stays on disk until
 * the gate reads its verdict. So a call just answered is still in main's list for a while: while
 * its verdict is being written, and after that until the gate's next poll deletes the request.
 * `app.ts` took the card off when it was pressed and then assigned every push whole, so a push in
 * either window put the answered card back up. A card that is up can be pressed again, and the
 * doc on `decide` promised that a second press could not land on a decision already in flight.
 *
 * Measured in the dev harness on 2026-09-16, on dev at `cc63256`, with the real renderer:
 *
 *     a push while the verdict was being written   the answered card came back
 *     a push after it was written, before cleanup  the answered card came back beside a new one
 *     a failed write, with a push during it        the call that arrived was dropped
 *     a failed write, the call let go meanwhile    the answered card came back, the new one did not
 *
 * The last two are the same assignment in the other direction: a failure put back the list saved
 * at the press, and main pushes only when the set of held calls changes, so nothing corrected it.
 *
 * `app.ts` cannot be loaded by a test, so the rule is in `approval-decision.ts`, and these tests
 * walk the renderer's own sequence through it: a push, a press, a decision settling. The last test
 * checks that `app.ts` still draws its cards from there.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import {
  NOTHING_HELD,
  afterDecision,
  afterPress,
  afterPush,
  cardsFrom,
  type Held,
} from '../src/shared/approval-decision.js'
import type { PendingApproval } from '../src/shared/ipc.js'

const call = (toolUseId: string, sessionId = 's-1'): PendingApproval => ({
  sessionId,
  project: null,
  toolUseId,
  tool: 'Bash',
  input: { command: `echo ${toolUseId}` },
  askedAt: '2026-09-16T10:00:00Z',
  waitMs: 240_000,
  agent: null,
})

/** The cards drawn, by the gate's own key, in any order. */
const cards = (held: Held) => cardsFrom(held).map((a) => `${a.sessionId}.${a.toolUseId}`).sort()

/** What `decided` says about a verdict that reached disk, and about one that did not. */
const WRITTEN = { restore: false }
const FAILED = { restore: true }

test('a push while a decision is being written does not put its card back', () => {
  const answered = call('answered')

  let held = afterPush(NOTHING_HELD, [answered])
  held = afterPress(held, answered)
  assert.deepEqual(cards(held), [], 'the card stayed up after it was pressed')

  // The verdict is not on disk yet, so main still lists the call.
  held = afterPush(held, [answered])
  assert.deepEqual(cards(held), [], 'a push put a card back while its decision was being written')
})

test('a push after the decision was written does not put its card back either', () => {
  const answered = call('answered')
  const arrived = call('arrived')

  let held = afterPush(NOTHING_HELD, [answered])
  held = afterDecision(afterPress(held, answered), answered, WRITTEN)

  // Before the gate's next poll deletes the request, another call arrives, and main lists both.
  held = afterPush(held, [answered, arrived])
  assert.deepEqual(cards(held), ['s-1.arrived'], 'a call already answered came back')
})

test('an answered call is forgotten once main stops listing it', () => {
  const answered = call('answered')
  const arrived = call('arrived')

  let held = afterPush(NOTHING_HELD, [answered])
  held = afterDecision(afterPress(held, answered), answered, WRITTEN)
  held = afterPush(held, [arrived])

  assert.deepEqual(cards(held), ['s-1.arrived'])
  assert.equal(held.written.size, 0, 'a call main no longer lists is still remembered')
  assert.equal(held.writing.size, 0, 'a decision that settled is still marked as being written')
})

test('a failed decision puts its card back while main still lists the call', () => {
  const answered = call('answered')
  const other = call('other')

  let held = afterPush(NOTHING_HELD, [answered, other])
  held = afterPress(held, answered)
  assert.deepEqual(cards(held), ['s-1.other'])

  held = afterDecision(held, answered, FAILED)
  assert.deepEqual(
    cards(held),
    ['s-1.answered', 's-1.other'],
    'the card whose decision failed did not come back, so the call can only time out',
  )
})

test('a call that arrived while a decision was failing is still on the strip', () => {
  const answered = call('answered')
  const arrived = call('arrived')

  let held = afterPress(afterPush(NOTHING_HELD, [answered]), answered)
  // No verdict reached disk, so main still lists the answered call beside the new one.
  held = afterPush(held, [answered, arrived])
  held = afterDecision(held, answered, FAILED)

  assert.deepEqual(
    cards(held),
    ['s-1.answered', 's-1.arrived'],
    'the failure put back the list from before the press, and the call that arrived since went ' +
      'with it: main will not send it again until the set changes, and the gate refuses it unseen',
  )
})

test('a call the gate let go of while its decision was failing does not come back', () => {
  // A push that leaves the call out means the gate has let go of it: refused on its timeout,
  // handed back, or deleted with the store. A card put back then is one nobody can answer.
  const gone = call('gone')
  const kept = call('kept')

  let held = afterPress(afterPush(NOTHING_HELD, [gone]), gone)
  held = afterPush(held, [kept])
  held = afterDecision(held, gone, FAILED)

  assert.deepEqual(cards(held), ['s-1.kept'], 'a card came back for a call nothing is waiting on')
})

test('two decisions written at once each stay down, and each settles on its own', () => {
  for (const [fails, lands] of [['a', 'b'], ['b', 'a']] as const) {
    const pressed = { a: call('a'), b: call('b') }

    let held = afterPush(NOTHING_HELD, [pressed.a, pressed.b])
    held = afterPress(afterPress(held, pressed.a), pressed.b)
    assert.deepEqual(cards(held), [])

    held = afterDecision(held, pressed[fails], FAILED)
    const back = `a failed ${fails} brought back a card still being written`
    assert.deepEqual(cards(held), [`s-1.${fails}`], back)

    held = afterDecision(held, pressed[lands], WRITTEN)
    const kept = `${lands} landed and a card changed that should not have`
    assert.deepEqual(cards(held), [`s-1.${fails}`], kept)
    assert.equal(held.writing.size, 0, 'a settled decision is still marked as being written')
  }
})

test('a card being written stays down if a push drops the call and a later one lists it', () => {
  // Pushes can arrive out of order. Whatever they say, a decision in flight keeps its card down
  // until it settles.
  const answered = call('answered')

  let held = afterPress(afterPush(NOTHING_HELD, [answered]), answered)
  held = afterPush(held, [])
  held = afterPush(held, [answered])

  assert.deepEqual(cards(held), [], 'a card came back while its decision was still being written')
})

test('a call is the session and the tool-use id together, as the gate names it', () => {
  // The verdict file is `<sessionId>.<toolUseId>`, and so is the watcher's key. The card came off
  // by tool-use id alone, which takes another conversation's card with it.
  const mine = call('t-1', 's-1')
  const theirs = call('t-1', 's-2')

  const held = afterPress(afterPush(NOTHING_HELD, [mine, theirs]), mine)

  assert.deepEqual(cards(held), ['s-2.t-1'], "answering one conversation's call hid another's")
})

test('app.ts draws its cards only from what it holds, moved on from its value now', async () => {
  /*
   * A source-level check, and it says so: `app.ts` reaches for `window` at load, so no test can
   * load it. The bug was two assignments — each push assigned whole, and a failure assigned a
   * list saved at the press — and either one written back would leave every test above green.
   *
   * Review found four more ways to bring it back that the first version of this check let
   * through, and each fails here now:
   * - settling against a `held` saved before the write's `await`;
   * - `hold` not storing what it is given;
   * - a push starting from `NOTHING_HELD` instead of from what is held;
   * - taking the card off only after the write.
   *
   * It also checks that the press settles in a `finally`. A press that never settles keeps its
   * card down for good.
   *
   * Parsed rather than grepped, so a comment is not code. It reads names, not bindings, so a
   * second declaration of `held` is refused rather than resolved.
   */
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'app.ts')
  const text = await readFile(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)

  const steps = new Set(['afterPush', 'afterPress', 'afterDecision'])
  const writes: { readonly line: number; readonly from: string }[] = []
  const notFromHeld: string[] = []
  let throughPush = 0
  let heldDeclared = 0
  const named = (name: string) => {
    const found: ts.FunctionDeclaration[] = []
    const look = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node)
      ts.forEachChild(node, look)
    }
    look(source)
    return found
  }
  const calls = (node: ts.Node, name: string): boolean =>
    (ts.isCallExpression(node) && node.expression.getText(source) === name) ||
    (ts.forEachChild(node, (child) => calls(child, name) || undefined) ?? false)
  const visit = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'held'
    ) {
      heldDeclared += 1
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === 'approvals'
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
      writes.push({ line: line + 1, from: node.right.getText(source) })
    }
    const step =
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      steps.has(node.expression.text)
    if (step && ts.isCallExpression(node)) {
      const [first] = node.arguments
      const fromHeld = first !== undefined && ts.isIdentifier(first) && first.text === 'held'
      if (!fromHeld) notFromHeld.push(node.getText(source))
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'office.onApprovals') {
      if (node.arguments.some((argument) => calls(argument, 'afterPush'))) throughPush += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  assert.ok(writes.length > 0, 'app.ts no longer assigns `approvals`; rewrite this check')
  assert.deepEqual(
    writes.filter((w) => !w.from.startsWith('cardsFrom(')),
    [],
    'app.ts sets its cards from something other than what it holds',
  )
  assert.equal(throughPush, 1, 'a push from main no longer goes through afterPush')
  assert.deepEqual(notFromHeld, [], 'a step starts from something other than what is held now')
  assert.equal(heldDeclared, 1, 'a second `held` can stand in for the one the cards are drawn from')

  const [keeper] = named('hold')
  assert.ok(keeper, 'app.ts no longer declares hold(); rewrite this check')
  const stores = (node: ts.Node): boolean =>
    (ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === 'held') ||
    (ts.forEachChild(node, (child) => stores(child) || undefined) ?? false)
  assert.ok(stores(keeper), 'hold() no longer stores what it is given')

  // A press, both ways it can end. Without `afterDecision` a failed card never comes back, and a
  // written one is forgotten by the next push that still lists it.
  const [pressing] = named('decide')
  assert.ok(pressing?.body, 'app.ts no longer declares decide(); rewrite this check')
  const order: string[] = []
  const settles: ts.Block[] = []
  const walk = (node: ts.Node): void => {
    if (ts.isAwaitExpression(node)) order.push('await')
    const pressed = ts.isCallExpression(node) && node.expression.getText(source) === 'afterPress'
    if (pressed) order.push('press')
    if (ts.isTryStatement(node) && node.finallyBlock && calls(node.finallyBlock, 'afterDecision')) {
      settles.push(node.finallyBlock)
    }
    ts.forEachChild(node, walk)
  }
  walk(pressing.body)
  assert.equal(order[0], 'press', `decide() takes the card off only after: ${order.join(', ')}`)
  assert.equal(settles.length, 1, 'decide() no longer settles its press in a finally')
})
