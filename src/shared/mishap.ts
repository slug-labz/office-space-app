/**
 * What to say when the app itself goes wrong.
 *
 * The renderer had no `error` handler and no `unhandledrejection` handler. Nothing anywhere in
 * `src/renderer/` listened for either, and the consequence is the quietest failure this app can
 * have: a view that throws while drawing stops drawing, an `invoke` that rejects never resolves,
 * and the window keeps sitting there looking like an office where nothing is happening.
 *
 * That is the third standing order failing in the one direction the floor cannot show. A frozen
 * office and an idle office are the same picture.
 *
 * The bridge makes it concrete. `ipcMain.handle` and `ipcRenderer.invoke` are joined by a string
 * and nothing else, so a channel with no handler rejects with
 *
 *     Error: No handler registered for 'office:tasks'
 *
 * — behind whatever control called it, with no catch anywhere on the path. Three call sites in
 * `app.ts` do catch, by hand, one at a time; the rest do not. `the-bridge-has-two-ends.test.ts`
 * now checks that no channel is in that state today, which is the reason the fault does not
 * exist rather than a reason it could not.
 *
 * ## Why this is not a `catch` at the bridge
 *
 * The obvious fix is for preload to catch and hand back a value. It is wrong, and wrong in the
 * way this repository is most careful about: it converts a call that failed into a call that
 * returned nothing, and the renderer draws "nothing" perfectly well. A workspace whose task file
 * would not open would render as a workspace with no tasks.
 *
 * So nothing is caught. The failure keeps happening; it simply stops being invisible.
 *
 * ## Repeats
 *
 * A draw that throws throws every frame. Saying so sixty times a second is not honesty, it is a
 * denial of service against the transcript — but dropping the repeats silently is the fourth
 * standing order again, one layer up. So the first is said, and then the tenth, hundredth and
 * thousandth, each carrying the count. A fault that is still going gets louder, slowly, and a
 * fault that happened once says so once.
 */

export interface Mishap {
  /** What to show. A sentence, because it is going into a transcript a person is reading. */
  readonly sentence: string
  /**
   * What two reports must share to be the same fault.
   *
   * **Not the message.** The message is a rendering, and it carries the occurrence inside it.
   * `office-space-6c` found the case that proves it, and it is on the busiest write path in the
   * app — `saveRegistry` writes through a temp file named for a counter:
   *
   *     const temp = `${path}.${process.pid}.${++saveSeq}.tmp`
   *
   * Node's errno errors embed the path, so a full disk produces
   *
   *     EACCES: permission denied, open '/…/sessions.json.42.7.tmp'
   *     EACCES: permission denied, open '/…/sessions.json.42.8.tmp'
   *
   * — a different message, a different key, and a first occurrence every time. `writeRegistry`
   * runs on every registry change including a cost update, which lands per turn, so the one case
   * the repeat gate exists to stop is the one case it was inert for. The counter was added to fix
   * a *different* bug, two overlapping saves sharing a temp name. Neither change is wrong; the
   * join was.
   *
   * The inverse is the same bug from the other side: two different transcripts failing with one
   * generic sentence share a key, so a *widening* failure reads as a single stuck one. Which is
   * why `detail` exists — the key is what repeats, the detail is what varies, and both are
   * reported.
   */
  readonly key: string
  /**
   * The part of the message that varies between occurrences: paths, ids, counters.
   *
   * Kept so that "10 times now" can also say *how many different things* — a fault hitting one
   * file and a fault hitting forty are different situations, and collapsing them to a count
   * would hide the difference the normalised key just created.
   */
  readonly detail: string
}

/** The channel name out of `No handler registered for 'office:tasks'`, when that is what it is. */
const NO_HANDLER = /No handler registered for '([^']+)'/
/**
 * The browser's own notice that a resize callback resized something.
 *
 * Not a failure, and this app produces it by construction: `floor-view.ts` observes the stage and
 * calls `fit()`, which changes the canvas size, which is exactly the shape that makes a browser
 * defer the next notification to the following frame and say so. Chrome delivers it as a window
 * `error` event, so the renderer's handler catches it like any other.
 */
const RESIZE_LOOP = /ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/
/** Electron wraps every rejected `invoke`. The frame is the app's business, not the reader's. */
const IPC_FRAME = /^Error invoking remote method '([^']+)':\s*(?:Error:\s*)?/
/** Node's errno codes lead their own message: `EACCES: permission denied, open '/…'`. */
const ERRNO = /^([A-Z][A-Z0-9]{2,}):/

/**
 * The message with Electron's IPC frame taken off, and the channel it named.
 *
 * The boot `.catch` in `app.ts` already learned this the hard way: a stranger's first screen
 * carried *"Could not read the workspace: Error invoking remote method 'session:open': Error: no
 * manager agent found in /private/tmp/…"* — an IPC frame, an absolute path, and the wrong
 * diagnosis, in one line. The frame is worth keeping as the *channel*, and worth losing as prose.
 */
export function unwrap(reason: unknown): { readonly message: string; readonly channel: string | null } {
  const raw =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : reason === undefined
          ? 'undefined'
          : safely(reason)

  const frame = IPC_FRAME.exec(raw)
  return frame ? { message: raw.slice(frame[0].length), channel: frame[1] ?? null } : { message: raw, channel: null }
}

/**
 * A key that does not move when the occurrence does.
 *
 * Built from the things that identify a *fault* rather than an *instance*: the channel it came
 * over, the errno code, and the message with every varying token replaced. Absolute paths,
 * quoted strings and digit runs are what vary — they are also what a reader needs, so they go in
 * `detail` and are shown, and only the key is blind to them.
 */
function keyOf(message: string, channel: string | null): string {
  const errno = ERRNO.exec(message)?.[1] ?? null
  const shape = message
    .replace(/'[^']*'/g, "'…'")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/(^|\s)\/[^\s'"]+/g, '$1/…')
    .replace(/\d+/g, 'N')
    .trim()
  return [channel, errno, shape].filter((part) => part !== null && part !== '').join('|')
}

export function describeMishap(reason: unknown): Mishap {
  const { message, channel } = unwrap(reason)

  const dead = NO_HANDLER.exec(message)?.[1]
  if (dead !== undefined) {
    return {
      key: `no-handler:${dead}`,
      detail: dead,
      sentence:
        `The office was asked for \`${dead}\` and nothing answered. That is a fault in this ` +
        `build rather than anything you did — whatever you just pressed did not happen.`,
    }
  }

  /*
   * A notice about scheduling, told as one.
   *
   * The general sentence below ends *"whatever you just did may not have taken effect"*, and for
   * this message that is **false**: the resize did take effect, and the browser is reporting that
   * it needed another pass to settle. Seen in the running app — the campus toggle drew three
   * offices correctly and the office said the action might not have happened.
   *
   * Not suppressed, which would be the fourth standing order in the module written for the third.
   * One of these is noise; a burst of them is a real resize loop, and the repeat machinery below
   * already carries the count that tells them apart. So it is still reported, still counted, and
   * no longer described as a lost action.
   */
  if (RESIZE_LOOP.test(message)) {
    return {
      key: 'resize-loop',
      detail: message,
      sentence:
        'The office resized itself twice in one frame and the browser said so. Nothing failed and ' +
        'nothing was lost — this is about how the layout was scheduled, not about anything you did. ' +
        'A steady stream of them would mean something is resizing in a loop; one does not.',
    }
  }

  // The name matters: `TypeError` and `Error` with the same message are usually different faults,
  // and the name is the first thing anybody reading a report looks for.
  const named = reason instanceof Error && reason.name && reason.name !== 'Error'
  const full = named ? `${(reason as Error).name}: ${message}` : message
  return {
    key: keyOf(full, channel),
    // The whole message, paths and all. The key is what is normalised; this is not, because the
    // path is usually the only actionable thing in the sentence.
    detail: full,
    sentence: `Something in the office went wrong: ${full}. Nothing was lost, but whatever you just did may not have taken effect.`,
  }
}

/** Never throws, whatever it is handed — a reporter that fails while reporting says nothing at all. */
function safely(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text
  } catch {
    return String(value)
  }
}

/**
 * How many distinct details to remember per fault.
 *
 * Enough to tell "one file" from "lots of files", small enough that a fault hitting every session
 * in a large registry cannot grow this without bound. Past the cap the count keeps rising and the
 * report says "at least".
 */
const DETAIL_CAP = 24

interface Tally {
  count: number
  readonly details: Set<string>
  capped: boolean
}

/**
 * What to do about one report: say it, and — once — start saying it is still going on.
 *
 * The transcript is for **events** and the problem strip is for **conditions**, and a fault
 * crosses from one to the other by repeating. `office-space-6c` made the case and the numbers
 * are the argument: the strip's contents are re-derived from the snapshot on every scan, so an
 * event placed there vanishes at the next file change — *"a problem that disappears on its own
 * is one the reader is entitled to think was solved"* — while the transcript's own contract is
 * that if the office did it, it is in here.
 *
 * One occurrence is an event. **The same fault twice is a condition**, true until somebody fixes
 * it, and that is what the strip is for. Which matters most when nobody is watching: an office
 * left open unattended scrolls its transcript past, and a line in the status bar is what is still
 * there when somebody comes back.
 */
export interface Report {
  /** The sentence for the transcript, or `null` when this fault has been said recently enough. */
  readonly say: string | null
  /**
   * Set on the one occurrence where this fault becomes a standing condition, and never again.
   *
   * The caller raises it once and holds it. It does not clear: a renderer fault does not resolve,
   * it stops happening — and "it stopped happening" is not something this can observe.
   */
  readonly standing: string | null
}

/** The occurrence at which a fault stops being an event. */
const STANDING_AT = 2

/**
 * Which reports are worth saying, given what has already been said.
 *
 * Counts every one. Says the 1st, 10th, 100th and so on — a fault that is still going gets
 * louder slowly, and one that happened once is mentioned once. Nothing is dropped without being
 * counted, so "we stopped saying it" never becomes "it stopped happening".
 */
export class MishapLog {
  private readonly seen = new Map<string, Tally>()

  /** The sentence to show, or `null` when this fault has already been reported recently enough. */
  note(reason: unknown): string | null {
    const { key, sentence, detail } = describeMishap(reason)
    const tally = this.seen.get(key) ?? { count: 0, details: new Set<string>(), capped: false }
    tally.count += 1
    if (tally.details.size < DETAIL_CAP) tally.details.add(detail)
    else if (!tally.details.has(detail)) tally.capped = true
    this.seen.set(key, tally)

    if (tally.count === 1) return sentence
    // Powers of ten. `Math.log10` on an integer is not exact for every value, so this is asked
    // as a string question, which cannot drift.
    if (!/^10*$/.test(String(tally.count))) return null

    // How many different things it has happened to, not only how often. A fault stuck on one file
    // and a fault spreading across forty read the same as a bare count, and they are not the same
    // situation — which is the risk the normalised key introduces and this repays.
    const spread =
      tally.details.size === 1
        ? ''
        : `, ${tally.capped ? 'over ' : ''}${tally.details.size} different`
    return `${sentence} (${tally.count} times now${spread}.)`
  }

  /**
   * The same, plus whether this is the occurrence that makes it a condition.
   *
   * `note` is kept as the sentence-only form because most callers want exactly that, and a
   * caller that ignored a second return value would silently drop the standing report.
   */
  report(reason: unknown): Report {
    const before = this.countOf(reason)
    const say = this.note(reason)
    const { key, sentence } = describeMishap(reason)
    const count = this.seen.get(key)?.count ?? 0

    // Exactly once, on the crossing. `before` is what makes it once rather than every time after:
    // a `>=` on the count alone would raise the same condition on every occurrence from the
    // second onwards, and the caller holds these for the life of the window.
    const crossed = before < STANDING_AT && count >= STANDING_AT
    return {
      say,
      standing: crossed ? `${sentence} It has now happened more than once, so it is not a one-off.` : null,
    }
  }

  /** How many times a fault has been seen, said or not. */
  countOf(reason: unknown): number {
    return this.seen.get(describeMishap(reason).key)?.count ?? 0
  }
}
