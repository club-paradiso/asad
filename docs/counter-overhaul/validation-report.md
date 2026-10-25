# Validation report

Branch `feat/counter-mode-overhaul` (base `2e57a0a`). Everything below was run
in the cloud container on 2026-10-25. Each line says what kind of success it
is: a passing unit test is not a production result.

## 1. Repository checks

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm test` | 149 files, 1 711 tests, all passing (baseline 144 / 1 631) |
| `npm run build` | passes (Next 16, production) |
| `npm run bench:counter` | passes; writes `benchmarks/results/counter-latest.{json,md}` |
| `npm run e2e:counter` | 16 / 16 checks, 0 page errors, against the production build with `LLM_ROUTING_MODE=local` |

Not run: `npm run verify` (it includes `smoke:llm` and `soak`, which call
providers), `npm run e2e` (Live console flow; untouched by this branch),
anything needing a credential.

## 2. New and changed tests (unit — synthetic)

| File | Covers |
| --- | --- |
| `src/counter/integrity-false-positives.test.ts` | 30 faithful renderings that must verify, corruptions that must still fail, scaled amounts, 12-hour times, number words, negation exclusions |
| `src/counter/store-conditional.test.ts` | declined mutation = no write (memory) and GET-only (Redis command trace) |
| `src/app/api/counter/counter-api.test.ts` (+5) | two store calls / one write per turn; profile written only on change; vault write not awaited; join and poll rate limits |
| `src/features/counter/useCounterSession.test.tsx` (+5) | local pending → stored message; failed stays and resends; 20 s timeout retries under the same key; 401 is `unauthorised`; unchanged poll does not re-render |
| `src/features/counter/polling.test.ts` | cadence table |
| `src/features/counter/resume.test.ts` | per-tab record, expiry, malformed record, no content stored |
| `src/features/counter/counter-speech.test.ts` (+4) | endpointing shortening and its floors |
| `benchmarks/counter/counter.bench.test.ts` | corpus gate (no false positive or negative allowed), round-trip structure asserted against the route |

Existing Counter, Live and Earbud suites pass unchanged except one assertion
in the hook test that expected a send error banner to survive the next poll
(it never did on `main` either; the failed bubble is now the durable signal).

## 3. Browser end-to-end (local, production build, no provider)

```
PASS  staff sees a room code — HTWX
PASS  visitor joins in Vietnamese — 77 ms
PASS  staff sees the visitor joined — 792 ms
PASS  quick phrase reaches the visitor (/안녕하세요/) — 261 ms
PASS  quick phrase reaches the visitor (/잠시만 기다려/) — 876 ms
PASS  quick phrase reaches the visitor (/신분증|여권/) — 116 ms
PASS  sender sees their message at once, marked as translating — 63 ms
PASS  typed message settles to a definite status — failed after 1864 ms (1500 ms of that is the simulated hold)
PASS  original text never lost
PASS  staff sees the visitor's message (original text, whatever the translation did) — 188 ms
PASS  visitor survives a page reload on the same conversation
PASS  staff End asks once before acting
PASS  visitor learns the conversation ended — 821 ms
PASS  staff gets a fresh code for the next visitor — FADY
PASS  quick phrase reaches the visitor (/신분증|여권/) — 261 ms
PASS  RTL bubble keeps a Latin status code intact
16/16 checks passed; 0 page problems
```

What this proves: the two-device flow works end to end through the real
route handlers and the real polling client; the no-model path delivers across
devices in 116–876 ms on one machine; the optimistic, failed, reload, confirm
and RTL behaviours work in Chromium with iPhone 13 and Pixel 7 emulation.

What it does not prove: anything about a translation model, Redis, Vercel,
Safari, or a real phone. The typed message is **stored as failed** because no
provider is configured — the script asserts that this failure is honest
(definite status, text kept, retry offered), not that a translation happened.

Screenshots: `docs/counter-overhaul/screenshots/`.

## 4. Synthetic quality validation

`benchmarks/results/counter-latest.md`: 67 / 67 faithful renderings verified,
62 / 62 corruptions caught, 19 language pairs. Deterministic; no model.

## 5. Real-provider, human and production validation

| Item | Status |
| --- | --- |
| Provider latency and fallback/timeout rates by language pair | NOT VERIFIED — no credential, no spend |
| Translation quality by a bilingual reviewer | NOT VERIFIED |
| STT error rates | NOT VERIFIED — no audio |
| Redis round-trip timing in a region | NOT VERIFIED — structure counted, time modelled |
| Cross-instance behaviour on Vercel | NOT VERIFIED — Redis store logic unchanged and unit-tested |
| iOS Safari, Android Chrome on hardware | NOT VERIFIED — emulation only |

## 6. Classification of objectives

| Objective | Verdict |
| --- | --- |
| Architecture audit with prioritised inventory | PASS |
| Reproducible latency measurement system | PARTIAL — telemetry stages, offline model, local two-browser E2E; no production data |
| Translation latency reduction | PARTIAL — structural: 7 → 4 round trips, 500 ms live polling, 10 s budget; modelled −9…−23% p50, −4…−17% p95; **30% p95 not met** |
| Translation quality improvement | PARTIAL — validator false positives 46% → 0% on the synthetic corpus; model quality untouched and unmeasured |
| Speech recognition | PARTIAL — endpointing and hand-off changes, deterministic tests; no WER |
| Administrative translation safety | PASS for the validator layer; sensitive routing unchanged and re-asserted |
| UX/UI | PARTIAL — pending/failed states, two-tap End, resume, 44 px controls, RTL check; no device matrix, no dark-mode pass |
| Reliability | PASS for reload, timeout, idempotent retry, ordering, isolation (tested); multi-instance NOT VERIFIED |
| Security and privacy | PASS — no boundary widened; join/poll limits added |
| No spend, no deploy, no merge | PASS |
