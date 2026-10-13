/**
 * The dialogs Electron actually has, and the one it does not.
 *
 * **`window.prompt` is not implemented in Electron.** Chromium's is a text-input dialog Electron
 * provides no native implementation for; the call returns `null`, every time, on every platform.
 *
 * That shipped. `+ new project` closed the switcher, called `window.prompt`, got `null`, and the
 * guard `if (name !== null)` was false — so the button did nothing at all. Nothing in the
 * console, nothing on screen, no failed state to notice. Reproduced by pressing it in the running
 * app: three projects before, three after.
 *
 * It is the worst shape a bug can have in this repository: **a control that is not broken enough
 * to look broken.** Every test passed the whole time, because every test was of the layer under
 * it — `createProject` works, and did throughout.
 *
 * ## Why this is a source check rather than a behaviour one
 *
 * There is nothing to observe. A renderer under `node:test` has no `window.prompt` either, so a
 * fake one would answer however the fake was written and prove nothing about Electron. The only
 * checkable fact is that no view reaches for it — and that is worth checking, because it reads
 * like ordinary web code and the failure is silent.
 *
 * ## `confirm` is fine, and that was checked rather than assumed
 *
 * When `prompt` turned out to be missing, the two `window.confirm` calls left in `app.ts` became
 * a fair question rather than a safe assumption — and two view files say `confirm` "does not
 * exist usefully in a sandboxed renderer", which reads like the same problem.
 *
 * It is not. Driven in the running app, deleting a throwaway project: the native dialog appears
 * with the full path and the file count, `OK` returns true, the project goes to the Trash, and
 * the app says so. `confirm` works end to end.
 *
 * What those view comments object to is a *modal a screen reader does not announce* — a
 * judgement about quality, which is why the roster's Fire and the privacy panel's Delete are
 * two-click armed controls instead. That is a different argument from "the platform does not
 * have it", and conflating the two would have had somebody replace two working dialogs while
 * looking for a bug that was only ever in the third.
 *
 * So `alert` and `confirm` are not banned here, and this file says why in case the next person
 * reads the view comments and reaches for the wrong conclusion.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

async function sources(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(join(repo, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await sources(path)))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

/** Code with comments blanked in place, so line numbers still point at the right lines. */
async function code(file: string): Promise<string> {
  const raw = await readFile(join(repo, file), 'utf8')
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')
  return raw.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<!:)\/\/[^\n]*/g, blank)
}

test('nothing calls window.prompt, because Electron does not have it', async () => {
  const files = await sources('src')

  // The control, inside the test: a scanner that walks nothing reports a tree with no prompts in
  // it, which reads exactly like a tree that never calls one.
  assert.ok(files.length > 50, `the scanner walked ${files.length} files, so it is broken`)
  const anyWindow = (await Promise.all(files.map(code))).filter((c) => /\bwindow\./.test(c))
  assert.ok(anyWindow.length > 0, 'the scanner cannot see `window.` anywhere, so it is not reading source')

  const offenders: string[] = []
  for (const file of files) {
    const text = await code(file)
    for (const [index, line] of text.split('\n').entries()) {
      if (/\bwindow\.prompt\s*\(|(?<![.\w])prompt\s*\(/.test(line)) offenders.push(`${file}:${index + 1}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'window.prompt returns null in Electron, always — a control that calls it does nothing, ' +
      'silently, and looks fine. Collect the text in the app: the switcher\'s new-project row is ' +
      'the shape to copy.\n  ' + offenders.join('\n  '),
  )
})

test('the switcher collects a project name itself, and hands it over', async () => {
  // The replacement, pinned where it is easy to undo. A future tidy-up that puts the naming back
  // behind a dialog would be the same bug again, and this is the sentence it would fail.
  const switcher = await readFile(join(repo, 'src/renderer/views/switcher.ts'), 'utf8')

  assert.match(switcher, /input/, 'the switcher no longer builds a field to name a project in')
  assert.match(switcher, /on\.onNewProject\(name\)/, 'the name is not being handed to the handler')

  const app = await readFile(join(repo, 'src/renderer/app.ts'), 'utf8')
  assert.match(app, /onNewProject:\s*\(name\)/, 'the app is not taking a name from the switcher')
})
