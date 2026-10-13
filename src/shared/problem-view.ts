/**
 * A problem, in words somebody can act on.
 *
 * `Problem` is a union whose variants all carry a `path` and differ in what else they hold, and
 * that difference is the whole of this function:
 *
 * | variant | carries | what a reader needs |
 * |---|---|---|
 * | `lint` | `path`, `rule`, `detail` | the `detail` — its producer wrote a finished sentence |
 * | `unreadable-dir` / `unreadable-file` | `path`, `cause` | both — `cause` alone is `EACCES` |
 * | `no-frontmatter` | `path` | the path — the kind is the only other thing there is |
 *
 * So: **a `detail` stands alone, and everything else is prefixed with the path.** Producers that
 * wrote a sentence get to keep it; producers that reported an errno get the file it happened to.
 *
 * This lives in `shared/` rather than in `app.ts` for the reason the roster's judgements do: a
 * function inside the renderer entry point cannot be tested without starting the application, so
 * it goes untested — and what would go untested here is *how much of a failure a person is told
 * about*.
 *
 * ## Both halves of that rule were learned by getting them wrong
 *
 * The original returned `detail ?? reason ?? kind`. For the two variants that matter most that is
 * none of the first three, so an unreadable commands directory reached the user as
 * `Reading commands: unreadable-file` — the category of failure, and neither the file nor why.
 *
 * The obvious repair, prefixing the path always, is worse where it matters more. The first-run
 * panel's problems are `lint`s whose `detail` is already a complete instruction — "The office
 * cannot find the `claude` command… Run `which claude` in your terminal" — and the billing one
 * carries the literal path `environment`. Prefixing those buries a written sentence behind a
 * string that adds nothing.
 *
 * **A message that names the class and not the thing cannot be acted on; a message that repeats
 * what the sentence already said is noise.** The fourth standing order asks for the first to be
 * fixed, and does not ask for the second.
 */

/** Structural, not nominal: `Problem` is declared in main and this is read by the renderer. */
export function describeProblem(problem: unknown): string {
  if (!problem || typeof problem !== 'object') return 'unknown'
  const p = problem as Record<string, unknown>

  // A producer that wrote prose wrote it to be read on its own.
  const detail = p['detail'] ?? p['reason']
  if (typeof detail === 'string' && detail.length > 0) return detail

  const path = typeof p['path'] === 'string' && p['path'].length > 0 ? p['path'] : null
  const why = String(p['cause'] ?? p['kind'] ?? 'unknown')
  return path ? `${path} — ${why}` : why
}
