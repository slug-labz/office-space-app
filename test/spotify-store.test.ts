/**
 * Where the Spotify credential lives, and what happens to it.
 *
 * The last module in the census. Parked because it imports `electron` at module scope, which
 * throws in plain Node — so it could not be loaded, and "loads fine, no test" was not even true
 * of it. A resolver hook swapping in `test/electron-stub.mjs` is all it needed.
 *
 * It is thin by design: its decisions were extracted to `token-file.ts` and `network-switch.ts`
 * precisely so they could be tested, and both are. What is left is the file and the keychain —
 * and that is not nothing, because this is the one file in the product that holds a credential.
 *
 * ## What is actually at stake here
 *
 * **Disconnecting deletes.** `write(null)` removes the file rather than writing an empty one,
 * because *"a zero-byte credential file is a thing somebody has to reason about later"*. A user
 * who disconnects has said take it off my machine, and a truncated file is not that.
 *
 * **The mode is 0600.** Nothing else in this repository writes a credential, so nothing else
 * has a reason to check a file mode — and a wrong one is invisible until somebody looks, which
 * for a token means until it has already been readable by every process on the machine.
 *
 * **Unreadable is the same as absent.** A blob that will not decrypt and a file that is not
 * there are both "there is no account here". A store that threw on the first would take the app
 * down over a keychain that had rotated.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { tempDir } from './temp-dir.js'

/**
 * Swap `electron` for the stub, before anything imports the module under test.
 *
 * `register` affects imports made after it runs, so the store is pulled in dynamically below
 * rather than at the top of the file. A static import would be hoisted above this and would
 * throw on the real package, which is the failure this whole file exists to get past.
 */
register(new URL('./electron-resolver.mjs', import.meta.url))

type Store = typeof import('../src/main/spotify/store.js')

/** A fresh userData directory per test, so no test can read another's credential. */
async function fresh(t: TestContext): Promise<{ store: Store; userData: string; tokenFile: () => Promise<string> }> {
  const userData = await tempDir(t, 'office-spotify-')
  process.env['OFFICE_STUB_USERDATA'] = userData
  delete process.env['OFFICE_STUB_NO_KEYCHAIN']
  // Imported once, not per test.
  //
  // The first version appended `?fresh=${userData}` to force a new module instance, on the
  // assumption that `tokenPath()` captured its directory at load. It does not — it calls
  // `app.getPath()` every time, so the stub's environment variable is read fresh anyway and the
  // cache-buster bought nothing.
  //
  // It cost something, though: coverage attributes by URL, so every `store.js?fresh=/tmp/...`
  // was a URL the report had never heard of, and the module read as 42% covered while eight
  // tests exercised it and four mutations against it were caught. A number that disagreed with
  // the mutations, and the mutations were right.
  const store = (await import('../src/main/spotify/store.js')) as Store
  return { store, userData, tokenFile: async () => store.tokenPath() }
}

const TOKENS = {
  accessToken: 'an-access-token',
  refreshToken: 'a-refresh-token',
  expiresAt: 1_800_000_000_000,
}

test('the token lands under userData, not somewhere ambient', async (t) => {
  const { store, userData } = await fresh(t)
  const path = store.tokenPath()
  assert.ok(path.startsWith(userData), `the token path is ${path}, which is outside ${userData}`)
  assert.match(path, /spotify/, 'the token is not filed under a spotify directory')
})

test('a stored token is written encrypted, and only the owner can read the file', async (t) => {
  const { store } = await fresh(t)
  await store.tokenStore().write(TOKENS as never)

  const path = store.tokenPath()
  const onDisk = await readFile(path)
  const { keychain } = await import('./electron-stub.mjs')

  // Asserted against the *keychain*, not against the bytes.
  //
  // The first version of this read the file and checked the refresh token was not in it — and
  // failed, correctly, on a store that is doing the right thing. This stub encrypts by
  // prefixing, so the plaintext genuinely is in the file, and that assertion was about the stub
  // rather than about the code. It is the same fake this repository was caught by once before,
  // met from the other side: there the test passed while the token was readable, here it failed
  // while the token was handled correctly. Both are the same mistake — measuring the harness.
  //
  // What can be asserted is that the store handed the token to the keychain and wrote back
  // exactly what the keychain returned. Whether that output is really unreadable is Electron's
  // guarantee, not this suite's, and no test here can borrow it.
  const asked = keychain.encrypted.filter((plain) => plain.includes(TOKENS.refreshToken))
  assert.ok(
    asked.length > 0,
    'the token was never handed to safeStorage, so whatever reached the disk was not encrypted by anything',
  )
  assert.deepEqual(
    [...onDisk],
    [...Buffer.from('stub-encrypted:' + asked[0], 'utf8')],
    'what is on disk is not what the keychain handed back — something between them is writing its own bytes',
  )
  assert.ok(onDisk.length > 0, 'the credential file is empty')

  const mode = (await stat(path)).mode & 0o777
  assert.equal(
    mode.toString(8),
    '600',
    `the credential file is mode ${mode.toString(8)}. Nothing else in this product writes a ` +
      `secret, so nothing else would notice — and a token at 644 is readable by every process ` +
      `running as anybody on the machine.`,
  )
})

test('what was written comes back', async (t) => {
  const { store } = await fresh(t)
  await store.tokenStore().write(TOKENS as never)
  const back = await store.tokenStore().read()
  assert.deepEqual(back, TOKENS, 'the token did not survive a round trip through the file and the keychain')
})

test('disconnecting deletes the file rather than emptying it', async (t) => {
  const { store } = await fresh(t)
  await store.tokenStore().write(TOKENS as never)
  await stat(store.tokenPath()) // it is there

  await store.tokenStore().write(null)

  await assert.rejects(
    () => stat(store.tokenPath()),
    /ENOENT/,
    'disconnecting left the credential file behind. A zero-byte or stale credential file is a ' +
      'thing somebody has to reason about later, and the person who disconnected asked for it to ' +
      'be gone.',
  )
  assert.equal(await store.tokenStore().read(), null, 'the store still reports an account after disconnecting')
})

test('no file is no account, rather than an error', async (t) => {
  const { store } = await fresh(t)
  assert.equal(await store.tokenStore().read(), null)
})

test('a blob this machine cannot decrypt is no account either', async (t) => {
  // A file copied from another machine, or a keychain that has rotated underneath it. Throwing
  // here would take the app down over a credential it merely cannot use.
  const { store } = await fresh(t)
  const path = store.tokenPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.from('not something this keychain wrote'))

  assert.equal(
    await store.tokenStore().read(),
    null,
    'an undecryptable credential threw instead of reading as "there is no account here"',
  )
})

test('a machine that cannot encrypt refuses to store, rather than storing in the clear', async (t) => {
  const { store } = await fresh(t)
  process.env['OFFICE_STUB_NO_KEYCHAIN'] = '1'

  assert.equal(store.canRemember(), false)
  assert.equal(await store.tokenStore().read(), null, 'it read a token on a machine with no keychain')

  await assert.rejects(
    () => store.tokenStore().write(TOKENS as never),
    /cannot encrypt/i,
    'a machine with no keychain wrote the credential anyway — refusing is the only safe answer, ' +
      'because the alternative is a token on disk in the clear',
  )
  delete process.env['OFFICE_STUB_NO_KEYCHAIN']
})

test('the client id is kept beside the token and not inside it', async (t) => {
  // Deliberately plain JSON: the id identifies an app somebody registered, is sent in the clear
  // in every authorize URL, and survives disconnecting. Encrypting it would be theatre, and
  // theatre in this file would make the encryption next to it harder to trust.
  const { store } = await fresh(t)
  assert.equal(store.readClientId(), '', 'an unset client id should read as empty, not throw')

  store.writeClientId('a-registered-app-id')
  assert.equal(store.readClientId(), 'a-registered-app-id')

  assert.notEqual(
    store.tokenPath(),
    join(dirname(store.tokenPath()), 'client-id.json'),
    'the id and the credential are the same file, and they have different lifetimes',
  )
})

test('the network switch is a file beside the token, and survives a restart', async (t) => {
  // The master switch is the one setting in this feature that is *about* the network rather than
  // on it. It has to persist, and it has to be its own file: folded into the credential it would
  // be deleted by disconnecting, so somebody who turned the app's network access off and then
  // signed out would find it back on.
  const { store, userData } = await fresh(t)

  store.setNetworkAllowed(false)
  assert.equal(store.networkAllowed(), 'off', 'the switch did not come back as it was set')

  store.setNetworkAllowed(true)
  assert.equal(store.networkAllowed(), 'on')

  // Beside the token, not inside it — asserted against `off`, deliberately.
  //
  // The first version set the switch to `on` and checked it was still `on` after disconnecting.
  // A missing switch file reads as `on` by design — "not so that every install starts with a
  // feature silently disabled and no clue why it does nothing" — so that assertion passed
  // whether the setting survived or was wiped and defaulted. Mutating `switchPath()` to return
  // the credential's path left it green.
  //
  // `off` is the only value that can tell those apart: it is not the default, so if it comes
  // back the file is genuinely still there.
  store.setNetworkAllowed(false)
  await store.tokenStore().write(TOKENS as never)
  await store.tokenStore().write(null)
  assert.equal(
    store.networkAllowed(),
    'off',
    'disconnecting the account reset the network switch. Those are two different decisions with ' +
      'two different lifetimes, and one of them is about whether this app reaches the network at ' +
      'all — so a sign-out that silently re-enables egress is the wrong way round.',
  )
  assert.ok(userData.length > 0)
})

test('a switch file that cannot be read is held off, not assumed on', async (t) => {
  // `unreadable` is a third state and it exists because the safe reading of "I do not know" is
  // "make no requests". Defaulting to `on` would mean a corrupt file quietly re-enabled egress.
  const { store } = await fresh(t)
  const path = join(store.tokenPath(), '..', 'network.json')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.from('not json at all'))

  assert.notEqual(
    store.networkAllowed(),
    'on',
    'an unreadable switch file reads as permission to make requests. The honest answer to "I ' +
      'cannot tell" is to stay off.',
  )
})
