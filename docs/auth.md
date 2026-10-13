# Authentication

Office Space runs on **your own Claude**. It spawns the `claude` you already installed and
already logged into, and renders what comes back. It does not embed an agent runtime, does not
implement OAuth, and never sees a token.

If you can run `claude` in a terminal, Office Space works. If you can't, Office Space can't
either — and it will tell you so instead of asking for an API key.

---

## Why it works this way

Anthropic's [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) page
is explicit:

> Anthropic does not permit third-party developers to offer Claude.ai login or to route
> requests through Free, Pro, or Max plan credentials on behalf of their users.

And the Agent SDK docs repeat it, naming the SDK specifically:

> Unless previously approved, Anthropic does not allow third party developers to offer
> claude.ai login or rate limits for their products, including agents built on the Claude Agent
> SDK.

There are three positions available, and only one of them is comfortable:

| | What it is | Verdict |
|---|---|---|
| **Spawn the user's own `claude`** | The app starts a program the user installed and logged into. Requests go from their machine, on their plan. | **What we do.** The relationship a terminal emulator has to a shell. |
| Embed the Agent SDK | The app bundles its own Claude binary, which reads the user's keychain. | The grey zone the SDK note names directly. Avoided. |
| Implement OAuth | The app offers a "Log in with Claude" button. | Clearly prohibited. |

There is nothing for Office Space to "offer" or "route" — we are a window onto a program you
already run.

## What this means in practice

- **No API key.** Office Space never asks for one and never stores one.
- **No separate bill.** Usage draws on the Claude subscription you already pay for.
- **Nothing to log into.** If `claude` works, so does Office Space.
- **You can verify it.** Every request comes from a `claude` process on your own machine; watch
  it with `ps` if you like.

## Setting up

```bash
claude
```

Then `/login` and finish in the browser. That's the whole setup.

## The one trap worth knowing

**An exported `ANTHROPIC_API_KEY` shadows your subscription login.**

In the standard credential precedence, an API key wins over an OAuth profile. If you have that
variable exported — and plenty of developers do — requests get billed at API rates while you
believe you're on your plan. Nothing errors; it just quietly costs money.

Office Space checks for this at startup and says so plainly rather than letting it run.

To use your subscription instead, unset it:

```bash
unset ANTHROPIC_API_KEY
```

Note that an *empty* `ANTHROPIC_API_KEY=""` still occupies its slot in the precedence order and
still wins. It has to be genuinely unset, not blank.

## What we do not support, and why

Bedrock, Vertex, and Foundry all work with the `claude` CLI and would work here by inheritance —
but they are not a supported path, because none of them serves the product's premise. Office
Space exists so that the office you clone costs nothing extra to run. Adding cloud-provider
billing paths would be adding a second, worse story about who pays.

If you need one, the escape hatch already exists: Office Space spawns your `claude`, and your
`claude` reads your environment. Configure it there and it will be honoured.
