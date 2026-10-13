/**
 * What the office tells the manager, beyond your message.
 *
 * Until now this was two blocks — the project and the roster — and the gaps showed. The
 * manager's own prompt instructs it to use the `meet` skill, and the office never handed over
 * the skill list: add a fourth skill and the floor draws it on the shelf while the manager never
 * learns it exists. That is the customisability promise breaking in the quietest possible way.
 *
 * ## The rule that shapes every block below
 *
 * **A block appears only when it would change what the manager should do.**
 *
 * This text is prepended to *every* message. Eight blocks of dutiful prose would be paid for on
 * every turn, would bury the sentence the person actually typed, and would train the model to
 * skim the preamble — at which point the blocks that matter stop being read either. So:
 *
 * - `NOW PLAYING` is absent when nothing is playing, not present saying "nothing".
 * - `OUTSTANDING` is absent when everything passes.
 * - `THE ROOM` is absent when everybody is simply at their desk, which is the ordinary case.
 *
 * Silence is the default and presence is the signal. The two blocks that are always there —
 * project and staff — are there because the manager cannot act correctly without either.
 *
 * ## Absent is not empty, here too
 *
 * A block whose source could not be read says so, in one line, rather than being omitted.
 * Omission and "we looked and found nothing" are different facts and the manager should act
 * differently on them: no outstanding tasks means proceed; *could not read the task list* means
 * say so before proceeding.
 */

import { modeBody, type Mode } from '../session/mode.js'

/** One employee, as the manager needs to see them. */
export interface StaffLine {
  readonly id: string
  readonly description: string
  /** `null` means the agent file names none — inheritance, not absence. */
  readonly tools: readonly string[] | null
  readonly isManager: boolean
}

/** One skill on the shelf. */
export interface SkillLine {
  readonly id: string
  readonly description: string
}

/** Where somebody is, when it is not simply "at their desk". */
export interface RoomLine {
  readonly who: string
  /** `in the meeting room`, `on a break`. Said the way the floor says it. */
  readonly where: string
}

/** A task the harness has something to say about. */
export interface TaskLine {
  readonly ref: string
  readonly title: string
  readonly owner: string | null
  /** `failed`, `unchecked`, `uncheckable`. Never `passed` — a passing task needs no mention. */
  readonly outcome: string
}

/** A connector the workspace declares. */
export interface ConnectorLine {
  readonly name: string
  /** What the CLI reported when it tried: `connected`, `failed`, or `configured` if unknown. */
  readonly status: string
}

export interface OfficeState {
  /** Always present. The manager cannot act correctly without knowing which project this is. */
  readonly project: string
  /**
   * Which mode this conversation is in.
   *
   * Optional so that a caller with nothing to say about mode — the aside path, a test — sends
   * the blocks that were always there and nothing more. Present means the block is sent.
   */
  readonly mode?: Mode
  /** Always present, for the same reason. */
  readonly staff: readonly StaffLine[]
  /** The shelf. `null` when the scan failed — reported, not silently empty. */
  readonly skills: readonly SkillLine[] | null
  readonly room?: readonly RoomLine[]
  /** `null` when the task list could not be read. `[]` means read, and all clear. */
  readonly outstanding?: readonly TaskLine[] | null
  readonly connectors?: readonly ConnectorLine[]
  readonly nowPlaying?: string | null
  /** Said only when it changes what the manager should attempt. */
  readonly planWarning?: string | null
}

const HEADINGS = {
  project: '## CURRENT PROJECT',
  mode: '## MODE',
  staff: '## CURRENT STAFF',
  skills: '## SKILLS ON THE SHELF',
  room: '## THE ROOM',
  outstanding: '## OUTSTANDING',
  connectors: '## CONNECTORS',
  playing: '## NOW PLAYING',
  plan: '## THIS PLAN',
} as const

/** Every heading the office may emit. */
export const OFFICE_HEADINGS: readonly string[] = Object.values(HEADINGS)

/**
 * The blocks to put in front of a message.
 *
 * Order is deliberate and stable: what this is, who is here, what they know how to do, then the
 * situational blocks. A manager reads top-down, and the two it can never act without come first.
 */
export function officeBlocks(state: OfficeState): readonly string[] {
  const blocks: string[] = [
    `${HEADINGS.project}\n\n${state.project}`,
    `${HEADINGS.staff}\n\n${staffBody(state.staff)}`,
  ]

  // Third, and before the shelf: what the manager may do bounds everything it could plan to do
  // with what comes after. A skills list read by a manager that does not yet know it cannot
  // dispatch is a list of things it is about to try and fail at.
  //
  // This block appears in *every* mode, breaking the "silence is the default" rule above, and
  // deliberately. A manager only told about its mode when something is withheld learns the block
  // means bad news — and the block that says "you may now build" is the one that most needs
  // reading.
  if (state.mode) blocks.push(`${HEADINGS.mode}\n\n${modeBody(state.mode)}`)

  const skills = skillsBody(state.skills)
  if (skills) blocks.push(`${HEADINGS.skills}\n\n${skills}`)

  // Only when somebody is somewhere other than their desk. "Everyone is at their desk" is the
  // ordinary case, and saying it every turn teaches the model to stop reading this section.
  if (state.room && state.room.length > 0) {
    blocks.push(`${HEADINGS.room}\n\n` + state.room.map((r) => `- ${r.who} — ${r.where}`).join('\n'))
  }

  const outstanding = outstandingBody(state.outstanding)
  if (outstanding) blocks.push(`${HEADINGS.outstanding}\n\n${outstanding}`)

  if (state.connectors && state.connectors.length > 0) {
    blocks.push(
      `${HEADINGS.connectors}\n\n` +
        state.connectors.map((c) => `- ${c.name} — ${c.status}`).join('\n') +
        '\n\nTools from these are named `mcp__<server>__<tool>`.',
    )
  }

  // The office has a mood and the manager is standing in it. Cheap, and it is the difference
  // between an agent that can answer "what's playing?" and one that cannot see its own room.
  if (state.nowPlaying) blocks.push(`${HEADINGS.playing}\n\n${state.nowPlaying}`)

  if (state.planWarning) {
    blocks.push(
      `${HEADINGS.plan}\n\n${state.planWarning}\n\n` +
        'Prefer cheaper models for mechanical work while this holds.',
    )
  }

  return blocks
}

function staffBody(staff: readonly StaffLine[]): string {
  const others = staff.filter((s) => !s.isManager)
  if (others.length === 0) {
    return 'Nobody else is on the floor, so there is nobody to dispatch to. Do the work yourself and say that is why.'
  }

  return others
    .map((s) => {
      const description = s.description.trim() || 'no description in the agent file'
      // `null` tools is inheritance, not absence. Reporting it as "none" would tell the manager
      // an employee can do nothing, which is the opposite of what it means.
      const tools = s.tools === null ? 'inherits all tools' : s.tools.join(', ') || 'none'
      return `- ${s.id} — ${description} (tools: ${tools})`
    })
    .join('\n')
}

/**
 * The shelf.
 *
 * `null` means the scan failed and the manager is told so, because "there are no skills" and
 * "we could not read the skills" lead to different behaviour and only one is a reason to carry
 * on regardless.
 */
function skillsBody(skills: readonly SkillLine[] | null): string | null {
  if (skills === null) {
    return 'The skill list could not be read. Do not assume there are none — say so if a skill would have helped.'
  }
  if (skills.length === 0) return null

  return (
    skills.map((s) => `- \`${s.id}\` — ${s.description.trim() || 'no description'}`).join('\n') +
    '\n\nInvoke one by name. Invoking a skill is a fact the floor can act on; describing one is not.'
  )
}

function outstandingBody(tasks: readonly TaskLine[] | null | undefined): string | null {
  if (tasks === undefined) return null
  if (tasks === null) {
    return "This project's task list could not be read, so nothing here is verified. Say so rather than reporting work as done."
  }
  if (tasks.length === 0) return null

  return (
    tasks
      .map((t) => `- #${t.ref} ${t.title}${t.owner ? ` (${t.owner})` : ''} — ${t.outcome}`)
      .join('\n') + '\n\nA task is not done because somebody said so. The harness decides.'
  )
}
