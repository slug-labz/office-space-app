/**
 * *Who is the manager* is a question about the whole roster, and it has one answer.
 *
 * `findManager` in `main/workspace.ts`: the agent called `manager` if there is one, and otherwise
 * whoever holds a delegation tool. The fallback is the part that matters — a workspace whose
 * manager is called `boss` has a manager, and every rule about delegation is a rule about them.
 *
 * #128 deleted a second copy: `lintEmployee` decided who the manager was with `e.id === 'manager'`
 * while `main.ts` used the fallback, so the office **flagged its own manager** as an employee
 * breaking the delegation rule. The fix was one exported function.
 *
 * `office-space-6c` found a third copy still standing, in the worst possible place. `cli/eval.ts`
 * built the `## CURRENT STAFF` block the eval hands to the model with `isManager: e.id ===
 * 'manager'` — so in a workspace whose manager has any other name, the harness described a staff
 * with **nobody managing it**, gave that to the model, and then judged whether the model had
 * delegated correctly. Every verdict came from a block that mis-described the thing being
 * measured. The comment directly above it said this measures *"the manager the user has"*.
 *
 * So this is a scan rather than a test of behaviour: the behaviour is already covered where the
 * one answer lives, and what keeps going wrong is somebody writing the easy version again.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  )
}

/**
 * The one place the name is compared, and the one documented exception.
 *
 * `roster-view.ts` compares the id for the **bench**, and its own comment is explicit about how
 * narrow that is: a benched agent has no `isManager` in the snapshot because their frontmatter is
 * not read, so the comparison keeps the shipped name off the bench's delete button and covers
 * nothing else. `boss.md.off` is not covered and the comment says so. That is a different
 * question — who is running the office — from the one `findManager` answers.
 */
const ALLOWED = new Map<string, string>([
  ['src/main/workspace.ts', 'findManager itself, which is the one answer'],
  ['src/shared/roster-view.ts', 'the bench, where nobody has an isManager to consult — see the comment there'],
])

test('nothing decides who the manager is by comparing the name', () => {
  const offenders: string[] = []
  let scanned = 0

  for (const file of sources(join(repo, 'src'))) {
    const path = relative(repo, file)
    const text = readFileSync(file, 'utf8')
    scanned += 1
    // Comments are stripped, because this file and `eval.ts` both now *discuss* the comparison at
    // length. A scan that read prose would report every explanation of the bug as the bug.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (!/===\s*'manager'|'manager'\s*===|===\s*MANAGER_ID/.test(code)) continue
    if (ALLOWED.has(path)) continue
    offenders.push(path)
  }

  // The instrument. A scan that walked nothing reports a clean bill about nothing, and this one
  // reads a directory rather than a list.
  assert.ok(scanned > 40, `only ${scanned} source files scanned — this is not reading src/`)

  assert.deepEqual(
    offenders,
    [],
    'these decide who the manager is by comparing the id to "manager". A workspace whose manager ' +
      'is called anything else then has no manager as far as this code is concerned. Use ' +
      '`findManager` from main/workspace.ts, which falls back to whoever holds a delegation tool.',
  )
})

test('every exception on the list is still a file that exists and still needs one', () => {
  // An allowlist decays in two directions. A path that has moved leaves a permanent hole; a file
  // that no longer makes the comparison leaves an excuse standing over nothing, which reads as
  // considered and is not.
  const stale: string[] = []
  for (const [path] of ALLOWED) {
    let text: string
    try {
      text = readFileSync(join(repo, path), 'utf8')
    } catch {
      stale.push(`${path} — no such file, so the exception covers nothing`)
      continue
    }
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (!/===\s*'manager'|'manager'\s*===|===\s*MANAGER_ID/.test(code)) {
      stale.push(`${path} — no longer compares the name, so delete the line`)
    }
  }
  assert.deepEqual(stale, [])
})
