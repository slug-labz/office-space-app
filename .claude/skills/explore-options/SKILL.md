---
name: explore-options
description: Generate genuinely different options before choosing one — several isolated attempts under different framings, then a critic that scores them and names the traps. Use before plan-together, when the shape of the answer is not obvious yet. Pass the question — `explore-options how should sessions be stored`.
---

# Exploring options

The first idea a model has is the one every later idea gets anchored to. Ask for five approaches
in one turn and you get one approach and four variations of it wearing different words — not
because the model is lazy, but because autoregression means everything after the first sentence
is conditioned on the first sentence.

This is the fix, and it is **mechanical rather than a matter of asking harder**. Adapted from
[uditakhourii/adhd](https://github.com/uditakhourii/adhd), whose framing is that premature
convergence is an architectural problem.

## The shape

```
DIVERGE   one dispatch per frame, each blind to the others
          → the branches physically cannot anchor on each other

CONVERGE  one critic reads all of them at once
          → scores, names traps, clusters by underlying approach

SEED      the survivors become the opening draft of PLAN.md
THEN      plan-together, which is where they get argued with
```

## Yes, this fans out. `plan-together` forbids that. Both are right.

Read `plan-together` and it says, in as many words, *never fan out* — an agent that cannot read
the previous critique cannot disagree with it, and disagreement is the entire feature.

**That is still true, and it is about a different activity.** These two things look alike and are
opposites:

| | reading the others is | because |
|---|---|---|
| `plan-together` | **required** | you are *arguing*, and an argument needs the previous turn |
| `explore-options` | **fatal** | you are *generating*, and a second idea that has read the first is a variation of the first |

So: generate blind, then argue in sequence. Getting these the wrong way round gives you three
first impressions and one anchored plan — the worst of both.

## Diverging

Dispatch **one employee per frame**, all in one turn, and give each one *only* its own frame. Do
not tell a branch what the others were asked. Do not summarise the earlier answers for the later
ones. Do not run them in sequence "to save tokens" — sequence is the thing being avoided.

Ask each for **two or three sketches**, not one: a frame that must produce exactly one answer
produces the safest one.

### The frames are the whole mechanism, and they belong to the field

A frame is a vantage point, not a topic. Use the ones that fit whose question this is:

**frontend** — what a stranger tries first · what this feels like at 300ms · what it looks like
when the data is empty, enormous, or broken · what somebody does by accident

**backend** — the data shape this implies · how it fails · what is irreversible · what happens at
100× · what two of these racing looks like

**tester** — how would this lie · what passes once and is still broken · what cannot be checked
by any command · what somebody would fake to make it green

**reviewer** — what will be expensive to change later · what nobody will read again · what this
makes impossible

**manager** — who is not in the room · what we are choosing not to build · what this costs on
every turn, forever

Add frames that suit the question. Five sharp ones beat fifteen generic ones, and a frame nobody
can answer from is a wasted dispatch.

## Converging

One critic pass, reading everything at once. Its job is **not** to pick a winner:

1. **Score** each sketch on how genuinely different it is, whether it can be built, and whether
   it fits what was actually asked.
2. **Name the traps.** The seductive-but-broken ones, and *why* each is seductive — a trap nobody
   explains gets proposed again next week by somebody who was not there.
3. **Cluster.** Three sketches that are the same idea in different clothes are one option, and
   saying so is most of the value.
4. **Deepen the survivors** into something concrete enough to argue with.

Then hand the survivors to `plan-together`. **Do not skip that step** — this produces options,
and options are not a plan until the people whose field it is have tried to break them.

## What to write down

Append to `projects/<name>/PLAN.md` under **Options considered**: every cluster, the traps with
their reasons, and — for the ones not taken — one line on why not.

The rejected options are the point. A plan that lists only what was chosen is indistinguishable
from a plan where nothing else was thought of, and six weeks later nobody can tell which it was.

## When not to use this

When the answer is obvious. Divergence costs a dispatch per frame and buys nothing on a question
with one sensible answer — and a critic asked to find traps in a decision that has none will
invent some.
