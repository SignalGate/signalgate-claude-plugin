# SignalGate plugin for Claude Code

One skill, `signalgate:integrate`, that wires the SignalGate backend SDK into your
codebase with a guided, review-first flow:

1. **Analyzes your repo** — detects your stack (Python, Node.js, Go or Java) and the
   handlers worth protecting.
2. **Checks the fit** — a couple of questions to confirm SignalGate actually addresses
   the problem you're facing. If it doesn't, it says so and tells you what SignalGate
   *is* for.
3. **Confirms placement** — you approve the exact files and lines before anything is
   written.
4. **Writes the integration** — SDK client wiring, two `log()` calls at your funnel
   points, and a fully-written but **commented-out** `check()` gate you enable later,
   once events have accumulated and your workflow is running.
5. **Leaves a runbook** — `INTEGRATION.md` in your repo with everything that happens
   after the code: browser wiring, the dashboard steps, and how to switch blocking on.

## Install

```
/plugin marketplace add SignalGate/signalgate-claude-plugin
/plugin install signalgate@signalgate
```

Then, in any session inside your repo:

```
/signalgate:integrate
```

or just ask: *"integrate SignalGate into this repo"*.

## What it will never do

- It never asks you to paste your API key into the chat, and never reads, echoes,
  or commits the key. You put the key in your own `.env` / secret manager; the
  skill only writes the code that reads it.
- It never commits or pushes. Every edit is shown as a diff for your review.
- It never touches a repository you haven't explicitly confirmed.
- It never turns blocking on for you. The `check()` gate ships commented out, with
  its activation condition written above it.

## Requirements

- A SignalGate account (you'll create your keys in the dashboard during the flow).
- One of the supported backend stacks: Python 3.10+, Node.js 18+, Go 1.22+, Java 17+.
