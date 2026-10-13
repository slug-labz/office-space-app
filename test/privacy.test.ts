/**
 * What the privacy panel promises, checked rather than asserted.
 *
 * The panel tells a person "Office Space makes no network requests of its own", offers to
 * measure what is on their disk, and offers to delete it. Every one of those is a claim that
 * could quietly stop being true — a `fetch` added in a hurry, a store added to `persistence.ts`
 * that nothing measures, a delete that removes the wrong thing.
 *
 * The first test is the one that matters most and it is the cheapest: **a panel promising no
 * network, in an app that has grown one, is worse than no panel.** It is the third standing
 * order broken in the one place somebody went looking for the truth.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { forget, measure, speechEgress } from '../src/main/privacy.js'
import { egressCaveat, egressLede, humanBytes, sizeLine } from '../src/shared/privacy-view.js'
import { STORES } from '../src/main/persistence.js'

import { tempDir } from './temp-dir.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function sandbox(t: TestContext): Promise<string> {
  return tempDir(t, 'office-privacy-')
}

/**
 * Code with the comments taken out.
 *
 * Crude on purpose — block comments then line comments, no parser. It is allowed to be crude
 * because it only ever *removes* text before a search for banned calls: the worst a mistake can
 * do is hide something, and the patterns being searched for do not appear inside string
 * literals anywhere in this source tree. A parser here would be more code than the thing it
 * protects.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Every `.ts` under `src/`, so a new file cannot dodge the check by being new. */
async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

/**
 * Where this app is allowed to touch the network, and nowhere else.
 *
 * This list used to be empty, and the test read *"the app makes no network requests of its
 * own"*. F4 — the Spotify controller — makes that false, and the test's own comment said what
 * to do about it: **add the destination, do not delete the check.**
 *
 * What replaces it is a stronger claim, not a weaker one. "No network anywhere" only held while
 * the answer was zero; the moment it stopped being zero it would have had to go. "Network only
 * in modules named here, and every module named here appears in the privacy panel" keeps
 * working at any number, and it is the property the panel actually promises.
 *
 * Adding a path to this array is deliberately awkward, and should stay that way.
 */
const MAY_REACH_THE_NETWORK = [
  'src/main/spotify/client.ts',
  'src/main/spotify/connect.ts',
  // The composition root. It makes no request of its own; it hands the real `fetch` to the two
  // modules above, which is how network access enters this app at all. Laptop 1's point, and it
  // is the right one: a module that gives out that capability is exercising it, and a guard that
  // could not see the handout was checking the wrong thing.
  'src/main/main.ts',
  // Dictation's model, and only that. One `fetch` of one file from one host, the first time
  // somebody presses the microphone — after which the reason to reach it is gone and the row in
  // the panel goes inactive. **What you say never travels**: the recording is written to a
  // temporary file, read by a program on this machine, and deleted. Downloading the model is
  // precisely what buys that, which is why this entry is worth its awkwardness.
  'src/main/voice/transcribe.ts',
]

test('nothing reaches the network except the modules that declare they do', async () => {
  const banned = [
    /\bfetch\s*\(/,
    // Naming the real `fetch` at all, in a value position — handing it to something else is
    // exactly as much network access as calling it, and the first version of this test could
    // not see the difference. `gate.ts` wraps a fetch it is *given* and correctly never appears
    // here; `main.ts` supplies the real one and now has to say so.
    //
    // The lookbehind keeps `typeof globalThis.fetch` legal. That is a type annotation, not a
    // capability, and banning it would make the gate's own signature unwritable.
    /(?<!typeof\s)globalThis\.fetch/,
    /\bnew\s+WebSocket\b/,
    /\bXMLHttpRequest\b/,
    /from\s+'node:https?'/,
    /require\(['"]node:https?['"]\)/,
    /\bnet\.connect\b/,
    /\bhttps?\.request\b/,
  ]

  const offenders: string[] = []
  for (const file of await sourceFiles(join(root, 'src'))) {
    // The dev harness fakes the bridge and never runs in the packaged app.
    if (file.endsWith('mock.ts')) continue
    const relative = file.slice(root.length + 1)
    if (MAY_REACH_THE_NETWORK.includes(relative)) continue
    // Comments stripped first. The first run of this test failed on `privacy.ts`, whose header
    // *names* XMLHttpRequest while explaining that the app does not use it — a check that
    // cannot tell code from prose would make writing the explanation impossible.
    const text = withoutComments(await readFile(file, 'utf8'))
    for (const pattern of banned) {
      if (pattern.test(text)) offenders.push(`${file.slice(root.length + 1)} matches ${pattern}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `the privacy panel lists every destination this app can reach. Either declare the module in\n` +
      `MAY_REACH_THE_NETWORK and add its hosts to the egress list, or do not make the request:\n${offenders.join('\n')}`,
  )
})

test('every module allowed to reach the network exists, and declares its hosts', async () => {
  // Two ways the list above rots, both silent. A path that no longer exists leaves a permission
  // standing for nothing — the next file to land at that path inherits it. And a module that
  // reaches the network without exporting the hosts it reaches cannot be described by the panel,
  // which is the only reason the permission was granted.
  for (const relative of MAY_REACH_THE_NETWORK) {
    const text = await readFile(join(root, relative), 'utf8').catch(() => null)
    assert.ok(text !== null, `${relative} is in MAY_REACH_THE_NETWORK and does not exist`)
    assert.match(
      text ?? '',
      /HOSTS/,
      `${relative} may reach the network but never mentions HOSTS — the panel cannot describe it`,
    )
  }
})

test('every store in the list is measured, and a new one cannot be forgotten', async (t) => {
  // The failure this prevents: somebody adds a store to `persistence.ts`, nothing measures it,
  // and the panel confidently reports a total that leaves it out.
  const dir = await sandbox(t)
  const report = await measure(dir, null, [], [])

  assert.equal(report.stores.length, STORES.length)
  assert.deepEqual(
    report.stores.map((s) => s.path).sort(),
    STORES.map((s) => s.path).sort(),
  )
})

test('absent, empty and unreadable are three different answers', async (t) => {
  const dir = await sandbox(t)

  // Nothing at all.
  const nothing = await measure(dir, null, [], [])
  assert.equal(nothing.stores.find((s) => s.path === 'memory')?.state, 'absent')

  // Created and empty. A workspace that has been emptied is not one that never remembered.
  await mkdir(join(dir, 'memory'), { recursive: true })
  const emptied = await measure(dir, null, [], [])
  const memory = emptied.stores.find((s) => s.path === 'memory')
  assert.equal(memory?.state, 'present')
  assert.equal(memory?.files, 0)

  assert.equal(sizeLine({ state: 'absent', bytes: 0, files: 0, unreadable: 0 }), 'never created')
  assert.equal(sizeLine({ state: 'present', bytes: 0, files: 0, unreadable: 0 }), 'empty')
  assert.equal(sizeLine({ state: 'unreadable', bytes: 0, files: 0, unreadable: 0 }), 'could not be read')
})

test('the project scaffold is not counted as your work', async (t) => {
  // `projects/_TEMPLATE` is the office and ships with it. Counting it in "yours" would inflate
  // the number people read to decide whether they have anything to delete.
  const dir = await sandbox(t)
  await mkdir(join(dir, 'projects/_TEMPLATE'), { recursive: true })
  await writeFile(join(dir, 'projects/_TEMPLATE/PLAN.md'), 'x'.repeat(500))

  const only = await measure(dir, null, [], [])
  assert.equal(only.stores.find((s) => s.path === 'projects')?.bytes, 0)

  await mkdir(join(dir, 'projects/mine'), { recursive: true })
  await writeFile(join(dir, 'projects/mine/PLAN.md'), 'y'.repeat(120))

  const both = await measure(dir, null, [], [])
  assert.equal(both.stores.find((s) => s.path === 'projects')?.bytes, 120)
})

test('deleting your projects leaves the scaffold behind', async (t) => {
  // Otherwise "delete my work" also deletes the ability to start any. That is not a privacy
  // action, it is breaking the app while believing you protected something.
  const dir = await sandbox(t)
  await mkdir(join(dir, 'projects/_TEMPLATE'), { recursive: true })
  await writeFile(join(dir, 'projects/_TEMPLATE/PLAN.md'), 'scaffold')
  await writeFile(join(dir, 'projects/README.md'), 'what a project is')
  await mkdir(join(dir, 'projects/mine'), { recursive: true })
  await writeFile(join(dir, 'projects/mine/PLAN.md'), 'secret')

  const outcome = await forget(dir, 'projects')
  assert.equal(outcome.ok, true)

  const left = (await readdir(join(dir, 'projects'))).sort()
  assert.deepEqual(left, ['README.md', '_TEMPLATE'])
})

test('the office itself cannot be deleted through the privacy panel', async (t) => {
  const dir = await sandbox(t)
  await mkdir(join(dir, '.claude/agents'), { recursive: true })
  await writeFile(join(dir, '.claude/agents/manager.md'), 'the manager')

  const outcome = await forget(dir, '.claude/agents')
  assert.equal(outcome.ok, false)
  assert.match(outcome.ok === false ? outcome.reason : '', /part of the office/)
  // And it is still there. A refusal that deleted anyway would be the worst of both.
  assert.deepEqual(await readdir(join(dir, '.claude/agents')), ['manager.md'])
})

test('a path that is not a store is refused, however it is spelled', async (t) => {
  // The argument arrives over IPC from a renderer. The check is membership of a list of nine
  // strings, not "does this look like a safe path" — which is one clever traversal away from
  // deleting a home directory.
  const dir = await sandbox(t)
  for (const path of ['../..', '/etc', 'memory/../..', '', 'Memory']) {
    const outcome = await forget(dir, path)
    assert.equal(outcome.ok, false, `${path} was accepted`)
  }
})

test('deleting something that was never there is not an error', async (t) => {
  // `force: true`. Somebody clicking delete on an absent store has got what they wanted.
  const dir = await sandbox(t)
  assert.equal((await forget(dir, 'memory')).ok, true)
})

test('the last prompt is carried verbatim, and null is not empty', async (t) => {
  const dir = await sandbox(t)
  const sent = '## CURRENT STAFF\n\nmanager, builder\n\n## THE MESSAGE\n\nhello'

  assert.equal((await measure(dir, sent, [], [])).lastPrompt, sent)
  // Nothing sent yet, which is a different fact from an empty prompt.
  assert.equal((await measure(dir, null, [], [])).lastPrompt, null)
})

test('sizes are short, and never scientific notation', () => {
  assert.equal(humanBytes(0), '0 B')
  assert.equal(humanBytes(1023), '1023 B')
  assert.equal(humanBytes(1024), '1.0 KB')
  // One decimal below ten, none above: `47 KB` and `340 MB` line up in a column; `47.0 KB`
  // and `340.2 MB` do not.
  assert.equal(humanBytes(48_120), '47 KB')
  assert.equal(humanBytes(9 * 1024), '9.0 KB')
  assert.equal(humanBytes(10 * 1024 * 1024), '10 MB')
  assert.equal(humanBytes(1024 ** 3 * 3), '3.0 GB')
  // Beyond the last unit it keeps counting in it rather than inventing one.
  assert.match(humanBytes(1024 ** 4), /GB$/)
})


test('the sentence over the egress list is derived, never asserted', () => {
  // It was a constant — "Office Space makes no network requests of its own" — and it was true
  // for exactly as long as the app reached nowhere. F4 landed a Spotify controller that
  // correctly declared its hosts and correctly marked them `who: 'office-space'`, and the
  // sentence above them went on saying the opposite while every test passed.
  //
  // That is the third standing order broken in the one panel whose whole job is telling the
  // truth about what leaves the machine, and it broke *silently*, because a claim written as a
  // string literal has nothing to disagree with.
  const cliOnly = [
    { who: 'the claude CLI' as const, active: true },
    { who: 'the claude CLI' as const, active: true },
  ]
  assert.match(egressLede(cliOnly), /makes no network requests of its own/)

  const withOurs = [...cliOnly, { who: 'office-space' as const, active: true }]
  assert.doesNotMatch(egressLede(withOurs), /no network requests/)
  assert.match(egressLede(withOurs), /reaching 1 host of its own/)

  // Counted, not hedged. "Some hosts of its own" would be the same evasion in a longer word.
  const three = [...cliOnly, ...Array(3).fill({ who: 'office-space' as const, active: true })]
  assert.match(egressLede(three), /reaching 3 hosts of its own/)
})

test('declared but dormant is not the same as reaching, and the sentence says which', () => {
  // The fix above counted rows, and F4 lists its hosts **whether or not an account is
  // connected** — deliberately, because somebody opening this panel is asking what the app
  // *can* reach. Put together, a disconnected install read "reaches 3 hosts of its own" while
  // reaching none: the same fault as the constant it replaced, pointing the other way.
  //
  // This is the state a privacy-conscious person is actually checking for, so it is the one
  // the sentence must not fudge.
  const cli = [{ who: 'the claude CLI' as const, active: true }]
  const dormant = [...cli, ...Array(3).fill({ who: 'office-space' as const, active: false })]

  assert.match(egressLede(dormant), /can reach 3 hosts of its own/)
  assert.match(egressLede(dormant), /reaching none of them right now/)
  assert.doesNotMatch(egressLede(dormant), /is reaching \d+ host/)

  // One connected out of three declared reports the one that is live, not the three that exist.
  const partly = [
    ...cli,
    { who: 'office-space' as const, active: true },
    { who: 'office-space' as const, active: false },
    { who: 'office-space' as const, active: false },
  ]
  assert.match(egressLede(partly), /is reaching 1 host of its own/)
})

test('an empty egress list still reads as a claim rather than as a blank', () => {
  // Nothing configured at all — no MCP servers, and `claude` not found. The panel still has to
  // say something, and "makes no network requests of its own" happens to be exactly true.
  assert.match(egressLede([]), /makes no network requests of its own/)
})

test('the real fetch is only ever handed out through the gate', async () => {
  /*
   * `MusicSetup.networkAllowed` is described as *"the master switch. False means no request can
   * be made, whatever else is configured."* That is a promise about a capability, and it holds
   * exactly as long as the composition root wraps the fetch it hands out.
   *
   * The test above cannot see this. `main.ts` is on `MAY_REACH_THE_NETWORK` precisely because it
   * names `globalThis.fetch` — so changing
   *
   *     fetch: gated(() => musicNetwork, globalThis.fetch)
   *
   * to
   *
   *     fetch: globalThis.fetch
   *
   * would pass it, and the switch would become decoration. The allow-list answers *may this
   * module reach the network*; this answers *on what terms*.
   *
   * `gated` reads its predicate per call rather than capturing it, which is the difference
   * between switching the network off and switching it off from the next restart — so the wrap
   * is the whole of the guarantee, not a formality around it.
   */
  const source = withoutComments(await readFile(join(root, 'src/main/main.ts'), 'utf8'))

  // A value-position mention. `typeof globalThis.fetch` is a type annotation and carries nothing.
  const handouts = [...source.matchAll(/(?<!typeof\s)globalThis\.fetch/g)]
  assert.ok(handouts.length > 0, 'main.ts no longer hands out a fetch — has the wiring moved?')

  const wrapped = source.match(/gated\([^()]*(?:\([^()]*\))?[^()]*globalThis\.fetch\s*\)/g) ?? []

  assert.equal(
    wrapped.length,
    handouts.length,
    `${handouts.length} handout(s) of the real fetch and only ${wrapped.length} wrapped in ` +
      '`gated`. An ungated one is the master switch quietly becoming decoration.',
  )
})


// ─────────────────────────────────────────────── what ships inside what is yours ──

test('a fresh clone has nothing of yours, in the panel that counts what is yours', async (t) => {
  // `projects/` arrives with `_TEMPLATE` and a `README.md`; `memory/` with a `README.md` and a
  // `.gitkeep`. All four are `.gitignore` exceptions, which is what shipped means. `measure`
  // skipped `_TEMPLATE` alone, so the panel told somebody who had just cloned the repo that it
  // was keeping 812 B **of yours** — a shipped file, described as their work, in the one panel
  // whose entire job is telling the truth about what is kept.
  const root = await tempDir(t, 'office-privacy-shipped-')
  await mkdir(join(root, 'projects', '_TEMPLATE'), { recursive: true })
  await mkdir(join(root, 'memory'), { recursive: true })
  await writeFile(join(root, 'projects', '_TEMPLATE', 'PLAN.md'), 'x'.repeat(100))
  await writeFile(join(root, 'projects', 'README.md'), 'x'.repeat(812))
  await writeFile(join(root, 'memory', 'README.md'), 'x'.repeat(981))
  await writeFile(join(root, 'memory', '.gitkeep'), '')

  const report = await measure(root, null, [], [])
  const store = (path: string) => report.stores.find((s) => s.path === path)!

  assert.equal(store('projects').files, 0, 'the shipped README and scaffold were counted as the user\'s work')
  assert.equal(store('projects').bytes, 0)
  assert.equal(store('memory').files, 0, 'the shipped README and .gitkeep were counted as things the office remembers')
  assert.equal(store('memory').bytes, 0)
})

test('Delete removes exactly what the panel counted, and nothing that shipped', async (t) => {
  // Two lists were two chances to disagree, and they took it. `forget` on `projects` skipped a
  // `README.md` that `measure` had counted, so the number the panel showed before the click was
  // the number it showed after — a delete that appears not to have happened, on the store the
  // office marks `precious`. `forget` on `memory` was an `rm` of the whole directory, which took
  // a git-tracked file out of the user's clone.
  const root = await tempDir(t, 'office-privacy-forget-')
  await mkdir(join(root, 'projects', 'auth'), { recursive: true })
  await mkdir(join(root, 'memory'), { recursive: true })
  await writeFile(join(root, 'projects', 'README.md'), 'x'.repeat(812))
  await writeFile(join(root, 'projects', 'auth', 'PLAN.md'), 'y'.repeat(70))
  await writeFile(join(root, 'memory', 'README.md'), 'x'.repeat(981))
  await writeFile(join(root, 'memory', '.gitkeep'), '')
  await writeFile(join(root, 'memory', 'mine.md'), 'y'.repeat(50))

  const before = await measure(root, null, [], [])
  assert.equal(before.stores.find((s) => s.path === 'projects')!.bytes, 70, 'counted something that shipped')
  assert.equal(before.stores.find((s) => s.path === 'memory')!.bytes, 50, 'counted something that shipped')

  assert.equal((await forget(root, 'projects')).ok, true)
  assert.equal((await forget(root, 'memory')).ok, true)

  const after = await measure(root, null, [], [])
  assert.equal(after.stores.find((s) => s.path === 'projects')!.bytes, 0, 'the number did not move')
  assert.equal(after.stores.find((s) => s.path === 'memory')!.bytes, 0, 'the number did not move')

  assert.deepEqual((await readdir(join(root, 'projects'))).sort(), ['README.md'], 'a shipped file was removed')
  // `.gitkeep` by name, not just the count. A hard-coded `['_TEMPLATE', 'README.md']` in `forget`
  // — which is what it had — skips `README.md` in `memory` too, so the directory listing looks
  // identical while `.gitkeep` is deleted. Asserting the sorted list without it passed that
  // mutation, which is a test agreeing with a bug because it never asked the right question.
  assert.deepEqual((await readdir(join(root, 'memory'))).sort(), ['.gitkeep', 'README.md'], 'a shipped file was removed')

  // The directory itself survives, because gone reads as `never created` in this panel — and
  // "you have never remembered anything" is a different claim from "you asked me to forget".
  assert.equal(after.stores.find((s) => s.path === 'memory')!.state, 'present', 'an emptied memory now reads as never created')
})

test('every store the office calls yours can actually be forgotten', async (t) => {
  /*
   * The loop this test guards replaced an `rm` of the store's path, and three of the `yours`
   * stores are single files — `sessions.json`, `dispatches.jsonl`, `floor.ndjson`. `readdir` on
   * a file is ENOTDIR, so all three answered the Delete button with a raw
   * `ENOTDIR: not a directory, scandir /Users/…` and left the file exactly where it was.
   *
   * `dispatches.jsonl` is the one this repo's own comment calls the most personal thing under
   * `.office-space/` — *"every line is a brief in the words somebody wrote"* — and it was added
   * to the store list precisely because it had been sitting there undeleteable. It was
   * undeleteable again, and the panel showed an absolute path to a stranger while saying so.
   *
   * Every `yours` store, from `STORES`, rather than the three that broke. The reason the suite
   * was green through all of it is that every `forget` in this file targeted `projects`,
   * `memory`, or a `template` store that is refused before it reaches the filesystem — so the
   * three single-file stores had no cover at all, and a fourth added later would have none
   * either. Iterating the list is what makes that impossible rather than unlikely.
   */
  const root = await tempDir(t, 'office-forget-every-')
  const yours = STORES.filter((s) => s.kind === 'yours')
  assert.ok(yours.length >= 6, `only ${yours.length} stores are marked yours — this test is checking almost nothing`)

  const isFile = (path: string): boolean => /\.(json|jsonl|ndjson)$/.test(path)

  for (const store of yours) {
    const where = join(root, store.path)
    if (isFile(store.path)) {
      await mkdir(dirname(where), { recursive: true })
      await writeFile(where, 'something somebody wrote\n')
    } else {
      await mkdir(where, { recursive: true })
      await writeFile(join(where, 'mine.md'), 'something somebody wrote\n')
    }
  }

  for (const store of yours) {
    const out = await forget(root, store.path)
    assert.equal(out.ok, true, `${store.path} could not be forgotten: ${out.ok ? '' : out.reason}`)

    if (isFile(store.path)) {
      // A single-file store goes whole — there is nothing in it that shipped.
      await assert.rejects(stat(join(root, store.path)), `${store.path} is still on disk after being forgotten`)
    } else {
      // A directory store is emptied and kept, so the panel can say `empty` rather than
      // `never created` to somebody who has just clicked Delete.
      const left = await readdir(join(root, store.path))
      assert.deepEqual(left, [], `${store.path} still holds ${left.join(', ')}`)
    }
  }
})

test('a store the office could only partly read says so, rather than reporting a short number', async (t) => {
  /*
   * `walk` swallowed a failed `readdir` and returned what it had counted:
   *
   *     both readable          state=present  files=2  bytes=9100
   *     one subdir unreadable  state=present  files=1  bytes=100
   *
   * The panel printed 100 B as a complete fact. The store's *own* failure was already handled —
   * that is `state: 'unreadable'` and the line "could not be read" — but a readable store with an
   * unreadable part had no representation at all, so it came out as a smaller true-looking figure.
   *
   * The worst of the three is the last case below: with every subdirectory locked, this used to
   * say **empty**. Absent read as empty, in the panel whose whole job is saying what is kept.
   */
  const root = await tempDir(t, 'office-partial-')
  const projects = join(root, 'projects')
  await mkdir(join(projects, 'visible'), { recursive: true })
  await mkdir(join(projects, 'locked'), { recursive: true })
  await writeFile(join(projects, 'visible', 'PLAN.md'), 'x'.repeat(100))
  await writeFile(join(projects, 'locked', 'SECRET.md'), 'y'.repeat(9000))

  const line = async (): Promise<string> => {
    const report = await measure(root, null, [], [])
    return sizeLine(report.stores.find((s) => s.path === 'projects')!)
  }

  assert.match(await line(), /2 files/, 'the whole store should be counted when it can be read')

  await chmod(join(projects, 'locked'), 0o000)
  try {
    const partial = await line()
    assert.match(partial, /at least/, 'a short number was reported as a complete one')
    assert.match(partial, /could not be read/, 'the reader is not told why the number is short')

    await chmod(join(projects, 'visible'), 0o000)
    const nothing = await line()
    assert.doesNotMatch(nothing, /^empty$/, 'a store nothing could be read from was reported as empty')
    assert.match(nothing, /could not be read/)
  } finally {
    // Restored whatever the assertions did, so a failure here does not leave a temp directory
    // the runner cannot clean up.
    await chmod(join(projects, 'locked'), 0o755)
    await chmod(join(projects, 'visible'), 0o755)
  }
})

test('a config that would not open is not a machine with no servers on it', () => {
  // `capabilities.ts` keeps `missing` and `unreadable` apart all the way out, and its own tests
  // insist on it. The egress list is built from the servers a scan *found*, so an unreadable
  // config produces one fewer row and changes nothing else — the panel read as a clean answer.
  assert.equal(egressCaveat([]), null, 'nothing to admit renders no element at all')

  const one = egressCaveat([{ path: '~/.claude/mcp.json', cause: 'not readable JSON' }])
  assert.ok(one !== null)
  // The path, because "a config could not be read" sends somebody hunting for which.
  assert.match(one, /~\/\.claude\/mcp\.json/)
  assert.match(one, /not readable JSON/)
  // The claim itself, which is the whole reason the field exists.
  assert.match(one, /not a file with no servers in it/)
  // Singular, and it says the list is short rather than that something went wrong — a person
  // reading this panel is asking whether they can trust the list, not filing a bug.
  assert.match(one, /One server config/)
  assert.match(one, /short by however many servers it holds/)
})

test('the caveat counts and agrees with itself in the plural', () => {
  const two = egressCaveat([
    { path: '.mcp.json', cause: 'EACCES' },
    { path: '~/.claude.json', cause: 'not readable JSON' },
  ])
  assert.ok(two !== null)
  assert.match(two, /2 server configs/)
  // `they hold`, not `it holds`. A sentence that disagrees with its own count reads as
  // generated, in the one panel whose whole claim is that it is careful.
  assert.match(two, /short by however many servers they hold/)
  assert.match(two, /\.mcp\.json — EACCES/)
  assert.match(two, /~\/\.claude\.json — not readable JSON/)
})

test('the report carries what the scan could not read, and empty is not a default', async (t) => {
  const dir = await sandbox(t)

  // Required rather than optional: a caller that forgot it would report a clean scan, which is
  // the one wrong answer this field exists to prevent. The compiler is the guard; this records
  // that the value arrives rather than being invented at the far end.
  const clean = await measure(dir, null, [], [])
  assert.deepEqual(clean.unreadSources, [])
  assert.equal(egressCaveat(clean.unreadSources), null)

  const torn = await measure(dir, null, [], [{ path: '.mcp.json', cause: 'not readable JSON' }])
  assert.equal(torn.unreadSources.length, 1)
  assert.notEqual(egressCaveat(torn.unreadSources), null)
})

// ──────────────────────────────────────────── a link is not the thing it points at ──

/**
 * The panel answers two questions and they have to agree: *what is under your workspace because
 * of this app*, and *what does Forget remove*. `forget` deletes with `rm`, and `rm` never follows
 * a symlink — it unlinks the link and leaves the target whole. So a measurement that follows one
 * promises something the button cannot deliver.
 *
 * It did. `walk` used `stat`, which follows:
 *
 *     projects, one 20b link : 2 files, 8388623 bytes
 *     after forget, target   : 8388608 bytes, still there
 *
 * Both halves wrong in opposite directions, in the panel whose whole job is telling the truth
 * about what is on disk.
 */

test('a link inside a store is measured as the link, not as what it points at', async (t) => {
  const where = await sandbox(t)
  await mkdir(join(where, 'projects', 'real'), { recursive: true })
  await writeFile(join(where, 'projects', 'real', 'PLAN.md'), 'a genuine plan\n')

  // Somewhere else on the disk entirely, and big enough that following it is unmistakable.
  const elsewhere = await tempDir(t, 'office-elsewhere-')
  const big = join(elsewhere, 'movie.mkv')
  await writeFile(big, Buffer.alloc(4 * 1024 * 1024, 7))
  await symlink(big, join(where, 'projects', 'real', 'notes.txt'))

  const projects = (await measure(where, null, [], [])).stores.find((s) => s.path === 'projects')
  assert.ok(projects)

  const link = (await lstat(join(where, 'projects', 'real', 'notes.txt'))).size
  const plan = (await lstat(join(where, 'projects', 'real', 'PLAN.md'))).size
  assert.equal(
    projects.bytes,
    link + plan,
    'the panel counted the target of a symlink as work under this workspace — it is not under ' +
      'this workspace, and Forget cannot remove it',
  )
  assert.ok(projects.bytes < 1024, 'a 4MB target leaked into a measurement of two tiny files')
})

/** What is really under a directory, counted here rather than by the code being tested. */
async function onDisk(dir: string): Promise<number> {
  let bytes = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    bytes += entry.isDirectory() ? await onDisk(path) : (await lstat(path)).size
  }
  return bytes
}

test('what the panel reports is what Forget actually reclaims', async (t) => {
  // The contract behind the number. Measured against a walk written here, on purpose: the first
  // version of this test asserted `before - after === before`, which is `after === 0` with extra
  // steps. It passed, and it kept passing with the symlink bug reinstated, because the panel and
  // the arithmetic were both reading the same wrong number.
  const where = await sandbox(t)
  await mkdir(join(where, 'projects', 'real'), { recursive: true })
  await writeFile(join(where, 'projects', 'real', 'PLAN.md'), 'a genuine plan\n')

  const elsewhere = await tempDir(t, 'office-elsewhere-')
  const big = join(elsewhere, 'movie.mkv')
  await writeFile(big, Buffer.alloc(4 * 1024 * 1024, 7))
  await symlink(big, join(where, 'projects', 'real', 'notes.txt'))

  const claimed = (await measure(where, null, [], [])).stores.find((s) => s.path === 'projects')!.bytes
  const held = await onDisk(join(where, 'projects'))
  assert.equal(claimed, held, 'the panel reported a number that is not what is under the workspace')

  const rootBefore = await onDisk(where)
  assert.equal((await forget(where, 'projects')).ok, true)
  const rootAfter = await onDisk(where)

  assert.equal(
    rootBefore - rootAfter,
    claimed,
    'Forget freed a different number of bytes than the panel promised',
  )
  // And the thing on the other side of the link is untouched, which is the whole reason the
  // measurement may not count it: it was never ours to delete.
  assert.equal((await stat(big)).size, 4 * 1024 * 1024, 'forget reached through a link and took a file elsewhere')
})

test('a store root that is itself a link is measured as the link', async (t) => {
  // Same defect one level up. `forget` runs `rm(where)` on a linked store root, which unlinks the
  // link and leaves the directory whole — so following it here would report somebody's linked-in
  // archive as data this app holds, under a button that does not remove it.
  const where = await sandbox(t)
  const elsewhere = await tempDir(t, 'office-elsewhere-')
  await writeFile(join(elsewhere, 'big.bin'), Buffer.alloc(2 * 1024 * 1024, 3))
  await symlink(elsewhere, join(where, 'memory'))

  const memory = (await measure(where, null, [], [])).stores.find((s) => s.path === 'memory')
  assert.ok(memory)
  assert.equal(memory.state, 'present')
  assert.ok(memory.bytes < 1024, `a linked store root reported ${memory.bytes} bytes of somebody else's disk`)
})

test('the panel does not count files Forget refuses to delete', async (t) => {
  // No symlink involved, and true in every clone. `measure` skipped `_TEMPLATE`; `forget` skipped
  // `_TEMPLATE` and `README.md`. Both files ship, so the panel counted 812 bytes of shipped
  // README as "your work" and then declined to remove it.
  //
  // Found by writing the Forget-contract test above against an independent walk rather than
  // against the panel's own arithmetic. The same rule written in two places is what let it drift.
  const where = await sandbox(t)
  await mkdir(join(where, 'projects', '_TEMPLATE'), { recursive: true })
  await mkdir(join(where, 'projects', 'mine'), { recursive: true })
  await writeFile(join(where, 'projects', 'README.md'), 'x'.repeat(500))
  await writeFile(join(where, 'projects', '_TEMPLATE', 'PLAN.md'), 'y'.repeat(300))
  await writeFile(join(where, 'projects', 'mine', 'PLAN.md'), 'z'.repeat(100))

  const claimed = (await measure(where, null, [], [])).stores.find((s) => s.path === 'projects')!.bytes
  const before = await onDisk(where)
  assert.equal((await forget(where, 'projects')).ok, true)
  const freed = before - (await onDisk(where))

  assert.equal(claimed, freed, 'the panel promised bytes that Forget keeps back')
  assert.equal(claimed, 100, 'only the project the person made is theirs to be told about')

  // The shipped files are still there, which is the reason they are kept back at all.
  const left = (await readdir(join(where, 'projects'))).sort()
  assert.deepEqual(left, ['README.md', '_TEMPLATE'])
})

test('Forget unlinks a linked store, it does not empty what the link points at', async (t) => {
  // The severe one, and the reason `forget` uses `lstat` rather than `stat`.
  //
  // `stat(where).isDirectory()` is true for a link *to* a directory, so `forget` took the
  // directory branch, read the entries **through the link**, and removed them one at a time.
  // Measured before the fix, with `memory` linked at a Documents folder:
  //
  //     before:  Documents holds novel.txt, photos, taxes.pdf
  //     forget says: {"ok":true}
  //     after:   Documents holds (EMPTY)
  //
  // Somebody pressed a button that says it forgets what this app kept, had a directory of their
  // own emptied, and was told it worked. That is every standing order at once: it destroyed what
  // it did not own, it reported success, and nothing on the panel could have shown it.
  const root = await sandbox(t)
  const elsewhere = await tempDir(t, 'office-elsewhere-')
  await writeFile(join(elsewhere, 'taxes.pdf'), 'irreplaceable\n')
  await writeFile(join(elsewhere, 'novel.txt'), 'also irreplaceable\n')
  await mkdir(join(elsewhere, 'photos'))

  await symlink(elsewhere, join(root, 'memory'))
  assert.equal((await forget(root, 'memory')).ok, true)

  assert.deepEqual(
    (await readdir(elsewhere)).sort(),
    ['novel.txt', 'photos', 'taxes.pdf'],
    'Forget reached through a symlinked store and deleted files it never owned',
  )
  // And the link itself is gone, which is the right amount to remove: the link is what was under
  // the workspace, so the link is what Forget had any business touching.
  assert.equal(
    await lstat(join(root, 'memory')).then(() => 'still there', () => 'gone'),
    'gone',
    'the link survived, so the store was not forgotten at all',
  )
})

// ───────────────────────────────────────── the speech model's two rows ────

test('the speech hosts are never reported live, in either state', () => {
  // `main.ts` built these as `active: !dictationReady` — the inverse of what `Egress.active`
  // documents, which is "reachable right now". Before the download nothing has been reached;
  // after it, the reason to reach is gone. Neither is "right now".
  for (const ready of [false, true]) {
    for (const row of speechEgress(['huggingface.co'], '.hf.co', ready)) {
      assert.equal(row.active, false, `dictationReady=${ready} reported ${row.what} as live`)
      assert.equal(row.who, 'office-space')
    }
  }
})

test('the badge and the sentence beside it agree', () => {
  // What made this visible from the outside: on a fresh install the row was badged `live` and
  // the line under it said the download happens "the first time you press the microphone".
  // A badge contradicting its own caption, on the panel whose whole job is not to overstate.
  const [fresh] = speechEgress(['huggingface.co'], '.hf.co', false)
  assert.ok(fresh)
  assert.match(fresh.detail, /one download, the first time you press the microphone/)
  assert.equal(fresh.active, false, 'the badge said live while the caption said it had not happened')

  const [downloaded] = speechEgress(['huggingface.co'], '.hf.co', true)
  assert.match(downloaded!.detail, /already downloaded, so nothing reaches this now/)
})

test('both rows are built, and the CDN is named as a suffix', () => {
  // The instrument: a mapping that produced one row would pass every assertion above.
  const rows = speechEgress(['huggingface.co'], '.hf.co', false)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.what), ['huggingface.co', '*.hf.co'])
})

test('a fresh workspace says it is reaching none of them, which it could not say before', () => {
  // `egressLede`'s middle branch exists for exactly this workspace and its docstring says two
  // states "would force one of them to lie". Two speech rows reporting live on every fresh
  // install meant the branch never rendered there — the panel skipped "can reach, is reaching
  // none" and went straight to "is reaching 2 hosts of its own", before it had reached any.
  const fresh = [
    ...speechEgress(['huggingface.co'], '.hf.co', false),
    { what: 'accounts.spotify.com', who: 'office-space' as const, detail: 'not connected', active: false },
  ]
  const lede = egressLede(fresh)

  assert.match(lede, /is reaching none of them right now/)
  assert.doesNotMatch(lede, /is reaching \d+ host/, 'a fresh install claimed to be reaching something')
})

test('and it still counts a host that really is live', () => {
  // The other direction, so the fix above is not just "always say none".
  const lede = egressLede([
    ...speechEgress(['huggingface.co'], '.hf.co', false),
    { what: 'api.spotify.com', who: 'office-space' as const, detail: 'connected', active: true },
  ])
  assert.match(lede, /is reaching 1 host of its own/)
})
