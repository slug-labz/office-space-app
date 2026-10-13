/**
 * A capability nothing in the renderer asks for.
 *
 * `the-bridge-has-two-ends.test.ts` covers channel against handler, in both directions, and says
 * clearly what it cannot cover. This is the gap it leaves, and it is the exact fault this
 * repository has already shipped twice.
 *
 * ## Why the bridge test does not catch it
 *
 * That file's `invoked` set is *the channels invoked in `preload.ts`* — and preload is
 * `const api: OfficeApi = { … }`, which the compiler forces to be complete. So every method is
 * always in that set, and its "every handler in main is reachable from the renderer" is a
 * statement about preload rather than about the renderer. It is a true and useful assertion; it
 * is not this one.
 *
 * What is missing is a call site. A feature can have all of this and still not exist:
 *
 *     a declaration in OfficeApi          the compiler is satisfied
 *     a method in preload                 the compiler is satisfied
 *     a handler in main                   the bridge test is satisfied
 *     tests over the module behind it     the test-aim check is satisfied
 *     nothing that calls office.thing()   nobody can reach it
 *
 * ## What this shape has cost here already
 *
 * `capabilitiesOf` — the MCP and per-agent tool survey, 475 tested lines — had a handler in main
 * and no caller in the renderer. `app.ts` still carries the note: *"the exact fault the completion
 * plan opened with about this module"*, and *"found by auditing for IPC methods nothing calls"*.
 * That audit was a person reading, once. `capabilities.ts` also records that wiring it in for the
 * *servers* left the per-agent half orphaned a second time — the same fault, in the same module,
 * found again by hand.
 *
 * A hand audit finds it once. This finds it every run.
 *
 * ## What it deliberately does not decide
 *
 * Whether a caller is *reached* — a method called only from a branch nothing takes is still an
 * orphan in every sense that matters, and no static check can tell. `no-dead-controls.dom.test.ts`
 * covers the part of that which is checkable. This one asks the narrower question, and answers it
 * exactly.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * `mock.ts` *implements* the API rather than calling it.
 *
 * Excluded deliberately, and this is the one exclusion that matters: leaving it in makes every
 * method look called, because the mock has to define all of them for the same compiler reason
 * preload does. The check would then be green forever — which is worse than absent, since the
 * file's name promises otherwise.
 */
const IMPLEMENTS_RATHER_THAN_CALLS = 'mock.ts'

async function sources(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(join(repo, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await sources(path)))
    else if (entry.name.endsWith('.ts') && entry.name !== IMPLEMENTS_RATHER_THAN_CALLS) out.push(path)
  }
  return out
}

/** The method names on `OfficeApi`, read from the declaration rather than a list kept beside it. */
async function declaredMethods(): Promise<readonly string[]> {
  const ipc = await readFile(join(repo, 'src/shared/ipc.ts'), 'utf8')
  const start = ipc.indexOf('export interface OfficeApi')
  assert.notEqual(start, -1, 'OfficeApi moved; this scan is reading nothing')
  const end = ipc.indexOf('\n}\n', start)
  assert.notEqual(end, -1, 'OfficeApi has no closing brace where this expects one')
  return [...ipc.slice(start, end).matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\s*\(/gm)].map((m) => m[1] as string)
}

const methods = await declaredMethods()
const rendererFiles = await sources('src/renderer')
const renderer = (
  await Promise.all(rendererFiles.map((f) => readFile(join(repo, f), 'utf8')))
).join('\n')

/*
 * The guard the rest of the file is worthless without.
 *
 * Every assertion below is "this list is empty". A scan that read no methods, or no renderer, is
 * empty for the wrong reason and passes exactly as loudly as a correct one.
 */
test('the scan found the API and the renderer, or every result below is a clean bill on nothing', () => {
  assert.ok(methods.length > 40, `only ${methods.length} methods found on OfficeApi`)
  assert.ok(rendererFiles.length > 10, `only ${rendererFiles.length} renderer files found`)
  assert.ok(renderer.length > 50_000, 'the renderer source read too small to be the renderer')
  assert.equal(new Set(methods).size, methods.length, 'a duplicate name would hide one of the pair')
})

test('every method on OfficeApi is called by something in the renderer', () => {
  const orphans = methods.filter(
    (name) => !new RegExp(`\\boffice\\s*\\n?\\s*\\.\\s*${name}\\s*\\(`).test(renderer),
  )
  assert.deepEqual(
    orphans,
    [],
    'nothing in the renderer calls these, so the feature behind each one is unreachable however ' +
      'complete it looks: the declaration compiles, preload implements it, main answers it, and ' +
      'no control asks. This is how capabilitiesOf shipped — twice. Wire it to a surface, or ' +
      'take it out; a capability nobody can invoke is not a smaller feature, it is an absent one.',
  )
})

/*
 * The other end of the same idea.
 *
 * A renderer that calls `office.somethingElse()` would fail to compile, so this cannot find a
 * typo — what it can find is a call written against a method that was since renamed *in a
 * comment or a string*, which is where the compiler stops looking.
 */
test('the renderer does not name a capability that no longer exists', () => {
  const called = [...renderer.matchAll(/\boffice\s*\n?\s*\.\s*([a-zA-Z][a-zA-Z0-9]*)\s*\(/g)].map(
    (m) => m[1] as string,
  )
  const unknown = [...new Set(called)].filter((name) => !methods.includes(name))
  assert.deepEqual(unknown, [], 'the renderer calls these on `office` and OfficeApi does not declare them')
})
