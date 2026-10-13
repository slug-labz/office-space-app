/**
 * The keychain is not asked before there is an account to ask it about.
 *
 * On macOS, `safeStorage.isEncryptionAvailable()` is the call that can put the Keychain password
 * panel in front of somebody. It used to run at launch and on the music panel's first refresh,
 * on a machine that had never connected Spotify — a password prompt for a feature the person had
 * not touched. Three paths reached it: `spotify.connected()` at handler registration, the
 * renderer's first `player()`, and the `musicSetup` answer's `canRemember`.
 *
 * ## Two kinds of assertion, and which is which
 *
 * **Run code** (1-5, 11, and the second half of 8): the real `tokenStore()` against the electron
 * stub, the real `Spotify` client built on that store, and the real `connect()`. The stub counts
 * every `isEncryptionAvailable` call in `keychain.asked`, so "nothing asked" is a number and not a
 * belief. In 8, the run-code part is that `CANNOT_STORE` is exactly the message `write()` rejects
 * with when there is no keychain. 11 is the path an empty client id falls through to: `connect`
 * refuses it in its own sentence, without the keychain, the network or the browser.
 *
 * **Read source** (6, 7, the first half of 8, 9, 10): `main.ts` cannot be imported in a test — it
 * starts an Electron app — so the handlers are checked the way `privacy.test.ts` checks it, by
 * reading the file. These are weaker: they pin where the call is written, not that it runs. They
 * are here because the only alternative is no check on the wiring at all. 8 pins the shape of the
 * `musicConnect` guard (`if (musicClientId.trim() && !canRemember()) return { ok: false, problem:
 * CANNOT_STORE }`) and that it precedes `spotifyConnect(`; 10 walks every `.ts` under `src/`
 * (comments stripped) and pins which files may name `safeStorage` and `canRemember` at all.
 *
 * The ORDER in `main.ts` — that an empty client id is never put to the keychain — is pinned by
 * reading source only, for the same reason: `main.ts` cannot be imported. 11 shows the far side of
 * that order is safe; it cannot show that `main.ts` gets there.
 *
 * ## What no command here can check
 *
 * The real macOS Keychain panel. This suite runs against a stub in plain Node, with no Keychain
 * and no Electron. It pins the **call** — that on an empty machine nothing makes it — and not the
 * **panel**. Whether a person is actually left unprompted is a thing to see on a Mac.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { tempDir } from './temp-dir.js'

// Before anything imports the store; see `spotify-store.test.ts` for why this is not a static import.
register(new URL('./electron-resolver.mjs', import.meta.url))

type Store = typeof import('../src/main/spotify/store.js')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const TOKENS = {
  accessToken: 'an-access-token',
  refreshToken: 'a-refresh-token',
  expiresAt: 1_800_000_000_000,
}

/** A fresh, empty userData, and the stub's counters at zero. */
async function fresh(t: TestContext) {
  const userData = await tempDir(t, 'office-keychain-')
  process.env['OFFICE_STUB_USERDATA'] = userData
  delete process.env['OFFICE_STUB_NO_KEYCHAIN']
  const store = (await import('../src/main/spotify/store.js')) as Store
  const { keychain } = await import('./electron-stub.mjs')
  keychain.asked = 0
  keychain.encrypted.length = 0
  keychain.decrypted.length = 0
  return { store, keychain, userData }
}

/** A client whose network is a trap: any request at all is a failure. */
function clientOn(store: Store) {
  const reached: string[] = []
  const { Spotify } = clientModule
  const client = new Spotify({
    clientId: 'id',
    store: store.tokenStore(),
    now: () => 0,
    fetch: (async (input: string | URL | Request) => {
      reached.push(String(input))
      throw new Error('fetch was called with no account stored')
    }) as typeof globalThis.fetch,
  })
  return { client, reached }
}

// Loaded after `register`, like the store: it imports nothing from electron today, but the order
// costs nothing and the day it does the suite will not break.
const clientModule = await import('../src/main/spotify/client.js')

// ──────────────────────────────────────────────────────────── run code ──

test('1. no account file: read is null and the keychain was never asked', async (t) => {
  const { store, keychain } = await fresh(t)
  assert.equal(await store.tokenStore().read(), null)
  assert.equal(
    keychain.asked,
    0,
    `reading a store with no file asked the keychain ${keychain.asked} time(s). On a Mac that is a ` +
      `password panel for an account that does not exist.`,
  )
})

test('2. the real client with no account: disconnected, no request, keychain never asked', async (t) => {
  const { store, keychain } = await fresh(t)
  const { client, reached } = clientOn(store)

  assert.equal(await client.connected(), false)
  assert.deepEqual(await client.player(), { state: 'disconnected' })
  assert.deepEqual(reached, [], 'a request was made with no account stored')
  assert.equal(
    keychain.asked,
    0,
    `connected() and player() asked the keychain ${keychain.asked} time(s) with no account. These ` +
      `are the registration-time and first-refresh paths.`,
  )
})

test('3. with an account stored, read returns it and the keychain IS asked', async (t) => {
  // The control. Without it, the zero in the tests around this one would also be the answer from
  // a store that never asks, and so never decrypts, and so never reads anything back.
  const { store, keychain } = await fresh(t)
  await store.tokenStore().write(TOKENS as never)
  keychain.asked = 0

  assert.deepEqual(await store.tokenStore().read(), TOKENS)
  assert.ok(keychain.asked >= 1, 'a stored account was read back without ever asking the keychain')
})

test('4. a file with no keychain reads as null, and a write is refused without writing', async (t) => {
  const { store, keychain } = await fresh(t)
  await store.tokenStore().write(TOKENS as never)
  const before = await readFile(store.tokenPath())
  const decryptedBefore = keychain.decrypted.length

  process.env['OFFICE_STUB_NO_KEYCHAIN'] = '1'
  try {
    assert.equal(await store.tokenStore().read(), null, 'it read a token on a machine with no keychain')
    assert.equal(keychain.decrypted.length, decryptedBefore, 'it tried to decrypt with no keychain')

    const other = { accessToken: 'plain-access-xyz', refreshToken: 'plain-refresh-xyz', expiresAt: 1 }
    await assert.rejects(() => store.tokenStore().write(other as never), /cannot encrypt/i)

    const after = await readFile(store.tokenPath())
    assert.deepEqual([...after], [...before], 'the refused write changed the file')
    assert.ok(!after.toString('utf8').includes('plain-refresh-xyz'), 'the refused token reached the disk in the clear')
  } finally {
    delete process.env['OFFICE_STUB_NO_KEYCHAIN']
  }
})

test('5. disconnect removes the file, and afterwards read is null with zero asks', async (t) => {
  const { store, keychain } = await fresh(t)
  await store.tokenStore().write(TOKENS as never)
  await stat(store.tokenPath())

  await store.tokenStore().write(null)
  keychain.asked = 0

  await assert.rejects(() => stat(store.tokenPath()), /ENOENT/)
  assert.equal(await store.tokenStore().read(), null)
  assert.equal(keychain.asked, 0, 'after disconnecting, reading asked the keychain about an account that is gone')
})

// ───────────────────────────────────────────────────────── read source ──

/** Source with comments removed, so a sentence about `canRemember(` is not a call to it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

/** From the handler's `CHANNEL.<name>` to the next `ipcMain.handle(`, or the end of the file. */
function handlerBody(main: string, channel: string): string {
  const start = main.indexOf(`ipcMain.handle(CHANNEL.${channel}`)
  assert.notEqual(start, -1, `main.ts has no handler for CHANNEL.${channel} — has it moved?`)
  const next = main.indexOf('ipcMain.handle(', start + 1)
  return main.slice(start, next === -1 ? undefined : next)
}

async function mainSource(): Promise<string> {
  return withoutComments(await readFile(join(root, 'src/main/main.ts'), 'utf8'))
}

test('6. the musicSetup handler says nothing about the keychain', async () => {
  const body = handlerBody(await mainSource(), 'musicSetup')
  assert.ok(!/canRemember/.test(body), 'the musicSetup handler still mentions canRemember — the first refresh asks the keychain')
})

test('7. MusicSetup and the music panel no longer carry canRemember', async () => {
  const ipc = withoutComments(await readFile(join(root, 'src/shared/ipc.ts'), 'utf8'))
  const at = ipc.indexOf('interface MusicSetup')
  assert.notEqual(at, -1, 'ipc.ts has no MusicSetup interface — has it moved?')
  const end = ipc.indexOf('\n}', at)
  assert.ok(!/canRemember/.test(ipc.slice(at, end)), 'MusicSetup still has a canRemember member')

  const panel = withoutComments(await readFile(join(root, 'src/renderer/views/music.ts'), 'utf8'))
  assert.ok(!/canRemember/.test(panel), 'the music panel still reads canRemember')
})

/**
 * The guard, whitespace-tolerant:
 * `if (musicClientId.trim() && !canRemember()) return { ok: false, problem: CANNOT_STORE }`.
 * Without the `musicClientId.trim() &&` an empty id still reaches the keychain, which is the
 * regression this pins. `\b` after CANNOT_STORE so `CANNOT_STORE_OTHER` is a different problem.
 */
const GUARD =
  /if\s*\(\s*musicClientId\s*\.\s*trim\s*\(\s*\)\s*&&\s*!\s*canRemember\s*\(\s*\)\s*\)\s*return\s*\{\s*ok\s*:\s*false\s*,\s*problem\s*:\s*CANNOT_STORE\b\s*\}/

test('8. musicConnect refuses with CANNOT_STORE before spotifyConnect(, and that is the store\'s own sentence', async (t) => {
  const main = await mainSource()
  const calls = main.match(/canRemember\(/g) ?? []
  assert.equal(calls.length, 1, `canRemember( appears ${calls.length} times in main.ts, expected exactly 1`)

  const body = handlerBody(main, 'musicConnect')
  const asks = body.indexOf('canRemember(')
  const opens = body.indexOf('spotifyConnect(')
  assert.notEqual(asks, -1, 'the musicConnect handler does not ask canRemember( — the refusal has moved or gone')
  assert.notEqual(opens, -1, 'the musicConnect handler no longer calls spotifyConnect( — has it moved?')
  assert.ok(asks < opens, 'canRemember( comes after spotifyConnect( — the browser opens before the refusal')

  // What the guard does, not only where it is written: an inverted test, a missing `return`, or a
  // different problem would all leave the three indexOf checks above green.
  const guard = GUARD.exec(body)
  assert.ok(
    guard,
    'musicConnect has no `if (musicClientId.trim() && !canRemember()) return { ok: false, problem: ' +
      'CANNOT_STORE }` — the guard is missing the client-id condition (an empty id reaches the keychain), ' +
      'inverted, does not return, or refuses with a different problem',
  )
  assert.ok(guard.index < opens, 'the refusing guard sits after spotifyConnect( — the browser opens first')

  // Run code: the sentence Connect shows and the sentence the store rejects with cannot drift apart.
  const { store } = await fresh(t)
  assert.equal(typeof store.CANNOT_STORE, 'string')
  assert.ok(store.CANNOT_STORE.length > 0, 'CANNOT_STORE is empty')
  process.env['OFFICE_STUB_NO_KEYCHAIN'] = '1'
  try {
    await assert.rejects(
      () => store.tokenStore().write(TOKENS as never),
      (err: unknown) => err instanceof Error && err.message === store.CANNOT_STORE,
    )
  } finally {
    delete process.env['OFFICE_STUB_NO_KEYCHAIN']
  }
})

test('11. connect with an empty or blank client id refuses in its own sentence: no keychain, no fetch, no browser', async (t) => {
  // The far side of the guard in 8: an empty id skips `canRemember()` in main.ts and lands here.
  const { keychain } = await fresh(t)
  const { connect } = await import('../src/main/spotify/connect.js')
  const reached: string[] = []
  const trap = (async (input: string | URL | Request) => {
    reached.push(String(input))
    throw new Error('fetch was called with no client id')
  }) as typeof globalThis.fetch
  const noBrowser = async (url: string) => {
    reached.push(url)
    throw new Error('the browser was opened with no client id')
  }

  for (const id of ['', '   ']) {
    const result = await connect(id, trap, noBrowser)
    assert.equal(result.ok, false)
    assert.equal(result.tokens, null)
    assert.match(result.problem ?? '', /No Spotify client id/)
  }
  assert.deepEqual(reached, [], 'connect reached the network or the browser with no client id')
  assert.equal(keychain.asked, 0, `connect asked the keychain ${keychain.asked} time(s) for an empty client id`)
})

test('9. main.ts does not reach safeStorage itself', async () => {
  // Checked on 2026-10-09: nothing else in main.ts uses `safeStorage`, so this is file-wide.
  const main = await mainSource()
  assert.ok(!/safeStorage/.test(main), 'main.ts references safeStorage directly; the keychain belongs to store.ts')
})

test('10. tree-wide: safeStorage only in store.ts; canRemember only in store.ts and main.ts', async () => {
  const src = join(root, 'src')
  const entries = await readdir(src, { recursive: true })
  const files = entries.filter((e) => e.endsWith('.ts')).map((e) => e.split(sep).join('/'))
  // Absent is not empty: a walk that found nothing would pass every "appears only in" below.
  for (const needed of ['main/spotify/store.ts', 'main/main.ts', 'main/spotify/token-file.ts']) {
    assert.ok(files.includes(needed), `the walk of src/ did not find ${needed} (found ${files.length} .ts files)`)
  }

  const safeStorageIn: string[] = []
  const canRememberIn: string[] = []
  for (const file of files) {
    const code = withoutComments(await readFile(join(src, file), 'utf8'))
    if (/\bsafeStorage\b/.test(code)) safeStorageIn.push(`src/${file}`)
    if (/\bcanRemember\b/.test(code)) canRememberIn.push(`src/${file}`)
  }
  assert.deepEqual(
    safeStorageIn.sort(),
    ['src/main/spotify/store.ts'],
    'safeStorage is reached outside store.ts — another path to the keychain prompt',
  )
  assert.deepEqual(
    canRememberIn.sort(),
    ['src/main/main.ts', 'src/main/spotify/store.ts'],
    'canRemember is used somewhere other than store.ts and main.ts — another path to the keychain prompt',
  )
})
