# Go — `github.com/SignalGate/signalgate-go`

Verified against **v0.1.0** (`signalgate.Version == "0.1.0"`). Source of truth is the
shipped package.

## Install / floors

```
go get github.com/SignalGate/signalgate-go
```

- `go` **1.22**+. No third-party dependencies.

## Construct

```go
client, err := signalgate.New(apiKey string, opts ...signalgate.Option)
// Options: WithCheckTimeoutMS, WithLogTimeoutMS, WithLogQueueCapacity,
//          WithLogMaxRetries, WithLogRetryBaseMS, WithFailOpen,
//          WithTransport (public test seam), WithLogger
```

Defaults match the other ports: check 3000ms, log 2000ms, queue 10000, retries 3,
base 200ms, fail-open **true**.

**Hazard:** on error `New` returns a **nil** client. `client, _ := New(...)` followed by
`defer client.Close(...)` **panics**. Always check the error.

## Types

```go
type Event struct {
    UserID    string
    IP        string
    Method    string
    Timestamp string                 // ISO-8601 / RFC3339 string
    Payload   EncryptedPayload
    Custom    map[string]any         // optional
}

type EncryptedPayload struct {
    Encrypted string
    Timestamp int64                  // unix MILLISECONDS from the browser
    Nonce     string
    V         *int                   // omit when absent; never send null
}

type CheckResult struct {
    Action           string
    Score            float64
    RequestID        string
    TenantID         string
    Timestamp        string
    ProcessingTimeUS int
    FailedOpen       bool            // SDK-local, not from the wire
}
```

Timestamps: outer `Timestamp` = `time.Now().UTC().Format(time.RFC3339)`; `Payload.Timestamp`
= the browser's unix-ms int64, untouched.

## Calls

```go
verdict, err := client.Check(ctx, event)   // ~3s, never retries
client.Log(event)                          // enqueue-and-return, no error returned
err := client.Close(ctx)                   // REQUIRED at shutdown
snap := client.Snapshot()                  // metrics map
```

## Hazards — generated code must handle these

- **`New`'s error is load-bearing** (nil-client panic above).
- **Check is err-first.** On a 4xx, `err` is set **and** `CheckResult` is the zero value —
  so `verdict.Action == "block"` is `false`. Branch on `err` first, then on `Action`.
- **Any 4xx bypasses fail-open.** You'll see 401 / 400 / 422. No 429 exists.
- **`Log` can panic on a malformed event** (unguarded wire conversion) — wrap the call
  site with `defer recover()` if the event is built from untrusted input.
- **`Close` is mandatory** or queued events are dropped.
- Never gate on `Score` — a non-float score silently becomes `0`.

## Idiomatic integration (net/http or Gin)

```go
// internal/signalgate/client.go
package signalgate_client

import (
    "context"
    "fmt"
    "net"
    "net/http"
    "os"
    "strings"
    "time"

    signalgate "github.com/SignalGate/signalgate-go"
)

var client *signalgate.Client

func Init() error {
    apiKey := os.Getenv("SIGNALGATE_API_KEY")
    if apiKey == "" {
        return fmt.Errorf("SIGNALGATE_API_KEY is not set")
    }
    c, err := signalgate.New(apiKey, signalgate.WithFailOpen(true))
    if err != nil {
        return fmt.Errorf("signalgate: %w", err)   // never ignore this
    }
    client = c
    return nil
}

func Client() *signalgate.Client { return client }

func Close(ctx context.Context) {
    if client != nil {
        _ = client.Close(ctx)
        client = nil
    }
}

func ClientIP(r *http.Request) string {
    if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
        return strings.TrimSpace(strings.Split(fwd, ",")[0])
    }
    host, _, err := net.SplitHostPort(r.RemoteAddr)
    if err != nil {
        return r.RemoteAddr
    }
    return host
}

func BuildEvent(userID, ip, method string, env signalgate.EncryptedPayload) signalgate.Event {
    return signalgate.Event{
        UserID:    userID,
        IP:        ip,
        Method:    method,
        Timestamp: time.Now().UTC().Format(time.RFC3339),  // ISO-8601 string
        Payload:   env,                                    // unix-ms int64 inside
    }
}
```

Wiring in `main`:

```go
if err := signalgate_client.Init(); err != nil { log.Fatal(err) }
defer signalgate_client.Close(context.Background())
```

Handler — `Log` AFTER, gate BEFORE:

```go
func handleSendOTP(w http.ResponseWriter, r *http.Request) {
    var req OTPSendRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil { /* 400 */ return }

    // [SignalGate] GATE — commented out on purpose.
    //   Uncomment when: Settings -> Events shows a few hundred events for BOTH
    //   "otp.send" and "otp.verified", AND a workflow for that pair is running.
    //   Until a workflow runs, this returns "allow" for everything.
    //   The gate goes BEFORE the action; the log goes AFTER it.
    // ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
    // defer cancel()
    // verdict, err := signalgate_client.Client().Check(ctx,
    //     signalgate_client.BuildEvent(req.Phone, signalgate_client.ClientIP(r),
    //         "otp.send", req.SignalGate))
    // if err == nil && verdict.Action == "block" {
    //     http.Error(w, "Request could not be completed", http.StatusForbidden)
    //     return
    // }
    //   // err != nil: fail open. dry_run_block/admin_alert/unknown: allow and continue.

    if err := sendVerificationCode(req.Phone); err != nil { /* 5xx */ return }

    // [SignalGate] observe: runs AFTER the action succeeds.
    signalgate_client.Client().Log(signalgate_client.BuildEvent(
        req.Phone, signalgate_client.ClientIP(r), "otp.send", req.SignalGateLog))

    w.WriteHeader(http.StatusOK)
}
```

DTO:

```go
type OTPSendRequest struct {
    Phone string `json:"phone"`
    // Pointers + omitempty: a request whose browser capture failed must still decode.
    SignalGate    *signalgate.EncryptedPayload `json:"signalgate,omitempty"`
    SignalGateLog *signalgate.EncryptedPayload `json:"signalgate_log,omitempty"`
}
```

Guard at the call site: `if req.SignalGateLog != nil { ... }`.

**Both envelope fields MUST be nullable/optional.** The client is required to send the
request *without* an envelope when browser capture fails (never block the user). A required
field turns that into a validation rejection, so a failed fingerprint capture would kill the
user's real action. Nullable + a null guard at the call site is the only correct shape.

## Docs-vs-code contradictions (code wins)

- Docs claim fixed `Score` values per action — nothing is enforced.
- The README's quickstart uses `client, _ := New(...)` — that pattern nil-panics on the
  deferred `Close`. Never generate it.
