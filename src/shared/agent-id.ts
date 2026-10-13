/**
 * What a name has to be before it can be an employee.
 *
 * Lifted out of `main/roster.ts` so the hire form can refuse a bad name *while you are typing
 * it* instead of after a round trip. Two copies of this rule would be the more obvious way to
 * get that, and it is the wrong one: the copy in the renderer would drift from the copy that
 * actually writes the file, and the drift would show up as a form that accepts a name the office
 * then rejects — the least explicable failure a form can have.
 *
 * `main/roster.ts` re-exports both of these, so nothing that imported them from there had to
 * change, and there remains exactly one definition.
 */

/**
 * Whether a name can be an agent.
 *
 * Strict on purpose, and the strictness is about three different readers rather than taste. It
 * becomes **a filename**, so anything path-shaped is a way out of the directory. It becomes the
 * **`subagent_type`** the manager passes to a tool. And it becomes **what a person types**, so a
 * name with a space in it is a name somebody will get wrong every time.
 */
export function isValidAgentId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
}

/** Why a name was refused, in words for the person who typed it. */
export function whyInvalid(id: string): string | null {
  if (id === '') return 'A name is required.'
  if (id.length > 64) return 'That is too long for a name — 64 characters at most.'
  if (/[A-Z]/.test(id)) return 'Names are lowercase, because they become filenames and the manager types them.'
  if (/[/\\.]/.test(id)) return 'A name cannot contain a slash or a dot — it becomes a filename.'
  if (!/^[a-z0-9]/.test(id)) return 'A name starts with a letter or a number.'
  if (!isValidAgentId(id)) return 'Use letters, numbers and hyphens only.'
  return null
}

/**
 * Why a name cannot safely become a path under `agents/`. Narrower than `whyInvalid`, and
 * deliberately so.
 *
 * `whyInvalid` is the rule for a name somebody is *choosing* — lowercase, no dots, hyphens
 * only — and it belongs at `hire`, the only place a name gets chosen. `fire`, `disable` and
 * `enable` do not receive chosen names. They receive whatever `readdir` found, by way of
 * `discoverWorkspace` and `disabled()`, neither of which applies any convention at all.
 *
 * So the set of names the office can *draw* is wider than the set `whyInvalid` accepts, and
 * putting that check on those three made the office refuse to act on its own rows: `Reviewer.md`,
 * `my_helper.md` and `data.scientist.md` are all discovered, all drawn with a Send home and a
 * Fire button, and all answered with a complaint about a name the user never typed. Hand-writing
 * an agent file is the documented way to add one — `roster.ts` opens by saying so, and the
 * project's premise is clone it and add your own.
 *
 * That is the same failure as the traversal it replaced, arriving from the other side: one let a
 * name reach outside the directory, the other refused names legitimately inside it. What is left
 * is only what a directory entry cannot be if it is to stay one.
 */
export function whyUnsafeAsPath(id: string): string | null {
  if (id === '') return 'A name is required.'
  // A separator makes it a path rather than an entry, which is how `fire('../skills/victim')` was
  // an `unlink` in another directory. Backslash too: it separates on Windows, and this is not the
  // place to decide which platform is running.
  if (/[/\\]/.test(id)) return 'A name cannot contain a slash — it would point outside the agents directory.'
  // `.` and `..` are the directory and its parent. A dot *inside* a name is fine: `data.scientist`
  // is a real agent somebody wrote by hand, and refusing it is what this function exists to stop.
  if (id === '.' || id === '..') return 'That is a directory, not an agent.'
  if (id.startsWith('.')) return 'A name cannot start with a dot — that is a hidden file, not an agent.'
  // Cannot arrive from `readdir`; can arrive across the bridge. A NUL truncates the path at the
  // syscall, so two different strings become one file to the kernel. Written as the escape rather
  // than the byte, for the reason `test/source-is-text.test.ts` exists.
  if (/[\u0000-\u001f\u007f]/.test(id)) return 'A name cannot contain a control character.'
  return null
}
