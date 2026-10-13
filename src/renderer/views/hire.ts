/**
 * The two forms that add something to the office: an employee, and a skill.
 *
 * Both write a markdown file in `.claude/`, and that is the thing this form should make
 * obvious rather than hide. The office's premise is that the workspace *is* the backend — so a
 * hire form that felt like an account signup would be describing a different product. It shows
 * the path it is about to write, and every field is a line of frontmatter you could have typed
 * yourself.
 *
 * ## Why the name is checked here as well as in main
 *
 * It is the same function, imported from `shared/agent-id.ts` — not a second copy. A name that
 * cannot be a filename should be refused under the cursor that typed it, not after a round trip
 * that ends in a red sentence at the bottom of a form. `hire()` still validates independently,
 * because a renderer check is a courtesy and never a guarantee.
 *
 * ## The tools field, and the default that is not "none"
 *
 * Omitting `tools:` inherits everything, including `Task` — which lets an employee summon a
 * colleague and breaks the standing order that only the user and the manager originate work. So
 * the form's default is a *named list*, not blank, and choosing to inherit is a deliberate
 * checkbox with the consequence written next to it.
 */

import { whyInvalid } from '../../shared/agent-id.js'
import type { HireRequest, SkillRequest } from '../../shared/ipc.js'

/** What the office ships with. A starting point somebody edits, not a policy. */
const COMMON_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'TodoWrite']

/*
 * The two drafts are the IPC contracts by name, not copies of their shape.
 *
 * They used to be written out field for field here. TypeScript is structural, so the copies
 * compiled and the forms worked — which is the hazard rather than the reassurance. Add a required
 * field to `HireRequest` and this file keeps compiling against its own five, submits a draft
 * missing the sixth, and both halves typecheck the whole way. The names stay because "draft" is
 * the right word for what a form holds; only the duplication goes.
 */

export type HireDraft = HireRequest

export type SkillDraft = SkillRequest

export interface FormHandlers<T> {
  readonly onSubmit: (draft: T) => void
  readonly onCancel: () => void
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** A labelled control. The label is a real `<label for>`, so the hit area and the reader agree. */
function field(id: string, label: string, control: HTMLElement, note?: string): HTMLElement {
  const wrap = el('div', 'form__field')
  const lab = el('label', 'form__label', label)
  lab.htmlFor = id
  wrap.appendChild(lab)
  wrap.appendChild(control)
  if (note) wrap.appendChild(el('p', 'form__note', note))
  return wrap
}

function input(id: string, placeholder: string): HTMLInputElement {
  const node = el('input', 'form__input mono')
  node.id = id
  node.type = 'text'
  node.placeholder = placeholder
  node.spellcheck = false
  return node
}

function textarea(id: string, placeholder: string, rows: number): HTMLTextAreaElement {
  const node = el('textarea', 'form__area')
  node.id = id
  node.placeholder = placeholder
  node.rows = rows
  return node
}

/** The hire form. Returns the element; the caller decides where it goes. */
export function hireForm(on: FormHandlers<HireDraft>): HTMLElement {
  const form = el('form', 'form')

  const name = input('hire-id', 'reviewer')
  const path = el('p', 'form__path mono', '.claude/agents/….md')
  const problem = el('p', 'form__problem')
  problem.hidden = true

  const desc = input('hire-desc', 'Reviews code for bugs and things that break in production')
  const model = el('select', 'form__input mono')
  model.id = 'hire-model'
  for (const [value, label] of [
    ['', 'the workspace default'],
    ['haiku', 'haiku — mechanical, specified work'],
    ['sonnet', 'sonnet — ordinary engineering'],
    ['opus', 'opus — where being confidently wrong is expensive'],
  ] as const) {
    const option = el('option', undefined, label)
    option.value = value
    model.appendChild(option)
  }

  const tools = input('hire-tools', COMMON_TOOLS.join(', '))
  tools.value = COMMON_TOOLS.join(', ')

  const inherit = el('input')
  inherit.type = 'checkbox'
  inherit.id = 'hire-inherit'
  const inheritRow = el('div', 'form__check')
  inheritRow.appendChild(inherit)
  const inheritLabel = el(
    'label',
    'form__check-label',
    'Inherit every tool — including the one that dispatches other agents',
  )
  inheritLabel.htmlFor = 'hire-inherit'
  inheritRow.appendChild(inheritLabel)
  inherit.addEventListener('change', () => {
    tools.disabled = inherit.checked
    tools.classList.toggle('form__input--off', inherit.checked)
  })

  const prompt = textarea('hire-prompt', 'What this employee is for, written to them.', 8)

  // Live validation, and a live preview of the file path. Both come from the same keystroke
  // because the name *is* the path — showing them apart would hide the connection this form
  // exists to teach.
  const revalidate = () => {
    const id = name.value.trim()
    const bad = id === '' ? null : whyInvalid(id)
    problem.textContent = bad ?? ''
    problem.hidden = bad === null
    name.classList.toggle('form__input--bad', bad !== null)
    path.textContent = id === '' ? '.claude/agents/….md' : `.claude/agents/${id}.md`
  }
  name.addEventListener('input', revalidate)

  form.appendChild(el('h4', 'label', 'Hire somebody'))
  form.appendChild(
    field('hire-id', 'Name', name, 'Lowercase, no spaces. This is what the manager types to dispatch to them.'),
  )
  form.appendChild(path)
  form.appendChild(problem)
  form.appendChild(
    field(
      'hire-desc',
      'What they are for',
      desc,
      'The manager routes on this sentence. Say the kind of work, not the person.',
    ),
  )
  form.appendChild(field('hire-model', 'Model', model, 'The manager can override this per task.'))
  form.appendChild(field('hire-tools', 'Tools', tools, 'Comma separated.'))
  form.appendChild(inheritRow)
  form.appendChild(field('hire-prompt', 'Their prompt', prompt))

  form.appendChild(
    buttons(form, 'Write the file', on.onCancel, () => {
      const id = name.value.trim()
      const bad = whyInvalid(id)
      if (bad) {
        problem.textContent = bad
        problem.hidden = false
        name.focus()
        return
      }
      on.onSubmit({
        id,
        description: desc.value.trim(),
        tools: inherit.checked
          ? null
          : tools.value
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
        model: model.value || null,
        prompt: prompt.value.trim(),
      })
    }),
  )

  return form
}

/** The skill form. Same shape, three fields, and the same "here is the file" honesty. */
export function skillForm(on: FormHandlers<SkillDraft>): HTMLElement {
  const form = el('form', 'form')

  const name = input('skill-id', 'record-progress')
  const path = el('p', 'form__path mono', '.claude/skills/…/SKILL.md')
  const problem = el('p', 'form__problem')
  problem.hidden = true

  const desc = input('skill-desc', 'Append what just happened to the project’s PROGRESS.md')
  const body = textarea('skill-body', 'The steps, written to whoever invokes it.', 10)

  // A skill id becomes a directory name, so it is governed by the same rule as an agent id.
  name.addEventListener('input', () => {
    const id = name.value.trim()
    const bad = id === '' ? null : whyInvalid(id)
    problem.textContent = bad ?? ''
    problem.hidden = bad === null
    name.classList.toggle('form__input--bad', bad !== null)
    path.textContent = id === '' ? '.claude/skills/…/SKILL.md' : `.claude/skills/${id}/SKILL.md`
  })

  form.appendChild(el('h4', 'label', 'Write a skill'))
  form.appendChild(field('skill-id', 'Name', name, 'What anybody here types to invoke it.'))
  form.appendChild(path)
  form.appendChild(problem)
  form.appendChild(
    field('skill-desc', 'What it does', desc, 'One line. This is what the manager reads to decide to use it.'),
  )
  form.appendChild(field('skill-body', 'The steps', body))

  form.appendChild(
    buttons(form, 'Put it on the shelf', on.onCancel, () => {
      const id = name.value.trim()
      const bad = whyInvalid(id)
      if (bad) {
        problem.textContent = bad
        problem.hidden = false
        name.focus()
        return
      }
      on.onSubmit({ id, description: desc.value.trim(), body: body.value.trim() })
    }),
  )

  return form
}

/**
 * Cancel and submit, wired to the form rather than to the button.
 *
 * Binding `submit` on the form is what makes Enter work from any field — the browser already
 * knows that rule and reimplementing it with keydown handlers is how a form ends up ignoring
 * the return key in exactly one of its inputs.
 */
function buttons(
  form: HTMLFormElement,
  submitLabel: string,
  onCancel: () => void,
  onSubmit: () => void,
): HTMLElement {
  const row = el('div', 'form__buttons')

  const cancel = el('button', 'btn btn--sm roster__act', 'Cancel')
  cancel.type = 'button'
  cancel.addEventListener('click', onCancel)
  row.appendChild(cancel)

  const submit = el('button', 'btn btn--sm btn--primary', submitLabel)
  submit.type = 'submit'
  row.appendChild(submit)

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    onSubmit()
  })

  return row
}
