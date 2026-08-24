# Architecture

## The decision that drives everything else

tong-yuck is not a transcription app with a translation pane. It is a console
for a person who is, simultaneously: listening to Korean, holding context,
reading a screen, and speaking English. That person has roughly one second per
glance and no attention to spare.

Every architectural choice below is downstream of that constraint. Where a
normal web app would optimise for completeness, this one optimises for *what
can be absorbed at a glance and said out loud in the next two seconds*.

---

## Stack

**Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4**, deployed
as a PWA.

### Why not Vite + React

Vite was the serious alternative and it loses on one point that turns out to
decide everything: **the product needs a server**.

An STT or LLM API key must never reach the browser. Deepgram and OpenAI both
require a credential to open a streaming socket, and the only safe pattern is
to mint a short-lived token server-side (`/api/stt/token`). Interpretation
calls must likewise be proxied (`/api/interpret`) so the LLM key stays on the
server. With Vite that means running and deploying a second service; with
Next.js route handlers it is four files in the same tree, one deployment, one
set of types shared across the boundary.

Everything else was close enough not to matter:

| | Next.js | Vite + React | Verdict |
| --- | --- | --- | --- |
| Microphone / `getUserMedia` | identical | identical | tie — browser API |
| Streaming APIs, WebSocket | identical | identical | tie |
| iOS Safari behaviour | identical | identical | tie |
| PWA installability | manifest route + `public/sw.js` | plugin | tie |
| Wake Lock | identical | identical | tie |
| Real-time UI performance | identical once hydrated | identical | tie |
| **Server / API integration** | **route handlers in-tree** | separate service | **Next.js** |
| Deployment | one target | two targets | Next.js |

The runtime cost of Next.js here is close to nil: the console is a single
client-rendered route that hydrates once and then never navigates. We are
using Next.js for its server, not its rendering.

### Why not native (iOS/Android)

A native app would get better background audio and a more reliable wake lock.
It would also mean an interpreter cannot open the tool on a borrowed laptop
ninety seconds before a service, which is the actual usage pattern. The PWA
ships instantly, runs on every target device, and degrades honestly where iOS
limits it. Native is a later platform decision, not an MVP one.

---

## The live pipeline

```
 microphone / mixer
        │  MediaStream
        ▼
 MicrophoneCapture ─────────► 16 kHz mono PCM16, ~50 ms frames
        │                     (providers/stt/audio.ts)
        ▼
 SpeechProvider  ◄─── short-lived token from /api/stt/token
   demo │ webspeech │ deepgram │ openai
        │
        │  onPartial(text)          onStable(text)
        ▼                                │
 ┌──────────────────────────────────────────────────────────────┐
 │ InterpretationEngine  (interpreter/engine/session.ts)         │
 │                                                               │
 │  Stabiliser ──── decides WHEN to interpret                    │
 │    sentence boundary │ silence window │ hold ceiling          │
 │                                                               │
 │  Local detection ─── runs instantly, needs no model           │
 │    scripture/detect · glossary/matcher · cultural/detect      │
 │                                                               │
 │  Rolling context ─── bounded window + local compression       │
 │    context/rolling.ts · context/memory.ts                     │
 │                                                               │
 │  ──► POST /api/interpret ──► LlmProvider ──► Zod validation   │
 │                                                               │
 │  Chunk store ─── temporal locking                             │
 │    anticipated → current → committed (never rewritten)        │
 └──────────────────────────────────────────────────────────────┘
        │  EngineSnapshot
        ▼
 LiveConsole ─── English (dominant) · Korean · context rail
```

The pipeline is continuous. Nothing waits for a paragraph, or even for a
sentence — the stabiliser's hold ceiling guarantees a flush even for a speaker
who never pauses.

### The engine is deliberately not React

`InterpretationEngine` is a plain class driven by a clock and by provider
callbacks. It has to keep running while the UI is frozen, it has to be testable
without rendering anything, and its timing must not be coupled to render
scheduling. `useLiveSession` is a thin binding that owns the provider, the
microphone, the interval and the network — nothing else.

---

## Speech-to-text: the comparison

Evaluated for Korean, streaming, and a 45–70 minute unattended session.

| | Korean | Interim results | Punctuation | Long session | Mobile browser | Custom vocab | Cost / hr | Complexity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Deepgram (nova-3)** | Yes, tuned multilingual | **True interim** (`is_final: false`) | smart_format | Designed for it; keepalive | WebSocket, works everywhere | **`keyterm` params** | ~$0.26–0.46 | Low — one socket, PCM16 |
| **OpenAI realtime** (`gpt-live-transcribe`) | Yes, 99+ languages | Delta events | Yes | Session-based | WebSocket | Prompt-based hints | ~$1.02 | Medium — base64 frames, session setup |
| **OpenAI batch** (`gpt-transcribe`) | Yes | **No** | Yes | Batch only | n/a | Prompt | ~$0.27 | Low, but unusable live |
| **Whisper self-host** | Good offline | Only via VAD chunking | Yes | Needs GPU | No | Initial prompt | infra | High |
| **Google STT v2** | Yes | Yes | Yes | Yes | Yes | Phrase sets | ~$0.96 | Medium — GCP auth |
| **AssemblyAI** | Yes | Yes (English-first realtime) | Yes | Yes | Yes | Word boost | ~$0.22–0.90 | Low |
| **Web Speech API** | ko-KR in Chrome | Yes | Partial | **Stops on silence** | Chrome good, Safari partial, iOS unreliable | No | **Free** | Very low |

**Chosen default: Deepgram.** Three reasons specific to this product:

1. **True interim results.** The partial/stable distinction is not a nicety
   here — it is the input the stabiliser and the anticipation gate both run on.
   A provider that only emits finalised turns cannot drive this pipeline.
2. **`keyterm` custom vocabulary.** Proper nouns are the highest-risk item in
   sermon interpretation, and the prep sheet already knows them. Feeding
   terminology hints straight into the recogniser is the single cheapest
   accuracy win available.
3. **Cost and session length.** A 45-minute service is well under $0.40, and
   the socket is built for continuous audio rather than turn-taking.

OpenAI realtime is implemented as a peer, not a fallback — it is roughly 3×
the price but a reasonable choice for a deployment already standardised on
OpenAI. Web Speech is implemented because a zero-key path matters: an
interpreter can open the tool on any Chrome and be running in two taps.

Prices are indicative list rates at time of writing and will drift; treat the
ordering as more durable than the numbers.

### The provider port

```ts
interface SpeechProvider {
  connect(): Promise<void>;
  sendAudio(chunk: ArrayBuffer): void;
  disconnect(): Promise<void>;
  onPartial(cb: (text: string) => void): void;
  onStable(cb: (text: string) => void): void;
  onStatus(cb: (status: SttStatus, detail?: string) => void): void;
  onError(cb: (error: Error) => void): void;
}
```

`SocketSpeechProvider` implements the parts every cloud vendor needs and none
make easy: exponential-backoff reconnection, buffering the ~10s of audio
produced while a socket is down, and telling a deliberate close apart from a
dropped one. A dropped socket mid-service is normal; losing the session
because of one is not.

---

## Real-time audio transport

Audio is captured through an `AudioWorklet`, resampled to 16 kHz mono, and
emitted as ~50 ms PCM16 frames. No file upload: a 45-minute service is ~80 MB
of WAV, and batch upload cannot produce partials at all.

**WebSocket over WebRTC.** WebRTC's advantages — NAT traversal, jitter buffers,
adaptive bitrate — solve problems this product does not have (one client, one
server, local microphone). WebSocket is what both chosen vendors expose
natively, it is trivially debuggable, and it reconnects with plain code. WebRTC
stays viable later for a *remote* audio feed, which is why `MicrophoneCapture`
accepts a `MediaStream` rather than a device id — a church mixer over USB
audio, or a WebRTC track, drops in without touching the capture code.

---

## Provider abstraction

Three ports, three factories, no vendor names above them:

```
providers/stt/    demo · webspeech · deepgram · openai
providers/llm/    mock · openai · anthropic          (server only)
providers/bible/  reference-only · public-domain · api-bible
```

Switching vendor is an environment variable. The engine, the console and the
prompts do not know which one answered.

### The LLM boundary

`/api/interpret` is the only place a model is called during a session. It:

- validates the request with Zod before doing anything;
- composes the system prompt from `interpreter/prompts/` by mode;
- validates the model's reply against `interpreterOutputSchema`;
- **never fails the caller** — a vendor error, a timeout or malformed JSON
  degrades to the deterministic local interpreter and is reported in
  `degraded`, so the Korean transcript keeps running.

### The Bible boundary

The default provider returns **no verse text at all**, and that is a product
decision rather than a limitation. NIV, ESV, NLT, NASB and NKJV are all under
copyright; none may be bundled or proxied without a licence. A reference on
screen is genuinely useful to an interpreter. An invented verse is a disaster.
So: verse wording appears only when a provider legally supplied it.

---

## Demo mode

Demo mode replays a scripted Korean sermon as a real event stream — growing
partials at a speaking rate, then a stable result, then silence — through the
*same* `SpeechProvider` port as Deepgram. The stabiliser, the rolling context,
the chunk store and the console all run for real. Only the network is absent.

That makes it a genuine end-to-end exercise of the pipeline, usable as a
regression test, and it means the whole product is demonstrable with no
microphone, no key and no connectivity.

---

## Resilience

State is per-subsystem, not global, so one failure never blanks the console:

| Failure | What happens |
| --- | --- |
| STT socket drops | `reconnecting`, audio buffered, auto-reconnect with backoff |
| STT dies entirely | `health.stt = down`; English already on screen stays locked |
| LLM errors or times out | `health.llm`; Korean transcript, Scripture, glossary and wordplay detection all continue — they are local |
| LLM returns bad JSON | Rejected by Zod, falls back to the local interpreter |
| Bible lookup fails | Reference shown without text. Never a guess |
| Offline | Service worker serves the app shell; demo mode works fully |

---

## Project structure

```
src/
  app/                     routes + API handlers
    api/interpret          live interpretation (LLM key stays here)
    api/prep               pre-session briefing
    api/bible              Scripture resolution
    api/stt/token          short-lived recogniser credentials
    api/config             what this deployment can actually do
  components/ui/           the entire component vocabulary
  features/
    live/                  console, streams, teleprompter, controls
    prep/                  prep sheet and brief
    sessions/              history, review, export
  providers/
    stt/ llm/ bible/       vendor ports + factories
  interpreter/
    engine/                session state machine, stabiliser, chunk store, lag
    prompts/               prompt modules by mode — never inline in components
    context/               rolling window, compression, session memory
    glossary/              lexicons + whole-word Korean matching
    scripture/             66-book table, numerals, reference detection
    cultural/              idioms, wordplay, name puns
    prep/                  deterministic brief
  demo/                    scripted sermon fixtures
  lib/                     schema, export, storage, romanisation
  hooks/                   auto-scroll, hotkeys, wake lock, capability
tests/                     acceptance cases + evaluation fixtures
docs/
```

---

## Deployment

Vercel-ready as-is: `npm run build` produces a standard Next.js output with
five dynamic route handlers and the rest static. Set the environment variables
from `.env.example` in the project settings.

Nothing about local development requires deployment, and nothing about the MVP
requires any key — `npm install && npm run dev` opens a fully working console
in demo mode.
