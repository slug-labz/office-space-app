/**
 * Which conversation a request is for.
 *
 * One function, because the bug it exists to prevent was one missing argument repeated in four
 * places.
 *
 * ## The failure
 *
 * A project is a group of sessions. The renderer keeps a transcript per **conversation** and
 * addressed it by session id; `send`, `restore` and `interrupt` took only a **project**, so
 * main resolved the session itself. While a project had exactly one conversation the two always
 * agreed and nothing looked wrong. The moment it had two, they could disagree — and then your
 * words were rendered into the conversation you were looking at while the run happened in
 * another, which is exactly what was reported: typing in one project and watching the reply
 * arrive in a different one.
 *
 * It was never a race. The renderer could not have got it right, because the argument that says
 * which conversation it meant was not in the signature.
 *
 * ## The rule
 *
 * **A caller that names a conversation is believed.** Not checked against main's own idea and
 * quietly overridden — overriding it is the bug. Main's idea is the fallback for a caller that
 * genuinely has no opinion, which is a real case: the first message into a project that has
 * never had a conversation.
 */

export type Route =
  /** Use this exact conversation. The caller named it and the caller is right. */
  | { readonly kind: 'named'; readonly session: string }
  /** The caller named none, and this project is already showing one. */
  | { readonly kind: 'current'; readonly session: string }
  /** Nobody has an opinion. Resume this project's most recent, or start its first. */
  | { readonly kind: 'resume-or-start' }

/**
 * @param named   the conversation the caller asked for, or `null` if it did not ask.
 * @param current the conversation this project is showing, if any.
 */
export function route(named: string | null, current: string | undefined): Route {
  // Believed even when it disagrees with `current`, and *especially* then — a disagreement is
  // the case this function exists for. Substituting `current` here is the original bug.
  if (named) return { kind: 'named', session: named }
  if (current) return { kind: 'current', session: current }
  return { kind: 'resume-or-start' }
}

/** The session id this route resolves to, or `null` when there is none to name yet. */
export function sessionOf(r: Route): string | null {
  return r.kind === 'resume-or-start' ? null : r.session
}
