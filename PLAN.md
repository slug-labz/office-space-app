# Office Space — PLAN

<!-- pulse -->

> Living plan. The vision is locked and canonical: [VISION.md](VISION.md). This document tracks
> how we are building it and what is actually true today. Dates are absolute.
>
> **Last reconciled against the code: 2026-09-01.** The status board's counts, release and CI
> state were re-measured on 2026-09-28; the rest of the plan was not reconciled that day.
>
> Live tasks are in [TASKS.md](TASKS.md), the progress log from 2026-09-17 on is in
> [PROGRESS.md](PROGRESS.md), and decisions from D15 on are in [DECISIONS.md](DECISIONS.md).

## 0. Status board

| Field | State |
|---|---|
| Phase | **2 — building; v0.0.1 is out.** 270 PRs merged into `dev` (GitHub's count of merged PRs based on `dev`, 2026-09-28; the same count gave 234 on 2026-09-17); the app builds, packages and runs. **v0.0.1** is a published GitHub Release (2026-09-25 04:25Z) with two macOS disk images, tagged at `1ab4004`, the #283 release. `main` has held all of `dev` since #286 (2026-09-28, `028c64b`, from `dev` at `10fa326`). The releases before it are recorded in PROGRESS.md: #277, #278 (merged on a red `local-checks` by the maintainer's explicit decision), #282 and #283. |
| What it is | A frontend for a Claude Code workspace, rendered as an office |
| Backend | **The user's own `claude` CLI**, spawned. Plus a `.claude/` workspace. No server. |
| Frontend | **Electron + Canvas 2D.** No React, no Pixi, no bundler for the renderer. |
| Repo | [`slug-labz/office-space`](https://github.com/slug-labz/office-space) |
| Tests | 3012 across 259 files on `dev` at `10fa326`, the commit #286 released, plus two typecheck configs: all 3012 pass, none skipped, 88.95% of lines covered (measured 2026-09-28 at 06:36Z on macOS with `scripts/ci-local.mjs`, load 3.3 → 7.2). Last green on Linux in CI: `e6fe5cb`, 2026-09-17 04:23Z |
| Blocked on | **Nothing. CI runs again.** It had refused every job from 2026-09-17 04:37:55Z, for as long as the account's Actions quota was spent, and resumed at 2026-10-01 08:24:00Z — the first run to execute took 195 s where the refusals took 3 to 5. `main` at `753342f` and `dev` at `4c9b5fc` are both green on real runs (242 s and 259 s). That green is `main`'s first genuine verdict since 2026-09-03: the five runs between were refusals, four of 4 to 5 s and one of 73 s with `steps=0`. Merges between 09-17 and 10-01 went ahead on local checks, and nothing in that window ran on Linux; see D15. **`local-checks` is no longer the gate** — it runs Node 22.16.0 while CI resolves `node-version: 22` to 22.23.2, and #297 is a test that passed on one and failed on the other. TASKS.md rows 95 and 96 are what is left of the timeout question |

---

## 1. The thesis

Everyone already runs Claude Code. Nobody can **see** it working, run several projects properly
at once, or keep every one of Claude's abilities while doing so. Office Space is the face:
project tabs, an office floor of agent-employees, a chat panel wired to a manager agent, and
click-to-ask status bubbles.

Full detail in [VISION.md](VISION.md).

---

## 2. The decisive architectural call — corrected 2026-08-19

**We spawn the user's own `claude`. We do not embed an agent runtime.**

⚠️ **This reverses what this document said until 2026-08-19.** The original plan named the
**Claude Agent SDK** as the backend. Research into the auth requirement found that this is
precisely what Anthropic's policy prohibits, and that it names the SDK by name:

> Unless previously approved, Anthropic does not allow third party developers to offer
> claude.ai login or rate limits for their products, **including agents built on the Claude
> Agent SDK.**

The vision's requirement — the same login the VS Code extension uses, not a separate key — and
the Agent SDK are therefore incompatible. There are three positions and only one is comfortable:

| | What it is | Verdict |
|---|---|---|
| **Spawn the user's own `claude`** | We start a program they installed and logged into. Requests go from their machine, on their plan. | **What we do.** The relationship a terminal emulator has to a shell. |
| Embed the Agent SDK | We bundle a runtime that reads their keychain. | The grey zone the policy names. Avoided. |
| Implement OAuth | A "Log in with Claude" button. | Clearly prohibited. |

Proven live 2026-08-18: `is_error: false`, real cost, real result. Full reasoning in
[docs/auth.md](docs/auth.md).

Two consequences worth stating, because they are easy to relearn the hard way:

- **Success comes from the `result` event, never the exit code.** An expired token exits
  non-zero *and* reports a result; a refusal can exit zero.
- **`--verbose` is not optional.** Without it the stream collapses to a single event and the
  floor has nothing to render.

---

## 3. What is built

| Area | Where | State |
|---|---|---|
| Workspace discovery + live watch | `src/main/workspace.ts` | ✅ Add an agent, a desk appears |
| Floor movement | `src/shared/floor/` | ✅ grid, BFS, walker, floorplan |
| Choreography | `src/shared/floor/choreography.ts` | ✅ dispatch → office → desk → deliver |
| Characters | `src/shared/character/` | ✅ drawn in code, deterministic per name |
| CLI adapter | `src/main/claude/` | ✅ stream, run, asides via `--fork-session` |
| Electron shell | `src/main/main.ts`, `src/preload/`, `src/renderer/` | ✅ sandboxed, CSP, IPC |
| Chat panel | `src/renderer/chat-view.ts` | ✅ renders the real session, tool calls included |
| Speech bubbles | `src/shared/floor/bubbles.ts`, `src/renderer/floor-view.ts` | ✅ click someone and they answer over their head; a stale answer is dropped, never shown |
| Session registry | `src/main/registry.ts` | ✅ sessions written down per workspace, atomically; a registry that cannot be read is reported, never rendered as no history |
| Picking up where you left off | `src/main/transcript-store.ts`, `src/shared/transcript/parse.ts` | ✅ reopen the app and the conversation is there, resumed and rendered |
| Project tabs | `src/main/projects.ts`, `src/renderer/app.ts` | ✅ a tab per directory under `projects/`, each with its own session, transcript and floor, all running at once |
| What the office may run | `.claude/settings.json`, `src/main/trust.ts` | ✅ an allowlist, and a warning on the floor when an untrusted workspace makes it moot |
| Voice | `src/main/voice/`, `src/shared/voice/` | ✅ off by default and free while off; any project may speak, and says which one |
| What an employee actually did | `src/main/subagents.ts` | ✅ their own record, read from disk — not the manager's account of it |
| The VERIFY harness | `src/main/harness.ts`, `verify.ts`, `permissions.ts`, `src/shared/tasks.ts` | ✅ reads `TASKS.md`, runs what the workspace permits, reports four outcomes |
| A project is a group of sessions | `src/main/main.ts`, `src/renderer/app.ts` | ✅ many conversations per project, each with its own transcript and its own floor |
| The harness on the floor | `src/shared/tasks.ts`, `src/renderer/floor-view.ts` | ✅ each employee carries a mark for their worst outstanding task |
| The skills shelf | `.claude/skills/`, `src/shared/floor/` | ✅ two skills ship, and using one walks somebody to the shelf and back |
| File-based themes | `src/shared/theme/slicing.ts`, `src/renderer/floor-view.ts` | ✅ an installed pack renders; a broken one is reported, never silently swapped |
| Dev harness | `src/renderer/mock.ts` | ✅ the real renderer, no Electron, no cost |

### Built but **not wired**

Honest accounting — these exist and are tested, and none of them is reachable from the UI yet.

**This table is now empty.** Its one remaining row is struck through below, and the section is
kept rather than deleted because what it recorded is worth keeping: a thing that exists, works
and cannot be reached is the failure this project most wants to catch itself committing.

| Thing | Where | What is missing |
|---|---|---|
| ~~Hook event feed~~ | ~~`.claude/hooks/floor-feed.mjs`~~ | **Gone — settled, not outstanding.** The file is not in `.claude/hooks/` (only `approval-gate.mjs` is), and `persistence.ts` says of the log it wrote: *"nothing writes this any more ... the code that wrote it is gone."* See §4 E. |

This table was itself incomplete until 2026-08-19: the transcript reader had no importer, no
test and no entry here, which is the same failure the office rule forbids, committed in the
document whose job is to prevent it. It has since been wired — restoring a session is what it
was written for — and is no longer listed above.

---

## 4. Next

Five things were listed here. **A through D are done** and struck through below; **E was
settled by deleting the feed** — the reasoning is under E, with the evidence. Nothing in this
section is outstanding.

They were ordered by dependency rather than by size: **A** changes how the floor is keyed, and
**B** and **C** both draw on the floor, so doing A last would mean doing B and C twice.

### ~~A. More than one session per project~~ — done 2026-08-19

The vision's remaining structural claim: *"a project is not a session — it is a group of
sessions."* Sessions are keyed by their own id, a project knows which one it is showing, and
the strip under the tabs is the group. Two conversations in one project have separate
transcripts and separate floors, and both survive being switched away from.

1. Registry: list every session for a project, not only the one to resume.
2. Main: a project holds N sessions and knows which is current; `sessionFor` keyed by session
   rather than by project.
3. IPC: `sessionsOf(project)`, `openSession(project, id)`, `newSession(project)`.
4. Floor: scenes keyed by **session**, not project — two sessions in one project are two
   different pieces of work and must not share a floor.
5. UI: a session strip under the tab bar; title, when it was last touched, and a way to start
   another.

**VERIFY** — two sessions in one project, each with its own transcript and its own floor,
both surviving a switch away and back.

### ~~B. The harness on the floor~~ — done 2026-08-19

Each employee carries a mark for their worst outstanding task, left of their name — a failure
outranks everything, and "we do not know" is never swallowed by "some of it is fine". Doing it
turned up that the harness was reading `.claude/settings.json` **without regard to whether the
workspace was trusted**, which would have made the trust prompt a gate with a door beside it.

1. Map a task's `owner` to a name on the floor.
2. Carry each employee's worst outstanding outcome to the renderer.
3. Draw it on the character — the label already has room for a marker.
4. Re-read after the harness runs.

**VERIFY** — a failing task shows on its owner, and clears when it passes.

### ~~C. The skills shelf~~ — done 2026-08-19

The office ships two skills, and using one walks the caller to the shelf, holds them there for a
beat, and walks them back to their desk. One book on the shelf per skill the workspace actually
has, so an empty shelf is an honest picture of a workspace with none.

1. Write the office's own skills, so the shelf is not a prop.
2. Floorplan: a shelf, and somewhere to stand at it.
3. Facts: a `Skill` tool call is a fact the floor can act on.
4. Choreography: fetch — walk to the shelf, pause, carry it back to the desk.
5. Renderer: draw the shelf.

**VERIFY** — a scripted skill call in the dev harness walks somebody to the shelf and back.

### ~~D. File-based themes~~ — done 2026-08-19

An installed pack renders. Main sends the file plus where to cut it, the renderer decodes and
crops, and both themes leave as the same bitmaps. Verified against a synthetic pack generated by
`scratch/make-theme.ts` — no purchased art is committed, ever.

1. IPC: list installed themes, choose one.
2. Renderer: decode each sheet and slice it by the manifest's `layout`.
3. Fall back to the built-in cast **loudly** — a theme that fails to load is reported, never
   silently swapped.
4. Show the credit wherever the theme is named; most licences require it.

**VERIFY** — a synthetic pack, generated for the test, renders instead of the drawn cast. No
purchased art is committed, ever.

### ~~E. Decide the hook feed's fate~~ — settled: deleted

Open since D9. `.claude/hooks/floor-feed.mjs` records every lifecycle event; nothing reads it,
and the floor is driven by the CLI stream instead. Two event paths that can disagree is worse
than one, so this is a decision before it is a task: either delete it, or give it the one job
the CLI stream cannot do — a record that outlives the process, which is what replay would need.

~~**This one is Khalid's call**, not something to settle by writing code.~~

**Settled, the first way: it was deleted.** `.claude/hooks/` holds `approval-gate.mjs` and
nothing else, and `persistence.ts` records the state it left behind — *"nothing writes this any
more ... the code that wrote it is gone."*

The log it used to produce is still handled, and handled the right way. It is listed in the
privacy panel as *"an event log the office no longer writes. Left over; safe to delete"* rather
than removed at startup, because "an app that quietly removed a file at startup because it
believed the file was obsolete is *exactly* the shape of the bug that used to eat this office's
conversations" — which is the same bug this branch fixed in the session registry on 2026-08-27.

Recorded here rather than left open because the entry named a decision the user still owed,
and they do not.

---

## 4a. Fixed on 2026-08-19 — the first outside review

The repo was read in full by someone who had not written it. What it found is recorded here
rather than only in a commit message, because two of the three bugs were invisible from the
outside and all five of the honesty gaps were the office breaking its own standing orders.

### Bugs

| | What was wrong | Why it mattered |
|---|---|---|
| **B1** | `ManagerSession` marked the session started *before* the run. A first message that failed — no `claude` on PATH, an expired token — left every later message resuming a session that was never created. | One recoverable failure became a permanent one. The office stayed broken until it was restarted. |
| **B2** | `setCast` rebuilt the `Choreographer` and every `RoutineRunner` on any workspace change. A rescan mid-task threw away the `tool_use` → employee map and dropped routines in progress. | Adding an agent file while a subagent ran left the employee standing at their desk forever while the transcript said the task was done. The floor outliving the fact it depicts — caused by an event unrelated to the work. |
| **B3** | `setCast` fetched each new agent's sprite sheet twice: once for the art, once to read its dimensions. | An extra IPC round trip and a second decode per hire. |

`Choreographer.updateRoster` and `RoutineRunner.retarget` are the fix for B2 — the roster is
swapped in place and a walk in progress is re-routed from where the character actually is.

Also folded in: the delegation tool was named in four places and only one of them accepted both
spellings. The lint took `Agent` or `Task`; the choreography, the digest and the transcript card
hard-coded `Task`. That combination fails in the worst available way — the day the CLI settles
on the other name, the lint keeps passing and the floor goes quiet, so the office carries on
looking correct while it has stopped depicting the one event the product is built around. One
definition now, in `src/shared/delegation.ts`.

### Honesty gaps

Each of these was the repo asserting something that was not true.

| | The claim | The reality |
|---|---|---|
| **H1** | `.claude/agents/manager.md`: staff are injected each turn under `## CURRENT STAFF` and supersede any earlier roster. | Nothing anywhere wrote that block. The manager was following an instruction about something that never arrived, and choosing who to dispatch from memory. Now built by `staffBlock()` and prepended to every message. |
| **H2** | `aside.ts`: "verified end to end in `test/aside.test.ts`". | There was no such file. There is now — the real adapter against a stand-in binary that records its argv — and the comment now separates what the test proves from what was checked by hand. |
| **H3** | §3 above claimed to be an honest accounting of what is built but unwired. | It omitted `src/shared/transcript/parse.ts`: 271 lines, no importer, no test. Now listed and tested. |
| **H4** | 109 tests. | True, and none of them covered `workspace.ts`, `session.ts`, `run.ts` or `aside.ts` — including the module the "absent is not empty" rule is named after and the lint that enforces "only the manager may delegate". Now covered. |
| **H5** | `CLAUDE.md` named `app/`, `.claude/skills/` and `.claude/commands/`; `.gitignore` un-ignored three README files. | None of them existed. The table now describes the tree as it is, and the three READMEs exist. |

The pattern worth keeping: the discipline was being applied to this document and not to the
workspace files, the code comments, or the choice of what to test. A rule the repo states four
times is not a rule the repo is following.

---

## 4b. The visual system — started 2026-08-19

The floor is drawn in plan view, which is why it reads as a diagram rather than a room. Four
phases, ordered by dependency. Decisions taken with the user before starting: **32×16 tiles**
(keeps the current vertical pixel density, and matches the resolution the candidate art pack
ships), and **V1 lands presentable** — dev must never look worse than it does today, so basic
furniture folds into V1 rather than waiting for V2.

Full design: the two plan artifacts, *The Office, Re-drawn* and *The Building*.

### V1. The isometric projection — **the camera was removed; the module shipped renamed**

> **Read this before ticking anything below.** The list is half history and half misnamed, and
> the two halves need different corrections.
>
> **The isometric camera is gone, and deliberately.** `01e5a17` on `dev`, 19 Aug: *"Remove the
> rotation: an axis-aligned office, seen from above — the isometric camera is gone."* The floor
> that ships is axis-aligned and seen from above. So the entries below that describe *rotation*
> are not outstanding work; they were undone deliberately. The sharpest is **"depth sort by
> `x + y + z` rather than `y`"** — `projection.ts` sorts by `y`, and says why on the line above
> it: *"Only `y` matters now — with no rotation, distance from the camera is depth into the room
> and nothing else. (Isometric needed `x + y`; that is the other thing rotating the floor costs
> you.)"*
>
> **The projection module itself shipped, under a different name.** There is no `iso.ts`; the
> contract lives in `src/shared/floor/projection.ts`, with `test/projection.test.ts` beside it,
> and `props.ts` exists with its own tests. The first box below has been sending readers after a
> file that does not exist.
>
> **Note for whoever merges.** PR #169 rewrites this same section the other way — marking it
> *done 2026-08-27* and ticking the `x + y + z` sort against `depthOf`/`depthAt`. Those functions
> sort by `y`. Both edits touch these lines and both cannot be right; this one is written against
> `dev` as it stands today.
>
> Left unticked and unedited below, because a checklist rewritten to look finished would lose
> what was tried.

Every item below is built and under test. Two of them did not land the way this list described
them, and both deviations are recorded here rather than quietly ticked.

- [x] `src/shared/floor/iso.ts` — projection contract. Forward, inverse, depth key, bounds,
      diamond corners, occlusion test. Pure; no I/O. **Shipped as `src/shared/floor/projection.ts`.**
      There is no `iso.ts` and there never was; the name in this list has been sending readers
      after a file that does not exist.
- [x] `test/iso.test.ts` — round-trip `toScreen`/`toTile`, depth ordering, bounds. Shipped as
      `test/projection.test.ts`: 29 tests, including the round trip across a whole floor.
- [x] `src/renderer/props.ts` — isometric furniture primitives built on an iso cuboid. 46 tests
      in `test/props.test.ts`.
- [x] Character facing on an isometric floor. `directionFromDelta` in `src/shared/floor/geometry.ts`,
      which carries the reasoning in place: every facing is a screen diagonal now, and the
      four-sprite cast is held to that bargain deliberately.
- [x] `floor-view`: floor, walls and desks through the projection.
- [x] `floor-view`: depth sort by `x + y + z` rather than `y` — `depthOf` and `depthAt`.
- [x] `floor-view`: character draw, name labels and speech-bubble anchoring.
- [x] `floor-view`: click hit-testing. **Not through the inverse projection.** `pickCharacter`
      tests the click against each character's projected box instead, and says why where it does
      it. `toTile` exists and the tests exercise it, but the picker does not call it — a person
      clicks a *person*, not the tile underneath one.
- [x] Occlusion — fade, never hide, anything between the camera and a character. `occludes()`.
- [x] Canvas fit via `viewBounds`, keeping the integer-scale rule — `chooseScale`, bounded by
      `MIN_SCALE` and `MAX_SCALE`.
- [x] Reconcile the existing tests that assume plan view.
- [x] Run it. Look at it. Built, launched and driven; see
      [planning/MERGE-AND-HANDOVER.md](planning/MERGE-AND-HANDOVER.md).

**VERIFY** — met. The floor, cast, pathfinding, labels and bubbles all work in isometric,
clicking a character selects the one you clicked, and `npm test` is green at 1472.

### V2. Furniture and life

Real furniture, chairs, wall props, ambient idle animation, a lighting pass. Every prop reads
from a file so it reports rather than decorates — monitor from `TASKS.md`, whiteboard from
`VISION.md`, plant health from `last_updated`, wastebasket from blocked tasks. **Typing
animation binds to a live tool call and nothing else**; a character that types while nothing
runs is the exact failure the second standing order exists to prevent.

**VERIFY** — a stranger can tell who is working, who is stuck, and what the project is, without
reading the chat.

Two carried over from the axis-aligned camera landing on 2026-08-19, both seen in the running
app and both deferred rather than forgotten:

- [x] **The rug reads as a selection highlight.** Flat, light, hard-edged — it looks like UI
      chrome rather than a floor covering, which is worse than not drawing it. Needs a texture
      and a value nearer the carpet.
      **Done.** `drawRug` in `props.ts` now says why, in the words this item asked for: *"the
      value moves much nearer the carpet, so it stops announcing itself. And it gets bands:
      concentric borders are what makes a shape read as woven rather than as filled."*
- [x] **Name labels collide with the fixture row.** A label sits above its character's head,
      and at the front desk rows that head is level with the shelves and server racks, so the
      names float over furniture. Either the label dodges what is behind it, or fixtures and
      labels get separated in depth.
      **Done.** Labels sit on the desk when somebody is seated and above the head only when
      they are crossing the room — `drawLabel` records the same finding this item did: *"rows of
      pods sit back to back, so a tag floating over one person lands on the desk of the person
      behind them. Every dense arrangement collided — first with the fixtures, then with each
      other."*

- [x] **The theme row offers a choice nobody can see.** — **fixed, and this item was stale.**
      It read: two palettes ship and both are near-black, `night-shift` grounding at `#0b0e17`
      and `graphite` at `#0d0f11`, *"2, 1 and 6 out of 255 apart"*. Pressing either rewrote 41
      CSS variables and the change reached the paint; it was simply invisible on the surface
      that dominates the screen, so the first control anybody pressed appeared to do nothing.

      `GRAPHITE`'s ground is now `#1c1f24`, and its docstring records the repair and the
      reasoning — *"the floor canvas is 14.3% of the window, so the accent being opposite and
      the room being cooler were both true and both small: 86% of what you look at barely
      moved."*

      Re-measured 2026-09-05 — `npx tsx --test test/palette.test.ts`:

          night-shift ground[0]  #0b0e17
          graphite    ground[0]  #1c1f24
          delta                  17, 17, 13 out of 255      (was 2, 1, 6)

      Executed rather than read, in the running harness: pressing `graphite` moves
      `--background` from `#0b0e17` to `#1c1f24` and `--primary` from `#e8b25e` to `#6fb7c9`,
      and the panel and floor lighten visibly. It rewrites **39** CSS variables, all 39 of
      which differ between the two palettes — counted, not the "41" this document carried,
      which came from a prose comment in `apply-palette.dom.test.ts` that asserts nothing.

      The command is the existing `test/palette.test.ts`, not a new one. Its
      *"no two palettes the picker offers are the same colour"* iterates `PALETTES` pairwise
      on WCAG contrast across all three channels, with a companion test keeping the grounds
      dark so "make them differ" cannot be met by shipping a white theme.

### V3. The building

One floor per project, lobby in cutaway, elevator between. The lobby is the workspace
orchestrator's room and a floor is a project orchestrator's; the metaphor and the agent
architecture are the same shape. Floor fidelity is **abstracted activity** — lit windows and a
pulse per running agent, not N live simulations.

**VERIFY** — adding a project adds a floor, and the lobby answers "what should I work on"
without opening anything.

**Half of it landed 2026-09-06, and V3 stays unticked.** The campus already gave every project
a card that appears the moment its tab does, so *"adding a project adds a floor"* was done. What
it did not do was answer the second half: the only mark on a card was `busy`, under a comment in
`floor-view.ts` claiming that answered *"which of these wants me"*. It answers the opposite — a
project whose manager is running wants nothing, while one holding a tool call at the gate has
stopped and is refused after four minutes. A card now marks held approvals, ranked above busy.

**The stacked building, the cutaway lobby and the elevator are not being built — D14, 2026-09-09.**
The metaphor above rests on a workspace orchestrator, and there is no such agent: the roster is
seven, all project-level. The campus is not the shape that shipped *instead*; it is the shape.
What remains of this line is the half the campus did not answer. The count of held calls is
carried per project and drawn nowhere per project — `strip-line.ts` does print *"N calls need
you"*, but from the workspace-wide total, so the office can say how many are held and not which
room they are in. And nothing ranks the offices against each other. §5b records what
was given up and the two constraints the replacement has to meet.

§8's VERIFY for this line was `grep -rqi lobby src/`, a word search over source text of the kind
removed from two other guards this week. It is not satisfied by this change and must not be
satisfied by adding the word; it is replaced by a behavioural test — see §5b. *(2026-09-17: §8
now names that test, below. It does not exist yet, so the line stays unticked.)*

**The ranked list: agreed 2026-09-16 by Teammate 1 and Teammate 3, not yet frozen.** A list in
the all-offices view replaces the lobby. It is the second surface §5b asks for.

- **Where.** A fixed-height band, `min(12.5rem, 30vh)`, sits above the campus grid and outside
  `#stage`. Only the *all offices* toggle shows or hides it.
  - A column beside the grid would cost one campus column at every window width. The card size
    was measured; the stage widths were derived from the CSS.
  - A box that changes size with its content would re-column the grid and move the cards.
- **What it says.** Three groups: *Needs you*, *Working* and *Not running*.
  - **Every office appears once**, or is counted in a "more" line that never hides the office
    you are in.
  - **Rows say only what the snapshot carries.** For example:
    - `ostrich — 1 call needs you · reviewer is waiting · held since 11:58`
    - `kestrel — 2 conversations · working now`
    - `yak — 4 conversations · last active 2026-09-16 14:02`
    - `plover — no conversations listed`
  - **No countdowns and no ages.** Nothing on these surfaces redraws on a timer.
  - **The heading counts `approvals.length`**, the strip's own number. Calls that no listed
    office can claim get a line of their own, so the rows and that line always add up to it.
  - **The gate speaks through `gateLede`.** "No calls are held." appears only when the gate is
    wired and the held calls were read cleanly.
- **Order.**
  - *Needs you*: each office's oldest readable call time, then campus position.
  - *Working* and *Not running*: campus position only.
  - Never by name, and never with `localeCompare`.
- **How.**
  - One pure `officesNow()` in `src/shared/floor/needs-you.ts` returns the grid (exactly
    `campusFrom(...)`, in input order) and the list together, so one test checks both halves
    on what the app draws.
  - `app.ts` only hands them on. That is the one line no test reaches, and the PR will say so.
  - The switcher and the list share one wording function, one busy predicate and one
    `node:`-free `registryPath`.
- **"Without opening anything."** This is open: see Q1 below. The recommended reading is that
  the all-offices view is what shipped in the building's place, so a list there answers it. A
  later PR has each approval card name its office, which covers the default view.
- **Five PRs.**
  - PR 0: this plan.
  - PR 1: the gate's not-wired sentence. Merged as #241 on 2026-09-17.
  - PR 2a: ordering. Merged as #242 on 2026-09-17.
  - PR 2b: one vocabulary. Waits for the freeze.
  - PR 3: the list. Waits for the freeze.

  PR 1 and PR 2a went ahead of the freeze by agreement, because neither changes what a row
  says. V3 is ticked only through `/verify`, after PR 3.

**Open questions for the maintainer.** The freeze waits on these four.

- **Q1.** Does "without opening anything" still bind after D14, and does pressing *all offices*
  count as opening something? *Recommended:* it still binds, and the all-offices view meets it,
  as above.
- **Q8.** Should "calls held at launch never reach the window" be fixed before the list merges?
  *Recommended:* yes. Otherwise "No calls are held." can be false right after launch. That fix
  merged as #238 on 2026-09-17, so this is already true unless the answer is no.
- **Q13a.** Should the switcher's false phrases be fixed? "· never" would become "last active
  not recorded", and "no conversations yet" would become "no conversations listed".
  *Recommended:* yes. Both phrases can state something the data does not support.
- **Q13b.** Should the switcher and the list show clock times ("last active 2026-09-16 14:02")
  instead of ages ("2h ago")? This one is for the maintainer and the vision's author.
  *Recommended:* yes.
  A "no" has a cost: the band stays on screen with no timer, so ages there would need a redraw
  loop the plan rules out, or a list that words time differently from the switcher.

**Options considered, 2026-09-16.** Five sketches were written blind, one per frame (scope,
tester, reviewer, data and frontend). One critic read them next to Teammate 3's answer and
grouped the sixteen options into four.

- *Taken:* a list in the all-offices view (scope 2, tester 1, reviewer 3, data 1, frontend A,
  Teammate 3).
- *Kept in part, for later:* grouping the strip by office (scope 3, reviewer 2, data 3,
  frontend C).
  - It lists calls, not offices, and ranks nothing when nothing is held, so §5b's check would
    pass by default.
  - What survives from it: each approval card names its office.
- *Rejected:* re-sorting the switcher, or adding a group to it (scope 1, reviewer 1, tester 2,
  frontend B). The switcher is navigation behind a closed control, and every approval push
  rebuilds it.
- *Rejected:* ranking in main on a new channel (data 2, tester 3).
  - The contract would be hard to take back.
  - It would sit beside code no test reaches.
  - It would be a second source of truth for "running".
- *Also rejected:*
  - Drawing the list inside `FloorView`, which would put DOM work in a 2,265-line canvas class.
    Its test design is kept.
  - An overlay on the canvas, which covers cards.
  - A covering dialog, which makes the grid inert behind it.
  - A fixed-width column, which loses a campus column at every width.
  - Ranking inside `campusFrom`, which re-sorts the grid, in an order nothing tests.
  - The lobby, the building and the elevator, which D14 rules out.

#### Teammate 1 · opening draft

The opening draft was published on 2026-09-16. It proposed the list above, with:
- rows free of relative times;
- a line for calls no office can claim;
- a composer that returns both the grid and the list;
- nine asserts, each with a mutation that must fail it;
- a replacement §8 line.

It also carried six corrections to Teammate 3's first answer:
- `NOTHING_YET` means "nothing said yet".
- `*.dom.test.ts` files are typechecked.
- A null `lastActiveAt` has at least five causes.
- `elapsed()` counts seconds, and nothing ticks.
- A covering dialog hides the grid.
- A swap check on `layOutCampus` alone passes by construction.

#### Teammate 3 · round 1

In Teammate 3's own words, as sent on 2026-09-17 at 00:59Z:

> Round 1 on the V3 plan, from teammate 3. I read it at dev cc63256; #236 has merged since your draft.
>
> 1. YOUR SIX CORRECTIONS: I've taken all six, after checking each one.
> - NOTHING_YET is 'nothing said yet', and the switcher uses it only when conversations > 0 (switcher.ts:66, :153-157).
> - tsconfig.renderer.json:19-24 includes *.dom.test.ts, and typecheck runs both configs (package.json:14).
> - rowFor takes the first non-null updatedAt from sessionListOf (main.ts:644-656). Registry turns a missing updatedAt into '' (registry.ts:145). sessionsFor sorts with localeCompare, so 'not a date' outranks real dates (:268).
> - elapsed counts seconds (activity.ts:409-417), and the only tick is the open conversation's (app.ts:1762-1765).
> - Covering panels make the whole shell inert.
> - layOutCampus on a fixed input order comes out equal by construction.
> Three of my errors share one cause: I took a doc comment, or a single config file, as the behaviour.
>
> 2. WHERE THE SCREEN CAN STILL LIE
>
> (a) The gate headings overclaim, and they duplicate an existing sentence.
> - not-wired means no stanza gates SHELL commands: couldHoldACommand tests the matcher against 'Bash' (gate.ts:92-95), and :119-120 lists a Write|Edit matcher as not-wired. With a stanza like that the gate IS called, so Write and Edit calls ARE held, and "No calls can be held" is false.
> - hook-missing means shell commands run unapproved. It doesn't mean nothing can be held.
> - gate.ts:201-211 already has gateLede, kept there precisely so a view doesn't reword these answers. Use it for the three non-wired headings. The snapshot already carries gate (ipc.ts:179).
> - gateLede's own not-wired sentence has the same false first clause ("Nothing calls the approval gate"). That's my module. I'll fix it first, in its own small PR, so the list inherits a true sentence.
>
> (b) Heading precedence. "No calls are held." must never appear beside "Held calls could not be read" or a gate-unreadable line; either of those replaces the empty-group sentence, because a check that couldn't run is not a no. Also, on a read failure main keeps the last good list rather than pushing [], so rows can be out of date, not just incomplete. Suggested wording: "Held calls could not be re-read, so this list may be out of date."
>
> (c) Unplaced calls: the fixture only covers project: null. You found that ids absent from `projects` never reach a card, but no fixture call has one. An implementation with unplaced = count(project === null) would pass assert 4 and break the heading sum the first time an archived project's session holds a call. The fix:
> - define unplaced = approvals.length − Σ rows
> - add a call with project 'gone', expecting unplaced 2 and a heading of 4
> - add the mutation "unplaced counts only null projects"
>
> (d) Two vocabularies for one state, one click apart. The list's idle strings describe the same ProjectInfo the switcher calls "no conversations yet", "nothing said yet" and "· never". You're moving whoIsStuck into this PR precisely so three surfaces word a fact once, and the same argument applies here. Export one wording function, used by both the switcher and the list, in V3. If changing the switcher's words is judged too wide, ship V3 on the switcher's current words and fix both together later — never two vocabularies at once.
> If this comes in, bring the one-line registry.ts:268 comparator fix with it. Otherwise wren's "time unreadable" can print for a project that has a readable time.
>
> (e) The comparator (Q7). Share one, yes, but not code-unit order. inAnswerOrder and pending() both use localeCompare (approval-summary.ts:136, approvals.ts:192). Code-unit order still sorts '' before every real time, so an office whose call has an empty askedAt would rank as the oldest. Parse to epoch instead, put unreadable times last in the group, and break ties by campus position.
>
> (f) The idle cap must never hide the active office. campus-has-a-ceiling.test.ts already pins "the office you are working in is never the one dropped". Add a fixture with more than 12 idle offices, the focused one beyond position 12, asserting that rows + "and N more" = the idle count and that the focused row is present. The invariant becomes "every office once, or counted in the more-line".
>
> (g) The band's height at the minimum window. The width table is good, but height isn't analysed. The minimum is 900×600 (main.ts:2842-2843). The strip opens itself for a held call (app.ts:1720-1732), so exactly when the list matters, a ~200px band, the open strip and the chrome share 600px with the stage. The campus won't drop offices, since fitCampus fits against canvasCeiling rather than the visible height (floor-view.ts:1104-1106), but the visible grid shrinks. Cap the band — for example min(12.5rem, 30vh), which is still fixed for a given window — and add a look.mjs state at 900×600 with a held call.
>
> 3. CUT FROM THE FIRST PR: onCampusFitted and the "not on the grid" suffix.
> - The campus already prints its own omitted note (campus.ts NOTE_ROW), and the list shows every office.
> - The suffix adds a render path from FloorView to app that no assert covers, for a state that starts at hundreds of offices.
> - openOffice(id) already knows its own drawn cards, so it can skip the zoom without a callback.
>
> 4. TEST NITS
> - Run assert 2's regex on the text after "name — ", with word boundaries on ago|left|never, or an office named "Neverland" fails it.
> - Keyboard: give the list one tab stop with roving focus and arrows inside. With hundreds of offices, tabbing through every row is unusable.
> - Runtime: nothing pins Node for /verify. CI pins 22 (checks.yml:81), engines says >=20, and there's no .nvmrc. Record node -v with the tick.
>
> 5. ANSWERS
> - Q2: the band, with the height cap from (g).
> - Q3: campus position.
> - Q4: every office once, with idle capped at 12, plus (f).
> - Q5: match the problem's rule or kind, not its path string. A snapshot history field later is fine.
> - Q6: the conversation that asked. If several in one office hold calls, the one with the oldest call, matching the row's "oldest held since".
> - Q7: shared, but parse-based, as in (e).
> - Q9: yes, at position 0. The office's id is '', so keep the !project mutation in assert 4.
> - Q11: separately, after V3.
> - Q12: yes, reworded to "an office card", covered by assert 9.
> - Q1 and Q8: I'm putting them to Vish.
>
> 6. BUILDING IT: yes, on your terms.
> - One branch from dev, cut after #237 lands.
> - Only after the freeze line has both our signatures and Vish has answered Q1 and Q8.
> - I build; you review against the page.
> - If you take (a), the gateLede fix goes first as its own PR.
> Until then I'm holding: no branch, and PLAN.md untouched.

#### Teammate 1 · round 1 reply

All eleven points were taken, each after re-reading the code behind it:
- the gate's own sentence;
- a precedence rule for "No calls are held.";
- unplaced calls by subtraction, with a `'gone'` call in the fixture;
- one vocabulary;
- a parse-based comparator;
- an idle cap that keeps the office you are in;
- the band capped at `min(12.5rem, 30vh)`;
- the "not on the grid" suffix cut;
- the assert-2 pattern scoped;
- roving focus;
- `node -v` recorded with the tick.

One point was pushed back on. Registry trouble cannot be recognised by problem kind:
`unreadable-file` has eleven producers in five files, and the registry's two problems carry no
rule. One shared `registryPath` was proposed instead. Q14 was added: one busy predicate for the
switcher.

#### Teammate 3 · round 2

In Teammate 3's own words, as sent on 2026-09-17 at 01:17Z:

> V3 round 2 from teammate 3. I read draft 2 (on disk, 18:12) at dev cc63256 and checked it line by line against draft 1: round 1 is folded in correctly. I accept Q5 and Q14 with small conditions, split PR 2 in two, and ask for Q13 in two parts. If you take those as written, you can add my signature without another round.
>
> Q5 — ACCEPT, WITH TWO CONDITIONS
> I checked before agreeing. The snapshot carries `root` (ipc.ts:124), and both registry problems are built with registryPath(WORKSPACE_ROOT) (main.ts:1435 and :3042). So comparing problem.path against the same function applied to snapshot.root is equal by construction. Your count is right too: 11 producers in 5 files; the 12th grep hit is the type at workspace.ts:68.
> 1. One definition, with no `node:` import. registry.ts:330 calls `join` from node:path, and the renderer can't import node: modules. So the shared version must avoid node:, and main's two producers and registry.ts's own I/O must import that same function. Delete the main-only copy; two definitions of this path is the "agree until they don't" shape again.
> 2. A negative test. A theme unreadable-file problem (the shape at main.ts:553) must not raise the registry note; the registry's path must.
> This beats adding a new discriminator field. No test can reach main.ts, but its two call sites already use registryPath, so there's nothing new for them to remember.
>
> Q14 — ACCEPT, WITH ONE REFINEMENT
> busyProjects is rebuilt from scratch on every state change (app.ts:461-471), so it can't stay stuck at true, and it's safe to spread further.
> Keep the OR in one place: a single shared busy predicate that both campusFrom and projectRows call. Have it drive the switcher row's dot as well (running → views/switcher.ts:412), not just "working now" — otherwise heron shows "working now" next to an unlit dot. Pin both the text and the dot in the heron case.
>
> PR SPLIT — COUNTER: SPLIT PR 2
> - 2a, ordering: the parse-based comparator (used by inAnswerOrder) and registry.ts:268's parse sort. No visible words change, so it needn't wait on Q13. It touches registry.ts, which the user's running "closed conversations" task also changes: land it after that task, or rebase over it.
> - 2b, one vocabulary: the shared wording function in projectRows, the busy predicate (Q14), and the whoIsStuck move. Gated on Q13. test/switcher.test.ts:80 also pins 'never', for null, as well as :82.
> - PR 0: #237 also edits PLAN.md, so cut PR 0 after #237 merges. Its §4b text waits on Q1.
> - On origin, #237 is still the only open PR, and none of the user's five fixes has pushed a branch. Whoever starts 2a or 2b should check again before cutting.
>
> Q13 — ASK IT IN TWO PARTS
> As written it bundles two decisions.
> - 13a, the false phrases: "· never" becomes "last active not recorded", and "no conversations yet" becomes "no conversations listed". This is a correctness fix; recommend yes.
> - 13b, clock times instead of "2h ago": this is presentation, but "no" isn't a free answer. The band stays on screen with no timer, so relative ages there need a redraw loop, which the plan rules out. A "no" means either adding that loop or letting the list diverge from the switcher.
>
> EVERYTHING ELSE: I checked the rest and agree: assert 11's precedence, assert 12, the cap rule, the band cap, cutting the suffix, roving focus, and recording node -v.
>
> SIGNING
> If you fold in Q5's two conditions, Q14's single predicate, the 2a/2b split and the Q13 split as written, add my signature:
> [the freeze line's wording, with the date PR 0 lands and both signatures — elided here, so that nothing reading this file for that line takes the plan as frozen]
> Use the date PR 0 lands, not today's; the user answers Q1, Q8 and Q13 first. If you counter any of these, send it back to me.
>
> I'm putting Q1, Q8, 13a and 13b to Vish now. Still holding: no branch, no PLAN.md edits.

#### Teammate 1 · round 2 reply

All four conditions were taken as written, each after re-reading its citations:
- one `node:`-free `registryPath`, used by main, `registry.ts` and the list, with a negative
  test (assert 13);
- one busy predicate for both the switcher's text and its dot (assert 3);
- PR 2 split into 2a (ordering) and 2b (vocabulary), with PR 0 cut after #237;
- Q13 split into 13a and 13b.

**Correction, 2026-09-17, before the freeze.** Round 2 left §8's V3 line naming three test
files: `campus.test.ts`, `which-office-needs-you.test.ts` and `which-office-needs-you.dom.test.ts`.
That line could not fail. Measured on Node 22.16.0 with tsx 4.23.12: `tsx --test`, given one
file that exists and one that does not, exits 0 and never mentions the missing file. So on
2026-09-17, before PR 3 existed, the line passed on `campus.test.ts` alone. §8 now names only
`test/which-office-needs-you.test.ts`. PR 3 must put two things in that file:
- §5b's check: office B is ranked first and says why, and answering B moves no card;
- assert 9: adding a project adds an office card.

The DOM test is still PR 3's own evidence, but §8 does not rely on it. Teammate 3 signed the
three-file line and has not seen this change.

**Not frozen.** Both signatures are given on the terms above. The freeze line is added here, on
the day this plan and the maintainer's answers to Q1, Q8, Q13a and Q13b are both on `dev`. It
names that date and both teammates, in the form the plan-together skill gives. Until then, PR 2b and PR 3 are
not started.

### V4. The arrival

Procedural exterior driven by real workspace data, four-beat fly-in, skip on any input, first
run per workspace only.

**The boot figures this section used to give have no recorded source, and they do not describe
today's tree.** It read: *"Measured before designing: the whole main-process boot is 7 ms warm, 24 ms
cold, so this covers no work and is a deliberate spend."* Whether they were true of the tree they
were written about is not known. That tree, `b3e462d`, had a 960-line `main.ts` with 23 imports,
whose `whenReady` made seven calls before `createWindow()`; today's has 3,501 lines and 72 imports.
Neither this correction nor its reviews timed the older tree, and nothing in the places audited
below records anyone doing so.

Audited 2026-09-09. In the `dev` tree that string appeared once — here. No boot timer in
`scripts/`, no `performance.now` or `hrtime` anywhere in `src/main/`, no entry in
`docs/retracted.md` — though that file scopes itself to commit messages and source comments on
`every-button-in-the-app`, so its silence about a PLAN.md claim is weak evidence, not strong.

Across branches it goes further, in two ways — measured 2026-09-15. 233 of the 252 remote
branches carry the original line in their own copy of this file; a 234th, this correction's own
branch, only quotes it. And apart from this correction's own quotations it was copied into one
other document: `planning/01-PLAN.md` in `7fd10e0`, now `planning/archive/01-PLAN.md:430` on
`origin/plan/office-space-completion`, as a task table's justification column. Both came after its
first appearance, so it spread from here rather than into here.

`git log -S` on `dev` puts it first in `b3e462d`. Across all refs the earliest is `fbe0482` — the
same patch under the same author date, committed 2 h 19 min before `b3e462d` and reachable from
one remote branch, `origin/feat/isometric-floor`. `b3e462d`'s body opens "Measured before
designing" about a different measurement entirely: that seven of eight modules under
`src/shared/floor/` contain no pixel arithmetic. That commit touched `iso.ts`, its test, PLAN.md
and `.gitignore`. **What that means about the author's intent is not recorded and is not claimed
here.** The first version of this correction said the phrase was "borrowed" — a claim about a
person's mind, stated as fact, inside a correction about claims stated as fact.

Now measured, with a command — `node scripts/boot-time.mjs 7`, run at 2026-09-15 08:24Z on this
branch after its rebase onto `dev` at `e457bee`, built from the code this commit ships; only this
file's text changed after the run. Built with `npm run build` and run unpackaged, Electron 43.4.1,
warm, load average 4.0 throughout. Medians of 7 runs, in milliseconds on `performance.now()` in
the Electron main process. Node documents that clock's zero as the start of the process; the #231
review measured it landing about 30 ms after the binary is spawned, so the module graph and most
of Electron's own startup are inside these numbers and that first stretch is not:

| phase | median | what it is |
|---|---|---|
| `ready` | 153 ms | Electron reached `whenReady` |
| `checks-done` | 195 ms | everything in the `whenReady` callback before `createWindow()` had run: the `OFFICE_HEADLESS` dock check (the spawn passes the caller's environment on — measured — so the Dock is hidden only when the caller set `OFFICE_HEADLESS=1`; no record of this run's environment was found, so which way it went here is not known), the CSP and permission handlers, `registerHandlers()`, finding `claude` and the themes, settling the workspace root, the registry, shipped files and orphans, starting `watchApprovals`, and then the five checks |
| `window-created` | 268 ms | `createWindow()` returned; the callback carries on after this, starting `watchWorkspace` |
| `ready-to-show` | 377 ms | the window can be shown |

Each row is the moment that point was reached, not what the work beside it cost; the cost of the
work between two points is the interval.

The dock check is one entry above whose work depends on the caller's environment, and not the
only one: in the source, finding `claude` reads `PATH` and `OFFICE_CLAUDE_PATH`, and settling the
workspace root reads `OFFICE_WORKSPACE`. How much any of them moves these timings was not
measured. `boot-time.mjs`
does not set `OFFICE_HEADLESS`; it spawns the boot with this process's environment, so the
variable arrives from the caller, and `src/main/main.ts` hides the Dock when it is `'1'`. That the
spawn passes it through is **measured**, on `dev`'s copy of the script through a stand-in `npx`;
that Electron then hands it to the main process's `process.env` is **inferred**. Which value the
08:24Z run had is recorded nowhere found — this file's history, #231, and every commit message
across all refs were searched — so the row above does not say. The script now prints
`OFFICE_HEADLESS` beside the load average, so the next table can say which it had; it does not
print the others.

Intervals are medians of per-run differences, which the script prints, rather than one median
subtracted from another — on these same runs the two disagree, 91.2 against 109.1 ms for
`window-created→ready-to-show`. `ready→checks-done` 43 ms, `checks-done→window-created` 69 ms,
`window-created→ready-to-show` 91 ms. None of them is a constant: a run on this branch before its
rebase, at load average 3.3, measured 41, 48 and 75 ms, and the #231 review measured the first at
about 70 ms at load average 11–14 on an older `dev`.

**None of the four phases or three intervals this script measured is near 7 ms.** That is as far
as this measurement goes. Pieces inside those intervals can be that small: the #231 review, on this
branch before its rebase, marked three more points inside `ready→checks-done` and measured the
stretch from `registerHandlers()` to `watchApprovals` at 8.8 ms and the five checks at 13.5 ms,
medians of 7 runs at load average 5. A narrow enough reading of "boot" could land near 7 ms, and
neither this correction nor its reviews measured the 2026-08-19 tree.

**The original conclusion survives, though, and the first version of this correction got that
backwards.** It claimed the finding "inverts the argument" — that there is a third of a second of
real boot for the fly-in to cover. There is not. `ready-to-show` is the *last* of these phases: no
window exists until `createWindow`, and it is `show: false` until `ready-to-show`, so every
millisecond in the table has already elapsed before anything an arrival animation drew could be
seen. Boot is not work a fly-in can cover. **"This covers no work" was right**; what was wrong is
that its numbers had no source.

If anything justifies the fly-in on covering-work grounds it is renderer-side — `loadFile`, the
IPC round trip, the workspace data, the floors. `boot-time.mjs` measures none of that and should
not be cited about it.

Cold is not measured and not claimed: evicting the OS file cache needs a password this script does
not have, and calling the first of N runs "cold" would be the same move this correction exists to
undo. `min` is not quoted either — it is an extreme-value statistic over 7 runs, and the #231
review found the first version's min column did not reproduce across 21 runs of its own.

**VERIFY** — a fresh clone opens onto a building site; a workspace with five projects opens onto
five floors of lit windows that match what is actually running.

**Proposed 2026-09-17: withdraw V4 (D18, open).** V4 was explored and argued before anything was
built. Five sketchers worked blind and produced fifteen sketches, and a critic scored and
clustered them. The opening draft was published as a page shared with the team, and a plan
reviewer argued with it over three rounds, recorded below. Where it ended:

- **What a first launch can honestly show.** At a first launch nothing is running (read:
  `running` comes from this process's sessions, `main.ts:656`, and leftover processes are stopped
  at boot, `:3349`). So "floors of lit windows that match what is running" passes by default.
  Since D14 there is no building to arrive at. The fresh-clone half is already served: an
  untrusted clone opens on the first-run panel, whose "No projects yet" step starts a project
  (read: `first-run.ts:157`, `:388–409`).
- **The one first view that can be chosen honestly serves a narrow group.** Opening on the campus
  when there is nothing to return to fires only for a trusted workspace with at least one project,
  no warnings and no conversation listed (round 2, finding 7). The README's clone, the DMG install
  and every returning user are not in that group. It could only ever show every office idle, so it
  cannot be what V4 means by "floors of lit windows that match what is actually running".
- **The proposal.** Withdraw V4 as a "Done looks like" item: D18, open, for Vish to decide. If he
  agrees, the §8 line becomes `- [-] V4 The arrival — withdrawn, D18: …`, with no command. Until
  then §8 keeps its current line.
- **What is kept, as queued tasks rather than a V4 tick:**
  - *Nothing to return to opens the campus* (TASKS.md row 50), on four conditions from round 2:
    - it fires when `diagnose()` returns nothing and no conversation is listed;
    - its wording says "the first-run panel opens" and "leaves the view where the person put it",
      and never "the registry was read";
    - skipped registry rows reach the snapshot first;
    - the decision sits in the synchronous part of `render`, right after `renderSwitcher()`,
      behind a module-level flag.
    Its test covers the decision, and its PR declares the wiring untested.
  - *Skipped registry rows reach the snapshot* (row 51). `openRegistry` drops `skipped`
    (`main.ts:3039–3041`), and only search reports it, so a registry whose rows all failed to
    parse reads as an empty history. That is standing order 4.
- **Found on the way, and fixed in #267:** once campus cards show their own conversation, the open
  floor is also the focused card's picture. Ambient breaks made it the one card whose people moved,
  which reads as work, so the campus now takes no breaks. Separately, work now restarts the idle
  clock even while `ambient` is not called.
- **Questions.**
  - For the vision's author: was the arrival for someone opening the app, or for the pitch? If
    for the pitch, a capture of the real campus, labelled as a recording, goes on the release
    page after the AppImage exists.
  - For Vish: D18; whether row 50 is wanted at all; whether `scripts/boot-time.mjs` stays as a
    general startup check (its header says it exists for V4).

**Options considered** (the critic's clusters; D·B·F is how different, how buildable here, and how
well it fits what V4 is for, 1–5 each):

- *Open on the campus, nothing moves* (frontend C, reviewer 1, scope B; best 2·5·4). Survived as
  S1, and after the rounds it is row 50 rather than V4.
- *Withdraw V4* (scope A; 5·5·3). Survived, and is the proposal.
- *Rejected:* an animated reveal over the campus (frontend A, tester A, reviewer 2). Its timed
  beats match no event and cover no loading, and they put the card pictures in the spotlight.
- *Rejected:* beats that wait for events (tester B). That is a loading screen for loading that has
  already finished, resting on renderer timing nobody has measured.
- *Rejected:* flying to the office that needs you (tester C). That is V3's ranking behind a camera.
- *Rejected:* an exterior or site plan (frontend B, reviewer 3). It is the second drawing mode D14
  and `campus.ts` gave up, with nothing to light at a first launch.
- *Rejected:* an empty-lot or "next office goes here" card (scope B, frontend C's slot). Projects
  sort by name (`projects.ts:108`), so a new project does not land in that slot, and a card with no
  project behind it needs special cases in `cardAt`, `fitCampus` and V3's list.
- *Rejected:* the release page as V4 (scope C). It is a pitch asset, not an outcome in the app, and
  `look.mjs` captures no images.
- *Rejected first-run signals:*
  - "the registry was missing at boot" (data A), which goes stale while the app runs;
  - a receipt file (data B), which is a permanent format plus a write at upgrade;
  - localStorage keyed by path (data C), which is wrong after a re-clone or a move and keeps paths
    outside `STORES`;
  - `why: 'seeded'`, which only packaged builds set.
- *Rejected:* the roll call (data C). That is data for V3, not V4.
- *Not adopted:* round 9's unapproved rewording of V4's check (`8fa90be`, marked "PLAN APPROVED:
  NO").
- **Traps**, each seductive for the reason given:
  - lights driven by `staff` (its comment says it drives the lights, and it is the same on every
    card);
  - "running" at a first launch (V4 names it, and it is always false);
  - a timer-driven beat (a fly-in seems to need durations, but nothing is left to cover);
  - "your next office goes here" (a one-line layout assertion, false because projects sort by
    name — row 48);
  - deciding from the placeholder list shown before the first snapshot (`app.ts:1001`);
  - pointing V4's check at `test/first-run.test.ts`, which already passes.

#### claude (review session) · opening draft

Published 2026-09-17 as the page described above. It recommended S1 as V4: a workspace's first launch
opens on the campus, with nothing moving, and "first run" means the session registry was missing at
boot. S2, withdrawing V4, was the fallback if the arrival was for the pitch. The draft named its own
strongest objection: S1 almost never fires.

#### Teammate (plan reviewer) · round 1

Verbatim, apart from a trailing list of files to read, left out, and a collaborator's name
and a quotation of his words redacted before publication.

> Read at `origin/dev` e6fe5cb and #267 (dcda528). Paths are relative to the repository root, and I ran only read-only commands.
>
> **1. S1 is called "first launch", but it never fires on a first launch.**
>
> *Read:* a clone has no projects (`.gitignore`: `projects/**`), and a packaged seed copies only `.claude` and `projects/_TEMPLATE` (`workspace-root.ts:128`). `missing` meets at least one project in these cases:
> - **(a) A project was made in the app and nobody spoke.** `createProject` (`main.ts:2582–2591`) and `openSession(null)` (`app.ts:1124–1138`) write no registry, so S1 fires on the *second* launch. This is probably its most common path (inferred).
> - **(b) Projects were copied in by hand**, as `CLAUDE.md` says, or made from a terminal `claude`.
> - **(c) A re-clone or move** brought `projects/` but not `.office-space/`.
> - **(d) `OFFICE_WORKSPACE` names any repo with a `projects/` folder** (`workspace-root.ts:91`). Every non-dot subdirectory except `_TEMPLATE` becomes a project (`projects.ts:108–128`).
> - **(e) The privacy panel's Delete removed `sessions.json`** (`privacy.ts:306–307`).
> - **(f) `look.mjs --state working`** (`:316–358`).
>
> The critic's "second laptop" example produces nothing: git carries neither directory, and a file sync carries both.
>
> *Change:*
> - Name the behaviour for what actually fires it.
> - Ask Vish whether (a) and (e) should fire it.
> - Say what `look.mjs` does. Don't add an `OFFICE_HEADLESS` gate, which would hide S1 from it.
>
> **2. Turns are not the only thing that writes the registry.**
>
> *Holds (read):* `openRegistry` (`main.ts:3333`) runs before `createWindow` (`:3438`).
>
> *But* two other actions write the registry:
> - **A mode change**, with no turn (`:1705`; `session.ts:307–311`).
> - **Closing the conversation nobody spoke in.** This writes an `opened:false` row (`main.ts:2624–2663`).
>
> So an `ok` registry can list no conversations. It may hold only such rows, have every row skipped (`registry.ts:164`), or carry another workspace's `cwd`. And `.office-space/` exists from the first boot on: `approvals/` is created there (`approvals.ts:424`), and so is `shipped.json` whenever the root isn't the template (`main.ts:946,979`).
>
> *Change:*
> - D19 should say "until the registry file is first written: a turn, a mode change or a close".
> - An `ok` registry counts as recorded, whatever it lists.
> - Name the stored-at-boot field for what it measured, e.g. `registryAtLaunch`. `history: 'none'` stays stored after the first turn makes it false, and a window re-created from the Dock (`main.ts:3477`) or a reload still reads it.
>
> **3. The fresh-clone clause is false for a trusted clone.**
>
> *Read:*
> - `no-projects` is `empty` (`first-run.ts:389`). A diagnosis where every step is `empty` returns `'leave'` (`:480`), so the panel stays closed.
> - The panel opens only while a warning also holds. For a fresh clone that is the untrusted warning (`main.ts:3183`), and trust is looked up for that exact root only (`trust.ts:86`).
> - A clone where `claude` was run first, or any launch after the person follows the panel's own advice (`first-run.ts:164`), opens on the plain office with "getting started" in the status bar (`:496`).
> - Path (a) stays untrusted unless the person ran `claude` in the workspace, because `--print` records no trust (inferred). So the panel reopens on every launch (`app.ts:2251`), on top of the campus.
>
> *Change:* reword the clause. Define "blocking" as either `isBlocked` or verdict `'open'`, and test that choice.
>
> *Agree:* the campus hides nothing in the chat column. The transcript, strip and notices are DOM elements (`app.ts:867–869, 1691`).
>
> **4. "Moves: nothing by itself" is false where the call is placed.**
>
> *Read:* `floor.start()` runs in `render` (`app.ts:890`), and `showFirstRun` is the last link of the startup chain (`:4072`). So the office is drawn while `openCurrent`, `loadControls`, `loadCommands` and `refreshUnfinished` resolve, and then the view jumps to the campus. Nobody has timed that gap, and any input cancels the jump. That is the same unmeasured-timing objection the critic used to reject tester B.
>
> *Change:*
> - Decide once, in the first `render`, before `floor.start()`, using the diagnosis `render` already computes at `:835`.
> - V3's band must follow `showCampus`, not the toggle's click listener (`:3409`), and S1 must call `showCampus`, never `floor.setView`.
> - With #267, that first view paints a `quiet:<id>` picture on every project card, because `lastSession` is still empty (`pictureOf`). That makes N staffed, idle rooms that differ only in name and hue (inferred). That is honest, but put it to the vision's author when asking whether this is the floors working.
>
> **5. The test.**
> - **Nothing checks `recorded → office`.** The mutation `history !== 'unreadable'` would open every returning user on the campus, and it survives assertions 1–4. Make assertion 2 a table of all three states, and name both mutations.
> - **Assertion 5's fixture misses the real case.** A fixture with no `.office-space/` also passes an implementation that just checks `existsSync('.office-space')`, and that implementation is wrong from the second boot on. Add:
>   - `approvals/` and `shipped.json`, with no `sessions.json`: expect `missing`;
>   - a registry holding only `opened:false` rows, and one holding `{"sessions":[]}`: expect present.
> - **"Bytes unchanged" cannot fail**, because `loadRegistry` only reads (`registry.ts:372–386`).
> - **Two assertions already pass on `dev`:** the second half of assertion 3, and assertion 6 (`first-run.ts:387–408`; `campus.ts:113–150, 383–398`). Assertion 6 also needs the sixth `campusFrom` argument that #267 adds.
> - **No test reaches the wiring:** main's stored boot state, `toSnapshot`, or `app.ts`. Tests read `app.ts` only as text (`escape.test.ts:25`).
>
> **6. The §8 line.**
>
> It is one command and one file.
>
> *Read, not run:* in Node 22.16.0, the test runner's built-in `createTestFileList` treats missing files two ways:
> - **Nothing matches, and no path is a glob:** it prints "Could not find" and exits with `kGenericUserError`, not 0.
> - **At least one path matches:** it silently drops the missing ones, which is what §4b measured.
>
> tsx 4.23.12 adds no `--test` handling of its own. So the line fails while the file is missing.
>
> *But* it passes as soon as `firstView()` exists, even with nothing wired to it. And two of its three clauses already describe `dev`.
>
> *Change:* have the line claim only the decision. For the PR's evidence, add a `look.mjs` state that reads `#stage[data-view]`.
>
> **7. What the draft leaves out.**
> - **A first-run signal that needs no new field.** Show the campus when no project lists any conversation (`rowFor`, `main.ts:644–657`) and there is no registry problem, checked with V3's planned `registryPath` that imports no `node:` modules.
>   - It adds no lines to `main.ts` and no new IPC field, and it is recomputed when the Dock re-creates the window.
>   - The critic's objection to it ("fires once all are closed") applies to `missing` too, through (a) and (e). Weigh the two in D19.
> - **D18 and D19 should enter DECISIONS.md as `open`.**
> - **`switchTo` never leaves the campus** (`app.ts:1234–1271`), and S1 puts people on the campus without their asking.
>
> **S1 as drafted: accept with changes.** It is the smallest V4 line that can fail, but only once it is renamed for what triggers it, decided before the first frame, tested on all three registry states, and worded to claim only what its file checks. If Vish wants it to fire for neither (a) nor (e), S1 has nobody left to serve, so take S2.

#### claude (review session) · reply to round 1

1. **Accepted.** S1 is renamed for what fires it: *a workspace with nothing to return to opens on
   the campus*. The paths round 1 lists are the real ones. Path (b) — projects copied from
   `_TEMPLATE` by hand, which the repository's `CLAUDE.md` tells a new user to do — is the one
   worth serving, because it is the documented way in. Vish is asked whether (a) and (e) should
   fire it; under the signal in 2, they do.
2. **Accepted, and it changes the signal.** "The registry was missing at boot" is dropped: it goes
   stale inside the process and needs a stored field. D19 now reads: *the first view is decided
   from the first snapshot — when no office lists a conversation (`ProjectInfo.conversations`,
   filled by `rowFor`, `main.ts:644–657`) and the registry is not reported unreadable, there is
   nothing to return to.* That needs no new IPC field and no lines in `main.ts`, and a window the
   Dock re-creates decides again, with live conversations counted. Closed and never-opened rows
   do not count, which is what "nothing to return to" means; round 1's objection that it fires
   once every conversation is closed is accepted as the behaviour, since such a workspace has
   nowhere to put you back.
3. **Accepted.** The fresh-clone clause leaves the §8 line: a workspace with one office is not
   S1's business. Blocking means `isBlocked` or a first-run verdict of `'open'`, and the test says
   so.
4. **Accepted.** The choice is made once, in the first `render`, before `floor.start()`, from the
   diagnosis `render` already computes. S1 calls `showCampus(true)`, never `floor.setView`, and
   V3's band follows `showCampus`. #267's quiet pictures go to the vision's author with
   that question.
5. **Accepted, all of it.** A three-state table with both mutations named. Fixtures for the new
   signal: every count 0; one conversation in one project; every count 0 with a registry problem.
   "Bytes unchanged" is dropped, and so are the assertions that already pass on `dev`. The wiring
   is declared unreachable by tests and covered by PR evidence (6).
6. **Accepted.** The §8 line claims only the decision. The PR adds a `look.mjs` state that reads
   `#stage[data-view]` on a workspace with two projects and no history, as evidence rather than as
   the VERIFY.
7. **Adopted as the signal** (see 2). D18 and D19 go into `DECISIONS.md` as `open`. `switchTo`
   staying on the campus becomes a question for Vish: once the app can open on the campus unasked,
   should picking a project in the switcher take you into its office?

Revised §8 line:

    - [ ] V4 The arrival: with nothing to return to — no office lists a conversation and the
      registry was read — a workspace with more than one office opens on the campus, and
      otherwise on the office; a blocked office, or input before the choice, keeps it on the
      office — `npx tsx --test test/nothing-to-return-to-opens-the-campus.test.ts`

#### Teammate (plan reviewer) · round 2

Verbatim, apart from a trailing list of files to read, left out, and a collaborator's name
replaced by a role before publication.

> Read at `origin/dev` e6fe5cb, with #267 at dcda528. Paths are relative to the repo root, and I ran only read-only commands.
>
> **1. `conversations` counts what the switcher lists, not the history.** *Read:* `rowFor` counts `sessionListOf` (`main.ts:648–650`), which is `shownSessions` (`:1308`). That is every recorded row that is `opened`, not `closed`, in that project, with `cwd === WORKSPACE_ROOT` compared as a string (`registry.ts:282`), plus the live conversation from `current` (`registry.ts:329–332`; `main.ts:1376–1379`).
> - **The office's live conversation:** not there yet. Only `openSession` fills `current` (`main.ts:1236`), and the renderer asks for it after `render` (`app.ts:4059`). `watchSessions` only listens (`app.ts:1103–1110`).
> - **Closed or `opened:false` rows:** not counted.
> - **Rows from another workspace:** not counted. `cwd` holds the raw `OFFICE_WORKSPACE` string (`workspace-root.ts:91`; `main.ts:1406`), so a trailing slash or a symlinked spelling makes real history count as zero.
> - **Rows for missing project directories:** not counted. Only discovered projects get a row (`main.ts:660–673`), and `.archived` is filtered out with the dot-directories (`projects.ts:108`).
> - **Real history that still counts zero:** a moved workspace; history only in archived or renamed projects; and a registry whose every row was skipped as unreadable. That last one reads as `ok` with `skipped > 0`. `openRegistry` drops `skipped` (`main.ts:3039–3041`), and only search reports it (`search.ts:175–179`). The snapshot carries no problem, which breaks standing order 4.
>
> *Change:* use the wording "no conversation listed" (V3's Q13a wording), not "nothing to return to". Put the skipped-row count on the snapshot before S1 ships. I've flagged that as a separate task.
>
> **2. The placement holds; here is the exact spot.** *Read:* `render` runs synchronously from `app.ts:771` until its first `await` (`:884–885` when the active project is gone, otherwise `:889`).
> - Decide right after `renderSwitcher()` (`:875`), behind a module-level flag set in that same block. The first `render` to start wins, whether it came from `describe` (`:4056–4058`) or a push (`:3943–3944`).
> - In a fresh process, a push can only arrive first if a watched file changes (`workspace.ts:741–791`), and it carries the same counts.
> - Never decide inside `renderSwitcher`. Subscribing to approvals calls `approvalsResend` (`preload.ts:100–102`; `approvals.ts:469–472`), which runs `renderSwitcher` on the placeholder list (`app.ts:1001–1003`, `:3878–3893`) before any snapshot exists.
>
> *Agree:* nothing is painted before that point. `FrameGate` starts unparked (`frame-gate.ts:21, 46–51`), so `invalidate()` cannot start the loop early; `fit()` only sizes the canvas (`floor-view.ts:1083–1153`); and apart from `invalidate`, `start()` has one caller (`app.ts:890`).
>
> **3. The registry clause is redundant, and the renderer can't match it today.** *Read:*
> - The problem is `unreadable-file` at `registryPath(root)` (`main.ts:3045–3049, 778`). `registryPath` imports `node:path` (`registry.ts:28, 345–347`), so the renderer can't use it, and V3's version without `node:` imports isn't built yet.
> - A write failure produces the same kind and path (`main.ts:1433–1439`), so the renderer can't tell the two apart.
> - A registry that is a directory, has mode 000, or holds bad JSON reads as `unreadable` (`registry.ts:379–384`). That becomes a warning step (`app.ts:2226–2228`; `first-run.ts:170–182`), and the verdict is `'open'`.
> - Once a project exists there is no `empty` step: `first-run.ts:389` is the only one. So S1 fires exactly when `diagnose()` returns nothing.
>
> *Change:* state the condition that way, and drop both the clause and the dependency on V3.
>
> **4. A Dock re-creation or reload opens on the office, through a rule the reply says doesn't apply.** *Read:* the previous window's `openCurrent` left the office's conversation in `current`. It is listed even though it was never recorded (`registry.ts:329–332`), so `conversations` is 1. Nothing in `src/` sets a menu, so Electron's default Reload is available (inferred). Live conversations that were never opened do count, and the plan should say so.
>
> **5. The chat column and the campus agree; motion doesn't.** *Read:*
> - `active` starts as `''` (`app.ts:259`), so the office card is `focused` (`campus.ts:396`) and the chat opens the office's conversation.
> - Every card starts with a `quiet:` picture (#267's `pictureOf`). After `openCurrent`, `lastSession` (`app.ts:1145`) gives the office card its conversation's picture.
> - `ambient()` animates `this.scene` without checking for the campus (`floor-view.ts:790–792, 961–968`). So the office card is the only one whose people move (inferred), and on a campus, movement reads as work.
>
> **6. The §8 line still claims more than its file checks.**
> - **"opens on the campus":** this is wiring no test runs; tests only read `app.ts` as text (`escape.test.ts:25`). Declare it in the PR, as V3 did.
> - **"the registry was read":** false for skipped rows and for write failures.
> - **"a blocked office":** the rule also gives way to warnings, which `first-run.ts:38–44` doesn't call blocked. Say "the first-run panel opens".
> - **"input … keeps it on the office":** false after someone presses *all offices* (`app.ts:3409`). Say "leaves the view where the person put it".
> - Nothing in the line already passes on `dev`.
>
> **7. Who S1 serves.** It fires only for a trusted workspace with no warnings, at least one project, and nothing listed. The shipped settings carry an allow list, so a clone where `claude` was never run gets the untrusted warning (`main.ts:3156–3191`).
> - **Served:** people who used `claude` in the terminal first and trusted the folder there; people who closed every conversation or deleted the session list.
> - **Not served:**
>   - the fresh clone from the README and the DMG install, which have no projects;
>   - people who copied projects by hand and never ran `claude`, which is the reply's chosen path (b);
>   - every returning user;
>   - the vision's author. With nothing listed, `running` is false everywhere (`main.ts:656`), so S1's campus always shows every office idle.
>
> V4's VERIFY asks for a building site and lit floors, and S1 now meets neither, so S2 is no worse.
>
> **S1 as revised: reject as V4.** Take S2 (D18: withdrawn). I would sign S1 as its own task rather than a V4 tick once four things are true:
> - its condition is "`diagnose()` returns nothing and no conversation is listed";
> - its wording is fixed as in finding 6;
> - skipped registry rows reach the snapshot;
> - the decision sits in the synchronous part of `render`, behind a flag.

#### claude (review session) · reply to round 2

Accepted, and the plan changes shape.

1. **V4 is proposed for withdrawal: D18, open, for Vish.** The line asks for a building site and
   floors of lit windows. Since D14 there is no building, and at a first launch nothing is running
   (`main.ts:656`). The one first view that can honestly be chosen automatically serves a narrow
   group (round 2, finding 7). The fresh-clone half is already served by the first-run panel.
   §8 keeps its current line until Vish answers. If he agrees, it becomes
   `- [-] V4 The arrival — withdrawn, D18: …` with no command.
2. **S1 survives as a queued task, not as V4,** on round 2's four conditions:
   - It fires when "`diagnose()` returns nothing and no conversation is listed".
   - Its wording drops "the registry was read", and says "the first-run panel opens" and "leaves
     the view where the person put it".
   - Skipped registry rows reach the snapshot before it ships.
   - The decision sits in the synchronous part of `render`, right after `renderSwitcher()` and
     behind a module-level flag, and never inside `renderSwitcher`.

   Its test covers the decision, and its PR declares the wiring untested.
3. **New task: skipped registry rows reach the snapshot.** `openRegistry` drops `skipped`
   (`main.ts:3039–3041`), and only search reports it. That breaks standing order 4.
4. **#267 changes.** `ambient()` animates the open floor even while the campus is up (read:
   `floor-view.ts:792`, `:961`). Since #267, the focused card is a picture of that floor, so its
   people are the only ones that move. Ambient drift will pause while the campus is up, as the
   loop's own comment already intends ("an idle floor you are not looking at has nothing to
   depict to anyone").
5. **The open question to the vision's author stands.** If the arrival was for the pitch, a
   capture labelled as a recording goes on the release page after the AppImage.
6. **`scripts/boot-time.mjs` stays** as a general startup check. Its header's reference to V4 is
   corrected once D18 is decided.

#### Teammate (plan reviewer) · round 3

Verbatim, apart from a trailing list of files to read, left out, and a collaborator's name
replaced by a role before publication.

> At `origin/dev` e6fe5cb: two new objections, both about pausing ambient drift on the campus.
>
> **1. Pausing `ambient()` on its own turns the break timer into a polling loop.** *Read:*
> - When the loop parks on the campus it still calls `armBreak()` (`floor-view.ts:802`), which sleeps for `msUntilNextBreak` (`choreography.ts:611–626`). Only `ambient()` changes that function's inputs (`:629, :648–673`).
> - So while ambient is paused, `armBreak()` re-arms the same wait (`floor-view.ts:846`) until the campus closes, with a 1 ms floor (`:847`).
> - If someone is one 250 ms frame (`:787`) short of their break threshold, the timer wakes every few milliseconds (inferred).
> - `test/the-office-drifts.dom.test.ts` never opens the campus, so it would not catch this.
>
> *Change:* `armBreak()` should return early while `this.campus` is true. `setView('office')` calls `invalidate()` (`:470`), which re-arms the timer. Add a drift test: park on the campus, advance 200 s, and expect no frame and no pending timer.
>
> **2. A break already under way still plays out.** *Read:* the walk back to the desk is part of the break routine (`choreography.ts:692–698`). `step()` runs every scene's routines and marks cards stale as people move (`floor-view.ts:997–1063`).
>
> **3. Work done while ambient is paused does not reset the idle clock.** *Read:*
> - `idleFor` is reset only inside `ambient()` (`choreography.ts:648, 658, 672`), not on the facts that mark someone busy (`:372, :468, :512, :712`).
> - So someone who worked while the campus was up can go on a break right after it closes. That contradicts the rule that a break is earned only by continuous idleness (`:655–656`).
> - Switching conversations already has this gap (`floor-view.ts:961–962`).
>
> *Change:* reset the idle clock on those facts, or state the gap in #267.
>
> **4. The comment cited as the reason doesn't fit.** The comment at `floor-view.ts:790–791` is about floors nobody is watching, but since #267 the focused card shows that floor. The real reason to pause is that one moving card reads as work.
>
> **5. D18 is missing these rejected alternatives:**
> - The empty-lot or "next office" card. Projects sort by name (`projects.ts:108`), so a new project doesn't land in that slot.
> - "Registry missing at boot" as the first-run signal. It goes stale while the app runs.
> - `why: 'seeded'` as the signal. Only packaged builds set it.
> - Event-gated beats, and flying to the office that needs you, each with its own reason.
> - The roll call. That is V3's data.
> - Round 9's unapproved rewording of V4's check (`8fa90be`).
>
> D18 also needs a *Revisit if*: an agent above the projects is hired, the vision's author says the arrival is a product feature, or a launch can show something running.
>
> Signed once 1 is taken and 3 is fixed or stated, as a proposal for Vish: withdraw V4 (D18); S1 as a queued task on the four conditions.

#### claude (review session) · reply to round 3

1. **Taken.** `armBreak()` returns early while the campus is up (#267, `be0db19`). A new test parks
   the floor on the campus, advances past the longest break threshold, and sees no frame; without
   the guard it fails with *"the campus woke itself up for a coffee break"*. The frame loop's own
   guard is pinned by the same test.
2. **Stated.** A break already under way plays out. #267's description says so.
3. **Fixed rather than stated.** `Choreographer.markBusy` zeroes the idle clock on every fact that
   marks someone busy (#267, `be0db19`). A new test measures builder's own threshold, stops 2 s
   short, runs a piece of work to its end with no `ambient` call, and fails without the reset.
   This also closes the older off-screen gap the round names.
4. **Taken.** The loop's comment now gives the campus reason, one moving card reads as work,
   beside the old one.
5. **Taken.** D18's rejected alternatives and its *Revisit if* are written as round 3 lists them.

Round 3's conditions are met, so its signature stands. No fourth round was run: nothing in round 3
is left open.

**Not frozen.** The reviewer signed round 3 as a proposal for Vish, and its conditions are met.
Vish holds the veto. The freeze line goes here once D18 is decided and the vision's author
has answered; until then row 50 is not started.

**A number used twice, noted on 2026-09-17.** The reply to round 1 above says D18 and D19 go into
`DECISIONS.md`. D18 did. The first-view rule that reply calls D19 has no entry there, and
`DECISIONS.md`'s D19 is a different decision (#254 merges first). The first-view rule is TASKS.md
row 50.

---

## 4c. Jev on trial — one day of evidence, not an integration — opened 2026-09-24

**What it is.** Jev (`typesafe/jev-1.13`, thejevai.com) is a hosted "System One" model: POST
application state plus typed questions — choice, score, or noul (a yes/no with a probability) —
and typed answers come back with probabilities and confidence, no prose. The performance figures
are the vendor's, repeated here not measured: 70–500ms a call, up to 400x cheaper than an LLM on
classification. In early access since 2026-09-15, which is nine days before this section was
written — a fact that argues for buying one day of evidence and nothing else yet.

**Where it might earn a place.** Two spots in this app make semantic judgments with regex today,
and both fail toward the failure CLAUDE.md already names:

1. **VERIFY-cell linting** (`src/shared/tasks.ts`). The parser takes the first backticked span;
   rule 2's named failure — a verdict written where a command belongs, *"PASS — I checked"* —
   passes through it unremarked, and the session log for 2026-08-19 records finding exactly that
   in a real TASKS.md. A three-way choice question (runnable command / verdict-in-disguise /
   honest uncheckable prose) at authoring time, advisory only, nothing waits on it.
2. **Mishap classification** (`src/shared/mishap.ts`). `describeMishap` knows two specific
   shapes and falls through to the generic sentence. Classifying an unknown error into an
   existing apology is low-stakes, off the control path, and fails safe to the sentence it
   falls to today.

**Considered and set aside**, with the reasons on the record (ranking from the privacy
teammate's review, 2026-09-24, and adopted):

- **Risk-scoring held tool calls.** It sends the user's own commands and paths off the machine —
  the thing the privacy panel's `lastPrompt` field exists because people under-account for — and
  it puts a network round trip inside the one control that holds tool calls. If it ever comes
  back: a score shown beside the call, never ordering or pre-selecting it, and the gate must
  decide identically with the network off.
- **Stall detection on the floor.** Rule 3 kills it, not latency. Liveness is a fact
  `src/main/orphans.ts` answers from a pid and its start time; a remote probability drawn as
  "stalled" would be a claim on screen with no event behind it.

**The egress contract.** A hosted call is not a dependency question, it is an egress question,
and the repo already has the contract (`test/privacy.test.ts`, extended by PR #255): the module
takes a gated fetch as a required parameter with no default; it is named in
`MAY_REACH_THE_NETWORK` and declares its hosts; it gets a row in the privacy panel; off is a
supported, tested state; and **no shipped key** — a user brings their own, stored where the
Spotify credential lives, because a shipped key is a shared identity. Nothing Jev-shaped lands
in `src/` without all five, and Phase 0 lands nothing in `src/` at all.

**Phase 0 — the eval.** `scratch/jev-eval/` (gitignored, like `scratch/make-theme.ts` before
it) holds a labelled set of real VERIFY cells and real mishap strings, a dumb baseline — the
regexes we already have, plus "contains backticks" and "first word is a known command" — and a
runner that puts the same set to Jev, model version pinned, key read from `JEV_API_KEY` and
never written anywhere. Real latency and the rate limit are measured from this machine, because
the vendor's page does not state them. **The gate cuts both ways: if the dumb baseline gets most
of it, the egress is not worth buying and D24 closes as no.** Numbers land in the session log
either way.

Phases beyond 0 — a shadow-mode client, then advisory UI — are deliberately not planned here
until Phase 0 reports. See D24.

*D24 was D15 when #275 merged, and #275's and #276's commit messages still say D15.* It became
D24 when DECISIONS.md reached `dev`, because that file's D15 — the local checks — was numbered a
week earlier and is cited throughout it. The decision itself is in DECISIONS.md with the others.

**Phase 0 result — 2026-09-24, measured.** Two full runs through Vercel AI Gateway's
TypeSafe-compatible API (`typesafe-ai/jev`, the only id the gateway accepts, so **unpinned** —
vercel/ai #21213). 85 VERIFY cells (74 real, from 62 TASKS.md files; 12 synthetic verdicts
written by the evaluator, 1 real) and 12 mishap strings.

| Judge | VERIFY accuracy | Verdicts caught | False verdict flags | Mishaps |
|---|---|---|---|---|
| repo today (backticks = command) | 71/85 | 0/13 | 0 | 10/12 |
| dumb-plus (verdict word first, known runner) | 82/85 | 10/13 — real 1/1 | 0 | — |
| Jev, top choice, run 1 / run 2 | 79/85 / 79/85 | 13/13 — real 1/1 | 6 / 6 | 12/12 |
| Jev, verdict only at confidence ≥ 0.6 (run 2) | — | 13/13 — real 1/1 | 1 | — |

Latency p50 234–237ms, p95 361–402ms from this machine, through the gateway. 8 and 6 of 97
calls were throttled (429, "upstream high demand") and succeeded on retry. Metered cost $0 — a
promotion ending 2026-09-25, not a price.

**What that says.** Jev's whole margin over fifteen minutes of regex is three verdicts that were
*written by the person running the eval*; on the one real verdict every judge but the current
code agrees. The 0.6 threshold was picked on the same data it is scored on. Between the two
runs, with nothing changed on our side, the misses moved — `npm test` exits 0 was called a
verdict in the first run and a command in the second, and the confidences shifted — so a lint
built on it would flag a cell one day and not the next, which on a column whose purpose is
settling things is its own small lie on screen. The mishap wins are on the two rows written to
be regex misses. **By the gate above, D24 closes as no.**

**What Phase 0 did buy.** dumb-plus is a zero-egress improvement over what ships: verdict
recall 0/13 → 10/13 with no false flags, and it catches the real one. That lint is worth
building on its own merits, without any network at all — and it was: `isVerdict()` in
`src/shared/tasks.ts`, named on the task panel's row and summary, merged as #276 on 2026-09-24.

**Reopen D24 only if** a real corpus — not written by the evaluator — shows verdicts dumb-plus
misses, **and** the model can be pinned on the doorway we would ship through.

---

## 5. Decisions

| # | Decision | Status |
|---|---|---|
| **D1** | Own the runtime or use the user's? | ✅ **Spawn the user's `claude`.** Reversed 2026-08-19; see §2 |
| **D2** | Transport | ✅ `--output-format stream-json --verbose`, parsed across chunk boundaries |
| **D3** | Auth | ✅ The user's existing subscription login. No key, no separate billing. Proven live |
| **D4** | Session grouping under a project | ✅ Ours to build. We generate the session id up front and `--resume` it |
| **D5** | Frontend stack | ✅ **Electron + Canvas 2D.** No React, no Pixi — a dozen sprites do not need a scene graph, and a clone-and-run app should not need a bundler for its renderer |
| **D6** | The shipped roster | ✅ manager, reviewer, builder, tester, frontend, backend, memory-keeper |
| **D7** | Art | ✅ **Drawn in code, shipped by default.** A licensed pack is an optional, gitignored upgrade — every commercial pack we reviewed forbids redistribution |
| **D8** | Repo | ✅ `slug-labz/office-space`, private |
| **D12** | Which repository is the office pointed at? | ✅ **None, ever.** Decided 2026-08-19. Office Space is a general-purpose tool, not a workspace built around one product. There is no canonical clone at the workspace level and no default org. **A repo is bound per project, by the user, and binding is optional** — a project with no repo is a valid project. Two projects may point at two entirely different repositories. See §5a |
| **D13** | The base branch a project's work targets | ✅ **Per project, not global.** Follows from D12: if projects can name any repo, the office cannot know that repo's integration branch. Prefer `dev` where it exists, otherwise the repository's own default. Never assume, never hard-code |
| **D9** | Is the event log the system of record? | ⬜ Open — see §4.5 |
| **D10** | Relationship to a collaborator's own project | ⬜ Open — Khalid's call |
| **D11** | Wispr Flow | ✅ **Input needs no integration** (system-wide dictation types into the focused field; our job is to not break it). **Output cannot be Wispr Flow** — it is dictation-only. OS speech synthesis instead. See [docs/voice.md](docs/voice.md) |
| **D14** | Is there an agent above the projects? | ✅ **No workspace orchestrator.** Decided 2026-09-09 by Vish. So V3's lobby is not built and the campus stays; *"the lobby answers what should I work on"* is met by a ranked list instead. See §5b |

This table stops at D14. D15 onward are in [DECISIONS.md](DECISIONS.md), which is append-only,
with the alternatives each decision beat.

---

### 5a. Why the office is pointed at nothing — 2026-08-19

The reference workspace we studied is a **meta-workspace for one product**: a canonical clone at
`_repo/<repo>/`, every feature a worktree cut from it, `dev` hard-coded as the base, and the
whole `.claude/` directory written around that product's stack. It works, and it works because
it was built for exactly one thing.

Office Space is not that, and must not become it. It is the face of *a* Claude Code workspace —
whichever one you point it at, whatever you are building. So:

- **No `_repo/` singleton.** There is no canonical clone the workspace is organised around.
- **No default org, no default repository, no default branch.**
- **Repo binding lives on the project.** Each project may name a repository, or name none.
- **Different projects may point at different repositories.** The office is a place to work, not
  a checkout.

Two cases follow, and they need different mechanisms:

| Two projects on… | What they need |
|---|---|
| Two different repositories | Two directories. No worktree involved |
| One repository, two branches | A git worktree per project, cut explicitly off that repo's base |

A project bound to nothing is a first-class project — notes, plans and agents with no code
attached. That is the case a fresh clone starts in, and it must never feel like a broken setup.

**What this costs us.** Everything the office wants to say about git — branch, ahead/behind,
dirty files, PR state — becomes a per-project lookup against a repo that may not exist, rather
than one global fact. That is more code than a singleton and it is the correct trade: a
singleton would make Office Space somebody's private tool on the first day somebody else tried
to use it.

### 5b. Why there is no lobby — 2026-09-09

**The building's argument was architectural, not decorative, and that is why it fails.** §4b V3
put it plainly: *"the lobby is the workspace orchestrator's room and a floor is a project
orchestrator's; the metaphor and the agent architecture are the same shape."* That is a real
argument — a ranked list has rows and no room, so the moment an agent exists above the projects,
with its own conversation and transcript, a list has nowhere to put it and a lobby does.

It is conditional on an agent that does not exist. The roster is seven — manager, reviewer,
builder, tester, frontend, backend, memory-keeper — and every one is project-level. So the
metaphor is not the same shape as the architecture; it is **ahead** of it, and building the
lobby now means building a room for a tenant nobody has decided to hire. D14 decides not to.

**What is given up, stated rather than waved past.** A list answers *which one wants me*. A
stacked building answers *what is this workspace* — eleven projects, three never opened, one
idle a month. Spatial persistence carries that and a re-sort destroys it. That is a real loss
and it is accepted, because the question V3's own VERIFY asks is the first one.

**The ranking already exists.** `Attention = 'waiting' | 'busy' | 'idle'` in
`src/shared/floor/campus.ts`, with `attentionOf` ranking waiting over busy and citing the
activity strip for the order: *"what needs you comes first."* What is missing is the count and
the comparison. `CampusOffice.waiting` carries a real per-project number from `waitingByProject`
and is read in exactly one place — `attentionOf`, where it collapses to a boolean — so three
held calls and one draw an identical border. `strip-line.ts` already renders the same fact as a
sentence for a single project, so drawing it on a card is reuse rather than new work.

Two constraints on the replacement, both from decisions already argued on `dev`:

1. **It is a second surface, not a re-sorted campus.** `layOut` is index-stable on purpose:
   *"an office you learned the position of does not move when a new project is added beside it.
   Honeycomb was the other option in the vision and is deliberately not taken."* Sorting the grid
   by attention moves a card whenever its state changes — a held call arrives and it jumps to
   first, is answered and it jumps back — which is the property that module gave up the honeycomb
   to keep. A list has no learned positions, so it sorts freely. The grid does not sort.

2. **A row may not state a reason the app cannot support.** A grid can stay silent on idle —
   *"a mark on every card is a mark on none."* A list cannot; every row carries text, so every
   row has to have something true to say.

   **Correction, same day.** This constraint first cited `CampusOffice.busy` being true only for
   an office visited in this window's lifetime, and *"idle 2h"* as underivable. #229 closed the
   first 7 minutes 24 seconds after this section merged (#230 at 08:31:09Z, #229 at 08:38:33Z),
   and `lastActiveAt` on the snapshot makes the second derivable — so one illustration was stale
   on arrival and the other within minutes, and both are struck rather than quietly swapped. The
   constraint stands; what changed is that the ground under it improved.

   What still holds it up: `lastActiveAt` is `string | null`, and a row must say *not recorded*
   rather than print an age it does not have. Which is the same rule the campus already keeps for
   `waiting` and the decided panel keeps for an undated record — a silence is labelled, never
   rendered as a zero.

   The named instance to price in: **per-project task state does not exist cross-project.**
   `checkProject` has two call sites, both IPC handlers taking one project id, and `TaskReport`
   reaches the renderer only through `tasksOf(project)` / `verify(project, …)` — it is never on a
   pushed snapshot. A row showing VERIFY outcomes therefore needs a new main-side aggregate or N
   round trips; it cannot be derived. What *is* on every snapshot, and is enough to rank on:
   `lastActiveAt`, `running`, `conversations`, `missing[]`, plus held approvals carrying
   `project`, `askedAt` and `waitMs`.

**VERIFY**, replacing the word search: build a workspace where office B holds a call and office A
is merely busy; assert the list puts B first and says why. Then answer B and assert A and B have
**not** swapped position on the campus grid — the ranking test alone would silently break
constraint 1.

---

## 6. Reference material — study only

| Ref | Where | We take |
|---|---|---|
| **munder-difflin** | outside this repo, `research/` | Frontend inspiration only. MIT code |
| A collaborator's own project | outside this repo | The click-an-agent → plain-language status idea |
| A collaborator's own workspace | outside this repo | The backend shape: agents, skills, commands, hooks, projects |

The vision's author instructed on 2026-08-18 that neither repository is worked on: both are
kept to study and to reference. Neither is vendored here, and neither is in this repo.

⚠️ munder-difflin's pixel art is LimeZu, **non-commercial and non-redistributable**. Its code is
MIT. We ship neither.

---

## 7. Session log

- **2026-08-18** — Project created. Ten-way research sweep on munder-difflin, a collaborator's
  own project, and the field.
- **2026-08-18** — **Vision delivered by Khalid and locked** ([VISION.md](VISION.md)).
- **2026-08-18** — Auth research overturned D1. The Agent SDK is named in the policy that
  forbids exactly what the vision requires; we spawn the user's CLI instead. Proven live.
- **2026-08-18** — Workspace discovery, floor movement, procedural characters. Repo created.
- **2026-08-18** — CLI adapter and agent asides. `--fork-session` gives a read-only side channel
  that never pollutes the session it asks about.
- **2026-08-19** — Delegation choreography and the voice layer. The floor depicts real
  dispatches; a depiction may not outlive the fact it depicts.
- **2026-08-19** — Electron shell. The floor and the chat became one window, verified end to end
  against a scripted session.
- **2026-08-19** — This plan reconciled against the code. It had claimed the Agent SDK was the
  backend for a day after we decided it could not be.
- **2026-08-19** — Repo read end to end by a reviewer who had not written any of it. Three real
  bugs and five honesty gaps found and fixed; see §4a. Tests 109 → 176.
- **2026-08-19** — Speech bubbles on the floor. Click somebody and the answer appears over their
  head — and comes down the moment what it describes stops being true. Tests 176 → 191.
- **2026-08-19** — Finding `claude`. The app spawned a bare `claude`, which a GUI process on
  macOS cannot resolve — launched from the Dock it inherits `launchd`'s PATH and finds nothing.
  Invisible in development, because starting it from a shell inherits that shell's PATH. Found
  on this machine in a sharper form: `claude` sits under node v18 while nvm defaults to v22, so
  even a fresh terminal could not find it.
- **2026-08-19** — The VERIFY harness. `CLAUDE.md` had claimed since the first commit that the
  harness checks every task's VERIFY condition; there was no harness. Four outcomes, not two,
  and it runs unattended only what `.claude/settings.json` already permits. Pointed at this
  workspace's own `projects/random/TASKS.md` it immediately found an agent that had written
  "PASS — I checked" into the column that was supposed to hold the check.
- **2026-08-19** — Ran the app for real for the first time. Three bugs the browser harness
  cannot catch: `prompt()` is a no-op in Electron, a class selector beat `[hidden]` so every
  project's transcript painted at once, and a floor opened for the first time had no staff on it.
- **2026-08-19** — An allowlist so the office can run its own verification commands, and a
  warning when an untrusted workspace makes that allowlist moot — which it does on every fresh
  clone, silently, which is the worst way for it to be true.
- **2026-08-19** — Voice wired, off by default and free while off. Uncovered the bug worth more
  than the feature: a control inside a window drag region never receives its click.
- **2026-08-19** — What an employee actually did, read from their own record. Also: the office's
  own injected context no longer renders as though you typed it.
- **2026-08-19** — Project tabs. A tab per directory under `projects/`, each with its own
  session, transcript and floor, all running at once. A project you are not looking at keeps
  working and its tab says so. Tests 212 → 229.
- **2026-08-26** — Fifty-five feature PRs merged onto `dev`, one at a time, with four conflicts
  resolved by hand. What that taught is written up in
  [planning/MERGE-AND-HANDOVER.md](planning/MERGE-AND-HANDOVER.md) — chiefly that a merge
  conflict and a rebase conflict are not the same object, and that resolving a *test* file by
  taking one side is checked by nothing.
- **2026-08-27** — This plan reconciled against the code for the second time. It had described
  the V1 isometric work as in progress for eight days after it landed, and named `iso.ts`, which
  has never existed. The board said 348 tests; the tree has 1472 across 113 files.
- **2026-08-27** — CI switched back on. `.github/workflows/checks.yml` had been
  `disabled_manually` since 2026-08-20: 257 commits with nothing run, while the file sat in the
  tree looking like cover — the state its own header calls worse than having no check at all.
  First run since is green on Linux in 4m43s, `npm ci` through `npm run build`. Seven days of
  macOS-only commits turned out to be fine, which was assumed until today and is now known.
- **2026-08-27** — The release artifact checked against merged `dev` for the first time; the one
  in `release/` was 180 commits stale. Both DMGs build. `memory/` is absent from the bundle,
  `projects/` carries only the template and its README, nothing resembling a credential ships,
  and the dev harness stays out of `app.asar`. The disk image window carries `INSTALL.txt` and
  `Fix permissions.command` beside the app, and the fix script's not-yet-installed branch says
  to drag the app across first.
- **2026-08-19** — The session registry, and picking up where you left off. Sessions are written
  down per workspace and the most recent one is resumed on launch with its transcript rendered.
  A registry that cannot be read is reported rather than offered as a blank slate, which is the
  place that rule costs the most if it is got wrong. Tests 191 → 212.
- **2026-09-17** — Nine PRs merged onto `dev` in one train: #237, #241, #245, #242, #240, #246,
  #238, #244 and #239. For each, the branch was rebased onto the `dev` it was joining, and the
  rebased tree was checked against `git merge-tree`'s prediction. Its own tests then ran, and
  CI had to be green on the pushed head before the merge. `dev` is `e6fe5cb`. V3's first two
  PRs, #241 and #242, are among the nine.
- **2026-09-17** — GitHub Actions stopped starting jobs at 04:37:55Z, because the account's
  Actions quota was spent, for about fourteen days. `scripts/ci-local.mjs` (#261) runs CI's
  three steps on this machine and posts a `local-checks` status saying it is not CI. The disk had fallen to 1.18 GiB free, mostly
  because of test leftovers. 40,774 of them were deleted with the maintainer's approval, and
  #254 stops the suite leaving more. See D15 and D16 in [DECISIONS.md](DECISIONS.md).
- **2026-09-17** — V3's replacement for the lobby was written into §4b, with both teammates'
  rounds. It freezes once the maintainer answers Q1, Q8, Q13a and Q13b. TASKS.md, PROGRESS.md
  and DECISIONS.md were added at the root.
- **2026-09-24** — Jev Phase 0 opened (§4c, D24): one day of evidence on a hosted typed-decision
  model — real VERIFY cells and mishap strings against a dumb baseline — before any integration
  is considered. Candidate uses ranked with the privacy teammate's review; risk-scoring held
  tool calls and floor stall detection set aside with the reasons written down. Run by the jev
  teammate.
- **2026-09-24** — Jev Phase 0 reported, and D24 closed as no. Through the Vercel AI Gateway,
  twice: 79/85 on VERIFY cells both runs, against 82/85 for a fifteen-minute regex, and the
  misses moved between runs with nothing changed on our side. Its only wins were on examples the
  evaluator wrote. The regex itself — verdict recall 0/13 → 10/13, no false flags — is the find.

---

## 8. Done looks like

Added 2026-09-03. One line per outcome for the whole app, each with the command that proves it.
Tick a line only when its VERIFY exits 0 — `/verify` does it; Pulse reads the ticks and will
contradict a tick whose command fails. The V1–V4 lines summarise §4b; the detailed checklists
there stay the record of *how*.

- [x] Workspace discovery renders the live staff roster from `.claude/agents/` — `npx tsx --test test/workspace.test.ts`
- [x] Floor movement, pathfinding and choreography tested, with no renderer coupling — `npx tsx --test test/the-shared-boundary-holds.test.ts`
- [x] Spawns the user's own `claude` CLI; no Agent SDK is embedded — `test "$(grep -c claude-agent-sdk package.json)" -eq 0`
- [x] Chat panel streams real session output including tool calls — `npx tsx --test test/chat-view-events.dom.test.ts`
- [x] Click-to-ask speech bubbles never show a stale or fabricated answer — `npx tsx --test test/bubbles.test.ts`
- [x] Sessions and transcripts persist so reopening the app resumes conversations — `npx tsx --test test/transcript-store.test.ts`
- [x] Multiple project tabs run independent sessions and floors concurrently — `npx tsx --test test/projects.test.ts`
- [x] Workspace trust is enforced before any command runs — `npx tsx --test test/trust.test.ts`
- [x] The tool allowlist is enforced before any command runs — `npx tsx --test test/permissions.test.ts`
- [x] The VERIFY harness reads TASKS.md and reports passed / failed / uncheckable / not run — `npx tsx --test test/verify.test.ts`
- [ ] The DMG builds and runs unsigned but usable — untickied 2026-10-01: the check matched a config key rather than a build, so it could not fail; and the evidence was a session log of 2026-08-27, while the newest disk image in `release/` is from 2026-09-03 and the published v0.0.1 images were uploaded 2026-09-25. The tick described none of the three. Ticks again when a release script builds one and the sha256 of that file matches the one published beside it
- [ ] The AppImage builds and runs — no run is recorded anywhere; uncheckable until someone builds it on Linux
- [x] V1 The isometric projection: floor, cast, pathfinding, labels and bubbles all work in isometric (§4b). Uncheckable by command, and left that way for V2's reason: the evidence is §4b's own twelve ticked items, each with its own check, and a command here would only re-assert their sum
- [x] V2 Furniture and life: a stranger can tell who is working, who is stuck, and what the project is without reading the chat — all three §4b items ticked (§4b). Uncheckable by command, and left that way: no command tests whether a *stranger* can tell, and attaching a proxy would make an unfalsifiable line look falsifiable
- [ ] V3 Which office needs you: adding a project adds an office card, and the all-offices view lists every office once, ranks an office holding a call above a merely busy one and says why, accounts for every held call, and answering it moves no card on the campus — `npx tsx --test test/which-office-needs-you.test.ts`
- [-] V4 The arrival: a fresh clone opens onto a building site; five projects open onto five floors of lit windows — **withdrawn 2026-10-13 by D18**, no command. Since D14 there is no building, and at a first launch nothing is running, so the one view this could show honestly is every office idle. The fresh-clone half is already served by the first-run panel's "No projects yet" step
- [x] A public release is published: a tagged GitHub Release whose artifacts somebody who is not this account can fetch — ticked 2026-10-13. It was untickied on 2026-10-01 because the old check, `gh release list | grep -q .`, exits 0 inside a private repository and so could not fail for the reason the sentence is about; both `v0.0.1` images read `downloads = 0`. The command now asks the thing the sentence claims, unauthenticated and from outside: it exits 22 against the private repository and against a tag that does not exist — `curl -sfL -o /dev/null -r 0-0 https://github.com/slug-labz/office-space-app/releases/download/v0.1.0/Office.Space-0.1.0-arm64.dmg`

Added 2026-09-04, for the work that landed overnight. Every VERIFY below was run on this tree
before it was ticked — all four exit 0 with no `not ok` lines. Scored on the exit code rather
than the summary counts, because a wedged test reports `# fail 0` while exiting non-zero.

- [x] A decision somebody made outlives the call that used it, so a night away has an answer — `npx tsx --test test/what-the-office-did-while-you-were-out.test.ts`
- [x] The office can be asked what it approved while you were out, and says what it could not read — `npx tsx --test test/the-decided-panel.dom.test.ts`
- [x] The gate hands back a question the app destroyed instead of answering for it — `npx tsx --test test/approval-gate.test.ts`
- [x] A wedged test fails the suite rather than hanging it — `npx tsx --test test/repo-health.test.ts`

The boundary check was strengthened on 2026-09-06 after being tested rather than trusted. It
read `grep -l "from '.*renderer" src/shared/floor/*.ts` — single quotes only, and one flat
directory of the fifteen files in it. Both were evadable, measured:

    double-quoted import added to src/shared/floor/grid.ts     old check exit 0   (evaded)
    single-quoted import added outside src/shared/floor/       old check exit 0   (evaded)

It now reads both quote styles and recurses over all of `src/shared/` — 78 files rather than
15 — which is the boundary `CLAUDE.md` actually states: pure decisions in `src/shared/`, drawing
in `src/renderer/`. It exits 0 on `dev` today, so nothing was ticked that should not have been;
what changed is that it can now fail.

Strengthened a second time on 2026-10-01, after being tested again rather than trusted. The
one-liner above read only `from`, and it reported success over a directory that was not there —
`grep`'s complaint goes to stderr, so `test -z ""` is true of the empty stdout. §4b has been
moving these directories all month, and a rename would have left the line ticked and green over
a check of nothing. Measured against the version it replaced:

    import '../renderer/side-effect.js'            old check exit 0   (evaded — no `from`)
    const m = await import('../renderer/draw.js')  old check exit 0   (evaded — no `from`)
    const m = require('../renderer/draw.js')       old check exit 0   (evaded — no `from`)
    src/shared/ renamed away entirely              old check exit 0   (passed on nothing)

It is now a test file, which is the shape nine other lines here already use, and it asserts the
scanner against both the five forms it must catch and three lookalikes it must not — because a
pattern that silently stopped matching would pass the boundary assertion on every tree forever.
Each of the four rows above fails it. `import\(|require\(` was considered for the pattern and
rejected: it flags `await import('./lazy-shared.js')`, which is nobody's violation.

The trust line was split the same day. It named two test files, and `tsx --test` **skips a name
that does not exist and exits 0** when at least one other name resolves — measured: `npx tsx
--test test/trust.test.ts test/zz-does-not-exist.test.ts` exits 0. So renaming
`permissions.test.ts` would have left the allowlist half of that outcome unproven and the line
still ticked. One file per line.

Already true, and therefore not outcomes: PR #170 (108 files) merged onto `dev` on 2026-09-01;
PR #51 merged `dev` into `main` on 2026-09-03.

Evidence for the ticked lines, from the first draft and its review: workspace, floor, chat, bubbles,
sessions, tabs, trust and harness each have a test file named above and a §3 row; the CLI-not-SDK
claim is §2 (corrected 2026-08-19) and `docs/auth.md`; the DMG is the 2026-08-27 session-log entry;
V1 is §4b's own twelve ticked items.
