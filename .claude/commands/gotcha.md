---
description: Record something that bit us — what happened, how to recognise it next time, and what to do instead. Use immediately after losing time to a surprise, while you still remember the symptom.
argument-hint: "<what bit us>"
---

# Record the gotcha

Write down: `$ARGUMENTS`

The whole `claude-path.ts` module exists because of one of these: an app launched from the Dock
does not get your terminal's `PATH`, which looks fine in development and fails for everybody
else. That cost real time once. Written down, it costs nothing again.

## Where it goes

One file in `memory/`, kebab-case, named for the **symptom** rather than the cause — that is
what the next person will be searching for, because the cause is precisely the part they do not
know yet.

```markdown
---
title: An app launched from the Dock has no nvm on PATH
type: fact
created: 2026-08-19
---

Spawning a bare `claude` works in development and finds nothing in a packaged build. A GUI app
started from the Dock inherits launchd's environment, not your shell's, so nvm and Homebrew
shims are simply absent.

Recognise it by: works when started from a terminal, fails when double-clicked.

Instead: resolve an absolute path before spawning — `src/main/claude-path.ts`.
```

## Three things, and the last one is the point

1. **What happened**, including the misleading part — what it looked like before you understood
   it.
2. **How to recognise it next time.** The symptom, not the diagnosis.
3. **What to do instead**, with a path to the code that does it.

A gotcha without the third is a war story. With it, it is the fix.

## Worth recording even when it was your own mistake

Especially then. The office's fourth standing order is written in `CLAUDE.md` because treating
an unreadable file as an empty one "has cost more than any other" mistake in the projects this
one was built from — which is a gotcha that got written down and then became a rule.
