# Live ultra-compact prompt result · 2026-09-10

Base production before this change: `1cc5846c0639ed99b6744144bc7814a10291e8ae`.

## Why

The production OpenRouter route selects the `ultra-compact` context profile, but the full sermon system contract still cost about 1,077 estimated tokens on every live call. At about 11 calls/minute, the static contract dominated the recurring request cost even after context trimming.

## Change

- add a compact system contract that preserves the live safety invariants;
- select it only when the router has already chosen `ultra-compact`;
- leave full/compact context profiles and rescue flows on the existing full contract;
- make the live benchmark use the same profile-aware system-prompt selection as production;
- add regression tests for fidelity, hallucination prevention, delayed-predicate scaffolding, uncertainty, anticipation, Scripture, register, room-address and wordplay behavior.

## Measured result

Five simulated minutes, balanced lag, forced `ultra-compact`, no cloud credentials:

- 55 segments / 55 interpretation calls / 11 calls per minute;
- tokens per call: p50 **850**, p90 **910**, p95 **934**, max **950**;
- session total: **46,871 estimated tokens**;
- previous measured baseline: p50 **1,535**, p95 **1,619** tokens/call;
- reduction: about **44.6% at p50** and **42.3% at p95**;
- max concurrent calls remains **1**.

The latency numbers from this benchmark are local-engine timings only. They are not evidence of cloud-provider latency improvement. The change reduces prompt work sent to the cloud; real production end-to-end latency still needs shared telemetry from actual live use.

## Verification

- ESLint passed;
- TypeScript passed;
- 107 test files / 1,033 tests passed;
- Next.js production build passed;
- compact prompt invariant tests passed;
- live 5-minute benchmark completed and wrote `benchmarks/results/live-5min-balanced.json`.

## Next architectural boundary

Do not keep shaving milliseconds blindly after this point. The next major intervention is a two-lane Live engine: a fast provisional on-device/browser lane where genuinely available, plus an asynchronous contextual cloud lane that may safely refine only still-editable output. That work must preserve temporal locking and must never rewrite chunks the interpreter may already have spoken.
