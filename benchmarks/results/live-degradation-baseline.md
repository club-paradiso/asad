# Live degradation baseline · 2026-09-10

Target branch base: main `6165c6b573b3590fe22b2e24fdb7686fc3e38841`.

## Current hot path

- Schema-enforced sermon system prompt: 1,077 estimated tokens.
- Schema-enforced general system prompt: 726 estimated tokens.
- 5-minute `ultra-compact` live pipeline simulation: 55 segments / 55 calls (11 calls/min).
- Tokens per call: p50 1,535; p90 1,595; p95 1,619; max 1,635.
- Local-only stable→safe: p50 200 ms; p95 1,000 ms.
- This benchmark had no cloud credentials. Provider latency in this run is local engine overhead and must not be presented as a cloud-model latency measurement.

## Production provider check

A single production OpenRouter health probe on 2026-09-10 returned a valid structured response from `nex-agi/nex-n2.5-mini:free` in 622 ms. The account remained on the free tier and cannot sustain a 45-minute service at the measured ~11 calls/min workload.

## First intervention

When a supported desktop Chrome session already has the on-device Korean→English Translator ready:

- a daily/quota exhaustion response suppresses known-doomed cloud turns for 90 minutes;
- a generic HTTP 429 suppresses cloud for 60 seconds;
- ordinary network/5xx failures do not suppress cloud;
- if the browser translator is unavailable, cloud is not suppressed and the deterministic helper cannot trap the session offline.

Verified before PR with lint, typecheck, 106 test files / 1,028 tests, production build, local smoke, 5-minute soak, existing browser fallback E2E 7/7, and quota-bypass E2E 4/4.
