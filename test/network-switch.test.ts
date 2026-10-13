/**
 * The master network switch, and the three answers it can give.
 *
 * `store.ts` had **no test at all** before this file. Not by neglect — every entry point ran
 * through `app.getPath('userData')`, so a `node:test` import of the module dies at `electron`
 * before an assertion runs. The module holding the Spotify credential and the switch that decides
 * whether this app talks to the network was the one module nothing could reach.
 *
 * That is the whole reason the bug below survived. `readSwitch` takes the path as an argument so
 * these tests can hand it a real file; `networkAllowed()` is the one line that still needs
 * Electron. Same split `approvals.ts` makes between `triage` and `triageAgainst`, for the same
 * reason.
 *
 * ## What was wrong
 *
 * One `try`, returning `true` on any failure. "Never set" and "set to off, but I could not read
 * it" were the same answer, and the answer was the permissive one — so a torn write left the
 * network switched back on, and the panel reported `on` because on is what it now was. Nothing
 * lied; nothing could tell you either.
 *
 * No attacker is needed. `setNetworkAllowed` wrote with a bare `writeFileSync`, so a crash or a
 * power cut during the flip produced exactly the half-file that reads as on.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, chmod, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { readSwitch, writeSwitch } from '../src/main/spotify/network-switch.js'

import { tempDir } from './temp-dir.js'

async function dir(t: TestContext): Promise<string> {
  return tempDir(t, 'network-switch-')
}

test('a switch nobody has ever touched is on, because that is the documented default', async (t) => {
  // The one case where absent really does mean empty: no file, never set, and the feature ships
  // enabled. `ENOENT` is the only error that may be read this way.
  assert.equal(readSwitch(join(await dir(t), 'network.json')), 'on')
})

test('a switch somebody turned off is off', async (t) => {
  const path = join(await dir(t), 'network.json')
  await writeFile(path, JSON.stringify({ allowed: false }, null, 2))
  assert.equal(readSwitch(path), 'off')
})

test('a switch somebody turned back on is on', async (t) => {
  const path = join(await dir(t), 'network.json')
  await writeFile(path, JSON.stringify({ allowed: true }, null, 2))
  assert.equal(readSwitch(path), 'on')
})

test('a torn file is not a switch that is on', async (t) => {
  // The bug, and it needs no attacker: a crash mid-flip leaves the prefix of the intended bytes.
  // Read as `on`, the network the user had just switched off is back, silently, on next launch.
  const path = join(await dir(t), 'network.json')
  const whole = JSON.stringify({ allowed: false }, null, 2)
  await writeFile(path, whole.slice(0, Math.floor(whole.length / 2)))

  assert.equal(
    readSwitch(path),
    'unreadable',
    'a half-written switch read as a setting rather than as an unreadable file',
  )
})

test('a file we are not allowed to read is not a switch that is on', async (t) => {
  const path = join(await dir(t), 'network.json')
  await writeFile(path, JSON.stringify({ allowed: false }, null, 2))
  await chmod(path, 0o000)

  assert.equal(readSwitch(path), 'unreadable', 'EACCES was rounded to the permissive default')
})

test('a shape we do not recognise is on rather than unreadable', async (t) => {
  // The line between "cannot read this" and "read it, and it does not say off". Valid JSON we do
  // not understand is a file some future version wrote, not a request to switch anything off —
  // and treating it as unreadable would disable the feature on every upgrade that adds a field.
  const path = join(await dir(t), 'network.json')
  await writeFile(path, JSON.stringify({ allowed: 'nope', added: 'by a later version' }))
  assert.equal(readSwitch(path), 'on')

  const empty = join(await dir(t), 'network.json')
  await writeFile(empty, JSON.stringify({}))
  assert.equal(readSwitch(empty), 'on')
})

test('null is unreadable rather than a crash', async (t) => {
  // `JSON.parse('null')` succeeds and then `.allowed` throws. Inside the same try on purpose:
  // an exception escaping this function would take out whichever caller asked.
  const path = join(await dir(t), 'network.json')
  await writeFile(path, 'null')
  assert.equal(readSwitch(path), 'unreadable')
})

test('the file the writer produces is one the reader understands', async (t) => {
  // The two halves live in different functions and nothing else checks they agree. Round-tripped
  // rather than asserted by hand: a format assertion written from the same head that wrote the
  // writer agrees with itself, which is not the same as the two halves agreeing.
  const path = join(await dir(t), 'network.json')

  writeSwitch(path, false)
  assert.equal(readSwitch(path), 'off')

  writeSwitch(path, true)
  assert.equal(readSwitch(path), 'on')
})

test('the write is atomic, so a reader never catches half of it', async (t) => {
  // The torn file this whole module exists for was produced by a bare `writeFileSync`, which
  // truncates the real file and *then* fills it. Temp-then-rename means the file at the real path
  // is only ever the whole old one or the whole new one.
  //
  // The first version of this test asserted no temp file was left behind. It passed — and it
  // passed under a mutation that wrote straight to the real path, because a direct write leaves
  // no temp file either. A check that cannot fail for the right reason is not a check.
  //
  // The inode is what actually separates them, and it was measured rather than assumed:
  // `writeFileSync` truncates in place and keeps the inode, `rename` puts a *different* file
  // where the old one was. So a changed inode is proof the bytes arrived by rename.
  const where = await dir(t)
  const path = join(where, 'network.json')

  writeSwitch(path, false)
  const first = (await stat(path)).ino
  writeSwitch(path, true)
  const second = (await stat(path)).ino

  assert.notEqual(
    first,
    second,
    'the file was truncated and rewritten in place rather than renamed over, so a reader can ' +
      'catch it empty — which is exactly the torn file that used to read as `on`',
  )
  assert.equal(readSwitch(path), 'on')

  const left = (await readdir(where)).filter((name) => name !== 'network.json')
  assert.deepEqual(left, [], 'a temp file survived the write')
})

test('the writer creates the directory it needs', async (t) => {
  // First-ever flip on a fresh machine: `userData/spotify/` does not exist yet, and a switch that
  // throws on the first click is a switch nobody can turn off.
  const path = join(await dir(t), 'spotify', 'network.json')
  writeSwitch(path, false)
  assert.equal(readSwitch(path), 'off')
})
