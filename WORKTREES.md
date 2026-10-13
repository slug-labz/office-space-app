# Worktrees — Office Space

A snapshot of `git worktree list` from the main checkout on 2026-10-01 PDT (2026-10-02 UTC),
with each branch's PR state as `gh pr list -R slug-labz/office-space --state all` reported it.
Removing a worktree folder is the maintainer's call. No branch is to be deleted: the branches are
the record.

| Worktree | Branch | Head | PR | PR state (GitHub) |
|---|---|---|---|---|
| `.claude/worktrees/ci-fix` | `a-node-patch-decides-that-exit-code-so-stop-asserting-it` | 6bec088 | #297 | MERGED 2026-10-01 09:04Z |
| `.claude/worktrees/firstrun` | `docs/the-first-run-on-a-clean-machine` | 49568e4 | none | no PR found; the branch is not on origin; its head is #300's merge commit, already on dev, so it carries no commit of its own |
| `.claude/worktrees/firstrun2` | `docs/the-first-run-on-a-clean-machine-2` | aee7f20 | #308 | MERGED 2026-10-02 01:09Z |
| `.claude/worktrees/icon` | `assets/the-app-gets-an-icon` | 2e3155d | #304 | MERGED 2026-10-01 10:48Z |
| `.claude/worktrees/plangate` | `test/a-verify-that-cannot-pass-on-nothing` | 952d1d5 | #303 | MERGED 2026-10-01 10:36Z |
| `.claude/worktrees/rec2` | `ci-came-back-and-the-record-says-so` | 8cd69da | #299 | MERGED 2026-10-01 09:45Z |
| `.claude/worktrees/relscript` | `scripts/one-command-cuts-a-release` | 1ce7fbd | #301 | MERGED 2026-10-01 10:21Z |
| `.claude/worktrees/rescue-held-clock` | `fix/held-call-counts-down-with-nothing-running` | 5e8736e | #295 | MERGED 2026-10-01 10:39Z |
| `.claude/worktrees/rescue-reviewer` | `fix/packaging-privacy-and-git-refusals` | b8133ad | #293 | MERGED 2026-10-01 10:39Z |
| `.claude/worktrees/rescue-stale-list` | `fix/older-approval-list-never-overwrites-newer` | 5495fba | #294 | MERGED 2026-10-01 10:39Z |
| `.claude/worktrees/restore-redraw` | `a-restored-conversation-shows-in-the-strip` | 293ae43 | #300 | MERGED 2026-10-01 09:37Z |
| `.claude/worktrees/shots` | `docs/the-readme-shows-the-office` | e0bbeb9 | #302 | MERGED 2026-10-01 10:30Z |
| `.claude/worktrees/stale-docs` | `docs/the-record-says-ci-is-back` | (this PR) | this PR | OPEN — this file's own branch |
| `.claude/worktrees/untick-release` | `the-plan-ticked-a-release-nobody-can-fetch` | 93a0dee | #306 | MERGED 2026-10-01 11:13Z |
| (outside the repo, under the system temp folder) `mergecheck` | detached HEAD | 09da05c | none | no branch, so no PR; 09da05c is a local merge commit ("Merge commit '5e8736e…' into HEAD") on no remote branch |

An earlier untracked draft of this file said rescue-reviewer, rescue-stale-list and
rescue-held-clock were "Live — keep until merged". Their PRs #293, #294 and #295 are all MERGED.

That untracked copy still sits in the main checkout. Move it aside before pulling `dev` there, or
git will refuse to overwrite it.
