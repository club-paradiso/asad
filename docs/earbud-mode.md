# Earbud Mode — Phase 1 MVP

Route: `/listen` (home page links to it)

## Scope shipped

- Listen to **one selected source language** and produce **Korean** translations.
- Reuse the existing Live Interpretation STT providers, session engine, LLM translator, and language registry.
- Read **committed**, non-provisional, sufficiently confident translations using browser `speechSynthesis`, with `ko-KR` locale.
- Do not voice anticipation, unsettled/current translations, low-confidence chunks, or retrospective correction chunks.
- Deduplicate by chunk ID to prevent a committed chunk being read twice after rerenders.
- Drop stale audio waiting behind three queued sentences; show a visible warning.
- Explicit test sound, output-confirmation checkbox, synthetic/non-identifying-data checkbox, optional mic input selector for raw audio providers, and live transcript/translation.
- Reuse the Live cloud privacy consent gate. An acknowledgement is separate from the next physical Start tap so iOS Safari can use its microphone user activation.
- Honor access-key-gated deployments; reject demo-only or no-real-LLM configurations for this mode.
- Do not store a session transcript from the new surface.

## How to test without personal data

1. Run `npm install && npm run dev`; open `/listen` using HTTPS or localhost.
2. Configure a working STT provider (e.g. Deepgram) **and a real translation model**. The UI refuses to treat rule-based local assistance as a real translation.
3. Connect one AirPods Pro 2 earbud. Select a source language and tap **음성 테스트**. Confirm that Korean is audible **in that earbud**, not from the iPhone speaker.
4. Check both required acknowledgements, review any cloud-provider disclosure, and tap **통역 시작** on a separate user gesture.
5. Speak *fictional* statements from a second speaker. Confirm STT source text and settled Korean translation. Listen for one utterance per committed chunk.
6. Toggle TTS off; verify that live transcription continues and no old voice backlog plays after turning TTS back on.
7. End the session and verify that the microphone and output stop.
8. Run `npm run typecheck && npm test && npm run build` before merge.

## iPhone 15 + AirPods Pro 2 limitations (not verified)

- Apple's built-in AirPods live translation still cannot run on a standard iPhone 15 / 15 Plus. This mode performs its **own** interpretation.
- On iOS Safari, speech synthesis uses the **system-selected output**. The web app cannot guarantee left or right AirPod, force Bluetooth routing, or assert that audio was actually heard.
- `getUserMedia` may receive AirPods microphone input when Bluetooth is active. The web app **cannot guarantee** independent iPhone microphone capture and Bluetooth earbud playback. Input device enumeration and selection depend on iOS/permissions.
- Browser audio may be blocked or suspended in the background and with a locked screen. Leave the page open and awake.
- Safari may require an explicit user gesture to unlock speech output. Use the test button first.
- Browser speech recognition may be sent to the browser vendor's cloud even when ASAD STT is configured as `webspeech`.
- Browser TTS Korean voice quality and launch latency vary by iOS version and selected voice.
- STT accuracy, translation accuracy, end-to-end speech latency, and full-duplex feedback/echo remain **unmeasured**. No performance SLA or official public-service readiness is asserted.

## Release gates

- [ ] CI typecheck, lint, unit tests and build complete.
- [ ] iPhone 15 / 15 Plus + one AirPods Pro 2: actual Korean voice output verified.
- [ ] Bluetooth output and *iPhone-built-in* mic simultaneously verified. If unsupported, provide an honest alternative input setup.
- [ ] Safari permissions, external calls and tab-lock interruptions observed in person.
- [ ] Test 10+ fictional utterances for duplicate/skipped audio and delayed playback.
- [ ] Evaluate iOS output quality for 2+ languages and noisy-room STT on non-sensitive test recordings.
- [ ] Institutional authorization, security assessment and data protection controls completed **before any real case data** is processed.

## Important privacy boundary

Do **not** use this MVP on real immigration-counter visitors or process identifiable immigration, visa, enforcement or refugee statements. This is an experimental aid, not an authorized agency translation platform. For future public-service use, redesign access controls, sensitive-case provider routing, consent, data retention, logging, audit, and legal/procedural terminology verification.

## Future work

- Streaming Korean TTS with cancellable output and measurable per-chunk latency.
- iOS native proof-of-concept if dual routing or background audio proves impossible in Safari/PWA.
- Guard against feedback loops through voice activity detection and acoustic echo cancellation tests.
- Explicitly validated multilingual STT matrix, accuracy/latency benchmark, jurisdiction-specific terminology, access policies.

---

## Phase 2: audio routing, output quality, and free-model strategy (2026-10-19)

The original browser-only speech synthesis did **not** check whether an iPhone was
actually outputting to AirPods. Merely calling `speechSynthesis.speak()` is no
proof of audible sound. iOS WebKit can also change Bluetooth output on
`getUserMedia` activation, or stall browser speech recognition during TTS.

### New diagnostic sequence

1. Open the new PR **preview**, connect a single AirPods Pro 2, and select
   the AirPods in iOS Control Center output selection.
2. Press **출력 경로 테스트**. This plays a locally generated 200ms WAV tone from
   an HTML audio element: **no microphone, no TTS model, no paid API**.
3. Press **한국어 음성 테스트**. This tests browser `speechSynthesis`
   separately; a callback indicating "started"/"ended" is **not** proof sound
   reached an earbud.
4. If the tone is audible but the speech is silent, the failure is more likely
   browser TTS rather than all system audio. Try the optional Gemini audio-file
   playback only after the deployment owner confirms an unbilled free-tier key.
5. If both are silent, verify Safari vs home-screen web app, Control Center
   output, media volume, Silent Mode, Bluetooth pairing and iOS version. Do not
   assume a software fix has successfully routed to AirPods.
6. Start only a fictional-language test after the audio test works. iOS may
   **change the output route when microphone capture starts**, so retest while
   translating. Keep Safari foregrounded. A clean status code is not a
   successful earbud test.

The web app can set a best-effort `navigator.audioSession.type` hint
(`playback` for isolated tests, `play-and-record` before mic capture).
This is not device selection or a cure for WebKit audio routing bugs.
If simultaneous input and output still cannot be maintained, ship a native
`AVAudioSession` proof of concept rather than promising Web/PWA full-duplex.

### Strict free-first backend (new isolated endpoints)

- **Speech-to-text**: browser Web Speech only in `/listen`. No Deepgram or
  OpenAI streaming STT automatic charge/fallback. Web Speech can still route
  audio to the browser's cloud service, with vendor privacy limitations.
- **Translation model**: `gemini-3.1-flash-lite`, pinned **only** for
  `/api/earbud/interpret`. Google documents a free API tier and labels this
  model suitable for translation, with rate limits; its free tier can use input
  to improve products. The translation route reuses schema validation, bounds
  prompts/output, caps the request budget, and never uses premium recovery.
- **Korean voice**: `speechSynthesis` first, local with no API charge.
  Alternative `gemini-2.5-flash-preview-tts` uses Korean PCM audio returned
  by a gated `/api/earbud/tts` route, then played using an HTML audio element.
  Gemini's pricing lists free-tier TTS. This is **optional, not automatically on**.
- **Additional environment requirements**: `APP_ACCESS_KEY` and
  `GEMINI_API_KEY` on a Google project verified to have **billing disabled**.
  To enable optional Gemini TTS, set `ASAD_EARBUD_GEMINI_TTS=1` in the protected
  preview environment, after verifying the account is free-tier only. ASAD
  cannot read Google's billing account and therefore cannot itself guarantee
  no charges if a paid project or billing upgrade is configured.
- **Volume limits**: client voice queues drop stale lines at 8s and limit
  backlog to 3. The TTS route has per-session/per-address per-minute throttles.
  A global/free-provider account limit may still end a session early; **fail
  closed on quota errors**, do not buy more capacity.
- **Confidence**: only engine-committed, non-provisional, non-low-confidence
  translation chunks are eligible for speech. Exact duplicate text is skipped.
  A simple client-observed delay sample is shown, **not a measured end-to-end
  SLA**.

### Security/consent caveat

Google's **free** API tier may use submitted text or audio to improve its
products; do not submit real immigration, enforcement, asylum or identifiable
statements. Processing raw live conversations at a public agency requires
separate authorization, verified DPA/retention, and secure architecture.
The `ASAD_EARBUD_GEMINI_TTS` flag is deliberately off until the owner
accepts these limitations. No secrets are stored in source code.

### Additional release checks

- [ ] Confirm unbilled Google AI Studio free-tier API project and any free
      quota caps before enabling Gemini TTS.
- [ ] Verify `/api/earbud/status` reports expected preview capabilities.
- [ ] iPhone 15 Safari: tone before mic, voice before mic, tone/voice after mic.
- [ ] Confirm real output destination by listening: AirPods vs speaker.
- [ ] Demonstrate a short mock multilingual conversation without speech echo
      or STT stalling; if impossible, leave the mode in Draft.
- [ ] Confirm no automatic calls to paid STT, OpenRouter, fallback gateways or
      premium translation models.


---

## Phase 3 · Smart Ensemble (draft preview, 2026-10-19)

### Workflow

```
Web Speech STT (one recognized source utterance)
   |-- in parallel --> Index-Translate-35B-A3B (public API)
   +-- in parallel --> Azure Translator Text F0 (subscription key)
       |
       v
 deterministic gate: Korean present + token/code/amount + negative meaning
       |
  strong lexical agreement -------------------> approved selected candidate
       |
  mismatch --> optional Gemini 3.5 Flash-Lite judge
                    |   only selects "index"/"azure"/"abstain"
                    |   cannot generate an alternative translation
                    +-- verified choice ------> approved selected candidate
                    +-- uncertain/no quota ---> abstain; do NOT speak
       |
 engine committed translation -> existing guarded AirPods TTS queue
```

The ensemble is an **experimental assistant**, not a proof of semantic
correctness, nor a certified legal interpreter. It cannot repair hallucinated
STT source text, correlated model errors or Safari's Bluetooth-routing bugs.
The lexical similarity threshold is conservative and cannot validate semantic
equivalence. The optional judge may be incorrect. A missing provider or quota
error leads to **no spoken translation** instead of a silent paid fallback.

Both Index and Azure receive the same fictional source text. When explicitly
enabled, Gemini receives the source and two translations on disagreement.
Neither provider nor transcripts are logged intentionally by ASAD.

### Required private preview configuration

```dotenv
# Required: existing protected/private ASAD preview access gate.
APP_ACCESS_KEY=<your existing key>

# Turn on the endpoint: all three switches are required.
ASAD_EARBUD_ENSEMBLE=1
ASAD_INDEX_TRANSLATE_PUBLIC=1
ASAD_AZURE_F0_CONFIRMED=1
AZURE_TRANSLATOR_KEY=<key for a genuine Azure Translator F0 resource>

# Optional if using a regional resource rather than global.
AZURE_TRANSLATOR_REGION=koreacentral

# Optional: only after you confirm Google API free-tier and no paid billing.
ASAD_EARBUD_GEMINI_JUDGE=1
GEMINI_API_KEY=<existing key on an unbilled free-tier project>
```

**Do not commit real credentials.** These values are NOT set automatically
because that would require provider sign-up and confirmation of the user's own
quota/billing status. A boolean operator flag cannot technically prevent an
Azure/Gemini account being converted to paid billing; resource tier limits and
provider dashboards must be checked. For multi-instance deployments, requests
and Azure character usage require a shared quota budget (e.g. Redis); the
current per-session/address request rate limit is **not** a cross-instance
monthly spending cap. Leave these options disabled until that's configured.

Official integration references:
- Index-Translate public chat completion:
  https://github.com/bilibili/Index-Translate
- Azure Translator v3 translate:
  https://learn.microsoft.com/en-us/rest/api/translator/translator/translate
- Azure authentication:
  https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/authentication

### UI and fallback behavior

- `/listen` allows explicit **Smart Ensemble** or **Gemini-only** selection
  before a new session. Changing the selected mode resets the cached cloud
  lane on the next Start. It cannot silently switch providers mid-session.
- A separate explicit consent checkbox is mandatory for the selected providers,
  in addition to the synthetic-only and audio tests.
- `GET /api/earbud/status` exposes only booleans and model labels.
- `POST /api/earbud/ensemble` reuses `interpretRequestSchema`, cookie/session
  guards, bounded body and rate checks. All inference happens on the server.
- Two candidates run in parallel with 2.7s per-provider deadline and an
  optional 1.25s judge window. Outer turn deadline: 4.2s. Fast/other live
  profile and network overhead may still cut a result short.
- Low-confidence or no-consensus output is **not read aloud**. The UI explains
  why it withheld speech; **no fabricated fallback translation** is voiced.
- The optional judge can only choose an existing candidate or abstain.
- Regression tests cover code/amount omission, lost English negation,
  independent agreement, disagreement, a missing provider and failed judge.

### Acceptance criteria

- [ ] CI lint, TypeScript, unit tests, build and E2E pass
- [ ] Live Index public endpoint response verified from a protected preview
- [ ] Azure Translator F0 key and region verified on owner's free-tier account
- [ ] Real Korean/English/Chinese/Indonesian/Vietnamese synthetic dialogue set:
      at least 100 labeled turns; accuracy, critical entity retention, P50/P95
      delay, no-consensus frequency and no unintended audio evaluated
- [ ] Third-party privacy, terms and retention assessed before non-synthetic
      data, and service-policy approval before any agency use
- [ ] AirPods test audio before/after microphone activation on iPhone 15
