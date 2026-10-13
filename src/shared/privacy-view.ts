/**
 * What the privacy panel says about a store, worked out apart from the DOM.
 *
 * These live in `shared/` rather than beside the measuring code for a reason that is about the
 * bundle rather than about tidiness: `main/privacy.ts` imports `node:fs/promises`, and a
 * renderer view importing a *value* from it would pull the filesystem into a sandboxed browser
 * context. Types cross that boundary freely because they are erased; functions must not.
 *
 * The judgement here is one sentence long and is the panel's whole claim to being trustworthy:
 * **`absent`, `empty` and `unreadable` are three different facts.** A workspace with no
 * `memory/` has never remembered anything. A `memory/` that exists and is empty has been
 * emptied. A directory that could not be read is evidence of neither. A panel that renders all
 * three as `0 B` is the fourth standing order broken in the one place somebody went looking for
 * the truth.
 */

/** Just enough of a measured store to describe it. Keeps this file free of `main/` entirely. */
export interface Sized {
  readonly state: 'present' | 'absent' | 'unreadable'
  readonly bytes: number
  readonly files: number
  /** Directories inside it that could not be opened. A number above zero means `bytes` is short. */
  readonly unreadable: number
}

/**
 * `1.2 MB`. Shown next to a path, so it has to be short and never scientific notation.
 *
 * One decimal below ten and none above, which is the scale that stays the same width as it
 * grows — `9.8 MB` and `340 MB` line up, `9.8 MB` and `340.2 MB` do not.
 */
export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** The size cell, in whichever of the three sentences is true. */
export function sizeLine(store: Sized): string {
  if (store.state === 'unreadable') return 'could not be read'
  if (store.state === 'absent') return 'never created'
  if (store.files === 0 && store.unreadable === 0) return 'empty'

  /*
   * *At least*, when part of it could not be opened.
   *
   * `walk` used to swallow a failed `readdir` and return what it had counted, so one locked
   * subdirectory turned 9,100 bytes into 100 and this printed it as a complete number. The store
   * itself being unreadable was already handled — that is `state`, and the line above says so.
   * A readable store with an unreadable *part* had no representation, so it came out as a
   * smaller true-looking figure.
   *
   * `at least` rather than a warning colour: the number is not wrong, it is a floor, and saying
   * which is the difference between a measurement and a guess. The count of what could not be
   * opened goes with it, because "some of it" invites the question this answers.
   */
  const size = store.files === 1 ? humanBytes(store.bytes) : `${humanBytes(store.bytes)} · ${store.files} files`
  if (store.unreadable === 0) return size
  const what = store.unreadable === 1 ? '1 folder' : `${store.unreadable} folders`
  return store.files === 0
    ? `${what} inside could not be read, so nothing here can be counted`
    : `at least ${size} — ${what} inside could not be read`
}


/** Just enough of an egress row to describe the set. Keeps this file free of `main/` entirely. */
export interface Reaches {
  readonly who: 'office-space' | 'the claude CLI'
  /**
   * Reachable right now, as opposed to merely configured.
   *
   * Read by {@link egressLede} so the sentence can tell *can reach* from *is reaching*. The
   * field was already on `Egress` for the rows; the lede needed it too the moment a feature
   * started declaring hosts it was not currently using.
   */
  readonly active: boolean
}

/**
 * The sentence above the egress list.
 *
 * It was a constant — *"Office Space makes no network requests of its own"* — and it was true
 * for exactly as long as the app had no features that reached anywhere. F4 landed a Spotify
 * controller, correctly declared its hosts, and correctly marked them `who: 'office-space'`,
 * and the sentence above them went on saying the opposite. That is the third standing order
 * broken in the one panel whose entire job is telling the truth about what leaves the machine.
 *
 * So it is derived. The `who` field was in the `Egress` type from the day it was written and
 * nothing had ever read it, because until now every row was the CLI. A claim that has to be
 * remembered when a feature lands is a claim that will eventually be wrong; a claim computed
 * from the rows underneath it cannot be.
 *
 * ## Can reach is not is reaching, and the first version of this conflated them
 *
 * The fix above counted rows and said *"reaches 3 hosts of its own"*. F4 lists its hosts
 * **whether or not an account is connected** — deliberately, because somebody opening this
 * panel is asking what the app *can* reach and a row that appears only after you have used it
 * answers the wrong question. Put together, a disconnected install read "reaches 3 hosts" while
 * reaching none.
 *
 * That is the same fault as the constant it replaced, pointing the other way: a sentence
 * overstating what is happening, in the panel whose whole job is not to. `active` already
 * carried the difference on every row; the lede now reads it.
 *
 * Three states, because two would force one of them to lie — the same reason the music has
 * four.
 */
export function egressLede(egress: readonly Reaches[]): string {
  const ours = egress.filter((e) => e.who === 'office-space')
  const live = ours.filter((e) => e.active).length
  const tail =
    'Everything else is the claude you already installed, or a server you have told it to reach.'

  // Nothing of ours at all. The original sentence, still true when it is true.
  if (ours.length === 0) {
    return `Office Space makes no network requests of its own. ${tail.replace('Everything else', 'Everything below')}`
  }

  // Declared but dormant: a feature exists and is switched off. The distinction matters most
  // here, because this is the state a privacy-conscious person is checking for.
  if (live === 0) {
    const what = ours.length === 1 ? 'one host' : `${ours.length} hosts`
    return `Office Space can reach ${what} of its own, marked below, and is reaching none of them right now. ${tail}`
  }

  // Named and counted. "Some" would be the same evasion in a longer word.
  return `Office Space is reaching ${live} host${live === 1 ? '' : 's'} of its own, marked below. ${tail}`
}


/** A server config that exists and would not open. Keeps this file free of `main/` entirely. */
export interface Unread {
  readonly path: string
  /** The reader's own words — a parse error, a permission error. Never a code. */
  readonly cause: string
}

/**
 * What the egress list has to admit when a server config would not open.
 *
 * `capabilities.ts` takes real care over this distinction — its own comment insists an
 * unreadable `.mcp.json` is reported as unreadable and **never** as zero servers, and
 * `McpSurvey` exists so that "no servers" can *"show that it looked, and where"*. All of that
 * reached the roster panel and stopped there. The privacy panel runs its own scan, lists every
 * server it found, and had no way to say that the list was short — so a config that would not
 * open rendered exactly like a machine with nothing configured.
 *
 * That is the same fault {@link egressLede} was written for, one field over: the panel whose
 * whole job is telling the truth about what leaves the machine, quietly saying less than it
 * knows. And it is the fourth standing order in the place it costs most — a shorter list is
 * the *reassuring* answer, so nobody goes looking.
 *
 * `null` when there is nothing to admit, so the caller renders no element at all rather than an
 * empty one.
 */
export function egressCaveat(unread: readonly Unread[]): string | null {
  if (unread.length === 0) return null

  const where = unread.map((u) => `${u.path} — ${u.cause}`).join('; ')
  const count = unread.length === 1 ? 'One server config' : `${unread.length} server configs`
  const hold = unread.length === 1 ? 'it holds' : 'they hold'

  return `${count} on this machine could not be read, so this list is short by however many servers ${hold}: ${where}. A file that will not open is not a file with no servers in it.`
}
