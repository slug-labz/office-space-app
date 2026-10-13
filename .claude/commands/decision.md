---
description: Record a decision in memory/ with the reason it went this way rather than the other way. Use the moment a choice is made that somebody would otherwise have to reconstruct from a transcript.
argument-hint: "<what was decided, and why>"
---

# Record the decision

Write down: `$ARGUMENTS`

Decisions are the thing transcripts are worst at keeping. The reasoning happens across twenty
messages, the conclusion lands in one, and six weeks later somebody re-opens the question
because the only surviving artifact is the code, which says what was decided and never why.

## Where it goes

One file in `memory/`, kebab-case, named for the decision rather than the date —
`session-per-project.md`, not `2026-08-19-notes.md`. Newest thinking wins: if a file already
covers this ground, edit it rather than adding a near-duplicate beside it.

```markdown
---
title: Sessions are per project, not per agent
type: decision
created: 2026-08-19
---

Each project tab owns one session, and every agent in that project runs inside it.

The alternative was a session per agent, which reads better on paper and loses the shared
context that makes the manager's verification possible — it would have to re-read everything
an employee did in order to check it.
```

## What makes it worth keeping

**The alternative you rejected, and why.** A decision recorded without its discarded option is
a preference; with it, it is an argument somebody can re-examine when the constraints change.

Write the date absolutely — `2026-08-19`, never "today". These files outlive the day.

## What does not belong

- Anything still being argued. Record it when it is settled.
- The conversation around the decision. The decision, and its reason.
- Anything about a person that they did not say you could keep.

If the decision only concerns the project in hand, and not the office as a whole, put it in
that project's `PROGRESS.md` instead — same content, same dated shape, next to the work it
governs.
