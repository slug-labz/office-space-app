/**
 * Answering "what has this thing got of mine, and what leaves this machine".
 *
 * `persistence.ts` says what the stores *are*. This measures them on the actual disk and offers
 * to delete them, which is the difference between a documented policy and a property somebody
 * can check. The exit condition it is written against: *a user can see exactly what left the
 * machine, what is stored, where it is, and delete it in one action.*
 *
 * ## The egress list
 *
 * Office Space spawns the `claude` the user already installed and already logged into, and
 * renders the stream — the relationship a terminal emulator has to a shell. So the list starts
 * with that child process and whatever MCP servers it has been configured to reach. After them
 * come the hosts Office Space fetches from itself, the Spotify controller's and the speech
 * model's; `main.ts` hands each of those modules the fetch that `spotify/gate.ts` switches off.
 *
 * Not every row is a fetch. This app starts two programs that can download without one:
 * `hired-from.ts` runs `git clone` on a repository somebody typed, and `installWhisper` in
 * `voice/transcribe.ts` runs `brew install whisper-cpp`. Both ask the switch before they start,
 * and both are on the list — `hiringEgress` and `homebrewEgress` build their rows. None of those
 * rows is ever `active`: a clone and an install are one-offs somebody starts, and between them
 * nothing is reached.
 *
 * The fetch half is tested rather than asserted: `test/privacy.test.ts` greps the source for
 * `fetch`, `node:http`, `XMLHttpRequest` and friends and fails if one appears outside the modules
 * its `MAY_REACH_THE_NETWORK` names (and the dev harness's `mock.ts`, which it skips). A spawned
 * program is outside what that grep can see. A panel saying "no network" in an app that has
 * quietly grown a fetch is worse than no panel — it is the third standing order broken in the one
 * place a person went looking for the truth.
 *
 * ## Deleting
 *
 * Only `yours` stores can be deleted, and each on its own. Wiping the template would leave a
 * workspace with no agents, which is not a privacy action — it is breaking the app while
 * believing you protected something.
 */

import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { STORES, type Store } from './persistence.js'
import type { Source } from '../shared/hired-from.js'
import type { NetworkSetting } from '../shared/ipc.js'
import type { Unread } from '../shared/privacy-view.js'

/** One store, measured. */
export interface MeasuredStore extends Store {
  /**
   * `absent` is a real answer and not zero — a workspace with no `memory/` has never
   * remembered anything, which is different from having remembered nothing.
   */
  readonly state: 'present' | 'absent' | 'unreadable'
  readonly bytes: number
  /** Files, counted recursively. Zero for a single-file store that exists. */
  readonly files: number
  /**
   * Directories inside this store that could not be opened.
   *
   * Not the same as the store itself being unreadable — that is `state`. This is the store being
   * readable and the number under it being *short*, which had no representation at all: `walk`
   * returned what it had counted and said nothing, so one locked subdirectory turned 9,100 bytes
   * into 100 and the panel printed it as complete.
   */
  readonly unreadable: number
  /** Absolute, so the panel can say exactly where it is rather than approximately. */
  readonly where: string
}

/** Something this app, or the child it starts, can reach off this machine. */
export interface Egress {
  readonly what: string
  readonly who: 'office-space' | 'the claude CLI'
  readonly detail: string
  /** True when it is reachable right now. A configured MCP server that never answered is not. */
  readonly active: boolean
}

/**
 * The speech model's two rows, and why neither of them is ever `live`.
 *
 * `main.ts` built these inline as `active: !dictationReady`, which is the inverse of what
 * {@link Egress.active} documents — *"True when it is reachable right now."* Before the download
 * nothing has been reached; after it, the reason to reach is gone. Neither state is "right now".
 *
 * What that cost is visible on a fresh install, which is the screen a new user sees first: the
 * panel badged both hosts **live**, beside a sentence saying the download happens "the first time
 * you press the microphone" — a badge contradicting the line under it — and the lede read
 * *"Office Space is reaching 2 hosts of its own"* before it had reached any.
 *
 * It also made `egressLede`'s middle branch unreachable there. That branch exists for exactly
 * this workspace — *"can reach N hosts of its own … and is reaching none of them right now"* —
 * and its docstring says it was written because two states "would force one of them to lie".
 * Two rows reporting live on every fresh install meant the state it was written for never
 * rendered.
 *
 * Moved here from `main.ts` because no test can load that module, which is why an inverted
 * boolean sat in the privacy panel unnoticed.
 */
export function speechEgress(
  hosts: readonly string[],
  cdnSuffix: string,
  dictationReady: boolean,
): readonly Egress[] {
  const rows = [
    ...hosts.map((host) => ({ what: host, role: 'asked for the model file' })),
    { what: `*${cdnSuffix}`, role: "serves it — Hugging Face's CDN, where that request is sent" },
  ]
  return rows.map(({ what, role }) => ({
    what,
    who: 'office-space' as const,
    detail: dictationReady
      ? `Speech model — already downloaded, so nothing reaches this now. It ${role}. ` +
        'Dictation runs on this machine and sends nothing.'
      : `Speech model — one download, the first time you press the microphone. This ${role}. ` +
        'What you say is never sent anywhere.',
    // Never `live`, in either state. The detail above carries the difference between them,
    // which is a sentence rather than a badge because it is a difference about *when*.
    active: false,
  }))
}

/**
 * Where hiring reaches, and why none of it is ever `live` either.
 *
 * `hired-from.ts` clones a git source to read it: when somebody looks at a source, hires from it,
 * checks on who came from it, or takes their version. That is a request this app makes, to a host
 * a person typed, and this panel did not list it. A clone is a spawned program, so the scan that
 * keeps `fetch` out of unlisted modules never saw it.
 *
 * Two kinds of row. One for the capability, because the destination is whatever is typed into the
 * hiring panel, and listing only the hosts already used would answer *where has it been* when the
 * question is *where can it go*. Then one per host this office has already hired from, because
 * those are the ones a check reaches again.
 *
 * Never `active`, for the reason {@link speechEgress} gives: each clone is a one-off somebody
 * started, and between them nothing is reached.
 *
 * Hosts, not sources. A source is shown verbatim everywhere else, and a URL can carry a token
 * (`https://user:token@host/…`); only the host is a destination. A source this cannot place — a
 * path on this machine, `file://`, a remote helper — adds no row of its own, and the first row
 * still covers it.
 */
export function hiringEgress(sources: readonly Source[], network: NetworkSetting): readonly Egress[] {
  const employees = new Map<string, number>()
  for (const source of sources) {
    const host = source.kind === 'git' ? hostOf(source.at) : null
    if (host !== null) employees.set(host, (employees.get(host) ?? 0) + 1)
  }
  const off = network === 'on' ? null : heldOff(network, 'nothing is cloned')
  return [
    {
      what: 'any repository you hire from',
      who: 'office-space',
      detail:
        off === null
          ? 'Hiring — a git source is cloned when you look at it, hire from it, check on who came from ' +
            'it, or take their version, and never on its own. A checkout named as a directory is read ' +
            'where it stands and reaches nothing.'
          : `Hiring — ${off} A checkout named as a directory is still read where it stands.`,
      active: false,
    },
    ...[...employees].sort(([a], [b]) => (a < b ? -1 : 1)).map(([host, count]): Egress => {
      const came = `${count === 1 ? 'One employee here was' : `${count} employees here were`} hired from a repository on this host.`
      return {
        what: host,
        who: 'office-space',
        detail: off === null ? `Hiring — ${came} Checking on them clones it again.` : `Hiring — ${off} ${came}`,
        active: false,
      }
    }),
  ]
}

/** The two ways the switch holds these off, worded as the music rows in `main.ts` word them. */
function heldOff(network: Exclude<NetworkSetting, 'on'>, so: string): string {
  return network === 'off'
    ? `switched off, so ${so}.`
    : `the saved setting could not be read, so it is being held off and ${so}. Set the switch again in the music panel.`
}

/** The host a git remote names, or `null` for this machine and for anything this cannot place. */
function hostOf(at: string): string | null {
  const remote = at.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remote)) {
    try {
      const url = new URL(remote)
      return url.protocol === 'file:' ? null : url.hostname.toLowerCase() || null
    } catch {
      return null
    }
  }
  // `transport::address` hands the address to a helper program, and where that goes is the helper's.
  if (remote.includes('::')) return null
  // git's scp-like form, `[user@]host:path`, which git only reads as a remote when no slash comes
  // before the colon. One letter before it is a Windows drive, which is a path.
  const scp = /^(?:[^@/]+@)?([^:/]+):/.exec(remote)
  return scp && scp[1]!.length > 1 ? scp[1]!.toLowerCase() : null
}

/**
 * Dictation's program, installed through Homebrew, and why its row is never `live` either.
 *
 * `installWhisper` runs `brew install whisper-cpp` when somebody presses Install, and Homebrew
 * downloads it. The switch already stopped that — `installWhisper` asks before it starts brew —
 * but this panel did not say it could happen, so the list a person reads to learn what leaves the
 * machine was one short.
 *
 * Named as Homebrew rather than as a host, because where it downloads from is Homebrew's setting
 * and not ours: brew is started with this app's environment, which can point it at a mirror.
 * `ghcr.io` is where `brew info` says the program comes from without one.
 */
export function homebrewEgress(network: NetworkSetting): readonly Egress[] {
  return [
    {
      what: 'Homebrew',
      who: 'office-space',
      detail: network === 'on'
        ? "Dictation's program — brew install whisper-cpp, only when you press Install. Homebrew " +
          'downloads it from the servers it is set up to use, ghcr.io unless you have changed that. ' +
          'What else Homebrew sends, such as its own analytics, is set in Homebrew.'
        : `Dictation's program — ${heldOff(network, 'pressing Install refuses without starting brew')}`,
      active: false,
    },
  ]
}

export interface PrivacyReport {
  readonly root: string
  readonly stores: readonly MeasuredStore[]
  readonly egress: readonly Egress[]
  /**
   * The exact text of the last prompt this app sent, office blocks included.
   *
   * The largest thing Office Space sends is not a destination at all — it is the prompt it
   * assembles itself. `withOfficeContext()` prepends blocks to every message and the user never
   * sees them. Laptop 2 accepted this correction to the plan in round 19; this is the field it
   * asked for. `null` when nothing has been sent this session, which is not the same as empty.
   */
  readonly lastPrompt: string | null
  /**
   * Server configs that exist and would not open.
   *
   * `egress` is assembled from the servers a scan *found*, so a config that will not parse makes
   * the list shorter and says nothing. `capabilities.ts` already knows the difference — its
   * `SourceRead` keeps `missing` and `unreadable` apart all the way out, and `McpSurvey` exists
   * so "no servers" can show that it looked and where. This is the field that carries that as
   * far as the panel.
   *
   * Empty means the scan read everything it found, which is not the same as finding nothing.
   */
  readonly unreadSources: readonly Unread[]
}

/** Measure every store under `root`. */
export async function measure(
  root: string,
  lastPrompt: string | null,
  egress: readonly Egress[],
  // Required rather than defaulted: a caller that forgets it would report a clean scan, which
  // is the one wrong answer this field exists to prevent.
  unreadSources: readonly Unread[],
): Promise<PrivacyReport> {
  const stores = await Promise.all(STORES.map((store) => measureOne(root, store)))
  return { root, stores, egress, lastPrompt, unreadSources }
}

async function measureOne(root: string, store: Store): Promise<MeasuredStore> {
  const where = join(root, store.path)

  try {
    const info = await lstat(where)
    if (!info.isDirectory()) {
      // A single file, so there is no directory to have failed to open.
      return { ...store, state: 'present', bytes: info.size, files: 1, unreadable: 0, where }
    }
    // What ships is not yours, and the list lives on the store so `forget` below removes exactly
    // what this counted. They were two hard-coded lists and they disagreed — see `Store.shipped`.
    const { bytes, files, unreadable } = await walk(where, store.shipped ?? [])
    return { ...store, state: 'present', bytes, files, unreadable, where }
  } catch (err) {
    // ENOENT is "you have never used this", which is a fact. Anything else is a directory we
    // could not read, and reporting that as absent would be the fourth standing order broken
    // in the panel whose whole job is telling the truth about what is on disk.
    const absent = (err as NodeJS.ErrnoException).code === 'ENOENT'
    // The store itself could not be read, which `state` already says. Nothing was walked, so
    // nothing was skipped inside it.
    return { ...store, state: absent ? 'absent' : 'unreadable', bytes: 0, files: 0, unreadable: 0, where }
  }
}

/**
 * Recursive size and count. `skip` names direct children to leave out.
 *
 * ## `lstat`, never `stat`, in all three places it is used in this file
 *
 * This panel answers two questions and they have to agree: *what is under your workspace because
 * of this app*, and *what does Forget remove*. `rm` never follows a symlink — it unlinks the link
 * and leaves the target alone — so a measurement that follows one promises what the button cannot
 * deliver, and a **delete** that follows one destroys what the button never offered.
 *
 * The third use is the one that matters. `forget` branched on `stat(where).isDirectory()`, which
 * is true for a link *to* a directory, and then read that directory's entries **through the link**
 * and removed them one at a time. Measured, with `memory` linked at a Documents folder:
 *
 *     before:  Documents holds novel.txt, photos, taxes.pdf
 *     forget says: {"ok":true}
 *     after:   Documents holds (EMPTY)
 *
 * Somebody pressing a button that says it forgets what this app kept had a directory of their own
 * emptied, and was told it worked. `lstat` makes a link not-a-directory, so the same code takes
 * the `rm(where)` branch and unlinks it — which is exactly right, because the link is what is
 * under the workspace and the link is what should go.
 *
 * `unreadable` counts the directories that could not be opened. It exists because this returned
 * whatever it had counted so far and said nothing, so one locked subdirectory turned 9,100 bytes
 * into 100 and the panel printed it as a complete number:
 *
 *     both readable          state=present  files=2  bytes=9100
 *     one subdir unreadable  state=present  files=1  bytes=100
 *
 * The store's *own* failure was already handled — `state: 'unreadable'`, and the panel says "could
 * not be read". A subdirectory failing inside a readable store had no state at all, so it came out
 * as a smaller true-looking number. That is absent read as empty, in the panel whose whole job is
 * saying what is kept.
 */
async function walk(
  dir: string,
  skip: readonly string[],
): Promise<{ bytes: number; files: number; unreadable: number }> {
  let bytes = 0
  let files = 0
  let unreadable = 0

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return { bytes, files, unreadable: 1 }
  }

  for (const entry of entries) {
    if (skip.includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const inner = await walk(path, [])
      bytes += inner.bytes
      files += inner.files
      unreadable += inner.unreadable
    } else {
      try {
        // The link's own size, which is what is under the root and what `rm` reclaims.
        bytes += (await lstat(path)).size
        files += 1
      } catch {
        // Vanished between the listing and the stat. Not counting it is right; failing the
        // whole report over it is not.
      }
    }
  }

  return { bytes, files, unreadable }
}

export type ForgetOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * Delete one store.
 *
 * Refuses anything that is not a `yours` store, and refuses a path that is not in the list at
 * all — the argument arrives over IPC from a renderer, so "it must be one of these nine strings"
 * is the check, not "it looks like a safe path". A path check would be one clever traversal away
 * from deleting somebody's home directory.
 */
export async function forget(root: string, path: string): Promise<ForgetOutcome> {
  const store = STORES.find((s) => s.path === path)
  if (!store) return { ok: false, reason: 'That is not somewhere the office keeps anything.' }
  if (store.kind !== 'yours') {
    return {
      ok: false,
      reason: 'That is part of the office itself, not your work. Deleting it would break the app rather than protect anything.',
    }
  }

  const where = join(root, store.path)

  try {
    /*
     * Everything except what shipped, and the directory itself stays.
     *
     * The same list `measure` counted against, so the number the panel showed before the click
     * is the number that goes away. Two lists were two chances to disagree and they took it:
     * `projects` left a `README.md` it had counted, so the total did not move, and `memory` was
     * an `rm` of the whole directory that took a git-tracked file out of the user's clone.
     *
     * Keeping the directory matters for `memory`: gone entirely reads as *never created* in this
     * panel, and *"you have never remembered anything"* is a different claim from *"you asked me
     * to forget"*. The three states are the point of the store — an emptied one must say empty.
     */
    /*
     * A file store goes whole; a directory store is emptied of everything that is not shipped.
     *
     * The loop below replaced an `rm` of the path, and three of the `yours` stores are single
     * files — `sessions.json`, `dispatches.jsonl`, `floor.ndjson`. `readdir` on a file is
     * ENOTDIR, so all three answered the Delete button with a raw
     * `ENOTDIR: not a directory, scandir /Users/…` and left the file exactly where it was.
     * `dispatches.jsonl` is the one this repo's own comment calls the most personal thing under
     * `.office-space/`, added to the list because it sat there undeleteable.
     *
     * Which is the failure this function was being changed to fix, one store over: before, it
     * deleted and miscounted; after, it did not delete at all. `measureOne` above already
     * branches on exactly this and was the shape to copy.
     *
     * Catching ENOTDIR beside ENOENT would stop the crash and report success for a file it had
     * not touched, which is worse than the crash.
     */
    const info = await lstat(where).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null
      throw err
    })
    // A store that is not there is already forgotten — `rm(…, { force: true })` swallowed this
    // and `stat` does not. `deleting something that was never there is not an error` is a test
    // one line of this change broke, which is the suite doing its job.
    if (info === null) return { ok: true }
    if (!info.isDirectory()) {
      await rm(where, { force: true })
      return { ok: true }
    }

    const shipped = store.shipped ?? []
    const entries = await readdir(where, { withFileTypes: true })
    for (const entry of entries) {
      if (shipped.includes(entry.name)) continue
      await rm(join(where, entry.name), { recursive: true, force: true })
    }
    return { ok: true }
  } catch (err) {
    // Said plainly rather than swallowed: a delete that silently failed is the worst outcome
    // this panel can produce, because the person walks away believing it is gone.
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Formatting lives in `shared/privacy-view.ts`, not here.
 *
 * This module imports `node:fs/promises`, so a renderer view importing a *value* from it would
 * pull the filesystem into a sandboxed browser context. Types cross that boundary freely —
 * they are erased — and functions must not.
 */
export { humanBytes, sizeLine } from '../shared/privacy-view.js'
