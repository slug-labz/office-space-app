/**
 * Where the refresh token lives.
 *
 * It is the only long-lived secret this app has ever held, and it is worth being exact about
 * what it is: a bearer credential that can read what somebody is listening to and control their
 * playback until they revoke it. Not their password, not their library — but not nothing, and
 * the difference between a file and the keychain is the difference between "anything that can
 * read your home directory has it" and "the OS decided".
 *
 * So: `safeStorage`, which is the macOS Keychain, libsecret on Linux and DPAPI on Windows. The
 * ciphertext goes in the app's own user-data directory, never in `.office-space/` — that holds
 * facts about a *project* and is shared if the project is shared, and a credential in a
 * repository is the accident this project would least like to cause.
 *
 * **Encryption is not assumed to be available.** On a Linux box with no keyring, `safeStorage`
 * says so. The answer is to refuse to store rather than to fall back to plaintext: the user is
 * told the account cannot be remembered on this machine, which is a worse feature and an honest
 * one. There is no third option where we write the token in the clear and do not mention it.
 */

import { app, safeStorage } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { readSwitch, writeSwitch } from './network-switch.js'
import { blobFor, tokensFrom } from './token-file.js'
import type { NetworkSetting } from '../../shared/ipc.js'
import type { Tokens } from '../../shared/spotify/auth.js'
import type { Store } from './client.js'

/** Under `userData`, so it is per-machine and per-user and travels with neither the repo nor a project. */
export function tokenPath(): string {
  return join(app.getPath('userData'), 'spotify', 'account.bin')
}

/** What a person is told when this machine cannot encrypt. Said by `write`, and by connect before the browser opens. */
export const CANNOT_STORE = 'this machine cannot encrypt, so the account will not be stored'

/**
 * True when this machine can encrypt. False is a real answer, and the person reads it when they
 * press Connect with a client id. Asking is not free (see `read`): `read` asks whenever an account
 * file exists — once at startup, and on every player or command call while connected — and not
 * while there is no account file.
 */
export function canRemember(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function tokenStore(): Store {
  return {
    async read(): Promise<Tokens | null> {
      // The file is looked for **before** the keychain is asked. On a Mac whose login keychain
      // cannot be found, asking is a modal system panel — and for a person who has never
      // connected, it would be raised at startup for an account that does not exist. A missing
      // file is "not connected" by itself and needs no answer from `safeStorage`.
      let bytes: Buffer
      try {
        bytes = await readFile(tokenPath())
      } catch {
        // Missing or unreadable. The same answer as a blob that will not decrypt, and for the
        // same reason: there is no account here.
        return null
      }
      // There is a blob, so now the question is real. No keychain means we cannot read it, and
      // we do not guess.
      if (!canRemember()) return null
      try {
        // The decision is in `token-file.ts`, which takes its crypto as an argument and can
        // therefore be tested. What is left here is the file read and the keychain, which are
        // the two things that need Electron.
        return tokensFrom(bytes, safeStorage)
      } catch {
        return null
      }
    },

    async write(tokens: Tokens | null): Promise<void> {
      const path = tokenPath()
      if (tokens === null) {
        // Disconnecting deletes the file. Not an empty write — a zero-byte credential file is a
        // thing somebody has to reason about later.
        await rm(path, { force: true })
        return
      }
      if (!canRemember()) throw new Error(CANNOT_STORE)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, blobFor(tokens, safeStorage), { mode: 0o600 })
    },
  }
}

/**
 * The Spotify client id, which is configuration rather than a secret.
 *
 * Kept beside the token and not inside it, because they have different lifetimes and different
 * sensitivities: the id identifies an app somebody registered and survives disconnecting, while
 * the token is a credential and does not. Plain JSON, deliberately — encrypting a value that is
 * sent in the clear in every authorize URL would be security theatre, and theatre in this file
 * would make the encryption next to it harder to trust.
 */
function clientIdPath(): string {
  return join(app.getPath('userData'), 'spotify', 'client-id.json')
}

export function readClientId(): string {
  try {
    const parsed = JSON.parse(readFileSync(clientIdPath(), 'utf8')) as { clientId?: unknown }
    return typeof parsed.clientId === 'string' ? parsed.clientId : ''
  } catch {
    // Never configured, or unreadable. Both mean the feature is not set up, which is the
    // ordinary state and not an error to report.
    return ''
  }
}

export function writeClientId(clientId: string): void {
  const path = clientIdPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ clientId }, null, 2))
}

/**
 * The master network switch.
 *
 * Stored beside the client id and read by {@link gated} on **every** request, so switching it
 * off stops the next call rather than the next restart. Default on: the switch exists so that
 * somebody can stop the app reaching out, not so that every install starts with a feature
 * silently disabled and no clue why it does nothing.
 */
function switchPath(): string {
  return join(app.getPath('userData'), 'spotify', 'network.json')
}

export function networkAllowed(): NetworkSetting {
  return readSwitch(switchPath())
}

export function setNetworkAllowed(allowed: boolean): void {
  writeSwitch(switchPath(), allowed)
}
