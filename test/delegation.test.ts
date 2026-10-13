/**
 * The delegation tool's name, and the four places that used to know it separately.
 *
 * This module exists because they each named it themselves: the lint that enforces "only the
 * manager may delegate" accepted both spellings while the other three hard-coded `Task`. The
 * header is unusually direct about why that combination is the worst available one:
 *
 *     the day the CLI settles on the other name, the lint keeps passing and the floor goes
 *     quiet, so the office carries on looking correct while it has stopped depicting the one
 *     event the whole product is built around. A rename should break everything at once or
 *     nothing at all.
 *
 * Nothing was aimed at it. So the two functions are checked, and so is the property the module
 * was created to establish: that no other file knows the name.
 *
 * ## The launch receipt
 *
 * `run_in_background` defaults to true, so a dispatch's `tool_result` arrives in milliseconds
 * saying the agent was *launched* — not what it found. Reading that as completion is what made
 * the floor walk somebody to their desk and immediately walk them back to report while they were
 * still working.
 *
 * It is string matching, and the module says so rather than hiding it. What makes that
 * acceptable is the direction it fails in, and that is the part worth pinning: an unrecognised
 * launch looks like a fast completion, which is only today's behaviour — but a real answer can
 * never be mistaken for a launch. A test that only checked the happy string would not notice if
 * that ever stopped being true.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

import { isDelegationTool, isAsyncLaunch } from '../src/shared/delegation.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('both spellings are delegation, and nothing else is', () => {
  // Renamed Task -> Agent in the harness; the CLI still emits Task. Both have to work, or the
  // floor stops depicting dispatches on whichever machine is running the other one.
  assert.equal(isDelegationTool('Agent'), true)
  assert.equal(isDelegationTool('Task'), true)

  for (const other of ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'TodoWrite', 'WebFetch', '', 'agent', 'task', 'Tasks', 'AgentTool']) {
    assert.equal(
      isDelegationTool(other),
      false,
      `${JSON.stringify(other)} is treated as a dispatch — the floor would walk somebody to the ` +
        `manager's office for an ordinary tool call`,
    )
  }
})

test('a launch receipt is not an answer', () => {
  assert.equal(isAsyncLaunch('Async agent launched with id abc123'), true)

  // A real subagent answer. None of these may look like a launch, because that is the direction
  // the module says it must never fail in.
  for (const answer of [
    'The test suite passes: 1561 assertions, none failing.',
    'I could not find the file you asked about.',
    'Launched a new process and it returned 0.',
    'The agent finished and reported three findings.',
    '',
  ]) {
    assert.equal(
      isAsyncLaunch(answer),
      false,
      `a real result was read as a launch receipt, so its content would be thrown away: ${JSON.stringify(answer)}`,
    )
  }
})

test('nothing else in the source knows what the delegation tool is called', () => {
  // The property the module was created to establish. Four places used to name it independently,
  // and the failure mode was not that they disagreed — it was that they could disagree silently.
  return (async () => {
    const offenders: string[] = []

    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = []
      for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        const path = `${dir}/${entry.name}`
        if (entry.isDirectory()) out.push(...(await walk(path)))
        else if (entry.name.endsWith('.ts')) out.push(path)
      }
      return out
    }

    const files = await walk('src')
    // The control: a walk that finds nothing passes this test while every file does as it likes.
    assert.ok(files.length > 40, `only ${files.length} source files found — the walk is wrong, not the code`)

    for (const file of files) {
      if (file.endsWith('shared/delegation.ts')) continue
      const source = (await readFile(join(root, file), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
      for (const [index, line] of source.split('\n').entries()) {
        if (line.trimStart().startsWith('//')) continue
        // A comparison against the literal name, in any of the shapes somebody writes one.
        if (/(===|==|!==|!=)\s*['"](Task|Agent)['"]|['"](Task|Agent)['"]\s*(===|==|!==|!=)/.test(line)) {
          offenders.push(`${relative(root, join(root, file))}:${index + 1}  ${line.trim()}`)
        }
        if (/\.(includes|has)\(\s*['"](Task|Agent)['"]\s*\)/.test(line)) {
          offenders.push(`${relative(root, join(root, file))}:${index + 1}  ${line.trim()}`)
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      'these name the delegation tool themselves instead of asking `isDelegationTool`. The day ' +
        'the CLI settles on the other spelling, whichever of these is wrong goes quiet without ' +
        `failing anything:\n  ${offenders.join('\n  ')}`,
    )
  })()
})

test('every caller reaches the name through this module', async () => {
  // The other half of the same property, from the positive side: the four places the header
  // names must actually be asking. A test that only forbids the literal would pass on a codebase
  // that had stopped checking at all.
  const callers = new Set<string>()
  const walk = async (dir: string): Promise<string[]> => {
    const out: string[] = []
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) out.push(...(await walk(path)))
      else if (entry.name.endsWith('.ts')) out.push(path)
    }
    return out
  }

  for (const file of await walk('src')) {
    if (file.endsWith('shared/delegation.ts')) continue
    const source = await readFile(join(root, file), 'utf8')
    if (/\bisDelegationTool\b/.test(source)) callers.add(file)
  }

  assert.ok(
    callers.size >= 4,
    `only ${callers.size} modules ask \`isDelegationTool\`, and the header names four that must: ` +
      `the lint, the choreography, the voice digest and the transcript card. If one has stopped ` +
      `asking, it has either stopped depicting dispatches or gone back to naming the tool ` +
      `itself. Found: ${[...callers].join(', ')}`,
  )
})
