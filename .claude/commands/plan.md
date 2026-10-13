---
description: Turn an idea into a project PLAN.md whose "Done looks like" is a list of checkable outcomes rather than intentions. Use when starting a project, or when the plan no longer matches what is being built.
argument-hint: "<what we are building, in a sentence>"
---

# Write the plan

Write or revise `PLAN.md` for the current project, for: `$ARGUMENTS`

`PLAN.md` is the one convention file with nothing else pointing at it — `PROGRESS.md` has the
`record-progress` skill and `TASKS.md` has `write-a-task`, and a project whose plan was written
once and never revisited is how the other two end up describing work nobody agreed to.

## The sections, and the only difficult one

Follow `projects/_TEMPLATE/PLAN.md`. Five sections, and four of them are easy.

**"Done looks like" is the hard one.** Every line has to be something that can be checked, by a
command where possible:

- Good: `npm test` covers the retry path, and passes.
- Good: opening the app with no `claude` on PATH shows the message naming where it looked.
- Not good: "authentication is robust".
- Not good: "the UI feels responsive".

If an outcome cannot be checked, it is a hope. Either sharpen it until it can be, or move it to
**Why** — which is where motivation belongs and where nobody will later mistake it for a
deliverable.

## Out of scope earns its section

Write down what this project is deliberately not doing. It is the cheapest section to write and
the one that saves the most, because drift is easier to refuse when somebody already refused it
in writing.

## Revising rather than starting again

If `PLAN.md` exists, edit it in place. Say in your report which outcomes changed and why —
a plan quietly rewritten to match what got built is a plan that can no longer disagree with
anything, and its whole value is that it can.

Ask before rewriting a plan that clearly still holds. Adding to it needs no permission.
