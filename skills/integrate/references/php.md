# PHP — `signalgate/signalgate-php`

Verified against **signalgate/signalgate-php v0.1.0**. Source of truth is the shipped
package, not our docs; contradictions are listed at the bottom.

## Install / floors

```
composer require signalgate/signalgate-php     # pin: v0.1.0
```

- PHP **>=8.1**, with the `curl` and `json` extensions (bundled with almost every PHP
  install).
- Zero Composer dependencies beyond core PHP — no `php-http` client, no PSR bridges.
- Namespace `SignalGate`; PSR-4 autoloaded (`SignalGate\` → `src/`).

## Public surface

`Client` (final), `CheckResult`, `Metrics`, `Logger`, `NoopLogger`, `Transport`,
`HttpResponse`, `PostOptions`, and the error hierarchy
`SignalGate\Errors\{SignalGateError,ConfigError,NetworkError,ServerError,TimeoutError}`.

There is **no `Event`/`EncryptedPayload` class** — unlike the Node and Python ports,
`check()`/`log()` both take a plain `array<string, mixed>`, validated at call time
rather than at construction of a typed object.

## Construct

```php
new Client([
    'api_key' => string,                     // required, non-empty after trim
    'check_timeout_ms' => int,               // 3000
    'log_timeout_ms' => int,                 // 1000
    'log_queue_capacity' => int,              // 10000
    'log_max_retries' => int,                 // 3
    'log_retry_base_ms' => int,               // 200
    'fail_open' => bool,                      // true
    'transport' => Transport|null,            // public test seam
    'logger' => Logger|null,                  // SignalGate\NoopLogger
    'sleeper' => (callable(int): void)|null,  // test seam standing in for the backoff sleep
    'register_shutdown' => bool,              // true — registers close() via register_shutdown_function()
])
```

Throws `ConfigError` when: `api_key` is blank or all-whitespace; any `*_ms` /
`*_capacity` / `*_retries` option is not a genuine non-negative PHP `int` (a numeric
string or a float is rejected, never coerced); `log_queue_capacity` is `<= 0`; or **any
key not in this list is present** — `validateUnknownKeys()` throws on the whole array,
so a typo'd option fails loudly at construction instead of silently keeping its
default. There is no `base_url` constructor option; the only override is the
`SIGNALGATE_BASE_URL` env var, read once at class-load and never exposed as a key here.

## Types

Events are associative arrays with five required top-level keys, checked **in
order** — `user_id`, `ip`, `method`, `timestamp`, `payload` — plus an optional
`custom`:

```php
$event = [
    'user_id' => string,
    'ip' => string,
    'method' => string,
    'timestamp' => string,   // ISO-8601, e.g. (new DateTimeImmutable())->format(DATE_ATOM)
    'payload' => [           // REQUIRED key; must be an array whenever it is present
        'encrypted' => string,
        'timestamp' => int,  // unix-ms, NOT the outer ISO-8601 string
        'nonce' => string,
        'v' => int,          // omit entirely if the client didn't send it
    ],
    'custom' => array,       // optional
];
```

`payload` is a **required top-level key** in this port, not a soft-optional field — if
the key is missing, or present but not an array, both calls reject the event (see
Hazards). There is no sub-validation of the four inner payload fields; they are
forwarded verbatim.

`CheckResult` — a final class with `readonly` properties, **all camelCase**, with no
snake_case surviving from the wire (a real difference from the Node port, which mirrors
the wire's `request_id` / `tenant_id` / `processing_time_us` verbatim):

```php
final class CheckResult {
    public readonly string $action;
    public readonly float $score;
    public readonly string $requestId;
    public readonly string $tenantId;
    public readonly string $timestamp;
    public readonly int $processingTimeUs;
    public readonly bool $failedOpen;
}
```

## Calls

```php
$client->check(array $event): CheckResult              // ~3s timeout, ZERO retries
$client->log(array $event): void                       // append-only; never throws, never does I/O
$client->flush(): void                                  // PHP-specific: synchronous drain now; safe on an empty buffer
$client->close(?float $deadlineSeconds = null): void     // idempotent; drains, then releases the cURL handle
$client->metrics(): Metrics                              // ->get(name, labels=[]), ->snapshot(), ->snapshotFlat()
```

`close()`/`flush()` have no single Node/Python equivalent — Node's `close(timeoutS)` and
Python's `close()` both drain *and* release in one call; here `flush()` is a distinct,
cheaper operation that drains without releasing the cURL handle, so it's safe to call
repeatedly from inside a long-lived process.

## Hazards — generated code must handle these

- **PHP-FPM has no threads or event loop, so `log()` only *buffers* — it never
  sends.** `log()` appends to a bounded in-memory queue and returns immediately;
  delivery (including the full 200/400/800 ms retry ladder) happens later, at one of
  three points: an explicit `$client->flush()` call, the shutdown hook
  (`register_shutdown`, **on by default**) which calls `close()` when the script ends,
  or an explicit `$client->close()`. **The customer's own handler must call
  `fastcgi_finish_request()` before the script ends**, or the drain runs *before* the
  HTTP response is flushed to the browser and silently adds latency to the end user's
  request — no error, no exception, just a slower response. Long-lived runtimes with no
  per-request shutdown boundary — RoadRunner, FrankenPHP, Laravel Octane, Swoole, or a
  plain CLI worker loop — must call `flush()` periodically (for example, once per
  request/job inside the loop) instead of relying on the shutdown hook, since the
  process itself never "shuts down" between units of work.
  - **Sizing note:** once `fastcgi_finish_request()` has run, `request_terminate_timeout`
    no longer bounds what follows — the drain is bounded only by `5 × log_timeout_ms`
    (5s at the `log_timeout_ms => 1000` default). A worker stays busy draining for up to
    that long after responding; raising `log_timeout_ms` raises that ceiling too, which
    on a small `pm.max_children` pool means fewer workers free to accept new requests
    while the endpoint is degraded.
- **A missing or non-array `payload` key is a hard reject, not a soft-optional
  field.** `check()` throws `ConfigError`; `log()` logs-and-drops (never throws).
  Unlike the Node/Python templates, which pass a `null` payload and let the SDK
  swallow it, **guard before the call**: when the browser envelope failed to capture,
  skip the `check()`/`log()` call for that funnel point entirely rather than passing
  an empty array.
- **Unknown constructor keys throw at construction**, not at first use — a typo'd
  option name never silently falls back to its default.
- **Any real 4xx from `check()` bypasses `fail_open` and throws**, same as every other
  port — you'll see 401 / 400 / 422; there is no 429 on this data plane. A malformed
  *2xx* body, unlike the Python port, **does** correctly respect `fail_open` here — it
  does not bypass it.
- **`log()` genuinely never throws in this port** — the wire projection it performs is
  pure array-building, with no JSON encoding on that path; encoding happens later,
  inside the `flush()`/`close()` drain loop, where every `\Throwable` is caught locally
  and counted in `metrics()->get('log_dropped_total', ...)` rather than raised. Still
  wrap it in generated code for symmetry with the other ports — that invariant lives in
  the SDK's internals, not its public contract.
- **An injected `transport` option is never closed by the `Client`** — `close()` only
  releases the cURL handle it constructed itself. If the caller passes their own
  `Transport` (tests, custom proxying), they own its lifecycle.
- Never gate on `score`. Only `block` stops the action; `dry_run_block`, `admin_alert`,
  and any unknown verdict allow and continue.

## Idiomatic integration (Laravel)

```php
// app/Support/SignalGateClient.php
namespace App\Support;

use SignalGate\Client;

final class SignalGateClient
{
    private static ?Client $instance = null;

    public static function instance(): Client
    {
        if (self::$instance === null) {
            $apiKey = config('services.signalgate.key');   // config/services.php reads env()
            if (!is_string($apiKey) || $apiKey === '') {
                throw new \RuntimeException('SIGNALGATE_API_KEY is not set');
            }
            self::$instance = new Client(['api_key' => $apiKey, 'fail_open' => true]);
        }
        return self::$instance;
    }

    public static function clientIp(\Illuminate\Http\Request $request): string
    {
        return $request->ip();   // trustworthy once TrustProxies is configured
    }

    /** @param array<string, mixed> $envelope */
    public static function buildEvent(string $userId, string $ip, string $method, array $envelope): array
    {
        return [
            'user_id' => $userId,
            'ip' => $ip,
            'method' => $method,
            'timestamp' => (new \DateTimeImmutable())->format(DATE_ATOM),   // ISO-8601 string
            'payload' => $envelope,   // forwarded verbatim; unix-ms number inside
        ];
    }
}
```

Handler — `log()` AFTER, gate BEFORE, envelope guarded:

```php
public function sendOtp(Request $request)
{
    $envelope = $request->input('signalgate');   // nullable: browser capture may have failed

    // [SignalGate] GATE — commented out on purpose.
    //   Uncomment when: Settings -> Events shows a few hundred events for BOTH
    //   "otp.send" and "otp.verified", AND a workflow for that pair is running.
    //   Until a workflow runs, this returns "allow" for everything.
    //   The gate goes BEFORE the action; the log goes AFTER it.
    // if ($envelope !== null) {
    //     try {
    //         $verdict = SignalGateClient::instance()->check(SignalGateClient::buildEvent(
    //             $request->input('phone'), SignalGateClient::clientIp($request), 'otp.send', $envelope,
    //         ));
    //     } catch (\Throwable $e) {
    //         $verdict = null;   // fail open on any SDK error
    //     }
    //     if ($verdict !== null && $verdict->action === 'block') {
    //         abort(403, 'Request could not be completed');
    //     }
    //     // dry_run_block / admin_alert / unknown: allow and continue
    // }

    $this->sendVerificationCode($request->input('phone'));   // the protected action

    // [SignalGate] observe: runs AFTER the action succeeds.
    $logEnvelope = $request->input('signalgate_log');
    if ($logEnvelope !== null) {
        SignalGateClient::instance()->log(SignalGateClient::buildEvent(
            $request->input('phone'), SignalGateClient::clientIp($request), 'otp.send', $logEnvelope,
        ));
    }

    return response()->json(['ok' => true]);
}
```

Under plain php-fpm, call `fastcgi_finish_request()` immediately before this `return`
(or from a terminating middleware) so the shutdown-hook drain never adds latency to
the response above. Under Octane, call `$client->flush()` at the end of each request
instead of relying on the shutdown hook, since the worker process never exits between
requests.

DTO (`FormRequest`):

```php
class SendOtpRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'phone' => ['required', 'string'],
            // nullable: a request whose browser capture failed must NOT be rejected here.
            'signalgate' => ['nullable', 'array'],
            'signalgate_log' => ['nullable', 'array'],
        ];
    }
}
```

**Both envelope fields MUST be nullable.** The client is required to send the request
*without* an envelope when browser capture fails (never block the user on a capture
failure) — and this port additionally needs the guard shown above, since a present-
but-empty `payload` array is a different failure mode from an absent one.

## Docs-vs-code contradictions (code wins)

- Docs claim fixed `score` values per verdict — nothing is enforced by this port
  either; a non-numeric `score` becomes `0.0`. Never gate on it.
- Docs claim a `ConfigError` for a bad key prefix — no such validation exists; a
  malformed key surfaces as a 401 on first call, not at construction.
- The README's own "Documentation" link names a per-language path that does not
  exist. The plugin's allow-listed backend docs live at `/docs/backend`, which already
  covers PHP + Composer — never invent a per-language path.
