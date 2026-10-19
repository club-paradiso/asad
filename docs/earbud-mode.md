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
