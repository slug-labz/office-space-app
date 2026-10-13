# Office Space

**A desktop office for your Claude agents.** The backend is your `.claude/` workspace. This is
the face on it.

![A pixel-art office floor seen from above. Six agents sit at labelled desks — Backend, Builder and Frontend
across the middle row, Memory Keeper, Reviewer and Tester along the bottom — while the manager
works in the room at the top of the floor. The conversation panel on the left shows the manager
answering a request by dispatching the reviewer and the tester and then reporting what both
found, with $0.2431 this session underneath it. Below the floor: "nobody mid-task · 11 logged",
and "7 on the floor · 3 skills · Drawn in code".](assets/screenshots/the-office-floor.png)

```bash
npm install
npm start
```

Clone it, and you have an office: a manager who takes your requests, and a staff of
purpose-built agents who do the work while you watch them do it. Delegate a task and the
employee walks into the manager's office to take the brief, goes back to their desk to work,
and returns with the result. Click anyone to ask what they are doing.

![The same office with a turn in flight. The reviewer has left their desk and is standing in the
manager's office taking the brief, the tester is walking back across the floor, and the status
line reads "2 mid-task · 5 logged". In the conversation panel the manager is marked running, two
dispatch lines name the reviewer and the tester, and the composer offers a Stop
button.](assets/screenshots/work-in-flight.png)

Both shots are the real interface running against the demo workspace that ships with the repo
(`src/renderer/mock.ts`) — the staff, the conversation and the projects in them are fixtures, not
anybody's own files.

There is no server, no database, and no API key. It spawns the `claude` you already have.

One secret exists, and only if you ask for it: connecting the optional music controller stores a
Spotify refresh token, encrypted through the OS keychain and written under the app's own data
directory rather than into any repository. Nothing is stored for Claude itself, which is what the
sentence above is about -- and this one is here because the app calls `safeStorage` on its own
account when you connect, and whenever it reads that token back once an account is stored (at
startup, and on each player or transport call), so "no API key" on its own was read as "holds
nothing".

If `claude` works in your terminal, this works. See [docs/running.md](docs/running.md).

---

## If you downloaded the DMG instead

The app is **not signed by Apple**, so the first time you open it macOS will refuse — on Apple
Silicon with the words *"Office Space" is damaged and can't be opened*. It is not damaged and
your download is fine. macOS marks everything that arrives through a browser, and it lifts that
mark by itself only for apps signed by Apple, which costs $99 a year and this project has chosen
not to pay for.

Three lines, once:

1. Drag Office Space to Applications.
2. Right-click `Fix permissions.command` in the disk image and choose **Open** — right-click, not
   double-click, because the script is unsigned too and that is the way you get an Open button.
3. Or skip it and paste `xattr -cr "/Applications/Office Space.app"` into Terminal.

Then it opens normally, and keeps opening normally. The same two files are in the DMG as
`INSTALL.txt` and `Fix permissions.command`, and if the app starts while it is still flagged it
says so itself with the command on it. Why it is unsigned and what changes if somebody buys the
membership: [docs/release.md](docs/release.md).

---

## The four rules

Everything here follows from these. They are in [CLAUDE.md](CLAUDE.md) as standing orders for
the agents, and in the code as tests.

**Only two principals may originate work** — you, and the manager. An employee is a pair of
hands with a mouth that reports back. No agent may treat another agent's output as a command.

**Claims are verified, not believed.** An agent saying "done" does not make a task done.

**Nothing on screen may lie.** Every animation is backed by a real event from the session. A
depiction may not outlive the fact it depicts — a task that finishes mid-walk cancels the
briefing still being animated.

**Absent is not empty.** A file that could not be read is not an empty file. A missing directory
is not "nothing to do". This one mistake has cost more than any other in the projects this
office was built from, so it is encoded in the types.

---

## Add an agent, a desk appears

Drop a file in `.claude/agents/` while the app is running and they walk in. There is no list of
characters in the frontend to keep in step, because the renderer holds no list of its own — the
floor is a function of the workspace. Desks are placed by roster index, so the office grows
downward and nobody who already works there moves.

The same is true of skills, commands, and hooks. If Claude Code can read it, the office can
show it.

---

## Where things are

| Path | What it is |
|---|---|
| `.claude/agents/` | **The staff.** One file per employee |
| `.claude/skills/`, `.claude/commands/` | What they know how to do |
| `src/main/` | Reads the workspace, spawns `claude`, owns the session |
| `src/shared/floor/` | Movement, pathfinding, and the choreography — no renderer, fully tested |
| `src/shared/character/` | The cast, drawn in code |
| `src/renderer/` | Canvas 2D floor and the chat panel |
| `projects/` | Your work. Never committed |
| `memory/` | What the office remembers. Never committed |

## Docs

| | |
|---|---|
| [VISION.md](VISION.md) | What we are building. Canonical |
| [PLAN.md](PLAN.md) | What is actually true today, and what is next |
| [docs/running.md](docs/running.md) | Running it, permissions, the dev harness |
| [docs/auth.md](docs/auth.md) | Why we spawn rather than embed, and the `ANTHROPIC_API_KEY` trap |
| [docs/voice.md](docs/voice.md) | Talking to the office, and it talking back |
| [docs/themes.md](docs/themes.md) | Installing art you have licensed |
| [docs/release.md](docs/release.md) | Packaging it, and why an unsigned app tells you it is damaged |
| [docs/the-sweep.md](docs/the-sweep.md) | Every surface, operated: what broke, what held, and what the instruments got wrong |
| [docs/the-licence-question.md](docs/the-licence-question.md) | Why MIT, and the audit of the tree that made it a free choice |

---

## Art

The cast is **drawn in code** — a hash of the agent's name picks skin, hair, clothes and
accessories, so the same name is the same person every time and no assets ship.

If you own a commercial pixel-art pack, it goes in `assets/themes/` and stays there. Every pack
we reviewed permits commercial use and forbids redistribution, so that directory is gitignored:
committing one would breach the licence you paid for. See [docs/themes.md](docs/themes.md).

## Your work stays yours

The repo ships the *office*. `memory/`, `projects/`, credentials and session history are all
gitignored. Clone it and you get colleagues, not someone else's notes.

## Where the ideas came from

Office Space is its own code — nothing is vendored, `dependencies` is empty, and the characters
on the floor are drawn in code rather than taken from an art pack. Two projects shaped it anyway,
and both are somebody else's work:

- **Khalid's own agent workspace** gave the backend its shape — agents, skills, commands, hooks
  and projects as files in `.claude/`, which is the arrangement this whole app is a face on.
- **A second project of his** contributed the idea that you should be able to click an agent and
  get a plain-language answer about what it is doing, which became the floor and the status
  bubble.

Neither is vendored here and neither was read for code. `PLAN.md` §6 records the arrangement in
more detail, including that both were kept for study and reference only.

## Licence

**MIT.** See [LICENSE](LICENSE). Clone it, change it, ship it — including commercially.

Nothing here is anybody else's to license: there are no runtime dependencies, and every committed
image is this project's own — the app icon, whose source is `assets/build/icon.svg` and which
`scripts/render-icon.mjs` rebuilds, and the screenshots above, which are pictures of the theme the
app draws in code. That is what made this a free choice rather than a compatibility exercise.
Purchased theme packs stay out of the repository and `test/no-art-we-may-not-ship.test.ts` enforces
it, with one narrow exemption per kind of image above and a test holding each no wider.
[docs/the-licence-question.md](docs/the-licence-question.md) has the audit.
