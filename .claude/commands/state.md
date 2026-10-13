---
description: Reconcile a project's TASKS.md and PROGRESS.md against what is actually true on disk, and fix the files rather than the story. Use on resume, when you have lost the thread, or before telling anybody the work is finished.
argument-hint: "[project name — defaults to the current one]"
---

# What is actually true right now

Reconcile `projects/<name>/` against the repository, and correct the files. `$ARGUMENTS` names
the project; with nothing there, use the one this session is working in.

This is the fourth standing order in verb form. A task list is a claim about the world, and
claims drift — the office floor reads these files, so a stale `TASKS.md` is not untidy
bookkeeping, it is a UI telling the user something that is not so.

## Establish, then write

1. **Read the three files.** `PLAN.md` for what done looks like, `TASKS.md` for what is
   outstanding, `PROGRESS.md` for what has already been established and when.
2. **Check each task in `## In progress` and `## Done` against the repository.** Does the code
   it describes exist? Run its VERIFY. A task in `## Done` whose VERIFY does not pass now is
   the most important thing this command finds.
3. **Look for work that happened and was never written down.** `git status` and `git diff` show
   changes no task claims. That is as much a discrepancy as a task claiming work that never
   happened.

Then correct the files:

- Move anything whose VERIFY does not pass back out of `## Done`, and say why in the task.
- Add the tasks that the working tree implies and nobody wrote.
- Append one dated entry to `PROGRESS.md` recording what the reconciliation found — including
  "nothing had drifted", which is a real and useful finding.

## What must not happen

Do not move a task to `## Done` because the code looks right. Run the VERIFY. If it cannot be
run — the command is not permitted, the check needs a person — say exactly that, and leave the
task where it is.

Report a count, not a narrative: how many tasks were checked, how many passed, how many moved,
and what could not be checked at all.
