/**
 * `/verify` finds the test files a VERIFY names before it calls an exit 0 a pass.
 *
 * `.claude/commands/verify.md` said a task may move to Done when its command exits zero. For
 * `node --test` and `tsx --test` that is not enough: both exit 0 when some of the files they are
 * given are missing and the others pass (measured for #271 with Node 22.16.0 and 24.3.0 and tsx
 * 4.23.12). So `/verify` would move a task to Done on the strength of a test file nobody wrote.
 * PR #271 closes the same gap in the office's own check, and this is the rule for an agent running
 * `/verify` (TASKS.md row 56, D23).
 *
 * The rule is a closed shape rather than a description of #271's parser: a run's files are looked
 * for only when the whole command is one plain run, and anything else keeps its task where it is.
 * This is stricter than the office's check, because a Done row carries no note.
 *
 * The command is prose an agent follows, so these tests pin the instruction, not what an agent
 * does with it; nothing here can check that. #274's reviews showed that pinning phrases, and then
 * pinning parts, each let a rule change through (a table row the parser skipped, a paragraph put
 * before the steps). So the whole file is pinned, block by block, with line wrapping inside a
 * block ignored and Windows line ends read as Unix ones: changing the rule anywhere means changing
 * it here too, on purpose. The tests after that say why the parts matter, and read the shape's
 * four lists as sets. The file is read from the repository, and no temp folder is made.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const command = readFileSync(join(root, '.claude', 'commands', 'verify.md'), 'utf8').replace(/\r\n/g, '\n')

/** The agreed file, as the plan reviewer (rounds 9–11) and #274's reviews left it. */
const AGREED = "---\ndescription: Run a task's VERIFY condition and report what actually happened. Moves the task to Done only if the command exits zero and every test file it names was found. Use before claiming any piece of work is finished.\nargument-hint: \"<task number, or part of its title — omit for everything in progress>\"\n---\n\n# Check the claim\n\nRun the VERIFY condition for `$ARGUMENTS` in the current project's `TASKS.md`. With nothing\nthere, run every task under `## In progress`.\n\nThe second standing order is that claims are verified, not believed, and this is the verb for\nit. An agent saying \"done\" does not make a task done; the command in the VERIFY column exiting\nzero does, once the test files it names have been found.\n\n## What to do\n\n1. **Find the task** and read its VERIFY column verbatim.\n2. **Take the first backticked command** — that is the runnable part. If there is no backticked\n   command, stop: this task is **uncheckable**, say so plainly, and leave it where it is.\n3. **Run it, from the workspace root.** Do not adapt it, do not run something similar, do not\n   substitute a narrower test because the real one is slow.\n4. **If the command has `node` or `tsx` anywhere in it, even inside a longer word and in any\n   letter case, and has `--test` anywhere in it, check its shape.** Its test files can be looked\n   for only if the whole command is exactly:\n   - `node --test`, `tsx --test`, `npx tsx --test` or `npx --yes tsx --test`,\n   - followed by one or more file names, each after a single space, each made only of the\n     letters `a` to `z` and `A` to `Z`, the digits `0` to `9`, and `.`, `/`, `_` and `-`, not\n     starting with `-`, with no `..` and no `node_modules` in it, and ending in `.js`, `.mjs`,\n     `.cjs`, `.ts`, `.mts` or `.cts`, in lower case as written here,\n\n   and nothing else: no other program, option or word, no redirection, no other space, and none\n   of `;`, `&`, `|`, `(`, `)`, `'`, `\"`, `$`, `~`, `\\`, `*`, `?` or a backtick.\n5. **If it has that shape, look for each file** with `ls <file>` from the workspace root, one\n   call per file. If `ls` exits non-zero, the file was not found: it is not there, or it could not\n   be read, and you report what `ls` said. Both runners exit 0 when some of the files they are\n   given are missing and the others pass (measured on 2026-09-17 with Node 22.16.0 and 24.3.0 and\n   tsx 4.23.12), so the command's exit 0 does not show that a missing file was tested. A file\n   under `node_modules` is left out of the shape because the runners skip it without a word even\n   when it is there (measured the same way).\n6. **If it does not have that shape, its test files were not looked for.** Say so, and name the\n   first word that does not fit, say where a space is doubled or left at the end, or say that the\n   command names no file. Leave the task where it is. Do not work out what the command would\n   have done instead: a shell, `npx -c`, `eval`, a `cd`, an option, a redirection, a pattern or a\n   quoted name can each change which files the runner is given, and telling the harmless cases\n   from the others is a judgement call. That holds for `echo \"node --test done\"` too; write the\n   VERIFY as a plain run and it can be checked.\n7. **Report the exit code and the output**, both, whether it passed or not, and name any test\n   file that was not found.\n\nA command without `node` or `tsx` in it, or without `--test`, such as `npm test`, `node build.js`\nor a script, is judged by its exit code alone. A runner that such a command starts is not seen,\nso a VERIFY that should have its test files looked for names the runner itself.\n\n## The outcomes, and what each one means\n\n| Outcome | What to do |\n|---|---|\n| Finished with exit zero, and every test file its run names was found | The task may move to `## Done`, with today's date in the Completed column. |\n| Finished with exit zero, and a test file it names was not found | It stays in `## In progress`. Name the file, give what `ls` said, and paste the output. |\n| Finished with exit zero, but its test files were not looked for | It stays in `## In progress`. Say its test files were **not looked for**, and name the first word that does not fit, say where a space is doubled or left at the end, or say that it names no file. |\n| Finished with a non-zero exit | It stays in `## In progress`. Paste the failure. Do not describe it. |\n| Did not finish: the tool's time limit ran out, the tool moved it to the background, or it was stopped, whatever it did afterwards | It stays in `## In progress`. Report it as **did not finish**, with what it printed, whatever exit code stopping it gave. Do not wait for a run in the background. |\n| Refused or not permitted | Report it as **not checked** and name the command. `.claude/settings.json` decides what runs unattended; a refusal is a fact about the workspace, not about the work. |\n| No command in the VERIFY | Report it as **uncheckable**. That is a respectable answer. |\n\nNothing here is a judgement call. If you find yourself weighing whether a failure \"really\"\ncounts, the answer is that it counts.\n\n## Afterwards\n\nAppend what happened to `PROGRESS.md`, with the command and its real result — including\nfailures. An entry recording that a check failed is worth more than one recording that it\npassed, because it is the one somebody would otherwise have to rediscover.\n"

/** Text on one line, as a reader takes it. */
const flat = (text: string): string => text.replace(/\s*\n\s*/g, ' ').trim()

/** A file's blocks, each on one line: rewrapping inside a block changes nothing here. */
const blocks = (text: string): string[] => text.split(/\n[ \t]*\n/).map(flat).filter(Boolean)

/** Every backticked span in `text`, in order. */
const codes = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!)

/** The backticked spans between `from` and `to` in `text`, which must hold both, in that order. */
function listBetween(text: string, from: string, to: string, what: string): string[] {
  const start = text.indexOf(from)
  const end = start < 0 ? -1 : text.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end >= 0, `the text no longer says ${what} where it did ("${from}" … "${to}")`)
  return codes(text.slice(start + from.length, end))
}

/** The parts of a command file that carry the rule, failing on a table line that is not a two-cell row. */
function parts(text: string) {
  const section = /\n## What to do\n([\s\S]*?)\n## /.exec(text)?.[1] ?? ''
  const cut = section.lastIndexOf('\n\n')
  const table = (/\n## The outcomes, and what each one means\n\n([\s\S]*?)\n\n/.exec(text)?.[1] ?? '').split('\n')
  assert.equal(table[0], '| Outcome | What to do |', 'the outcomes table has lost its header')
  assert.equal(table[1], '|---|---|', 'the outcomes table has lost its rule line')
  const rows = table.slice(2).map((line, i): [string, string] => {
    assert.match(line, /^\| .+ \| .+ \|$/, `line ${i + 3} of the outcomes table is not a row this can read: ${line}`)
    const cells = line.slice(2, -2).split(' | ')
    assert.equal(cells.length, 2, `line ${i + 3} of the outcomes table has ${cells.length} cells: ${line}`)
    return [cells[0]!, cells[1]!]
  })
  return {
    description: /^description: (.*)$/m.exec(text)?.[1] ?? '',
    intro: flat(/\n# Check the claim\n([\s\S]*?)\n## What to do/.exec(text)?.[1] ?? ''),
    steps: section.slice(0, cut).split(/\n(?=\d+\. )/).map(flat).filter((step) => /^\d+\. /.test(step)),
    after: flat(section.slice(cut + 2)),
    rows,
  }
}

const agreed = parts(AGREED)

test('control: the command still has its steps and its table, and this test reads them', () => {
  const found = parts(command)
  assert.equal(found.steps.length, 7, `${found.steps.length} steps were read`)
  assert.ok(found.rows.length >= 4, 'the outcomes table was not read')
})

test('the whole file is the agreed text, line wrapping aside', () => {
  const found = parts(command)
  // Part by part first, for a message that says where.
  assert.equal(found.description, agreed.description, 'the description differs from the agreed rule')
  assert.equal(found.intro, agreed.intro, 'the introduction differs from the agreed rule')
  assert.deepEqual(found.steps, agreed.steps, 'a step differs from the agreed rule')
  assert.equal(found.after, agreed.after, 'the paragraph after the steps differs from the agreed rule')
  assert.deepEqual(found.rows, agreed.rows, 'the outcomes table differs from the agreed rule')
  // Then everything: frontmatter keys, text before the steps, new sections, the closing lines.
  assert.deepEqual(blocks(command), blocks(AGREED), 'the file differs from the agreed text outside the parts above')
})

test('each list in the shape is closed, as a set', () => {
  const shape = agreed.steps[3]!
  assert.deepEqual(
    new Set(listBetween(shape, 'exactly: - ', ', - followed by', 'the runner forms')),
    new Set(['node --test', 'tsx --test', 'npx tsx --test', 'npx --yes tsx --test']),
  )
  assert.ok(shape.includes('the letters `a` to `z` and `A` to `Z`, the digits `0` to `9`, and'), 'a name may hold other letters or digits')
  assert.deepEqual(
    new Set(listBetween(shape, 'the digits `0` to `9`, and ', ', not starting with', 'the other characters a name may hold')),
    new Set(['.', '/', '_', '-']),
  )
  assert.deepEqual(
    new Set(listBetween(shape, 'and ending in ', ', in lower case as written here', 'the endings a name may have')),
    new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']),
  )
  assert.deepEqual(
    new Set(listBetween(shape, 'and none of ', ' or a backtick.', 'the characters that break the shape')),
    new Set([';', '&', '|', '(', ')', "'", '"', '$', '~', '\\', '*', '?']),
  )
  // The runners skip a file under node_modules without a word, even when ls finds it.
  assert.ok(shape.includes('with no `..` and no `node_modules` in it'), 'a name may climb with .. or sit under node_modules')
})

test('only a finished run reaches Done, one way only, and every other outcome keeps the task where it is', () => {
  const [done, ...rest] = agreed.rows
  assert.equal(done![0], 'Finished with exit zero, and every test file its run names was found')
  assert.ok(done![1].startsWith('The task may move to `## Done`'))
  for (const [said, todo] of rest) {
    assert.ok(!/Done/.test(said + todo), `"${said}" is a second way to Done`)
    if (said.startsWith('Refused') || said.startsWith('No command')) continue
    assert.ok(todo.startsWith('It stays in `## In progress`.'), `"${said}" does not keep the task in progress`)
  }
  // A run that did not finish takes its own row whatever it does later, so it never reaches the rows above.
  const finished = rest.filter(([said]) => said.startsWith('Finished with'))
  assert.equal(finished.length, 3, 'a finishing outcome is missing, or one no longer says the run finished')
  assert.ok(rest.some(([said]) => said.startsWith('Did not finish:') && said.endsWith('whatever it did afterwards')))
})
