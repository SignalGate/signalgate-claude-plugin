# Qualification — is SignalGate the right tool, and how to decline well

Qualify **before** writing anything. Integrating for a problem SignalGate doesn't
address wastes the user's afternoon and burns trust when the dashboard stays empty. A
good decline is more valuable than a technically-correct integration nobody benefits
from.

## The fit test (and the safe way to explain it)

The founder sentence — already public, and both the fit test and the ceiling on what
you may say about mechanism:

> *"Fingerprinting catches one device pretending to be many. SignalGate catches the
> opposite — many genuinely different devices working as one operation — the fraud that
> device fingerprinting alone was never built to see."*

**All four criteria must hold:**

1. **Coordinated volume, not a single actor.** It's a *campaign* — many genuinely
   different devices behaving as one operation. "Is this one user suspicious?" is the
   wrong shape.
2. **A funnel with two points.** A protected action *and* a downstream conversion.

   **SCORING RULE — read this before judging criterion 2.** A two-point funnel **visible in
   the code satisfies this criterion**, even if the user says they do not currently measure
   or track the conversion. The scan is the authority here, not the user's self-report: if
   you found the downstream handler, the conversion exists and can be logged. "We don't
   measure that today" is a *reason to instrument it*, never a reason to decline. Only
   decline on criterion 2 when there genuinely is no second point — e.g. a single fire-and-
   forget endpoint with nothing downstream that distinguishes a real user.
3. **Browser-originated traffic.** Something in a browser or app produces the envelope.
   Pure server-to-server API abuse has no envelope, so no signal.
4. **Live traffic, going forward — ASK THIS ONE EXPLICITLY.** A few hundred events before a
   workflow is useful, and envelopes are single-use and short-lived, so **analysing traffic
   that already happened is impossible**. A user who wants to investigate a past incident
   passes every other criterion and is still a bad fit — so this must be tested, not
   assumed. It is Call A's third question (`references/interview.md`).

## The five use cases (map a fitting problem to one of these)

| Use case | Action → target action | The problem, in the user's words |
|---|---|---|
| OTP / SMS-pumping | `otp.send` → `otp.verified` | SMS bill climbing while signups stay flat |
| P2P deposit spam | `deposit.attempt` → `deposit.succeeded` | Approval rate sliding; payment provider asking questions |
| Card enumeration | `payment.attempt` → `payment.attempt_succeeded` | Flood of tiny failing charges; the processor quietly downgraded the account |
| Bonus abuse | `bonus.claim` → `bonus.cleared` | Promo spend with no retention; clawbacks hitting real users |
| Data scraping | `content.request` → *(user picks: save/share/purchase)* | Every blocked bot returns in minutes as a new device |
| *fallback* | `action` → `target_action` | A coordinated-abuse problem that fits the criteria but none of the five |

Two per-case notes: **data-scraping's** target action must be chosen from the user's own
product (something scrapers never do), and its content endpoints often have **no
`user_id`** for anonymous readers — ask. **Bonus-abuse's** two points can be a day apart;
that's fine, each capture is fresh at its own moment.

The published outcome copy for each case (in the marketing pages) is safe, already-public
language you may reuse to explain *why* you're instrumenting a given pair.

## Out of scope — decline these

Single-account anomaly scoring; KYC / identity / document verification; card-data fraud
scoring with no device dimension; server-to-server API abuse with no browser; content
moderation / spam-text classification; retroactive analysis of past traffic; anything
with only one funnel point.

## The decline script

When a problem doesn't fit, this is a **designed outcome**, not an error. Be
client-oriented but not salesy — the user's time is the thing you're protecting.

1. **A brief apology that doesn't grovel — one sentence.** e.g. *"This isn't something
   SignalGate would help with, and I'd rather tell you now than after we've wired it in."*
2. **Why, in product-shape terms** — the founder sentence plus whichever criterion
   failed. Never internals.
3. **What SignalGate does solve** — the five problems in plain words. If the user's
   problem is *adjacent* to an in-scope one, **name the neighbour**: e.g. *"We wouldn't
   score an individual cardholder, but if you're seeing thousands of small failing
   attempts across many devices, that's card enumeration and we do address it."* This is
   the most valuable part of a decline.
4. **Offer to re-run** if they want to instrument one of those instead. Then stop —
   no partial writes, nothing left in `.signalgate/`.
