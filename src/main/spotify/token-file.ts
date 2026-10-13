/**
 * The credential on disk: what is written, and what a bad one counts as.
 *
 * Lifted out of `store.ts` for the reason `network-switch.ts` was: that module imports `electron`
 * at module scope, so nothing under `node:test` can load it, and the decisions in it could not be
 * reached. It was the last module in the repository in that state — `spotify/connect.ts` came off
 * the same list when its electron import turned out to exist for nothing but a default argument.
 *
 * Everything here takes its path and its crypto as arguments. `store.ts` keeps the two lines that
 * know where the file is and which keychain to use, and therefore the only lines that need
 * Electron.
 *
 * ## The rule worth testing
 *
 * **A token set that is not whole is not an account.** A blob written by an older version, or
 * half-written, or decrypted to something that is not JSON, is treated as absent rather than
 * trusted in pieces — because a partial token set does not fail here, it fails later and further
 * away, as a 401 nobody can trace back to this file.
 *
 * That is the fourth standing order on a credential, and it is the direction that is safe here:
 * `null` means "sign in again", which is recoverable and obvious. A half-trusted token means a
 * request that fails for a reason the app will report as something else.
 */

import type { Tokens } from '../../shared/spotify/auth.js'

/** Just enough of `safeStorage` to be handed a fake. */
export interface Crypt {
  decryptString(blob: Buffer): string
  encryptString(plain: string): Buffer
}

/**
 * Read a token set out of an encrypted blob, or decide there is not one.
 *
 * Every failure answers `null`, and they are genuinely the same answer to a caller: missing,
 * unreadable, encrypted by a keychain entry that has since gone, decrypted to something that is
 * not JSON, or whole JSON that is missing a field. All of them mean *there is no account here*,
 * and the only useful thing to do about any of them is ask the person to sign in again.
 */
export function tokensFrom(blob: Buffer, crypt: Crypt): Tokens | null {
  let parsed: Partial<Tokens>
  try {
    parsed = JSON.parse(crypt.decryptString(blob)) as Partial<Tokens>
  } catch {
    return null
  }

  // Checked field by field rather than by shape, because a missing `expiresAt` is the one that
  // silently becomes `NaN` in every comparison downstream and reads as "expired long ago".
  if (typeof parsed?.accessToken !== 'string') return null
  if (typeof parsed.refreshToken !== 'string') return null
  if (typeof parsed.expiresAt !== 'number') return null
  if (!Number.isFinite(parsed.expiresAt)) return null

  return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, expiresAt: parsed.expiresAt }
}

/** The bytes to write for a token set. Encrypted, always — this is the credential. */
export function blobFor(tokens: Tokens, crypt: Crypt): Buffer {
  return crypt.encryptString(JSON.stringify(tokens))
}
