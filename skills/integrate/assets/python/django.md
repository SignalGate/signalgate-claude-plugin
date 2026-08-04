# Django templates

Detection markers: `django` in the manifest; `manage.py`; `settings.py`;
`urls.py` with `path(...)`; views in `views.py` or a `views/` package; DRF if
`rest_framework` is present.

**Where things go**
- singleton → a small app-level module, e.g. `<project>/signalgate_client.py`
- lifecycle → `AppConfig.ready()` for construction; shutdown via an
  `atexit`/`SIGTERM` hook (Django has no first-class shutdown signal)
- key → `settings.py` reading `os.environ` (matching how the project reads its other
  secrets)
- DTO → DRF serializer, or manual `request.data` access in a plain view

## Settings

```python
# settings.py
SIGNALGATE_API_KEY = os.environ["SIGNALGATE_API_KEY"]
```

## Singleton (`<project>/signalgate_client.py`)

Same module as `references/python.md`, but take the key from Django settings:

```python
from django.conf import settings
...
_client = Client(settings.SIGNALGATE_API_KEY, fail_open=True)
```

## Construction + shutdown

```python
# <app>/apps.py
import atexit
from django.apps import AppConfig

class MyAppConfig(AppConfig):
    name = "myapp"

    def ready(self):
        from myproject.signalgate_client import get_client, close_client
        get_client()                 # fail fast at boot
        atexit.register(close_client)  # REQUIRED: flushes queued events
```

Note in `INTEGRATION.md` that under some WSGI/ASGI servers `atexit` may not fire on a
hard kill; queued events can be lost. That's acceptable for telemetry.

## Client IP

If the project sets `USE_X_FORWARDED_HOST` or has a proxy-trust middleware, prefer the
forwarded header; otherwise use `REMOTE_ADDR`:

```python
def client_ip(request) -> str:
    fwd = request.META.get("HTTP_X_FORWARDED_FOR")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")
```

## Handler pattern (DRF)

```python
class OtpSendView(APIView):
    def post(self, request):
        # [SignalGate] GATE — commented out on purpose.
        #   Uncomment when: Settings -> Events shows a few hundred events for BOTH
        #   "otp.send" and "otp.verified", AND a workflow for that pair is running.
        #   Until a workflow runs, this returns "allow" for everything.
        #   The gate goes BEFORE the action; the log goes AFTER it.
        # if request.data.get("signalgate"):
        #   try:
        #     verdict = get_client().check(build_event(
        #         user_id=request.data["phone"], ip=client_ip(request),
        #         method="otp.send", envelope=request.data.get("signalgate")))
        # except Exception:
        #     verdict = None
        # if verdict is not None and verdict.action == "block":
        #     return Response({"error": "Request could not be completed"}, status=403)
        #   # dry_run_block / admin_alert / unknown: allow and continue

        send_verification_code(request.data["phone"])     # the protected action

        # [SignalGate] observe: runs AFTER the action succeeds.
        try:
            get_client().log(build_event(
                user_id=request.data["phone"], ip=client_ip(request),
                method="otp.send", envelope=request.data.get("signalgate_log")))
        except Exception:
            pass

        return Response({"ok": True})
```

Django views are sync, so no threadpool offload is needed. For an `async def` view, wrap
`check()` with `asgiref.sync.sync_to_async`.

## Serializer (DRF)

```python
class OtpSendSerializer(serializers.Serializer):
    phone = serializers.CharField()
    signalgate = serializers.DictField()
    signalgate_log = serializers.DictField()
```
