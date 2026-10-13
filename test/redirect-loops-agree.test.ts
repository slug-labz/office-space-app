/**
 * Every hand-rolled redirect loop obeys the same rules.
 *
 * There are two — `voice/transcribe.ts` fetching the speech model, `spotify/client.ts` reaching
 * the API — and they have now diverged twice, in the same direction both times:
 *
 *   the scheme check   `client.ts` checked the protocol on its initial request; `transcribe.ts`
 *                      checked the host and not the scheme, so the *first* request was the least
 *                      checked thing in the function
 *   the base fallback  `client.ts` dropped `response.url || url`; `transcribe.ts` kept it, with
 *                      the paragraph explaining why it is wrong living in the file that no
 *                      longer had the line
 *
 * Both were caught in review, one round apart, by a person reading two files side by side. Twice
 * is a pattern, and the answer to a pattern is not a third resolution to remember.
 *
 * ## Why a scanner and not a shared helper
 *
 * A shared helper is the better shape and it is not free: the two loops carry different
 * credentials, different error types — one returns a refusal, the other throws — different hop
 * caps, and different notions of what a test may relax. Merging them is a refactor across two
 * open changes, and a refactor done to satisfy a rule is how a rule gets a worse codebase. This
 * holds them to the same properties until somebody makes that call deliberately, and it keeps
 * holding a third one.
 *
 * ## What this cannot see
 *
 * Source, not behaviour. It checks that the guard is written, never that it works — that is what
 * each module's own tests are for. It also finds loops by looking for `redirect: 'manual'`, so a
 * loop written some other way is invisible to it; the floor below fails loudly if the count ever
 * drops, which is the failure that would otherwise read as everything being fine.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function sources(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await sources(path)))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

/** Comments blanked, because a rule described is not a rule applied — the whole subject here. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

test('every hand-rolled redirect loop obeys the same rules', async () => {
  const found: { file: string; body: string }[] = []
  for (const file of await sources('src')) {
    const body = code(await readFile(join(root, file), 'utf8'))
    if (body.includes("redirect: 'manual'")) found.push({ file, body })
  }

  assert.ok(
    found.length >= 1,
    'no redirect loops found at all — either they were removed, or they are written some way ' +
      'this no longer recognises, and an empty result here reads exactly like everything passing',
  )

  for (const { file, body } of found) {
    const where = relative(root, join(root, file))

    // A `Location` resolves against the response it came from. A fallback base is either dead
    // code or the wrong address, and it was both here: unreachable in production, and the only
    // branch the tests took.
    assert.doesNotMatch(
      body,
      /new URL\([^)]*response\.url\s*\|\|/,
      `${where} resolves a redirect against a fallback base. \`response.url\` is populated under ` +
        "`redirect: 'manual'`; a fallback is the original request, which is the wrong address " +
        'from hop 2 — and under test it is the only branch, so the assertions land on it.',
    )

    /*
     * Counted and compared, not merely present.
     *
     * The first version asserted the *strings* `protocol !== 'https:'` and `MAX_REDIRECTS`
     * appeared anywhere in the file. Both survive the mutation that matters: `if (false) {`
     * leaves the comparison text sitting in the other check, and swapping `MAX_REDIRECTS` for a
     * literal leaves the constant's own declaration behind. Two mutations came back green.
     *
     * That is the fault this whole file is about, landing on the file itself — a check matching
     * text rather than meaning. The cap is a comparison now rather than a mention, which fixes
     * that one.
     *
     * The scheme check could not be fixed the same way, and the assertion below is deliberately
     * weak as a result. Counting occurrences does not work: mutating the *initial* check away in
     * `transcribe.ts` still leaves two in the hop checks, and `client.ts` routes the initial
     * request and every hop through a single `check()` and so has exactly one. The property that
     * matters — *the first request is checked like a hop* — has a different shape in each module,
     * and source matching cannot express it.
     *
     * So it is left as "a scheme is mentioned", and the real cover for it is each module's own
     * behaviour tests, which do exercise it: `the first request is checked for scheme too, not
     * only for host` in `dictation.test.ts`, and `a redirect to plaintext is refused` in
     * `spotify.test.ts`. Both were written because mutation showed the guard untested, and both
     * fail when it is removed. This is the honest division: a scanner holds the properties it can
     * express, and says which ones it cannot.
     */
    assert.match(
      body,
      /protocol !== 'https:'/,
      `${where} follows redirects and never mentions a scheme at all.`,
    )

    assert.match(
      body,
      /\b\w+\s*>=\s*MAX_REDIRECTS\b/,
      `${where} never compares anything to MAX_REDIRECTS. A server that answers 302 with its own ` +
        'address is not a slow download, it is one that never finishes.',
    )

    // The hop is checked, not just the request that started it.
    assert.match(
      body,
      /new URL\(next,|const target = new URL\(/,
      `${where} does not resolve a \`Location\` into a URL it can check.`,
    )
  }
})
