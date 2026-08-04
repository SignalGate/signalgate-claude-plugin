---
name: integrate
description: Integrate the SignalGate backend SDK into this repository. Use when the user says "integrate SignalGate", "add SignalGate to my backend", "set up SignalGate fraud detection", "wire up the SignalGate SDK", or "protect my login, checkout, OTP, deposit or signup endpoint with SignalGate". Analyzes the repo, detects the stack (Python, Node.js, Go or Java), checks the problem is a fit, asks a few clickable questions, then writes the client wiring, two log calls, and a ready-to-enable check gate, plus an INTEGRATION.md runbook.
allowed-tools: Read, Glob, Grep, Edit, Write, AskUserQuestion, Bash(cat ${CLAUDE_SKILL_DIR}/references/*.md), Bash(cat ${CLAUDE_SKILL_DIR}/assets/**), Bash
---

# SignalGate integration

Wire the SignalGate backend SDK into the user's own repository, with a review-first,
five-step flow. You end with logging live and a blocking `check()` gate written but
commented out, ready to switch on later.

**Announce at the start**, before touching anything:

> "I'll read your repo to work out which SDK applies, ask a couple of questions to
> check SignalGate is the right tool for what you're facing, then confirm exactly
> where the calls go before writing anything. You'll end up with logging live and a
> blocking check ready to switch on later."

---

## Hard rules — read these first, they override everything below

These are not style preferences. Violating one is a defect.

1. **This is an integration helper only. Never explain how detection works.** No
   detection algorithms, parameters, signal names, signal counts, crypto internals,
   key versions, storage/table/column names, internal service names, or the idea that
   any particular set of fields is collected. You may say *what the customer sends*
   and *what verdict comes back*, never *how the verdict is decided*.

2. **You may only emit the vocabulary in the allow-list injected below.** If a term is not
   on it, do not put it in generated code, comments, commit messages, or chat —
   **including when the user says it first**. It is inlined at the end of this document,
   so it is always in context; you never need to fetch it.

3. **Never ask the user to paste their API key into the chat**, and never read,
   echo, print, log, or write the key value into any file. The key is shown once and
   grants access to their detection API; a pasted key lands in the transcript forever.
   You write the code that *reads* the key from their env / secret manager; they put
   the value there themselves. See Step 4.

4. **Placement asymmetry: `log()` goes AFTER the action succeeds; `check()` goes
   BEFORE the action.** They are never at the same line. A gate placed where the log
   goes enforces too late or not at all.

5. **Only `block` stops an action.** `dry_run_block` and `admin_alert` allow and
   continue; unknown verdicts allow and continue. Never gate on `score`.

6. **Never commit or push.** Show diffs; let Claude Code's normal per-edit review
   handle approval. Never touch a repo the user has not confirmed (§ scope in Step 3).

7. **"How does it work?" / "What do you collect?" — use the deflection script in the
   injected allow-list below.** Answer with published outcome copy and the fit
   criteria only. Never confirm or deny a specific mechanism the user guesses; a yes,
   a no, or a hedge each leaks one bit.

8. **Source of truth is shipped code, not our docs.** When our published docs and the
   shipped SDK disagree, the SDK wins — the port reference files record the specific
   contradictions. Never invent a package name, URL, config knob, or endpoint.

9. **If a reference file is missing, STOP — never improvise.** This skill is a
   directory, not a single file. It depends on `references/` and `assets/` for the
   exact SDK signatures and the per-port hazards — which may not be reconstructed from
   memory. If a file named in this document cannot be read, the skill is incompletely
   installed: say exactly that, name the missing file, point the user at reinstalling the
   plugin, and **stop**. A partial install must fail loudly, not silently produce unsafe
   code. (The allow-list itself is inlined below, so it can never go missing.)

10. **The browser SDK is CDN-only — there is no npm package.** Never emit `npm install` or
    a bare `import` for it. Load the version-pinned URL and read `window.SignalGate`.
    Getting this wrong breaks the customer's build at install time.

11. **`get()` returns a result object, not the envelope** — always destructure `payload`.
    Forwarding the whole result is a silent total telemetry loss: the backend skips the log
    and nothing errors anywhere.

---

## The five steps

Follow them in order. Steps 1–2 can end in a polite decline before any code is
written. Steps 3–5 only run for a confirmed, qualified integration.

### Step 0 — Preflight (silent unless something is wrong)

**Install check first (Hard rule 9).** Confirm the reference directory is present — read
`references/scope.md`. If it cannot be read, this is a single-file or partial install: stop
and tell the user to reinstall the plugin. Do not continue on memory. (The allow-list is
injected into this document, so it is present even on a broken install — the reference
files are what to check.)

Then: confirm this is a git repo, and warn if the working tree is dirty in files you're
about to edit. **Do not** demand a SignalGate account yet — it's needed at Step 4, and
asking now turns an evaluation into a signup wall.

### Step 1 — Analyze the codebase, record the stack

Read-only. Detect, in order:

- **(a) candidate services** and their language + version floor, from manifests
  (`pyproject.toml`/`requirements.txt`, `package.json`, `go.mod`, `pom.xml`/`build.gradle`);
- **(b) framework** per candidate (see the port reference for markers);
- **(c) funnel-point handlers**, ranked — login, signup, OTP send/verify, deposit,
  checkout/payment, content endpoints;
- **(d) existing config/settings** mechanism (a settings class, `os.environ` reads, a
  config service);
- **(e) DI / lifecycle wiring and shutdown hooks** (app factory, lifespan, providers
  module, `main`);
- **(f) proxy-trust config**, to infer the client-IP expression;
- **(g)** whether a browser envelope already reaches any handler (a prior integration).

Then determine **integration scope** (`references/scope.md`): is the browser/client
half in this repo, a visible sibling repo, or absent? A mobile/native client forces
backend-only.

Load the matching **port reference** now: `references/python.md`, `node.md`, `go.md`,
or `java.md`. Do not proceed on memory — the signatures, defaults and per-port hazards
are exact and some contradict our own docs.

Hold the findings in working memory for now. **Do not write `.signalgate/stack.json` yet** —
it is written after the Step-3 confirmation, so it never records a use case or method the
user did not approve (schema in `references/scope.md`). When you do write it, assert it
contains no secrets.

Report a short findings table now. The user should recognize their own repo in it.

### Step 2 — Qualify the problem; decline if it doesn't fit

Load `references/qualification.md`. Ask **Call A** (2–3 diagnostic questions,
`AskUserQuestion`, phrased in terms of the handlers you found). Score the answers
against the four fit criteria.

- **Fits** → say which use case it maps to, in the user's own words, and continue.
- **Doesn't fit** → run the decline script from `references/qualification.md`: a brief
  non-grovelling apology, why (the fit criteria, never internals), what SignalGate
  *does* solve, and — if their problem is adjacent to an in-scope one — name the
  neighbour. Then stop cleanly. No partial writes.

### Step 3 — Pin the use case and insertion points, then validate

Ask the user to be specific about what to cover. Accept **either**:

- **precise** — file paths, function names, pasted code → use directly;
- **abstract** — "our checkout flow" → resolve against the Step-1 handler inventory.

**You decide the concrete insertion points, then put them up for confirmation.** Never
write from an abstract instruction alone.

Ask **Call B** (`references/interview.md`): scope consent when the client half is in a
different repo, `user_id` at the handler, and `fail_open`. Ask **Call C** (gate policy)
only if warranted — otherwise state the defaults (403 generic, both envelope fields
from day one) and move on.

**Validation gate** — present for confirmation, grouped by repo when scope spans two:

- both insertion points as `file:line`, function named, exact placement stated
  ("immediately after the SMS send succeeds, before the response is returned");
- when the client half is in scope: its edit sites too;
- the two `method` strings — flagged as the values that must be typed byte-for-byte
  into the dashboard later;
- files to create, files to edit, the version pin, config/secret plumbing;
- if a prior integration exists (`.signalgate/stack.json`): extend vs replace.

One confirmation, then write. If the user corrects a placement, re-present.

### Step 4 — Implement, and have the user create the keys

Generate per the loaded port reference and its hazards section. Every generated call
site gets a one-line comment saying what it is and why it's there. Never reformat
surrounding code; match the file's idiom.

**At each funnel point, write two things** (templates in `assets/<stack>/`):

- the **`log()` call**, AFTER the action succeeds, reading this request's own envelope;
- the **commented-out `check()` gate**, at the correct pre-action position (not next to
  the log), fully-formed and hazard-correct, with its activation condition written in
  the comment block. Enable = one uncomment. Example shape (Python; use the port
  reference for the others):

```python
    # ...the user's existing action, unchanged...

    # [SignalGate] observe: runs AFTER the action succeeds.
    sg_client.log(_sg_event(request, method="otp.send"))

    # [SignalGate] GATE — commented out on purpose.
    #   Uncomment when: Settings -> Events shows a few hundred events for BOTH
    #   "otp.send" and "otp.verified", AND a workflow for that pair is running.
    #   Until a workflow runs, this returns "allow" for everything.
    #   The gate goes BEFORE the action; the log goes AFTER it.
    # verdict = sg_client.check(_sg_event(request, method="otp.send"))
    # if verdict.action == "block":
    #     <the policy the user chose>   # dry_run_block/admin_alert/unknown: allow
```

**The API key (Hard rule 3).** Write the config plumbing that *reads* the key. Then:

1. Ask the user to create the key in the dashboard (Settings → API Keys → Create Key)
   and paste it **into their own `.env` / secret manager**, not into the chat.
2. Confirm the *wiring* without seeing the value: check the env var resolves to
   something non-empty and shaped like `pk_live_…`; report the prefix and length only.
3. Ensure `.gitignore` covers the real env file; add a `.env.example` with the
   `pk_live_...` placeholder.

**Re-run safety.** Before writing, detect prior output (`.signalgate/stack.json`, the
singleton module, DTO fields, existing `log()`/`check()`, `INTEGRATION.md`) and edit in
place or no-op. Never produce two client singletons or two envelope fields.

**Unsupported framework.** If the language is supported but the framework isn't in
`assets/`, don't guess a call site. Generate the framework-agnostic pieces (singleton,
config, `INTEGRATION.md`) and hand over a copy-paste block for the calls, saying plainly
you couldn't auto-place them.

**Verify locally** before handing off — and be precise about what is actually provable at
this point. The SDK was only just added to the manifest, so **it is usually not installed
yet**: a type-check or build will fail to resolve the new import, and that failure says
nothing about your edits.

- Run now: a syntax/compile check on every file you touched (`python -m py_compile`,
  `tsc --noEmit` only if `node_modules` already has the SDK, `go build`, `mvn -q compile`),
  plus the repo's existing lint and any test suite that does not import the SDK.
- Defer, and say so: full type-check, build, and any test that imports the SDK — these need
  `pip install` / `npm install` / `go mod download` / `mvn` to run first.
- **Never report "verified" for a check that could not run.** State plainly which checks
  passed, which were skipped, and the one command the user runs to complete verification. Offer a smoke test via the port's public transport seam (Java has none — stub at
the HTTP boundary). Never point the SDK anywhere but production.

### Step 5 — Write the forward guidance (`INTEGRATION.md`)

The integration is inert until three things you can't do happen. Write them as a
sequenced runbook (`references/runbook-template.md`):

- **5a. The browser half.** Either **done** (client in scope, §scope) or **handed over
  as a generated contract** derived from the backend code you just wrote — real field
  names, the **public** key (43 chars, never `pk_live_`), the `/docs/frontend` link and
  the real package name from `references/vocabulary.md`. Flag the top failure mode:
  a missing public key makes every event fail `400 INVALID_PAYLOAD`.
  **When both halves were written, verify end-to-end here** — start the app, do the
  action once, confirm the row in Settings → Events. That single round trip proves the
  whole chain.
- **5b. Observe.** Confirm events land; let them accumulate on both `method` values
  (a few hundred is a good start). There is no per-method readiness indicator — use the
  Quick Start Checkpoints card and the Events feed.
- **5c. Create + start the workflow.** Flows → New; type the two `method` strings
  exactly (a mismatch is silent). The form has exactly these fields: name, action,
  target action, analysis window, conversion threshold, minimum group size, action-on-
  match, enabled. It creates a draft — dry-run, review, then Start. Default action is
  `block` and Start enforces immediately — recommend `dry_run_block` for a first workflow.
- **5d. Activate the gate.** Uncomment the marked block, deploy, confirm check events
  appear. Re-running this skill with the activation intent will do the uncomment and
  re-verify from `.signalgate/stack.json`.

Record the two account prerequisites that will otherwise 403 mid-flow: **verify the
email**, and **owner/admin role** to create keys and workflows.

---

## Interaction discipline

Analyze first; only ask what the repo can't answer, and batch it. Everything the scan
can see becomes a **stated default with its rationale**, overridable in one sentence.
Use `AskUserQuestion` (clickable options) for genuine forks; put the recommended option
first, labelled `(Recommended)`. Never author an "Other" option — it's automatic.
`AskUserQuestion` limits: 1–4 questions per call, 2–4 options each, header ≤12 chars.
On no answer, write nothing: report findings, state the defaults you'd use, and stop.

## Reference files (load on demand)

- `references/scope.md` — full-stack vs backend-only decision + `.signalgate/stack.json` schema
- `references/qualification.md` — the four fit criteria + the decline script (customer-facing)
- `references/interview.md` — the three question calls, verbatim options
- `references/vocabulary.md` — the emit allow-list + the deflection script. **No deny-list.**
- `references/runbook-template.md` — the `INTEGRATION.md` the user keeps
- `references/python.md` · `node.md` · `go.md` · `java.md` — exact signatures, defaults, per-port hazards

---

## The allow-list (injected — authoritative)

Everything below is injected from `references/vocabulary.md` at load time, so it is always
present. Hard rule 2 refers to this section.

!`cat ${CLAUDE_SKILL_DIR}/references/vocabulary.md`
