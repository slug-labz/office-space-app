/**
 * One answer the office could not write must not take the rest of its batch down with it.
 *
 * When `watchApprovals` reports a batch of held calls, main reads the policy, writes a verdict
 * for every call the rules answer, and sends the rest to the renderer as cards. The write is
 * `decide`, and `decide` can throw — a full disk, a directory it may not write to, an id it
 * refuses. When one did, the whole batch went with it: the promise rejected with nobody
 * listening, the cards for the calls a person still had to answer were never sent, and the
 * watcher, which only pushes when the set of held calls changes, had nothing new to push. Those
 * calls sat off the strip and off the campus until the gate refused them, four minutes on.
 *
 * The call whose write failed was worse off still. Its key was already in `Decided`, so no later
 * batch tried it again: a call the rules allowed was refused by the gate's clock, with nothing on
 * screen having said why.
 *
 * Found by reading, not in the app. `main.ts` cannot be loaded by a test, so the loop now lives in
 * `answerFromPolicy` with its effects handed in, and these tests drive that. The last one checks
 * that `main.ts` still goes through it.
 *
 * ## What the report says, and for how long
 *
 * The first version of the report was reviewed and failed on it, and the tests below the core ones
 * are that review's findings. The report outlived its call: it was replaced only by a batch that
 * wrote something, so a call that left kept a sentence saying it was still held. It credited
 * "this workspace's rules" with answers the permission mode gave. And four real failures of one
 * kind made four causes, each carrying two temporary paths.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import {
  Decided,
  answerFromPolicy,
  decide,
  unwrittenDetail,
  unwrittenProblem,
  type ApprovalRequest,
  type Unwritten,
} from '../src/main/approvals.js'
import { readPolicy, type PolicyRead } from '../src/main/permissions.js'
import type { PermissionMode } from '../src/shared/controls.js'
import { tempDir } from './temp-dir.js'

const call = (toolUseId: string, command: string): ApprovalRequest => ({
  sessionId: 's-1',
  toolUseId,
  tool: 'Bash',
  input: { command },
  cwd: '/w',
  askedAt: '2026-09-16T10:00:00.000Z',
  waitMs: 240_000,
  agent: null,
  agentId: null,
})

/** Rules read whole: `npm test` is allowed, `rm` is refused, and anything else is a question. */
const READ: PolicyRead = {
  policy: { allow: ['Bash(npm test:*)'], deny: ['Bash(rm:*)'] },
  sources: [],
  incomplete: false,
}

/** A full disk, raised the way Node raises it: a message, an errno and the call that failed. */
const noSpace = (): NodeJS.ErrnoException =>
  Object.assign(new Error('ENOSPC: no space left on device, write'), {
    code: 'ENOSPC',
    syscall: 'write',
  })

/** What the report calls that failure. */
const NO_SPACE = 'ENOSPC on write'

/** An office whose verdict writes fail for the tool-use ids in `failing`, and which keeps count. */
function office(failing: Set<string> = new Set(), mode: PermissionMode = 'default') {
  const written: string[] = []
  const attempts: string[] = []
  const reasons: (string | undefined)[] = []
  const reports: (readonly Unwritten[])[] = []
  const answered = new Decided()
  const effects = {
    policy: async () => READ,
    modeOf: () => mode,
    answered,
    write: async (request: ApprovalRequest, allow: boolean, reason: string | undefined) => {
      attempts.push(request.toolUseId)
      reasons.push(reason)
      if (failing.has(request.toolUseId)) throw noSpace()
      written.push(`${request.toolUseId}:${allow ? 'allow' : 'refuse'}`)
    },
    wrote: (unwritten: readonly Unwritten[]) => {
      reports.push(unwritten)
    },
  }
  return { effects, written, attempts, reasons, reports, answered }
}

const ids = (requests: readonly ApprovalRequest[]) => requests.map((r) => r.toolUseId)
const reported = (unwritten: readonly Unwritten[] | undefined) =>
  unwritten?.map((u) => u.request.toolUseId)

/** What a rejected batch means, said as the failure it is. */
const lost = (err: unknown): never =>
  assert.fail(`the whole batch was lost with one write: ${String(err)}`)

/** Let every batch in flight run until it is waiting on something the test holds. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('a verdict that will not write does not keep the calls beside it off the strip', async () => {
  const o = office(new Set(['allowed']))

  const ask = await answerFromPolicy(
    [call('allowed', 'npm test'), call('held', 'curl example.com')],
    o.effects,
  ).catch(lost)

  assert.deepEqual(ids(ask), ['held'], 'a call waiting on a person was not sent to the strip')
})

test('the calls after it in the batch are still answered', async () => {
  const o = office(new Set(['first']))

  await answerFromPolicy(
    [
      call('first', 'npm test'),
      call('second', 'npm test -- one.test.ts'),
      call('third', 'rm -rf dist'),
    ],
    o.effects,
  ).catch(lost)

  assert.deepEqual(o.written, ['second:allow', 'third:refuse'])
})

test('a failure is reported while its call is held, and not once the call has gone', async () => {
  const failing = new Set(['allowed'])
  const o = office(failing)
  const held = call('held', 'curl example.com')

  await answerFromPolicy([call('allowed', 'npm test'), held], o.effects).catch(lost)
  assert.deepEqual(reported(o.reports.at(-1)), ['allowed'], 'a failed write was not reported')
  const first = o.reports.at(-1)

  // Still held, so tried again, and still failing: still reported.
  await answerFromPolicy([call('allowed', 'npm test'), held], o.effects).catch(lost)
  assert.deepEqual(reported(o.reports.at(-1)), ['allowed'])

  // The call has gone, refused by the gate or handed back. A batch with nothing to write says so,
  // or the panel goes on saying a call is held that is not.
  await answerFromPolicy([held], o.effects).catch(lost)
  assert.deepEqual(o.reports.at(-1), [], 'the report outlived the call it describes')

  assert.deepEqual(
    first?.map((u) => [u.allow, u.rule, u.cause, u.code]),
    [[true, 'Bash(npm test:*)', NO_SPACE, 'ENOSPC']],
    'the failure was not reported with what answered it and why the write failed',
  )

  // And a write that lands has nothing to report either.
  failing.clear()
  await answerFromPolicy([call('later', 'npm test -- two.test.ts')], o.effects)
  assert.deepEqual(o.reports.at(-1), [])
})

test('a verdict that will not write is tried again by the next batch', async () => {
  const failing = new Set(['allowed'])
  const o = office(failing)

  // Caught, so this test measures the retry on its own even where the batch itself is lost.
  await answerFromPolicy([call('allowed', 'npm test')], o.effects).catch(() => {})

  failing.delete('allowed')
  const next = [call('allowed', 'npm test'), call('arrived', 'curl example.com')]
  await answerFromPolicy(next, o.effects)

  assert.deepEqual(
    o.written,
    ['allowed:allow'],
    'the call whose write failed was never tried again, so the gate refuses what the rules allowed',
  )
  assert.deepEqual(o.reports.at(-1), [], 'a write that landed on the retry is still reported')
})

test('an answer that did not land stays unanswered, and so the gate refuses it', async () => {
  // Nothing stands in for the missing verdict. The call is not offered to a person — a refusal
  // is not a question anybody is invited to answer, and an allow was never one — and no other
  // verdict is written for it. The gate refuses whatever nobody answers, and that has to hold.
  const o = office(new Set(['allowed', 'refused']))

  const ask = await answerFromPolicy(
    [call('allowed', 'npm test'), call('refused', 'rm -rf dist')],
    o.effects,
  ).catch(lost)

  assert.deepEqual(ids(ask), [], 'a call the rules answered was handed to a person instead')
  assert.deepEqual(o.written, [], 'something was written for a verdict that failed')
  assert.deepEqual(o.attempts, ['allowed', 'refused'], 'each verdict is tried once per batch')
  assert.deepEqual(o.reports[0]?.map((u) => u.allow), [true, false])
})

test('a batch that skipped a call being written elsewhere keeps its failure', async () => {
  // Two batches overlap. The first is writing `a`; the second skips `a`, because `Decided` says it
  // is taken, and writes `b`. If the first fails and the second finishes last, the second's report
  // must still carry `a`: it skipped the call, it did not answer it.
  const answered = new Decided()
  const reports: (readonly Unwritten[])[] = []
  const writes = new Map<string, { finish: (err?: unknown) => void }>()
  const order: string[] = []
  const effects = {
    policy: async () => READ,
    modeOf: () => 'default' as const,
    answered,
    write: (request: ApprovalRequest) =>
      new Promise<void>((resolve, reject) => {
        order.push(request.toolUseId)
        const finish = (err?: unknown) => (err === undefined ? resolve() : reject(err))
        writes.set(request.toolUseId, { finish })
      }),
    wrote: (unwritten: readonly Unwritten[]) => {
      reports.push(unwritten)
    },
  }

  const first = answerFromPolicy([call('a', 'npm test')], effects)
  await settle()
  const both = [call('a', 'npm test'), call('b', 'npm test -- one.test.ts')]
  const second = answerFromPolicy(both, effects)
  await settle()
  assert.deepEqual(order, ['a', 'b'], 'the second batch wrote `a` as well')

  writes.get('a')?.finish(noSpace())
  await first.catch(lost)
  writes.get('b')?.finish()
  await second.catch(lost)

  const last = reported(reports.at(-1))
  assert.deepEqual(last, ['a'], 'the batch that skipped `a` cleared its failure')
})

test('a failed call that becomes a question drops out of the report', async () => {
  // Measured in re-review: a write failed in bypass mode, the dial went back to default, and the
  // call went to the strip as a card while the report still said the office had allowed it and
  // would try again. The office will not. The call is a person's question now. The same happens
  // when the settings stop parsing, which makes every call a question.
  for (const change of ['the mode', 'the settings'] as const) {
    let mode: PermissionMode = 'bypassPermissions'
    let read: PolicyRead = READ
    const reports: (readonly Unwritten[])[] = []
    const effects = {
      policy: async () => read,
      modeOf: () => mode,
      answered: new Decided(),
      write: async () => {
        throw noSpace()
      },
      wrote: (unwritten: readonly Unwritten[]) => {
        reports.push(unwritten)
      },
    }

    await answerFromPolicy([call('curl', 'curl example.com')], effects).catch(lost)
    assert.deepEqual(reported(reports.at(-1)), ['curl'])

    if (change === 'the mode') mode = 'default'
    else read = { ...READ, incomplete: true }
    const both = [call('curl', 'curl example.com'), call('new', 'curl other.example')]
    const ask = await answerFromPolicy(both, effects).catch(lost)

    assert.deepEqual(ids(ask), ['curl', 'new'], `after ${change} changed, the call was not asked`)
    const said = `after ${change} changed, the report still says the office will answer a question`
    assert.deepEqual(reports.at(-1), [], said)
  }
})

test('a verdict that will not write leaves no temporary file behind', async (t) => {
  // Each retry is a fresh write, and a failed rename left its temporary file where it was.
  // Measured in re-review: ten changes, eleven attempts, eleven `.tmp` files.
  const root = await tempDir(t, 'office-unwritten-')
  const dir = join(root, '.office-space', 'approvals')
  await mkdir(join(dir, 's-1.blocked.verdict.json'), { recursive: true })

  for (let attempt = 0; attempt < 3; attempt++) {
    const landed = await decide(root, 's-1', 'blocked', true).then(() => true, () => false)
    assert.equal(landed, false, 'the blocked write landed')
  }

  const left = (await readdir(dir)).filter((name) => name.endsWith('.tmp'))
  assert.deepEqual(left, [], 'failed writes left their temporary files in the approvals directory')
})

test('the problem is set while anything is unwritten, and cleared when nothing is', () => {
  // The decision main makes with the report, here so a test can reach it. Round one of review
  // found that main could stop setting the problem at all and every test stayed green.
  assert.equal(unwrittenProblem([], '/w/approvals'), null)

  const unwritten: Unwritten[] = [
    {
      request: call('a', 'npm test'),
      allow: true,
      rule: 'Bash(npm test:*)',
      cause: NO_SPACE,
      code: 'ENOSPC',
    },
  ]
  const problem = unwrittenProblem(unwritten, '/w/approvals')
  assert.deepEqual(problem, {
    kind: 'lint',
    path: '/w/approvals',
    rule: 'verdicts-unwritten',
    detail: unwrittenDetail(unwritten, '/w/approvals'),
  })
})

test('a real write failure, from the real decide, is caught the same way', async (t) => {
  const root = await tempDir(t, 'office-unwritten-')
  await mkdir(join(root, '.claude'), { recursive: true })
  await writeFile(
    join(root, '.claude', 'settings.json'),
    JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'], deny: [] } }),
  )
  const dir = join(root, '.office-space', 'approvals')
  // A directory where one verdict file goes. `rename` cannot put a file there, and unlike a
  // read-only directory that holds whoever runs the suite.
  await mkdir(join(dir, 's-1.blocked.verdict.json'), { recursive: true })

  const reports: (readonly Unwritten[])[] = []
  const ask = await answerFromPolicy(
    [
      call('blocked', 'npm test'),
      call('fine', 'npm test -- one.test.ts'),
      call('held', 'curl example.com'),
    ],
    {
      policy: () => readPolicy(root),
      modeOf: () => 'default',
      answered: new Decided(),
      write: (request, allow, reason) =>
        decide(root, request.sessionId, request.toolUseId, allow, reason),
      wrote: (unwritten) => {
        reports.push(unwritten)
      },
    },
  ).catch(lost)

  assert.deepEqual(ids(ask), ['held'])
  const fine = await readFile(join(dir, 's-1.fine.verdict.json'), 'utf8')
  assert.deepEqual(JSON.parse(fine), { allow: true }, 'the write after the failed one did not land')
  assert.deepEqual(reported(reports[0]), ['blocked'])
  assert.equal(reports[0]?.[0]?.cause, 'EISDIR on rename')
})

test('the same failure four times is said once, and the sentence stays short', async (t) => {
  // Measured in review on the first version: four real EISDIR failures made four causes, each
  // with two temporary paths in it, and a sentence of 1,639 characters.
  const root = await tempDir(t, 'office-unwritten-')
  await mkdir(join(root, '.claude'), { recursive: true })
  const settings = { permissions: { allow: ['Bash(npm test:*)'] } }
  await writeFile(join(root, '.claude', 'settings.json'), JSON.stringify(settings))
  const dir = join(root, '.office-space', 'approvals')
  const four = ['w', 'x', 'y', 'z']
  for (const id of four) await mkdir(join(dir, `s-1.${id}.verdict.json`), { recursive: true })

  const reports: (readonly Unwritten[])[] = []
  await answerFromPolicy(
    four.map((id) => call(id, `npm test -- ${id}.test.ts`)),
    {
      policy: () => readPolicy(root),
      modeOf: () => 'default',
      answered: new Decided(),
      write: (request, allow, reason) =>
        decide(root, request.sessionId, request.toolUseId, allow, reason),
      wrote: (unwritten) => {
        reports.push(unwritten)
      },
    },
  ).catch(lost)

  const detail = unwrittenDetail(reports[0] ?? [], dir)
  assert.equal(detail.split('EISDIR').length - 1, 1, `the cause was repeated: ${detail}`)
  assert.ok(!detail.includes('.tmp'), 'a temporary path reached the sentence')
  // Measured without the directory, which is as long as this machine's temporary folder makes
  // it: in review, a 120-character TMPDIR failed a limit that counted it. Three names, one
  // cause and the explanation, less the directory, come to 616 characters whether the temporary
  // folder's path is 4 characters long or 48 (measured).
  const said = detail.split(dir).join('')
  const length = `the sentence is ${said.length} characters without ${dir}: ${detail}`
  assert.ok(said.length < 700, length)
})

test('an answer the permission mode gave is not credited to the rules', async () => {
  // Measured in review: in bypass mode the panel said "This workspace's rules answered
  // "curl example.com" (allowed)", and no rule lists curl.
  const o = office(new Set(['curl']), 'bypassPermissions')

  await answerFromPolicy([call('curl', 'curl example.com'), call('tests', 'npm test')], o.effects)
  const detail = unwrittenDetail(o.reports.at(-1) ?? [], '/w/approvals')

  assert.match(detail, /"curl example\.com" \(allowed by the bypass permissions mode\)/)
  assert.doesNotMatch(detail, /rules answered/)
})

test('a refusal the mode gave tells the model the mode, not a rule in settings.json', async () => {
  // The reason reaches the model, which acts on it. A refusal from "don't ask" said it came from
  // "dontAsk in .claude/settings.json", which sends the agent looking for a rule that is not there.
  const o = office(new Set(), 'dontAsk')

  await answerFromPolicy([call('curl', 'curl example.com'), call('rm', 'rm -rf dist')], o.effects)

  const [byMode, byRule] = o.reasons
  assert.match(byMode ?? '', /don't ask/, `the reason reads ${JSON.stringify(byMode)}`)
  assert.doesNotMatch(byMode ?? '', /settings\.json/)
  // A rule can come from either settings file, and the policy does not keep which. Naming only
  // settings.json sent the reader to the wrong file for a rule in settings.local.json.
  const rule =
    "Refused by this workspace's own policy: Bash(rm:*), " +
    'in .claude/settings.json or .claude/settings.local.json.'
  assert.equal(byRule, rule)
})

test('the problem names the call, what answered it, and why the answer did not land', () => {
  const detail = unwrittenDetail(
    [
      {
        request: call('a', 'npm test'),
        allow: true,
        rule: 'Bash(npm test:*)',
        cause: NO_SPACE,
        code: 'ENOSPC',
      },
    ],
    '/w/approvals',
  )

  assert.match(detail, /"npm test" \(allowed by the rule Bash\(npm test:\*\)\)/)
  assert.match(detail, /ENOSPC on write/)
  assert.match(detail, /still held/, 'the problem does not say the call is still waiting')
  assert.match(detail, /refuses it when it stops waiting/, 'it does not say what happens next')
  // Handed back, Claude Code's own check decides, and it can allow what the rules allow. So the
  // call is not approved *by the office*, which is all the sentence may claim.
  assert.match(detail, /is not approved by the office/)
  // And nothing about which rules that check applies. Claude Code also reads the user's own
  // settings and the --disallowedTools the office passes, and the office reads only the
  // workspace's two files, so "the same rules" was not always so (found in review).
  assert.match(detail, /hands it to Claude Code's own permission check\./)
  assert.doesNotMatch(detail, /the same rules/)
  assert.doesNotMatch(detail, /files it as unanswered/, 'the gate files only when it can write')
  assert.match(detail, /\/w\/approvals/, 'the problem does not say where to look')
})

test('a refusal decide makes itself is not blamed on the directory', async (t) => {
  // The real `decide` refuses an id with a slash in it before it touches the disk, in a sentence
  // that ends in a full stop. Nothing is wrong with the directory, so the report must not send
  // anybody there.
  const root = await tempDir(t, 'office-unwritten-')
  const reports: (readonly Unwritten[])[] = []
  await answerFromPolicy([{ ...call('t-1', 'npm test'), sessionId: 'a/b' }], {
    policy: async () => READ,
    modeOf: () => 'default',
    answered: new Decided(),
    write: (request, allow, reason) =>
      decide(root, request.sessionId, request.toolUseId, allow, reason),
    wrote: (unwritten) => {
      reports.push(unwritten)
    },
  }).catch(lost)

  assert.equal(reports[0]?.[0]?.code, null, 'a refusal was taken for a filesystem error')
  const detail = unwrittenDetail(reports[0] ?? [], join(root, '.office-space', 'approvals'))
  assert.match(detail, /cannot contain a slash/)
  assert.ok(!detail.includes('..'), `two full stops in a row: ${detail}`)
  assert.doesNotMatch(detail, /can be written to/, 'a refused id sent the reader to the directory')
})

test('several are counted, a refusal is called one, and a long command is cut', () => {
  const long = `npm test -- ${'x'.repeat(200)}`
  const allowed = { allow: true, rule: 'Bash(npm test:*)', cause: NO_SPACE, code: 'ENOSPC' }
  const detail = unwrittenDetail(
    [
      { ...allowed, request: call('a', long) },
      { ...allowed, request: call('b', 'rm -rf dist'), allow: false, rule: 'Bash(rm:*)' },
      { ...allowed, request: call('c', 'npm test'), cause: 'EACCES on open', code: 'EACCES' },
      { ...allowed, request: call('d', 'npm test -- d.test.ts') },
    ],
    '/w/approvals',
  )

  assert.match(detail, /"rm -rf dist" \(refused by the rule Bash\(rm:\*\)\)/)
  assert.match(detail, /and 1 more/, 'a fourth answer was neither named nor counted')
  assert.doesNotMatch(detail, /d\.test\.ts/, 'a fourth answer was named as well as counted')
  assert.ok(!detail.includes('x'.repeat(100)), 'a long command was printed whole')
  assert.match(detail, /EACCES on open/, 'a second cause was dropped')
  assert.equal(detail.split(NO_SPACE).length - 1, 1, 'the same cause was repeated')
  assert.match(detail, /Those calls are still held/)

  // Causes are capped like names: five different ones are three and a count.
  const five = ['EACCES on open', 'EIO on write', NO_SPACE, 'EROFS on mkdir', 'EISDIR on rename']
  const varied = unwrittenDetail(
    five.map((cause, i) => ({ ...allowed, request: call(`v${i}`, 'npm test'), cause })),
    '/w/approvals',
  )
  assert.match(varied, /ENOSPC on write; and 2 other errors/, `the causes read: ${varied}`)
  assert.doesNotMatch(varied, /EROFS|EISDIR/)

  // One over the cap is one error, not "1 other errors".
  const fourCauses = five.slice(0, 4)
  const four = unwrittenDetail(
    fourCauses.map((cause, i) => ({ ...allowed, request: call(`f${i}`, 'npm test'), cause })),
    '/w/approvals',
  )
  assert.match(four, /ENOSPC on write; and 1 other error\. /, `the causes read: ${four}`)
})

test('main writes verdicts only through answerFromPolicy, and clears the report', async () => {
  /*
   * A source-level check, and it says so: `main.ts` imports electron at module scope, so no test
   * can load it. Everything above drives `answerFromPolicy`, and none of it would notice the loop
   * written back inline in `main.ts` without its catch, which is this bug back.
   *
   * - Every reference to `decide` sits in the handler a person's click arrives on or inside the
   *   `answerFromPolicy(` call. References, not calls: `(0, decide)(…)` is still `decide`, and so
   *   are `approvals.decide(…)` through a namespace import, and any string `'decide'`, as in
   *   `approvals['decide']` or `Reflect.get(approvals, 'decide')`. Only `CHANNEL.decide`, an
   *   object key and the import itself are names, and `decide` may not be imported under
   *   another one.
   * - The batch's list goes out only through `forwardInOrder`, whose first argument is
   *   `(batch) => answerFromPolicy(batch, …)` — an expression body, so what `answerFromPolicy`
   *   resolves to is the list, with no block to drop it in, and the batch it is handed is the one
   *   it was given. That is the only `answerFromPolicy` call. `forwardInOrder` itself, including
   *   that an empty batch is sent at once and never reaches `answerFromPolicy`, is driven in
   *   `approvals.test.ts`.
   * - Its result is bound once, to a `const`, and that is the name the watcher calls.
   * - Each `answerFromPolicy` call's `wrote` hands what it hears to
   *   `setVerdictProblem(unwrittenProblem(…))`, and never reassigns or hides what it heard, so
   *   whether the problem is set is decided in tested code.
   * - The watcher's first branch tests its own parameter for an empty batch and clears the
   *   problem, and nothing in that branch can leave: a `return` there would keep the `[]` from
   *   `forwardInOrder`, and the last card would stay up for a call nothing waits on.
   * - Every batch then reaches that name with the watcher's own parameter: after the empty-batch
   *   branch, the call is a statement of the watcher's body, ahead of anything that can branch or
   *   leave, and the parameter is neither reassigned nor hidden.
   * - Nothing else changes the problem. `setVerdictProblem` is declared once, at the top level,
   *   and otherwise only called, in those two places. Nothing outside it writes
   *   `verdictProblem`: not by assignment, in parentheses or through destructuring, and not as
   *   the target of a `for … of` or `for … in`.
   *
   * A call counts only as a statement of the body itself, ahead of anything that can branch or
   * leave. One under a condition, or after the `return`, is in the source and need not run.
   *
   * Not checked here: `setVerdictProblem` pushing a snapshot, what `forward` sends, and whether
   * the directory `wrote` hands `unwrittenProblem` is the one `decide` writes to. The check reads
   * names and shapes: `decide` reached through another module or by a name built at run time is
   * not followed, and neither is the problem cleared by something `setVerdictProblem` calls, nor
   * a branch hidden inside an expression. Three rounds of review found fourteen shapes that got
   * past earlier versions of this check. Thirteen are now cases it fails on. The fourteenth, a
   * wrong directory, is the one named above.
   *
   * Parsed rather than grepped, so a comment is not code.
   */
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'main.ts')
  const text = await readFile(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)

  /** A body's own statements, up to and including the first that can branch or leave. */
  const leading = (body: ts.Node): readonly ts.Statement[] => {
    const run: ts.Statement[] = []
    if (!ts.isBlock(body)) return run
    for (const statement of body.statements) {
      run.push(statement)
      if (!ts.isExpressionStatement(statement) && !ts.isVariableStatement(statement)) break
    }
    return run
  }
  /** The calls a body makes on every path through it. */
  const calls = (body: ts.Node): readonly ts.CallExpression[] =>
    ts.isCallExpression(body)
      ? [body]
      : leading(body).flatMap((statement) =>
          ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
            ? [statement.expression]
            : [],
        )
  /** `wrote: (unwritten) => … setVerdictProblem(unwrittenProblem(unwritten, …))` */
  const reportsWhatItHears = (effects: ts.Expression): boolean => {
    const wrote = ts.isObjectLiteralExpression(effects)
      ? effects.properties.find((property) => property.name?.getText(source) === 'wrote')
      : undefined
    if (!wrote || !ts.isPropertyAssignment(wrote) || !ts.isArrowFunction(wrote.initializer)) {
      return false
    }
    const heard = wrote.initializer.parameters[0]?.name.getText(source)
    if (heard === undefined) return false
    const body = wrote.initializer.body
    if (assigns(body, heard) || declares(body, heard)) return false
    return calls(wrote.initializer.body).some((call) => {
      const [problem] = call.arguments
      return (
        call.expression.getText(source) === 'setVerdictProblem' &&
        call.arguments.length === 1 &&
        problem !== undefined &&
        ts.isCallExpression(problem) &&
        problem.expression.getText(source) === 'unwrittenProblem' &&
        problem.arguments[0]?.getText(source) === heard
      )
    })
  }
  /** Whether anything inside `node` can leave the body it sits in. */
  const leaves = (node: ts.Node): boolean =>
    ts.isReturnStatement(node) ||
    ts.isThrowStatement(node) ||
    ts.isBreakStatement(node) ||
    ts.isContinueStatement(node) ||
    (ts.forEachChild(node, (child) => leaves(child) || undefined) ?? false)
  /** `(requests) => { … if (requests.length === 0) { setVerdictProblem(null) } … }`, never leaving. */
  const clearsWhenEmpty = (onRequests: ts.Expression): boolean => {
    if (!ts.isArrowFunction(onRequests)) return false
    const held = onRequests.parameters[0]?.name.getText(source)
    const branch = leading(onRequests.body).find(ts.isIfStatement)
    if (held === undefined || branch?.expression.getText(source) !== `${held}.length === 0`) {
      return false
    }
    const then = branch.thenStatement
    if (branch.elseStatement !== undefined || leaves(then)) return false
    const made =
      ts.isExpressionStatement(then) && ts.isCallExpression(then.expression)
        ? [then.expression]
        : calls(then)
    const said = made.map((call) => call.getText(source))
    return said.includes('setVerdictProblem(null)')
  }
  /** `forwardInOrder((batch) => answerFromPolicy(batch, …), (list) => …)` */
  const answersInOrder = (call: ts.CallExpression): boolean => {
    const [toAsk, forward] = call.arguments
    if (call.arguments.length !== 2 || toAsk === undefined || forward === undefined) return false
    if (!ts.isArrowFunction(toAsk) || !ts.isArrowFunction(forward)) return false
    const batch = toAsk.parameters[0]?.name
    if (toAsk.parameters.length !== 1 || batch === undefined || !ts.isIdentifier(batch)) {
      return false
    }
    // An expression body: the list is what `answerFromPolicy` resolves to, with no block to drop
    // it in or hand it something else first.
    const body = toAsk.body
    return (
      ts.isCallExpression(body) &&
      body.expression.getText(source) === 'answerFromPolicy' &&
      body.arguments[0]?.getText(source) === batch.text
    )
  }
  /** The `const` a well-formed `forwardInOrder(…)` is bound to, or nothing. */
  const boundTo = (call: ts.CallExpression): string | null => {
    const declaration = call.parent
    if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== call) return null
    if (!ts.isIdentifier(declaration.name)) return null
    const list = declaration.parent
    if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return null
    return declaration.name.text
  }
  /** After the empty-batch branch, the watcher hands `answer` its own batch before it can leave. */
  const answersEveryBatch = (onRequests: ts.Expression, answer: string): boolean => {
    if (!ts.isArrowFunction(onRequests) || !ts.isBlock(onRequests.body)) return false
    const held = onRequests.parameters[0]?.name.getText(source)
    const body = onRequests.body
    if (held === undefined || assigns(body, held) || declares(body, held)) return false
    if (declares(body, answer)) return false
    const statements = body.statements
    const empty = statements.findIndex(ts.isIfStatement)
    if (empty < 0) return false
    const next: ts.Statement[] = []
    for (const statement of statements.slice(empty + 1)) {
      next.push(statement)
      if (!ts.isExpressionStatement(statement) && !ts.isVariableStatement(statement)) break
    }
    return next.some(
      (statement) =>
        ts.isExpressionStatement(statement) &&
        ts.isCallExpression(statement.expression) &&
        statement.expression.expression.getText(source) === answer &&
        statement.expression.arguments.length === 1 &&
        statement.expression.arguments[0]?.getText(source) === held,
    )
  }
  /**
   * Whether this node itself writes `name`: an assignment, in parentheses or through
   * destructuring, a `for (name of …)` or `for (name in …)`, or `++` and `--`.
   */
  const writes = (node: ts.Node, name: string): boolean => {
    const names = (target: ts.Node): boolean =>
      (ts.isIdentifier(target) && target.text === name) ||
      (ts.forEachChild(target, (child) => names(child) || undefined) ?? false)
    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind
      const assignment =
        kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
      return assignment && names(node.left)
    }
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      return !ts.isVariableDeclarationList(node.initializer) && names(node.initializer)
    }
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      const steps = [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken]
      return steps.includes(node.operator) && names(node.operand)
    }
    return false
  }
  /** Whether `body`, or anything inside it, writes `name`. */
  const assigns = (body: ts.Node, name: string): boolean =>
    writes(body, name) ||
    (ts.forEachChild(body, (child) => assigns(child, name) || undefined) ?? false)
  /** Whether anything inside `body` declares `name`, and so hides the `name` outside it. */
  const declares = (body: ts.Node, name: string): boolean =>
    ((ts.isVariableDeclaration(body) ||
      ts.isParameter(body) ||
      ts.isBindingElement(body) ||
      ts.isFunctionDeclaration(body) ||
      ts.isClassDeclaration(body)) &&
      body.name !== undefined &&
      ts.isIdentifier(body.name) &&
      body.name.text === name) ||
    (ts.forEachChild(body, (child) => declares(child, name) || undefined) ?? false)

  const setter = 'setVerdictProblem'
  type Where = 'a person' | 'the policy' | 'elsewhere'
  const references: { readonly line: number; readonly where: Where }[] = []
  let renamed = 0
  let routed = 0
  let reported = 0
  let cleared = 0
  let setters = 0
  let everyBatch = 0

  // Found first, because the watcher that calls it is checked against its name.
  const inOrder: { readonly wellFormed: boolean; readonly name: string | null }[] = []
  const findInOrder = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'forwardInOrder') {
      inOrder.push({ wellFormed: answersInOrder(node), name: boundTo(node) })
    }
    ts.forEachChild(node, findInOrder)
  }
  findInOrder(source)
  const answer = inOrder.length === 1 ? inOrder[0]?.name ?? null : null
  const strays: number[] = []
  const assigned: number[] = []
  const rebound: number[] = []
  const visit = (node: ts.Node, where: Where): void => {
    let inside = where
    const named = (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === 'decide'
    if (named) {
      const parent = node.parent
      const channel =
        ts.isPropertyAccessExpression(parent) &&
        parent.name === node &&
        parent.expression.getText(source) === 'CHANNEL'
      const key = ts.isPropertyAssignment(parent) && parent.name === node
      const imported = ts.isImportSpecifier(parent)
      if (imported && parent.propertyName !== undefined) renamed += 1
      if (!channel && !key && !imported) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
        references.push({ line: line + 1, where })
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source)
      const [first, second] = node.arguments
      if (callee === 'setVerdictProblem') setters += 1
      if (callee === 'answerFromPolicy') {
        routed += 1
        inside = 'the policy'
        if (second !== undefined && reportsWhatItHears(second)) reported += 1
      }
      if (callee === 'ipcMain.handle' && first?.getText(source) === 'CHANNEL.decide') {
        inside = 'a person'
      }
      if (callee === 'watchApprovals' && second !== undefined && clearsWhenEmpty(second)) {
        cleared += 1
      }
      if (
        callee === 'watchApprovals' &&
        second !== undefined &&
        answer !== null &&
        answersEveryBatch(second, answer)
      ) {
        everyBatch += 1
      }
    }
    const line = (at: ts.Node): number =>
      source.getLineAndCharacterOfPosition(at.getStart(source)).line + 1
    if (answer !== null && writes(node, answer)) rebound.push(line(node))
    if (ts.isIdentifier(node) && node.text === setter) {
      const parent = node.parent
      // Declared at the top level only: one inside `wrote` is hoisted, and hides the real one.
      const declared =
        ts.isFunctionDeclaration(parent) && parent.name === node && ts.isSourceFile(parent.parent)
      const called = ts.isCallExpression(parent) && parent.expression === node
      if (!declared && !called) strays.push(line(node))
    }
    if (
      writes(node, 'verdictProblem') &&
      !ts.findAncestor(node, (up) => ts.isFunctionDeclaration(up) && up.name?.text === setter)
    ) {
      assigned.push(line(node))
    }
    ts.forEachChild(node, (child) => visit(child, inside))
  }
  visit(source, 'elsewhere')

  assert.ok(routed > 0, 'main.ts no longer hands its batches to answerFromPolicy')
  assert.ok(
    references.some((r) => r.where === 'a person'),
    "main.ts no longer writes a person's verdict through CHANNEL.decide; rewrite this check",
  )
  assert.equal(renamed, 0, 'main.ts imports decide under a name this check cannot follow')
  assert.deepEqual(
    references.filter((r) => r.where === 'elsewhere').map((r) => r.line),
    [],
    'main.ts reaches decide outside answerFromPolicy, where a failed write can lose the batch',
  )
  assert.equal(inOrder.length, 1, 'main.ts calls forwardInOrder other than exactly once')
  assert.ok(
    inOrder[0]?.wellFormed === true,
    "forwardInOrder is not handed (batch) => answerFromPolicy(batch, …), so the list it sends is not the batch's answer",
  )
  assert.equal(routed, 1, "answerFromPolicy is called outside forwardInOrder, where its list can land out of order")
  assert.ok(answer !== null, "forwardInOrder's result is not bound to a const the watcher can call")
  assert.deepEqual(rebound, [], `main.ts writes ${answer} after binding it to forwardInOrder`)
  assert.equal(reported, routed, 'a batch does not always set the problem from what it reports')
  assert.equal(cleared, 1, 'the empty batch does not always clear the problem before it returns')
  assert.equal(setters, reported + cleared, 'main.ts calls setVerdictProblem somewhere else too')
  assert.deepEqual(strays, [], 'main.ts passes setVerdictProblem around instead of calling it')
  assert.deepEqual(assigned, [], 'main.ts assigns verdictProblem outside setVerdictProblem')
  assert.equal(
    everyBatch,
    1,
    `a batch can leave the watcher before ${answer ?? 'forwardInOrder'} is handed it, or is handed something else`,
  )
})
