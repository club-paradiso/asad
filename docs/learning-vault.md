# Learning Vault and Human Review Flags

ASAD may improve its translation system from real usage, but it must not turn a translation aid into a person-scoring system.

## What is stored

Only high-confidence model translations that pass deterministic integrity checks are eligible for the Learning Vault. Before storage, identity-bearing values are replaced with typed placeholders. The vault never stores the Counter session code, desk label, participant identity, or a persistent person identifier.

Examples:

- `010-1234-5678` → `[PHONE]`
- `person@example.com` → `[EMAIL]`
- identity/passport-like identifiers → `[IDENTIFIER]`
- detected dates, times, money, names, and critical values → typed placeholders when detected

Safety-flagged turns, low-confidence turns, and translations with critical-value mismatches are excluded from learning candidates.

## Human Review Flags

Flags belong to a single message in a single session. They are not copied to a person profile and are not a recommendation to deny, investigate, report, refuse service, or take any administrative action.

Current flags:

- translation integrity mismatch
- low translation confidence
- explicit current-turn threat language
- explicit current-turn self-harm language

Only the staff-side Counter UI shows these flags. The visitor UI does not display them.

## Storage

When the existing Counter Upstash/Vercel KV REST credentials are configured, the vault uses a separate Redis sorted set (`asad:learning:v2:candidates`) capped at 5,000 de-identified candidates. Each candidate is removed 180 days after its own creation time; new writes do not extend older candidates' retention. Without shared Redis, development falls back to process memory and is explicitly non-durable.

This release intentionally has no public raw-data export endpoint. Training/export tooling should operate on reviewed, de-identified candidates rather than live Counter sessions.
