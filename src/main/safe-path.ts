/**
 * One answer to "may this string become a path under that directory".
 *
 * Lifted out of `reconcile.ts`, where it was written and where it is still the whole design —
 * *"the cost of being wrong once is a write over an arbitrary file on somebody's machine"*.
 * It was correct there and correct alone: fuzzed against nineteen shapes, including `a/../../x`,
 * `....//x`, a drive letter, a UNC path and an embedded NUL, and it refused every one while
 * passing the two real ones.
 *
 * It is here because it was the only one. Three other places in this app turn a string from
 * outside into a path, and each had rolled its own or had none — `fire('../skills/victim')`
 * unlinked a file in another directory, and `decide('../../../escaped', …)` wrote a verdict in
 * the workspace's parent. Both were found in review, one at a time, and both were fixed with a
 * fourth hand-written check before anybody noticed there was already an audited one.
 *
 * A name is a different question from a path — `shared/agent-id.ts` answers that one, because a
 * single directory entry may not contain a separator at all — but everywhere a *path* is built
 * from input, it goes through here.
 *
 * ## What it refuses that it need not
 *
 * `inside.startsWith('..')` cannot tell *escapes the root* from *is a file whose name begins
 * with two dots*, so four contained inputs are refused with a message about not being in the
 * workspace:
 *
 *     ..verdict.json   ..x.verdict.json   ...x.verdict.json   ..leading.md
 *
 * Measured as a set difference against the same function without that clause: four differ, and
 * **none of them escapes**. By the time it runs, the `'..'` *segment* check above has already
 * removed every genuine escape — escaping requires a leading `..` segment — so on POSIX this
 * clause contributes nothing but those four. (`inside === ''` beside it is load-bearing and
 * stays: it catches `path === '.'` resolving to the root itself.)
 *
 * The redundancy is symmetric, which is worth knowing before anybody deletes either: mutating
 * the segment check away leaves the escapes caught by this clause, and mutating this clause away
 * leaves them caught by the segment check. Two backstops for the same set, and only one of them
 * has a cost.
 *
 * Both kept anyway. Over-refusing in a path guard fails in the safe direction, no caller passes
 * a name beginning with two dots, and removing a defence on the strength of my own reasoning
 * about what `relative()` does on every platform is a worse trade than four false positives
 * nobody hits — that reasoning is exactly what put a bearer token on the wrong host earlier
 * tonight. Named here so the next person meets it as a known cost rather than a puzzle, and
 * pinned by a test so removing it is a decision rather than a drift.
 *
 * ## It answers about strings, not about files
 *
 * `resolve()` is purely lexical and never touches the disk, so a symlink that lives inside the
 * directory and points outside it satisfies every check here:
 *
 *     safeRelativePath(agents, 'leaked.md')  →  ALLOWED
 *       resolves lexically to :  …/agents/leaked.md
 *       actually reads        :  whatever the link points at
 *
 * That is not a bug in this function — it is the question it answers. A caller asking *may this
 * string become a path under that directory* gets a correct answer; a caller asking *may I read
 * what is at that path* is asking something else, and `resolve()` cannot tell it.
 *
 * `reconcile.ts` is the module that does ask the second question, and it is the one where being
 * wrong means writing through a link: it `lstat`s **before** the read, and leaves a symlink
 * exactly where it found it — *"a symlink here is the user's own arrangement"*. Any caller whose
 * next step is a write should do the same rather than rely on this.
 *
 * The reachable read-side case is `discoverWorkspace`, which follows a link in `.claude/agents/`
 * and surfaces what it finds. Measured rather than assumed: a target with no frontmatter — an
 * SSH key, a credentials file — produces a `no-frontmatter` problem and **no bytes**, so the
 * exploitable target is a well-formed agent file, which means another project's agents or a note
 * that happens to carry frontmatter. Bounded, and worth knowing before anybody decides whether
 * `.claude/agents/` should follow links at all: git preserves symlinks and this project's pitch
 * is *clone it and you have an office*.
 *
 * ## The fuzz that could not have found this
 *
 * The nineteen shapes this was checked against were all hostile, so the only thing they could
 * measure was false *negatives*: a corpus of things that must be refused, all refused, says
 * nothing about what else is refused alongside them. `test/safe-path.test.ts` carries both
 * corpora now — must-refuse and must-accept — because a check assembled only from what you
 * expect to fail is another check that agrees with itself.
 */

import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'

/**
 * A manifest key, or nothing.
 *
 * The one function in here whose failure mode is a write to somebody's home directory rather
 * than a stale agent file, so it refuses first and asks questions never: relative only, no `..`
 * anywhere on the way, and the joined result still under the root when both are resolved. The
 * manifest is ours and today only ever holds `.claude/...`, which is precisely why this is
 * cheap to write and worth having — a corrupted or hand-edited one must not be able to aim a
 * write anywhere it likes.
 */
export function safeRelativePath(root: string, path: string): string | null {
  if (!path || isAbsolute(path)) return null
  // Backslashes are a path separator on Windows and an ordinary character elsewhere, so a key
  // containing one cannot be reasoned about portably. We never emit one.
  if (path.includes('\\') || path.includes('\0')) return null

  const normalised = normalize(path)
  if (normalised.split(sep).some((segment) => segment === '..')) return null

  const full = resolve(root, normalised)
  const inside = relative(resolve(root), full)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null

  return full
}

/**
 * The same question for a path that is already absolute.
 *
 * A separate function rather than a flag on the one above, because the two disagree about the
 * input in a way a boolean would hide: that one refuses absolute paths outright, and this one
 * requires them. Folding both into one entry point means a caller passing the wrong shape gets
 * the other function's answer, silently.
 *
 * The caller this exists for is the undo, whose paths come from an employee's own tool call —
 * strings that reached the office over a pipe, describing files the office is about to write or
 * delete. `..` is normalised away first so `/a/b/../../etc/passwd` is judged as `/etc/passwd`
 * rather than by how it is spelled.
 */
export function insideDirectory(root: string, path: string): string | null {
  if (!path || !isAbsolute(path) || path.includes('\0')) return null

  const full = resolve(normalize(path))
  const inside = relative(resolve(root), full)
  // `''` means the root itself, which is a directory and never a file to be put back.
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null

  return full
}
