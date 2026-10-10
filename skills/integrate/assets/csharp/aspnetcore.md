# ASP.NET Core templates

Detection markers: `Sdk="Microsoft.NET.Sdk.Web"` in the `.csproj`;
`WebApplication.CreateBuilder` in `Program.cs` (older apps: `Startup.cs` with
`ConfigureServices`); minimal-API `app.MapPost(` / `MapGroup(`; controllers deriving from
`ControllerBase` with `[ApiController]`.

**Where things go**
- singleton → `Program.cs`, `builder.Services.AddSingleton(_ => new SignalGateClient(...))` —
  or the repo's own `IServiceCollection` extension method, if it registers services there
- lifecycle → the DI container: it disposes the client on host shutdown, which delivers the
  queued log events. There is no shutdown hook to write.
- key → `builder.Configuration["SIGNALGATE_API_KEY"]` (environment variables are part of
  configuration), or the repo's existing options class / config section if it has one
- DTO → the endpoint's existing request record or class

## Singleton

Use the registration in `references/csharp.md` verbatim. If the repo already reads secrets
from a config section (for example `SignalGate:ApiKey` from user secrets or a vault), read
that key instead, and name the matching environment variable (`SignalGate__ApiKey`) in
`INTEGRATION.md`.

ASP.NET Core does not read a `.env` file. Locally the user sets `SIGNALGATE_API_KEY` in their
shell, their IDE's run configuration, or `dotnet user-secrets` — never in `appsettings*.json`
or a committed `launchSettings.json`. Still add the `.env.example` placeholder as the record of
the variable's name.

**Boot posture.** The factory runs the first time a request injects the client, not at boot.
Until the key is set, endpoints that inject `SignalGateClient` fail with a 500 (the logged
exception names the missing variable), while the rest of the app keeps working. To fail at boot instead,
resolve it once after `Build()`: `_ = app.Services.GetRequiredService<SignalGateClient>();`.
Either way, the deploy must set the key before this ships — say which posture you chose in
the Step-3 plan.

## Shutdown

Nothing to write. On a graceful stop the host disposes the container, the container disposes
the client it created through the factory, and disposing delivers the queued log events
(waiting up to `5 × LogTimeoutMs`, 5 s by default). Never register a ready-made instance:
`AddSingleton(new SignalGateClient(...))` is never disposed, so its queued events are lost at
every shutdown.

A hard kill (SIGKILL, an out-of-memory kill) still loses queued events. That's acceptable for
telemetry; note it in `INTEGRATION.md`.

## Client IP

Behind a reverse proxy or load balancer, `HttpContext.Connection.RemoteIpAddress` is the
proxy's address until forwarded headers are enabled. If the scan finds no
`UseForwardedHeaders`, add it for the repo's own proxies only: never clear `KnownProxies` /
`KnownNetworks` (`KnownIPNetworks` on .NET 10), and set `ForwardLimit` to the number of proxy
hops in front of the app.

```csharp
using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

// ...
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor;
    options.KnownProxies.Add(IPAddress.Parse("10.0.0.10"));   // the repo's real proxy
    options.ForwardLimit = 1;
});

var app = builder.Build();
app.UseForwardedHeaders();   // before the endpoints
```

Then `SignalGateHttp.ClientIp` (in `references/csharp.md`) returns the visitor's address.
Prefer this to reading `X-Forwarded-For` by hand: the middleware only trusts the hops you list.
Put the proxy address in the Step-3 plan so the user can correct it in one word.

## Handler pattern — minimal API

Use the handler block in `references/csharp.md` verbatim. Points that matter:

- gate BEFORE the protected action, log AFTER it, both behind `SignalGateEvent.TryCreate`
- the gate reads `body.SignalGate`, the log reads `body.SignalGateLog` — two captures
- `CheckAsync` is awaited; `Log` returns `void`, is not awaited, and needs no try/catch
- the gate catches `SignalGateException` only, so the request's own cancellation still
  propagates
- the 403 body carries a **generic** message

At the target-action handler (`otp.verified`), write only the observe block, reading that
request's own `SignalGateLog`.

If the repo keeps endpoints as static methods (`app.MapPost("/api/otp/send",
OtpEndpoint.HandleAsync)`), put the same body in that method — match the repo.

## Handler pattern — controllers

```csharp
using Microsoft.AspNetCore.Mvc;
using SignalGate;

[ApiController]
[Route("api/otp")]
public sealed class OtpController(SignalGateClient signalGate, IOtpSender otp) : ControllerBase
{
    [HttpPost("send")]
    public async Task<IActionResult> Send(OtpSendRequest body, CancellationToken ct)
    {
        string? ip = SignalGateHttp.ClientIp(HttpContext);

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
        //             return StatusCode(403, new { error = "Request could not be completed" });
        //         }
        //         // dry_run_block / admin_alert / anything unknown: allow and continue
        //     }
        //     catch (SignalGateException)
        //     {
        //         // fail open on any SignalGate error; a rejected (4xx) check throws even with FailOpen on
        //     }
        // }

        await otp.SendAsync(body.Phone, ct);   // the protected action

        // [SignalGate] observe: runs AFTER the action succeeds. Log() queues and returns at once.
        // Current policy: no envelope -> TryCreate returns false -> no log.
        if (SignalGateEvent.TryCreate(body.Phone, ip, "otp.send",
                DateTimeOffset.UtcNow, body.SignalGateLog, out var logEvent))
        {
            signalGate.Log(logEvent);
        }

        return Ok(new { ok = true });
    }
}
```

Inject the client through the constructor like any other singleton; `CancellationToken ct`
binds to the request's own abort token.

## DTO

Use the record in `references/csharp.md`. Before writing it, check how the repo configures
JSON:

- **A custom naming policy, or case-sensitive names** (`PropertyNamingPolicy`, or
  `PropertyNameCaseInsensitive = false`, in `ConfigureHttpJsonOptions` / `AddJsonOptions`):
  `signalgate` then stops binding by name too, just as silently. Spell out
  `[property: JsonPropertyName("signalgate")]` on `SignalGate` as well.
- **Newtonsoft.Json** (`AddNewtonsoftJson()`): `JsonPropertyName` is ignored there, and the
  SDK documents binding with System.Text.Json only. Flag it in the Step-3 plan rather than
  guessing an attribute, and make the Step-5a end-to-end check mandatory.
- **A class DTO** rather than a record: add `public EncryptedPayload? SignalGate { get; init; }`
  and `[JsonPropertyName("signalgate_log")] public EncryptedPayload? SignalGateLog { get; init; }`.
- In a positional record, keep the two envelope parameters last — they carry `= null`
  defaults.

**Both envelope fields MUST be nullable.** No `[Required]`, no validator rule that rejects a
missing envelope: a failed browser capture must never turn into a 400 on the user's real
action. `TryCreate` at the call site is the guard.
