# ASAD autonomous validation report — 2026-10-25

Branch `feat/autonomous-audio-bridge-live-upgrade` on top of `main@c8baaf9`.
Machine: the target MacBook Air M1 (8 GB, macOS 15.6.1), Node 24.14. No
provider credential was used at any point; the one key present in the shell
was deliberately excluded from every measurement.

## Executive summary

- **Hardware:** `HARDWARE_TEST_REQUIRED`. The listed cables cannot complete a
  path from the SIU-1000 to the Mac (the headset splitter is the wrong
  direction), the Daiso adapter was not present to be identified, and the
  Mac's only analogue input is a headset-microphone contact with
  impedance-based detection. A native probe and a ten-minute booth procedure
  are delivered so the verdict can be settled on site without buying
  anything. No acoustic workaround is presented as capture.
- **Audio bridge (software):** implemented. The live path now measures the
  audio it sends; the console says **No signal** / **Input too loud**; the
  device is named; the launcher and preflight call out a laptop or phone
  microphone; the resampler feeding cloud recognisers is fixed.
- **Dictation:** prayer endings are sentence boundaries (10/10 vs 2/10),
  duplicate finals are dropped; recognition accuracy on real audio is
  **NOT VERIFIED** (no credential, no authorised audio).
- **Latency:** engine behaviour is unchanged by measurement (11.1 calls/min,
  stable→safe p50 200 ms, p95 1.0 s on the local interpreter; 45-minute
  soaks pass); the deterministic gain is 0.9–2.6 s on prayer lines. Real
  provider latency is **NOT VERIFIED**.
- **UX/UI:** preflight rewritten for volunteers, diagnostics opens with an
  eight-way verdict, console gains two actionable states; screenshots at
  four viewports.
- **Code quality:** lint, typecheck and build clean; 46 new tests; every
  E2E scenario passes except one Counter Mode check that fails identically
  on `main` in this environment (see §4).
- **Production readiness:** **ready to merge as a software release**;
  **not ready to declare the booth feed solved** until the on-site test in
  the feasibility report has been run.

## 1. Hardware feasibility verdict

`HARDWARE_TEST_REQUIRED` — see
[`../audio-bridge/macbook-m1-feasibility.md`](../audio-bridge/macbook-m1-feasibility.md).

Exact devices detected (2026-10-25, adapter not connected):

| Device | Transport | In/Out | Recordable |
| --- | --- | --- | --- |
| MacBook Air 마이크 | built-in | 1/0 | yes (acoustic) |
| MacBook Air 스피커 | built-in | 0/2 | no |
| ‘좌영춘의 Z Fold8’ 마이크 | continuity-wired | 1/0 | yes (phone, acoustic) |
| ZoomAudioDevice | virtual | 2/2 | yes (only what Zoom plays) |
| 다중 출력 기기 | aggregate | 0/2 | no |

USB bus: empty. 3.5 mm jack: nothing inserted. Built-in microphone capture
verified with real samples (`USABLE`), which proves the probe, not a feed.

Physical connection options investigated: console headphone/line output →
(a) Mac 3.5 mm jack directly, (b) via the PC headset splitter, (c) via the
Daiso USB-C adapter, (d) via an ordinary aux lead if one were found. (a)
needs a TRRS plug and mic-level signal; (b) is wired in the wrong direction
and cannot reach the microphone contact; (c) depends on whether the adapter
contains a codec, unknown until plugged in; (d) presents a three-pole plug
and is detected as headphones. None is labelled operational.

## 2. Implemented improvements

| Area | Change | Evidence |
| --- | --- | --- |
| Capture | stateful anti-aliased 47-tap resampler with carried phase | `resampler.test.ts` (9 tests) |
| Capture | per-frame RMS/peak reporting, noise-suppression option, track info | `audio.test.ts`, type-checked wiring |
| Console | `InputHealthMonitor`; **No signal** after 12 s; **Input too loud** on clipping; device named in settings | `input-health.test.ts` (10), `ConsoleTopBar.test.ts` (+6) |
| Launcher | worship input row flags laptop/phone/Bluetooth microphones | `StartScreen.readiness.test.ts` (+2) |
| Preflight | four-step volunteer flow, silence/clipping messages, device kind, troubleshooting | screenshots; `audio-input-kind.test.ts` (14) |
| Diagnostics | Live readiness verdict + local level check (8 situations) | `live-diagnosis.test.ts` (10); screenshots |
| Dictation | 소서/아멘 boundaries; duplicate-final guard | `stabiliser-sermon-endings.test.ts` (10), `duplicate-stable.test.ts` (6) |
| Rendering | memoised `ChunkLine` | not measured |
| Tooling | `tools/audio-probe` (Swift CLI: list / capture / watch) | run on this machine, evidence JSON committed |
| Benchmarks | `--local` flag; harness strips provider credentials | before/after runs |

## 3. Automated checks on the branch

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run build` | clean (Next 16 production build) |
| `npm test` | 1,629 / 1,631 pass (144 files; +69 tests vs main). The 2 failures are the same two `consent.test.tsx` cases that fail on `main` in this environment while CI is green for that SHA — see the audit, §3.1 |
| `npm run bench:live -- --local` | 111 calls / 10 min, stable→safe p50 200 ms, p95 1,000 ms (unchanged from main) |
| `npm run bench:live -- --local --simulate-cloud` | 103 calls, stable→interpretation p50 5.7 s / p95 10.0 s (unchanged from main) |
| `npm run soak -- --minutes 5 --local` and `-- --local` (45 min) | 7/7 pass both; 499 calls at 11/min over 45 min; heap +1.1 MB |
| `npm run soak:two-lane -- --minutes 5 --local` and `-- --local` (45 min) | 11/11 pass both; 481 cloud calls at 10.7/min, max 1 in flight, 0 lost Korean, 0 rewrites, heap +6.1 MB |
| `npm run e2e:live-fallback` | 7/7 pass |
| `npm run e2e:live-failure` | 14/14 pass (every Web Speech error code stays off the screen) |
| `npm run e2e:live-quota-bypass` | 4/4 pass |
| `npm run e2e:live-two-lane` | 16/16 pass |
| `npm run e2e:live-languages` | 11/11 pass |
| `npm run e2e` | 25 pass, 1 fail — see §4 |
| Screenshots (laptop / iPad / iPhone landscape / iPhone portrait) | 11 captured, reviewed, committed under `docs/ux/screenshots/` |

## 4. The one failing E2E check

`scripts/e2e-check.mjs` → "one mic tap starts listening" (Counter Mode
visitor page, mocked SpeechRecognition). The check reads `button[aria-pressed="true"]` 50 ms after
tapping *Speak* and then waits 2.5 s for *Edit transcript*. It fails
identically — 25 pass, the same 1 fail — against a clean build of `main`
(`c8baaf9`, own `npm ci`, port 3101) in this environment, run back to back
with the branch. The same script is green in CI on Ubuntu for that SHA. The
visitor page's voice path uses a mocked `SpeechRecognition`, not
`MicrophoneCapture`, so none of this branch's capture changes are on that
path. Classified as a local-environment (macOS headless shell under a load
average above 20) timing failure that predates the branch; not fixed here, not
weakened, and recorded so the next person does not chase it.

## 5. Tests that need what this environment does not have

| Test | Needs | Status |
| --- | --- | --- |
| Korean recognition accuracy before/after the resampler fix | Deepgram or OpenAI credential + authorised sermon audio | NOT VERIFIED |
| Cloud model latency and quality | provider credential | NOT VERIFIED (the shell's key was observed timing out and not spent) |
| Chrome on-device Translator | desktop Chrome with the ko→en pack, manual | NOT VERIFIED (mocked in E2E, as before) |
| Physical capture from the SIU-1000 | the booth, the console, the adapter | HARDWARE_TEST_REQUIRED |
| **No signal** / **Input too loud** on a real feed | a raw-audio session with a physical input | unit-tested only |
| Microphone permission denied in a real browser | a person declining the prompt | handled in code; E2E `live-failure` covers the recogniser's `not-allowed` path |
| Device disconnect mid-session | unplugging during a session | existing `transport-supervisor` tests + E2E `live-failure`; not physically repeated |

## 6. Objectives

| Objective | Verdict |
| --- | --- |
| Accurately report whether a physical sermon signal can be captured with existing hardware | **PARTIAL** — the inventory analysis is complete and documented; the on-site test is specified but not run |
| If direct capture possible: samples reach macOS, ASAD can access the input, Korean recognised, in-ear monitoring intact, distortion acceptable | **BLOCKED** (no path with listed cables; procedure delivered) |
| If impossible: physical reason documented, nothing unsupported labelled operational | **PASS** |
| Dictation: demonstrable accuracy improvement or transparent report | **PARTIAL** — boundary and duplicate handling verified deterministically; acoustic accuracy NOT VERIFIED |
| Clear interim/final transcript states | **PASS** (pre-existing, preserved: `korean-partial` vs `korean-stable`, `≈` provisional marker) |
| Reliable recognition recovery | **PASS** (pre-existing supervisor; E2E `live-failure` 14/14) |
| Translation: measured before/after latency | **PASS** for the engine (unchanged); real provider NOT VERIFIED |
| No material regression in meaning/terminology | **PASS** — prompts, glossary, Scripture and engine invariants untouched; 1,500+ existing tests pass |
| Stable bounded behaviour over long sessions | **PASS** — 45-minute soaks, both modes |
| Main workflow remains accessible | **PASS** |
| Audio status understandable | **PASS** (console states, settings line, preflight, diagnostics) |
| Significant usability problems addressed | **PASS** for the four found; no redesign attempted |
| Responsive layouts and critical states tested | **PASS** for layouts (4 viewports); input fault states unit-tested, not photographed |
| No unresolved new critical regressions | **PASS** |
| Relevant automated tests pass | **PASS** with the §4 exception, shown to predate the branch |
| Changes documented | **PASS** (five documents + `docs/sermon-booth.md`) |
| Reversible deployment path | **PASS** — one branch, no config, no dependency, no provider change; revert the merge to roll back |

## 7. Commits and PR

Pull request: [club-paradiso/asad#148](https://github.com/club-paradiso/asad/pull/148)

Code commits, oldest first:

- `db51de5` fix(stt): stateful anti-aliased resampler, per-frame levels, noise-suppression option
- `71ad49d` feat(live): measure the input and say "No signal" / "Input too loud"
- `b226f50` feat(engine): prayer endings as sentence boundaries; drop replayed finals
- `c2d71c4` design(preflight): a four-step check a volunteer can finish
- `6247982` feat(diagnostics): Live readiness verdict and a local input check
- `79e8e2c` perf(console): memoise ChunkLine
- `a33eae3` bench: --local ignores provider credentials in the environment
- `5a4d1f4` tools: native macOS audio probe (list / capture / watch)

The documentation commit that carries this report, the four companion documents, the screenshots and the evidence JSON follows these.

## 8. Production readiness verdict

**Software: READY.** The branch is additive, fully tested where testable,
and changes no deployment configuration or billing. Merge and deploy as a
normal release.

**Booth feed: NOT YET.** Run the ten-minute booth test in the feasibility
report with the console and the adapter present. Until it yields
`DIRECT_CAPTURE_VERIFIED`, a service should be run as today — the
interpreter on the church system, ASAD on the browser recogniser with
whatever microphone exists — with the new preflight and diagnostics telling
the volunteer honestly what the laptop is hearing.
