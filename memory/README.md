# Memory

What the office remembers, and **the one directory that is yours alone.**

Everything in here except this file is gitignored. Clone the repo and you get colleagues, not
somebody else's notes.

## The shape

One fact per file, kebab-case filename, newest thinking wins. The memory-keeper owns this
directory — see [`.claude/agents/memory-keeper.md`](../.claude/agents/memory-keeper.md) for how
it records and what it refuses to record.

```markdown
---
title: <short human title>
type: decision | fact | person | project | reference
created: YYYY-MM-DD
---

The fact itself, in a sentence or two. Why it is true, if that is not obvious.
```

## What belongs here

What is **durably true** — a decision and its reason, a constraint discovered the hard way,
where a thing lives, how somebody prefers to work. Not the conversation around it.

Ask the memory-keeper to check in on something rather than reading back through transcripts.
It reports; it does not implement.
