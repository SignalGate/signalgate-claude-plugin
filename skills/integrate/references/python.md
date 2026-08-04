# Python — `signalgate`

Verified against **signalgate 0.3.2**. Source of truth is the shipped package, not our
docs; contradictions are listed at the bottom.

## Install / floors

```
pip install signalgate        # pin: signalgate==0.3.2
```

- Python **≥3.10** (uses PEP-604 unions).
- Sole runtime dependency: `requests>=2.28`. Ships `py.typed`, so exported types are
  visible to the user's mypy.
- Read the running version via `signalgate.SDK_VERSION`. There is **no**
  `signalgate.__version__`.

## Public surface (this is the whole of it)

`SDK_NAME`, `SDK_VERSION`, `Client`, `Event`, `EncryptedPayload`, `CheckResult`,
`Metrics`, `Logger`, `NoopLogger`, `Transport`, `HttpResponse`, `SignalGateError`,
`ConfigError`, `TimeoutError`, `NetworkError`, `ServerError`.

`HttpTransport` is **not** public — don't import it.

## Construct

```python
Client(
    api_key: str,                      # only positional arg
    *,                                 # everything below is keyword-only
    check_timeout_ms: int = 3000,
    log_timeout_ms: int = 2000,
    log_queue_capacity: int = 10000,
    log_max_retries: int = 3,
    log_retry_base_ms: int = 200,
    fail_open: bool = True,
    http: Transport | None = None,     # public test seam
    logger: Logger | None = None,
) -> None
```

Raises `ConfigError` on a blank `api_key` or a negative/zero numeric option. **No port
validates the key prefix** — a typo surfaces as a 401 on first call, not at construction.
There is no `base_url` argument and no `Client.from_env()`; the SDK reads no env var for
the key — the user's code passes it in.

## Data types (all frozen dataclasses)

```python
Event(user_id: str, ip: str, method: str, timestamp: str, payload: EncryptedPayload,
      custom: dict[str, Any] | None = None)

EncryptedPayload(encrypted: str, timestamp: int, nonce: str, v: int | None = None)
EncryptedPayload.from_mapping(data: dict) -> EncryptedPayload   # raises KeyError/ValueError

CheckResult(action: str, score: float, request_id: str, tenant_id: str,
            timestamp: str, processing_time_us: int, failed_open: bool = False)
CheckResult.failed_open_result() -> CheckResult                  # correct manual fallback
```

**Two timestamps, never unified:** outer `Event.timestamp` is an **ISO-8601 string**
(`datetime.now(timezone.utc).isoformat()`); inner `payload.timestamp` is a **unix-ms int**
straight from the browser.

## Calls

```python
client.check(event: Event) -> CheckResult    # ~3s timeout, never retries
client.log(event: Event) -> None             # enqueue-and-return
client.close() -> None                       # REQUIRED at shutdown
client.metrics.snapshot_flat() -> dict       # for the user's own alerting
```

## Hazards — generated code must handle these

- **Any 4xx bypasses fail-open and propagates.** You'll see 401 / 400 / 422. (There is
  no 429 on this data plane — don't warn about rate limits.)
- **A malformed 200 raises out of `check()` *despite* `fail_open=True`** — the response
  parse sits outside the fail-open guard, so a non-numeric `score` raises
  `ValueError`/`TypeError`. Always wrap `check()` and fall back to allow.
- **`log()` CAN raise**, despite the README saying it never does — the wire conversion is
  unguarded, so a malformed event throws. Always wrap `log()`.
- **`close()` is mandatory** or queued events are dropped at exit.
- Never gate on `score`. Only `block` blocks.

## Idiomatic integration (FastAPI)

```python
# app/clients/signalgate_client.py
import os
from datetime import datetime, timezone
from typing import Any
from signalgate import Client, Event, EncryptedPayload

_client: Client | None = None

def get_client() -> Client:
    global _client
    if _client is None:
        api_key = os.environ["SIGNALGATE_API_KEY"]   # value lives in .env / secret manager
        _client = Client(api_key, fail_open=True)
    return _client

def close_client() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None

def build_event(*, user_id: str, ip: str, method: str,
                envelope: dict[str, Any]) -> Event:
    return Event(
        user_id=user_id,
        ip=ip,
        method=method,
        timestamp=datetime.now(timezone.utc).isoformat(),   # ISO-8601 string
        payload=EncryptedPayload.from_mapping(envelope),    # unix-ms int inside
    )

def client_ip(request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""
```

Lifespan wiring:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    get_client()
    try:
        yield
    finally:
        close_client()
```

Handler — note `log()` AFTER, gate BEFORE:

```python
@app.post("/api/otp/send")
async def send_otp(body: OtpSendRequest, request: Request):
    # [SignalGate] GATE — commented out on purpose.
    #   Uncomment when: Settings -> Events shows a few hundred events for BOTH
    #   "otp.send" and "otp.verified", AND a workflow for that pair is running.
    #   Until a workflow runs, this returns "allow" for everything — enabling it
    #   early adds latency and no protection.
    #   The gate goes BEFORE the action; the log goes AFTER it.
    # try:
    #     verdict = await run_in_threadpool(
    #         get_client().check,
    #         build_event(user_id=body.phone, ip=client_ip(request),
    #                     method="otp.send", envelope=body.signalgate),
    #     )
    # except Exception:
    #     verdict = None                      # fail open on any SDK error
    # if verdict is not None and verdict.action == "block":
    #     raise HTTPException(status_code=403, detail="Request could not be completed")
    #   # dry_run_block / admin_alert / anything unknown: allow and continue

    await send_verification_code(body.phone)      # the protected action

    # [SignalGate] observe: runs AFTER the action succeeds.
    try:
        get_client().log(build_event(
            user_id=body.phone, ip=client_ip(request),
            method="otp.send", envelope=body.signalgate_log,
        ))
    except Exception:
        pass                                      # telemetry must never break the request

    return {"ok": True}
```

`check()` is blocking — in an `async` handler always offload it
(`fastapi.concurrency.run_in_threadpool`), as above.

DTO:

```python
class OtpSendRequest(BaseModel):
    phone: str
    # Optional: a request whose browser capture failed must NOT be rejected here.
    signalgate: dict[str, Any] | None = None      # envelope for the gate
    signalgate_log: dict[str, Any] | None = None  # envelope for the log
```

**Both envelope fields MUST be optional.** The client is required to send the request
*without* an envelope when browser capture fails (never block the user on a capture
failure). A required field turns that into a validation rejection — so a failed
fingerprint capture would kill the user's real action. Optional + a `None` guard at the
call site is the only correct shape.

## Docs-vs-code contradictions (code wins)

- Docs claim `score` takes fixed values per action — the SDK enforces nothing; a
  non-numeric score silently becomes `0`. Never gate on it.
- Docs and README claim `log()` never raises — it can.
- Docs claim a `ConfigError` for a bad key prefix — no such validation exists.
