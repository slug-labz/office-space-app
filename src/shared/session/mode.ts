/**
 * What the office is allowed to do right now.
 *
 * The requirement, settled 2026-08-20: the manager comes to listen whenever you start talking,
 * and saying hi must not send it back to building — it stays until the person has agreed that
 * the full vision has been shared.
 *
 * ## Why this is state and not a sentence in the prompt
 *
 * `manager.md` already has a section called *Asking before you build*. It says: stop, ask one to
 * three questions, then build. It is a **one-shot**, and what is described above is exactly
 * what a one-shot produces — the manager asks, decides it has heard enough, and leaves.
 *
 * The obvious fix is to make the instruction firmer. That fix does not work here, and the reason
 * is the third standing order rather than a doubt about the model: **a prompt that loses an
 * argument with the rest of its context has lied about what mode it is in**, and the floor will
 * have drawn the lie. Laptop 1 made the same point from the other side — an intake badge painted
 * over a prompt-only mode is correct until the one turn it isn't, and that turn is precisely the
 * one being complained about.
 *
 * So the mode is held by the app and enforced by withholding tools. In `intake` the manager does
 * not have `Task`; it cannot dispatch. Not *should not* — cannot.
 *
 * **Measured against the installed CLI**, because building enforcement on an unverified flag is
 * how you ship a gate that does not gate: `claude --print --disallowedTools Task -- '<prompt>'`
 * leaves the model searching for `Task`, failing to find it, and saying so. The `--` matters —
 * `--disallowedTools` is variadic and eats the prompt without it.
 *
 * ## Who ends a mode
 *
 * **The person, never the model.** That is the whole feature. A mode the manager could leave when
 * it felt ready is the one-shot again, wearing a state machine as a costume.
 */

export type Mode =
  /** Listening. The manager asks, clarifies and proposes; it cannot dispatch or write. */
  | 'intake'
  /** The plan is being argued out. The manager may convene and delegate; it does not build yet. */
  | 'planning'
  /** Ordinary work. Nothing is withheld. */
  | 'building'

export const MODES = ['intake', 'planning', 'building'] as const satisfies readonly Mode[]

/**
 * Every `Mode` is in `MODES`, checked by the compiler rather than by anybody remembering.
 *
 * `readonly Mode[]` required each element to *be* a `Mode`; it never required every `Mode` to
 * appear. Adding a fourth to the union above and leaving this list alone does raise errors —
 * three, from switch exhaustiveness — but they point at the switches, and fixing those is not
 * a reason to come back here. Five tests iterate `MODES`, and every one of them would quietly
 * stop covering the new mode with the suite green.
 *
 * `Exclude` of the list's own element type from the union is empty when they agree, and is the
 * missing member when they do not — so the error names what was forgotten.
 */
type ModeMissingFromMODES = Exclude<Mode, (typeof MODES)[number]>
const _EVERY_MODE_IS_LISTED: ModeMissingFromMODES extends never ? true : ModeMissingFromMODES = true
void _EVERY_MODE_IS_LISTED

/** A new conversation starts here. */
export const FIRST_MODE: Mode = 'intake'

/**
 * A conversation that predates modes.
 *
 * `building`, not `intake` — a session written before this existed was one that could already do
 * everything, and resuming it into a mode that takes tools away would be the app changing
 * something the user never asked it to change. Absent is not empty; here it is a specific past.
 */
export const LEGACY_MODE: Mode = 'building'

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

/**
 * The tools each mode takes away.
 *
 * `Task` is delegation — the whole of "goes back and starts doing things" at the office level.
 * `Write` and `Edit` are the same instinct one level down: a manager that cannot dispatch but
 * can still edit files has not stopped building, it has started doing the work itself, which
 * `manager.md` already warns is the failure that empties the floor.
 *
 * `Read`, `Grep` and `Glob` stay in every mode, deliberately. Intake is where the manager should
 * be *finding out*, and `manager.md`'s own rule is **never ask what you can read** — a question
 * whose answer was on disk is an interruption that bought nothing. Taking reading away during the
 * one mode that exists for asking better questions would make the questions worse.
 */
export function withheldIn(mode: Mode): readonly string[] {
  switch (mode) {
    case 'intake':
      return ['Task', 'Write', 'Edit']
    case 'planning':
      // Planning convenes people and writes the plan down, so both come back. What planning does
      // not do is build, and that is not enforceable by tool: writing PLAN.md and writing the
      // feature use the same tool. It is held by the protocol in the `plan-together` skill.
      return []
    case 'building':
      return []
  }
}

/**
 * What the office tells the manager about the mode it is in. The body only — `blocks.ts` puts
 * the heading on, the same way it does for every other block.
 *
 * Present in every mode, unlike most blocks. The usual rule is that silence is the default and
 * presence is the signal — but a manager that is only told about its mode when something is
 * withheld learns the block means *bad news*, and the block that says "you may now build" is the
 * one that most needs reading.
 *
 * Being told what is withheld also matters more than it looks: an agent that discovers a missing
 * tool by reaching for it spends the turn confused and often apologises for a failure that is
 * not one. Naming it up front turns a wall into a rule.
 */
export function modeBody(mode: Mode): string {
  switch (mode) {
    case 'intake':
      return [
        '**intake** — you are listening. **`Task`, `Write` and `Edit` are withheld** — you cannot dispatch and',
        'you cannot change files, so do not plan around either.',
        '',
        'Stay here. Your job this turn is to understand what they actually want: ask, propose',
        'options, name the decisions hiding inside the request, and reflect back what you have',
        'understood so they can correct it. `ask` blocks are the right shape for choices.',
        '',
        '**Reading is not withheld, and asking what you could have read is still the failure it',
        'always was.** Go and look first.',
        '',
        '**You do not end this mode — they do.** Do not ask for permission to start, and do not',
        'treat a detailed answer as a cue to begin. If they ask for something you cannot do here,',
        'say plainly that you are still gathering the vision and that they can move you on when',
        'they are ready.',
      ].join('\n')
    case 'planning':
      return [
        '**planning** — the vision is gathered. Nothing is withheld, but you are not building yet.',
        '',
        'The plan is argued out before it is agreed: use the `plan-together` skill to put it to',
        'the people whose field it is, one at a time, and let them disagree with each other in',
        'writing. You hold the veto and you sign it. **Do not divide work until it is signed.**',
      ].join('\n')
    case 'building':
      return [
        '**building** — nothing is withheld. Dispatch, verify, and report as usual.',
      ].join('\n')
  }
}
