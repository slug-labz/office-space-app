/**
 * Types for the Electron stub, so the one test that reads its recorder is not `any`.
 *
 * The stub is `.mjs` rather than `.ts` because a module resolver hook loads it by URL, outside
 * the TypeScript program — `tsx` never sees it, so it has to be runnable as written.
 */
export declare const app: { getPath(what: string): string }

/** What the keychain was asked to do, so a test can assert the store used it. */
export declare const keychain: { encrypted: string[]; decrypted: Buffer[]; asked: number }

export declare const safeStorage: {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(blob: Buffer): string
}
