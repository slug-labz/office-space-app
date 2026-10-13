# Projects

Your work. One directory per project, and **none of it is committed** — the repo ships the
convention, you keep the contents.

## Starting one

```bash
cp -r projects/_TEMPLATE projects/<name>
```

## The three files

The office floor reads these. An agent's status bubble is drawn from them, so keeping them
current is not bookkeeping — it is the UI.

| File | Purpose |
|---|---|
| `PLAN.md` | What we are building and why. The goal, and how we will know it is done. |
| `PROGRESS.md` | Append-only. What happened, when, by whom. Never rewritten. |
| `TASKS.md` | The live task list, with an owner and a VERIFY condition per task. |

A task is done when its VERIFY passes, not when somebody says it is. That is the office's
second standing order, and this is where it is written down per task.
