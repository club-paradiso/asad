# ASAD Live two-lane interpretation engine

Implemented on `feat/live-two-lane-engine` after the handoff in
`docs/claude-live-two-lane-handoff.md`. This document is the architecture of
record for the two lanes, the invariants tests enforce, and what remains
unverified.

## Root cause addressed

Before this change a cloud completion sat on the critical path to the first
useful English. Even with the ultra-compact prompt the sequence was
stabilise → dispatch → server → cloud model → parse → render, so cloud latency
was interpreter latency. On a desktop Chrome where a genuine on-device
Korean→English Translator is already ready, that wait is unnecessary.

## Architecture

```
partial/stable events → stabiliser → LOGICAL TURN (monotonic id)
                                        │
             ┌──────────────────────────┴───────────────────────────┐
   Lane A: provisional                                  Lane B: contextual
   Chrome Translator, only if ready NOW                 /api/interpret, unchanged prompt/
   → provisional `current` chunks, rendered at once     glossary/Scripture/quota/telemetry
                                                        → at most ONE in flight; later turns
                                                          coalesce into ONE bounded pending unit
                                                        → result may REFINE only still-editable
                                                          provisional chunks of ITS OWN turn(s)
                                        │
                        chunk store (anticipated → current → committed)
```

### Ownership

- `src/interpreter/engine/session.ts` (`InterpretationEngine`) owns turns,
  both lanes' scheduling, legality of refinement, invalidation, memory trust,
  and lane statistics. It is framework-free and clock-injected.
- `src/interpreter/engine/turns.ts` holds the pure turn/unit data and the
  coalescing bound.
- `src/interpreter/engine/chunks.ts` gained `refinementLegality`,
  `refineProvisionalChunks` and `insertTurnChunks`. No new temporal state:
  a provisional chunk is a `current` chunk with `turnId` and `provisional`
  metadata and commits on the same dwell clock as any other.
- `src/features/live/cloud-lane.ts` is the browser's contextual lane: the
  `/api/interpret` retry ladder, quota-dead bypass and fallback order, moved
  out of the hook so they are unit-testable.
- `src/features/live/useLiveSession.ts` keeps only browser wiring: it hands
  the engine a `ProvisionalLane` backed by the already-prepared Translator and
  turns engine timings into transcript-free telemetry samples.

### Logical turns and generations

Every flushed Korean unit becomes a `LogicalTurn` with a monotonically
increasing id. Each engine instance also keeps a session `generation`, bumped
by `start()`, `stop()` and a mode change. Every asynchronous result is
checked against its turn's fate and the generation before it may touch state.

### Refinement rules (Lane B result for turns T)

| provisional chunks of T | action |
| --- | --- |
| none exist (lane off, failed, timed out, still running) | append as fresh English, in stream order: ahead of newer *editable* turns, never ahead of anything committed |
| all still `current` | replace them in place; keep the earliest provisional `at` so the dwell clock is unchanged; identical text keeps the existing chunk |
| any `committed` | discard the rewrite; keep the cloud's glossary/entities/Scripture/topic |

A cloud result that is `stale` (aborted, wrong generation) touches nothing.
Anticipated chunks from a cloud result apply only when the result is for the
newest turn and its turn is not locked.

### Memory trust

Provisional output writes chunks and nothing else. Glossary, entities,
Scripture, topic and cultural notes are absorbed only from the contextual
lane, in every non-stale case, including when its chunks were discarded. The
cloud request for turn N never receives N's own provisional English as
"recent English" context.

### Backpressure

- Cloud concurrency bound: 1 per engine.
- While a cloud request is in flight, later turns join one coalesced
  `ContextualUnit` (bounded at `MAX_COALESCED_TURNS = 6` turns / 3,500
  characters; overflow drops the oldest turn, which keeps its provisional
  English, or is restored to the stabiliser if it had none).
- The provisional lane is single-flight with an engine-clock timeout
  (`PROVISIONAL_TIMEOUT_MS = 2,500`). The timeout is decided on the tick and
  is final, so a translator that ignores its abort signal cannot hold the
  pipeline.
- Without a ready fast lane, the engine is exactly the previous single-flight
  design: the stabiliser buffer is the queue and it holds one growing unit.

### Browser Translator state matrix

| case | behaviour |
| --- | --- |
| A. desktop Chrome, Translator ready | two lanes |
| B. Translator supported, pack still preparing | cloud-first for that turn; `isReady()` is answered synchronously and never waits; two lanes from the first turn after readiness |
| C. unsupported / failed / mobile | cloud-first, deterministic floor as before |
| D. quota exhausted + Translator ready | existing bypass; the contextual lane returns without network while the provisional lane carries every turn; each turn translated on-device exactly once |
| E. quota exhausted + no Translator | existing degraded deterministic fallback, still labelled degraded |

### Invalidation

- `stop()` aborts both lanes and advances the generation; late results of
  either lane are dropped.
- `start()` on the same instance invalidates first, so a restart can never
  absorb the previous life's results.
- `setMode()` invalidates outstanding results and restores their Korean to
  the stabiliser (only Korean with no English on screen) so it is
  re-interpreted under the new mode. `setLag()` does not invalidate.

## Telemetry

Six transcript-free client stages were added to `clientLatencyStageSchema`,
`LatencyStage` and `LIVE_LATENCY_STAGES`: `stable_to_provisional`,
`stable_to_provisional_render`, `provisional_to_refinement`,
`refinement_discarded_committed`, `contextual_result_stale`,
`provisional_failed`. Each carries a duration, optional provider/model label
and an opaque id. `stable_to_safe` / `stable_to_render` keep their meaning
(when the turn's final English reached state / screen); when the contextual
lane leaves the provisional line standing, those samples point at the
provisional clocks with provider `browser-on-device`.

`InterpretationEngine.laneStats()` exposes counters (turns, applied,
refined, discarded-after-commit, stale, failed, coalesced, overflow, max
pending, max in flight). Numbers only.

## Validation performed

See `benchmarks/results/live-two-lane-2026-09-10.md` for numbers. In short:
lint, typecheck, 111 test files / 1,091 tests, production build, local smoke,
cloud-first 5-minute soak, two-lane 5-minute and 45-minute simulated soaks,
the existing normal / browser-fallback / quota-bypass E2Es and the new
two-lane E2E (`npm run e2e:live-two-lane`).

## Not validated

**Not physically validated on Chrome's downloaded Korean→English model.**
Every browser test mocks `window.Translator`. The E2E proves the
application's semantics and timing around a fast mock; it proves nothing
about the real language pack's availability, download time, quality or
latency. No cloud provider was benchmarked in this work (no credentials in the
environment). Billing and provider configuration were not changed.

## Manual validation on a real supported desktop Chrome

1. Open a desktop Chrome that exposes `window.Translator` (check in DevTools:
   `typeof Translator !== "undefined"`).
2. Open `/live`, choose Browser input, choose a lag profile, and press Start.
   Start is the user gesture that calls `Translator.create({sourceLanguage:
   "ko", targetLanguage: "en"})`; a language-pack download shows as
   "Preparing offline Korean→English backup · model download N%".
3. Wait for that banner to disappear (status `ready`). Turns before that are
   cloud-first by design.
4. Read Korean aloud, one sentence at a time.
5. Confirm a line marked `≈` (provisional) appears before the cloud answer;
   in DevTools the row has `data-provisional="true"` and a `data-turn-id`.
6. Confirm a later cloud refinement replaces that line only while it is still
   `current` (within the profile's dwell) and never after it shows as
   `committed`.
7. Confirm that with the network throttled to make `/api/interpret` slow,
   later Korean keeps producing provisional lines and at most one request is
   outstanding in the Network panel.
8. Exhaust or simulate a quota-dead cloud (a `provider: "local"` response with
   a quota reason) and confirm subsequent turns show on-device English without
   further `/api/interpret` traffic for the bypass window.
9. Test with no Translator (another browser) and confirm cloud-first
   behaviour and the deterministic degraded floor are unchanged.
10. On `/diagnostics`, read only the latency counters
    (`stable_to_provisional`, `provisional_to_refinement`,
    `refinement_discarded_committed`, …). They contain no transcript text.
