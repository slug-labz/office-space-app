/**
 * What reaches a packaged app from `.claude/`, and what must not.
 *
 * `VISION.md` §7.1: *"Memory and personal data are never pushed. The repo ships the office; the
 * contents stay yours."* The packaging filter is where that promise is kept, and until this
 * change it was a **deny-list** — `'**\/*'` followed by three exceptions. Everything ships;
 * name what does not.
 *
 * ## Why that shape was replaced, measured rather than argued
 *
 * Nothing was leaking. All three exceptions were correct and the five paths that shipped are
 * the office itself. But each of the three was added *after* the path already existed:
 *
 *     84d604b  !settings.local.json  "the first artifact leaked licensed art"
 *     0e79651  !worktrees            "agent worktrees must never ship inside the app"
 *     25157f5  !launch.json          "Our dev harness stopped shipping to strangers"
 *
 * Three for three, each found by a person reading a diff, and the last only after it had
 * shipped in a real artifact. The filter was clean, and the mechanism keeping it clean was
 * somebody remembering. Asked of electron-builder's own matcher before the change, these all
 * shipped: `history.jsonl`, `projects/transcript.jsonl`, `.credentials.json`, and a path
 * invented for the question — none of them exist in this repo, and every one of them is a
 * shape the CLI creates in a `.claude` directory.
 *
 * ## What is asserted, and by whom
 *
 * Every question here is put to **`app-builder-lib`'s own `FileMatcher`**, through
 * `shipsFromClaude`. A test that reimplemented the globbing would agree with itself and with
 * nothing that ships.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// @ts-expect-error — a plain .mjs declaration with no types.
import { shipsFromClaude } from '../scripts/shipped.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ships = shipsFromClaude(root) as (inside: string) => boolean

const tracked = (dir: string): string[] =>
  execFileSync('git', ['ls-files', '-z', '--', dir], { encoding: 'utf8', cwd: root })
    .split('\0')
    .filter(Boolean)

test('the office itself still reaches the package', () => {
  // Teammate 1's warning, and the failure an allow-list invites: too narrow and the app ships
  // without its own agents, which on screen is indistinguishable from an office somebody
  // emptied on purpose. Derived from what is tracked rather than a list written here — a
  // hand-list would be the deny-list's mistake one level up.
  const required = tracked('.claude/agents')
    .concat(tracked('.claude/hooks'), tracked('.claude/skills'), tracked('.claude/commands'), ['.claude/settings.json'])

  assert.ok(required.length > 15, `only ${required.length} required files found — this test is reading nothing`)

  const missing = required.filter((p) => !ships(p.slice('.claude/'.length)))
  assert.deepEqual(missing, [], 'the filter no longer admits files the office needs to run')
})

test('a path nobody anticipated does not ship', () => {
  // The point of the change, expressed as an assertion. Nothing in `package.json`,
  // `shipped.mjs` or this file knows these paths — which is exactly why they are the test.
  const unanticipated = [
    'nobody-thought-of-this/secret.txt',
    'history.jsonl',
    'projects/a-transcript.jsonl',
    '.credentials.json',
    'cache/whatever',
    'plans/private-plan.md',
    'file-history/x.json',
    'todos/list.json',
  ]
  for (const path of unanticipated) {
    assert.equal(ships(path), false, `${path} would reach a packaged app handed to somebody else`)
  }
})

test('the three paths already caught by hand stay caught', () => {
  // Regression cover for the leaks that were found the expensive way. An allow-list excludes
  // these by construction rather than by name, and this proves the construction holds.
  for (const path of ['settings.local.json', 'launch.json', 'worktrees/x/anything.ts']) {
    assert.equal(ships(path), false, `${path} — caught once by a person, must stay caught`)
  }
})

test('the filter is an allow-list, and cannot be re-opened by one line', () => {
  /*
   * The guard that outlives this file's other assertions.
   *
   * A missing file is a loud, ordinary bug: somebody adds a directory to `.claude/`, the app
   * misses it, and the obvious repair is to put `'**\/*'` back. That one line restores the shape
   * this change removed and every assertion above keeps passing, because everything it names
   * would still ship. So the shape itself is asserted, not only its consequences.
   */
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    build?: { extraResources?: { from: string; filter?: string[] }[] }
  }
  const filter = (pkg.build?.extraResources ?? []).find((r) => r.from === '.claude')?.filter
  assert.ok(filter && filter.length > 0, 'the `.claude` resource has no filter — this test went blind')

  assert.deepEqual(
    filter.filter((p) => p === '**/*' || p === '**' || p === '*'),
    [],
    'a catch-all is back in the filter: everything in `.claude/` ships again and the exclusions are guesses',
  )
  assert.deepEqual(
    filter.filter((p) => p.startsWith('!')),
    [],
    'an exclusion means something is being admitted that has to be taken back — name what ships instead',
  )
})
