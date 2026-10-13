---
name: plan-together
description: Argue a plan out with the people whose field it is, one at a time, before anybody builds. Use in planning mode, once the vision is gathered. Pass the colleagues who should be in the room — `plan-together frontend backend tester`.
---

# Planning together

A plan one person wrote and everybody agreed to is a plan nobody checked. This is how a plan
gets **disagreed with** before it costs anything.

## The shape

```
meet frontend backend tester          the room fills — a real event, and the floor draws it
write the opening draft               projects/<name>/PLAN.md
  round 1  frontend → backend → tester    each reads what came before, then appends
  round 2  …                              until a full round adds nothing new
you veto, or you sign                 FROZEN. Only then does work get divided.
```

## One at a time. Never fan out.

You will be tempted to dispatch all three at once — it is three times faster and it is wrong.

**An agent that cannot read the previous critique cannot disagree with it**, and disagreement is
the entire feature. Three parallel reviews of the same draft give you three first impressions;
three sequential ones give you an argument, where the tester gets to say *"the thing backend just
proposed cannot be verified by any command I can write."* That sentence is the whole value and it
is unreachable in parallel.

It also draws. Four agents thinking at once is four spinners. **One named person speaking at a
time, in a room, over a document that grows** is the only animation this office has that means
something.

## The document is the channel

Employees cannot talk to each other — the first standing order, and also just true of the
runtime. So they talk **through the file**, the way two machines on separate branches talk
through a shared document.

That is not a workaround. It is the reason this works: an argument conducted in a file is one
somebody can read afterwards and check.

Give every dispatch the path and nothing pasted:

```
OBJECTIVE  — read projects/<name>/PLAN.md including every critique already appended,
             then append yours as `### <your name> · round N`
OUTPUT     — that section, in that file. Nothing else in the file changes.
TOOLS      — Read, Edit
BOUNDARIES — argue only your own field. Do not rewrite anybody else's section. Do not
             implement anything. End with `TURN: <the next name>`.
VERIFY     — `grep -c '### <your name> · round N' projects/<name>/PLAN.md` returns 1
```

## What each of them is for

Ask them to argue their own field and nothing else. A frontend agent's opinion on the database
is a first impression; the backend agent's is expertise.

| Who | The question they answer |
|---|---|
| `frontend` | Can this be built as a surface people can actually use? What does it cost to draw? |
| `backend` | Do the data and the contracts hold? What breaks under real volume or a partial failure? |
| `tester` | **Is "done looks like" checkable at all?** Which line is a hope wearing a checkbox? |

**The tester is the most valuable seat in the room and the easiest to leave empty.** `/plan` says
every outcome has to be checkable by a command; the tester is the only one who will tell you
which of yours is not, and they will tell you now rather than after somebody builds it.

## When to stop

**When a full round adds no new objection.** Not after three rounds — a fixed count manufactures
disagreement in the last one, and everybody can tell.

Cap it at **four rounds**. If it is still moving after four, the plan is too big to agree on and
the honest move is to split it, not to keep going.

## You sign it

Everyone agreeing is the ordinary outcome, not the rule. **You hold the veto**, and you should
use it when the room converges on something you think is wrong — a consensus you disagreed with
and approved anyway is worse than a decision you made alone, because it has more names on it.

When you sign, mark it:

```
PLAN FROZEN: 2026-08-20 — agreed by frontend, backend, tester. Manager signed.
```

**Do not divide work until that line exists.** Dispatching against an unfrozen plan is how you
get three people building against three different readings of the same paragraph.

## What this skill does not do

- **It does not build anything.** Not one line. The plan is the output.
- **It does not enforce the turns.** It cannot — you run them. What is enforceable is that the
  argument is *visible*: every round is in the file, signed by name, and a plan with no critique
  sections in it is a plan nobody argued with, which anybody can see at a glance.
- **It does not summarise the argument away.** The rounds stay in the file underneath the plan.
  They are the record of how it was reached, and the first thing worth reading when somebody
  later asks *"why is it like this?"*
