# Provider comparison

## Status: NOT VERIFIED (no credentials, no spend authorised)

No provider was called from this environment. The container has no
`OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, Vercel Gateway token or
Redis credential, and the mission forbids spending without an explicit ceiling.
Everything below is therefore an audit of the routing *configuration* and the
*harness* that a credentialed run would use — not a measurement.

## What the deployment is configured to do (`vercel.json`)

| Setting | Value | Effect on a Counter turn |
| --- | --- | --- |
| `LLM_ROUTING_MODE` | `reliable` | pinned provider first, then paid, then free — but paid providers need keys that are not in `vercel.json` |
| `LLM_PROVIDER` | `openrouter` | OpenRouter is the pinned first choice |
| `OPENROUTER_PRIMARY_MODEL` | `nex-agi/nex-n2.5-mini:free` | the model an ordinary turn reaches first |
| `OPENROUTER_QUALITY_MODEL` / escalation | `google/gemma-4-31b-it:free` / off | not used by Counter |
| `OPENROUTER_DATA_COLLECTION` | `deny` | required for the sensitive-profile path; satisfied |
| `OPENROUTER_PROVIDER_SORT` | `latency` | upstream ordering |
| `LLM_COUNTER_PREFER_OPEN` | `true` | open-weight models go first in the chain |
| `GEMINI_LLM_MODEL` | `gemma-4-26b-a4b-it` | open-weight Gemma via Google AI Studio, if a key is present |

Sensitive profiles (`refugee`, `judicial`) remain hard-pinned to OpenRouter with
`data_collection=deny`, `privacyMode=strict`, no paid fallback and no gateway
recovery. This branch does not widen that set. `counter-api.test.ts` still
asserts the fail-closed behaviour, and the restructured route evaluates the
profile inside the atomic store mutation exactly as before.

## Deadline and budget changes (verified by tests, not by a provider)

| | `main` | this branch |
| --- | --- | --- |
| Per-provider deadline | 6 000 ms | 6 000 ms (unchanged — no data to tune it on) |
| Whole-turn budget | none | 10 000 ms (`COUNTER_TURN_BUDGET_MS`) |
| Smallest attempt started | router default 700 ms | 1 200 ms (`COUNTER_MIN_ATTEMPT_MS`) |
| Gateway recovery | full 6 000 ms regardless of time spent | bounded by what is left of the budget; skipped under 1 200 ms |
| Worst case with 3 providers + gateway | ≈ 24 s | ≤ ≈ 10.5 s |

The budget trades a late answer for an earlier, honest failure the sender can
retry. That is a product judgement, stated here so a reviewer can disagree.

## How to run the comparison when a key and a cost ceiling exist

1. `npm run health:openrouter` — proves the configured slug answers structured JSON.
2. `npm run bench:llm` — the existing live-path benchmark; for Counter, add a
   runner over `benchmarks/counter/corpus.ts` that sends each `source` through
   `translateForCounter` per candidate model and scores the output with
   `runQualityBenchmark`-style checks plus `telemetry` latency stages
   (`counter_translation` now records provider and model per turn).
3. Compare **quality and latency together** per language pair; the corpus is
   deliberately heavy on status codes, dates, negation and amounts because
   those are what a fast model gets wrong.
4. Do not switch the production model on fewer than several hundred turns per
   pair, and never for sensitive profiles without re-checking the
   `data_collection` policy of the new upstream.

## Prompt size (measured locally, no provider)

`COUNTER_SYSTEM_PROMPT` is ≈ 5 900 characters, roughly 1 100–1 300 tokens on
common tokenisers; the per-turn user prompt adds 150–500. `docs/counter-mode.md`
still quotes ~400 tokens per call, which is out of date. At Groq's free 6 000
TPM that is about four Counter turns a minute, not the ten the document implies.
The prompt was not trimmed in this branch: every line is a fidelity rule, and
trimming it without a real-provider quality evaluation would be the trade this
mission forbids. Implicit prompt caching (Gemini ≥ 1 024-token prefixes,
OpenRouter upstreams that support it) already applies to a prefix this size;
`LlmUsage.cachedInputTokens` is carried through so a credentialed run can tell.
