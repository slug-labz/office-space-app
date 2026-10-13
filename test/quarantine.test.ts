/**
 * The macOS download flag, and whether the office may say anything about it.
 *
 * The app is unsigned on purpose — signing is a $99/year Apple Developer membership this
 * project has not bought — so a copy that arrived through a browser is marked
 * `com.apple.quarantine` and refused, on Apple Silicon with the word *damaged*. The DMG ships an
 * install card and a fix script for the person who has not got in. This module is for the one
 * who has, and the whole of its job is to be sure before it speaks.
 *
 * Which makes the four states the point. Not-macOS, no bundle, checked-and-clean and
 * could-not-check are four different facts, and three of them are silent for three different
 * reasons. Collapsing any of them into "clear" would be the office reporting a check it never
 * ran — the fourth standing order, at the point it is easiest to break.
 *
 * The macOS-only rule is tested by *injecting* the platform rather than by branching on the
 * machine the suite happens to be running on. CI is Linux and we develop on macOS; a test that
 * only ever exercises one of them proves the rule on one platform and assumes it on the other.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { appQuarantine, bundlePath, quarantineMessage } from '../src/main/quarantine.js'

import { tempDir } from './temp-dir.js'

const run = promisify(execFile)

/** Where a packaged app's executable actually sits, which is what `process.execPath` reports. */
const inBundle = (app: string) => join(app, 'Contents', 'MacOS', 'Office Space')

/** A real `.app` directory on disk, so `xattr` has something to answer about. */
async function bundle(t: TestContext): Promise<string> {
  const dir = await tempDir(t, 'office-quarantine-')
  const app = join(dir, 'Office Space.app')
  await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true })
  await writeFile(inBundle(app), '#!/bin/sh\nexit 0\n')
  await chmod(inBundle(app), 0o755)
  return app
}

// ─────────────────────────────────────────────────────────────── finding the bundle ──

test('the bundle is the .app an executable is inside', () => {
  assert.equal(
    bundlePath('/Applications/Office Space.app/Contents/MacOS/Office Space'),
    '/Applications/Office Space.app',
  )
  // A path with spaces and a nested .app name is the ordinary case on macOS, not an edge one.
  assert.equal(
    bundlePath('/Users/x/Desktop/My Apps/Office Space.app/Contents/MacOS/Office Space'),
    '/Users/x/Desktop/My Apps/Office Space.app',
  )
})

test('running from a clone is not running from a bundle', () => {
  // `npm start` runs Electron's own binary out of node_modules. Nothing there was downloaded by
  // the user and nothing there is ours to be flagged.
  assert.equal(bundlePath('/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), '/repo/node_modules/electron/dist/Electron.app')
  assert.equal(bundlePath('/usr/local/bin/electron'), null)
  assert.equal(bundlePath('/repo/node_modules/.bin/electron'), null)
})

// ────────────────────────────────────────────────────────────────────── the check ──

test('off macOS the question is not asked at all', async () => {
  // Not "clear". The flag is a macOS concept and there is nothing on a Linux box that has been
  // checked and found clean — so the answer is that there is no question, and the step never
  // reaches the panel. Proved by injection rather than by watching a Mac return nothing.
  for (const platform of ['linux', 'win32', 'freebsd'] as const) {
    assert.deepEqual(
      await appQuarantine('/Applications/Office Space.app/Contents/MacOS/Office Space', platform),
      { state: 'not-applicable' },
      `${platform} has no such flag, and saying "clear" would be a check we never ran`,
    )
  }
})

test('off macOS it returns before it could run anything', async () => {
  // The stronger version of the rule above, and the one that survives somebody adding a second
  // branch later: a path that does not exist would make `xattr` fail, so a `not-applicable`
  // answer here can only mean the command was never reached.
  assert.deepEqual(
    await appQuarantine('/no/such/place/Office Space.app/Contents/MacOS/Office Space', 'linux'),
    { state: 'not-applicable' },
  )
})

test('not inside a bundle is not applicable either', async () => {
  assert.deepEqual(await appQuarantine('/repo/node_modules/.bin/electron', 'darwin'), {
    state: 'not-applicable',
  })
})

test('a flagged bundle is reported, with the path to fix', { skip: process.platform !== 'darwin' && 'needs macOS xattr' }, async (t) => {
  const app = await bundle(t)
  // The same attribute Safari writes, in the same shape: flags, timestamp, agent, UUID.
  await run('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0083;68acdf00;Safari;', app])

  assert.deepEqual(await appQuarantine(inBundle(app), 'darwin'), { state: 'quarantined', appPath: app })
})

test('an unflagged bundle is clear', { skip: process.platform !== 'darwin' && 'needs macOS xattr' }, async (t) => {
  const app = await bundle(t)

  assert.deepEqual(await appQuarantine(inBundle(app), 'darwin'), { state: 'clear' })
})

test('clearing the flag is what the office tells people to run, and it works', { skip: process.platform !== 'darwin' && 'needs macOS xattr' }, async (t) => {
  // The command in the panel and in `Fix permissions.command` is `xattr -cr`. If that line ever
  // stops clearing what this check looks for, the office is handing out a fix that does not fix
  // it — and both halves would still pass their own tests.
  const app = await bundle(t)
  await run('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0083;68acdf00;Safari;', app])

  await run('/usr/bin/xattr', ['-cr', app])

  assert.deepEqual(await appQuarantine(inBundle(app), 'darwin'), { state: 'clear' })
})

test('a bundle that is not there is unknown, not clear', { skip: process.platform !== 'darwin' && 'needs macOS xattr' }, async () => {
  // The failure this shape exists to prevent. `xattr -p` exits non-zero both for "no such
  // attribute" and for "no such file", so a check written around its exit code would report a
  // bundle it could not even find as clean.
  const answer = await appQuarantine('/no/such/place/Office Space.app/Contents/MacOS/Office Space', 'darwin')

  assert.equal(answer.state, 'unknown')
  assert.match(answer.state === 'unknown' ? answer.cause : '', /Office Space\.app/)
})

// ───────────────────────────────────────────────────────────────────── the message ──

test('the message names the cause and the price, not the operating system', () => {
  const said = quarantineMessage('/Applications/Office Space.app')

  assert.match(said, /\/Applications\/Office Space\.app/)
  assert.match(said, /signed by Apple/)
  // The decision, stated. "macOS security settings are preventing…" is true, useless, and reads
  // as the app blaming the OS for a bill this project chose not to pay.
  assert.match(said, /\$99/)
  // And it corrects the word macOS actually uses, which is the one that frightens people.
  assert.match(said, /damaged, which it is not/)
})
