# Live interpretation UX audit — 2026-10-25

Scope: `/live` (launcher and console), `/booth-preflight`, `/diagnostics`.
Counter Mode, Prep, Sessions and Earbud were read for consistency and left
alone. Judged in a real Chromium at laptop (1440×900), iPad landscape
(1180×820), iPhone landscape (844×390) and iPhone portrait (390×844), dark
scheme, from the production build; screenshots are under
[`screenshots/`](./screenshots/) and listed in §5.

## 1. The user and the rule that follows

The interpreter is listening to Korean, holding context, speaking English and
glancing at a screen for about a second at a time. Everything on the console
is subordinate to that glance. The existing design already states this rule
(`docs/architecture.md`, the comments in `ConsoleTopBar.tsx`) and mostly
keeps it: a quiet status strip, English dominant, Korean capped, the context
rail absent until it has a cue, one control at the thumb.

This audit therefore did **not** redesign the console. It found three places
where the product broke its own rule by *saying nothing* when something was
wrong, and one surface (the preflight) written for an engineer rather than a
volunteer.

## 2. Findings and changes

### 2.1 Console: a dead feed looked like a healthy session — fixed

**Problem.** With the mixer unplugged and the recogniser still "listening",
the strip read **● Live** and the English stopped. There was no state for
"audio is arriving but it is silence". The interpreter's only cue was absence.

**Change.** Two new strip states, both faults, both in the existing voice:

| Strip | When | Detail (desktop only, as before) |
| --- | --- | --- |
| **No signal** (amber) | the capture has heard < −42 dBFS for 12 s | Nothing is reaching the selected input. Check the feed and the cable. |
| **Input too loud** (amber) | ≥ 5 clipped frames in 3 s | The feed is distorting. Turn the source down before recognition suffers. |

Ranking: below a lost recogniser or network (those make the input moot),
above a reduced or rule-based model (no Korean means no English, whatever the
model). Nothing is shown while the input is healthy, and nothing is shown for
the browser recogniser, whose level ASAD cannot see — the console does not
pretend to measure what it cannot.

**Where the device is named.** Not on the strip. Session settings (⋯) gains
an *Input* line — "Listening on USB Audio Device (0d8c:0014) · signal ok" —
because "no signal on *what*" is the next question and the answer must be the
exact device, never a guess from a menu. The same sheet carries the new
*Noise suppression* toggle, off by default, with its one-sentence rule (off
for a mixer feed, on only for a room microphone, applies from the next
session), and only for recognisers that take raw audio.

### 2.2 Launcher: the wrong microphone was indistinguishable from the right one — fixed

**Problem.** The Input readiness row said "MacBook Air 마이크 · 준비됨" with
the same green dot as a USB interface. A laptop microphone shows a perfectly
healthy level — of the room.

**Change.** In a worship context the row classifies the selected device from
its label (laptop microphone, phone, Bluetooth → *not a console feed*; USB →
fine; external jack / virtual → verify with the meter) and downgrades the bad
cases to *limited* with a plain Korean sentence: "노트북 자체 마이크입니다.
콘솔에서 오는 소리가 아니라 부스 안의 소리를 듣습니다." Start is not blocked;
Preflight remains a safety aid, not a gate.

### 2.3 Preflight: written for someone who knows what CoreAudio is — rewritten

**Problem.** One select, one meter, one checkbox, and copy that assumed the
reader knew what "AUX/MATRIX 출력", "mix-minus" and "System default" mean. A
volunteer with a dead meter had no next step.

**Change.** A four-step checklist in the order a person actually does it:

1. **Connect** — which console socket, where on the Mac, what will appear in
   the list when it worked (USB device / 외장 마이크) and what it means when
   only *MacBook 마이크* is listed.
2. **Choose the input** — the select, the device-kind sentence under it, a
   *목록 다시 찾기* button, and a warning when every visible input is a
   laptop or phone microphone.
3. **Check the sound** — the meter, now with the opened track's channels and
   sample rate in small type, a **12-second silence** message with concrete
   causes, a **clipping** message with the one knob to turn, and the bar
   turning red when it clips.
4. **Final check** — the mix-minus checkbox, reworded from a term to a test:
   "통역사가 마이크에 대고 말해도 위 막대가 움직이지 않는지 확인했습니다."

Below it, *잘 안 되나요?* opens six symptom → fix pairs (no device in the
list, permission refused, meter never moves, too loud, meter moves when the
interpreter speaks, sound arrives but no English). Error messages now say what
to do: permission → the lock icon in the address bar; *NotReadableError* →
close the other app holding the input.

The readiness contract (signal verified + mix-minus → acknowledgement in
`sessionStorage`, device-scoped, four hours) is unchanged.

### 2.4 Diagnostics: configuration without a diagnosis — added a verdict

**Problem.** `/diagnostics` is correctly deployer-facing, but it opened with
routing modes and gateway policy. A volunteer sent there by a dead console had
to infer the problem from forty rows.

**Change.** A **Live readiness** section at the top: one headline (ready /
something to check / cannot work until fixed), a local 8-second level check
on the booth's preferred input, and an ordered list that tells apart the eight
situations the mission names — permission denied, no input device, wrong
device, no/weak signal, clipping, STT service not configured, no translation
provider, high measured latency — each with its fix. Server facts come from
the payload the page already loads; browser facts from the check. The
page's language stays English, matching the rest of the surface.

### 2.5 Things audited and deliberately left

- The console's typography, dark-only palette, chunk markers (≈ provisional,
  ◦ predicted, ↺ correction, ? low confidence), FREEZE bar and keyboard map
  are sound and unchanged.
- The launcher's "one question" structure is right; nothing was added above
  the fold except the readiness wording.
- `/prep`, `/sessions`, Counter Mode: consistent with the design system;
  no change.
- The context select in the strip remains the one revisable decision; it was
  not moved.

## 3. Accessibility notes

- New status copy reaches the existing single `role="status"` live region;
  nothing continuous was added to it.
- The preflight meter keeps `role="meter"` with `aria-valuenow`; the new
  warnings are `role="status"` paragraphs so a screen reader hears the
  change once.
- Every new control keeps the 44 px minimum height (`min-h-11`), including
  the text-only *목록 다시 찾기* button and the `<details>` summary.
- The red clipping bar is accompanied by text; colour is never the only
  signal.
- Focus-visible rings are inherited from the shared primitives.

## 4. Responsive checks

| Surface | Laptop | iPad landscape | iPhone landscape | iPhone portrait |
| --- | --- | --- | --- | --- |
| `/live` launcher | ✓ | ✓ | ✓ (readiness stacks above the fold) | — |
| `/live` console (demo) | ✓ | — | ✓ (strip label only; detail hidden by design) | — |
| `/booth-preflight` | ✓ | — | — | ✓ (steps stack; troubleshooting collapsible) |
| `/diagnostics` | ✓ | — | — | ✓ |

See §5 for the images. No horizontal overflow was observed at any width.

## 5. Screenshots

Listed in the order they were taken; file names are self-describing.
Captured by `scripts/screenshot.mjs` against the production build on
`localhost:3100` with no provider credentials, so the launcher shows the
zero-config (browser / demo) configuration and the console runs the scripted
demo sermon.

| Screenshot | What it shows |
| --- | --- |
| [2026-10-25-live-launcher-laptop.png](./screenshots/2026-10-25-live-launcher-laptop.png) | `/live` launcher, laptop, first visit: the privacy disclosure gates Start; the readiness rail shows the zero-config browser configuration |
| [2026-10-25-live-launcher-ipad.png](./screenshots/2026-10-25-live-launcher-ipad.png) | `/live` launcher, iPad landscape |
| [2026-10-25-live-launcher-iphone-landscape.png](./screenshots/2026-10-25-live-launcher-iphone-landscape.png) | `/live` launcher, iPhone landscape: the disclosure fills the short viewport |
| [2026-10-25-live-console-demo-laptop.png](./screenshots/2026-10-25-live-console-demo-laptop.png) | `/live` console, laptop, demo sermon running: quiet **● Live** strip, English dominant, Korean capped, context rail with Scripture and terms |
| [2026-10-25-live-console-demo-ipad-landscape.png](./screenshots/2026-10-25-live-console-demo-ipad-landscape.png) | `/live` console, iPad landscape |
| [2026-10-25-live-console-demo-iphone-landscape.png](./screenshots/2026-10-25-live-console-demo-iphone-landscape.png) | `/live` console, iPhone landscape: strip label only, Korean row capped harder |
| [2026-10-25-live-console-settings-laptop.png](./screenshots/2026-10-25-live-console-settings-laptop.png) | Session settings sheet during the demo (the demo has no capture, so the new *Input* line and *Noise suppression* toggle are absent by design; they appear for Browser/Deepgram/OpenAI sessions) |
| [2026-10-25-preflight-laptop.png](./screenshots/2026-10-25-preflight-laptop.png) | `/booth-preflight`, laptop: steps 1–3, device-kind sentence under the select |
| [2026-10-25-preflight-iphone-portrait.png](./screenshots/2026-10-25-preflight-iphone-portrait.png) | `/booth-preflight`, iPhone portrait |
| [2026-10-25-diagnostics-laptop.png](./screenshots/2026-10-25-diagnostics-laptop.png) | `/diagnostics`, laptop: Live readiness verdict, local level check, one warning (no translation provider on this unconfigured build) |
| [2026-10-25-diagnostics-iphone-portrait.png](./screenshots/2026-10-25-diagnostics-iphone-portrait.png) | `/diagnostics`, iPhone portrait |

The headless Chromium exposes one fake audio input and no SpeechRecognition, so the **No signal** / **Input too loud** strip states and the *Input* line could not be photographed from a real capture; they are covered by `ConsoleTopBar.test.ts` and `input-health.test.ts`, and the strip wording is quoted in §2.1.

## 6. What was not evaluated

- A real session with a human interpreter in a booth. Every interaction
  state here was driven by the demo recogniser or by mocks.
- Light-mode rendering of the console: the console is dark-only by design
  and that decision was not revisited.
- Tablet portrait for the console.
