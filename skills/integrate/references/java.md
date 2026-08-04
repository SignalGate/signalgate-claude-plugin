# Java — `ai.signalgate:backend-sdk`

Verified against **0.1.0**. Source of truth is the shipped source. **This port has the
most hazards of the four — read the hazard list before generating anything.**

## Install / floors

Maven:

```xml
<dependency>
  <groupId>ai.signalgate</groupId>
  <artifactId>backend-sdk</artifactId>
  <version>0.1.0</version>
</dependency>
```

Gradle: `implementation("ai.signalgate:backend-sdk:0.1.0")`

- **Java 17+**.
- Runtime dependency: `jackson-databind` (compile scope). **See hazard 1 — pin the
  Jackson BOM.**
- Before telling a user to depend on this, confirm the artifact actually resolves from a
  clean machine; if it does not, use one of the other ports or wait.

## Construct

```java
Client client = Client.builder()
    .apiKey(apiKey)              // required
    .checkTimeoutMs(3000)        // defaults match the other ports
    .logTimeoutMs(2000)
    .logQueueCapacity(10000)
    .logMaxRetries(3)
    .logRetryBaseMs(200)
    .failOpen(true)
    .build();
```

Throws `ConfigException` on a blank key or a negative/zero numeric option. No prefix
validation. No base-URL option. **There is no public transport seam** — the builder's
`transport(...)` is package-private, so tests must stub at the HTTP boundary or wrap the
client behind the user's own interface.

## Types

```java
record EncryptedPayload(String encrypted, long timestamp, String nonce, Integer v) {}
record Event(String userId, String ip, String method, String timestamp,
             EncryptedPayload payload, Map<String, Object> custom) {}
record CheckResult(String action, double score, String requestId, String tenantId,
                   String timestamp, int processingTimeUs, boolean failedOpen) {}
```

Exceptions: `SignalGateException` (base), `ConfigException`, **`SignalGateTimeoutException`**
(note the name — not `TimeoutException`), `NetworkException`, `ServerException`.

Timestamps: outer `timestamp` = `Instant.now().toString()`; `payload.timestamp` = the
browser's unix-ms `long`.

## Calls

```java
CheckResult verdict = client.check(event);   // ~3s, never retries
client.log(event);                           // enqueue-and-return
client.close(2.0);                           // REQUIRED; SECONDS (double)
client.metrics().snapshotFlat();
```

## Hazards — generated code must handle these

1. **Pin the Jackson BOM.** A version-mismatched Jackson (e.g. Spring Boot's BOM pulling
   a different `jackson-core`) throws `NoSuchMethodError` — a `LinkageError`, i.e. an
   `Error`, so it **escapes `check()` entirely and is NOT covered by fail-open** and
   surfaces as a 500. Generated Spring Boot code must import the Jackson BOM and align
   versions, and the gate must catch `Throwable`, not just `Exception`.
2. **`close()` strands the worker thread if its deadline expires** — no full queue
   needed. Give it a realistic deadline and call it from a real shutdown hook.
3. **Java never reads the response request-id**, so a `ServerException.requestId()` may be
   a client-side UUID the server never saw. Say so when telling a user what to send
   support.
4. **Any 4xx bypasses fail-open** (401 / 400 / 422; no 429 exists).
5. **`log()` CAN throw** (`NullPointerException` on a malformed event) despite the
   README — wrap it.
6. Never gate on `score`.

## Idiomatic integration (Spring Boot)

```java
// src/main/java/com/example/signalgate/SignalGateConfig.java
@Configuration
public class SignalGateConfig {

    @Bean(destroyMethod = "")   // we close it ourselves, with a deadline
    public Client signalGateClient(@Value("${signalgate.api-key}") String apiKey) {
        return Client.builder().apiKey(apiKey).failOpen(true).build();
    }

    @Bean
    public DisposableBean signalGateShutdown(Client client) {
        return () -> client.close(2.0);
    }
}
```

`application.yml`: `signalgate.api-key: ${SIGNALGATE_API_KEY}` — the value stays in the
environment / secret manager.

Helpers:

```java
public final class SignalGateEvents {
    public static Event build(String userId, String ip, String method, SgPayload env) {
        return new Event(userId, ip, method,
                Instant.now().toString(),                      // ISO-8601 string
                new EncryptedPayload(env.encrypted(), env.timestamp(), env.nonce(), env.v()),
                null);
    }

    public static String clientIp(HttpServletRequest req) {
        String fwd = req.getHeader("X-Forwarded-For");
        if (fwd != null && !fwd.isBlank()) return fwd.split(",")[0].trim();
        return req.getRemoteAddr();
    }
}
```

Handler — `log()` AFTER, gate BEFORE:

```java
@PostMapping("/api/otp/send")
public ResponseEntity<?> sendOtp(@RequestBody OtpRequest req, HttpServletRequest http) {
    // [SignalGate] GATE — commented out on purpose.
    //   Uncomment when: Settings -> Events shows a few hundred events for BOTH
    //   "otp.send" and "otp.verified", AND a workflow for that pair is running.
    //   Until a workflow runs, this returns "allow" for everything.
    //   The gate goes BEFORE the action; the log goes AFTER it.
    //   Catch Throwable: a Jackson LinkageError is not covered by fail-open.
    // try {
    //     CheckResult verdict = signalGateClient.check(SignalGateEvents.build(
    //             req.phone(), SignalGateEvents.clientIp(http), "otp.send", req.signalgate()));
    //     if ("block".equals(verdict.action())) {
    //         return ResponseEntity.status(403).body(Map.of("error", "Request could not be completed"));
    //     }
    //     // dry_run_block / admin_alert / anything unknown: allow and continue
    // } catch (Throwable t) {
    //     // fail open
    // }

    otpService.send(req.phone());          // the protected action

    // [SignalGate] observe: runs AFTER the action succeeds.
    try {
        signalGateClient.log(SignalGateEvents.build(
                req.phone(), SignalGateEvents.clientIp(http), "otp.send", req.signalgateLog()));
    } catch (Throwable t) {
        // telemetry must never break the request
    }

    return ResponseEntity.ok(Map.of("ok", true));
}
```

DTO:

```java
public record SgPayload(String encrypted, long timestamp, String nonce, Integer v) {}
// Both envelope components are nullable — Jackson leaves them null when absent.
public record OtpRequest(String phone, SgPayload signalgate,
                         @JsonProperty("signalgate_log") SgPayload signalgateLog) {}
```

Guard at the call site: `if (req.signalgateLog() != null) { ... }`. Do **not** add
`@NotNull` / bean-validation constraints to these two fields.

**Both envelope fields MUST be nullable/optional.** The client is required to send the
request *without* an envelope when browser capture fails (never block the user). A required
field turns that into a validation rejection, so a failed fingerprint capture would kill the
user's real action. Nullable + a null guard at the call site is the only correct shape.

## Docs-vs-code contradictions (code wins)

- Docs claim fixed `score` values per action — nothing is enforced.
- README says `log()` never raises — it can.
- The README's metric table says the HTTP-error counter tracks retries; it increments on
  every failed attempt including non-retried 4xx. Don't derive retry counts from it.
