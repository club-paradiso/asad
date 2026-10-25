# Release readiness

**Verdict: ready for review and a staging deployment; not production-ready on
the evidence in this branch alone.**

## Why not "production-ready"

Every result here is one of: a deterministic test, a synthetic corpus, a
model over stated parameters, or a local two-browser run with no translation
provider. The mission's own standard — "never label a feature as
production-ready solely because it passes mocked tests" — applies.

## What is safe to ship after review

| Change | Risk | Rollback |
| --- | --- | --- |
| Validator fixes (`integrity.ts`, `negation.ts`, `number-words.ts`) | low; deterministic, 0 FP / 0 FN on corpus, existing tests pass | revert one commit |
| Conditional store write + single admission read | low; semantics tested with memory and traced Redis; CAS unchanged | revert `perf(counter)` commit |
| Vault write after response | low; `after()` on Vercel, detached elsewhere; vault never ran for sensitive profiles | same |
| Turn budget 10 s | **product decision**: late answers become earlier failures | adjust `COUNTER_TURN_BUDGET_MS` |
| Join / poll rate limits | low; 20/min/address and 240/min/token are far above human use | adjust `RATE_RULES` |
| Adaptive polling | low-medium; doubles poll rate while live (2/s per device) → Redis GET volume during active conversations roughly doubles; idle rate halves | constants in `polling.ts` |
| Local pending / failed messages | low; client only | revert `feat(counter)` commit |
| sessionStorage resume | low; capability only, per tab, bounded | same |
| Two-tap End | low; strings in 26 languages (machine-authored, reviewer should spot-check) | same |
| Endpointing shortening | medium; shorter waits can cut a speaker who pauses after a full stop | `TERMINAL_DELAY_RATIO` / `TERMINAL_DELAY_MIN_MS` in `counter-speech.ts` |

## Pre-release checklist

1. Deploy to a preview with the real Redis and provider keys.
2. Run `npm run e2e:counter https://<preview>` — expect 16/16 with the typed
   message settling to `done` instead of `failed`.
3. Watch `/api/diagnostics` → `telemetry.latency.counter_*` for a day of desk
   use; compare `counter_server_total − counter_translation` (the overhead
   this branch targets) against the model's 4 round trips.
4. Have a bilingual reviewer (Korean + one of Vietnamese/Chinese/Russian)
   judge 50 real-provider translations of `benchmarks/counter/corpus.ts`
   sources before and after — the validator is only as useful as the
   translations it guards.
5. Listen to 20 recorded desk utterances through the shortened endpointing;
   if any sentence is cut after a full stop, raise `TERMINAL_DELAY_MIN_MS`.
6. Spot-check the 26 "tap again to end" strings and 17 "discard" strings with
   native speakers.

## Recommended next actions (not in this branch)

- Recipient-side "incoming…" indicator (needs a message-revision cursor).
- Log the classified failure kind, not the provider message, on
  `counter_translation_failed`.
- Keyterm hints for Vietnamese, Russian and Chinese desk vocabulary.
- A corpus not written by the implementer; anonymised real exchanges if
  consent allows.
- Real-provider comparison harness over the corpus (see
  [provider-comparison.md](provider-comparison.md)).
