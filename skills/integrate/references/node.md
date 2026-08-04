# Node.js — `@signalgate/node`

Verified against **@signalgate/node 0.1.0**. Source of truth is the shipped package.

## Install / floors

```
npm install @signalgate/node       # pin: 0.1.0
```

- Node **≥18** (uses global `fetch`).
- Ships types; ESM and CJS both work. Import from the package root only — deep imports
  are blocked by `exports`.

## Public surface

`Client`, `SignalGateError`, `ConfigError`, `TimeoutError`, `NetworkError`,
`ServerError`, and the types `Event`, `EncryptedPayload`, `CheckResult`, `Metrics`,
`Transport`, `Logger`.

## Construct

```ts
new Client({
  apiKey: string,                  // required
  checkTimeoutMs?: number,         // 3000
  logTimeoutMs?: number,           // 2000
  logQueueCapacity?: number,       // 10000
  logMaxRetries?: number,          // 3
  logRetryBaseMs?: number,         // 200
  failOpen?: boolean,              // true
  transport?: Transport,           // public test seam
  logger?: Logger,
})
```

Throws `ConfigError` on a blank `apiKey` or a non-finite/negative numeric option. No
prefix validation — a typo'd key surfaces as a 401 on first call. No base-URL option.

## Types

```ts
type Event = {
  user_id: string; ip: string; method: string; timestamp: string;
  payload: EncryptedPayload; custom?: Record<string, unknown>;
};
type EncryptedPayload = { encrypted: string; timestamp: number; nonce: string; v?: number };
type CheckResult = {
  action: string; score: number; request_id: string; tenant_id: string;
  timestamp: string; processing_time_us: number; failedOpen: boolean;
};
```

**Two timestamps:** outer `timestamp` is an **ISO-8601 string** (`new Date().toISOString()`);
`payload.timestamp` is a **unix-ms number** from the browser.

## Calls

```ts
await client.check(event): Promise<CheckResult>   // ~3s, never retries
client.log(event): void                           // enqueue-and-return, do NOT await
await client.close(timeoutS?): Promise<void>       // REQUIRED; SECONDS, not ms
client.metrics.snapshotFlat(): Record<string, number>
```

## Hazards — generated code must handle these

- **Any 4xx bypasses fail-open and rejects.** You'll see 401 / 400 / 422. No 429 exists.
- **`log()` CAN throw**, despite the README — the wire conversion is unguarded. Wrap it.
- **`close()` leaves a referenced timer**: it resolves immediately on an empty queue, but
  the process lingers for the full deadline (5s default). Harmless in a long-running
  server; **call `close(1)` or shorter in CLIs / short-lived workers**, and warn the user.
- **`close()` does not close an injected transport** — if the user passes one, they own it.
- Never gate on `score`. Only `block` blocks.

## Idiomatic integration (Express)

```ts
// src/signalgate.ts
import { Client, type Event, type EncryptedPayload } from "@signalgate/node";
import type { Request } from "express";

let client: Client | null = null;

export function getClient(): Client {
  if (!client) {
    const apiKey = process.env.SIGNALGATE_API_KEY;
    if (!apiKey) throw new Error("SIGNALGATE_API_KEY is not set");
    client = new Client({ apiKey, failOpen: true });
  }
  return client;
}

export async function closeClient(): Promise<void> {
  if (client) { await client.close(2); client = null; }
}

export function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.ip ?? "";
}

export function buildEvent(opts: {
  userId: string; ip: string; method: string; envelope: EncryptedPayload;
}): Event {
  return {
    user_id: opts.userId,
    ip: opts.ip,
    method: opts.method,
    timestamp: new Date().toISOString(),   // ISO-8601 string
    payload: opts.envelope,                // unix-ms number inside
  };
}
```

Shutdown:

```ts
process.on("SIGTERM", () => { void closeClient().then(() => process.exit(0)); });
```

Handler — `log()` AFTER, gate BEFORE:

```ts
app.post("/api/otp/send", async (req, res) => {
  // [SignalGate] GATE — commented out on purpose.
  //   Uncomment when: Settings -> Events shows a few hundred events for BOTH
  //   "otp.send" and "otp.verified", AND a workflow for that pair is running.
  //   Until a workflow runs, this returns "allow" for everything.
  //   The gate goes BEFORE the action; the log goes AFTER it.
  // try {
  //   const verdict = await getClient().check(buildEvent({
  //     userId: req.body.phone, ip: clientIp(req),
  //     method: "otp.send", envelope: req.body.signalgate,
  //   }));
  //   if (verdict.action === "block") {
  //     return res.status(403).json({ error: "Request could not be completed" });
  //   }
  //   // dry_run_block / admin_alert / anything unknown: allow and continue
  // } catch (err) {
  //   // fail open on any SDK error
  // }

  await sendVerificationCode(req.body.phone);   // the protected action

  // [SignalGate] observe: runs AFTER the action succeeds. Do not await.
  try {
    getClient().log(buildEvent({
      userId: req.body.phone, ip: clientIp(req),
      method: "otp.send", envelope: req.body.signalgate_log,
    }));
  } catch { /* telemetry must never break the request */ }

  res.json({ ok: true });
});
```

For **Next.js route handlers**, the singleton lives in a module (`lib/signalgate.ts`) and
there is no reliable shutdown hook — that's fine for `log()`; note in `INTEGRATION.md`
that queued events can be lost on a serverless teardown.

## Docs-vs-code contradictions (code wins)

- Docs claim fixed `score` values per action — nothing is enforced; a string score
  becomes `0`. Never gate on it.
- Docs/README claim `log()` never throws — it can.
- `close()` takes **seconds**; docs elsewhere imply ms.
