# Integration scope — full-stack vs backend-only

SignalGate has two halves. The backend `log()`/`check()` calls are inert without a
browser half that produces the encrypted envelope on each request. Decide how much of
the stack to touch from what is **visible**, and confirm it with the user.

## The decision table

| What the scan finds | What to do |
|---|---|
| Both halves in one repo (Next.js, Nuxt, SvelteKit, Rails, Django templates, Laravel, Phoenix…) | Do both. There is no cross-repo question — state it as a fact. |
| Sibling repos, both visible | Offer both; ask **explicitly, per repo** (scope-consent question, `interview.md`); default to both. |
| Backend visible, frontend not — or a mobile/native client | Backend only + a **generated** browser contract in `INTEGRATION.md`. |
| Frontend visible, backend not | **Redirect** — ask the user to open/point at the backend repo. Split-team exception below. |

## Why degradation favours the backend half

Not because the frontend is unimportant — because of **dependency direction**. The
frontend's field name, which requests to attach to, and one-vs-two captures are all
*consequences* of backend decisions (funnel points, gate or no gate). So a browser
contract can always be generated from backend choices; backend choices can never be
generated from browser code. Also: the judgment (funnel placement, method pair,
lifecycle, fail-open, per-port hazards) lives in the backend half, and the browser half
is the mechanically obvious one — better homework to hand over.

## When only the frontend is visible

Redirect rather than degrade — the frontend can't be written *correctly* without the
funnel decisions. **Split-team exception:** if the backend genuinely belongs to another
team, write the frontend against the documented field-name convention (`signalgate` /
`signalgate_log`) rather than observed code, and emit the backend contract for the other
team. State plainly that no events flow until the backend lands, and that the two
`method` strings must be agreed between the teams first.

## Cross-repo trust

The concern is scope *disclosure*, not repo count. Mitigate procedurally, never by
cutting capability:

- announce the scope, per repo, before touching anything;
- ask per repo, not once globally;
- keep the two halves **separate reviewable units** — never one edit spanning both;
- present both diffs before either lands;
- never commit or push.

## `.signalgate/stack.json` schema

Write this at the end of Step 1 and update it as decisions are made. It has **no
secrets** — assert that before writing. Add it to the repo; it is the user's record and
what makes a later re-run (especially gate activation) cheap.

```json
{
  "sdk": "python | node | go | java",
  "sdk_version": "0.3.2",
  "service_path": "services/api",
  "framework": "fastapi",
  "scope": "full-stack | backend-only",
  "client_path": "web | null",
  "use_case": "otp-fraud",
  "method": "otp.send",
  "target_method": "otp.verified",
  "envelope_field": "signalgate",
  "envelope_field_log": "signalgate_log",
  "fail_open": true,
  "state": "observing | gate-active"
}
```
