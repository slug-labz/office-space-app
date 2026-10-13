# Office Space — the vision

> **Source: Khalid, 2026-08-18.** This document is the canonical statement of what we are
> building. It records what he set out; nothing here is invented, and where something was
> inferred rather than stated it is marked **[inferred]**.
>
> The direct quotations this was first written from were replaced with summaries before the
> project was published, along with one example that named a person who is not part of it.
> What each passage claims is unchanged — only the transcript is gone.

---

## 1. The one-sentence thesis

**Office Space is a frontend for a Claude Code workspace.**

There is barely any backend to build. The backend *is* a `.claude/` workspace — agents,
skills, hooks, commands, MCPs, memory, projects, and a main instruction file. Claude Code
already provides sessions, queuing, orchestration, context, and connectors. What is missing
is a way to **see and control** it. That is the product.

> *"Office space is nothing but a front end to control the project space, or the Claude
> workspace, or Claude SDK, or Claude Code that we have."*

> *"The front end is the most important part of this implementation, because Claude and the
> session and the projects and queuing messages and orchestration and md files and skills and
> agents and everything is already there. Everybody is using Claude. But the front end gives
> the control that we can control Claude in a way that makes sense to us, in a visualized
> manner."*

---

## 2. Backend = a Claude Code workspace

Structurally the same as this very workspace (`My_Agents`), possibly reorganized:

| Piece | Role |
|---|---|
| `CLAUDE.md` | The main instruction — the office's standing orders |
| `.claude/agents/` | The employees. Review agents, frontend agents, backend agents, security/pentest agents, testers, memory agent, anything we can define |
| `.claude/skills/` | What employees know how to do |
| `.claude/commands/` | Slash commands |
| `.claude/hooks/` | Lifecycle hooks — **also our observability feed** [inferred] |
| MCPs / tools | Connectors: databases, email, Slack, Google Chat, Wispr Flow, Granola |
| `memory/` | The memory agent's home |
| `projects/` | Per-project work, exactly like the project space |

**The framing:** this is where the orchestration happens. Little backend code should be needed,
because the MCP files and the Claude workspace structure already in place handle it.

---

## 3. Frontend — the office

An Electron/React window (**not Angular**; Next or another state-of-the-art frontend is fine).
Four regions:

### 3.1 Project tabs (top)
Open a new tab → start a new project. Each tab gives you the **whole office again** as a fresh
instance: manager, review agent, every skill, all of it.

**The key structural idea:** a project is **not a single session — it is a group of sessions.**
Multiple sessions live under one project tab, sharing context. This maps onto Claude Code's own
project/session grouping.

> *"Every project that we create is not a session… we can set it up as a group of sessions."*

Opening a new tab runs a setup instruction: scaffold the project, register the agents.

### 3.2 The office floor (centre)
The visual metaphor, in the spirit of munder-difflin's Pixi floor.

- **The manager** sits in a big office. The main orchestrator.
- **Every other person is an agent** — purpose-built, with the right tools and instructions.
- **Only two entities may command agents: the user, or the manager.** Agents never
  self-start. *"Other agents work under us, or the manager works under us."*
- Work is **visible**: an agent is called over and assigned a task; a skill is fetched (the
  agent walks to a shelf, picks something up, brings it back); hooks and commands fire.

### 3.3 Chat panel (right)
> *"The chat is inevitable."*

You talk here; it goes to the **manager**. The manager takes the task and delegates. This
panel **is a real Claude session** initialized in the backend workspace — the agent behind the
chat *is* the manager.

### 3.4 Agent speech bubbles (from Cadre)
Click an agent → a small bubble appears above them, saying **in plain human language**:

- what it's doing right now
- what it's working on
- which step it's at
- how progress looks

Plus a button to open the full detail. This is explicitly borrowed from Cadre's idea of
skipping the need to read raw chat sessions.

**Where the content comes from:** our project convention that every project has a plan,
tracked progress, to-do items, and reviews. The agent summarizes against that.

---

## 4. Named agents — the shareable-employee model

Agents are **employees**. They can be named after real people and shared.

The example is a colleague: a senior engineer reviews the team's pull requests and already
shares a review agent. So Office Space can live on the **company GitHub**, and they maintain
that review agent there. It becomes an employee under the manager — **they control and edit it
in that repo**, and it's always available to review our code, working like the real person
would.

That makes the repo a place where a team's expertise is version-controlled as agents.

---

## 5. The memory agent

A dedicated employee that keeps notes and holds context of projects, work, and everything
else. Crucially, **you can just ask it** — not to implement anything, but to check in:
what's going on, how is progress, what do we know.

Later: wire in Granola, Circleback, and anything else Claude has touched.

---

## 6. Connectors — wire, don't reinvent

Office email, Slack, Google Chat, Wispr Flow, messaging, and more.

> *"The connector should just work like Claude Code. Claude Code has all these connectors. We
> don't need to reinvent the wheel. We just need to wire them in the frontend properly."*

---

## 7. Distribution — clone it and it's yours

A GitHub repository anyone can clone as **their** Claude workspace:

1. Clone the repo
2. Log in with Claude inside it
3. Start using it — agents are already there
4. Add your own agents and your own memories

### 7.1 Auth — the same login, exactly like VS Code (locked 2026-08-19)

> The requirement: the same login, exactly the way the VS Code extension does it.

Office Space authenticates with the user's **existing Claude subscription login** — the same
credential the Claude Code CLI and the VS Code extension use. **Not a separate API key, and not
separate API billing.** Usage draws on the subscription the user already pays for.

This is a **hard requirement**, and it shapes several things:

- The app resolves credentials the way Claude Code does, rather than asking for a key.
- A user who is already logged into Claude Code should be logged into Office Space.
- If they are not, we drive the normal Claude login flow — we never ask for a key.
- **Known trap:** an exported `ANTHROPIC_API_KEY` *shadows* a subscription profile in the
  standard credential precedence. A user with that variable set would be silently billed at API
  rates instead of using their subscription. Office Space must detect this and say so plainly.

**Memory and personal data are never pushed.** The repo ships the office; the contents stay
yours.

Scalable by construction — this is why the backend being "just a workspace" matters.

---

## 8. Relationship to the reference repos

| Repo | What we take |
|---|---|
| **munder-difflin** | **A lot of frontend.** The office visualization, moving agents, envelopes, the quality touches. Reuse code where we can rather than rebuilding. |
| **Cadre** | The click-an-agent-for-a-human-summary idea. |
| **This workspace (`My_Agents`)** | The backend shape: brain, agents, skills, commands, hooks, projects. |

> *"We're trying to take inspiration from the munder-difflin repository, but we're trying to
> create our own orchestration."*

**The architecture is ours. The frontend is where we reuse.**

⚠️ **Licence:** munder-difflin's code is MIT (reusable with attribution). Its **pixel art is
non-commercial only** (LimeZu). Original or properly-licensed art if this ever ships
commercially.

---

## 9. What makes it different

Everyone already has Claude. Nobody has a way to *see* it working, run several projects
properly at once, and keep every one of Claude's abilities while doing so.

> *"I think that's what makes the project stand out and totally different."*

---

## 10. Open questions

Tracked in `PLAN.md`. Nothing in this document is one of them — this is settled.
