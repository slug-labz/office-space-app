---
name: meet
description: Call the named colleagues into the meeting room, so the floor shows a real meeting. Use when the user asks for a meeting, or when something needs several employees looking at it together. Pass the names as arguments — `meet reviewer builder`.
---

# Calling a meeting

Invoking this skill **is** the meeting. There is nothing to write and nothing to announce.

## Why it is a skill and not a sentence

The office floor shows real work, and it is allowed to show only what the event stream actually
reports. *"I'll get the reviewer and the builder into the meeting room"* is **prose** — it may
be true, it may be a plan the manager abandoned in the next paragraph, and nothing downstream
can tell the difference. Prose that happens to be true is still prose, and the third standing
order has no exception for it.

Invoking a skill is a tool call, and a tool call is a fact:

```json
{ "name": "Skill", "input": { "skill": "meet", "args": "reviewer builder" } }
```

That is what the floor reads. So the rule is simple and it is the whole point of this file:

> **If you did not invoke this skill, no meeting happened.** Do not describe one.

## How to call it

Pass the names as arguments, space-separated, exactly as they appear in `.claude/agents/`:

- `meet reviewer` — one colleague.
- `meet reviewer builder tester` — several.
- `meet` — with nobody named, this is you going to the meeting room alone, which is a real
  thing to do and reads as one. Prefer naming people when you mean to bring them.

Names you pass that are not on the staff are **dropped, and reported**. A meeting with a
colleague who does not exist is not a smaller meeting; it is a mistake somebody should be told
about.

## What it does not do

- **It does not dispatch work.** A meeting is people in a room. If somebody leaves it with a
  task, that task is dispatched the ordinary way, and the dispatch is its own fact.
- **It does not summarise.** Nothing here writes to `PROGRESS.md`. If the meeting produced a
  decision worth keeping, use `record-progress` for it afterwards — deliberately, as its own
  act, because a meeting that automatically generates a record generates one whether or not
  anything was decided.
- **It does not interrupt.** Somebody mid-tool-call stays at their desk. An employee is not
  available because you called them; they are available when they are idle. A meeting that
  yanked people out of running work would be the floor lying in the other direction — showing
  a room full of people whose work is, in fact, still going.

## When not to call one

Calling a meeting to ask one person one question is worse than asking them. The office has a
cheaper way to do that and it does not move anybody: address them directly. Use this when
several people genuinely need the same context at the same time, which is rarer than it feels.
