/**
 * The one control that answers *where am I*.
 *
 * It replaces three surfaces: the horizontal tab strip, the 254 × **12.5px** session button in
 * the pane header, and the drawer that button opened. The shape was chosen from a mock —
 * projects above, the current project's conversations below, `+ new conversation` inside the
 * list so that `new` never competes for header space.
 *
 * Builds DOM and nothing else. Every judgement it would otherwise bury in a branch lives in
 * `shared/switcher.ts`, which is the repository's convention and the only way a decision in this
 * renderer can be reached by a test.
 */

import type { ProjectInfo, SessionInfo } from '../../shared/ipc.js'
import {
  narrow,
  newActions,
  projectNames,
  projectRows,
  sessionNames,
  sessionRows,
  splitSessions,
  switcherLabel,
} from '../../shared/switcher.js'

/**
 * How many rows before the list gets a filter.
 *
 * Twelve is a screenful. Below it the list is something you read; above it, something you search,
 * and a search box on a four-project workspace is chrome earning nothing — the same call as the
 * mode banner that shows nothing when nothing is withheld.
 */
const FILTER_ABOVE = 12

export interface SwitcherHandlers {
  readonly onProject: (id: string) => void
  readonly onSession: (id: string) => void
  readonly onNewSession: () => void
  /** Start a project with this name. The switcher collects it; `window.prompt` does not exist. */
  readonly onNewProject: (name: string) => void
  /** Hide a conversation. Reversible, and it deletes nothing. */
  readonly onCloseSession: (id: string) => void
  /** Move a project out of `projects/`. Reversible, and it leaves the workspace intact. */
  readonly onArchiveProject: (id: string) => void
  /** The one destructive verb. The app asks first, naming what it is about to remove. */
  readonly onDeleteProject: (id: string) => void
}

export interface SwitcherModel {
  readonly projects: readonly ProjectInfo[]
  readonly activeProject: string
  readonly sessions: readonly SessionInfo[]
  /**
   * The workspace this office is a window onto.
   *
   * On the trigger's `title` rather than in its label, for now. An app pointed at an unexpected
   * directory and an app with nothing in it look identical, and that cost an hour today —
   * conversations safely on disk read as lost because nothing said which office was open.
   *
   * Naming it *inline* needs one field main does not send yet: whether this root is the one the
   * app would have picked anyway. Until then it is one hover away rather than nowhere, and the
   * decision that will use that field is already written and tested in `shared/switcher.ts`.
   */
  readonly root: string
  /** Which agent runs the office, so a conversation with anybody else can be told apart. */
  readonly manager: string
  /** Injected rather than read, so the rendering is a pure function of its input in tests. */
  readonly now: number
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export interface Switcher {
  render(model: SwitcherModel): void
  close(): void
  isOpen(): boolean
  /** Open the list with the cursor in the new-project field. The `+` menu's route, shared. */
  startNewProject(): void
}

/**
 * The row that starts a project, and why it holds a text field.
 *
 * It used to close the list and call `window.prompt`. **Electron does not implement
 * `window.prompt`** — Chromium's is a text-input dialog Electron provides no native
 * implementation for, so it returns `null` and the caller's `if (name !== null)` is false. The
 * result was a button that closed the switcher and did nothing at all, with nothing in the
 * console and nothing on screen. Reproduced by pressing it: three projects before, three after.
 *
 * The comment on the old call explained the choice — *"A list row cannot hold a text field
 * without becoming a different kind of row, so it asks"* — and that is a fair design objection to
 * exactly what this now does. It loses to the alternative not working. A row that becomes an
 * input when you press it is a common shape and it keeps naming where the person already is,
 * rather than in a modal over a list they opened to navigate.
 *
 * Enter commits, Escape and blur put the row back. Nothing is created by opening the field.
 */
function newProjectRow(on: SwitcherHandlers, close: () => void): {
  readonly row: HTMLElement
  /** Open the field and put the cursor in it. The `+` menu's project entry lands here too. */
  readonly start: () => void
} {
  const row = el('div', 'swrow swrow--add')

  const button = el('button', 'swrow__label', '+ new project') as HTMLButtonElement
  button.type = 'button'

  const field = document.createElement('input')
  field.type = 'text'
  field.className = 'swrow__input mono'
  field.placeholder = 'What is it called?'
  field.hidden = true

  const rest = (): void => {
    field.hidden = true
    field.value = ''
    button.hidden = false
  }

  const commit = (): void => {
    const name = field.value.trim()
    rest()
    // An empty name is a cancel, not a failure — the person opened the field and thought better
    // of it, and `createProject` would refuse it anyway with a message nobody asked for.
    if (name === '') return
    close()
    on.onNewProject(name)
  }

  button.addEventListener('click', () => {
    button.hidden = true
    field.hidden = false
    field.focus()
  })
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      rest()
    }
  })
  field.addEventListener('blur', rest)

  row.appendChild(button)
  row.appendChild(field)
  return { row, start: () => button.click() }
}

/**
 * @param trigger the button in the pane header that says where you are
 * @param list    the panel it opens, which covers the transcript rather than sitting beside it
 * @param newOpen the `+` segment welded to the trigger — the way to start something
 * @param newMenu the two-item menu that segment opens
 */
export function mountSwitcher(
  trigger: HTMLButtonElement,
  list: HTMLElement,
  newOpen: HTMLButtonElement,
  newMenu: HTMLElement,
  on: SwitcherHandlers,
): Switcher {
  let model: SwitcherModel | null = null

  const isOpen = (): boolean => !list.hidden

  /**
   * The `+` menu, closed.
   *
   * Declared before `close` because both directions of "only one of these is open at a time"
   * have to hold: opening the list closes this, and opening this closes the list. Two dropdowns
   * hanging from the same box, overlapping, both correct, is a thing you only see once.
   */
  const closeNew = (): void => {
    newMenu.hidden = true
    newOpen.setAttribute('aria-expanded', 'false')
  }

  /** Filled in on each render, because the row it belongs to is rebuilt each time. */
  let startNaming: () => void = () => {}

  /**
   * What has been typed into the filter, and the field itself so focus survives a redraw.
   *
   * Held out here rather than read off the DOM, because `draw()` replaces the list's children —
   * including the field — every time. Reading the value from an element that is about to be
   * destroyed is how a search box loses what you typed on the keystroke after you typed it.
   */
  let query = ''
  let field: HTMLInputElement | null = null

  const close = (): void => {
    list.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
  }

  const open = (): void => {
    closeNew()
    list.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    // The row you are on, not the first row. Somebody opening this to move somewhere else is
    // starting from where they are, and arrow keys should agree with that.
    list.querySelector<HTMLElement>('[aria-current="true"]')?.focus()
  }

  /**
   * Start something — a conversation, or a project — without opening the list and without ⌘K.
   *
   * Built on **open**, and that is the whole of the interaction. `views/select.ts` had a row
   * that rebuilt itself on `mouseenter`, which destroys the element under the pointer between
   * the press and the release, so the click lands on nothing and the control is simply dead to a
   * mouse while looking perfectly alive. Nothing here listens to the pointer moving.
   */
  const openNew = (): void => {
    close()
    const label = switcherLabel(
      model?.projects.find((p) => p.id === model?.activeProject),
      model?.sessions.find((s) => s.current),
    )

    newMenu.replaceChildren()
    for (const entry of newActions(label.project)) {
      const item = el('button', 'popmenu__item', entry.label) as HTMLButtonElement
      item.type = 'button'
      item.setAttribute('role', 'menuitem')
      item.dataset['action'] = entry.action
      item.addEventListener('click', () => {
        closeNew()
        if (entry.action === 'session') {
          on.onNewSession()
          return
        }
        // The `+` menu and the list row are the same act, so they end in the same field rather
        // than in two ways of naming a project that can drift apart. Opening the list draws the
        // row, which is what gives `startNaming` something to call.
        open()
        startNaming()
      })
      newMenu.appendChild(item)
    }

    newMenu.hidden = false
    newOpen.setAttribute('aria-expanded', 'true')
    newMenu.querySelector<HTMLElement>('.popmenu__item')?.focus()
  }

  const row = (
    kind: 'project' | 'session',
    id: string,
    title: string,
    meta: string,
    current: boolean,
    running: boolean,
    pick: () => void,
  ): HTMLElement => {
    const node = el('button', `swrow${current ? ' swrow--current' : ''}`) as HTMLButtonElement
    node.type = 'button'
    node.dataset['kind'] = kind
    node.dataset['id'] = id
    // `aria-current` rather than `aria-selected`: this is a list of destinations and one of them
    // is where you already are, which is exactly what `aria-current="true"` means. A listbox
    // would be a lie about a control that navigates rather than selects.
    if (current) node.setAttribute('aria-current', 'true')

    // The dot is the tag that was asked for. It is drawn for the current row *and* for a running
    // one, in different colours, because "where I am" and "this is working" are different facts
    // and a list that conflated them would say the office is idle whenever you looked away.
    const dot = el('span', `swrow__dot${running ? ' swrow__dot--running' : ''}`)
    dot.setAttribute('aria-hidden', 'true')
    node.appendChild(dot)

    const lines = el('span', 'swrow__lines')
    lines.appendChild(el('span', 'swrow__title', title))
    lines.appendChild(el('span', 'swrow__meta', meta))
    node.appendChild(lines)

    node.addEventListener('click', () => {
      close()
      pick()
    })
    return node
  }

  /**
   * The row's own actions, revealed on hover or focus.
   *
   * Quiet at rest and never hidden: they stay in the DOM with their labels, so a list of four
   * projects reads as four projects rather than as twelve buttons. That is the same trade the
   * roster made when `Send home` and `Fire` stopped being permanently drawn under every
   * employee — and the same reason, which is that a destructive action belongs one step away
   * rather than under the cursor by default.
   */
  const actions = (
    entries: readonly { readonly label: string; readonly title: string; readonly danger?: boolean; readonly run: () => void }[],
  ): HTMLElement => {
    const bar = el('span', 'swrow__actions')
    for (const entry of entries) {
      const button = el('button', `swact${entry.danger ? ' swact--danger' : ''}`, entry.label) as HTMLButtonElement
      button.type = 'button'
      button.title = entry.title
      button.addEventListener('click', (event) => {
        // The row is a navigation button and this sits inside it. Without this, archiving a
        // project would also switch to it on the way out.
        event.stopPropagation()
        entry.run()
      })
      bar.appendChild(button)
    }
    return bar
  }

  /** One conversation row, with the close action every conversation has. */
  const conversation = (s: ReturnType<typeof sessionRows>[number], who?: string): HTMLElement => {
    const node = row('session', s.id, who ? `${who} — ${s.title}` : s.title, s.meta, s.current, s.running, () => on.onSession(s.id))
    node.appendChild(
      actions([
        { label: 'close', title: "Hide this conversation from the list. The transcript is Claude Code's and is not touched.", run: () => on.onCloseSession(s.id) },
      ]),
    )
    return node
  }

  const draw = (): void => {
    if (model === null) return
    const { projects, activeProject, sessions, now } = model

    const project = projects.find((p) => p.id === activeProject)
    const session = sessions.find((s) => s.current)
    const label = switcherLabel(project, session)

    trigger.replaceChildren()
    trigger.appendChild(el('span', 'switcher__project', label.project))
    trigger.appendChild(el('span', 'switcher__sep', '·'))
    trigger.appendChild(el('span', 'switcher__session', label.session))
    trigger.setAttribute('aria-label', `${label.project}, ${label.session}. Change project or conversation.`)
    trigger.title = `${label.project} — ${label.session}\n${model.root}`

    // Read **before** the list is emptied. `replaceChildren` detaches the old field, and
    // removing the focused element moves focus to `<body>` — so asked afterwards this is always
    // false and the caret is always gone. The first version of this had the comment above the
    // read and the read below the wipe, which is the fault this whole branch keeps finding.
    const hadFocus = field !== null && document.activeElement === field
    const caret = field?.selectionStart ?? query.length

    list.replaceChildren()

    /**
     * A filter, once there is enough to filter.
     *
     * Not always. A workspace with four projects does not need a search box, and chrome that
     * earns nothing is the thing this app removes rather than adds — the same call as the mode
     * banner that shows nothing when nothing is withheld.
     *
     * Measured on a workspace with 620 projects: the switcher drew 620 rows, in a flat list, with
     * no way to narrow them. ⌘K reaches them by name now; this is the other door, and it is the
     * one the app's own palette entry points at.
     */
    const total = projects.length + sessions.length
    if (total > FILTER_ABOVE) {
      const box = document.createElement('input')
      box.type = 'search'
      box.className = 'swfilter'
      box.value = query
      // Both plurals, because a count in a sentence carries its own — `repo-health.test.ts`
      // checks this and caught it here, which is the check doing exactly its job on a string
      // written a minute earlier.
      const many = (n: number, one: string, more: string): string => `${n} ${n === 1 ? one : more}`
      box.placeholder = `Filter ${many(projects.length, 'project', 'projects')} and ${many(
        sessions.length,
        'conversation',
        'conversations',
      )}`
      box.setAttribute('aria-label', 'Filter projects and conversations')
      box.addEventListener('input', () => {
        query = box.value
        draw()
      })
      // Down out of the field and into the rows, so the keyboard reads as one list rather than a
      // box with a list under it. Escape is left to the list's own handler, which closes and
      // hands focus back to the trigger — one way out, wherever you are.
      box.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown') return
        event.preventDefault()
        list.querySelector<HTMLElement>('.swrow')?.focus()
      })
      list.appendChild(box)

      // `draw()` replaces the list's children, and it is called from this field's own `input`
      // handler — so the element you are typing into is destroyed on the keystroke after you
      // type it. Carrying the focus and the caret across is what makes the box usable at all;
      // without it every character lands and then focus falls to the body.
      if (hadFocus) {
        box.focus()
        box.setSelectionRange(caret, caret)
      }
      field = box
    } else {
      field = null
    }

    const shownProjects = narrow(projects, query, projectNames)

    list.appendChild(el('p', 'swgroup', 'Projects'))
    for (const p of projectRows(shownProjects, activeProject, now)) {
      const node = row('project', p.id, p.name, p.meta, p.current, p.running, () => on.onProject(p.id))
      // The office itself is not a directory under `projects/`, so there is nothing to archive
      // or delete — and offering a control that would be refused teaches nothing.
      if (!p.isOffice) {
        node.appendChild(
          actions([
            { label: 'archive', title: `Move ${p.name} out of projects/ and into projects/.archived/. Nothing leaves the workspace.`, run: () => on.onArchiveProject(p.id) },
            { label: 'delete', title: `Move ${p.name} to the Trash. You will be told exactly what that removes first.`, danger: true, run: () => on.onDeleteProject(p.id) },
          ]),
        )
      }
      list.appendChild(node)
    }

    if (shownProjects.length === 0) {
      // There is no "no projects yet" to confuse this with — the office is always one — so an
      // empty project group can only ever be about what was typed.
      list.appendChild(el('p', 'swempty', `No project matches “${query.trim()}”.`))
    }

    const naming = newProjectRow(on, close)
    startNaming = naming.start
    list.appendChild(naming.row)

    const { office, people } = splitSessions(narrow(sessions, query, sessionNames), model.manager)

    list.appendChild(el('p', 'swgroup', `Conversations in ${label.project}`))
    const rows = sessionRows(office, now)
    for (const s of rows) list.appendChild(conversation(s))
    if (rows.length === 0) {
      // Two different empty groups, and they are not the same fact. One is a project nobody has
      // spoken to; the other is a filter that matched nothing, which is about what was typed
      // rather than about the workspace — and saying "no conversations yet" there would report
      // the query's result as a property of the project. Fourth standing order, on the surface
      // where it is easiest to break.
      list.appendChild(
        el(
          'p',
          'swempty',
          query.trim() === ''
            ? 'No conversations in this project yet.'
            : `No conversation here matches “${query.trim()}”.`,
        ),
      )
    }

    // The third level, and the reason the control was built two deep: people.
    //
    // Only shown once somebody has actually talked to one. A heading over an empty group would
    // be the app advertising a feature rather than listing what is there — the way in is
    // clicking somebody on the floor, which is where you are already looking at them.
    if (people.length > 0) {
      list.appendChild(el('p', 'swgroup', 'People you have talked to'))
      for (const s of sessionRows(people, now)) {
        list.appendChild(conversation(s, s.agent))
      }
    }

    // Inside the list, which is Khalid's — so `new` never competes for header space.
    const newSession = el('button', 'swrow swrow--add', '+ new conversation') as HTMLButtonElement
    newSession.type = 'button'
    newSession.addEventListener('click', () => {
      close()
      on.onNewSession()
    })
    list.appendChild(newSession)
  }

  trigger.addEventListener('click', () => (isOpen() ? close() : open()))

  // Arrows, Home/End and Escape, because a list you can only reach with a mouse is half a
  // control — and the tab strip this replaces was traversable with Tab for free.
  list.addEventListener('keydown', (event) => {
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>('.swrow'))
    const here = rows.indexOf(document.activeElement as HTMLButtonElement)
    const go = (i: number) => {
      event.preventDefault()
      rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus()
    }
    if (event.key === 'ArrowDown') go(here + 1)
    else if (event.key === 'ArrowUp') go(here - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(rows.length - 1)
    else if (event.key === 'Escape') {
      event.preventDefault()
      close()
      trigger.focus()
    }
  })

  // Clicking anywhere else. `mousedown` rather than `click`, so the list is gone before whatever
  // you clicked receives its own event — otherwise picking something behind the panel opens it
  // underneath a panel that is still up.
  document.addEventListener('mousedown', (event) => {
    if (!isOpen()) return
    const target = event.target as Node
    if (!list.contains(target) && !trigger.contains(target)) close()
  })

  newOpen.addEventListener('click', () => (newMenu.hidden ? openNew() : closeNew()))

  // The same two ways out every other menu in this app answers to, written the same way: a
  // mousedown outside, and Escape. `#more-menu`, `#dials-menu` and `#mic-menu` each carry their
  // own pair rather than joining `escapables()`, because that list is for the panels that cover
  // the app and a menu is not one.
  document.addEventListener('mousedown', (event) => {
    if (newMenu.hidden) return
    const target = event.target as Node
    if (!newMenu.contains(target) && !newOpen.contains(target)) closeNew()
  })

  newMenu.addEventListener('keydown', (event) => {
    const items = Array.from(newMenu.querySelectorAll<HTMLButtonElement>('.popmenu__item'))
    const here = items.indexOf(document.activeElement as HTMLButtonElement)
    const go = (i: number) => {
      event.preventDefault()
      items[Math.max(0, Math.min(items.length - 1, i))]?.focus()
    }
    if (event.key === 'ArrowDown') go(here + 1)
    else if (event.key === 'ArrowUp') go(here - 1)
    else if (event.key === 'Escape') {
      event.preventDefault()
      closeNew()
      newOpen.focus()
    }
  })

  return {
    render(next: SwitcherModel) {
      model = next
      draw()
    },
    // Both dropdowns, because this is what `closeEverything()` calls and Escape has to mean
    // *out*. A `close` that left the `+` menu standing would be the two-lists bug that
    // `escapables()` exists to prevent, reintroduced one level down.
    close: () => {
      close()
      closeNew()
    },
    isOpen,
    /**
     * Open the list and put the cursor in the new-project field.
     *
     * The same two lines the `+` menu runs, for the same reason its comment gives: *"the `+` menu
     * and the list row are the same act, so they end in the same field rather than in two ways of
     * naming a project that can drift apart."*
     *
     * `⌘K → "Start a new project"` was a third way, and it had already drifted: it reached into
     * the closed list for `.swrow--add` and called `.click()` on it. That element is a `div` —
     * the handler is on a button inside it — so the command did nothing whatever, and would have
     * opened a field inside a hidden list even if it had found one. Found by operating the app.
     */
    startNewProject: () => {
      open()
      startNaming()
    },
  }
}
