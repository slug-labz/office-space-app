/**
 * A tool an agent is told it has, and cannot use.
 *
 * This shipped. `WebFetch` and `WebSearch` were in the tools of five agents and in neither
 * `allow` nor `deny`, so both were *unlisted* — and under `--print` there is no human to ask, so
 * both were refused. The roster printed them under five names anyway. It was found by pasting
 * a link, which is the sixth time in two days that operating the software found what testing it
 * did not.
 *
 * The general shape is the one this repository keeps meeting: **something declared in one place
 * and unreachable from another, where every layer is individually correct.** `capabilities.ts`
 * already had the MCP half of it — `mcp__foo__bar` with no server called `foo` — and built-in
 * tools were never compared to permissions at all.
 *
 * The interesting design problem is that "permitted" is not simply "in the allow list". Most
 * built-in tools need no entry. So the check reports **unknown** rather than fine for anything
 * nobody has classified, because a tool nobody has checked is the exact thing that produced this.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { toolsWithoutPermission, type StaffCapability } from '../src/main/capabilities.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const member = (id: string, tools: readonly string[]): StaffCapability => ({
  id,
  name: id,
  tools: { state: 'declared', tools },
  filePath: `.claude/agents/${id}.md`,
})

test('a tool that needs an entry and has none is reported', () => {
  const found = toolsWithoutPermission([member('reviewer', ['Read', 'WebFetch'])], ['Bash(npm test:*)'])
  assert.deepEqual(
    found.map((f) => `${f.employee}:${f.tool}`),
    ['reviewer:WebFetch'],
    'Read needs no entry and WebFetch does — only the second is unreachable',
  )
})

test('an entry with an argument pattern still permits the tool', () => {
  // `Bash(npm test:*)` permits Bash. A check that only matched bare names would report every
  // agent in this workspace as unable to run a command, which is both false and unusable.
  assert.deepEqual(toolsWithoutPermission([member('tester', ['Bash'])], ['Bash(npm test:*)']), [])
})

test('MCP tools are left to the sibling check, which fails for a different reason', () => {
  // `mcp__notion__search` is unreachable when nothing declares a *server* called notion — a
  // different question from permissions, with a different fix, reported on the same row.
  assert.deepEqual(toolsWithoutPermission([member('backend', ['mcp__notion__search'])], []), [])
})

test('an agent that inherits every tool claims nothing specific, so nothing can dangle', () => {
  const inherits: StaffCapability = {
    id: 'loose',
    name: 'loose',
    tools: { state: 'inherited' },
    filePath: '.claude/agents/loose.md',
  }
  assert.deepEqual(toolsWithoutPermission([inherits], []), [])
})

/**
 * The regression, stated as itself.
 *
 * If somebody removes the web tools from `allow` again, this fails and names the five agents it
 * would break — rather than the app printing a capability under their names and a person finding
 * out by pasting a link.
 */
test('the shipped workspace has no agent claiming a tool it cannot use', () => {
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8')) as {
    permissions: { allow: string[] }
  }

  const staff: StaffCapability[] = []
  for (const file of ['manager', 'backend', 'builder', 'frontend', 'reviewer', 'tester', 'memory-keeper']) {
    const head = readFileSync(join(root, `.claude/agents/${file}.md`), 'utf8').slice(0, 1500)
    const line = /^tools:\s*(.+)$/m.exec(head)
    if (!line) continue
    staff.push(member(file, line[1]!.split(',').map((t) => t.trim())))
  }
  assert.ok(staff.length >= 7, `only parsed ${staff.length} agents; the frontmatter scan has drifted`)

  const unreachable = toolsWithoutPermission(staff, settings.permissions.allow)
  assert.deepEqual(
    unreachable.map((u) => `${u.employee} → ${u.tool}`),
    [],
    'these agents are told they have a tool this workspace will refuse. Either add it to ' +
      'permissions.allow, take it out of their tools list, or — if it genuinely needs no entry ' +
      'and you have measured that — add it to NEEDS_NO_ENTRY with the date you measured it.',
  )
})
