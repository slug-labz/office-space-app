/**
 * What the shipped `.claude/settings.json` actually permits, run against the real matcher.
 *
 * This policy decides what the office runs **unattended**. Every rule in it was written by
 * reading it, and reading it is how the hole below survived: the deny list refuses `rm`, and the
 * allow list granted `find:*`, and `find . -delete` is a single command with no chain character.
 * `chainsCommands` passes it, `Bash(find:*)` covers it, and it ran with nobody watching in a
 * workspace whose owner had declared deletion off-limits.
 *
 * A list of verbs cannot be audited by reading it, because the danger is not in the verb.
 *
 * ## What the policy language can express, measured against `ruleCovers`
 *
 * Three forms and no others:
 *
 *   `Bash(*)`          everything
 *   `Bash(prefix:*)`   the command, or the command followed by a space
 *   `Bash(pwd)`        exactly that
 *
 * **There is no mid-string wildcard.** `Bash(find:* -delete)` matches nothing at all — it is a
 * deny rule that reads as protection and is inert, which is worse than no rule. Measured, not
 * assumed: adding it to the deny list leaves `find . -delete` `allowed`.
 *
 * So a verb whose danger lives in a *flag* is all-or-nothing here. `find` cannot be allowed for
 * reading and refused for `-delete`; it can only be granted unattended or not.
 *
 * ## The bound this policy actually provides — and it is not what it looks like
 *
 * A first draft of this comment said it *"bounds verbs, not paths"*, on the grounds that
 * `judge(command: string, policy)` takes a string and two arrays of strings and never sees a
 * path. That part is true and it is still worth knowing: no rule written here can say where
 * anything may write. Any real path bound has to come from Claude Code's own `Write(…)`/`Edit(…)`
 * rules, which this policy does not use, or from confining the child process.
 *
 * But "bounds verbs" was too generous, and the measurement is one line:
 *
 *     $ npx tsx -e "console.log('EXECUTED:', 2+2, typeof require('fs').rmSync)"
 *     EXECUTED: 4 function
 *
 * `tsx` takes an eval flag, so no file is needed — and `Bash(npx tsx:*)` is on the allow list.
 * `npx tsx -e "require('fs').rmSync(…)"` has no chain character, no redirect and no
 * substitution, so `chainsCommands` never sees it, and it is `allowed`. The deny list refuses
 * `node -e`, `node --eval`, `python3 -c`, `eval`, `sh`, `bash` and `zsh` — seven spellings of
 * exactly this capability, and an eighth is granted.
 *
 * So the honest sentence, which the test below pins:
 *
 * > **This policy does not bound capability.** One deliberately-allowed verb is a
 * > general-purpose interpreter with an eval flag, and several others (`npm test`, `npm start`,
 * > `npm run dev`) execute whatever `package.json` says. What it bounds is **legibility and
 * > accident** — which spellings the office reaches for on its own, and what a person can see in
 * > a transcript.
 *
 * Those grants are deliberate: the office verifies its own work by running them, and a workspace
 * that cannot install a dependency or run its own tests is not a developer workspace. Removing
 * them is not on the table here.
 *
 * ## What removing `find` is worth, on that framing
 *
 * Not a closed hole. `find . -delete` reads as a search and destroys; `npx tsx -e "…rmSync…"`
 * reads as exactly what it is. If this policy's real function is legibility, then removing an
 * entry whose innocuous name conceals a destructive flag is an improvement *to that function* —
 * a real one, and a smaller claim than the one this file first made.
 *
 * `find:*` also had **no consumer**. Nothing in `.claude/`, the skills, the commands or the
 * shipped `TASKS.md` template invokes it, and every shipped agent already carries `Glob` and
 * `Grep`, which are path-scoped and do what it was granted for. It was allowed speculatively,
 * presumably because it looks read-only — which is the whole finding in one line.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { chainsCommands, judge, readPolicy, type Policy } from '../src/main/permissions.js'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

let cached: Policy | null = null
async function shipped(): Promise<Policy> {
  if (!cached) cached = (await readPolicy(repo)).policy
  return cached
}

test('the shipped policy loads, so everything below is about the policy', async () => {
  // The control, and it is the test rather than a preamble to it. A `readPolicy` that quietly
  // returned nothing would make every command below `unlisted`, which reads exactly like a
  // strict gate — the same shape as a grep going blind and reporting no matches.
  const policy = await shipped()
  assert.ok(policy.allow.length > 50, `${policy.allow.length} allow rules — this is not the shipped policy`)
  assert.ok(policy.deny.length > 10, `${policy.deny.length} deny rules — this is not the shipped policy`)
  assert.equal(judge('npm test', policy).state, 'allowed', 'the office cannot run its own tests')
  assert.equal(judge('rm -rf /Users/somebody/work', policy).state, 'denied', 'rm is not being refused')
})

test('nothing the office may run unattended deletes a file', async () => {
  // `find . -delete` was `allowed`, via `Bash(find:*)`, in a workspace where `Bash(rm:*)` is
  // denied. One command, no chain character, nothing for the chain guard to catch.
  const policy = await shipped()

  for (const command of [
    'find . -delete',
    'find . -name "*.ts" -delete',
    'find / -delete',
    'rm -rf ./dist',
    'dd if=/dev/zero of=/dev/disk0',
    'mkfs.ext4 /dev/disk0',
  ]) {
    assert.notEqual(
      judge(command, policy).state,
      'allowed',
      `\`${command}\` runs unattended. The deny list refuses deletion under another name, so ` +
        `some allow rule is granting it back.`,
    )
  }
})

test('a rule cannot be narrowed by a flag, so a rule that tries is inert', async () => {
  // Why the fix removes the grant rather than adding a narrower denial. Anybody reaching for
  // `Bash(find:* -delete)` should find out here that it matches nothing, rather than in six
  // months when something is deleted.
  const policy = await shipped()
  const narrowed: Policy = { allow: [...policy.allow, 'Bash(find:*)'], deny: [...policy.deny, 'Bash(find:* -delete)'] }

  assert.equal(
    judge('find . -delete', narrowed).state,
    'allowed',
    'a mid-string wildcard now matches — the policy language grew, and this file should say so',
  )
})

test('find still runs when a person asks for it, rather than never', async () => {
  // `unlisted`, not `denied`, and the difference is load-bearing: the harness will not run an
  // unlisted command on its own, and *will* run one somebody clicked having read it. Denying
  // `find` outright would take away a tool nobody has a reason to refuse — the failure is the
  // unattended grant, not the command.
  const policy = await shipped()
  assert.equal(judge('find . -name "*.ts"', policy).state, 'unlisted')
  assert.equal(judge('find . -delete', policy).state, 'unlisted')
})

/**
 * What is still granted, asserted so that this file cannot be read as more than it is.
 *
 * Removing `find` closed one contradiction: the deny list refuses `rm`, and an allow rule was
 * granting deletion back under another name. It did **not** make destruction require a person,
 * and a file full of green assertions about what cannot run would imply otherwise.
 *
 * These are the general-purpose grants that remain. Every one is a deliberate decision by this
 * workspace, and `npm install:*` is the sharpest of them: installing a package runs that
 * package's install scripts, so it is unattended arbitrary code execution fetched from the
 * network — strictly more capability than `find . -delete` ever was.
 *
 * They stay because the office verifies its own work by running them and a developer workspace
 * that cannot install a dependency is not one. That is a trade somebody made, and the reason it
 * is written as a passing test rather than a comment is that a comment saying "we know" is
 * indistinguishable from a comment nobody has re-read.
 *
 * If the trade is ever revisited, this test fails and points at the entry — which is the whole
 * of what a policy file can offer, given that `judge` cannot see a path.
 */
test('the general-purpose grants are still granted, and that is the trade', async () => {
  const policy = await shipped()

  for (const [command, why] of [
    ['npm install some-package', "runs the package's install scripts — arbitrary code, from the network"],
    ['npx tsx /tmp/anything.ts', 'executes an arbitrary TypeScript file'],
    ['npm run dev', 'runs whatever package.json says it runs'],
    ['cat /Users/somebody/.ssh/id_rsa', 'reads any file on the disk'],
  ] as const) {
    assert.equal(
      judge(command, policy).state,
      'allowed',
      `\`${command}\` is no longer granted (${why}). If that was deliberate, delete this case — ` +
        `it exists to stop this file reading as if destruction required a person.`,
    )
  }
})

test('an allowed verb is a general-purpose interpreter, and that is on purpose', async () => {
  // The hole asserted rather than the absence. This is what stops the file above being read as
  // a description of a sandbox.
  //
  //     $ npx tsx -e "console.log('EXECUTED:', 2+2, typeof require('fs').rmSync)"
  //     EXECUTED: 4 function
  //
  // No file needed, no chain character, nothing for `chainsCommands` to catch. The deny list
  // refuses `node -e`, `node --eval`, `python3 -c`, `eval`, `sh`, `bash`, `zsh` — seven
  // spellings of this capability — and this is an eighth, granted, because the office runs its
  // own tests with it.
  //
  // It fails the day somebody removes the interpreters, which is the day the claim above needs
  // rewriting. Until then it is the truest sentence in this file.
  const policy = await shipped()

  assert.equal(
    judge(`npx tsx -e "require('fs').rmSync('/tmp/x', { recursive: true })"`, policy).state,
    'allowed',
    'the interpreters are gone — rewrite the boundary statement at the top of this file, because ' +
      'it is now understating what the policy achieves rather than overstating it',
  )
  assert.equal(chainsCommands(`npx tsx -e "require('fs').rmSync('/tmp/x')"`), false, 'the chain guard now catches this')
})
