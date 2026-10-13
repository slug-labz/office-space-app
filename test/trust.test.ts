/**
 * Workspace trust.
 *
 * An untrusted workspace has its `permissions.allow` ignored entirely, so the office can write
 * files and is refused when it tries to run anything — including the commands its own tasks are
 * verified with. The office cannot fix that and must not try; the trust prompt is the control
 * standing between a cloned repo and somebody's shell. All it can do is say so.
 *
 * Which makes the three states the whole point. "Could not read the file" must never come out
 * as "untrusted": warning somebody about their machine on the strength of a failed read is the
 * office inventing a fact, and it is the same failure as an empty floor standing in for an
 * unreadable directory.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { untrustedMessage, workspaceTrust } from '../src/main/trust.js'

import { tempDir } from './temp-dir.js'

const ROOT = '/work/office'

async function home(t: TestContext, config?: unknown): Promise<string> {
  const dir = await tempDir(t, 'office-trust-')
  if (config !== undefined) await writeFile(join(dir, '.claude.json'), JSON.stringify(config))
  return dir
}

test('a trusted workspace is trusted', async (t) => {
  const dir = await home(t, { projects: { [ROOT]: { hasTrustDialogAccepted: true } } })

  assert.deepEqual(await workspaceTrust(ROOT, dir), { state: 'trusted' })
})

test('a workspace recorded as not accepted is untrusted', async (t) => {
  const dir = await home(t, { projects: { [ROOT]: { hasTrustDialogAccepted: false } } })

  assert.equal((await workspaceTrust(ROOT, dir)).state, 'untrusted')
})

test('an entry with no trust field at all is untrusted', async (t) => {
  const dir = await home(t, { projects: { [ROOT]: {} } })

  assert.equal((await workspaceTrust(ROOT, dir)).state, 'untrusted')
})

test('no config file is unknown — NOT untrusted', async (t) => {
  const dir = await home(t)

  const trust = await workspaceTrust(ROOT, dir)

  assert.equal(trust.state, 'unknown', 'a failed read is not evidence about somebody\'s machine')
})

test('unparseable config is unknown, and says why', async (t) => {
  const dir = await tempDir(t, 'office-trust-')
  await writeFile(join(dir, '.claude.json'), '{ not json')

  const trust = await workspaceTrust(ROOT, dir)

  assert.equal(trust.state, 'unknown')
  assert.match(trust.state === 'unknown' ? trust.cause : '', /not readable JSON/)
})

test('a workspace Claude Code has never been run in is unknown, not untrusted', async (t) => {
  // The prompt has not been answered "no" — it has not been asked. Warning here would be
  // telling somebody off for a decision they were never offered.
  const dir = await home(t, { projects: { '/somewhere/else': { hasTrustDialogAccepted: true } } })

  const trust = await workspaceTrust(ROOT, dir)

  assert.equal(trust.state, 'unknown')
  assert.match(trust.state === 'unknown' ? trust.cause : '', /not been run in this workspace/)
})

test('a config with no projects at all is unknown', async (t) => {
  const dir = await home(t, { someOtherKey: true })

  assert.equal((await workspaceTrust(ROOT, dir)).state, 'unknown')
})

test('the warning names the fix, and names it as the user\'s to do', () => {
  const message = untrustedMessage(ROOT, 27)

  assert.match(message, /27 permission rules are being ignored/)
  assert.match(message, /Run `claude` once in \/work\/office/)
})

/**
 * This test replaces one that asserted the opposite, and the old one was wrong.
 *
 * It required the message to say the office would be "refused when it tries to run anything".
 * Measured against the installed CLI, that does not happen: `claude` prints "Ignoring 27
 * permissions.allow entries … this workspace has not been trusted" and then runs the tool,
 * returning `is_error: false` with an empty `permission_denials`. Under `--print`, an untrusted
 * workspace is *more* permissive, not less — the list simply stops being consulted.
 *
 * A test can pin a false claim as easily as a true one, and this one did, for as long as the
 * claim went unmeasured.
 */
test('the warning does not claim an untrusted workspace is sandboxed', () => {
  const message = untrustedMessage(ROOT, 27)

  // The thing that actually stops is our own checking, not the agent's hands.
  assert.match(message, /the office runs no VERIFY condition on its own/)
  // Not "every VERIFY comes back unchecked": the harness reads an untrusted workspace's deny
  // rules, so a VERIFY one covers comes back refused.
  assert.doesNotMatch(message, /comes back unchecked|no rules in force/)
  assert.match(message, /Agents still run commands/)
  assert.doesNotMatch(message, /refused when it tries to run anything/)
  assert.doesNotMatch(message, /sandbox(ed)?\b(?! an untrusted)/)
})

test('the warning reads properly for a single rule', () => {
  assert.match(untrustedMessage(ROOT, 1), /1 permission rule is being ignored/)
})

/*
 * Two silences, and only one of them is a guess.
 *
 * The file's header is right that *"could not read the file" must never come out as
 * "untrusted"*. It is not right about the other half of `unknown`, and the two were the same
 * value until now.
 *
 * A config that opens cleanly and holds **no record for this directory** is not a failure to
 * know. Claude Code ignores the allowlist until the prompt is answered — the decision is missing,
 * the consequence is certain. `harness.ts` has always treated it that way for running: *"being
 * unable to tell is not permission, and this is the place where the answer runs commands."*
 *
 * So the office refused every VERIFY on a fresh workspace — *"nothing has authorised this"*,
 * about commands `settings.json` plainly permits — and said nothing about why, because the
 * warning fired on `untrusted` alone. That is verbatim the confusion this module exists to
 * prevent, in the case its header calls the one that *"lands hardest on exactly the story this
 * project sells."*
 */
test('never opened and could not be read are different kinds of unknown', async (t) => {
  const neverOpened = await workspaceTrust(ROOT, await home(t, { projects: {} }))
  assert.equal(neverOpened.state, 'unknown')
  assert.equal(neverOpened.state === 'unknown' && neverOpened.why, 'never-opened')

  const noProjectsKey = await workspaceTrust(ROOT, await home(t, { something: 'else' }))
  assert.equal(noProjectsKey.state === 'unknown' && noProjectsKey.why, 'never-opened')

  const unreadable = await workspaceTrust(ROOT, await tempDir(t, 'office-trust-none-'))
  assert.equal(unreadable.state, 'unknown')
  assert.equal(unreadable.state === 'unknown' && unreadable.why, 'unreadable')

  const notJson = await home(t)
  await writeFile(join(notJson, '.claude.json'), 'not json {')
  const broken = await workspaceTrust(ROOT, notJson)
  assert.equal(broken.state === 'unknown' && broken.why, 'unreadable')
})

test('a workspace nobody has been asked about is not accused of refusing', () => {
  const refused = untrustedMessage(ROOT, 27, true)
  const neverAsked = untrustedMessage(ROOT, 27, false)

  assert.match(refused, /^This workspace is not trusted by Claude Code/)
  assert.match(neverAsked, /^Claude Code has never been opened in this workspace/)
  assert.doesNotMatch(neverAsked, /is not trusted by Claude Code/, 'never asked is not answered no')

  // The consequence and the remedy are the same either way, and both must still be said.
  for (const said of [refused, neverAsked]) {
    assert.match(said, /27 permission rules are being ignored/)
    assert.match(said, /Agents still run commands/, 'the correction this message already carries')
    assert.match(said, /accept the trust prompt/)
  }
})
