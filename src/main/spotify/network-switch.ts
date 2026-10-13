/**
 * The master network switch, on disk.
 *
 * Its own module for one reason: `store.ts` imports `electron` at the top level, so importing it
 * from a `node:test` file dies at `does not provide an export named 'app'` before an assertion
 * runs. That is why the module holding the Spotify credential and the switch deciding whether
 * this app talks to the network had **no test at all**, and it is why the bug below survived.
 *
 * Everything here takes a path. `store.ts` keeps the one line that knows where that path is, and
 * therefore the one line that needs Electron. Same split `approvals.ts` makes between `triage`
 * and `triageAgainst`, and `reconcile.ts`/`safe-path.ts` for the same reason.
 *
 * ## The bug this fixes
 *
 * The read was one `try` returning `true` on any failure, so three situations collapsed into the
 * permissive answer:
 *
 * | on disk | meant | answered |
 * |---|---|---|
 * | no file | never set | on — correct, that is the documented default |
 * | `{"allowed": false}` | switched off | off — correct |
 * | half a file | switched off, write was torn | **on** |
 * | file, `EACCES` | switched off, cannot read it | **on** |
 *
 * Neither of the last two needs an attacker. The write was a bare `writeFileSync`, so a crash or
 * a power cut while the toggle was being flipped left exactly that half-file, and the next launch
 * came up with the network switch somebody had deliberately turned off switched back on. The
 * panel then said `on` — truthfully, because on is what it now was. Nothing lied. Nothing could
 * tell them either.
 *
 * `absent is not empty`, standing order 4. `ENOENT` is the one failure that honestly means "never
 * set"; every other one is a setting we could not read, which is a third answer rather than a
 * shade of the first. `ledger.ts:428` draws the same line for the same reason.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { NetworkSetting } from '../../shared/ipc.js'

/**
 * What the switch says.
 *
 * `unreadable` holds the network **off** in every caller. The comment this replaces defended
 * failing open — *"a corrupt file must not silently disable a feature, because 'it stopped
 * working and nothing said why' is the failure this whole panel exists to prevent"* — and that
 * objection is right, and it is an objection to **silently**. So the panel names this state and
 * one click on the toggle rewrites the file and clears it. What it cannot be is the other
 * direction: a control about consent that quietly re-permits is worse than a feature that visibly
 * stops, because the person cannot see it happen.
 */
export function readSwitch(path: string): NetworkSetting {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'on'
    return 'unreadable'
  }
  try {
    const parsed = JSON.parse(text) as { allowed?: unknown }
    // Explicitly `false` and nothing else. Valid JSON we do not recognise is a file some later
    // version wrote, not a request to switch off — reading it as unreadable would disable the
    // feature on every upgrade that adds a field.
    return parsed.allowed === false ? 'off' : 'on'
  } catch {
    // Torn, truncated, or not JSON. Somebody set this to something and we cannot tell what.
    return 'unreadable'
  }
}

/**
 * Write it atomically, so the torn file above stops being produced in the first place.
 *
 * Temp-then-`rename` is what `ledger.ts:449` and `registry.ts:228` already do, and `rename(2)` is
 * atomic: a reader sees the whole old file or the whole new one, never half of either. This
 * setting was the odd one out, and it was the one where a torn read failed open.
 */
export function writeSwitch(path: string, allowed: boolean): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify({ allowed }, null, 2)}\n`)
  renameSync(temp, path)
}
