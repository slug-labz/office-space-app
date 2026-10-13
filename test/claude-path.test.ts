/**
 * Finding the `claude` the office is supposed to run.
 *
 * The product rests on "if `claude` works in your terminal, this works", and a GUI app on macOS
 * does not get your terminal's PATH. Launched from the Dock it inherits `launchd`'s
 * environment — no nvm, no shims, none of `.zshrc`. So a bare `claude` finds nothing, and the
 * failure only shows up for people who launch it the way people launch applications.
 *
 * This is the real shape of the bug that turned up on this machine: `claude` installed under
 * one node version, the version manager defaulting to another, and a fresh shell finding
 * nothing at all.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

import { missingMessage, resolveClaude } from '../src/main/claude-path.js'
import { readFile } from 'node:fs/promises'

import { tempDir } from './temp-dir.js'

async function home(t: TestContext): Promise<string> {
  return tempDir(t, 'office-home-')
}

async function install(dir: string, name = 'claude'): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, name)
  await writeFile(path, '#!/bin/sh\n')
  await chmod(path, 0o755)
  return path
}

test('an explicit override wins over everything else', async (t) => {
  const h = await home(t)
  const override = await install(join(h, 'somewhere'))
  await install(join(h, '.claude', 'local'))

  const found = await resolveClaude({ home: h, override, path: '' })

  assert.equal(found.state, 'found')
  assert.equal(found.state === 'found' && found.how, 'override')
  assert.equal(found.state === 'found' && found.path, override)
})

test('an override that is wrong is reported as missing, not quietly replaced', async (t) => {
  // Using a different binary than the one somebody named would be worse than failing.
  const h = await home(t)
  await install(join(h, '.claude', 'local'))

  const found = await resolveClaude({ home: h, override: join(h, 'nope', 'claude'), path: '' })

  assert.equal(found.state, 'missing')
})

test('PATH is used when it has one, and resolved to an absolute path', async (t) => {
  const h = await home(t)
  const dir = join(h, 'bin')
  const path_ = await install(dir)

  const found = await resolveClaude({ home: h, path: dir })

  assert.equal(found.state === 'found' && found.how, 'path')
  assert.equal(found.state === 'found' && found.path, path_)
})

test('the real failure: installed under a node version that is not on PATH', async (t) => {
  // Exactly what happened here — claude under v18, nvm defaulting to v22, a fresh shell seeing
  // only v22, and the app inheriting a PATH with neither.
  const h = await home(t)
  await mkdir(join(h, '.nvm', 'versions', 'node', 'v22.16.0', 'bin'), { recursive: true })
  const real = await install(join(h, '.nvm', 'versions', 'node', 'v18.17.0', 'bin'))

  const found = await resolveClaude({ home: h, path: join(h, '.nvm', 'versions', 'node', 'v22.16.0', 'bin') })

  assert.equal(found.state === 'found' && found.how, 'installed')
  assert.equal(found.state === 'found' && found.path, real)
})

test('an app launched from the Dock, with no useful PATH at all, still finds it', async (t) => {
  const h = await home(t)
  const real = await install(join(h, '.claude', 'local'))

  const found = await resolveClaude({ home: h, path: '/usr/bin:/bin' })

  assert.equal(found.state === 'found' && found.path, real)
})

test('newest version manager directory is preferred', async (t) => {
  const h = await home(t)
  await install(join(h, '.nvm', 'versions', 'node', 'v18.17.0', 'bin'))
  const newest = await install(join(h, '.nvm', 'versions', 'node', 'v22.16.0', 'bin'))

  const found = await resolveClaude({ home: h, path: '' })

  assert.equal(found.state === 'found' && found.path, newest, 'the one that gets upgraded')
})

/**
 * `system: []` is not boilerplate, and it is here because these three tests once passed for the
 * wrong reason.
 *
 * Every other candidate the resolver tries is built from the injected `home`, so pointing `home`
 * at a temp directory controls what is found. Two are not: `/opt/homebrew/bin/claude` and
 * `/usr/local/bin/claude` are absolute and were read off the real machine whatever the test said.
 * They were empty on both of our machines, so "nothing is installed" was true by luck.
 *
 * The moment one of us symlinked `claude` into `/opt/homebrew/bin` — to fix an unrelated PATH
 * problem — all three started finding a real binary and failing. Saying `system: []` is the test
 * stating the machine it means: one with nothing installed anywhere.
 */
test('a file that exists but cannot be executed is not it', async (t) => {
  const h = await home(t)
  const dir = join(h, 'bin')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'claude'), 'not executable')
  await chmod(join(dir, 'claude'), 0o644)

  assert.equal((await resolveClaude({ home: h, path: dir, system: [] })).state, 'missing')
})

test('when there is nothing, every place looked is reported', async (t) => {
  const h = await home(t)

  const found = await resolveClaude({ home: h, path: '/nowhere', system: [] })

  assert.equal(found.state, 'missing')
  assert.ok(found.state === 'missing' && found.looked.length > 3, 'so a person can act on it in a minute')
})

test('a system location IS searched by default — the product must not opt out', async () => {
  // The other half of the same fact, and the one that would break silently if somebody "fixed"
  // the three tests above by deleting the two paths instead of injecting them.
  const found = await resolveClaude({ home: '/home/someone', path: '', system: ['/opt/homebrew/bin/claude'] })
  const looked = found.state === 'missing' ? found.looked : [found.path]
  assert.ok(looked.includes('/opt/homebrew/bin/claude'), 'Homebrew is where a lot of people have it')
})

test('the message names the fix rather than the symptom', () => {
  const message = missingMessage(['/a/claude', '/b/claude'])

  assert.match(message, /OFFICE_CLAUDE_PATH/)
  assert.match(message, /which claude/)
  assert.match(message, /launched from the Dock/)
})

/**
 * The paths survive being many, because many is the only case a real failure has.
 *
 * `docs/release-checklist.md` §3 says that when `claude` is not found "the app names every path it
 * looked in -- check that list rather than guessing", and this module's header promises *"I looked
 * in these six places and it is in none of them"*. Above six entries both were false: the message
 * replaced the list with the words "10 places", which is the bare count the header calls useless.
 *
 * Six is not a threshold a failing Mac can get under. Measured on 2026-10-01 against the packaged
 * v0.0.1 build, driving the shipped `dist/main/claude-path.js` out of `app.asar` with a home that
 * has nothing installed and `launchd`'s own PATH -- `/usr/bin:/bin:/usr/sbin:/sbin`, which is what
 * an app opened from the Dock inherits and the whole reason this module exists -- it looked in ten
 * places and printed *"Looked in 10 places."* Four of those are PATH and six are install
 * locations, and `installedLocations` returns at least six on any POSIX machine, so the only
 * inputs that get under the threshold are an explicit `OFFICE_CLAUDE_PATH` and an empty PATH.
 *
 * The sibling test above -- "every place looked is reported" -- passed throughout, because it reads
 * `found.looked` rather than the sentence a person is shown.
 *
 * The count is kept beside the list. What it may not do is stand in for it.
 */
test('every place looked is named in the message, however many there are', async (t) => {
  const h = await home(t)
  const found = await resolveClaude({
    path: ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter),
    home: h,
    system: ['/nowhere/opt/homebrew/bin/claude', '/nowhere/usr/local/bin/claude'],
  })
  assert.equal(found.state, 'missing')
  const looked = found.state === 'missing' ? found.looked : []
  assert.ok(looked.length > 6, `the threshold this test exists for, and ${looked.length} is what a bare Mac reaches`)

  const message = missingMessage(looked)

  for (const path of looked) {
    assert.ok(message.includes(path), `the message does not name ${path}, so the list has to be guessed`)
  }
  // Useful, and kept -- this is not an argument against saying how many.
  assert.match(message, new RegExp(`${looked.length} places`))
})

// ───────────────────────────────────────────── not assuming the machines we happen to have ──

/**
 * We do not claim Windows works. Neither machine has one, and an exit condition nobody can run
 * is an aspiration with a checkbox — so the agreed rule is the narrower one: **no path handling,
 * spawn or storage code assumes POSIX.**
 *
 * That rule is only worth anything if it can be checked, which is why `platform` is a parameter.
 * It is the only way to ask for the other answer from a Mac.
 */

test('on Windows the search looks for the shim, not the bare name', async () => {
  // An npm-installed CLI on Windows is `claude.cmd`. The bare name is not executable, so a
  // search for `claude` finds nothing while `claude` works perfectly in the user's terminal —
  // the same class of failure this module was written for in the first place.
  const found = await resolveClaude({ home: '/home/someone', path: '/somewhere', platform: 'win32' })

  assert.equal(found.state, 'missing')
  const looked = found.state === 'missing' ? found.looked : []
  assert.ok(looked.some((p: string) => p.endsWith('claude.cmd')), 'never looked for a .cmd shim')
  assert.ok(looked.some((p: string) => p.endsWith('claude.exe')), 'never looked for an .exe')
})

test('on a POSIX host it does not go looking for Windows shims', async () => {
  // The rule cuts both ways: a Mac searching for `claude.cmd` is noise in the "we looked here"
  // list somebody reads when it cannot be found.
  const found = await resolveClaude({ home: '/home/someone', path: '/somewhere', platform: 'darwin', system: [] })
  const looked = found.state === 'missing' ? found.looked : []

  assert.ok(!looked.some((p: string) => p.endsWith('.cmd') || p.endsWith('.exe')))
  assert.ok(looked.some((p: string) => p.endsWith('/claude')))
})

test('Windows install locations are searched, and they are Windows ones', async () => {
  const found = await resolveClaude({ home: 'C:\\Users\\someone', platform: 'win32' })
  const looked = found.state === 'missing' ? found.looked : []

  // Not /opt/homebrew and not /usr/local — those are a POSIX assumption wearing a search list.
  assert.ok(!looked.some((p: string) => p.startsWith('/opt/') || p.startsWith('/usr/')))
  assert.ok(looked.some((p: string) => p.toLowerCase().includes('appdata')), 'no npm-on-Windows location')
})

test('the PATH is split the way the host splits it', async () => {
  // `path.delimiter`, not `':'`. Already correct — pinned so it stays that way, because this is
  // exactly the line somebody "simplifies" later.
  const source = await readFile(new URL('../src/main/claude-path.ts', import.meta.url), 'utf8')
  assert.match(source, /split\(delimiter\)/)
  assert.ok(!/split\(':'\)/.test(source), 'PATH is split on a hard-coded colon')
})
