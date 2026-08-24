# LLM benchmark and model selection

**Status: the harness is built and validated. No cloud provider has been
benchmarked, because no API key was available in the build environment.**

That sentence is the most important one in this document. Everything below
distinguishes between what was *measured* and what was *derived from provider
documentation*, and nothing is presented as a benchmark result that was not
actually run.

---

## What was measured, and what was not

| | Status |
| --- | --- |
| Live pipeline latency and token cost | **Measured** — `npm run bench:live`, 45-minute soak |
| Context profile cost | **Measured** — all three profiles |
| System prompt token cost | **Measured** |
| Local interpreter benchmark score | **Measured** — `npm run bench:llm` |
| Free-tier quota viability | **Derived** from documented limits × measured workload |
| Provider data-use policy | **Derived** from provider documentation, verified 2026-08-24 |
| Gemini / Groq / OpenRouter quality | **NOT MEASURED** — no API key available |
| Gemini / Groq / OpenRouter latency | **NOT MEASURED** — no API key available |

Additionally, the build environment's egress policy reaches
`generativelanguage.googleapis.com` and `api.anthropic.com` but blocks
`api.groq.com`, `openrouter.ai` and `api.openai.com`. So even with keys, only
two of the five providers could have been reached from here.

**To produce real numbers**, set one or more keys and run:

```bash
GEMINI_API_KEY=... npm run bench:llm
GEMINI_API_KEY=... npm run bench:live -- --minutes 45
```

Reports land in `benchmarks/results/latest.{json,md}`, including a
side-by-side sheet for a human interpreter.

---

## The measured live workload

`npm run bench:live` replays the demo sermon through the real engine at a
realistic Korean speaking rate (~6 syllables/second):

| | Measured |
| --- | --- |
| Interpretation calls | **11.17 per minute** |
| Tokens per call — full profile | **2,718** |
| Tokens per call — compact | **2,432** |
| Tokens per call — ultra-compact | **2,177** |
| Implied token rate | **~30,360 TPM** |
| 45-minute sermon | ~503 calls, ~1.37M tokens |

Phase 1's documentation estimated 7.5 calls/min at 1,900 tokens. Both were
optimistic; the registry now carries the measured figures.

### The finding that changed the design

The context profiles barely help.

```
system prompt (sermon)   1,897 tokens   ← 70% of every call
user turn (fresh case)      63 tokens
rolling context           ~760 tokens   ← the only part profiles trim
```

Trimming rolling context from full to ultra-compact saves **20%**, because the
system prompt dominates and is sent identically every time. So the levers that
actually matter are, in order:

1. **Prompt caching** — not yet implemented. The highest-value remaining work.
2. **Shrinking the system prompt.** Done partially: the prose restatement of
   the JSON shape is now dropped for providers that enforce
   `INTERPRETER_JSON_SCHEMA` natively, saving 188 tokens/call — about 94,000
   tokens per sermon.
3. **Context profiles** — real but modest, and still worth having under quota
   pressure.

---

## Free-tier quota viability

Documented limits against the measured workload. This is arithmetic on
published numbers, not a benchmark.

| Provider | RPM | TPM | RPD | Viable for a 45-min sermon? |
| --- | --- | --- | --- | --- |
| **Gemini 3.5 Flash-Lite** | 15 | 250,000 | 1,000 | **Yes** — ~90 min/day, about two sermons |
| **Groq** (`openai/gpt-oss-120b`) | 30 | **6,000** | 14,400 | **No** — needs ~30,360 TPM, **5.1× over** |
| **OpenRouter** `:free`, unfunded | 20 | — | **50** | **No** — lasts ~4 minutes |
| OpenRouter `:free`, $10+ credited | 20 | — | 1,000 | Marginal — ~90 min/day, model may rotate |

Two conclusions follow directly:

**Groq's free tier cannot run this workload at any context profile.** Even
ultra-compact needs ~24,300 TPM against a 6,000 limit — 4.1× over. Even a
*zero-context* call would need ~21,000 TPM for the system prompt alone. This is
not a tuning problem; the system prompt would have to drop below ~500 tokens,
which would gut the interpretation rules. Groq's **paid** Developer tier
(250k+ TPM) is entirely viable, and Groq remains valuable as a fallback, as a
benchmark target, and as the best free-tier privacy posture.

**OpenRouter free is not a live provider.** 50 requests is under four minutes
of continuous speech. It is implemented as an experimental provider, a
fallback and a manual model-selection gateway, exactly as the brief anticipated.

---

## Privacy posture

Verified against provider documentation on **2026-08-24**. Re-verify before
trusting these: policies change.

| Provider | Free tier | Paid tier |
| --- | --- | --- |
| **Groq** | **Does not train** on inputs or outputs. Short abuse/reliability logs, zero-data-retention available self-serve | Same |
| **Gemini** | **May be used to improve Google products, including human review** | Not used for training |
| **OpenRouter** | Does not store prompts by default, but forwards to a downstream provider whose own policy applies | Same |
| OpenAI | Not used for training by default | Same |
| Anthropic | Not used for training by default | Same |

### The tension this creates

The two viable free options pull in opposite directions:

- **Gemini** has the quota headroom but trains on free-tier submissions.
- **Groq** protects the data but cannot sustain the workload for free.

For sermon content — testimonies, prayer requests, pastoral information — that
is a decision a deployer must make consciously. tong-yuck therefore:

- shows a one-time in-app disclosure naming the actual provider before the
  first live cloud session, with local-only mode offered as a real alternative;
- provides `LLM_PRIVACY_MODE=strict`, which excludes providers that may train
  on free-tier submissions;
- provides `LLM_ROUTING_MODE=local`, which sends nothing anywhere and still
  does Scripture normalisation, terminology and wordplay detection.

---

## Selected default

**`auto-free` → Gemini 3.5 Flash-Lite → local**, with this reasoning:

1. **It is the only free tier whose quota survives a sermon.** Groq is 5.1×
   over on tokens; OpenRouter lasts four minutes. This is decisive before
   quality is even considered.
2. **Native structured output.** `responseJsonSchema` is real schema
   enforcement, and schema compliance is 10% of the score because a malformed
   response is a wasted turn during live speech.
3. **`thinkingConfig.thinkingBudget: 0`.** Flash-class models can otherwise
   spend seconds reasoning before the first token, which is unusable when the
   interpreter is already speaking. Being able to switch that off is a
   requirement, not a nicety.
4. **Documented low-latency, high-throughput positioning**, which matches this
   workload.

**Runner-up: Groq `openai/gpt-oss-120b` on the paid Developer tier.** Fastest
inference of the candidates and the best privacy posture — no training on
either tier. If a deployment can spend anything at all, this is the
configuration to benchmark first.

**This selection is provisional.** It is based on quota arithmetic, structured
output support and latency controls — all verifiable from documentation — but
**not on measured interpretation quality**, which requires keys and the
benchmark run above. If Gemini Flash-Lite turns out to render Korean wordplay
literally, quota headroom will not save it, and the default should change.

---

## Scoring

```
semantic fidelity        30%   required/forbidden renderings, Scripture, cultural notes
interpreter speakability 25%   deterministic heuristics
live latency             20%   scored against the SLO
structured output        10%   schema compliance rate
free-tier sustainability 10%   quota vs. a real 45-minute sermon
privacy suitability       5%   data-use posture on the tier in use
```

The fidelity component is an explicit **proxy**. No regex knows whether English
carries the Korean's meaning; what it can check is whether a specific
disqualifying rendering appeared. Real fidelity needs a human, which is what
the side-by-side review sheet in `latest.md` exists for.

### Hard failures

These disqualify a candidate regardless of score:

`invented_scripture` · `literal_wordplay` · `forbidden_rendering` ·
`schema_broken` · `unusable_latency` · `anticipation_hazard` · `no_output`

### A scoring bug worth recording

The first run scored the local interpreter at **98%**, which is absurd — it
does not translate. The cause: fidelity rewarded the *absence* of forbidden
renderings, and a non-answer trivially avoids every one of them. Declining to
translate was being scored as perfect accuracy.

Fixed by detecting non-answers explicitly and scoring them zero. The local
interpreter now scores 50% fidelity and is correctly **disqualified** with
`no_output`, which is the honest result: it is a fallback, not a translator.

---

## The dataset

20 cases (`benchmarks/dataset.ts`), one per interpretation problem a working
interpreter would name as hard:

declarative · delayed-predicate · fast-rhetorical · incomplete ·
self-correction · scripture-reference · scripture-paraphrase · terminology ·
idiom · proper-noun · **wordplay** · testimony · prayer · humour · repetition ·
cultural · ambiguous-pronoun · context-dependent-term · early-restructuring ·
anticipation-hazard

The wordplay case is the brief's disqualifying one and is asserted directly:

> `그래서 우리는 길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요.`
>
> forbidden: `"road in my name"`, `"find the road well"`, `"there is a road"`

---

## Commands

```bash
npm run bench:llm                      # all configured providers
npm run bench:llm -- --only gemini     # one provider
npm run bench:llm -- --repeats 3       # median of three runs per case
npm run bench:live -- --minutes 45     # real pipeline, measured latency
npm run bench:live -- --profile compact
npm run soak -- --minutes 60           # bounded-growth invariants
npm run smoke:llm                      # one fixture per provider
```

Every one of these skips unconfigured providers cleanly. A provider that was
not run was not measured, and the reports say so.
