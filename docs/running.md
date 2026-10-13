# Running it

```bash
npm install
npm start
```

That builds and opens the app. If `claude` works in your terminal, it works here — there is no
key to set and nothing to log into. See [auth.md](auth.md).

By default the office is a window onto **this repository's own `.claude/`**, which is the whole
of the clone-it-and-it-works story: a fresh clone already has staff. Point it somewhere else
with `OFFICE_WORKSPACE`:

```bash
OFFICE_WORKSPACE=~/code/my-project npm start
```

## The roster is the workspace

Add a file to `.claude/agents/` and a desk appears, while the app is running. There is no list
of characters in the frontend to keep in step, because the renderer holds no list of its own —
`watchWorkspace` pushes a whole new snapshot and the floor is redrawn from it.

Anyone already on the floor keeps their position. Hiring does not rearrange the office.

## What the office is allowed to do

`claude -p` has no way to answer a permission prompt, so anything not pre-authorised is simply
refused — and an office in the strictest mode looks like a room full of people who cannot open a
file. It runs in `acceptEdits`, which is Claude Code's own everyday working mode.

```bash
OFFICE_PERMISSION_MODE=default npm start        # ask for everything (most tools will be denied)
OFFICE_PERMISSION_MODE=bypassPermissions npm start
```

## When the manager says it never dispatched somebody

If the office was closed while an employee was still working, that turn ended with a dispatch
and no result. Resuming drops the dangling call, so the manager comes back unable to see a
dispatch that is still sitting in its own transcript — and asked about that employee, it will
say it never sent them. It is not lying; that is what its context now holds.

Click the employee and open **Details**. That panel reads their own record from disk, which
survives the interruption the manager's memory does not.

## Trust the workspace, or the office cannot run anything

**Do this once per clone.** Claude Code ignores a workspace's `permissions.allow` until the
workspace has been trusted — it prints a line about it on stderr and carries on. From inside
Office Space that is indistinguishable from an allowlist that does not work: the staff can read
and write files, and are refused the moment they try to run a command. Including the commands
every task's VERIFY condition is made of, which is most of what the office is for.

```bash
cd /path/to/office-space
claude
```

Accept the trust prompt, then quit. The office checks on startup and says so on the floor if it
is still untrusted, so you will not be left guessing why nobody can run the tests.

It is deliberately not something the app does for you. That prompt is the control standing
between a repository you cloned and a shell on your machine, and it is yours to answer.

### What the office is allowed to do

`.claude/settings.json` ships an allowlist: this project's own verification commands, and
read-only inspection. Nothing in it reaches the network, deletes anything, or publishes
anything, and there is a matching deny list for the things that do.

Add your project's test command to it. Do not widen it to `Bash(*)` — at that point you have
`OFFICE_PERMISSION_MODE=bypassPermissions` with extra steps, and asking for that on purpose is
more honest than an allowlist that only looks like one.

## If the office says it cannot find `claude`

The app resolves `claude` itself — your `PATH` first, then where the installers actually put
it: `~/.claude/local`, each nvm or fnm node version newest-first, Volta, Bun, Homebrew. It does
that because a GUI application does not get your terminal's `PATH`. Launched from the Dock it
inherits `launchd`'s environment, which has no version manager in it at all, so a bare `claude`
resolves to nothing.

Worth knowing if you install with a version manager: `claude` lives under **the node version
that was active when you installed it**. Switch your default and a fresh terminal stops finding
it, while the office still will.

If it genuinely cannot find it, run `which claude` in your terminal and start the office with
that path:

## If you want to point at a specific `claude`

"If `claude` works in your terminal, this works" is true for almost everyone, and not quite
true for anyone whose install sits somewhere a GUI app's PATH does not reach — a launcher that
never sources a shell profile is the usual way to end up there. Point at it directly:

```bash
OFFICE_CLAUDE_PATH=/opt/homebrew/bin/claude npm start
```

`which claude` in your terminal prints the value to use.

Refusals appear in the transcript either way. A tool that was denied is a thing that happened,
and hiding it would leave you wondering why nothing changed.

## Working on the floor without spending anything

```bash
npm run build
npm run harness
```

Then open the URL it prints.

**Not `open dist/renderer/dev.html`**, which is what this said until 2026-08-28 and does not
work. `mock.js` imports `../shared/ipc.js`; opened directly, that resolves above the document's
root, every import 404s, the module never runs, and you get the app's chrome with an empty
office — the same picture as a build that failed to start. Nothing reports it, because the script
that would report it is the one that did not load.

It is served from `dist/` rather than `dist/renderer/` for that one reason, and `npm run harness`
is fifty lines of `node:http` so there is nothing to install.

### Driving it, and three ways to be wrong about what you see

The harness is the only way to exercise the office *working* — a message, a dispatch, somebody
walking to a desk — without spending anything. Point a browser at it with a debugging port and
drive the page.

The interaction the whole product rests on, verified this way on 2026-08-28: **clicking a person
on the floor asks them what they are doing and puts the answer in a bubble over their head.** Hit
testing picks the right person from a canvas click (`backend` and `builder` at their desks), the
manager is asked as `null` per `askAbout`'s declared signature, and the bubble carries the answer
and its Details button. Nothing to fix; recorded because a clean result that names what it
checked is worth as much as a finding.

Getting there cost three wrong conclusions, none of them about the app, and all three would have
been filed as defects by anybody in a hurry:

**`document.querySelector('canvas')` is not the floor.** The switcher draws a 16×16 avatar canvas
per row, and there are eight of them above the floor in document order. A click sweep against
that hits nothing, and the obvious reading is that the floor ignores clicks. Use
`.stage canvas`.

**A synthetic `click` is right here and wrong elsewhere.** The floor binds `click`. The command
palette binds **`mousedown`** on purpose — its input has focus and a click would blur it first —
so `.click()` on a palette row does nothing at all, correctly. Two sessions independently
concluded the palette was dead to a mouse before reading that comment.

**CDP `Input.dispatchMouseEvent` does not deliver a press to this app**, while
`Input.dispatchKeyEvent` works fine. Drive the mouse with
`dispatchEvent(new MouseEvent(..., { bubbles: true, cancelable: true }))` and the keyboard
through CDP. That asymmetry is specifically the mouse; if a *key* seems not to arrive, it is
something else and should not be explained by this.

The real renderer, the real floorplan, the real choreographer, the real character painter —
against a fake bridge driving a scripted session in the shape the CLI actually emits. No
Electron, no workspace, no cost. Use it for anything visual; every real call takes seconds and
costs money, and iterating on how a walk cycle reads at 2× against that loop is miserable.

It fakes the bridge and nothing else, which is the point: if it looks right there, it looks
right in the app.

### What the harness cannot catch

It is still a browser, and Electron is not one. Anything the two disagree about will work here
and fail in the app, silently:

- **`prompt()`, `alert()` and `confirm()` do nothing in Electron.** No dialog, no error, no
  console warning — the call returns and the code carries on as though you cancelled. The new
  project button shipped dead for exactly this reason, and looked perfect in the harness. Build
  the UI in the page instead.
- **A control inside a window drag region never receives its click.** Two parts of the chrome
  are `-webkit-app-region: drag` so the frameless window can be moved. On macOS that region
  swallows the click before the DOM sees it: the control renders, its listener is attached,
  nothing happens, and the console is clean. The voice toggle shipped exactly like that.
  `styles.css` now opts every interactive element out, so this should not bite again — but it
  is the reason a working button in the harness is not a working button.
- Anything to do with the real filesystem, the real `claude`, or the real menu bar.

So: use the harness for how it looks and how it moves, and run `npm start` before believing a
control works.

## Checks

```bash
npm test
npm run typecheck
```

`typecheck` runs twice, against two configs. The root one deliberately omits the DOM library so
that main-process code reaching for `document` fails to compile; `tsconfig.renderer.json` covers
the one directory that genuinely is a browser.

## Does the manager actually delegate?

```bash
npm run eval
```

`manager.md` spends forty lines arguing that dispatch is the default. Every test in this repo
checks that the *prompt says so*; none checks that the manager *does so*. This is the command
that checks the behaviour.

**It is not part of `npm test`, and it should not be.** Each scenario is a real `claude` run
against your real roster, it spends real money on your own subscription — about **$0.45** for the
five that ship — and it is not deterministic. The same request can be answered two defensible
ways.

What it measures is **what the manager did**, not why. A scenario that passes for a bad reason
still passes, and that is the honest limit: the office floor cannot see reasoning either, so this
checks exactly what you would have seen.

**Reading a failure.** One is the model being a model. **The same scenario failing twice is a
prompt that stopped working** — each one names the rule it is testing, so start by reading that
rule rather than by changing it.

It also catches the failure `manager.md` warns about and nothing else can see: a dispatch to an
agent with no desk. `Explore` and `general-purpose` are real and they work, and from the floor
they look exactly like not dispatching at all. Any name that comes back not on your roster is
flagged.
