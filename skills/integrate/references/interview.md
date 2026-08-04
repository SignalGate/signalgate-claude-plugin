# Interview — the three question calls

Analyze first; ask only what the scan can't settle; batch it. Everything the scan sees
becomes a stated default, not a question. `AskUserQuestion` limits: 1–4 questions per
call, 2–4 options each, header ≤12 chars, recommended option first and labelled
`(Recommended)`, never author an "Other" option. On no answer: report findings, state
defaults, stop.

## Call A — qualification (Step 2, always, 2–3 questions)

Diagnostic, not preference-gathering. **Every option must be grounded in a handler you
actually found.** Never offer a use case the repo has no funnel for — a user who picks it
forces a decline that a better-scoped question would have avoided.

1. **"What are you trying to stop?"**
   - Options are use cases in the *problem* wording from `qualification.md`, **ranked by
     scanned-handler evidence**. Never label them with internal slugs.
   - **If only ONE use case maps to a real funnel in this repo, offer exactly that one**
     plus "something else — I'll describe it". Do **not** pad to two with a use case whose
     handlers are absent.
   - Offer two only when two are genuinely evidenced (e.g. both OTP and payment handlers
     exist).

2. **"Is this happening at scale across many different devices, or is it one account/user
   you're investigating?"** — the criterion-1 test in plain words.

3. **"Is this happening now and ongoing, or are you looking into something that already
   happened?"** — the **criterion-4** test, and the one most often skipped. Options:
   *"Happening now / ongoing (Recommended)"* · *"A past incident I want to analyse"* ·
   *"Not sure — it comes and goes"*. A past-incident answer is a **decline**: envelopes are
   captured live, so traffic that already happened cannot be analysed.

**Do NOT ask an open question about the downstream conversion.** When the scan already found
the second funnel point, asking "what does success look like downstream?" conflates two
different things — *does a conversion exist* (the scan answered: yes) and *do you measure it*
(behavioural, and not a criterion). A "we don't really track that" answer then reads like a
criterion-2 failure and can wrongly decline a qualified user.

Instead **confirm what you found**, in one line inside the framing of question 1 or as a
statement before it:

> "I can see `POST /api/otp/verify` marks a successful code entry — I'll use that as the
> downstream success signal. Shout if that's the wrong one."

Precise, un-mis-scoreable, and it honours the rule that you only ask what the repo cannot
answer. See the SCORING RULE in `qualification.md`.

Score against the four criteria. Fail → decline. Pass → continue.

## Call B — scoping + placement (Step 3, up to 4 questions)

1. **"Which service should I integrate?"** — only when >1 candidate. Options are real
   paths.
2. **Scope consent** — only when the client half is a *different repo*. *"I can wire both
   the API and the client, or just the API and hand you the client contract. Which?"*
   Options name real paths: "Both — `api/` and `web/` (Recommended)" · "API only — give
   me the client snippet". Skip when both halves are one repo (state as default). Skip
   when the client is mobile/absent (no choice exists).
3. **"What is `user_id` at this handler?"** — session/JWT id · submitted email or
   username (pre-auth login has no id yet) · anonymous/session id · leave empty. Needed
   for `log()` too, not just gating; genuinely unresolvable by scan for pre-auth flows.
4. **"On a SignalGate outage, keep passing traffic?"** (`fail_open`) — "Keep the default
   — pass traffic (Recommended)" · "Fail closed — the SDK raises and my code decides".
   Asked now because it's a **constructor** argument, written even though the gate is
   commented.

*Do not ask "where does the envelope arrive?" in the common case* — when you write both
halves you **choose** the field name (`signalgate` / `signalgate_log`) and both sides
agree by construction. Ask only if the scan finds an envelope already arriving under a
different name (a prior integration).

## Call C — gate policy (Step 3, only if warranted, up to 2)

Skippable with a stated default (403 with a generic error; both envelope fields from day
one). Prefer skipping on a first run — the gate is inert until activation and the user
can edit the commented block. Offer it when the scan found an existing domain exception
worth reusing.

1. **"On a `block` verdict, what should the app do?"** — "Return 403 with a generic
   error (Recommended)" · "Allow but flag for review" · "Return a step-up / challenge
   marker" · "Raise `<the exception the scan found>`". (`dry_run_block` / `admin_alert` /
   unknown = allow-and-record — fold into the descriptions.)
2. **"Add the second envelope capture now, or at activation?"** — "Now — activation is
   one uncomment (Recommended)" · "Later — leaner during observation, more work to
   switch on". Default: now.

## Never a question — always a stated default

The scan can see these; state them with rationale, overridable in a sentence:

- **which SDK/stack** — from manifests;
- **where the singleton lives** — extend the existing wiring you found;
- **where the key comes from** — the existing config object if there is one, else env +
  `.env.example`;
- **which IP header** — from the configured proxy trust; surface in the plan for a
  one-word correction, don't ask (the scan sees *whether* proxy trust is configured, not
  which header is authoritative behind the real edge);
- **async-handler approach** — thread-offload for a blocking `check()` in an `async`
  handler.
