# The first run, written down

**2026-10-01.** The first time anybody has run the packaged app the way somebody who has never
seen the repo would, and written down what happened rather than what was expected.

`docs/release-checklist.md` §3 calls itself *"the only test that matters, and the only one that
cannot be automated here"*. Nothing in `PROGRESS.md` had ever claimed it, all seven of its boxes
were unticked, and `PLAN.md` V4 was unticked for the same reason. This file is the answer to the
questions it asks, and to §5's, in the app's own words.

It is **not** a tick. Half of §3 needs a second machine or a second user account and a mounted
DMG; that half was not done and is listed under [What this did not answer](#what-this-did-not-answer).
A report is not a tick.

## How it was run

| | |
|---|---|
| Commit | `03fc994` — the tip of `dev` at the time, which was also `origin/dev` |
| Artifact | `npm run package` (`electron-builder --dir`), `release/mac-arm64/Office Space.app`, v0.0.1, arm64 |
| Build | `CSC_IDENTITY_AUTO_DISCOVERY=false`, so electron-builder does not probe the login keychain — this machine has a `Visprflow Dev` certificate in it and the probe raises a panel. Output: `skipped macOS code signing  reason=identity explicitly is set to null` |
| Host | macOS 15.2, arm64, Node v22.16.0, load average `{ 4.14 4.72 4.32 }` |
| Workspace | an empty directory under `/private/tmp/…/`, named by `OFFICE_WORKSPACE` |
| User data | a fresh directory under `/private/tmp/…/`, named by `--user-data-dir`. Measured: `~/Library/Application Support/Office Space` did not exist before and does not exist after |
| Reading the screen | the packaged binary with `--remote-debugging-port`, `document.body.innerText` and the first-run panel's text over CDP. The quotes below are that text, verbatim |

### Three deliberate deviations, each of which changes what you should conclude

**1. `HOME` was never touched, and that is why `OFFICE_WORKSPACE` was used instead.** An earlier
attempt at this task pointed `HOME` at an empty directory to fake a fresh machine. macOS keeps the
login keychain under `$HOME/Library/Keychains`, the app reaches `safeStorage` during startup, and
macOS raised a modal system panel — *"Keychain Not Found — A keychain cannot be found to store
'office-space Key'"* — on the real user's screen, twice. The app sat in the modal run loop,
ignored SIGTERM and needed SIGKILL. `docs/release.md` says `OFFICE_WORKSPACE` "wins in every
case", and it does.

**It therefore does not test the same code path as a stranger's first launch.** `workspace-root.ts`
rule 1 is *"`OFFICE_WORKSPACE` wins, always"*, so naming it skips the packaged seeding branch
entirely. That branch was run separately, with no `OFFICE_WORKSPACE` at all and a virgin
`--user-data-dir` — see question 1b.

**2. `--use-mock-keychain`.** Chromium's own switch for this. The app touches the keychain at boot,
and on *this* machine an item created by a differently-signed dev binary could raise an access
prompt. The switch removes an artifact of this machine rather than a first-run behaviour: on a
genuinely fresh Mac the item is created by the app asking for it and nothing appears. A fresh
account would settle that for certain, and did not happen here.

**3. No window was allowed to take the keyboard.** A previous agent's Electron window fronted
itself and swallowed the user's keystrokes into the app's composer. `OFFICE_HEADLESS=1` already
hid the Dock icon for exactly this class of reason; on this branch it also means
`focusable: false` and `showInactive()`. See [What was changed](#what-was-changed).

---

## 1. An empty workspace

**Pass.** It opens, and there is staff on the floor.

Status line, verbatim:

```
7 on the floor · 5 skills
```

The window titles itself `Office Space`, the transcript says *"The office is waiting. Say
something to the manager and watch the floor."*, and the workspace — empty when the app started —
has the shipped template in it afterwards: seven agents, six commands, five skills,
`.claude/settings.json`, the approval-gate hook, `projects/_TEMPLATE`, `memory/README.md`.

The checklist says *"if the floor is empty, seeding failed and the app should have said so"*. The
floor was not empty, so that sentence was not put to the test here.

The first-run panel raises one thing, and it is true:

> **A few things about this workspace**
> This workspace is not trusted, so the office verifies nothing here on its own · *worth knowing*
>
> Claude Code ignores a workspace's allow rules until you trust it, though it still applies its
> deny rules. The staff can still read and write files, but every VERIFY condition is a command,
> so the office runs none of them on its own: checks come back not checked, or refused where a
> deny rule covers them, rather than passing or failing. Run claude once in this directory and
> accept the prompt.

No quarantine line, which is correct: the artifact was built here, not downloaded, so there is no
quarantine flag to warn about. The quarantine box in §3 is therefore **not answered** by this run.

### 1b. The packaged seeding path, with no `OFFICE_WORKSPACE`

**Pass**, and this is the one that matches a stranger's launch. No `OFFICE_WORKSPACE` in the
environment, a virgin `--user-data-dir`:

```
7 on the floor · 5 skills
```

The workspace was created at `<userData>/workspace` with the seven agents in it, and
`resolveWorkspaceRoot` reported no `problem`. Nothing in the panel about seeding, because nothing
about seeding went wrong.

## 2. `claude` not on PATH

**Two answers, and the second one is a failure.**

**What happened when asked:** relaunched with `PATH=/usr/bin:/bin`, the app found `claude` anyway
and said nothing about it — because the resolver is built to look past `PATH`, which is the entire
point of `claude-path.ts`. It found `~/.nvm/versions/node/v22.16.0/bin/claude` under
`how: 'installed'`. That is the module working as designed, and a bare `PATH` is not enough to
reach the failure message on a machine that has `claude` installed under `$HOME` or Homebrew.

**What the failure message actually says**, driven out of the shipped build — `dist/main/claude-path.js`
extracted from `app.asar` — with `launchd`'s own `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`, what an
app opened from the Dock inherits) and a home with nothing installed:

```
The office cannot find the `claude` command, so nobody here can do anything. Looked in 10 places.
If `claude` works in your terminal, the app is not seeing the same PATH your shell does — which is
normal for an app launched from the Dock. Run `which claude` in your terminal and start the office
with OFFICE_CLAUDE_PATH set to what it prints.
```

Ten places were looked in. **Not one of them is named.** The checklist says *"the app names every
path it looked in — check that list rather than guessing"*, and there is no list to check. The
module's own header promises *"I looked in these six places and it is in none of them"* and calls
the alternative useless.

It was not a rare branch. `missingMessage` showed the list only at six entries or fewer, and
`installedLocations` returns at least six candidates on any POSIX host *before* a single `PATH`
entry is counted — so the only inputs under the threshold were an explicit `OFFICE_CLAUDE_PATH`
(one path) and an empty `PATH`. **Every realistic failure took the branch that prints a number.**

This is fixed on this branch. See [What was changed](#what-was-changed).

Worth saying plainly: this is not the app lying. It is the app being useless at the one moment the
checklist sends a stranger to it for help.

## 3. An unreadable staff directory

**Pass, emphatically.** The best thing in this report. `chmod 000` on the seeded `.claude/agents/`,
relaunch. Status line:

```
staff could not all be read · 5 skills
```

> **The office cannot work yet**
> The staff could not be read, so the office cannot answer you · *blocked*
>
> There may be employees in .claude/agents/ — this office could not open it to find out, so it has
> nobody to act as the manager. Check the permissions on that directory. Whatever is in there has
> not been changed.

And then, once per file it knew about and could not open:

> **Something here could not be read** · *worth knowing*
>
> .claude/agents/manager.md exists and could not be read, so whatever is in it is not on the floor.
> This is not the same as it being empty.

"There may be employees", "could not open it to find out", "this is not the same as it being
empty", and a status line that says *could not all be read* rather than a number. Nothing anywhere
on screen claims there is no staff.

## 4. A broken settings file

**Pass.** A syntax error written into the seeded `.claude/settings.json`
(`{ "permissions": { "allow": [ "Read" ,,, }`), relaunch:

> **The office noticed something** · *worth knowing*
>
> .claude/settings.json exists but could not be read as settings, so its permission rules are not
> in force — this looks exactly like having none. Unexpected token ',', ..."[ "Read" ,,, } " is not
> valid JSON

It names the difference between unreadable and empty in the sentence itself — *"this looks exactly
like having none"* — and quotes the parser. It also propagates the unknown one step further rather
than guessing:

> **Whether commands are being approved is unknown** · *worth knowing*
>
> The approval gate could not be checked, so whether commands are being approved is unknown:
> Unexpected token ',', ..."[ "Read" ,,, } " is not valid JSON The gate is two files:
> .claude/hooks/approval-gate.mjs, and the PreToolUse entry in .claude/settings.json that calls it.
> The office does not put either back on its own, because a file you removed is one you meant to
> remove.

Zero rules is never reported. The floor stayed at `7 on the floor · 5 skills`, which is correct —
the agents were readable; the settings were not.

## 5. `ANTHROPIC_API_KEY` set

**Pass.** Launched with `ANTHROPIC_API_KEY=x`. In the panel at startup, before anything could be
spent:

> **The office noticed something** · *worth knowing*
>
> ANTHROPIC_API_KEY is set in this environment, so requests are billed at API rates instead of on
> your subscription. Run `unset ANTHROPIC_API_KEY` and restart Office Space to use the subscription
> you are already paying for.

## 6. Nothing personal in the artifact

**Pass on substance. One box is worded so that a reader would call a pass a failure.**

`Contents/Resources/app/` in full:

```
.claude/agents/{backend,builder,frontend,manager,memory-keeper,reviewer,tester}.md
.claude/commands/{decision,gotcha,handoff,plan,state,verify}.md
.claude/hooks/approval-gate.mjs
.claude/settings.json
.claude/skills/{explore-options,meet,plan-together,record-progress,write-a-task}/SKILL.md
.gitignore
CLAUDE.md
assets/themes/README.md
memory/README.md
projects/README.md
projects/_TEMPLATE/{PLAN,PROGRESS,TASKS}.md
```

- `projects/` holds `_TEMPLATE` and the README and nothing else. **Pass**, exactly as written.
- No `.env`, no credentials, no copy of `~/.claude.json`. **Pass** — a search of the whole bundle
  for `.env*`, `claude.json`, `*credential*`, `*secret*`, `*.pem`, `*.key`, `id_rsa*` and `*.p12`
  returned nothing, and `app.asar`'s 197 entries are all code.
- `memory/` is **not absent**. It holds `README.md` and nothing else, which
  `build.extraResources` ships on purpose, and the file is the template's own explanation of the
  directory — *"the one directory that is yours alone"*. Nothing personal is in it.

So the artifact is clean and the checklist's box — *"`memory/` is absent"* — is false about a build
that passed. Reworded on this branch rather than left to be rediscovered.

## 7. Quitting with a run in flight

**Pass**, and it cost nothing. `OFFICE_CLAUDE_PATH` pointed at a stand-in `claude` that writes
nothing and sleeps, so the run was genuinely in flight — a real child process the app started and
was tracking — with no request made to Anthropic. The same arrangement `test/fake-claude.ts` uses:
the adapter is the shipped one, only the program on the other end is fake.

The child the app started, verbatim from `pgrep -fl` (argv truncated at the prompt):

```
17461 node /private/tmp/…/firstrun-stub-…/claude --print --output-format stream-json
  --verbose --session-id 32278d00-… --agent manager --disallowedTools Task Write Edit
  --include-partial-messages --permission-mode acceptEdits -- ## CURRENT PROJECT …
```

Then `app.quit()`, which is the path that runs `before-quit`. On stdout:

```
Office Space: stopped 1 running process(es): claude (2384e959)
```

`pgrep` for the stand-in afterwards returned nothing. It says how many it stopped, names it, and
leaves nothing behind.

A note on method, because it bears on how a person would do this: the quit had to be called in the
main process over `--inspect`. There is no signal handler, so SIGTERM skips `before-quit` entirely
— the app has a `orphans-stopped` notice for exactly that case, reported by the *next* office —
and Cmd-Q was unavailable because the window was deliberately made unfocusable for this run.

---

## Does this app call `safeStorage` itself, or is that Electron?

**It calls it itself, deliberately, and at startup.** Measured, by reading the shipped source:
`src/main/spotify/store.ts` imports `safeStorage` from `electron` and uses it to encrypt the
Spotify refresh token, which its own header calls *"the only long-lived secret this app has ever
held"*. The decision is documented and sound: the keychain rather than a file, and a refusal to
store rather than a plaintext fallback.

What is not documented is **when**. `main.ts` constructs the client and then calls
`void spotify.connected()` during handler registration, which reaches `store.read()` →
`canRemember()` → `safeStorage.isEncryptionAvailable()`. So the keychain is touched on **every
boot**, including a first boot by somebody who has never heard of the music feature and whose
account is not connected — and `client.ts` says of that feature *"Off by default. Nothing here
runs until an account is connected."* The keychain call is the exception to that sentence.

That is what the earlier attempt's modal panel was: not Chromium initialising its own store, but
this line, on a machine whose login keychain could not be found. Queued as task 98 rather than
fixed here — it is a change to when a subsystem initialises, which is not a wording fix.

Consequence for `README.md`: *"There is no server, no database, and no API key"* was the only
sentence in it about secrets, and the README never mentioned the music feature or the keychain at
all. The sentence is true about Claude — there is no key to set — and was being read as "holds
nothing". Qualified on this branch.

---

## What was changed

Three fixes, all of them wording or presentation. Nothing architectural.

1. **`missingMessage` names the paths again** (`src/main/claude-path.ts`). The count is kept beside
   them. Test first: `test/claude-path.test.ts` → *"every place looked is named in the message,
   however many there are"*, which failed with `the message does not name /usr/bin/claude, so the
   list has to be guessed` before the change and passes after. The sibling test one line above it —
   *"when there is nothing, every place looked is reported"* — passed throughout, because it reads
   `found.looked` rather than the sentence a person is shown.
2. **The checklist's `memory/` box says what a clean build looks like** (`docs/release-checklist.md`
   §2), and §3 points at this file without ticking anything.
3. **`README.md` names the one secret that exists**, and says the `safeStorage` call is the app's
   own.

And one change that is not a product fix but is why this run was safe:

4. **`OFFICE_HEADLESS=1` now means the window cannot take the keyboard** (`src/main/main.ts`):
   `focusable: false` at construction, `showInactive()` instead of `show()`. The Dock-hiding
   comment two screens below it already argues the principle — *"A development instrument may not
   be indistinguishable from a bug in the product it is checking"* — and this is the same fault one
   degree worse: a driven boot fronted itself and the keystrokes of the person at the keyboard went
   into the app's composer.

## What this did not answer

Each of these is a §3 box that stays unticked, and why.

- **A different machine, or a fresh user account.** Never done. No session on this machine has run
  `sysadminctl`, `dscl` or `createhomedir`, so a second account has never existed. Everything above
  ran as the user who built the artifact, which is the one thing §3 asks you not to do.
- **The DMG.** `npm run package` builds `--dir` and produces no DMG, so `INSTALL.txt`,
  `Fix permissions.command`, the drag to `/Applications` and the before/after flag print were not
  looked at. They need `npm run dist`.
- **Quarantine.** The artifact was built here, so it carries no quarantine flag. The *"damaged and
  can't be opened"* path and the first-run panel's one line about `xattr -cr` were not seen.
- **§4 entirely** — streaming, queueing, stop with something queued, the `/` menu, clicking somebody
  on the floor. Every one of them spends money. Question 7's stand-in `claude` emits nothing, so it
  can prove a process was started and stopped and nothing about a reply.
- **§6** — cost accumulating across turns, and the plan-limit notice. Same reason.
- **Whether a first launch on a Mac with no keychain item prompts.** `--use-mock-keychain` was used
  precisely so it could not, on this machine. A fresh account would settle it.
