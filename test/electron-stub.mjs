/**
 * The two pieces of Electron `spotify/store.ts` reaches for, and nothing else.
 *
 * That module was the last entry in `every-module-is-aimed-at.test.ts`, parked because it
 * imports `electron` at module scope: in plain Node the import throws — *"electron does not
 * provide an export named app"* — because the package resolves to a path string rather than the
 * API. So the module could not be loaded, let alone driven.
 *
 * A resolver hook swaps this in for `electron`, which is enough. What it stubs is deliberately
 * small: `app.getPath` for two paths, and `safeStorage` for the keychain. Those are exactly the
 * two things the module's own comment says need Electron — *"What is left here is the file read
 * and the keychain"* — and everything else it does was extracted to `token-file.ts` and
 * `network-switch.ts` so it could be tested without any of this.
 *
 * ## The encryption is legible on purpose
 *
 * `encryptString` prefixes rather than encrypting. A stub that produced real ciphertext would let
 * a test pass while asserting nothing: this repository has already been caught once by a fake
 * that "encrypted" by prefixing, where the assertion checked the *fake's* behaviour and the
 * token was readable the whole time. Legible output means a test that mistakes the crypt for
 * real protection fails loudly rather than quietly agreeing with itself.
 *
 * `OFFICE_STUB_USERDATA` steers `getPath`, so a test can point the store at a temporary
 * directory rather than writing credentials into whatever `/tmp` path this file picked.
 */

const PREFIX = 'stub-encrypted:'

export const app = {
  getPath: (what) => `${process.env['OFFICE_STUB_USERDATA'] ?? '/tmp/office-stub'}/${what}`,
}

/**
 * What the keychain was asked to do, so a test can assert the store *used* it.
 *
 * The distinction matters more than it looks. A test that reads the file and checks the token is
 * not in it is asserting about **this stub's** encryption, not the store's — and since this stub
 * encrypts by prefixing, that assertion fails on a perfectly correct store. Which is exactly
 * what happened when this file was written: the warning below was already in it.
 *
 * `asked` counts calls to `isEncryptionAvailable`, because on macOS that call is the one that can
 * put the Keychain password panel in front of somebody. A test that wants to say "nothing here
 * asked" has to be able to count the asking, and the arrays above only record the doing.
 */
export const keychain = { encrypted: [], decrypted: [], asked: 0 }

export const safeStorage = {
  isEncryptionAvailable: () => {
    keychain.asked += 1
    return process.env['OFFICE_STUB_NO_KEYCHAIN'] !== '1'
  },
  encryptString: (plain) => {
    keychain.encrypted.push(plain)
    return Buffer.from(PREFIX + plain, 'utf8')
  },
  decryptString: (blob) => {
    keychain.decrypted.push(Buffer.from(blob))
    const text = Buffer.from(blob).toString('utf8')
    // A blob this stub did not write is one it cannot read, which is the case the store has to
    // survive: a file from another machine, or a keychain that has rotated underneath it.
    if (!text.startsWith(PREFIX)) throw new Error('not encrypted by this keychain')
    return text.slice(PREFIX.length)
  },
}

export default { app, safeStorage }
