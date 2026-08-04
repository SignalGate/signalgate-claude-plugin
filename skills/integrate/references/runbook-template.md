# `INTEGRATION.md` template

Write this into the user's repo at the end of Step 5. Fill every `{{placeholder}}` from
`.signalgate/stack.json` and the decisions made during the run. Delete the sections that
don't apply (e.g. the browser-contract block when you wired the client yourself).

This file is what a teammate reads in three months. Keep it concrete and sequenced.

---

```markdown
# SignalGate integration

**Status:** logging live · blocking gate written but **not enabled**
**Protected action:** `{{method}}`  →  **target action:** `{{target_method}}`
**SDK:** {{sdk}} {{sdk_version}}   **Service:** `{{service_path}}`

These two `method` strings are the contract between this code and your SignalGate
dashboard. They must match **byte-for-byte** in both places. A mismatch is silent —
the workflow simply sees no traffic.

## What was changed

| File | What |
|---|---|
| `{{singleton_path}}` | SDK client, created once, closed at shutdown |
| `{{config_path}}` | reads `SIGNALGATE_API_KEY` from the environment |
| `{{action_site}}` | `log()` after the action succeeds + a commented-out gate before it |
| `{{target_site}}` | `log()` after the target action succeeds |
| `{{dto_path}}` | accepts the `signalgate` / `signalgate_log` envelope fields |
| `.env.example` | placeholder for the API key |

## Your keys

Two different keys, not interchangeable:

- **API key** (`pk_live_…`, 40 chars) — **server-side only**. Dashboard →
  Settings → API Keys → Create Key. **Shown once.** It belongs in your `.env` /
  secret manager as `SIGNALGATE_API_KEY`. Never commit it, never put it in browser code.
- **Public key** (43 chars, no prefix) — **browser-side**. Dashboard → Settings →
  API Keys → Public Keys. Re-viewable any time. This one is safe in client code.

Account prerequisites, or these steps will fail with a 403: **verify your email**, and
have the **owner or admin** role.

---

## Step 1 — {{browser_step_title}}

{{#if client_wired}}
Already done — the client half was wired in `{{client_path}}`. It captures one envelope
per protected request and sends them as `signalgate` and `signalgate_log`.
{{else}}
Your browser code must attach an envelope to the same request as the action. Install the
browser SDK (`@signalgate/fingerprint-sdk`) and, using your **public** key:

- capture a **fresh** envelope for each call — never cache, queue, batch or replay one;
- send it in the request body as `{{envelope_field}}` (for the gate) and
  `{{envelope_field_log}}` (for the log);
- see https://signalgate.ai/docs/frontend

**If you skip this, nothing works** — the backend has nothing to forward, and every event
fails with `400`. The most common cause of a silently-dead integration is a missing
public key.
{{/if}}

**Verify:** start the app, perform the action once, then open Dashboard → Settings →
Events. Your event should appear within seconds. If it doesn't, check in this order:
public key exists → `SIGNALGATE_API_KEY` resolves → the envelope field names match on
both sides → the action actually succeeded (the log fires after success).

## Step 2 — Let events accumulate

Both `{{method}}` and `{{target_method}}` need traffic before a workflow can be useful.
A few hundred events each is a good starting point.

Watch **Dashboard → Quick Start Checkpoints** — that checklist is the authoritative
"am I integrated?" signal, and steps never un-tick. **Settings → Events** shows
individual events; clicking a row shows any `custom` data you attached.

There is no per-method readiness indicator — use the checkpoints card and the Events feed.

## Step 3 — Create and start your workflow

Dashboard → Flows → **New flow**:

- **action**: `{{method}}` — type it exactly
- **target action**: `{{target_method}}` — type it exactly
- **action on match**: start with **`dry_run_block`**, not `block`
- leave analysis window, conversion threshold and minimum group size at their defaults

Submitting creates a **draft** — nothing is live yet. Then:

1. **Dry run** it. This reports what it *would* have done against recent traffic, with no
   production effect. It can take a while.
2. **Review the results.** A good result affects a modest share of traffic while
   predicting a meaningful lift. A large blocked share with little lift means real users
   are being caught — loosen the threshold or raise the minimum group size and re-run.
3. **Start** it.

⚠️ The form's default action is `block`, and **Start begins enforcing immediately with no
confirmation dialog**. That's why step 3 above says `dry_run_block` for your first
workflow.

The form's complete field list is: name, action, target action, analysis window,
conversion threshold, minimum group size, action-on-match, enabled. If a docs page
mentions a control you can't find on the form, the form is authoritative.

## Step 4 — Enable blocking

Only once steps 1–3 are done and your workflow is running:

1. Open `{{action_site}}`.
2. Uncomment the block marked `[SignalGate] GATE`.
3. Deploy.
4. Confirm check events now appear in Settings → Events alongside the log events.

Until a workflow is running, the gate returns `allow` for everything — enabling it early
adds latency and no protection.

**Verdicts your code handles:** only `block` refuses the action. `dry_run_block` and
`admin_alert` allow and continue (they're for observation), and any unrecognized verdict
allows and continues. Never branch on `score`.

## Notes for whoever maintains this

- **Fail-open is `{{fail_open}}`.** {{fail_open_note}}
- **Never cache or replay an envelope** — capture a fresh one per call. A reused or stale
  envelope is rejected with `422`.
- **`log()` never blocks the request** and its failures are swallowed on purpose —
  telemetry must never break your critical path.
- **Errors you may see:** `400` (unreadable payload, or no public key yet) · `401`
  (invalid/revoked key) · `422` (stale or replayed envelope) · `500` (retryable).
- Re-running the SignalGate integration skill in this repo will read
  `.signalgate/stack.json` and can enable the gate for you.
```
