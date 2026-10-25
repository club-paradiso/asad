# Reliability, privacy and security audit

Scope: Counter Mode only (`src/counter`, `src/features/counter`,
`src/app/api/counter`, the parts of `src/lib/guard.ts` they use). Read against
`main` at `2e57a0a`; changes are on `feat/counter-mode-overhaul`.

## 1. Session authorisation and isolation — PASS (unchanged, re-verified)

| Control | Finding |
| --- | --- |
| Capability tokens | 24 random bytes, base64url, SHA-256 hashed at rest, constant-time compare. The 4-character desk code is an address, not a credential. |
| Isolation between visitors | A new session has a new code, new host hash, no guest hash; the client resets its cursor and clears messages on code change (tested on `main`, still tested). A stored resume record is keyed by code and refused with 401 by the server when it does not match — tested. |
| Second scanner | Refused with 409 before and after the first message; language change allowed only until the visitor has spoken — tested. |
| Role | Derived from the capability, never from the body — tested. |
| Review flags | Stripped from the visitor's view — tested. |

## 2. New: rate limits on join and poll — PASS (tested)

| Endpoint | `main` | this branch |
| --- | --- | --- |
| `PATCH /api/counter/session` (join) | none | 20/min per source address, in-process |
| `GET /api/counter/session` (poll) | none | 240/min per `code:token`, in-process, checked before any store read |
| `POST /api/counter/message` | 30/min per session and per address, local + shared | unchanged |

Poll limiting is deliberately per capability, never per address: visitors
behind one carrier NAT must not throttle each other. Join limiting is per
address because a code-guessing script has no capability yet. 20/min is
generous for a busy office and fatal to a scanner trying 390 625 codes.

## 3. New: whole-turn translation budget — PASS (tested at the router level)

See [provider-comparison.md](provider-comparison.md). Worst case ≈ 24 s → ≤ ≈ 10.5 s.

## 4. Message durability and idempotency — PASS

- Idempotency key per send, honoured at admission and at persistence (both
  inside the atomic mutation) — unchanged, re-tested.
- **New:** client send timeout (20 s) with retry under the same key. A request
  stuck in the network no longer jams the queue; a double translation is
  possible only when the first request is still in flight server-side, and
  the second persist then returns the first message as a duplicate — never two
  messages. Tested with fake timers.
- **New:** a message whose every retry failed stays on the sender's screen as
  failed with its text, plus Resend and Discard. Nothing typed is silently lost.
- Quick phrases and confirmations are not shown optimistically (server-side
  lookups; the quick-phrase text is an id until resolved).

## 5. Reload, suspension, refresh during translation — PASS (E2E)

`main`: a reload lost the capability; the visitor was then refused as a second
person (409) and the desk could only start a new code.

Now: code, capability and chosen language are kept in **per-tab
`sessionStorage`** and adopted on mount; the server still decides (401 →
picker, 404 → ended). Records expire at the server's 4-hour idle TTL and are
removed on End, on "change language", on a refused token and after a remote
end. **No message, translation or desk label is ever stored**
(`resume.test.ts` asserts the stored record carries none).

Privacy note for `docs/privacy.md`: this is the first browser-storage write
Counter Mode makes beyond UI preferences. It is a capability, scoped to one
tab, with a bounded lifetime, and is removed when the conversation ends.

## 6. Concurrency and multiple instances — PASS (unchanged semantics)

- Redis compare-and-set with retries, unchanged. The new conditional write
  (`mutate` returns `false`) performs no EVAL and therefore cannot lose a race:
  it only ever declines to write.
- Profile detection still runs inside the mutation on the freshest copy, so a
  concurrent sensitive turn is seen. Verified by the API test that writes the
  profile only when it changes.
- Learning Vault write now runs after the response (`next/server` `after()`),
  so a vault outage cannot delay a visitor; it never ran for sensitive
  profiles and still does not.

## 7. Sensitive-profile boundary — PASS (unchanged, re-asserted)

Pinned OpenRouter, `data_collection=deny`, strict privacy, no paid fallback, no
gateway recovery, redundant post-hoc assertion that the answering provider was
OpenRouter. Timeout or error → failure, never a different cloud. The whole-turn
budget applies to that single provider too; a budget exhaustion is a failure,
not a reroute.

## 8. Logging and telemetry — PASS with one note

- New telemetry stages (`counter_admission`, `counter_translation`,
  `counter_persist`, `counter_server_total`) carry durations, provider and
  model only. No content.
- Existing `counter_translation_failed` warning logs the provider error
  message. Provider error bodies are truncated to 400 characters upstream and
  normally contain no prompt text, but this is the one log line where a
  provider could echo content back. Recommendation (not changed here): log the
  classified `kind` rather than the message in production.

## 9. Open items (not addressed in this branch)

| Item | Risk | Note |
| --- | --- | --- |
| `x-vercel-oidc-token` is read from the request headers | Low | Vercel sets and overrides it; off-Vercel a client could supply a bogus token that merely fails at the gateway. Prefer `process.env.VERCEL_OIDC_TOKEN` where available. |
| No rate limit on `POST /api/counter/session` (create) beyond the access gate | Low | Gated by `APP_ACCESS_KEY` when configured; add a per-address limit if the deployment is open. |
| In-process limiters are per instance | Known | Documented in `rate-limit.ts`; the shared Redis limiter covers message sends. |
| Session cookie enforcement is "best-effort" without `SESSION_SECRET` or Redis | Known | Diagnostics report it. |
