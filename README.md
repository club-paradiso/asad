# tong-yuck

**A real-time AI copilot for human interpreters.** Korean → English.

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

---

## Going live

Copy `.env.example` to `.env.local` and fill in what you need. Every value is
optional; each subsystem degrades independently.

```bash
STT_PROVIDER=deepgram        # demo | webspeech | deepgram | openai
DEEPGRAM_API_KEY=...
DEEPGRAM_PROJECT_ID=...      # needed to mint short-lived browser keys

LLM_PROVIDER=anthropic       # mock | openai | anthropic
LLM_API_KEY=...

BIBLE_PROVIDER=reference-only  # reference-only | public-domain | api-bible
```

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

## Commands

```bash
npm run dev        # development server
npm run build      # production build
npm start          # serve the production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run icons      # regenerate PWA icons
npm run shot       # device screenshots, for the design pass
npm run e2e        # end-to-end flow check against a running server
```

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
- **No prompt caching yet.** The system prompt is constant per session and is
  the largest fixed input — caching it would cut cost materially.

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

## Licence

Unlicensed at present — all rights reserved by the repository owner.
