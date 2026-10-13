# The sweep

Every surface in the app, operated rather than read. Written down because an audit that lives
only in a transcript has to be repeated from scratch, and because the interesting half of it is
what turned out **not** to be a defect.

The method throughout: launch the real Electron app against a throwaway workspace, drive it over
CDP, and check what changed on screen *and* on disk. Not the test suite — the suite is 2145
assertions and every finding below survived it.

---

## What was found

Twenty-one defects. Every one of them reachable by a person, none of them visible in the source.

| Where | What | Why the source looked right |
|---|---|---|
| `⌘K → Switch project or conversation` | Closed the palette and opened nothing. `⌘L` worked. | The row binds `mousedown` deliberately; the switcher closes on an outside `mousedown` deliberately. The row's event kept bubbling to `document` **after** the action opened the list, and shut it inside the same event. |
| `⌘K → Start a new project` | Nothing at all. | It reached into the *closed* switcher list for `.swrow--add` and called `.click()`. That element is a `div`; the handler is on a button inside it. |
| `Look`, with an empty box | No refusal, no sentence. | `if (!at) return`. The sentence existed and was tested — `whyNotASource('')` — and the renderer never asked for it. |
| Connector panel, broken `.mcp.json` | Listed one machine-wide server, looked complete, said nothing. | `capabilities.ts` marked the file `unreadable` and carried the parse error. Both crossed the bridge. The panel read neither. |
| Memory lede, unreadable file | *"Nothing readable recorded · 1 **more** exists"* — more than nothing. | The `n > 0` half of that sentence had a test and this half did not. |
| The transcript, from the first frame | Two panes printed on top of each other, unreadable. | `openSession` hid the outgoing pane behind `if (activeSession)`, and `activeSession` starts as `''`. `current()` is `tabFor(activeSession)`, so the startup notice creates a real tab under the empty string and the truthiness guard walks past it. |
| `Talk to them directly`, on an agent card | Said *"Talking to backend"*, left the header reading *"The office"*, and created no transcript for the agent at all. | `cardTalk` assigned `activeSession` before calling `openSession`, whose first act is `if (info.id === activeSession) return`. The switch it was asking for was cancelled by the line before it — and `activeSession` had still moved, so anything typed went to a conversation with no pane. |
| The roster, on a malformed agent file | Two dead controls. An agent whose frontmatter says `name: ../escape` was offered `Send home` and `Fire`; both ended in *"A name cannot contain a slash."* — the second after a confirmed destructive press. | Discovery admits any `name:`; `roster.ts` refuses one that could not be a filename. Both correct, and nothing joined them. |
| A fresh workspace with an allowlist | Every VERIFY came back *"nothing has authorised this"* about commands `settings.json` plainly permits, and **nothing on screen said why**. | `harness.ts` treats `unknown` trust as untrusted for running — *"being unable to tell is not permission"* — while `checkTrust` warned on `untrusted` alone. Two correct rules; `unknown` was where they disagreed. |
| First-run's untrusted step | Titled *"nothing here may run a command"*, which its own detail contradicts. | `trust.ts` records correcting the same overstatement in its message: Claude Code does not sandbox an untrusted workspace, it stops honouring the list. The title kept the error the message had already lost. |
| A skill dropped into `skills/` | `ENOTDIR: not a directory` about `loose.md/SKILL.md` — a raw errno naming a path that cannot exist. | The scanner statted `<entry>/SKILL.md` without checking the entry was a directory. Now it names the mistake and the fix, and stays silent for a plain `README.md` beside the skills. |
| Two windows on one workspace | One window's conversations **erased from the registry**. Both offices answered, both showed `$0.0487`, and the file held one row. A second run with the saves landing the other way held two, one missing its cost. | The save wrote this window's whole in-memory list. *"Last-writer-wins"* was the intended trade and was being applied to the whole **file** rather than each conversation — and a second office never learns about a conversation the first starts afterwards. |
| Adding connectors at once | **Six of twelve lost, and all twelve reported `ok`.** | `connect`/`disconnect` are read-modify-write on one file with no queue, so each call worked from a view of `.mcp.json` that the write before it had already moved. `hireFrom` and `takeTheirs` had the same shape on the provenance record. |
| Connector form, refusal text | *"The environment variable needs the NAME of an environment variable."* | A noun slotted into a sentence that already contained it. |
| Memory panel, first card drawn | `**Why it matters:**` as four literal asterisks. | The keeper's format ends every record with it, and the body was plain text. |
| `whatWouldBeShared`, workspace deleted | *"git is not installed, or is not on the office's PATH."* | `execFile` reports the same `ENOENT` for a missing binary and a missing `cwd`. |
| A project created by hand | Invisible until the app restarted. | Nothing watched `projects/`, **and** the workspace watcher's callback never refreshed the project list — so even a change it saw repainted against the previous one. |
| Force-quit with an agent mid-answer | The `claude` child kept running — reparented to init, still spending, with no window left to show or stop it. | `children.ts` stops every child at `before-quit`, and that handler is exactly what a crash skips. `detached: true` is needed so a kill reaches claude's own tools, and is also what stops the kernel taking the child down with its parent. |
| Clicking a person on the floor, then quitting | The aside kept running. Same for the voice digest. | `children.ts` calls itself the list *every* child is added to. Three of the four `runClaude` callers never registered, so `stopAll()` could not reach them and the cap never counted them. |
| The first-run panel, open, while a problem arrives | The badge went to *"2 things to know"* and the panel underneath kept listing the same two items. | `render()` rebuilds the badge from the diagnosis on every snapshot; the panel body was painted once, when it opened. Both read the same `diagnose()` — only one of them re-read it. |
| The roster, open, while somebody writes an agent file | The status bar went to *"8 on the floor"* above a roster still listing seven — both on screen together. | Same fault as the row above, one panel along. The bar is rebuilt from every snapshot; the panel was painted when it opened. That panel's own header warns against *"holding a second copy"* of the filesystem, which is what a painted-once list is. |

Two more were fixed while writing the checks: a `share--${verdict}` class the styled-class audit
cannot see, and `.find()` not narrowing a union without a type predicate.

---

## What held

- **The slash menu, in a workspace that started as an empty folder.** Typing `/` offers the six
  shipped commands with their argument hints — `/decision <what was decided, and why>` — beside
  the skills, each labelled `command` or `skill`. Worth checking because the office *expands*
  nothing: `--print` resolves a slash command before the model sees it, so the menu does not make
  commands work. What it fixes is that a misspelled one is answered synthetically, for free, with
  no error and no reply — the silence its own header is written about.
- **374 MB of stale agent worktrees under `.claude/`, and they do not ship.** `.claude/worktrees`
  holds ten leftover checkouts, ignored through `.git/info/exclude` and therefore invisible to
  `git status` — the shape that hides things. The packaged app carries none of them: `app/` is
  136 kB against 374 MB on disk. Guarded, and the guard was mutation-tested rather than read —
  drop `"!worktrees"` from the `extraResources` filter and `persistence.test.ts` fails, because it
  asks *git* what is ignored (`--exclude-standard`, which reads `info/exclude`) rather than
  guessing. Its rule is the general one and worth the quote: **if git is told to ignore it, it is
  not ours to hand out.**
- **The packaged app carries all of it.** `electron-builder --dir`, then the built binary driven
  rather than the dev entry point: it launches, and the roster repaint added today works inside
  the asar — write an agent file with the panel open and the bar goes *"7 on the floor"* → *"8"*
  while the list goes 12 rows → 13. No main-process errors. The repo's own unwired tools agree:
  `preflight.mjs origin/dev` reports OK with 4/4 canaries, and `unread-fields.mjs` returns only
  cases its own header predicts — every `*Request` type, which it says it over-reports because
  main validates bridge payloads by index access, plus fields already documented as knowingly
  unread. The one that looked substantive was checked and is not: an aside's cost is spent onto
  the project in `main.ts` before the field crosses the bridge at all.
- **The approval gate, driven end to end** — the one seam nobody had operated, and the most
  safety-relevant. Every path behaves: see *The gate, operated* below.
- **No `claude` on the machine**, the likeliest first-run failure for a product whose runtime is
  the CLI you already have. Started with `OFFICE_CLAUDE_PATH` pointing at nothing: the first-run
  panel opens by itself saying *"The office cannot find the `claude` command, so nobody here can
  do anything"*, names the path it looked in, explains that a Dock-launched app does not see a
  shell's PATH, and gives both the fix (`which claude`, then `OFFICE_CLAUDE_PATH`) and the install
  line. A pill in the status bar keeps saying so. Nobody can waste a message before being told.
  Already held by `claude-path.test.ts`, `first-run.test.ts` and `first-run-panel.dom.test.ts`.
- **An editor changing files while the office is open.** Add, edit, delete and un-readable, all
  from outside. The floor tracks every one live; a stale row's button still checks disk before
  acting. See *The editor outside the window* below.
- **Scale.** 67 staff and 40 projects in one workspace: the floor draws all 67 with name plates,
  the campus grows a 704 × 6536 canvas rather than dropping anybody, and every count on screen is
  arithmetically true. See *Scale, and four counts that had to be checked* below.
- **Untrusted text on screen.** A script tag, an unterminated bidi override and a
  4 000-character description, all rendered without incident. See *Untrusted text, worked as a
  class* below.
- **Twenty palette commands.** Eighteen were already correct; the two above are fixed.
- **Forty-odd panel controls.** Twelve settings choices apply, keep exactly one selection per
  group, and move the tab stop with it.
- **Every destructive verb asks first.** `Fire` arms — *"Delete their file — click again"* — and
  touches nothing until the second press. `Delete`, on a measured store, puts the real number in
  the label. `Delete`, on a project, opens a native dialog naming the directory and the file
  count, and the directory is still there while it is up.
- **`Send home` → `Bring back`** round-trips on disk: `tester.md` → `tester.md.off` → `tester.md`.
- **Every panel is a focus trap.** Swept with real key events: settings cycles its five
  radio-group stops and closes, connect and maintained cycle their fields, the roster walks its
  rows. Nothing escapes to the floor behind, and nothing on screen is unreachable by Tab.
- **The floor.** Clicking a person raises a bubble in plain language — *"Nothing has been asked of
  the office yet"*, which is the honest answer rather than an invented status — with a `Details`
  button that opens the card. VISION.md §3.4, working.
- **The campus.** Zoom out, click an office, and it zooms in and focuses that project. The
  command's own label toggles to *"Back into this office"*, so the way back is where the way out
  was.
- **The activity strip.** *"Running: nobody is mid-task. Happened: nothing yet this session."* Two
  empty states, said separately.
- **The music panel.** *"Until you connect, it makes no requests to Spotify at all."*
- **Every shared-file write in the main process, swept as a class.** Seventeen `writeFile` call
  sites. Most are per-item — an agent, a skill, a project's template, an approval request, a temp
  WAV — and several use `wx`, so two of them can never both write one thing. **Three** were
  read-modify-write on a single file shared by every caller: the session registry, `.mcp.json`,
  and the provenance record. All three lost data, all three are serialised now, and the sweep says
  there is no fourth.
  The two that look like a fourth are not. `reconcile.ts` accumulates a receipt of shipped files,
  but two offices starting together compute the same set from the same manifest and the same disk,
  so whichever writes last writes the same answer. And the Spotify token store is written by one
  OAuth callback at a time, by construction.
- **Two projects at once**, which is §9's whole claim: *"nobody has a way to see it working, run
  several projects properly at once"*. Started a conversation in each without waiting for either.
  Each answer landed in its own pane — one pane holding `APPLES` and no `BANANAS`, another the
  reverse — exactly one visible at a time, the visible one following the active project, and each
  project's cost recorded separately and correctly. No cross-talk, which is where a third
  pane-routing bug would have lived after the two that were found.
- **A stray line on `claude`'s stdout**, which is not the office's fault and is the office's
  problem. The first turn of a new session printed an MCP diagnostic — `Client.listTools() called
  but server does not advertise tools capability` — into a stream that is meant to be JSON. The
  office reported it as *"Unreadable line from claude"*, verbatim, and recovered: the run ended,
  `Send` came back, and the next turn answered normally. That first turn produced no reply and no
  charge. It will happen to anybody whose machine has an MCP server that behaves this way, and it
  behaves the way this codebase asks — the line is shown rather than swallowed, and nothing on
  screen claims an answer that never came.
- **A refusal, end to end.** The permission control's claim is that *"denials are rendered in the
  transcript either way: a tool that was refused is a thing that happened, and hiding it would
  leave you wondering why nothing changed."* Put in `plan` mode and asked to create a file with
  the `Write` tool: **nothing was written**, and the manager said so — *"tools are withheld. If
  that's right, the answer is that I won't, and I'll say so rather than route around it via Bash
  or a subagent. If you want the file created for real, move me out of intake and out of plan
  mode."* Two gates named, the restriction held, and the screen explained itself rather than
  going quiet.
- **The trust gate**, as far as it can honestly be taken from here. A workspace Claude Code has
  never opened produces **no warning**, and that is correct: `trust.ts` classifies it `unknown`
  rather than `untrusted`, because *"the prompt has simply not been asked yet — which is genuinely
  different from having been answered no."* Confirmed live on a directory absent from
  `~/.claude.json`: nothing on screen, `problems: []`.
  The `untrusted` state needs an entry that records a refusal, and reaching it live would mean
  writing into somebody's real Claude Code config to manufacture a test condition — which is not
  a thing to do to a person's machine. It does not need reaching: `workspaceTrust` takes an
  injectable `home` for exactly this, and the state is covered at every layer by fixtures — the
  decision in `trust.test.ts`, the rules in `capabilities.test.ts` (*"an untrusted workspace still
  declares its rules, and none of them are in force"*), the first-run step, and the snapshot.
- **The three controls that decide what the office may do.** The permission dropdown offers five
  modes and gives each one its consequence in plain words rather than its name — *"Reads and
  proposes. Changes nothing on disk"*, *"Writes and edits files without asking"*, *"Runs anything
  the rules have not explicitly denied"*. Picking one sticks and the pill follows it. The default
  is `acceptEdits`, and it is documented where it is set: *"`-p` has no way to answer a permission
  prompt, so whatever is not pre-authorised is refused — an office in the strictest mode looks
  like a room full of people who cannot open a file. `acceptEdits` is Claude Code's own everyday
  working mode and is the default here for that reason, not because it is permissive."*
  Overridable with `OFFICE_PERMISSION_MODE`, and denials are rendered either way. The model and
  effort dials open, and every item in the `···` menu opens the panel it names.
- **The voice path**, as far as it can be taken without a microphone. `dictation()` reports
  `{ ready: true }` on this machine — `whisper-cli` from Homebrew plus the 148MB model in the
  office's own application-support directory — and the mic's picker lists the machine's real input
  devices. The setup half is the interesting one and is not reachable here: the model was already
  present, so what a machine without it sees was not exercised. Recorded as **not checked** rather
  than checked.
- **An empty directory.** VISION.md §7 is *"clone it and it's yours"*; pointed at a directory
  with nothing in it at all, the office seeds `.claude/` and comes up with seven staff and five
  skills. It cannot scaffold a project — `projects/_TEMPLATE/` is not part of what is brought
  forward, because the manifest is scoped to `.claude` — and it says exactly that when asked:
  *"that template is missing, so the office cannot start one for you. Create the directory by
  hand, or re-clone."* The first-run panel does **not** interrupt to say it, which is its own
  documented rule: *"Nothing is wrong — there is just nothing here yet. Worth one line in the
  status bar, not a panel across somebody's first look at the office."* Correct on both counts,
  and the shipped path — a clone — has the template.
- **The packaged app.** `npm run package` builds a 286MB `.app`; launched from a throwaway
  workspace it comes up with the manager on screen, the floor drawn, and *"7 on the floor · 5
  skills"* in the status bar. All four panels added in this sweep — memory, connectors, employees
  somebody else maintains, and what a push would carry — open inside it, so the features ship
  rather than merely running from `dist/`. Its log holds nothing but the macOS camera and input
  warnings the dev build also prints.
- **A `settings.json` that will not parse.** Correct at every layer: a problem naming the file,
  `permissions: { allow: 0, deny: 0, inForce: false }` — failing closed rather than honouring a
  file it could not read — and the parse error with its line and column shown to the person. The
  sentence is the fourth standing order in six words: *"its permission rules are not in force —
  this looks exactly like having none."*
- **A `TASKS.md` full of edge cases.** All four outcomes the second standing order names are kept
  apart. A verdict written where a command belongs — `PASS — I read it and it looks right` —
  reports **uncheckable**, never passed, which is the refusal that rule exists for. No backticks
  at all is uncheckable too, by design. An empty column says *"no VERIFY condition"*.
- **Malformed slash commands.** Listed, because a command file without frontmatter is still a
  runnable prompt, with the description shown blank because it genuinely is — and the problem
  said out loud once in the transcript: *"Reading commands: …/bare.md — no-frontmatter"*.
- **A registry that will not parse.** The record of every conversation. It is not overwritten —
  `mayWriteRegistry` refuses to write back over a file it could not read — and the first-run panel
  says *"sessions.json exists and could not be read, so whatever is in it is not on the floor.
  This is not the same as it being empty."* Six input types checked in this seam; this is the one
  where getting it wrong would cost somebody their history, and it is the most carefully handled.
- **A workspace where several things are broken at once** — unparseable `.mcp.json`, a `chmod 000`
  memory file, an unreadable project directory. Every one is now named, with its cause.

---

## The fix that lost a message, and the one that did not

**The transcript stack only ever grew.** `tabs.delete` and `element.remove()` appeared nowhere in
`app.ts`: a pane was created for every session id the renderer had seen and never removed.
Measured on a fresh workspace, pressing `+ new conversation` — one pane per press, sessions
staying at one, for the life of the window.

`office.openSession(project, null)` returns a **different id every call**, because creating a
session is what *new conversation* means. A conversation nobody has said anything in never gets a
record, so the office does not list it. Both halves are right; together they stranded a pane per
press, keyed by an id the switcher would never show.

### The first fix was wrong, and running it is what said so

Three conditions: not on screen, not in the office's list, and `state.sessionId === null` — on
the reasoning that a conversation which had run would have an id, and a record, and therefore a
listing. It is a tidy argument and it is false.

`sessionId` arrives on a **stream event**, after the send. Between pressing Send and the first
event there is a window where a conversation has been sent to, has the person's own words on
screen, and has no id. Driven in the app, that version deleted exactly that pane — a message
somebody had just typed, gone.

The condition that holds is the one that was dismissed as the tempting predicate: **the pane still
shows nothing but its empty state.** A send appends the outgoing message immediately, so the pane
is the honest witness — anything that has been sent to has content, whatever its bookkeeping says
yet.

Verified three ways after the change: three empty conversations no longer accumulate; a
conversation with a reply survives being switched away from; and a message sent and abandoned
**600ms later**, mid-flight, is still there afterwards. That last one is the case the first version
broke.

The lesson is not "be careful with predicates". It is that the argument for the first version was
persuasive, self-consistent, and available to be checked in about four minutes — and only the
check could tell it apart from the argument for the second.

---

## The instruments were wrong more often than the app

Thirteen times. Each one looked exactly like a defect until it was checked — and the last two were
not about the app at all, but about the commands being used to check it:

- `document.querySelector('canvas')` finds a 16×16 switcher avatar, not the floor.
- `.click()` does nothing on a palette row — they bind `mousedown`.
- CDP `Input.dispatchMouseEvent` never delivers a press to this app; `dispatchEvent` does.
- A settings choice marks itself with `aria-checked`, not `aria-pressed` or a class.
- Walking up from a button to find "the row for X" matches the whole panel, whose text contains
  every name — so the app appeared to disable the wrong employee when it had done the right thing.
- "tester" surviving the roster after being fired was a *skill description* that mentions one.
- The DOM shim exposes `tag`, not `tagName`; reading the wrong one finds no controls at all.
- A 32px scan grid is coarser than a character's half-width, so it misses everybody.
- `Emulation.setDeviceMetricsOverride` does not resize this window, and
  `Browser.getWindowForTarget` is not in Electron's CDP. Neither of the obvious ways to shrink the
  window works — which is not the same as the case being untestable, and it was carried as *not
  checked* for a while on that mistake. The window is created at 1280×820 with
  `minWidth: 900, minHeight: 600`, so **temporarily building it at its own minimum** is the way in.
  Done: at 900×600 nothing spills out of the viewport, the document does not scroll sideways, the
  composer and Send stay visible, the floor scales down inside its frame, and all five panels fit
  between 60 and 540 of 600. Below 900×600 is genuinely unreachable, so there is nothing further
  to check.
- A canvas that overhangs its parent is not off-screen when the parent is `overflow: hidden`.
- **The coverage report is keyed by basename, not path.** Six of them repeat — `connect.ts`,
  `music.ts` and `memory.ts` each exist twice or three times, `hired-from.ts` twice — so an
  uncovered range read off one row can belong to a different file entirely. A range of `179-180`
  was chased against a 149-line file before that turned up. Function and branch percentages are
  the signal to read here in any case: this codebase's comment density puts several fully-exercised
  modules at 25% *lines* with 100% branches and 100% functions, so the line total says more about
  prose than about tests.
- **`npx tsc --noEmit -p tsconfig.json` is not this project's type check.** `npm run typecheck` is
  *two* configs, and the main one deliberately excludes `src/renderer/**` and carries no DOM
  library — so main-process code reaching for `document` fails to compile. Running only the first
  half all session meant the renderer was never type-checked by anything I ran, and a test that
  drove a renderer view without the `*.dom.test.ts` suffix pulled browser code into the no-DOM
  program. `npm test` stayed green; CI's `npm run typecheck` is what would have caught it, and
  did once it was run. The fix was the rename the config's own comment prescribes. This is the
  most consequential of these, because it applied to every check made from outside the suite.
- **`OFFICE_PROJECT` is `''`**, and three switcher DOM tests say `id: 'the-office'` — a string
  that reads correctly and is not the office. None of them has ever rendered that row. A fourth
  written the same way asserted that a *normal* project has no delete button, and failed against
  an app doing exactly the right thing.

The lesson is not that the instruments were bad. It is that **an instrument that is wrong reports
a defect, and a defect reports a defect, and they look the same.** Checking the tool before
believing the reading became the more productive half of this work.

## Untrusted text, worked as a class

The three seams before this one were about what the app *does*. This one is about what it
*renders*: an agent's reply, a tool result, and — since VISION.md §4 — a description copied out
of a colleague's repository. None of it is text this office wrote.

Driven against a workspace built to break it: an agent whose description is a `<script>` tag and
an `onerror` image, one carrying a bare `U+202E RIGHT-TO-LEFT OVERRIDE`, and one with a
4 000-character description.

| Tried | What happened |
|---|---|
| A script tag and an `onerror` image in a description | Rendered as the characters of a script tag. Both flags undefined; zero `<script>` and zero `<img>` in the roster. |
| An inline `<script>` appended to the live document | Did not run. The policy is enforced and not merely declared: `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'`. |
| A bare `U+202E` in a description | Contained. Both row buttons still read `Send home`, `Fire`, left to right. |
| A 4 000-character description | Clamped to three lines. No row spilled its panel, and the document never scrolled sideways. |
| An override reaching the canvas nameplate | Cannot. Canvas draws a name alone in its own `fillText`, and the one untrusted route is `hireFrom`, where `whyInvalid` holds a hired name to `[a-z0-9-]`. |

Nothing was found to fix, which is the honest result and is recorded so the seam is not walked
again. One rule was being held by nobody, and now is. The bidi containment above is spec-level —
UAX #9 restarts the algorithm at every block — but it rests entirely on the description being its
own block element, and neither the `<p>` that makes it one nor the stylesheet that could undo it
was asserted anywhere. `repo-health` now pins both halves. Compacted to a one-line row with the
description in a `<span>`, an override in a colleague's prose would reverse `Send home` and
`Fire` beside it: the buttons correct in the DOM and wrong on screen, which is the third standing
order failing in the one way no assertion about the DOM would catch.

The instruments were wrong once more, for the twenty-third time. `eval` answered *allowed* under
a policy carrying no `'unsafe-eval'` — because the question was asked through CDP, whose
evaluation is not subject to the page's CSP at all. The inline-script row above is the one that
counts: appending a `<script>` element goes through the DOM, where the policy applies.

---

## The restart seam, and two children nobody was holding

Durable state was the thing most recently changed — three data-loss fixes — and least recently
exercised. Nothing verified that a conversation survives closing the app.

**It does, and it says so.** Quit and relaunch brings the conversation back in the list, restores
the transcript in full, and marks it *"Picked up where you left off — 28/08/2026, 12:19:03."* It
does not pretend the conversation was continuous, which is the third standing order applied to
the one place a resume is tempted to lie. The registry is temp-file-then-rename with a per-call
sequence number, so a torn write is not possible; a `SIGKILL` mid-run left it parseable, correct,
and with no stray temp files.

What did not hold was the process side, twice.

**A crash orphans the agent.** With the agent confirmed mid-answer, `SIGKILL` on the Electron
main leaves `claude` alive, ppid 1, twenty seconds later. It is the exact failure `children.ts`
was written to prevent — *"still running, still talking to Anthropic, still spending the
allowance"* — reached through the one door it cannot close, and worse than the original, because
after a crash there is no window left to notice it from.

**And three of its four callers were never on the list at all.** That module describes itself as
the one list every child joins, *"the only arrangement where 'did we get them all' is a question
with an answer."* Only `session.ts` registered. An aside — clicking a person on the floor — and
the voice digest both spawn a real `claude`, and neither was stopped by `stopAll()` on an
ordinary quit, nor counted against the cap that exists because each one is a real Node process.

The fix is in two halves, on the boundary this repo keeps: the decision in `shared/orphans.ts`,
the machine in `main/orphans.ts`. What was spawned goes on disk, because the process that knows
what it started is the one that died; the next office reads it and kills what is left. The
dangerous half is the reap, so it is a decision with four answers, three of which kill nothing —
a pid is not an identity, and between a crash and the next launch that number may belong to
somebody else. `stampOf` asks the platform when a process started, and a start time that has
changed means leave it alone. A live owner settles it too: a second window must not reap the
first one's work. The recording sits inside `runClaude`, where all four callers reach it, so the
next one cannot forget the way three already had.

Driven end to end: the office records the child, `SIGKILL` orphans it, the relaunch kills it
within two seconds and says so on screen — *"The office did not shut down cleanly last time, and
one agent was still running: claude (8fd98cc5). They have been stopped."*

Three instrument errors on the way, all the same one: the kill kept landing after the work had
finished, so the first three runs proved nothing while looking like a clean result. Counting to
forty takes less than five seconds, and the gap between two tool calls is longer than that. The
test only became real once the send, the wait for the child to appear, the kill and the check
were a single command with no gaps in it.

---

## Scale, and four counts that had to be checked

Built a workspace with 60 staff and 40 projects and opened it. The interesting part of this seam
is not whether it renders — it does — but that the third standing order is mostly *numbers* at
this size, and a number is the easiest thing on a screen to be wrong.

| What it says | Checked against | Verdict |
|---|---|---|
| `67 on the floor · 5 skills` | 67 `.md` files in `.claude/agents`, 5 skills | True. The six I did not create were added by the app's own `bringShippedFilesForward`, which is what it is for. |
| The campus, 40 offices | 40 directories under `projects/` | All drawn. The canvas grows to 704 × 6536 rather than dropping anybody, and the ceiling that would drop one is `MAX_CANVAS_AREA` — a real browser limit, not a number somebody picked. `campus-has-a-ceiling.test.ts` already covers the omission path, including that it says how many went. |
| The roster, 72 rows | 67 agents + 5 skills | True, and every row is reachable: `#roster-body` scrolls 6878px inside 561. |
| `22 more match — type another letter to narrow them` | 40 projects, 24 rows shown | True, and exactly. The 24 is 18 projects and 6 commands; 40 − 18 = 22. The one count here that could have been quietly wrong is right. |

Nothing found. Recorded because the palette line is the shape of claim this repository has been
burned by — a cap that reports a remainder — and it turned out to be doing the arithmetic
properly rather than subtracting the wrong number.

Two instrument errors, both mine and both the same kind: measuring `#roster-panel` for a scroll
that belongs to `#roster-body` and concluding 72 rows were unreachable, and reading `22 more`
against 40 projects as an inconsistency before counting how many of the 24 shown rows were
actually projects. Both would have been reported as defects by a less careful pass.

---

## The editor outside the window

The office does not own its workspace. `.claude/agents/` is a directory somebody edits in their
own editor, and every question here is what the screen does while that happens.

| Done from outside, office open | What the office did |
|---|---|
| Deleted an agent | Gone from the floor within seconds. |
| Changed a description | Updated. |
| Added an agent | Appeared. |
| Added a project | Appeared. |
| Made an agent file unreadable (`chmod 000`) | **Stopped stating a count.** The floor bar went from *"10 on the floor"* to *"staff could not all be read"*, and the notice named the file and the error: `EACCES: permission denied`. |

That last row is the fourth standing order at full strength, and it is more than the rule asks
for. The rule is that an unreadable file must not be silently treated as absent; this goes
further and withdraws the *number*, because "10 on the floor" would have been a guess dressed as
a count.

One thing an open panel does not do is refresh: the roster is a snapshot from when it opened, so
a row can outlive the file behind it. That matters only because the row carries a `Fire` button,
and the button is fine — deleting an agent from outside and then firing it answers *"There is no
agent called newcomer."* The panel can be stale; the action checks disk before it acts, which is
the half that decides whether the screen lied.

**The instrument error here nearly became a reported defect.** The unreadable file does not appear
in the roster, and the first check looked only at roster rows and elements whose class contains
`problem` — found nothing, and concluded the office had silently dropped it. It had not: the
report lives in *things to know*, whose badge had gone from one to two, and the floor bar had
changed its wording. Reading silence in the place I happened to look as silence everywhere is the
same mistake the fourth standing order is about, made while checking that rule.

---

## The gate, operated

The approval gate had been read, reasoned about and argued over in `docs/the-queue.md`, and never
once driven. It is the security control — a `PreToolUse` hook that can hold a tool call while a
person decides — so it is the last place in this app where a claim should stand on reading.

Driven by putting real events through `approval-gate.mjs` against a running office.

| Path | Decision |
|---|---|
| `rm -rf /important/data` | `deny`, before any human sees it: *"Refused by this workspace's own policy: `Bash(rm:*)` in .claude/settings.json."* A forbidden command never reaches the queue. |
| `curl https://example.com/health`, then **Allow once** | `allow`. The card showed the command verbatim, the hook blocked until the click, and the directory was left clean. |
| The same, then **Refuse** | `deny` — *"Declined in Office Space."* |
| A verdict file that will not parse | `deny` — *"Office Space could not read the decision, so this was not approved."* The header's rule that this file must never crash into an allow, holding on the path most likely to break it. |
| No office watching | Exits 0 with **no decision at all**, handing the question back to the normal permission flow rather than granting anything. |

The deny list is worth reading on its own. Alongside `rm`, `sudo`, `dd` and `mkfs` it refuses
`Bash(claude:*)` and `Bash(npx claude:*)` — an agent cannot start its own runtime, which is the
first standing order enforced in policy rather than in prose.

**Queue item #1, substantiated.** Its claim is that the gate denies when the app is open and
unattended, because `watching()` proves a process is polling and not that a person will answer.
Measured rather than read: the `.watching` marker's mtime advanced by exactly 8 seconds across an
8-second wait, with nobody at the keyboard. The freshness threshold is 5 seconds, so the marker
never goes stale while the app is up, the hook waits its whole window, and the deny at the end is
the documented behaviour. Still not fixed here — both identified fixes turn a deny into a defer,
which is a change to what this control does when it fails, and that is the owner's to make.

### The timeout path, and something for decision #2

The one path left. Driven with `OFFICE_APPROVAL_WAIT_MS` rather than by waiting four minutes.

An unanswered request denies — *"Nobody answered in Office Space, so this was not approved."* —
and the request is **moved into `missed/` rather than deleted**, which is the mark the hook's own
comment says a day was lost to not having. On the next launch the office reports it, and the
wording is better than the queue's description of it:

> One approval was asked for and nobody answered it in time, so the tool call was refused. If the
> office is open and unattended, every gated command waits four minutes and is then denied.

That sentence tells the reader decision #1's bug in their own terms, which is worth knowing before
deciding what to do about it.

**But it only says so at launch.** Measured, office open throughout: the badge sits at *"1 thing to
know"* before the miss and *"1 thing to know"* after it, and the sentence is nowhere in the
document. `rescan()` reads the count, and `rescan()` runs when something in the **workspace**
changes — while the state this exists to report is the office open with nobody home, where by
definition nothing changes. So the one person the message is written for is the one who has to
quit and reopen to be told.

**The obvious fix is not enough, and that is the useful part.** Refreshing the count when a request
leaves the approvals queue — the watcher already fires exactly there — moves the badge to *"2
things to know"* and leaves the sentence still absent, because the problem *text* is not re-rendered
on a snapshot update. The result is a badge counting something the reader cannot find, which is a
worse screen than a consistently stale one, so it was measured, reverted, and is recorded here
instead. Both states are written down above: without the change the badge does not move at all,
with it the badge moves alone.

Which means decision #2 is not only about outside the window. Inside it, the mark exists, the
wording is right, and nothing shows it until a restart — and completing that is the same question
#2 reserves: whether a missed approval should announce itself, and where.

Two instrument errors, both mine and both cheap to have avoided: I wrote the verdict to
`.answer.json` when the hook waits on `.verdict.json`, and read the resulting silence as the
malformed-verdict path failing; and a button selector of `/^(Deny|Refuse|No)/i` matched **"Nothing
said yet"**, so the first refusal clicked something else entirely and reported success.

---

## Panels painted once, swept as a class

Two of the twenty-one above are the same fault in two places, so the rest of the class was swept
rather than waited for. There are eight panels; `render()` repainted none of them.

The fault is not staleness on its own. It is **a panel going stale beside something live that
draws the same fact** — then the office states two different numbers at once and the reader has no
way to tell which is true. So the sweep asked, of each panel, whether anything visible at the same
time is rebuilt from the same data.

| Panel | Live thing beside it | Verdict |
|---|---|---|
| First-run | the *"N things to know"* badge, rebuilt every snapshot | **Fixed.** Badge said two, list showed one. |
| Roster | the floor's *"N on the floor · M skills"* | **Fixed.** Bar said eight, list showed seven. |
| Tasks | nothing that counts tasks — the bar reports agent activity | Investigated and **left alone**; see below. |
| Memory, connect, maintained, privacy, settings | nothing drawing the same fact | Stale on open, and consistent. Reopening is the refresh, and nothing contradicts them meanwhile. |

Both fixes repaint **only an open panel** and never open a closed one: whether to be on screen
belongs to `firstRunVerdict` and to whoever pressed something, and a repaint that opened a panel
would drop one over the office every time a file moved. Neither flashes its loading notice — that
belongs to an empty panel somebody just opened, not over a list already drawn.

### The task panel, and why it is not the third fix

It looked like the worst of them. Its heading is *"VERIFIED, NOT BELIEVED"*, its own count sits
underneath, and with it open while `TASKS.md` gained a second task it went on reading *"0 tasks ·
none outstanding"* and *"No tasks written down yet"*. A fresh launch on the same workspace reads
*"2 tasks · 2 outstanding"*, so the parse was never the problem.

A fix was written and then reverted, because it could not fire. `projects/` is watched
**non-recursively on purpose**, and `workspace.ts` says why: *"the list changes when a directory is
added or removed and nothing else. Watching the contents would fire on every append to a
`PROGRESS.md`, and a project holding a build tree would make that constant."* No snapshot arrives
when `TASKS.md` changes, so a repaint hung off `render` would never run — while still costing a
file read on every other render. Machinery that cannot do its job is worse than none.

What is left is a reading taken when the panel opened, with nothing on screen contradicting it,
which is what a document viewer is. Recorded rather than fixed, because fixing it means watching
project contents, and that decision was made deliberately in the other direction.

---

## The claim that was believed

`cli/eval.ts` opens by naming the hole this whole document is about, in its own product:

> `manager.md` spends forty lines arguing that dispatch is the default, and every test in this
> repo checks that the *prompt says so*. None checks that the manager *does so*. **The largest
> behavioural claim in the product is currently believed.**

It is deliberately outside `npm test` and outside CI — real runs, real money, not deterministic —
which is exactly how something stays unrun. It had never been run. It has now been run twice,
because its own rule for reading a result requires two:

> A single failure is the model being a model. **A scenario that fails the same way twice is a
> prompt that stopped working.**

| Scenario | Run 1 | Run 2 |
|---|---|---|
| a feature is dispatched | **answered itself** | dispatched → builder |
| a code question is still work | dispatched → reviewer | dispatched → backend |
| one file read is not a dispatch | answered itself | answered itself |
| a greeting is not work | answered itself | answered itself |
| a review is a dispatch, not a self-check | dispatched → reviewer | dispatched → reviewer |
| | 4/5 · $0.7241 | **5/5** · $0.1762 |

**Nothing failed twice, so the prompt holds.** The one miss is the case the eval's own note is
written for, and it is worth naming rather than rounding away: asked to add retry-with-backoff and
cover it with a test — two steps and a judgement about how — the manager did it itself once and
dispatched it to `builder` the next time. That is the boundary the prompt argues about being
genuinely close, not a rule that has stopped working.

Note also what run 2 shows about the roster: the same request went to `reviewer` once and
`backend` the next, and both are defensible. The eval measures **what the manager did**, never
why, and says so — it cannot tell a right answer from a right answer reached badly. That is the
honest ceiling on this check, and it is the same ceiling the floor has.

Total: $0.90 of somebody's subscription to stop believing the thing the product is for.

---

## Walking past first contact

Eleven seams had been driven and nobody had ever run the product's own loop: make a project,
describe a feature, and watch somebody build it. Done on a fresh install, twice.

**It works.** The manager took the request, asked in intake, and on `Start building` dispatched
`builder`, which wrote `greet.js`, `greet.test.js` and a `package.json`. `node --test` in that
project passes. The office builds working software, which until now was a claim.

**It cost ten approval clicks.** The chained-command rule had been put in `manager.md`, and the
employees are the ones running commands — `builder` sent `mkdir -p "…" && ls -la …`, which cannot
match an allow list that matches by leading word. Moved to `CLAUDE.md`, whose opening says its
rules govern every agent in the workspace, and the same walk re-run end to end:

| | approvals | produced code |
|---|---|---|
| Rule in `manager.md` only | 10 | 8 tests pass |
| Rule moved to `CLAUDE.md` | 4 | 11 tests pass |

> **Withdrawn, and worth reading as a mistake rather than a result.** That table was reported as
> evidence the move worked. It is not. `CLAUDE.md` was **not seeded into a workspace at all** — the
> finding two sections below — so on the second run the rule was in `manager.md` no longer and in
> the workspace never. Whatever moved 10 to 4, it was not the rule being read. The two walks also
> differed: the second went straight through intake instead of answering a question first, so they
> were not the same walk either.
>
> Both numbers happened. The comparison between them did not mean what it was reported to mean.
> The fix is still right — the employees run most of the commands and were never told — but it is
> unmeasured, and saying so is cheaper than a measurement nobody can trust.

`Bash(node --test:*)` went on the allow list with the same measurement behind it. `npm test` was
already allowed and both run the project's own test files, so they carry exactly the same risk —
and a project the office has just created has no `package.json`, which makes `node --test` the
natural VERIFY. The second standing order says a VERIFY is a command the harness runs; a VERIFY
that stops to ask a person is one the harness cannot run.

### The VERIFY harness, all four outcomes

The second standing order says a claim is checked by running a command, and the harness reports
four outcomes. Nothing had ever driven it. All four, observed:

| Outcome | Driven how | What was shown |
|---|---|---|
| **PASSED** | `ls projects/random/site/index.html` in a trusted workspace | the verdict *and the command's own output* |
| **FAILED** | `grep -q "launching" …` | `exit 1`, the real code |
| **UNCHECKABLE** | *reviewed by eye* — no backticks | not run, and not counted as passed |
| **NOT CHECKED** | the same list in an untrusted workspace | *"nothing has authorised this"*, per task |

That last row is not a fault and took a wrong turn to establish. Every VERIFY in a fresh workspace
reads as unauthorised, and the reason is on the first-run panel in as many words: *"This workspace
is not trusted, so nothing here can be verified. Claude Code drops a workspace's permission rules
until you trust it… checks will come back 'not allowed' rather than passing or failing."* The
matcher was probed directly against the same policy and answers `allowed` for the same command —
so the app is right, and it says why.

**The `node --test` entry paid for itself on a real project.** `projects/payment-page/TASKS.md`
carries `` `node --test projects/payment-page/test/validate.test.js` ``. Judged against the policy
before and after: `unlisted` → `allowed`. That VERIFY could not run in this repository, and the
second standing order's whole claim is that the harness runs the command rather than believing
the agent.

**And it showed decision #2 in the field rather than the abstract.** Mid-walk the floor read
*"1 call needs you · 1 mid-task"* and stayed there for 350 seconds — an employee stopped on a
gated command with nobody at the keyboard to answer. The gate fix that landed this session helps
when the office *quits*; nothing helps when it is open and you have walked away, which is what
#2 is about.

---

## Built, and then actually driven

The template bug established that **"built" and "works when somebody uses it" are different
claims**. So every VISION section that had been built and never operated was operated.

### §5, the memory agent — one real defect

The empty case is right: no `memory/` directory reads as *"Nothing recorded yet"* with what to do
about it, and that is the one errno where absent really is empty, because the directory is created
by whatever first writes to it.

Then the keeper was asked to record a decision. It wrote
`memory/decisions/2026-08-31-mit-licence.md` — frontmatter, reasoning, a *"why it matters"* — and
the panel went on saying **"Nothing recorded yet."** `readdir` was flat, and the loop's first line
skips anything not ending `.md`, so a *directory* was skipped in silence and the result was
indistinguishable from an empty memory. The keeper groups by kind, which is the sensible thing for
it to do, so this fires on the first thing anybody ever records. Fixed, and pinned by a test that
fails on a flat read.

### §6, connectors — holds, including the part that matters

Written correctly from the panel: `type: stdio`, the command split into `command` and `args`, and
`"WEATHER_API_KEY": "${WEATHER_API_KEY}"` — the **variable reference, never a secret**, which is
§6's whole rule. The list then distinguishes what it may touch: the new server as `stdio · project`
with a `Remove` button, and a machine-wide one as `http · user` with *"Declared outside this
workspace, so it is not this office's to remove."*

The safety property was driven rather than argued. `.mcp.json` truncated mid-object, then another
connector added: refused with *"`.mcp.json` is here and could not be parsed, so the office will not
write over it"*, the parse error, the line and column — **and the broken file left exactly as it
was.** Somebody's connectors survive a stray comma.

### §4, employees somebody else maintains — holds, including the hard case

Cloned a real second repository, listed what it offered, hired one. The agent landed and
provenance went to the sidecar: source, path, `hiredHash`, `hiredAt`. Offered again, the same name
is refused — *"This office already has somebody called data-scientist"* — rather than silently
overwriting.

Then both axes were moved, which is the case a single status cannot express:

| Changed | The office says |
|---|---|
| the local copy only | *"Edited here since hiring. Theirs is unchanged."* |
| both copies | *"They have changed theirs, and this copy has been edited here. Taking theirs would replace…"* |

Two independent facts, kept independent. A design that collapsed them into one status would have
called the second case *outdated* and offered an update that destroys somebody's edits without
saying so.

---

## What a clone had and an office did not

Three defects with one shape, and the third makes the shape worth naming: **a file tracked in this
repository, needed by every workspace, and seeded into none of them.** The manifest was built from
`git ls-files .claude` and nothing else, so everything else that a working office needs existed
only for people running from a clone — which is everyone who develops this and nobody who uses it.

| Missing from a fresh office | What it cost |
|---|---|
| `projects/_TEMPLATE` | `+ new project` refused. The product could not do the thing it is for. |
| `.gitignore` | `memory/`, `projects/` and `.office-space/` were all publishable by a push. The privacy panel said so, about a hole the office had left itself. |
| `CLAUDE.md` | **No agent in any installed office ever read the standing orders.** |

The last is the one to sit with. `CLAUDE.md` opens *"These rules govern every agent in this
workspace"* and states four of them, including *absent is not empty* — which that file calls the
mistake that has cost more than any other in the projects this office was built from. None of it
reached an office. The repository's own agents read it from the clone they were standing in, so
nothing looked wrong from here.

It also quietly undid a fix in flight: the one-command-per-Bash-call rule had just been moved out
of `manager.md` into `CLAUDE.md` so all seven agents would read it, into a file no installed office
has. That is what withdrew the measurement above.

All three are now seeded, and a check fails if any is dropped from the list. The general lesson is
cheaper than the three findings: **this repository is a bad place to test whether the product
works, because it is the one workspace that already has everything.**

### Closed by enumeration rather than by the next one biting

Three found one at a time is a bad way to find a fourth, so every tracked path in the repository
was classified instead: does a workspace need it, or is it ours?

| Ours, never seeded | Theirs, seeded |
|---|---|
| `.github/`, `src/`, `test/`, `scripts/`, `planning/`, `docs/`, `tsconfig*.json`, `package.json`, `package-lock.json`, `README.md`, `VISION.md`, `PLAN.md` | `.claude/`, `CLAUDE.md`, `.gitignore`, `projects/_TEMPLATE`, `projects/README.md`, `memory/README.md`, `assets/themes/README.md` |

`LICENSE` is in the left column deliberately and is worth saying out loud: seeding it would put
*this* project's licence at the root of somebody else's office, over work that is not ours.

Two more came out of the sweep, both files that code already expected and no office had.
`memory/README.md` is the one `memory.ts` excludes from being counted as a memory — *"It is
committed, and it explains the directory to a person"* — so that guard was protecting against a
file that never arrived, and `.gitignore` says the same from the other side with
`!memory/README.md` as its one exception. `assets/themes/README.md` says where a bought art pack
goes, in a directory `scanThemes` reads from the workspace root; without it the directory does not
exist and nothing in an office mentions that art is possible at all.

A fresh office is now exactly: `.claude/`, `CLAUDE.md`, `.gitignore`, `projects/` with its template
and README, `memory/README.md`, `assets/themes/README.md`, and the `.office-space/` it writes
itself. Checked the other way too — no `LICENSE`, `package.json`, `src/`, `test/`, `docs/`,
`VISION.md`, `README.md` or `PLAN.md` of ours leaks into it.

Two edges of that, because adding files to a seeding list is the kind of change that quietly
damages somebody:

- **A directory that is not a git repository at all.** Seeding works, and the privacy panel does
  not invent a warning: *"This workspace is not a git repository. Nothing is being pushed
  anywhere, and this becomes a real question the day it is."*
- **A workspace that already has its own `.gitignore` and `CLAUDE.md`.** Both left byte-identical,
  and the missing pieces seeded around them. That is `reconcile.ts` behaving as its header says —
  it may only move a file it can *prove* nobody has typed in — but the proof was worth watching
  rather than trusting, since the change that made those two files seedable was mine.

---

## The artifact somebody actually downloads

`npm run package` builds a directory; `npm run dist` builds the thing people install. Only the
first had ever been run here, because the second needs about 600 MB and this machine had 521 MB.
Clearing caches bought the room, and the DMG immediately found a defect the dev path could not.

**The manifest promised three files the package did not contain.** `CLAUDE.md`, `.gitignore` and
`memory/README.md` had been added to `SHIPPED` — what a new office is *seeded* with — and not to
`build.extraResources`, which is what is *in the bundle*. `reconcile.ts` reads the path it is told
about out of the installed app, so each one was a promise the package could not keep, arriving as
ENOENT and reported on first run as a file the office could not bring forward.

Every check of those three had passed, because `npx electron .` resolves the app root to this
repository, where all three exist. Opening the DMG showed three MISSING out of seven. The lesson
is the seeding lesson one level out, and it is the third time it has been the same lesson: **this
repository is a bad place to test whether the product works.**

Both lists are now held together by a check that fails when either drifts. Verified from the
shipped artifact rather than the dev path, on both architectures:

| | arm64 DMG | x64 DMG |
|---|---|---|
| the seven seed files | all present | all present |
| window contents | `Applications`, `INSTALL.txt`, `Fix permissions.command`, the app | same |
| binary | Mach-O arm64 | Mach-O x86_64 |

An installed copy driven from the built app seeds a workspace with all seven and reports nothing
it could not bring forward.

**The install experience holds too, and it is unusually honest.** `INSTALL.txt` names the exact
message each architecture will show — *"is damaged and can't be opened"* on Apple Silicon,
*"unidentified developer"* on Intel — says plainly that the app is not damaged, explains that
signing costs $99 a year and this project has not bought it, and points out that the usual
right-click-the-app trick gets past the second message and **not** the first. `Fix
permissions.command` handles every path it can fail on and refuses to print success if the flag
survives; run against an installed copy it reported the true before-state and the true after.

---

## Decision #2, built

It stopped being a design question when it was measured. The walk dispatched `builder`, `builder`
stopped on a gated command, and the floor read *"1 call needs you · 1 mid-task"* for **350
seconds** — the office working perfectly and saying so to an empty chair. Decision #1 covers the
office *going away* mid-wait; nothing covered it being open while you are not, which
`docs/the-queue.md` itself calls the normal state of this app.

The whole risk was the other direction. The approvals watcher ticks about every 400ms, so a
notification per tick is an alarm going off four times a second — roughly 600 of them about one
command across the four-minute wait. So the decision is `shared/nudge.ts` with nine tests, and
`main.ts` only performs it.

| | |
|---|---|
| A new call, nobody looking | announced once, naming who is blocked and what on |
| The same call, next tick | silent |
| Any call while the window has focus | silent — you are already reading the card |
| The badge | set whether or not you are looking, and cleared when the queue empties |
| `agent: null` | *"the manager"*, never "unknown" — the same rule the floor follows |

A notification is for somebody who is not looking; firing one at a person reading the card is the
office interrupting them to say what is on their screen. A badge is not an interruption, so it is
the dock agreeing with the floor either way. Clicking the notification shows and focuses the
window, because anything less tells you something is wrong and then makes you go and find it.

**What was not verified:** that macOS actually draws the banner. The code path was driven —
an approval raised against an unfocused window, no error anywhere in the main process, the hook
denying correctly at the end of its window — and the decision has its own tests, but whether the
notification *appears* is the platform's, and I did not watch it happen.

---

---

## Outstanding, and not ours to close

> **Closed on 2026-08-31: the owner chose MIT.** `LICENSE` is at the root and `package.json`
> declares it. The finding below is left as written — it was true when the sweep ran, and a record
> that quietly edits itself to look prescient is worth less than one that says when it stopped
> being true. See [the-licence-question.md](the-licence-question.md).

**There is no `LICENSE` file.** Not tracked, no `license` field in `package.json` (it is
`private: true`), nothing in the README, and none on any branch in the history. VISION.md §7 is
*"A GitHub repository anyone can clone as **their** Claude workspace"* — and with no licence,
legally nobody may. Which licence to choose is the owner's decision, so it is named here rather
than guessed at.

**What that decision is *not* encumbered by, checked rather than assumed:**

- **No third-party code ships.** `dependencies` is empty; the six `devDependencies` are build and
  test only. Nothing vendored, no `copyright` or `SPDX` line anywhere in `src/`.
- **No third-party art ships.** Zero tracked image, sprite, font or audio files — the floor, the
  characters and the props are drawn in code.
- **No munder-difflin code is present.** §8 warns its code is *"MIT (reusable with attribution)"*.
  Searched: not one attribution marker, and every match for *"derived from"* in `src/` is the
  ordinary English phrase in a comment. The warning is conditional on a reuse that did not happen.
- **`reference/` is gitignored** — the reference repos are read here and never shipped.

So the question is only *which licence*, with nothing to be compatible with. The zero-runtime-
dependency half is now pinned by `repo-health`, because that is how it would quietly stop being
true: a licence to honour, arriving in a diff nobody reads as a licence change.

Three product decisions remain open in [the-queue.md](the-queue.md), and re-reading them against
the code shrank two:

- **The approval gate's deny-vs-defer** stands exactly as written. `approval-gate.mjs` checks for
  a watcher once, before the wait, and never again across the 240 seconds that follow.
- **Whether a pending approval is noticeable** is half answered: it already surfaces *inside* the
  app as a workspace problem naming the count. Only the outside-the-window half is open.
- **The read-only reviewer** already has `git log`, `git show` and `git diff` — the whole of what
  that item said would turn *reads files* into *reviews changes*. Two entries remain and neither
  is needed to review a change.

All three are still the owner's; they are just smaller than they were.

### One that was reported as outstanding and is not

`PLAN.md`'s isometric block was carried for a while as *"a ticked line claiming a depth sort by
`x + y + z`, where `depthAt` computes `y`"*. Checked properly, that was wrong three ways.

The line is **`- [ ]`, unticked**, on this branch, on `dev`, and on `feat/isometric-floor`. The
warning that explains it sits directly above and names this exact entry as the sharpest example:
*"the entries below that describe rotation are not outstanding work; they were undone
deliberately."* And the block carries its own instruction — *"Left unticked and unedited below,
because a checklist rewritten to look finished would lose what was tried."*

The code is right and says why. `toScreenAt` puts `x` on screen-x only; depth is `y` and `z`
alone, because the floor is axis-aligned and seen from above rather than isometric. Sorting by
`x + y + z` would put a character further right in front of one further left on the same row,
which is not what the projection shows. `projection.ts` records the whole thing on the line above
`depthOf`: *"Isometric needed `x + y`; that is the other thing rotating the floor costs you."*

So there is nothing to fix, and editing it would contradict the section's stated purpose. The one
`- [x]` in that block names an `iso.ts` under the floor directory; that contract shipped as
[projection.ts](../src/shared/floor/projection.ts) once the rotation came out. The tick is true
about the work and historical about the name, which is exactly what a preserved checklist is for.

(Written without the full old path on purpose: `repo-health` requires every repo path the docs
name to exist, which is the right rule, and it caught this paragraph naming a file that has not
existed for weeks.)
