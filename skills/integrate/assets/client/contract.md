# Browser contract — generated hand-off

Use this when the client half is **not in scope** (frontend not visible, mobile/native
client, or the user declined). Fill the placeholders from the backend code you just
wrote, so the field names are real rather than illustrative, and paste the result into
`INTEGRATION.md`.

This is a **generated contract**, not documentation: every name below must come from the
code you wrote, never be typed from memory.

---

```markdown
## Browser contract — required for the integration to work

Your backend is now instrumented at:

| Funnel point | `method` value | Envelope field it reads |
|---|---|---|
| {{action_description}} | `{{method}}` | `{{envelope_field_log}}` (log) · `{{envelope_field}}` (gate, when enabled) |
| {{target_description}} | `{{target_method}}` | `{{envelope_field_log}}` |

Nothing reaches SignalGate until your client sends an envelope on those same requests.

### What the client must do

1. **Load the SDK from the pinned CDN URL** — there is no npm package, so do not run
   `npm install` for it:

   ```html
   <script src="https://sdk.signalgate.ai/v0.3.3/index.global.js"></script>
   ```

   The bundle assigns `window.SignalGate`. Keep the version pinned.

2. Initialize it with your **public key** — 43 characters, no prefix, from
   Dashboard → Settings → API Keys → Public Keys. This key is safe in browser code.
   **Never** put the `pk_live_` API key in client code. Call `start()` once:

   ```js
   const fp = new window.SignalGate.Fingerprint({ key: "YOUR_PUBLIC_KEY" });
   await fp.start();                      // warm the detectors once
   ```

3. For **each** request to an instrumented endpoint, capture a **fresh** envelope —
   **destructuring `payload`** — and include it in the JSON body:

   ```js
   const { payload } = await fp.get();    // get() returns a result object, not the envelope
   ```

   Forwarding the whole `get()` result instead of `payload` produces a body the backend
   cannot read: it skips the log silently and you will see zero events with no error.

```json
{
  "...": "your existing fields",
  "{{envelope_field}}":     { "encrypted": "...", "timestamp": 1234567890123, "nonce": "...", "v": 2 },
  "{{envelope_field_log}}": { "encrypted": "...", "timestamp": 1234567890123, "nonce": "...", "v": 2 }
}
```

Send both fields — two independent captures. One is consumed by the blocking check when
you enable it; the other by the logging call that is already live.

### Rules that will otherwise break it

- **One fresh capture per call.** Envelopes are single-use and short-lived. Never cache,
  queue, batch, reuse across funnel points, or replay one — a reused envelope is rejected
  with `422`.
- **Forward the envelope verbatim.** Pass through every field the SDK produced, including
  `v`. Omit `v` entirely if absent; never send `"v": null`.
- **Don't block your user on capture failure.** If capture fails, send the request without
  the envelope — the backend skips the log and the gate fails open.
- **Create a public key first.** Without one, every event fails with `400` no matter how
  correct both halves are. This is the single most common cause of a silently-dead
  integration.

Reference: https://signalgate.ai/docs/frontend

### Mobile / native clients

There is no published SDK for mobile platforms yet. Until there is, instrument the web
surface, or contact SignalGate about mobile coverage before planning around it.
```
