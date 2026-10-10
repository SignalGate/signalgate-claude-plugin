# C# / .NET — `SignalGate`

Verified against **SignalGate 0.1.0** on NuGet. Source of truth is the shipped package, not
our docs; contradictions are listed at the bottom.

## Install / floors

```
dotnet add package SignalGate     # pin: 0.1.0
```

- **.NET 8+**: the package targets `net8.0` and `net10.0`.
- No dependencies. Trimming- and Native AOT-compatible.
- Namespace `SignalGate`. Read the running version via `SignalGateClient.SdkVersion`.

## Public surface

`SignalGateClient`, `SignalGateClientOptions`, `SignalGateEvent`, `EncryptedPayload`,
`CheckResult`, `CheckActions`, `SignalGateMetrics`, `MetricSample`, `ISignalGateLogger`,
`NoopSignalGateLogger`, and the exceptions rooted at `SignalGateException`:
`SignalGateConfigException`, `SignalGateTimeoutException`, `SignalGateNetworkException`,
`SignalGateServerException`.

## Construct

```csharp
var client = new SignalGateClient(new SignalGateClientOptions
{
    ApiKey = apiKey,           // required
    CheckTimeoutMs = 3000,
    LogTimeoutMs = 1000,
    LogQueueCapacity = 10000,
    LogMaxRetries = 3,
    LogRetryBaseMs = 200,
    FailOpen = true,
    Logger = null,             // ISignalGateLogger; null disables the SDK's own diagnostics
    HttpHandler = null,        // HttpMessageHandler; public test seam
});
```

`new SignalGateClient(apiKey)` is the same with every default. Throws
`SignalGateConfigException` at construction on a null, empty or whitespace key, a key with a
character other than tab or printable ASCII, a timeout or queue capacity below 1, or a
negative retry option. **No prefix check** — a mistyped key surfaces as a 401 on the first
check, not at construction. The client copies every value, so changing the options object
afterwards has no effect.

`HttpHandler` is the public test seam: a fake `HttpMessageHandler` keeps a smoke test off the
network. The SDK never disposes a handler you pass; set `AllowAutoRedirect = false` on it and
never add a retry handler.

## Types

```csharp
// EncryptedPayload: the browser envelope. In a handler it binds straight from the
// JSON request body (see the DTO below); this only shows its constructor.
var payload = new EncryptedPayload(
    "...",           // encrypted
    1748102400000,   // timestamp: long, unix MILLISECONDS from the browser
    "...",           // nonce
    2);              // v: int?, optional; null when the client didn't send it

// SignalGateEvent: one per call. The DateTimeOffset overload formats the outer
// timestamp as an ISO 8601 string with an offset.
var evt = new SignalGateEvent(
    "u_123",                 // user id
    "203.0.113.42",          // client IP
    "otp.send",              // method
    DateTimeOffset.UtcNow,   // outer timestamp
    payload,
    new Dictionary<string, object?> { ["plan"] = "pro" });   // custom, optional
```

The constructors throw `ArgumentNullException` on a null value. Generated code builds events
with **`SignalGateEvent.TryCreate(userId, ip, method, timestamp, payload, out var evt)`**
instead (an optional `custom` follows `out`): same values, but it returns `false` rather than
throwing when one is null or the payload is missing or incomplete, and `evt` is non-null when
it returns `true`. That `if` is the envelope guard. Empty strings pass through unchanged.

`CheckResult` is read-only: `string Action`, `double Score`, `string RequestId`,
`string TenantId`, `string Timestamp`, `long ProcessingTimeUs`, `bool FailedOpen`.
`CheckActions` holds the four known actions as constants: `Allow`, `AdminAlert`,
`DryRunBlock`, `Block`.

**Two timestamps, never unified:** the outer event timestamp is an **ISO-8601 string** (pass
`DateTimeOffset.UtcNow` and the SDK formats it); `payload.Timestamp` is a **unix-ms `long`**
straight from the browser.

## Calls

```csharp
CheckResult verdict = await client.CheckAsync(evt, cancellationToken);  // one request, never retried
client.Log(evt);                                   // queues and returns at once; never throws
await client.CloseAsync(TimeSpan.FromSeconds(2));  // delivers queued events, then releases
IReadOnlyDictionary<string, long> counters = client.Metrics.SnapshotFlat();
```

- `CheckAsync` is bounded by `CheckTimeoutMs`. Await it; never `.Result` or `.Wait()`.
- `Log` takes `SignalGateEvent?` and hands delivery to one background task, with up to 4
  attempts by default (200 / 400 / 800 ms apart).
- `CloseAsync()` without an argument waits up to `5 × LogTimeoutMs` (5 s by default);
  `DisposeAsync()` and `Dispose()` close too. Later calls return the same task. After close,
  `CheckAsync` throws `SignalGateConfigException` and `Log` ignores events.
- Outside a DI container (a worker or console app), scope the client with
  `await using var client = new SignalGateClient(...)`; disposing delivers the queued events.
- `Metrics` also has `Get(name, labels)` and `Snapshot()`, for the user's own alerting.

## Hazards — generated code must handle these

- **Any 4xx (or 3xx) from `CheckAsync` throws `SignalGateServerException`, even with
  `FailOpen = true`.** You'll see 401 / 400 / 422. The published docs' gate examples await
  `CheckAsync` bare, so pasted as-is a rejected check becomes a 500 on the user's real
  action. Wrap the gate in `catch (SignalGateException)` and allow. With `FailOpen = false`,
  timeouts, network errors and 5xx throw too — make that catch the policy the user chose.
- **Don't fail open on `OperationCanceledException`.** Cancelling the request's own token
  (the caller went away) throws it, and it never fails open. Let it propagate;
  `catch (SignalGateException)` leaves it alone.
- **`signalgate_log` binds only with `[property: JsonPropertyName("signalgate_log")]`.**
  ASP.NET Core's web JSON defaults bind `signalgate` to a `SignalGate` property
  case-insensitively, but nothing maps `signalgate_log` to `SignalGateLog`. Without the
  attribute the property stays null, `TryCreate` returns `false`, and every log is skipped:
  zero events, no error anywhere. The quietest failure in this port.
- **Register through a factory: `AddSingleton(_ => new SignalGateClient(...))`.** The
  container disposes a client it created on host shutdown, which delivers the queued log
  events. An instance passed directly (`AddSingleton(new SignalGateClient(...))`) is never
  disposed, so queued events are lost at every shutdown. Never `AddScoped`, `AddTransient`
  or a `new` per request: one client per process, safe for concurrent use.
- **`TryCreate` also returns `false` on a null user id or IP**, skipping the call just as
  silently. When the handler genuinely has no user id, pass `""`, never null.
  `Connection.RemoteIpAddress` can be null.
- **`Log` genuinely never throws** — an unusable event is dropped and counted. No try/catch
  around it, unlike the Python, Node and Java templates.
- **`custom` values are serialized at call time.** Supported: null, `string`, `bool`, integer
  types, finite `float`/`double`/`decimal`, `JsonElement`/`JsonNode`, string-keyed
  dictionaries, and collections. Anything else (`Guid`, enums, `DateTime`,
  `DateTimeOffset`, …) makes `CheckAsync` throw `ArgumentException` before sending and `Log`
  drop the event — convert to a string or number first.
- Never gate on `Score`. Only `CheckActions.Block` stops the action; `dry_run_block`,
  `admin_alert` and any unknown action allow and continue.

## Idiomatic integration (ASP.NET Core)

Registration, in `Program.cs`:

```csharp
using SignalGate;

var builder = WebApplication.CreateBuilder(args);

// [SignalGate] One client per process, registered as a singleton THROUGH A FACTORY:
// the container then owns it and disposes it on host shutdown, which delivers the
// queued log events. The key comes from configuration (environment variables included);
// its value lives in the environment or a secret store, never in a committed file.
builder.Services.AddSingleton(_ => new SignalGateClient(new SignalGateClientOptions
{
    ApiKey = builder.Configuration["SIGNALGATE_API_KEY"]
        ?? throw new InvalidOperationException(
            "SIGNALGATE_API_KEY is not set (Dashboard -> Settings -> API Keys). See INTEGRATION.md."),
    FailOpen = true,
}));

var app = builder.Build();
```

Client IP helper:

```csharp
// SignalGateHttp.cs
using System.Net;

public static class SignalGateHttp
{
    // The client IP. Behind a proxy this is the visitor's address only once forwarded
    // headers are enabled for your own proxies (UseForwardedHeaders).
    public static string? ClientIp(HttpContext http)
    {
        IPAddress? remoteIp = http.Connection.RemoteIpAddress;
        // A dual-stack listener reports an IPv4 client as ::ffff:a.b.c.d.
        return (remoteIp is { IsIPv4MappedToIPv6: true } ? remoteIp.MapToIPv4() : remoteIp)?.ToString();
    }
}
```

Handler — `Log` AFTER, gate BEFORE, both behind the `TryCreate` envelope guard:

```csharp
app.MapPost("/api/otp/send", async (OtpSendRequest body, HttpContext http,
    SignalGateClient signalGate, CancellationToken ct) =>
{
    string? ip = SignalGateHttp.ClientIp(http);

    // [SignalGate] GATE — commented out on purpose.
    //   Uncomment when: Settings -> Events shows a few hundred events for BOTH
    //   "otp.send" and "otp.verified", AND a workflow for that pair is running.
    //   Until a workflow runs, this returns "allow" for everything.
    //   The gate goes BEFORE the action; the log goes AFTER it.
    //   Current policy: no envelope -> TryCreate returns false -> no check.
    // if (SignalGateEvent.TryCreate(body.Phone, ip, "otp.send",
    //         DateTimeOffset.UtcNow, body.SignalGate, out var checkEvent))
    // {
    //     try
    //     {
    //         CheckResult verdict = await signalGate.CheckAsync(checkEvent, ct);
    //         if (verdict.Action == CheckActions.Block)
    //         {
    //             return Results.Json(new { error = "Request could not be completed" }, statusCode: 403);
    //         }
    //         // dry_run_block / admin_alert / anything unknown: allow and continue
    //     }
    //     catch (SignalGateException)
    //     {
    //         // fail open on any SignalGate error; a rejected (4xx) check throws even with FailOpen on
    //     }
    // }

    await SendVerificationCodeAsync(body.Phone, ct);   // the protected action

    // [SignalGate] observe: runs AFTER the action succeeds. Log() queues and returns at once.
    // Current policy: no envelope -> TryCreate returns false -> no log.
    if (SignalGateEvent.TryCreate(body.Phone, ip, "otp.send",
            DateTimeOffset.UtcNow, body.SignalGateLog, out var logEvent))
    {
        signalGate.Log(logEvent);
    }

    return Results.Ok(new { ok = true });
});
```

DTO:

```csharp
using System.Text.Json.Serialization;
using SignalGate;

// Both envelope fields nullable and defaulting to null: a request whose browser capture
// failed must NOT be rejected here. ASP.NET Core's web JSON defaults bind "signalgate" to
// SignalGate by name; "signalgate_log" needs its JSON name spelled out.
public sealed record OtpSendRequest(
    string Phone,
    EncryptedPayload? SignalGate = null,
    [property: JsonPropertyName("signalgate_log")] EncryptedPayload? SignalGateLog = null);
```

**Both envelope fields MUST be nullable/optional.** The client is required to send the
request *without* an envelope when browser capture fails (never block the user). A required
field turns that into a validation rejection, so a failed capture would kill the user's real
action. `EncryptedPayload?` keeps MVC's implicit required check off it; the `= null` default
keeps it optional when the app sets `RespectRequiredConstructorParameters`. Nullable + the
`TryCreate` guard at the call site is the only correct shape.

## Docs-vs-code contradictions (code wins)

- The README's verdict table pairs each action with a fixed `Score`; the SDK passes the
  score through unchecked. Never gate on it.
- The published gate examples (README and docs) await `CheckAsync` without a try/catch, so a
  4xx surfaces as a 500 — see Hazards. Generated code always wraps the gate.
- The README's docs link adds a query string to the backend docs page. Link only the
  allow-listed `https://signalgate.ai/docs/backend`.
