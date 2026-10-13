# Releasing Office Space

## What you get

```bash
npm run package   # a .app / AppImage in release/, no installer — fastest way to check it runs
npm run dist      # the real artifacts: a DMG per architecture, an AppImage
```

Both build first, so there is no separate step to forget.

## The workspace moves when the app is packaged, and that is deliberate

Run from a clone, the repo **is** the office: `.claude/` sits beside `dist/`, and a fresh clone
has seven staff on day one.

A packaged app cannot do that. `dist/` lives inside `app.asar`, which is **read-only**, and a
workspace is not a read-only thing — hiring writes an agent file, the registry writes sessions, a
project is a directory somebody makes. So on first run the app **seeds a real workspace** under
its user-data directory and works there:

| Platform | Where |
|---|---|
| macOS | `~/Library/Application Support/Office Space/workspace` |
| Linux | `~/.config/Office Space/workspace` |

It seeds **once**. A second run — and every update after it — leaves that directory alone. An
upgrade that restored our copy of an agent file somebody had edited would be the worst bug this
app could ship: silent, destructive, and indistinguishable from "the app reset itself".

Point it anywhere else with `OFFICE_WORKSPACE`, which wins in every case.

## macOS: it is not signed, and here is exactly what that costs

There is no Apple Developer membership on this account, so the app is **ad-hoc signed**. Decided
deliberately — signing is a $99/year purchase and can be made whenever somebody wants to hand
this to a stranger.

Copied directly — AirDrop, a USB stick, `scp` — it opens normally.

**Downloaded through a browser it will not**, and the failure does not look like a security
prompt. macOS quarantines it and says:

> **"Office Space" is damaged and can't be opened. You should move it to the Trash.**

That reads as a corrupt download. Worse, the advice everybody gives for unsigned apps —
right-click, then Open — **does not work on a quarantined app**. The only fix is to remove the
quarantine flag:

```bash
xattr -cr "/Applications/Office Space.app"
```

Give people that line, not "right-click and open".

`-cr`, not `-d com.apple.quarantine`, which is what this file said until somebody read it
carefully. `-d` deletes one attribute from one path, and quarantine is written **through** a
bundle — on the `.app` directory and on files inside it. Clearing only the top level leaves the
executable flagged, so the app is refused a second time by a command that appeared to work. `-c`
clears every extended attribute and `-r` walks the bundle; together they are the line that
actually finishes the job.

### The DMG says all of this itself

Nobody downloading a release reads this file, so the three lines above ship **inside the disk
image**, next to the app, where somebody meets the problem:

| In the DMG | What it is |
|---|---|
| `INSTALL.txt` | Drag to Applications; expect to be refused; here is why, and here are two ways to clear it |
| `Fix permissions.command` | Double-clickable. Runs the `xattr -cr` line and prints what it found before and after |

Both are in `assets/dmg/`. The card names the price out loud — an Apple Developer membership is
$99 a year and this project has not bought one — because "a security setting is preventing this"
is true, useless, and reads as blaming macOS for a bill we chose not to pay.

**`Fix permissions.command` has to be opened with right-click → Open**, and the card says so.
The script is unsigned too, so double-clicking it hits the same wall the app did. The difference
is that for a plain script macOS offers an Open button, and for an ad-hoc signed app it does
not — which is the one place the usual right-click advice is worth giving.

The script keeps its executable bit through packaging: electron-builder's `copyFile` preserves
mode and widens execute to all when the owner has it. It refuses gracefully when
`/Applications/Office Space.app` is not there — the likely case, somebody running it before
dragging the app across — and says to drag first rather than reporting a missing file.

### And the app says it too, once

If the installed bundle is still flagged when it starts, the first-run panel raises a
`quarantined` step with the `xattr -cr` line for **the path it actually found**, so a copy
living somewhere other than `/Applications` gets a command that works. `src/main/quarantine.ts`
does the detection and `src/shared/first-run.ts` writes the step.

A warning, never a blocker: the app raising it has plainly launched, and taking the floor over to
argue otherwise would be the office lying about its own state. Getting past Gatekeeper once and
clearing the flag are different acts — approving the app leaves the attribute exactly where it
was, so the same wall stands for the next update and for anyone they hand the app to.

Off macOS the step never appears, and it appears nowhere else it has not earned. `quarantine.ts`
answers with one of four states — flagged, checked-and-clean, no-such-question (not macOS, or run
from a clone), and could-not-check — and **only the first of them says anything**. The other
three are silent for three unlike reasons, and collapsing any of them into "clean" would be the
office reporting a check it never ran.

### When somebody buys the membership

Two changes, both small: set `build.mac.identity` in `package.json` to the Developer ID, and add
a notarize step. Nothing else about the build changes — which is why it was worth setting
`identity: null` explicitly rather than leaving it out. Omitted means *search the keychain and
fail confusingly*; `null` means *ad-hoc, on purpose*.

## What ships inside

| | |
|---|---|
| `dist/**` | The app |
| `.claude/`, `projects/`, `assets/themes/` | **Extra resources**, not in the asar — the template a first run copies out of |
| `assets/dmg/` | Not in the app at all — the install card and the fix script, laid out in the DMG window beside it |

They are outside the archive because they are copied *from*, and because a user who wants to see
what shipped should be able to look without unpacking an asar.

## What is not here yet

- **Windows.** Neither machine has one to test on, and an exit condition nobody can run is an
  aspiration with a checkbox. The rule instead: no path handling, spawn or storage code assumes
  POSIX. That keeps the port cheap without claiming it works.
- **Auto-update.** Needs a signed app and somewhere to host a feed.

## The build config, annotated

`package.json`'s `build` field cannot carry comments. It looked as though it could — three
`_comment_*` keys sat in it for weeks — but **electron-builder validates that object against a
strict schema and rejects unknown properties**, so `npm run dist` and `npm run package` failed
before they started. No artifact had ever been produced. The convention was borrowed from
`.claude/settings.json`, which is plain JSON that nothing validates; here it was inert and fatal.

The reasoning that lived in those keys, kept:

### `files` — what goes inside the archive

`dist/` is the app. That is all that belongs in `app.asar`.

### `extraResources` — the template, and only the template

`.claude/` and `projects/_TEMPLATE` are copied to `Contents/Resources/app/`, **beside** the
archive rather than inside it, and a packaged first run seeds a real workspace from there once.

**`projects/` as a whole is deliberately not shipped.** It holds the work of whoever built the
app — their plans, progress and task lists — and shipping it would hand that to everybody who
installs. `memory/` is not shipped and must never be. `src/main/persistence.ts` lists every store
and which side of that line it is on, and `test/persistence.test.ts` checks this config against
that list on every run.

Two filters exist for reasons found by building an artifact and looking inside it:

- **`!settings.local.json`** — that file is gitignored, because it is a machine's own config
  rather than the project's. `extraResources` copies directories wholesale, so it shipped. On
  this machine it held three disabled MCP server names; on another it carries permissions and
  environment.
- **`assets/themes` ships `README.md` only.** The art packs are purchased and **every commercial
  licence we priced forbids redistribution** — which is why the directory is gitignored and why
  `docs/themes.md` promises *"they never leave your machine."* Copying the directory wholesale
  put 14MB of licensed art into every artifact and broke that promise.

`test/persistence.test.ts` now enforces the general rule: **if git is told to ignore it, it is not
ours to hand out.**

### `mac.icon` and `linux.icon` — named, not left to convention

`assets/build` is `buildResources`, and for some targets electron-builder will find
`icon.png` there on its own. Both targets name it anyway, because the convention is a silent
failure: `build.mac` carried `identity`, `category`, `target` and `extendInfo` and no `icon`,
and the Dock showed Electron's default while a perfectly good PNG sat in the repo. Nothing
reported it. Naming the path costs one line and takes the convention out of the chain of
things that have to be true.

One 1024x1024 PNG is the whole source. electron-builder 25 generates the macOS `.icns` ladder
and the Windows `.ico` from it. 1024 is the size the ladder needs rather than a preference: the
`.icns` this config produces carries a `512x512@2x` entry, which is 1024 pixels square, so
anything smaller could only be upscaled into it. There is no Windows target here
yet; when there is, `build.win` needs the same line, and `test/icon.test.ts` asserts that if a
`win` block exists it names an icon.

The PNG is rendered from `assets/build/icon.svg`, which is the art:

```bash
node_modules/.bin/electron scripts/render-icon.mjs
```

Electron rather than a converter, because `dependencies` is empty and has to stay that way —
a rebuild step that needs `rsvg-convert` or ImageMagick is a rebuild step most clones cannot
run. Electron is Chromium, which is the same SVG engine the renderer draws the floor with.

`test/icon.test.ts` holds the wiring: the config names the icon, git tracks the file it names,
and that file is a 1024x1024 RGBA PNG whose pixels are present and are not a flat fill.

### `dmg.contents` — where the install card goes, and why not the other two places

`INSTALL.txt` and `Fix permissions.command` are listed in `dmg.contents`, which is the array
that lays out the icons in the disk image window. There were three candidates and only one of
them is right:

- **`extraResources`** copies into `Contents/Resources/` — *inside the app bundle*. That is
  inside the thing the reader cannot open yet, which is the entire problem the card exists to
  solve. A fix sealed inside the broken box.
- **`extraFiles`** copies into `Contents/` — the same objection, one directory up, plus it lands
  on Linux too, where `com.apple.quarantine` does not exist and the card would be nonsense.
- **`dmg.contents`** puts them in the window somebody is already looking at while they drag the
  app across. Mac-only by construction, and read at the one moment they are about to need it.

Overriding `contents` replaces electron-builder's default layout rather than adding to it, so
the app and the `/Applications` symlink are listed again here — dropping either would ship a DMG
with nothing to drag and nowhere to drag it. `window` is enlarged to fit four icons in two rows.

`path` is resolved against `buildResources` first and the project root second, so
`assets/dmg/...` is repo-relative. Nothing here reaches `--dir` builds: `npm run package` makes
no disk image, so proving the card ships takes `npm run dist` and a look inside the DMG.

### `mac.identity: null` — ad-hoc signing, on purpose

There is no Apple Developer membership on this account — checked: `security find-identity -v -p
codesigning` reports 0 valid identities. `null` is explicit rather than omitted, because omitted
means *search the keychain and fail confusingly* while `null` means *ad-hoc, deliberately*. The
`xattr` command a downloader needs is above. When somebody buys the membership, set `identity`
and add notarisation.

**Build with `CSC_IDENTITY_AUTO_DISCOVERY=false`, or macOS will ask for your keychain.**

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package
```

electron-builder searches the login keychain for a Developer ID *before* it reads `identity`,
so `null` does not prevent the search — and on a Mac with a locked or prompting keychain that
search raises a system dialog. It can appear behind the window you are looking at, which is
worse than a visible one: the build sits there with no output and nothing says what it is
waiting for. The variable turns the search off.

It does not change what you get. Measured on 2026-10-01 with the variable set, electron-builder
logged `skipped macOS code signing  reason=identity explicitly is set to null` — the skip is
attributed to `identity`, not to the search — and `codesign -dv` on the result reported
`Signature=adhoc`, `flags=0x20002(adhoc,linker-signed)`, which is the ad-hoc signature the
Electron binary already carries. The run *without* the variable was deliberately not made, so
that is the log's account of why it skipped rather than a comparison of two artifacts.
