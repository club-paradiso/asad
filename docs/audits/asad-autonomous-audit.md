# ASAD autonomous engineering audit — 2026-10-25

Branch `feat/autonomous-audio-bridge-live-upgrade`, from `main` at `c8baaf9`.
Performed on the target machine itself (MacBook Air M1, macOS 15.6.1, Node
24.14, npm 11.9) with no provider credentials used.

This is the Phase A record: what the repository was before anything was
changed, what was found, and what was done about each finding. The hardware
verdict is in [`../audio-bridge/macbook-m1-feasibility.md`](../audio-bridge/macbook-m1-feasibility.md),
the measurements in [`../performance/live-before-after.md`](../performance/live-before-after.md),
the interface work in [`../ux/live-ux-audit.md`](../ux/live-ux-audit.md), and
the pass/fail ledger in [`../release/autonomous-validation-report.md`](../release/autonomous-validation-report.md).

## 1. Baseline

| Check | Result on `main` |
| --- | --- |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm test` (1,562 tests / 138 files) | 1,557 passed, **5 failed** — see §3.1 |
| `npm run bench:live` | **invalid in this shell** — 2 calls in a simulated 10 minutes; see §3.2 |
| `npm run bench:live` with provider keys unset | 111 calls / 10 min (11.1 per min), provider p50 1 ms, stable→safe p50 202 ms, p95 1,001 ms |
| `npm run soak -- --minutes 5` (keys unset) | all 7 checks pass, 11 calls/min |
| `npm run soak:two-lane -- --minutes 5` (keys unset) | all 11 checks pass, 10.6 calls/min |
| CI on `main` (GitHub Actions) | green for the last five commits |

## 2. Architecture as found

```
getUserMedia ─► MicrophoneCapture (AudioWorklet, 128-sample quanta)
                  └─► resample 48/44.1 kHz → 16 kHz PCM16, 50 ms frames
                        └─► SpeechProvider: webspeech | deepgram | openai | demo
                              └─► TransportSupervisor (reopen / interrupt / stop)
                                    └─► InterpretationEngine (framework-free, clock-injected)
                                          ├─ stabiliser → logical turns
                                          ├─ lane A: Chrome on-device Translator (provisional)
                                          ├─ lane B: /api/interpret via cloud-lane.ts (contextual)
                                          └─ chunk store: anticipated → current → committed
                                                └─► useLiveSession → LiveConsole (TargetStream, SourceStream, ContextRail)
```

Surfaces: `/live` (launcher + console), `/booth-preflight`, `/diagnostics`,
`/prep`, `/sessions`, `/counter` and `/c/[code]` (Counter Mode, untouched),
`/listen` (earbud, untouched).

### What was preserved, deliberately

- The **two-lane engine** (`src/interpreter/engine/session.ts`, `turns.ts`,
  `chunks.ts`) and every invariant its 745-line race test enforces. Not
  rebuilt; only one guarded entry point (`handleStable`) gained a rule.
- The **transport supervisor** and the exact-device rule: a missing mixer is
  still a visible fault, never a silent fallback to the laptop microphone.
- The **booth preflight acknowledgement** contract (session-scoped, device-
  scoped, four-hour expiry).
- The **consent-before-cloud** gate on the launcher.
- Counter Mode and its workflows.
- The live console's design rule that the status strip is silent while things
  work. The two new states it can show are both actionable faults.

## 3. Findings

### 3.1 Five baseline test failures — environmental, not regressions

Three (`counter-api`, `ConversationView`, `RescueControl`) timed out at the
5 s default under a machine load average above 20 (another session's iOS
Simulator and headless Chromium were running) and pass in isolation. Two in
`consent.test.tsx` ("sends nothing from load until the disclosure is
acknowledged", "refuses to start while the disclosure is outstanding") fail
locally in isolation as well, while the same SHA is green in CI on Node 22.
They were not weakened or skipped. Re-run on the finished branch they still
fail locally (1,629 / 1,631 pass) and are recorded as a local difference.

### 3.2 The benchmark harness was measuring a shell variable, not the engine — **fixed**

`~/.zshrc` exports `GEMINI_API_KEY`. The live harness builds a real
`LlmRouter` from `process.env`, so every simulated turn tried Gemini, waited
for the 4.2 s provider deadline in real time while the virtual clock ran
minutes ahead, and the "10-minute" benchmark completed two calls. The
committed results from September were produced without the key and show 111.
The key was **not** used beyond observing the timeout: the mission forbids
spending credentials, and the behaviour was reproduced with a three-call probe
and then by unsetting the variable.

Fix: `runLiveBenchmark({ localOnly })` strips the seven provider/gateway
credentials from the environment copy it parses, and `--local` is accepted by
`bench:live`, `soak` and `soak:two-lane`. The before/after numbers in the
performance report were all taken with it.

### 3.3 The capture resampler dropped samples and aliased — **fixed, measured**

`downsample()` in `src/providers/stt/audio.ts` was stateless and linear. Each
128-sample AudioWorklet quantum at 48 kHz produces 42.67 output samples; the
per-call `floor` emitted 42. The stream labelled 16 kHz therefore carried
15,750 samples per second (1.6 % short; 0.95 % at 44.1 kHz), and nothing
removed content above 8 kHz before decimation, so a 12 kHz component reached
the cloud recogniser as a full-level 4 kHz one. Browser recognition
(`webspeech`) never touched this path, which is why it was invisible on the
zero-credential deployment.

Fix: a stateful `Resampler` (47-tap Hamming-windowed sinc, fractional read
phase carried across quanta). Tests prove 2 s of 48 kHz → exactly 32,000
samples (was 31,500), 1 kHz stays 1 kHz, and 12 kHz is attenuated by more
than 40 dB relative to the passband.

### 3.4 A silent feed looked like a healthy session — **fixed**

No part of the live path measured the audio it was sending. An unplugged
mixer with the recogniser still "listening" produced a green **Live** strip
and no English, indefinitely. Fix: `MicrophoneCapture` reports each frame's
RMS and peak; `InputHealthMonitor` (pure, tested) turns that into
`ok | silent | clipping`; the status strip says **No signal** after twelve
silent seconds and **Input too loud** on sustained clipping, ranked above model
degradation and below a lost recogniser; Session settings names the device
being listened to. For the browser recogniser, which owns its own microphone,
the console says honestly that the level cannot be seen.

### 3.5 The preflight could not tell a volunteer what was wrong — **fixed**

The meter answered "silent / low / usable / hot" and nothing else. It now
reports sustained silence and clipping through the same monitor as the
console, shows the opened track's channel count and sample rate, classifies
the selected device by its label (laptop microphone, phone, Bluetooth, USB,
external jack, virtual) with a plain-Korean note, and the screen is a
four-step checklist with a symptom-by-symptom troubleshooting list. The
launcher's Input row warns when a worship booth has the laptop's own
microphone selected.

### 3.6 Diagnostics could not distinguish the eight booth failure modes — **fixed**

`/diagnostics` was deployer-facing configuration and latency. It now opens
with **Live readiness**: a local level check plus `diagnoseLive()`, a pure,
tested table that tells apart permission denied, no input device, wrong
device, no/weak signal, clipping, STT not configured, no translation provider
and high measured latency, worst first, each with its fix.

### 3.7 Prayer endings were not sentence boundaries — **fixed**

The stabiliser's sentence regex lacked the supplicative `소서` and `아멘`, so
the most formulaic speech of a service — the closing prayer — was flushed on
silence or the hold ceiling, up to 2.6 s late at the default lag. Both are
now boundaries; tests cover five prayer closings and four open clauses that
must keep waiting.

### 3.8 A replayed final was interpreted twice — **guarded**

Socket reconnects, browser-recogniser restarts and provider duplicates can
finalise the same sentence twice within a second. The engine now drops an
exact repeat of the previous segment that arrives within 2 s, only for text of
12+ characters (so "아멘. 아멘." stays speech), and counts it in
`laneStats().duplicateStableDropped`. Tested, including that the drop never
creates a second turn.

### 3.9 Every line re-rendered on every partial — **changed, not measured**

`TargetStream` re-rendered every `ChunkLine` on each recogniser event. The
line component is now memoised. This is standard practice and low risk, but
no before/after render measurement was taken; it is reported as such.

### 3.10 Technical debt and documentation, noted and left

- `DESIGN-AUDIT-2026-10-20.md` sits at the repository root rather than under
  `docs/`; left in place.
- `docs/sermon-booth.md` describes the preferred audio order but had no
  zero-budget path; it now links to the feasibility report.
- `SessionSettings` is spread over stored JSON without a version; the new
  `noiseSuppression` field relies on that spread for its default, like every
  field before it.
- `docs/repository-audit.md` is the 2026-08 greenfield audit of the then-
  empty repository and remains accurate as history.
- The Web Speech path cannot be level-monitored without opening a second
  capture stream; this is stated in Session settings rather than faked.

## 4. Files added or changed

New: `tools/audio-probe/` (Swift CLI, `build.sh`), `src/features/live/input-health.ts`
(+test), `src/features/live/audio-input-kind.ts` (+test),
`src/features/diagnostics/live-diagnosis.ts` (+test), `InputCheck.tsx`,
`LiveReadiness.tsx`, `src/providers/stt/resampler.test.ts`,
`src/interpreter/engine/duplicate-stable.test.ts`,
`stabiliser-sermon-endings.test.ts`, the five documents listed at the top and
the evidence JSON under `docs/audio-bridge/evidence/`.

Changed: `src/providers/stt/audio.ts`, `src/features/live/{useLiveSession,
LiveConsole, ConsoleTopBar, SettingsSheet, StartScreen, BoothPreflight,
BoothPreflightScreen, TargetStream}.tsx`, `src/features/diagnostics/DiagnosticsScreen.tsx`,
`src/interpreter/engine/{session,stabiliser,turns}.ts`, `src/types/index.ts`,
`benchmarks/live-harness.ts`, `scripts/{bench-live,soak,soak-two-lane}.mjs`,
`docs/sermon-booth.md`.

No dependency was added or upgraded. No provider, billing or deployment
configuration was changed. Every change is reversible by reverting the branch.
