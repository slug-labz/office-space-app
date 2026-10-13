# #170, in an order somebody can review

102 commits and 108 files, reviewed by its author. That is the weakest link in the queue and this
is the cheapest thing that helps: not a smaller branch, but a **reading order**, so a reviewer can
take it in passes that each have a subject rather than as one lump.

Splitting it into separate pull requests would cost a rebase across a queue nobody has approved
and would leave *more* PRs, not fewer. If you want it split anyway, say so — the seams below are
where it would come apart, and they are real seams rather than an arbitrary carve.

**Reviewing four passes gets you most of the risk.** They are marked ★. Everything else is
tests aimed at code that already worked, and its worst failure mode is a test that proves nothing
— which the mutation runs in each commit message are the evidence against.

---

## ★ Pass 1 — Things the office said that were not true (13 commits)

The highest-value pass. Every one is a surface stating something false, found by running the app,
and every one is small.

```
2f056ea  the unfinished-work count says what it actually counted
3491990  one unreadable sprite pack emptied the whole office, silently
c123b19  a misconfigured employee no longer reads as an incompetent one
d5bbf00  a subagents directory nobody could open is not an employee who did nothing
e1360aa  staff that could not be read were reported as staff who do not exist
9533c0c  an unreadable projects directory told you your work was gone
3528862  "0 skills" from a shelf nothing could open
1971bf2  the campus draws what it can, and says what it could not
6f83dbb  Two things the office said that were not true, both found by looking at it
966be6f  "1 conversation · now", for as long as it sat there doing nothing
ac104fd  "620 projects · 480 drawn" printed on top of "project 477"
0c23452  The eval judged delegation against a staff block with no manager in it
59af48b  The one interaction the product rests on, finally exercised   (clean result)
```

The shape they share is the fourth standing order: something unreadable rendered as something
absent. If you read one, read `9533c0c` — an unreadable `projects/` directory told the user their
work was gone.

## ★ Pass 2 — Data the office could lose (5 commits)

The only commits here that can destroy something a user cannot get back. Small, and worth the
most careful reading in the branch.

```
19c157b  a registry that would not parse was overwritten with nothing
c37abc8  The "there is nothing to lose" verdict can expire while you hold it
7beffc7  The receipt said you allowed it. Nothing had been written down
2eacdfb  Resuming a conversation replaced its cost with what this run spent
ad87360  an approval nobody answered now leaves a mark
```

`c37abc8` is the subtlest: the verdict that authorises the first write is held for the life of
the process, and there is no single-instance lock, so two copies on one fresh workspace both
believe they may create.

## ★ Pass 3 — The window had no error handling at all (6 commits)

```
88b9116  The renderer had no error handler and no rejection handler
7beffc7  (also pass 2 — the approval receipt)
3328f1a  A notice ended the turn, and one caller in eleven meant it
404e023  Twice is not an event, and the strip is where you look when you were away
2290ff0  the permission mode you choose was never the one the gate applied
eca7f00  a click that says allow could be read as a denial
```

Start at `88b9116`. Not one line under `src/renderer/` listened for `error` or
`unhandledrejection`, so every fault in this list was silent before it.

## ★ Pass 4 — The keyboard (7 commits)

Each is small and the group is coherent. `993b46c` is the one with a cause rather than a symptom:
`order: -1` moves a column visually and leaves it where it was in the tab order.

```
fd6d419  The scrim stopped the mouse; nothing stopped Tab
ab63ee6  Focus lands in the panel that opened, and the sweep checks you can press it
9050a0f  the whole window is reachable by keyboard, and every stop says what it is
c6cbdba  Two menus in the status bar that the keyboard could not reach
6a87fe7  Every panel opened from ⌘K closed onto the floor
bdb499a  The one panel that opened without taking the keyboard
993b46c  The column was moved with CSS, so the keyboard never heard about it
```

---

## The rest, by subject

**Coverage, aimed rather than sprayed** (~30 commits, `abe9b57` … `2576228`). Each names what it
aimed at and why that surface was worth it. They add tests and change little else; the risk is a
test that proves nothing, and each commit message carries its mutation run.

**The floor's own behaviour** (`2535afd`, `51ac49f`, `532f53a`, `0fb87df`, `cb5d735`, `1971bf2`,
`44a988e`, `fc2da2b`). The coffee break that never fired, the frame loop that drifted, the campus
at scale.

**The plan and the docs** (`f3c039a`, `056ab27`, `9ee5e9f`, `8b93053`, `da84a34`, `9fde1e0`,
`b7bbfd0`, `16262c1`, `d20b11c`). Reconciling `PLAN.md`, the retraction register, the queue
record, and the harness that never worked the way it told you to open it.

**Tooling and scanners** (`7675121`, `10091fb`, `79da9e2`, `b91d3da`, `8f5275a`, `412b07c`). The
bridge check, the two censuses, and three fixes to checks that were passing for the wrong reason.

---

## What to be suspicious of

**Its author reviewed it.** The one measurement of what that costs is inside the branch: the
arrow-key regression in `320267f` was introduced by `c6cbdba` two commits earlier, on the caller
I had named to the reviewer as the one to check, and naming it was all the attention it got.

**`docs/retracted.md`** lists six claims this branch made and later took back. If a commit message
sounds authoritative about something in there, the register is the later word.

**The tests are the argument.** 1926 pass, and every non-trivial commit says which mutants it
killed. Where a mutant survived — the campus note row — the commit says so and the test asserts
the premise instead. That is the pattern to check if you check nothing else: a commit claiming a
guard should say what it fails on.
