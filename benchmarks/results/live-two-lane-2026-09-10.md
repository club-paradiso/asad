# Live two-lane engine result · 2026-09-10

Base: main `4abaf169ff483a9fe96b0e1242f517eb9e8b843d`. Branch:
`feat/live-two-lane-engine`. Architecture: `docs/live-two-lane-engine.md`.

The four classes of evidence below are not comparable with each other and
are deliberately kept in separate tables.

## 1. Existing baseline (pre-two-lane, reproduced on this machine)

Local harness, no cloud credentials, forced `ultra-compact`, balanced lag,
5 simulated minutes (`npm run bench:live -- --minutes 5 --profile ultra-compact`):

| metric | value |
| --- | --- |
| segments / calls | 55 / 55 (11 calls/min) |
| tokens per call | p50 850 · p95 934 · max 950 |
| local-only stable → safe | p50 200 ms · p95 1,000 ms (engine overhead, not cloud latency) |
| max concurrent calls | 1 |
| unit tests | 108 files / 1,037 tests |
| E2E | normal 44 checks, browser fallback 7/7, quota bypass 4/4 |

After the change the same cloud-first benchmark is unchanged: 55 calls, p50
850 / p95 934 / max 950 tokens, max concurrency 1. Cloud-first 5-minute soak
7/7.

## 2. Local / simulated (virtual clock, mocked lanes)

`npm run soak:two-lane` — mocked translator 120 ms, mocked cloud 400–3,200 ms
with a 6% chance of +5,000 ms, 3% cloud failures, 2% translator failures,
seed 20260910, balanced lag, forced `ultra-compact`. The clock advances in
200 ms steps, so lane latencies are quantised upward to the next step.

| metric | 5 min | 45 min |
| --- | --- | --- |
| segments = logical turns | 55 | 499 |
| cloud calls (calls/min) | 53 (10.6) | 481 (10.69) |
| provisional applied | 54 | 487 |
| provisional failed / superseded | 1 / 0 | 12 / 0 |
| refinements applied | 5 | 43 |
| refinements discarded after commit | 42 | 391 |
| contextual kept provisional | 4 | 20 |
| contextual applied fresh (no provisional) | 1 | 12 |
| stale drops (cloud / on-device) | 0 / 0 | 0 / 0 |
| cloud failures injected | 1 | 15 |
| coalesced turns / overflow drops | 45 / 0 | 409 / 0 |
| max pending coalesced turns (bound 6) | 2 | 2 |
| max concurrent cloud calls (bound 1) | 1 | 1 |
| stable → provisional applied | p50 400 · p95 1,200 ms | p50 400 · p95 1,200 ms |
| stable → contextual accepted | p50 1,000 · p95 7,367 ms (n=6) | p50 1,000 · p95 5,867 ms (n=55) |
| provisional → refinement | p50 600 · p95 800 ms | p50 400 · p95 600 ms |
| tokens per call | p50 844 · p95 935 | p50 851 · p95 930 · max 960 |
| final chunks / segments in memory | 107 / 55 | 400 (cap) / 499 |
| peak context tokens | 946 | 960 |
| uncovered Korean beats | 0 | 0 |
| committed rewrites | 0 | 0 |
| rate-limit loop events | 0 | 0 |
| heap retained | 4.1 MB | 5.6 MB |

Reading: with balanced dwell at 2.6 s and simulated cloud latency mostly above
1 s, most contextual results arrive after the provisional line has committed
and are discarded by temporal locking, while their glossary/entity/Scripture
knowledge is still absorbed. That is the specified behaviour, not a defect;
the real discard rate depends on real cloud latency, which was not measured.

## 3. Mocked browser (Playwright, real /live UI, mocked Translator, held /api/interpret)

`npm run e2e:live-two-lane` — 16/16 checks. Translator mock answers in ~30 ms.

| metric | value |
| --- | --- |
| provisional first paint from stable Korean (page-measured, n=6) | p50 57–60 ms · p95 62–74 ms across three runs |
| target | p50 < 1,000 ms · p95 < 1,800 ms |
| cloud requests for 6 turns | 3 (coalesced), max in flight 1 |
| refinement replaced editable provisional in place | yes |
| rewrite after commit | dropped, committed text byte-identical |
| results released after End | ignored |
| quota-dead cloud with fast lane on | 1 cloud call, 3 on-device translations for 3 turns |
| telemetry stages seen | stable_to_provisional, stable_to_provisional_render, provisional_to_refinement, refinement_discarded_committed, stable_to_client_dispatch, stable_to_safe, stable_to_render; no Hangul, no English chunk text |

These numbers measure the application around a fast mock. They are not
Chrome translation latency.

Existing E2Es after the change: normal 44 checks passed, browser fallback 7/7,
quota bypass 4/4.

## 4. Real external measurements

None. No cloud provider credentials were present and Chrome's real
Korean→English language pack was not exercised. **Not physically validated
on Chrome's downloaded Korean→English model.**

## Before / after: time to first useful English

- Before: first useful English required the cloud round trip. Only local
  numbers exist (p50 200 ms of engine overhead with an instant provider); the
  single production probe on 2026-09-10 answered in 622 ms and production
  `sampleCount` was 0, so no real before-number exists.
- After, on a session with a ready Translator: first useful English no longer
  waits for the cloud. Mocked-browser first paint p50 ≈ 60 ms; simulated
  harness p50 400 ms (step-quantised). Real on-device numbers remain to be
  measured on a physical Chrome.

## Verification gate

ESLint, TypeScript, 111 test files / 1,091 tests, `next build`, local smoke,
`soak -- --minutes 5` 7/7, `soak:two-lane -- --minutes 5` 11/11,
`soak:two-lane` (45 min) 11/11, `e2e` 44, `e2e:live-fallback` 7/7,
`e2e:live-quota-bypass` 4/4, `e2e:live-two-lane` 16/16.
