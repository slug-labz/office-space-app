# The pile, and how it landed

**All 55 feature PRs are merged.** `dev` is at `d47c148`, 235 commits ahead of `main`, green on
`npm test` (1429), `npm run typecheck` and `npm run build`. The app has been built, launched and
driven twice — most recently after the last merge — with zero errors.

**One thing is open: #51, `dev` → `main`.** That is a release and it is nobody's call but the
repository owner's.

Written by people who have been inside this for a long time, for someone who has not. Where those
two disagree, the second wins.

---

## The three gaps this file used to name, and where they went

It said *"nothing in this body of work was found by running the app"*, and listed three things
nothing had looked at. All three were then looked at.

| gap | closed by |
|---|---|
| what the spawned `claude` writes | a boundary statement, pinned — see below |
| the interactive paths | the approval card, the roster's Fire, the panel's Delete |
| the floor over time | its *logic* has 267 tests; its *drawing* is 101 canvas calls, checked by looking |

**The spawn surface turned out to be four modules, not two.** The first census grepped `spawn(`
and missed `quarantine.ts` (`execFile`) and `transcribe.ts` (an injected `spawnFn`). They are not
alike, and the asymmetry is the useful part: `claude/run.ts` and `verify.ts` take a command *from
a caller*; `quarantine.ts` and `voice/transcribe.ts` run a binary they name at an absolute path.
A fifth of the second kind is unremarkable. A fifth of the first is a new place a string becomes
a process.

**What bounds them is not `cwd`.** `cwd` is where a child starts, not where it may write. There is
no path confinement anywhere in this product; adding one means an OS-level sandbox around the
child, not another rule in `settings.json`.

**The three click-paths with consequences are now driven in tests** — granting a tool call
permission, deleting an agent's file, deleting a store. All three destructive ones are two-click
armed with a `blur` that disarms, and none of that was checked before: a refactor making any of
them an ordinary button would have read as a simplification and passed everything.

**The floor was checked by looking at it**, which is the right instrument for drawing. A wrong
pixel is visible; a wrong decision is not, and the decisions are the best-tested subsystem here.

---

## What the merge actually taught, which the plan below got wrong

The plan said 13 conflicts, 13 of them mechanical. **Both numbers were wrong**, and the way they
were wrong is the useful part.

**Merge conflicts are not rebase conflicts.** The plan measured conflicts by trial-merging each
branch into `dev` — comparing two endpoints. The workflow here is to *rebase*, which replays each
commit against a moving base and hits intermediate states that the endpoint comparison never sees.
#94 merges with one trivial collision and **rebases into a source conflict in `privacy.ts`**. So
did #102, in `main.ts`. Any plan built from trial merges understates the work of a rebase.

**And the mechanical resolution was wrong three times, each time plausibly.** A script that kept
both sides of every conflict produced, in order:

1. **duplicate identifiers** — both sides had added a name to the *same import line*, and keeping
   both lines is `Duplicate identifier 'mkdtemp'`. Imports need their *names* merged, not their
   lines concatenated.
2. **a missing closing brace** — a conflict region can span two whole `test(...)` bodies with the
   single `})` that closes them sitting *outside* the region. Concatenating leaves the first body
   unterminated: `'}' expected`, at the end of the file, pointing nowhere near the cause.
3. **the wrong fix applied file-wide** — restoring that closer is right for a two-test-bodies
   region and nonsense inside an import list, and one file contains both. The decision has to be
   per region.

Each of those produced a resolution that looked additive and correct. Each was caught by
`npm run typecheck`, not by reading. **That is the standing instruction for the remaining six:
resolve, then typecheck, then run the file — before looking at the diff and deciding it is fine.**

**One conflict was not mechanical at all**, and it is the shape to watch for. In #133 both sides
had edited the same loop:

```
ours    ['!dist/renderer/mock.js', '!dist/**/*.map']
theirs  ['!dist/renderer/dev.html', '!dist/renderer/mock.js', '!dist/**/*.map']
```

Keeping both gives two overlapping loops. Keeping *ours* compiles, passes, and silently stops
checking that `dev.html` is excluded from the packaged app. The right answer came from opening
`package.json` and seeing which list matched — **not from the diff, which cannot tell you.**

**`dev` went red twice during the merge**, both times on a check written hours earlier, and both
times correctly:

- `truncate` reported as a used fs primitive, by `src/shared/truncate.ts`, which shortens strings.
  A scanner matching a *name* rather than an *import*. Green on both branches alone; red only
  composed. Fixed in #147.
- `spotify/client.ts` listed as having no test, after #126 added 225 lines of tests for it. The
  stale-line half of the census, noticing something no human would have gone looking for. #148.

Neither would have been found by reviewing the branches. Both were found by merging them and
running the suite, which is the argument for doing that after **every** merge rather than at the
end.

---

## The single most important sentence

**In the four hand-resolved conflicts, resolving the *source* is checked by the tests. Resolving
the *tests* is checked by nothing.**

The test files conflict too, and a conflict in a test file gets resolved by taking one side. A
discarded assertion leaves a green suite and says nothing. So:

> **Take the union of both sides' tests. Always. Even where it looks redundant.**

A redundant test costs seconds. A dropped one costs what it cost the first time — this repository
already contains a case where an assertion went missing and the suite stayed green for days.

This also means the integration branch used to plan the merge **does not cover the thing that
ships**. It is a throwaway rebuilt in one sequence; what actually merges is 54 PR-by-PR merges with
four hand-written resolutions inside them. The tested object and the shipped object are not the
same object, and the difference is exactly the untested part.

---

## Sort them into three buckets, not one queue

They are a decision queue, not a review queue, and only two buckets need you personally.

### Bucket 1 — merge on green

Bug fixes with tests that pin them. Each is small, was mutation-checked (the fix broken again to
confirm the new test fails, and fails for the *right* reason), and stands alone. If the suite is
green after the merge, it did what it says.

### Bucket 2 — needs a human judgement

Not because they are risky, but because they encode a preference nobody here can hold for you:

- **the `.claude/agents/` symlink question** — should a symlinked agent file be followed
  (`realpath`) or refused? Open, documented in `test/writes-and-symlinks.test.ts`.
- **#144** edits `.claude/settings.json`, which is both what ships to users *and* what governs
  Claude Code in this repository. It only ever removes a grant. Read that one yourself.
- **`no-designated-manager`** (#128) — the office now reports a workspace with no designated
  manager as a problem. Whether that is a problem or a valid setup is a product call.

### Bucket 3 — governance, not fixes

**This bucket is the one to notice you are deciding.** #140, #141, #144's test file, and the
ratchets in them do not fix bugs. They commit the project to a way of working: a budget on untested
modules, a tripwire on tracked symlinks, a scanner that must prove it can see. Merging them is a
choice about process, and it will be made by whoever clicks the button, possibly without noticing
they made it.

Their ongoing cost is real and is stated below.

---

## The order, and the conflicts

Numeric. Every branch was cut from `8eb219a`, so numeric order is also the order they were written,
and later ones were written knowing what earlier ones did.

**One exception:** #142 is stacked on #102 (base `close-session-leaves-it-running`). Merge #102
first; GitHub retargets #142 automatically.

### The 11 that were resolved mechanically (done)

Two branches appended to the end of the same file and nothing else. Nothing is being reconciled.

| file | PRs |
|---|---|
| `planning/NIGHT-1-HANDOFF.md` | #94, #100, #110 |
| `test/repo-health.test.ts` | #102, #104, #124, #133 |
| `test/approvals.test.ts` | #137, #145 |
| `test/registry.test.ts` | #106 |
| `test/stream.test.ts` | #107 |
| `test/spotify.test.ts` | #126 |
| `test/projects.test.ts` | #136 |

Run that one test file afterwards. A wrong union does not compile.

### The ones still open, and what to watch for

Six, in the order I would take them.

**#94 — `privacy-egress-caveat`, and #139 — `a-link-is-not-a-project`.** Both change
`src/main/privacy.ts` and both conflict there on rebase. Take #94 first; #139 is the smaller of the
two and easier to replay onto a settled `privacy.ts`.

#139's fix is that `measure` and `forget` must read **the same** skip list and must both use
`lstat`. A resolution that leaves two lists which happen to agree today has undone it while looking
correct — that is the #133 shape, and the check is to run
`npx tsx --test test/privacy.test.ts` and confirm *what the panel reports is what Forget actually
reclaims* still passes, because that test compares against a walk implemented in the test file
rather than against the panel's own arithmetic.

**#102 — `close-session-leaves-it-running`.** Conflicts in `main.ts` on rebase. It also carries
#142 (the recorder maps), which was merged into it while it waited — so landing #102 lands both,
and `src/main/voice/recorders.ts` should exist afterwards. If it does not, #142 was lost in the
resolution.

**#116 and #128 — both change `src/main/roster.ts`.** Slowest, and the one real trap in the pile.

#116 introduces `whyUnsafeAsPath` beside the existing `whyInvalid`. **The visibly stricter one is
not the right one to keep.** They answer different questions — `whyInvalid` gives a person a
readable reason while they type a name; `whyUnsafeAsPath` asks whether a string is safe to become a
path. Both survive. Keeping only the stricter breaks the hire form, and it will look like the
careful choice while doing it.

**#125 — `main.ts`.** Positional rather than semantic, but `main.ts` is a module no test can load,
so read the resolved block by eye. There is no suite that will catch a mistake here.

---

## Claims in this repository that were later retracted

The prose is what makes this codebase navigable, and it is also the hazard: commits are immutable,
so a confident, well-argued paragraph stays exactly as confident after it turns out to be wrong.
The retraction lives in a *different* commit and nothing in the original points forward. Someone
reading `git log` in order meets the wrong version first.

We know which ones. A reader has no way to.

| claim | where it is stated | where it is corrected |
|---|---|---|
| "It bounds **verbs, not paths**" — about `.claude/settings.json` | `82d2d88`, in `test/the-policy-we-ship.test.ts` | `74fbc2b` — it does not bound capability at all; `npx tsx -e "<code>"` is allowed |
| "the two guards overlap completely… neither could be exercised alone" | argued in review of #127 | `8cfa1ad` — measured as sets, the overlap runs the other way; 5 cases are caught only by the separator rule |
| "Twelve sites do this" — recursive `mkdir` | drafts of `test/writes-and-symlinks.test.ts` | `cbfdef0` — **fourteen**; two independent counts agreed because both grepped `mkdir(` and missed `mkdirSync(` |
| asserting the *count* of `mkdir` sites is a useful guard | `cbfdef0` | `cd0040b` — a count changing is not the event that makes the decision wrong; assert the premise (no tracked symlinks) instead |
| "the floor is the least-examined subsystem" | never committed; argued at length in review | `1928c75` — it is the **best**-covered; `test/choreography.test.ts` is larger than the module it tests |
| `Bash(find:* -delete)` as a way to narrow a rule | proposed in review of #144 | `82d2d88` — **matches nothing.** `ruleCovers` has no mid-string wildcard. It would have shipped as a deny rule that reads as protection and is inert |

Two of these were corrected only because somebody tested the fix instead of applying it. Assume the
list is incomplete.

---

## What running it showed, and what is still unlooked-at

**The app was run.** Built, launched, and driven for six minutes on macOS. It works.

```
7 Electron processes, 0 errors in stdout/stderr over six minutes
3 lines of output, all of them macOS Continuity Camera warnings
closed cleanly, changed nothing tracked
```

Verified on screen, not inferred:

- **the floor renders** — seven agents at desks with labels, furniture, meeting table, plants;
  the status bar reads `7 on the floor · 5 skills · Drawn in code`
- **the command palette** (⌘K) lists and filters every action
- **the privacy panel** shows the egress list with live/not-reached badges — the spawned `claude`
  binary by full path, the MCP server as `configured` but `not reached`, three Spotify hosts —
  and then the storage list with real sizes. `projects/README.md · template · 812 B` is the file
  [#139] stopped counting as the user's work, correct on screen.
- **the roster** shows each agent with its model and description, `Send home` and `Fire` on every
  row **except the manager**, which has neither — [#116] and [#128], working
- the settings panel, the chat transcript, and session restore all render

**What could not be checked, and why it is not written up as a bug.** Keyboard-driven interaction
could not be verified: the automation layer in use misreported every click's target and did not
deliver `Escape` to the app at all — the control case is that Escape did not close the *command
palette*, whose handler is a bare `if (event.key === 'Escape') this.close()`. If that does not
fire, the key is not arriving. So the app's Escape handling is **unverified**, not broken, and the
difference matters: an instrument that cannot see is not evidence of an absence.

**Still unlooked-at**, and this part of the original note stands:

- **the floor's behaviour over time** — the logic beneath it is the best-tested subsystem here;
  whether a walk depicts the tool call that caused it was checked by reading, not by watching
- **every interactive path** — clicking Fire, dispatching work, approving a held call
- **everything the spawned `claude` writes.** `run.ts` spawns the CLI with `cwd: options.cwd`, and
  by volume that is most of what lands on a user's disk because they opened this app. The approval
  gate bounds *tool calls*, not paths.

---

## Three things that are not in any single PR

### `main.ts` imports `electron` at module scope, and that is where the bugs are

No test can load `src/main/main.ts`, `spotify/store.ts`, `spotify/connect.ts` or `preload.ts` — the
import fails before an assertion runs. The code is fine; the import is the barrier.

**Three separate unbounded collections were found in `main.ts` this week, all the same shape**:
`managers` (#102), `recorders` (#142), `autoDecided` (#145) — each keyed by session or tool call
with nothing removing from it. *The module nothing can load accumulates the state nothing prunes.*
#142 and #145 both fix it by moving the decision into a module a test can reach.

### The permission policy bounds legibility, not capability

`.claude/settings.json` denies `rm`, `sh`, `eval`, `node -e`, `python3 -c`. It allows
`Bash(npx tsx:*)`, and `tsx` takes an eval flag:

```
$ npx tsx -e "console.log('EXECUTED:', 2+2, typeof require('fs').rmSync)"
EXECUTED: 4 function
```

`allowed`, with no chain character for the chain guard to catch. `npm test`, `npm start` and
`npm run dev` likewise run whatever `package.json` says. **Those grants are deliberate** — the
office verifies its own work with them — but the policy is not a sandbox. `judge(command, policy)`
never sees a path, so no rule written there can bound where anything writes.

### The one result worth keeping

> **A check that cannot fail for the right reason is not a check.**

Every scanner here asserts it can *see* something before reporting that it sees nothing, because a
grep that has gone blind and a clean tree are indistinguishable at the shell.
`test/source-is-text.test.ts` records the incident that taught it.

**And the rule form of this does not work.** It was written down, shipped in a PR description, and
broken by its own author two hours later — `git checkout --` run to undo a mutation, destroying the
uncommitted fix underneath it, twice. What caught it the second time was not remembering the rule.
It was checking the file afterwards and finding the change gone.

So the control has to be *inside the thing being run*, not in a note beside it:

- every probe asserts a known-true case first (`npm test` is allowed, the scanner finds `writeFile`)
  and fails as **"the instrument is broken"** rather than reporting a clean tree;
- every mutation harness writes a keep-file **before** the first mutation and restores from that,
  never from git.

Advice does not transfer. Assume it will not transfer to you either.

---

## What the gates cost to keep

Stated because a gate whose maintenance cost is unstated gets disabled the first time it is
inconvenient — and then it is worse than never having existed, because the repository still looks
gated.

| gate | goes red when | what to do |
|---|---|---|
| `MAX_UNTESTED = 25` (#141) | somebody adds a module nothing tests | write a test, remove an entry, or raise the number with your name on it |
| no tracked symlinks (#140) | a symlink is committed | the reachability bound behind 14 unguarded `mkdir` sites just died; read the file |
| `FOLLOWS_AND_UNUSED` (#140) | somebody uses `appendFile`/`createWriteStream`/`copyFile` | guard the path with `lstat` first, then delete the entry |
| the policy tests (#144) | `.claude/settings.json` changes | intended — the file is a security artifact |

`test/every-module-is-aimed-at.test.ts` bounds the debt and **does not price it**: a one-line
import with no assertion removes an entry as effectively as a real test. That is stated in the file
rather than papered over.

---

## Running it, and what a legitimate red looks like

```
npm install
npm test          # 1241 pass on dev
npm run typecheck
npm run build
npm start         # builds, then Electron
```

If `claude` works in your terminal but the app cannot find it, start with `OFFICE_CLAUDE_PATH` set
to what `which claude` prints — a GUI app does not inherit your shell's `PATH`.

**Environmental failures, which are not your change:**

- `test/unused-types.test.ts` fails in any checkout that is not a git repository — it shells out to
  git. An extracted tarball fails it every time.
- `test/repo-health.test.ts` and `test/writes-and-symlinks.test.ts` read the git index. Same
  condition.

**One unexplained red.** During this work the suite failed once — `1240 pass, 1 fail` — and the
output was not kept. It has not reproduced in ten subsequent runs, three of them under deliberate
CPU load. `test/approvals.test.ts` holds eight assertions on real elapsed time and is the most
likely candidate, but that is a guess and is recorded as one. If you see a red there, it is
probably this and not you.

---

## 2026-08-28 — the pile re-measured, and all three conflicts resolved in rehearsal

Ten open PRs target `dev` behind #170. Measured against #170's head rather than against `dev`,
because #170 contains `dev` entire — 159 ahead, 0 behind — so merging it is a fast-forward and
"after #170" and "#170's head" are the same tree.

**Seven merge clean:** `what-the-panels-say-against-what-is-true`, `does-any-plan-touch-its-own-edge`,
`every-prop-reports-or-says-it-cannot`, `a-field-the-renderer-never-reads`,
`the-harness-that-shipped-to-strangers`, `a-scanner-that-only-worked-at-one-address`,
`a-check-that-cannot-be-asked-to-run`.

**Three conflict**, and none of them the way the file count suggested. Rehearsed in a scratch
worktree — nothing pushed, nothing merged, the branch left where it was.

### `eval.ts` — complementary, and the conflict is only the import line

`a-harness-that-graded-its-own-work` moves the verdict into `shared/eval.ts` and gives `runOne` a
roster. #170 replaces `e.id === 'manager'` with `findManager` when building the `## CURRENT STAFF`
block. Different concerns, adjacent lines. **Take both**; the whole resolution is one import
statement carrying `findManager` and `verdict` together.

### `switcher.ts` — one line, two edits, and neither side is right alone

Both branches rewrote `sessionRows`' `meta`. #170 gave it a third, silent state: `ago(null)` says
*"never"*, which is wrong about a conversation on screen, and the title already reads *"Nothing
said yet"*, so the column collapses rather than print the same fact twice.
`a-number-computed-and-thrown-away` appends `costLabel(session.costUsd)`, because the figure was
computed on every refresh and read by nobody.

Taking the cost side whole puts `ago(null)` back. Concatenating blindly prints `" · no cost
recorded"` — a separator with nothing in front of it — on exactly the rows the silence was written
for. **Both naive resolutions type-check and both are wrong on screen.**

Resolved as three cases, which is what the pair actually describes:

| Row | Reads | Why |
|---|---|---|
| Running | `working now` | `costUsd` arrives with the result event. A running row would say *"no cost recorded"* for the whole turn and then change its mind. |
| Never spoken in | *(nothing)* | Both halves are silent for the same reason — the title carries the fact. |
| Has run | `2m ago · no cost recorded` / `2m ago · $0.2431` | Now the absent figure is worth printing, and `costLabel(null)` is *"no cost recorded"* rather than `$0`, because a conversation with no number did not cost nothing. |

The two failing tests were #170's own, and they were right to fail — the merge changed behaviour
they describe. The test files were resolved as a **union**, both sides entire, per this document's
own rule that a test file resolved by taking one side is checked by nothing. That splice needs one
`})`: the conflict region ends inside a test whose closing brace is shared and falls after the
marker.

### `PLAN.md` — left for the owner, with the fact it turns on

`the-plan-that-described-a-different-repo` (#169) touches four regions, not one. Three are
straightforwardly better than what #170 has, including a log entry recording that CI sat
`disabled_manually` for 257 commits. **Taking #170's side wholesale, which is the obvious
resolution, throws those away.**

The fourth region is the disputed one, and one line in it is false:

    - [x] `floor-view`: depth sort by `x + y + z` rather than `y` — `depthOf` and `depthAt`.

`depthAt(y, z)` is `y + Math.min(z, 0.999) * 0.999`. There is no `x` in it. The rest of #169's
rewrite of that section is an improvement — it is right that there is no `iso.ts` and right that
the work landed — so the resolution is neither side whole: **take #169's section and drop that one
tick.** Recorded rather than done, because it is a judgement about somebody's own PR and about
what a preserved checklist is for, which is the owner's to make.

### Verified

The seven clean merges plus the two code resolutions above, applied in a worktree off #170's head:
**2204 tests passing, none skipped, `npm run typecheck` clean on both configs.** That is #170's
2149 plus 55 arriving with the merged branches.
