# Live interpretation: before / after, 2026-10-25

Every number below was produced on the audited MacBook Air M1 with **no
provider credential in use**. Where a measurement needs a real recogniser,
a real cloud model or Chrome's downloaded language pack, it says so and is
listed under *Not verified* rather than estimated.

## 1. What changed on the hot path

| Change | Where | Effect on latency | Effect on accuracy |
| --- | --- | --- | --- |
| Stateful anti-aliased resampler | `src/providers/stt/audio.ts` | none (≈6k multiply-adds per 128-sample quantum, 0.5 ms group delay) | cloud recognisers now receive true 16 kHz audio with no content folded into the speech band |
| Prayer endings as sentence boundaries | `src/interpreter/engine/stabiliser.ts` | a prayer line flushes on arrival instead of after the 900 ms quiet window (balanced) or the 2,600 ms hold ceiling | none |
| Duplicate-final guard | `src/interpreter/engine/session.ts` | one fewer cloud call per replayed final | the same English is not shown (and said) twice |
| Memoised `ChunkLine` | `src/features/live/TargetStream.tsx` | fewer React renders per recogniser event; **not measured** | none |
| Input-health monitor | capture path + console | none on the pipeline (numbers only, 2 Hz state publish) | a silent or clipping feed is named within 12 s / 3 s instead of never |

Nothing changed in lag profiles, provider deadlines, prompt size, coalescing
bounds, commit dwell or provider routing. The two-lane engine's invariants are
untouched and its race tests pass unchanged.

## 2. Engine benchmarks (virtual clock, local interpreter)

Run with the new `--local` flag so the shell's exported `GEMINI_API_KEY`
cannot route a simulated turn to a real provider (see the audit, §3.2, for why
that mattered: without it a "10-minute" run made two calls).

### `npm run bench:live -- --local` (10 simulated minutes, balanced)

| Metric | Before (`main`) | After |
| --- | --- | --- |
| segments | 111 | 111 |
| interpretation calls | 111 (11.1/min) | 111 (11.1/min) |
| provider response p50 / p95 / max | 1 / 14 / 31 ms | 0 / 1 / 4 ms |
| stable Korean → safe p50 / p95 / max | 202 / 1,001 / 1,024 ms | 200 / 1,000 / 1,001 ms |
| tokens per call p50 / max | 1,938 / 1,973 | 1,938 / 1,973 |

### `npm run bench:live -- --local --simulate-cloud` (10 min, simulated 400–3,200 ms cloud, no fast lane)

| Metric | Before | After |
| --- | --- | --- |
| interpretation calls | 103 (10.3/min) | 103 (10.3/min) |
| stable → interpretation p50 / p90 / p95 / max | 5,700 / 9,467 / 10,000 / 17,167 ms | 5,700 / 9,467 / 10,000 / 17,167 ms |
| stable Korean → safe p50 / p95 | 201 / 813 ms | 201 / 801 ms |

### `npm run soak -- --minutes 5 --local` and `npm run soak:two-lane -- --minutes 5 --local`

All 7 and all 11 checks pass before and after; call rates 11.0 and 10.6 per
minute both times; two-lane stable → provisional p50 400 ms, p95 1,200 ms both
times; heap growth negative both times.

**Reading:** the engine's dispatch behaviour is byte-for-byte the same, which
is the intended result — the changes are in capture quality, boundary
detection and observability, not in when the engine fires. The provider-
response column moving from 1→0 ms is measurement noise on a local
interpreter and is not claimed as an improvement.

The 45-minute simulated soaks are recorded in the validation report.

## 3. Capture quality (deterministic, `src/providers/stt/resampler.test.ts`)

| Measurement (2 s of tone, 128-sample quanta) | Before | After |
| --- | --- | --- |
| output samples for 96,000 input samples at 48 kHz | 31,500 (stream 1.6 % short) | **32,000** |
| output samples at 44.1 kHz, 689 quanta | 31,694 (0.95 % short) | expected ±1 |
| 1 kHz tone, measured at the output rate | 1,016 Hz | **1,000 ± 5 Hz** |
| 12 kHz tone at 48 kHz, level relative to passband | 0 dB (aliased to 4 kHz at full level) | **< −40 dB** |
| 11 kHz tone at 44.1 kHz | aliased | **< −40 dB** |
| passband level at 1 kHz | nominal | nominal (within 0.01 rms) |

This path is used only by the raw-audio recognisers (Deepgram, OpenAI). The
browser recogniser owns its own capture and is unaffected. The accuracy
*effect* on a real Korean recogniser was not measured — no credential — and is
listed below as not verified. What is verified is that the recogniser now
receives what the protocol promises it.

## 4. Dictation: boundary detection

Ten prayer closings and six open clauses, checked against the old and new
sentence rule (`node` one-liner, reproduced in the audit session):

| | Old rule | New rule |
| --- | --- | --- |
| prayer closings recognised as a sentence on arrival | 2 / 10 (only the two ending in a full stop) | **10 / 10** |
| open clauses wrongly cut | 0 / 6 | 0 / 6 |

Latency consequence at the default (balanced) lag, deterministic from
`LAG_PROFILES`: a prayer line that previously waited for the 900 ms quiet
window — or up to the 2,600 ms hold ceiling if the preacher ran straight on —
now dispatches on the tick it stabilises. That is a 0.9–2.6 s reduction in
time-to-first-English for exactly those lines, and no change for any other.

## 5. Dictation: duplicates

`duplicate-stable.test.ts`: an exact repeat (≥ 12 characters) of the previous
segment inside 2 s is dropped and produces no turn; a repeat after the window,
a short repeat ("아멘.") and a near-repeat are all kept. Counted in
`laneStats().duplicateStableDropped`. How often real recognisers do this was
not measured here (no credential); the guard is defensive and its cost is one
string comparison per final.

## 6. Not verified (and why)

| Claim | Status | What it would take |
| --- | --- | --- |
| Word/character error rate change for Korean sermon audio | **NOT VERIFIED** | a Deepgram or OpenAI credential and authorised Korean sermon audio; `bench:live` cannot measure recognition |
| Partial / final transcription latency on a real recogniser | NOT VERIFIED | same |
| Cloud model response latency | NOT VERIFIED | a provider credential; the only key in the environment was observed timing out and deliberately not spent |
| Chrome on-device Translator timing and quality | NOT VERIFIED | a manual run on a desktop Chrome with the Korean→English pack (procedure in `docs/live-two-lane-engine.md`) |
| Render-cost reduction from memoising `ChunkLine` | NOT VERIFIED | a React Profiler trace on a real session |
| End-to-end spoken-Korean → first-English in the booth | NOT VERIFIED | a physical feed; see the feasibility report |

Nothing in this document should be read as a claim about a real service. The
verified improvements are the capture arithmetic, the boundary rule and the
absence of regression in the engine's measured behaviour.
