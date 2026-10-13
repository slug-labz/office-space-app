/**
 * What the composer says about the mode, and what the control that ends it is called.
 *
 * The requirement: the manager comes to listen whenever you start talking, and saying hi must
 * not send it back to building — it stays until the person has agreed that the full vision has
 * been shared.
 *
 * Laptop 2 built the half that makes this true rather than hoped-for: intake **withholds `Task`,
 * `Write` and `Edit` from the CLI**, so the manager cannot dispatch during intake even if the
 * instruction loses an argument with the rest of its context. That is why this surface is
 * allowed to exist at all — an indicator for a mode the app does not hold is a lie waiting for
 * the one turn it goes wrong, and that turn is precisely the one that was complained about.
 *
 * Two decisions live here, and both are copy:
 *
 * **What the mode is called to the person, as opposed to in the protocol.** `intake` is a word
 * from the design; what a person sees is what the office is doing and what it cannot do yet.
 *
 * **What the button says.** It is the control that ends intake, and `mode.ts` is emphatic about
 * why it exists: *"The person, never the model. A mode the manager could leave when it felt ready
 * is the one-shot again, wearing a state machine as a costume."* So the label is the sentence the
 * person is actually saying — *I have finished telling you* — and never an instruction to the
 * manager, which would read as though the model were being asked to agree.
 */

import type { Mode } from './session/mode.js'
import type { ModeChange } from './ipc.js'

/**
 * Whether a mode change belongs to the conversation on screen.
 *
 * A project is not a session but *a group* of them, and this event names exactly one. The
 * renderer used to check only the project, which was right for as long as a project meant one
 * conversation and wrong from the moment "Talk to them directly" shipped: that opens an
 * employee's own conversation in the same project and makes it the active one.
 *
 * With the project check alone, the office's mode moving from intake to building while you were
 * talking privately to the reviewer would repaint the mode panel with the office's chrome, toast
 * a transition you were not watching, and — the one that lasts — hand `showMode` a `conversing`
 * fact that it applies to `activeSession`'s scene. Scenes are per conversation. So the reviewer's
 * floor would move because the manager changed mode somewhere you could not see.
 *
 * That is the third standing order broken by a missing comparison. `ModeChange.sessionId` has
 * been on the wire since the event was written, built deliberately in `main.ts`, and read by
 * nothing until now — found by `scripts/unread-fields.mjs`.
 *
 * The same leak, on a different channel, that `restore()` already carries a comment about: *"a
 * project's second conversation was filled with the first one's words … because the argument it
 * needed was not in the signature."* Here the argument was in the signature.
 */
export function changeIsForHere(change: ModeChange, project: string, session: string): boolean {
  // An empty `session` is the renderer before it has opened one. Nothing is on screen to be
  // wrong yet, and letting the change through would apply a fact to a scene keyed by ''.
  if (!session) return false
  return change.project === project && change.sessionId === session
}

export interface ModeChrome {
  /**
   * Whether the composer says anything at all.
   *
   * `building` is the resting state and says nothing. A banner that is always on screen is
   * furniture: it stops being read within a day, and the two modes that *do* need saying would
   * inherit that indifference. Silence is the default; presence is the signal.
   */
  readonly shown: boolean
  /** What is happening, in the person's terms rather than the protocol's. */
  readonly lede: string
  /** What is withheld, said plainly, because a wall you were warned about is a rule. */
  readonly detail: string
  /** The label on the control that moves it on, and `null` when the person does not move it. */
  readonly action: string | null
  /** Where that control moves it to. */
  readonly next: Mode | null
  /**
   * The way back, and `null` from a mode there is no going back to.
   *
   * Reported: messages can be sent and nothing stops them — once planning and building start,
   * there is no stop button at all. Moving a conversation on was
   * a one-way door, which made pressing it a commitment rather than a step — and the person is
   * supposed to own the mode. A door that only opens one way is owned by whoever is on the
   * other side of it.
   */
  readonly back: string | null
  readonly previous: Mode | null
}

export function modeChrome(mode: Mode): ModeChrome {
  switch (mode) {
    case 'intake':
      return {
        shown: true,
        lede: 'The manager is listening.',
        // Naming what is withheld is not a disclaimer. An agent that discovers a missing tool by
        // reaching for it spends the turn confused; a person who does not know why nothing is
        // happening assumes it is broken. Both are answered by one sentence up front.
        detail:
          'It will ask questions and suggest options, and it cannot dispatch anyone or change ' +
          'files until you say the vision is complete.',
        // The person's sentence, not an instruction to the model. "Tell it to start" would put
        // the decision back with the manager, which is the thing this mode exists to take away.
        action: "That's the whole vision",
        next: 'planning',
        // Nowhere to go back to. Intake is where a conversation starts.
        back: null,
        previous: null,
      }
    case 'planning':
      return {
        shown: true,
        lede: 'The plan is being argued out.',
        detail:
          'The manager has called the others in. They take turns on the plan until nobody has ' +
          'a new objection, and the manager signs it.',
        action: 'Start building',
        next: 'building',
        back: 'Back to listening',
        previous: 'intake',
      }
    case 'building':
      // No banner, because building is the ordinary state and a permanent bar saying "nothing is
      // withheld" is chrome that earns nothing. The way back still exists — see `stopBuilding`
      // in the app, which is reached from the same control that stops a run.
      return {
        shown: false,
        lede: '',
        detail: '',
        action: null,
        next: null,
        back: 'Back to planning',
        previous: 'planning',
      }
  }
}

/**
 * What the office announces when a mode moves, or `null` when it should say nothing.
 *
 * Spoken to the live region that already announces hires, fires and deletes, because a mode
 * change is a change in what the app will do next and the person made it happen. `from` is used
 * rather than ignored: *"intake just ended"* and *"a new conversation opened in planning"* are
 * different facts, and only the first is worth interrupting anybody with.
 */
export function modeAnnouncement(from: Mode, to: Mode): string | null {
  if (from === to) return null
  if (from === 'intake' && to === 'planning') {
    return 'Intake is over. The manager is planning, and can call the others in.'
  }
  if (to === 'building') return 'Planning is frozen. The office is building.'
  // Anything else is the office arriving somewhere rather than being moved, which is not news.
  return null
}
