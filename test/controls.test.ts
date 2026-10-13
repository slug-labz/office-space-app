/**
 * The dials on the conversation.
 *
 * Worth testing because every failure here surfaces three layers away and disguised. A bad flag
 * value does not fail in this module — it fails as a `claude` process that exits immediately
 * with a message about an unrecognised choice, which the office reports as "the manager could
 * not be reached". The whole point of the module is to catch that here instead.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runClaude } from '../src/main/claude/run.js'
import { fakeClaude, init, result } from './fake-claude.js'
import {
  argsFor,
  DEFAULT_CONTROLS,
  describe,
  EFFORTS,
  isDefault,
  isEffort,
  isModel,
  isPermissionMode,
  IGNORED_UNDER_PRINT,
  isIgnoredUnderPrint,
  MODELS,
  OFFERED_PERMISSION_MODES,
  PERMISSION_MODES,
  readControls,
  type Controls,
} from '../src/shared/controls.js'

test('every list starts with default, and default means say nothing', () => {
  // The office must not pin a choice the user did not make. "default" is the absence of a
  // setting, not the name of one.
  assert.equal(MODELS[0], 'default')
  assert.equal(EFFORTS[0], 'default')
  assert.equal(PERMISSION_MODES[0], 'default')
  assert.deepEqual(argsFor(DEFAULT_CONTROLS), [])
  assert.ok(isDefault(DEFAULT_CONTROLS))
})

test('the effort levels are exactly the ones the CLI accepts', () => {
  // Read off `claude --help` rather than remembered. A value that is not in this list is a
  // process that dies on startup.
  assert.deepEqual([...EFFORTS].slice(1), ['low', 'medium', 'high', 'xhigh', 'max'])
})

test('the permission modes are exactly the ones the CLI accepts', () => {
  assert.deepEqual(
    [...PERMISSION_MODES].slice(1).sort(),
    ['acceptEdits', 'auto', 'bypassPermissions', 'dontAsk', 'manual', 'plan'],
  )
})

test('plan mode is offered, because it was the one the office could not reach', () => {
  assert.ok(isPermissionMode('plan'))
  assert.deepEqual(argsFor({ ...DEFAULT_CONTROLS, permissionMode: 'plan' }), [
    '--permission-mode',
    'plan',
  ])
})

test('each control becomes its own flag, and only when set', () => {
  assert.deepEqual(argsFor({ model: 'opus', effort: 'default', permissionMode: 'default' }), [
    '--model',
    'opus',
  ])
  assert.deepEqual(argsFor({ model: 'default', effort: 'max', permissionMode: 'default' }), [
    '--effort',
    'max',
  ])
  assert.deepEqual(argsFor({ model: 'sonnet', effort: 'high', permissionMode: 'acceptEdits' }), [
    '--model',
    'sonnet',
    '--effort',
    'high',
    '--permission-mode',
    'acceptEdits',
  ])
})

test('"default" is never passed as a value', () => {
  // The specific bug this guards: emitting `--model default`, which the CLI rejects as an
  // unrecognised choice and which would look to the user like the office being broken.
  for (const model of MODELS) {
    for (const effort of EFFORTS) {
      for (const permissionMode of PERMISSION_MODES) {
        const args = argsFor({ model, effort, permissionMode })
        assert.ok(!args.includes('default'), `emitted a literal "default" for ${model}/${effort}/${permissionMode}`)
        assert.ok(!args.includes(''), 'emitted an empty argument')
      }
    }
  }
})

test('every offered value survives its own type guard', () => {
  for (const m of MODELS) assert.ok(isModel(m))
  for (const e of EFFORTS) assert.ok(isEffort(e))
  for (const p of PERMISSION_MODES) assert.ok(isPermissionMode(p))
})

test('guards reject what the CLI would reject', () => {
  for (const bad of ['', 'Opus', 'gpt-4', null, undefined, 42, {}]) {
    assert.equal(isModel(bad), false, `accepted ${String(bad)} as a model`)
  }
  assert.equal(isEffort('ultra'), false)
  assert.equal(isPermissionMode('yolo'), false)
  // Case matters to the CLI, so it matters here.
  assert.equal(isPermissionMode('acceptedits'), false)
})

test('reading junk gives usable controls rather than throwing', () => {
  for (const junk of [null, undefined, 'nonsense', 42, [], {}]) {
    assert.deepEqual(readControls(junk).controls, DEFAULT_CONTROLS)
  }
})

test('one bad field does not discard the other two', () => {
  // Losing a whole conversation's settings because one of three strings was unrecognised is a
  // worse failure than running one of them at default.
  const { controls, unknown } = readControls({
    model: 'opus',
    effort: 'ultra',
    permissionMode: 'plan',
  })
  assert.equal(controls.model, 'opus')
  assert.equal(controls.effort, 'default')
  assert.equal(controls.permissionMode, 'plan')
  assert.deepEqual(unknown, ['effort=ultra'])
})

test('what was dropped is reported, not swallowed', () => {
  // The fourth standing order applied to settings: a user who wrote something the office
  // ignored should be told, not left wondering why nothing changed.
  const { unknown } = readControls({ model: 'gpt-4', effort: 'turbo', permissionMode: 'yolo' })
  assert.deepEqual(unknown, ['model=gpt-4', 'effort=turbo', 'permissionMode=yolo'])
})

test('a missing field is not a dropped field', () => {
  // Absent is not empty, and it is not wrong either. Nothing to report here.
  assert.deepEqual(readControls({ model: 'opus' }).unknown, [])
  assert.deepEqual(readControls({ model: 'opus', effort: null }).unknown, [])
})

test('describe says what was chosen, and admits when nothing was', () => {
  assert.equal(describe(DEFAULT_CONTROLS), 'workspace default')
  assert.equal(describe({ model: 'opus', effort: 'default', permissionMode: 'default' }), 'opus')
  assert.equal(
    describe({ model: 'opus', effort: 'max', permissionMode: 'plan' }),
    'opus · max effort · plan',
  )
})

test('isDefault is false the moment anything is set', () => {
  const set: Controls[] = [
    { ...DEFAULT_CONTROLS, model: 'sonnet' },
    { ...DEFAULT_CONTROLS, effort: 'low' },
    { ...DEFAULT_CONTROLS, permissionMode: 'plan' },
  ]
  for (const c of set) assert.equal(isDefault(c), false)
})


// ─────────────────────────────────────── the two modes the CLI takes and ignores ──

/**
 * These tests exist because the ones above were not enough, and it is worth being precise about
 * why rather than just adding more.
 *
 * `the permission modes are exactly the ones the CLI accepts` and `every offered value survives
 * its own type guard` both passed while the shipped picker offered two modes that did nothing.
 * They asserted that the CLI would **accept** each string — which it does; it exits zero and
 * says nothing — and never asserted what it **did** with one. Under `--print`, `manual` and
 * `auto` are silently resolved to `default`, because both need a human to answer a prompt and
 * `--print` has nobody to ask.
 *
 * So the rule these hold to is: assert the effect, not the spelling.
 */

test('the ignored modes are exactly the two that need a human to answer', () => {
  // Measured off the `init` event against the installed CLI, not remembered. If a future CLI
  // honours one of these under --print, this list is where that gets corrected.
  assert.deepEqual([...IGNORED_UNDER_PRINT], ['manual', 'auto'])
  for (const mode of IGNORED_UNDER_PRINT) {
    assert.ok(isPermissionMode(mode), 'an ignored mode is still a real mode — it is not a typo')
  }
})

test('the picker offers only modes that do something', () => {
  assert.ok(!OFFERED_PERMISSION_MODES.includes('manual'))
  assert.ok(!OFFERED_PERMISSION_MODES.includes('auto'))
  assert.deepEqual([...OFFERED_PERMISSION_MODES], ['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions'])
  // The full set stays the truth about the CLI — a settings file may legitimately name any of
  // them, and reading one is not the same as offering it.
  assert.ok(PERMISSION_MODES.includes('manual'))
})

test('argsFor never asks for a mode the CLI would ignore', () => {
  // The guarantee that closes the fault: whatever a caller constructs by hand, an inert mode
  // cannot reach the command line and cannot become a picker showing a mode we are not in.
  for (const mode of PERMISSION_MODES) {
    const args = argsFor({ ...DEFAULT_CONTROLS, permissionMode: mode })
    if (isIgnoredUnderPrint(mode)) {
      assert.deepEqual(args, [], `emitted a flag for ${mode}, which --print silently drops`)
    } else if (mode !== 'default') {
      assert.deepEqual(args, ['--permission-mode', mode])
    }
  }
})

test('an ignored mode read off disk is reset, and reported as understood rather than unknown', () => {
  const read = readControls({ permissionMode: 'manual' })
  // Reset, because carrying it would put "manual" in the picker while the session runs default.
  assert.equal(read.controls.permissionMode, 'default')
  // Reported — and in `ignored`, not `unknown`. Telling someone the CLI does not recognise
  // `manual` would be a second false statement covering the first.
  assert.deepEqual(read.ignored, ['permissionMode=manual'])
  assert.deepEqual(read.unknown, [])
})

test('a mode that works is left alone', () => {
  const read = readControls({ permissionMode: 'plan' })
  assert.equal(read.controls.permissionMode, 'plan')
  assert.deepEqual(read.ignored, [])
})

test('unrecognised and ignored are reported separately', () => {
  const read = readControls({ model: 'gpt-4', permissionMode: 'auto' })
  assert.deepEqual(read.unknown, ['model=gpt-4'])
  assert.deepEqual(read.ignored, ['permissionMode=auto'])
})

test('the spawned process is never given an ignored mode', async (t) => {
  // The end-to-end version, against a real child process that records its argv. Everything above
  // tests the mapping; this tests what actually reaches the binary, which is the only thing the
  // CLI can act on.
  const fake = await fakeClaude(t, { lines: [init('s-1'), result(false)] })

  const run = runClaude(
    {
      cwd: fake.dir,
      prompt: 'hello',
      claudePath: fake.path,
      controls: { model: 'default', effort: 'default', permissionMode: 'manual' },
    },
    () => {},
  )
  await run.done

  const argv = await fake.argv()
  assert.ok(!argv.includes('--permission-mode'), 'asked for a mode the CLI accepts and ignores')
  assert.ok(!argv.includes('manual'))
})

test('a mode that works does reach the process', async (t) => {
  const fake = await fakeClaude(t, { lines: [init('s-2'), result(false)] })
  const run = runClaude(
    {
      cwd: fake.dir,
      prompt: 'hello',
      claudePath: fake.path,
      controls: { model: 'default', effort: 'default', permissionMode: 'plan' },
    },
    () => {},
  )
  await run.done

  const argv = await fake.argv()
  assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'plan')
})
