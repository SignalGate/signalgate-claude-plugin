# Express templates

Detection markers: `express` in `package.json`; `express()` in source; `app.post(`;
route files under `routes/` or `src/routes/`.

**Where things go**
- singleton → `src/signalgate.ts` (or `src/lib/signalgate.ts`, matching the repo)
- lifecycle → module-scope lazy init + a `SIGTERM`/`SIGINT` handler near `app.listen`
- key → `process.env.SIGNALGATE_API_KEY`, via the repo's existing config module if it
  has one
- DTO → the repo's validation layer (zod/joi) if present, else a typed interface

## Singleton

Use the module in `references/node.md` verbatim. If the repo has a central config module
(e.g. `src/config.ts` exporting a validated object), take the key from there instead of
reading `process.env` at the call site.

## Shutdown

```ts
const server = app.listen(port);

async function shutdown(signal: string) {
  await closeClient();          // REQUIRED: flushes queued events
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
```

If the repo already has a graceful-shutdown block, add `await closeClient()` into it
rather than adding a second handler.

## Client IP

Express's `req.ip` is only trustworthy when `app.set("trust proxy", ...)` is configured.
Check for that; if it is set, `req.ip` is fine. If it is not, read the forwarded header
explicitly (see `references/node.md`) and note in the plan which header you chose so the
user can correct it in one word.

## Handler pattern

Use the handler block in `references/node.md` verbatim. Points that matter:

- gate BEFORE the protected action, log AFTER it
- `client.log(...)` is **not** awaited — it enqueues and returns
- both calls wrapped: `check()` rejects on any 4xx, `log()` can throw on a malformed event
- the 403 body carries a **generic** message

## Async route wrapper

If the repo wraps handlers (e.g. `asyncHandler(...)` or `express-async-errors`), keep
using that wrapper — do not introduce a bare `async` handler whose rejections would be
unhandled.

## DTO

With zod:

```ts
const envelope = z.object({
  encrypted: z.string(),
  timestamp: z.number(),
  nonce: z.string(),
  v: z.number().optional(),
}).passthrough();          // passthrough: forward unknown fields verbatim

const otpSendSchema = z.object({
  phone: z.string(),
  // .optional(): a request whose browser capture failed must NOT be rejected here.
  signalgate: envelope.optional(),
  signalgate_log: envelope.optional(),
});
```

**Both envelope fields MUST be optional.** The client is required to send the request
*without* an envelope when browser capture fails (never block the user on a capture
failure). A required field turns that into a validation rejection — so a failed
fingerprint capture would kill the user's real action. Optional + a `None` guard at the
call site is the only correct shape.

`.passthrough()` matters — the envelope is forwarded verbatim and a strict object would
strip a field the browser legitimately adds.
