# Compact Live prompt verification

Pre-PR verification on 2026-09-10:

- ESLint: pass
- TypeScript: pass
- Vitest: 107 files, 1,033 tests, all pass
- Next.js production build: pass
- five-minute balanced ultra-compact harness: 55 calls, 11 calls/min
- estimated tokens/call: p50 850, p90 910, p95 934, max 950
- previous measured baseline: p50 1,535, p95 1,619
- p50 reduction: ~44.6%
- p95 reduction: ~42.3%
- max concurrent calls remained 1

The benchmark used the local interpreter and therefore does not measure cloud model latency. It validates hot-path prompt size, engine behavior and bounded state only.
