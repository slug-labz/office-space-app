# Decisions — Office Space

Append-only. Each decision carries a reason, the alternative it beat, and a Status:
`settled` (argued and stands) · `taken` (decided by one person, contestable) · `contested`
(a challenge is open) · `open` (nobody has decided). Never edit an entry; supersede it with a
new one. Contest by appending `### Challenge — D<n> — <who>` and flipping the status.

**D1–D14 are in [PLAN.md §5](PLAN.md#5-decisions)**, with the reasoning for D12 and D14 in §5a
and §5b. They stay there. This file starts at D15, and new decisions are written here, not added
to that table. Dates are UTC.

## D15 — Local checks stand in for CI while GitHub Actions cannot run · taken · claude (review session) · 2026-09-17

From 04:37:55Z on 2026-09-17, GitHub Actions refuses every job on this repository. Each run
ends `failure` with no steps, and its annotation points at account billing for Actions. It is
GitHub's standard wording and names two possible causes without saying which applies, so nothing
here resolves it to one; the annotation's own text was removed before publication. The minutes return in about
fourteen days. Until then a PR is not merged on a red or missing `checks` run alone. It merges on
a passing run of `scripts/ci-local.mjs` (#261) on the exact head being merged, recorded as that
commit's `local-checks` status. The script runs CI's three steps (typecheck, build, the suite
with coverage) in CI's order, and says in its report and its status that it ran on a Mac with
Node 22, not in CI.

*Reason:* Four alternatives, each worse for now:
- **Wait for the minutes.** Every merge stops for two weeks while PRs keep arriving and
  conflicting.
- **Merge on each PR's targeted tests.** Tonight's reviews found breaks that only show on the
  whole suite or a combined tree. #254's temp-folder guard fails once merged with #243, #253,
  #256 or #260, although every text merge is clean.
- **A self-hosted runner on this Mac.** It needs a download, a service left running, and
  `runs-on` changed. That is the maintainer's call and has not been asked for. That the quota
  block spares self-hosted jobs is inferred, not measured.
- **Raise the spending limit.** That is billing, and the maintainer's alone.

What is lost is Linux. A test that fails only on Ubuntu passes here, and the report says so
rather than hiding it.

*Revisit if:* the minutes return (CI takes over again, and the script stays for local use); the
maintainer approves a self-hosted runner or a spending change; or a local-checks result is ever
contradicted by CI on the same commit.

## D16 — The full suite never runs from the main checkout · taken · claude (review session) · 2026-09-17

`test/instructions.test.ts` copies the whole `.claude/` of the directory it runs in into the
temp folder. In the main checkout that directory holds every session's worktree, 2.8 GB measured
on 2026-09-17. So a full run there writes gigabytes, on a disk that had 1.18 GiB free that
morning. The full suite runs only in a worktree, one run at a time, in a private `TMPDIR` that
is deleted afterwards. `scripts/ci-local.mjs` refuses a checkout whose `.claude/worktrees/` is
not empty, and holds one lock for the machine. A `No space left on device` during a run is read
as the disk, not the code, until shown otherwise.

*Reason:* The alternative is to keep running the suite wherever a session happens to be and
clean up afterwards. That is what filled the disk: 40,774 `office-*` folders older than an hour
were deleted on 2026-09-17, with the maintainer's approval.

*Revisit if:* the instructions test stops copying the whole `.claude/` (queued in TASKS.md), and
#254, which makes each test remove the folders it makes, has merged.

## D17 — #254 merges before the other PRs that make temp folders · open · proposed by claude (review session) · 2026-09-17

#254 routes every test's temp folder through `test/temp-dir.ts`, and adds a guard test that
fails on any bare `mkdtemp` elsewhere in `test/`. It collides with five open PRs:
- **#243, #253, #256 and #260** merge cleanly as text, but each combined tree fails. It fails
  the guard where a PR adds a bare `mkdtemp`, and typecheck where a PR calls a helper that #254
  now gives a `t` parameter, as #256's `workspace` does. Reviews measured this.
- **#258** conflicts in `test/harness.test.ts`: `git merge-tree` exits 1.

The proposal is to merge #254 first, so each author converts their own tests in their own
rebase; the stale-pushes session offered to do this for its PRs. The alternative is to merge
#254 last, with #254 converting everyone's tests in one rebase. That leaves the other PRs
mergeable sooner, but it puts five features' test changes inside a PR about temp folders.

*Reason:* Not decided. Merges wait for the maintainer's yes.

*Revisit if:* this is decided. Record the answer as a new entry that names D17.

## D18 — V4 "The arrival" is withdrawn as a "Done looks like" item · open · proposed by claude (review session), signed by the plan reviewer · 2026-09-17

V4 asks for a fresh clone that opens onto a building site, and five projects that open onto five
floors of lit windows. Since D14 there is no building. At a first launch nothing is running: in the
code, `running` comes from this process's sessions, and leftover processes are stopped at boot. The
fresh-clone half is already served by the first-run panel's "No projects yet" step. The one first
view that could be chosen automatically and honestly serves a narrow group. It could only ever show
every office idle. PLAN.md §4b records the exploration and three rounds of argument.

The proposal is to mark §8's V4 line `[-]`, withdrawn, with no command. Opening on the campus when
there is nothing to return to stays as a queued task (TASKS.md row 50), not as a V4 tick.

*Rejected:*
- **S1 as V4.** A first view on the campus meets neither the building site nor the lit floors.
- **An animated reveal.** Its timed beats match no event and cover no loading.
- **Event-gated beats.** This is a loading screen for loading that has already finished.
- **Flying to the office that needs you.** This is V3's ranking behind a camera.
- **An exterior or site plan.** This is the second drawing mode D14 gave up.
- **An empty-lot or "next office" card.** Projects sort by name, so a new project does not land
  in that slot.
- **The release page as V4.** This is a pitch asset, not an outcome in the app.
- **First-run signals:**
  - the registry missing at boot, which goes stale while the app runs;
  - a receipt file, which adds a permanent format;
  - localStorage keyed by path, which is wrong after a re-clone or a move;
  - `why: 'seeded'`, which only packaged builds set.
- **The roll call.** It is V3's data.
- **Round 9's rewording of V4's check (`8fa90be`).** It was never approved.

*Reason:* V4 cannot be met honestly in the shape that shipped. A line that passes by default, or
that no command can check, invites a tick for work nobody did.

*Revisit if:*
- an agent above the projects is hired, which reopens D14;
- the vision's author says the arrival is a feature of the app rather than of the pitch;
- a launch can show something really running.

Record Vish's answer as a new entry that names D18.

## D19 — #254 merges first (answers D17) · taken · the maintainer, relayed by the stale-pushes session · 2026-09-17

The maintainer answered D17 in the stale-pushes session, which relayed the answer to the review
session (received by 02:53 PDT, by the clock read then): #254 merges before the other PRs that make temp folders. This session did not
see the maintainer's own words; it is repeating that session's report.

What follows from it:
- **Each author converts their own tests** in the rebase after #254 lands.
- **The stale-pushes session converts #243, #256 and #258** (the rehearsal's C1, C2 and C3). It will
  compare its versions against the rehearsal's commits `f696c84`, `0831795` and `5d82801`.
- **The review session converts the PRs it carries:**
  - C4 (#253), C5 (#259), C6 (#260), C7 (#266) and C8 (#261), all written in the rehearsal;
  - the conversions measured for #264 and #265;
  - the patches written for #269, #270 and #271.
- **Merging itself is still the maintainer's call, one PR at a time (D15).** D19 settles the order
  of #254 against the rest, and approves no merge.

*Rejected:* merging #254 last, with #254 converting everyone's tests in one rebase. D17 gives the
reason: that would put five features' test changes inside a PR about temp folders.

## D20 — #273 is kept whole, over the sweep's size cap · taken · claude (review session), agreed by the plan reviewer on conditions · 2026-09-17

The Honesty Sweep's signed plan allowed one PR of "under about 60 changed lines outside tests". #273, which fixes the sweep's top-ranked defect, now changes 166 lines outside tests (+131/−35 against `e6fe5cb`; 50 of the added lines are comments).

**Why so many.**
- Its first head, `f3960ff`, passed each undo step the text the earlier steps left. A review failed it: in some cases dev refused the undo, and that head wrote text nobody wrote (measured).
- The fix in `08a06eb` adds the lines. It refuses a match that runs into text the undo itself put back, counts overlapping matches, and gives true reasons for files removed and made again. It also makes one write per file, which main/undo.ts uses, and refuses one file under two names.
- The fixer measured the result:

| | dev | `08a06eb` |
|---|---|---|
| Wrong writes, 50 on-disk scenarios | 17 | 2 |
| Wrong writes, 100,000 random histories, no hand edit | 1,159 | 0 |

**What is still wrong.**
- **F07 writes a wrong file where dev refused.** It needs a hand edit inside the employee's later text in a chain; dev refused it only because dev refuses every chain. It occurs 5–12 times per 100,000 random histories.
- **F08 writes a wrong file on dev as well.**
- Both are stated in the PR.

*Rejected:* cutting #273 back to the per-file count plus the `$` fix. The plan reviewer measured by reading that the per-file count alone turns "1 file was put back" into a false statement about a file still half restored. If a condition below fails, the fallback is the one-line `$` fix alone.

*Conditions (the plan reviewer's):*
- a fresh-context review of `08a06eb` passes before any merge;
- Q4 is re-run at `08a06eb` (done: `merge-tree` clean against 27 heads; the tree merged with #254 passes);
- this entry;
- the maintainer is told plainly that F07 writes a wrong file where dev refused.

*Revisit if:* the re-review of `08a06eb` fails, or the maintainer prefers the smaller fix.

## D21 — D20's fallback is taken: #273 carries only the `$` fix · taken · claude (review session), under the plan reviewer's condition · 2026-09-17

D20 kept #273 whole on the condition that a fresh-context review of `08a06eb` passed. It did not pass.

- **The office records the Edit call's input, not what the CLI wrote.** The CLI turns CRLF into LF before matching, curls quotes when it matched through curly ones, and makes a file for an empty `old_string` (read from the CLI's source).
- **So `08a06eb` could write a wrong file where dev refused, with nobody editing the file since** (measured in CRLF, curly-quote and Edit-made-file histories).
- **It also kept a full copy of the file per step** (measured: 651 MB for 300 edits to a 2.18 MB file).

The plan reviewer had set the fallback in advance: the one-line `$` fix, not a partial undo fix.

#273 is now that fix alone (`360d4fa`), pushed over `08a06eb` with `--force-with-lease`. The threading work stays on the branch `undo-threading-draft-2026-09-17` (`08a06eb`), which is not to be merged. F4.1 is queued again as row 61, carrying what the reviews found.

*Rejected:* a third fix round tonight. Each review found a new class of wrong write, and the plan's terms named the fallback.

*Revisit if:* somebody takes row 61 with a design that models what the CLI writes.

## D22 — The `$` defect in `createProject` is queued, not added to #273 · taken · claude (review session) · 2026-09-17

#273's review found #273's defect in a second place. `src/main/projects.ts:268` passes a new project's typed name to `replaceAll` as a string, so `$$`, `$&`, `` $` `` and `$'` in the name are read as patterns (measured by the reviewer through `createProject`). The fix is the same: pass a function.

It is queued as row 71, not added to #273.
- **#273's scope is set.** #273 is D21's fallback, and the plan reviewer's terms name it as tonight's one sweep fix. A second file would widen it after its review.
- **The test needs a temp folder.** It must go through `createProject`, which copies a folder. #254's guard forbids `mkdtemp` in `test/`, and #254 merges first (D19).

*Rejected:* folding it into #273 now as the same class of bug. The test would need a temp folder before #254 lands, and #273 would need another review.

*Revisit if:* #254 is on `dev`, or the maintainer wants both `$` fixes in one PR.

## D23 — `/verify` looks for a run's files only when the command is one plain run · taken · claude (review session), agreed by the plan reviewer (round 11) · 2026-09-17

PR #274 gives `.claude/commands/verify.md` #271's rule for an agent: a VERIFY whose test run names a missing file does not pass. The first versions described #271's parser in prose. The fresh review of `c16193b` measured exit-0 runs that such a reading lets through:
- `echo a missing | xargs node --test` and `npm exec node --test a fails`, which an agent that knows those programs reads past;
- `node --test a 2>&1`, which sent the agent to `ls 2`;
- `node --test a > out missing` and `node --test a --import missing`, where the text ended the run too early;
- a run naming no file, which "every file was found" lets through.

So the command now names one closed shape: `node --test`, `tsx --test`, `npx tsx --test` or `npx --yes tsx --test`, then one or more plain file names with a JavaScript or TypeScript ending, and nothing else. Any command with `node` or `tsx` anywhere in it (even inside a longer word) and `--test` anywhere, in any other shape, has its test files reported as not looked for, and its task stays where it is.

*Reason:* a closed list is the only form that keeps the file's own line, "nothing here is a judgement call", true. Every real VERIFY that runs tests fits: 64 of the 67 backticked spans with `node` or `tsx` and `--test` in dev's PLAN.md and #263's files, and the other three are prose mentions (measured).

*Rejected:*
- **Describing #271's parser in prose.** Each version left an agent a case to judge, and the review measured the cases above.
- **Agreeing with #271 exactly.** The office reads more commands and shows a note beside the ones it cannot read. A Done row carries no note, so the agent's rule is stricter.

*Revisit if:* real VERIFYs need a shape outside the list (`--test-timeout=…`, `npx -y`), or #271's parser becomes something an agent can run.

## D24 — The office does not call a hosted decision model (Jev) · taken · claude (jev teammate), gate approved by Vish · 2026-09-24

Jev (TypeSafe AI, reached through Vercel AI Gateway) was measured against the regex a VERIFY lint
would otherwise use, on 85 VERIFY cells: 74 real, from 62 task files, and 12 verdicts the
evaluator wrote. It scored 79/85 on both of two runs; the regex scored 82/85. It caught the three
verdicts the regex misses, all three written by the evaluator, and flagged six honest cells doing
it. Between the two identical runs its misses moved, and the gateway accepts only an unpinned
alias (vercel/ai#21213). Numbers and method are in PLAN.md §4c. By the gate Vish approved before
the run, it closes as no. The regex shipped instead, as #276.

This was numbered D15 in PLAN.md's table when #275 merged, and renumbered here because this
file's D15 came first.

*Rejected:*
- **Adopting Jev for VERIFY linting.** Its whole margin was on examples the evaluator wrote, and a
  lint whose answers move between identical runs would flag a cell one day and not the next.
- **Adopting it for mishap classification** (`src/shared/mishap.ts`). It went 12/12 against the
  regexes' 10/12, but both wins were on rows written to be regex misses.
- **Risk-scoring held tool calls and stall detection on the floor.** Set aside before the run: the
  first sends the user's own commands off the machine from inside the control that holds them; the
  second would put a probability on the floor with no event behind it.

*Revisit if:* a corpus not written by the evaluator shows verdicts the regex misses, **and** the
model can be pinned on the doorway the office would ship through.

## D25 — GitHub Actions is back and gates merges again (supersedes D15) · taken · claude (stale-docs teammate), approved by Vish · 2026-10-02

Vish approved this on 2026-10-02 (06:21Z; 2026-10-01 23:21 PDT) by iMessage, relayed through
Si; the approval is repeated here, not seen by the agent writing it.

Measured today with `gh run list -R slug-labz/office-space`: the `checks` workflow concluded
`success` on dev (for example 03fc994 at 2026-10-01T11:13Z, and 305acd7 at
2026-10-02T01:09Z), on main (ae25e79 at 2026-10-01T11:21Z), and on PR branches (#306's 93a0dee and
#308's aee7f20). PR #299, merged 2026-10-01 09:45Z, recorded the return in PLAN.md and PROGRESS.md
only, which is why TASKS.md still said otherwise.

From now on a PR merges on a passing `checks` run on the exact head being merged. `local-checks`
(`scripts/ci-local.mjs`) stays for local use, as D15's "Revisit if" said. D15 is left as written;
this file is append-only.

*Rejected:*
- **Keeping `local-checks` as the merge gate.** It runs on one Mac with Node 22 and loses Linux,
  which D15 named as the cost. With hosted CI back there is no reason to pay it.
- **Deleting the self-hosted runner row** (TASKS.md row 32). That is the maintainer's call. The row
  stays, with a note.

*Revisit if:* Actions stops running jobs again (quota or otherwise), in which case D15's
procedure applies again.
