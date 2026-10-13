# The release checklist

Run this before handing the app to somebody who has never seen the repo. It is written as
questions with commands rather than as steps, because a step gets ticked and a question has to
be answered.

## 1. It builds and it is honest about itself

```bash
npm ci && npm run typecheck && npm test && npm run build
```

- [ ] Both typecheck configs clean — the renderer has its own, and checking one without the
      other has let a renderer-only error through before.
- [ ] Every test passes. **Not "all but one".** A known-failing test is a test nobody reads.
- [ ] CI is green on the same commit. It runs on Linux; we develop on macOS, and it has already
      caught a bug that passed here for weeks.

      Ask whether it *ran*, not only whether it passed. A workflow can be switched off in the
      repository's settings while its file sits in `.github/workflows/` looking like cover — and
      on 2026-08-26 it was: `state: disabled_manually`, with nothing having run since 20 August
      and twenty-seven commits on `dev` in between. "No failures" and "no runs" are the same
      colour from a distance.

      ```bash
      gh api repos/slug-labz/office-space/actions/workflows --jq '.workflows[] | "\(.state)\t\(.name)"'
      gh run list --limit 3
      ```

      The first must say `active`. The second must name the commit you are about to ship.

      Re-enable with `gh workflow enable checks.yml` — but find out why it was turned off before
      you turn it back on. Somebody did that on purpose.

## 2. Nothing personal is in the artifact

```bash
npm run dist
```

- [ ] `test/persistence.test.ts` passed. It checks the packaging config against the list of
      what is personal, and it has already caught `projects/` being shipped wholesale — which
      would have handed the builder's own plans to everybody who installed.
- [ ] Unpack the artifact and look. `memory/` holds **`README.md` and nothing else** — the
      template ships that one file deliberately, and `build.extraResources` names it, so a reader
      who expects the directory to be absent will think the check failed when it passed. Anything
      beside it is somebody's own notes. `projects/` contains `_TEMPLATE` and the README and
      nothing else.
- [ ] No `.env`, no credentials, no `~/.claude.json`.

## 3. It runs on a machine that has never seen the repo

The only test that matters, and the only one that cannot be automated here.

Answered in part on 2026-10-01, against a packaged `--dir` build on the machine it was built on:
[first-run-report.md](first-run-report.md) has the app's own words for every question below that a
virgin **workspace** can ask. The boxes stay unticked, because the half that needs a second account
and a mounted DMG was not done — a report is not a tick.

- [ ] Copy the artifact to a different machine — or a fresh user account, which is the cheap
      version.
- [ ] It opens. On macOS, if it was downloaded through a browser it will report itself as
      *"damaged and can't be opened"*: that is quarantine, not corruption, and the fix is the
      `xattr` line in [release.md](release.md). Ad-hoc signing is a deliberate decision, not an
      oversight.
- [ ] **Mount the DMG and look at the window.** `INSTALL.txt` and `Fix permissions.command` are
      in it, beside the app. A release that ships without them hands a stranger the "damaged"
      dialog and nothing else — which is the whole reason those two files exist.
- [ ] Right-click → Open `Fix permissions.command` from the mounted image, before dragging the
      app across. It says the app is not in Applications yet and to drag it first. Then drag,
      run it again, and it prints the flag before and its absence after.
- [ ] Open the app while it is still flagged. The first-run panel raises one line about
      quarantine with the `xattr -cr` command on it — a **warning**, not a takeover, because the
      app it is talking about has plainly launched.
- [ ] The office has staff on the floor. A packaged first run seeds a workspace from the
      template; if the floor is empty, seeding failed and the app should have said so.
- [ ] `claude` is found. If not, the app names every path it looked in — check that list rather
      than guessing.

## 4. It does what it says

- [ ] Send a message. The reply **streams** rather than arriving whole.
- [ ] Type a second message while the first is running. It queues, and the composer says so.
- [ ] Press stop with something queued. It says which messages did not run.
- [ ] Type `/` in the composer. The menu lists this workspace's commands *and* skills.
- [ ] Click somebody on the floor. What they say and what they did are visibly different things.

## 5. It does not lie when things go wrong

The office's whole claim, and the part worth spending the most time on.

- [ ] Rename `.claude/agents/` and rescan. It says the directory could not be read — **not**
      that there is no staff.
- [ ] Put a syntax error in `.claude/settings.json`. It reports an unreadable settings file
      rather than reporting zero rules.
- [ ] Export `ANTHROPIC_API_KEY=x` and start it. It warns before spending anything.
- [ ] Quit with a run in flight. The terminal says how many processes it stopped, and
      `ps aux | grep claude` shows none left behind.

## 6. What it costs is visible

- [ ] The cost under the composer accumulates across turns.
- [ ] Near a plan limit, the office says so — and says when it resets.

## What is deliberately not on this list

- **Notarisation.** No Apple Developer membership; decided, documented, deferred.
- **Windows.** Neither machine has one to test on. The rule is "no POSIX assumptions", checked
  at review and in `test/claude-path.test.ts`, not "it works".
- **Auto-update.** Needs a signed app and a feed to host.
