/**
 * Does every file a dispatch writes actually resolve to that dispatch?
 *
 * `changesFor` joins a write to its dispatch through `parent_tool_use_id`, and the join is exact
 * — at **depth 1**. A subagent that spawned its own subagent would put the grandchild's writes
 * under the *child's* tool-use id, which resolves to no dispatch. That does not throw. It
 * attributes the file to nothing, and a change view showing three files for a dispatch that
 * touched seven looks exactly as complete as one that really touched three.
 *
 * Nothing in this repo prevents that. The prohibition lives in `.claude/agents/manager.md` as
 * prompt text, and `session/mode.ts` withholds `Task` only in **intake** mode — the mode where
 * dispatch cannot happen anyway. In the mode where it can, `Task` is present by construction.
 * Whether a subagent receives `Task` is decided by the CLI, so depth 1 is a behaviour this
 * repo *inherits*, not an invariant it holds.
 *
 * This test is what turns that inheritance into something that speaks up. It passes today. The
 * day the CLI hands subagents a spawning tool, it fails and says which call broke the assumption
 * — rather than the change view quietly getting shorter.
 *
 * The fixture is **real CLI output**, captured from a live dispatch, not typed here. That is
 * deliberate: a hand-written fixture is a record of what somebody believed the CLI emits, and
 * this repo has already paid for that once — `stream.ts` parsed a top-level `utilization` that
 * has never existed, so every branch downstream of it was unreachable on every run.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { changesFor, type ToolCall } from '../src/shared/changes.js'

/** Tools that put bytes on disk. `Read` is in the capture too and must not count as a write. */
const WRITES = new Set(['Edit', 'Write', 'NotebookEdit'])
/** Tools that start a dispatch. */
const SPAWNS = new Set(['Agent', 'Task'])

interface Use {
  readonly name: string
  readonly id: string
  readonly parent: string | null
  readonly input: Record<string, unknown>
}

function uses(): Use[] {
  const raw = readFileSync(new URL('./fixtures/dispatch-stream.ndjson', import.meta.url), 'utf8')
  const found: Use[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const event = JSON.parse(line) as {
      type?: string
      parent_tool_use_id?: string | null
      message?: { content?: { type?: string; name?: string; id?: string; input?: Record<string, unknown> }[] }
    }
    if (event.type !== 'assistant') continue
    for (const block of event.message?.content ?? []) {
      if (block.type !== 'tool_use' || !block.id || !block.name) continue
      found.push({
        name: block.name,
        id: block.id,
        parent: event.parent_tool_use_id ?? null,
        input: block.input ?? {},
      })
    }
  }
  return found
}

test('the capture holds the shapes this test claims to check', () => {
  // The instrument first. Every assertion below is a filter, and a filter over an empty list
  // passes loudly — which is the failure mode this whole file exists to catch elsewhere.
  const all = uses()
  assert.ok(all.length >= 4, `only ${all.length} tool uses in the capture — the parse moved`)

  const spawns = all.filter((u) => SPAWNS.has(u.name))
  const writes = all.filter((u) => WRITES.has(u.name))
  assert.equal(spawns.length, 1, 'the capture should hold exactly one dispatch')
  assert.ok(writes.length >= 2, `only ${writes.length} writes — nothing to attribute`)

  // And specifically an **edit in place**, not only file creation. `Write` carries `content`;
  // `Edit` carries `old_string`/`new_string`, and it is the path with the harder join because
  // the file already existed. Asserting it here is what stops this fixture being quietly
  // replaced by one that only creates.
  const edits = writes.filter((u) => 'old_string' in u.input && 'new_string' in u.input)
  assert.ok(edits.length >= 1, 'the capture holds no edit-in-place — only creation is covered')
})

test('no dispatch was started by another dispatch', () => {
  // Depth 2 forming, caught before any file is written by it. This fires the moment a subagent
  // spawns a subagent, which is earlier and clearer than noticing an orphaned write afterwards.
  const nested = uses().filter((u) => SPAWNS.has(u.name) && u.parent !== null)
  assert.deepEqual(
    nested.map((u) => `${u.name}#${u.id} under ${u.parent}`),
    [],
    'a dispatch was spawned from inside another dispatch — the parent-id join no longer reaches the top',
  )
})

test('every written file resolves to a dispatch the run started', () => {
  const all = uses()
  const dispatches = new Set(all.filter((u) => SPAWNS.has(u.name) && u.parent === null).map((u) => u.id))
  assert.ok(dispatches.size > 0, 'no top-level dispatch found — there is nothing to resolve against')

  for (const write of all.filter((u) => WRITES.has(u.name))) {
    assert.ok(
      write.parent !== null && dispatches.has(write.parent),
      `${write.name} on ${String(write.input['file_path'])} has parent ${String(write.parent)}, ` +
        `which is not a dispatch this run started`,
    )
  }
})

test('and the join agrees, end to end, with nothing unattributed', () => {
  // The same question asked through the code that ships, rather than through this file's own
  // reading of the capture. If `changesFor` ever disagrees with the assertions above, one of
  // the two is wrong and this says so.
  const all = uses()
  const dispatch = all.find((u) => SPAWNS.has(u.name) && u.parent === null)
  assert.ok(dispatch, 'no dispatch in the capture')

  const calls: ToolCall[] = all
    .filter((u) => !SPAWNS.has(u.name))
    .map((u) => ({ name: u.name, input: u.input, parent: u.parent }))

  const result = changesFor(calls, dispatch.id, new Set([dispatch.id]))
  assert.equal(result.unattributed, 0, 'a real dispatch produced writes belonging to nobody')
  assert.ok(result.changes.length >= 2, `the join found ${result.changes.length} changes in a capture with at least two`)
})
