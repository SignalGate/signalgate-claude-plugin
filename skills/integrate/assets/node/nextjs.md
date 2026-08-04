# Next.js route-handler templates

Detection markers: `next` in `package.json`; `app/` directory with `route.ts` files
(App Router) or `pages/api/` (Pages Router); `next.config.*`.

**This is the common full-stack case** — the browser half is usually in the same repo, so
there is no cross-repo scope question. Wire both halves (see `assets/client/react.md`).

**Where things go**
- singleton → `lib/signalgate.ts` (module scope — Next reuses the module across requests)
- lifecycle → **no reliable shutdown hook**; see the caveat below
- key → `process.env.SIGNALGATE_API_KEY` (server-only — must NOT be `NEXT_PUBLIC_*`)
- DTO → inline zod schema, or a typed `await req.json()`

## Singleton (`lib/signalgate.ts`)

```ts
import { Client, type Event, type EncryptedPayload } from "@signalgate/node";

let client: Client | null = null;

export function getClient(): Client {
  if (!client) {
    const apiKey = process.env.SIGNALGATE_API_KEY;
    if (!apiKey) throw new Error("SIGNALGATE_API_KEY is not set");
    client = new Client({ apiKey, failOpen: true });
  }
  return client;
}

export function buildEvent(opts: {
  userId: string; ip: string; method: string; envelope: EncryptedPayload;
}): Event {
  return {
    user_id: opts.userId,
    ip: opts.ip,
    method: opts.method,
    timestamp: new Date().toISOString(),
    payload: opts.envelope,
  };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "";
}
```

**Key-name check:** the API key must never be `NEXT_PUBLIC_*` — that would inline a
server secret into the browser bundle. The *public* key is the one that may be
`NEXT_PUBLIC_SIGNALGATE_PUBLIC_KEY`.

## Shutdown caveat (state this in `INTEGRATION.md`)

Next.js route handlers have no dependable shutdown hook, and on serverless the instance
can be torn down at any time. `close()` cannot be reliably called, so **queued `log()`
events may be lost on teardown**. That's acceptable for telemetry — but do not claim
at-least-once delivery. Long-running self-hosted deployments (`next start`) may register a
`SIGTERM` handler in a custom server if the repo has one.

## Route handler pattern (App Router)

```ts
// app/api/otp/send/route.ts
import { NextResponse } from "next/server";
import { getClient, buildEvent, clientIp } from "@/lib/signalgate";

export async function POST(req: Request) {
  const body = await req.json();

  // [SignalGate] GATE — commented out on purpose.
  //   Uncomment when: Settings -> Events shows a few hundred events for BOTH
  //   "otp.send" and "otp.verified", AND a workflow for that pair is running.
  //   Until a workflow runs, this returns "allow" for everything.
  //   The gate goes BEFORE the action; the log goes AFTER it.
  // try {
  //   const verdict = await getClient().check(buildEvent({
  //     userId: body.phone, ip: clientIp(req),
  //     method: "otp.send", envelope: body.signalgate,
  //   }));
  //   if (verdict.action === "block") {
  //     return NextResponse.json(
  //       { error: "Request could not be completed" }, { status: 403 });
  //   }
  //   // dry_run_block / admin_alert / anything unknown: allow and continue
  // } catch {
  //   // fail open on any SDK error
  // }

  await sendVerificationCode(body.phone);        // the protected action

  // [SignalGate] observe: runs AFTER the action succeeds. Do not await.
  try {
    getClient().log(buildEvent({
      userId: body.phone, ip: clientIp(req),
      method: "otp.send", envelope: body.signalgate_log,
    }));
  } catch { /* telemetry must never break the request */ }

  return NextResponse.json({ ok: true });
}
```

For the **Pages Router** (`pages/api/*.ts`), the same body applies with
`(req: NextApiRequest, res: NextApiResponse)`, `req.body`, and
`res.status(403).json(...)`.

## Server Actions

If the protected action is a Server Action rather than a route handler, the same pattern
applies inside the action function — but the envelope must be passed in explicitly from
the client component (a Server Action has no `Request` object). Have the client include
the envelope in the action's arguments, and read the IP from `headers()`:

```ts
import { headers } from "next/headers";
const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "";
```
