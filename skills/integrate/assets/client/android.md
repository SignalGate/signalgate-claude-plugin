# Android half — Kotlin hand-off

Only for use when the client half is an **Android app**. This skill never writes Kotlin
into an app repo — the app lives in a separate repo and toolchain — so this file is a
**hand-off**, not something you wire yourself: pair it with the generated contract in
`assets/client/contract.md` (which carries the real field names and `method` values from
the backend you instrumented) and give both to whoever owns the app. Uses the **public**
key (43 chars, no prefix) — never the `pk_live_` API key.

Detection markers (for scope only): `build.gradle` / `build.gradle.kts` with
`com.android.application`, an `AndroidManifest.xml`.

Reference: https://signalgate.ai/docs/mobile

## Distribution — Maven Central, two lines

`app/build.gradle.kts`:

```kotlin
dependencies {
    implementation("ai.signalgate:android-sdk:0.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
```

**Both lines are required.** `get()` is a `suspend fun` and the coroutines artifact is
runtime-scope in the SDK's POM — not on the consumer compile classpath — so the app's own
`launch {}` does not compile without the second line. Always pin the versions. Floors:
minSdk 23, compileSdk 35, JVM 11.

## The three calls, exactly

| Step | Call | Note |
|---|---|---|
| construct | `SignalGate.Builder(context).key(…).build()` | once per process; `key` = the **public** key |
| warm up | `signalGate.start()` | optional; `suspend`; idempotent |
| capture | `val result = signalGate.get()` | `suspend`; read **`result.payload`** |

**`get()` does not return the envelope.** It returns a result object with a `payload`
property — read `result.payload` and forward `payload.toJson()`. Forwarding anything else
gives the backend a body it cannot read: the log is silently skipped and telemetry sits at
zero with no error anywhere.

`payload.toJson()` yields the same four-field envelope the browser SDK produces
(`encrypted`, `timestamp`, `nonce`, `v`) — opaque, forward verbatim.

## Key handling

The **public** key is client-safe by design — it may ship inside the app. The snippets
reference it as `BuildConfig.SIGNALGATE_TENANT_KEY`; wire that through the app's own build
configuration. **Never** put the `pk_live_` API key anywhere in the app.

## Application-scoped singleton

One client per process, kept for the process lifetime — a second client pays the warm-up
again and gains nothing:

```kotlin
import ai.signalgate.android.SignalGate

class App : Application() {

    // One client per process; reuse it for the process lifetime.
    lateinit var signalGate: SignalGate
        private set

    override fun onCreate() {
        super.onCreate()

        signalGate = SignalGate.Builder(this)       // context stored as applicationContext
            .key(BuildConfig.SIGNALGATE_TENANT_KEY) // REQUIRED; blank throws IllegalArgumentException
            .cacheTtlMs(30 * 60 * 1000L)            // optional; default 30 min; <= 0 disables cache
            .debug(false)                           // optional; default false
            .build()
    }
}
```

`start()` is an optional, idempotent, `suspend` warm-up so the first real `get()` is not
the one that pays for it — call it once after construction, from any coroutine scope.

## Call site

At the funnel point (login, checkout, signup). `get()` dispatches to `Dispatchers.IO`
itself, so it is safe to call from a main-thread coroutine:

```kotlin
lifecycleScope.launch {
    val result = signalGate.get()   // suspend fun; dispatches to Dispatchers.IO itself
    val payload = result.payload

    // Forward to YOUR backend. The SDK sends nothing anywhere.
    myApi.submitDeviceSignals(payload.toJson())
}
```

The SDK performs **no network I/O of its own** — the app forwards the payload to the
tenant's own backend (the one this skill instrumented), in the request body under the
agreed field names from the generated contract (`signalgate` / `signalgate_log` by
convention).

## Rules for generated client code

- **One fresh `get()` per outbound call — never resend a payload.** The `nonce` is
  single-use; a resent payload is rejected. When the backend expects both envelope
  fields, call `get()` twice — two independent payloads, never one reused. `get()` is
  cheap on a cache hit and mints a fresh `nonce` and `timestamp` every time.
- **Never persist a payload.** No `SharedPreferences`, no file, no queue. A payload
  stored and sent later is a payload the backend drops.
- **Never block the user on capture failure.** Both envelope fields are optional
  server-side — on failure, send the request without them rather than failing the
  user's action.
- **Do not add a capture to unrelated requests.** Only the instrumented funnel points.

## Permissions

The SDK's manifest declares two **normal-level, install-time** permissions (auto-granted,
no runtime prompt): `INTERNET` and `ACCESS_NETWORK_STATE`. Anything an embedded SDK
declares lands in the app's **Play Data Safety** form — the tenant-facing disclosure to
fill it from is `docs/COLLECTED-DATA.md` in the Android SDK repository; point the app
team there rather than improvising one.

If a security review objects to `ACCESS_NETWORK_STATE`, the app can remove it in its own
manifest and the SDK keeps working:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
          xmlns:tools="http://schemas.android.com/tools">
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"
                     tools:node="remove" />
</manifest>
```

## Verify

Run the app, perform the action once, then check Dashboard → Settings → Events. One round
trip proves the SDK wiring, the field names, the public key, the API key, and the `method`
value together. **If no event appears, check `result.payload` first** — forwarding
anything but `payload.toJson()` is silent.

## Checklist

- [ ] Two-line Gradle dependency — the SDK **and** `kotlinx-coroutines-android`, versions pinned
- [ ] One client per process (Application scope), reused
- [ ] `get()` fresh per call; `result.payload` read; `payload.toJson()` forwarded verbatim
- [ ] No payload ever resent or persisted
- [ ] Capture failure cannot fail the user's action
- [ ] **Public** key used, never `pk_live_`
- [ ] Play Data Safety filled from the SDK repo's `docs/COLLECTED-DATA.md`; `tools:node="remove"` opt-out known
