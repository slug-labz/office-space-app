# Themes — using your own art

Office Space draws its people in code. That is the default, it works on a fresh clone with no
purchase and no download, and it scales to any number of agents: a new file in
`.claude/agents/` produces a new face automatically, forever, on every machine.

If you'd rather use a commercial art pack you've bought, you can. This is how.

---

## Why we can't just ship the good art

We priced six commercial pixel-art packs. Every one of them permits commercial use, and
**every one forbids redistribution.** LimeZu's is typical:

> You **can** edit and use the asset in any commercial or non commercial project.
> You **can't** resell or distribute the asset to others.

Committing those files to this repository is distribution. It isn't a grey area, and it isn't
about money — the packs are cheap. [lemverse](https://github.com/l3mpire/lemverse), an
open-source coworking metaverse built on the same assets, ships no textures at all for exactly
this reason.

So: **the repo ships art it is allowed to ship, and you keep the art you bought.** Your files
live in `assets/themes/`, which is gitignored. They never leave your machine.

---

## Starting in a particular theme

```bash
OFFICE_THEME=limezu npm start
```

The same kind of escape hatch as `OFFICE_WORKSPACE` and `OFFICE_CLAUDE_PATH`. A theme named
there that is not installed falls back to the drawn cast and says so on the floor — it will not
start with no art and leave you guessing.

## Trying it without buying anything

`npx tsx scratch/make-theme.ts` writes a synthetic pack into `assets/themes/checkerboard/` —
flat colour blocks on the grid a real pack uses, each frame a different shade so a mis-sliced
sheet is obvious rather than plausible. It exists because the code that slices a pack has to be
shown working on a real file, and no purchased art can ever live in this repository.

Delete the directory when you are done with it.

## Installing a pack

### 1. Buy it

[LimeZu — Modern Interiors](https://limezu.itch.io/moderninteriors) is the pack this project
was originally prototyped against. It is **name-your-own-price with a $1.50 minimum**, a
**one-time purchase — not a subscription**, and includes Character Generator 2.0. Any pack with
directional walk frames works; that one is simply very good and very cheap.

### 2. Drop it in

```
assets/themes/<your-theme-id>/
  theme.json
  <sheet>.png
  …
```

### 3. Write the manifest

`assets/themes/limezu/theme.json`:

```json
{
  "id": "limezu",
  "name": "LimeZu — Modern Interiors",
  "credit": "Pixel art by LimeZu (limezu.itch.io), used under a purchased commercial licence.",
  "frameWidth": 16,
  "frameHeight": 32,
  "sheets": ["Adam_walk.png", "Alex_walk.png", "Amelia_walk.png", "Bob_walk.png"],
  "layout": {
    "rows": { "down": 0, "up": 1, "right": 2 },
    "steps": [0, 1, 2]
  }
}
```

| Field | What it means |
|---|---|
| `id` | Anything except `procedural`, which is reserved for the built-in. |
| `credit` | **Required.** Nearly every licence that permits commercial use requires attribution, so a theme that can't state its own won't load. Shown in the UI. |
| `frameWidth` / `frameHeight` | One frame's size in pixels. LimeZu's characters are 16×32. |
| `sheets` | One or more spritesheets. Each agent is assigned one by hash, then recoloured, so a handful of sheets yields an unlimited cast. |
| `layout.rows` | Which row holds each facing. `left` is `right` mirrored — no separate row needed. |
| `layout.steps` | The three column indices of the walk cycle. Played as `[0, 1, 2, 1]`. |

### 4. Restart

Office Space scans `assets/themes/` on start. Your theme appears in Settings → Appearance.

---

## When something is wrong, you'll be told

A theme that is installed but broken is **reported, never silently ignored.** If you paid for
art and dropped it in, you're owed an error message — not a quiet fall back to the built-in cast
while you wonder why nothing changed.

| Message | Fix |
|---|---|
| `no theme.json` | Add the manifest. |
| `invalid JSON` | A trailing comma, usually. |
| `missing "credit"` | Add attribution. It is not optional. |
| `missing sheet(s): …` | A filename in `sheets` doesn't exist on disk. |
| `"procedural" is reserved` | Pick a different `id`. |
| `cannot read themes directory` | A permissions problem — the directory exists but can't be opened. |

A *missing* `assets/themes/` directory is not an error. It's the normal state of a fresh clone
and simply means no themes are installed.

---

## Switching back

The built-in theme is always present and always works. Delete your theme directory, or pick
**Drawn in code** in Settings, and you're back — no reinstall, nothing to repair.
