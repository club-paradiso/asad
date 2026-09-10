# Two-lane implementation checklist

Use this only after the compact-prompt performance change is on `main`.

- [ ] Start from latest main and record SHA.
- [ ] Baseline existing tests and live benchmark.
- [ ] Introduce explicit logical turn identity.
- [ ] Add provisional on-device application through the engine, not direct React chunk mutation.
- [ ] Add same-turn cloud refinement of editable provisional chunks only.
- [ ] Drop stale cloud generations deterministically.
- [ ] Preserve committed chunk immutability.
- [ ] Preserve quota-degradation bypass.
- [ ] Bound cloud concurrency and prevent starvation of later Korean.
- [ ] Add transcript-free provisional/refinement telemetry.
- [ ] Add focused race/cancellation tests.
- [ ] Add Playwright two-lane delayed-cloud/stale-result E2E.
- [ ] Run full CI, existing E2Es, 5-minute benchmark and simulated 45-minute soak.
- [ ] Do not claim physical Chrome language-pack validation unless actually performed.
- [ ] Do not enable paid provider routes or billing.
