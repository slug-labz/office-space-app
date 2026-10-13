/**
 * A token set that is not whole is not an account.
 *
 * `spotify/store.ts` holds the Spotify credential and was the last module in the repository that
 * no test could import — `import { app, safeStorage } from 'electron'` at module scope. The
 * decision inside it is now in `token-file.ts`, which takes its crypto as an argument.
 *
 * ## Why `null` is the safe direction here
 *
 * Every failure answers `null`, and they really are the same answer to a caller: missing,
 * unreadable, encrypted by a keychain entry that has since gone, decrypted to something that is
 * not JSON, or whole JSON missing a field. All of them mean *there is no account here*, and the
 * only useful thing to do about any of them is ask the person to sign in again.
 *
 * That is unusual for this repository, which spends most of its time refusing to collapse
 * "absent" into "empty". The difference is the recovery: `null` here means *sign in again*, which
 * is obvious and one click. A half-trusted token does not fail here — it fails later and further
 * away, as a 401 nobody can trace back to this file.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { blobFor, tokensFrom, type Crypt } from '../src/main/spotify/token-file.js'
import type { Tokens } from '../src/shared/spotify/auth.js'

/** A keychain that works: reversible, and obviously not real encryption. */
const working: Crypt = {
  encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decryptString: (blob) => {
    const text = blob.toString('utf8')
    if (!text.startsWith('enc:')) throw new Error('not encrypted by this keychain')
    return text.slice(4)
  },
}

/** A keychain that has forgotten the entry — what happens after a keyring is reset. */
const forgotten: Crypt = {
  encryptString: () => Buffer.from('', 'utf8'),
  decryptString: () => {
    throw new Error('the key for this blob is gone')
  },
}

const whole: Tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: 1_800_000_000_000 }

test('a whole token set round-trips', () => {
  // The control, first. Every other test here asserts `null`, and a `tokensFrom` that returned
  // `null` unconditionally would pass all of them.
  assert.deepEqual(tokensFrom(blobFor(whole, working), working), whole)
})

test('a blob the keychain can no longer decrypt is not an account', () => {
  // The real one: macOS keychain reset, a new login keyring on Linux, a restored machine. The
  // file is there and its contents are unreadable forever.
  assert.equal(tokensFrom(blobFor(whole, working), forgotten), null)
})

test('a blob that decrypts to something that is not JSON is not an account', () => {
  assert.equal(tokensFrom(Buffer.from('enc:not json at all', 'utf8'), working), null)
})

test('a token set missing any field is not an account, field by field', () => {
  // Not trusted in pieces. A partial set does not fail here — it fails later, as a 401 nobody
  // can trace back to this file.
  for (const missing of ['accessToken', 'refreshToken', 'expiresAt'] as const) {
    const partial: Record<string, unknown> = { ...whole }
    delete partial[missing]
    const blob = Buffer.from(`enc:${JSON.stringify(partial)}`, 'utf8')
    assert.equal(tokensFrom(blob, working), null, `a set with no ${missing} was accepted`)
  }
})

test('a field of the wrong type is not an account either', () => {
  // The shape an older version writes. `expiresAt: "soon"` is the one that matters most: it is
  // truthy, so a check for presence passes and every comparison downstream is `NaN`.
  for (const wrong of [
    { ...whole, expiresAt: 'soon' },
    { ...whole, accessToken: 42 },
    { ...whole, refreshToken: null },
  ]) {
    const blob = Buffer.from(`enc:${JSON.stringify(wrong)}`, 'utf8')
    assert.equal(tokensFrom(blob, working), null, `${JSON.stringify(wrong)} was accepted`)
  }
})

test('an expiry that is not a finite number is not an account', () => {
  // `NaN` and `Infinity` are numbers, so `typeof === 'number'` lets them through — and both read
  // as a time that will never arrive or has always passed. JSON cannot carry them directly, but
  // it can carry `1e999`, which parses to `Infinity`.
  const blob = Buffer.from(`enc:{"accessToken":"a","refreshToken":"r","expiresAt":1e999}`, 'utf8')
  assert.equal(tokensFrom(blob, working), null, 'an infinite expiry was accepted as a time')
})

test('null and an empty object are not accounts', () => {
  // `JSON.parse('null')` succeeds, and then every field read on it throws. Inside the same try
  // on purpose — an exception escaping here would take out whichever caller asked.
  assert.equal(tokensFrom(Buffer.from('enc:null', 'utf8'), working), null)
  assert.equal(tokensFrom(Buffer.from('enc:{}', 'utf8'), working), null)
})

test('the credential goes through the keychain rather than around it', () => {
  // The one property of `blobFor` that is checkable here, and the first version of this test was
  // not it. It asserted the *bytes* did not contain the refresh token — which is a property of
  // the fake, not of `blobFor`: this fake "encrypts" by prefixing, so of course the token is
  // still readable in its output. Real `safeStorage` would obscure it, so the assertion passed
  // or failed on how the double was written and told you nothing about the code.
  //
  // What is actually checkable: `blobFor` hands the whole token set to the crypt and returns
  // exactly what the crypt gave back. A version that wrote the JSON directly — the failure this
  // module exists to prevent — never calls it.
  const asked: string[] = []
  const watched: Crypt = {
    encryptString: (plain) => {
      asked.push(plain)
      return Buffer.from('sealed', 'utf8')
    },
    decryptString: () => {
      throw new Error('not used here')
    },
  }

  const blob = blobFor(whole, watched)

  assert.equal(asked.length, 1, 'the keychain was not asked to encrypt anything')
  assert.deepEqual(JSON.parse(asked[0]!), whole, 'something other than the token set was encrypted')
  assert.equal(blob.toString('utf8'), 'sealed', 'what the keychain returned is not what gets written')
})
