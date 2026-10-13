# Night 1 — what landed, and the one thing that did not

Written 2026-08-26 so the state survives both sessions ending.

## Shipped

| | |
|---|---|
| `main` | `b1231a4` — 1117 tests. Installed. Release PR #51 is open and awaiting sign-off. |
| `dev` | `e9d4c0a` — 1232 tests. PRs #41–#50 and #52–#85 merged. |

`main` had been at `294b74b` since 19 August. That commit is still reachable; no branch was
deleted; the release was a fast-forward.

## The one thing that did not land

**S6 (Work Feed) and S7 (Task Board)**, plus three guards, sit **staged and green** in
`.claude/worktrees/night-1-peer` on `b70ad30`.

- 19 files, 1150 tests passing in that tree, typecheck 0, build 0.
- Both features have been **driven in real rendering**, not just tested:
  - S6: the digest's plain-language sentence reaching the feed as `logline--summary`, and
    `$0.2431 this session` — cost with a reader for the first time.
  - S7: the board rendering from a real `TASKS.md` — `6 tasks · 5 outstanding · 1 row(s) could
    not be read`, `UNCHECKABLE` distinct from passed, `NOT CHECKED` naming why ("nothing has
    authorised this"), and one `unproven` card marking a Done row the office never verified.

### Why it is not committed

The session that wrote it is denied `Bash(git commit:*)` by `.claude/settings.json`. Verbatim:

    Permission to use Bash with command git commit -m "..." has been denied.

That rule exists so an Office Space **employee agent** cannot commit to a user's repository. It is
correct for the product. It also governs Claude Code sessions developing the product — one file,
two audiences. That collision is the whole of the blocker.

Neither session routed around it. A permission that dissolves when you ask a differently
configured session is not a permission, and this repository's own four-gate model is built on
that being real.

### To land it

```bash
cd "/Users/somebody/ADE/office-space-project/office-space/.claude/worktrees/night-1-peer" \
  && git commit -m "S6 and S7: the Work Feed and the Task Board"
```

Already staged. Then rebase onto `dev` (three commits ahead of its base), re-run the gates, drive
it, open the PR. Known reds to expect: none — the peer cleared all four before stopping.

## What was found, and what now guards it

Every expensive defect this week was found by **operating the software**, never by testing it.

| found | guard that now exists |
|---|---|
| the app deleted conversations on every launch — registry read before the workspace root | source-order test |
| agent worktrees would have shipped inside the DMG | bundle filter + its test |
| every worktree branched from a `main` a week stale | `scripts/preflight.mjs` |
| a test guarding "verbatim" that truncation passed | a 60-line fixture asserting the tail |
| a 20px target the height check could not see | a stated-width floor test |
| a module whose only consumer was its own test | orphan check reads `src` only |
| a NUL byte that made grep answer "no" | control-byte test over src, test, scripts |
| `.gitignore` missing a symlinked `node_modules` | pattern test in repo-health |
| the macOS window buttons sat on the switcher in the default layout | `css-applied.test.ts` |

**Five of those guards existed already and enforced a weaker rule than they described.** The IPC
reader guard enumerated only an interface's top level. The target-size guard asked about height
and never width. The control list only guarded controls on the list. The orphan check counted a
module's own test as its consumer. The CSS collision test asked whether every applied class was
styled and never the reverse, which is the direction a deleted element fails in. All five looked
like coverage.

## The three false findings, and what they share

1. A mutation escaped through a shell into a literal `\n`; the mutant "survived" and the test
   looked robust.
2. A re-measured stylesheet came from cache and described the previous build.
3. A file containing a NUL made `grep` report **no matches** — silently, exit 1 — which was then
   read as four independent confirmations that a wired module had no caller.

Each measurement was self-consistent, which is what made it convincing.

> **A tool that declines to answer and a tool that answers "no" are indistinguishable at the
> shell, and only one of them is honest.**

And its corollary, which cost the most time tonight: *consistency is not corroboration when every
check shares a blind spot.*

## How the rest was found

The four items originally named here were hand-found. When they ran out, two tools were written.

**`scripts/unread-fields.mjs`** resolves every property declared in a module through the
TypeScript checker and reports the ones nothing reads. It stays a **script**: main takes payloads
off the bridge as `Record<string, unknown>` and reads them by key, which the checker cannot
follow, so it over-reports and a green assertion would be unreachable.

**`scripts/unused-types.mjs`** reports exported names — types, functions, classes, consts — that
nothing anywhere refers to. This one **is a test**, because a reference resolves to exactly one
declaration: "nothing points at this" is a fact rather than an estimate.

### The tools were wrong four times before they were right

Each is worth more than the finding it produced.

| it reported | because | what it cost |
|---|---|---|
| the whole renderer as dead | built from `tsconfig.json` alone, whose `lib` has no DOM and which excludes `src/renderer/**` — 453 errors, every expression `any`, every property access unresolved | said `EmployeeWork.brief` was unread while a reader sat at `app.ts:1115` |
| every union-typed builder as "never built" | a handler returning `Promise<T \| null>` has a contextual type whose property lookup is undefined, because `null` has no properties | `RestoredSession` labelled never-built while being built twice in one function, eleven lines apart |
| every shorthand destructure as a non-read | `const { cause } = reason` binds a *variable*; the symbol at that name is not the property | `Reason.cause` stayed on the list after `doingLine` was written specifically to read it |
| every `for…of` destructure as a non-read | the declaration has no initializer to walk to | `reconcile.ts` reads both fields on the line reporting a half-finished update |

The first is the one to remember: **a tool that cannot see and a tool that sees nothing give the
same answer.** Both now refuse to print at all if the program has unresolved diagnostics — loud
rather than quiet.

## What the sweep found

**Wrong on screen, now fixed:**

- **`PlanUsage.usingOverage`** — the office said *"runs will fail until it resets"* while the CLI
  was reporting that runs were continuing and being billed. That sentence also goes into the
  context block the manager reads, so an office told it is out of credits has a reason not to
  dispatch anybody. One unread boolean, wrong in two places, about money.
- **`ModeChange.sessionId`** — mode changes were filtered on the project alone, so the office's
  mode change repainted whichever conversation you were looking at, including handing an
  employee's floor a `conversing` fact from a conversation nobody was watching.
- **`VerifyResult.error`** — a VERIFY naming a command this machine does not have rendered as the
  literal string `exit null`. Broken plumbing reported as broken code.
- **`Reason.cause`** — the floor's own audit trail. The type exists "so the floor can be audited…
  and point at the tool call that caused it"; `reasonFor` returned the summary alone.
- **`PendingApproval.agent`** — the approval card never said whose desk was stopped.
- **`ProjectInfo.missing`** — the project row never said which convention files a project lacks.
- **`Unstaged.toolUseId`** — the notice that says *"the work is real"* offered no way to find it.
- **`approvalWatcher`** — its comment said "closed on quit so it cannot hold the process open";
  nothing called `close()`.

**Contracts restated instead of used** — `mic.ts`, `hire.ts`, `roster-view.ts`, `bubbles.ts` each
wrote out an IPC or floor type field-for-field. TypeScript is structural, so every copy compiled;
that is the hazard rather than the reassurance. Binding `bubbles.ts` caught that `Reason.cause` is
a union of fact kinds and the copy had widened it to `string`.

**Deletions recorded and never carried out** — `mountPaletteControl` (three documents say it is
gone), `naming` (a comment eleven lines away says it went, and got `busyProjects` wrong in the
same sentence), plus `readAgent`, `PALETTES`, `DELEGATION_TOOL_NAMES` and `ThemeSelection`, each
written for a surface that does not exist.

**`noUnusedLocals` is on now.** Twelve dead locals across the repo, including the watcher handle.
The compiler answers that class for free.

## Deliberately not read

Each says so where it is declared, so the next sweep does not re-open it.

- `Triage.rule` on the **allow** branch — a refusal quotes its rule; an allow says nothing,
  because an allow list announcing every match is the log clutter cut on purpose.
- `Outcome.at`, `ShippedManifest.generatedAt` — the file is the audience, not the app.
- `Skill.filePath` — a second source of truth for a path derived from `id`.
- `Unstaged.why` — one value today, and a `switch` with one arm is a branch pretending to be a
  decision.
- `AsideResult.costUsd`, `SessionInfo.costUsd` — cost belongs to one surface, and **S6 is that
  surface**. A second reader would put two formats for one number on screen.
- `CapabilityReport.servers` and `.permissions`, `ThemeInfo.redistributable`, `MusicSetup.hosts`
  — each is a second derivation of something already on screen. Checked rather than asserted this
  time, because the entry below is what happens when it is not: `servers{name,transport,scope,
  status}` is every field of the privacy panel's own egress rows, built at `main.ts:1543` and
  already honouring configured-versus-connected; `permissions.inForce` is `app.ts:1603` deriving
  the same fact from the `workspace-not-trusted` problem rule. `MusicSetup.hosts` had a comment
  claiming the privacy panel printed *it*; the panel prints `SPOTIFY_HOSTS`. Corrected, because
  that comment would have convinced anyone tidying up that deleting the field breaks the panel.

  **`CapabilityReport.sources` was on this list and did not belong.** It is *"where the servers
  were read from, including files that were not there"*, and nothing on screen carried it. The
  entry said "each is a second derivation", which was true of the fields beside it and false of
  this one — a generalisation that read as a finding because the rest of the sentence was right.
  Fixed and written up below.

## What driving it established, and what driving it cannot

Every expensive defect on this project was found by operating the software, so the sweep above was
followed by a pass through the panels. Two things came out of it, and one of them is about the
method rather than the app.

**Verified with real, trusted input** (dispatched mouse events, not `element.click()`): the
permissions dial opens, the five modes are each explained, choosing one moves `aria-selected` onto
it, the trigger relabels — in the alarm colour for `bypass permissions` — and the menu closes.
That is the control reported as *"the tick remains on the same position and it doesn't change
anything"*. It works.

**Verified synthetically** — handler-level, not input-level: the "more" menu (Settings, Music,
Privacy), the command palette's fifteen entries, the task panel (*"6 tasks · 5 outstanding · 1
row(s) could not be read"*), the roster, the work log, the approval card, the project rows.

### The near-miss worth recording

Driving the "more" menu with trusted input appeared to show that **Settings, Music and Privacy
could not be opened by a real mouse at all** — a synthetic click opened the menu and a real one
never did, reproducibly.

It was the harness. Instrumenting the event stream showed every real click arriving with
`target: HTML`: the browser pane is 390px wide, the app lays out for its 900px minimum, and the
control sits at x=546 — off the pane entirely. Emulating a 1280px viewport does not help, because
trusted input is dispatched in the pane's physical coordinates and is not rescaled.

**Two measurements agreed, reproducibly, and were both about the tool.** The instrumentation is
what settled it; without `target: HTML` the report would have been a serious bug in somebody
else's code.

So: real-input verification through this pane reaches only what fits in 390px. Anything wider
needs the packaged app driven on the machine itself.

## The release checklist, run

`docs/release-checklist.md` is written as questions with commands. Here is where each one stands,
so the next person starts from what is unanswered rather than from the top.

| § | | |
|---|---|---|
| 1 | typecheck, tests, build | ✅ clean, 1242/1242, 85.7% lines, 89.6% branches, 96.9% functions |
| 1 | **CI green on the same commit** | ❌ **the workflow is switched off** — see below |
| 2 | nothing personal in the artifact | ✅ no `memory/`, `projects/` is `_TEMPLATE` + README, no `.env`, no credentials |
| 3 | the DMG window | ✅ `INSTALL.txt` and `Fix permissions.command` beside the app and the `Applications` symlink |
| 3 | `Fix permissions.command` behaves | ✅ all three branches exercised against a throwaway bundle |
| 3 | opens on a machine that has never seen the repo | ⬜ needs a second machine or a fresh account |
| 4 | the slash menu lists commands **and** skills | ✅ and labels each by kind, and flags `/write-a-task` as *"command · shadows a skill"* |
| 4 | streaming, queueing, stop | ⬜ needs a live `claude` turn |
| 5 | an unreadable agents directory | ✅ reports `STAFF (0)` **and** `[unreadable-dir]` — the count and the reason together |
| 5 | a torn `settings.json` | ✅ `unreadable` with the parser's own message, distinct from `missing`; and it no longer lets bypass run anything |
| 5 | quit with a run in flight | ✅ 0 processes, 0 helpers, `.watching` cleaned up |
| 6 | the cost line | ✅ `$0.2431 this session` on turn completion; whether it *accumulates* is the CLI's number, not the app's |

The unticked rows need a second machine or a live turn. Nothing about them is known to be wrong;
they are unasked, which is a different thing and is why they are drawn differently.

## Going back to symptoms that were explained rather than fixed

Two of the largest findings came from re-reading complaints that had been answered in prose.

**"It says the manager is running on the top left, but on the bottom, it says zero running."**

That was answered by pointing out the two surfaces count different subjects — the manager's own
turn, and dispatched employees. True, and it missed the thing underneath: **the activity strip was
dead.** `feed()` wrote every fact under the session id and `drawStrip()` read under the project,
so the Running zone never showed anybody and the Happened log stayed empty for the life of the
app. The bottom said zero because nothing was ever read, not because nothing was running.

The wording collision was also real and is fixed — `0 running` reads `nobody mid-task` now, the
words the zone below already used. But it was the smaller half.

**"Why does it say this project has no TASKS.md?"**

The task files parse correctly — 2, 4 and 1 tasks, zero unreadable rows. Looking at them turned up
something else: `createProject` copied the scaffold verbatim, so every project opened with
`# <Project Name>` at the top of all three files until an agent happened to edit one. Two projects
on this machine say their own name and the one nobody worked on still says `<Project Name>`.

**The lesson.** An explanation that satisfies the person asking is not the same as a diagnosis. Both
of these were closed with an answer that was true, and both had a defect underneath that the
answer made it easy to stop short of.

## Surfaces driven, and what was found to be right

Negative results, recorded so nobody re-opens them:

- **the settings panel** — five groups, `role="radio"` with `aria-checked`, roving tabindex, and
  the checked option visually distinct in the accent colour. Applies and reverts.
- **the floor** — 75 distinct painted frames across one turn; the characters genuinely move.
- **the activity log** — 11 entries for a full turn, ordinary tool calls excluded, and repeated
  refusals collapsed as `Bash refused: rm -rf dist ×2`. That collapse had been dead along with
  the rest of the strip.
- **the slash menu** — lists commands *and* skills, labels each by kind, and flags
  `/write-a-task` as *"command · shadows a skill"*.
- **the cost line** — `$0.2431 this session` on turn completion. Nearly recorded as broken: it is
  empty for the first fourteen seconds and the first measurement watched for eight.

## Phase two, examined

Each item was taken seriously and asked the same question: *is there a real gap underneath, or is
this a feature on top of something that already works?* Four had one. Two did not, and saying so
is the more useful answer.

| item | what it turned out to be |
|---|---|
| **per-agent permission profiles** | a **hole**. Employees cannot summon colleagues because they lack `Task` — and `claude` was unlisted, so under `bypassPermissions` any agent with `Bash` could have run `claude -p "…"` and started one outside the office. Now denied. |
| **agent packs, install review** | a **hole**. `hire()` checked the name and the description and never the tools, so the first standing order held for the office as delivered and not as used. `views/hire.ts` had already written the words — *"a renderer check is a courtesy and never a guarantee"* — and the guarantee was missing. |
| **replay-the-day** | a **hole**, though not the one expected. The app already recorded a megabyte of `floor.ndjson` that nothing reads, and the privacy panel — whose claim is *what is on disk, one delete each* — knew about neither it nor `dispatches.jsonl`, the file holding every brief in the words somebody wrote. |
| **team rooms past 12 desks** | **not a defect.** The floor already grows in blocks; at 1–60 staff every desk is placed and reachable. But nothing asked whether a desk could be *walked to*, and the missing-aisle mutant is caught by that test alone. |
| **meeting minutes** | **rejected by design, and rightly.** `meet` says so in as many words: *"a meeting that automatically generates a record generates one whether or not anything was decided."* It points at `record-progress` as the deliberate alternative, which exists and is well specified. Building this would override a considered decision. |
| **explore-options whiteboard** | **already guaranteed.** The skill's claim is mechanical — *"the branches physically cannot anchor on each other"* — and it holds: `officeBlocks` goes to the manager's session only, so a dispatched employee sees its own prompt and agent file and nothing else. A whiteboard would be a view of a mechanism that already works. |

The pattern is worth keeping. **Four of the six features were sitting on top of a defect**, and in
every case the defect was the more valuable thing — not because the features are bad, but because
a feature built over a hole inherits it.

## What an office of sixty costs

A dimension nothing had measured. The floorplan was already known to *place* sixty desks without
collisions and with every one reachable; this is what it costs to **paint** them.

| staff | one frame | casting them all, cold |
|---|---|---|
| 7 | 0.75 ms | 8 ms |
| 24 | 0.77 ms | 11 ms |
| 40 | 1.55 ms | — |
| 60 | **1.43 ms** | **19 ms** |

A 60fps frame is 16.7 ms, so sixty people cost under a tenth of one. Casting is sub-linear —
0.3 ms a head at sixty against 1.1 ms at seven — because the art cache is keyed by agent and the
same person is drawn once however many projects they appear in.

**Deliberately not a test.** A timing assertion passes on this machine and fails on a slower one,
gets marked flaky, and then gets skipped — and the CI workflow's own header already makes that
argument: *"a check that cries wolf gets skipped, and a skipped check is worse than none because
it looks like cover."* A baseline in prose is what this is worth.

Two false numbers were measured on the way, and both looked plausible. `repaint()` returned 0 ms
at every size — it schedules a frame rather than painting one. And `setCast` looked free until the
sprite function was the real one rather than a stub returning `null`, at which point it was
twenty times slower and still fast.

## The clearance that was handed to a corpse

The last thing found by operating the software, and the clearest instance yet of the shape this
repository keeps finding.

`side: 'left'` is the **default**, so the conversation is the left-hand column out of the box.
macOS draws its three window buttons over the top-left, and `.floor__chrome` reserves `5.5rem`
for them. When the pane took that column, the floor gave the reservation back and handed it to
`.tabs` — which had stopped existing a release earlier, when the switcher replaced the tab strip
and the session drawer.

Every rule was individually correct. The give-back was correct. The reservation was correct. The
join between them addressed something deleted, and the window buttons went back to sitting on the
control underneath them — which the comment directly above the rule already described happening
once before.

Measured in the running app: the switcher sat at `x=22`, inside the 13–78px the buttons occupy.
It now sits at `x=90`.

**The measurement was wrong once first.** At the browser pane's own 390px width the floor column
collapses to 38px and both `side` values look broken; only at the real window size (1280×820,
`minWidth: 900`) does the layout mean anything. That is the second time this week a harness
narrower than the app produced a confident false reading — the first was "settings unreachable by
mouse".

### What the new guard cost to get right

`css-applied.test.ts` asks whether every class the stylesheets style is one the app applies. Two
drafts were wrong in opposite directions, and both are written up in the file because the pair is
the lesson:

- Searching the sources as plain text **passed while the bug was present**. `app.ts` holds
  `const tabs = new Map<string, Tab>()`, and a substring search accepted an unrelated local
  variable as proof the class was worn.
- Cutting `${…}` spans out of template literals then discarded the strings *inside* them, where
  `` `swrow${current ? ' swrow--current' : ''}` `` keeps a real class — reporting four live
  classes as dead.

Both were the same mistake: **measuring something adjacent to the question because it was easier
to reach.** A regex cannot see nesting, so it now reads strings with a scanner that tracks the
state a parser would — and skips regex literals, because `markdown.ts` contains ````/^\s*```/```` and
reading the first of those backticks as a template start swallowed the rest of the file and
reported the live `.md-p` as dead.

It is mutation-tested three ways: reintroducing the `.tabs` rule fails it, renaming an applied
class fails it, and staling an allowlist entry fails it. A test that has never been seen to fail
is a claim, not a check.

### Asked and clean

The same question in two other mediums, both negative and both worth recording so nobody pays for
them twice: **every `#id` the stylesheets style is present in the markup**, and **every
`[data-x="y"]` rule addresses a value the code actually sets**. 182 lines of dead CSS were removed
alongside the fix; only the one was load-bearing.
## The app was run, and that is what found the last one

Every check before this was the browser harness or the suite. The harness renders the real
markup with a fake bridge, which is enough for layout and for anything living in `shared/`, and
is not the application. This was the first pass through the real thing: `electron .` with a
remote debugging port, driven over the DevTools protocol.

It cost one defect, and the defect could not have been found any other way.

The task panel on the **default** conversation read `The office — "" is not a project in this
office.` `OFFICE_PROJECT` is the empty string, and the traversal guard added the same night
answered it as though somebody had typed a bad name. Every harness test names a project, because
that is what those tests are about — so the untested case was the one the app opens on. Written
up in `harness.test.ts` beside the fix.

### What the real runtime confirmed that nothing else could

| | |
|---|---|
| the preload bridge | 61 methods; `window.require` and `ipcRenderer` both unreachable |
| `fireAgent('../../../etc/hosts')` | `Not an agent name` — over real IPC, not a unit test |
| `disableAgent`, `enableAgent`, `tasksOf('../..')` | refused the same way |
| the traffic-light clearance | `.pane__head` at 88px, switcher at x=90, in the real window |
| the privacy panel | real filesystem: `projects :: 74 KB · 15 files`, derived lede, no caveat because nothing here is unreadable |
| the task panel, real project | 2 tasks, owner, ref, the VERIFY command, and why it is not authorised |
| the main-process log | zero errors across the whole session |

### And the sizes a person can actually reach

`minWidth: 900, minHeight: 600`. At exactly that, with the largest text scale the settings offer
and in both densities: no horizontal overflow, no control clipped outside a scroller, nothing
under 24×24, the switcher still clear of the window buttons, and both large cards fitting with
their own inner scrollers and a reachable close button.

One thing the probe got wrong first, which is the usual lesson: it reported four buttons
offscreen, and they were below the fold of `.transcript` — a scroller with 1626px of content at
`scrollTop: 0`. Measuring against the viewport when the content is in a scroller is measuring the
wrong box.

### The packaged artifact, opened

`npm run package` builds, and the `.app` it produces was launched and its workspace inspected.
This is not the unticked "opens on a machine that has never seen the repo" — it is the same
machine — but it is the half of that question that does not need a second machine.

The bundle contains exactly what it should, checked against the artifact rather than against the
config that produces it:

| absent | present |
|---|---|
| `.claude/settings.local.json` | 7 agents, 5 skills, 6 commands, 1 hook |
| `.claude/worktrees` | `assets/themes/README.md`, and no art pack |
| `assets/themes/checkerboard` | `projects/_TEMPLATE` |
| `memory` | |

Launched, it seeded its own workspace under `Application Support` — 7 agents, 5 skills, 6
commands, and neither `settings.local.json` nor `worktrees` following it there.

**What could not be checked, and why.** The packaged app accepts a connection on
`--remote-debugging-port` and serves nothing: Chromium restricts remote debugging in a packaged
build. So the *renderer* of the packaged app is unverified — everything above is the bundle, the
process, and the workspace it wrote. The development build was driven properly and is the same
renderer, which is an argument and not a measurement.

The two guards that make this hold are worth naming, because neither is the packaging config.
`persistence.test.ts` asks **git** what is ignored under every `extraResources` path and fails if
the filter would ship it — one rule covering both `settings.local.json` and the art packs, whose
licence forbids redistribution. And `.gitignore:43` is what puts the art under that rule.

### What running it still cannot answer

The two release-checklist rows that were unticked are unticked for the same reasons as before.
A live turn needs `claude` to actually run, and opening on a machine that has never seen the repo
needs that machine. Driving the app does not substitute for either, and this section is not a
claim that it does.
## The one long-lived secret, and where it is not mentioned

`src/main/spotify/store.ts` is careful in a way worth recording, because the audit checked its
claims rather than reading them. The refresh token goes through `safeStorage` — Keychain,
libsecret, DPAPI — as ciphertext in `userData`, never in `.office-space/`, which is shared
whenever the project is. On a machine that cannot encrypt it **throws rather than falling back**,
and the music panel says the account will not be remembered. The file is `0o600`, disconnecting
deletes it rather than writing an empty one, and a half-written blob reads as no account rather
than as one trusted in pieces.

All of that holds. And the token is never logged: every reference to `accessToken` or
`refreshToken` in `src/` is the store itself or the OAuth exchange.

**What is worth a decision, and is not a defect.** The privacy panel is titled *"What leaves,
and what is kept"*, enumerates stores with a size and a Forget button each, and does not list
this one. `STORES` is workspace-relative by design; the token is in `userData` and is managed by
the music panel's disconnect, which announces *"the stored token has been deleted"* when you use
it. So the credential is disclosed **when it changes** and not **when you go looking**.

Someone who connected an account a month ago and opens the panel to see what this app holds will
not find it there. Whether that belongs in the panel is a product call, and it is not free:
`forget()` refuses any path outside its nine-string list on purpose, and a `userData` store would
widen the one check standing in front of a delete. Left for a person, with the argument written
down rather than the conclusion assumed.

## The dictation claim, traced end to end

The app says this in three places — `ipc.ts`, `voice/transcribe.ts`, and the privacy panel's own
egress row: *"What you say is never sent anywhere: it is written to a temporary file, read by a
program on this machine, and deleted."*

Traced rather than read, and it holds on every path:

- `mic.ts` encodes the samples and passes the buffer straight to `transcribe`. Nothing keeps it.
- `main.ts` refuses anything that is not an `ArrayBuffer` or a view of one, then hands the bytes
  on. Nothing keeps it.
- `transcribe.ts` writes into a fresh `mkdtemp` directory and removes it in a **`finally`** with
  `force: true` — so it goes on a failed transcription, on a thrown error, and on a whisper
  binary that never ran. `--output-txt` is deliberately not used, because it would write a second
  file beside the wav that nothing reads and that would also have to be cleaned up.
- The only `fetch` in the module is the one-time model download from the host the panel lists.
  The audio itself never touches the network.

The one gap is inherent and not worth fixing: a `SIGKILL` between writing and the `finally`
leaves a wav in the OS temp directory, which is true of any process and is what that directory is
for.

Recorded because a privacy claim the app makes three times is worth having checked once, and
because the next person to read those sentences should not have to trace it again.
## The panel that could not say its list was short

`capabilities.ts` is careful in a way this repository asks for by name. Its `SourceRead` keeps
`missing` and `unreadable` apart all the way out, its own tests insist an unreadable `.mcp.json`
is never reported as zero servers, and `McpSurvey` exists so that "no servers" can *"show that it
looked, and where"*. `Capabilities.problems` says it outright: **"non-empty must reach the
screen"**.

It reached the roster panel. The privacy panel runs its own scan, lists every MCP server it found
as an egress row, and had nothing to say the list was short — so a config that would not parse
produced one fewer row and changed nothing else.

That is the fourth standing order in the place it costs most. A shorter list of things that can
reach off the machine is the **reassuring** answer, so nobody goes looking; and this is the one
panel whose entire claim is that it tells the truth about what leaves.

The panel's existing problem line does not cover it, which is worth stating because it looks like
it should: `privacyProblem` fires when `privacyOf` throws or a delete fails, and this is a
*successful* call returning a complete-looking report.

`egressCaveat` sits in `shared/privacy-view.ts` beside `egressLede`, which was written for the
same fault one field over — the same panel quietly saying less than it knew. `unreadSources` is a
required parameter of `measure()` rather than a defaulted one: a caller that forgot it would
report a clean scan, which is the single wrong answer the field exists to prevent. The compiler
named all seven call sites.

Verified by opening the panel through its own menu in the running app rather than by reasoning
about the code: the sentence renders between the lede and the first row, in `--warn` at 5.80:1 on
the panel ground. The harness mock carries an unreadable config, because without one the panel
looks correct — which is the whole problem restated.

### The same fault one function further down

Found by a different probe on the same pass — catches that discard what they caught — and worth
recording as a pair, because the two were written months apart by people each fixing the other's
kind of bug.

`measureOne` is careful: it separates `ENOENT` from every other error and reports `absent` and
`unreadable` as different facts, with a comment saying why. `walk`, which it calls, recursed into
subdirectories and returned `{0, 0}` for any it could not open — silently. So a store containing
one locked directory reported `present` with a **confident total short by that whole subtree**.

Three states could not express it: the store is not `unreadable`, because most of it was read,
and certainly not `absent`. `MeasuredStore.partial` is the fourth, and `sizeLine` has a fourth
sentence — `47 KB · 9 files · more could not be read`. Zero files and nothing readable now reads
as `could not be read` rather than `empty`, because *empty* is a measurement somebody's deletion
produced and this is the absence of one.

A low number is the reassuring answer in this panel. That is the whole reason it survived: nobody
checks a number that looks fine, and the fault was in the branch that only runs when a directory
will not open.

The test chmods a directory to `0o000` and **checks the premise before asserting on it** — as
root, and on Windows, the mode does not hold, and a test that quietly passes because its setup
did not take is worse than no test. Mutation-checked: restoring the swallow fails it.

## The sweep behind those two, and what it did not find

Both fixes above came out of one pass asking a single question in seven mediums: **what is
declared in one place and unreachable from the place that needs it?** Five mediums answered
nothing, and that is worth writing down — a negative result nobody records gets paid for twice.

| asked | answer |
|---|---|
| classes the stylesheets style, that nothing wears | **2 findings**, one load-bearing — see above |
| `#id` selectors with no such element | clean |
| `[data-x="y"]` rules for values the code never sets | clean |
| custom properties declared and never read | 9, all the documented `--syn-*` source vocabulary; `palette.test.ts` already enforces the claim their comment makes |
| `aria-controls` / `labelledby` / `describedby` / `for` naming a missing id | clean — 89 ids, 0 dangling |
| files the shipped renderer asks the browser for | clean — 93 references, all resolve in `dist/` |
| tools the shipped agents declare that the workspace refuses | clean — `WebFetch` and `WebSearch` are in `allow`, the rest are in `NEEDS_NO_ENTRY` |
| catches that discard what they caught | 12, **all** carrying an explanation; the three highest-stakes read correctly |

### The probes were wrong six times before they were right, always the same way

This is worth more than any single result, because it kept happening after it had been noticed.

| probe | what it reported | why it was wrong |
|---|---|---|
| styled-but-unworn classes, first draft | **passed while the bug was present** | searched raw source, so `const tabs = new Map()` vouched for `.tabs` |
| the same, second draft | four live classes reported dead | cut `${…}` spans out of templates, discarding `' swrow--current'` inside one |
| catches that swallow | twelve locations pointing at unrelated code | replaced each comment with one space, then counted newlines |
| declared-but-refused tools | eight built-in tools "refused" for all seven agents | had not read `NEEDS_NO_ENTRY`, which exempts them |
| controls with no accessible name | nine unnamed buttons | read the markup; the app sets those names at runtime, and `title` names the rest |
| dials never built | *"`buildDials` is only reached from a function nothing calls"* | grepped `fillDials()` with parentheses and missed `.then(fillDials)` |

Every one produced output that **looked like a finding**. Not one was checked by the thing it
measured. The last is the sharpest: the conclusion "this app never builds its dials" is refutable
in four seconds by opening one, and the app was already running in a browser beside the terminal.

The rule that came out of it, and the reason six became six rather than sixty: **a probe's output
is a hypothesis, and the running app is the only witness.** Every claim above that survived was
one that got measured against something other than the tool that produced it — the browser, a
sandbox, a mutation. Every one that died, died to that check.

Which is the same fault as the code all of this was hunting. `.tabs` held the traffic-light
clearance because nothing asked whether it was still worn; the catch sweep printed twelve
locations because nothing asked whether it could count. A tool that agrees with itself is not
evidence.

## Named, not fixed

- **CI is switched off.** `.github/workflows/checks.yml` is `state: disabled_manually` — nothing
  has run since 20 August, across thirty-one commits. The release checklist's first section
  requires it green on the release commit, and its whole argument is that it runs on **Linux**
  while both machines develop on macOS. Its own header says *"a skipped check is worse than none
  because it looks like cover"*, which is what a workflow file in the repo does while switched
  off.

  Its steps were run by hand on `176dc0b` and pass — typecheck clean, 1201/1201, 87.5% lines,
  89.6% branches — but that is macOS, which is the one thing the check exists not to be.

  Somebody disabled it deliberately, so it has been left alone and reported rather than switched
  back on. `gh workflow enable checks.yml` when you know why it went off.
- **`npm audit` reports 12, and none of them ship.** 11 high and 1 critical, every one traced to
  `electron-builder` — `tar` (critical) via `node-gyp` → `make-fetch-happen` → `cacache`. That
  tool runs at packaging time on a developer's machine and is in no artifact.

  The number that matters beside it: **`dependencies` is `{}`**. Nothing from npm is in the
  running app at all; the runtime is Electron and the `claude` already installed. "12
  vulnerabilities" and "12 vulnerabilities in the packaging tool of an app with no runtime
  dependencies" are different sentences, and only the second is true here.

  `npm audit fix --dry-run` changes nothing — there is no fix inside `^25.1.8`. Closing them
  means `electron-builder` 25 → 26, which is a major bump to the thing that builds and signs the
  DMG, and cannot be called done without packaging one and opening it on a machine that has
  never seen the repo. That is the same exit condition already unticked in the release checklist,
  so it is one decision rather than two.
- **The app is unsigned.** `xattr -cr` or right-click → Open, once per machine.
- **S6 and S7** are staged and green in `.claude/worktrees/night-1-peer` on `b70ad30`. That
  session is denied `Bash(git commit:*)` by `.claude/settings.json` — a rule written for Office
  Space's *employee agents* that also governs Claude Code sessions developing the product.
  Neither session routed around it.

## Night 2 — five more, one root cause each

Opened against `dev`, unmerged, each mutation-checked.

| PR | what | severity |
|---|---|---|
| #115 | the shipped `projects/_TEMPLATE/` must carry `<Project Name>`; the four `createProject` tests build their own fixture and would pass over an empty template | latent |
| #116 | **`.md.off` is a namespace only `disabled()` read** — hiring over a benched name lost the new file silently on unbench; firing a benched agent denied they existed; the benched manager was offered a Fire button | data loss |
| #117 | `themeProblems` collected and never folded into `toSnapshot` — `reportThemeFailure` did the downgrade and dropped the report | silent downgrade |
| #118 | `ThemeInfo.redistributable` built in four places, read in none, while `theme.ts` claimed the app surfaces it | undelivered |
| #119 | `AsideResult.costUsd` and `SessionInfo.costUsd` each cited the other as proof of a reader; neither has one | comment |

### The pattern worth keeping

Three of the five survived because **a comment asserted the read**. The note
explaining why `ThemeSelection` was deleted vouched by name for a fold that had
never been written; four comments described a theme failure being reported while
the reporting function dropped it; two fields pointed at each other. In this
codebase a comment is load-bearing enough that a false one is a defect, and the
grep that would have caught all three is "who *reads* this", never "who mentions
it".

`#116` is the other shape: a second namespace that one function knew about and
three did not, where every function was individually correct.

### Tests that were wrong before they were right

Worth recording, because all three failed in the direction that looks like
coverage:

- the `problems-reach-the-snapshot` scanner searched from the top of the file,
  found `problems: []` on an unrelated initialiser 288 lines earlier, and
  reported all nine collections as unread — failing correctly for a reason
  unrelated to the bug
- the same scanner then passed with the fix deleted, because the fix's own
  comment names `themeProblems` and the scanner was reading comments. The check
  written to catch a promise kept in prose was satisfied by prose
- `theme-view`'s "the licence names the pack" assertion matched the pack name in
  the *control* half of the same string, and passed with the name dropped from
  the sentence that needed it

### What the second session found

Sent the branches to the peer session for adversarial review, twice. Eleven
findings, and the ones that mattered were places I was wrong rather than places
I had stopped early.

| | |
|---|---|
| #122's first fix did not work | it waited for the next `office` broadcast; eight places send one and seven are built from a `workspace` the rescan has not replaced, so a cost update satisfied the wait with the stale snapshot. Weakest exactly when the office is busiest. Rebuilt to return the snapshot in the reply — nothing to wait for. |
| #116's traversal fix over-corrected | `whyInvalid` is the *hire-time* convention, and `fire`/`disable`/`enable` are handed whatever `readdir` found. The office drew `Reviewer`, `my_helper`, `data.scientist` and then refused to act on them. Narrowed to `whyUnsafeAsPath`. |
| `fire` with both files present | deleted the file belonging to the *other* row and reported success. `disable` and `enable` had the guard; the irreversible one did not. |
| the manager guard was weaker than the renderer | compared a literal while `staffRows` used `findManager`. Now takes the id. |
| #121 did not cover the case it named | `back: ''` with `previous` set is a visible button with no words, and the predicate tested for `null`. |

### Three tests that passed for the wrong reason

All three found by mutation, none by reading:

- the traversal loop's `ok === false` was satisfied by ENOENT rather than by the
  guard — every target is a real file now
- removing the slash check failed nothing, because every case in the loop also
  started with a dot: two overlapping guards reading as one tested guard
- the licence assertion matched the pack name in the *control* half of the
  string it was checking

And three mutations that silently did not apply, each reported as a clean pass
by a shell-quoting error. Mutations now go through a script that asserts the
edit landed before anything runs.

### Rounds 3 and 4 — the declared list, and a regression of my own

| PR | what |
|---|---|
| #124 | the packaged app shipped `dev.html` + `mock.js` — the harness that draws seven people who do not exist — plus 217 kB of source maps. Unreachable (`will-navigate` preventDefault, `setWindowOpenHandler` denies, `loadFile` only), so weight rather than a hole |
| #125 | `transcribe.ts` validated the model URL's host and then followed redirects anywhere. It is redirected **every time** — `302 → us.aws.cdn.hf.co` — so the privacy panel's *complete set of destinations* was wrong for anybody who had pressed the microphone |
| #126 | the same defect in `spotify/client.ts`, which #125's comment had cited as the module keeping the contract. Plus `art()` with no host check at all, and a token exchange that followed redirects with `refresh_token` in the body. Then: the bearer followed a hop to the image CDN, which the host check permits and cannot see |

**The regression worth remembering.** #123's first commit replaced an `rm` with a
`readdir` loop, which broke every single-file store — three Delete buttons
answered with a raw `ENOTDIR … scandir /Users/…` and deleted nothing, including
`dispatches.jsonl`, the file this repo's own comment calls the most personal
thing under `.office-space/`. Before the change the button deleted and
miscounted; after it, it did not delete at all. The suite stayed green because
every `forget` in the tests targeted `projects`, `memory`, or a store refused
before it reaches the filesystem.

### The shape that keeps recurring

Not "a comment asserting a read" any more — that was night 2's first half. The
second half is all one thing: **a check that validates the intention rather than
the act.**

- the host was checked on the URL, and the connection went wherever it was sent
- the credential was checked against the host, and carried across an origin
- `whyInvalid` checked the name somebody *chose*, applied to names `readdir` found
- the test asserted `ok === false`, which ENOENT gives for free
- the scanner asserted a name appeared, which its own comment satisfied
- the packaging test asserted a constant that the build script also holds

Every one passes while the thing it is about is broken, and every one reads as
coverage.

### Rounds 5 and 6 — where a fix was worse than the code it replaced

| PR | what |
|---|---|
| #127 | `decide()` took an id off the bridge and made it a filename: `decide(root, '../../../escaped', …)` wrote a verdict in the workspace's **parent**. An arbitrary-path write on the code path that records a security decision |
| #126 | the credential fix, and the one place tonight where the change was **more dangerous than what it replaced** — see below |
| #125 | hop 0 was checked for host and not scheme, and kept a fallback base that #126 had already dropped |

**The one that was worse.** `reach()` hand-rolls the redirect loop, and the code
it replaced — a plain `fetch` with default `redirect: 'follow'` — was getting
`Authorization` stripping from the Fetch spec **for free**. Hand-rolling gave
that up silently, so for one commit the API bearer travelled to `i.scdn.co`.
Not a guard forgotten; a guard removed. The general form is worth keeping: *a
hand-rolled loop inherits none of the spec behaviour of the thing it stands in
for.*

**Two modules diverging twice in the same direction.** `transcribe.ts` and
`spotify/client.ts` both run manual redirect loops, and both times review found
the same rule present in one and missing in the other — the scheme check, then
the fallback base. `test/redirect-loops-agree.test.ts` finds every loop by its
`redirect: 'manual'` and holds each to the same properties, so a third module
gets them too and a third divergence fails rather than waiting to be read.

### Checks that matched text rather than meaning

Both sessions hit this in the same hour, from opposite sides.

- the peer's marker scan flagged a "regression" that was the **retracted**
  sentence quoted inside the comment correcting it — a string match cannot tell
  a live claim from a confession
- `redirect-loops-agree`'s own first draft asserted the strings
  `protocol !== 'https:'` and `MAX_REDIRECTS` appeared *anywhere*; both survive
  `if (false) {` and a swapped literal

The cap became a comparison. The scheme check could not be expressed at all —
it has a different shape in each module — so the assertion is deliberately weak
and the file names the behaviour tests that really cover it. **A scanner should
say which properties it cannot hold.**

### Still open

`scripts/unread-fields.mjs` reports 27. Most are the index-signature blind spot
its header describes. `OfficeSnapshot.scannedAt` is unread on the wire and
claims nothing; `CapabilityReport.access` and `.tools` are unread but duplicate
what the roster shows. Nothing there is lying to a user.

`node scripts/unread-fields.mjs` and `node scripts/unused-types.mjs` are run by
no npm script and by no test — `unused-types` at least has `test/unused-types.test.ts`
wrapping it. `unread-fields` is run only when somebody remembers, which is how
`redistributable` sat in its output.

## Merging night 2 — one pair needs a hand

Fourteen branches compose onto `dev` with **no textual conflicts**, and one
semantic conflict that a clean merge hides:

    #116 the-bench-is-a-namespace              adds  managerNow() → findManager(workspace)
    #128 the-office-flagged-its-own-manager     moves findManager to take Employee[]

**Corrected, and the correction is the point.** This first said #122, which does
not call `findManager` at all. The call site is `managerNow()` on #116 — the
helper added so `fire` and `disable` would agree with `staffRows` about who the
manager is. A merge note that names the wrong branch is worse than none: it sends
the next person to a diff where the line is not, and they conclude it is already
fixed.

Neither branch is wrong alone. Merged, `main.ts:1448` passes a `Workspace` where
an `Employee[]` is wanted, and `tsc` catches it:

    Argument of type 'Workspace' is not assignable to parameter of type 'readonly Employee[]'

**Resolved by stacking, not by a note.** #128 is rebased onto #116 and carries
the one-line fix, so merging #116 then #128 needs no manual step. That is the
durable form: a documented resolution is performed from memory, and this one was
written down wrong the first time.

The invariant is narrower than *typecheck the merge*: **a signature change and a
new call site are a conflict only the compiler can see, and they need not touch
the same function — only the same symbol.** Git reported zero conflicts because
the two edits are hundreds of lines apart.

Worth stating plainly because it is the failure mode a green merge produces: git
had nothing to report — the two changes are in different parts of the file — and
the only thing that found it was compiling the result. **Merging these branches
without a typecheck of the merged tree would ship a build that does not compile.**

The other pair that touches one function, #116 and #122 in `rosterWrite`,
composes correctly: #122's design is present entire and #116's confirmation
wording survives. Checked in review.

### Order

`#116` before `#128`; they are a stack. `night-2-handoff` is documentation only.
Everything else is independent and can land in any order.

## All 44 PRs, composed — measured rather than assumed

Merging every open feature branch onto `dev` in **numeric order**: 30 go in
clean, 13 conflict. Nobody had tried this; night 1's branches and night 2's were
both cut from `8eb219a` and had only ever been composed within their own night.

Ten of the thirteen are two changes appending to the same file:

    planning/NIGHT-1-HANDOFF.md   #94, #100, #110
    test/repo-health.test.ts      #102, #104, #124, #133
    test/registry.test.ts         #106
    test/stream.test.ts           #107
    test/spotify.test.ts          #126

Resolve by keeping both, in either order. **Do not splice the conflict region by
hand** — I did that four times tonight and cut a closing brace across a test
boundary three of them. What works: take one side's file whole
(`git checkout <branch> -- <file>`), then append the other side's added block,
lifted from its commit with `git show <sha>:<file>`.

Three are real source collisions and want reading:

    src/main/roster.ts    #116, #128   night 1's roster traversal work meets the
                                       bench namespace and the manager rule
    src/main/main.ts      #125         the redirect loop meets night 1's changes

### Order does not fix it

Merging night 1 first and night 2 second was tried. The conflicts are between the
two nights on the same functions, so no ordering removes them — they have to be
resolved once, and after that the tree is stable.

### What is already stacked, and needs no resolution

    #116 → #128        the sixth `findManager` call site
    #123 → #132        `measureOne`, where either side alone loses a guard
    #118 → #124 → #133 `app.ts` and `repo-health.test.ts`
    #127 → #135        `safe-path.ts`

Merge each stack in its own order and those four pairs cost nothing.

## The one conflict where taking the safer-looking side is wrong

`src/main/roster.ts`, #99 against #116. Both add a guard to `fire`, `disable`
and `enable`, and they are not the same guard.

    #99   notAnAgentId(id)      →  isValidAgentId  →  /^[a-z0-9][a-z0-9-]{0,63}$/
    #116  whyUnsafeAsPath(id)   →  separators, `.`, `..`, leading dot, control chars

#99's is the **hire-time naming convention**, and applying it here makes the
office refuse to act on rows it has already drawn. `Reviewer.md`, `my_helper.md`
and `data.scientist.md` are all found by `discoverWorkspace`, given a Send home
and a Fire button, and answered with a complaint about a name the user never
typed. Hand-writing an agent file is the documented way to add one.

#99's *test* encodes it:

    for (const id of ['..', '.', '', 'a/b', 'a\b', './x', 'x/../y',
                      'UPPER', '-leading', 'x'.repeat(65)])
      assert.equal((await fire(root, id)).ok, false)

The last three are not traversals. `UPPER` is `Reviewer`-shaped.

**So the resolution is to take #116's guard and correct #99's test**, and the
thing to notice is that this is the opposite of what the conflict looks like:
#99's rule is visibly stricter, its test is named `THE BUG:`, and taking it
reintroduces a defect that a later review found and named.

Both are right about the danger. Only one is right about which names the office
draws.

### And the guard was already there

#99 fixed this traversal on night 1. On night 2 I searched every branch for
`notAnAgentId`, found nothing, and reimplemented it — the search was one of the
loops with the zsh quoting bug that made several sweeps silently return empty.
The duplicate is the reason the two guards exist to conflict at all.
