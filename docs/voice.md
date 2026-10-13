# Voice

Text is always available and always enough. Voice is the optional half, in both directions:
you can talk to the office, and the office can talk back.

The two directions are not symmetrical, and it is worth knowing why before setting either up.

---

## Talking to the office

**This already works, it is free, and Office Space contains no code for it.**

Wispr Flow — and macOS Dictation, and every other tool of its kind — is *system-wide*. Hold the
hotkey, speak, and the words go into whichever text field currently has focus. Office Space's
composer is a plain `<textarea>`, so it is one of those fields. There is nothing to connect.

That is not a shortcut. It is the better answer, and building an integration would make it
worse:

- **Wispr Flow's own API is enterprise-gated.** Access is granted per organisation on approval.
  Building the composer on top of it would mean most people could not talk to their office at
  all.
- **The desktop app is better than what we could build on the API.** The personal dictionary,
  the snippet library, the code-aware formatting — that is all in the app, and it applies to
  our composer for free.
- **It would be a second way to do something that already works.** With one more thing to
  break.

So the engineering here is a constraint rather than a feature, and it is a real one:

> **The composer must stay a real, focusable text input.** A `contenteditable` div, a
> canvas-drawn field, or a React component that intercepts `keydown` and re-renders the value
> will silently break every dictation tool on the system. This is the single easiest way to
> lose voice input, and nothing about it looks broken until someone tries to talk.

This holds for the agent popup too: click an employee, ask them something out loud.

### If you have Flow API access

You do not need it. The desktop app covers everything above. If your organisation has it and
you want in-app push-to-talk anyway, the seam is `SpeechDirector.setListening()` — hold it true
while the mic is open and the rest of the behaviour below falls out unchanged.

---

## The office talking back

**Wispr Flow cannot do this half.** It is dictation only — speech in, text out. There is no
read-aloud in the product or in the API, so the reports have to be spoken by something else.

That something else is **the voice your operating system already ships**. macOS and Windows
both have speech synthesis: offline, free, no account, no key, no third party. A hosted voice
would sound better, and would mean that cloning this repo and running it now requires a billing
relationship with a vendor before the office can say two sentences. Not worth it.

### The part that is actually hard

Speech is the easy half. An office that reads every event aloud is unbearable inside two
minutes — and there is no volume of good text-to-speech that fixes that.

So the work went into the filter, in two stages:

**1. The gate.** Free, local, instant. File reads, searches, edits and shell commands are
discarded outright — not because they are uninteresting, but because *watching* someone work
and *being told about it* are different experiences, and the floor already does the first one.
If nothing survives the gate, nothing is spoken and no request is made. On an ordinary session
this is what happens almost every time, which is what makes a quiet office cost nothing.

**2. The editorial pass.** Once something has survived, judging whether it is worth interrupting
a person over is a judgement call, so Claude makes it — on Haiku, with no tools. It is told, in
as many words, that saying nothing is a good answer, and it is told not to claim something
finished unless the events say so. The same rule as the status bubbles: nothing may be spoken
that is not true.

Worth speaking:

- something finished, and what came of it
- something failed, is stuck, or needs you to decide
- you are the one being waited on

Never spoken: that work is proceeding normally.

### When it stays quiet

Three rules, all in `SpeechDirector`:

**It never talks over you.** This is the one that would quietly ruin the feature. Dictation
opens a microphone, and a microphone hears the speakers — so an announcement made while you are
mid-sentence lands *in your transcript* and gets sent to the manager as though you had said it.
While you have the floor, the office is silent, and anything queued waits.

The signal for "you have the floor" is **focus on the composer**, not microphone detection. A
focused composer covers typing and dictation both, and does not require the app to guess at the
state of a microphone it does not own. It also means one gesture does everything: click into
the composer, and the office falls quiet while the manager walks over to listen.

**It does not read out stale news.** Speech is slow, and several digests can queue up during
one sentence. A newer digest replaces an older one still waiting rather than joining a backlog,
so you hear where things stand now, never a recital of where they stood.

**It can always be cut off.** Mid-word. Taking the floor does it; so does the mute toggle.

---

## Setting up

Nothing, for either direction.

- **To talk**: use whatever dictation you already have. Wispr Flow has a free tier; macOS
  Dictation is built in.
- **To listen**: turn the voice on in the office. If your system has no speech synthesiser the
  toggle is disabled rather than present and inert.

---

## Sources

- [Wispr Flow for developers](https://wisprflow.ai/developers) — system-wide dictation, macOS
  and Windows, free tier and $12/user/month Pro.
- [Flow API quickstart](https://api-docs.wisprflow.ai/quickstart) — speech-to-text only,
  16 kHz PCM, access by approval via `enterprise@wisprflow.ai`.
