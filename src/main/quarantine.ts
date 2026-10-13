/**
 * Whether macOS still has this app flagged as downloaded.
 *
 * Office Space is **not signed by Apple**. That is a decision rather than an omission — signing
 * is a $99/year Developer membership, it buys a smoother first thirty seconds rather than a
 * better app, and `docs/release.md` records why it has not been bought. `build.mac.identity` is
 * `null` in `package.json` to say so explicitly.
 *
 * The cost lands on exactly one person: somebody who downloads the DMG through a browser.
 * macOS marks everything that arrives that way with an extended attribute called
 * `com.apple.quarantine`, and it lifts that mark by itself only for apps Apple has signed. So
 * an unsigned app is refused, and the refusal does not read as "unsigned" — on Apple Silicon it
 * reads as
 *
 * > **"Office Space" is damaged and can't be opened. You should move it to the Trash.**
 *
 * which is a sentence about a corrupt download, about a virus, about anything but a missing
 * receipt. The DMG carries `INSTALL.txt` and `Fix permissions.command` for the person who has
 * not got in yet. This module is for the person who *has*.
 *
 * ## Why say anything to somebody who is plainly already inside
 *
 * Because getting in and clearing the flag are different acts. Approving the app once in
 * Privacy & Security launches it and leaves `com.apple.quarantine` exactly where it was, so the
 * same wall is still standing: for the next update, for a copy moved to another folder, and for
 * anybody they hand the app to. Saying "you are past it, and here is the one command that
 * removes it for good" costs one line and closes the loop.
 *
 * ## The rule, in its least forgiving form
 *
 * Four answers, and only one of them speaks. Off macOS the flag is not a thing that exists, and
 * that is **not** the same as an app that has been checked and found clean. A check that could
 * not run is a third thing again. Reporting any of those as "clear" would be the office
 * inventing a fact about somebody's machine, which is the fourth standing order at the point it
 * is easiest to break.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** macOS's own name for "this arrived from the internet and nobody has vouched for it". */
const FLAG = 'com.apple.quarantine'

/**
 * Named absolutely, for the reason `claude-path.ts` exists.
 *
 * An app launched from the Dock inherits `launchd`'s `PATH`, not the user's. `/usr/bin` is in
 * it — but relying on that when the location is fixed and known would be a shrug where a fact
 * will do.
 */
const XATTR = '/usr/bin/xattr'

export type Quarantine =
  /** The flag is on the bundle. The one answer worth telling somebody about. */
  | { readonly state: 'quarantined'; readonly appPath: string }
  /** Checked, and it is not there. */
  | { readonly state: 'clear' }
  /** Not macOS, or not running from a bundle at all. There is no question to answer. */
  | { readonly state: 'not-applicable' }
  /** We could not tell. Say nothing rather than guess. */
  | { readonly state: 'unknown'; readonly cause: string }

/**
 * The `.app` bundle an executable is running inside, or null when it is not inside one.
 *
 * Pure, and separate from the check, because the two fail for unrelated reasons and only one of
 * them needs a subprocess to test. Run from a clone — `npm start` — `execPath` is Electron's own
 * binary under `node_modules`, which is nobody's download and carries no flag.
 */
export function bundlePath(execPath: string): string | null {
  const marker = '.app/Contents/MacOS/'
  const at = execPath.indexOf(marker)
  return at === -1 ? null : execPath.slice(0, at + '.app'.length)
}

/**
 * Ask macOS whether the running app is still flagged.
 *
 * `platform` is injectable so the macOS-only rule is testable somewhere other than a Mac — and
 * so the check is proven to be skipped rather than merely observed to return nothing.
 */
export async function appQuarantine(
  execPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<Quarantine> {
  if (platform !== 'darwin') return { state: 'not-applicable' }

  const appPath = bundlePath(execPath)
  if (appPath === null) return { state: 'not-applicable' }

  let listed: string
  try {
    // Every attribute, rather than `xattr -p com.apple.quarantine`. `-p` exits non-zero both
    // when the attribute is absent — which is an answer, and the good one — and when the
    // command could not run at all, which is not an answer. One exit code standing for both
    // means the two get told apart by parsing an error message, and that is how "we could not
    // check" quietly becomes "we checked and it is fine".
    ;({ stdout: listed } = await run(XATTR, [appPath]))
  } catch (err) {
    return { state: 'unknown', cause: `could not read the attributes on ${appPath}: ${(err as Error).message}` }
  }

  return listed.split('\n').some((line) => line.trim() === FLAG)
    ? { state: 'quarantined', appPath }
    : { state: 'clear' }
}

/**
 * What to tell somebody whose copy is still flagged.
 *
 * Names the cause and the price of the fix in the same breath. The temptation is to write
 * "macOS security settings are preventing…", which is true, useless, and reads as the app
 * blaming the operating system for a bill this project decided not to pay.
 */
export function quarantineMessage(appPath: string): string {
  return [
    `macOS has ${appPath} marked as downloaded, which is why it refused to open it —`,
    'and why it may have called it damaged, which it is not.',
    'The mark is lifted automatically only for apps signed by Apple, and signing means a',
    '$99/year Developer membership this project has deliberately not bought.',
    'You are past it for now; the mark is still there and the next update will hit the same wall.',
    'One command removes it for good.',
  ].join(' ')
}
