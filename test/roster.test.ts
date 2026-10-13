/**
 * Hiring, firing, and sending somebody home.
 *
 * The property every test here defends: **the filesystem stays the source of truth.** These
 * functions write the files a person writes by hand, so `discoverWorkspace()` finds what we
 * wrote exactly as it finds what somebody typed. A parallel list beside a directory the user
 * edits is how the office ends up drawing a desk for somebody who is not there.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { agentFile, disable, disabled, enable, fire, hire, isValidAgentId, whyInvalid } from '../src/main/roster.js'
import { discoverWorkspace } from '../src/main/workspace.js'

import { tempDir } from './temp-dir.js'

/**
 * One level down inside the test's own temp dir, because the climbing test below plants a
 * bystander file in the workspace's parent. With the workspace at the top of the temp dir, that
 * parent was the shared temp dir, and every run left a `bystander-<pid>.md` there.
 */
async function workspace(t: TestContext): Promise<string> {
  const root = join(await tempDir(t, 'office-roster-'), 'office')
  await mkdir(join(root, '.claude', 'agents'), { recursive: true })
  return root
}

/** The refusal, or '' when it worked. `RosterResult` is a union and `reason` is only on one arm. */
const why = (r: Awaited<ReturnType<typeof hire>>): string => (r.ok ? '' : r.reason)

const ariel = {
  id: 'ariel',
  description: 'Reviews PRs the way a senior engineer would.',
  tools: ['Read', 'Grep'],
  model: 'opus',
  prompt: 'You review code. You do not change it.',
}

test('THE PROPERTY: a hire is discovered exactly as a hand-written file is', async (t) => {
  // The whole design in one assertion. If this ever fails, something has started keeping a
  // second list, and the floor will eventually show somebody who is not there.
  const root = await workspace(t)
  assert.equal((await hire(root, ariel)).ok, true)

  const found = await discoverWorkspace(root)
  const employee = found.employees.find((e) => e.id === 'ariel')

  assert.ok(employee, 'discovery did not see the agent we just wrote')
  assert.equal(employee.description, 'Reviews PRs the way a senior engineer would.')
  assert.deepEqual(employee.tools, ['Read', 'Grep'])
  // Parse problems specifically, which is what this test is about — the assertion message has
  // always said so. `found.problems` also carries lint findings about the *set*, and a workspace
  // holding one agent who cannot delegate now reports `no-manager`, correctly: it cannot dispatch
  // anything. That is a true statement about this fixture and nothing to do with whether the file
  // we wrote parses.
  assert.deepEqual(
    found.problems.filter((p) => p.kind !== 'lint'),
    [],
    'the file we wrote produced a parse problem',
  )
})

test('omitting tools means inheriting, so the field is absent rather than empty', async (t) => {
  // `tools:` with nothing after it means "no tools", which is the opposite of what null means.
  const text = agentFile({ ...ariel, tools: null })
  assert.ok(!text.includes('tools:'), 'wrote an empty tools field, which means "none"')

  const root = await workspace(t)
  await hire(root, { ...ariel, tools: null })
  const employee = (await discoverWorkspace(root)).employees.find((e) => e.id === 'ariel')
  assert.equal(employee?.tools, null, 'discovery read it as something other than inheritance')
})

test('hiring never overwrites somebody who already exists', async (t) => {
  // Almost always a typo or two people adding the same name, and replacing an agent file
  // somebody wrote is not a recoverable kind of wrong.
  const root = await workspace(t)
  await hire(root, ariel)
  const second = await hire(root, { ...ariel, prompt: 'Something else entirely.' })

  assert.equal(second.ok, false)
  assert.match(second.ok === false ? second.reason : '', /already an agent called ariel/)
  assert.match(await readFile(join(root, '.claude', 'agents', 'ariel.md'), 'utf8'), /You review code/)
})

test('a name that cannot be a filename is refused, with the reason', async () => {
  // It becomes a filename, a subagent_type, and a thing a person types. All three constrain it.
  for (const [id, pattern] of [
    ['../escape', /slash or a dot/],
    ['Reviewer', /lowercase/],
    ['two words', /letters, numbers and hyphens/],
    ['', /required/],
    ['-leading', /starts with a letter or a number/],
  ] as const) {
    assert.equal(isValidAgentId(id), false, `${id} was accepted`)
    assert.match(whyInvalid(id) ?? '', pattern)
  }
  assert.equal(whyInvalid('memory-keeper'), null)
})

test('an agent with no description is refused, because the manager picks by description', async (t) => {
  const root = await workspace(t)
  const got = await hire(root, { ...ariel, description: '   ' })
  assert.equal(got.ok, false)
  assert.match(got.ok === false ? got.reason : '', /how the manager decides who to give work to/)
})

test('disabling makes them vanish from discovery, and re-enabling brings them back', async (t) => {
  // A rename rather than a flag: every reader of `*.md` stops seeing them at once, and nobody
  // has to know a new field exists. The one that forgets is the one that draws an empty desk.
  const root = await workspace(t)
  await hire(root, ariel)

  assert.equal((await disable(root, 'ariel')).ok, true)
  assert.equal((await discoverWorkspace(root)).employees.find((e) => e.id === 'ariel'), undefined)
  assert.deepEqual(await disabled(root), ['ariel'])
  // And discovery is not upset by the file it can now see and does not recognise.
  assert.deepEqual((await discoverWorkspace(root)).problems, [])

  assert.equal((await enable(root, 'ariel')).ok, true)
  assert.ok((await discoverWorkspace(root)).employees.find((e) => e.id === 'ariel'))
  assert.deepEqual(await disabled(root), [])
})

test('disabling is reversible by hand, which is the point of choosing a rename', async (t) => {
  const root = await workspace(t)
  await hire(root, ariel)
  await disable(root, 'ariel')

  const files = await readdir(join(root, '.claude', 'agents'))
  assert.deepEqual(files, ['ariel.md.off'], 'somebody looking at the directory should see what happened')
})

test('firing removes them, and says so when there is nobody to fire', async (t) => {
  const root = await workspace(t)
  await hire(root, ariel)

  assert.equal((await fire(root, 'ariel')).ok, true)
  assert.equal((await discoverWorkspace(root)).employees.find((e) => e.id === 'ariel'), undefined)

  const again = await fire(root, 'ariel')
  assert.equal(again.ok, false)
  assert.match(again.ok === false ? again.reason : '', /no agent called ariel/)
})

test('a hand-written agent is managed exactly like one we wrote', async (t) => {
  // The other half of the source-of-truth property. Somebody who added a file in an editor must
  // be disableable and firable through the office — otherwise there are two classes of employee
  // and only one of them is real to the app.
  const root = await workspace(t)
  await writeFile(
    join(root, '.claude', 'agents', 'byhand.md'),
    '---\nname: byhand\ndescription: Written in an editor.\n---\n\nBody.\n',
  )

  assert.equal((await disable(root, 'byhand')).ok, true)
  assert.deepEqual(await disabled(root), ['byhand'])
  assert.equal((await enable(root, 'byhand')).ok, true)
  assert.equal((await fire(root, 'byhand')).ok, true)
})

// ────────────────── the first standing order, for people hired after install ──

/*
 * "Only the user and the manager originate work" is kept by employees not having `Task`, and
 * `prompts.test.ts` checks that in the seven files we ship.
 *
 * Every agent hired *after* install is written by `hire()`, which checked the name and the
 * description and never the tools. So the order held for the office as delivered and not for the
 * office as used — and the second is the one that exists for longer.
 *
 * `views/hire.ts` already said the right thing in its own header: *"`hire()` still validates
 * independently, because a renderer check is a courtesy and never a guarantee."* The courtesy was
 * there. The guarantee was not.
 */

test('an employee cannot be hired with a delegation tool', async (t) => {
  const root = await workspace(t)

  for (const tool of ['Task', 'Agent']) {
    const result = await hire(root, {
      id: 'schemer',
      description: 'Would like to run the place.',
      tools: ['Read', 'Grep', tool],
      model: null,
      prompt: 'Do things.',
    })

    assert.equal(result.ok, false, `${tool} was accepted`)
    assert.match(why(result), /only the manager dispatches/)
  }
})

test('and the refusal names the tool rather than the rule number', async (t) => {
  // Somebody reading it has to know which entry to remove. "Breaks standing order 1" is true and
  // useless at the moment it appears.
  const root = await workspace(t)
  const result = await hire(root, {
    id: 'schemer',
    description: 'x',
    tools: ['Read', 'Task'],
    model: null,
    prompt: 'y',
  })

  assert.match(why(result), /Task/)
})

test('nothing is written when the hire is refused', async (t) => {
  // A refusal that left the file behind would be the worst of both: the order broken, and the
  // office insisting it had not been.
  const root = await workspace(t)
  await hire(root, { id: 'schemer', description: 'x', tools: ['Task'], model: null, prompt: 'y' })

  await assert.rejects(stat(join(root, '.claude', 'agents', 'schemer.md')))
})

test('inheriting every tool is still allowed, because it is a knowing choice', async (t) => {
  // `tools: null` omits the field, which is what the format means by *inherit everything* — and
  // that includes `Task`. The form makes it a checkbox with the consequence written beside it and
  // the roster prints it loudly under a name, so it is a decision somebody made and can see.
  // Refusing it here would outlaw a documented path.
  const root = await workspace(t)
  const result = await hire(root, {
    id: 'generalist',
    description: 'Inherits everything, deliberately.',
    tools: null,
    model: null,
    prompt: 'Do things.',
  })

  assert.equal(result.ok, true, why(result))
})

test('an ordinary hire is untouched', async (t) => {
  const root = await workspace(t)
  const result = await hire(root, {
    id: 'archivist',
    description: 'Keeps the record.',
    tools: ['Read', 'Write', 'Grep'],
    model: null,
    prompt: 'Write things down.',
  })

  assert.equal(result.ok, true, why(result))
})


test('THE BUG: an id that climbs out of the workspace is refused, not followed', async (t) => {
  // `fire`, `disable` and `enable` took an id straight from IPC and interpolated it into a path.
  // `fire(root, '../../../x')` resolved out of `.claude/agents/`, unlinked a file that was not
  // an agent, and returned `ok: true` carrying the path it had just removed.
  //
  // `privacy.ts` states the rule where it applies it — *"the argument arrives over IPC from a
  // renderer, so 'it must be one of these nine strings' is the check, not 'it looks like a safe
  // path'. A path check would be one clever traversal away."* `hire` applied it, `skills.ts`
  // applied it in both directions including its `rm -r`, and these three did not.
  //
  // Nothing was reaching it: the renderer is sandboxed and its ids come from the roster the app
  // itself drew. That is a fact about today's callers, not about the function.
  const root = await workspace(t)

  // A bystander three levels up: not an agent, not in the workspace, nobody's to touch.
  const outside = join(root, '..', `bystander-${process.pid}.md`)
  await writeFile(outside, 'not an agent')

  const climbs = `../../../bystander-${process.pid}`
  const alive = async (p: string) => stat(p).then(() => true, () => false)

  for (const [name, run] of [
    ['fire', () => fire(root, climbs)],
    ['disable', () => disable(root, climbs)],
    ['enable', () => enable(root, climbs)],
  ] as const) {
    const result = await run()
    assert.equal(result.ok, false, `${name} accepted an id that climbs out of the workspace`)
    // The reason is a sentence for a person, not a token to match on. Pinning the wording is how
    // a test comes to fail for a guard that got *better* — which is what happened here.
    assert.ok(why(result).length > 0, `${name} refused without saying why`)
    assert.equal(await alive(outside), true, `${name} touched a file outside the workspace`)
  }

  // Every shape that can leave the directory. This list used to also hold `UPPER`, `-leading` and
  // a 65-character name, and asserting those were refused was **wrong** — the guard behind it
  // refused names the office itself had drawn rows for, so `fire('Reviewer')` answered "Not an
  // agent name" about somebody visible on screen at that moment. Measured on the merged tree
  // before this changed:
  //
  //     the office drew rows for: Reviewer, data.scientist, manager, my_helper
  //     fire(Reviewer)       -> REFUSED: Not an agent name: "Reviewer"
  //     fire(data.scientist) -> REFUSED: Not an agent name: "data.scientist"
  //
  // The property is containment, not format. A name that cannot leave the directory is safe
  // here whatever it looks like, and a strict format check is a different rule that belongs
  // where a person is *typing* a name — which is where `hire` still applies it.
  for (const id of ['..', '.', '', 'a/b', 'a\\b', './x', 'x/../y', '.hidden', 'a\u0000b']) {
    assert.equal((await fire(root, id)).ok, false, `fire accepted ${JSON.stringify(id)}`)
  }

  // And the other half, which is the one that was broken: a name the office would draw a row
  // for is one the office can act on.
  for (const id of ['UPPER', '-leading', 'x'.repeat(65), 'data.scientist', 'my_helper']) {
    await writeFile(join(root, '.claude', 'agents', `${id}.md`), `---\nname: ${id}\n---\nHi.`)
    assert.equal((await fire(root, id)).ok, true, `fire refused ${JSON.stringify(id)}, which it had a file for`)
  }
})

test('and the guard did not break firing somebody who is real', async (t) => {
  // The other half. A check that refused everything would pass the test above and be worse.
  const root = await workspace(t)
  await hire(root, ariel)

  assert.equal((await disable(root, 'ariel')).ok, true, 'a real agent can be benched')
  assert.equal((await enable(root, 'ariel')).ok, true, 'and brought back')
  assert.equal((await fire(root, 'ariel')).ok, true, 'and let go')
  assert.deepEqual(await readdir(join(root, '.claude', 'agents')), [], 'the file is gone')

  // A hyphenated name is a real name — the guard must not be tighter than `whyInvalid`, which is
  // what the hire form tells people is allowed.
  await hire(root, { ...ariel, id: 'code-reviewer-2' })
  assert.equal((await fire(root, 'code-reviewer-2')).ok, true)
})

// ──────────────────────────────────────────────────────────── the bench ──
/*
 * `.md.off` is a second namespace, and only `disabled()` was reading it.
 *
 * `hire` and `fire` both addressed `${id}.md` alone, which is not where a benched agent's file
 * is. The three tests below are the three ways that showed up, and the first one lost a file.
 */

test('hiring a benched name is refused, because a benched employee is still an employee', async (t) => {
  // What this cost: `wx` guards `${id}.md` and says nothing about `${id}.md.off`, so this
  // succeeded — and then the roster drew `builder` twice, once at a desk and once under "sent
  // home", because discovery and `disabled()` were each reading the file the other cannot see.
  // Clicking *Bring back* on the second row renamed `.off` over the file the hire had just
  // written. POSIX `rename` replaces silently, so the new employee's description and prompt
  // were gone and `enable()` returned `{ ok: true }` for it.
  const root = await workspace(t)
  await hire(root, { ...ariel, description: 'THE ORIGINAL' })
  await disable(root, 'ariel')

  const again = await hire(root, { ...ariel, description: 'A SECOND ONE', prompt: 'different' })

  assert.equal(again.ok, false, 'hired over a benched employee — their prompt is now reachable only by undo')
  assert.match(why(again), /bench/i, 'the refusal has to say where they are, or the name looks free')
  assert.deepEqual(
    await readdir(join(root, '.claude', 'agents')),
    ['ariel.md.off'],
    'the refused hire still wrote a file',
  )
  const kept = await readFile(join(root, '.claude', 'agents', 'ariel.md.off'), 'utf8')
  assert.match(kept, /THE ORIGINAL/, 'the benched file was overwritten by a hire that was refused')
})

test('a benched employee can be let go, and the button that says so tells the truth', async (t) => {
  // The bench row offers *Fire*. It built `${id}.md` and unlinked that, so it answered "There is
  // no agent called ariel" about a row on screen at that moment, badged "sent home", describing
  // the file as `ariel.md.off`. Failing safe and failing dishonestly at once; the office's third
  // standing order is the one that was broken.
  const root = await workspace(t)
  await hire(root, ariel)
  await disable(root, 'ariel')

  const gone = await fire(root, 'ariel')

  assert.equal(gone.ok, true, why(gone))
  assert.deepEqual(await readdir(join(root, '.claude', 'agents')), [], 'the file is still there')
  assert.deepEqual(await disabled(root), [], 'the bench still lists somebody with no file')
})

test('the manager cannot be fired or sent home, at the layer that writes the file', async (t) => {
  // `shared/roster-view.ts` withholds both buttons from the manager's row — and the office's own
  // note beside the equivalent check in `hire` is that a renderer check is a courtesy and never
  // a guarantee. This is the guarantee. It matters because `fire` is an `unlink` with no undo
  // and `main.ts` throws `no manager agent found` without one.
  const root = await workspace(t)
  await writeFile(join(root, '.claude', 'agents', 'manager.md'), agentFile({ ...ariel, id: 'manager' }))

  const fired = await fire(root, 'manager')
  const benched = await disable(root, 'manager')

  assert.equal(fired.ok, false, 'the manager was deleted')
  assert.equal(benched.ok, false, 'the manager was sent home, leaving nobody who can dispatch')
  assert.deepEqual(await readdir(join(root, '.claude', 'agents')), ['manager.md'], 'the file moved')
})

test('...including a manager who is not called manager', async (t) => {
  // `findManager` takes the name first and falls back to whoever declares the delegation tool,
  // so an office can be run by `boss`. `staffRows` already withholds both buttons from whoever
  // that turns out to be — it reads `isManager` off the snapshot, which is computed from the
  // same function.
  //
  // The first version of this guard compared against the literal `'manager'`, which meant the
  // layer described as the guarantee permitted exactly what the courtesy above it withheld. A
  // guarantee that protects a strict subset of the check it stands behind is not one. Caught in
  // review, by writing the `boss.md` this test writes.
  const root = await workspace(t)
  await writeFile(join(root, '.claude', 'agents', 'boss.md'), agentFile({ ...ariel, id: 'boss', tools: ['Task', 'Read'] }))

  const fired = await fire(root, 'boss', 'boss')
  const benched = await disable(root, 'boss', 'boss')

  assert.equal(fired.ok, false, 'a manager called something else was deleted')
  assert.equal(benched.ok, false, 'a manager called something else was sent home')
  assert.deepEqual(await readdir(join(root, '.claude', 'agents')), ['boss.md'])
  // The sentence tells somebody which file to remove by hand, so it has to be *their* file. The
  // check was parameterised and the message was left naming `manager.md`, which does not exist in
  // the one workspace this guard was written for.
  assert.match(why(fired), /boss\.md/, 'the refusal names a file that is not there')
  assert.doesNotMatch(why(fired), /agents\/manager\.md/, 'it names the default rather than theirs')

  // And the default still holds when nobody says otherwise — an empty workspace has no manager
  // to name, and `main` falls back to this rather than passing nothing meaningful.
  await writeFile(join(root, '.claude', 'agents', 'manager.md'), agentFile({ ...ariel, id: 'manager' }))
  assert.equal((await fire(root, 'manager')).ok, false, 'the default name lost its protection')
})

test('firing with two files refuses, rather than deleting the one you are not looking at', async (t) => {
  // `fire` took the first path that existed, so with both files present a click on the *bench*
  // row unlinked the *desk* file: a different row's agent destroyed, `{ ok: true }` returned, the
  // clicked row still on screen, and the confirmation saying their file is gone. Two untrue
  // things on screen from one click, and `unlink` has no undo.
  //
  // The tell that this was an oversight and not a decision: the two functions below both refuse
  // this state, and the test defending them is the next one down. `fire` is the only one of the
  // three that cannot be taken back, and it was the one without the guard.
  const root = await workspace(t)
  const agents = join(root, '.claude', 'agents')
  await writeFile(join(agents, 'ariel.md'), agentFile({ ...ariel, description: 'AT A DESK' }))
  await writeFile(join(agents, 'ariel.md.off'), agentFile({ ...ariel, description: 'ON THE BENCH' }))

  const gone = await fire(root, 'ariel')

  assert.equal(gone.ok, false, 'fired one of the two and reported success for it')
  assert.match(why(gone), /ariel\.md\b/, 'the refusal does not name the file at the desk')
  assert.match(why(gone), /ariel\.md\.off/, 'the refusal does not name the file on the bench')
  assert.deepEqual(
    (await readdir(agents)).sort(),
    ['ariel.md', 'ariel.md.off'],
    'a refused fire deleted something',
  )
})

test('neither rename replaces a file, in a directory somebody has edited by hand', async (t) => {
  // `disable` and `enable` are both `rename`, which replaces the destination without a word.
  // With `hire` guarded the office can no longer produce both files itself — but `.off` is sold
  // in this module's own header as "trivially reversible by hand", so a hand-edited directory is
  // exactly what this runs against.
  const root = await workspace(t)
  const agents = join(root, '.claude', 'agents')
  await writeFile(join(agents, 'ariel.md'), agentFile({ ...ariel, description: 'AT A DESK' }))
  await writeFile(join(agents, 'ariel.md.off'), agentFile({ ...ariel, description: 'ON THE BENCH' }))

  const back = await enable(root, 'ariel')
  const away = await disable(root, 'ariel')

  assert.equal(back.ok, false, 'enable replaced the live file with the benched one')
  assert.equal(away.ok, false, 'disable replaced the benched file with the live one')
  assert.match(await readFile(join(agents, 'ariel.md'), 'utf8'), /AT A DESK/)
  assert.match(await readFile(join(agents, 'ariel.md.off'), 'utf8'), /ON THE BENCH/)
})

test('a name that walks out of the agents directory is refused by all four, not just hire', async (t) => {
  // `hire` has run `whyInvalid` since it was written. `fire`, `disable` and `enable` took the id
  // straight off the bridge — `String(id ?? '')` in main — and turned it into a path, so `fire`
  // was an `unlink` of anything a `../` could reach:
  //
  //     fire(root, '../skills/victim')  →  { ok: true }, and a skill file gone
  //
  // The argument for leaving them was that the renderer only sends ids off roster rows, which is
  // the argument this module rejects everywhere else. Found in review.
  const root = await workspace(t)
  const skills = join(root, '.claude', 'skills')
  await mkdir(skills, { recursive: true })
  await writeFile(join(skills, 'victim.md'), 'a skill somebody wrote\n')
  // A real file at the end of every path these names reach, so a guard that stops working
  // deletes something rather than reporting that there was nothing to delete.
  const sub = join(root, '.claude', 'agents', 'sub')
  await mkdir(sub, { recursive: true })
  await writeFile(join(sub, 'victim.md'), 'inside agents, but not an entry in it\n')

  for (const [name, run] of [
    ['fire', fire],
    ['disable', disable],
    ['enable', enable],
  ] as const) {
    // Every one of these has a real file at the end of it, because `ok === false` is also what
    // you get for a name that resolves to nothing — so without something there to destroy, this
    // loop passed with the guard removed and the refusal coming from ENOENT instead. A test
    // agreeing with a bug for a reason unrelated to the bug.
    //
    // `sub/victim` carries no leading dot, so only the separator check refuses it; every other
    // case here is caught by two overlapping checks and stays refused with either one removed.
    for (const bad of ['../skills/victim', 'sub/victim', '..', '.hidden', '']) {
      const out = await run(root, bad)
      assert.equal(out.ok, false, `${name} acted on ${JSON.stringify(bad)}, which is not an entry in agents/`)
      assert.doesNotMatch(
        why(out),
        /There is no agent called/,
        `${name} refused ${JSON.stringify(bad)} only because nothing was there — the guard did not see it`,
      )
    }
  }

  assert.deepEqual(await readdir(skills), ['victim.md'], 'a skill was removed or renamed')
  assert.deepEqual(await readdir(sub), ['victim.md'], 'a file one directory down was removed or renamed')
})

test('...but a name the office itself drew is acted on, whatever it looks like', async (t) => {
  // The first version of the guard above used `whyInvalid`, which is the convention for a name
  // somebody is *choosing* at `hire`. These three are handed whatever `readdir` found, and
  // `discoverWorkspace` applies no convention — so the office drew `Reviewer`, `my_helper` and
  // `data.scientist`, gave each a Send home and a Fire button, and then answered every click
  // with a complaint about a name the user never typed. Hand-writing an agent file is the
  // documented way to add one; `roster.ts` opens by saying so.
  //
  // The same failure as the traversal it replaced, from the other side: one let a name out of
  // the directory, the other refused names that were legitimately in it.
  const root = await workspace(t)
  const agents = join(root, '.claude', 'agents')
  for (const name of ['Reviewer', 'my_helper', 'data.scientist']) {
    await writeFile(join(agents, `${name}.md`), agentFile({ ...ariel, id: name }))
  }

  for (const name of ['Reviewer', 'my_helper', 'data.scientist']) {
    const found = await discoverWorkspace(root)
    assert.ok(found.employees.some((e) => e.id === name), `discovery stopped drawing ${name}`)
    const gone = await fire(root, name)
    assert.equal(gone.ok, true, `the office drew ${name} and then refused to act on them: ${why(gone)}`)
  }

  assert.deepEqual(await readdir(agents), [])
})

test('the bench and discovery agree about what an agent file is', async (t) => {
  // `workspace.ts` filters `!f.startsWith('.')` when reading `*.md`; `disabled()` did not when
  // reading `*.md.off`. So a hand-made `.hidden.md.off` drew a bench row that discovery would
  // never have drawn at a desk — and both buttons on it are refused, because `whyUnsafeAsPath`
  // will not act on a leading dot. A row on screen the office declines to touch, which is the
  // failure this branch spent two rounds removing, arriving from a third direction.
  const root = await workspace(t)
  const agents = join(root, '.claude', 'agents')
  await writeFile(join(agents, 'ariel.md.off'), agentFile(ariel))
  await writeFile(join(agents, '.hidden.md.off'), agentFile({ ...ariel, id: 'hidden' }))
  await writeFile(join(agents, '.DS_Store.md.off'), 'not an agent\n')

  assert.deepEqual(await disabled(root), ['ariel'], 'the bench lists files discovery would not')

  // And the file is left alone rather than tidied away: it is not ours to remove.
  assert.ok((await readdir(agents)).includes('.hidden.md.off'))
})

test('the first hire into a workspace nobody has prepared works', async (t) => {
  /*
   * Why this was not caught for so long: `workspace(t)` above creates `.claude/agents/` before
   * every test, so `hire` was never once asked to make its own directory. The fixture supplied
   * the precondition the production code depended on and did not establish — and every
   * assertion below it passed while the real first hire returned a raw ENOENT.
   *
   * It matters where the seed does not reach. A packaged install has the directory because the
   * build puts six agents in it; a person pointing the office at a repository they already have
   * — this product's own pitch — does not. There the first-run panel opens `blocked`, offers one
   * button, and that button could not succeed.
   */
  const bare = await tempDir(t, 'office-bare-')
  const made = await hire(bare, ariel)
  assert.equal(made.ok, true, why(made))

  // And it is a real hire, not just a written file: the same discovery every other one goes
  // through has to find it.
  const found = await discoverWorkspace(bare)
  assert.deepEqual(found.employees.map((e) => e.id), ['ariel'])
})

test('a hire into a workspace where .claude exists but agents/ does not works', async (t) => {
  // The commonest real shape by some distance: they have run `claude` here at least once.
  const half = await tempDir(t, 'office-half-')
  await mkdir(join(half, '.claude'), { recursive: true })
  assert.equal((await hire(half, ariel)).ok, true)
})

// ── one definition of where an agent's file is ──────────────────────────────────────────────

test('an agent whose filename differs from its name can be benched and fired', async (t) => {
  /*
   * The live bug, and no nesting is needed for it. Discovery takes the id from `name:` in the
   * frontmatter; this module used to rebuild the path as `.claude/agents/<id>.md`. Two
   * definitions of one fact, agreeing only while every file happened to be named after the agent
   * inside it.
   *
   * Measured before the fix: a file `code-reviewer.md` declaring `name: ariel` put **ariel** on
   * the floor, and `fire('ariel')` answered "There is no agent called ariel." The office showed
   * somebody and then denied they existed.
   */
  const root = await workspace(t)
  await writeFile(
    join(root, '.claude', 'agents', 'code-reviewer.md'),
    '---\nname: ariel\ndescription: Reviews things.\ntools: Read\n---\n\nYou review.\n',
    'utf8',
  )

  const ws = await discoverWorkspace(root)
  assert.deepEqual(ws.employees.map((e) => e.id), ['ariel'], 'discovery no longer reads the declared name')

  const benched = await disable(root, 'ariel')
  assert.equal(benched.ok, true, why(benched))
  assert.match(benched.ok ? benched.path : '', /code-reviewer\.md\.off$/, 'renamed a path built from the id')

  // And back, to the file it came from rather than to one named after the agent.
  const back = await enable(root, 'ariel')
  assert.equal(back.ok, true, why(back))
  assert.match(back.ok ? back.path : '', /code-reviewer\.md$/)

  assert.equal((await fire(root, 'ariel')).ok, true)
})

test('an agent in a subdirectory is on the floor, because Claude Code registers it', async (t) => {
  /*
   * Measured against the installed CLI (2.1.250) on one directory: `claude --agent <nonsense>`
   * prints its own registry, and `.claude/agents/team/nestedone.md` was in it while the office
   * drew only the flat agent. A real employee the manager can dispatch to, invisible on a floor
   * whose entire premise is showing who is there.
   *
   * The rule is not "recurse everything" — skills go the other way, because the CLI loads only
   * `skills/<name>/SKILL.md` and the office matches it there. The rule is to agree with the
   * thing that actually runs them.
   */
  const root = await workspace(t)
  await mkdir(join(root, '.claude', 'agents', 'team'), { recursive: true })
  await writeFile(
    join(root, '.claude', 'agents', 'team', 'nestedone.md'),
    '---\nname: nestedone\ndescription: An employee in a folder.\ntools: Read\n---\n\nYou are nested.\n',
    'utf8',
  )

  const ws = await discoverWorkspace(root)
  assert.deepEqual(ws.employees.map((e) => e.id), ['nestedone'])

  // And every operation reaches them where they actually are.
  const benched = await disable(root, 'nestedone')
  assert.match(benched.ok ? benched.path : '', /team\/nestedone\.md\.off$/, 'benched them to the top level')
  assert.deepEqual(await disabled(root), ['nestedone'], 'the bench cannot see into a folder')
  const back = await enable(root, 'nestedone')
  assert.match(back.ok ? back.path : '', /team\/nestedone\.md$/, 'brought them back to the wrong directory')
})

test('a dotted file is not an employee at any depth', async (t) => {
  // The dotfile rule used to be written twice — once in discovery for `*.md` and once in the
  // bench listing for `*.md.off` — and they disagreed. One walk applies it once, everywhere.
  const root = await workspace(t)
  await mkdir(join(root, '.claude', 'agents', 'team'), { recursive: true })
  await writeFile(join(root, '.claude', 'agents', '.hidden.md.off'), '---\nname: hidden\n---\nx\n', 'utf8')
  await writeFile(join(root, '.claude', 'agents', 'team', '.also-hidden.md'), '---\nname: also\n---\nx\n', 'utf8')

  assert.deepEqual((await discoverWorkspace(root)).employees.map((e) => e.id), [])
  assert.deepEqual(await disabled(root), [], 'a hidden file produced a bench row nothing could act on')
})

test('hiring the name of a benched agent is refused however their file is named', async (t) => {
  /*
   * The guard above this one already existed and already had the right rule — its comment
   * describes exactly the state it prevents: the roster drawing one name twice, once at a desk
   * and once under "sent home", and *Bring back* then renaming `.off` over the file the hire had
   * just written, silently, with `{ ok: true }` returned for it.
   *
   * It looked in the wrong place. `exists(`<id>.md.off`)` only sees a benched agent whose
   * *filename* matches the name. Measured: a benched `code-reviewer.md.off` declaring `name:
   * ariel` is on the bench as **ariel**, and hiring "ariel" succeeded — putting ariel on the
   * floor and on the bench at once, which is the state the guard exists to stop.
   */
  const root = await workspace(t)
  await writeFile(
    join(root, '.claude', 'agents', 'code-reviewer.md.off'),
    '---\nname: ariel\ndescription: Benched reviewer.\n---\n\nYou review.\n',
    'utf8',
  )
  assert.deepEqual(await disabled(root), ['ariel'])

  const again = await hire(root, ariel)
  assert.equal(again.ok, false, 'hired a name that is already on the bench')
  // And it names the file that is actually there, so somebody told to deal with it can find it.
  assert.match(why(again), /code-reviewer\.md\.off/)

  assert.deepEqual((await discoverWorkspace(root)).employees.map((e) => e.id), [], 'the floor drew them twice')
})

test('the two-files refusal names the files that exist', async (t) => {
  /*
   * The fault the manager guard's own comment describes — *"the check was parameterised and the
   * sentence was not"* — reintroduced while fixing the check. An agent at `team/whatever.md`
   * declaring `name: nestedone` produced "remove nestedone.md", sending somebody to a file that
   * does not exist, in the one message whose whole job is telling them which file to remove.
   */
  const root = await workspace(t)
  await mkdir(join(root, '.claude', 'agents', 'team'), { recursive: true })
  const body = '---\nname: nestedone\ndescription: n\n---\n\nn\n'
  await writeFile(join(root, '.claude', 'agents', 'team', 'whatever.md'), body, 'utf8')
  await writeFile(join(root, '.claude', 'agents', 'team', 'whatever.md.off'), body, 'utf8')

  const got = await fire(root, 'nestedone')
  assert.equal(got.ok, false)
  assert.match(why(got), /team\/whatever\.md/)
  assert.doesNotMatch(why(got), /nestedone\.md/, 'named a file rebuilt from the agent name')
})
