# Claims this branch made and later took back

Commit messages are immutable and this branch is long. A reader working forward through
`git log` meets the wrong version of a thing first, believes it, and nothing downstream points
forward to say it stopped being true. Everything below is a claim made in a commit message or a
source comment on `every-button-in-the-app` that a later commit superseded, with what replaced it.

This is not an errata list for style. It is only claims that would **change what somebody does**
if they read the earlier version and acted on it.

---

## The floor's overflow is trimmed evenly

**Said in `6f83dbb`**, and in `styles.css` and `projection.ts` before it: the 8% a floor is
allowed to overflow comes off "the outermost ring of boundary wall, the least informative thing
on the floor", so splitting it evenly across all four sides is right.

**Taken back in `ce1f7a4`.** Sideways it holds — `ade-af` enumerated every plan across eight
roster sizes and nothing is ever in the outermost column. Upwards it does not: the back wall
reserves 28 floor pixels and the tallest wall prop draws 21 into them, so an even split takes up
to 12.44 off a margin of 7 and what goes is the top of a picture frame. The bottom row is empty
on every plan — 22 pixels — so the vertical overflow goes there and only the horizontal is split.

**If you read the first version and are choosing where to put a wall prop:** there are 7 floor
pixels above the tallest one today, not 12, and the trim no longer lands there at all.

---

## `SessionInfo.updatedAt` is when the conversation was last active

**Said implicitly by the type, `string`, until `966be6f`.** It was filled in with
`new Date().toISOString()` as a default parameter for any conversation with no registry record —
so the value was the moment the payload was built, and a fresh conversation reported "now" on
every snapshot forever. Two `describe()` calls a second and a half apart came back a second and a
half apart on a workspace nobody had touched.

**Now `string | null`**, and `null` means nothing has happened in it. `describeSession` has **no
default parameters at all**, because a default is exactly how a minted value comes back.

**If you are adding a caller:** you have to say `null`. That is not an oversight in the signature.

---

## `activeElement === document.body` means focus fell through

**Said in `bdb499a`**, reasoning that `body` is reported either when nothing ever claimed focus or
when the focused element was removed — both of which want the keyboard aimed back into the panel.

**Taken back in `320267f`.** There is a third cause and it is the most ordinary one: clicking on
anything non-focusable — a heading, a panel background, a plain `div` — leaves `activeElement` on
`body`. The first two want the aim and the third is theft, and the DOM cannot tell them apart
after the fact. The difference is now recorded while it happens: any press during the fetch means
the person is somewhere of their own choosing.

**If you are writing another focus guard:** `body` is not a signal on its own. `office-space-6c`.

---

## The shared pop menu behaves like the switcher's `+` menu

**Said in `c6cbdba`**, extracting one implementation to replace one complete copy and two
incomplete ones.

**Qualified in `320267f`.** The `+` menu's *arrow-key* behaviour was applied to the dials, which
hold controls rather than `.popmenu__item`s — and `preventDefault()` ran before the indexing, so
every arrow was prevented and then discarded. A `<select>` or a range input has the arrows as its
native keyboard, so the shared menu was eating the keystroke that operates the control.

**If you add a fourth caller:** arrows are handled only where there is a list to walk. Escape
works everywhere, and that ordering is load-bearing.

---

## The campus reserves its note-row so the note fits under the ceiling

**Said in `ac104fd`**, of the `- NOTE_ROW` subtracted from `fitCampus`'s row budget.

**Corrected in `0c23452`, in the same commit series.** It is belt and the belt is slack.
`fitCampus` measures a row as `card.height + NAME_ROW + GAP` while `campusSize` measures to
`y1 + NAME_ROW`, so every trimmed campus already ends with 16 pixels to spare and the note is 14.
Removing the subtraction changes no answer today — mutation-tested twice, including across a
1200-pixel sweep chosen to straddle every row boundary.

It is kept, and `campus-has-a-ceiling.test.ts` asserts `GAP >= NOTE_ROW` so that the day somebody
shrinks `GAP` is the day it starts mattering.

**If you are trimming this as dead code:** read the assertion first. `office-space-6c`.

---

## `.claude/launch.json` reaches a stranger's workspace by two paths

**Said by me to `ade-af`**, of #168 excluding it from the package while the seeding path still
copied it.

**Corrected by `ade-af`, and they were right.** `TEMPLATE_ROOT` is
`app.isPackaged ? join(process.resourcesPath, 'app') : APP_ROOT`, so a packaged app seeds from
what `extraResources` produced and #168 closes the path that reaches a user. What is reproducible
is the dev branch of that ternary — a clone pointed at a foreign `OFFICE_WORKSPACE`, which is
what a harness does and not what anybody ships. **One path, closed.**

---

## The `unused-types` red is environmental

**Claimed** by the review session, across roughly nineteen exchanges and in a handover
recommendation: that `test/unused-types.test.ts` fails in any checkout that is not a real git
repository, and that its red was therefore an artefact of reviewing from `git archive` tarballs.

**True:** it does not shell out to git at all. Both scanners filtered on the repository's
directory name — `file.fileName.includes('/office-space/src/')` — which no worktree path
contains, so the walk ran over nothing and the floor guard fired. Found by `ade-af`, fixed in
#167.

**Why it mattered more than being wrong:** `npm test` had never once been green in a worktree,
which is the checkout shape this project uses for most of its parallel work. That defect sat in
the open all day with an explanation stapled to it, and **an explained red stops being looked
at** — which makes a confident wrong diagnosis worse than an unexplained failure.

**The mechanism, which is the transferable part:** the test was run against a clean `dev`
extraction, failed identically, and that was read as *my sandbox, not their tree*. The
observation was consistent with **both** hypotheses — *not a git repository* and *not at the
expected path* — and the case that separates them was never run. A worktree is a real git
repository at an unexpected path; one run there discriminates, and `ade-af` did exactly that.

**If you read the earlier version:** treat any claim that a failure is "environmental" as
unverified unless it names the mechanism *and* the observation that rules out the alternatives.
Same observation, two hypotheses, no control.

---

## The campus regime where the cap matters

**Claimed:** that the one regime in which capping the `.stage` grid track differs from leaving it
`none` is a campus canvas *smaller* than the stage, and that this was the case worth measuring
because it is what a new user sees first.

**True:** measured at 224×188 in an 848×663 stage, the track resolves to the container rather
than to the canvas, `place-items` applies identically, and cap versus `none` makes no difference
at all. The regime nominated as decisive is the one regime where the two cannot differ.

**Cost:** a measurement rather than a defect — refuted before it changed anything.

**The shape:** reasoned from how a grid `auto` track was expected to resolve, and stated as a
case to check rather than as a guess about CSS that had not been read. The mistake was not the
expectation; it was the register.

Both entries above are `office-space-6c`'s, written by it rather than about it.

---

## What every entry here has in common

> Every entry above was stated as a fact and was not one. That is the only thing they have in
> common — not the subject, not the author, not whether the author had a shell.
>
> The failures here came from an **unlabelled claim**. Every good outcome in this work carried its
> mode — *this is a hypothesis, and here is the test that settles it* — and every bad one was
> stated flat, in the register of a measurement. Running or not running never predicted which
> column an assertion landed in. The label did.
>
> Two entries show it exactly: *`activeElement` has two causes*, and *the unused-types red needs a
> git repository*. Both were mechanisms, offered as observations, by authors who could have
> checked in under a minute and did not — because neither noticed they were reasoning rather than
> reporting.
>
> So what this register asks for is not more care. Care is what failed, on both sides, repeatedly.
> It is that a claim should carry how it was arrived at, inside the sentence, so a reader can tell
> an inference from a measurement without re-deriving it — and so that the author, having to write
> the label, is made to notice which one they are making. **The label's first reader is the person
> writing it.**

— `office-space-6c`

---

## Who reviewed this

Eleven pull requests, reviewed by their authors and by one reviewer who could read files but
never a diff, never a test run, and never a pull request. Two people with half the tools each.
That is not a disclaimer; it is the answer to the first question anybody sensible asks.
