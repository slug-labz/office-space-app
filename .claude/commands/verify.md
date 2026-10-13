---
description: Run a task's VERIFY condition and report what actually happened. Moves the task to Done only if the command exits zero and every test file it names was found. Use before claiming any piece of work is finished.
argument-hint: "<task number, or part of its title — omit for everything in progress>"
---

# Check the claim

Run the VERIFY condition for `$ARGUMENTS` in the current project's `TASKS.md`. With nothing
there, run every task under `## In progress`.

The second standing order is that claims are verified, not believed, and this is the verb for
it. An agent saying "done" does not make a task done; the command in the VERIFY column exiting
zero does, once the test files it names have been found.

## What to do

1. **Find the task** and read its VERIFY column verbatim.
2. **Take the first backticked command** — that is the runnable part. If there is no backticked
   command, stop: this task is **uncheckable**, say so plainly, and leave it where it is.
3. **Run it, from the workspace root.** Do not adapt it, do not run something similar, do not
   substitute a narrower test because the real one is slow.
4. **If the command has `node` or `tsx` anywhere in it, even inside a longer word and in any
   letter case, and has `--test` anywhere in it, check its shape.** Its test files can be looked
   for only if the whole command is exactly:
   - `node --test`, `tsx --test`, `npx tsx --test` or `npx --yes tsx --test`,
   - followed by one or more file names, each after a single space, each made only of the
     letters `a` to `z` and `A` to `Z`, the digits `0` to `9`, and `.`, `/`, `_` and `-`, not
     starting with `-`, with no `..` and no `node_modules` in it, and ending in `.js`, `.mjs`,
     `.cjs`, `.ts`, `.mts` or `.cts`, in lower case as written here,

   and nothing else: no other program, option or word, no redirection, no other space, and none
   of `;`, `&`, `|`, `(`, `)`, `'`, `"`, `$`, `~`, `\`, `*`, `?` or a backtick.
5. **If it has that shape, look for each file** with `ls <file>` from the workspace root, one
   call per file. If `ls` exits non-zero, the file was not found: it is not there, or it could not
   be read, and you report what `ls` said. Both runners exit 0 when some of the files they are
   given are missing and the others pass (measured on 2026-09-17 with Node 22.16.0 and 24.3.0 and
   tsx 4.23.12), so the command's exit 0 does not show that a missing file was tested. A file
   under `node_modules` is left out of the shape because the runners skip it without a word even
   when it is there (measured the same way).
6. **If it does not have that shape, its test files were not looked for.** Say so, and name the
   first word that does not fit, say where a space is doubled or left at the end, or say that the
   command names no file. Leave the task where it is. Do not work out what the command would
   have done instead: a shell, `npx -c`, `eval`, a `cd`, an option, a redirection, a pattern or a
   quoted name can each change which files the runner is given, and telling the harmless cases
   from the others is a judgement call. That holds for `echo "node --test done"` too; write the
   VERIFY as a plain run and it can be checked.
7. **Report the exit code and the output**, both, whether it passed or not, and name any test
   file that was not found.

A command without `node` or `tsx` in it, or without `--test`, such as `npm test`, `node build.js`
or a script, is judged by its exit code alone. A runner that such a command starts is not seen,
so a VERIFY that should have its test files looked for names the runner itself.

## The outcomes, and what each one means

| Outcome | What to do |
|---|---|
| Finished with exit zero, and every test file its run names was found | The task may move to `## Done`, with today's date in the Completed column. |
| Finished with exit zero, and a test file it names was not found | It stays in `## In progress`. Name the file, give what `ls` said, and paste the output. |
| Finished with exit zero, but its test files were not looked for | It stays in `## In progress`. Say its test files were **not looked for**, and name the first word that does not fit, say where a space is doubled or left at the end, or say that it names no file. |
| Finished with a non-zero exit | It stays in `## In progress`. Paste the failure. Do not describe it. |
| Did not finish: the tool's time limit ran out, the tool moved it to the background, or it was stopped, whatever it did afterwards | It stays in `## In progress`. Report it as **did not finish**, with what it printed, whatever exit code stopping it gave. Do not wait for a run in the background. |
| Refused or not permitted | Report it as **not checked** and name the command. `.claude/settings.json` decides what runs unattended; a refusal is a fact about the workspace, not about the work. |
| No command in the VERIFY | Report it as **uncheckable**. That is a respectable answer. |

Nothing here is a judgement call. If you find yourself weighing whether a failure "really"
counts, the answer is that it counts.

## Afterwards

Append what happened to `PROGRESS.md`, with the command and its real result — including
failures. An entry recording that a check failed is worth more than one recording that it
passed, because it is the one somebody would otherwise have to rediscover.
