# The licence question

**Answered on 2026-08-31: MIT.** `LICENSE` is at the root, `package.json` carries
`"license": "MIT"`, and the copyright notice the packaged app ships is the same one the file
states. `repo-health` holds all three against each other, because three statements of one fact is
three places it can quietly stop being true.

`"private": true` stays. It tells npm not to publish the package and says nothing about terms;
the licence says the terms and says nothing about publishing. They answer different questions and
both answers are wanted — dropping `private` to "match" the licence would only make an accidental
`npm publish` possible.

The rest of this document is the audit that made the choice a free one. It is kept rather than
deleted: the reason MIT costs nothing here is that nothing in the tree was owed to anybody, and
that is a claim worth being able to re-read.

This is not legal advice. It is what is actually in the repository, checked rather than assumed,
so the decision was not carried on a guess.

## What is in here, verified

| Question | Answer | How it was checked |
|---|---|---|
| Third-party code vendored? | **None.** | `dependencies` is empty. `devDependencies` are build and test tools that do not ship. |
| Third-party art shipped? | **None.** | **Updated 2026-10-01: the sentence that used to be here — *"no image file of any kind is tracked"* — is no longer true, and the verdict is unchanged.** One image is tracked: `assets/build/icon.png`, the app icon, drawn for this project. Its source `assets/build/icon.svg` is committed beside it and `scripts/render-icon.mjs` rebuilds the one from the other, which is what makes it reviewable rather than opaque. `git ls-files` for every other raster extension still returns nothing. The packaged app carries that icon as `Contents/Resources/icon.icns` and no other image; the rest of its `app/` payload is markdown, JSON and agent files. |
| Anything from the reference repos? | **No.** | `PLAN.md` §6 records munder-difflin and `My_Agents` as *study only*, and neither is vendored. `reference/` is gitignored. |
| The LimeZu problem | **Handled, deliberately.** | Its art is non-commercial and non-redistributable. Two shipped files name it and both are protective: `theme/theme.ts` explains that such packs forbid redistribution, so the app ships *only* characters drawn in code and offers a seam for a buyer's own copy; `renderer/mock.ts` is dev-harness data and `mock.js` is excluded from the package by name. |
| Held against regression? | **Yes.** | `repo-health` pins an empty third-party allowlist; `persistence.test.ts` refuses to ship anything git is told to ignore; `no-art-we-may-not-ship.test.ts` refuses a tracked binary unless its source and its renderer are tracked beside it, and fails in both directions so a stale exemption cannot sit there as a hole. |

**So every option was open.** Nothing in the tree constrained the choice, which is why naming one
was a single pass rather than a negotiation.

## The one thing that is not a code question

`PLAN.md` §6 credits two of Khalid's own projects: one with the backend shape — agents, skills,
commands, hooks, projects — and one with the click-an-agent-for-plain-language-status idea. Both
were kept for study and reference on his own instruction of 2026-08-18. They are named in neither
file: they are his unreleased work, not this project's to publish.

No code came across, so this is not a licensing constraint. It is a courtesy one: the shape of
this product owes something to somebody else's work, and if the repository is about to become
public under any terms, that is worth their knowing first. Raised because it is the kind of thing
that is awkward only when it is discovered afterwards.

**Still outstanding.** MIT settles the legal question and does not touch this one. Choosing a
licence is not the same as telling somebody their work shaped yours, and the second has not been
done.

## What the choice actually changed here

Kept as the record of what was on the table, so the decision can be re-read rather than
re-derived.

- **MIT** — *chosen.* Permissive: anyone may use, modify and ship it, including commercially and
  closed. Shorter than Apache-2.0 and what most tooling in this space uses, which matters for a
  workspace people are meant to clone and make their own — §7 of `VISION.md` says that is what
  this is for.
- **Apache-2.0** — the same permissive shape plus an explicit patent grant and a requirement to
  state changes. Not wrong here; simply more ceremony than a workspace repository needs.
- **AGPL-3.0** — copyleft that reaches across a network. Anyone offering a modified version as a
  service must publish their changes. Worth considering only if that is a goal, and it is not:
  this app runs wholly on the user's own machine and offers no service, so the clause that
  distinguishes AGPL from GPL would rarely bite.
- **Proprietary / none** — staying `private: true` with no licence file means no one has
  permission to use it. That was the de-facto position until 2026-08-31, and it contradicted §7
  of `VISION.md` for as long as it held.

## What was actually done

One pass, on 2026-08-31:

- **`LICENSE`** at the root — the canonical MIT text, with the copyright line naming the holder.
  Check it names the right person: it was taken from `git config user.name` and `user.email` on
  the machine that made the change, which is a reasonable default and not necessarily the answer.
- **`package.json`** — `"license": "MIT"`, which is the only form npm, GitHub and dependency
  scanners read. `"private": true` untouched, for the reason at the top.
- **`package.json` → `build.copyright`** — was `""`, so the shipped macOS bundle carried no
  copyright notice at all. Now the same line as `LICENSE`, since that is the only copy of it a
  person who installs the app and never sees the repository will ever see.
- **`repo-health`** — a new check that the three agree. It identifies the licence by text found in
  the file rather than by the filename, so a `LICENSE` holding some other licence fails.

No `SPDX-License-Identifier` headers were added to source files. Nothing needs them: there is one
licence covering the whole tree and no file that is under different terms from the file beside it.

**The third-party allowlist was deliberately not touched.** `RUNTIME_DEPENDENCIES_WE_ACCEPT` in
`repo-health` pins `dependencies` to empty, and that is a check about what third-party code ships
— unrelated to which licence this project publishes under. An earlier draft of this document
listed updating it as part of naming a licence, which was wrong: MIT does not make somebody
else's dependency free to ship, and loosening the allowlist to "complete" the licence pass would
have discarded a real guard to tidy up a paperwork item. Tests and packaging were otherwise
unaffected.
