# Browser half — React / Next.js / Vite

Only for use when the client half is **in scope** (`references/scope.md`). Uses the
**public** key (43 chars, no prefix) — never the `pk_live_` API key.

Detection markers: `react` (or `next`) in `package.json` — the wrapper needs React to
mount a provider, so a Vite app qualifies only when it is a React+Vite app; plus the form
or fetch call that submits to the backend handler you just instrumented.

**Lead with the wrapper.** `@signalgate/nextjs` is the published npm package for this
audience — React, Next.js (App Router or Pages Router), and React+Vite apps all use it.
It peer-depends on `react >=18 <20`. Fall back to the hand-rolled CDN module below for any
browser app WITHOUT React — vanilla JS, and equally Vue or Svelte on Vite — where there
is no React tree to hang a provider off.

## Install

```bash
npm install @signalgate/nextjs
```

Peer dependency: `react` (`>=18 <20`). No `next` peer — the same package serves plain
React and Vite apps too.

**Never install a package for the raw browser SDK** (sometimes seen as
`@signalgate/fingerprint-sdk`) — that name is unpublished and 404s. The wrapper needs no
such dependency: at runtime, in the browser, it injects the same version-pinned CDN
bundle the fallback section below loads by hand.

## Mount the provider once, at the app root

**Next.js App Router** — root `layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { SignalGateProvider } from "@signalgate/nextjs";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SignalGateProvider tenantKey={process.env.NEXT_PUBLIC_SIGNALGATE_PUBLIC_KEY ?? ""}>
          {children}
        </SignalGateProvider>
      </body>
    </html>
  );
}
```

**Next.js Pages Router** — wrap `_app.tsx` the same way:

```tsx
import type { AppProps } from "next/app";
import { SignalGateProvider } from "@signalgate/nextjs";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <SignalGateProvider tenantKey={process.env.NEXT_PUBLIC_SIGNALGATE_PUBLIC_KEY ?? ""}>
      <Component {...pageProps} />
    </SignalGateProvider>
  );
}
```

**Plain React / Vite** — mount it once near the root of the component tree the same way,
reading the key from `import.meta.env.VITE_SIGNALGATE_PUBLIC_KEY` instead.

`tenantKey` is the **public** key — safe in browser code. Never pass the `pk_live_` API
key here. Only the first `<SignalGateProvider>` to mount on a page actually configures
the load; a second one is a no-op, so it is safe to mount once per app rather than once
per funnel point.

## The hook, at the funnel point

```tsx
"use client";
import { useSignalGate } from "@signalgate/nextjs";

export function CheckoutForm() {
  const { getPayload, status } = useSignalGate();

  async function onSubmit() {
    const payload = await getPayload(); // never throws; null on failure
    await fetch("/api/otp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload /* ...your form data */ }),
    });
    // ...existing handling. A 403 means the request was refused.
  }

  return (
    <button onClick={onSubmit} disabled={status === "loading"}>
      Submit
    </button>
  );
}
```

Forward `payload` to the same backend handler you just instrumented, under the envelope
field name recorded for this funnel point in `.signalgate/stack.json`.

**`getPayload()` never throws and never rejects.** On any failure (CDN blocked, load
timeout, underlying SDK error) it resolves `null` instead of raising. There is no
result-object envelope to destructure here and nothing to catch — handle it with a null
check, not `try/catch`:

```tsx
const payload = await getPayload();
if (payload === null) {
  // proceed without a signal rather than failing the user's action
}
```

## Key handling

The public key is browser-safe by design, so a public env var is fine:

- Next.js: `NEXT_PUBLIC_SIGNALGATE_PUBLIC_KEY` · Vite: `VITE_SIGNALGATE_PUBLIC_KEY`

Add it to `.env.example`. **Never** put the `pk_live_` API key in either of these.

## Content-Security-Policy

The wrapper fetches the fingerprint engine from the pinned CDN at runtime — it is not
bundled into your app. If the app ships a strict CSP, `script-src` must allow the CDN
host or the injected `<script>` is silently blocked (the provider fails open: `status`
becomes `"error"`, `getPayload()` resolves `null`, no console error unless CSP violation
reports are monitored):

```
script-src 'self' https://sdk.signalgate.ai/v0.3.3/index.global.js;
```

## Rules for generated client code

- **Mount the provider once**, at the app root — not per funnel point, not per request.
- **Never wrap `getPayload()` in `try/catch`** — it already fails open to `null`; check
  for `null` instead.
- **Do not add a capture to unrelated requests.** Only the instrumented funnel points.
- **Public** key only, never `pk_live_`.

## Verify

Start the app, perform the action once, then check Dashboard → Settings → Events. One
round trip proves the provider mount, the hook wiring, the field names, the public key,
and the `method` value together. **If no event appears, check for a `null` payload
first** — a CSP block or a missing/incorrect `tenantKey` both fail open silently.

## Checklist

- [ ] `@signalgate/nextjs` installed, no raw browser SDK package installed
- [ ] `<SignalGateProvider>` mounted once, at the app root, with the **public** key
- [ ] `useSignalGate()` called at the funnel point, `getPayload()` awaited
- [ ] `payload === null` checked — no `try/catch` around `getPayload()`
- [ ] CSP `script-src` allows `https://sdk.signalgate.ai/v0.3.3/index.global.js`, if the app sets one
- [ ] **Public** key used, never `pk_live_`

---

## Fallback — non-React browser apps (vanilla JS, etc.)

Use this section only when there is no React tree to mount a provider in. It hand-rolls
the same pinned CDN bundle the wrapper above injects for you.

### Distribution — CDN ONLY, no npm package exists for the raw SDK

The raw browser SDK ships as one version-pinned CDN bundle:

```
https://sdk.signalgate.ai/v0.3.3/index.global.js
```

It is an IIFE that assigns **`window.SignalGate`**.

**Never emit `npm install` or a bare `import` for the raw browser SDK.** No such package
is published; `npm install` fails with a 404 and the customer's build is dead on arrival.
Always pin the exact version in the URL — never `latest`, never an unpinned path.

### The three calls, exactly

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

### Key handling

- Vite: `VITE_SIGNALGATE_PUBLIC_KEY` · CRA: `REACT_APP_SIGNALGATE_PUBLIC_KEY`

Add it to `.env.example`. **Never** put the `pk_live_` API key in any of these.

### Module (`src/lib/signalgate.ts`)

```ts
/**
 * SignalGate browser envelope capture.
 *
 * Loaded from a pinned CDN URL (no npm package exists for the raw SDK); the bundle
 * assigns window.SignalGate. Uses the PUBLIC key — never the server key (pk_live_...).
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

For a non-Vite bundler, swap `import.meta.env.VITE_…` for that bundler's own env
convention.

### Call site

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

### Rules for generated client code

- **One fresh capture per outbound call.** Never hoist a capture into module scope, a
  `useMemo`, a ref, or a store. Never reuse across submissions or funnel points.
- **Never block the user on capture failure** — the `try/catch` above is mandatory, and it
  works because the backend DTO fields are optional.
- **Do not add a capture to unrelated requests.** Only the instrumented funnel points.
- If the fetch layer is centralized, add the capture there for those specific endpoints —
  never as a global interceptor.

### Verify

Start the app, perform the action once, then check Dashboard → Settings → Events. One round
trip proves the SDK wiring, the field names, the public key, the API key, and the `method`
value together. **If no event appears, check the destructure first** — a whole-result
forward is silent.

### Checklist

- [ ] No `npm install`, no bare `import` of the raw browser SDK
- [ ] CDN URL version-pinned
- [ ] `await fp.start()` called once
- [ ] `get()` destructured to `payload`
- [ ] Capture failure cannot fail the user's action
- [ ] **Public** key used, never `pk_live_`
