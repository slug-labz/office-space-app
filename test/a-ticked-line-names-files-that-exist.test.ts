/**
 * A ticked "Done looks like" line names only test files that are in the repository.
 *
 * **Naming a test file that is not there does not fail the run.** `tsx --test a b` with `b`
 * missing runs `a`, exits 0 and never mentions `b`. It fails (`Could not find 'b'`, exit 1) only
 * when none of the named files exist. Plain `node --test` does the same. Measured on 2026-09-17
 * with Node 22.16.0 and tsx 4.23.12, one real test file and one absent:
 *
 *     tsx --test exists.test.ts missing.test.ts     exit 0   # tests 1  # pass 1   missing never named
 *     tsx --test missing.test.ts exists.test.ts     exit 0   # tests 1  # pass 1   missing never named
 *     tsx --test missing.test.ts                    exit 1   Could not find 'missing.test.ts'
 *     node --test, the same three as .mjs           exit 0, 0, 1
 *
 * A tick in PLAN.md's §8 says its command passed, and `/verify` ticks on exit 0. So a ticked line
 * that names two files, one of them since renamed or never committed, keeps passing while it
 * checks less than it says, and running it cannot tell. §8 has **no** two-file line today: the one
 * it had — trust and permissions sharing a command — was split into a line each on 2026-10-01,
 * because the shape is the hazard. The assertion below was inverted to match, from *some ticked
 * command names two files* to *none may*, and this paragraph was left describing the old file
 * until 2026-10-01. Nothing stops the next two-file line being written, which is what this is for.
 *
 * ## What is checked
 *
 * **Every ticked line in every `## Done looks like` section**, wherever a reader sees a tick:
 * `- [x]`, and `[x]` after `*`, `+`, `1.` or `1)` as well, with any spaces or tabs between, or
 * inside a blockquote. A section runs to the next first- or second-level heading. Inside a code
 * fence nothing is a heading or a tick. What a fence line has to hold follows CommonMark: a fence
 * opens on three or more backticks or tildes, and after backticks the rest of the line holds no
 * backtick, so "```x```" opens nothing. It closes only on a line holding a run of its own
 * character, at least as long as the one that opened it, and nothing else but spaces or tabs.
 * Where a fence line may sit does not follow CommonMark; see below.
 *
 * **On each line, every backticked span, and the one that ends the line.** Spans pair left to
 * right. The span that ends the line is read as well, because that is the one `/verify` runs
 * (Pulse's `verify.js` takes the span that ends the line), and a stray backtick earlier on the
 * line pairs the first way wrongly but not the second. Every span, because an outcome can carry
 * a backticked path of its own before the command (the roster line does), and which span is "the
 * command" is then a choice this has no need to make.
 *
 * **In each span, every `tsx --test` or `node --test` run**, with or without `npx`, up to `;`,
 * `&`, `|`, a redirection or a parenthesis. Each word after `--test` that is not a flag or a glob
 * is a path. It has to be in the repository, spelled in the case it has on disk. `existsSync`
 * says yes to `test/Trust.test.ts` on macOS, whose disks ignore case by default, and a runner on
 * a disk that does not would skip that file without a word, which is the trap above (inferred:
 * to that runner the file is missing).
 *
 * **Unticked lines are exempt, on purpose.** An open outcome may name the test a later PR will
 * write. V3's line does in #263 (`test/which-office-needs-you.test.ts`, which no branch has yet
 * on 2026-09-17). An open line claims nothing has passed; a tick is the claim. `[~]` (half done)
 * is not a tick either.
 *
 * ## What this does not catch
 *
 * - **A glob** (`test/*.test.ts`), or a command that names no file. Both are skipped, not
 *   expanded, so a glob that matches nothing passes here.
 * - **A command that is not `tsx --test` or `node --test`**: `npm test`, or a script that runs
 *   tests itself. The files such a command runs are not looked at.
 * - **The runner under another name**: `npx tsx@4.23.12`, `tsx.cmd`, `node_modules\.bin\tsx`.
 *   Their files are not read. How a command is split into runs and files moves to `testRuns`
 *   (#271), which the office's own VERIFY harness uses; see the last paragraph.
 * - **A file that is there but tests something else**, or asserts nothing. Existence is all this
 *   checks. It says the command can run what it names, not that what it names proves the outcome.
 * - **A file on this disk that was never committed.** It passes here and is missing from a fresh
 *   clone.
 * - **A command on a later line of its list item.** Each tick line is read on its own. `/verify`
 *   runs only a span that ends the tick line, so none of its ticks rests on such a command. A
 *   tick made by hand could, and this would not see it.
 * - **A stray backtick before a command that does not end its line.** The stray one pairs with
 *   the command's opening backtick, and the command is read as prose. `/verify` does not run
 *   that command either, for the same reason as the line above.
 * - **A tick outside a `## Done looks like` section**, or under a heading worded or levelled
 *   differently (`### Done looks like`, or text underlined with `---`). `/verify` runs ticked
 *   commands under most headings; on 2026-09-17 none of those outside §8 is a test run.
 * - **A tick past a fence line that CommonMark places differently.** A fence line counts here at
 *   any indentation, while CommonMark allows three spaces at most, counted inside the list item or
 *   quote it is in. And a fence left open runs to the end of the file here, but only to the end of
 *   its list item or quote in CommonMark. Two more placements go the same way: a fence opened on a
 *   list marker's line (`- ` then three backticks), which is not taken for a fence here, so its
 *   closing line opens one; and a fence line inside an HTML block (`<!--`, `<pre>`), which a reader
 *   sees as HTML. Each can leave this inside a fence where a reader sees none, and the ticks after
 *   it are skipped. PLAN.md has no fence lines on 2026-09-17, and its one HTML comment is
 *   `<!-- pulse -->`.
 *
 * ## Where it errs loud
 *
 * Each of these is reported as a missing file although the command is fine:
 *
 * - a flag's value written as its own word: `--test-reporter spec`, `--test-name-pattern wedged`;
 * - a script's own arguments: `node scripts/check.mjs --test unit`;
 * - a redirection's number: `2>&1` reports `2`;
 * - a quoted path, even one that is there, which is reported with its quotes;
 * - a trailing comment: `# the wedge guard` reports each of its words;
 * - a run after `cd`: `cd test && npx tsx --test repo-health.test.ts` looks for the file at the
 *   repository root.
 *
 * `--flag=value`, an unquoted path and a run from the root do not trip it, and no ticked §8 line
 * is written any of these ways. All of them are about splitting a command, which moves to
 * `testRuns` (#271). Once this file can import it, `runsIn` below is replaced by it, and this
 * guard and the harness read a command the same way by construction.
 *
 * Two more are about lines rather than commands. A tick inside an HTML comment (`<!-- … -->`) is
 * read like any other, and so is a tick inside a fence in a blockquote, because a fence line that
 * starts with `>` is not taken for a fence. No reader sees either one as a tick.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve, sep } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A ticked line, numbered from 1, and each test run on it as the paths that run names. */
interface Ticked {
  line: number
  runs: string[][]
}

/** A heading that starts a section this reads. */
const DONE = /^##\s+(?:\d+\.\s+)?Done looks like\s*$/

/** A heading that ends a section: first or second level. A `###` is part of the section. */
const HEADING = /^#{1,2}\s/

/** A ticked list item: `-`, `*`, `+`, `1.` or `1)`, any spaces or tabs, in a blockquote or not. */
const TICK = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])[ \t]+\[[xX]\][ \t]/

/**
 * A line that opens a code fence: three or more backticks or tildes. After backticks the rest of
 * the line holds no backtick, so "```x```" is code in a line, not a fence.
 */
const OPENS = /^\s*(?:(`{3,})[^`]*$|(~{3,}))/

/** A line that can close a code fence: a run of backticks or tildes, then only spaces or tabs. */
const CLOSES = /^\s*(`{3,}|~{3,})[ \t]*$/

/**
 * The ticked lines under "Done looks like".
 *
 * Takes the text rather than a path, so a test can hand it a plan with a known fault in it. That
 * is the only way to show it reports one without breaking the real PLAN.md.
 */
function tickedLines(plan: string): Ticked[] {
  const ticked: Ticked[] = []
  let inSection = false
  // The run that opened the fence this line is in, or '' outside one.
  let fence = ''
  plan.split(/\r?\n/).forEach((text, i) => {
    if (fence !== '') {
      // Only its own character closes it, at least as many, with only spaces or tabs after.
      const run = CLOSES.exec(text)?.[1]
      if (run && run[0] === fence[0] && run.length >= fence.length) fence = ''
      return
    }
    const opened = OPENS.exec(text)
    if (opened) {
      fence = opened[1] ?? opened[2]!
      return
    }

    if (HEADING.test(text)) {
      // To the next heading, not to the end of the first list. §8 is two lists with prose
      // between them, and the second list holds four of its sixteen ticks.
      inSection = DONE.test(text)
      return
    }
    if (!inSection || !TICK.test(text)) return

    ticked.push({ line: i + 1, runs: spansOn(text).flatMap(runsIn) })
  })
  return ticked
}

/** Every backticked span on a line, paired left to right, and the span that ends the line. */
function spansOn(text: string): string[] {
  const spans = new Map<number, string>()
  for (const span of text.matchAll(/`([^`]+)`/g)) spans.set(span.index, span[1]!)
  const last = /`([^`]+)`\s*$/.exec(text)
  if (last) spans.set(last.index, last[1]!)
  return [...spans.values()]
}

/** The paths each `tsx --test` or `node --test` run in a command names, one list per run. */
function runsIn(command: string): string[][] {
  const runs: string[][] = []
  for (const run of command.matchAll(/(?:^|[\s(])(?:\S*\/)?(?:tsx|node)\s+([^;&|<>()]*)/g)) {
    const words = run[1]!.trim().split(/\s+/)
    const at = words.indexOf('--test')
    if (at < 0) continue
    const paths = words
      .slice(at + 1)
      .filter((word) => !word.startsWith('-'))
      .filter((word) => !/[*?[\]{}]/.test(word))
    runs.push(paths)
  }
  return runs
}

/**
 * Whether `file` is in the repository at `root`, spelled as it is on disk.
 *
 * Each part of the path has to be in its folder's listing, so a wrong case is not found even where
 * the disk would find it, and neither is anything outside `root`.
 */
function isThere(root: string, file: string): boolean {
  let dir = root
  for (const part of relative(root, resolve(root, file)).split(sep)) {
    if (!readdirSync(dir).includes(part)) return false
    dir = join(dir, part)
  }
  return existsSync(dir)
}

/** `line N: path` for each path a ticked run names that is not in the repository at `root`. */
function missing(ticked: Ticked[], root: string): string[] {
  return ticked.flatMap(({ line, runs }) =>
    runs.flat().filter((file) => !isThere(root, file)).map((file) => `line ${line}: ${file}`),
  )
}

test('every test file a ticked "Done looks like" line runs is in the repository', () => {
  const ticked = tickedLines(readFileSync(join(repo, 'PLAN.md'), 'utf8'))
  const runs = ticked.flatMap((t) => t.runs)
  const files = runs.flat()

  // The controls. The last assertion passes on anything it fails to find, so a renamed heading, a
  // changed tick or a pattern that stops matching would pass it having checked nothing.
  //
  // Measured on dev at e6fe5cb: 16 ticked lines, 11 test commands on them, 12 files. The first of
  // the section's two lists holds 12 of those ticks and 8 of those files, so both floors sit above
  // what a parser that stopped at the first list would see. Re-measured 2026-10-01 after the trust
  // line was split in two and the DMG line was untickied: 17 ticked lines, 13 files, and no line naming two.
  // Re-measured again the same day, after the public-release line was untickied: 16 ticked lines, 13 files.
  assert.ok(ticked.length > 12, `found ${ticked.length} ticked lines under "Done looks like" — the heading or the pattern moved`)
  assert.ok(files.length > 10, `found ${files.length} test files on ticked lines — the runner pattern moved`)
  // This used to assert the opposite: that some ticked command names two files, so that the real
  // file exercised the parser's two-file path. On 2026-10-01 the one line with that shape — trust
  // and permissions sharing a command — was split, because the shape is the hazard. `tsx --test`
  // skips a name that does not exist and exits 0 as long as one other name resolves (measured:
  // `npx tsx --test test/trust.test.ts test/zz-does-not-exist.test.ts` exits 0), so renaming the
  // second file leaves half an outcome unproven and the line still ticked.
  //
  // The parser's two-file path is not left untested by this: the fixture in the next test runs
  // `… test/repo-health.test.ts test/never-written.test.ts` and asserts the second is reported.
  // That is where it belongs — coverage that depends on production data keeping a hazard around
  // is coverage that argues against fixing the hazard.
  const twoFiled = ticked.filter((t) => t.runs.some((paths) => paths.length > 1))
  assert.deepEqual(
    twoFiled.map((t) => `line ${t.line}`),
    [],
    'a ticked line runs more than one test file in one command; tsx --test skips a missing name and exits 0, so the outcome can tick with half of it unproven. One file per line.',
  )

  assert.deepEqual(
    missing(ticked, repo),
    [],
    'PLAN.md ticks a command naming a test file that is not there, or not in that case; tsx --test runs the rest, exits 0 and never mentions it',
  )
})

test('a missing second file is reported, and a flag, a glob or an open line is not', () => {
  // The line numbers are what the assertion checks, so they are written beside the fixture.
  const plan = [
    '## 7. Session log', // 1
    '- [x] Before the section — `npx tsx --test test/before-the-section.test.ts`', // 2
    '## 8. Done looks like', // 3
    '- [x] Two files, the second never written — `npx tsx --test test/repo-health.test.ts test/never-written.test.ts`', // 4
    '- [ ] Open, naming the test a later PR will write — `npx tsx --test test/not-written-yet.test.ts`', // 5
    '', // 6
    'Prose between two lists, as the real section has.', // 7
    '', // 8
    '- [x] A flag is not a file — `tsx --test --test-timeout=60000 test/repo-health.test.ts`', // 9
    '- [x] Plain node, and a glob this does not expand — `node --test test/also-never-written.test.mjs test/*.test.ts`', // 10
    '## 9. After the section', // 11
    '- [x] After the section — `node --test test/after-the-section.test.ts`', // 12
  ].join('\n')

  assert.deepEqual(missing(tickedLines(plan), repo), [
    'line 4: test/never-written.test.ts',
    'line 10: test/also-never-written.test.mjs',
  ])
})

test('every span on a ticked line is read, and every run in a chain, but not what a pipe feeds', () => {
  const plan = [
    '## Done looks like', // 1
    '- [x] Two runs in two spans — `npx tsx --test test/in-the-first-span.test.ts` and `npx tsx --test test/in-the-second-span.test.ts`, one after the other', // 2
    '- [x] A chain with && — `npx tsx --test test/repo-health.test.ts && npx tsx --test test/after-and.test.ts`', // 3
    '- [x] A chain with ; — `npx tsx --test test/repo-health.test.ts; node --test test/after-a-semicolon.test.mjs`', // 4
    '- [x] A pipe into something that is not a runner — `npx tsx --test test/repo-health.test.ts | tee test/after-a-pipe.txt`', // 5
    '- [x] A stray ` before the command, which ends the line — `npx tsx --test test/after-a-stray-backtick.test.ts`', // 6
  ].join('\n')

  assert.deepEqual(missing(tickedLines(plan), repo), [
    'line 2: test/in-the-first-span.test.ts',
    'line 2: test/in-the-second-span.test.ts',
    'line 3: test/after-and.test.ts',
    'line 4: test/after-a-semicolon.test.mjs',
    'line 6: test/after-a-stray-backtick.test.ts',
  ])
})

test('a tick is read however the list writes it, in every section, and a fence ends nothing', () => {
  const plan = [
    '## 8. Done looks like', // 1
    '* [x] A star — `npx tsx --test test/after-a-star.test.ts`', // 2
    '+ [x] A plus — `npx tsx --test test/after-a-plus.test.ts`', // 3
    '1. [x] A number and a dot — `npx tsx --test test/after-a-dot.test.ts`', // 4
    '2) [x] A number and a parenthesis — `npx tsx --test test/after-a-parenthesis.test.ts`', // 5
    '-   [x] Three spaces after the dash — `npx tsx --test test/after-three-spaces.test.ts`', // 6
    '-\t[x]\tTabs — `npx tsx --test test/after-tabs.test.ts`', // 7
    '> - [x] In a blockquote — `npx tsx --test test/in-a-blockquote.test.ts`', // 8
    '- [~] Half done, which is not a tick — `npx tsx --test test/half-done.test.ts`', // 9
    '````markdown', // 10
    '```', // 11
    '## A heading inside a fence, which ends nothing', // 12
    '- [x] A tick inside a fence, which is not read — `npx tsx --test test/inside-a-fence.test.ts`', // 13
    '````', // 14
    '~~~', // 15
    '```', // 16
    '## Nor inside a fence of tildes', // 17
    '~~~', // 18
    '- [x] Past both fences, still in the section — `npx tsx --test test/past-the-fences.test.ts`', // 19
    '# A first-level heading, which ends the section', // 20
    '- [x] In no section — `npx tsx --test test/under-a-first-level-heading.test.ts`', // 21
    '## Done looks like', // 22
    '- [x] A second section, read as well — `npx tsx --test test/in-a-second-section.test.ts`', // 23
  ].join('\n')

  assert.deepEqual(missing(tickedLines(plan), repo), [
    'line 2: test/after-a-star.test.ts',
    'line 3: test/after-a-plus.test.ts',
    'line 4: test/after-a-dot.test.ts',
    'line 5: test/after-a-parenthesis.test.ts',
    'line 6: test/after-three-spaces.test.ts',
    'line 7: test/after-tabs.test.ts',
    'line 8: test/in-a-blockquote.test.ts',
    'line 19: test/past-the-fences.test.ts',
    'line 23: test/in-a-second-section.test.ts',
  ])
})

test('a path is found only as it is spelled on disk, and only in the repository', () => {
  // On macOS the disk finds the first two, and so does existsSync. A runner on a disk that minds
  // case would not.
  const plan = [
    '## Done looks like', // 1
    '- [x] The file in another case — `npx tsx --test test/Repo-Health.test.ts`', // 2
    '- [x] The folder in another case — `npx tsx --test Test/repo-health.test.ts`', // 3
    '- [x] A file that is there, outside the repository — `npx tsx --test /etc/hosts`', // 4
    '- [x] The right case, by a path that goes round — `npx tsx --test ./test/../test/repo-health.test.ts`', // 5
  ].join('\n')

  assert.deepEqual(missing(tickedLines(plan), repo), [
    'line 2: test/Repo-Health.test.ts',
    'line 3: Test/repo-health.test.ts',
    'line 4: /etc/hosts',
  ])
})

test('a fence closes only on its own character, at least as long, with nothing after it but spaces or tabs', () => {
  // CommonMark 0.31.2, 4.5: a closing fence "may be followed only by spaces or tabs", so a fence
  // line with an info string inside a fence is part of the code (its example 147).
  const plan = [
    '## Done looks like', // 1
    '```', // 2
    '```js', // 3
    '- [x] Inside the fence, past a line with an info string — `npx tsx --test test/past-an-info-string.test.ts`', // 4
    '```', // 5
    '- [x] Past the fence — `npx tsx --test test/past-a-closed-fence.test.ts`', // 6
    '~~~~', // 7
    '~~~~ and some words', // 8
    '- [x] Inside the tildes, past a line with words — `npx tsx --test test/past-words.test.ts`', // 9
    '~~~~~ \t', // 10
    '- [x] Past the tildes, closed by a longer run and spaces — `npx tsx --test test/past-closed-tildes.test.ts`', // 11
  ].join('\n')

  const want = ['line 6: test/past-a-closed-fence.test.ts', 'line 11: test/past-closed-tildes.test.ts']
  assert.deepEqual(missing(tickedLines(plan), repo), want)
  assert.deepEqual(missing(tickedLines(plan.split('\n').join('\r\n')), repo), want, 'a fence did not close at a Windows line end')
})

test('backticks with a backtick after them open no fence, and tildes may have either after them', () => {
  // CommonMark 0.31.2, 4.5: after a backtick fence the info string "may not contain any backtick
  // characters", and after tildes it may (its examples 145 and 146).
  const plan = [
    '## Done looks like', // 1
    '```x``` is code in a line, not a fence', // 2
    '- [x] After a line of code — `npx tsx --test test/after-a-line-of-code.test.ts`', // 3
    '~~~ aa ``` ~~~', // 4
    '- [x] Inside tildes with backticks after them — `npx tsx --test test/inside-tildes.test.ts`', // 5
    '~~~', // 6
    '- [x] Past the tildes — `npx tsx --test test/past-the-tildes.test.ts`', // 7
    '``` js', // 8
    '- [x] Inside backticks with a word after them — `npx tsx --test test/inside-backticks.test.ts`', // 9
    '```', // 10
    '- [x] Past the backticks — `npx tsx --test test/past-the-backticks.test.ts`', // 11
  ].join('\n')

  assert.deepEqual(missing(tickedLines(plan), repo), [
    'line 3: test/after-a-line-of-code.test.ts',
    'line 7: test/past-the-tildes.test.ts',
    'line 11: test/past-the-backticks.test.ts',
  ])
})

test('a heading below the second level keeps the section going', () => {
  const plan = [
    '## Done looks like', // 1
    '### V1', // 2
    '- [x] Under a third-level heading — `npx tsx --test test/under-a-third-level-heading.test.ts`', // 3
    '#### Deeper still', // 4
    '- [x] Under a fourth-level heading — `npx tsx --test test/under-a-fourth-level-heading.test.ts`', // 5
    '## The next section', // 6
    '- [x] In the next section — `npx tsx --test test/in-the-next-section.test.ts`', // 7
  ].join('\n')

  assert.deepEqual(missing(tickedLines(plan), repo), [
    'line 3: test/under-a-third-level-heading.test.ts',
    'line 5: test/under-a-fourth-level-heading.test.ts',
  ])
})

test('a tilde fence closes only on a run at least as long as the one that opened it', () => {
  // Test 4 holds the length rule for backticks. A run of tildes one short is code, not a close.
  const plan = [
    '## Done looks like', // 1
    '~~~~', // 2
    '~~~', // 3
    '- [x] Inside the tildes, past a shorter run — `npx tsx --test test/past-a-shorter-run.test.ts`', // 4
    '~~~~', // 5
    '- [x] Past the tildes — `npx tsx --test test/past-a-closing-run.test.ts`', // 6
  ].join('\n')

  assert.deepEqual(missing(tickedLines(plan), repo), ['line 6: test/past-a-closing-run.test.ts'])
})
