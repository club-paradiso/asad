# Cost

Estimates for the default configuration — **Deepgram nova-3** for speech and a
mid-tier chat model for interpretation. All figures are list prices at time of
writing; treat the *shape* as durable and the numbers as indicative.

---

> **Updated for Phase 2 with measured figures.** Phase 1's estimates
> (7.5 calls/min, 1,900 tokens/call) were optimistic. `npm run bench:live` now
> measures **11.17 calls/min at ~2,718 tokens/call — about 30,360 TPM**. The
> tables below use the measured numbers.

## The zero-cost path

| | |
| --- | --- |
| Web Speech STT | $0 |
| Gemini free tier | $0 — but ~90 min/day, and it may train on your data |
| Scripture (reference-only) | $0 — no network call |
| Vercel hobby | $0 at personal-project scale |

Sustainable for roughly **two 45-minute sermons per day**. See
[`free-tier-deployment.md`](./free-tier-deployment.md) for the privacy
tradeoff, which is the real price.

## Free tier: technically $0 vs. actually sustainable

These are not the same claim, and the difference is the whole point.

| Provider | Technically $0 | Sustains a 45-min sermon | Binding limit |
| --- | --- | --- | --- |
| Gemini 3.5 Flash-Lite | Yes | **Yes** — ~2 sermons/day | 1,000 req/day |
| Groq free | Yes | **No** — 5.1× over | 6,000 tokens/min |
| OpenRouter `:free` unfunded | Yes | **No** — lasts ~4 min | 50 req/day |
| Local interpreter | Yes | Yes, indefinitely | none (but does not translate) |

## What drives cost

**Speech to text is billed per minute of audio and is essentially fixed.** A
45-minute service costs the same whether the preacher pauses or not.

**Interpretation is billed per token, and that is where design decisions
show up.** Two choices keep it flat rather than quadratic:

1. **The rolling window is bounded.** Context never exceeds ~900 characters of
   Korean plus ~700 of English plus a ≤700-character summary — so the cost of
   minute 60 is the same as the cost of minute 5. Sending the full transcript
   each turn would grow cost with the square of session length.
2. **Compression is local.** Folding old segments into a summary is
   deterministic TypeScript, not a second model call. It costs nothing.

Measured: under **2,000 estimated input tokens per call**, even after 500
segments (asserted in `interpreter/context/rolling.test.ts`).

---

## Per-session

Assumes roughly one interpretation call every 8 seconds of speech, ~1,700 input
and ~180 output tokens per call.

| | 30 min | 45 min | 60 min |
| --- | --- | --- | --- |
| Interpretation calls | ~225 | ~340 | ~450 |
| STT (Deepgram @ ~$0.0077/min) | $0.23 | $0.35 | $0.46 |
| LLM input (~$0.40/M) | $0.15 | $0.23 | $0.31 |
| LLM output (~$1.60/M) | $0.06 | $0.10 | $0.13 |
| Bible API | $0.00 | $0.00 | $0.00 |
| **Total** | **~$0.44** | **~$0.68** | **~$0.90** |

Bible is $0.00 because the default provider makes no network call at all, and
the public-domain provider is free.

---

## Monthly

| Sessions/month | 30 min | 45 min | 60 min |
| --- | --- | --- | --- |
| 4 | $1.76 | $2.72 | $3.60 |
| 8 | $3.52 | $5.44 | $7.20 |
| 12 | $5.28 | $8.16 | $10.80 |

Plus hosting: **$0** on a Vercel hobby plan for this workload — five dynamic
route handlers, no database, no background jobs, no media storage. A Pro plan
($20/month) only becomes relevant for team features or commercial terms.

So a church interpreting three services a week runs at roughly **$8–11/month**
in API spend.

---

## Cheaper configurations

| Change | Effect |
| --- | --- |
| `STT_PROVIDER=webspeech` | STT drops to **$0**. Browser-native, Chrome only, less reliable on long sessions |
| `LLM_PROVIDER=mock` | LLM drops to **$0**. Scripture, terminology and wordplay still work; English assistance becomes rule-based rather than translated |
| Both | **$0/month.** Genuinely usable for rehearsal and for Scripture/terminology support |
| `lag=safe` | ~25% fewer calls — longer buffers, fewer flushes, no anticipation |

---

## More expensive configurations

| Change | Effect |
| --- | --- |
| `STT_PROVIDER=openai` | ~$1.02/hr instead of ~$0.46 — roughly doubles a session's total |
| A frontier LLM | 5–10× the interpretation line; worth measuring against a mid-tier model on the evaluation fixtures before paying for it |
| `lag=fast` | More calls and more anticipation; expect ~30–40% more LLM spend |

---

## Controls already in place

- Bounded rolling context (hard character budgets, enforced and tested).
- Local compression — no summarisation calls.
- Local Scripture, glossary and cultural detection — no model call for any of
  it.
- Anticipation gated off after completed sentences and disabled entirely in
  Safe mode.
- Single in-flight interpretation request; pending Korean coalesces rather than
  queueing parallel calls.
- Output capped at 700 tokens per turn, and the schema caps a turn at 8 chunks.
- A 12-second timeout — a live turn slower than that is already useless, so it
  is abandoned rather than paid for.

---

## Worth adding next

- **Prompt caching.** The system prompt is constant for a whole session and is
  by far the largest fixed input. Both OpenAI and Anthropic offer caching that
  would cut the input line substantially. Not implemented.
- **A per-session budget ceiling** with a visible indicator, so a runaway
  session is capped rather than discovered on the invoice.
