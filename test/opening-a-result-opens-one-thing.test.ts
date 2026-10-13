/**
 * Pressing a search result must land in **one** conversation.
 *
 * `app.ts` is never imported by a test — it needs a real Electron document — so this reads the
 * source, the way `the-badge-and-the-panel-agree.test.ts` and `repo-health.test.ts` do. What the
 * driven run proves and a source scan cannot is that it works; what a source scan catches and the
 * driven run will not is somebody quietly restoring the shape that was wrong.
 *
 * ## The shape that was wrong
 *
 * `switchTo(project)` opens a conversation on its way past — the last one seen in that project, or
 * `openCurrent`, whose `null` argument means *start a new one*. So this:
 *
 *     await switchTo(hit.goto.project)
 *     await openSession(hit.goto.sessionId)
 *
 * opened two conversations per click, and against a project with nothing to go back to the first
 * was a **stray empty conversation created in passing**. Search results are precisely the caller
 * that names its own destination, so the destination is passed in and nothing else is opened.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = await readFile(join(repo, 'src/renderer/app.ts'), 'utf8')

/**
 * Comments blanked in place, newlines kept.
 *
 * Same reason the two files above give: commenting a call out is exactly how this regresses, and a
 * scan of the raw source would find the text still sitting in the comment and pass.
 */
const code = app
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(?<!:)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))

/** The body of `openHit`, or `null` if it has been renamed out from under this file. */
function openHitBody(): string | null {
  const at = code.indexOf('async function openHit(')
  if (at === -1) return null
  const from = code.indexOf('{', at)
  let depth = 0
  for (let i = from; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return code.slice(from, i + 1)
  }
  return null
}

test('the scan found what it guards, or everything below is about nothing', () => {
  assert.match(code, /async function openHit\(/, 'openHit has been renamed — this file is blind')
  assert.match(code, /async function switchTo\(project: string, session\?: string\)/, 'switchTo no longer takes a conversation')
  assert.ok((openHitBody() ?? '').length > 100, 'openHit body could not be read')
})

test('a conversation result opens one conversation, not two', () => {
  const body = openHitBody() ?? ''
  assert.match(
    body,
    /switchTo\(hit\.goto\.project, hit\.goto\.sessionId\)/,
    'the conversation destination no longer names its conversation to switchTo',
  )
  assert.doesNotMatch(
    body,
    /\bopenSession\(/,
    'openHit calls openSession directly again. switchTo already opens one on its way past, so ' +
      'this opens two conversations per press — and creates a stray empty one whenever the ' +
      'destination project has none to go back to.',
  )
})

test('switchTo opens the named conversation instead of the project default, not as well as it', () => {
  const at = code.indexOf('async function switchTo(')
  assert.ok(at > 0, 'switchTo has been renamed')
  const body = code.slice(at, code.indexOf('\n}', at))

  // The early return is the whole of it: without it the named conversation is opened and then the
  // project's own default is opened on top, which is the two-conversation bug with extra steps.
  const named = body.indexOf('await openSession(session)')
  const fallback = body.indexOf('lastSession.get(project)')
  assert.ok(named > 0, 'switchTo no longer opens the conversation it was given')
  assert.ok(fallback > named, 'the project default is chosen before the conversation the caller named')
  assert.match(
    body.slice(named, fallback),
    /\breturn\b/,
    'nothing returns between opening the named conversation and falling back to the project ' +
      "default, so both run and the caller's conversation is opened alongside another one",
  )
})
