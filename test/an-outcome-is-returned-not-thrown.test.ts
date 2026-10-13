/**
 * A handler that answers with an outcome answers with one, including when it throws.
 *
 * `RosterOutcome` is `{ ok: true, office } | { ok: false, reason }` — a union whose whole purpose
 * is carrying a failure to a panel that can explain it. Seven handlers returned one and let a
 * **throw** escape as a rejected `invoke`.
 *
 * Found by construction rather than by sweeping. With `.office-space/` made read-only and a
 * conversation closed, the app said:
 *
 *     Something in the office went wrong: EACCES: permission denied, open '…'
 *
 * — the generic renderer-wide notice added earlier on this branch, on a call that had a field for
 * exactly this and did not use it. Before that surface existed it said nothing at all.
 *
 * `office-space-6c` named this class and I deferred it as a sweep. It turned out not to need one:
 * the interesting set is the handlers whose *return type* already admits failure, and there are
 * seven.
 *
 * ## Why a scan rather than seven tests
 *
 * The failure is a handler being written without the wrapper, which is a thing about the source
 * rather than about behaviour — and the next one will be added by somebody who has not read this
 * file. A test per handler would cover today's seven and none of tomorrow's.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const main = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'main.ts'),
  'utf8',
)

/** The body of `ipcMain.handle(CHANNEL.x, …)`, brace-matched rather than guessed at. */
function handlers(): { channel: string; returns: string; body: string }[] {
  const found: { channel: string; returns: string; body: string }[] = []
  const pattern = /ipcMain\.handle\(\s*CHANNEL\.(\w+)\s*,\s*(?:async\s*)?\([^)]*\)\s*:\s*Promise<(\w+)>\s*=>\s*\{/g

  for (const m of main.matchAll(pattern)) {
    const open = main.indexOf('{', m.index + m[0].length - 1)
    let depth = 0
    for (let j = open; j < main.length; j += 1) {
      if (main[j] === '{') depth += 1
      else if (main[j] === '}') {
        depth -= 1
        if (depth === 0) {
          // \`m[2]\`: the \`async\` group is non-capturing, so the return type is the second
          // capture and not the third. It was the third, and the guard below caught it — reporting
          // that no handler returns an outcome union, on a file where seven do.
          found.push({ channel: m[1] ?? '', returns: m[2] ?? '', body: main.slice(open, j + 1) })
          break
        }
      }
    }
  }
  return found
}

test('the scan finds handlers at all, or it is a clean bill on nothing', () => {
  /**
   * The guard first — every assertion below is a filter over this list, and an empty list
   * satisfies all of them for the wrong reason.
   *
   * **It counts annotated handlers only.** The pattern requires `: Promise<X> =>`, so it sees
   * the seventeen that declare a return type and not the thirty that infer one. That is the
   * right scope rather than a limitation: this file is about handlers whose *declared* type
   * admits failure, and a handler with no annotation has not declared anything. Said here so the
   * floor below is read as calibration and not as an arbitrary number.
   */
  const all = handlers()
  assert.ok(
    all.length >= 12,
    `only ${all.length} annotated handlers found — the pattern has stopped matching, rather than ` +
      `the handlers having gone`,
  )
  assert.ok(
    all.some((h) => h.returns.endsWith('Outcome')),
    'no handler returns an outcome union, so this file is about nothing',
  )
})

test('every handler that answers with an outcome catches its own failures', () => {
  const raw = handlers()
    .filter((h) => h.returns.endsWith('Outcome'))
    // `outcomeOf` is the wrapper; `rosterOp` goes through it, so either is enough.
    .filter((h) => !/outcomeOf\(|rosterOp\(/.test(h.body))
    .map((h) => h.channel)

  assert.deepEqual(
    raw,
    [],
    'these return a union with a `reason` field and let a throw escape instead of filling it in. ' +
      'The renderer then shows the generic "something went wrong" notice rather than what could ' +
      'not be done — on a call that already had somewhere to put the answer.',
  )
})

test('and the wrapper it routes through actually catches', () => {
  // The half a name cannot promise. `rosterOp` converted an *expected* failure — the union its
  // callee returns — and let a throw through for a year; the scan above would have called it
  // guarded on the strength of the call alone.
  const at = main.indexOf('const outcomeOf =')
  assert.ok(at > 0, '`outcomeOf` has been renamed, so the check above is asserting a spelling')

  const body = main.slice(at, main.indexOf('\n  }', at))
  assert.match(body, /try\s*\{/, '`outcomeOf` does not catch anything')
  assert.match(body, /ok:\s*false/, '`outcomeOf` catches and does not turn it into an outcome')
})
