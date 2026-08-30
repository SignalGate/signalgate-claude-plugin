# Symfony templates

Detection markers: `symfony/framework-bundle` in `composer.json`; `bin/console`;
`config/services.yaml`; controllers extending `AbstractController` under
`src/Controller`.

**Where things go**
- singleton → an autowired service (`src/Service/SignalGateClient.php`) — autowiring
  handles registration; no manual `services.yaml` entry beyond the scalar argument below
- lifecycle → constructed by the container on first use; drained via a
  `kernel.terminate` listener (see below), Symfony's native answer to the FPM hazard
- key → `%env(SIGNALGATE_API_KEY)%`, bound to a constructor argument in
  `config/services.yaml`
- DTO → a plain PHP class resolved by a request-mapping argument resolver, or manual
  `$request->request` access

## Singleton

```php
// src/Service/SignalGateClient.php
namespace App\Service;

use SignalGate\Client;

class SignalGateClient
{
    private Client $client;

    public function __construct(string $signalgateApiKey)
    {
        $this->client = new Client(['api_key' => $signalgateApiKey, 'fail_open' => true]);
    }

    public function client(): Client
    {
        return $this->client;
    }
}
```

```yaml
# config/services.yaml
services:
    App\Service\SignalGateClient:
        arguments:
            $signalgateApiKey: '%env(SIGNALGATE_API_KEY)%'
```

Symfony resolves `%env(SIGNALGATE_API_KEY)%` from the process environment (`.env`,
`.env.local`, or the real deployment environment) at container-compile time — no
direct `getenv()` call anywhere in application code.

## Shutdown — `kernel.terminate` (Symfony's answer to the FPM hazard)

Same underlying hazard as every PHP integration: `log()` only buffers, and delivery
must happen after the response is sent, not before it. Symfony's native mechanism for
"run this after the response" is a `kernel.terminate` listener — the idiomatic place
to call `flush()`, instead of relying on the `Client`'s own `register_shutdown` hook or
a manual `fastcgi_finish_request()` call:

```php
// src/EventListener/SignalGateTerminateListener.php
namespace App\EventListener;

use App\Service\SignalGateClient;
use Symfony\Component\HttpKernel\Event\TerminateEvent;

class SignalGateTerminateListener
{
    public function __construct(private SignalGateClient $signalGate)
    {
    }

    public function __invoke(TerminateEvent $event): void
    {
        $this->signalGate->client()->flush();   // runs AFTER the response is sent
    }
}
```

```yaml
# config/services.yaml
services:
    App\EventListener\SignalGateTerminateListener:
        tags:
            - { name: kernel.event_listener, event: kernel.terminate }
```

Because `kernel.terminate` fires after the response has already reached the client
(the HttpKernel's own equivalent of `fastcgi_finish_request()`), draining here never
adds latency to the request that triggered it. Construct the `Client` with
`'register_shutdown' => false` when this listener is registered, so the buffer is not
drained twice.

## Client IP

```php
$request->getClientIp();
```

Only trustworthy once `framework.trusted_proxies` (and usually
`framework.trusted_headers`) is configured in `config/packages/framework.yaml` for the
real proxy chain; otherwise it returns the proxy's own address, not the visitor's.

## Handler pattern

```php
class OtpController extends AbstractController
{
    #[Route('/api/otp/send', methods: ['POST'])]
    public function send(Request $request, SignalGateClient $signalGate): JsonResponse
    {
        $envelope = $request->request->all('signalgate') ?: null;

        // [SignalGate] GATE — commented out on purpose.
        //   Uncomment when: Settings -> Events shows a few hundred events for BOTH
        //   "otp.send" and "otp.verified", AND a workflow for that pair is running.
        //   Until a workflow runs, this returns "allow" for everything.
        //   The gate goes BEFORE the action; the log goes AFTER it.
        // if ($envelope !== null) {
        //     try {
        //         $verdict = $signalGate->client()->check([
        //             'user_id' => $request->request->get('phone'),
        //             'ip' => $request->getClientIp(),
        //             'method' => 'otp.send',
        //             'timestamp' => (new \DateTimeImmutable())->format(DATE_ATOM),
        //             'payload' => $envelope,
        //         ]);
        //     } catch (\Throwable $e) {
        //         $verdict = null;   // fail open on any SDK error
        //     }
        //     if ($verdict !== null && $verdict->action === 'block') {
        //         throw new AccessDeniedHttpException('Request could not be completed');
        //     }
        //     // dry_run_block / admin_alert / unknown: allow and continue
        // }

        $this->sendVerificationCode($request->request->get('phone'));   // the protected action

        // [SignalGate] observe: runs AFTER the action succeeds.
        $logEnvelope = $request->request->all('signalgate_log') ?: null;
        if ($logEnvelope !== null) {
            $signalGate->client()->log([
                'user_id' => $request->request->get('phone'),
                'ip' => $request->getClientIp(),
                'method' => 'otp.send',
                'timestamp' => (new \DateTimeImmutable())->format(DATE_ATOM),
                'payload' => $logEnvelope,
            ]);
        }

        return $this->json(['ok' => true]);
    }
}
```

## DTO / validation

```php
class SendOtpRequest
{
    public string $phone;

    // nullable: a request whose browser capture failed must NOT be rejected here.
    public ?array $signalgate = null;
    public ?array $signalgateLog = null;
}
```

**Both envelope properties MUST be nullable.** Whether resolved via a Symfony request
payload mapper or read manually off `$request->request`, a required envelope turns a
failed browser capture into a rejected request — the action itself must never be
gated on telemetry having arrived.
