/**
 * The form and the writer, held to the same answer.
 *
 * `shared/agent-id.ts` opens with a promise:
 *
 *   "Two copies of this rule would be the more obvious way to get that, and it is the wrong one:
 *    the copy in the renderer would drift from the copy that actually writes the file, and the
 *    drift would show up as a form that accepts a name the office then rejects — the least
 *    explicable failure a form can have."
 *
 * It is kept by there being one definition, which is the right way to keep it. **Nothing checked
 * that it stays kept.** A future `whyInvalid` in the renderer, a relaxed regex on one side, a
 * trim in one place and not the other — each of those restores the two copies the comment is
 * about, and every existing test would go on passing, because each layer is tested against
 * itself.
 *
 * So this asks both layers the same questions and requires the same answers. Not that either is
 * right — `roster.test.ts` and the guards have their own tests for that — but that they cannot
 * disagree, which is the property the comment actually promises.
 *
 * The corpus deliberately includes names that are *fine*. A test that only feeds bad names would
 * pass against a form that refuses everything.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { hireForm, skillForm, type HireDraft, type SkillDraft, type FormHandlers } from '../src/renderer/views/hire.js'
import { hire } from '../src/main/roster.js'
import { installDom, type El } from './dom.js'
import { tempDir } from './temp-dir.js'

installDom()

/** Names a person might type, good and bad, including the shapes that became paths. */
const NAMES = [
  'auditor',
  'data-scientist',
  'a',
  'x9',
  '',
  '   ',
  'Reviewer',
  'my_helper',
  'data.scientist',
  'has space',
  '../skills/victim',
  '../../etc/passwd',
  'a/b',
  '.hidden',
  '-leading',
  'x'.repeat(65),
] as const

function all(node: El): El[] {
  return [node, ...node.children.flatMap((child) => all(child))]
}

/** Type a name into the form and press the button. Returns what the form let through. */
function formAccepts(id: string): boolean {
  let submitted: HireDraft | null = null
  const on: FormHandlers<HireDraft> = { onSubmit: (draft) => (submitted = draft), onCancel: () => {} }
  const form = hireForm(on) as unknown as El

  const input = all(form).find((n) => n.tag === 'input' && n.id === 'hire-id')
  assert.ok(input, 'the hire form has no name field — this check is blind')
  input.value = id
  input.dispatchEvent({ type: 'input', bubbles: false })

  // The button is `type="submit"` and the handler is on the FORM's submit event, which is how a
  // browser wires it — so submitting means dispatching `submit`, not clicking. The first draft
  // clicked the button, nothing happened, and the control caught it: "the form refused every name
  // in the corpus, so it is not being driven". Without that control this file would have reported
  // perfect agreement between a working writer and a form that was never asked anything.
  const submit = all(form).find((n) => n.tag === 'button' && /Write the file/.test(n.textContent))
  assert.ok(submit, 'the hire form has no submit button — this check is blind')
  form.dispatchEvent({ type: 'submit', bubbles: false })

  return submitted !== null
}

async function writerAccepts(t: TestContext, id: string): Promise<boolean> {
  const root = await tempDir(t, 'hire-agree-')
  await mkdir(join(root, '.claude', 'agents'), { recursive: true })
  const out = await hire(root, { id, description: 'does a thing', tools: null, model: null, prompt: 'Hello.' })
  return out.ok
}

test('the form and the writer agree about every name, in both directions', async (t) => {
  // The control, first and inside the test: a form that refuses everything would pass a corpus of
  // bad names, and a writer that accepts everything would pass a corpus of good ones.
  const accepted = NAMES.filter((id) => formAccepts(id))
  assert.ok(accepted.length > 0, 'the form refused every name in the corpus, so it is not being driven')
  assert.ok(accepted.length < NAMES.length, 'the form accepted every name, so it is not validating')

  const disagreements: string[] = []
  for (const id of NAMES) {
    const form = formAccepts(id)
    const writer = await writerAccepts(t, id)
    if (form !== writer) {
      disagreements.push(
        `${JSON.stringify(id)}: the form ${form ? 'accepts' : 'refuses'} it and the writer ${writer ? 'accepts' : 'refuses'} it`,
      )
    }
  }

  assert.deepEqual(
    disagreements,
    [],
    'the renderer and the module that writes the file no longer agree about what a name is. ' +
      'That is the two-copies failure `shared/agent-id.ts` was extracted to prevent — a form ' +
      'that accepts a name the office then rejects, or refuses one it would have taken.\n  ' +
      disagreements.join('\n  '),
  )
})

test('a name the form refuses never reaches the handler', async () => {
  // The form's own half. Refusing in the label while still submitting would satisfy the agreement
  // test above only by accident, and would write the file anyway.
  let submitted = 0
  const on: FormHandlers<HireDraft> = { onSubmit: () => (submitted += 1), onCancel: () => {} }
  const form = hireForm(on) as unknown as El

  const input = all(form).find((n) => n.tag === 'input' && n.id === 'hire-id')!

  input.value = '../skills/victim'
  input.dispatchEvent({ type: 'input', bubbles: false })
  form.dispatchEvent({ type: 'submit', bubbles: false })

  assert.equal(submitted, 0, 'the form submitted a name it had marked as bad')
})

test('the form shows the path the name becomes, because the name IS the path', async () => {
  // Why the rule is strict at all, on screen. `.claude/agents/${id}.md` is the whole reason a
  // slash is refused, and the form teaches that by showing it while you type.
  const form = hireForm({ onSubmit: () => {}, onCancel: () => {} }) as unknown as El
  const input = all(form).find((n) => n.tag === 'input' && n.id === 'hire-id')!

  input.value = 'auditor'
  input.dispatchEvent({ type: 'input', bubbles: false })
  const shown = all(form).map((n) => n.textContent).join('\n')
  assert.match(shown, /\.claude\/agents\/auditor\.md/, 'the form does not show what file it will write')
})

test('the writer leaves nothing behind for a name it refused', async (t) => {
  // The other end of the same rule. A refusal that had already created a file would be worse
  // than an acceptance.
  const root = await tempDir(t, 'hire-refused-')
  await mkdir(join(root, '.claude', 'agents'), { recursive: true })

  for (const id of ['../skills/victim', 'a/b', '', '.hidden']) {
    await hire(root, { id, description: 'x', tools: null, model: null, prompt: 'x' })
  }

  assert.deepEqual(
    await readdir(join(root, '.claude', 'agents')),
    [],
    'a refused name still created something in the agents directory',
  )
})

/**
 * ## The skill form, which writes a directory rather than a file
 *
 * The pairing above puts the agent form against the writer that acts on it. The skill form
 * beside it had nothing, and its own comment says it is governed by the same rule:
 *
 *     A skill id becomes a directory name, so it is governed by the same rule as an agent id.
 *
 * Same rule, one level worse. An agent id names a file inside `.claude/agents/`; a skill id
 * names a *directory* that a `SKILL.md` is then written into. A name that escapes puts a
 * directory somewhere nobody asked for and a file inside it.
 */

/** Type a skill name, submit, and report what the form let through. */
function skillFormAccepts(id: string): boolean {
  let submitted: SkillDraft | null = null
  const on: FormHandlers<SkillDraft> = { onSubmit: (draft) => (submitted = draft), onCancel: () => {} }
  const form = skillForm(on) as unknown as El

  const input = all(form).find((n) => n.tag === 'input' && n.id === 'skill-id')
  assert.ok(input, 'the skill form has no name field, so this check is blind')
  input.value = id
  input.dispatchEvent({ type: 'input', bubbles: false })

  // The button is `type="submit"` and the handler is on the FORM's submit event, which is how a
  // browser wires it. Clicking it does nothing here, and the control above is what says so — the
  // agent form's first draft made exactly this mistake and reported a form that refused
  // everything as a form that was being driven.
  const submit = all(form).find((n) => n.tag === 'button' && /Put it on the shelf/.test(n.textContent ?? ''))
  assert.ok(submit, 'the skill form has no submit button, so this check is blind')
  form.dispatchEvent({ type: 'submit', bubbles: false })

  return submitted !== null
}

test('the skill form refuses every name that would leave its own directory', () => {
  // The control, first: a form that refuses everything passes the rest of this for the wrong
  // reason, which is exactly what happened to the agent form's first draft.
  assert.equal(
    skillFormAccepts('summarise-a-diff'),
    true,
    'the skill form refused an ordinary name, so it is not being driven',
  )

  const escapes = ['../elsewhere', '..', '/etc/passwd', 'a/b', '.', '', '   ', 'a b']
  const allowed = escapes.filter((id) => skillFormAccepts(id))
  assert.deepEqual(
    allowed,
    [],
    'the skill form accepted these: ' + JSON.stringify(allowed) + '. This id becomes a directory ' +
      'that a SKILL.md is written into, so a name that escapes puts a directory somewhere nobody ' +
      'asked for and a file inside it.',
  )
})

test('the skill form shows the directory the name becomes', () => {
  // The name IS the path here, and the preview is the one place somebody checks themselves.
  const on: FormHandlers<SkillDraft> = { onSubmit: () => {}, onCancel: () => {} }
  const form = skillForm(on) as unknown as El
  const input = all(form).find((n) => n.tag === 'input' && n.id === 'skill-id')
  assert.ok(input)

  const shown = (): string =>
    all(form).map((n) => n.textContent ?? '').find((t) => t.includes('.claude/skills/')) ?? ''

  assert.ok(shown().length > 0, 'the empty form does not show where a skill goes at all')

  input.value = 'summarise-a-diff'
  input.dispatchEvent({ type: 'input', bubbles: false })
  assert.match(
    shown(),
    /\.claude\/skills\/summarise-a-diff\/SKILL\.md/,
    'the preview does not follow the name, so it shows a path that is not the one being written',
  )
})

test('a refused skill name says why while it is being typed', () => {
  const on: FormHandlers<SkillDraft> = { onSubmit: () => {}, onCancel: () => {} }
  const form = skillForm(on) as unknown as El
  const input = all(form).find((n) => n.tag === 'input' && n.id === 'skill-id')
  assert.ok(input)

  input.value = '../elsewhere'
  input.dispatchEvent({ type: 'input', bubbles: false })

  const problem = all(form).find((n) => !n.hidden && /must|cannot|only|invalid|letters/i.test(n.textContent ?? ''))
  assert.ok(
    problem,
    'a name the form will refuse shows nothing while it is being typed, so the refusal arrives ' +
      'only on submit with no explanation of what to change',
  )
})

test('inheriting tools switches the tools field off rather than ignoring it', () => {
  // `tools: null` means the agent inherits everything the parent has, "including the ability to
  // delegate, which is exactly the misconfiguration that breaks the rule that only the manager
  // dispatches". A live tools field beside a checked inherit box invites somebody to type a list
  // that will not be used.
  const on: FormHandlers<HireDraft> = { onSubmit: () => {}, onCancel: () => {} }
  const form = hireForm(on) as unknown as El

  const inherit = all(form).find((n) => n.tag === 'input' && n.id === 'hire-inherit')
  const tools = all(form).find((n) => n.id === 'hire-tools')
  assert.ok(inherit, 'no inherit control on the hire form')
  assert.ok(tools, 'no tools field on the hire form')

  inherit.checked = true
  inherit.dispatchEvent({ type: 'change', bubbles: false })
  assert.equal(tools.disabled, true, 'the tools field stays live beside a checked inherit box')

  inherit.checked = false
  inherit.dispatchEvent({ type: 'change', bubbles: false })
  assert.equal(tools.disabled, false, 'unchecking inherit left the tools field switched off')
})
