# Merging the twenty-two

Written after resolving all of it once on a local branch, so the second time is a checklist
rather than a discovery. Nothing here is a decision — the decision is whether to merge at all.

## Two are stacked, and merging them out of order makes work

`gh pr merge` on these in the wrong order produces conflicts that do not otherwise exist:

| merge this | after this |
|---|---|
| `markdown-hangs-on-a-fence-it-cannot-open` (#114) | `markdown-emphasis-flanking` (#96) |
| `serial-carries-the-result` (#113) | `registry-concurrent-writes` (#103) |

Each already **contains** the one below it, so merging the lower one first costs nothing and
merging the upper one first replays its parent as a conflict. The other eighteen are independent
of every branch and can go in any order.

## Four files collide, and only because branches append to the same place

| file | branches | shape |
|---|---|---|
| `test/repo-health.test.ts` | #98, #102, #104 | three tests appended |
| `test/registry.test.ts` | #103, #106 | two tests appended |
| `test/stream.test.ts` | #95, #107 | two tests appended |
| `planning/NIGHT-1-HANDOFF.md` | #93, #94, #100, #110 | four sections appended |

`src/main/main.ts` is touched by six branches and **auto-merges every time** — they change
different regions of a long file. It is on this list only so nobody is surprised to see it move.

## Resolving them

**Markdown** — keep both sides, nothing else. The sections are independent; order them however
reads best.

**TypeScript tests** — keep both sides *and check the braces*. Git aligns both branches on the
file's shared trailing `})`, so each side ends **inside** its own test. Naive "keep both" drops a
closing brace and the file will not parse.

That is not hypothetical: a script that did exactly this produced a non-compiling file three
times while preparing this. Twice it dropped a `})`, once it ate the `)` of an `assert.match(`,
and once it put a literal `})` into the prose of the handoff. **Resolve these four by hand.** They
are four hunks in total and each is two independent tests sitting next to each other.

After each resolution, run the file on its own — `npx tsx --test test/<name>.test.ts`. A brace
error surfaces immediately there and is a puzzle inside a full-suite run.

## What the result should be

    22 branches merged, 1314 tests passing, typecheck clean, build clean

Verified on `integration-check-local`, which is that merge already performed and left in place
rather than deleted. If a merge here disagrees with that number, the difference is worth finding
before continuing — the branch is the control.

It was also run: `electron .` against the merged tree answers with the preload bridge exposing 61
methods and `require` unreachable, both traversal guards refusing over real IPC, the traffic-light
clearance holding at 88px, `huggingface.co` listed exactly once, and nothing in the main-process
log.
