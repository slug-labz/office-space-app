---
name: record-progress
description: Append to a project's PROGRESS.md — what happened, when, and what the evidence was. Use at the end of a piece of work, or whenever a decision is made that somebody would otherwise have to reconstruct from a transcript.
---

# Recording progress

`projects/<name>/PROGRESS.md` is **append-only**. Newest entries at the bottom. Never rewrite
history — a progress log that gets tidied is a progress log nobody can trust, and the reason to
keep one is that transcripts are long and memory is short.

## The shape

```markdown
## 2026-08-19 — builder

Capped the token refresh retry at five attempts and made an expired token report as a failure
rather than a successful run.

Evidence: `npm test` — 318 passing, including two new cases for the expiry path.
```

Three things, in this order: **who and when**, **what actually happened**, **what the evidence
was**.

## What belongs in it

What a person would otherwise have to reconstruct:

- A decision, and why it went that way rather than the other way.
- Something that turned out to be true and was not obvious.
- Work finishing, with the check that says so.
- Work **not** finishing, and what blocked it. This is the entry people skip and the one most
  worth having.

## What does not

- Narration of the work as it happens. That is the transcript's job.
- Anything you did not do. If a check was skipped, the entry says it was skipped.
- Relative dates. `2026-08-19`, never "yesterday" — the log outlives the day it was written.

## Evidence

An entry that says work is done and does not say how that was established is a claim, and this
office does not accept claims. Paste the command and the real result:

- Good: ``Evidence: `npm run typecheck` — clean on both configs.``
- Good: ``Evidence: none. The check could not run because Bash was refused.``
- Not good: "Verified and working."

The second of those is a perfectly good entry. Saying you could not establish something is
information. Saying you established it when you did not is the one thing that makes the whole
log worthless.
