# FastAPI templates

Detection markers: `fastapi` in the manifest; `FastAPI(` in source; `@app.post` /
`APIRouter()`; a `lifespan=` or `@app.on_event` hook.

**Where things go**
- singleton → `app/clients/signalgate_client.py` (or the repo's existing clients/ package)
- lifecycle → the existing `lifespan` async context manager; if the app uses
  `@app.on_event("startup"/"shutdown")`, extend those instead of introducing a lifespan
- key → the repo's `Settings` (pydantic-settings) class if one exists, else `os.environ`
- DTO → the existing request model for that route

## Singleton (`app/clients/signalgate_client.py`)

See `references/python.md` — use that module verbatim, adapting the key source: if the
repo has a `Settings` class, take `settings.signalgate_api_key` instead of `os.environ`
and add the field:

```python
class Settings(BaseSettings):
    ...
    # Default-empty, NOT a required field — see the warning below.
    signalgate_api_key: str = ""     # from SIGNALGATE_API_KEY
```

**Do not make this a required field with no default.** A required field means the app —
including `/healthz` — refuses to boot the moment your diff lands, for anyone who does not
yet have a key: local dev, CI, and any teammate who checks out the branch. That turns an
additive integration into a breaking change.

Instead default it to empty and fail fast **where it is used**, with a message that says
what to do:

```python
def get_client() -> Client:
    global _client
    if _client is None:
        if not settings.signalgate_api_key:
            raise RuntimeError(
                "SIGNALGATE_API_KEY is not set — add it to .env "
                "(Dashboard -> Settings -> API Keys). See INTEGRATION.md."
            )
        _client = Client(settings.signalgate_api_key, fail_open=True)
    return _client
```

Then **do not** call `get_client()` eagerly at boot (see the lifespan note below). Whichever
posture you choose, say it explicitly in the plan at Step 3 so the user is not surprised.

## Lifespan

```python
from contextlib import asynccontextmanager
from app.clients.signalgate_client import get_client, close_client

@asynccontextmanager
async def lifespan(app: FastAPI):
    # No eager get_client() here — the client is created on first use so a missing
    # key cannot stop the app (and /healthz) from booting. See the warning above.
    try:
        yield
    finally:
        close_client()    # REQUIRED: flushes queued events; no-op if never created
```

`close_client()` must be safe to call when the client was never created — guard it with
`if _client is not None`.

If the app already has a lifespan, add the two calls into it — do not create a second one.

## Async handlers: offload the blocking check

`check()` is a blocking HTTP call. In an `async def` handler:

```python
from fastapi.concurrency import run_in_threadpool
verdict = await run_in_threadpool(get_client().check, event)
```

In a sync `def` handler (FastAPI runs it in a threadpool already), call it directly.

## Handler pattern

Use the handler block in `references/python.md` verbatim. Points that matter:

- gate BEFORE the protected action, log AFTER it
- both wrapped in `try/except` — `check()` can raise on a malformed 200 even with
  fail-open, and `log()` can raise on a malformed event
- the gate raises `HTTPException(403)` with a **generic** message; never leak the verdict
  reason to the end user

## DTO

```python
from typing import Any
from pydantic import BaseModel

class OtpSendRequest(BaseModel):
    phone: str
    # Optional — see the note below; a failed browser capture must not 422 the request.
    signalgate: dict[str, Any] | None = None
    signalgate_log: dict[str, Any] | None = None
```

**Both envelope fields MUST be optional.** The client is required to send the request
*without* an envelope when browser capture fails (never block the user on a capture
failure). A required field turns that into a validation rejection — so a failed
fingerprint capture would kill the user's real action. Optional + a `None` guard at the
call site is the only correct shape.

Prefer `dict[str, Any]` over a strict envelope model: the envelope is forwarded verbatim
and a strict model risks rejecting a field the browser legitimately adds.

If the route currently takes no body model (raw `Request`), add the model rather than
hand-parsing — it gives the user validation for free.
