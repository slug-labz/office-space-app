# Tasks — <Project Name>

Live task list. Every task has an owner and a VERIFY condition. A task is done when the
VERIFY passes, not when someone says it is.

**VERIFY is a command, not a verdict.** Write what the office should run, in backticks:
`` `npm test` exits 0 ``. The harness runs the first backticked command and reports what
happened.

Writing the outcome there instead — "PASS — I checked and it looks right" — turns the column
that was supposed to settle the question into another claim about it, which is the exact thing
the second standing order says not to accept. If a task genuinely cannot be checked by a
command, say so in plain words with **no backticks** — *reviewed by eye* — and the office reports
it as uncheckable rather
than quietly counting it as passed.

## In progress

| # | Task | Owner | VERIFY |
|---|------|-------|--------|
| 1 | ... | builder | `npm test` exits 0 |

## Queued

| # | Task | Owner | VERIFY |
|---|------|-------|--------|

## Done

| # | Task | Owner | VERIFY | Completed |
|---|------|-------|--------|-----------|
