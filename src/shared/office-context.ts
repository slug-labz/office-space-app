/**
 * The context the office puts in front of your message, and how to take it back out.
 *
 * Every message to a manager is prefixed with what project this is and who is on the floor.
 * That is not decoration — `.claude/agents/manager.md` tells the manager its roster arrives
 * each turn, and the manager cannot see the tab bar — but it is the office talking, not you.
 *
 * Which matters when a conversation is read back. A restored transcript renders what was
 * actually sent, and without a way to tell the two apart it opens with several hundred words
 * of roster attributed to you, as though you had typed it. The office would be putting words
 * in your mouth in its own chat panel.
 *
 * So the message is marked. The marker is a heading rather than a sentinel of punctuation
 * because it also has to read sensibly to the model receiving it, and because anything that
 * looks like ordinary text is something a person can accidentally type.
 */

/** Separates what the office added from what you said. */
export const MESSAGE_HEADING = '## THE MESSAGE'

/** Assemble a turn: the office's context, then yours. */
export function withOfficeContext(context: readonly string[], message: string): string {
  return [...context, MESSAGE_HEADING, message].join('\n\n')
}

/** The heading the roster block has always started with. */
const STAFF_HEADING = '## CURRENT STAFF'

/**
 * Recover what you actually said.
 *
 * A turn with no marker at all is returned untouched. It was typed into a terminal, or sent by
 * something that is not this app, and guessing which part of it was "really" the message would
 * be worse than showing all of it.
 *
 * The one exception is the office's own earlier format, which had no marker because the marker
 * did not exist yet. Recognising a shape this app wrote is not guessing at somebody's text —
 * and without it every conversation recorded before today opens with several hundred words of
 * roster attributed to the person reading it.
 */
export function stripOfficeContext(text: string): string {
  const marker = `${MESSAGE_HEADING}\n\n`
  const at = text.lastIndexOf(marker)
  if (at !== -1) return text.slice(at + marker.length)

  const staffAt = text.indexOf(STAFF_HEADING)
  if (staffAt !== 0 && !text.startsWith('## CURRENT PROJECT')) return text
  if (staffAt === -1) return text

  // The roster block is exactly a heading, a blank line, and one paragraph of staff — so the
  // message is everything from the third paragraph on.
  const paragraphs = text.slice(staffAt).split('\n\n')
  if (paragraphs.length < 3) return text
  return paragraphs.slice(2).join('\n\n')
}
