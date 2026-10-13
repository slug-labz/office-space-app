# The eleven pull requests, and what was actually checked

Written for whoever signs these off, so that decision is a read rather than a re-derivation.
Every verdict below is mine, from reading the diff on the branch as it stands today. Verdicts go
stale: #174 was a hold when this file was written and stopped being one within the hour, because
its author had already fixed it before ending. Re-read the branch, not this paragraph. Where
somebody else reviewed a PR, it says who and — more importantly — **what their review could and
could not see**.

**Ten say merge, one says hold** — #169, over a single ticked line. Nothing here is a request to
merge; the order and the sign-off are Vish's.

---

## Who checked what, and the shape of the gap

Eleven PRs, three authors, two reviewers.

`office-space-6c` reviewed with **no shell**: it could read files at their current state and
never a diff, never a test run, never a pull request. It asked that this be stated with its
direction rather than its size, because the direction matters:

> I reviewed code as it stands. I never once reviewed a change. Which means I am structurally
> blind to **regressions**: a fix that breaks something adjacent reads as fine to me, because the
> current code is internally consistent and I have nothing to compare it against.

That is not hypothetical. The arrow-key regression in `views/popmenu.ts` was introduced two
commits before it looked, and it did not catch it *as a regression* — it caught it because it was
asked to read that file for internal asymmetry and the fault happened to be visible in one
version. So: **everything it approved, it approved as "this code is correct on its own terms",
not as "this change is safe".**

`ade-af` reviewed and authored with a shell, and ended its session. Its three PRs (#174–#176) are
reviewed by me only.

I authored #170 and reviewed everything, which means the largest PR in the queue is reviewed by
its author. That is the weakest link and it is named here rather than left to be discovered.

---

## The merge order

Simulated with `merge-tree`/`commit-tree` — no branches touched. **Nine of ten land clean in
sequence.**

```
167 → 166 → 168 → 169 → 171 → 173 → 172 → 175 → 176 → 170
```

Only #170 conflicts, and only against branches whose conflicts are already characterised:

| file | size | against | resolution |
|---|---|---|---|
| `PLAN.md` | 2 hunks, 30 lines | #169 | both rewrite section 4b — see the note under #169 |
| `src/main/cli/eval.ts` | 1 hunk, 6 lines | #175 | keep both imports |
| `src/shared/switcher.ts` | 2 hunks, 27 lines | #173 | the three-state `meta`, with the cost part appended |
| `test/switcher.test.ts` | 2 hunks, 220 lines | #173 | **the union of both sides** |

> **Re-measured 2026-08-28**, after roughly thirty further commits on #170. The *shape* is
> unchanged — the same three branches and the same four files, seven of ten still merging clean —
> so nothing in that work created a new conflict. Two of the four grew: `src/shared/switcher.ts`
> from 22 lines to 27 and one hunk to two, and `test/switcher.test.ts` from 138 lines to 220. Both
> sides kept moving; the resolutions below are unchanged, there is just more of the test one to do.

That last one is the one to watch. Resolving source is checked by the tests; resolving *tests* is
checked by nothing, so taking one side there would look correct and silently drop coverage.

This map describes today's branch states and stops being true the moment anything lands.

### The merged result was built and run, not only merged

*Merges clean* is not *works*, so the whole thing was assembled in a throwaway worktree and run.

    nine merged (167 166 168 169 171 173 172 175 176)   1523 pass, 0 fail, typecheck clean
    all ten, four conflicts resolved                    1969 pass, 0 fail, typecheck clean

Two things worth knowing from that. The **one spurious failure every branch in this queue
reports is gone** the moment #167 lands — it was that scanner, and nothing else. And the four
resolutions are below, because the point of doing this was so nobody has to derive them twice.

The simulated merge is the local branch `zz-merge-check`, never pushed. It is the evidence for
the two numbers above and can be deleted once they have been believed or re-run.

**One resolution was wrong on the first attempt, in the way this rule exists to prevent.** Taking
the union of `test/switcher.test.ts` cut the last test of the first side before its closing `})`,
because the conflict boundary fell inside it. `tsc` caught it — `'}' expected` — which is the
whole argument for running the merged tree rather than reading the merge.

### The four resolutions

**`src/main/cli/eval.ts`** — keep both imports:

```ts
import { tally, verdict } from '../../shared/eval.js'
import { discoverWorkspace, findManager } from '../workspace.js'
```

**`src/shared/switcher.ts`** — the three states, with #173's cost as a second part. A conversation
nothing has happened in has no cost to report either, so it says nothing rather than joining an
empty half to "no cost recorded" with a separator in between:

```ts
meta: [
  session.running ? 'working now' : session.updatedAt === null ? null : ago(session.updatedAt, now),
  session.updatedAt === null && session.costUsd === null ? null : costLabel(session.costUsd),
]
  .filter((part) => part !== null)
  .join(' · '),
```

**`test/switcher.test.ts`** — the union of both sides, and mind the boundary. #173 appends the
cost tests, #170 appends the three-state tests, and neither replaces the other.

**`PLAN.md`** — take #169's rewrite, and correct the one ticked line it gets wrong. That is the
same correction #169 needs on its own, so doing it here rather than there is a choice about where
the fix lives, not whether it happens.

---

## The PRs

### #166 — A check nobody could ask to run · **merge**

Twelve lines: `workflow_dispatch` on the CI workflow. The file sat `disabled_manually` for 257
commits while staying in the tree looking like cover. Turning it back on does not produce a run —
`push` and `pull_request` both need somebody to have work in hand — so this decouples *is the
check alive* from *did somebody happen to push*. Smallest diff in the queue and the one that
makes the rest checkable.

### #167 — A scanner that only worked at one address · **merge first**

Both source scanners filtered on `fileName.includes('/office-space/src/')` — the repository's
*directory name*, written into the walk. That holds in a clone called `office-space` and in
nothing else, and the case that matters is a **git worktree**: `.claude/worktrees/<name>/src/…`
is never under `/office-space/src/`, so every file was skipped and the scan reported a clean tree
over zero files. This repository runs most of its parallel work in worktrees.

Anchored to the script's own location via `import.meta.url` rather than `resolve('.')`, and the
diff says why: the working directory would have swapped one ambient assumption for another,
failing in the same direction as the bug it replaced.

**Merge this one first.** Until it lands, every branch in this queue shows one spurious test
failure, and a false red trains people to ignore red.

### #168 — Our dev harness stopped shipping to strangers · **merge**

`.claude/launch.json` — our dev-server config — was being packaged into strangers' workspaces.
The exclusion is one line; the rest of the PR is the half that makes it safe.

`dist/shipped-hashes.json` is built from `git ls-files .claude`, and its comment claimed to apply
*"the same exclusions `package.json`'s extraResources filter names"*. It did not: it **agreed with
them by accident**, because every previously-excluded path was gitignored and git never listed
one. `launch.json` is the first *tracked* file the filter excludes, and the coincidence ended
there — leaving the manifest naming a file the package does not contain, which `reconcile.ts`
reads and reports to the user on first run as a file the office could not bring forward. A
packaging exclusion would have shipped as a visible first-run failure.

The exclusions are now read from `package.json` rather than restated. Found by its own author
while checking a claim of mine that turned out to be wrong.

### #169 — The plan described a repo that had moved on · **hold**

Most of it is right and needed: `PLAN.md` had been stale for eight days.

One line is not. It ticks

> `- [x] floor-view: depth sort by \`x + y + z\` rather than \`y\` — \`depthOf\` and \`depthAt\`.`

and cites those two functions as the evidence. `depthAt(y, z)` is
`y + Math.min(z, 0.999) * 0.999` — **no `x`** — and its own doc comment says *"Only `y` matters
now"* and *"(Isometric needed `x + y`; that is the other thing rotating the floor costs you.)"*
The camera was removed deliberately in `01e5a17`. The code is right and the tick is wrong, in the
file whose entire job is being true about today.

Untick that line, or reword it to say the sort is by `y` because the rotation was removed, and
this merges. It also carries the `PLAN.md` conflict with #170, which is the same section.

### #170 — Three dead-feeling controls, and much else · **reviewed by its author**

95 commits, 108 files. Too large, and that is my fault rather than a defence: it began as three
dead controls and absorbed everything found by running the app for a day.

Landing today: the session registry refusing to overwrite a registry that appeared while it
believed there was none; the office floor losing its right-hand wall to one-sided clipping; a
project row reading "no conversations yet" above the conversation you were sitting in, and then
"1 conversation · now" that re-minted itself every snapshot; a renderer with **no** error handler
and **no** rejection handler; an approval receipt that recorded a decision before the write that
might fail; a conversation's recorded cost replaced on resume by what that run spent; two
status-bar menus the keyboard could not reach; every panel opened from ⌘K closing onto `<body>`;
the campus printing its own footnote on top of an office name.

`docs/retracted.md` lists what this branch claimed and later took back, with what to do if you
read the earlier version.

If it should be split, say so and I will split it. Splitting it now costs a rebase across a queue
nobody has approved and would leave *more* pull requests rather than fewer, which is why it has
not been done speculatively.

What has been done instead is the cheaper half: **[reading-170.md](reading-170.md) gives it an
order somebody can review in.** Four passes carry most of the risk — things the office said that
were not true, data it could lose, a window with no error handling at all, and the keyboard — and
the remaining seventy commits are grouped by subject with what to be suspicious of in each. The
seams in that document are where it would come apart if you do want it split; they are real seams
rather than an arbitrary carve.

### #171 — A field the renderer never reads · **merge**

A compiler-level check that every property `src/shared/ipc.ts` declares is read by somebody. Not
a grep, and the diff explains why a grep would have passed on the exact bug that motivated it:
`costUsd` is declared on three interfaces and `app.ts` reads `state.costUsd` — a different type.
Name matching sees a reader. This resolves each access to the **symbol** it lands on.

`#173` depends on this and retargets to `dev` automatically once it lands.

### #172 — Every prop reports, or says it cannot · **merge**

The plant, the monitor and the notice board took constants while `ProjectInfo` and `TaskReport`
already carried the readings. The design call is the part worth reading: every reading is
nullable, and `null` means *nothing measured this* rather than zero — because `health: 1` is not
a neutral default, it is the office asserting a project it never looked at is thriving.

### #173 — A number computed and thrown away · **merge after #171**

Puts the per-conversation cost on the switcher's rows. The work is right and the tests are the
strongest in that file — the zero-versus-unrecorded pair, and a source-level check that the
header uses the shared formatter, **labelled as weaker than rendering it**.

Reviewing it is what found that resuming a conversation replaced its recorded cost with what that
run spent, which is fixed in #170. That is the argument for the PR: the number was wrong for as
long as nothing displayed it.

Conflicts with #170 on `sessionRows`; see the map.

### #174 — Sideways the trim takes wall, upwards it took a picture frame · **merge into #170**

Targets my branch rather than `dev`, correctly: it measures a clip that only exists there. It
enumerates every plan across eight roster sizes, confirms nothing is ever in the outermost
column, and found that upwards the claim failed — 7 floor pixels of headroom against a trim
reaching 12.44, in a band of window heights reachable by dragging a corner.

**This was flagged as a hold and is not one.** An earlier reading of this file said one assertion
now meant the opposite of what it said, because the fix in #170 moved *where* the trim lands
rather than how big it is, leaving `trim > headroom` still true. Its author rebased and rewrote
that test before ending its session — the title is past tense now — and the rewrite is better than
a reworded assertion would have been: it asserts the **placement**, beside the measurements that
make the placement load-bearing, and keeps `trim > headroom` with a message saying that if it ever
fails, centring vertically would be safe again and the test should say so.

It also reads `place-items` from the stylesheet anchored to a line start, because the block now
*discusses* `place-items: center` in a comment explaining why that was wrong — and matching the
prose as though it were the rule is a mistake it made on its own first run and then wrote down.

Verified against `every-button-in-the-app` as it stands: merges clean, four tests, all passing.

### #175 — A harness that graded its own work · **merge**

`cli/eval.ts` decided `failed` without the roster, then printed `!! <name> is not on this roster`
beside a scenario it had already called `ok`, and exited zero. Second standing order, inside the
machinery that enforces the second standing order.

The verdict is extracted into a new shared module beside the harness, with 14 tests. (Its path
is not named here: `repo-health.test.ts` checks that every repo path the docs point at exists,
and a document about pull requests legitimately talks about files a pull request *adds*. Naming
it would fail that check on this branch for the right reason, so it is described instead.) `office-space-6c` specified a
property to check for regression — *the printed verdict and the exit code must never disagree* —
and the fix satisfies it **by construction**: one `verdict()` call produces one `failed`, read by
the label, the tally and `process.exitCode`. A test asserting they agree would compare a boolean
to itself.

Residual, deferred deliberately: a second predicate reappearing in `main()` is a scan, not a unit
test, and belongs in one batch against one tree after merge.

### #176 — What the panels say against what is true · **merge**

On a fresh workspace the privacy panel said *"Office Space is reaching 2 hosts of its own"*
before it had reached any — `active: !dictationReady`, so the rows were live **because nothing
had been downloaded**. Both badged live beside their own caption saying "one download, the first
time you press the microphone".

The finding under the finding is the better one: `egressLede` has three states and its docstring
says two *"would force one of them to lie"* — and the middle one, written for a fresh install,
**could never render on one**, because two rows always claimed live. A careful sentence, correct,
and unreachable from the workspace it was written for.

Moved to `privacy.ts` rather than patched in place, because no test can load `main.ts`, which is
why an inverted boolean sat there unnoticed.

---

## Three decisions that are only Vish's

> **Re-checked against the code on 2026-08-28.** Two of the three have moved since this was
> written, and both moved smaller. Nothing below is decided here — the point of re-reading them
> was that a decision carried on a stale description is harder to make than it needs to be.
>
> - **#1 stood exactly as described, and its first half is now built** — see the note under the
>   item. At that re-check `approval-gate.mjs` called `watching(dir)` once, at line 147, before the
>   loop, and the loop from line 181 checked only whether the answer file had appeared. Nothing
>   re-checked the watcher across a wait of up to 240 seconds. It does now.
> - **#2 is now half answered.** *"Whether it surfaces has never been ruled on"* — it does, inside
>   the app: `main.ts` turns a non-zero `missedCount()` into a workspace problem reading *"N
>   approvals were asked for and nobody answered them in time, so those tool calls were refused"*,
>   and handles the unreadable case separately. What is left of #2 is only the half its own title
>   asks — **outside** the app window.
> - **#3 is mostly already done.** `.claude/settings.json` allows `Bash(git log:*)`,
>   `Bash(git show:*)` and `Bash(git diff:*)` today, which is the whole of what this item said
>   would *"convert it from reads files to reviews changes"*. Only `Bash(git archive:*)` and
>   `Bash(npx tsx --test:*)` are still absent, and neither is needed to review a change.

**1. The approval gate denies when the app is open and unattended.** `watching()` proves a
*process* is polling, not that a *person* will answer — so the four-minute hang it was written to
prevent returns whenever the app is open and nobody is home, which is the normal state. Closing
Office Space fixes it; leaving it open is what breaks it. Two fixes are identified and both turn a
deny into a defer: re-check `watching()` **during** the wait rather than only before it, and treat
*app open, nobody home* as *nobody watching*. Neither has been made, because the session that
found them is the session they would unblock.

> **2026-08-31 — the first fix is made. The second is not, and here is the argument against it.**
>
> `watching()` is now asked on every poll of the wait as well as before it, and an office that has
> gone gets a **deferral**, not a denial: the request is deleted, nothing is printed, and Claude
> Code's own permission flow takes the question. Measured on the same 20-second window both ways,
> with the office's beat stopped after 3 seconds — before, it held the full 20 and denied; after,
> it hands back in about 9, which is the five-second freshness window plus the new grace. A clean
> quit, which removes the marker rather than letting it age, is noticed in about 1.3 seconds.
> Nine tests in `test/approval-gate.test.ts` drive the real hook as a real process; the timeout
> denial and its `missed/` mark are unchanged, and are two of them.
>
> The grace is the one thing here nobody asked for. A stale marker has to stay stale for three of
> the app's beats before it is believed, because otherwise a laptop waking from sleep — marker
> minutes old, office perfectly alive, this hook polling four times faster than the app beats —
> would cancel the approval the person came back to answer. It is counted in polls rather than in
> clock time, since a clock jump is the thing being survived.
>
> **The second fix should not be built as described**, and the reason is arithmetic rather than
> taste. For a presence signal to change any outcome, its idle threshold has to fire inside the
> four-minute wait — and everything inside that wait is time a person could still walk back and
> answer in, which is the entire reason the wait is four minutes long. So it cannot make the
> office answer; it can only make it give up earlier, on exactly the person who was coming back.
> Under `--print`, which is how every session here runs, that deferral is a refusal.
>
> The signals available are worse than the threshold. `powerMonitor.getSystemIdleTime()` measures
> seconds since the machine last saw input, so *reading the approval card and thinking about it*
> reads as nobody home. Window focus measures whether the office is in front, which this very
> document establishes is not the normal state. And whichever were chosen, liveness would then
> track mouse movement at the marker's five-second granularity: two identical commands seconds
> apart, one held for a person and one refused, with nothing on screen saying why.
>
> What makes *open and unattended* bad is that nobody knows a request is waiting. That is #2, and
> it is still open. This is the honest boundary between them: the fix made here fires only when
> the answer had already become impossible; the one refused would fire while it was still possible
> and merely not immediate.

**2. Should a pending approval make itself noticed outside the app window?** There are four ways
to reach an approval that will never be answered — buttons clipped off-screen (fixed), buttons
below the fold (measured, clean), the app quitting mid-wait, and the app open with nobody
watching. The last two are the same design question underneath: a badge, a notification, anything
persistent, and whether an expired request leaves a mark. `approvals/missed/` and `missedCount()`
exist, so the data is there; whether it surfaces has never been ruled on. From inside the app,
*careful* and *stuck* look identical.

**3. Whether to unblock a read-only reviewer.** `office-space-6c` reviewed all day without a
shell. An allowlist of `Bash(git log:*)`, `Bash(git show:*)`, `Bash(git diff:*)`,
`Bash(git archive:*)` and `Bash(npx tsx --test:*)` would convert it from *reads files* to
*reviews changes* — the half that was missing — and grants no ability to change anything. It
raised this as an option with its cost stated and explicitly did not ask for it.

## Designed and not built — now built

Promotion-at-a-threshold for renderer faults was the last item on this list and is done
(`404e023`): one occurrence goes to the transcript as an event, the same fault twice also raises
a workspace problem, once, held for the life of the window.

What decided it was not the design, which had been agreed for hours. It was that the approval
gate finding established the normal state of this app as **open with nobody watching** — and in
that state the transcript scrolls past while the status bar is what is still there when somebody
comes back. The half nobody had specified turned up on measuring it: the first version crossed
the tone to amber and the panel that tone points at said nothing was wrong, which is a colour
with no words.

Nothing else is outstanding on this branch.
