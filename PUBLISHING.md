# Publishing the SignalGate Claude Code plugin

**One repo.** It can be public or private; the same commands work either way, and
flipping between them is a visibility toggle, not a rework.

## Before you publish

Read the diff. The `skills/` bundle is what customers receive, so anything committed there
is public — treat it like release copy, not like source.

## What customers get

`/plugin install` reads `.claude-plugin/` and `skills/`. It ignores `scripts/`,
`.github/`, and `PUBLISHING.md`, so those being in the repo costs nothing — they are just
visible to anyone who browses it. Nothing sensitive is among them.

## Every release

```bash
# 1. Bump the version in .claude-plugin/plugin.json (semver).

# 2. Run the gates locally.
node scripts/frontmatter-lint.mjs

# 3. Commit, push, and tag so a customer's install is traceable to a version.
git commit -am "release: v0.1.0"
git tag signalgate--v0.1.0
git push origin main --tags
```

CI re-runs all three gates on every push, with the deny-list from the secret. A red gate
blocks the release.

## Customer install

Public repo:

```bash
/plugin marketplace add SignalGate/signalgate-claude-plugin
/plugin install signalgate@signalgate
```

Private repo — identical UX, git auth becomes the access control, invisible to anyone
without repo access:

```bash
/plugin marketplace add git@github.com:SignalGate/signalgate-claude-plugin.git
/plugin install signalgate@signalgate
```

## Verify from a clean machine

Install, then in a throwaway repo confirm the skill triggers on *"integrate SignalGate
into this repo"*, announces before touching anything, and that Step 0's install check
passes (it reads `references/vocabulary.md`).

## Before the first release

Pre-release blockers are tracked internally in `SDK_INTEGRATION_SKILL_SPEC.md` (§13/§14),
not here. Confirm they are closed before tagging.

## Recommended sequencing

Start **private** with design partners. Not because the bundle is unclean — it is clean
and self-tested — but because nothing yet validates what the skill *emits* when it runs
against a real repository. Going public later is one toggle.
