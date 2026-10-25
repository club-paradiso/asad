# Before / after

Baseline: `main` at `2e57a0a`. Branch: `feat/counter-mode-overhaul`. Each row
names the kind of evidence; "model" rows are arithmetic over stated inputs,
not measurements (see [latency-baseline.md](latency-baseline.md) §1).

## Translation integrity validators — measured (deterministic, same corpus)

| | `main` | branch | Evidence |
| --- | --- | --- | --- |
| Faithful renderings wrongly flagged | 31 / 67 (46.3%) | 0 / 67 | `npm run bench:counter`; `main` figure from the same corpus run against the `main` validators |
| Corruptions missed | 1 / 62 (1.6%) | 0 / 62 | same |
| Negation check languages | 19 | 19 (same; exclusions added) | `negation.ts` |
| Value kinds | 9 | 10 (+ duration) | `types.ts` |

Caveat: corpus authored alongside the fixes. See the quality report.

## Server path — measured structure (instrumented store in tests)

| | `main` | branch |
| --- | --- | --- |
| Serial Redis round trips per ordinary model turn, sender path | 7 (6 for unclassified sessions) | 4 |
| Store calls per turn (`update` / writes) | 3 / 2 (+ `get` 1) | 2 / 1 |
| Learning Vault write | awaited before response | after response |
| Worst-case translation wall clock before "failed" | ≈ 24 s (3 × 6 s + 6 s gateway) | ≤ ≈ 10.5 s |
| Join rate limit | none | 20/min/address |
| Poll rate limit | none | 240/min/capability |

## Delivery — model (stated parameters) and local measurement

| Scenario | p50 recipient delivery before → after | p95 before → after |
| --- | --- | --- |
| same-region Redis, fast model | 2 425 → 1 999 ms (−18%) | 4 186 → 3 721 ms (−11%) |
| cross-region Redis, fast model | 3 346 → 2 562 ms (−23%) | 5 152 → 4 283 ms (−17%) |
| same-region Redis, slow model | 4 412 → 4 005 ms (−9%) | 8 431 → 8 052 ms (−4%) |
| cross-region Redis, slow model, mobile data | 5 587 → 4 816 ms (−14%) | 9 578 → 8 839 ms (−7%) |

Local two-browser measurement (production build, in-memory store, no provider;
`benchmarks/results/counter-e2e-local.json`): quick-phrase click on the desk
→ text visible on the phone, including opening the phrase bar: **116, 261,
261, 876 ms** across four sends (the 876 ms sample is a poll that had just
missed the write: ≈ 500 ms phase + UI). `main` was not run under the same
script; with a 1 200 ms fixed interval its worst case would be ≈ 1.5 s.

**The 30% P95 objective is not met and is reported as such.** P95 is
provider-bound; this branch does not change the model or the prompt.

## Sender experience — measured locally

| | `main` | branch |
| --- | --- | --- |
| Own message visible after Send | when the server answers (typically 1.5–6 s) | **63–81 ms** (local pending bubble) |
| Failed send | banner, message gone | bubble stays with text, Resend, Discard |
| Hung request | queue blocked indefinitely | 20 s timeout, idempotent retry (unit-tested) |

## Reliability — measured locally (E2E)

| Scenario | `main` | branch |
| --- | --- | --- |
| Visitor reloads mid-conversation | refused as a second visitor (409), stranded | back on the same conversation (E2E check) |
| Desk reloads | session orphaned | resumed from the same code (unit-tested store; not in E2E) |
| Accidental End | immediate for both parties | two-tap confirm (E2E check) |
| Other side ends | poll 404 → closing screen | unchanged; 821 ms to the visitor's closing screen in E2E |

## Speech — model (deterministic function, no audio)

| | `main` | branch |
| --- | --- | --- |
| Trailing-silence wait after a punctuated final segment (ko / en / zh) | 1 500 / 1 700 / 1 900 ms | 1 020 / 1 020 / 1 140 ms |
| Unpunctuated segment | unchanged | unchanged |
| Transcript hand-off | after `AudioContext.close()` and socket close | immediately; teardown proceeds in the background |

WER/CER: not measured (no audio, no recogniser credential).

## Tests

| | `main` | branch |
| --- | --- | --- |
| Files / tests | 144 / 1 631 | 149 / 1 711 |
| lint, typecheck | clean | clean |
| `next build` | passes | passes |

## Regressions found

None in the suite. Behavioural changes a reviewer should weigh:

- A send error banner is still cleared by the next successful poll (as on
  `main`); the failed bubble now carries the persistent state instead.
- Stored resume records are a new (bounded, content-free) browser-storage
  write.
- Translation attempts that cannot finish inside the 10 s budget fail earlier
  than before rather than succeeding late.
