# ASAD Live interpretation performance recovery strategy

## Diagnosis

The current production path is not primarily failing because the Vercel app is crashing. The bigger problems are architectural latency and capacity mismatches:

1. Production uses `nex-agi/nex-n2.5-mini:free` through OpenRouter. The unfunded allowance is 50 requests/day, while the measured Live workload is about 11 requests/minute, or roughly 503 requests for a 45-minute service. The configured primary therefore cannot sustain a full service.
2. `balanced` mode intentionally waits for transcript stability before dispatch, and the LLM path may then spend several more seconds inside its provider deadline. One slow in-flight turn also delays later stable speech because the engine is single-flight.
3. The only configured production STT is browser Web Speech. It is useful as a zero-credential default but is not a robust streaming booth STT service and its finalisation timing is outside ASAD's control.
4. The current Live prompt is still large enough to matter on every turn. The schema-enforced sermon system prompt is about 1,077 estimated tokens; the current ultra-compact path measures about 1,535 tokens at p50 per call.
5. The browser Translator fallback is real only on supported desktop Chrome. Other browsers and mobile devices fall back to the deterministic helper, which is not a general Korean-to-English interpreter.

## Recovery sequence

### P0: stop repeated known-doomed cloud waits

When a supported desktop Chrome session already has the Korean→English on-device Translator ready, remember quota/rate-limit failures locally and skip cloud for subsequent turns during a bounded cooldown. Do not suppress cloud after ordinary network or 5xx failures. Do not enter cooldown when a real browser translator is unavailable.

This is the first patch because it removes repeated dead time without changing provider billing, models, normal successful routing, or translation semantics.

### P1: reduce normal-quota latency

Measure and optimise the healthy path separately:

- create a smaller Live system contract for the ultra-compact profile while preserving output/schema and interpretation-safety invariants;
- compare token count and existing quality/acceptance fixtures before merging;
- use the shared `stable_to_client_dispatch`, `provider_response`, and `stable_to_render` telemetry to distinguish STT/stabiliser delay from provider delay;
- adjust `balanced` stabilisation or provider deadlines only after enough real samples exist.

### P2: make a 45-minute service actually sustainable

Code cannot manufacture provider capacity. A production-grade configuration needs one cloud route that can sustain the measured call rate for a full service. Any paid-capable route or billing change requires explicit operator approval. If a free route is selected, its privacy and quota characteristics must be acceptable for the deployment.

### P3: replace the WebSpeech-only booth dependency

Add a real streaming STT route with explicit credentials and health/readiness checks, while retaining WebSpeech as a zero-credential fallback. This is likely to matter more than shaving another few hundred milliseconds from React once healthy-path provider latency is already sub-second.

### P4: two-lane Live engine if latency is still unacceptable

For supported clients, render a fast provisional translation locally/on-device, then let the cloud path asynchronously replace or refine it with contextual terminology, scripture and discourse handling. This requires provisional chunk identity/versioning, stale-result cancellation, correction UX, and new concurrency tests.

## Who should implement what

The P0 and P1 changes are narrow, testable edits in the current repository and are best implemented directly through the GitHub/Vercel workflow used for this project.

The P4 two-lane engine is a better Claude Code task because it benefits from long-lived local repository context and repeated real-browser/device runs. It should be handed off only after the smaller changes and real telemetry show that the current single-lane architecture remains the limiting factor.

## Guardrails

- Do not enable or purchase paid provider capacity without explicit approval.
- Do not claim Chrome's real Korean→English language pack is verified from CI; current browser tests mock the Translator API.
- Do not present local-only benchmark provider latency as cloud-model latency.
- Do not optimise by silently lowering translation correctness, schema validity, privacy constraints, or long-session boundedness.
