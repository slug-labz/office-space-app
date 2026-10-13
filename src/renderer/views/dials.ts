/**
 * The dials on the conversation — model, effort, permission mode.
 *
 * Three settings a Claude Code user already has in their terminal. What a change *does* is the
 * caller's business; this module builds the pickers and reports that one happened.
 *
 * The painting rule is the one that matters and it has not changed: {@link showControls} is
 * always given what the office came back with, never what the UI sent. A picker showing a value
 * the session is not running is the third standing order broken in the smallest possible way.
 *
 * What has changed is what a picker *is*. These were native `<select>` elements until they were
 * reported: a really bad default option, with no UI and no UX to it. A native option is one
 * line of text, so the list read
 * `acceptEdits` — a flag name that tells somebody who already knows what it does that it is
 * still selected, and everybody else nothing, while being the control that decides whether an
 * agent may write to their repository without asking. The explanations were already written, in
 * `controls.ts`, in doc comments nobody sees. `shared/control-copy.ts` is where they live now
 * and `views/select.ts` is a list with room for them.
 */

import { choicesFor, isGrave, triggerLabel } from '../../shared/control-copy.js'
import { OFFERED_PERMISSION_MODES, type Controls } from '../../shared/controls.js'
import { Select } from './select.js'

export interface DialElements {
  readonly model: HTMLElement
  readonly effort: HTMLElement
  readonly permission: HTMLElement
}

type Key = 'model' | 'effort' | 'permissionMode'

interface Dial {
  readonly of: (els: DialElements) => HTMLElement
  readonly key: Key
  readonly label: string
}

const DIALS: readonly Dial[] = [
  { of: (e) => e.model, key: 'model', label: 'Which model answers' },
  { of: (e) => e.effort, key: 'effort', label: 'How hard it thinks' },
  { of: (e) => e.permission, key: 'permissionMode', label: 'What it may do without asking' },
]

/** Built once at boot and kept, because a `Select` owns its open state and its cursor. */
const built = new Map<Key, Select>()

/**
 * What was just chosen, and has not been answered by the office yet.
 *
 * `Select` deliberately never sets its own value — it hands the chosen one to the caller and
 * waits to be told what the office actually holds, so a picker can never show a value the
 * session is not running. That rule is right and it is kept.
 *
 * What was missing was the other half. `onChange` was wired as `() => onChange()`, discarding
 * the value, and `readDials` then asked each `Select` for `.current` — which is only ever set
 * from what the office returned. So choosing an option sent the **old** value back, the office
 * answered with the old value, and the picker painted the old value.
 *
 * Selecting anything was a complete no-op, which from outside looks exactly like a menu that
 * does not respond to clicks — reported, accurately, as nothing here being clickable.
 *
 * The choice is held here instead: long enough to be sent, and dropped the moment the office
 * answers. The picker still only ever *shows* what it was told.
 */
const chosen = new Map<Key, string>()

/**
 * Build the three pickers and subscribe to changes.
 *
 * Idempotent about the DOM: calling it twice does not stack a second listbox inside the same
 * element, which matters because the boot sequence has re-run `fillDials` before now.
 *
 * Not idempotent about `document`. Each call constructs three `Select`s and each constructor adds
 * a `document` mousedown listener with no teardown, so a second call leaves three behind holding
 * three discarded Selects. Harmless while this only runs at boot — checked by driving the app —
 * and the reason to keep it that way. See the note in `views/select.ts`.
 */
export function fillDials(els: DialElements, onChange: () => void): void {
  built.clear()
  chosen.clear()

  for (const dial of DIALS) {
    const host = dial.of(els)
    host.replaceChildren()

    const permissions = dial.key === 'permissionMode'
    const select = new Select(host, {
      label: dial.label,
      // Not the full `PERMISSION_MODES`. Two of those are accepted by the CLI and then silently
      // resolved to `default` under `--print`, so offering them would put a mode in the picker
      // that the session is not in. See `IGNORED_UNDER_PRINT`.
      choices: permissions
        ? choicesFor(dial.key).filter((c) => OFFERED_PERMISSION_MODES.includes(c.value as never))
        : choicesFor(dial.key),
      triggerText: (value) => triggerLabel(dial.key, value),
      ...(permissions ? { grave: isGrave } : {}),
      // The value, not just the fact of a change. Discarding it is what made every picker inert.
      onChange: (value: string) => {
        chosen.set(dial.key, value)
        onChange()
      },
    })

    built.set(dial.key, select)
  }
}

/** What the three pickers are currently showing. */
export function readDials(_els: DialElements): Controls {
  // A choice that has not been answered yet wins over what is painted. That is the whole point
  // of sending: the painted value is what the office last confirmed, and if we sent that we
  // would only ever ask it to keep doing what it is already doing.
  const value = (key: Key): string => chosen.get(key) ?? built.get(key)?.current ?? 'default'

  return {
    model: value('model') as Controls['model'],
    effort: value('effort') as Controls['effort'],
    permissionMode: value('permissionMode') as Controls['permissionMode'],
  }
}

/**
 * Paint the dials from what the office actually holds.
 *
 * `unknown` is whatever the office dropped — reported by the caller rather than swallowed here,
 * because saying so is a sentence in the conversation and this module does not have one.
 */
export function showControls(
  _els: DialElements,
  controls: Controls,
  unknown: readonly string[],
): void {
  for (const dial of DIALS) {
    const value = String(controls[dial.key])
    // Answered. Whatever was pending is now either painted or was refused, and either way the
    // office's answer is the truth from here on.
    chosen.delete(dial.key)
    built.get(dial.key)?.set(value, {
      set: value !== 'default',
      unknown: unknown.some((u) => u.startsWith(`${dial.key}=`)),
    })
  }
}
