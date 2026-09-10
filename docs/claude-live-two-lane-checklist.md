# Two-lane implementation checklist

Use this only after the compact-prompt performance change is on `main`.

- [x] Start from latest main and record SHA. (`4abaf169`)
- [x] Baseline existing tests and live benchmark.
- [x] Introduce explicit logical turn identity.
- [x] Add provisional on-device application through the engine, not direct React chunk mutation.
- [x] Add same-turn cloud refinement of editable provisional chunks only.
- [x] Drop stale cloud generations deterministically.
- [x] Preserve committed chunk immutability.
- [x] Preserve quota-degradation bypass.
- [x] Bound cloud concurrency and prevent starvation of later Korean.
- [x] Add transcript-free provisional/refinement telemetry.
- [x] Add focused race/cancellation tests.
- [x] Add Playwright two-lane delayed-cloud/stale-result E2E.
- [x] Run full CI, existing E2Es, 5-minute benchmark and simulated 45-minute soak.
- [x] Do not claim physical Chrome language-pack validation unless actually performed. (Not performed: every browser run mocks `window.Translator`.)
- [x] Do not enable paid provider routes or billing. (Unchanged.)

Result: `benchmarks/results/live-two-lane-2026-09-10.md`; architecture: `docs/live-two-lane-engine.md`.
