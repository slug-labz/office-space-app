/**
 * Fetching, hashing, and recording employees a colleague maintains.
 *
 * The decisions live in `shared/hired-from.ts`; this is the half that touches the disk and the
 * network, and it exists to answer one question honestly: *is the file in `.claude/agents/` still
 * the file at the source?*
 *
 * ## Why provenance is a sidecar and not a line of frontmatter
 *
 * The obvious place to record where an employee came from is in the employee's own file. It is
 * the wrong place, and wrong in a way that defeats the feature: writing `hired-from:` into the
 * file makes our copy differ from theirs *by construction*, so the digests never match again and
 * the only question worth asking can no longer be answered. The record goes beside the file, in
 * the office's own state, and the file stays byte-identical to the one the colleague wrote.
 *
 * ## Why git never prompts
 *
 * `GIT_TERMINAL_PROMPT=0`. A private repo with no working credentials otherwise stops at a
 * username prompt on a stdin nobody is attached to, and the office hangs with a spinner instead
 * of saying *"could not be reached"*. Failing is the feature; there is a sentence for it.
 *
 * ## Why a git source asks the network switch first
 *
 * A git source is a repository URL, and `git clone` on it is a request this app makes. The
 * switch's own words are *"Office Space may make its own network requests. Click to stop it."*,
 * and nothing here consulted it: `gated()` wraps a `fetch`, and a clone is a spawned program that
 * no wrapper can see. So the check is explicit, at the one place a clone starts, and read per
 * call — the same arrangement `installWhisper` has for `brew`. The predicate is required, with no
 * default, for the reason `fetchModel` refuses a default fetch: a default would put the bypass back
 * for whichever caller forgot it.
 *
 * Every `git` source is refused while the switch is off, a local path included. Telling a mirror
 * on this machine from a remote is possible and is not this module's job: a checkout already on
 * disk is what the `directory` kind is for, and it is never cloned, so it still works.
 *
 * ## Why sources are cloned once, not once per employee
 *
 * Five of a colleague's agents come from one repo. `groupBySource` collapses them so a check is
 * one clone and five reads, and the grouping is a pure function so it is tested without a
 * network.
 */

import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { parseFrontmatter } from './workspace.js'
import { whyInvalid, whyUnsafeAsPath } from '../shared/agent-id.js'
import { whyNotASource } from '../shared/hired-from.js'
import { serial } from './serial.js'

/**
 * One writer at a time for the provenance record.
 *
 * `hireFrom` and `takeTheirs` both read `hired-from.json`, change one entry, and write the whole
 * file back — the same read-modify-write that lost six of twelve connectors when they overlapped.
 * The agent file itself is safe either way, because it is created with `wx`; the sidecar is the
 * part that can be silently rewritten from a stale copy, and losing an entry there means an
 * employee whose origin the office has forgotten while still showing them on the floor.
 */
const records = serial()
import type { Found, Provenance, Source } from '../shared/hired-from.js'

const run = promisify(execFile)

const STATE_DIR = '.office-space'
const RECORD_FILE = 'hired-from.json'
const CLAUDE_AGENTS = join('.claude', 'agents')

/** Long enough for a real clone on a slow line, short enough that a wedged one is not forever. */
const CLONE_TIMEOUT_MS = 60_000

/** Why a git source was not opened. In the switch's own terms, as `installWhisper` words it. */
const SWITCHED_OFF =
  'Office Space is set not to make its own network requests, and a repository source is fetched ' +
  'with git clone. Turn the network back on in the music panel, or name a checkout already on ' +
  'this machine as a directory instead.'

/** Where agent files are looked for inside a source, nearest-convention first. */
const LOOK_IN = ['.claude/agents', 'agents', '']

/**
 * The digest both sides are compared through.
 *
 * Bytes, not parsed content — a whitespace-only change is still a change somebody made, and
 * deciding it does not count is a judgement we have no standing to make about a file we did not
 * write.
 */
export function digest(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** One candidate found at a source. */
export interface Offered {
  /** Source-relative path, e.g. `agents/wren-review.md`. */
  readonly file: string
  /** The id it would be hired under: the frontmatter `name`, or the file's stem. */
  readonly id: string
  readonly description: string
  readonly hash: string
  readonly content: string
}

/**
 * Collapse a list of provenances to one entry per distinct source.
 *
 * Pure, so the thing that saves four clones is checked by a test that never opens a socket.
 */
export function groupBySource(
  records: readonly Provenance[],
): readonly { readonly at: string; readonly kind: Source['kind']; readonly wanted: readonly Provenance[] }[] {
  const groups = new Map<string, { at: string; kind: Source['kind']; wanted: Provenance[] }>()
  for (const record of records) {
    const key = `${record.source.kind} ${record.source.at}`
    const existing = groups.get(key)
    if (existing) existing.wanted.push(record)
    else groups.set(key, { at: record.source.at, kind: record.source.kind, wanted: [record] })
  }
  return [...groups.values()]
}

/**
 * Decide what an unreadable source means.
 *
 * `withdrawn` and `unreachable` are different sentences in front of a person, so the distinction
 * is made once, here, from the fact that decides it: we got the source open and the file was not
 * in it, versus we never got the source open at all.
 */
export function whatFailureMeans(reachedSource: boolean, detail: string): Extract<Found, { seen: false }> {
  return { seen: false, why: reachedSource ? 'withdrawn' : 'unreachable', detail }
}

/**
 * The record file, and whether it can be safely rewritten.
 *
 * Two callers with opposite needs. **Reading** for the roster can shrug at a broken file: the
 * records are a convenience laid over agent files that stand on their own, so losing them loses
 * the comparison, not the employee. **Writing** cannot, because both writers rewrite the whole
 * file from what this returns — so a read that reports "no records" for a file it could not
 * parse turns one unreadable byte into the permanent deletion of every record in it, and returns
 * `{ ok: true }` while doing it.
 *
 * So the shrug and the problem are reported separately, the same shape `readHookFiles` uses:
 * `records` is best effort and always safe to display; `problem` is non-null exactly when a
 * rewrite would lose something, and the writers refuse on it.
 *
 * `connectors.ts` states the same rule about `.mcp.json` — *"parse it, fall back to `{}` on
 * failure, add the new server, write it out — deletes all of them"* — and this file already
 * fixed the concurrency half of it. This is the parse-failure half.
 */
interface RecordFile {
  readonly records: readonly Provenance[]
  readonly problem: string | null
}

async function readRecordFile(root: string): Promise<RecordFile> {
  const path = join(root, STATE_DIR, RECORD_FILE)

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    // Absent is the ordinary case: nobody has hired from a source yet, and a rewrite loses
    // nothing. Every other errno is a file that is there and would not open.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], problem: null }
    return { records: [], problem: `${path} could not be read: ${(error as Error).message}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { records: [], problem: `${path} is not valid JSON: ${(error as Error).message}` }
  }
  if (!Array.isArray(parsed)) {
    return { records: [], problem: `${path} is not a list of records.` }
  }

  const records = parsed.filter(isProvenance)
  if (records.length !== parsed.length) {
    // The partial case, and the easiest one to lose quietly: the good records read fine, so the
    // roster looks right, and the next write drops the rest on the floor.
    const lost = parsed.length - records.length
    return {
      records,
      problem: `${path} holds ${lost} record${lost === 1 ? '' : 's'} this office does not recognise.`,
    }
  }
  return { records, problem: null }
}

/** Read whatever the office has written down about who was hired from where. */
export async function recordedHires(root: string): Promise<readonly Provenance[]> {
  return (await readRecordFile(root)).records
}

function isProvenance(value: unknown): value is Provenance {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const source = v.source as Record<string, unknown> | undefined
  return (
    typeof v.id === 'string' &&
    typeof v.hiredHash === 'string' &&
    typeof v.hiredAt === 'string' &&
    typeof source === 'object' &&
    source !== null &&
    (source.kind === 'git' || source.kind === 'directory') &&
    typeof source.at === 'string' &&
    typeof source.file === 'string'
  )
}

async function writeRecords(root: string, records: readonly Provenance[]): Promise<void> {
  const dir = join(root, STATE_DIR)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, RECORD_FILE), `${JSON.stringify(records, null, 2)}\n`, 'utf8')
}

/** The digest of our copy, or `null` when the employee is not in the roster any more. */
export async function ourCopy(root: string, id: string): Promise<string | null> {
  try {
    return digest(await readFile(join(root, CLAUDE_AGENTS, `${id}.md`)))
  } catch {
    return null
  }
}

/**
 * Put a source on disk and hand back the directory to read it from.
 *
 * A directory source is used where it stands — it is already a checkout somebody maintains, and
 * copying it first would only add a way for the two to disagree. A git source is cloned shallow
 * into a fresh temp directory the caller removes — unless the network switch is off, in which case
 * nothing is started and the refusal says why. See the header.
 */
async function openSource(
  at: string,
  kind: Source['kind'],
  allowed: () => boolean,
): Promise<{ readonly dir: string; readonly temp: string | null } | { readonly failed: string }> {
  const unusable = whyNotASource(at)
  if (unusable) return { failed: unusable }
  if (kind === 'directory') {
    try {
      await readdir(at)
      return { dir: at, temp: null }
    } catch (error) {
      return { failed: (error as Error).message }
    }
  }
  if (!allowed()) return { failed: SWITCHED_OFF }
  let temp: string | null = null
  try {
    temp = await mkdtemp(join(tmpdir(), 'office-source-'))
    await run('git', ['clone', '--depth', '1', '--quiet', '--', at, temp], {
      timeout: CLONE_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GCM_INTERACTIVE: 'never' },
    })
    return { dir: temp, temp }
  } catch (error) {
    if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {})
    return { failed: firstLine((error as Error & { stderr?: string }).stderr ?? (error as Error).message) }
  }
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0)
  return (line ?? 'could not be reached').trim()
}

/**
 * What a source has on offer.
 *
 * Only markdown with agent frontmatter counts — a repo of agents also holds a README and a
 * licence, and offering those as colleagues would be a list nobody could trust. A file whose
 * declared name could not be a filename here is skipped rather than silently renamed, because
 * hiring somebody under a name they were not given is the same lie in a smaller font.
 *
 * `allowed` is the network switch, asked before a git source is cloned. Required; see the header.
 */
export async function browseSource(
  at: string,
  kind: Source['kind'],
  allowed: () => boolean,
): Promise<{ readonly offered: readonly Offered[] } | { readonly problem: string }> {
  const opened = await openSource(at, kind, allowed)
  if ('failed' in opened) return { problem: opened.failed }
  try {
    const offered: Offered[] = []
    const seen = new Set<string>()
    for (const where of LOOK_IN) {
      const dir = where ? join(opened.dir, where) : opened.dir
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        continue
      }
      for (const name of names.sort()) {
        if (!name.endsWith('.md')) continue
        const relative = where ? `${where}/${name}` : name
        let content: string
        try {
          content = await readFile(join(dir, name), 'utf8')
        } catch {
          continue
        }
        const front = parseFrontmatter(content)
        if (!front) continue
        const id = (front.name ?? name.slice(0, -3)).trim()
        if (whyInvalid(id) || whyUnsafeAsPath(id) || seen.has(id)) continue
        seen.add(id)
        offered.push({
          file: relative,
          id,
          description: front.description ?? '',
          hash: digest(content),
          content,
        })
      }
    }
    return { offered }
  } finally {
    if (opened.temp) await rm(opened.temp, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Look at every recorded source and report what is there now.
 *
 * One clone per source. A source that will not open marks *all* of its employees unreachable;
 * a source that opens but no longer holds a given file marks that one withdrawn — which is why
 * the two answers are decided from different facts and not from the same catch block.
 *
 * With the network switch off, every git source is unreachable and says why; directory sources
 * are still read.
 */
export async function checkOnThem(
  records: readonly Provenance[],
  allowed: () => boolean,
): Promise<ReadonlyMap<string, Found>> {
  const found = new Map<string, Found>()
  for (const group of groupBySource(records)) {
    const opened = await openSource(group.at, group.kind, allowed)
    if ('failed' in opened) {
      for (const want of group.wanted) found.set(want.id, whatFailureMeans(false, opened.failed))
      continue
    }
    try {
      for (const want of group.wanted) {
        try {
          found.set(want.id, { seen: true, hash: digest(await readFile(join(opened.dir, want.source.file))) })
        } catch (error) {
          found.set(want.id, whatFailureMeans(true, firstLine((error as Error).message)))
        }
      }
    } finally {
      if (opened.temp) await rm(opened.temp, { recursive: true, force: true }).catch(() => {})
    }
  }
  return found
}

/**
 * Read one named file out of a source.
 *
 * Used by "take their version", which needs the bytes and not just the digest `checkOnThem`
 * returns. Reading it again at the moment of the write — rather than keeping what a browse found
 * minutes ago — is what makes the digest recorded afterwards a digest of what was actually
 * written.
 */
export async function readFromSource(
  source: Source,
  allowed: () => boolean,
): Promise<{ readonly content: string } | { readonly problem: string }> {
  const opened = await openSource(source.at, source.kind, allowed)
  if ('failed' in opened) return { problem: opened.failed }
  try {
    return { content: await readFile(join(opened.dir, source.file), 'utf8') }
  } catch (error) {
    return { problem: firstLine((error as Error).message) }
  } finally {
    if (opened.temp) await rm(opened.temp, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Write the agent file and record where it came from.
 *
 * Refuses to overwrite. An id collision means two people's idea of `reviewer` would land on one
 * file, and picking a winner silently is how somebody's own agent disappears — so it is reported
 * and the person decides.
 */
export function hireFrom(
  root: string,
  source: Source,
  offered: Offered,
  today: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  return records(() => writeHire(root, source, offered, today))
}

async function writeHire(
  root: string,
  source: Source,
  offered: Offered,
  today: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  const bad = whyInvalid(offered.id) ?? whyUnsafeAsPath(offered.id)
  if (bad) return { ok: false, reason: bad }

  /*
   * Before the agent file, not after it.
   *
   * The record write below rewrites the whole file, so it cannot run against a file this office
   * could not read. Asking here rather than down there means a refusal leaves nothing behind —
   * ask after the `.md` is written and the office gains an employee it has no record of, which
   * is a second, quieter version of the same fault.
   */
  const existing = await readRecordFile(root)
  if (existing.problem !== null) {
    return {
      ok: false,
      reason: `${existing.problem} Hiring would rewrite that file and lose what is in it, so nothing was written.`,
    }
  }

  const dir = join(root, CLAUDE_AGENTS)
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(join(dir, `${offered.id}.md`), offered.content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return { ok: false, reason: `This office already has somebody called ${offered.id}. Rename one of them first.` }
    }
    return { ok: false, reason: (error as Error).message }
  }
  const records = existing.records.filter((r) => r.id !== offered.id)
  await writeRecords(root, [...records, { id: offered.id, source, hiredHash: offered.hash, hiredAt: today }])
  return { ok: true }
}

/**
 * Take their version, and move the fixed point with it.
 *
 * The second write is the one that matters: leaving `hiredHash` at the old digest would make the
 * freshly-updated copy read as *edited here* forever after. The caller decides whether this is
 * allowed — `updateIsSafe` is a decision, not an I/O concern, and it lives in shared.
 */
export function takeTheirs(
  root: string,
  record: Provenance,
  content: string,
  today: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  return records(() => writeTaken(root, record, content, today))
}

async function writeTaken(
  root: string,
  record: Provenance,
  content: string,
  today: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  // Same order and the same reason as `writeHire`: the second write rewrites the whole record
  // file, so refuse before the first one rather than after it.
  const existing = await readRecordFile(root)
  if (existing.problem !== null) {
    return {
      ok: false,
      reason:
        `${existing.problem} Taking their version rewrites that file and would lose what is in ` +
        'it, so nothing was written.',
    }
  }

  try {
    await writeFile(join(root, CLAUDE_AGENTS, `${record.id}.md`), content, 'utf8')
  } catch (error) {
    return { ok: false, reason: (error as Error).message }
  }
  const records = existing.records.map((r) =>
    r.id === record.id ? { ...r, hiredHash: digest(content), hiredAt: today } : r,
  )
  await writeRecords(root, records)
  return { ok: true }
}
