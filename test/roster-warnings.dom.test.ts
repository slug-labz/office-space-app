/**
 * The three warnings a staff row can carry, and the reason they are on the row at all.
 *
 * `roster-view.test.ts` covers `staffRows`, which works out what is wrong with each employee.
 * `roster-actions.dom.test.ts` covers the buttons. Nothing asked whether the panel *draws* what
 * the model worked out -- and a warning computed and not rendered is worse than one never
 * computed, because the code reads as though somebody is being told.
 *
 * ## Why the row and not a diagnostics panel
 *
 *     The call does not fail loudly: the agent reaches, gets nothing, and reports that it could
 *     not do the thing. From the outside that is indistinguishable from the agent being bad at
 *     its job, which is why it belongs on the row for that agent rather than in a diagnostics
 *     panel nobody opens.
 *
 * That is the whole argument. Without the line on the row, a misconfigured employee looks like
 * an incompetent one, and the person watching draws the wrong conclusion about the wrong thing.
 *
 * ## And it has shipped before
 *
 *     The same fault as `dangling` one layer down, and it shipped: `WebFetch` sat in five
 *     agents' tool lists and in neither `allow` nor `deny`, so it was unlisted and refused --
 *     while this panel printed it under all five names. A capability the roster asserts and the
 *     office cannot deliver is standing order 3 broken on the surface built to describe the
 *     staff.
 *
 * The two are deliberately different sentences, because "add it to permissions.allow" and
 * "configure a server called notion" are two different things to go and do.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom, type El } from './dom.js'
import { renderRoster, type RosterHandlers } from '../src/renderer/views/roster.js'
import type { RosterModel } from '../src/shared/roster-view.js'
import type { StaffMember } from '../src/shared/ipc.js'

installDom()

const quiet: RosterHandlers = {
  onHire: () => {},
  onFire: () => {},
  onBench: () => {},
  onUnbench: () => {},
  onAddSkill: () => {},
  onRemoveSkill: () => {},
}

const person = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: 'reviewer',
  name: 'reviewer',
  description: 'Reads changes.',
  tools: ['Read', 'Grep'],
  model: null,
  isManager: false,
  ...over,
})

const all = (n: El): El[] => [n, ...n.children.flatMap(all)]

function draw(over: Partial<RosterModel> = {}): { text: string; warnings: string[] } {
  const host = document.createElement('div')
  const model: RosterModel = {
    staff: [person()],
    staffUnreadable: false,
    benched: [],
    shelf: [],
    skills: [],
    dangling: new Map(),
    unreachable: new Map(),
    ...over,
  }
  renderRoster(host as unknown as HTMLElement, model, quiet)

  const nodes = all(host as unknown as El)
  return {
    text: nodes.map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' '),
    warnings: nodes
      .filter((n) => n.classList.contains('roster__tools--dangling'))
      .map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim()),
  }
}

test('an ordinary employee carries no warnings at all', () => {
  // The control, and it is not decoration: every assertion below is "a warning appeared", which
  // a panel that warns about everybody satisfies while telling nobody anything.
  const r = draw()
  assert.deepEqual(r.warnings, [], 'a correctly configured employee is flagged: ' + JSON.stringify(r.warnings))
})

test('a tool no configured server can answer is named on that person row', () => {
  const r = draw({ dangling: new Map([['reviewer', ['mcp__notion__search']]]) })

  assert.equal(r.warnings.length, 1, 'the dangling tool was computed and never drawn')
  assert.match(r.warnings[0] ?? '', /mcp__notion__search/, 'the warning does not name the tool')
  assert.match(
    r.warnings[0] ?? '',
    /no such server/i,
    'the warning does not say what is wrong, so it reads as a fault in the employee rather than ' +
      'in the workspace configuration',
  )
})

test('a built-in tool the workspace refuses gets a different sentence', () => {
  // "add it to permissions.allow" and "configure a server called notion" are not the same
  // sentence. One warning covering both would send somebody to the wrong file.
  const refused = draw({ unreachable: new Map([['reviewer', ['WebFetch']]]) })
  const missing = draw({ dangling: new Map([['reviewer', ['mcp__notion__search']]]) })

  assert.equal(refused.warnings.length, 1, 'a refused built-in tool is not drawn at all')
  assert.match(refused.warnings[0] ?? '', /WebFetch/, 'the refused tool is not named')
  assert.match(refused.warnings[0] ?? '', /permitted/i, 'the refusal does not say the workspace has not permitted it')

  assert.notEqual(
    refused.warnings[0],
    missing.warnings[0],
    'a refused built-in tool and an unanswerable MCP tool read identically, so the sentence ' +
      'sends somebody to the wrong file to fix it',
  )
})

test('several unreachable tools are listed, not summarised as a count', () => {
  const r = draw({ unreachable: new Map([['reviewer', ['WebFetch', 'WebSearch']]]) })
  assert.match(r.warnings[0] ?? '', /WebFetch/, 'the first tool is missing')
  assert.match(r.warnings[0] ?? '', /WebSearch/, 'the second tool is missing, so the row says less than it knows')
})

test('an agent with no tools line is flagged as inheriting everything', () => {
  // `tools: null` inherits everything the parent has, including the ability to delegate -- which
  // is the first standing order, since only the manager may originate work.
  const r = draw({ staff: [person({ tools: null })] })

  assert.match(
    r.text,
    /inherit/i,
    'an agent whose file has no `tools:` line is drawn the same as one with an explicit list. ' +
      'Omitting it inherits everything the parent has, which lets an employee summon a colleague.',
  )
})

test('a workspace with nobody in it says so rather than drawing an empty panel', () => {
  const r = draw({ staff: [] })
  assert.match(r.text, /Nobody works here yet/i, 'an empty roster renders blank, which reads as a panel that failed')
})

test('a staff directory that will not open is not an office with nobody in it', () => {
  /*
   * Found by opening the panel against a `.claude/agents` at mode 000. Its own banner said
   * "Could not read everything the staff can reach: EACCES: permission denied" while the section
   * underneath said "0 at a desk · Nobody works here yet. Hire somebody and a desk appears for
   * them." Both at once, on the one surface whose entire job is showing who works here.
   *
   * The shelf two fields down has always drawn this distinction — `shelf: null` means "could not
   * be read" and its comment says so. The staff half of the same panel did not.
   */
  const { text } = draw({ staff: [], staffUnreadable: true })
  assert.match(text, /could not be read/)
  assert.match(text, /not the same as nobody working here/)
  assert.doesNotMatch(text, /Nobody works here yet/)
})

test('an office that genuinely has nobody still says so', () => {
  // The other side, and the common one: a new workspace is empty rather than broken, and must
  // not be told it has a permissions problem.
  const { text } = draw({ staff: [], staffUnreadable: false })
  assert.match(text, /Nobody works here yet/)
  assert.doesNotMatch(text, /could not be read/)
})
