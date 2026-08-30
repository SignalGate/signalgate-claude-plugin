# Laravel templates

Detection markers: `laravel/framework` in `composer.json`; `artisan`; `app/Providers`
(and, on Laravel 11+, the slimmer `bootstrap/providers.php`).

**Where things go**
- singleton → a service provider (`app/Providers/SignalGateServiceProvider.php`),
  bound via `$this->app->singleton(...)`
- lifecycle → constructed at boot; drained per the hazard below — there is no
  first-class Laravel "shutdown" hook under classic php-fpm
- key → `config/services.php` reading `env('SIGNALGATE_API_KEY')` — read through
  config, never `env()` directly at the point of use
- DTO → a `FormRequest`

## Singleton

```php
// app/Providers/SignalGateServiceProvider.php
namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use SignalGate\Client;

class SignalGateServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(Client::class, function () {
            $apiKey = config('services.signalgate.key');
            if (!is_string($apiKey) || $apiKey === '') {
                throw new \RuntimeException('SIGNALGATE_API_KEY is not set');
            }
            return new Client(['api_key' => $apiKey, 'fail_open' => true]);
        });
    }
}
```

```php
// config/services.php
'signalgate' => [
    'key' => env('SIGNALGATE_API_KEY'),
],
```

**Never call `env()` directly at the point of use** — only inside
`config/services.php`. Laravel's config caching (`php artisan config:cache`, standard
in production deploys) snapshots `config/services.php` once at cache time and stops
reading `.env` afterward; an `env()` call anywhere else in the app silently reads
`null` post-cache even though the real value is set — the client constructs with a
blank key and every event 401s, with no error at boot.

## Shutdown — the FPM hazard, Laravel-specific answer

The `Client`'s `register_shutdown` hook is on by default and works as-is under
classic php-fpm, but only once the response has actually reached the browser. Call
`fastcgi_finish_request()` from a terminating middleware so it runs after every
response, not just one route:

```php
// app/Http/Middleware/FinishRequestForSignalGate.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class FinishRequestForSignalGate
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);
        if (function_exists('fastcgi_finish_request')) {
            $response->send();
            fastcgi_finish_request();
        }
        return $response;
    }
}
```

Register it late in the HTTP kernel's middleware stack so it wraps the whole request.

**Under Octane** (Swoole/RoadRunner workers with no per-request process teardown),
the shutdown hook never fires between requests, and `fastcgi_finish_request()` is a
no-op outside classic php-fpm. Call `app(Client::class)->flush()` at the end of each
request instead — a `terminating()` callback registered in
`AppServiceProvider::boot()` is the idiomatic hook.

## Client IP

```php
$request->ip();   // Illuminate\Http\Request::ip()
```

Only trustworthy once `TrustProxies` (Laravel 11: `bootstrap/app.php`'s
`->withMiddleware(fn ($m) => $m->trustProxies(...))`) is configured for the real proxy
chain; otherwise it returns the proxy's own address, not the visitor's.

## Handler pattern

```php
class OtpController extends Controller
{
    public function send(SendOtpRequest $request)
    {
        $envelope = $request->validated('signalgate');

        // [SignalGate] GATE — commented out on purpose.
        //   Uncomment when: Settings -> Events shows a few hundred events for BOTH
        //   "otp.send" and "otp.verified", AND a workflow for that pair is running.
        //   Until a workflow runs, this returns "allow" for everything.
        //   The gate goes BEFORE the action; the log goes AFTER it.
        // if ($envelope !== null) {
        //     try {
        //         $verdict = app(Client::class)->check([
        //             'user_id' => $request->validated('phone'),
        //             'ip' => $request->ip(),
        //             'method' => 'otp.send',
        //             'timestamp' => now()->toAtomString(),
        //             'payload' => $envelope,
        //         ]);
        //     } catch (\Throwable $e) {
        //         $verdict = null;   // fail open on any SDK error
        //     }
        //     if ($verdict !== null && $verdict->action === 'block') {
        //         abort(403, 'Request could not be completed');
        //     }
        //     // dry_run_block / admin_alert / unknown: allow and continue
        // }

        SendVerificationCode::for($request->validated('phone'));   // the protected action

        // [SignalGate] observe: runs AFTER the action succeeds.
        $logEnvelope = $request->validated('signalgate_log');
        if ($logEnvelope !== null) {
            app(Client::class)->log([
                'user_id' => $request->validated('phone'),
                'ip' => $request->ip(),
                'method' => 'otp.send',
                'timestamp' => now()->toAtomString(),
                'payload' => $logEnvelope,
            ]);
        }

        return response()->json(['ok' => true]);
    }
}
```

## FormRequest (DTO)

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

**Both envelope fields MUST be nullable.** A required rule turns a failed browser
capture into a `422` on the user's real action — never gate the action itself on
telemetry having arrived.
