# Multilingual speech recognition evaluation

## Status

| Item | Status |
| --- | --- |
| Word/character error rates per language | **NOT VERIFIED** — no audio dataset, no recogniser credential, no microphone in the container |
| Endpointing latency model | PARTIAL — deterministic, tested; not measured on audio |
| Capability table audit | PASS — read against the registry |
| Transcript hand-off latency | PASS — structural change, tested |

## What the pipeline does (as found)

```
tap ─► ensureMicrophonePermission ─► fetch STT credential (only if a cloud
recogniser covers the language) ─► open socket + microphone together, buffer
pre-connect audio (≤ 192 KB) ─► provider interim/stable results ─► after the
last stable segment, wait `stableDelayMs` (1.7 s base, raised per language to
1.5–1.9 s) ─► finish ─► await microphone.stop() and provider.disconnect()
─► transcript into the Composer for review ─► send
```

Deepgram is opened with `endpointing=1000` in utterance mode, so a Deepgram
turn ends only after ≈ 1.0 s of provider-side silence **plus** 1.5–1.9 s of
client-side stable wait: ≈ 2.5–2.9 s from the last word to a transcript the
visitor can read. The browser recogniser has its own (undocumented) endpointing
before the same client wait.

## Changes

### Punctuation-aware trailing wait (`utteranceDelay`)

When the stable text already ends in sentence-final punctuation
(`. ? ! 。？！ … ؟ ۔ । ။ ។` with closing quotes allowed), the wait drops to
0.6 × the language floor, never below 900 ms:

| Language | Not yet a sentence | Sentence closed |
| --- | --- | --- |
| ko | 1 500 (base 1 700 → 1 700) ms | 1 020 ms |
| en, default | 1 700 ms | 1 020 ms |
| zh | 1 900 ms | 1 140 ms |
| ja, ar, ur | 1 700 ms | 1 020 ms |
| vi, mn, uz, ne | 1 600–1 700 ms | 1 020 ms |

Cloud recognisers punctuate (Deepgram `punctuate`+`smart_format`, Whisper);
the browser recogniser mostly does not, so the saving applies to the cloud
path. **Model-based estimate**: for a cloud turn whose final segment is
punctuated, last word → transcript falls from ≈ 2.7 s to ≈ 2.0 s. This has not
been measured on audio and should be, with a held-out set of recorded desk
utterances, before anyone quotes it as a result. The wait is never removed, and
tapping Stop still ends the turn immediately. Tests: `counter-speech.test.ts`
"utterance endpointing".

### Transcript before teardown

`attempt()` used to `await microphone.stop()` (which closes an AudioContext —
tens to hundreds of milliseconds on phones) and `await provider.disconnect()`
before returning the text. Teardown now starts immediately but no longer
blocks the hand-off. Microphone release is still requested at the same
instant; only the wait moved.

## Capability audit (registry-driven, read-only)

- Languages with no recogniser anywhere in the stack (Uyghur) get no
  microphone and no permission prompt — unchanged and correct.
- `variant-lossy` handling (Traditional Chinese through a Whisper endpoint)
  still prefers the browser recogniser when it preserves the script.
- Keyterm hints are sent only for `immigration`, `public-office`, `refugee`
  profiles and only in Korean/English plus Latin codes — unchanged. Hints for
  Vietnamese, Russian, Chinese desk vocabulary are an open item.

## How to measure WER/CER when audio is available

1. Record (with consent) or synthesise 50–100 short desk utterances per
   priority language, with reference transcripts, including status codes,
   dates, amounts and names.
2. Drive `CounterSpeechController` with a recorded-audio `createMicrophone`
   dependency (the test harness in `counter-speech.test.ts` shows the seams)
   against each recogniser; record first-partial, final and finish timestamps
   via `VoiceAttemptTrace`.
3. Score CER for ko/zh/ja/th and WER elsewhere; report per language and per
   recogniser, separately from translation quality.
