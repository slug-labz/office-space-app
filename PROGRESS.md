# Progress — Office Space

Append-only. Newest entries at the bottom. Never rewrite history — a correction is a new entry
naming what it corrects.

Format: `## YYYY-MM-DD — <who>`, what happened, and `Evidence:` the command and its real result
(or `Evidence: none — <why>`).

Dates are UTC. Everything before 2026-09-17 is in [PLAN.md §7](PLAN.md#7-session-log), which
stays where it is and keeps getting a line per milestone.

## 2026-09-17 — claude (review session)

Project files created from `~/.claude/pulse/templates/`: this file, [TASKS.md](TASKS.md) and
[DECISIONS.md](DECISIONS.md). The decisions table in PLAN.md §5 stops at D14, so DECISIONS.md
starts at D15.

Evidence: none needed. The files are in this commit.

## 2026-09-17 — claude (review session)

Nine PRs merged onto `dev`, one at a time, in this order: #237, #241, #245, #242, #240, #246,
#238, #244, #239. Each branch was first rebased onto the `dev` it was about to join. The rebased
tree was then compared against `git merge-tree --write-tree`'s prediction for the same pair, the
PR's own tests were run on it, and it was pushed with `--force-with-lease` pinned to the head
that had been reviewed. After that came a green CI run on the pushed head, and finally
`gh pr merge --merge --match-head-commit`. No branch was deleted. `dev` is now `e6fe5cb`.

Evidence:
- `gh api repos/slug-labz/office-space/commits/e6fe5cb/check-runs`: `checks` completed/success
  at 04:23:52Z.
- Each merge commit's parents are the previous `dev` and the rebased head. Merge times ran from
  03:45:14Z (#237) to 04:19:53Z (#239).
- The eight backticked VERIFY commands in TASKS.md's Done table exit 0 on `e6fe5cb` (Node
  22.16.0). In the table's order the counts were 6, 47, 54, 9, 51, 26, 48 and 10 tests, with 0
  failing.

A real-app check on `e6fe5cb`, run by #238's author and repeated here, not re-run: a call held
at boot gets a card, and an answered card stays gone through a push that still names it. The
control, on `791115d`, shows the card coming back.

## 2026-09-17 — claude (review session)

GitHub Actions stopped starting jobs at 04:37:55Z. Every run since then ends `failure` within
about five seconds and runs no steps. The minutes come back in about fourteen days. D15 records
what stands in for CI until then.

Evidence:
- `gh api 'repos/slug-labz/office-space/actions/runs?created=>=2026-09-17T04:15:00Z'`: the last
  successful run (on #243's `39ce4a7`) finished at 04:34:12Z. All 13 runs created from 04:37:55Z
  to 05:02:34Z failed. They are the runs on #247–#249, #251, #255 and #257–#262, plus the newer
  heads of #247 and #251.
- `gh api repos/slug-labz/office-space/check-runs/105079596433/annotations` (#258's head
  `24e7960`) reports that the job was not started, and points at the account's Actions
  spending limit. The annotation's own wording was removed before publication.
- No branch protection is available that could have required a check:
  `gh api repos/slug-labz/office-space/branches/dev/protection` answers 403, *"Upgrade to GitHub
  Pro or make this repository public to enable this feature."*

## 2026-09-17 — claude (review session)

The disk reached 1.18 GiB free. Test runs had left `office-*` folders in the system temp folder,
and most were more than an hour old. With the maintainer's approval, only `office-*` entries
older than 60 minutes were deleted. Newer entries, worktrees and caches were not touched. #254
makes each test remove what it makes. D16 keeps the full suite out of the main checkout.

Evidence: `find "$TMPDIR" -maxdepth 1 -mindepth 1 -name 'office-*' -mmin +60 -exec rm -rf {} +`
exit 0, deleting 40,774 entries. `df` read 1.18 GiB free before and 4.25 GiB after. 4,765
`office-*` entries newer than an hour were left in place.

## 2026-09-17 — claude (review session)

`scripts/ci-local.mjs` written, as #261. It runs CI's three steps on this machine, one run at a
time, in a private temp folder that it deletes. It can post a `local-checks` commit status that
says the run was not in CI. The run on its own head passed, and that was the first time the
status path ran against GitHub.

Evidence: `node scripts/ci-local.mjs --post-status` on `2734b00` exited 0: typecheck 4.3s, build
4.4s, and the tests with coverage 39.9s. It counted 2666 tests: 2665 pass, 0 fail, 0 cancelled, 1
skipped. Coverage was 88.07% of lines, and the status was posted as `local-checks = success`.
`tsx --test test/local-checks-say-what-they-ran.test.ts` passed 8/8, and nine mutations of the
script each failed it.

## 2026-09-17 — claude (review session)

The V3 replacement for the lobby, agreed by Teammate 1 and Teammate 3 over two rounds, was
written into PLAN.md §4b with both teammates' rounds. It is not frozen. The maintainer has not yet
answered Q1, Q8, Q13a and Q13b. Two of its PRs could go ahead of the freeze by agreement, and both
have merged: PR 1 as #241 and PR 2a as #242. Q8's fix has also merged, as #238.

Evidence: `grep -c "^PLAN FROZEN: " PLAN.md` prints 0.

## 2026-09-17 — claude (review session)

The 16 other open PR heads and `dev` itself were run through `scripts/ci-local.mjs
--post-status`, one at a time. Each ran in a throwaway detached worktree that was removed
afterwards, and all 17 runs passed. Each result is posted on its commit as a `local-checks`
status. #250 and #252 are based on an older `dev`, so they were checked as they stand, not as
they would merge, and the merge train checks them again after its rebase. These results cover
the heads listed only; a new push needs a new run.

Evidence (macOS, Node 22.16.0; each run exited 0; one test is skipped in every run):

| Commit | What | Tests | Pass | Lines covered |
|---|---|---|---|---|
| `e6fe5cb` | `dev` | 2658 | 2657 | 88.07% |
| `39ce4a7` | #243 | 2675 | 2674 | 88.14% |
| `52e24d5` | #247 | 2658 | 2657 | 88.06% |
| `256b15a` | #248 | 2658 | 2657 | 88.05% |
| `af0eefa` | #249 | 2658 | 2657 | 88.07% |
| `c427a14` | #250 (behind `dev`) | 2655 | 2654 | 87.99% |
| `6df6324` | #251 | 2658 | 2657 | 88.07% |
| `4f37c60` | #252 (behind `dev`) | 2654 | 2653 | 88.03% |
| `6b88ad6` | #253 | 2668 | 2667 | 88.05% |
| `702e238` | #254 | 2662 | 2661 | 87.99% |
| `f1dfc4d` | #255 | 2670 | 2669 | 88.12% |
| `94910db` | #256 | 2669 | 2668 | 88.11% |
| `bd0683b` | #257 | 2661 | 2660 | 88.07% |
| `24e7960` | #258 | 2661 | 2660 | 88.08% |
| `b9fad40` | #259 | 2666 | 2665 | 88.14% |
| `5ee1811` | #260 | 2668 | 2667 | 88.08% |
| `0ecd713` | #262 | 2658 | 2657 | 88.07% |

#261's own head, `2734b00`, is in the entry above: 2666 tests, 2665 pass.

These runs check each head alone. They do not check heads combined, and combining changes the
results:
- **#254 with #243, #253, #256 or #260:** each pair merges cleanly as text, and each combined
  tree fails #254's guard or typecheck. The reviews measured this.
- **#254 with #258:** the pair does not merge. `git merge-tree --write-tree 702e238 24e7960`
  exits 1 with a content conflict in `test/harness.test.ts`.

That is D17.

## 2026-09-17 — claude (review session)

A multi-file VERIFY cannot fail on a missing file. `tsx --test` exits 0 when it is given one
test file that exists and one that doesn't, and it never mentions the missing one. It fails only
when none of the files it is given exist. This was found because the agreed §8 line for V3,
which named `campus.test.ts` and two files PR 3 has not written yet, passed today. §8 now names
the one file PR 3 must write, and §4b records the change, which Teammate 3 has not seen. The
general trap is queued as task 45.

Evidence (Node 22.16.0, tsx 4.23.12, on this branch):

    tsx --test test/which-office-needs-you.test.ts                       exit 1  "Could not find 'test/which-office-needs-you.test.ts'"
    tsx --test test/campus.test.ts test/which-office-needs-you.test.ts   exit 0  27 tests, 27 pass, no mention of the missing file
    npx --no-install tsx --test <the three files §8 named>               exit 0  27 tests, 27 pass

## 2026-09-17 — claude (review session)

Three queued tasks became PRs, each branched from `dev` at `e6fe5cb`: task 30 as #264, task 44 as
#265 and task 29 as #266. Each was written test first, and each test was checked against
mutations of the code it covers.

Evidence (Node 22.16.0, private `TMPDIR`):
- #264. With a mode-000 directory under `.claude/worktrees/`, the old test failed with `EACCES:
  permission denied, opendir '…/.claude/worktrees/locked'`, and the new test passed 6/6. Making
  `readGate` skip either file failed the new test.
- #265. The old test ran 15 pass, 1 skipped; the new test runs 16 pass, 0 skipped. Four
  mutations of `connectors.ts` each failed the new test, and each left the old one passing with
  its skip. A probe as uid 501 showed a `0o444` `.mcp.json` replaced with both writers
  returning `ok`, and a `0o555` directory refusing both writers with `EACCES`.
- #266. On dev's code, 7 of the first 9 tests failed on the advice, which named
  `.claude/settings.json`. On the branch, 13/13 pass, and twelve mutations each fail a test.
  Its first full local run, on `6fe58e3`, failed `bridge-fields-are-read`: `deniedIn` has no
  reader under `src/renderer/`. `aee9baa` records the reader, which is in `src/shared/`.

## 2026-09-17 — claude (review session)

Campus cards never showed their own project's work. #267 fixes it.

Evidence: `tsx --test test/every-card-shows-its-own-office.dom.test.ts` in a detached worktree at
`e6fe5cb` exited 1, with 0 of 9 tests passing. Beta's floor showed the builder working, and
beta's card showed nobody (`expected ['builder']`, got `[]`). Alpha's failed VERIFY was painted
on beta's card, and a bubble from the office view stayed up over the campus. On the branch, the
file passes 9/9 and each of sixteen mutations fails a test. `npm test` exited 0 with 2667 tests:
2666 pass, 1 skipped.

## 2026-09-17 — claude (review session)

Reviews came back from fresh-context agents. They are summarised here, and the full texts were
sent to each PR's author:
- #257: passed with conditions (see TASKS row 12).
- #259: passed with conditions (row 14).
- #260: passed with conditions (row 15).
- #262: passed with conditions (row 17).
- #243 and #256: confirmation passed with conditions (rows 1 and 11).
- #247 and #251: the re-check passed with conditions (row 33, done).
- #261: the adversarial review failed it (row 16).

Evidence: none here. Each review's measurements are in the review itself, which is summarised in
the PR rows.

## 2026-09-17 — claude (review session)

Local checks were run on the PR heads that were new since the last table, one at a time, in
throwaway worktrees. Each result is posted as a `local-checks` status. All ran on `dev` at
`e6fe5cb`, under macOS and Node 22.16.0.

| Commit | What | Result | Tests | Pass | Skipped |
|---|---|---|---|---|---|
| `cb479a3` | #264 | passed | 2658 | 2657 | 1 |
| `e5e6972` | #265 | passed | 2658 | 2658 | 0 |
| `6fe58e3` | #266 | **failed**: 1 fail, `bridge-fields-are-read` | 2671 | 2669 | 1 |
| `aee9baa` | #266 | passed | 2671 | 2670 | 1 |
| `dcda528` | #267 | passed | 2667 | 2666 | 1 |
| `d725451` | #259 | passed | 2666 | 2665 | 1 |
| `335b003` | #243 | passed | 2675 | 2674 | 1 |
| `981576a` | #256 | passed | 2671 | 2670 | 1 |
| `1bb95ae` | #262 | passed | 2658 | 2657 | 1 |

The one skipped test in every other run is `writing-a-connector`'s read-only test. #265 is the
first run where it runs.

## 2026-09-17 — claude (review session)

V4 was explored before any plan was written. Five sketchers worked blind, from the frontend,
data, tester, reviewer and scope angles, and produced 15 sketches. One critic read all 15 and
clustered them into six. Two survived: open a workspace's first launch on the campus, with
nothing moving (S1), or withdraw V4 (S2). The opening draft is published as a page shared
with the team, and round 1 with a teammate is under way.
Nothing is built before the maintainer answers and the freeze line exists.

Evidence: none — this is a plan, not a measurement. Three sketchers read the campus-card defect
and nobody ran it; it was measured separately, as in the entry for #267 above.

## 2026-09-17 — claude (review session)

V4 was argued before anything was built, and the argument is written into PLAN.md §4b.
- The opening draft recommended opening a workspace's first launch on the campus, S1.
- Round 1 showed S1 never fires on a true first launch, and moved its trigger to "nothing listed".
- Round 2 showed who that version serves: a trusted workspace with projects and no conversations.
  That is not the README clone, not the DMG install, and not a returning user. It rejected S1 as V4.
- Round 3 found two problems in pausing breaks on the campus. Both are fixed in #267 (`be0db19`).

The outcome is a proposal for Vish: withdraw V4 (D18, open). S1 stays as queued task 50, and
skipped registry rows reaching the snapshot is task 51.

Evidence: `grep -q "^#### Teammate (plan reviewer) · round 3" PLAN.md` exits 0 on this branch.
`grep -c "^PLAN FROZEN" PLAN.md` prints 0, because nothing is frozen. The §8 ticks are unchanged:
31 of 35.

## 2026-09-17 — claude (review session)

Every open PR was merged into one scratch tree and tested together, so a merge approval rests on
a measured result rather than 22 separate ones. The run was a detached worktree on `dev`
`e6fe5cb`, merged group by group in the proposed order (#254 first, D17), with the eight
mechanical `tempDir` conversions #254 makes necessary (C1–C8) written as scratch commits. Seven
heads that moved during the run were merged on top afterwards.

Evidence (measured on the final tree `21bc48b`, local only):
- `npm run typecheck` exit 0 and `npm run build` exit 0.
- `npm test` exit 0 with `# tests 2802`, `# pass 2802`, `# fail 0`, `# cancelled 0`, `# skipped 0`.
- The run's private temp folder held only tool caches afterwards.
- Two findings are not text conflicts. #256 with #260 gives a used-but-incomplete read the false
  `unlisted` advice; reproduced, and whichever lands second fixes it. #247 with #255 leaves three
  privacy sentences false.

The findings are also on a page published for the maintainer.

## 2026-09-17 — claude (review session)

Reviews since the last entry, all by fresh-context agents, and what came of them:
- **#264: passed.** The description's count was corrected.
- **#265: passed.** The refusal must now leave the file unchanged, and the file is locked too
  (`a944e6b`).
- **#266: passed with one condition,** met at `2832c86`: a DOM test proves the chat view passes
  `deniedIn` on. The file-not-rule wording became task 54.
- **#267: passed with conditions.** A busy project could show a card with nobody working, the
  break timer's callback had no campus guard, and `markBusy` was pinned for one fact kind. Fixes
  are being written.
- **#257's fix: passed with conditions.** Two tests were tightened and the close order is pinned
  (`db3945e`).
- **#243, #256, #262 (re-reviews): passed.** #256's plan with #260 gained the `session.ts`
  sentence.
- **#261's fixes:** 14 commits (`208b772`) answer the failed review. Its re-review is running.

New PRs, each written test first with mutations:
- #268 is task 45.
- #269 is task 51.
- #270 is task 53, found while writing #269: the next save deleted every row the registry could
  not read.
- #271 is task 52: the office's own harness passed a VERIFY naming a missing test file.

Evidence (`local-checks` statuses, macOS, Node 22.16.0, on `dev` `e6fe5cb`, each exit 0):

| Commit | PR | Tests | Pass | Skipped |
|---|---|---|---|---|
| `8f57c0d` | #243 | 2675 | 2674 | 1 |
| `4539008` | #256 | 2671 | 2670 | 1 |
| `a61f95d` | #258 | 2661 | 2660 | 1 |
| `d2b60e7` | #262 | 2658 | 2657 | 1 |
| `e3f6cf6` | #263 | 2658 | 2657 | 1 |
| `a944e6b` | #265 | 2658 | 2658 | 0 |
| `2832c86` | #266 | 2674 | 2673 | 1 |
| `db3945e` | #257 | 2665 | 2664 | 1 |
| `208b772` | #261 | 2693 | 2692 | 1 |
| `5d3a1a2` | #268 | 2660 | 2659 | 1 |
| `c612992` | #269 | 2663 | 2662 | 1 |
| `09a7aa3` | #270 | 2667 | 2666 | 1 |

`208b772`'s own run was the first with the new script. Its status reads "typecheck, build,
2692/2693 pass, 0 fail, 1 skipped — dev e6fe5cb, on darwin, Node 22.16.0, not CI".

## 2026-09-17 — claude (review session), 01:56–02:49 PDT

Five reviews finished; one of them failed a PR of this session's. The Honesty Sweep plan was
argued and signed, and #272 opened. Times below come from the clock or from file times, not
estimates.

- **#258** (the stale-pushes session's): passed with conditions.
  - Nothing says why a VERIFY was held back.
  - Whichever of #258 and #256 lands second fixes `harness.ts:169` and adds a test with a
    non-string deny entry.
  - Relayed to that session.
- **#268:** passed with conditions. Fixed at `5bb5f95`, pushed, `local-checks` passed.
- **#269:** passed with conditions; it must merge with or after #270.
- **#270:** failed. A save could silently leave out this office's own newer copy of a
  conversation, and the merge and the refusal came from two reads.
- **#271:** passed with conditions. `testRuns` reads a flag's value as a file, so correct commands
  fail and the panel claims a skip.
- **#261** (re-review): passed with conditions. Test 20 would fail on GitHub's Ubuntu image.

Fixers are running for #261, #269/#270 and #271.

- **#267:** the fixer's `f8cc5b9` (followed from the send; a `result` ends nothing) and the review
  session's `06617e7` (a queued message that fails to send leaves the watched run alone) are
  pushed.
- **Honesty Sweep (row 57).** Teammate 3's session has ended, so a fresh-context plan reviewer
  argued the plan. It took five rounds, and every round is quoted verbatim on the plan page. It
  was signed "on the terms in round1-reply.md". Six readers were dispatched between 02:40:41 and
  02:41:47.
- **#272:** row 28, written test first with five mutations.
- **Correction.** #267's description said its `06617e7` checks ran at "02:36" and "02:34". They
  ran at 02:15 (log file times), and the description is corrected. Three review notes in the
  session's scratchpad carried guessed times too, and they are corrected in place.
- **Row 13's VERIFY** named three test files, which the multi-file trap makes unsafe. It now names
  one.

Evidence (`local-checks` statuses, macOS, Node 22.16.0, on `dev` `e6fe5cb`, each exit 0):

| Commit | PR | Tests | Pass | Skipped |
|---|---|---|---|---|
| `06617e7` | #267 | 2681 | 2680 | 1 |
| `5bb5f95` | #268 | 2663 | 2662 | 1 |
| `6755b83` | #272 | 2663 | 2662 | 1 |

## 2026-09-17 — claude (review session), 02:49–03:08 PDT

- **#270:** `dc13962` answers the failed review. The merge and the refusal now use one read. A save that leaves out a conversation this office holds throws `RowsLeftOut` after writing everything else. `remember` reports it, and a close whose own row was left out fails.
- **#269:** `c6c9068` answers its review's conditions.
- A re-review of both is running.
- **#259:** `835af81` rewords one comment so it holds whether or not #272 lands.
- **#272:** `ffc91ae` answers its review (passed with conditions). A new test sets `TZ` to three zones, so making the zone optional fails in any zone (measured in PDT); the review had found it caught only under UTC.
- **#258:** now at `b9aa23e`, from the stale-pushes session; the review session posted its `local-checks`.
- **Honesty sweep:**
  - All six readers reported, with 47 candidates, now in `sweep-review/reports/` in the session scratchpad.
  - The critic is ranking them.
  - F5.1 (the untrusted first-run wording) is now changed by #258, and the critic was told.
- **Rows 59 and 60** are filed unassigned. The stale-pushes session asked that nothing new be put in its name until its user assigns it.

Evidence (`local-checks` statuses, macOS, Node 22.16.0, on `dev` `e6fe5cb`, each exit 0):

| Commit | PR | Tests | Pass | Skipped |
|---|---|---|---|---|
| `dc13962` | #270 | 2681 | 2680 | 1 |
| `c6c9068` | #269 | 2663 | 2662 | 1 |
| `835af81` | #259 | 2666 | 2665 | 1 |
| `ffc91ae` | #272 | 2664 | 2663 | 1 |
| `b9aa23e` | #258 | 2662 | 2661 | 1 |

## 2026-09-17 — claude (review session), 03:08–04:16 PDT

**The Honesty Sweep reached its end state.**
- The critic ranked 49 candidates and named 3 false alarms.
- Six confirmers each wrote a test that fails on `e6fe5cb`, and all six are CONFIRMED.
- The plan reviewer agreed, with conditions, in round 6.
- #273 fixes the top one (F4.1), plus a `$` defect its confirmer found in the same function (rows 61 and 62).
- The other five are queued as rows 63–67, F5.4 as row 68, and the unconfirmed candidates are pointed to from row 69.

**A new branch, `honesty-sweep-evidence-2026-09-17` (`736037b`), holds the evidence.** It is never meant for merging.
- It holds the reports, the critic's ranking, the argument quoted verbatim, and the six red tests stored as text.
- Local paths are replaced with placeholders.
- CI runs only for main, dev and PRs into them, and `gh run list` showed no run for this branch.
- It stays: branches are not deleted here.

**Other PRs:**
- **#271:** `62c96e2` answered its first review; its re-review found one more false failure, from runners started by pnpm or `find`. A second fixer is working on it.
- **#261:** `d99111f` answered its re-review. Its own run, using the new script, posted success. A third review is running.
- **#270 and #269:** `0f74a45` and `e5f5d79` answered their re-review.
- **Row 70:** a close after another office's newer save is lost. It is on dev and is filed.

**Corrections:** five review notes in the session scratchpad carried guessed times ("about 03:12", "03:13", "03:18", "03:23", "02:25"). Each is corrected in place from the file's save time.

Evidence (`local-checks` statuses, macOS, Node 22.16.0, on `dev` `e6fe5cb`, each exit 0):

| Commit | PR | Tests | Pass | Skipped |
|---|---|---|---|---|
| `62c96e2` | #271 | 2698 | 2697 | 1 |
| `597c1d5` | #263 | 2658 | 2657 | 1 |
| `d99111f` | #261 | 2699 | 2698 | 1 |
| `0f74a45` | #270 | 2684 | 2683 | 1 |
| `e5f5d79` | #269 | 2663 | 2662 | 1 |
| `f3960ff` | #273 | 2665 | 2664 | 1 |

## 2026-09-17 — claude (review session), 04:16–05:37 PDT

- **#273.** Its first review failed `f3960ff`: the threading let some undos that dev refused write text nobody wrote (measured).
  - `08a06eb` fixes it. The fixer measured 50 on-disk scenarios (dev 17 wrong writes, the head 2) and 100,000 random histories with no hand edit (dev 1,159 wrong writes, the head 0).
  - F07 writes a wrong file where dev refused. F08 writes one on dev too.
  - The plan reviewer accepted the size overrun on four conditions; D20 records it. Q4 was re-run at `08a06eb`: `merge-tree` is clean against 27 heads, and the tree merged with #254 passes.
  - A re-review is running.
- **#271.** `47ac339` answers its re-review: a run's files are checked only when an allow-listed launcher, or nothing, comes before the runner. A third review is running.
- **#261.** `3068462` answers its third review, with tests 42–47.
- **The merge rehearsal** of all 28 open PRs has started, with #254 first (D19).

Evidence (`local-checks` statuses, macOS, Node 22.16.0, on `dev` `e6fe5cb`, each exit 0):

| Commit | PR | Tests | Pass | Skipped |
|---|---|---|---|---|
| `759c789` | #263 | 2658 | 2657 | 1 |
| `08a06eb` | #273 | 2674 | 2673 | 1 |
| `3068462` | #261 | 2705 | 2704 | 1 |
| `47ac339` | #271 | 2707 | 2706 | 1 |

## 2026-09-17 — claude (review session), 05:37–06:11 PDT

- **#273: the fresh review of `08a06eb` failed.** `08a06eb` wrote wrong files where dev refused, in CRLF, curly-quote and Edit-made-file histories, and it kept a full copy of the file per undo step. D20's fallback is taken (D21):
  - #273 is now the one-line `$` fix, `360d4fa`, pushed with `--force-with-lease` over `08a06eb`;
  - the larger work is on the branch `undo-threading-draft-2026-09-17`;
  - row 61 is queued again.
  - Measured at `360d4fa`: the new test is red on dev (1 pass, 1 fail) and green here (2/2); typecheck exits 0; `merge-tree` is clean against 27 heads. Its `local-checks` and a review are running.
- **The merge rehearsal of all 28 open PRs passed** (`cdba27c`, measured by the rehearsal agent):
  - The order is #254 first, then #264/#265, #243/#262/#256/#258, #253/#250/#252/#249, #247/#248/#251/#255, #257/#259/#260/#266/#267, #270/#269/#272/#273, #271/#268, and #261/#263.
  - The conversions are C1–C8 plus the prepared patches for #269, #270 and #271. They are saved as patch files in the session scratchpad (`rh2/conversions/`).
  - `ci-local.mjs` on the merged tree passed: 2965 tests, 2965 pass, 0 fail, 0 skipped.
  - Gaps (a) (#256 + #260) and (b) (#247 + #255) still hold. #258 + #256, #259 + #272, #269 + #270, #268 + #271 and #257 + #270 read true together.
  - The rehearsal ran with #273 at `08a06eb`. Its new `360d4fa` is a subset of that change, and `merge-tree` is clean.
- **Disk:** free space on this machine fell to 0.98 GB during the rehearsal (measured by the rehearsal agent) and was 1.3 GB at 06:08. Most of it is other sessions' worktrees and temp folders.

## 2026-09-17 — claude (review session), 06:11–06:30 PDT

- **#271's third review passed with conditions** (`47ac339`).
  - **The condition is a regression from round 2.** Nine spellings pass with a missing file and no note, where `62c96e2` gave one. Each starts a runner inside `-c`/`--call` text or a quoted `$(…)` (measured by the reviewer).
  - **A round-3 fixer is running.** Its fix is a safety net: any `--test` in text the parser did not read adds a "not checked" note, worded to be true when nothing ran.
- **#273's review of `360d4fa` passed with conditions on the description.** The reviewer measured:
  - the fix is right: red on dev, 2/2 here;
  - `merge-tree` is clean;
  - the tree merged with #254 passes.

  What changed in answer:
  - **`3f5c640`** corrects the test's comment. Dev writes four of the six texts wrong, not six (measured).
  - **The description** now says:
    - the draft branch holds code and its test only;
    - where the reviews and measurements are;
    - that an empty put-back text is untested;
    - which wrong writes dev already makes (S08, TD1).
  - **The reviews, probes, fuzzer and mutations** had been only in the session's notes. They are now on the evidence branch at `69fe434`, in `docs/honesty-sweep-2026-09-17/undo-threading/`, and the branch's index no longer calls F4.1 fixed.
  - **The same defect in `createProject`** is queued as row 71 (D22).
  - **Row 61** now lists the wrong writes and untrue refusals the reviews found on dev.
- **Row 56:** the `/verify` change is committed on the branch `the-verify-command-looks-for-the-files-a-test-run-names` (`717618e`) and not yet pushed. It waits for #271's round-3 wording.
- **Addition to the 05:37–06:11 entry:** the merge rehearsal's report and conversions have also been on the evidence branch since 06:12, at `3f4971e`, in `docs/merge-rehearsal-2026-09-17/`.

Evidence (measured, Node 22.16.0):
- **Row 56.** `tsx --test test/the-verify-command-looks-for-the-files-a-test-run-names.test.ts`:
  - on dev's `verify.md`: 4 tests, 1 pass, 3 fail;
  - at `717618e`: 4/4.

  21 mutations of `verify.md` were each caught by the test that pins them.
- **At `3f5c640`:**
  - `an-undo-writes-dollar-signs-as-they-were` 2/2, `undo` 20/20, `undo-on-disk` 13/13, `changes-view` 8/8, `unused-types` 4/4;
  - both typechecks exit 0;
  - `git merge-tree --write-tree` exits 0 against 27 open heads.

## 2026-09-17 — claude (review session), 06:30–06:47 PDT

- **#263's accuracy review failed `318444d`, on small text edits** (measured by the reviewer). Fixed here:
  - Row 2's plain-words VERIFY had `dev` in backticks, which `/verify` would run.
  - Rows 5 and 15, and Done rows 36 and 37, named several test files in one VERIFY. Each now names one. The new Done commands exit 0 on `dev`'s code.
  - Rows 9 and 22 predated D19, and rows 24 and 26 gave a PDT time in a UTC file.
  - Row 47 was in Done, but its VERIFY reads this branch's PLAN.md. It is in progress until #263 merges.
  - Rows 61 and 63–67 now say their failing tests are stored as `.test.ts.txt` on the evidence branch. Row 61 also says the draft branch's test has another name.
  - Rows 51 and 53 named old heads.
- **D17's status is back to `open`.** `4ba6676` had changed it in place to "answered by D19", which is not one of this file's statuses and edits an entry. D19 supersedes D17. D19–D21 give their reasons in their text, without the *Reason:* and *Revisit if* labels, and are not edited.
- **Corrections to earlier entries** (measured by #263's review unless marked):
  - The entry that gives `checks` on `e6fe5cb` as completed at 04:23:52Z is wrong: it completed at 04:23:38Z.
  - "The §8 ticks are unchanged: 31 of 35" gives the whole file's count. §8 alone has 16 of 20 ticked.
  - "Every run since then ends `failure` within about five seconds" is not true of every run: one of the 13 refused runs took 39 s.
  - D22 and row 71 (at `f1348c8`) credit #273's review with all four `$` patterns. It measured `$$`, `$&` and `$'`. The review session measured `` $` `` at 06:43 through `createProject` on `dev`'s code (below). Row 71 now says who measured what; D22 is not edited.
  - The times in this file's headings are PDT, as each heading says.
- **Delta review A passed #267 (`06617e7`), #268 (`5bb5f95`) and #272 (`ffc91ae`).** A fixer is working on the low items:
  - #267: a test that pins `init`, and one comment. #267's delta review also found `session.ts:261`'s doc wrong on dev (row 72).
  - #268: fences read as CommonMark reads them, and a test for `###`.
  - #272: the mutation table's test numbers.
- **Delta review B passed #270 (`0f74a45`), #269 (`e5f5d79`) and #261 (`3068462`) with conditions.**
  - #261's was one stale sentence in its description, now corrected on GitHub.
  - A fixer is working on #269 (writes through `satisfies`) and #270 (`finally` blocks and the write queue's binding).
- **Plan review, round 9:**
  - D22 agreed.
  - #271's safety net agreed, on two conditions, relayed to its fixer: a whole-word `--test` alongside `node` or `tsx`, and the npm version named at the allow-list.
  - Row 56 was rejected as written, and reworked at `cdadb33`: a run whose files were not looked for keeps its task where it is; the step says where a run's words end; the test's header says what it pins. It merges after #271.
  - The handling of #273's conditions was signed.
- **The Merge Rehearsal page** is at version 3, with all 28 PRs and their states read at 06:35.

Evidence (measured, Node 22.16.0):
- **This branch's code equals `dev` at `e6fe5cb`** (`git diff --quiet origin/dev -- src test scripts package.json` exits 0). There:
  - `tsx --test test/a-gate-that-cannot-fire-is-not-a-gate.test.ts` exits 0;
  - `tsx --test test/hooks-switched-off-means-no-gate.test.ts` exits 0.
- **`createProject` on `dev`'s code**, one fresh root per name, first line of PLAN.md:

  ```
  "Plain Name" -> "# Plain Name" right (20 lines)
  "Save $$ Fast" -> "# Save $ Fast" WRONG (20 lines)
  "Rev $& Share" -> "# Rev <Project Name> Share" WRONG (20 lines)
  "Tom $' Next" -> "# Tom " WRONG (39 lines)
  "Tick $` Tock" -> "# Tick #  Tock" WRONG (20 lines)
  ```
- **`local-checks`, both exit 0:**
  - `3f5c640` (#273): 2660 tests, 2659 pass, 1 skipped;
  - `f1348c8` (#263): 2658 tests, 2657 pass, 1 skipped.
- **Overlap:** `git merge-tree --write-tree f1348c8 <head>` exits 0 for all 27 other open heads (06:35).
- **Row 56's test:**
  - on `dev`'s `verify.md`: 1 pass, 3 fail;
  - on `717618e`'s: 1 pass, 3 fail;
  - at `cdadb33`: 4/4.

  29 mutations of `verify.md` were each caught by the test that pins them.

## 2026-09-17 — claude (review session), 06:47–08:53 PDT

- **#263's re-review of `0d943ee` passed with conditions**, all small text fixes (measured by the reviewer). Answered here:
  - Row 71 rendered wrongly on GitHub: the `$` and backtick in its project names made an inline-math span. The names are now code spans. The row also gives the call count as the TypeScript parser does (38; `grep` finds 37 lines).
  - PLAN.md §4b's reply to round 1 used "D19" for a first-view rule that never got an entry, while DECISIONS.md's D19 is another decision. A dated note at the end of §4b says so.
  - The PR description overstated rows 61–71 and miscounted, and a new one follows this commit.
- **An earlier try at that re-review stalled.** Its agent waited 90 minutes (07:02–08:34) on a tool call that needed a person's approval. It was stopped and restarted with only shell and file tools, and later briefs say so.
- **Corrections to the 06:30–06:47 entry** (measured by the re-review):
  - D20 and D21 do have a *Revisit if* label; only D19 lacks it.
  - D19–D22 all lack a *Reason:* label.
  - D22's "tonight's" means the night of 2026-09-16 to 2026-09-17, PDT.
  - Two earlier entries give their measurements inline, with no `Evidence:` line: the one that begins "Local checks were run on the PR heads that were new since the last table", and the 05:37–06:11 entry.
- **#267, #268, #269 and #270.**
  - Their low items and conditions were answered at `4731112`, `3c38f4e`, `e0cb3a6` and `c182f26`.
  - A second delta review passed `4731112` and `e0cb3a6`, and passed `3c38f4e` and `c182f26` with one condition each.
  - Those were answered at `cb739d2`, `fad0df6`, `2f3dcc9` and `5f97e50`. Each new check was confirmed against the reviewer's mutant.
  - `local-checks` passed on all eight heads.
- **#271.**
  - `3aacd2c` answers the third review with a net for any `--test` that no read run covers. `local-checks` passed.
  - The fourth review passed it with one condition (a `#` read as text, and `$$'`), and a fourth fixer is working on it.
  - Its #254 conversion was regenerated for `3aacd2c` and added to the evidence branch at `4e34807`.
- **#274 opened at 08:12, as row 56.**
  - Its first review passed `c16193b` with conditions: a judgement call, where a run's words end, and a run naming no file.
  - Plan review rounds 10 and 11 led to one closed shape (D23), at `314af65`. `local-checks` passed, and a fresh review is running.
- **New rows:** 73 (an exit code that hides a failure) and 74 (`write-a-task` points to `verify.md`'s shape).
- **The Merge Rehearsal page** is at version 9.

Evidence (measured, Node 22.16.0):
- **`local-checks` statuses**, each exit 0:

  | Commit | PR | Tests | Pass | Skipped |
  |---|---|---|---|---|
  | `cb739d2` | #267 | 2681 | 2680 | 1 |
  | `fad0df6` | #268 | 2667 | 2666 | 1 |
  | `2f3dcc9` | #269 | 2663 | 2662 | 1 |
  | `5f97e50` | #270 | 2685 | 2684 | 1 |
  | `3aacd2c` | #271 | 2730 | 2729 | 1 |
  | `314af65` | #274 | 2663 | 2662 | 1 |
- **#274's test.** At `314af65` it passes 5/5. It passes 1 of 5 on dev's `verify.md`, and 1 of 5 on `626ad5a`'s. 35 mutations of `verify.md` are each caught.
- **Real VERIFYs against the shape.** 67 backticked spans in dev's PLAN.md and in this branch's TASKS.md and PLAN.md hold `node` or `tsx` and `--test`. 64 fit the shape; the other three are prose mentions (`tsx --test` twice, `tsx --test a b`).
- **Folders.** `node --test sub/` with one test file inside: exit 1, `# tests 1 # fail 1`.
- **Overlap.** `git merge-tree --write-tree` exits 0 for:
  - each of `cb739d2`, `fad0df6`, `2f3dcc9` and `5f97e50` against the 27 other open heads (08:03);
  - `3aacd2c` against 27 (08:07);
  - `314af65` against 28 (08:41).

## 2026-09-17 — claude (review session), 08:53–09:12 PDT

- **A delta review passed `12aa4fa` and `bd8b505` with conditions**, all text (measured by the reviewer). What held:
  - GitHub renders no math span in the four files;
  - every row reads as 4 cells (5 in Done);
  - the files grew only by appending.

  Answered here: rows 52, 73 and 74 said slightly more than was measured, and are reworded. The rest are corrections to earlier entries, below.
- **Corrections** (measured by that review unless marked):
  - **The shape count.** D23's *Reason* and the 06:47–08:53 entry give the shape count as "67 backticked spans, 64 fit, 3 prose". That does not reproduce.
    - At `0d943ee` it is 68, 65 and 3.
    - At `bd8b505` it is 72, 65 and 7, because row 56's new text adds prose spans.
    - Counted by VERIFY commands, the review session gets 74 at `bd8b505`: #263's VERIFY column, plus the span that ends each "Done looks like" line in dev's and #263's PLAN.md. Of these, 62 have `node` or `tsx` and `--test`, and all 62 fit #274's shape (measured by the review session).
    - The conclusion stands. D23 is not edited.
  - **D23's `2>&1` example.** D23 lists `node --test a 2>&1` among the runs a prose reading "lets through". That reading held back a passing task instead, by sending the agent to `ls 2`.
  - **The stall.** The stalled agent waited 92 minutes (07:02–08:34), not 90.
  - **#269's check.** The 06:47–08:53 entry says each new check was confirmed against the reviewer's mutant. That holds for #267, #268 and #270. #269's `2f3dcc9` changes only a comment, confirmed against the cast write it names.
  - **Row grouping.** #263's description put rows 70 and 71 among the Honesty Sweep's findings. Row 70 comes from #270's re-review, and row 71 from #273's review (D22). The description is corrected.
- **#274 is at `35f69da`.**
  - The review of `314af65` passed the shape with conditions.
    - The runners skip a test file under `node_modules` even when `ls` finds it, so such a name is now outside the shape.
    - The test pinned phrases that a rule change could get past: a table row the test's parser skipped, or a runner form written in plain words. The agreed text is now pinned whole, and any table line that is not a two-cell row fails.
  - Also fixed: ASCII names, single spaces, lower-case endings, "not found" (with what `ls` said), and a precise "did not finish" row.
  - Measured:
    - the test passes 4/4;
    - 14 new mutations, including the review's bypasses, and the 20 earlier ones that still apply, are all caught;
    - of 504 generated commands, 176 fit the shape, and #271 reads all 176 the same;
    - `local-checks` passed.
  - A short review is running.
- **#271's round-4 fixer** was also given the `node_modules` finding: `testRuns` at `3aacd2c` reads such a run as checked.

Evidence (measured, Node 22.16.0):
- **`local-checks` on #274's head.** `35f69da` (#274): 2662 tests, 2661 pass, 1 skipped, exit 0, posted at 16:10:31Z.
- **#274's test.** It passes 4/4 at `35f69da`. On dev's `verify.md` tests 1 and 2 fail. On `314af65`'s, test 2 fails.
- **Overlap.** `git merge-tree --write-tree` of `35f69da` exits 0 against the 28 other open heads (09:09).

## 2026-09-17 — claude (review session), 09:12–09:35 PDT

- **A delta review passed `eda6515` with conditions**, both text fixes (measured by the reviewer). Answered here:
  - Row 56 dated the `node_modules` rule to `314af65`, but `35f69da` added it. The row now names #274's head, `e6232c2`, and gives each review's conditions with the commit that answered them.
  - The 08:53–09:12 entry marks its corrections "measured by that review unless marked". Two of them the review had not checked:
    - the mutant confirmations were the review session's own measurements, recorded in #267's, #268's and #270's descriptions;
    - the stall's times come from the stopped agent's transcript, 07:02:21 to 08:34:55 (read by this review).
- **Corrections** (measured by that review unless marked):
  - **Shape counts.** The counts in the 08:53–09:12 entry (68/65/3 at `0d943ee`, 72/65/7 at `bd8b505`) count backticks in the source. GitHub renders three of the fitting spans as literal text inside indented code blocks (dev's PLAN.md line 358; #263's PLAN.md lines 362 and 980). Counted as rendered, the figures are 65/62/3 and 69/62/7. Either way, every real VERIFY fits.
  - **#263's description.** It said "two smaller slips" where there are three. Its row-grouping item corrected the description itself, not an earlier entry.
  - **The 504/176 probe.** It read #271's worktree, which by then held its fourth fixer's uncommitted edits. Re-run on a clean `git archive` of `3aacd2c`, it gives the same 504 commands, 176 in the shape, and 0 read differently (measured by the review, and again by the review session).
  - **What the runners skip.** They skip only a path that begins with `node_modules/`, and `sub/node_modules/…` ran. #274's shape leaves out any name with `node_modules` in it, which is stricter.
- **#274 is at `e6232c2`.** The review of `35f69da` passed it with conditions (measured by that reviewer):
  - Text added outside the pinned parts passed: a paragraph before step 1 that overrode the steps, frontmatter keys, and new sections. The test now compares the whole file, block by block.
  - A run the tool moved to the background, which later exited 0, matched two rows. The rows for a finished run now begin "Finished with".
  - `node` without `--test` had no rule. Such a command is now judged by its exit code.
  - Measured at `e6232c2`:
    - the test passes 4/4;
    - the review's twelve additions and six earlier bypasses are all caught;
    - Windows line ends and a rewrapped block still pass;
    - `local-checks` passed.

Evidence (measured, Node 22.16.0):
- **`local-checks` on #274's new head.** `e6232c2` (#274): 2662 tests, 2661 pass, 1 skipped, exit 0, posted at 16:34:17Z.
- **Overlap.** `git merge-tree --write-tree` of `e6232c2` exits 0 against the 28 other open heads (09:33).
- **#274's test.** With dev's `verify.md`, tests 1 and 2 fail. With `314af65`'s or `35f69da`'s, test 2 fails. At `e6232c2`, it passes 4/4.

## 2026-09-17 — claude (review session), 09:35–11:18 PDT

- **#271 passed its fifth review, with no conditions** (measured by the reviewer). That closes five rounds: four reviews passed with conditions, each answered, and `c953a04` answers the fourth.
  - **What `c953a04` changed:** the parser keeps comments so the net reads them; a split quote inside `$(…)`, `${…}` or backticks pairs as bash's does; `$$` is a variable; plain brace lists are spread into files; `node` and `tsx` count inside a longer word; every `$'…'` escape is decoded; and a file under a top-level `node_modules`, which the runners skip without a word, gets its own note.
  - **The reviewer measured:** 21 commands from the earlier conditions come back failed or noted, on Node 22.16.0 and 24.3.0; no new silent pass in a 33-command battery; no new false failure; 12 of 12 mutations caught; 0 of 3,619 spans changed in the repository's real VERIFYs; and clean merges with all 28 other open heads, with #254's conversion applying.
  - **Two notes it leaves:** a quoted brace with no comma gets a note it does not need, and a line continuation in the middle of a word is noted rather than failed. Neither hides a missing file.
- **#274 and this branch each passed a review of their last commits** (measured by that reviewer).
  - #274's whole-file pin holds: 25 rule changes each fail, 15 of them outside the parts compared one by one. A Windows-line-ending copy and two rewraps still pass.
  - Its description said the `checks` run takes about 4 s; on `e6232c2` it took 3 s. The description is corrected.
  - This branch's row 56 and the labels in the 08:53 entry were found true, and row 52 was stale rather than wrong: #271 moved to `c953a04` 23 minutes after `8c76ddd` was written. Row 52 now describes `c953a04`.
- **#271's reviews and measurements are on the evidence branch** at `d6080ce`, in `docs/pr271-evidence-2026-09-17/`, with its regenerated #254 conversion beside the other conversions. Its description used to cite files that were only in the review session's notes.

Evidence (measured, Node 22.16.0):
- **`local-checks`, each exit 0:**

  | Commit | PR | Tests | Pass | Skipped |
  |---|---|---|---|---|
  | `c953a04` | #271 | 2739 | 2738 | 1 |
  | `e6232c2` | #274 | 2662 | 2661 | 1 |
  | `8c76ddd` | #263 | 2658 | 2657 | 1 |
- **#271 at `c953a04`:** tasks 90/90, verify 29/29, harness 22/22, tasks.dom 18/18, tasks-view.dom 14/14, bridge-fields-are-read 2/2, unused-types 4/4, ipc-readers 5/5; both typechecks exit 0.
- **Overlap:** `git merge-tree --write-tree` of `c953a04` exits 0 against the 28 other open heads (10:30), and its conversion applies to the merge with #254 (just before 10:31).

## 2026-09-17 — claude (review session), 11:18–12:18 PDT

- **A second merge rehearsal merged all 29 open PRs into one tree and tested it** (measured by the
  rehearsal agent; its report and evidence are on the evidence branch at `87460a7`).
  - Base `origin/dev` `e6fe5cb`; heads read at 11:51 and re-read unchanged at 12:04 and 12:10.
  - Final tree `f3e5d03`. `ci-local.mjs` passed on it: **2992 tests, 2992 pass, 0 fail,
    0 cancelled, 0 skipped**, coverage 88.99 / 89.85 / 95.14.
  - **No conversion needed adjusting**; all passed `git apply --check` on today's heads. Four
    merges conflicted and each hand-resolution came out byte-comparable to the recorded one.
  - Both cross-PR gaps were re-measured on that tree and **both still hold**. Five pairs were
    checked together and agree: #258 + #256, #259 + #272, #269 + #270, #268 + #271, #257 + #270.
- **The train's first two steps were rehearsed as rebases**, on throwaway branches, which is the
  route the git rules require and neither rehearsal took. Four things would have stopped a person
  (measured by that agent; the first two re-measured here):
  - **The local `dev` branch is 28 commits behind** — `ab2dadf` from 2026-09-15 against
    `origin/dev` `e6fe5cb`. `git rebase dev` in this checkout succeeds quietly onto a
    two-day-old base.
  - **A `-resolution-*.diff` is not an appliable patch.** It is `--remerge-diff` output whose
    "before" side holds conflict markers. Counted here: the four resolution files carry 2, 4, 4 and
    12 marker lines, and every `.patch` and `-conversion.diff` carries none.
  - **One recorded resolution, two rebase stops.** The record is the file's final shape, so pasting
    it at #265's first stop lands the second commit's content one commit early.
  - `git rebase --continue` opens an editor, so an unattended run needs `GIT_EDITOR=true`.
- **The two gaps now have written resolutions** on the evidence branch, which was the plan review's
  first item. Gap (a) carries a patch and a test that goes 4 of 11 to 11 of 11 on the merged tree;
  gap (b) is two doc comments, and says plainly that no test can pin them and why.
- **#258's three unread commits were read** (by a fresh-context reader; every citation re-read
  here). Two wording defects, neither touching what the code does — rows 75 and 76. The commits'
  other claims check out, including that #258's harness comment holds under either merge order with
  #256, and that its test 20 cannot leave a file broken for another test.
- **Corrections to my own published pages.** The V3 plan page still listed Q8 and #237 as open
  gates; both closed early on 2026-09-17, and it now says so in a dated note rather than a silent
  swap. The rehearsal page said its tested tree was `cdba27c`, the 05:37 heads; it now names
  `f3e5d03` and carries the rebase findings.

Evidence (measured, Node 22.16.0):
- **All 29 heads unmoved.** Compared against the rehearsal page's own pinned table at 11:59; 29
  compared, 0 moved. `dev` `e6fe5cb` and `main` `ad762bb` at 11:59 and again at 12:13.
- **Conflict markers**, counted with `grep -c` over `conversions/`: `264-resolution` 2,
  `265-resolution` 4, `C3-258-resolution` 4, `C7-266-resolution` 12; the other fourteen files 0.
- **Local `dev`:** `git rev-list --count dev..origin/dev` = 28.
- **Evidence branch:** `d6080ce` → `87460a7`, 22 files, 1,649 insertions, committed at 12:17:19 PDT and pushed straight after.

## 2026-09-17 — claude (review session), 12:39 PDT

- **A fresh-context reading of `dev` found nine sentences that state what the code does and are
  wrong about it** — rows 78 to 86. The class was chosen because the night's findings kept having
  this shape rather than being about the code. The reader ran nothing; every citation below was
  re-read here against `e6fe5cb` unless marked.
  - **The sharpest is `.claude/settings.json` line 22** (row 78), which says of its own allow list
    that nothing in it reaches the network or deletes anything, twelve lines above `WebFetch`,
    `WebSearch` and three package-manager install entries.
  - **`docs/running.md:170`** (row 80) says `confirm()` does nothing in Electron, which would make
    the project delete's only guard dead. It is not: `test/dialogs-electron-has.test.ts` exists to
    settle this and records that `confirm` was driven in the running app end to end. That is that
    file's measurement, repeated here, not one of mine — the doc is wrong and the guard is real.
  - **Five weaker candidates were seen and not reported**, to keep the pass at the agreed eight.
  - **Screen text was left out on purpose** — mic and music, control labels, `index.html`, the
    floor — so that a later pass can compare like with like.
- **#263's own head was re-checked after its last commit** (measured 12:19–12:24 PDT):
  `local-checks` passed on `81e9b6f` with 2658 tests, 2657 pass, 1 skipped; `git merge-tree`
  against all 28 other open heads exited 0 every time; and the two guards that read these files
  pass against the merged pair — #268's ticked-line test 9/9, and #271's five files 90, 29, 22, 18
  and 14. The three rows added then read as uncheckable, and nothing treats the backticked file
  names in row 75's text as a command.
- **A correction to my own record.** The 11:18 entry said the four resolution files "carry 2, 4, 4
  and 12 marker lines" without saying which markers. Counting `<<<<<<<` and `>>>>>>>` gives those
  numbers; counting `=======` as well gives 3, 6, 6 and 18 (measured here). The evidence branch
  and the maintainer's page now name the pattern. What the sentence is for — markers in those four
  files and none in the other fourteen — is unchanged.
- **The plan review's list is finished.** Its three items were the gap resolutions, the rebase
  dry-run and this reading; all three are done, and its round-13 conditions are applied to the
  train's written steps.

## 2026-09-17 — claude (review session), 12:45 PDT

- **The plan reviewer checked rows 78, 79, 80 and its own seed against `dev` itself and landed
  every citation** (measured by it). It corrected two things, and both corrections are taken.
  - **Row 78 was overstated, and in the direction that costs most.** It said the prose is the wrong
    half because the allow entries look deliberate. The file's own argument points the other way as
    well: it denies `Bash(wget:*)` (:134) and explains at :39-42 that `curl` is unlisted on
    purpose, so that "anything reaching off this machine is visible before it happens rather than
    silently refused", with `npx` and `pip install` named as getting the same treatment. On that
    principle it is the four allow entries that are out of line, not the summary sentence. The list
    contradicts the file's own principle, not only its own summary. Verified here against
    `e6fe5cb`. The row now states both readings and settles neither: `.claude/settings.json`
    ships and seeds every workspace the office creates, so which half gives way is the maintainer's
    call. The row's owner is now the user, beside #255 — both are "what may leave this machine
    without being asked".
  - **Row 80 needed to say what kind of record its evidence is.**
    `test/dialogs-electron-has.test.ts` is a source check; its `confirm` finding is a run
    somebody drove in the app and wrote into the header at :28-31, and the suite does not re-run
    it. Writing "the test proves `confirm` works" would have repeated the night's own mistake one
    level up. The row now says so, and carries two more things to fix in the same place:
    `src/renderer/views/privacy.ts:207`, which repeats the doc's claim in the code, and that
    header's own count of "two view files", where one carries the wording — three files mention a
    sandboxed renderer and the other two say the different, correct thing about a screen reader
    (counted here).
- **Row 80's VERIFY cell broke the rule this branch is about.** It ended with a backticked file
  name, where an uncheckable VERIFY is plain words with no backticks. Found by the re-check agent
  at 12:43 PDT, which also measured that the row still parsed to no command — but only because
  `isBarePath` declined the span, not because the cell was prose. A single-token backticked
  command there would have become the row's command. The clause is now in the task text.
- **#263 at `367ed6b` was re-checked** (measured 12:40–12:43 PDT): `local-checks` passed, 2658
  tests, 2657 pass, 1 skipped; `git merge-tree` against all 28 other open heads exited 0 every
  time; #268's ticked-line test 9/9 and #271's five files 90, 18, 29, 22 and 14 against the merged
  pairs; and #271's parser over the real `TASKS.md` parsed 86 tasks with 0 unreadable, with all
  nine new rows coming out as no command and not checkable.
- **Twelve rows were queued today — 75 to 86 — and every one is unassigned.** The queue, not the
  search, is now the bottleneck.

## 2026-09-17 — claude (review session), 12:54 PDT

- **A reading of the screen-text surfaces the sweep had left out found eight things a person sees
  that the data behind them cannot back up** — rows 87 to 94. These are the surfaces six earlier
  readers were told to skip: `views/mic.ts`, `views/music.ts` with `shared/music-view.ts`, the
  floor, `index.html`'s static text, and control labels against their handlers. The reader ran
  nothing; the two strongest were re-read here against `e6fe5cb`.
  - **Two of the eight are the code's fault, not the text's**, which is the rarer and worse shape.
    Row 87 is a file that contradicts its own comment: `music.ts:177-180` says the network
    setting has three states and that rendering the unread one as either of the others is "the
    failure the third state exists to make impossible", and :181 is
    `setup?.networkAllowed ?? 'on'`. Row 88 is a `catch` that inspects no error and treats a
    denied microphone permission as an unplugged device, deleting a saved choice on the way.
  - **Row 89 is the one aimed at the reader who cannot check it:** `index.html:71` promises a
    screen reader that the roster lists the same states as the floor, and the roster row carries no
    task outcome, no pose and no doing line.
  - Eleven further candidates were seen and not reported, mostly pictures rather than strings. One
    was chased and cleared: `index.html:686-689`'s claim that employees cannot dispatch anyone or
    change files is backed by `EMPLOYEE_WITHHOLDS` at `main.ts:1094` and `session.ts:429`.
- **Twenty rows were queued today — 75 to 94 — and every one is unassigned.**
- **A request came in for work that already exists.** The gap described — `loadRegistry` counting
  rows it could not use and `openRegistry` dropping that count, so a registry of unusable rows
  reads as no conversations — is #269, open since today and reviewed four times, with #270 for the
  half where the next save deletes those rows. Measured here: #269's test passes 5 of 5 on
  `2f3dcc9` and #270's 27 of 27 on `5f97e50`. Nothing was built. The finding was right and it is
  not unfixed, it is unmerged.

## 2026-09-24 — claude (jev teammate)

- **Jev evaluated and declined (#275, D24).** A hosted decision model scored 79/85 on real
  VERIFY cells in two runs, against 82/85 for a regex. Its only wins were on examples the evaluator
  wrote. Method and numbers are in PLAN.md §4c.
- **The regex shipped instead (#276).** `isVerdict()` names a VERIFY written as a verdict on the
  task panel's row and in its summary.
- **#271 and #263 rebased onto `dev` and merged.**
  - #271 needed two commits to hold on the new `dev`: it now passes the test context to
    `workspace()` and makes its folders with `tempDir`, which #254's guard requires.
  - #263's DECISIONS.md already used D15, so the Jev decision was renumbered D15 → D24.
- **`dev` released to `main` (#277, `84fa331`)** from `dev` at `4971f2a`, at Vish's request: 76
  PRs since #194 on 2026-09-03. Each of this session's five merges (#276, #275, #271, #263, #277)
  went in only after a passing `local-checks` run on the exact head merged, with `dev` unmoved
  since that run. Other sessions' merges today were not checked here.

Evidence:
- `node ci-local.mjs --post-status` on `4971f2a`, 19:04Z: `typecheck passed`, `build passed`,
  `2952 tests: 2952 pass, 0 fail, 0 cancelled, 0 skipped`, `result PASSED`.
- Right after #277 merged, `git merge-base --is-ancestor origin/dev origin/main` exited 0 and
  `git diff --stat origin/dev origin/main` printed nothing.

## 2026-09-24 — claude (review session), 15:27 PDT

- **The merge train ran and `dev` was released to `main`.** `main` is `a2a1dc5` and contains every
  commit on `dev` (`git rev-list --count origin/main..origin/dev` = 0).
  - Twenty-six PRs were merged from this session, in the rehearsed order, each rebased onto
    `origin/dev` by name, its conflicts resolved from the conflict, its conversion applied, then
    typechecked, tested, force-pushed with `--force-with-lease` pinned to the reviewed head, and
    gated on a passing `local-checks`. No branch was deleted.
  - **#271 and #263 were merged by another session** at 10:08 and 10:10 UTC, on heads this session
    never saw. Both are ancestors of `dev` and `dev` passes; how they were prepared is not
    something this session can vouch for.
  - **#277 released `dev` at `4971f2a`** earlier the same day, before #268, #274 and #261 had
    landed. **#278** carried those three and is what completed the release.
- **#278 was merged on a red `local-checks`, on the maintainer's explicit decision, and this entry
  exists so the history does not imply otherwise.** What was measured on `8cc1c69`, the commit it
  merged:
  - `ci-local.mjs` on a quiet machine: **3012 tests, 3012 pass, 0 fail, 0 cancelled — PASSED**.
  - `ci-local.mjs` three times under load: **0 failures every time**, with 2, 1 and 1 cancelled, at
    loads of 20.6→29.6, 12.2→13.7 and 8.2→16.0 on 8 CPUs. A run took 147 s where it normally takes
    about 60.
  - The suite run directly, no coverage, same commit, load about 13: **3012 of 3012, 0 cancelled,
    exit 0**.
  - The suite run directly **with** coverage, same commit, load 8.2→16.0: **0 fail, 1 cancelled**.
  - So the variable is coverage instrumentation on a contended machine, not the code. The red status
    on `8cc1c69` is a timeout. That is an explanation, not an excuse: the status is red, the merge
    happened anyway, and the decision was the maintainer's.
  - **Another session found the cause and fixed it while this was being written**, and its account is
    better than the one above. #281 splits `test/local-checks-say-what-they-ran.test.ts` — 1,423
    lines, added by #261 — into five files with a shared rig, and gives posting its own file, "so the
    slowest local-checks file keeps half its minute". The ceiling is per file, so one file that large
    only fits while the machine is idle. That is why the cancellations began the moment #261 landed
    and not before, which this session had noticed and not explained.
  - The failing run **overwrote the report for that commit**, which is keyed by SHA, so the clean
    3012-test report is no longer on disk. The figures above are from this session's transcript.
- **Two rows added**: 95, that `ci-local.mjs` cannot tell a timeout from a failure; and 96, that the
  60-second ceiling is a decision for the maintainer rather than for each release.
- **The machine was never quiet.** A watcher polled for 40 minutes for a one-minute load below 5 and
  never saw one, because other sessions were working — one of them writing up this same release.
  Their suite lock was left alone rather than removed; it was held by a live pid.

Evidence (measured, Node 22.16.0, darwin, not CI and not Linux):
- **`main`:** `84fa331` → `a2a1dc5`; `origin/main..origin/dev` is 0 commits.
- **What #278 carried:** #268, #274, #261 — 6 files, 2801 insertions, 6 deletions.
- **`dev` at `8cc1c69`:** typecheck both passes exit 0, build passed, and the suite 3012/3012 on a
  quiet machine.

## 2026-09-25 — claude (jev teammate), 03:22 UTC

- **#281 split the local-checks test, #279 updated the status board, and #282 released both to
  `main`.** `main` is `57c2b93`, from `dev` at `123bda2`.
- **Correction to the 15:27 PDT entry above.** #281 splits the test into **six** files, not five.
  An intermediate version had five. Its slowest file then took 33.4 s of the 60 inside a loaded
  suite, so posting was given its own sixth file, which that entry does mention.
- **How #271 and #263 were prepared,** which that entry could not vouch for, is in their own PR
  descriptions:
  - Both were rebased onto `dev` and force-pushed with `--force-with-lease` pinned to their old
    heads.
  - Each was merged pinned to a head with a passing `local-checks`, with `dev` unmoved since that
    run.
  - #271 gained two commits for #254's changes to `workspace()` and `tempDir`.
  - #263 renumbered the Jev decision from D15 to D24.

Evidence:
- #281 on `f4964e8`, 2026-09-24 22:52Z: `ci-local.mjs` gave `3012 tests: 3012 pass, 0 fail, 0 cancelled`, at
  load 7.3 → 8.3. The six files' times in that run, summed from the suite's own per-test
  durations, are 9.0, 11.1, 14.0, 5.1, 8.7 and 12.3 s.
- #282 on `123bda2`, 2026-09-24 23:15Z: `ci-local.mjs` gave `3012 tests: 3012 pass, 0 fail, 0 cancelled`,
  `result PASSED`, at load 4.0 → 7.5.
- After #282: `git merge-base --is-ancestor origin/dev origin/main` exited 0, and
  `git diff --stat origin/dev origin/main` printed nothing.

## 2026-09-27 — claude (review session), 23:01 PDT

- **v0.0.1 is tagged and published**, so the release outcome in PLAN.md is ticked. Its VERIFY,
  `gh release list | grep -q .`, exits 0.
  - The tag points at `1ab4004`, checked to be `main`'s tip exactly. `0.0.1` matches
    `package.json`, which is also what electron-builder stamps into the filenames, so the tag and
    the binaries agree.
  - **Two macOS disk images**, both unsigned because `mac.identity` is `null` by the project's own
    choice: `Office.Space-0.0.1-arm64.dmg` (120,542,875 bytes) and `Office.Space-0.0.1.dmg`
    (122,496,378 bytes). GitHub replaces the space in the product name with a dot; the release notes
    first named them with a space, which was wrong, and were corrected.
  - **What was verified, and what was not.** The arm64 app was launched from the packaged bundle and
    stayed running 45 seconds, its log carrying only macOS's own warnings. The Intel image was built
    the same way and **has never been launched** — there is no Intel Mac here. So "usable" is
    measured for arm64 and inferred for x64, and the release notes say so.
  - **The AppImage item stays unticked.** The build config asks for one on `x64` and `arm64`; it
    cannot be produced on macOS and has never been built anywhere.
- **Row 97:** `npm run dist` does not work from a clean worktree. The first attempt at v0.0.1 failed
  because electron-builder will not take a version range, and a worktree has no `node_modules`. The
  build went ahead with `-c.electronVersion=43.4.1`, read from the installed package rather than
  guessed. The symlink that would also have fixed it was deliberately not used: that `node_modules`
  is shared with the session working in the main checkout.
- **The fleet is quiet.** Fourteen peer sessions: three idle but alive, eleven offline, none working.
  Nothing has merged since #284 at 04:20 UTC on 2026-09-25, which is about two days. `main` is two
  commits behind `dev` again, being that same PR.

Evidence (measured, 2026-09-27):
- `gh release list` names one release, `v0.0.1`, marked Latest, not a draft; both assets report
  `state=uploaded`.
- `git rev-list -n 1 v0.0.1` equals `git rev-parse origin/main` = `1ab4004`.
- On `1ab4004`: typecheck both passes and build exit 0; the suite 3012 tests, 3012 pass, 0 fail,
  0 cancelled, 0 skipped, with coverage.

## 2026-09-28 — claude (jev teammate), 06:42 UTC

- **`dev` released to `main` again (#286, `028c64b`)**, from `dev` at `10fa326`, at Vish's
  request. This release is notes only: #284 (the status board names the three releases of
  2026-09-24) and #285 (the release is ticked, and packaging is queued). `main` and `dev` hold the
  same tree.
- **The status board** now names v0.0.1 (published 2026-09-25, tagged at `1ab4004`, the #283
  release) and #286 as the latest release. It points here for the earlier ones, so the next
  release changes one row rather than growing a list.

Evidence:
- `ci-local.mjs` on `10fa326`, 2026-09-28 06:36Z: `3012 tests: 3012 pass, 0 fail, 0 cancelled`,
  `result PASSED`, at load 3.3 → 7.2.
- After #286: `git merge-base --is-ancestor origin/dev origin/main` exited 0, and
  `git diff --stat origin/dev origin/main` printed nothing.
- `gh release view v0.0.1`: not a draft or a prerelease, with assets
  `Office.Space-0.0.1-arm64.dmg` (114 MiB) and `Office.Space-0.0.1.dmg` (116 MiB).
- The Actions run for #286's merge (36387449637) ended `failure` with no steps run, annotated
  with the same Actions spending-limit message as the refusals of 2026-09-17.

## 2026-10-01 — claude (review session), 02:30 PDT

**A correction first, because it is the part that cost something.** The entries of 2026-09-24 and
2026-09-27, and the descriptions of #288 to #292, #296 and the v0.0.1 release notes, all say that
GitHub Actions has refused every job since 2026-09-17 on a spent Actions quota. **That stopped being true at
2026-10-01 08:24:00Z** and I went on asserting it, labelled as measured, for about half an hour of
merging. It is corrected here and in PLAN.md's status board.

- **What it cost.** Release #296 promoted `dev` at `99fef4a` to `main` while `dev` was already
  failing a real CI run. `main` at `ecc2dde` inherited the red. #287 was merged the same way, 13
  minutes after its own branch run had failed.
- **The signal was free and I was not reading it.** A refused run finishes in 3 to 5 seconds; a real
  one takes 4 to 5 minutes. Every run beside the 09-28 merges was 3 to 5 s. The first run with a
  real duration was 195 s, at 08:24:00Z, on another session's branch — and it failed, on the test
  #297 fixes, nine minutes before I started merging.
- **Why the local stand-in could not catch it.** `scripts/ci-local.mjs` runs on this machine's Node
  **22.16.0**; CI resolves `node-version: '22'` to **22.23.2**. The failing test asserted that the
  test runner exits non-zero on a path through a file: true on 22.16.0 and 24.3.0 (exit 7), false on
  22.23.2, which skips the path and exits 0. So the stand-in passed 3060 of 3060 while CI failed one,
  and both were honest about their own environment. I had written "not CI, and not Linux" into those
  same notes; the caveat I wrote is the one that bit.
- **Who caught it.** Not me. The session **office space teammate 3** did, before the release had
  finished its run, and it also disproved my guess that the three open PRs were its own — my guess
  rested on timing, and its commits are signed Opus 5.5 where it is Opus 5. The owner is the session
  **ADE sidebar organization**, which asked that its branches not be rebased; they have not been.
- **Not in `docs/retracted.md`, deliberately.** That file's scope is claims made in a commit
  message or a source comment, and this claim reached neither — measured: no commit body on `dev`
  since 2026-09-17 contains it. It lived in PR bodies, release notes and PROGRESS entries, so the
  correction belongs here, which is the house mechanism for one. I had said I would write it there
  and that was wrong.

**The fix.** #297, 8 insertions and 5 deletions in `test/verify.test.ts`: stop asserting what the
runner exits with on a path through a file, keep asserting the panel's verdict, which holds on every
version because a missing file fails the run whatever the runner said. **The commit is not mine** —
it was written by the session behind #293 to #295 and cherry-picked unchanged, credited in #297's
body. A fourth copy of it now exists; if their rebases do not drop it as already applied, that is
mine to answer for.

**The batch that preceded all this**, five PRs from five agents, each red-first and
mutation-pinned, all merged:

- **#288** a denied microphone is no longer reported as a missing one, and no longer clears the
  chosen input. Its agent found that `mic.dom.test.ts` rejected with `new Error('OverconstrainedError')`,
  whose `.name` is `'Error'` — the test passed **because** the `catch` read the error not at all.
- **#289** the music panel no longer states a network setting it has not read. Its agent found a
  second defect nobody asked about: from the guessed `on`, a press wrote `off`, so the startup
  window could switch the network off for somebody who had it on. It also found `test/dom.ts` had no
  `title` accessor, so a tooltip assertion could never have failed.
- **#290** a Run button runs the task it is on. An unreadable press now runs nothing: the handler
  had omitted the filter, which ran everything, and `dev`'s own handler did the same before the PR —
  measured, so the defect was inherited and not introduced. A second half, `null` plus
  `force: true`, force-ran every unfinished row. Its twelve malformed-payload tests were green for
  the wrong reason under `force: true` alone, which is why they run over both values.
- **#291** a cancelled test is reported as a timeout with its load, not a failure, and posts
  `state=error` rather than silence, because silence cannot tell a timeout from a run nobody
  started. Its first draft would have called a SIGKILLed suite a timeout; `stepRanCleanly` answers
  that once for both the pass check and the verdict.
- **#292** search reads employees' own records and declares the runs it could not read.

**Three tests that could not fail**, found in one batch by three agents, none of them looking:
#288's fabricated `Error`, #289's missing `title` accessor, and #290's twelve tests satisfied by a
guard other than the one under test.

Evidence (measured 2026-10-01, every duration given because duration is what separates a verdict
from a refusal):

| Commit | Event | Duration | Result |
|---|---|---|---|
| `dev` `99fef4a` | push | 287 s | failure, `# fail 1` of 3060 |
| `main` `ecc2dde` | push | 281 s | failure |
| `6bec088` (#297) | pull_request | 273 s | success |
| `dev` `4c9b5fc` | push | 259 s | success |
| `4c9b5fc` (#298) | pull_request | 291 s | success |
| `main` `753342f` | push | 242 s | success |

- `git rev-list --count origin/main..origin/dev` = 0.
- `main`'s last genuine verdict before today: 2026-09-03, 511 s, success.

## 2026-10-01 — teammate 1

**The release we tagged cannot be reached by anybody.** `PLAN.md` ticks "A public release is
published: a tagged GitHub Release with usable artifacts" on `gh release list | grep -q .`, and
that command exits 0 inside a private repository. Measured at 09:28Z: `gh repo view
slug-labz/office-space --json visibility` → `PRIVATE`; both disk images on `v0.0.1` report
`downloads = 0`; 0 stars, no topics, no homepage. The tick is true and the outcome is false, which
is the third test-that-could-not-fail found in this repo this week and the first one in `PLAN.md`
itself. Not untickied here — the sweep for its siblings is with teammate 3, and a tick comes off
only once somebody has read the whole list.

Two more gaps measured the same way, both invisible from inside:

- **No icon, and no image of any kind.** `git ls-tree -r --name-only origin/dev` matches no
  `.icns`, `.ico`, `.png` or `.svg` anywhere in the repository. `build.directories.buildResources`
  points at `assets/build`, which is not tracked, so every artifact so far has worn Electron's
  default icon. `docs/release.md` already said so under "What is not here yet"; nobody acted on it.
- **`README.md` contains no screenshot.** `grep -nE '!\[|<img'` exits 1 on it. For an app whose
  whole claim is that you watch people walk around an office.

**`scripts/release.mjs`** — one command cuts a release, and refuses an unchecked commit. Written
because `v0.0.1`'s notes name the artifacts with spaces where GitHub serves dots, and assert an
Actions outage that had ended six hours before they were published. Both are one mistake: a release
described from memory instead of read off the thing being released.

The gate is a successful run that contains **at least one completed step**. `conclusion == success`
alone would have caught the red `main` of this morning, because a quota refusal is a *failure* in
seconds. The step count catches the quieter case — a workflow reporting green because every job in
it was skipped, which means nothing was checked. Each run's duration is printed beside it, since
that was the free signal all along: the refusals took 3 to 5 seconds where the real runs take 195
to 291.

Checksums cost nothing: GitHub computes SHA-256 for every release asset and serves it as `digest`
on the asset object, so an upload is verified against the local hash without downloading 240 MB
back. The notes the script writes say what a checksum is worth without a signature — it catches a
truncated download and a tampered mirror, and not a bad artifact uploaded here, because then the
file and the hash beside it change together. It is not offered as a substitute for notarisation.

One ordering bug found by probing rather than by reading: `--sha` without `--dry-run` sat among the
repository checks, so asking for it from a feature branch was answered with "releases are cut from
main" — true, and not what was wrong with the command. Argument shape is now checked before tree
state.

`Evidence:` six refusals and both gate verdicts, each run with its exit code read directly rather
than through a pipe (the first attempt read `head`'s status and reported 0 for a run that had
exited 4):

```
PASS exit=2 want=2  an unknown flag is a typo, not a release
PASS exit=2 want=2  no --version
PASS exit=2 want=2  not a version
PASS exit=2 want=2  --sha is dry-run only
PASS exit=3 want=3  wrong Node major
PASS exit=6 want=6  package.json says another version
PASS exit=9 want=9  a real green run is accepted, then it refuses to invent artifacts
  Checks on 753342f — measured, not assumed:
    checks: completed/success · 1 job(s) · 10 step(s) · 242s
  release.mjs: no artifacts in …/release. Nothing to release.
PASS exit=8 want=8  the repo's first commit (0b28095) has no run at all
  release.mjs: no workflow run exists for 0b28095.
```

The 242 s for `753342f` matches the duration recorded independently in the entry above it.

**Not done here, and named so it is a choice:** the script has no test yet. The case it exists to
catch — a run that is green with zero steps — exists on no commit in this repository, so it can
only be tested against a stub `gh`, the way `local-checks-rig.ts` does it. That is a real piece of
work and it is queued, not skipped. A script whose central promise is unpinned is a script that
will quietly stop keeping it.

## 2026-10-01 — claude (release-script test session), 10:08Z

**`scripts/release.mjs` is pinned, and it could not have cut a release.** The entry above named the
missing test as queued work and said why it needs a stand-in `gh`. It is written:
`test/release-refuses-a-commit-whose-check-never-ran.test.ts`, 12 tests, 73 assertions, every
refusal asserting its exit code from the script's own `EXIT` map **and** that nothing was tagged,
released or uploaded. The accept path is always `--dry-run`, and the stand-in `gh` refuses
`gh release create` while recording that it was asked, so a run that ever reached an upload fails
the test loudly rather than passing quietly.

**The bug the test found, before the test passed.** `execFileSync` returns **null**, not a string,
when the child inherits our streams — measured on Node 22.16. `run()` called `.trim()` on that,
`tryRun` caught the TypeError, and `npm run dist` *succeeding* was reported as
`failed (exit undefined)`. The build is the only caller that inherits, so **the script could not
finish a release or a dry run at all**: every run died at exit 9 with a build failure that had not
happened. Fixed in `run()` by returning `''` for a null stdout. Inferred, not measured, why this
survived the hand-probing above: its exit-9 evidence line quotes `no artifacts in …/release`, which
is the check *after* the build, so that probe must have used `--notes-only` — the one flag that
skips the broken path.

Each assertion group was mutation-pinned: 21 mutations of the script, each removing one behaviour,
each required to fail the test that claims it. None survived. The two that matter most are the
`steps > 0` requirement and the `conclusion === 'success'` requirement in `assertChecksReallyRan`,
and removing the null guard in `run()` puts the bug above back and fails the accept path.

`Evidence:` the whole file, measured at 10:07:08Z on a machine at load 9.54:

```
$ npx tsx --test --test-timeout=60000 test/release-refuses-a-commit-whose-check-never-ran.test.ts
ok 1 - an argument error is named as one, wherever you are standing
ok 2 - another Node major is refused before anything is measured
ok 3 - a dirty tree is refused even for a dry run, and graphify-out alone is not dirty
ok 4 - a release is cut from main, and a dry run from anywhere
ok 5 - a version package.json does not agree with is refused, before the branch it is standing on
ok 6 - a tag that already exists is refused, locally or on origin
ok 7 - a commit with no workflow run at all is refused
ok 8 - a run that succeeded with zero completed steps is a refusal wearing green, and is refused
ok 9 - a failed run is refused even when another run on the same commit is green with no steps
ok 10 - a successful run with steps is accepted, and the table names the jobs, the steps and the duration
ok 11 - nothing to release, and an artifact too small to be the build, are both refused
ok 12 - the notes name the files GitHub serves, and carry the hash of each file on disk
# tests 12
# pass 12
# fail 0
# duration_ms 8280.630458
```

`Evidence:` the bug, before and after, against a stand-in npm that exits 0 and prints what it was
asked (so the "failure" is the script's own, not the build's):

```
before:  stand-in npm: run dist
         release.mjs: npm run dist failed (exit undefined).
         exit=9
after:   stand-in npm: run dist
         SHA256SUMS.txt:
         81d05983…6396a  Office.Space-0.1.0.dmg
         Dry run: no tag, no release, no upload. v0.1.0 was not created.
         exit=0
```

`Evidence:` the mutation run — 21 mutations, each run against the one test that claims the
behaviour it removed, each required to fail:

```
M1  the unknown-flag guard                            -> ran 1, failed 1
M2  the required --version guard                      -> ran 1, failed 1
M3  the version shape check                           -> ran 1, failed 1
M4  --sha checked after the branch, not before        -> ran 1, failed 1  (exit 5, "releases are cut from main")
M5  the Node 22 check                                 -> ran 1, failed 1
M6  the dirty-tree guard                              -> ran 1, failed 1
M7  the graphify-out exclusion                        -> ran 1, failed 1
M8  the branch guard                                  -> ran 1, failed 1
M9  the package.json version match                    -> ran 1, failed 1
M10 the remote half of the tag check                  -> ran 1, failed 1
M11 the tag check                                     -> ran 1, failed 1
M12 the no-run-at-all guard                           -> ran 1, failed 1
M13 the steps > 0 requirement                         -> ran 1, failed 1
M13b the same, in the mixed failure/green case        -> ran 1, failed 1
M14 the conclusion === 'success' requirement          -> ran 1, failed 1
M15 the under-50MB guard                              -> ran 1, failed 1
M16 the no-artifacts guard                            -> ran 1, failed 1
M17 servedAs's space-to-dot                           -> ran 1, failed 1
M18 the real hash (a 64-zero placeholder instead)     -> ran 1, failed 1
M19 the jobs, steps and duration in the printed table -> ran 1, failed 1
M20 the null guard in run() (the bug as pushed)       -> ran 1, failed 1

mutations that did NOT fail their test: none
```

`Evidence:` `npm run typecheck`, both configs, after the last edit — no output, exit 0. The full
suite is not run from here (CI's job); `test/temp-dir.test.ts` was run on its own because its third
test holds that nothing under `test/` makes a temp directory except `temp-dir.ts`, and this new file
uses the shared `tempDir(t, …)`: `# tests 4 / # pass 4 / # fail 0`.

**Checked, not fixed, because there was nothing to fix:** no argument combination lets a dry run
reach `git tag` or `gh release create`. The dry run's `process.exit(0)` is the last statement before
the tagging block, and `--sha`, `--notes-only` and `--allow-dirty` all pass through it.

## 2026-10-01 — teammate 1

**Correcting my own entry above, the one headed `scripts/release.mjs`.** It offered eight probes as
evidence that the script's refusals work, and they do. What it did not say, because I did not know
it, is that **not one of the eight ever executed the build** — so the script could not have cut a
release, and my evidence was arranged so that it could not show that.

The entry below mine infers that the probe "must have used `--notes-only`". It is not an inference;
I wrote those probes and can confirm it. Of the eight:

- six are refusals of argument shape or tree state — unknown flag, missing `--version`, a version
  that is not one, `--sha` outside a dry run, the wrong Node major, a version `package.json` does
  not share. Every one of them exits in the preconditions, which run **before** the build block.
- two exercise the gate, and both were run `--dry-run --notes-only`. `--notes-only` is the single
  flag whose purpose is to skip `npm run dist`.

So the covered set was eight-for-eight and the uncovered set was the only path that does any work.
`execFileSync` returns **null** rather than a string when the child inherits our streams, `run()`
called `.trim()` on it, `tryRun` caught the TypeError, and a build that had exited 0 was reported
as `npm run dist failed (exit undefined)`. The build is the only caller that inherits, which is
why nothing else showed it.

`Evidence:` the behaviour, on this machine's Node 22.16.0, independent of the script:

```
$ node -e "… execFileSync('echo',['hi'],{encoding:'utf8'})                   → \"hi\\n\"
          … execFileSync('echo',['hi'],{encoding:'utf8',stdio:'inherit'})    → null
          … null.trim()                                                      → TypeError"
piped    -> "hi\n"
inherited-> null
trim THREW: TypeError - Cannot read properties of null (reading 'trim')
```

**The lesson is the one this script exists to enforce, turned on its author.** `release.mjs`
refuses a release whose green check ran zero steps, on the grounds that a run which executed
nothing is not a pass. My probe suite was green and had executed nothing on the path that matters.
A pass rate says what was checked only if you also know what was not, and eight green lines in a
row read as thoroughness while hiding that every one of them stopped short of the same place.

What now stands between that and a repeat is not care: it is
`test/release-refuses-a-commit-whose-check-never-ran.test.ts`, whose accept path runs a stand-in
`npm` and asserts the script reaches the notes — which fails outright with the null guard removed,
pinned as M20 of 21 mutations, none of which survived.
## 2026-10-01 — claude (readme screenshots), 10:02 UTC

- **The README now opens with a picture of the app.** Title, the one-sentence lede, the floor
  screenshot, the three-line install, and then every section that was already there in its
  existing order and wording. A second shot sits under the "Clone it, and you have an office"
  paragraph, showing the same office with a briefing in flight. Both are captioned as the demo
  workspace, so nobody reads them as a photograph of their own `.claude/`.
- **The shots are the app photographing itself.** The dev harness (`npm run harness`) served
  `dist/renderer/dev.html` — the real renderer against `src/renderer/mock.ts`'s fake bridge — into
  an Electron window at `force-device-scale-factor=2`, and `webContents.capturePage()` wrote the
  PNGs. No workspace was read and no `claude` process was spawned, so nothing was spent and none
  of this machine's project names are on screen. Downscaled 2560×1640 → 1600×1025 with `sips -Z`.
- **`test/no-art-we-may-not-ship.test.ts` now fails, and this branch does not fix it.** Its rule
  is `git ls-files` must contain nothing matching `\.(png|jpe?g|…)$`, written against *somebody
  else's* pixel packs — "this repository ships no art it did not draw". A screenshot of the
  procedural theme is art this repository drew, but the check cannot tell the two apart, so the
  two committed PNGs trip it. Deciding that belongs with whoever owns `test/`; it is named in the
  PR rather than edited around.
- **The all-offices view got no usable shot.** It renders, but the office for a project marked
  `running: true` paints as an empty tinted card with no artwork, even after switching into that
  project so it has a scene — so the campus frame shows two offices and one blank panel.

Evidence (measured, 2026-10-01):
- `npm run typecheck` on this branch: both `tsc --noEmit` passes exit 0, no output.
- `npx tsx --test test/repo-health.test.ts test/privacy.test.ts test/persistence.test.ts`:
  `# tests 63 / # pass 63 / # fail 0`. Its markdown-link check resolves both new
  `![…](assets/screenshots/…)` targets, and the backticked `src/renderer/mock.ts` in the caption.
- `npx tsx --test test/a-ticked-line-names-files-that-exist.test.ts test/markdown.dom.test.ts`:
  `# tests 28 / # pass 28 / # fail 0`.
- `npx tsx --test test/no-art-we-may-not-ship.test.ts` with the PNGs staged:
  `# tests 4 / # pass 3 / # fail 1` — the failure is `no image, sprite sheet, sound or font is
  committed`, at line 52.
- `sips -g pixelWidth -g pixelHeight`: `assets/screenshots/the-office-floor.png` 1600×1025,
  390,637 bytes; `assets/screenshots/work-in-flight.png` 1600×1025, 376,304 bytes. 752 KB total.
- Capture rig and harness both stopped afterwards: `ps aux | grep -i electron` names only
  Claude.app's own crashpad handler, and `lsof -nP -iTCP:8799 -sTCP:LISTEN` prints nothing.

## 2026-10-01 — teammate 1

**The licence check now exempts screenshots the README shows, on Vish's decision.** The entry
above records that `test/no-art-we-may-not-ship.test.ts` failed with the two PNGs committed, and
that the agent which found it was denied the edit and named it rather than working around it.
That was the right call: the rule is about a licence, not about tidiness — every pixel pack this
project priced permits commercial use and forbids redistribution, so a committed pack breaches
the licence somebody paid for and reaches everyone who clones.

A photograph of this app's own procedurally drawn theme is not somebody else's art. The check
cannot tell the two apart by looking at a PNG, so the hole is cut as narrowly as it goes —
`^assets/screenshots/[a-z0-9-]+\.png$`, one flat directory, one extension, a name with no room to
hide a path in — and a second test holds it open no wider: every tracked file there must be a
plainly named `.png`, must be **displayed by `README.md`**, must be under 1 MB, and the directory
must stay under 3 MB in total.

It asks git rather than the disk, like the rest of the file, because the rule is about what is
tracked; a screenshot in a working copy is nobody's licence problem. A first draft read the
directory instead, which both left an unused binding that `tsc` rejected — `tsx` had run it
happily — and was asking the wrong question. Nothing tracked there means nothing is exempted and
the original check is guarding every image by itself, so there is no state in which this goes
quiet while something is let through.

**What no test here can see, so it is written down instead:** a screenshot taken while a purchased
pack is loaded would contain that pack's art and breach the same licence. Screenshots are taken
against the code-drawn theme — the status bar of the shipped one reads "Drawn in code". That is a
human rule and it belongs beside the promise in `docs/themes.md` that packs never leave your
machine.

`Evidence:` the guard mutation-pinned. Each mutation tracked a real file, ran, and was reverted.

```
baseline                                              # pass 5  # fail 0
M1 a subdirectory, capitals and .PNG                  # pass 3  # fail 2
M2 a tracked png the README never shows               # pass 4  # fail 1
M3 a 1.2MB file, displayed in the README              # pass 4  # fail 1
M4 the exemption filter deleted                       # pass 3  # fail 2
restored                                              # pass 5  # fail 0
```

M4 shows two failures rather than one because the constant appears in both tests and the edit
removed it from each; the signal it was checking — that the exemption is load-bearing — holds.
`npm run typecheck` exit 0 on both configs afterwards.

## 2026-10-01 — teammate 1

**Three §8 VERIFYs could pass with the outcome false. Found by teammate 3, who was asked to hunt
for siblings of the release line and found more than that.** Fixed here; the release line itself is
not touched, because it is still true that nobody outside this account can reach the release.

**The boundary line could not fail, two ways.** `test -z "$(grep -rlE "from ['\"][^'\"]*renderer"
src/shared/)"` read only `from`, so three forms of coupling walked past it, and — worse — it
reported success over a directory that is not there, because grep's complaint goes to stderr and
`test -z ""` is true of the empty stdout. §4b has been moving these directories all month. A
rename would have left the line ticked and green over a check of nothing.

It is now `test/the-shared-boundary-holds.test.ts`. It asserts the scanner against five forms it
must catch and four lookalikes it must not, **before** it asserts anything about the tree — because
a pattern that silently stopped matching would pass the boundary assertion on every tree forever,
which is the same defect one level up. `import\(|require\(` was considered for the pattern and
rejected: it flags `await import('./lazy-shared.js')`, which is nobody's violation.

**The trust line named two files.** `tsx --test` skips a name that does not exist and exits 0 as
long as one other name resolves, so renaming `permissions.test.ts` would have left the allowlist
half of "Workspace trust and the tool allowlist are enforced" unproven with the line still ticked.
Split into two lines, one file each.

**The DMG line is untickied.** `grep -q '"dmg"' package.json` matched a config key, not a build.
Its cited evidence was a session log of 2026-08-27; the newest disk image in `release/` is dated
2026-09-03; the published v0.0.1 images were uploaded 2026-09-25. The tick described none of the
three. It ticks again when a release script builds one and that file's sha256 matches the hash
published beside it — the gate #301 produces.

**V1** is ticked with no command. Unlike V2 it did not say why, so it now carries V2's reasoning
explicitly: the evidence is §4b's own twelve ticked items, each separately checked.

**A guard test fired on the split, correctly, and its premise is now gone.**
`a-ticked-line-names-files-that-exist.test.ts` asserted that *some* ticked line names two files, so
that the real file would exercise the parser's two-file path. Splitting the only such line removed
its fixture. The assertion is inverted rather than deleted: no ticked line may name two files,
which is the rule the split establishes. The parser's two-file path stays pinned by the fixture in
the next test, which runs `… test/repo-health.test.ts test/never-written.test.ts` and asserts the
second is reported. Coverage that depends on production data keeping a hazard around is coverage
that argues against fixing the hazard.

`Evidence:` each assertion mutation-pinned — broken deliberately, observed failing, restored.

```
scanner blinded to a pattern that matches nothing   # pass 2  # fail 1
a real violation added to src/shared/actions.ts     # pass 2  # fail 1
    src/shared/actions.ts:78  import '../renderer/side-effect.js'
src/shared/ renamed away entirely                   # pass 1  # fail 2
    src/shared/ could not be read, which is not the same as clean: ENOENT
restored                                            # pass 3  # fail 0
```

The third row is the one that matters: that case is where the old shell check exited 0.

Measured for the split: `npx tsx --test test/trust.test.ts test/zz-does-not-exist.test.ts` exits
**0**. Separately, trust passes 12 and permissions passes 39.

After the change: `npm run typecheck` exit 0 (both configs), and
`a-ticked-line-names-files-that-exist`, `the-shared-boundary-holds`, `trust`, `permissions`,
`tasks` and `verify` each exit 0. The tick checker now reads 17 ticked lines and 13 files — I
wrote 12 into its comment before the measurement came back and corrected it to 13; the number is
read from the assertion's own message, not counted by hand.

**Not done here:** teammate 3's note that a VERIFY may exit 0 while its test's assertions do not
cover the sentence beside it. That is a second pass, and the two lines worth it are the floor line
and the trust line.
## 2026-10-01 — claude (icon), 10:07 UTC

- **The app has an icon.** It shipped with Electron's default until now, and the repository held
  no image file of any kind. `assets/build/icon.svg` is the art, `assets/build/icon.png` is the
  1024x1024 render electron-builder generates the `.icns` ladder from, and
  `scripts/render-icon.mjs` rebuilds the second from the first.
- **What it depicts.** One office floor at night, through the app's own camera: two dark stations
  at the back wall, the manager's desk lit at the front, and somebody crossing the open carpet
  towards it. The lamp is the subject because `NIGHT_SHIFT` is documented as *"the office at
  night, which is what it has always been"* and `#e8b25e` is its one accent.
- **It is drawn in the shipped projection, not an isometric one.** `projection.ts` says
  *"axis-aligned oblique, seen from above … Not isometric, and the difference is the whole
  point."* TILE_W 32 / TILE_D 22 / TILE_RISE 28 appear in the SVG at 5x, and every shade is a
  props.ts factor — TOP 1.25, SHADE 0.71, LID 1.45, UNDER 0.42, SHADOW 0.72, WEAVE 0.93 — applied
  to a NIGHT_SHIFT hue. The three places an icon has to depart from the floor are named in the
  file where they are made.
- **No new dependency.** The renderer is the Electron already in `devDependencies`. Measured here:
  `rsvg-convert`, `inkscape` and `cairosvg` are all absent, and ImageMagick 7.1.2 is present but
  its `svg` delegate shells out to `rsvg-convert`, so `magick` would have fallen back to its own
  internal renderer rather than the engine the art was authored against.
- **The config names the icon rather than relying on `buildResources`.** `build.mac` had no `icon`
  key at all, so a committed PNG in the configured resources directory would have shipped
  Electron's default with nothing reporting it. `build.mac.icon` and `build.linux.icon` are both
  set. There is no Windows target and none was added.
- **`test/icon.test.ts` is new, and it can fail.** It checks that every target in `build` names the
  icon, that git tracks the file the config names, and that the file is a 1024x1024 RGBA PNG whose
  inflated scanlines are all present and are not a flat fill. It failed on exactly the case it
  exists for — the PNG rendered but not yet `git add`ed — before these files were staged.
- **A release defect found on the way.** electron-builder probes the login keychain for a Developer
  ID *before* it reads `identity`, so `identity: null` does not prevent it and a Mac build can stop
  on a system dialog that opens behind the window you are watching. `docs/release.md` now says so
  and gives `CSC_IDENTITY_AUTO_DISCOVERY=false`.
- **Not done, and deliberately:** no Windows icon, because there is no Windows target; and the
  AppImage was not built, because it cannot be produced on macOS. `build.linux.icon` is set and
  **has never been exercised.**

Evidence (measured, 2026-10-01, unless labelled otherwise):

- `file assets/build/icon.png` → `PNG image data, 1024 x 1024, 8-bit/color RGBA, non-interlaced`.
  `sips -g pixelWidth -g pixelHeight` → `pixelWidth: 1024`, `pixelHeight: 1024`.
- `CSC_IDENTITY_AUTO_DISCOVERY=false npm run package` ended
  `• skipped macOS code signing  reason=identity explicitly is set to null`, with no dialog.
- `ls -la "release/mac-arm64/Office Space.app/Contents/Resources/"*.icns` → **351477 bytes**.
  `PlistBuddy -c 'Print :CFBundleIconFile'` → `icon.icns`.
- **The `.icns` is this art, not a default — proven on the pixels.** `iconutil -c iconset` on the
  packaged file, then both its 1024x1024 entry and `assets/build/icon.png` decoded to raw 8-bit
  RGBA with `magick … -depth 8 RGBA:-`. The two buffers are **byte-identical**: 4194304 bytes
  each, sha256 `c74898995cf5b580…f9792ced`, and `cmp` silent. sha256 of the two `.icns` files
  themselves: `2e4cd5ff…aac500` (shipped) and `5a9a78d5…d684cf` (Electron's own, 272259 bytes).
  `magick compare -metric RMSE` also says `0 (0)`, with Electron's default at the same size as
  the control: `15071.4 (0.229974)`, so that comparison can report a difference.
- **Gotcha, for whoever compares images here next: `magick compare -metric AE` cannot be trusted
  on these files.** Run against `assets/build/icon.png` and *itself* it reports **9138**
  differing pixels — about the perimeter of the rounded rectangle, so it is counting the
  semi-transparent antialiased edge. RMSE reports 0 on the same pair. The raw-RGBA `cmp` above
  is the check that needs no metric at all, and it is the one the claim above rests on. The
  self-comparison is the control that caught it; without it, 9138 would have read as a real
  difference between the shipped icon and its source.
- **The render is reproducible.** Re-running `render-icon.mjs` against the committed SVG into a
  scratch directory produced a PNG with the same sha256 as the committed one,
  `e993a87d5226c9c0…5373cfc0`, so the file in the repository is the file the script makes.
- `codesign -dv` on the packaged app → `Signature=adhoc`,
  `flags=0x20002(adhoc,linker-signed)`. The run *without* `CSC_IDENTITY_AUTO_DISCOVERY` was
  deliberately not made, so that the variable changes nothing about the artifact is **inferred**
  from electron-builder attributing the skip to `identity`, not measured by comparing two builds.
- The packaged binary was launched with `OFFICE_WORKSPACE` pointed at a scratch directory, was
  still alive after 8 s with its renderer helper running, and its log carried only macOS's own
  IMKClient and AVCapture warnings. Stopped by pid.
- `npm run typecheck` (both configs) exit **0**. `npx tsx --test test/icon.test.ts` → 4 tests, 4
  pass, 0 fail. `npx tsx --test test/persistence.test.ts` → 10 tests, 10 pass, 0 fail. Load
  average 6.82 at the time, so the full suite was not run here; see the no-local-full-suite note.
- Rebased onto `origin/dev` at `b7957c3` and re-verified after the rebase rather than before it.
  `dev` had gained only `PLAN.md` and `PROGRESS.md` from #299.

## 2026-10-01 — claude (icon), 10:13 UTC

Corrects the entry above, written an hour earlier, on one point it did not measure.

- **"electron-builder refuses anything under 1024x1024" was repeated, not checked**, and it
  appeared as a flat assertion in `scripts/render-icon.mjs`, `test/icon.test.ts` and
  `docs/release.md`. The icon conversion happens inside electron-builder's `app-builder`
  binary, so the constraint is not in any JavaScript on this machine and nothing here has seen
  it refuse a file. All three now say what *was* measured instead: the `.icns` this config
  produces carries a `512x512@2x` entry, which is 1024 pixels square, so a smaller source could
  only be upscaled into that slot. Same number, and now a reason somebody can check.
- Nothing else changes. The icon, the wiring and the test are unaffected.

Evidence:
- `grep -rn 'must be at least\|is too small' node_modules/app-builder-lib/out/` returns one hit,
  about URL protocol schemes, and nothing about icon dimensions. `macPackager.js:51` hands the
  work to `getOrConvertIcon("icns")`, which calls out to the `app-builder` binary.
- `iconutil -c iconset` on the packaged `.icns` listed eight entries, the largest
  `icon_512x512@2x.png` at 1024x1024.
- After the edit: `npm run typecheck` exit 0; `npx tsx --test test/icon.test.ts` 4 tests,
  4 pass, 0 fail.

## 2026-10-01 — claude (icon), 10:21 UTC

CI caught something the local run could not, because the local run was not the full suite.

- **`test/no-art-we-may-not-ship.test.ts` failed on `assets/build/icon.png`**, and it was right to.
  That test exists because `.gitignore` is advice and `git add -f` walks past it, and it refuses
  *any* tracked file in a raster, audio or font extension. The repository genuinely had no image
  file of any kind before this; that was enforced, not incidental.
- **The guard was broader than its own reason, and the reason is the fix.** Its comment already
  says why `.svg` is exempt — *"it is markup somebody can read and review in a diff"*. A binary
  whose **source and renderer are committed beside it** can be reviewed the same way: read the
  markup, rebuild, compare. VISION.md §8 asks for *"original or properly-licensed art"*, not for
  no art.
- **So the rule is narrowed to a conditional exemption, not an allowlist.**
  `OURS_AND_REBUILDABLE` maps `assets/build/icon.png` to the two files that earn it —
  `assets/build/icon.svg` and `scripts/render-icon.mjs` — and a new test asserts both are tracked.
  It fails in **both** directions: a row whose source went missing is a hole, and a row whose
  binary went missing is a stale permission sitting open.
- **`docs/the-licence-question.md` carried a claim this falsifies** and now says so in place. The
  verdict *"third-party art shipped: none"* is unchanged and still true — the icon is first-party.
  What changed is the evidence under it, which read *"no image file of any kind is tracked"* and
  *"the packaged app contains no image"*. Both are now false, the second measurably so: the bundle
  carries `Contents/Resources/icon.icns`.
- **README.md:137 makes the same claim** — *"no runtime dependencies and no committed art"* — and
  was **deliberately not touched**, because another session owns that file and PR #302 is
  rewriting it. Flagged rather than edited.
- **PR #302 will hit this same test.** It adds `assets/screenshots/*.png`, which are raster files
  with no committed source, so the narrowing here does not cover them and should not: a screenshot
  is not rebuildable from anything in the repo. That is their decision to make, not this PR's.

Evidence:
- CI run 36847706329 on `81360d8`: `# tests 3066`, `# pass 3061`, `# fail 1`, `# cancelled 0`.
  The one failure: `not ok 1421 - no image, sprite sheet, sound or font is committed`, at
  `test/no-art-we-may-not-ship.test.ts:50`, naming `assets/build/icon.png` and nothing else —
  `icon.svg` passed, as that file's extension list intends.
- After the narrowing, locally: `npx tsx --test test/no-art-we-may-not-ship.test.ts` → 5 tests,
  5 pass, 0 fail.
- **Both controls fire, so the narrowing did not blunt it.** Copying the icon to
  `assets/themes/limezu/characters.png` and `git add -f`-ing it — the exact smuggling route the
  test exists for — still gives
  `not ok 2 … + 'assets/themes/limezu/characters.png'`. And `git rm --cached assets/build/icon.svg`
  gives `not ok 3 — assets/build/icon.png ships only because assets/build/icon.svg is committed
  beside it`. Both were undone immediately; the tree is clean.

## 2026-10-01 — claude (icon), 10:35 UTC

Corrects the 10:21 entry above on one prediction, and records the rebase that followed.

- **"PR #302 will hit this same test … that is their decision to make" was already out of date
  when it was written.** #302 merged at `fd9e47d` with its own answer, `e0bbeb9` — *"Exempt the
  screenshots the README shows, and nothing wider"* — and #301 merged before it at `fa57eb8`. So
  `dev` moved twice while this branch was in flight and already carried an exemption in the same
  file.
- **Rebased onto `fd9e47d`, and the two exemptions were reconciled rather than one replacing the
  other.** Theirs, `A_SCREENSHOT_THE_README_SHOWS`, and its guard *"the screenshot exemption stays
  the size of a screenshot"* are kept exactly as merged; the main check now filters on both.
  **They are deliberately not merged into one mechanism** — a screenshot has no source to rebuild
  it from and is held by where it lives, what the README displays and how many bytes it takes; the
  icon does have a source and is held by that source being tracked. One mechanism over both would
  be held by whichever half is weaker.
- **No CI run was ever created for `634c220`**, the commit before this rebase. Runs exist for
  `81360d8` (failure) and for other branches either side of it in time. Unexplained; the push
  succeeded and the branch moved. Not chased, because the rebase replaced that commit anyway —
  noted so that a missing run is not read later as a passing one.
- **`README.md` line 154 still says the repository has *"no committed art"*.** That became untrue
  on `dev` itself when #302's two screenshots merged, before this branch adds anything, and it is
  **deliberately not edited here**: #302 owns that file and has just rewritten it. Flagged, not
  touched.

Evidence:
- `git log --oneline b7957c3..origin/dev` lists #301 (`fa57eb8`) and #302 (`fd9e47d`).
- Conflicts during the rebase: `PROGRESS.md` (append point) and
  `test/no-art-we-may-not-ship.test.ts` (both exemptions). Nothing from `dev` was dropped:
  `comm -23` of the `## ` headings on `origin/dev:PROGRESS.md` against the resolved file prints
  nothing.
- After the rebase: `npm run typecheck` exit 0; the ten tests that read `package.json`, git
  tracking or `assets/` → `# tests 116, # pass 116, # fail 0, # cancelled 0`;
  `test/no-art-we-may-not-ship.test.ts` → 6 tests, 6 pass.
- **Both guards still fire, theirs included.** A pack `git add -f`-ed to
  `assets/themes/limezu/characters.png` still fails the main check. A plainly-named PNG added to
  `assets/screenshots/` that the README does not display still fails **their** test —
  `not ok 3 - the screenshot exemption stays the size of a screenshot` — so reconciling the two
  did not blunt the one that was already on `dev`. Both were undone immediately.

## 2026-10-01 — teammate 1

**`README.md` made two claims it could no longer make, both caused by today's own work.**

**"no committed art", under `## Licence`.** False the moment #302's screenshots merged, and
doubly so with the icon. The sentence's *point* was sound — nothing here is anybody else's to
license — so it is reworded rather than deleted: there are no runtime dependencies, every
committed image is this project's own, and the exemptions in
`test/no-art-we-may-not-ship.test.ts` are named along with the fact that each has a test holding
it no wider. Fixing the wording rather than narrowing the claim; a sentence called untrue in a
harmless case gets truer words.

**"An isometric pixel-art office", in the alt text of the screenshot I shipped this morning.**
It is not isometric. `src/shared/floor/projection.ts:24` says so in as many words — *"Not
isometric, and the difference is the whole point. Isometric rotates the floor 45°…"* — and the
projection is axis-aligned oblique seen from above. I wrote "isometric" into the briefs for both
the screenshot agent and the icon agent; the screenshot agent repeated it into alt text that
reached the front page, and the icon agent checked it against the source and told me it was
wrong. The alt text now describes what the picture shows. `PLAN.md`'s V1 heading carries the word
too, but it carries its own history beside it — *"the camera was removed; the module shipped
renamed"* — so that one is a record, not a live claim, and is left alone.

The error is mine twice over: alt text exists for someone who cannot see the image, so an
inaccurate technical word there is worse than in prose, and I put it in two agents' briefs
without checking it against a file that states the opposite in its first paragraph.

`Evidence:` `grep -c isometric README.md` → 0 on this branch.
`git show origin/dev:src/shared/floor/projection.ts | grep -n -i isometric` → lines 24, 120, 154,
each saying the projection is not isometric.

## 2026-10-01 — teammate 3

**The last of the four §8 lines that could not fail, and a test that had drifted from the file it
guards.** #303 fixed three of the four found in this morning's sweep. The fourth was left ticked
on purpose, on the condition that *"a tick comes off only once somebody has read the whole list"* —
which has now happened, so the condition is met and the line has no excuse left.

**`gh release list | grep -q .` could not fail for the reason its sentence is about.** It proves a
release row exists *where this account can see it*, and that is true inside a private repository.
So the line asserting *"A public release is published: a tagged GitHub Release with usable
artifacts"* was green while nobody outside this account had ever been able to fetch one. It is
untickied with plain words and no command, the way the AppImage line is: no command run from
inside the account can be true about reachability from outside it, so attaching one would only
make an unfalsifiable line look falsifiable again. It ticks again when somebody who is not this
account can fetch an artifact.

**`test/a-ticked-line-names-files-that-exist.test.ts` contradicted itself, in the file whose whole
job is catching that.** Its opening paragraph said *"§8 has a two-file line today (trust and
permissions in one command) and both files are there"*. #303 split that line, and inverted this
file's assertion from *some ticked command names two files* to *none may* — but left the paragraph
above it describing the old world. The assertion is right and the words are what drifted, so the
words are fixed and the assertion is untouched. Worth separating two failures that look alike: a
document can drift as a repo moves under it, or an author can change the behaviour and not the
explanation in the same edit. This was the second, which is the one the author can prevent;
teammate 1 named it as theirs before I wrote this.

The count comment in that test is re-measured too, since unticking the release line changes the
number it records: it read 17 ticked lines after this morning's splits, and 16 now.

`Evidence:` `gh repo view slug-labz/office-space --json visibility` → `PRIVATE`, at 03:57 PDT.
`gh release list --repo slug-labz/office-space | grep -q .` → exit 0, inside that private repo.
`gh release view v0.0.1 --json assets` → `Office.Space-0.0.1-arm64.dmg downloads=0` and
`Office.Space-0.0.1.dmg downloads=0`; 0 stars, 0 topics, no homepage.
`npx tsx --test test/a-ticked-line-names-files-that-exist.test.ts` → `# tests 9 # pass 9 # fail 0`
on this branch, Node v22.16.0.
Counted independently on this tree: 16 ticked lines under `## Done looks like`, 13 distinct test
files named on them — the two numbers the comment now records.

## 2026-10-01 — claude (first-run session), 00:58Z

**The packaged app was run the way a stranger would, and `docs/first-run-report.md` is what it
said.** `docs/release-checklist.md` §3 calls itself the only test that matters and the only one
that cannot be automated here; nothing had ever claimed it, all seven boxes were unticked and
`PLAN.md` V4 was unticked for the same reason. §3's workspace questions and the whole of §5 are now
answered in the app's own words, against a `--dir` build of `dev` at `03fc994`. **The boxes are not
ticked.** Half of §3 needs a second user account and a mounted DMG; neither happened, and that half
is queued as task 99 rather than described as done.

**Three passes worth saying out loud, because they are the thing this project is for.** An
unreadable `.claude/agents/` reports *"There may be employees in .claude/agents/ — this office could
not open it to find out"* and a status line reading `staff could not all be read`, never a count. A
settings file with a syntax error reports *"exists but could not be read as settings, so its
permission rules are not in force — this looks exactly like having none"*, and then propagates the
unknown one step further to the approval gate instead of guessing. `ANTHROPIC_API_KEY=x` is named at
startup before anything is spent.

**One failure, and it is the message a stranger is sent to read.** `missingMessage` replaced the
list of paths with its own length above six entries, so the shipped build printed `Looked in 10
places.` and named none of them — while §3 says *"the app names every path it looked in — check that
list rather than guessing"*. Not a rare branch: `installedLocations` returns at least six candidates
on any POSIX host before one `PATH` entry is counted, so the only inputs under the threshold were an
explicit `OFFICE_CLAUDE_PATH` and an empty `PATH`. Every realistic failure took the branch that
prints a number. Fixed, test first. The sibling test named *"when there is nothing, every place
looked is reported"* passed throughout, because it reads `found.looked` and not the sentence anybody
is shown.

**The app calls `safeStorage` itself, and at startup.** `main.ts:1531`'s `void spotify.connected()`
reaches `store.read()` → `canRemember()` → `safeStorage.isEncryptionAvailable()` during handler
registration, for a feature `client.ts:12` describes as off by default. That is what raised the
modal *"Keychain Not Found"* panel for the earlier attempt at this task, which had pointed `HOME` at
an empty directory. `README.md`'s *"no server, no database, and no API key"* was the only sentence in
it about secrets and the README never mentioned the keychain; it now names the one secret that
exists. When the call happens is architectural and is queued as task 98, not fixed here.

**Two further corrections to documents rather than code.** §2's *"`memory/` is absent"* is false
about a build that passes: `memory/README.md` ships on purpose and `build.extraResources` names it,
so a reader checking that box would call a clean artifact dirty. And `OFFICE_HEADLESS=1` now means
the window cannot take the keyboard — `focusable: false` and `showInactive()` — because a driven
boot had fronted itself and swallowed the keystrokes of the person at the keyboard.

`Evidence:` `CSC_IDENTITY_AUTO_DISCOVERY=false npm run package` → `skipped macOS code signing
reason=identity explicitly is set to null`, `release/mac-arm64/Office Space.app`, v0.0.1 arm64.
Packaged binary launched with `--remote-debugging-port`, `--user-data-dir` under
`/private/tmp/…/` and `--use-mock-keychain`; `HOME` untouched throughout, and
`ls -d "$HOME/Library/Application Support/Office Space"` → `No such file or directory` both before
and after every launch.
Empty `OFFICE_WORKSPACE` → `7 on the floor · 5 skills`; no `OFFICE_WORKSPACE` with a virgin
`--user-data-dir` → `7 on the floor · 5 skills` and a seeded `<userData>/workspace` holding all
seven agent files.
`chmod 000` on the seeded `.claude/agents/` → `staff could not all be read · 5 skills`.
A syntax error in `.claude/settings.json` → *"exists but could not be read as settings"*, floor
unchanged at `7 on the floor · 5 skills`.
Shipped `dist/main/claude-path.js`, extracted from `app.asar`, with `path` =
`/usr/bin:/bin:/usr/sbin:/sbin` and a home holding nothing → `state: missing`, `looked.length: 10`,
message `Looked in 10 places.` Same inputs after the fix → `Looked in 10 places: /usr/bin/claude,
/bin/claude, …` with all ten named.
`npx tsx --test --test-timeout=60000 test/claude-path.test.ts` → before the fix
`# tests 15 # pass 14 # fail 1`, the failure being `the message does not name /usr/bin/claude, so
the list has to be guessed`; after `# tests 15 # pass 15 # fail 0`.
Quit with a run in flight, `OFFICE_CLAUDE_PATH` pointing at a stand-in `claude` that writes nothing
and sleeps, so nothing was spent: `pgrep -fl` showed one real child with the shipped argv
(`--print --output-format stream-json … --agent manager --permission-mode acceptEdits`), stdout
after `app.quit()` said `Office Space: stopped 1 running process(es): claude (2384e959)`, and
`pgrep` for it afterwards returned nothing.
`pgrep -fl "Office Space"` → no output, after every case.

## 2026-10-02 — claude (stale-docs teammate)

**The records stop saying GitHub Actions is down, and the worktrees are written down.** #299
recorded the return of Actions in `PLAN.md` and `PROGRESS.md` only, so `TASKS.md` still said a PR
merges on `local-checks`. Four edits, all documents:

- `TASKS.md`: the sentence under "How the PR rows work" now says Actions runs again and a PR merges
  on a passing `checks` run for the exact head being merged, citing D25. Row 32 (the self-hosted
  runner) stays, with a note that the hosted minutes are back and dropping it is the maintainer's
  call.
- `DECISIONS.md`: D25 appended, superseding D15. D15 is untouched. Vish's approval is relayed
  through Si by iMessage, not seen by this agent.
- `WORKTREES.md`: new, a snapshot of `git worktree list` with each branch's PR state. No branch is
  to be deleted.
- This entry.

The stale "In progress" rows for merged PRs #243–#274 were deliberately left for a separate task.

`Evidence:` run one at a time from the worktree root by the stale-docs teammate itself, at
2026-10-02 06:25Z (2026-10-01 PDT); a non-zero exit would have shown as an error:
`grep -q "^## D25 — " DECISIONS.md` → exit 0.
`grep -q "D25" TASKS.md` → exit 0.
`git diff --exit-code origin/dev -- src test scripts PLAN.md` → exit 0, no output.
`WORKTREES.md` has no command: reviewed by eye against `git worktree list`.

## 2026-10-08 — teammate 1

**A named third party's words came out of the tree, and the reason they had to is worse than the
words.** The owner decided to publish this project. A first exposure audit on 2026-10-01 found no
credentials anywhere — 24 regex hits, every one a placeholder fixture — and concluded the blockers
were people rather than secrets. A second audit, run before acting on the first, **overturned its
verdict**.

**What the first audit missed.** `test/fixtures/dispatch-stream.ndjson` was sanitised on
2026-09-03 by commit `544136c`: the file at the tip is 1,523 bytes and harmless. The original
**32,063-byte** blob `ff36f794` was never removed. It is a capture of a real session and carries
a `cwd` under this machine's scratchpad, a session id, a socket path, an inventory of thirteen
connected MCP accounts with their connection status, the Claude Code version, rate-limit
utilisation, and `total_cost_usd`. Measured: it is reachable from the history of **both
`origin/main` and `origin/dev`**, and from **125 of 322 origin refs**.

The first audit checked the file and found it clean, which it is. *Fixed forward* and *removed*
are different things, and only one of them survives a `git clone`.

**Why that settles the publication question.** `git push --force` does not clear
`refs/pull/N/head`; GitHub keeps every pull request's commits and renders them in its Files
changed tab. Measured: `refs/pull/51/head` still resolves. So no rewrite of this repository can
make it safe to publish. The decision taken instead: **this repository stays private with all 322
branches and the full record intact, and a separate public repository is created from the cleaned
tree.** Nothing is deleted and nothing is rewritten.

**The redaction itself**, decided as *keep his credit, remove his words*, applied from one written
policy by three workers on disjoint territory so that no file was touched twice:

| Territory | `Khalid` | `Ariel` |
|---|---|---|
| `src/**` + `test/**`, 62 files (#310) | 121 → 12 | 30 → 3 |
| `PLAN.md` `PROGRESS.md` `DECISIONS.md` `TASKS.md` (#311) | 17 → 3 | 0 → 0 |
| `VISION.md` `README.md` `docs/the-licence-question.md` (#312) | 10 → 3 | 3 → 0 |
| **tree total after merge** | **147 → 18** | **28 → 2** |

All 18 remaining are credit — *"Khalid's call"*, *"on Khalid's instruction"*, *"Vision delivered
by Khalid and locked"*. The 2 remaining `Ariel` are `test/character.test.ts:52,59`, where
`'Ariel-Review'` is compared against `'ariel-review'` to prove case folding; the capital is the
assertion's purpose.

**The worst single passage** was `VISION.md` §4: a person who is not a contributor to this
project, named with his job title, his employer relationship and his review practice, used as the
worked example for the shareable-employee model — in the document `README.md` calls canonical. It
is now a senior engineer who shares a review agent, worded to match the paraphrase landed in
`src/shared/hired-from.ts` so the two cannot drift.

**`VISION.md`'s header could not survive the edit unchanged.** It read *"Captured from his own
words; nothing here is invented."* Once the quotations are summaries that sentence is false, and a
document whose first line is false is worse than one that still has quotes in it. It now says what
the document is and states that the quotations were replaced and one example removed.

**208 lowercase `ariel` fixture ids were left untouched**, verified identical before and after.
They are agent ids, filenames and test data; renaming them would have been a large, risky change
to shipped code for no privacy gain, because nothing connects a lowercase id to a person once the
identifying sentences are gone.

**Three agent judgements were overruled, each for a reason worth keeping:**

- A worker dropped `private` from decision **D8** because publication would make it stale. True of
  the plan as it stood; false of the one chosen, since this repository stays private. A record
  edited for a future that did not arrive is less true, not more.
- **D15** summarised GitHub's annotation as pointing at the spending limit. That annotation is a
  template naming two possible causes without saying which applies, so resolving it to one claimed
  more than was measured.
- **Wispr Flow** was generalised to "another dictation tool". The exposure was *"stopped **him**
  mid-sentence"* — the person, not the product, which three other files already name and whose
  vendor's public address is in `docs/voice.md`. Restoring the name kept the engineering fact and
  removed nothing that identified anybody.

`Evidence:` the leaked blob, confirmed independently of the audit that reported it.

```
$ git cat-file -s ff36f794e392148b8d9a3f53b48e11655d7de1f1
32063
    session_id 29   messaging_socket_path 1   memory_paths 1
    claude_code_version 1   total_cost_usd 1   mcp_servers 1
$ git rev-list origin/main --objects -- test/fixtures/dispatch-stream.ndjson | grep -c ^ff36f794
1
$ git rev-list origin/dev  --objects -- test/fixtures/dispatch-stream.ndjson | grep -c ^ff36f794
1
    carried by 125 of 322 origin refs
$ git show origin/dev:test/fixtures/dispatch-stream.ndjson | wc -c
1523        # the tip is clean, which is why the first audit passed it
```

Proof that the source pass changed comments and not code, by this repo's own method: TypeScript
parser leaf tokens compared before and after with JSDoc nodes excluded — without that exclusion
every doc-comment edit reads as a code edit. 55 of 59 files byte-identical; the 4 that differ do
so in exactly 9 intended string literals. `npm run typecheck` exit 0 on both configs throughout,
and each PR's own CI run passed with 10 completed steps: #310 at 247 s, #311 at 261 s, #312 at
297 s.

**Not done, and named so it is a choice:** the leaked blob is still in this repository's history
and will stay there. That is the point of keeping this one private. Nobody should treat a future
`git clone --mirror` of it as safe to publish.

## 2026-10-09 — claude (keychain-at-boot session)

**Task 98: the keychain is no longer asked before an account exists.** Branch
`fix/the-keychain-is-not-asked-before-an-account-exists`, from `dev` at b35a5de.

Three paths reached `safeStorage.isEncryptionAvailable()` for somebody with no account, not the one
row 98 named: `void spotify.connected()` at handler registration, the music panel's first
`player()`, and the `musicSetup` handler, which called `canRemember()` itself. The first two went
through `store.read()`, which asked the keychain before it looked for the file.

- `src/main/spotify/store.ts` — `read()` reads the file first. A missing file is "not connected"
  by itself; the keychain is asked only when there is a blob to decrypt. `write()` is unchanged
  and there is still no plaintext fallback.
- `MusicSetup.canRemember` is gone, from the type, the handler and the panel. A setup answer
  cannot say "can remember" for a question nobody asked.
- The person is told when they press Connect, before the browser opens, in the store's own
  sentence (`CANNOT_STORE`). Decided by the lead as the default; Vish can change it.
- With an account stored the keychain is still asked once at start, to seed the privacy panel's
  music line. That is deliberate and unchanged.
- `README.md` said the app "calls `safeStorage` on its own account at startup". Corrected to when
  it now does. Found by the reviewer, not by me.

`Evidence:` run in the branch's worktree on 2026-10-09.

```
$ npx tsx --test test/the-keychain-is-not-asked-before-an-account-exists.test.ts test/spotify-store.test.ts test/spotify.test.ts test/music-panel.dom.test.ts test/music-says-what-it-does-not-know.dom.test.ts
# tests 72   # pass 72   # fail 0   # cancelled 0        (exit 0; the new file is 10 of the 72)
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.renderer.json  (no errors, exit 0)
```

Before the fix, at commit 63a1ec4 (the test alone, on source identical to b35a5de), the tester
ran the new file and reported `# tests 9 / # pass 3 / # fail 6`, the first failure reading
*"reading a store with no file asked the keychain 1 time(s)"*. That is the tester's measurement,
repeated here; I did not re-run it.

What is measured and what is not:

- **Run:** tests 1-5 and half of 8 drive the real `tokenStore()` and the real `Spotify` client
  against a stubbed `safeStorage` that counts its calls (`keychain.asked` in
  `test/electron-stub.mjs`).
- **Read, not run:** tests 6, 7, 9, 10 and the other half of 8 read `main.ts`, `ipc.ts`,
  `music.ts` and the `src/` tree as text, because `main.ts` cannot be imported in a test. They pin
  where `canRemember(` is written and what the guard says, not that Electron executes it.
- **Not checked by any command:** the real macOS "Keychain Not Found" panel. The call is gone
  for a machine with no account; that the panel is gone is inferred from that, not observed.
- **Not run:** the full suite locally (D16). CI's `checks` on the pushed head is the check.

**Not done, and named so it is a choice:** an `account.bin` that exists but cannot be read
(EACCES, EIO) still reads as "not connected" with nothing said — standing order 4, older than
this change and outside its scope. And a refused Connect drawing its sentence in the panel is
followed by reading `music.ts`, with no DOM test behind it. Both from the reviewer's report.

## 2026-10-09 — claude (keychain-at-boot session), second round

**Corrects the entry above, which said the keychain is asked "when they press Connect".** That
was true and it was the defect: the guard in `musicConnect` ran before `spotifyConnect`'s own
"No Spotify client id" refusal, so somebody pressing Connect with nothing typed still reached
the keychain — the same panel, moved from startup to a click. Found by the independent review of
PR #318, not by me and not by this PR's own reviewer.

- The guard is now `if (musicClientId.trim() && !canRemember())`. An empty id falls through to
  `spotifyConnect`, which refuses it in its own sentence.
- Four comments said things the code no longer does and now say what it does: `musicSetup()`'s
  docstring in `ipc.ts`, the guard's comment in `main.ts`, `canRemember()`'s in `store.ts`, and
  the README sentence. Once an account is stored the keychain is asked whenever the token is read
  — at startup and on each player or transport call — not only "at startup".

`Evidence:` run in the branch's worktree on 2026-10-09.

```
$ npx tsx --test test/the-keychain-is-not-asked-before-an-account-exists.test.ts test/spotify-store.test.ts test/spotify.test.ts test/music-panel.dom.test.ts test/music-says-what-it-does-not-know.dom.test.ts
ℹ tests 73   ℹ pass 73   ℹ fail 0   ℹ cancelled 0        (exit 0; the new file is 11 of the 73)
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.renderer.json  (no errors, exit 0)
```

How the empty-id case is pinned, in two halves that are not the same kind of claim:

- **Run:** test 11 calls the real `connect('')` and `connect('   ')` and measures zero keychain
  asks, no fetch and no browser.
- **Read, not run:** that `main.ts` lets an empty id reach `connect` without asking first is test
  8's regex over the source, which now requires the `musicClientId.trim() &&` condition. That a
  guard without the condition fails that regex is inferred from reading it; nobody mutated the
  source to watch it fail.

## 2026-10-10 — claude (close-row-98), 03:01Z

TASKS.md row 98 moved from Queued to Done. PR #318 merged as `3b7a2aa` (merge commit dated
2026-10-10 02:55Z), and the row was left in Queued by that PR until its command had passed on the
merged `dev`. It now has, measured here and not repeated from the PR's own runs.

- **Where it was run:** `.claude/worktrees/close-row-98`, a worktree of branch
  `chore/close-row-98` created from `origin/dev`. `git rev-parse HEAD origin/dev` printed
  `3b7a2aa7d8984a3e58eb340b44084164725f51af` twice. Not the main checkout, which is on another
  branch. `git status` was not run before the test; that the tree was clean then is inferred
  from `git status --short` afterwards listing only TASKS.md and PROGRESS.md.
- The worktree had no `node_modules`; `npm ci` was run first (362 packages added). Node v22.16.0.
- Run before any edit to TASKS.md or PROGRESS.md, so the tree tested was merged `dev` and
  nothing else.

`Evidence:` run at about 03:00Z on 2026-10-10, exit 0.

```
$ npx tsx --test test/the-keychain-is-not-asked-before-an-account-exists.test.ts
ok 1 - 1. no account file: read is null and the keychain was never asked
ok 2 - 2. the real client with no account: disconnected, no request, keychain never asked
ok 3 - 3. with an account stored, read returns it and the keychain IS asked
ok 4 - 4. a file with no keychain reads as null, and a write is refused without writing
ok 5 - 5. disconnect removes the file, and afterwards read is null with zero asks
ok 6 - 6. the musicSetup handler says nothing about the keychain
ok 7 - 7. MusicSetup and the music panel no longer carry canRemember
ok 8 - 8. musicConnect refuses with CANNOT_STORE before spotifyConnect(, and that is the store's own sentence
ok 9 - 11. connect with an empty or blank client id refuses in its own sentence: no keychain, no fetch, no browser
ok 10 - 9. main.ts does not reach safeStorage itself
ok 11 - 10. tree-wide: safeStorage only in store.ts; canRemember only in store.ts and main.ts
1..11
# tests 11
# suites 0
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 246.603625
```

The `ok` lines and the totals are copied from the run; the `# Subtest:` lines and each test's
`duration_ms` block are left out.

**What the move does not claim.** The command counts asks on a stubbed `safeStorage` and reads
`main.ts` as source. So the keychain *call* is measured gone for a machine with no account. That
the macOS "Keychain Not Found" panel is gone is inferred from that. This session did not boot the
app, and found no record in this file of anyone booting it on a machine with no login keychain
since the fix. Row 98 says the same in Done.

- **Not run:** the full suite, typecheck, or anything but the one command. CI's `checks` on the
  pushed head is the wider check.
- The Done section's opening paragraph said every command below it ran at `e6fe5cb` on
  2026-09-17. One sentence was added so that row 98 is not covered by a claim that is not true
  of it.
