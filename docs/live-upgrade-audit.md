# Live Interpretation upgrade — audit

Written before the implementation in this branch. Everything here was read out
of the repository or observed from a run, not assumed.

## Baseline (before any change)

| Command | Result |
| --- | --- |
| `npm test` | 112 files, 1118 tests, all passing |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean, 25 routes |

## Architecture as found

Next.js 16 App Router + React 19 + Tailwind 4, deployed as a PWA. Two products
share one tree:

* **Live** (`/live`) — one speaker, one human interpreter, a console.
* **Counter** (`/counter`, `/c/[code]`) — two people at a desk, 25 languages.

Live pipeline:

```
MicrophoneCapture (AudioWorklet, 16 kHz PCM16, ~50 ms frames)
  → SpeechProvider   demo | webspeech | deepgram | openai
  → InterpretationEngine   stabiliser → logical turn → two lanes → chunk store
        lane A  provisional: Chrome on-device Translator
        lane B  contextual:  POST /api/interpret → LlmRouter → Zod
  → LiveConsole   English (dominant) · source transcript · context rail
```

The engine is a plain class outside React; `useLiveSession` owns the
microphone, the provider, the tick interval and the network. Chunks move
`anticipated → current → committed` and a committed chunk is never rewritten.
That part of the product is good and was kept.

## Problems found

### P1 — "Sermon Mode" vs "General Mode" is a user-facing product fork

`InterpretationMode = "sermon" | "general"` is chosen on the launcher, stored in
settings, sent on the wire, and forks eleven places: prompts (`sermon.ts`,
`general.ts`, `compact.ts`), the glossary lexicon, the community glossary, STT
keyterm hints, the demo script, rescue availability, booth-preflight readiness,
the prep brief, the prep prompt, stored-session metadata and the sessions list.

It is also *sticky in a harmful way*: `InterpretationEngine.setMode()`
invalidates every in-flight turn, so any mid-session change throws work away.

### P2 — Live is hardcoded Korean → English end to end

`useLiveSession` passes the literal `"ko-KR"` to both `fetchSttCredentials` and
`createSpeechProvider`; `beginBrowserTranslatorPreparation` hardcodes
`sourceLanguage: "ko"`, `targetLanguage: "en"`; `interpretRequestSchema` has no
language fields at all; every prompt says "Korean into English". The 25
advertised languages exist only in Counter Mode.

### P3 — Language configuration is scattered, and lives under `counter/`

Five modules hold overlapping language knowledge:

* `src/counter/languages.ts` — the registry (tag, endonym, ko/en name, rtl,
  `speechSupported`), plus tag aliases.
* `src/providers/stt/language.ts` — Deepgram and Web Speech tag maps.
* `src/providers/stt/capability.ts` — the Whisper language list.
* `src/providers/stt/transcript.ts` — script regexes, no-space scripts,
  Simplified/Traditional character hints.
* `src/counter/prompt.ts` — per-target writing guidance.

Because the registry sits under `counter/`, Live never used it. That is the
root cause of P2 as much as anything else.

### P4 — Chinese: the script variant is lost at the recogniser boundary

`zh-CN` / `zh-TW` are modelled correctly in the registry, the alias table, the
alternative picker and the Counter prompt. The break is one layer lower:

* `POST /api/stt/token` mints an OpenAI realtime session with
  `language: language.split("-")[0]` — so `zh-TW` is sent as `zh`.
* The Hugging Face Whisper fallback (`requestHfTranscription`) sends no
  language at all and relies on auto-detection, which cannot honour a script
  variant either.
* Whisper has no parameter that selects Traditional output, so a visitor who
  chose 中文（繁體） is transcribed in Simplified characters.
* `sttLanguageSupport("openai", "zh-TW")` nonetheless reported `native`,
  overstating what that path can do.

This is *not* Chinese-specific in cause — it is "the tag carries a script
distinction the provider's API cannot express". Any future `sr-Latn` /
`sr-Cyrl` or `uz-Latn` / `uz-Cyrl` pair breaks identically.

### P5 — Terminology consistency is advisory only

`CORE_CONTRACT` tells the model "Once an English form is settled, reuse it
exactly", and `contextBlock` lists settled names. Nothing enforces it. The
session already *knows* the settled form; it just hopes.

### P6 — A transient recogniser failure destroys the session

`useLiveSession.failTerminally()` runs on any provider `status === "error"`.
`WebSpeechProvider` escalates to `error` after four recovery attempts. The only
recovery offered is "Try again", which calls `start()` — and `start()` does
`setSnapshot(emptySnapshot())` and constructs a new `InterpretationEngine`, so
the transcript, the glossary, the settled names and the Scripture list are all
discarded. A venue Wi-Fi blip mid-service costs the whole session's context.

### P7 — Live-region semantics announce every chunk

`EnglishStream`'s scroll container carries `aria-live="polite"` around the whole
chunk list, so a screen reader announces every incoming interpretation line.

## What was already good and was deliberately kept

* The two-lane engine, temporal locking and refinement legality rules.
* The stabiliser's boundary detection and the `boundary` / `continuesPrevious`
  steer sent to the model.
* Bounded rolling context with deterministic local compression.
* The client/server latency telemetry, which is transcript-free and real.
* Console layout: English dominant, source secondary, rail only when it has a
  cue, `FREEZE` and `↓ Live` as the only two buttons.
* `useAutoScroll`'s manual-scroll detent — it already never snaps the user back.
