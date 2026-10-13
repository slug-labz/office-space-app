---
name: write-a-task
description: Add a task to a project's TASKS.md with a VERIFY condition the office can actually check. Use when work is being planned, split up, or handed over, and whenever somebody is about to mark something done.
---

# Writing a task

A task in `projects/<name>/TASKS.md` has four columns, and only one of them is difficult.

| # | Task | Owner | VERIFY |
|---|------|-------|--------|
| 7 | Cap the token refresh retry | builder | `npm test` exits 0 |

## The VERIFY column is a command, not a verdict

This is the whole of it, and it is the thing this office most often gets wrong.

Write **what should be run**, in backticks. The harness runs the first backticked command and
reports what happened:

- `` `npm test` exits 0 ``
- `` `npm run typecheck` is clean ``
- `` `grep -q "coming soon" site/index.html` ``

Do **not** write the outcome:

- ~~PASS — I read the file and it looks right~~
- ~~Confirmed working, checked manually~~
- ~~Done, verified by the reviewer~~

Those replace the check with a claim, which is precisely what the second standing order refuses.
An agent writing "PASS" into the column that was supposed to settle whether it passed is the
office marking its own homework. It has happened in this repository, which is why this skill
exists.

## When it genuinely cannot be a command

Say so plainly — `reviewed by eye`, `somebody opens it in a browser` — and the office reports
the task as **uncheckable**. That is a respectable answer. It is honest about what the office
knows, which "PASS" is not.

Give a task like that an owner who is a person, not an agent. `user` is a valid owner.

## Choosing the command

It has to **fail when the work is wrong**. A command that passes on an empty repository is not
a check, it is decoration:

- `ls the-file-i-made` proves the file exists, and nothing about whether it is right.
- `grep -q "the thing it must say" the-file` proves something about the contents.
- `npm test` proves whatever the tests prove, which is why the tests matter.

Prefer a command the workspace already allows — `.claude/settings.json` lists them. Anything
else is reported honestly as *not checked* and waits for a person, which is fine but slower.

## Owner

The name of somebody on the floor: `builder`, `reviewer`, `tester`, `frontend`, `backend`,
`memory-keeper`. The office draws each employee's worst outstanding task on them, so an owner
that is not on the roster is work nobody can see being carried.

## Moving a task

`## In progress` → `## Done` **only when its VERIFY has passed.** Add the date in the Completed
column. Nothing moves to Done because it feels finished.
