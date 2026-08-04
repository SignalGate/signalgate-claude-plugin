# Browser half — React / Next.js / Vite

Only for use when the client half is **in scope** (`references/scope.md`). Uses the
**public** key (43 chars, no prefix) — never the `pk_live_` API key.

Detection markers: `react` / `next` / `vite` in `package.json`; the form or fetch call that
submits to the backend handler you just instrumented.

## Distribution — CDN ONLY, there is no npm package

The browser SDK ships as one version-pinned CDN bundle:

```
https://sdk.signalgate.ai/v0.3.3/index.global.js
```

It is an IIFE that assigns **`window.SignalGate`**.

**Never emit `npm install` or a bare `import` for the browser SDK.** No such package is
published; `npm install` fails with a 404 and the customer's build is dead on arrival.
Always pin the exact version in the URL — never `latest`, never an unpinned path.

## The three calls, exactly

| Step | Call | Note |
|---|---|---|
| construct | `new window.SignalGate.Fingerprint({ key })` | `key` = the **public** key |
| warm up | `await fp.start()` | once, after construction |
| capture | `const { payload } = await fp.get()` | **destructure `payload`** |

**`get()` does not return the envelope.** It returns a result object with a `payload`
property. Forwarding the whole result gives the backend a body it cannot read: the log is
silently skipped and telemetry sits at zero with no error anywhere — the worst failure mode
in this integration because nothing surfaces it. Always destructure.

`payload` is `{ encrypted, timestamp, nonce, v }` — opaque, forward verbatim.

## Key handling

The public key is browser-safe by design, so a public env var is fine:

- Vite: `VITE_SIGNALGATE_PUBLIC_KEY` · Next.js: `NEXT_PUBLIC_SIGNALGATE_PUBLIC_KEY`
  · CRA: `REACT_APP_SIGNALGATE_PUBLIC_KEY`

Add it to `.env.example`. **Never** put the `pk_live_` API key in any of these.

## Module (`src/lib/signalgate.ts`)

```ts
/**
 * SignalGate browser envelope capture.
 *
 * Loaded from a pinned CDN URL (there is no npm package); the bundle assigns
 * window.SignalGate. Uses the PUBLIC key — never the server key (pk_live_...).
 */

const SDK_URL = "https://sdk.signalgate.ai/v0.3.3/index.global.js";
const PUBLIC_KEY = import.meta.env.VITE_SIGNALGATE_PUBLIC_KEY as string;

export type Envelope = { encrypted: string; timestamp: number; nonce: string; v?: number };
type FingerprintInstance = { start(): Promise<void>; get(): Promise<{ payload: Envelope }> };

declare global {
  interface Window {
    SignalGate?: { Fingerprint: new (config: { key: string }) => FingerprintInstance };
  }
}

let scriptPromise: Promise<void> | null = null;
let instance: Promise<FingerprintInstance> | null = null;

/** Inject the CDN script once per page. */
function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (window.SignalGate?.Fingerprint) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("SDK load failed")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("SDK load failed"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Construct + warm the Fingerprint exactly once per page. */
function client(): Promise<FingerprintInstance> {
  if (instance) return instance;
  instance = (async () => {
    await loadScript();
    const Ctor = window.SignalGate?.Fingerprint;
    if (!Ctor) throw new Error("window.SignalGate.Fingerprint unavailable");
    const fp = new Ctor({ key: PUBLIC_KEY });
    await fp.start();          // warm the detectors once
    return fp;
  })();
  return instance;
}

/**
 * Capture ONE fresh envelope. Never cache, reuse, or replay the result — each envelope
 * is single-use and short-lived, and a reused one is rejected.
 */
export async function captureEnvelope(): Promise<Envelope> {
  const fp = await client();
  const { payload } = await fp.get();   // destructure: get() returns a result object
  return payload;
}

/** Two independent envelopes: one for the gate, one for the log. */
export async function captureEnvelopePair(): Promise<{
  signalgate: Envelope;
  signalgate_log: Envelope;
}> {
  // Sequential, not Promise.all — concurrent get() calls are not a documented
  // guarantee, and back-to-back captures are cheap once start() has warmed things.
  const signalgate = await captureEnvelope();
  const signalgate_log = await captureEnvelope();
  return { signalgate, signalgate_log };
}
```

For **Next.js**, swap `import.meta.env.VITE_…` for `process.env.NEXT_PUBLIC_…` and keep the
module in a `"use client"` file.

## Call site

```ts
import { captureEnvelopePair } from "@/lib/signalgate";

async function submit(phone: string) {
  // Capture fresh envelopes for THIS submission. Never block the user if it fails.
  let envelopes: Record<string, unknown> = {};
  try {
    envelopes = await captureEnvelopePair();
  } catch {
    /* capture failed — proceed without it rather than failing the action */
  }

  const res = await fetch("/api/otp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, ...envelopes }),
  });
  // ...existing handling. A 403 means the request was refused.
}
```

## Rules for generated client code

- **One fresh capture per outbound call.** Never hoist a capture into module scope, a
  `useMemo`, a ref, or a store. Never reuse across submissions or funnel points.
- **Never block the user on capture failure** — the `try/catch` above is mandatory, and it
  works because the backend DTO fields are optional.
- **Do not add a capture to unrelated requests.** Only the instrumented funnel points.
- If the fetch layer is centralized, add the capture there for those specific endpoints —
  never as a global interceptor.

## Verify

Start the app, perform the action once, then check Dashboard → Settings → Events. One round
trip proves the SDK wiring, the field names, the public key, the API key, and the `method`
value together. **If no event appears, check the destructure first** — a whole-result
forward is silent.

## Checklist

- [ ] No `npm install`, no bare `import` of a SignalGate browser package
- [ ] CDN URL version-pinned
- [ ] `await fp.start()` called once
- [ ] `get()` destructured to `payload`
- [ ] Capture failure cannot fail the user's action
- [ ] **Public** key used, never `pk_live_`
