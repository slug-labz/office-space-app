# Night 1 — brief for the second session

You are the **second Claude Code session** on this build. The first session is `ade-7f`.
Message it with `SendMessage({ to: "ade-7f", message: "..." })`. It can message you back once
you exist — tell it your session name in your first message (your own name is printed by
`ListAgents`).

Read `CLAUDE.md` first. Its four standing orders govern this repo, and they govern us too:
only the user and the orchestrator originate work; claims are verified, not believed; nothing
on screen may lie; absent is not empty.

---

## The situation

We are compressing a two-week plan into one night. The full plan is published as an artifact —
**The Night Shift** — but everything you need is here.

`ade-7f` is running eight build streams as sub-agents in isolated git worktrees, and owns the
**merge train**: it rebases each stream onto `feat/night-1` in a fixed order, re-runs the gates,
and drives the packaged app. It is the only session that merges, and the only session that pushes.

Base of the train: branch `feat/night-1` at `83da4f6`. Baseline gates on that commit:
**980 tests pass, typecheck exits 0, build exits 0.**

### The eight streams

| | stream | owner |
|---|---|---|
| S1 | Navigation that looks like navigation — switcher affordance, "+ new project" without ⌘K | ade-7f |
| S2 | Quiet chat — collapse runs of identical refusals; one question card at a time | ade-7f |
| S3 | Strip remembers across relaunch (rebuild history from the restored transcript) | ade-7f |
| S4 | **Update reconciler** — bring shipped `.claude/` files forward iff the user never edited them + desk-13 honesty | ade-7f |
| S5 | **The spine** — dispatch ledger, resume/retry/drop on restart, watchdog, `retryBrief()` | ade-7f |
| S6 | **Work Feed** — a card per event in plain words with evidence; cost on the dashboard | **YOU** |
| S7 | **Task Board** — TASKS.md as columns where "done" is earned by VERIFY; send-back-with-failure | **YOU** |
| S8 | Ship kit — unsigned-DMG install card, `Fix permissions.command`, first-run quarantine note | ade-7f |

---

## Your job, in two halves

### Half one — build S6 and S7

Work on your own branch off `feat/night-1`: **`feat/night-1-peer`**. Do not merge it; `ade-7f`
rebases and merges it into the train. Do not push.

**S6 — the Work Feed.** A column of cards, newest first: one card per meaningful event, in plain
words, with the evidence attached. The facts already exist — `src/shared/activity.ts` holds the
entries and `src/renderer/views/activity.ts` renders the strip today. Two things make this cheap:

- The **plain-language caption is already written**. `src/main/voice/digest.ts` turns a turn into
  one human sentence and throws it away when the speaker is off. Print that prose instead of
  speaking it.
- **Evidence, not source.** A card carries the VERIFY output, a file count, an error — enough to
  judge a result without reading code.

Also in S6: session/project cost on the dashboard (the session already tracks `costUsd`), and the
voice's "chose silence" note — today a digest that deliberately said nothing and one that never
ran look identical.

**S7 — the Task Board.** `projects/<name>/TASKS.md` rendered as columns. The file stays the truth;
the board is a reader. "Done" is not draggable — it is earned by the VERIFY gate, which already
exists (`src/main/harness.ts`, four outcomes: passed, failed, uncheckable, not checked). A failed
check becomes one click: **send it back, with the failure output attached**.

> **S7 depends on S5.** `ade-7f` will send you the exact exported signature of
> `retryBrief(entry, failureOutput): string` when S5 lands. Ask for it — do not guess it, and do
> not write your own retry composer. If it has not arrived, build the board read-only first and
> wire send-back last.

### Half two — be the adversary

This is the half that matters more, and it is why there are two of us.

`ade-7f` will send you claims: "S3 is green, here is what I measured." **Your job is to try to
falsify them, not to confirm them.** Specifically:

1. **Drive the packaged app yourself.** Do not trust synthetic tests. Tonight already proved this
   twice: a dial passed every `dispatchEvent` test in the suite and could not be operated by a
   real mouse, because hovering a row rebuilt the list and the press landed on the container. Use
   trusted OS-level input (CDP `Input.dispatchMouseEvent`), not `element.click()`.
2. **Mutation-check the tests.** Revert a fix and confirm its test actually goes red. One test
   tonight kept passing with its bug restored — the dedupe hid the loop it was meant to catch.
   A test that cannot fail is worse than no test.
3. **Hunt the house bug.** This codebase's recurring defect, found about fourteen times, is
   *something declared in one place and never read by the place that needs it* — every layer
   individually correct. Recent instances: agents' tool lists never compared against permissions;
   the permission-mode dial never passed to the approval gate; the session registry read before
   the workspace root was known, then overwritten. **For every new value any stream introduces,
   find its reader.** If there is no reader, that is a finding.
4. **Report findings as findings.** Name the file and line, say what breaks and how you know.
   A red result you can reproduce outranks a green claim anyone makes, including mine.

---

## Rules for both of us

- **Neither of us pushes to `dev` or `main`.** The night ends with ONE PR to `dev` that waits for
  the user's sign-off. `ade-7f` opens it.
- **Nobody edits `.claude/settings.json` permission lists tonight.** They are frozen.
- Match the surrounding code exactly: this repo's comments explain *why* and name the bug being
  prevented. Read neighbouring files before writing.
- Report honestly. A named failure is worth more than a green claim. If you cannot do something,
  say so and say why — do not quietly narrow the scope.

## Freeze

Feature freeze is called by `ade-7f`. After it: no new work, only verification and fixes for
findings. Anything not green at freeze is **dropped and named in the dawn report** — never
squeezed in broken. Scaling scope down is the user's call in the morning, not ours at 4am.
