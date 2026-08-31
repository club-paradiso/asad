# tong-yuck

**A real-time AI copilot for human interpreters.** Korean → English.

> **Project status:** Active development. The Vercel deployment is intentionally access-controlled; run locally to evaluate the product.

The name plays on 통역 — *interpretation*.

tong-yuck does not translate for you. It sits beside a working simultaneous
interpreter and carries the load they cannot carry alone: the passage reference
they half-caught, the term they settled on twenty minutes ago, the name they
corrected, the pun that is about to arrive and cannot be translated literally.

The interpreter stays the listener, the contextual decision-maker, the language
producer and the ethical decision-maker. The AI is support.

---

## What makes it different

The product fails if it becomes *Korean speech → English subtitles*. That
already exists, and it is close to useless in a booth: subtitles assume a reader
who can go at their own pace, and an interpreter cannot. They are two to five
seconds behind, already speaking, and they get one fixation per line.

So the whole system is built around that constraint:

- **Temporal locking.** Once a line has probably been said out loud it is
  immutable. A streaming system that rewrites earlier text is unusable, because
  the interpreter's mouth is already past it. A serious fix is *appended* as a
  discreet correction, never applied in place.
- **Safe vs. anticipated output.** Predicted continuations are visually
  unmistakable — dimmed, dashed rule, `◦` marker — and vanish cleanly when
  wrong. Prediction never runs after a completed sentence, which is where
  confident invention comes from.
- **Interpreter-ready chunks, not prose.** Short thought units, roughly one
  breath group, sayable on their own and joining naturally to the next.
- **Early restructuring.** Korean holds the predicate until the end. tong-yuck
  offers a safe syntactic scaffold — *"Today, I'd like to talk with you
  about…"* — so the interpreter can start speaking before the Korean resolves,
  without inventing the payload.
- **Cultural and wordplay adaptation.** Mandatory, not decorative. Literal
  translation is where Korean humour goes to die.
- **It never invents Scripture.** Verse wording appears only when a provider
  legally supplied it. Otherwise: the reference, and nothing else.

---

## The console

```
┌──────────────────────────────────────────────────────┐ status: live · mode · lag · timer
│                                                       │
│   Today we're going to look at...                     │ committed — dimmed, still readable
│   1 Peter 2:9.                                        │
│ ▌ So we need to find the right way.                   │ current — full contrast, amber rule
│ ▌ And speaking of "the way," it's even in my name.    │
│   ADAPTED  Wordplay adapted — not literal             │
│ ┆ ◦ we so easily forget who we are.                   │ anticipated — dashed, provisional
│                                                       │
├──────────────────────────────────────────────────────┤
│ 그래서 우리는 길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요.  │ Korean — present, never competing
├──────────────────────────────────────────────────────┤
│ WORDPLAY 길  "Gil" means "way"  │ 1 Peter 2:9 │ 부르심 → CALLING │
├──────────────────────────────────────────────────────┤
│  FREEZE                             T  한  G  A− A+   │
└──────────────────────────────────────────────────────┘
```

Designed as a professional interpreter cockpit, not an AI dashboard: dark,
large type, minimal eye movement, no chat bubbles, no cards, no decorative
colour. Colour means state — amber is *now*, cyan is *reference*, and nothing
is coloured to look nice.

Verified at iPhone landscape (the primary target), iPhone portrait, iPad
landscape and laptop. The active line parks at 55% of the reading region on all
of them.

---

## Try it in thirty seconds

```bash
npm install
npm run dev
```

Open http://localhost:3000, press **Start interpreting**.

**No API key, no microphone and no network are required.** Demo mode replays a
scripted Korean sermon through the real pipeline — real stabiliser, real
temporal locking, real rolling context — so it exercises the same code path as
a live session. A ribbon names the interpretation problem each beat is
demonstrating.

The demo covers ordinary speech, a delayed predicate, a 40-word sentence, an
unfinished one, a recogniser self-correction, Scripture, theological
vocabulary, an idiom, a cultural reference, name wordplay, a proper noun,
prayer, testimony, rhetorical repetition and humour.

### What is running when you do that

**No cloud model.** The repository ships with no API key, and nothing is
configured by default, so the console runs on the **local interpreter** — a
deterministic, rule-based path built from the parts of the job that genuinely
are deterministic:

| Runs locally, always | Needs a cloud model |
| --- | --- |
| Scripture detection and reference normalisation | Translating arbitrary Korean into English |
| Glossary and terminology matching | Rendering idiom, humour and wordplay |
| Cultural-reference and wordplay *detection* | Early syntactic restructuring |
| Name correction and romanisation | Register and tone |
| Transcript stabilisation and temporal locking | Counter Mode's free-text translation |

The local path **flags** the hard cases rather than solving them, marks
anything it cannot support as low confidence, and never invents content. That
is deliberate — a wrong translation delivered confidently is worse than a
marked gap — but it is assistance, not interpretation.

Add one free key and the whole right-hand column turns on. `/diagnostics` says
which provider is live, and the console shows `AI LOCAL` in the status pill
whenever it is not.

---

## Run tong-yuck for free

Real live interpretation, no paid API anywhere:

```bash
# .env.local
STT_PROVIDER=webspeech        # browser speech recognition — $0
LLM_ROUTING_MODE=auto-free    # free-tier interpretation — $0
GEMINI_API_KEY=your-free-key  # from Google AI Studio, no card required
BIBLE_PROVIDER=reference-only # no network call at all — $0
```

```bash
npm install && npm run dev
```

Open in **Chrome**, pick **Sermon**, choose **Browser** as the audio source,
press Start. Check `/diagnostics` to confirm what is actually configured.

**Limitations, stated plainly:**

- Web Speech is good in Chrome and Edge, partial in Safari, and unreliable on
  iOS. It also stops on silence and restarts automatically, which can drop a
  phrase.
- Gemini's free tier sustains about **two 45-minute sermons a day**
  (1,000 requests). After that the console keeps running on the local
  interpreter and the status pill shows `AI LOCAL`.
- **Privacy: Gemini's free tier may use prompts and responses to improve Google
  products, including human review.** For sermon content — testimonies, prayer
  requests, names — that is a real tradeoff. tong-yuck tells you once, in-app,
  before the first live cloud session, and offers `LLM_ROUTING_MODE=local`
  (sends nothing) or `LLM_PRIVACY_MODE=strict` (excludes training-capable
  providers) as alternatives.

Full detail: [`docs/free-tier-deployment.md`](docs/free-tier-deployment.md).

## Going live

Three tiers, and they are not equivalent. Demo mode is a demonstration, not a
rehearsal.

| | Keys needed | What you get |
| --- | --- | --- |
| **Demo** | none | The full pipeline on a recorded Korean sermon. No microphone, no network. For seeing what the console does |
| **Browser** | one LLM key | On-device recognition plus real interpretation. Free, Chrome-dependent, stops on long silences |
| **Production** | Deepgram + OpenRouter | Streaming recognition and a pinned live model with latency-oriented routing. What to use for a service you intend to trust |

### Recommended production setup

Copy `.env.example` to `.env.local`. Two keys:

```bash
STT_PROVIDER=deepgram
DEEPGRAM_API_KEY=...
DEEPGRAM_PROJECT_ID=...      # needed to mint short-lived browser keys

LLM_ROUTING_MODE=pinned
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_PRIMARY_MODEL=google/gemma-4-26b-a4b-it:free

OPENROUTER_PROVIDER_SORT=latency
OPENROUTER_DATA_COLLECTION=deny
OPENROUTER_REQUIRE_PARAMETERS=true

APP_ACCESS_KEY=...           # see "Protecting a deployed app"
SESSION_SECRET=...           # required on Vercel; see the same section

BIBLE_PROVIDER=reference-only
```

Then, before the service:

```bash
npm run health:openrouter
```

That makes one real request and reports whether the key works, the model slug
resolves, the routing policy leaves an upstream eligible, and structured output
validates. Configuration alone cannot tell you any of those.

### Why OpenRouter is configured this way

It is a router, not a vendor, and the `provider` block sent with every request
is what makes it fit for live work:

| Setting | Why |
| --- | --- |
| `sort=latency` | A perfect answer that arrives after the moment has passed is worth nothing |
| `data_collection=deny` | Excludes upstreams that may retain or train on what is sent |
| `require_parameters=true` | Excludes upstreams that would silently drop `response_format` and answer in prose |
| `allow_fallbacks=true` | Retries on another upstream serving the *same* model. Not model roulette — the model stays pinned so terminology and register hold |
| `zdr` | Stricter still. If it leaves no eligible upstream the turn fails **visibly** and names the constraint, rather than quietly widening the policy |

The model is pinned for the session on purpose. Switching model families between
sentences drifts terminology and register, and the interpreter is the one who
absorbs it mid-sentence.

Model ids are configuration, never code. Set `OPENROUTER_PRIMARY_MODEL` to
whatever is current and run the health check.

### Protecting a deployed app

`/api/interpret`, `/api/prep`, `/api/counter/message` and `/api/stt/token` all
spend money. Deployed without a gate they are public endpoints, and
`/api/stt/token` is the worst of them — it mints recogniser credentials that
outlive the request.

Always on, no configuration needed:

- same-origin enforcement
- request body ceilings
- server-issued session tokens in HttpOnly cookies
- per-session and per-address rate limits, sized from the measured live
  workload of ~11 calls a minute

Set `APP_ACCESS_KEY` and nothing paid answers without it. Any non-empty value
works; it is a shared secret, not an account system.

**On Vercel, also set `SESSION_SECRET`** (`APP_ACCESS_KEY` doubles as one). It
must be identical on every instance. Without it the signing key is random per
process, so a token minted by one instance fails on the next — and enforcing
sessions under those conditions would not make the deployment stricter, it
would break it continuously, with the console re-minting a token the following
request rejects again. So without a stable secret, session tokens degrade to
keying rate limits per browser and stop gating requests. `/diagnostics` reports
which mode is in force rather than letting you assume the stronger one.

**The honest caveat:** rate limits live in the memory of one server instance.
On Vercel, or anywhere running more than one, the effective ceiling is the limit
multiplied by the number of warm instances. That is a real bound and it is not a
global guarantee. For a hard ceiling, set a spend limit on the OpenRouter key.

### Everything else

Every value is optional; each subsystem degrades independently.

```bash
# local | auto-free | pinned | reliable
LLM_ROUTING_MODE=auto-free
LLM_PRIVACY_MODE=standard    # strict excludes providers that may train on you
LLM_ALLOW_PAID_FALLBACK=false

GEMINI_API_KEY=...           # free tier
GROQ_API_KEY=...             # free tier, does not train on your data
ANTHROPIC_API_KEY=...        # paid
OPENAI_API_KEY=...           # paid
```

Phase 1's `LLM_PROVIDER` / `LLM_API_KEY` still work and report their migration
path on `/diagnostics`.

| Setting | Behaviour |
| --- | --- |
| Nothing set | Demo mode. Fully offline, fully functional |
| `STT_PROVIDER=webspeech` | Live microphone, no key. Chrome is best; Safari is partial |
| `LLM_PROVIDER=mock` | Scripture, terminology and wordplay still work locally; English assistance is rule-based rather than translated |
| `BIBLE_PROVIDER=reference-only` | References only. No licence needed, and no possibility of invented wording |

**API keys never reach the browser.** `/api/stt/token` mints a short-lived
credential; interpretation is proxied through `/api/interpret`.

**Bible translations:** NIV, ESV, NLT, NASB and NKJV are copyrighted and cannot
be bundled or proxied without your own licence. `public-domain` serves WEB/KJV/ASV;
`api-bible` uses a translation you are entitled to. The default shows the
reference alone, which is genuinely useful and carries no risk.

---

## Using it

Two interactions to live: pick a mode, press Start.

| Key | |
| --- | --- |
| `Space` | Freeze — display stops, pipeline keeps running |
| `F` | Follow live |
| `T` | Teleprompter view |
| `K` | Korean on/off |
| `G` | Glossary |
| `B` | Scripture |
| `+` / `-` | Text size |

**Lag** — how far behind the speaker you are running — changes transcript
stabilisation, when the model is triggered, how aggressive anticipation is, and
how fast a line locks. Fast ≈1s, **Balanced ≈2–3s** (default), Safe ≈4–6s with
prediction off entirely.

**Sermon mode** adds Scripture detection, theological terminology, church
register and wordplay handling. **General mode** applies no theological
assumptions — meetings, lectures, interviews, public service.

**Correct a name once** (settings → *Correct a name or term*) and it is
absolute: the past transcript is rewritten, every future mention is corrected
before anything sees it, the romanisation is bound, and it appears in the
post-session review as a term to pre-load next time.

**Prep** (`/prep`) is optional. Fill it in and the speaker's name romanises
once and stays consistent, terminology hints go to the recogniser so proper
nouns survive, and the model starts the session knowing what it is listening to.

**Sessions** (`/sessions`) only stores what you explicitly asked it to store —
"Save this session" is off by default. Export as TXT, Markdown or JSON. Audio
is never retained.

---

## Counter Mode — 현장 응대

A second surface for a different job. The console is for an interpreter working
a room; Counter Mode is for staff at a desk with a stranger in front of them
who does not share their language.

Open `/counter` on the iPad or the spare phone on the desk, pick the staff
language, press **QR 코드 띄우기**. The visitor scans the code, picks their
language from a list written in their own script, and starts talking — chat or
push-to-talk voice, on their own phone, with nothing installed.

Four decisions carry it, and all four exist because field translators produce
too many errors, not too few translations:

- **Both languages are on both screens, always.** Every bubble shows the
  viewer's language large and the other language underneath, fully legible.
  That is what lets either party catch an error; a single-language screen gives
  neither of them any way to.
- **Quick phrases never touch a model.** The twenty-odd things a counter says
  all day are pre-written in ~17 languages and delivered by lookup. No latency,
  no variance, no mistranslation on the fortieth repetition.
- **Numbers, times, dates, money and names are flagged.** They are highlighted
  in the translation and one tap sends just those values back for verbal
  read-back. `3시` heard as `13시` is the error that actually costs someone
  their appointment.
- **A failed translation says so.** There is no local fallback that fakes one.
  A counter is exactly the wrong place to show something that is not a
  translation as though it were.

Open-weight models by default (`LLM_COUNTER_PREFER_OPEN=true`) — Groq's
`gpt-oss-120b`, OpenRouter's Llama. The counter's workload is ~2,400 tokens per
minute against Groq's 6,000 TPM free tier, so unlike the live console it fits
in a free tier comfortably, and Groq does not train on inputs on either tier.

24 languages offered; the interface itself is translated into 17 and falls back
to English rather than Korean beyond that. `/diagnostics` lists exactly which
language gets what. Full design note: [docs/counter-mode.md](docs/counter-mode.md).

Sessions live in one process's memory, expire after four hours idle, and are
deleted outright when the staff member ends them. Nothing is written to disk.

---

## Commands

```bash
npm run dev        # development server
npm run build      # production build
npm start          # serve the production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run verify     # everything CI's fast job runs, in one command
npm run icons      # regenerate PWA icons
npm run shot       # device screenshots, for the design pass
npm run e2e        # end-to-end flow check against a running server

npm run health:openrouter  # prove the gateway works: key, model, policy, schema
npm run measure:prompt     # size of every live system prompt

npm run smoke:llm  # one fixture per configured provider; skips cleanly
npm run bench:llm  # 34-case interpretation benchmark, JSON + Markdown reports
                   # (or run it in CI, with no key on your machine — see below)
npm run bench:live # replay real transcript timing, measure latency
npm run soak       # 45-minute session: bounded memory, context, no backlog
```

---

## Benchmarking without handing anyone a key

Benchmarking needs a real credential, and the obvious ways to supply one are
all bad: pasting it into a chat, putting it on someone else's machine, or
committing it.

So the benchmark also runs as an on-demand GitHub Action, with the key read
from repository secrets. It never leaves GitHub.

1. **Settings → Secrets and variables → Actions → New repository secret.**
   Add whichever you have: `GEMINI_API_KEY`, `GROQ_API_KEY`,
   `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
2. **Actions → Benchmark → Run workflow.** Optionally override the Gemini
   model, and list any providers you are billed for so free-tier ceilings are
   not applied to them.
3. Read the result in the run summary; the JSON and Markdown reports are
   attached as an artifact for 90 days.

It never runs on a schedule or on push — real API calls cost real money, so a
person decides each time. Providers with no secret are skipped and the report
says which, rather than quietly reporting on fewer models than you expected.

---

## Architecture

```
audio → SpeechProvider → stabiliser → local detection → rolling context
      → /api/interpret → Zod validation → chunk store (temporal locking) → console
```

Three vendor-neutral ports — **STT**, **LLM**, **Bible** — so switching
provider is an environment variable, not a rewrite. The interpretation engine
is a plain state machine outside React: it has to keep running while the UI is
frozen, and it has to be testable without rendering anything.

Scripture normalisation, glossary matching and cultural detection all run
**locally**, which is why they survive demo mode and an LLM outage.

- [`docs/architecture.md`](docs/architecture.md) — stack decision, the STT
  provider comparison, transport, project structure
- [`docs/interpreter-engine.md`](docs/interpreter-engine.md) — timing, temporal
  locking, anticipation gating, context compression
- [`docs/privacy.md`](docs/privacy.md) — what leaves the device, and what
  cannot be promised
- [`docs/cost.md`](docs/cost.md) — per-session and monthly estimates
- [`docs/llm-benchmark.md`](docs/llm-benchmark.md) — provider comparison,
  measured workload, and what was **not** measured
- [`docs/free-tier-deployment.md`](docs/free-tier-deployment.md) — the
  zero-cost setup and its tradeoffs
- [`docs/repository-audit.md`](docs/repository-audit.md) — what was here before

---

## Deployment

Vercel-ready. `npm run build` produces a standard Next.js output; set the
environment variables in project settings. Nothing about local development or
the MVP requires deployment.

---

## Limitations

Stated plainly, because a tool used live should not surprise you.

- **Latency and interpreter usefulness are not yet measured.** The evaluation
  fixtures assert semantic properties and guard against hallucination, but
  end-to-end latency against a live model, and whether a working interpreter
  finds it genuinely helpful, need a real session. This is the biggest gap.
- **No real interpreter has used it in a live service.** Every design decision
  here is reasoned from the constraints of the task; none is yet validated by
  someone doing the job.
- **iOS Safari limits background audio.** Recognition will not continue with
  the screen locked or the app backgrounded. Wake lock is held where supported.
- **Web Speech mode stops on silence** and restarts automatically; a long
  pause can drop a phrase. Cloud providers do not have this problem.
- **Deepgram temporary keys need `DEEPGRAM_PROJECT_ID`.** Without it the route
  passes the configured key through, marked `ephemeral: false` — see
  [privacy](docs/privacy.md).
- **Document ingestion (PDF/DOCX/PPTX) is not implemented.** Paste an outline
  instead; nothing in the live path should wait on a parser.
- **Mixer and remote audio input are not implemented,** though the capture
  layer takes a `MediaStream` so they drop in without changes.
- **Romanisation does not implement inter-syllable liaison** (종로 → Jongno).
  Personal names are correct; place names are an approximation you can
  overwrite.
- **Prompt caching is requested but unverified.** The system prompt is constant
  per session and byte-identical across modes, which is what a provider cache
  needs, and usage accounting asks for `cached_tokens` back. Whether a given
  upstream actually serves it from cache has not been measured against a real
  key.
- **The live model default has not been verified against the live catalogue.**
  `google/gemma-4-26b-a4b-it:free` is the current Vercel deployment setting, but
  network policy in the build environment blocked `openrouter.ai`, so the slug
  was never confirmed to exist. That is exactly what `npm run health:openrouter`
  is for — run it before trusting the deployment.
- **OpenRouter integration is tested against mocks, not a live key.** Request
  construction, routing policy, capability negotiation and strict-routing
  failure are unit-tested; no credentialed end-to-end run has happened.
- **Counter Mode sessions do not survive a restart or span instances.** They
  are held in one process's memory. That is correct for a venue running this as
  a single Node process, and wrong for a multi-instance or serverless
  deployment, where a poll may reach a worker that has never seen the session.
  `/diagnostics` states this; swapping `CounterStore` for a shared
  implementation is the fix.
- **Counter Mode voice input depends on the browser.** Several of the languages
  that turn up most often at a Korean desk — Uzbek, Mongolian, Khmer, Burmese —
  have no reliable browser speech recognition, so those visitors type. Typing is
  always available and never a degraded path.

---

## Roadmap

**Next** — measure latency and interpretation quality against a live model
using the evaluation fixtures, then put it in front of a working interpreter.
Everything below is speculation until that happens.

Then: prompt caching · a per-session budget ceiling · document ingestion ·
mixer and WebRTC audio input · multi-speaker handling · glossary sharing across
a team · languages beyond Korean→English (the engine is already domain- and
language-agnostic; the lexicons and Scripture table are the language-specific
parts).

---

## License

Released under the [MIT License](LICENSE). You may use, modify, distribute, sublicense, and sell the software, provided that you retain the copyright notice and license text. It is provided without warranty.
